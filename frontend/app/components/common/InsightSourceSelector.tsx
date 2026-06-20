'use client';

/**
 * InsightSourceSelector — segmented control that flips the global AI
 * insight source between `local` and `walrus`.
 *
 * Renders inline next to the Spot pill in the Compare page's FilterBar
 * (so the toggle is reachable from the same top-bar as every other
 * filter). The choice lives in `useInsightSource()` and applies to
 * every page that reads batch insights (Compare, Predict, Auto Trade).
 *
 * UX:
 *   - Two pills (Local / Walrus). Active pill is filled green; inactive
 *     is transparent.
 *   - The Local pill carries a `(N)` count badge for cached batches.
 *   - A small overflow menu (three-dot) opens "Clear local" and a
 *     tooltip popover explaining the localStorage vs Walrus tradeoff.
 *
 * The selector is intentionally read-mostly: the actual read/write
 * routing happens in the stores + hooks. This component just exposes
 * the preference.
 */

import { useEffect, useRef, useState } from 'react';
import { Database, Globe2, MoreVertical, Trash2, X } from 'lucide-react';
import { useInsightSource } from '@/app/context/InsightSourceContext';
import {
  clearLocalBatches,
  getLocalBatchCount,
} from '@/app/lib/local-insights';
import { useToast } from '@/app/context/ToastContext';

const green = '#00E68A';
const textPrimary = '#ffffff';
const textSecondary = '#9ca3af';
const textMuted = '#6b7280';

