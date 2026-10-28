import type Database from 'better-sqlite3';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { AppError } from './errors';
import { ONLINE_LIMITS, readMode } from './mode';
import { seedFromEnv } from './sample-course';

/**
 * 线上模式访问控制（规格 8.4）：
 * - 访问码换取会话 cookie（30 天），并为浏览器分配独立空间（空间 cookie 90 天）。
 * - 空间 ID 即数据隔离用的 scope_id；所有业务查询本就按 scope_id 过滤。
 * - 登录限流按 Nginx 提供的 X-Real-IP 计数（进程内存）。
 */
const SESSION_COOKIE = 'vl_session';
const SPACE_COOKIE = 'vl_space';
const tokenPattern = /^[A-Za-z0-9_-]{43}$/;
const DAY_MS = 86_400_000;
const failures = new Map<string, { start: number; count: number }>();

function hash(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}
function reject(): never {
  throw new AppError('UNAUTHENTICATED', '请先输入访问码');
}
function forbidden(): never {
  throw new AppError('FORBIDDEN', '不允许此访问方式');
}
function fingerprint(accessCode: string): string {
  return hash(`online-v1:${accessCode}`).toString('hex');
}
function cookies(request: Request): Map<string, string[]> {
  const result = new Map<string, string[]>();
  for (const part of (request.headers.get('cookie') ?? '').split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    result.set(name, [...(result.get(name) ?? []), value]);
  }
  return result;
}
/** 同名 cookie 出现多次时拒绝，不凭解析顺序选择身份 */
function single(request: Request, name: string): string | null {
  const values = cookies(request).get(name) ?? [];
  return values.length === 1 && tokenPattern.test(values[0]) ? values[0] : null;
}
function clientIp(request: Request): string {
  return (request.headers.get('x-real-ip') ?? 'unknown').trim().slice(0, 64) || 'unknown';
}

/** 测试与进程重启用：清空登录失败计数 */
export function resetOnlineLoginLimit() {
  failures.clear();
}

export function assertOnlineRequest(request: Request): void {
  const { publicOrigin } = readMode();
  const expectedHost = new URL(publicOrigin!).host;
  const origin = request.headers.get('origin');
  const write = !['GET', 'HEAD'].includes(request.method);
  if (request.headers.get('host') !== expectedHost || (write && origin !== publicOrigin) || (origin !== null && origin !== publicOrigin) ||
    request.headers.get('sec-fetch-site') === 'cross-site') forbidden();
}

function cookie(name: string, value: string, maxAgeSeconds: number): string {
  return `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}

export function onlineLogin(db: Database.Database, request: Request, secret: unknown, now = new Date()): { cookies: string[]; expiresAt: string; scopeId: string } {
  const { accessCode } = readMode();
  assertOnlineRequest(request);
  if (request.method !== 'POST') forbidden();
  const time = now.getTime();
  const ip = clientIp(request);
  const record = failures.get(ip);
  if (record && time < record.start + 60_000 && record.count >= ONLINE_LIMITS.loginPerMinutePerIp) throw new AppError('LIMIT_EXCEEDED', '尝试次数过多，请一分钟后再试');
  const ok = typeof secret === 'string' && secret.length <= 128 && timingSafeEqual(hash(secret), hash(accessCode!));
  if (!ok) {
    const current = record && time < record.start + 60_000 ? record : { start: time, count: 0 };
    current.count++;
    failures.set(ip, current);
    reject();
  }
  failures.delete(ip);

  // 浏览器已有空间且仍在登记表中则复用，否则新建
  const at = now.toISOString();
  const existing = single(request, SPACE_COOKIE);
  const known = existing && db.prepare('SELECT space_id FROM vl_spaces WHERE space_id=?').get(existing) ? existing : null;
  const scopeId = known ?? randomBytes(32).toString('base64url');
  const session = randomBytes(32).toString('base64url');
  const expiresAt = new Date(time + ONLINE_LIMITS.sessionDays * DAY_MS).toISOString();
  db.transaction(() => {
    if (known) db.prepare('UPDATE vl_spaces SET last_seen_at=? WHERE space_id=?').run(at, scopeId);
    else db.prepare('INSERT INTO vl_spaces(space_id,created_at,last_seen_at) VALUES (?,?,?)').run(scopeId, at, at);
    db.prepare('DELETE FROM vl_web_sessions WHERE expires_at<=?').run(at);
    db.prepare('INSERT INTO vl_web_sessions(token_hash,scope_id,expires_at,config_fingerprint) VALUES (?,?,?,?)')
      .run(hash(session).toString('hex'), scopeId, expiresAt, fingerprint(accessCode!));
  }).immediate();
  // 新空间：种入示例课程（VL_SAMPLE_PATH 未配置时跳过）；失败不影响登录
  if (!known) seedFromEnv(db, scopeId);
  return {
    scopeId,
    expiresAt,
    cookies: [
      cookie(SESSION_COOKIE, session, ONLINE_LIMITS.sessionDays * 86_400),
      cookie(SPACE_COOKIE, scopeId, ONLINE_LIMITS.spaceDays * 86_400),
    ],
  };
}

export function requireOnlineAccess(db: Database.Database, request: Request, now = new Date()): { scopeId: string } {
  const { accessCode } = readMode();
  assertOnlineRequest(request);
  const session = single(request, SESSION_COOKIE);
  if (!session) reject();
  const row = db.prepare('SELECT scope_id FROM vl_web_sessions WHERE token_hash=? AND config_fingerprint=? AND expires_at>?')
    .get(hash(session).toString('hex'), fingerprint(accessCode!), now.toISOString()) as { scope_id: string } | undefined;
  if (!row) reject();
  // 记录空间最近访问时间（同一分钟内不重复写）
  const minuteAgo = new Date(now.getTime() - 60_000).toISOString();
  db.prepare('UPDATE vl_spaces SET last_seen_at=? WHERE space_id=? AND last_seen_at<?').run(now.toISOString(), row.scope_id, minuteAgo);
  return { scopeId: row.scope_id };
}

export function onlineLogout(db: Database.Database, request: Request): string[] {
  assertOnlineRequest(request);
  if (request.method !== 'DELETE') forbidden();
  const session = single(request, SESSION_COOKIE);
  if (session) db.prepare('DELETE FROM vl_web_sessions WHERE token_hash=?').run(hash(session).toString('hex'));
  // 只清会话，保留空间 cookie：再次输入访问码即回到原空间
  return [`${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`];
}
