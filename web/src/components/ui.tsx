import clsx from 'clsx';
import { X } from 'lucide-react';
import { useEffect, type ReactNode, type ButtonHTMLAttributes } from 'react';
import { createPortal } from 'react-dom';

export function Button({ variant = 'ghost', size = 'sm', className, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'outline' | 'danger'; size?: 'xs' | 'sm' | 'md' }) {
  return (
    <button
      {...p}
      className={clsx(
        'inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none whitespace-nowrap',
        size === 'xs' && 'h-7 px-2 text-xs', size === 'sm' && 'h-8 px-3 text-sm', size === 'md' && 'h-10 px-4 text-sm',
        variant === 'primary' && 'bg-ink text-bg hover:opacity-90',
        variant === 'ghost' && 'text-ink-2 hover:bg-surface-2 hover:text-ink',
        variant === 'outline' && 'border border-line text-ink-2 hover:bg-surface-2 hover:text-ink',
        variant === 'danger' && 'text-bad hover:bg-surface-2',
        className,
      )}
    />
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={clsx('rounded-2xl border border-line bg-surface', className)}>{children}</div>;
}

export function Badge({ tone = 'neutral', children, className }: { tone?: 'neutral' | 'good' | 'bad' | 'warn' | 'accent'; children: ReactNode; className?: string }) {
  return (
    <span className={clsx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium',
      tone === 'neutral' && 'bg-surface-2 text-ink-2', tone === 'good' && 'bg-good/10 text-good', tone === 'bad' && 'bg-bad/10 text-bad',
      tone === 'warn' && 'bg-warn/10 text-warn', tone === 'accent' && 'bg-accent-soft text-accent', className)}>{children}</span>
  );
}

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title?: ReactNode; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-[2px] p-4 fade-up" onClick={onClose}>
      <div className={clsx('max-h-[92vh] w-full overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl flex flex-col', wide ? 'max-w-[1400px]' : 'max-w-2xl')} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <div className="text-sm font-semibold">{title}</div>
          <Button size="xs" onClick={onClose} aria-label="Close"><X size={16} /></Button>
        </div>
        <div className="overflow-auto p-5">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

export function Drawer({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode }) {
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 bg-black/30" onClick={onClose}>
      <div className="absolute right-0 top-0 h-full w-full max-w-xl overflow-auto border-l border-line bg-surface shadow-2xl fade-up" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 flex items-center justify-between border-b border-line bg-surface px-5 py-3">
          <div className="text-sm font-semibold">{title}</div>
          <Button size="xs" onClick={onClose}><X size={16} /></Button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

export function Empty({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      {icon && <div className="mb-3 text-ink-3">{icon}</div>}
      <div className="text-sm font-medium">{title}</div>
      {children && <div className="mt-1 max-w-md text-sm text-ink-3">{children}</div>}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-[26px] font-bold leading-tight text-ink">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-ink-3">{subtitle}</p>}
      </div>
      {actions && <div className="flex gap-2">{actions}</div>}
    </div>
  );
}
