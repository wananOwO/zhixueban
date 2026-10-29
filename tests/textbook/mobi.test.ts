import { describe, expect, test } from 'vitest';
import { MAX_MOBI_TEXT_BYTES, palmdocDecompress, parseMobi } from '@/lib/textbook/parsers/mobi';

/**
 * 构造最小 MOBI：PDB 头（78 字节）+ 记录表 + record0 + 文本记录。
 * compression 1 = 无压缩，2 = PalmDOC；encoding 65001 = UTF-8，1252 = CP1252。
 */
function makeMobi(html: string, options: { compression?: 1 | 2; encoding?: number; records?: Buffer[] } = {}): Buffer {
  const recordSize = 4096;
  const text = Buffer.from(html, 'utf-8');
  const records = options.records ?? Array.from({ length: Math.ceil(text.length / recordSize) || 1 }, (_, i) => text.subarray(i * recordSize, (i + 1) * recordSize));
  const numRecords = 1 + records.length;

  const rec0 = Buffer.alloc(256);
  rec0.writeUInt16BE(options.compression ?? 1, 0);
  rec0.writeUInt32BE(text.length, 4);
  rec0.writeUInt16BE(records.length, 8);
  rec0.writeUInt16BE(recordSize, 10);
  rec0.write('MOBI', 16, 'ascii');
  rec0.writeUInt32BE(232, 20); // MOBI 头长度
  rec0.writeUInt32BE(options.encoding ?? 65001, 28);

  const pdb = Buffer.alloc(78);
  pdb.write('测试书', 0, 'utf-8');
  pdb.write('BOOKMOBI', 60, 'ascii');
  pdb.writeUInt16BE(numRecords, 76);

  const table = Buffer.alloc(numRecords * 8);
  let offset = 78 + table.length;
  table.writeUInt32BE(offset, 0);
  offset += rec0.length;
  records.forEach((record, i) => { table.writeUInt32BE(offset, (i + 1) * 8); offset += record.length; });
  return Buffer.concat([pdb, table, rec0, ...records]);
}

describe('parseMobi：纯 JS 解析，无需 calibre', () => {
  test('无压缩 MOBI：抽文本、去 HTML 标签、按章分段', () => {
    const tree = parseMobi(makeMobi('<p>第一章 语法</p><p>变量与类型。</p><p>第二章 算法</p><p>排序。</p>'), '测试书');
    expect(tree.format).toBe('mobi');
    expect(tree.chapters.length).toBeGreaterThanOrEqual(2);
    expect(tree.chapters[0].title).toContain('语法');
    expect(tree.chapters[0].paragraphs[0].text).toContain('变量');
  });

  test('PalmDOC 压缩的 MOBI 能解开（含回引与转义的多字节字符）', () => {
    // ≥ 0x80 的原始字节（如 UTF-8 中文）必须用 0x01-0x08 前缀按原样拷贝
    const literal = (text: string) => { const bytes = Buffer.from(text, 'utf-8'); const out: number[] = []; for (let i = 0; i < bytes.length; i += 8) { const run = bytes.subarray(i, i + 8); out.push(run.length, ...run); } return out; };
    // 回引：0x8000 | (距离 << 3) | (长度 - 3)
    const backref = (distance: number, length: number) => { const v = 0x8000 | (distance << 3) | (length - 3); return [v >> 8, v & 0xff]; };
    const compressed = Buffer.from([...literal('<p>第一章 开始</p><p>abc'), ...backref(3, 3), ...literal('</p>')]);
    const tree = parseMobi(makeMobi('', { compression: 2, records: [compressed] }), '压缩书');
    expect(tree.chapters.flatMap(c => c.paragraphs.map(p => p.text)).join('\n')).toContain('abcabc');
  });

  test('CP1252 编码的英文书按 latin1 解码', () => {
    const records = [Buffer.from('<p>Chapter 1 Caf\xe9</p><p>Hello.</p>', 'latin1')];
    const tree = parseMobi(makeMobi('', { encoding: 1252, records }), 'Book');
    expect(tree.chapters.flatMap(c => [c.title, ...c.paragraphs.map(p => p.text)]).join('\n')).toContain('Café');
  });

  test('HTML 实体与脚本、样式不进入正文', () => {
    const tree = parseMobi(makeMobi('<p>第一章 实体</p><style>p{color:red}</style><script>alert(1)</script><p>a &lt; b &amp;&amp; c&#62;d &#x4e2d;</p>'), '书');
    const text = tree.chapters.flatMap(c => c.paragraphs.map(p => p.text)).join('\n');
    expect(text).toContain('a < b && c>d 中');
    expect(text).not.toMatch(/alert|color:red/);
  });

  test.each([
    ['头部不完整', Buffer.alloc(40)],
    ['没有文本记录', (() => { const b = makeMobi('<p>x</p>'); b.writeUInt16BE(1, 76); return b; })()],
    ['记录表越界', (() => { const b = makeMobi('<p>x</p>'); b.writeUInt32BE(0xfffffff0, 78 + 8); return b; })()],
    ['记录偏移倒序', (() => { const b = makeMobi('<p>第一章</p><p>正文</p>'); b.writeUInt32BE(10, 78 + 8); return b; })()],
  ])('非法文件报中文错误：%s', (_name, buf) => {
    expect(() => parseMobi(buf, '坏书')).toThrow(/MOBI/);
  });

  test('不支持的压缩方式（HUFF/CDIC）与 DRM 提示转换', () => {
    expect(() => parseMobi(makeMobi('<p>x</p>', { compression: 17480 as 2 }), '书')).toThrow(/压缩方式/);
    const drm = makeMobi('<p>x</p>');
    drm.writeUInt16BE(1, 78 + 2 * 8 + 12); // record0 偏移 12：encryption type ≠ 0
    expect(() => parseMobi(drm, '书')).toThrow(/DRM|加密/);
  });

  test('解压后正文超过上限时拒绝（防解压炸弹）', () => {
    // 每个 0xC1 解出 2 字节；构造远超上限的解压结果
    const bomb = Buffer.alloc(4096, 0xc1);
    const records = Array.from({ length: Math.ceil(MAX_MOBI_TEXT_BYTES / 8192) + 2 }, () => bomb);
    expect(() => parseMobi(makeMobi('', { compression: 2, records }), '炸弹')).toThrow(/过大/);
  });
});

describe('palmdocDecompress', () => {
  test('字面量与空格序列', () => {
    expect(palmdocDecompress(Buffer.from([0x68, 0x69, 0xc1])).toString('utf-8')).toBe('hi A');
  });
  test('回引距离超出已解出内容时报错，不读未定义数据', () => {
    expect(() => palmdocDecompress(Buffer.from([0x61, 0x80, 0x50]))).toThrow(/MOBI/);
  });
});
