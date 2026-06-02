'use client';

import { useEffect, useRef, useState } from 'react';
import { LayoutDashboard } from 'lucide-react';
import { usePredict } from '../../../hooks/usePredict';
import AccountOverviewPopover from './AccountOverviewPopover';

const cyan = '#3EC4C0';
const textPrimary = '#ffffff';

/**
 * Button that opens `AccountOverviewPopover`, mirroring the `PositionsButton`
 * pattern. Mounted in the predict page's trailing slot next to
 * `PositionsButton`. Mutual exclusion of the two popovers falls out of the
 * outside-click handler — clicking the other button closes this one.
 */
export default function AccountOverviewButton() {
  const { manager } = usePredict();
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
          color: open ? cyan : textPrimary,
        }}
        aria-label="Account overview"
      >
        <LayoutDashboard size={14} />
        <span className="text-xs font-semibold">Overview</span>
        {!!manager && (
          <span
            className="w-1.5 h-1.5 rounded-full"
            style={{ background: cyan }}
            title="Manager connected"
          />
        )}
      </button>

      {open && <AccountOverviewPopover onClose={() => setOpen(false)} />}
    </div>
  );
}
