'use client';

import { ChevronDown, Check } from 'lucide-react';
import dynamic from 'next/dynamic';
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useCurrentAccount } from '@mysten/dapp-kit-react';
import { dAppKit } from '@/app/lib/dapp-kit';

// ConnectButton is a web component that touches `window` on mount,
// so it must stay out of the SSR bundle.
const ConnectButton = dynamic(
  () =>
    import('@mysten/dapp-kit-react/ui').then((mod) => mod.ConnectButton),
  { ssr: false }
);

const networkOptions = [
  {
    value: 'mainnet' as const,
    label: 'Mainnet',
    dotClass: 'bg-[var(--color-accent-primary)]',
  },
  { value: 'testnet' as const, label: 'Testnet', dotClass: 'bg-amber-400' },
];

export default function ConnectWallet() {
  const [isNetworkOpen, setIsNetworkOpen] = useState(false);
  // The dapp-kit's web component manages its own connection state.
  // We only show the network switcher when a wallet is actually connected.
  const currentAccount = useCurrentAccount();
  const isConnected = !!currentAccount;
  const network: 'mainnet' | 'testnet' = 'mainnet';
  const currentNetwork =
    networkOptions.find((n) => n.value === network) ?? networkOptions[0];

  return (
    <div className="flex items-center gap-2">
      {/* Network switcher (Mainnet / Testnet) — only when connected */}
      {isConnected && (
      <div className="relative z-50">
        <button
          onClick={() => setIsNetworkOpen((o) => !o)}
          className="hidden sm:flex items-center gap-2 px-3 py-2 rounded-lg border border-white/10 hover:bg-[var(--color-sidebar-hover)] transition-colors"
          style={{ background: 'rgba(26, 29, 46, 0.6)' }}
        >
          <span className={`w-2 h-2 rounded-full ${currentNetwork.dotClass}`} />
          <span className="text-xs font-semibold text-white">
            {currentNetwork.label}
          </span>
          <ChevronDown
            size={12}
            className={`text-gray-400 transition-transform ${
              isNetworkOpen ? 'rotate-180' : ''
            }`}
          />
        </button>

        <AnimatePresence>
          {isNetworkOpen && (
            <motion.div
              initial={{ opacity: 0, y: -8, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8, scale: 0.96 }}
              transition={{ duration: 0.15 }}
              className="absolute top-full right-0 mt-2 w-44 py-1 rounded-lg border border-white/10 z-50 overflow-hidden shadow-lg shadow-black/40"
              style={{ background: 'var(--color-bg-elevated)' }}
            >
              {networkOptions.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => {
                    dAppKit.switchNetwork(opt.value);
                    setIsNetworkOpen(false);
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-[var(--color-sidebar-hover)] transition-colors"
                >
                  <span
                    className={`w-2 h-2 rounded-full shrink-0 ${opt.dotClass}`}
                  />
                  <span className="text-xs font-medium text-white flex-1">
                    {opt.label}
                  </span>
                  {opt.value === network && (
                    <Check
                      size={12}
                      className="text-[var(--color-accent-primary)]"
                    />
                  )}
                </button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      )}

      {/* Connect Wallet button (dynamic, no SSR) */}
      <ConnectButton className="text-sm font-semibold rounded-xl" />
    </div>
  );
}
