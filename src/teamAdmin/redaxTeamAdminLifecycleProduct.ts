// -----------------------------------------------------------------------------
// WHAT THIS FILE IS
// -----------------------------------------------------------------------------
// The PURE product half of the LAST three post-init operations: the two axes a lifecycle
// surface is described by, the per-action eligibility those axes produce, the memory-only
// frozen acknowledgement a terminal Finalize is taken from, and one read-only recovery
// projection.
//
// It is a LEAF. There is no React and no JSX here, no `@solana/web3.js`, no `PublicKey`,
// no `Connection`, no `Transaction`, no `TransactionInstruction`, no RPC, no wallet, no
// broker, no signing, no sending, no journal write, no storage, no Web Lock and no
// environment read of any kind.
//
// A campaign's CURRENT CHAIN STATE and this product's LOCAL ATTRIBUTION are separate
// questions and they are modelled separately, because collapsing them is how a surface
// starts claiming credit for something it never did.
//
//   CURRENT CHAIN STATE answers "what is this campaign right now". It comes from a
//   campaign reading and says NOTHING about who moved it there.
//
//   LOCAL ATTRIBUTION answers "what did THIS product's own durable attempt do". It comes
//   from the single durable mutation record and is the ONLY thing that may ever produce a
//   `PAUSE_CONFIRMED`, an `UNPAUSE_CONFIRMED` or a `FINALIZE_CONFIRMED`.
//
// So a campaign that reads `paused` with no matching local record is reported as CURRENTLY
// PAUSED and never as "we paused it" — and, crucially, it stays ELIGIBLE for Unpause and
// for Finalize review, because eligibility follows the current status and not the story.
//
// There is deliberately NO `NEXT_ACTION` enum here, because more than one gesture is
// legal at once. An `active` campaign may be paused AND may be reviewed for finalization;
// a `paused` campaign may be unpaused AND may be reviewed for finalization. A single-value
// model would have had to pick one and hide the other.
//
// `active → paused → active → paused` is a legal sequence of DISTINCT occurrences, and
// none of the later ones is a retry of an earlier one: each is admitted by the CURRENT
// predecessor status the chain reports at the moment it is attempted. There is no cycle
// counter here, no persistent cycle state and no "try again" anywhere — a retry affordance
// would be an offer to resend a transaction whose fate is unknown, which this corridor
// never does.
//
// Finalize is terminal. It has TWO admissible predecessors — `active` and `paused` — and
// the mutation identity records WHICH one was observed, so a Finalize reviewed from
// `active` and a Finalize reviewed from `paused` are different attempts. That is exactly
// why `campaignStatus` is bound into the acknowledgement below.
//
// -----------------------------------------------------------------------------
// WHAT THIS FILE MAY NOT DECIDE
// -----------------------------------------------------------------------------
// Nothing here is a security boundary. The mutation action root re-reads the campaign at
// authority grade, its planner re-decides admissibility against that reading, and its
// chain guard independently refuses an approved Team wallet that IS a custody authority —
// the protocol fee authority, the protocol emergency-pause authority or the program
// upgrade authority. This module never receives any of those three values, cannot compare
// against them, and cannot report which one refused an attempt.

import type { RedaxTeamAdminMutationOperation } from './redaxTeamAdminMutationIdentity'
import type { RedaxTeamAdminMutationResolution } from './redaxTeamAdminMutationJournal'

// --- The three operations this surface owns ---------------------------------------

/**
 * The THREE post-init operations this product exposes, and there is no fourth.
 *
 * `ADD_TOKEN_CONFIG`, `SETUP_METADATA` and `ACTIVATE_CAMPAIGN` belong to the three sibling
 * panels and are not spellable as a request anywhere on this surface.
 */
export const REDAX_TEAM_ADMIN_LIFECYCLE_OPERATIONS = [
  'PAUSE_CAMPAIGN',
  'UNPAUSE_CAMPAIGN',
  'FINALIZE_CAMPAIGN',
] as const

/** One lifecycle operation. */
export type RedaxTeamAdminLifecycleOperation =
  (typeof REDAX_TEAM_ADMIN_LIFECYCLE_OPERATIONS)[number]

/**
 * The statuses each lifecycle operation may legally be attempted FROM.
 *
 * MIRRORED from the program's own rule rather than invented: `pause_campaign` requires
 * `active`, `unpause_campaign` requires `paused`, and `finalize_campaign` accepts either.
 * The mutation planner enforces the same table against authority-grade chain facts, so a
 * refusal here is a courtesy and never the boundary.
 */
