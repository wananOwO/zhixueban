import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('@/lib/llm/provider', () => ({
  getModel: () => ({ modelId: 'fake' }),
}));

const mockGenerateText = vi.fn();
vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>();
  return { ...actual, generateText: (...args: unknown[]) => mockGenerateText(...args) };
});

import { generateKnowledgeGraph } from '@/lib/agent/knowledge-graph';
import { getDb, resetDbForTest } from '@/lib/db';
import type { ChapterTree } from '@/lib/textbook/types';

function seedTextbook(): string {
  const db = getDb(':memory:');
  const tree: ChapterTree = {
    title: 'Python教程',
    format: 'txt',
    chapters: [
      { id: 'ch1', title: '基础', level: 1, paragraphs: [{ text: '变量与类型', anchor: { chapterId: 'ch1', index: 0 } }] },
      { id: 'ch2', title: '进阶', level: 1, paragraphs: [{ text: '函数', anchor: { chapterId: 'ch2', index: 1 } }] },
    ],
  };
  db.prepare(
    "INSERT INTO textbooks (id, title, format, file_path, chapter_tree_json, created_at) VALUES ('tb1','Python教程','txt','/a',?,'2026-10-19')",
  ).run(JSON.stringify(tree));
  return 'tb1';
}

/** 模拟模型通过工具调用提交知识点与依赖边 */
function mockToolFlow(
  points: { id: string; title: string; chapterRef: string }[],
  edges: { from: string; to: string }[],
) {
  mockGenerateText.mockImplementationOnce(async ({ tools }) => {
    for (const p of points) {
      await tools.registerKnowledgePoint.execute(p, {});
    }
    const edgeResults = [];
    for (const e of edges) {
      edgeResults.push(await tools.registerPrerequisite.execute(e, {}));
    }
    await tools.finishGraph.execute({}, {});
    return { text: 'done', edgeResults };
  });
}

describe('generateKnowledgeGraph', () => {
  beforeEach(() => {
    resetDbForTest();
    process.env.DB_PATH = ':memory:';
    mockGenerateText.mockReset();
  });

  test('知识点与前置依赖边经工具调用落库', async () => {
    seedTextbook();
    mockToolFlow(
      [
        { id: 'kp-var', title: '变量', chapterRef: 'ch1' },
        { id: 'kp-fn', title: '函数', chapterRef: 'ch2' },
      ],
      [{ from: 'kp-var', to: 'kp-fn' }],
    );
    const graph = await generateKnowledgeGraph('tb1');
    expect(graph.points).toHaveLength(2);
    expect(graph.edges).toEqual([{ fromId: 'kp-var', toId: 'kp-fn' }]);

    const db = getDb(':memory:');
    expect(db.prepare('SELECT COUNT(*) n FROM knowledge_points').get()).toEqual({ n: 2 });
    expect(db.prepare('SELECT COUNT(*) n FROM knowledge_edges').get()).toEqual({ n: 1 });
  });

  test('环形依赖边被工具拒绝（不成环）', async () => {
    seedTextbook();
    mockToolFlow(
      [
        { id: 'a', title: 'A', chapterRef: 'ch1' },
        { id: 'b', title: 'B', chapterRef: 'ch2' },
      ],
      [
        { from: 'a', to: 'b' },
        { from: 'b', to: 'a' },
      ],
    );
    const graph = await generateKnowledgeGraph('tb1');
    expect(graph.edges).toHaveLength(1);
  });
});
