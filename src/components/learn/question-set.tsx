'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Loader2, Lightbulb, RotateCw } from 'lucide-react';
import { api, newKey } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import type { AttemptView, RunQuestion } from '@/lib/api/types';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Input } from '@/components/ui/field';
import { BlockError } from '@/components/states/block-states';
import { GradeMark } from '@/components/zhupi/grade-mark';
import dynamic from 'next/dynamic';

// 课件与普通题不加载 CodeMirror；只有实际显示编程输入区时才下载。
const CodeEditor = dynamic(() => import('./code-editor').then(module => module.CodeEditor), {
  ssr: false,
  loading: () => <div role="status" className="min-h-40 rounded-[var(--radius-control)] bg-raised"><span className="sr-only">正在加载代码编辑器</span></div>,
});

type Question = RunQuestion & { answer?: string; explanation?: string };
const TYPE_LABEL: Record<Question['type'], string> = { choice: '选择题', fill: '填空题', code: '编程题' };
const PENDING = new Set(['pending', 'running']);

/**
 * 题组：每题一张纸面。选择、填空、编程三类；四级提示（第 4 级需确认，看后不计入独立证据）；
 * 提交后朱批落笔并显示解析；编程题轮询判题；判题故障不计为答错，可以恢复。
 * readOnly 用于历史回看：只显示当时的作答、答案与解析。
 */
export function QuestionSet({ runId, questions, readOnly = false, savedAnswers, onAnswersChange, onAnswered }: {
  runId: string;
  questions: Question[];
  readOnly?: boolean;
  /** 上次的作答位置（cursor.answers） */
  savedAnswers?: Record<string, string>;
  onAnswersChange?: (answers: Record<string, string>) => void;
  onAnswered?: () => void;
}) {
  const [answers, setAnswers] = useState<Record<string, string>>(savedAnswers ?? {});
  const set = (id: string, value: string) => setAnswers(previous => {
    const next = { ...previous, [id]: value };
    onAnswersChange?.(next);
    return next;
  });
  const answered = questions.filter(q => q.attempt?.state === 'finished').length;
  return (
    <div className="grid gap-5">
      {!readOnly && (
        <p className="text-sm text-muted" aria-live="polite">共 {questions.length} 题，已判分 {answered} 题。每题只能正式提交一次。</p>
      )}
      {questions.map((question, index) => (
        <QuestionCard
          key={question.questionId}
          runId={runId}
          index={index}
          question={question}
          readOnly={readOnly}
          value={answers[question.questionId] ?? ''}
          onChange={value => set(question.questionId, value)}
          onAnswered={onAnswered}
        />
      ))}
    </div>
  );
}

