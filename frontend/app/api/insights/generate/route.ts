/**
 * `POST /api/insights/generate` — server-proxied MiniMax call.
 *
 * The browser cannot call MiniMax directly because the API key is
 * server-only (no `NEXT_PUBLIC_` prefix, never bundled into the client).
 * This route accepts the same shape that the wizard builds on the
 * Add Insight page, builds the model prompts, then streams the
 * completion back to the caller chunk-for-chunk.
 *
 * Upstream contract: Anthropic-compatible Messages API
 * (`POST {baseUrl}/v1/messages`, `x-api-key` auth, `stream: true`).
 * The configured `MINIMAX_BASE_URL` already points at MiniMax's
 * `/anthropic` compatibility shim, so the request shape and SSE event
 * names match Anthropic's spec. The server-side transformer below
 * converts Anthropic's `content_block_delta` events into the
 * discriminated `data: {"k":"<kind>","t":"<token>"}` SSE frames the
 * client parser in `app/lib/minimax.ts` expects, so each token —
 * whether chain-of-thought reasoning or final prose — is appended
 * live in the right pane of the wizard.
 *
 * Extended thinking: when `MINIMAX_THINKING_BUDGET` is positive, the
 * upstream request opts into Anthropic's `thinking` parameter. The
 * model then emits two interleaved content blocks (one of `type:
 * "thinking"`, one of `type: "text"`) and the transformer tags each
 * delta with the matching `k` discriminator. The wizard's reasoning
 * pane is ephemeral — only the final prose is persisted to the
 * local insights store.
 *
 * Environment:
 *   MINIMAX_API_KEY          server-only; sent as `x-api-key`
 *   MINIMAX_BASE_URL         server-only; e.g. https://api.minimax.io/anthropic
 *   MINIMAX_MODEL            server-only; defaults to 'MiniMax-M3'
 *   MINIMAX_THINKING_BUDGET  server-only; tokens reserved for reasoning
 *                            (default 2048; set to 0 to disable thinking)
 *
 * Response: `text/event-stream`. Frames are
 *   data: {"k":"thinking","t":"<token>"}
 *   data: {"k":"text","t":"<token>"}
 *   data: [DONE]
 * The client-side parser strips the `data:` prefix, JSON-decodes the
 * payload, and yields `{ kind, text }` chunks to the caller.
 */

import type { NextRequest } from 'next/server';

const MINIMAX_BASE_URL = process.env.MINIMAX_BASE_URL ?? '';
const MINIMAX_API_KEY = process.env.MINIMAX_API_KEY ?? '';
const MINIMAX_MODEL = process.env.MINIMAX_MODEL ?? 'MiniMax-M3';
const MINIMAX_THINKING_BUDGET = Number(process.env.MINIMAX_THINKING_BUDGET ?? 2048);
const ANTHROPIC_VERSION = '2023-06-01';
const MAX_TOKENS = 4096;

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface GenerateRequest {
  title: string;
  asset: string;
  includes: unknown;
}

const SYSTEM_PROMPT = [
  'You are a crypto market research analyst generating a structured insight comparing one DeepBook Predict oracle against live Polymarket and Kalshi odds for the same event.',
  '',
  '# Output format (strict)',
  '- Start with a single # <Title> heading',
  '- For EACH data source actually present in `Collected data`, write a ## <Source Name> section',
  '- Only include sections for sources that are present',
  '- Under each section, write 2–3 short paragraphs (max 3 sentences each)',
  '- Each paragraph must include concrete data when available (prices, IV, odds, forward levels, implied probabilities, etc.)',
  '',
  '# Data sources you may receive',
  '- `predict` — DeepBook Predict SVI snapshot: spot, forward, SVI params, 5 standard strikes with UP/DOWN/IV, recent price ticks',
  '- `live.db` — the DeepBook oracle this insight is anchored to (oracleId, expiryMs, question)',
  '- `live.poly` — Polymarket group matched by expiry (may be `null` if no match); has `upDown[]` (strikeUsd, impliedProbUp, description, priceToBeatUsd) and `range[]` (floorStrikeUsd, capStrikeUsd, rangeBandPct, impliedProbUp)',
  '- `live.kalshi` — Kalshi group matched by expiry (may be `null`); same shape as Polymarket',
  '',
  '# Analysis rules',
  '- The core comparison is at the same strike / range across Polymarket, Kalshi, and DeepBook — quote the implied probabilities side by side',
  '- Note when one venue has no match (the field is `null`); do NOT invent numbers for it',
  '- Highlight divergence: where Polymarket says X% UP and Kalshi says Y% UP and DeepBook SVI implies Z%, that is the signal',
  '- Focus on relationships between data (divergence, alignment, trend)',
  '',
  '# Output requirements',
  '- End with a ## Summary section',
  '- Summary must include:',
  '  - simple directional view (up / down / neutral)',
  '  - brief bias (bullish / bearish / range-bound)',
  '  - 1–2 sentence actionable takeaway',
  '',
  '# Rules',
  '- Use GitHub-Flavored Markdown (headings, tables, inline code, links)',
  '- Use ONLY provided data — never invent missing values',
  '- Be concise and data-driven (avoid unnecessary explanation)',
].join('\n');

