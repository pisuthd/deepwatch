'use client';

/**
 * useDeepbook — DeepBook V3 trading integration.
 *
 * Wraps the official `@mysten/deepbook-v3` SDK with React state.
 * One BalanceManager per wallet, persisted to localStorage keyed by address.
 *
 * Responsibilities:
 *  - Construct the SDK client (per active network, with default pool/coin maps).
 *  - Track the user's BalanceManager ID; surface "Create" CTA when missing.
 *  - CRUD on the BalanceManager (create / deposit / withdraw) via PTBs.
 *  - Swap + place / cancel orders via SDK PTB builders.
 *  - Poll open orders across all known pools every 5s.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  SuiGrpcClient,
} from '@mysten/sui/grpc';
import {
  deepbook,
  mainnetCoins,
  mainnetPools,
  testnetCoins,
  testnetPools,
} from '@mysten/deepbook-v3';
import {
  useCurrentAccount,
  useCurrentClient,
} from '@mysten/dapp-kit-react';
import { Transaction, coinWithBalance } from '@mysten/sui/transactions';
import { useNetwork } from '../context/NetworkContext';
import { useNetworkConfig } from './useNetworkConfig';

// ─── Constants ────────────────────────────────────────────────────────────────

const MANAGER_KEY = 'MAIN';
const STORAGE_PREFIX = 'deepwatch-bm-';
const POLL_INTERVAL_MS = 5_000;

const TESTNET_DEEPBOOK_PACKAGE =
  '0x22be4cade64bf2d02412c7e8d0e8beea2f78828b948118d46735315409371a3c';
const MAINNET_DEEPBOOK_PACKAGE =
  '0x0e735f8c93a95722efd73521aca7a7652c0bb71ed1daf41b26dfd7d1ff71f748';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface OpenOrder {
  orderId: string;
  poolKey: string;
  price: number;
  quantity: number;
  filledQuantity: number;
  isBid: boolean;
}

export interface CoinBalance {
  /** Coin key as known to the SDK (e.g. 'SUI', 'USDC'). */
  coinKey: string;
  /** Human-readable amount (already divided by scalar). */
  amount: number;
}

// ─── Local-storage helpers ────────────────────────────────────────────────────

// Manager IDs are stored per (network, address) so that switching networks
// doesn't leak a testnet BM into the mainnet UI (and vice versa).
function storageKey(network: string, address: string): string {
  return `${STORAGE_PREFIX}${network}-${address}`;
}

function readStoredManagerId(network: string, address: string | null | undefined): string | null {
  if (!address || typeof window === 'undefined') return null;
  return window.localStorage.getItem(storageKey(network, address));
}

