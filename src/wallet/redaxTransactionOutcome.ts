// REDAX known-signature outcome foundation — what a returned signature is worth,
// and nothing more.
//
// -----------------------------------------------------------------------------
// WHAT THIS IS FOR
// -----------------------------------------------------------------------------
// Once a transaction has been handed to a wallet, the interesting question is no
// longer "did the call succeed?" but "what actually landed?". A returned signature
// is the only durable handle on that question, so it is retained first, carried on
// every result, and never discarded. Everything else — a null status, an
// unreadable transaction, an expired blockhash, an RPC that will not answer — is an
// OBSERVATION, never a verdict. Nothing here ever concludes "nothing landed", and
// nothing here ever authorizes a retry.
//
// This module has ZERO imports. Not "no forbidden imports" — none at all. It reads
// the chain exclusively through a module-private structural port carrying exactly
// three read methods, which the caller's attempt-scoped Connection satisfies
// structurally. Sending, signing, simulating and confirming are therefore not
// merely forbidden here: they are unreachable, because the object this module holds
// does not admit them.
//
// It never creates, stores, returns, caches, replaces or serializes the reader. It
// constructs no Transaction and no instruction. It touches no wallet, no adapter,
// no React, no UI, no storage, no journal, no logger, no environment and no clock.
// It runs no timer, no polling loop and no subscription: one call performs one
// observation and returns. A repeat look is the caller's explicit decision.
//
// -----------------------------------------------------------------------------
// WHY A COMMITMENT AND NOT THE BYTES
// -----------------------------------------------------------------------------
// Attribution requires proving the landed message is EXACTLY the message that was
// approved. Both sides are therefore reduced to a versioned SHA-256 commitment —
// kind, byte length and lowercase hex digest — and the raw bytes are dropped as
// soon as the commitment exists. That keeps message identity comparable and
// storable by a later slice without any raw transaction bytes ever entering a
// result, a journal or a log.
//
// Results are typed and value-free: a fixed kind, a fixed finality, two numeric
// slots, and a nested blockheight observation. Never a raw error, message, cause,
// stack, address, endpoint, blockhash, account byte or message byte — and this
// module logs nothing.

// --- Fixed vocabulary --------------------------------------------------------

/** The commitment scheme this module produces and compares. Versioned on purpose. */
const REDAX_INTENDED_LEGACY_MESSAGE_COMMITMENT_KIND =
  'redax-intended-legacy-message-sha256-v1' as const

/** The only landed message version REDAX ever produces, and therefore ever accepts. */
const REDAX_LEGACY_MESSAGE_VERSION = 'legacy' as const

/** A versioned (v0) landed message. Provably not our legacy message. */
const REDAX_VERSIONED_MESSAGE_VERSION = 0 as const

/** Exactly 64 lowercase hexadecimal characters. */
const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/

/** At least one non-whitespace character. */
const NON_WHITESPACE_PATTERN = /\S/

/**
 * The signature reported when a caller supplies an unusable one.
 *
 * A request whose `signature` is not a usable string is a caller-contract
 * violation, but the result must still be total and value-free — so the fixed
 * empty string is reported rather than echoing back whatever was passed in.
 */
const REDAX_NO_KNOWN_SIGNATURE = '' as RedaxKnownSignature

// --- Known signature ---------------------------------------------------------

declare const REDAX_KNOWN_SIGNATURE_BRAND: unique symbol

/**
 * A signature this module has retained.
 *
 * Branded so it cannot be spelled by a caller: the only way to obtain one is
 * `retainRedaxKnownSignature`, which makes the retention step statically visible at
 * the call site instead of being an easily forgotten convention.
 */
export type RedaxKnownSignature = string & {
  readonly [REDAX_KNOWN_SIGNATURE_BRAND]: 'redax-known-signature-v1'
}

/**
 * The outcome of retaining a returned signature.
 *
 * A refusal means only that the returned VALUE was locally unusable. It is not
 * evidence of no broadcast, not evidence of no landing, and never retry safety.
 */
export type RedaxKnownSignatureRetentionResult =
  | { readonly ok: true; readonly knownSignature: RedaxKnownSignature }
  | { readonly ok: false; readonly code: 'KNOWN_SIGNATURE_UNUSABLE' }

const KNOWN_SIGNATURE_UNUSABLE: RedaxKnownSignatureRetentionResult = Object.freeze({
  ok: false as const,
  code: 'KNOWN_SIGNATURE_UNUSABLE' as const,
})