function QuestionCard({ runId, index, question, readOnly, value, onChange, onAnswered }: {
  runId: string;
  index: number;
  question: Question;
  readOnly: boolean;
  value: string;
  onChange: (value: string) => void;
  onAnswered?: () => void;
}) {
  const id = useId();
  const [attempt, setAttempt] = useState<AttemptView | null>(question.attempt as AttemptView | null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [hints, setHints] = useState<{ level: number; content: string }[]>([]);
  const [hinting, setHinting] = useState(false);
  const [confirmFull, setConfirmFull] = useState(false);
  const key = useRef(newKey());
  const fresh = useRef(false);

  // 判题中：每 1.5 秒查一次，直到完成或故障
  useEffect(() => {
    if (!attempt || !PENDING.has(attempt.state)) return;
    const timer = setTimeout(async () => {
      try { setAttempt(await api<AttemptView>(`/attempts/${encodeURIComponent(attempt.attemptId)}`)); } catch (e) { setError(e); }
    }, 1500);
    return () => clearTimeout(timer);
  }, [attempt]);
  useEffect(() => {
    if (attempt?.state === 'finished' && fresh.current) { fresh.current = false; onAnswered?.(); }
  }, [attempt, onAnswered]);

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      fresh.current = true;
      setAttempt(await api<AttemptView>(`/runs/${encodeURIComponent(runId)}/attempts`, { method: 'POST', body: { questionId: question.questionId, answer: value }, key: key.current }));
    } catch (e) {
      fresh.current = false;
      setError(e);
    } finally {
      setSubmitting(false);
    }
  }
  async function resume(allowUnknown = false) {
    if (!attempt) return;
    setError(null);
    try { setAttempt(await api<AttemptView>(`/attempts/${encodeURIComponent(attempt.attemptId)}/resume`, { method: 'POST', body: { allowUnknown } })); } catch (e) { setError(e); }
  }
  async function hint(level: number) {
    setHinting(true);
    setError(null);
    try {
      const result = await api<{ level: number; content: string }>(`/runs/${encodeURIComponent(runId)}/hints`, { method: 'POST', body: { questionId: question.questionId, level } });
      setHints(previous => [...previous.filter(h => h.level !== result.level), result].sort((a, b) => a.level - b.level));
    } catch (e) { setError(e); } finally { setHinting(false); }
  }

  const result = attempt?.state === 'finished' ? attempt.result : null;
  const sawFull = hints.some(h => h.level === 4);
  const locked = readOnly || !!attempt;
  const nextHint = (hints.at(-1)?.level ?? 0) + 1;
  const mark = result ? (result.correct ? 'ok' : sawFull ? 'void' : 'no') : null;
  const explanation = result?.explanation ?? question.explanation;

  return (
    <fieldset aria-labelledby={`${id}-title`} className="min-w-0 rounded-[var(--radius-paper)] bg-paper px-7 py-6 max-md:px-4 max-md:py-5">
      <div className="flex items-start justify-between gap-4">
        <h3 id={`${id}-title`} className="text-sm text-muted">第 {index + 1} 题 · {TYPE_LABEL[question.type]}</h3>
        {mark && <GradeMark kind={mark} size="lg" animate={!readOnly} />}
      </div>
      <p className="mt-2 whitespace-pre-wrap break-words font-serif text-body leading-[1.85]">{question.stem}</p>

      {question.type === 'choice' && (
        <div role="radiogroup" aria-labelledby={`${id}-title`} className="mt-4 grid gap-2">
          {(question.options ?? []).map((option, i) => {
            const chosen = (attempt ? (readOnly ? undefined : value) : value) === option;
            const correctOption = readOnly && question.answer === option;
            return (
              <label
                key={i}
                className={cn(
                  'flex min-h-11 cursor-pointer items-start gap-3 rounded-[var(--radius-control)] border px-3.5 py-2.5 font-mono text-[0.875rem] transition-colors',
                  chosen ? 'border-ink bg-ground' : 'border-line hover:border-control-strong',
                  correctOption && 'border-zhu bg-zhu-tint',
                  locked && 'cursor-default hover:border-line',
                )}
              >
                <input type="radio" name={`${id}-choice`} value={option} checked={chosen} disabled={locked} onChange={() => onChange(option)} className="mt-1 size-4 accent-[var(--color-ink)]" aria-label={option} />
                <span className="min-w-0 whitespace-pre-wrap break-words">{option}</span>
              </label>
            );
          })}
        </div>
      )}
      {question.type === 'fill' && (
        <div className="mt-4 grid gap-1.5">
          <label htmlFor={`${id}-fill`} className="text-sm text-muted">你的答案</label>
          <Input id={`${id}-fill`} value={value} disabled={locked} onChange={event => onChange(event.target.value)} className="font-mono" autoComplete="off" spellCheck={false} />
        </div>
      )}
      {question.type === 'code' && (
        <div className="mt-4 grid gap-3">
          {question.samples && question.samples.length > 0 && (
            <div id={`${id}-samples`} className="grid gap-2 text-sm">
              {question.samples.map((sample, i) => (
                <div key={i} className="grid grid-cols-2 gap-3 max-md:grid-cols-1">
                  <div><p className="text-muted">样例输入 {i + 1}</p><pre className="mt-1 overflow-x-auto rounded-[var(--radius-control)] bg-ground px-3 py-2 font-mono text-[0.8125rem]">{sample.stdin || '（无输入）'}</pre></div>
                  <div><p className="text-muted">样例输出 {i + 1}</p><pre className="mt-1 overflow-x-auto rounded-[var(--radius-control)] bg-ground px-3 py-2 font-mono text-[0.8125rem]">{sample.expectedStdout}</pre></div>
                </div>
              ))}
            </div>
          )}
          {!readOnly && <CodeEditor value={value} onChange={onChange} language={question.language ?? 'python'} label="代码" disabled={locked} describedBy={question.samples?.length ? `${id}-samples` : undefined} />}
        </div>
      )}

      {hints.length > 0 && (
        <ol className="mt-4 grid gap-2" aria-label="提示">
          {hints.map(h => (
            <li key={h.level} className={cn('rounded-[var(--radius-control)] px-3.5 py-2.5 text-base', h.level === 4 ? 'bg-raised' : 'bg-ground')}>
              <span className="mr-2 text-sm text-muted">{h.level === 4 ? '完整解析' : `提示 ${h.level}`}</span>
              <span className="whitespace-pre-wrap">{h.content}</span>
            </li>
          ))}
        </ol>
      )}

      {attempt && PENDING.has(attempt.state) && (
        <p className="mt-4 flex items-center gap-2 text-base text-muted" role="status"><Loader2 className="size-4 animate-spin" aria-hidden />判题中，正在运行全部测试…</p>
      )}
      {attempt && (attempt.state === 'infrastructure_error' || attempt.state === 'unknown') && (
        <div role="alert" className="mt-4 rounded-[var(--radius-control)] bg-raised px-4 py-3 text-base">
          <p>判题服务暂时出错，这次不计为答错。</p>
          <Button size="sm" className="mt-2" onClick={() => void resume(attempt.state === 'unknown')}><RotateCw aria-hidden />重新判题</Button>
        </div>
      )}
      {result && (
        <div className={cn('mt-4 rounded-[var(--radius-control)] px-4 py-3', result.correct ? 'bg-zhu-tint' : 'bg-ground')}>
          <p className="font-medium">{result.correct ? '答对' : '答错'}{sawFull && !result.correct && <span className="ml-2 text-sm font-normal text-muted">看过完整解析，不计入独立证据</span>}</p>
          {result.feedback && result.feedback !== '回答正确' && <p className="mt-1 whitespace-pre-wrap text-base text-ink-soft">{result.feedback}</p>}
          {readOnly && question.answer !== undefined && question.type !== 'code' && <p className="mt-2 text-base">正确答案：<span className="font-mono">{question.answer}</span></p>}
          {explanation && <p className="mt-2 whitespace-pre-wrap font-serif text-[1rem] leading-[1.8] text-ink-soft">{explanation}</p>}
        </div>
      )}

      <BlockError className="mt-4" error={error} />
      {!locked && (
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <Button variant="primary" disabled={!value.trim() || submitting} onClick={() => void submit()}>
            {submitting && <Loader2 className="animate-spin" aria-hidden />}提交答案
          </Button>
          {nextHint <= 3 && (
            <Button variant="ghost" disabled={hinting} onClick={() => void hint(nextHint)}><Lightbulb aria-hidden />{nextHint === 1 ? '提示' : `再提示一点（${nextHint}/3）`}</Button>
          )}
          {!sawFull && <Button variant="ghost" disabled={hinting} onClick={() => setConfirmFull(true)}>看完整解析</Button>}
        </div>
      )}
      <Dialog open={confirmFull} onOpenChange={setConfirmFull}>
        <DialogContent title="看完整解析？" description="解析里有答案。看过之后这道题仍可作答，但不计入独立证据，掌握需要用别的题来证明。">
          <div className="flex justify-end gap-2">
            <Button onClick={() => setConfirmFull(false)}>先自己想想</Button>
            <Button variant="primary" onClick={() => { setConfirmFull(false); void hint(4); }}>看解析</Button>
          </div>
        </DialogContent>
      </Dialog>
    </fieldset>
  );
}
