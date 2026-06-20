/**
 * Seal encryption helper — the second-layer encryption for AI insights.
 *
 * # What this module does
 *
 * The Compare page runs AI batches and uploads the results to Walrus.
 * Per the v2 design (replacing the v1 plaintext-everywhere model), the
 * first 3 markets per batch are uploaded as plaintext (anyone can read
 * them) and the remainder is Seal-encrypted before upload. Only
 * wallets holding a valid `deepwatch::subscription::Subscription`
 * NFT (one with `now < expires_at_ms`) can decrypt the sealed slice.
 *
 * # Pattern (mirrors `seal_examples/frontend/src/AllowlistView.tsx`)
 *
 *   key-id = [pool_object_bytes] ++ [5 random bytes]
 *   policy = move call to `deepwatch::subscription::seal_approve(id, sub, clock, ctx)`
 *   access checks (in order): namespace, expiry, owner
 *
 * `seal_approve` aborts if any check fails → key server returns
 * `NoAccessError` → `useMatchInsight` surfaces
 * `accessError: 'NO_SUBSCRIPTION' | 'EXPIRED'`.
 *
 * # Session key caching (idb-keyval)
 *
 * `SessionKey.create` requires a wallet signature via
 * `signPersonalMessage`. To avoid forcing a re-sign on every
 * decryption, we cache the exported session key in IndexedDB keyed by
 * wallet address. TTL is 10 minutes (matches the seal_examples
 * `AllowlistView.tsx` constant); after expiry the user has to sign
 * again. This is the same UX as the example, intentionally.
 *
 * # Cost note
 *
 * Each encrypt roundtrip costs one key-server fee. The free tier of
 * the Mysten testnet key server is enough for hackathon-scale demo
 * traffic; production should plan for key-server costs proportional
 * to insight volume.
 */

import {
  EncryptedObject,
  NoAccessError,
  SealClient,
  SessionKey,
  type ExportedSessionKey,
} from '@mysten/seal';
import { getJsonRpcFullnodeUrl, SuiJsonRpcClient } from '@mysten/sui/jsonRpc';
import { Transaction } from '@mysten/sui/transactions';
import { fromHex, toHex } from '@mysten/sui/utils';
import { get, set } from 'idb-keyval';
import { CLOCK_ID } from './networkConfig';

/**
 * Testnet key server object. Matches the seal_examples default. For
 * different configurations (multi-server, weighted, etc.) see
 * https://seal-docs.wal.app/UsingSeal#choosing-key-servers.
 */
export const SEAL_KEY_SERVER_OBJ_ID =
  '0xb012378c9f3799fb5b1a7083da74a4069e3c3f1c93de0b27212a5799ce1e1e98';

export const SEAL_AGGREGATOR_URL = 'https://seal-aggregator-testnet.mystenlabs.com';

const SESSION_KEY_TTL_MIN = 10;

/** IDB cache key prefix. Per-wallet suffix avoids cross-account leakage.
 *
 * Bumped v1 → v2 when `setPersonalMessageSignature` was added to the
 * fresh-create path: any wallet with a v1 entry on disk has an
 * `ExportedSessionKey` whose `personalMessageSignature` is undefined,
 * which would re-throw `InvalidPersonalMessageSignatureError` from
 * `SessionKey.getCertificate()` on every reload. The v2 lookup misses
 * for those wallets, falls through to fresh create + sign, and the
 * stale v1 entry is eventually garbage-collected by IDB. */
function sessionKeyCacheKey(walletAddress: string): string {
  return `deepwatch:seal:session-key:v2:${walletAddress}`;
}

// ─── Client singleton ───────────────────────────────────────────────────

/**
 * Cached SealClient. We build one per SuiClient (which is itself
 * provided by `useSuiClient()`); the key server config is constant
 * for now. Re-creating is cheap but we'd rather not on every call.
 */
let _client: SealClient | null = null;
let _clientSui: SuiJsonRpcClient | null = null;

export function getSealClient(suiClient: SuiJsonRpcClient): SealClient {
  if (_client && _clientSui === suiClient) return _client;
  _client = new SealClient({
    suiClient,
    serverConfigs: [
      {
        objectId: SEAL_KEY_SERVER_OBJ_ID,
        weight: 1,
        aggregatorUrl: SEAL_AGGREGATOR_URL,
      },
    ],
    verifyKeyServers: false,
  });
  _clientSui = suiClient;
  return _client;
}

// ─── Encrypt ────────────────────────────────────────────────────────────

