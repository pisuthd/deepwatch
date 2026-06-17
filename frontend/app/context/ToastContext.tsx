'use client';

/**
 * Toast / notify system.
 *
 * - `ToastProvider` is mounted once near the app root (see `app/providers.tsx`).
 *   It owns the list of active toasts and renders the viewport.
 * - `useToast()` returns a stable `notify` function that any component (or hook)
 *   can call from anywhere in the tree to surface a message.
 *
 * The API is intentionally tiny:
 *
 *   const { notify } = useToast();
 *   notify('Hello', { variant: 'warning', title: 'Heads up' });
 *
 * Toasts auto-dismiss after `duration` ms (default 5000) and can also be
 * dismissed manually via the close button. A `key` de-duplicates — if a toast
 * with the same key is already on screen, the existing one is left alone
 * instead of stacking. Useful for one-shot mount-time warnings that would
 * otherwise spam on every re-render.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import ToastViewport from '../components/common/Toast';

export type ToastVariant = 'info' | 'success' | 'warning' | 'error';

export interface ToastOptions {
  /** Visual variant. Defaults to `'info'`. */
  variant?: ToastVariant;
  /** Bold header line. Optional — omit for a single-line toast. */
  title?: string;
  /** Auto-dismiss after this many ms. Set to `0` to make it sticky. */
  duration?: number;
  /** Optional action chip rendered to the right of the message. */
  action?: { label: string; onClick: () => void };
  /**
   * De-dupe key. If a toast with the same key is already on screen, the
   * existing one is left alone instead of stacking. Useful for one-shot
   * "you're on the wrong network" warnings that re-fire on every mount.
   */
  key?: string;
}

export interface Toast {
  id: string;
  message: string;
  variant: ToastVariant;
  title?: string;
  duration: number;
  action?: ToastOptions['action'];
  key?: string;
}

interface ToastContextValue {
  /** Push a new toast. Returns the toast's id. */
  notify: (message: string, options?: ToastOptions) => string;
  /** Manually close a toast by id. */
  dismiss: (id: string) => void;
  /** Check whether a toast with the given key is currently on screen. */
  hasToast: (key: string) => boolean;
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

let nextToastId = 0;
function generateId(): string {
  // Collision-resistant enough for a single in-memory list.
  nextToastId += 1;
  return `toast-${Date.now().toString(36)}-${nextToastId.toString(36)}`;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  // Mirror the toasts list in a ref so `notify`'s de-dupe check can see the
  // latest entries WITHOUT depending on `toasts` in its closure (which would
  // change identity on every dismiss and re-render the world).
  //
  // The mirror is updated SYNCHRONOUSLY inside `notify` and `dismiss` (not
  // via a `useEffect` watching `toasts`). A `useEffect` mirror is too slow:
  // consecutive `notify()` calls in the same tick — e.g. React 19 StrictMode
  // dev's double-effect-invocation, or a quick re-render that re-fires the
  // caller's effect — would each see a stale empty ref and stack duplicate
  // toasts even though the `key` de-dupe was supposed to catch it.
  const toastsRef = useRef<Toast[]>([]);

  // Track active auto-dismiss timers so we can cancel them on manual dismiss
  // or unmount (avoids setState-after-unmount warnings).
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = useCallback((id: string) => {
    // Sync ref update first so a follow-up notify() with the same key can
    // immediately add a fresh toast instead of being deduped against the
    // just-dismissed entry.
    toastsRef.current = toastsRef.current.filter((t) => t.id !== id);
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
  }, []);

  const notify = useCallback(
    (message: string, options: ToastOptions = {}): string => {
      const { variant = 'info', title, duration = 5000, action, key } = options;
      // De-dupe by key. Re-firing the same warning on every re-render would
      // be spammy; the caller can either pass a stable key OR use `hasToast`
      // to gate the call themselves.
      if (key) {
        const existing = toastsRef.current.find((t) => t.key === key);
        if (existing) return existing.id;
      }
      const id = generateId();
      const toast: Toast = { id, message, variant, title, duration, action, key };
      // Sync ref update — the next notify() in the same tick (StrictMode
      // double-mount, re-render, etc.) will see this toast and return its id
      // without stacking a second copy.
      toastsRef.current = [...toastsRef.current, toast];
      setToasts((prev) => [...prev, toast]);
      if (duration > 0) {
        const timer = setTimeout(() => dismiss(id), duration);
        timersRef.current.set(id, timer);
      }
      return id;
    },
    [dismiss],
  );

  const hasToast = useCallback((key: string) => {
    return toastsRef.current.some((t) => t.key === key);
  }, []);

  // Cleanup all pending timers on unmount.
  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      timers.forEach((t) => clearTimeout(t));
      timers.clear();
    };
  }, []);

  const value = useMemo<ToastContextValue>(
    () => ({ notify, dismiss, hasToast }),
    [notify, dismiss, hasToast],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used within a <ToastProvider>');
  }
  return ctx;
}
