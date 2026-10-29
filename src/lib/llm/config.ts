import Database from 'better-sqlite3';
import { existsSync } from 'node:fs';
import path from 'node:path';

/** 与 main 的配置约定一致：网页设置优先，环境变量兜底；只读，不建库或迁移。 */
export function getConfig(key: string): string | undefined {
  const filename = process.env.DB_PATH ?? path.join(process.cwd(), 'data', 'app.db');
  if (existsSync(filename)) {
    const db = new Database(filename, { readonly: true, fileMustExist: true });
    try {
      const row = db.prepare('SELECT value FROM settings WHERE key=?').get(key) as { value: string } | undefined;
      if (row?.value) return row.value;
    } finally {
      db.close();
    }
  }
  return process.env[key.toUpperCase()] || undefined;
}
