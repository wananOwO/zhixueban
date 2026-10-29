import { forwardRef } from 'react';
import { cn } from '@/lib/utils';

/** 表单控件：白底、1px 线框、6px 圆角；标签在上，说明在下并用 aria-describedby 关联 */
const control =
  'w-full rounded-[var(--radius-control)] border border-control bg-paper px-3 text-base text-ink placeholder:text-muted/80 transition-colors hover:border-control-strong focus-visible:border-ink focus-visible:shadow-[0_0_0_1px_var(--color-ink)] focus-visible:outline-none disabled:bg-raised disabled:text-muted';

export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...props },
  ref,
) {
  return <input ref={ref} className={cn(control, 'h-9', className)} {...props} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea(
  { className, ...props },
  ref,
) {
  return <textarea ref={ref} className={cn(control, 'min-h-20 py-2 leading-relaxed', className)} {...props} />;
});

export const Select = forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(function Select(
  { className, ...props },
  ref,
) {
  return <select ref={ref} className={cn(control, 'h-9 pr-8', className)} {...props} />;
});

export function Field({
  label,
  hint,
  htmlFor,
  required,
  children,
  className,
}: {
  label: string;
  hint?: React.ReactNode;
  htmlFor: string;
  required?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('grid gap-1.5', className)}>
      <label htmlFor={htmlFor} className="text-base font-medium text-ink">
        {label}
        {required && <span className="ml-1 text-zhu" aria-hidden>*</span>}
      </label>
      {children}
      {hint && <p id={`${htmlFor}-hint`} className="text-sm text-muted">{hint}</p>}
    </div>
  );
}
