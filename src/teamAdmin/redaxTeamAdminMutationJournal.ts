// -----------------------------------------------------------------------------
// WHAT THIS FILE IS
// -----------------------------------------------------------------------------
// The durable single-slot record of ONE in-flight Team/Admin post-init mutation, held in
// same-origin `localStorage` under an exclusive Web Lock. It is the THIRD approved
// `app/src` storage owner, and it is a NEW module rather than a migration: the closed S1
// journal `app/src/teamAdmin/redaxTeamAdminRecoveryJournal.ts` and the Holder journal
// `app/src/wallet/redaxHolderRecoveryJournal.ts` are UNCHANGED, and the three share an
// architecture while sharing no code, no schema, no storage key, no lock name and no
// record.
//
// THIS MODULE HAS NO TRANSACTION CAPABILITY. It holds no keypair, signs nothing, builds
// nothing, reads no chain, opens no `Connection` and cannot reach one. It records what an
// attempt has provably done, and it refuses everything else.
//
// -----------------------------------------------------------------------------
// THE NAMESPACE IS THE TEAM WALLET — AND THE CAMPAIGN IS INSIDE THE RECORD
// -----------------------------------------------------------------------------
// The slot is keyed by `cluster` / `program` / `teamWallet` and by NOTHING ELSE. The
// Campaign, the operation and the mutation identity all live INSIDE the record, where
// they are facts about the one attempt rather than parts of its address.
//
// That is the whole single-slot rule, and it is deliberate: a per-campaign or
// per-operation key would let one team start a metadata setup while a token-config
// addition was still unresolved, which is exactly two concurrent Team/Admin state
// mutations in flight. ANY unresolved record refuses EVERY new mutation — same Campaign or
// different, same operation or different, same identity or different.
//
// -----------------------------------------------------------------------------
// THE POINT OF NO RETURN IS THE RAW SEND, AND THE NAMES SAY SO
// -----------------------------------------------------------------------------
// `TEAM_ADMIN_MUTATION_POINT_OF_NO_RETURN = RAW_SEND_INVOCATION`. The wallet prompt, the
// wallet-sign invocation, the returned wire, its verification, the locally derived
// signature and every marker below are all STRICTLY BEFORE it.
//
// So no lifecycle, observation, resolution or transition here carries an unqualified
// "INVOCATION". The closed S1 vocabulary uses `MARK_INVOCATION_STARTED` for a
// PRE-raw-send marker, and a reader carrying that reading into this corridor would
// mislocate the irreversible act. Every name here says which act it means.
//
// `POST_INVOCATION_SIGNATURE_UNKNOWN` IS FORBIDDEN VOCABULARY and is deliberately absent.
// It asserts that an invocation happened while claiming the signature is unknown — a
// state this architecture makes structurally unreachable, because the signature is
// derived, retained and READ BACK before the send is reachable at all.
//
// -----------------------------------------------------------------------------
// WHY TOMBSTONES AND NOT DELETION
// -----------------------------------------------------------------------------
// Nothing here ever removes the stored value. A resolved attempt becomes a TOMBSTONE — a
// record that says how it ended. That is not tidiness: a module-performed deletion would
// be byte-identical to a hostile or accidental one, and the live-deletion detector would
// have to accept both. Keeping the record makes every disappearance detectable.
//
// THERE IS NO TIMESTAMP AND NO TTL. Nothing expires, because "old enough" has never been
// evidence that a transaction did not land.
//
// -----------------------------------------------------------------------------
// THE THREAT BOUNDARY, STATED PLAINLY
// -----------------------------------------------------------------------------
// CLIENT_ONLY_COLD_CLEAR_THREAT_ACCEPTED_FOR_BOUNDED_INTERNAL_DEVNET_DEMO_ONLY.
// Client-only persistence CANNOT detect total origin-storage deletion after all tabs
// close, a different browser / profile / device, or a complete out-of-session rollback.
// The Web Lock is scoped to its same-origin storage partition and is NOT a cross-device
// mutex. That residual is accepted for the bounded internal / devnet demo only — never for
// public production or mainnet — and no complete duplicate-prevention claim may be made
// outside it.

// --- Fixed vocabulary --------------------------------------------------------

/** The record's own schema literal, independent of the key's namespace generation. */
const REDAX_TEAM_ADMIN_MUTATION_JOURNAL_SCHEMA =
  'redax-team-admin-mutation-recovery-journal-v1' as const

/** The commitment scheme this module accepts. Structurally identical, never imported. */
const REDAX_MUTATION_INTENDED_MESSAGE_COMMITMENT_KIND =
  'redax-team-admin-mutation-intended-legacy-message-sha256-v1' as const

/** The namespace-generation version of the storage key and the lock name. */
const REDAX_MUTATION_JOURNAL_KEY_PREFIX = 'redax.teamAdmin.mutationRecovery.v1' as const
const REDAX_MUTATION_JOURNAL_LOCK_PREFIX = 'redax.teamAdmin.mutationRecovery.lock.v1' as const

/** The only cluster Phase 1 persists anything for. */
const REDAX_MUTATION_JOURNAL_CLUSTER = 'devnet' as const

/** A public base58-looking account identifier. Never decoded, never trusted further. */
const BASE58_ACCOUNT_PATTERN = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/

/** Digits only, no sign, no exponent, no separator, no leading zero except `0`. */
const CANONICAL_UNSIGNED_DECIMAL_PATTERN = /^(?:0|[1-9][0-9]*)$/

/** Exactly 64 lowercase hexadecimal characters. */
const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/

/** Exactly 32 lowercase hexadecimal characters — 16 bytes of public entropy. */
const ATTEMPT_NONCE_PATTERN = /^[0-9a-f]{32}$/

/** The widest `u128` the program's arguments can carry. Compared as BigInt, never Number. */
const U128_MAX = BigInt('340282366920938463463374607431768211455')

/** 16 bytes of `crypto.getRandomValues`, and nothing else, ever. */
const ATTEMPT_NONCE_BYTE_LENGTH = 16

/**
 * A fixed NON-ZERO pattern written into every entropy buffer before it is filled.
 *
 * It gives "the generator did nothing" a distinguishable value. A zero prefill would be
 * indistinguishable from a generator that zero-fills, and those are two of the exact
 * silent-failure shapes the liveness check below exists to catch.
 */
const ENTROPY_PREFILL_BYTE = 0xa5

/** The highest revision a slot may reach before it must be resolved rather than advanced. */
const MAX_REVISION = 4096

// --- Public types ------------------------------------------------------------

/** Phase 1 persists for exactly one cluster. */
export type RedaxTeamAdminMutationCluster = typeof REDAX_MUTATION_JOURNAL_CLUSTER

/**
 * The one slot a Team/Admin post-init mutation occupies.
 *
 * Deliberately NOT keyed by campaign, operation or mutation identity. One Team wallet on
 * one program has one post-init mutation in flight, full stop.
 */
export interface RedaxTeamAdminMutationNamespace {
  readonly cluster: RedaxTeamAdminMutationCluster
  readonly program: string
  readonly teamWallet: string
}

/**
 * How far the attempt has provably got. EXACTLY FOUR, and there is no fifth.
 *
 * `PRE_RAW_SEND` — a durable plan exists and NO raw-send invocation has occurred.
 *
 * `PRE_RAW_SEND_SIGNATURE_LOCAL_NOT_RETAINED` — the wallet returned, the wire verified,
 * a locally valid signature existed, and `knownSignature` is NOT YET durably retained.
 * The raw send is forbidden here and HAS NOT occurred; this state exists precisely so the
 * window between deriving a signature and retaining one is nameable rather than invisible.
 *
 * `KNOWN_SIGNATURE` — the signature is durably retained and read-verified. A raw send may
 * or may not subsequently have been invoked, so this is reconcile-only after an
 * interruption and carries NO resend authority in either direction.
 *
 * `TOMBSTONE` — terminal resolution.
 */
export type RedaxTeamAdminMutationLifecycle =
  | 'PRE_RAW_SEND'
  | 'PRE_RAW_SEND_SIGNATURE_LOCAL_NOT_RETAINED'
  | 'KNOWN_SIGNATURE'
  | 'TOMBSTONE'

/** The six post-init mutations. Re-declared structurally, never imported. */
export type RedaxTeamAdminMutationJournalOperation =
  | 'ADD_TOKEN_CONFIG'
  | 'SETUP_METADATA'
  | 'ACTIVATE_CAMPAIGN'
  | 'PAUSE_CAMPAIGN'
  | 'UNPAUSE_CAMPAIGN'
  | 'FINALIZE_CAMPAIGN'

/** The program's four campaign statuses. Re-declared structurally, never imported. */
export type RedaxTeamAdminMutationJournalStatus =
  | 'initialized'
  | 'active'
  | 'paused'
  | 'finalized'

/** A versioned commitment to one compiled legacy message. Re-declared, not imported. */
export interface RedaxTeamAdminMutationCommitmentV1 {
  readonly kind: typeof REDAX_MUTATION_INTENDED_MESSAGE_COMMITMENT_KIND
  readonly byteLength: number
  readonly sha256Hex: string
}

/**
 * The operation-specific request facts, as ONE flat shape with every member explicit.
 *
 * FLAT AND TOTAL, deliberately. A discriminated union would serialize to different key
 * sets per operation, and a canonical form that varied by shape would be one more thing
 * for a hostile record to exploit. Here every member is present, every inapplicable one is
 * an explicit `null`, and coherence requires EXACTLY the members that operation admits —
 * so a `PAUSE_CAMPAIGN` record carrying a `legacyMint` is refused rather than ignored.
 *
 * Every value is already PUBLIC: mints, canonical decimal amounts, digests of canonical
 * metadata bytes and byte lengths. There is no key, no signature byte, no wire, no raw
 * error and no fragment of unreviewed user text here, and there is no field one could
 * travel in.
 */
export interface RedaxTeamAdminMutationRequestFactsV1 {
  readonly legacyMint: string | null
  readonly rateNumerator: string | null
  readonly rateDenominator: string | null
  readonly maxOutputFromTokenConfig: string | null
  readonly nameSha256Hex: string | null
  readonly nameByteLength: number | null
  readonly symbolSha256Hex: string | null
  readonly symbolByteLength: number | null
  readonly uriSha256Hex: string | null
  readonly uriByteLength: number | null
  /**
   * The three EXPECTED PUFFED digests — canonical UTF-8 padded forward with `0x00` to the
   * fixed stored widths `32` / `10` / `200`.
   *
   * They are recorded BESIDE the canonical digests above, not instead of them, because the
   * two answer different questions and neither derives from the other: the canonical digests
   * are what was REQUESTED and are the identity dimensions, while these are what must EXIST
   * on chain. A digest of padded bytes cannot be computed from a digest of unpadded ones, so
   * a reconcile that did not hold these could never assert metadata attribution at all — it
   * would have to report an unresolved outcome for a mutation that plainly succeeded.
   *
   * Recording them is still ONE-DIRECTIONAL. Nothing here inverts a stored account back to
   * its arguments; `PRE_PUFF_BYTES_DERIVED_FROM_ACCOUNT` stays `NO`.
   */
  readonly expectedPuffedNameSha256Hex: string | null
  readonly expectedPuffedSymbolSha256Hex: string | null
  readonly expectedPuffedUriSha256Hex: string | null
  readonly predecessorStatus: RedaxTeamAdminMutationJournalStatus | null
  readonly targetStatus: RedaxTeamAdminMutationJournalStatus | null
  readonly authorityRole: 'campaign_admin' | null
}

