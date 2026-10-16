// -----------------------------------------------------------------------------
// WHAT THIS FILE IS
// -----------------------------------------------------------------------------
// The FIFTH visible Team/Admin surface, and the FOURTH operation consumer of the ONE
// post-init mutation action root. It is a SIBLING of the campaign setup panel, the
// campaign metadata panel and the campaign activation panel under the same provider — not
// a second provider, not a second raw-send owner, not a second wallet broker, not a second
// journal and not a new storage owner.
//
// It is the ONLY panel that owns more than one operation, and it owns exactly THREE:
// `PAUSE_CAMPAIGN`, `UNPAUSE_CAMPAIGN` and `FINALIZE_CAMPAIGN`. `ADD_TOKEN_CONFIG`,
// `SETUP_METADATA` and `ACTIVATE_CAMPAIGN` belong to its three siblings, are not named in
// any request this file builds, and no control here can reach one. With this panel mounted
// the product exposes all six post-init operations and leaves none intentionally hidden —
// which is a statement about SOURCE, and about nothing else.
//
// -----------------------------------------------------------------------------
// THREE OPERATIONS, TWO OF THEM REVERSIBLE AND ONE TERMINAL
// -----------------------------------------------------------------------------
// PAUSE AND UNPAUSE REPEAT. `active → paused → active → paused` is a legal sequence of
// DISTINCT occurrences. A later Pause is not a retry of an earlier one, nothing here counts
// cycles, and no control is ever labelled `Retry`, `Resend` or `Try again` — a retry
// affordance would be an offer to resend a transaction whose fate is unknown.
//
// FINALIZE IS TERMINAL, so it alone gets the review-then-acknowledge choreography: `Review
// finalization` freezes the exact seven public facts the operator read into a memory-only
// snapshot, and `Finalize campaign` cannot be reached without one. The snapshot binds the
// campaign's lifecycle STATUS, because Finalize-from-`active` and Finalize-from-`paused`
// are different mutation identities — so a campaign that moves between the review and the
// submit DESTROYS the acknowledgement rather than being silently substituted into it.
//
// -----------------------------------------------------------------------------
// THE EMERGENCY-PAUSE AUTHORITY IS OUT OF BROWSER PRODUCT SCOPE
// -----------------------------------------------------------------------------
// The program's `pause_campaign` accepts the campaign admin OR the protocol emergency-pause
// authority. THIS BROWSER PRODUCT EXPOSES ONLY THE FIRST. There is no authority selector
// here, no emergency-role control, no emergency signer, no fallback to one and no request
// field that could carry one; the mutation planner fills the authority account with the
// approved Team wallet and records the role as `campaign_admin`.
//
// AND THIS PANEL NEVER LEARNS WHICH CUSTODY KEY REFUSED AN ATTEMPT. The mutation chain
// guard independently refuses an approved Team wallet that IS the protocol fee authority,
// the protocol emergency-pause authority or the program upgrade authority, as
// `TEAM_WALLET_IS_CUSTODY_AUTHORITY` — and that refusal stays VALUE-FREE. None of those
// three keys is a prop here, none is imported, and this surface cannot explain which one
// matched because it cannot see any of them. That is the boundary, not an omission.
//
// -----------------------------------------------------------------------------
// WHAT IT CANNOT DO
// -----------------------------------------------------------------------------
// It constructs no `Connection` and no transaction object, acquires no `@solana` package at
// all, holds no signer, reaches no raw adapter, opens no RPC of its own, writes no storage,
// takes no Web Lock, reads no environment and draws no entropy.
//
// WHAT IT TOOK IS THE PUBLIC FACADE ONLY — detected wallets, connect, disconnect, status,
// public key, shortened display. That facade has NO adapter member, NO signing member and NO
// sending member, so none can be reached from here. This panel STILL holds no signer, still
// reaches no raw adapter, still cannot reach the sign-only broker, still cannot sign, still
// cannot send and still cannot prompt a wallet by itself.
//
// AUTHORITY IS UNCHANGED. Whether the wallet approving a transaction is the approved Team
// wallet is still decided inside the action root, against live devnet state, immediately
// before anything is signed — this edge is presentation, never a second trust source.
//
// WHAT THE EFFECTS MAY REACH IS EXACTLY ONE THING: the read-only `readMutationSolPreflight`
// member, or a ref write. NONE reaches `submitMutation`, `reconcileMutation`,
// `readMutationStatus`, a journal operation, a wallet signature, a send or a transaction
// construction. There is still NO timer, NO interval, NO poll, NO subscription, NO event
// listener, NO automatic retry and no `<form>`; nothing runs on a clock, and pressing Enter
// submits nothing.
//
// THREE OPERATION-SCOPED C1 STATES, NEVER ONE. Pause, unpause and finalize each own their
// own scope, generation, state, verdict and re-check. Their thresholds are numerically equal
// today and are still never shared: no reading taken for one operation can be consumed as
// another's. An automatic read runs for an operation only where that operation is otherwise
// eligible to be offered.
//
// ALL FIVE ORIGINAL HANDLERS still run from an explicit click and from nowhere else —
// including the local review, and including the read-only status read. The three SOL
// re-checks are READ-ONLY and are NOT mutation transaction actions: this panel's transaction
// controls stay exactly PAUSE = 1, UNPAUSE = 1, FINALIZE = 1.
//
// -----------------------------------------------------------------------------
// A LOADED SNAPSHOT IS NOT CHAIN TRUTH, AND THE PANEL IS NOT THE BOUNDARY
// -----------------------------------------------------------------------------
// The campaign props may PREDATE the very attempt they would be used to judge, so they are
// display truth. ONE shared status gesture takes its own reading — reconcile, re-read the
// slot, then read the campaign — in that fixed order, and BOTH lifecycle submits take one
// more bounded campaign-only read immediately before they call the root: Pause refuses
// unless the fresh status is `active`, Unpause unless it is `paused`, and Finalize unless
// the fresh seven-fact context is EXACTLY the acknowledged one.
//
// Those checks are PRODUCT freshness checks. They can only refuse, they never silently
// update a snapshot with fresh values, and they are not authority. The mutation root runs
// its own authority-grade Phase A, its own planner and its own pre-send reassertion
// afterwards, so an internal caller that skipped every rule on this surface still cannot
// reach a wallet prompt for a campaign whose status does not admit the operation.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import { MetricRow } from '../components/MetricRow'
import { StatusPill } from '../components/StatusPill'
import { SurfaceCard } from '../components/SurfaceCard'
import {
  TEAM_ADMIN_CAMPAIGN_LIFECYCLE,
  TEAM_ADMIN_SOL_PREFLIGHT_INSUFFICIENT,
  TEAM_ADMIN_SOL_PREFLIGHT_READING,
  TEAM_ADMIN_SOL_PREFLIGHT_RECHECK_LABEL,
  TEAM_ADMIN_SOL_PREFLIGHT_UNAVAILABLE,
} from '../lib/productCopy'
import type { RedaxCampaignView } from '../data/redaxViewModels'
import { useRedaxWallet } from '../wallet/RedaxWalletProvider'
import { useRedaxTeamAdminMutationActions } from './RedaxTeamAdminMutationActions'
import type { RedaxTeamAdminMutationSolPreflightResult } from './RedaxTeamAdminMutationActions'
import type { RedaxTeamAdminMutationOperation } from './redaxTeamAdminMutationIdentity'
import type {
  RedaxTeamAdminMutationReconcileCode,
  RedaxTeamAdminMutationStatusReadResult,
  RedaxTeamAdminMutationSubmitResult,
} from './RedaxTeamAdminMutationActions'
import {
  buildRedaxTeamAdminLifecycleFinalizeAcknowledgementContext,
  createRedaxTeamAdminLifecycleFinalizeAcknowledgementSnapshot,
  deriveRedaxTeamAdminLifecycleDisposition,
  isRedaxTeamAdminLifecycleFinalizeAcknowledgementCurrent,
  projectRedaxTeamAdminLifecycleRecoveryRow,
  redaxTeamAdminLifecycleFinalizeSubmitValuesFromSnapshot,
  REDAX_TEAM_ADMIN_LIFECYCLE_PREDECESSORS,
} from './redaxTeamAdminLifecycleProduct'
import type {
  RedaxTeamAdminLifecycleFinalizeAcknowledgementContextInput,
  RedaxTeamAdminLifecycleFinalizeAcknowledgementSnapshot,
  RedaxTeamAdminLifecycleStatusInput,
} from './redaxTeamAdminLifecycleProduct'
import {
  deriveRedaxTeamAdminSetupCampaignAuthority,
  describeRedaxTeamAdminMutationReconcileCode,
  describeRedaxTeamAdminMutationStatusReadCode,
  describeRedaxTeamAdminMutationSubmitCode,
} from './RedaxTeamAdminCampaignSetupPanel'
import type { RedaxTeamAdminSetupCampaignAuthority } from './RedaxTeamAdminCampaignSetupPanel'

/**
 * Why ONE bounded campaign-only refresh refused. THREE members, and no fourth.
 *
 * RE-DECLARED rather than imported from App, exactly as its three sibling panels re-declare
 * the unions they describe: this module reaches no App module at all, and the JSX site in
 * App is where the two declarations are compared — a divergence stops that file compiling.
 *
 * THERE IS NO `TOKEN_CONFIG_READ_REFUSED` MEMBER, and that absence is the point. The three
 * lifecycle operations have no accepted-input prerequisite of any kind, so enumerating a
 * campaign's token configs could only ever have blocked a Pause, an Unpause or a Finalize
 * for a reason none of them depends on.
 */
export type RedaxTeamAdminFreshCampaignLifecycleTruthCode =
  | 'CAMPAIGN_READ_REFUSED'
  | 'CAMPAIGN_ABSENT'
  | 'CAMPAIGN_IDENTITY_MISMATCH'

/** What ONE bounded campaign-only refresh produced. A closed, fail-closed result. */
export type RedaxTeamAdminFreshCampaignLifecycleTruthResult =
  | { readonly ok: true; readonly campaign: RedaxCampaignView }
  | { readonly ok: false; readonly code: RedaxTeamAdminFreshCampaignLifecycleTruthCode }

/**
 * The reading ONE explicit gesture took, bound to the campaign it was taken FOR.
 *
 * The `campaignId` is not decoration: it is the race guard. A refresh started for one
 * campaign and resolving after the operator selected another is not that other campaign's
 * truth, however recently it arrived, and binding the reading to its own campaign is what
 * makes that decidable from state rather than from promise ordering.
 */
export type RedaxTeamAdminLifecycleFreshChainTruth =
  | { readonly kind: 'OK'; readonly campaignId: string; readonly campaign: RedaxCampaignView }
  | {
      readonly kind: 'REFUSED'
      readonly campaignId: string
      readonly code: RedaxTeamAdminFreshCampaignLifecycleTruthCode
    }

/** Which campaign reading this render rests on, and whether it is FRESH. */
export interface RedaxTeamAdminLifecycleChainTruthSelection {
  readonly chainTruthKind: 'LOADED_DISPLAY' | 'FRESH_STATUS_READ'
  readonly campaign: RedaxCampaignView | null
  readonly freshReadRefused: boolean
}

