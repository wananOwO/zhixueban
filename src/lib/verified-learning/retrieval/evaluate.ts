import { readFileSync } from 'node:fs';
import os from 'node:os';
import type Database from 'better-sqlite3';
import DatabaseImpl from 'better-sqlite3';
import { migrateVerifiedLearning } from '@/lib/verified-learning/migrations';
import { checkCitation, contentHash, type SourceSnapshot } from '@/lib/verified-learning/sources';
import { createRetrievalChunks } from '@/lib/verified-learning/retrieval/chunking';
import { PREPROCESS_VERSION } from '@/lib/verified-learning/retrieval/from-settings';
import { ensureChunks, indexSource, saveVector } from '@/lib/verified-learning/retrieval/indexer';
import { mrr, percentile, recallAtK } from '@/lib/verified-learning/retrieval/metrics';
import { createEmbeddingProfile, type EmbeddingProfile } from '@/lib/verified-learning/retrieval/profile';
import { paragraphKeyOf } from '@/lib/verified-learning/retrieval/search';
import { createRetrievalService } from '@/lib/verified-learning/retrieval/service';
import { decodeVector, encodeVector } from '@/lib/verified-learning/retrieval/vector';
import type { RetrievalChunk } from '@/lib/verified-learning/retrieval/types';

export interface EvalCase {
  id: string;
  layer: string;
  query: string;
  chapterId?: string;
  expectedParagraphs: number[];
  expectedConcepts?: string[];
}

export interface EvalCorpusItem {
  index: number;
  chapterId?: string;
  chapterTitle?: string;
  text: string;
}

export interface EvalFixture {
  name: string;
  sourceUrl?: string;
  license: string;
  sourceId?: string;
  corpus: EvalCorpusItem[];
  cases: EvalCase[];
}

export type Strategy = 'keyword' | 'vector' | 'hybrid';

export interface CaseResult {
  id: string;
  layer: string;
  query: string;
  chapterId?: string;
  ranked: number[];
  recall3: number;
  recall5: number;
  reciprocalRank: number;
  /** 命中的段落都能通过 checkCitation 引用校验（来源/修订/章节/段号/引文） */
  citationsValid: boolean;
  /** 前 5 条命中正文对期望概念词的覆盖比例 */
  conceptCoverage: number;
  localLatencyMs: number;
  embedLatencyMs: number;
}

export interface StrategyReport {
  strategy: Strategy;
  label: string;
  degraded: boolean;
  cases: CaseResult[];
  recall3: number;
  recall5: number;
  mrr: number;
  citationValidity: number;
  citationCoverage: number;
  latencyP50: number;
  latencyP95: number;
  embedLatencyMeanMs: number;
}

export interface LocalBenchmarkReport {
  chunkCount: number;
  dimensions: number;
  warmupQueries: number;
  measuredQueries: number;
  hardware: string;
  localP50Ms: number;
  localP95Ms: number;
  targetP95Ms: number;
  withinTarget: boolean;
}

export interface EvalReport {
  fixture: string;
  sourceUrl: string | null;
  sourceId: string;
  sourceRevision: string;
  preprocessVersion: string;
  license: string;
  generatedAt: string;
  gitRevision: string | null;
  profileId: string | null;
  embedding: string;
  isSyntheticEmbedding: boolean;
  strategies: StrategyReport[];
  benchmark?: LocalBenchmarkReport;
}

const STRATEGY_LABEL: Record<Strategy, string> = {
  keyword: 'A：关键词检索',
  vector: 'B：仅向量检索',
  hybrid: 'C：关键词 + 向量 + 章节过滤',
};