/**
 * Seal-encrypt `plaintext` and return the encrypted bytes. The
 * returned `keyId` is what the key server validates against the
 * `seal_approve` move call — derived from `poolObjectIdBytes` so that
 * only the matching pool's namespace can decrypt.
 *
 * `poolObjectIdBytes` is the raw 32-byte ID of the shared `Pool`
 * object, NOT its hex string. Caller fetches it from
 * `suiClient.getObject({ id: poolId, options: { showOwner: false } })`
 * or directly from a config that stored the bytes at deploy time.
 */
export async function sealEncrypt(
  plaintext: Uint8Array,
  poolObjectIdBytes: Uint8Array,
  sealPackageId: string,
  sealClient: SealClient,
  /**
   * Optional pre-computed full key-id hex. When supplied, used
   * verbatim — `sealClient.encrypt` binds the ciphertext to this id,
   * and the key server's `seal_approve` later validates against it.
   * When omitted, generated as `[poolObjectIdBytes ++ 5-byte nonce]`.
   *
   * DeepWatch passes a pre-computed keyId when the writer needs the
   * keyId to be discoverable in plaintext metadata (the hybrid
   * AES-wrapped-key upload writes `keyId` onto the BatchInsight
   * before uploading, so the read side can rebuild the matching
   * `seal_approve` PTB). Pre-computing keeps the persisted keyId
   * consistent with what Seal used.
   */
  precomputedKeyIdHex?: string,
): Promise<{ ciphertext: Uint8Array; keyIdHex: string }> {
  let keyIdHex: string;
  if (precomputedKeyIdHex) {
    keyIdHex = precomputedKeyIdHex;
  } else {
    // Per the seal_examples encrypt pattern: 5-byte nonce per blob.
    // The first N bytes are the policy object bytes (= our pool ID);
    // the last 5 are random. The full byte string IS the key-id; the
    // key server's `seal_approve` PTB asserts `id` starts with the
    // pool's bytes.
    const nonce = crypto.getRandomValues(new Uint8Array(5));
    const keyId = new Uint8Array([...poolObjectIdBytes, ...nonce]);
    keyIdHex = toHex(keyId);
  }

  const { encryptedObject } = await sealClient.encrypt({
    threshold: 1,
    packageId: sealPackageId,
    id: keyIdHex,
    data: plaintext,
  });
  return { ciphertext: encryptedObject, keyIdHex };
}

// ─── Decrypt ────────────────────────────────────────────────────────────

/**
 * Seal-decrypt a previously-encrypted ciphertext. On `NoAccessError`
 * (the wallet has no Subscription / it's expired), throws
 * `SealAccessError` with the structured reason; on any other error,
 * re-throws the underlying exception.
 *
 * `moveCallConstructor` builds the `seal_approve` PTB; the key
 * server simulates it before releasing the key share. For our setup
 * that's `package::subscription::seal_approve(id, sub, clock)`.
 */
export type SealAccessErrorReason =
  | 'NO_SUBSCRIPTION'
  | 'EXPIRED'
  | 'WRONG_OWNER'
  /**
   * The on-chain `Subscription.pool_id` does not match the prefix of the
   * key-id embedded in the ciphertext. Either:
   *   - the wallet holds a subscription for a different DeepWatch pool
   *     than the one used to encrypt this blob, or
   *   - the encrypt side was run against a different `poolObjectId`
   *     config than the subscription was minted under.
   *
   * Detected client-side before the key-server roundtrip so the user
   * gets a precise message instead of the opaque `NoAccessError`.
   */
  | 'NAMESPACE_MISMATCH';

export class SealAccessError extends Error {
  reason: SealAccessErrorReason;
  /**
   * Free-form diagnostic context (key-id, subscription pool-id, raw
   * Seal error message, …). Surfaced in `notify(...)` toasts on the
   * Compare page so the user can paste it into a bug report without
   * opening DevTools.
   */
  diagnostic?: Record<string, unknown>;
  constructor(
    reason: SealAccessErrorReason,
    message?: string,
    diagnostic?: Record<string, unknown>,
  ) {
    super(message ?? `Seal access denied: ${reason}`);
    this.reason = reason;
    this.diagnostic = diagnostic;
  }
}

