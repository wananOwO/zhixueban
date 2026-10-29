// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useJobStream } from '@/lib/api/use-job-stream';

/** 伪造的 EventSource：测试里手动推送事件 */
class FakeEventSource {
  static instances: FakeEventSource[] = [];
  url: string;
  closed = false;
  listeners = new Map<string, ((event: MessageEvent) => void)[]>();
  onerror: (() => void) | null = null;
  constructor(url: string) { this.url = url; FakeEventSource.instances.push(this); }
  addEventListener(type: string, fn: (event: MessageEvent) => void) { this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]); }
  removeEventListener() {}
  close() { this.closed = true; }
  emit(type: string, data: unknown, id?: string) {
    for (const fn of this.listeners.get(type) ?? []) fn(new MessageEvent(type, { data: JSON.stringify(data), lastEventId: id ?? '' }));
  }
}

const job = (status: string) => ({ jobId: 'j1', kind: 'curriculum', status, stage: status, eventCursor: 2, attempts: 1, result: null, error: null, resumable: false });
function wrapper(client: QueryClient) {
  return ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => { FakeEventSource.instances = []; });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('useJobStream', () => {
  it('连接任务流，累积进度事件与任务快照，收到 end 后关闭并刷新相关缓存', async () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    const client = new QueryClient();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useJobStream('j1'), { wrapper: wrapper(client) });
    const source = FakeEventSource.instances[0];
    expect(source.url).toBe('/api/verified-learning/v1/jobs/j1/stream');
    act(() => {
      source.emit('progress', { cursor: 1, stage: 'curriculum', message: 'Agent：读取原文', createdAt: '2026-10-27T10:00:00.000Z' }, '1');
      source.emit('progress', { cursor: 2, stage: 'curriculum', message: 'Agent：提交知识点', createdAt: '2026-10-27T10:00:05.000Z' }, '2');
      source.emit('job', job('running'));
    });
    expect(result.current.events.map(e => e.message)).toEqual(['Agent：读取原文', 'Agent：提交知识点']);
    expect(result.current.job?.status).toBe('running');
    // 重连后重复推送同一游标的事件不重复累积
    act(() => source.emit('progress', { cursor: 2, stage: 'curriculum', message: 'Agent：提交知识点' }, '2'));
    expect(result.current.events).toHaveLength(2);
    act(() => { source.emit('job', job('waiting_user')); source.emit('end', {}); });
    expect(source.closed).toBe(true);
    expect(result.current.job?.status).toBe('waiting_user');
    expect(invalidate).toHaveBeenCalled();
  });

  it('浏览器不支持 EventSource 时改为每 2 秒轮询', async () => {
    vi.stubGlobal('EventSource', undefined);
    const fetch = vi.fn(async (url: string) => new Response(JSON.stringify({ data: url.includes('/events') ? [{ cursor: 1, message: '任务已排队' }] : job('running') }), { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    const client = new QueryClient();
    const { result } = renderHook(() => useJobStream('j1'), { wrapper: wrapper(client) });
    await waitFor(() => expect(result.current.job?.status).toBe('running'));
    expect(result.current.events.map(e => e.message)).toEqual(['任务已排队']);
    expect(fetch.mock.calls.some(([url]) => String(url).endsWith('/jobs/j1'))).toBe(true);
  });

  it('jobId 为空时不连接', () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    renderHook(() => useJobStream(null), { wrapper: wrapper(new QueryClient()) });
    expect(FakeEventSource.instances).toHaveLength(0);
  });
});
