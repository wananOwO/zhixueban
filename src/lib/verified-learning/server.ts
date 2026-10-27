import 'server-only';
import path from 'node:path';
import { openInitializedDb } from './initialization';
import { assertRequest, requireAccess } from './access';
import { readLocalConfig } from './local-access';
import { isOnline, readMode } from './mode';
import { JobStore } from './jobs';
import { scheduleCleanup } from './cleanup';

export const UPLOADS_ROOT = () => path.join(process.cwd(), 'data', 'verified-learning', 'uploads');

/** 确认当前模式已启用：本地模式需要终端口令，线上模式需要域名与访问码 */
export function assertEnabled() {
  if (isOnline()) readMode();
  else readLocalConfig();
}

// 调用方在 finally 关闭连接；后台 runner 单独打开，不捕获请求已关闭的句柄。
export function openVerifiedDb() {
  assertEnabled();
  const db = openInitializedDb(process.env.DB_PATH ?? 'data/app.db');
  // 线上模式：首次打开数据库时安排闲置空间清理
  if (isOnline()) scheduleCleanup(() => openInitializedDb(process.env.DB_PATH ?? 'data/app.db'), UPLOADS_ROOT());
  return db;
}

export function getServices(request: Request) {
  assertEnabled();
  assertRequest(request);
  const db = openVerifiedDb();
  try {
    const { scopeId } = requireAccess(db, request);
    return { db, scopeId, jobs: new JobStore(db) };
  } catch (error) {
    db.close();
    throw error;
  }
}

/** 兼容旧名称：现有测试与脚本仍按本地服务调用 */
export const getLocalServices = getServices;
