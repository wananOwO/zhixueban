'use client';

import Link from 'next/link';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, type UIMessage } from 'ai';
import { useEffect, useMemo, useRef, useState } from 'react';
import { BookmarkPlus, Camera, MessageSquareText, Square, Trash2, X } from 'lucide-react';
import { api, API_BASE, newKey } from '@/lib/api/client';
import { useMode } from '@/lib/api/queries';
import { parseTutorCitations } from '@/lib/citations';
import { isWebSource, sourceNoteLabel } from '@/lib/labels';
import { embeddingHeaderValue, modelHeaderValue, useModelKey } from '@/lib/stores/model-key';
import { clearTutorHistory, loadTutorHistory, saveTutorHistory } from '@/lib/stores/tutor-history';
import { visionFailureMessage, type VisionExtraction, type VisionMode } from '@/lib/verified-learning/vision/extraction';
import { Button } from '@/components/ui/button';
import { BlockError } from '@/components/states/block-states';
import type { SourceTarget } from '@/components/zhupi/source-drawer';
import { RetrievalEvidence, type RetrievalEvidenceHit } from './retrieval-evidence';
import { ScreenshotTutorInput } from './screenshot-tutor-input';
import { VisionExtractionCard, type AllowedCoursePoint } from './vision-extraction-card';

export interface TutorSelection { sourceId: string; chapterId: string; paragraphIndex: number; text: string }

interface RetrieveEnvelope {
  hits: RetrievalEvidenceHit[];
  degraded: boolean;
  notice?: string;
}

/** 读取 AI SDK UIMessage SSE 文本流，拼接增量 delta */
async function consumeTutorSseStream(
  response: Response,
  signal: AbortSignal,
  onDelta: (fullText: string) => void,
): Promise<string> {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let full = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done || signal.aborted) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        try {
          const parsed = JSON.parse(payload) as { type?: string; delta?: string; errorText?: string };
          if (parsed.type === 'text-delta' && typeof parsed.delta === 'string') {
            full += parsed.delta;
            onDelta(full);
          } else if (parsed.type === 'error' && parsed.errorText) {
            throw new Error(parsed.errorText);
          }
        } catch (err) {
          if (err instanceof Error && !/JSON/.test(err.name)) throw err;
        }
      }
    }
    return full;
  } finally {
    reader.releaseLock();
  }
}

/**
 * 学习助教：支持「文字提问」与「截图提问」双模式。
 * - 文字提问：流式回答，出处〔来源ID·第N段〕渲染为可回查的朱批出处；
 * - 截图提问：预览校验 → 视觉结构化提取 → 用户编辑核对 → 混合检索教材段落（RetrievalEvidence）→ 带出处流式讲解 / 1 道变式题；
 * - 原图绝不持久化；确认后的截图问答只有用户点击“保留到对话”才写入本地对话历史。
 */
