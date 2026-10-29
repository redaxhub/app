// REDAX product shell. Five role surfaces behind local view state — no router
// dependency, no readiness claim, and no screen that owns an action of its own. The
// "Stage 0" reading of this module described a static shell with no data source, no
// wallet and no action, and it is superseded on every one of those points; the module
// is still a shell in the only sense that matters, which is that it owns no action.
// Every role surface — Home / AppShell, Holder, Token team, Admin, and
// Observer — reads the App-facing RedaxDataSource provider, which resolves at
// runtime to MOCK_LOCAL, to the config-injected read-only devnet adapter, or to a
// typed config-error source when the public config is invalid. All three devnet
// modes (DEVNET_READONLY / DEVNET_WALLET_READONLY / DEVNET_TX_ENABLED) read the
// same devnet data; an earlier note here called DEVNET_TX_ENABLED a
// recognized-but-blocked mode that resolved to a config-error source, and that is
// superseded — it resolves to the devnet adapter like the other two. This module
// owns the app load boundary only: it loads environment first, then mode-aware
// data. MOCK_LOCAL keeps its full required-read behavior; in the read-only devnet
// modes holder eligibility and receipts are intentionally deferred/unavailable, so
// the surfaces render partial readonly state honestly — never a mock fallback and
// never fabricated holder/receipt data. TWO modes mount the REDAX wallet shell:
// DEVNET_WALLET_READONLY, for wallet connection context only (user-initiated
// connect/disconnect, no signing path, no transaction action), and
// DEVNET_TX_ENABLED, which additionally mounts the customer session provider, the
// session-verified Team/Admin S1 root (`RedaxCustomerTeamRoots`) and the wallet action
// bridge. The one Team surface is the Team workspace screen: a customer signs in with Sign
// In With Solana, keeps private drafts in the REDAX customer service, reviews ONE frozen plan
// and runs the existing transaction roots step by step from it; the post-init mutation
// provider is mounted inside that workspace. Source is not live execution.
// Screens never see the wallet facade in any of them: every action lives inside an opaque
// slot this module constructs and passes down, and this module invokes none of them itself.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { AppShell, type ShellNavItem } from './components/AppShell'
import { AdminOverviewScreen } from './screens/AdminOverviewScreen'
import { HolderTrialScreen } from './screens/HolderTrialScreen'
import { HomeScreen, type CampaignSortMode, type CampaignStatusFilter } from './screens/HomeScreen'
import { ObserverProofScreen } from './screens/ObserverProofScreen'
import { TokenTeamTrialScreen } from './screens/TokenTeamTrialScreen'
import { createRedaxDataSource, resolveRedaxRuntimeActionConfig } from './data/redaxDataSourceProvider'
import { isDevnetProgramMode } from './data/redaxModePredicates'
import { selectRedaxTokenConfig } from './lib/redaxTokenConfigSelection'
import { RedaxWalletProvider, useRedaxWallet } from './wallet/RedaxWalletProvider'
import { RedaxWalletControls } from './wallet/RedaxWalletControls'
import { RedaxWalletActionsProvider } from './wallet/RedaxWalletActions'
import { RedaxHolderPrepareControls } from './wallet/RedaxHolderPrepareControls'
import { RedaxHolderConvertControls } from './wallet/RedaxHolderConvertControls'
import {
  parseRedaxCampaignLinkQuery,
  readRedaxAppBaseUrl,
  readRedaxLocationSearch,
  replaceRedaxCampaignLinkInLocation,
} from './lib/redaxPublicLinks'
import { RedaxCustomerSessionProvider } from './customer/CustomerSessionProvider'
import { RedaxCustomerTeamRoots } from './customer/CustomerTeamRoots'
import { CustomerWorkspace } from './customer/CustomerWorkspace'
import { SurfaceCard } from './components/SurfaceCard'
import type { RedaxDataSource } from './data/redaxDataSource'
import type { RedaxDataMode } from './data/redaxModes'
import type {
  RedaxCampaignInputSummaryView,
  RedaxCampaignView,
  RedaxConnectedWalletHolderContextView,
  RedaxDirectoryRowView,
  RedaxEnvironmentView,
  RedaxHolderEligibilityView,
  RedaxHolderView,
  RedaxProjectView,
  RedaxReceiptView,
  RedaxTokenConfigView,
  RedaxWalletRoleContextView,
} from './data/redaxViewModels'

type ScreenId = 'home' | 'team-workspace' | 'holder-trial' | 'token-team-trial' | 'admin-overview' | 'observer-proof'

const NAV_ITEMS: readonly (ShellNavItem & { id: ScreenId })[] = [
  { id: 'home', label: 'Overview', hint: 'Migration directory' },
  // Customer self-service (2026-10-23): a customer's own campaigns. Offered only where the
  // wallet providers are mounted (DEVNET_TX_ENABLED); see the nav filter in App.
  { id: 'team-workspace', label: 'Team workspace', hint: 'Your campaigns' },
  { id: 'holder-trial', label: 'Holder trial', hint: 'Conversion decision surface' },
  { id: 'token-team-trial', label: 'Token team trial', hint: 'Devnet evaluation path' },
  { id: 'admin-overview', label: 'Admin overview', hint: 'Campaign lifecycle state' },
  { id: 'observer-proof', label: 'Observer proof', hint: 'Receipts and verification' },
]

// Default selections give the multi-project holder and an open flagship
// migration, so the directory, eligibility, and quote surfaces are populated
// on first paint. The default campaign is a MOCK_LOCAL fixture id and is never a
// curated devnet listing: in the devnet modes it simply does not match a loaded
// campaign, and the display fallback below answers for it.
const DEFAULT_HOLDER_ID = 'holder-multi'
const DEFAULT_CAMPAIGN_ID = 'campaign-astrapup'

// Error copy shown when a required RedaxDataSource read does not return its data.
// Used for a failed required read in any renderable mode — MOCK_LOCAL, or the
// core read-only devnet program/RPC reads — never a mock-type fallback.
// Mode-neutral wording: it names the configured data source, not a mode, so it
// is truthful wherever it renders.
const REDAX_LOAD_ERROR =
  'Data load failed — the configured data source did not return the required data.'

// Discriminated Home/AppShell + Holder + Token team + Admin + Observer data
// state, loaded from the App-facing RedaxDataSource provider (MOCK_LOCAL or a
// read-only devnet mode). Every role surface reads this state; none reads the
// mock selectors directly.
type RedaxData =
  | { status: 'loading' }
  | {
      status: 'ready'
      environment: RedaxEnvironmentView
      holderProfiles: readonly RedaxHolderView[]
      selectedHolder: RedaxHolderView | null
      directoryRows: readonly RedaxDirectoryRowView[]
      featuredCampaigns: readonly RedaxCampaignView[]
      selectedCampaign: RedaxCampaignView | null
      selectedProject: RedaxProjectView | null
      holderLabel: string
      eligibility: RedaxHolderEligibilityView | null
      defaultDisplayFocusTokenConfig: RedaxTokenConfigView | null
      tokenConfigs: readonly RedaxTokenConfigView[]
      campaigns: readonly RedaxCampaignView[]
      unpersonalizedDirectoryRows: readonly RedaxDirectoryRowView[]
      campaignInputSummaries: readonly RedaxCampaignInputSummaryView[]
      projects: readonly RedaxProjectView[]
      receipts: readonly RedaxReceiptView[]
      // The campaign id actually used to resolve selectedCampaign / token configs /
      // input summary and passed to the screens. Decided by the ONE derivation
      // `deriveRedaxEffectiveSelectedCampaignId`: MOCK_LOCAL and every UNLISTED
      // selection get the raw id back unchanged; a LISTED devnet selection the loaded
      // list cannot find falls back to the first loaded campaign (or '') for DISPLAY.
      effectiveSelectedCampaignId: string
      // The input summary of the CURRENT WORKSPACE, which is a different fact from the
      // curated `campaignInputSummaries` above and is deliberately kept apart from it.
      // A campaign nobody curated has no row in the global array and must still be able
      // to show its own accepted inputs; folding it into that array would have made an
      // unlisted campaign a member of the curated set, which is exactly the admission
      // this route refuses to grant by accident.
      selectedInputSummary: RedaxCampaignInputSummaryView | null
    }
  | { status: 'error'; message: string }

// The DEFAULT DISPLAY focus, and nothing more. Precedence unchanged: the
// eligibility-selected config when an eligibility result is present (MOCK_LOCAL), else the
// campaign's primary accepted input, else the first accepted input, else none. Eligibility
// is a nullable parameter so the eligibility?. lookup stays well-typed in the read-only
// devnet modes, where eligibility is null and no hard dereference is allowed.
function deriveRedaxDefaultDisplayFocusTokenConfig(
  tokenConfigs: readonly RedaxTokenConfigView[],
  eligibility: RedaxHolderEligibilityView | null,
): RedaxTokenConfigView | null {
  return (
    tokenConfigs.find((config) => config.id === eligibility?.selectedTokenConfigId) ??
    tokenConfigs.find((config) => config.isPrimary) ??
    tokenConfigs[0] ??
    null
  )
}

