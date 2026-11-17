'use client';

import { queryOptions, useQuery } from '@tanstack/react-query';
import { api, ApiError } from './client';
import type { BookView, CourseListItem, FormDraft, JobView, ModeView, SettingsView } from './types';

/** TanStack Query 键：同一资源在各页面共用缓存 */
export const queryKeys = {
  mode: () => ['mode'] as const,
  access: () => ['access'] as const,
  books: (q = '', archived = false) => ['books', q, archived] as const,
  booksAll: () => ['books'] as const,
  book: (id: string) => ['book', id] as const,
  bookUsage: (id: string) => ['book', id, 'usage'] as const,
  retrievalIndex: (id: string) => ['book', id, 'retrieval-index'] as const,
  chapter: (bookId: string, chapterId: string, revision: string) => ['chapter', bookId, chapterId, revision] as const,
  drafts: () => ['drafts'] as const,
  draft: (id: string) => ['draft', id] as const,
  templates: () => ['templates'] as const,
  courses: () => ['courses'] as const,
  session: (id: string) => ['session', id] as const,
  run: (id: string) => ['run', id] as const,
  progress: (versionId: string) => ['progress', versionId] as const,
  notes: (courseId: string) => ['notes', courseId] as const,
  jobs: () => ['jobs'] as const,
  job: (id: string) => ['job', id] as const,
  trace: (id: string) => ['trace', id] as const,
  history: (sessionId: string) => ['history', sessionId] as const,
  historyRun: (sessionId: string, runId: string) => ['history', sessionId, runId] as const,
  settings: () => ['settings'] as const,
  judge: () => ['judge'] as const,
};

export type RetrievalIndexStatusView = {
  status: 'none' | 'queued' | 'running' | 'waiting_user' | 'succeeded' | 'failed' | 'cancelled';
  profileId: string | null;
  ready: number;
  failed: number;
  total: number;
  paragraphCount?: number;
  charCount?: number;
  baseUrl?: string | null;
  jobId: string | null;
  usable: boolean;
  resumable?: boolean;
  leaseExpired?: boolean;
  error?: { code: string; message: string; retryable: boolean } | null;
  configured: boolean;
  model: string | null;
};

/** 页面与意图预热共用选项，保持新鲜期、请求和取消行为一致。 */
export const listQueries = {
  books: (q = '', archived = false) => queryOptions({
    queryKey: queryKeys.books(q, archived),
    staleTime: 5_000,
    queryFn: ({ signal }) => api<BookView[]>(`/textbooks?${new URLSearchParams({ q, archived: String(archived) })}`, { signal }),
  }),
  courses: () => queryOptions({
    queryKey: queryKeys.courses(), staleTime: 5_000,
    queryFn: ({ signal }) => api<CourseListItem[]>('/courses', { signal }),
  }),
  drafts: () => queryOptions({
    queryKey: queryKeys.drafts(), staleTime: 5_000,
    queryFn: ({ signal }) => api<FormDraft[]>('/drafts', { signal }),
  }),
  jobs: () => queryOptions({
    queryKey: queryKeys.jobs(), staleTime: 5_000,
    queryFn: ({ signal }) => api<JobView[]>('/jobs', { signal }),
  }),
  settings: () => queryOptions({
    queryKey: queryKeys.settings(), staleTime: 5_000,
    queryFn: ({ signal }) => api<SettingsView>('/settings', { signal }),
  }),
};

const LOCAL_MODE: ModeView = { mode: 'local', authRequired: true, uploadLimitBytes: 50 * 1024 * 1024, booksPerSpace: null };

/** 运行模式：旧服务没有 /mode 时按本地模式处理 */
export function useMode() {
  return useQuery({
    queryKey: queryKeys.mode(),
    staleTime: Infinity,
    queryFn: async () => {
      try {
        return await api<ModeView>('/mode');
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) return LOCAL_MODE;
        throw error;
      }
    },
  });
}
