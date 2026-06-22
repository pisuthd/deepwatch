/**
 * Client-side helpers that call `POST /api/insights/generate` and yield
 * decoded SSE chunks. Two flows share the same endpoint but emit
 * different chunk kinds:
 *
 *  1. `generateInsightStream` — the legacy wizard flow. One market per
 *     request, freeform prose with thinking + text deltas. Kept around
 *     because `AISummaryCard` on Predict/Spot still uses it.
 *
 *  2. `generateInsightBatch` — the new Compare page flow. One request
 *     covers N markets at once. Upstream uses Anthropic-style
 *     `record_market_signal` tool calls (one per market, in order).
 *     Chunks yielded:
 *        - `{ kind: 'thinking', text }` — chain-of-thought from the model
 *        - `{ kind: 'text', text }`      — any freeform prose the model emits
 *        - `{ kind: 'tool_start', toolName }` — a tool call has begun
 *        - `{ kind: 'result', payload }` — a completed tool call (one per market)
 *
 * Frame format: standard Server-Sent Events — each frame is one or more
 * `key: value` lines terminated by a blank line. We only care about
 * `data:` lines. A frame whose data is `[DONE]` ends the stream.
 *
 * Each token frame is `data: {"k":"<kind>","t":"<text or JSON>"}`
 * where `<kind>` is `"thinking"`, `"text"`, `"tool_start"`, or
 * `"result"`. JSON-encoding the payload means newlines inside a token
 * never break the SSE frame.
 *
 * Backward compatibility: if a frame's payload parses as JSON but has
 * no `k` field (e.g. a server that hasn't been redeployed), the chunk
 * is yielded as `{ kind: 'text', text }` so the wizard still streams.
 * If the payload isn't JSON at all, it's yielded raw as a `text` chunk
 * (last-resort fallback). The same parser handles both flows — the
 * caller dispatches on `kind`.
 */

import type { CmcContext, MatchAnalysisToolInput } from './match-analyses';

// ─── Legacy single-market stream (wizard flow) ──────────────────────────

export interface GenerateInsightInput {
  title: string;
  asset: string;
  includes: unknown;
}

export type InsightStreamChunk =
  | { kind: 'thinking'; text: string }
  | { kind: 'text'; text: string };

// ─── New batch stream (Compare page) ────────────────────────────────────

export interface GenerateBatchMatchInput {
  key: string;
  dbQuestion: string;
  asset: string;
  expiryMs: number;
  dbProb: number;
  polyProb?: number;
  kalshiProb?: number;
  spread?: number;
  polyQuestion?: string;
  kalshiQuestion?: string;
  polyUrl?: string;
  kalshiUrl?: string;
  // ── SVI inputs (optional; pre-existing clients keep working) ─────────
  spotUsd?: number | null;
  forwardUsd?: number | null;
  svi?: { a: number; b: number; rho: number; m: number; sigma: number } | null;
  atmStrikeUsd?: number | null;
}

export interface GenerateBatchInput {
  cmcContext: CmcContext | null;
  matches: GenerateBatchMatchInput[];
}

export type InsightBatchChunk =
  | { kind: 'thinking'; text: string }
  | { kind: 'text'; text: string }
  | { kind: 'tool_start'; toolName: string }
  | { kind: 'result'; payload: MatchAnalysisToolInput };

/**
 * Validate the parsed JSON value of a `result` SSE frame. Returns the
 * typed payload if it matches `MatchAnalysisToolInput`, or `null` if
 * any required field is missing or out of range. The server-side route
 * re-validates with the same function before emitting the frame, but
 * the client re-validates to guard against prompt drift / server bugs.
 */
function safeParseResult(t: unknown): MatchAnalysisToolInput | null {
  if (!t || typeof t !== 'object') return null;
  const r = t as Record<string, unknown>;
  if (typeof r.matchKey !== 'string' || r.matchKey.length === 0) return null;
  if (r.signal !== 'UP' && r.signal !== 'DOWN' && r.signal !== 'NEUTRAL') return null;
  if (typeof r.confidence !== 'number' || !Number.isFinite(r.confidence)) return null;
  if (r.confidence < 0 || r.confidence > 1) return null;
  if (typeof r.positionSizePct !== 'number' || !Number.isFinite(r.positionSizePct)) return null;
  if (r.positionSizePct < 0 || r.positionSizePct > 100) return null;
  if (typeof r.reasoning !== 'string') return null;
  const sviTake =
    typeof r.sviTake === 'string' && r.sviTake.length > 0
      ? r.sviTake.slice(0, 200)
      : undefined;
  const crossVenueTake =
    typeof r.crossVenueTake === 'string' && r.crossVenueTake.length > 0
      ? r.crossVenueTake.slice(0, 200)
      : undefined;
  const macroTake =
    typeof r.macroTake === 'string' && r.macroTake.length > 0
      ? r.macroTake.slice(0, 120)
      : undefined;
  return {
    matchKey: r.matchKey,
    signal: r.signal,
    confidence: r.confidence,
    positionSizePct: r.positionSizePct,
    reasoning: r.reasoning.slice(0, 200),
    ...(sviTake ? { sviTake } : {}),
    ...(crossVenueTake ? { crossVenueTake } : {}),
    ...(macroTake ? { macroTake } : {}),
  };
}

