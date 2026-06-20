'use client';

/**
 * AiAnalyseModal — thin viewer of `useAiBatch()` state + the Start / Cancel
 * affordances for the review-then-start flow.
 *
 * The previous design (Part 2) owned the SSE consumer and AbortController
 * locally, so closing the modal mid-stream aborted the batch. The Part-3
 * design moved that lifecycle to `AiBatchProvider`. The Part-4 design
 * adds a `reviewing` phase between the user clicking "Analyse" and the
 * SSE consumer firing, so the user gets to see the match list + macro
 * context BEFORE burning AI credits.
 *
 * Branches:
 *   - **Reviewing** — provider state is `phase === 'reviewing'`. Shows
 *     the match list with per-row "Ready" chips, a macro context card
 *     (if available), and a primary "Start analysis" button. The user
 *     can review the list and either Start or Cancel. This is the
 *     "review and preview then can start" flow from the original brief.
 *   - **Background running** — `phase === 'analysing'`, modal was
 *     reopened mid-stream. Shows the current progress + a note that
 *     closing the modal will NOT stop the batch.
 *   - **Done** — `phase === 'done'`. Shows the DonePanel and a
 *     "Re-analyse" button (re-runs the same batch from the review
 *     state, so the user can review the list again first).
 *   - **Error** — upstream failure. Shows the ErrorPanel with Retry.
 *   - **Idle** — fallback. Normally the modal only opens with a batch
 *     staged (reviewing/analysing) or finished (done/error); this is
 *     reachable only if the user clicks the dock pill after
 *     `clearBatch` while the modal flag is still true.
 *
 * The Close button is now a single `setModalOpen(false)` — no abort
 * branching. Closing the modal in `reviewing` also drops the staged
 * batch (the provider's `setModalOpen(false)` handler clears the
 * reviewing state).
 */

import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Loader2,
  Play,
  RefreshCcw,
  Sparkles,
  Wallet,
  X,
} from 'lucide-react';
import { useAiBatch } from '@/app/stores/ai-batch-store';
import { useNetwork } from '@/app/context/NetworkContext';
import { useWallet } from '@/app/hooks/useWallet';
import type { CmcContext } from '@/app/lib/match-analyses';
import type { DeepBookMatch } from '@/app/lib/match';

const textPrimary = '#ffffff';
const textSecondary = '#9ca3af';
const green = '#00E68A';
const red = '#ef4444';

