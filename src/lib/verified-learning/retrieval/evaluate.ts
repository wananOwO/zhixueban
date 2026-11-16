import { readFileSync } from 'node:fs';
import type Database from 'better-sqlite3';
import DatabaseImpl from 'better-sqlite3';
import { migrateVerifiedLearning } from '@/lib/verified-learning/migrations';
import { contentHash, type SourceSnapshot } from '@/lib/verified-learning/sources';
import { createRetrievalChunks } from '@/lib/verified-learning/retrieval/chunking';
import { indexSource } from '@/lib/verified-learning/retrieval/indexer';
import { mrr, percentile, recallAtK } from '@/lib/verified-learning/retrieval/metrics';
import { createEmbeddingProfile, type EmbeddingProfile } from '@/lib/verified-learning/retrieval/profile';
import { hybridSearch, keywordSearch } from '@/lib/verified-learning/retrieval/search';
import { createRetrievalService } from '@/lib/verified-learning/retrieval/service';
import { decodeVector } from '@/lib/verified-learning/retrieval/vector';
import type { RetrievalChunk } from '@/lib/verified-learning/retrieval/types';

export interface EvalCase { id: string; layer: string; query: string; expectedParagraphs: number[] }
export interface EvalFixture { name: string; license: string; corpus: { index: number; text: string }[]; cases: EvalCase[] }
export type Strategy = 'keyword' | 'vector' | 'hybrid';

export interface CaseResult {
  id: string;
  layer: string;
  query: string;
  ranked: number[];
  recall3: number;
  recall5: number;
  reciprocalRank: number;
  /** 命中的段落都能通过引用校验（来源/修订/段号/引文） */
  citationsValid: boolean;
  latencyMs: number;
}

export interface StrategyReport {
  strategy: Strategy;
  degraded: boolean;
  cases: CaseResult[];
  recall3: number;
  recall5: number;
  mrr: number;
  citationValidity: number;
  latencyP50: number;
  latencyP95: number;
}

export interface EvalReport {
  fixture: string;
  license: string;
  generatedAt: string;
  gitRevision: string | null;
  profileId: string | null;
  embedding: string;
  strategies: StrategyReport[];
}

export function loadFixture(file: string): EvalFixture {
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as EvalFixture;
  if (!Array.isArray(parsed.corpus) || !Array.isArray(parsed.cases)) throw new Error('评测文件缺少 corpus 或 cases');
  for (const item of parsed.corpus) {
    if (!Number.isSafeInteger(item.index) || typeof item.text !== 'string' || !item.text.trim()) throw new Error('corpus 条目不合法');
  }
  for (const item of parsed.cases) {
    if (!item.id || !item.query?.trim() || !Array.isArray(item.expectedParagraphs)) throw new Error('cases 条目不合法');
  }
  return parsed;
}

/** 把评测语料包成单个来源快照：段号沿用 fixture 里的 index，与真实教材一致 */
export function fixtureSource(fixture: EvalFixture): SourceSnapshot {
  const paragraphs = [...fixture.corpus].sort((a, b) => a.index - b.index).map(item => ({ paragraphIndex: item.index, text: item.text, contentHash: contentHash(item.text) }));
  const body = { title: fixture.name, format: 'txt' as const, chapters: [{ chapterId: 'eval', title: '评测语料', paragraphs }] };
  return { sourceId: 'eval-corpus', sourceRevision: contentHash(JSON.stringify(body)), ...body };
}

/**
 * 确定性本地向量：字符二元组哈希到固定维度并归一化。
 * 只用于在没有 Embedding 服务时验证检索链路可复现，不代表真实语义模型质量。
 */