export function loadFixture(file: string): EvalFixture {
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as EvalFixture;
  if (!Array.isArray(parsed.corpus) || !Array.isArray(parsed.cases)) throw new Error('评测文件缺少 corpus 或 cases');
  for (const item of parsed.corpus) {
    if (!Number.isSafeInteger(item.index) || typeof item.text !== 'string' || !item.text.trim()) throw new Error('corpus 条目不合法');
  }
  for (const item of parsed.cases) {
    if (!item.id || !item.query?.trim() || !Array.isArray(item.expectedParagraphs) || !item.expectedParagraphs.length) {
      throw new Error('cases 条目不合法');
    }
  }
  return parsed;
}

/** 把评测语料按章节组织成不可变来源快照：段号沿用 fixture 里的 index，与真实教材一致 */
export function fixtureSource(fixture: EvalFixture): SourceSnapshot {
  const sorted = [...fixture.corpus].sort((a, b) => a.index - b.index);
  const chapterMap = new Map<string, { chapterId: string; title: string; paragraphs: { paragraphIndex: number; text: string; contentHash: string }[] }>();
  for (const item of sorted) {
    const chapterId = item.chapterId ?? 'eval';
    const title = item.chapterTitle ?? '评测语料';
    let group = chapterMap.get(chapterId);
    if (!group) {
      group = { chapterId, title, paragraphs: [] };
      chapterMap.set(chapterId, group);
    }
    group.paragraphs.push({
      paragraphIndex: item.index,
      text: item.text,
      contentHash: contentHash(item.text),
    });
  }
  const chapters = [...chapterMap.values()];
  const body = { title: fixture.name, format: 'txt' as const, chapters };
  return {
    sourceId: fixture.sourceId ?? 'eval-corpus',
    sourceRevision: contentHash(JSON.stringify(body)),
    ...body,
  };
}

/**
 * 确定性本地哈希向量：字符二元组 + 标识符特征哈希到固定维度并 L2 归一化。
 * 仅用于在未提供真实 Embedding 服务时验证检索与评测管线可复现，报告中显式标注非真实语义模型。
 */
export function syntheticEmbedding(dimensions = 256): (values: readonly string[]) => Promise<number[][]> {
  return async values => values.map(text => {
    const vector = new Array<number>(dimensions).fill(0);
    const clean = text.toLowerCase().replace(/\s+/g, '');
    for (let index = 0; index < clean.length; index++) {
      const gram = clean.slice(index, index + 2);
      let hash = 2166136261;
      for (let position = 0; position < gram.length; position++) {
        hash = Math.imul(hash ^ gram.charCodeAt(position), 16777619) >>> 0;
      }
      vector[hash % dimensions] += 1;
    }
    const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
    if (!norm) {
      vector[0] = 1;
      return vector;
    }
    return vector.map(value => value / norm);
  });
}

function vectorOnlyRanking(
  db: Database.Database,
  scopeId: string,
  source: SourceSnapshot,
  profile: EmbeddingProfile,
  chunks: readonly RetrievalChunk[],
  query: number[],
): number[] {
  const rows = db.prepare(`SELECT chapter_id,paragraph_index,part_index,dimensions,vector_blob FROM vl_retrieval_vectors
    WHERE scope_id=? AND book_id=? AND source_revision=? AND profile_id=? AND status='ready'`).all(
    scopeId, source.sourceId, source.sourceRevision, profile.profileId,
  ) as { chapter_id: string; paragraph_index: number; part_index: number; dimensions: number; vector_blob: Buffer }[];

  const chunkSet = new Set(chunks.map(c => `${c.chapterId}\0${c.paragraphIndex}\0${c.partIndex}`));
  const bestByParagraph = new Map<number, number>();
  let normB = 0;
  for (let i = 0; i < query.length; i++) normB += query[i] * query[i];
  if (!normB) return [];

  for (const row of rows) {
    if (!chunkSet.has(`${row.chapter_id}\0${row.paragraph_index}\0${row.part_index}`)) continue;
    let vector: Float32Array;
    try {
      vector = decodeVector(row.vector_blob, row.dimensions);
    } catch {
      continue;
    }
    if (vector.length !== query.length) continue;
    let dot = 0;
    let normA = 0;
    for (let index = 0; index < vector.length; index++) {
      dot += vector[index] * query[index];
      normA += vector[index] * vector[index];
    }
    if (!normA) continue;
    const sim = dot / Math.sqrt(normA * normB);
    const prior = bestByParagraph.get(row.paragraph_index);
    if (prior === undefined || sim > prior) bestByParagraph.set(row.paragraph_index, sim);
  }
  return [...bestByParagraph.entries()]
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .slice(0, 10)
    .map(([paragraphIndex]) => paragraphIndex);
}

