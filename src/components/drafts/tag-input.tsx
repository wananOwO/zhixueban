'use client';

import { useId, useState } from 'react';
import { X } from 'lucide-react';

/** 主题标签：回车或逗号添加，失焦时把输入框里的内容也加上 */
export function TagInput({ label, hint, values, onChange }: { label: string; hint?: string; values: string[]; onChange: (values: string[]) => void }) {
  const id = useId();
  const [text, setText] = useState('');
  const add = () => {
    const value = text.trim().replace(/[，,]$/, '');
    if (value && !values.includes(value)) onChange([...values, value]);
    setText('');
  };
  return (
    <div className="grid gap-1.5">
      <label htmlFor={id} className="text-base font-medium">{label}</label>
      <div className="flex min-h-9 flex-wrap items-center gap-1.5 rounded-[var(--radius-control)] border border-control bg-paper px-2 py-1 focus-within:border-ink focus-within:shadow-[0_0_0_1px_var(--color-ink)]">
        {values.map(value => (
          <span key={value} className="inline-flex items-center gap-1 rounded-[4px] bg-raised px-1.5 py-0.5 text-sm">
            {value}
            <button type="button" onClick={() => onChange(values.filter(v => v !== value))} aria-label={`移除 ${value}`} className="text-muted hover:text-ink">
              <X className="size-3" aria-hidden />
            </button>
          </span>
        ))}
        <input
          id={id}
          value={text}
          onChange={event => setText(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Enter' || event.key === ',' || event.key === '，') { event.preventDefault(); add(); }
            if (event.key === 'Backspace' && !text && values.length) onChange(values.slice(0, -1));
          }}
          onBlur={add}
          placeholder={values.length ? '' : '输入后回车添加'}
          aria-describedby={hint ? `${id}-hint` : undefined}
          className="min-w-28 flex-1 bg-transparent px-1 text-base outline-none placeholder:text-muted/80"
        />
      </div>
      {hint && <p id={`${id}-hint`} className="text-sm text-muted">{hint}</p>}
    </div>
  );
}
