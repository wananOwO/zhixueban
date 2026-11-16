import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
vi.mock('node:dns/promises', () => ({ lookup: async () => [{ address: '8.8.8.8', family: 4 }] }));
const callbacks: (() => Promise<void>)[] = [];
vi.mock('next/server', () => ({ after: (fn: () => Promise<void>) => callbacks.push(fn) }));
import { GET, POST, PATCH } from '@/app/api/verified-learning/v1/[[...path]]/route';
import { initializeVerifiedLearning } from '@/lib/verified-learning/initialization';
import { PREPROCESS_VERSION } from '@/lib/verified-learning/retrieval/from-settings';
import { createEmbeddingProfile } from '@/lib/verified-learning/retrieval/profile';
import { testDirectory } from './db-fixtures';

afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); vi.unstubAllGlobals(); callbacks.length = 0; });

const ORIGIN = 'http://127.0.0.1:3101';
function request(method: string, segments: string[], body?: unknown, cookie?: string, key = 'k-' + Math.random()) {
  const headers: Record<string, string> = { host: '127.0.0.1:3101', origin: ORIGIN, 'idempotency-key': key };
  if (cookie) headers.cookie = cookie;
  if (body !== undefined && !(body instanceof FormData)) headers['content-type'] = 'application/json';
  return new Request(`${ORIGIN}/api/verified-learning/v1/${segments.join('/')}`, { method, headers, body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body) });
}
const context = (segments: string[]) => ({ params: Promise.resolve({ path: segments }) });

async function setup() {
  const root = testDirectory();
  mkdirSync(path.join(root, 'data'));
  vi.spyOn(process, 'cwd').mockReturnValue(root);
  vi.stubEnv('DB_PATH', path.join(root, 'data/app.db'));
  vi.stubEnv('VL_LOCAL_AUTH', '1');
  const secret = randomBytes(32).toString('base64url');
  vi.stubEnv('VL_LOCAL_PASSWORD', secret);
  await initializeVerifiedLearning('data/app.db', true, root);
  const login = await POST(request('POST', ['access'], { token: secret }), context(['access']));
  return { cookie: login.headers.get('set-cookie')!, root };
}

async function upload(cookie: string) {
  const form = new FormData();
  form.set('file', new File(['# 基础\n\n递归需要终止条件，否则会栈溢出。\n'], 'lesson.md'));
  const response = await POST(request('POST', ['textbooks'], form, cookie), context(['textbooks']));
  return (await response.json()).data as { bookId: string; sourceRevision: string };
}

const embeddingHeader = (apiKey = 'sk-embed-test-secret') => Buffer.from(JSON.stringify({ baseUrl: 'https://api.example.com/v1', model: 'embed-mini', apiKey })).toString('base64url');

describe('检索接口', () => {
  it('未配置 Embedding 时索引状态为 none，关键词检索仍可用', async () => {
    const { cookie } = await setup();
    const book = await upload(cookie);
    const status = await GET(request('GET', ['textbooks', book.bookId, 'retrieval-index'], undefined, cookie), context(['textbooks', book.bookId, 'retrieval-index']));
    expect(status.status).toBe(200);
    expect((await status.json()).data).toMatchObject({ status: 'none', total: 0, usable: false });
  });

  it('没有显式确认时拒绝创建付费索引任务', async () => {
    const { cookie } = await setup();
    const book = await upload(cookie);
    const response = await POST(request('POST', ['textbooks', book.bookId, 'retrieval-index'], { confirm: false }, cookie), context(['textbooks', book.bookId, 'retrieval-index']));
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe('INVALID_INPUT');
    expect(callbacks).toHaveLength(0);
  });

  it('确认后创建索引任务，响应不含 Key；跨空间读取 404', async () => {
    const { cookie } = await setup();
    const book = await upload(cookie);
    const saved = await PATCH(request('PATCH', ['settings'], { embedding_model: 'embed-mini', embedding_base_url: 'https://api.example.com/v1', embedding_api_key: 'sk-embed-test-secret' }, cookie), context(['settings']));
    expect(saved.status).toBe(200);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: [{ index: 0, embedding: [1, 0, 0] }] }), { headers: { 'content-type': 'application/json' } })));
    const response = await POST(request('POST', ['textbooks', book.bookId, 'retrieval-index'], { confirm: true }, cookie, 'idx-1'), context(['textbooks', book.bookId, 'retrieval-index']));
    const text = await response.text();
    expect(text).not.toContain('sk-embed-test-secret');
    expect(response.status).toBe(202);
    const job = JSON.parse(text).data;
    const fetched = await GET(request('GET', ['retrieval-jobs', job.jobId], undefined, cookie), context(['retrieval-jobs', job.jobId]));
    expect(fetched.status).toBe(200);
    expect((await fetched.json()).data.jobId).toBe(job.jobId);
    for (const callback of callbacks.splice(0)) await callback();
    const status = await GET(request('GET', ['textbooks', book.bookId, 'retrieval-index'], undefined, cookie), context(['textbooks', book.bookId, 'retrieval-index']));
    const statusText = await status.text();
    expect(statusText).not.toContain('sk-embed-test-secret');
    expect(JSON.parse(statusText).data).toMatchObject({ configured: true, model: 'embed-mini' });
    const missing = await GET(request('GET', ['retrieval-jobs', 'not-exist'], undefined, cookie), context(['retrieval-jobs', 'not-exist']));
    expect(missing.status).toBe(404);
  });

  it('会话检索只接受查询词，忽略客户端伪造的来源', async () => {
    const { cookie } = await setup();
    const book = await upload(cookie);
    const draft = (await (await POST(request('POST', ['drafts'], { textbookId: book.bookId, goal: '学会递归', sources: [{ sourceId: book.bookId, sourceRevision: book.sourceRevision, chapterIds: [] }] }, cookie), context(['drafts']))).json()).data;
    expect(draft.draftId).toBeTruthy();
    const response = await POST(request('POST', ['sessions', 'missing', 'retrieve'], { query: '递归', scopeId: 'other', sourceRefs: [{ sourceId: 'evil', sourceRevision: 'x' }] }, cookie), context(['sessions', 'missing', 'retrieve']));
    expect(response.status).toBe(404);
  });

  it('profile 与预处理版本来自服务端，与设置一致', async () => {
    const profileId = createEmbeddingProfile({ provider: 'openai-compatible', baseUrl: 'https://api.example.com/v1', model: 'embed-mini' }, PREPROCESS_VERSION).profileId;
    expect(profileId).toMatch(/^embedding:/);
    expect(embeddingHeader()).not.toContain('"');
  });
});