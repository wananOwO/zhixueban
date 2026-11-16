import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
vi.mock('next/server', () => ({ after: vi.fn() }));
import { GET, POST, DELETE } from '@/app/api/verified-learning/v1/[[...path]]/route';
import { initializeVerifiedLearning } from '@/lib/verified-learning/initialization';
import { readMode } from '@/lib/verified-learning/mode';
import { resetOnlineLoginLimit } from '@/lib/verified-learning/online-access';
import { testDirectory } from './db-fixtures';

const ORIGIN = 'https://learn.example.cn';
const CODE = 'judge-code-2026';
const context = (segments: string[]) => ({ params: Promise.resolve({ path: segments }) });
function request(method: string, segments: string[], options: { body?: unknown; cookie?: string; origin?: string | null; ip?: string; host?: string } = {}) {
  const headers: Record<string, string> = { host: options.host ?? 'learn.example.cn', 'x-real-ip': options.ip ?? '198.51.100.7' };
  const origin = options.origin === undefined ? ORIGIN : options.origin;
  if (origin) headers.origin = origin;
  if (options.cookie) headers.cookie = options.cookie;
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  return new Request(`${ORIGIN}/api/verified-learning/v1/${segments.join('/')}`, {
    method, headers, body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
}
/** 把 Set-Cookie 列表转成下一次请求用的 Cookie 头 */
function cookieHeader(response: Response): string {
  return response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
}
function cookieValue(response: Response, name: string): string | undefined {
  return response.headers.getSetCookie().map(value => value.split(';')[0]).find(pair => pair.startsWith(`${name}=`))?.slice(name.length + 1);
}

async function setup() {
  const root = testDirectory();
  mkdirSync(path.join(root, 'data'));
  vi.spyOn(process, 'cwd').mockReturnValue(root);
  vi.stubEnv('DB_PATH', path.join(root, 'data/app.db'));
  vi.stubEnv('VL_MODE', 'online');
  vi.stubEnv('VL_PUBLIC_ORIGIN', ORIGIN);
  vi.stubEnv('VL_ACCESS_CODE', CODE);
  await initializeVerifiedLearning('data/app.db', true, root);
  return root;
}
async function login(options: { cookie?: string; ip?: string } = {}) {
  return POST(request('POST', ['access'], { body: { token: CODE }, ...options }), context(['access']));
}
beforeEach(() => resetOnlineLoginLimit());
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe('线上模式配置', () => {
  it('缺少公网地址或访问码时拒绝启动线上模式', () => {
    expect(readMode({})).toMatchObject({ mode: 'local' });
    expect(() => readMode({ VL_MODE: 'online', VL_ACCESS_CODE: CODE })).toThrow(expect.objectContaining({ code: 'DISABLED' }));
    expect(() => readMode({ VL_MODE: 'online', VL_PUBLIC_ORIGIN: 'http://learn.example.cn', VL_ACCESS_CODE: CODE })).toThrow(expect.objectContaining({ code: 'DISABLED' }));
    expect(() => readMode({ VL_MODE: 'online', VL_PUBLIC_ORIGIN: `${ORIGIN}/app`, VL_ACCESS_CODE: CODE })).toThrow(expect.objectContaining({ code: 'DISABLED' }));
    expect(() => readMode({ VL_MODE: 'online', VL_PUBLIC_ORIGIN: ORIGIN, VL_ACCESS_CODE: 'short' })).toThrow(expect.objectContaining({ code: 'DISABLED' }));
    expect(readMode({ VL_MODE: 'online', VL_PUBLIC_ORIGIN: ORIGIN, VL_ACCESS_CODE: CODE })).toEqual({ mode: 'online', publicOrigin: ORIGIN, accessCode: CODE });
  });
});

describe('线上模式访问码登录与浏览器空间', () => {
  it('GET /mode 不需登录并返回线上配额', async () => {
    await setup();
    const response = await GET(request('GET', ['mode'], { origin: null }), context(['mode']));
    expect(response.status).toBe(200);
    expect((await response.json()).data).toEqual({ mode: 'online', authRequired: true, uploadLimitBytes: 20 * 1024 * 1024, booksPerSpace: 10 });
  });

  it('访问码错误返回 401；同一 IP 第 6 次尝试返回 429', async () => {
    await setup();
    for (let i = 0; i < 5; i++) {
      const response = await POST(request('POST', ['access'], { body: { token: 'wrong-code' } }), context(['access']));
      expect(response.status).toBe(401);
    }
    expect((await login()).status).toBe(429);
    // 其他 IP 不受影响
    expect((await login({ ip: '203.0.113.9' })).status).toBe(200);
  });

  it('首次登录下发 Secure HttpOnly 的会话与空间 cookie，并能访问业务接口', async () => {
    await setup();
    const response = await login();
    expect(response.status).toBe(200);
    const cookies = response.headers.getSetCookie();
    expect(cookies).toHaveLength(2);
    for (const value of cookies) {
      expect(value).toContain('Secure');
      expect(value).toContain('HttpOnly');
      expect(value).toContain('SameSite=Lax');
    }
    expect(cookieValue(response, 'vl_space')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const access = await GET(request('GET', ['access'], { cookie: cookieHeader(response), origin: null }), context(['access']));
    expect(access.status).toBe(200);
    const books = await GET(request('GET', ['textbooks'], { cookie: cookieHeader(response), origin: null }), context(['textbooks']));
    expect(books.status).toBe(200);
    expect((await books.json()).data).toEqual([]);
  });

  it('带着原空间 cookie 重新登录回到原空间；不带则新建空间', async () => {
    await setup();
    const first = await login();
    const space = cookieValue(first, 'vl_space');
    const again = await login({ cookie: `vl_space=${space}` });
    expect(cookieValue(again, 'vl_space')).toBe(space);
    const other = await login();
    expect(cookieValue(other, 'vl_space')).not.toBe(space);
    // 伪造的空间 ID 不被采用
    const forged = await login({ cookie: `vl_space=${'x'.repeat(43)}` });
    expect(cookieValue(forged, 'vl_space')).not.toBe('x'.repeat(43));
  });

  it('跨站或外部来源的请求被拒绝', async () => {
    await setup();
    const evil = await POST(request('POST', ['access'], { body: { token: CODE }, origin: 'https://evil.example' }), context(['access']));
    expect(evil.status).toBe(403);
    const missingOrigin = await POST(request('POST', ['access'], { body: { token: CODE }, origin: null }), context(['access']));
    expect(missingOrigin.status).toBe(403);
    const wrongHost = await POST(request('POST', ['access'], { body: { token: CODE }, host: 'evil.example' }), context(['access']));
    expect(wrongHost.status).toBe(403);
  });

  it('退出登录清除会话 cookie，但保留空间 cookie 以便回到原空间', async () => {
    await setup();
    const first = await login();
    const response = await DELETE(request('DELETE', ['access'], { cookie: cookieHeader(first) }), context(['access']));
    expect(response.status).toBe(200);
    const cleared = response.headers.getSetCookie();
    expect(cleared.some(value => value.startsWith('vl_session=;') && value.includes('Max-Age=0'))).toBe(true);
    expect(cleared.some(value => value.startsWith('vl_space='))).toBe(false);
    const access = await GET(request('GET', ['access'], { cookie: cookieHeader(first), origin: null }), context(['access']));
    expect(access.status).toBe(401);
  });

  it('本地模式下 /mode 返回 local，原有本机访问不受影响', async () => {
    await setup();
    vi.stubEnv('VL_MODE', '');
    vi.stubEnv('VL_LOCAL_AUTH', '1');
    vi.stubEnv('VL_LOCAL_PASSWORD', 'a'.repeat(43));
    const local = new Request('http://127.0.0.1:3101/api/verified-learning/v1/mode', { headers: { host: '127.0.0.1:3101' } });
    const response = await GET(local, context(['mode']));
    expect((await response.json()).data).toEqual({ mode: 'local', authRequired: true, uploadLimitBytes: 50 * 1024 * 1024, booksPerSpace: null });
  });
});