export async function sealDecrypt(
  ciphertext: Uint8Array,
  sealClient: SealClient,
  sessionKey: SessionKey,
  suiClient: SuiJsonRpcClient,
  buildSealApproveTx: (tx: Transaction, id: string) => void,
  /**
   * Optional diagnostic callbacks invoked before the key-server call
   * and on `NoAccessError`. Used by `useSealDecrypt` to surface
   * specific key-id / subscription-pool-id pairs in the toast so the
   * user can tell namespace vs expiry vs owner at a glance.
   */
  diagnostic?: {
    /** Called once the key-id has been parsed from the ciphertext header. */
    onKeyIdParsed?: (fullIdHex: string) => void;
  },
): Promise<Uint8Array> {
  // Parse the key-id out of the encrypted object header so we can
  // build the matching `seal_approve` PTB.
  const fullId = EncryptedObject.parse(ciphertext).id;
  diagnostic?.onKeyIdParsed?.(fullId);
  if (typeof console !== 'undefined') {
    // Verbose — logged once per decrypt. The Seal SDK doesn't expose
    // why the PTB simulation aborted (just `NoAccessError`), so this is
    // the only on-device breadcrumb when a key server roundtrip fails.
    console.debug('[sealDecrypt] keyId parsed from ciphertext:', {
      fullId,
      length: fullId.length,
    });
  }
  const tx = new Transaction();
  buildSealApproveTx(tx, fullId);
  const txBytes = await tx.build({ client: suiClient, onlyTransactionKind: true });

  try {
    // First: ask the key server for the decryption key. Simulates
    // the PTB and returns the share if seal_approve wouldn't abort.
    await sealClient.fetchKeys({
      ids: [fullId],
      txBytes,
      sessionKey,
      threshold: 1,
    });

    // Second: recover the AES key from the Seal ciphertext using the
    // share just returned by fetchKeys.
    return await sealClient.decrypt({
      data: ciphertext,
      sessionKey,
      txBytes,
    });
  } catch (err) {
    if (err instanceof NoAccessError) {
      if (typeof console !== 'undefined') {
        // Full error message + the key-id we tried — the key server's
        // 4xx body typically lands on `err.message` (Seal SDK puts the
        // aggregator's response string there).
        console.warn('[sealDecrypt] NoAccessError from key server:', {
          fullId,
          message: err.message,
          stack: err.stack,
        });
      }
      throw new SealAccessError(
        'NO_SUBSCRIPTION',
        err.message,
        // Pass through the raw `NoAccessError.message` — the key
        // server's response sometimes includes the abort code as a
        // free-text hint. Surface to the user via the toast.
        { fullId, rawMessage: err.message },
      );
    }
    throw err;
  }
}

/**
 * Build a `seal_approve` PTB for DeepWatch's `subscription::seal_approve`
 * Move function.
 *
 * **DeepWatch signature** (from `contracts/sources/subscription.move:99-112`):
 * ```
 * entry fun seal_approve(
 *   id: vector<u8>,
 *   sub: &Subscription,
 *   c: &Clock,
 *   ctx: &TxContext,
 * )
 * ```
 * — 4 args, NO `&Service`. This differs from the `seal_examples`
 * reference (which uses `(id, sub, service, clock)` and a `serviceId`).
 * DeepWatch's design dropped the service arg in favour of encoding the
 * pool namespace directly into the key-id, so a literal port of the
 * reference would fail PTB resolution with `CommandArgumentError`.
 *
 * The key server simulates this PTB; if `seal_approve` would abort
 * (no subscription, expired, wrong owner, wrong namespace), the key
 * server returns `NoAccessError` instead of the key share.
 *
 * `keyIdHex` is the full hex-encoded key-id (the pool-namespace bytes
 * plus a 5-byte nonce — produced at encrypt time and persisted on the
 * `BatchInsight` as `keyId`). The function `fromHex`-decodes it into
 * the `vector<u8>` the Move entry expects.
 *
 * Returns the same `tx` it was given (matches the callback shape
 * `sealDecrypt` expects) so it can be passed directly as the
 * `buildSealApproveTx` argument.
 */
export function buildSealApproveTx(args: {
  tx: Transaction;
  sealPackageId: string;
  subscriptionObjectId: string;
  keyIdHex: string;
  /** Optional pre-built key-id bytes (skips the fromHex round-trip if
   * the caller already has them — used by `sealDecrypt` for the key-id
   * parsed out of the encrypted object header). */
  keyIdBytes?: Uint8Array;
}): Transaction {
  const keyIdBytes =
    args.keyIdBytes ??
    (typeof args.keyIdHex === 'string' ? fromHex(args.keyIdHex) : new Uint8Array());
  args.tx.moveCall({
    target: `${args.sealPackageId}::subscription::seal_approve`,
    arguments: [
      args.tx.pure.vector('u8', keyIdBytes),
      args.tx.object(args.subscriptionObjectId),
      args.tx.object(CLOCK_ID),
    ],
  });
  return args.tx;
}

