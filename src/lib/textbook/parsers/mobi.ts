import type { ChapterTree } from '../types';
import { parseTxt } from './txt';

/** 解压后正文上限：远大于常见教材（几 MB），用于拒绝解压炸弹 */
export const MAX_MOBI_TEXT_BYTES = 64 * 1024 * 1024;

function invalid(reason: string): never {
  throw new Error(`非法 MOBI 文件：${reason}`);
}

/**
 * PalmDOC LZ77 解压（MOBI compression=2）。
 * 0x00、0x09-0x7F 原样；0x01-0x08 拷贝后续 c 字节；0x80-0xBF 双字节回引（11 位距离 + 3 位长度）；
 * 0xC0-0xFF 空格 + (c^0x80)。回引超出已解出内容或总长超限时报错。
 */
export function palmdocDecompress(input: Buffer, limit = MAX_MOBI_TEXT_BYTES): Buffer {
  const out = Buffer.allocUnsafe(Math.min(limit, Math.max(4096, input.length * 8)));
  let size = 0;
  let buffer = out;
  const push = (byte: number) => {
    if (size >= limit) throw new Error('MOBI 正文过大，请转为 EPUB 后导入');
    if (size >= buffer.length) {
      const next = Buffer.allocUnsafe(Math.min(limit, buffer.length * 2));
      buffer.copy(next, 0, 0, size);
      buffer = next;
    }
    buffer[size++] = byte;
  };
  let i = 0;
  while (i < input.length) {
    const c = input[i++];
    if (c >= 0xc0) {
      push(0x20);
      push(c ^ 0x80);
    } else if (c >= 0x80) {
      if (i >= input.length) break;
      const pair = ((c << 8) | input[i++]) & 0x3fff;
      const distance = pair >> 3;
      const length = (pair & 0x07) + 3;
      if (distance === 0 || distance > size) invalid('压缩数据损坏');
      for (let j = 0; j < length; j++) push(buffer[size - distance]);
    } else if (c >= 0x01 && c <= 0x08) {
      for (let j = 0; j < c && i < input.length; j++) push(input[i++]);
    } else {
      push(c);
    }
  }
  return buffer.subarray(0, size);
}

const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** MOBI 正文是 HTML：去掉脚本与样式、标签换行，解码实体；不渲染、不执行 */
function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|blockquote|pre|tr)>/gi, '\n')
    .replace(/<mbp:pagebreak\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, body: string) => {
      if (body[0] !== '#') return NAMED[body.toLowerCase()] ?? entity;
      const code = body[1] === 'x' || body[1] === 'X' ? Number.parseInt(body.slice(2), 16) : Number.parseInt(body.slice(1), 10);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : ' ';
    });
}

/**
 * MOBI/AZW3 纯 JS 解析（不依赖 calibre）：
 * PDB 头 → 记录表 → record0（压缩方式、文本记录数、加密、编码）→ 逐记录解压 → 去 HTML → 按 TXT 分章。
 * 不支持：DRM 加密、HUFF/CDIC 压缩（提示转为 EPUB）。所有偏移先做越界检查。
 */
export function parseMobi(buf: Buffer, title: string, format: 'mobi' | 'azw3' = 'mobi'): ChapterTree {
  if (buf.length < 78 + 8) invalid('头部不完整');
  const numRecords = buf.readUInt16BE(76);
  if (numRecords < 2) invalid('没有文本记录');
  const tableEnd = 78 + numRecords * 8;
  if (tableEnd > buf.length) invalid('记录表不完整');
  const offsets = Array.from({ length: numRecords }, (_, i) => buf.readUInt32BE(78 + i * 8));
  for (let i = 0; i < numRecords; i++) {
    const end = i + 1 < numRecords ? offsets[i + 1] : buf.length;
    if (offsets[i] < tableEnd || offsets[i] > end || end > buf.length) invalid('记录偏移越界');
  }

  const rec0 = buf.subarray(offsets[0], offsets[1]);
  if (rec0.length < 16) invalid('头记录不完整');
  const compression = rec0.readUInt16BE(0);
  if (rec0.readUInt16BE(12) !== 0) throw new Error('这本 MOBI 有 DRM 加密，无法读取；请先去除加密或转为 EPUB 后导入');
  if (compression !== 1 && compression !== 2) throw new Error(`不支持的 MOBI 压缩方式（${compression}），请用 Calibre 转为 EPUB 后导入`);
  const textRecords = Math.min(rec0.readUInt16BE(8), numRecords - 1);
  if (textRecords < 1) invalid('没有文本记录');
  // MOBI 头里的文本编码：65001 = UTF-8，1252 = CP1252（按 latin1 近似）
  const encoding = rec0.length >= 32 && rec0.toString('ascii', 16, 20) === 'MOBI' ? rec0.readUInt32BE(28) : 65001;

  const parts: Buffer[] = [];
  let total = 0;
  for (let i = 1; i <= textRecords; i++) {
    const record = buf.subarray(offsets[i], i + 1 < numRecords ? offsets[i + 1] : buf.length);
    const part = compression === 2 ? palmdocDecompress(record, MAX_MOBI_TEXT_BYTES - total) : record;
    total += part.length;
    if (total > MAX_MOBI_TEXT_BYTES) throw new Error('MOBI 正文过大，请转为 EPUB 后导入');
    parts.push(part);
  }

  const raw = Buffer.concat(parts);
  const html = encoding === 1252 ? raw.toString('latin1') : raw.toString('utf-8');
  const tree = parseTxt(htmlToText(html), title);
  tree.format = format;
  return tree;
}
