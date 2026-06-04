'use client';

import { useEffect, useRef } from 'react';
import {  Loader2, Sparkles, X } from 'lucide-react';
import GlassCard from '../../common/GlassCard';
import MarkdownRenderer from '../../common/MarkdownRenderer';
import {
  formatTimeUntil,
  type InsightBody,
} from '../../../lib/insights';

const green = '#00E68A';
const red = '#ef4444';
const textPrimary = '#ffffff';
const textSecondary = '#9ca3af';
const yellow = '#eab308';

interface Props {
  title: string;
  asset: string;
  includes: InsightBody['includes'];
  hasAnyCard: boolean;
  analysis: string;
  thinking: string;
  generating: boolean;
  generatingError: string | null;
  onGenerate: () => void;
  onCancel: () => void;
  onPublish: () => void;
  submitting: boolean;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-3">
      <span
        className="text-[10px] uppercase tracking-wide w-24 flex-shrink-0"
        style={{ color: textSecondary }}
      >
        {label}
      </span>
      <span className="text-sm font-mono break-all" style={{ color: textPrimary }}>
        {value}
      </span>
    </div>
  );
}

/**
 * Step 5 — review the collected data, generate the analysis with
 * MiniMax, and publish to Walrus.
 *
 * Three sections stacked vertically with generous spacing:
 *  1. Read-only summary of what the user collected.
 *  2. AI generation controls + the streaming analysis pane.
 *  3. Big Publish button.
 *
 * Streaming behaviour in the analysis pane:
 *  - While `generating` is true and no token has landed yet, we show
 *    a "Thinking…" indicator with a spinner.
 *  - Once tokens start streaming in, we show them as raw text (NOT
 *    parsed) so partial markdown like "# Title" doesn't get rendered
 *    as a giant H1 by the MarkdownRenderer. A blinking caret at the
 *    end of the text shows the stream is live.
 *  - When `generating` flips to false, we hand off to the
 *    MarkdownRenderer for the final, fully-formatted view.
 */
