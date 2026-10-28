'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { API_BASE, ApiError, api, newKey } from '@/lib/api/client';
import { useNotes } from '@/lib/api/hooks';
import { queryKeys } from '@/lib/api/queries';
import { formatShortTime } from '@/lib/utils';
import type { CoursePointView, NoteView } from '@/lib/api/types';
import { Button } from '@/components/ui/button';
import { Field, Select, Textarea } from '@/components/ui/field';
import { Panel } from '@/components/ui/panel';
import { BlockEmpty, BlockError, BlockLoading } from '@/components/states/block-states';

/** 笔记：按知识点分组；新建、编辑（修订号冲突时保留输入）、导出 Markdown */
export function NotesTab({ courseId, versionId, points }: { courseId: string; versionId: string; points: CoursePointView[] }) {
  const client = useQueryClient();
  const notes = useNotes(courseId);
  const [pointId, setPointId] = useState(points[0]?.knowledgePointId ?? '');
  const [content, setContent] = useState('');
  const refresh = () => client.invalidateQueries({ queryKey: queryKeys.notes(courseId) });
  const create = useMutation({
    mutationFn: () => api<NoteView>('/notes', { method: 'POST', body: { versionId, knowledgePointId: pointId, content }, key: newKey() }),
    onSuccess: () => { setContent(''); void refresh(); },
  });
  const titleOf = (id: string) => points.find(p => p.knowledgePointId === id)?.title ?? id;
  const order = new Map(points.map((p, i) => [p.knowledgePointId, i]));
  const groups = [...new Set((notes.data ?? []).map(n => n.knowledgePointId))].sort((a, b) => (order.get(a) ?? 1e9) - (order.get(b) ?? 1e9));

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_24rem] items-start gap-6 max-lg:grid-cols-1">
      <Panel title="我的笔记" description={notes.data?.length ? `${notes.data.length} 条，按知识点的学习顺序排列` : undefined}>
        <BlockError className="mt-3" error={notes.error} onRetry={() => void notes.refetch()} />
        {notes.isPending ? <BlockLoading className="mt-4" lines={4} label="正在读取笔记" /> : groups.length === 0 ? (
          <BlockEmpty className="mt-3" title="还没有笔记">在右边选一个知识点写下要点，学习时也能随时回来补。</BlockEmpty>
        ) : (
          <div className="mt-4 grid gap-6">
            {groups.map(id => (
              <section key={id} aria-label={titleOf(id)}>
                <h3 className="font-medium">{titleOf(id)}</h3>
                <div className="mt-2 grid gap-3">
                  {notes.data!.filter(n => n.knowledgePointId === id).map(note => <NoteItem key={note.noteId} note={note} onSaved={() => void refresh()} />)}
                </div>
              </section>
            ))}
          </div>
        )}
      </Panel>
      <Panel title="新建笔记" className="sticky top-4 max-lg:static">
        <form
          className="mt-4 grid gap-4"
          onSubmit={event => { event.preventDefault(); if (content.trim() && pointId) create.mutate(); }}
        >
          <Field label="知识点" htmlFor="note-point">
            <Select id="note-point" value={pointId} onChange={event => setPointId(event.target.value)}>
              {points.map(p => <option key={p.knowledgePointId} value={p.knowledgePointId}>{p.title}</option>)}
            </Select>
          </Field>
          <Field label="笔记内容" htmlFor="note-content" hint="支持 Markdown，最多 100 KB。">
            <Textarea id="note-content" aria-describedby="note-content-hint" rows={6} value={content} onChange={event => setContent(event.target.value)} />
          </Field>
          <BlockError error={create.error} />
          <Button type="submit" variant="primary" disabled={!content.trim() || !pointId || create.isPending}>
            {create.isPending && <Loader2 className="animate-spin" aria-hidden />}保存笔记
          </Button>
        </form>
      </Panel>
    </div>
  );
}

function NoteItem({ note, onSaved }: { note: NoteView; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note.content);
  const save = useMutation({
    mutationFn: () => api<NoteView>(`/notes/${encodeURIComponent(note.noteId)}`, {
      method: 'PATCH',
      body: { versionId: note.versionId, knowledgePointId: note.knowledgePointId, expectedRevision: note.revision, content: draft },
      key: newKey(),
    }),
    onSuccess: () => { setEditing(false); onSaved(); },
  });
  const conflict = save.error instanceof ApiError && save.error.status === 409;
  return (
    <article className="rounded-[var(--radius-control)] bg-ground px-4 py-3">
      {editing ? (
        <div className="grid gap-3">
          <label htmlFor={`note-${note.noteId}`} className="sr-only">编辑笔记</label>
          <Textarea id={`note-${note.noteId}`} rows={5} value={draft} onChange={event => setDraft(event.target.value)} />
          {conflict ? (
            <div role="alert" className="rounded-[var(--radius-control)] bg-zhu-tint px-3 py-2 text-base">
              这条笔记已在别处修改。你的输入还在上面，可以先复制，再载入最新内容。
              <Button size="sm" className="ml-2" onClick={() => { save.reset(); setEditing(false); onSaved(); }}>载入最新内容</Button>
            </div>
          ) : <BlockError error={save.error} />}
          <div className="flex gap-2">
            <Button size="sm" variant="primary" disabled={!draft.trim() || save.isPending} onClick={() => save.mutate()}>保存</Button>
            <Button size="sm" variant="ghost" onClick={() => { setDraft(note.content); setEditing(false); save.reset(); }}>取消</Button>
          </div>
        </div>
      ) : (
        <>
          <p className="whitespace-pre-wrap break-words text-base">{note.content}</p>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
            {note.updatedAt && <time dateTime={note.updatedAt} className="tabular-nums">{formatShortTime(note.updatedAt)}</time>}
            <button type="button" className="hover:text-ink" onClick={() => { setDraft(note.content); setEditing(true); }}>编辑</button>
            <a className="inline-flex items-center gap-1 hover:text-ink" href={`${API_BASE}/notes/${encodeURIComponent(note.noteId)}/export`} download>
              <Download className="size-3.5" aria-hidden />导出 Markdown
            </a>
          </div>
        </>
      )}
    </article>
  );
}
