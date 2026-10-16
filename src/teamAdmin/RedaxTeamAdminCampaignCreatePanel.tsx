// REDAX Team/Admin devnet Campaign Create panel — the ONE visible S1 Campaign Create
// action.
//
// TRUST. The approved Team wallet arrives as ONE read-only prop, resolved once in App
// from the single canonical runtime carrier resolver. This module reads no environment,
// no URL, no query parameter and no browser storage; it takes no approved-wallet input
// from the user; and it never derives the approved identity from the connected wallet —
// A CONNECTED WALLET MUST NOT APPROVE ITSELF. The comparison it makes between the two is
// ENABLEMENT UX, not authority: the chain guard inside the action root re-establishes
// identity and eligibility against live devnet state before anything is signed, and it
// would refuse an attempt this panel had been tricked into enabling.
//
// WALLET SURFACE. It consumes the narrow `useRedaxWallet` facade only — detected
// wallets, connect, disconnect, status, public key and shortened display. That facade
// has no adapter member and no signing or sending member, so none can be reached from
// here. Every signing and sending step belongs to `submitS1` inside the action root.
//
// TWO TRANSACTION CONTROLS, BOTH EXPLICIT. `Create devnet campaign` calls `submitS1` from
// its own click handler and nowhere else. `Check submission status` calls `reconcileS1`
// from its own click handler and nowhere else. Neither is called on mount, on render, from
// an effect, on connect, on disconnect, on a selection change, on a field change, from a
// timer, from a poll, or as an automatic retry. There is no <form>, so Enter submits nothing.
//
// A THIRD CONTROL EXISTS AND IS READ-ONLY: `Re-check SOL availability` calls the action
// root's passive preflight member and nothing else. It builds no instruction, opens no
// wallet, signs nothing, sends nothing, writes no durable record and takes no single-flight
// latch, so the count of TRANSACTION actions here is still exactly TWO.
//
// CREATING A CAMPAIGN DOES NOT LIST ONE. Navigating to the new campaign opens an UNLISTED
// workspace: nothing here, and nothing App does with this callback, adds the campaign to
// the curated public directory, the featured list or the deployment's Campaign allowlist,
// and no source anywhere writes that carrier.
//
// SINGLE FLIGHT. A synchronous ref latch is taken before the first await and released
// only in a finally, alongside the rendered operation state. A disabled attribute alone
// would not do: two clicks inside one frame both see the same rendered state.
//
// AFTER THE POINT OF NO RETURN. When a submission reports `rawBroadcastCount === 1`,
// something may have reached devnet, and this panel stops offering Campaign Create
// altogether. It is not a retry surface and must never become one; the honest next step
// is `Check submission status`, which signs nothing and sends nothing.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import { MetricRow } from '../components/MetricRow'
import { StatusPill } from '../components/StatusPill'
import { SurfaceCard } from '../components/SurfaceCard'
import {
  TEAM_ADMIN_CAMPAIGN_CREATE,
  TEAM_ADMIN_OPEN_UNLISTED_WORKSPACE,
  TEAM_ADMIN_SOL_PREFLIGHT_INSUFFICIENT,
  TEAM_ADMIN_SOL_PREFLIGHT_READING,
  TEAM_ADMIN_SOL_PREFLIGHT_RECHECK_LABEL,
  TEAM_ADMIN_SOL_PREFLIGHT_SUBMIT_REFUSED,
  TEAM_ADMIN_SOL_PREFLIGHT_UNAVAILABLE,
} from '../lib/productCopy'
import type { TeamAdminCampaignCreateFieldId } from '../lib/productCopy'
import { getTeamAdminWizardInputMode, validateTeamAdminWizardField } from '../lib/teamAdminWizardDraft'
import type { TeamAdminWizardFieldValidation } from '../lib/teamAdminWizardDraft'
import { useRedaxWallet } from '../wallet/RedaxWalletProvider'
import { useRedaxTeamAdminActions } from './RedaxTeamAdminActions'
import type {
  RedaxTeamAdminS1ReconcileCode,
  RedaxTeamAdminS1ReconcileResult,
  RedaxTeamAdminSolPreflightResult,
  RedaxTeamAdminS1SubmitCode,
  RedaxTeamAdminS1SubmitResult,
} from './RedaxTeamAdminActions'

// --- C1 devnet SOL availability — panel-local, identity-scoped ------------------
//
// AVAILABILITY INFORMATION, NEVER AUTHORITY. This gates only what this panel OFFERS. The
// action root performs its OWN attempt-authoritative recheck — on the attempt's own
// Connection, at the attempt's own floor, through the same private observer, and after the
// early unresolved-attempt check — so a stale or optimistic value here can widen no gate
// that matters.
//
// `idle` exists only for an identity that cannot be read about at all. An actionable
// identity is READING until its own read settles, so an unread balance is never mistaken
// for a sufficient one.
type CampaignCreateSolPreflightState =
  | { kind: 'idle' }
  | { kind: 'reading' }
  | { kind: 'settled'; result: RedaxTeamAdminSolPreflightResult }

const CREATE_SOL_PREFLIGHT_IDLE: CampaignCreateSolPreflightState = { kind: 'idle' }
const CREATE_SOL_PREFLIGHT_READING: CampaignCreateSolPreflightState = { kind: 'reading' }

