// REDAX Holder public recovery journal — one attempt, remembered honestly, and
// never turned into permission.
//
// -----------------------------------------------------------------------------
// WHAT THIS IS FOR
// -----------------------------------------------------------------------------
// A Holder has exactly ONE attempt in flight at a time, across prepare and convert
// and across every campaign and TokenConfig, for one cluster / program / wallet.
// This module is the durable memory of that attempt: it is written and read back
// BEFORE the transport is ever invoked, so a tab that dies mid-send leaves evidence
// behind instead of leaving the next tab free to send the same thing again.
//
// The single most important property is what it CANNOT do. There is no send, no
// sign, no retry, no reset, no resume and no clear. No result carries permission
// vocabulary, because a recovery journal that can be read as authorization is a
// worse hazard than no journal at all: an attacker who can write storage would then
// be writing permission. Everything here answers "what is known?", never "what may
// be done?".
//
// This module has ZERO imports. It reaches the runtime only through module-private
// structural ports resolved from `globalThis` on every exported operation, and it
// names only the members it uses: `getItem` / `setItem`, `navigator.locks.request`,
// and `crypto.getRandomValues`. `removeItem` and `clear` are deliberately absent —
// see the tombstone note below. It touches no wallet, adapter, Connection, React,
// UI, logger, network, environment or clock, and it logs nothing.

// --- Fixed vocabulary --------------------------------------------------------

/** The record's own schema literal, independent of the key's namespace generation. */
const REDAX_HOLDER_RECOVERY_JOURNAL_SCHEMA = 'redax-holder-recovery-journal-v1' as const

const REDAX_INTENDED_LEGACY_MESSAGE_COMMITMENT_KIND =
  'redax-intended-legacy-message-sha256-v1' as const

/** The namespace-generation version of the storage key and the lock name. */
const REDAX_JOURNAL_KEY_PREFIX = 'redax.holder.recovery.v1' as const
const REDAX_JOURNAL_LOCK_PREFIX = 'redax.holder.recovery.lock.v1' as const

/** The only cluster Phase 1 persists anything for. */
const REDAX_JOURNAL_CLUSTER = 'devnet' as const

/** A public base58-looking account identifier. Never decoded, never trusted further. */
const BASE58_ACCOUNT_PATTERN = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/

/** Digits only, no sign, no exponent, no separator, no leading zero except "0". */
const CANONICAL_UNSIGNED_DECIMAL_PATTERN = /^(?:0|[1-9][0-9]*)$/

/** Exactly 64 lowercase hexadecimal characters. */
const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/

/** Exactly 32 lowercase hexadecimal characters — 16 bytes of public entropy. */
const ATTEMPT_NONCE_PATTERN = /^[0-9a-f]{32}$/

/** At least one non-whitespace character. */
const NON_WHITESPACE_PATTERN = /\S/

/**
 * The exact on-chain widths, so a raw amount that could never have come from the
 * program is rejected here rather than persisted and compared later.
 *
 * Compared as BigInt. A raw amount is NEVER coerced through `Number`: `u64` and
 * `u128` both exceed the safe-integer range, and a silent precision loss in a
 * recovery record would be a silently wrong recovery record.
 */
const U64_MAX = BigInt('18446744073709551615')
const U128_MAX = BigInt('340282366920938463463374607431768211455')

/** 16 bytes of `crypto.getRandomValues`, and nothing else, ever. */
const ATTEMPT_NONCE_BYTE_LENGTH = 16

/**
 * A fixed NON-ZERO pattern written into every entropy buffer before it is filled.
 *
 * It gives "the generator did nothing" a distinguishable value. A zero prefill would
 * be indistinguishable from a generator that zero-fills, and those are two of the
 * exact silent-failure shapes the liveness guard below exists to catch.
 */
const ENTROPY_PREFILL_BYTE = 0xa5

// --- Public types ------------------------------------------------------------

/** Phase 1 persists for exactly one cluster. */
export type RedaxHolderRecoveryCluster = typeof REDAX_JOURNAL_CLUSTER

/**
 * The one slot a Holder attempt occupies.
 *
 * Deliberately NOT keyed by campaign or TokenConfig. One wallet on one program has
 * one attempt in flight, full stop — a per-campaign slot would let a holder start a
 * second send while the first was unresolved, which is the exact failure the journal
 * exists to prevent.
 */
export interface RedaxHolderRecoveryJournalNamespace {
  readonly cluster: RedaxHolderRecoveryCluster
  readonly program: string
  readonly wallet: string
}

/** The two — and only two — Holder actions that can be in flight. */
export type RedaxHolderRecoveryAction = 'prepare_user_output_ata' | 'convert_exact_in'

/**
 * How far the attempt has provably got.
 *
 * `PRE_INVOCATION` means the transport has NOT been invoked; the record is written
 * and read back before invocation precisely so that this state is trustworthy.
 * `POST_INVOCATION_SIGNATURE_UNKNOWN` is the ambiguous state that has no safe exit:
 * something may or may not have been broadcast, and nothing here can decide it.
 */
export type RedaxHolderRecoveryLifecycle =
  | 'PRE_INVOCATION'
  | 'POST_INVOCATION_SIGNATURE_UNKNOWN'
  | 'KNOWN_SIGNATURE'
  | 'TOMBSTONE'

/**
 * A versioned commitment to one compiled legacy message.
 */
export interface RedaxHolderRecoveryIntendedMessageCommitmentV1 {
  readonly kind: typeof REDAX_INTENDED_LEGACY_MESSAGE_COMMITMENT_KIND
  readonly byteLength: number
  readonly sha256Hex: string
}

export interface RedaxHolderRecoveryPrepareRequest {
  readonly campaign: string
  readonly outputMint: string
  readonly userOutputAta: string
}

/** Prepare has exactly one pre-condition worth recording: the ATA was not there. */
export interface RedaxHolderRecoveryPreparePreState {
  readonly outputAta: 'MISSING'
}

export interface RedaxHolderRecoveryConvertRequest {
  readonly campaign: string
  readonly tokenConfig: string
  readonly legacyMint: string
  readonly outputMint: string
  readonly protocolFeeVault: string
  readonly userLegacyAta: string
  readonly userOutputAta: string
  readonly amountInRaw: string
  readonly amountInNormalizedRaw: string
  readonly grossOutRaw: string
  readonly protocolFeeRaw: string
  readonly netOutRaw: string
  readonly normalizationRemainderRaw: string
}

export interface RedaxHolderRecoveryConvertPreState {
  readonly userLegacyAmountRaw: string
  readonly userOutputAmountRaw: string
  readonly protocolFeeVaultAmountRaw: string
  readonly campaignTotalOutputMintedRaw: string
  readonly campaignTotalProtocolFeesMintedRaw: string
  readonly tokenConfigTotalOutputMintedFromTcRaw: string
  readonly tokenConfigNormalizationRemainderTotalRaw: string
}

/**
 * What has been observed about the attempt. An observation, never a permission.
 *
 * `AWAITING_WALLET_APPROVAL` is deliberately ABSENT: it is ephemeral UI state that
 * exists only while a prompt is open, and persisting it would make a closed tab look
 * like a live one. It is unrepresentable here, not merely discouraged.
 */
export type RedaxHolderRecoveryJournalObservation =
  | 'PREFLIGHT_REFUSED'
  | 'SUBMISSION_OUTCOME_UNKNOWN_WITHOUT_SIGNATURE'
  | 'SIGNATURE_OBSERVED'
  | 'CONFIRMATION_PENDING'
  | 'LANDED_TRANSACTION_FAILED'
  | 'LANDED_MESSAGE_MISMATCH'
  | 'CONFIRMED_EFFECT_MATCHING'
  | 'FINALIZED_EFFECT_MATCHING'
  | 'READ_UNAVAILABLE'
  | 'SUPPORT_ONLY'
  | 'EFFECT_PRESENT_ORIGIN_UNKNOWN'

/** Observed confirmation level. `unknown` whenever the provider did not say exactly. */
export type RedaxHolderRecoveryOutcomeFinality =
  | 'unknown'
  | 'processed'
  | 'confirmed'
  | 'finalized'

/**
 * How an attempt ended. A tombstone always carries exactly one of these.
 *
 * `ACCEPTED_SUPPORT_DISPOSITION` is permanently non-replaceable. Acknowledging that
 * an attempt is unresolved does not make it resolved, and it must never quietly
 * become a licence to send again.
 */
export type RedaxHolderRecoveryJournalResolution =
  | 'PRE_INVOCATION_REFUSAL'
  | 'FINALIZED_SUCCESS'
  | 'ACCEPTED_RESOLVED_KNOWN_SIGNATURE_FAILURE'
  | 'ACCEPTED_SUPPORT_DISPOSITION'

/**
 * The exact V1 public record.
 *
 * Every nullable member is REQUIRED and explicitly present. A missing key and an
 * `undefined` value are both invalid; only an explicit `null` means null. Reading an
 * absent member as "nothing to report" is exactly how a truncated or hostile record
 * would become a clean one.
 *
 * There is no timestamp and no TTL. Nothing here expires, because "old enough" has
 * never been evidence that a transaction did not land.
 */
export interface RedaxHolderRecoveryJournalRecordV1 {
  readonly schema: typeof REDAX_HOLDER_RECOVERY_JOURNAL_SCHEMA
  readonly namespace: RedaxHolderRecoveryJournalNamespace
  readonly action: RedaxHolderRecoveryAction
  readonly attemptNonce: string
  readonly revision: number
  readonly lifecycle: RedaxHolderRecoveryLifecycle
  readonly intendedMessage: RedaxHolderRecoveryIntendedMessageCommitmentV1
  readonly preflightContextSlot: number
  readonly lastValidBlockHeight: number
  readonly request: RedaxHolderRecoveryPrepareRequest | RedaxHolderRecoveryConvertRequest
  readonly preState: RedaxHolderRecoveryPreparePreState | RedaxHolderRecoveryConvertPreState
  readonly knownSignature: string | null
  readonly observation: RedaxHolderRecoveryJournalObservation | null
  readonly outcomeFinality: RedaxHolderRecoveryOutcomeFinality | null
  readonly resolution: RedaxHolderRecoveryJournalResolution | null
}

/** The identity a mutation must present. Wrong identity is a conflict, never a merge. */
export interface RedaxHolderRecoveryAttemptIdentity {
  readonly attemptNonce: string
  readonly revision: number
}

/** Begin a fresh attempt, or replace a replaceable tombstone under exact identity. */
export interface RedaxHolderRecoveryBeginInput {
  readonly namespace: RedaxHolderRecoveryJournalNamespace
  readonly action: RedaxHolderRecoveryAction
  readonly intendedMessage: RedaxHolderRecoveryIntendedMessageCommitmentV1
  readonly preflightContextSlot: number
  readonly lastValidBlockHeight: number
  readonly request: RedaxHolderRecoveryPrepareRequest | RedaxHolderRecoveryConvertRequest
  readonly preState: RedaxHolderRecoveryPreparePreState | RedaxHolderRecoveryConvertPreState
  /** Explicitly `null` for a fresh slot; the exact tombstone identity to replace one. */
  readonly replaces: RedaxHolderRecoveryAttemptIdentity | null
}