export const REDAX_TEAM_ADMIN_LIFECYCLE_PREDECESSORS: Readonly<
  Record<RedaxTeamAdminLifecycleOperation, readonly string[]>
> = Object.freeze({
  PAUSE_CAMPAIGN: Object.freeze(['active'] as const),
  UNPAUSE_CAMPAIGN: Object.freeze(['paused'] as const),
  FINALIZE_CAMPAIGN: Object.freeze(['active', 'paused'] as const),
})

/** The status each lifecycle operation moves the campaign TO. */
export const REDAX_TEAM_ADMIN_LIFECYCLE_TARGETS: Readonly<
  Record<RedaxTeamAdminLifecycleOperation, string>
> = Object.freeze({
  PAUSE_CAMPAIGN: 'paused',
  UNPAUSE_CAMPAIGN: 'active',
  FINALIZE_CAMPAIGN: 'finalized',
})

/** Is this operation one of the three this surface owns? Total over the closed six. */
export function isRedaxTeamAdminLifecycleOperation(
  operation: RedaxTeamAdminMutationOperation,
): operation is RedaxTeamAdminLifecycleOperation {
  return (REDAX_TEAM_ADMIN_LIFECYCLE_OPERATIONS as readonly string[]).includes(operation)
}

// --- AXIS 1: the campaign's CURRENT chain state ------------------------------------

/**
 * `UNAVAILABLE` is the honest fifth member and is not a state a campaign is in: it is this
 * product declining to name one, because a reading it does not have is not a reading that
 * said `initialized`. Everything downstream fails closed on it.
 */
export const REDAX_TEAM_ADMIN_LIFECYCLE_CHAIN_STATES = [
  'INITIALIZED',
  'ACTIVE',
  'PAUSED',
  'FINALIZED',
  'UNAVAILABLE',
] as const

/** One current-chain state. */
export type RedaxTeamAdminLifecycleChainState =
  (typeof REDAX_TEAM_ADMIN_LIFECYCLE_CHAIN_STATES)[number]

/**
 * Project an observed lifecycle status onto the current-chain axis. TOTAL and fail-closed.
 *
 * `null` and any status this product does not recognise both answer `UNAVAILABLE` rather
 * than being guessed at. A status nobody decided the meaning of is not a status.
 */
export function deriveRedaxTeamAdminLifecycleChainState(
  campaignStatus: string | null,
): RedaxTeamAdminLifecycleChainState {
  switch (campaignStatus) {
    case 'initialized':
      return 'INITIALIZED'
    case 'active':
      return 'ACTIVE'
    case 'paused':
      return 'PAUSED'
    case 'finalized':
      return 'FINALIZED'
    default:
      return 'UNAVAILABLE'
  }
}

// --- AXIS 2: this product's LOCAL attribution ---------------------------------------

/**
 * What THIS product's own durable attempt did. Never what the campaign is.
 *
 * THERE IS NO `FAILED` AND NO `RETRY`. An attempt whose outcome is unknown has not failed,
 * and an attempt that took no proven effect is over rather than repeatable-by-right — a
 * later legal occurrence is a fresh decision the live chain has to admit again.
 *
 * `SUPERSEDED` is the member that makes repeatability honest: a Pause that genuinely
 * landed, followed by a legal Unpause, leaves a record whose expected status is no longer
 * current. That is not a failure, not a conflict and not an invitation to resend.
 */
export const REDAX_TEAM_ADMIN_LIFECYCLE_ATTRIBUTIONS = [
  'EMPTY',
  'SAVED',
  'SUBMITTED',
  'PAUSE_CONFIRMED',
  'UNPAUSE_CONFIRMED',
  'FINALIZE_CONFIRMED',
  'SUPERSEDED',
  'NO_EFFECT_PROVEN',
  'SUPPORT',
  'CHAIN_TRUTH_UNAVAILABLE',
  'STATE_INCONSISTENT',
] as const

/** One local attribution. */
export type RedaxTeamAdminLifecycleAttribution =
  (typeof REDAX_TEAM_ADMIN_LIFECYCLE_ATTRIBUTIONS)[number]