/**
 * IDENTITY PRIVACY IS A RENDER-TIME RULE, NOT A CLEANUP RACE.
 *
 * A panel-local value is stored together with the EXACT identity scope that produced it and
 * read back through `inScope` while the tree is computed. A value whose recorded scope is
 * not the current one is therefore invisible AND unusable in the very first render that
 * observes a new wallet or carrier — before any passive effect runs, and whether or not one
 * ever does.
 */
interface ScopedState<T> {
  readonly scope: string
  readonly value: T
}

function scopedState<T>(scope: string, value: T): ScopedState<T> {
  return { scope, value }
}

function inScope<T>(record: ScopedState<T>, currentScope: string, restingValue: T): T {
  return record.scope === currentScope ? record.value : restingValue
}

/**
 * THE C1 SCOPE FOR THE S1 CREATE ACTION.
 *
 * Its dimensions are the approved Team carrier and the connected wallet's public identity,
 * and DELIBERATELY NOTHING ELSE. There is no Campaign dimension because no Campaign exists
 * before the output-mint entropy is drawn — inventing one would be inventing an identity
 * this action does not have.
 *
 * DRAFT TEXT IS NOT A SCOPE DIMENSION EITHER. The S1 threshold is four rent floors and one
 * fee bound; no deadline, cap, name, symbol or URI can change it, so a keystroke must never
 * trigger another automatic devnet read.
 */
export function redaxTeamAdminCreateSolPreflightScope(
  approvedTeamWallet: string | null,
  connectedPublicKey: string | null,
): string {
  return `${approvedTeamWallet ?? ''}|${connectedPublicKey ?? ''}`
}

/** The five planning inputs, held in this component's memory and nowhere else. */
type CampaignCreateDraft = Record<TeamAdminCampaignCreateFieldId, string>

const EMPTY_DRAFT: CampaignCreateDraft = {
  endTs: '',
  maxOutputSupply: '',
  metadataName: '',
  metadataSymbol: '',
  metadataUri: '',
}

/** Which operation, if any, is running. Rendered state beside the ref latch. */
type CampaignCreateOperation = 'submit' | 'reconcile'

/**
 * How this panel describes the identity situation, for ENABLEMENT UX only.
 *
 * It is deliberately not an authority, not a role, and not a capability: the chain
 * guard decides eligibility, and this is only what the operator is told about why a
 * button is or is not available.
 */
export type RedaxTeamAdminCarrierUxStatus =
  | 'CARRIER_UNAVAILABLE'
  | 'DISCONNECTED'
  | 'CONNECTED_MATCH'
  | 'CONNECTED_MISMATCH'

export interface RedaxTeamAdminCampaignCreatePanelProps {
  /**
   * The ONE canonical approved Team wallet, resolved once in App.
   *
   * `null` means the deployment configured no usable carrier — missing or malformed
   * alike — and the whole action surface fails closed on it. It is the SAME value App
   * passes to `RedaxTeamAdminActionsProvider`, so the panel and the action root can
   * never disagree about who is approved.
   */
  readonly approvedTeamWallet: string | null
  /**
   * LOCAL NAVIGATION ONLY. Invoked with the created campaign's address when — and only
   * when — a human clicks the workspace control this panel renders for a verified
   * matching-complete submission.
   *
   * It is not an action-root capability, not a wallet capability, not a transaction, not
   * a recovery step and not a listing admission. It is optional: when it is absent the
   * control does not render at all, and everything else on this panel is unchanged.
   */
  readonly onOpenUnlistedCampaignWorkspace?: (campaignId: string) => void
}

/** Shortened display form (4…4). The full address is never rendered by this panel. */
function shortenAddress(value: string): string {
  return value.length <= 9 ? value : `${value.slice(0, 4)}…${value.slice(-4)}`
}

/**
 * The identity situation, derived from the injected carrier and the wallet facade.
 *
 * The connected key is compared to the injected carrier by EXACT equality. There is no
 * normalization, no case folding and no prefix match, because a near-miss is a
 * different wallet.
 */
export function deriveRedaxTeamAdminCarrierUxStatus(
  approvedTeamWallet: string | null,
  connectedPublicKey: string | null,
): RedaxTeamAdminCarrierUxStatus {
  if (approvedTeamWallet === null) {
    return 'CARRIER_UNAVAILABLE'
  }
  if (connectedPublicKey === null) {
    return 'DISCONNECTED'
  }
  return connectedPublicKey === approvedTeamWallet ? 'CONNECTED_MATCH' : 'CONNECTED_MISMATCH'
}

/**
 * One sentence per submit code, over the WHOLE closed union.
 *
 * The `never` binding in the default arm is the point: this is a source-total mapping
 * of the action root's own vocabulary, not a parallel state machine, so a code added
 * there stops this file compiling until it is described here. No raw wallet error, RPC
 * error, signature or transaction byte can appear — the result type carries none.
 */
