import Database from 'better-sqlite3';
import { closeSync, existsSync, lstatSync, mkdirSync, openSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { SCHEMA_SQL } from '../db/schema';
import { LearningError } from './contracts';
import { AppError } from './errors';
import { CURRENT_SCHEMA_VERSION, getSchemaVersion, migrateVerifiedLearning } from './migrations';

function invalidPath(): never {
  throw new LearningError('INVALID_INPUT', '数据库路径必须位于当前项目的 data 目录内');
}

function databasePath(input: unknown, create: boolean, workingRoot: string): string {
  if (typeof input !== 'string' || !input.trim() || input === ':memory:' || input.includes('\0')) invalidPath();
  const root = realpathSync(workingRoot);
  const data = path.join(root, 'data');
  const target = path.resolve(root, input);
  const relative = path.relative(data, target);
  if (!relative || path.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${path.sep}`)) invalidPath();
  const parts = relative.split(path.sep);
  if (parts.some(part => /[:*?"<>|]/.test(part) || /[. ]$/.test(part))) invalidPath();
  // 逐段拒绝链接/重解析点，既有 data 目录也不能指向其他工作树。
  let current = root;
  for (const [index, part] of ['data', ...parts].entries()) {
    current = path.join(current, part);
    const last = index === parts.length;
    if (existsSync(current)) {
      const stat = lstatSync(current);
      if (stat.isSymbolicLink() || (last ? !stat.isFile() || stat.nlink !== 1 : !stat.isDirectory()) ||
        path.resolve(realpathSync(current)).toLowerCase() !== path.resolve(current).toLowerCase()) invalidPath();
    } else {
      if (!create) throw new AppError('NOT_INITIALIZED', '数据库尚不存在，请先明确初始化');
      if (!last) mkdirSync(current);
    }
  }
  return target;
}

export async function initializeVerifiedLearning(input: unknown, create = false, workingRoot = process.cwd()): Promise<{
  schemaVersion: number; created: boolean;
}> {
  const filename = databasePath(input, create, workingRoot);
  const created = !existsSync(filename);
  if (created) {
    // wx 只允许新建；不覆盖检查后由别的进程创建的文件。
    const handle = openSync(filename, 'wx');
    closeSync(handle);
  }
  const db = new Database(filename, { fileMustExist: true });
  try {
    if (created) db.transaction(() => db.exec(SCHEMA_SQL)).immediate();
    await migrateVerifiedLearning(db);
    return { schemaVersion: CURRENT_SCHEMA_VERSION, created };
  } finally {
    db.close();
  }
}

export function openInitializedDb(input: unknown, workingRoot = process.cwd()): Database.Database {
  const filename = databasePath(input, false, workingRoot);
  const db = new Database(filename, { fileMustExist: true });
  try {
    if (getSchemaVersion(db) !== CURRENT_SCHEMA_VERSION) {
      throw new AppError('NOT_INITIALIZED', '数据库需要显式初始化');
    }
    db.pragma('foreign_keys = ON');
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}