export function syntheticEmbedding(dimensions = 256): (values: readonly string[]) => Promise<number[][]> {
  return async values => values.map(text => {
    const vector = new Array<number>(dimensions).fill(0);
    const clean = text.toLowerCase().replace(/\s+/g, '');
    for (let index = 0; index < clean.length; index++) {
      const gram = clean.slice(index, index + 2);
      let hash = 2166136261;
      for (let position = 0; position < gram.length; position++) hash = Math.imul(hash ^ gram.charCodeAt(position), 16777619) >>> 0;
      vector[hash % dimensions] += 1;
    }
    const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
    if (!norm) { vector[0] = 1; return vector; }
    return vector.map(value => value / norm);
  });
}

function vectorOnlyRanking(db: Database.Database, scopeId: string, profile: EmbeddingProfile, chunks: readonly RetrievalChunk[], query: number[]): number[] {
  const rows = db.prepare(`SELECT chapter_id,paragraph_index,part_index,dimensions,vector_blob FROM vl_retrieval_vectors
    WHERE scope_id=? AND profile_id=? AND status='ready'`).all(scopeId, profile.profileId) as
    { chapter_id: string; paragraph_index: number; part_index: number; dimensions: number; vector_blob: Buffer }[];
  const scored = rows.flatMap(row => {
    const chunk = chunks.find(item => item.chapterId === row.chapter_id && item.paragraphIndex === row.paragraph_index && item.partIndex === row.part_index);
    if (!chunk) return [];
    let vector: Float32Array;
    try { vector = decodeVector(row.vector_blob, row.dimensions); } catch { return []; }
    if (vector.length !== query.length) return [];
    let dot = 0, normA = 0, normB = 0;
    for (let index = 0; index < vector.length; index++) { dot += vector[index] * query[index]; normA += vector[index] * vector[index]; normB += query[index] * query[index]; }
    if (!normA || !normB) return [];
    return [{ paragraphIndex: row.paragraph_index, similarity: dot / Math.sqrt(normA * normB) }];
  });
  return scored.sort((a, b) => b.similarity - a.similarity).map(item => item.paragraphIndex);
}

async function runStrategy(options: {
  strategy: Strategy; fixture: EvalFixture; source: SourceSnapshot; db: Database.Database; scopeId: string;
  profile: EmbeddingProfile; embed: (values: readonly string[]) => Promise<number[][]>;
}): Promise<StrategyReport> {
  const chunks = createRetrievalChunks(options.source, options.profile.preprocessVersion).map(chunk => ({ ...chunk, scopeId: options.scopeId }));
  const service = createRetrievalService(options.db, options.scopeId, { profile: options.profile, embed: options.embed });
  const cases: CaseResult[] = [];
  let degradedAny = false;
  for (const item of options.fixture.cases) {
    const started = performance.now();
    let ranked: number[] = [];
    if (options.strategy === 'keyword') {
      ranked = keywordSearch(item.query, chunks, 10).map(chunk => chunk.paragraphIndex);
    } else {
      const [vector] = await options.embed([item.query]);
      if (options.strategy === 'vector') ranked = vectorOnlyRanking(options.db, options.scopeId, options.profile, chunks, vector);
      else {
        const result = await service.retrieve(item.query, [options.source], { limit: 10 });
        degradedAny = degradedAny || result.degraded;
        ranked = result.hits.map(hit => hit.paragraphIndex);
      }
    }
    const latencyMs = performance.now() - started;
    const unique = [...new Set(ranked)];
    const citationsValid = unique.every(paragraphIndex => {
      const chunk = chunks.find(item => item.paragraphIndex === paragraphIndex);
      return !!chunk && options.source.chapters.some(chapter => chapter.paragraphs.some(paragraph => paragraph.paragraphIndex === paragraphIndex && paragraph.contentHash === chunk.contentHash));
    });
    cases.push({
      id: item.id, layer: item.layer, query: item.query, ranked: unique.slice(0, 10),
      recall3: recallAtK(unique, item.expectedParagraphs, 3), recall5: recallAtK(unique, item.expectedParagraphs, 5),
      reciprocalRank: mrr(unique, item.expectedParagraphs), citationsValid, latencyMs,
    });
  }
  const mean = (values: number[]) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0);
  return {
    strategy: options.strategy, degraded: degradedAny, cases,
    recall3: mean(cases.map(item => item.recall3)), recall5: mean(cases.map(item => item.recall5)),
    mrr: mean(cases.map(item => item.reciprocalRank)),
    citationValidity: cases.length ? cases.filter(item => item.citationsValid).length / cases.length : 0,
    latencyP50: percentile(cases.map(item => item.latencyMs), 50), latencyP95: percentile(cases.map(item => item.latencyMs), 95),
  };
}

