import { Slot } from 'radix-ui';
import { cva, type VariantProps } from 'class-variance-authority';
import { forwardRef } from 'react';
import { cn } from '@/lib/utils';

/** 按钮：墨色主按钮、白底次按钮、无框文字按钮、朱批危险按钮；同一行控件同高 */
export const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[var(--radius-control)] font-medium transition-colors disabled:pointer-events-none disabled:opacity-45 [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        primary: 'bg-ink text-white hover:bg-[#3a3836]',
        secondary: 'border border-control bg-paper text-ink hover:border-control-strong',
        ghost: 'text-ink-soft hover:bg-raised hover:text-ink',
        danger: 'border border-zhu/40 bg-paper text-zhu hover:border-zhu hover:bg-zhu-tint',
        zhu: 'bg-zhu text-white hover:bg-zhu-deep',
      },
      size: {
        md: 'h-9 px-4 text-base',
        sm: 'h-8 px-3 text-sm',
        icon: 'size-9',
      },
    },
    defaultVariants: { variant: 'secondary', size: 'md' },
  },
);

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, asChild, type, ...props },
  ref,
) {
  const Component = asChild ? Slot.Root : 'button';
  return (
    <Component
      ref={ref}
      type={asChild ? undefined : (type ?? 'button')}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
});
