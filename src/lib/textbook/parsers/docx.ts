import mammoth from 'mammoth';
import type { ChapterTree } from '../types';
import { makeChapter, makeParagraph, resetParagraphCounter } from '../types';

/** DOCX 解析：mammoth 转 HTML 后按 h1-h3 分章 */
export async function parseDocx(buf: Buffer, title: string): Promise<ChapterTree> {
  resetParagraphCounter();
  const { value: html } = await mammoth.convertToHtml({ buffer: buf });

  const tree: ChapterTree = { title, format: 'docx', chapters: [] };
  let current = makeChapter('ch0', '前言', 1);
  let chapterNo = 0;

  const blocks = [...html.matchAll(/<(h[1-3]|p)[^>]*>([\s\S]*?)<\/\1>/gi)];
  for (const block of blocks) {
    const tag = block[1].toLowerCase();
    const text = block[2].replace(/<[^>]+>/g, '').trim();
    if (!text) continue;
    if (tag.startsWith('h')) {
      if (current.paragraphs.length > 0 || chapterNo > 0) tree.chapters.push(current);
      chapterNo += 1;
      current = makeChapter(`ch${chapterNo}`, text, Number(tag[1]));
    } else {
      current.paragraphs.push(makeParagraph(current.id, text));
    }
  }
  if (current.paragraphs.length > 0 || tree.chapters.length === 0) {
    tree.chapters.push(current);
  }
  return tree;
}
