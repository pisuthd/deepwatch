'use client';

import { useEffect, useRef, useState } from 'react';
import { Layers } from 'lucide-react';
import { useMargin } from '../../../hooks/useMargin';
import MarginManagerPopover from './MarginManagerPopover';

const cyan = '#3EC4C0';
const textPrimary = '#ffffff';

/**
 * Trailing button on the /app/margin page that opens the MarginManager
 * popover. Mirrors the `AccountOverviewButton` / `PositionsButton` pattern
 * from the predict page: outside-click closes, badge counts the user's
 * margin managers.
 */
export default function MarginManagerButton() {
  const { managers } = useMargin();
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

  const count = managers.length;

  return (
    <div className="relative" ref={wrapperRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border transition-colors hover:bg-white/5"
        style={{
          background: 'var(--color-bg-elevated)',
          borderColor: 'var(--color-border-default)',
          color: open ? cyan : textPrimary,
        }}
        aria-label="Margin managers"
      >
        <Layers size={14} />
        <span className="text-xs font-semibold">Managers</span>
        {count > 0 && (
          <span
            className="text-[10px] font-mono font-semibold rounded-full px-1.5 py-px min-w-[18px] text-center"
            style={{
              background: 'rgba(62, 196, 192, 0.15)',
              color: cyan,
              border: '1px solid rgba(62, 196, 192, 0.4)',
            }}
          >
            {count}
          </span>
        )}
      </button>

      {open && <MarginManagerPopover onClose={() => setOpen(false)} />}
    </div>
  );
}
