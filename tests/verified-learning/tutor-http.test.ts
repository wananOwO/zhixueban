import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
vi.mock('next/server', () => ({ after: vi.fn() }));
// 模型地址的域名解析为公网地址（不走真实 DNS）
vi.mock('node:dns/promises', () => ({ lookup: async () => [{ address: '8.8.8.8', family: 4 }] }));
import { POST } from '@/app/api/verified-learning/v1/[[...path]]/route';
import { initializeVerifiedLearning } from '@/lib/verified-learning/initialization';
import { resetOnlineLoginLimit } from '@/lib/verified-learning/online-access';
import { encodeModelHeader } from '@/lib/verified-learning/model-keys';
import { testDirectory } from './db-fixtures';

const ORIGIN = 'https://learn.example.cn';
const context = (segments: string[]) => ({ params: Promise.resolve({ path: segments }) });
let cookie = '';
function request(segments: string[], body: unknown, extra: Record<string, string> = {}) {
  return new Request(`${ORIGIN}/api/verified-learning/v1/${segments.join('/')}`, {
    method: 'POST', headers: { host: 'learn.example.cn', origin: ORIGIN, cookie, 'content-type': 'application/json', 'x-real-ip': '1.1.1.1', ...extra },
    body: JSON.stringify(body),
  });
}
beforeEach(async () => {
  resetOnlineLoginLimit();
  const root = testDirectory();
  mkdirSync(path.join(root, 'data'));
  vi.spyOn(process, 'cwd').mockReturnValue(root);
  vi.stubEnv('DB_PATH', path.join(root, 'data/app.db'));
  vi.stubEnv('VL_MODE', 'online');
  vi.stubEnv('VL_PUBLIC_ORIGIN', ORIGIN);
  vi.stubEnv('VL_ACCESS_CODE', 'judge-code-2026');
  await initializeVerifiedLearning('data/app.db', true, root);
  const login = await POST(request(['access'], { token: 'judge-code-2026' }), context(['access']));
  cookie = login.headers.getSetCookie().map(v => v.split(';')[0]).join('; ');
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe('助教接口', () => {
  const messages = [{ id: 'u1', role: 'user', parts: [{ type: 'text', text: '什么是变量？' }] }];
  it('线上模式没有模型 Key 返回 400 MODEL_KEY_REQUIRED', async () => {
    const response = await POST(request(['sessions', 'missing', 'tutor'], { messages }), context(['sessions', 'missing', 'tutor']));
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe('MODEL_KEY_REQUIRED');
  });
  it('超过 20 条消息返回 400；不属于本空间的会话返回 404', async () => {
    const header = { 'x-vl-model': encodeModelHeader({ provider: 'openai-compatible', baseUrl: 'https://api.deepseek.com/v1', apiKey: 'sk-x', model: 'deepseek-chat' }) };
    const many = Array.from({ length: 21 }, (_, i) => ({ id: `m${i}`, role: 'user', parts: [{ type: 'text', text: 'hi' }] }));
    expect((await POST(request(['sessions', 'missing', 'tutor'], { messages: many }, header), context(['sessions', 'missing', 'tutor']))).status).toBe(400);
    expect((await POST(request(['sessions', 'missing', 'tutor'], { messages }, header), context(['sessions', 'missing', 'tutor']))).status).toBe(404);
  });
});