/**
 * Choose the campaign reading this render rests on. PURE, and three outcomes.
 *
 *   1. no current fresh reading — the loaded snapshot, declared `LOADED_DISPLAY`. Honest
 *      for reading and for the two reversible controls, and structurally incapable of
 *      arming the terminal review.
 *   2. a fresh reading that REFUSED — no chain truth at all, and deliberately NOT a silent
 *      fall back to the snapshot: the gesture asked for a fresher reading and did not get
 *      one, so every control blocks.
 *   3. a fresh reading that succeeded, FOR THIS CAMPAIGN — `FRESH_STATUS_READ`, and the
 *      only input that may arm `Review finalization`.
 *
 * A reading taken for a DIFFERENT campaign is discarded at (1). That is stronger than
 * discarding it when it arrives: a selection that changes after the write is handled by the
 * same line.
 */
export function selectRedaxTeamAdminLifecycleChainTruth(input: {
  readonly selectedCampaignId: string
  readonly freshChainTruth: RedaxTeamAdminLifecycleFreshChainTruth | null
  readonly loadedCampaign: RedaxCampaignView | null
}): RedaxTeamAdminLifecycleChainTruthSelection {
  const fresh = input.freshChainTruth
  if (fresh === null || fresh.campaignId !== input.selectedCampaignId) {
    return {
      chainTruthKind: 'LOADED_DISPLAY',
      campaign: input.loadedCampaign,
      freshReadRefused: false,
    }
  }
  if (fresh.kind === 'REFUSED') {
    return { chainTruthKind: 'LOADED_DISPLAY', campaign: null, freshReadRefused: true }
  }
  return {
    chainTruthKind: 'FRESH_STATUS_READ',
    campaign: fresh.campaign,
    freshReadRefused: false,
  }
}

/** The three things ONE explicit status gesture may reach. Injected, never acquired. */
export interface RedaxTeamAdminLifecycleStatusGesturePorts {
  readonly reconcileMutation: () => Promise<{
    readonly code: RedaxTeamAdminMutationReconcileCode
  }>
  readonly readMutationStatus: () => Promise<RedaxTeamAdminMutationStatusReadResult>
  readonly readFreshCampaignLifecycleTruth: (
    campaignId: string,
  ) => Promise<RedaxTeamAdminFreshCampaignLifecycleTruthResult>
}

/** Everything ONE explicit status gesture established, bound to its own campaign. */
export interface RedaxTeamAdminLifecycleStatusGestureOutcome {
  readonly campaignId: string
  readonly reconcileCode: RedaxTeamAdminMutationReconcileCode
  readonly status: RedaxTeamAdminMutationStatusReadResult
  readonly freshChainTruth: RedaxTeamAdminLifecycleFreshChainTruth
}

/**
 * ONE explicit status gesture, in its FIXED order. Reconcile, re-read, then read chain.
 *
 * The order is the point. Reconciling first is what can move the durable slot to a
 * terminal; re-reading is what makes that terminal visible; and reading the campaign LAST
 * is what makes the account reading strictly newer than the journal reading it will be
 * judged beside. A campaign reading taken first would be exactly the stale snapshot this
 * gesture exists to replace.
 *
 * It signs nothing, sends nothing, starts no attempt, writes no record and polls nothing:
 * it runs once, from one click. It is also the ONE status control on this surface — there
 * is no `Check pause status`, no `Check unpause status` and no `Check finalize status`,
 * because there is exactly ONE durable slot and it does not have three.
 */
export async function runRedaxTeamAdminLifecycleStatusGesture(
  ports: RedaxTeamAdminLifecycleStatusGesturePorts,
  campaignId: string,
): Promise<RedaxTeamAdminLifecycleStatusGestureOutcome> {
  const reconciled = await ports.reconcileMutation()
  const status = await ports.readMutationStatus()
  const fresh = await ports.readFreshCampaignLifecycleTruth(campaignId)
  return {
    campaignId,
    reconcileCode: reconciled.code,
    status,
    freshChainTruth: fresh.ok
      ? { kind: 'OK', campaignId, campaign: fresh.campaign }
      : { kind: 'REFUSED', campaignId, code: fresh.code },
  }
}

/**
 * Does this campaign-authority verdict confirm authority FOR A LIFECYCLE STEP?
 *
 * THE SAME classifier the three sibling panels use, reused rather than restated — a second
 * campaign-authority classifier would be a second answer to the one question that decides
 * whether a campaign may be written to at all, and `campaigns[0]` can never satisfy it
 * because it demands that the RAW selection and the EFFECTIVE one agree.
 *
 * TWO of its eight verdicts confirm identity here, and that is not a relaxation. The shared
 * classifier answers `CAMPAIGN_NOT_INITIALIZED` only AFTER every identity comparison has
 * already passed — the raw and effective selections agree, the campaign exists, its own id
 * matches, its own stored address matches the selection, and its stored admin is the
 * approved Team wallet — and then reports that the campaign has left `initialized`. For
 * `add_token_config` that is a refusal. For a lifecycle step it is the PRECONDITION: a
 * campaign that is still `initialized` is exactly the one that cannot be paused, unpaused
 * or finalized, and WHICH statuses admit WHICH gesture is the lifecycle product's decision,
 * made from the status itself rather than smuggled into an identity check.
 */
export function isRedaxTeamAdminLifecycleCampaignAuthorityConfirmed(
  authority: RedaxTeamAdminSetupCampaignAuthority,
): boolean {
  return authority === 'EXPLICIT_SELECTION_CONFIRMED' || authority === 'CAMPAIGN_NOT_INITIALIZED'
}

/**
 * The sanitized status projection, folded into the pure module's structural input.
 *
 * A read that has not happened yet, and a read that failed, are BOTH `UNAVAILABLE`: an
 * unread slot is not a slot known to be empty, and nothing is offered until it has actually
 * been read. Exported so the fold itself is testable without a React tree.
 */
export function toRedaxTeamAdminLifecycleStatusInput(
  status: RedaxTeamAdminMutationStatusReadResult | null,
): RedaxTeamAdminLifecycleStatusInput {
  if (status === null || !status.ok) {
    return { kind: 'UNAVAILABLE' }
  }
  if (status.presence === 'EMPTY') {
    return { kind: 'EMPTY' }
  }
  if (status.presence === 'ACTIVE') {
    return {
      kind: 'ACTIVE',
      operation: status.operation,
      campaign: status.campaign,
      lifecycle: status.lifecycle,
    }
  }
  return {
    kind: 'TOMBSTONE',
    operation: status.operation,
    campaign: status.campaign,
    resolution: status.resolution,
  }
}

/**
 * The raw facts one Finalize acknowledgement context is built from, gathered in ONE place.
 *
 * Used by the render AND by the pre-submit freshness check, so the situation compared
 * against a frozen snapshot is assembled by the same code both times. Two assemblies would
 * be two answers to "what is the current situation".
 *
 * SEVEN FACTS AND NO MORE. The campaign object is deliberately NOT spread in: an
 * acknowledgement that carried the whole view would bind holder-traffic counters an
 * operator never approved anything about.
 */
export function redaxTeamAdminLifecycleFinalizeContextInput(input: {
  readonly rawSelectedCampaignId: string
  readonly effectiveSelectedCampaignId: string
  readonly approvedTeamWallet: string | null
  readonly programId: string | null
  readonly campaign: RedaxCampaignView | null
}): RedaxTeamAdminLifecycleFinalizeAcknowledgementContextInput {
  const campaign = input.campaign
  return {
    rawSelectedCampaignId: input.rawSelectedCampaignId,
    effectiveSelectedCampaignId: input.effectiveSelectedCampaignId,
    campaignAddress: campaign?.campaignAddress ?? null,
    campaignAdmin: campaign?.campaignAdmin ?? null,
    campaignStatus: campaign?.programStatus ?? null,
    approvedTeamWallet: input.approvedTeamWallet,
    programId: input.programId,
  }
}

/**
 * Which operation, if any, is running. Rendered state beside the ref latch.
 *
 * The local review is deliberately NOT a member: it awaits nothing, reaches nothing and
 * completes within the click, so there is no in-flight state for it to be in and no busy
 * label that would ever be true.
 */
type LifecyclePanelOperation = 'pause' | 'unpause' | 'finalize' | 'status'

export interface RedaxTeamAdminCampaignLifecyclePanelProps {
  /**
   * The ONE canonical approved Team wallet, resolved once in App.
   *
   * The SAME value App passes to the mutation provider and to all three sibling panels, so
   * no two of them can disagree about who is approved. `null` means the deployment
   * configured no usable carrier, and the whole surface fails closed on it.
   *
   * IT IS THE ONLY IDENTITY THIS PANEL RECEIVES. The protocol fee authority, the protocol
   * emergency-pause authority and the program upgrade authority are not props here and
   * never will be.
   */
  readonly approvedTeamWallet: string | null
  /** Whether the campaign read this panel judges against actually resolved. */
  readonly campaignDataReady: boolean
  /** The campaign id App's loader actually resolved — the fallback may differ. */
  readonly effectiveSelectedCampaignId: string
  /** The ONE canonical runtime program id, resolved once in App. A PUBLIC deployment fact. */
  readonly programId: string | null
  /**
   * The BOUNDED campaign-only product refresh, injected by App. It is this panel's ONLY
   * route to a reading it may call fresh, and it is called from the explicit status gesture
   * and from the three pre-submit freshness checks — and from nowhere else.
   */
  readonly readFreshCampaignLifecycleTruth: (
    campaignId: string,
  ) => Promise<RedaxTeamAdminFreshCampaignLifecycleTruthResult>
  /** The LOADED campaign, or `null`. Display truth only; it never arms the terminal review. */
  readonly selectedCampaign: RedaxCampaignView | null
  /** The RAW explicit selection, never the fallback. Admission compares the two. */
  readonly selectedCampaignId: string
}

/** Shortened display form (4…4). A full address is never rendered by this panel. */
function shortenLifecycleAddress(value: string): string {
  return value.length <= 9 ? value : `${value.slice(0, 4)}…${value.slice(-4)}`
}


// --- C1 devnet SOL availability — panel-local, identity-scoped ------------------
//
// AVAILABILITY INFORMATION, NEVER AUTHORITY. This gates only what this panel OFFERS. The
// mutation root performs its OWN attempt-authoritative recheck — on the attempt's own
// Connection, at the attempt's own floor, through the same private observer, and after the
// early unresolved-attempt check — so a stale or optimistic value here can widen no gate
// that matters.
//
// `idle` exists only for an identity that cannot be read about at all. An actionable
// identity is READING until its own read settles, so an unread balance is never mistaken
// for a sufficient one.
type LifecycleSolPreflightState =
  | { kind: 'idle' }
  | { kind: 'reading' }
  | { kind: 'settled'; result: RedaxTeamAdminMutationSolPreflightResult }

const LIFECYCLE_SOL_PREFLIGHT_IDLE: LifecycleSolPreflightState = { kind: 'idle' }
const LIFECYCLE_SOL_PREFLIGHT_READING: LifecycleSolPreflightState = { kind: 'reading' }

