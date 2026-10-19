import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('@/lib/llm/provider', () => ({ getModel: () => ({ modelId: 'fake' }) }));
vi.mock('@/lib/llm/prompts', () => ({ loadSubjectPrompt: () => '学科提示词' }));

const mockGenerateText = vi.fn();
vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>();
  return { ...actual, generateText: (...args: unknown[]) => mockGenerateText(...args) };
});

import { composeCourse } from '@/lib/agent/course-composer';
import { getDb, resetDbForTest } from '@/lib/db';

function seedGraph(): void {
  const db = getDb(':memory:');
  db.prepare(
    "INSERT INTO textbooks (id, title, format, file_path, chapter_tree_json, created_at) VALUES ('tb1','Python教程','txt','/a','{}','2026-10-19')",
  ).run();
  const ins = db.prepare(
    "INSERT INTO knowledge_points (id, textbook_id, title, chapter_ref) VALUES (?, 'tb1', ?, 'ch1')",
  );
  ins.run('kp-var', '变量');
  ins.run('kp-fn', '函数');
  ins.run('kp-algo', '算法');
  ins.run('kp-game', '小游戏项目');
  const edge = db.prepare('INSERT INTO knowledge_edges (from_id, to_id) VALUES (?, ?)');
  edge.run('kp-var', 'kp-fn');
  edge.run('kp-fn', 'kp-algo');
}

function mockOutline(nodes: string[], gaps: string[] = []) {
  mockGenerateText.mockImplementationOnce(async ({ tools }) => {
    await tools.submitCourseOutline.execute(
      {
        nodes: nodes.map((kpId) => ({ kpId, depth: 'normal' })),
        gaps,
        kept: nodes,
        excluded: ['kp-game'].filter((x) => !nodes.includes(x)),
        reorderReason: '按先修拓扑排序',
        supplements: [],
      },
      {},
    );
    return { text: 'done' };
  });
}

describe('composeCourse', () => {
  beforeEach(() => {
    resetDbForTest();
    process.env.DB_PATH = ':memory:';
    mockGenerateText.mockReset();
  });

  test('按目标裁剪：大纲不含被排除知识点，课程落库', async () => {
    seedGraph();
    mockOutline(['kp-var', 'kp-fn', 'kp-algo']);
    const course = await composeCourse({
      textbookId: 'tb1',
      goal: '只学语法和算法，参加算法比赛',
      goalPrompt: '零基础小白',
      subjectType: 'computer',
      mode: 2,
    });
    const kpIds = course.outline.map((n) => n.kpId);
    expect(kpIds).not.toContain('kp-game');
    expect(course.gaps).toEqual([]);

    const db = getDb(':memory:');
    const row = db.prepare('SELECT outline_json FROM courses WHERE id = ?').get(course.id) as {
      outline_json: string;
    };
    expect(JSON.parse(row.outline_json).nodes.length).toBe(3);
  });

  test('大纲顺序被本地拓扑校验修正（变量在算法之前）', async () => {
    seedGraph();
    mockOutline(['kp-algo', 'kp-var']); // 故意乱序：algo 依赖 fn 依赖 var
    const course = await composeCourse({
      textbookId: 'tb1',
      goal: '算法',
      goalPrompt: '',
      subjectType: 'computer',
      mode: 1,
    });
    const kpIds = course.outline.map((n) => n.kpId);
    expect(kpIds.indexOf('kp-var')).toBeLessThan(kpIds.indexOf('kp-algo'));
  });

  test('教材缺口：目标要求但图谱没有的内容进入 gaps', async () => {
    seedGraph();
    mockOutline(['kp-var'], ['机器学习：教材未覆盖']);
    const course = await composeCourse({
      textbookId: 'tb1',
      goal: '学语法和机器学习',
      goalPrompt: '',
      subjectType: 'computer',
      mode: 1,
    });
    expect(course.gaps).toContain('机器学习：教材未覆盖');
  });
});
