/** 检索评测指标：只对已排序的段落编号列表计算，不依赖数据库 */

/** Recall@K：前 K 条命中覆盖了多少期望段落；期望为空视为 1 */
export function recallAtK(rankedParagraphs: readonly number[], expected: readonly number[], k: number): number {
  if (!expected.length) return 1;
  const top = [...new Set(rankedParagraphs.slice(0, k))];
  const hit = expected.filter(index => top.includes(index)).length;
  return hit / expected.length;
}

/** MRR：第一个命中期望段落的排名倒数 */
export function mrr(rankedParagraphs: readonly number[], expected: readonly number[]): number {
  if (!expected.length) return 1;
  const index = rankedParagraphs.findIndex(item => expected.includes(item));
  return index < 0 ? 0 : 1 / (index + 1);
}

/** 线性插值百分位；空数组返回 0 */
export function percentile(values: readonly number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0];
  const position = (Math.min(100, Math.max(0, p)) / 100) * (sorted.length - 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return lower === upper ? sorted[lower] : sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}