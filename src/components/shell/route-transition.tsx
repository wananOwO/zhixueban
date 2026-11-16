'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';

/** 不给子树加 key、不等待退场；动画结束不保留 transform，避免影响固定定位抽屉。 */
export function RouteTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const host = useRef<HTMLDivElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: pathname 是重播动画的触发信号，不参与动画参数计算
  useEffect(() => {
    const element = host.current;
    if (!element?.animate || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const animation = element.animate([
      { opacity: 0.94, transform: 'translateY(4px)' },
      { opacity: 1, transform: 'none' },
    ], { duration: 160, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' });
    return () => animation.cancel();
  }, [pathname]);
  return <div ref={host}>{children}</div>;
}