// ─── Session key management ────────────────────────────────────────────

/**
 * Returns a cached session key if one exists and is still valid for
 * the given wallet address. Otherwise prompts the user to sign and
 * caches the new one.
 *
 * `signPersonalMessage` is the dapp-kit hook; it's the only way to
 * get a real signature for the SessionKey.create call.
 *
 * # SDK lifecycle (full chain — easy to drop a step)
 *
 *   1. `SessionKey.create(...)` — generates an ephemeral keypair.
 *   2. `getPersonalMessage()` — bytes the wallet signs.
 *   3. `signPersonalMessage({ message })` via dapp-kit → `{ signature }`.
 *   4. **`sessionKey.setPersonalMessageSignature(signature)`** —
 *      attaches the signature to the in-memory key. Required because
 *      `sealClient.fetchKeys` calls `SessionKey.getCertificate()`
 *      internally and that method throws
 *      `InvalidPersonalMessageSignatureError` when no signature is
 *      set. This is the missing step that previously caused every
 *      decrypt to fail at fetchKeys.
 *   5. `export()` — bakes the signature into `ExportedSessionKey`
 *      (`personalMessageSignature` field) so a future
 *      `SessionKey.import(cached, ...)` restore also has it. Without
 *      step 4 before step 5 the cache is permanently broken.
 */
export async function getOrCreateSessionKey(
  suiClient: SuiJsonRpcClient,
  sealPackageId: string,
  walletAddress: string,
  signPersonalMessage: (input: { message: Uint8Array }) => Promise<{ signature: string }>,
): Promise<SessionKey> {
  const cacheKey = sessionKeyCacheKey(walletAddress);

  // Try to reuse a cached key first.
  try {
    const cached = (await get(cacheKey)) as ExportedSessionKey | null | undefined;
    if (cached) {
      const imported = await SessionKey.import(cached, suiClient);
      if (imported && !imported.isExpired() && imported.getAddress() === walletAddress) {
        if (typeof console !== 'undefined') {
          // Breadcrumb: confirms the v2 cache entries actually carry
          // the signature. If this ever flips to false again, every
          // subsequent fetchKeys in this session will throw
          // InvalidPersonalMessageSignatureError.
          console.debug('[getOrCreateSessionKey] cache hit', {
            fromCache: true,
            hasCachedSig: !!cached.personalMessageSignature,
            cacheKey,
          });
        }
        return imported;
      }
    }
  } catch {
    // Corrupted cache entry — fall through to fresh create.
  }

  // Fresh key. Create + sign + attach sig + cache.
  const sessionKey = await SessionKey.create({
    address: walletAddress,
    packageId: sealPackageId,
    ttlMin: SESSION_KEY_TTL_MIN,
    suiClient,
  });

  const message = sessionKey.getPersonalMessage();
  const { signature } = await signPersonalMessage({ message });
  // Step 4 of the lifecycle above — the missing call. Must run BEFORE
  // `export()` so the signature lands on both the in-memory key (for
  // this session's fetchKeys) and the persisted form (for next
  // session's `SessionKey.import`).
  await sessionKey.setPersonalMessageSignature(signature);

  if (typeof console !== 'undefined') {
    console.debug('[getOrCreateSessionKey] fresh create + sign', {
      fromCache: false,
      hasSignature: !!signature,
      cacheKey,
    });
  }

  const exported = sessionKey.export();
  await set(cacheKey, exported);
  return sessionKey;
}

/** Drop the cached session key (e.g. user signs out / switches wallet). */
export async function clearSessionKeyCache(walletAddress: string): Promise<void> {
  await set(sessionKeyCacheKey(walletAddress), null);
}

// ─── Network helper ─────────────────────────────────────────────────────

/**
 * Build a SuiJsonRpcClient for the given network string. Used by
 * Seal helpers that need their own client (separate from dapp-kit's
 * `useSuiClient()` so we can run them outside React, e.g. inside
 * `useEffect`-style async functions).
 */
export function buildSealSuiClient(network: 'testnet' | 'mainnet' | 'devnet' | 'localnet'): SuiJsonRpcClient {
  return new SuiJsonRpcClient({ url: getJsonRpcFullnodeUrl(network), network });
}

// ─── Helpers ────────────────────────────────────────────────────────────

/** Decode the bytes of a Sui object ID from its hex string. */
export function hexToBytes(hex: string): Uint8Array {
  return fromHex(hex);
}
