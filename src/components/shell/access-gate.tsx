'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { api, ApiError } from '@/lib/api/client';
import { queryKeys } from '@/lib/api/queries';
import { BlockError } from '@/components/states/block-states';
import { LoginForm } from './login-form';

/**
 * 访问门禁：确认已登录再渲染子树。
 * 任何请求返回 401 时（vl:unauthorized 事件）回到登录页。
 */
export function AccessGate({ children }: { children: React.ReactNode }) {
  const client = useQueryClient();
  const access = useQuery({
    queryKey: queryKeys.access(),
    retry: false,
    staleTime: Infinity,
    queryFn: async () => {
      try {
        await api('/access');
        return true;
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) return false;
        throw error;
      }
    },
  });

  useEffect(() => {
    const onExpire = () => {
      client.setQueryData(queryKeys.access(), false);
      // 退出登录后清掉上一个身份的缓存数据
      client.removeQueries({ predicate: query => query.queryKey[0] !== 'access' && query.queryKey[0] !== 'mode' });
    };
    window.addEventListener('vl:unauthorized', onExpire);
    return () => window.removeEventListener('vl:unauthorized', onExpire);
  }, [client]);

  if (access.isPending) {
    return (
      <div role="status" className="grid min-h-screen place-items-center text-muted">
        <span className="sr-only">正在确认登录状态</span>
        <span aria-hidden className="size-2 rounded-full bg-zhu" />
      </div>
    );
  }
  if (access.isError) {
    return (
      <main id="main" className="mx-auto grid min-h-screen max-w-lg content-center px-6">
        <BlockError error={access.error} onRetry={() => void access.refetch()} />
      </main>
    );
  }
  if (!access.data) return <LoginForm onSuccess={() => client.setQueryData(queryKeys.access(), true)} />;
  return <>{children}</>;
}
