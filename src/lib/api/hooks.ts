'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { api, newKey } from './client';
import { queryKeys } from './queries';
import type { BookView, CourseListItem, DeletionImpact, FormDraft, HistoryRunDetail, HistoryRunItem, JobView, NoteView, ProgressView, SessionView } from './types';

const RUNNING = new Set(['queued', 'running']);
export const isRunning = (job: JobView) => RUNNING.has(job.status);

export function useBooks(q = '', archived = false) {
  return useQuery({
    queryKey: queryKeys.books(q, archived),
    queryFn: () => api<BookView[]>(`/textbooks?${new URLSearchParams({ q, archived: String(archived) })}`),
  });
}

export function useBook(id: string | undefined) {
  return useQuery({ queryKey: queryKeys.book(id ?? ''), enabled: !!id, queryFn: () => api<BookView>(`/textbooks/${encodeURIComponent(id!)}`) });
}

/** 教材被哪些课程版本、草稿使用（删除前的影响预览） */
export function useBookUsage(id: string | undefined) {
  return useQuery({ queryKey: queryKeys.bookUsage(id ?? ''), enabled: !!id, queryFn: () => api<DeletionImpact>(`/textbooks/${encodeURIComponent(id!)}/deletion`) });
}

export function useCourses() {
  return useQuery({ queryKey: queryKeys.courses(), queryFn: () => api<CourseListItem[]>('/courses') });
}

export function useDrafts() {
  return useQuery({ queryKey: queryKeys.drafts(), queryFn: () => api<FormDraft[]>('/drafts') });
}

/** 最近任务；有进行中的任务时每 2 秒刷新 */
export function useJobs() {
  return useQuery({
    queryKey: queryKeys.jobs(),
    queryFn: () => api<JobView[]>('/jobs'),
    refetchInterval: query => (query.state.data?.some(isRunning) ? 2000 : false),
  });
}

export function useSession(id: string | undefined) {
  return useQuery({ queryKey: queryKeys.session(id ?? ''), enabled: !!id, queryFn: () => api<SessionView>(`/sessions/${encodeURIComponent(id!)}`) });
}

export function useProgress(versionId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.progress(versionId ?? ''),
    enabled: !!versionId,
    queryFn: () => api<ProgressView>(`/progress?versionId=${encodeURIComponent(versionId!)}`),
  });
}

/** 学习会话的活动历史（只读，不生成内容） */
export function useHistory(sessionId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.history(sessionId ?? ''),
    enabled: !!sessionId,
    queryFn: () => api<HistoryRunItem[]>(`/sessions/${encodeURIComponent(sessionId!)}/history`),
  });
}

export function useHistoryRun(sessionId: string | undefined, runId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.historyRun(sessionId ?? '', runId ?? ''),
    enabled: !!sessionId && !!runId,
    queryFn: () => api<HistoryRunDetail>(`/sessions/${encodeURIComponent(sessionId!)}/history/${encodeURIComponent(runId!)}`),
  });
}

export function useNotes(courseId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.notes(courseId ?? ''),
    enabled: !!courseId,
    queryFn: () => api<NoteView[]>(`/notes?courseId=${encodeURIComponent(courseId!)}`),
  });
}

/** 新建一份空草稿并进入编辑 */
export function useCreateDraft() {
  const router = useRouter();
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api<FormDraft>('/drafts', { method: 'POST', body: {}, key: newKey() }),
    onSuccess: draft => {
      void client.invalidateQueries({ queryKey: queryKeys.drafts() });
      router.push(`/drafts/${draft.draftId}`);
    },
  });
}

export function useArchiveBook() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (book: BookView) => api<BookView>(`/textbooks/${encodeURIComponent(book.bookId)}`, { method: 'PATCH', body: { expectedRevision: book.revision, archived: !book.archived } }),
    onSuccess: book => {
      void client.invalidateQueries({ queryKey: queryKeys.booksAll() });
      client.setQueryData(queryKeys.book(book.bookId), book);
    },
  });
}