/** The complete, closed set of state changes. There is no seventh. */
export type RedaxHolderRecoveryTransition =
  | { readonly type: 'MARK_INVOCATION_STARTED' }
  | { readonly type: 'RETAIN_KNOWN_SIGNATURE'; readonly knownSignature: string }
  | {
      readonly type: 'RECORD_OBSERVATION'
      readonly observation: RedaxHolderRecoveryJournalObservation
      readonly outcomeFinality: RedaxHolderRecoveryOutcomeFinality | null
    }
  | { readonly type: 'RESOLVE_PRE_INVOCATION_REFUSAL' }
  | { readonly type: 'RESOLVE_FINALIZED_SUCCESS' }
  | { readonly type: 'RESOLVE_KNOWN_SIGNATURE_FAILURE' }
  | { readonly type: 'ACKNOWLEDGE_SUPPORT_DISPOSITION' }

export interface RedaxHolderRecoveryTransitionInput {
  readonly namespace: RedaxHolderRecoveryJournalNamespace
  readonly expectedAttemptNonce: string
  readonly expectedRevision: number
  readonly transition: RedaxHolderRecoveryTransition
}

/**
 * Every way an operation can decline. Fixed, closed and value-free.
 *
 * None of these is a retry code. `LIVE_DELETION_DETECTED` and
 * `LIVE_ROLLBACK_DETECTED` in particular mean "the record moved under us", which
 * makes the situation LESS knowable, not more — they never recreate, reset or
 * re-authorize anything.
 */
export type RedaxHolderRecoveryJournalFailureCode =
  | 'INPUT_INVALID'
  | 'NAMESPACE_INVALID'
  | 'ENTROPY_UNAVAILABLE'
  | 'STORAGE_UNAVAILABLE'
  | 'LOCK_MANAGER_UNAVAILABLE'
  | 'LOCK_UNAVAILABLE'
  | 'JOURNAL_CORRUPT'
  | 'JOURNAL_INCOMPATIBLE'
  | 'ACTIVE_ATTEMPT_EXISTS'
  | 'TOMBSTONE_NOT_REPLACEABLE'
  | 'CAS_CONFLICT'
  | 'TRANSITION_INVALID'
  | 'REVISION_EXHAUSTED'
  | 'WRITE_VERIFICATION_FAILED'
  | 'LIVE_DELETION_DETECTED'
  | 'LIVE_ROLLBACK_DETECTED'

export type RedaxHolderRecoveryJournalReadResult =
  | { readonly ok: true; readonly kind: 'EMPTY' }
  | {
      readonly ok: true
      readonly kind: 'ACTIVE'
      readonly record: RedaxHolderRecoveryJournalRecordV1
    }
  | {
      readonly ok: true
      readonly kind: 'TOMBSTONE'
      readonly record: RedaxHolderRecoveryJournalRecordV1
    }
  | { readonly ok: false; readonly code: RedaxHolderRecoveryJournalFailureCode }

export type RedaxHolderRecoveryJournalWriteResult =
  | {
      readonly ok: true
      readonly kind: 'CREATED'
      readonly record: RedaxHolderRecoveryJournalRecordV1
    }
  | {
      readonly ok: true
      readonly kind: 'UPDATED'
      readonly record: RedaxHolderRecoveryJournalRecordV1
    }
  | {
      readonly ok: true
      readonly kind: 'TOMBSTONED'
      readonly record: RedaxHolderRecoveryJournalRecordV1
    }
  | { readonly ok: false; readonly code: RedaxHolderRecoveryJournalFailureCode }

// --- Module-private platform ports --------------------------------------------
//
// Resolved from `globalThis` on EVERY exported operation, never cached. A cached
// port would survive a page state the caller believes it has left, and a stale
// storage handle is precisely the kind of thing a recovery journal must not hold.
//
// Each port names only the members actually used, and each is declared structurally
// rather than against a DOM type, so this file compiles identically under the app's
// DOM lib and under the test runner's Node types — while making `removeItem`,
// `clear` and `sessionStorage` unreachable rather than merely forbidden.

interface RedaxJournalStoragePort {
  getItem(key: string): unknown
  setItem(key: string, value: string): unknown
}

interface RedaxJournalLockManagerPort {
  request(
    name: string,
    options: { readonly mode: 'exclusive'; readonly ifAvailable: true },
    callback: (lock: unknown) => Promise<void>,
  ): Promise<unknown>
}

interface RedaxJournalEntropyPort {
  getRandomValues(target: Uint8Array): unknown
}

function resolveStoragePort(): RedaxJournalStoragePort | null {
  let candidate: unknown
  try {
    candidate = (globalThis as { localStorage?: unknown }).localStorage
  } catch {
    // A storage accessor can throw outright — a disabled or partitioned origin does
    // exactly this — and that is unavailability, not an exception for the caller.
    return null
  }
  if (typeof candidate !== 'object' || candidate === null) {
    return null
  }
  const port = candidate as RedaxJournalStoragePort
  let getItem: unknown
  let setItem: unknown
  try {
    getItem = port.getItem
    setItem = port.setItem
  } catch {
    return null
  }
  if (typeof getItem !== 'function' || typeof setItem !== 'function') {
    return null
  }
  return port
}

function resolveLockManagerPort(): RedaxJournalLockManagerPort | null {
  let navigatorCandidate: unknown
  try {
    navigatorCandidate = (globalThis as { navigator?: unknown }).navigator
  } catch {
    return null
  }
  if (typeof navigatorCandidate !== 'object' || navigatorCandidate === null) {
    return null
  }
  let locksCandidate: unknown
  try {
    locksCandidate = (navigatorCandidate as { locks?: unknown }).locks
  } catch {
    return null
  }
  if (typeof locksCandidate !== 'object' || locksCandidate === null) {
    return null
  }
  const port = locksCandidate as RedaxJournalLockManagerPort
  let request: unknown
  try {
    request = port.request
  } catch {
    return null
  }
  if (typeof request !== 'function') {
    return null
  }
  return port
}

function resolveEntropyPort(): RedaxJournalEntropyPort | null {
  let candidate: unknown
  try {
    candidate = (globalThis as { crypto?: unknown }).crypto
  } catch {
    return null
  }
  if (typeof candidate !== 'object' || candidate === null) {
    return null
  }
  const port = candidate as RedaxJournalEntropyPort
  let getRandomValues: unknown
  try {
    getRandomValues = port.getRandomValues
  } catch {
    return null
  }
  if (typeof getRandomValues !== 'function') {
    return null
  }
  return port
}

/**
 * One 16-byte draw into a buffer nothing else has touched, or nothing at all.
 *
 * Web Crypto fills the caller's array IN PLACE and returns that same array, so a
 * `getRandomValues` that returns anything else is not the function this module needs.
 * Identity alone proves very little, though: a no-op that simply hands its argument
 * back satisfies it while writing not one byte. The buffer is therefore prefilled
 * with a fixed non-zero sentinel and inspected afterwards, which makes an untouched
 * buffer and an all-zero fill both visible.
 *
 * These are BOUNDED STRUCTURAL LIVENESS CHECKS. They do not authenticate the
 * generator, they do not measure the quality of its output, and nothing here may be
 * read as either. A healthy generator can fail them only by drawing one exact 16-byte
 * value, which is negligible — bounded by a small multiple of 2^-128.
 */
function drawEntropyBytes(entropy: RedaxJournalEntropyPort): Uint8Array | null {
  const bytes = new Uint8Array(ATTEMPT_NONCE_BYTE_LENGTH)
  bytes.fill(ENTROPY_PREFILL_BYTE)
  let returned: unknown
  try {
    returned = entropy.getRandomValues(bytes)
  } catch {
    return null
  }
  if (returned !== bytes) {
    return null
  }
  let movedOffSentinel = false
  let anyNonZero = false
  for (const byte of bytes) {
    if (byte !== ENTROPY_PREFILL_BYTE) {
      movedOffSentinel = true
    }
    if (byte !== 0) {
      anyNonZero = true
    }
  }
  return movedOffSentinel && anyNonZero ? bytes : null
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) {
    return false
  }
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false
    }
  }
  return true
}

/**
 * 16 bytes of public entropy, as 32 lowercase hexadecimal characters.
 *
 * The nonce is a COLLISION-RESISTANT PUBLIC IDENTITY, not a secret and not a
 * capability: it identifies which attempt a compare-and-set is talking about. There
 * is deliberately no counter, no timestamp, no caller-supplied value and no injected
 * entropy seam — each of those would let two tabs mint the same identity, and the
 * last would let a test weaken production.
 *
 * TWO independent buffers are drawn and an identical pair is refused, because a
 * generator stuck on a single constant passes every check a single draw can make
 * while handing two tabs the same attempt identity. Only the first draw becomes the
 * nonce; the second is evidence about the generator and nothing else.
 */
function generateAttemptNonce(): string | null {
  const entropy = resolveEntropyPort()
  if (entropy === null) {
    return null
  }
  const first = drawEntropyBytes(entropy)
  const second = first === null ? null : drawEntropyBytes(entropy)
  if (first === null || second === null || sameBytes(first, second)) {
    return null
  }
  let hex = ''
  for (const byte of first) {
    hex += byte.toString(16).padStart(2, '0')
  }
  return ATTEMPT_NONCE_PATTERN.test(hex) ? hex : null
}

// --- Protected structural reading ---------------------------------------------

type ProtectedRead = { readonly ok: true; readonly value: unknown } | { readonly ok: false }

const READ_FAILED: ProtectedRead = Object.freeze({ ok: false as const })

/**
 * Read one property of untrusted input.
 *
 * `Reflect.get` inside a `try`, every time. Stored text is parsed into ordinary
 * objects, but the INPUTS to `begin` and `transition` are caller-owned and can
 * define any property as an accessor that throws — and a raw throw escaping past the
 * declared result union is the one thing these operations promise never to do.
 *
 * No `instanceof` and no prototype inspection anywhere in this file: a record is
 * judged by the evidence it carries, never by the constructor it happens to have.
 */
function readProperty(source: unknown, key: string): ProtectedRead {
  if (typeof source !== 'object' || source === null) {
    return READ_FAILED
  }
  try {
    return { ok: true, value: Reflect.get(source, key) }
  } catch {
    return READ_FAILED
  }
}

/**
 * The value at `key`, or `undefined` when it cannot be read at all.
 *
 * Collapsing an unreadable property to `undefined` is safe only because every
 * consumer of this helper is a sub-validator that requires an exact object shape:
 * `undefined` fails all of them, so a hostile accessor and a missing key reach the
 * same refusal by the same path.
 */
