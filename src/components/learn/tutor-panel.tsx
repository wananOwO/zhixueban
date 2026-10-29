'use client';

import Link from 'next/link';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, type UIMessage } from 'ai';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Square, Trash2, X } from 'lucide-react';
import { API_BASE } from '@/lib/api/client';
import { useMode } from '@/lib/api/queries';
import { parseTutorCitations } from '@/lib/citations';
import { isWebSource, sourceNoteLabel } from '@/lib/labels';
import { modelHeaderValue, useModelKey } from '@/lib/stores/model-key';
import { clearTutorHistory, loadTutorHistory, saveTutorHistory } from '@/lib/stores/tutor-history';
import { Button } from '@/components/ui/button';
import { BlockError } from '@/components/states/block-states';
import type { SourceTarget } from '@/components/zhupi/source-drawer';

export interface TutorSelection { sourceId: string; chapterId: string; paragraphIndex: number; text: string }

/**
 * 学习助教：流式回答，出处〔来源ID·第N段〕渲染为可回查的朱批出处。
 * 对话按会话存在浏览器 localStorage，服务器不保存；一次只发送最近 20 条消息。
 * 线上模式用浏览器保存的 Key（X-VL-Model），没有 Key 时输入框禁用。
 */
export function TutorPanel({ sessionId, runId, selection, onClearSelection, titles, chapterOf, onOpen, onClose }: {
  sessionId: string;
  runId?: string;
  selection: TutorSelection | null;
  onClearSelection: () => void;
  titles: Record<string, string>;
  /** 出处只有来源与段号：用课件引用推断章节，推断不出时打开该来源第一章 */
  chapterOf: (sourceId: string, paragraphIndex: number) => string | undefined;
  onOpen: (target: SourceTarget) => void;
  onClose?: () => void;
}) {
  const mode = useMode();
  const modelKey = useModelKey(state => state.config);
  const online = mode.data?.mode === 'online';
  const needsKey = online && !modelKey;
  const context = useRef({ runId, selection });
  context.current = { runId, selection };

  const transport = useMemo(() => new DefaultChatTransport<UIMessage>({
    api: `${API_BASE}/sessions/${encodeURIComponent(sessionId)}/tutor`,
    credentials: 'same-origin',
    prepareSendMessagesRequest: ({ messages }) => {
      const headers: Record<string, string> = {};
      const model = modelHeaderValue();
      if (model) headers['X-VL-Model'] = model;
      const { runId: run, selection: picked } = context.current;
      return { headers, body: { messages: messages.slice(-20), ...(run ? { runId: run } : {}), ...(picked ? { selection: picked } : {}) } };
    },
  }), [sessionId]);
  const [initial] = useState(() => loadTutorHistory(sessionId));
  const chat = useChat({ id: `tutor-${sessionId}`, messages: initial, transport });
  const busy = chat.status === 'submitted' || chat.status === 'streaming';
  useEffect(() => { if (!busy) saveTutorHistory(sessionId, chat.messages); }, [busy, chat.messages, sessionId]);

  const [input, setInput] = useState('');
  const list = useRef<HTMLOListElement>(null);
  // 新消息或流式追加时把最后一条滚入视野
  const scrollKey = `${chat.messages.length}:${chat.messages.at(-1)?.parts.length ?? 0}`;
  useEffect(() => { if (scrollKey !== '0:0') list.current?.lastElementChild?.scrollIntoView({ block: 'nearest' }); }, [scrollKey]);

  function send() {
    const text = input.trim();
    if (!text || busy || needsKey) return;
    setInput('');
    void chat.sendMessage({ text });
    onClearSelection();
  }
  const open = (sourceId: string, paragraphIndex: number) => {
    const chapterId = chapterOf(sourceId, paragraphIndex);
    if (chapterId) onOpen({ sourceId, chapterId, paragraphIndex });
  };

  return (
    <aside aria-label="助教" className="flex min-h-0 flex-col">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-serif text-h3 font-bold">助教</h2>
        <div className="flex items-center">
          {chat.messages.length > 0 && (
            <Button size="icon" variant="ghost" className="size-8" aria-label="清空对话" onClick={() => { chat.setMessages([]); clearTutorHistory(sessionId); }}><Trash2 aria-hidden /></Button>
          )}
          {onClose && <Button size="icon" variant="ghost" className="size-8" aria-label="收起助教" onClick={onClose}><X aria-hidden /></Button>}
        </div>
      </div>
      <p className="mt-0.5 text-sm text-muted">只读本课程的资料回答，每个结论标出原书第几段。对话只保存在这个浏览器里。</p>

      <ol ref={list} className="mt-4 grid min-h-0 flex-1 content-start gap-4 overflow-y-auto" aria-live="polite" aria-relevant="additions text">
        {chat.messages.length === 0 && <li className="text-base text-muted">选中课件里的一段文字可以「就这段提问」，也可以直接问。</li>}
        {chat.messages.map((message, index) => {
          const text = message.parts.filter(p => p.type === 'text').map(p => (p as { text: string }).text).join('');
          const streaming = busy && index === chat.messages.length - 1 && message.role === 'assistant';
          if (message.role === 'user') {
            return <li key={message.id} className="justify-self-end rounded-[var(--radius-control)] bg-ground px-3.5 py-2 text-base">{text}</li>;
          }
          return (
            <li key={message.id} className="font-serif text-[1rem] leading-[1.8]">
              <span className="whitespace-pre-wrap">
                {parseTutorCitations(text).map((piece, i) => piece.type === 'text' ? <span key={i}>{piece.text}</span> : (
                  <button
                    key={i}
                    type="button"
                    onClick={() => open(piece.sourceId, piece.paragraphIndex)}
                    className="mx-0.5 whitespace-nowrap font-sans text-[0.78125rem] font-medium text-zhu hover:underline hover:underline-offset-4"
                  >
                    {isWebSource(piece.sourceId) ? sourceNoteLabel(titles[piece.sourceId], piece.sourceId) : '教材'} · 第 {piece.paragraphIndex} 段
                  </button>
                ))}
              </span>
              {streaming && <span className="stream-caret" aria-hidden />}
            </li>
          );
        })}
        {chat.status === 'submitted' && <li className="text-sm text-muted">助教正在读资料…</li>}
      </ol>
      <BlockError className="mt-3" error={chat.error} />

      <form
        className="mt-4 rounded-[10px] bg-paper p-2.5 shadow-[var(--shadow-float)] focus-within:shadow-[0_10px_30px_rgba(0,0,0,0.12),0_0_0_2px_var(--color-ink)]"
        onSubmit={event => { event.preventDefault(); send(); }}
      >
        {selection && (
          <p className="mb-2 flex items-start gap-2 px-1 text-xs text-zhu">
            <span className="min-w-0 flex-1 line-clamp-2">就这段提问：{selection.text}</span>
            <button type="button" className="shrink-0 text-muted hover:text-ink" onClick={onClearSelection} aria-label="取消选中的段落"><X className="size-3.5" aria-hidden /></button>
          </p>
        )}
        <label htmlFor={`tutor-${sessionId}`} className="sr-only">向助教提问</label>
        <textarea
          id={`tutor-${sessionId}`}
          rows={2}
          value={input}
          disabled={needsKey}
          onChange={event => setInput(event.target.value)}
          onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); send(); } }}
          placeholder={needsKey ? '先在设置中填写模型 Key' : '就这一节提问，回答会写明出自原书第几段'}
          className="block w-full resize-none bg-transparent px-1 text-base outline-none placeholder:text-muted"
        />
        <div className="mt-1.5 flex items-center justify-between gap-2">
          {needsKey ? <Link href="/settings" className="px-1 text-sm font-medium underline underline-offset-4">去设置填写 Key</Link> : <span className="px-1 text-xs text-muted">Enter 发送，Shift+Enter 换行</span>}
          {busy ? (
            <Button size="sm" onClick={() => void chat.stop()}><Square aria-hidden />停止</Button>
          ) : (
            <Button size="sm" type="submit" disabled={!input.trim() || needsKey}>提问</Button>
          )}
        </div>
      </form>
    </aside>
  );
}
