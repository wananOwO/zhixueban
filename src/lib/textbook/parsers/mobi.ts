import type { ChapterTree } from '../types';
import { parseTxt } from './txt';

/**
 * PalmDOC LZ77 解压（MOBI compression=2）。
 * 规则：0x00 原样；0x01-0x08 拷贝后续 c 字节；0x09-0x7F 原样；
 * 0x80-0xBF 双字节回引（距离+长度）；0xC0-0xFB 空格 + (c^0x80)；0xFC-0xFF 原样。
 */
export function palmdocDecompress(input: Buffer): Buffer {
  const out: number[] = [];
  let i = 0;
  while (i < input.length) {
    const c = input[i++];
    if (c >= 0xc0 && c <= 0xfb) {
      out.push(0x20, c ^ 0x80);
    } else if (c >= 0x80 && c <= 0xbf) {
      if (i >= input.length) break;
      const next = input[i++];
      const distance = ((c << 8) | next) >> 3;
      const length = (next & 0x07) + 3;
      for (let j = 0; j < length; j++) {
        out.push(out[out.length - distance]);
      }
    } else if (c >= 0x01 && c <= 0x08) {
      for (let j = 0; j < c && i < input.length; j++) out.push(input[i++]);
    } else {
      out.push(c);
    }
  }
  return Buffer.from(out);
}

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"');
}

/**
 * MOBI/AZW3 纯 JS 解析（无 calibre 依赖）：
 * PDB 头 → record 表 → record0 取压缩方式与文本记录数 → 逐记录解压 → 去 HTML → 走 TXT 分章。
 * 注：带 DRM 或 KF8-only 的旧文件不支持，报错提示转换。
 */
export function parseMobi(buf: Buffer, title: string): ChapterTree {
  if (buf.length < 78) throw new Error('非法 MOBI 文件：头部不完整');
  const numRecords = buf.readUInt16BE(76);
  if (numRecords < 2) throw new Error('非法 MOBI 文件：无文本记录');

  const rec0Offset = buf.readUInt32BE(78);
  const rec0 = buf.subarray(rec0Offset);
  const compression = rec0.readUInt16BE(0);
  if (compression !== 1 && compression !== 2) {
    throw new Error(`不支持的 MOBI 压缩方式 (${compression})，请用 Calibre 转为 EPUB 后导入`);
  }
  const textRecordCount = Math.min(rec0.readUInt16BE(8), numRecords - 1);

  const parts: Buffer[] = [];
  for (let i = 1; i <= textRecordCount; i++) {
    const start = buf.readUInt32BE(78 + i * 8);
    const end = i + 1 < numRecords ? buf.readUInt32BE(78 + (i + 1) * 8) : buf.length;
    const rec = buf.subarray(start, end);
    parts.push(compression === 2 ? palmdocDecompress(rec) : rec);
  }

  const html = Buffer.concat(parts).toString('utf-8');
  const text = stripHtml(html);
  const tree = parseTxt(text, title);
  tree.format = 'mobi';
  return tree;
}
