'use client';

import { useEffect } from 'react';
import { useToastStore, type Toast } from '@/lib/stores/toast.store';
import { cn } from '@/lib/utils';

/** Renders **bold** segments in ember, matching the prototype's `.toast strong`. */
function renderMessage(message: string) {
  const parts = message.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) =>
    part.startsWith('**') && part.endsWith('**') ? (
      <strong key={i} className="text-ember">
        {part.slice(2, -2)}
      </strong>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
}

function ToastItem({ toast }: { toast: Toast }) {
  const dismiss = useToastStore((s) => s.dismiss);
  useEffect(() => {
    const timer = setTimeout(() => dismiss(toast.id), toast.duration);
    return () => clearTimeout(timer);
  }, [toast.id, toast.duration, dismiss]);

  return (
    <div
      role="status"
      className={cn(
        'bg-ink pointer-events-auto whitespace-nowrap rounded-full px-[26px] py-[14px]',
        'text-paper text-sm font-semibold shadow-[0_18px_44px_rgba(24,16,16,.28)]',
        'animate-[toast-in_.4s_var(--e-out)]',
      )}
    >
      {renderMessage(toast.message)}
    </div>
  );
}

/** Bottom-centre toast stack. Mount once per surface (in the shell layouts). */
export function Toaster() {
  const toasts = useToastStore((s) => s.toasts);
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed bottom-[30px] left-1/2 z-[3000] flex -translate-x-1/2 flex-col items-center gap-2"
    >
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} />
      ))}
      <style>{`@keyframes toast-in{from{opacity:0;transform:translateY(calc(100% + 20px))}to{opacity:1;transform:translateY(0)}}`}</style>
    </div>
  );
}