export async function* generateInsightStream(
  body: GenerateInsightInput,
  signal?: AbortSignal,
): AsyncGenerator<InsightStreamChunk, void, void> {
  const res = await fetch('/api/insights/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) {
    const msg = await res.text().catch(() => `HTTP ${res.status}`);
    throw new Error(msg || `HTTP ${res.status}`);
  }
  yield* readSseFramesAsLegacy(res);
}

export async function* generateInsightBatch(
  body: GenerateBatchInput,
  signal?: AbortSignal,
): AsyncGenerator<InsightBatchChunk, void, void> {
  const res = await fetch('/api/insights/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      kind: 'batch',
      cmcContext: body.cmcContext,
      matches: body.matches,
    }),
    signal,
  });
  if (!res.ok || !res.body) {
    const msg = await res.text().catch(() => `HTTP ${res.status}`);
    throw new Error(msg || `HTTP ${res.status}`);
  }
  yield* readSseFramesAsBatch(res);
}

/**
 * Drive an SSE response stream, yielding legacy `InsightStreamChunk`
 * frames (thinking | text). Other `k` values from a server that has
 * been upgraded to support tool calls are flattened to `text` so the
 * wizard never silently loses content.
 */
async function* readSseFramesAsLegacy(
  res: Response,
): AsyncGenerator<InsightStreamChunk, void, void> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf('\n\n')) !== -1) {
      const frame = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      for (const chunk of decodeFrame(frame)) {
        yield flattenToLegacy(chunk);
      }
    }
  }
}

/**
 * Drive an SSE response stream, yielding batch `InsightBatchChunk`
 * frames (thinking | text | tool_start | result). Invalid `result`
 * frames are dropped silently with a console.warn so prompt drift
 * can't poison the UI.
 */
async function* readSseFramesAsBatch(
  res: Response,
): AsyncGenerator<InsightBatchChunk, void, void> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf('\n\n')) !== -1) {
      const frame = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      for (const raw of decodeFrame(frame)) {
        if (raw.kind === 'thinking') {
          yield { kind: 'thinking', text: raw.text };
        } else if (raw.kind === 'text') {
          yield { kind: 'text', text: raw.text };
        } else if (raw.kind === 'tool_start') {
          yield { kind: 'tool_start', toolName: raw.text };
        } else if (raw.kind === 'result') {
          // raw.text here is the JSON-stringified payload; re-parse and
          // validate before forwarding so the consumer gets a typed
          // object instead of a string.
          try {
            const parsed = JSON.parse(raw.text) as unknown;
            const validated = safeParseResult(parsed);
            if (validated) {
              yield { kind: 'result', payload: validated };
            } else {
              console.warn('[minimax] dropping invalid result frame:', parsed);
            }
          } catch (err) {
            console.warn('[minimax] result frame JSON parse failed:', err);
          }
        }
      }
    }
  }
}

/**
 * Raw frame decoder. Returns one record per `data:` payload in the
 * SSE frame. The `text` field holds the JSON-encoded `t` value —
 * either a plain string (for thinking/text/tool_start) or a
 * JSON-stringified object (for result).
 *
 * Falls back to `{ kind: 'text', text: <raw> }` when the payload isn't
 * JSON or has no recognised `k`, so a misconfigured server still
 * streams something the UI can render.
 */
type RawFrame =
  | { kind: 'thinking'; text: string }
  | { kind: 'text'; text: string }
  | { kind: 'tool_start'; text: string }
  | { kind: 'result'; text: string };

function decodeFrame(frame: string): RawFrame[] {
  const out: RawFrame[] = [];
  for (const line of frame.split('\n')) {
    if (!line.startsWith('data:')) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === '[DONE]') continue;
    let parsed: { k?: unknown; t?: unknown } | null = null;
    try {
      parsed = JSON.parse(payload);
    } catch {
      // Non-JSON payload — fall through to the raw fallback below.
    }
    if (parsed && typeof parsed === 'object') {
      const k = parsed.k;
      const t = parsed.t;
      if (k === 'thinking' && typeof t === 'string' && t.length > 0) {
        out.push({ kind: 'thinking', text: t });
      } else if (k === 'text' && typeof t === 'string' && t.length > 0) {
        out.push({ kind: 'text', text: t });
      } else if (k === 'tool_start' && typeof t === 'string' && t.length > 0) {
        out.push({ kind: 'tool_start', text: t });
      } else if (k === 'result' && t !== undefined) {
        out.push({ kind: 'result', text: JSON.stringify(t) });
      } else if (typeof t === 'string' && t.length > 0) {
        // Server hasn't been updated to this format — treat as text.
        out.push({ kind: 'text', text: t });
      }
    } else if (payload.length > 0) {
      // Truly raw payload (shouldn't happen with the updated route).
      out.push({ kind: 'text', text: payload });
    }
  }
  return out;
}

/** Collapse a batch chunk down to the legacy union. */
function flattenToLegacy(chunk: RawFrame): InsightStreamChunk {
  if (chunk.kind === 'thinking') return { kind: 'thinking', text: chunk.text };
  if (chunk.kind === 'text') return { kind: 'text', text: chunk.text };
  if (chunk.kind === 'tool_start') {
    return { kind: 'text', text: `[tool: ${chunk.text}]` };
  }
  // result — surface as text so the legacy wizard at least renders the JSON.
  return { kind: 'text', text: chunk.text };
}
