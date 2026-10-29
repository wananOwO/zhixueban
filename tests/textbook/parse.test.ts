import { describe, expect, test } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseTextbook } from '@/lib/textbook/parse';

function tmpFile(name: string, content: string): string {
  const p = path.join(os.tmpdir(), name);
  fs.writeFileSync(p, content);
  return p;
}

describe('parseTextbook 统一入口', () => {
  test('.txt 走 TXT 解析器', async () => {
    const p = tmpFile('t1.txt', '第一章 A\n内容');
    const tree = await parseTextbook(p);
    expect(tree.format).toBe('txt');
    expect(tree.chapters[0].title).toContain('A');
  });

  test('.md 走 Markdown 解析器', async () => {
    const p = tmpFile('t2.md', '# 第一章 B\n内容');
    const tree = await parseTextbook(p);
    expect(tree.format).toBe('md');
  });

  test('不支持的扩展名报中文错误', async () => {
    const p = tmpFile('t3.xyz', 'x');
    await expect(parseTextbook(p)).rejects.toThrow(/不支持/);
  });

  test('非法 MOBI 文件报中文错误（内置解析，无需 calibre）', async () => {
    const p = tmpFile('t4.mobi', 'fake');
    await expect(parseTextbook(p)).rejects.toThrow(/MOBI/);
    await expect(parseTextbook(p)).rejects.not.toThrow(/calibre/i);
  });

  test('.azw3 走同一个内置解析器，格式记为 azw3', async () => {
    const html = Buffer.from('<p>第一章 开始</p><p>正文。</p>', 'utf-8');
    const rec0 = Buffer.alloc(256);
    rec0.writeUInt16BE(1, 0); rec0.writeUInt16BE(1, 8); rec0.write('MOBI', 16, 'ascii'); rec0.writeUInt32BE(65001, 28);
    const pdb = Buffer.alloc(78); pdb.write('BOOKMOBI', 60, 'ascii'); pdb.writeUInt16BE(2, 76);
    const table = Buffer.alloc(16); table.writeUInt32BE(94, 0); table.writeUInt32BE(94 + 256, 8);
    const p = path.join(os.tmpdir(), 't5.azw3');
    fs.writeFileSync(p, Buffer.concat([pdb, table, rec0, html]));
    const tree = await parseTextbook(p);
    expect(tree.format).toBe('azw3');
    expect(tree.chapters[0].paragraphs[0].text).toContain('正文');
  });
});
