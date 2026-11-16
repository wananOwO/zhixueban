import { randomBytes } from 'node:crypto';
import { mkdirSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
import { initializeVerifiedLearning } from '@/lib/verified-learning/initialization';
import { login } from '@/lib/verified-learning/local-access';
import { getLocalServices, openVerifiedDb } from '@/lib/verified-learning/server';
import { ownTestDb, testDirectory } from './db-fixtures';

afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
function configure() {
  const directory = testDirectory();
  mkdirSync(path.join(directory, 'data'));
  vi.spyOn(process, 'cwd').mockReturnValue(directory);
  vi.stubEnv('VL_LOCAL_AUTH', '1');
  vi.stubEnv('VL_LOCAL_PASSWORD', randomBytes(32).toString('base64url'));
  vi.stubEnv('DB_PATH', path.join(directory, 'data/app.db'));
  return directory;
}
function request(method = 'GET', cookie?: string) {
  return new Request('http://127.0.0.1:3101/api/verified-learning/v1/jobs', {
    method, headers: { host: '127.0.0.1:3101', origin: 'http://127.0.0.1:3101', ...(cookie ? { cookie } : {}) },
  });
}

describe('服务端按需连接', () => {
  it('关闭时不读数据库配置，不创建默认目录', () => {
    const directory = testDirectory();
    vi.spyOn(process, 'cwd').mockReturnValue(directory);
    vi.stubEnv('VL_LOCAL_AUTH', 'invalid');
    expect(() => openVerifiedDb()).toThrow(expect.objectContaining({ code: 'DISABLED' }));
    expect(() => getLocalServices(request())).toThrow(expect.objectContaining({ code: 'DISABLED' }));
    expect(readdirSync(directory)).toEqual([]);
  });

  it('没有初始化时返回明确错误，不建立数据库', () => {
    const directory = configure();
    expect(() => openVerifiedDb()).toThrow(expect.objectContaining({ code: 'NOT_INITIALIZED' }));
    expect(readdirSync(path.join(directory, 'data'))).toEqual([]);
  });

  it('已登录服务只读返回自己的任务，调用方可以关闭连接', async () => {
    const directory = configure();
    await initializeVerifiedLearning('data/app.db', true, directory);
    const db = ownTestDb(openVerifiedDb());
    const signed = login(db, request('POST'), process.env.VL_LOCAL_PASSWORD!);
    expect(() => getLocalServices(request())).toThrow(expect.objectContaining({ code: 'UNAUTHENTICATED' }));
    const services = getLocalServices(request('GET', signed.cookie));
    ownTestDb(services.db);
    expect(services.scopeId).toBe('local-owner');
    expect(services.jobs.list(services.scopeId)).toEqual([]);
    expect(services.db.prepare('SELECT max(version) AS version FROM vl_schema_migrations').get()).toEqual({ version: 6 });
    services.db.close();
    expect(services.db.open).toBe(false);
  });
});
