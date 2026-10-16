// -----------------------------------------------------------------------------
// WHAT IT CANNOT DO
// -----------------------------------------------------------------------------
// It constructs no `Connection` and no `Transaction`, acquires no `@solana` package at
// all, holds no signer, reaches no raw adapter, opens no RPC of its own, writes no
// storage, takes no Web Lock, reads no environment and draws no entropy. It cannot
// transition a journal record, cannot begin an attempt and cannot read one raw: the only
// three things it may call are `submitMutation`, `reconcileMutation` and the read-only
// `readMutationStatus`, and the last of those hands back a sanitized projection with no
// signature, no message, no digest, no blockhash, no nonce, no namespace and no key in it.
//
// WHAT THE EFFECTS MAY REACH IS EXACTLY ONE THING: the read-only `readMutationSolPreflight`
// member, or a ref write. NONE of them reaches `submitMutation`, `reconcileMutation`,
// `readMutationStatus`, a journal operation, a wallet signature, a send or a transaction
// construction. There is still NO timer, NO interval, NO poll, NO subscription, NO event
// listener and NO automatic retry, and nothing runs on a clock. A field change reads
// nothing: the ADD threshold does not depend on draft text.
//
// ALL THREE MUTATION-CORRIDOR ACTION CALLS still run from an explicit click and from
// nowhere else — including the read-only status read, which is deliberately click-driven
// here rather than automatic. The SOL re-check is a fourth control and is READ-ONLY: it is
// not a mutation transaction action and does not change this panel's transaction-control
// count, which stays exactly TWO.
//
// -----------------------------------------------------------------------------
// A LOADED SNAPSHOT IS NOT CHAIN TRUTH
// -----------------------------------------------------------------------------
// App loads the campaign and its TokenConfigs when a selection resolves, and a post-init
// mutation changes exactly those accounts — so the props this panel renders from may
// PREDATE the very attempt they would be used to judge. They are therefore declared as
// `LOADED_DISPLAY` and are never authority for the two transitions an attempt produces:
// a row is CONFIRMED, and a replaceable terminal re-enters `PREPARED`, only from a
// `FRESH_STATUS_READ` taken by the explicit status gesture ITSELF.
//
// That gesture runs in a fixed order — reconcile, re-read the slot, then read the campaign
// and its TokenConfigs through the injected product refresh — so the account reading is
// strictly newer than the journal reading it is judged beside. The reading is bound to the
// campaign it was taken for and is discarded when the selection differs, when a new gesture
// starts, and when a submission runs. A refresh that REFUSES blocks every row and disables
// every submit rather than falling back to the snapshot it was taken to supersede.
//
// -----------------------------------------------------------------------------
// AUTHORITY, POSITIVELY ESTABLISHED
// -----------------------------------------------------------------------------
// A rendered campaign is NOT a mutation target. App hands this panel the RAW selection and
// the EFFECTIVE one separately, and admission requires that they agree, that the loaded
// campaign exists, that its own stored address agrees with the selection, and that its
// stored campaign admin equals the configured approved Team wallet. A `campaigns[0]`
// fallback therefore fails the very first comparison and can never enable anything.
//
// Every one of those checks is ENABLEMENT UX. The mutation action root re-reads the
// campaign from devnet at authority grade, freezes the admission footprint and re-asserts
// it twice more, and it would refuse an attempt this panel had been tricked into enabling.
//
// -----------------------------------------------------------------------------
// DRAFTS ARE MEMORY-ONLY, AND THAT IS THE DECISION
// -----------------------------------------------------------------------------
// `PREPARED_DRAFT_PERSISTENCE = MEMORY_ONLY`. Unsent rows live in this component's state
// and nowhere else — no `localStorage`, no `sessionStorage`, no IndexedDB, no fourth
// storage owner and no new Web Lock — so a reload discards them. That is acceptable
// precisely because NO transactional or recovery state depends on them: an attempt that
// exists survives in the durable mutation journal and is reconstructed from the sanitized
// status projection, and a TokenConfig that exists survives on chain and is read back.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import { MetricRow } from '../components/MetricRow'
import { StatusPill } from '../components/StatusPill'
import { SurfaceCard } from '../components/SurfaceCard'
import {
  TEAM_ADMIN_ADD_TOKEN_CONFIG,
  TEAM_ADMIN_SOL_PREFLIGHT_INSUFFICIENT,
  TEAM_ADMIN_SOL_PREFLIGHT_READING,
  TEAM_ADMIN_SOL_PREFLIGHT_RECHECK_LABEL,
  TEAM_ADMIN_SOL_PREFLIGHT_UNAVAILABLE,
  TEAM_ADMIN_SOL_PREFLIGHT_SUBMIT_REFUSED,
} from '../lib/productCopy'
import type { TeamAdminAddTokenConfigFieldId } from '../lib/productCopy'
import { useRedaxWallet } from '../wallet/RedaxWalletProvider'
import type { RedaxCampaignView, RedaxTokenConfigView } from '../data/redaxViewModels'
import { useRedaxTeamAdminMutationActions } from './RedaxTeamAdminMutationActions'
import type { RedaxTeamAdminMutationSolPreflightResult } from './RedaxTeamAdminMutationActions'
import type { RedaxTeamAdminMutationOperation } from './redaxTeamAdminMutationIdentity'
import type {
  RedaxTeamAdminMutationReconcileCode,
  RedaxTeamAdminMutationStatusReadCode,
  RedaxTeamAdminMutationStatusReadResult,
  RedaxTeamAdminMutationSubmitCode,
  RedaxTeamAdminMutationSubmitResult,
} from './RedaxTeamAdminMutationActions'
import {
  REDAX_TEAM_ADMIN_MAX_TOKEN_CONFIGS,
  classifyRedaxTeamAdminTokenConfigTombstone,
  deriveRedaxTeamAdminTokenConfigRowDisposition,
  projectRedaxTeamAdminTokenConfigRecoveryRow,
  emptyRedaxTeamAdminTokenConfigDraftRow,
  reduceRedaxTeamAdminTokenConfigDraftRows,
  summarizeRedaxTeamAdminTokenConfigCapacity,
  validateRedaxTeamAdminPostInitTokenConfigRow,
} from './redaxTeamAdminTokenConfigCollection'
import type {
  RedaxTeamAdminTokenConfigCampaignContext,
  RedaxTeamAdminTokenConfigChainFacts,
  RedaxTeamAdminTokenConfigChainTruthKind,
  RedaxTeamAdminTokenConfigDraftRow,
  RedaxTeamAdminTokenConfigRowDisposition,
  RedaxTeamAdminTokenConfigStatusInput,
  RedaxTeamAdminValidatedTokenConfigRow,
} from './redaxTeamAdminTokenConfigCollection'

/** The output-mint decimals Phase 1 fixes, used only when no chain reading exists yet. */
const REDAX_OUTPUT_DECIMALS_FALLBACK = 9

/** Which operation, if any, is running. Rendered state beside the ref latch. */
type SetupPanelOperation = 'submit' | 'status'

export interface RedaxTeamAdminCampaignSetupPanelProps {
  /**
   * The ONE canonical approved Team wallet, resolved once in App.
   *
   * The SAME value App passes to the mutation provider, so the panel and the action root
   * can never disagree about who is approved. `null` means the deployment configured no
   * usable carrier, and the whole surface fails closed on it.
   */
  readonly approvedTeamWallet: string | null
  /** Whether the campaign read this panel judges rows against actually resolved. */
  readonly campaignDataReady: boolean
  /** The campaign id App's loader actually resolved — the fallback may differ. */
  readonly effectiveSelectedCampaignId: string
  /**
   * The ONE canonical runtime program id, resolved once in App.
   *
   * A PUBLIC deployment fact injected at the boundary, exactly like the carrier: this
   * panel reads no environment, resolves nothing itself and takes no program input from a
   * user. `null` means the configuration is unusable, and every path fails closed on it.
   * It is used for ONE thing — deriving the exact TokenConfig account a row addresses —
   * and it opens no connection and reaches no chain.
   */
  readonly programId: string | null
  /**
   * The BOUNDED product refresh, injected by App. It is the panel's ONLY route to a
   * reading of the chain it can call authority-grade, and it is called from the explicit
   * status gesture and from nowhere else.
   *
   * The panel does not know how it reads: no `Connection`, no endpoint, no RPC vocabulary
   * and no transport error crosses this boundary. It hands back a sanitized product
   * snapshot or one bounded, value-free refusal code.
   */
  readonly readFreshCampaignSetupTruth: (
    campaignId: string,
  ) => Promise<RedaxTeamAdminFreshCampaignSetupTruthResult>
  /**
   * The LOADED campaign, or `null`. Display and initial drafting truth only.
   *
   * It is a snapshot App took when the selection resolved, so it may PREDATE any attempt
   * this panel makes. `LOADED_DISPLAY` is what the collection module is told about it, and
   * that reading can never produce a confirmation or a terminal re-entry.
   */
  readonly selectedCampaign: RedaxCampaignView | null
  /** The RAW explicit selection, never the fallback. Admission compares the two. */
  readonly selectedCampaignId: string
  /** Every accepted-input TokenConfig the selected campaign held when it was loaded. */
  readonly tokenConfigs: readonly RedaxTokenConfigView[]
}