/**
 * Retain the signature a transport just returned.
 *
 * SYNCHRONOUS, and that is the whole point. The moment after a send resolves is the
 * only moment at which the signature is guaranteed to exist and nothing has yet had
 * a chance to throw it away, so retention must not itself introduce an `await`.
 *
 * It accepts a primitive string and nothing else — no `String` wrapper, no object
 * with a `toString`, no coercion. A non-string is never touched: no property of it
 * is read, so a hostile object cannot run code here at all.
 *
 * NOTHING IS NORMALIZED. The returned value is the caller's exact string: no trim,
 * no case folding, no re-encoding. And there is deliberately NO base58 validation —
 * rejecting a signature a wallet really returned would DISCARD a known signature,
 * which is the one failure this whole module exists to prevent. The only shape a
 * signature can fail is "not a string with at least one non-whitespace character".
 */
export function retainRedaxKnownSignature(value: unknown): RedaxKnownSignatureRetentionResult {
  if (typeof value !== 'string' || !NON_WHITESPACE_PATTERN.test(value)) {
    return KNOWN_SIGNATURE_UNUSABLE
  }
  return Object.freeze({ ok: true as const, knownSignature: value as RedaxKnownSignature })
}

// --- Intended legacy-message commitment --------------------------------------

/**
 * A versioned commitment to one compiled legacy message.
 *
 * Carries no bytes. `byteLength` plus a SHA-256 digest is enough to compare two
 * messages for exact identity, and is safe to hand to a later journal slice, which
 * raw transaction bytes would not be.
 */
export interface RedaxIntendedLegacyMessageCommitmentV1 {
  readonly kind: typeof REDAX_INTENDED_LEGACY_MESSAGE_COMMITMENT_KIND
  readonly byteLength: number
  readonly sha256Hex: string
}

export type RedaxIntendedLegacyMessageCommitmentResult =
  | { readonly ok: true; readonly commitment: RedaxIntendedLegacyMessageCommitmentV1 }
  | {
      readonly ok: false
      readonly code: 'INTENDED_MESSAGE_INVALID' | 'MESSAGE_COMMITMENT_UNAVAILABLE'
    }

const INTENDED_MESSAGE_INVALID: RedaxIntendedLegacyMessageCommitmentResult = Object.freeze({
  ok: false as const,
  code: 'INTENDED_MESSAGE_INVALID' as const,
})

const MESSAGE_COMMITMENT_UNAVAILABLE: RedaxIntendedLegacyMessageCommitmentResult = Object.freeze({
  ok: false as const,
  code: 'MESSAGE_COMMITMENT_UNAVAILABLE' as const,
})

/**
 * Minimal structural view of the Web Crypto digest surface.
 *
 * Typed structurally so this module compiles identically under the app's DOM lib
 * and under the test runner's Node types — and, more importantly here, without
 * importing either. There is no Node `crypto` import and no dependency.
 */
interface RedaxSubtleDigest {
  readonly subtle: {
    digest(algorithm: string, data: Uint8Array): Promise<ArrayBuffer>
  }
}

function resolveWebCrypto(): RedaxSubtleDigest | null {
  const candidate = (globalThis as { crypto?: unknown }).crypto
  if (
    typeof candidate !== 'object' ||
    candidate === null ||
    typeof (candidate as RedaxSubtleDigest).subtle !== 'object' ||
    typeof (candidate as RedaxSubtleDigest).subtle?.digest !== 'function'
  ) {
    return null
  }
  return candidate as RedaxSubtleDigest
}

function toLowercaseHex(bytes: Uint8Array): string {
  let hex = ''
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, '0')
  }
  return hex
}

/**
 * Copy a caller- or provider-owned byte sequence into freshly allocated memory,
 * validating every element as it goes.
 *
 * `.slice()` is deliberately NOT used. On a `Buffer` — which is exactly what the
 * installed web3.js hands back from a legacy message — `slice` returns a VIEW over
 * the same memory, so the "copy" would still be mutable by whoever owns the
 * original. A fresh `Uint8Array` written index by index cannot alias anything.
 *
 * Every index read goes through `Reflect.get` inside a `try`: a hostile object can
 * define an element accessor that throws, and that must be a refusal here rather
 * than an exception escaping into the caller's control flow.
 */
function copyByteInput(input: unknown): Uint8Array | null {
  if (typeof input !== 'object' || input === null) {
    return null
  }
  let rawLength: unknown
  try {
    rawLength = Reflect.get(input, 'length')
  } catch {
    return null
  }
  if (typeof rawLength !== 'number' || !Number.isSafeInteger(rawLength) || rawLength <= 0) {
    return null
  }
  const copy = new Uint8Array(rawLength)
  for (let index = 0; index < rawLength; index += 1) {
    let element: unknown
    try {
      element = Reflect.get(input, String(index))
    } catch {
      return null
    }
    if (
      typeof element !== 'number' ||
      !Number.isInteger(element) ||
      element < 0 ||
      element > 255
    ) {
      return null
    }
    copy[index] = element
  }
  return copy
}