// A conversion burns real tokens, and exactly one accepted input decides which ones. The
// three functions below are the whole of that decision in App, and they are deliberately
// pure, exported and free of React so they can be run rather than only read.
//
// THE SPLIT THEY EXIST TO ENFORCE. Which input the page SHOWS and which input a
// conversion would BURN used to be the same value: the display default above flowed
// straight into the convert control, so a holder who never chose anything still had a
// TokenConfig armed for them. It is now two values. The default above remains DISPLAY
// truth and reaches no action; only an explicit human choice, re-resolved against the
// current load through the app's one selection resolver, may reach the convert control.
//
// NONE OF THIS IS AUTHORIZATION. An explicit choice is product intent — it names which
// accepted input a later, separately gated conversion would use. It is not a program
// authorization, not a wallet approval, not a signature and not a conversion; the frozen
// convert control and the wallet action bridge remain the entire transaction corridor.

/**
 * The holder's explicit accepted-input choice. Memory only, and deliberately TWO ids.
 *
 * It carries the campaign as well as the TokenConfig because a TokenConfig id alone is not
 * a selection: the same id under another campaign is another account, and a choice made
 * under one campaign must never survive into another.
 *
 * It stores IDS rather than the loaded objects for the same reason. A stored view could go
 * stale against a later load and still look authoritative, so every render re-resolves the
 * ids against the CURRENT loaded set; a choice that no longer resolves simply stops being
 * one. Nothing else belongs here — no wallet, amount, balance, signature, receipt, journal
 * id, timestamp, mode, campaign object or TokenConfig object — and it is never persisted,
 * so a reload starts with no selection, which is the correct starting state.
 */
export interface RedaxHolderExplicitTokenConfigSelectionV1 {
  readonly campaignId: string
  readonly tokenConfigId: string
}

/** The campaign facts an accepted-input choice is judged against. */
export interface RedaxHolderCampaignContext {
  /** The campaign the human actually selected. */
  readonly selectedCampaignId: string
  /** The campaign the load actually resolved — possibly the `campaigns[0]` fallback. */
  readonly effectiveSelectedCampaignId: string
  /** The campaign that was loaded under that effective id. */
  readonly selectedCampaign: RedaxCampaignView | null
}

/** What one render needs to decide whether an accepted input is armed. */
export interface RedaxHolderExplicitActionInput extends RedaxHolderCampaignContext {
  readonly explicitTokenConfigSelection: RedaxHolderExplicitTokenConfigSelectionV1 | null
  readonly tokenConfigs: readonly RedaxTokenConfigView[]
}

/** What one selector click needs to be judged. */
export interface RedaxHolderSelectionGestureInput extends RedaxHolderCampaignContext {
  readonly requestedTokenConfigId: string
  readonly tokenConfigs: readonly RedaxTokenConfigView[]
}

/**
 * Is the campaign context EXACT — the same campaign three times over?
 *
 * `effectiveSelectedCampaignId` may be the `campaigns[0]` FALLBACK the read-only devnet
 * load substitutes when the current selection is not a loaded campaign. That fallback is
 * legitimate DISPLAY truth and always has been. It must never become BURN authority: a
 * holder looking at a campaign they did not select must not be able to arm an input of it,
 * and an input armed under the selection must not silently re-point at a fallback.
 *
 * So all three must agree: the raw selection, the effective id the load resolved, and the
 * loaded campaign's own id. Any disagreement is not a campaign a choice may be made for.
 */
export function isRedaxHolderExactCampaignContext(input: RedaxHolderCampaignContext): boolean {
  const { selectedCampaignId, effectiveSelectedCampaignId, selectedCampaign } = input
  return (
    selectedCampaignId !== '' &&
    selectedCampaignId === effectiveSelectedCampaignId &&
    selectedCampaign !== null &&
    selectedCampaign.id === effectiveSelectedCampaignId
  )
}

/**
 * The accepted input a conversion may be built for RIGHT NOW, or nothing.
 *
 * Re-derived every render from the current load, never remembered. It runs the app's ONE
 * selection resolver — `selectRedaxTokenConfig`, which requires an explicitly named id and
 * refuses to invent one — and every refusal it can return lands here as `null`:
 * `NO_TOKEN_CONFIG_REQUESTED`, `TOKEN_CONFIG_NOT_FOUND`, `TOKEN_CONFIG_WRONG_CAMPAIGN` and
 * `TOKEN_CONFIG_DUPLICATE_ID` alike. There is NO fallback behind any of them — not the
 * primary input, not the first input, not the nearest, and not the same legacy mint under
 * another campaign. A holder whose choice stopped resolving has no armed input, which is
 * the outcome that cannot burn the wrong token.
 */
export function resolveRedaxHolderExplicitActionTokenConfig(
  input: RedaxHolderExplicitActionInput,
): RedaxTokenConfigView | null {
  const { explicitTokenConfigSelection, selectedCampaignId, tokenConfigs } = input
  if (explicitTokenConfigSelection === null) {
    return null
  }
  if (!isRedaxHolderExactCampaignContext(input)) {
    return null
  }
  // A choice is bound to the campaign it was made under. Returning to that exact campaign
  // may reuse it; another campaign never inherits it.
  if (explicitTokenConfigSelection.campaignId !== selectedCampaignId) {
    return null
  }
  const result = selectRedaxTokenConfig({
    campaignId: selectedCampaignId,
    requestedTokenConfigId: explicitTokenConfigSelection.tokenConfigId,
    candidates: tokenConfigs,
    // No `eligibleTokenConfigIds`: holder balance and convert eligibility are the frozen
    // convert control's question, not this one. No `expectedLegacyMint`: no independent
    // authoritative expected mint exists here, and inventing one would make the guard a
    // fiction rather than a check.
  })
  if (!result.ok) {
    return null
  }
  // Back to the CURRENT view for the accepted id — and only if it is unique there. The
  // resolver already refuses a duplicated id, so this re-proves uniqueness at the exact
  // step that hands a concrete TokenConfig to a transaction-capable control rather than
  // trusting that the two arrays agreed.
  const matches = tokenConfigs.filter((config) => config.id === result.selection.tokenConfigId)
  return matches.length === 1 ? matches[0] : null
}

/**
 * What ONE selector click makes the explicit choice, or `null`.
 *
 * Pure: it validates and returns the next selection state and does nothing else. No read,
 * no wallet, no prepare, no convert, no journal, no storage, no reconcile and no submit
 * happens because a holder chose an input — choosing is a local product gesture, and the
 * whole of its effect is the value this function returns.
 *
 * A click made while the campaign context is not exact establishes NOTHING and clears what
 * was there. A `campaigns[0]` fallback must not become selection authority just because a
 * row under it was clicked.
 */
export function nextRedaxHolderExplicitTokenConfigSelection(
  input: RedaxHolderSelectionGestureInput,
): RedaxHolderExplicitTokenConfigSelectionV1 | null {
  const { requestedTokenConfigId, selectedCampaignId, tokenConfigs } = input
  if (!isRedaxHolderExactCampaignContext(input)) {
    return null
  }
  const result = selectRedaxTokenConfig({
    campaignId: selectedCampaignId,
    requestedTokenConfigId,
    candidates: tokenConfigs,
  })
  if (!result.ok) {
    return null
  }
  return {
    campaignId: selectedCampaignId,
    tokenConfigId: result.selection.tokenConfigId,
  }
}

// A campaign selection used to be one string, and one string cannot answer the question
// that matters here: whether the human is looking at something the deployment PUBLISHED or
// at something they NAMED. Those two need different failure behaviour, so they are now
// different states of one discriminated value.
//
// It is MEMORY ONLY, exactly like the holder's accepted-input choice. No localStorage, no
// sessionStorage, no IndexedDB, no URL, no router and no server: a reload returns to the
// default listed selection, and an unlisted workspace is reached again only by naming its
// address again. That is a deliberate cost, not an oversight — persistence would make a
// warned, explicitly adopted, unreviewed address sticky without anybody choosing it twice.

/** Which campaign the human is looking at, and how they got there. Memory only. */
export interface RedaxCampaignSelectionV1 {
  /**
   * `LISTED` — chosen from the deployment's curated public directory.
   * `UNLISTED` — named exactly by address, and NOT in that directory.
   *
   * This is LOCAL UI INTENT and nothing else. It queries no chain, proves no existence,
   * grants no authority and lists nothing: an `UNLISTED` value is a request to inspect an
   * address, and a later by-address read is the only thing that can say what is there.
   */
  readonly kind: 'LISTED' | 'UNLISTED'
  readonly campaignId: string
}

/** The global facts an effective-selection derivation is judged against. */
export interface RedaxCampaignSelectionGlobalContext {
  readonly isMockLocal: boolean
  readonly campaigns: readonly { readonly id: string }[]
}

/**
 * THE ONE effective-selection derivation. Pure, total, and the only algorithm of its kind.
 *
 * There used to be a single rule — keep the selection when the loaded list contains it, else
 * `campaigns[0]`, else `''` — and it was correct for a curated directory and WRONG for an
 * address somebody typed. An unlisted campaign is by definition absent from the curated list,
 * so the old rule would have answered every explicit address request with a different
 * campaign entirely, silently, and the screens would have rendered that substitution as
 * though it were what was asked for.
 *
 * So the UNLISTED arm has NO FALLBACK AT ALL. It returns the exact requested id, and if
 * nothing resolves under it the surfaces render an unresolved request honestly rather than
 * somebody else's campaign. The LISTED fallback survives untouched and stays exactly what it
 * always was: DISPLAY truth, never burn authority, never mutation authority — every action
 * surface still receives the RAW selection alongside this one and refuses unless the two,
 * and the loaded campaign's own id, all agree.
 */
