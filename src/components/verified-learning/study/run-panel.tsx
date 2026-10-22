'use client';

import { useCallback, useRef, useState } from 'react';
import { CheckCircle2, Loader2 } from 'lucide-react';
import {
  api,
  newKey,
  type JobView,
  type RunView,
  type SessionView,
} from '@/lib/verified-learning/client';
import ErrorBox from '@/components/verified-learning/error-box';
import MarkdownView from '@/components/verified-learning/markdown-view';
import { usePolling } from '@/components/verified-learning/use-polling';
import QuestionCard from './question-card';
import JobStatus from '../job-status';

export const ACTIVITY_LABEL: Record<string, string> = {
  lesson: '课件学习',
  point_quiz: '知识点练习',
  chapter_quiz: '章节测验',
  final_quiz: '期末考核',
  diagnostic: '摸底诊断',
};

export default function RunPanel({
  session,
  onSessionChange,
}: {
  session: SessionView;
  onSessionChange: (view: SessionView) => void;
}) {
  const current = session.currentRun!;
  const sessionId = session.session.sessionId;
  const [run, setRun] = useState<RunView | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [jobError, setJobError] = useState<string | null>(null);
  const [completing, setCompleting] = useState(false);
  const [answers, setAnswers] = useState<Record<string, string>>(
    session.cursor?.runId === current.runId ? (session.cursor.answers ?? {}) : {},
  );
  const cursorRevisionRef = useRef(session.cursor?.revision ?? 0);
  const cursorTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [cursorSaved, setCursorSaved] = useState(false);

  const reloadSession = useCallback(async () => {
    const view = await api<SessionView>(`/sessions/${sessionId}`);
    onSessionChange(view);
  }, [sessionId, onSessionChange]);

  // 轮询 run；生成失败时 run 停在 generating，需看 job 拿真实原因
  const poll = useCallback(async () => {
    try {
      const view = await api<RunView>(`/runs/${current.runId}`);
      setRun(view);
      setError(null);
      if (view.status !== 'generating') return false;
    } catch (e) {
      setError(e);
      return true;
    }
    if (current.jobId) {
      try {
        const job = await api<JobView>(`/jobs/${current.jobId}`);
        if (job.status === 'failed' || job.status === 'cancelled') {
          setJobError(job.error?.message ?? '内容生成失败');
          return false;
        }
      } catch {
        // 任务状态读取失败不打断 run 轮询
      }
    }
    return true;
  }, [current.runId, current.jobId]);

  const generating = !run || run.status === 'generating';
  usePolling(poll, generating && !jobError);

  // 答题过程自动保存学习位置（cursor），供「继续上次位置」恢复
  function noteAnswer(questionId: string, answer: string) {
    const next = { ...answers, [questionId]: answer };
    setAnswers(next);
    setCursorSaved(false);
    if (cursorTimer.current) clearTimeout(cursorTimer.current);
    cursorTimer.current = setTimeout(async () => {
      try {
        const saved = await api<{ revision: number }>(`/sessions/${sessionId}/cursor`, 'PATCH', {
          expectedRevision: cursorRevisionRef.current,
          cursor: { runId: current.runId, answers: next },
        });
        cursorRevisionRef.current = saved.revision;
        setCursorSaved(true);
      } catch {
        // 位置保存失败不打断作答
      }
    }, 1000);
  }

  async function completeLesson() {
    setCompleting(true);
    setError(null);
    try {
      const view = await api<SessionView>(
        `/sessions/${sessionId}/lesson-completion`,
        'POST',
        { runId: current.runId, expectedRevision: session.session.revision },
        newKey(),
      );
      onSessionChange(view);
    } catch (e) {
      setError(e);
      setCompleting(false);
    }
  }

  async function resumeJob() {
    if (!current.jobId) return;
    setJobError(null);
    try {
      await api(`/jobs/${current.jobId}/resume`, 'POST', {});
    } catch (e) {
      setJobError(e instanceof Error ? e.message : '重试失败');
    }
  }

  const finishedCount =
    run?.questions.filter((q) => q.attempt?.state === 'finished').length ?? 0;
  const allFinished = !!run && run.questions.length > 0 && finishedCount === run.questions.length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">
          {ACTIVITY_LABEL[current.activity.kind] ?? current.activity.kind}
        </h2>
        {cursorSaved && (
          <span className="text-xs text-muted-foreground" role="status">
            学习位置已保存
          </span>
        )}
      </div>

      {current.jobId && generating && <ul><JobStatus jobId={current.jobId} onDone={() => void poll()} /></ul>}
      {generating && !jobError && (
        <p
          role="status"
          className="flex items-center gap-2 rounded-md border border-border px-4 py-3 text-sm"
        >
          <Loader2 aria-hidden className="h-4 w-4 animate-spin text-accent" />
          Agent正在读取资料、编写和自动校验内容，完成验收后即可学习。
        </p>
      )}

      {jobError && (
        <div
          role="alert"
          className="rounded-md border border-danger/40 bg-danger/5 px-4 py-3 text-sm"
        >
          <p className="font-medium text-danger">内容生成失败</p>
          <p className="mt-1">{jobError}</p>
          <div className="mt-2 flex items-center gap-2">
            {current.jobId && (
              <button
                type="button"
                onClick={() => void resumeJob()}
                className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted"
              >
                重试生成
              </button>
            )}
            <span className="text-xs text-muted-foreground">
              多次失败可放弃当前活动后重新开始。
            </span>
          </div>
        </div>
      )}

      <ErrorBox error={error} onRetry={() => void poll()} />

      {run?.status === 'ready' && run.activity.kind === 'lesson' && run.content && (
        <>
          <MarkdownView
            markdown={run.content.markdown}
            citations={run.content.citations}
            onCitation={(citation) =>
              window.open(`/verified-learning/textbooks/${citation.sourceId}`, '_blank', 'noopener')
            }
          />
          <button
            type="button"
            disabled={completing}
            onClick={() => void completeLesson()}
            className="flex items-center gap-2 rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background hover:opacity-90 disabled:opacity-50"
          >
            {completing ? (
              <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
            ) : (
              <CheckCircle2 aria-hidden className="h-4 w-4" />
            )}
            我读完了
          </button>
        </>
      )}

      {run?.status === 'ready' && run.activity.kind !== 'lesson' && (
        <>
          <p className="text-sm text-muted-foreground" role="status">
            已完成 {finishedCount} / {run.questions.length} 题
          </p>
          {run.questions.map((question, index) => (
            <QuestionCard
              key={question.questionId}
              runId={run.runId}
              question={question}
              index={index}
              prefill={answers[question.questionId]}
              onAnswer={noteAnswer}
              onFinished={() => {
                // 每题判完刷新 run；全部答完会话自动推进，刷新上层
                void poll().finally(() => void reloadSession());
              }}
            />
          ))}
          {allFinished && (
            <p className="rounded-md border border-success/40 bg-success/5 px-4 py-3 text-sm text-success">
              本组题目全部完成，正在进入下一步…
            </p>
          )}
        </>
      )}
    </div>
  );
}
