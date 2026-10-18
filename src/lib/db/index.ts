import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import { SCHEMA_SQL } from './schema';

let instance: Database.Database | null = null;
let instancePath: string | null = null;

/** 获取数据库单例。传 ':memory:' 用于测试；默认存 data/app.db */
export function getDb(dbPath?: string): Database.Database {
  const target = dbPath ?? path.join(process.cwd(), 'data', 'app.db');
  if (instance && instancePath === target) return instance;

  if (target !== ':memory:') {
    fs.mkdirSync(path.dirname(target), { recursive: true });
  }
  const db = new Database(target);
  db.pragma('journal_mode = WAL');
  db.exec(SCHEMA_SQL);

  instance = db;
  instancePath = target;
  return db;
}

/** 仅测试用：重置单例 */
export function resetDbForTest(): void {
  instance?.close();
  instance = null;
  instancePath = null;
}
