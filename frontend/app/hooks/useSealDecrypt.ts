'use client';

/**
 * `useSealDecrypt` — hook that orchestrates the read side of the
 * hybrid Seal+AES encryption flow.
 *
 * # What it does (hybrid decrypt)
 *
 * Each batch blob on Walrus carries three things inline:
 *   1. `results` — plaintext free slice (3 markets).
 *   2. `encryptedPayload` — base64 AES-256-GCM ciphertext of the
 *      FULL set JSON.
 *   3. `wrappedKey` — base64 Seal ciphertext wrapping the AES key.
 *
 * To recover the full set, we:
 *   1. Seal-decrypt `wrappedKey` (32 bytes of AES key material).
 *      This is the gated step — the key server simulates
 *      `subscription::seal_approve` and only releases the share
 *      to wallets with an active Subscription NFT for the matching
 *      pool.
 *   2. AES-decrypt `encryptedPayload` with the recovered key. This
 *      is a local, fast Web-Crypto operation.
 *   3. JSON-parse the plaintext and validate as `BatchInsight`.
 *
 * # Pattern (mirrors `seal_examples/frontend/src/SubscriptionView.tsx:198-267`)
 *
 *   1. Caller passes `wrappedKey` + `encryptedPayload` + `keyIdHex`
 *      + `poolObjectIdHex` from a `BatchInsight` it already holds
 *      (typically `batchIndex.getByBatchId(batchId)`). No URL fetch
 *      is needed — the bytes are right there on the BatchInsight.
 *   2. We grab the wallet's active `Subscription` NFT from
 *      `useUserPool().subscription` and the package id from
 *      `useNetworkConfig().deepwatch.packageId`.
 *   3. We build the `seal_approve` PTB (DeepWatch's 4-arg signature
 *      `(id, sub, clock, ctx)` — see `buildSealApproveTx` in
 *      `lib/seal.ts`), call `getOrCreateSessionKey` (which prompts a
 *      `signPersonalMessage` on first use and caches for 10 min via
 *      `idb-keyval`), and pass the resulting `txBytes` + `sessionKey`
 *      to `sealClient.fetchKeys` + `sealClient.decrypt` for the
 *      wrapped key.
 *   4. With the recovered 32-byte AES key, run `aesDecrypt` on the
 *      payload, validate, and return `results`.
 *
 * # Access errors
 *
 * - **No subscription** — `useUserPool().subscription == null`. Throws
 *   `SealAccessError('NO_SUBSCRIPTION')`.
 * - **Subscription expired** — `subscription.expiresAtMs <= now`.
 *   Throws `SealAccessError('EXPIRED')`.
 * - **Key server says no** — `sealClient.fetchKeys` throws
 *   `NoAccessError` (e.g. wrong-namespace blob, on-chain rejection).
 *   Mapped to `SealAccessError('NO_SUBSCRIPTION')` because that's the
 *   most common cause in practice; the `useMatchInsight` hook then
 *   surfaces a locked CTA.
 *
 * Network / key-server failures (5xx, timeout) bubble unchanged so
 * the caller's `try/catch` can decide whether to retry or show
 * "Couldn't reach key server".
 *
 * # Why a hook, not a free function
 *
 * The hook exposes a `decrypt(...)` callback and a few state flags
 * (`isSigning`, `error`). React component callers want to render
 * different UIs while the user is being prompted for a signature vs
 * once decrypt succeeds — a free function can't drive that. The hook
 * also co-locates the React-side wiring (`useUserPool`, `useNetwork`,
 * `useDAppKit`) so callers don't have to.
 */

import { useCallback, useMemo, useState } from 'react';
import { useCurrentAccount, useDAppKit } from '@mysten/dapp-kit-react';
import { fromHex } from '@mysten/sui/utils';
import {
  buildSealApproveTx,
  buildSealSuiClient,
  getOrCreateSessionKey,
  getSealClient,
  sealDecrypt,
  SealAccessError,
} from '../lib/seal';
import { aesDecrypt } from '../lib/aes';
import { validateBatchInsight, type MatchAnalysis } from '../lib/match-analyses';
import { useUserPool } from './useUserPool';
import { useNetworkConfig } from './useNetworkConfig';
import { useNetwork } from '../context/NetworkContext';