function readValueOrUndefined(source: unknown, key: string): unknown {
  const read = readProperty(source, key)
  return read.ok ? read.value : undefined
}

/**
 * A non-null, non-array object. Arrays are never a record, a namespace or a field set.
 *
 * `Array.isArray` sits inside the `try` for the same reason every property read in this
 * file does: it THROWS on a revoked Proxy. A caller-owned value that has since been
 * revoked must reach the same fixed refusal as any other value that is not a record —
 * never a rejected promise out of an operation that promises a total result. Every
 * protected parse in this file asks this question first, so the guard belongs here
 * rather than at each call site.
 */
function isRecordCandidate(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  try {
    return !Array.isArray(value)
  } catch {
    return false
  }
}

/**
 * The EXACT own-key set of an untrusted object.
 *
 * `getOwnPropertyNames`, not `keys`: a non-enumerable own key is still an own key,
 * and `__proto__` — which `JSON.parse` materialises as an ordinary own data property
 * — must be visible here so the exact-set comparison rejects it as unexpected rather
 * than silently ignoring it.
 */
function ownKeys(value: unknown): string[] | null {
  if (!isRecordCandidate(value)) {
    return null
  }
  try {
    return Object.getOwnPropertyNames(value).sort()
  } catch {
    return null
  }
}

function hasExactKeys(value: unknown, expected: readonly string[]): boolean {
  const observed = ownKeys(value)
  if (observed === null || observed.length !== expected.length) {
    return false
  }
  const wanted = [...expected].sort()
  for (let index = 0; index < wanted.length; index += 1) {
    if (observed[index] !== wanted[index]) {
      return false
    }
  }
  return true
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

function isAccountIdentifier(value: unknown): value is string {
  return typeof value === 'string' && BASE58_ACCOUNT_PATTERN.test(value)
}

/**
 * A canonical unsigned decimal within an exact on-chain width.
 *
 * The pattern rejects a sign, an exponent, whitespace, a separator and a leading
 * zero before it ever reaches arithmetic; the bound is then checked as BigInt. There
 * is no `Number` anywhere on this path — `u64` and `u128` do not fit in one.
 */
function isCanonicalRawAmount(value: unknown, max: bigint): value is string {
  if (typeof value !== 'string' || !CANONICAL_UNSIGNED_DECIMAL_PATTERN.test(value)) {
    return false
  }
  let parsed: bigint
  try {
    parsed = BigInt(value)
  } catch {
    return false
  }
  return parsed <= max
}

/**
 * A known signature, preserved EXACTLY.
 *
 * No trim, no case fold, no base58 test. Rejecting a signature a wallet really
 * returned would DISCARD a known signature, which is the single worst thing this
 * whole route can do — so the only shape it can fail is "not a string with at least
 * one non-whitespace character".
 */
function isKnownSignature(value: unknown): value is string {
  return typeof value === 'string' && NON_WHITESPACE_PATTERN.test(value)
}

// --- The exact field model -----------------------------------------------------
//
// One table per action, used by BOTH the parser and the canonical serializer, so the
// two can never disagree about which fields exist or what order they are in.

type FieldKind = 'account' | 'u64' | 'u128' | 'output-ata-missing'

interface FieldSpec {
  readonly key: string
  readonly kind: FieldKind
}

const PREPARE_REQUEST_FIELDS: readonly FieldSpec[] = [
  { key: 'campaign', kind: 'account' },
  { key: 'outputMint', kind: 'account' },
  { key: 'userOutputAta', kind: 'account' },
]

const PREPARE_PRE_STATE_FIELDS: readonly FieldSpec[] = [
  { key: 'outputAta', kind: 'output-ata-missing' },
]

const CONVERT_REQUEST_FIELDS: readonly FieldSpec[] = [
  { key: 'campaign', kind: 'account' },
  { key: 'tokenConfig', kind: 'account' },
  { key: 'legacyMint', kind: 'account' },
  { key: 'outputMint', kind: 'account' },
  { key: 'protocolFeeVault', kind: 'account' },
  { key: 'userLegacyAta', kind: 'account' },
  { key: 'userOutputAta', kind: 'account' },
  { key: 'amountInRaw', kind: 'u64' },
  { key: 'amountInNormalizedRaw', kind: 'u128' },
  { key: 'grossOutRaw', kind: 'u128' },
  { key: 'protocolFeeRaw', kind: 'u128' },
  { key: 'netOutRaw', kind: 'u128' },
  { key: 'normalizationRemainderRaw', kind: 'u128' },
]

const CONVERT_PRE_STATE_FIELDS: readonly FieldSpec[] = [
  { key: 'userLegacyAmountRaw', kind: 'u64' },
  { key: 'userOutputAmountRaw', kind: 'u64' },
  { key: 'protocolFeeVaultAmountRaw', kind: 'u64' },
  { key: 'campaignTotalOutputMintedRaw', kind: 'u128' },
  { key: 'campaignTotalProtocolFeesMintedRaw', kind: 'u128' },
  { key: 'tokenConfigTotalOutputMintedFromTcRaw', kind: 'u128' },
  { key: 'tokenConfigNormalizationRemainderTotalRaw', kind: 'u128' },
]

function requestFieldsFor(action: RedaxHolderRecoveryAction): readonly FieldSpec[] {
  return action === 'convert_exact_in' ? CONVERT_REQUEST_FIELDS : PREPARE_REQUEST_FIELDS
}

function preStateFieldsFor(action: RedaxHolderRecoveryAction): readonly FieldSpec[] {
  return action === 'convert_exact_in' ? CONVERT_PRE_STATE_FIELDS : PREPARE_PRE_STATE_FIELDS
}

function isValidFieldValue(value: unknown, kind: FieldKind): value is string {
  switch (kind) {
    case 'account':
      return isAccountIdentifier(value)
    case 'u64':
      return isCanonicalRawAmount(value, U64_MAX)
    case 'u128':
      return isCanonicalRawAmount(value, U128_MAX)
    case 'output-ata-missing':
      return value === 'MISSING'
  }
}

/**
 * Validate one field set and COPY it into a fresh plain object.
 *
 * Copying is not ceremony. Holding the caller's object by reference would let a
 * caller mutate the request after it was journaled, so the record would describe an
 * attempt nobody made.
 */
function readFieldSet(source: unknown, specs: readonly FieldSpec[]): Record<string, string> | null {
  if (!hasExactKeys(source, specs.map((spec) => spec.key))) {
    return null
  }
  const copied: Record<string, string> = {}
  for (const spec of specs) {
    const read = readProperty(source, spec.key)
    if (!read.ok || !isValidFieldValue(read.value, spec.kind)) {
      return null
    }
    copied[spec.key] = read.value
  }
  return copied
}

// --- The record, internally ----------------------------------------------------

const RECORD_KEYS: readonly string[] = [
  'schema',
  'namespace',
  'action',
  'attemptNonce',
  'revision',
  'lifecycle',
  'intendedMessage',
  'preflightContextSlot',
  'lastValidBlockHeight',
  'request',
  'preState',
  'knownSignature',
  'observation',
  'outcomeFinality',
  'resolution',
]

const NAMESPACE_KEYS: readonly string[] = ['cluster', 'program', 'wallet']
const COMMITMENT_KEYS: readonly string[] = ['kind', 'byteLength', 'sha256Hex']

const ACTIONS: readonly RedaxHolderRecoveryAction[] = [
  'prepare_user_output_ata',
  'convert_exact_in',
]

const LIFECYCLES: readonly RedaxHolderRecoveryLifecycle[] = [
  'PRE_INVOCATION',
  'POST_INVOCATION_SIGNATURE_UNKNOWN',
  'KNOWN_SIGNATURE',
  'TOMBSTONE',
]

const OBSERVATIONS: readonly RedaxHolderRecoveryJournalObservation[] = [
  'PREFLIGHT_REFUSED',
  'SUBMISSION_OUTCOME_UNKNOWN_WITHOUT_SIGNATURE',
  'SIGNATURE_OBSERVED',
  'CONFIRMATION_PENDING',
  'LANDED_TRANSACTION_FAILED',
  'LANDED_MESSAGE_MISMATCH',
  'CONFIRMED_EFFECT_MATCHING',
  'FINALIZED_EFFECT_MATCHING',
  'READ_UNAVAILABLE',
  'SUPPORT_ONLY',
  'EFFECT_PRESENT_ORIGIN_UNKNOWN',
]

const FINALITIES: readonly RedaxHolderRecoveryOutcomeFinality[] = [
  'unknown',
  'processed',
  'confirmed',
  'finalized',
]

const RESOLUTIONS: readonly RedaxHolderRecoveryJournalResolution[] = [
  'PRE_INVOCATION_REFUSAL',
  'FINALIZED_SUCCESS',
  'ACCEPTED_RESOLVED_KNOWN_SIGNATURE_FAILURE',
  'ACCEPTED_SUPPORT_DISPOSITION',
]

/** The tombstones a fresh attempt may replace. Support disposition is never one. */
const REPLACEABLE_RESOLUTIONS: readonly RedaxHolderRecoveryJournalResolution[] = [
  'PRE_INVOCATION_REFUSAL',
  'FINALIZED_SUCCESS',
  'ACCEPTED_RESOLVED_KNOWN_SIGNATURE_FAILURE',
]

/**
 * Transitions only the realm that CREATED the attempt may legitimately perform.
 *
 * Both write a durable claim about what the origin session did with the transport —
 * that it handed the attempt over, or that it never did. No other actor can know
 * either fact, so no other actor may assert it.
 */
const ORIGIN_ONLY_TRANSITIONS: readonly RedaxHolderRecoveryTransition['type'][] = [
  'MARK_INVOCATION_STARTED',
  'RESOLVE_PRE_INVOCATION_REFUSAL',
]

/** Observations a record may carry while the transport outcome has no signature. */
const SIGNATURELESS_OBSERVATIONS: readonly RedaxHolderRecoveryJournalObservation[] = [
  'SUBMISSION_OUTCOME_UNKNOWN_WITHOUT_SIGNATURE',
  'READ_UNAVAILABLE',
  'SUPPORT_ONLY',
  'EFFECT_PRESENT_ORIGIN_UNKNOWN',
]

/** Observations a record may carry once an exact signature is known. */
const KNOWN_SIGNATURE_OBSERVATIONS: readonly RedaxHolderRecoveryJournalObservation[] = [
  'SIGNATURE_OBSERVED',
  'CONFIRMATION_PENDING',
  'LANDED_TRANSACTION_FAILED',
  'LANDED_MESSAGE_MISMATCH',
  'CONFIRMED_EFFECT_MATCHING',
  'FINALIZED_EFFECT_MATCHING',
  'READ_UNAVAILABLE',
  'SUPPORT_ONLY',
]

/** The mutable shape a record is assembled in, before it is frozen and published. */
interface JournalDraft {
  schema: typeof REDAX_HOLDER_RECOVERY_JOURNAL_SCHEMA
  namespace: RedaxHolderRecoveryJournalNamespace
  action: RedaxHolderRecoveryAction
  attemptNonce: string
  revision: number
  lifecycle: RedaxHolderRecoveryLifecycle
  intendedMessage: RedaxHolderRecoveryIntendedMessageCommitmentV1
  preflightContextSlot: number
  lastValidBlockHeight: number
  request: Record<string, string>
  preState: Record<string, string>
  knownSignature: string | null
  observation: RedaxHolderRecoveryJournalObservation | null
  outcomeFinality: RedaxHolderRecoveryOutcomeFinality | null
  resolution: RedaxHolderRecoveryJournalResolution | null
}

/**
 * Freeze a draft, top to bottom, and publish it as the public record type.
 *
 * The single cast in this file. The field sets have already been validated
 * key-by-key against the exact table for the action, so the object really does have
 * the declared shape; TypeScript simply cannot see a table-driven proof.
 */
function publishRecord(draft: JournalDraft): RedaxHolderRecoveryJournalRecordV1 {
  Object.freeze(draft.namespace)
  Object.freeze(draft.intendedMessage)
  Object.freeze(draft.request)
  Object.freeze(draft.preState)
  return Object.freeze(draft) as unknown as RedaxHolderRecoveryJournalRecordV1
}

/** Read a published record's field sets back as a plain lookup, for serialization. */
function fieldsOf(value: object): Record<string, string> {
  return value as unknown as Record<string, string>
}

/**
 * Is this draft a state the model actually admits?
 *
 * Applied to EVERY record — parsed from storage or constructed here — so a
 * transition cannot produce a shape the parser would later reject, and a hostile
 * writer cannot invent one the transitions could never have reached.
 */
function isCoherent(draft: JournalDraft): boolean {
  const signed = draft.knownSignature !== null
  const isPrepare = draft.action === 'prepare_user_output_ata'

  if (
    draft.observation === 'EFFECT_PRESENT_ORIGIN_UNKNOWN' &&
    !isPrepare
  ) {
    // Convert has no "the effect is simply there" state: an output ATA can appear
    // for reasons unrelated to this attempt, but burnt legacy tokens cannot.
    return false
  }

  switch (draft.lifecycle) {
    case 'PRE_INVOCATION':
      return (
        !signed &&
        draft.observation === null &&
        draft.outcomeFinality === null &&
        draft.resolution === null
      )
    case 'POST_INVOCATION_SIGNATURE_UNKNOWN':
      return (
        !signed &&
        draft.observation !== null &&
        SIGNATURELESS_OBSERVATIONS.includes(draft.observation) &&
        (draft.outcomeFinality === null || draft.outcomeFinality === 'unknown') &&
        draft.resolution === null
      )
    case 'KNOWN_SIGNATURE':
      return (
        signed &&
        draft.observation !== null &&
        KNOWN_SIGNATURE_OBSERVATIONS.includes(draft.observation) &&
        draft.resolution === null &&
        isFinalityCoherent(draft.observation, draft.outcomeFinality)
      )
    case 'TOMBSTONE':
      return isTombstoneCoherent(draft, signed)
  }
}

function isFinalityCoherent(
  observation: RedaxHolderRecoveryJournalObservation,
  finality: RedaxHolderRecoveryOutcomeFinality | null,
): boolean {
  if (observation === 'CONFIRMED_EFFECT_MATCHING') {
    return finality === 'confirmed'
  }
  if (observation === 'FINALIZED_EFFECT_MATCHING') {
    return finality === 'finalized'
  }
  return true
}

function isTombstoneCoherent(draft: JournalDraft, signed: boolean): boolean {
  switch (draft.resolution) {
    case 'PRE_INVOCATION_REFUSAL':
      return (
        !signed &&
        draft.observation === 'PREFLIGHT_REFUSED' &&
        draft.outcomeFinality === null
      )
    case 'FINALIZED_SUCCESS':
      return (
        signed &&
        draft.observation === 'FINALIZED_EFFECT_MATCHING' &&
        draft.outcomeFinality === 'finalized'
      )
    case 'ACCEPTED_RESOLVED_KNOWN_SIGNATURE_FAILURE':
      return (
        signed &&
        draft.observation !== null &&
        (draft.observation === 'LANDED_TRANSACTION_FAILED' ||
          draft.observation === 'LANDED_MESSAGE_MISMATCH') &&
        draft.outcomeFinality === 'finalized'
      )
    case 'ACCEPTED_SUPPORT_DISPOSITION':
      return draft.observation === 'SUPPORT_ONLY'
    case null:
      // An unresolved tombstone is a contradiction: the record claims to be over and
      // cannot say how it ended.
      return false
  }
}

// --- Canonical serialization ---------------------------------------------------

/**
 * ONE serialization, in ONE fixed recursive key order, with every null explicit.
 *
 * Determinism is what makes the stored text comparable. A record read back is
 * re-serialized and required to equal the stored bytes exactly, which rejects
 * whitespace variants, key reordering, duplicate-member last-write semantics and any
 * external rewrite — without this module ever having to guess whether a difference
 * was benign.
 */
function canonicalize(draft: JournalDraft): string {
  const requestFields = fieldsOf(draft.request)
  const preStateFields = fieldsOf(draft.preState)
  const orderedRequest: Record<string, string> = {}
  for (const spec of requestFieldsFor(draft.action)) {
    orderedRequest[spec.key] = requestFields[spec.key]
  }
  const orderedPreState: Record<string, string> = {}
  for (const spec of preStateFieldsFor(draft.action)) {
    orderedPreState[spec.key] = preStateFields[spec.key]
  }
  return JSON.stringify({
    schema: draft.schema,
    namespace: {
      cluster: draft.namespace.cluster,
      program: draft.namespace.program,
      wallet: draft.namespace.wallet,
    },
    action: draft.action,
    attemptNonce: draft.attemptNonce,
    revision: draft.revision,
    lifecycle: draft.lifecycle,
    intendedMessage: {
      kind: draft.intendedMessage.kind,
      byteLength: draft.intendedMessage.byteLength,
      sha256Hex: draft.intendedMessage.sha256Hex,
    },
    preflightContextSlot: draft.preflightContextSlot,
    lastValidBlockHeight: draft.lastValidBlockHeight,
    request: orderedRequest,
    preState: orderedPreState,
    knownSignature: draft.knownSignature,
    observation: draft.observation,
    outcomeFinality: draft.outcomeFinality,
    resolution: draft.resolution,
  })
}

/** A record read back out of a published one, so transitions can build the next. */
function draftOf(record: RedaxHolderRecoveryJournalRecordV1): JournalDraft {
  return {
    schema: record.schema,
    namespace: {
      cluster: record.namespace.cluster,
      program: record.namespace.program,
      wallet: record.namespace.wallet,
    },
    action: record.action,
    attemptNonce: record.attemptNonce,
    revision: record.revision,
    lifecycle: record.lifecycle,
    intendedMessage: {
      kind: record.intendedMessage.kind,
      byteLength: record.intendedMessage.byteLength,
      sha256Hex: record.intendedMessage.sha256Hex,
    },
    preflightContextSlot: record.preflightContextSlot,
    lastValidBlockHeight: record.lastValidBlockHeight,
    request: { ...fieldsOf(record.request) },
    preState: { ...fieldsOf(record.preState) },
    knownSignature: record.knownSignature,
    observation: record.observation,
    outcomeFinality: record.outcomeFinality,
    resolution: record.resolution,
  }
}

// --- The strict parser ----------------------------------------------------------

type ParsedJournal =
  | {
      readonly ok: true
      readonly record: RedaxHolderRecoveryJournalRecordV1
      readonly canonical: string
    }
  | { readonly ok: false; readonly code: 'JOURNAL_CORRUPT' | 'JOURNAL_INCOMPATIBLE' }

const JOURNAL_CORRUPT: ParsedJournal = Object.freeze({
  ok: false as const,
  code: 'JOURNAL_CORRUPT' as const,
})

const JOURNAL_INCOMPATIBLE: ParsedJournal = Object.freeze({
  ok: false as const,
  code: 'JOURNAL_INCOMPATIBLE' as const,
})

/** Membership in a closed vocabulary. An unknown member is never coerced or mapped. */
function toEnum<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  if (typeof value !== 'string') {
    return null
  }
  const found = allowed.find((candidate) => candidate === value)
  return found === undefined ? null : found
}