/**
 * Why NO lifecycle mutation may be attempted at all, or `null`.
 *
 * A GLOBAL gate reason. It is deliberately NOT per action: which of the three gestures a
 * given status admits is the current-chain axis's job, and mixing the two is what produces
 * a surface that refuses Unpause because it once tried to Pause.
 *
 * There is no `CAMPAIGN_EXPIRED` and no `DEADLINE_PASSED` member. This module holds no
 * chain time, and a deadline changes no lifecycle status.
 */
export type RedaxTeamAdminLifecycleBlockingCode =
  | 'DEPLOYMENT_NOT_CONFIGURED'
  | 'CAMPAIGN_NOT_AUTHORIZED'
  | 'SUPPORT_DISPOSITION_BLOCKED'
  | 'LOCAL_RECORD_STATE_INCONSISTENT'
  | 'MUTATION_STATUS_UNAVAILABLE'
  | 'SAVED_ATTEMPT_OUTSTANDING'
  | 'GLOBAL_MUTATION_SLOT_ACTIVE'
  | 'CHAIN_TRUTH_UNAVAILABLE'
  | 'CAMPAIGN_NOT_ACTIVATED'
  | 'CAMPAIGN_FINALIZED'

// --- The frozen Finalize acknowledgement --------------------------------------------

/**
 * Everything a FINALIZE acknowledgement is bound TO. SEVEN facts, every one public.
 *
 * PAUSE AND UNPAUSE HAVE NO ACKNOWLEDGEMENT, by decision. Both are reversible by a later
 * explicit campaign-admin gesture, so freezing a review for them would be ceremony without
 * a hazard behind it. Finalize is terminal, and terminal is what an acknowledgement is for.
 *
 * `campaignStatus` IS LOAD-BEARING, and it is the only field here that is not obviously so.
 * Finalize-from-`active` and Finalize-from-`paused` are DIFFERENT mutation identities — the
 * planner records the observed predecessor — so a review taken while the campaign was
 * `active` is not an approval of a Finalize submitted while it is `paused`. Binding the
 * status is what makes that a refusal rather than a silent substitution.
 *
 * WHAT IS DELIBERATELY ABSENT is as much of the decision as what is present. There is no
 * `campaignEndTs`, no `campaignTokenConfigCount`, no `campaignMetadataSetup`, no
 * `totalOutputMinted`, no `totalProtocolFeesMinted`, no journal revision, no attempt nonce,
 * no mutation identity, no signature, no blockhash and no clock. The holder-traffic
 * counters are excluded ON PURPOSE: binding them would let ordinary, expected conversion
 * traffic silently destroy a terminal approval an operator had just given, which is a
 * worse failure than the race it would be trying to close.
 */
export interface RedaxTeamAdminLifecycleFinalizeAcknowledgementContext {
  /** The RAW explicit selection, never the loader's fallback. */
  readonly rawSelectedCampaignId: string
  /** The campaign the loader actually resolved. Admission requires the two agree. */
  readonly effectiveSelectedCampaignId: string
  /** The campaign account's OWN stored address. */
  readonly campaignAddress: string
  /** The campaign's stored admin, which must be the approved Team wallet. */
  readonly campaignAdmin: string
  /** The observed lifecycle status — the EXACT Finalize predecessor being approved. */
  readonly campaignStatus: string
  /** The configured approved-Team identity. A deployment fact, never the connected wallet. */
  readonly approvedTeamWallet: string
  /** The canonical runtime program identity. */
  readonly programId: string
}

/**
 * The comparison below is DRIVEN BY THIS LIST rather than written out field by field, so a
 * member that exists in the interface and not here cannot silently stop being compared.
 */
export const REDAX_TEAM_ADMIN_LIFECYCLE_FINALIZE_ACK_CONTEXT_FIELDS = [
  'rawSelectedCampaignId',
  'effectiveSelectedCampaignId',
  'campaignAddress',
  'campaignAdmin',
  'campaignStatus',
  'approvedTeamWallet',
  'programId',
] as const satisfies readonly (keyof RedaxTeamAdminLifecycleFinalizeAcknowledgementContext)[]

/** The raw facts a context is built from. Any missing one refuses the whole context. */
export interface RedaxTeamAdminLifecycleFinalizeAcknowledgementContextInput {
  readonly rawSelectedCampaignId: string
  readonly effectiveSelectedCampaignId: string
  readonly campaignAddress: string | null
  readonly campaignAdmin: string | null
  readonly campaignStatus: string | null
  readonly approvedTeamWallet: string | null
  readonly programId: string | null
}

