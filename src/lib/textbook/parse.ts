import fs from 'node:fs';
import path from 'node:path';
import type { BookFormat, ChapterTree } from './types';
import { parseTxt } from './parsers/txt';
import { parseMarkdown } from './parsers/markdown';
import { parseEpub } from './parsers/epub';
import { parsePdf } from './parsers/pdf';
import { parseDocx } from './parsers/docx';
import { parseMobi } from './parsers/mobi';

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

/** 统一入口：按扩展名分发到各格式解析器（MOBI/AZW3 走内置纯 JS 解析，无需 calibre） */
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
    case 'azw3':
      return parseMobi(buf, title);
  }
}
