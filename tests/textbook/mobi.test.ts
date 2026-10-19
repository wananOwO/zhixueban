import { describe, expect, test } from 'vitest';
import { parseMobi, palmdocDecompress } from '@/lib/textbook/parsers/mobi';

/** 构造最小 MOBI（PalmDOC 无压缩格式） */
function makeMobi(html: string): Buffer {
  const text = Buffer.from(html, 'utf-8');
  const recordSize = 4096;
  const recordCount = Math.ceil(text.length / recordSize) || 1;
  const numRecords = 1 + recordCount; // header + text records

  const headerSize = 78 + numRecords * 8;
  const rec0 = Buffer.alloc(256);
  rec0.writeUInt16BE(1, 0); // compression = 无
  rec0.writeUInt32BE(text.length, 4); // text length
  rec0.writeUInt16BE(recordCount, 8); // text record count
  rec0.writeUInt16BE(recordSize, 10); // record size
  rec0.write('MOBI', 16, 'ascii');

  const pdb = Buffer.alloc(78);
  pdb.write('测试书', 0, 'utf-8');
  pdb.writeUInt16BE(numRecords, 76);

  const table = Buffer.alloc(numRecords * 8);
  let offset = headerSize;
  const recOffsets: number[] = [offset];
  table.writeUInt32BE(offset, 0);
  offset += rec0.length;
  for (let i = 1; i < numRecords; i++) {
    recOffsets.push(offset);
    table.writeUInt32BE(offset, i * 8);
    offset += Math.min(recordSize, text.length - (i - 1) * recordSize);
  }

  const textRecs: Buffer[] = [];
  for (let i = 0; i < recordCount; i++) {
    textRecs.push(text.subarray(i * recordSize, (i + 1) * recordSize));
  }
  return Buffer.concat([pdb, table, rec0, ...textRecs]);
}

describe('parseMobi', () => {
  test('解析无压缩 MOBI：抽文本、去 HTML 标签、分章', () => {
    const buf = makeMobi('<p>第一章 语法</p><p>变量与类型。</p><p>第二章 算法</p><p>排序。</p>');
    const tree = parseMobi(buf, '测试书');
    expect(tree.format).toBe('mobi');
    expect(tree.chapters.length).toBeGreaterThanOrEqual(2);
    expect(tree.chapters[0].title).toContain('语法');
    expect(tree.chapters[0].paragraphs[0].text).toContain('变量');
  });

  test('PalmDOC 解压：字面量与空格序列', () => {
    // 0xC0|ch 序列 = 空格 + (ch ^ 0x80)。'A'=0x41 → 编码 0xC1
    const compressed = Buffer.from([0x68, 0x69, 0xc1]); // "hi" + " A"
    expect(palmdocDecompress(compressed).toString('utf-8')).toBe('hi A');
  });
});