function computeConceptCoverage(source: SourceSnapshot, topParagraphs: readonly number[], expectedConcepts?: readonly string[]): number {
  if (!expectedConcepts?.length) return 1;
  const topSet = new Set(topParagraphs);
  const combinedText = source.chapters
    .flatMap(ch => ch.paragraphs)
    .filter(p => topSet.has(p.paragraphIndex))
    .map(p => p.text.toLowerCase())
    .join('\n');
  const hits = expectedConcepts.filter(concept => combinedText.includes(concept.toLowerCase())).length;
  return hits / expectedConcepts.length;
}

async function runStrategy(options: {
  strategy: Strategy;
  fixture: EvalFixture;
  source: SourceSnapshot;
  db: Database.Database;
  scopeId: string;
  profile: EmbeddingProfile;
  embed: (values: readonly string[]) => Promise<number[][]>;
}): Promise<StrategyReport> {
  const chunks = createRetrievalChunks(options.source, options.profile.preprocessVersion).map(chunk => ({ ...chunk, scopeId: options.scopeId }));
  const keywordOnlyService = createRetrievalService(options.db, options.scopeId);
  const hybridService = createRetrievalService(options.db, options.scopeId, { profile: options.profile, embed: options.embed });
  const cases: CaseResult[] = [];
  let degradedAny = false;

  const paragraphLookup = new Map<number, { chapterId: string; text: string }>();
  for (const ch of options.source.chapters) {
    for (const p of ch.paragraphs) paragraphLookup.set(p.paragraphIndex, { chapterId: ch.chapterId, text: p.text });
  }

  for (const item of options.fixture.cases) {
    let ranked: number[] = [];
    let localLatencyMs = 0;
    let embedLatencyMs = 0;

    if (options.strategy === 'keyword') {
      const result = await keywordOnlyService.retrieve(item.query, [options.source], { limit: 10 });
      ranked = result.hits.map(hit => hit.paragraphIndex);
      localLatencyMs = result.localSearchLatencyMs ?? 0;
    } else if (options.strategy === 'vector') {
      const embedStart = performance.now();
      const [vector] = await options.embed([item.query]);
      embedLatencyMs = performance.now() - embedStart;
      const localStart = performance.now();
      ranked = vectorOnlyRanking(options.db, options.scopeId, options.source, options.profile, chunks, vector);
      localLatencyMs = performance.now() - localStart;
    } else {
      // C：关键词 + 向量 + 章节过滤（对带章节先验的用例启用 chapterIds）
      const result = await hybridService.retrieve(item.query, [options.source], {
        limit: 10,
        chapterIds: item.chapterId ? [item.chapterId] : undefined,
      });
      degradedAny = degradedAny || result.degraded;
      ranked = result.hits.map(hit => hit.paragraphIndex);
      embedLatencyMs = result.embedLatencyMs ?? 0;
      localLatencyMs = result.localSearchLatencyMs ?? 0;
    }

    const unique = [...new Set(ranked)].slice(0, 10);
    const citationsValid = unique.every(paragraphIndex => {
      const found = paragraphLookup.get(paragraphIndex);
      if (!found) return false;
      return checkCitation([options.source], {
        sourceId: options.source.sourceId,
        sourceRevision: options.source.sourceRevision,
        chapterId: found.chapterId,
        paragraphIndex,
        quote: found.text.slice(0, Math.min(40, found.text.length)),
      }).ok;
    });
    const conceptCoverage = computeConceptCoverage(options.source, unique.slice(0, 5), item.expectedConcepts);
    void paragraphKeyOf;

    cases.push({
      id: item.id,
      layer: item.layer,
      query: item.query,
      chapterId: item.chapterId,
      ranked: unique,
      recall3: recallAtK(unique, item.expectedParagraphs, 3),
      recall5: recallAtK(unique, item.expectedParagraphs, 5),
      reciprocalRank: mrr(unique, item.expectedParagraphs),
      citationsValid,
      conceptCoverage,
      localLatencyMs,
      embedLatencyMs,
    });
  }

  const mean = (values: number[]) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0);
  return {
    strategy: options.strategy,
    label: STRATEGY_LABEL[options.strategy],
    degraded: degradedAny,
    cases,
    recall3: mean(cases.map(item => item.recall3)),
    recall5: mean(cases.map(item => item.recall5)),
    mrr: mean(cases.map(item => item.reciprocalRank)),
    citationValidity: cases.length ? cases.filter(item => item.citationsValid).length / cases.length : 0,
    citationCoverage: mean(cases.map(item => item.conceptCoverage)),
    latencyP50: percentile(cases.map(item => item.localLatencyMs), 50),
    latencyP95: percentile(cases.map(item => item.localLatencyMs), 95),
    embedLatencyMeanMs: mean(cases.map(item => item.embedLatencyMs)),
  };
}

