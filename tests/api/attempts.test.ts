import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('@/lib/llm/provider', () => ({ getModel: () => ({ modelId: 'fake' }) }));

import { POST } from '@/app/api/attempts/route';
import { getDb, resetDbForTest } from '@/lib/db';

describe('POST /api/attempts', () => {
  beforeEach(() => {
    resetDbForTest();
    process.env.DB_PATH = ':memory:';
  });

  test('缺少参数返回 400', async () => {
    const res = await POST(
      new Request('http://localhost/api/attempts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      }),
    );
    expect(res.status).toBe(400);
  });

  test('提交答案返回判分结果', async () => {
    const db = getDb(':memory:');
    db.prepare(
      "INSERT INTO textbooks (id, title, format, file_path, chapter_tree_json, created_at) VALUES ('tb1','书','txt','/a','{}','2026-10-19')",
    ).run();
    db.prepare(
      "INSERT INTO courses (id, textbook_id, goal, goal_prompt, subject_type, mode, outline_json, created_at) VALUES ('c1','tb1','学','','computer',2,'{}','2026-10-19')",
    ).run();
    db.prepare(
      `INSERT INTO questions (id, course_id, scope, scope_id, type, difficulty, content_json, answer_json, source_kp_ids)
       VALUES ('q1','c1','knowledgePoint','kp1','choice','easy','{"stem":"s","options":["A","B"]}','{"answer":"A"}','[]')`,
    ).run();

    const res = await POST(
      new Request('http://localhost/api/attempts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ questionId: 'q1', answer: 'A' }),
      }),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).correct).toBe(true);
  });
});
