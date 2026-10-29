'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { Toaster } from 'sonner';
import { ApiError } from '@/lib/api/client';
// 注册 X-VL-Model 请求头来源（线上模式）：必须在任何请求之前加载
import '@/lib/stores/model-key';

export default function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 5_000,
        refetchOnWindowFocus: false,
        // 只重试服务端标记为可重试的错误，最多 2 次
        retry: (count, error) => error instanceof ApiError && error.retryable && count < 2,
      },
    },
  }));
  return (
    <QueryClientProvider client={client}>
      {children}
      <Toaster
        position="bottom-right"
        toastOptions={{
          style: {
            background: 'var(--color-ink)',
            color: '#fff',
            border: 'none',
            borderRadius: 'var(--radius-control)',
            fontFamily: 'var(--font-sans)',
          },
        }}
      />
    </QueryClientProvider>
  );
}
