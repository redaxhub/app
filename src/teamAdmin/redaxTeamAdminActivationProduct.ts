// -----------------------------------------------------------------------------
// WHAT THIS FILE IS
// -----------------------------------------------------------------------------
// The PURE product half of the `activate_campaign` surface: the memory-only frozen
// acknowledgement snapshot an operator commits to before a wallet is ever asked, the
// rule that decides whether that snapshot is still current, the closed activation
// product state, the read-only recovery projection, and one display-only formatter for
// a campaign's stored deadline.
//
// AND NO CLOCK. Not `Date`, not `Date.now`, not `performance`, not `getBlockTime`, not
// `getSlot`, not `getEpochInfo` and not `SYSVAR_CLOCK_PUBKEY`. That is not decoration:
// activation is the one post-init mutation whose program-side execution depends on
// chain time, and a browser wall clock is attacker-influenced and is never authority
// about a chain. The ONE time authority is the canonical Clock sysvar, read coherently
// beside the Campaign by the mutation chain guard's reader — which is why the formatter
// below can render a supplied `end_ts` and can compare it to nothing.
//
// -----------------------------------------------------------------------------
// ACTIVATION IS ONE-WAY
// -----------------------------------------------------------------------------
// `activate_campaign` moves a Campaign out of `initialized`, and Phase 1 has no
// instruction that moves it back. `add_token_config` and `setup_metadata` both require
// `initialized`, so after activation no further accepted input can be registered and no
// metadata can be applied. Every rule below is written from that fact:
//
//   * ACKNOWLEDGEMENT IS A SNAPSHOT, never a live read of the fields. What the operator
//     reviewed is what the request carries, and any change to the context it was taken
//     in DESTROYS it rather than quietly updating it.
//   * A STATE IS NOT AN ATTRIBUTION. A Campaign observed `active`, `paused` or
//     `finalized` proves only that it is PAST the activation predecessor. It does not
//     prove that this product activated it, so without a matching local success record
//     the honest answer is `POST_ACTIVATION_STATE_UNATTRIBUTED` and never
//     "already activated by us".
//   * A GENERIC FAILURE IS NOT AN EXPIRY. A finalized landed failure carries no exact
//     program-error cause here, so it proves NO EFFECT and nothing more. It is never
//     rendered as `CampaignExpired`, never as a closed window, and never as a permanent
//     refusal — a later attempt is decided by a fresh authority-grade Phase A, not by
//     this module's memory of an old one.
//
// -----------------------------------------------------------------------------
// WHAT DECIDES WHAT
// -----------------------------------------------------------------------------
// This module decides what a surface may OFFER. The mutation action root decides what
// actually happens: it runs the authority-grade guard, re-reads the Campaign and the
// canonical Clock, and refuses a request this module would have offered if the live
// chain no longer admits it. A hostile or stale caller that skipped every rule here
// still cannot reach a wallet prompt, because the planner's own
// `token_config_count >= 1` prerequisite and the guard's own deadline predicate are not
// on this side of the boundary.

import type { RedaxTeamAdminMutationOperation } from './redaxTeamAdminMutationIdentity'
import type { RedaxTeamAdminMutationResolution } from './redaxTeamAdminMutationJournal'

// --- The closed product state ---------------------------------------------------

/**
 * Every state the activation surface may be in. Closed, exhaustive and fifteen wide.
 *
 * THERE IS NO `FAILED`, NO `RETRY` AND NO `EXPIRED`. The first two would be lies about
 * an irreversible one-way step: an attempt whose outcome is unknown has not failed, and
 * an attempt that took no proven effect is not a retry of anything — it is over, and a
 * fresh attempt is a fresh decision the live chain has to admit again. The third would
 * be a claim about a program error this surface never receives.
 */
export const REDAX_TEAM_ADMIN_ACTIVATION_PRODUCT_STATES = [
  'NOT_CONFIGURED',
  'NOT_AUTHORIZED',
  'NOT_INITIALIZED',
  'METADATA_NOT_SET',
  'NO_TOKEN_CONFIGS',
  'CHAIN_TRUTH_UNAVAILABLE',
  'READY_FOR_ACKNOWLEDGEMENT',
  'READY_FOR_ACTIVATION',
  'SAVED_ATTEMPT',
  'SUBMITTED_ATTEMPT',
  'CAMPAIGN_ACTIVATED',
  'ACTIVATION_SUPERSEDED',
  'NO_EFFECT_PROVEN',
  'BLOCKED_SUPPORT',
  'POST_ACTIVATION_STATE_UNATTRIBUTED',
] as const

/** One activation product state. */
export type RedaxTeamAdminActivationProductState =
  (typeof REDAX_TEAM_ADMIN_ACTIVATION_PRODUCT_STATES)[number]

