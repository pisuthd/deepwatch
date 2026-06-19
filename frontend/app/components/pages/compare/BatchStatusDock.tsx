'use client';

/**
 * BatchStatusDock — fixed bottom-right pill that surfaces the AI batch
 * state when the modal is closed. Solves the "I accidentally closed the
 * modal and now I don't know what's happening" problem from Part 2.
 *
 * Visibility rules:
 *   - `phase === 'analysing' && !isModalOpen` → "Analysing X of N…" with
 *     spinner, tap to reopen the modal.
 *   - `phase === 'done' && !isModalOpen && within 10 s of completion` →
 *     "✓ Batch complete — tap to review", tap to reopen.
 *   - Otherwise → hidden.
 *
 * Mounted at the provider layer (in `app/providers.tsx`) so it survives
 * any route navigation — the user sees the dock on the Predict page,
 * Overview page, etc. while a batch is in flight on the Compare page.
 */

import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { CheckCircle2, Loader2, X } from 'lucide-react';
import { useAiBatch } from '@/app/stores/ai-batch-store';

const cyan = '#3EC4C0';
const green = '#00E68A';
const textPrimary = '#ffffff';
const textSecondary = '#9ca3af';

const DONE_DISMISS_MS = 10_000;

export default function BatchStatusDock() {
  const { state, isModalOpen, setModalOpen, clearBatch } = useAiBatch();
  const [doneVisibleUntil, setDoneVisibleUntil] = useState<number | null>(null);

  // When phase transitions to 'done' and the modal is closed, show the
  // dock for DONE_DISMISS_MS, then hide. We track the dismiss target
  // in state and let a separate effect schedule the auto-hide timer.
  // The sync `setDoneVisibleUntil` calls below are React-19-flagged
  // ("set-state-in-effect") but are the natural shape for a "set
  // state from props" transition — they fire once per phase change,
  // not on every render, so the cascading-render concern doesn't apply.
  useEffect(() => {
    if (state.phase === 'done' && state.finishedAt && !isModalOpen) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDoneVisibleUntil(state.finishedAt + DONE_DISMISS_MS);
    } else if (state.phase !== 'done') {
      setDoneVisibleUntil(null);
    }
  }, [state.phase, state.finishedAt, isModalOpen]);

  // Auto-hide the "done" pill after the dismiss window.
  useEffect(() => {
    if (doneVisibleUntil == null) return;
    const remaining = doneVisibleUntil - Date.now();
    if (remaining <= 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDoneVisibleUntil(null);
      return;
    }
    const id = window.setTimeout(() => setDoneVisibleUntil(null), remaining);
    return () => window.clearTimeout(id);
  }, [doneVisibleUntil]);

  // Compute visibility.
  const isAnalysing = state.phase === 'analysing' && !isModalOpen;
  const isDone =
    state.phase === 'done' && !isModalOpen && doneVisibleUntil != null;
  const visible = isAnalysing || isDone;

  const totalCount = state.matches?.length ?? 0;
  const doneCount = Object.keys(state.latestResults).length;

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key="batch-status-dock"
          className="fixed bottom-4 right-4 z-40"
          initial={{ opacity: 0, y: 12, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 12, scale: 0.95 }}
          transition={{ duration: 0.18 }}
        >
          <div
            className="flex items-center gap-2.5 pl-3 pr-2 py-2 rounded-full border"
            style={{
              background: 'rgba(26, 29, 46, 0.95)',
              backdropFilter: 'blur(12px)',
              WebkitBackdropFilter: 'blur(12px)',
              borderColor: isDone ? 'rgba(0, 230, 138, 0.3)' : 'rgba(62, 196, 192, 0.3)',
              boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
            }}
          >
            {isAnalysing ? (
              <Loader2
                size={14}
                className="animate-spin shrink-0"
                style={{ color: cyan }}
              />
            ) : (
              <CheckCircle2
                size={14}
                className="shrink-0"
                style={{ color: green }}
              />
            )}
            <button
              type="button"
              onClick={() => setModalOpen(true)}
              className="text-[11px] font-mono font-semibold whitespace-nowrap"
              style={{ color: textPrimary }}
              title={isAnalysing ? 'View batch progress' : 'Review batch results'}
            >
              {isAnalysing
                ? `Analysing ${doneCount} of ${totalCount}…`
                : `Batch complete — ${doneCount} of ${totalCount}`}
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                clearBatch();
              }}
              className="w-5 h-5 rounded-full flex items-center justify-center transition-colors hover:bg-white/10"
              style={{ color: textSecondary }}
              aria-label="Dismiss"
              title="Dismiss"
            >
              <X size={11} />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