/**
 * Build the immutable Finalize acknowledgement context, or refuse.
 *
 * EVERY FACT MUST BE PRESENT AND POSITIVE. An absent stored address, an absent admin, an
 * unresolved program id and an unreadable status are all refusals — a view that OMITTED a
 * field is not a view that agreed with anything.
 *
 * THE PRECONDITIONS ARE PART OF THE CONTEXT rather than checked beside it: an
 * acknowledgement may only be taken from a status Finalize is actually admissible from, so
 * a snapshot that exists at all is a snapshot of a finalizable situation.
 */
export function buildRedaxTeamAdminLifecycleFinalizeAcknowledgementContext(
  input: RedaxTeamAdminLifecycleFinalizeAcknowledgementContextInput,
): RedaxTeamAdminLifecycleFinalizeAcknowledgementContext | null {
  if (
    input.campaignAddress === null ||
    input.campaignAdmin === null ||
    input.campaignStatus === null ||
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
  if (!REDAX_TEAM_ADMIN_LIFECYCLE_PREDECESSORS.FINALIZE_CAMPAIGN.includes(input.campaignStatus)) {
    return null
  }
  return Object.freeze({
    rawSelectedCampaignId: input.rawSelectedCampaignId,
    effectiveSelectedCampaignId: input.effectiveSelectedCampaignId,
    campaignAddress: input.campaignAddress,
    campaignAdmin: input.campaignAdmin,
    campaignStatus: input.campaignStatus,
    approvedTeamWallet: input.approvedTeamWallet,
    programId: input.programId,
  })
}

/**
 * IT CARRIES NO BYTES, no adapter, no `Connection`, no `Transaction`, no wire, no message,
 * no blockhash, no signature, no journal revision and no durable record — there is no
 * member any of them could travel in. It is MEMORY ONLY: it lives in one component's
 * state, no `localStorage`, `sessionStorage`, IndexedDB or Web Lock is involved, and a
 * reload discards it. What survives a reload is the durable attempt and whatever the chain
 * holds, and both are read back rather than remembered.
 *
 * `acknowledgementGeneration` is a LOCAL MONOTONIC INTEGER and is not a chain fact. It is
 * not a clock, not entropy, not a UUID and not a cycle counter; it exists so a snapshot is
 * bound to the exact review it came from rather than to a situation that merely looks the
 * same again later.
 */
export interface RedaxTeamAdminLifecycleFinalizeAcknowledgementSnapshot {
  readonly acknowledgementGeneration: number
  readonly context: RedaxTeamAdminLifecycleFinalizeAcknowledgementContext
}

/** Freeze one reviewed context into a Finalize acknowledgement snapshot. */
export function createRedaxTeamAdminLifecycleFinalizeAcknowledgementSnapshot(
  acknowledgementGeneration: number,
  context: RedaxTeamAdminLifecycleFinalizeAcknowledgementContext,
): RedaxTeamAdminLifecycleFinalizeAcknowledgementSnapshot {
  return Object.freeze({ acknowledgementGeneration, context })
}

/** Field-by-field context equality, driven by the pinned seven-field list. */
function finalizeContextsAgree(
  left: RedaxTeamAdminLifecycleFinalizeAcknowledgementContext,
  right: RedaxTeamAdminLifecycleFinalizeAcknowledgementContext,
): boolean {
  for (const field of REDAX_TEAM_ADMIN_LIFECYCLE_FINALIZE_ACK_CONTEXT_FIELDS) {
    if (left[field] !== right[field]) {
      return false
    }
  }
  return true
}

/**
 * TOTAL AND CONSERVATIVE. An absent snapshot, an absent current context, a changed
 * generation and ANY changed context field all answer `false` — which is what a campaign
 * reselection, a fallback that stopped agreeing, a changed stored address, a changed admin,
 * an `active → paused` transition, a `paused → active` transition, a changed approved-Team
 * carrier and a changed program identity each reduce to.
 *
 * THE SNAPSHOT IS DESTROYED BY THE CALLER RATHER THAN REPAIRED HERE: this answers a
 * question and rewrites nothing. There is no partial update and no closest match.
 */
export function isRedaxTeamAdminLifecycleFinalizeAcknowledgementCurrent(
  snapshot: RedaxTeamAdminLifecycleFinalizeAcknowledgementSnapshot | null,
  context: RedaxTeamAdminLifecycleFinalizeAcknowledgementContext | null,
  acknowledgementGeneration: number,
): boolean {
  if (snapshot === null || context === null) {
    return false
  }
  if (snapshot.acknowledgementGeneration !== acknowledgementGeneration) {
    return false
  }
  return finalizeContextsAgree(snapshot.context, context)
}

/**
 * The EXACT values one `FINALIZE_CAMPAIGN` request carries.
 *
 * ONE function produces them and the preview renders THE SAME snapshot field, so "what was
 * acknowledged is what is requested" is true by construction rather than by two code paths
 * agreeing. Nothing is normalized, defaulted or repaired here.
 */
export interface RedaxTeamAdminLifecycleSubmitValues {
  readonly campaign: string
}

/** Project the frozen snapshot into the exact request values. No transformation. */
export function redaxTeamAdminLifecycleFinalizeSubmitValuesFromSnapshot(
  snapshot: RedaxTeamAdminLifecycleFinalizeAcknowledgementSnapshot,
): RedaxTeamAdminLifecycleSubmitValues {
  return Object.freeze({ campaign: snapshot.context.campaignAddress })
}

// --- The durable slot, as this surface reads it -------------------------------------

/**
 * The sanitized status projection, folded into a structural input.
 *
 * A read that has not happened, and a read that failed, are BOTH `UNAVAILABLE`: an unread
 * slot is not a slot known to be empty, and nothing is offered until it has actually been
 * read.
 *
 * THE RECORD MAY BE FOR ANY OF THE SIX OPERATIONS AND FOR ANY CAMPAIGN. There is exactly
 * one durable slot for the approved Team wallet, so what is found here is frequently not a
 * lifecycle record at all — and this surface renders what was actually found rather than
 * relabelling it because a lifecycle button was the thing that asked.
 */
export type RedaxTeamAdminLifecycleStatusInput =
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
 * What a FINISHED saved attempt establishes. FOUR classes over the closed resolution set.
 *
 * THE TWO WITH-EFFECT TERMINALS ARE FOLDED INTO ONE HERE, and that is the right fold for
 * this surface: both establish that the exact intended transaction LANDED, and which of
 * the two the journal recorded is a statement about the immediate post-state it observed
 * rather than about the campaign now. What the campaign is now is the other axis's job,
 * and it is read separately.
 *
 * THE THREE PROVEN-NO-EFFECT TERMINALS all establish that the intended mutation did not
 * take effect: nothing was broadcast, nothing landed, or the exact intended transaction
 * landed and FAILED. The third is where the honesty rule bites — a landed failure carries
 * no exact program-error cause, so it proves NO EFFECT and never a `WrongCampaignStatus`,
 * an `Unauthorized` or a `CampaignExpired`. `ACCEPTED_SUPPORT_DISPOSITION` establishes
 * nothing at all: it records that an unresolved attempt was acknowledged, which is never
 * permission.
 */
export type RedaxTeamAdminLifecycleTombstoneClass =
  | 'PROVEN_NO_EFFECT'
  | 'LANDED_EXACT'
  | 'SUPPORT_ONLY'

/** Classify one terminal. Exhaustive over the journal's closed resolution vocabulary. */
export function classifyRedaxTeamAdminLifecycleTombstone(
  resolution: RedaxTeamAdminMutationResolution,
): RedaxTeamAdminLifecycleTombstoneClass {
  switch (resolution) {
    case 'RESOLVED_PRE_RAW_SEND_NO_BROADCAST':
    case 'RESOLVED_FINALIZED_NO_LAND':
    // A GENERIC FINALIZED LANDED FAILURE. The exact intended transaction landed and the
    // program rejected it, so the campaign did not move — which is exactly and only "no
    // effect". No cause travels with it, so no cause is claimed for it. It is also a
    // REPLACEABLE journal terminal, so a fresh occurrence stays possible — subject to a
    // fresh Phase A that re-reads the chain and re-decides admissibility from it.
    case 'RESOLVED_FINALIZED_LANDED_FAILURE':
      return 'PROVEN_NO_EFFECT'
    case 'RESOLVED_MATCHING_IMMEDIATE_STATE':
    case 'RESOLVED_LANDED_EXACT_POST_STATE_SUPERSEDED':
      return 'LANDED_EXACT'
    case 'ACCEPTED_SUPPORT_DISPOSITION':
      return 'SUPPORT_ONLY'
    default: {
      const exhaustive: never = resolution
      return exhaustive
    }
  }
}

/** Is this record a LIFECYCLE record for exactly this campaign? */
function isThisCampaignLifecycleRecord(
  status: RedaxTeamAdminLifecycleStatusInput,
  campaignAddress: string | null,
): boolean {
  if (status.kind !== 'ACTIVE' && status.kind !== 'TOMBSTONE') {
    return false
  }
  if (!isRedaxTeamAdminLifecycleOperation(status.operation)) {
    return false
  }
  return campaignAddress !== null && status.campaign === campaignAddress
}

/**
 * The table is the whole argument, and every row is about what is KNOWN rather than what
 * would be convenient:
 *
 *   PAUSE landed + currently `paused`               → this product paused it.
 *   PAUSE landed + currently `active` or `finalized` → it paused it, and the campaign has
 *                                                      since legally moved on. SUPERSEDED,
 *                                                      not a failure and not a retry cue.
 *   UNPAUSE landed + currently `active`             → this product unpaused it.
 *   UNPAUSE landed + currently `paused`/`finalized` → SUPERSEDED, on the same reasoning.
 *   FINALIZE landed + currently `finalized`         → this product finalized it.
 *   FINALIZE landed + anything else                 → INCONSISTENT. Finalize is terminal;
 *                                                     there is no legal state after it, so
 *                                                     a disagreement is reported rather
 *                                                     than explained away.
 *
 * An unread current state answers `CHAIN_TRUTH_UNAVAILABLE` rather than guessing, and any
 * remaining combination — a lifecycle terminal against an `initialized` campaign — is
 * `STATE_INCONSISTENT`, because no legal route produces it.
 */
function attributeLandedLifecycleTerminal(
  operation: RedaxTeamAdminLifecycleOperation,
  chainState: RedaxTeamAdminLifecycleChainState,
): RedaxTeamAdminLifecycleAttribution {
  if (chainState === 'UNAVAILABLE') {
    return 'CHAIN_TRUTH_UNAVAILABLE'
  }
  if (operation === 'PAUSE_CAMPAIGN') {
    if (chainState === 'PAUSED') {
      return 'PAUSE_CONFIRMED'
    }
    return chainState === 'ACTIVE' || chainState === 'FINALIZED'
      ? 'SUPERSEDED'
      : 'STATE_INCONSISTENT'
  }
  if (operation === 'UNPAUSE_CAMPAIGN') {
    if (chainState === 'ACTIVE') {
      return 'UNPAUSE_CONFIRMED'
    }
    return chainState === 'PAUSED' || chainState === 'FINALIZED'
      ? 'SUPERSEDED'
      : 'STATE_INCONSISTENT'
  }
  return chainState === 'FINALIZED' ? 'FINALIZE_CONFIRMED' : 'STATE_INCONSISTENT'
}

// --- The disposition -----------------------------------------------------------------

/** Everything the lifecycle disposition is decided from. Every input is injected. */
export interface RedaxTeamAdminLifecycleDispositionInput {
  /** Whether this deployment resolved both a Team carrier and a runtime program identity. */
  readonly deploymentConfigured: boolean
  /** Whether this surface established POSITIVE authority over the selected campaign. */
  readonly authorityConfirmed: boolean
  /** The campaign account's own stored address, or `null` when there is none to trust. */
  readonly campaignAddress: string | null
  /** The lifecycle status this render rests on, or `null` when there is no reading. */
  readonly campaignStatus: string | null
  /**
   * Whether the status above came from a SUCCESSFUL fresh campaign-only read of the exact
   * current selection. A loaded snapshot is display truth and answers `false`.
   */
  readonly freshStatusRead: boolean
  /** The durable single attempt slot, as this surface last read it. */
  readonly status: RedaxTeamAdminLifecycleStatusInput
  /** Whether a frozen Finalize acknowledgement exists AND still matches the current context. */
  readonly finalizeAcknowledgementCurrent: boolean
}

/**
 * What the surface is, what refuses it, and which of the three gestures it may offer.
 *
 * `pauseAdmissible`, `unpauseAdmissible` and `finalizeReviewAdmissible` are INDEPENDENT
 * booleans on purpose. At `ACTIVE` two of them are true at once, and at `PAUSED` two
 * different ones are — a single-value "next action" would have had to suppress one.
 */
export interface RedaxTeamAdminLifecycleDisposition {
  /** AXIS 1 — what the campaign is. Never an attribution. */
  readonly chainState: RedaxTeamAdminLifecycleChainState
  /** AXIS 2 — what this product's own attempt did. Never a chain state. */
  readonly attribution: RedaxTeamAdminLifecycleAttribution
  /** The GLOBAL gate reason, or `null`. Not per action. */
  readonly blocking: RedaxTeamAdminLifecycleBlockingCode | null
  readonly pauseAdmissible: boolean
  readonly unpauseAdmissible: boolean
  /** The purely local, non-mutating review may be offered. Requires a FRESH reading. */
  readonly finalizeReviewAdmissible: boolean
  /** The terminal step may be offered. Requires a CURRENT acknowledgement as well. */
  readonly finalizeSubmitAdmissible: boolean
  /** True when review is admissible and nothing current has been acknowledged yet. */
  readonly finalizeAcknowledgementRequired: boolean
}

/**
 * The local attribution for this campaign, from the durable slot alone.
 *
 * `EMPTY` for an unread slot, an empty slot, a record for another campaign and a record for
 * any of the three NON-lifecycle operations — none of those is this campaign's lifecycle
 * attempt, and manufacturing an attribution out of one would be claiming a capability this
 * surface does not have.
 */
function lifecycleAttributionFor(
  input: RedaxTeamAdminLifecycleDispositionInput,
  chainState: RedaxTeamAdminLifecycleChainState,
): RedaxTeamAdminLifecycleAttribution {
  const status = input.status
  if (!isThisCampaignLifecycleRecord(status, input.campaignAddress)) {
    return 'EMPTY'
  }
  if (status.kind === 'ACTIVE') {
    return status.lifecycle === 'KNOWN_SIGNATURE' ? 'SUBMITTED' : 'SAVED'
  }
  if (status.kind !== 'TOMBSTONE') {
    return 'EMPTY'
  }
  const settled = classifyRedaxTeamAdminLifecycleTombstone(status.resolution)
  if (settled === 'SUPPORT_ONLY') {
    return 'SUPPORT'
  }
  if (settled === 'PROVEN_NO_EFFECT') {
    return 'NO_EFFECT_PROVEN'
  }
  // LANDED_EXACT. Only here may this product claim it moved the campaign, and only against
  // the state the campaign is actually in right now.
  if (!isRedaxTeamAdminLifecycleOperation(status.operation)) {
    return 'EMPTY'
  }
  return attributeLandedLifecycleTerminal(status.operation, chainState)
}

/**
 * Why NO lifecycle mutation may be attempted, or `null`. FIRST reason wins, and the order
 * is the argument: configuration before authority, an outcome that needs a human before
 * one that needs a reading, the durable slot before the campaign, and the campaign's own
 * lifecycle position last — because that is the one the per-action booleans below refine
 * rather than veto.
 */
function lifecycleBlockingFor(
  input: RedaxTeamAdminLifecycleDispositionInput,
  chainState: RedaxTeamAdminLifecycleChainState,
  attribution: RedaxTeamAdminLifecycleAttribution,
): RedaxTeamAdminLifecycleBlockingCode | null {
  if (!input.deploymentConfigured) {
    return 'DEPLOYMENT_NOT_CONFIGURED'
  }
  if (!input.authorityConfirmed) {
    return 'CAMPAIGN_NOT_AUTHORIZED'
  }
  if (attribution === 'SUPPORT') {
    return 'SUPPORT_DISPOSITION_BLOCKED'
  }
  // A DURABLE RECORD THAT DISAGREES WITH THE CHAIN. Reported and failed closed rather than
  // reconciled: this surface cannot tell which of the two is wrong.
  if (attribution === 'STATE_INCONSISTENT') {
    return 'LOCAL_RECORD_STATE_INCONSISTENT'
  }
  if (input.status.kind === 'UNAVAILABLE') {
    return 'MUTATION_STATUS_UNAVAILABLE'
  }
  if (input.status.kind === 'ACTIVE') {
    return isThisCampaignLifecycleRecord(input.status, input.campaignAddress)
      ? 'SAVED_ATTEMPT_OUTSTANDING'
      : 'GLOBAL_MUTATION_SLOT_ACTIVE'
  }
  if (chainState === 'UNAVAILABLE') {
    return 'CHAIN_TRUTH_UNAVAILABLE'
  }
  if (chainState === 'INITIALIZED') {
    return 'CAMPAIGN_NOT_ACTIVATED'
  }
  if (chainState === 'FINALIZED') {
    return 'CAMPAIGN_FINALIZED'
  }
  return null
}

/**
 * The lifecycle disposition. Two axes, one global gate, four independent affordances.
 */
export function deriveRedaxTeamAdminLifecycleDisposition(
  input: RedaxTeamAdminLifecycleDispositionInput,
): RedaxTeamAdminLifecycleDisposition {
  const chainState = deriveRedaxTeamAdminLifecycleChainState(input.campaignStatus)
  const attribution = lifecycleAttributionFor(input, chainState)
  const blocking = lifecycleBlockingFor(input, chainState, attribution)
  const gateOpen = blocking === null

  const pauseAdmissible = gateOpen && chainState === 'ACTIVE'
  const unpauseAdmissible = gateOpen && chainState === 'PAUSED'
  // REVIEW IS STRICTLY STRONGER THAN THE OTHER TWO, by decision. Pause and Unpause are
  // reversible by a later explicit gesture and take their own fresh reading immediately
  // before they submit; Finalize is terminal, so the situation an operator freezes must
  // itself have come from a successful fresh campaign-only read of the exact selection.
  // A LOADED snapshot may be displayed and may never arm this.
  const finalizeReviewAdmissible =
    gateOpen && input.freshStatusRead && (chainState === 'ACTIVE' || chainState === 'PAUSED')
  const finalizeSubmitAdmissible =
    finalizeReviewAdmissible && input.finalizeAcknowledgementCurrent

  return Object.freeze({
    chainState,
    attribution,
    blocking,
    pauseAdmissible,
    unpauseAdmissible,
    finalizeReviewAdmissible,
    finalizeSubmitAdmissible,
    finalizeAcknowledgementRequired:
      finalizeReviewAdmissible && !input.finalizeAcknowledgementCurrent,
  })
}

// --- The read-only recovery projection ------------------------------------------------

/**
 * The ONE thing that survives a reload, projected. It is a REPORT and never a control.
 *
 * There is no submit, no retry and no acknowledgement inside it, and it carries the
 * operation and the campaign identity and nothing else — no signature, no digest and no
 * durable record. It reuses the ATTRIBUTION vocabulary rather than minting a parallel one,
 * so "what the recovered attempt was" and "what this surface claims" cannot drift apart.
 */
export interface RedaxTeamAdminLifecycleRecoveryRow {
  readonly attribution: RedaxTeamAdminLifecycleAttribution
  readonly operation: RedaxTeamAdminLifecycleOperation
  readonly campaign: string
}

/** Everything the recovery projection is decided from. */
export interface RedaxTeamAdminLifecycleRecoveryInput {
  readonly status: RedaxTeamAdminLifecycleStatusInput
  readonly campaignAddress: string | null
  readonly campaignStatus: string | null
}

/**
 * Project the durable slot into a lifecycle recovery row, or `null`.
 *
 * `null` for an unread slot, an empty slot, a record for another campaign and a record for
 * any of the other three operations. A row is never manufactured out of a sibling's record.
 */
export function projectRedaxTeamAdminLifecycleRecoveryRow(
  input: RedaxTeamAdminLifecycleRecoveryInput,
): RedaxTeamAdminLifecycleRecoveryRow | null {
  const status = input.status
  if (!isThisCampaignLifecycleRecord(status, input.campaignAddress)) {
    return null
  }
  if (status.kind !== 'ACTIVE' && status.kind !== 'TOMBSTONE') {
    return null
  }
  if (!isRedaxTeamAdminLifecycleOperation(status.operation)) {
    return null
  }
  const chainState = deriveRedaxTeamAdminLifecycleChainState(input.campaignStatus)
  const attribution = lifecycleAttributionFor(
    {
      deploymentConfigured: true,
      authorityConfirmed: true,
      campaignAddress: input.campaignAddress,
      campaignStatus: input.campaignStatus,
      freshStatusRead: false,
      status,
      finalizeAcknowledgementCurrent: false,
    },
    chainState,
  )
  if (attribution === 'EMPTY') {
    return null
  }
  return Object.freeze({ attribution, operation: status.operation, campaign: status.campaign })
}
