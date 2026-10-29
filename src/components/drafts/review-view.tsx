'use client';

import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, CheckCircle2, Loader2, TriangleAlert } from 'lucide-react';
import { api, newKey } from '@/lib/api/client';
import { useBooks } from '@/lib/api/hooks';
import { queryKeys } from '@/lib/api/queries';
import { canMove, planCourse, type PointStatus } from '@/lib/verified-learning/draft-editor';
import { isWebSource, sourceDisplayName, sourceNoteLabel } from '@/lib/labels';
import { cn } from '@/lib/utils';
import type { ChoicesShape, FormDraft, ProposalPoint } from '@/lib/api/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/field';
import { Panel, Pill } from '@/components/ui/panel';
import { BlockError } from '@/components/states/block-states';
import { Roadmap, type PointMark } from '@/components/zhupi/roadmap';
import { CitationNote } from '@/components/zhupi/citation-note';
import { SourceDrawer, type SourceTarget } from '@/components/zhupi/source-drawer';

const ISSUE_LABEL: Record<string, string> = {
  EMPTY_TARGET: '还没有选择学习目标',
  EXCLUDED_PREREQUISITE: '排除了必需的先修知识点',
  INVALID_CITATION: '有出处无法在原文里找回',
  INVALID_ORDER: '顺序不合法：先修必须排在前面',
  PREREQUISITE_CYCLE: '先修关系出现循环',
  SOURCE_GAP: '教材里找不到这个知识点的出处',
  SUPPLEMENT_NOT_APPROVED: '用到的联网资料还没有认可',
  UNKNOWN_KNOWLEDGE: '先修指向了不存在的知识点',
};
const STATUS_TEXT: Record<PointStatus, string> = { target: '学习目标', auto: '自动加入的先修', declared: '已掌握，不教', excluded: '已排除', none: '不在本课' };