export function TutorPanel({
  sessionId,
  runId,
  selection,
  onClearSelection,
  titles,
  chapterOf,
  allowedPoints = [],
  hasActiveRun = false,
  onPracticeCreated,
  onOpen,
  onClose,
}: {
  sessionId: string;
  runId?: string;
  selection: TutorSelection | null;
  onClearSelection: () => void;
  titles: Record<string, string>;
  /** 出处只有来源与段号：用课件引用推断章节，推断不出时打开该来源第一章 */
  chapterOf: (sourceId: string, paragraphIndex: number) => string | undefined;
  allowedPoints?: readonly AllowedCoursePoint[];
  hasActiveRun?: boolean;
  onPracticeCreated?: () => void;
  onOpen: (target: SourceTarget) => void;
  onClose?: () => void;
}) {
  const mode = useMode();
  const modelKey = useModelKey(state => state.config);
  const visionKey = useModelKey(state => state.vision);
  const online = mode.data?.mode === 'online';
  const needsKey = online && !modelKey;
  const needsVisionKey = online && !visionKey && !modelKey;
  const context = useRef({ runId, selection });
  context.current = { runId, selection };

  const transport = useMemo(() => new DefaultChatTransport<UIMessage>({
    api: `${API_BASE}/sessions/${encodeURIComponent(sessionId)}/tutor`,
    credentials: 'same-origin',
    prepareSendMessagesRequest: ({ messages }) => {
      const headers: Record<string, string> = {};
      const model = modelHeaderValue();
      if (model) headers['X-VL-Model'] = model;
      const emb = embeddingHeaderValue();
      if (emb) headers['X-VL-Embedding'] = emb;
      const { runId: run, selection: picked } = context.current;
      return { headers, body: { messages: messages.slice(-20), ...(run ? { runId: run } : {}), ...(picked ? { selection: picked } : {}) } };
    },
  }), [sessionId]);

  const [initial] = useState(() => loadTutorHistory(sessionId));
  const chat = useChat({ id: `tutor-${sessionId}`, messages: initial, transport });
  const busy = chat.status === 'submitted' || chat.status === 'streaming';
  useEffect(() => { if (!busy) saveTutorHistory(sessionId, chat.messages); }, [busy, chat.messages, sessionId]);

  const [tab, setTab] = useState<'text' | 'vision'>('text');
  const [input, setInput] = useState('');
  const [textEvidence, setTextEvidence] = useState<RetrieveEnvelope | null>(null);
  const list = useRef<HTMLOListElement>(null);

  // 多模态截图状态机
  const [visionStage, setVisionStage] = useState<'idle' | 'extracting' | 'review' | 'retrieving' | 'explaining' | 'done' | 'creating_practice'>('idle');
  const [visionMode, setVisionMode] = useState<VisionMode>('explain');
  const [extraction, setExtraction] = useState<VisionExtraction | null>(null);
  const [visionError, setVisionError] = useState<string | null>(null);
  const [visionEvidence, setVisionEvidence] = useState<RetrieveEnvelope | null>(null);
  const [visionAnswer, setVisionAnswer] = useState('');
  const [confirmedText, setConfirmedText] = useState('');
  const [savedToHistory, setSavedToHistory] = useState(false);
  const visionAbortRef = useRef<AbortController | null>(null);

  useEffect(() => () => { visionAbortRef.current?.abort(); }, []);

  const scrollKey = `${chat.messages.length}:${chat.messages.at(-1)?.parts.length ?? 0}`;
  useEffect(() => { if (scrollKey !== '0:0') list.current?.lastElementChild?.scrollIntoView({ block: 'nearest' }); }, [scrollKey]);

  function send() {
    const text = input.trim();
    if (!text || busy || needsKey) return;
    setInput('');
    void chat.sendMessage({ text });
    onClearSelection();
    void api<RetrieveEnvelope>(`/sessions/${encodeURIComponent(sessionId)}/retrieve`, {
      method: 'POST',
      body: { query: text.slice(0, 200), limit: 5 },
      embeddingHeader: true,
    }).then(setTextEvidence).catch(() => setTextEvidence(null));
  }

  const open = (sourceId: string, paragraphIndex: number) => {
    const chapterId = chapterOf(sourceId, paragraphIndex);
    if (chapterId) onOpen({ sourceId, chapterId, paragraphIndex });
  };

  function cancelVision() {
    visionAbortRef.current?.abort();
    visionAbortRef.current = null;
    setVisionStage(extraction ? 'review' : 'idle');
  }

  async function handleExtract(file: File, selectedMode: VisionMode) {
    visionAbortRef.current?.abort();
    const controller = new AbortController();
    visionAbortRef.current = controller;
    setVisionError(null);
    setVisionMode(selectedMode);
    setVisionStage('extracting');
    setVisionAnswer('');
    setVisionEvidence(null);
    setSavedToHistory(false);

    try {
      const form = new FormData();
      form.set('file', file);
      form.set('mode', selectedMode);
      const data = await api<{ extraction: VisionExtraction; summary: string }>(
        `/sessions/${encodeURIComponent(sessionId)}/vision/extract`,
        {
          method: 'POST',
          body: form,
          key: newKey(),
          visionHeader: true,
          signal: controller.signal,
        },
      );
      if (controller.signal.aborted) return;
      setExtraction(data.extraction);
      setVisionStage('review');
    } catch (error) {
      if (controller.signal.aborted) return;
      setVisionStage('idle');
      setVisionError(error instanceof Error ? error.message : visionFailureMessage(error));
    }
  }

  async function handleVisionExplain(payload: {
    mode: 'explain' | 'analyze-code';
    transcription: string;
    concepts: string[];
    language: 'python' | 'javascript' | 'c' | null;
    uncertainty: string[];
    needsClarification: boolean;
    clarified: boolean;
  }) {
    if (needsKey) {
      setVisionError('请先在设置中填写模型 Key 后再生成讲解。');
      return;
    }
    visionAbortRef.current?.abort();
    const controller = new AbortController();
    visionAbortRef.current = controller;
    setVisionError(null);
    setVisionAnswer('');
    setConfirmedText(payload.transcription);
    setSavedToHistory(false);
    setVisionStage('retrieving');

    try {
      const querySeed = [...payload.concepts, payload.transcription.replace(/\s+/g, ' ').slice(0, 120)].join(' ').trim().slice(0, 200);
      if (querySeed) {
        const retrieved = await api<RetrieveEnvelope>(`/sessions/${encodeURIComponent(sessionId)}/retrieve`, {
          method: 'POST',
          body: { query: querySeed, limit: 6 },
          embeddingHeader: true,
          signal: controller.signal,
        }).catch(() => null);
        if (controller.signal.aborted) return;
        if (retrieved) setVisionEvidence(retrieved);
      }

      setVisionStage('explaining');
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      const modelHdr = modelHeaderValue();
      if (modelHdr) headers['X-VL-Model'] = modelHdr;
      const embHdr = embeddingHeaderValue();
      if (embHdr) headers['X-VL-Embedding'] = embHdr;

      const response = await fetch(`${API_BASE}/sessions/${encodeURIComponent(sessionId)}/vision/explain`, {
        method: 'POST',
        credentials: 'same-origin',
        headers,
        body: JSON.stringify({ ...payload, ...(runId ? { runId } : {}) }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const env = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
        throw new Error(env?.error?.message ?? `讲解生成失败（${response.status}）`);
      }

      const finalAnswer = await consumeTutorSseStream(response, controller.signal, partial => {
        if (!controller.signal.aborted) setVisionAnswer(partial);
      });
      if (controller.signal.aborted) return;
      setVisionAnswer(finalAnswer);
      setVisionStage('done');
    } catch (error) {
      if (controller.signal.aborted) return;
      setVisionStage('review');
      setVisionError(error instanceof Error ? error.message : '截图讲解生成失败，可重试或改用文字提问。');
    }
  }

  async function handleVisionPractice(payload: {
    transcription: string;
    concepts: string[];
    language: 'python' | 'javascript' | 'c' | null;
    needsClarification: boolean;
    clarified: boolean;
    knowledgePointIds: string[];
  }) {
    setVisionError(null);
    setVisionStage('creating_practice');
    try {
      await api(`/sessions/${encodeURIComponent(sessionId)}/vision/practice`, {
        method: 'POST',
        body: payload,
        key: newKey(),
        modelHeader: true,
      });
      setVisionStage('done');
      onPracticeCreated?.();
    } catch (error) {
      setVisionStage('review');
      setVisionError(error instanceof Error ? error.message : '变式题创建失败，请检查设置后重试。');
    }
  }

  function keepInLocalHistory() {
    if (!confirmedText || !visionAnswer || savedToHistory) return;
    const nextMessages: UIMessage[] = [
      ...chat.messages,
      { id: crypto.randomUUID(), role: 'user', parts: [{ type: 'text', text: `【截图核对提问】\n${confirmedText}` }] },
      { id: crypto.randomUUID(), role: 'assistant', parts: [{ type: 'text', text: visionAnswer }] },
    ];
    chat.setMessages(nextMessages);
    saveTutorHistory(sessionId, nextMessages);
    setSavedToHistory(true);
  }

  return (
    <aside aria-label="助教" className="flex min-h-0 flex-col">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-serif text-h3 font-bold">助教</h2>
        <div className="flex items-center">
          {chat.messages.length > 0 && (
            <Button size="icon" variant="ghost" className="size-8" aria-label="清空对话" onClick={() => { chat.setMessages([]); clearTutorHistory(sessionId); setTextEvidence(null); }}><Trash2 aria-hidden /></Button>
          )}
          {onClose && <Button size="icon" variant="ghost" className="size-8" aria-label="收起助教" onClick={onClose}><X aria-hidden /></Button>}
        </div>
      </div>
      <p className="mt-0.5 text-sm text-muted">只读本课程的资料回答，每个结论标出原书第几段。对话只保存在这个浏览器里。</p>

      <div role="tablist" aria-label="助教输入方式" className="mt-3 grid grid-cols-2 rounded-[8px] bg-raised p-[3px]">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'text'}
          onClick={() => setTab('text')}
          className={`flex h-[1.875rem] items-center justify-center gap-1.5 rounded-[6px] text-sm transition-colors ${tab === 'text' ? 'bg-paper font-medium text-ink' : 'text-muted hover:text-ink'}`}
        >
          <MessageSquareText className="size-3.5" aria-hidden />文字提问
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'vision'}
          onClick={() => setTab('vision')}
          className={`flex h-[1.875rem] items-center justify-center gap-1.5 rounded-[6px] text-sm transition-colors ${tab === 'vision' ? 'bg-paper font-medium text-ink' : 'text-muted hover:text-ink'}`}
        >
          <Camera className="size-3.5" aria-hidden />截图提问
        </button>
      </div>

      {tab === 'vision' ? (
        <div className="mt-3 grid min-h-0 flex-1 content-start gap-3 overflow-y-auto pr-0.5" aria-live="polite">
          {needsVisionKey && (
            <p className="rounded-[var(--radius-control)] bg-zhu-tint px-3 py-2 text-sm">
              线上模式请先在<Link href="/settings" className="mx-1 font-medium underline underline-offset-4">设置</Link>填写视觉或聊天模型 Key。
            </p>
          )}

          {!extraction ? (
            <ScreenshotTutorInput
              disabled={needsVisionKey}
              extracting={visionStage === 'extracting'}
              error={visionError}
              onExtract={(file, selectedMode) => void handleExtract(file, selectedMode)}
              onSwitchToText={() => { setVisionError(null); setTab('text'); }}
            />
          ) : (
            <VisionExtractionCard
              extraction={extraction}
              initialMode={visionMode}
              allowedPoints={allowedPoints}
              hasActiveRun={hasActiveRun}
              busy={visionStage === 'retrieving' || visionStage === 'explaining' || visionStage === 'creating_practice'}
              onExplain={payload => void handleVisionExplain(payload)}
              onPractice={payload => void handleVisionPractice(payload)}
              onDiscard={() => {
                cancelVision();
                setExtraction(null);
                setVisionAnswer('');
                setVisionEvidence(null);
                setVisionError(null);
                setVisionStage('idle');
              }}
            />
          )}

          {(visionStage === 'extracting' || visionStage === 'retrieving' || visionStage === 'explaining') && (
            <div className="flex items-center justify-between gap-2 rounded-[var(--radius-control)] bg-raised px-3 py-2 text-xs text-ink-soft">
              <span>
                {visionStage === 'extracting' ? '正在调用视觉模型识别截图…' : visionStage === 'retrieving' ? '正在检索课程教材段落…' : '正在生成带出处的讲解…'}
              </span>
              <Button type="button" size="sm" variant="ghost" onClick={cancelVision}>
                <Square className="size-3" aria-hidden />取消
              </Button>
            </div>
          )}

          {visionError && extraction && (
            <div role="alert" className="rounded-[var(--radius-control)] bg-zhu-tint px-3 py-2 text-xs text-zhu-deep">
              {visionError}
            </div>
          )}

          {visionEvidence && (
            <RetrievalEvidence
              hits={visionEvidence.hits}
              degraded={visionEvidence.degraded}
              notice={visionEvidence.notice}
              onOpen={onOpen}
              defaultOpen
            />
          )}

          {visionAnswer && (
            <div className="rounded-[var(--radius-control)] border border-rule bg-paper p-3.5">
              <div className="font-serif text-[1rem] leading-[1.8] whitespace-pre-wrap">
                {parseTutorCitations(visionAnswer).map((piece, i) => piece.type === 'text' ? <span key={i}>{piece.text}</span> : (
                  <button
                    key={i}
                    type="button"
                    onClick={() => open(piece.sourceId, piece.paragraphIndex)}
                    className="mx-0.5 whitespace-nowrap font-sans text-[0.78125rem] font-medium text-zhu hover:underline hover:underline-offset-4"
                  >
                    {isWebSource(piece.sourceId) ? sourceNoteLabel(titles[piece.sourceId], piece.sourceId) : '教材'} · 第 {piece.paragraphIndex} 段
                  </button>
                ))}
                {visionStage === 'explaining' && <span className="stream-caret" aria-hidden />}
              </div>
              {visionStage === 'done' && (
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-rule pt-2.5 text-xs text-muted">
                  <span>截图原图未保存；仅当你确认保留时才将文字问答记入本浏览器。</span>
                  <Button type="button" size="sm" variant="ghost" disabled={savedToHistory} onClick={keepInLocalHistory}>
                    <BookmarkPlus className="size-3.5" aria-hidden />{savedToHistory ? '已保留到对话' : '保留到对话'}
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        <>
          <ol ref={list} className="mt-4 grid min-h-0 flex-1 content-start gap-4 overflow-y-auto" aria-live="polite" aria-relevant="additions text">
            {chat.messages.length === 0 && <li className="text-base text-muted">选中课件里的一段文字可以「就这段提问」，也可以直接问，或切换到「截图提问」。</li>}
            {chat.messages.map((message, index) => {
              const text = message.parts.filter(p => p.type === 'text').map(p => (p as { text: string }).text).join('');
              const streaming = busy && index === chat.messages.length - 1 && message.role === 'assistant';
              if (message.role === 'user') {
                return <li key={message.id} className="justify-self-end rounded-[var(--radius-control)] bg-ground px-3.5 py-2 text-base whitespace-pre-wrap">{text}</li>;
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

          {textEvidence && (
            <RetrievalEvidence
              hits={textEvidence.hits}
              degraded={textEvidence.degraded}
              notice={textEvidence.notice}
              onOpen={onOpen}
            />
          )}

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
        </>
      )}
    </aside>
  );
}
