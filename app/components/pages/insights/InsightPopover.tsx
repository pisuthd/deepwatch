'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ChevronRight, Loader2, X } from 'lucide-react';
import GlassDropdown from '../../common/GlassDropdown';
import { useToast } from '../../../context/ToastContext';
import {
  INSIGHT_ASSETS,
  parseInsightFilename,
  type InsightAsset,
  type InsightBody,
  type InsightRow,
} from '../../../lib/insights';
import {
  fetchInsightBlob,
  listWalrusUploads,
  type WalrusStorageJobStatusResponse,
} from '../../../lib/tatum';
import InsightBodyView from './InsightBodyView';

const green = '#00E68A';
const red = '#ef4444';
const textPrimary = '#ffffff';
const textSecondary = '#9ca3af';
const TATUM_API_KEY = process.env.NEXT_PUBLIC_TATUM_API_KEY ?? '';
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

function jobToRow(job: WalrusStorageJobStatusResponse): InsightRow | null {
  const parsed = parseInsightFilename(job.filename);
  if (!parsed) return null;
  return {
    asset: parsed.asset,
    jobId: job.jobId,
    status: job.status,
    filename: job.filename,
    sizeBytes: job.sizeBytes,
    timestamp: parsed.timestamp,
    errorMessage: job.errorMessage,
    blobId: job.blobId,
    suiObjectId: job.suiObjectId,
    downloadUrl: job.downloadUrlByQuiltId ?? job.downloadUrlByQuiltPatchId,
  };
}

/**
 * Two-mode popover used by `InsightButton` on the Spot and Predict pages.
 *
 * Modes:
 *  - `list`   — sorted, asset-filterable list of CERTIFIED insights.
 *               Clicking a row warms the body cache and drills down.
 *  - `detail` — the full `InsightBodyView` for the selected job,
 *               with a back arrow to return to the list.
 *
 * The body cache (`bodyByJob`) is keyed by `jobId` so repeat selections
 * of the same insight don't re-hit the Walrus aggregator. The list
 * itself is fetched once on mount — this is a browse-mode popover, not
 * a live monitor.
 */
