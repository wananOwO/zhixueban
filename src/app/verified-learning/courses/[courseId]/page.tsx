'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { Download, Loader2, Pencil, Plus, StickyNote } from 'lucide-react';
import ErrorBox from '@/components/verified-learning/error-box';
import {
  api,
  newKey,
  type CourseListItem,
  type NoteView,
  type ProgressView,
} from '@/lib/verified-learning/client';

export default function CourseDetailPage() {
  const params = useParams<{ courseId: string }>();
  const searchParams = useSearchParams();
  const courseId = params.courseId;
  const versionId = searchParams.get('versionId') ?? '';

  const [course, setCourse] = useState<CourseListItem | null>(null);
  const [progress, setProgress] = useState<ProgressView | null>(null);
  const [notes, setNotes] = useState<NoteView[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [newPoint, setNewPoint] = useState('');
  const [newContent, setNewContent] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [courses, prog, noteList] = await Promise.all([
        api<CourseListItem[]>('/courses'),
        versionId
          ? api<ProgressView>(`/progress?versionId=${encodeURIComponent(versionId)}`)
          : Promise.resolve(null),
        api<NoteView[]>(`/notes?courseId=${encodeURIComponent(courseId)}`),
      ]);
      setCourse(courses.find((c) => c.courseId === courseId) ?? null);
      setProgress(prog);
      // 笔记按当前课程版本筛选
      setNotes(versionId ? noteList.filter((n) => n.versionId === versionId) : noteList);
      setError(null);
    } catch (e) {
      setError(e);
    }
  }, [courseId, versionId]);

  useEffect(() => {
    void load();
  }, [load]);

  const points =
    course?.snapshot.outline?.flatMap((m) =>
      m.points.map((p) => ({ id: p.knowledgePointId, title: p.title })),
    ) ?? [];

  async function addNote() {
    if (!newPoint || !newContent.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api<NoteView>(
        '/notes',
        'POST',
        { versionId, knowledgePointId: newPoint, content: newContent },
        newKey(),
      );
      setNewContent('');
      await load();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  async function saveNote(note: NoteView) {
    setBusy(true);
    setError(null);
    try {
      await api<NoteView>(
        `/notes/${note.noteId}`,
        'PATCH',
        {
          versionId: note.versionId,
          knowledgePointId: note.knowledgePointId,
          expectedRevision: note.revision,
          content: editContent,
        },
        newKey(),
      );
      setEditing(null);
      await load();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  const verifiedSet = new Set(progress?.verifiedKnowledgePointIds ?? []);

  return (
    <>
      <h1 className="mb-1 text-2xl font-bold">{course?.snapshot.goal ?? '课程详情'}</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        版本 {versionId.slice(0, 8)}… 的笔记与掌握画像
      </p>

      <ErrorBox error={error} onRetry={load} />

      {/* 进度画像 */}
      <section aria-labelledby="progress-heading" className="mb-8">
        <h2 id="progress-heading" className="mb-3 text-lg font-semibold">
          掌握画像
        </h2>
        {!progress ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
            正在加载进度…
          </p>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg border border-border p-4">
                <p className="text-2xl font-bold">{progress.completedActivities}</p>
                <p className="text-xs text-muted-foreground">已完成活动</p>
              </div>
              <div className="rounded-lg border border-border p-4">
                <p className="text-2xl font-bold">
                  {progress.attempts.total > 0
                    ? `${Math.round((progress.attempts.correct / progress.attempts.total) * 100)}%`
                    : '—'}
                </p>
                <p className="text-xs text-muted-foreground">
                  作答正确率（{progress.attempts.correct}/{progress.attempts.total}）
                </p>
              </div>
              <div className="rounded-lg border border-border p-4">
                <p className="text-2xl font-bold text-success">
                  {progress.verifiedKnowledgePointIds.length}
                </p>
                <p className="text-xs text-muted-foreground">已验证掌握知识点</p>
              </div>
            </div>
            {progress.dailyActivity.length > 0 && (
              <div>
                <p className="mb-2 text-sm font-medium">近期活动</p>
                <ul className="flex flex-wrap gap-2">
                  {progress.dailyActivity.slice(-14).map((day) => (
                    <li
                      key={day.date}
                      title={`${day.date}：${day.count} 次活动`}
                      className="rounded bg-muted px-2 py-1 text-xs"
                    >
                      {day.date.slice(5)} · {day.count}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <ul className="grid gap-1 sm:grid-cols-2">
              {progress.knowledgePoints.map((point) => (
                <li
                  key={point.knowledgePointId}
                  className="flex items-center gap-2 rounded px-2 py-1 text-sm"
                >
                  <span
                    className={`h-2 w-2 rounded-full ${
                      verifiedSet.has(point.knowledgePointId) ? 'bg-success' : 'bg-border'
                    }`}
                    aria-hidden
                  />
                  {point.title}
                  <span className="text-xs text-muted-foreground">
                    {verifiedSet.has(point.knowledgePointId) ? '已验证掌握' : '未掌握'}
                  </span>
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted-foreground">
              掌握标准：3 道不同题、最近最多 5 道内 80% 正确且最近独立答对；阅读与自报不计入。
            </p>
          </div>
        )}
      </section>

      {/* 笔记 */}
      <section aria-labelledby="notes-heading">
        <h2 id="notes-heading" className="mb-3 flex items-center gap-2 text-lg font-semibold">
          <StickyNote aria-hidden className="h-5 w-5" />
          课程笔记
        </h2>
        {notes === null ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
            正在加载笔记…
          </p>
        ) : (
          <>
            {notes.length === 0 && (
              <p className="mb-4 text-sm text-muted-foreground">这个版本还没有笔记。</p>
            )}
            <ul className="mb-6 space-y-3">
              {notes.map((note) => (
                <li key={note.noteId} className="rounded-lg border border-border p-4">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="rounded bg-muted px-2 py-0.5 text-xs">
                      {points.find((p) => p.id === note.knowledgePointId)?.title ??
                        note.knowledgePointId}
                    </span>
                    <div className="flex gap-1">
                      <a
                        href={`/api/verified-learning/v1/notes/${note.noteId}/export`}
                        download
                        aria-label="导出笔记为 Markdown"
                        className="rounded-md p-1.5 text-muted-foreground hover:bg-muted"
                      >
                        <Download aria-hidden className="h-4 w-4" />
                      </a>
                      <button
                        type="button"
                        onClick={() => {
                          setEditing(note.noteId);
                          setEditContent(note.content);
                        }}
                        aria-label="编辑笔记"
                        className="rounded-md p-1.5 text-muted-foreground hover:bg-muted"
                      >
                        <Pencil aria-hidden className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                  {editing === note.noteId ? (
                    <>
                      <textarea
                        value={editContent}
                        onChange={(e) => setEditContent(e.target.value)}
                        rows={5}
                        aria-label="笔记内容"
                        className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                      />
                      <div className="mt-2 flex gap-2">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void saveNote(note)}
                          className="rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background hover:opacity-90 disabled:opacity-50"
                        >
                          保存
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditing(null)}
                          className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted"
                        >
                          取消
                        </button>
                      </div>
                    </>
                  ) : (
                    <p className="whitespace-pre-wrap text-sm">{note.content}</p>
                  )}
                </li>
              ))}
            </ul>

            <div className="rounded-lg border border-border p-4">
              <p className="mb-2 text-sm font-medium">写新笔记</p>
              <select
                value={newPoint}
                onChange={(e) => setNewPoint(e.target.value)}
                aria-label="选择知识点"
                className="mb-2 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              >
                <option value="">选择知识点…</option>
                {points.map((point) => (
                  <option key={point.id} value={point.id}>
                    {point.title}
                  </option>
                ))}
              </select>
              <textarea
                value={newContent}
                onChange={(e) => setNewContent(e.target.value)}
                rows={4}
                placeholder="记录你的理解、疑问或总结…"
                aria-label="新笔记内容"
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              />
              <button
                type="button"
                disabled={busy || !newPoint || !newContent.trim()}
                onClick={() => void addNote()}
                className="mt-2 flex items-center gap-1.5 rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background hover:opacity-90 disabled:opacity-50"
              >
                <Plus aria-hidden className="h-3.5 w-3.5" />
                保存笔记
              </button>
            </div>
          </>
        )}
      </section>
    </>
  );
}
