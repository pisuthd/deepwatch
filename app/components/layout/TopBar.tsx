'use client';

import { Search, ChevronRight } from 'lucide-react';
import dynamic from 'next/dynamic';
import { useNetwork } from '../../context/NetworkContext';

const ConnectButton = dynamic(
  () =>
    import('@mysten/dapp-kit-react/ui').then(
      mod => mod.ConnectButton
    ),
  {
    ssr: false,
  }
);
import { routeMeta, type PageId } from '../../types/navigation';
import { useWallet } from '../../hooks/useWallet';

interface TopBarProps {
  activePage: PageId;
}

export default function TopBar({ activePage }: TopBarProps) {
  const { isConnected, disconnect } = useWallet();
  const { network, setNetwork } = useNetwork();

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

      {/* Network Toggle */}
      <div className="relative flex items-center gap-0 rounded-lg mr-3 bg-[var(--color-bg-elevated)] border border-[var(--color-border-default)] overflow-hidden">
        <button
          onClick={() => setNetwork('mainnet')}
          className="relative z-10 px-6 py-2 text-xs font-semibold transition-all"
        >
          <span className={network === 'mainnet' ? 'text-black' : 'text-gray-400'}>Mainnet</span>
        </button>
        <button
          onClick={() => setNetwork('testnet')}
          className="relative z-10 px-6 py-2 text-xs font-semibold transition-all"
        >
          <span className={network === 'testnet' ? 'text-black' : 'text-gray-400'}>Testnet</span>
        </button>
        {/* Sliding indicator */}
        <div
          className="absolute top-0 h-full rounded-lg transition-all duration-200"
          style={{
            width: '50%',
            background: '#00E68A',
            transform: network === 'testnet' ? 'translateX(100%)' : 'translateX(0)',
          }}
        />
      </div>

      {/* Wallet Connect */}
      {isConnected ? (
        <button
          onClick={() => disconnect()}
          className="px-8 py-2 text-sm  rounded-lg bg-[var(--color-bg-elevated)] border border-[var(--color-border-default)] text-[var(--color-text-primary)] text-base font-medium hover:bg-[var(--color-sidebar-hover)] transition-colors"
        >
          Disconnect
        </button>
      ) : (
        <ConnectButton className="text-sm !bg-accent-primary hover:!bg-accent-primary-hover !text-black !font-semibold !rounded-xl" />
      )}
    </div>
  );
}