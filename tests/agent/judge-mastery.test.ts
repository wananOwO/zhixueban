import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('@/lib/llm/provider', () => ({ getModel: () => ({ modelId: 'fake' }) }));
const mockGenerateText = vi.fn();
vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>();
  return { ...actual, generateText: (...args: unknown[]) => mockGenerateText(...args) };
});

import { getHint, judgeAnswer } from '@/lib/agent/judge';
import { updateMastery } from '@/lib/agent/mastery';
import { getDb, resetDbForTest } from '@/lib/db';

function seedQuestion(contentJson: object, answerJson: object, type = 'choice'): string {
  const db = getDb(':memory:');
  db.prepare(
    "INSERT INTO textbooks (id, title, format, file_path, chapter_tree_json, created_at) VALUES ('tb1','书','txt','/a','{}','2026-10-19')",
  ).run();
  db.prepare(
    "INSERT INTO courses (id, textbook_id, goal, goal_prompt, subject_type, mode, outline_json, created_at) VALUES ('c1','tb1','学','','computer',2,'{}','2026-10-19')",
  ).run();
  db.prepare(
    `INSERT INTO questions (id, course_id, scope, scope_id, type, difficulty, content_json, answer_json, source_kp_ids)
     VALUES ('q1','c1','knowledgePoint','kp1',?,'easy',?,?,?)`,
  ).run(type, JSON.stringify(contentJson), JSON.stringify(answerJson), JSON.stringify(['kp1']));
  return 'q1';
}

describe('judgeAnswer', () => {
  beforeEach(() => {
    resetDbForTest();
    process.env.DB_PATH = ':memory:';
    mockGenerateText.mockReset();
    mockGenerateText.mockResolvedValue({ text: '可能是逻辑写反了。' });
  });

  test('选择题本地比对', async () => {
    seedQuestion({ stem: 's', options: ['A', 'B'] }, { answer: 'A' });
    expect((await judgeAnswer('q1', 'A')).correct).toBe(true);
    expect((await judgeAnswer('q1', 'B')).correct).toBe(false);
  });

  test('编程题以执行器结果为准', async () => {
    seedQuestion(
      { stem: '实现加法', testCases: [{ name: 'add', assert: 'add(1,2)===3' }] },
      { answer: '', referenceSolution: 'function add(a,b){return a+b}' },
      'code',
    );
    const pass = await judgeAnswer('q1', 'function add(a,b){return a+b}');
    expect(pass.correct).toBe(true);
    const fail = await judgeAnswer('q1', 'function add(a,b){return a-b}');
    expect(fail.correct).toBe(false);
  });

  test('判分结果写入 attempts', async () => {
    seedQuestion({ stem: 's', options: ['A'] }, { answer: 'A' });
    await judgeAnswer('q1', 'A');
    const db = getDb(':memory:');
    expect(db.prepare('SELECT COUNT(*) n FROM attempts').get()).toEqual({ n: 1 });
  });
});

describe('updateMastery', () => {
  beforeEach(() => {
    resetDbForTest();
    process.env.DB_PATH = ':memory:';
    const db = getDb(':memory:');
    db.prepare(
      "INSERT INTO textbooks (id, title, format, file_path, chapter_tree_json, created_at) VALUES ('tb1','书','txt','/a','{}','2026-10-19')",
    ).run();
    db.prepare(
      "INSERT INTO knowledge_points (id, textbook_id, title, chapter_ref) VALUES ('kp1','tb1','变量','ch1')",
    ).run();
  });

  test('初值 0 连对 3 次 = 0.875，达到掌握线', () => {
    const now = new Date('2026-10-19');
    updateMastery('kp1', true, now);
    updateMastery('kp1', true, now);
    const m = updateMastery('kp1', true, now);
    expect(m).toBeCloseTo(0.875);
    const db = getDb(':memory:');
    const row = db.prepare('SELECT status FROM knowledge_points WHERE id = ?').get('kp1') as {
      status: string;
    };
    expect(row.status).toBe('mastered');
  });

  test('30 天前的成绩按 exp(-1) 衰减', () => {
    const old = new Date('2026-09-19');
    updateMastery('kp1', true, old);
    updateMastery('kp1', true, old);
    updateMastery('kp1', true, old); // 0.875
    const later = new Date('2026-10-19');
    // 一次错误触发衰减后再更新
    const m = updateMastery('kp1', false, later);
    expect(m).toBeLessThan(0.875 * Math.exp(-1) * 0.5 + 0.001);
  });

  test('答错后状态回退为 learning', () => {
    const now = new Date();
    updateMastery('kp1', true, now);
    updateMastery('kp1', false, now);
    const db = getDb(':memory:');
    expect(
      (db.prepare('SELECT status FROM knowledge_points WHERE id=?').get('kp1') as { status: string })
        .status,
    ).toBe('learning');
  });
});

describe('getHint 分层提示', () => {
  beforeEach(() => {
    resetDbForTest();
    process.env.DB_PATH = ':memory:';
    mockGenerateText.mockReset();
  });

  test('四级提示粒度不同：概念→思路→步骤→完整解析', async () => {
    seedQuestion({ stem: '什么是变量？' }, { answer: '存储数据的命名空间' });
    const levels: string[] = [];
    mockGenerateText.mockImplementation(async ({ prompt }) => {
      levels.push(prompt);
      return { text: 'hint' };
    });
    await getHint('q1', 1);
    await getHint('q1', 4);
    expect(levels[0]).toContain('概念');
    expect(levels[0]).not.toContain('完整解析');
    expect(levels[1]).toContain('完整解析');
  });
});