/**
 * The account this mutation creates, re-derived — a WITNESS, not an identity dimension.
 *
 * It is recorded so a later readback looks at the exact address the instruction addressed,
 * rather than at one somebody supplied beside it.
 */
export interface RedaxTeamAdminMutationWitnessFactsV1 {
  readonly kind: 'NONE' | 'TOKEN_CONFIG' | 'METADATA'
  readonly address: string | null
}

/** The authority-grade chain facts observed BEFORE the plan was built. */
export interface RedaxTeamAdminMutationPreStateFactsV1 {
  readonly campaignStatus: RedaxTeamAdminMutationJournalStatus
  readonly metadataSetup: boolean
  readonly tokenConfigCount: number
  readonly campaignAdmin: string
  readonly outputMint: string
  readonly targetAccountAbsent: boolean
  readonly contextSlot: number
}

/** The blockhash-validity metadata a recovery reconciles against. */
export interface RedaxTeamAdminMutationBlockhashValidityV1 {
  readonly preflightContextSlot: number
  readonly lastValidBlockHeight: number
}

/**
 * What has been observed about the attempt. EXACTLY ELEVEN, and there is no twelfth.
 *
 * An observation, never a permission. `AWAITING_WALLET_APPROVAL` is deliberately absent:
 * it is ephemeral UI state that exists only while a prompt is open, and persisting it
 * would make a closed tab look like a live one.
 */
export type RedaxTeamAdminMutationObservation =
  | 'PRE_STATE_NOT_ADMISSIBLE'
  | 'PRE_RAW_SEND_REFUSED'
  | 'SIGNATURE_OBSERVED'
  | 'RAW_SEND_OUTCOME_UNKNOWN_WITH_KNOWN_SIGNATURE'
  | 'LANDED_TRANSACTION_FAILED'
  | 'LANDED_MESSAGE_MISMATCH'
  | 'MATCHING_IMMEDIATE_STATE'
  | 'LANDED_EXACT_BUT_POST_STATE_SUPERSEDED'
  | 'READ_UNAVAILABLE'
  | 'SUPPORT_ONLY'
  | 'FINALIZED_NO_LAND_PROVEN'

/**
 * How an attempt ended. EXACTLY SIX, and there is no seventh.
 *
 * `ACCEPTED_SUPPORT_DISPOSITION` is permanently NON-REPLACEABLE. Acknowledging that an
 * attempt is unresolved does not make it resolved, and it must never quietly become a
 * licence to start another one.
 */
export type RedaxTeamAdminMutationResolution =
  | 'RESOLVED_PRE_RAW_SEND_NO_BROADCAST'
  | 'RESOLVED_MATCHING_IMMEDIATE_STATE'
  | 'RESOLVED_LANDED_EXACT_POST_STATE_SUPERSEDED'
  | 'RESOLVED_FINALIZED_LANDED_FAILURE'
  | 'RESOLVED_FINALIZED_NO_LAND'
  | 'ACCEPTED_SUPPORT_DISPOSITION'

/** Sanitized recovery codes. A closed vocabulary; never a raw error or endpoint. */
export type RedaxTeamAdminMutationIssueCode =
  | 'PRE_STATE_UNREADABLE'
  | 'PRE_STATE_NOT_ADMISSIBLE'
  | 'CAMPAIGN_UNREADABLE'
  | 'CAMPAIGN_ABSENT'
  | 'CAMPAIGN_PDA_NOT_SELF_CONSISTENT'
  | 'CAMPAIGN_IDENTITY_MISMATCH'
  | 'TARGET_ACCOUNT_UNREADABLE'
  | 'TARGET_ACCOUNT_ABSENT'
  | 'TARGET_ACCOUNT_MISMATCH'
  | 'METADATA_ACCOUNT_UNREADABLE'
  | 'METADATA_ATTRIBUTION_MISMATCH'
  | 'TOKEN_CONFIG_COUNT_UNEXPECTED'
  | 'LANDED_MESSAGE_UNREADABLE'
  | 'LANDED_MESSAGE_NOT_EXACT'
  | 'TRANSACTION_FAILED_ON_CHAIN'
  | 'POST_STATE_SUPERSEDED'
  | 'EFFECT_ORIGIN_NOT_PROVEN'
  | 'READ_UNAVAILABLE'
  | 'CHAIN_GUARD_REFUSAL'
  | 'SIGN_ONLY_REFUSAL'

/**
 * The exact V1 public record.
 *
 * Every nullable member is REQUIRED and explicitly present. A missing key and an
 * `undefined` value are both invalid; only an explicit `null` means null. Reading an
 * absent member as "nothing to report" is exactly how a truncated or hostile record would
 * become a clean one.
 */
export interface RedaxTeamAdminMutationRecordV1 {
  readonly schema: typeof REDAX_TEAM_ADMIN_MUTATION_JOURNAL_SCHEMA
  readonly namespace: RedaxTeamAdminMutationNamespace
  readonly attemptNonce: string
  readonly revision: number
  readonly lifecycle: RedaxTeamAdminMutationLifecycle
  /** INSIDE the record, never in the key. */
  readonly campaign: string
  readonly operation: RedaxTeamAdminMutationJournalOperation
  readonly mutationIdentitySha256Hex: string
  readonly request: RedaxTeamAdminMutationRequestFactsV1
  readonly witness: RedaxTeamAdminMutationWitnessFactsV1
  readonly preState: RedaxTeamAdminMutationPreStateFactsV1
  readonly intendedMessage: RedaxTeamAdminMutationCommitmentV1
  readonly blockhashValidity: RedaxTeamAdminMutationBlockhashValidityV1
  readonly knownSignature: string | null
  readonly observation: RedaxTeamAdminMutationObservation | null
  readonly resolution: RedaxTeamAdminMutationResolution | null
  readonly issueCodes: readonly RedaxTeamAdminMutationIssueCode[]
}

/** The identity a mutation must present. Wrong identity is a conflict, never a merge. */
export interface RedaxTeamAdminMutationAttemptIdentity {
  readonly attemptNonce: string
  readonly revision: number
}

/** Begin a fresh attempt, or replace a replaceable tombstone under exact identity. */
export interface RedaxTeamAdminMutationBeginInput {
  readonly namespace: RedaxTeamAdminMutationNamespace
  readonly campaign: string
  readonly operation: RedaxTeamAdminMutationJournalOperation
  readonly mutationIdentitySha256Hex: string
  readonly request: RedaxTeamAdminMutationRequestFactsV1
  readonly witness: RedaxTeamAdminMutationWitnessFactsV1
  readonly preState: RedaxTeamAdminMutationPreStateFactsV1
  readonly intendedMessage: RedaxTeamAdminMutationCommitmentV1
  readonly blockhashValidity: RedaxTeamAdminMutationBlockhashValidityV1
  /** Explicitly `null` for a fresh slot; the exact tombstone identity to replace one. */
  readonly replaces: RedaxTeamAdminMutationAttemptIdentity | null
}

/**
 * The complete, closed set of state changes. There are NINE, and there is no tenth.
 *
 * `J-T01 … J-T09`, in exactly that order.
 */
export type RedaxTeamAdminMutationTransition =
  | { readonly type: 'MARK_PRE_RAW_SEND_SIGNATURE_LOCAL' }
  | { readonly type: 'RETAIN_KNOWN_SIGNATURE'; readonly knownSignature: string }
  | {
      readonly type: 'RECORD_OBSERVATION'
      readonly observation: RedaxTeamAdminMutationObservation
      readonly issueCodes: readonly RedaxTeamAdminMutationIssueCode[]
    }
  | { readonly type: 'RESOLVE_PRE_RAW_SEND_NO_BROADCAST' }
  | { readonly type: 'RESOLVE_MATCHING_IMMEDIATE_STATE' }
  | { readonly type: 'RESOLVE_LANDED_EXACT_POST_STATE_SUPERSEDED' }
  | { readonly type: 'RESOLVE_FINALIZED_LANDED_FAILURE' }
  | { readonly type: 'RESOLVE_FINALIZED_NO_LAND' }
  | { readonly type: 'ACKNOWLEDGE_SUPPORT_DISPOSITION' }

export interface RedaxTeamAdminMutationTransitionInput {
  readonly namespace: RedaxTeamAdminMutationNamespace
  readonly expectedAttemptNonce: string
  readonly expectedRevision: number
  readonly transition: RedaxTeamAdminMutationTransition
}

/**
 * Every way an operation can decline. Fixed, closed and value-free.
 *
 * None of these is a retry code. `LIVE_DELETION_DETECTED` and `LIVE_ROLLBACK_DETECTED` in
 * particular mean "the record moved under us", which makes the situation LESS knowable,
 * not more — they never recreate or re-open anything.
 */
export type RedaxTeamAdminMutationFailureCode =
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

export type RedaxTeamAdminMutationReadResult =
  | { readonly ok: true; readonly kind: 'EMPTY' }
  | { readonly ok: true; readonly kind: 'ACTIVE'; readonly record: RedaxTeamAdminMutationRecordV1 }
  | {
      readonly ok: true
      readonly kind: 'TOMBSTONE'
      readonly record: RedaxTeamAdminMutationRecordV1
    }
  | { readonly ok: false; readonly code: RedaxTeamAdminMutationFailureCode }

export type RedaxTeamAdminMutationWriteResult =
  | { readonly ok: true; readonly kind: 'CREATED'; readonly record: RedaxTeamAdminMutationRecordV1 }
  | { readonly ok: true; readonly kind: 'UPDATED'; readonly record: RedaxTeamAdminMutationRecordV1 }
  | {
      readonly ok: true
      readonly kind: 'TOMBSTONED'
      readonly record: RedaxTeamAdminMutationRecordV1
    }
  | { readonly ok: false; readonly code: RedaxTeamAdminMutationFailureCode }

// --- Closed vocabularies, as ordered arrays -----------------------------------

const LIFECYCLES: readonly RedaxTeamAdminMutationLifecycle[] = Object.freeze([
  'PRE_RAW_SEND',
  'PRE_RAW_SEND_SIGNATURE_LOCAL_NOT_RETAINED',
  'KNOWN_SIGNATURE',
  'TOMBSTONE',
])

const OPERATIONS: readonly RedaxTeamAdminMutationJournalOperation[] = Object.freeze([
  'ADD_TOKEN_CONFIG',
  'SETUP_METADATA',
  'ACTIVATE_CAMPAIGN',
  'PAUSE_CAMPAIGN',
  'UNPAUSE_CAMPAIGN',
  'FINALIZE_CAMPAIGN',
])

const STATUSES: readonly RedaxTeamAdminMutationJournalStatus[] = Object.freeze([
  'initialized',
  'active',
  'paused',
  'finalized',
])

const OBSERVATIONS: readonly RedaxTeamAdminMutationObservation[] = Object.freeze([
  'PRE_STATE_NOT_ADMISSIBLE',
  'PRE_RAW_SEND_REFUSED',
  'SIGNATURE_OBSERVED',
  'RAW_SEND_OUTCOME_UNKNOWN_WITH_KNOWN_SIGNATURE',
  'LANDED_TRANSACTION_FAILED',
  'LANDED_MESSAGE_MISMATCH',
  'MATCHING_IMMEDIATE_STATE',
  'LANDED_EXACT_BUT_POST_STATE_SUPERSEDED',
  'READ_UNAVAILABLE',
  'SUPPORT_ONLY',
  'FINALIZED_NO_LAND_PROVEN',
])

