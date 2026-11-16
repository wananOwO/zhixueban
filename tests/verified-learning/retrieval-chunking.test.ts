import { describe, expect, it } from 'vitest';
import { createRetrievalChunks } from '@/lib/verified-learning/retrieval/chunking';
import type { SourceSnapshot } from '@/lib/verified-learning/sources';

const source: SourceSnapshot = {
  sourceId: 'book', sourceRevision: 'revision', title: '教材', format: 'txt',
  chapters: [{ chapterId: 'chapter', title: '章节', paragraphs: [
    { paragraphIndex: 0, text: '', contentHash: 'empty' },
    { paragraphIndex: 1, text: '第一句。第二句。第三句。', contentHash: 'hash-1' },
  ]}],
};

describe('检索分块', () => {
  it('跳过空段并保留原段身份', () => {
    const chunks = createRetrievalChunks(source, 'v1');
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({ chapterId: 'chapter', paragraphIndex: 1, partIndex: 0, text: '第一句。第二句。第三句。', preprocessVersion: 'v1' });
  });

  it('长段按句界切分且每块不超过上限', () => {
    const long = { ...source, chapters: [{ ...source.chapters[0], paragraphs: [{ paragraphIndex: 2, text: '甲甲甲。乙乙乙。丙丙丙。丁丁丁。', contentHash: 'hash-2' }] }] };
    const chunks = createRetrievalChunks(long, 'v1', 6);
    expect(chunks.map(chunk => chunk.text)).toEqual(['甲甲甲。', '乙乙乙。', '丙丙丙。', '丁丁丁。']);
    expect(chunks.every(chunk => chunk.paragraphIndex === 2 && chunk.text.length <= 6)).toBe(true);
  });
});
