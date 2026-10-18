import type { ChapterTree } from '../types';
import { makeChapter, makeParagraph, resetParagraphCounter } from '../types';

const CHAPTER_PATTERNS = [
  /^\s*第[一二三四五六七八九十百千\d]+[章节篇部卷][\s:：、]?.*/,
  /^\s*\d+(\.\d+)*[、.\s]\s*\S+.*/,
];

const FALLBACK_CHUNK_SIZE = 2000;

function isChapterHeading(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length === 0 || trimmed.length > 60) return false;
  return CHAPTER_PATTERNS.some((p) => p.test(trimmed));
}

/** TXT 解析：按常见章节标记分章；无标记时按固定长度降级为伪章节 */
export function parseTxt(content: string, title: string): ChapterTree {
  resetParagraphCounter();
  const lines = content.split(/\r?\n/);
  const hasHeadings = lines.some(isChapterHeading);

  if (!hasHeadings) {
    return fallbackChapters(content, title);
  }

  const tree: ChapterTree = { title, format: 'txt', chapters: [] };
  let current = makeChapter('ch0', '前言', 1);
  let chapterNo = 0;

  for (const line of lines) {
    if (isChapterHeading(line)) {
      if (current.paragraphs.length > 0 || chapterNo > 0) tree.chapters.push(current);
      chapterNo += 1;
      current = makeChapter(`ch${chapterNo}`, line.trim(), 1);
    } else if (line.trim().length > 0) {
      current.paragraphs.push(makeParagraph(current.id, line.trim()));
    }
  }
  if (current.paragraphs.length > 0 || tree.chapters.length === 0) {
    tree.chapters.push(current);
  }
  return tree;
}

function fallbackChapters(content: string, title: string): ChapterTree {
  const tree: ChapterTree = { title, format: 'txt', chapters: [] };
  const paragraphs = content
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  let chapterNo = 0;
  let current = makeChapter('ch0', `第 1 部分`, 1);
  let currentSize = 0;

  const pushText = (text: string) => {
    current.paragraphs.push(makeParagraph(current.id, text));
    currentSize += text.length;
  };
  const rotate = () => {
    tree.chapters.push(current);
    chapterNo += 1;
    current = makeChapter(`ch${chapterNo}`, `第 ${chapterNo + 1} 部分`, 1);
    currentSize = 0;
  };

  for (const p of paragraphs) {
    let rest = p;
    while (rest.length > 0) {
      if (currentSize >= FALLBACK_CHUNK_SIZE) rotate();
      const capacity = FALLBACK_CHUNK_SIZE - currentSize;
      pushText(rest.slice(0, capacity));
      rest = rest.slice(capacity);
    }
  }
  if (current.paragraphs.length > 0) tree.chapters.push(current);
  return tree;
}
