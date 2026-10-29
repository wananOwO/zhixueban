// 从指定空间导出示例课程为 JSON（线上站的新空间用 VL_SAMPLE_PATH 读取并种入）。
// 用法：pnpm vl:sample-export --db data/app.db --scope <空间ID> --course <课程ID> --out data/sample/course.json
// 只读打开数据库；导出内容见 src/lib/verified-learning/sample-course.ts 顶部说明（不含作答、笔记、任务输入、会话原文）。
import Database from 'better-sqlite3';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { exportSample } from '../src/lib/verified-learning/sample-course';

function arg(name: string): string {
  const index = process.argv.indexOf(`--${name}`);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value || value.startsWith('--')) {
    console.error('用法：pnpm vl:sample-export --db data/app.db --scope <空间ID> --course <课程ID> --out data/sample/course.json');
    process.exit(1);
  }
  return value;
}

const db = new Database(arg('db'), { readonly: true, fileMustExist: true });
try {
  const bundle = exportSample(db, arg('scope'), arg('course'));
  const out = arg('out');
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(bundle));
  const counts = Object.entries(bundle.tables).map(([table, rows]) => `${table} ${rows.length}`).join('，');
  console.log(`已导出到 ${out}：${counts}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : '导出失败');
  process.exitCode = 1;
} finally {
  db.close();
}
