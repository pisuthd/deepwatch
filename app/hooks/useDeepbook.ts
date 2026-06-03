'use client';

/**
 * useDeepbook — DeepBook V3 trading integration.
 *
 * Thin wrapper over the official `@mysten/deepbook-v3` SDK with React state.
 * Spot trades are direct wallet-coin swaps (no BalanceManager).
 *
 * Responsibilities:
 *  - Construct the SDK client (per active network, with default pool/coin maps).
 *  - Swap via the SDK's non-manager PTB builders (sources coins from the wallet).
 *  - Read quotes for the swap UI's "to (est)" preview.
 *  - Read the user's wallet balances for the MAX button + balance display.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  SuiGrpcClient,
} from '@mysten/sui/grpc';
import {
  deepbook,
  mainnetCoins,
  mainnetPackageIds,
  mainnetPools,
  testnetCoins,
  testnetPools,
} from '@mysten/deepbook-v3';
import {
  useCurrentAccount,
  useCurrentClient,
} from '@mysten/dapp-kit-react';
import { Transaction } from '@mysten/sui/transactions';
import { useNetwork } from '../context/NetworkContext';
import { useNetworkConfig } from './useNetworkConfig';

// ─── Constants ────────────────────────────────────────────────────────────────

// The bundled `mainnetPackageIds.DEEPBOOK_PACKAGE_ID` in `@mysten/deepbook-v3`
// is a stale version. Per the official Sui docs (DeepBookV3 contract
// information), the current mainnet DeepBook package was redeployed to a new
// address; the registry, treasury, and other top-level objects stayed put.
// Override only `DEEPBOOK_PACKAGE_ID` and spread the rest from the bundled
// constants — the SDK's `deepbook()` config fully replaces the defaults when
// `packageIds` is provided (missing fields fall back to `''`), so we have to
// pass the complete object.
const MAINNET_DEEPBOOK_PACKAGE_ID_OVERRIDE =
  '0x337f4f4f6567fcd778d5454f27c16c70e2f274cc6377ea6249ddf491482ef497';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CoinBalance {
  /** Coin key as known to the SDK (e.g. 'SUI', 'USDC'). */
  coinKey: string;
  /** Human-readable amount (already divided by scalar). */
  amount: number;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useDeepbook() {
  const account = useCurrentAccount();
  const suiClient = useCurrentClient();
  const cfg = useNetworkConfig();
  const { network } = useNetwork();
  const [walletBalances, setWalletBalances] = useState<CoinBalance[]>([]);
  const [error, setError] = useState<string | null>(null);

  // SDK client (per network + account). The non-manager swap variants don't
  // need a `balanceManagers` config — they source the input coin from the
  // wallet at PTB-execution time.
  const coinTable = useMemo(
    () => (network === 'mainnet' ? mainnetCoins : testnetCoins),
    [network],
  );

  const sdk = useMemo(() => {
    if (!account) return null;
    return new SuiGrpcClient({ network, baseUrl: cfg.fullnodeGrpc }).$extend(
      deepbook({
        address: account.address,
        coins: coinTable,
        pools: network === 'mainnet' ? mainnetPools : testnetPools,
        // Override the stale bundled mainnet package ID. Only the package was
        // redeployed — registry, treasury, and the rest of the IDs in
        // `mainnetPackageIds` are still current, so we spread them and just
        // swap in the new `DEEPBOOK_PACKAGE_ID`. Testnet uses the bundled
        // defaults (no `packageIds` passed).
        ...(network === 'mainnet' && {
          packageIds: {
            ...mainnetPackageIds,
            DEEPBOOK_PACKAGE_ID: MAINNET_DEEPBOOK_PACKAGE_ID_OVERRIDE,
          },
        }),
      }),
    );
  }, [account, network, cfg.fullnodeGrpc, coinTable]);

  /**
   * Fetch the user's WALLET balances for the given coin keys (sums across
   * all coin objects of each type owned by the address). Used by the swap
   * form's MAX button and balance display.
   */
  const refreshWalletBalances = useCallback(
    async (coinKeys: string[]) => {
      if (!suiClient || !account) return;
      const out: CoinBalance[] = [];
      for (const coinKey of coinKeys) {
        const coin = (coinTable as Record<string, { type: string; scalar: number }>)[coinKey];
        if (!coin) continue;
        try {
          const res = await suiClient.listCoins({
            owner: account.address,
            coinType: coin.type,
          });
          const objs = res.objects ?? [];
          const totalRaw = objs.reduce<bigint>((acc, o) => acc + BigInt(o.balance), BigInt(0));
          const scalarNum = Number(coin.scalar);
          const amount = scalarNum > 0 ? Number(totalRaw) / scalarNum : 0;
          out.push({ coinKey, amount });
        } catch {
          /* coin type may not exist on this network; skip */
        }
      }
      setWalletBalances(out);
    },
    [suiClient, account, coinTable],
  );

  // Auto-refresh wallet balances on account/network change so the swap form
  // shows the right context as soon as the wallet connects.
  useEffect(() => {
    if (!account) {
      setWalletBalances([]);
      return;
    }
    refreshWalletBalances(['SUI', 'USDC', 'DBUSDC', 'DEEP']);
  }, [account?.address, network, refreshWalletBalances]);

  // ─── Mutators (swap PTB builders) ───────────────────────────────────────────

  /**
   * Swap an exact base amount for quote. Sources the input coin from the
   * wallet via `coinWithBalance` (run by the SDK inside the PTB), so the
   * user pays gas + the base input from their wallet.
   *
   * `deepAmount: 0` — no DEEP fee required; the runtime accepts a
   * zero-balance DEEP coin placeholder at PTB execution time.
   *
   * Returns: transfers `(baseOut, quoteOut, deepOut)` to the user so the
   * wallet popup shows a single explicit transfer of outputs (no leftover
   * coin objects).
   */
  const swapExactBaseForQuote = useCallback(
    async (
      signAndExecute: any,
      poolKey: string,
      amount: number,
      minOut: number,
    ) => {
      if (!sdk) throw new Error('SDK not initialized');
      if (!account) throw new Error('No account');
      setError(null);
      const tx = new Transaction();
      const [baseOut, quoteOut, deepOut] = tx.add(
        sdk.deepbook.deepBook.swapExactBaseForQuote({
          poolKey,
          amount,
          deepAmount: 0,
          minOut,
        }),
      );
      tx.transferObjects([baseOut, quoteOut, deepOut], account.address);
      const result = await signAndExecute({ transaction: tx });
      if (result?.FailedTransaction) {
        throw new Error(
          result.FailedTransaction.status?.error?.message ?? 'Swap failed',
        );
      }
      await refreshWalletBalances(['SUI', 'USDC', 'DBUSDC', 'DEEP']);
    },
    [sdk, account, refreshWalletBalances],
  );

  /**
   * Swap an exact quote amount for base. Same wallet-source pattern as
   * `swapExactBaseForQuote`. Outputs are transferred to the user.
   */
  const swapExactQuoteForBase = useCallback(
    async (
      signAndExecute: any,
      poolKey: string,
      amount: number,
      minOut: number,
    ) => {
      if (!sdk) throw new Error('SDK not initialized');
      if (!account) throw new Error('No account');
      setError(null);
      const tx = new Transaction();
      const [baseOut, quoteOut, deepOut] = tx.add(
        sdk.deepbook.deepBook.swapExactQuoteForBase({
          poolKey,
          amount,
          deepAmount: 0,
          minOut,
        }),
      );
      tx.transferObjects([baseOut, quoteOut, deepOut], account.address);
      const result = await signAndExecute({ transaction: tx });
      if (result?.FailedTransaction) {
        throw new Error(
          result.FailedTransaction.status?.error?.message ?? 'Swap failed',
        );
      }
      await refreshWalletBalances(['SUI', 'USDC', 'DBUSDC', 'DEEP']);
    },
    [sdk, account, refreshWalletBalances],
  );

  // ─── Quote helpers (reads) ──────────────────────────────────────────────────

  const getQuoteOut = useCallback(
    async (poolKey: string, baseQty: number) => {
      if (!sdk) return 0;
      try {
        const r = await sdk.deepbook.getQuoteQuantityOut(poolKey, baseQty);
        return Number(r.quoteOut ?? 0);
      } catch {
        return 0;
      }
    },
    [sdk],
  );

  const getBaseOut = useCallback(
    async (poolKey: string, quoteQty: number) => {
      if (!sdk) return 0;
      try {
        const r = await sdk.deepbook.getBaseQuantityOut(poolKey, quoteQty);
        return Number(r.baseOut ?? 0);
      } catch {
        return 0;
      }
    },
    [sdk],
  );

  // ─── Return ─────────────────────────────────────────────────────────────────

  return {
    sdk,
    walletBalances,
    error,
    getQuoteOut,
    getBaseOut,
    swapExactBaseForQuote,
    swapExactQuoteForBase,
    refreshWalletBalances,
  };
}
