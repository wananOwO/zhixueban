import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
vi.mock('next/server', () => ({ after: vi.fn() }));
import { GET, POST } from '@/app/api/verified-learning/v1/[[...path]]/route';
import { initializeVerifiedLearning } from '@/lib/verified-learning/initialization';
import { testDirectory } from './db-fixtures';

const context = (segments: string[]) => ({ params: Promise.resolve({ path: segments }) });
function request(method: string, segments: string[], cookie?: string, extra: Record<string, string> = {}, body?: unknown) {
  const headers: Record<string, string> = { host: '127.0.0.1:3101', origin: 'http://127.0.0.1:3101', 'idempotency-key': 'k-' + Math.random(), ...extra };
  if (cookie) headers.cookie = cookie;
  if (body !== undefined && !(body instanceof FormData)) headers['content-type'] = 'application/json';
  return new Request(`http://127.0.0.1:3101/api/verified-learning/v1/${segments.join('/')}`, { method, headers, body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body) });
}
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe('任务流与轨迹路由', () => {
  it('未登录 401；登录后导入任务的流推送历史并结束，轨迹为空数组', async () => {
    const root = testDirectory();
    mkdirSync(path.join(root, 'data'));
    vi.spyOn(process, 'cwd').mockReturnValue(root);
    vi.stubEnv('DB_PATH', path.join(root, 'data/app.db'));
    vi.stubEnv('VL_LOCAL_AUTH', '1');
    const secret = randomBytes(32).toString('base64url');
    vi.stubEnv('VL_LOCAL_PASSWORD', secret);
    await initializeVerifiedLearning('data/app.db', true, root);
    const login = await POST(request('POST', ['access'], undefined, {}, { token: secret }), context(['access']));
    const cookie = login.headers.get('set-cookie')!.split(';')[0];
    const form = new FormData();
    form.set('file', new File(['# 第一章\n变量保存数据。'], 'a.md'));
    await POST(request('POST', ['textbooks'], cookie, {}, form), context(['textbooks']));
    const [job] = (await (await GET(request('GET', ['jobs'], cookie), context(['jobs']))).json()).data;

    expect((await GET(request('GET', ['jobs', job.jobId, 'stream']), context(['jobs', job.jobId, 'stream']))).status).toBe(401);
    const stream = await GET(request('GET', ['jobs', job.jobId, 'stream'], cookie, { 'last-event-id': '1' }), context(['jobs', job.jobId, 'stream']));
    expect(stream.headers.get('content-type')).toContain('text/event-stream');
    const text = await stream.text();
    expect(text).not.toContain('id: 1\n');
    expect(text).toContain('event: end');
    const trace = await GET(request('GET', ['jobs', job.jobId, 'trace'], cookie), context(['jobs', job.jobId, 'trace']));
    expect((await trace.json()).data).toEqual({ stages: [], sources: [] });
  });
});
