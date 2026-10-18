import { beforeEach, describe, expect, test } from 'vitest';
import { chunkChapterTree } from '@/lib/textbook/chunk';
import { searchChunks, upsertChunks } from '@/lib/rag/store';
import { getDb, resetDbForTest } from '@/lib/db';
import { makeChapter, makeParagraph, resetParagraphCounter, type ChapterTree } from '@/lib/textbook/types';

function makeTree(paragraphLengths: number[]): ChapterTree {
  resetParagraphCounter();
  const ch = makeChapter('ch1', '第一章', 1);
  for (const len of paragraphLengths) {
    ch.paragraphs.push(makeParagraph('ch1', '字'.repeat(len)));
  }
  return { title: '书', format: 'txt', chapters: [ch] };
}

describe('chunkChapterTree', () => {
  test('聚合段落且单块不超 500 字，anchor 保留', () => {
    const tree = makeTree([300, 300, 100]);
    const chunks = chunkChapterTree(tree);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    for (const c of chunks) expect(c.content.length).toBeLessThanOrEqual(500);
    expect(chunks[0].anchor.chapterId).toBe('ch1');
    expect(chunks[0].anchor.index).toBe(0);
  });

  test('单段落超 500 字时单独成块', () => {
    const tree = makeTree([800, 50]);
    const chunks = chunkChapterTree(tree);
    expect(chunks).toHaveLength(2);
    expect(chunks[0].content.length).toBe(800);
  });
});

describe('rag store', () => {
  beforeEach(() => resetDbForTest());

  test('upsert 后按向量距离检索返回正确顺序', () => {
    const db = getDb(':memory:');
    db.prepare(
      "INSERT INTO textbooks (id, title, format, file_path, chapter_tree_json, created_at) VALUES ('tb1','书','txt','/a','{}','2026-10-19')",
    ).run();
    const chunks = [
      { id: 'c1', textbookId: 'tb1', chapterId: 'ch1', content: '甲', anchor: { chapterId: 'ch1', index: 0 } },
      { id: 'c2', textbookId: 'tb1', chapterId: 'ch1', content: '乙', anchor: { chapterId: 'ch1', index: 1 } },
    ];
    const embeddings = [
      [1, 0, 0, 0],
      [0, 1, 0, 0],
    ];
    upsertChunks(db, 'tb1', chunks, embeddings);
    const hits = searchChunks(db, 'tb1', [0.9, 0.1, 0, 0], 2);
    expect(hits.map((h) => h.id)).toEqual(['c1', 'c2']);
    expect(hits[0].content).toBe('甲');
  });
});
