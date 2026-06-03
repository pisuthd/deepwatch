'use client';

import { ChevronRight, ChevronDown, Check } from 'lucide-react';
import dynamic from 'next/dynamic';
import { useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
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
  const [isNetworkOpen, setIsNetworkOpen] = useState(false);
  const networkRef = useRef<HTMLDivElement>(null);

  const networkOptions = [
    { value: 'mainnet' as const, label: 'Mainnet', dotClass: 'bg-[var(--color-accent-primary)]' },
    { value: 'testnet' as const, label: 'Testnet', dotClass: 'bg-amber-400' },
  ];
  const currentNetwork = networkOptions.find((n) => n.value === network) ?? networkOptions[0];

  const meta = routeMeta[activePage] || { category: 'DeepWatch', label: 'Overview' };
  const breadcrumbItems = [
    { label: meta.category, pageId: activePage },
    { label: meta.label, pageId: activePage },
  ];

  return (
    <div className="flex items-center h-12 px-5 bg-[var(--color-topbar-bg)] backdrop-blur-md border-b border-[var(--color-border-subtle)] shrink-0 relative z-50">
      <div className="flex items-center gap-1.5 text-sm">
        {breadcrumbItems.map((item, i) => (
          <span key={`${item.pageId}-${i}`} className="flex items-center gap-1.5">
            {i > 0 && <ChevronRight size={12} className="text-[var(--color-text-muted)]" />}
            <span className={`font-medium ${i === breadcrumbItems.length - 1 ? 'text-[var(--color-text-primary)]' : 'text-[var(--color-text-muted)]'} transition-colors`}>
              {item.label}
            </span>
          </span>
        ))}
      </div>

      <div className="flex-1" />

      <div ref={networkRef} className="relative mr-3 z-50">
        <button
          onClick={() => setIsNetworkOpen((o) => !o)}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[var(--color-bg-elevated)] border border-[var(--color-border-default)] hover:bg-[var(--color-sidebar-hover)] transition-colors"
        >
          <span className={`w-2 h-2 rounded-full ${currentNetwork.dotClass}`} />
          <span className="text-xs font-semibold text-[var(--color-text-primary)]">{currentNetwork.label}</span>
          <ChevronDown
            size={12}
            className={`text-[var(--color-text-muted)] transition-transform ${isNetworkOpen ? 'rotate-180' : ''}`}
          />
        </button>

        <AnimatePresence>
          {isNetworkOpen && (
            <motion.div
              initial={{ opacity: 0, y: -8, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8, scale: 0.96 }}
              transition={{ duration: 0.15 }}
              className="absolute top-full right-0 mt-2 w-44 py-1 rounded-lg bg-[var(--color-bg-elevated)] border border-[var(--color-border-default)] z-50 overflow-hidden shadow-lg shadow-black/20"
            >
              {networkOptions.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => {
                    setNetwork(opt.value);
                    setIsNetworkOpen(false);
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-[var(--color-sidebar-hover)] transition-colors"
                >
                  <span className={`w-2 h-2 rounded-full shrink-0 ${opt.dotClass}`} />
                  <span className="text-xs font-medium text-[var(--color-text-primary)] flex-1">{opt.label}</span>
                  {opt.value === network && (
                    <Check size={12} className="text-[var(--color-accent-primary)]" />
                  )}
                </button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {isConnected ? (
        <button onClick={() => disconnect()} className="px-8 py-2 text-sm rounded-lg bg-[var(--color-bg-elevated)] border border-[var(--color-border-default)] text-[var(--color-text-primary)] font-medium hover:bg-[var(--color-sidebar-hover)] transition-colors">
          Disconnect
        </button>
      ) : (
        <ConnectButton className="text-sm !bg-accent-primary hover:!bg-accent-primary-hover !text-black !font-semibold !rounded-xl" />
      )}
    </div>
  );
}