const RESOLUTIONS: readonly RedaxTeamAdminMutationResolution[] = Object.freeze([
  'RESOLVED_PRE_RAW_SEND_NO_BROADCAST',
  'RESOLVED_MATCHING_IMMEDIATE_STATE',
  'RESOLVED_LANDED_EXACT_POST_STATE_SUPERSEDED',
  'RESOLVED_FINALIZED_LANDED_FAILURE',
  'RESOLVED_FINALIZED_NO_LAND',
  'ACCEPTED_SUPPORT_DISPOSITION',
])

/**
 * The tombstones a fresh attempt may replace. FIVE of the six.
 *
 * `ACCEPTED_SUPPORT_DISPOSITION` is deliberately ABSENT and is permanently
 * NON-REPLACEABLE: a support disposition that could be replaced would let an unresolved
 * outcome be overwritten by a later attempt, which is the precise failure the single-slot
 * rule exists to prevent.
 *
 * Membership follows PROOF, never elapsed time. Replacement is still the exact existing
 * discipline — a fresh nonce, a fresh blockhash, a fresh message and a fresh pre-state —
 * never a resend of the old one, and the SAME-IDENTITY re-entry rules are a separate
 * question this module does not answer.
 */
const REPLACEABLE_RESOLUTIONS: readonly RedaxTeamAdminMutationResolution[] = Object.freeze([
  'RESOLVED_PRE_RAW_SEND_NO_BROADCAST',
  'RESOLVED_MATCHING_IMMEDIATE_STATE',
  'RESOLVED_LANDED_EXACT_POST_STATE_SUPERSEDED',
  'RESOLVED_FINALIZED_LANDED_FAILURE',
  'RESOLVED_FINALIZED_NO_LAND',
])

/** The canonical issue-code order. Serialization emits exactly this order. */
const ISSUE_CODES: readonly RedaxTeamAdminMutationIssueCode[] = Object.freeze([
  'PRE_STATE_UNREADABLE',
  'PRE_STATE_NOT_ADMISSIBLE',
  'CAMPAIGN_UNREADABLE',
  'CAMPAIGN_ABSENT',
  'CAMPAIGN_PDA_NOT_SELF_CONSISTENT',
  'CAMPAIGN_IDENTITY_MISMATCH',
  'TARGET_ACCOUNT_UNREADABLE',
  'TARGET_ACCOUNT_ABSENT',
  'TARGET_ACCOUNT_MISMATCH',
  'METADATA_ACCOUNT_UNREADABLE',
  'METADATA_ATTRIBUTION_MISMATCH',
  'TOKEN_CONFIG_COUNT_UNEXPECTED',
  'LANDED_MESSAGE_UNREADABLE',
  'LANDED_MESSAGE_NOT_EXACT',
  'TRANSACTION_FAILED_ON_CHAIN',
  'POST_STATE_SUPERSEDED',
  'EFFECT_ORIGIN_NOT_PROVEN',
  'READ_UNAVAILABLE',
  'CHAIN_GUARD_REFUSAL',
  'SIGN_ONLY_REFUSAL',
])

/**
 * The transitions NO OTHER ACTOR may make while this realm provably holds an attempt's
 * origin — used by the live-witness replay below, and by nothing else.
 *
 * IT IS NOT A LIST OF TRANSITIONS ONLY AN ORIGIN REALM MAY EVER MAKE. That reading is what
 * `J-T04` was mistakenly given, and it made a durable pre-raw-send record permanently
 * irresolvable after a reload: a fresh module realm sees the record as a successor, and a
 * successor could then never close it — blocking every later attempt forever, since the
 * slot is single and an unresolved record refuses a new `begin`.
 *
 * What this set governs is narrower and is about FORGERY, not about authority. While this
 * realm created the attempt, has not written its raw-send marker and last saw it in
 * `PRE_RAW_SEND`, these two moves are ours and we have not made them — so observing one
 * appear underneath us is a rewrite rather than a legitimate step, and the replay refuses
 * it. `J-T01` additionally keeps a true origin rule of its own inside `applyTransition`,
 * because "a signature was derived HERE" is a statement no observer can make; `J-T04`
 * deliberately does not, because "the raw send was never reached" is STRUCTURAL — the send
 * is unreachable until a signature is durably retained AND read back, so any record still
 * in the pre-raw-send family provably never reached it, whoever is looking.
 */
const ORIGIN_RESERVED_WHILE_HELD_TRANSITIONS: readonly RedaxTeamAdminMutationTransition['type'][] =
  Object.freeze(['MARK_PRE_RAW_SEND_SIGNATURE_LOCAL', 'RESOLVE_PRE_RAW_SEND_NO_BROADCAST'])

// --- Module-private platform ports --------------------------------------------
//
// Resolved from `globalThis` on EVERY exported operation, never cached. A cached port
// would survive a page state the caller believes it has left, and a stale storage handle
// is precisely the kind of thing a recovery journal must not hold.
//
// Each port names only the members actually used, and each is declared structurally
// rather than against a DOM type, so this file compiles identically under the app's DOM
// lib and under the test runner's Node types — while making `removeItem`, the whole-origin
// wipe and `sessionStorage` unreachable rather than merely forbidden.

interface RedaxMutationStoragePort {
  getItem(key: string): unknown
  setItem(key: string, value: string): unknown
}

interface RedaxMutationLockManagerPort {
  request(
    name: string,
    options: { readonly mode: 'exclusive'; readonly ifAvailable: true },
    callback: (lock: unknown) => Promise<void>,
  ): Promise<unknown>
}

interface RedaxMutationEntropyPort {
  getRandomValues(target: Uint8Array): unknown
}

function resolveStoragePort(): RedaxMutationStoragePort | null {
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
  const port = candidate as RedaxMutationStoragePort
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

function resolveLockManagerPort(): RedaxMutationLockManagerPort | null {
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
  const port = locksCandidate as RedaxMutationLockManagerPort
  let request: unknown
  try {
    request = port.request
  } catch {
    return null
  }
  return typeof request === 'function' ? port : null
}

function resolveEntropyPort(): RedaxMutationEntropyPort | null {
  let candidate: unknown
  try {
    candidate = (globalThis as { crypto?: unknown }).crypto
  } catch {
    return null
  }
  if (typeof candidate !== 'object' || candidate === null) {
    return null
  }
  const port = candidate as RedaxMutationEntropyPort
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
 * satisfies it while writing not one byte. The buffer is therefore prefilled with a fixed
 * non-zero sentinel and inspected afterwards, which makes an untouched buffer and an
 * all-zero fill both visible.
 *
 * These are BOUNDED STRUCTURAL LIVENESS CHECKS. They do not authenticate the generator, do
 * not measure the quality of its output, and nothing here may be read as either. A healthy
 * generator can fail them only by drawing one exact 16-byte value, which is negligible.
 */
function drawAttemptNonce(): string | null {
  const entropy = resolveEntropyPort()
  if (entropy === null) {
    return null
  }
  const buffer = new Uint8Array(ATTEMPT_NONCE_BYTE_LENGTH)
  buffer.fill(ENTROPY_PREFILL_BYTE)
  let returned: unknown
  try {
    returned = entropy.getRandomValues(buffer)
  } catch {
    return null
  }
  if (returned !== buffer) {
    return null
  }
  let untouched = true
  let allZero = true
  for (const byte of buffer) {
    if (byte !== ENTROPY_PREFILL_BYTE) {
      untouched = false
    }
    if (byte !== 0) {
      allZero = false
    }
  }
  if (untouched || allZero) {
    return null
  }
  let hex = ''
  for (const byte of buffer) {
    hex += byte.toString(16).padStart(2, '0')
  }
  return hex
}

// --- Protected structural reads -------------------------------------------------

interface ProtectedRead {
  readonly ok: boolean
  readonly value: unknown
}

const READ_FAILED: ProtectedRead = Object.freeze({ ok: false, value: undefined })

/**
 * Read one property of an UNTRUSTED object structurally.
 *
 * Stored journal text is public and writable by anything with access to the origin, and a
 * value revived from it may carry a throwing getter. `Reflect.get` inside a `try` turns
 * that into a refusal rather than an exception escaping the parser.
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

/** A REQUIRED nullable member: absent and `undefined` are invalid; only `null` is null. */
function readRequiredNullable(source: unknown, key: string): ProtectedRead {
  const read = readProperty(source, key)
  if (!read.ok || read.value === undefined) {
    return READ_FAILED
  }
  return read
}

/** Does this object carry EXACTLY these own enumerable keys — no more, no fewer? */
function hasExactKeys(value: unknown, keys: readonly string[]): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false
  }
  let own: string[]
  try {
    own = Object.keys(value as Record<string, unknown>)
  } catch {
    return false
  }
  if (own.length !== keys.length) {
    return false
  }
  for (const key of keys) {
    if (!own.includes(key)) {
      return false
    }
  }
  return true
}

function toEnum<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : null
}

