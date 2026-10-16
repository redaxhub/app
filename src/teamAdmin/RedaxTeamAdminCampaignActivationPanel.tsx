// -----------------------------------------------------------------------------
// WHAT THIS FILE IS
// -----------------------------------------------------------------------------
// The FOURTH visible Team/Admin surface, and the THIRD operation consumer of the ONE
// post-init mutation action root. It is a SIBLING of the campaign setup panel and the
// campaign metadata panel under the same provider — not a second provider, not a second
// raw-send owner, not a second wallet broker, not a second journal and not a new storage
// owner.
//
// It exposes exactly ONE of the six post-init operations, and it is not one its siblings
// expose. `ADD_TOKEN_CONFIG`, `SETUP_METADATA`, `PAUSE_CAMPAIGN`, `UNPAUSE_CAMPAIGN` and
// `FINALIZE_CAMPAIGN` are not named in any request this file builds and no control here
// can reach one.
//
// -----------------------------------------------------------------------------
// THE ONE THING THAT MAKES THIS SURFACE DIFFERENT
// -----------------------------------------------------------------------------
// ACTIVATION IS ONE-WAY, AND IT IS TIMED. Phase 1 has no instruction that returns a
// campaign to `initialized`, and both `add_token_config` and `setup_metadata` require
// that state — so this is the step after which the campaign's accepted inputs and its
// output-token name are closed for good. Where the campaign carries an `end_ts`, the
// program additionally requires the CHAIN's own clock to still be before it.
//
// FIRST, THE FINAL CONTROL IS UNREACHABLE UNTIL AN EXPLICIT LOCAL REVIEW HAS RUN.
// `Review activation` freezes the exact setup the operator read — the campaign, its
// admin, its lifecycle state, its metadata flag, its EXACT accepted-input count and its
// `end_ts` — into a memory-only snapshot. It opens no wallet, signs nothing, sends
// nothing, reaches no network, reads no clock and writes no record.
//
// SECOND, THE ACKNOWLEDGEMENT IS DESTROYED RATHER THAN UPDATED. A campaign reselection,
// a loader fallback that stopped agreeing, a changed stored address, admin, lifecycle
// status, metadata flag, accepted-input count or deadline, a changed approved-Team
// carrier and a changed program identity each make the snapshot NOT CURRENT — and a
// snapshot that is not current can neither be previewed nor submitted.
//
// THIRD, THE DEADLINE SHOWN HERE IS NOT THE DEADLINE THAT DECIDES. What is rendered is
// the campaign's own stored `end_ts`, formatted for reading. Whether the window is still
// open is decided by the mutation action root's chain guard, from the CANONICAL CLOCK
// SYSVAR read in the same coherent response as the campaign — at Phase A before a plan
// exists, at Phase B before the wallet is asked, and once more after the wallet returns
// and before the one raw send.
//
// -----------------------------------------------------------------------------
// WHAT IT CANNOT DO
// -----------------------------------------------------------------------------
// It constructs no `Connection` and no transaction object, acquires no `@solana` package
// at all, holds no signer, reaches no raw adapter, opens no RPC of its own, writes no
// storage, takes no Web Lock, reads no environment and draws no entropy.
//
// WHAT IT TOOK IS THE SAME NARROW FACADE the sibling panels take — detected wallets,
// connect, disconnect, status, public key, shortened display — and that facade has NO
// adapter member, NO signing member and NO sending member, so none can be reached from
// here. This panel STILL cannot sign, cannot send, cannot reach the raw adapter, cannot
// reach the sign-only broker and cannot prompt a wallet by itself. It uses connection state
// for PASSIVE SOL AVAILABILITY PRESENTATION only.
//
// AUTHORITY IS UNCHANGED. Whether the wallet approving this transaction is the approved Team
// wallet is still decided inside the action root, against live devnet state, immediately
// before anything is signed — this edge is presentation, never a second trust source.
//
// AND IT READS NO CLOCK. There is no `Date`, no `Date.now`, no `performance` and no
// time-shaped RPC anywhere in this file; the one formatter it calls is pure integer
// arithmetic over a supplied value.
//
// WHAT THE EFFECTS MAY REACH IS EXACTLY ONE THING: the read-only `readMutationSolPreflight`
// member, or a ref write. NONE reaches `submitMutation`, `reconcileMutation`,
// `readMutationStatus`, a journal operation, a wallet signature, a send or a transaction
// construction. There is still NO timer, NO interval, NO poll, NO subscription, NO event
// listener, NO automatic retry and no `<form>`; nothing runs on a clock, and pressing Enter
// submits nothing. NO CLOCK OR DEADLINE LOGIC ENTERS THE PREFLIGHT either — the ACTIVATE
// threshold is the payer rent floor and the fee bound, and nothing else.
//
// ALL THREE ORIGINAL HANDLERS still run from an explicit click and from nowhere else —
// including the local review, and including the read-only status read. The SOL re-check is a
// fourth control and is READ-ONLY: it is not a mutation transaction action and does not
// change this panel's transaction-control count, which stays exactly TWO.
//
// -----------------------------------------------------------------------------
// A LOADED SNAPSHOT IS NOT CHAIN TRUTH, AND THE PANEL IS NOT THE BOUNDARY
// -----------------------------------------------------------------------------
// The campaign props may PREDATE the very attempt they would be used to judge, so they
// are `LOADED_DISPLAY` and the explicit status gesture takes its own reading — reconcile,
// re-read the slot, then read the campaign — in that fixed order.
//
// Before it submits, the activation handler takes ONE more product refresh and compares
// the fresh situation against the ACKNOWLEDGED one. That comparison is a PRODUCT
// freshness check: it can only refuse, it never silently updates the snapshot with fresh
// values, and it is not authority. The mutation root still runs its own authority-grade
// Phase A and its own planner afterwards, so an internal caller that skipped every rule
// on this surface still cannot reach a wallet prompt for a campaign with no accepted
// input or a closed window.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import { MetricRow } from '../components/MetricRow'
import { StatusPill } from '../components/StatusPill'
import { SurfaceCard } from '../components/SurfaceCard'
import {
  TEAM_ADMIN_ACTIVATE_CAMPAIGN,
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
  buildRedaxTeamAdminActivationAcknowledgementContext,
  createRedaxTeamAdminActivationAcknowledgementSnapshot,
  deriveRedaxTeamAdminActivationDisposition,
  formatRedaxTeamAdminActivationDeadline,
  isRedaxTeamAdminActivationAcknowledgementCurrent,
  projectRedaxTeamAdminActivationRecoveryRow,
  redaxTeamAdminActivationSubmitValuesFromSnapshot,
} from './redaxTeamAdminActivationProduct'
import type {
  RedaxTeamAdminActivationAcknowledgementContextInput,
  RedaxTeamAdminActivationAcknowledgementSnapshot,
  RedaxTeamAdminActivationStatusInput,
} from './redaxTeamAdminActivationProduct'
import {
  deriveRedaxTeamAdminSetupCampaignAuthority,
  describeRedaxTeamAdminMutationReconcileCode,
  describeRedaxTeamAdminMutationStatusReadCode,
  describeRedaxTeamAdminMutationSubmitCode,
  runRedaxTeamAdminSetupStatusGesture,
  selectRedaxTeamAdminSetupChainTruth,
} from './RedaxTeamAdminCampaignSetupPanel'
import type {
  RedaxTeamAdminFreshCampaignSetupTruthResult,
  RedaxTeamAdminSetupFreshChainTruth,
} from './RedaxTeamAdminCampaignSetupPanel'

