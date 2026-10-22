// REDAX Team/Admin S1 public recovery journal — one attempt, remembered honestly.
//
// -----------------------------------------------------------------------------
// WHAT THIS IS FOR
// -----------------------------------------------------------------------------
// A Team/Admin wallet has exactly ONE S1 campaign-setup attempt in flight at a time,
// for one cluster and one program. S1 is a single atomic four-instruction transaction
// that creates an output mint, a canonical fee vault and a Campaign PDA together —
// and the mint account creation cannot be repeated. This module is the durable public
// memory of that attempt, so a tab that dies mid-flight leaves evidence behind
// instead of leaving the next tab free to start the same thing again.
//
// The single most important property is what it CANNOT do. Nothing here sends, signs,
// retries, resets or reopens anything, and no result carries permission vocabulary: a
// recovery journal that can be read as authorization is a worse hazard than no journal
// at all, because storage is public and writable by anything with the origin.
// Everything here answers "what is known?", never "what may be done?".
//
// -----------------------------------------------------------------------------
// BOUNDARY — STILL A DEPENDENCY-FREE LEAF, NOW SPANNING THE POINT OF NO RETURN
// -----------------------------------------------------------------------------
// The vocabulary this module ranges over has grown past the raw send: there is one
// POST-raw-send terminal beside the two pre-raw-send ones. Its own capability has NOT
// grown by a byte — it still sends nothing, signs nothing, reads no chain and decides
// no outcome. The proof behind the new terminal is performed entirely by the one
// choreography that can perform it, and what happens here is the durable statement,
// under exact compare-and-set, that it was.
//
// ZERO IMPORTS. The module reaches the runtime only through module-private structural
// ports resolved from `globalThis` on every exported operation, naming only the
// members it uses: `getItem` / `setItem`, `navigator.locks.request` and
// `crypto.getRandomValues`. `removeItem` and the whole-origin wipe are deliberately
// unnameable here — see the tombstone note below. No wallet, adapter, `Connection`,
// `Transaction`, keypair, secret, React, UI, logger, network, environment or clock,
// no timer, no poll, no subscription and no storage-event hook. It logs nothing.
//
// -----------------------------------------------------------------------------
// WHY TOMBSTONES AND NOT DELETION
// -----------------------------------------------------------------------------
// Nothing here ever removes the stored value. A resolved attempt becomes a TOMBSTONE —
// a record that says how it ended. That is not tidiness: a module-performed deletion
// would be byte-identical to a hostile or accidental one, and the live-deletion
// detector would have to accept both. Keeping the record makes every disappearance
// detectable, which is the whole point.
//
// -----------------------------------------------------------------------------
// THE THREAT BOUNDARY, STATED PLAINLY
// -----------------------------------------------------------------------------
// CLIENT_ONLY_COLD_CLEAR_THREAT_ACCEPTED_FOR_BOUNDED_INTERNAL_DEVNET_DEMO_ONLY.
// Client-only persistence CANNOT detect total origin-storage deletion after all tabs
// close, a different browser / profile / device, or a complete out-of-session
// rollback. That residual is accepted for the bounded internal / devnet demo only —
// never for public production or mainnet — and no complete duplicate-prevention claim
// may be made outside it.

// --- Fixed vocabulary --------------------------------------------------------

/** The record's own schema literal, independent of the key's namespace generation. */
const REDAX_TEAM_ADMIN_RECOVERY_JOURNAL_SCHEMA = 'redax-team-admin-recovery-journal-v1' as const

/**
 * The SECOND record generation, stored at the SAME key and under the SAME lock.
 *
 * A v2 record is a v1 record plus one member, `frozenExpectations`, written at `begin` —
 * strictly BEFORE anything is signed or broadcast. It carries the public expectation the
 * S1 post-state assessor compares against and that v1 never recorded: the protocol fee
 * authority the plan was frozen against. Without it, a later explicit reconciliation of a
 * transaction that finalized after the first observation could only measure the chain read
 * against itself, so v1 deliberately left that case support-only.
 *
 * THE SLOT IS SHARED ACROSS GENERATIONS, and that is load-bearing: an unresolved v1 record
 * still blocks a v2 begin exactly as it blocked a v1 one. A v1 record is never upgraded,
 * rewritten or guessed into a v2 one — it keeps its exact bytes through every transition,
 * and a reconciliation that would need the missing expectation leaves it open instead.
 */
const REDAX_TEAM_ADMIN_RECOVERY_JOURNAL_SCHEMA_V2 = 'redax-team-admin-recovery-journal-v2' as const

/** Either record generation this module reads. */
export type RedaxTeamAdminRecoveryJournalSchema =
  | typeof REDAX_TEAM_ADMIN_RECOVERY_JOURNAL_SCHEMA
  | typeof REDAX_TEAM_ADMIN_RECOVERY_JOURNAL_SCHEMA_V2

/** The commitment scheme this module accepts. Structurally identical, never imported. */
const REDAX_INTENDED_LEGACY_MESSAGE_COMMITMENT_KIND =
  'redax-intended-legacy-message-sha256-v1' as const

/** The prefix every accepted frozen-plan fingerprint carries. */
const REDAX_CAMPAIGN_PLAN_FINGERPRINT_PREFIX = 'redax-team-admin-plan-v1' as const

/** The namespace-generation version of the storage key and the lock name. */
const REDAX_JOURNAL_KEY_PREFIX = 'redax.teamAdmin.recovery.v1' as const
const REDAX_JOURNAL_LOCK_PREFIX = 'redax.teamAdmin.recovery.lock.v1' as const

/** The only cluster Phase 1 persists anything for. */
const REDAX_JOURNAL_CLUSTER = 'devnet' as const

/** A public base58-looking account identifier. Never decoded, never trusted further. */
const BASE58_ACCOUNT_PATTERN = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/

/** Digits only, no sign, no exponent, no separator, no leading zero except "0". */
const CANONICAL_UNSIGNED_DECIMAL_PATTERN = /^(?:0|[1-9][0-9]*)$/

/** The same, optionally negative — the program's `end_ts` is a signed `i64`. */
const CANONICAL_SIGNED_DECIMAL_PATTERN = /^-?(?:0|[1-9][0-9]*)$/

/** Exactly 64 lowercase hexadecimal characters. */
const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/

/** The program's `[u8; 32]` salt, as exactly 64 lowercase hexadecimal characters. */
const SALT_HEX_PATTERN = /^[0-9a-f]{64}$/

/** Exactly 32 lowercase hexadecimal characters — 16 bytes of public entropy. */
const ATTEMPT_NONCE_PATTERN = /^[0-9a-f]{32}$/

/**
 * The exact on-chain widths, so a raw amount that could never have come from the
 * program is rejected here rather than persisted and compared later.
 *
 * Compared as BigInt. A raw amount is NEVER coerced through `Number`: `u128` and
 * `i64` both exceed the safe-integer range, and a silent precision loss in a recovery
 * record would be a silently wrong recovery record.
 */
const U128_MAX = BigInt('340282366920938463463374607431768211455')
const I64_MIN = BigInt('-9223372036854775808')
const I64_MAX = BigInt('9223372036854775807')

/** 16 bytes of `crypto.getRandomValues`, and nothing else, ever. */
const ATTEMPT_NONCE_BYTE_LENGTH = 16

/**
 * A fixed NON-ZERO pattern written into every entropy buffer before it is filled.
 *
 * It gives "the generator did nothing" a distinguishable value. A zero prefill would
 * be indistinguishable from a generator that zero-fills, and those are two of the
 * exact silent-failure shapes the liveness check below exists to catch.
 */
const ENTROPY_PREFILL_BYTE = 0xa5

// --- Public types ------------------------------------------------------------

/** Phase 1 persists for exactly one cluster. */
export type RedaxTeamAdminRecoveryCluster = typeof REDAX_JOURNAL_CLUSTER

/**
 * The one slot a Team/Admin S1 attempt occupies.
 *
 * Deliberately NOT keyed by campaign, salt or plan fingerprint. One Team wallet on one
 * program has one S1 attempt in flight, full stop — a per-plan slot would let a team
 * start a second setup while the first was unresolved, which is the exact failure this
 * journal exists to prevent.
 */
export interface RedaxTeamAdminRecoveryNamespace {
  readonly cluster: RedaxTeamAdminRecoveryCluster
  readonly program: string
  readonly teamWallet: string
}

/**
 * How far the attempt has provably got.
 *
 * `PRE_INVOCATION` means the Team/Admin POINT OF NO RETURN HAS NOT BEEN CROSSED — no
 * Team/Admin raw submission has been invoked. It does NOT mean no gesture of any kind
 * has happened: under the sign-only transport a wallet signature MAY already exist
 * while this state still holds, because the wallet never broadcasts and REDAX itself
 * owns the single raw send. The record is written and read back before that one
 * irreversible call precisely so that this state is trustworthy.
 *
 * `POST_INVOCATION_SIGNATURE_UNKNOWN` is the ambiguous state that has no safe exit:
 * something may or may not have been broadcast, and nothing here can decide it.
 */
export type RedaxTeamAdminRecoveryLifecycle =
  | 'PRE_INVOCATION'
  | 'POST_INVOCATION_SIGNATURE_UNKNOWN'
  | 'KNOWN_SIGNATURE'
  | 'TOMBSTONE'

/** A versioned commitment to one compiled legacy message. Re-declared, not imported. */
export interface RedaxTeamAdminIntendedMessageCommitmentV1 {
  readonly kind: typeof REDAX_INTENDED_LEGACY_MESSAGE_COMMITMENT_KIND
  readonly byteLength: number
  readonly sha256Hex: string
}

/**
 * Exactly the PUBLIC plan facts a recovery needs, and not one field more.
 *
 * Every one is already public: three planned addresses, two public role identities,
 * the public salt, and the deadline and cap the team chose. There is no secret key,
 * no keypair, no signed byte and no raw error — and there is no field in which any of
 * those could be carried.
 */
export interface RedaxTeamAdminRecoveryPlanFactsV1 {
  readonly campaign: string
  readonly outputMint: string
  readonly protocolFeeVault: string
  readonly outputGovernance: string
  readonly campaignAdmin: string
  readonly saltHex: string
  /** Canonical signed-i64 decimal string, or `null` for no deadline. */
  readonly endTs: string | null
  readonly maxOutputSupply: string
}

/**
 * The v2 frozen post-state expectations, recorded before the point of no return.
 *
 * Public identities only. `protocolFeeAuthority` is the authority the plan was frozen
 * against by the chain guard's Phase A — the value the assessor requires the ProtocolConfig
 * to still declare. It is never taken from a later chain read: a value read after the fact
 * and then used as its own expectation proves nothing.
 */
