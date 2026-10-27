// 端到端测试服务器：一次性测试库 + 随机口令，前台运行 next dev（由 Playwright 管理生命周期）。
// 业务接口在测试中被 page.route 模拟；这里只需要页面与 /mode 可访问。
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const db = 'data/e2e.db';
for (const file of [db, `${db}-wal`, `${db}-shm`]) if (existsSync(file)) rmSync(file);
const token = randomBytes(32).toString('base64url');
writeFileSync(path.join(tmpdir(), 'vl-e2e-token.txt'), token);
const env = { ...process.env, VERIFIED_LEARNING_LOCAL: '1', VERIFIED_LEARNING_ACCESS_TOKEN: token, DB_PATH: db };
const init = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/verified-learning-init.ts', '--db', db, '--create'], { env, stdio: 'inherit' });
if (init.status !== 0) process.exit(init.status ?? 1);
const next = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '--webpack', '--hostname', '127.0.0.1', '--port', '3101'], { env, stdio: 'inherit' });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => next.kill(signal));
next.on('exit', code => process.exit(code ?? 0));