export function deriveRedaxEffectiveSelectedCampaignId(
  global: RedaxCampaignSelectionGlobalContext,
  campaignSelection: RedaxCampaignSelectionV1,
): string {
  if (global.isMockLocal) {
    return campaignSelection.campaignId
  }
  if (campaignSelection.kind === 'UNLISTED') {
    return campaignSelection.campaignId
  }
  if (global.campaigns.some((campaign) => campaign.id === campaignSelection.campaignId)) {
    return campaignSelection.campaignId
  }
  if (global.campaigns.length > 0) {
    return global.campaigns[0].id
  }
  return ''
}

/**
 * How an EXACTLY NAMED address enters the selection. Pure.
 *
 * The classification is local UI intent and reads nothing: an address the curated list
 * already names is simply that listed campaign, and any other address is an unlisted
 * request. Nothing here consults the chain, admits anything to the directory, or decides
 * that the address is a REDAX Campaign — it decides only which of the two selection kinds
 * the human's own gesture produced.
 */
export function deriveRedaxCampaignSelectionForAdoptedAddress(
  campaigns: readonly { readonly id: string }[],
  campaignId: string,
): RedaxCampaignSelectionV1 {
  return campaigns.some((campaign) => campaign.id === campaignId)
    ? { kind: 'LISTED', campaignId }
    : { kind: 'UNLISTED', campaignId }
}

/**
 * The two honest things that can be said about an unlisted selection, and the exact facts
 * that separate them.
 *
 * A canonical 32-byte Solana address is a WELL-FORMED ADDRESS. It is not evidence that an
 * account exists, that the account is owned by the REDAX program, or that it is a Campaign.
 * So the warning has two phases and the copy differs:
 *
 *   `requested` — the human named an address and nothing has resolved under it yet. The
 *     surface must not call it a Campaign, because nothing has said it is one.
 *   `resolved`  — a campaign actually loaded, its own id equals the named address, and the
 *     effective id equals it too. Only then is "an unlisted Campaign workspace" a fact.
 *
 * Neither phase says reviewed, verified, endorsed, approved, safe, unsafe or legitimate,
 * and neither lists anything.
 */
export type RedaxUnlistedCampaignPhase = 'requested' | 'resolved'

/** What one render needs to decide which unlisted phase, if either, is true. */
export interface RedaxUnlistedCampaignPhaseInput {
  readonly campaignSelection: RedaxCampaignSelectionV1
  readonly effectiveSelectedCampaignId: string
  readonly selectedCampaign: RedaxCampaignView | null
}

export function deriveRedaxUnlistedCampaignPhase(
  input: RedaxUnlistedCampaignPhaseInput,
): RedaxUnlistedCampaignPhase | null {
  const { campaignSelection, effectiveSelectedCampaignId, selectedCampaign } = input
  if (campaignSelection.kind !== 'UNLISTED') {
    return null
  }
  const proven =
    selectedCampaign !== null &&
    selectedCampaign.id === campaignSelection.campaignId &&
    effectiveSelectedCampaignId === campaignSelection.campaignId
  return proven ? 'resolved' : 'requested'
}

interface WalletRoleContextBridgeProps {
  dataSource: RedaxDataSource
  mode: RedaxDataMode | null
  activeCampaignId: string
  onRoleContext: (context: RedaxWalletRoleContextView | null) => void
  onHolderContext: (context: RedaxConnectedWalletHolderContextView | null) => void
}

function WalletRoleContextBridge({
  dataSource,
  mode,
  activeCampaignId,
  onRoleContext,
  onHolderContext,
}: WalletRoleContextBridgeProps) {
  const wallet = useRedaxWallet()
  const connectedKey = wallet.status === 'connected' ? wallet.publicKeyBase58 : null
  useEffect(() => {
    if (mode !== 'DEVNET_WALLET_READONLY') {
      onRoleContext(null)
      return
    }
    if (connectedKey === null) {
      onRoleContext({ status: 'unconnected', shortPublicKey: null, matchedRoles: [] })
      return
    }
    let cancelled = false
    async function loadRoleContext(walletKey: string) {
      const result = await dataSource.getConnectedWalletRoleContext({
        mode: 'DEVNET_WALLET_READONLY',
        connectedWallet: walletKey,
        activeCampaignId: activeCampaignId === '' ? undefined : activeCampaignId,
      })
      if (cancelled) {
        return
      }
      onRoleContext(
        result.ok
          ? result.data
          : { status: 'unavailable', shortPublicKey: null, matchedRoles: [] },
      )
    }
    void loadRoleContext(connectedKey)
    return () => {
      cancelled = true
    }
  }, [dataSource, mode, connectedKey, activeCampaignId, onRoleContext])

  useEffect(() => {
    if (mode !== 'DEVNET_WALLET_READONLY') {
      onHolderContext(null)
      return
    }
    if (connectedKey === null) {
      onHolderContext({
        status: 'unconnected',
        shortPublicKey: null,
        campaignId: null,
        legacyInputBalances: [],
        outputAta: null,
      })
      return
    }
    let cancelled = false
    async function loadHolderContext(walletKey: string) {
      const result = await dataSource.getConnectedWalletHolderContext({
        mode: 'DEVNET_WALLET_READONLY',
        connectedWallet: walletKey,
        activeCampaignId: activeCampaignId === '' ? undefined : activeCampaignId,
      })
      if (cancelled) {
        return
      }
      onHolderContext(
        result.ok
          ? result.data
          : {
              status: 'unavailable',
              shortPublicKey: null,
              campaignId: null,
              legacyInputBalances: [],
              outputAta: null,
            },
      )
    }
    void loadHolderContext(connectedKey)
    return () => {
      cancelled = true
    }
  }, [dataSource, mode, connectedKey, activeCampaignId, onHolderContext])
  return null
}

// --- Load orchestration: one GLOBAL load, one SELECTION load -------------------
//
// These two used to be a single effect keyed on `selectedCampaignId`, so choosing a
// campaign refetched the whole directory — holder profiles, directory rows, featured
// campaigns, the campaign list, projects and every per-campaign input summary — none
// of which depend on which campaign is selected. On a public unkeyed devnet endpoint
// that doubled the request burst for a click that needed a couple of reads, and
// getProgramAccounts is the first method such an endpoint rate-limits.
//
// The split is by DEPENDENCY, not by convenience: what a selection cannot change
// loads once per data source and holder, and what it can change loads per selection.
// Both are plain async functions taking their data source as a parameter, so what
// each one reads is a fact about the function rather than about a React effect.

/** The selection-independent half of the App load. */
type RedaxGlobalData =
  | { status: 'loading' }
  | {
      status: 'ready'
      environment: RedaxEnvironmentView
      isMockLocal: boolean
      holderProfiles: readonly RedaxHolderView[]
      selectedHolder: RedaxHolderView | null
      holderLabel: string
      directoryRows: readonly RedaxDirectoryRowView[]
      unpersonalizedDirectoryRows: readonly RedaxDirectoryRowView[]
      featuredCampaigns: readonly RedaxCampaignView[]
      campaigns: readonly RedaxCampaignView[]
      campaignInputSummaries: readonly RedaxCampaignInputSummaryView[]
      projects: readonly RedaxProjectView[]
      receipts: readonly RedaxReceiptView[]
    }
  | { status: 'error'; message: string }

/** The half that depends on which campaign is selected. */
type RedaxSelectionData =
  | { status: 'loading' }
  | {
      status: 'ready'
      effectiveSelectedCampaignId: string
      selectedCampaign: RedaxCampaignView | null
      selectedProject: RedaxProjectView | null
      eligibility: RedaxHolderEligibilityView | null
      tokenConfigs: readonly RedaxTokenConfigView[]
      /**
       * The selected campaign's accepted-input summary, as a SELECTION fact.
       *
       * It used to be looked up in the global curated array at render time, which
       * silently assumed every selectable campaign was a curated one. An unlisted
       * campaign has no such row, and the assumption rendered as "no accepted inputs"
       * for a campaign that may have ten. It is loaded here instead, reusing the global
       * row whenever one already exists so a curated selection costs no extra read.
       */
      readonly selectedInputSummary: RedaxCampaignInputSummaryView | null
    }
  | { status: 'error'; message: string }

const REDAX_LOAD_FAILED: { status: 'error'; message: string } = {
  status: 'error',
  message: REDAX_LOAD_ERROR,
}

/**
 * The selection-independent load. Reads nothing that a campaign click can change.
 *
 * MOCK_LOCAL keeps its full required-read graph, including the holder-personalized
 * directory and the per-campaign receipts. The read-only devnet modes keep theirs:
 * one unpersonalized directory read for both slots, no mock-holder ref, and no
 * eligibility or receipts (deliberately deferred, never fabricated).
 */
