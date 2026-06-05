'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Loader2, Sparkles, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
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

export default function Step5Generate(props: Props) {
  const {
    title, asset, includes, hasAnyCard,
    analysis, thinking, generating, generatingError,
    onGenerate, onCancel, onPublish, submitting,
  } = props;

  const [reviewOpen, setReviewOpen] = useState(true);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!generating) return;
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [analysis, thinking, generating]);

  const canPublish = analysis.trim().length > 0 && !submitting && !generating;
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
    <div className="space-y-4">
      {/* ─── Review Accordion ─────────────────────────────────────── */}
      <GlassCard className="overflow-hidden">
        <button
          onClick={() => setReviewOpen(!reviewOpen)}
          className="w-full flex items-center justify-between p-4 hover:bg-white/5 transition-colors"
        >
          <div className="flex items-center gap-3">
            <h2 className="text-base font-semibold" style={{ color: textPrimary }}>
              Review your insight
            </h2>
            <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: 'rgba(0,230,138,0.1)', color: green }}>
              {hasAnyCard ? 'Ready' : 'No data'}
            </span>
          </div>
          <motion.div
            animate={{ rotate: reviewOpen ? 180 : 0 }}
            transition={{ duration: 0.2 }}
          >
            <ChevronDown size={16} style={{ color: textSecondary }} />
          </motion.div>
        </button>

        <AnimatePresence initial={false}>
          {reviewOpen && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.25, ease: 'easeInOut' }}
              className="overflow-hidden"
            >
              <div className="px-4 pb-4">
                <p className="text-xs mb-4" style={{ color: textSecondary }}>
                  Here's a quick summary of what will go into your insight.
                  Jump back to any step to change something.
                </p>
                <div className="space-y-2">
                  <Row label="Title"      value={title || '—'} />
                  <Row label="Asset"      value={asset} />
                  <Row label="Predict"    value={predictLabel} />
                  <Row label="Polymarket" value={polyLabel} />
                  <Row label="Kalshi"     value={kalshiLabel} />
                </div>

                {!hasAnyCard && (
                  <div
                    className="mt-4 rounded-lg p-3 text-xs border"
                    style={{
                      background: 'rgba(234, 179, 8, 0.08)',
                      borderColor: 'rgba(234, 179, 8, 0.3)',
                      color: yellow,
                    }}
                  >
                    No data sources selected. Go back to steps 2-4 to add at
                    least one.
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </GlassCard>

      {/* ─── AI Generation ─────────────────────────────────────── */}
      <GlassCard className="p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-semibold" style={{ color: textPrimary }}>
              AI analysis
            </h2>
            <p className="text-xs mt-1" style={{ color: textSecondary }}>
              Click <b style={{ color: textPrimary }}>Generate</b> to write the analysis.
            </p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
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
            <button
              onClick={onGenerate}
              disabled={generating || !hasAnyCard}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-semibold transition-all"
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
                : 'Generate'}
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
                  <span className="ml-1 font-mono normal-case tracking-normal" style={{ fontSize: 10 }}>
                    ({thinking.length.toLocaleString()} chars)
                  </span>
                )}
                {generating && (
                  <span className="ml-auto inline-block w-1.5 h-3 animate-pulse" style={{ background: textSecondary }} />
                )}
              </summary>
              <div className="mt-2 overflow-auto" style={{ maxHeight: 150 }}>
                {thinking ? (
                  <pre className="text-xs whitespace-pre-wrap font-sans italic m-0" style={{ color: textSecondary }}>
                    {thinking}
                    {generating && (
                      <span className="inline-block w-1 h-3 ml-0.5 align-middle animate-pulse" style={{ background: textSecondary }} />
                    )}
                  </pre>
                ) : (
                  <div className="flex items-center gap-2 text-xs" style={{ color: textSecondary }}>
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
                <pre className="text-sm whitespace-pre-wrap font-sans m-0" style={{ color: textPrimary }}>
                  {analysis}
                  <span className="inline-block w-1.5 h-4 ml-0.5 align-middle animate-pulse" style={{ background: green }} />
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
        Your insight is published to{' '}
        <span style={{ color: textPrimary }}>Walrus</span> via{' '}
        <span style={{ color: textPrimary }}>Tatum</span> storage API.
      </p>
    </div>
  );
}