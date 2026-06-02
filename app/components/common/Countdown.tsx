'use client';

import { useEffect, useState } from 'react';
import { formatDetailedExpiry } from '../pages/predict/utils';

/**
 * Self-contained 1s ticker that re-renders only itself.
 * Used anywhere a countdown needs to update each second without
 * forcing the parent tree to re-render.
 */
export default function Countdown({ expiryMs }: { expiryMs: number }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (expiryMs <= 0) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [expiryMs]);

  if (expiryMs <= 0) return <span>—</span>;
  return <span>{formatDetailedExpiry(expiryMs, now)}</span>;
}
