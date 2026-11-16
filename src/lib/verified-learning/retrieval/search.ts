import type { RetrievalChunk, RetrievalHit, RetrievalSearchInput } from './types';

const RRF_K = 60;
const normalize = (value: string) => value.toLocaleLowerCase('zh-CN').trim();

function mergeText(chunks: RetrievalChunk[]): string {
  return chunks.sort((a, b) => a.partIndex - b.partIndex).map(chunk => chunk.text).join('\n');
}

export function hybridSearch(input: RetrievalSearchInput): RetrievalHit[] {
  const limit = Math.min(20, Math.max(1, input.limit ?? 10));
  const keywordRanks = new Map<string, number>();
  const vectorRanks = new Map<string, number>();
  const keyOf = (chunk: RetrievalChunk) => `${chunk.sourceId}\0${chunk.sourceRevision}\0${chunk.chapterId}\0${chunk.paragraphIndex}`;
  input.keywordHits.slice(0, 40).forEach((chunk, index) => keywordRanks.set(keyOf(chunk), index + 1));
  input.vectorHits.slice(0, 40).forEach((hit, index) => vectorRanks.set(keyOf(hit.chunk), index + 1));
  const byParagraph = new Map<string, RetrievalChunk[]>();
  for (const chunk of input.chunks) {
    const key = keyOf(chunk);
    if (!keywordRanks.has(key) && !vectorRanks.has(key)) continue;
    byParagraph.set(key, [...(byParagraph.get(key) ?? []), chunk]);
  }
  return [...byParagraph.entries()]
    .map(([key, chunks]) => ({
      key,
      chunks,
      score: (keywordRanks.has(key) ? 0.5 / (RRF_K + keywordRanks.get(key)!) : 0) + (vectorRanks.has(key) ? 0.5 / (RRF_K + vectorRanks.get(key)!) : 0),
      match: { keyword: keywordRanks.has(key), vector: vectorRanks.has(key), chapterBoost: false },
    }))
    .sort((a, b) => b.score - a.score || a.key.localeCompare(b.key))
    .slice(0, limit)
    .map(item => {
      const first = item.chunks[0];
      return { sourceId: first.sourceId, sourceRevision: first.sourceRevision, chapterId: first.chapterId, paragraphIndex: first.paragraphIndex, text: mergeText(item.chunks), score: item.score, match: item.match, contentHash: first.contentHash };
    });
}

export function keywordSearch(query: string, chunks: readonly RetrievalChunk[], limit = 40): RetrievalChunk[] {
  const needle = normalize(query);
  if (!needle) return [];
  const terms = needle.split(/\s+/).filter(Boolean);
  return chunks
    .map(chunk => ({ chunk, score: (chunk.text.includes(query) ? 4 : 0) + terms.filter(term => normalize(chunk.text).includes(term)).length }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || a.chunk.paragraphIndex - b.chunk.paragraphIndex)
    .slice(0, limit)
    .map(item => item.chunk);
}
