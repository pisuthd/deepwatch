/**
 * Tatum Walrus Storage API client.
 *
 * Re-introduced for the new AI batch insight flow (Part 3). The old version
 * of the app shipped with this client; it was removed in the local-first
 * migration. The behaviour and endpoints are unchanged — copy-paste from
 * [`pisuthd-deepwatch-a0ed929/app/lib/tatum.ts`](pisuthd-deepwatch-a0ed929/app/lib/tatum.ts),
 * with types renamed to match the new `BatchInsight` / `BatchInsightRow`
 * surface.
 *
 * # Endpoints (Tatum Storage v4)
 *
 *  - `POST /v4/data/storage/upload` — multipart upload of a single file.
 *    Returns a `jobId` immediately and an initial `PENDING` status. The blob
 *    is uploaded in the background; the status endpoint below tracks it.
 *  - `GET  /v4/data/storage/upload/{jobId}` — full job status. Free of
 *    charge (0 credits) so we can poll without burning quota.
 *  - `GET  /v4/data/storage/uploads` — paginated list of every job under
 *    the API key, newest first. This is the canonical source of truth for
 *    the Recent Batches panel; we don't maintain a local registry (only a
 *    per-blob cache — see `batch-index-store.tsx`).
 *
 * # Auth
 *
 * Single `x-api-key` header. The key is passed in by the caller (sourced
 * from `process.env.NEXT_PUBLIC_TATUM_API_KEY`) rather than read here
 * directly — that keeps the helpers testable and lets a different env
 * name be wired without touching the lib.
 *
 * All calls are made directly from the browser. Tatum allows CORS, the
 * existing app has no server-side fetch layer for this surface, and the
 * key is a public client-side env var by design (matches the old code).
 *
 * # Cost note
 *
 * Tatum's free tier is 10K calls/month per IP. The 60s in-memory caches
 * elsewhere in the app keep us well under that for v1, but a production
 * deploy should plan for paid usage (~$0.0001 per upload + per-epoch
 * storage).
 */

export const TATUM_BASE_URL = 'https://api.tatum.io';

export type WalrusUploadStatus = 'PENDING' | 'UPLOADING' | 'CERTIFIED' | 'FAILED';
export type WalrusRenewalBillingStatus =
  | 'active'
  | 'pending_initial_charge'
  | 'pending_renewal_credit'
  | 'pending_decommission'
  | 'pending_instant_delete'
  | 'decommissioned';

export interface WalrusStorageEvent {
  type: 'registered' | 'certified' | 'renewed' | 'deleted';
  txDigest: string;
  at?: number;
  epochs?: number;
}

export interface WalrusStorageEnqueueResponse {
  jobId: string;
  status: WalrusUploadStatus;
  filename: string;
  mimeType?: string;
  sizeBytes: number;
  blobId: string;
}

export interface WalrusStorageJobStatusResponse {
  jobId: string;
  status: WalrusUploadStatus;
  filename: string;
  mimeType?: string;
  sizeBytes: number;
  errorMessage?: string;
  blobId?: string;
  quiltPatchId?: string;
  suiObjectId?: string;
  walrusStartEpoch?: number;
  walrusEndEpoch?: number;
  renewalBillingStatus?: WalrusRenewalBillingStatus;
  noRenewal?: boolean;
  storageEvents?: WalrusStorageEvent[];
  downloadUrlByQuiltId?: string;
  downloadUrlByQuiltPatchId?: string;
  createdAt: number;
  updatedAt: number;
}

export class TatumApiError extends Error {
  public readonly status: number;
  public readonly body: unknown;
  constructor(status: number, body: unknown, message: string) {
    super(message);
    this.name = 'TatumApiError';
    this.status = status;
    this.body = body;
  }
}