/**
 * Read a property ONCE and classify it.
 *
 * Once matters. Caller input can define a property as an accessor that answers
 * differently each time, so every property on every untrusted object is consulted a
 * single time and the answer is what the operation uses from then on.
 */
function readEnum<T extends string>(
  source: unknown,
  key: string,
  allowed: readonly T[],
): T | null {
  const read = readProperty(source, key)
  return read.ok ? toEnum(read.value, allowed) : null
}

function parseNamespaceValue(value: unknown): RedaxHolderRecoveryJournalNamespace | null {
  if (!hasExactKeys(value, NAMESPACE_KEYS)) {
    return null
  }
  const cluster = readProperty(value, 'cluster')
  const program = readProperty(value, 'program')
  const wallet = readProperty(value, 'wallet')
  if (
    !cluster.ok ||
    cluster.value !== REDAX_JOURNAL_CLUSTER ||
    !program.ok ||
    !isAccountIdentifier(program.value) ||
    !wallet.ok ||
    !isAccountIdentifier(wallet.value)
  ) {
    return null
  }
  return {
    cluster: REDAX_JOURNAL_CLUSTER,
    program: program.value,
    wallet: wallet.value,
  }
}

function parseCommitmentValue(
  value: unknown,
): RedaxHolderRecoveryIntendedMessageCommitmentV1 | null {
  if (!hasExactKeys(value, COMMITMENT_KEYS)) {
    return null
  }
  const kind = readProperty(value, 'kind')
  const byteLength = readProperty(value, 'byteLength')
  const sha256Hex = readProperty(value, 'sha256Hex')
  if (
    !kind.ok ||
    kind.value !== REDAX_INTENDED_LEGACY_MESSAGE_COMMITMENT_KIND ||
    !byteLength.ok ||
    !isPositiveSafeInteger(byteLength.value) ||
    !sha256Hex.ok ||
    typeof sha256Hex.value !== 'string' ||
    !SHA256_HEX_PATTERN.test(sha256Hex.value)
  ) {
    return null
  }
  return {
    kind: REDAX_INTENDED_LEGACY_MESSAGE_COMMITMENT_KIND,
    byteLength: byteLength.value,
    sha256Hex: sha256Hex.value,
  }
}

