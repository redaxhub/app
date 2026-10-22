// REDAX Holder — the TRANSACTION-SCOPED convert effect proof.
//
// WHY IT EXISTS. The Holder route proves a conversion's effect by reading the shared
// accounts after the transaction and requiring every one of seven values to equal the
// measured pre-state plus THIS attempt's own delta. That is exact while nobody else
// touches the Campaign — and it stops being decidable the moment another holder's
// legitimate conversion, or a Team lifecycle change, moves the shared fee vault, the
// Campaign counters or the Campaign's status while this attempt is still unresolved.
// The exact transaction may be finalized and successful, yet the shared state can no
// longer say so.
//
// WHAT IT PROVES INSTEAD, AND FROM WHAT. One finalized (or confirmed) `getTransaction` for
// the exact retained signature, and nothing else:
//
//   1. the landed legacy message re-serializes to EXACTLY the commitment this attempt froze
//      before the wallet was asked — program, instruction data (the amount), every account
//      and the fee payer are therefore the approved ones;
//   2. the transaction's own metadata reports no error (or, for the no-effect proof, an
//      error);
//   3. the transaction's OWN pre/post token balances for the three token accounts the
//      convert touches — the holder's legacy account, the holder's output account and the
//      canonical protocol fee vault — carry the expected mint, the expected owner for the
//      holder accounts, the classic SPL Token program, and moved by EXACTLY the approved
//      amounts: `-amountIn`, `+netOut`, `+protocolFee` (or by zero, for no-effect).
//
// Those balances are deltas WITHIN this one transaction, so another holder's conversion or
// a later pause cannot disturb them. The Campaign's cumulative counters cannot be read per
// transaction and are deliberately NOT claimed here; the exact message plus the three exact
// token movements of this signature is the attribution.
//
// It reads nothing else, writes nothing, signs nothing, sends nothing and never throws.
// A response it cannot read is UNAVAILABLE — never a match and never a mismatch.
//
// ZERO IMPORTS. The message-commitment primitive is INJECTED by the Holder action root (the
// one owner of that foundation) rather than imported here, and the commitment shape is
// re-declared structurally, so this module adds no edge to the foundation import graph.

/** A versioned commitment to one compiled legacy message. Re-declared, never imported. */
export interface RedaxTransactionEffectMessageCommitment {
  readonly kind: string
  readonly byteLength: number
  readonly sha256Hex: string
}

/** The injected commitment primitive: the same one the attempt froze its message with. */
export type RedaxTransactionEffectCommit = (
  serializedMessage: Uint8Array,
) => Promise<
  | { readonly ok: true; readonly commitment: RedaxTransactionEffectMessageCommitment }
  | { readonly ok: false }
>

/** The classic SPL Token program. Token-2022 is Phase 2+ and is never a match here. */
const CLASSIC_TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'

const CANONICAL_UNSIGNED_DECIMAL = /^(?:0|[1-9][0-9]*)$/

/** The one read this proof makes. Structural, so any RPC client — or a test port — fits. */
export interface RedaxTransactionEffectReader {
  getTransaction(
    signature: string,
    options: { readonly commitment: 'confirmed' | 'finalized'; readonly maxSupportedTransactionVersion: 0 },
  ): Promise<unknown>
}

/** Everything the proof is judged against. All of it frozen before the wallet was asked. */
export interface RedaxConvertTransactionEffectExpectation {
  readonly signature: string
  readonly intendedMessage: RedaxTransactionEffectMessageCommitment
  readonly commitment: 'confirmed' | 'finalized'
  /** The attempt's accepted preflight floor; a transaction below it cannot be this attempt. */
  readonly minimumSlot: number
  readonly wallet: string
  readonly userLegacyAta: string
  readonly legacyMint: string
  readonly userOutputAta: string
  readonly outputMint: string
  readonly protocolFeeVault: string
  readonly amountIn: bigint
  readonly netOut: bigint
  readonly protocolFee: bigint
  /** `EFFECT` proves the approved movement; `NO_EFFECT` proves a failed one moved nothing. */
  readonly mode: 'EFFECT' | 'NO_EFFECT'
}

export type RedaxConvertTransactionEffectVerdict =
  | { readonly kind: 'MATCHING'; readonly transactionSlot: number }
  | { readonly kind: 'NOT_MATCHING'; readonly transactionSlot: number }
  | { readonly kind: 'UNAVAILABLE' }

