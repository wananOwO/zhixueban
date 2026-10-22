'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { Copy, FileEdit, Loader2, Plus, Trash2 } from 'lucide-react';
import ErrorBox from '@/components/verified-learning/error-box';
import { api, newKey, type FormDraft } from '@/lib/verified-learning/client';

const STATE_LABEL: Record<string, string> = {
  editing: '编辑中',
  generating: '生成中',
  review: '待确认',
  confirmed: '已确认',
};

export default function DraftsPage() {
  const router = useRouter();
  const [drafts, setDrafts] = useState<FormDraft[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setDrafts(await api<FormDraft[]>('/drafts'));
      setError(null);
    } catch (e) {
      setError(e);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function create() {
    setBusy('new');
    setError(null);
    try {
      const draft = await api<FormDraft>('/drafts', 'POST', {}, newKey());
      router.push(`/verified-learning/drafts/${draft.draftId}`);
    } catch (e) {
      setError(e);
      setBusy(null);
    }
  }

  async function copy(draft: FormDraft) {
    setBusy(draft.draftId);
    setError(null);
    try {
      const copied = await api<FormDraft>(`/drafts/${draft.draftId}/copy`, 'POST', {}, newKey());
      router.push(`/verified-learning/drafts/${copied.draftId}`);
    } catch (e) {
      setError(e);
      setBusy(null);
    }
  }

  async function discard(draft: FormDraft) {
    if (!window.confirm(`确定丢弃草稿「${draft.input.title || '未命名草稿'}」？此操作不可恢复。`)) return;
    setBusy(draft.draftId);
    setError(null);
    try {
      await api(`/drafts/${draft.draftId}`, 'DELETE', { expectedRevision: draft.revision });
      await load();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <FileEdit aria-hidden className="h-6 w-6" />
          课程草稿
        </h1>
        <button
          type="button"
          disabled={busy === 'new'}
          onClick={() => void create()}
          className="flex items-center gap-2 rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {busy === 'new' ? (
            <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
          ) : (
            <Plus aria-hidden className="h-4 w-4" />
          )}
          新建草稿
        </button>
      </div>

      <ErrorBox error={error} onRetry={load} />

      {drafts === null ? (
        <p className="mt-6 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
          正在加载草稿…
        </p>
      ) : drafts.length === 0 ? (
        <p className="mt-6 text-sm text-muted-foreground">
          还没有草稿。新建草稿，描述学习目标并选择教材章节，即可生成课程。
        </p>
      ) : (
        <ul className="mt-6 space-y-3">
          {drafts.map((draft) => (
            <li
              key={draft.draftId}
              className="flex flex-wrap items-center gap-3 rounded-lg border border-border px-4 py-3"
            >
              <div className="min-w-0 flex-1">
                <Link
                  href={`/verified-learning/drafts/${draft.draftId}`}
                  className="font-medium hover:text-accent"
                >
                  {draft.input.title || '未命名草稿'}
                </Link>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  <span
                    className={`rounded px-1.5 py-0.5 ${
                      draft.state === 'review'
                        ? 'bg-success/10 text-success'
                        : draft.state === 'generating'
                          ? 'bg-warning/10 text-warning'
                          : 'bg-muted'
                    }`}
                  >
                    {STATE_LABEL[draft.state] ?? draft.state}
                  </span>
                  {draft.input.goal && <span className="ml-2">目标：{draft.input.goal}</span>}
                </p>
              </div>
              <button
                type="button"
                disabled={busy === draft.draftId}
                onClick={() => void copy(draft)}
                title="复制为新草稿（不共享课程身份）"
                className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted disabled:opacity-50"
              >
                <Copy aria-hidden className="h-3.5 w-3.5" />
                复制
              </button>
              {draft.state !== 'confirmed' && (
                <button
                  type="button"
                  disabled={busy === draft.draftId}
                  onClick={() => void discard(draft)}
                  className="flex items-center gap-1.5 rounded-md border border-danger/40 px-3 py-1.5 text-xs text-danger hover:bg-danger/5 disabled:opacity-50"
                >
                  <Trash2 aria-hidden className="h-3.5 w-3.5" />
                  丢弃
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
