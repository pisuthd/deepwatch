import { useCurrentAccount } from '@mysten/dapp-kit-react';
import { dAppKit } from '../dapp-kit';

export function useWallet() {
  const account = useCurrentAccount();

  return {
    isConnected: !!account,
    account,
    disconnect: () => dAppKit.disconnectWallet(),
  };
}