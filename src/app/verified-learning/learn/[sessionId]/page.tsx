'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { GraduationCap, History, Loader2, Play, StickyNote } from 'lucide-react';
import ErrorBox from '@/components/verified-learning/error-box';
import RunPanel, { ACTIVITY_LABEL } from '@/components/verified-learning/study/run-panel';
import {
  api,
  newKey,
  ApiError,
  type CoursePointView,
  type SessionView,
} from '@/lib/verified-learning/client';

const MODE_LABEL: Record<string, string> = {
  theory: '理论',
  practice: '练习',
  drill: '刷题',
};

export default function LearnPage() {
  const params = useParams<{ sessionId: string }>();
  const sessionId = params.sessionId;

  const [view, setView] = useState<SessionView | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [priorPick, setPriorPick] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    try {
      setView(await api<SessionView>(`/sessions/${sessionId}`));
      setError(null);
    } catch (e) {
      setError(e);
    }
  }, [sessionId]);

  useEffect(() => {
    void load();
  }, [load]);

  function pointTitle(id: string): string {
    for (const module of view?.version.outline ?? []) {
      const point = module.points.find((p: CoursePointView) => p.knowledgePointId === id);
      if (point) return point.title;
    }
    return id;
  }

  async function start() {
    if (!view) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/sessions/${sessionId}/start`, 'POST', {
        expectedRevision: view.session.revision,
      }, newKey());
      await load();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  async function changeMode(mode: string) {
    if (!view || mode === view.session.mode) return;
    // 有未完成活动时服务端会拒绝，需先明确放弃
    if (view.currentRun) {
      const label = ACTIVITY_LABEL[view.currentRun.activity.kind] ?? '当前活动';
      if (
        !window.confirm(
          `切换模式需要先放弃正在进行的「${label}」（已作答成绩保留，但未完成部分不计）。确定切换？`,
        )
      ) {
        return;
      }
      try {
        await api(`/sessions/${sessionId}/abandon`, 'POST', {
          runId: view.currentRun.runId,
          expectedRevision: view.session.revision,
        }, newKey());
        await load();
      } catch (e) {
        setError(e);
        return;
      }
    }
    setBusy(true);
    setError(null);
    try {
      const fresh = await api<SessionView>(`/sessions/${sessionId}`, 'GET');
      const updated = await api<SessionView>(
        `/sessions/${sessionId}/mode`,
        'PATCH',
        { mode, expectedRevision: fresh.session.revision },
        newKey(),
      );
      setView(updated);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  async function declarePrior() {
    if (!view || view.next.kind !== 'blocked' || priorPick.size === 0) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await api<SessionView>(
        `/sessions/${sessionId}/prior-knowledge`,
        'POST',
        {
          expectedRevision: view.session.revision,
          knowledgePointIds: [...priorPick],
        },
        newKey(),
      );
      setView(updated);
      setPriorPick(new Set());
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  async function remedial() {
    setBusy(true);
    setError(null);
    try {
      await api(`/sessions/${sessionId}/remedial`, 'POST', {}, newKey());
      await load();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  async function abandonRun() {
    if (!view?.currentRun) return;
    if (!window.confirm('确定放弃当前活动？已作答成绩保留，未完成部分不计入。')) return;
    setError(null);
    try {
      const updated = await api<SessionView>(
        `/sessions/${sessionId}/abandon`,
        'POST',
        { runId: view.currentRun.runId, expectedRevision: view.session.revision },
        newKey(),
      );
      setView(updated);
    } catch (e) {
      setError(e);
    }
  }

  return (
    <>
      {error && !view ? (
        <ErrorBox error={error} onRetry={load} />
      ) : !view ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
          正在载入学习会话…
        </p>
      ) : (
        <>
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="flex items-center gap-2 text-2xl font-bold">
                <GraduationCap aria-hidden className="h-6 w-6" />
                {view.version.goal || '学习会话'}
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                已完成 {view.session.completedActivityIds.length} 个活动
              </p>
            </div>
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-2 text-sm">
                模式
                <select
                  value={view.session.mode}
                  disabled={busy}
                  onChange={(e) => void changeMode(e.target.value)}
                  className="rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                >
                  {Object.entries(MODE_LABEL).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <Link
                href={`/verified-learning/learn/${sessionId}/history`}
                className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted"
              >
                <History aria-hidden className="h-4 w-4" />
                历史回看
              </Link>
              <Link
                href={`/verified-learning/courses/${view.version.courseId}?versionId=${view.version.courseVersionId}`}
                className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted"
              >
                <StickyNote aria-hidden className="h-4 w-4" />
                笔记与进度
              </Link>
            </div>
          </div>

          <ErrorBox error={error} />

          {view.currentRun ? (
            <>
              <RunPanel session={view} onSessionChange={setView} />
              <div className="mt-6 border-t border-border pt-4">
                <button
                  type="button"
                  onClick={() => void abandonRun()}
                  className="text-xs text-danger hover:underline"
                >
                  放弃当前活动
                </button>
              </div>
            </>
          ) : view.next.kind === 'activity' ? (
            <div className="rounded-lg border border-border p-6 text-center">
              <p className="mb-1 text-sm text-muted-foreground">下一个活动</p>
              <p className="mb-1 text-lg font-semibold">
                {ACTIVITY_LABEL[view.next.activity.kind] ?? view.next.activity.kind}
              </p>
              <p className="mb-4 text-sm text-muted-foreground">
                {view.next.activity.knowledgePointIds.map(pointTitle).join('、')}
                {view.next.activity.questionCount > 0 && ` · ${view.next.activity.questionCount} 题`}
              </p>
              {view.cursor && (
                <p className="mb-4 text-xs text-muted-foreground">
                  已保存上次学习位置，开始后自动继续。
                </p>
              )}
              <button
                type="button"
                disabled={busy}
                onClick={() => void start()}
                className="inline-flex items-center gap-2 rounded-md bg-foreground px-6 py-3 text-sm font-medium text-background hover:opacity-90 disabled:opacity-50"
              >
                {busy ? (
                  <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
                ) : (
                  <Play aria-hidden className="h-4 w-4" />
                )}
                开始学习
              </button>
            </div>
          ) : view.next.kind === 'blocked' ? (
            <div className="rounded-lg border border-warning/40 bg-warning/5 p-6">
              {view.next.reason === 'PRIOR_KNOWLEDGE_REQUIRED' ? (
                <>
                  <h2 className="mb-2 font-semibold">需要先确认已有基础</h2>
                  <p className="mb-3 text-sm text-muted-foreground">
                    后续内容依赖以下先修知识点。勾选你已经掌握的（自报不算掌握证据），或切换到理论模式继续。
                  </p>
                  <ul className="mb-4 space-y-1">
                    {view.next.knowledgePointIds.map((id) => (
                      <li key={id}>
                        <label className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={priorPick.has(id)}
                            onChange={(e) => {
                              const next = new Set(priorPick);
                              if (e.target.checked) next.add(id);
                              else next.delete(id);
                              setPriorPick(next);
                            }}
                          />
                          {pointTitle(id)}
                        </label>
                      </li>
                    ))}
                  </ul>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={busy || priorPick.size === 0}
                      onClick={() => void declarePrior()}
                      className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background hover:opacity-90 disabled:opacity-50"
                    >
                      自报已掌握所选
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void changeMode('theory')}
                      className="rounded-md border border-border px-4 py-2 text-sm hover:bg-muted"
                    >
                      切换到理论模式
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <h2 className="mb-2 font-semibold">需要补练巩固</h2>
                  <p className="mb-3 text-sm text-muted-foreground">
                    以下知识点尚未达到掌握标准，不能直接跳过：
                    {view.next.knowledgePointIds.map(pointTitle).join('、')}
                  </p>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void remedial()}
                    className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background hover:opacity-90 disabled:opacity-50"
                  >
                    {busy ? '生成补练中…' : '生成补练题组'}
                  </button>
                </>
              )}
            </div>
          ) : (
            <div className="rounded-lg border border-success/40 bg-success/5 p-6 text-center">
              <p className="mb-2 text-lg font-semibold text-success">课程全部完成</p>
              <p className="mb-4 text-sm text-muted-foreground">
                可以在历史回看中复习，或在笔记与进度页查看掌握证据。
              </p>
              <Link
                href={`/verified-learning/courses/${view.version.courseId}?versionId=${view.version.courseVersionId}`}
                className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background hover:opacity-90"
              >
                查看掌握进度
              </Link>
            </div>
          )}
        </>
      )}
    </>
  );
}
