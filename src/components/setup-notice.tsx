'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { SettingsSnapshot } from '@/lib/settings';

export default function SetupNotice({ onReady }: { onReady?: (ready: boolean) => void }) {
  const [ready, setReady] = useState<boolean | null>(null);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setReady(null);
    setError(false);
    onReady?.(false);
    void (async () => {
      try {
        const response = await fetch('/api/settings', { signal: controller.signal, cache: 'no-store' });
        if (!response.ok) throw new Error('Settings unavailable');
        const settings: SettingsSnapshot = await response.json();
        const configured = !!(settings.llm_api_key && settings.llm_model &&
          settings.embedding_model && (settings.embedding_api_key || settings.llm_api_key));
        if (controller.signal.aborted) return;
        setReady(configured);
        onReady?.(configured);
      } catch {
        if (!controller.signal.aborted) setError(true);
      }
    })();
    return () => controller.abort();
  }, [retry, onReady]);

  return (
    <aside aria-label="模型配置指引" className="my-6 w-full rounded-md border border-border bg-muted p-4 text-left text-sm">
      {error ? (
        <p role="alert">配置状态加载失败。
          <button type="button" onClick={() => setRetry((n) => n + 1)} className="ml-2 text-accent underline">重试</button>
          <Link href="/settings" className="ml-3 text-accent underline">打开设置</Link>
        </p>
      ) : ready === null ? (
        <p role="status" className="text-muted-foreground">正在检查模型配置…</p>
      ) : (
        <>
          <p className="font-medium">{ready ? '模型配置已填写' : '首次使用：先接入模型，再导入教材'}</p>
          <p className="mt-1 leading-relaxed text-muted-foreground">
            对话模型负责讲解，教材检索模型（Embedding）负责建立索引。两者需分别测试，列表可见不代表都支持教材检索。
          </p>
          <Link href="/settings" className="mt-3 inline-block font-medium text-accent underline">
            {ready ? '前往设置测试连接' : '前往设置，配置两个模型'}
          </Link>
        </>
      )}
    </aside>
  );
}
