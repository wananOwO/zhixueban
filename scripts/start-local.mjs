// 本地视觉检查：用生产构建在后台启动（next start），立即返回，不占住终端。
// 用法：node scripts/start-local.mjs [数据库，默认 data/ui-real.db]
// 口令写入 %TEMP%\vl-dev-token.txt，供 scripts/shot.mjs 与 scripts/inspect-page.mjs 登录。
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { openSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const db = process.argv[2] ?? 'data/ui-real.db';
const token = randomBytes(32).toString('base64url');
writeFileSync(path.join(tmpdir(), 'vl-dev-token.txt'), token);
const log = openSync(path.join(tmpdir(), 'vl-start.log'), 'a');
const child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', '3101'], {
  env: { ...process.env, VERIFIED_LEARNING_LOCAL: '1', VERIFIED_LEARNING_ACCESS_TOKEN: token, DB_PATH: db },
  detached: true,
  stdio: ['ignore', log, log],
  windowsHide: true,
});
child.unref();
for (let i = 0; i < 60; i++) {
  try {
    const response = await fetch('http://127.0.0.1:3101/api/verified-learning/v1/mode');
    if (response.ok) { console.log(`已启动（PID ${child.pid}），数据库 ${db}`); process.exit(0); }
  } catch { /* 还没就绪 */ }
  await new Promise(r => setTimeout(r, 500));
}
console.error('30 秒内没有就绪，查看 %TEMP%\\vl-start.log');
process.exit(1);
