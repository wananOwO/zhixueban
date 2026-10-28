'use client';

import { useEffect, useRef } from 'react';
import { minimalSetup } from 'codemirror';
import { EditorView, lineNumbers, placeholder as placeholderExt } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { bracketMatching, indentOnInput, syntaxHighlighting, HighlightStyle } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { python } from '@codemirror/lang-python';
import { javascript } from '@codemirror/lang-javascript';
import { cpp } from '@codemirror/lang-cpp';
import type { ProgrammingLanguageName } from '@/lib/api/types';
import { CODE_COLORS } from './code-highlight';

/** 墨色系语法颜色（与课件代码块同一套）：关键字加粗，不引入朱批以外的鲜艳色相 */
const ink = HighlightStyle.define([
  { tag: [tags.keyword, tags.controlKeyword, tags.definitionKeyword], color: CODE_COLORS.keyword, fontWeight: '600' },
  { tag: [tags.string, tags.special(tags.string)], color: CODE_COLORS.string },
  { tag: [tags.comment, tags.lineComment, tags.blockComment], color: CODE_COLORS.comment, fontStyle: 'italic' },
  { tag: [tags.number, tags.bool, tags.null], color: CODE_COLORS.number },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: CODE_COLORS.func },
]);

const theme = EditorView.theme({
  '&': { fontSize: '0.875rem', backgroundColor: '#f4f4f1', borderRadius: '6px' },
  '&.cm-focused': { outline: '2px solid var(--color-ink)', outlineOffset: '2px' },
  '.cm-content': { fontFamily: 'var(--font-mono)', padding: '0.75rem 0', minHeight: '10rem' },
  '.cm-gutters': { backgroundColor: 'transparent', border: 'none', color: '#a8a7a2' },
  '.cm-activeLine': { backgroundColor: 'transparent' },
});

const LANGUAGE = { python: () => python(), javascript: () => javascript(), c: () => cpp() };

/** 编程题作答编辑器：CodeMirror 6。Tab 保留给键盘导航（不困住焦点），换行时自动缩进 */
export function CodeEditor({ value, onChange, language, label, disabled, describedBy }: {
  value: string;
  onChange: (value: string) => void;
  language: ProgrammingLanguageName;
  label: string;
  disabled?: boolean;
  describedBy?: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const change = useRef(onChange);
  change.current = onChange;

  // biome-ignore lint/correctness/useExhaustiveDependencies: 编辑器只在语言或只读状态变化时重建；value 的外部变化由下一个 effect 同步
  useEffect(() => {
    if (!host.current) return;
    const editor = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          minimalSetup, lineNumbers(), indentOnInput(), bracketMatching(),
          LANGUAGE[language](), syntaxHighlighting(ink), theme,
          placeholderExt('在这里写完整的程序：从标准输入读取，向标准输出打印'),
          EditorView.editable.of(!disabled),
          EditorView.contentAttributes.of({ 'aria-label': label, role: 'textbox', 'aria-multiline': 'true', ...(describedBy ? { 'aria-describedby': describedBy } : {}) }),
          EditorView.updateListener.of(update => { if (update.docChanged) change.current(update.state.doc.toString()); }),
        ],
      }),
    });
    view.current = editor;
    return () => { editor.destroy(); view.current = null; };
  }, [language, disabled, label, describedBy]);

  useEffect(() => {
    const editor = view.current;
    if (editor && editor.state.doc.toString() !== value) editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: value } });
  }, [value]);

  return <div ref={host} />;
}