export interface UseSealDecryptResult {
  /**
   * Decrypt a batch's `encryptedPayload` using the wallet's
   * SessionKey + active `Subscription` NFT. Returns the full-set
   * `Record<matchKey, MatchAnalysis>` map on success. Throws
   * `SealAccessError` on access failures (catch via `e.reason`).
   * Throws any other error unchanged (network/key-server failures).
   */
  decrypt: (args: {
    /** Base64 Seal ciphertext wrapping the AES key (the `wrappedKey`
     *  field on the BatchInsight). */
    wrappedKeyB64: string;
    /** Base64 AES-256-GCM ciphertext of the full-set JSON (the
     *  `encryptedPayload` field on the BatchInsight). */
    encryptedPayloadB64: string;
    /** Hex Seal key-id (the `keyId` field on the BatchInsight). */
    keyIdHex: string;
  }) => Promise<Record<string, MatchAnalysis>>;
  /** True while the SessionKey is being created / signed. */
  isSigning: boolean;
  /** Last error (string) or null. Cleared on next successful decrypt. */
  error: string | null;
  /** True if a usable Subscription NFT + Seal package id are both present. */
  canDecrypt: boolean;
}

export function useSealDecrypt(): UseSealDecryptResult {
  const account = useCurrentAccount();
  const dAppKit = useDAppKit();
  const cfg = useNetworkConfig();
  const { network } = useNetwork();
  const { subscription } = useUserPool();

  const [isSigning, setIsSigning] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Memoize the SealClient. The key-server config is constant for the
  // hook's lifetime; only the SuiJsonRpcClient instance changes when the
  // user flips networks (rare). We rebuild when `network` changes.
  const sealClient = useMemo(() => {
    const suiClient = buildSealSuiClient(network);
    return getSealClient(suiClient);
  }, [network]);

  const canDecrypt =
    subscription !== null &&
    cfg.deepwatch.packageId !== null &&
    !!account?.address;

  const decrypt = useCallback(
    async (args: {
      wrappedKeyB64: string;
      encryptedPayloadB64: string;
      keyIdHex: string;
    }): Promise<Record<string, MatchAnalysis>> => {
      setError(null);
      if (!account?.address) {
        throw new SealAccessError('NO_SUBSCRIPTION', 'Wallet not connected');
      }
      if (!subscription) {
        throw new SealAccessError('NO_SUBSCRIPTION', 'No active subscription');
      }
      if (Date.now() >= subscription.expiresAtMs) {
        throw new SealAccessError(
          'EXPIRED',
          `Subscription expired ${new Date(subscription.expiresAtMs).toISOString()}`,
        );
      }
      const packageId = cfg.deepwatch.packageId;
      if (!packageId) {
        throw new SealAccessError(
          'NO_SUBSCRIPTION',
          'DeepWatch package not deployed on this network',
        );
      }

      // ─── Namespace check (client-side, before key-server roundtrip) ─
      // The Seal key-id is `[poolBytes (32) ++ 5-byte-nonce]`. The
      // on-chain `seal_approve` Move function asserts that the first
      // 32 bytes match `Subscription.pool_id`. We can verify this in
      // the browser before paying the key-server fee: if the prefix
      // doesn't match, the on-chain check WILL abort and we'd just
      // burn the roundtrip + a misleading `NoAccessError`.
      //
      // This catches:
      //   - subscription minted against Pool A, blob encrypted under
      //     Pool B's namespace (config drift, redeploy, etc.)
      //   - subscription from a different DeepWatch pool entirely
      //     (future multi-pool scenario)
      //
      // # String format gotcha
      //
      // Sui object IDs (`Subscription.pool_id`, `cfg.deepwatch.poolObjectId`)
      // are conventionally serialised as `0x` + 64 hex chars = 66 chars.
      // `toHex()` in @mysten/sui/utils produces PLAIN hex with no `0x`
      // prefix, so `keyIdHex` here is 74 chars total: 64 of pool bytes +
      // 10 of nonce.
      //
      // The original check used `.slice(0, 66)` on both sides — that
      // returned the pool bytes plus the first 2 nonce chars on the
      // keyId, and `0x` + pool bytes on the Sui id. They never matched
      // even when the data was correct. Strip the `0x` prefix on the
      // Sui IDs and compare 64 hex chars (= 32 bytes) on both sides.
      const configuredPoolId = cfg.deepwatch.poolObjectId;
      const subscriptionPoolId = subscription.poolId;
      const keyIdPoolPrefix = args.keyIdHex.slice(0, 64); // first 32 bytes hex
      const subPoolHex = strip0x(subscriptionPoolId);
      const cfgPoolHex = strip0x(configuredPoolId);
      if (
        subPoolHex &&
        cfgPoolHex &&
        subPoolHex.toLowerCase() !== cfgPoolHex.toLowerCase()
      ) {
        // The user's subscription is for a different pool than the
        // one this app is wired to.
        throw new SealAccessError(
          'NAMESPACE_MISMATCH',
          'Subscription is for a different DeepWatch pool',
          {
            configuredPoolId,
            subscriptionPoolId,
            keyIdPrefix: keyIdPoolPrefix,
          },
        );
      }
      if (
        subPoolHex &&
        keyIdPoolPrefix.toLowerCase() !== subPoolHex.toLowerCase()
      ) {
        // Same subscription pool as configured, but the key-id prefix
        // doesn't match — the blob was encrypted under a different
        // pool's namespace (config drift between encrypt and decrypt
        // sessions, or the blob was authored against a redeployed
        // pool).
        throw new SealAccessError(
          'NAMESPACE_MISMATCH',
          'Encrypted blob namespace does not match this subscription',
          {
            configuredPoolId,
            subscriptionPoolId,
            keyIdPrefix: keyIdPoolPrefix,
          },
        );
      }

      const wrappedKey = base64ToBytes(args.wrappedKeyB64);

      // Build a SuiJsonRpcClient for PTB construction. Same client
      // type as the encrypt path uses (see `ai-batch-store.tsx`).
      const suiClient = buildSealSuiClient(network);

      // Get or create a SessionKey. On first call within the
      // 10-min TTL window the user will be prompted to sign a
      // personal message; subsequent calls reuse the cached key.
      setIsSigning(true);
      let sessionKey;
      try {
        sessionKey = await getOrCreateSessionKey(
          suiClient,
          packageId,
          account.address,
          async ({ message }) => {
            const fn = dAppKit?.signPersonalMessage;
            if (!fn) {
              throw new SealAccessError(
                'NO_SUBSCRIPTION',
                'Wallet does not support signPersonalMessage',
              );
            }
            const { signature } = await fn({ message });
            return { signature };
          },
        );
      } finally {
        setIsSigning(false);
      }

      // Build the seal_approve PTB + txBytes for key-server simulation.
      // DeepWatch's signature is (id, sub, clock, ctx) — see
      // buildSealApproveTx for the divergence from the seal_examples reference.
      const aesKey = await sealDecrypt(
        wrappedKey,
        sealClient,
        sessionKey,
        suiClient,
        (tx, id) =>
          buildSealApproveTx({
            tx,
            sealPackageId: packageId,
            subscriptionObjectId: subscription.objectId,
            keyIdHex: id,
          }),
        {
          // Diagnostic: capture the full key-id Seal actually parsed
          // out of the ciphertext header. If this differs from
          // `args.keyIdHex` (the value we persisted on the
          // BatchInsight), the blob was authored under a different
          // namespace than what we recorded — a config drift / cache
          // poisoning signal.
          onKeyIdParsed: (parsedFullId) => {
            if (typeof console !== 'undefined' && parsedFullId !== args.keyIdHex) {
              console.warn('[useSealDecrypt] keyId mismatch — ciphertext header disagrees with stored keyId', {
                fromCiphertext: parsedFullId,
                fromBatchInsight: args.keyIdHex,
              });
            }
          },
        },
      );

      // Local AES-GCM decrypt of the bulk payload.
      const plaintextBytes = await aesDecrypt(args.encryptedPayloadB64, aesKey);
      const parsed = JSON.parse(new TextDecoder().decode(plaintextBytes)) as unknown;
      const insight = validateBatchInsight(parsed);
      if (!insight) {
        throw new Error('Decrypted payload failed BatchInsight validation');
      }
      return insight.results;
    },
    [
      account,
      cfg.deepwatch.packageId,
      cfg.deepwatch.poolObjectId,
      dAppKit,
      network,
      sealClient,
      subscription,
    ],
  );

  // `error` is exposed so callers can render an inline error toast on
  // failures (vs relying on `try/catch` around `decrypt`). The hook
  // clears it at the top of each call, so a stale `error` only shows
  // when the most recent decrypt attempt failed.

  return {
    decrypt: useCallback(
      async (args) => {
        try {
          const out = await decrypt(args);
          setError(null);
          return out;
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          setError(msg);
          throw e;
        }
      },
      [decrypt],
    ),
    isSigning,
    error,
    canDecrypt,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────

/**
 * Strip a `0x` prefix from a hex string. Used to normalise Sui object IDs
 * (which are conventionally serialised as `0x` + hex) to the plain-hex
 * format that `toHex()` from @mysten/sui/utils produces. Returns null
 * for null/undefined/empty input so callers can use it as a guard.
 */
function strip0x(s: string | null | undefined): string | null {
  if (typeof s !== 'string' || s.length === 0) return null;
  return s.startsWith('0x') || s.startsWith('0X') ? s.slice(2) : s;
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    out[i] = bin.charCodeAt(i);
  }
  return out;
}