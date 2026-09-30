import type { ReactNode } from 'react';
import { cn } from '@/utils/cn';
import type { Tone } from './Badge';

const tones: Record<Exclude<Tone, 'neutral' | 'primary'>, string> = {
  success: 'border-success/30 bg-success-soft text-success',
  warning: 'border-warning/30 bg-warning-soft text-warning',
  error: 'border-error/30 bg-error-soft text-error',
  info: 'border-info/30 bg-info-soft text-info',
};

export function Alert({
  tone = 'info',
  title,
  children,
  className,
}: {
  tone?: keyof typeof tones;
  title?: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cn('rounded-control border px-4 py-3 text-sm', tones[tone], className)}
    >
      {title && <p className="font-semibold">{title}</p>}
      {children && <div className={cn(title && 'mt-1', 'text-ink-700')}>{children}</div>}
    </div>
  );
}