export default function InsightPopover({ onClose }: Props) {
  const { notify } = useToast();
  const [view, setView] = useState<{ mode: 'list' } | { mode: 'detail'; jobId: string }>({
    mode: 'list',
  });
  const [rows, setRows] = useState<InsightRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>(FILTER_ALL);
  const [bodyByJob, setBodyByJob] = useState<Record<string, InsightBody | 'loading' | 'error'>>({});

  const fetchList = useCallback(async () => {
    if (!TATUM_API_KEY) return;
    setLoading(true);
    setLoadError(null);
    try {
      const jobs = await listWalrusUploads(TATUM_API_KEY, { limit: 25 });
      const next = jobs
        .map(jobToRow)
        .filter((r): r is InsightRow => r !== null)
        .filter((r) => r.status === 'CERTIFIED' && !!r.downloadUrl)
        .sort((a, b) => b.timestamp - a.timestamp);
      setRows(next);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to list Walrus uploads';
      setLoadError(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchList();
  }, [fetchList]);

  const filterOptions = useMemo(() => {
    const present = new Set(rows.map((r) => r.asset));
    const options: Array<{ value: string; label: string }> = [
      { value: FILTER_ALL, label: 'All assets' },
    ];
    for (const a of INSIGHT_ASSETS) {
      if (present.has(a)) options.push({ value: a, label: a });
    }
    return options;
  }, [rows]);

  const filtered = useMemo(() => {
    if (filter === FILTER_ALL) return rows;
    return rows.filter((r) => r.asset === (filter as InsightAsset));
  }, [rows, filter]);

  const loadBody = useCallback(
    async (jobId: string, downloadUrl: string) => {
      setBodyByJob((m) => ({ ...m, [jobId]: 'loading' }));
      try {
        const body = await fetchInsightBlob<InsightBody>(downloadUrl);
        setBodyByJob((m) => ({ ...m, [jobId]: body }));
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Failed to load insight body';
        notify(msg, { variant: 'error' });
        setBodyByJob((m) => ({ ...m, [jobId]: 'error' }));
      }
    },
    [notify],
  );

  const openRow = useCallback(
    (row: InsightRow) => {
      const existing = bodyByJob[row.jobId];
      if (!existing && row.downloadUrl) {
        void loadBody(row.jobId, row.downloadUrl);
      }
      setView({ mode: 'detail', jobId: row.jobId });
    },
    [bodyByJob, loadBody],
  );

  const detailRow = view.mode === 'detail' ? rows.find((r) => r.jobId === view.jobId) : null;
  const detailBody = view.mode === 'detail' ? bodyByJob[view.jobId] : undefined;

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
              {/* {!!TATUM_API_KEY && rows.length > 0 && (
                <div className="w-36">
                  <GlassDropdown
                    options={filterOptions}
                    value={filter}
                    onChange={setFilter}
                    placeholder="All assets"
                    showValue={false}
                  />
                </div>
              )} */}
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
                title={detailRow?.filename ?? ''}
              >
                {(detailBody && detailBody !== 'loading' && detailBody !== 'error'
                  ? detailBody.title
                  : detailRow?.filename) ?? 'Insight'}
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
        {!TATUM_API_KEY ? (
          <div className="px-4 py-8 text-center text-xs" style={{ color: textSecondary }}>
            Tatum API key missing — set{' '}
            <code className="font-mono">NEXT_PUBLIC_TATUM_API_KEY</code> to load insights.
          </div>
        ) : view.mode === 'list' ? (
          loading && rows.length === 0 ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 size={20} className="animate-spin" style={{ color: green }} />
            </div>
          ) : loadError ? (
            <div className="px-4 py-8 text-center space-y-3">
              <p className="text-xs" style={{ color: red }}>{loadError}</p>
              <button
                onClick={() => void fetchList()}
                className="text-xs font-semibold px-3 py-1.5 rounded-md"
                style={{
                  background: 'rgba(0, 230, 138, 0.10)',
                  border: '1px solid rgba(0, 230, 138, 0.3)',
                  color: green,
                }}
              >
                Retry
              </button>
            </div>
          ) : filtered.length === 0 ? (
            <div className="px-4 py-8 text-center text-xs" style={{ color: textSecondary }}>
              {rows.length === 0
                ? 'No published insights yet. Use Add Insight to create one.'
                : 'No insights match this filter.'}
            </div>
          ) : (
            <div>
              {filtered.map((row) => {
                const cached = bodyByJob[row.jobId];
                const title =
                  cached && cached !== 'loading' && cached !== 'error'
                    ? cached.title
                    : row.filename;
                return (
                  <button
                    key={row.jobId}
                    onClick={() => openRow(row)}
                    className="w-full text-left flex items-center gap-3 px-4 py-3 border-t border-white/5 hover:bg-white/[0.03] transition-colors"
                  >
                    <span
                      className="px-1.5 py-0.5 rounded text-[10px] font-bold flex-shrink-0"
                      style={{ background: 'rgba(255,255,255,0.06)', color: textPrimary }}
                    >
                      {row.asset}
                    </span>
                    <span
                      className="flex-1 min-w-0 text-sm truncate"
                      style={{ color: textPrimary }}
                      title={title}
                    >
                      {title}
                    </span>
                    <span className="text-[11px] font-mono flex-shrink-0" style={{ color: textSecondary }}>
                      {fmtRelative(row.timestamp)}
                    </span>
                    <ChevronRight size={14} style={{ color: textSecondary }} className="flex-shrink-0" />
                  </button>
                );
              })}
            </div>
          )
        ) : (
          // detail mode
          <div className="px-5 py-4">
            {detailBody === 'loading' || detailBody === undefined ? (
              <div className="flex items-center justify-center py-10">
                <Loader2 size={20} className="animate-spin" style={{ color: green }} />
              </div>
            ) : detailBody === 'error' ? (
              <div className="text-center space-y-3 py-6">
                <p className="text-xs" style={{ color: red }}>
                  Could not load this insight.
                </p>
                {detailRow?.downloadUrl && (
                  <button
                    onClick={() => void loadBody(view.jobId, detailRow.downloadUrl!)}
                    className="text-xs font-semibold px-3 py-1.5 rounded-md"
                    style={{
                      background: 'rgba(0, 230, 138, 0.10)',
                      border: '1px solid rgba(0, 230, 138, 0.3)',
                      color: green,
                    }}
                  >
                    Retry
                  </button>
                )}
              </div>
            ) : (
              <InsightBodyView body={detailBody} />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