const UNAVAILABLE: RedaxConvertTransactionEffectVerdict = Object.freeze({ kind: 'UNAVAILABLE' as const })

type Read = { readonly ok: true; readonly value: unknown } | { readonly ok: false }

function read(source: unknown, key: string): Read {
  if (typeof source !== 'object' || source === null) {
    return { ok: false }
  }
  try {
    return { ok: true, value: Reflect.get(source, key) }
  } catch {
    return { ok: false }
  }
}

function readText(source: unknown, key: string): string | null {
  const value = read(source, key)
  return value.ok && typeof value.value === 'string' ? value.value : null
}

/** A key as base58 text, whether the RPC client gave a `PublicKey` or a string. */
function keyText(value: unknown): string | null {
  if (typeof value === 'string') {
    return value
  }
  if (typeof value === 'object' && value !== null) {
    const toBase58 = read(value, 'toBase58')
    if (toBase58.ok && typeof toBase58.value === 'function') {
      try {
        const text = (toBase58.value as (this: unknown) => unknown).call(value)
        return typeof text === 'string' ? text : null
      } catch {
        return null
      }
    }
  }
  return null
}

interface TokenBalanceFacts {
  readonly mint: string
  readonly owner: string | null
  readonly programId: string | null
  readonly amount: bigint
}

/** The ONE entry for `accountIndex` in a token-balance list, or null for none / ambiguous. */
function tokenBalanceAt(list: unknown, accountIndex: number): TokenBalanceFacts | 'ABSENT' | null {
  if (!Array.isArray(list)) {
    return null
  }
  const matches = list.filter((entry) => {
    const index = read(entry, 'accountIndex')
    return index.ok && index.value === accountIndex
  })
  if (matches.length === 0) {
    return 'ABSENT'
  }
  if (matches.length !== 1) {
    return null
  }
  const entry: unknown = matches[0]
  const mint = readText(entry, 'mint')
  const ui = read(entry, 'uiTokenAmount')
  const amountText = ui.ok ? readText(ui.value, 'amount') : null
  if (mint === null || amountText === null || !CANONICAL_UNSIGNED_DECIMAL.test(amountText)) {
    return null
  }
  return {
    mint,
    owner: readText(entry, 'owner'),
    programId: readText(entry, 'programId'),
    amount: BigInt(amountText),
  }
}

/**
 * Prove — or refuse to prove — one convert's effect from its own transaction.
 */
