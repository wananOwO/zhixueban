'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Loader2,
  TriangleAlert,
} from 'lucide-react';
import {
  api,
  newKey,
  type ChoicesShape,
  type FormDraft,
  type ProposalPoint,
} from '@/lib/verified-learning/client';
import ErrorBox from '@/components/verified-learning/error-box';
import { canMove, planCourse, type PointStatus } from '@/lib/verified-learning/draft-editor';

const STATUS_LABEL: Record<PointStatus, { text: string; className: string }> = {
  target: { text: '学习目标', className: 'bg-accent/10 text-accent' },
  auto: { text: '自动包含（先修）', className: 'bg-success/10 text-success' },
  declared: { text: '已掌握，不教', className: 'bg-muted text-muted-foreground' },
  excluded: { text: '已排除', className: 'bg-danger/10 text-danger' },
  none: { text: '不教', className: 'bg-muted text-muted-foreground' },
};

const ISSUE_LABEL: Record<string, string> = {
  EMPTY_TARGET: '未选择目标知识点',
  EXCLUDED_PREREQUISITE: '排除了必需的先修知识点',
  INVALID_CITATION: '来源引用无法回查',
  INVALID_ORDER: '顺序不合法：先修必须排在前面',
  PREREQUISITE_CYCLE: '先修关系存在循环',
  SOURCE_GAP: '教材缺少该知识点的可核对来源',
  SUPPLEMENT_NOT_APPROVED: '补充资料需要明确确认',
  UNKNOWN_KNOWLEDGE: '未知知识点',
};

