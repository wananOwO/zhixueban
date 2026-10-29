import type { ProgrammingLanguageName } from '@/lib/api/types';

export type PointStatus = 'target' | 'auto' | 'declared' | 'excluded' | 'none';
interface PlanPoint { id: string; prerequisiteIds: string[] }
interface PlanChoices { targetIds: string[]; excludedIds: string[]; declaredIds: string[]; order: string[] | null; prerequisiteEdits: { pointId: string; prerequisiteIds: string[] }[] }

/** 与后端 compileCurriculum 相同的纳入与排序规则，用于审核页展示最终课程。 */
export function planCourse(points: PlanPoint[], choices: PlanChoices) {
  const prereq = new Map(points.map(p => [p.id, choices.prerequisiteEdits.find(e => e.pointId === p.id)?.prerequisiteIds ?? p.prerequisiteIds]));
  const declared = new Set(choices.declaredIds), included = new Set<string>();
  const include = (id: string) => {
    if (included.has(id) || !prereq.has(id)) return;
    included.add(id);
    for (const dep of prereq.get(id)!) if (!declared.has(dep)) include(dep);
  };
  for (const id of choices.targetIds) include(id);
  const pending = points.map(p => p.id).filter(id => included.has(id)), auto: string[] = [], ready = new Set(declared);
  while (pending.length) {
    const i = pending.findIndex(id => prereq.get(id)!.every(dep => ready.has(dep) || !prereq.has(dep)));
    if (i < 0) { auto.push(...pending); break; }
    const [id] = pending.splice(i, 1); auto.push(id); ready.add(id);
  }
  const manual = choices.order && choices.order.length === included.size && choices.order.every(id => included.has(id));
  const status = new Map<string, PointStatus>(points.map(p => [p.id,
    choices.excludedIds.includes(p.id) ? 'excluded' : declared.has(p.id) ? 'declared'
      : choices.targetIds.includes(p.id) ? 'target' : included.has(p.id) ? 'auto' : 'none']));
  return { order: manual ? [...choices.order!] : auto, status, prereq };
}

/** 只允许不违反先修顺序的移动。 */
export function canMove(points: PlanPoint[], choices: PlanChoices, order: string[], id: string, direction: -1 | 1) {
  const i = order.indexOf(id), j = i + direction;
  if (i < 0 || j < 0 || j >= order.length) return false;
  const prereq = planCourse(points, choices).prereq;
  const [first, second] = direction < 0 ? [id, order[j]] : [order[j], id];
  return !prereq.get(first)?.includes(second);
}

export const subjectLabels: Record<string, string> = { computer: '计算机', math: '数学', physics: '物理', biology: '生物', language: '语言', general: '通识' };
export function teachingSelection(template: { templateId: string; subjectType?: string }, language: ProgrammingLanguageName | null) {
  const subjectType = template.subjectType || 'general';
  return { templateId: template.templateId, subjectType, programmingLanguage: subjectType === 'computer' ? language ?? 'python' : null };
}
export function generationProblems(input: { goal: string; textbookId: string | null; sources: { sourceId: string; chapterIds: string[] }[] }): string[] {
  const problems: string[] = [];
  if (!input.goal.trim()) problems.push('请填写学习目标');
  if (!input.textbookId || !input.sources.some(s => s.sourceId === input.textbookId)) problems.push('请选择主教材');
  input.sources.forEach((s, i) => { if (!s.chapterIds.length) problems.push(`请为第 ${i + 1} 本教材选择章节`); });
  return problems;
}

/** 串行落盘；同一请求失败后显式重试保留原输入、修订号和幂等键。 */
export class DraftSaveQueue<T> {
  private pending: { input: T } | null = null;
  private retry: { item: { input: T }; revision: number; key: string } | null = null;
  private running: Promise<void> | null = null;
  constructor(private readonly send: (input: T, revision: number, key: string) => Promise<number>, public revision: number) {}
  get dirty() { return this.pending !== null || this.retry !== null; }
  update(input: T) { this.pending = { input }; }
  flush(): Promise<void> {
    if (this.running) return this.running;
    this.running = this.drain().finally(() => { this.running = null; });
    return this.running;
  }
  private async drain() {
    while (this.pending || this.retry) {
      const attempt = this.retry ?? { item: this.pending!, revision: this.revision, key: crypto.randomUUID() };
      this.retry = attempt;
      this.revision = await this.send(attempt.item.input, attempt.revision, attempt.key);
      if (this.pending === attempt.item) this.pending = null;
      this.retry = null;
    }
  }
}
