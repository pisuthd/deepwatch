/**
 * Tatum Walrus Storage API client.
 *
 * Three endpoints we use:
 *  - `POST /v4/data/storage/upload` — multipart upload of a single file.
 *    Returns a `jobId` immediately and an initial `PENDING` status. The blob
 *    is uploaded in the background; the status endpoint below tracks it.
 *  - `GET  /v4/data/storage/upload/{jobId}` — full job status. Free of charge
 *    (0 credits) so we can poll without burning quota.
 *  - `GET  /v4/data/storage/uploads` — paginated list of every job under
 *    the API key, newest first. This is the canonical source of truth for
 *    the Recent Insights page; we don't maintain a local registry.
 *
 * Auth is a single `x-api-key` header. The key is passed in by the caller
 * (sourced from `process.env.NEXT_PUBLIC_TATUM_API_KEY` in the UI) rather
 * than read here directly — that keeps the helpers testable and lets a
 * different env name be wired without touching the lib.
 *
 * All calls are made directly from the browser; Tatum allows CORS, the
 * existing app has no server-side fetch layer, and the key is a public
 * client-side env var by design.
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
 * endpoint is the source of truth for the Recent Insights page — no
 * client-side mirror is required.
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
    const body = await res.json().catch((e) => console.log(e)); 
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
