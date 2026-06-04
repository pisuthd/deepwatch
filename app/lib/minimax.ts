/**
 * `generateInsightStream` — client-side helper that calls the server
 * route `POST /api/insights/generate` and yields decoded tokens as
 * they stream back, tagged by kind so the wizard can route them to
 * the reasoning pane or the analysis pane.
 *
 * Frame format: standard Server-Sent Events — each frame is one or
 * more `key: value` lines terminated by a blank line. We only care
 * about `data:` lines. A frame whose data is `[DONE]` ends the stream.
 *
 * Each token frame is `data: {"k":"<kind>","t":"<text>"}` where
 * `<kind>` is `"thinking"` (chain-of-thought) or `"text"` (the final
 * prose). JSON-encoding the payload means newlines inside a token
 * never break the SSE frame.
 *
 * Backward compatibility: if a frame's payload parses as JSON but
 * has no `k` field (e.g. a server that hasn't been redeployed), the
 * chunk is yielded as `{ kind: 'text', text }` so the wizard still
 * streams. If the payload isn't JSON at all, it's yielded raw as a
 * `text` chunk (last-resort fallback).
 */

export interface GenerateInsightInput {
  title: string;
  asset: string;
  includes: unknown;
}

export type InsightStreamChunk =
  | { kind: 'thinking'; text: string }
  | { kind: 'text'; text: string };

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

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });

    // SSE frames are delimited by a blank line ("\n\n"). Pull complete
    // frames off the buffer and yield any `data:` payloads inside.
    let idx: number;
    while ((idx = buf.indexOf('\n\n')) !== -1) {
      const frame = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
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
          if ((k === 'thinking' || k === 'text') && typeof t === 'string' && t.length > 0) {
            yield { kind: k, text: t };
          } else if (typeof t === 'string' && t.length > 0) {
            // Server hasn't been updated — treat as text.
            yield { kind: 'text', text: t };
          }
        } else {
          // Truly raw payload (shouldn't happen with the updated route).
          yield { kind: 'text', text: payload };
        }
      }
    }
  }
}