function writeStoredManagerId(network: string, address: string, managerId: string) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(storageKey(network, address), managerId);
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useDeepbook() {
  const account = useCurrentAccount();
  const suiClient = useCurrentClient();
  const cfg = useNetworkConfig();
  const { network } = useNetwork();
  const [managerId, setManagerId] = useState<string | null>(() =>
    readStoredManagerId(network, account?.address),
  );
  const [openOrders, setOpenOrders] = useState<OpenOrder[]>([]);
  const [balances, setBalances] = useState<CoinBalance[]>([]);
  const [walletBalances, setWalletBalances] = useState<CoinBalance[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-hydrate managerId when either the account OR the network changes.
  // The localStorage key is per-(network, address), so a network switch
  // loads the manager that was created on THAT network (or null if none).
  useEffect(() => {
    setManagerId(readStoredManagerId(network, account?.address));
    setBalances([]);
    setWalletBalances([]);
    setOpenOrders([]);
  }, [account?.address, network]);

  // SDK client (per network, per account, per manager)
  const coinTable = useMemo(
    () => (network === 'mainnet' ? mainnetCoins : testnetCoins),
    [network],
  );

  const sdk = useMemo(() => {
    if (!account) return null;
    const balanceManagers: Record<string, { address: string; tradeCap: string }> = {};
    if (managerId) {
      balanceManagers[MANAGER_KEY] = { address: managerId, tradeCap: '' };
    }
    return new SuiGrpcClient({ network, baseUrl: cfg.fullnodeGrpc }).$extend(
      deepbook({
        address: account.address,
        balanceManagers,
        coins: coinTable,
        pools: network === 'mainnet' ? mainnetPools : testnetPools,
      }),
    );
  }, [account, managerId, network, cfg.fullnodeGrpc, coinTable]);

  /**
   * Resolve a coin key (e.g. 'SUI', 'USDC') to the full Move type and decimal
   * scalar. Returns null when the key is unknown on the active network.
   */
  const resolveCoin = useCallback(
    (coinKey: string): { type: string; scalar: number; decimals: number } | null => {
      const coin = (coinTable as Record<string, { type: string; scalar: number }>)[coinKey];
      if (!coin) return null;
      // Derive decimals from the scalar's magnitude: SUI scalar = 1e9 (9 dec),
      // USDC scalar = 1e6 (6 dec), etc.
      const decimals = Math.max(0, Math.round(Math.log10(coin.scalar)));
      return { type: coin.type, scalar: coin.scalar, decimals };
    },
    [coinTable],
  );

  const deepbookPackageId =
    network === 'mainnet' ? MAINNET_DEEPBOOK_PACKAGE : TESTNET_DEEPBOOK_PACKAGE;

  // ─── Polling ────────────────────────────────────────────────────────────────

  const refreshData = useCallback(async () => {
    if (!sdk || !account || !managerId) {
      setOpenOrders([]);
      setBalances([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const poolKeys = Object.keys(network === 'mainnet' ? mainnetPools : testnetPools);
      const orders: OpenOrder[] = [];
      // Open orders across all known pools
      await Promise.all(
        poolKeys.map(async (poolKey) => {
          try {
            const ids = await sdk.deepbook.accountOpenOrders(poolKey, MANAGER_KEY);
            for (const orderId of ids) {
              try {
                const o = await sdk.deepbook.getOrderNormalized(poolKey, orderId);
                orders.push({
                  orderId,
                  poolKey,
                  price: (o as any).normalized_price ?? (o as any).price ?? 0,
                  quantity: Number((o as any).quantity ?? 0),
                  filledQuantity: Number((o as any).filled_quantity ?? 0),
                  isBid: Boolean((o as any).is_bid),
                });
              } catch {
                /* skip individual order errors */
              }
            }
          } catch {
            /* skip pool-level errors */
          }
        }),
      );
      setOpenOrders(orders);
    } catch (e: any) {
      console.error('Failed to refresh open orders:', e);
      setError(e?.message ?? 'Failed to refresh');
    } finally {
      setLoading(false);
    }
  }, [sdk, account, managerId, network]);

  useEffect(() => {
    refreshData();
    const id = setInterval(refreshData, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [refreshData]);

  // Fetch balances (lightweight: query a fixed set of common coins)
  const refreshBalances = useCallback(
    async (coinKeys: string[]) => {
      if (!sdk || !account || !managerId) return;
      const out: CoinBalance[] = [];
      for (const coinKey of coinKeys) {
        try {
          const r = await sdk.deepbook.checkManagerBalance(MANAGER_KEY, coinKey);
          out.push({ coinKey, amount: Number((r as any).balance ?? 0) });
        } catch {
          /* coin may not be in the SDK's coin map; skip */
        }
      }
      setBalances(out);
    },
    [sdk, account, managerId],
  );

  /**
   * Fetch the user's WALLET balances for the given coin keys (sums across
   * all coin objects of each type owned by the address). This is what the
   * user can deposit into the manager. Independent of `managerId` — works
   * before the manager is created.
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
          // Convert raw amount to human units using the SDK scalar.
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

  // Auto-refresh wallet balances on account/network change so the popover
  // shows the right context even before a manager is created.
  useEffect(() => {
    if (!account) {
      setWalletBalances([]);
      return;
    }
    refreshWalletBalances(['SUI', 'USDC', 'DBUSDC', 'DEEP']);
  }, [account?.address, network, refreshWalletBalances]);

  // Auto-discover: if the user has no localStorage entry for this (network,
  // address) pair, fall back to the on-chain registry so they don't see a
  // false "Create" CTA when they already have a manager on this network.
  useEffect(() => {
    if (!sdk || !account || managerId !== null) return;
    let cancelled = false;
    (async () => {
      try {
        const ids = await sdk.deepbook.getBalanceManagerIds(account.address);
        if (cancelled || !ids.length) return;
        const discovered = ids[ids.length - 1];
        writeStoredManagerId(network, account.address, discovered);
        setManagerId(discovered);
      } catch {
        /* fall through to the manual create flow */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sdk, account, managerId, network]);

  // ─── Mutators ───────────────────────────────────────────────────────────────

  /** Create a new BalanceManager owned by `account`. Stores the new ID. */
  const createManager = useCallback(
    async (signAndExecute: any) => {
      if (!account || !sdk) throw new Error('No account or SDK');
      setError(null);
      const tx = new Transaction();
      tx.add(sdk.deepbook.balanceManager.createAndShareBalanceManager());
      const result = await signAndExecute({ transaction: tx });
      if (result?.FailedTransaction) {
        throw new Error(
          result.FailedTransaction.status?.error?.message ?? 'Create failed',
        );
      }
      // Locate the newly-shared BalanceManager from the transaction's effects.
      // DeepBook's `createAndShareBalanceManager` produces a SHARED object, so
      // the only newly-created object in `changedObjects` (with the
      // `Shared` output owner) IS the manager — no need to wait for the
      // indexer to catch up via `getBalanceManagerIds` (which has eventual
      // consistency issues immediately after the tx).
      const txResult = result?.Transaction;
      const changed: any[] = txResult?.effects?.changedObjects ?? [];
      const shared = changed.find(
        (o: any) => o?.idOperation === 'Created' && o?.outputOwner?.$kind === 'Shared',
      );
      let newId: string | undefined = shared?.objectId;

      // Fallback: poll getBalanceManagerIds (in case the wallet didn't return
      // effects, or for any non-gRPC client path).
      if (!newId) {
        for (let attempt = 0; attempt < 6; attempt++) {
          const ids = await sdk.deepbook.getBalanceManagerIds(account.address);
          if (ids.length) {
            // Pick the most recently created (last in the list, since the SDK
            // returns them in chronological order).
            newId = ids[ids.length - 1];
            break;
          }
          await new Promise((r) => setTimeout(r, 500));
        }
      }

      if (!newId) {
        throw new Error('Manager was created but could not be located');
      }
      writeStoredManagerId(network, account.address, newId);
      setManagerId(newId);
      await refreshData();
      await refreshWalletBalances(['SUI', 'USDC', 'DBUSDC', 'DEEP']);
    },
    [account, sdk, refreshData, refreshWalletBalances, network],
  );

  /**
   * Deposit `amount` of `coinKey` (human units) into the user's BalanceManager.
   *
   * Uses the canonical `coinWithBalance` helper from `@mysten/sui/transactions`.
   * This is the same pattern the official `@mysten/deepbook-v3` SDK's
   * `depositIntoManager` uses internally: at PTB-build time, the runtime
   * sources a `Coin<T>` of the requested balance from the user's wallet,
   * pulling from existing coin objects WITHOUT touching the gas coin. The
   * earlier manual `mergeCoins(primary, rest)` approach consumed every SUI
   * coin the user owned (including the one the wallet needed to pay gas),
   * which surfaced as a "no valid gas coin" failure.
   */
  const deposit = useCallback(
    async (signAndExecute: any, coinKey: string, amount: number) => {
      if (!account || !managerId) throw new Error('No account or manager');
      const coin = resolveCoin(coinKey);
      if (!coin) throw new Error(`Unknown coin: ${coinKey}`);
      setError(null);
      const amountBig = BigInt(Math.round(amount * coin.scalar));

      const tx = new Transaction();
      tx.moveCall({
        target: `${deepbookPackageId}::balance_manager::deposit`,
        typeArguments: [coin.type],
        arguments: [
          tx.object(managerId),
          coinWithBalance({ type: coin.type, balance: amountBig }),
        ],
      });
      const result = await signAndExecute({ transaction: tx });
      if (result?.FailedTransaction) {
        throw new Error(result.FailedTransaction.status?.error?.message ?? 'Deposit failed');
      }
      await refreshData();
      await refreshBalances([coinKey]);
      await refreshWalletBalances([coinKey]);
    },
    [
      account,
      managerId,
      deepbookPackageId,
      refreshData,
      refreshBalances,
      refreshWalletBalances,
      resolveCoin,
    ],
  );

  /**
   * Withdraw `amount` of `coinKey` (human units) from the user's BalanceManager
   * to their wallet.
   */
  const withdraw = useCallback(
    async (signAndExecute: any, coinKey: string, amount: number) => {
      if (!account || !managerId) throw new Error('No account or manager');
      const coin = resolveCoin(coinKey);
      if (!coin) throw new Error(`Unknown coin: ${coinKey}`);
      setError(null);
      const amountBig = BigInt(Math.round(amount * coin.scalar));
      const tx = new Transaction();
      const [withdrawnCoin] = tx.moveCall({
        target: `${deepbookPackageId}::balance_manager::withdraw`,
        typeArguments: [coin.type],
        arguments: [tx.object(managerId), tx.pure.u64(amountBig)],
      });
      tx.transferObjects([withdrawnCoin], account.address);
      const result = await signAndExecute({ transaction: tx });
      if (result?.FailedTransaction) {
        throw new Error(result.FailedTransaction.status?.error?.message ?? 'Withdraw failed');
      }
      await refreshData();
      await refreshBalances([coinKey]);
    },
    [account, managerId, deepbookPackageId, refreshData, refreshBalances, resolveCoin],
  );

  // ─── Trading PTB helpers (mutators) ─────────────────────────────────────────

  const swapExactBaseForQuote = useCallback(
    async (
      signAndExecute: any,
      poolKey: string,
      amount: number,
      minOut: number,
    ) => {
      if (!sdk) throw new Error('SDK not initialized');
      setError(null);
      const tx = new Transaction();
      tx.add(
        sdk.deepbook.deepBook.swapExactBaseForQuote({
          poolKey,
          amount,
          deepAmount: 0,
          minOut,
        }),
      );
      const result = await signAndExecute({ transaction: tx });
      if (result?.FailedTransaction) {
        throw new Error(result.FailedTransaction.status?.error?.message ?? 'Swap failed');
      }
      await refreshData();
    },
    [sdk, refreshData],
  );

  const swapExactQuoteForBase = useCallback(
    async (
      signAndExecute: any,
      poolKey: string,
      amount: number,
      minOut: number,
    ) => {
      if (!sdk) throw new Error('SDK not initialized');
      setError(null);
      const tx = new Transaction();
      tx.add(
        sdk.deepbook.deepBook.swapExactQuoteForBase({
          poolKey,
          amount,
          deepAmount: 0,
          minOut,
        }),
      );
      const result = await signAndExecute({ transaction: tx });
      if (result?.FailedTransaction) {
        throw new Error(result.FailedTransaction.status?.error?.message ?? 'Swap failed');
      }
      await refreshData();
    },
    [sdk, refreshData],
  );

  const placeLimitOrder = useCallback(
    async (
      signAndExecute: any,
      poolKey: string,
      price: number,
      quantity: number,
      isBid: boolean,
    ) => {
      if (!sdk) throw new Error('SDK not initialized');
      setError(null);
      const tx = new Transaction();
      tx.add(
        sdk.deepbook.deepBook.placeLimitOrder({
          poolKey,
          balanceManagerKey: MANAGER_KEY,
          clientOrderId: `${Date.now()}`,
          price,
          quantity,
          isBid,
        }),
      );
      const result = await signAndExecute({ transaction: tx });
      if (result?.FailedTransaction) {
        throw new Error(result.FailedTransaction.status?.error?.message ?? 'Order failed');
      }
      await refreshData();
    },
    [sdk, refreshData],
  );

  const placeMarketOrder = useCallback(
    async (
      signAndExecute: any,
      poolKey: string,
      quantity: number,
      isBid: boolean,
    ) => {
      if (!sdk) throw new Error('SDK not initialized');
      setError(null);
      const tx = new Transaction();
      tx.add(
        sdk.deepbook.deepBook.placeMarketOrder({
          poolKey,
          balanceManagerKey: MANAGER_KEY,
          clientOrderId: `${Date.now()}`,
          quantity,
          isBid,
        }),
      );
      const result = await signAndExecute({ transaction: tx });
      if (result?.FailedTransaction) {
        throw new Error(result.FailedTransaction.status?.error?.message ?? 'Order failed');
      }
      await refreshData();
    },
    [sdk, refreshData],
  );

  const cancelOrder = useCallback(
    async (signAndExecute: any, poolKey: string, orderId: string) => {
      if (!sdk) throw new Error('SDK not initialized');
      setError(null);
      const tx = new Transaction();
      tx.add(sdk.deepbook.deepBook.cancelOrder(poolKey, MANAGER_KEY, orderId));
      const result = await signAndExecute({ transaction: tx });
      if (result?.FailedTransaction) {
        throw new Error(result.FailedTransaction.status?.error?.message ?? 'Cancel failed');
      }
      await refreshData();
    },
    [sdk, refreshData],
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
    managerId,
    openOrders,
    balances,
    walletBalances,
    loading,
    error,
    sdk,
    createManager,
    deposit,
    withdraw,
    swapExactBaseForQuote,
    swapExactQuoteForBase,
    placeLimitOrder,
    placeMarketOrder,
    cancelOrder,
    getQuoteOut,
    getBaseOut,
    refreshData,
    refreshBalances,
    refreshWalletBalances,
  };
}