export default function ReviewPanel({
  draft,
  onChanged,
  onBackToEdit,
}: {
  draft: FormDraft;
  onChanged: (draft: FormDraft) => void;
  onBackToEdit: () => void;
}) {
  const router = useRouter();
  const review = draft.review!;
  const points = useMemo(() => review.proposal?.points ?? [], [review]);
  const pointMap = useMemo(
    () => new Map(points.map((p) => [p.id, p])),
    [points],
  );

  const [choices, setChoices] = useState<ChoicesShape>(
    review.choices ?? {
      targetIds: review.proposal?.targetIds ?? [],
      excludedIds: [],
      declaredIds: [],
      order: null,
      prerequisiteEdits: [],
      supplementalSourceIds: [],
    },
  );
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [openPrereq, setOpenPrereq] = useState<string | null>(null);

  const issues = review.report?.issues ?? [];
  // 补充来源：引用中出现但不是主教材的来源
  const supplemental = useMemo(() => {
    const textbookId = review.report?.input?.textbookId ?? draft.input.textbookId;
    const ids = new Set<string>();
    for (const point of points) {
      for (const citation of point.citations) {
        if (citation.sourceId !== textbookId) ids.add(citation.sourceId);
      }
    }
    return [...ids];
  }, [points, review, draft.input.textbookId]);

  function patch(next: Partial<ChoicesShape>) {
    setChoices((prev) => ({ ...prev, ...next }));
    setDirty(true);
  }

  function toggleIn(field: 'targetIds' | 'excludedIds' | 'declaredIds', id: string) {
    const list = choices[field];
    const has = list.includes(id);
    const next: Partial<ChoicesShape> = { [field]: has ? list.filter((x) => x !== id) : [...list, id], order: null };
    // 目标/已掌握/排除互斥
    if (!has) for (const other of ['targetIds', 'excludedIds', 'declaredIds'] as const) if (other !== field) next[other] = choices[other].filter((x) => x !== id);
    patch(next);
  }

  const plan = useMemo(() => planCourse(points, choices), [points, choices]);
  const orderedTargets = plan.order;

  function move(id: string, direction: -1 | 1) {
    if (!canMove(points, choices, orderedTargets, id, direction)) return;
    const order = [...orderedTargets];
    const index = order.indexOf(id);
    [order[index], order[index + direction]] = [order[index + direction], order[index]];
    patch({ order });
  }

  function prereqEdit(point: ProposalPoint) {
    return choices.prerequisiteEdits.find((e) => e.pointId === point.id);
  }

  function togglePrereq(point: ProposalPoint, depId: string) {
    const existing = prereqEdit(point);
    const current = existing ? existing.prerequisiteIds : point.prerequisiteIds;
    const has = current.includes(depId);
    const nextIds = has ? current.filter((x) => x !== depId) : [...current, depId];
    const edits = choices.prerequisiteEdits.filter((e) => e.pointId !== point.id);
    if (nextIds.join() !== point.prerequisiteIds.join()) {
      const reason = existing?.reason ?? '';
      edits.push({ pointId: point.id, prerequisiteIds: nextIds, reason });
    }
    patch({ prerequisiteEdits: edits, order: null });
  }

  function setPrereqReason(point: ProposalPoint, reason: string) {
    const existing = prereqEdit(point);
    if (!existing) return;
    patch({
      prerequisiteEdits: choices.prerequisiteEdits.map((e) =>
        e.pointId === point.id ? { ...e, reason } : e,
      ),
    });
  }

  async function saveChoices(): Promise<FormDraft | null> {
    setSaving(true);
    setError(null);
    try {
      const saved = await api<FormDraft>(
        `/drafts/${draft.draftId}/choices`,
        'POST',
        { expectedRevision: draft.revision, choices },
        newKey(),
      );
      setDirty(false);
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
        const saved = await saveChoices();
        if (!saved) return;
        revision = saved.revision;
        onChanged(saved);
        if (saved.review?.report?.issues.length) return;
      }
      const result = await api<{ courseId: string; versionId: string; sessionId: string }>(
        `/drafts/${draft.draftId}/confirm`,
        'POST',
        { expectedRevision: revision, acceptSourceAndPrerequisiteReview: true },
        newKey(),
      );
      router.push(`/verified-learning/learn/${result.sessionId}`);
    } catch (e) {
      setError(e);
    } finally {
      setConfirming(false);
    }
  }

  const missingPrereqReason = choices.prerequisiteEdits.some((e) => !e.reason.trim());

  return (
    <div className="space-y-6">
      {review.stale && (
        <div
          role="alert"
          className="rounded-md border border-warning/40 bg-warning/5 px-4 py-3 text-sm"
        >
          <p className="font-medium text-warning">生成后表单又被修改过，这份方案对应的是修改前的输入。</p>
          <p className="mt-1 text-muted-foreground">
            可以返回编辑后重新生成，或明确选择「使用这次生成对应的输入」恢复到当时的表单内容。
          </p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={async () => {
                setError(null);
                try {
                  const updated = await api<FormDraft>(
                    `/drafts/${draft.draftId}/accept-result`,
                    'POST',
                    { expectedRevision: draft.revision },
                    newKey(),
                  );
                  if (updated.review?.choices) setChoices(updated.review.choices);
                  setDirty(false);
                  onChanged(updated);
                } catch (e) {
                  setError(e);
                }
              }}
              className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted"
            >
              使用这次生成对应的输入
            </button>
            <button
              type="button"
              onClick={onBackToEdit}
              className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted"
            >
              返回编辑并重新生成
            </button>
          </div>
        </div>
      )}

      {issues.length > 0 && (
        <div role="alert" className="rounded-md border border-danger/40 bg-danger/5 px-4 py-3">
          <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-danger">
            <TriangleAlert aria-hidden className="h-4 w-4" />
            有 {issues.length} 个问题需要解决后才能确认课程
          </p>
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {issues.map((issue, index) => (
              <li key={index}>
                <strong>{ISSUE_LABEL[issue.code] ?? issue.code}</strong>
                {issue.knowledgePointIds.length > 0 && (
                  <span className="text-muted-foreground">
                    （{issue.knowledgePointIds.map((id) => pointMap.get(id)?.title ?? id).join('、')}）
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <ErrorBox error={error} />
      {!review.stale && <button type="button" onClick={onBackToEdit} disabled={saving || confirming} className="text-sm text-accent underline">返回编辑</button>}

      {supplemental.length > 0 && (
        <section className="rounded-lg border border-border p-4">
          <h3 className="mb-2 text-sm font-semibold">补充资料确认</h3>
          <p className="mb-2 text-xs text-muted-foreground">
            方案引用了主教材之外的资料来源，需要逐一明确认可：
          </p>
          <ul className="space-y-1">
            {supplemental.map((sourceId) => (
              <li key={sourceId}>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={choices.supplementalSourceIds.includes(sourceId)}
                    onChange={() => {
                      const has = choices.supplementalSourceIds.includes(sourceId);
                      patch({
                        supplementalSourceIds: has
                          ? choices.supplementalSourceIds.filter((x) => x !== sourceId)
                          : [...choices.supplementalSourceIds, sourceId],
                      });
                    }}
                  />
                  认可来源 <code className="rounded bg-muted px-1 text-xs">{sourceId}</code>
                </label>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="final-course" className="rounded-lg border border-border p-4">
        <h3 id="final-course" className="mb-1 text-sm font-semibold">最终课程顺序（共 {orderedTargets.length} 个知识点）</h3>
        <p className="mb-3 text-xs text-muted-foreground">课程实际按此顺序教学。学习目标所需的先修会自动包含并排在前面；只有标记“已掌握”或“排除”才不教。调整顺序时不能把知识点移到它的先修前面。</p>
        <ol className="space-y-1">
          {orderedTargets.map((id, index) => {
            const label = STATUS_LABEL[plan.status.get(id) ?? 'none'];
            return (
              <li key={id} className="flex items-center gap-2 text-sm">
                <span className="w-6 text-right text-xs text-muted-foreground">{index + 1}</span>
                <span className="min-w-0 flex-1">{pointMap.get(id)?.title ?? id}</span>
                <span className={`rounded px-1.5 py-0.5 text-xs ${label.className}`}>{label.text}</span>
                <button type="button" onClick={() => move(id, -1)} disabled={!canMove(points, choices, orderedTargets, id, -1)} aria-label={`上移 ${pointMap.get(id)?.title ?? id}`} className="rounded p-1 hover:bg-muted disabled:opacity-30"><ArrowUp aria-hidden className="h-3.5 w-3.5" /></button>
                <button type="button" onClick={() => move(id, 1)} disabled={!canMove(points, choices, orderedTargets, id, 1)} aria-label={`下移 ${pointMap.get(id)?.title ?? id}`} className="rounded p-1 hover:bg-muted disabled:opacity-30"><ArrowDown aria-hidden className="h-3.5 w-3.5" /></button>
              </li>
            );
          })}
        </ol>
        {choices.order && <button type="button" onClick={() => patch({ order: null })} className="mt-2 text-xs text-accent underline">恢复自动排序</button>}
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold">
          候选知识点（{choices.targetIds.length} 个学习目标 / {points.length} 个候选）
        </h3>
        <ul className="space-y-2">
          {points.map((point) => {
            const isTarget = choices.targetIds.includes(point.id);
            const isExcluded = choices.excludedIds.includes(point.id);
            const isDeclared = choices.declaredIds.includes(point.id);
            const prereq = prereqEdit(point)?.prerequisiteIds ?? point.prerequisiteIds;
            const label = STATUS_LABEL[plan.status.get(point.id) ?? 'none'];
            return (
              <li
                key={point.id}
                className={`rounded-lg border px-4 py-3 ${
                  isExcluded ? 'border-border opacity-60' : 'border-border'
                }`}
              >
                <div className="flex flex-wrap items-center gap-3">
                  <span className={`rounded px-1.5 py-0.5 text-xs ${label.className}`}>{label.text}</span>
                  <span className="min-w-0 flex-1 font-medium">{point.title}</span>
                  <label className="flex items-center gap-1.5 text-xs">
                    <input
                      type="checkbox"
                      checked={isTarget}
                      onChange={() => toggleIn('targetIds', point.id)}
                    />
                    设为学习目标
                  </label>
                  <label className="flex items-center gap-1.5 text-xs">
                    <input
                      type="checkbox"
                      checked={isDeclared}
                      onChange={() => toggleIn('declaredIds', point.id)}
                    />
                    已掌握，不教
                  </label>
                  <label className="flex items-center gap-1.5 text-xs">
                    <input
                      type="checkbox"
                      checked={isExcluded}
                      onChange={() => toggleIn('excludedIds', point.id)}
                    />
                    排除
                  </label>
                  <button
                    type="button"
                    onClick={() => setOpenPrereq(openPrereq === point.id ? null : point.id)}
                    aria-expanded={openPrereq === point.id}
                    className="flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
                  >
                    {openPrereq === point.id ? (
                      <ChevronDown aria-hidden className="h-3.5 w-3.5" />
                    ) : (
                      <ChevronRight aria-hidden className="h-3.5 w-3.5" />
                    )}
                    先修 {prereq.length}
                  </button>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {prereq.length > 0
                    ? `先修：${prereq.map((id) => pointMap.get(id)?.title ?? id).join('、')}`
                    : '无先修要求'}
                  {point.citations.length > 0 && ` · ${point.citations.length} 条教材引用`}
                  {prereqEdit(point) && ' · 先修已人工调整'}
                </p>
                {openPrereq === point.id && (
                  <div className="mt-3 rounded-md border border-border p-3">
                    <p className="mb-2 text-xs font-medium">调整先修知识点：</p>
                    <ul className="grid gap-1 sm:grid-cols-2">
                      {points
                        .filter((p) => p.id !== point.id)
                        .map((p) => (
                          <li key={p.id}>
                            <label className="flex items-center gap-2 text-xs">
                              <input
                                type="checkbox"
                                checked={prereq.includes(p.id)}
                                onChange={() => togglePrereq(point, p.id)}
                              />
                              {p.title}
                            </label>
                          </li>
                        ))}
                    </ul>
                    {prereqEdit(point) && (
                      <input
                        type="text"
                        value={prereqEdit(point)!.reason}
                        onChange={(e) => setPrereqReason(point, e.target.value)}
                        placeholder="调整原因（必填）"
                        aria-label="先修调整原因"
                        className="mt-2 w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs"
                      />
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border p-4">
        <button
          type="button"
          disabled={!dirty || saving}
          onClick={() =>
            void saveChoices().then((saved) => {
              if (saved) {
                setChoices(saved.review?.choices ?? choices);
                onChanged(saved);
              }
            })
          }
          className="rounded-md border border-border px-4 py-2 text-sm hover:bg-muted disabled:opacity-50"
        >
          {saving ? '校验中…' : dirty ? '保存并校验调整' : '调整已保存'}
        </button>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={accepted}
            onChange={(e) => setAccepted(e.target.checked)}
          />
          我已核对来源覆盖与先修关系
        </label>
        <button
          type="button"
          disabled={
            !accepted || confirming || saving || issues.length > 0 || review.stale || missingPrereqReason
          }
          onClick={() => void confirm()}
          className="flex items-center gap-2 rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {confirming ? (
            <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
          ) : (
            <CheckCircle2 aria-hidden className="h-4 w-4" />
          )}
          确认并创建课程
        </button>
        {issues.length > 0 && (
          <span className="text-xs text-muted-foreground">解决问题后才能确认</span>
        )}
        {missingPrereqReason && (
          <span className="text-xs text-warning">先修调整需要填写原因</span>
        )}
      </div>
    </div>
  );
}