/** A REQUIRED nullable member: absent and `undefined` are invalid; only `null` is null. */
function readRequiredNullable(source: unknown, key: string): ProtectedRead {
  const read = readProperty(source, key)
  if (!read.ok || read.value === undefined) {
    return READ_FAILED
  }
  return read
}

/**
 * Parse untrusted stored text into a validated, frozen record.
 *
 * The stored value is HOSTILE INPUT. It is public, it is writable by anything with
 * access to the origin, and it must never be able to reach past this function as
 * anything but a fully validated record or a fixed refusal.
 */
function parseJournalText(raw: string): ParsedJournal {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return JOURNAL_CORRUPT
  }
  if (!isRecordCandidate(parsed)) {
    // `null`, an array, a number, a string: none of them is a record.
    return JOURNAL_CORRUPT
  }

  // The schema literal is read FIRST, so a future generation stored at this key is
  // reported as incompatible rather than as damage.
  const schema = readProperty(parsed, 'schema')
  if (!schema.ok || schema.value !== REDAX_HOLDER_RECOVERY_JOURNAL_SCHEMA) {
    return JOURNAL_INCOMPATIBLE
  }
  if (!hasExactKeys(parsed, RECORD_KEYS)) {
    return JOURNAL_CORRUPT
  }

  const namespace = parseNamespaceValue(readValueOrUndefined(parsed, 'namespace'))
  const action = readEnum(parsed, 'action', ACTIONS)
  const lifecycle = readEnum(parsed, 'lifecycle', LIFECYCLES)
  if (namespace === null || action === null || lifecycle === null) {
    return JOURNAL_CORRUPT
  }

  const attemptNonce = readProperty(parsed, 'attemptNonce')
  const revision = readProperty(parsed, 'revision')
  if (
    !attemptNonce.ok ||
    typeof attemptNonce.value !== 'string' ||
    !ATTEMPT_NONCE_PATTERN.test(attemptNonce.value) ||
    !revision.ok ||
    !isPositiveSafeInteger(revision.value)
  ) {
    return JOURNAL_CORRUPT
  }

  const intendedMessage = parseCommitmentValue(readValueOrUndefined(parsed, 'intendedMessage'))
  if (intendedMessage === null) {
    return JOURNAL_CORRUPT
  }

  const preflightContextSlot = readProperty(parsed, 'preflightContextSlot')
  const lastValidBlockHeight = readProperty(parsed, 'lastValidBlockHeight')
  if (
    !preflightContextSlot.ok ||
    !isNonNegativeSafeInteger(preflightContextSlot.value) ||
    !lastValidBlockHeight.ok ||
    !isNonNegativeSafeInteger(lastValidBlockHeight.value)
  ) {
    return JOURNAL_CORRUPT
  }

  const request = readFieldSet(readValueOrUndefined(parsed, 'request'), requestFieldsFor(action))
  const preState = readFieldSet(readValueOrUndefined(parsed, 'preState'), preStateFieldsFor(action))
  if (request === null || preState === null) {
    // This is also where an action / request / preState mismatch dies: the tables are
    // selected by the action, so a convert body under a prepare action cannot match.
    return JOURNAL_CORRUPT
  }

  const knownSignature = readRequiredNullable(parsed, 'knownSignature')
  if (!knownSignature.ok) {
    return JOURNAL_CORRUPT
  }
  if (knownSignature.value !== null && !isKnownSignature(knownSignature.value)) {
    return JOURNAL_CORRUPT
  }

  const observationRead = readRequiredNullable(parsed, 'observation')
  const finalityRead = readRequiredNullable(parsed, 'outcomeFinality')
  const resolutionRead = readRequiredNullable(parsed, 'resolution')
  if (!observationRead.ok || !finalityRead.ok || !resolutionRead.ok) {
    return JOURNAL_CORRUPT
  }
  const observation =
    observationRead.value === null ? null : toEnum(observationRead.value, OBSERVATIONS)
  const outcomeFinality =
    finalityRead.value === null ? null : toEnum(finalityRead.value, FINALITIES)
  const resolution =
    resolutionRead.value === null ? null : toEnum(resolutionRead.value, RESOLUTIONS)
  if (
    (observationRead.value !== null && observation === null) ||
    (finalityRead.value !== null && outcomeFinality === null) ||
    (resolutionRead.value !== null && resolution === null)
  ) {
    return JOURNAL_CORRUPT
  }

  const draft: JournalDraft = {
    schema: REDAX_HOLDER_RECOVERY_JOURNAL_SCHEMA,
    namespace,
    action,
    attemptNonce: attemptNonce.value,
    revision: revision.value,
    lifecycle,
    intendedMessage,
    preflightContextSlot: preflightContextSlot.value,
    lastValidBlockHeight: lastValidBlockHeight.value,
    request,
    preState,
    knownSignature: knownSignature.value === null ? null : (knownSignature.value as string),
    observation,
    outcomeFinality,
    resolution,
  }
  if (!isCoherent(draft)) {
    return JOURNAL_CORRUPT
  }
  const canonical = canonicalize(draft)
  return { ok: true, record: publishRecord(draft), canonical }
}

// --- The module-private live witness --------------------------------------------
//
// What THIS JavaScript realm has already seen at this key. It is never exported,
// never persisted, never logged and never rendered — it is not a handle, not a
// capability and not send authorization. Its only job is to notice that the durable
// record moved in a way no legitimate serialized actor could have produced.

interface LiveWitness {
  readonly attemptNonce: string
  readonly highestRevision: number
  readonly canonical: string
  readonly createdInThisSession: boolean
  readonly invocationStarted: boolean
}

const LIVE_WITNESSES = new Map<string, LiveWitness>()

type LiveVerdict = 'OK' | 'LIVE_DELETION_DETECTED' | 'LIVE_ROLLBACK_DETECTED'

/**
 * The part of a record that ONE attempt nonce carries unchanged from its first write
 * to its tombstone, rendered through the single canonical serializer.
 *
 * Built by normalizing every transition-mutable member of `draftOf(record)` to a
 * fixed value and canonicalizing what is left, so schema, namespace, action, nonce,
 * commitment, preflight slot, block height, request and pre-state are all compared
 * recursively by exactly the serializer that wrote them. A second hand-maintained
 * field list would be a second thing to keep in step, and the first time it drifted
 * an immutable field would silently stop being immutable.
 */
function immutableProjection(record: RedaxHolderRecoveryJournalRecordV1): string {
  const projected = draftOf(record)
  projected.revision = 1
  projected.lifecycle = 'PRE_INVOCATION'
  projected.knownSignature = null
  projected.observation = null
  projected.outcomeFinality = null
  projected.resolution = null
  return canonicalize(projected)
}

/**
 * A known signature, once known, is permanent.
 *
 * Replacing it would point recovery at a transaction the holder never sent; dropping
 * it would throw away the only handle on one they may have. Null may become non-null
 * ONLY through the retained-signature step, and it is the exact one-step relation
 * below — not this function — that proves that.
 */
function isKnownSignatureContinuous(
  previous: RedaxHolderRecoveryJournalRecordV1,
  next: RedaxHolderRecoveryJournalRecordV1,
): boolean {
  return previous.knownSignature === null || next.knownSignature === previous.knownSignature
}

/**
 * The transitions worth replaying against a candidate successor record.
 *
 * The two parameterized transitions take their parameters FROM the candidate, which
 * is safe precisely because the replay is then compared to that candidate byte for
 * byte: a fabricated record may supply its own parameters and still has to be the
 * exact output of one real transition applied to the exact previous record.
 */
function replayCandidates(
  next: RedaxHolderRecoveryJournalRecordV1,
): RedaxHolderRecoveryTransition[] {
  const candidates: RedaxHolderRecoveryTransition[] = [
    { type: 'MARK_INVOCATION_STARTED' },
    { type: 'RESOLVE_PRE_INVOCATION_REFUSAL' },
    { type: 'RESOLVE_FINALIZED_SUCCESS' },
    { type: 'RESOLVE_KNOWN_SIGNATURE_FAILURE' },
    { type: 'ACKNOWLEDGE_SUPPORT_DISPOSITION' },
  ]
  if (next.knownSignature !== null) {
    candidates.push({ type: 'RETAIN_KNOWN_SIGNATURE', knownSignature: next.knownSignature })
  }
  if (next.observation !== null) {
    candidates.push({
      type: 'RECORD_OBSERVATION',
      observation: next.observation,
      outcomeFinality: next.outcomeFinality,
    })
  }
  return candidates
}

/**
 * Is `next` EXACTLY what one legitimate transition of `previous` would have written?
 *
 * The relation is proved by REPLAY through the same `applyTransition` every exported
 * mutation uses, so this file holds one transition implementation and there is no
 * second one to drift from it. Endpoint plausibility proves nothing: a record is
 * accepted only when a real transition reproduces its canonical bytes exactly, at
 * exactly the next revision.
 */
function isExactOneStep(
  previous: RedaxHolderRecoveryJournalRecordV1,
  previousCanonical: string,
  next: RedaxHolderRecoveryJournalRecordV1,
  nextCanonical: string,
  originHeldHere: boolean,
): boolean {
  const advanced = nextRevision(previous.revision)
  if (advanced === null || advanced !== next.revision) {
    return false
  }
  // The replayed actor is treated as the origin of its own attempt. Where THIS realm
  // is provably the origin, the origin-only moves are removed from the set below
  // instead, because then no other actor can be making them.
  const replayWitness: LiveWitness = {
    attemptNonce: previous.attemptNonce,
    highestRevision: previous.revision,
    canonical: previousCanonical,
    createdInThisSession: true,
    invocationStarted: false,
  }
  for (const candidate of replayCandidates(next)) {
    if (originHeldHere && ORIGIN_ONLY_TRANSITIONS.includes(candidate.type)) {
      continue
    }
    const outcome = applyTransition(previous, candidate, replayWitness)
    if (!outcome.ok) {
      continue
    }
    outcome.draft.revision = advanced
    if (isCoherent(outcome.draft) && canonicalize(outcome.draft) === nextCanonical) {
      return true
    }
  }
  return false
}

/**
 * Compare what storage now says against what this realm last verified.
 *
 * A page reload creates a fresh realm with no witness, which is CORRECT: a reload is
 * a successor session and gets no inherited belief about the record — nor any of the
 * origin session's rights.
 *
 * Where a witness DOES exist, a changed record is accepted only as one exact step
 * from it. Anything further is unverifiable: this module deliberately stores no
 * transition history, so a record two or more revisions ahead offers no evidence that
 * the steps in between ever happened, however plausible its endpoint looks.
 */
