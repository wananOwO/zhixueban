import { randomBytes } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { migrateVerifiedLearning } from '@/lib/verified-learning/store';
import { login, logout, readLocalConfig, requireLocalAccess } from '@/lib/verified-learning/local-access';
import { openTestDb } from './db-fixtures';

const origin = 'http://127.0.0.1:3101';
const now = new Date('2026-10-21T00:00:00.000Z');
let secret: string;
function request(method = 'GET', cookie?: string, headers: Record<string, string> = {}, url = origin) {
  return new Request(`${url}/api/verified-learning/v1/access`, {
    method, headers: { host: '127.0.0.1:3101', ...(method !== 'GET' ? { origin } : {}), ...(cookie ? { cookie } : {}), ...headers },
  });
}
async function setup() {
  const db = openTestDb();
  await migrateVerifiedLearning(db);
  return db;
}
beforeEach(() => {
  secret = randomBytes(32).toString('base64url');
  vi.stubEnv('VERIFIED_LEARNING_LOCAL', '1');
  vi.stubEnv('VERIFIED_LEARNING_ACCESS_TOKEN', secret);
});
afterEach(() => vi.unstubAllEnvs());

describe('本机访问边界', () => {
  it('默认关闭或口令配置不合法时在访问数据库之前拒绝', () => {
    expect(() => readLocalConfig({})).toThrow(expect.objectContaining({ code: 'DISABLED' }));
    for (const value of ['', 'short', 'a'.repeat(43) + '!', 'a'.repeat(100)]) {
      expect(() => readLocalConfig({ VERIFIED_LEARNING_LOCAL: '1', VERIFIED_LEARNING_ACCESS_TOKEN: value }))
        .toThrow(expect.objectContaining({ code: 'DISABLED' }));
    }
    const db = openTestDb();
    db.close();
    vi.stubEnv('VERIFIED_LEARNING_LOCAL', '0');
    expect(() => requireLocalAccess(db, request(), now)).toThrow(expect.objectContaining({ code: 'DISABLED' }));
  });

  it('口令换取独立随机cookie，数据库只存哈希，不接收客户端scope', async () => {
    const db = await setup();
    const signed = login(db, request('POST'), secret, now);
    expect(signed.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(signed.token).not.toBe(secret);
    expect(signed.expiresAt).toBe('2026-10-21T08:00:00.000Z');
    expect(signed.cookie).toContain('HttpOnly');
    expect(signed.cookie).toContain('SameSite=Strict');
    expect(signed.cookie).toContain('Path=/');
    const rows = db.prepare('SELECT * FROM vl_web_sessions').all();
    expect(JSON.stringify(rows)).not.toContain(secret);
    expect(JSON.stringify(rows)).not.toContain(signed.token);
    expect(requireLocalAccess(db, request('GET', signed.cookie, { 'x-scope-id': 'victim' }), now)).toEqual({ scopeId: 'local-owner' });
    expect(login(db, request('POST'), secret, now).token).not.toBe(signed.token);
  });

  it('未登录、错口令、无效cookie不泄露是否存在会话', async () => {
    const db = await setup();
    for (const cookie of [undefined, 'vl_session=bad', `vl_session=${randomBytes(32).toString('base64url')}`]) {
      expect(() => requireLocalAccess(db, request('GET', cookie), now)).toThrow(expect.objectContaining({ code: 'UNAUTHENTICATED' }));
    }
    expect(() => login(db, request('POST'), 'wrong', now)).toThrow(expect.objectContaining({ code: 'UNAUTHENTICATED' }));
    expect(db.prepare('SELECT count(*) AS n FROM vl_web_sessions').get()).toEqual({ n: 0 });
  });

  it('过期、注销和配置轮换立即使旧cookie失效', async () => {
    const db = await setup();
    const signed = login(db, request('POST'), secret, now);
    expect(() => requireLocalAccess(db, request('GET', signed.cookie), new Date('2026-10-21T08:00:00.000Z')))
      .toThrow(expect.objectContaining({ code: 'UNAUTHENTICATED' }));
    const expiredBefore = db.prepare('SELECT * FROM vl_web_sessions').all();
    expect(expiredBefore).toHaveLength(1);
    const clear = logout(db, request('DELETE', signed.cookie));
    expect(clear).toContain('Max-Age=0');
    expect(() => requireLocalAccess(db, request('GET', signed.cookie), now)).toThrow(expect.objectContaining({ code: 'UNAUTHENTICATED' }));
    const next = login(db, request('POST'), secret, now);
    vi.stubEnv('VERIFIED_LEARNING_ACCESS_TOKEN', randomBytes(32).toString('base64url'));
    expect(() => requireLocalAccess(db, request('GET', next.cookie), now)).toThrow(expect.objectContaining({ code: 'UNAUTHENTICATED' }));
  });

  it('写请求必须同源且Host/URL一致，拒绝外部代理身份', async () => {
    const db = await setup();
    const attempts = [
      request('POST', undefined, { origin: 'http://evil.example' }),
      request('POST', undefined, { origin: 'null' }),
      request('POST', undefined, { origin: '' }),
      request('POST', undefined, { host: 'evil.example' }),
      request('POST', undefined, {}, 'http://localhost:3101'),
      request('POST', undefined, { forwarded: 'for=127.0.0.1;host=evil.example' }),
      request('POST', undefined, { 'x-forwarded-host': 'evil.example' }),
      request('POST', undefined, { 'x-forwarded-proto': 'https' }),
      request('POST', undefined, { 'x-forwarded-port': '80' }),
      request('POST', undefined, { 'x-forwarded-for': '203.0.113.1' }),
      request('POST', undefined, { 'sec-fetch-site': 'cross-site' }),
    ];
    for (const req of attempts) expect(() => login(db, req, secret, now)).toThrow(expect.objectContaining({ code: 'FORBIDDEN' }));
    expect(db.prepare('SELECT count(*) AS n FROM vl_web_sessions').get()).toEqual({ n: 0 });
  });

  it('接受Next本机标准转发元数据但不拿它代替Host与口令', async () => {
    const db = await setup();
    const headers = { 'x-forwarded-host': '127.0.0.1:3101', 'x-forwarded-proto': 'http', 'x-forwarded-port': '3101', 'x-forwarded-for': '::ffff:127.0.0.1' };
    const signed = login(db, request('POST', undefined, headers), secret, now);
    expect(requireLocalAccess(db, request('GET', signed.cookie, headers), now).scopeId).toBe('local-owner');
    expect(() => login(db, request('POST', undefined, { ...headers, host: 'evil.example' }), secret, now))
      .toThrow(expect.objectContaining({ code: 'FORBIDDEN' }));
  });

  it('GET有外部Origin也拒绝，读取不延长或写入会话', async () => {
    const db = await setup();
    const signed = login(db, request('POST'), secret, now);
    const before = db.prepare('SELECT * FROM vl_web_sessions').all();
    for (let index = 0; index < 3; index++) requireLocalAccess(db, request('GET', signed.cookie), now);
    expect(db.prepare('SELECT * FROM vl_web_sessions').all()).toEqual(before);
    expect(() => requireLocalAccess(db, request('GET', signed.cookie, { origin: 'http://127.0.0.1:9999' }), now))
      .toThrow(expect.objectContaining({ code: 'FORBIDDEN' }));
  });

  it('五次错误后整分钟限流，成功不允许伪造客户端IP绕过', async () => {
    const db = await setup();
    for (let index = 0; index < 5; index++) {
      expect(() => login(db, request('POST'), 'wrong', now)).toThrow(expect.objectContaining({ code: 'UNAUTHENTICATED' }));
    }
    expect(() => login(db, request('POST'), secret, now)).toThrow(expect.objectContaining({ code: 'LIMIT_EXCEEDED' }));
    const later = new Date(now.getTime() + 60_000);
    expect(login(db, request('POST'), secret, later).token).toEqual(expect.any(String));
  });

  it('重复cookie名称拒绝，不凭解析顺序选择身份', async () => {
    const db = await setup();
    const signed = login(db, request('POST'), secret, now);
    expect(() => requireLocalAccess(db, request('GET', `vl_session=invalid; vl_session=${signed.token}`), now))
      .toThrow(expect.objectContaining({ code: 'UNAUTHENTICATED' }));
  });
});
