import { beforeEach, describe, expect, test } from 'vitest';
import { assertDemoWritable, isDemoMode, DEMO_READ_ONLY_MSG } from '@/lib/demo';
import { PUT } from '@/app/api/settings/route';
import { POST } from '@/app/api/prompts/route';
import { resetDbForTest } from '@/lib/db';

describe('DEMO_MODE 访问边界', () => {
  beforeEach(() => {
    resetDbForTest();
    process.env.DB_PATH = ':memory:';
    delete process.env.DEMO_MODE;
  });

  test('非演示模式可写', () => {
    expect(isDemoMode()).toBe(false);
    expect(() => assertDemoWritable()).not.toThrow();
  });

  test('演示模式下写设置返回 403 中文提示', async () => {
    process.env.DEMO_MODE = 'true';
    const res = await PUT(
      new Request('http://localhost/api/settings', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mcp_servers: [] }),
      }),
    );
    expect(res.status).toBe(403);
    expect((await res.json()).error).toContain('演示模式');
  });

  test('演示模式下新建提示词返回 403', async () => {
    process.env.DEMO_MODE = 'true';
    const res = await POST(
      new Request('http://localhost/api/prompts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'x', contentMd: 'y' }),
      }),
    );
    expect(res.status).toBe(403);
  });

  test('DEMO_READ_ONLY_MSG 是中文', () => {
    expect(DEMO_READ_ONLY_MSG).toMatch(/演示/);
  });
});
