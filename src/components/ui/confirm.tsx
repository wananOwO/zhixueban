'use client';

import { useState } from 'react';
import { Button } from './button';
import { Dialog, DialogContent, DialogTrigger } from './dialog';

/** 二次确认：替代 window.confirm，说明后果并命名对象 */
export function ConfirmButton({
  title,
  description,
  confirmLabel,
  onConfirm,
  danger,
  children,
  disabled,
  variant = 'secondary',
  size = 'md',
}: {
  title: string;
  description: React.ReactNode;
  confirmLabel: string;
  onConfirm: () => void | Promise<void>;
  danger?: boolean;
  children: React.ReactNode;
  disabled?: boolean;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'md' | 'sm';
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={variant} size={size} disabled={disabled}>{children}</Button>
      </DialogTrigger>
      <DialogContent title={title} description={description}>
        <div className="flex justify-end gap-2">
          <Button onClick={() => setOpen(false)}>取消</Button>
          <Button
            variant={danger ? 'zhu' : 'primary'}
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try { await onConfirm(); setOpen(false); } finally { setBusy(false); }
            }}
          >
            {confirmLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