function isAccountIdentifier(value: unknown): value is string {
  return typeof value === 'string' && BASE58_ACCOUNT_PATTERN.test(value)
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

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

function isSha256Hex(value: unknown): value is string {
  return typeof value === 'string' && SHA256_HEX_PATTERN.test(value)
}

// --- Namespace, key and lock name -----------------------------------------------

function isValidNamespace(value: unknown): value is RedaxTeamAdminMutationNamespace {
  if (!hasExactKeys(value, ['cluster', 'program', 'teamWallet'])) {
    return false
  }
  const cluster = readProperty(value, 'cluster')
  const program = readProperty(value, 'program')
  const teamWallet = readProperty(value, 'teamWallet')
  return (
    cluster.ok &&
    cluster.value === REDAX_MUTATION_JOURNAL_CLUSTER &&
    program.ok &&
    isAccountIdentifier(program.value) &&
    teamWallet.ok &&
    isAccountIdentifier(teamWallet.value)
  )
}

function journalKey(namespace: RedaxTeamAdminMutationNamespace): string {
  return `${REDAX_MUTATION_JOURNAL_KEY_PREFIX}:${namespace.cluster}:${namespace.program}:${namespace.teamWallet}`
}

function journalLockName(namespace: RedaxTeamAdminMutationNamespace): string {
  return `${REDAX_MUTATION_JOURNAL_LOCK_PREFIX}:${namespace.cluster}:${namespace.program}:${namespace.teamWallet}`
}

// --- The draft, and canonical serialization ---------------------------------------

/** A mutable working copy of a record. Never exported and never published as one. */
interface JournalDraft {
  schema: typeof REDAX_TEAM_ADMIN_MUTATION_JOURNAL_SCHEMA
  namespace: RedaxTeamAdminMutationNamespace
  attemptNonce: string
  revision: number
  lifecycle: RedaxTeamAdminMutationLifecycle
  campaign: string
  operation: RedaxTeamAdminMutationJournalOperation
  mutationIdentitySha256Hex: string
  request: RedaxTeamAdminMutationRequestFactsV1
  witness: RedaxTeamAdminMutationWitnessFactsV1
  preState: RedaxTeamAdminMutationPreStateFactsV1
  intendedMessage: RedaxTeamAdminMutationCommitmentV1
  blockhashValidity: RedaxTeamAdminMutationBlockhashValidityV1
  knownSignature: string | null
  observation: RedaxTeamAdminMutationObservation | null
  resolution: RedaxTeamAdminMutationResolution | null
  issueCodes: readonly RedaxTeamAdminMutationIssueCode[]
}

/**
 * ONE serialization, in ONE fixed recursive key order, with every null explicit.
 *
 * Determinism is what makes the stored text comparable. A record read back is
 * re-serialized and required to equal the stored bytes exactly, which rejects whitespace
 * variants, key reordering, duplicate-member last-write semantics, a permuted issue-code
 * array and any external rewrite — without this module ever having to guess whether a
 * difference was benign.
 */
function canonicalize(draft: JournalDraft): string {
  return JSON.stringify({
    schema: draft.schema,
    namespace: {
      cluster: draft.namespace.cluster,
      program: draft.namespace.program,
      teamWallet: draft.namespace.teamWallet,
    },
    attemptNonce: draft.attemptNonce,
    revision: draft.revision,
    lifecycle: draft.lifecycle,
    campaign: draft.campaign,
    operation: draft.operation,
    mutationIdentitySha256Hex: draft.mutationIdentitySha256Hex,
    request: {
      legacyMint: draft.request.legacyMint,
      rateNumerator: draft.request.rateNumerator,
      rateDenominator: draft.request.rateDenominator,
      maxOutputFromTokenConfig: draft.request.maxOutputFromTokenConfig,
      nameSha256Hex: draft.request.nameSha256Hex,
      nameByteLength: draft.request.nameByteLength,
      symbolSha256Hex: draft.request.symbolSha256Hex,
      symbolByteLength: draft.request.symbolByteLength,
      uriSha256Hex: draft.request.uriSha256Hex,
      uriByteLength: draft.request.uriByteLength,
      expectedPuffedNameSha256Hex: draft.request.expectedPuffedNameSha256Hex,
      expectedPuffedSymbolSha256Hex: draft.request.expectedPuffedSymbolSha256Hex,
      expectedPuffedUriSha256Hex: draft.request.expectedPuffedUriSha256Hex,
      predecessorStatus: draft.request.predecessorStatus,
      targetStatus: draft.request.targetStatus,
      authorityRole: draft.request.authorityRole,
    },
    witness: {
      kind: draft.witness.kind,
      address: draft.witness.address,
    },
    preState: {
      campaignStatus: draft.preState.campaignStatus,
      metadataSetup: draft.preState.metadataSetup,
      tokenConfigCount: draft.preState.tokenConfigCount,
      campaignAdmin: draft.preState.campaignAdmin,
      outputMint: draft.preState.outputMint,
      targetAccountAbsent: draft.preState.targetAccountAbsent,
      contextSlot: draft.preState.contextSlot,
    },
    intendedMessage: {
      kind: draft.intendedMessage.kind,
      byteLength: draft.intendedMessage.byteLength,
      sha256Hex: draft.intendedMessage.sha256Hex,
    },
    blockhashValidity: {
      preflightContextSlot: draft.blockhashValidity.preflightContextSlot,
      lastValidBlockHeight: draft.blockhashValidity.lastValidBlockHeight,
    },
    knownSignature: draft.knownSignature,
    observation: draft.observation,
    resolution: draft.resolution,
    issueCodes: [...draft.issueCodes],
  })
}

/** A working copy of a published record, so transitions can build the next one. */
function draftOf(record: RedaxTeamAdminMutationRecordV1): JournalDraft {
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
    campaign: record.campaign,
    operation: record.operation,
    mutationIdentitySha256Hex: record.mutationIdentitySha256Hex,
    request: { ...record.request },
    witness: { ...record.witness },
    preState: { ...record.preState },
    intendedMessage: { ...record.intendedMessage },
    blockhashValidity: { ...record.blockhashValidity },
    knownSignature: record.knownSignature,
    observation: record.observation,
    resolution: record.resolution,
    issueCodes: [...record.issueCodes],
  }
}

/** Freeze a validated draft into the published record shape. */
function publish(draft: JournalDraft): RedaxTeamAdminMutationRecordV1 {
  return Object.freeze({
    schema: draft.schema,
    namespace: Object.freeze({ ...draft.namespace }),
    attemptNonce: draft.attemptNonce,
    revision: draft.revision,
    lifecycle: draft.lifecycle,
    campaign: draft.campaign,
    operation: draft.operation,
    mutationIdentitySha256Hex: draft.mutationIdentitySha256Hex,
    request: Object.freeze({ ...draft.request }),
    witness: Object.freeze({ ...draft.witness }),
    preState: Object.freeze({ ...draft.preState }),
    intendedMessage: Object.freeze({ ...draft.intendedMessage }),
    blockhashValidity: Object.freeze({ ...draft.blockhashValidity }),
    knownSignature: draft.knownSignature,
    observation: draft.observation,
    resolution: draft.resolution,
    issueCodes: Object.freeze([...draft.issueCodes]),
  })
}

// --- Coherence -----------------------------------------------------------------

/**
 * Exactly which request members each operation admits.
 *
 * Every member NOT listed must be an explicit `null`. That is what makes a record whose
 * operation and payload disagree — a `FINALIZE_CAMPAIGN` carrying a `legacyMint`, a
 * `PAUSE_CAMPAIGN` carrying a URI digest — a refusal rather than something a reader has to
 * remember to ignore.
 */
const REQUEST_MEMBERS_BY_OPERATION: Readonly<Record<string, readonly string[]>> = Object.freeze({
  ADD_TOKEN_CONFIG: Object.freeze([
    'legacyMint',
    'rateNumerator',
    'rateDenominator',
    'maxOutputFromTokenConfig',
  ]),
  SETUP_METADATA: Object.freeze([
    'nameSha256Hex',
    'nameByteLength',
    'symbolSha256Hex',
    'symbolByteLength',
    'uriSha256Hex',
    'uriByteLength',
    'expectedPuffedNameSha256Hex',
    'expectedPuffedSymbolSha256Hex',
    'expectedPuffedUriSha256Hex',
  ]),
  ACTIVATE_CAMPAIGN: Object.freeze(['predecessorStatus', 'targetStatus']),
  PAUSE_CAMPAIGN: Object.freeze(['predecessorStatus', 'targetStatus', 'authorityRole']),
  UNPAUSE_CAMPAIGN: Object.freeze(['predecessorStatus', 'targetStatus']),
  FINALIZE_CAMPAIGN: Object.freeze(['predecessorStatus', 'targetStatus']),
})

const ALL_REQUEST_MEMBERS: readonly (keyof RedaxTeamAdminMutationRequestFactsV1)[] = Object.freeze([
  'legacyMint',
  'rateNumerator',
  'rateDenominator',
  'maxOutputFromTokenConfig',
  'nameSha256Hex',
  'nameByteLength',
  'symbolSha256Hex',
  'symbolByteLength',
  'uriSha256Hex',
  'uriByteLength',
  'expectedPuffedNameSha256Hex',
  'expectedPuffedSymbolSha256Hex',
  'expectedPuffedUriSha256Hex',
  'predecessorStatus',
  'targetStatus',
  'authorityRole',
])

/** The witness kind each operation must carry, and whether it names an address. */
function witnessCoherent(draft: JournalDraft): boolean {
  const { kind, address } = draft.witness
  if (draft.operation === 'ADD_TOKEN_CONFIG') {
    return kind === 'TOKEN_CONFIG' && isAccountIdentifier(address)
  }
  if (draft.operation === 'SETUP_METADATA') {
    return kind === 'METADATA' && isAccountIdentifier(address)
  }
  return kind === 'NONE' && address === null
}

/** Does the request carry EXACTLY the members its operation admits, and no others? */
function requestCoherent(draft: JournalDraft): boolean {
  const admitted = REQUEST_MEMBERS_BY_OPERATION[draft.operation]
  if (admitted === undefined) {
    return false
  }
  for (const member of ALL_REQUEST_MEMBERS) {
    const value = draft.request[member]
    const isAdmitted = admitted.includes(member)
    if (!isAdmitted) {
      if (value !== null) {
        return false
      }
      continue
    }
    if (value === null) {
      return false
    }
    switch (member) {
      case 'legacyMint':
        if (!isAccountIdentifier(value)) {
          return false
        }
        break
      case 'rateNumerator':
      case 'rateDenominator':
      case 'maxOutputFromTokenConfig':
        if (!isCanonicalU128(value)) {
          return false
        }
        break
      case 'nameSha256Hex':
      case 'symbolSha256Hex':
      case 'uriSha256Hex':
      case 'expectedPuffedNameSha256Hex':
      case 'expectedPuffedSymbolSha256Hex':
      case 'expectedPuffedUriSha256Hex':
        if (!isSha256Hex(value)) {
          return false
        }
        break
      case 'nameByteLength':
      case 'symbolByteLength':
      case 'uriByteLength':
        if (!isNonNegativeSafeInteger(value) || value === 0) {
          return false
        }
        break
      case 'predecessorStatus':
      case 'targetStatus':
        if (toEnum(value, STATUSES) === null) {
          return false
        }
        break
      case 'authorityRole':
        if (value !== 'campaign_admin') {
          return false
        }
        break
    }
  }
  return true
}

/**
 * Is this draft internally consistent?
 *
 * Enforced at PRODUCTION PARSING against hostile fresh-realm storage, not merely on the
 * way out of the transition that emits it — because every member below is individually
 * representable in valid canonical bytes, so every one is individually refused.
 */
function isCoherent(draft: JournalDraft): boolean {
  if (!requestCoherent(draft) || !witnessCoherent(draft)) {
    return false
  }
  const signed = draft.knownSignature !== null

  switch (draft.lifecycle) {
    case 'PRE_RAW_SEND':
    case 'PRE_RAW_SEND_SIGNATURE_LOCAL_NOT_RETAINED':
      // No signature is durable yet in either pre-raw-send state, and neither is
      // terminal. `knownSignature` becoming non-null is exactly what moves the record
      // out of them.
      return !signed && draft.resolution === null
    case 'KNOWN_SIGNATURE':
      return signed && draft.resolution === null
    case 'TOMBSTONE':
      break
  }

  switch (draft.resolution) {
    case 'RESOLVED_PRE_RAW_SEND_NO_BROADCAST':
      // NOTHING WAS BROADCAST, so there is no transaction for a signature to name. A
      // signature here would be a durable claim about a chain effect that cannot exist.
      return (
        !signed &&
        draft.observation !== null &&
        [
          'PRE_STATE_NOT_ADMISSIBLE',
          'PRE_RAW_SEND_REFUSED',
          'READ_UNAVAILABLE',
          'SIGNATURE_OBSERVED',
        ].includes(draft.observation)
      )
    case 'RESOLVED_MATCHING_IMMEDIATE_STATE':
      // A clean, complete, fully explained success. An issue code here would say the
      // proof ALSO hit something it could not read, which is not a state this resolution
      // may be reached from.
      return signed && draft.observation === 'MATCHING_IMMEDIATE_STATE' && draft.issueCodes.length === 0
    case 'RESOLVED_LANDED_EXACT_POST_STATE_SUPERSEDED':
      return signed && draft.observation === 'LANDED_EXACT_BUT_POST_STATE_SUPERSEDED'
    case 'RESOLVED_FINALIZED_LANDED_FAILURE':
      // The INTENDED message landed and the transaction failed. A landed-message MISMATCH
      // is deliberately not eligible: a mismatched message is not this transaction
      // failing, and treating it as one would attribute a foreign effect to this attempt.
      return signed && draft.observation === 'LANDED_TRANSACTION_FAILED'
    case 'RESOLVED_FINALIZED_NO_LAND':
      // A proven, clean, complete no-land carries nothing unexplained.
      return signed && draft.observation === 'FINALIZED_NO_LAND_PROVEN' && draft.issueCodes.length === 0
    case 'ACCEPTED_SUPPORT_DISPOSITION':
      return signed && draft.observation === 'SUPPORT_ONLY'
    case null:
      // An unresolved tombstone is a contradiction: the record claims to be over and
      // cannot say how it ended.
      return false
  }
}

