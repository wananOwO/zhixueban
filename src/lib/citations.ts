import type { CitationView } from './api/types';

/**
 * 课件出处定位（纯函数）。
 * 课件正文是 Agent 用自己的话写的讲解，引用里是原书原句，二者通常不逐字相同。
 * 做法：把 Markdown 按块切开（标题、段落、列表、代码、表格），每个引用找最像它的那一块：
 * 先找原句精确出现的块，再按汉字二元组覆盖率取最高分；分数过低的归入所在小节的「本节出处」。
 * 只返回块边界与关联，不改动 Markdown 原文。
 */
export interface Block {
  kind: 'heading' | 'code' | 'text';
  markdown: string;
  /** 以 ## 二级标题划分的小节序号，第一个 ## 之前为 0 */
  section: number;
  citations: CitationView[];
}
export interface Section { index: number; unplaced: CitationView[] }

/** 低于这个覆盖率就不硬挂到某一块（按开发库真实课件校准：转述句约 0.25–0.7，无关句低于 0.15） */
const MIN_SCORE = 0.25;

export function splitBlocks(markdown: string): Omit<Block, 'citations' | 'section'>[] {
  const blocks: Omit<Block, 'citations' | 'section'>[] = [];
  let current: string[] = [];
  let fence: string | null = null;
  const flush = () => {
    if (current.length) blocks.push({ kind: 'text', markdown: current.join('\n') });
    current = [];
  };
  for (const line of markdown.split('\n')) {
    const fenceMark = /^\s*(```|~~~)/.exec(line)?.[1];
    if (fence) {
      current.push(line);
      if (fenceMark === fence) { blocks.push({ kind: 'code', markdown: current.join('\n') }); current = []; fence = null; }
      continue;
    }
    if (fenceMark) { flush(); fence = fenceMark; current.push(line); continue; }
    if (/^#{1,6}\s/.test(line)) { flush(); blocks.push({ kind: 'heading', markdown: line }); continue; }
    if (line.trim() === '') { flush(); continue; }
    // 列表项各自成块（缩进的续行与子列表留在父项里），旁注才能对齐到具体哪一条
    if (/^([-*+]|\d+[.)])\s/.test(line) && current.length && /^([-*+]|\d+[.)])\s/.test(current[0])) flush();
    current.push(line);
  }
  if (fence) blocks.push({ kind: 'code', markdown: current.join('\n') });
  else flush();
  return blocks;
}

const normalize = (text: string) => text.replace(/[\s`*_#>|[\]()（）【】，。、：；！？“”"'「」‘’,.:;!?\\-]/g, '').toLowerCase();

function bigrams(text: string): Map<string, number> {
  const n = normalize(text);
  const out = new Map<string, number>();
  for (let i = 0; i < n.length - 1; i++) {
    const g = n.slice(i, i + 2);
    out.set(g, (out.get(g) ?? 0) + 1);
  }
  return out;
}

/** 原句的二元组有多少出现在这一块里 */
function coverage(quote: Map<string, number>, block: Map<string, number>): number {
  let hit = 0;
  let total = 0;
  for (const [gram, count] of quote) {
    total += count;
    hit += Math.min(count, block.get(gram) ?? 0);
  }
  return total ? hit / total : 0;
}

export function attachCitations(markdown: string, citations: CitationView[]): { blocks: Block[]; sections: Section[] } {
  let section = -1;
  const raw = splitBlocks(markdown);
  const hasSections = raw.some(b => b.kind === 'heading' && /^##\s/.test(b.markdown));
  const blocks: Block[] = raw.map(b => {
    if (b.kind === 'heading' && /^##\s/.test(b.markdown)) section++;
    return { ...b, section: hasSections ? Math.max(0, section) : 0, citations: [] };
  });
  const sections: Section[] = Array.from({ length: Math.max(1, section + 1) }, (_, index) => ({ index, unplaced: [] }));
  const grams = blocks.map(b => (b.kind === 'heading' ? null : bigrams(b.markdown)));
  const seen = new Set<string>();
  // 定位不到的引用：按提交顺序跟随前一个（没有则后一个）已定位引用的小节；都没有时放最后一节
  const placement: (number | CitationView)[] = [];

  for (const citation of citations) {
    const key = `${citation.sourceId}#${citation.paragraphIndex}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const quote = normalize(citation.quote);
    let best = -1;
    let bestScore = 0;
    blocks.forEach((block, index) => {
      if (block.kind === 'heading') return;
      const score = quote && normalize(block.markdown).includes(quote) ? 1 + quote.length : coverage(bigrams(citation.quote), grams[index]!);
      if (score > bestScore) { bestScore = score; best = index; }
    });
    if (best >= 0 && bestScore >= MIN_SCORE) { blocks[best].citations.push(citation); placement.push(blocks[best].section); }
    else placement.push(citation);
  }
  placement.forEach((item, i) => {
    if (typeof item === 'number') return;
    const before = placement.slice(0, i).reverse().find(x => typeof x === 'number') as number | undefined;
    const after = placement.slice(i + 1).find(x => typeof x === 'number') as number | undefined;
    sections[before ?? after ?? sections.length - 1].unplaced.push(item);
  });
  for (const block of blocks) block.citations.sort((a, b) => a.paragraphIndex - b.paragraphIndex);
  return { blocks, sections };
}

export type TutorPiece = { type: 'text'; text: string } | { type: 'cite'; sourceId: string; paragraphIndex: number };

/** 句子级定位的最低覆盖率：比块级略低，因为一句话的二元组少 */
const SENTENCE_SCORE = 0.2;

/**
 * 在一块的纯文本里找出被引用的句子（按中文句号、问号、叹号与换行切分），
 * 每条引用取覆盖率最高的一句，返回去重、按位置排序的 [起, 止) 区间。用于只在那一句下画朱批线。
 */
export function citedSentences(text: string, quotes: string[]): [number, number][] {
  const sentences: [number, number][] = [];
  const pattern = /[^。！？!?\n]+[。！？!?]*/g;
  for (const match of text.matchAll(pattern)) {
    const raw = match[0];
    const lead = raw.length - raw.trimStart().length;
    const body = raw.trim();
    if (!normalize(body)) continue;
    const start = (match.index ?? 0) + lead;
    sentences.push([start, start + body.length]);
  }
  const picked = new Map<number, [number, number]>();
  for (const quote of quotes) {
    const grams = bigrams(quote);
    let best = -1;
    let bestScore = 0;
    sentences.forEach(([from, to], index) => {
      const score = coverage(grams, bigrams(text.slice(from, to)));
      if (score > bestScore) { bestScore = score; best = index; }
    });
    if (best >= 0 && bestScore >= SENTENCE_SCORE) picked.set(sentences[best][0], sentences[best]);
  }
  return [...picked.values()].sort((a, b) => a[0] - b[0]);
}

/** 拆出助教回答里的〔来源ID·第N段〕出处标记 */
export function parseTutorCitations(text: string): TutorPiece[] {
  const pieces: TutorPiece[] = [];
  const pattern = /〔([^〔〕·\s]+)·第\s*(\d+)\s*段〕/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > last) pieces.push({ type: 'text', text: text.slice(last, index) });
    pieces.push({ type: 'cite', sourceId: match[1], paragraphIndex: Number(match[2]) });
    last = index + match[0].length;
  }
  if (last < text.length) pieces.push({ type: 'text', text: text.slice(last) });
  return pieces;
}
