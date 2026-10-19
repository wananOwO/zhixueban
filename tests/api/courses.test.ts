import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('@/lib/agent/course-composer', () => ({
  composeCourse: vi.fn(async () => ({
    id: 'course-1',
    outline: [{ kpId: 'kp-var', depth: 'normal' }],
    gaps: [],
  })),
}));

import { GET } from '@/app/api/textbooks/route';
import { POST } from '@/app/api/courses/route';
import { getDb, resetDbForTest } from '@/lib/db';

describe('GET /api/textbooks', () => {
  beforeEach(() => {
    resetDbForTest();
    process.env.DB_PATH = ':memory:';
  });

  test('返回教材列表', async () => {
    const db = getDb(':memory:');
    db.prepare(
      "INSERT INTO textbooks (id, title, format, file_path, chapter_tree_json, created_at) VALUES ('tb1','Python教程','txt','/a','{}','2026-10-19')",
    ).run();
    const res = await GET();
    const body = await res.json();
    expect(body.textbooks).toHaveLength(1);
    expect(body.textbooks[0].title).toBe('Python教程');
  });
});

describe('POST /api/courses', () => {
  beforeEach(() => {
    resetDbForTest();
    process.env.DB_PATH = ':memory:';
  });

  test('缺少 goal 返回 400 中文错误', async () => {
    const res = await POST(
      new Request('http://localhost/api/courses', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ textbookId: 'tb1', subjectType: 'computer', mode: 1 }),
      }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/学习目标/);
  });

  test('mode 非法返回 400', async () => {
    const res = await POST(
      new Request('http://localhost/api/courses', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ textbookId: 'tb1', goal: '学算法', subjectType: 'computer', mode: 9 }),
      }),
    );
    expect(res.status).toBe(400);
  });

  test('合法请求返回课程与大纲', async () => {
    const res = await POST(
      new Request('http://localhost/api/courses', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          textbookId: 'tb1',
          goal: '学语法和算法',
          goalPrompt: '零基础',
          subjectType: 'computer',
          mode: 2,
        }),
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.courseId).toBe('course-1');
    expect(body.outline).toHaveLength(1);
  });
});
