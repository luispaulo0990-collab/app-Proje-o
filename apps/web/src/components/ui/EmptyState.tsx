import type { ReactNode } from 'react';
import symbol from '@/assets/brand/symbol-un-orange.png';

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-14 text-center">
      <img src={symbol} alt="" className="h-8 opacity-30" />
      <h3 className="text-base font-semibold">{title}</h3>
      {description && <p className="max-w-md text-sm text-text-muted">{description}</p>}
      {action}
    </div>
  );
}
