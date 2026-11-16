import type Database from 'better-sqlite3';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { AppError } from './errors';

const ORIGIN = 'http://127.0.0.1:3101';
const HOST = '127.0.0.1:3101';
const COOKIE = 'vl_session';
const SESSION_MS = 8 * 60 * 60 * 1000;
const tokenPattern = /^[A-Za-z0-9_-]{43}$/;
let failures = { fingerprint: '', start: 0, count: 0 };
export type LocalConfig = { authRequired: false } | { authRequired: true; tokenHash: Buffer; fingerprint: string };

function hash(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}
function reject(): never {
  throw new AppError('UNAUTHENTICATED', '请先登录本机学习入口');
}
function validToken(value: unknown): value is string {
  return typeof value === 'string' && tokenPattern.test(value) &&
    Buffer.from(value, 'base64url').toString('base64url') === value;
}
function timestamp(now: Date): number {
  const time = now.getTime();
  if (!Number.isFinite(time)) throw new AppError('INTERNAL_ERROR', '系统时间不合法');
  return time;
}

export function readLocalConfig(env: Record<string, string | undefined> = process.env): LocalConfig {
  const enabled = env.VL_LOCAL_AUTH;
  if (enabled === undefined || enabled === '' || enabled === '0') return { authRequired: false };
  if (enabled !== '1') throw new AppError('DISABLED', 'VL_LOCAL_AUTH 只能配置为 0 或 1');
  const secret = env.VL_LOCAL_PASSWORD;
  if (!secret?.trim() || secret.length > 128) {
    throw new AppError('DISABLED', '启用本机登录时，必须在 .env.local 配置 1–128 字符的 VL_LOCAL_PASSWORD');
  }
  return { authRequired: true, tokenHash: hash(secret), fingerprint: hash(`local-password-v1:${secret}`).toString('hex') };
}

export function assertLocalRequest(request: Request): void {
  const url = new URL(request.url);
  const origin = request.headers.get('origin');
  const write = !['GET', 'HEAD'].includes(request.method);
  const forwarded = request.headers.get('forwarded');
  const expectedForwarded: Record<string, string> = {
    'x-forwarded-host': HOST, 'x-forwarded-proto': 'http', 'x-forwarded-port': '3101',
  };
  const badForwarded = Object.entries(expectedForwarded).some(([header, value]) =>
    request.headers.has(header) && request.headers.get(header) !== value);
  const forwardedFor = request.headers.get('x-forwarded-for');
  if (url.origin !== ORIGIN || url.username || url.password || request.headers.get('host') !== HOST ||
    (write && origin !== ORIGIN) || (origin !== null && origin !== ORIGIN) || forwarded !== null ||
    badForwarded || (forwardedFor !== null && !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(forwardedFor)) ||
    request.headers.get('sec-fetch-site') === 'cross-site') {
    throw new AppError('FORBIDDEN', '仅允许本机同源访问');
  }
}

function sessionToken(request: Request): string | null {
  const values = (request.headers.get('cookie') ?? '').split(';').map(part => part.trim())
    .filter(part => part.startsWith(`${COOKIE}=`)).map(part => part.slice(COOKIE.length + 1));
  return values.length === 1 && validToken(values[0]) ? values[0] : null;
}

export function login(db: Database.Database, request: Request, token: unknown, now = new Date()): {
  token: string; expiresAt: string; cookie: string;
} {
  const config = readLocalConfig();
  assertLocalRequest(request);
  if (request.method !== 'POST') throw new AppError('FORBIDDEN', '登录需要明确提交');
  if (!config.authRequired) throw new AppError('FORBIDDEN', '本机免登录模式无需提交密码');
  const time = timestamp(now);
  if (failures.fingerprint !== config.fingerprint || time >= failures.start + 60_000) {
    failures = { fingerprint: config.fingerprint, start: time, count: 0 };
  }
  if (failures.count >= 5) throw new AppError('LIMIT_EXCEEDED', '登录尝试过于频繁');
  if (typeof token !== 'string' || token.length > 128 || !timingSafeEqual(hash(token), config.tokenHash)) {
    failures.count++;
    reject();
  }
  const session = randomBytes(32).toString('base64url');
  const expiresAt = new Date(time + SESSION_MS).toISOString();
  db.transaction(() => {
    db.prepare('DELETE FROM vl_web_sessions WHERE expires_at<=? OR config_fingerprint<>?').run(now.toISOString(), config.fingerprint);
    db.prepare('INSERT INTO vl_web_sessions(token_hash,scope_id,expires_at,config_fingerprint) VALUES (?,?,?,?)')
      .run(hash(session).toString('hex'), 'local-owner', expiresAt, config.fingerprint);
  }).immediate();
  failures.count = 0;
  return {
    token: session, expiresAt,
    cookie: `${COOKIE}=${session}; Path=/; HttpOnly; SameSite=Strict; Max-Age=28800; Expires=${new Date(expiresAt).toUTCString()}`,
  };
}

export function requireLocalAccess(db: Database.Database, request: Request, now = new Date()): { scopeId: string } {
  const config = readLocalConfig();
  assertLocalRequest(request);
  timestamp(now);
  // 免登录只免除会话验证，不绕过上面的本机同源边界。
  if (!config.authRequired) return { scopeId: 'local-owner' };
  const token = sessionToken(request);
  if (!token) reject();
  const row = db.prepare(`SELECT scope_id FROM vl_web_sessions
    WHERE token_hash=? AND config_fingerprint=? AND expires_at>?`).get(
    hash(token).toString('hex'), config.fingerprint, now.toISOString(),
  ) as { scope_id: string } | undefined;
  if (!row || row.scope_id !== 'local-owner') reject();
  return { scopeId: row.scope_id };
}

export function logout(db: Database.Database, request: Request): string {
  readLocalConfig();
  assertLocalRequest(request);
  if (request.method !== 'DELETE') throw new AppError('FORBIDDEN', '注销需要明确提交');
  const token = sessionToken(request);
  if (token) db.prepare('DELETE FROM vl_web_sessions WHERE token_hash=?').run(hash(token).toString('hex'));
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`;
}
