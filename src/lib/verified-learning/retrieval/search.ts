import type { RetrievalChunk, RetrievalHit, RetrievalSearchInput } from './types';

const RRF_K = 60;
const MAX_CANDIDATES = 40;

/** 常见疑问虚词二元组降权，避免“什么/怎么/为什么”压过真实学科概念词 */
const WEAK_BIGRAMS = new Set([
  '什么', '怎么', '如何', '为什', '哪些', '哪个', '是否', '可以', '时候', '需要',
  '应该', '怎样', '多少', '多快', '为什么', '注意', '里用', '中用', '时怎', '么办',
]);

export const paragraphKeyOf = (chunk: { sourceId: string; sourceRevision: string; chapterId: string; paragraphIndex: number }) =>
  `${chunk.sourceId}\0${chunk.sourceRevision}\0${chunk.chapterId}\0${chunk.paragraphIndex}`;

export const chapterKeyOf = (chunk: { sourceId: string; sourceRevision: string; chapterId: string }) =>
  `${chunk.sourceId}\0${chunk.sourceRevision}\0${chunk.chapterId}`;

interface QueryFeatures {
  rawPhrase: string;
  lowerPhrase: string;
  identifiers: string[];
  bigrams: { gram: string; weight: number }[];
  spaceTerms: string[];
}

function extractQueryFeatures(query: string): QueryFeatures | null {
  const rawPhrase = query.trim();
  if (!rawPhrase) return null;
  const lowerPhrase = rawPhrase.toLocaleLowerCase('zh-CN');

  const idMatches = rawPhrase.match(/O\([^)]+\)|[A-Za-z_][A-Za-z0-9_]*(?:\(\))?|\d+(?:[-.]\d+)+/g) ?? [];
  const identifiers = [...new Set(idMatches)];

  const bigramMap = new Map<string, number>();
  const cjkRuns = lowerPhrase.match(/[\u4e00-\u9fff]+/g) ?? [];
  for (const run of cjkRuns) {
    if (run.length === 1) {
      if (!bigramMap.has(run)) bigramMap.set(run, 0.8);
      continue;
    }
    for (let i = 0; i < run.length - 1; i++) {
      const gram = run.slice(i, i + 2);
      const weight = WEAK_BIGRAMS.has(gram) ? 0.12 : 1.0;
      bigramMap.set(gram, Math.max(bigramMap.get(gram) ?? 0, weight));
    }
  }

  const spaceTerms = lowerPhrase.split(/\s+/).filter(term => term.length >= 2);
  return {
    rawPhrase,
    lowerPhrase,
    identifiers,
    bigrams: [...bigramMap.entries()].map(([gram, weight]) => ({ gram, weight })),
    spaceTerms: [...new Set(spaceTerms)],
  };
}

