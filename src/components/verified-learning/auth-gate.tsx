'use client';

import { useCallback, useEffect, useState } from 'react';
import { KeyRound, Loader2 } from 'lucide-react';
import { api, ApiError } from '@/lib/verified-learning/client';
import ErrorBox from './error-box';

type AuthState = 'checking' | 'login' | 'ready';

/**
 * 登录门禁：进入 /verified-learning 下任何页面前先确认本机登录。
 * 任何请求返回 401 时通过 vl:unauthorized 事件回到登录表单。
 */
export default function AuthGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>('checking');
  const [token, setToken] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api('/access')
      .then(() => !cancelled && setState('ready'))
      .catch(() => !cancelled && setState('login'));
    const onExpire = () => setState('login');
    window.addEventListener('vl:unauthorized', onExpire);
    return () => {
      cancelled = true;
      window.removeEventListener('vl:unauthorized', onExpire);
    };
  }, []);

  const login = useCallback(async (event: React.FormEvent) => {
    event.preventDefault();
    if (!token.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await api('/access', 'POST', { token: token.trim() });
      setToken('');
      setState('ready');
    } catch (e) {
      // 登录接口的 401 表示口令错误，不触发全局登出事件
      if (e instanceof ApiError && e.status === 401) {
        setError(new Error('口令不正确，请输入当前终端生成的 VERIFIED_LEARNING_ACCESS_TOKEN'));
      } else {
        setError(e);
      }
    } finally {
      setSubmitting(false);
    }
  }, [token]);

  if (state === 'checking') {
    return (
      <main id="main" className="flex min-h-screen items-center justify-center">
        <Loader2 aria-hidden className="h-6 w-6 animate-spin text-muted-foreground" />
        <span className="sr-only" role="status">正在确认登录状态</span>
      </main>
    );
  }

  if (state === 'login') {
    return (
      <main id="main" className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6">
        <h1 className="mb-2 flex items-center gap-2 text-2xl font-bold">
          <KeyRound aria-hidden className="h-6 w-6" />
          本机登录
        </h1>
        <p className="mb-6 text-sm text-muted-foreground">
          输入启动服务时在终端生成的访问口令（VERIFIED_LEARNING_ACCESS_TOKEN）。
        </p>
        <form onSubmit={login} className="space-y-4">
          <label className="block">
            <span className="mb-1 block text-sm font-medium">访问口令</span>
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              autoComplete="current-password"
              required
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            />
          </label>
          <ErrorBox error={error} />
          <button
            type="submit"
            disabled={submitting || !token.trim()}
            className="w-full rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {submitting ? '登录中…' : '登录'}
          </button>
        </form>
      </main>
    );
  }

  return <>{children}</>;
}