// --- Parsing untrusted stored text ------------------------------------------------

type ParsedJournal =
  | { readonly ok: true; readonly record: RedaxTeamAdminMutationRecordV1; readonly canonical: string }
  | { readonly ok: false; readonly code: RedaxTeamAdminMutationFailureCode }

const JOURNAL_CORRUPT: ParsedJournal = Object.freeze({ ok: false, code: 'JOURNAL_CORRUPT' })

const RECORD_KEYS: readonly string[] = Object.freeze([
  'schema',
  'namespace',
  'attemptNonce',
  'revision',
  'lifecycle',
  'campaign',
  'operation',
  'mutationIdentitySha256Hex',
  'request',
  'witness',
  'preState',
  'intendedMessage',
  'blockhashValidity',
  'knownSignature',
  'observation',
  'resolution',
  'issueCodes',
])

const REQUEST_KEYS: readonly string[] = ALL_REQUEST_MEMBERS as readonly string[]
const WITNESS_KEYS: readonly string[] = Object.freeze(['kind', 'address'])
const PRE_STATE_KEYS: readonly string[] = Object.freeze([
  'campaignStatus',
  'metadataSetup',
  'tokenConfigCount',
  'campaignAdmin',
  'outputMint',
  'targetAccountAbsent',
  'contextSlot',
])
const COMMITMENT_KEYS: readonly string[] = Object.freeze(['kind', 'byteLength', 'sha256Hex'])
const BLOCKHASH_KEYS: readonly string[] = Object.freeze([
  'preflightContextSlot',
  'lastValidBlockHeight',
])

function parseRequestValue(value: unknown): RedaxTeamAdminMutationRequestFactsV1 | null {
  if (!hasExactKeys(value, REQUEST_KEYS)) {
    return null
  }
  const out: Record<string, unknown> = {}
  for (const member of ALL_REQUEST_MEMBERS) {
    const read = readRequiredNullable(value, member)
    if (!read.ok) {
      return null
    }
    out[member] = read.value
  }
  // Only shapes are checked here; `requestCoherent` decides which members THIS operation
  // admits, because that answer depends on the operation and this parser has no opinion.
  return out as unknown as RedaxTeamAdminMutationRequestFactsV1
}

function parseWitnessValue(value: unknown): RedaxTeamAdminMutationWitnessFactsV1 | null {
  if (!hasExactKeys(value, WITNESS_KEYS)) {
    return null
  }
  const kind = readProperty(value, 'kind')
  const address = readRequiredNullable(value, 'address')
  const kindValue = kind.ok ? toEnum(kind.value, ['NONE', 'TOKEN_CONFIG', 'METADATA'] as const) : null
  if (kindValue === null || !address.ok) {
    return null
  }
  if (address.value !== null && !isAccountIdentifier(address.value)) {
    return null
  }
  return { kind: kindValue, address: address.value as string | null }
}

function parsePreStateValue(value: unknown): RedaxTeamAdminMutationPreStateFactsV1 | null {
  if (!hasExactKeys(value, PRE_STATE_KEYS)) {
    return null
  }
  const campaignStatus = readProperty(value, 'campaignStatus')
  const metadataSetup = readProperty(value, 'metadataSetup')
  const tokenConfigCount = readProperty(value, 'tokenConfigCount')
  const campaignAdmin = readProperty(value, 'campaignAdmin')
  const outputMint = readProperty(value, 'outputMint')
  const targetAccountAbsent = readProperty(value, 'targetAccountAbsent')
  const contextSlot = readProperty(value, 'contextSlot')
  const status = campaignStatus.ok ? toEnum(campaignStatus.value, STATUSES) : null
  if (
    status === null ||
    !metadataSetup.ok ||
    typeof metadataSetup.value !== 'boolean' ||
    !tokenConfigCount.ok ||
    !isNonNegativeSafeInteger(tokenConfigCount.value) ||
    !campaignAdmin.ok ||
    !isAccountIdentifier(campaignAdmin.value) ||
    !outputMint.ok ||
    !isAccountIdentifier(outputMint.value) ||
    !targetAccountAbsent.ok ||
    typeof targetAccountAbsent.value !== 'boolean' ||
    !contextSlot.ok ||
    !isNonNegativeSafeInteger(contextSlot.value)
  ) {
    return null
  }
  return {
    campaignStatus: status,
    metadataSetup: metadataSetup.value,
    tokenConfigCount: tokenConfigCount.value,
    campaignAdmin: campaignAdmin.value,
    outputMint: outputMint.value,
    targetAccountAbsent: targetAccountAbsent.value,
    contextSlot: contextSlot.value,
  }
}

function parseCommitmentValue(value: unknown): RedaxTeamAdminMutationCommitmentV1 | null {
  if (!hasExactKeys(value, COMMITMENT_KEYS)) {
    return null
  }
  const kind = readProperty(value, 'kind')
  const byteLength = readProperty(value, 'byteLength')
  const sha256Hex = readProperty(value, 'sha256Hex')
  if (
    !kind.ok ||
    kind.value !== REDAX_MUTATION_INTENDED_MESSAGE_COMMITMENT_KIND ||
    !byteLength.ok ||
    !isNonNegativeSafeInteger(byteLength.value) ||
    byteLength.value === 0 ||
    !sha256Hex.ok ||
    !isSha256Hex(sha256Hex.value)
  ) {
    return null
  }
  return {
    kind: REDAX_MUTATION_INTENDED_MESSAGE_COMMITMENT_KIND,
    byteLength: byteLength.value,
    sha256Hex: sha256Hex.value,
  }
}

