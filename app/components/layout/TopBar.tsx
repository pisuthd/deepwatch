'use client';

import { Search, ChevronRight } from 'lucide-react';
import { ConnectButton } from '@mysten/dapp-kit-react/ui';
import { routeMeta, type PageId } from '../../types/navigation';
import { useWallet } from '../../hooks/useWallet';

interface TopBarProps {
  activePage: PageId;
}

export default function TopBar({ activePage }: TopBarProps) {
  const { isConnected, disconnect } = useWallet();

  // Build breadcrumb: Category > Page
  const meta = routeMeta[activePage] || { category: 'DeepWatch', label: 'Overview' };
  const breadcrumbItems = [
    { label: meta.category, pageId: activePage },
    { label: meta.label, pageId: activePage },
  ];

  return (
    <div className="flex items-center h-12 px-5 bg-[var(--color-topbar-bg)] backdrop-blur-md border-b border-[var(--color-border-subtle)] shrink-0">
      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 text-sm">
        {breadcrumbItems.map((item, i) => (
          <span key={`${item.pageId}-${i}`} className="flex items-center gap-1.5">
            {i > 0 && <ChevronRight size={12} className="text-[var(--color-text-muted)]" />}
            <span
              className={`font-medium ${i === breadcrumbItems.length - 1
                  ? 'text-[var(--color-text-primary)]'
                  : 'text-[var(--color-text-muted)]'
                } transition-colors`}
            >
              {item.label}
            </span>
          </span>
        ))}
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Search */}
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[var(--color-bg-elevated)] border border-[var(--color-border-default)] text-[var(--color-text-muted)] text-sm mr-3 hover:border-accent-primary/30 transition-colors cursor-pointer">
        <Search size={14} />
        <span>Search...</span>
        <div className="flex items-center gap-1 ml-4">
          <kbd className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--color-bg-surface)] border border-[var(--color-border-default)]">
            Ctrl
          </kbd>
          <kbd className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--color-bg-surface)] border border-[var(--color-border-default)]">
            K
          </kbd>
        </div>
      </div>

      {/* Wallet Connect */}
      {isConnected ? (
        <button
          onClick={() => disconnect()}
          className="px-8 py-2 rounded-xl bg-[var(--color-bg-elevated)] border border-[var(--color-border-default)] text-[var(--color-text-primary)] text-base font-medium hover:bg-[var(--color-sidebar-hover)] transition-colors"
        >
          Disconnect
        </button>
      ) : (
        <ConnectButton className="!bg-accent-primary hover:!bg-accent-primary-hover !text-black !font-semibold rounded-xl" />
      )}
    </div>
  );
}