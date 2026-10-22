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
//
// DEMO CUSTOMER FLOW (2026-10-22). Four presentation rules above are superseded on the
// points named here and on no other:
//
//   * HUMAN UNITS. The campaign output limit is typed in output tokens with an explicit
//     "No limit" choice, and the end is a date-time with a visible time zone and an explicit
//     "No end date" choice. Both are converted EXACTLY (BigInt over typed digits) to the same
//     raw strings `submitS1` always took; nothing about the plan, the fingerprint or the
//     instruction changed. A REVIEW freezes the converted values and an acknowledgement is
//     required; any draft or identity change invalidates both, and an end time that passes
//     during review is refused at click time before the wallet is asked.
//   * FULL PUBLIC ADDRESSES. The created Campaign, its output mint and the resolved
//     transaction signature are shown in full, copyable, with devnet explorer links and a
//     holder link. They are public chain facts; wallets elsewhere may stay short.
//   * LATE SUCCESS CONTINUES. `Check submission status` can now resolve a submission that
//     finalized after the first observation (v2 records), and its result offers the same
//     local navigation to the same Campaign — including after a reload, from the durable
//     record. The navigation condition is still a proven matching-complete terminal and
//     nothing weaker: `submitResult` exactly as before, or the action root's own
//     `openableCampaign`, which the root sets only for that terminal.
//   * ANOTHER CAMPAIGN. Once the saved attempt is resolved, `Start another campaign` clears
//     this panel's local state so the next campaign can be prepared. It is local only; the
//     action root still refuses a new attempt while any saved attempt is unresolved.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import { MetricRow } from '../components/MetricRow'
import { RedaxPublicAddress } from '../components/RedaxPublicAddress'
import { StatusPill } from '../components/StatusPill'
import { SurfaceCard } from '../components/SurfaceCard'
import {
  TEAM_ADMIN_CAMPAIGN_CREATE,
  TEAM_ADMIN_CREATE_TERMS,
  TEAM_ADMIN_OPEN_UNLISTED_WORKSPACE,
  TEAM_ADMIN_SOL_PREFLIGHT_INSUFFICIENT,
  TEAM_ADMIN_SOL_PREFLIGHT_READING,
  TEAM_ADMIN_SOL_PREFLIGHT_RECHECK_LABEL,
  TEAM_ADMIN_SOL_PREFLIGHT_SUBMIT_REFUSED,
  TEAM_ADMIN_SOL_PREFLIGHT_UNAVAILABLE,
} from '../lib/productCopy'
import {
  REDAX_HUMAN_U128_MAX,
  describeRedaxHumanAmountRefusal,
  describeRedaxHumanDateTimeRefusal,
  formatRedaxRawAmount,
  formatRedaxUnixSecondsDevice,
  formatRedaxUnixSecondsUtc,
  groupRedaxRawDigits,
  parseRedaxHumanDateTime,
  parseRedaxHumanTokenAmount,
  redaxDeviceTimeZoneName,
  redaxDeviceUtcOffsetLabel,
} from '../lib/redaxHumanUnits'
import type { RedaxDateTimeZoneChoice } from '../lib/redaxHumanUnits'
import { redaxAvailableMetadataPresets } from '../lib/redaxMetadataPresets'
import type { RedaxPlannedMetadata } from '../lib/redaxMetadataPresets'
import { buildRedaxCampaignShareUrl, readRedaxAppBaseUrl } from '../lib/redaxPublicLinks'
import { validateTeamAdminWizardField } from '../lib/teamAdminWizardDraft'
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

/**
 * The planning inputs, in HUMAN units, held in this component's memory and nowhere else.
 *
 * `capMode` and `endMode` start `null` on purpose: "no limit" and "no end date" are
 * explicit choices, never what an empty field silently means.
 */
interface CampaignCreateDraft {
  readonly capMode: 'LIMIT' | 'NONE' | null
  /** Output tokens, as typed. Only read when `capMode === 'LIMIT'`. */
  readonly capAmount: string
  readonly endMode: 'AT' | 'NONE' | null
  /** A `datetime-local` value. Only read when `endMode === 'AT'`. */
  readonly endLocal: string
  readonly endZone: RedaxDateTimeZoneChoice
  readonly metadataName: string
  readonly metadataSymbol: string
  readonly metadataUri: string
}

const EMPTY_DRAFT: CampaignCreateDraft = {
  capMode: null,
  capAmount: '',
  endMode: null,
  endLocal: '',
  endZone: 'DEVICE',
  metadataName: '',
  metadataSymbol: '',
  metadataUri: '',
}

/** The Phase 1 output mint decimals every campaign output token carries. */
const CREATE_OUTPUT_DECIMALS = 9

