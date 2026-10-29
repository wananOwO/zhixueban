import { mkdirSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
const callbacks: (() => Promise<void>)[] = [];
vi.mock('next/server', () => ({ after: (fn: () => Promise<void>) => callbacks.push(fn) }));
// 线上模式会解析模型地址的域名并拒绝内网：测试里不走真实 DNS，统一解析为公网地址
vi.mock('node:dns/promises', () => ({ lookup: async () => [{ address: '8.8.8.8', family: 4 }] }));
import { GET, POST, PATCH } from '@/app/api/verified-learning/v1/[[...path]]/route';
import { initializeVerifiedLearning } from '@/lib/verified-learning/initialization';
import { resetOnlineLoginLimit } from '@/lib/verified-learning/online-access';
import { encodeModelHeader, forgetJobKey, jobKey, parseModelHeader, rememberJobKey, allSecrets, type ModelConfig } from '@/lib/verified-learning/model-keys';
import { createAgentConnection } from '@/lib/verified-learning/agent/provider';
import { redact } from '@/lib/verified-learning/provider-error';
import { testDirectory } from './db-fixtures';

const ORIGIN = 'https://learn.example.cn';
const CODE = 'judge-code-2026';
const SECRET = 'sk-online-browser-only-7f3a9c';
const config: ModelConfig = { provider: 'openai-compatible', baseUrl: 'https://api.deepseek.com/v1', apiKey: SECRET, model: 'deepseek-chat' };
const context = (segments: string[]) => ({ params: Promise.resolve({ path: segments }) });

describe('模型配置请求头', () => {
  afterEach(() => forgetJobKey('s', 'j'));
  it('编码后可还原；非法或超长值拒绝', () => {
    expect(parseModelHeader(encodeModelHeader(config))).toEqual(config);
    expect(parseModelHeader(null)).toBeNull();
    for (const bad of ['%%%', Buffer.from('{"provider":"x"}').toString('base64url'), Buffer.from(JSON.stringify({ ...config, baseUrl: 'javascript:alert(1)' })).toString('base64url'), 'a'.repeat(9000)]) {
      expect(() => parseModelHeader(bad)).toThrow(expect.objectContaining({ code: 'INVALID_INPUT' }));
    }
  });
  it('内存 Key 表按空间与任务登记、读取与清除，并参与日志遮蔽', () => {
    rememberJobKey('s', 'j', config);
    expect(jobKey('s', 'j')).toEqual(config);
    expect(jobKey('other', 'j')).toBeUndefined();
    expect(allSecrets()).toContain(SECRET);
    expect(redact(`401 invalid key ${SECRET}`)).not.toContain(SECRET);
    forgetJobKey('s', 'j');
    expect(jobKey('s', 'j')).toBeUndefined();
    expect(allSecrets()).not.toContain(SECRET);
  });
  it('线上模式下没有传入配置时，Agent 连接报 MODEL_KEY_REQUIRED', () => {
    vi.stubEnv('VL_MODE', 'online');
    expect(() => createAgentConnection()).toThrow(expect.objectContaining({ code: 'MODEL_KEY_REQUIRED' }));
    expect(createAgentConnection(config).model.id).toBe('deepseek-chat');
    vi.unstubAllEnvs();
  });
});

describe('线上模式：Key 只在浏览器与服务器内存', () => {
  let root: string;
  let cookie: string;
  function request(method: string, segments: string[], body?: unknown, extra: Record<string, string> = {}) {
    const headers: Record<string, string> = { host: 'learn.example.cn', origin: ORIGIN, cookie, 'idempotency-key': 'k-' + Math.random(), 'x-real-ip': '198.51.100.7', ...extra };
    if (body !== undefined && !(body instanceof FormData)) headers['content-type'] = 'application/json';
    return new Request(`${ORIGIN}/api/verified-learning/v1/${segments.join('/')}`, { method, headers, body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body) });
  }
  beforeEach(async () => {
    callbacks.length = 0;
    resetOnlineLoginLimit();
    root = testDirectory();
    mkdirSync(path.join(root, 'data'));
    vi.spyOn(process, 'cwd').mockReturnValue(root);
    vi.stubEnv('DB_PATH', path.join(root, 'data/app.db'));
    vi.stubEnv('VL_MODE', 'online');
    vi.stubEnv('VL_PUBLIC_ORIGIN', ORIGIN);
    vi.stubEnv('VL_ACCESS_CODE', CODE);
    await initializeVerifiedLearning('data/app.db', true, root);
    const login = await POST(new Request(`${ORIGIN}/api/verified-learning/v1/access`, {
      method: 'POST', headers: { host: 'learn.example.cn', origin: ORIGIN, 'content-type': 'application/json', 'x-real-ip': '198.51.100.7' }, body: JSON.stringify({ token: CODE }),
    }), context(['access']));
    cookie = login.headers.getSetCookie().map(v => v.split(';')[0]).join('; ');
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  async function draftReady(): Promise<{ draftId: string; revision: number }> {
    const form = new FormData();
    form.set('file', new File(['# 基础\n变量用于保存数据。'], 'intro.md'));
    const book = (await (await POST(request('POST', ['textbooks'], form), context(['textbooks']))).json()).data;
    const source = (await (await GET(request('GET', ['textbooks', book.bookId, 'source']), context(['textbooks', book.bookId, 'source']))).json()).data;
    const draft = (await (await POST(request('POST', ['drafts'], {
      textbookId: book.bookId, goal: '学习变量',
      sources: [{ sourceId: book.bookId, sourceRevision: source.sourceRevision, chapterIds: source.chapters.map((c: { chapterId: string }) => c.chapterId) }],
    }), context(['drafts']))).json()).data;
    return { draftId: draft.draftId, revision: draft.revision };
  }

  it('没有 X-VL-Model 时拒绝发起生成', async () => {
    const draft = await draftReady();
    const response = await POST(request('POST', ['drafts', draft.draftId, 'generate'], { expectedRevision: draft.revision }), context(['drafts', draft.draftId, 'generate']));
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe('MODEL_KEY_REQUIRED');
  });

  it('模型地址指向内网时拒绝发起生成与拉取模型列表，不建任务、不向该地址发请求', async () => {
    const draft = await draftReady();
    const fetchSpy = vi.fn(async () => new Response('{}'));
    vi.stubGlobal('fetch', fetchSpy);
    const internal = { 'x-vl-model': encodeModelHeader({ ...config, baseUrl: 'http://169.254.169.254/v1' }) };
    const generate = await POST(request('POST', ['drafts', draft.draftId, 'generate'], { expectedRevision: draft.revision }, internal), context(['drafts', draft.draftId, 'generate']));
    expect(generate.status).toBe(400);
    expect((await generate.json()).error.code).toBe('INVALID_INPUT');
    const models = await POST(request('POST', ['settings', 'models'], {}, internal), context(['settings', 'models']));
    expect(models.status).toBe(400);
    expect(callbacks).toHaveLength(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('生成失败时 Key 不落盘：任务、事件、会话记录与数据库文件都不含 Key', async () => {
    const draft = await draftReady();
    // 供应商返回 401，并在响应体中回显 Key 片段（常见情况）
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { message: `Incorrect API key provided: ${SECRET}` } }), { status: 401, headers: { 'content-type': 'application/json' } })));
    const response = await POST(request('POST', ['drafts', draft.draftId, 'generate'], { expectedRevision: draft.revision }, { 'x-vl-model': encodeModelHeader(config) }), context(['drafts', draft.draftId, 'generate']));
    expect(response.status).toBe(202);
    const job = (await response.json()).data;
    for (const callback of callbacks.splice(0)) await callback();
    const view = (await (await GET(request('GET', ['jobs', job.jobId]), context(['jobs', job.jobId]))).json()).data;
    expect(view.status).toBe('failed');
    // 确实经过了供应商 401，错误原文保留但 Key 被替换
    expect(view.error.message).toContain('401');
    expect(view.error.message).toContain('[已隐藏]');
    expect(JSON.stringify(view)).not.toContain(SECRET);
    // 任务结束后内存中的 Key 已清除
    const scope = cookie.split('; ').find(p => p.startsWith('vl_space='))!.slice(9);
    expect(jobKey(scope, job.jobId)).toBeUndefined();
    const db = new Database(path.join(root, 'data/app.db'), { readonly: true });
    for (const table of ['vl_jobs', 'vl_job_events', 'vl_agent_states', 'vl_requests', 'vl_drafts']) {
      const rows = JSON.stringify(db.prepare(`SELECT * FROM ${table}`).all());
      expect(rows, table).not.toContain(SECRET);
    }
    db.close();
    // 数据库文件与 WAL 的原始字节中也不出现 Key
    const { readFileSync, existsSync } = await import('node:fs');
    for (const file of ['data/app.db', 'data/app.db-wal']) {
      const full = path.join(root, file);
      if (existsSync(full)) expect(readFileSync(full).includes(Buffer.from(SECRET)), file).toBe(false);
    }
  });

  it('进程重启丢失内存 Key 后，任务失败并标记 MODEL_KEY_REQUIRED 可恢复', async () => {
    const draft = await draftReady();
    const response = await POST(request('POST', ['drafts', draft.draftId, 'generate'], { expectedRevision: draft.revision }, { 'x-vl-model': encodeModelHeader(config) }), context(['drafts', draft.draftId, 'generate']));
    const job = (await response.json()).data;
    // 模拟重启：内存中的 Key 消失，后台任务再执行
    const scope = cookie.split('; ').find(p => p.startsWith('vl_space='))!.slice(9);
    forgetJobKey(scope, job.jobId);
    for (const callback of callbacks.splice(0)) await callback();
    const view = (await (await GET(request('GET', ['jobs', job.jobId]), context(['jobs', job.jobId]))).json()).data;
    expect(view.status).toBe('failed');
    expect(view.error.code).toBe('MODEL_KEY_REQUIRED');
    expect(view.resumable).toBe(true);
  });

  it('线上模式禁止写入服务器设置', async () => {
    const response = await PATCH(request('PATCH', ['settings'], { llm_model: 'x' }), context(['settings']));
    expect(response.status).toBe(403);
  });
});
