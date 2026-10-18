import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import type { BookFormat, ChapterTree } from './types';
import { parseTxt } from './parsers/txt';
import { parseMarkdown } from './parsers/markdown';
import { parseEpub } from './parsers/epub';
import { parsePdf } from './parsers/pdf';
import { parseDocx } from './parsers/docx';

const EXT_TO_FORMAT: Record<string, BookFormat> = {
  '.txt': 'txt',
  '.md': 'md',
  '.markdown': 'md',
  '.epub': 'epub',
  '.pdf': 'pdf',
  '.docx': 'docx',
  '.mobi': 'mobi',
  '.azw3': 'azw3',
};

function findCalibre(): string | null {
  const candidates = ['ebook-convert', 'C:\\Program Files\\Calibre2\\ebook-convert.exe'];
  for (const c of candidates) {
    try {
      execFileSync(c, ['--version'], { stdio: 'pipe' });
      return c;
    } catch {
      // 不在 PATH 或不存在，继续找
    }
  }
  return null;
}

/** mobi/azw3 → calibre 转 epub → 走 EPUB 管线 */
function convertToEpub(filePath: string): Buffer {
  const calibre = findCalibre();
  if (!calibre) {
    throw new Error('解析 MOBI/AZW3 需要 calibre，请安装后重试：https://calibre-ebook.com/download');
  }
  const out = path.join(os.tmpdir(), `converted-${Date.now()}.epub`);
  execFileSync(calibre, [filePath, out], { stdio: 'pipe' });
  const buf = fs.readFileSync(out);
  fs.unlinkSync(out);
  return buf;
}

/** 统一入口：按扩展名分发到各格式解析器 */
export async function parseTextbook(filePath: string): Promise<ChapterTree> {
  const ext = path.extname(filePath).toLowerCase();
  const format = EXT_TO_FORMAT[ext];
  if (!format) {
    throw new Error(`不支持的教材格式 "${ext}"，支持：txt/md/epub/pdf/docx/mobi/azw3`);
  }
  const title = path.basename(filePath, ext);
  const buf = fs.readFileSync(filePath);

  switch (format) {
    case 'txt':
      return parseTxt(buf.toString('utf-8'), title);
    case 'md':
      return parseMarkdown(buf.toString('utf-8'), title);
    case 'epub':
      return parseEpub(buf, title);
    case 'pdf':
      return parsePdf(buf, title);
    case 'docx':
      return parseDocx(buf, title);
    case 'mobi':
    case 'azw3': {
      const epubBuf = convertToEpub(filePath);
      return parseEpub(epubBuf, title);
    }
  }
}