/** The exact submit request a review froze, and what it was frozen against. */
interface CampaignCreateReview {
  readonly draftKey: string
  readonly identityScope: string
  readonly endTs: string
  readonly maxOutputSupply: string
  readonly capRaw: bigint | null
  readonly endUnix: bigint | null
  readonly metadataName: string
  readonly metadataSymbol: string
  readonly metadataUri: string
}

/** Planned metadata carried to the workspace as a prefill. Never a chain record. */
export type RedaxTeamAdminPlannedMetadata = RedaxPlannedMetadata

/**
 * The planned metadata ONE create submission actually sent, bound to the campaign and output
 * mint that same submission returned. It is the only form in which a plan leaves this panel:
 * a recovered campaign is offered a plan only when its own address and output mint are the
 * ones bound here. Memory only — a reload leaves none, and the workspace then opens with none.
 */
export interface RedaxTeamAdminSubmittedCreatePlan {
  readonly campaign: string
  readonly outputMint: string
  readonly metadata: RedaxTeamAdminPlannedMetadata
}

/** One stable text key for a draft, so any edit invalidates a frozen review. */
function campaignCreateDraftKey(draft: CampaignCreateDraft): string {
  return JSON.stringify([
    draft.capMode,
    draft.capAmount,
    draft.endMode,
    draft.endLocal,
    draft.endZone,
    draft.metadataName,
    draft.metadataSymbol,
    draft.metadataUri,
  ])
}

/** The converted terms, or the first human-readable reason they cannot be converted. */
export type RedaxCampaignCreateTermsConversion =
  | {
      readonly ok: true
      readonly endTs: string
      readonly maxOutputSupply: string
      readonly capRaw: bigint | null
      readonly endUnix: bigint | null
    }
  | { readonly ok: false; readonly capIssue: string | null; readonly endIssue: string | null }

/**
 * Convert the human cap and end into the EXACT raw strings an S1 plan carries.
 *
 * Exported so the conversion the panel previews and the conversion it submits can be
 * proven to be one function: there is no second converter anywhere.
 */
export function convertRedaxCampaignCreateTerms(
  draft: Pick<CampaignCreateDraft, 'capMode' | 'capAmount' | 'endMode' | 'endLocal' | 'endZone'>,
  nowMs: number,
): RedaxCampaignCreateTermsConversion {
  let capIssue: string | null = null
  let capRaw: bigint | null = null
  let maxOutputSupply = ''
  if (draft.capMode === null) {
    capIssue = TEAM_ADMIN_CREATE_TERMS.capChooseNote
  } else if (draft.capMode === 'NONE') {
    // The program's own encoding of "no campaign-wide limit".
    maxOutputSupply = '0'
  } else {
    const parsed = parseRedaxHumanTokenAmount(
      draft.capAmount,
      CREATE_OUTPUT_DECIMALS,
      REDAX_HUMAN_U128_MAX,
    )
    if (parsed.ok) {
      capRaw = parsed.raw
      maxOutputSupply = parsed.raw.toString()
    } else {
      capIssue = describeRedaxHumanAmountRefusal(parsed.refusal, CREATE_OUTPUT_DECIMALS)
    }
  }
  let endIssue: string | null = null
  let endUnix: bigint | null = null
  let endTs = ''
  if (draft.endMode === null) {
    endIssue = TEAM_ADMIN_CREATE_TERMS.endChooseNote
  } else if (draft.endMode === 'AT') {
    const parsed = parseRedaxHumanDateTime(draft.endLocal, draft.endZone, nowMs)
    if (parsed.ok) {
      endUnix = parsed.unixSeconds
      endTs = parsed.unixSeconds.toString()
    } else {
      endIssue = describeRedaxHumanDateTimeRefusal(parsed.refusal)
    }
  }
  if (capIssue !== null || endIssue !== null) {
    return { ok: false, capIssue, endIssue }
  }
  return { ok: true, endTs, maxOutputSupply, capRaw, endUnix }
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
   *
   * The second argument is the plan the submission that created THIS campaign sent, bound
   * to its campaign and output mint, or null when this panel holds no such submission (a
   * reload, or an attempt recovered from the saved record) — a PREFILL for the separate
   * metadata step, never a chain fact.
   */
  readonly onOpenUnlistedCampaignWorkspace?: (
    campaignId: string,
    submittedPlan: RedaxTeamAdminSubmittedCreatePlan | null,
  ) => void
  /** The cluster explorer links target. `null` renders no explorer link. */
  readonly explorerCluster?: string | null
  /** The deployment's approved metadata locations, for the ready-made identity choice. */
  readonly metadataUriAllowlist?: readonly string[]
}