export interface RedaxTeamAdminRecoveryFrozenExpectationsV2 {
  readonly protocolFeeAuthority: string
}

/** The blockhash-validity metadata a recovery reconciles against. */
export interface RedaxTeamAdminRecoveryBlockhashValidityV1 {
  readonly preflightContextSlot: number
  readonly lastValidBlockHeight: number
}

/**
 * What has been observed about the attempt. An observation, never a permission.
 *
 * `AWAITING_WALLET_APPROVAL` is deliberately ABSENT: it is ephemeral UI state that
 * exists only while a prompt is open, and persisting it would make a closed tab look
 * like a live one. It is unrepresentable here, not merely discouraged.
 */
export type RedaxTeamAdminRecoveryObservation =
  | 'PREFLIGHT_REFUSED'
  | 'SUBMISSION_OUTCOME_UNKNOWN_WITHOUT_SIGNATURE'
  | 'SIGNATURE_OBSERVED'
  | 'LANDED_TRANSACTION_FAILED'
  | 'LANDED_MESSAGE_MISMATCH'
  | 'MATCHING_COMPLETE_STATE'
  | 'ORPHAN_RESIDUE'
  | 'PROTOCOL_CONFIG_CHANGED'
  | 'READ_UNAVAILABLE'
  | 'SUPPORT_ONLY'
  /**
   * The deliberate verified stop: one wallet sign-only request succeeded, the exact
   * fixed two-signature artifact verified against the committed message, the
   * post-wallet reassertion passed, and REDAX invoked NO raw broadcast at all.
   *
   * It is not a refusal and not a failure — nothing was refused and nothing went
   * wrong — which is exactly why it cannot be recorded as `PREFLIGHT_REFUSED`.
   */
  | 'VERIFIED_TWO_SIGNATURE_ARTIFACT_NO_BROADCAST'
  /**
   * The POST-raw-send proof: a transaction was handed to a node, its blockhash then
   * strictly expired, and at a FINALIZED context above a floor that itself post-dates
   * that expiry the signature was absent AND none of the three planned accounts
   * existed.
   *
   * It is the only observation in this vocabulary that is a PROOF rather than a
   * sighting, which is why it belongs to its own resolution and to nothing else: a
   * bare `RECORD_OBSERVATION` could not establish the conjunction behind it, so
   * writing it that way is refused. It is deliberately absent from BOTH the
   * signatureless and the known-signature observation sets below, exactly as the
   * verified no-broadcast observation is, and for the same structural reason — its
   * only coherent home is its own tombstone tuple.
   */
  | 'FINALIZED_NO_LAND_PROVEN'

/**
 * How an attempt ended. A tombstone always carries exactly one of these.
 *
 * `ACCEPTED_SUPPORT_DISPOSITION` is permanently non-replaceable. Acknowledging that an
 * attempt is unresolved does not make it resolved, and it must never quietly become a
 * licence to start another one.
 */
export type RedaxTeamAdminRecoveryResolution =
  | 'PRE_INVOCATION_REFUSAL'
  | 'RESOLVED_MATCHING_COMPLETE_STATE'
  | 'ACCEPTED_RESOLVED_TERMINAL_FAILURE'
  | 'ACCEPTED_SUPPORT_DISPOSITION'
  /**
   * The second — and only other — pre-raw-send terminal. The signed artifact was
   * verified and then deliberately DISCARDED without any broadcast.
   *
   * REPLACEABLE, and safely so: this terminal is written ONLY on a path that stopped
   * before the one Team/Admin raw send could be reached, so no chain effect can have come
   * from the discarded artifact, and the keypair and the wire are destroyed with it.
   */
  | 'VERIFIED_NO_BROADCAST_DISCARDED'
  /**
   * The ONE post-raw-send terminal: the transaction was broadcast and is PROVEN not to
   * have landed.
   *
   * `knownSignature` is RETAINED through it, never discarded, and that is the whole
   * difference between this terminal and `VERIFIED_NO_BROADCAST_DISCARDED`. There,
   * nothing was ever handed to a node, so a signature would name nothing. Here
   * something WAS handed to a node, and a tombstone that forgot the signature it just
   * proved absent could never be re-checked by anyone, ever.
   *
   * REPLACEABLE — and safely so for a reason that must be stated rather than assumed:
   * it is reachable ONLY through the full finalized conjunction, which has proven at a
   * finalized context above a post-expiry floor that the old transaction cannot land
   * and that none of its effects exists. It is not replaceable because the attempt
   * looked finished, felt old, or timed out.
   */
  | 'RESOLVED_FINALIZED_NO_LAND'

/** Sanitized recovery codes. A closed vocabulary; never a raw error or endpoint. */
export type RedaxTeamAdminRecoveryIssueCode =
  | 'PROTOCOL_CONFIG_UNREADABLE'
  | 'PROTOCOL_CONFIG_ABSENT'
  | 'PROTOCOL_FEE_AUTHORITY_CHANGED'
  | 'CAMPAIGN_UNREADABLE'
  | 'CAMPAIGN_PDA_NOT_SELF_CONSISTENT'
  | 'CAMPAIGN_IDENTITY_MISMATCH'
  | 'CAMPAIGN_TERMS_MISMATCH'
  | 'OUTPUT_MINT_UNREADABLE'
  | 'OUTPUT_MINT_ABSENT'
  | 'OUTPUT_MINT_MISMATCH'
  | 'OUTPUT_MINT_RESIDUE'
  | 'PROTOCOL_FEE_VAULT_UNREADABLE'
  | 'PROTOCOL_FEE_VAULT_ABSENT'
  | 'PROTOCOL_FEE_VAULT_RESIDUE'
  | 'LANDED_MESSAGE_UNREADABLE'
  | 'LANDED_MESSAGE_NOT_EXACT'
  | 'EFFECT_ORIGIN_NOT_PROVEN'
  | 'SIGN_ONLY_REFUSAL'
  | 'CHAIN_GUARD_REFUSAL'
  | 'BLOCKHASH_VALIDITY_UNKNOWN'

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
export interface RedaxTeamAdminRecoveryRecordV1 {
  readonly schema: RedaxTeamAdminRecoveryJournalSchema
  readonly namespace: RedaxTeamAdminRecoveryNamespace
  readonly attemptNonce: string
  readonly revision: number
  readonly lifecycle: RedaxTeamAdminRecoveryLifecycle
  readonly planFingerprint: string
  readonly plan: RedaxTeamAdminRecoveryPlanFactsV1
  /** `null` exactly for a v1 record; always present on a v2 one. */
  readonly frozenExpectations: RedaxTeamAdminRecoveryFrozenExpectationsV2 | null
  readonly blockhashValidity: RedaxTeamAdminRecoveryBlockhashValidityV1
  readonly intendedMessage: RedaxTeamAdminIntendedMessageCommitmentV1
  readonly knownSignature: string | null
  readonly observation: RedaxTeamAdminRecoveryObservation | null
  readonly resolution: RedaxTeamAdminRecoveryResolution | null
  readonly issueCodes: readonly RedaxTeamAdminRecoveryIssueCode[]
}

/** The identity a mutation must present. Wrong identity is a conflict, never a merge. */
export interface RedaxTeamAdminRecoveryAttemptIdentity {
  readonly attemptNonce: string
  readonly revision: number
}

/** Begin a fresh attempt, or replace a replaceable tombstone under exact identity. */
export interface RedaxTeamAdminRecoveryBeginInput {
  readonly namespace: RedaxTeamAdminRecoveryNamespace
  readonly planFingerprint: string
  readonly plan: RedaxTeamAdminRecoveryPlanFactsV1
  /**
   * Present → a v2 record carrying these expectations. Absent → a v1 record, exactly as
   * before. The production S1 root always supplies it; v1 begins stay representable so
   * the existing record generation keeps its exact bytes and behaviour.
   */
  readonly frozenExpectations?: RedaxTeamAdminRecoveryFrozenExpectationsV2
  readonly blockhashValidity: RedaxTeamAdminRecoveryBlockhashValidityV1
  readonly intendedMessage: RedaxTeamAdminIntendedMessageCommitmentV1
  /** Explicitly `null` for a fresh slot; the exact tombstone identity to replace one. */
  readonly replaces: RedaxTeamAdminRecoveryAttemptIdentity | null
}

/**
 * The complete, closed set of state changes. There are NINE, and there is no tenth.
 *
 * The committed prose here read "There is no ninth." while the set held eight. The
 * ninth exists now, so the sentence moved with it rather than being left behind — a
 * stale count in a comment is a false durable statement about a closed set.
 */
export type RedaxTeamAdminRecoveryTransition =
  | { readonly type: 'MARK_INVOCATION_STARTED' }
  | { readonly type: 'RETAIN_KNOWN_SIGNATURE'; readonly knownSignature: string }
  | {
      readonly type: 'RECORD_OBSERVATION'
      readonly observation: RedaxTeamAdminRecoveryObservation
      readonly issueCodes: readonly RedaxTeamAdminRecoveryIssueCode[]
    }
  | { readonly type: 'RESOLVE_PRE_INVOCATION_REFUSAL' }
  | { readonly type: 'RESOLVE_VERIFIED_NO_BROADCAST' }
  | { readonly type: 'RESOLVE_MATCHING_COMPLETE_STATE' }
  | { readonly type: 'RESOLVE_TERMINAL_FAILURE' }
  | { readonly type: 'ACKNOWLEDGE_SUPPORT_DISPOSITION' }
  | { readonly type: 'RESOLVE_FINALIZED_NO_LAND' }

export interface RedaxTeamAdminRecoveryTransitionInput {
  readonly namespace: RedaxTeamAdminRecoveryNamespace
  readonly expectedAttemptNonce: string
  readonly expectedRevision: number
  readonly transition: RedaxTeamAdminRecoveryTransition
}

/**
 * Every way an operation can decline. Fixed, closed and value-free.
 *
 * None of these is a retry code. `LIVE_DELETION_DETECTED` and `LIVE_ROLLBACK_DETECTED`
 * in particular mean "the record moved under us", which makes the situation LESS
 * knowable, not more — they never recreate or re-open anything.
 */
export type RedaxTeamAdminRecoveryFailureCode =
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

export type RedaxTeamAdminRecoveryReadResult =
  | { readonly ok: true; readonly kind: 'EMPTY' }
  | { readonly ok: true; readonly kind: 'ACTIVE'; readonly record: RedaxTeamAdminRecoveryRecordV1 }
  | {
      readonly ok: true
      readonly kind: 'TOMBSTONE'
      readonly record: RedaxTeamAdminRecoveryRecordV1
    }
  | { readonly ok: false; readonly code: RedaxTeamAdminRecoveryFailureCode }

