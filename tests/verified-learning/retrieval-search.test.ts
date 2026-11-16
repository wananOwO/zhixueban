import { describe, expect, it } from 'vitest';
import { hybridSearch } from '@/lib/verified-learning/retrieval/search';
import type { RetrievalChunk, RetrievalVectorHit } from '@/lib/verified-learning/retrieval/types';

const chunk = (paragraphIndex: number, text: string, chapterId = 'chapter'): RetrievalChunk => ({
  scopeId: 'scope', sourceId: 'book', sourceRevision: 'revision', chapterId, paragraphIndex, partIndex: 0, text, contentHash: `hash-${paragraphIndex}`, preprocessVersion: 'v1',
});

describe('混合检索', () => {
  it('按 RRF 合并、去重并稳定返回段落', () => {
    const chunks = [chunk(1, '递归终止条件'), chunk(2, '递归调用')];
    const vectors: RetrievalVectorHit[] = [{ chunk: chunks[1], similarity: 0.99 }, { chunk: chunks[0], similarity: 0.8 }];
    const result = hybridSearch({ query: '递归', chunks, vectorHits: vectors, keywordHits: [chunks[0], chunks[1]], limit: 10 });
    expect(result.map(hit => hit.paragraphIndex)).toEqual([1, 2]);
    expect(result[0].match.keyword).toBe(true);
    expect(result[0].match.vector).toBe(true);
    expect(result[0].score).toBeGreaterThan(0);
  });

  it('同一段多个子块只返回一个引用段并保留段号', () => {
    const chunks = [chunk(1, '第一块'), { ...chunk(1, '第二块'), partIndex: 1 }, chunk(2, '第二段')];
    const result = hybridSearch({ query: '块', chunks, vectorHits: [], keywordHits: chunks, limit: 10 });
    expect(result.map(hit => hit.paragraphIndex)).toEqual([1, 2]);
    expect(result[0].text).toContain('第一块');
    expect(result[0].text).toContain('第二块');
  });

  it('最多返回 limit 个结果', () => {
    const chunks = Array.from({ length: 25 }, (_, index) => chunk(index, `内容 ${index}`));
    const result = hybridSearch({ query: '内容', chunks, vectorHits: [], keywordHits: chunks, limit: 20 });
    expect(result).toHaveLength(20);
  });
});
