'use client'

import { useState, useEffect, useCallback } from 'react'
import { useCurrentAccount, useCurrentClient } from '@mysten/dapp-kit-react'
import { bcs } from '@mysten/sui/bcs'
import { useNetworkConfig } from './useNetworkConfig'

export const PRICE_SCALE = BigInt('1000000000')
export const DUSDC_SCALE = BigInt('1000000')
const CLOCK = '0x6'

export interface ManagerData {
  manager_id: string
  owner: string
  balance?: string
}

export interface ManagerSummary {
  owner: string
  balances: { balance: string; coin_type: string }[]
  trading_balance: number
  redeemable_value: number
  open_exposure: number
  realized_pnl: number
  unrealized_pnl: number
  account_value: number
  open_positions: number
  awaiting_settlement_positions: number
}

export interface Position {
  oracle_id: string
  expiry: number
  strike: string
  is_up: boolean
  open_quantity: string
  average_entry_price: string
  mark_price: string | null
  unrealized_pnl: string
  underlying_asset: string
  first_minted_at?: number
  status?: 'active' | 'redeemable' | 'lost' | 'awaiting_settlement'
}

export interface RangePosition {
  oracle_id: string
  underlying_asset?: string
  expiry: number
  /** PRICE_SCALE = 1e9 scaled integer string. */
  lower_strike: string
  /** PRICE_SCALE = 1e9 scaled integer string. */
  higher_strike: string
  /** DUSDC_SCALE = 1e6 scaled integer string. */
  open_quantity: string
  average_entry_price?: string
  mark_price?: string | null
  unrealized_pnl?: string
  status?: 'active' | 'redeemable' | 'lost' | 'awaiting_settlement'
  first_minted_at?: number
}

export interface AskBounds {
  lower: string
  upper: string
  ask: string
  bid: string
}

export interface TradeQuote {
  cost: number    // Mint cost per $1 face value (e.g., $0.60)
  redeem: number  // Redeem price per $1 face value (e.g., $0.55)
  premium: number // Fee/premium (e.g., $0.05)
}

export interface RangeQuote {
  cost: number    // Mint cost in DUSDC for the range position
  payout: number  // Payout if the range wins (in DUSDC)
}

// Helper to call Sui RPC. `rpcUrl` should be a JSON-RPC endpoint (port optional).
async function suiRpcCall(rpcUrl: string, method: string, params: any): Promise<any> {
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method,
      params,
    }),
  })
  return response.json()
}

/**
 * GET a URL and parse it as JSON, gracefully handling:
 *   - non-2xx HTTP responses (the predict indexer occasionally 500s)
 *   - non-JSON bodies (HTML error pages, gateway intercepts, etc.)
 *   - network failures
 *
 * Returns `null` on any error and logs a single descriptive message that
 * includes the status code and a short body excerpt — much more actionable
 * than the cryptic `SyntaxError: Unexpected token 'I', "Internal e"...`
 * you get from letting `res.json()` throw on a non-JSON body.
 */
async function safeJsonGet<T>(url: string, label: string): Promise<T | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) {
      const body = await res.text().catch(() => '<unreadable>');
      console.warn(
        `[predict] ${label}: ${res.status} ${res.statusText} — ${body.slice(0, 200)}`,
      );
      return null;
    }
    return (await res.json()) as T;
  } catch (e: any) {
    console.warn(`[predict] ${label} failed:`, e?.message ?? e);
    return null;
  }
}

// Convert human DUSDC string ("1.234567") to u6 bigint (1234567n) without
// losing precision past 2 dp. Integer math via string split.
function toDusdcUnits(amount: string): bigint {
  const [whole, frac = ''] = (amount || '').split('.')
  const fracPadded = (frac + '000000').slice(0, 6)
  return BigInt(whole || '0') * DUSDC_SCALE + BigInt(fracPadded || '0')
}

