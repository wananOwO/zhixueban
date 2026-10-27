'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useMode } from '@/lib/api/queries';
import { useModelKey } from '@/lib/stores/model-key';

/** 顶栏右侧：线上模式显示浏览器里是否已保存模型 Key */
export function ModelKeyStatus() {
  const mode = useMode();
  const config = useModelKey(state => state.config);
  // localStorage 只在浏览器可读：挂载后再显示，避免服务端渲染与浏览器不一致
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (mode.data?.mode !== 'online' || !mounted) return null;
  return (
    <Link href="/settings" className="flex items-center gap-1.5 text-sm hover:text-ink">
      <span aria-hidden className={config ? 'size-1.5 rounded-full bg-ink' : 'size-1.5 rounded-full bg-zhu'} />
      {config ? '模型 Key 已保存在本浏览器' : '未填写模型 Key'}
    </Link>
  );
}