/**
 * Why activation may not be offered. A refusal, never a durable state.
 *
 * `null` means nothing is refusing, which is the ONLY way the one-way gesture is
 * offered. There is deliberately no `ACTIVATION_WINDOW_CLOSED` member: this surface
 * holds no chain time and could only ever have derived one from a browser clock or from
 * a generic refusal, and both would be inventions.
 */
export type RedaxTeamAdminActivationBlockingCode =
  | 'DEPLOYMENT_NOT_CONFIGURED'
  | 'CAMPAIGN_NOT_AUTHORIZED'
  | 'ACTIVATION_ALREADY_ATTRIBUTED'
  | 'POST_ACTIVATION_STATE_UNATTRIBUTED'
  | 'SUPPORT_DISPOSITION_BLOCKED'
  | 'MUTATION_STATUS_UNAVAILABLE'
  | 'SAVED_ATTEMPT_OUTSTANDING'
  | 'GLOBAL_MUTATION_SLOT_ACTIVE'
  | 'CHAIN_TRUTH_UNAVAILABLE'
  | 'CAMPAIGN_NOT_INITIALIZED'
  | 'METADATA_NOT_SET'
  | 'NO_TOKEN_CONFIGS'
  | 'NO_CURRENT_ACKNOWLEDGEMENT'

/**
 * The three lifecycle statuses that are PAST the activation predecessor.
 *
 * Named as a list so the rule is one comparison rather than three: a Campaign in any of
 * them cannot be activated again, and — crucially — being in one of them says nothing
 * whatever about WHO moved it there.
 */
export const REDAX_TEAM_ADMIN_POST_ACTIVATION_STATUSES = ['active', 'paused', 'finalized'] as const

/** The one status `activate_campaign` may be attempted from. */
export const REDAX_TEAM_ADMIN_ACTIVATION_PREDECESSOR_STATUS = 'initialized' as const

// --- The display-only deadline formatter ------------------------------------------

/**
 * How a campaign's stored `end_ts` is shown. THREE shapes, and none of them compares.
 *
 * `NONE` is a campaign with no deadline at all, `UNAVAILABLE` is a value this module
 * refuses to render, and `UTC` carries a rendered instant. Nothing downstream may
 * compare the text to anything: it is a label, and the deadline decision belongs to the
 * chain guard's coherent Clock reading.
 */
export type RedaxTeamAdminActivationDeadlineDisplay =
  | { readonly kind: 'NONE' }
  | { readonly kind: 'UNAVAILABLE' }
  | { readonly kind: 'UTC'; readonly text: string }

/** The widest instant this module will render, in seconds: `9999-12-31T23:59:59Z`. */
const ACTIVATION_DEADLINE_MAX_SECONDS = 253402300799
/** The narrowest, in seconds: `0001-01-01T00:00:00Z`. */
const ACTIVATION_DEADLINE_MIN_SECONDS = -62135596800
const SECONDS_PER_DAY = 86400

/** Zero-pad to `width`. Total, and it truncates nothing: the inputs are bounded above. */
function padded(value: number, width: number): string {
  const text = String(value)
  return text.length >= width ? text : `${'0'.repeat(width - text.length)}${text}`
}

/**
 * The civil date for a count of days since `1970-01-01`. Pure integer arithmetic.
 *
 * The standard proleptic-Gregorian `civil_from_days` algorithm, written out rather than
 * delegated — because the obvious delegate would be `Date`, and this module names no
 * clock type at all. A formatter that could reach `Date` is a formatter one edit away
 * from reading the current time, and current time is exactly what must not live here.
 */
function civilFromDays(days: number): {
  readonly year: number
  readonly month: number
  readonly day: number
} {
  const shifted = days + 719468
  const era = Math.floor(shifted / 146097)
  const dayOfEra = shifted - era * 146097
  const yearOfEra = Math.floor(
    (dayOfEra -
      Math.floor(dayOfEra / 1460) +
      Math.floor(dayOfEra / 36524) -
      Math.floor(dayOfEra / 146096)) /
      365,
  )
  const shiftedYear = yearOfEra + era * 400
  const dayOfYear =
    dayOfEra - (365 * yearOfEra + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100))
  const monthPrime = Math.floor((5 * dayOfYear + 2) / 153)
  const day = dayOfYear - Math.floor((153 * monthPrime + 2) / 5) + 1
  const month = monthPrime < 10 ? monthPrime + 3 : monthPrime - 9
  return { year: month <= 2 ? shiftedYear + 1 : shiftedYear, month, day }
}

/**
 * Render a supplied campaign deadline. DISPLAY ONLY, and it reads no clock.
 *
 * TOTAL AND FAIL-CLOSED. A non-finite value, a non-safe-integer value and a value
 * outside the renderable range all answer `UNAVAILABLE` rather than throwing and rather
 * than being clamped — a clamped deadline is a different deadline. `null` is the honest
 * `NONE`: the campaign carries no `end_ts` at all.
 *
 * WHAT IT IS NOT. It is not an admission input, it is not compared to anything, and no
 * caller may decide from its output whether a window is open. That question is answered
 * by the chain guard, from the canonical Clock, in the same coherent response as the
 * Campaign — never from a string this function produced.
 */