/**
 * Why a bounded product refresh could not establish fresh chain truth. VALUE-FREE.
 *
 * A closed vocabulary with no member for a transport error, an endpoint, a status code or
 * a raw message: what the operator is told is that the reading did not happen, and the
 * surface fails closed on it. There is deliberately no member that reads as "probably
 * fine".
 */
export type RedaxTeamAdminFreshCampaignSetupTruthCode =
  | 'CAMPAIGN_READ_REFUSED'
  | 'CAMPAIGN_ABSENT'
  | 'CAMPAIGN_IDENTITY_MISMATCH'
  | 'TOKEN_CONFIG_READ_REFUSED'

/**
 * What ONE bounded product refresh produced. A closed, fail-closed result.
 *
 * RE-DECLARED rather than imported from App, exactly as the product copy re-declares the
 * key unions it describes: this module reaches no App module at all, and the JSX site in
 * App is where the two declarations are compared — a divergence stops that file compiling.
 */
export type RedaxTeamAdminFreshCampaignSetupTruthResult =
  | {
      readonly ok: true
      readonly campaign: RedaxCampaignView
      readonly tokenConfigs: readonly RedaxTokenConfigView[]
    }
  | { readonly ok: false; readonly code: RedaxTeamAdminFreshCampaignSetupTruthCode }

/**
 * The reading ONE explicit status gesture took, bound to the campaign it was taken FOR.
 *
 * The `campaignId` is not decoration: it is the race guard. A refresh started for one
 * campaign and resolving after the operator selected another is not that other campaign's
 * truth, however recently it arrived, and binding the reading to its own campaign is what
 * makes that decidable from state rather than from promise ordering.
 */
export type RedaxTeamAdminSetupFreshChainTruth =
  | {
      readonly kind: 'OK'
      readonly campaignId: string
      readonly campaign: RedaxCampaignView
      readonly tokenConfigs: readonly RedaxTokenConfigView[]
    }
  | {
      readonly kind: 'REFUSED'
      readonly campaignId: string
      readonly code: RedaxTeamAdminFreshCampaignSetupTruthCode
    }

/** Which chain reading the row machine is being handed, and what it consists of. */
export interface RedaxTeamAdminSetupChainTruthSelection {
  readonly chainTruthKind: RedaxTeamAdminTokenConfigChainTruthKind
  readonly campaign: RedaxCampaignView | null
  readonly tokenConfigs: readonly RedaxTokenConfigView[]
  readonly freshReadRefused: boolean
}

/**
 * THREE OUTCOMES, and the ordering is the argument:
 *
 *   1. no current fresh reading — the loaded snapshot, declared `LOADED_DISPLAY`. Honest
 *      for drafting and for the ordinary pre-attempt route to `PREPARED`, and structurally
 *      incapable of producing a confirmation or a terminal re-entry.
 *   2. a fresh reading that REFUSED — no chain truth at all, and deliberately NOT a silent
 *      fall back to the snapshot: the gesture asked for authority-grade truth and did not
 *      get it, so every row blocks and no control is enabled.
 *   3. a fresh reading that succeeded, FOR THIS CAMPAIGN — `FRESH_STATUS_READ`, and the
 *      only input that unlocks the two transitions an attempt can produce.
 *
 * A reading taken for a DIFFERENT campaign is discarded at (1). That is stronger than
 * discarding it when it arrives: a selection that changes after the write is handled by
 * the same line.
 */
export function selectRedaxTeamAdminSetupChainTruth(input: {
  readonly selectedCampaignId: string
  readonly freshChainTruth: RedaxTeamAdminSetupFreshChainTruth | null
  readonly loadedCampaign: RedaxCampaignView | null
  readonly loadedTokenConfigs: readonly RedaxTokenConfigView[]
}): RedaxTeamAdminSetupChainTruthSelection {
  const fresh = input.freshChainTruth
  if (fresh === null || fresh.campaignId !== input.selectedCampaignId) {
    return {
      chainTruthKind: 'LOADED_DISPLAY',
      campaign: input.loadedCampaign,
      tokenConfigs: input.loadedTokenConfigs,
      freshReadRefused: false,
    }
  }
  if (fresh.kind === 'REFUSED') {
    return {
      chainTruthKind: 'LOADED_DISPLAY',
      campaign: null,
      tokenConfigs: [],
      freshReadRefused: true,
    }
  }
  return {
    chainTruthKind: 'FRESH_STATUS_READ',
    campaign: fresh.campaign,
    tokenConfigs: fresh.tokenConfigs,
    freshReadRefused: false,
  }
}

/**
 * The three things ONE explicit status gesture may reach. Injected, never acquired.
 *
 * Declared STRUCTURALLY so the orchestration below can be exercised against fakes without
 * a provider, a React tree or a chain: the panel passes the real three in, and a test
 * passes counters in. Nothing here can sign, send, begin an attempt or write a journal
 * record — the surface is exactly reconcile, read status, read chain truth.
 */
export interface RedaxTeamAdminSetupStatusGesturePorts {
  readonly reconcileMutation: () => Promise<{
    readonly code: RedaxTeamAdminMutationReconcileCode
  }>
  readonly readMutationStatus: () => Promise<RedaxTeamAdminMutationStatusReadResult>
  readonly readFreshCampaignSetupTruth: (
    campaignId: string,
  ) => Promise<RedaxTeamAdminFreshCampaignSetupTruthResult>
}

/** Everything ONE explicit status gesture established, bound to its own campaign. */
export interface RedaxTeamAdminSetupStatusGestureOutcome {
  readonly campaignId: string
  readonly reconcileCode: RedaxTeamAdminMutationReconcileCode
  readonly status: RedaxTeamAdminMutationStatusReadResult
  readonly freshChainTruth: RedaxTeamAdminSetupFreshChainTruth
}

/**
 * ONE explicit status gesture, in its FIXED order. Reconcile, re-read, then read chain.
 *
 * The order is the point. Reconciling first is what can move the durable slot to a
 * terminal; re-reading is what makes that terminal visible; and reading the chain LAST is
 * what makes the account reading strictly newer than the journal reading it will be judged
 * beside. A chain reading taken first would be exactly the stale snapshot this repair
 * exists to refuse.
 *
 * It signs nothing, sends nothing, starts no attempt, writes no record and polls nothing:
 * it runs once, from one click.
 */
export async function runRedaxTeamAdminSetupStatusGesture(
  ports: RedaxTeamAdminSetupStatusGesturePorts,
  campaignId: string,
): Promise<RedaxTeamAdminSetupStatusGestureOutcome> {
  const reconciled = await ports.reconcileMutation()
  const status = await ports.readMutationStatus()
  const fresh = await ports.readFreshCampaignSetupTruth(campaignId)
  return {
    campaignId,
    reconcileCode: reconciled.code,
    status,
    freshChainTruth: fresh.ok
      ? { kind: 'OK', campaignId, campaign: fresh.campaign, tokenConfigs: fresh.tokenConfigs }
      : { kind: 'REFUSED', campaignId, code: fresh.code },
  }
}

/**
 * Why the explicitly selected campaign is, or is not, a mutation target.
 *
 * A closed vocabulary, and every member except the first is a REFUSAL. It is deliberately
 * not a role and not a capability: it is what an operator is told about why a control is
 * unavailable, and the guard inside the action root is what actually decides.
 */
export type RedaxTeamAdminSetupCampaignAuthority =
  | 'EXPLICIT_SELECTION_CONFIRMED'
  | 'APPROVED_TEAM_UNAVAILABLE'
  | 'NO_EXPLICIT_SELECTION'
  | 'SELECTION_NOT_EFFECTIVE'
  | 'CAMPAIGN_UNAVAILABLE'
  | 'CAMPAIGN_IDENTITY_MISMATCH'
  | 'CAMPAIGN_ADMIN_MISMATCH'
  | 'CAMPAIGN_NOT_INITIALIZED'

/**
 * Establish campaign authority POSITIVELY, from explicit selection facts.
 *
 * Nothing is inferred from what happens to be rendered. Each comparison must SUCCEED —
 * an absent stored address and an absent stored admin both refuse, because a view that
 * omitted the field is not a view that agreed.
 */