export function describeRedaxTeamAdminSubmitCode(code: RedaxTeamAdminS1SubmitCode): string {
  switch (code) {
    case 'RUNTIME_CONFIG_UNAVAILABLE':
      return 'The devnet runtime configuration was unusable, so nothing was built and nothing was sent.'
    case 'WALLET_NOT_CONNECTED':
      return 'No wallet was connected when the action ran. Nothing was built and nothing was sent.'
    case 'WALLET_SIGN_ONLY_UNAVAILABLE':
      return 'The wallet could not offer the sign-only surface this action requires. Nothing was signed and nothing was sent.'
    case 'APPROVED_TEAM_IDENTITY_UNAVAILABLE':
      return 'No approved Team identity was available to the action, so it refused before drawing any key material.'
    // ONE CODE, THREE PATHS, AND ONLY TWO OF THEM ARE PRE-WALLET. The action root
    // returns this code from Phase A and from Phase B — both strictly before any
    // prompt — and from the POST-WALLET reassertion, which runs AFTER a successful
    // sign-only return and AFTER exact two-signature verification. The retired
    // sentence ended 'Nothing was signed and nothing was sent'; the first half was
    // false on that third path, and the first authorized live attempt took it, with
    // one approved wallet prompt and zero broadcast. What all three DO share is that
    // the one raw send sits after the reassertion and is never reached — so the send
    // is denied outright and the signature is spoken of conditionally, which is the
    // only phrasing true on every path this one code covers.
    case 'CHAIN_GUARD_REFUSED':
      return 'The chain guard refused this attempt against live devnet state. No transaction was sent. If a wallet approval had already occurred, its signed artifact was discarded before broadcast.'
    case 'ENTROPY_UNAVAILABLE':
      return 'Secure randomness was unavailable, so no output mint key was generated and nothing was sent.'
    case 'ATTEMPT_STATE_INVALID':
      return 'The attempt was not in a state this step may run from. Nothing was signed and nothing was sent.'
    case 'PLAN_INVALID':
      return 'The campaign terms did not form a valid plan. Nothing was signed and nothing was sent.'
    case 'RENT_READ_UNAVAILABLE':
      return 'The rent-exemption figure could not be read from devnet, so the transaction was not built and nothing was sent.'
    // KNOWN INSUFFICIENT, AND PRE-ENTROPY. A complete, valid reading proved the balance too
    // low, and the refusal happened before any output-mint key was generated — so no custody
    // was held, no plan was frozen, nothing was assembled past the SOL gate, the wallet was
    // never asked, and nothing was sent. It is deliberately NOT the guard refusal above:
    // that one covers unknowns, and this one covers a fact. Value-free: no amount, no
    // threshold and no failing term is named.
    case 'PAYER_SOL_INSUFFICIENT':
      return TEAM_ADMIN_SOL_PREFLIGHT_SUBMIT_REFUSED
    case 'BUILD_FAILED':
      return 'The transaction could not be assembled. Nothing was signed and nothing was sent.'
    case 'MESSAGE_COMMITMENT_UNAVAILABLE':
      return 'The message commitment could not be computed, so the wallet was never asked and nothing was sent.'
    case 'ATTEMPT_BLOCKED':
      return 'A saved submission is still unresolved, so a new attempt is deliberately blocked. Use Check submission status.'
    case 'JOURNAL_UNAVAILABLE':
      return 'The durable submission record could not be opened, so nothing was signed and nothing was sent.'
    case 'WALLET_SIGN_ONLY_REFUSED':
      return 'The signature request was declined or failed in the wallet. Nothing was sent.'
    case 'SIGNED_ARTIFACT_REJECTED':
      return 'The signed transaction did not pass exact two-signature verification, so it was discarded and nothing was sent.'
    case 'INVOCATION_RECORD_UNVERIFIED':
      return 'The durable record of this attempt could not be read back before sending, so the send was deliberately not reached. Nothing was sent.'
    case 'PRE_BROADCAST_INTERNAL_FAILURE':
      return 'This attempt ended unexpectedly before anything could be sent. Nothing was broadcast, and no retry is granted by it.'
    case 'SUBMITTED_MATCHING_COMPLETE_STATE':
      return 'The submission landed and the planned campaign state was found complete and coherent on devnet.'
    case 'SUBMITTED_TERMINAL_FAILURE':
      return 'The submission reached devnet and finalized as a failure. Nothing was created, and this attempt is resolved.'
    case 'SUBMITTED_OUTCOME_PENDING':
      return 'The submission was sent and has not settled yet. This is not a failure, and nothing may be sent again — check the status later.'
    case 'SUBMITTED_OUTCOME_UNRESOLVED_SUPPORT':
      return 'The submission was sent and could not be resolved automatically. It stays unresolved and blocking; a human decides what happens next.'
    case 'TERMINAL_RECORD_UNVERIFIED':
      return 'The expected durable record could not be read back. That is not evidence about what happened on devnet — only a later exact read can say.'
    case 'POST_INVOCATION_INTERNAL_FAILURE':
      return 'Something failed unexpectedly after the submission was invoked, so something may have been sent. Check the submission status; nothing is sent again.'
    default: {
      const exhaustive: never = code
      return exhaustive
    }
  }
}

/**
 * One sentence per reconcile code, over the WHOLE closed union.
 *
 * Pending, not-yet-expired and not-proven are rendered as exactly what they are. None
 * of them is translated into "failed", none suggests a retry, and none is a permission.
 */