export function formatRedaxTeamAdminActivationDeadline(
  endTs: number | null,
): RedaxTeamAdminActivationDeadlineDisplay {
  if (endTs === null) {
    return { kind: 'NONE' }
  }
  if (
    typeof endTs !== 'number' ||
    !Number.isFinite(endTs) ||
    !Number.isSafeInteger(endTs) ||
    endTs < ACTIVATION_DEADLINE_MIN_SECONDS ||
    endTs > ACTIVATION_DEADLINE_MAX_SECONDS
  ) {
    return { kind: 'UNAVAILABLE' }
  }
  const days = Math.floor(endTs / SECONDS_PER_DAY)
  const secondOfDay = endTs - days * SECONDS_PER_DAY
  const civil = civilFromDays(days)
  const hour = Math.floor(secondOfDay / 3600)
  const minute = Math.floor((secondOfDay - hour * 3600) / 60)
  const second = secondOfDay - hour * 3600 - minute * 60
  return {
    kind: 'UTC',
    text:
      `${padded(civil.year, 4)}-${padded(civil.month, 2)}-${padded(civil.day, 2)}` +
      `T${padded(hour, 2)}:${padded(minute, 2)}:${padded(second, 2)}Z`,
  }
}

// --- The acknowledgement context --------------------------------------------------

/**
 * Everything an acknowledgement is bound TO. Every member is a public fact.
 *
 * NOT ONE OF THEM IS A SECRET, an adapter, a transaction, a wire, a signature, a
 * blockhash, a journal revision or a durable record, and none of them is persisted
 * anywhere. What they are is the exact situation the operator reviewed — so a snapshot
 * can be checked against the CURRENT situation by value equality rather than by hoping
 * nothing moved.
 *
 * THERE IS NO CHAIN CLOCK HERE, and there must not be. A frozen timestamp would go stale
 * by construction the instant it was taken, and comparing a later reading against it
 * would refuse every attempt merely because time passed. Chain time is re-decided by the
 * guard at Phase A, at Phase B and again after the wallet; it is not a snapshot field.
 */
export interface RedaxTeamAdminActivationAcknowledgementContext {
  /** The RAW explicit selection, never the loader's fallback. */
  readonly rawSelectedCampaignId: string
  /** The campaign the loader actually resolved. Admission requires the two agree. */
  readonly effectiveSelectedCampaignId: string
  /** The campaign account's OWN stored address. */
  readonly campaignAddress: string
  /** The campaign's stored admin, which must be the approved Team wallet. */
  readonly campaignAdmin: string
  /** The campaign's observed lifecycle status. Acknowledgement requires `initialized`. */
  readonly campaignStatus: string
  /** The observed `metadata_setup` flag. Both the program and the product require it. */
  readonly campaignMetadataSetup: boolean
  /**
   * DELIBERATELY DIFFERENT FROM THE GUARD'S REASSERTION FOOTPRINT, which carries no raw
   * count at all. The two answer different questions. The guard asks whether the
   * SECURITY admission still holds, and a monotonic `1 → 2` leaves it holding — refusing
   * there would reject a campaign that became MORE admissible. This asks whether the
   * HUMAN still knows what they are approving, and `1 → 2` means the setup they read is
   * not the setup they would be freezing: activation is the last moment at which another
   * accepted input can ever be added.
   */
  readonly campaignTokenConfigCount: number
  /** The campaign's stored deadline, or `null`. Bound as a VALUE, compared to no clock. */
  readonly campaignEndTs: number | null
  /** The configured approved-Team identity. A deployment fact, never the connected wallet. */
  readonly approvedTeamWallet: string
  /** The canonical runtime program identity. */
  readonly programId: string
}

/**
 * The context fields, as a list.
 *
 * The comparison below is DRIVEN BY THIS LIST rather than written out field by field, so
 * a member that exists in the interface and not here cannot silently stop being compared.
 */
export const REDAX_TEAM_ADMIN_ACTIVATION_ACKNOWLEDGEMENT_CONTEXT_FIELDS = [
  'rawSelectedCampaignId',
  'effectiveSelectedCampaignId',
  'campaignAddress',
  'campaignAdmin',
  'campaignStatus',
  'campaignMetadataSetup',
  'campaignTokenConfigCount',
  'campaignEndTs',
  'approvedTeamWallet',
  'programId',
] as const satisfies readonly (keyof RedaxTeamAdminActivationAcknowledgementContext)[]

/** The raw facts a context is built from. Any missing one refuses the whole context. */
export interface RedaxTeamAdminActivationAcknowledgementContextInput {
  readonly rawSelectedCampaignId: string
  readonly effectiveSelectedCampaignId: string
  readonly campaignAddress: string | null
  readonly campaignAdmin: string | null
  readonly campaignStatus: string | null
  readonly campaignMetadataSetup: boolean | null
  readonly campaignTokenConfigCount: number | null
  readonly campaignEndTs: number | null
  readonly approvedTeamWallet: string | null
  readonly programId: string | null
}