/**
 * Shortened display form (4…4), for WALLET addresses only. The created Campaign, its output
 * mint and the resolved signature are public chain facts and are now shown in full (see the
 * 2026-10-22 note above); the earlier "the full address is never rendered" reading is
 * superseded on exactly those three values.
 */
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
      return 'The submission was sent and has not been finalized yet. This is not a failure, and nothing may be sent again — use Check submission status in a few seconds.'
    case 'SUBMITTED_OUTCOME_UNREADABLE':
      return 'The submission was sent, but the network could not be read just now. Nothing is concluded and nothing is sent again — use Check submission status shortly.'
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
      return 'The saved submission is already resolved. There is nothing further to establish, and a new campaign can be prepared.'
    case 'NOT_INVOCATION_STARTED':
      return 'The saved attempt never reached the point of no return, so nothing was broadcast by it.'
    case 'SIGNATURE_UNKNOWN_UNRESOLVED':
      return 'The saved attempt has no transaction identity to reconcile against, so it stays unresolved.'
    case 'OUTCOME_PENDING':
      return 'The submission has not been finalized yet. This is not a failure; check again in a few seconds, and nothing is sent again meanwhile.'
    case 'OUTCOME_UNREADABLE':
      return 'The network could not be read just now. Nothing is concluded and nothing changed — check again shortly.'
    case 'MATCHING_COMPLETE_STATE_RESOLVED':
      return 'The submission finalized and the planned campaign was found complete on devnet. The saved attempt is now resolved — open the campaign below.'
    case 'LEGACY_RECORD_SUCCESS_UNPROVABLE':
      return 'The submission finalized, but this saved record was written by an earlier app version that did not store the expectations needed to prove the result here. It stays open; contact REDAX support. Nothing was sent.'
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

/**
 * A short business-language label for a submit result. The exact code stays available.
 * Whether anything was sent is read from the root's own `rawBroadcastCount`, never guessed
 * from the code name.
 */
export function redaxTeamAdminS1SubmitLabel(
  code: RedaxTeamAdminS1SubmitCode,
  rawBroadcastCount: 0 | 1,
): string {
  switch (code) {
    case 'SUBMITTED_MATCHING_COMPLETE_STATE':
      return 'Campaign created'
    case 'SUBMITTED_TERMINAL_FAILURE':
      return 'Failed on the network — nothing created'
    case 'SUBMITTED_OUTCOME_PENDING':
      return 'Sent — waiting for finality'
    case 'SUBMITTED_OUTCOME_UNREADABLE':
      return 'Sent — result not readable yet'
    case 'WALLET_SIGN_ONLY_REFUSED':
      return 'Not sent — approval declined'
    case 'PAYER_SOL_INSUFFICIENT':
      return 'Not sent — not enough devnet SOL'
    case 'ATTEMPT_BLOCKED':
      return 'Not sent — a saved attempt needs checking'
    default:
      return rawBroadcastCount === 1 ? 'Sent — needs a status check' : 'Not sent'
  }
}

/** A short business-language label for a status-check result. */
export function redaxTeamAdminS1ReconcileLabel(code: RedaxTeamAdminS1ReconcileCode): string {
  switch (code) {
    case 'MATCHING_COMPLETE_STATE_RESOLVED':
      return 'Campaign created'
    case 'ALREADY_RESOLVED':
      return 'Already resolved'
    case 'NOTHING_TO_RECONCILE':
      return 'Nothing saved'
    case 'OUTCOME_PENDING':
    case 'NOT_EXPIRED':
      return 'Still pending'
    case 'OUTCOME_UNREADABLE':
      return 'Network not readable — check again'
    case 'TERMINAL_FAILURE_RESOLVED':
      return 'Failed on the network — resolved'
    case 'FINALIZED_NO_LAND_RESOLVED':
      return 'Never landed — resolved'
    default:
      return 'Needs attention'
  }
}

