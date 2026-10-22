'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { LogOut } from 'lucide-react';
import { api } from '@/lib/verified-learning/client';
import { learningEntries } from '@/lib/navigation';
import AuthGate from './auth-gate';
import ErrorBox from './error-box';

export default function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  async function logout() {
    setBusy(true); setError(null);
    try {
      await api('/access', 'DELETE');
      window.dispatchEvent(new Event('vl:unauthorized'));
    } catch (e) { setError(e); }
    finally { setBusy(false); }
  }
  return (
    <AuthGate>
      <header className="border-b border-border bg-background">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-3 sm:px-6">
          <Link href="/" className="mr-2 font-bold tracking-tight">智学伴</Link>
          <nav aria-label="主导航" className="order-3 flex w-full flex-wrap gap-1 sm:order-none sm:w-auto sm:flex-1">
            {learningEntries.map(({ href, title }) => {
              const active = href === '/' ? pathname === '/' : pathname.startsWith(href);
              return <Link key={href} href={href} aria-current={active ? 'page' : undefined} className={`rounded-md px-3 py-2 text-sm ${active ? 'bg-muted font-semibold text-foreground' : 'text-muted-foreground hover:bg-muted'}`}>{title}</Link>;
            })}
          </nav>
          <button type="button" onClick={() => void logout()} disabled={busy} className="ml-auto flex items-center gap-1 rounded-md px-2 py-2 text-sm text-muted-foreground hover:bg-muted disabled:opacity-50"><LogOut aria-hidden className="h-4 w-4" />退出</button>
        </div>
      </header>
      <div id="main" className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <ErrorBox error={error} />
        {children}
      </div>
    </AuthGate>
  );
}