/**
 * Build the immutable acknowledgement context, or refuse.
 *
 * EVERY FACT MUST BE PRESENT AND POSITIVE. An absent stored address, an absent admin, an
 * unresolved program id, an unreadable status, an unreadable metadata flag and an
 * unreadable count are all refusals — a view that OMITTED a field is not a view that
 * agreed with anything.
 *
 * THE PRECONDITIONS ARE PART OF THE CONTEXT, not merely checked beside it. An
 * acknowledgement may only be taken while the campaign is still `initialized`, its
 * metadata is set and it holds at least one accepted input, so a snapshot that exists at
 * all is a snapshot of a situation activation was admissible in.
 */
export function buildRedaxTeamAdminActivationAcknowledgementContext(
  input: RedaxTeamAdminActivationAcknowledgementContextInput,
): RedaxTeamAdminActivationAcknowledgementContext | null {
  if (
    input.campaignAddress === null ||
    input.campaignAdmin === null ||
    input.campaignStatus === null ||
    input.campaignMetadataSetup === null ||
    input.campaignTokenConfigCount === null ||
    input.approvedTeamWallet === null ||
    input.programId === null
  ) {
    return null
  }
  if (input.rawSelectedCampaignId.trim() === '') {
    return null
  }
  if (input.rawSelectedCampaignId !== input.effectiveSelectedCampaignId) {
    return null
  }
  if (input.campaignAddress !== input.rawSelectedCampaignId) {
    return null
  }
  if (input.campaignAdmin !== input.approvedTeamWallet) {
    return null
  }
  if (input.campaignStatus !== REDAX_TEAM_ADMIN_ACTIVATION_PREDECESSOR_STATUS) {
    return null
  }
  if (input.campaignMetadataSetup !== true) {
    return null
  }
  if (
    !Number.isSafeInteger(input.campaignTokenConfigCount) ||
    input.campaignTokenConfigCount < 1
  ) {
    return null
  }
  if (
    input.campaignEndTs !== null &&
    (!Number.isFinite(input.campaignEndTs) || !Number.isSafeInteger(input.campaignEndTs))
  ) {
    return null
  }
  return Object.freeze({
    rawSelectedCampaignId: input.rawSelectedCampaignId,
    effectiveSelectedCampaignId: input.effectiveSelectedCampaignId,
    campaignAddress: input.campaignAddress,
    campaignAdmin: input.campaignAdmin,
    campaignStatus: input.campaignStatus,
    campaignMetadataSetup: true,
    campaignTokenConfigCount: input.campaignTokenConfigCount,
    campaignEndTs: input.campaignEndTs,
    approvedTeamWallet: input.approvedTeamWallet,
    programId: input.programId,
  })
}

// --- The frozen memory-only acknowledgement snapshot --------------------------------

/**
 * IT CARRIES NO BYTES, no adapter, no `Connection`, no `Transaction`, no wire, no
 * message, no blockhash, no signature, no journal revision and no durable record — there
 * is no member any of them could travel in. It is MEMORY ONLY: it lives in one
 * component's state, no `localStorage`, `sessionStorage`, IndexedDB or Web Lock is
 * involved, and a reload discards it. What survives a reload is the durable attempt and
 * whatever the chain holds, and both are read back rather than remembered.
 *
 * `acknowledgementGeneration` binds the snapshot to the EXACT review it was taken from,
 * so a later gesture cannot silently revive an acknowledgement the surface discarded.
 */
export interface RedaxTeamAdminActivationAcknowledgementSnapshot {
  readonly acknowledgementGeneration: number
  readonly context: RedaxTeamAdminActivationAcknowledgementContext
}

/** Freeze one reviewed context into an acknowledgement snapshot. */
export function createRedaxTeamAdminActivationAcknowledgementSnapshot(
  acknowledgementGeneration: number,
  context: RedaxTeamAdminActivationAcknowledgementContext,
): RedaxTeamAdminActivationAcknowledgementSnapshot {
  return Object.freeze({ acknowledgementGeneration, context })
}

/** Field-by-field context equality, driven by the pinned field list. */
function acknowledgementContextsAgree(
  left: RedaxTeamAdminActivationAcknowledgementContext,
  right: RedaxTeamAdminActivationAcknowledgementContext,
): boolean {
  for (const field of REDAX_TEAM_ADMIN_ACTIVATION_ACKNOWLEDGEMENT_CONTEXT_FIELDS) {
    if (left[field] !== right[field]) {
      return false
    }
  }
  return true
}

