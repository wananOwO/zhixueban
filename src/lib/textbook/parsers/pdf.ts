import type { ChapterTree } from '../types';
import { makeChapter, makeParagraph, resetParagraphCounter } from '../types';

export class PdfNoTextLayerError extends Error {
  constructor() {
    super('该 PDF 无文本层（可能是扫描版），请使用 OCR 版或转换后的文本版教材');
    this.name = 'PdfNoTextLayerError';
  }
}

const MIN_TEXT_LENGTH = 10; // 扫描版 PDF 抽取结果通常为 0；阈值仅用于区分有无文本层
const HEADING_MAX_CHARS = 60;

interface TextLine {
  text: string;
  fontSize: number;
}

/** PDF 解析：pdfjs 抽文本，大字号行聚类为章节标题 */
export async function parsePdf(buf: Buffer, title: string): Promise<ChapterTree> {
  resetParagraphCounter();
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;

  const lines: TextLine[] = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const tc = await page.getTextContent();
    for (const item of tc.items) {
      if (!('str' in item)) continue;
      const text = item.str.trim();
      if (!text) continue;
      lines.push({ text, fontSize: Math.round(item.transform[3] as number) });
    }
  }

  const totalText = lines.map((l) => l.text).join('');
  if (totalText.length < MIN_TEXT_LENGTH) throw new PdfNoTextLayerError();

  // 正文字号 = 出现次数最多的字号；显著大于它的短行视为标题
  const sizeFreq = new Map<number, number>();
  for (const l of lines) sizeFreq.set(l.fontSize, (sizeFreq.get(l.fontSize) ?? 0) + 1);
  const bodySize = [...sizeFreq.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
  const isHeading = (l: TextLine) =>
    l.fontSize >= bodySize * 1.4 && l.text.length <= HEADING_MAX_CHARS;

  const tree: ChapterTree = { title, format: 'pdf', chapters: [] };
  let current = makeChapter('ch0', '前言', 1);
  let chapterNo = 0;

  for (const line of lines) {
    if (isHeading(line)) {
      if (current.paragraphs.length > 0 || chapterNo > 0) tree.chapters.push(current);
      chapterNo += 1;
      current = makeChapter(`ch${chapterNo}`, line.text, 1);
    } else {
      current.paragraphs.push(makeParagraph(current.id, line.text));
    }
  }
  if (current.paragraphs.length > 0 || tree.chapters.length === 0) {
    tree.chapters.push(current);
  }
  return tree;
}
