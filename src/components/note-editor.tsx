'use client';

import { useState } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Save } from 'lucide-react';

/** 知识点笔记编辑器（TipTap 富文本，Markdown 存储） */
export default function NoteEditor({ kpId, onSaved }: { kpId: string; onSaved?: () => void }) {
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const editor = useEditor({
    extensions: [StarterKit],
    immediatelyRender: false,
    editorProps: {
      attributes: {
        'aria-label': '学习笔记编辑区',
        class: 'min-h-32 rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none',
      },
    },
  });

  async function save() {
    if (!editor || editor.isEmpty) return;
    setSaving(true);
    // TipTap 输出 HTML；简单序列化为 Markdown 段落文本（首版）
    const contentMd = editor.getText({ blockSeparator: '\n\n' });
    await fetch('/api/notes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kpId, contentMd }),
    });
    setSaving(false);
    setSaved(true);
    editor.commands.clearContent();
    onSaved?.();
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div className="grid gap-2">
      <EditorContent editor={editor} />
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          className="flex items-center gap-1.5 rounded-md bg-foreground px-3 py-1.5 text-xs text-background disabled:opacity-40"
        >
          <Save aria-hidden className="h-3.5 w-3.5" />
          {saving ? '保存中…' : '保存笔记'}
        </button>
        {saved && (
          <span role="status" className="text-xs text-success">
            已保存
          </span>
        )}
      </div>
    </div>
  );
}
