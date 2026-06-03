'use client';

import { X } from 'lucide-react';
import BalanceManagerContent from './BalanceManagerContent';

interface SpotAccountOverviewPopoverProps {
  onClose: () => void;
}

const textPrimary = '#ffffff';
const textSecondary = '#9ca3af';

export default function SpotAccountOverviewPopover({ onClose }: SpotAccountOverviewPopoverProps) {
  return (
    <div
      className="absolute bottom-full mb-2 right-0 z-40 w-[460px] max-h-[80vh] overflow-y-auto rounded-2xl border border-white/10"
      style={{
        background: 'rgba(26, 29, 46, 0.95)',
        backdropFilter: 'blur(20px)',
      }}
    >
      <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-white/5 to-transparent pointer-events-none" />
      <div className="absolute top-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-white/20 to-transparent pointer-events-none" />

      {/* Header */}
      <div
        className="sticky top-0 z-10 flex items-center justify-between gap-3 px-4 py-3 border-b border-white/5"
        style={{ background: 'rgba(26, 29, 46, 0.95)' }}
      >
        <h3 className="text-sm font-semibold" style={{ color: textPrimary }}>
          Account Overview
        </h3>

        <button
          onClick={onClose}
          className="w-6 h-6 rounded-md flex items-center justify-center transition-colors hover:bg-white/10"
          style={{ color: textSecondary }}
          aria-label="Close"
        >
          <X size={14} />
        </button>
      </div>

      {/* Body */}
      <div className="relative z-10 p-4">
        <BalanceManagerContent />
      </div>
    </div>
  );
}
