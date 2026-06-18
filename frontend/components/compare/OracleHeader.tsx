import { formatDetailedExpiry } from '@/app/lib/format';
import type { ReactNode } from 'react';

interface OracleHeaderProps {
  /** Asset symbol, e.g. "BTC" (not displayed here — folded into the question). */
  asset: string;
  /** Oracle expiry in epoch ms (used to render the relative countdown). */
  expiryMs: number;
  /** Optional eyebrow row rendered on the left (e.g. "DEEPBOOK PREDICT"). */
  eyebrow?: ReactNode;
}

const textSecondary = '#9ca3af';

export default function OracleHeader({
  eyebrow,
  expiryMs,
}: OracleHeaderProps) {
  return (
    <div className="mb-3 flex items-center justify-between gap-2">
      {eyebrow}
      <span
        className="text-xs px-2 py-1 rounded shrink-0 font-mono"
        style={{
          background: 'rgba(40, 44, 60, 0.5)',
          color: textSecondary,
        }}
      >
        {formatDetailedExpiry(expiryMs)}
      </span>
    </div>
  );
}
