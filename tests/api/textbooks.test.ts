import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('@/lib/llm/provider', () => ({
  getEmbeddingModel: () => ({ modelId: 'fake-embedding' }),
}));

vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>();
  return {
    ...actual,
    embedMany: async ({ values }: { values: string[] }) => ({
      embeddings: values.map(() => [1, 0, 0, 0]),
    }),
  };
});

import { POST } from '@/app/api/textbooks/route';
import { getDb, resetDbForTest } from '@/lib/db';

function makeTxtUpload(filename: string, content: string): Request {
  const form = new FormData();
  form.append('file', new File([content], filename, { type: 'text/plain' }));
  return new Request('http://localhost/api/textbooks', { method: 'POST', body: form });
}

describe('POST /api/textbooks', () => {
  beforeEach(() => {
    resetDbForTest();
    process.env.DB_PATH = ':memory:';
  });

  test('上传 txt 成功：返回 textbookId 且分块入库', async () => {
    const res = await POST(makeTxtUpload('python.txt', '第一章 基础\n变量与类型。\n第二章 进阶\n函数。'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.textbookId).toBeTruthy();
    expect(body.chapterCount).toBe(2);

    const db = getDb(':memory:');
    const chunks = db.prepare('SELECT COUNT(*) AS n FROM chunks').get() as { n: number };
    expect(chunks.n).toBeGreaterThan(0);
  });

  test('非法扩展名返回 400 中文错误', async () => {
    const res = await POST(makeTxtUpload('恶意.exe', 'x'));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/不支持/);
  });

  test('缺少文件返回 400', async () => {
    const res = await POST(new Request('http://localhost/api/textbooks', { method: 'POST', body: new FormData() }));
    expect(res.status).toBe(400);
  });
});
