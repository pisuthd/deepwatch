'use client';

/**
 * ToastViewport — renders the visible toast stack.
 *
 * Fixed-positioned at the top-right of the viewport. The container is
 * pointer-events-none so it doesn't block clicks on the page underneath;
 * individual toasts re-enable pointer events on themselves for the close
 * button + optional action chip.
 *
 * Each toast has a coloured left border that signals its variant, an icon
 * (emoji-free to stay in line with the rest of the app), and a slide-in
 * animation via CSS @keyframes defined inline in globals.css (see the
 * `toast-slide-in` rule). A CSS module would be overkill for one rule.
 */

import type { Toast as ToastModel, ToastVariant } from '../../context/ToastContext';

interface ToastViewportProps {
  toasts: ToastModel[];
  onDismiss: (id: string) => void;
}

const VARIANT_STYLES: Record<
  ToastVariant,
  { border: string; accent: string; icon: string; iconBg: string; label: string }
> = {
  info: {
    border: 'border-l-[var(--color-accent-secondary)]',
    accent: 'text-[var(--color-accent-secondary)]',
    iconBg: 'rgba(59, 130, 246, 0.15)',
    icon: 'i',
    label: 'Info',
  },
  success: {
    border: 'border-l-[var(--color-accent-primary)]',
    accent: 'text-[var(--color-accent-primary)]',
    iconBg: 'rgba(0, 230, 138, 0.15)',
    icon: '✓',
    label: 'Success',
  },
  warning: {
    border: 'border-l-[#F59E0B]',
    accent: 'text-[#F59E0B]',
    iconBg: 'rgba(245, 158, 11, 0.15)',
    icon: '!',
    label: 'Warning',
  },
  error: {
    border: 'border-l-[#EF4444]',
    accent: 'text-[#EF4444]',
    iconBg: 'rgba(239, 68, 68, 0.15)',
    icon: '×',
    label: 'Error',
  },
};

export default function ToastViewport({ toasts, onDismiss }: ToastViewportProps) {
  if (!toasts.length) return null;
  return (
    <div
      aria-live="polite"
      aria-atomic="false"
      className="fixed top-4 right-4 z-50 flex flex-col gap-3 w-[360px] max-w-[calc(100vw-2rem)] pointer-events-none"
    >
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

function ToastItem({ toast, onDismiss }: { toast: ToastModel; onDismiss: (id: string) => void }) {
  const v = VARIANT_STYLES[toast.variant];
  return (
    <div
      role="status"
      className={`pointer-events-auto relative overflow-hidden rounded-xl border border-white/10 ${v.border} border-l-2 shadow-2xl toast-slide-in`}
      style={{ background: 'rgba(22, 25, 34, 0.95)', backdropFilter: 'blur(20px)' }}
    >
      <div className="absolute inset-0 rounded-xl bg-gradient-to-br from-white/5 to-transparent pointer-events-none" />
      <div className="relative z-10 flex items-start gap-3 p-4">
        <div
          className={`shrink-0 w-7 h-7 rounded-full grid place-items-center text-sm font-bold ${v.accent}`}
          style={{ background: v.iconBg }}
          aria-hidden
        >
          {v.icon}
        </div>
        <div className="flex-1 min-w-0">
          {toast.title && (
            <p className={`text-sm font-semibold ${v.accent} mb-0.5`}>{toast.title}</p>
          )}
          <p className="text-sm text-[var(--color-text-primary)] leading-snug break-words">
            {toast.message}
          </p>
          {toast.action && (
            <button
              type="button"
              onClick={() => {
                toast.action!.onClick();
                onDismiss(toast.id);
              }}
              className={`mt-2 text-sm font-medium ${v.accent} hover:opacity-80 transition-opacity`}
            >
              {toast.action.label} →
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={() => onDismiss(toast.id)}
          aria-label="Dismiss notification"
          className="shrink-0 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors w-6 h-6 grid place-items-center rounded-md hover:bg-white/5"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
            <path
              d="M2 2L10 10M10 2L2 10"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}
