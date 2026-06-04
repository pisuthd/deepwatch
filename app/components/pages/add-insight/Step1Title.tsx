'use client';

import { useEffect, useRef, useState } from 'react';
import GlassDropdown from '../../common/GlassDropdown';
import type { InsightAsset } from '../../../lib/insights';
import StepHeader from './StepHeader';

const textPrimary = '#ffffff';
const textSecondary = '#9ca3af';

const ASSET_OPTIONS: { value: InsightAsset; label: string }[] = [
  { value: 'BTC', label: 'BTC' },
  { value: 'SUI', label: 'SUI' },
  { value: 'WAL', label: 'WAL' },
];

const inputStyle: React.CSSProperties = {
  background: 'rgba(255, 255, 255, 0.04)',
  border: '1px solid rgba(255, 255, 255, 0.08)',
};

interface Props {
  title: string;
  setTitle: (v: string) => void;
  asset: InsightAsset;
  setAsset: (v: InsightAsset) => void;
}

/**
 * Build the auto-generated default title for a given asset. Format:
 *   "{ASSET} price outlook {d MMMM yyyy}" — e.g. "BTC price outlook 4 June 2026".
 */
export function defaultInsightTitle(asset: InsightAsset, date: Date = new Date()): string {
  const formatted = date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  return `${asset} price outlook ${formatted}`;
}

/**
 * Step 1 — title + asset.
 *
 * The title is pre-filled with a sensible default ("BTC price outlook
 * 4 June 2026" on first load) and re-generates as the user switches
 * assets — until they edit the field manually, at which point the
 * user's edit is preserved. The date is frozen on first mount so the
 * title doesn't shift if the page is left open past midnight.
 */
export default function Step1Title({ title, setTitle, asset, setAsset }: Props) {
  // The date is captured once on first mount and never updated, so
  // the auto-generated title stays consistent for the whole session.
  const initialDateRef = useRef<Date>(new Date());
  // Tracks whether the user has typed into the title field. When true,
  // we stop auto-regenerating it (e.g. on asset change).
  const userEditedRef = useRef(false);

  useEffect(() => {
    if (userEditedRef.current) return;
    setTitle(defaultInsightTitle(asset, initialDateRef.current));
  }, [asset, setTitle]);

  return (
    <StepHeader
      number={1}
      title="Title & asset"
      description="A short heading for the insight. The default is auto-generated from the asset and today's date — edit it freely if you want a different angle. Pick the asset to scope the available data cards on the next steps."
    >
      <div className="space-y-6">
        <div>
          <label
            className="block text-[10px] uppercase tracking-wide mb-2"
            style={{ color: textSecondary }}
          >
            Title
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => {
              userEditedRef.current = true;
              setTitle(e.target.value);
            }}
            placeholder="BTC price outlook 4 June 2026"
            className="w-full px-4 py-3 rounded-lg text-base text-white outline-none"
            style={inputStyle}
            autoFocus
          />
        </div>

        <div>
          <label
            className="block text-[10px] uppercase tracking-wide mb-2"
            style={{ color: textSecondary }}
          >
            Asset
          </label>
          <div className="max-w-xs">
            <GlassDropdown
              options={ASSET_OPTIONS}
              value={asset}
              onChange={(v) => setAsset(v as InsightAsset)}
            />
          </div>
        </div>
      </div>
    </StepHeader>
  );
}