/**
 * The single commitment implementation. Both the exported intended-message
 * commitment and the landed-message commitment run through this, so the two sides
 * of the identity comparison can never drift apart.
 *
 * The copy completes SYNCHRONOUSLY, before the first `await`. A caller that mutates
 * its own array the instant this function yields therefore cannot change what was
 * committed to.
 */
async function commitByteInput(input: unknown): Promise<RedaxIntendedLegacyMessageCommitmentResult> {
  const copied = copyByteInput(input)
  if (copied === null) {
    return INTENDED_MESSAGE_INVALID
  }
  const webCrypto = resolveWebCrypto()
  if (webCrypto === null) {
    return MESSAGE_COMMITMENT_UNAVAILABLE
  }
  let digest: ArrayBuffer
  try {
    digest = await webCrypto.subtle.digest('SHA-256', copied)
  } catch {
    return MESSAGE_COMMITMENT_UNAVAILABLE
  }
  let sha256Hex: string
  try {
    sha256Hex = toLowercaseHex(new Uint8Array(digest))
  } catch {
    return MESSAGE_COMMITMENT_UNAVAILABLE
  }
  if (!SHA256_HEX_PATTERN.test(sha256Hex)) {
    return MESSAGE_COMMITMENT_UNAVAILABLE
  }
  return Object.freeze({
    ok: true as const,
    commitment: Object.freeze({
      kind: REDAX_INTENDED_LEGACY_MESSAGE_COMMITMENT_KIND,
      byteLength: copied.length,
      sha256Hex,
    }),
  })
}

/**
 * Commit to the exact compiled legacy message an attempt is about to send.
 *
 * Call this on the FROZEN pre-invocation message bytes, before the transport is
 * invoked. A live `Transaction` must never be re-serialized after the wallet has
 * touched it — and cannot be, here, because this module cannot name one.
 *
 * Never rejects. Never logs. Returns no bytes.
 */
export async function commitRedaxIntendedLegacyMessage(
  serializedMessage: Uint8Array,
): Promise<RedaxIntendedLegacyMessageCommitmentResult> {
  return commitByteInput(serializedMessage)
}

// --- The private structural read port -----------------------------------------

/**
 * Exactly the three reads an outcome observation performs — and nothing else.
 *
 * MODULE-PRIVATE AND DELIBERATELY NARROW. The caller passes its exact attempt-scoped
 * Connection, which satisfies this shape structurally, so the same-Connection
 * guarantee the chain guard establishes is preserved unchanged: identity is a
 * property of the instance, not of the type it is viewed through. What the narrow
 * view adds is that `sendTransaction`, `signTransaction`, `simulateTransaction` and
 * `confirmTransaction` are not on the object this module holds, so no future edit
 * here can reach them.
 *
 * Every return is `unknown`. A provider response is untrusted input, and typing it
 * as anything else would invite the one mistake this module must not make: reading
 * a field as though its declared type were a guarantee.
 */
interface RedaxOutcomeChainReader {
  getSignatureStatuses(
    signatures: string[],
    config: { readonly searchTransactionHistory: true },
  ): Promise<unknown>
  getTransaction(
    signature: string,
    config: {
      readonly commitment: 'confirmed' | 'finalized'
      readonly maxSupportedTransactionVersion: number
    },
  ): Promise<unknown>
  getBlockHeight(config: {
    readonly commitment: 'confirmed'
    readonly minContextSlot: number
  }): Promise<unknown>
}

// --- Public outcome vocabulary -------------------------------------------------

/** Observed confirmation level. `unknown` whenever the provider did not say exactly. */
export type RedaxOutcomeFinality = 'unknown' | 'processed' | 'confirmed' | 'finalized'

/** Which side reported an error, once the landed message is proven identical. */
export type RedaxOutcomeFailureEvidence = 'STATUS' | 'META' | 'STATUS_AND_META'

/** Which read could not be completed. */
export type RedaxOutcomeReadStage = 'REQUEST' | 'STATUS' | 'TRANSACTION'

/** Why it could not be completed. Fixed, closed, and value-free. */
export type RedaxOutcomeReadReason =
  | 'REQUEST_INVALID'
  | 'RPC_UNAVAILABLE'
  | 'RESPONSE_MALFORMED'
  | 'CONTEXT_BEHIND_MINIMUM'
  | 'MESSAGE_VERSION_UNSUPPORTED'
  | 'MESSAGE_UNREADABLE'
  | 'MESSAGE_COMMITMENT_UNAVAILABLE'
  | 'META_UNAVAILABLE'

/** Whether the attempt's blockhash is still usable. An observation, never a verdict. */
export type RedaxOutcomeBlockheightState = 'VALID' | 'EXPIRED' | 'READ_UNAVAILABLE'

