'use client';

/**
 * AISummaryCard — the AI cross-venue comparison summary.
 *
 * Replaces the old Step 2 + Step 3 from the 3-step wizard. On the
 * single-screen Add Insight page this card sits below the compare
 * panel. Collapsed by default (a single centered Generate button);
 * expands to show the streaming reasoning + analysis panes once the
 * user clicks Generate, and exposes a Save button at the bottom of
 * the expanded card. After a successful save the button swaps for a
 * "Saved" chip plus a reset link so the user can run a new summary
 * without changing market.
 *
 * The page-level `AddInsightPage` owns the streaming state
 * (thinking + analysis buffers, RAF flush loop, AbortController) and
 * the localStorage save call. This component only renders the UI and
 * invokes the callbacks.
 */

import { useEffect, useRef } from 'react';
import { Check, Loader2, RefreshCw, Save, Sparkles, X } from 'lucide-react';
import GlassCard from '../../common/GlassCard';
import MarkdownRenderer from '../../common/MarkdownRenderer';

const green = '#00E68A';
const red = '#ef4444';
const textPrimary = '#ffffff';
const textSecondary = '#9ca3af';

interface Props {
  /** Title used in the prompt (auto-generated from selected oracle). */
  title: string;
  /** Asset symbol (BTC / SUI / WAL). */
  asset: string;
  /** Whether a market is selected (required for generation + save). */
  hasContext: boolean;
  /** Latest streamed analysis text. */
  analysis: string;
  /** Latest streamed reasoning text. */
  thinking: string;
  /** Whether the stream is open. */
  generating: boolean;
  /** Latest error message, or null. */
  generatingError: string | null;
  /** Whether a save is in flight. */
  saving: boolean;
  /** Insight id once a save has succeeded; null otherwise. */
  savedId: string | null;
  /** Bytes of the saved insight — surfaced in the "Saved" chip. */
  savedBytes?: number;
  /** Resets the card back to the idle state (clears analysis). */
  onGenerateAgain: () => void;
  onGenerate: () => void;
  onCancel: () => void;
  onSave: () => void;
}

function StatusChip({
  saved,
  generating,
  hasAnalysis,
}: {
  saved: boolean;
  generating: boolean;
  hasAnalysis: boolean;
}) {
  if (saved) {
    return (
      <span
        className="text-xs px-2 py-0.5 rounded-full inline-flex items-center gap-1"
        style={{ background: 'rgba(0,230,138,0.12)', color: green }}
      >
        <Check size={10} /> Saved
      </span>
    );
  }
  if (generating) {
    return (
      <span
        className="text-xs px-2 py-0.5 rounded-full inline-flex items-center gap-1"
        style={{ background: 'rgba(156,163,175,0.12)', color: textSecondary }}
      >
        <Loader2 size={10} className="animate-spin" /> Streaming
      </span>
    );
  }
  if (hasAnalysis) {
    return (
      <span
        className="text-xs px-2 py-0.5 rounded-full"
        style={{ background: 'rgba(0,230,138,0.1)', color: green }}
      >
        Ready
      </span>
    );
  }
  return (
    <span
      className="text-xs px-2 py-0.5 rounded-full"
      style={{ background: 'rgba(156,163,175,0.12)', color: textSecondary }}
    >
      Idle
    </span>
  );
}

