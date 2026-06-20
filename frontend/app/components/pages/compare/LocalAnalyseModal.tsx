'use client';

/**
 * LocalAnalyseModal — variant of `AiAnalyseModal` that persists the
 * completed batch to `localStorage` instead of Walrus.
 *
 * Reuses the entire `useAiBatch()` SSE consumer by passing
 * `{ target: 'local' }` to `prepareBatch`. On completion the provider
 * writes to `lib/local-insights.ts` (instead of calling
 * `uploadBatchInBackground`), mirrors the batch into the in-memory
 * `useBatchIndex`, and auto-flips the global source preference to
 * `'local'` so Compare + Predict start reading local immediately.
 *
 * Why a separate modal?
 *   - The header / Done panel copy needs to explain the localStorage
 *     tradeoff (free, instant, temporary) vs Walrus (paid, durable).
 *   - The Walrus-only `BlockedBanner` reasons (wallet required for
 *     Tatum upload, mainnet disabled for testnet infra) don't apply
 *     here — local storage works on mainnet, no wallet required.
 *   - The "View results" toast action opens this modal, not the Walrus
 *     one, so the user can re-run from the same surface that produced
 *     the result.
 *
 * UX matches `AiAnalyseModal` 1:1 for the review / analysing / error
 * phases; only the header copy, start-button label, and DonePanel copy
 * differ.
 */

import { useEffect, useMemo } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Database,
  Loader2,
  Play,
  RefreshCcw,
  X,
} from 'lucide-react';
import { useAiBatch } from '@/app/stores/ai-batch-store';
import type { DeepBookMatch } from '@/app/lib/match';

const textPrimary = '#ffffff';
const textSecondary = '#9ca3af';
const green = '#00E68A';
const red = '#ef4444';
const amber = '#FFA500';

interface LocalAnalyseModalProps {
  /** Read from `useAiBatch().isModalOpen`. The parent (ComparePageClient)
   * opens/closes this modal directly. */
  open: boolean;
  onClose: () => void;
}

/**
 * Self-contained viewer of `useAiBatch()` state when the active batch's
 * `target === 'local'`. Opens with `prepareBatch(matches, ctx, { target:
 * 'local' })`; closes by `setModalOpen(false)`. Re-runs are handled by
 * re-calling `prepareBatch` from the DonePanel.
 */
