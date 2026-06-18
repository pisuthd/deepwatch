'use client';

/**
 * useMargin — DeepBook v3 margin manager integration.
 *
 * Thin wrapper over the official `@mysten/deepbook-v3` SDK with React state.
 * Exposes:
 *  - managers[]: the user's MarginManagers (one per pool) — discovered by
 *    polling the MarginRegistry. Each entry has risk metrics read via devInspect.
 *  - createMarginManager(): PTB that does new_with_initializer + share +
 *    optional initial deposit, returning the new manager's address.
 *  - deposit / withdraw: base/quote.
 *  - borrow / repay: base/quote.
 *  - leveragedLong / leveragedShort: composed borrow → withdraw → swap PTBs.
 *  - leveragedPredictBet: composed borrow (DBUSDC) → withdraw → merge with
 *    user wallet DBUSDC → deposit into PredictManager → mint.
 *
 * Dynamic-manager note: the SDK's high-level helpers (borrowBase, etc.) look
 * up the manager in `sdk.deepbook.config.marginManagers` by `managerKey`. We
 * lazily register any manager the user creates/discovers so subsequent calls
 * can use those helpers.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Transaction } from '@mysten/sui/transactions';
import { useCurrentAccount } from '@mysten/dapp-kit-react';
import { useDeepbook } from './useDeepbook';
import { useNetworkConfig } from './useNetworkConfig';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface MarginManagerInfo {
  /** On-chain object id of the MarginManager shared object. */
  id: string;
  /** Pool this manager is bound to (e.g. 'SUI_DBUSDC'). */
  poolKey: string;
  /** Base asset balance (human units). */
  baseBalance: number;
  /** Quote asset balance (human units). */
  quoteBalance: number;
  /** DEEP balance (human units). */
  deepBalance: number;
  /** Borrowed base shares (human units). */
  borrowedBase: number;
  /** Borrowed quote shares (human units). */
  borrowedQuote: number;
}

export interface UseMarginReturn {
  managers: MarginManagerInfo[];
  managersByPool: Map<string, MarginManagerInfo>;
  loading: boolean;
  error: string | null;
  /** The DeepBook SDK client (from `useDeepbook().sdk`). Re-exposed so margin
   *  UI doesn't need a second `useDeepbook()` call. */
  sdk: ReturnType<typeof useDeepbook>['sdk'];
  createMarginManager: (signAndExecute: any, poolKey: string, initialDepositQuote?: number) => Promise<string>;
  depositQuote: (signAndExecute: any, managerId: string, poolKey: string, amount: number) => Promise<void>;
  withdrawQuote: (signAndExecute: any, managerId: string, poolKey: string, amount: number) => Promise<void>;
  borrowQuote: (signAndExecute: any, managerId: string, poolKey: string, amount: number) => Promise<void>;
  repayQuote: (signAndExecute: any, managerId: string, poolKey: string, amount?: number) => Promise<void>;
  /**
   * Composed leveraged-long: borrow quote → withdraw quote → swap quote→base.
   * The base ends up in the user's wallet. Borrow stays open; repay later.
   */
  leveragedLong: (signAndExecute: any, managerId: string, poolKey: string, quoteToBorrow: number, minBaseOut: number) => Promise<void>;
  /**
   * Composed leveraged-short: borrow base → withdraw base → swap base→quote.
   * The quote ends up in the user's wallet.
   */
  leveragedShort: (signAndExecute: any, managerId: string, poolKey: string, baseToBorrow: number, minQuoteOut: number) => Promise<void>;
  /**
   * Composed leveraged Predict bet: borrow quote (DBUSDC) from a MarginManager
   * → withdraw as a coin → split user-wallet DBUSDC for the collateral → merge
   * → deposit into the user's PredictManager → call the supplied
   * `buildKeyAndMint` to add the market_key + predict::mint moveCalls.
   *
   * The margin borrow stays open after this PTB — repay later from the
   * Margin page (or anywhere else that calls `repayQuote`).
   *
   * All amounts are u6 (DUSDC_SCALE = 1e6). Caller is responsible for any
   * preconditions (e.g. ensuring the user has a PredictManager).
   */
  leveragedPredictBet: (
    signAndExecute: any,
    args: {
      marginManagerId: string;
      marginPoolKey: string;
      predictPackageId: string;
      predictObjectId: string;
      predictManagerId: string;
      dusdcType: string;
      borrowU6: bigint;
      collateralU6: bigint;
      buildKeyAndMint: (tx: any) => void;
    },
  ) => Promise<void>;
  /** Insert a manager into the in-session list (e.g. after `createMarginManager`
   *  or after the user pastes an existing manager id). Idempotent by `id`. */
  addManager: (m: MarginManagerInfo) => void;
  refresh: () => Promise<void>;
  /** Internal helper used by `leveragedPredictBet`; exposed for callers that
   *  want to reuse the same compose-borrow-from-MarginManager logic. */
  ensureManagerRegistered: (managerId: string, poolKey: string) => void;
}

