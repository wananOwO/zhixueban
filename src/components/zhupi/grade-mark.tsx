import { cn } from '@/lib/utils';

export type GradeKind = 'ok' | 'no' | 'void' | 'pending';
const LABEL: Record<GradeKind, string> = { ok: '答对', no: '答错', void: '答错，不计入', pending: '待作答' };

/**
 * 批改标记：手写感的朱批勾叉。
 * void = 看过完整解析后的作答，灰色、不计入证据；pending = 尚未作答的空圈。
 * animate 时描边落笔（减少动效时直接显示）。
 */
export function GradeMark({ kind, size = 'md', animate = false, className }: { kind: GradeKind; size?: 'sm' | 'md' | 'lg'; animate?: boolean; className?: string }) {
  const px = size === 'sm' ? '0.6875rem' : size === 'lg' ? '1.375rem' : '0.875rem';
  const stroke = kind === 'void' ? 'var(--color-void)' : 'var(--color-zhu)';
  const draw = animate ? 'grade-draw' : undefined;
  return (
    <svg
      viewBox="0 0 24 24"
      role="img"
      aria-label={LABEL[kind]}
      className={cn('shrink-0', className)}
      style={{ width: px, height: px }}
    >
      {kind === 'ok' && (
        <path className={draw} d="M3.5 12.5c2 1.6 3.6 3.4 5 5.6 3-6.2 6.8-10.6 12-14" fill="none" stroke={stroke} strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" />
      )}
      {(kind === 'no' || kind === 'void') && (
        <path className={draw} d="M5 5.5c4.6 3.8 9 8.4 13.6 13.4M18.6 5c-4.8 4-9 8.6-13.2 14" fill="none" stroke={stroke} strokeWidth={2.6} strokeLinecap="round" />
      )}
      {kind === 'pending' && <circle cx="12" cy="12" r="7.5" fill="none" stroke="#a8a7a2" strokeWidth={2} />}
    </svg>
  );
}