export async function loadRedaxGlobalData(
  dataSource: RedaxDataSource,
  selectedHolderId: string,
): Promise<RedaxGlobalData> {
  // Environment first: it carries the resolved mode and gates the config-error data
  // source an invalid public config resolves to (whose getEnvironment fails).
  const environmentResult = await dataSource.getEnvironment()
  if (!environmentResult.ok) {
    return REDAX_LOAD_FAILED
  }
  const environment = environmentResult.data
  const isMockLocal = environment.mode === 'MOCK_LOCAL'
  const isDevnetProgram = isDevnetProgramMode(environment.mode)
  if (!isMockLocal && !isDevnetProgram) {
    // Defensive only: an unknown/unsupported mode fails earlier at getEnvironment.
    return REDAX_LOAD_FAILED
  }

  // MOCK_LOCAL personalizes the directory by holder and therefore needs BOTH a
  // personalized and an unpersonalized read. The read-only devnet modes have no
  // holder personalization in this slice, so one unpersonalized read serves both
  // directory slots — the same promise, not a second request.
  const directoryRowsRequest = isMockLocal
    ? dataSource.getDirectoryRows({ kind: 'mock-holder', holderId: selectedHolderId })
    : dataSource.getDirectoryRows()
  const unpersonalizedDirectoryRowsRequest = isMockLocal
    ? dataSource.getDirectoryRows()
    : directoryRowsRequest
  const [
    holderProfilesResult,
    directoryRowsResult,
    featuredResult,
    campaignsResult,
    unpersonalizedDirectoryRowsResult,
    projectsResult,
  ] = await Promise.all([
    dataSource.getHolderProfiles(),
    directoryRowsRequest,
    dataSource.getFeaturedCampaigns(),
    dataSource.getCampaigns(),
    unpersonalizedDirectoryRowsRequest,
    dataSource.getProjects(),
  ])
  if (
    !holderProfilesResult.ok ||
    !directoryRowsResult.ok ||
    !featuredResult.ok ||
    !campaignsResult.ok ||
    !unpersonalizedDirectoryRowsResult.ok ||
    !projectsResult.ok
  ) {
    return REDAX_LOAD_FAILED
  }
  const campaigns = campaignsResult.data

  const inputSummaryResults = await Promise.all(
    campaigns.map((campaign) => dataSource.getCampaignInputSummary(campaign.id)),
  )
  if (inputSummaryResults.some((result) => !result.ok)) {
    return REDAX_LOAD_FAILED
  }
  const campaignInputSummaries = inputSummaryResults
    .map((result) => (result.ok ? result.data : null))
    .filter((summary): summary is RedaxCampaignInputSummaryView => summary !== null)

  // Receipts stay a MOCK_LOCAL-only required read; the devnet modes surface none.
  let receipts: readonly RedaxReceiptView[] = []
  if (isMockLocal) {
    const receiptResults = await Promise.all(
      campaigns.map((campaign) => dataSource.getReceiptsForCampaign(campaign.id)),
    )
    if (receiptResults.some((result) => !result.ok)) {
      return REDAX_LOAD_FAILED
    }
    receipts = receiptResults.flatMap((result) => (result.ok ? result.data : []))
  }

  const holderProfiles = holderProfilesResult.data
  const selectedHolder = holderProfiles.find((holder) => holder.id === selectedHolderId) ?? null
  return {
    status: 'ready',
    environment,
    isMockLocal,
    holderProfiles,
    selectedHolder,
    holderLabel: selectedHolder?.label ?? 'no holder selected',
    directoryRows: directoryRowsResult.data,
    unpersonalizedDirectoryRows: unpersonalizedDirectoryRowsResult.data,
    featuredCampaigns: featuredResult.data,
    campaigns,
    campaignInputSummaries,
    projects: projectsResult.data,
    receipts,
  }
}

/**
 * The selection-dependent load. Touches no directory, featured, campaign-list,
 * project-list or holder-profile read — those are the global load's.
 *
 * THE ONE EXCEPTION, AND IT IS DELIBERATE. `getCampaignInputSummary` is now a
 * CONDITIONAL selection member: the global load still reads one per CURATED campaign,
 * and this load reuses that row whenever it exists, so a curated selection issues no
 * extra call at all. It calls the member only for a campaign the curated set does not
 * carry — which is exactly an explicitly named unlisted workspace — and the adapter's
 * in-flight registries de-duplicate the underlying campaign and token-config reads it
 * shares with the two calls beside it. No new data-source method, no new adapter, no
 * new `Connection`, and no global reload.
 *
 * `campaigns[0]` remains exactly what it was: a DISPLAY fallback, decided by the one
 * effective-selection derivation, used only for a LISTED selection the loaded list does
 * not contain, and only in the devnet modes. It is never the authoritative target, and
 * an UNLISTED selection never reaches it.
 */
export async function loadRedaxSelectionData(
  dataSource: RedaxDataSource,
  global: Extract<RedaxGlobalData, { status: 'ready' }>,
  campaignSelection: RedaxCampaignSelectionV1,
  selectedHolderId: string,
): Promise<RedaxSelectionData> {
  // Effective selected campaign id WITHOUT mutating selection state, through the ONE
  // derivation. There is no second algorithm here or anywhere else.
  const selectedCampaignId = campaignSelection.campaignId
  const effectiveSelectedCampaignId = deriveRedaxEffectiveSelectedCampaignId(
    global,
    campaignSelection,
  )
  // The curated row for this selection, if the global load already carries one. A
  // curated campaign always does; an unlisted one never does, by construction.
  const curatedInputSummary =
    global.campaignInputSummaries.find(
      (summary) => summary.campaignId === effectiveSelectedCampaignId,
    ) ?? null

  if (global.isMockLocal) {
    const [campaignResult, eligibilityResult, tokenConfigsResult] = await Promise.all([
      dataSource.getCampaignById(selectedCampaignId),
      dataSource.getHolderEligibilityForCampaign(
        { kind: 'mock-holder', holderId: selectedHolderId },
        selectedCampaignId,
      ),
      dataSource.getTokenConfigsForCampaign(selectedCampaignId),
    ])
    if (!campaignResult.ok || !eligibilityResult.ok || !tokenConfigsResult.ok) {
      return REDAX_LOAD_FAILED
    }
    const selectedCampaign = campaignResult.data
    let selectedProject: RedaxProjectView | null = null
    if (selectedCampaign && selectedCampaign.projectId) {
      const projectResult = await dataSource.getProjectById(selectedCampaign.projectId)
      if (!projectResult.ok) {
        return REDAX_LOAD_FAILED
      }
      selectedProject = projectResult.data
    }
    return {
      status: 'ready',
      effectiveSelectedCampaignId,
      selectedCampaign,
      selectedProject,
      eligibility: eligibilityResult.data,
      tokenConfigs: tokenConfigsResult.data,
      // MOCK_LOCAL stays fixture-compatible: the matching global row, and no extra read.
      // The Campaign carrier reaches nothing in this arm.
      selectedInputSummary: curatedInputSummary,
    }
  }

  // Devnet modes: selected-campaign reads only when an effective campaign
  // id exists; a real readonly RPC/decode failure here stays a blocking load error.
  let selectedCampaign: RedaxCampaignView | null = null
  let tokenConfigs: readonly RedaxTokenConfigView[] = []
  let selectedInputSummary: RedaxCampaignInputSummaryView | null = curatedInputSummary
  if (effectiveSelectedCampaignId !== '') {
    // The summary request is issued ONLY when the curated set has no row for this
    // selection. It runs in the SAME selection operation as the two reads beside it, so
    // the adapter's in-flight registries serve one campaign read and one token-config
    // read between all three rather than three of each.
    const summaryRequest =
      curatedInputSummary === null
        ? dataSource.getCampaignInputSummary(effectiveSelectedCampaignId)
        : null
    const [campaignResult, tokenConfigsResult, summaryResult] = await Promise.all([
      dataSource.getCampaignById(effectiveSelectedCampaignId),
      dataSource.getTokenConfigsForCampaign(effectiveSelectedCampaignId),
      summaryRequest,
    ])
    if (!campaignResult.ok || !tokenConfigsResult.ok) {
      return REDAX_LOAD_FAILED
    }
    if (summaryResult !== null) {
      if (!summaryResult.ok) {
        // Fail closed, exactly as the two reads beside it do. A required selected read
        // that did not answer is a load error, never a silently empty workspace.
        return REDAX_LOAD_FAILED
      }
      // A truthful `null` from the source stays `null`: an address with no campaign
      // behind it has no summary, and inventing an empty one would describe a campaign
      // that is not there as one with no accepted inputs.
      selectedInputSummary = summaryResult.data
    }
    selectedCampaign = campaignResult.data
    tokenConfigs = tokenConfigsResult.data
  }
  let selectedProject: RedaxProjectView | null = null
  if (selectedCampaign && selectedCampaign.projectId) {
    const projectResult = await dataSource.getProjectById(selectedCampaign.projectId)
    if (!projectResult.ok) {
      return REDAX_LOAD_FAILED
    }
    selectedProject = projectResult.data
  }
  return {
    status: 'ready',
    effectiveSelectedCampaignId,
    selectedCampaign,
    selectedProject,
    // Holder eligibility is intentionally deferred in the devnet modes.
    eligibility: null,
    tokenConfigs,
    selectedInputSummary,
  }
}

/**
 * May a finished selection load still be applied?
 *
 * A slower earlier selection must never overwrite a newer one. React's cleanup flag
 * already drops a superseded run, and this generation check is the second, explicit
 * guard: the answer is compared against the generation that was current when the
 * read STARTED, so an out-of-order resolution is discarded on its own evidence
 * rather than on effect-teardown timing.
 */
export function isCurrentSelectionGeneration(started: number, current: number): boolean {
  return started === current
}