function parseBlockhashValidityValue(
  value: unknown,
): RedaxTeamAdminMutationBlockhashValidityV1 | null {
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

/** The issue-code array, validated member by member against the closed vocabulary. */
function parseIssueCodes(value: unknown): readonly RedaxTeamAdminMutationIssueCode[] | null {
  if (!Array.isArray(value)) {
    return null
  }
  const codes: RedaxTeamAdminMutationIssueCode[] = []
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
 * The stored value is HOSTILE INPUT. It is public, it is writable by anything with access
 * to the origin, and it must never reach past this function as anything but a fully
 * validated record or a fixed refusal.
 */
function parseJournalText(raw: string): ParsedJournal {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return JOURNAL_CORRUPT
  }
  if (!hasExactKeys(parsed, RECORD_KEYS)) {
    return JOURNAL_CORRUPT
  }
  const schema = readProperty(parsed, 'schema')
  if (!schema.ok) {
    return JOURNAL_CORRUPT
  }
  if (schema.value !== REDAX_TEAM_ADMIN_MUTATION_JOURNAL_SCHEMA) {
    // A record from a DIFFERENT generation of this journal, or from another journal
    // entirely. Distinguished from corruption because it is a version fact rather than a
    // damage fact, and neither is ever repaired.
    return { ok: false, code: 'JOURNAL_INCOMPATIBLE' }
  }

  const namespace = readProperty(parsed, 'namespace')
  const attemptNonce = readProperty(parsed, 'attemptNonce')
  const revision = readProperty(parsed, 'revision')
  const lifecycle = readProperty(parsed, 'lifecycle')
  const campaign = readProperty(parsed, 'campaign')
  const operation = readProperty(parsed, 'operation')
  const identityHex = readProperty(parsed, 'mutationIdentitySha256Hex')
  const request = readProperty(parsed, 'request')
  const witness = readProperty(parsed, 'witness')
  const preState = readProperty(parsed, 'preState')
  const intendedMessage = readProperty(parsed, 'intendedMessage')
  const blockhashValidity = readProperty(parsed, 'blockhashValidity')
  const knownSignature = readRequiredNullable(parsed, 'knownSignature')
  const observation = readRequiredNullable(parsed, 'observation')
  const resolution = readRequiredNullable(parsed, 'resolution')
  const issueCodes = readProperty(parsed, 'issueCodes')

  if (
    !namespace.ok ||
    !isValidNamespace(namespace.value) ||
    !attemptNonce.ok ||
    typeof attemptNonce.value !== 'string' ||
    !ATTEMPT_NONCE_PATTERN.test(attemptNonce.value) ||
    !revision.ok ||
    !isNonNegativeSafeInteger(revision.value) ||
    revision.value < 1 ||
    revision.value > MAX_REVISION ||
    !campaign.ok ||
    !isAccountIdentifier(campaign.value) ||
    !identityHex.ok ||
    !isSha256Hex(identityHex.value) ||
    !knownSignature.ok ||
    !observation.ok ||
    !resolution.ok ||
    !request.ok ||
    !witness.ok ||
    !preState.ok ||
    !intendedMessage.ok ||
    !blockhashValidity.ok ||
    !issueCodes.ok
  ) {
    return JOURNAL_CORRUPT
  }

  const lifecycleValue = lifecycle.ok ? toEnum(lifecycle.value, LIFECYCLES) : null
  const operationValue = operation.ok ? toEnum(operation.value, OPERATIONS) : null
  if (lifecycleValue === null || operationValue === null) {
    return JOURNAL_CORRUPT
  }
  if (knownSignature.value !== null && !isAccountIdentifier(knownSignature.value)) {
    // A base58 signature is longer than an address, but the shape family is the same and
    // this module never decodes it. What matters is that it is a plausible base58 handle
    // and not an object, a number or an empty string.
    if (typeof knownSignature.value !== 'string' || !/^[1-9A-HJ-NP-Za-km-z]{64,120}$/.test(knownSignature.value)) {
      return JOURNAL_CORRUPT
    }
  }
  const observationValue =
    observation.value === null ? null : toEnum(observation.value, OBSERVATIONS)
  if (observation.value !== null && observationValue === null) {
    return JOURNAL_CORRUPT
  }
  const resolutionValue = resolution.value === null ? null : toEnum(resolution.value, RESOLUTIONS)
  if (resolution.value !== null && resolutionValue === null) {
    return JOURNAL_CORRUPT
  }

  const requestValue = parseRequestValue(request.value)
  const witnessValue = parseWitnessValue(witness.value)
  const preStateValue = parsePreStateValue(preState.value)
  const commitmentValue = parseCommitmentValue(intendedMessage.value)
  const blockhashValue = parseBlockhashValidityValue(blockhashValidity.value)
  const issueCodesValue = parseIssueCodes(issueCodes.value)
  if (
    requestValue === null ||
    witnessValue === null ||
    preStateValue === null ||
    commitmentValue === null ||
    blockhashValue === null ||
    issueCodesValue === null
  ) {
    return JOURNAL_CORRUPT
  }

  const draft: JournalDraft = {
    schema: REDAX_TEAM_ADMIN_MUTATION_JOURNAL_SCHEMA,
    namespace: namespace.value,
    attemptNonce: attemptNonce.value,
    revision: revision.value,
    lifecycle: lifecycleValue,
    campaign: campaign.value,
    operation: operationValue,
    mutationIdentitySha256Hex: identityHex.value,
    request: requestValue,
    witness: witnessValue,
    preState: preStateValue,
    intendedMessage: commitmentValue,
    blockhashValidity: blockhashValue,
    knownSignature: knownSignature.value as string | null,
    observation: observationValue,
    resolution: resolutionValue,
    issueCodes: issueCodesValue,
  }
  if (!isCoherent(draft)) {
    return JOURNAL_CORRUPT
  }
  return { ok: true, record: publish(draft), canonical: canonicalize(draft) }
}

// --- Live-witness continuity ------------------------------------------------------

/**
 * What this realm last verifiably saw at one storage key.
 *
 * Module-private and per-realm. It cannot detect a cold clear after every tab closes —
 * that residual is the accepted client-only threat boundary above — but within a live
 * realm it turns a deletion, a rollback, a same-revision rewrite and an unexplained jump
 * into refusals instead of silently accepted history.
 */
interface LiveWitness {
  readonly attemptNonce: string
  readonly highestRevision: number
  readonly canonical: string
  readonly createdInThisSession: boolean
  readonly rawSendMarkerWritten: boolean
}

const LIVE_WITNESSES = new Map<string, LiveWitness>()

type LiveVerdict = 'OK' | 'LIVE_DELETION_DETECTED' | 'LIVE_ROLLBACK_DETECTED'

function rememberWitness(
  key: string,
  record: RedaxTeamAdminMutationRecordV1,
  canonical: string,
  createdInThisSession: boolean,
  rawSendMarkerWritten: boolean,
): void {
  LIVE_WITNESSES.set(key, {
    attemptNonce: record.attemptNonce,
    highestRevision: record.revision,
    canonical,
    createdInThisSession,
    rawSendMarkerWritten,
  })
}

/**
 * The transitions worth replaying against a candidate successor record.
 *
 * The two parameterized transitions take their parameters FROM the candidate, which is
 * safe precisely because the replay is then compared to that candidate byte for byte: a
 * fabricated record may supply its own parameters and still has to be the exact output of
 * one real transition applied to the exact previous record.
 */
function replayCandidates(
  next: RedaxTeamAdminMutationRecordV1,
): RedaxTeamAdminMutationTransition[] {
  const candidates: RedaxTeamAdminMutationTransition[] = [
    { type: 'MARK_PRE_RAW_SEND_SIGNATURE_LOCAL' },
    { type: 'RESOLVE_PRE_RAW_SEND_NO_BROADCAST' },
    { type: 'RESOLVE_MATCHING_IMMEDIATE_STATE' },
    { type: 'RESOLVE_LANDED_EXACT_POST_STATE_SUPERSEDED' },
    { type: 'RESOLVE_FINALIZED_LANDED_FAILURE' },
    { type: 'RESOLVE_FINALIZED_NO_LAND' },
    { type: 'ACKNOWLEDGE_SUPPORT_DISPOSITION' },
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
 * Everything about a record that no transition may ever change, as canonical bytes.
 *
 * The mutable members are flattened to fixed values so what remains is exactly the
 * immutable core: namespace, nonce, campaign, operation, identity, request, witness,
 * pre-state, message commitment and blockhash validity.
 */
function immutableProjection(record: RedaxTeamAdminMutationRecordV1): string {
  const projected = draftOf(record)
  projected.revision = 1
  projected.lifecycle = 'PRE_RAW_SEND'
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
 * non-null ONLY through the retained-signature step, and it is the exact one-step relation
 * below — not this function — that proves that.
 */
function isKnownSignatureContinuous(
  previous: RedaxTeamAdminMutationRecordV1,
  next: RedaxTeamAdminMutationRecordV1,
): boolean {
  return previous.knownSignature === null || next.knownSignature === previous.knownSignature
}

function nextRevision(current: number): number | null {
  const advanced = current + 1
  return advanced > MAX_REVISION ? null : advanced
}

/**
 * Is `next` EXACTLY what one legitimate transition of `previous` would have written?
 *
 * The relation is proved by REPLAY through the same `applyTransition` every exported
 * mutation uses, so this file holds one transition implementation and there is no second
 * one to drift from it. Endpoint plausibility proves nothing: a record is accepted only
 * when a real transition reproduces its canonical bytes exactly, at exactly the next
 * revision.
 */
function isExactOneStep(
  previous: RedaxTeamAdminMutationRecordV1,
  previousCanonical: string,
  next: RedaxTeamAdminMutationRecordV1,
  nextCanonical: string,
  originHeldHere: boolean,
): boolean {
  const advanced = nextRevision(previous.revision)
  if (advanced === null || advanced !== next.revision) {
    return false
  }
  // The replayed actor is treated as the origin of its own attempt, so a legitimate step
  // by another realm replays. Where THIS realm provably holds the origin, the two reserved
  // moves are removed from the candidate set below instead, because then no other actor can
  // be making them and one appearing underneath us is a rewrite.
  const replayWitness: LiveWitness = {
    attemptNonce: previous.attemptNonce,
    highestRevision: previous.revision,
    canonical: previousCanonical,
    createdInThisSession: true,
    rawSendMarkerWritten: false,
  }
  for (const candidate of replayCandidates(next)) {
    if (originHeldHere && ORIGIN_RESERVED_WHILE_HELD_TRANSITIONS.includes(candidate.type)) {
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
 * Is `next` EXACTLY what the production `begin` replacement path would have written over
 * this exact previous record?
 *
 * The previous record must be a tombstone whose resolution is REPLACEABLE, the candidate
 * must be a fresh revision-1 record in the same namespace, and it must carry a DIFFERENT
 * nonce. An ACTIVE attempt is never displaced, an unresolved attempt is never displaced,
 * and an acknowledged support disposition is permanent.
 */
function isExactBeginReplacement(
  previous: RedaxTeamAdminMutationRecordV1,
  next: RedaxTeamAdminMutationRecordV1,
  nextCanonical: string,
): boolean {
  if (
    previous.lifecycle !== 'TOMBSTONE' ||
    previous.resolution === null ||
    !REPLACEABLE_RESOLUTIONS.includes(previous.resolution) ||
    next.revision !== 1 ||
    next.lifecycle !== 'PRE_RAW_SEND' ||
    next.knownSignature !== null ||
    next.observation !== null ||
    next.resolution !== null ||
    next.issueCodes.length !== 0 ||
    next.attemptNonce === previous.attemptNonce ||
    next.namespace.cluster !== previous.namespace.cluster ||
    next.namespace.program !== previous.namespace.program ||
    next.namespace.teamWallet !== previous.namespace.teamWallet
  ) {
    return false
  }
  return canonicalize(draftOf(next)) === nextCanonical
}

function judgeAgainstWitness(
  witness: LiveWitness | undefined,
  next: RedaxTeamAdminMutationRecordV1 | null,
  nextCanonical: string | null,
): LiveVerdict {
  if (witness === undefined) {
    return 'OK'
  }
  if (next === null || nextCanonical === null) {
    // We saw it; now it is gone. Client-only storage cannot prove WHO removed it, so the
    // only safe reading is that the durable record can no longer be trusted.
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
    // At the same revision the record is the same record, or it is a forgery. There is no
    // third reading: every write this module makes advances the revision, so nothing
    // legitimate ever changes a byte in place.
    return nextCanonical === witness.canonical ? 'OK' : 'LIVE_ROLLBACK_DETECTED'
  }
  if (next.revision !== previous.record.revision + 1) {
    // A jump of more than one cannot be checked without the transitions it skipped, and a
    // stale realm failing closed is the correct outcome.
    return 'LIVE_ROLLBACK_DETECTED'
  }

  if (next.attemptNonce === previous.record.attemptNonce) {
    if (
      immutableProjection(next) !== immutableProjection(previous.record) ||
      !isKnownSignatureContinuous(previous.record, next)
    ) {
      return 'LIVE_ROLLBACK_DETECTED'
    }
    // While this realm holds the origin rights over an attempt whose raw-send marker it
    // has not written, no other actor can legitimately mark the local signature or call it
    // a pre-raw-send no-broadcast — those two are ours, and we have not made them.
    const originHeldHere =
      witness.createdInThisSession &&
      !witness.rawSendMarkerWritten &&
      previous.record.lifecycle === 'PRE_RAW_SEND'
    return isExactOneStep(previous.record, previous.canonical, next, nextCanonical, originHeldHere)
      ? 'OK'
      : 'LIVE_ROLLBACK_DETECTED'
  }

  // A different attempt entirely. Only the exact replacement `begin` write over a
  // REPLACEABLE tombstone can legitimately mint a new nonce.
  return isExactBeginReplacement(previous.record, next, nextCanonical)
    ? 'OK'
    : 'LIVE_ROLLBACK_DETECTED'
}

// --- The transition implementation ------------------------------------------------

type TransitionOutcome =
  | { readonly ok: true; readonly draft: JournalDraft }
  | { readonly ok: false; readonly code: RedaxTeamAdminMutationFailureCode }

const TRANSITION_INVALID: TransitionOutcome = Object.freeze({
  ok: false,
  code: 'TRANSITION_INVALID',
})

/**
 * The allowed `RECORD_OBSERVATION` pairs — `J-T03`, exhaustively.
 *
 * The union of the three sets is EXACTLY the eleven observations, so none is orphaned and
 * no twelfth is reachable. `TOMBSTONE` admits none at all: a resolved record is over, and
 * appending to it would be editing history.
 *
 * `FINALIZED_NO_LAND_PROVEN` is a member of the `KNOWN_SIGNATURE` set here, which is a
 * deliberate difference from the closed S1 journal's vocabulary rather than an oversight.
 * It is what keeps the union complete, and it is not a shortcut to a terminal: the
 * TOMBSTONE that carries it is reachable only through `RESOLVE_FINALIZED_NO_LAND`, whose
 * own coherence rule additionally requires an empty issue-code set.
 */
const OBSERVATION_SOURCES: Readonly<
  Record<string, readonly RedaxTeamAdminMutationObservation[]>
> = Object.freeze({
  PRE_RAW_SEND: Object.freeze([
    'PRE_STATE_NOT_ADMISSIBLE',
    'PRE_RAW_SEND_REFUSED',
    'READ_UNAVAILABLE',
  ] as const),
  PRE_RAW_SEND_SIGNATURE_LOCAL_NOT_RETAINED: Object.freeze([
    'PRE_RAW_SEND_REFUSED',
    'SIGNATURE_OBSERVED',
    'READ_UNAVAILABLE',
  ] as const),
  KNOWN_SIGNATURE: Object.freeze([
    'SIGNATURE_OBSERVED',
    'RAW_SEND_OUTCOME_UNKNOWN_WITH_KNOWN_SIGNATURE',
    'LANDED_TRANSACTION_FAILED',
    'LANDED_MESSAGE_MISMATCH',
    'MATCHING_IMMEDIATE_STATE',
    'LANDED_EXACT_BUT_POST_STATE_SUPERSEDED',
    'READ_UNAVAILABLE',
    'SUPPORT_ONLY',
    'FINALIZED_NO_LAND_PROVEN',
  ] as const),
  TOMBSTONE: Object.freeze([] as const),
})

/** Order a caller-supplied issue-code set into the ONE canonical order. */
function canonicalIssueCodes(
  codes: readonly RedaxTeamAdminMutationIssueCode[],
): readonly RedaxTeamAdminMutationIssueCode[] | null {
  if (!Array.isArray(codes)) {
    return null
  }
  const seen: RedaxTeamAdminMutationIssueCode[] = []
  for (const entry of codes) {
    const code = toEnum(entry, ISSUE_CODES)
    if (code === null || seen.includes(code)) {
      return null
    }
    seen.push(code)
  }
  return ISSUE_CODES.filter((code) => seen.includes(code))
}

/**
 * Apply ONE transition to ONE record, producing the next draft — or refuse.
 *
 * `J-T01 … J-T09`, and no tenth. Every rule below is a SOURCE-LIFECYCLE rule: a transition
 * whose source lifecycle is not listed for it is not "undefined", it is FORBIDDEN.
 *
 * The revision is NOT advanced here. The caller advances it, once, after coherence — which
 * is what lets the replay above compare a candidate at an exact revision without this
 * function needing to know whether it is being replayed or performed.
 */
function applyTransition(
  record: RedaxTeamAdminMutationRecordV1,
  transition: RedaxTeamAdminMutationTransition,
  witness: LiveWitness | undefined,
): TransitionOutcome {
  // TOMBSTONE IS TERMINAL, for every transition without exception. Checked first so no
  // per-transition rule has to remember it.
  if (record.lifecycle === 'TOMBSTONE') {
    return TRANSITION_INVALID
  }

  const draft = draftOf(record)

  switch (transition.type) {
    // J-T01 — the local signature exists; the raw send has NOT been invoked.
    case 'MARK_PRE_RAW_SEND_SIGNATURE_LOCAL': {
      if (
        record.lifecycle !== 'PRE_RAW_SEND' ||
        record.resolution !== null ||
        record.knownSignature !== null
      ) {
        return TRANSITION_INVALID
      }
      // ORIGIN-ONLY. A realm that merely OBSERVED this attempt cannot truthfully say a
      // signature was derived here, because it did not derive one.
      if (witness !== undefined && !witness.createdInThisSession) {
        return TRANSITION_INVALID
      }
      // LIFECYCLE ONLY. `knownSignature` is deliberately NOT written — that is `J-T02`'s
      // whole job, and the read-back between the two is what makes the retention provable
      // rather than merely attempted.
      draft.lifecycle = 'PRE_RAW_SEND_SIGNATURE_LOCAL_NOT_RETAINED'
      return { ok: true, draft }
    }

    // J-T02 — the exact local signature becomes durable, BEFORE the raw send is reachable.
    case 'RETAIN_KNOWN_SIGNATURE': {
      if (
        record.lifecycle !== 'PRE_RAW_SEND_SIGNATURE_LOCAL_NOT_RETAINED' ||
        record.knownSignature !== null ||
        record.resolution !== null
      ) {
        return TRANSITION_INVALID
      }
      const supplied = transition.knownSignature
      if (
        typeof supplied !== 'string' ||
        !/^[1-9A-HJ-NP-Za-km-z]{64,120}$/.test(supplied)
      ) {
        return TRANSITION_INVALID
      }
      draft.knownSignature = supplied
      draft.lifecycle = 'KNOWN_SIGNATURE'
      draft.observation = 'SIGNATURE_OBSERVED'
      return { ok: true, draft }
    }

    // J-T03 — an observation, and NOTHING else. The lifecycle is unchanged, and no
    // identity, plan, witness, pre-state, commitment, signature or resolution moves.
    case 'RECORD_OBSERVATION': {
      const allowed = OBSERVATION_SOURCES[record.lifecycle]
      if (allowed === undefined || !allowed.includes(transition.observation)) {
        return TRANSITION_INVALID
      }
      const codes = canonicalIssueCodes(transition.issueCodes)
      if (codes === null) {
        return TRANSITION_INVALID
      }
      draft.observation = transition.observation
      draft.issueCodes = codes
      return { ok: true, draft }
    }

    // J-T04 — the pre-raw-send terminal. A `KNOWN_SIGNATURE` record can NEVER reach it.
    case 'RESOLVE_PRE_RAW_SEND_NO_BROADCAST': {
      if (
        record.lifecycle !== 'PRE_RAW_SEND' &&
        record.lifecycle !== 'PRE_RAW_SEND_SIGNATURE_LOCAL_NOT_RETAINED'
      ) {
        // Once a signature is durably retained and read-verified, the record has entered
        // the window in which a raw send may have happened, and a terminal asserting no
        // broadcast would be a durable false statement about the chain.
        return TRANSITION_INVALID
      }
      if (record.knownSignature !== null || record.resolution !== null) {
        return TRANSITION_INVALID
      }
      // NO ORIGIN REQUIREMENT, DELIBERATELY — and this is the one place `J-T04` differs
      // from `J-T01`.
      //
      // "A signature was derived in this realm" is a statement only that realm can make, so
      // `J-T01` keeps its origin rule. "The raw send was never invoked" is not that kind of
      // statement at all: it is STRUCTURAL. The send is unreachable until `KNOWN_SIGNATURE`
      // has been durably retained AND read back, and the three lines above have already
      // required a `PRE_RAW_SEND` family lifecycle, a null `knownSignature` and a null
      // resolution — so a record reaching here provably never crossed the point of no
      // return, and any realm reading those exact durable bytes can say so truthfully.
      //
      // Requiring origin here made the terminal UNREACHABLE after a page reload, which is
      // precisely when a human comes back to reconcile: a fresh realm observes the record
      // as a successor, could never close it, and the single slot would then refuse every
      // future attempt for good. Nothing else is relaxed — `KNOWN_SIGNATURE` and
      // `TOMBSTONE` sources are still refused above, live deletion and rollback are still
      // detected by the witness, and the write is still exact compare-and-set on both the
      // attempt nonce and the revision.
      draft.lifecycle = 'TOMBSTONE'
      draft.resolution = 'RESOLVED_PRE_RAW_SEND_NO_BROADCAST'
      if (draft.observation === null) {
        draft.observation = 'PRE_RAW_SEND_REFUSED'
      }
      return { ok: true, draft }
    }

    // J-T05 … J-T09 — every post-raw-send terminal. All require `KNOWN_SIGNATURE` and the
    // exact observation their resolution is about; the observation is NOT written here,
    // because establishing it is a separate, evidenced step.
    case 'RESOLVE_MATCHING_IMMEDIATE_STATE':
    case 'RESOLVE_LANDED_EXACT_POST_STATE_SUPERSEDED':
    case 'RESOLVE_FINALIZED_LANDED_FAILURE':
    case 'RESOLVE_FINALIZED_NO_LAND':
    case 'ACKNOWLEDGE_SUPPORT_DISPOSITION': {
      if (record.lifecycle !== 'KNOWN_SIGNATURE' || record.resolution !== null) {
        return TRANSITION_INVALID
      }
      const required: Readonly<Record<string, RedaxTeamAdminMutationObservation>> = {
        RESOLVE_MATCHING_IMMEDIATE_STATE: 'MATCHING_IMMEDIATE_STATE',
        RESOLVE_LANDED_EXACT_POST_STATE_SUPERSEDED: 'LANDED_EXACT_BUT_POST_STATE_SUPERSEDED',
        RESOLVE_FINALIZED_LANDED_FAILURE: 'LANDED_TRANSACTION_FAILED',
        RESOLVE_FINALIZED_NO_LAND: 'FINALIZED_NO_LAND_PROVEN',
        ACKNOWLEDGE_SUPPORT_DISPOSITION: 'SUPPORT_ONLY',
      }
      const expected = required[transition.type]
      if (expected === undefined || record.observation !== expected) {
        // A raw `READ_UNAVAILABLE`, `LANDED_MESSAGE_MISMATCH` or
        // `RAW_SEND_OUTCOME_UNKNOWN_WITH_KNOWN_SIGNATURE` does NOT directly terminalize.
        // It must remain unresolved, or first be explicitly classified `SUPPORT_ONLY`.
        // Uncertainty is never laundered into a terminal by a transition that merely
        // happens to be available.
        return TRANSITION_INVALID
      }
      const resolutionFor: Readonly<Record<string, RedaxTeamAdminMutationResolution>> = {
        RESOLVE_MATCHING_IMMEDIATE_STATE: 'RESOLVED_MATCHING_IMMEDIATE_STATE',
        RESOLVE_LANDED_EXACT_POST_STATE_SUPERSEDED: 'RESOLVED_LANDED_EXACT_POST_STATE_SUPERSEDED',
        RESOLVE_FINALIZED_LANDED_FAILURE: 'RESOLVED_FINALIZED_LANDED_FAILURE',
        RESOLVE_FINALIZED_NO_LAND: 'RESOLVED_FINALIZED_NO_LAND',
        ACKNOWLEDGE_SUPPORT_DISPOSITION: 'ACCEPTED_SUPPORT_DISPOSITION',
      }
      const resolved = resolutionFor[transition.type]
      if (resolved === undefined) {
        return TRANSITION_INVALID
      }
      draft.lifecycle = 'TOMBSTONE'
      draft.resolution = resolved
      return { ok: true, draft }
    }

    default:
      // A transition outside the closed nine. Unreachable through the type; refused for
      // callers the type system never saw.
      return TRANSITION_INVALID
  }
}

// --- The locked storage read --------------------------------------------------------

type StoredState =
  | { readonly kind: 'EMPTY' }
  | {
      readonly kind: 'PRESENT'
      readonly record: RedaxTeamAdminMutationRecordV1
      readonly canonical: string
    }
  | { readonly kind: 'FAILED'; readonly code: RedaxTeamAdminMutationFailureCode }

/**
 * Read, validate, canonicalize, BIND and judge — the shared first half of every operation.
 *
 * The canonical round-trip is the load-bearing step: the stored text must equal the
 * canonical serialization of what it parsed to, byte for byte. That is what turns "it
 * happens to parse" into "it is exactly what this module would have written".
 *
 * The namespace the caller asked for is then required to be the namespace the record
 * carries. Internal consistency says nothing about whether a record was found where it
 * claims to live, and the requested namespace is exactly what derived the key it was read
 * from.
 */
function readStoredState(
  storage: RedaxMutationStoragePort,
  key: string,
  namespace: RedaxTeamAdminMutationNamespace,
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
    // Same meaning, different bytes: reordered keys, added whitespace, a duplicate member
    // the parser silently collapsed, a permuted issue-code array. Something other than
    // this module wrote it, and that is enough to refuse.
    return { kind: 'FAILED', code: 'JOURNAL_CORRUPT' }
  }
  if (
    parsed.record.namespace.cluster !== namespace.cluster ||
    parsed.record.namespace.program !== namespace.program ||
    parsed.record.namespace.teamWallet !== namespace.teamWallet
  ) {
    // A record that is internally perfect but belongs to ANOTHER slot. Record-level
    // invalidity outranks live-movement judgment, exactly as noncanonical bytes do.
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
  record: RedaxTeamAdminMutationRecordV1,
  canonical: string,
): void {
  const witness = LIVE_WITNESSES.get(key)
  if (witness === undefined || record.attemptNonce !== witness.attemptNonce) {
    // First sight in a fresh realm, or a DIFFERENT attempt than the one this realm was
    // following. Both are SUCCESSOR positions: this realm may reconcile, but it did not
    // create the attempt that is there now and never inherits the right to say a signature
    // was derived HERE. That right is minted only by the operation that successfully writes
    // a record, never by observing one.
    //
    // A SUCCESSOR MAY STILL CLOSE A PRE-RAW-SEND RECORD, and must be able to: the durable
    // record outlives the realm that wrote it, and the no-broadcast fact is structural
    // rather than remembered. `J-T04` therefore carries no origin rule — see it — while
    // `J-T01` still does.
    rememberWitness(key, record, canonical, false, record.lifecycle !== 'PRE_RAW_SEND')
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
    witness.rawSendMarkerWritten || record.lifecycle !== 'PRE_RAW_SEND',
  )
}

// --- The exclusive lock ---------------------------------------------------------

const LOCK_OPTIONS = Object.freeze({ mode: 'exclusive' as const, ifAvailable: true as const })

/**
 * Run one journal operation under the namespace's exclusive Web Lock.
 *
 * Module-private, and it accepts no caller-supplied callback: every exported operation
 * passes its own internal body, and nothing generic is exported. Under `ifAvailable` the
 * callback is invoked with `null` when the lock is already held — that is a refusal, never
 * a wait. There is no queue, no steal, no timeout and no signal, because a journal
 * operation that waits is one another tab can make wait forever.
 *
 * The body's result is captured through a box rather than taken from what `request`
 * resolves to: the lock manager is resolved from `globalThis` and its return value is not
 * this module's to trust. If the callback never runs, nothing is captured and the
 * operation refuses.
 *
 * The lock is held for read -> decide -> write -> read-back -> verify, and nothing longer.
 * No wallet, RPC or UI work ever happens inside it.
 */
async function withExclusiveJournalLock<R>(
  namespace: RedaxTeamAdminMutationNamespace,
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

// --- Write and verify -------------------------------------------------------------

function writeFailure(code: RedaxTeamAdminMutationFailureCode): RedaxTeamAdminMutationWriteResult {
  return { ok: false, code }
}

/**
 * Write one canonical text and READ IT BACK under the same held lock.
 *
 * A `setItem` that returned is not a durable record: quota, a partitioned origin and a
 * hostile shim can all accept a write nobody can read. The read-back re-parses through the
 * SAME hostile-input path a fresh realm would use, so what is verified is what a later
 * session will actually see.
 */
function writeAndVerify(
  storage: RedaxMutationStoragePort,
  key: string,
  namespace: RedaxTeamAdminMutationNamespace,
  draft: JournalDraft,
): { readonly ok: true; readonly record: RedaxTeamAdminMutationRecordV1; readonly canonical: string } | { readonly ok: false; readonly code: RedaxTeamAdminMutationFailureCode } {
  if (!isCoherent(draft)) {
    return { ok: false, code: 'TRANSITION_INVALID' }
  }
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
    return { ok: false, code: 'WRITE_VERIFICATION_FAILED' }
  }
  if (typeof readBack !== 'string' || readBack !== canonical) {
    return { ok: false, code: 'WRITE_VERIFICATION_FAILED' }
  }
  const parsed = parseJournalText(readBack)
  if (!parsed.ok || parsed.canonical !== canonical) {
    return { ok: false, code: 'WRITE_VERIFICATION_FAILED' }
  }
  if (
    parsed.record.namespace.cluster !== namespace.cluster ||
    parsed.record.namespace.program !== namespace.program ||
    parsed.record.namespace.teamWallet !== namespace.teamWallet
  ) {
    return { ok: false, code: 'WRITE_VERIFICATION_FAILED' }
  }
  return { ok: true, record: parsed.record, canonical }
}

// --- Exported operations ------------------------------------------------------------

/**
 * Read the current slot for one namespace.
 *
 * READ-ONLY in every sense: it takes the lock so it cannot observe a half-written value,
 * and it writes nothing. A refusal is never a licence to start an attempt.
 */
export async function readRedaxTeamAdminMutationJournal(
  namespace: RedaxTeamAdminMutationNamespace,
): Promise<RedaxTeamAdminMutationReadResult> {
  if (!isValidNamespace(namespace)) {
    return { ok: false, code: 'NAMESPACE_INVALID' }
  }
  return withExclusiveJournalLock<RedaxTeamAdminMutationReadResult>(
    namespace,
    { ok: false, code: 'LOCK_MANAGER_UNAVAILABLE' },
    { ok: false, code: 'LOCK_UNAVAILABLE' },
    async () => {
      const storage = resolveStoragePort()
      if (storage === null) {
        return { ok: false, code: 'STORAGE_UNAVAILABLE' }
      }
      const key = journalKey(namespace)
      const stored = readStoredState(storage, key, namespace)
      if (stored.kind === 'FAILED') {
        return { ok: false, code: stored.code }
      }
      if (stored.kind === 'EMPTY') {
        return { ok: true, kind: 'EMPTY' }
      }
      observeStored(key, stored.record, stored.canonical)
      return stored.record.lifecycle === 'TOMBSTONE'
        ? { ok: true, kind: 'TOMBSTONE', record: stored.record }
        : { ok: true, kind: 'ACTIVE', record: stored.record }
    },
  )
}

/**
 * Open a fresh mutation slot, or replace a REPLACEABLE tombstone under exact identity.
 *
 * THE SINGLE-SLOT RULE LIVES HERE. Any unresolved record — same Campaign or different,
 * same operation or different, same identity or different — refuses. There is no per-
 * campaign and no per-operation slot to fall back to, because there is no second slot.
 */
export async function beginRedaxTeamAdminMutationAttempt(
  input: RedaxTeamAdminMutationBeginInput,
): Promise<RedaxTeamAdminMutationWriteResult> {
  if (typeof input !== 'object' || input === null) {
    return writeFailure('INPUT_INVALID')
  }
  const { namespace } = input
  if (!isValidNamespace(namespace)) {
    return writeFailure('NAMESPACE_INVALID')
  }
  if (
    !isAccountIdentifier(input.campaign) ||
    toEnum(input.operation, OPERATIONS) === null ||
    !isSha256Hex(input.mutationIdentitySha256Hex)
  ) {
    return writeFailure('INPUT_INVALID')
  }
  const request = parseRequestValue(input.request)
  const witnessFacts = parseWitnessValue(input.witness)
  const preState = parsePreStateValue(input.preState)
  const commitment = parseCommitmentValue(input.intendedMessage)
  const blockhashValidity = parseBlockhashValidityValue(input.blockhashValidity)
  if (
    request === null ||
    witnessFacts === null ||
    preState === null ||
    commitment === null ||
    blockhashValidity === null
  ) {
    return writeFailure('INPUT_INVALID')
  }
  const replaces = input.replaces
  if (replaces !== null) {
    if (
      typeof replaces !== 'object' ||
      typeof replaces.attemptNonce !== 'string' ||
      !ATTEMPT_NONCE_PATTERN.test(replaces.attemptNonce) ||
      !isNonNegativeSafeInteger(replaces.revision)
    ) {
      return writeFailure('INPUT_INVALID')
    }
  }

  return withExclusiveJournalLock<RedaxTeamAdminMutationWriteResult>(
    namespace,
    writeFailure('LOCK_MANAGER_UNAVAILABLE'),
    writeFailure('LOCK_UNAVAILABLE'),
    async () => {
      const storage = resolveStoragePort()
      if (storage === null) {
        return writeFailure('STORAGE_UNAVAILABLE')
      }
      const key = journalKey(namespace)
      const stored = readStoredState(storage, key, namespace)
      if (stored.kind === 'FAILED') {
        return writeFailure(stored.code)
      }
      if (stored.kind === 'PRESENT') {
        observeStored(key, stored.record, stored.canonical)
        if (stored.record.lifecycle !== 'TOMBSTONE') {
          // THE SINGLE-SLOT REFUSAL. It does not consult the campaign, the operation or
          // the identity, because none of them widens the slot.
          return writeFailure('ACTIVE_ATTEMPT_EXISTS')
        }
        if (
          stored.record.resolution === null ||
          !REPLACEABLE_RESOLUTIONS.includes(stored.record.resolution)
        ) {
          return writeFailure('TOMBSTONE_NOT_REPLACEABLE')
        }
        if (
          replaces === null ||
          replaces.attemptNonce !== stored.record.attemptNonce ||
          replaces.revision !== stored.record.revision
        ) {
          // Replacing a tombstone requires naming the EXACT one being replaced. A caller
          // that did not read it cannot have decided it was safe to replace.
          return writeFailure('CAS_CONFLICT')
        }
      } else if (replaces !== null) {
        // The caller believed it was replacing something and the slot is empty.
        return writeFailure('CAS_CONFLICT')
      }

      const attemptNonce = drawAttemptNonce()
      if (attemptNonce === null) {
        return writeFailure('ENTROPY_UNAVAILABLE')
      }

      const draft: JournalDraft = {
        schema: REDAX_TEAM_ADMIN_MUTATION_JOURNAL_SCHEMA,
        namespace: {
          cluster: namespace.cluster,
          program: namespace.program,
          teamWallet: namespace.teamWallet,
        },
        attemptNonce,
        revision: 1,
        lifecycle: 'PRE_RAW_SEND',
        campaign: input.campaign,
        operation: input.operation,
        mutationIdentitySha256Hex: input.mutationIdentitySha256Hex,
        request,
        witness: witnessFacts,
        preState,
        intendedMessage: commitment,
        blockhashValidity,
        knownSignature: null,
        observation: null,
        resolution: null,
        issueCodes: [],
      }
      const written = writeAndVerify(storage, key, namespace, draft)
      if (!written.ok) {
        return writeFailure(written.code)
      }
      // THE ORIGIN RIGHT IS MINTED HERE, by the write, and nowhere else.
      rememberWitness(key, written.record, written.canonical, true, false)
      return { ok: true, kind: 'CREATED', record: written.record }
    },
  )
}

/**
 * Advance one slot by exactly one transition, under exact compare-and-set.
 *
 * The caller must present the attempt nonce AND the revision it believes it is advancing
 * from. Either being wrong is a `CAS_CONFLICT`, never a merge and never a retry.
 */
export async function transitionRedaxTeamAdminMutationAttempt(
  input: RedaxTeamAdminMutationTransitionInput,
): Promise<RedaxTeamAdminMutationWriteResult> {
  if (typeof input !== 'object' || input === null) {
    return writeFailure('INPUT_INVALID')
  }
  const { namespace } = input
  if (!isValidNamespace(namespace)) {
    return writeFailure('NAMESPACE_INVALID')
  }
  if (
    typeof input.expectedAttemptNonce !== 'string' ||
    !ATTEMPT_NONCE_PATTERN.test(input.expectedAttemptNonce) ||
    !isNonNegativeSafeInteger(input.expectedRevision) ||
    typeof input.transition !== 'object' ||
    input.transition === null ||
    typeof input.transition.type !== 'string'
  ) {
    return writeFailure('INPUT_INVALID')
  }

  return withExclusiveJournalLock<RedaxTeamAdminMutationWriteResult>(
    namespace,
    writeFailure('LOCK_MANAGER_UNAVAILABLE'),
    writeFailure('LOCK_UNAVAILABLE'),
    async () => {
      const storage = resolveStoragePort()
      if (storage === null) {
        return writeFailure('STORAGE_UNAVAILABLE')
      }
      const key = journalKey(namespace)
      const stored = readStoredState(storage, key, namespace)
      if (stored.kind === 'FAILED') {
        return writeFailure(stored.code)
      }
      if (stored.kind === 'EMPTY') {
        return writeFailure('CAS_CONFLICT')
      }
      observeStored(key, stored.record, stored.canonical)

      if (
        stored.record.attemptNonce !== input.expectedAttemptNonce ||
        stored.record.revision !== input.expectedRevision
      ) {
        return writeFailure('CAS_CONFLICT')
      }

      const witness = LIVE_WITNESSES.get(key)
      const outcome = applyTransition(stored.record, input.transition, witness)
      if (!outcome.ok) {
        return writeFailure(outcome.code)
      }
      const advanced = nextRevision(stored.record.revision)
      if (advanced === null) {
        return writeFailure('REVISION_EXHAUSTED')
      }
      outcome.draft.revision = advanced

      const written = writeAndVerify(storage, key, namespace, outcome.draft)
      if (!written.ok) {
        return writeFailure(written.code)
      }
      rememberWitness(
        key,
        written.record,
        written.canonical,
        witness === undefined ? false : witness.createdInThisSession,
        (witness !== undefined && witness.rawSendMarkerWritten) ||
          written.record.lifecycle !== 'PRE_RAW_SEND',
      )
      return written.record.lifecycle === 'TOMBSTONE'
        ? { ok: true, kind: 'TOMBSTONED', record: written.record }
        : { ok: true, kind: 'UPDATED', record: written.record }
    },
  )
}
