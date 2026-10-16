// -----------------------------------------------------------------------------
// THE ONE THING THAT MAKES THIS SURFACE DIFFERENT
// -----------------------------------------------------------------------------
// METADATA IS PERMANENT. Phase 1 has no metadata-update instruction, so what this
// surface writes is what the output token carries for good: it cannot be edited,
// replaced, corrected or removed, and a mistake costs a NEW CAMPAIGN. Everything below
// is arranged around that, and two arrangements in particular are not decoration.
//
// FIRST, THE FINAL CONTROL IS UNREACHABLE UNTIL AN EXPLICIT LOCAL REVIEW HAS RUN.
// `Review immutable metadata` canonicalizes the draft LOCALLY — it opens no wallet,
// signs nothing, sends nothing, reaches no network and writes no record — and FREEZES
// exactly what it produced, together with the exact situation it was produced in. The
// preview renders that frozen snapshot and the request carries that frozen snapshot,
// through ONE projection function, so there is no path on which canonicalization
// happens for the first time after the operator has already clicked Set.
//
// SECOND, THE APPROVAL IS DESTROYED RATHER THAN UPDATED. Editing the name, editing the
// symbol, reselecting the location, changing the campaign selection, the loader
// resolving a different campaign, the campaign's stored address, admin, output mint or
// lifecycle status changing, the metadata flag flipping, the approved-Team carrier
// changing, the approved-location list changing, the program identity changing, the
// derived metadata account changing, and a fresh reading that says metadata now exists
// or that the target could not be read — every one of them makes the snapshot NOT
// CURRENT, and a snapshot that is not current can neither be previewed nor submitted.
//
// -----------------------------------------------------------------------------
// WHAT IT CANNOT DO
// -----------------------------------------------------------------------------
// It constructs no `Connection` and no transaction object, acquires no `@solana` package
// at all, holds no signer, reaches no raw adapter, opens no RPC of its own, writes no
// storage, takes no Web Lock, reads no environment and draws no entropy. The only three
// things it may call on the mutation surface are `submitMutation`, `reconcileMutation`
// and the read-only `readMutationStatus`.
//
// WHAT THE EFFECTS MAY REACH IS EXACTLY ONE THING: the read-only `readMutationSolPreflight`
// member, or a ref write. NONE of them reaches `submitMutation`, `reconcileMutation`,
// `readMutationStatus`, a journal operation, a wallet signature, a send or a transaction
// construction. There is still NO timer, NO interval, NO poll, NO subscription, NO event
// listener, NO automatic retry and no `<form>`; nothing runs on a clock, and pressing Enter
// submits nothing.
//
// A FIELD CHANGE READS NOTHING. The SETUP_METADATA threshold rents a FIXED maximum metadata
// allocation, so no name, symbol or URI can change it — draft text is not a scope dimension
// and does not trigger a devnet read.
//
// ALL FOUR ORIGINAL HANDLERS still run from an explicit click and from nowhere else —
// including the local review, and including the read-only status read, which is deliberately
// click-driven rather than automatic. The SOL re-check is a fifth control and is READ-ONLY:
// it is not a mutation transaction action and does not change this panel's transaction
// control count, which stays exactly TWO.
//
// -----------------------------------------------------------------------------
// THE LOCATION IS CHOSEN, NEVER TYPED, AND NEVER FOLLOWED
// -----------------------------------------------------------------------------
// There is no free-text URI input on this surface and there is nowhere for one to be
// added: the draft holds an INDEX into the deployment's resolved allowlist. The chosen
// location is rendered as PLAIN TEXT — there is no `href`, no `src`, no image, no
// iframe, no preload, no `window.open`, no navigation, no markdown and no
// `dangerouslySetInnerHTML` anywhere in this file, and no metadata document is fetched.
//
// -----------------------------------------------------------------------------
// A LOADED SNAPSHOT IS NOT CHAIN TRUTH, AND UNREADABLE IS NOT ABSENT
// -----------------------------------------------------------------------------
// The campaign props may PREDATE the very attempt they would be used to judge, so they
// are declared `LOADED_DISPLAY` and the explicit status gesture takes its own reading —
// reconcile, re-read the slot, then read the campaign — in that fixed order.
//
// This slice adds NO data-source method and edits NO adapter, so there is no
// authority-grade product read of the metadata account itself. That is stated as
// `NOT_READ` rather than smuggled in as absence: the campaign's own `metadataSetup`
// flag and a freshly read Metaplex identity are POSITIVE evidence that metadata exists,
// while a cached identity that is unavailable proves nothing at all. The mutation action
// root reads the account at authority grade before any wallet prompt and refuses there;
// this surface never claims what it has not read.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import { MetricRow } from '../components/MetricRow'
import { StatusPill } from '../components/StatusPill'
import { SurfaceCard } from '../components/SurfaceCard'
import {
  TEAM_ADMIN_SETUP_METADATA,
  TEAM_ADMIN_SOL_PREFLIGHT_INSUFFICIENT,
  TEAM_ADMIN_SOL_PREFLIGHT_READING,
  TEAM_ADMIN_SOL_PREFLIGHT_RECHECK_LABEL,
  TEAM_ADMIN_SOL_PREFLIGHT_UNAVAILABLE,
} from '../lib/productCopy'
import type { TeamAdminSetupMetadataFieldId } from '../lib/productCopy'
import { useRedaxWallet } from '../wallet/RedaxWalletProvider'
import type { RedaxCampaignView } from '../data/redaxViewModels'
import { useRedaxTeamAdminMutationActions } from './RedaxTeamAdminMutationActions'
import type { RedaxTeamAdminMutationSolPreflightResult } from './RedaxTeamAdminMutationActions'
import type { RedaxTeamAdminMutationOperation } from './redaxTeamAdminMutationIdentity'
import type {
  RedaxTeamAdminMutationReconcileCode,
  RedaxTeamAdminMutationStatusReadResult,
  RedaxTeamAdminMutationSubmitResult,
} from './RedaxTeamAdminMutationActions'
import { canonicalizeRedaxTeamAdminMetadata } from './redaxTeamAdminMetadataCanonical'
import type { RedaxTeamAdminMetadataRefusalCode } from './redaxTeamAdminMetadataCanonical'
import {
  buildRedaxTeamAdminMetadataApprovalContext,
  createRedaxTeamAdminMetadataApprovalSnapshot,
  deriveRedaxTeamAdminMetadataDisposition,
  emptyRedaxTeamAdminMetadataDraft,
  isRedaxTeamAdminMetadataApprovalSnapshotCurrent,
  projectRedaxTeamAdminMetadataRecoveryRow,
  redaxTeamAdminMetadataSubmitValuesFromSnapshot,
  reduceRedaxTeamAdminMetadataDraft,
  resolveRedaxTeamAdminMetadataDraftUri,
  selectRedaxTeamAdminMetadataUri,
} from './redaxTeamAdminMetadataProduct'
import type {
  RedaxTeamAdminMetadataApprovalSnapshot,
  RedaxTeamAdminMetadataDraft,
  RedaxTeamAdminMetadataDraftAction,
  RedaxTeamAdminMetadataStatusInput,
  RedaxTeamAdminMetadataTargetPresence,
} from './redaxTeamAdminMetadataProduct'
import {
  deriveRedaxTeamAdminSetupCampaignAuthority,
  deriveRedaxTeamAdminSetupWalletStatus,
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

/** Which operation, if any, is running. Rendered state beside the ref latch. */
type MetadataPanelOperation = 'review' | 'submit' | 'status'

export interface RedaxTeamAdminCampaignMetadataPanelProps {
  /**
   * The ONE canonical approved Team wallet, resolved once in App.
   *
   * The SAME value App passes to the mutation provider and to the sibling setup panel,
   * so no two of them can disagree about who is approved. `null` means the deployment
   * configured no usable carrier, and the whole surface fails closed on it.
   */
  readonly approvedTeamWallet: string | null
  /** Whether the campaign read this panel judges against actually resolved. */
  readonly campaignDataReady: boolean
  /** The campaign id App's loader actually resolved — the fallback may differ. */
  readonly effectiveSelectedCampaignId: string
  /**
   * The ONE resolved approved-location list, resolved once in App.
   *
   * The SAME array App passes to the mutation provider, so the list an operator selects
   * from and the list the canonicalizer matches a request against are the same object.
   * This panel reads no environment, parses nothing and resolves nothing itself; an
   * empty array is the fail-closed state and refuses every location.
   */
  readonly metadataUriAllowlist: readonly string[]
  /**
   * The ONE canonical runtime program id, resolved once in App.
   *
   * A PUBLIC deployment fact injected at the boundary, exactly like the carrier. It is
   * bound into the approval so an approval taken under one program identity cannot be
   * submitted under another, and `null` fails every path closed.
   */
  readonly programId: string | null
  /**
   * The BOUNDED product refresh, injected by App. It is this panel's ONLY route to a
   * reading it may call authority-grade, and it is called from the explicit status
   * gesture and from nowhere else.
   */
  readonly readFreshCampaignSetupTruth: (
    campaignId: string,
  ) => Promise<RedaxTeamAdminFreshCampaignSetupTruthResult>
  /** The LOADED campaign, or `null`. Display and initial drafting truth only. */
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
export function toRedaxTeamAdminMetadataStatusInput(
  status: RedaxTeamAdminMutationStatusReadResult | null,
): RedaxTeamAdminMetadataStatusInput {
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
      witnessAddress: status.witnessAddress,
    }
  }
  return {
    kind: 'TOMBSTONE',
    operation: status.operation,
    campaign: status.campaign,
    resolution: status.resolution,
    witnessAddress: status.witnessAddress,
  }
}

