'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Menu, X } from 'lucide-react';

const links = [
  { href: '/', label: '首页' },
  { href: '/textbooks', label: '教材' },
  { href: '/courses', label: '我的课程' },
  { href: '/stats', label: '学习画像' },
  { href: '/settings', label: '设置' },
];

export default function AppNav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  useEffect(() => setOpen(false), [pathname]);

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-background">
      <div className="mx-auto flex min-h-16 max-w-6xl flex-wrap items-center justify-between gap-x-6 px-4 sm:px-6"
        onKeyDown={(event) => {
          if (event.key === 'Escape' && open) {
            setOpen(false);
            toggle.current?.focus();
          }
        }}>
        <Link href="/" className="py-4 text-lg font-semibold tracking-tight">智学伴</Link>
        <button ref={toggle} type="button" aria-label={open ? '收起导航' : '展开导航'}
          aria-expanded={open} aria-controls="app-navigation"
          onClick={() => setOpen(!open)} className="rounded-md p-3 hover:bg-muted md:hidden">
          {open ? <X aria-hidden className="h-5 w-5" /> : <Menu aria-hidden className="h-5 w-5" />}
        </button>
        <nav id="app-navigation" aria-label="主导航"
          className={`${open ? 'flex' : 'hidden'} w-full flex-col gap-1 pb-3 md:flex md:w-auto md:flex-row md:py-0`}>
          {links.map(({ href, label }) => {
            const active = href === '/' ? pathname === '/' :
              pathname === href || pathname.startsWith(`${href}/`) ||
              (href === '/courses' && pathname.startsWith('/learn/'));
            return (
              <Link key={href} href={href} aria-current={active ? 'page' : undefined}
                onClick={(event) => { if (!event.defaultPrevented) setOpen(false); }}
                className={`rounded-md px-4 py-3 text-sm transition-colors ${active ? 'bg-accent/10 font-medium text-accent' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}>
                {label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