/**
 * Which operation, if any, is running. Rendered state beside the ref latch.
 *
 * The local review is deliberately NOT a member: it awaits nothing, reaches nothing and
 * completes within the click, so there is no in-flight state for it to be in and no busy
 * label that would ever be true.
 */
type ActivationPanelOperation = 'submit' | 'status'

export interface RedaxTeamAdminCampaignActivationPanelProps {
  /**
   * The ONE canonical approved Team wallet, resolved once in App.
   *
   * The SAME value App passes to the mutation provider and to both sibling panels, so no
   * two of them can disagree about who is approved. `null` means the deployment
   * configured no usable carrier, and the whole surface fails closed on it.
   */
  readonly approvedTeamWallet: string | null
  /** Whether the campaign read this panel judges against actually resolved. */
  readonly campaignDataReady: boolean
  /** The campaign id App's loader actually resolved — the fallback may differ. */
  readonly effectiveSelectedCampaignId: string
  /**
   * The ONE canonical runtime program id, resolved once in App.
   *
   * A PUBLIC deployment fact injected at the boundary, exactly like the carrier. It is
   * bound into the acknowledgement so a review taken under one program identity cannot be
   * submitted under another, and `null` fails every path closed.
   */
  readonly programId: string | null
  /**
   * The BOUNDED product refresh, injected by App. It is this panel's ONLY route to a
   * reading it may call fresh, and it is called from the explicit status gesture and from
   * the pre-submit freshness check — and from nowhere else.
   */
  readonly readFreshCampaignSetupTruth: (
    campaignId: string,
  ) => Promise<RedaxTeamAdminFreshCampaignSetupTruthResult>
  /** The LOADED campaign, or `null`. Display and initial review truth only. */
  readonly selectedCampaign: RedaxCampaignView | null
  /** The RAW explicit selection, never the fallback. Admission compares the two. */
  readonly selectedCampaignId: string
}

/**
 * The sanitized status projection, folded into the pure module's structural input.
 *
 * A read that has not happened yet, and a read that failed, are BOTH `UNAVAILABLE`: an
 * unread slot is not a slot known to be empty, and nothing is offered until it has
 * actually been read. Exported so the fold itself is testable without a React tree.
 */
