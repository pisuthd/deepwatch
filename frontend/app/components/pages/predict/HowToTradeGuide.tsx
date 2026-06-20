'use client';

import { Info } from 'lucide-react';
import GlassCard from '../../common/GlassCard';

const textPrimary = '#ffffff';
const textSecondary = '#9ca3af';
const green = '#00E68A';

// Single flowing paragraph that summarises all six points — clamped to
// 2 lines so the card stays ~50–60px tall, well under the previous
// 100px. The six distinct "bullets" have been collapsed into one
// readable sentence.
export default function HowToTradeGuide() {
  return (
    <GlassCard className="px-3 py-2 flex flex-col gap-1 overflow-hidden">
      <div
        className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide"
        style={{ color: textSecondary }}
      >
        <Info size={10} style={{ color: green }} />
        <span>How to trade</span>
      </div>

      <p
        className="text-xs leading-snug line-clamp-2"
        style={{ color: textPrimary }}
      >
        Trade in <strong>Simple</strong> for pre-defined strikes,{' '}
        <strong>Advanced</strong> to drag the strike line and pick UP or
        DOWN, or <strong>Range</strong> to set upper/lower bounds. Tap{' '}
        <strong>AI insights</strong> if you're undecided. Settles at
        expiry on the oracle price — redeem anytime at the mark or wait.
      </p>
    </GlassCard>
  );
}