export type RedaxTeamAdminRecoveryWriteResult =
  | { readonly ok: true; readonly kind: 'CREATED'; readonly record: RedaxTeamAdminRecoveryRecordV1 }
  | { readonly ok: true; readonly kind: 'UPDATED'; readonly record: RedaxTeamAdminRecoveryRecordV1 }
  | {
      readonly ok: true
      readonly kind: 'TOMBSTONED'
      readonly record: RedaxTeamAdminRecoveryRecordV1
    }
  | { readonly ok: false; readonly code: RedaxTeamAdminRecoveryFailureCode }

// --- Module-private platform ports --------------------------------------------
//
// Resolved from `globalThis` on EVERY exported operation, never cached. A cached port
// would survive a page state the caller believes it has left, and a stale storage
// handle is precisely the kind of thing a recovery journal must not hold.
//
// Each port names only the members actually used, and each is declared structurally
// rather than against a DOM type, so this file compiles identically under the app's
// DOM lib and under the test runner's Node types — while making `removeItem`, the
// whole-origin wipe and `sessionStorage` unreachable rather than merely forbidden.

interface RedaxTeamAdminStoragePort {
  getItem(key: string): unknown
  setItem(key: string, value: string): unknown
}

interface RedaxTeamAdminLockManagerPort {
  request(
    name: string,
    options: { readonly mode: 'exclusive'; readonly ifAvailable: true },
    callback: (lock: unknown) => Promise<void>,
  ): Promise<unknown>
}

interface RedaxTeamAdminEntropyPort {
  getRandomValues(target: Uint8Array): unknown
}

