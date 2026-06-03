'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Check,
  Copy,
  ExternalLink,
  Loader2,
  RefreshCw,
  X,
} from 'lucide-react';
import PageWrapper from '../common/PageWrapper';
import GlassCard from '../common/GlassCard';
import GlassDropdown from '../common/GlassDropdown';
import MarkdownRenderer from '../common/MarkdownRenderer';
import { useToast } from '../../context/ToastContext';
import {
  INSIGHT_ASSETS,
  parseInsightFilename,
  type InsightAsset,
  type InsightBody,
  type InsightRow,
} from '../../lib/insights';
import {
  fetchInsightBlob,
  getWalrusUploadStatus,
  listWalrusUploads,
  type WalrusStorageJobStatusResponse,
  type WalrusUploadStatus,
} from '../../lib/tatum';

const green = '#00E68A';
const red = '#ef4444';
const textPrimary = '#ffffff';
const textSecondary = '#9ca3af';
const yellow = '#eab308';
const TATUM_API_KEY = process.env.NEXT_PUBLIC_TATUM_API_KEY ?? '';

const STATUS_COLORS: Record<
  WalrusUploadStatus,
  { bg: string; text: string; label: string }
> = {
  CERTIFIED: { bg: 'rgba(0, 230, 138, 0.15)', text: green, label: 'CERTIFIED' },
  PENDING: { bg: 'rgba(234, 179, 8, 0.15)', text: yellow, label: 'PENDING' },
  UPLOADING: { bg: 'rgba(234, 179, 8, 0.15)', text: yellow, label: 'UPLOADING' },
  FAILED: { bg: 'rgba(239, 68, 68, 0.15)', text: red, label: 'FAILED' },
};

const FILTER_ALL = '__all__';

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

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return `${s.slice(0, n)}…`;
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
 * Recent Insights — list every Walrus upload the API key has produced,
 * filtered down to those matching the `insight-` filename convention. Tatum
 * `GET /v4/data/storage/uploads` is the source of truth — no client-side
 * mirror. Click a row to lazily fetch and render the on-chain JSON body.
 */