export function deriveRedaxTeamAdminSetupCampaignAuthority(input: {
  readonly approvedTeamWallet: string | null
  readonly selectedCampaignId: string
  readonly effectiveSelectedCampaignId: string
  readonly selectedCampaign: RedaxCampaignView | null
}): RedaxTeamAdminSetupCampaignAuthority {
  if (input.approvedTeamWallet === null) {
    return 'APPROVED_TEAM_UNAVAILABLE'
  }
  if (input.selectedCampaignId.trim() === '') {
    return 'NO_EXPLICIT_SELECTION'
  }
  // THE FALLBACK REFUSAL. When the loader resolved a different campaign than the one that
  // was selected, what is on screen is a display convenience and never a target.
  if (input.selectedCampaignId !== input.effectiveSelectedCampaignId) {
    return 'SELECTION_NOT_EFFECTIVE'
  }
  const campaign = input.selectedCampaign
  if (campaign === null) {
    return 'CAMPAIGN_UNAVAILABLE'
  }
  if (campaign.id !== input.selectedCampaignId) {
    return 'CAMPAIGN_IDENTITY_MISMATCH'
  }
  // The campaign's OWN stored address must agree with the selection, so an id that is a
  // product handle rather than an account can never be treated as one.
  if (campaign.campaignAddress !== input.selectedCampaignId) {
    return 'CAMPAIGN_IDENTITY_MISMATCH'
  }
  if (campaign.campaignAdmin !== input.approvedTeamWallet) {
    return 'CAMPAIGN_ADMIN_MISMATCH'
  }
  if (campaign.programStatus !== 'initialized') {
    return 'CAMPAIGN_NOT_INITIALIZED'
  }
  return 'EXPLICIT_SELECTION_CONFIRMED'
}

/** How this panel describes the wallet situation, for ENABLEMENT UX only. */
export type RedaxTeamAdminSetupWalletStatus =
  | 'CARRIER_UNAVAILABLE'
  | 'DISCONNECTED'
  | 'CONNECTED_MATCH'
  | 'CONNECTED_MISMATCH'

/**
 * The wallet situation, by EXACT equality against the injected carrier.
 *
 * No normalization, no case folding and no prefix match, because a near-miss is a
 * different wallet. A connected wallet never approves itself here.
 */
export function deriveRedaxTeamAdminSetupWalletStatus(
  approvedTeamWallet: string | null,
  connectedPublicKey: string | null,
): RedaxTeamAdminSetupWalletStatus {
  if (approvedTeamWallet === null) {
    return 'CARRIER_UNAVAILABLE'
  }
  if (connectedPublicKey === null) {
    return 'DISCONNECTED'
  }
  return connectedPublicKey === approvedTeamWallet ? 'CONNECTED_MATCH' : 'CONNECTED_MISMATCH'
}

/** Shortened display form (4…4). The full address is never rendered by this panel. */
function shortenAddress(value: string): string {
  return value.length <= 9 ? value : `${value.slice(0, 4)}…${value.slice(-4)}`
}

/**
 * One editable field id to the exact draft patch it produces.
 *
 * Written out rather than computed from the id, so the mapping is TOTAL in source: the
 * `never` binding in the default arm means a sixth field id stops this file compiling
 * until somebody decides what it edits.
 */
function redaxTeamAdminTokenConfigDraftPatch(
  field: TeamAdminAddTokenConfigFieldId,
  value: string,
): Partial<Omit<RedaxTeamAdminTokenConfigDraftRow, 'rowId'>> {
  switch (field) {
    case 'legacyMint':
      return { legacyMint: value }
    case 'expectedLegacyDecimals':
      return { expectedLegacyDecimals: value }
    case 'rateNumerator':
      return { rateNumerator: value }
    case 'rateDenominator':
      return { rateDenominator: value }
    case 'maxOutputFromTokenConfig':
      return { maxOutputFromTokenConfig: value }
    default: {
      const exhaustive: never = field
      return exhaustive
    }
  }
}

/**
 * The sanitized status projection, folded into the pure module's structural input.
 *
 * A read that has not happened yet, and a read that failed, are BOTH `UNAVAILABLE`: an
 * unread slot is not a slot known to be empty, and every row stays blocked until it has
 * actually been read.
 */
export function toRedaxTeamAdminSetupStatusInput(
  status: RedaxTeamAdminMutationStatusReadResult | null,
): RedaxTeamAdminTokenConfigStatusInput {
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
      addTokenConfigRequest: status.addTokenConfigRequest,
    }
  }
  return {
    kind: 'TOMBSTONE',
    operation: status.operation,
    campaign: status.campaign,
    resolution: status.resolution,
    witnessAddress: status.witnessAddress,
    addTokenConfigRequest: status.addTokenConfigRequest,
  }
}

/**
 * One sentence per submit code, over the WHOLE closed union.
 *
 * The `never` binding in the default arm is the point: this is a source-total mapping of
 * the mutation root's own vocabulary, so a code added there stops this file compiling
 * until it is described here. No raw wallet error, RPC error, signature or transaction
 * byte can appear — the result type carries none.
 */
export function describeRedaxTeamAdminMutationSubmitCode(
  code: RedaxTeamAdminMutationSubmitCode,
): string {
  switch (code) {
    case 'RUNTIME_CONFIG_UNAVAILABLE':
      return 'The devnet runtime configuration was unusable, so nothing was built and nothing was sent.'
    case 'WALLET_NOT_CONNECTED':
      return 'No wallet was connected when the action ran. Nothing was built and nothing was sent.'
    case 'WALLET_SIGN_ONLY_UNAVAILABLE':
      return 'The wallet could not offer the sign-only surface this action requires. Nothing was signed and nothing was sent.'
    case 'APPROVED_TEAM_IDENTITY_UNAVAILABLE':
      return 'No approved Team identity was available to the action, so it refused before building anything.'
    case 'REQUEST_INVALID':
      return 'The request was not a value the program would accept, so it was refused before any devnet read.'
    case 'CHAIN_GUARD_REFUSED':
      return 'The chain guard refused against live devnet state. That includes the two token accounts themselves: the input token and the campaign’s output token are read before the wallet is asked, and one that is not a classic SPL token, is not set up, or does not report the decimals this row states refuses there rather than inside a transaction you have already approved. This refusal can occur before the wallet is asked and also after a signature is returned, so it is not on its own a claim that nothing was signed — it is a claim that nothing was broadcast.'
    // KNOWN INSUFFICIENT, AND PRE-INVOCATION. A complete, valid reading proved the balance
    // too low, and the refusal happened before the plan existed — so nothing was assembled
    // past the SOL gate, the wallet was never asked, and nothing was sent. It is deliberately
    // NOT the guard refusal above: that one covers unknowns, and this one covers a fact.
    // Value-free: no amount, no threshold and no failing term is named.
    case 'PAYER_SOL_INSUFFICIENT':
      return TEAM_ADMIN_SOL_PREFLIGHT_SUBMIT_REFUSED
    case 'PRE_STATE_NOT_ADMISSIBLE':
      return 'The campaign’s live state did not admit this step. Nothing was built and nothing was sent.'
    case 'METADATA_NOT_CANONICAL':
      return 'A metadata value could not be canonicalized. This action submits no metadata, so this refusal means nothing was built and nothing was sent.'
    case 'MUTATION_IDENTITY_UNAVAILABLE':
      return 'The attempt’s identity could not be computed on this platform, so nothing durable was written and nothing was sent.'
    case 'PLAN_INVALID':
      return 'The instruction plan did not validate against the campaign that was read. Nothing was built and nothing was sent.'
    case 'ATTEMPT_BLOCKED':
      return 'An unresolved saved attempt already occupies the single attempt slot, so this one refused to start. Use Check submission status.'
    case 'MUTATION_IDENTITY_ALREADY_FULFILLED':
      return 'This exact request has already been settled and cannot be started again. Nothing was built and nothing was sent.'
    case 'MESSAGE_COMMITMENT_UNAVAILABLE':
      return 'The intended message could not be committed to before the wallet was asked, so the action refused. Nothing was signed and nothing was sent.'
    case 'JOURNAL_UNAVAILABLE':
      return 'The durable attempt record could not be written or verified, so the action refused before any wallet request. Nothing was signed and nothing was sent.'
    case 'WALLET_SIGN_ONLY_REFUSED':
      return 'The wallet did not return a usable signature — declined, closed or unavailable. Nothing was sent.'
    case 'SIGNED_ARTIFACT_REJECTED':
      return 'What the wallet returned was not exactly the approved single-signature artifact over the exact committed message, so it was rejected and nothing was sent.'
    case 'PRE_RAW_SEND_RECORD_UNVERIFIED':
      return 'The durable record required before the point of no return could not be read back, so the action stopped short of it. Nothing was sent.'
    case 'RAW_SEND_OUTCOME_UNKNOWN':
      return 'The attempt reached the network and its outcome is not yet known. This is not a failure and not a licence to try again — use Check submission status.'
    case 'MATCHING_IMMEDIATE_STATE_RESOLVED':
      return 'The campaign’s state immediately afterwards matched exactly what this attempt intended, and the attempt is recorded as settled.'
    case 'LANDED_EXACT_POST_STATE_SUPERSEDED_RESOLVED':
      return 'The exact intended transaction landed, and the campaign’s state has since moved on. The attempt is recorded as settled.'
    case 'FINALIZED_LANDED_FAILURE_RESOLVED':
      return 'The exact intended transaction landed and failed on chain, so it took no effect. The attempt is recorded as settled.'
    case 'OUTCOME_UNRESOLVED_SUPPORT':
      return 'The outcome could not be established from the evidence available. This is support-only: it is never a retry and never permission to start another attempt.'
    case 'MUTATION_PREFLIGHT_INTERNAL_FAILURE':
      return 'The action failed before the point of no return and stopped. Nothing was sent.'
    case 'MUTATION_POST_SEND_INTERNAL_FAILURE':
      return 'The action failed after the point of no return. Something may have reached the network, so no retry is offered — use Check submission status.'
    default: {
      const exhaustive: never = code
      return exhaustive
    }
  }
}