function resolveStoragePort(): RedaxTeamAdminStoragePort | null {
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
  const port = candidate as RedaxTeamAdminStoragePort
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

function resolveLockManagerPort(): RedaxTeamAdminLockManagerPort | null {
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
  const port = locksCandidate as RedaxTeamAdminLockManagerPort
  let request: unknown
  try {
    request = port.request
  } catch {
    return null
  }
  return typeof request === 'function' ? port : null
}

function resolveEntropyPort(): RedaxTeamAdminEntropyPort | null {
  let candidate: unknown
  try {
    candidate = (globalThis as { crypto?: unknown }).crypto
  } catch {
    return null
  }
  if (typeof candidate !== 'object' || candidate === null) {
    return null
  }
  const port = candidate as RedaxTeamAdminEntropyPort
  let getRandomValues: unknown
  try {
    getRandomValues = port.getRandomValues
  } catch {
    return null
  }
  return typeof getRandomValues === 'function' ? port : null
}

/**
 * One 16-byte draw into a buffer nothing else has touched, or nothing at all.
 *
 * Web Crypto fills the caller's array IN PLACE and returns that same array, so a
 * `getRandomValues` that returns anything else is not the function this module needs.
 * Identity alone proves very little, though: a no-op that hands its argument back
 * satisfies it while writing not one byte. The buffer is therefore prefilled with a
 * fixed non-zero sentinel and inspected afterwards, which makes an untouched buffer
 * and an all-zero fill both visible.
 *
 * These are BOUNDED STRUCTURAL LIVENESS CHECKS. They do not authenticate the
 * generator, do not measure the quality of its output, and nothing here may be read as
 * either. A healthy generator can fail them only by drawing one exact 16-byte value,
 * which is negligible — bounded by a small multiple of 2^-128.
 */
function drawEntropyBytes(entropy: RedaxTeamAdminEntropyPort): Uint8Array | null {
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
 * capability: it identifies which attempt a compare-and-set is talking about. There is
 * deliberately no counter, no timestamp, no caller-supplied value and no injected
 * entropy seam — each of those would let two tabs mint the same identity, and the last
 * would let a test weaken production.
 *
 * TWO independent buffers are drawn and an identical pair is refused, because a
 * generator stuck on a single constant passes every check a single draw can make while
 * handing two tabs the same attempt identity. Only the first draw becomes the nonce;
 * the second is evidence about the generator and nothing else.
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
 * Read one property of an untrusted value ONCE, through a `try`.
 *
 * Once matters. Caller input and parsed storage can both define a property as an
 * accessor that answers differently each time or throws outright, so every property is
 * consulted a single time and the captured answer is what the operation uses.
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

function readValueOrUndefined(source: unknown, key: string): unknown {
  const read = readProperty(source, key)
  return read.ok ? read.value : undefined
}

/** A plain object candidate: not `null`, not an array, not a primitive. */
function isRecordCandidate(value: unknown): boolean {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function ownKeys(value: unknown): string[] | null {
  if (!isRecordCandidate(value)) {
    return null
  }
  try {
    return Object.keys(value as object)
  } catch {
    return null
  }
}

/** EXACTLY these keys — no missing member, and no extra one either. */
function hasExactKeys(value: unknown, expected: readonly string[]): boolean {
  const keys = ownKeys(value)
  if (keys === null || keys.length !== expected.length) {
    return false
  }
  for (const key of expected) {
    if (!keys.includes(key)) {
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

/** A canonical unsigned decimal string within the program's `u128` width. */
function isCanonicalU128(value: unknown): value is string {
  if (typeof value !== 'string' || !CANONICAL_UNSIGNED_DECIMAL_PATTERN.test(value)) {
    return false
  }
  try {
    return BigInt(value) <= U128_MAX
  } catch {
    return false
  }
}

/** A canonical signed decimal string within the program's `i64` width, or `null`. */
function isCanonicalOptionalI64(value: unknown): value is string | null {
  if (value === null) {
    return true
  }
  if (typeof value !== 'string' || !CANONICAL_SIGNED_DECIMAL_PATTERN.test(value)) {
    return false
  }
  try {
    const parsed = BigInt(value)
    return parsed >= I64_MIN && parsed <= I64_MAX
  } catch {
    return false
  }
}

/**
 * A transaction signature, structurally.
 *
 * Base58 of 64 bytes, so the printable form is 86–88 characters. Never decoded here —
 * this module compares and stores it, and asks nothing else of it.
 */
function isKnownSignature(value: unknown): value is string {
  return typeof value === 'string' && /^[1-9A-HJ-NP-Za-km-z]{86,88}$/.test(value)
}

/** The frozen plan's own fingerprint spelling. Prefix plus exactly 64 lowercase hex. */
function isPlanFingerprint(value: unknown): value is string {
  if (typeof value !== 'string') {
    return false
  }
  const prefix = `${REDAX_CAMPAIGN_PLAN_FINGERPRINT_PREFIX}:`
  return value.startsWith(prefix) && SHA256_HEX_PATTERN.test(value.slice(prefix.length))
}

// --- The record, internally ----------------------------------------------------

const RECORD_KEYS: readonly string[] = [
  'schema',
  'namespace',
  'attemptNonce',
  'revision',
  'lifecycle',
  'planFingerprint',
  'plan',
  'blockhashValidity',
  'intendedMessage',
  'knownSignature',
  'observation',
  'resolution',
  'issueCodes',
]

/** The v2 record: the v1 members plus `frozenExpectations`, and nothing else. */
const RECORD_KEYS_V2: readonly string[] = [...RECORD_KEYS, 'frozenExpectations']
const FROZEN_EXPECTATION_KEYS: readonly string[] = ['protocolFeeAuthority']

const NAMESPACE_KEYS: readonly string[] = ['cluster', 'program', 'teamWallet']
const COMMITMENT_KEYS: readonly string[] = ['kind', 'byteLength', 'sha256Hex']
const BLOCKHASH_KEYS: readonly string[] = ['preflightContextSlot', 'lastValidBlockHeight']
const PLAN_KEYS: readonly string[] = [
  'campaign',
  'outputMint',
  'protocolFeeVault',
  'outputGovernance',
  'campaignAdmin',
  'saltHex',
  'endTs',
  'maxOutputSupply',
]

const LIFECYCLES: readonly RedaxTeamAdminRecoveryLifecycle[] = [
  'PRE_INVOCATION',
  'POST_INVOCATION_SIGNATURE_UNKNOWN',
  'KNOWN_SIGNATURE',
  'TOMBSTONE',
]

const OBSERVATIONS: readonly RedaxTeamAdminRecoveryObservation[] = [
  'PREFLIGHT_REFUSED',
  'SUBMISSION_OUTCOME_UNKNOWN_WITHOUT_SIGNATURE',
  'SIGNATURE_OBSERVED',
  'LANDED_TRANSACTION_FAILED',
  'LANDED_MESSAGE_MISMATCH',
  'MATCHING_COMPLETE_STATE',
  'ORPHAN_RESIDUE',
  'PROTOCOL_CONFIG_CHANGED',
  'READ_UNAVAILABLE',
  'SUPPORT_ONLY',
  'VERIFIED_TWO_SIGNATURE_ARTIFACT_NO_BROADCAST',
  'FINALIZED_NO_LAND_PROVEN',
]

const RESOLUTIONS: readonly RedaxTeamAdminRecoveryResolution[] = [
  'PRE_INVOCATION_REFUSAL',
  'RESOLVED_MATCHING_COMPLETE_STATE',
  'ACCEPTED_RESOLVED_TERMINAL_FAILURE',
  'ACCEPTED_SUPPORT_DISPOSITION',
  'VERIFIED_NO_BROADCAST_DISCARDED',
  'RESOLVED_FINALIZED_NO_LAND',
]

/**
 * The tombstones a fresh attempt may replace.
 *
 * `ACCEPTED_SUPPORT_DISPOSITION` is deliberately absent and permanently so.
 *
 * `VERIFIED_NO_BROADCAST_DISCARDED` belongs here because nothing can have landed from
 * the attempt it closes: the artifact was verified and then destroyed with its keypair
 * before the one raw send could be reached, so no broadcast of it ever existed.
 *
 * `RESOLVED_FINALIZED_NO_LAND` belongs here for a different and stronger reason: the
 * attempt it closes WAS broadcast, and was then PROVEN not to have landed at a
 * finalized context above a post-expiry floor, with the signature absent and all three
 * planned accounts absent. Membership follows the proof, never the elapsed time.
 *
 * Replacement is still the exact existing discipline for both — a fresh nonce, a fresh
 * keypair, a fresh salt and a fresh plan — never a resend of the old one.
 */
const REPLACEABLE_RESOLUTIONS: readonly RedaxTeamAdminRecoveryResolution[] = [
  'PRE_INVOCATION_REFUSAL',
  'RESOLVED_MATCHING_COMPLETE_STATE',
  'ACCEPTED_RESOLVED_TERMINAL_FAILURE',
  'VERIFIED_NO_BROADCAST_DISCARDED',
  'RESOLVED_FINALIZED_NO_LAND',
]

/** The canonical issue-code order. Serialization emits exactly this order. */
const ISSUE_CODES: readonly RedaxTeamAdminRecoveryIssueCode[] = [
  'PROTOCOL_CONFIG_UNREADABLE',
  'PROTOCOL_CONFIG_ABSENT',
  'PROTOCOL_FEE_AUTHORITY_CHANGED',
  'CAMPAIGN_UNREADABLE',
  'CAMPAIGN_PDA_NOT_SELF_CONSISTENT',
  'CAMPAIGN_IDENTITY_MISMATCH',
  'CAMPAIGN_TERMS_MISMATCH',
  'OUTPUT_MINT_UNREADABLE',
  'OUTPUT_MINT_ABSENT',
  'OUTPUT_MINT_MISMATCH',
  'OUTPUT_MINT_RESIDUE',
  'PROTOCOL_FEE_VAULT_UNREADABLE',
  'PROTOCOL_FEE_VAULT_ABSENT',
  'PROTOCOL_FEE_VAULT_RESIDUE',
  'LANDED_MESSAGE_UNREADABLE',
  'LANDED_MESSAGE_NOT_EXACT',
  'EFFECT_ORIGIN_NOT_PROVEN',
  'SIGN_ONLY_REFUSAL',
  'CHAIN_GUARD_REFUSAL',
  'BLOCKHASH_VALIDITY_UNKNOWN',
]

/**
 * Transitions only the realm that CREATED the attempt may legitimately perform.
 *
 * Each writes a durable claim about what the origin session did with the transport —
 * that it handed the attempt over, that it never did, or that it verified a signed
 * artifact and then deliberately broadcast nothing. No other actor can know any of
 * those facts, so no other actor may assert one.
 *
 * The third is origin-only for exactly the same reason as the other two, and it is
 * worth saying why: a successor realm can SEE a `PRE_INVOCATION` record, but seeing
 * one proves nothing about a wallet request it never made or a verification it never
 * performed.
 *
 * `RESOLVE_FINALIZED_NO_LAND` IS DELIBERATELY NOT A MEMBER, and its absence is
 * arithmetic rather than policy. The gate below demands `PRE_INVOCATION` and
 * `!invocationStarted`; the finalized no-land terminal runs at `KNOWN_SIGNATURE` with
 * the invocation marker already written, so adding it here would make it permanently
 * unreachable. It is confined by CHOREOGRAPHY OWNERSHIP instead — the action root's
 * generic surface can neither represent nor execute it — and by the fact that its
 * proof is a conjunction of chain observations rather than a claim about which realm
 * is asking. A successor realm that can actually perform that conjunction is exactly
 * the actor recovery wants, which is the second reason this transition must stay
 * reachable from one.
 */
const ORIGIN_ONLY_TRANSITIONS: readonly RedaxTeamAdminRecoveryTransition['type'][] = [
  'MARK_INVOCATION_STARTED',
  'RESOLVE_PRE_INVOCATION_REFUSAL',
  'RESOLVE_VERIFIED_NO_BROADCAST',
]

/**
 * Observations a record may carry while the outcome has no signature.
 *
 * `VERIFIED_TWO_SIGNATURE_ARTIFACT_NO_BROADCAST` is deliberately absent from this set
 * AND from the known-signature set below: both describe records that have already
 * passed invocation, and that observation exists precisely to say invocation never
 * happened. Its only coherent home is its own tombstone tuple.
 *
 * `FINALIZED_NO_LAND_PROVEN` is absent from BOTH sets for the mirror-image reason. It
 * is not a state a record may merely be IN — it is a terminal proof, and a record
 * carrying it while still open would be asserting a finalized conjunction that nothing
 * had established. Its only coherent home is its own tombstone tuple too.
 */
const SIGNATURELESS_OBSERVATIONS: readonly RedaxTeamAdminRecoveryObservation[] = [
  'SUBMISSION_OUTCOME_UNKNOWN_WITHOUT_SIGNATURE',
  'MATCHING_COMPLETE_STATE',
  'ORPHAN_RESIDUE',
  'PROTOCOL_CONFIG_CHANGED',
  'READ_UNAVAILABLE',
  'SUPPORT_ONLY',
]

/** Observations a record may carry once an exact signature is known. */
const KNOWN_SIGNATURE_OBSERVATIONS: readonly RedaxTeamAdminRecoveryObservation[] = [
  'SIGNATURE_OBSERVED',
  'LANDED_TRANSACTION_FAILED',
  'LANDED_MESSAGE_MISMATCH',
  'MATCHING_COMPLETE_STATE',
  'ORPHAN_RESIDUE',
  'PROTOCOL_CONFIG_CHANGED',
  'READ_UNAVAILABLE',
  'SUPPORT_ONLY',
]

/** The mutable shape a record is assembled in, before it is frozen and published. */
interface JournalDraft {
  schema: RedaxTeamAdminRecoveryJournalSchema
  namespace: RedaxTeamAdminRecoveryNamespace
  attemptNonce: string
  revision: number
  lifecycle: RedaxTeamAdminRecoveryLifecycle
  planFingerprint: string
  plan: RedaxTeamAdminRecoveryPlanFactsV1
  frozenExpectations: RedaxTeamAdminRecoveryFrozenExpectationsV2 | null
  blockhashValidity: RedaxTeamAdminRecoveryBlockhashValidityV1
  intendedMessage: RedaxTeamAdminIntendedMessageCommitmentV1
  knownSignature: string | null
  observation: RedaxTeamAdminRecoveryObservation | null
  resolution: RedaxTeamAdminRecoveryResolution | null
  issueCodes: readonly RedaxTeamAdminRecoveryIssueCode[]
}

/** Freeze a draft, top to bottom, and publish it as the public record type. */
function publishRecord(draft: JournalDraft): RedaxTeamAdminRecoveryRecordV1 {
  Object.freeze(draft.namespace)
  Object.freeze(draft.plan)
  if (draft.frozenExpectations !== null) {
    Object.freeze(draft.frozenExpectations)
  }
  Object.freeze(draft.blockhashValidity)
  Object.freeze(draft.intendedMessage)
  Object.freeze(draft.issueCodes)
  return Object.freeze(draft) as RedaxTeamAdminRecoveryRecordV1
}

/** The issue codes, de-duplicated and in the one canonical order. */
function orderIssueCodes(
  codes: readonly RedaxTeamAdminRecoveryIssueCode[],
): readonly RedaxTeamAdminRecoveryIssueCode[] {
  return ISSUE_CODES.filter((code) => codes.includes(code))
}

/**
 * Is this draft a state the model actually admits?
 *
 * Applied to EVERY record — parsed from storage or constructed here — so a transition
 * cannot produce a shape the parser would later reject, and a hostile writer cannot
 * invent one the transitions could never have reached.
 */
function isCoherent(draft: JournalDraft): boolean {
  const signed = draft.knownSignature !== null

  // THE GENERATION AND ITS MEMBER AGREE, in both directions. A v1 record carrying an
  // expectation, or a v2 record without one, is neither generation.
  if (
    (draft.schema === REDAX_TEAM_ADMIN_RECOVERY_JOURNAL_SCHEMA) !==
    (draft.frozenExpectations === null)
  ) {
    return false
  }

  switch (draft.lifecycle) {
    case 'PRE_INVOCATION':
      return (
        !signed &&
        draft.observation === null &&
        draft.resolution === null &&
        draft.issueCodes.length === 0
      )
    case 'POST_INVOCATION_SIGNATURE_UNKNOWN':
      return (
        !signed &&
        draft.observation !== null &&
        SIGNATURELESS_OBSERVATIONS.includes(draft.observation) &&
        draft.resolution === null
      )
    case 'KNOWN_SIGNATURE':
      return (
        signed &&
        draft.observation !== null &&
        KNOWN_SIGNATURE_OBSERVATIONS.includes(draft.observation) &&
        draft.resolution === null
      )
    case 'TOMBSTONE':
      return isTombstoneCoherent(draft, signed)
  }
}

/**
 * Tombstone coherence, applied to CONSTRUCTED and PARSED records alike.
 *
 * Stored bytes are INPUT. A hostile or corrupted writer can present a canonically
 * shaped record this module never produced, so a rule that lived only inside a
 * transition function would never be applied to one at all. Every arm below therefore
 * states the COMPLETE tuple its resolution admits, and the arms are mutually
 * exclusive on `observation` — which is what makes the relation a biconditional in
 * both directions rather than a pairing that happens to hold on the way out.
 */
function isTombstoneCoherent(draft: JournalDraft, signed: boolean): boolean {
  switch (draft.resolution) {
    case 'PRE_INVOCATION_REFUSAL':
      return !signed && draft.observation === 'PREFLIGHT_REFUSED'
    case 'VERIFIED_NO_BROADCAST_DISCARDED':
      // The exact tuple, and nothing adjacent to it. `issueCodes` is read here — the
      // only tombstone arm that reads it — because a non-empty array would say the
      // verified stop ALSO carried a refusal or an unknown, which is exactly the
      // conflation this terminal exists to prevent. `!signed` is equally load-bearing:
      // a retained signature would assert a recovery authority that names nothing on
      // chain. Both are individually representable in valid canonical bytes, so both
      // must be individually refused.
      return (
        !signed &&
        draft.observation === 'VERIFIED_TWO_SIGNATURE_ARTIFACT_NO_BROADCAST' &&
        draft.issueCodes.length === 0
      )
    case 'RESOLVED_MATCHING_COMPLETE_STATE':
      return draft.observation === 'MATCHING_COMPLETE_STATE'
    case 'ACCEPTED_RESOLVED_TERMINAL_FAILURE':
      // A terminal failure is only ever accepted against an EXACT known signature: the
      // chain said something definite about a transaction we can name. Without one
      // there is nothing definite to accept, only an unknown to acknowledge.
      return (
        signed &&
        (draft.observation === 'LANDED_TRANSACTION_FAILED' ||
          draft.observation === 'LANDED_MESSAGE_MISMATCH')
      )
    case 'RESOLVED_FINALIZED_NO_LAND':
      // The exact tuple, and nothing adjacent to it. `signed` is load-bearing in the
      // OPPOSITE direction to the verified-no-broadcast arm above: this terminal names
      // a transaction that provably reached a node, and a tombstone that forgot its
      // signature could never be re-checked. `issueCodes` must be EMPTY because a
      // proven, clean, complete no-land carries nothing unexplained — an issue code
      // here would say the proof ALSO hit something it could not read, which is
      // precisely the state the conjunction refuses to terminate from.
      //
      // Enforced at PRODUCTION PARSING, against hostile fresh-realm storage, and not
      // merely on the way out of the transition that emits it. Both members are
      // individually representable in valid canonical bytes, so both are individually
      // refused.
      return (
        signed &&
        draft.observation === 'FINALIZED_NO_LAND_PROVEN' &&
        draft.issueCodes.length === 0
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
 * whitespace variants, key reordering, duplicate-member last-write semantics, a
 * permuted issue-code array and any external rewrite — without this module ever having
 * to guess whether a difference was benign.
 */
function canonicalize(draft: JournalDraft): string {
  const v1Shape = {
    schema: draft.schema,
    namespace: {
      cluster: draft.namespace.cluster,
      program: draft.namespace.program,
      teamWallet: draft.namespace.teamWallet,
    },
    attemptNonce: draft.attemptNonce,
    revision: draft.revision,
    lifecycle: draft.lifecycle,
    planFingerprint: draft.planFingerprint,
    plan: {
      campaign: draft.plan.campaign,
      outputMint: draft.plan.outputMint,
      protocolFeeVault: draft.plan.protocolFeeVault,
      outputGovernance: draft.plan.outputGovernance,
      campaignAdmin: draft.plan.campaignAdmin,
      saltHex: draft.plan.saltHex,
      endTs: draft.plan.endTs,
      maxOutputSupply: draft.plan.maxOutputSupply,
    },
    blockhashValidity: {
      preflightContextSlot: draft.blockhashValidity.preflightContextSlot,
      lastValidBlockHeight: draft.blockhashValidity.lastValidBlockHeight,
    },
    intendedMessage: {
      kind: draft.intendedMessage.kind,
      byteLength: draft.intendedMessage.byteLength,
      sha256Hex: draft.intendedMessage.sha256Hex,
    },
    knownSignature: draft.knownSignature,
    observation: draft.observation,
    resolution: draft.resolution,
    issueCodes: [...draft.issueCodes],
  }
  // A v1 record keeps its EXACT historical bytes; a v2 record appends its one member last.
  if (draft.frozenExpectations === null) {
    return JSON.stringify(v1Shape)
  }
  return JSON.stringify({
    ...v1Shape,
    frozenExpectations: {
      protocolFeeAuthority: draft.frozenExpectations.protocolFeeAuthority,
    },
  })
}

/** A record read back out of a published one, so transitions can build the next. */
function draftOf(record: RedaxTeamAdminRecoveryRecordV1): JournalDraft {
  return {
    schema: record.schema,
    namespace: {
      cluster: record.namespace.cluster,
      program: record.namespace.program,
      teamWallet: record.namespace.teamWallet,
    },
    attemptNonce: record.attemptNonce,
    revision: record.revision,
    lifecycle: record.lifecycle,
    planFingerprint: record.planFingerprint,
    plan: { ...record.plan },
    frozenExpectations:
      record.frozenExpectations === null ? null : { ...record.frozenExpectations },
    blockhashValidity: { ...record.blockhashValidity },
    intendedMessage: { ...record.intendedMessage },
    knownSignature: record.knownSignature,
    observation: record.observation,
    resolution: record.resolution,
    issueCodes: [...record.issueCodes],
  }
}

/**
 * The exact shape a fresh attempt opens in — the ONE place that shape is written.
 *
 * `begin` uses it to open or to replace, and the live-witness judgment replays it to
 * decide whether a different attempt nonce that appeared under this realm's feet is
 * genuinely what the production replacement path would have written. One producer
 * means there is no second definition of "a fresh attempt" to drift from the first.
 */
function buildBeginDraft(
  namespace: RedaxTeamAdminRecoveryNamespace,
  attemptNonce: string,
  revision: number,
  planFingerprint: string,
  plan: RedaxTeamAdminRecoveryPlanFactsV1,
  blockhashValidity: RedaxTeamAdminRecoveryBlockhashValidityV1,
  intendedMessage: RedaxTeamAdminIntendedMessageCommitmentV1,
  frozenExpectations: RedaxTeamAdminRecoveryFrozenExpectationsV2 | null,
): JournalDraft {
  return {
    schema:
      frozenExpectations === null
        ? REDAX_TEAM_ADMIN_RECOVERY_JOURNAL_SCHEMA
        : REDAX_TEAM_ADMIN_RECOVERY_JOURNAL_SCHEMA_V2,
    namespace: { ...namespace },
    attemptNonce,
    revision,
    lifecycle: 'PRE_INVOCATION',
    planFingerprint,
    plan: { ...plan },
    frozenExpectations: frozenExpectations === null ? null : { ...frozenExpectations },
    blockhashValidity: { ...blockhashValidity },
    intendedMessage: { ...intendedMessage },
    knownSignature: null,
    observation: null,
    resolution: null,
    issueCodes: [],
  }
}

// --- The strict parser ----------------------------------------------------------

type ParsedJournal =
  | {
      readonly ok: true
      readonly record: RedaxTeamAdminRecoveryRecordV1
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

function readEnum<T extends string>(source: unknown, key: string, allowed: readonly T[]): T | null {
  const read = readProperty(source, key)
  return read.ok ? toEnum(read.value, allowed) : null
}

function parseNamespaceValue(value: unknown): RedaxTeamAdminRecoveryNamespace | null {
  if (!hasExactKeys(value, NAMESPACE_KEYS)) {
    return null
  }
  const cluster = readProperty(value, 'cluster')
  const program = readProperty(value, 'program')
  const teamWallet = readProperty(value, 'teamWallet')
  if (
    !cluster.ok ||
    cluster.value !== REDAX_JOURNAL_CLUSTER ||
    !program.ok ||
    !isAccountIdentifier(program.value) ||
    !teamWallet.ok ||
    !isAccountIdentifier(teamWallet.value)
  ) {
    return null
  }
  return {
    cluster: REDAX_JOURNAL_CLUSTER,
    program: program.value,
    teamWallet: teamWallet.value,
  }
}

function parseCommitmentValue(value: unknown): RedaxTeamAdminIntendedMessageCommitmentV1 | null {
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

function parseBlockhashValidityValue(
  value: unknown,
): RedaxTeamAdminRecoveryBlockhashValidityV1 | null {
  if (!hasExactKeys(value, BLOCKHASH_KEYS)) {
    return null
  }
  const preflightContextSlot = readProperty(value, 'preflightContextSlot')
  const lastValidBlockHeight = readProperty(value, 'lastValidBlockHeight')
  if (
    !preflightContextSlot.ok ||
    !isNonNegativeSafeInteger(preflightContextSlot.value) ||
    !lastValidBlockHeight.ok ||
    !isNonNegativeSafeInteger(lastValidBlockHeight.value)
  ) {
    return null
  }
  return {
    preflightContextSlot: preflightContextSlot.value,
    lastValidBlockHeight: lastValidBlockHeight.value,
  }
}

function parsePlanValue(value: unknown): RedaxTeamAdminRecoveryPlanFactsV1 | null {
  if (!hasExactKeys(value, PLAN_KEYS)) {
    return null
  }
  const campaign = readProperty(value, 'campaign')
  const outputMint = readProperty(value, 'outputMint')
  const protocolFeeVault = readProperty(value, 'protocolFeeVault')
  const outputGovernance = readProperty(value, 'outputGovernance')
  const campaignAdmin = readProperty(value, 'campaignAdmin')
  const saltHex = readProperty(value, 'saltHex')
  const endTs = readProperty(value, 'endTs')
  const maxOutputSupply = readProperty(value, 'maxOutputSupply')
  if (
    !campaign.ok ||
    !isAccountIdentifier(campaign.value) ||
    !outputMint.ok ||
    !isAccountIdentifier(outputMint.value) ||
    !protocolFeeVault.ok ||
    !isAccountIdentifier(protocolFeeVault.value) ||
    !outputGovernance.ok ||
    !isAccountIdentifier(outputGovernance.value) ||
    !campaignAdmin.ok ||
    !isAccountIdentifier(campaignAdmin.value) ||
    !saltHex.ok ||
    typeof saltHex.value !== 'string' ||
    !SALT_HEX_PATTERN.test(saltHex.value) ||
    !endTs.ok ||
    endTs.value === undefined ||
    !isCanonicalOptionalI64(endTs.value) ||
    !maxOutputSupply.ok ||
    !isCanonicalU128(maxOutputSupply.value)
  ) {
    return null
  }
  return {
    campaign: campaign.value,
    outputMint: outputMint.value,
    protocolFeeVault: protocolFeeVault.value,
    outputGovernance: outputGovernance.value,
    campaignAdmin: campaignAdmin.value,
    saltHex: saltHex.value,
    endTs: endTs.value,
    maxOutputSupply: maxOutputSupply.value,
  }
}

/** The v2 expectations member: exactly one public account identifier, nothing else. */
function parseFrozenExpectationsValue(
  value: unknown,
): RedaxTeamAdminRecoveryFrozenExpectationsV2 | null {
  if (!hasExactKeys(value, FROZEN_EXPECTATION_KEYS)) {
    return null
  }
  const protocolFeeAuthority = readProperty(value, 'protocolFeeAuthority')
  if (!protocolFeeAuthority.ok || !isAccountIdentifier(protocolFeeAuthority.value)) {
    return null
  }
  return { protocolFeeAuthority: protocolFeeAuthority.value }
}

/** A REQUIRED nullable member: absent and `undefined` are invalid; only `null` is null. */
function readRequiredNullable(source: unknown, key: string): ProtectedRead {
  const read = readProperty(source, key)
  if (!read.ok || read.value === undefined) {
    return READ_FAILED
  }
  return read
}

/** The issue-code array, validated member by member against the closed vocabulary. */
function parseIssueCodes(value: unknown): readonly RedaxTeamAdminRecoveryIssueCode[] | null {
  if (!Array.isArray(value)) {
    return null
  }
  const codes: RedaxTeamAdminRecoveryIssueCode[] = []
  for (const entry of value) {
    const code = toEnum(entry, ISSUE_CODES)
    if (code === null || codes.includes(code)) {
      // Unknown, or a duplicate this module would never have written.
      return null
    }
    codes.push(code)
  }
  return codes
}

/**
 * Parse untrusted stored text into a validated, frozen record.
 *
 * The stored value is HOSTILE INPUT. It is public, it is writable by anything with
 * access to the origin, and it must never reach past this function as anything but a
 * fully validated record or a fixed refusal.
 */
function parseJournalText(raw: string): ParsedJournal {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return JOURNAL_CORRUPT
  }
  if (!isRecordCandidate(parsed)) {
    return JOURNAL_CORRUPT
  }

  // The schema literal is read FIRST, so a future generation stored at this key is
  // reported as incompatible rather than as damage.
  const schema = readProperty(parsed, 'schema')
  if (
    !schema.ok ||
    (schema.value !== REDAX_TEAM_ADMIN_RECOVERY_JOURNAL_SCHEMA &&
      schema.value !== REDAX_TEAM_ADMIN_RECOVERY_JOURNAL_SCHEMA_V2)
  ) {
    return JOURNAL_INCOMPATIBLE
  }
  const isV2 = schema.value === REDAX_TEAM_ADMIN_RECOVERY_JOURNAL_SCHEMA_V2
  if (!hasExactKeys(parsed, isV2 ? RECORD_KEYS_V2 : RECORD_KEYS)) {
    return JOURNAL_CORRUPT
  }
  let frozenExpectations: RedaxTeamAdminRecoveryFrozenExpectationsV2 | null = null
  if (isV2) {
    frozenExpectations = parseFrozenExpectationsValue(
      readValueOrUndefined(parsed, 'frozenExpectations'),
    )
    if (frozenExpectations === null) {
      return JOURNAL_CORRUPT
    }
  }

  const namespace = parseNamespaceValue(readValueOrUndefined(parsed, 'namespace'))
  const lifecycle = readEnum(parsed, 'lifecycle', LIFECYCLES)
  if (namespace === null || lifecycle === null) {
    return JOURNAL_CORRUPT
  }

  const attemptNonce = readProperty(parsed, 'attemptNonce')
  const revision = readProperty(parsed, 'revision')
  const planFingerprint = readProperty(parsed, 'planFingerprint')
  if (
    !attemptNonce.ok ||
    typeof attemptNonce.value !== 'string' ||
    !ATTEMPT_NONCE_PATTERN.test(attemptNonce.value) ||
    !revision.ok ||
    !isPositiveSafeInteger(revision.value) ||
    !planFingerprint.ok ||
    !isPlanFingerprint(planFingerprint.value)
  ) {
    return JOURNAL_CORRUPT
  }

  const plan = parsePlanValue(readValueOrUndefined(parsed, 'plan'))
  const blockhashValidity = parseBlockhashValidityValue(
    readValueOrUndefined(parsed, 'blockhashValidity'),
  )
  const intendedMessage = parseCommitmentValue(readValueOrUndefined(parsed, 'intendedMessage'))
  if (plan === null || blockhashValidity === null || intendedMessage === null) {
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
  const resolutionRead = readRequiredNullable(parsed, 'resolution')
  if (!observationRead.ok || !resolutionRead.ok) {
    return JOURNAL_CORRUPT
  }
  const observation =
    observationRead.value === null ? null : toEnum(observationRead.value, OBSERVATIONS)
  const resolution =
    resolutionRead.value === null ? null : toEnum(resolutionRead.value, RESOLUTIONS)
  if (
    (observationRead.value !== null && observation === null) ||
    (resolutionRead.value !== null && resolution === null)
  ) {
    return JOURNAL_CORRUPT
  }

  const issueCodes = parseIssueCodes(readValueOrUndefined(parsed, 'issueCodes'))
  if (issueCodes === null) {
    return JOURNAL_CORRUPT
  }

  const draft: JournalDraft = {
    schema: isV2 ? REDAX_TEAM_ADMIN_RECOVERY_JOURNAL_SCHEMA_V2 : REDAX_TEAM_ADMIN_RECOVERY_JOURNAL_SCHEMA,
    namespace,
    attemptNonce: attemptNonce.value,
    revision: revision.value,
    lifecycle,
    planFingerprint: planFingerprint.value,
    plan,
    frozenExpectations,
    blockhashValidity,
    intendedMessage,
    knownSignature: knownSignature.value === null ? null : (knownSignature.value as string),
    observation,
    resolution,
    issueCodes,
  }
  if (!isCoherent(draft)) {
    return JOURNAL_CORRUPT
  }
  const canonical = canonicalize(draft)
  return { ok: true, record: publishRecord(draft), canonical }
}

// --- The module-private live witness --------------------------------------------
//
// What THIS JavaScript realm has already seen at this key. Never exported, never
// persisted, never logged and never rendered — it is not a handle, not a capability
// and not send authorization. It records what this session itself established, so
// that two claims no other actor could possibly make — "this session created the
// attempt" and "this session handed it to the transport" — cannot be forged by a
// successor tab or by a hostile storage writer, and so that a durable record that
// moved in a way no legitimate serialized actor could have produced is NOTICED.
//
// It retains the EXACT previous canonical text, never a summary of it. A nonce, a
// revision and a "this attempt ended" flag are the three facts a storage rollback can
// most cheaply reproduce; the previous bytes are what it cannot.

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
 * Built by normalizing every transition-mutable member of `draftOf(record)` to a fixed
 * value and canonicalizing what is left, so the schema, the namespace, the nonce, the
 * plan fingerprint, every field of the frozen plan, the blockhash validity and the
 * intended-message commitment are all compared recursively by exactly the serializer
 * that wrote them. A second hand-maintained field list would be a second thing to keep
 * in step, and the first time it drifted an immutable field would silently stop being
 * immutable.
 */
function immutableProjection(record: RedaxTeamAdminRecoveryRecordV1): string {
  const projected = draftOf(record)
  projected.revision = 1
  projected.lifecycle = 'PRE_INVOCATION'
  projected.knownSignature = null
  projected.observation = null
  projected.resolution = null
  projected.issueCodes = []
  return canonicalize(projected)
}

/**
 * A known signature, once known, is permanent.
 *
 * Replacing it would point recovery at a transaction this team never handed over;
 * dropping it would throw away the only handle on one they may have. Null may become
 * non-null ONLY through the retained-signature step, and it is the exact one-step
 * relation below — not this function — that proves that.
 */
function isKnownSignatureContinuous(
  previous: RedaxTeamAdminRecoveryRecordV1,
  next: RedaxTeamAdminRecoveryRecordV1,
): boolean {
  return previous.knownSignature === null || next.knownSignature === previous.knownSignature
}

/**
 * The transitions worth replaying against a candidate successor record.
 *
 * The two parameterized transitions take their parameters FROM the candidate, which is
 * safe precisely because the replay is then compared to that candidate byte for byte: a
 * fabricated record may supply its own parameters and still has to be the exact output
 * of one real transition applied to the exact previous record.
 */
function replayCandidates(
  next: RedaxTeamAdminRecoveryRecordV1,
): RedaxTeamAdminRecoveryTransition[] {
  const candidates: RedaxTeamAdminRecoveryTransition[] = [
    { type: 'MARK_INVOCATION_STARTED' },
    { type: 'RESOLVE_PRE_INVOCATION_REFUSAL' },
    { type: 'RESOLVE_VERIFIED_NO_BROADCAST' },
    { type: 'RESOLVE_MATCHING_COMPLETE_STATE' },
    { type: 'RESOLVE_TERMINAL_FAILURE' },
    { type: 'ACKNOWLEDGE_SUPPORT_DISPOSITION' },
    { type: 'RESOLVE_FINALIZED_NO_LAND' },
  ]
  if (next.knownSignature !== null) {
    candidates.push({ type: 'RETAIN_KNOWN_SIGNATURE', knownSignature: next.knownSignature })
  }
  if (next.observation !== null) {
    candidates.push({
      type: 'RECORD_OBSERVATION',
      observation: next.observation,
      issueCodes: next.issueCodes,
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
  previous: RedaxTeamAdminRecoveryRecordV1,
  previousCanonical: string,
  next: RedaxTeamAdminRecoveryRecordV1,
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
 * Is `next` EXACTLY what the production `begin` replacement path would have written
 * over this exact previous record?
 *
 * A different attempt nonce is the one movement that opens a SECOND S1, so it is held
 * to the real begin contract rather than to a plausible-looking endpoint: the previous
 * record must be a tombstone whose resolution is in the REPLACEABLE set, the candidate
 * must satisfy the same Topology-1 role coherence `begin` validates on its input, and
 * the bytes must be exactly what `buildBeginDraft` emits at exactly the next revision.
 *
 * `ACCEPTED_SUPPORT_DISPOSITION` is permanently outside that set. Acknowledging an
 * unresolved submission never made it resolved, and a rollback that produces an older
 * replaceable tombstone must not be able to buy the replacement authority that the
 * permanent one refuses.
 */
function isExactBeginReplacement(
  previous: RedaxTeamAdminRecoveryRecordV1,
  next: RedaxTeamAdminRecoveryRecordV1,
  nextCanonical: string,
): boolean {
  if (
    previous.lifecycle !== 'TOMBSTONE' ||
    previous.resolution === null ||
    !REPLACEABLE_RESOLUTIONS.includes(previous.resolution) ||
    next.attemptNonce === previous.attemptNonce ||
    next.lifecycle !== 'PRE_INVOCATION' ||
    next.plan.campaignAdmin !== next.plan.outputGovernance
  ) {
    return false
  }
  const advanced = nextRevision(previous.revision)
  if (advanced === null || advanced !== next.revision) {
    return false
  }
  const replayed = buildBeginDraft(
    next.namespace,
    next.attemptNonce,
    advanced,
    next.planFingerprint,
    next.plan,
    next.blockhashValidity,
    next.intendedMessage,
    next.frozenExpectations,
  )
  return isCoherent(replayed) && canonicalize(replayed) === nextCanonical
}

/**
 * Compare what storage now says against what this realm last verified.
 *
 * A page reload creates a fresh realm with no witness, which is CORRECT: a reload is a
 * successor session and gets no inherited belief about the record — nor any of the
 * origin session's rights. That is the already disclosed client-only boundary, and
 * nothing here invents persistence to close it.
 *
 * Where a witness DOES exist, a changed record is accepted only as ONE exact step from
 * the exact previous record. Anything further is unverifiable: this module deliberately
 * stores no transition history, so a record two or more revisions ahead offers no
 * evidence that the steps in between ever happened, however plausible its endpoint
 * looks.
 */
function judgeAgainstWitness(
  witness: LiveWitness | undefined,
  next: RedaxTeamAdminRecoveryRecordV1 | null,
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
    // The witness is this module's own verified output and must re-parse. If it cannot,
    // nothing at all can be proved about the movement, and unprovable is refused.
    return 'LIVE_ROLLBACK_DETECTED'
  }
  if (next.revision < previous.record.revision) {
    return 'LIVE_ROLLBACK_DETECTED'
  }
  if (next.revision === previous.record.revision) {
    // At the same revision the record is the same record, or it is a forgery. There is
    // no third reading: every write this module makes advances the revision, so nothing
    // legitimate ever changes a byte in place.
    return nextCanonical === witness.canonical ? 'OK' : 'LIVE_ROLLBACK_DETECTED'
  }
  if (next.revision !== previous.record.revision + 1) {
    // A jump of more than one cannot be checked without the transitions it skipped, and
    // a stale realm failing closed is the correct outcome.
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
    // invoked, no other actor can legitimately mark the invocation started or call it a
    // pre-invocation refusal — those two are ours, and we have not made them. All
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
  // REPLACEABLE tombstone can legitimately mint a new nonce: an ACTIVE attempt is never
  // displaced, an unresolved attempt is never displaced, and an acknowledged support
  // disposition is permanent.
  return isExactBeginReplacement(previous.record, next, nextCanonical)
    ? 'OK'
    : 'LIVE_ROLLBACK_DETECTED'
}

function rememberWitness(
  key: string,
  record: RedaxTeamAdminRecoveryRecordV1,
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

function journalStorageKey(namespace: RedaxTeamAdminRecoveryNamespace): string {
  // `:` is safe as a delimiter because the cluster is a fixed literal and validated
  // base58 identifiers cannot contain one — so no pair of namespaces can collide.
  return `${REDAX_JOURNAL_KEY_PREFIX}:${namespace.cluster}:${namespace.program}:${namespace.teamWallet}`
}

function journalLockName(namespace: RedaxTeamAdminRecoveryNamespace): string {
  return `${REDAX_JOURNAL_LOCK_PREFIX}:${namespace.cluster}:${namespace.program}:${namespace.teamWallet}`
}

function readFailure(code: RedaxTeamAdminRecoveryFailureCode): RedaxTeamAdminRecoveryReadResult {
  return Object.freeze({ ok: false as const, code })
}

function writeFailure(code: RedaxTeamAdminRecoveryFailureCode): RedaxTeamAdminRecoveryWriteResult {
  return Object.freeze({ ok: false as const, code })
}

const LOCK_OPTIONS = Object.freeze({ mode: 'exclusive' as const, ifAvailable: true as const })

/**
 * Run one critical section under an EXCLUSIVE, NON-QUEUEING lock.
 *
 * Module-private, and it accepts no caller-supplied callback: every exported operation
 * passes its own internal body, and nothing generic is exported. Under `ifAvailable`
 * the callback is invoked with `null` when the lock is already held — that is a
 * refusal, never a wait. There is no queue, no steal, no timeout and no signal,
 * because a journal operation that waits is one another tab can make wait forever.
 *
 * The body's result is captured through a box rather than taken from what `request`
 * resolves to: the lock manager is resolved from `globalThis` and its return value is
 * not this module's to trust. If the callback never runs, nothing is captured and the
 * operation refuses.
 *
 * The lock is held for read -> decide -> write -> read-back -> verify, and nothing
 * longer. No wallet, RPC or UI work ever happens inside it.
 */
async function withExclusiveJournalLock<R>(
  namespace: RedaxTeamAdminRecoveryNamespace,
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
      readonly record: RedaxTeamAdminRecoveryRecordV1
      readonly canonical: string
    }
  | { readonly kind: 'FAILED'; readonly code: RedaxTeamAdminRecoveryFailureCode }

/**
 * Read, validate, canonicalize, BIND and judge — the shared first half of every
 * operation.
 *
 * The canonical round-trip is the load-bearing step: the stored text must equal the
 * canonical serialization of what it parsed to, byte for byte. That is what turns "it
 * happens to parse" into "it is exactly what this module would have written".
 *
 * The namespace the caller asked for is then required to be the namespace the record
 * carries. Internal consistency says nothing about whether a record was found where it
 * claims to live, and the requested namespace is exactly what derived the key it was
 * read from.
 */
function readStoredState(
  storage: RedaxTeamAdminStoragePort,
  key: string,
  namespace: RedaxTeamAdminRecoveryNamespace,
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
    // member the parser silently collapsed, a permuted issue-code array. Something
    // other than this module wrote it, and that is enough to refuse.
    return { kind: 'FAILED', code: 'JOURNAL_CORRUPT' }
  }
  if (
    parsed.record.namespace.cluster !== namespace.cluster ||
    parsed.record.namespace.program !== namespace.program ||
    parsed.record.namespace.teamWallet !== namespace.teamWallet
  ) {
    // A record that is internally perfect but belongs to ANOTHER slot: a different
    // cluster, program or team wallet. It must never be read as this wallet's attempt,
    // transitioned, replaced or overwritten, so it fails closed with or without a
    // witness — record-level invalidity outranks live-movement judgment, exactly as it
    // does for noncanonical bytes above.
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
  record: RedaxTeamAdminRecoveryRecordV1,
  canonical: string,
): void {
  const witness = LIVE_WITNESSES.get(key)
  if (witness === undefined || record.attemptNonce !== witness.attemptNonce) {
    // First sight in a fresh realm, or a DIFFERENT attempt than the one this realm was
    // following — another realm legitimately replaced a resolved tombstone. Both are
    // SUCCESSOR positions: this realm may reconcile, but it did not create the attempt
    // that is there now and never inherits the right to invoke it or to call it a
    // pre-invocation refusal. Those rights are minted only by the operation that
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
 * caller is about to act on the strength of it.
 */
function commitDraft(
  storage: RedaxTeamAdminStoragePort,
  key: string,
  draft: JournalDraft,
  createdInThisSession: boolean,
  invocationStarted: boolean,
):
  | { readonly ok: true; readonly record: RedaxTeamAdminRecoveryRecordV1 }
  | { readonly ok: false; readonly code: RedaxTeamAdminRecoveryFailureCode } {
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

interface ValidatedBegin {
  readonly namespace: RedaxTeamAdminRecoveryNamespace
  readonly planFingerprint: string
  readonly plan: RedaxTeamAdminRecoveryPlanFactsV1
  readonly frozenExpectations: RedaxTeamAdminRecoveryFrozenExpectationsV2 | null
  readonly blockhashValidity: RedaxTeamAdminRecoveryBlockhashValidityV1
  readonly intendedMessage: RedaxTeamAdminIntendedMessageCommitmentV1
  readonly replaces: RedaxTeamAdminRecoveryAttemptIdentity | null
}

function validateIdentity(value: unknown): RedaxTeamAdminRecoveryAttemptIdentity | null {
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

function validateBeginInput(input: unknown): ValidatedBegin | null {
  const namespace = parseNamespaceValue(readValueOrUndefined(input, 'namespace'))
  const planFingerprint = readProperty(input, 'planFingerprint')
  const plan = parsePlanValue(readValueOrUndefined(input, 'plan'))
  const blockhashValidity = parseBlockhashValidityValue(
    readValueOrUndefined(input, 'blockhashValidity'),
  )
  const intendedMessage = parseCommitmentValue(readValueOrUndefined(input, 'intendedMessage'))
  const replacesRead = readRequiredNullable(input, 'replaces')
  if (
    namespace === null ||
    !planFingerprint.ok ||
    !isPlanFingerprint(planFingerprint.value) ||
    plan === null ||
    blockhashValidity === null ||
    intendedMessage === null ||
    !replacesRead.ok
  ) {
    return null
  }
  const replaces = replacesRead.value === null ? null : validateIdentity(replacesRead.value)
  if (replacesRead.value !== null && replaces === null) {
    return null
  }
  // OPTIONAL, but never half-present: an absent member opens a v1 record, and a present
  // one must be exactly the v2 expectation shape or the whole begin is refused.
  const frozenRead = readProperty(input, 'frozenExpectations')
  if (!frozenRead.ok) {
    return null
  }
  let frozenExpectations: RedaxTeamAdminRecoveryFrozenExpectationsV2 | null = null
  if (frozenRead.value !== undefined) {
    frozenExpectations = parseFrozenExpectationsValue(frozenRead.value)
    if (frozenExpectations === null) {
      return null
    }
  }
  if (plan.campaignAdmin !== plan.outputGovernance) {
    return null
  }
  return {
    namespace,
    planFingerprint: planFingerprint.value,
    plan,
    frozenExpectations,
    blockhashValidity,
    intendedMessage,
    replaces,
  }
}

interface ValidatedTransition {
  readonly namespace: RedaxTeamAdminRecoveryNamespace
  readonly expectedAttemptNonce: string
  readonly expectedRevision: number
  readonly transition: RedaxTeamAdminRecoveryTransition
}

const TRANSITION_TYPES: readonly RedaxTeamAdminRecoveryTransition['type'][] = [
  'MARK_INVOCATION_STARTED',
  'RETAIN_KNOWN_SIGNATURE',
  'RECORD_OBSERVATION',
  'RESOLVE_PRE_INVOCATION_REFUSAL',
  'RESOLVE_VERIFIED_NO_BROADCAST',
  'RESOLVE_MATCHING_COMPLETE_STATE',
  'RESOLVE_TERMINAL_FAILURE',
  'ACKNOWLEDGE_SUPPORT_DISPOSITION',
  'RESOLVE_FINALIZED_NO_LAND',
]

function validateTransitionValue(value: unknown): RedaxTeamAdminRecoveryTransition | null {
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
    if (!hasExactKeys(value, ['type', 'observation', 'issueCodes'])) {
      return null
    }
    const observation = readEnum(value, 'observation', OBSERVATIONS)
    const issueCodes = parseIssueCodes(readValueOrUndefined(value, 'issueCodes'))
    if (observation === null || issueCodes === null) {
      return null
    }
    return { type, observation, issueCodes }
  }
  return hasExactKeys(value, ['type']) ? { type } : null
}

function validateTransitionInput(input: unknown): ValidatedTransition | null {
  const namespace = parseNamespaceValue(readValueOrUndefined(input, 'namespace'))
  const expectedAttemptNonce = readProperty(input, 'expectedAttemptNonce')
  const expectedRevision = readProperty(input, 'expectedRevision')
  const transition = validateTransitionValue(readValueOrUndefined(input, 'transition'))
  if (
    namespace === null ||
    !expectedAttemptNonce.ok ||
    typeof expectedAttemptNonce.value !== 'string' ||
    !ATTEMPT_NONCE_PATTERN.test(expectedAttemptNonce.value) ||
    !expectedRevision.ok ||
    !isPositiveSafeInteger(expectedRevision.value) ||
    transition === null
  ) {
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
 * Look at the one Team/Admin S1 attempt slot.
 *
 * Read-only, and still taken under the exclusive lock: a read that races a write could
 * observe a half-verified state and hand the caller a record that never became
 * durable. It never rejects; every platform, storage and parse failure resolves into a
 * fixed typed refusal, and nothing is logged.
 */
export async function readRedaxTeamAdminRecoveryJournal(
  namespace: RedaxTeamAdminRecoveryNamespace,
): Promise<RedaxTeamAdminRecoveryReadResult> {
  const validated = parseNamespaceValue(namespace)
  if (validated === null) {
    return readFailure('NAMESPACE_INVALID')
  }
  return withExclusiveJournalLock<RedaxTeamAdminRecoveryReadResult>(
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
 * ONE SLOT. A different plan, salt or campaign does not buy a second one — the point is
 * that this Team wallet has one unresolved S1 at a time, and S1 creates an account that
 * cannot be created twice.
 *
 * A corrupt or incompatible record is NEVER overwritten. Whatever is there might be the
 * only evidence that something was submitted, and destroying it to make room for a new
 * attempt would be the worst possible response to damage.
 */
export async function beginRedaxTeamAdminRecoveryAttempt(
  input: RedaxTeamAdminRecoveryBeginInput,
): Promise<RedaxTeamAdminRecoveryWriteResult> {
  const namespace = parseNamespaceValue(readValueOrUndefined(input, 'namespace'))
  if (namespace === null) {
    return writeFailure('NAMESPACE_INVALID')
  }
  const validated = validateBeginInput(input)
  if (validated === null) {
    return writeFailure('INPUT_INVALID')
  }

  return withExclusiveJournalLock<RedaxTeamAdminRecoveryWriteResult>(
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

      const draft = buildBeginDraft(
        validated.namespace,
        attemptNonce,
        revision,
        validated.planFingerprint,
        validated.plan,
        validated.blockhashValidity,
        validated.intendedMessage,
        validated.frozenExpectations,
      )
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
  | { readonly ok: false; readonly code: RedaxTeamAdminRecoveryFailureCode }

const TRANSITION_INVALID: TransitionOutcome = Object.freeze({
  ok: false as const,
  code: 'TRANSITION_INVALID' as const,
})

function applyTransition(
  record: RedaxTeamAdminRecoveryRecordV1,
  transition: RedaxTeamAdminRecoveryTransition,
  witness: LiveWitness | undefined,
): TransitionOutcome {
  const draft = draftOf(record)

  // The two claims no successor session can make. Checked once, here, so no individual
  // case can forget it.
  if (ORIGIN_ONLY_TRANSITIONS.includes(transition.type)) {
    if (
      draft.lifecycle !== 'PRE_INVOCATION' ||
      witness === undefined ||
      !witness.createdInThisSession ||
      witness.invocationStarted
    ) {
      return TRANSITION_INVALID
    }
  }

  switch (transition.type) {
    case 'MARK_INVOCATION_STARTED':
      return {
        ok: true,
        draft: {
          ...draft,
          lifecycle: 'POST_INVOCATION_SIGNATURE_UNKNOWN',
          observation: 'SUBMISSION_OUTCOME_UNKNOWN_WITHOUT_SIGNATURE',
          knownSignature: null,
          issueCodes: [],
        },
        invocationStarted: true,
      }

    case 'RETAIN_KNOWN_SIGNATURE':
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
          issueCodes: [],
        },
        invocationStarted: true,
      }

    case 'RECORD_OBSERVATION': {
      if (draft.lifecycle === 'PRE_INVOCATION' || draft.lifecycle === 'TOMBSTONE') {
        // Nothing has been observed before invocation, and a resolved attempt is over.
        return TRANSITION_INVALID
      }
      if (transition.observation === 'PREFLIGHT_REFUSED') {
        // The refusal observation belongs to its own resolution, which additionally
        // proves the invocation never started.
        return TRANSITION_INVALID
      }
      if (transition.observation === 'VERIFIED_TWO_SIGNATURE_ARTIFACT_NO_BROADCAST') {
        // Same shape, same reason. The verified-no-broadcast observation belongs to
        // its own resolution, which additionally proves the raw send never started —
        // and a bare observation could not prove that.
        return TRANSITION_INVALID
      }
      if (transition.observation === 'FINALIZED_NO_LAND_PROVEN') {
        // Third of the same shape. This one belongs to its own resolution because it
        // is a PROOF: strict blockhash expiry, a finalized floor established after it,
        // an exact-null history-enabled signature status at or above that floor, and
        // one coherent finalized read showing all three planned accounts absent. A
        // bare observation asserts the conclusion while establishing none of it.
        return TRANSITION_INVALID
      }
      const next: JournalDraft = {
        ...draft,
        observation: transition.observation,
        issueCodes: orderIssueCodes(transition.issueCodes),
      }
      return isCoherent(next)
        ? { ok: true, draft: next, invocationStarted: true }
        : TRANSITION_INVALID
    }

    case 'RESOLVE_PRE_INVOCATION_REFUSAL':
      // ONE of exactly TWO genuine PRE-raw-send resolutions — a count this file's one
      // new POST-raw-send terminal leaves untouched — and specifically the one says the
      // attempt FAILED or was REFUSED before any verified completion. The other is
      // `RESOLVE_VERIFIED_NO_BROADCAST` below, which says a wallet signature and an
      // exact two-signature verification both SUCCEEDED and nothing was broadcast
      // anyway. Both prove the same single fact — the point of no return was not
      // crossed — and neither subsumes the other, so recording one as the other would
      // put a false statement in the durable record.
      return {
        ok: true,
        draft: {
          ...draft,
          lifecycle: 'TOMBSTONE',
          observation: 'PREFLIGHT_REFUSED',
          resolution: 'PRE_INVOCATION_REFUSAL',
          issueCodes: [],
        },
        invocationStarted: false,
      }

    case 'RESOLVE_VERIFIED_NO_BROADCAST':
      // The successful, deliberate, verified stop. Reachable ONLY from PRE_INVOCATION,
      // and only for the realm that created the attempt — the shared origin-only gate
      // above enforces both, together with "the invocation marker was never written".
      //
      // It writes the exact tuple `isTombstoneCoherent` demands, and it deliberately
      // does NOT imply, call or precede `MARK_INVOCATION_STARTED` or
      // `RETAIN_KNOWN_SIGNATURE`: nothing was handed to a node, so there is no
      // broadcast to mark and no on-chain transaction for a retained signature to
      // name. A signature that names nothing on chain is not a recovery handle; it is
      // a misleading one.
      if (draft.lifecycle !== 'PRE_INVOCATION') {
        return TRANSITION_INVALID
      }
      return {
        ok: true,
        draft: {
          ...draft,
          lifecycle: 'TOMBSTONE',
          knownSignature: null,
          observation: 'VERIFIED_TWO_SIGNATURE_ARTIFACT_NO_BROADCAST',
          resolution: 'VERIFIED_NO_BROADCAST_DISCARDED',
          issueCodes: [],
        },
        invocationStarted: false,
      }

    case 'RESOLVE_MATCHING_COMPLETE_STATE':
      // The record must ALREADY carry the complete-state observation. This module
      // manufactures no effect proof of its own; establishing one is the pure
      // post-state mapper's job, over a coherent read this module never performs.
      if (draft.lifecycle === 'TOMBSTONE' || draft.observation !== 'MATCHING_COMPLETE_STATE') {
        return TRANSITION_INVALID
      }
      return {
        ok: true,
        draft: { ...draft, lifecycle: 'TOMBSTONE', resolution: 'RESOLVED_MATCHING_COMPLETE_STATE' },
        invocationStarted: draft.lifecycle !== 'PRE_INVOCATION',
      }

    case 'RESOLVE_TERMINAL_FAILURE':
      if (
        draft.lifecycle !== 'KNOWN_SIGNATURE' ||
        draft.knownSignature === null ||
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
          resolution: 'ACCEPTED_RESOLVED_TERMINAL_FAILURE',
        },
        invocationStarted: true,
      }

    case 'RESOLVE_FINALIZED_NO_LAND':
      // THE ONE POST-RAW-SEND TERMINAL. Reachable ONLY from `KNOWN_SIGNATURE`, which is
      // the only lifecycle in which an exact retained signature exists to have proven
      // anything about — and the retained signature is carried through UNCHANGED, never
      // discarded and never replaced.
      //
      // This module manufactures NO part of the proof behind it. Strict blockhash
      // expiry, the finalized floor, the exact-null signature status and the coherent
      // finalized account read all happen in the one choreography that can perform
      // them; what happens here is the durable statement, under exact compare-and-set,
      // that they were performed. That division is the same one `RESOLVE_MATCHING_
      // COMPLETE_STATE` already observes, and for the same reason: a journal that
      // decided outcomes would be a journal nobody could audit.
      //
      // It is NOT origin-only. A successor realm that can perform the conjunction is
      // exactly the actor recovery wants, and the conjunction is evidence about the
      // chain rather than a claim about which realm is asking.
      if (draft.lifecycle !== 'KNOWN_SIGNATURE' || draft.knownSignature === null) {
        return TRANSITION_INVALID
      }
      return {
        ok: true,
        draft: {
          ...draft,
          lifecycle: 'TOMBSTONE',
          observation: 'FINALIZED_NO_LAND_PROVEN',
          resolution: 'RESOLVED_FINALIZED_NO_LAND',
          issueCodes: [],
        },
        invocationStarted: true,
      }

    case 'ACKNOWLEDGE_SUPPORT_DISPOSITION':
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

/**
 * Advance the one attempt, under exact compare-and-set.
 *
 * Every mutation must present the exact attempt nonce AND the exact current revision,
 * and the record it produces carries exactly `revision + 1`. A mismatch is
 * `CAS_CONFLICT` and there is NO automatic retry: the caller re-reads and decides
 * again, because a journal that quietly retries its own writes is a journal that
 * quietly loses the race it was built to detect.
 */
export async function transitionRedaxTeamAdminRecoveryAttempt(
  input: RedaxTeamAdminRecoveryTransitionInput,
): Promise<RedaxTeamAdminRecoveryWriteResult> {
  const namespace = parseNamespaceValue(readValueOrUndefined(input, 'namespace'))
  if (namespace === null) {
    return writeFailure('NAMESPACE_INVALID')
  }
  const validated = validateTransitionInput(input)
  if (validated === null) {
    return writeFailure('INPUT_INVALID')
  }

  return withExclusiveJournalLock<RedaxTeamAdminRecoveryWriteResult>(
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
          committed.record.lifecycle === 'TOMBSTONE' ? ('TOMBSTONED' as const) : ('UPDATED' as const),
        record: committed.record,
      })
    },
  )
}