/**
 * TOTAL AND CONSERVATIVE. An absent snapshot, an absent current context, a changed
 * generation and ANY changed context field all answer `false` — which is what a campaign
 * reselection, a fallback that stopped agreeing, a changed stored address, a changed
 * admin, a changed lifecycle status, a metadata flag that flipped, an accepted-input
 * count that moved, a changed deadline, a changed approved-Team carrier and a changed
 * program identity each reduce to.
 *
 * THE SNAPSHOT IS DESTROYED BY THE CALLER RATHER THAN REPAIRED HERE: this answers a
 * question and rewrites nothing. There is no partial update and no closest match.
 */
export function isRedaxTeamAdminActivationAcknowledgementCurrent(
  snapshot: RedaxTeamAdminActivationAcknowledgementSnapshot | null,
  context: RedaxTeamAdminActivationAcknowledgementContext | null,
  acknowledgementGeneration: number,
): boolean {
  if (snapshot === null || context === null) {
    return false
  }
  if (snapshot.acknowledgementGeneration !== acknowledgementGeneration) {
    return false
  }
  return acknowledgementContextsAgree(snapshot.context, context)
}

// --- Preview / request equality ----------------------------------------------------

/**
 * The EXACT values one `ACTIVATE_CAMPAIGN` request carries.
 *
 * ONE function produces them and the preview renders THE SAME snapshot field, so "what
 * was acknowledged is what is requested" is true by construction rather than by two code
 * paths agreeing. Nothing is normalized, defaulted or repaired here.
 */
export interface RedaxTeamAdminActivationSubmitValues {
  readonly campaign: string
}

/** Project the frozen snapshot into the exact request values. No transformation. */
export function redaxTeamAdminActivationSubmitValuesFromSnapshot(
  snapshot: RedaxTeamAdminActivationAcknowledgementSnapshot,
): RedaxTeamAdminActivationSubmitValues {
  return Object.freeze({ campaign: snapshot.context.campaignAddress })
}

// --- The durable slot, as this surface reads it -------------------------------------

/**
 * The sanitized status projection, folded into a structural input.
 *
 * A read that has not happened, and a read that failed, are BOTH `UNAVAILABLE`: an unread
 * slot is not a slot known to be empty, and nothing is offered until it has actually been
 * read.
 */
export type RedaxTeamAdminActivationStatusInput =
  | { readonly kind: 'UNAVAILABLE' }
  | { readonly kind: 'EMPTY' }
  | {
      readonly kind: 'ACTIVE'
      readonly operation: RedaxTeamAdminMutationOperation
      readonly campaign: string
      readonly lifecycle:
        | 'PRE_RAW_SEND'
        | 'PRE_RAW_SEND_SIGNATURE_LOCAL_NOT_RETAINED'
        | 'KNOWN_SIGNATURE'
    }
  | {
      readonly kind: 'TOMBSTONE'
      readonly operation: RedaxTeamAdminMutationOperation
      readonly campaign: string
      readonly resolution: RedaxTeamAdminMutationResolution
    }

/**
 * What a FINISHED saved attempt means, in the four ways that actually differ here.
 *
 * THE THREE PROVEN-NO-EFFECT TERMINALS all establish that the intended mutation did not
 * take effect: nothing was broadcast, nothing landed, or the exact intended transaction
 * landed and FAILED. The third is where the honesty rule bites — a landed failure here
 * carries no exact program-error cause, so it proves NO EFFECT and never an expiry.
 * `ACCEPTED_SUPPORT_DISPOSITION` establishes nothing at all: it records that an
 * unresolved attempt was acknowledged, which is never permission.
 */
export type RedaxTeamAdminActivationTombstoneClass =
  | 'PROVEN_NO_EFFECT'
  | 'RESOLVED_MATCHING_IMMEDIATE_STATE'
  | 'RESOLVED_POST_STATE_SUPERSEDED'
  | 'SUPPORT_ONLY'

/** Classify one terminal. Exhaustive over the journal's closed resolution vocabulary. */
export function classifyRedaxTeamAdminActivationTombstone(
  resolution: RedaxTeamAdminMutationResolution,
): RedaxTeamAdminActivationTombstoneClass {
  switch (resolution) {
    case 'RESOLVED_PRE_RAW_SEND_NO_BROADCAST':
    case 'RESOLVED_FINALIZED_NO_LAND':
    // A GENERIC FINALIZED LANDED FAILURE. The exact intended transaction landed and the
    // program rejected it, so the Campaign did not move — which is exactly and only
    // "no effect". No cause travels with it, so no cause is claimed for it: it is never
    // `CampaignExpired`, never a closed window and never a permanent refusal. It is also
    // a REPLACEABLE journal terminal, so a fresh attempt stays possible — subject to a
    // new acknowledgement and to a fresh Phase A that re-reads the chain and its clock.
    case 'RESOLVED_FINALIZED_LANDED_FAILURE':
      return 'PROVEN_NO_EFFECT'
    case 'RESOLVED_MATCHING_IMMEDIATE_STATE':
      return 'RESOLVED_MATCHING_IMMEDIATE_STATE'
    case 'RESOLVED_LANDED_EXACT_POST_STATE_SUPERSEDED':
      return 'RESOLVED_POST_STATE_SUPERSEDED'
    case 'ACCEPTED_SUPPORT_DISPOSITION':
      return 'SUPPORT_ONLY'
    default: {
      const exhaustive: never = resolution
      return exhaustive
    }
  }
}