export default function LocalAnalyseModal({ open, onClose }: LocalAnalyseModalProps) {
  const {
    state,
    prepareBatch,
    commitBatch,
    abortBatch,
    clearBatch,
  } = useAiBatch();

  const totalCount = state.matches?.length ?? 0;
  const doneCount = useMemo(
    () => Object.keys(state.latestResults).length,
    [state.latestResults],
  );
  const progressPct = totalCount > 0 ? (doneCount / totalCount) * 100 : 0;

  // Only react to the batch lifecycle when this modal is the one
  // currently driving it. The provider exposes a single `state`; we
  // gate rendering on `open` so the Walrus modal isn't affected.
  const phase = state.phase;
  const isReviewing = phase === 'reviewing';
  const isAnalysing = phase === 'analysing';
  const isDone = phase === 'done';
  const isError = phase === 'error';
  const isIdle = phase === 'idle';

  // ESC closes — no abort branching; the batch continues in the
  // background just like the Walrus modal.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Lock body scroll while open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  // When the provider transitions back to idle (e.g. clearBatch), make
  // sure the modal also closes — keeps the two states in sync.
  useEffect(() => {
    if (open && isIdle && !state.matches) onClose();
  }, [open, isIdle, state.matches, onClose]);

  return (
    <AnimatePresence>
      {open && (state.matches || isReviewing) && (
        <motion.div
          key="local-batch-modal"
          className="fixed inset-0 z-50 flex items-center justify-center p-3 md:p-6"
          style={{ background: 'rgba(0,0,0,0.55)' }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          role="presentation"
        >
          <motion.div
            className="relative w-full max-w-2xl max-h-[85vh] overflow-y-auto rounded-2xl border border-white/10"
            style={{
              background: 'rgba(26, 29, 46, 0.96)',
              backdropFilter: 'blur(20px)',
            }}
            initial={{ opacity: 0, y: 20, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.98 }}
            transition={{ duration: 0.15 }}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="AI batch analysis (local)"
          >
            <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-white/5 to-transparent pointer-events-none" />
            <div className="absolute top-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-white/20 to-transparent pointer-events-none" />

            <div className="relative z-10 p-5 space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2
                    className="text-base font-bold flex items-center gap-2"
                    style={{ color: textPrimary }}
                  >
                    <Database size={14} style={{ color: green }} />
                    One-Time Analyse (Local)
                    {isAnalysing && (
                      <span
                        className="text-[10px] uppercase tracking-wider font-semibold"
                        style={{ color: green }}
                      >
                        running in background
                      </span>
                    )}
                  </h2>
                  <div
                    className="text-xs mt-1 font-mono"
                    style={{ color: textSecondary }}
                  >
                    {isIdle
                      ? 'No batch running.'
                      : isReviewing
                        ? `${totalCount} ${totalCount === 1 ? 'market is' : 'markets are'} queued — review the list below, then click Start to begin.`
                        : isDone
                          ? `Saved to local storage — ${doneCount} of ${totalCount} markets analysed.`
                          : isError
                            ? `Failed after ${doneCount} of ${totalCount}.`
                            : `Analysing ${doneCount} of ${totalCount} markets…`}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  className="w-7 h-7 rounded-md flex items-center justify-center shrink-0 transition-colors hover:bg-white/10"
                  style={{ color: textSecondary }}
                  aria-label="Close"
                  title={
                    isReviewing
                      ? 'Close — staged batch will be discarded'
                      : isAnalysing
                        ? 'Close — batch continues in background'
                        : 'Close'
                  }
                >
                  <X size={16} />
                </button>
              </div> 

              {/* Progress bar */}
              {!isIdle && !isReviewing && (
                <div
                  className="h-1 rounded-full overflow-hidden"
                  style={{ background: 'rgba(255,255,255,0.06)' }}
                  title={`${doneCount}/${totalCount} complete`}
                >
                  <motion.div
                    className="h-full"
                    style={{ background: green }}
                    animate={{ width: `${progressPct}%` }}
                    transition={{ duration: 0.2 }}
                  />
                </div>
              )}

              {/* Phase body */}
              {isReviewing && state.matches ? (
                <ReviewPanel
                  matches={state.matches}
                  onStart={commitBatch}
                  onCancel={onClose}
                />
              ) : isDone ? (
                <DonePanel
                  count={doneCount}
                  onReanalyse={() => {
                    if (!state.matches) return;
                    prepareBatch(state.matches, null, { target: 'local' });
                  }}
                  onClose={() => {
                    clearBatch();
                    onClose();
                  }}
                />
              ) : isError ? (
                <ErrorPanel
                  error={state.error}
                  onRetry={() => {
                    if (!state.matches) return;
                    prepareBatch(state.matches, null, { target: 'local' });
                  }}
                  onAbort={abortBatch}
                  onClose={() => {
                    clearBatch();
                    onClose();
                  }}
                />
              ) : isAnalysing ? (
                <AnalysingPanel
                  doneCount={doneCount}
                  totalCount={totalCount}
                  onAbort={abortBatch}
                />
              ) : null}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
 

function ReviewPanel({
  matches,
  onStart,
  onCancel,
}: {
  matches: DeepBookMatch[];
  onStart: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="space-y-3">
      <div
        className="flex items-center justify-between text-[10px] font-mono uppercase tracking-wider"
        style={{ color: textSecondary }}
      >
        <span>Match list</span>
        <span>{`${matches.length} ${matches.length === 1 ? 'market' : 'markets'}`}</span>
      </div>

      <ul className="space-y-1 max-h-[40vh] overflow-y-auto pr-1">
        {matches.map((m, i) => (
          <li
            key={m.key}
            className="flex items-center justify-between gap-3 px-3 py-2 rounded-md"
            style={{ background: 'rgba(255,255,255,0.04)' }}
          >
            <div className="min-w-0 flex items-center gap-2">
              <span
                className="font-mono text-[10px] w-5 text-right shrink-0"
                style={{ color: textSecondary }}
              >
                {i + 1}.
              </span>
              <span
                className="truncate text-[11px]"
                style={{ color: textPrimary }}
                title={m.dbQuestion}
              >
                {m.dbQuestion}
              </span>
            </div>
            <ReadyChip match={m} />
          </li>
        ))}
      </ul>

      <div className="pt-2 flex items-center gap-2">
        <button
          type="button"
          onClick={onStart}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-bold transition-opacity hover:opacity-90"
          style={{
            background: green,
            color: '#000',
          }}
          title="Fire the AI analysis. Results will be saved to localStorage."
        >
          <Play size={13} fill="#000" />
          Start
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="inline-flex items-center px-3 py-2 rounded-md text-xs font-semibold transition-colors hover:bg-white/5"
          style={{ color: textSecondary }}
        >
          Cancel
        </button>
        <span
          className="ml-auto text-[10px] font-mono"
          style={{ color: textSecondary }}
        >
          Closing this modal also cancels.
        </span>
      </div>
    </div>
  );
}

function ReadyChip({ match }: { match: DeepBookMatch }) {
  const venues: string[] = [];
  if (typeof match.dbProb === 'number') venues.push('DB');
  if (typeof match.polyProb === 'number') venues.push('Poly');
  if (typeof match.kalshiProb === 'number') venues.push('Kalshi');
  const color = venues.length >= 2 ? green : red;
  const title = venues.length >= 2
    ? `Quoted on ${venues.length} venues — actionable`
    : `Only ${venues.length} venue${venues.length === 1 ? '' : 's'} — AI will return NEUTRAL`;
  return (
    <span
      className="font-mono font-semibold uppercase tracking-wider shrink-0"
      style={{ color, fontSize: 10 }}
      title={title}
    >
      {venues.length} v
    </span>
  );
}

function AnalysingPanel({
  doneCount,
  totalCount,
  onAbort,
}: {
  doneCount: number;
  totalCount: number;
  onAbort: () => void;
}) {
  const progressPct =
    totalCount > 0 ? Math.min(100, (doneCount / totalCount) * 100) : 0;
  return (
    <div className="space-y-4 py-3">
      <div className="flex flex-col items-center justify-center gap-3 py-4">
        <Loader2 size={32} className="animate-spin" style={{ color: green }} />
        <div className="text-center space-y-1">
          <div
            className="text-sm font-bold"
            style={{ color: textPrimary }}
          >
            {`Analysing ${doneCount} of ${totalCount} ${totalCount === 1 ? 'market' : 'markets'}`}
          </div>
          <div
            className="text-[10px] font-mono uppercase tracking-wider"
            style={{ color: textSecondary }}
          >
            Closing this modal will NOT stop the batch — it runs in the background.
          </div>
        </div>
      </div>

      <div
        className="h-1.5 rounded-full overflow-hidden"
        style={{ background: 'rgba(255,255,255,0.06)' }}
      >
        <motion.div
          className="h-full"
          style={{ background: green }}
          animate={{ width: `${progressPct}%` }}
          transition={{ duration: 0.25 }}
        />
      </div>

      <div className="flex items-center justify-end">
        <button
          type="button"
          onClick={onAbort}
          className="text-[11px] font-mono px-2 py-1 rounded transition-colors hover:bg-white/5"
          style={{ color: textSecondary }}
          title="Stop the batch — partial results are not persisted"
        >
          Abort batch
        </button>
      </div>
    </div>
  );
}

function DonePanel({
  count,
  onReanalyse,
  onClose,
}: {
  count: number;
  onReanalyse: () => void;
  onClose: () => void;
}) {
  return (
    <div className="space-y-3 py-2">
      <div className="flex items-center gap-2" style={{ color: green }}>
        <CheckCircle2 size={16} />
        <span className="text-sm font-semibold">
          Saved to local storage · {count} {count === 1 ? 'analysis' : 'analyses'} cached.
        </span>
      </div>
      <p
        className="text-[11px] leading-relaxed"
        style={{ color: textSecondary }}
      >
        The Source selector flipped to <strong style={{ color: textPrimary }}>Local</strong> —
        Compare and Predict will now read from this batch. Use the
        selector&apos;s overflow menu to switch back to Walrus or clear
        local cache.
      </p>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onReanalyse}
          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors"
          style={{
            background: 'rgba(0, 230, 138, 0.12)',
            border: '1px solid rgba(0, 230, 138, 0.3)',
            color: green,
          }}
          title="Run the batch again from review."
        >
          <RefreshCcw size={12} />
          Run another
        </button>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex items-center px-3 py-1.5 rounded-md text-xs font-semibold transition-colors hover:bg-white/5"
          style={{ color: textSecondary }}
        >
          Close
        </button>
      </div>
    </div>
  );
}

function ErrorPanel({
  error,
  onRetry,
  onAbort,
  onClose,
}: {
  error: string | null;
  onRetry: () => void;
  onAbort: () => void;
  onClose: () => void;
}) {
  return (
    <div className="space-y-3 py-2">
      <div className="text-sm flex items-center gap-2" style={{ color: red }}>
        <AlertTriangle size={14} />
        Failed to generate analysis.
      </div>
      {error && (
        <div
          className="text-[11px] font-mono px-3 py-2 rounded"
          style={{ background: 'rgba(239, 68, 68, 0.08)', color: textSecondary }}
        >
          {error}
        </div>
      )}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors"
          style={{
            background: 'rgba(0, 230, 138, 0.12)',
            border: '1px solid rgba(0, 230, 138, 0.3)',
            color: green,
          }}
        >
          <RefreshCcw size={12} />
          Retry
        </button>
        <button
          type="button"
          onClick={onAbort}
          className="inline-flex items-center px-3 py-1.5 rounded-md text-xs font-semibold transition-colors hover:bg-white/5"
          style={{ color: textSecondary }}
        >
          Abort
        </button>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex items-center px-3 py-1.5 rounded-md text-xs font-semibold transition-colors hover:bg-white/5"
          style={{ color: textSecondary }}
        >
          Close
        </button>
      </div>
    </div>
  );
}