/**
 * The nested blockheight observation.
 *
 * `EXPIRED` is the most misread state in this file, so it is worth being blunt: an
 * expired blockhash means the attempt can no longer LAND FROM NOW ON. It says
 * nothing whatsoever about whether it already landed, and it authorizes nothing.
 * This observation never changes the primary status / message / meta result.
 */
export interface RedaxOutcomeBlockheightObservation {
  readonly state: RedaxOutcomeBlockheightState
  readonly blockHeight: number | null
}

/** What every outcome carries, whatever else it says. */
interface RedaxOutcomeCommon {
  readonly signature: RedaxKnownSignature
  readonly finality: RedaxOutcomeFinality
  readonly statusContextSlot: number | null
  readonly transactionSlot: number | null
  readonly blockheight: RedaxOutcomeBlockheightObservation
}

/**
 * One one-shot observation of one known signature.
 *
 * There is no retry, reset, retrySafe or canRetry member on any arm — not omitted
 * by convention, but absent from the type, so no consumer can read one.
 */
export type RedaxKnownSignatureOutcome =
  | (RedaxOutcomeCommon & { readonly kind: 'CONFIRMATION_PENDING' })
  | (RedaxOutcomeCommon & { readonly kind: 'TRANSACTION_NOT_YET_READABLE' })
  | (RedaxOutcomeCommon & {
      readonly kind: 'LANDED_TRANSACTION_FAILED'
      readonly failureEvidence: RedaxOutcomeFailureEvidence
    })
  | (RedaxOutcomeCommon & { readonly kind: 'LANDED_MESSAGE_MISMATCH' })
  | (RedaxOutcomeCommon & { readonly kind: 'CONFIRMED_MESSAGE_META_MATCHING' })
  | (RedaxOutcomeCommon & { readonly kind: 'FINALIZED_MESSAGE_META_MATCHING' })
  | (RedaxOutcomeCommon & {
      readonly kind: 'READ_UNAVAILABLE'
      readonly stage: RedaxOutcomeReadStage
      readonly reason: RedaxOutcomeReadReason
    })

/**
 * One observation request.
 *
 * `minimumContextSlot` is the caller's accepted preflight context: nothing observed
 * here may be older than what the guard already accepted. `lastValidBlockHeight`
 * comes from the attempt's own blockhash.
 */
export interface RedaxKnownSignatureOutcomeRequest {
  readonly signature: RedaxKnownSignature
  readonly intendedMessage: RedaxIntendedLegacyMessageCommitmentV1
  readonly minimumContextSlot: number
  readonly lastValidBlockHeight: number
}

// --- Protected structural reading ----------------------------------------------

type ProtectedRead = { readonly ok: true; readonly value: unknown } | { readonly ok: false }

const READ_FAILED: ProtectedRead = Object.freeze({ ok: false as const })

/**
 * Read one property of an untrusted response object.
 *
 * `Reflect.get` inside a `try`, every single time. A provider — or anything
 * pretending to be one — can define a property as an accessor that throws, and a
 * plain `response.err` would then raise inside this module and escape as a
 * rejection, past the declared result union. Consulted structurally, a hostile
 * accessor is simply a failed read.
 *
 * No `instanceof` anywhere in this file: this repository really does resolve two
 * distinct copies of the chain package, so a nominal check would be unreliable.
 * Nothing is stringified, and nothing read here is ever returned or logged.
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

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

/** Present means "any value at all other than null / undefined". Shape is irrelevant. */
function isPresentError(value: unknown): boolean {
  return value !== null && value !== undefined
}

/** What a REQUIRED, nullable error member of a provider response actually said. */
type RequiredErrorRead = 'unreadable' | 'clean' | 'error'

/**
 * Adjudicate a REQUIRED error member — `status.err` and `meta.err`, and only those.
 *
 * Both are REQUIRED by the provider contract, and a record with no error spells that
 * out as an EXPLICIT `null`. `readProperty` cannot tell an ABSENT property from one
 * that is present and `undefined`: both surface as a successful read of `undefined`.
 * Neither carries the required evidence, so neither may be graded as anything.
 *
 * Reading `undefined` as "no error" would fail OPEN in the one direction that
 * matters — a malformed response would become a clean confirmed / finalized matching
 * outcome, which is exactly the claim this module must never make on missing
 * evidence. So absence and `undefined` are both UNREADABLE, `null` is the sole clean
 * answer, and every other present value stays error evidence: shape is irrelevant,
 * and a FALSY present value (`0`, `false`, `""`) is an error like any other.
 *
 * Nothing is required of the CONTAINER beyond what `readProperty` already enforces:
 * no own-property test, no plain-object or prototype test, no `instanceof`. A
 * response is judged by the evidence it carries, never by the constructor it
 * happens to have.
 */