/**
 * 设计 5.9 本地检索性能基准：
 * 默认 5000 子块 × 1536 维、20 次预热查询，单独记录本地混合检索 p50/p95（不含网络生成查询向量耗时）。
 */
export async function benchmarkLocalRetrieval(options: {
  chunkCount?: number;
  dimensions?: number;
  warmupQueries?: number;
  measuredQueries?: number;
} = {}): Promise<LocalBenchmarkReport> {
  const chunkCount = options.chunkCount ?? 5000;
  const dimensions = options.dimensions ?? 1536;
  const warmupQueries = options.warmupQueries ?? 20;
  const measuredQueries = options.measuredQueries ?? 30;
  const targetP95Ms = 500;

  const db = new DatabaseImpl(':memory:');
  db.pragma('foreign_keys = ON');
  await migrateVerifiedLearning(db);
  const scopeId = 'bench-scope';

  try {
    const paragraphs = Array.from({ length: chunkCount }, (_, i) => {
      const text = `第 ${i} 段算法讲义：动态规划、图论最短路 Dijkstra 与二叉堆维护状态转移 ${i % 97}。`;
      return { paragraphIndex: i, text, contentHash: contentHash(text) };
    });
    const source: SourceSnapshot = {
      sourceId: 'bench-book',
      sourceRevision: 'bench-rev-1',
      title: '性能基准语料',
      format: 'txt',
      chapters: [{ chapterId: 'bench-ch', title: '基准章节', paragraphs }],
    };
    db.prepare(`INSERT INTO vl_books(scope_id,book_id,origin,status,created_at) VALUES (?,?,'owned','ready',?)`).run(scopeId, source.sourceId, new Date().toISOString());
    db.prepare(`INSERT INTO vl_source_revisions(scope_id,book_id,source_revision,snapshot_json,created_at) VALUES (?,?,?,?,?)`)
      .run(scopeId, source.sourceId, source.sourceRevision, JSON.stringify(source), new Date().toISOString());

    const profile = createEmbeddingProfile(
      { provider: 'openai-compatible', baseUrl: 'http://local.bench', model: 'bench-1536', dimensions },
      PREPROCESS_VERSION,
    );
    const chunks = createRetrievalChunks(source, PREPROCESS_VERSION).map(c => ({ ...c, scopeId }));
    ensureChunks(db, scopeId, chunks);

    const baseVec = new Array<number>(dimensions).fill(0);
    for (let d = 0; d < dimensions; d++) baseVec[d] = ((d % 17) + 1) / 20;

    db.transaction(() => {
      for (let i = 0; i < chunks.length; i++) {
        baseVec[i % dimensions] = ((i % 23) + 1) / 25;
        saveVector(db, scopeId, profile, chunks[i], dimensions, 'ready', encodeVector(baseVec), null);
      }
    })();

    const queryVec = [...baseVec];
    const service = createRetrievalService(db, scopeId, {
      profile,
      embed: async () => [queryVec],
    });

    for (let w = 0; w < warmupQueries; w++) {
      await service.retrieve(`动态规划状态转移 ${w % 20}`, [source], { limit: 10 });
    }

    const latencies: number[] = [];
    for (let m = 0; m < measuredQueries; m++) {
      const res = await service.retrieve(`最短路与二叉堆 ${m % 30}`, [source], { limit: 10 });
      latencies.push(res.localSearchLatencyMs ?? 0);
    }

    const localP50Ms = percentile(latencies, 50);
    const localP95Ms = percentile(latencies, 95);
    const cpuModel = os.cpus()[0]?.model?.trim() ?? 'unknown-cpu';
    const hardware = `${os.platform()} ${os.arch()} · ${cpuModel} (${os.cpus().length} 逻辑核)`;

    return {
      chunkCount,
      dimensions,
      warmupQueries,
      measuredQueries,
      hardware,
      localP50Ms,
      localP95Ms,
      targetP95Ms,
      withinTarget: localP95Ms <= targetP95Ms,
    };
  } finally {
    db.close();
  }
}