/** Is this record an `ACTIVATE_CAMPAIGN` record for exactly this campaign? */
function isThisCampaignActivationRecord(
  status: RedaxTeamAdminActivationStatusInput,
  campaignAddress: string | null,
): boolean {
  if (status.kind !== 'ACTIVE' && status.kind !== 'TOMBSTONE') {
    return false
  }
  if (status.operation !== 'ACTIVATE_CAMPAIGN') {
    return false
  }
  return campaignAddress !== null && status.campaign === campaignAddress
}

/** The matching local terminal class for this campaign's activation, or `null`. */
function localActivationTerminal(
  status: RedaxTeamAdminActivationStatusInput,
  campaignAddress: string | null,
): RedaxTeamAdminActivationTombstoneClass | null {
  if (status.kind !== 'TOMBSTONE' || !isThisCampaignActivationRecord(status, campaignAddress)) {
    return null
  }
  return classifyRedaxTeamAdminActivationTombstone(status.resolution)
}

// --- The disposition -----------------------------------------------------------------

/** Everything the activation disposition is decided from. Every input is injected. */
export interface RedaxTeamAdminActivationDispositionInput {
  /** Whether this deployment resolved both a Team carrier and a runtime program identity. */
  readonly deploymentConfigured: boolean
  /** Whether this surface established POSITIVE authority over the selected campaign. */
  readonly authorityConfirmed: boolean
  /** The campaign account's own stored address, or `null` when there is none to trust. */
  readonly campaignAddress: string | null
  /** The FRESH lifecycle status, or `null` when it has not been read that freshly. */
  readonly campaignStatus: string | null
  /** The FRESH `metadata_setup` flag, or `null` when it has not been read that freshly. */
  readonly campaignMetadataSetup: boolean | null
  /** The FRESH accepted-input count, or `null` when it has not been read that freshly. */
  readonly campaignTokenConfigCount: number | null
  /** The durable single attempt slot, as this surface last read it. */
  readonly status: RedaxTeamAdminActivationStatusInput
  /** Whether a frozen acknowledgement exists AND still matches the current context. */
  readonly acknowledgementCurrent: boolean
}

/** What the surface is, what refuses it, and what it may offer. */
export interface RedaxTeamAdminActivationDisposition {
  readonly state: RedaxTeamAdminActivationProductState
  readonly blocking: RedaxTeamAdminActivationBlockingCode | null
  /** The one-way activation may be offered. Requires `blocking === null` and nothing weaker. */
  readonly activateAdmissible: boolean
  /** The purely local, non-mutating review may be offered. */
  readonly reviewAdmissible: boolean
}

/** Is this a lifecycle status past the activation predecessor? */
function isPostActivationStatus(status: string | null): boolean {
  return (
    status !== null && (REDAX_TEAM_ADMIN_POST_ACTIVATION_STATUSES as readonly string[]).includes(status)
  )
}

/**
 * Why activation is refused, or `null`. FIRST reason wins, and the order is the argument:
 * configuration before authority, an attribution the product actually holds before one it
 * does not, the campaign's permanent lifecycle position before the journal, the operator's
 * own unfinished business before their next step, and chain truth before every product
 * prerequisite that would be judged against it.
 */