export async function readRedaxConvertTransactionScopedEffect(
  reader: RedaxTransactionEffectReader,
  expected: RedaxConvertTransactionEffectExpectation,
  commit: RedaxTransactionEffectCommit,
): Promise<RedaxConvertTransactionEffectVerdict> {
  let response: unknown
  try {
    response = await reader.getTransaction(expected.signature, {
      commitment: expected.commitment,
      maxSupportedTransactionVersion: 0,
    })
  } catch {
    return UNAVAILABLE
  }
  if (response === null || response === undefined) {
    return UNAVAILABLE
  }
  const slotRead = read(response, 'slot')
  if (!slotRead.ok || typeof slotRead.value !== 'number' || !Number.isSafeInteger(slotRead.value)) {
    return UNAVAILABLE
  }
  const transactionSlot = slotRead.value
  if (transactionSlot < expected.minimumSlot) {
    // Older than the attempt itself: whatever it is, it is not this attempt.
    return { kind: 'NOT_MATCHING', transactionSlot }
  }

  // 1. EXACT MESSAGE. Only a legacy message can be the approved one.
  const transaction = read(response, 'transaction')
  const message = transaction.ok ? read(transaction.value, 'message') : { ok: false as const }
  if (!message.ok) {
    return UNAVAILABLE
  }
  const version = read(message.value, 'version')
  if (version.ok && version.value === 0) {
    return { kind: 'NOT_MATCHING', transactionSlot }
  }
  if (!version.ok || version.value !== 'legacy') {
    return UNAVAILABLE
  }
  const serialize = read(message.value, 'serialize')
  if (!serialize.ok || typeof serialize.value !== 'function') {
    return UNAVAILABLE
  }
  let serialized: unknown
  try {
    serialized = (serialize.value as (this: unknown) => unknown).call(message.value)
  } catch {
    return UNAVAILABLE
  }
  if (!(serialized instanceof Uint8Array)) {
    return UNAVAILABLE
  }
  let committed: Awaited<ReturnType<RedaxTransactionEffectCommit>>
  try {
    committed = await commit(serialized)
  } catch {
    return UNAVAILABLE
  }
  if (!committed.ok) {
    return UNAVAILABLE
  }
  if (
    committed.commitment.kind !== expected.intendedMessage.kind ||
    committed.commitment.byteLength !== expected.intendedMessage.byteLength ||
    committed.commitment.sha256Hex !== expected.intendedMessage.sha256Hex
  ) {
    return { kind: 'NOT_MATCHING', transactionSlot }
  }

  // 2. THE TRANSACTION'S OWN ERROR FIELD.
  const meta = read(response, 'meta')
  if (!meta.ok || typeof meta.value !== 'object' || meta.value === null) {
    return UNAVAILABLE
  }
  const error = read(meta.value, 'err')
  if (!error.ok || error.value === undefined) {
    return UNAVAILABLE
  }
  const failed = error.value !== null
  if (expected.mode === 'EFFECT' ? failed : !failed) {
    return { kind: 'NOT_MATCHING', transactionSlot }
  }

  // 3. THE THREE TOKEN ACCOUNTS, BY THEIR INDEX IN THE EXACT MESSAGE.
  const accountKeysRead = read(message.value, 'accountKeys')
  if (!accountKeysRead.ok || !Array.isArray(accountKeysRead.value)) {
    return UNAVAILABLE
  }
  const accountKeys = accountKeysRead.value.map(keyText)
  if (accountKeys.some((key) => key === null)) {
    return UNAVAILABLE
  }
  const indexOf = (address: string): number => accountKeys.indexOf(address)
  const legacyIndex = indexOf(expected.userLegacyAta)
  const outputIndex = indexOf(expected.userOutputAta)
  const vaultIndex = indexOf(expected.protocolFeeVault)
  if (legacyIndex < 0 || outputIndex < 0 || vaultIndex < 0) {
    // The approved message names all three; an exact message without them cannot exist.
    return { kind: 'NOT_MATCHING', transactionSlot }
  }
  const pre = read(meta.value, 'preTokenBalances')
  const post = read(meta.value, 'postTokenBalances')
  if (!pre.ok || !post.ok) {
    return UNAVAILABLE
  }

  const legs: readonly {
    readonly index: number
    readonly mint: string
    readonly owner: string | null
    readonly delta: bigint
  }[] = [
    {
      index: legacyIndex,
      mint: expected.legacyMint,
      owner: expected.wallet,
      delta: expected.mode === 'EFFECT' ? -expected.amountIn : 0n,
    },
    {
      index: outputIndex,
      mint: expected.outputMint,
      owner: expected.wallet,
      delta: expected.mode === 'EFFECT' ? expected.netOut : 0n,
    },
    {
      // The fee vault's owner is the protocol fee authority; its address was fixed by the
      // approved message, so the address and the mint are what is checked here.
      index: vaultIndex,
      mint: expected.outputMint,
      owner: null,
      delta: expected.mode === 'EFFECT' ? expected.protocolFee : 0n,
    },
  ]
  for (const leg of legs) {
    const before = tokenBalanceAt(pre.value, leg.index)
    const after = tokenBalanceAt(post.value, leg.index)
    if (before === null || after === null || before === 'ABSENT' || after === 'ABSENT') {
      // A convert requires all three accounts to exist before it runs, so a missing entry
      // is not an answer this proof can use either way.
      return UNAVAILABLE
    }
    if (before.programId === null || after.programId === null) {
      return UNAVAILABLE
    }
    if (
      before.mint !== leg.mint ||
      after.mint !== leg.mint ||
      before.programId !== CLASSIC_TOKEN_PROGRAM_ID ||
      after.programId !== CLASSIC_TOKEN_PROGRAM_ID
    ) {
      return { kind: 'NOT_MATCHING', transactionSlot }
    }
    if (leg.owner !== null) {
      if (before.owner === null || after.owner === null) {
        return UNAVAILABLE
      }
      if (before.owner !== leg.owner || after.owner !== leg.owner) {
        return { kind: 'NOT_MATCHING', transactionSlot }
      }
    }
    if (after.amount - before.amount !== leg.delta) {
      return { kind: 'NOT_MATCHING', transactionSlot }
    }
  }
  return { kind: 'MATCHING', transactionSlot }
}