/** Fold the two halves back into the single view state every screen already reads. */
export function combineRedaxData(
  global: RedaxGlobalData,
  selection: RedaxSelectionData,
): RedaxData {
  if (global.status === 'error') {
    return { status: 'error', message: global.message }
  }
  if (selection.status === 'error') {
    return { status: 'error', message: selection.message }
  }
  if (global.status === 'loading' || selection.status === 'loading') {
    return { status: 'loading' }
  }
  return {
    status: 'ready',
    environment: global.environment,
    holderProfiles: global.holderProfiles,
    selectedHolder: global.selectedHolder,
    directoryRows: global.directoryRows,
    featuredCampaigns: global.featuredCampaigns,
    selectedCampaign: selection.selectedCampaign,
    selectedProject: selection.selectedProject,
    holderLabel: global.holderLabel,
    eligibility: selection.eligibility,
    defaultDisplayFocusTokenConfig: deriveRedaxDefaultDisplayFocusTokenConfig(
      selection.tokenConfigs,
      selection.eligibility,
    ),
    tokenConfigs: selection.tokenConfigs,
    campaigns: global.campaigns,
    unpersonalizedDirectoryRows: global.unpersonalizedDirectoryRows,
    campaignInputSummaries: global.campaignInputSummaries,
    projects: global.projects,
    receipts: global.receipts,
    effectiveSelectedCampaignId: selection.effectiveSelectedCampaignId,
    // TWO SEPARATE FACTS, KEPT SEPARATE. `campaignInputSummaries` above is the GLOBAL
    // CURATED set and is not appended to here; this is the CURRENT WORKSPACE's own
    // summary. An unlisted campaign's summary must never become a member of the curated
    // set just because somebody opened it.
    selectedInputSummary: selection.selectedInputSummary,
  }
}

/**
 * The environment that governs the WALLET PROVIDER SUBTREE, derived from the GLOBAL
 * half alone.
 *
 * Screen-data readiness and provider lifecycle are different questions. The combined
 * RedaxData is deliberately `loading` while a selection-only refresh is in flight —
 * that is what keeps the surfaces truthful — but the wallet providers hold connection
 * state (selected wallet, attached adapter listeners, connected public key) that no
 * campaign selection can invalidate. Gating the subtree on the combined state unmounted
 * it on every selection refresh and discarded that state; gating it here keeps it
 * mounted across `ready -> loading -> ready` and `ready -> loading -> error` selection
 * transitions, while the screens still render the selection honestly.
 *
 * It is a pure function of the CURRENT global state and remembers nothing: a global
 * load or a global error is `null`, so no stale mode can keep a provider mounted.
 */
export function deriveProviderEnvironment(global: RedaxGlobalData): RedaxEnvironmentView | null {
  return global.status === 'ready' ? global.environment : null
}

/**
 * Why ONE bounded product refresh could not establish fresh chain truth. VALUE-FREE.
 *
 * RE-DECLARED HERE rather than imported from the setup panel, exactly as the product copy
 * re-declares the key unions it describes. App may take the PROVIDER and the opaque PANEL
 * from the Team/Admin tree and nothing else — a third binding would make the mount a
 * consumer of that tree — and the JSX site below is where the two declarations are compared:
 * a divergence between them stops this file compiling.
 */
export type RedaxFreshCampaignSetupTruthCode =
  | 'CAMPAIGN_READ_REFUSED'
  | 'CAMPAIGN_ABSENT'
  | 'CAMPAIGN_IDENTITY_MISMATCH'
  | 'TOKEN_CONFIG_READ_REFUSED'

/** What ONE bounded product refresh produced. Closed, and fail-closed. */
export type RedaxFreshCampaignSetupTruthResult =
  | {
      readonly ok: true
      readonly campaign: RedaxCampaignView
      readonly tokenConfigs: readonly RedaxTokenConfigView[]
    }
  | { readonly ok: false; readonly code: RedaxFreshCampaignSetupTruthCode }

/**
 * ONE bounded product refresh of the campaign a post-init mutation surface is about.
 *
 * WHY IT EXISTS. The selection load above takes a snapshot when a campaign is chosen, and
 * a post-init mutation changes exactly the accounts in that snapshot. So the snapshot may
 * PREDATE the attempt it would be used to judge, and the campaign setup panel refuses to
 * confirm a row or to re-enter `PREPARED` from it. This is the panel's only route to a
 * reading it may call fresh, and it performs NEW `RedaxDataSource` invocations every time
 * it is called — it never returns App's current state.
 *
 * WHAT IT IS NOT. It reuses the two read methods the contract already declares and adds no
 * data-source API, no adapter, no `Connection` and no second read path. It takes no wallet,
 * builds nothing, signs nothing, sends nothing, transitions no journal record and starts no
 * attempt. It is exported as a module-level function so it can be exercised against injected
 * readers rather than only inspected.
 *
 * WHAT IT RETURNS. A sanitized product snapshot — the same view models every screen already
 * renders — or one bounded, VALUE-FREE refusal code. No transport error, no endpoint and no
 * raw message crosses this boundary; a refusal says only that the reading did not happen,
 * and the panel fails closed on it.
 */
export async function readRedaxFreshCampaignSetupTruth(
  dataSource: RedaxDataSource,
  campaignId: string,
): Promise<RedaxFreshCampaignSetupTruthResult> {
  const [campaignResult, tokenConfigsResult] = await Promise.all([
    dataSource.getCampaignById(campaignId),
    dataSource.getTokenConfigsForCampaign(campaignId),
  ])
  if (!campaignResult.ok) {
    return { ok: false, code: 'CAMPAIGN_READ_REFUSED' }
  }
  if (!tokenConfigsResult.ok) {
    return { ok: false, code: 'TOKEN_CONFIG_READ_REFUSED' }
  }
  const campaign = campaignResult.data
  if (campaign === null) {
    return { ok: false, code: 'CAMPAIGN_ABSENT' }
  }
  // The read is answered FOR the campaign that was asked about, or not at all. A source
  // that resolved something else has not refreshed this selection, and a fallback here
  // would be exactly the `campaigns[0]` shape the whole surface refuses.
  if (campaign.id !== campaignId) {
    return { ok: false, code: 'CAMPAIGN_IDENTITY_MISMATCH' }
  }
  return { ok: true, campaign, tokenConfigs: tokenConfigsResult.data }
}

/**
 * Why ONE bounded CAMPAIGN-ONLY refresh refused. THREE members, and no fourth.
 *
 * RE-DECLARED HERE rather than imported from the lifecycle panel, exactly as the setup
 * union above is. App may take the PROVIDER and the opaque PANELS from the Team/Admin tree
 * and nothing else; the JSX site below is where the two declarations are compared, and a
 * divergence between them stops this file compiling.
 *
 * IT IS DELIBERATELY ONE MEMBER SHORTER THAN ITS SETUP SIBLING. There is no
 * `TOKEN_CONFIG_READ_REFUSED` here, because the reader below never enumerates a campaign's
 * accepted inputs — see the note on the function itself.
 */
export type RedaxFreshCampaignLifecycleTruthCode =
  | 'CAMPAIGN_READ_REFUSED'
  | 'CAMPAIGN_ABSENT'
  | 'CAMPAIGN_IDENTITY_MISMATCH'

/** What ONE bounded campaign-only refresh produced. Closed, and fail-closed. */
export type RedaxFreshCampaignLifecycleTruthResult =
  | { readonly ok: true; readonly campaign: RedaxCampaignView }
  | { readonly ok: false; readonly code: RedaxFreshCampaignLifecycleTruthCode }

/**
 * ONE bounded CAMPAIGN-ONLY refresh, for the post-init lifecycle surface.
 *
 * WHY IT IS SEPARATE FROM `readRedaxFreshCampaignSetupTruth`. That reader answers for the
 * three surfaces whose admission genuinely depends on a campaign's accepted inputs, and it
 * fetches them alongside the campaign — so a token-config read that refuses makes the whole
 * refresh refuse, which is correct THERE. It would be wrong here: `pause_campaign`,
 * `unpause_campaign` and `finalize_campaign` have NO accepted-input prerequisite in the
 * program and none in the product either, so letting a token-config enumeration failure
 * block a pause would be inventing a dependency that does not exist. This reader therefore
 * calls `getCampaignById` and NOTHING else — no `getTokenConfigsForCampaign`, and no second
 * read of any kind.
 *
 * WHAT IT IS NOT. It reuses the ONE read method the contract already declares and adds no
 * data-source API, no adapter method, no `Connection`, no cache, no storage and no second
 * read path. It takes no wallet, builds nothing, signs nothing, sends nothing, transitions
 * no journal record and starts no attempt. It performs a NEW `RedaxDataSource` invocation
 * every time it is called and never returns App's current state.
 *
 * WHAT IT RETURNS. A sanitized product snapshot — the same view model every screen already
 * renders — or one bounded, VALUE-FREE refusal code. No transport error, no endpoint, no
 * exception text, no account bytes and no wallet data crosses this boundary; a refusal says
 * only that the reading did not happen, and the panel fails closed on it.
 *
 * THIS IS PRODUCT FRESHNESS AND NOT MUTATION AUTHORITY. The mutation action root performs
 * its own authority-grade reads and decides admission from those.
 */