// Helper: fetch + merge the user's DUSDC coins into a single primary object
// inside an existing PTB. Returns [splitCoin, primaryCoin]. Throws if the
// wallet has no DBUSDC. Used by every path that deposits or merges.
async function addCoinMergeAndSplit(
  tx: any,
  account: { address: string },
  rpcUrl: string,
  dusdcType: string,
  amount: bigint,
) {
  const coinsResult = await suiRpcCall(rpcUrl, 'suix_getCoins', [account.address, dusdcType])
  if (!coinsResult.result?.data?.length) {
    throw new Error('No DBUSDC found in wallet')
  }
  const coins = coinsResult.result.data
  const primaryCoin = tx.object(coins[0].coinObjectId)
  if (coins.length > 1) {
    tx.mergeCoins(primaryCoin, coins.slice(1).map((c: any) => tx.object(c.coinObjectId)))
  }
  const [splitCoin] = tx.splitCoins(primaryCoin, [tx.pure.u64(amount)])
  return splitCoin
}

interface UsePredictReturn {
  manager: ManagerData | null
  summary: ManagerSummary | null
  positions: Position[]
  ranges: RangePosition[]
  mintPrice: { up: number; down: number } | null
  walletDusdcBalance: bigint
  loading: boolean
  error: string | null
  createManager: (signAndExecute: any) => Promise<void>
  deposit: (signAndExecute: any, amount: string) => Promise<void>
  withdraw: (signAndExecute: any, amount: string) => Promise<void>
  /**
   * Mint a directional position. Smart-fallback flow:
   *  - No manager → returns `{ needsManager: true }`; caller must use
   *    `createManagerAndMint` instead.
   *  - Manager exists, balance < amount → chains a `predict_manager::deposit`
   *    from the wallet DBUSDC into the same PTB.
   *  - Manager exists, balance ≥ amount → single `predict::mint`.
   */
  mint: (signAndExecute: any, oracleId: string, expiryMs: number, strike: number, direction: 'up' | 'down', amount: number) => Promise<{ needsManager: true } | { success: true }>
  /**
   * Mint a directional position when no manager exists yet. Single PTB:
   * `create_manager` → `predict_manager::deposit` → `market_key::up|down` →
   * `predict::mint`. Single wallet signature.
   */
  createManagerAndMint: (signAndExecute: any, oracleId: string, expiryMs: number, strike: number, direction: 'up' | 'down', amount: number) => Promise<void>
  /** Range-mode counterpart of `mint`. */
  mintRange: (signAndExecute: any, oracleId: string, expiryMs: number, lower: number, higher: number, amount: number) => Promise<{ needsManager: true } | { success: true }>
  /** Range-mode counterpart of `createManagerAndMint`. */
  createManagerAndMintRange: (signAndExecute: any, oracleId: string, expiryMs: number, lower: number, higher: number, amount: number) => Promise<void>
  redeem: (signAndExecute: any, oracleId: string, expiryMs: number, strike: number, direction: 'up' | 'down', quantity: number, settled: boolean) => Promise<void>
  /** Redeem a range position. `settled=true` switches to the permissionless variant. */
  redeemRange: (signAndExecute: any, oracleId: string, expiryMs: number, lower: number, higher: number, quantity: number, settled: boolean) => Promise<void>
  fetchMintPrice: (oracleId: string, strike: number) => void
  refreshData: () => Promise<void>
  getTradeQuote: (oracleId: string, expiryMs: number, strike: number, direction: 'up' | 'down', quantity: number) => Promise<TradeQuote | null>
  getRangeQuote: (oracleId: string, expiryMs: number, lower: number, higher: number, quantity: number) => Promise<RangeQuote | null>
}