export function describeRedaxTeamAdminReconcileCode(
  code: RedaxTeamAdminS1ReconcileCode,
): string {
  switch (code) {
    case 'RUNTIME_CONFIG_UNAVAILABLE':
      return 'The devnet runtime configuration was unusable, so nothing could be read.'
    case 'APPROVED_TEAM_IDENTITY_UNAVAILABLE':
      return 'No approved Team identity was available, so the saved record could not be located.'
    case 'JOURNAL_UNAVAILABLE':
      return 'The durable submission record could not be read.'
    case 'NOTHING_TO_RECONCILE':
      return 'No saved submission exists for this deployment. Nothing has been sent from here.'
    case 'ALREADY_RESOLVED':
      return 'The saved submission is already resolved. There is nothing further to establish.'
    case 'NOT_INVOCATION_STARTED':
      return 'The saved attempt never reached the point of no return, so nothing was broadcast by it.'
    case 'SIGNATURE_UNKNOWN_UNRESOLVED':
      return 'The saved attempt has no transaction identity to reconcile against, so it stays unresolved.'
    case 'OUTCOME_PENDING':
      return 'The submission has not settled yet. This is not a failure; it will be readable later, and nothing is sent again meanwhile.'
    case 'OUTCOME_UNRESOLVED_SUPPORT':
      return 'The submission could not be resolved automatically. It stays unresolved and blocking; a human decides what happens next.'
    case 'TERMINAL_FAILURE_RESOLVED':
      return 'The submission finalized as a failure. Nothing was created, and the record is now resolved.'
    case 'FINALIZED_NO_LAND_RESOLVED':
      return 'The submission was proven, at a finalized level, never to have landed, and the record is now resolved.'
    case 'NOT_EXPIRED':
      return 'The submission has not strictly expired yet, so nothing can be concluded about it. It is not a failure.'
    case 'NO_LAND_NOT_PROVEN':
      return 'The submission has expired, but the full no-landing proof did not hold, so nothing is concluded. It is not a failure.'
    case 'TERMINAL_RECORD_UNVERIFIED':
      return 'The expected durable record could not be read back, so its state is unknown until a later exact read.'
    case 'RECONCILE_INTERNAL_FAILURE':
      return 'The status check ended unexpectedly. Nothing was signed, nothing was sent, and nothing changed.'
    default: {
      const exhaustive: never = code
      return exhaustive
    }
  }
}