function readRequiredNullableError(container: unknown, key: string): RequiredErrorRead {
  const read = readProperty(container, key)
  if (!read.ok || read.value === undefined) {
    return 'unreadable'
  }
  return isPresentError(read.value) ? 'error' : 'clean'
}

// --- Result construction --------------------------------------------------------

const BLOCKHEIGHT_UNAVAILABLE: RedaxOutcomeBlockheightObservation = Object.freeze({
  state: 'READ_UNAVAILABLE' as const,
  blockHeight: null,
})

interface OutcomeContext {
  readonly signature: RedaxKnownSignature
  readonly finality: RedaxOutcomeFinality
  readonly statusContextSlot: number | null
  readonly transactionSlot: number | null
  readonly blockheight: RedaxOutcomeBlockheightObservation
}

function plainOutcome(
  context: OutcomeContext,
  kind:
    | 'CONFIRMATION_PENDING'
    | 'TRANSACTION_NOT_YET_READABLE'
    | 'LANDED_MESSAGE_MISMATCH'
    | 'CONFIRMED_MESSAGE_META_MATCHING'
    | 'FINALIZED_MESSAGE_META_MATCHING',
): RedaxKnownSignatureOutcome {
  const outcome: RedaxKnownSignatureOutcome = {
    kind,
    signature: context.signature,
    finality: context.finality,
    statusContextSlot: context.statusContextSlot,
    transactionSlot: context.transactionSlot,
    blockheight: context.blockheight,
  }
  return Object.freeze(outcome)
}

function landedFailure(
  context: OutcomeContext,
  failureEvidence: RedaxOutcomeFailureEvidence,
): RedaxKnownSignatureOutcome {
  const outcome: RedaxKnownSignatureOutcome = {
    kind: 'LANDED_TRANSACTION_FAILED',
    signature: context.signature,
    finality: context.finality,
    statusContextSlot: context.statusContextSlot,
    transactionSlot: context.transactionSlot,
    blockheight: context.blockheight,
    failureEvidence,
  }
  return Object.freeze(outcome)
}

function readUnavailable(
  context: OutcomeContext,
  stage: RedaxOutcomeReadStage,
  reason: RedaxOutcomeReadReason,
): RedaxKnownSignatureOutcome {
  const outcome: RedaxKnownSignatureOutcome = {
    kind: 'READ_UNAVAILABLE',
    signature: context.signature,
    finality: context.finality,
    statusContextSlot: context.statusContextSlot,
    transactionSlot: context.transactionSlot,
    blockheight: context.blockheight,
    stage,
    reason,
  }
  return Object.freeze(outcome)
}

// --- Blockheight ----------------------------------------------------------------

/**
 * Observe whether the attempt's blockhash is still within its validity window.
 *
 * `minContextSlot` is passed because a node that is behind the accepted preflight
 * context would otherwise be able to report a LOWER height and make an expired
 * blockhash look valid — failing open in the one direction that matters. A node
 * that cannot reach the requested slot raises, and raising here is simply
 * `READ_UNAVAILABLE`: unlike the chain guard, this observation authorizes nothing,
 * so there is no reason to distinguish WHY it was unavailable, and no numeric
 * provider code is examined.
 */
async function observeBlockheight(
  reader: RedaxOutcomeChainReader,
  minimumContextSlot: number,
  lastValidBlockHeight: number,
): Promise<RedaxOutcomeBlockheightObservation> {
  let observed: unknown
  try {
    observed = await reader.getBlockHeight({
      commitment: 'confirmed',
      minContextSlot: minimumContextSlot,
    })
  } catch {
    return BLOCKHEIGHT_UNAVAILABLE
  }
  if (!isNonNegativeSafeInteger(observed)) {
    return BLOCKHEIGHT_UNAVAILABLE
  }
  return Object.freeze({
    state: observed <= lastValidBlockHeight ? ('VALID' as const) : ('EXPIRED' as const),
    blockHeight: observed,
  })
}

// --- Landed message -------------------------------------------------------------

type LandedMessageRead =
  | { readonly ok: true; readonly commitment: RedaxIntendedLegacyMessageCommitmentV1 }
  | { readonly ok: false; readonly mismatch: true }
  | { readonly ok: false; readonly mismatch: false; readonly reason: RedaxOutcomeReadReason }

/**
 * Serialize the FRESHLY RETURNED, freshly deserialized landed message and reduce it
 * to a commitment.
 *
 * Only this message is ever serialized. The caller's own transaction is not
 * reachable from here, so the "never re-serialize a live Transaction after wallet
 * handoff" rule cannot be broken by accident.
 *
 * The version is read exactly ONCE, here, so a hostile accessor gets a single
 * chance to answer and cannot present two different versions to two callers.
 *
 * The raw bytes exist only inside `commitByteInput` and are gone by the time this
 * returns — the commitment is all that survives.
 */