export function usePredict(): UsePredictReturn {
  const account = useCurrentAccount()
  const client = useCurrentClient()
  const cfg = useNetworkConfig();
  // JSON-RPC endpoint: strip the gRPC ":443" port suffix if present.
  const RPC = cfg.fullnodeGrpc.replace(/:443$/, '');
  const SERVER = cfg.predictServer; // null on mainnet — handled below
  const [manager, setManager] = useState<ManagerData | null>(null)
  const [summary, setSummary] = useState<ManagerSummary | null>(null)
  const [positions, setPositions] = useState<Position[]>([])
  const [ranges, setRanges] = useState<RangePosition[]>([])
  const [mintPrice, setMintPrice] = useState<{ up: number; down: number } | null>(null)
  const [walletDusdc, setWalletDusdc] = useState<bigint>(BigInt(0))
  // const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const DUSDC_TYPE = cfg.predict.dusdcType ?? '0xe95040085976bfd54a1a07225cd46c8a2b4e8e2b6732f140a0fc49850ba73e1a::dusdc::DUSDC'
  const PREDICT_PACKAGE = cfg.predict.packageId ?? '0xf5ea2b3749c65d6e56507cc35388719aadb28f9cab873696a2f8687f5c785138'
  const PREDICT_OBJECT_ID = cfg.predict.objectId ?? '0xc8736204d12f0a7277c86388a68bf8a194b0a14c5538ad13f22cbd8e2a38028a'

  // Fetch manager and summary
  const refreshData = useCallback(async () => {
    if (!account) return

    // Predict is testnet-only; on mainnet we leave state empty and surface a
    // friendly error so the UI can show the "switch to testnet" notice.
    if (SERVER === null) {
      setManager(null)
      setSummary(null)
      setPositions([])
      setRanges([])
      setWalletDusdc(BigInt(0))
      setError('Predict is currently only supported on Testnet. Switch to Testnet in the top bar to use it.')
      return
    }

    // Wallet DUSDC balance — sum across all DUSDC coin objects.
    try {
      const coinsResult = await suiRpcCall(RPC, 'suix_getCoins', [account.address, DUSDC_TYPE])
      const coins = coinsResult.result?.data ?? []
      const total = coins.reduce(
        (acc: bigint, c: any) => acc + BigInt(c.balance ?? '0'),
        BigInt(0)
      )
      setWalletDusdc(total)
    } catch (e) {
      console.error('Failed to fetch wallet DUSDC:', e)
    }

    try {
      const data = await safeJsonGet<ManagerData[]>(`${SERVER}/managers`, 'GET /managers')
      if (!data) {
        // safeJsonGet already logged the underlying error. Reset state so
        // the UI doesn't show stale data from a prior successful fetch.
        setManager(null)
        setSummary(null)
        setPositions([])
        setRanges([])
        return
      }
      const userManager = data.find((m: ManagerData) => m.owner === account.address)

      if (userManager) {
        setManager(userManager)

        const summaryData = await safeJsonGet<ManagerSummary>(
          `${SERVER}/managers/${userManager.manager_id}/summary`,
          'GET /summary',
        )
        if (summaryData) setSummary(summaryData)

        const posData = await safeJsonGet<Position[]>(
          `${SERVER}/managers/${userManager.manager_id}/positions/summary`,
          'GET /positions/summary',
        )
        if (posData) {
          setPositions(posData.filter((p: Position) => Number(p.open_quantity) > 0))
        }

        // Range positions — single endpoint per Phase 3.1. If the indexer
        // doesn't ship this yet, the empty list keeps the popover happy.
        // const rangesData = await safeJsonGet<RangePosition[]>(
        //   `${SERVER}/managers/${userManager.manager_id}/ranges`,
        //   'GET /ranges',
        // )
        // if (rangesData) {
        //   setRanges(rangesData.filter((r) => Number(r.open_quantity) > 0))
        // } else {
        //   setRanges([])
        // }
      } else {
        setManager(null)
        setSummary(null)
        setPositions([])
        setRanges([])
      }
    } catch (e) {
      console.error('Failed to find manager:', e)
    }
  }, [account, RPC, SERVER])

  // Initial fetch and polling
  useEffect(() => {
    refreshData()
    const interval = setInterval(refreshData, 5000)
    return () => clearInterval(interval)
  }, [account, refreshData])

  const createManager = async (signAndExecute: any) => {
    setError(null)
    try {
      const { Transaction } = await import('@mysten/sui/transactions')
      const tx = new Transaction()
      tx.moveCall({
        target: `${PREDICT_PACKAGE}::predict::create_manager`,
        arguments: [],
      })

      const result = await signAndExecute({ transaction: tx })
      if (result.FailedTransaction) {
        throw new Error(result.FailedTransaction.status.error?.message || 'Failed')
      }

      // Refresh after creation
      await refreshData()
    } catch (e: any) {
      setError(e.message)
      throw e
    }
  }

  const deposit = async (signAndExecute: any, amount: string) => {
    if (!account || !manager) return

    setError(null)
    try {
      const coinsResult = await suiRpcCall(RPC, 'suix_getCoins', [account.address, DUSDC_TYPE])

      if (!coinsResult.result?.data?.length) {
        throw new Error('No DUSDC found')
      }

      const { Transaction } = await import('@mysten/sui/transactions')
      const coins = coinsResult.result.data
      const depositAmount = toDusdcUnits(amount)

      const tx = new Transaction()
      const primaryCoin = tx.object(coins[0].coinObjectId)
      if (coins.length > 1) {
        tx.mergeCoins(primaryCoin, coins.slice(1).map((c: any) => tx.object(c.coinObjectId)))
      }

      const [splitCoin] = tx.splitCoins(primaryCoin, [tx.pure.u64(depositAmount)])
      tx.moveCall({
        target: `${PREDICT_PACKAGE}::predict_manager::deposit`,
        typeArguments: [DUSDC_TYPE],
        arguments: [tx.object(manager.manager_id), splitCoin],
      })

      const result = await signAndExecute({ transaction: tx })
      if (result.FailedTransaction) {
        throw new Error(result.FailedTransaction.status.error?.message || 'Failed')
      }

      await refreshData()
    } catch (e: any) {
      setError(e.message)
      throw e
    }
  }

  const withdraw = async (signAndExecute: any, amount: string) => {
    if (!account || !manager) return

    setError(null)
    try {
      const { Transaction } = await import('@mysten/sui/transactions')
      const withdrawAmount = toDusdcUnits(amount)

      const tx = new Transaction()
      tx.moveCall({
        target: `${PREDICT_PACKAGE}::predict_manager::withdraw`,
        typeArguments: [DUSDC_TYPE],
        arguments: [tx.object(manager.manager_id), tx.pure.u64(withdrawAmount)],
      })

      const result = await signAndExecute({ transaction: tx })
      if (result.FailedTransaction) {
        throw new Error(result.FailedTransaction.status.error?.message || 'Failed')
      }

      await refreshData()
    } catch (e: any) {
      setError(e.message)
      throw e
    }
  }

  // Shared smart-fallback logic: build a PTB that mints `amount` of DBUSDC
  // positions, automatically chaining a wallet→manager deposit when the
  // manager's trading balance is short of `amount`. Returns a tagged union
  // indicating which path was taken.
  //
  // `buildKeyAndMint` is a callback that, given a tx, adds the market_key
  // (binary) or range_key (range) call + the predict::mint call and returns
  // nothing. The deposit leg is appended *before* the mint call, so the
  // manager's balance is credited before the mint reads it.
  //
  // If `manager` is null, returns `{ needsManager: true }` and writes
  // nothing to the transaction (caller is expected to use
  // `createManagerAndMint` / `createManagerAndMintRange` instead).
  const mintWithFallback = async (
    signAndExecute: any,
    amount: number,
    buildKeyAndMint: (tx: any) => Promise<void> | void,
  ): Promise<{ needsManager: true } | { success: true }> => {
    if (!account) return { needsManager: true as const }
    if (!manager) return { needsManager: true as const }

    setError(null)
    try {
      const { Transaction } = await import('@mysten/sui/transactions')
      const tx = new Transaction()
      const qtyU6 = BigInt(Math.round(amount * 1e6))

      // Compute shortfall: positive value means we need to deposit
      // `shortfallU6` of DBUSDC from the wallet before the mint can read
      // the credited balance.
      const balanceU6 = summary ? BigInt(summary.trading_balance) : BigInt(0)
      const shortfallU6 = qtyU6 > balanceU6 ? qtyU6 - balanceU6 : BigInt(0)

      if (shortfallU6 > BigInt(0)) {
        const splitCoin = await addCoinMergeAndSplit(tx, account, RPC, DUSDC_TYPE, shortfallU6)
        tx.moveCall({
          target: `${PREDICT_PACKAGE}::predict_manager::deposit`,
          typeArguments: [DUSDC_TYPE],
          arguments: [tx.object(manager.manager_id), splitCoin],
        })
      }

      await buildKeyAndMint(tx)

      const result = await signAndExecute({ transaction: tx })
      if (result.FailedTransaction) {
        throw new Error(result.FailedTransaction.status.error?.message || 'Failed')
      }

      await refreshData()
      return { success: true as const }
    } catch (e: any) {
      setError(e.message)
      throw e
    }
  }

  const mint = async (
    signAndExecute: any,
    oracleId: string,
    expiryMs: number,
    strike: number,
    direction: 'up' | 'down',
    amount: number,
  ) => {
    if (!account) return { needsManager: true as const }
    if (!manager) return { needsManager: true as const }

    return mintWithFallback(signAndExecute, amount, (tx) => {
      const strikeScaled = BigInt(Math.round(strike)) * PRICE_SCALE
      const qty = BigInt(Math.round(amount * 1e6))

      const key = tx.moveCall({
        target: `${PREDICT_PACKAGE}::market_key::${direction}`,
        arguments: [
          tx.pure.id(oracleId),
          tx.pure.u64(expiryMs),
          tx.pure.u64(strikeScaled),
        ],
      })

      tx.moveCall({
        target: `${PREDICT_PACKAGE}::predict::mint`,
        typeArguments: [DUSDC_TYPE],
        arguments: [
          tx.object(PREDICT_OBJECT_ID),
          tx.object(manager.manager_id),
          tx.object(oracleId),
          key,
          tx.pure.u64(qty),
          tx.object(CLOCK),
        ],
      })
    })
  }

  // Single-PTB path: create_manager → deposit → key → mint. If the Move
  // signature auto-shares the manager (the return value of create_manager
  // is a shared object), this throws at the second moveCall — caller is
  // expected to retry via `createManager` + `mint` as a two-sig fallback.
  const createManagerAndMint = async (
    signAndExecute: any,
    oracleId: string,
    expiryMs: number,
    strike: number,
    direction: 'up' | 'down',
    amount: number,
  ) => {
    if (!account) return

    setError(null)
    try {
      const { Transaction } = await import('@mysten/sui/transactions')
      const tx = new Transaction()

      // Step 1: create manager — bind the result so subsequent calls can
      // reference it inside the same PTB.
      const managerArg = tx.moveCall({
        target: `${PREDICT_PACKAGE}::predict::create_manager`,
        arguments: [],
      })

      // Step 2: pull the full `amount` out of the wallet and deposit it.
      const depositU6 = BigInt(Math.round(amount * 1e6))
      const splitCoin = await addCoinMergeAndSplit(tx, account, RPC, DUSDC_TYPE, depositU6)
      tx.moveCall({
        target: `${PREDICT_PACKAGE}::predict_manager::deposit`,
        typeArguments: [DUSDC_TYPE],
        arguments: [managerArg, splitCoin],
      })

      // Step 3 + 4: market key + mint.
      const strikeScaled = BigInt(Math.round(strike)) * PRICE_SCALE
      const qty = BigInt(Math.round(amount * 1e6))
      const key = tx.moveCall({
        target: `${PREDICT_PACKAGE}::market_key::${direction}`,
        arguments: [
          tx.pure.id(oracleId),
          tx.pure.u64(expiryMs),
          tx.pure.u64(strikeScaled),
        ],
      })
      tx.moveCall({
        target: `${PREDICT_PACKAGE}::predict::mint`,
        typeArguments: [DUSDC_TYPE],
        arguments: [
          tx.object(PREDICT_OBJECT_ID),
          managerArg,
          tx.object(oracleId),
          key,
          tx.pure.u64(qty),
          tx.object(CLOCK),
        ],
      })

      const result = await signAndExecute({ transaction: tx })
      if (result.FailedTransaction) {
        throw new Error(result.FailedTransaction.status.error?.message || 'Failed')
      }

      await refreshData()
    } catch (e: any) {
      setError(e.message)
      throw e
    }
  }

  const mintRange = async (
    signAndExecute: any,
    oracleId: string,
    expiryMs: number,
    lower: number,
    higher: number,
    amount: number,
  ) => {
    if (!account) return { needsManager: true as const }
    if (!manager) return { needsManager: true as const }

    return mintWithFallback(signAndExecute, amount, (tx) => {
      const lowerScaled = BigInt(Math.round(lower)) * PRICE_SCALE
      const higherScaled = BigInt(Math.round(higher)) * PRICE_SCALE
      const qty = BigInt(Math.round(amount * 1e6))

      const key = tx.moveCall({
        target: `${PREDICT_PACKAGE}::range_key::new`,
        arguments: [
          tx.pure.id(oracleId),
          tx.pure.u64(expiryMs),
          tx.pure.u64(lowerScaled),
          tx.pure.u64(higherScaled),
        ],
      })

      tx.moveCall({
        target: `${PREDICT_PACKAGE}::predict::mint_range`,
        typeArguments: [DUSDC_TYPE],
        arguments: [
          tx.object(PREDICT_OBJECT_ID),
          tx.object(manager.manager_id),
          tx.object(oracleId),
          key,
          tx.pure.u64(qty),
          tx.object(CLOCK),
        ],
      })
    })
  }

  const createManagerAndMintRange = async (
    signAndExecute: any,
    oracleId: string,
    expiryMs: number,
    lower: number,
    higher: number,
    amount: number,
  ) => {
    if (!account) return

    setError(null)
    try {
      const { Transaction } = await import('@mysten/sui/transactions')
      const tx = new Transaction()

      const managerArg = tx.moveCall({
        target: `${PREDICT_PACKAGE}::predict::create_manager`,
        arguments: [],
      })

      const depositU6 = BigInt(Math.round(amount * 1e6))
      const splitCoin = await addCoinMergeAndSplit(tx, account, RPC, DUSDC_TYPE, depositU6)
      tx.moveCall({
        target: `${PREDICT_PACKAGE}::predict_manager::deposit`,
        typeArguments: [DUSDC_TYPE],
        arguments: [managerArg, splitCoin],
      })

      const lowerScaled = BigInt(Math.round(lower)) * PRICE_SCALE
      const higherScaled = BigInt(Math.round(higher)) * PRICE_SCALE
      const qty = BigInt(Math.round(amount * 1e6))
      const key = tx.moveCall({
        target: `${PREDICT_PACKAGE}::range_key::new`,
        arguments: [
          tx.pure.id(oracleId),
          tx.pure.u64(expiryMs),
          tx.pure.u64(lowerScaled),
          tx.pure.u64(higherScaled),
        ],
      })
      tx.moveCall({
        target: `${PREDICT_PACKAGE}::predict::mint_range`,
        typeArguments: [DUSDC_TYPE],
        arguments: [
          tx.object(PREDICT_OBJECT_ID),
          managerArg,
          tx.object(oracleId),
          key,
          tx.pure.u64(qty),
          tx.object(CLOCK),
        ],
      })

      const result = await signAndExecute({ transaction: tx })
      if (result.FailedTransaction) {
        throw new Error(result.FailedTransaction.status.error?.message || 'Failed')
      }

      await refreshData()
    } catch (e: any) {
      setError(e.message)
      throw e
    }
  }

  // Redeem a directional position back into the manager.
  // Mirrors predict_workshop/redeemPosition.ts.
  //   - settled=false → predict::redeem (oracle still live)
  //   - settled=true  → predict::redeem_permissionless
  const redeem = async (
    signAndExecute: any,
    oracleId: string,
    expiryMs: number,
    strike: number,        // dollars (human units)
    direction: 'up' | 'down',
    quantity: number,      // dollars face value (human units)
    settled: boolean,
  ) => {
    if (!account || !manager) return

    setError(null)
    try {
      const { Transaction } = await import('@mysten/sui/transactions')
      const target = settled ? 'redeem_permissionless' : 'redeem'

      const tx = new Transaction()
      const strikeScaled = BigInt(Math.round(strike)) * PRICE_SCALE
      const qty = BigInt(Math.round(quantity * 1e6))

      const key = tx.moveCall({
        target: `${PREDICT_PACKAGE}::market_key::${direction}`,
        arguments: [
          tx.pure.id(oracleId),
          tx.pure.u64(expiryMs),
          tx.pure.u64(strikeScaled),
        ],
      })

      tx.moveCall({
        target: `${PREDICT_PACKAGE}::predict::${target}`,
        typeArguments: [DUSDC_TYPE],
        arguments: [
          tx.object(PREDICT_OBJECT_ID),
          tx.object(manager.manager_id),
          tx.object(oracleId),
          key,
          tx.pure.u64(qty),
          tx.object(CLOCK),
        ],
      })

      const result = await signAndExecute({ transaction: tx })
      if (result.FailedTransaction) {
        throw new Error(result.FailedTransaction.status.error?.message || 'Failed')
      }

      await refreshData()
    } catch (e: any) {
      setError(e.message)
      throw e
    }
  }

  // Range counterpart of `redeem`. Mirrors predict_workshop/redeemRange.ts.
  //   - settled=false → predict::redeem_range
  //   - settled=true  → predict::redeem_range_permissionless
  const redeemRange = async (
    signAndExecute: any,
    oracleId: string,
    expiryMs: number,
    lower: number,         // dollars (human units)
    higher: number,        // dollars (human units)
    quantity: number,      // dollars face value (human units)
    settled: boolean,
  ) => {
    if (!account || !manager) return

    setError(null)
    try {
      const { Transaction } = await import('@mysten/sui/transactions')
      const target = settled ? 'redeem_range_permissionless' : 'redeem_range'

      const tx = new Transaction()
      const lowerScaled = BigInt(Math.round(lower)) * PRICE_SCALE
      const higherScaled = BigInt(Math.round(higher)) * PRICE_SCALE
      const qty = BigInt(Math.round(quantity * 1e6))

      const key = tx.moveCall({
        target: `${PREDICT_PACKAGE}::range_key::new`,
        arguments: [
          tx.pure.id(oracleId),
          tx.pure.u64(expiryMs),
          tx.pure.u64(lowerScaled),
          tx.pure.u64(higherScaled),
        ],
      })

      tx.moveCall({
        target: `${PREDICT_PACKAGE}::predict::${target}`,
        typeArguments: [DUSDC_TYPE],
        arguments: [
          tx.object(PREDICT_OBJECT_ID),
          tx.object(manager.manager_id),
          tx.object(oracleId),
          key,
          tx.pure.u64(qty),
          tx.object(CLOCK),
        ],
      })

      const result = await signAndExecute({ transaction: tx })
      if (result.FailedTransaction) {
        throw new Error(result.FailedTransaction.status.error?.message || 'Failed')
      }

      await refreshData()
    } catch (e: any) {
      setError(e.message)
      throw e
    }
  }

  const fetchMintPrice = (oracleId: string, strike: number) => {
    if (!oracleId || strike <= 0) return

    safeJsonGet<AskBounds>(
      `${SERVER}/oracles/${oracleId}/ask-bounds?strike=${strike}`,
      'GET /ask-bounds',
    )
      .then(data => {
        if (!data) {
          setMintPrice({ up: 50, down: 50 })
          return
        }
        const upPrice = Number(BigInt(data.ask) / BigInt(1e7)) / 100
        const downPrice = 100 - upPrice
        setMintPrice({ up: upPrice, down: downPrice })
      })
  }

  // Get real trade quote from the contract via devInspect
  const getTradeQuote = async (
    oracleId: string,
    expiryMs: number,
    strike: number,
    direction: 'up' | 'down',
    quantity: number
  ): Promise<TradeQuote | null> => {
    if (!oracleId || !expiryMs || strike <= 0 || quantity <= 0) {
      return null
    }

    try {
      const { Transaction } = await import('@mysten/sui/transactions')

      // Use account address for devInspect (or fallback to ZERO_ADDR)
      const senderAddr = account?.address || '0x0000000000000000000000000000000000000000000000000000000000000000'

      const tx = new Transaction()
      tx.setSender(senderAddr)
      const strikeScaled = BigInt(Math.round(strike)) * PRICE_SCALE
      const qty = BigInt(Math.round(quantity * 1e6))

      const keyFn = direction === 'up' ? 'up' : 'down'
      const key = tx.moveCall({
        target: `${PREDICT_PACKAGE}::market_key::${keyFn}`,
        arguments: [
          tx.pure.id(oracleId),
          tx.pure.u64(expiryMs),
          tx.pure.u64(strikeScaled),
        ],
      })

      tx.moveCall({
        target: `${PREDICT_PACKAGE}::predict::get_trade_amounts`,
        arguments: [
          tx.object(PREDICT_OBJECT_ID),
          tx.object(oracleId),
          key,
          tx.pure.u64(qty),
          tx.object(CLOCK),
        ],
      })

      // Use SDK client to simulate transaction
      const result = await client.core.simulateTransaction({
        transaction: tx,
        checksEnabled: false,
        include: { commandResults: true },
      })
      const returnValues = result.commandResults?.[1]?.returnValues

      if (!returnValues || returnValues.length < 2) {
        console.warn('getTradeQuote: no return values', result.commandResults)
        return null
      }

      const costRaw = Number(bcs.U64.parse(returnValues[0].bcs))
      const redeemRaw = Number(bcs.U64.parse(returnValues[1].bcs))

      const cost = (costRaw / Number(DUSDC_SCALE)) / quantity
      const redeem = (redeemRaw / Number(DUSDC_SCALE)) / quantity
      const premium = cost - redeem

      return {
        cost,
        redeem,
        premium,
      }
    } catch (e: any) {
      console.warn('getTradeQuote failed:', e.message)
      return null
    }
  }

  // Get range quote via devInspect
  const getRangeQuote = async (
    oracleId: string,
    expiryMs: number,
    lower: number,
    higher: number,
    quantity: number
  ): Promise<RangeQuote | null> => {
    if (!oracleId || !expiryMs || lower <= 0 || higher <= 0 || quantity <= 0) {
      return null
    }

    try {
      const { Transaction } = await import('@mysten/sui/transactions')

      const senderAddr = account?.address || '0x0000000000000000000000000000000000000000000000000000000000000000'

      const tx = new Transaction()
      tx.setSender(senderAddr)
      const lowerScaled = BigInt(Math.round(lower)) * PRICE_SCALE
      const higherScaled = BigInt(Math.round(higher)) * PRICE_SCALE
      const qty = BigInt(Math.round(quantity * 1e6))

      // Create range key
      const key = tx.moveCall({
        target: `${PREDICT_PACKAGE}::range_key::new`,
        arguments: [
          tx.pure.id(oracleId),
          tx.pure.u64(expiryMs),
          tx.pure.u64(lowerScaled),
          tx.pure.u64(higherScaled),
        ],
      })

      tx.moveCall({
        target: `${PREDICT_PACKAGE}::predict::get_range_trade_amounts`,
        arguments: [
          tx.object(PREDICT_OBJECT_ID),
          tx.object(oracleId),
          key,
          tx.pure.u64(qty),
          tx.object(CLOCK),
        ],
      })

      const result = await client.core.simulateTransaction({
        transaction: tx,
        checksEnabled: false,
        include: { commandResults: true },
      })

      const returnValues = result.commandResults?.[1]?.returnValues

      if (!returnValues || returnValues.length < 2) {
        console.warn('getRangeQuote: no return values', result.commandResults)
        return null
      }

      const costRaw = Number(bcs.U64.parse(returnValues[0].bcs))
      const payoutRaw = Number(bcs.U64.parse(returnValues[1].bcs))

      return {
        cost: (costRaw / Number(DUSDC_SCALE)) / quantity,
        payout: (payoutRaw / Number(DUSDC_SCALE)) / quantity,
      }
    } catch (e: any) {
      console.warn('getRangeQuote failed:', e.message)
      return null
    }
  }

  return {
    manager,
    summary,
    positions,
    ranges,
    mintPrice,
    walletDusdcBalance: walletDusdc,
    loading: false,
    error,
    createManager,
    deposit,
    withdraw,
    mint,
    createManagerAndMint,
    mintRange,
    createManagerAndMintRange,
    redeem,
    redeemRange,
    fetchMintPrice,
    refreshData,
    getTradeQuote,
    getRangeQuote,
  }
}
