import { QueryClient } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { prefetchNavigation } from '@/lib/api/navigation-prefetch';
import { queryKeys } from '@/lib/api/queries';

const clients: QueryClient[] = [];
function client(authenticated = true) {
  const value = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 5_000 } } });
  if (authenticated) value.setQueryData(queryKeys.access(), true);
  clients.push(value);
  return value;
}
afterEach(() => { for (const value of clients.splice(0)) value.clear(); vi.unstubAllGlobals(); });

function respond() {
  const fetch = vi.fn(async (url: string) => new Response(JSON.stringify({ data: [{ id: url }] }), { status: 200 }));
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

describe('导航数据预热', () => {
  it('未登录时不请求，未知目标不请求', async () => {
    const fetch = respond();
    await prefetchNavigation(client(false), '/library');
    await prefetchNavigation(client(), '/unknown');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('教材缓存与页面共用，重复意图和新鲜缓存不重复下载', async () => {
    const fetch = respond();
    const cache = client();
    await Promise.all([prefetchNavigation(cache, '/library'), prefetchNavigation(cache, '/library')]);
    await prefetchNavigation(cache, '/library');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toBe('/api/verified-learning/v1/textbooks?q=&archived=false');
    expect(cache.getQueryData(queryKeys.books())).toEqual([{ id: '/api/verified-learning/v1/textbooks?q=&archived=false' }]);
  });

  it('课程页仅预热课程与标题需要的草稿，不提前拉取所有会话', async () => {
    const fetch = respond();
    const cache = client();
    await prefetchNavigation(cache, '/courses');
    expect(fetch.mock.calls.map(([url]) => url).sort()).toEqual(['/api/verified-learning/v1/courses', '/api/verified-learning/v1/drafts']);
    expect(cache.getQueryData(queryKeys.courses())).toBeDefined();
    expect(cache.getQueryData(queryKeys.drafts())).toBeDefined();
  });

  it('首页仅预热四个只读列表', async () => {
    const fetch = respond();
    await prefetchNavigation(client(), '/');
    expect(fetch.mock.calls.map(([url]) => url).sort()).toEqual([
      '/api/verified-learning/v1/courses', '/api/verified-learning/v1/drafts',
      '/api/verified-learning/v1/jobs', '/api/verified-learning/v1/textbooks?q=&archived=false',
    ]);
  });

  it('设置仅在已知本地模式预热，线上配置不向服务端读取', async () => {
    const fetch = respond();
    const cache = client();
    await prefetchNavigation(cache, '/settings');
    cache.setQueryData(queryKeys.mode(), { mode: 'online' });
    await prefetchNavigation(cache, '/settings');
    expect(fetch).not.toHaveBeenCalled();
    cache.setQueryData(queryKeys.mode(), { mode: 'local' });
    await prefetchNavigation(cache, '/settings');
    expect(fetch.mock.calls.map(([url]) => url)).toEqual(['/api/verified-learning/v1/settings']);
  });

  it('退出取消进行中的预热后，不把旧身份结果写回缓存', async () => {
    let finish!: () => void;
    vi.stubGlobal('fetch', vi.fn((_url: string, options: RequestInit) => new Promise<Response>((resolve, reject) => {
      options.signal?.addEventListener('abort', () => reject(new DOMException('已取消', 'AbortError')));
      finish = () => resolve(new Response(JSON.stringify({ data: ['旧身份教材'] })));
    })));
    const cache = client();
    const pending = prefetchNavigation(cache, '/library');
    cache.setQueryData(queryKeys.access(), false);
    cache.removeQueries({ queryKey: queryKeys.booksAll() });
    finish();
    await pending;
    expect(cache.getQueryData(queryKeys.books())).toBeUndefined();
  });
});