async function readLandedMessageCommitment(message: unknown): Promise<LandedMessageRead> {
  const version = readProperty(message, 'version')
  if (version.ok && version.value === REDAX_VERSIONED_MESSAGE_VERSION) {
    // A versioned (v0) message is not the approved legacy message. That is a
    // PROVABLE difference, not an unreadable one, so it is a mismatch — not a
    // refusal.
    return { ok: false, mismatch: true }
  }
  if (!version.ok || version.value !== REDAX_LEGACY_MESSAGE_VERSION) {
    // Missing, hostile or an unknown future version: identity cannot be decided
    // either way, so nothing is claimed.
    return { ok: false, mismatch: false, reason: 'MESSAGE_VERSION_UNSUPPORTED' }
  }

  const serialize = readProperty(message, 'serialize')
  if (!serialize.ok || typeof serialize.value !== 'function') {
    return { ok: false, mismatch: false, reason: 'MESSAGE_UNREADABLE' }
  }
  let serialized: unknown
  try {
    serialized = (serialize.value as (this: unknown) => unknown).call(message)
  } catch {
    return { ok: false, mismatch: false, reason: 'MESSAGE_UNREADABLE' }
  }

  const committed = await commitByteInput(serialized)
  if (!committed.ok) {
    return {
      ok: false,
      mismatch: false,
      reason:
        committed.code === 'INTENDED_MESSAGE_INVALID'
          ? 'MESSAGE_UNREADABLE'
          : 'MESSAGE_COMMITMENT_UNAVAILABLE',
    }
  }
  return { ok: true, commitment: committed.commitment }
}

/** Exact commitment equality: same scheme, same length, same digest. Nothing else. */
function sameCommitment(
  intended: RedaxIntendedLegacyMessageCommitmentV1,
  landed: RedaxIntendedLegacyMessageCommitmentV1,
): boolean {
  return (
    intended.kind === landed.kind &&
    intended.byteLength === landed.byteLength &&
    intended.sha256Hex === landed.sha256Hex
  )
}

// --- Request validation ----------------------------------------------------------

interface ValidatedRequest {
  readonly signature: RedaxKnownSignature
  readonly intendedKind: typeof REDAX_INTENDED_LEGACY_MESSAGE_COMMITMENT_KIND
  readonly intendedByteLength: number
  readonly intendedSha256Hex: string
  readonly minimumContextSlot: number
  readonly lastValidBlockHeight: number
}

/**
 * Validate the request and copy it into frozen primitives BEFORE the first `await`.
 *
 * Copying is not ceremony. If the caller's commitment object were held by reference,
 * a caller that mutated it while the RPC was in flight would rewrite the expectation
 * and the landed comparison would grade the answer against a moved target.
 *
 * Deliberately validated before any `try` that could swallow it, so a caller-contract
 * violation stays distinguishable from a provider failure instead of hiding inside
 * one.
 */
function validateRequest(request: unknown): ValidatedRequest | null {
  if (typeof request !== 'object' || request === null) {
    return null
  }
  const signature = readProperty(request, 'signature')
  if (
    !signature.ok ||
    typeof signature.value !== 'string' ||
    !NON_WHITESPACE_PATTERN.test(signature.value)
  ) {
    return null
  }
  const intendedMessage = readProperty(request, 'intendedMessage')
  if (!intendedMessage.ok) {
    return null
  }
  const kind = readProperty(intendedMessage.value, 'kind')
  const byteLength = readProperty(intendedMessage.value, 'byteLength')
  const sha256Hex = readProperty(intendedMessage.value, 'sha256Hex')
  if (
    !kind.ok ||
    kind.value !== REDAX_INTENDED_LEGACY_MESSAGE_COMMITMENT_KIND ||
    !byteLength.ok ||
    !isNonNegativeSafeInteger(byteLength.value) ||
    byteLength.value <= 0 ||
    !sha256Hex.ok ||
    typeof sha256Hex.value !== 'string' ||
    !SHA256_HEX_PATTERN.test(sha256Hex.value)
  ) {
    return null
  }
  const minimumContextSlot = readProperty(request, 'minimumContextSlot')
  const lastValidBlockHeight = readProperty(request, 'lastValidBlockHeight')
  if (
    !minimumContextSlot.ok ||
    !isNonNegativeSafeInteger(minimumContextSlot.value) ||
    !lastValidBlockHeight.ok ||
    !isNonNegativeSafeInteger(lastValidBlockHeight.value)
  ) {
    return null
  }
  return Object.freeze({
    signature: signature.value as RedaxKnownSignature,
    intendedKind: REDAX_INTENDED_LEGACY_MESSAGE_COMMITMENT_KIND,
    intendedByteLength: byteLength.value,
    intendedSha256Hex: sha256Hex.value,
    minimumContextSlot: minimumContextSlot.value,
    lastValidBlockHeight: lastValidBlockHeight.value,
  })
}