export interface EvaluateOptions {
  fixtureFile: string;
  strategies?: Strategy[];
  /** 真实 Embedding 服务；省略则用确定性本地哈希向量（synthetic） */
  embed?: (values: readonly string[]) => Promise<number[][]>;
  embeddingLabel?: string;
  dimensions?: number | null;
  gitRevision?: string | null;
  includeBenchmark?: boolean;
}

export async function evaluate(options: EvaluateOptions): Promise<EvalReport> {
  const fixture = loadFixture(options.fixtureFile);
  const source = fixtureSource(fixture);
  const db = new DatabaseImpl(':memory:');
  db.pragma('foreign_keys = ON');
  await migrateVerifiedLearning(db);
  const scopeId = 'eval-scope';
  db.prepare(`INSERT INTO vl_books(scope_id,book_id,origin,status,created_at) VALUES (?,?,'owned','ready',?)`).run(scopeId, source.sourceId, new Date().toISOString());
  db.prepare(`INSERT INTO vl_source_revisions(scope_id,book_id,source_revision,snapshot_json,created_at) VALUES (?,?,?,?,?)`)
    .run(scopeId, source.sourceId, source.sourceRevision, JSON.stringify(source), new Date().toISOString());

  const isSynthetic = !options.embed;
  const embed = options.embed ?? syntheticEmbedding();
  const profile = createEmbeddingProfile(
    {
      provider: 'openai-compatible',
      baseUrl: 'http://local.synthetic',
      model: isSynthetic ? 'synthetic-bigram' : 'provider',
      dimensions: options.dimensions ?? null,
    },
    PREPROCESS_VERSION,
  );
  const strategies = options.strategies ?? ['keyword', 'vector', 'hybrid'];

  try {
    if (strategies.some(strategy => strategy !== 'keyword')) {
      await indexSource(db, scopeId, source, profile, { embed });
    }
    const reports: StrategyReport[] = [];
    for (const strategy of strategies) {
      reports.push(await runStrategy({ strategy, fixture, source, db, scopeId, profile, embed }));
    }
    const benchmark = options.includeBenchmark ? await benchmarkLocalRetrieval() : undefined;
    return {
      fixture: fixture.name,
      sourceUrl: fixture.sourceUrl ?? null,
      sourceId: source.sourceId,
      sourceRevision: source.sourceRevision,
      preprocessVersion: PREPROCESS_VERSION,
      license: fixture.license,
      generatedAt: new Date().toISOString(),
      gitRevision: options.gitRevision ?? null,
      profileId: profile.profileId,
      embedding: options.embeddingLabel ?? (isSynthetic ? 'synthetic-bigram (仅验证离线检索链路可复现，不代表真实语义模型质量)' : 'provider'),
      isSyntheticEmbedding: isSynthetic,
      strategies: reports,
      ...(benchmark ? { benchmark } : {}),
    };
  } finally {
    db.close();
  }
}

