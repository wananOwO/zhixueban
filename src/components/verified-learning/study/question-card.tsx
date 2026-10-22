'use client';

import { useCallback, useRef, useState } from 'react';
import { CheckCircle2, Lightbulb, Loader2, XCircle } from 'lucide-react';
import {
  api,
  newKey,
  type AttemptView,
  type RunQuestion,
} from '@/lib/verified-learning/client';
import ErrorBox from '@/components/verified-learning/error-box';
import { usePolling } from '@/components/verified-learning/use-polling';

const HINT_LABELS = ['概念提示', '输入输出提示', '分步提示', '完整解析'];
const CATEGORY_LABEL: Record<string, string> = {
  accepted: '回答正确',
  wrong_answer: '答案不符',
  compile_error: '编译失败',
  runtime_error: '运行错误',
  time_limit: '超出时间限制',
  infrastructure_error: '判题服务故障',
};

export default function QuestionCard({
  runId,
  question,
  index,
  prefill,
  onAnswer,
  onFinished,
}: {
  runId: string;
  question: RunQuestion;
  index: number;
  prefill?: string;
  onAnswer: (questionId: string, answer: string) => void;
  onFinished: () => void;
}) {
  const [answer, setAnswer] = useState(prefill ?? '');
  const [attempt, setAttempt] = useState<AttemptView | null>(
    question.attempt
      ? {
          attemptId: question.attempt.attemptId,
          questionId: question.questionId,
          state: question.attempt.state as AttemptView['state'],
          result: question.attempt.result,
        }
      : null,
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [hints, setHints] = useState<Record<number, string>>({});
  const [hintError, setHintError] = useState<unknown>(null);
  // 同一题的提交重试复用同一幂等键；换新答案时换键
  const keyRef = useRef<{ answer: string; key: string } | null>(null);

  const finished = attempt?.state === 'finished';
  const judging = attempt?.state === 'pending' || attempt?.state === 'running';

  const pollAttempt = useCallback(async () => {
    if (!attempt) return false;
    try {
      const view = await api<AttemptView>(`/attempts/${attempt.attemptId}`);
      setAttempt(view);
      if (view.state === 'finished') {
        onFinished();
        return false;
      }
      return view.state === 'pending' || view.state === 'running';
    } catch {
      return true;
    }
  }, [attempt, onFinished]);

  usePolling(pollAttempt, judging);

  async function submit() {
    if (!answer.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      if (!keyRef.current || keyRef.current.answer !== answer) {
        keyRef.current = { answer, key: newKey() };
      }
      const view = await api<AttemptView>(
        `/runs/${runId}/attempts`,
        'POST',
        { questionId: question.questionId, answer },
        keyRef.current.key,
      );
      setAttempt(view);
      if (view.state === 'finished') onFinished();
    } catch (e) {
      setError(e);
    } finally {
      setSubmitting(false);
    }
  }

  async function resume(allowUnknown: boolean) {
    if (!attempt) return;
    setError(null);
    try {
      const view = await api<AttemptView>(
        `/attempts/${attempt.attemptId}/resume`,
        'POST',
        allowUnknown ? { allowUnknown: true } : {},
      );
      setAttempt(view);
      if (view.state === 'finished') onFinished();
    } catch (e) {
      setError(e);
    }
  }

  async function showHint(level: number) {
    if (level === 4) {
      const ok = window.confirm(
        '完整解析会显示本题答案与讲解，且这次作答不再计入独立掌握证据。确定查看？',
      );
      if (!ok) return;
    }
    setHintError(null);
    try {
      const hint = await api<{ level: number; content: string }>(
        `/runs/${runId}/hints`,
        'POST',
        { questionId: question.questionId, level },
      );
      setHints((prev) => ({ ...prev, [level]: hint.content }));
    } catch (e) {
      setHintError(e);
    }
  }

  return (
    <section
      aria-label={`第 ${index + 1} 题`}
      className="rounded-lg border border-border p-4"
    >
      <div className="mb-3 flex items-start gap-3">
        <span className="mt-0.5 shrink-0 rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">
          {question.type === 'choice' ? '选择' : question.type === 'fill' ? '填空' : `编程 · ${question.language ?? ''}`}
        </span>
        <p className="whitespace-pre-wrap text-sm leading-relaxed">{question.stem}</p>
      </div>

      {/* 作答区 */}
      {!finished && !judging && (
        <div className="mb-3">
          {question.type === 'choice' && question.options ? (
            <div role="radiogroup" aria-label="选项" className="space-y-2">
              {question.options.map((option) => (
                <label
                  key={option}
                  className={`flex items-start gap-2 rounded-md border px-3 py-2 text-sm ${
                    answer === option ? 'border-accent bg-accent/5' : 'border-border hover:bg-muted'
                  }`}
                >
                  <input
                    type="radio"
                    name={`q-${question.questionId}`}
                    checked={answer === option}
                    onChange={() => {
                      setAnswer(option);
                      onAnswer(question.questionId, option);
                    }}
                    className="mt-1"
                  />
                  <span>{option}</span>
                </label>
              ))}
            </div>
          ) : question.type === 'code' ? (
            <>
              <textarea
                value={answer}
                onChange={(e) => {
                  setAnswer(e.target.value);
                  onAnswer(question.questionId, e.target.value);
                }}
                rows={10}
                spellCheck={false}
                placeholder={`用 ${question.language ?? '指定语言'} 编写完整单文件程序`}
                aria-label="代码作答"
                className="w-full rounded-md border border-border bg-muted px-3 py-2 font-mono text-sm"
              />
              {question.samples && question.samples.length > 0 && (
                <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                  <p className="font-medium">公开样例：</p>
                  {question.samples.map((sample, i) => (
                    <pre key={i} className="overflow-x-auto rounded border border-border bg-muted p-2">
                      输入：{question.samples![i].stdin || '（空）'}
                      {'\n'}期望输出：{question.samples![i].expectedStdout}
                    </pre>
                  ))}
                </div>
              )}
            </>
          ) : (
            <input
              type="text"
              value={answer}
              onChange={(e) => {
                setAnswer(e.target.value);
                onAnswer(question.questionId, e.target.value);
              }}
              placeholder="填写答案"
              aria-label="填空作答"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            />
          )}
          <button
            type="button"
            disabled={!answer.trim() || submitting}
            onClick={() => void submit()}
            className="mt-3 rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background hover:opacity-90 disabled:opacity-50"
          >
            {submitting ? '提交中…' : '提交答案'}
          </button>
          <p className="mt-1 text-xs text-muted-foreground">
            每题只有一次正式提交；如需再练，可在之后的补练中作答。
          </p>
        </div>
      )}

      {/* 判题中 */}
      {judging && (
        <p role="status" className="mb-3 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
          判题中，请稍候…
        </p>
      )}

      {/* 结果 */}
      {finished && attempt?.result && (
        <div
          role="status"
          className={`mb-3 rounded-md border px-3 py-2 text-sm ${
            attempt.result.correct
              ? 'border-success/40 bg-success/5'
              : 'border-warning/40 bg-warning/5'
          }`}
        >
          <p className="flex items-center gap-2 font-medium">
            {attempt.result.correct ? (
              <CheckCircle2 aria-hidden className="h-4 w-4 text-success" />
            ) : (
              <XCircle aria-hidden className="h-4 w-4 text-warning" />
            )}
            {CATEGORY_LABEL[attempt.result.category] ?? attempt.result.feedback}
          </p>
          <p className="mt-1">{attempt.result.feedback}</p>
          {attempt.result.explanation && (
            <p className="mt-1 text-muted-foreground">解析：{attempt.result.explanation}</p>
          )}
        </div>
      )}

      {/* 判题故障：不是答错，可恢复 */}
      {(attempt?.state === 'infrastructure_error' || attempt?.state === 'unknown') && (
        <div role="alert" className="mb-3 rounded-md border border-warning/40 bg-warning/5 px-3 py-2 text-sm">
          <p>
            {attempt.state === 'infrastructure_error'
              ? '判题服务暂时不可用，这不计为答错。'
              : '判题结果未知（服务中断），这不计为答错。'}
          </p>
          <button
            type="button"
            onClick={() => void resume(attempt.state === 'unknown')}
            className="mt-2 rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted"
          >
            {attempt.state === 'unknown' ? '恢复判题（可能重复执行）' : '恢复判题'}
          </button>
        </div>
      )}

      <ErrorBox error={error} />

      {/* 提示 */}
      {!finished && (
        <div className="border-t border-border pt-3">
          <div className="flex flex-wrap items-center gap-2">
            <Lightbulb aria-hidden className="h-4 w-4 text-muted-foreground" />
            {[1, 2, 3, 4].map((level) => (
              <button
                key={level}
                type="button"
                onClick={() => void showHint(level)}
                className="rounded-md border border-border px-2 py-1 text-xs hover:bg-muted"
              >
                {HINT_LABELS[level - 1]}
              </button>
            ))}
          </div>
          {hintError ? (
            <ErrorBox error={hintError} />
          ) : (
            Object.entries(hints).map(([level, content]) => (
              <p key={level} className="mt-2 rounded bg-muted px-3 py-2 text-xs leading-relaxed">
                <strong>{HINT_LABELS[Number(level) - 1]}：</strong>
                {content}
              </p>
            ))
          )}
        </div>
      )}
    </section>
  );
}