function hasChapterOrHeadingMatch(chunk: RetrievalChunk, features: QueryFeatures, chapterTitles?: ReadonlyMap<string, string>): boolean {
  const title = chapterTitles?.get(chapterKeyOf(chunk)) ?? '';
  const headingLine = chunk.text.match(/^#{1,6}\s+(.+)$/m)?.[1] ?? '';
  const headerText = `${title}\n${headingLine}`;
  if (!headerText.trim()) return false;
  const lowerHeader = headerText.toLocaleLowerCase('zh-CN');
  if (features.identifiers.some(id => lowerHeader.includes(id.toLocaleLowerCase('zh-CN')))) return true;
  return features.bigrams.some(item => item.weight >= 0.8 && lowerHeader.includes(item.gram));
}

function scoreChunk(chunk: RetrievalChunk, features: QueryFeatures, chapterTitles?: ReadonlyMap<string, string>): { score: number; chapterBoost: boolean } {
  const text = chunk.text;
  const lower = text.toLocaleLowerCase('zh-CN');
  let lexical = 0;
  let strongMatches = 0;

  if (features.rawPhrase.length >= 2) {
    if (text.includes(features.rawPhrase)) {
      lexical += 6;
      strongMatches++;
    } else if (lower.includes(features.lowerPhrase)) {
      lexical += 4.5;
      strongMatches++;
    }
  }

  for (const id of features.identifiers) {
    if (text.includes(id)) {
      lexical += 3.2;
      strongMatches++;
    } else if (lower.includes(id.toLocaleLowerCase('zh-CN'))) {
      lexical += 2.4;
      strongMatches++;
    }
  }

  for (const { gram, weight } of features.bigrams) {
    if (lower.includes(gram)) {
      lexical += weight;
      if (weight >= 0.8) strongMatches++;
    }
  }

  for (const term of features.spaceTerms) {
    if (lower.includes(term)) lexical += 0.8;
  }

  if (strongMatches >= 2) lexical += strongMatches * 0.5;

  const chapterBoost = lexical > 0 && hasChapterOrHeadingMatch(chunk, features, chapterTitles);
  if (chapterBoost) lexical += 1.5;

  // 若全为极低权重的虚词命中（< 0.5），不视为有效高置信关键词命中
  if (lexical < 0.5) return { score: 0, chapterBoost: false };
  return { score: lexical, chapterBoost };
}

function compareParagraphOrder(
  a: { sourceId: string; chapterId: string; paragraphIndex: number },
  b: { sourceId: string; chapterId: string; paragraphIndex: number },
): number {
  return a.sourceId.localeCompare(b.sourceId)
    || a.chapterId.localeCompare(b.chapterId)
    || a.paragraphIndex - b.paragraphIndex;
}

function fallbackMergeText(chunks: readonly RetrievalChunk[]): string {
  return [...chunks].sort((a, b) => a.partIndex - b.partIndex).map(chunk => chunk.text).join('');
}

export function hybridSearch(input: RetrievalSearchInput): RetrievalHit[] {
  const limit = Math.min(20, Math.max(1, input.limit ?? 10));
  const features = extractQueryFeatures(input.query);
  const keywordRanks = new Map<string, number>();
  const vectorRanks = new Map<string, number>();

  // 同一原段多个子块命中时保留最优（最小）排名，且去重后再截断 40 个候选段落
  for (const chunk of input.keywordHits) {
    const key = paragraphKeyOf(chunk);
    if (!keywordRanks.has(key)) {
      keywordRanks.set(key, keywordRanks.size + 1);
      if (keywordRanks.size >= MAX_CANDIDATES) break;
    }
  }
  for (const hit of input.vectorHits) {
    const key = paragraphKeyOf(hit.chunk);
    if (!vectorRanks.has(key)) {
      vectorRanks.set(key, vectorRanks.size + 1);
      if (vectorRanks.size >= MAX_CANDIDATES) break;
    }
  }

  const byParagraph = new Map<string, RetrievalChunk[]>();
  for (const chunk of input.chunks) {
    const key = paragraphKeyOf(chunk);
    if (!keywordRanks.has(key) && !vectorRanks.has(key)) continue;
    const list = byParagraph.get(key);
    if (list) list.push(chunk);
    else byParagraph.set(key, [chunk]);
  }

  return [...byParagraph.entries()]
    .map(([key, chunks]) => {
      const first = chunks[0];
      const kRank = keywordRanks.get(key);
      const vRank = vectorRanks.get(key);
      const score = (kRank !== undefined ? 0.5 / (RRF_K + kRank) : 0) + (vRank !== undefined ? 0.5 / (RRF_K + vRank) : 0);
      const chapterBoost = Boolean(features && kRank !== undefined && chunks.some(c => hasChapterOrHeadingMatch(c, features, input.chapterTitles)));
      return {
        key,
        first,
        chunks,
        score,
        match: { keyword: kRank !== undefined, vector: vRank !== undefined, chapterBoost },
      };
    })
    .sort((a, b) => b.score - a.score || compareParagraphOrder(a.first, b.first))
    .slice(0, limit)
    .map(item => ({
      sourceId: item.first.sourceId,
      sourceRevision: item.first.sourceRevision,
      chapterId: item.first.chapterId,
      paragraphIndex: item.first.paragraphIndex,
      text: input.paragraphs?.get(item.key) ?? fallbackMergeText(item.chunks),
      score: item.score,
      match: item.match,
      contentHash: item.first.contentHash,
    }));
}

export function keywordSearch(
  query: string,
  chunks: readonly RetrievalChunk[],
  limit = MAX_CANDIDATES,
  chapterTitles?: ReadonlyMap<string, string>,
): RetrievalChunk[] {
  const features = extractQueryFeatures(query);
  if (!features) return [];
  const bestByParagraph = new Map<string, { chunk: RetrievalChunk; score: number }>();

  for (const chunk of chunks) {
    const { score } = scoreChunk(chunk, features, chapterTitles);
    if (score <= 0) continue;
    const key = paragraphKeyOf(chunk);
    const existing = bestByParagraph.get(key);
    if (!existing || score > existing.score || (score === existing.score && chunk.partIndex < existing.chunk.partIndex)) {
      bestByParagraph.set(key, { chunk, score });
    }
  }

  return [...bestByParagraph.values()]
    .sort((a, b) => b.score - a.score || compareParagraphOrder(a.chunk, b.chunk))
    .slice(0, limit)
    .map(item => item.chunk);
}
