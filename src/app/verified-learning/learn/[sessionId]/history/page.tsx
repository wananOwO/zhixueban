'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { ArrowLeft, CheckCircle2, Loader2, XCircle } from 'lucide-react';
import ErrorBox from '@/components/verified-learning/error-box';
import MarkdownView from '@/components/verified-learning/markdown-view';
import { ACTIVITY_LABEL } from '@/components/verified-learning/study/run-panel';
import {
  api,
  type HistoryRunDetail,
  type HistoryRunItem,
} from '@/lib/verified-learning/client';

const RUN_STATUS: Record<string, string> = {
  ready: '进行中',
  generating: '生成中',
  completed: '已完成',
  abandoned: '已放弃',
};

export default function HistoryPage() {
  const params = useParams<{ sessionId: string }>();
  const sessionId = params.sessionId;

  const [items, setItems] = useState<HistoryRunItem[] | null>(null);
  const [detail, setDetail] = useState<HistoryRunDetail | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setItems(await api<HistoryRunItem[]>(`/sessions/${sessionId}/history`));
      setError(null);
    } catch (e) {
      setError(e);
    }
  }, [sessionId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function open(runId: string) {
    setLoadingId(runId);
    setError(null);
    try {
      setDetail(await api<HistoryRunDetail>(`/sessions/${sessionId}/history/${runId}`));
    } catch (e) {
      setError(e);
    } finally {
      setLoadingId(null);
    }
  }

  return (
    <>
      <div className="mb-6">
        <Link
          href={`/verified-learning/learn/${sessionId}`}
          className="mb-2 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft aria-hidden className="h-4 w-4" />
          返回继续学习
        </Link>
        <h1 className="text-2xl font-bold">历史回看</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          只读查看已生成的课件与作答记录，不影响学习进度。
        </p>
      </div>

      <ErrorBox error={error} onRetry={load} />

      {items === null ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
          正在加载历史…
        </p>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">还没有学习记录。</p>
      ) : (
        <ul className="space-y-2">
          {items.map((item) => (
            <li key={item.runId}>
              <button
                type="button"
                onClick={() => void open(item.runId)}
                aria-expanded={detail?.runId === item.runId}
                className="flex w-full flex-wrap items-center gap-3 rounded-lg border border-border px-4 py-3 text-left hover:bg-muted"
              >
                <span className="font-medium">
                  {ACTIVITY_LABEL[item.activity.kind] ?? item.activity.kind}
                </span>
                <span className="text-xs text-muted-foreground">
                  {RUN_STATUS[item.status] ?? item.status} ·{' '}
                  {new Date(item.createdAt).toLocaleString('zh-CN')}
                </span>
                {loadingId === item.runId && (
                  <Loader2 aria-hidden className="h-4 w-4 animate-spin text-muted-foreground" />
                )}
              </button>
            </li>
          ))}
        </ul>
      )}

      {detail && (
        <section aria-label="回看内容" className="mt-8 border-t border-border pt-6">
          <h2 className="mb-4 text-lg font-semibold">
            {ACTIVITY_LABEL[detail.activity.kind] ?? detail.activity.kind}
          </h2>
          {detail.content && (
            <MarkdownView markdown={detail.content.markdown} citations={detail.content.citations} />
          )}
          {detail.questions.length > 0 && (
            <ul className="mt-4 space-y-3">
              {detail.questions.map((q, index) => (
                <li key={q.questionId} className="rounded-lg border border-border p-4">
                  <div className="mb-2 flex items-start gap-3">
                    <span className="mt-0.5 shrink-0 rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                      {q.type === 'choice' ? '选择' : q.type === 'fill' ? '填空' : `编程 · ${q.language ?? ''}`}
                    </span>
                    <p className="whitespace-pre-wrap text-sm">{q.stem}</p>
                  </div>
                  {q.options && (
                    <ul className="mb-2 list-disc pl-6 text-sm text-muted-foreground">
                      {q.options.map((option) => (
                        <li key={option}>{option}</li>
                      ))}
                    </ul>
                  )}
                  {q.attempt?.state === 'finished' ? (
                    <div
                      className={`rounded-md border px-3 py-2 text-sm ${
                        q.attempt.result?.correct
                          ? 'border-success/40 bg-success/5'
                          : 'border-warning/40 bg-warning/5'
                      }`}
                    >
                      <p className="flex items-center gap-2 font-medium">
                        {q.attempt.result?.correct ? (
                          <CheckCircle2 aria-hidden className="h-4 w-4 text-success" />
                        ) : (
                          <XCircle aria-hidden className="h-4 w-4 text-warning" />
                        )}
                        {q.attempt.result?.correct ? '回答正确' : '回答错误'}
                      </p>
                      {q.answer !== undefined && (
                        <p className="mt-1">参考答案：{q.answer}</p>
                      )}
                      {q.explanation && (
                        <p className="mt-1 text-muted-foreground">解析：{q.explanation}</p>
                      )}
                    </div>
                  ) : q.attempt ? (
                    <p className="text-xs text-muted-foreground">
                      作答状态：{q.attempt.state === 'pending' || q.attempt.state === 'running' ? '判题中' : '未完成'}
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground">未作答</p>
                  )}
                  <span className="sr-only">第 {index + 1} 题结束</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </>
  );
}
