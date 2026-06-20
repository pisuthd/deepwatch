'use client';

import { useEffect, useRef, useState } from 'react';
import { ListChecks } from 'lucide-react';
import { usePredict } from '../../../hooks/usePredict';
import PositionsPopover from './PositionsPopover';

const green = '#00E68A';
const textPrimary = '#ffffff';

export default function PositionsButton() {
  const { positions, ranges } = usePredict();
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  // Outside-click closes
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

  // Badge sums binary + range open positions.
  const count = positions.length + ranges.length;

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
        aria-label="Positions"
      >
        <ListChecks size={14} />
        <span className="text-xs font-semibold">Positions</span>
        {count > 0 && (
          <span
            className="text-[10px] font-mono font-semibold rounded-full px-1.5 py-px min-w-[18px] text-center"
            style={{
              background: 'rgba(0, 230, 138, 0.15)',
              color: green,
              border: '1px solid rgba(0, 230, 138, 0.4)',
            }}
          >
            {count}
          </span>
        )}
      </button>

      {open && <PositionsPopover onClose={() => setOpen(false)} />}
    </div>
  );
}
