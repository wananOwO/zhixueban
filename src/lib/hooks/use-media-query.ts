'use client';

import { useSyncExternalStore } from 'react';

/** 订阅媒体查询；服务端渲染时视为不匹配 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    onChange => {
      if (typeof window === 'undefined' || !window.matchMedia) return () => {};
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    },
    () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query).matches : false),
    () => false,
  );
}

/** 与 Tailwind md 断点一致：小于 768px 视为手机 */
export const PHONE_QUERY = '(max-width: 767px)';