/**
 * What is known about the canonical metadata account, from POSITIVE evidence only.
 *
 * `PRESENT` requires something that actually asserts existence: the campaign's own
 * `metadataSetup` flag read at the freshness this judgment needs, or a Metaplex identity
 * the adapter actually resolved. Everything else — an unread campaign, a refused
 * refresh, an identity that is `unavailable`, an absent identity — is `NOT_READ`.
 *
 * `NOT_READ` IS NOT `ABSENT`, and that is the whole point of the function. A cached
 * display value that failed to resolve is not evidence that a permanent account is
 * missing, and treating it as such is exactly how an irreversible write gets made twice.
 */
export function deriveRedaxTeamAdminMetadataTargetPresence(input: {
  readonly freshMetadataSetup: boolean | null
  readonly campaign: RedaxCampaignView | null
}): RedaxTeamAdminMetadataTargetPresence {
  if (input.freshMetadataSetup === true) {
    return 'PRESENT'
  }
  if (input.campaign !== null && input.campaign.outputTokenIdentity?.source === 'metaplex') {
    return 'PRESENT'
  }
  return 'NOT_READ'
}

/**
 * One editable field id to the exact draft action it produces.
 *
 * Written out rather than computed from the id, so the mapping is TOTAL in source: the
 * `never` binding in the default arm means a third typed field stops this file compiling
 * until somebody decides what it edits. The location is deliberately NOT here — it is
 * selected by index, never typed.
 */
function metadataDraftActionFor(
  field: TeamAdminSetupMetadataFieldId,
  value: string,
): RedaxTeamAdminMetadataDraftAction {
  switch (field) {
    case 'name':
      return { kind: 'name', value }
    case 'symbol':
      return { kind: 'symbol', value }
    default: {
      const exhaustive: never = field
      return exhaustive
    }
  }
}

