import type { ReactNode } from 'react';
import logo from '@/assets/brand/logo-unita.png';
import pattern from '@/assets/brand/pattern-un.png';

export function AuthLayout({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="relative flex min-h-full items-center justify-center overflow-hidden bg-background px-4 py-10">
      <img
        src={pattern}
        alt=""
        aria-hidden
        className="pointer-events-none absolute -bottom-10 left-0 w-[160%] max-w-none opacity-[0.07]"
      />
      <div className="relative w-full max-w-md">
        <img src={logo} alt="Unità Engenharia" className="mx-auto mb-8 h-12" />
        <div className="rounded-card border border-border bg-surface p-8 shadow-card">
          <h1 className="text-xl font-semibold">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-text-muted">{subtitle}</p>}
          <div className="mt-6">{children}</div>
        </div>
        {footer && <div className="mt-6 text-center text-sm text-text-muted">{footer}</div>}
      </div>
    </div>
  );
}