function judgeAgainstWitness(
  witness: LiveWitness | undefined,
  next: RedaxHolderRecoveryJournalRecordV1 | null,
  nextCanonical: string | null,
): LiveVerdict {
  if (witness === undefined) {
    return 'OK'
  }
  if (next === null || nextCanonical === null) {
    // We saw it; now it is gone. Client-only storage cannot prove WHO removed it, so
    // the only safe reading is that the durable record can no longer be trusted.
    return 'LIVE_DELETION_DETECTED'
  }
  const previous = parseJournalText(witness.canonical)
  if (!previous.ok) {
    return 'LIVE_ROLLBACK_DETECTED'
  }
  if (next.revision < previous.record.revision) {
    return 'LIVE_ROLLBACK_DETECTED'
  }
  if (next.revision === previous.record.revision) {
    return nextCanonical === witness.canonical ? 'OK' : 'LIVE_ROLLBACK_DETECTED'
  }
  if (next.revision !== previous.record.revision + 1) {
    // A jump of more than one cannot be checked without the transitions it skipped,
    // and a stale realm failing closed is the correct outcome. A fresh realm holds no
    // witness at all and reads the current record as a successor, under the already
    // disclosed cold-clear boundary.
    return 'LIVE_ROLLBACK_DETECTED'
  }

  if (next.attemptNonce === previous.record.attemptNonce) {
    if (
      immutableProjection(next) !== immutableProjection(previous.record) ||
      !isKnownSignatureContinuous(previous.record, next)
    ) {
      return 'LIVE_ROLLBACK_DETECTED'
    }
    // While this realm holds the origin rights over an attempt that has not been
    // invoked, no other actor can legitimately mark the invocation started or call it
    // a pre-invocation refusal — those two are ours, and we have not made them. All
    // anyone else can honestly write is a support disposition.
    const originHeldHere =
      witness.createdInThisSession &&
      !witness.invocationStarted &&
      previous.record.lifecycle === 'PRE_INVOCATION'
    return isExactOneStep(previous.record, previous.canonical, next, nextCanonical, originHeldHere)
      ? 'OK'
      : 'LIVE_ROLLBACK_DETECTED'
  }

  // A different attempt entirely. Only the exact replacement `begin` writes over a
  // REPLACEABLE tombstone can legitimately mint a new nonce: an active attempt is
  // never displaced, an acknowledged support disposition is permanent, and a
  // replacement always opens at PRE_INVOCATION.
  if (
    previous.record.lifecycle !== 'TOMBSTONE' ||
    previous.record.resolution === null ||
    !REPLACEABLE_RESOLUTIONS.includes(previous.record.resolution) ||
    next.lifecycle !== 'PRE_INVOCATION'
  ) {
    return 'LIVE_ROLLBACK_DETECTED'
  }
  return 'OK'
}

function rememberWitness(
  key: string,
  record: RedaxHolderRecoveryJournalRecordV1,
  canonical: string,
  createdInThisSession: boolean,
  invocationStarted: boolean,
): void {
  LIVE_WITNESSES.set(key, {
    attemptNonce: record.attemptNonce,
    highestRevision: record.revision,
    canonical,
    createdInThisSession,
    invocationStarted,
  })
}

// --- Keys, results and the exclusive lock -----------------------------------------

function journalStorageKey(namespace: RedaxHolderRecoveryJournalNamespace): string {
  // `:` is safe as a delimiter because the cluster is a fixed literal and validated
  // base58 identifiers cannot contain one — so no pair of namespaces can collide.
  return `${REDAX_JOURNAL_KEY_PREFIX}:${namespace.cluster}:${namespace.program}:${namespace.wallet}`
}

function journalLockName(namespace: RedaxHolderRecoveryJournalNamespace): string {
  return `${REDAX_JOURNAL_LOCK_PREFIX}:${namespace.cluster}:${namespace.program}:${namespace.wallet}`
}

function readFailure(
  code: RedaxHolderRecoveryJournalFailureCode,
): RedaxHolderRecoveryJournalReadResult {
  return Object.freeze({ ok: false as const, code })
}

function writeFailure(
  code: RedaxHolderRecoveryJournalFailureCode,
): RedaxHolderRecoveryJournalWriteResult {
  return Object.freeze({ ok: false as const, code })
}

const LOCK_OPTIONS = Object.freeze({ mode: 'exclusive' as const, ifAvailable: true as const })

/**
 * Run one critical section under an EXCLUSIVE, NON-QUEUEING lock.
 *
 * Module-private, and it accepts no caller-supplied callback: every exported
 * operation passes its own internal body, and nothing generic is exported. Under
 * `ifAvailable` the callback is invoked with `null` when the lock is already held —
 * that is a refusal, never a wait. There is no queue, no `steal`, no timeout and no
 * signal, because a journal operation that waits is a journal operation that can be
 * made to wait forever by another tab.
 *
 * The body's result is captured through a box rather than taken from what `request`
 * resolves to: the LockManager is resolved from `globalThis` and its return value is
 * not this module's to trust. If the callback never runs, nothing is captured and
 * the operation refuses.
 *
 * The lock is held for read → decide → write → read-back → verify, and nothing
 * longer. No wallet, RPC or UI work ever happens inside it.
 */
async function withExclusiveJournalLock<R>(
  namespace: RedaxHolderRecoveryJournalNamespace,
  managerUnavailable: R,
  lockUnavailable: R,
  body: () => Promise<R>,
): Promise<R> {
  const locks = resolveLockManagerPort()
  if (locks === null) {
    return managerUnavailable
  }
  const captured: (R | undefined)[] = []
  try {
    await locks.request(journalLockName(namespace), LOCK_OPTIONS, async (lock: unknown) => {
      if (lock === null || lock === undefined) {
        captured.push(lockUnavailable)
        return
      }
      captured.push(await body())
    })
  } catch {
    return lockUnavailable
  }
  const result = captured[0]
  return result === undefined ? lockUnavailable : result
}

// --- The locked storage read ------------------------------------------------------

type StoredState =
  | { readonly kind: 'EMPTY' }
  | {
      readonly kind: 'PRESENT'
      readonly record: RedaxHolderRecoveryJournalRecordV1
      readonly canonical: string
    }
  | { readonly kind: 'FAILED'; readonly code: RedaxHolderRecoveryJournalFailureCode }

/**
 * Read, validate, canonicalize, BIND and judge — the shared first half of every
 * operation.
 *
 * The canonical round-trip is the load-bearing step: the stored text must equal the
 * canonical serialization of what it parsed to, byte for byte. That is what turns
 * "it happens to parse" into "it is exactly what this module would have written".
 *
 * The namespace the caller asked for is then required to be the namespace the record
 * carries. Internal consistency says nothing about whether a record was found where
 * it claims to live, and the requested namespace is exactly what derived the key it
 * was read from.
 */
function readStoredState(
  storage: RedaxJournalStoragePort,
  key: string,
  namespace: RedaxHolderRecoveryJournalNamespace,
): StoredState {
  let raw: unknown
  try {
    raw = storage.getItem(key)
  } catch {
    return { kind: 'FAILED', code: 'STORAGE_UNAVAILABLE' }
  }
  const witness = LIVE_WITNESSES.get(key)

  if (raw === null || raw === undefined) {
    const verdict = judgeAgainstWitness(witness, null, null)
    return verdict === 'OK' ? { kind: 'EMPTY' } : { kind: 'FAILED', code: verdict }
  }
  if (typeof raw !== 'string') {
    return { kind: 'FAILED', code: 'JOURNAL_CORRUPT' }
  }

  const parsed = parseJournalText(raw)
  if (!parsed.ok) {
    return { kind: 'FAILED', code: parsed.code }
  }
  if (parsed.canonical !== raw) {
    // Same meaning, different bytes: reordered keys, added whitespace, a duplicate
    // member the parser silently collapsed. Something other than this module wrote
    // it, and that is enough to refuse.
    return { kind: 'FAILED', code: 'JOURNAL_CORRUPT' }
  }
  if (
    parsed.record.namespace.cluster !== namespace.cluster ||
    parsed.record.namespace.program !== namespace.program ||
    parsed.record.namespace.wallet !== namespace.wallet
  ) {
    // A record that is internally perfect but belongs to ANOTHER slot: a different
    // cluster, program or wallet. It must never be read as this wallet's attempt,
    // transitioned, replaced or overwritten, so it fails closed with or without a
    // witness — record-level invalidity outranks live-movement judgment, exactly as
    // it does for noncanonical bytes above.
    return { kind: 'FAILED', code: 'JOURNAL_CORRUPT' }
  }

  const verdict = judgeAgainstWitness(witness, parsed.record, parsed.canonical)
  if (verdict !== 'OK') {
    return { kind: 'FAILED', code: verdict }
  }
  return { kind: 'PRESENT', record: parsed.record, canonical: parsed.canonical }
}

/** Record what a verified read established, without granting this realm any rights. */
function observeStored(
  key: string,
  record: RedaxHolderRecoveryJournalRecordV1,
  canonical: string,
): void {
  const witness = LIVE_WITNESSES.get(key)
  if (witness === undefined || record.attemptNonce !== witness.attemptNonce) {
    // First sight in a fresh realm, or a DIFFERENT attempt than the one this realm
    // was following — another realm legitimately replaced a resolved tombstone. Both
    // are SUCCESSOR positions: this realm may reconcile, but it did not create the
    // attempt that is there now and never inherits the right to invoke it or to call
    // it a pre-invocation refusal. Those rights are minted only by the operation that
    // successfully writes a record, never by observing one.
    rememberWitness(key, record, canonical, false, record.lifecycle !== 'PRE_INVOCATION')
    return
  }
  if (record.revision < witness.highestRevision) {
    return
  }
  rememberWitness(
    key,
    record,
    canonical,
    witness.createdInThisSession,
    witness.invocationStarted || record.lifecycle !== 'PRE_INVOCATION',
  )
}

// --- The locked write -------------------------------------------------------------

/**
 * Serialize, store, read back and verify — then, and only then, update the witness.
 *
 * The immediate read-back is not paranoia about the browser. Storage can accept a
 * write and drop it (a full quota, a partitioned origin, an extension rewriting the
 * value), and a journal entry that was not actually durable is worse than none: the
 * caller is about to invoke a transport on the strength of it.
 */
function commitDraft(
  storage: RedaxJournalStoragePort,
  key: string,
  draft: JournalDraft,
  createdInThisSession: boolean,
  invocationStarted: boolean,
):
  | { readonly ok: true; readonly record: RedaxHolderRecoveryJournalRecordV1 }
  | { readonly ok: false; readonly code: RedaxHolderRecoveryJournalFailureCode } {
  if (!isCoherent(draft)) {
    return { ok: false, code: 'TRANSITION_INVALID' }
  }
  const record = publishRecord(draft)
  const canonical = canonicalize(draft)

  try {
    storage.setItem(key, canonical)
  } catch {
    return { ok: false, code: 'STORAGE_UNAVAILABLE' }
  }

  let readBack: unknown
  try {
    readBack = storage.getItem(key)
  } catch {
    return { ok: false, code: 'STORAGE_UNAVAILABLE' }
  }
  if (typeof readBack !== 'string' || readBack !== canonical) {
    return { ok: false, code: 'WRITE_VERIFICATION_FAILED' }
  }
  const reparsed = parseJournalText(readBack)
  if (!reparsed.ok || reparsed.canonical !== canonical) {
    return { ok: false, code: 'WRITE_VERIFICATION_FAILED' }
  }
  if (
    reparsed.record.attemptNonce !== record.attemptNonce ||
    reparsed.record.revision !== record.revision ||
    reparsed.record.lifecycle !== record.lifecycle
  ) {
    return { ok: false, code: 'WRITE_VERIFICATION_FAILED' }
  }

  rememberWitness(key, record, canonical, createdInThisSession, invocationStarted)
  return { ok: true, record }
}