/** One sentence per reconcile code, over the WHOLE closed union. */
export function describeRedaxTeamAdminMutationReconcileCode(
  code: RedaxTeamAdminMutationReconcileCode,
): string {
  switch (code) {
    case 'RUNTIME_CONFIG_UNAVAILABLE':
      return 'The devnet runtime configuration was unusable, so no saved attempt could be read.'
    case 'APPROVED_TEAM_IDENTITY_UNAVAILABLE':
      return 'No approved Team identity was available, so no saved attempt could be read.'
    case 'JOURNAL_UNAVAILABLE':
      return 'The saved attempt could not be read. Nothing was changed.'
    case 'NO_RECORD':
      return 'There is no saved attempt for the approved Team wallet.'
    case 'ALREADY_RESOLVED':
      return 'The saved attempt was already settled. Nothing was changed.'
    case 'PRE_RAW_SEND_NO_BROADCAST_RESOLVED':
      return 'The saved attempt never reached the point of no return, so nothing was ever broadcast. It is now recorded as settled.'
    case 'MATCHING_IMMEDIATE_STATE_RESOLVED':
      return 'The campaign’s state matched exactly what the saved attempt intended, and it is now recorded as settled.'
    case 'LANDED_EXACT_POST_STATE_SUPERSEDED_RESOLVED':
      return 'The exact intended transaction landed and the campaign’s state has since moved on. The saved attempt is now recorded as settled.'
    case 'FINALIZED_LANDED_FAILURE_RESOLVED':
      return 'The exact intended transaction landed and failed on chain, so it took no effect. The saved attempt is now recorded as settled.'
    case 'OUTCOME_STILL_UNRESOLVED':
      return 'The outcome is still not established. Nothing was changed, and this is not a licence to start another attempt.'
    case 'TERMINAL_RECORD_UNVERIFIED':
      return 'A settled outcome was written and could not be read back, so it is not being claimed. Nothing was changed.'
    case 'MUTATION_POST_SEND_INTERNAL_FAILURE':
      return 'The check failed. It signed nothing and sent nothing, and nothing was changed.'
    default: {
      const exhaustive: never = code
      return exhaustive
    }
  }
}

