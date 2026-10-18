import type { ChapterTree } from '../types';
import { makeChapter, makeParagraph, resetParagraphCounter } from '../types';

const HEADING_RE = /^(#{1,6})\s+(.+)$/;

/** Markdown 解析：按 # 层级分章，level 即 # 数量 */
export function parseMarkdown(content: string, title: string): ChapterTree {
  resetParagraphCounter();
  const lines = content.split(/\r?\n/);
  const tree: ChapterTree = { title, format: 'md', chapters: [] };
  let current = makeChapter('ch0', '前言', 1);
  let chapterNo = 0;

  for (const line of lines) {
    const m = HEADING_RE.exec(line);
    if (m) {
      if (current.paragraphs.length > 0 || chapterNo > 0) tree.chapters.push(current);
      chapterNo += 1;
      current = makeChapter(`ch${chapterNo}`, m[2].trim(), m[1].length);
    } else if (line.trim().length > 0) {
      current.paragraphs.push(makeParagraph(current.id, line.trim()));
    }
  }
  if (current.paragraphs.length > 0 || tree.chapters.length === 0) {
    tree.chapters.push(current);
  }
  return tree;
}