// ─── Hook ──────────────────────────────────────────────────────────────────

// Sui object ids are `0x` + 0–64 hex chars. We use this as a minimum shape
// check when restoring from localStorage so a corrupted row can't masquerade
// as a real manager id.
const SUI_OBJECT_ID_RE = /^0x[0-9a-fA-F]{1,64}$/;

// Per-account localStorage key. Account-scoped so a user with two wallets
// connected to this dapp doesn't see manager ids from the other.
function storageKeyFor(address: string | undefined): string | null {
  if (!address) return null;
  return `deepwatch:margin-managers:v1:${address}`;
}

// Read & validate stored managers. Returns [] for any failure (SSR, parse
// error, wrong shape) — localStorage is best-effort, never a source of truth.
function readStoredManagers(address: string | undefined): MarginManagerInfo[] {
  const key = storageKeyFor(address);
  if (!key) return [];
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is MarginManagerInfo => {
      if (!x || typeof x !== 'object') return false;
      const m = x as MarginManagerInfo;
      if (typeof m.id !== 'string' || !SUI_OBJECT_ID_RE.test(m.id)) return false;
      if (typeof m.poolKey !== 'string' || !m.poolKey) return false;
      return true;
    }).map((m) => ({
      // Coerce numeric fields — localStorage round-trip can corrupt numbers
      // (e.g. "0" vs 0) depending on how the row was written.
      id: m.id,
      poolKey: m.poolKey,
      baseBalance: Number(m.baseBalance) || 0,
      quoteBalance: Number(m.quoteBalance) || 0,
      deepBalance: Number(m.deepBalance) || 0,
      borrowedBase: Number(m.borrowedBase) || 0,
      borrowedQuote: Number(m.borrowedQuote) || 0,
    }));
  } catch (e) {
    console.warn('[useMargin] readStoredManagers failed', e);
    return [];
  }
}

function writeStoredManagers(address: string | undefined, rows: MarginManagerInfo[]): void {
  const key = storageKeyFor(address);
  if (!key || typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, JSON.stringify(rows));
  } catch (e) {
    // QuotaExceededError, etc. — log and move on, the in-memory list is
    // still the source of truth for the current session.
    console.warn('[useMargin] writeStoredManagers failed', e);
  }
}

