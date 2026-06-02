'use client';

import { useEffect, useRef, useState } from 'react';
import { LayoutDashboard } from 'lucide-react';
import { useDeepbook } from '../../../hooks/useDeepbook';
import SpotAccountOverviewPopover from './SpotAccountOverviewPopover';

const cyan = '#3EC4C0';
const textPrimary = '#ffffff';

export default function SpotAccountOverviewButton() {
  const { managerId } = useDeepbook();
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
        {!!managerId && (
          <span
            className="w-1.5 h-1.5 rounded-full"
            style={{ background: cyan }}
            title="Manager connected"
          />
        )}
      </button>

      {open && <SpotAccountOverviewPopover onClose={() => setOpen(false)} />}
    </div>
  );
}