export default function AiAnalyseModal() {
  const {
    state,
    isModalOpen,
    setModalOpen,
    prepareBatch,
    commitBatch,
    abortBatch,
    clearBatch,
  } = useAiBatch();
  const { network } = useNetwork();
  const { isConnected } = useWallet();

  // AI batch analysis is gated on two runtime conditions:
  //   1. Network — mainnet is disabled because the testnet Tatum
  //      Walrus aggregator + the testnet Seal key server are the only
  //      ones wired up; running on mainnet would either fail to upload
  //      or burn real credits against a service we don't control.
  //   2. Wallet — the Walrus upload is owner-scoped at the API-key
  //      layer and the Seal-encrypted slice needs a sender for the
  //      `seal_approve` simulation. Without a wallet there is nothing
  //      to attach the upload to, so we block before any token spend.
  //
  // The reason is rendered as an inline banner above the action row
  // so the user sees why the Start button is disabled instead of
  // wondering whether the click failed silently.
  const startBlockedReason: string | null = useMemo(() => {
    if (!isConnected) {
      return 'Connect a wallet to start the AI batch.';
    }
    if (network === 'mainnet') {
      return 'AI batch analysis is disabled on mainnet — switch to testnet to run an analysis.';
    }
    return null;
  }, [isConnected, network]);
  const canStart = startBlockedReason === null;

  const totalCount = state.matches?.length ?? 0;
  const doneCount = useMemo(
    () => Object.keys(state.latestResults).length,
    [state.latestResults],
  );
  const progressPct = totalCount > 0 ? (doneCount / totalCount) * 100 : 0;

  // ESC closes — no abort branching; the batch continues in the
  // background. In `reviewing` the provider's setModalOpen handler also
  // drops the staged batch.
  useEffect(() => {
    if (!isModalOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setModalOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isModalOpen, setModalOpen]);

  // Lock body scroll while open.
  useEffect(() => {
    if (!isModalOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [isModalOpen]);

  const phase = state.phase;
  const isReviewing = phase === 'reviewing';
  const isAnalysing = phase === 'analysing';
  const isDone = phase === 'done';
  const isError = phase === 'error';
  const isIdle = phase === 'idle';

  return (
    <AnimatePresence>
      {isModalOpen && (state.matches || isReviewing) && (
        <motion.div
          key="ai-batch-modal"
          className="fixed inset-0 z-50 flex items-center justify-center p-3 md:p-6"
          style={{ background: 'rgba(0,0,0,0.55)' }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={() => setModalOpen(false)}
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
            aria-label="AI batch analysis"
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
                    AI analysis
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
                        ? `${totalCount} ${totalCount === 1 ? 'market is' : 'markets are'} queued for analysis — review the list below, then click Start analysis to begin.`
                        : isDone
                          ? `Done — ${doneCount} of ${totalCount} markets analysed.`
                          : isError
                            ? `Failed after ${doneCount} of ${totalCount}.`
                            : `Analysing ${doneCount} of ${totalCount} markets…`}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
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

              {/* Progress bar — only when there's an active batch in flight */}
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
                  cmcContext={
                    // Reuse the latest macro snapshot the provider cached
                    // — it's not on state, so we have to surface it
                    // from the result of the first prepared row, or
                    // omit. The provider keeps cmcContextRef up to date;
                    // the modal doesn't have direct access. The provider
                    // also doesn't expose it, so we render the macro
                    // card only if we already have a finished analysis
                    // to pull it from. For the first batch, we just
                    // show the match list without a macro card.
                    null
                  }
                  canStart={canStart}
                  startBlockedReason={startBlockedReason}
                  onStart={commitBatch}
                  onCancel={() => {
                    setModalOpen(false);
                  }}
                />
              ) : isDone ? (
                <DonePanel
                  count={doneCount}
                  canStart={canStart}
                  startBlockedReason={startBlockedReason}
                  onReanalyse={() => {
                    if (!state.matches) return;
                    // Re-stage from review, so the user sees the match
                    // list again before committing.
                    prepareBatch(state.matches, null);
                  }}
                  onClose={() => {
                    clearBatch();
                    setModalOpen(false);
                  }}
                />
              ) : isError ? (
                <ErrorPanel
                  error={state.error}
                  canStart={canStart}
                  startBlockedReason={startBlockedReason}
                  onRetry={() => {
                    if (!state.matches) return;
                    prepareBatch(state.matches, null);
                  }}
                  onAbort={abortBatch}
                  onClose={() => {
                    clearBatch();
                    setModalOpen(false);
                  }}
                />
              ) : isAnalysing ? (
                // Per user direction (Part 4): "when processing we should
                // hide" the per-market list — they don't want to see
                // 20 individual rows ticking through. A compact progress
                // card is enough while the SSE stream is running; the
                // full match list + per-row chips live in the
                // `ReviewPanel` (before Start) and the `DonePanel` (after
                // completion).
                <AnalysingPanel
                  doneCount={doneCount}
                  totalCount={totalCount}
                  toolStarted={state.toolStarted}
                  onAbort={abortBatch}
                />
              ) : (
                <IdlePanel onClose={() => setModalOpen(false)} />
              )}

              {/* Collapsible thinking / text (hidden during reviewing). */}
              {!isReviewing &&
                (state.thinkingBuf.length > 0 || state.textBuf.length > 0) && (
                  <ReasoningPanel
                    thinkingBuf={state.thinkingBuf}
                    textBuf={state.textBuf}
                  />
                )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ─── Sub-panels ─────────────────────────────────────────────────────────────

function ReviewPanel({
  matches,
  cmcContext,
  canStart,
  startBlockedReason,
  onStart,
  onCancel,
}: {
  matches: DeepBookMatch[];
  cmcContext: CmcContext | null;
  canStart: boolean;
  startBlockedReason: string | null;
  onStart: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="space-y-3">
      {cmcContext && (
        <MacroContextCard cmcContext={cmcContext} />
      )}

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

      {startBlockedReason && (
        <BlockedBanner reason={startBlockedReason} />
      )}

      <div className="pt-2 flex items-center gap-2">
        <button
          type="button"
          onClick={onStart}
          disabled={!canStart}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-bold transition-opacity hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:opacity-40"
          style={{
            background: green,
            color: '#000',
          }}
          title={
            canStart
              ? 'Fire the AI analysis. This is when tokens start getting spent.'
              : startBlockedReason ?? 'Cannot start analysis.'
          }
        >
          <Play size={13} fill="#000" />
          Start analysis
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

/**
 * Inline banner shown above the action row when the AI batch cannot be
 * started — either because no wallet is connected (the upload needs a
 * sender) or because the user is on mainnet (testnet-only infra).
 *
 * The Start / Re-analyse / Retry buttons are also `disabled` while
 * this is visible; the banner explains WHY so the disabled state is
 * not ambiguous.
 */
function BlockedBanner({ reason }: { reason: string }) {
  const isWallet = reason.toLowerCase().startsWith('connect a wallet');
  return (
    <div
      className="flex items-start gap-2 rounded-md px-3 py-2 text-[11px]"
      style={{
        background: 'rgba(245, 158, 11, 0.08)',
        border: '1px solid rgba(245, 158, 11, 0.25)',
        color: '#fbbf24',
      }}
      role="status"
      aria-live="polite"
    >
      <span className="shrink-0 mt-px">
        {isWallet ? <Wallet size={12} /> : <AlertTriangle size={12} />}
      </span>
      <span className="leading-relaxed">{reason}</span>
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

function MacroContextCard({ cmcContext }: { cmcContext: CmcContext }) {
  const fg =
    cmcContext.fearGreedValue !== null
      ? `${cmcContext.fearGreedValue}${cmcContext.fearGreedLabel ? ` (${cmcContext.fearGreedLabel})` : ''}`
      : 'n/a';
  const sectorBits: string[] = [];
  if (cmcContext.defi24hChange !== null) sectorBits.push(`DeFi ${fmtPct(cmcContext.defi24hChange)}`);
  if (cmcContext.stablecoin24hChange !== null)
    sectorBits.push(`Stables ${fmtPct(cmcContext.stablecoin24hChange)}`);
  if (cmcContext.derivatives24hChange !== null)
    sectorBits.push(`Derivs ${fmtPct(cmcContext.derivatives24hChange)}`);
  return (
    <div
      className="rounded-lg p-3 space-y-1.5"
      style={{
        background: 'rgba(0, 230, 138, 0.06)',
        border: '1px solid rgba(0, 230, 138, 0.18)',
      }}
    >
      <div
        className="text-[10px] font-mono uppercase tracking-wider"
        style={{ color: green }}
      >
        Macro context
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] font-mono">
        <span style={{ color: textPrimary }}>Fear &amp; Greed: {fg}</span>
        {sectorBits.map((b) => (
          <span key={b} style={{ color: textSecondary }}>{b}</span>
        ))}
      </div>
    </div>
  );
}

function fmtPct(n: number): string {
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
}

function IdlePanel({ onClose }: { onClose: () => void }) {
  return (
    <div className="space-y-3 py-2 text-sm" style={{ color: textSecondary }}>
      <p>No batch running. Click &ldquo;Analyse&rdquo; on any row of the Compare table to start one.</p>
      <button
        type="button"
        onClick={onClose}
        className="inline-flex items-center px-3 py-1.5 rounded-md text-xs font-semibold transition-colors hover:bg-white/5"
        style={{ color: textSecondary }}
      >
        Close
      </button>
    </div>
  );
}

/**
 * Compact "batch in flight" indicator. The full per-market list lives in
 * the `ReviewPanel` (before Start) and the `DonePanel` (after completion)
 * — during processing the user just wants to see "how many done" tick
 * up, not 20 rows of green ticks. Per user direction (Part 4):
 * "when processing we should hide" the per-market list.
 */
function AnalysingPanel({
  doneCount,
  totalCount,
  toolStarted,
  onAbort,
}: {
  doneCount: number;
  totalCount: number;
  toolStarted: number;
  onAbort: () => void;
}) {
  const progressPct =
    totalCount > 0 ? Math.min(100, (doneCount / totalCount) * 100) : 0;
  return (
    <div className="space-y-4 py-3">
      <div className="flex flex-col items-center justify-center gap-3 py-4">
        <Loader2
          size={32}
          className="animate-spin"
          style={{ color: green }}
        />
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
            {progressPct < 100
              ? 'Closing this modal will NOT stop the batch — it runs in the background.'
              : 'Finalising…'}
          </div>
        </div>
      </div>

      <div
        className="h-1.5 rounded-full overflow-hidden"
        style={{ background: 'rgba(255,255,255,0.06)' }}
        title={`${doneCount}/${totalCount} complete`}
      >
        <motion.div
          className="h-full"
          style={{ background: green }}
          animate={{ width: `${progressPct}%` }}
          transition={{ duration: 0.25 }}
        />
      </div>

      <div className="flex items-center justify-between">
        <span
          className="text-[10px] font-mono"
          style={{ color: textSecondary }}
        >
          {`${doneCount} / ${totalCount} results · ${toolStarted} tool call${toolStarted === 1 ? '' : 's'}`}
        </span>
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
  canStart,
  startBlockedReason,
  onReanalyse,
  onClose,
}: {
  count: number;
  canStart: boolean;
  startBlockedReason: string | null;
  onReanalyse: () => void;
  onClose: () => void;
}) {
  return (
    <div className="space-y-3 py-2">
      <div className="flex items-center gap-2" style={{ color: green }}>
        <CheckCircle2 size={16} />
        <span className="text-sm font-semibold">
          Saved ✓ — {count} {count === 1 ? 'analysis' : 'analyses'} written.
        </span>
      </div>
      {startBlockedReason && (
        <BlockedBanner reason={startBlockedReason} />
      )}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onReanalyse}
          disabled={!canStart}
          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          style={{
            background: 'rgba(0, 230, 138, 0.12)',
            border: '1px solid rgba(0, 230, 138, 0.3)',
            color: green,
          }}
          title={
            canStart
              ? 'Re-run the batch from review.'
              : startBlockedReason ?? 'Cannot re-analyse.'
          }
        >
          <RefreshCcw size={12} />
          Re-analyse
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
  canStart,
  startBlockedReason,
  onRetry,
  onAbort,
  onClose,
}: {
  error: string | null;
  canStart: boolean;
  startBlockedReason: string | null;
  onRetry: () => void;
  onAbort: () => void;
  onClose: () => void;
}) {
  return (
    <div className="space-y-3 py-2">
      <div className="text-sm" style={{ color: red }}>
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
      {startBlockedReason && (
        <BlockedBanner reason={startBlockedReason} />
      )}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onRetry}
          disabled={!canStart}
          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          style={{
            background: 'rgba(0, 230, 138, 0.12)',
            border: '1px solid rgba(0, 230, 138, 0.3)',
            color: green,
          }}
          title={
            canStart
              ? 'Re-prepare the batch and start a fresh run.'
              : startBlockedReason ?? 'Cannot retry.'
          }
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

function ReasoningPanel({
  thinkingBuf,
  textBuf,
}: {
  thinkingBuf: string;
  textBuf: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div
      className="rounded-lg overflow-hidden"
      style={{
        border: '1px solid rgba(255,255,255,0.08)',
        background: 'rgba(0,0,0,0.2)',
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left"
        style={{ color: textSecondary, fontSize: 11 }}
      >
        <span className="uppercase tracking-wider font-semibold">
          Model reasoning
          {thinkingBuf.length > 0
            ? ` (thinking ${thinkingBuf.length} chars)`
            : ''}
          {textBuf.length > 0 ? ` (text ${textBuf.length} chars)` : ''}
        </span>
        <ChevronDown
          size={12}
          style={{
            transition: 'transform 0.15s',
            transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
          }}
        />
      </button>
      {open && (
        <div
          className="px-3 pb-3 pt-1 space-y-2"
          style={{ fontSize: 11, color: textSecondary }}
        >
          {thinkingBuf.length > 0 && (
            <pre
              className="whitespace-pre-wrap font-mono"
              style={{ color: green, opacity: 0.7 }}
            >
              {thinkingBuf}
            </pre>
          )}
          {textBuf.length > 0 && (
            <pre className="whitespace-pre-wrap font-sans">{textBuf}</pre>
          )}
        </div>
      )}
    </div>
  );
}
