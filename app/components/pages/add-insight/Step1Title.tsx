'use client';

import { useEffect, useRef, useState } from 'react';
import GlassDropdown from '../../common/GlassDropdown';
import { getCoinIcon } from '../../../lib/coinIcons';
import type { InsightAsset } from '../../../lib/insights';
import StepHeader from './StepHeader';

const textSecondary = '#9ca3af';

const ASSET_OPTIONS: { value: InsightAsset; label: string; icon: string }[] = [
  { value: 'BTC', label: 'Bitcoin (BTC)', icon: getCoinIcon('BTC') },
];

const DEPLOY_OPTIONS: { value: string; label: string; icon: string }[] = [
  { value: 'walrus', label: 'Walrus Mainnet via Tatum', icon: getCoinIcon('WAL') },
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
  deployTo: string;
  setDeployTo: (v: string) => void;
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
 * Step 1 — title + asset + deploy to.
 *
 * The title is pre-filled with a sensible default ("BTC price outlook
 * 4 June 2026" on first load) and re-generates as the user switches
 * assets — until they edit the field manually, at which point the
 * user's edit is preserved. The date is frozen on first mount so the
 * title doesn't shift if the page is left open past midnight.
 */
export default function Step1Title({ title, setTitle, asset, setAsset, deployTo, setDeployTo }: Props) {
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
      description="Create an insight about a specific asset. We pull live SVI data, real-time odds from Polymarket and Kalshi, then distill everything into plain language — published to Walrus for the community."
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
        <div className='grid grid-cols-2'>
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
                showValue={false}
              />
            </div>
          </div>

          <div>
            <label
              className="block text-[10px] uppercase tracking-wide mb-2"
              style={{ color: textSecondary }}
            >
              Deploy to
            </label>
            <div className="max-w-xs">
              <GlassDropdown
                options={DEPLOY_OPTIONS}
                value={deployTo}
                onChange={setDeployTo}
                showValue={false}
              />
            </div>
          </div>
        </div>


      </div>
    </StepHeader>
  );
}
