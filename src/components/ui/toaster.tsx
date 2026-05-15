'use client';

import * as React from 'react';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';
import { cn } from '@/lib/utils';

export type ToastVariant = 'success' | 'error' | 'info';
export interface ToastItem {
  id: number;
  title: string;
  description?: string;
  variant: ToastVariant;
}

type ToastInput = Omit<ToastItem, 'id'> | { title: string; description?: string; variant?: ToastVariant };

interface ToastContextValue {
  toast: (t: ToastInput) => void;
}

const ToastContext = React.createContext<ToastContextValue | null>(null);

export function useToast() {
  const ctx = React.useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <Toaster />');
  return ctx;
}

const variantIcon: Record<ToastVariant, React.ReactNode> = {
  success: <CheckCircle2 className="h-4 w-4 text-neon-green" />,
  error: <AlertCircle className="h-4 w-4 text-red-400" />,
  info: <Info className="h-4 w-4 text-sky-400" />,
};

const variantClass: Record<ToastVariant, string> = {
  success: 'border-neon-green/30 shadow-neon-green',
  error: 'border-red-500/30',
  info: 'border-sky-500/30',
};

export function Toaster({ children }: { children: React.ReactNode }) {
  const [items, setItems] = React.useState<ToastItem[]>([]);
  const counterRef = React.useRef(0);

  const remove = React.useCallback((id: number) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = React.useCallback<ToastContextValue['toast']>(
    (t) => {
      counterRef.current += 1;
      const id = counterRef.current;
      const item: ToastItem = {
        id,
        title: t.title,
        description: t.description,
        variant: (t.variant as ToastVariant) ?? 'info',
      };
      setItems((prev) => [...prev, item]);
      setTimeout(() => remove(id), 4500);
    },
    [remove],
  );

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[100] flex flex-col items-center gap-2 px-4 sm:bottom-6 sm:right-6 sm:items-end">
        {items.map((t) => (
          <div
            key={t.id}
            className={cn(
              'pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl border bg-background-elevated/95 px-4 py-3 backdrop-blur-xl',
              variantClass[t.variant],
            )}
          >
            <div className="mt-0.5">{variantIcon[t.variant]}</div>
            <div className="flex-1">
              <div className="text-sm font-medium text-white">{t.title}</div>
              {t.description ? <div className="mt-0.5 text-xs text-white/60">{t.description}</div> : null}
            </div>
            <button
              onClick={() => remove(t.id)}
              className="rounded p-1 text-white/40 transition-colors hover:bg-white/10 hover:text-white"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