/**
 * IDENTITY PRIVACY IS A RENDER-TIME RULE, NOT A CLEANUP RACE.
 *
 * A panel-local value is stored together with the EXACT identity scope that produced it and
 * read back through `inScope` while the tree is computed. A value whose recorded scope is
 * not the current one is therefore invisible AND unusable in the very first render that
 * observes a new wallet, campaign or carrier — before any passive effect runs.
 */
interface LifecycleScopedState<T> {
  readonly scope: string
  readonly value: T
}

function lifecycleScopedState<T>(scope: string, value: T): LifecycleScopedState<T> {
  return { scope, value }
}

function lifecycleInScope<T>(
  record: LifecycleScopedState<T>,
  currentScope: string,
  restingValue: T,
): T {
  return record.scope === currentScope ? record.value : restingValue
}

/**
 * THE C1 SCOPE. Its dimensions are the approved Team carrier, the connected wallet, the selected
 * Campaign and the EXACT lifecycle operation.
 *
 * THREE OPERATIONS, THREE SCOPES, THREE RESULTS — never one shared "lifecycle SOL
 * sufficient" verdict. Pause, unpause and finalize are numerically equal today, and that is
 * a coincidence of the current account model rather than a licence to answer one
 * operation's question with another's result. Scoping by the discriminant makes a
 * wrong-operation reuse IMPOSSIBLE rather than merely unlikely.
 *
 * THE OPERATION IS A SCOPE DIMENSION IN ITS OWN RIGHT. Two operations may cost the same
 * today; including the discriminant is what makes it impossible for one operation's reading
 * to be consumed as another's, rather than merely unlikely.
 */
export function redaxTeamAdminLifecycleSolPreflightScope(
  approvedTeamWallet: string | null,
  connectedPublicKey: string | null,
  selectedCampaignId: string,
  operation: RedaxTeamAdminMutationOperation,
): string {
  return `${approvedTeamWallet ?? ''}|${connectedPublicKey ?? ''}|${selectedCampaignId}|${operation}`
}