export function toMarkdown(report: EvalReport): string {
  const lines = [
    '# 检索评测报告',
    '',
    `- 语料：${report.fixture}`,
    ...(report.sourceUrl ? [`- 来源说明：${report.sourceUrl}`] : []),
    `- 许可：${report.license}`,
    `- 来源修订：\`${report.sourceId}@${report.sourceRevision}\``,
    `- 预处理版本：\`${report.preprocessVersion}\``,
    `- 生成时间：${report.generatedAt}`,
    `- Git：${report.gitRevision ?? '未记录'}`,
    `- Embedding：${report.embedding}`,
    `- profile：\`${report.profileId ?? '未使用'}\``,
    ...(report.isSyntheticEmbedding ? ['', '> 说明：本次未配置外部 `EMBEDDING_*` 服务，向量路采用确定性本地哈希向量验证混合检索与 RRF 管线可复现；真实语义改写提升需连接真实 Embedding 模型运行本脚本生成。'] : []),
    '',
    '## 三组策略总览',
    '',
    '| 策略 | Recall@3 | Recall@5 | MRR | 引用合法率 | 概念覆盖率 | 本地 p50(ms) | 本地 p95(ms) | 向量请求均值(ms) | 降级 |',
    '|---|---:|---:|---:|---:|---:|---:|---:|---:|---|',
    ...report.strategies.map(item =>
      `| ${item.label} | ${(item.recall3 * 100).toFixed(1)}% | ${(item.recall5 * 100).toFixed(1)}% | ${item.mrr.toFixed(3)} | ${(item.citationValidity * 100).toFixed(1)}% | ${(item.citationCoverage * 100).toFixed(1)}% | ${item.latencyP50.toFixed(2)} | ${item.latencyP95.toFixed(2)} | ${item.embedLatencyMeanMs.toFixed(2)} | ${item.degraded ? '是' : '否'} |`,
    ),
    '',
    '## 分类型 Recall@5',
    '',
    '| 策略 | 精确关键词题 | 中文语义改写题 | 章节上下文题 | 截图识别检索题 |',
    '|---|---:|---:|---:|---:|',
    ...report.strategies.map(item => {
      const layer = (name: string) => {
        const subset = item.cases.filter(entry => entry.layer === name);
        return subset.length ? `${((subset.reduce((sum, entry) => sum + entry.recall5, 0) / subset.length) * 100).toFixed(1)}%` : '—';
      };
      return `| ${item.label} | ${layer('keyword')} | ${layer('semantic')} | ${layer('context')} | ${layer('vision')} |`;
    }),
  ];

  if (report.benchmark) {
    const b = report.benchmark;
    lines.push(
      '',
      '## 本地大规模向量扫描基准（不含网络延迟）',
      '',
      `- 硬件环境：${b.hardware}`,
      `- 规模：${b.chunkCount} 子块 × ${b.dimensions} 维（预热 ${b.warmupQueries} 次，实测 ${b.measuredQueries} 次）`,
      `- 本地检索耗时：p50 = ${b.localP50Ms.toFixed(2)} ms，p95 = ${b.localP95Ms.toFixed(2)} ms（目标 p95 ≤ ${b.targetP95Ms} ms：${b.withinTarget ? '达标' : '未达标'}）`,
    );
  }
  lines.push('');
  return lines.join('\n');
}
