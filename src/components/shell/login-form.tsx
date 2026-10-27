'use client';

import { useState } from 'react';
import { api, ApiError } from '@/lib/api/client';
import { useMode } from '@/lib/api/queries';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { BlockError } from '@/components/states/block-states';
import { Seal } from './brand';

/** 登录页：本地模式输入终端口令；线上模式输入访问码 */
export function LoginForm({ onSuccess }: { onSuccess: () => void }) {
  const mode = useMode();
  const online = mode.data?.mode === 'online';
  const [secret, setSecret] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!secret.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api('/access', { method: 'POST', body: { token: secret.trim() } });
      setSecret('');
      onSuccess();
    } catch (e) {
      setError(e instanceof ApiError && e.status === 401
        ? new Error(online ? '访问码不正确。' : '口令不正确，请输入启动服务时终端生成的 VERIFIED_LEARNING_ACCESS_TOKEN。')
        : e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main id="main" className="grid min-h-screen grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] max-lg:grid-cols-1">
      <section className="flex flex-col gap-12 bg-paper px-12 py-10 max-lg:hidden" aria-label="产品介绍">
        <div className="flex items-center gap-2.5 font-serif text-[1.0625rem] font-bold"><Seal />智学伴</div>
        <div className="my-auto max-w-[36rem]">
          <p className="font-serif text-h1 font-bold leading-snug">每句讲解都写明出自原书第几段。</p>
          <p className="mt-4 text-body leading-relaxed text-ink-soft font-serif">
            导入教材、写下学习目标，Agent 读书编课；掌握要用不同的题证明，看过答案的题不算数。
          </p>
          <figure className="mt-8 grid grid-cols-[minmax(0,1fr)_12rem] gap-6 rounded-[var(--radius-paper)] bg-ground p-6">
            <p className="font-serif text-body leading-relaxed">
              程序算出的结果存在内存里，人看不见。<span className="cited">在 Python 里，这个工具就是内置函数 print()。</span>
            </p>
            <figcaption className="text-sm leading-relaxed">
              <span className="font-medium text-zhu">教材 · 第 761 段</span>
              <span className="mt-1 block font-serif text-muted">「在看到后面跟着括号的单词 print 时，解释器就会将括号中的内容打印到屏幕上。」</span>
            </figcaption>
          </figure>
          <dl className="mt-8 grid grid-cols-3 gap-6 text-base">
            <div><dt className="font-medium">读书编课</dt><dd className="mt-1 text-muted">Agent 自己搜索、翻阅原文，逐节验收后才发布课件。</dd></div>
            <div><dt className="font-medium">句句有出处</dt><dd className="mt-1 text-muted">引用必须能在原书里找回，点一下就能翻到那一段。</dd></div>
            <div><dt className="font-medium">掌握要证据</dt><dd className="mt-1 text-muted">至少 3 道不同题，最近 5 题答对 80% 才算掌握。</dd></div>
          </dl>
        </div>
        <p className="text-sm text-muted">{online ? '每个浏览器有独立的学习空间，模型 Key 只保存在你的浏览器里。' : '学习数据保存在这台电脑上。'}</p>
      </section>
      <section className="grid content-center px-6 py-10">
        <form onSubmit={submit} className="mx-auto grid w-full max-w-sm gap-5">
          <div className="flex items-center gap-2.5 font-serif text-[1.0625rem] font-bold lg:hidden"><Seal />智学伴</div>
          <div>
            <h1 className="font-serif text-h2 font-bold">{online ? '输入访问码' : '本机登录'}</h1>
            <p className="mt-1 text-base text-muted">
              {online ? '访问码随评审材料提供。登录后会为这个浏览器建立独立的学习空间。' : '输入启动服务时终端生成的访问口令。'}
            </p>
          </div>
          <Field label={online ? '访问码' : '访问口令'} htmlFor="secret">
            <Input
              id="secret"
              type="password"
              autoComplete="current-password"
              value={secret}
              onChange={event => setSecret(event.target.value)}
              required
              autoFocus
            />
          </Field>
          <BlockError error={error} />
          <Button type="submit" variant="primary" disabled={busy || !secret.trim()}>
            {busy ? '登录中…' : '登录'}
          </Button>
        </form>
      </section>
    </main>
  );
}
