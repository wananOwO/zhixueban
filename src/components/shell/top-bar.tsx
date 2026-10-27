'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Dialog as D } from 'radix-ui';
import { LogOut, Menu, X } from 'lucide-react';
import { useState } from 'react';
import { api } from '@/lib/api/client';
import { isActive, navItems } from '@/lib/nav';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Brand } from './brand';
import { ModelKeyStatus } from './model-key-status';

async function logout() {
  try { await api('/access', { method: 'DELETE' }); } finally { window.dispatchEvent(new Event('vl:unauthorized')); }
}

/** 顶栏：标志、五项导航、模型 Key 状态；手机端导航收进全屏菜单 */
export function TopBar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  return (
    <header className="flex h-14 items-center gap-8 px-6 max-md:gap-3 max-md:px-4">
      <Brand />
      <nav aria-label="主导航" className="flex gap-6 font-medium text-muted max-md:hidden">
        {navItems.map(item => (
          <Link
            key={item.href}
            href={item.href}
            aria-current={isActive(pathname, item.href) ? 'page' : undefined}
            className="transition-colors hover:text-ink aria-[current=page]:text-ink"
          >
            {item.label}
          </Link>
        ))}
      </nav>
      <div className="ml-auto flex items-center gap-3 text-muted">
        <span className="max-md:hidden"><ModelKeyStatus /></span>
        <Button variant="ghost" size="sm" className="max-md:hidden" onClick={() => void logout()}>
          <LogOut aria-hidden />
          退出
        </Button>
        <D.Root open={open} onOpenChange={setOpen}>
          <D.Trigger asChild>
            <Button size="icon" className="md:hidden" aria-label="打开菜单"><Menu aria-hidden /></Button>
          </D.Trigger>
          <D.Portal>
            <D.Content className="fixed inset-0 z-50 flex flex-col bg-ground px-4 focus:outline-none">
              <div className="flex h-14 items-center">
                <D.Title asChild><span><Brand /></span></D.Title>
                <D.Description className="sr-only">主导航菜单</D.Description>
                <D.Close asChild>
                  <Button size="icon" className="ml-auto" aria-label="关闭菜单"><X aria-hidden /></Button>
                </D.Close>
              </div>
              <nav aria-label="主导航" className="mt-4 grid">
                {navItems.map(item => (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setOpen(false)}
                    aria-current={isActive(pathname, item.href) ? 'page' : undefined}
                    className={cn('flex h-12 items-center border-b border-line font-serif text-h3 text-ink-soft', 'aria-[current=page]:text-zhu')}
                  >
                    {item.label}
                  </Link>
                ))}
              </nav>
              <div className="mt-6 flex items-center justify-between text-muted">
                <ModelKeyStatus />
                <Button variant="ghost" size="sm" onClick={() => { setOpen(false); void logout(); }}>
                  <LogOut aria-hidden />
                  退出
                </Button>
              </div>
            </D.Content>
          </D.Portal>
        </D.Root>
      </div>
    </header>
  );
}