export function RedaxTeamAdminCampaignCreatePanel({
  approvedTeamWallet,
  onOpenUnlistedCampaignWorkspace,
}: RedaxTeamAdminCampaignCreatePanelProps) {
  const wallet = useRedaxWallet()
  const actions = useRedaxTeamAdminActions()

  const [draft, setDraft] = useState<CampaignCreateDraft>(EMPTY_DRAFT)
  const [operation, setOperation] = useState<CampaignCreateOperation | null>(null)
  const [submitResult, setSubmitResult] = useState<RedaxTeamAdminS1SubmitResult | null>(null)
  const [reconcileResult, setReconcileResult] =
    useState<RedaxTeamAdminS1ReconcileResult | null>(null)

  // The synchronous single-flight latch. Rendered state cannot serve alone: two clicks
  // inside one frame both observe the same `operation`, and both would pass a check
  // written against it. This ref is taken before the first await of either handler.
  const inFlightRef = useRef<CampaignCreateOperation | null>(null)

  // --- C1 devnet SOL availability ---------------------------------------------
  const solPreflightScope = redaxTeamAdminCreateSolPreflightScope(
    approvedTeamWallet,
    wallet.publicKeyBase58,
  )
  // The identity is ACTIONABLE — worth reading a balance about — only when a carrier
  // exists, a wallet is connected, and that wallet is EXACTLY the approved Team. Any other
  // identity resolves to `idle`: this panel does not read, and does not report, a balance
  // belonging to a wallet that could not pay for an S1 anyway.
  const solPreflightActionable =
    approvedTeamWallet !== null &&
    wallet.status === 'connected' &&
    wallet.publicKeyBase58 === approvedTeamWallet

  const [solPreflightRecord, setSolPreflightRecord] = useState<
    ScopedState<CampaignCreateSolPreflightState>
  >(() =>
    scopedState(
      solPreflightScope,
      solPreflightActionable ? CREATE_SOL_PREFLIGHT_READING : CREATE_SOL_PREFLIGHT_IDLE,
    ),
  )

  // RENDER-TIME IDENTITY GATING. The projection collapses to its neutral resting value the
  // moment the identity that produced it stops being current — in THIS render, not in a
  // later effect. So a connected-wallet change invalidates an old reading immediately, and
  // a previous wallet's sufficiency can never enable a control for a new one.
  const solPreflight = inScope(
    solPreflightRecord,
    solPreflightScope,
    solPreflightActionable ? CREATE_SOL_PREFLIGHT_READING : CREATE_SOL_PREFLIGHT_IDLE,
  )

  const mountedRef = useRef(true)
  // COMMITTED IDENTITY — PUBLISHED AT COMMIT, NEVER DURING RENDER. React shares one ref
  // object between the current fiber and an interruptible work-in-progress fiber, so a
  // render-phase write would let an ABANDONABLE render for a new identity retag a read the
  // still-committed identity owns, and symmetrically invalidate a valid one.
  const committedSolPreflightScopeRef = useRef(solPreflightScope)
  const solPreflightGenerationRef = useRef(0)
  // The LATEST read-only member, held so the reader below can depend on nothing that
  // churns. `useRedaxTeamAdminActions()` hands back the provider's context VALUE; depending
  // on that object would give the reader a new identity on any render that produced a fresh
  // wrapper, the automatic effect would re-run, set state and schedule itself again — an
  // unbounded render loop issuing unbounded balance and rent reads at a live endpoint.
  const readSolPreflightRef = useRef(actions.readTeamAdminSolPreflight)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  // The commit-phase publications. A layout effect runs after the commit and before any
  // passive effect of the same commit, so the refs are already current when the automatic
  // read for a changed scope runs.
  useLayoutEffect(() => {
    committedSolPreflightScopeRef.current = solPreflightScope
  }, [solPreflightScope])

  useLayoutEffect(() => {
    readSolPreflightRef.current = actions.readTeamAdminSolPreflight
  }, [actions.readTeamAdminSolPreflight])

  // EVERY ASYNC COMPLETION MUST PROVE THREE THINGS before it may write state: the component
  // is still mounted, the COMMITTED scope is the one the read started in, and the read is
  // still the newest one. A stale completion writes nothing at all.
  const isSolPreflightCurrent = useCallback((scopeKey: string, generation: number): boolean => {
    return (
      mountedRef.current &&
      committedSolPreflightScopeRef.current === scopeKey &&
      solPreflightGenerationRef.current === generation
    )
  }, [])

  // ONE read-only devnet SOL read. It builds nothing, signs nothing, sends nothing,
  // confirms nothing, touches no durable record and returns no authorization — it only
  // decides whether this panel may OFFER the action. Each call supersedes the previous one,
  // so a slow earlier read can never be the last writer.
  const runSolPreflightRead = useCallback(
    async (scopeKey: string): Promise<void> => {
      solPreflightGenerationRef.current += 1
      const generation = solPreflightGenerationRef.current
      setSolPreflightRecord(scopedState(scopeKey, CREATE_SOL_PREFLIGHT_READING))
      try {
        const result = await readSolPreflightRef.current()
        if (!isSolPreflightCurrent(scopeKey, generation)) {
          return
        }
        setSolPreflightRecord(
          scopedState<CampaignCreateSolPreflightState>(scopeKey, { kind: 'settled', result }),
        )
      } catch {
        // A REJECTED read is not an observation. It settles as READ_UNAVAILABLE — which
        // WITHHOLDS the action — rather than as an unhandled rejection or an optimistic
        // sufficiency. No raw error is read, rendered or logged.
        if (!isSolPreflightCurrent(scopeKey, generation)) {
          return
        }
        setSolPreflightRecord(
          scopedState<CampaignCreateSolPreflightState>(scopeKey, {
            kind: 'settled',
            result: 'READ_UNAVAILABLE',
          }),
        )
      }
    },
    [isSolPreflightCurrent],
  )

  // EXACTLY ONE AUTOMATIC READ PER NEW ACTIONABLE SCOPE, and no more. There is no timer, no
  // interval, no polling, no subscription and no automatic retry: a stale reading is
  // corrected by the explicit human re-check below, and never by this panel deciding on its
  // own to ask again. A draft keystroke is not a dependency here, so typing reads nothing.
  useEffect(() => {
    if (!solPreflightActionable) {
      setSolPreflightRecord(scopedState(solPreflightScope, CREATE_SOL_PREFLIGHT_IDLE))
      return
    }
    void runSolPreflightRead(solPreflightScope)
  }, [solPreflightActionable, solPreflightScope, runSolPreflightRead])

  // KNOWN-SUFFICIENT ONLY. A reading, an idle projection and a failed read all resolve to
  // false, because an unknown balance must WITHHOLD an action rather than allow one.
  const solPreflightSufficient =
    solPreflight.kind === 'settled' && solPreflight.result === 'SUFFICIENT'

  // The truthful SOL line, and null exactly when the state is a plain known-sufficient one
  // — which needs no sentence, and certainly no amount.
  const solPreflightNote: string | null =
    solPreflight.kind === 'reading'
      ? TEAM_ADMIN_SOL_PREFLIGHT_READING
      : solPreflight.kind === 'idle'
        ? null
        : solPreflight.result === 'INSUFFICIENT'
          ? TEAM_ADMIN_SOL_PREFLIGHT_INSUFFICIENT
          : solPreflight.result === 'READ_UNAVAILABLE'
            ? TEAM_ADMIN_SOL_PREFLIGHT_UNAVAILABLE
            : null

  const validations = useMemo((): Record<
    TeamAdminCampaignCreateFieldId,
    TeamAdminWizardFieldValidation | null
  > => {
    // The repository's own field policy, reused rather than restated: a second parser
    // with slightly different bounds would be a second, quieter definition of valid.
    return {
      endTs: validateTeamAdminWizardField('endTs', draft.endTs),
      maxOutputSupply: validateTeamAdminWizardField('maxOutputSupply', draft.maxOutputSupply),
      metadataName: validateTeamAdminWizardField('metadataName', draft.metadataName),
      metadataSymbol: validateTeamAdminWizardField('metadataSymbol', draft.metadataSymbol),
      metadataUri: validateTeamAdminWizardField('metadataUri', draft.metadataUri),
    }
  }, [draft])

  // A warning is a value the program would reject and blocks the action; a note is
  // neutral information (`0 = uncapped`, an optional deadline) and blocks nothing.
  const hasBlockingWarning = TEAM_ADMIN_CAMPAIGN_CREATE.fields.some(
    (field) => validations[field.id]?.tone === 'warning',
  )

  const uxStatus = deriveRedaxTeamAdminCarrierUxStatus(
    approvedTeamWallet,
    wallet.publicKeyBase58,
  )
  const busy = operation !== null
  // Something may already have reached devnet. This panel then stops offering Campaign
  // Create entirely — a second create would not be a retry, it would be a second campaign.
  const postBroadcast = submitResult?.rawBroadcastCount === 1
  const custodyOpen = actions.attempt.custodyPresent
  // The ONE campaign address this panel may offer LOCAL NAVIGATION to, or null.
  //
  // All three facts are required and none is redundant. `ok` alone is not the terminal;
  // the exact `SUBMITTED_MATCHING_COMPLETE_STATE` code is what says the planned campaign
  // state was found complete and coherent on devnet; and a non-null campaign address is
  // what says there is something to open. A NON-NULL CAMPAIGN ON ITS OWN IS NOT ENOUGH
  // and must never become the condition — a pending, unresolved, failed or unverified
  // terminal can carry an address without having established anything about it, and
  // offering navigation on one would present an unproven outcome as a finished one.
  //
  // It is a `const` rather than an inline condition on purpose: the click handler below
  // closes over THIS value, so the address it navigates to is the exact one this
  // derivation proved, and no later render can hand it a different one.
  const openableCampaignAddress: string | null =
    submitResult !== null &&
    submitResult.ok &&
    submitResult.code === 'SUBMITTED_MATCHING_COMPLETE_STATE'
      ? submitResult.campaign
      : null

  const canSubmit =
    approvedTeamWallet !== null &&
    uxStatus === 'CONNECTED_MATCH' &&
    wallet.status === 'connected' &&
    !hasBlockingWarning &&
    !busy &&
    !custodyOpen &&
    !postBroadcast &&
    // The action is not EXPOSED unless the payer balance is KNOWN to be enough. A reading,
    // an idle projection, an INSUFFICIENT result and a READ_UNAVAILABLE result each
    // withhold it; every existing validation, busy, custody and post-broadcast condition
    // above is unchanged and still applies.
    solPreflightSufficient

  // Reconciliation deliberately does NOT require a connected wallet: the case it exists
  // for is a refresh or a disconnect after a submission, which is exactly when the
  // operator has the least and needs it most. It cannot sign, prompt or send.
  const canReconcile = approvedTeamWallet !== null && !busy

  const updateField = useCallback((id: TeamAdminCampaignCreateFieldId, value: string): void => {
    setDraft((current) => ({ ...current, [id]: value }))
  }, [])

  const handleCreate = useCallback(async (): Promise<void> => {
    // Synchronous latch first, before any await and before any state read that a second
    // click could observe unchanged.
    if (inFlightRef.current !== null) {
      return
    }
    if (!canSubmit) {
      return
    }
    // THE COMMITTED PROJECTION, RE-ASSERTED SYNCHRONOUSLY. `canSubmit` is a rendering, and a
    // rendering can be one commit behind the identity a click actually belongs to — so the
    // handler repeats the check against the scope that is COMMITTED right now rather than
    // trusting the disabled attribute that let the click through.
    //
    // THIS IS NOT AUTHORITY, and cannot become authority. `submitS1` reads the balance again
    // itself, on the attempt's own Connection and at the attempt's own floor, and refuses
    // there regardless of what this local projection says.
    if (
      solPreflightScope !== committedSolPreflightScopeRef.current ||
      !solPreflightSufficient
    ) {
      return
    }
    inFlightRef.current = 'submit'
    setOperation('submit')
    setReconcileResult(null)
    try {
      const result = await actions.submitS1({
        endTs: draft.endTs,
        maxOutputSupply: draft.maxOutputSupply,
        metadataName: draft.metadataName,
        metadataSymbol: draft.metadataSymbol,
        metadataUri: draft.metadataUri,
        lifecycleIntent: 'remain_initialized',
        tokenConfigs: [],
      })
      setSubmitResult(result)
    } finally {
      inFlightRef.current = null
      setOperation(null)
    }
  }, [actions, canSubmit, draft, solPreflightScope, solPreflightSufficient])

  /**
   * THE EXPLICIT, READ-ONLY SOL RE-CHECK. It runs ONLY from the button click below.
   *
   * It builds nothing, signs nothing, sends nothing, confirms nothing, writes no durable
   * record and returns no authorization, and there is no timer, no poll, no storage event
   * and no subscription behind it. IT IS NOT A TRANSACTION ACTION: it does not take the
   * single-flight latch, does not set `operation`, and never counts toward this panel's
   * transaction-control census. It supersedes only its own previous read.
   */
  const handleSolPreflightRecheck = useCallback((): void => {
    if (solPreflightScope !== committedSolPreflightScopeRef.current) {
      return
    }
    if (!solPreflightActionable || busy || solPreflight.kind === 'reading') {
      return
    }
    void runSolPreflightRead(solPreflightScope)
  }, [busy, runSolPreflightRead, solPreflight.kind, solPreflightActionable, solPreflightScope])

  const handleReconcile = useCallback(async (): Promise<void> => {
    if (inFlightRef.current !== null) {
      return
    }
    if (!canReconcile) {
      return
    }
    inFlightRef.current = 'reconcile'
    setOperation('reconcile')
    try {
      const result = await actions.reconcileS1()
      setReconcileResult(result)
    } finally {
      inFlightRef.current = null
      setOperation(null)
    }
  }, [actions, canReconcile])

  const identityNote =
    uxStatus === 'CARRIER_UNAVAILABLE'
      ? TEAM_ADMIN_CAMPAIGN_CREATE.carrierUnavailable
      : uxStatus === 'DISCONNECTED'
        ? TEAM_ADMIN_CAMPAIGN_CREATE.disconnected
        : uxStatus === 'CONNECTED_MATCH'
          ? TEAM_ADMIN_CAMPAIGN_CREATE.connectedMatch
          : TEAM_ADMIN_CAMPAIGN_CREATE.connectedMismatch

  return (
    <SurfaceCard
      eyebrow={TEAM_ADMIN_CAMPAIGN_CREATE.eyebrow}
      title={TEAM_ADMIN_CAMPAIGN_CREATE.title}
      footnote={TEAM_ADMIN_CAMPAIGN_CREATE.footnote}
    >
      <div className="wizard-preview">
        <p className="wizard-preview__intro">{TEAM_ADMIN_CAMPAIGN_CREATE.intro}</p>
        <p className="wizard-preview__boundary">{TEAM_ADMIN_CAMPAIGN_CREATE.boundary}</p>

        <div className="wizard-preview__step">
          <p className="wizard-preview__header">{TEAM_ADMIN_CAMPAIGN_CREATE.identityTitle}</p>
          <p className="wizard-preview__purpose">{identityNote}</p>

          {approvedTeamWallet !== null ? (
            <MetricRow
              label={TEAM_ADMIN_CAMPAIGN_CREATE.approvedKeyLabel}
              value={shortenAddress(approvedTeamWallet)}
              hint="configured for this deployment; never taken from the connected wallet"
            />
          ) : null}

          {wallet.shortPublicKey ? (
            <MetricRow
              label={TEAM_ADMIN_CAMPAIGN_CREATE.connectedKeyLabel}
              value={wallet.shortPublicKey}
              hint="shortened form only — the full address is never displayed"
            />
          ) : null}

          {approvedTeamWallet !== null && wallet.status !== 'connected' ? (
            <div className="wizard-preview__policy">
              {wallet.walletsDetected ? (
                <>
                  <p className="wizard-preview__fieldnote">
                    {TEAM_ADMIN_CAMPAIGN_CREATE.connectPrompt}
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
                  {TEAM_ADMIN_CAMPAIGN_CREATE.noWalletsDetected}
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
              {TEAM_ADMIN_CAMPAIGN_CREATE.disconnectLabel}
            </button>
          ) : null}

          {wallet.errorMessage ? (
            <p className="wizard-preview__fieldwarning">{wallet.errorMessage}</p>
          ) : null}
        </div>

        <div className="wizard-preview__step">
          <p className="wizard-preview__header">{TEAM_ADMIN_CAMPAIGN_CREATE.fieldsTitle}</p>
          <div className="wizard-preview__fields">
            {TEAM_ADMIN_CAMPAIGN_CREATE.fields.map((field) => {
              const validation = validations[field.id]
              const inputId = `redax-team-create-${field.id}`
              return (
                <div className="wizard-preview__field" key={field.id}>
                  <label className="wizard-preview__fieldname" htmlFor={inputId}>
                    {field.label}
                  </label>
                  <div className="wizard-preview__fieldbody">
                    <input
                      className="wizard-preview__input"
                      disabled={busy || postBroadcast}
                      id={inputId}
                      inputMode={getTeamAdminWizardInputMode(field.id)}
                      onChange={(event) => {
                        updateField(field.id, event.target.value)
                      }}
                      type="text"
                      value={draft[field.id]}
                    />
                    <p className="wizard-preview__fieldnote">{field.note}</p>
                    {validation ? (
                      <p
                        className={
                          validation.tone === 'warning'
                            ? 'wizard-preview__fieldwarning'
                            : 'wizard-preview__fieldhint'
                        }
                      >
                        {validation.message}
                      </p>
                    ) : null}
                  </div>
                </div>
              )
            })}
          </div>
          <p className="wizard-preview__draftnotice">
            {TEAM_ADMIN_CAMPAIGN_CREATE.metadataNotice}
          </p>
        </div>

        <div className="wizard-preview__step">
          <p className="wizard-preview__header">{TEAM_ADMIN_CAMPAIGN_CREATE.fixedTitle}</p>
          <ul className="wizard-preview__policylist">
            {TEAM_ADMIN_CAMPAIGN_CREATE.fixedNotes.map((fixedNote) => (
              <li key={fixedNote}>{fixedNote}</li>
            ))}
          </ul>
        </div>

        <div className="wizard-preview__stepfoot">
          {postBroadcast ? (
            <p className="wizard-preview__warning">
              {TEAM_ADMIN_CAMPAIGN_CREATE.postBroadcastNotice}
            </p>
          ) : (
            <>
              <button
                className="wallet-badge__btn"
                disabled={!canSubmit}
                onClick={() => {
                  void handleCreate()
                }}
                type="button"
              >
                {operation === 'submit'
                  ? TEAM_ADMIN_CAMPAIGN_CREATE.submitBusyLabel
                  : TEAM_ADMIN_CAMPAIGN_CREATE.submitLabel}
              </button>
              <p className="wizard-preview__fieldnote">
                {canSubmit
                  ? TEAM_ADMIN_CAMPAIGN_CREATE.submitHelp
                  : TEAM_ADMIN_CAMPAIGN_CREATE.submitBlockedHelp}
              </p>
            </>
          )}

          {/*
            THE VISIBLE SOL LINE AND ITS EXPLICIT READ-ONLY RE-CHECK. They appear together
            and only while the balance is not a plain known-sufficient one — a hidden button
            explains nothing, and a sufficient balance needs no sentence and no amount.

            The button is READ-ONLY and is NOT one of this panel's transaction actions:
            `Create devnet campaign` and `Check submission status` remain the only two, and
            this gesture builds, signs and sends nothing.
          */}
          {solPreflightNote !== null ? (
            <div className="wizard-preview__policy">
              <p className="wizard-preview__fieldnote">{solPreflightNote}</p>
              <button
                className="wallet-badge__btn"
                disabled={!solPreflightActionable || busy || solPreflight.kind === 'reading'}
                onClick={handleSolPreflightRecheck}
                type="button"
              >
                {TEAM_ADMIN_SOL_PREFLIGHT_RECHECK_LABEL}
              </button>
            </div>
          ) : null}

          <button
            className="wallet-badge__btn"
            disabled={!canReconcile}
            onClick={() => {
              void handleReconcile()
            }}
            type="button"
          >
            {operation === 'reconcile'
              ? TEAM_ADMIN_CAMPAIGN_CREATE.reconcileBusyLabel
              : TEAM_ADMIN_CAMPAIGN_CREATE.reconcileLabel}
          </button>
          <p className="wizard-preview__fieldnote">{TEAM_ADMIN_CAMPAIGN_CREATE.reconcileHelp}</p>
        </div>

        {submitResult ? (
          <div className="wizard-preview__step">
            <p className="wizard-preview__header">
              {submitResult.rawBroadcastCount === 1
                ? TEAM_ADMIN_CAMPAIGN_CREATE.postInvocationTitle
                : TEAM_ADMIN_CAMPAIGN_CREATE.preBroadcastTitle}
            </p>
            <div className="wizard-preview__stephead">
              <StatusPill
                label={submitResult.code}
                tone={
                  submitResult.code === 'SUBMITTED_MATCHING_COMPLETE_STATE'
                    ? 'positive'
                    : submitResult.rawBroadcastCount === 1
                      ? 'caution'
                      : 'neutral'
                }
              />
            </div>
            <p className="wizard-preview__purpose">
              {describeRedaxTeamAdminSubmitCode(submitResult.code)}
            </p>
            {submitResult.campaign ? (
              <MetricRow
                label={TEAM_ADMIN_CAMPAIGN_CREATE.resultCampaignLabel}
                value={shortenAddress(submitResult.campaign)}
                hint="a public devnet address — not a readiness or product claim"
              />
            ) : null}
            {submitResult.outputMint ? (
              <MetricRow
                label={TEAM_ADMIN_CAMPAIGN_CREATE.resultOutputMintLabel}
                value={shortenAddress(submitResult.outputMint)}
                hint="the campaign's output mint; no metadata was applied to it"
              />
            ) : null}
            {submitResult.planFingerprint ? (
              <MetricRow
                label={TEAM_ADMIN_CAMPAIGN_CREATE.resultFingerprintLabel}
                value={shortenAddress(submitResult.planFingerprint)}
                hint="the fingerprint of the submitted plan"
              />
            ) : null}
            {/*
              LOCAL NAVIGATION, AND ONLY ON THE ONE SAFE TERMINAL.
              All five conditions are required and none is redundant: `ok`, the exact
              matching-complete code, a non-null campaign address, and a caller that
              actually supplied the callback. A non-null campaign on a pending, unresolved,
              failed or unverified terminal is NOT enough — those results can carry an
              address without having established that a campaign is there to open, and
              offering navigation on one would present an unproven outcome as a finished
              one. The handler below calls the callback and nothing else.
            */}
            {openableCampaignAddress !== null && onOpenUnlistedCampaignWorkspace !== undefined ? (
              <div className="wizard-preview__policy">
                <button
                  className="wallet-badge__btn"
                  onClick={() => {
                    onOpenUnlistedCampaignWorkspace(openableCampaignAddress)
                  }}
                  type="button"
                >
                  {TEAM_ADMIN_OPEN_UNLISTED_WORKSPACE.label}
                </button>
                <p className="wizard-preview__fieldnote">
                  {TEAM_ADMIN_OPEN_UNLISTED_WORKSPACE.help}
                </p>
              </div>
            ) : null}
          </div>
        ) : null}

        {reconcileResult ? (
          <div className="wizard-preview__step">
            <p className="wizard-preview__header">{TEAM_ADMIN_CAMPAIGN_CREATE.reconcileLabel}</p>
            <div className="wizard-preview__stephead">
              <StatusPill label={reconcileResult.code} tone="neutral" />
            </div>
            <p className="wizard-preview__purpose">
              {describeRedaxTeamAdminReconcileCode(reconcileResult.code)}
            </p>
          </div>
        ) : null}

        <div className="wizard-preview__claims">
          <p className="wizard-preview__header">{TEAM_ADMIN_CAMPAIGN_CREATE.nonClaimsTitle}</p>
          <ul>
            {TEAM_ADMIN_CAMPAIGN_CREATE.nonClaims.map((claim) => (
              <li key={claim}>{claim}</li>
            ))}
          </ul>
        </div>
      </div>
    </SurfaceCard>
  )
}
