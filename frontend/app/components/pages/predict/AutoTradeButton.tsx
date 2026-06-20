'use client';

/**
 * AutoTradeButton — trailing button on the Predict page (sits after
 * `PositionsButton` per the approved plan).
 *
 * Opens `AutoTradePopover`, which hosts the three sliders
 * (confidence threshold, total budget, max-markets) and the live
 * preview list. On Preview, the popover hands off to
 * `AutoTradeModal` for the per-trade quote fetch + final confirm.
 *
 * Visual language matches the other trailing buttons (rounded-lg
 * border, `bg-[var(--color-bg-elevated)]`, hover white/5) so the
 * trailing slot reads as one row. The icon (`Wand2`) signals
 * "automated action", distinct from the read-only Sparkles on the AI
 * Insight button.
 *
 * Outside-click closes (same pattern as `MatchInsightButton` and
 * `PositionsButton`).
 */

import { useEffect, useRef, useState } from 'react';
import { Wand2 } from 'lucide-react';
import AutoTradePopover from './AutoTradePopover';

const green = '#00E68A';
const textPrimary = '#ffffff';
const textSecondary = '#9ca3af';

export default function AutoTradeButton() {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  // Outside-click close — mirrors `MatchInsightButton`/`PositionsButton`.
  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [open]);

  return (
    <div className="relative" ref={wrapperRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border transition-colors hover:bg-white/5"
        style={{
          background: 'var(--color-bg-elevated)',
          borderColor: 'var(--color-border-default)',
          color: open ? green : textPrimary,
        }}
        aria-label="Auto trade across AI-filtered markets"
        title="Allocate a budget across markets filtered by AI confidence"
      >
        <Wand2 size={14} style={{ color: open ? green : textSecondary }} />
        <span
          className="text-xs font-mono font-semibold uppercase tracking-wider"
          style={{ color: open ? green : textSecondary, fontSize: 11 }}
        >
          Auto
        </span>
      </button>

      {open && <AutoTradePopover onClose={() => setOpen(false)} />}
    </div>
  );
}