import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('@/lib/llm/provider', () => ({
  getModel: () => ({ modelId: 'fake' }),
  getEmbeddingModel: () => ({ modelId: 'fake-emb' }),
}));
vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>();
  return {
    ...actual,
    embed: async () => ({ embedding: [1, 0, 0, 0] }),
    streamText: vi.fn((args: unknown) => ({ args, textStream: (async function* () {})() })),
  };
});

import { buildLessonPrompt, parseSourceRefs, streamLesson } from '@/lib/agent/lesson-writer';
import { getDb, resetDbForTest } from '@/lib/db';
import { upsertChunks } from '@/lib/rag/store';

describe('parseSourceRefs', () => {
  test('提取 [src:章节:序号] 来源标记', () => {
    const text = '变量是容器[src:ch1:0]。\n函数可复用[src:ch2:3]。';
    expect(parseSourceRefs(text)).toEqual([
      { chapterId: 'ch1', index: 0 },
      { chapterId: 'ch2', index: 3 },
    ]);
  });

  test('无标记返回空数组', () => {
    expect(parseSourceRefs('纯模型发挥内容')).toEqual([]);
  });
});

describe('buildLessonPrompt', () => {
  test('包含检索到的教材锚点片段与学科提示词', () => {
    const prompt = buildLessonPrompt({
      kpTitle: '变量',
      subjectPrompt: '计算机类提示词',
      goalPrompt: '零基础',
      anchors: [{ content: '变量是存储数据的容器。', chapterId: 'ch1', index: 0 }],
    });
    expect(prompt).toContain('计算机类提示词');
    expect(prompt).toContain('变量是存储数据的容器');
    expect(prompt).toContain('[src:ch1:0]');
    expect(prompt).toContain('零基础');
  });
});

describe('streamLesson', () => {
  beforeEach(() => {
    resetDbForTest();
    process.env.DB_PATH = ':memory:';
  });

  test('检索限定该知识点的教材分块并调用 streamText', async () => {
    const db = getDb(':memory:');
    db.prepare(
      "INSERT INTO textbooks (id, title, format, file_path, chapter_tree_json, created_at) VALUES ('tb1','书','txt','/a','{}','2026-10-19')",
    ).run();
    upsertChunks(
      db,
      'tb1',
      [{ id: 'c1', chapterId: 'ch1', content: '变量是容器', anchor: { chapterId: 'ch1', index: 0 } }],
      [[1, 0, 0, 0]],
    );
    const result = await streamLesson({
      courseId: 'c1',
      kpId: 'kp-var',
      kpTitle: '变量',
      textbookId: 'tb1',
      subjectType: 'computer',
      goalPrompt: '',
    });
    expect(result).toBeTruthy();
  });
});