export function useMargin(): UseMarginReturn {
  const account = useCurrentAccount();
  const { sdk } = useDeepbook();
  const cfg = useNetworkConfig();
  const predictServer = cfg.predictServer;

  // Lazy-init from localStorage so the first paint already shows persisted
  // managers — no flash of "no manager" → manager appearing. If the user
  // later connects a different wallet, the account-effect below re-hydrates.
  const [managers, setManagers] = useState<MarginManagerInfo[]>(() =>
    readStoredManagers(account?.address),
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Tracks whether the current `managers` reflects a read from localStorage
  // for the *current* account. The first persist-effect skips writing when
  // `hydrated` is false so the lazy initializer's read isn't clobbered by
  // an empty-array write before the read settles.
  const [hydrated, setHydrated] = useState(false);

  // Set of `managerKey`s we've already registered with the SDK config so
  // we don't re-register on every render. We use a `useState` of an object
  // (not `useRef`) because the React 19 types make `useRef<Set<string>>`
  // expose only `RefObject` methods — `useState` here gives us a real
  // mutable `Set` instance we can `.has()` / `.add()` directly.
  const [registered] = useState<{ set: Set<string> }>(() => ({ set: new Set() }));

  const ensureManagerRegistered = useCallback(
    (managerId: string, poolKey: string) => {
      if (!sdk) return;
      const key = `${poolKey}::${managerId}`;
      if (registered.set.has(key)) return;
      // The SDK stores margin managers by `managerKey`. The `address` is
      // the on-chain shared object id; the `poolKey` is the DeepBook pool
      // key the manager is bound to.
      const cfg = (sdk as any).deepbook?.config;
      if (cfg && cfg.marginManagers) {
        cfg.marginManagers[key] = { address: managerId, poolKey };
        registered.set.add(key);
      }
    },
    [sdk, registered],
  );

  const addManager = useCallback((m: MarginManagerInfo) => {
    setManagers((prev) => {
      if (prev.find((x) => x.id === m.id)) return prev;
      return [...prev, m];
    });
  }, []);

  // Derived: managers keyed by their poolKey. UI uses this to look up the
  // MarginManager bound to a given pool (one MM per pool, per the plan).
  const managersByPool = useMemo(() => {
    const m = new Map<string, MarginManagerInfo>();
    for (const x of managers) m.set(x.poolKey, x);
    return m;
  }, [managers]);

  // Refresh: kept as a no-op for backwards compatibility with mutation
  // callers (deposit/withdraw/borrow/repay call `await refresh()` at the end).
  // Manager discovery happens client-side via `addManager` (paste-id flow) and
  // `createMarginManager` (in-session append). There is no working on-chain
  // discovery path today; a future indexer can re-introduce one.
  const refresh = useCallback(async () => {
    if (!sdk || !account) {
      setManagers([]);
      return;
    }
    setLoading(false);
    setError(null);
  }, [sdk, account]);

  // Account change (or disconnect) → re-hydrate from localStorage. This is
  // what makes the manager survive a navigation or a wallet switch: the
  // persisted row is read back and shown without any network call.
  useEffect(() => {
    console.log('[useMargin] account change → rehydrate', { address: account?.address });
    setHydrated(false);
    setManagers(readStoredManagers(account?.address));
    setHydrated(true);
  }, [account?.address]);

  // Persist the current manager list on every mutation, but only after the
  // hydrate effect has run for the current account. This prevents the
  // initial render from clobbering a previously-stored list with the
  // lazy-initializer's empty array.
  useEffect(() => {
    if (!hydrated) return;
    writeStoredManagers(account?.address, managers);
  }, [hydrated, managers, account?.address]);

  // ─── Mutators ───────────────────────────────────────────────────────────

  const createMarginManager = useCallback(
    async (
      signAndExecute: any,
      poolKey: string,
      initialDepositQuote: number = 0,
    ): Promise<string> => {
      console.log('[useMargin.createMarginManager] called', { poolKey, hasSdk: !!sdk, hasAccount: !!account });
      if (!sdk) throw new Error('SDK not initialized');
      if (!account) throw new Error('No account');

      // Snapshot the user's manager ids BEFORE the PTB. After signing we'll
      // diff to find the new one. The gRPC `signAndExecuteTransaction` result
      // (dapp-kit-react v2) only carries `effects.bcs` — there's no parsed
      // `objectChanges` field — so the diff is the reliable discovery path.
      let beforeIds: Set<string> = new Set();
      try {
        const ids = await sdk.deepbook.getMarginManagerIdsForOwner(account.address);
        beforeIds = new Set(ids);
        console.log('[useMargin.createMarginManager] beforeIds count:', beforeIds.size);
      } catch (e) {
        console.warn('[useMargin.createMarginManager] getMarginManagerIdsForOwner(before) failed', e);
      }

      const tx = new Transaction();

      // 1. Create the manager (with initializer so we can deposit in the
      //    same PTB before sharing). The SDK helper is a thunk: call it
      //    with the tx directly to add the moveCall to the PTB.
      const { manager, initializer } = (sdk.deepbook.marginManager as any)
        .newMarginManagerWithInitializer(poolKey)(tx);
      console.log('[useMargin.createMarginManager] PTB built', { hasManager: !!manager, hasInitializer: !!initializer });

      // 2. Share the manager (must happen before any other moveCall can
      //    reference it as a shared object).
      tx.add(
        sdk.deepbook.marginManager.shareMarginManager(poolKey, manager, initializer),
      );

      console.log('[useMargin.createMarginManager] calling signAndExecuteTransaction');
      const result = await signAndExecute({ transaction: tx });
      // dapp-kit-react v2 returns `{ $kind: 'Transaction', Transaction: {...} }`
      // on success or `{ $kind: 'FailedTransaction', FailedTransaction: {...} }`
      // on failure. Unwrap the discriminated union.
      if (result?.FailedTransaction) {
        const msg = result.FailedTransaction.status?.error?.message ?? 'Create manager failed';
        console.error('[useMargin.createMarginManager] PTB failed:', msg);
        throw new Error(msg);
      }
      const txResult = result?.Transaction;
      const digest = txResult?.digest ?? '';
      console.log('[useMargin.createMarginManager] PTB success, digest:', digest);

      // 3. Diff against the post-PTB manager list to find the new id.
      let newId = '';
      try {
        const afterIds = await sdk.deepbook.getMarginManagerIdsForOwner(account.address);
        const newOnes = afterIds.filter((id) => !beforeIds.has(id));
        console.log('[useMargin.createMarginManager] afterIds count:', afterIds.length, 'new:', newOnes);
        if (newOnes.length === 1) {
          newId = newOnes[0];
        } else if (newOnes.length > 1) {
          // Multiple new managers — pick the one whose bound pool matches.
          const expectedPoolId = await sdk.deepbook.poolId(poolKey);
          for (const id of newOnes) {
            try {
              const pool = await sdk.deepbook.getMarginManagerDeepbookPool(id);
              if (pool === expectedPoolId) {
                newId = id;
                break;
              }
            } catch {
              /* skip */
            }
          }
        }
      } catch (e) {
        console.warn('[useMargin.createMarginManager] getMarginManagerIdsForOwner(after) failed', e);
      }

      console.log('[useMargin.createMarginManager] resolved new manager id:', newId, 'digest:', digest);
      if (newId) {
        ensureManagerRegistered(newId, poolKey);
        // Add to local state so the UI immediately knows about the new MM
        // without waiting for the (currently empty) off-chain indexer.
        addManager({
          id: newId,
          poolKey,
          baseBalance: 0,
          quoteBalance: 0,
          deepBalance: 0,
          borrowedBase: 0,
          borrowedQuote: 0,
        });
        console.log('[useMargin.createMarginManager] addManager called for', newId);
      } else {
        // Last-resort fallback: surface the digest so the user can still
        // paste the manager id manually via the "Use existing manager id"
        // button. Not great UX, but better than silent failure.
        console.warn('[useMargin.createMarginManager] could not resolve new id; user may need to paste it manually. Digest:', digest);
        throw new Error(
          `Margin manager created (tx ${digest.slice(0, 10)}…) but could not auto-discover its id. Paste the manager id from your wallet history.`,
        );
      }

      // Optional: kick off an initial deposit if requested. We don't call
      // it inline because we'd need a forward reference to `depositQuote`;
      // instead we just refresh and return the new id so the caller can
      // chain the deposit.
      await refresh();
      return newId;
    },
    [sdk, account, ensureManagerRegistered, addManager, refresh],
  );

  const depositQuote = useCallback(
    async (signAndExecute: any, managerId: string, poolKey: string, amount: number) => {
      if (!sdk) throw new Error('SDK not initialized');
      ensureManagerRegistered(managerId, poolKey);
      const tx = new Transaction();
      tx.add(
        sdk.deepbook.marginManager.depositQuote({
          managerKey: `${poolKey}::${managerId}`,
          amount,
        } as any),
      );
      const result = await signAndExecute({ transaction: tx });
      if (result?.FailedTransaction) {
        throw new Error(result.FailedTransaction.status?.error?.message ?? 'Deposit failed');
      }
      await refresh();
    },
    [sdk, ensureManagerRegistered, refresh],
  );

  const withdrawQuote = useCallback(
    async (signAndExecute: any, managerId: string, poolKey: string, amount: number) => {
      if (!sdk) throw new Error('SDK not initialized');
      ensureManagerRegistered(managerId, poolKey);
      const tx = new Transaction();
      const out = tx.add(
        sdk.deepbook.marginManager.withdrawQuote(`${poolKey}::${managerId}`, amount),
      );
      if (account) tx.transferObjects([out], account.address);
      const result = await signAndExecute({ transaction: tx });
      if (result?.FailedTransaction) {
        throw new Error(result.FailedTransaction.status?.error?.message ?? 'Withdraw failed');
      }
      await refresh();
    },
    [sdk, ensureManagerRegistered, refresh, account],
  );

  const borrowQuote = useCallback(
    async (signAndExecute: any, managerId: string, poolKey: string, amount: number) => {
      if (!sdk) throw new Error('SDK not initialized');
      ensureManagerRegistered(managerId, poolKey);
      const tx = new Transaction();
      tx.add(
        sdk.deepbook.marginManager.borrowQuote(`${poolKey}::${managerId}`, amount),
      );
      const result = await signAndExecute({ transaction: tx });
      if (result?.FailedTransaction) {
        throw new Error(result.FailedTransaction.status?.error?.message ?? 'Borrow failed');
      }
      await refresh();
    },
    [sdk, ensureManagerRegistered, refresh],
  );

  const repayQuote = useCallback(
    async (signAndExecute: any, managerId: string, poolKey: string, amount?: number) => {
      if (!sdk) throw new Error('SDK not initialized');
      ensureManagerRegistered(managerId, poolKey);
      const tx = new Transaction();
      tx.add(
        sdk.deepbook.marginManager.repayQuote(`${poolKey}::${managerId}`, amount),
      );
      const result = await signAndExecute({ transaction: tx });
      if (result?.FailedTransaction) {
        throw new Error(result.FailedTransaction.status?.error?.message ?? 'Repay failed');
      }
      await refresh();
    },
    [sdk, ensureManagerRegistered, refresh],
  );

  const leveragedLong = useCallback(
    async (
      signAndExecute: any,
      managerId: string,
      poolKey: string,
      quoteToBorrow: number,
      minBaseOut: number,
    ) => {
      if (!sdk) throw new Error('SDK not initialized');
      ensureManagerRegistered(managerId, poolKey);
      const tx = new Transaction();

      // 1. Borrow quote from MarginManager (credits the manager's balance).
      tx.add(sdk.deepbook.marginManager.borrowQuote(`${poolKey}::${managerId}`, quoteToBorrow));

      // 2. Withdraw that quote as a coin the swap can consume.
      const quoteCoin = tx.add(
        sdk.deepbook.marginManager.withdrawQuote(`${poolKey}::${managerId}`, quoteToBorrow),
      );

      // 3. Swap quote→base; transfer the base to the caller.
      const [baseOut, , ] = tx.add(
        sdk.deepbook.deepBook.swapExactQuoteForBase({
          poolKey,
          amount: quoteToBorrow,
          deepAmount: 0,
          minOut: minBaseOut,
        }),
      );
      // Note: `quoteCoin` is consumed by the swap; we don't need to
      // transfer it. Just transfer the base out.
      if (account) tx.transferObjects([baseOut], account.address);

      const result = await signAndExecute({ transaction: tx });
      if (result?.FailedTransaction) {
        throw new Error(result.FailedTransaction.status?.error?.message ?? 'Leveraged long failed');
      }
      await refresh();
    },
    [sdk, ensureManagerRegistered, refresh, account],
  );

  const leveragedShort = useCallback(
    async (
      signAndExecute: any,
      managerId: string,
      poolKey: string,
      baseToBorrow: number,
      minQuoteOut: number,
    ) => {
      if (!sdk) throw new Error('SDK not initialized');
      ensureManagerRegistered(managerId, poolKey);
      const tx = new Transaction();

      tx.add(sdk.deepbook.marginManager.borrowBase(`${poolKey}::${managerId}`, baseToBorrow));

      const baseCoin = tx.add(
        sdk.deepbook.marginManager.withdrawBase(`${poolKey}::${managerId}`, baseToBorrow),
      );

      const [, quoteOut, ] = tx.add(
        sdk.deepbook.deepBook.swapExactBaseForQuote({
          poolKey,
          amount: baseToBorrow,
          deepAmount: 0,
          minOut: minQuoteOut,
        }),
      );
      if (account) tx.transferObjects([quoteOut], account.address);

      const result = await signAndExecute({ transaction: tx });
      if (result?.FailedTransaction) {
        throw new Error(result.FailedTransaction.status?.error?.message ?? 'Leveraged short failed');
      }
      await refresh();
    },
    [sdk, ensureManagerRegistered, refresh, account],
  );

  // Composed leveraged Predict bet. See the `UseMarginReturn.leveragedPredictBet`
  // docs for the full PTB description.
  const leveragedPredictBet = useCallback(
    async (
      signAndExecute: any,
      args: {
        marginManagerId: string;
        marginPoolKey: string;
        predictPackageId: string;
        predictObjectId: string;
        predictManagerId: string;
        dusdcType: string;
        borrowU6: bigint;
        collateralU6: bigint;
        buildKeyAndMint: (tx: any) => void;
      },
    ) => {
      if (!sdk) throw new Error('SDK not initialized');
      if (!account) throw new Error('No account');
      ensureManagerRegistered(args.marginManagerId, args.marginPoolKey);
      const mgrKey = `${args.marginPoolKey}::${args.marginManagerId}`;
      const tx = new Transaction();

      // 1. Borrow DBUSDC into the user's MarginManager (credits internal balance).
      tx.add(sdk.deepbook.marginManager.borrowQuote(mgrKey, Number(args.borrowU6)));

      // 2. Withdraw borrowed DBUSDC as a Coin we can later merge with the
      //    user's wallet collateral.
      const borrowedCoin = tx.add(
        sdk.deepbook.marginManager.withdrawQuote(mgrKey, Number(args.borrowU6)),
      );

      // 3. Source the user's wallet DBUSDC. We do this via suix_getCoins
      //    against the JSON-RPC endpoint (stripped of the gRPC `:443` suffix
      //    to match the convention used by usePredict).
      const RPC = cfg.fullnodeGrpc.replace(/:443$/, '');
      const coinsRes = await fetch(RPC, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'suix_getCoins',
          params: [account.address, args.dusdcType],
        }),
      }).then((r) => r.json());
      const coins: any[] = coinsRes?.result?.data ?? [];
      if (!coins.length) {
        throw new Error('No DBUSDC in wallet for collateral');
      }
      // 3a. Merge all the user's DBUSDC coins into a single primary coin so
      //     we can split the exact collateral amount.
      const primaryCoin = tx.object(coins[0].coinObjectId);
      if (coins.length > 1) {
        tx.mergeCoins(
          primaryCoin,
          coins.slice(1).map((c: any) => tx.object(c.coinObjectId)),
        );
      }
      // 3b. Split out exactly the collateral amount.
      const [splitCoin] = tx.splitCoins(primaryCoin, [tx.pure.u64(args.collateralU6)]);

      // 4. Merge the user's collateral split with the borrowed coin so we
      //    can deposit the combined total into the PredictManager in one call.
      tx.mergeCoins(splitCoin, [borrowedCoin]);

      // 5. Deposit the combined (collateral + borrowed) DBUSDC into the
      //    user's PredictManager. After this moveCall, splitCoin is consumed
      //    and the PredictManager's internal balance reflects the total.
      tx.moveCall({
        target: `${args.predictPackageId}::predict_manager::deposit`,
        typeArguments: [args.dusdcType],
        arguments: [tx.object(args.predictManagerId), splitCoin],
      });

      // 6. Add the market_key + predict::mint moveCalls. The caller knows
      //    whether this is a binary (up/down) or range (lower/upper) bet
      //    and supplies the right shape.
      args.buildKeyAndMint(tx);

      const result = await signAndExecute({ transaction: tx });
      if (result?.FailedTransaction) {
        throw new Error(
          result.FailedTransaction.status?.error?.message ?? 'Leveraged predict bet failed',
        );
      }
      await refresh();
    },
    [sdk, account, ensureManagerRegistered, cfg.fullnodeGrpc, refresh],
  );

  return {
    managers,
    managersByPool,
    loading,
    error,
    sdk,
    createMarginManager,
    depositQuote,
    withdrawQuote,
    borrowQuote,
    repayQuote,
    leveragedLong,
    leveragedShort,
    leveragedPredictBet,
    addManager,
    refresh,
    ensureManagerRegistered,
  };
}
