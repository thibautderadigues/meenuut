import { useEffect } from 'react';

export interface ToastData {
  id: number;
  message: string;
  action?: { label: string; run: () => void };
}

const TOAST_DURATION_MS = 6000;

interface ToastProps {
  toast: ToastData | null;
  onDismiss: () => void;
}

/** Un seul toast à la fois : un nouveau remplace le précédent. */
export function Toast({ toast, onDismiss }: ToastProps) {
  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(onDismiss, TOAST_DURATION_MS);
    return () => window.clearTimeout(timeout);
  }, [toast, onDismiss]);

  return (
    <div
      role="status"
      data-print-hidden
      className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center px-4"
    >
      {toast && (
        <div
          key={toast.id}
          className="pointer-events-auto flex max-w-full animate-toast-in items-center gap-2 rounded-lg bg-ink py-1.5 pr-1.5 pl-4 text-sm text-canvas shadow-popover"
        >
          <span className="truncate">{toast.message}</span>
          {toast.action && (
            <button
              type="button"
              onClick={() => {
                toast.action?.run();
                onDismiss();
              }}
              className="shrink-0 rounded-md px-2.5 py-1 font-medium transition-colors duration-100 hover:bg-canvas/15 focus-visible:outline-2 focus-visible:outline-canvas"
            >
              {toast.action.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
