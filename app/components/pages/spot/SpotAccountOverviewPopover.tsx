'use client';

import { X } from 'lucide-react';
import { useDeepbook } from '../../../hooks/useDeepbook';
import BalanceManagerContent from './BalanceManagerContent';

interface SpotAccountOverviewPopoverProps {
  onClose: () => void;
}

const green = '#00E68A';
const textPrimary = '#ffffff';
const textSecondary = '#9ca3af';

export default function SpotAccountOverviewPopover({ onClose }: SpotAccountOverviewPopoverProps) {
  const { managerId, balances } = useDeepbook();
  const assetsTracked = balances.length;

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
        <div className="flex items-center gap-2 min-w-0">
          <h3 className="text-sm font-semibold" style={{ color: textPrimary }}>
            Account Overview
          </h3>
          {!!managerId && (
            <span
              className="text-[10px] font-mono px-1.5 py-0.5 rounded"
              style={{ background: 'rgba(0,230,138,0.08)', color: green }}
            >
              Connected
            </span>
          )}
          {!!managerId && (
            <span className="text-[10px] font-mono" style={{ color: textSecondary }}>
              {assetsTracked} {assetsTracked === 1 ? 'asset' : 'assets'}
            </span>
          )}
        </div>

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