export default function Step5Generate(props: Props) {
  const {
    title, asset, includes, hasAnyCard,
    analysis, thinking, generating, generatingError,
    onGenerate, onCancel, onPublish, submitting,
  } = props;

  // Keep the streaming pane pinned to the bottom so newly-arrived tokens
  // stay visible — without this, the user sees nothing move because the
  // text grows below the fold of the maxHeight: 560 scroller. `thinking`
  // is in the deps because the reasoning region above can grow during
  // the same stream and would otherwise push the analysis caret down.
  const scrollRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!generating) return;
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [analysis, thinking, generating]);

  const canPublish = analysis.trim().length > 0 && !submitting;
  const predictLabel = includes.predict
    ? `${formatTimeUntil(includes.predict.expiryMs)} · spot $${includes.predict.spot.toFixed(0)}`
    : '—';
  const polyLabel = includes.polymarket
    ? `${includes.polymarket.markets.length} market${includes.polymarket.markets.length === 1 ? '' : 's'}`
    : '—';
  const kalshiLabel = includes.kalshi
    ? `${includes.kalshi.tickers.length} ticker${includes.kalshi.tickers.length === 1 ? '' : 's'}`
    : '—';

  return (
    <div className="space-y-6">
      {/* ─── Review card ──────────────────────────────────────────── */}
      <GlassCard className="p-8">
        <h2 className="text-lg font-semibold" style={{ color: textPrimary }}>
          Review your insight
        </h2>
        <p className="text-sm mt-1" style={{ color: textSecondary }}>
          Here's a quick summary of what will go into your insight.
          Jump back to any step to change something.
        </p>
        <div className="mt-6 space-y-3">
          <Row label="Title"      value={title || '—'} />
          <Row label="Asset"      value={asset} />
          <Row label="Predict"    value={predictLabel} />
          <Row label="Polymarket" value={polyLabel} />
          <Row label="Kalshi"     value={kalshiLabel} />

          {!hasAnyCard && (
            <div
              className="mt-6 rounded-lg p-3 text-xs border"
              style={{
                background: 'rgba(234, 179, 8, 0.08)',
                borderColor: 'rgba(234, 179, 8, 0.3)',
                color: yellow,
              }}
            >
              No data sources are selected. Go back to steps 2-4 to add at
              least one, otherwise the AI will have very little to write about.
            </div>
          )}
        </div>
      </GlassCard>

      {/* ─── AI generation ───────────────────────────────────────── */}
      <GlassCard className="p-8">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-semibold" style={{ color: textPrimary }}>
              AI analysis
            </h2>
            <p className="text-sm mt-1" style={{ color: textSecondary }}>
              Click <b style={{ color: textPrimary }}>Generate</b> and
              our AI reads the data you've collected and writes a
              structured analysis for you. It thinks out loud while it
              works — you can watch it reason in real time.
            </p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {generating && (
              <button
                onClick={onCancel}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium"
                style={{
                  background: 'rgba(255,255,255,0.04)',
                  color: textPrimary,
                  border: '1px solid rgba(255,255,255,0.08)',
                }}
              >
                <X size={12} /> Cancel
              </button>
            )}
            <button
              onClick={onGenerate}
              disabled={generating || !hasAnyCard}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold transition-all"
              style={{
                background: generating || !hasAnyCard ? 'rgba(255,255,255,0.08)' : green,
                color: generating || !hasAnyCard ? textSecondary : '#000',
                cursor: generating || !hasAnyCard ? 'not-allowed' : 'pointer',
              }}
            >
              {generating
                ? 'Generating…'
                : analysis.trim().length > 0
                ? 'Re-generate'
                : 'Generate Insight with AI'}
            </button>
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
          className="mt-6 rounded-lg overflow-auto"
          style={{
            background: 'rgba(255, 255, 255, 0.04)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            minHeight: 240,
            maxHeight: 560,
          }}
        >
          {/* ── Reasoning region (collapsible) ─────────────────────
              Shown only when there's something to show: either the
              model has emitted chain-of-thought tokens, or it's
              still in the thinking phase. `open={generating}` keeps
              it expanded while the stream is live and collapsed once
              the user is reviewing the final prose.
              The inner `maxHeight: 200` is load-bearing: it caps a
              long chain-of-thought so it can never push the analysis
              caret below the outer pane's fold. */}
          {(thinking || generating) && (
            <details
              open={generating}
              className="px-5 py-4"
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
              <div
                className="mt-2 overflow-auto"
                style={{ maxHeight: 200 }}
              >
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

          {/* ── Analysis region ──────────────────────────────────
              Only renders the streaming pre (or the final markdown
              after generation completes). The "Thinking…" indicator
              lives exclusively in the reasoning region above — we
              intentionally render `null` here while `analysis` is
              empty, even when `generating` is true, so we don't show
              a duplicate spinner. */}
          <div className="px-5 py-4">
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
            ) : (
              <p className="text-sm" style={{ color: textSecondary }}>
                {hasAnyCard
                  ? 'Click Generate to write the analysis.'
                  : 'Add at least one data source first.'}
              </p>
            )}
          </div>
        </div>
      </GlassCard>

      {/* ─── Publish ─────────────────────────────────────────────── */}
      <button
        onClick={onPublish}
        disabled={!canPublish}
        className="w-full py-3 rounded-lg font-bold text-sm transition-all flex items-center justify-center gap-2"
        style={{
          background: canPublish ? green : 'rgba(255, 255, 255, 0.08)',
          color: canPublish ? '#000' : textSecondary,
          cursor: canPublish ? 'pointer' : 'not-allowed',
        }}
      >
        {submitting && <Loader2 size={14} className="animate-spin" />}
        {submitting ? 'Publishing…' : 'Publish to Walrus'}
      </button>

      <p className="text-xs leading-relaxed" style={{ color: textSecondary }}>
        Your insight is published to a public, on-chain storage network (
        <span style={{ color: textPrimary }}>Walrus</span>) via the{' '}
        <span style={{ color: textPrimary }}>Tatum</span> storage API.
        The full text is permanently readable by anyone with the link.
      </p>
    </div>
  );
}
