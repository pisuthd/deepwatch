'use client';

/**
 * Two-mode popover used by `InsightButton` on the Spot and Predict pages.
 *
 * Source of truth: `useInsights()` — local-first, no Tatum / Walrus.
 * Clicking a row in list mode drills down into the full `InsightBodyView`
 * for that saved insight; bodies are stored inline so no fetch is needed.
 *
 * Modes:
 *  - `list`   — sorted list of saved insights, asset-filterable.
 *  - `detail` — the full body for the selected row, with a back arrow.
 */

import { useMemo, useState } from 'react';
import { ArrowLeft, ChevronRight, Loader2, X } from 'lucide-react';
import GlassDropdown from '../../common/GlassDropdown';
import { useInsights } from '../../../stores/insights-store';
import {
  INSIGHT_ASSETS,
  type InsightAsset,
} from '../../../lib/insights';
import InsightBodyView from './InsightBodyView';

const green = '#00E68A';
const red = '#ef4444';
const textPrimary = '#ffffff';
const textSecondary = '#9ca3af';
const FILTER_ALL = '__all__';

interface Props {
  onClose: () => void;
}

function fmtRelative(ts: number): string {
  const diff = Date.now() - ts;
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export default function InsightPopover({ onClose }: Props) {
  const { insights, hydrated } = useInsights();
  const [view, setView] = useState<{ mode: 'list' } | { mode: 'detail'; id: string }>({
    mode: 'list',
  });
  const [filter, setFilter] = useState<string>(FILTER_ALL);

  const filterOptions = useMemo(() => {
    const present = new Set(insights.map((r) => r.body.asset));
    const options: Array<{ value: string; label: string }> = [
      { value: FILTER_ALL, label: 'All assets' },
    ];
    for (const a of INSIGHT_ASSETS) {
      if (present.has(a)) options.push({ value: a, label: a });
    }
    return options;
  }, [insights]);

  const filtered = useMemo(() => {
    if (filter === FILTER_ALL) return insights;
    return insights.filter((r) => r.body.asset === (filter as InsightAsset));
  }, [insights, filter]);

  const detailRow = view.mode === 'detail' ? insights.find((r) => r.id === view.id) : null;

  return (
    <div
      className="absolute bottom-full mb-2 right-0 z-40 w-[720px] max-h-[70vh] overflow-hidden rounded-2xl border border-white/10 flex flex-col"
      style={{
        background: 'rgba(26, 29, 46, 0.95)',
        backdropFilter: 'blur(20px)',
      }}
    >
      <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-white/5 to-transparent pointer-events-none" />
      <div className="absolute top-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-white/20 to-transparent pointer-events-none" />

      {/* Header */}
      <div className="relative z-10 flex items-center justify-between gap-3 px-4 py-3 border-b border-white/5">
        {view.mode === 'list' ? (
          <>
            <div className="flex items-center gap-2 min-w-0">
              <h3 className="text-sm font-semibold" style={{ color: textPrimary }}>
                Insights
              </h3>
              <span
                className="text-[10px] font-mono px-1.5 py-px rounded"
                style={{ background: 'rgba(255,255,255,0.06)', color: textSecondary }}
              >
                {filtered.length}
              </span>
            </div>
            <div className="flex items-center gap-2">
              {insights.length > 0 && (
                <div className="w-36">
                  <GlassDropdown
                    options={filterOptions}
                    value={filter}
                    onChange={setFilter}
                    placeholder="All assets"
                    showValue={false}
                  />
                </div>
              )}
              <button
                onClick={onClose}
                className="w-6 h-6 rounded-md flex items-center justify-center transition-colors hover:bg-white/10"
                style={{ color: textSecondary }}
                aria-label="Close"
              >
                <X size={14} />
              </button>
            </div>
          </>
        ) : (
          <>
            <button
              onClick={() => setView({ mode: 'list' })}
              className="flex items-center gap-1.5 px-2 py-1 rounded-md text-xs transition-colors hover:bg-white/10"
              style={{ color: textSecondary }}
            >
              <ArrowLeft size={12} />
              Back
            </button>
            <div className="flex-1 min-w-0 px-2">
              <h3
                className="text-sm font-semibold truncate text-center"
                style={{ color: textPrimary }}
                title={detailRow?.body.title ?? ''}
              >
                {detailRow?.body.title ?? 'Insight'}
              </h3>
            </div>
            <button
              onClick={onClose}
              className="w-6 h-6 rounded-md flex items-center justify-center transition-colors hover:bg-white/10"
              style={{ color: textSecondary }}
              aria-label="Close"
            >
              <X size={14} />
            </button>
          </>
        )}
      </div>

      {/* Body */}
      <div className="relative z-10 flex-1 overflow-y-auto">
        {!hydrated ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 size={20} className="animate-spin" style={{ color: green }} />
          </div>
        ) : view.mode === 'list' ? (
          insights.length === 0 ? (
            <div className="px-4 py-8 text-center text-xs" style={{ color: textSecondary }}>
              No saved insights yet. Use Add Insight to create one.
            </div>
          ) : filtered.length === 0 ? (
            <div className="px-4 py-8 text-center text-xs" style={{ color: textSecondary }}>
              No insights match this filter.
            </div>
          ) : (
            <div>
              {filtered.map((row) => (
                <button
                  key={row.id}
                  onClick={() => setView({ mode: 'detail', id: row.id })}
                  className="w-full text-left flex items-center gap-3 px-4 py-3 border-t border-white/5 hover:bg-white/[0.03] transition-colors"
                >
                  <span
                    className="px-1.5 py-0.5 rounded text-[10px] font-bold flex-shrink-0"
                    style={{ background: 'rgba(255,255,255,0.06)', color: textPrimary }}
                  >
                    {row.body.asset}
                  </span>
                  <span
                    className="flex-1 min-w-0 text-sm truncate"
                    style={{ color: textPrimary }}
                    title={row.body.title}
                  >
                    {row.body.title}
                  </span>
                  <span className="text-[11px] font-mono flex-shrink-0" style={{ color: textSecondary }}>
                    {fmtRelative(row.createdAt)}
                  </span>
                  <ChevronRight size={14} style={{ color: textSecondary }} className="flex-shrink-0" />
                </button>
              ))}
            </div>
          )
        ) : (
          <div className="px-5 py-4">
            {detailRow ? (
              <InsightBodyView body={detailRow.body} />
            ) : (
              <div className="text-center text-xs py-6" style={{ color: red }}>
                Insight no longer available.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}