export default function InsightSourceSelector() {
  const { source, setSource } = useInsightSource();
  const { notify } = useToast();

  // SSR-safe count — `getLocalBatchCount` returns 0 on the server.
  // We mirror it into state on mount and refresh on every toggle so the
  // badge stays accurate after a save / clear.
  const [count, setCount] = useState<number>(0);
  useEffect(() => {
    setCount(getLocalBatchCount());
  }, [source]);

  const [menuOpen, setMenuOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const menuWrapRef = useRef<HTMLDivElement | null>(null);
  const helpWrapRef = useRef<HTMLDivElement | null>(null);

  // Outside-click close for the overflow menu + the help popover.
  useEffect(() => {
    if (!menuOpen && !helpOpen) return;
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      const insideMenu = menuWrapRef.current?.contains(target);
      const insideHelp = helpWrapRef.current?.contains(target);
      if (!insideMenu) setMenuOpen(false);
      if (!insideHelp) setHelpOpen(false);
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [menuOpen, helpOpen]);

  const handleClear = () => {
    clearLocalBatches();
    setCount(0);
    setMenuOpen(false);
    notify('Local insights cleared', { variant: 'info', duration: 3000 });
  };

  const isLocal = source === 'local';

  return (
    <div
      className="inline-flex items-center gap-1.5"
      title="Where AI batch insights are read from and saved to."
    >
      {/* Group label */}
      <span
        className="text-[10px] uppercase tracking-wider font-semibold"
        style={{ color: textSecondary }}
      >
        Source
      </span>

      {/* Segmented control */}
      <div
        className="inline-flex items-center rounded-lg p-0.5 gap-0.5"
        style={{
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid rgba(255,255,255,0.08)',
        }}
      >
        <Pill
          icon={<Database size={11} />}
          label="Local"
          active={isLocal}
          badge={count > 0 ? String(count) : null}
          onClick={() => setSource('local')}
          title="Read from this browser's local storage. Free and instant; cleared if you wipe browser data."
        />
        <Pill
          icon={<Globe2 size={11} />}
          label="Walrus"
          active={!isLocal}
          badge={null}
          onClick={() => setSource('walrus')}
          title="Read from Walrus via Tatum Storage API. Durable and shareable; requires Tatum credits."
        />
      </div>

      {/* Overflow menu (Clear + Help) */}
      <div className="relative" ref={menuWrapRef}>
        <button
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          className="w-6 h-6 rounded-md flex items-center justify-center transition-colors hover:bg-white/10"
          style={{ color: textSecondary }}
          aria-label="Source options"
          title="Source options"
        >
          <MoreVertical size={12} />
        </button>
        {menuOpen && (
          <div
            className="absolute right-0 top-full mt-1 w-56 rounded-lg border border-white/10 overflow-hidden z-50"
            style={{
              background: 'rgba(26, 29, 46, 0.95)',
              backdropFilter: 'blur(20px)',
            }}
            role="menu"
          >
            <button
              type="button"
              onClick={handleClear}
              disabled={count === 0}
              className="w-full px-3 py-2 text-[11px] font-semibold text-left flex items-center gap-2 transition-colors hover:bg-white/5 disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ color: textPrimary }}
              role="menuitem"
            >
              <Trash2 size={12} style={{ color: '#ef4444' }} />
              Clear local batches
              <span className="ml-auto text-[10px] font-mono" style={{ color: textMuted }}>
                {count}
              </span>
            </button>
          </div>
        )}
      </div>

      {/* Inline help popover */}
      <div className="relative" ref={helpWrapRef}>
        <button
          type="button"
          onClick={() => setHelpOpen((v) => !v)}
          className="w-6 h-6 rounded-md flex items-center justify-center transition-colors hover:bg-white/10"
          style={{ color: textSecondary }}
          aria-label="What does this mean?"
          title="What does this mean?"
        >
          ?
        </button>
        {helpOpen && (
          <div
            className="absolute right-0 top-full mt-1 w-72 rounded-lg border border-white/10 overflow-hidden z-50"
            style={{
              background: 'rgba(26, 29, 46, 0.95)',
              backdropFilter: 'blur(20px)',
            }}
            role="dialog"
          >
            <div className="absolute top-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-white/20 to-transparent pointer-events-none" />
            <div className="relative z-10 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span
                  className="text-[10px] uppercase tracking-wider font-bold"
                  style={{ color: textSecondary }}
                >
                  Source · Local vs Walrus
                </span>
                <button
                  type="button"
                  onClick={() => setHelpOpen(false)}
                  className="w-5 h-5 rounded flex items-center justify-center transition-colors hover:bg-white/10"
                  style={{ color: textSecondary }}
                  aria-label="Close"
                >
                  <X size={11} />
                </button>
              </div>
              <p
                className="text-[11px] leading-relaxed"
                style={{ color: textPrimary }}
              >
                <span style={{ color: green }}>Local</span> (current
                default on Testnet) — free, instant, browser-only. Your
                insights are saved in this browser's storage and survive
                reloads, but get cleared if you wipe site data.
              </p>
              <p
                className="text-[11px] leading-relaxed"
                style={{ color: textPrimary }}
              >
                <span style={{ color: green }}>Walrus</span> (Mainnet via
                Tatum) — durable, shareable across sessions and devices.
                Each save uses Tatum credits, so we top up periodically;
                if credits run out, saves will fail until the next top-up.
              </p>
              <p
                className="text-[10px] leading-relaxed"
                style={{ color: textMuted }}
              >
                Stick with <strong style={{ color: textSecondary }}>Local</strong> while the
                dapp is on Testnet. Switch to{' '}
                <strong style={{ color: textSecondary }}>Walrus</strong> once we migrate the
                default to Mainnet.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Pill({
  icon,
  label,
  active,
  badge,
  onClick,
  title,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  badge: string | null;
  onClick: () => void;
  title: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors inline-flex items-center gap-1.5"
      style={{
        background: active ? green : 'transparent',
        color: active ? '#000' : textSecondary,
      }}
      aria-pressed={active}
    >
      {icon}
      {label}
      {badge && (
        <span
          className="text-[10px] font-mono px-1 rounded"
          style={{
            background: active ? 'rgba(0,0,0,0.18)' : 'rgba(255,255,255,0.06)',
            color: active ? '#000' : textSecondary,
          }}
        >
          {badge}
        </span>
      )}
    </button>
  );
}