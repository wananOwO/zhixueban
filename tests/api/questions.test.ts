import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('@/lib/agent/question-gen', () => ({
  generateQuestions: vi.fn(async () => [{ id: 'q1', stem: 'x' }]),
}));

import { POST } from '@/app/api/questions/route';
import { getDb, resetDbForTest } from '@/lib/db';

describe('POST /api/questions', () => {
  beforeEach(() => {
    resetDbForTest();
    process.env.DB_PATH = ':memory:';
  });

  test('缺参数返回 400', async () => {
    const res = await POST(
      new Request('http://localhost/api/questions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ courseId: 'c1' }),
      }),
    );
    expect(res.status).toBe(400);
  });

  test('课程不存在返回 404', async () => {
    const res = await POST(
      new Request('http://localhost/api/questions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          courseId: 'nope',
          scope: 'knowledgePoint',
          scopeId: 'kp1',
          count: 3,
          difficulty: 'easy',
        }),
      }),
    );
    expect(res.status).toBe(404);
  });

  test('合法请求返回题目列表', async () => {
    const db = getDb(':memory:');
    db.prepare(
      "INSERT INTO textbooks (id, title, format, file_path, chapter_tree_json, created_at) VALUES ('tb1','书','txt','/a','{}','2026-10-19')",
    ).run();
    db.prepare(
      `INSERT INTO courses (id, textbook_id, goal, goal_prompt, subject_type, mode, outline_json, created_at)
       VALUES ('c1', 'tb1', '学', '', 'computer', 2, '{}', '2026-10-19')`,
    ).run();

    const res = await POST(
      new Request('http://localhost/api/questions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          courseId: 'c1',
          scope: 'knowledgePoint',
          scopeId: 'kp1',
          count: 3,
          difficulty: 'easy',
        }),
      }),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).questions).toHaveLength(1);
  });
});
