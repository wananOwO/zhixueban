import { describe, expect, it } from 'vitest';
import { hybridSearch, keywordSearch } from '@/lib/verified-learning/retrieval/search';
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

  it('同一段多个子块只返回一个引用段、保留最优排名且优先使用快照原段文本', () => {
    const chunks = [chunk(1, '第一块重叠句。'), { ...chunk(1, '重叠句。第二块'), partIndex: 1 }, chunk(2, '第二段')];
    const paragraphs = new Map([['book\u0000revision\u0000chapter\u00001', '第一块重叠句。第二块'], ['book\u0000revision\u0000chapter\u00002', '第二段']]);
    // 段落 1 的两个子块排第 1 和第 3，段落 2 排第 2；段落 1 应取最优排名 1 而非被第 3 覆盖
    const result = hybridSearch({ query: '块', chunks, vectorHits: [], keywordHits: [chunks[0], chunks[2], chunks[1]], paragraphs, limit: 10 });
    expect(result.map(hit => hit.paragraphIndex)).toEqual([1, 2]);
    expect(result[0].text).toBe('第一块重叠句。第二块');
  });

  it('同分按来源、章节、段号数值升序稳定排序（第 2 段排在第 10 段前）', () => {
    const c10 = chunk(10, '相同匹配词');
    const c2 = chunk(2, '相同匹配词');
    const result = hybridSearch({
      query: '相同匹配词',
      chunks: [c10, c2],
      keywordHits: [c10],
      vectorHits: [{ chunk: c2, similarity: 0.9 }],
      limit: 10,
    });
    expect(result.map(hit => hit.paragraphIndex)).toEqual([2, 10]);
  });

  it('中文无空格问句通过二元组与标识符分词召回，章节标题命中标记 chapterBoost', () => {
    const chunks = [
      chunk(1, '普通数组按下标访问是常数时间。', 'ch-array'),
      chunk(2, '递归是函数调用自身。递归必须有终止条件，否则会不断压栈直到栈溢出。', 'ch-rec'),
      chunk(3, '可迭代对象实现 __iter__，并在结束时抛出 StopIteration。', 'ch-iter'),
    ];
    const titles = new Map([
      ['book\0revision\0ch-array', '第一章 数组'],
      ['book\0revision\0ch-rec', '第二章 递归与分治'],
      ['book\0revision\0ch-iter', '第三章 迭代器'],
    ]);
    const recHits = keywordSearch('递归函数什么时候必须停止？', chunks, 10, titles);
    expect(recHits[0]?.paragraphIndex).toBe(2);
    const hybrid = hybridSearch({ query: '递归函数什么时候必须停止？', chunks, keywordHits: recHits, vectorHits: [], chapterTitles: titles, limit: 10 });
    expect(hybrid[0]?.match.chapterBoost).toBe(true);

    const codeHits = keywordSearch('__iter__ 与 StopIteration 的关系', chunks, 10, titles);
    expect(codeHits[0]?.paragraphIndex).toBe(3);
  });

  it('最多返回 limit 个结果', () => {
    const chunks = Array.from({ length: 25 }, (_, index) => chunk(index, `内容 ${index}`));
    const result = hybridSearch({ query: '内容', chunks, vectorHits: [], keywordHits: chunks, limit: 20 });
    expect(result).toHaveLength(20);
  });
});
