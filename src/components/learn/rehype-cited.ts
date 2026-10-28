import { citedSentences } from '@/lib/citations';

/**
 * rehype 插件：在一块课件里，只给被引用的那几句话包上 <span class="cited">（朱批细下划线）。
 * 做法：收集块内全部文字节点（跳过代码与公式），拼成纯文本，用 citedSentences 求出句子区间，
 * 再把区间映射回各文字节点并切分。不改动文字本身。
 */
interface HastNode {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
}

const SKIP = new Set(['code', 'pre', 'math', 'svg']);
const skipped = (node: HastNode) =>
  (node.tagName && SKIP.has(node.tagName)) ||
  (Array.isArray(node.properties?.className) && (node.properties.className as string[]).some(c => c.startsWith('katex')));

export function rehypeCited(quotes: string[]) {
  return () => (tree: HastNode) => {
    if (quotes.length === 0) return;
    const texts: { parent: HastNode; node: HastNode; start: number }[] = [];
    let text = '';
    const walk = (parent: HastNode) => {
      for (const child of parent.children ?? []) {
        if (child.type === 'text') { texts.push({ parent, node: child, start: text.length }); text += child.value ?? ''; }
        else if (child.type === 'element' && !skipped(child)) walk(child);
      }
    };
    walk(tree);
    const ranges = citedSentences(text, quotes);
    if (ranges.length === 0) return;
    // 从后往前替换，前面节点的位置不受影响
    for (const { parent, node, start } of [...texts].reverse()) {
      const value = node.value ?? '';
      const end = start + value.length;
      const cuts = ranges.filter(([from, to]) => from < end && to > start);
      if (cuts.length === 0) continue;
      const pieces: HastNode[] = [];
      let cursor = start;
      for (const [from, to] of cuts) {
        const a = Math.max(from, start);
        const b = Math.min(to, end);
        if (a > cursor) pieces.push({ type: 'text', value: text.slice(cursor, a) });
        pieces.push({ type: 'element', tagName: 'span', properties: { className: ['cited'] }, children: [{ type: 'text', value: text.slice(a, b) }] });
        cursor = b;
      }
      if (cursor < end) pieces.push({ type: 'text', value: text.slice(cursor, end) });
      const siblings = parent.children!;
      siblings.splice(siblings.indexOf(node), 1, ...pieces);
    }
  };
}
