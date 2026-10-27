import type Database from 'better-sqlite3';
import { assertLocalRequest, login, logout, readLocalConfig, requireLocalAccess } from './local-access';
import { isOnline } from './mode';
import { assertOnlineRequest, onlineLogin, onlineLogout, requireOnlineAccess } from './online-access';

/** 按运行模式分派访问控制；业务代码只依赖这一层 */
export function assertRequest(request: Request): void {
  if (isOnline()) assertOnlineRequest(request);
  else { readLocalConfig(); assertLocalRequest(request); }
}

export function requireAccess(db: Database.Database, request: Request): { scopeId: string } {
  return isOnline() ? requireOnlineAccess(db, request) : requireLocalAccess(db, request);
}

export function loginWith(db: Database.Database, request: Request, secret: unknown): { cookies: string[]; expiresAt: string } {
  if (isOnline()) return onlineLogin(db, request, secret);
  const result = login(db, request, secret);
  return { cookies: [result.cookie], expiresAt: result.expiresAt };
}

export function logoutWith(db: Database.Database, request: Request): string[] {
  return isOnline() ? onlineLogout(db, request) : [logout(db, request)];
}

/** 线上空间的上传目录按 scope 分开；本地模式保持原目录 */
export function uploadsDirectory(root: string, scopeId: string): string {
  if (!isOnline()) return root;
  if (!/^[A-Za-z0-9_-]{43}$/.test(scopeId)) throw new Error('空间标识不合法');
  return `${root}/${scopeId}`;
}
