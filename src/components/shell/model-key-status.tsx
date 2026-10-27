'use client';

import Link from 'next/link';
import { useMode } from '@/lib/api/queries';

/** 顶栏右侧的模型状态；线上模式的 Key 状态在任务 4 接入浏览器存储 */
export function ModelKeyStatus() {
  const mode = useMode();
  if (mode.data?.mode !== 'online') return null;
  return (
    <Link href="/settings" className="text-sm hover:text-ink">模型 Key：去设置</Link>
  );
}