// --- The observation --------------------------------------------------------------

/**
 * Observe, once, what became of one known signature.
 *
 * ONE SHOT AND STATELESS. At most one `getBlockHeight`, one `getSignatureStatuses`
 * and one `getTransaction`, then it returns. There is no timer, no loop, no
 * subscription and no automatic retry, so "timeout" is not a state this function can
 * produce — repetition is the caller's explicit decision, and a caller that asks
 * again gets a fresh, independent observation.
 *
 * `confirmTransaction` is not consulted and is not the outcome authority: it answers
 * "did my wait finish?", which is a question about this process, not about the chain.
 *
 * The order is load-bearing. Message identity is established BEFORE any status or
 * metadata error is attributed, because an error belonging to some other transaction
 * that happens to be visible under this signature must never be reported as ours.
 *
 * It never rejects. Every provider, response, accessor and crypto failure resolves
 * into a fixed typed result.
 */
export async function observeRedaxKnownSignatureOutcome(
  reader: RedaxOutcomeChainReader,
  request: RedaxKnownSignatureOutcomeRequest,
): Promise<RedaxKnownSignatureOutcome> {
  const validated = validateRequest(request)
  if (validated === null) {
    // No RPC call is made for an invalid request: there is nothing meaningful to ask.
    return readUnavailable(
      {
        signature: REDAX_NO_KNOWN_SIGNATURE,
        finality: 'unknown',
        statusContextSlot: null,
        transactionSlot: null,
        blockheight: BLOCKHEIGHT_UNAVAILABLE,
      },
      'REQUEST',
      'REQUEST_INVALID',
    )
  }

  const signature: string = validated.signature
  const intended: RedaxIntendedLegacyMessageCommitmentV1 = Object.freeze({
    kind: validated.intendedKind,
    byteLength: validated.intendedByteLength,
    sha256Hex: validated.intendedSha256Hex,
  })

  // Observed once, then carried on every result below. It informs nothing here.
  const blockheight = await observeBlockheight(
    reader,
    validated.minimumContextSlot,
    validated.lastValidBlockHeight,
  )

  let context: OutcomeContext = {
    signature: validated.signature,
    finality: 'unknown',
    statusContextSlot: null,
    transactionSlot: null,
    blockheight,
  }

  // --- status ---------------------------------------------------------------
  let statusResponse: unknown
  try {
    statusResponse = await reader.getSignatureStatuses([signature], {
      searchTransactionHistory: true,
    })
  } catch {
    return readUnavailable(context, 'STATUS', 'RPC_UNAVAILABLE')
  }

  const statusContext = readProperty(statusResponse, 'context')
  const statusContextSlot = readProperty(statusContext.ok ? statusContext.value : null, 'slot')
  if (!statusContextSlot.ok || !isNonNegativeSafeInteger(statusContextSlot.value)) {
    return readUnavailable(context, 'STATUS', 'RESPONSE_MALFORMED')
  }
  if (statusContextSlot.value < validated.minimumContextSlot) {
    // The request option protects request EVALUATION; this rejects a stale ANSWER.
    return readUnavailable(context, 'STATUS', 'CONTEXT_BEHIND_MINIMUM')
  }
  context = { ...context, statusContextSlot: statusContextSlot.value }

  const statusValue = readProperty(statusResponse, 'value')
  if (!statusValue.ok || !Array.isArray(statusValue.value) || statusValue.value.length !== 1) {
    return readUnavailable(context, 'STATUS', 'RESPONSE_MALFORMED')
  }
  const statusEntry = readProperty(statusValue.value, '0')
  if (!statusEntry.ok) {
    return readUnavailable(context, 'STATUS', 'RESPONSE_MALFORMED')
  }
  if (statusEntry.value === null || statusEntry.value === undefined) {
    // A null status is RPC lag or a transaction not yet visible. It is pending, and
    // it is never a failure — the node is telling us it does not know, not that
    // nothing happened.
    return plainOutcome(context, 'CONFIRMATION_PENDING')
  }
  if (typeof statusEntry.value !== 'object') {
    return readUnavailable(context, 'STATUS', 'RESPONSE_MALFORMED')
  }
  const status = statusEntry.value

  // Only the exact spelling counts. `confirmations === null` is NOT read as
  // finalized and a numeric `confirmations` is NOT read as confirmed: inferring
  // finality from a field's absence or shape would fail OPEN on a malformed
  // response, which is the wrong direction for the one question that governs
  // whether an outcome is provisional or settled.
  const confirmationStatus = readProperty(status, 'confirmationStatus')
  const rawFinality = confirmationStatus.ok ? confirmationStatus.value : undefined
  const finality: RedaxOutcomeFinality =
    rawFinality === 'processed' ||
    rawFinality === 'confirmed' ||
    rawFinality === 'finalized'
      ? rawFinality
      : 'unknown'
  context = { ...context, finality }

  if (finality !== 'confirmed' && finality !== 'finalized') {
    return plainOutcome(context, 'CONFIRMATION_PENDING')
  }

  // --- transaction ----------------------------------------------------------
  let transactionResponse: unknown
  try {
    transactionResponse = await reader.getTransaction(signature, {
      commitment: finality,
      maxSupportedTransactionVersion: 0,
    })
  } catch {
    return readUnavailable(context, 'TRANSACTION', 'RPC_UNAVAILABLE')
  }
  if (transactionResponse === null || transactionResponse === undefined) {
    // The status says it landed but the transaction is not readable yet. Pending,
    // never failure.
    return plainOutcome(context, 'TRANSACTION_NOT_YET_READABLE')
  }

  const transactionSlot = readProperty(transactionResponse, 'slot')
  if (!transactionSlot.ok || !isNonNegativeSafeInteger(transactionSlot.value)) {
    return readUnavailable(context, 'TRANSACTION', 'RESPONSE_MALFORMED')
  }
  if (transactionSlot.value < validated.minimumContextSlot) {
    return readUnavailable(context, 'TRANSACTION', 'CONTEXT_BEHIND_MINIMUM')
  }
  context = { ...context, transactionSlot: transactionSlot.value }

  const transaction = readProperty(transactionResponse, 'transaction')
  if (!transaction.ok) {
    return readUnavailable(context, 'TRANSACTION', 'RESPONSE_MALFORMED')
  }
  const message = readProperty(transaction.value, 'message')
  if (!message.ok) {
    return readUnavailable(context, 'TRANSACTION', 'RESPONSE_MALFORMED')
  }

  // --- 1. exact landed message identity, before any attribution --------------
  const landed = await readLandedMessageCommitment(message.value)
  if (!landed.ok) {
    if (landed.mismatch) {
      return plainOutcome(context, 'LANDED_MESSAGE_MISMATCH')
    }
    return readUnavailable(context, 'TRANSACTION', landed.reason)
  }
  if (!sameCommitment(intended, landed.commitment)) {
    // Reported even when the status or metadata carries an error: an error that
    // belongs to a different message is not this attempt's outcome.
    return plainOutcome(context, 'LANDED_MESSAGE_MISMATCH')
  }

  // --- 2. required status error ----------------------------------------------
  const statusError = readRequiredNullableError(status, 'err')
  if (statusError === 'unreadable') {
    // Unreadable OR absent OR undefined. A status record that does not carry its
    // required error member is malformed, and a malformed record is never clean.
    return readUnavailable(context, 'STATUS', 'RESPONSE_MALFORMED')
  }

  // --- 3. meta presence ------------------------------------------------------
  const meta = readProperty(transactionResponse, 'meta')
  if (!meta.ok || typeof meta.value !== 'object' || meta.value === null) {
    // Without metadata neither cleanliness nor failure can be established. Refusing
    // here rather than reporting a failure on partial evidence keeps the fail-closed
    // direction: an unresolved read stays unresolved, and never becomes success.
    return readUnavailable(context, 'TRANSACTION', 'META_UNAVAILABLE')
  }

  // --- 4. required meta error ------------------------------------------------
  const metaError = readRequiredNullableError(meta.value, 'err')
  if (metaError === 'unreadable') {
    // Metadata that exists but does not carry its required error member is exactly
    // as uninformative as metadata that is missing outright, and is treated the
    // same way: unavailable, never clean.
    return readUnavailable(context, 'TRANSACTION', 'META_UNAVAILABLE')
  }

  // --- 5. attribution --------------------------------------------------------
  const hasStatusError = statusError === 'error'
  const hasMetaError = metaError === 'error'
  if (hasStatusError && hasMetaError) {
    return landedFailure(context, 'STATUS_AND_META')
  }
  if (hasStatusError) {
    return landedFailure(context, 'STATUS')
  }
  if (hasMetaError) {
    return landedFailure(context, 'META')
  }

  // The approved message landed and neither side reports an error.
  //
  // CONFIRMED is PROVISIONAL: a confirmed block can still be reorganised, so a later
  // finalized observation overrides this one — that override is the caller's
  // presentation rule, and this module makes it decidable by reporting finality
  // rather than by remembering anything.
  return plainOutcome(
    context,
    finality === 'finalized'
      ? 'FINALIZED_MESSAGE_META_MATCHING'
      : 'CONFIRMED_MESSAGE_META_MATCHING',
  )
}