/** One sentence per status-read code, over the WHOLE closed union. */
export function describeRedaxTeamAdminMutationStatusReadCode(
  code: RedaxTeamAdminMutationStatusReadCode,
): string {
  switch (code) {
    case 'RUNTIME_CONFIG_UNAVAILABLE':
      return 'The devnet runtime configuration was unusable, so the saved attempt slot could not be read.'
    case 'APPROVED_TEAM_IDENTITY_UNAVAILABLE':
      return 'No approved Team identity was available, so the saved attempt slot could not be read.'
    case 'JOURNAL_UNAVAILABLE':
      return 'The saved attempt slot could not be read. Every row stays blocked until it can be.'
    default: {
      const exhaustive: never = code
      return exhaustive
    }
  }
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
type SetupSolPreflightState =
  | { kind: 'idle' }
  | { kind: 'reading' }
  | { kind: 'settled'; result: RedaxTeamAdminMutationSolPreflightResult }

const SETUP_SOL_PREFLIGHT_IDLE: SetupSolPreflightState = { kind: 'idle' }
const SETUP_SOL_PREFLIGHT_READING: SetupSolPreflightState = { kind: 'reading' }

/**
 * IDENTITY PRIVACY IS A RENDER-TIME RULE, NOT A CLEANUP RACE.
 *
 * A panel-local value is stored together with the EXACT identity scope that produced it and
 * read back through `inScope` while the tree is computed. A value whose recorded scope is
 * not the current one is therefore invisible AND unusable in the very first render that
 * observes a new wallet, campaign or carrier — before any passive effect runs.
 */
interface SetupScopedState<T> {
  readonly scope: string
  readonly value: T
}

function setupScopedState<T>(scope: string, value: T): SetupScopedState<T> {
  return { scope, value }
}

function setupInScope<T>(
  record: SetupScopedState<T>,
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
export function redaxTeamAdminSetupSolPreflightScope(
  approvedTeamWallet: string | null,
  connectedPublicKey: string | null,
  selectedCampaignId: string,
  operation: RedaxTeamAdminMutationOperation,
): string {
  return `${approvedTeamWallet ?? ''}|${connectedPublicKey ?? ''}|${selectedCampaignId}|${operation}`
}

export function RedaxTeamAdminCampaignSetupPanel({
  approvedTeamWallet,
  campaignDataReady,
  effectiveSelectedCampaignId,
  programId,
  readFreshCampaignSetupTruth,
  selectedCampaign,
  selectedCampaignId,
  tokenConfigs,
}: RedaxTeamAdminCampaignSetupPanelProps) {
  const actions = useRedaxTeamAdminMutationActions()
  const wallet = useRedaxWallet()

  // MEMORY ONLY, and nowhere else. No storage port, no lock, no fourth owner.
  const [draftRows, setDraftRows] = useState<readonly RedaxTeamAdminTokenConfigDraftRow[]>([])
  // The reading the LAST explicit status gesture took, or `null` for "none current".
  //
  // It is cleared whenever a gesture STARTS and whenever a submission runs, so the window
  // in which a reading is treated as fresh is exactly the window in which nothing has
  // happened since it was taken.
  const [freshChainTruth, setFreshChainTruth] =
    useState<RedaxTeamAdminSetupFreshChainTruth | null>(null)
  const [statusResult, setStatusResult] = useState<RedaxTeamAdminMutationStatusReadResult | null>(
    null,
  )
  const [submitResult, setSubmitResult] = useState<RedaxTeamAdminMutationSubmitResult | null>(null)
  const [reconcileCode, setReconcileCode] = useState<RedaxTeamAdminMutationReconcileCode | null>(
    null,
  )
  const [operation, setOperation] = useState<SetupPanelOperation | null>(null)
  const [draftError, setDraftError] = useState<string | null>(null)

  // The synchronous latch. A `disabled` attribute alone would not do: two clicks inside
  // one frame both observe the same rendered state.
  const inFlightRef = useRef<SetupPanelOperation | null>(null)
  // A deterministic row-id counter. NOT a clock and NOT entropy — this file reads neither.
  const rowSequenceRef = useRef<number>(0)

  const busy = operation !== null

  // WHICH READING THIS RENDER RESTS ON, decided in one place and used everywhere below.
  //
  // Every campaign and TokenConfig fact from here down comes out of this selection rather
  // than off the props, so there is no second path by which a stale snapshot could reach a
  // confirmation or a re-entry decision. Before any gesture it IS the props, declared for
  // what it is; after a gesture it is that gesture's own reading, or nothing at all.
  const chainTruth = selectRedaxTeamAdminSetupChainTruth({
    selectedCampaignId,
    freshChainTruth,
    loadedCampaign: selectedCampaign,
    loadedTokenConfigs: tokenConfigs,
  })
  const authoritativeCampaign = chainTruth.campaign

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
  // HOISTED to sit beside the status it is derived from, because the C1 block below consumes
  // it. Same expression, same single definition, same two inputs — only its position moved.
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

  // --- C1 devnet SOL availability for ADD_TOKEN_CONFIG ------------------------------
  //
  //     A DRAFT KEYSTROKE IS NOT A DIMENSION. The ADD threshold is the payer rent floor, the
  //     TokenConfig allocation and the fee bound; no rate, cap or legacy mint can change it,
  //     so editing a row reads nothing.
  const addTokenConfigSolPreflightScope = redaxTeamAdminSetupSolPreflightScope(
    approvedTeamWallet,
    connectedPublicKeyForSolPreflight,
    selectedCampaignId,
    'ADD_TOKEN_CONFIG',
  )
  // ACTIONABLE means "worth reading a balance about": a carrier exists, a wallet is
  // connected, that wallet is EXACTLY the approved Team, and this campaign is the explicitly
  // confirmed one. Any other identity resolves to `idle` — this panel does not read, and does
  // not report, a balance belonging to a wallet that could not pay for this operation anyway.
  const addTokenConfigSolPreflightActionable = approvedTeamWallet !== null &&
    walletConnectedMatch &&
    authorityConfirmed &&
    selectedCampaignId !== ''

  const [addTokenConfigSolPreflightRecord, setAddTokenConfigSolPreflightRecord] = useState<
    SetupScopedState<SetupSolPreflightState>
  >(() =>
    setupScopedState(
      addTokenConfigSolPreflightScope,
      addTokenConfigSolPreflightActionable ? SETUP_SOL_PREFLIGHT_READING : SETUP_SOL_PREFLIGHT_IDLE,
    ),
  )

  // RENDER-TIME IDENTITY GATING. The projection collapses to its neutral resting value the
  // moment the identity that produced it stops being current — in THIS render, not in a later
  // effect. A wallet or campaign change therefore invalidates an old reading immediately.
  const addTokenConfigSolPreflight = setupInScope(
    addTokenConfigSolPreflightRecord,
    addTokenConfigSolPreflightScope,
    addTokenConfigSolPreflightActionable ? SETUP_SOL_PREFLIGHT_READING : SETUP_SOL_PREFLIGHT_IDLE,
  )

  const committedAddTokenConfigSolPreflightScopeRef = useRef(addTokenConfigSolPreflightScope)
  const addTokenConfigSolPreflightGenerationRef = useRef(0)

  useLayoutEffect(() => {
    committedAddTokenConfigSolPreflightScopeRef.current = addTokenConfigSolPreflightScope
  }, [addTokenConfigSolPreflightScope])

  // EVERY ASYNC COMPLETION MUST PROVE THREE THINGS before it may write state: still mounted,
  // the COMMITTED scope is the one the read started in, and the read is still the newest.
  const isAddTokenConfigSolPreflightCurrent = useCallback(
    (scopeKey: string, generation: number): boolean => {
      return (
        solPreflightMountedRef.current &&
        committedAddTokenConfigSolPreflightScopeRef.current === scopeKey &&
        addTokenConfigSolPreflightGenerationRef.current === generation
      )
    },
    [],
  )

  // ONE read-only devnet SOL read for THIS operation. It builds nothing, signs nothing, sends
  // nothing, confirms nothing, touches no durable record and returns no authorization. Each
  // call supersedes the previous one, so a slow earlier read can never be the last writer.
  const runAddTokenConfigSolPreflightRead = useCallback(
    async (scopeKey: string): Promise<void> => {
      addTokenConfigSolPreflightGenerationRef.current += 1
      const generation = addTokenConfigSolPreflightGenerationRef.current
      setAddTokenConfigSolPreflightRecord(setupScopedState(scopeKey, SETUP_SOL_PREFLIGHT_READING))
      try {
        const result = await readMutationSolPreflightRef.current('ADD_TOKEN_CONFIG')
        if (!isAddTokenConfigSolPreflightCurrent(scopeKey, generation)) {
          return
        }
        setAddTokenConfigSolPreflightRecord(
          setupScopedState<SetupSolPreflightState>(scopeKey, { kind: 'settled', result }),
        )
      } catch {
        // A REJECTED read is not an observation. It settles as READ_UNAVAILABLE — which
        // WITHHOLDS the action — rather than as an unhandled rejection or an optimistic
        // sufficiency. No raw error is read, rendered or logged.
        if (!isAddTokenConfigSolPreflightCurrent(scopeKey, generation)) {
          return
        }
        setAddTokenConfigSolPreflightRecord(
          setupScopedState<SetupSolPreflightState>(scopeKey, {
            kind: 'settled',
            result: 'READ_UNAVAILABLE',
          }),
        )
      }
    },
    [isAddTokenConfigSolPreflightCurrent],
  )

  // EXACTLY ONE AUTOMATIC READ PER NEW ACTIONABLE SCOPE, and no more. No timer, no interval,
  // no polling, no subscription and no automatic retry: a stale reading is corrected by the
  // explicit human re-check, never by this panel deciding on its own to ask again.
  useEffect(() => {
    if (!addTokenConfigSolPreflightActionable) {
      setAddTokenConfigSolPreflightRecord(setupScopedState(addTokenConfigSolPreflightScope, SETUP_SOL_PREFLIGHT_IDLE))
      return
    }
    void runAddTokenConfigSolPreflightRead(addTokenConfigSolPreflightScope)
  }, [addTokenConfigSolPreflightActionable, addTokenConfigSolPreflightScope, runAddTokenConfigSolPreflightRead])

  // KNOWN-SUFFICIENT ONLY. A reading, an idle projection and a failed read all resolve to
  // false, because an unknown balance must WITHHOLD an action rather than allow one.
  const addTokenConfigSolPreflightSufficient = addTokenConfigSolPreflight.kind === 'settled' && addTokenConfigSolPreflight.result === 'SUFFICIENT'

  const addTokenConfigSolPreflightNote: string | null =
    addTokenConfigSolPreflight.kind === 'reading'
      ? TEAM_ADMIN_SOL_PREFLIGHT_READING
      : addTokenConfigSolPreflight.kind === 'idle'
        ? null
        : addTokenConfigSolPreflight.result === 'INSUFFICIENT'
          ? TEAM_ADMIN_SOL_PREFLIGHT_INSUFFICIENT
          : addTokenConfigSolPreflight.result === 'READ_UNAVAILABLE'
            ? TEAM_ADMIN_SOL_PREFLIGHT_UNAVAILABLE
            : null

  /**
   * THE EXPLICIT, READ-ONLY SOL RE-CHECK FOR ADD_TOKEN_CONFIG. It runs ONLY from its own click.
   *
   * It builds nothing, signs nothing, sends nothing, confirms nothing, writes no durable
   * record and returns no authorization, and there is no timer, no poll, no storage event and
   * no subscription behind it. IT IS NOT A MUTATION ACTION: it does not take the
   * single-flight latch, does not set `operation`, and never counts toward this panel's
   * transaction-control census. It re-reads EXACTLY this operation and supersedes only its
   * own previous read.
   */
  const handleAddTokenConfigSolPreflightRecheck = useCallback((): void => {
    if (addTokenConfigSolPreflightScope !== committedAddTokenConfigSolPreflightScopeRef.current) {
      return
    }
    if (!addTokenConfigSolPreflightActionable || busy || addTokenConfigSolPreflight.kind === 'reading') {
      return
    }
    void runAddTokenConfigSolPreflightRead(addTokenConfigSolPreflightScope)
  }, [busy, runAddTokenConfigSolPreflightRead, addTokenConfigSolPreflight.kind, addTokenConfigSolPreflightActionable, addTokenConfigSolPreflightScope])

  // The campaign's own accepted inputs, kept as the exact chain facts a row is compared
  // against. Filtered by the campaign it belongs to, so a stale list from another
  // selection can never corroborate a row here.
  const chainTokenConfigs: readonly RedaxTeamAdminTokenConfigChainFacts[] = useMemo(() => {
    const campaign = chainTruth.campaign
    if (campaign === null) {
      return []
    }
    return chainTruth.tokenConfigs
      .filter((view) => view.campaignId === campaign.id)
      .map((view) => ({
        tokenConfig: view.id,
        campaign: campaign.campaignAddress ?? '',
        legacyMint: view.legacyMint,
        rateNumerator: view.rateNumeratorRaw,
        rateDenominator: view.rateDenominatorRaw,
        maxOutputFromTokenConfig: view.maxOutputFromTokenConfigRaw,
        legacyDecimals: view.legacyDecimals,
        outputDecimals: view.outputDecimals,
      }))
  }, [chainTruth.campaign, chainTruth.tokenConfigs])

  // The output decimals this panel DISPLAYS: the campaign's own accepted inputs agree on
  // them, and where the campaign has none yet the Phase 1 fixed value is used. It is never
  // an editable input, and it is never economic authority — the program reads the mints.
  const expectedOutputDecimals =
    chainTokenConfigs.length > 0
      ? chainTokenConfigs[0].outputDecimals
      : REDAX_OUTPUT_DECIMALS_FALLBACK

  const campaignContext: RedaxTeamAdminTokenConfigCampaignContext | null = useMemo(() => {
    if (!authorityConfirmed || programId === null || authoritativeCampaign === null) {
      return null
    }
    const campaignAddress = authoritativeCampaign.campaignAddress
    if (campaignAddress === undefined) {
      return null
    }
    return {
      programId,
      campaign: campaignAddress,
      outputMint: authoritativeCampaign.outputMint,
      expectedOutputDecimals,
      // CHAIN TRUTH OR NOTHING. While the campaign read is in flight or failed, the count
      // is `null` rather than the last one seen, and a null count refuses.
      tokenConfigCount: campaignDataReady ? authoritativeCampaign.tokenConfigCount : null,
      chainLegacyMints: chainTokenConfigs.map((facts) => facts.legacyMint),
    }
  }, [
    authoritativeCampaign,
    authorityConfirmed,
    campaignDataReady,
    chainTokenConfigs,
    expectedOutputDecimals,
    programId,
  ])

  const statusInput = useMemo(
    () => toRedaxTeamAdminSetupStatusInput(statusResult),
    [statusResult],
  )
  const capacity = summarizeRedaxTeamAdminTokenConfigCapacity(
    campaignDataReady && authoritativeCampaign !== null
      ? authoritativeCampaign.tokenConfigCount
      : null,
    draftRows.length,
    statusInput,
  )

  /**
   * Every row, validated and dispositioned. Pure, and recomputed rather than remembered.
   *
   * `chainAvailable` folds BOTH halves of what "readable" means here: App's campaign read
   * resolved, and this panel established positive authority over the campaign it resolved.
   * Either being false leaves every row without a state.
   */
  const judgedRows = useMemo(() => {
    const chainAvailable =
      campaignDataReady && campaignContext !== null && !chainTruth.freshReadRefused
    return draftRows.map((draft) => {
      const validation =
        campaignContext === null
          ? null
          : validateRedaxTeamAdminPostInitTokenConfigRow(draft, campaignContext, draftRows)
      // THE ROW THAT MAY BE SUBMITTED. `validation.ok` and nothing weaker — this is what the
      // submit control carries, so it must be the row that passed EVERY admission rule.
      const validRow: RedaxTeamAdminValidatedTokenConfigRow | null =
        validation !== null && validation.ok ? validation.row : null
      const disposition: RedaxTeamAdminTokenConfigRowDisposition =
        deriveRedaxTeamAdminTokenConfigRowDisposition({
          row: validation === null ? null : validation.identity,
          newSubmissionAdmissible: validation !== null && validation.ok,
          chainAvailable,
          chainTokenConfigs,
          chainTruthKind: chainTruth.chainTruthKind,
          capacityRemaining: capacity.remaining,
          status: statusInput,
        })
      return {
        draft,
        issues: validation !== null && !validation.ok ? validation.issues : [],
        validRow,
        disposition,
      }
    })
  }, [
    campaignContext,
    campaignDataReady,
    capacity.remaining,
    chainTokenConfigs,
    chainTruth.chainTruthKind,
    chainTruth.freshReadRefused,
    draftRows,
    statusInput,
  ])

  /**
   * `draftRows` is memory-only by design and comes back empty, but the durable attempt does
   * not live there — it lives in the journal, which the status gesture reads back. Before
   * this repair nothing turned that reading into something renderable, so a reload during an
   * outstanding `add_token_config` showed an empty workspace while a real attempt was in
   * flight. This is a PROJECTION of the sanitized status the panel already holds, joined to
   * the same chain truth every row above is judged against; it stores nothing, remembers
   * nothing, and can never become an editable draft.
   *
   * `null` for an unread slot, an empty slot, and every one of the five later-slice
   * operations — none of those is an `add_token_config`, and manufacturing a token-config
   * row out of one would be rendering a capability this slice does not have.
   */
  const recoveryRow = useMemo(
    () =>
      projectRedaxTeamAdminTokenConfigRecoveryRow({
        status: statusInput,
        chainAvailable:
          campaignDataReady && campaignContext !== null && !chainTruth.freshReadRefused,
        chainTokenConfigs,
        chainTruthKind: chainTruth.chainTruthKind,
      }),
    [
      campaignContext,
      campaignDataReady,
      chainTokenConfigs,
      chainTruth.chainTruthKind,
      chainTruth.freshReadRefused,
      statusInput,
    ],
  )

  const updateDraft = useCallback(
    (rowId: string, field: TeamAdminAddTokenConfigFieldId, value: string): void => {
      setDraftError(null)
      setDraftRows((current) => {
        const next = reduceRedaxTeamAdminTokenConfigDraftRows(current, {
          kind: 'edit',
          rowId,
          patch: redaxTeamAdminTokenConfigDraftPatch(field, value),
        })
        return next.ok ? next.rows : current
      })
    },
    [],
  )

  const addDraftRow = useCallback((): void => {
    // The ceiling is decided BEFORE the updater, and the counter is advanced there too:
    // a state updater that mutated a ref or set another piece of state would not be a
    // pure function of the previous rows, and would double-apply under a strict remount.
    if (draftRows.length >= REDAX_TEAM_ADMIN_MAX_TOKEN_CONFIGS) {
      setDraftError(TEAM_ADMIN_ADD_TOKEN_CONFIG.blockingNote.CAMPAIGN_AT_TOKEN_CONFIG_CEILING)
      return
    }
    rowSequenceRef.current += 1
    const candidate = emptyRedaxTeamAdminTokenConfigDraftRow(rowSequenceRef.current)
    setDraftError(null)
    setDraftRows((current) => {
      const next = reduceRedaxTeamAdminTokenConfigDraftRows(current, {
        kind: 'add',
        row: candidate,
      })
      return next.ok ? next.rows : current
    })
  }, [draftRows.length])

  const removeDraftRow = useCallback((rowId: string): void => {
    setDraftError(null)
    setDraftRows((current) => {
      const next = reduceRedaxTeamAdminTokenConfigDraftRows(current, { kind: 'remove', rowId })
      return next.ok ? next.rows : current
    })
  }, [])

  const moveDraftRow = useCallback((rowId: string, toIndex: number): void => {
    setDraftError(null)
    setDraftRows((current) => {
      const next = reduceRedaxTeamAdminTokenConfigDraftRows(current, {
        kind: 'reorder',
        rowId,
        toIndex,
      })
      return next.ok ? next.rows : current
    })
  }, [])

  /**
   * THE ONE SUBMIT PATH, per row, from an explicit click and nowhere else.
   *
   * The latch is CLAIMED synchronously before the first await, so a second click in the
   * same frame cannot pass. There is no submit-all, no automatic next row and no retry:
   * after a submission returns, the row's own state is re-derived from the journal and the
   * chain, and it will not read as `PREPARED` again unless both say so.
   */
  const handleSubmitRow = useCallback(
    async (row: RedaxTeamAdminValidatedTokenConfigRow): Promise<void> => {
      if (inFlightRef.current !== null) {
        return
      }
      // The rendered control is already disabled without these; the handler asserts them
      // again because a disabled attribute is a rendering, not a gate.
      if (!authorityConfirmed || !walletConnectedMatch) {
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
        addTokenConfigSolPreflightScope !== committedAddTokenConfigSolPreflightScopeRef.current ||
        !addTokenConfigSolPreflightSufficient
      ) {
        return
      }
      inFlightRef.current = 'submit'
      setOperation('submit')
      setReconcileCode(null)
      // THE READING IS SPENT. Whatever the chain said before this attempt says nothing
      // about the chain after it, so the freshness witness is dropped here rather than
      // carried across the one event that can invalidate it. Until the operator runs the
      // status gesture again, no row can read as confirmed or re-enter `PREPARED`.
      setFreshChainTruth(null)
      try {
        const result = await actions.submitMutation({
          operation: 'ADD_TOKEN_CONFIG',
          campaign: row.campaign,
          outputMint: row.outputMint,
          legacyMint: row.legacyMint,
          rateNumerator: row.rateNumerator,
          rateDenominator: row.rateDenominator,
          maxOutputFromTokenConfig: row.maxOutputFromTokenConfig,
          expectedLegacyDecimals: row.expectedLegacyDecimals,
          expectedOutputDecimals: row.expectedOutputDecimals,
        })
        setSubmitResult(result)
        // A READ, never a reconcile. The row's next state has to come from the durable
        // record rather than from what this handler happens to remember.
        setStatusResult(await actions.readMutationStatus())
      } finally {
        inFlightRef.current = null
        setOperation(null)
      }
    },
    [
      actions,
      addTokenConfigSolPreflightScope,
      addTokenConfigSolPreflightSufficient,
      authorityConfirmed,
      walletConnectedMatch,
    ],
  )

  /**
   * THE ONE STATUS PATH, from an explicit click and nowhere else.
   *
   * It reconciles the saved attempt and then re-reads it. Neither step signs, prompts a
   * wallet, builds a transaction, sends anything or starts a new attempt, which is why it
   * needs no connected wallet and is safe after a reload or a disconnect.
   */
  const handleCheckStatus = useCallback(async (): Promise<void> => {
    if (inFlightRef.current !== null) {
      return
    }
    // The campaign this gesture is ABOUT, read once before the first await. Everything the
    // gesture establishes is bound to it, so a reading cannot be attributed to whichever
    // campaign happens to be selected when the promises settle.
    const gestureCampaignId = selectedCampaignId
    inFlightRef.current = 'status'
    setOperation('status')
    // The previous reading stops being current the moment a new gesture begins.
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
      // by `selectRedaxTeamAdminSetupChainTruth`, which compares the two on every render —
      // so a selection that changes before OR after this line is handled by the same rule.
      setFreshChainTruth(outcome.freshChainTruth)
    } finally {
      inFlightRef.current = null
      setOperation(null)
    }
  }, [actions, readFreshCampaignSetupTruth, selectedCampaignId])

  const identityNote =
    walletStatus === 'CARRIER_UNAVAILABLE'
      ? TEAM_ADMIN_ADD_TOKEN_CONFIG.carrierUnavailable
      : walletStatus === 'DISCONNECTED'
        ? TEAM_ADMIN_ADD_TOKEN_CONFIG.disconnected
        : walletStatus === 'CONNECTED_MATCH'
          ? TEAM_ADMIN_ADD_TOKEN_CONFIG.connectedMatch
          : TEAM_ADMIN_ADD_TOKEN_CONFIG.connectedMismatch

  const statusSummary =
    statusResult === null
      ? TEAM_ADMIN_ADD_TOKEN_CONFIG.statusUnread
      : !statusResult.ok
        ? describeRedaxTeamAdminMutationStatusReadCode(statusResult.code)
        : statusResult.presence === 'EMPTY'
          ? TEAM_ADMIN_ADD_TOKEN_CONFIG.statusEmpty
          : statusResult.presence === 'ACTIVE'
            ? TEAM_ADMIN_ADD_TOKEN_CONFIG.blockingNote.GLOBAL_MUTATION_SLOT_ACTIVE
            :
              TEAM_ADMIN_ADD_TOKEN_CONFIG.tombstoneSummary[
                classifyRedaxTeamAdminTokenConfigTombstone(statusResult.resolution)
              ]

  return (
    <SurfaceCard
      eyebrow={TEAM_ADMIN_ADD_TOKEN_CONFIG.eyebrow}
      title={TEAM_ADMIN_ADD_TOKEN_CONFIG.title}
      footnote={TEAM_ADMIN_ADD_TOKEN_CONFIG.footnote}
    >
      <div className="wizard-preview">
        <p className="wizard-preview__intro">{TEAM_ADMIN_ADD_TOKEN_CONFIG.intro}</p>
        <p className="wizard-preview__boundary">{TEAM_ADMIN_ADD_TOKEN_CONFIG.boundary}</p>

        <div className="wizard-preview__step">
          <p className="wizard-preview__header">{TEAM_ADMIN_ADD_TOKEN_CONFIG.authorityTitle}</p>
          <div className="wizard-preview__stephead">
            <StatusPill
              label={campaignAuthority}
              tone={authorityConfirmed ? 'positive' : 'neutral'}
            />
          </div>
          <p className="wizard-preview__purpose">
            {TEAM_ADMIN_ADD_TOKEN_CONFIG.authority[campaignAuthority]}
          </p>
          {authoritativeCampaign?.campaignAddress ? (
            <MetricRow
              label="Campaign address (shortened)"
              value={shortenAddress(authoritativeCampaign.campaignAddress)}
              hint="the campaign this row would be added to"
            />
          ) : null}
          <MetricRow
            label={TEAM_ADMIN_ADD_TOKEN_CONFIG.outputDecimalsLabel}
            value={String(expectedOutputDecimals)}
            hint={TEAM_ADMIN_ADD_TOKEN_CONFIG.outputDecimalsHint}
          />
        </div>

        <div className="wizard-preview__step">
          <p className="wizard-preview__header">{TEAM_ADMIN_ADD_TOKEN_CONFIG.walletTitle}</p>
          <p className="wizard-preview__purpose">{identityNote}</p>

          {approvedTeamWallet !== null ? (
            <MetricRow
              label={TEAM_ADMIN_ADD_TOKEN_CONFIG.approvedKeyLabel}
              value={shortenAddress(approvedTeamWallet)}
              hint="configured for this deployment; never taken from the connected wallet"
            />
          ) : null}

          {wallet.shortPublicKey ? (
            <MetricRow
              label={TEAM_ADMIN_ADD_TOKEN_CONFIG.connectedKeyLabel}
              value={wallet.shortPublicKey}
              hint="shortened form only — the full address is never displayed"
            />
          ) : null}

          {approvedTeamWallet !== null && wallet.status !== 'connected' ? (
            <div className="wizard-preview__policy">
              {wallet.walletsDetected ? (
                <>
                  <p className="wizard-preview__fieldnote">
                    {TEAM_ADMIN_ADD_TOKEN_CONFIG.connectPrompt}
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
                  {TEAM_ADMIN_ADD_TOKEN_CONFIG.noWalletsDetected}
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
              {TEAM_ADMIN_ADD_TOKEN_CONFIG.disconnectLabel}
            </button>
          ) : null}

          {wallet.errorMessage ? (
            <p className="wizard-preview__fieldwarning">{wallet.errorMessage}</p>
          ) : null}
        </div>

        <div className="wizard-preview__step">
          <p className="wizard-preview__header">{TEAM_ADMIN_ADD_TOKEN_CONFIG.capacityTitle}</p>
          <MetricRow
            label={TEAM_ADMIN_ADD_TOKEN_CONFIG.capacityConfirmedLabel}
            value={
              capacity.chainCount === null
                ? '—'
                : `${capacity.chainCount} / ${REDAX_TEAM_ADMIN_MAX_TOKEN_CONFIGS}`
            }
            hint="what the chain reports for the selected campaign"
          />
          <MetricRow
            label={TEAM_ADMIN_ADD_TOKEN_CONFIG.capacityRemainingLabel}
            value={capacity.remaining === null ? '—' : String(capacity.remaining)}
          />
          <MetricRow
            label={TEAM_ADMIN_ADD_TOKEN_CONFIG.capacityDraftLabel}
            value={String(capacity.unsentDraftCount)}
            hint="unsent rows occupy no chain capacity"
          />
          <MetricRow
            label={TEAM_ADMIN_ADD_TOKEN_CONFIG.capacitySlotLabel}
            value={capacity.mutationSlotOccupied ? 'occupied or unread' : 'free'}
          />
          <p className="wizard-preview__fieldnote">{TEAM_ADMIN_ADD_TOKEN_CONFIG.capacityNote}</p>
        </div>

        {/*
          IT CARRIES NO CONTROL. There is no submit, no retry and no edit anywhere inside it
          — every affordance in this panel is declared in the two places the structural tests
          count, and this is not one of them.
        */}
        {recoveryRow !== null ? (
          <div className="wizard-preview__step">
            <p className="wizard-preview__header">{TEAM_ADMIN_ADD_TOKEN_CONFIG.recoveryTitle}</p>
            <p className="wizard-preview__purpose">
              {TEAM_ADMIN_ADD_TOKEN_CONFIG.recoveryIntro}
            </p>
            <div className="wizard-preview__stephead">
              <StatusPill
                label={TEAM_ADMIN_ADD_TOKEN_CONFIG.recoveryLabel[recoveryRow.outcome]}
                tone={
                  recoveryRow.outcome === 'CONFIRMED'
                    ? 'positive'
                    : recoveryRow.outcome === 'SUBMITTED'
                      ? 'caution'
                      : 'neutral'
                }
              />
            </div>
            <p className="wizard-preview__purpose">
              {TEAM_ADMIN_ADD_TOKEN_CONFIG.recoveryNote[recoveryRow.outcome]}
            </p>
            <MetricRow
              label="Input token (shortened)"
              value={shortenAddress(recoveryRow.legacyMint)}
              hint="the accepted input this saved attempt described"
            />
            {recoveryRow.tokenConfig !== null ? (
              <MetricRow
                label={TEAM_ADMIN_ADD_TOKEN_CONFIG.derivedAddressLabel}
                value={shortenAddress(recoveryRow.tokenConfig)}
                hint={TEAM_ADMIN_ADD_TOKEN_CONFIG.derivedAddressHint}
              />
            ) : null}
          </div>
        ) : null}

        <div className="wizard-preview__step">
          <p className="wizard-preview__header">{TEAM_ADMIN_ADD_TOKEN_CONFIG.draftTitle}</p>
          <p className="wizard-preview__draftnotice">{TEAM_ADMIN_ADD_TOKEN_CONFIG.draftNotice}</p>
          <p className="wizard-preview__fieldnote">
            {TEAM_ADMIN_ADD_TOKEN_CONFIG.draftControlNote}
          </p>
          {draftError ? <p className="wizard-preview__fieldwarning">{draftError}</p> : null}

          {judgedRows.length === 0 ? (
            <p className="wizard-preview__purpose">{TEAM_ADMIN_ADD_TOKEN_CONFIG.draftEmpty}</p>
          ) : null}

        {/*
          THE VISIBLE SOL LINE AND ITS EXPLICIT READ-ONLY RE-CHECK. They appear together and
          only while the balance is not a plain known-sufficient one — a hidden button explains
          nothing, and a sufficient balance needs no sentence and no amount.

          The button is READ-ONLY and is NOT a mutation transaction action: this panel's
          transaction-control count is unchanged by it.
        */}
        {addTokenConfigSolPreflightNote !== null ? (
          <div className="wizard-preview__policy">
            <p className="wizard-preview__fieldnote">{addTokenConfigSolPreflightNote}</p>
            <button
              className="wallet-badge__btn"
              disabled={!addTokenConfigSolPreflightActionable || busy || addTokenConfigSolPreflight.kind === 'reading'}
              onClick={handleAddTokenConfigSolPreflightRecheck}
              type="button"
            >
              {TEAM_ADMIN_SOL_PREFLIGHT_RECHECK_LABEL}
            </button>
          </div>
        ) : null}

          {judgedRows.map((judged, index) => {
            const rowId = judged.draft.rowId
            const disposition = judged.disposition
            const submitEnabled =
              disposition.submitAdmissible &&
              judged.validRow !== null &&
              authorityConfirmed &&
              walletConnectedMatch &&
              // Stated again beside the disposition rather than left implicit in it: a
              // refused refresh disables every submit, and reading it here means the
              // control cannot be enabled even if the row machine were ever to change
              // its mind about what a refusal implies.
              !chainTruth.freshReadRefused &&
              !busy &&
              addTokenConfigSolPreflightSufficient
            return (
              <div className="wizard-preview__field" key={rowId}>
                <div className="wizard-preview__stephead">
                  <StatusPill
                    label={
                      disposition.state === null
                        ? 'Blocked'
                        : TEAM_ADMIN_ADD_TOKEN_CONFIG.rowStateLabel[disposition.state]
                    }
                    tone={
                      disposition.state === 'CONFIRMED'
                        ? 'positive'
                        : disposition.state === 'SUBMITTED'
                          ? 'caution'
                          : 'neutral'
                    }
                  />
                </div>
                <p className="wizard-preview__purpose">
                  {disposition.state === null
                    ? disposition.blocking === null
                      ? TEAM_ADMIN_ADD_TOKEN_CONFIG.blockingNote.ROW_NOT_ADMISSIBLE
                      : TEAM_ADMIN_ADD_TOKEN_CONFIG.blockingNote[disposition.blocking]
                    : TEAM_ADMIN_ADD_TOKEN_CONFIG.rowStateNote[disposition.state]}
                </p>

                <div className="wizard-preview__fieldbody">
                  {TEAM_ADMIN_ADD_TOKEN_CONFIG.fields.map((field) => {
                    const inputId = `redax-team-add-token-config-${rowId}-${field.id}`
                    return (
                      <div className="wizard-preview__field" key={field.id}>
                        <label className="wizard-preview__fieldname" htmlFor={inputId}>
                          {field.label}
                        </label>
                        <input
                          className="wizard-preview__input"
                          disabled={busy || disposition.state === 'CONFIRMED'}
                          id={inputId}
                          inputMode="text"
                          onChange={(event) => {
                            updateDraft(rowId, field.id, event.target.value)
                          }}
                          type="text"
                          value={judged.draft[field.id]}
                        />
                        <p className="wizard-preview__fieldnote">{field.note}</p>
                      </div>
                    )
                  })}
                </div>

                {judged.validRow !== null ? (
                  <MetricRow
                    label={TEAM_ADMIN_ADD_TOKEN_CONFIG.derivedAddressLabel}
                    value={shortenAddress(judged.validRow.tokenConfig)}
                    hint={TEAM_ADMIN_ADD_TOKEN_CONFIG.derivedAddressHint}
                  />
                ) : null}

                {judged.issues.length > 0 ? (
                  <ul className="wizard-preview__policylist">
                    {judged.issues.map((rowIssue) => (
                      <li key={`${rowIssue.field}-${rowIssue.code}`}>
                        {`${rowIssue.field}: ${TEAM_ADMIN_ADD_TOKEN_CONFIG.issueNote[rowIssue.code]}`}
                      </li>
                    ))}
                  </ul>
                ) : null}

                <div className="wizard-preview__stepfoot">
                  <button
                    className="wallet-badge__btn"
                    disabled={busy}
                    onClick={() => {
                      removeDraftRow(rowId)
                    }}
                    type="button"
                  >
                    {TEAM_ADMIN_ADD_TOKEN_CONFIG.removeRowLabel}
                  </button>
                  <button
                    className="wallet-badge__btn"
                    disabled={busy || index === 0}
                    onClick={() => {
                      moveDraftRow(rowId, index - 1)
                    }}
                    type="button"
                  >
                    {TEAM_ADMIN_ADD_TOKEN_CONFIG.moveUpLabel}
                  </button>
                  <button
                    className="wallet-badge__btn"
                    disabled={busy || index === judgedRows.length - 1}
                    onClick={() => {
                      moveDraftRow(rowId, index + 1)
                    }}
                    type="button"
                  >
                    {TEAM_ADMIN_ADD_TOKEN_CONFIG.moveDownLabel}
                  </button>

                  {/*
                    MUTATION-ACTION CONTROL 1 of 2. It is declared exactly once in this
                    file, inside the row it acts on, so a click can only ever carry the
                    one row it was rendered for. There is no submit-all control, no
                    next-row chaining and no retry affordance anywhere beside it.
                  */}
                  <button
                    className="wallet-badge__btn"
                    disabled={!submitEnabled}
                    onClick={() => {
                      const target = judged.validRow
                      if (target === null) {
                        return
                      }
                      void handleSubmitRow(target)
                    }}
                    type="button"
                  >
                    {operation === 'submit'
                      ? TEAM_ADMIN_ADD_TOKEN_CONFIG.submitActionBusyLabel
                      : TEAM_ADMIN_ADD_TOKEN_CONFIG.submitActionLabel}
                  </button>
                  <p className="wizard-preview__fieldnote">
                    {submitEnabled
                      ? TEAM_ADMIN_ADD_TOKEN_CONFIG.submitActionHelp
                      : TEAM_ADMIN_ADD_TOKEN_CONFIG.submitActionBlockedHelp}
                  </p>
                </div>
              </div>
            )
          })}

          <button
            className="wallet-badge__btn"
            disabled={busy || draftRows.length >= REDAX_TEAM_ADMIN_MAX_TOKEN_CONFIGS}
            onClick={() => {
              addDraftRow()
            }}
            type="button"
          >
            {TEAM_ADMIN_ADD_TOKEN_CONFIG.addRowLabel}
          </button>
        </div>

        <div className="wizard-preview__stepfoot">
          {/*
            MUTATION-ACTION CONTROL 2 of 2. It reconciles the saved attempt and re-reads
            it, and it is the only affordance offered once a row is past the point where a
            submission may already have reached the network.
          */}
          <button
            className="wallet-badge__btn"
            disabled={busy || approvedTeamWallet === null}
            onClick={() => {
              void handleCheckStatus()
            }}
            type="button"
          >
            {operation === 'status'
              ? TEAM_ADMIN_ADD_TOKEN_CONFIG.statusActionBusyLabel
              : TEAM_ADMIN_ADD_TOKEN_CONFIG.statusActionLabel}
          </button>
          <p className="wizard-preview__fieldnote">
            {TEAM_ADMIN_ADD_TOKEN_CONFIG.statusActionHelp}
          </p>
          <p className="wizard-preview__purpose">{statusSummary}</p>
          {chainTruth.freshReadRefused ? (
            <p className="wizard-preview__fieldwarning">
              {TEAM_ADMIN_ADD_TOKEN_CONFIG.blockingNote.CHAIN_TRUTH_UNAVAILABLE}
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
            <p className="wizard-preview__header">{TEAM_ADMIN_ADD_TOKEN_CONFIG.resultTitle}</p>
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
                ? TEAM_ADMIN_ADD_TOKEN_CONFIG.anotherMutationRunning
                : describeRedaxTeamAdminMutationSubmitCode(submitResult.code)}
            </p>
          </div>
        ) : null}

        <div className="wizard-preview__claims">
          <p className="wizard-preview__header">{TEAM_ADMIN_ADD_TOKEN_CONFIG.nonClaimsTitle}</p>
          <ul>
            {TEAM_ADMIN_ADD_TOKEN_CONFIG.nonClaims.map((claim) => (
              <li key={claim}>{claim}</li>
            ))}
          </ul>
        </div>
      </div>
    </SurfaceCard>
  )
}