export default function RecentInsightsPage() {
  const { notify } = useToast();
  const [rows, setRows] = useState<InsightRow[]>([]);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>(FILTER_ALL);
  const [loading, setLoading] = useState(false);
  const [initialLoaded, setInitialLoaded] = useState(false);
  const [bodyByJob, setBodyByJob] = useState<Record<string, InsightBody | 'loading' | 'error'>>({});

  const fetchList = useCallback(async () => {
    if (!TATUM_API_KEY) {
      setRows([]);
      setInitialLoaded(true);
      return;
    }
    setLoading(true);
    try {
      const jobs = await listWalrusUploads(TATUM_API_KEY, { limit: 100 });
      console.log("jobs", jobs)
      const rows = jobs.map(jobToRow).filter((r): r is InsightRow => r !== null);
      rows.sort((a, b) => b.timestamp - a.timestamp);
      setRows(rows);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to list Walrus uploads';
      notify(msg, { variant: 'error' });
    } finally {
      setLoading(false);
      setInitialLoaded(true);
    }
  }, [notify]);

  useEffect(() => {
    void fetchList();
  }, [fetchList]);

  // Auto-refresh while at least one row is still in flight.
  useEffect(() => {
    const hasPending = rows.some((r) => r.status === 'PENDING' || r.status === 'UPLOADING');
    if (!hasPending) return;
    const id = setInterval(() => {
      void fetchList();
    }, 5_000);
    return () => clearInterval(id);
  }, [rows, fetchList]);

  // Lazy-fetch the blob body for the selected row.
  useEffect(() => {
    if (!selectedJobId) return;
    const row = rows.find((r) => r.jobId === selectedJobId);
    if (!row?.downloadUrl) return;
    if (row.status !== 'CERTIFIED') return;
    if (bodyByJob[selectedJobId]) return;

    setBodyByJob((m) => ({ ...m, [selectedJobId]: 'loading' }));
    fetchInsightBlob<InsightBody>(row.downloadUrl)
      .then((body) => {
        setBodyByJob((m) => ({ ...m, [selectedJobId]: body }));
      })
      .catch((e) => {
        const msg = e instanceof Error ? e.message : 'Failed to load insight body';
        notify(msg, { variant: 'error' });
        setBodyByJob((m) => ({ ...m, [selectedJobId]: 'error' }));
      });
  }, [selectedJobId, rows, bodyByJob, notify]);

  const filterOptions = useMemo(() => {
    const present = new Set(rows.map((r) => r.asset));
    const options = [{ value: FILTER_ALL, label: 'All assets' }];
    for (const a of INSIGHT_ASSETS) {
      if (present.has(a)) options.push({ value: a, label: a });
    }
    return options;
  }, [rows]);

  const filtered = useMemo(() => {
    if (filter === FILTER_ALL) return rows;
    return rows.filter((r) => r.asset === (filter as InsightAsset));
  }, [rows, filter]);

  const selectedRow = useMemo(
    () => rows.find((r) => r.jobId === selectedJobId) ?? null,
    [rows, selectedJobId],
  );

  const repollOne = useCallback(
    async (jobId: string) => {
      if (!TATUM_API_KEY) {
        notify('Tatum API key is not configured.', { variant: 'error' });
        return;
      }
      try {
        const status = await getWalrusUploadStatus(jobId, TATUM_API_KEY);
        // Patch this one row from the fresh status.
        setRows((prev) => {
          const parsed = parseInsightFilename(status.filename);
          if (!parsed) return prev;
          const next: InsightRow = {
            asset: parsed.asset,
            jobId: status.jobId,
            status: status.status,
            filename: status.filename,
            sizeBytes: status.sizeBytes,
            timestamp: parsed.timestamp,
            errorMessage: status.errorMessage,
            blobId: status.blobId,
            suiObjectId: status.suiObjectId,
            downloadUrl: status.downloadUrlByQuiltId ?? status.downloadUrlByQuiltPatchId,
          };
          return prev.map((r) => (r.jobId === jobId ? next : r));
        });
        if (status.status === 'CERTIFIED') {
          notify('Status: CERTIFIED', { variant: 'success' });
        } else if (status.status === 'FAILED') {
          notify(status.errorMessage ?? 'Upload failed.', { variant: 'error' });
        } else {
          notify('Still uploading — try again later.', { variant: 'info' });
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Status check failed';
        notify(msg, { variant: 'error' });
      }
    },
    [notify],
  );

  if (!TATUM_API_KEY) {
    return (
      <PageWrapper title="Recent Insights">
        <GlassCard>
          <div className="text-center py-8 space-y-1">
            <h3 className="text-base font-semibold" style={{ color: textPrimary }}>
              Tatum API key missing
            </h3>
            <p className="text-sm" style={{ color: textSecondary }}>
              Add <code className="font-mono">NEXT_PUBLIC_TATUM_API_KEY</code> to your{' '}
              <code className="font-mono">.env</code> to list Walrus uploads.
            </p>
          </div>
        </GlassCard>
      </PageWrapper>
    );
  }

  if (!initialLoaded) {
    return (
      <PageWrapper title="Recent Insights">
        <div className="flex items-center justify-center h-64">
          <Loader2 size={24} className="animate-spin" style={{ color: green }} />
        </div>
      </PageWrapper>
    );
  }

  return (
    <PageWrapper title="Recent Insights">
      <div className="space-y-4">
        {/* Header row */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => void fetchList()}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50"
            style={{
              background: 'rgba(0, 230, 138, 0.10)',
              border: '1px solid rgba(0, 230, 138, 0.3)',
              color: green,
            }}
          >
            {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
            Refresh
          </button>
          <div className="w-44">
            <GlassDropdown
              options={filterOptions}
              value={filter}
              onChange={setFilter}
              placeholder="Filter by asset"
            />
          </div>
          <div className="text-xs" style={{ color: textSecondary }}>
            {rows.length === 0
              ? '0 insights'
              : `${filtered.length} of ${rows.length} insight${rows.length === 1 ? '' : 's'}`}
          </div>
        </div>

        {rows.length === 0 ? (
          <GlassCard>
            <div className="text-center py-8">
              <h3 className="text-base font-semibold mb-1" style={{ color: textPrimary }}>
                No insights on this API key
              </h3>
              <p className="text-sm" style={{ color: textSecondary }}>
                Head to{' '}
                <a
                  href="/app/add-insight"
                  className="underline"
                  style={{ color: green }}
                >
                  Add Insight
                </a>{' '}
                to publish your first.
              </p>
            </div>
          </GlassCard>
        ) : (
          <GlassCard>
            <div className="overflow-x-auto -mx-5 px-5">
              <table className="w-full text-xs" style={{ borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                    <th className="text-left py-2 px-2 font-semibold uppercase tracking-wide text-[10px]" style={{ color: textSecondary }}>Date</th>
                    <th className="text-left py-2 px-2 font-semibold uppercase tracking-wide text-[10px]" style={{ color: textSecondary }}>Asset</th>
                    <th className="text-left py-2 px-2 font-semibold uppercase tracking-wide text-[10px]" style={{ color: textSecondary }}>Status</th>
                    <th className="text-left py-2 px-2 font-semibold uppercase tracking-wide text-[10px]" style={{ color: textSecondary }}>Filename</th>
                    <th className="text-right py-2 px-2 font-semibold uppercase tracking-wide text-[10px]" style={{ color: textSecondary }}>Size</th>
                    <th className="text-right py-2 px-2 font-semibold uppercase tracking-wide text-[10px]" style={{ color: textSecondary }}>Open</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r) => {
                    const s = STATUS_COLORS[r.status];
                    const isActive = r.jobId === selectedJobId;
                    return (
                      <tr
                        key={r.jobId}
                        onClick={() => setSelectedJobId(r.jobId)}
                        className="cursor-pointer transition-colors"
                        style={{
                          borderBottom: '1px solid rgba(255,255,255,0.04)',
                          background: isActive ? 'rgba(0,230,138,0.06)' : 'transparent',
                        }}
                        onMouseEnter={(e) => {
                          if (!isActive) e.currentTarget.style.background = 'rgba(255,255,255,0.04)';
                        }}
                        onMouseLeave={(e) => {
                          if (!isActive) e.currentTarget.style.background = 'transparent';
                        }}
                      >
                        <td className="py-2 px-2 font-mono" style={{ color: textPrimary }}>{fmtRelative(r.timestamp)}</td>
                        <td className="py-2 px-2">
                          <span
                            className="px-1.5 py-0.5 rounded text-[10px] font-bold"
                            style={{
                              background: 'rgba(255,255,255,0.06)',
                              color: textPrimary,
                            }}
                          >
                            {r.asset}
                          </span>
                        </td>
                        <td className="py-2 px-2">
                          <span
                            className="px-1.5 py-0.5 rounded text-[10px] font-bold font-mono"
                            style={{ background: s.bg, color: s.text }}
                          >
                            {s.label}
                          </span>
                        </td>
                        <td className="py-2 px-2 font-mono truncate max-w-[200px]" style={{ color: textSecondary }} title={r.filename}>
                          {r.filename}
                        </td>
                        <td className="py-2 px-2 font-mono text-right" style={{ color: textPrimary }}>{fmtSize(r.sizeBytes)}</td>
                        <td className="py-2 px-2 text-right">
                          {r.downloadUrl ? (
                            <a
                              href={r.downloadUrl}
                              target="_blank"
                              rel="noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="inline-flex items-center justify-center w-6 h-6 rounded hover:bg-white/10"
                              style={{ color: green }}
                              title={r.downloadUrl}
                            >
                              <ExternalLink size={12} />
                            </a>
                          ) : (
                            <span style={{ color: textSecondary, opacity: 0.4 }}>—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </GlassCard>
        )}

        {/* Detail panel */}
        {selectedRow && (
          <InsightDetail
            row={selectedRow}
            bodyState={bodyByJob[selectedRow.jobId]}
            onRepoll={() => void repollOne(selectedRow.jobId)}
            onClose={() => setSelectedJobId(null)}
          />
        )}
      </div>
    </PageWrapper>
  );
}

function InsightDetail({
  row,
  bodyState,
  onRepoll,
  onClose,
}: {
  row: InsightRow;
  bodyState: InsightBody | 'loading' | 'error' | undefined;
  onRepoll: () => void;
  onClose: () => void;
}) {
  const { notify } = useToast();
  const [copied, setCopied] = useState<'blob' | 'url' | null>(null);
  const s = STATUS_COLORS[row.status];

  const handleCopy = async (text: string, kind: 'blob' | 'url') => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(kind);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      notify('Copy failed', { variant: 'error' });
    }
  };

  return (
    <GlassCard>
      <div className="space-y-3">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-sm font-bold font-mono truncate" style={{ color: textPrimary }}>
                {row.filename}
              </h3>
              <span
                className="px-1.5 py-0.5 rounded text-[10px] font-bold font-mono"
                style={{ background: s.bg, color: s.text }}
              >
                {s.label}
              </span>
            </div>
            <p className="text-[11px] font-mono mt-1" style={{ color: textSecondary }}>
              {row.asset} · {fmtSize(row.sizeBytes)} · {fmtRelative(row.timestamp)}
            </p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={onRepoll}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors"
              style={{
                background: 'rgba(0, 230, 138, 0.10)',
                border: '1px solid rgba(0, 230, 138, 0.3)',
                color: green,
              }}
            >
              <RefreshCw size={11} /> Re-check
            </button>
            <button
              onClick={onClose}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors"
              style={{
                background: 'rgba(255, 255, 255, 0.04)',
                border: '1px solid rgba(255, 255, 255, 0.10)',
                color: textSecondary,
              }}
            >
              <X size={11} /> Close
            </button>
          </div>
        </div>

        {/* IDs */}
        <div className="space-y-1.5">
          {row.blobId && (
            <div
              className="flex items-center justify-between gap-2 rounded-md px-2.5 py-1.5"
              style={{ background: 'rgba(255,255,255,0.03)' }}
            >
              <div className="min-w-0 flex-1">
                <div className="text-[10px] uppercase tracking-wide" style={{ color: textSecondary }}>
                  Blob ID
                </div>
                <div className="text-[11px] font-mono truncate" style={{ color: textPrimary }} title={row.blobId}>
                  {row.blobId}
                </div>
              </div>
              <button
                onClick={() => handleCopy(row.blobId!, 'blob')}
                className="shrink-0 p-1.5 rounded hover:bg-white/10"
                style={{ color: copied === 'blob' ? green : textSecondary }}
                title="Copy blobId"
              >
                {copied === 'blob' ? <Check size={12} /> : <Copy size={12} />}
              </button>
            </div>
          )}

          {row.downloadUrl && (
            <div
              className="flex items-center justify-between gap-2 rounded-md px-2.5 py-1.5"
              style={{ background: 'rgba(255,255,255,0.03)' }}
            >
              <div className="min-w-0 flex-1">
                <div className="text-[10px] uppercase tracking-wide" style={{ color: textSecondary }}>
                  Download URL
                </div>
                <div className="text-[11px] font-mono truncate" style={{ color: textPrimary }} title={row.downloadUrl}>
                  {truncate(row.downloadUrl, 60)}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => handleCopy(row.downloadUrl!, 'url')}
                  className="p-1.5 rounded hover:bg-white/10"
                  style={{ color: copied === 'url' ? green : textSecondary }}
                  title="Copy URL"
                >
                  {copied === 'url' ? <Check size={12} /> : <Copy size={12} />}
                </button>
                <a
                  href={row.downloadUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="p-1.5 rounded hover:bg-white/10"
                  style={{ color: green }}
                  title="Open in new tab"
                >
                  <ExternalLink size={12} />
                </a>
              </div>
            </div>
          )}

          {row.errorMessage && (
            <div
              className="rounded-md p-2.5 text-xs"
              style={{ background: 'rgba(239, 68, 68, 0.1)', color: red }}
            >
              <div className="flex items-center gap-1.5 font-semibold mb-0.5">
                <X size={12} /> Error
              </div>
              {row.errorMessage}
            </div>
          )}
        </div>

        <div
          className="border-t"
          style={{ borderColor: 'rgba(255,255,255,0.06)' }}
        />

        {/* Markdown body */}
        <div>
          <div className="text-[10px] uppercase tracking-wide mb-1.5" style={{ color: textSecondary }}>
            Content
          </div>
          <div
            className="rounded-lg p-3 overflow-auto"
            style={{
              background: 'rgba(255, 255, 255, 0.03)',
              border: '1px solid rgba(255, 255, 255, 0.06)',
              maxHeight: 480,
            }}
          >
            {row.status !== 'CERTIFIED' ? (
              <p className="text-xs" style={{ color: textSecondary }}>
                Waiting for Walrus to certify this blob before body is readable.
              </p>
            ) : bodyState === 'loading' || bodyState === undefined ? (
              <div className="flex items-center gap-2 text-xs" style={{ color: textSecondary }}>
                <Loader2 size={12} className="animate-spin" />
                Fetching from Walrus…
              </div>
            ) : bodyState === 'error' ? (
              <p className="text-xs" style={{ color: red }}>
                Could not load the on-chain body.
              </p>
            ) : (
              <div className="space-y-2">
                {(bodyState.tag || bodyState.source) && (
                  <div className="flex items-center gap-2 flex-wrap text-[10px] font-mono" style={{ color: textSecondary }}>
                    {bodyState.tag && (
                      <span className="px-1.5 py-0.5 rounded" style={{ background: 'rgba(255,255,255,0.06)' }}>
                        tag: {bodyState.tag}
                      </span>
                    )}
                    {bodyState.source && (
                      <span className="px-1.5 py-0.5 rounded" style={{ background: 'rgba(255,255,255,0.06)' }}>
                        source: {bodyState.source}
                      </span>
                    )}
                  </div>
                )}
                <MarkdownRenderer content={bodyState.markdown} />
              </div>
            )}
          </div>
        </div>
      </div>
    </GlassCard>
  );
}