function activationBlockingFor(input: RedaxTeamAdminActivationDispositionInput): {
  readonly blocking: RedaxTeamAdminActivationBlockingCode | null
  readonly terminal: RedaxTeamAdminActivationTombstoneClass | null
} {
  const terminal = localActivationTerminal(input.status, input.campaignAddress)
  if (!input.deploymentConfigured) {
    return { blocking: 'DEPLOYMENT_NOT_CONFIGURED', terminal }
  }
  if (!input.authorityConfirmed) {
    return { blocking: 'CAMPAIGN_NOT_AUTHORIZED', terminal }
  }
  // AN ATTRIBUTION THIS PRODUCT ACTUALLY HOLDS. Only a matching local terminal for this
  // campaign's own `ACTIVATE_CAMPAIGN` attempt can say that this product activated it.
  if (
    terminal === 'RESOLVED_MATCHING_IMMEDIATE_STATE' ||
    terminal === 'RESOLVED_POST_STATE_SUPERSEDED'
  ) {
    return { blocking: 'ACTIVATION_ALREADY_ATTRIBUTED', terminal }
  }
  // AND ONE IT DOES NOT. A campaign observed active, paused or finalized is PAST the
  // activation predecessor and cannot be activated again — but nothing about that state
  // says who moved it there, so the refusal is named for what is actually known.
  if (isPostActivationStatus(input.campaignStatus)) {
    return { blocking: 'POST_ACTIVATION_STATE_UNATTRIBUTED', terminal }
  }
  if (terminal === 'SUPPORT_ONLY') {
    return { blocking: 'SUPPORT_DISPOSITION_BLOCKED', terminal }
  }
  if (input.status.kind === 'UNAVAILABLE') {
    return { blocking: 'MUTATION_STATUS_UNAVAILABLE', terminal }
  }
  if (input.status.kind === 'ACTIVE') {
    return {
      blocking: isThisCampaignActivationRecord(input.status, input.campaignAddress)
        ? 'SAVED_ATTEMPT_OUTSTANDING'
        : 'GLOBAL_MUTATION_SLOT_ACTIVE',
      terminal,
    }
  }
  // CHAIN TRUTH OR NOTHING. Every prerequisite below is judged against a freshly read
  // campaign; an unread one is not a campaign known to satisfy them.
  if (
    input.campaignStatus === null ||
    input.campaignMetadataSetup === null ||
    input.campaignTokenConfigCount === null
  ) {
    return { blocking: 'CHAIN_TRUTH_UNAVAILABLE', terminal }
  }
  if (input.campaignStatus !== REDAX_TEAM_ADMIN_ACTIVATION_PREDECESSOR_STATUS) {
    return { blocking: 'CAMPAIGN_NOT_INITIALIZED', terminal }
  }
  // A PROGRAM PREREQUISITE, MIRRORED. `activate_campaign` itself requires `metadata_setup`.
  if (input.campaignMetadataSetup !== true) {
    return { blocking: 'METADATA_NOT_SET', terminal }
  }
  // A PRODUCT PREREQUISITE, AND THE ONE PLACE THE PRODUCT IS STRONGER THAN THE PROGRAM.
  // The program has NO accepted-input requirement for activation; REDAX does, because
  // activation is one-way and `add_token_config` needs the `initialized` status this step
  // leaves behind. The mutation planner enforces the same rule against authority-grade
  // chain facts, so this surface's refusal is a courtesy and never the boundary.
  if (!Number.isSafeInteger(input.campaignTokenConfigCount) || input.campaignTokenConfigCount < 1) {
    return { blocking: 'NO_TOKEN_CONFIGS', terminal }
  }
  if (!input.acknowledgementCurrent) {
    return { blocking: 'NO_CURRENT_ACKNOWLEDGEMENT', terminal }
  }
  return { blocking: null, terminal }
}

/**
 * The activation product state, projected from the generic status — never a new one.
 *
 * The cascade is ordered so the most permanent fact wins: an activation this product can
 * actually attribute beats everything, a campaign past the predecessor beats the journal,
 * an acknowledged-unresolved attempt beats a fresh gesture, and only when nothing above
 * applies does the surface describe the step it is actually on.
 */
export function deriveRedaxTeamAdminActivationDisposition(
  input: RedaxTeamAdminActivationDispositionInput,
): RedaxTeamAdminActivationDisposition {
  const { blocking, terminal } = activationBlockingFor(input)
  const activateAdmissible = blocking === null

  let state: RedaxTeamAdminActivationProductState
  if (!input.deploymentConfigured) {
    state = 'NOT_CONFIGURED'
  } else if (!input.authorityConfirmed) {
    state = 'NOT_AUTHORIZED'
  } else if (terminal === 'RESOLVED_MATCHING_IMMEDIATE_STATE') {
    state = 'CAMPAIGN_ACTIVATED'
  } else if (terminal === 'RESOLVED_POST_STATE_SUPERSEDED') {
    state = 'ACTIVATION_SUPERSEDED'
  } else if (isPostActivationStatus(input.campaignStatus)) {
    state = 'POST_ACTIVATION_STATE_UNATTRIBUTED'
  } else if (terminal === 'SUPPORT_ONLY') {
    state = 'BLOCKED_SUPPORT'
  } else if (
    input.status.kind === 'ACTIVE' &&
    isThisCampaignActivationRecord(input.status, input.campaignAddress)
  ) {
    state = input.status.lifecycle === 'KNOWN_SIGNATURE' ? 'SUBMITTED_ATTEMPT' : 'SAVED_ATTEMPT'
  } else if (terminal === 'PROVEN_NO_EFFECT') {
    // A REPLACEABLE TERMINAL, DESCRIBED AS EXACTLY WHAT IT IS. The attempt took no proven
    // effect. Whether another one may be made is decided below by `blocking` — which
    // still demands fresh chain truth, every prerequisite and a NEW acknowledgement.
    state = 'NO_EFFECT_PROVEN'
  } else if (
    input.campaignStatus === null ||
    input.campaignMetadataSetup === null ||
    input.campaignTokenConfigCount === null
  ) {
    state = 'CHAIN_TRUTH_UNAVAILABLE'
  } else if (input.campaignStatus !== REDAX_TEAM_ADMIN_ACTIVATION_PREDECESSOR_STATUS) {
    state = 'NOT_INITIALIZED'
  } else if (input.campaignMetadataSetup !== true) {
    state = 'METADATA_NOT_SET'
  } else if (input.campaignTokenConfigCount < 1) {
    state = 'NO_TOKEN_CONFIGS'
  } else if (input.acknowledgementCurrent) {
    state = 'READY_FOR_ACTIVATION'
  } else {
    state = 'READY_FOR_ACKNOWLEDGEMENT'
  }

  // Review is LOCAL and mutates nothing, so it is offered wherever acknowledging is still
  // a sensible thing to be doing — and withheld once the answer is settled, unattributable
  // or waiting on an attempt, because offering it there would read as a way to try again.
  const reviewAdmissible =
    state === 'READY_FOR_ACKNOWLEDGEMENT' ||
    state === 'READY_FOR_ACTIVATION' ||
    state === 'NO_EFFECT_PROVEN'

  return Object.freeze({ state, blocking, activateAdmissible, reviewAdmissible })
}