/** 方案审核：在先修路线图上核对与调整，保存后由后端重新校验；没有问题且勾选核对后才能确认 */
export function ReviewView({ draft, onChange, onBackToEdit }: { draft: FormDraft; onChange: (draft: FormDraft) => void; onBackToEdit: () => void }) {
  const router = useRouter();
  const client = useQueryClient();
  const books = useBooks();
  const review = draft.review!;
  const points = useMemo(() => review.proposal?.points ?? [], [review]);
  const byId = useMemo(() => new Map(points.map(p => [p.id, p])), [points]);
  const initial: ChoicesShape = review.choices ?? { targetIds: review.proposal?.targetIds ?? [], excludedIds: [], declaredIds: [], order: null, prerequisiteEdits: [], supplementalSourceIds: [] };
  const [choices, setChoices] = useState<ChoicesShape>(initial);
  const [dirty, setDirty] = useState(false);
  // 默认选中第一个学习目标，右侧面板一开始就有内容
  const [selected, setSelected] = useState<string | null>(initial.targetIds[0] ?? points[0]?.id ?? null);
  const [accepted, setAccepted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [drawer, setDrawer] = useState<SourceTarget | null>(null);

  const plan = useMemo(() => planCourse(points, choices), [points, choices]);
  const issues = review.report?.issues ?? [];
  const missingReason = choices.prerequisiteEdits.some(e => !e.reason.trim());
  const marks = Object.fromEntries(points.map(p => [p.id, plan.status.get(p.id) as PointMark]));
  const roadmapPoints = points.map(p => ({
    id: p.id, title: p.title,
    role: (plan.status.get(p.id) === 'target' ? 'target' : 'prerequisite') as 'target' | 'prerequisite',
    prerequisiteIds: plan.prereq.get(p.id) ?? p.prerequisiteIds,
  }));
  const textbookId = draft.input.textbookId;
  const supplemental = useMemo(() => {
    const ids = new Set<string>();
    for (const point of points) for (const c of point.citations) if (c.sourceId !== textbookId) ids.add(c.sourceId);
    return [...ids];
  }, [points, textbookId]);
  const bookTitle = (id: string) => books.data?.find(b => b.bookId === id)?.title ?? id;

  function patch(next: Partial<ChoicesShape>) {
    setChoices(previous => ({ ...previous, ...next }));
    setDirty(true);
    setAccepted(false);
  }
  /** 学习目标 / 已掌握 / 排除三者互斥 */
  function setStatus(id: string, status: 'target' | 'declared' | 'excluded' | 'none') {
    const without = (list: string[]) => list.filter(x => x !== id);
    patch({
      targetIds: status === 'target' ? [...without(choices.targetIds), id] : without(choices.targetIds),
      declaredIds: status === 'declared' ? [...without(choices.declaredIds), id] : without(choices.declaredIds),
      excludedIds: status === 'excluded' ? [...without(choices.excludedIds), id] : without(choices.excludedIds),
      order: null,
    });
  }
  function togglePrereq(point: ProposalPoint, dep: string) {
    const edit = choices.prerequisiteEdits.find(e => e.pointId === point.id);
    const current = edit?.prerequisiteIds ?? point.prerequisiteIds;
    const next = current.includes(dep) ? current.filter(x => x !== dep) : [...current, dep];
    const others = choices.prerequisiteEdits.filter(e => e.pointId !== point.id);
    const same = next.length === point.prerequisiteIds.length && next.every(x => point.prerequisiteIds.includes(x));
    patch({ prerequisiteEdits: same ? others : [...others, { pointId: point.id, prerequisiteIds: next, reason: edit?.reason ?? '' }], order: null });
  }
  function move(id: string, direction: -1 | 1) {
    if (!canMove(points, choices, plan.order, id, direction)) return;
    const order = [...plan.order];
    const index = order.indexOf(id);
    [order[index], order[index + direction]] = [order[index + direction], order[index]];
    patch({ order });
  }

  async function save(): Promise<FormDraft | null> {
    setSaving(true);
    setError(null);
    try {
      const saved = await api<FormDraft>(`/drafts/${draft.draftId}/choices`, { method: 'POST', body: { expectedRevision: draft.revision, choices }, key: newKey() });
      setDirty(false);
      if (saved.review?.choices) setChoices(saved.review.choices);
      onChange(saved);
      return saved;
    } catch (e) {
      setError(e);
      return null;
    } finally {
      setSaving(false);
    }
  }
  async function confirm() {
    setConfirming(true);
    setError(null);
    try {
      let revision = draft.revision;
      if (dirty) {
        const saved = await save();
        if (!saved) return;
        revision = saved.revision;
        if (saved.review?.report?.issues.length) return;
      }
      const result = await api<{ courseId: string; versionId: string; sessionId: string }>(`/drafts/${draft.draftId}/confirm`, { method: 'POST', body: { expectedRevision: revision, acceptSourceAndPrerequisiteReview: true }, key: newKey() });
      void client.invalidateQueries({ queryKey: queryKeys.courses() });
      void client.invalidateQueries({ queryKey: queryKeys.drafts() });
      router.push(`/learn/${result.sessionId}`);
    } catch (e) {
      setError(e);
    } finally {
      setConfirming(false);
    }
  }
  async function acceptResult() {
    setError(null);
    try {
      const updated = await api<FormDraft>(`/drafts/${draft.draftId}/accept-result`, { method: 'POST', body: { expectedRevision: draft.revision }, key: newKey() });
      if (updated.review?.choices) setChoices(updated.review.choices);
      setDirty(false);
      onChange(updated);
    } catch (e) {
      setError(e);
    }
  }

  const point = selected ? byId.get(selected) : null;
  const prereqOf = (p: ProposalPoint) => choices.prerequisiteEdits.find(e => e.pointId === p.id)?.prerequisiteIds ?? p.prerequisiteIds;
  const counts = { target: choices.targetIds.length, total: plan.order.length, declared: choices.declaredIds.length, excluded: choices.excludedIds.length };

  return (
    <div className="mt-6 grid gap-6">
      {review.stale && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-[var(--radius-paper)] bg-zhu-tint px-5 py-4 text-base">
          <p className="min-w-0 flex-1">生成之后草稿又改过了，这份方案对应的是修改前的内容。</p>
          <Button size="sm" onClick={() => void acceptResult()}>使用这次生成对应的内容</Button>
          <Button size="sm" variant="ghost" onClick={onBackToEdit}>返回编辑并重新生成</Button>
        </div>
      )}
      {issues.length > 0 && (
        <div role="alert" className="rounded-[var(--radius-paper)] bg-zhu-tint px-5 py-4">
          <p className="flex items-center gap-2 font-medium text-zhu-deep"><TriangleAlert className="size-4" aria-hidden />还有 {issues.length} 个问题，解决后才能确认</p>
          <ul className="mt-2 grid gap-1 text-base">
            {issues.map((issue, index) => (
              <li key={index}>
                {ISSUE_LABEL[issue.code] ?? issue.message}
                {issue.knowledgePointIds.length > 0 && <span className="text-muted">：{issue.knowledgePointIds.map(id => byId.get(id)?.title ?? id).join('、')}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      <Panel
        title="先修路线图"
        description={`${counts.target} 个学习目标，共教 ${counts.total} 个知识点${counts.declared ? `，${counts.declared} 个标为已掌握` : ''}${counts.excluded ? `，排除 ${counts.excluded} 个` : ''}。点知识点查看出处、调整目标或先修。`}
        actions={!review.stale && <Button size="sm" variant="ghost" onClick={onBackToEdit}>返回编辑</Button>}
      >
        <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted" aria-hidden>
          <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-4 rounded-[2px] border border-[#8f8e89] bg-paper" />学习目标</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-4 rounded-[2px] border border-[#dddcd7] bg-paper" />自动加入的先修</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-4 rounded-[2px] bg-raised" />已掌握</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-4 rounded-[2px] border border-dashed border-control" />已排除</span>
        </div>
        <Roadmap className="mt-4" points={roadmapPoints} evidence={{}} marks={marks} current={selected ?? undefined} onOpen={setSelected} showEvidence={false} currentLabel="已选中" />
      </Panel>

      <div className="grid grid-cols-[minmax(0,1fr)_24rem] items-start gap-6 max-lg:grid-cols-1">
        <div className="grid min-w-0 grid-cols-2 items-start gap-6 max-xl:grid-cols-1">
        <Panel title={point ? point.title : '知识点'} description={point ? STATUS_TEXT[plan.status.get(point.id) ?? 'none'] : '在上面的路线图中点一个知识点。'}>
          {point && (
            <>
              <fieldset className="mt-4">
                <legend className="text-sm text-muted">在本课中</legend>
                <div className="mt-2 flex flex-wrap gap-2">
                  {([['target', '设为学习目标'], ['none', '跟随先修自动决定'], ['declared', '我已掌握，不教'], ['excluded', '排除']] as const).map(([value, label]) => {
                    const current = choices.targetIds.includes(point.id) ? 'target' : choices.declaredIds.includes(point.id) ? 'declared' : choices.excludedIds.includes(point.id) ? 'excluded' : 'none';
                    return (
                      <label key={value} className={cn('cursor-pointer rounded-[var(--radius-control)] border px-3 py-1.5 text-base', current === value ? 'border-ink bg-ground font-medium' : 'border-line hover:border-control-strong')}>
                        <input type="radio" name={`status-${point.id}`} className="sr-only" checked={current === value} onChange={() => setStatus(point.id, value)} />
                        {label}
                      </label>
                    );
                  })}
                </div>
              </fieldset>
              <h3 className="mt-5 text-sm text-muted">出处（{point.citations.length}）</h3>
              {point.citations.length === 0 ? <p className="mt-1 text-base text-zhu">没有可回查的出处。</p> : (
                <ul className="mt-2 grid gap-3">
                  {point.citations.map((c, i) => (
                    <li key={i}>
                      <CitationNote
                        sourceLabel={isWebSource(c.sourceId) ? sourceNoteLabel(bookTitle(c.sourceId), c.sourceId) : '教材'}
                        paragraphIndex={c.paragraphIndex}
                        quote={c.quote.length > 120 ? `${c.quote.slice(0, 120)}…` : c.quote}
                        onOpen={() => setDrawer({ sourceId: c.sourceId, sourceRevision: c.sourceRevision, chapterId: c.chapterId, paragraphIndex: c.paragraphIndex })}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </Panel>

        <Panel title="调整先修" description={point ? '勾选学它之前必须先学的知识点；改动需要写原因。' : undefined}>
          {point && (
            <>
              <ul className="mt-4 grid max-h-80 gap-0.5 overflow-y-auto">
                {points.filter(p => p.id !== point.id).map(p => (
                  <li key={p.id}>
                    <label className="flex min-h-8 cursor-pointer items-center gap-2.5 rounded-[var(--radius-control)] px-2 text-base hover:bg-ground">
                      <input type="checkbox" className="size-4 accent-[var(--color-ink)]" checked={prereqOf(point).includes(p.id)} onChange={() => togglePrereq(point, p.id)} />
                      <span className="min-w-0 truncate">{p.title}</span>
                    </label>
                  </li>
                ))}
              </ul>
              {choices.prerequisiteEdits.some(e => e.pointId === point.id) && (
                <div className="mt-4 grid gap-1.5">
                  <label htmlFor="prereq-reason" className="text-base font-medium">调整原因<span className="ml-1 text-zhu" aria-hidden>*</span></label>
                  <Input
                    id="prereq-reason"
                    value={choices.prerequisiteEdits.find(e => e.pointId === point.id)?.reason ?? ''}
                    onChange={event => patch({ prerequisiteEdits: choices.prerequisiteEdits.map(e => (e.pointId === point.id ? { ...e, reason: event.target.value } : e)) })}
                    placeholder="例如：学过 C 语言，不需要先学变量"
                  />
                </div>
              )}
            </>
          )}
        </Panel>

        </div>
        <div className="sticky top-4 grid gap-6 max-lg:static">
          <Panel title="确认课程" tone={!dirty && issues.length === 0 && !review.stale ? 'zhu' : 'paper'}>
            {dirty && <p className="mt-2 text-base">有未保存的调整，保存后会重新校验。</p>}
            {missingReason && <p className="mt-2 text-base text-zhu">先修调整需要填写原因。</p>}
            <Button className="mt-4 w-full" disabled={!dirty || saving || missingReason} onClick={() => void save()}>
              {saving ? <Loader2 className="animate-spin" aria-hidden /> : null}{dirty ? '保存并校验调整' : '调整已保存'}
            </Button>
            <label className="mt-4 flex items-start gap-2.5 text-base">
              <input type="checkbox" className="mt-1 size-4 accent-[var(--color-ink)]" checked={accepted} onChange={event => setAccepted(event.target.checked)} />
              <span>我已核对出处覆盖与先修关系</span>
            </label>
            <Button variant="primary" className="mt-4 w-full" disabled={!accepted || confirming || saving || issues.length > 0 || review.stale || missingReason} onClick={() => void confirm()}>
              {confirming ? <Loader2 className="animate-spin" aria-hidden /> : <CheckCircle2 aria-hidden />}确认并创建课程
            </Button>
            {issues.length > 0 && <p className="mt-2 text-sm text-muted">解决上方的问题后才能确认。</p>}
            <BlockError className="mt-4" error={error} />
            <p className="mt-4 flex flex-wrap gap-1.5 text-xs text-muted">
              <Pill>目标 {counts.target}</Pill><Pill>共 {counts.total} 个</Pill>{counts.declared > 0 && <Pill>已掌握 {counts.declared}</Pill>}
            </p>
          </Panel>
          <Panel title="最终顺序" description={`实际按这个顺序教学。不能把知识点移到它的先修前面。`}>
            <ol className="mt-4 grid max-h-96 gap-0.5 overflow-y-auto">
              {plan.order.map((id, index) => (
                <li key={id} className={cn('grid grid-cols-[1.75rem_minmax(0,1fr)_auto] items-center gap-2 rounded-[var(--radius-control)] px-1 py-1 text-base', selected === id && 'bg-zhu-tint')}>
                  <span className="text-right text-sm tabular-nums text-muted">{index + 1}</span>
                  <button type="button" className="min-w-0 truncate text-left hover:text-zhu" onClick={() => setSelected(id)}>{byId.get(id)?.title ?? id}</button>
                  <span className="flex">
                    <Button size="icon" variant="ghost" className="size-7" aria-label={`上移 ${byId.get(id)?.title}`} disabled={!canMove(points, choices, plan.order, id, -1)} onClick={() => move(id, -1)}><ArrowUp aria-hidden /></Button>
                    <Button size="icon" variant="ghost" className="size-7" aria-label={`下移 ${byId.get(id)?.title}`} disabled={!canMove(points, choices, plan.order, id, 1)} onClick={() => move(id, 1)}><ArrowDown aria-hidden /></Button>
                  </span>
                </li>
              ))}
            </ol>
            {choices.order && <Button size="sm" variant="ghost" className="mt-2" onClick={() => patch({ order: null })}>恢复自动排序</Button>}
          </Panel>

          {supplemental.length > 0 && (
            <Panel title="联网补充的资料" description="方案用到了教材以外的公开网页，逐个认可后才能确认。">
              <ul className="mt-3 grid gap-1">
                {supplemental.map(id => (
                  <li key={id}>
                    <label className="flex min-h-8 cursor-pointer items-center gap-2.5 text-base">
                      <input
                        type="checkbox"
                        className="size-4 accent-[var(--color-ink)]"
                        checked={choices.supplementalSourceIds.includes(id)}
                        onChange={() => patch({ supplementalSourceIds: choices.supplementalSourceIds.includes(id) ? choices.supplementalSourceIds.filter(x => x !== id) : [...choices.supplementalSourceIds, id] })}
                      />
                      <span className="min-w-0 truncate">{sourceDisplayName(bookTitle(id), id)}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </Panel>
          )}


        </div>
      </div>
      <SourceDrawer target={drawer} onClose={() => setDrawer(null)} />
    </div>
  );
}