export function toRedaxTeamAdminActivationStatusInput(
  status: RedaxTeamAdminMutationStatusReadResult | null,
): RedaxTeamAdminActivationStatusInput {
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
 * The raw facts one acknowledgement context is built from, gathered in ONE place.
 *
 * Used by the render AND by the pre-submit freshness check, so the situation compared
 * against a frozen snapshot is assembled by the same code both times. Two assemblies
 * would be two answers to "what is the current situation".
 */
export function redaxTeamAdminActivationContextInput(input: {
  readonly rawSelectedCampaignId: string
  readonly effectiveSelectedCampaignId: string
  readonly approvedTeamWallet: string | null
  readonly programId: string | null
  readonly campaign: RedaxCampaignView | null
}): RedaxTeamAdminActivationAcknowledgementContextInput {
  const campaign = input.campaign
  return {
    rawSelectedCampaignId: input.rawSelectedCampaignId,
    effectiveSelectedCampaignId: input.effectiveSelectedCampaignId,
    campaignAddress: campaign?.campaignAddress ?? null,
    campaignAdmin: campaign?.campaignAdmin ?? null,
    campaignStatus: campaign?.programStatus ?? null,
    campaignMetadataSetup: campaign === null ? null : campaign.metadataSetup,
    campaignTokenConfigCount: campaign === null ? null : campaign.tokenConfigCount,
    campaignEndTs: campaign === null ? null : campaign.endTs,
    approvedTeamWallet: input.approvedTeamWallet,
    programId: input.programId,
  }
}

/** Shortened display form (4…4). A full address is never rendered by this panel. */
function shortenActivationAddress(value: string): string {
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
type ActivationSolPreflightState =
  | { kind: 'idle' }
  | { kind: 'reading' }
  | { kind: 'settled'; result: RedaxTeamAdminMutationSolPreflightResult }

const ACTIVATION_SOL_PREFLIGHT_IDLE: ActivationSolPreflightState = { kind: 'idle' }
const ACTIVATION_SOL_PREFLIGHT_READING: ActivationSolPreflightState = { kind: 'reading' }

/**
 * IDENTITY PRIVACY IS A RENDER-TIME RULE, NOT A CLEANUP RACE.
 *
 * A panel-local value is stored together with the EXACT identity scope that produced it and
 * read back through `inScope` while the tree is computed. A value whose recorded scope is
 * not the current one is therefore invisible AND unusable in the very first render that
 * observes a new wallet, campaign or carrier — before any passive effect runs.
 */
interface ActivationScopedState<T> {
  readonly scope: string
  readonly value: T
}

function activationScopedState<T>(scope: string, value: T): ActivationScopedState<T> {
  return { scope, value }
}

function activationInScope<T>(
  record: ActivationScopedState<T>,
  currentScope: string,
  restingValue: T,
): T {
  return record.scope === currentScope ? record.value : restingValue
}

/**
 * THE C1 SCOPE. Its dimensions are the approved Team carrier, the connected wallet, the selected Campaign and the exact operation.
 *
 * THE OPERATION IS A SCOPE DIMENSION IN ITS OWN RIGHT. Two operations may cost the same
 * today; including the discriminant is what makes it impossible for one operation's reading
 * to be consumed as another's, rather than merely unlikely.
 */
export function redaxTeamAdminActivationSolPreflightScope(
  approvedTeamWallet: string | null,
  connectedPublicKey: string | null,
  selectedCampaignId: string,
  operation: RedaxTeamAdminMutationOperation,
): string {
  return `${approvedTeamWallet ?? ''}|${connectedPublicKey ?? ''}|${selectedCampaignId}|${operation}`
}

export function RedaxTeamAdminCampaignActivationPanel({
  approvedTeamWallet,
  campaignDataReady,
  effectiveSelectedCampaignId,
  programId,
  readFreshCampaignSetupTruth,
  selectedCampaign,
  selectedCampaignId,
}: RedaxTeamAdminCampaignActivationPanelProps) {
  const actions = useRedaxTeamAdminMutationActions()
  // THE PUBLIC, CONNECTION-ONLY WALLET FACADE — acquired for C1 presentation and for NOTHING
  // else. It exposes detected wallets, connect, disconnect, status, public key and a
  // shortened display form, and it has NO adapter member, NO signing member and NO sending
  // member — so none can be reached from here. This panel still cannot sign, cannot send,
  // cannot reach the raw adapter and cannot reach the sign-only broker; whether the wallet
  // approving an activation is the approved Team wallet is still decided inside the action
  // root, against live devnet state, immediately before anything is signed.
  const wallet = useRedaxWallet()

  // MEMORY ONLY, all of it, and nowhere else. No storage port, no lock, no fourth owner.
  // A reload discards the acknowledgement; what survives is the durable attempt and
  // whatever the chain holds, and both are read back rather than remembered.
  const [snapshot, setSnapshot] =
    useState<RedaxTeamAdminActivationAcknowledgementSnapshot | null>(null)
  // A monotonic review counter. It is not a clock and not entropy — this file reads
  // neither — and it exists so an acknowledgement is bound to the exact review it was
  // taken from rather than to a situation that merely looks the same again later.
  const [acknowledgementGeneration, setAcknowledgementGeneration] = useState<number>(0)
  const [freshChainTruth, setFreshChainTruth] =
    useState<RedaxTeamAdminSetupFreshChainTruth | null>(null)
  const [statusResult, setStatusResult] = useState<RedaxTeamAdminMutationStatusReadResult | null>(
    null,
  )
  const [submitResult, setSubmitResult] = useState<RedaxTeamAdminMutationSubmitResult | null>(null)
  const [reconcileCode, setReconcileCode] = useState<RedaxTeamAdminMutationReconcileCode | null>(
    null,
  )
  const [operation, setOperation] = useState<ActivationPanelOperation | null>(null)

  // The synchronous latch. A `disabled` attribute alone would not do: two clicks inside
  // one frame both observe the same rendered state.
  const inFlightRef = useRef<ActivationPanelOperation | null>(null)

  const busy = operation !== null

  // WHICH READING THIS RENDER RESTS ON, decided in one place and used everywhere below.
  // Reused from the setup panel rather than re-derived: three answers to "which campaign
  // reading is current" would be three answers to the same question.
  const chainTruth = selectRedaxTeamAdminSetupChainTruth({
    selectedCampaignId,
    freshChainTruth,
    loadedCampaign: selectedCampaign,
    loadedTokenConfigs: [],
  })
  const authoritativeCampaign = chainTruth.campaign

  // THE SAME classifier both sibling panels use, imported rather than restated. A third
  // campaign-authority classifier would be a third answer to the one question that decides
  // whether a campaign may be written to at all — and `campaigns[0]` can never satisfy it,
  // because it demands that the RAW selection and the EFFECTIVE one agree.
  const campaignAuthority = deriveRedaxTeamAdminSetupCampaignAuthority({
    approvedTeamWallet,
    selectedCampaignId,
    effectiveSelectedCampaignId,
    selectedCampaign: authoritativeCampaign,
  })
  const authorityConfirmed = campaignAuthority === 'EXPLICIT_SELECTION_CONFIRMED'
  // The connected identity this panel's C1 reads about, from the public facade above.
  const connectedPublicKeyForSolPreflight = wallet.publicKeyBase58

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

  // --- C1 devnet SOL availability for ACTIVATE_CAMPAIGN ------------------------------
  //
  //     NO CLOCK OR DEADLINE LOGIC ENTERS THIS PREFLIGHT. The ACTIVATE threshold is the payer
  //     rent floor and the fee bound; `end_ts`, the Clock sysvar read and the three-phase
  //     deadline recheck are ADMISSION facts owned elsewhere and are no part of it.
  const activationSolPreflightScope = redaxTeamAdminActivationSolPreflightScope(
    approvedTeamWallet,
    connectedPublicKeyForSolPreflight,
    selectedCampaignId,
    'ACTIVATE_CAMPAIGN',
  )
  // ACTIONABLE means "worth reading a balance about": a carrier exists, a wallet is
  // connected, that wallet is EXACTLY the approved Team, and this campaign is the explicitly
  // confirmed one. Any other identity resolves to `idle` — this panel does not read, and does
  // not report, a balance belonging to a wallet that could not pay for this operation anyway.
  const activationSolPreflightActionable = approvedTeamWallet !== null &&
    connectedPublicKeyForSolPreflight !== null &&
    connectedPublicKeyForSolPreflight === approvedTeamWallet &&
    wallet.status === 'connected' &&
    authorityConfirmed &&
    selectedCampaignId !== ''

  const [activationSolPreflightRecord, setActivationSolPreflightRecord] = useState<
    ActivationScopedState<ActivationSolPreflightState>
  >(() =>
    activationScopedState(
      activationSolPreflightScope,
      activationSolPreflightActionable ? ACTIVATION_SOL_PREFLIGHT_READING : ACTIVATION_SOL_PREFLIGHT_IDLE,
    ),
  )

  // RENDER-TIME IDENTITY GATING. The projection collapses to its neutral resting value the
  // moment the identity that produced it stops being current — in THIS render, not in a later
  // effect. A wallet or campaign change therefore invalidates an old reading immediately.
  const activationSolPreflight = activationInScope(
    activationSolPreflightRecord,
    activationSolPreflightScope,
    activationSolPreflightActionable ? ACTIVATION_SOL_PREFLIGHT_READING : ACTIVATION_SOL_PREFLIGHT_IDLE,
  )

  const committedActivationSolPreflightScopeRef = useRef(activationSolPreflightScope)
  const activationSolPreflightGenerationRef = useRef(0)

  useLayoutEffect(() => {
    committedActivationSolPreflightScopeRef.current = activationSolPreflightScope
  }, [activationSolPreflightScope])

  // EVERY ASYNC COMPLETION MUST PROVE THREE THINGS before it may write state: still mounted,
  // the COMMITTED scope is the one the read started in, and the read is still the newest.
  const isActivationSolPreflightCurrent = useCallback(
    (scopeKey: string, generation: number): boolean => {
      return (
        solPreflightMountedRef.current &&
        committedActivationSolPreflightScopeRef.current === scopeKey &&
        activationSolPreflightGenerationRef.current === generation
      )
    },
    [],
  )

  // ONE read-only devnet SOL read for THIS operation. It builds nothing, signs nothing, sends
  // nothing, confirms nothing, touches no durable record and returns no authorization. Each
  // call supersedes the previous one, so a slow earlier read can never be the last writer.
  const runActivationSolPreflightRead = useCallback(
    async (scopeKey: string): Promise<void> => {
      activationSolPreflightGenerationRef.current += 1
      const generation = activationSolPreflightGenerationRef.current
      setActivationSolPreflightRecord(activationScopedState(scopeKey, ACTIVATION_SOL_PREFLIGHT_READING))
      try {
        const result = await readMutationSolPreflightRef.current('ACTIVATE_CAMPAIGN')
        if (!isActivationSolPreflightCurrent(scopeKey, generation)) {
          return
        }
        setActivationSolPreflightRecord(
          activationScopedState<ActivationSolPreflightState>(scopeKey, { kind: 'settled', result }),
        )
      } catch {
        // A REJECTED read is not an observation. It settles as READ_UNAVAILABLE — which
        // WITHHOLDS the action — rather than as an unhandled rejection or an optimistic
        // sufficiency. No raw error is read, rendered or logged.
        if (!isActivationSolPreflightCurrent(scopeKey, generation)) {
          return
        }
        setActivationSolPreflightRecord(
          activationScopedState<ActivationSolPreflightState>(scopeKey, {
            kind: 'settled',
            result: 'READ_UNAVAILABLE',
          }),
        )
      }
    },
    [isActivationSolPreflightCurrent],
  )

  // EXACTLY ONE AUTOMATIC READ PER NEW ACTIONABLE SCOPE, and no more. No timer, no interval,
  // no polling, no subscription and no automatic retry: a stale reading is corrected by the
  // explicit human re-check, never by this panel deciding on its own to ask again.
  useEffect(() => {
    if (!activationSolPreflightActionable) {
      setActivationSolPreflightRecord(activationScopedState(activationSolPreflightScope, ACTIVATION_SOL_PREFLIGHT_IDLE))
      return
    }
    void runActivationSolPreflightRead(activationSolPreflightScope)
  }, [activationSolPreflightActionable, activationSolPreflightScope, runActivationSolPreflightRead])

  // KNOWN-SUFFICIENT ONLY. A reading, an idle projection and a failed read all resolve to
  // false, because an unknown balance must WITHHOLD an action rather than allow one.
  const activationSolPreflightSufficient = activationSolPreflight.kind === 'settled' && activationSolPreflight.result === 'SUFFICIENT'

  const activationSolPreflightNote: string | null =
    activationSolPreflight.kind === 'reading'
      ? TEAM_ADMIN_SOL_PREFLIGHT_READING
      : activationSolPreflight.kind === 'idle'
        ? null
        : activationSolPreflight.result === 'INSUFFICIENT'
          ? TEAM_ADMIN_SOL_PREFLIGHT_INSUFFICIENT
          : activationSolPreflight.result === 'READ_UNAVAILABLE'
            ? TEAM_ADMIN_SOL_PREFLIGHT_UNAVAILABLE
            : null

  /**
   * THE EXPLICIT, READ-ONLY SOL RE-CHECK FOR ACTIVATE_CAMPAIGN. It runs ONLY from its own click.
   *
   * It builds nothing, signs nothing, sends nothing, confirms nothing, writes no durable
   * record and returns no authorization, and there is no timer, no poll, no storage event and
   * no subscription behind it. IT IS NOT A MUTATION ACTION: it does not take the
   * single-flight latch, does not set `operation`, and never counts toward this panel's
   * transaction-control census. It re-reads EXACTLY this operation and supersedes only its
   * own previous read.
   */
  const handleActivationSolPreflightRecheck = useCallback((): void => {
    if (activationSolPreflightScope !== committedActivationSolPreflightScopeRef.current) {
      return
    }
    if (!activationSolPreflightActionable || busy || activationSolPreflight.kind === 'reading') {
      return
    }
    void runActivationSolPreflightRead(activationSolPreflightScope)
  }, [busy, runActivationSolPreflightRead, activationSolPreflight.kind, activationSolPreflightActionable, activationSolPreflightScope])
  const deploymentConfigured = approvedTeamWallet !== null && programId !== null

  // CHAIN TRUTH OR NOTHING. While the campaign read is in flight or refused, every fact
  // this judgment rests on is `null` rather than the last one seen, and a null refuses.
  const usableCampaign: RedaxCampaignView | null =
    campaignDataReady && authoritativeCampaign !== null && !chainTruth.freshReadRefused
      ? authoritativeCampaign
      : null
  const freshCampaignStatus: string | null = usableCampaign?.programStatus ?? null
  const freshMetadataSetup: boolean | null = usableCampaign === null ? null : usableCampaign.metadataSetup
  const freshTokenConfigCount: number | null =
    usableCampaign === null ? null : usableCampaign.tokenConfigCount
  const campaignAddress = authoritativeCampaign?.campaignAddress ?? null

  // THE IMMUTABLE CONTEXT an acknowledgement is bound to. Rebuilt on every render from
  // current facts and never remembered: the snapshot is compared against THIS, so a fact
  // that moved is a snapshot that is no longer current, in one place.
  const acknowledgementContext = useMemo(
    () =>
      buildRedaxTeamAdminActivationAcknowledgementContext(
        redaxTeamAdminActivationContextInput({
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

  const acknowledgementCurrent = isRedaxTeamAdminActivationAcknowledgementCurrent(
    snapshot,
    acknowledgementContext,
    acknowledgementGeneration,
  )

  const statusInput = useMemo(
    () => toRedaxTeamAdminActivationStatusInput(statusResult),
    [statusResult],
  )

  const disposition = deriveRedaxTeamAdminActivationDisposition({
    deploymentConfigured,
    authorityConfirmed,
    campaignAddress,
    campaignStatus: freshCampaignStatus,
    campaignMetadataSetup: freshMetadataSetup,
    campaignTokenConfigCount: freshTokenConfigCount,
    status: statusInput,
    acknowledgementCurrent,
  })

  const recoveryRow = useMemo(
    () =>
      projectRedaxTeamAdminActivationRecoveryRow({
        status: statusInput,
        campaignAddress,
        campaignStatus: freshCampaignStatus,
      }),
    [campaignAddress, freshCampaignStatus, statusInput],
  )

  const deadline = formatRedaxTeamAdminActivationDeadline(usableCampaign?.endTs ?? null)

  const reviewEnabled = disposition.reviewAdmissible && acknowledgementContext !== null && !busy

  const activateEnabled =
    disposition.activateAdmissible &&
    snapshot !== null &&
    acknowledgementCurrent &&
    authorityConfirmed &&
    // Stated again beside the disposition rather than left implicit in it: a refused
    // refresh disables the one-way step even if the product machine were ever to change
    // its mind about what a refusal implies.
    !chainTruth.freshReadRefused &&
    !busy &&
    activationSolPreflightSufficient

  /**
   * THE LOCAL REVIEW. It is NOT a mutation-action control.
   *
   * It signs nothing, sends nothing, opens no wallet, performs no RPC, reads no clock,
   * writes no journal record and writes no storage. It advances the review generation and
   * freezes the exact situation the operator has just been shown.
   */
  const handleReview = useCallback((): void => {
    if (inFlightRef.current !== null) {
      return
    }
    const context = acknowledgementContext
    if (context === null) {
      return
    }
    const reviewedGeneration = acknowledgementGeneration + 1
    setAcknowledgementGeneration(reviewedGeneration)
    setSnapshot(createRedaxTeamAdminActivationAcknowledgementSnapshot(reviewedGeneration, context))
  }, [acknowledgementContext, acknowledgementGeneration])

  /**
   * THE ONE ONE-WAY WRITE, from an explicit click and nowhere else.
   *
   * The latch is CLAIMED synchronously before the first await, so a second click in the
   * same frame cannot pass. Then a PRODUCT freshness check runs: one bounded refresh, and
   * the fresh situation is compared against the ACKNOWLEDGED one. A mismatch DESTROYS the
   * acknowledgement and returns — it never rewrites the snapshot with the fresh values,
   * and it never auto-acknowledges, because either would submit a situation nobody read.
   *
   * That check is NOT the security boundary and does not pretend to be. The mutation root
   * runs its own authority-grade Phase A, its own planner and its own coherent Campaign +
   * Clock re-reads afterwards, and refuses there regardless of what happened here.
   */
  const handleActivate = useCallback(async (): Promise<void> => {
    if (inFlightRef.current !== null) {
      return
    }
    const acknowledged = snapshot
    // The rendered control is already disabled without these; the handler asserts them
    // again because a disabled attribute is a rendering, not a gate.
    if (acknowledged === null || !acknowledgementCurrent || !authorityConfirmed) {
      return
    }
    // THE COMMITTED C1 PROJECTION, RE-ASSERTED SYNCHRONOUSLY. The rendered gate can be one
    // commit behind the identity a click actually belongs to, so the handler repeats the
    // check against the scope that is COMMITTED right now rather than trusting the disabled
    // attribute that let the click through.
    //
    // THIS IS NOT AUTHORITY. `submitMutation` reads the balance again itself, on the
    // attempt's own Connection and at the attempt's own floor, and refuses there regardless.
    if (
      activationSolPreflightScope !== committedActivationSolPreflightScopeRef.current ||
      !activationSolPreflightSufficient
    ) {
      return
    }
    const gestureCampaignId = selectedCampaignId
    inFlightRef.current = 'submit'
    setOperation('submit')
    setReconcileCode(null)
    setFreshChainTruth(null)
    try {
      const fresh = await readFreshCampaignSetupTruth(gestureCampaignId)
      const freshTruth: RedaxTeamAdminSetupFreshChainTruth = fresh.ok
        ? {
            kind: 'OK',
            campaignId: gestureCampaignId,
            campaign: fresh.campaign,
            tokenConfigs: fresh.tokenConfigs,
          }
        : { kind: 'REFUSED', campaignId: gestureCampaignId, code: fresh.code }
      setFreshChainTruth(freshTruth)
      if (!fresh.ok) {
        // A refused refresh is not permission to proceed on the reading it was taken to
        // supersede. The acknowledgement is destroyed and nothing is submitted.
        setSnapshot(null)
        return
      }
      const freshContext = buildRedaxTeamAdminActivationAcknowledgementContext(
        redaxTeamAdminActivationContextInput({
          rawSelectedCampaignId: gestureCampaignId,
          effectiveSelectedCampaignId,
          approvedTeamWallet,
          programId,
          campaign: fresh.campaign,
        }),
      )
      if (
        !isRedaxTeamAdminActivationAcknowledgementCurrent(
          acknowledged,
          freshContext,
          acknowledged.acknowledgementGeneration,
        )
      ) {
        setSnapshot(null)
        return
      }
      const values = redaxTeamAdminActivationSubmitValuesFromSnapshot(acknowledged)
      const result = await actions.submitMutation({
        operation: 'ACTIVATE_CAMPAIGN',
        campaign: values.campaign,
      })
      setSubmitResult(result)
      // THE READING IS SPENT. Whatever the chain said before this attempt says nothing
      // about the chain after it.
      setFreshChainTruth(null)
      setSnapshot(null)
      // A READ, never a reconcile. The next state has to come from the durable record
      // rather than from what this handler happens to remember.
      setStatusResult(await actions.readMutationStatus())
    } finally {
      inFlightRef.current = null
      setOperation(null)
    }
  }, [
    acknowledgementCurrent,
    actions,
    activationSolPreflightScope,
    activationSolPreflightSufficient,
    approvedTeamWallet,
    authorityConfirmed,
    effectiveSelectedCampaignId,
    programId,
    readFreshCampaignSetupTruth,
    selectedCampaignId,
    snapshot,
  ])

  /**
   * THE ONE STATUS PATH, from an explicit click and nowhere else.
   *
   * Reconcile, re-read the slot, then read the campaign — in that fixed order, so the
   * account reading is strictly newer than the journal reading it is judged beside.
   * Neither step signs, prompts a wallet, builds anything, sends anything or starts a new
   * attempt, which is why it needs no connected wallet and is safe after a reload. It runs
   * once, from one click: nothing here polls and nothing schedules a second run.
   */
  const handleCheckActivationStatus = useCallback(async (): Promise<void> => {
    if (inFlightRef.current !== null) {
      return
    }
    // The campaign this gesture is ABOUT, read once before the first await.
    const gestureCampaignId = selectedCampaignId
    inFlightRef.current = 'status'
    setOperation('status')
    setFreshChainTruth(null)
    try {
      const outcome = await runRedaxTeamAdminSetupStatusGesture(
        {
          reconcileMutation: () => actions.reconcileMutation(),
          readMutationStatus: () => actions.readMutationStatus(),
          readFreshCampaignSetupTruth,
        },
        gestureCampaignId,
      )
      setReconcileCode(outcome.reconcileCode)
      setStatusResult(outcome.status)
      // Written WITH its campaign. A late arrival for a superseded selection is discarded
      // on every render by the same rule that discards a stale one.
      setFreshChainTruth(outcome.freshChainTruth)
    } finally {
      inFlightRef.current = null
      setOperation(null)
    }
  }, [actions, readFreshCampaignSetupTruth, selectedCampaignId])

  const statusSummary =
    statusResult === null
      ? TEAM_ADMIN_ACTIVATE_CAMPAIGN.statusUnread
      : !statusResult.ok
        ? describeRedaxTeamAdminMutationStatusReadCode(statusResult.code)
        : statusResult.presence === 'EMPTY'
          ? TEAM_ADMIN_ACTIVATE_CAMPAIGN.statusEmpty
          : TEAM_ADMIN_ACTIVATE_CAMPAIGN.stateNote[disposition.state]

  // THE PREVIEW IS THE SNAPSHOT. It renders only while the acknowledgement is CURRENT, so
  // a preview can never describe a situation a later change has already superseded.
  const preview = snapshot !== null && acknowledgementCurrent ? snapshot : null

  return (
    <SurfaceCard
      eyebrow={TEAM_ADMIN_ACTIVATE_CAMPAIGN.eyebrow}
      title={TEAM_ADMIN_ACTIVATE_CAMPAIGN.title}
      footnote={TEAM_ADMIN_ACTIVATE_CAMPAIGN.footnote}
    >
      <div className="wizard-preview">
        <p className="wizard-preview__intro">{TEAM_ADMIN_ACTIVATE_CAMPAIGN.intro}</p>
        <p className="wizard-preview__boundary">{TEAM_ADMIN_ACTIVATE_CAMPAIGN.boundary}</p>

        <div className="wizard-preview__stephead">
          <StatusPill
            label={TEAM_ADMIN_ACTIVATE_CAMPAIGN.stateLabel[disposition.state]}
            tone={
              disposition.state === 'CAMPAIGN_ACTIVATED'
                ? 'positive'
                : disposition.state === 'SUBMITTED_ATTEMPT' ||
                    disposition.state === 'BLOCKED_SUPPORT' ||
                    disposition.state === 'POST_ACTIVATION_STATE_UNATTRIBUTED'
                  ? 'caution'
                  : 'neutral'
            }
          />
        </div>
        <p className="wizard-preview__purpose">
          {TEAM_ADMIN_ACTIVATE_CAMPAIGN.stateNote[disposition.state]}
        </p>
        {disposition.blocking !== null ? (
          <p className="wizard-preview__fieldnote">
            {TEAM_ADMIN_ACTIVATE_CAMPAIGN.blockingNote[disposition.blocking]}
          </p>
        ) : null}

        <div className="wizard-preview__step">
          <p className="wizard-preview__header">{TEAM_ADMIN_ACTIVATE_CAMPAIGN.authorityTitle}</p>
          <div className="wizard-preview__stephead">
            <StatusPill
              label={campaignAuthority}
              tone={authorityConfirmed ? 'positive' : 'neutral'}
            />
          </div>
          <p className="wizard-preview__purpose">
            {TEAM_ADMIN_ACTIVATE_CAMPAIGN.authority[campaignAuthority]}
          </p>
          {campaignAddress !== null ? (
            <MetricRow
              label={TEAM_ADMIN_ACTIVATE_CAMPAIGN.previewCampaignLabel}
              value={shortenActivationAddress(campaignAddress)}
              hint="the campaign this step would activate"
            />
          ) : null}
        </div>

        <div className="wizard-preview__step">
          <p className="wizard-preview__header">{TEAM_ADMIN_ACTIVATE_CAMPAIGN.walletTitle}</p>
          <p className="wizard-preview__purpose">{TEAM_ADMIN_ACTIVATE_CAMPAIGN.walletNote}</p>
          {approvedTeamWallet === null ? (
            <p className="wizard-preview__fieldwarning">
              {TEAM_ADMIN_ACTIVATE_CAMPAIGN.walletCarrierUnavailable}
            </p>
          ) : (
            <MetricRow
              label={TEAM_ADMIN_ACTIVATE_CAMPAIGN.approvedKeyLabel}
              value={shortenActivationAddress(approvedTeamWallet)}
              hint="configured for this deployment; never taken from the connected wallet"
            />
          )}
        </div>

        {/*
          THE PREREQUISITES, SPLIT. The program's own preconditions and REDAX's extra one
          are rendered from two separate lists so no sentence can attribute the product's
          accepted-input rule to the program.
        */}
        <div className="wizard-preview__step">
          <p className="wizard-preview__header">
            {TEAM_ADMIN_ACTIVATE_CAMPAIGN.prerequisitesTitle}
          </p>
          <ul>
            {TEAM_ADMIN_ACTIVATE_CAMPAIGN.programPrerequisites.map((line) => (
              <li key={line}>{line}</li>
            ))}
            {TEAM_ADMIN_ACTIVATE_CAMPAIGN.productPrerequisites.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <MetricRow
            label={TEAM_ADMIN_ACTIVATE_CAMPAIGN.metadataStateLabel}
            value={
              freshMetadataSetup === true
                ? TEAM_ADMIN_ACTIVATE_CAMPAIGN.metadataStateSet
                : TEAM_ADMIN_ACTIVATE_CAMPAIGN.metadataStateNotSet
            }
          />
          {freshTokenConfigCount !== null ? (
            <MetricRow
              label={TEAM_ADMIN_ACTIVATE_CAMPAIGN.tokenConfigCountLabel}
              value={String(freshTokenConfigCount)}
              hint={TEAM_ADMIN_ACTIVATE_CAMPAIGN.tokenConfigCountHint}
            />
          ) : null}
        </div>

        {/*
          THE CAMPAIGN WINDOW. Rendered from the campaign's own stored value through one
          pure formatter that reads no clock — and it decides nothing. The chain's own
          clock is what admits or refuses the attempt, three separate times.
        */}
        <div className="wizard-preview__step">
          <p className="wizard-preview__header">{TEAM_ADMIN_ACTIVATE_CAMPAIGN.deadlineTitle}</p>
          {deadline.kind === 'UTC' ? (
            <MetricRow
              label={TEAM_ADMIN_ACTIVATE_CAMPAIGN.deadlineLabel}
              value={deadline.text}
              hint={TEAM_ADMIN_ACTIVATE_CAMPAIGN.deadlineAuthorityNote}
            />
          ) : (
            <p className="wizard-preview__fieldnote">
              {deadline.kind === 'NONE'
                ? TEAM_ADMIN_ACTIVATE_CAMPAIGN.deadlineNone
                : TEAM_ADMIN_ACTIVATE_CAMPAIGN.deadlineUnavailable}
            </p>
          )}
          <p className="wizard-preview__purpose">
            {TEAM_ADMIN_ACTIVATE_CAMPAIGN.deadlineAuthorityNote}
          </p>
        </div>

        {/*
          THE LOCAL REVIEW CONTROL. It is deliberately NOT one of the two mutation-action
          controls and is never counted as one: it opens no wallet, signs nothing, sends
          nothing, reaches no network and writes nothing. It is also the only route to the
          final control, which is why it is declared before it and separately from it.
        */}
        <div className="wizard-preview__step">
          <p className="wizard-preview__header">{TEAM_ADMIN_ACTIVATE_CAMPAIGN.reviewTitle}</p>
          <button
            className="wallet-badge__btn"
            disabled={!reviewEnabled}
            onClick={() => {
              handleReview()
            }}
            type="button"
          >
            {TEAM_ADMIN_ACTIVATE_CAMPAIGN.reviewActionLabel}
          </button>
          <p className="wizard-preview__fieldnote">
            {reviewEnabled
              ? TEAM_ADMIN_ACTIVATE_CAMPAIGN.reviewActionHelp
              : TEAM_ADMIN_ACTIVATE_CAMPAIGN.reviewActionBlockedHelp}
          </p>
        </div>

        {/*
          THE FINAL PREVIEW, rendered immediately before the one gesture that cannot be
          undone. Every value here comes out of the frozen acknowledgement, and the request
          below is that same acknowledgement through one projection.
        */}
        {preview !== null ? (
          <div className="wizard-preview__step">
            <p className="wizard-preview__header">{TEAM_ADMIN_ACTIVATE_CAMPAIGN.previewTitle}</p>
            <p className="wizard-preview__purpose">{TEAM_ADMIN_ACTIVATE_CAMPAIGN.previewIntro}</p>
            <MetricRow
              label={TEAM_ADMIN_ACTIVATE_CAMPAIGN.previewCampaignLabel}
              value={shortenActivationAddress(preview.context.campaignAddress)}
            />
            <MetricRow
              label={TEAM_ADMIN_ACTIVATE_CAMPAIGN.tokenConfigCountLabel}
              value={String(preview.context.campaignTokenConfigCount)}
              hint={TEAM_ADMIN_ACTIVATE_CAMPAIGN.tokenConfigCountHint}
            />
            <p className="wizard-preview__header">
              {TEAM_ADMIN_ACTIVATE_CAMPAIGN.oneWayWarningTitle}
            </p>
            <p className="wizard-preview__fieldwarning">
              {TEAM_ADMIN_ACTIVATE_CAMPAIGN.oneWayWarning}
            </p>

            <div className="wizard-preview__stepfoot">
              {/*
                MUTATION-ACTION CONTROL 1 of 2. Declared exactly once in this file, inside
                the preview it acts on, so a click can only ever carry a campaign the
                operator has just been shown. There is no retry affordance beside it.
              */}
              <button
                className="wallet-badge__btn"
                disabled={!activateEnabled}
                onClick={() => {
                  void handleActivate()
                }}
                type="button"
              >
                {operation === 'submit'
                  ? TEAM_ADMIN_ACTIVATE_CAMPAIGN.activateActionBusyLabel
                  : TEAM_ADMIN_ACTIVATE_CAMPAIGN.activateActionLabel}
              </button>
              <p className="wizard-preview__fieldnote">
                {activateEnabled
                  ? TEAM_ADMIN_ACTIVATE_CAMPAIGN.activateActionHelp
                  : TEAM_ADMIN_ACTIVATE_CAMPAIGN.activateActionBlockedHelp}
              </p>

        {/*
          THE VISIBLE SOL LINE AND ITS EXPLICIT READ-ONLY RE-CHECK. They appear together and
          only while the balance is not a plain known-sufficient one — a hidden button explains
          nothing, and a sufficient balance needs no sentence and no amount.

          The button is READ-ONLY and is NOT a mutation transaction action: this panel's
          transaction-control count is unchanged by it.
        */}
        {activationSolPreflightNote !== null ? (
          <div className="wizard-preview__policy">
            <p className="wizard-preview__fieldnote">{activationSolPreflightNote}</p>
            <button
              className="wallet-badge__btn"
              disabled={!activationSolPreflightActionable || busy || activationSolPreflight.kind === 'reading'}
              onClick={handleActivationSolPreflightRecheck}
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
          THE RECOVERED SAVED ATTEMPT. It CARRIES NO CONTROL: there is no submit, no retry
          and no acknowledgement inside it.
        */}
        {recoveryRow !== null ? (
          <div className="wizard-preview__step">
            <p className="wizard-preview__header">{TEAM_ADMIN_ACTIVATE_CAMPAIGN.recoveryTitle}</p>
            <p className="wizard-preview__purpose">{TEAM_ADMIN_ACTIVATE_CAMPAIGN.recoveryIntro}</p>
            <div className="wizard-preview__stephead">
              <StatusPill
                label={TEAM_ADMIN_ACTIVATE_CAMPAIGN.recoveryLabel[recoveryRow.outcome]}
                tone={
                  recoveryRow.outcome === 'CAMPAIGN_ACTIVATED'
                    ? 'positive'
                    : recoveryRow.outcome === 'SUBMITTED'
                      ? 'caution'
                      : 'neutral'
                }
              />
            </div>
            <p className="wizard-preview__purpose">
              {TEAM_ADMIN_ACTIVATE_CAMPAIGN.recoveryNote[recoveryRow.outcome]}
            </p>
            <MetricRow
              label={TEAM_ADMIN_ACTIVATE_CAMPAIGN.previewCampaignLabel}
              value={shortenActivationAddress(recoveryRow.campaign)}
              hint="the campaign this saved attempt named"
            />
          </div>
        ) : null}

        <div className="wizard-preview__stepfoot">
          {/*
            MUTATION-ACTION CONTROL 2 of 2. It reconciles the saved attempt and re-reads
            it, and it is the only affordance offered once an attempt is past the point
            where it may already have reached the network. It runs once per click: there is
            no interval, no timer and no automatic reconcile anywhere in this file.
          */}
          <button
            className="wallet-badge__btn"
            disabled={busy || approvedTeamWallet === null}
            onClick={() => {
              void handleCheckActivationStatus()
            }}
            type="button"
          >
            {operation === 'status'
              ? TEAM_ADMIN_ACTIVATE_CAMPAIGN.statusActionBusyLabel
              : TEAM_ADMIN_ACTIVATE_CAMPAIGN.statusActionLabel}
          </button>
          <p className="wizard-preview__fieldnote">
            {TEAM_ADMIN_ACTIVATE_CAMPAIGN.statusActionHelp}
          </p>
          <p className="wizard-preview__purpose">{statusSummary}</p>
          {chainTruth.freshReadRefused ? (
            <p className="wizard-preview__fieldwarning">
              {TEAM_ADMIN_ACTIVATE_CAMPAIGN.blockingNote.CHAIN_TRUTH_UNAVAILABLE}
            </p>
          ) : null}
          {reconcileCode !== null ? (
            <p className="wizard-preview__purpose">
              {describeRedaxTeamAdminMutationReconcileCode(reconcileCode)}
            </p>
          ) : null}
        </div>

        {/*
        */}
        {submitResult ? (
          <div className="wizard-preview__step">
            <p className="wizard-preview__header">{TEAM_ADMIN_ACTIVATE_CAMPAIGN.resultTitle}</p>
            <div className="wizard-preview__stephead">
              <StatusPill
                label={
                  submitResult.busy
                    ? 'ANOTHER_TEAM_ADMIN_MUTATION_IS_RUNNING'
                    : submitResult.code
                }
                tone={submitResult.rawBroadcastCount === 1 ? 'caution' : 'neutral'}
              />
            </div>
            <p className="wizard-preview__purpose">
              {submitResult.busy
                ? TEAM_ADMIN_ACTIVATE_CAMPAIGN.anotherMutationRunning
                : describeRedaxTeamAdminMutationSubmitCode(submitResult.code)}
            </p>
          </div>
        ) : null}

        <div className="wizard-preview__claims">
          <p className="wizard-preview__header">{TEAM_ADMIN_ACTIVATE_CAMPAIGN.nonClaimsTitle}</p>
          <ul>
            {TEAM_ADMIN_ACTIVATE_CAMPAIGN.nonClaims.map((claim) => (
              <li key={claim}>{claim}</li>
            ))}
          </ul>
        </div>
      </div>
    </SurfaceCard>
  )
}