export async function readRedaxFreshCampaignLifecycleTruth(
  dataSource: RedaxDataSource,
  campaignId: string,
): Promise<RedaxFreshCampaignLifecycleTruthResult> {
  const campaignResult = await dataSource.getCampaignById(campaignId)
  if (!campaignResult.ok) {
    return { ok: false, code: 'CAMPAIGN_READ_REFUSED' }
  }
  const campaign = campaignResult.data
  if (campaign === null) {
    return { ok: false, code: 'CAMPAIGN_ABSENT' }
  }
  // The read is answered FOR the campaign that was asked about, or not at all. A source
  // that resolved something else has not refreshed this selection, and a fallback here
  // would be exactly the `campaigns[0]` shape the whole surface refuses.
  if (campaign.id !== campaignId) {
    return { ok: false, code: 'CAMPAIGN_IDENTITY_MISMATCH' }
  }
  return { ok: true, campaign }
}

export function App() {
  const [activeScreenId, setActiveScreenId] = useState<ScreenId>('home')
  // The mounted Team workspace's own leave check (filled by it, emptied when it goes): the menu
  // leaves the workspace only through it, so an unsaved draft is never dropped without a choice.
  const workspaceLeave = useRef<((proceed: () => void) => void) | null>(null)
  // The campaign selection — memory only, never persisted, and DISCRIMINATED.
  //
  // It starts as a LISTED default because that is what a first paint of a curated
  // directory is. Nothing is read from storage, a URL or a router to produce it, so a
  // reload always starts here: an unlisted workspace somebody adopted is reached again
  // only by naming its exact address again, which is the point rather than a limitation.
  const [campaignSelection, setCampaignSelection] = useState<RedaxCampaignSelectionV1>({
    kind: 'LISTED',
    campaignId: DEFAULT_CAMPAIGN_ID,
  })
  // The RAW human/local intent, and the value every action surface receives as its raw
  // selection. It is deliberately NOT the effective id derived further down: keeping the
  // two apart is what makes a display fallback unable to enable a mutation or a burn.
  const selectedCampaignId = campaignSelection.campaignId
  const [selectedHolderId, setSelectedHolderId] = useState<string>(DEFAULT_HOLDER_ID)
  const [campaignStatusFilter, setCampaignStatusFilter] = useState<CampaignStatusFilter>('all')
  const [campaignSortMode, setCampaignSortMode] = useState<CampaignSortMode>('priority')
  // The holder's EXPLICIT accepted-input choice — memory only, never persisted, and the
  // ONLY thing that may reach the convert control's `tokenConfig` prop. It starts `null`,
  // which is a real product state and not a missing one: before a human clicks, no accepted
  // input is selected for conversion, including when the campaign has exactly one.
  //
  // It is two ids and nothing else (see `RedaxHolderExplicitTokenConfigSelectionV1`), so no
  // wallet, amount, receipt or loaded object can hide inside a selection, and every render
  // re-resolves it against the current load rather than trusting it.
  const [explicitTokenConfigSelection, setExplicitTokenConfigSelection] =
    useState<RedaxHolderExplicitTokenConfigSelectionV1 | null>(null)

  // --- Demo customer flow (2026-10-22): share link, bounded refresh, planned prefill -------
  //
  // THE SHARE LINK IS A PREFILL, READ ONCE. `?campaign=<address>` is parsed from the page
  // address at mount and handed to the by-address control as a pre-filled value. It selects
  // nothing, reads nothing and connects nothing by itself: a person still presses Open, and
  // the same strict by-address chain read decides what is there. This SUPERSEDES the earlier
  // "no URL, no router" reading on exactly that point — the selection itself stays memory
  // only, and the address bar is only updated AFTER an explicit selection.
  const campaignLinkQuery = useMemo(() => parseRedaxCampaignLinkQuery(readRedaxLocationSearch()), [])

  // One App-facing RedaxDataSource for the component lifecycle, resolved once from
  // env: MOCK_LOCAL, any of the three devnet program-data modes (DEVNET_READONLY /
  // DEVNET_WALLET_READONLY / DEVNET_TX_ENABLED, which share one read-only adapter),
  // or a typed config-error source when the public config is invalid.
  const redaxDataSource = useMemo(() => createRedaxDataSource(), [])
  // THE BUILD-TIME TEAM CARRIER IS NO LONGER READ HERE (customer self-service, 2026-10-23).
  // The positive Team identity for both Team/Admin roots is now the wallet the customer
  // service verified by Sign In With Solana and that is connected right now; it is supplied
  // inside the wallet subtree by `RedaxCustomerTeamRoots`, never by App and never by the
  // environment. Which operations that identity may run is the service's per-operation
  // decision, enforced at the roots' write gate.
  // The ONE canonical runtime program id, resolved once from the same canonical resolver
  // the mutation action root uses and injected at the same boundary as the carrier. It is
  // a PUBLIC deployment fact, never a user input and never derived from campaign data, and
  // it is `null` whenever the configuration is unusable — which the setup panel fails
  // closed on exactly as it does on a missing carrier. App reads no environment itself.
  const teamAdminRuntimeProgramId: string | null = useMemo(() => {
    const runtime = resolveRedaxRuntimeActionConfig()
    return runtime.ok ? runtime.programId : null
  }, [])
  // The ONE bounded product refresh handed to the campaign setup panel.
  //
  // It closes over the SAME `RedaxDataSource` every other read on this mount uses, so
  // there is no second adapter, no second `Connection` and no second endpoint. App never
  // calls it: it is passed down, and the panel invokes it from its explicit status click
  // and from nowhere else. Nothing here runs on mount, on render or on a selection.
  const readFreshCampaignSetupTruth = useCallback(
    (campaignId: string): Promise<RedaxFreshCampaignSetupTruthResult> =>
      readRedaxFreshCampaignSetupTruth(redaxDataSource, campaignId),
    [redaxDataSource],
  )
  // The ONE bounded CAMPAIGN-ONLY refresh handed to the campaign lifecycle panel.
  //
  // It closes over the SAME `RedaxDataSource` every other read on this mount uses, so there
  // is no second adapter, no second `Connection` and no second endpoint. App never calls it:
  // it is passed down, and the panel invokes it from its explicit status click and from its
  // three pre-submit freshness checks, and from nowhere else. Nothing here runs on mount, on
  // render or on a selection.
  const readFreshCampaignLifecycleTruth = useCallback(
    (campaignId: string): Promise<RedaxFreshCampaignLifecycleTruthResult> =>
      readRedaxFreshCampaignLifecycleTruth(redaxDataSource, campaignId),
    [redaxDataSource],
  )
  const [globalData, setGlobalData] = useState<RedaxGlobalData>({ status: 'loading' })
  const [selectionData, setSelectionData] = useState<RedaxSelectionData>({ status: 'loading' })
  // Monotonic selection counter. Only the newest selection may publish its answer.
  const selectionGenerationRef = useRef(0)
  // Monotonic id of the newest selection READ — the selection load and every bounded refresh
  // share it. Within ONE selection two reads can overlap (an automatic refresh after a verified
  // mutation and a person's "Check and refresh", or two mutations' refreshes), so the generation
  // alone cannot order them: only the newest read may publish data, loading/error or "Last
  // checked", and an older answer — success or failure — is dropped when it arrives late.
  const selectionReadRef = useRef(0)
  // DEVNET_WALLET_READONLY connected-wallet role context, resolved by the
  // provider-subtree bridge below (null outside that mode or before resolution).
  const [walletRoleContext, setWalletRoleContext] = useState<RedaxWalletRoleContextView | null>(null)
  const [walletHolderContext, setWalletHolderContext] =
    useState<RedaxConnectedWalletHolderContextView | null>(null)

  // App load boundary, split by DEPENDENCY.
  //
  // GLOBAL: environment, holder profiles, directory, featured, campaigns, projects
  // and every per-campaign input summary. None of these can change because a
  // different campaign was selected, so this effect is NOT keyed on the selection
  // and a campaign click no longer refetches the whole directory.
  //
  // SELECTION: the selected campaign, its token configs, its project and (MOCK_LOCAL
  // only) holder eligibility. Keyed on the selection, and gated on the global load
  // being ready because the effective-selection fallback needs the loaded campaign
  // list. Every result is checked via `.ok`; a failed required read becomes a local
  // error state — never a mock-type fallback and never a Redax-view-to-Mock
  // conversion. MOCK_LOCAL keeps its full required-read behavior. The read-only
  // devnet modes never pass a mock-holder ref into a devnet read and do not request
  // holder eligibility or receipts (intentionally deferred/unavailable); their core
  // program/RPC reads stay blocking.
  useEffect(() => {
    let cancelled = false
    setGlobalData({ status: 'loading' })
    async function loadGlobal() {
      const result = await loadRedaxGlobalData(redaxDataSource, selectedHolderId)
      if (cancelled) {
        return
      }
      setGlobalData(result)
    }
    void loadGlobal()
    return () => {
      cancelled = true
    }
  }, [redaxDataSource, selectedHolderId])

  useEffect(() => {
    if (globalData.status !== 'ready') {
      // Nothing selectable is known yet; the combined view stays loading or carries
      // the global error. No selection read is issued against an unknown campaign set.
      setSelectionData({ status: 'loading' })
      return
    }
    let cancelled = false
    const generation = selectionGenerationRef.current + 1
    selectionGenerationRef.current = generation
    const read = selectionReadRef.current + 1
    selectionReadRef.current = read
    setSelectionData({ status: 'loading' })
    async function loadSelection(readyGlobal: Extract<RedaxGlobalData, { status: 'ready' }>) {
      const result = await loadRedaxSelectionData(
        redaxDataSource,
        readyGlobal,
        campaignSelection,
        selectedHolderId,
      )
      if (cancelled) {
        return
      }
      // A slower earlier selection — or a read a later refresh superseded — must never
      // overwrite a newer one.
      if (
        !isCurrentSelectionGeneration(generation, selectionGenerationRef.current) ||
        read !== selectionReadRef.current
      ) {
        return
      }
      setSelectionData(result)
    }
    void loadSelection(globalData)
    return () => {
      cancelled = true
    }
    // Keyed on the WHOLE discriminated selection, not on the id alone: the same id under
    // a different kind is a different question, and answering it with the previous
    // answer would show a listed fallback under an explicitly named address.
  }, [redaxDataSource, selectedHolderId, campaignSelection, globalData])

  // The single view state every screen already reads, folded from the two halves.
  const redaxData: RedaxData = useMemo(
    () => combineRedaxData(globalData, selectionData),
    [globalData, selectionData],
  )

  // Derived Home/AppShell + Holder + Token team + Admin view state. Empty/null
  // fallbacks keep the screen props total while loading or after a load error; each
  // surface shows its own loading/error framing.
  //
  // Everything below — `environment` included — is SCREEN-scoped and folds BOTH halves,
  // so a selection-only refresh correctly shows as loading and no stale selection is
  // ever rendered as freshly ready. The wallet provider subtree is a separate question
  // and uses the global-scoped environment derived further down.
  const redaxReady = redaxData.status === 'ready' ? redaxData : null
  const environment: RedaxEnvironmentView | null = redaxReady?.environment ?? null
  const holderProfiles = redaxReady?.holderProfiles ?? []
  const selectedHolder = redaxReady?.selectedHolder ?? null
  const directoryRows = redaxReady?.directoryRows ?? []
  const featuredCampaigns = redaxReady?.featuredCampaigns ?? []
  const selectedCampaign = redaxReady?.selectedCampaign ?? null
  const selectedProject = redaxReady?.selectedProject ?? null
  const holderLabel = redaxReady?.holderLabel ?? 'no holder selected'
  const eligibility = redaxReady?.eligibility ?? null
  const defaultDisplayFocusTokenConfig = redaxReady?.defaultDisplayFocusTokenConfig ?? null
  const tokenConfigs = redaxReady?.tokenConfigs ?? []
  const campaigns = redaxReady?.campaigns ?? []
  const unpersonalizedDirectoryRows = redaxReady?.unpersonalizedDirectoryRows ?? []
  const campaignInputSummaries = redaxReady?.campaignInputSummaries ?? []
  const projects = redaxReady?.projects ?? []
  const receipts = redaxReady?.receipts ?? []
  // The campaign id the load effect actually resolved (MOCK_LOCAL and every UNLISTED
  // selection: the raw id; a LISTED devnet selection the loaded list does not carry: the
  // display fallback). Drives the selectedCampaignId prop passed to each screen — never
  // the raw selection an action surface is judged against.
  const effectiveSelectedCampaignId = redaxReady?.effectiveSelectedCampaignId ?? selectedCampaignId
  // SELECTION-SCOPED, and no longer a lookup in the curated array. The load decides it —
  // reusing the curated row when one exists, reading it once when one does not — so a
  // campaign nobody curated can still show its own accepted inputs without becoming a
  // member of the curated set.
  const selectedInputSummary = redaxReady?.selectedInputSummary ?? null
  const isLoading = redaxData.status === 'loading'
  const loadError = redaxData.status === 'error' ? redaxData.message : null

  // --- the ONE exact-campaign fact, derived once and shared --------------------------
  //
  // `effectiveSelectedCampaignId` may be the `campaigns[0]` DISPLAY fallback a read-only
  // devnet load substitutes when the selection is not a loaded campaign. That fallback is
  // legitimate display truth and never action authority — so this boolean withholds the
  // transaction-capable Prepare slot ENTIRELY rather than merely emptying a prop inside a
  // control that is still mounted and could resolve fallback state of its own.
  const holderCampaignSelectionIsExact = isRedaxHolderExactCampaignContext({
    selectedCampaignId,
    effectiveSelectedCampaignId,
    selectedCampaign,
  })

  // --- accepted input: what a conversion may use, and what the page merely shows ------
  //
  // Two values, derived in this order on purpose. `explicitActionTokenConfig` is the
  // holder's explicit choice re-resolved against the CURRENT load, and it is the only value
  // wired to a transaction-capable control. `displayFocusedTokenConfig` is what the detail
  // rows show, and it follows the explicit choice whenever there is one — so the rate, the
  // decimals, the focused row, the preview and the conversion request are all the same
  // accepted input, and the screen can never describe one input while the action holds
  // another. Only when nothing is explicitly chosen does the display fall back to the
  // default focus, which reaches no action.
  const explicitActionTokenConfig = resolveRedaxHolderExplicitActionTokenConfig({
    explicitTokenConfigSelection,
    selectedCampaignId,
    effectiveSelectedCampaignId,
    selectedCampaign,
    tokenConfigs,
  })
  const displayFocusedTokenConfig = explicitActionTokenConfig ?? defaultDisplayFocusTokenConfig

  // The public directory's one selection gesture. Every listed/directory click goes
  // through it, and it REPLACES the whole discriminated selection rather than editing an
  // id inside it — so clicking a curated card while an unlisted workspace is open cannot
  // leave the previous UNLISTED kind attached to a listed campaign.
  function handleSelectListedCampaign(campaignId: string): void {
    setCampaignSelection({ kind: 'LISTED', campaignId })
    // An explicit choice may be reflected in the address bar (same path, no reload).
    replaceRedaxCampaignLinkInLocation(campaignId)
  }

  // An EXACTLY NAMED address entering the selection. The adoption control has already
  // trimmed and canonicalized what the human typed; this decides only which kind the
  // gesture produced, against the curated list App already holds.
  //
  // It reads no account, opens no wallet, signs nothing, sends nothing, authorizes
  // nothing and lists nothing: an address the curated set does not name stays UNLISTED
  // until a by-address read establishes what is actually there.
  function handleAdoptCampaignAddress(campaignId: string): void {
    setCampaignSelection(deriveRedaxCampaignSelectionForAdoptedAddress(campaigns, campaignId))
    replaceRedaxCampaignLinkInLocation(campaignId)
  }

  // The Team workspace's "Open holder view": the exact campaign address enters the selection
  // through the same adoption rule as a typed address, and the Holder screen is shown. It reads
  // no account, connects no wallet and signs nothing; listing is unaffected.
  function handleOpenHolderView(campaignId: string): void {
    handleAdoptCampaignAddress(campaignId)
    setActiveScreenId('holder-trial')
  }

  // Which of the two honest unlisted statements, if either, this render may make. Pure,
  // derived from the current load, and remembered nowhere.
  const unlistedCampaignPhase = deriveRedaxUnlistedCampaignPhase({
    campaignSelection,
    effectiveSelectedCampaignId,
    selectedCampaign,
  })

  // The holder's one selection gesture. It computes the next explicit choice and sets it —
  // that is the whole of what a click does. Nothing here reads an account, connects or asks
  // a wallet, prepares, converts, reconciles, writes a journal record, persists anything or
  // submits: choosing which accepted input a later conversion would use is a local product
  // decision, and the separately gated convert step remains the only thing that can burn.
  //
  // It is deliberately not memoized. Its inputs are the freshly derived campaign and
  // TokenConfig values of THIS render, and a stale closure over an earlier campaign is
  // exactly the mistake the exact-campaign check exists to make impossible.
  function handleSelectTokenConfig(tokenConfigId: string): void {
    setExplicitTokenConfigSelection(
      nextRedaxHolderExplicitTokenConfigSelection({
        requestedTokenConfigId: tokenConfigId,
        selectedCampaignId,
        effectiveSelectedCampaignId,
        selectedCampaign,
        tokenConfigs,
      }),
    )
  }

  function renderScreen(teamAdminActionSlot: ReactNode, teamWorkspace: ReactNode) {
    switch (activeScreenId) {
      case 'home':
        return (
          <HomeScreen
            environment={environment}
            directoryRows={directoryRows}
            featuredCampaigns={featuredCampaigns}
            selectedCampaign={selectedCampaign}
            selectedProject={selectedProject}
            selectedCampaignId={effectiveSelectedCampaignId}
            statusFilter={campaignStatusFilter}
            sortMode={campaignSortMode}
            holderLabel={holderLabel}
            isLoading={isLoading}
            loadError={loadError}
            onStatusFilterChange={setCampaignStatusFilter}
            onSortModeChange={setCampaignSortMode}
            onSelectCampaign={handleSelectListedCampaign}
            onAdoptUnlistedCampaign={handleAdoptCampaignAddress}
            campaignLinkQuery={campaignLinkQuery}
            explorerCluster={environment?.cluster ?? null}
          />
        )
      case 'holder-trial':
        return (
          <HolderTrialScreen
            environment={environment}
            holderProfiles={holderProfiles}
            selectedHolder={selectedHolder}
            selectedHolderId={selectedHolderId}
            directoryRows={directoryRows}
            selectedCampaign={selectedCampaign}
            selectedProject={selectedProject}
            selectedCampaignId={effectiveSelectedCampaignId}
            eligibility={eligibility}
            tokenConfigs={tokenConfigs}
            displayFocusedTokenConfig={displayFocusedTokenConfig}
            selectedForConversionTokenConfigId={explicitActionTokenConfig?.id ?? null}
            campaignSelectionIsExact={holderCampaignSelectionIsExact}
            onSelectTokenConfig={handleSelectTokenConfig}
            walletHolderContext={walletHolderContext}
            prepareOutputAtaSlot={
              // ADMISSION, not decoration. An inexact campaign context yields NO Prepare
              // slot at all: a stale LISTED selection that fell back to `campaigns[0]`, a
              // selection still loading, and a loaded campaign that is not the selected one
              // each withhold the control rather than mounting it against fallback state.
              environment?.mode === 'DEVNET_TX_ENABLED' && holderCampaignSelectionIsExact ? (
                <RedaxHolderPrepareControls
                  isDevnetTxEnabled
                  dataSource={redaxDataSource}
                  campaign={selectedCampaign}
                  activeCampaignId={effectiveSelectedCampaignId}
                />
              ) : undefined
            }
            convertPreviewSlot={
              environment?.mode === 'DEVNET_TX_ENABLED' ? (
                <RedaxHolderConvertControls
                  isDevnetTxEnabled
                  dataSource={redaxDataSource}
                  campaign={selectedCampaign}
                  tokenConfig={explicitActionTokenConfig}
                  activeCampaignId={effectiveSelectedCampaignId}
                />
              ) : undefined
            }
            isLoading={isLoading}
            loadError={loadError}
            onSelectHolder={setSelectedHolderId}
            onSelectCampaign={handleSelectListedCampaign}
          />
        )
      case 'team-workspace':
        return teamWorkspace ?? null
      case 'token-team-trial':
        // walletRoleContext is the context the existing bridge resolves, passed
        // down unchanged so the Token Team surface can display it read-only. It
        // is null outside DEVNET_WALLET_READONLY, and this prop introduces no
        // new read, effect, or provider.
        return (
          <TokenTeamTrialScreen
            environment={environment}
            selectedCampaign={selectedCampaign}
            selectedProject={selectedProject}
            selectedCampaignId={effectiveSelectedCampaignId}
            directoryRows={unpersonalizedDirectoryRows}
            inputSummary={selectedInputSummary}
            walletRoleContext={walletRoleContext}
            teamAdminActionSlot={teamAdminActionSlot}
            isLoading={isLoading}
            loadError={loadError}
            onSelectCampaign={handleSelectListedCampaign}
          />
        )
      case 'admin-overview':
        return (
          <AdminOverviewScreen
            environment={environment}
            campaigns={campaigns}
            directoryRows={unpersonalizedDirectoryRows}
            selectedCampaign={selectedCampaign}
            selectedProject={selectedProject}
            selectedCampaignId={effectiveSelectedCampaignId}
            campaignInputSummaries={campaignInputSummaries}
            selectedInputSummary={selectedInputSummary}
            isLoading={isLoading}
            loadError={loadError}
            onSelectCampaign={handleSelectListedCampaign}
          />
        )
      case 'observer-proof':
        return (
          <ObserverProofScreen
            environment={environment}
            receipts={receipts}
            campaigns={campaigns}
            projects={projects}
            holderProfiles={holderProfiles}
            campaignInputSummaries={campaignInputSummaries}
            isLoading={isLoading}
            loadError={loadError}
          />
        )
      default:
        return null
    }
  }

  // Wallet providers mount only in the two wallet modes; MOCK_LOCAL and
  // DEVNET_READONLY render the plain shell (no provider, no slot, no discovery).
  //  - DEVNET_WALLET_READONLY: provider + role/holder bridge + the visible wallet
  //    chrome control (walletSlot).
  //  - DEVNET_TX_ENABLED: provider + the customer session + the session-verified
  //    Team/Admin S1 root + action bridge; no global wallet chrome and no role bridge.
  //    The Holder screen receives opaque prepare-output-ATA and convert slots, and the
  //    Team workspace screen is the one Team surface. Each renders inside these
  //    providers, each is the ONLY consumer of its own action hook, and each connects a
  //    wallet and invokes its action solely from an explicit user click.
  //
  // THE POSITIVE TEAM IDENTITY IS THE VERIFIED SESSION WALLET. The S1 root and the
  // workspace's mutation root receive the wallet the customer service verified and that is
  // connected right now, or `null`; nothing reads a build-time Team address any more. The
  // session is LAZY: nothing talks to the customer service until the Team workspace is
  // opened, so the Holder flows neither cost it a request nor depend on it.
  //
  // The mount decision reads the GLOBAL environment, never the combined one: a
  // selection-only refresh must not unmount the wallet subtree and throw away its
  // connection state.
  const providerEnvironment = deriveProviderEnvironment(globalData)
  const isDevnetWalletReadonly = providerEnvironment?.mode === 'DEVNET_WALLET_READONLY'
  const isDevnetTxEnabled = providerEnvironment?.mode === 'DEVNET_TX_ENABLED'
  // THE TEAM WORKSPACE (customer self-service, 2026-10-23) replaces the earlier Team/Admin panel
  // stack that used to be built here. It exists ONLY in DEVNET_TX_ENABLED, decided from the
  // same stable provider-scoped mode, and it is the only Team surface App constructs: a
  // customer signs in with their own wallet, drafts and reviews ONE frozen plan, and runs the
  // existing transaction roots step by step from it. App hands it public deployment facts and
  // the two bounded exact-address readers it already owns, and invokes nothing on it.
  //
  // The earlier panels remain in the source tree (their pure modules and describers are reused, the
  // lifecycle panel is mounted by the workspace's campaign page), but App no longer mounts the
  // Create / accepted-input / metadata / activation panels: they accept terms outside a
  // reviewed plan, and the roots' write gate admits only plan-derived requests.
  const explorerCluster = providerEnvironment?.cluster ?? null
  const teamWorkspace: ReactNode = isDevnetTxEnabled ? (
    <CustomerWorkspace
      appBaseUrl={readRedaxAppBaseUrl()}
      explorerCluster={explorerCluster}
      leaveGuard={workspaceLeave}
      onOpenHolderView={handleOpenHolderView}
      programId={teamAdminRuntimeProgramId}
      readCampaignTruth={readFreshCampaignSetupTruth}
      readLifecycleTruth={readFreshCampaignLifecycleTruth}
    />
  ) : undefined
  // The Token team screen keeps its evaluation content and points to the workspace.
  const teamAdminActionSlot: ReactNode = isDevnetTxEnabled ? (
    <SurfaceCard eyebrow="Team workspace" title="Set up and manage your campaigns">
      <p className="note-line">
        Sign in with your Team wallet to create a campaign from one form, review it once, approve each Devnet step in
        your wallet and share the holder link.
      </p>
      <div className="customer-actions">
        <button className="customer-btn customer-btn--primary" onClick={() => setActiveScreenId('team-workspace')} type="button">
          Open Team workspace
        </button>
      </div>
    </SurfaceCard>
  ) : undefined
  // The menu. The active item does nothing; leaving the Team workspace goes through its check
  // first, and only the newest destination is ever taken.
  function navigateTo(id: string): void {
    if (id === activeScreenId) {
      return
    }
    const guard = activeScreenId === 'team-workspace' ? workspaceLeave.current : null
    if (guard === null) {
      setActiveScreenId(id as ScreenId)
    } else {
      guard(() => setActiveScreenId(id as ScreenId))
    }
  }
  const shell = (
    <AppShell
      navItems={isDevnetTxEnabled ? NAV_ITEMS : NAV_ITEMS.filter((item) => item.id !== 'team-workspace')}
      activeId={activeScreenId}
      onNavigate={navigateTo}
      mockModeLabel={environment?.mode}
      mockModeNote={
        environment
          ? environment.mode === 'MOCK_LOCAL'
            ? 'sample data'
            : environment.mode === 'DEVNET_WALLET_READONLY'
              ? 'devnet program reads (read-only) + wallet connection context'
              : environment.mode === 'DEVNET_TX_ENABLED'
                ? 'devnet program reads + wallet-gated transaction actions'
                : 'devnet program reads (read-only)'
          : undefined
      }
      mockModeTitle={environment?.boundaryLabel}
      unlistedCampaignPhase={unlistedCampaignPhase}
      walletSlot={
        isDevnetWalletReadonly ? <RedaxWalletControls roleContext={walletRoleContext} /> : undefined
      }
    >
      {renderScreen(teamAdminActionSlot, teamWorkspace)}
    </AppShell>
  )
  return isDevnetWalletReadonly ? (
    <RedaxWalletProvider>
      <WalletRoleContextBridge
        dataSource={redaxDataSource}
        mode={providerEnvironment?.mode ?? null}
        activeCampaignId={effectiveSelectedCampaignId}
        onRoleContext={setWalletRoleContext}
        onHolderContext={setWalletHolderContext}
      />
      {shell}
    </RedaxWalletProvider>
  ) : isDevnetTxEnabled ? (
    // Provider + customer session + the session-verified Team/Admin S1 root + action
    // bridge. App only mounts the providers and passes the opaque slots — it invokes no
    // wallet action and no Team/Admin action itself. Nothing signs or sends on render:
    // every action runs only from a slot's explicit user click.
    <RedaxWalletProvider>
      <RedaxCustomerSessionProvider>
        <RedaxCustomerTeamRoots runtimeProgramId={teamAdminRuntimeProgramId}>
          <RedaxWalletActionsProvider>{shell}</RedaxWalletActionsProvider>
        </RedaxCustomerTeamRoots>
      </RedaxCustomerSessionProvider>
    </RedaxWalletProvider>
  ) : (
    shell
  )
}

export default App
