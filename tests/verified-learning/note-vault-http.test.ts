import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
vi.mock('next/server', () => ({ after: vi.fn() }));
import { GET, PATCH, POST } from '@/app/api/verified-learning/v1/[[...path]]/route';
import { initializeVerifiedLearning } from '@/lib/verified-learning/initialization';
import { openVerifiedDb } from '@/lib/verified-learning/server';
import { VerifiedLearningStore } from '@/lib/verified-learning/store';
import { resetOnlineLoginLimit } from '@/lib/verified-learning/online-access';
import { testDirectory } from './db-fixtures';

/** 本地模式：笔记写入本机 Obsidian vault；线上模式禁止（服务器路径不是用户电脑） */
const context = (segments: string[]) => ({ params: Promise.resolve({ path: segments }) });
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); resetOnlineLoginLimit(); });

async function boot(online: boolean) {
  const root = testDirectory();
  mkdirSync(path.join(root, 'data'));
  vi.spyOn(process, 'cwd').mockReturnValue(root);
  vi.stubEnv('DB_PATH', path.join(root, 'data/app.db'));
  const origin = online ? 'https://learn.example.cn' : 'http://127.0.0.1:3101';
  const host = online ? 'learn.example.cn' : '127.0.0.1:3101';
  let token: string;
  if (online) {
    token = 'judge-code-2026';
    vi.stubEnv('VL_MODE', 'online'); vi.stubEnv('VL_PUBLIC_ORIGIN', origin); vi.stubEnv('VL_ACCESS_CODE', token);
  } else {
    token = randomBytes(32).toString('base64url');
    vi.stubEnv('VL_LOCAL_AUTH', '1'); vi.stubEnv('VL_LOCAL_PASSWORD', token);
  }
  await initializeVerifiedLearning('data/app.db', true, root);
  let cookie = '';
  const call = (method: string, segments: string[], body?: unknown) => {
    const request = new Request(`${origin}/api/verified-learning/v1/${segments.join('/')}`, {
      method, headers: { host, origin, cookie, 'x-real-ip': '1.1.1.1', 'idempotency-key': `k-${Math.random()}`, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return (method === 'GET' ? GET : method === 'PATCH' ? PATCH : POST)(request, context(segments));
  };
  const login = await call('POST', ['access'], { token });
  cookie = login.headers.getSetCookie().map(v => v.split(';')[0]).join('; ');
  const scope = online ? cookie.split('; ').find(p => p.startsWith('vl_space='))!.slice(9) : 'local-owner';
  // 直接建一门课与一条笔记
  const db = openVerifiedDb();
  const version = new VerifiedLearningStore(db).createVersion(scope, {
    textbookId: 'b', goal: '学会变量',
    outline: [{ moduleId: 'm', title: '第一章', points: [{ knowledgePointId: 'v', title: '变量', role: 'target', prerequisiteIds: [], sourceIds: [], coverage: 'covered', reason: '' }] }],
  });
  db.close();
  const note = (await (await call('POST', ['notes'], { versionId: version.courseVersionId, knowledgePointId: 'v', content: '笔记正文' })).json()).data;
  return { call, note };
}

describe('笔记写入 Obsidian vault', () => {
  it('本地模式：未配置路径时拒绝（INVALID_INPUT）；配置后写入并返回文件路径', async () => {
    const { call, note } = await boot(false);
    const missing = await call('POST', ['notes', note.noteId, 'vault']);
    expect(missing.status).toBe(400);
    expect((await missing.json()).error.code).toBe('INVALID_INPUT');
    const vault = mkdtempSync(path.join(os.tmpdir(), 'vault-'));
    expect((await call('PATCH', ['settings'], { obsidian_vault_path: vault })).status).toBe(200);
    const written = await call('POST', ['notes', note.noteId, 'vault']);
    expect(written.status).toBe(200);
    const { path: file } = (await written.json()).data;
    expect(file.startsWith(path.join(vault, '智学伴'))).toBe(true);
    expect(readFileSync(file, 'utf8')).toContain('笔记正文');
  });

  it('导出下载带 frontmatter', async () => {
    const { call, note } = await boot(false);
    const response = await call('GET', ['notes', note.noteId, 'export']);
    const text = await response.text();
    expect(text.startsWith('---\n')).toBe(true);
    expect(text).toContain('knowledge_point: "变量"');
  });

  it('线上模式：写入 vault 返回 403，不在服务器上建目录', async () => {
    const { call, note } = await boot(true);
    const response = await call('POST', ['notes', note.noteId, 'vault']);
    expect(response.status).toBe(403);
    expect(existsSync(path.join(process.cwd(), '智学伴'))).toBe(false);
  });
});