export function RedaxTeamAdminCampaignCreatePanel({
  approvedTeamWallet,
  onOpenUnlistedCampaignWorkspace,
  explorerCluster = null,
  metadataUriAllowlist = [],
}: RedaxTeamAdminCampaignCreatePanelProps) {
  const wallet = useRedaxWallet()
  const actions = useRedaxTeamAdminActions()

  const [draft, setDraft] = useState<CampaignCreateDraft>(EMPTY_DRAFT)
  // The frozen review, and the human acknowledgement that belongs to it. Both are memory
  // only, and both are invalidated by any draft or identity change (checked every render).
  const [review, setReview] = useState<CampaignCreateReview | null>(null)
  const [acknowledged, setAcknowledged] = useState<boolean>(false)
  const [reviewNote, setReviewNote] = useState<string | null>(null)
  const [operation, setOperation] = useState<CampaignCreateOperation | null>(null)
  const [submitResult, setSubmitResult] = useState<RedaxTeamAdminS1SubmitResult | null>(null)
  const [reconcileResult, setReconcileResult] =
    useState<RedaxTeamAdminS1ReconcileResult | null>(null)
  // The plan the last submission that crossed the point of no return SENT, bound to the
  // campaign and output mint that submission returned. Written only by `handleCreate`, from
  // its own frozen request and its own result — never from a later review, draft or preset.
  const [submittedPlan, setSubmittedPlan] = useState<RedaxTeamAdminSubmittedCreatePlan | null>(
    null,
  )

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

  // THE DEVICE CLOCK, read at render, used ONLY to say whether a chosen end is in the
  // future. It is re-read on every render (each keystroke and each click), so the preview is
  // never frozen at the first paint; the program's own Clock is what enforces the deadline.
  const renderNowMs = Date.now()
  const terms = convertRedaxCampaignCreateTerms(draft, renderNowMs)
  const draftKey = campaignCreateDraftKey(draft)

  const metadataValidations = useMemo((): {
    readonly metadataName: TeamAdminWizardFieldValidation | null
    readonly metadataSymbol: TeamAdminWizardFieldValidation | null
    readonly metadataUri: TeamAdminWizardFieldValidation | null
  } => {
    // The repository's own field policy, reused rather than restated.
    return {
      metadataName: validateTeamAdminWizardField('metadataName', draft.metadataName),
      metadataSymbol: validateTeamAdminWizardField('metadataSymbol', draft.metadataSymbol),
      metadataUri: validateTeamAdminWizardField('metadataUri', draft.metadataUri),
    }
  }, [draft.metadataName, draft.metadataSymbol, draft.metadataUri])

  // The converted raw values are ALSO judged by the repository's raw field policy, so the
  // human layer can never hand the plan a value the raw policy would have refused.
  const rawTermValidations: readonly (TeamAdminWizardFieldValidation | null)[] = terms.ok
    ? [
        validateTeamAdminWizardField('maxOutputSupply', terms.maxOutputSupply),
        validateTeamAdminWizardField('endTs', terms.endTs),
      ]
    : []

  const hasBlockingWarning =
    !terms.ok ||
    rawTermValidations.some((validation) => validation?.tone === 'warning') ||
    Object.values(metadataValidations).some((validation) => validation?.tone === 'warning')

  const availablePresets = redaxAvailableMetadataPresets(metadataUriAllowlist)

  const uxStatus = deriveRedaxTeamAdminCarrierUxStatus(
    approvedTeamWallet,
    wallet.publicKeyBase58,
  )
  const busy = operation !== null
  // Something may already have reached devnet. This panel then stops offering Campaign
  // Create entirely — a second create would not be a retry, it would be a second campaign.
  const postBroadcast = submitResult?.rawBroadcastCount === 1
  const custodyOpen = actions.attempt.custodyPresent
  // The review is CURRENT only for the exact draft and the exact identity it was taken for.
  const reviewCurrent =
    review !== null && review.draftKey === draftKey && review.identityScope === solPreflightScope
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
      : // THE LATE-SUCCESS PATH. The action root sets `openableCampaign` ONLY for the
        // matching-complete terminal — reached now by this check, or already durable from an
        // earlier one (a reload included) — so this inherits exactly the same condition.
        reconcileResult !== null && reconcileResult.ok && reconcileResult.openableCampaign !== null
        ? reconcileResult.openableCampaign
        : null
  // The plan carried to the workspace, as a prefill only: the one a submission from this
  // panel SENT, and only for the campaign that submission returned — and, when the saved
  // record is what proved the campaign, only if that record names the same output mint. The
  // review on screen is never consulted: it may belong to a campaign nobody has sent, so a
  // campaign recovered from the saved record after a reload is carried no plan at all.
  const submittedPlanForWorkspace: RedaxTeamAdminSubmittedCreatePlan | null =
    submittedPlan !== null &&
    openableCampaignAddress !== null &&
    submittedPlan.campaign === openableCampaignAddress &&
    (reconcileResult === null ||
      reconcileResult.openableCampaign !== openableCampaignAddress ||
      reconcileResult.outputMint === submittedPlan.outputMint)
      ? submittedPlan
      : null
  // The output mint and signature that belong to that SAME proven terminal, for display.
  const openableOutputMint: string | null =
    openableCampaignAddress === null
      ? null
      : submitResult !== null && submitResult.campaign === openableCampaignAddress
        ? submitResult.outputMint
        : reconcileResult?.outputMint ?? null
  const openableSignature: string | null =
    openableCampaignAddress === null
      ? null
      : submitResult !== null &&
          submitResult.ok &&
          submitResult.campaign === openableCampaignAddress
        ? submitResult.resolvedSignature
        : reconcileResult?.resolvedSignature ?? null
  const appBaseUrl = readRedaxAppBaseUrl()
  const holderLink =
    openableCampaignAddress !== null && appBaseUrl !== null
      ? buildRedaxCampaignShareUrl(appBaseUrl, openableCampaignAddress)
      : null
  // A RESOLVED saved attempt is the only state from which another campaign may be prepared
  // here. Local state only — the action root refuses a new attempt on its own regardless.
  const savedAttemptResolved =
    (submitResult !== null &&
      (submitResult.code === 'SUBMITTED_MATCHING_COMPLETE_STATE' ||
        submitResult.code === 'SUBMITTED_TERMINAL_FAILURE')) ||
    (reconcileResult !== null &&
      (reconcileResult.code === 'MATCHING_COMPLETE_STATE_RESOLVED' ||
        reconcileResult.code === 'TERMINAL_FAILURE_RESOLVED' ||
        reconcileResult.code === 'FINALIZED_NO_LAND_RESOLVED' ||
        reconcileResult.code === 'ALREADY_RESOLVED' ||
        reconcileResult.code === 'NOTHING_TO_RECONCILE'))

  const canSubmit =
    approvedTeamWallet !== null &&
    uxStatus === 'CONNECTED_MATCH' &&
    wallet.status === 'connected' &&
    !hasBlockingWarning &&
    !busy &&
    !custodyOpen &&
    !postBroadcast &&
    // A frozen, current review and its acknowledgement — the person saw the exact permanent
    // terms that will be sent, and nothing has changed since.
    reviewCurrent &&
    acknowledged &&
    // The action is not EXPOSED unless the payer balance is KNOWN to be enough. A reading,
    // an idle projection, an INSUFFICIENT result and a READ_UNAVAILABLE result each
    // withhold it; every existing validation, busy, custody and post-broadcast condition
    // above is unchanged and still applies.
    solPreflightSufficient

  // Reconciliation deliberately does NOT require a connected wallet: the case it exists
  // for is a refresh or a disconnect after a submission, which is exactly when the
  // operator has the least and needs it most. It cannot sign, prompt or send.
  const canReconcile = approvedTeamWallet !== null && !busy

  const updateDraft = useCallback((patch: Partial<CampaignCreateDraft>): void => {
    setDraft((current) => ({ ...current, ...patch }))
    setReviewNote(null)
  }, [])

  /**
   * THE REVIEW. Converts once, freezes the exact request, and asks for an acknowledgement.
   * It signs nothing, sends nothing, opens no wallet and reads no network.
   */
  const handleReview = useCallback((): void => {
    const converted = convertRedaxCampaignCreateTerms(draft, Date.now())
    if (!converted.ok || hasBlockingWarning) {
      setReview(null)
      setAcknowledged(false)
      setReviewNote(TEAM_ADMIN_CREATE_TERMS.reviewBlockedNote)
      return
    }
    setReview({
      draftKey: campaignCreateDraftKey(draft),
      identityScope: solPreflightScope,
      endTs: converted.endTs,
      maxOutputSupply: converted.maxOutputSupply,
      capRaw: converted.capRaw,
      endUnix: converted.endUnix,
      metadataName: draft.metadataName,
      metadataSymbol: draft.metadataSymbol,
      metadataUri: draft.metadataUri,
    })
    setAcknowledged(false)
    setReviewNote(null)
  }, [draft, hasBlockingWarning, solPreflightScope])

  /**
   * Local only: clears this panel so the next campaign can be prepared. The submitted plan is
   * kept: it is bound to its own campaign, so it can only ever be offered for that campaign.
   */
  const handleStartAnother = useCallback((): void => {
    if (inFlightRef.current !== null) {
      return
    }
    setDraft(EMPTY_DRAFT)
    setReview(null)
    setAcknowledged(false)
    setReviewNote(null)
    setSubmitResult(null)
    setReconcileResult(null)
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
    // THE FROZEN REVIEW IS WHAT IS SENT, re-checked here against the current draft and
    // identity, and — because a review can sit open — against the clock: an end time that
    // has passed while the person read the review is refused before the wallet is asked.
    const frozen = review
    if (frozen === null || frozen.draftKey !== draftKey || frozen.identityScope !== solPreflightScope) {
      return
    }
    if (frozen.endUnix !== null && BigInt(Math.floor(Date.now() / 1000)) >= frozen.endUnix) {
      setReview(null)
      setAcknowledged(false)
      setReviewNote(TEAM_ADMIN_CREATE_TERMS.endPassedDuringReviewNote)
      return
    }
    inFlightRef.current = 'submit'
    setOperation('submit')
    setReconcileResult(null)
    try {
      const result = await actions.submitS1({
        endTs: frozen.endTs,
        maxOutputSupply: frozen.maxOutputSupply,
        metadataName: frozen.metadataName,
        metadataSymbol: frozen.metadataSymbol,
        metadataUri: frozen.metadataUri,
        lifecycleIntent: 'remain_initialized',
        tokenConfigs: [],
      })
      setSubmitResult(result)
      // Bound only when THIS call crossed the point of no return and named its own campaign
      // and output mint. The metadata is the frozen request it sent, not whatever is on screen.
      if (result.rawBroadcastCount === 1 && result.campaign !== null && result.outputMint !== null) {
        setSubmittedPlan({
          campaign: result.campaign,
          outputMint: result.outputMint,
          metadata: {
            name: frozen.metadataName,
            symbol: frozen.metadataSymbol,
            uri: frozen.metadataUri,
          },
        })
      }
    } finally {
      inFlightRef.current = null
      setOperation(null)
    }
  }, [actions, canSubmit, draftKey, review, solPreflightScope, solPreflightSufficient])

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
          <p className="wizard-preview__purpose">{TEAM_ADMIN_CREATE_TERMS.permanenceNote}</p>
          <div className="wizard-preview__fields">
            <fieldset className="wizard-preview__field human-terms" disabled={busy || postBroadcast}>
              <legend className="wizard-preview__fieldname">{TEAM_ADMIN_CREATE_TERMS.capLegend}</legend>
              <div className="wizard-preview__fieldbody">
                <label className="human-terms__choice">
                  <input
                    checked={draft.capMode === 'LIMIT'}
                    name="redax-team-create-cap-mode"
                    onChange={() => updateDraft({ capMode: 'LIMIT' })}
                    type="radio"
                  />
                  {TEAM_ADMIN_CREATE_TERMS.capLimitChoice}
                </label>
                <label className="human-terms__choice">
                  <input
                    checked={draft.capMode === 'NONE'}
                    name="redax-team-create-cap-mode"
                    onChange={() => updateDraft({ capMode: 'NONE' })}
                    type="radio"
                  />
                  {TEAM_ADMIN_CREATE_TERMS.capNoneChoice}
                </label>
                {draft.capMode === 'LIMIT' ? (
                  <>
                    <label className="wizard-preview__fieldname" htmlFor="redax-team-create-cap-amount">
                      {TEAM_ADMIN_CREATE_TERMS.capAmountLabel}
                    </label>
                    <input
                      className="wizard-preview__input"
                      id="redax-team-create-cap-amount"
                      inputMode="decimal"
                      onChange={(event) => {
                        updateDraft({ capAmount: (event.target as unknown as { readonly value: string }).value })
                      }}
                      placeholder="30"
                      type="text"
                      value={draft.capAmount}
                    />
                  </>
                ) : null}
                <p className="wizard-preview__fieldnote">{TEAM_ADMIN_CREATE_TERMS.capNote}</p>
                {terms.ok ? (
                  <p className="wizard-preview__fieldhint">
                    {terms.capRaw === null
                      ? TEAM_ADMIN_CREATE_TERMS.capNoneSummary
                      : `= ${formatRedaxRawAmount(terms.capRaw, CREATE_OUTPUT_DECIMALS)} new tokens · ${groupRedaxRawDigits(terms.capRaw)} base units (${CREATE_OUTPUT_DECIMALS} decimals)`}
                  </p>
                ) : terms.capIssue !== null ? (
                  <p className="wizard-preview__fieldwarning">{terms.capIssue}</p>
                ) : null}
              </div>
            </fieldset>

            <fieldset className="wizard-preview__field human-terms" disabled={busy || postBroadcast}>
              <legend className="wizard-preview__fieldname">{TEAM_ADMIN_CREATE_TERMS.endLegend}</legend>
              <div className="wizard-preview__fieldbody">
                <label className="human-terms__choice">
                  <input
                    checked={draft.endMode === 'NONE'}
                    name="redax-team-create-end-mode"
                    onChange={() => updateDraft({ endMode: 'NONE' })}
                    type="radio"
                  />
                  {TEAM_ADMIN_CREATE_TERMS.endNoneChoice}
                </label>
                <label className="human-terms__choice">
                  <input
                    checked={draft.endMode === 'AT'}
                    name="redax-team-create-end-mode"
                    onChange={() => updateDraft({ endMode: 'AT' })}
                    type="radio"
                  />
                  {TEAM_ADMIN_CREATE_TERMS.endAtChoice}
                </label>
                {draft.endMode === 'AT' ? (
                  <>
                    <label className="wizard-preview__fieldname" htmlFor="redax-team-create-end-local">
                      {TEAM_ADMIN_CREATE_TERMS.endDateTimeLabel}
                    </label>
                    <input
                      className="wizard-preview__input"
                      id="redax-team-create-end-local"
                      onChange={(event) => {
                        updateDraft({ endLocal: (event.target as unknown as { readonly value: string }).value })
                      }}
                      step={60}
                      type="datetime-local"
                      value={draft.endLocal}
                    />
                    <p className="wizard-preview__fieldname">{TEAM_ADMIN_CREATE_TERMS.endZoneLabel}</p>
                    {/*
                      Two plain choices rather than a drop-down: a closed drop-down truncates the
                      device zone on a narrow screen, and the chosen zone must stay readable.
                    */}
                    <label className="human-terms__choice">
                      <input
                        checked={draft.endZone === 'DEVICE'}
                        name="redax-team-create-end-zone"
                        onChange={() => updateDraft({ endZone: 'DEVICE' })}
                        type="radio"
                      />
                      {`This device — ${redaxDeviceTimeZoneName()} (${redaxDeviceUtcOffsetLabel(renderNowMs)})`}
                    </label>
                    <label className="human-terms__choice">
                      <input
                        checked={draft.endZone === 'UTC'}
                        name="redax-team-create-end-zone"
                        onChange={() => updateDraft({ endZone: 'UTC' })}
                        type="radio"
                      />
                      UTC
                    </label>
                  </>
                ) : null}
                <p className="wizard-preview__fieldnote">{TEAM_ADMIN_CREATE_TERMS.endNote}</p>
                {terms.ok ? (
                  <p className="wizard-preview__fieldhint">
                    {terms.endUnix === null
                      ? TEAM_ADMIN_CREATE_TERMS.endNoneSummary
                      : `= ${formatRedaxUnixSecondsDevice(terms.endUnix)} · ${formatRedaxUnixSecondsUtc(terms.endUnix)} · Unix ${terms.endUnix.toString()} s`}
                  </p>
                ) : terms.endIssue !== null ? (
                  <p className="wizard-preview__fieldwarning">{terms.endIssue}</p>
                ) : null}
              </div>
            </fieldset>

            <fieldset className="wizard-preview__field human-terms" disabled={busy || postBroadcast}>
              <legend className="wizard-preview__fieldname">{TEAM_ADMIN_CREATE_TERMS.metadataLegend}</legend>
              <div className="wizard-preview__fieldbody">
                {availablePresets.length > 0 ? (
                  <div className="human-terms__presets">
                    <p className="wizard-preview__fieldnote">{TEAM_ADMIN_CREATE_TERMS.presetNote}</p>
                    {availablePresets.map((preset) => (
                      <button
                        className="wallet-badge__btn"
                        key={preset.key}
                        onClick={() => {
                          updateDraft({
                            metadataName: preset.name,
                            metadataSymbol: preset.symbol,
                            metadataUri: preset.uri,
                          })
                        }}
                        type="button"
                      >
                        {`Use ${preset.label} (${preset.symbol})`}
                      </button>
                    ))}
                  </div>
                ) : null}
                {(['metadataName', 'metadataSymbol', 'metadataUri'] as const).map((id) => {
                  const fieldCopy = TEAM_ADMIN_CAMPAIGN_CREATE.fields.find((field) => field.id === id)
                  const validation = metadataValidations[id]
                  const inputId = `redax-team-create-${id}`
                  return (
                    <div className="human-terms__row" key={id}>
                      <label className="wizard-preview__fieldname" htmlFor={inputId}>
                        {fieldCopy?.label ?? id}
                      </label>
                      <input
                        className="wizard-preview__input"
                        id={inputId}
                        onChange={(event) => {
                          updateDraft({ [id]: (event.target as unknown as { readonly value: string }).value })
                        }}
                        spellCheck={false}
                        type="text"
                        value={draft[id]}
                      />
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
                  )
                })}
              </div>
            </fieldset>
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

        {!postBroadcast ? (
          <div className="wizard-preview__step">
            <p className="wizard-preview__header">{TEAM_ADMIN_CREATE_TERMS.reviewTitle}</p>
            <button
              className="wallet-badge__btn"
              disabled={busy || hasBlockingWarning}
              onClick={handleReview}
              type="button"
            >
              {TEAM_ADMIN_CREATE_TERMS.reviewLabel}
            </button>
            {reviewNote !== null ? <p className="wizard-preview__fieldwarning">{reviewNote}</p> : null}
            {review !== null && !reviewCurrent ? (
              <p className="wizard-preview__fieldwarning">{TEAM_ADMIN_CREATE_TERMS.reviewStaleNote}</p>
            ) : null}
            {review !== null && reviewCurrent ? (
              <div className="human-terms__review">
                <MetricRow label="Network" value="Solana devnet" />
                <MetricRow
                  label={TEAM_ADMIN_CREATE_TERMS.reviewCapLabel}
                  value={
                    review.capRaw === null
                      ? 'No limit'
                      : `${formatRedaxRawAmount(review.capRaw, CREATE_OUTPUT_DECIMALS)} new tokens`
                  }
                  hint={`plan value max_output_supply = ${review.maxOutputSupply}`}
                />
                <MetricRow
                  label={TEAM_ADMIN_CREATE_TERMS.reviewEndLabel}
                  value={
                    review.endUnix === null
                      ? 'No end date'
                      : `${formatRedaxUnixSecondsDevice(review.endUnix)} · ${formatRedaxUnixSecondsUtc(review.endUnix)}`
                  }
                  hint={review.endUnix === null ? 'plan value end_ts = none' : `plan value end_ts = ${review.endTs}`}
                />
                <MetricRow
                  label={TEAM_ADMIN_CREATE_TERMS.reviewPlannedLabel}
                  value={`${review.metadataName} (${review.metadataSymbol})`}
                  hint="planned only — the metadata step is separate and has its own review"
                />
                <label className="human-terms__ack">
                  <input
                    checked={acknowledged}
                    onChange={(event) => {
                      setAcknowledged((event.target as unknown as { readonly checked: boolean }).checked)
                    }}
                    type="checkbox"
                  />
                  {TEAM_ADMIN_CREATE_TERMS.acknowledgeLabel}
                </label>
              </div>
            ) : null}
          </div>
        ) : null}

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
                label={redaxTeamAdminS1SubmitLabel(submitResult.code, submitResult.rawBroadcastCount)}
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
            {submitResult.campaign && openableCampaignAddress !== submitResult.campaign ? (
              <MetricRow
                label="Planned campaign address"
                value={submitResult.campaign}
                hint="the address this submission planned — not proof that it exists yet"
              />
            ) : null}
            <details className="technical-details">
              <summary>Technical details</summary>
              <MetricRow label="Result code" value={submitResult.code} />
              {submitResult.planFingerprint ? (
                <MetricRow
                  label={TEAM_ADMIN_CAMPAIGN_CREATE.resultFingerprintLabel}
                  value={shortenAddress(submitResult.planFingerprint)}
                  hint="the fingerprint of the submitted plan"
                />
              ) : null}
            </details>
          </div>
        ) : null}

        {reconcileResult ? (
          <div className="wizard-preview__step">
            <p className="wizard-preview__header">{TEAM_ADMIN_CAMPAIGN_CREATE.reconcileLabel}</p>
            <div className="wizard-preview__stephead">
              <StatusPill
                label={redaxTeamAdminS1ReconcileLabel(reconcileResult.code)}
                tone={reconcileResult.openableCampaign !== null ? 'positive' : 'neutral'}
              />
            </div>
            <p className="wizard-preview__purpose">
              {describeRedaxTeamAdminReconcileCode(reconcileResult.code)}
            </p>
            {reconcileResult.campaign !== null && reconcileResult.openableCampaign === null ? (
              <MetricRow
                label="Saved attempt's planned campaign"
                value={reconcileResult.campaign}
                hint="from the saved record — not proof that it exists"
              />
            ) : null}
            <details className="technical-details">
              <summary>Technical details</summary>
              <MetricRow label="Result code" value={reconcileResult.code} />
            </details>
          </div>
        ) : null}

        {/*
          THE PROVEN CAMPAIGN — full public identities, copy, explorer and holder link — and
          LOCAL NAVIGATION, ONLY ON THE ONE SAFE TERMINAL. `openableCampaignAddress` is non-null
          only for a submit that reported `ok` + matching-complete, or for the action root's own
          `openableCampaign`, which it sets only for that terminal. The handler calls the
          callback and nothing else.
        */}
        {openableCampaignAddress !== null ? (
          <div className="wizard-preview__step created-campaign">
            <p className="wizard-preview__header">{TEAM_ADMIN_CREATE_TERMS.createdTitle}</p>
            <RedaxPublicAddress
              explorerCluster={explorerCluster}
              hint="the Campaign account — share this with holders"
              kind="address"
              label="Campaign address"
              value={openableCampaignAddress}
            />
            {openableOutputMint !== null ? (
              <RedaxPublicAddress
                explorerCluster={explorerCluster}
                hint="the new output token (9 decimals); no metadata yet"
                kind="address"
                label="Output token mint"
                value={openableOutputMint}
              />
            ) : null}
            {openableSignature !== null ? (
              <RedaxPublicAddress
                explorerCluster={explorerCluster}
                kind="tx"
                label="Create transaction"
                value={openableSignature}
              />
            ) : null}
            {holderLink !== null ? (
              <RedaxPublicAddress
                explorerCluster={null}
                hint="opens this app with the address filled in; holders still choose to open it"
                kind="link"
                label="Holder link"
                value={holderLink}
              />
            ) : null}
            {openableCampaignAddress !== null && onOpenUnlistedCampaignWorkspace !== undefined ? (
              <div className="wizard-preview__policy">
                <button
                  className="wallet-badge__btn"
                  onClick={() => {
                    onOpenUnlistedCampaignWorkspace(openableCampaignAddress, submittedPlanForWorkspace)
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

        {savedAttemptResolved && postBroadcast ? (
          <div className="wizard-preview__policy">
            <button className="wallet-badge__btn" disabled={busy} onClick={handleStartAnother} type="button">
              {TEAM_ADMIN_CREATE_TERMS.startAnotherLabel}
            </button>
            <p className="wizard-preview__fieldnote">{TEAM_ADMIN_CREATE_TERMS.startAnotherHelp}</p>
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