export interface EvaluateOptions {
  fixtureFile: string;
  strategies?: Strategy[];
  /** 真实 Embedding 服务；省略则用确定性本地向量（synthetic） */
  embed?: (values: readonly string[]) => Promise<number[][]>;
  embeddingLabel?: string;
  dimensions?: number | null;
  gitRevision?: string | null;
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
  const embed = options.embed ?? syntheticEmbedding();
  const profile = createEmbeddingProfile({ provider: 'openai-compatible', baseUrl: 'http://local.synthetic', model: options.embed ? 'provider' : 'synthetic-trigram', dimensions: options.dimensions ?? null }, 'paragraph-v1');
  const strategies = options.strategies ?? ['keyword', 'vector', 'hybrid'];
  try {
    if (strategies.some(strategy => strategy !== 'keyword')) await indexSource(db, scopeId, source, profile, { embed });
    const reports: StrategyReport[] = [];
    for (const strategy of strategies) {
      if (strategy === 'keyword') {
        reports.push(await runStrategy({ strategy, fixture, source, db, scopeId, profile, embed }));
      } else {
        reports.push(await runStrategy({ strategy, fixture, source, db, scopeId, profile, embed }));
      }
    }
    return {
      fixture: fixture.name, license: fixture.license, generatedAt: new Date().toISOString(),
      gitRevision: options.gitRevision ?? null, profileId: profile.profileId,
      embedding: options.embeddingLabel ?? (options.embed ? 'provider' : 'synthetic-trigram (仅验证链路，不代表真实语义质量)'),
      strategies: reports,
    };
  } finally { db.close(); }
}

export function toMarkdown(report: EvalReport): string {
  const lines = [
    `# 检索评测报告`,
    '',
    `- 语料：${report.fixture}`,
    `- 许可：${report.license}`,
    `- 生成时间：${report.generatedAt}`,
    `- Git：${report.gitRevision ?? '未记录'}`,
    `- Embedding：${report.embedding}`,
    `- profile：${report.profileId ?? '未使用'}`,
    '',
    '| 策略 | Recall@3 | Recall@5 | MRR | 引用合法率 | p50(ms) | p95(ms) | 降级 |',
    '|---|---:|---:|---:|---:|---:|---:|---|',
    ...report.strategies.map(item => `| ${item.strategy} | ${(item.recall3 * 100).toFixed(1)}% | ${(item.recall5 * 100).toFixed(1)}% | ${item.mrr.toFixed(3)} | ${(item.citationValidity * 100).toFixed(1)}% | ${item.latencyP50.toFixed(1)} | ${item.latencyP95.toFixed(1)} | ${item.degraded ? '是' : '否'} |`),
    '',
    '## 分类型 Recall@5',
    '',
    '| 策略 | 关键词题 | 语义改写题 | 上下文题 |',
    '|---|---:|---:|---:|',
    ...report.strategies.map(item => {
      const layer = (name: string) => {
        const subset = item.cases.filter(entry => entry.layer === name);
        return subset.length ? `${((subset.reduce((sum, entry) => sum + entry.recall5, 0) / subset.length) * 100).toFixed(1)}%` : '—';
      };
      return `| ${item.strategy} | ${layer('keyword')} | ${layer('semantic')} | ${layer('context')} |`;
    }),
    '',
  ];
  return lines.join('\n');
}