/** The next revision, or nothing at all. Monotonic, exactly +1, never wrapping. */
function nextRevision(current: number): number | null {
  if (!isPositiveSafeInteger(current) || current >= Number.MAX_SAFE_INTEGER) {
    return null
  }
  return current + 1
}

// --- Input validation -------------------------------------------------------------

function validateNamespace(value: unknown): RedaxHolderRecoveryJournalNamespace | null {
  return parseNamespaceValue(value)
}

interface ValidatedBegin {
  readonly namespace: RedaxHolderRecoveryJournalNamespace
  readonly action: RedaxHolderRecoveryAction
  readonly intendedMessage: RedaxHolderRecoveryIntendedMessageCommitmentV1
  readonly preflightContextSlot: number
  readonly lastValidBlockHeight: number
  readonly request: Record<string, string>
  readonly preState: Record<string, string>
  readonly replaces: RedaxHolderRecoveryAttemptIdentity | null
}

function validateBeginInput(input: unknown): ValidatedBegin | null {
  const namespaceRead = readProperty(input, 'namespace')
  if (!namespaceRead.ok) {
    return null
  }
  const namespace = validateNamespace(namespaceRead.value)
  const action = readEnum(input, 'action', ACTIONS)
  if (namespace === null || action === null) {
    return null
  }
  const intendedMessage = parseCommitmentValue(readValueOrUndefined(input, 'intendedMessage'))
  if (intendedMessage === null) {
    return null
  }
  const preflightContextSlot = readProperty(input, 'preflightContextSlot')
  const lastValidBlockHeight = readProperty(input, 'lastValidBlockHeight')
  if (
    !preflightContextSlot.ok ||
    !isNonNegativeSafeInteger(preflightContextSlot.value) ||
    !lastValidBlockHeight.ok ||
    !isNonNegativeSafeInteger(lastValidBlockHeight.value)
  ) {
    return null
  }
  const request = readFieldSet(readValueOrUndefined(input, 'request'), requestFieldsFor(action))
  const preState = readFieldSet(readValueOrUndefined(input, 'preState'), preStateFieldsFor(action))
  if (request === null || preState === null) {
    return null
  }
  const replacesRead = readRequiredNullable(input, 'replaces')
  if (!replacesRead.ok) {
    return null
  }
  let replaces: RedaxHolderRecoveryAttemptIdentity | null = null
  if (replacesRead.value !== null) {
    replaces = validateIdentity(replacesRead.value)
    if (replaces === null) {
      return null
    }
  }
  return {
    namespace,
    action,
    intendedMessage,
    preflightContextSlot: preflightContextSlot.value,
    lastValidBlockHeight: lastValidBlockHeight.value,
    request,
    preState,
    replaces,
  }
}

function validateIdentity(value: unknown): RedaxHolderRecoveryAttemptIdentity | null {
  if (!hasExactKeys(value, ['attemptNonce', 'revision'])) {
    return null
  }
  const attemptNonce = readProperty(value, 'attemptNonce')
  const revision = readProperty(value, 'revision')
  if (
    !attemptNonce.ok ||
    typeof attemptNonce.value !== 'string' ||
    !ATTEMPT_NONCE_PATTERN.test(attemptNonce.value) ||
    !revision.ok ||
    !isPositiveSafeInteger(revision.value)
  ) {
    return null
  }
  return { attemptNonce: attemptNonce.value, revision: revision.value }
}

interface ValidatedTransition {
  readonly namespace: RedaxHolderRecoveryJournalNamespace
  readonly expectedAttemptNonce: string
  readonly expectedRevision: number
  readonly transition: RedaxHolderRecoveryTransition
}

const TRANSITION_TYPES: readonly RedaxHolderRecoveryTransition['type'][] = [
  'MARK_INVOCATION_STARTED',
  'RETAIN_KNOWN_SIGNATURE',
  'RECORD_OBSERVATION',
  'RESOLVE_PRE_INVOCATION_REFUSAL',
  'RESOLVE_FINALIZED_SUCCESS',
  'RESOLVE_KNOWN_SIGNATURE_FAILURE',
  'ACKNOWLEDGE_SUPPORT_DISPOSITION',
]

function validateTransitionValue(value: unknown): RedaxHolderRecoveryTransition | null {
  const type = readEnum(value, 'type', TRANSITION_TYPES)
  if (type === null) {
    return null
  }
  if (type === 'RETAIN_KNOWN_SIGNATURE') {
    if (!hasExactKeys(value, ['type', 'knownSignature'])) {
      return null
    }
    const knownSignature = readProperty(value, 'knownSignature')
    if (!knownSignature.ok || !isKnownSignature(knownSignature.value)) {
      return null
    }
    return { type, knownSignature: knownSignature.value }
  }
  if (type === 'RECORD_OBSERVATION') {
    if (!hasExactKeys(value, ['type', 'observation', 'outcomeFinality'])) {
      return null
    }
    const observation = readEnum(value, 'observation', OBSERVATIONS)
    const finalityRead = readRequiredNullable(value, 'outcomeFinality')
    if (observation === null || !finalityRead.ok) {
      return null
    }
    const outcomeFinality =
      finalityRead.value === null ? null : toEnum(finalityRead.value, FINALITIES)
    if (finalityRead.value !== null && outcomeFinality === null) {
      return null
    }
    return { type, observation, outcomeFinality }
  }
  return hasExactKeys(value, ['type']) ? { type } : null
}

function validateTransitionInput(input: unknown): ValidatedTransition | null {
  const namespaceRead = readProperty(input, 'namespace')
  if (!namespaceRead.ok) {
    return null
  }
  const namespace = validateNamespace(namespaceRead.value)
  if (namespace === null) {
    return null
  }
  const expectedAttemptNonce = readProperty(input, 'expectedAttemptNonce')
  const expectedRevision = readProperty(input, 'expectedRevision')
  if (
    !expectedAttemptNonce.ok ||
    typeof expectedAttemptNonce.value !== 'string' ||
    !ATTEMPT_NONCE_PATTERN.test(expectedAttemptNonce.value) ||
    !expectedRevision.ok ||
    !isPositiveSafeInteger(expectedRevision.value)
  ) {
    return null
  }
  const transition = validateTransitionValue(readValueOrUndefined(input, 'transition'))
  if (transition === null) {
    return null
  }
  return {
    namespace,
    expectedAttemptNonce: expectedAttemptNonce.value,
    expectedRevision: expectedRevision.value,
    transition,
  }
}

// --- Exported operation 1: read -----------------------------------------------------

/**
 * Look at the one Holder attempt slot.
 *
 * Read-only, and still taken under the exclusive lock: a read that races a write
 * could observe a half-verified state and hand the caller a record that never became
 * durable. It never rejects; every platform, storage and parse failure resolves into
 * a fixed typed refusal, and nothing is logged.
 */
export async function readRedaxHolderRecoveryJournal(
  namespace: RedaxHolderRecoveryJournalNamespace,
): Promise<RedaxHolderRecoveryJournalReadResult> {
  const validated = validateNamespace(namespace)
  if (validated === null) {
    return readFailure('NAMESPACE_INVALID')
  }
  return withExclusiveJournalLock<RedaxHolderRecoveryJournalReadResult>(
    validated,
    readFailure('LOCK_MANAGER_UNAVAILABLE'),
    readFailure('LOCK_UNAVAILABLE'),
    async () => {
      const storage = resolveStoragePort()
      if (storage === null) {
        return readFailure('STORAGE_UNAVAILABLE')
      }
      const key = journalStorageKey(validated)
      const stored = readStoredState(storage, key, validated)
      if (stored.kind === 'FAILED') {
        return readFailure(stored.code)
      }
      if (stored.kind === 'EMPTY') {
        return Object.freeze({ ok: true as const, kind: 'EMPTY' as const })
      }
      observeStored(key, stored.record, stored.canonical)
      return Object.freeze({
        ok: true as const,
        kind: stored.record.lifecycle === 'TOMBSTONE' ? ('TOMBSTONE' as const) : ('ACTIVE' as const),
        record: stored.record,
      })
    },
  )
}

// --- Exported operation 2: begin ------------------------------------------------------

/**
 * Open the attempt slot, or replace a resolved tombstone under its exact identity.
 *
 * ONE SLOT. A prepare in flight blocks a convert and vice versa, and a different
 * campaign or TokenConfig does not buy a second slot — the point is that this wallet
 * has one unresolved thing at a time.
 *
 * A corrupt or incompatible record is NEVER overwritten. Whatever is there might be
 * the only evidence that something was sent, and destroying it to make room for a new
 * attempt would be the worst possible response to damage.
 */
