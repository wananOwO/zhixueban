import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { scanForSecret } from '../../scripts/check-key-leak';
import { testDirectory } from './db-fixtures';

describe('check-key-leak：字节级全文搜索 Key', () => {
  it('统计每个文件里的命中次数，递归目录；也能找出 UTF-16 与 base64 形式', () => {
    const root = testDirectory();
    mkdirSync(path.join(root, 'uploads', 'space'), { recursive: true });
    const key = 'sk-test-0123456789abcdef';
    writeFileSync(path.join(root, 'app.db'), Buffer.concat([Buffer.from('header'), Buffer.from(key), Buffer.alloc(10), Buffer.from(key)]));
    writeFileSync(path.join(root, 'app.db-wal'), Buffer.from(key, 'utf16le'));
    writeFileSync(path.join(root, 'uploads', 'space', 'a.log'), `token=${Buffer.from(key).toString('base64')}`);
    writeFileSync(path.join(root, 'uploads', 'clean.md'), '没有 Key 的文件');
    const result = scanForSecret([path.join(root, 'app.db'), path.join(root, 'app.db-wal'), path.join(root, 'uploads'), path.join(root, 'missing')], key);
    expect(result.total).toBe(4);
    expect(result.hits.map(h => [path.basename(h.file), h.count]).sort()).toEqual([['a.log', 1], ['app.db', 2], ['app.db-wal', 1]]);
    expect(result.scannedFiles).toBe(4);
  });

  it('Key 太短时拒绝，避免误报', () => {
    expect(() => scanForSecret([], 'short')).toThrow();
  });
});
