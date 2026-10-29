import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
vi.mock('next/server', () => ({ after: vi.fn() }));
import { GET, POST, PATCH, DELETE } from '@/app/api/verified-learning/v1/[[...path]]/route';
import { initializeVerifiedLearning } from '@/lib/verified-learning/initialization';
import { resetOnlineLoginLimit } from '@/lib/verified-learning/online-access';
import { removeIdleSpaces } from '@/lib/verified-learning/cleanup';
import { testDirectory } from './db-fixtures';

const ORIGIN = 'https://learn.example.cn';
const CODE = 'judge-code-2026';
const context = (segments: string[]) => ({ params: Promise.resolve({ path: segments }) });
function request(method: string, segments: string[], cookie: string, body?: unknown, key = 'k-' + Math.random()) {
  const headers: Record<string, string> = { host: 'learn.example.cn', origin: ORIGIN, cookie, 'idempotency-key': key, 'x-real-ip': '198.51.100.7' };
  if (body !== undefined && !(body instanceof FormData)) headers['content-type'] = 'application/json';
  return new Request(`${ORIGIN}/api/verified-learning/v1/${segments.join('/')}`, {
    method, headers, body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
  });
}
let root: string;
async function space(): Promise<{ cookie: string; scope: string }> {
  const response = await POST(new Request(`${ORIGIN}/api/verified-learning/v1/access`, {
    method: 'POST', headers: { host: 'learn.example.cn', origin: ORIGIN, 'content-type': 'application/json', 'x-real-ip': '198.51.100.7' },
    body: JSON.stringify({ token: CODE }),
  }), context(['access']));
  const pairs = response.headers.getSetCookie().map(value => value.split(';')[0]);
  return { cookie: pairs.join('; '), scope: pairs.find(p => p.startsWith('vl_space='))!.slice(9) };
}
beforeEach(async () => {
  resetOnlineLoginLimit();
  root = testDirectory();
  mkdirSync(path.join(root, 'data'));
  vi.spyOn(process, 'cwd').mockReturnValue(root);
  vi.stubEnv('DB_PATH', path.join(root, 'data/app.db'));
  vi.stubEnv('VL_MODE', 'online');
  vi.stubEnv('VL_PUBLIC_ORIGIN', ORIGIN);
  vi.stubEnv('VL_ACCESS_CODE', CODE);
  await initializeVerifiedLearning('data/app.db', true, root);
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe('线上模式空间隔离', () => {
  it('空间 B 看不到也删不掉空间 A 的教材、草稿与任务', async () => {
    const a = await space();
    const b = await space();
    const form = new FormData();
    form.set('file', new File(['# 第一章\n变量保存数据。'], 'intro.md'));
    const uploaded = await POST(request('POST', ['textbooks'], a.cookie, form), context(['textbooks']));
    expect(uploaded.status).toBe(201);
    const book = (await uploaded.json()).data;
    const draftResponse = await POST(request('POST', ['drafts'], a.cookie, { goal: '学习变量' }), context(['drafts']));
    const draft = (await draftResponse.json()).data;
    const jobs = (await (await GET(request('GET', ['jobs'], a.cookie), context(['jobs']))).json()).data;
    expect(jobs.length).toBeGreaterThan(0);

    expect((await GET(request('GET', ['textbooks', book.bookId], b.cookie), context(['textbooks', book.bookId]))).status).toBe(404);
    expect((await GET(request('GET', ['drafts', draft.draftId], b.cookie), context(['drafts', draft.draftId]))).status).toBe(404);
    expect((await GET(request('GET', ['jobs', jobs[0].jobId], b.cookie), context(['jobs', jobs[0].jobId]))).status).toBe(404);
    expect((await DELETE(request('DELETE', ['drafts', draft.draftId], b.cookie, { expectedRevision: 0 }), context(['drafts', draft.draftId]))).status).toBe(404);
    expect((await PATCH(request('PATCH', ['textbooks', book.bookId], b.cookie, { expectedRevision: 0, archived: true }), context(['textbooks', book.bookId]))).status).toBe(404);
    expect((await (await GET(request('GET', ['textbooks'], b.cookie), context(['textbooks']))).json()).data).toEqual([]);
    expect((await (await GET(request('GET', ['drafts'], b.cookie), context(['drafts']))).json()).data).toEqual([]);

    // 上传文件按空间分目录保存
    expect(readdirSync(path.join(root, 'data', 'verified-learning', 'uploads', a.scope))).toHaveLength(1);
    expect(existsSync(path.join(root, 'data', 'verified-learning', 'uploads', b.scope))).toBe(false);
  });

  it('线上模式上传超过 20MiB 返回 413，每个空间最多 10 本', async () => {
    const a = await space();
    const big = new FormData();
    big.set('file', new File([new Uint8Array(20 * 1024 * 1024 + 1)], 'big.txt'));
    expect((await POST(request('POST', ['textbooks'], a.cookie, big), context(['textbooks']))).status).toBe(413);
    for (let i = 0; i < 10; i++) {
      const form = new FormData();
      form.set('file', new File([`# 第${i}章\n内容 ${i}。`], `book-${i}.md`));
      expect((await POST(request('POST', ['textbooks'], a.cookie, form), context(['textbooks']))).status).toBe(201);
    }
    const extra = new FormData();
    extra.set('file', new File(['# 多余\n超出。'], 'extra.md'));
    const response = await POST(request('POST', ['textbooks'], a.cookie, extra), context(['textbooks']));
    expect(response.status).toBe(429);
  });

  it('删除 30 天未访问的空间及其上传文件，保留近期空间', async () => {
    const old = await space();
    const fresh = await space();
    for (const s of [old, fresh]) {
      const form = new FormData();
      form.set('file', new File([`# 章\n${s.scope}`], 'a.md'));
      await POST(request('POST', ['textbooks'], s.cookie, form), context(['textbooks']));
    }
    const db = new Database(path.join(root, 'data/app.db'));
    const now = new Date('2026-12-01T00:00:00.000Z');
    db.prepare('UPDATE vl_spaces SET last_seen_at=? WHERE space_id=?').run(new Date(now.getTime() - 31 * 86400_000).toISOString(), old.scope);
    db.prepare('UPDATE vl_spaces SET last_seen_at=? WHERE space_id=?').run(new Date(now.getTime() - 29 * 86400_000).toISOString(), fresh.scope);
    const uploads = path.join(root, 'data', 'verified-learning', 'uploads');
    expect(removeIdleSpaces(db, uploads, now)).toBe(1);
    expect(db.prepare('SELECT space_id FROM vl_spaces').all()).toEqual([{ space_id: fresh.scope }]);
    expect(db.prepare('SELECT count(*) AS n FROM vl_books WHERE scope_id=?').get(old.scope)).toEqual({ n: 0 });
    expect(db.prepare('SELECT count(*) AS n FROM vl_books WHERE scope_id=?').get(fresh.scope)).toEqual({ n: 1 });
    expect(db.prepare('SELECT count(*) AS n FROM vl_web_sessions WHERE scope_id=?').get(old.scope)).toEqual({ n: 0 });
    expect(existsSync(path.join(uploads, old.scope))).toBe(false);
    expect(existsSync(path.join(uploads, fresh.scope))).toBe(true);
    db.close();
  });
});