export function RedaxTeamAdminCampaignLifecyclePanel({
  approvedTeamWallet,
  campaignDataReady,
  effectiveSelectedCampaignId,
  programId,
  readFreshCampaignLifecycleTruth,
  selectedCampaign,
  selectedCampaignId,
}: RedaxTeamAdminCampaignLifecyclePanelProps) {
  const actions = useRedaxTeamAdminMutationActions()
  // THE PUBLIC, CONNECTION-ONLY WALLET FACADE — acquired for C1 presentation and for NOTHING
  // else. It exposes detected wallets, connect, disconnect, status, public key and a
  // shortened display form, and it has NO adapter member, NO signing member and NO sending
  // member — so none can be reached from here. This panel still cannot sign, cannot send,
  // cannot reach the raw adapter and cannot reach the sign-only broker.
  const wallet = useRedaxWallet()

  // MEMORY ONLY, all of it, and nowhere else. No storage port, no lock, no fourth owner.
  // A reload discards the acknowledgement; what survives is the durable attempt and
  // whatever the chain holds, and both are read back rather than remembered.
  const [snapshot, setSnapshot] =
    useState<RedaxTeamAdminLifecycleFinalizeAcknowledgementSnapshot | null>(null)
  // A monotonic review counter. It is not a clock and not entropy — this file reads neither
  // — and it exists so an acknowledgement is bound to the exact review it was taken from
  // rather than to a situation that merely looks the same again later.
  const [acknowledgementGeneration, setAcknowledgementGeneration] = useState<number>(0)
  const [freshChainTruth, setFreshChainTruth] =
    useState<RedaxTeamAdminLifecycleFreshChainTruth | null>(null)
  const [statusResult, setStatusResult] = useState<RedaxTeamAdminMutationStatusReadResult | null>(
    null,
  )
  const [submitResult, setSubmitResult] = useState<RedaxTeamAdminMutationSubmitResult | null>(null)
  const [reconcileCode, setReconcileCode] = useState<RedaxTeamAdminMutationReconcileCode | null>(
    null,
  )
  const [operation, setOperation] = useState<LifecyclePanelOperation | null>(null)

  // The synchronous latch. A `disabled` attribute alone would not do: two clicks inside one
  // frame both observe the same rendered state.
  const inFlightRef = useRef<LifecyclePanelOperation | null>(null)

  const busy = operation !== null

  // WHICH READING THIS RENDER RESTS ON, decided in one place and used everywhere below.
  const chainTruth = selectRedaxTeamAdminLifecycleChainTruth({
    selectedCampaignId,
    freshChainTruth,
    loadedCampaign: selectedCampaign,
  })
  const authoritativeCampaign = chainTruth.campaign

  const campaignAuthority = deriveRedaxTeamAdminSetupCampaignAuthority({
    approvedTeamWallet,
    selectedCampaignId,
    effectiveSelectedCampaignId,
    selectedCampaign: authoritativeCampaign,
  })
  const authorityConfirmed = isRedaxTeamAdminLifecycleCampaignAuthorityConfirmed(campaignAuthority)
  const deploymentConfigured = approvedTeamWallet !== null && programId !== null

  // CHAIN TRUTH OR NOTHING. While the campaign read is in flight or refused, every fact this
  // judgment rests on is `null` rather than the last one seen, and a null refuses.
  const usableCampaign: RedaxCampaignView | null =
    campaignDataReady && authoritativeCampaign !== null && !chainTruth.freshReadRefused
      ? authoritativeCampaign
      : null
  const campaignStatus: string | null = usableCampaign?.programStatus ?? null
  const campaignAddress = authoritativeCampaign?.campaignAddress ?? null
  // ONLY A SUCCESSFUL FRESH CAMPAIGN-ONLY READ OF THE EXACT SELECTION MAY ARM THE TERMINAL
  // REVIEW. A loaded snapshot is display truth, and this is deliberately stronger than the
  // activation sibling's review rule.
  const freshStatusRead =
    chainTruth.chainTruthKind === 'FRESH_STATUS_READ' && usableCampaign !== null

  // THE IMMUTABLE CONTEXT a Finalize acknowledgement is bound to. Rebuilt on every render
  // from current facts and never remembered: the snapshot is compared against THIS, so a
  // fact that moved is a snapshot that is no longer current, in one place.
  const finalizeContext = useMemo(
    () =>
      buildRedaxTeamAdminLifecycleFinalizeAcknowledgementContext(
        redaxTeamAdminLifecycleFinalizeContextInput({
          rawSelectedCampaignId: selectedCampaignId,
          effectiveSelectedCampaignId,
          approvedTeamWallet,
          programId,
          campaign: usableCampaign,
        }),
      ),
    [
      approvedTeamWallet,
      effectiveSelectedCampaignId,
      programId,
      selectedCampaignId,
      usableCampaign,
    ],
  )

  const finalizeAcknowledgementCurrent = isRedaxTeamAdminLifecycleFinalizeAcknowledgementCurrent(
    snapshot,
    finalizeContext,
    acknowledgementGeneration,
  )

  const statusInput = useMemo(
    () => toRedaxTeamAdminLifecycleStatusInput(statusResult),
    [statusResult],
  )

  const disposition = deriveRedaxTeamAdminLifecycleDisposition({
    deploymentConfigured,
    authorityConfirmed,
    campaignAddress,
    campaignStatus,
    freshStatusRead,
    status: statusInput,
    finalizeAcknowledgementCurrent,
  })

  const recoveryRow = useMemo(
    () =>
      projectRedaxTeamAdminLifecycleRecoveryRow({
        status: statusInput,
        campaignAddress,
        campaignStatus,
      }),
    [campaignAddress, campaignStatus, statusInput],
  )

  // The connected identity this panel's C1 reads about, from the public facade above.
  const connectedPublicKeyForSolPreflight = wallet.publicKeyBase58
  // THE IDENTITY HALF of every lifecycle C1 scope, shared by all three operations. The
  // OPERATION half is never shared: each block below carries its own discriminant, its own
  // scope, its own generation, its own state and its own verdict.
  const lifecycleSolPreflightIdentityReady =
    approvedTeamWallet !== null &&
    connectedPublicKeyForSolPreflight !== null &&
    connectedPublicKeyForSolPreflight === approvedTeamWallet &&
    wallet.status === 'connected' &&
    authorityConfirmed &&
    selectedCampaignId !== ''

  // --- C1 shared mounted / member refs ------------------------------------------
  //
  // THIS PANEL NOW REGISTERS EFFECTS, and this is the first time it has. Bounded READ-ONLY
  // passive observation is what C1 is. Every effect below reaches ONLY the read-only
  // preflight member or a commit-phase ref publication. NONE reaches `submitMutation`,
  // `reconcileMutation`, `readMutationStatus`, a journal operation, a wallet signature, a
  // send or a transaction construction, and there is no timer, no interval, no poll, no
  // subscription and no automatic retry anywhere.
  const solPreflightMountedRef = useRef(true)
  // The LATEST read-only member, held so the readers below can depend on nothing that churns.
  // `useRedaxTeamAdminMutationActions()` hands back the provider's context VALUE; depending on
  // that object would give a reader a new identity on any render that produced a fresh
  // wrapper, the automatic effect would re-run, set state and schedule itself again — an
  // unbounded render loop issuing unbounded balance and rent reads at a live endpoint.
  const readMutationSolPreflightRef = useRef(actions.readMutationSolPreflight)

  useEffect(() => {
    solPreflightMountedRef.current = true
    return () => {
      solPreflightMountedRef.current = false
    }
  }, [])

  // A LAYOUT effect, like the scope publications: every layout effect of a commit runs before
  // any passive effect of the same commit, so the ref is already current when the automatic
  // read for a changed scope runs. The dependency is the MEMBER, never the wrapper object.
  useLayoutEffect(() => {
    readMutationSolPreflightRef.current = actions.readMutationSolPreflight
  }, [actions.readMutationSolPreflight])

  // --- C1 devnet SOL availability for PAUSE_CAMPAIGN ------------------------------
  //
  //     AN AUTOMATIC READ RUNS ONLY WHERE THIS OPERATION IS OTHERWISE ELIGIBLE TO BE OFFERED.
  //     A campaign that cannot be paused is not asked about pausing, so no devnet read is
  //     spent on a step this panel would withhold anyway.
  const pauseSolPreflightScope = redaxTeamAdminLifecycleSolPreflightScope(
    approvedTeamWallet,
    connectedPublicKeyForSolPreflight,
    selectedCampaignId,
    'PAUSE_CAMPAIGN',
  )
  // ACTIONABLE means "worth reading a balance about": a carrier exists, a wallet is
  // connected, that wallet is EXACTLY the approved Team, and this campaign is the explicitly
  // confirmed one. Any other identity resolves to `idle` — this panel does not read, and does
  // not report, a balance belonging to a wallet that could not pay for this operation anyway.
  const pauseSolPreflightActionable = lifecycleSolPreflightIdentityReady &&
    disposition.pauseAdmissible &&
    !chainTruth.freshReadRefused

  const [pauseSolPreflightRecord, setPauseSolPreflightRecord] = useState<
    LifecycleScopedState<LifecycleSolPreflightState>
  >(() =>
    lifecycleScopedState(
      pauseSolPreflightScope,
      pauseSolPreflightActionable ? LIFECYCLE_SOL_PREFLIGHT_READING : LIFECYCLE_SOL_PREFLIGHT_IDLE,
    ),
  )

  // RENDER-TIME IDENTITY GATING. The projection collapses to its neutral resting value the
  // moment the identity that produced it stops being current — in THIS render, not in a later
  // effect. A wallet or campaign change therefore invalidates an old reading immediately.
  const pauseSolPreflight = lifecycleInScope(
    pauseSolPreflightRecord,
    pauseSolPreflightScope,
    pauseSolPreflightActionable ? LIFECYCLE_SOL_PREFLIGHT_READING : LIFECYCLE_SOL_PREFLIGHT_IDLE,
  )

  const committedPauseSolPreflightScopeRef = useRef(pauseSolPreflightScope)
  const pauseSolPreflightGenerationRef = useRef(0)

  useLayoutEffect(() => {
    committedPauseSolPreflightScopeRef.current = pauseSolPreflightScope
  }, [pauseSolPreflightScope])

  // EVERY ASYNC COMPLETION MUST PROVE THREE THINGS before it may write state: still mounted,
  // the COMMITTED scope is the one the read started in, and the read is still the newest.
  const isPauseSolPreflightCurrent = useCallback(
    (scopeKey: string, generation: number): boolean => {
      return (
        solPreflightMountedRef.current &&
        committedPauseSolPreflightScopeRef.current === scopeKey &&
        pauseSolPreflightGenerationRef.current === generation
      )
    },
    [],
  )

  // ONE read-only devnet SOL read for THIS operation. It builds nothing, signs nothing, sends
  // nothing, confirms nothing, touches no durable record and returns no authorization. Each
  // call supersedes the previous one, so a slow earlier read can never be the last writer.
  const runPauseSolPreflightRead = useCallback(
    async (scopeKey: string): Promise<void> => {
      pauseSolPreflightGenerationRef.current += 1
      const generation = pauseSolPreflightGenerationRef.current
      setPauseSolPreflightRecord(lifecycleScopedState(scopeKey, LIFECYCLE_SOL_PREFLIGHT_READING))
      try {
        const result = await readMutationSolPreflightRef.current('PAUSE_CAMPAIGN')
        if (!isPauseSolPreflightCurrent(scopeKey, generation)) {
          return
        }
        setPauseSolPreflightRecord(
          lifecycleScopedState<LifecycleSolPreflightState>(scopeKey, { kind: 'settled', result }),
        )
      } catch {
        // A REJECTED read is not an observation. It settles as READ_UNAVAILABLE — which
        // WITHHOLDS the action — rather than as an unhandled rejection or an optimistic
        // sufficiency. No raw error is read, rendered or logged.
        if (!isPauseSolPreflightCurrent(scopeKey, generation)) {
          return
        }
        setPauseSolPreflightRecord(
          lifecycleScopedState<LifecycleSolPreflightState>(scopeKey, {
            kind: 'settled',
            result: 'READ_UNAVAILABLE',
          }),
        )
      }
    },
    [isPauseSolPreflightCurrent],
  )

  // EXACTLY ONE AUTOMATIC READ PER NEW ACTIONABLE SCOPE, and no more. No timer, no interval,
  // no polling, no subscription and no automatic retry: a stale reading is corrected by the
  // explicit human re-check, never by this panel deciding on its own to ask again.
  useEffect(() => {
    if (!pauseSolPreflightActionable) {
      setPauseSolPreflightRecord(lifecycleScopedState(pauseSolPreflightScope, LIFECYCLE_SOL_PREFLIGHT_IDLE))
      return
    }
    void runPauseSolPreflightRead(pauseSolPreflightScope)
  }, [pauseSolPreflightActionable, pauseSolPreflightScope, runPauseSolPreflightRead])

  // KNOWN-SUFFICIENT ONLY. A reading, an idle projection and a failed read all resolve to
  // false, because an unknown balance must WITHHOLD an action rather than allow one.
  const pauseSolPreflightSufficient = pauseSolPreflight.kind === 'settled' && pauseSolPreflight.result === 'SUFFICIENT'

  const pauseSolPreflightNote: string | null =
    pauseSolPreflight.kind === 'reading'
      ? TEAM_ADMIN_SOL_PREFLIGHT_READING
      : pauseSolPreflight.kind === 'idle'
        ? null
        : pauseSolPreflight.result === 'INSUFFICIENT'
          ? TEAM_ADMIN_SOL_PREFLIGHT_INSUFFICIENT
          : pauseSolPreflight.result === 'READ_UNAVAILABLE'
            ? TEAM_ADMIN_SOL_PREFLIGHT_UNAVAILABLE
            : null

  /**
   * THE EXPLICIT, READ-ONLY SOL RE-CHECK FOR PAUSE_CAMPAIGN. It runs ONLY from its own click.
   *
   * It builds nothing, signs nothing, sends nothing, confirms nothing, writes no durable
   * record and returns no authorization, and there is no timer, no poll, no storage event and
   * no subscription behind it. IT IS NOT A MUTATION ACTION: it does not take the
   * single-flight latch, does not set `operation`, and never counts toward this panel's
   * transaction-control census. It re-reads EXACTLY this operation and supersedes only its
   * own previous read.
   */
  const handlePauseSolPreflightRecheck = useCallback((): void => {
    if (pauseSolPreflightScope !== committedPauseSolPreflightScopeRef.current) {
      return
    }
    if (!pauseSolPreflightActionable || busy || pauseSolPreflight.kind === 'reading') {
      return
    }
    void runPauseSolPreflightRead(pauseSolPreflightScope)
  }, [busy, runPauseSolPreflightRead, pauseSolPreflight.kind, pauseSolPreflightActionable, pauseSolPreflightScope])

  // --- C1 devnet SOL availability for UNPAUSE_CAMPAIGN ------------------------------
  //
  //     AN AUTOMATIC READ RUNS ONLY WHERE THIS OPERATION IS OTHERWISE ELIGIBLE TO BE OFFERED.
  //     A campaign that cannot be paused is not asked about pausing, so no devnet read is
  //     spent on a step this panel would withhold anyway.
  const unpauseSolPreflightScope = redaxTeamAdminLifecycleSolPreflightScope(
    approvedTeamWallet,
    connectedPublicKeyForSolPreflight,
    selectedCampaignId,
    'UNPAUSE_CAMPAIGN',
  )
  // ACTIONABLE means "worth reading a balance about": a carrier exists, a wallet is
  // connected, that wallet is EXACTLY the approved Team, and this campaign is the explicitly
  // confirmed one. Any other identity resolves to `idle` — this panel does not read, and does
  // not report, a balance belonging to a wallet that could not pay for this operation anyway.
  const unpauseSolPreflightActionable = lifecycleSolPreflightIdentityReady &&
    disposition.unpauseAdmissible &&
    !chainTruth.freshReadRefused

  const [unpauseSolPreflightRecord, setUnpauseSolPreflightRecord] = useState<
    LifecycleScopedState<LifecycleSolPreflightState>
  >(() =>
    lifecycleScopedState(
      unpauseSolPreflightScope,
      unpauseSolPreflightActionable ? LIFECYCLE_SOL_PREFLIGHT_READING : LIFECYCLE_SOL_PREFLIGHT_IDLE,
    ),
  )

  // RENDER-TIME IDENTITY GATING. The projection collapses to its neutral resting value the
  // moment the identity that produced it stops being current — in THIS render, not in a later
  // effect. A wallet or campaign change therefore invalidates an old reading immediately.
  const unpauseSolPreflight = lifecycleInScope(
    unpauseSolPreflightRecord,
    unpauseSolPreflightScope,
    unpauseSolPreflightActionable ? LIFECYCLE_SOL_PREFLIGHT_READING : LIFECYCLE_SOL_PREFLIGHT_IDLE,
  )

  const committedUnpauseSolPreflightScopeRef = useRef(unpauseSolPreflightScope)
  const unpauseSolPreflightGenerationRef = useRef(0)

  useLayoutEffect(() => {
    committedUnpauseSolPreflightScopeRef.current = unpauseSolPreflightScope
  }, [unpauseSolPreflightScope])

  // EVERY ASYNC COMPLETION MUST PROVE THREE THINGS before it may write state: still mounted,
  // the COMMITTED scope is the one the read started in, and the read is still the newest.
  const isUnpauseSolPreflightCurrent = useCallback(
    (scopeKey: string, generation: number): boolean => {
      return (
        solPreflightMountedRef.current &&
        committedUnpauseSolPreflightScopeRef.current === scopeKey &&
        unpauseSolPreflightGenerationRef.current === generation
      )
    },
    [],
  )

  // ONE read-only devnet SOL read for THIS operation. It builds nothing, signs nothing, sends
  // nothing, confirms nothing, touches no durable record and returns no authorization. Each
  // call supersedes the previous one, so a slow earlier read can never be the last writer.
  const runUnpauseSolPreflightRead = useCallback(
    async (scopeKey: string): Promise<void> => {
      unpauseSolPreflightGenerationRef.current += 1
      const generation = unpauseSolPreflightGenerationRef.current
      setUnpauseSolPreflightRecord(lifecycleScopedState(scopeKey, LIFECYCLE_SOL_PREFLIGHT_READING))
      try {
        const result = await readMutationSolPreflightRef.current('UNPAUSE_CAMPAIGN')
        if (!isUnpauseSolPreflightCurrent(scopeKey, generation)) {
          return
        }
        setUnpauseSolPreflightRecord(
          lifecycleScopedState<LifecycleSolPreflightState>(scopeKey, { kind: 'settled', result }),
        )
      } catch {
        // A REJECTED read is not an observation. It settles as READ_UNAVAILABLE — which
        // WITHHOLDS the action — rather than as an unhandled rejection or an optimistic
        // sufficiency. No raw error is read, rendered or logged.
        if (!isUnpauseSolPreflightCurrent(scopeKey, generation)) {
          return
        }
        setUnpauseSolPreflightRecord(
          lifecycleScopedState<LifecycleSolPreflightState>(scopeKey, {
            kind: 'settled',
            result: 'READ_UNAVAILABLE',
          }),
        )
      }
    },
    [isUnpauseSolPreflightCurrent],
  )

  // EXACTLY ONE AUTOMATIC READ PER NEW ACTIONABLE SCOPE, and no more. No timer, no interval,
  // no polling, no subscription and no automatic retry: a stale reading is corrected by the
  // explicit human re-check, never by this panel deciding on its own to ask again.
  useEffect(() => {
    if (!unpauseSolPreflightActionable) {
      setUnpauseSolPreflightRecord(lifecycleScopedState(unpauseSolPreflightScope, LIFECYCLE_SOL_PREFLIGHT_IDLE))
      return
    }
    void runUnpauseSolPreflightRead(unpauseSolPreflightScope)
  }, [unpauseSolPreflightActionable, unpauseSolPreflightScope, runUnpauseSolPreflightRead])

  // KNOWN-SUFFICIENT ONLY. A reading, an idle projection and a failed read all resolve to
  // false, because an unknown balance must WITHHOLD an action rather than allow one.
  const unpauseSolPreflightSufficient = unpauseSolPreflight.kind === 'settled' && unpauseSolPreflight.result === 'SUFFICIENT'

  const unpauseSolPreflightNote: string | null =
    unpauseSolPreflight.kind === 'reading'
      ? TEAM_ADMIN_SOL_PREFLIGHT_READING
      : unpauseSolPreflight.kind === 'idle'
        ? null
        : unpauseSolPreflight.result === 'INSUFFICIENT'
          ? TEAM_ADMIN_SOL_PREFLIGHT_INSUFFICIENT
          : unpauseSolPreflight.result === 'READ_UNAVAILABLE'
            ? TEAM_ADMIN_SOL_PREFLIGHT_UNAVAILABLE
            : null

  /**
   * THE EXPLICIT, READ-ONLY SOL RE-CHECK FOR UNPAUSE_CAMPAIGN. It runs ONLY from its own click.
   *
   * It builds nothing, signs nothing, sends nothing, confirms nothing, writes no durable
   * record and returns no authorization, and there is no timer, no poll, no storage event and
   * no subscription behind it. IT IS NOT A MUTATION ACTION: it does not take the
   * single-flight latch, does not set `operation`, and never counts toward this panel's
   * transaction-control census. It re-reads EXACTLY this operation and supersedes only its
   * own previous read.
   */
  const handleUnpauseSolPreflightRecheck = useCallback((): void => {
    if (unpauseSolPreflightScope !== committedUnpauseSolPreflightScopeRef.current) {
      return
    }
    if (!unpauseSolPreflightActionable || busy || unpauseSolPreflight.kind === 'reading') {
      return
    }
    void runUnpauseSolPreflightRead(unpauseSolPreflightScope)
  }, [busy, runUnpauseSolPreflightRead, unpauseSolPreflight.kind, unpauseSolPreflightActionable, unpauseSolPreflightScope])

  // --- C1 devnet SOL availability for FINALIZE_CAMPAIGN ------------------------------
  //
  //     AN AUTOMATIC READ RUNS ONLY WHERE THIS OPERATION IS OTHERWISE ELIGIBLE TO BE OFFERED.
  //     A campaign that cannot be paused is not asked about pausing, so no devnet read is
  //     spent on a step this panel would withhold anyway.
  const finalizeSolPreflightScope = redaxTeamAdminLifecycleSolPreflightScope(
    approvedTeamWallet,
    connectedPublicKeyForSolPreflight,
    selectedCampaignId,
    'FINALIZE_CAMPAIGN',
  )
  // ACTIONABLE means "worth reading a balance about": a carrier exists, a wallet is
  // connected, that wallet is EXACTLY the approved Team, and this campaign is the explicitly
  // confirmed one. Any other identity resolves to `idle` — this panel does not read, and does
  // not report, a balance belonging to a wallet that could not pay for this operation anyway.
  const finalizeSolPreflightActionable = lifecycleSolPreflightIdentityReady &&
    disposition.finalizeSubmitAdmissible &&
    !chainTruth.freshReadRefused

  const [finalizeSolPreflightRecord, setFinalizeSolPreflightRecord] = useState<
    LifecycleScopedState<LifecycleSolPreflightState>
  >(() =>
    lifecycleScopedState(
      finalizeSolPreflightScope,
      finalizeSolPreflightActionable ? LIFECYCLE_SOL_PREFLIGHT_READING : LIFECYCLE_SOL_PREFLIGHT_IDLE,
    ),
  )

  // RENDER-TIME IDENTITY GATING. The projection collapses to its neutral resting value the
  // moment the identity that produced it stops being current — in THIS render, not in a later
  // effect. A wallet or campaign change therefore invalidates an old reading immediately.
  const finalizeSolPreflight = lifecycleInScope(
    finalizeSolPreflightRecord,
    finalizeSolPreflightScope,
    finalizeSolPreflightActionable ? LIFECYCLE_SOL_PREFLIGHT_READING : LIFECYCLE_SOL_PREFLIGHT_IDLE,
  )

  const committedFinalizeSolPreflightScopeRef = useRef(finalizeSolPreflightScope)
  const finalizeSolPreflightGenerationRef = useRef(0)

  useLayoutEffect(() => {
    committedFinalizeSolPreflightScopeRef.current = finalizeSolPreflightScope
  }, [finalizeSolPreflightScope])

  // EVERY ASYNC COMPLETION MUST PROVE THREE THINGS before it may write state: still mounted,
  // the COMMITTED scope is the one the read started in, and the read is still the newest.
  const isFinalizeSolPreflightCurrent = useCallback(
    (scopeKey: string, generation: number): boolean => {
      return (
        solPreflightMountedRef.current &&
        committedFinalizeSolPreflightScopeRef.current === scopeKey &&
        finalizeSolPreflightGenerationRef.current === generation
      )
    },
    [],
  )

  // ONE read-only devnet SOL read for THIS operation. It builds nothing, signs nothing, sends
  // nothing, confirms nothing, touches no durable record and returns no authorization. Each
  // call supersedes the previous one, so a slow earlier read can never be the last writer.
  const runFinalizeSolPreflightRead = useCallback(
    async (scopeKey: string): Promise<void> => {
      finalizeSolPreflightGenerationRef.current += 1
      const generation = finalizeSolPreflightGenerationRef.current
      setFinalizeSolPreflightRecord(lifecycleScopedState(scopeKey, LIFECYCLE_SOL_PREFLIGHT_READING))
      try {
        const result = await readMutationSolPreflightRef.current('FINALIZE_CAMPAIGN')
        if (!isFinalizeSolPreflightCurrent(scopeKey, generation)) {
          return
        }
        setFinalizeSolPreflightRecord(
          lifecycleScopedState<LifecycleSolPreflightState>(scopeKey, { kind: 'settled', result }),
        )
      } catch {
        // A REJECTED read is not an observation. It settles as READ_UNAVAILABLE — which
        // WITHHOLDS the action — rather than as an unhandled rejection or an optimistic
        // sufficiency. No raw error is read, rendered or logged.
        if (!isFinalizeSolPreflightCurrent(scopeKey, generation)) {
          return
        }
        setFinalizeSolPreflightRecord(
          lifecycleScopedState<LifecycleSolPreflightState>(scopeKey, {
            kind: 'settled',
            result: 'READ_UNAVAILABLE',
          }),
        )
      }
    },
    [isFinalizeSolPreflightCurrent],
  )

  // EXACTLY ONE AUTOMATIC READ PER NEW ACTIONABLE SCOPE, and no more. No timer, no interval,
  // no polling, no subscription and no automatic retry: a stale reading is corrected by the
  // explicit human re-check, never by this panel deciding on its own to ask again.
  useEffect(() => {
    if (!finalizeSolPreflightActionable) {
      setFinalizeSolPreflightRecord(lifecycleScopedState(finalizeSolPreflightScope, LIFECYCLE_SOL_PREFLIGHT_IDLE))
      return
    }
    void runFinalizeSolPreflightRead(finalizeSolPreflightScope)
  }, [finalizeSolPreflightActionable, finalizeSolPreflightScope, runFinalizeSolPreflightRead])

  // KNOWN-SUFFICIENT ONLY. A reading, an idle projection and a failed read all resolve to
  // false, because an unknown balance must WITHHOLD an action rather than allow one.
  const finalizeSolPreflightSufficient = finalizeSolPreflight.kind === 'settled' && finalizeSolPreflight.result === 'SUFFICIENT'

  const finalizeSolPreflightNote: string | null =
    finalizeSolPreflight.kind === 'reading'
      ? TEAM_ADMIN_SOL_PREFLIGHT_READING
      : finalizeSolPreflight.kind === 'idle'
        ? null
        : finalizeSolPreflight.result === 'INSUFFICIENT'
          ? TEAM_ADMIN_SOL_PREFLIGHT_INSUFFICIENT
          : finalizeSolPreflight.result === 'READ_UNAVAILABLE'
            ? TEAM_ADMIN_SOL_PREFLIGHT_UNAVAILABLE
            : null

  /**
   * THE EXPLICIT, READ-ONLY SOL RE-CHECK FOR FINALIZE_CAMPAIGN. It runs ONLY from its own click.
   *
   * It builds nothing, signs nothing, sends nothing, confirms nothing, writes no durable
   * record and returns no authorization, and there is no timer, no poll, no storage event and
   * no subscription behind it. IT IS NOT A MUTATION ACTION: it does not take the
   * single-flight latch, does not set `operation`, and never counts toward this panel's
   * transaction-control census. It re-reads EXACTLY this operation and supersedes only its
   * own previous read.
   */
  const handleFinalizeSolPreflightRecheck = useCallback((): void => {
    if (finalizeSolPreflightScope !== committedFinalizeSolPreflightScopeRef.current) {
      return
    }
    if (!finalizeSolPreflightActionable || busy || finalizeSolPreflight.kind === 'reading') {
      return
    }
    void runFinalizeSolPreflightRead(finalizeSolPreflightScope)
  }, [busy, runFinalizeSolPreflightRead, finalizeSolPreflight.kind, finalizeSolPreflightActionable, finalizeSolPreflightScope])

  const pauseEnabled =
    disposition.pauseAdmissible &&
    !chainTruth.freshReadRefused &&
    !busy &&
    pauseSolPreflightSufficient
  const unpauseEnabled =
    disposition.unpauseAdmissible &&
    !chainTruth.freshReadRefused &&
    !busy &&
    // UNPAUSE_CAMPAIGN's OWN reading, and no other operation's.
    unpauseSolPreflightSufficient
  const reviewEnabled =
    disposition.finalizeReviewAdmissible && finalizeContext !== null && !busy
  const finalizeEnabled =
    disposition.finalizeSubmitAdmissible &&
    snapshot !== null &&
    finalizeAcknowledgementCurrent &&
    authorityConfirmed &&
    !chainTruth.freshReadRefused &&
    !busy &&
    // FINALIZE_CAMPAIGN's OWN reading, and no other operation's. Every existing
    // acknowledgement, authority and freshness condition above is unchanged.
    finalizeSolPreflightSufficient

  /**
   * THE LOCAL REVIEW. It is NOT a mutation-action control.
   *
   * It signs nothing, sends nothing, opens no wallet, performs no RPC, reads no clock,
   * writes no journal record and writes no storage. It AWAITS NOTHING: it takes the already
   * fresh, currently rendered context, advances the review generation and freezes it. With
   * no current fresh context it does nothing at all rather than reaching for one.
   */
  const handleReviewFinalization = useCallback((): void => {
    if (inFlightRef.current !== null) {
      return
    }
    const context = finalizeContext
    if (context === null) {
      return
    }
    const reviewedGeneration = acknowledgementGeneration + 1
    setAcknowledgementGeneration(reviewedGeneration)
    setSnapshot(
      createRedaxTeamAdminLifecycleFinalizeAcknowledgementSnapshot(reviewedGeneration, context),
    )
  }, [acknowledgementGeneration, finalizeContext])

  /**
   * THE TWO REVERSIBLE WRITES, from an explicit click and nowhere else.
   *
   * Written ONCE and parameterised by the operation and the exact status it is admitted
   * from, because two hand-copied handlers would be two places for the predecessor rule to
   * drift. The latch is CLAIMED synchronously before the first await, so a second click in
   * the same frame cannot pass.
   *
   * Then a PRODUCT freshness check runs: one bounded campaign-only refresh, and the fresh
   * campaign must still be this exact selection, still be administered by the approved Team
   * wallet, and still be in the status this operation is admitted from. A refusal returns
   * WITHOUT submitting. Neither operation requires an acknowledgement — both are reversible
   * by a later explicit campaign-admin gesture — and neither is a retry of anything: a legal
   * later occurrence is a fresh decision the live chain has to admit again.
   *
   * NO CLOCK, NO DEADLINE AND NO CAP is consulted here, by decision. An expired campaign
   * that is still `paused` is still eligible to be unpaused, because the product mirrors the
   * program's lifecycle status.
   */
  const runReversibleLifecycleSubmit = useCallback(
    async (
      panelOperation: 'pause' | 'unpause',
      mutationOperation: 'PAUSE_CAMPAIGN' | 'UNPAUSE_CAMPAIGN',
    ): Promise<void> => {
      if (inFlightRef.current !== null) {
        return
      }
      // The rendered control is already disabled without this; the handler asserts it again
      // because a disabled attribute is a rendering, not a gate.
      if (!authorityConfirmed) {
        return
      }
      // THE COMMITTED C1 PROJECTION FOR *THIS* OPERATION, RE-ASSERTED SYNCHRONOUSLY. The
      // scope and the verdict are selected by the mutation operation this call is FOR, so a
      // pause can never be admitted on unpause's reading, or the reverse. The rendered gate
      // can be one commit behind the identity a click belongs to, so the handler repeats the
      // check against the scope that is COMMITTED right now.
      //
      // THIS IS NOT AUTHORITY. `submitMutation` reads the balance again itself, on the
      // attempt's own Connection, at the attempt's own floor, for the SAME operation
      // discriminant, and refuses there regardless.
      const solPreflightScopeForOperation =
        mutationOperation === 'PAUSE_CAMPAIGN' ? pauseSolPreflightScope : unpauseSolPreflightScope
      const solPreflightCommittedForOperation =
        mutationOperation === 'PAUSE_CAMPAIGN'
          ? committedPauseSolPreflightScopeRef.current
          : committedUnpauseSolPreflightScopeRef.current
      const solPreflightSufficientForOperation =
        mutationOperation === 'PAUSE_CAMPAIGN'
          ? pauseSolPreflightSufficient
          : unpauseSolPreflightSufficient
      if (
        solPreflightScopeForOperation !== solPreflightCommittedForOperation ||
        !solPreflightSufficientForOperation
      ) {
        return
      }
      const gestureCampaignId = selectedCampaignId
      inFlightRef.current = panelOperation
      setOperation(panelOperation)
      setReconcileCode(null)
      setFreshChainTruth(null)
      try {
        const fresh = await readFreshCampaignLifecycleTruth(gestureCampaignId)
        setFreshChainTruth(
          fresh.ok
            ? { kind: 'OK', campaignId: gestureCampaignId, campaign: fresh.campaign }
            : { kind: 'REFUSED', campaignId: gestureCampaignId, code: fresh.code },
        )
        if (!fresh.ok) {
          return
        }
        const freshAuthority = deriveRedaxTeamAdminSetupCampaignAuthority({
          approvedTeamWallet,
          selectedCampaignId: gestureCampaignId,
          effectiveSelectedCampaignId,
          selectedCampaign: fresh.campaign,
        })
        if (!isRedaxTeamAdminLifecycleCampaignAuthorityConfirmed(freshAuthority)) {
          return
        }
        const admissible = REDAX_TEAM_ADMIN_LIFECYCLE_PREDECESSORS[mutationOperation]
        if (!admissible.includes(fresh.campaign.programStatus)) {
          return
        }
        const freshAddress = fresh.campaign.campaignAddress
        if (freshAddress === undefined || freshAddress !== gestureCampaignId) {
          return
        }
        const result =
          mutationOperation === 'PAUSE_CAMPAIGN'
            ? await actions.submitMutation({
                operation: 'PAUSE_CAMPAIGN',
                campaign: freshAddress,
              })
            : await actions.submitMutation({
                operation: 'UNPAUSE_CAMPAIGN',
                campaign: freshAddress,
              })
        setSubmitResult(result)
        // THE READING IS SPENT. Whatever the chain said before this attempt says nothing
        // about the chain after it — and any acknowledgement taken from it is spent too.
        setFreshChainTruth(null)
        setSnapshot(null)
        // A READ, never a reconcile. The next state has to come from the durable record
        // rather than from what this handler happens to remember.
        setStatusResult(await actions.readMutationStatus())
      } finally {
        inFlightRef.current = null
        setOperation(null)
      }
    },
    [
      actions,
      approvedTeamWallet,
      authorityConfirmed,
      effectiveSelectedCampaignId,
      pauseSolPreflightScope,
      pauseSolPreflightSufficient,
      readFreshCampaignLifecycleTruth,
      selectedCampaignId,
      unpauseSolPreflightScope,
      unpauseSolPreflightSufficient,
    ],
  )

  const handlePauseCampaign = useCallback(
    (): Promise<void> => runReversibleLifecycleSubmit('pause', 'PAUSE_CAMPAIGN'),
    [runReversibleLifecycleSubmit],
  )

  const handleUnpauseCampaign = useCallback(
    (): Promise<void> => runReversibleLifecycleSubmit('unpause', 'UNPAUSE_CAMPAIGN'),
    [runReversibleLifecycleSubmit],
  )

  /**
   * THE ONE TERMINAL WRITE, from an explicit click and nowhere else.
   *
   * The latch is CLAIMED synchronously before the first await. Then a SECOND bounded
   * campaign-only read runs and the fresh seven-fact context is compared against the
   * ACKNOWLEDGED one. A refused read, a changed selection, a changed stored address, a
   * changed admin, a changed lifecycle status, a changed approved-Team carrier and a changed
   * program identity each DESTROY the acknowledgement and return — the snapshot is never
   * rewritten with the fresh values and never re-reviewed automatically, because either
   * would finalize a situation nobody read.
   *
   * That check is NOT the security boundary. The mutation root runs its own authority-grade
   * Phase A, its own planner, its own custody-authority exclusion and its own pre-send
   * reassertion afterwards, and refuses there regardless of what happened here.
   */
  const handleFinalizeCampaign = useCallback(async (): Promise<void> => {
    if (inFlightRef.current !== null) {
      return
    }
    const acknowledged = snapshot
    if (acknowledged === null || !finalizeAcknowledgementCurrent || !authorityConfirmed) {
      return
    }
    // THE COMMITTED C1 PROJECTION FOR FINALIZE_CAMPAIGN, RE-ASSERTED SYNCHRONOUSLY — and
    // deliberately not pause's or unpause's, even though all three cost the same today.
    //
    // THIS IS NOT AUTHORITY. `submitMutation` reads the balance again itself, on the
    // attempt's own Connection and at the attempt's own floor, and refuses there regardless.
    if (
      finalizeSolPreflightScope !== committedFinalizeSolPreflightScopeRef.current ||
      !finalizeSolPreflightSufficient
    ) {
      return
    }
    const gestureCampaignId = selectedCampaignId
    inFlightRef.current = 'finalize'
    setOperation('finalize')
    setReconcileCode(null)
    setFreshChainTruth(null)
    try {
      const fresh = await readFreshCampaignLifecycleTruth(gestureCampaignId)
      setFreshChainTruth(
        fresh.ok
          ? { kind: 'OK', campaignId: gestureCampaignId, campaign: fresh.campaign }
          : { kind: 'REFUSED', campaignId: gestureCampaignId, code: fresh.code },
      )
      if (!fresh.ok) {
        // A refused refresh is not permission to proceed on the reading it was taken to
        // supersede. The acknowledgement is destroyed and nothing is submitted.
        setSnapshot(null)
        return
      }
      const freshContext = buildRedaxTeamAdminLifecycleFinalizeAcknowledgementContext(
        redaxTeamAdminLifecycleFinalizeContextInput({
          rawSelectedCampaignId: gestureCampaignId,
          effectiveSelectedCampaignId,
          approvedTeamWallet,
          programId,
          campaign: fresh.campaign,
        }),
      )
      if (
        !isRedaxTeamAdminLifecycleFinalizeAcknowledgementCurrent(
          acknowledged,
          freshContext,
          acknowledged.acknowledgementGeneration,
        )
      ) {
        setSnapshot(null)
        return
      }
      const values = redaxTeamAdminLifecycleFinalizeSubmitValuesFromSnapshot(acknowledged)
      const result = await actions.submitMutation({
        operation: 'FINALIZE_CAMPAIGN',
        campaign: values.campaign,
      })
      setSubmitResult(result)
      setFreshChainTruth(null)
      setSnapshot(null)
      setStatusResult(await actions.readMutationStatus())
    } finally {
      inFlightRef.current = null
      setOperation(null)
    }
  }, [
    actions,
    approvedTeamWallet,
    authorityConfirmed,
    effectiveSelectedCampaignId,
    finalizeAcknowledgementCurrent,
    finalizeSolPreflightScope,
    finalizeSolPreflightSufficient,
    programId,
    readFreshCampaignLifecycleTruth,
    selectedCampaignId,
    snapshot,
  ])

  /**
   * THE ONE STATUS PATH, from an explicit click and nowhere else.
   *
   * Reconcile, re-read the slot, then read the campaign — in that fixed order. Neither step
   * signs, prompts a wallet, builds anything, sends anything or starts a new attempt, which
   * is why it needs no connected wallet and is safe after a reload. It runs once, from one
   * click: nothing here polls and nothing schedules a second run.
   *
   * It is ONE control for the whole surface, not three. The single durable slot may hold a
   * record for any of the six operations and for any campaign, and what is rendered below is
   * what was ACTUALLY found — never relabelled as a pause, an unpause or a finalize because
   * this is the panel that asked.
   */
  const handleCheckLifecycleStatus = useCallback(async (): Promise<void> => {
    if (inFlightRef.current !== null) {
      return
    }
    // The campaign this gesture is ABOUT, read once before the first await.
    const gestureCampaignId = selectedCampaignId
    inFlightRef.current = 'status'
    setOperation('status')
    setFreshChainTruth(null)
    try {
      const outcome = await runRedaxTeamAdminLifecycleStatusGesture(
        {
          reconcileMutation: () => actions.reconcileMutation(),
          readMutationStatus: () => actions.readMutationStatus(),
          readFreshCampaignLifecycleTruth,
        },
        gestureCampaignId,
      )
      setReconcileCode(outcome.reconcileCode)
      setStatusResult(outcome.status)
      // Written WITH its campaign. A late arrival for a superseded selection is discarded on
      // every render by the same rule that discards a stale one.
      setFreshChainTruth(outcome.freshChainTruth)
    } finally {
      inFlightRef.current = null
      setOperation(null)
    }
  }, [actions, readFreshCampaignLifecycleTruth, selectedCampaignId])

  const statusSummary =
    statusResult === null
      ? TEAM_ADMIN_CAMPAIGN_LIFECYCLE.statusUnread
      : !statusResult.ok
        ? describeRedaxTeamAdminMutationStatusReadCode(statusResult.code)
        : statusResult.presence === 'EMPTY'
          ? TEAM_ADMIN_CAMPAIGN_LIFECYCLE.statusEmpty
          : TEAM_ADMIN_CAMPAIGN_LIFECYCLE.attributionNote[disposition.attribution]

  // THE RECORD AS IT ACTUALLY IS. Its operation and its campaign are rendered from the
  // record itself, so a record for another operation or another campaign says so.
  const foundRecord =
    statusResult !== null && statusResult.ok && statusResult.presence !== 'EMPTY'
      ? statusResult
      : null

  // THE PREVIEW IS THE SNAPSHOT. It renders only while the acknowledgement is CURRENT, so a
  // preview can never describe a situation a later change has already superseded.
  const preview = snapshot !== null && finalizeAcknowledgementCurrent ? snapshot : null

  return (
    <SurfaceCard
      eyebrow={TEAM_ADMIN_CAMPAIGN_LIFECYCLE.eyebrow}
      title={TEAM_ADMIN_CAMPAIGN_LIFECYCLE.title}
      footnote={TEAM_ADMIN_CAMPAIGN_LIFECYCLE.footnote}
    >
      <div className="wizard-preview">
        <p className="wizard-preview__intro">{TEAM_ADMIN_CAMPAIGN_LIFECYCLE.intro}</p>
        <p className="wizard-preview__boundary">{TEAM_ADMIN_CAMPAIGN_LIFECYCLE.boundary}</p>

        {/*
          AXIS 1 — WHAT THE CAMPAIGN IS. Rendered separately from, and above, what this
          product's own attempt did, so no single pill can conflate the two.
        */}
        <div className="wizard-preview__step">
          <p className="wizard-preview__header">
            {TEAM_ADMIN_CAMPAIGN_LIFECYCLE.chainStateTitle}
          </p>
          <div className="wizard-preview__stephead">
            <StatusPill
              label={TEAM_ADMIN_CAMPAIGN_LIFECYCLE.chainStateLabel[disposition.chainState]}
              tone={
                disposition.chainState === 'ACTIVE'
                  ? 'positive'
                  : disposition.chainState === 'PAUSED' ||
                      disposition.chainState === 'FINALIZED'
                    ? 'caution'
                    : 'neutral'
              }
            />
          </div>
          <p className="wizard-preview__purpose">
            {TEAM_ADMIN_CAMPAIGN_LIFECYCLE.chainStateNote[disposition.chainState]}
          </p>
        </div>

        {/*
          AXIS 2 — WHAT THIS PRODUCT'S OWN ATTEMPT DID. Only a matching local durable record
          for this campaign can ever produce a confirmed reading here.
        */}
        <div className="wizard-preview__step">
          <p className="wizard-preview__header">
            {TEAM_ADMIN_CAMPAIGN_LIFECYCLE.attributionTitle}
          </p>
          <div className="wizard-preview__stephead">
            <StatusPill
              label={TEAM_ADMIN_CAMPAIGN_LIFECYCLE.attributionLabel[disposition.attribution]}
              tone={
                disposition.attribution === 'PAUSE_CONFIRMED' ||
                disposition.attribution === 'UNPAUSE_CONFIRMED' ||
                disposition.attribution === 'FINALIZE_CONFIRMED'
                  ? 'positive'
                  : disposition.attribution === 'SUBMITTED' ||
                      disposition.attribution === 'SUPPORT' ||
                      disposition.attribution === 'STATE_INCONSISTENT'
                    ? 'caution'
                    : 'neutral'
              }
            />
          </div>
          <p className="wizard-preview__purpose">
            {TEAM_ADMIN_CAMPAIGN_LIFECYCLE.attributionNote[disposition.attribution]}
          </p>
          {disposition.blocking !== null ? (
            <p className="wizard-preview__fieldnote">
              {TEAM_ADMIN_CAMPAIGN_LIFECYCLE.blockingNote[disposition.blocking]}
            </p>
          ) : null}
        </div>

        <div className="wizard-preview__step">
          <p className="wizard-preview__header">
            {TEAM_ADMIN_CAMPAIGN_LIFECYCLE.authorityTitle}
          </p>
          <div className="wizard-preview__stephead">
            <StatusPill
              label={campaignAuthority}
              tone={authorityConfirmed ? 'positive' : 'neutral'}
            />
          </div>
          <p className="wizard-preview__purpose">
            {TEAM_ADMIN_CAMPAIGN_LIFECYCLE.authority[campaignAuthority]}
          </p>
          {campaignAddress !== null ? (
            <MetricRow
              label={TEAM_ADMIN_CAMPAIGN_LIFECYCLE.previewCampaignLabel}
              value={shortenLifecycleAddress(campaignAddress)}
              hint="the campaign these steps would act on"
            />
          ) : null}
        </div>

        <div className="wizard-preview__step">
          <p className="wizard-preview__header">{TEAM_ADMIN_CAMPAIGN_LIFECYCLE.walletTitle}</p>
          <p className="wizard-preview__purpose">{TEAM_ADMIN_CAMPAIGN_LIFECYCLE.walletNote}</p>
          {approvedTeamWallet === null ? (
            <p className="wizard-preview__fieldwarning">
              {TEAM_ADMIN_CAMPAIGN_LIFECYCLE.walletCarrierUnavailable}
            </p>
          ) : (
            <MetricRow
              label={TEAM_ADMIN_CAMPAIGN_LIFECYCLE.approvedKeyLabel}
              value={shortenLifecycleAddress(approvedTeamWallet)}
              hint="configured for this deployment; never taken from the connected wallet"
            />
          )}
        </div>

        {/*
          THE EMERGENCY-PAUSE BOUNDARY, stated as two separate facts so neither erases the
          other: what the PROGRAM accepts, and what this BROWSER PRODUCT exposes. There is no
          control in this block — it is read-only explanatory copy, and the emergency
          authority is not a value this file holds.
        */}
        <div className="wizard-preview__step">
          <p className="wizard-preview__header">{TEAM_ADMIN_CAMPAIGN_LIFECYCLE.emergencyTitle}</p>
          <p className="wizard-preview__purpose">
            {TEAM_ADMIN_CAMPAIGN_LIFECYCLE.emergencyProgramNote}
          </p>
          <p className="wizard-preview__fieldnote">
            {TEAM_ADMIN_CAMPAIGN_LIFECYCLE.emergencyProductNote}
          </p>
        </div>

        {/* THE DEADLINE AND CAP BOUNDARY. Neither triggers a lifecycle step. */}
        <div className="wizard-preview__step">
          <p className="wizard-preview__header">{TEAM_ADMIN_CAMPAIGN_LIFECYCLE.deadlineTitle}</p>
          <p className="wizard-preview__purpose">{TEAM_ADMIN_CAMPAIGN_LIFECYCLE.deadlineNote}</p>
        </div>

        {/* THE HOLDER CONCURRENCY BOUNDARY. Chain execution order decides, never click order. */}
        <div className="wizard-preview__step">
          <p className="wizard-preview__header">
            {TEAM_ADMIN_CAMPAIGN_LIFECYCLE.holderRaceTitle}
          </p>
          <p className="wizard-preview__purpose">{TEAM_ADMIN_CAMPAIGN_LIFECYCLE.holderRaceNote}</p>
        </div>

        <div className="wizard-preview__step">
          <p className="wizard-preview__header">{TEAM_ADMIN_CAMPAIGN_LIFECYCLE.pauseTitle}</p>
          <ul>
            {TEAM_ADMIN_CAMPAIGN_LIFECYCLE.pauseRules.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <div className="wizard-preview__stepfoot">
            {/*
              MUTATION-ACTION CONTROL 1 of 4. Declared exactly once in this file. There is no
              retry affordance beside it, and a later legal Pause after a real intervening
              Unpause is a NEW occurrence rather than a repeat of this one.
            */}
            <button
              className="wallet-badge__btn"
              disabled={!pauseEnabled}
              onClick={() => {
                void handlePauseCampaign()
              }}
              type="button"
            >
              {operation === 'pause'
                ? TEAM_ADMIN_CAMPAIGN_LIFECYCLE.pauseActionBusyLabel
                : TEAM_ADMIN_CAMPAIGN_LIFECYCLE.pauseActionLabel}
            </button>
            <p className="wizard-preview__fieldnote">
              {pauseEnabled
                ? TEAM_ADMIN_CAMPAIGN_LIFECYCLE.pauseActionHelp
                : TEAM_ADMIN_CAMPAIGN_LIFECYCLE.pauseActionBlockedHelp}
            </p>

        {/*
          THE VISIBLE SOL LINE AND ITS EXPLICIT READ-ONLY RE-CHECK. They appear together and
          only while the balance is not a plain known-sufficient one — a hidden button explains
          nothing, and a sufficient balance needs no sentence and no amount.

          The button is READ-ONLY and is NOT a mutation transaction action: this panel's
          transaction-control count is unchanged by it.
        */}
        {pauseSolPreflightNote !== null ? (
          <div className="wizard-preview__policy">
            <p className="wizard-preview__fieldnote">{pauseSolPreflightNote}</p>
            <button
              className="wallet-badge__btn"
              disabled={!pauseSolPreflightActionable || busy || pauseSolPreflight.kind === 'reading'}
              onClick={handlePauseSolPreflightRecheck}
              type="button"
            >
              {TEAM_ADMIN_SOL_PREFLIGHT_RECHECK_LABEL}
            </button>
          </div>
        ) : null}
          </div>
        </div>

        <div className="wizard-preview__step">
          <p className="wizard-preview__header">{TEAM_ADMIN_CAMPAIGN_LIFECYCLE.unpauseTitle}</p>
          <ul>
            {TEAM_ADMIN_CAMPAIGN_LIFECYCLE.unpauseRules.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <div className="wizard-preview__stepfoot">
            {/* MUTATION-ACTION CONTROL 2 of 4. */}
            <button
              className="wallet-badge__btn"
              disabled={!unpauseEnabled}
              onClick={() => {
                void handleUnpauseCampaign()
              }}
              type="button"
            >
              {operation === 'unpause'
                ? TEAM_ADMIN_CAMPAIGN_LIFECYCLE.unpauseActionBusyLabel
                : TEAM_ADMIN_CAMPAIGN_LIFECYCLE.unpauseActionLabel}
            </button>
            <p className="wizard-preview__fieldnote">
              {unpauseEnabled
                ? TEAM_ADMIN_CAMPAIGN_LIFECYCLE.unpauseActionHelp
                : TEAM_ADMIN_CAMPAIGN_LIFECYCLE.unpauseActionBlockedHelp}
            </p>

        {/*
          THE VISIBLE SOL LINE AND ITS EXPLICIT READ-ONLY RE-CHECK. They appear together and
          only while the balance is not a plain known-sufficient one — a hidden button explains
          nothing, and a sufficient balance needs no sentence and no amount.

          The button is READ-ONLY and is NOT a mutation transaction action: this panel's
          transaction-control count is unchanged by it.
        */}
        {unpauseSolPreflightNote !== null ? (
          <div className="wizard-preview__policy">
            <p className="wizard-preview__fieldnote">{unpauseSolPreflightNote}</p>
            <button
              className="wallet-badge__btn"
              disabled={!unpauseSolPreflightActionable || busy || unpauseSolPreflight.kind === 'reading'}
              onClick={handleUnpauseSolPreflightRecheck}
              type="button"
            >
              {TEAM_ADMIN_SOL_PREFLIGHT_RECHECK_LABEL}
            </button>
          </div>
        ) : null}
          </div>
        </div>

        <div className="wizard-preview__step">
          <p className="wizard-preview__header">{TEAM_ADMIN_CAMPAIGN_LIFECYCLE.finalizeTitle}</p>
          <ul>
            {TEAM_ADMIN_CAMPAIGN_LIFECYCLE.finalizeRules.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          {/*
            THE LOCAL REVIEW CONTROL. It is deliberately NOT one of the four mutation-action
            controls and is never counted as one: it opens no wallet, signs nothing, sends
            nothing, reaches no network and writes nothing. It is also the only route to the
            terminal control, which is why it is declared before it and separately from it.
          */}
          <button
            className="wallet-badge__btn"
            disabled={!reviewEnabled}
            onClick={() => {
              handleReviewFinalization()
            }}
            type="button"
          >
            {TEAM_ADMIN_CAMPAIGN_LIFECYCLE.reviewActionLabel}
          </button>
          <p className="wizard-preview__fieldnote">
            {reviewEnabled
              ? TEAM_ADMIN_CAMPAIGN_LIFECYCLE.reviewActionHelp
              : TEAM_ADMIN_CAMPAIGN_LIFECYCLE.reviewActionBlockedHelp}
          </p>
          {disposition.finalizeAcknowledgementRequired ? (
            <p className="wizard-preview__fieldnote">
              {TEAM_ADMIN_CAMPAIGN_LIFECYCLE.finalizeAcknowledgementRequiredNote}
            </p>
          ) : null}
        </div>

        {/*
          THE FINAL PREVIEW, rendered immediately before the one gesture that cannot be
          undone. Every value here comes out of the frozen acknowledgement, and the request
          below is that same acknowledgement through one projection.
        */}
        {preview !== null ? (
          <div className="wizard-preview__step">
            <p className="wizard-preview__header">
              {TEAM_ADMIN_CAMPAIGN_LIFECYCLE.previewTitle}
            </p>
            <p className="wizard-preview__purpose">
              {TEAM_ADMIN_CAMPAIGN_LIFECYCLE.previewIntro}
            </p>
            <MetricRow
              label={TEAM_ADMIN_CAMPAIGN_LIFECYCLE.previewCampaignLabel}
              value={shortenLifecycleAddress(preview.context.campaignAddress)}
            />
            <MetricRow
              label={TEAM_ADMIN_CAMPAIGN_LIFECYCLE.previewPredecessorLabel}
              value={preview.context.campaignStatus}
              hint={TEAM_ADMIN_CAMPAIGN_LIFECYCLE.previewPredecessorHint}
            />
            <p className="wizard-preview__header">
              {TEAM_ADMIN_CAMPAIGN_LIFECYCLE.terminalWarningTitle}
            </p>
            <p className="wizard-preview__fieldwarning">
              {TEAM_ADMIN_CAMPAIGN_LIFECYCLE.terminalWarning}
            </p>

            <div className="wizard-preview__stepfoot">
              {/*
                MUTATION-ACTION CONTROL 3 of 4. Declared exactly once, inside the preview it
                acts on, so a click can only ever carry a campaign the operator has just been
                shown. There is no retry affordance beside it and there never will be.
              */}
              <button
                className="wallet-badge__btn"
                disabled={!finalizeEnabled}
                onClick={() => {
                  void handleFinalizeCampaign()
                }}
                type="button"
              >
                {operation === 'finalize'
                  ? TEAM_ADMIN_CAMPAIGN_LIFECYCLE.finalizeActionBusyLabel
                  : TEAM_ADMIN_CAMPAIGN_LIFECYCLE.finalizeActionLabel}
              </button>
              <p className="wizard-preview__fieldnote">
                {finalizeEnabled
                  ? TEAM_ADMIN_CAMPAIGN_LIFECYCLE.finalizeActionHelp
                  : TEAM_ADMIN_CAMPAIGN_LIFECYCLE.finalizeActionBlockedHelp}
              </p>

        {/*
          THE VISIBLE SOL LINE AND ITS EXPLICIT READ-ONLY RE-CHECK. They appear together and
          only while the balance is not a plain known-sufficient one — a hidden button explains
          nothing, and a sufficient balance needs no sentence and no amount.

          The button is READ-ONLY and is NOT a mutation transaction action: this panel's
          transaction-control count is unchanged by it.
        */}
        {finalizeSolPreflightNote !== null ? (
          <div className="wizard-preview__policy">
            <p className="wizard-preview__fieldnote">{finalizeSolPreflightNote}</p>
            <button
              className="wallet-badge__btn"
              disabled={!finalizeSolPreflightActionable || busy || finalizeSolPreflight.kind === 'reading'}
              onClick={handleFinalizeSolPreflightRecheck}
              type="button"
            >
              {TEAM_ADMIN_SOL_PREFLIGHT_RECHECK_LABEL}
            </button>
          </div>
        ) : null}
            </div>
          </div>
        ) : null}

        {/*
          THE RECOVERED SAVED ATTEMPT. It CARRIES NO CONTROL: there is no submit, no retry and
          no acknowledgement inside it.
        */}
        {recoveryRow !== null ? (
          <div className="wizard-preview__step">
            <p className="wizard-preview__header">
              {TEAM_ADMIN_CAMPAIGN_LIFECYCLE.recoveryTitle}
            </p>
            <p className="wizard-preview__purpose">
              {TEAM_ADMIN_CAMPAIGN_LIFECYCLE.recoveryIntro}
            </p>
            <div className="wizard-preview__stephead">
              <StatusPill
                label={TEAM_ADMIN_CAMPAIGN_LIFECYCLE.attributionLabel[recoveryRow.attribution]}
                tone={
                  recoveryRow.attribution === 'PAUSE_CONFIRMED' ||
                  recoveryRow.attribution === 'UNPAUSE_CONFIRMED' ||
                  recoveryRow.attribution === 'FINALIZE_CONFIRMED'
                    ? 'positive'
                    : recoveryRow.attribution === 'SUBMITTED'
                      ? 'caution'
                      : 'neutral'
                }
              />
            </div>
            <p className="wizard-preview__purpose">
              {TEAM_ADMIN_CAMPAIGN_LIFECYCLE.attributionNote[recoveryRow.attribution]}
            </p>
            <MetricRow
              label={TEAM_ADMIN_CAMPAIGN_LIFECYCLE.recoveryOperationLabel}
              value={TEAM_ADMIN_CAMPAIGN_LIFECYCLE.operationLabel[recoveryRow.operation]}
            />
            <MetricRow
              label={TEAM_ADMIN_CAMPAIGN_LIFECYCLE.previewCampaignLabel}
              value={shortenLifecycleAddress(recoveryRow.campaign)}
              hint="the campaign this saved attempt named"
            />
          </div>
        ) : null}

        <div className="wizard-preview__stepfoot">
          {/*
            MUTATION-ACTION CONTROL 4 of 4, and the ONE status control for the whole surface.
            It reconciles the single saved attempt and re-reads it, and it runs once per
            click: there is no interval, no timer and no automatic reconcile anywhere here.
          */}
          <button
            className="wallet-badge__btn"
            disabled={busy || approvedTeamWallet === null}
            onClick={() => {
              void handleCheckLifecycleStatus()
            }}
            type="button"
          >
            {operation === 'status'
              ? TEAM_ADMIN_CAMPAIGN_LIFECYCLE.statusActionBusyLabel
              : TEAM_ADMIN_CAMPAIGN_LIFECYCLE.statusActionLabel}
          </button>
          <p className="wizard-preview__fieldnote">
            {TEAM_ADMIN_CAMPAIGN_LIFECYCLE.statusActionHelp}
          </p>
          <p className="wizard-preview__purpose">{statusSummary}</p>
          {/*
            THE RECORD AS FOUND. Its own operation and its own campaign, rendered from the
            record — never relabelled because a lifecycle control was what asked for it.
          */}
          {foundRecord !== null ? (
            <>
              <MetricRow
                label={TEAM_ADMIN_CAMPAIGN_LIFECYCLE.statusRecordOperationLabel}
                value={TEAM_ADMIN_CAMPAIGN_LIFECYCLE.operationLabel[foundRecord.operation]}
                hint={TEAM_ADMIN_CAMPAIGN_LIFECYCLE.statusRecordOperationHint}
              />
              <MetricRow
                label={TEAM_ADMIN_CAMPAIGN_LIFECYCLE.statusRecordCampaignLabel}
                value={shortenLifecycleAddress(foundRecord.campaign)}
                hint={TEAM_ADMIN_CAMPAIGN_LIFECYCLE.statusRecordCampaignHint}
              />
              {campaignAddress !== null && foundRecord.campaign !== campaignAddress ? (
                <p className="wizard-preview__fieldwarning">
                  {TEAM_ADMIN_CAMPAIGN_LIFECYCLE.statusRecordForeignCampaignNote}
                </p>
              ) : null}
            </>
          ) : null}
          {chainTruth.freshReadRefused ? (
            <p className="wizard-preview__fieldwarning">
              {TEAM_ADMIN_CAMPAIGN_LIFECYCLE.blockingNote.CHAIN_TRUTH_UNAVAILABLE}
            </p>
          ) : null}
          {reconcileCode !== null ? (
            <p className="wizard-preview__purpose">
              {describeRedaxTeamAdminMutationReconcileCode(reconcileCode)}
            </p>
          ) : null}
        </div>

        {/*
          A root that answers `busy === true` refused to START a second action while one was
          already running — so the refused one built nothing, signed nothing and sent nothing,
          and this campaign was NOT paused, unpaused or finalized by it. It is classified
          HERE, before the generic per-code description, because rendering an action failure
          for it would describe an attempt that does not exist.
        */}
        {submitResult ? (
          <div className="wizard-preview__step">
            <p className="wizard-preview__header">{TEAM_ADMIN_CAMPAIGN_LIFECYCLE.resultTitle}</p>
            <div className="wizard-preview__stephead">
              <StatusPill
                label={
                  submitResult.busy ? 'ANOTHER_TEAM_ADMIN_MUTATION_IS_RUNNING' : submitResult.code
                }
                tone={submitResult.rawBroadcastCount === 1 ? 'caution' : 'neutral'}
              />
            </div>
            <p className="wizard-preview__purpose">
              {submitResult.busy
                ? TEAM_ADMIN_CAMPAIGN_LIFECYCLE.anotherMutationRunning
                : describeRedaxTeamAdminMutationSubmitCode(submitResult.code)}
            </p>
          </div>
        ) : null}

        <div className="wizard-preview__claims">
          <p className="wizard-preview__header">{TEAM_ADMIN_CAMPAIGN_LIFECYCLE.nonClaimsTitle}</p>
          <ul>
            {TEAM_ADMIN_CAMPAIGN_LIFECYCLE.nonClaims.map((claim) => (
              <li key={claim}>{claim}</li>
            ))}
          </ul>
        </div>
      </div>
    </SurfaceCard>
  )
}