export async function beginRedaxHolderRecoveryAttempt(
  input: RedaxHolderRecoveryBeginInput,
): Promise<RedaxHolderRecoveryJournalWriteResult> {
  const namespaceRead = readProperty(input, 'namespace')
  const namespace = namespaceRead.ok ? validateNamespace(namespaceRead.value) : null
  if (namespace === null) {
    return writeFailure('NAMESPACE_INVALID')
  }
  const validated = validateBeginInput(input)
  if (validated === null) {
    return writeFailure('INPUT_INVALID')
  }

  return withExclusiveJournalLock<RedaxHolderRecoveryJournalWriteResult>(
    validated.namespace,
    writeFailure('LOCK_MANAGER_UNAVAILABLE'),
    writeFailure('LOCK_UNAVAILABLE'),
    async () => {
      // Entropy first, so a broken generator can never leave a half-written slot: no
      // storage byte is touched by this operation until the nonce exists.
      const attemptNonce = generateAttemptNonce()
      if (attemptNonce === null) {
        return writeFailure('ENTROPY_UNAVAILABLE')
      }

      const storage = resolveStoragePort()
      if (storage === null) {
        return writeFailure('STORAGE_UNAVAILABLE')
      }
      const key = journalStorageKey(validated.namespace)
      const stored = readStoredState(storage, key, validated.namespace)
      if (stored.kind === 'FAILED') {
        return writeFailure(stored.code)
      }

      let revision = 1
      if (stored.kind === 'PRESENT') {
        observeStored(key, stored.record, stored.canonical)
        if (stored.record.lifecycle !== 'TOMBSTONE') {
          return writeFailure('ACTIVE_ATTEMPT_EXISTS')
        }
        if (
          stored.record.resolution === null ||
          !REPLACEABLE_RESOLUTIONS.includes(stored.record.resolution)
        ) {
          // An acknowledged support disposition is permanent. Acknowledging an
          // unresolved submission never made it resolved, and it must never become a
          // licence to start another one.
          return writeFailure('TOMBSTONE_NOT_REPLACEABLE')
        }
        if (
          validated.replaces === null ||
          validated.replaces.attemptNonce !== stored.record.attemptNonce ||
          validated.replaces.revision !== stored.record.revision
        ) {
          return writeFailure('CAS_CONFLICT')
        }
        const advanced = nextRevision(stored.record.revision)
        if (advanced === null) {
          return writeFailure('REVISION_EXHAUSTED')
        }
        revision = advanced
      } else if (validated.replaces !== null) {
        // The caller believes it is replacing something that is not there.
        return writeFailure('CAS_CONFLICT')
      }

      const draft: JournalDraft = {
        schema: REDAX_HOLDER_RECOVERY_JOURNAL_SCHEMA,
        namespace: { ...validated.namespace },
        action: validated.action,
        attemptNonce,
        revision,
        lifecycle: 'PRE_INVOCATION',
        intendedMessage: { ...validated.intendedMessage },
        preflightContextSlot: validated.preflightContextSlot,
        lastValidBlockHeight: validated.lastValidBlockHeight,
        request: { ...validated.request },
        preState: { ...validated.preState },
        knownSignature: null,
        observation: null,
        outcomeFinality: null,
        resolution: null,
      }
      const committed = commitDraft(storage, key, draft, true, false)
      if (!committed.ok) {
        return writeFailure(committed.code)
      }
      return Object.freeze({
        ok: true as const,
        kind: 'CREATED' as const,
        record: committed.record,
      })
    },
  )
}

// --- Exported operation 3: transition ---------------------------------------------------

/** The next draft a transition produces, or the fixed reason it produces none. */
type TransitionOutcome =
  | { readonly ok: true; readonly draft: JournalDraft; readonly invocationStarted: boolean }
  | { readonly ok: false; readonly code: RedaxHolderRecoveryJournalFailureCode }

const TRANSITION_INVALID: TransitionOutcome = Object.freeze({
  ok: false as const,
  code: 'TRANSITION_INVALID' as const,
})

/**
 * Which observations a record in this exact state may legitimately take on.
 *
 * `RECORD_OBSERVATION` is the one transition a successor session uses freely, so its
 * compatibility rules carry weight: they are what stop a reconciling tab from
 * writing an observation that implies evidence the record does not have.
 */
function applyObservation(
  draft: JournalDraft,
  observation: RedaxHolderRecoveryJournalObservation,
  outcomeFinality: RedaxHolderRecoveryOutcomeFinality | null,
): TransitionOutcome {
  if (draft.lifecycle === 'PRE_INVOCATION' || draft.lifecycle === 'TOMBSTONE') {
    // Nothing has been observed before invocation, and a resolved attempt is over.
    return TRANSITION_INVALID
  }
  if (observation === 'PREFLIGHT_REFUSED') {
    // The refusal observation belongs to its own resolution, which additionally
    // proves the invocation never started.
    return TRANSITION_INVALID
  }
  const next: JournalDraft = {
    ...draft,
    observation,
    outcomeFinality,
  }
  return isCoherent(next) ? { ok: true, draft: next, invocationStarted: true } : TRANSITION_INVALID
}

function applyTransition(
  record: RedaxHolderRecoveryJournalRecordV1,
  transition: RedaxHolderRecoveryTransition,
  witness: LiveWitness | undefined,
): TransitionOutcome {
  const draft = draftOf(record)

  switch (transition.type) {
    case 'MARK_INVOCATION_STARTED': {
      // The ORIGIN session only, and only before invocation. This write is the
      // durable "we are about to hand this to the transport" marker, so a session
      // that did not create the attempt must never be able to claim it.
      if (
        draft.lifecycle !== 'PRE_INVOCATION' ||
        witness === undefined ||
        !witness.createdInThisSession ||
        witness.invocationStarted
      ) {
        return TRANSITION_INVALID
      }
      return {
        ok: true,
        draft: {
          ...draft,
          lifecycle: 'POST_INVOCATION_SIGNATURE_UNKNOWN',
          observation: 'SUBMISSION_OUTCOME_UNKNOWN_WITHOUT_SIGNATURE',
          knownSignature: null,
          outcomeFinality: null,
        },
        invocationStarted: true,
      }
    }

    case 'RETAIN_KNOWN_SIGNATURE': {
      // Available to a successor session too: recovering the exact signature is the
      // most useful thing anyone can do with an ambiguous attempt.
      if (draft.lifecycle !== 'POST_INVOCATION_SIGNATURE_UNKNOWN') {
        return TRANSITION_INVALID
      }
      return {
        ok: true,
        draft: {
          ...draft,
          lifecycle: 'KNOWN_SIGNATURE',
          knownSignature: transition.knownSignature,
          observation: 'SIGNATURE_OBSERVED',
          outcomeFinality: null,
        },
        invocationStarted: true,
      }
    }

    case 'RECORD_OBSERVATION':
      return applyObservation(draft, transition.observation, transition.outcomeFinality)

    case 'RESOLVE_PRE_INVOCATION_REFUSAL': {
      // The ONLY genuine pre-invocation resolution, and the only place this route
      // can honestly say nothing was sent. Once the invocation marker is written it
      // is permanently unreachable, and a successor session can never reach it at
      // all — neither can prove what the origin session did next.
      if (
        draft.lifecycle !== 'PRE_INVOCATION' ||
        witness === undefined ||
        !witness.createdInThisSession ||
        witness.invocationStarted
      ) {
        return TRANSITION_INVALID
      }
      return {
        ok: true,
        draft: {
          ...draft,
          lifecycle: 'TOMBSTONE',
          observation: 'PREFLIGHT_REFUSED',
          resolution: 'PRE_INVOCATION_REFUSAL',
        },
        invocationStarted: false,
      }
    }

    case 'RESOLVE_FINALIZED_SUCCESS': {
      if (
        draft.lifecycle !== 'KNOWN_SIGNATURE' ||
        draft.knownSignature === null ||
        draft.observation !== 'FINALIZED_EFFECT_MATCHING' ||
        draft.outcomeFinality !== 'finalized'
      ) {
        return TRANSITION_INVALID
      }
      return {
        ok: true,
        draft: { ...draft, lifecycle: 'TOMBSTONE', resolution: 'FINALIZED_SUCCESS' },
        invocationStarted: true,
      }
    }

    case 'RESOLVE_KNOWN_SIGNATURE_FAILURE': {
      if (
        draft.lifecycle !== 'KNOWN_SIGNATURE' ||
        draft.knownSignature === null ||
        draft.outcomeFinality !== 'finalized' ||
        (draft.observation !== 'LANDED_TRANSACTION_FAILED' &&
          draft.observation !== 'LANDED_MESSAGE_MISMATCH')
      ) {
        return TRANSITION_INVALID
      }
      return {
        ok: true,
        draft: {
          ...draft,
          lifecycle: 'TOMBSTONE',
          resolution: 'ACCEPTED_RESOLVED_KNOWN_SIGNATURE_FAILURE',
        },
        invocationStarted: true,
      }
    }

    case 'ACKNOWLEDGE_SUPPORT_DISPOSITION': {
      if (draft.lifecycle === 'TOMBSTONE') {
        return TRANSITION_INVALID
      }
      return {
        ok: true,
        draft: {
          ...draft,
          lifecycle: 'TOMBSTONE',
          observation: 'SUPPORT_ONLY',
          resolution: 'ACCEPTED_SUPPORT_DISPOSITION',
        },
        invocationStarted: draft.lifecycle !== 'PRE_INVOCATION',
      }
    }
  }
}

/**
 * Advance the one attempt, under exact compare-and-set.
 *
 * Every mutation must present the exact attempt nonce AND the exact current
 * revision. A mismatch is `CAS_CONFLICT` and there is NO automatic retry: the caller
 * re-reads and decides again, because a journal that quietly retries its own writes
 * is a journal that quietly loses the race it was built to detect.
 */
export async function transitionRedaxHolderRecoveryAttempt(
  input: RedaxHolderRecoveryTransitionInput,
): Promise<RedaxHolderRecoveryJournalWriteResult> {
  const namespaceRead = readProperty(input, 'namespace')
  const namespace = namespaceRead.ok ? validateNamespace(namespaceRead.value) : null
  if (namespace === null) {
    return writeFailure('NAMESPACE_INVALID')
  }
  const validated = validateTransitionInput(input)
  if (validated === null) {
    return writeFailure('INPUT_INVALID')
  }

  return withExclusiveJournalLock<RedaxHolderRecoveryJournalWriteResult>(
    validated.namespace,
    writeFailure('LOCK_MANAGER_UNAVAILABLE'),
    writeFailure('LOCK_UNAVAILABLE'),
    async () => {
      const storage = resolveStoragePort()
      if (storage === null) {
        return writeFailure('STORAGE_UNAVAILABLE')
      }
      const key = journalStorageKey(validated.namespace)
      const stored = readStoredState(storage, key, validated.namespace)
      if (stored.kind === 'FAILED') {
        return writeFailure(stored.code)
      }
      if (stored.kind === 'EMPTY') {
        return writeFailure('CAS_CONFLICT')
      }
      observeStored(key, stored.record, stored.canonical)

      if (
        stored.record.attemptNonce !== validated.expectedAttemptNonce ||
        stored.record.revision !== validated.expectedRevision
      ) {
        return writeFailure('CAS_CONFLICT')
      }
      if (stored.record.lifecycle === 'TOMBSTONE') {
        // A resolved attempt never moves again. Replacing one is `begin`'s job, and
        // only for the replaceable resolutions.
        return writeFailure('TRANSITION_INVALID')
      }

      const witness = LIVE_WITNESSES.get(key)
      const outcome = applyTransition(stored.record, validated.transition, witness)
      if (!outcome.ok) {
        return writeFailure(outcome.code)
      }
      const advanced = nextRevision(stored.record.revision)
      if (advanced === null) {
        return writeFailure('REVISION_EXHAUSTED')
      }
      outcome.draft.revision = advanced

      const committed = commitDraft(
        storage,
        key,
        outcome.draft,
        witness?.createdInThisSession ?? false,
        outcome.invocationStarted,
      )
      if (!committed.ok) {
        return writeFailure(committed.code)
      }
      return Object.freeze({
        ok: true as const,
        kind:
          committed.record.lifecycle === 'TOMBSTONE'
            ? ('TOMBSTONED' as const)
            : ('UPDATED' as const),
        record: committed.record,
      })
    },
  )
}
