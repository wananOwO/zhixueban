'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';

interface Question {
  id: string;
  type: 'choice' | 'fill' | 'code';
  stem: string;
  options?: string[];
}

interface Props {
  courseId: string;
  scope: 'knowledgePoint' | 'chapter' | 'course' | 'final' | 'diagnostic';
  scopeId: string;
  count: number;
  onAllDone: () => void;
}

export default function QuizPanel({ courseId, scope, scopeId, count, onAllDone }: Props) {
  const [questions, setQuestions] = useState<Question[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState<Record<string, { correct: boolean; feedback: string }>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/questions', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            courseId,
            scope,
            scopeId,
            count,
            difficulty: 'easy',
          }),
        });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? '出题失败');
        setQuestions(
          body.questions.map((q: Record<string, unknown>) => ({
            id: q.id,
            type: q.type,
            stem: q.stem,
            options: q.options ?? undefined,
          })),
        );
      } catch (e) {
        setError(e instanceof Error ? e.message : '出题失败');
      } finally {
        setLoading(false);
      }
    })();
  }, [courseId, scope, scopeId, count]);

  async function submit(questionId: string) {
    const res = await fetch('/api/attempts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ questionId, answer: answers[questionId] ?? '' }),
    });
    const result = await res.json();
    setFeedback((f) => ({ ...f, [questionId]: result }));
    if (result.correct !== undefined) {
      setTimeout(() => {
        const remaining = questions.filter((q) => !feedback[q.id] && q.id !== questionId);
        if (remaining.length === 0) onAllDone();
      }, 800);
    }
  }

  if (loading) {
    return (
      <div role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
        Agent 正在出题…
      </div>
    );
  }
  if (error) {
    return (
      <p role="alert" className="rounded-md border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger">
        {error}
      </p>
    );
  }

  return (
    <ol className="grid gap-6">
      {questions.map((q, i) => (
        <li key={q.id} className="rounded-lg border border-border p-4">
          <p className="mb-3 text-sm font-medium">
            {i + 1}. {q.stem}
          </p>
          {q.type === 'choice' && q.options ? (
            <div role="radiogroup" aria-label={`第 ${i + 1} 题选项`} className="grid gap-2">
              {q.options.map((opt) => (
                <label
                  key={opt}
                  className="flex cursor-pointer items-center gap-2 rounded-md border border-border px-3 py-2 text-sm hover:bg-muted"
                >
                  <input
                    type="radio"
                    name={q.id}
                    value={opt}
                    onChange={() => setAnswers((a) => ({ ...a, [q.id]: opt }))}
                    disabled={!!feedback[q.id]}
                  />
                  {opt}
                </label>
              ))}
            </div>
          ) : (
            <textarea
              aria-label={`第 ${i + 1} 题作答区`}
              value={answers[q.id] ?? ''}
              onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))}
              disabled={!!feedback[q.id]}
              rows={q.type === 'code' ? 8 : 2}
              className="w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-sm"
            />
          )}
          {!feedback[q.id] ? (
            <button
              type="button"
              onClick={() => void submit(q.id)}
              disabled={!answers[q.id]}
              className="mt-3 rounded-md bg-foreground px-4 py-1.5 text-sm text-background disabled:opacity-40"
            >
              提交
            </button>
          ) : (
            <p
              role="status"
              className={`mt-3 rounded-md px-3 py-2 text-sm ${
                feedback[q.id].correct
                  ? 'bg-success/10 text-success'
                  : 'bg-danger/10 text-danger'
              }`}
            >
              {feedback[q.id].correct ? '✓ 回答正确' : `✗ ${feedback[q.id].feedback}`}
            </p>
          )}
        </li>
      ))}
    </ol>
  );
}