function buildUserPrompt(body: GenerateRequest): string {
  return [
    `# Title`,
    body.title,
    '',
    `# Asset`,
    body.asset,
    '',
    `# Collected data`,
    '```json',
    JSON.stringify(body.includes, null, 2),
    '```',
    '',
    'Write the full markdown analysis now. Remember: paragraphs under each section, not just headers.',
  ].join('\n');
}

export async function POST(req: NextRequest) {
  if (!MINIMAX_API_KEY || !MINIMAX_BASE_URL) {
    return new Response(
      'MiniMax is not configured. Set MINIMAX_API_KEY and MINIMAX_BASE_URL in your server environment.',
      { status: 503 },
    );
  }

  let body: GenerateRequest;
  try {
    body = (await req.json()) as GenerateRequest;
  } catch {
    return new Response('Invalid JSON body', { status: 400 });
  }
  if (!body.title || !body.asset) {
    return new Response('title and asset are required', { status: 400 });
  }

  const userPrompt = buildUserPrompt(body);

  // Opt into extended thinking when the budget is positive. Anthropic's
  // API requires `budget_tokens` to be strictly less than `max_tokens`,
  // so we clamp the budget to leave room for the actual response.
  const upstreamBody: Record<string, unknown> = {
    model: MINIMAX_MODEL,
    max_tokens: MAX_TOKENS,
    stream: true,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPrompt }],
  };
  if (MINIMAX_THINKING_BUDGET > 0) {
    upstreamBody.thinking = {
      type: 'enabled',
      budget_tokens: Math.min(MINIMAX_THINKING_BUDGET, MAX_TOKENS - 1),
    };
  }

  const upstream = await fetch(`${MINIMAX_BASE_URL}/v1/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': MINIMAX_API_KEY,
      'anthropic-version': ANTHROPIC_VERSION,
    },
    body: JSON.stringify(upstreamBody),
  });

  if (!upstream.ok || !upstream.body) {
    const errText = await upstream.text().catch(() => '');
    return new Response(
      `MiniMax request failed: ${upstream.status} ${upstream.statusText} ${errText}`.trim(),
      { status: 502 },
    );
  }

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  const transform = new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = upstream.body!.getReader();
      let buf = '';
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let idx: number;
          while ((idx = buf.indexOf('\n\n')) !== -1) {
            const frame = buf.slice(0, idx);
            buf = buf.slice(idx + 2);
            let eventType = '';
            let data = '';
            for (const line of frame.split('\n')) {
              if (line.startsWith('event:')) eventType = line.slice(6).trim();
              else if (line.startsWith('data:')) data = line.slice(5).trim();
            }
            if (eventType === 'content_block_delta' && data) {
              try {
                const parsed = JSON.parse(data);
                const delta = parsed?.delta ?? {};
                // Branch on `delta.type` rather than tracking the
                // current block kind from `content_block_start` events —
                // deltas are self-describing and there's no state to keep.
                let kind: 'thinking' | 'text' | null = null;
                let text: string | null = null;
                if (
                  delta.type === 'thinking_delta' &&
                  typeof delta.thinking === 'string' &&
                  delta.thinking.length > 0
                ) {
                  kind = 'thinking';
                  text = delta.thinking;
                } else if (
                  delta.type === 'text_delta' &&
                  typeof delta.text === 'string' &&
                  delta.text.length > 0
                ) {
                  kind = 'text';
                  text = delta.text;
                }
                // Other delta types (input_json_delta, signature_delta)
                // are intentionally ignored.
                if (kind && text !== null) {
                  // JSON-encode the payload so newlines inside the token
                  // never break the SSE frame — `\n` becomes the two-char
                  // escape `\n` in JSON, which the client decodes back.
                  const payload = JSON.stringify({ k: kind, t: text });
                  controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
                }
              } catch {
                // Ignore malformed frames / heartbeats.
              }
            } else if (eventType === 'message_stop') {
              controller.enqueue(encoder.encode('data: [DONE]\n\n'));
            } else if (eventType === 'error' && data) {
              controller.enqueue(encoder.encode(`data: ${data}\n\n`));
            }
          }
        }
        // Flush any unterminated tail.
        if (buf.trim().length > 0) {
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        }
      } catch (e) {
        controller.error(e);
      } finally {
        controller.close();
        reader.releaseLock();
      }
    },
  });

  return new Response(transform, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}