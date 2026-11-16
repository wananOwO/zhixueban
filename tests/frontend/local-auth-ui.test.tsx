// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TopBar } from '@/components/shell/top-bar';
import { LoginForm } from '@/components/shell/login-form';
import { queryKeys } from '@/lib/api/queries';

vi.mock('next/navigation', () => ({ usePathname: () => '/' }));
const clients: QueryClient[] = [];
function mount(component: React.ReactNode, mode: 'local' | 'online', authRequired: boolean) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(queryKeys.mode(), { mode, authRequired, uploadLimitBytes: 50 * 1024 * 1024, booksPerSpace: null });
  clients.push(client);
  return render(<QueryClientProvider client={client}>{component}</QueryClientProvider>);
}
afterEach(() => { cleanup(); for (const client of clients.splice(0)) client.clear(); vi.unstubAllGlobals(); });

describe('本地免登录界面', () => {
  it('免登录时不显示退出按钮', () => {
    mount(<TopBar />, 'local', false);
    expect(screen.queryByRole('button', { name: '退出' })).toBeNull();
  });

  it.each(['local', 'online'] as const)('%s 密码模式仍能退出', mode => {
    mount(<TopBar />, mode, true);
    expect(screen.getByRole('button', { name: '退出' })).toBeTruthy();
  });

  it('固定密码原样提交，提示从配置文件读取，不再提示随机口令', async () => {
    let submitted: unknown;
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      submitted = JSON.parse(init.body as string);
      return new Response(JSON.stringify({ data: { expiresAt: '2026-11-18T00:00:00Z' } }));
    }));
    mount(<LoginForm onSuccess={() => {}} />, 'local', true);
    fireEvent.change(screen.getByLabelText('本机密码'), { target: { value: ' 固定密码 ' } });
    fireEvent.submit(screen.getByRole('button', { name: '登录' }).closest('form')!);
    await waitFor(() => expect(submitted).toEqual({ token: ' 固定密码 ' }));
    expect(screen.getByText(/\.env\.local/)).toBeTruthy();
    expect(screen.queryByText(/终端生成/)).toBeNull();
  });
});
