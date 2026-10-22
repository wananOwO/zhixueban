'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { FileEdit, Loader2 } from 'lucide-react';
import ErrorBox from '@/components/verified-learning/error-box';
import JobStatus from '@/components/verified-learning/job-status';
import DraftForm from '@/components/verified-learning/draft/draft-form';
import ReviewPanel from '@/components/verified-learning/draft/review-panel';
import { api, newKey, type BookView, type FormDraft } from '@/lib/verified-learning/client';

export default function DraftDetailPage() {
  const params = useParams<{ draftId: string }>();
  const router = useRouter();
  const draftId = params.draftId;

  const [draft, setDraft] = useState<FormDraft | null>(null);
  const [books, setBooks] = useState<BookView[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [failedJob, setFailedJob] = useState(false);
  const [busy, setBusy] = useState(false);

  async function backToEdit() {
    if (!draft) return;
    setBusy(true); setError(null);
    try { setDraft(await api<FormDraft>(`/drafts/${draftId}`, 'PATCH', { expectedRevision: draft.revision, input: {} }, newKey())); setFailedJob(false); }
    catch (e) { setError(e); }
    finally { setBusy(false); }
  }

  const load = useCallback(async () => {
    try {
      const [d, b] = await Promise.all([
        api<FormDraft>(`/drafts/${draftId}`),
        api<BookView[]>('/textbooks'),
      ]);
      setDraft(d);
      setBooks(b);
      setError(null);
    } catch (e) {
      setError(e);
    }
  }, [draftId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function discard() {
    if (!draft) return;
    if (!window.confirm('确定丢弃此草稿？此操作不可恢复。')) return;
    try {
      await api(`/drafts/${draftId}`, 'DELETE', { expectedRevision: draft.revision });
      router.replace('/verified-learning/drafts');
    } catch (e) {
      setError(e);
    }
  }

  return (
    <>
      {error && !draft ? (
        <ErrorBox error={error} onRetry={load} />
      ) : !draft ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
          正在加载草稿…
        </p>
      ) : (
        <>
          <h1 className="mb-1 flex items-center gap-2 text-2xl font-bold">
            <FileEdit aria-hidden className="h-6 w-6" />
            {draft.input.title || '未命名草稿'}
          </h1>
          <p className="mb-6 text-sm text-muted-foreground">
            {draft.state === 'editing' && '编辑学习目标与资料范围，保存后生成课程方案。'}
            {draft.state === 'generating' && 'AI 正在生成课程方案，请稍候。'}
            {draft.state === 'review' && '核对生成的方案：来源、先修与缺口，确认后创建课程。'}
            {draft.state === 'confirmed' && '课程已确认创建。'}
          </p>

          <ErrorBox error={error} />
          {(draft.state === 'editing' || failedJob) && draft.review && <p className="mb-4 text-sm text-warning">当前有历史生成结果，修改后请重新生成。</p>}
          {draft.state === 'editing' && (
            <DraftForm
              draft={draft}
              books={books}
              onSaved={setDraft}
              onGenerating={() => { setFailedJob(false); void load(); }}
              onDiscarded={() => void discard()}
            />
          )}

          {draft.state === 'generating' && draft.generationJobId && (
            <ul className="space-y-2">
              <JobStatus
                key={draft.generationJobId}
                jobId={draft.generationJobId}
                onDone={(job) => { setFailedJob(job.status === 'failed' || job.status === 'cancelled'); void load(); }}
              />
              {failedJob && <li><button disabled={busy} type="button" onClick={() => void backToEdit()} className="rounded-md border border-border px-4 py-2 text-sm">返回编辑并重新生成</button></li>}
            </ul>
          )}

          {draft.state === 'review' && draft.review && (
            <ReviewPanel
              draft={draft}
              onChanged={setDraft}
              onBackToEdit={() => void backToEdit()}
            />
          )}

          {draft.state === 'confirmed' && draft.confirmed && (
            <div className="rounded-lg border border-success/40 bg-success/5 p-4">
              <p className="text-sm">课程已创建，可以开始学习。</p>
              <button
                type="button"
                onClick={() => router.push(`/verified-learning/learn/${draft.confirmed!.sessionId}`)}
                className="mt-3 rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background hover:opacity-90"
              >
                进入学习
              </button>
            </div>
          )}
        </>
      )}
    </>
  );
}
