'use client';

import { useEffect, useRef, useState } from 'react';
import { Sparkles } from 'lucide-react';
import InsightPopover from './InsightPopover';

const green = '#00E68A';
const textPrimary = '#ffffff';

/**
 * Trigger button mounted in the trailing slot of `TradeWrapper` on
 * the Spot and Predict pages. Mirrors the `PositionsButton` /
 * `AccountOverviewButton` pattern: outside-click closes, no Escape key
 * or focus trap (matching the established convention).
 *
 * The small green dot to the right of the label is a "feature beacon"
 * — always animating with `animate-pulse` — to highlight Insights as a
 * marquee feature. It is NOT a notification count badge.
 */
export default function InsightButton() {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

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
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border transition-colors hover:bg-white/5"
        style={{
          background: 'var(--color-bg-elevated)',
          borderColor: 'var(--color-border-default)',
          color: open ? green : textPrimary,
        }}
        aria-label="Insights"
      >
        <Sparkles size={14} />
        <span className="text-xs font-semibold">Insight</span>
        <span
          className="w-1.5 h-1.5 rounded-full animate-pulse"
          style={{ background: green }}
          title="New AI insights available"
        />
      </button>

      {open && <InsightPopover onClose={() => setOpen(false)} />}
    </div>
  );
}
