// Key 不落盘验证（规格 11）：在数据库文件、WAL、上传目录与日志目录里做字节级全文搜索。
// 同时搜 UTF-8 原文、UTF-16LE（SQLite 可能以此存文本）与 base64 编码（X-VL-Model 请求头的形式）。
// 用法：pnpm exec tsx scripts/check-key-leak.ts --key <Key> <文件或目录>...
// 结果：每个命中文件与次数，最后一行是总数；有命中时退出码 1。
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface LeakResult { total: number; scannedFiles: number; hits: { file: string; count: number }[] }

function count(haystack: Buffer, needle: Buffer): number {
  let n = 0;
  for (let i = haystack.indexOf(needle); i >= 0; i = haystack.indexOf(needle, i + needle.length)) n++;
  return n;
}

function files(target: string): string[] {
  if (!existsSync(target)) return [];
  const stat = statSync(target);
  if (stat.isFile()) return [target];
  if (!stat.isDirectory()) return [];
  return readdirSync(target).flatMap(name => files(path.join(target, name)));
}

export function scanForSecret(targets: string[], secret: string): LeakResult {
  if (secret.length < 12) throw new Error('Key 至少 12 个字符，太短的字符串会误报');
  const base64 = Buffer.from(secret).toString('base64');
  const needles = [Buffer.from(secret), Buffer.from(secret, 'utf16le'), Buffer.from(base64.replace(/=+$/, '')), Buffer.from(base64.replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_'))];
  const unique = needles.filter((needle, index) => needles.findIndex(other => other.equals(needle)) === index);
  const hits: LeakResult['hits'] = [];
  let scannedFiles = 0;
  for (const file of [...new Set(targets.flatMap(files))]) {
    scannedFiles++;
    const content = readFileSync(file);
    const n = unique.reduce((sum, needle) => sum + count(content, needle), 0);
    if (n > 0) hits.push({ file, count: n });
  }
  return { total: hits.reduce((sum, hit) => sum + hit.count, 0), scannedFiles, hits };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const index = args.indexOf('--key');
  const key = index >= 0 ? args[index + 1] : undefined;
  const targets = args.filter((_, i) => i !== index && i !== index + 1);
  if (!key || targets.length === 0) {
    console.error('用法：pnpm exec tsx scripts/check-key-leak.ts --key <Key> <文件或目录>...');
    process.exit(2);
  }
  const result = scanForSecret(targets, key);
  for (const hit of result.hits) console.log(`${hit.file}: ${hit.count}`);
  console.log(`共检查 ${result.scannedFiles} 个文件，命中 ${result.total} 处`);
  process.exitCode = result.total > 0 ? 1 : 0;
}