/** Shortened display form (4…4). A full address is never rendered by this panel. */
function shortenMetadataAddress(value: string): string {
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
type MetadataSolPreflightState =
  | { kind: 'idle' }
  | { kind: 'reading' }
  | { kind: 'settled'; result: RedaxTeamAdminMutationSolPreflightResult }

const METADATA_SOL_PREFLIGHT_IDLE: MetadataSolPreflightState = { kind: 'idle' }
const METADATA_SOL_PREFLIGHT_READING: MetadataSolPreflightState = { kind: 'reading' }

/**
 * IDENTITY PRIVACY IS A RENDER-TIME RULE, NOT A CLEANUP RACE.
 *
 * A panel-local value is stored together with the EXACT identity scope that produced it and
 * read back through `inScope` while the tree is computed. A value whose recorded scope is
 * not the current one is therefore invisible AND unusable in the very first render that
 * observes a new wallet, campaign or carrier — before any passive effect runs.
 */
interface MetadataScopedState<T> {
  readonly scope: string
  readonly value: T
}

function metadataScopedState<T>(scope: string, value: T): MetadataScopedState<T> {
  return { scope, value }
}

function metadataInScope<T>(
  record: MetadataScopedState<T>,
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
export function redaxTeamAdminMetadataSolPreflightScope(
  approvedTeamWallet: string | null,
  connectedPublicKey: string | null,
  selectedCampaignId: string,
  operation: RedaxTeamAdminMutationOperation,
): string {
  return `${approvedTeamWallet ?? ''}|${connectedPublicKey ?? ''}|${selectedCampaignId}|${operation}`
}

export function RedaxTeamAdminCampaignMetadataPanel({
  approvedTeamWallet,
  campaignDataReady,
  effectiveSelectedCampaignId,
  metadataUriAllowlist,
  programId,
  readFreshCampaignSetupTruth,
  selectedCampaign,
  selectedCampaignId,
}: RedaxTeamAdminCampaignMetadataPanelProps) {
  const actions = useRedaxTeamAdminMutationActions()
  const wallet = useRedaxWallet()

  // MEMORY ONLY, all of it, and nowhere else. No storage port, no lock, no fourth owner.
  // A reload discards the draft and the approval; what survives is the durable attempt
  // and whatever the chain holds, and both are read back rather than remembered.
  const [draft, setDraft] = useState<RedaxTeamAdminMetadataDraft>(() =>
    emptyRedaxTeamAdminMetadataDraft(metadataUriAllowlist, 0),
  )
  const [snapshot, setSnapshot] = useState<RedaxTeamAdminMetadataApprovalSnapshot | null>(null)
  const [reviewRefusal, setReviewRefusal] = useState<RedaxTeamAdminMetadataRefusalCode | null>(
    null,
  )
  const [freshChainTruth, setFreshChainTruth] =
    useState<RedaxTeamAdminSetupFreshChainTruth | null>(null)
  const [statusResult, setStatusResult] = useState<RedaxTeamAdminMutationStatusReadResult | null>(
    null,
  )
  const [submitResult, setSubmitResult] = useState<RedaxTeamAdminMutationSubmitResult | null>(null)
  const [reconcileCode, setReconcileCode] = useState<RedaxTeamAdminMutationReconcileCode | null>(
    null,
  )
  const [operation, setOperation] = useState<MetadataPanelOperation | null>(null)

  // The synchronous latch. A `disabled` attribute alone would not do: two clicks inside
  // one frame both observe the same rendered state.
  const inFlightRef = useRef<MetadataPanelOperation | null>(null)

  const busy = operation !== null

  // WHICH READING THIS RENDER RESTS ON, decided in one place and used everywhere below.
  // Reused from the sibling panel rather than re-derived: two answers to "which campaign
  // reading is current" would be two answers to the same question.
  const chainTruth = selectRedaxTeamAdminSetupChainTruth({
    selectedCampaignId,
    freshChainTruth,
    loadedCampaign: selectedCampaign,
    loadedTokenConfigs: [],
  })
  const authoritativeCampaign = chainTruth.campaign

  // THE SAME classifier the sibling panel uses, imported rather than restated. A second
  // campaign-authority classifier would be a second answer to the one question that
  // decides whether a campaign may be written to at all.
  const campaignAuthority = deriveRedaxTeamAdminSetupCampaignAuthority({
    approvedTeamWallet,
    selectedCampaignId,
    effectiveSelectedCampaignId,
    selectedCampaign: authoritativeCampaign,
  })
  const walletStatus = deriveRedaxTeamAdminSetupWalletStatus(
    approvedTeamWallet,
    wallet.publicKeyBase58,
  )
  const authorityConfirmed = campaignAuthority === 'EXPLICIT_SELECTION_CONFIRMED'
  const walletConnectedMatch = walletStatus === 'CONNECTED_MATCH' && wallet.status === 'connected'
  // The connected identity this panel's C1 reads about. It is the SAME public facade value
  // the wallet status above is derived from — never a second identity source.
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

  // --- C1 devnet SOL availability for SETUP_METADATA ------------------------------
  //
  //     METADATA TEXT IS NOT A DIMENSION. The STATICALLY AUDITED UPSTREAM METAPLEX
  //     RUNTIME-SOURCE MODEL this cost model was selected against uses a FIXED MAXIMUM
  //     metadata allocation, so no name, symbol or URI can change what SETUP_METADATA
  //     costs — which is exactly why editing a field must not, and does not, cause a
  //     repeated read.
  //
  //     THAT AUDIT IS OF SOURCE, NEVER OF THE DEPLOYED PROGRAM. REDAX's
  //     `mpl-token-metadata = 5.1.1` dependency is the SDK / CPI-client pin, not proof of
  //     the deployed Metaplex runtime — which is externally upgradeable — so a separately
  //     gated deployed-runtime attestation remains required. The action root owns that
  //     two-layer provenance and every cost term; this panel holds and renders none.
  const metadataSolPreflightScope = redaxTeamAdminMetadataSolPreflightScope(
    approvedTeamWallet,
    connectedPublicKeyForSolPreflight,
    selectedCampaignId,
    'SETUP_METADATA',
  )
  // ACTIONABLE means "worth reading a balance about": a carrier exists, a wallet is
  // connected, that wallet is EXACTLY the approved Team, and this campaign is the explicitly
  // confirmed one. Any other identity resolves to `idle` — this panel does not read, and does
  // not report, a balance belonging to a wallet that could not pay for this operation anyway.
  const metadataSolPreflightActionable = approvedTeamWallet !== null &&
    walletConnectedMatch &&
    authorityConfirmed &&
    selectedCampaignId !== ''

  const [metadataSolPreflightRecord, setMetadataSolPreflightRecord] = useState<
    MetadataScopedState<MetadataSolPreflightState>
  >(() =>
    metadataScopedState(
      metadataSolPreflightScope,
      metadataSolPreflightActionable ? METADATA_SOL_PREFLIGHT_READING : METADATA_SOL_PREFLIGHT_IDLE,
    ),
  )

  // RENDER-TIME IDENTITY GATING. The projection collapses to its neutral resting value the
  // moment the identity that produced it stops being current — in THIS render, not in a later
  // effect. A wallet or campaign change therefore invalidates an old reading immediately.
  const metadataSolPreflight = metadataInScope(
    metadataSolPreflightRecord,
    metadataSolPreflightScope,
    metadataSolPreflightActionable ? METADATA_SOL_PREFLIGHT_READING : METADATA_SOL_PREFLIGHT_IDLE,
  )

  const committedMetadataSolPreflightScopeRef = useRef(metadataSolPreflightScope)
  const metadataSolPreflightGenerationRef = useRef(0)

  useLayoutEffect(() => {
    committedMetadataSolPreflightScopeRef.current = metadataSolPreflightScope
  }, [metadataSolPreflightScope])

  // EVERY ASYNC COMPLETION MUST PROVE THREE THINGS before it may write state: still mounted,
  // the COMMITTED scope is the one the read started in, and the read is still the newest.
  const isMetadataSolPreflightCurrent = useCallback(
    (scopeKey: string, generation: number): boolean => {
      return (
        solPreflightMountedRef.current &&
        committedMetadataSolPreflightScopeRef.current === scopeKey &&
        metadataSolPreflightGenerationRef.current === generation
      )
    },
    [],
  )

  // ONE read-only devnet SOL read for THIS operation. It builds nothing, signs nothing, sends
  // nothing, confirms nothing, touches no durable record and returns no authorization. Each
  // call supersedes the previous one, so a slow earlier read can never be the last writer.
  const runMetadataSolPreflightRead = useCallback(
    async (scopeKey: string): Promise<void> => {
      metadataSolPreflightGenerationRef.current += 1
      const generation = metadataSolPreflightGenerationRef.current
      setMetadataSolPreflightRecord(metadataScopedState(scopeKey, METADATA_SOL_PREFLIGHT_READING))
      try {
        const result = await readMutationSolPreflightRef.current('SETUP_METADATA')
        if (!isMetadataSolPreflightCurrent(scopeKey, generation)) {
          return
        }
        setMetadataSolPreflightRecord(
          metadataScopedState<MetadataSolPreflightState>(scopeKey, { kind: 'settled', result }),
        )
      } catch {
        // A REJECTED read is not an observation. It settles as READ_UNAVAILABLE — which
        // WITHHOLDS the action — rather than as an unhandled rejection or an optimistic
        // sufficiency. No raw error is read, rendered or logged.
        if (!isMetadataSolPreflightCurrent(scopeKey, generation)) {
          return
        }
        setMetadataSolPreflightRecord(
          metadataScopedState<MetadataSolPreflightState>(scopeKey, {
            kind: 'settled',
            result: 'READ_UNAVAILABLE',
          }),
        )
      }
    },
    [isMetadataSolPreflightCurrent],
  )

  // EXACTLY ONE AUTOMATIC READ PER NEW ACTIONABLE SCOPE, and no more. No timer, no interval,
  // no polling, no subscription and no automatic retry: a stale reading is corrected by the
  // explicit human re-check, never by this panel deciding on its own to ask again.
  useEffect(() => {
    if (!metadataSolPreflightActionable) {
      setMetadataSolPreflightRecord(metadataScopedState(metadataSolPreflightScope, METADATA_SOL_PREFLIGHT_IDLE))
      return
    }
    void runMetadataSolPreflightRead(metadataSolPreflightScope)
  }, [metadataSolPreflightActionable, metadataSolPreflightScope, runMetadataSolPreflightRead])

  // KNOWN-SUFFICIENT ONLY. A reading, an idle projection and a failed read all resolve to
  // false, because an unknown balance must WITHHOLD an action rather than allow one.
  const metadataSolPreflightSufficient = metadataSolPreflight.kind === 'settled' && metadataSolPreflight.result === 'SUFFICIENT'

  const metadataSolPreflightNote: string | null =
    metadataSolPreflight.kind === 'reading'
      ? TEAM_ADMIN_SOL_PREFLIGHT_READING
      : metadataSolPreflight.kind === 'idle'
        ? null
        : metadataSolPreflight.result === 'INSUFFICIENT'
          ? TEAM_ADMIN_SOL_PREFLIGHT_INSUFFICIENT
          : metadataSolPreflight.result === 'READ_UNAVAILABLE'
            ? TEAM_ADMIN_SOL_PREFLIGHT_UNAVAILABLE
            : null

  /**
   * THE EXPLICIT, READ-ONLY SOL RE-CHECK FOR SETUP_METADATA. It runs ONLY from its own click.
   *
   * It builds nothing, signs nothing, sends nothing, confirms nothing, writes no durable
   * record and returns no authorization, and there is no timer, no poll, no storage event and
   * no subscription behind it. IT IS NOT A MUTATION ACTION: it does not take the
   * single-flight latch, does not set `operation`, and never counts toward this panel's
   * transaction-control census. It re-reads EXACTLY this operation and supersedes only its
   * own previous read.
   */
  const handleMetadataSolPreflightRecheck = useCallback((): void => {
    if (metadataSolPreflightScope !== committedMetadataSolPreflightScopeRef.current) {
      return
    }
    if (!metadataSolPreflightActionable || busy || metadataSolPreflight.kind === 'reading') {
      return
    }
    void runMetadataSolPreflightRead(metadataSolPreflightScope)
  }, [busy, runMetadataSolPreflightRead, metadataSolPreflight.kind, metadataSolPreflightActionable, metadataSolPreflightScope])

  // CHAIN TRUTH OR NOTHING. While the campaign read is in flight or refused, the flag is
  // `null` rather than the last one seen, and a null flag refuses.
  const freshMetadataSetup: boolean | null =
    campaignDataReady && authoritativeCampaign !== null && !chainTruth.freshReadRefused
      ? authoritativeCampaign.metadataSetup
      : null

  const metadataTargetPresence = deriveRedaxTeamAdminMetadataTargetPresence({
    freshMetadataSetup,
    campaign: authoritativeCampaign,
  })

  const campaignAddress = authoritativeCampaign?.campaignAddress ?? null

  // THE IMMUTABLE CONTEXT an approval is bound to. Rebuilt on every render from current
  // facts and never remembered: the snapshot is compared against THIS, so a fact that
  // moved is a snapshot that is no longer current, in one place.
  const approvalContext = useMemo(
    () =>
      buildRedaxTeamAdminMetadataApprovalContext({
        rawSelectedCampaignId: selectedCampaignId,
        effectiveSelectedCampaignId,
        campaignAddress,
        campaignAdmin: authoritativeCampaign?.campaignAdmin ?? null,
        campaignOutputMint: authoritativeCampaign?.outputMint ?? null,
        campaignStatus: authoritativeCampaign?.programStatus ?? null,
        campaignMetadataSetup: freshMetadataSetup,
        metadataTargetPresence,
        approvedTeamWallet,
        allowlistEntries: metadataUriAllowlist,
        programId,
      }),
    [
      approvedTeamWallet,
      authoritativeCampaign,
      campaignAddress,
      effectiveSelectedCampaignId,
      freshMetadataSetup,
      metadataTargetPresence,
      metadataUriAllowlist,
      programId,
      selectedCampaignId,
    ],
  )

  const snapshotCurrent = isRedaxTeamAdminMetadataApprovalSnapshotCurrent(
    snapshot,
    approvalContext,
    draft.generation,
  )

  const statusInput = useMemo(
    () => toRedaxTeamAdminMetadataStatusInput(statusResult),
    [statusResult],
  )

  const disposition = deriveRedaxTeamAdminMetadataDisposition({
    allowlistEntryCount: metadataUriAllowlist.length,
    authorityConfirmed,
    campaignAddress,
    campaignMetadataSetup: freshMetadataSetup,
    metadataTargetPresence,
    status: statusInput,
    snapshotCurrent,
  })

  const recoveryRow = useMemo(
    () =>
      projectRedaxTeamAdminMetadataRecoveryRow({
        status: statusInput,
        campaignAddress,
        campaignMetadataSetup: freshMetadataSetup,
        metadataTargetPresence,
      }),
    [campaignAddress, freshMetadataSetup, metadataTargetPresence, statusInput],
  )

  const uriSelection = selectRedaxTeamAdminMetadataUri(metadataUriAllowlist, draft.uriIndex)
  const selectedUri = resolveRedaxTeamAdminMetadataDraftUri(draft, metadataUriAllowlist)

  /**
   * THE APPROVAL IS DESTROYED, NEVER UPDATED. Every draft edit drops the frozen snapshot
   * and advances the draft generation, so an approval can never survive an edit — not
   * even one that retypes exactly the same characters.
   */
  const updateDraft = useCallback(
    (action: RedaxTeamAdminMetadataDraftAction): void => {
      if (busy) {
        return
      }
      setReviewRefusal(null)
      setSnapshot(null)
      setDraft((current) => reduceRedaxTeamAdminMetadataDraft(current, action, metadataUriAllowlist))
    },
    [busy, metadataUriAllowlist],
  )

  const reviewEnabled =
    disposition.reviewAdmissible && approvalContext !== null && selectedUri !== null && !busy

  const setEnabled =
    disposition.setAdmissible &&
    snapshot !== null &&
    snapshotCurrent &&
    authorityConfirmed &&
    walletConnectedMatch &&
    // Stated again beside the disposition rather than left implicit in it: a refused
    // refresh disables the permanent write even if the product machine were ever to
    // change its mind about what a refusal implies.
    !chainTruth.freshReadRefused &&
    !busy &&
    metadataSolPreflightSufficient

  /**
   * THE LOCAL REVIEW. It is NOT a mutation-action control.
   *
   * It signs nothing, sends nothing, opens no wallet, performs no RPC, writes no journal
   * record and writes no storage. It canonicalizes the draft through the ONE
   * canonicalization authority, against the ONE resolved allowlist, and either refuses
   * with a value-free code or freezes exactly what it produced together with the exact
   * context it was produced in.
   */
  const handleReview = useCallback(async (): Promise<void> => {
    if (inFlightRef.current !== null) {
      return
    }
    const context = approvalContext
    const uri = resolveRedaxTeamAdminMetadataDraftUri(draft, metadataUriAllowlist)
    if (context === null || uri === null) {
      return
    }
    // The generation this review is ABOUT, read once before the first await, so an edit
    // that lands while canonicalization is running cannot be approved by it.
    const reviewedGeneration = draft.generation
    inFlightRef.current = 'review'
    setOperation('review')
    setReviewRefusal(null)
    setSnapshot(null)
    try {
      const result = await canonicalizeRedaxTeamAdminMetadata(
        { name: draft.name, symbol: draft.symbol, uri },
        { uriAllowlist: metadataUriAllowlist },
      )
      if (!result.ok) {
        setReviewRefusal(result.code)
        return
      }
      setSnapshot(
        createRedaxTeamAdminMetadataApprovalSnapshot(result.metadata, reviewedGeneration, context),
      )
    } finally {
      inFlightRef.current = null
      setOperation(null)
    }
  }, [approvalContext, draft, metadataUriAllowlist])

  /**
   * THE ONE PERMANENT WRITE, from an explicit click and nowhere else.
   *
   * The latch is CLAIMED synchronously before the first await, so a second click in the
   * same frame cannot pass. The request carries the FROZEN SNAPSHOT through one
   * projection — the same values the preview above rendered — and nothing is
   * canonicalized, normalized or repaired here. There is no retry, no resend and no
   * second attempt: after it returns, the surface's state is re-derived from the journal
   * and the chain.
   */
  const handleSetMetadata = useCallback(async (): Promise<void> => {
    if (inFlightRef.current !== null) {
      return
    }
    const approved = snapshot
    // The rendered control is already disabled without these; the handler asserts them
    // again because a disabled attribute is a rendering, not a gate.
    if (approved === null || !snapshotCurrent || !authorityConfirmed || !walletConnectedMatch) {
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
      metadataSolPreflightScope !== committedMetadataSolPreflightScopeRef.current ||
      !metadataSolPreflightSufficient
    ) {
      return
    }
    inFlightRef.current = 'submit'
    setOperation('submit')
    setReconcileCode(null)
    // THE READING IS SPENT. Whatever the chain said before this attempt says nothing
    // about the chain after it.
    setFreshChainTruth(null)
    try {
      const values = redaxTeamAdminMetadataSubmitValuesFromSnapshot(approved)
      const result = await actions.submitMutation({
        operation: 'SETUP_METADATA',
        campaign: values.campaign,
        outputMint: values.outputMint,
        metadataName: values.metadataName,
        metadataSymbol: values.metadataSymbol,
        metadataUri: values.metadataUri,
      })
      setSubmitResult(result)
      // A READ, never a reconcile. The next state has to come from the durable record
      // rather than from what this handler happens to remember.
      setStatusResult(await actions.readMutationStatus())
    } finally {
      inFlightRef.current = null
      setOperation(null)
    }
  }, [
    actions,
    authorityConfirmed,
    metadataSolPreflightScope,
    metadataSolPreflightSufficient,
    snapshot,
    snapshotCurrent,
    walletConnectedMatch,
  ])

  /**
   * THE ONE STATUS PATH, from an explicit click and nowhere else.
   *
   * Reconcile, re-read the slot, then read the campaign — in that fixed order, so the
   * account reading is strictly newer than the journal reading it is judged beside.
   * Neither step signs, prompts a wallet, builds anything, sends anything or starts a new
   * attempt, which is why it needs no connected wallet and is safe after a reload.
   */
  const handleCheckMetadataStatus = useCallback(async (): Promise<void> => {
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

  const identityNote =
    walletStatus === 'CARRIER_UNAVAILABLE'
      ? TEAM_ADMIN_SETUP_METADATA.carrierUnavailable
      : walletStatus === 'DISCONNECTED'
        ? TEAM_ADMIN_SETUP_METADATA.disconnected
        : walletStatus === 'CONNECTED_MATCH'
          ? TEAM_ADMIN_SETUP_METADATA.connectedMatch
          : TEAM_ADMIN_SETUP_METADATA.connectedMismatch

  const statusSummary =
    statusResult === null
      ? TEAM_ADMIN_SETUP_METADATA.statusUnread
      : !statusResult.ok
        ? describeRedaxTeamAdminMutationStatusReadCode(statusResult.code)
        : statusResult.presence === 'EMPTY'
          ? TEAM_ADMIN_SETUP_METADATA.statusEmpty
          : TEAM_ADMIN_SETUP_METADATA.stateNote[disposition.state]

  // THE PREVIEW IS THE SNAPSHOT. It renders only while the snapshot is CURRENT, so a
  // preview can never describe values a later edit has already superseded.
  const preview = snapshot !== null && snapshotCurrent ? snapshot : null

  return (
    <SurfaceCard
      eyebrow={TEAM_ADMIN_SETUP_METADATA.eyebrow}
      title={TEAM_ADMIN_SETUP_METADATA.title}
      footnote={TEAM_ADMIN_SETUP_METADATA.footnote}
    >
      <div className="wizard-preview">
        <p className="wizard-preview__intro">{TEAM_ADMIN_SETUP_METADATA.intro}</p>
        <p className="wizard-preview__boundary">{TEAM_ADMIN_SETUP_METADATA.boundary}</p>

        <div className="wizard-preview__stephead">
          <StatusPill
            label={TEAM_ADMIN_SETUP_METADATA.stateLabel[disposition.state]}
            tone={
              disposition.state === 'METADATA_SET'
                ? 'positive'
                : disposition.state === 'SUBMITTED_ATTEMPT' ||
                    disposition.state === 'BLOCKED_SUPPORT'
                  ? 'caution'
                  : 'neutral'
            }
          />
        </div>
        <p className="wizard-preview__purpose">
          {TEAM_ADMIN_SETUP_METADATA.stateNote[disposition.state]}
        </p>
        {disposition.blocking !== null ? (
          <p className="wizard-preview__fieldnote">
            {TEAM_ADMIN_SETUP_METADATA.blockingNote[disposition.blocking]}
          </p>
        ) : null}

        <div className="wizard-preview__step">
          <p className="wizard-preview__header">{TEAM_ADMIN_SETUP_METADATA.authorityTitle}</p>
          <div className="wizard-preview__stephead">
            <StatusPill
              label={campaignAuthority}
              tone={authorityConfirmed ? 'positive' : 'neutral'}
            />
          </div>
          <p className="wizard-preview__purpose">
            {TEAM_ADMIN_SETUP_METADATA.authority[campaignAuthority]}
          </p>
          {campaignAddress !== null ? (
            <MetricRow
              label={TEAM_ADMIN_SETUP_METADATA.previewCampaignLabel}
              value={shortenMetadataAddress(campaignAddress)}
              hint="the campaign whose output token this would name"
            />
          ) : null}
        </div>

        <div className="wizard-preview__step">
          <p className="wizard-preview__header">{TEAM_ADMIN_SETUP_METADATA.walletTitle}</p>
          <p className="wizard-preview__purpose">{identityNote}</p>

          {approvedTeamWallet !== null ? (
            <MetricRow
              label={TEAM_ADMIN_SETUP_METADATA.approvedKeyLabel}
              value={shortenMetadataAddress(approvedTeamWallet)}
              hint="configured for this deployment; never taken from the connected wallet"
            />
          ) : null}

          {wallet.shortPublicKey ? (
            <MetricRow
              label={TEAM_ADMIN_SETUP_METADATA.connectedKeyLabel}
              value={wallet.shortPublicKey}
              hint="shortened form only — the full address is never displayed"
            />
          ) : null}

          {approvedTeamWallet !== null && wallet.status !== 'connected' ? (
            <div className="wizard-preview__policy">
              {wallet.walletsDetected ? (
                <>
                  <p className="wizard-preview__fieldnote">
                    {TEAM_ADMIN_SETUP_METADATA.connectPrompt}
                  </p>
                  <div className="wallet-badge__list">
                    {wallet.wallets.map((option) => (
                      <button
                        className="wallet-badge__btn"
                        disabled={!option.connectable || wallet.status === 'connecting'}
                        key={option.name}
                        onClick={() => {
                          void wallet.connect(option.name)
                        }}
                        type="button"
                      >
                        {option.name}
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <p className="wizard-preview__fieldnote">
                  {TEAM_ADMIN_SETUP_METADATA.noWalletsDetected}
                </p>
              )}
            </div>
          ) : null}

          {wallet.status === 'connected' ? (
            <button
              className="wallet-badge__btn"
              disabled={busy}
              onClick={() => {
                void wallet.disconnect()
              }}
              type="button"
            >
              {TEAM_ADMIN_SETUP_METADATA.disconnectLabel}
            </button>
          ) : null}

          {wallet.errorMessage ? (
            <p className="wizard-preview__fieldwarning">{wallet.errorMessage}</p>
          ) : null}
        </div>

        {/*
          THE APPROVED LOCATION. Chosen, never typed, and rendered as PLAIN TEXT.
          There is no anchor, no image, no frame and no navigation anywhere in this
          block: the address is shown, and nothing on this page follows it.
        */}
        <div className="wizard-preview__step">
          <p className="wizard-preview__header">{TEAM_ADMIN_SETUP_METADATA.locationTitle}</p>
          {uriSelection.kind === 'NOT_CONFIGURED' ? (
            <p className="wizard-preview__fieldwarning">
              {TEAM_ADMIN_SETUP_METADATA.locationNotConfigured}
            </p>
          ) : (
            <>
              <p className="wizard-preview__purpose">{TEAM_ADMIN_SETUP_METADATA.locationNote}</p>
              {uriSelection.kind === 'SINGLE' ? (
                <MetricRow
                  label={TEAM_ADMIN_SETUP_METADATA.locationSingleLabel}
                  value={uriSelection.uri}
                  hint={TEAM_ADMIN_SETUP_METADATA.locationPlainTextNote}
                />
              ) : (
                <div className="wizard-preview__fieldbody">
                  <p className="wizard-preview__fieldname">
                    {TEAM_ADMIN_SETUP_METADATA.locationChoiceLabel}
                  </p>
                  {uriSelection.selectedIndex === null ? (
                    <p className="wizard-preview__fieldnote">
                      {TEAM_ADMIN_SETUP_METADATA.locationChoiceUnselected}
                    </p>
                  ) : null}
                  {uriSelection.entries.map((entry, index) => {
                    const optionId = `redax-team-metadata-location-${index}`
                    return (
                      <div className="wizard-preview__field" key={entry}>
                        <input
                          checked={uriSelection.selectedIndex === index}
                          className="wizard-preview__input"
                          disabled={busy}
                          id={optionId}
                          name="redax-team-metadata-location"
                          onChange={() => {
                            updateDraft({ kind: 'uri', index })
                          }}
                          type="radio"
                        />
                        <label className="wizard-preview__fieldname" htmlFor={optionId}>
                          {entry}
                        </label>
                      </div>
                    )
                  })}
                  <p className="wizard-preview__fieldnote">
                    {TEAM_ADMIN_SETUP_METADATA.locationPlainTextNote}
                  </p>
                </div>
              )}
            </>
          )}
        </div>

        <div className="wizard-preview__step">
          <p className="wizard-preview__header">{TEAM_ADMIN_SETUP_METADATA.draftTitle}</p>
          <p className="wizard-preview__draftnotice">{TEAM_ADMIN_SETUP_METADATA.draftNotice}</p>
          <div className="wizard-preview__fieldbody">
            {TEAM_ADMIN_SETUP_METADATA.fields.map((field) => {
              const inputId = `redax-team-setup-metadata-${field.id}`
              return (
                <div className="wizard-preview__field" key={field.id}>
                  <label className="wizard-preview__fieldname" htmlFor={inputId}>
                    {field.label}
                  </label>
                  <input
                    className="wizard-preview__input"
                    disabled={busy}
                    id={inputId}
                    inputMode="text"
                    onChange={(event) => {
                      updateDraft(metadataDraftActionFor(field.id, event.target.value))
                    }}
                    type="text"
                    value={draft[field.id]}
                  />
                  <p className="wizard-preview__fieldnote">{field.note}</p>
                </div>
              )
            })}
          </div>
        </div>

        {/*
          THE LOCAL REVIEW CONTROL. It is deliberately NOT one of the two mutation-action
          controls and is never counted as one: it opens no wallet, signs nothing, sends
          nothing, reaches no network and writes nothing. It is also the only route to the
          final control, which is why it is declared before it and separately from it.
        */}
        <div className="wizard-preview__step">
          <p className="wizard-preview__header">{TEAM_ADMIN_SETUP_METADATA.reviewTitle}</p>
          <button
            className="wallet-badge__btn"
            disabled={!reviewEnabled}
            onClick={() => {
              void handleReview()
            }}
            type="button"
          >
            {operation === 'review'
              ? TEAM_ADMIN_SETUP_METADATA.reviewActionBusyLabel
              : TEAM_ADMIN_SETUP_METADATA.reviewActionLabel}
          </button>
          <p className="wizard-preview__fieldnote">
            {reviewEnabled
              ? TEAM_ADMIN_SETUP_METADATA.reviewActionHelp
              : TEAM_ADMIN_SETUP_METADATA.reviewActionBlockedHelp}
          </p>
          {reviewRefusal !== null ? (
            <p className="wizard-preview__fieldwarning">
              {TEAM_ADMIN_SETUP_METADATA.reviewRefusal[reviewRefusal]}
            </p>
          ) : null}
        </div>

        {/*
          THE CANONICAL FINAL PREVIEW, rendered immediately before the one gesture that
          cannot be undone. Every value here comes out of the frozen snapshot, and the
          request below is that same snapshot through one projection — so the three
          strings shown and the three strings sent are the same three strings.
        */}
        {preview !== null ? (
          <div className="wizard-preview__step">
            <p className="wizard-preview__header">{TEAM_ADMIN_SETUP_METADATA.previewTitle}</p>
            <p className="wizard-preview__purpose">{TEAM_ADMIN_SETUP_METADATA.previewIntro}</p>
            <MetricRow
              label={TEAM_ADMIN_SETUP_METADATA.previewNameLabel}
              value={preview.name.value}
            />
            <MetricRow
              label={TEAM_ADMIN_SETUP_METADATA.previewSymbolLabel}
              value={preview.symbol.value}
            />
            <MetricRow
              label={TEAM_ADMIN_SETUP_METADATA.previewUriLabel}
              value={preview.uri.value}
              hint={TEAM_ADMIN_SETUP_METADATA.locationPlainTextNote}
            />
            <MetricRow
              label={TEAM_ADMIN_SETUP_METADATA.previewCampaignLabel}
              value={shortenMetadataAddress(preview.context.campaignAddress)}
            />
            <MetricRow
              label={TEAM_ADMIN_SETUP_METADATA.previewOutputMintLabel}
              value={shortenMetadataAddress(preview.context.campaignOutputMint)}
              hint="read from the selected campaign — never entered here and never editable"
            />
            <MetricRow
              label={TEAM_ADMIN_SETUP_METADATA.previewTargetLabel}
              value={shortenMetadataAddress(preview.context.metadataTarget)}
              hint={TEAM_ADMIN_SETUP_METADATA.previewTargetHint}
            />
            <p className="wizard-preview__header">
              {TEAM_ADMIN_SETUP_METADATA.immutableWarningTitle}
            </p>
            <p className="wizard-preview__fieldwarning">
              {TEAM_ADMIN_SETUP_METADATA.immutableWarning}
            </p>

            <div className="wizard-preview__stepfoot">
              {/*
                MUTATION-ACTION CONTROL 1 of 2. Declared exactly once in this file, inside
                the preview it acts on, so a click can only ever carry values the operator
                has just been shown. There is no retry affordance anywhere beside it.
              */}
              <button
                className="wallet-badge__btn"
                disabled={!setEnabled}
                onClick={() => {
                  void handleSetMetadata()
                }}
                type="button"
              >
                {operation === 'submit'
                  ? TEAM_ADMIN_SETUP_METADATA.setActionBusyLabel
                  : TEAM_ADMIN_SETUP_METADATA.setActionLabel}
              </button>
              <p className="wizard-preview__fieldnote">
                {setEnabled
                  ? TEAM_ADMIN_SETUP_METADATA.setActionHelp
                  : TEAM_ADMIN_SETUP_METADATA.setActionBlockedHelp}
              </p>

        {/*
          THE VISIBLE SOL LINE AND ITS EXPLICIT READ-ONLY RE-CHECK. They appear together and
          only while the balance is not a plain known-sufficient one — a hidden button explains
          nothing, and a sufficient balance needs no sentence and no amount.

          The button is READ-ONLY and is NOT a mutation transaction action: this panel's
          transaction-control count is unchanged by it.
        */}
        {metadataSolPreflightNote !== null ? (
          <div className="wizard-preview__policy">
            <p className="wizard-preview__fieldnote">{metadataSolPreflightNote}</p>
            <button
              className="wallet-badge__btn"
              disabled={!metadataSolPreflightActionable || busy || metadataSolPreflight.kind === 'reading'}
              onClick={handleMetadataSolPreflightRecheck}
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
          and no edit inside it, and it reproduces no name, symbol or location — the
          durable record holds commitments rather than text, and a commitment is not
          invertible.
        */}
        {recoveryRow !== null ? (
          <div className="wizard-preview__step">
            <p className="wizard-preview__header">{TEAM_ADMIN_SETUP_METADATA.recoveryTitle}</p>
            <p className="wizard-preview__purpose">{TEAM_ADMIN_SETUP_METADATA.recoveryIntro}</p>
            <div className="wizard-preview__stephead">
              <StatusPill
                label={TEAM_ADMIN_SETUP_METADATA.recoveryLabel[recoveryRow.outcome]}
                tone={
                  recoveryRow.outcome === 'METADATA_SET'
                    ? 'positive'
                    : recoveryRow.outcome === 'SUBMITTED'
                      ? 'caution'
                      : 'neutral'
                }
              />
            </div>
            <p className="wizard-preview__purpose">
              {TEAM_ADMIN_SETUP_METADATA.recoveryNote[recoveryRow.outcome]}
            </p>
            <MetricRow
              label={TEAM_ADMIN_SETUP_METADATA.previewCampaignLabel}
              value={shortenMetadataAddress(recoveryRow.campaign)}
              hint="the campaign this saved attempt named"
            />
            {recoveryRow.metadataTarget !== null ? (
              <MetricRow
                label={TEAM_ADMIN_SETUP_METADATA.previewTargetLabel}
                value={shortenMetadataAddress(recoveryRow.metadataTarget)}
                hint={TEAM_ADMIN_SETUP_METADATA.previewTargetHint}
              />
            ) : null}
          </div>
        ) : null}

        <div className="wizard-preview__stepfoot">
          {/*
            MUTATION-ACTION CONTROL 2 of 2. It reconciles the saved attempt and re-reads
            it, and it is the only affordance offered once an attempt is past the point
            where it may already have reached the network.
          */}
          <button
            className="wallet-badge__btn"
            disabled={busy || approvedTeamWallet === null}
            onClick={() => {
              void handleCheckMetadataStatus()
            }}
            type="button"
          >
            {operation === 'status'
              ? TEAM_ADMIN_SETUP_METADATA.statusActionBusyLabel
              : TEAM_ADMIN_SETUP_METADATA.statusActionLabel}
          </button>
          <p className="wizard-preview__fieldnote">
            {TEAM_ADMIN_SETUP_METADATA.statusActionHelp}
          </p>
          <p className="wizard-preview__purpose">{statusSummary}</p>
          {chainTruth.freshReadRefused ? (
            <p className="wizard-preview__fieldwarning">
              {TEAM_ADMIN_SETUP_METADATA.blockingNote.CHAIN_TRUTH_UNAVAILABLE}
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
            <p className="wizard-preview__header">{TEAM_ADMIN_SETUP_METADATA.resultTitle}</p>
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
                ? TEAM_ADMIN_SETUP_METADATA.anotherMutationRunning
                : describeRedaxTeamAdminMutationSubmitCode(submitResult.code)}
            </p>
          </div>
        ) : null}

        <div className="wizard-preview__claims">
          <p className="wizard-preview__header">{TEAM_ADMIN_SETUP_METADATA.nonClaimsTitle}</p>
          <ul>
            {TEAM_ADMIN_SETUP_METADATA.nonClaims.map((claim) => (
              <li key={claim}>{claim}</li>
            ))}
          </ul>
        </div>
      </div>
    </SurfaceCard>
  )
}