export async function uploadInsightToWalrus(
  file: File,
  apiKey: string,
): Promise<WalrusStorageEnqueueResponse> {
  if (!apiKey) throw new Error('Tatum API key is required');
  const fd = new FormData();
  fd.append('file', file);
  const res = await fetch(`${TATUM_BASE_URL}/v4/data/storage/upload`, {
    method: 'POST',
    headers: { 'x-api-key': apiKey },
    body: fd,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new TatumApiError(
      res.status,
      body,
      `Upload failed (${res.status}): ${describeTatumError(body) ?? res.statusText}`,
    );
  }
  return res.json();
}

export async function getWalrusUploadStatus(
  jobId: string,
  apiKey: string,
): Promise<WalrusStorageJobStatusResponse> {
  if (!apiKey) throw new Error('Tatum API key is required');
  const res = await fetch(`${TATUM_BASE_URL}/v4/data/storage/upload/${jobId}`, {
    headers: { 'x-api-key': apiKey },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new TatumApiError(
      res.status,
      body,
      `Status check failed (${res.status}): ${describeTatumError(body) ?? res.statusText}`,
    );
  }
  return res.json();
}

/**
 * Poll a job's status until it reaches a terminal state (`CERTIFIED` or
 * `FAILED`) or `maxAttempts` is exhausted. `onUpdate` is called on every
 * poll so the caller can persist intermediate PENDING/UPLOADING states.
 *
 * If the loop exits without reaching a terminal state, the LAST response
 * is returned — the caller is expected to handle "still PENDING" by
 * either re-polling manually or showing "uploading, check back later".
 */
export async function pollWalrusStatus(
  jobId: string,
  apiKey: string,
  options: {
    intervalMs?: number;
    maxAttempts?: number;
    onUpdate?: (status: WalrusStorageJobStatusResponse) => void;
  } = {},
): Promise<WalrusStorageJobStatusResponse> {
  const { intervalMs = 2_000, maxAttempts = 15, onUpdate } = options;
  let last: WalrusStorageJobStatusResponse | null = null;
  for (let i = 0; i < maxAttempts; i++) {
    last = await getWalrusUploadStatus(jobId, apiKey);
    onUpdate?.(last);
    if (last.status === 'CERTIFIED' || last.status === 'FAILED') return last;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return last!;
}

export function describeTatumError(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  if (typeof b.message === 'string') return b.message;
  if (typeof b.error === 'string') return b.error;
  if (typeof b.errorMessage === 'string') return b.errorMessage;
  return null;
}

/**
 * List all upload jobs for the current API key, newest first. Paginated via
 * `limit` (1–100, default 50) and `offset` (0–10000, default 0). The list
 * endpoint is the source of truth for the Recent Batches panel — no
 * client-side mirror is required (we do cache blob bodies, not job rows).
 */
export async function listWalrusUploads(
  apiKey: string,
  options: { limit?: number; offset?: number } = {},
): Promise<WalrusStorageJobStatusResponse[]> {
  if (!apiKey) throw new Error('Tatum API key is required');
  const { limit = 50, offset = 0 } = options;
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  const res = await fetch(`${TATUM_BASE_URL}/v4/data/storage/uploads?${params}`, {
    headers: { 'x-api-key': apiKey },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new TatumApiError(
      res.status,
      body,
      `List failed (${res.status}): ${describeTatumError(body) ?? res.statusText}`,
    );
  }
  const data = await res.json();
  return Array.isArray(data) ? (data as WalrusStorageJobStatusResponse[]) : [];
}

/**
 * Download the JSON body of a certified Walrus blob via the aggregator URL
 * the list/status endpoints expose. We can't reach the aggregator without
 * CORS — it sets `Access-Control-Allow-Origin: *`, so a plain `fetch` from
 * the browser works. Returns the parsed JSON; throws on non-2xx.
 */
export async function fetchInsightBlob<T = unknown>(downloadUrl: string): Promise<T> {
  const res = await fetch(downloadUrl);
  if (!res.ok) {
    throw new Error(`Blob fetch failed (${res.status}): ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

// ─── Batch filename convention ──────────────────────────────────────────────

/**
 * Filename shape: `analysis-batch-<batchId>-<timestampMs>.json`
 *
 * The `<batchId>` is an 8-char random hex string generated by the
 * provider at the moment a batch is kicked. The `<timestampMs>` is
 * `Date.now()` at that same moment, so the filename encodes both the
 * batch identity and the time without needing to fetch the blob body.
 *
 * Examples:
 *   analysis-batch-a1b2c3d4-1749056400000.json
 *   analysis-batch-e5f6g7h8-1749052800000.json
 */
const BATCH_FILENAME_RE = /^analysis-batch-([a-z0-9]{8})-(\d+)\.json$/i;

export interface ParsedBatchFilename {
  batchId: string;
  timestamp: number;
}

/**
 * Parse a Walrus upload filename into `(batchId, timestamp)`. Returns
 * `null` if the filename doesn't match the batch convention (so the
 * recent-batches list can filter to just the AI batch uploads and skip
 * any stray files the API key has produced).
 */
export function parseBatchFilename(filename: string): ParsedBatchFilename | null {
  const m = BATCH_FILENAME_RE.exec(filename);
  if (!m) return null;
  return {
    batchId: m[1],
    timestamp: Number(m[2]),
  };
}

/**
 * Build a batch filename from the inputs. Kept in this file (next to
 * `parseBatchFilename`) so the two stay in sync.
 */
export function batchFilename(batchId: string, timestampMs: number = Date.now()): string {
  return `analysis-batch-${batchId}-${timestampMs}.json`;
}

// ─── Status colour tokens ───────────────────────────────────────────────────

/**
 * Status → badge colour tokens. Used by `RecentBatchesPanel` and (in v2)
 * the per-row "uploading" indicator on the Compare page. Hoisted here
 * so both surfaces stay visually consistent.
 */
export const WALRUS_STATUS_COLORS: Record<
  WalrusUploadStatus,
  { bg: string; text: string; label: string }
> = {
  CERTIFIED: { bg: 'rgba(0, 230, 138, 0.15)', text: '#00E68A', label: 'CERTIFIED' },
  PENDING: { bg: 'rgba(234, 179, 8, 0.15)', text: '#eab308', label: 'PENDING' },
  UPLOADING: { bg: 'rgba(234, 179, 8, 0.15)', text: '#eab308', label: 'UPLOADING' },
  FAILED: { bg: 'rgba(239, 68, 68, 0.15)', text: '#ef4444', label: 'FAILED' },
};
