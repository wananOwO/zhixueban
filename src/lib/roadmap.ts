/**
 * 先修路线图布局（纯函数）：层号 = 最长先修链长度；层内按其先修在上一层的平均行号排序以减少连线交叉。
 * 行号以 0.5 为步长、围绕 0 居中，便于在网格中按「半行」对齐。
 */
export interface RoadmapPoint {
  id: string;
  title: string;
  role: 'target' | 'prerequisite' | 'supplement';
  prerequisiteIds: string[];
}
export interface RoadmapLayout {
  columns: { id: string; row: number }[][];
  depth: Map<string, number>;
  /** 最大一层的节点数 */
  rows: number;
}

export function layoutRoadmap(points: RoadmapPoint[]): RoadmapLayout {
  const byId = new Map(points.map(p => [p.id, p]));
  const prerequisites = (p: RoadmapPoint) => p.prerequisiteIds.filter(id => byId.has(id) && id !== p.id);
  const depth = new Map<string, number>();
  const visiting = new Set<string>();
  const depthOf = (id: string): number => {
    const known = depth.get(id);
    if (known !== undefined) return known;
    if (visiting.has(id)) throw new Error('先修关系存在循环');
    visiting.add(id);
    const point = byId.get(id)!;
    const value = Math.max(-1, ...prerequisites(point).map(depthOf)) + 1;
    visiting.delete(id);
    depth.set(id, value);
    return value;
  };
  for (const point of points) depthOf(point.id);

  const groups: RoadmapPoint[][] = [];
  for (const point of points) {
    const index = depth.get(point.id)!;
    if (!groups[index]) groups[index] = [];
    groups[index].push(point);
  }
  const rowOf = new Map<string, number>();
  const average = (p: RoadmapPoint) => {
    const rows = prerequisites(p).map(id => rowOf.get(id) ?? 0);
    return rows.length ? rows.reduce((sum, r) => sum + r, 0) / rows.length : 0;
  };
  const columns = groups.map((group, index) => {
    const ordered = index === 0 ? group : [...group].sort((a, b) => average(a) - average(b));
    return ordered.map((point, j) => {
      const row = j - (ordered.length - 1) / 2;
      rowOf.set(point.id, row);
      return { id: point.id, row };
    });
  });
  return { columns, depth, rows: Math.max(0, ...columns.map(c => c.length)) };
}

/** 某个知识点及其全部直接、间接先修 */
export function ancestors(points: RoadmapPoint[], id: string): Set<string> {
  const byId = new Map(points.map(p => [p.id, p]));
  const result = new Set<string>([id]);
  const walk = (current: string) => {
    for (const pre of byId.get(current)?.prerequisiteIds ?? []) {
      if (!result.has(pre) && byId.has(pre)) { result.add(pre); walk(pre); }
    }
  };
  walk(id);
  return result;
}
