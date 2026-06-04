'use client';

import { useMemo, useState } from 'react';
import { Check, X } from 'lucide-react';
import GlassCard from '../../common/GlassCard';

const green = '#00E68A';
const red = '#ef4444';
const textPrimary = '#ffffff';
const textSecondary = '#9ca3af';

/**
 * Kalshi tickers are uppercase alphanumeric with optional `-` and `_`
 * separators. Matches the format documented in the user-provided
 * Tatum prediction-market spec.
 */
const VALID_RE = /^[A-Z0-9_-]+$/;

interface Props {
  value: string[];
  onChange: (tickers: string[]) => void;
}

/**
 * KalshiCard — manual ticker entry only. The user types one ticker per
 * line; each line is validated against `^[A-Z0-9_-]+$` and shown with a
 * green check or red X. Only valid tickers are propagated to `onChange`
 * (so the published insight only contains well-formed tickers).
 *
 * Search is intentionally not wired up — the user said Kalshi search is
 * unstable, so the manual path is the only path.
 */
export default function KalshiCard({ value, onChange }: Props) {
  const [enabled, setEnabled] = useState(value.length > 0);
  const [text, setText] = useState(value.join('\n'));

  const lines = useMemo(
    () =>
      text
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l.length > 0),
    [text],
  );

  const validated = useMemo(
    () => lines.map((l) => ({ ticker: l, valid: VALID_RE.test(l) })),
    [lines],
  );

  function commit(nextText: string) {
    setText(nextText);
    const next = nextText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .filter((l) => VALID_RE.test(l));
    onChange(next);
  }

  return (
    <GlassCard>
      <div className="space-y-3">
        <div className="flex items-start gap-3">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => {
              setEnabled(e.target.checked);
              if (!e.target.checked) onChange([]);
            }}
            className="mt-1"
          />
          <div className="flex-1">
            <div className="text-sm font-semibold" style={{ color: textPrimary }}>
              Kalshi
            </div>
            <div className="text-xs mt-0.5" style={{ color: textSecondary }}>
              Manually list Kalshi market tickers (e.g. <code>KXELONMARS-99</code>). One per line.
            </div>
          </div>
        </div>

        {enabled && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pl-7">
            <textarea
              value={text}
              onChange={(e) => commit(e.target.value)}
              rows={5}
              placeholder={'KXBTCD-99\nKXELONMARS-99'}
              className="w-full px-3 py-2.5 rounded-lg text-xs font-mono text-white outline-none resize-y"
              style={{
                background: 'rgba(255, 255, 255, 0.04)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                minHeight: 120,
              }}
            />
            <div className="space-y-1">
              {validated.length === 0 && (
                <p className="text-xs" style={{ color: textSecondary }}>
                  No tickers yet. Tickers must be uppercase, alphanumeric, with
                  optional <code>-</code> or <code>_</code>.
                </p>
              )}
              {validated.map(({ ticker, valid }) => (
                <div key={ticker} className="flex items-center gap-1.5 text-xs font-mono">
                  {valid ? (
                    <Check size={12} style={{ color: green }} />
                  ) : (
                    <X size={12} style={{ color: red }} />
                  )}
                  <span style={{ color: valid ? textPrimary : red }}>{ticker}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </GlassCard>
  );
}