export default function AISummaryCard(props: Props) {
  const {
    title,
    hasContext,
    analysis,
    thinking,
    generating,
    generatingError,
    saving,
    savedId,
    savedBytes,
    onGenerateAgain,
    onGenerate,
    onCancel,
    onSave,
  } = props;

  const scrollRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!generating) return;
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [analysis, thinking, generating]);

  const trimmedAnalysis = analysis.trim();
  const hasAnalysis = trimmedAnalysis.length > 0;
  const saved = savedId !== null;

  // Idle state — nothing has been generated yet. Show only a centered
  // Generate button. Keep it visually inviting so the AI summary reads
  // as an optional power-up rather than a required step.
  if (!generating && !hasAnalysis && !saved) {
    return (
      <GlassCard className="p-8">
        <div className="flex items-start gap-3 mb-5">
          <div
            className="flex items-center justify-center w-9 h-9 rounded-full flex-shrink-0"
            style={{ background: 'rgba(0,230,138,0.1)', color: green }}
          >
            <Sparkles size={16} />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-semibold" style={{ color: textPrimary }}>
              AI summary
            </h2>
            <p className="text-xs mt-1" style={{ color: textSecondary }}>
              Optional. One-click comparison of live Polymarket, Kalshi, and
              DeepBook Predict odds for the selected market. Streams as it writes.
            </p>
          </div>
          <StatusChip saved={false} generating={false} hasAnalysis={false} />
        </div>

        <button
          onClick={onGenerate}
          disabled={!hasContext}
          className="w-full py-4 rounded-xl text-sm font-bold transition-all flex items-center justify-center gap-2"
          style={{
            background: hasContext ? green : 'rgba(255,255,255,0.08)',
            color: hasContext ? '#000' : textSecondary,
            cursor: hasContext ? 'pointer' : 'not-allowed',
          }}
        >
          <Sparkles size={16} />
          {hasContext ? 'Generate AI summary' : 'Pick a market above first'}
        </button>
      </GlassCard>
    );
  }

  // Expanded state — streaming, generated, or saved.
  return (
    <GlassCard className="p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3 flex-1 min-w-0">
          <div
            className="flex items-center justify-center w-9 h-9 rounded-full flex-shrink-0"
            style={{ background: 'rgba(0,230,138,0.1)', color: green }}
          >
            <Sparkles size={16} />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-semibold" style={{ color: textPrimary }}>
              AI summary
            </h2>
            <p
              className="text-xs mt-1 truncate"
              style={{ color: textSecondary }}
              title={title || undefined}
            >
              {title || '—'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <StatusChip saved={saved} generating={generating} hasAnalysis={hasAnalysis} />
          {generating && (
            <button
              onClick={onCancel}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium"
              style={{
                background: 'rgba(255,255,255,0.04)',
                color: textPrimary,
                border: '1px solid rgba(255,255,255,0.08)',
              }}
            >
              <X size={12} /> Cancel
            </button>
          )}
          {!generating && hasAnalysis && !saved && (
            <button
              onClick={onGenerate}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium"
              style={{
                background: 'rgba(255,255,255,0.04)',
                color: textPrimary,
                border: '1px solid rgba(255,255,255,0.08)',
              }}
            >
              <RefreshCw size={12} /> Re-generate
            </button>
          )}
        </div>
      </div>

      {generatingError && (
        <div
          className="mt-4 rounded-lg p-3 text-sm"
          style={{ background: 'rgba(239, 68, 68, 0.1)', color: red }}
        >
          {generatingError}
        </div>
      )}

      <div
        ref={scrollRef}
        className="mt-4 rounded-lg overflow-auto"
        style={{
          background: 'rgba(255, 255, 255, 0.04)',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          minHeight: 200,
          maxHeight: 400,
        }}
      >
        {(thinking || generating) && (
          <details
            open={generating}
            className="px-4 py-3"
            style={{
              borderBottom: analysis || thinking
                ? '1px solid rgba(255, 255, 255, 0.06)'
                : 'none',
            }}
          >
            <summary
              className="flex items-center gap-2 cursor-pointer select-none"
              style={{ color: textSecondary, listStyle: 'none' }}
            >
              <Sparkles size={12} />
              <span className="text-[10px] uppercase tracking-wide font-semibold">
                Reasoning
              </span>
              {thinking && (
                <span
                  className="ml-1 font-mono normal-case tracking-normal"
                  style={{ fontSize: 10 }}
                >
                  ({thinking.length.toLocaleString()} chars)
                </span>
              )}
              {generating && (
                <span
                  className="ml-auto inline-block w-1.5 h-3 animate-pulse"
                  style={{ background: textSecondary }}
                />
              )}
            </summary>
            <div className="mt-2 overflow-auto" style={{ maxHeight: 150 }}>
              {thinking ? (
                <pre
                  className="text-xs whitespace-pre-wrap font-sans italic m-0"
                  style={{ color: textSecondary }}
                >
                  {thinking}
                  {generating && (
                    <span
                      className="inline-block w-1 h-3 ml-0.5 align-middle animate-pulse"
                      style={{ background: textSecondary }}
                    />
                  )}
                </pre>
              ) : (
                <div
                  className="flex items-center gap-2 text-xs"
                  style={{ color: textSecondary }}
                >
                  <Loader2 size={12} className="animate-spin" />
                  Thinking&hellip;
                </div>
              )}
            </div>
          </details>
        )}

        <div className="px-4 py-3">
          {generating ? (
            analysis ? (
              <pre
                className="text-sm whitespace-pre-wrap font-sans m-0"
                style={{ color: textPrimary }}
              >
                {analysis}
                <span
                  className="inline-block w-1.5 h-4 ml-0.5 align-middle animate-pulse"
                  style={{ background: green }}
                />
              </pre>
            ) : null
          ) : analysis ? (
            <MarkdownRenderer content={analysis} />
          ) : null}
        </div>
      </div>

      {/* ─── Footer: Save / Saved ──────────────────────────────── */}
      <div className="mt-4 flex items-center justify-between gap-3">
        <p className="text-[11px] leading-relaxed" style={{ color: textSecondary }}>
          Stored on this device (<code className="font-mono">localStorage</code>).
          Nothing is uploaded.
        </p>

        {saved ? (
          <div className="flex items-center gap-3 flex-shrink-0">
            <span
              className="text-xs px-3 py-1.5 rounded-full inline-flex items-center gap-1.5 font-semibold"
              style={{ background: 'rgba(0,230,138,0.12)', color: green }}
            >
              <Check size={12} />
              Saved{savedBytes !== undefined ? ` · ${savedBytes.toLocaleString()} B` : ''}
            </span>
            <button
              onClick={onGenerateAgain}
              className="text-xs font-medium underline underline-offset-2"
              style={{ color: textSecondary }}
            >
              Generate another
            </button>
          </div>
        ) : (
          <button
            onClick={onSave}
            disabled={!hasAnalysis || generating || saving}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-bold transition-all flex-shrink-0"
            style={{
              background:
                hasAnalysis && !generating && !saving ? green : 'rgba(255,255,255,0.08)',
              color: hasAnalysis && !generating && !saving ? '#000' : textSecondary,
              cursor: hasAnalysis && !generating && !saving ? 'pointer' : 'not-allowed',
            }}
          >
            {saving ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Save size={14} />
            )}
            {saving ? 'Saving…' : 'Save insight'}
          </button>
        )}
      </div>
    </GlassCard>
  );
}
