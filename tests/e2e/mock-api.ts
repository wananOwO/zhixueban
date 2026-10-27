import type { Page, Route } from '@playwright/test';

/**
 * 端到端测试的接口模拟：按「方法 + 路径」注册处理函数，未注册的接口返回 404 信封。
 * 处理函数返回 { status, data } 或 { status, error } 或原始 Response 初始化对象。
 */
export type Handler = (request: { method: string; path: string; url: URL; body: unknown; headers: Record<string, string> }) =>
  | { status?: number; data?: unknown; error?: { code: string; message: string; retryable?: boolean } }
  | { raw: { status?: number; contentType: string; body: string } }
  | Promise<{ status?: number; data?: unknown; error?: { code: string; message: string; retryable?: boolean } } | { raw: { status?: number; contentType: string; body: string } }>;

export async function mockApi(page: Page, routes: Record<string, Handler>, calls: { method: string; path: string; body: unknown; headers: Record<string, string> }[] = []) {
  await page.route('**/api/verified-learning/v1/**', async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^.*\/api\/verified-learning\/v1/, '') || '/';
    const method = request.method();
    let body: unknown = null;
    const type = request.headers()['content-type'] ?? '';
    if (method !== 'GET' && type.includes('application/json')) {
      try { body = request.postDataJSON(); } catch { body = request.postData(); }
    }
    calls.push({ method, path, body, headers: request.headers() });
    const key = Object.keys(routes).find(pattern => {
      const [m, p] = pattern.split(' ');
      if (m !== method) return false;
      const regex = new RegExp(`^${p.replace(/:[^/]+/g, '[^/]+')}$`);
      return regex.test(path);
    });
    if (!key) {
      await route.fulfill({ status: 404, json: { contractVersion: 1, requestId: 'e2e', error: { code: 'NOT_FOUND', message: `未模拟的接口 ${method} ${path}` } } });
      return;
    }
    const result = await routes[key]({ method, path, url, body, headers: request.headers() });
    if ('raw' in result) {
      await route.fulfill({ status: result.raw.status ?? 200, contentType: result.raw.contentType, body: result.raw.body });
      return;
    }
    const status = result.status ?? 200;
    await route.fulfill({
      status,
      json: result.error ? { contractVersion: 1, requestId: 'e2e', error: { retryable: false, ...result.error } } : { contractVersion: 1, requestId: 'e2e', data: result.data },
    });
  });
  return calls;
}

/** 本地模式、已登录的基础接口 */
export const baseRoutes: Record<string, Handler> = {
  'GET /mode': () => ({ data: { mode: 'local', uploadLimitBytes: 50 * 1024 * 1024, booksPerSpace: null } }),
  'GET /access': () => ({ data: { authenticated: true } }),
  'GET /jobs': () => ({ data: [] }),
  'GET /courses': () => ({ data: [] }),
  'GET /drafts': () => ({ data: [] }),
};

export const book = (overrides: Partial<Record<string, unknown>> = {}) => ({
  bookId: 'b1', title: 'Python 官方教程', format: 'md', status: 'ready', archived: false, revision: 0,
  sourceRevision: 'r1', createdAt: '2026-10-27T08:00:00.000Z',
  chapters: [{ id: 'ch1', title: '第一章 课前甜点', characterCount: 1200 }, { id: 'ch2', title: '第二章 使用解释器', characterCount: 3400 }],
  ...overrides,
});