// --- The read-only recovery projection ------------------------------------------------

/** What ONE recovered activation attempt is, after a reload. */
export type RedaxTeamAdminActivationRecoveryOutcome =
  | 'SAVED'
  | 'SUBMITTED'
  | 'CAMPAIGN_ACTIVATED'
  | 'ACTIVATION_SUPERSEDED'
  | 'NO_PROVEN_EFFECT'
  | 'EFFECT_WITHOUT_CHAIN_STATE'
  | 'SUPPORT_ONLY'
  | 'CHAIN_TRUTH_UNAVAILABLE'
  | 'STATE_INCONSISTENT'

/**
 * The ONE thing that survives a reload, projected. It is a REPORT and never a control.
 *
 * There is no submit, no retry and no acknowledgement inside it, and it carries the
 * campaign identity and nothing else — no signature, no digest and no durable record.
 */
export interface RedaxTeamAdminActivationRecoveryRow {
  readonly outcome: RedaxTeamAdminActivationRecoveryOutcome
  readonly campaign: string
}

/** Everything the recovery projection is decided from. */
export interface RedaxTeamAdminActivationRecoveryInput {
  readonly status: RedaxTeamAdminActivationStatusInput
  readonly campaignAddress: string | null
  readonly campaignStatus: string | null
}

/**
 * Project the durable slot into a recovery row, or `null`.
 *
 * `null` for an unread slot, an empty slot, a record for another campaign and a record
 * for any of the other five operations — none of those is an activation attempt, and
 * manufacturing an activation row out of one would be rendering a capability this slice
 * does not have.
 */
export function projectRedaxTeamAdminActivationRecoveryRow(
  input: RedaxTeamAdminActivationRecoveryInput,
): RedaxTeamAdminActivationRecoveryRow | null {
  const status = input.status
  if (!isThisCampaignActivationRecord(status, input.campaignAddress)) {
    return null
  }
  if (status.kind !== 'ACTIVE' && status.kind !== 'TOMBSTONE') {
    return null
  }
  const campaign = status.campaign
  if (status.kind === 'ACTIVE') {
    return Object.freeze({
      outcome: status.lifecycle === 'KNOWN_SIGNATURE' ? 'SUBMITTED' : 'SAVED',
      campaign,
    })
  }
  const settled = classifyRedaxTeamAdminActivationTombstone(status.resolution)
  if (settled === 'SUPPORT_ONLY') {
    return Object.freeze({ outcome: 'SUPPORT_ONLY', campaign })
  }
  if (input.campaignStatus === null) {
    return Object.freeze({ outcome: 'CHAIN_TRUTH_UNAVAILABLE', campaign })
  }
  if (settled === 'RESOLVED_MATCHING_IMMEDIATE_STATE') {
    return Object.freeze({
      outcome: isPostActivationStatus(input.campaignStatus)
        ? 'CAMPAIGN_ACTIVATED'
        : 'EFFECT_WITHOUT_CHAIN_STATE',
      campaign,
    })
  }
  if (settled === 'RESOLVED_POST_STATE_SUPERSEDED') {
    return Object.freeze({
      outcome: isPostActivationStatus(input.campaignStatus)
        ? 'ACTIVATION_SUPERSEDED'
        : 'EFFECT_WITHOUT_CHAIN_STATE',
      campaign,
    })
  }
  // PROVEN_NO_EFFECT. A campaign that has nevertheless left `initialized` is a conflict
  // rather than a clean nothing-happened — and it is REPORTED rather than reconciled,
  // because this surface cannot tell which route moved it.
  if (input.campaignStatus !== REDAX_TEAM_ADMIN_ACTIVATION_PREDECESSOR_STATUS) {
    return Object.freeze({ outcome: 'STATE_INCONSISTENT', campaign })
  }
  return Object.freeze({ outcome: 'NO_PROVEN_EFFECT', campaign })
}
