/** 书带：把 Agent 读过的段落区间合并（含相邻区间），便于计数与绘制 */
export function mergeRanges(ranges: [number, number][]): [number, number][] {
  const sorted = ranges.map(([a, b]) => [Math.min(a, b), Math.max(a, b)] as [number, number]).sort((x, y) => x[0] - y[0]);
  const merged: [number, number][] = [];
  for (const [from, to] of sorted) {
    const last = merged.at(-1);
    if (last && from <= last[1] + 1) last[1] = Math.max(last[1], to);
    else merged.push([from, to]);
  }
  return merged;
}

export function countParagraphs(ranges: [number, number][]): number {
  return mergeRanges(ranges).reduce((sum, [from, to]) => sum + (to - from + 1), 0);
}
