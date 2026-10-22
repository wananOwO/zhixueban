import 'server-only';
import { openInitializedDb } from './initialization';
import { assertLocalRequest, readLocalConfig, requireLocalAccess } from './local-access';
import { JobStore } from './jobs';

// 调用方在 finally 关闭连接；后台 runner 单独打开，不捕获请求已关闭的句柄。
export function openVerifiedDb() {
  readLocalConfig();
  return openInitializedDb(process.env.DB_PATH ?? 'data/app.db');
}

export function getLocalServices(request: Request) {
  readLocalConfig();
  assertLocalRequest(request);
  const db = openVerifiedDb();
  try {
    const { scopeId } = requireLocalAccess(db, request);
    return { db, scopeId, jobs: new JobStore(db) };
  } catch (error) {
    db.close();
    throw error;
  }
}
