'use client';

import MarkdownRenderer from '../../common/MarkdownRenderer';
import { type InsightBody } from '../../../lib/insights';
import { PredictSummary, PolymarketSummary, KalshiSummary } from './IncludesSummary';

const textPrimary = '#ffffff';
const textSecondary = '#9ca3af';

interface Props {
  body: InsightBody;
}

/**
 * Shared renderer for one published insight body. Used by both the
 * popover detail view and the Recent Insights page detail panel so the
 * two surfaces stay in sync.
 *
 * Order: title → meta chips → markdown analysis → structured sources.
 * The wrapping surface (close button, navigation chrome) is the caller's
 * responsibility; this component renders only the body.
 */
export default function InsightBodyView({ body }: Props) {
  const includes = body.includes ?? {};
  const hasSources = !!(includes.predict || includes.polymarket || includes.kalshi);

  return (
    <div className="space-y-4">
      {/* Title */}
      <div>
        <h2 className="text-base font-semibold" style={{ color: textPrimary }}>
          {body.title}
        </h2>
        <div className="flex items-center gap-2 flex-wrap mt-1.5 text-[11px]">
          <span
            className="px-1.5 py-0.5 rounded font-bold text-[10px]"
            style={{ background: 'rgba(255,255,255,0.06)', color: textPrimary }}
          >
            {body.asset}
          </span>
          <span style={{ color: textSecondary }}>
            {new Date(body.timestamp).toLocaleString()}
          </span>
          {body.tag && (
            <span
              className="px-1.5 py-0.5 rounded font-mono"
              style={{ background: 'rgba(255,255,255,0.06)', color: textSecondary }}
            >
              tag: {body.tag}
            </span>
          )}
          {body.source && (
            <span
              className="px-1.5 py-0.5 rounded font-mono"
              style={{ background: 'rgba(255,255,255,0.06)', color: textSecondary }}
            >
              source: {body.source}
            </span>
          )}
        </div>
      </div>

      {/* Analysis */}
      <div>
        <MarkdownRenderer content={body.analysis} />
      </div>

      {/* Sources */}
      {hasSources && (
        <div className="space-y-3">
          <div
            className="text-[10px] uppercase tracking-wide font-semibold pt-2"
            style={{ color: textSecondary, borderTop: '1px solid rgba(255,255,255,0.06)' }}
          >
            Sources
          </div>
          {includes.predict && <PredictSummary data={includes.predict} />}
          {includes.polymarket && <PolymarketSummary data={includes.polymarket} />}
          {includes.kalshi && <KalshiSummary data={includes.kalshi} />}
        </div>
      )}
    </div>
  );
}
