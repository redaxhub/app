// REDAX read-only devnet adapter — pure decoded-account -> Redax*View mappers.
//
// Boundary: read-only devnet adapter core only (DEVNET_READONLY and
// DEVNET_WALLET_READONLY — the environment view is mode-aware; every other
// mapper is mode-independent). Pure functions; no RPC, no env, no
// wallet, no fixtures, no mock import, no readiness claim. Every value is real
// on-chain data, a derived value, or an honest placeholder — never a mock label,
// fake receipt, fake project, fabricated proof, or fabricated "primary" input.
//
// Honest-data rules encoded below:
//  - projectId is null (no on-chain project account); project labels are
//    address-derived placeholders until a registry/metadata gate.
//  - proofCompletenessPercent is 0 as a boundary value, not proof of completeness.
//  - isPrimary is false: there is no on-chain "primary input"; primary/focus is a
//    later UI/off-chain concern.
//  - startTs is omitted: the on-chain Campaign stores no start_ts.
//  - protocolFeeBps / bpsDenominator come from program constants (quoteMath), not
//    from an account field.
//  - outputTokenIdentity comes only from the decoded on-chain Metaplex metadata
//    account (never hardcoded); when that read is unavailable the identity is
//    'unavailable' and labels fall back to the address-derived short form.
//  - proofCaption marks the boundary proof value as not indexed in this build.
//  - displayStatus / capUtilizationBps / endsInSeconds are derived from real data.

import type {
  RedaxActionAvailabilityView,
  RedaxActionId,
  RedaxCampaignInputSummaryView,
  RedaxCampaignView,
  RedaxConnectedWalletHolderContextView,
  RedaxConnectedWalletInputBalanceView,
  RedaxConnectedWalletOutputAtaView,
  RedaxDirectoryRowView,
  RedaxDisplayCampaignStatus,
  RedaxEnvironmentView,
  RedaxInputConfigView,
  RedaxOutputTokenIdentityView,
  RedaxProtocolConfigView,
  RedaxRoleKind,
  RedaxRoleView,
  RedaxTokenConfigView,
  RedaxWalletAtaStatus,
  RedaxWalletRoleContextView,
} from '../redaxViewModels'
import type { RedaxModeDescriptor } from '../redaxModes'
import type { RedaxDevnetProgramAppMode } from './redaxDevnetErrors'
import { BPS_DENOMINATOR, PROTOCOL_FEE_BPS } from '../../lib/quoteMath'
import type {
  ClassicAtaRead,
  DecodedCampaign,
  DecodedOutputTokenMetadata,
  DecodedProtocolConfig,
  DecodedTokenConfig,
  LocatedTokenConfig,
} from './redaxDevnetAccounts'

// --- Local helpers ----------------------------------------------------------

/** Short address-derived label, e.g. `AbCd…WxYz`. Honest placeholder only. */
function shortLabel(address: string): string {
  return address.length <= 10 ? address : `${address.slice(0, 4)}…${address.slice(-4)}`
}

/** Decoded on-chain metadata -> display identity; null/undefined -> 'unavailable'. */
function toOutputTokenIdentity(
  metadata: DecodedOutputTokenMetadata | null | undefined,
): RedaxOutputTokenIdentityView {
  if (metadata) {
    return { source: 'metaplex', name: metadata.name, symbol: metadata.symbol, uri: metadata.uri }
  }
  return { source: 'unavailable' }
}

/** Cap utilization in basis points (0 when uncapped); clamped to [0, 10000]. */
function capUtilizationBps(minted: bigint, max: bigint): number {
  if (max <= 0n) {
    return 0
  }
  const bps = Number((minted * 10_000n) / max)
  return bps > 10_000 ? 10_000 : bps
}

/**
 * Derive the product display status from real campaign state. Cap thresholds are
 * explicit UI heuristics over on-chain totals (≥100% reached, ≥90% near).
 */
function deriveDisplayStatus(data: DecodedCampaign): RedaxDisplayCampaignStatus {
  if (data.status === 'finalized') {
    return 'finalized'
  }
  if (data.status === 'paused') {
    return 'paused'
  }
  if (data.status === 'initialized') {
    return data.metadataSetup ? 'upcoming' : 'metadata_pending'
  }
  if (data.maxOutputSupply > 0n) {
    if (data.totalOutputMinted >= data.maxOutputSupply) {
      return 'cap_reached'
    }
    if (data.totalOutputMinted * 100n >= data.maxOutputSupply * 90n) {
      return 'cap_near'
    }
  }
  return 'active'
}

function roleLabel(role: RedaxRoleKind): string {
  switch (role) {
    case 'campaign_admin':
      return 'Campaign admin — read-only devnet mode'
    case 'output_governance':
      return 'Output governance — read-only devnet mode'
    case 'protocol_fee_authority':
      return 'Protocol fee authority — read-only devnet mode'
    case 'protocol_emergency_pause_authority':
      return 'Protocol emergency-pause authority — read-only devnet mode'
    default:
      return 'Connected address — read-only devnet mode'
  }
}

// --- Environment ------------------------------------------------------------

const DEVNET_READONLY_DESCRIPTOR: RedaxModeDescriptor = {
  mode: 'DEVNET_READONLY',
  source: 'program-rpc',
  cluster: 'devnet',
  label: 'Devnet reads (DEVNET_READONLY)',
  boundaryLabel: 'Devnet program/RPC reads only — no transaction actions.',
  capabilities: ['program-rpc-read'],
  walletRequiredForActions: false,
  rpcAllowed: true,
  transactionActionsAllowed: false,
  mockFallbackAllowed: false,
  readinessClaim: 'none',
}

// Mirrors the DEVNET_WALLET_READONLY descriptor in config/redaxEnv.ts (kept
// local so this adapter stays env-module-independent). Wallet connection is
// role/balance display context only; transaction actions stay disabled.
const DEVNET_WALLET_READONLY_DESCRIPTOR: RedaxModeDescriptor = {
  mode: 'DEVNET_WALLET_READONLY',
  source: 'program-rpc',
  cluster: 'devnet',
  label: 'Devnet reads + wallet context (DEVNET_WALLET_READONLY)',
  boundaryLabel:
    'Devnet program/RPC reads plus wallet connection for role/balance context only — no transaction actions.',
  capabilities: ['program-rpc-read', 'wallet-connect-readonly'],
  walletRequiredForActions: false,
  rpcAllowed: true,
  transactionActionsAllowed: false,
  mockFallbackAllowed: false,
  readinessClaim: 'none',
}

// DEVNET_TX_ENABLED: loads the same devnet program/RPC reads as the read-only
// modes, PLUS the wallet-approved, devnet-only actions the product surfaces. On the
// HOLDER surface: preparing an output token account, choosing an accepted input, and
// converting it. On the TEAM surface, when the deployment configures an approved Team
// wallet: creating a devnet campaign, and then — for a campaign that already exists —
// adding one accepted input token config, setting its output token metadata once,
// activating it, pausing it, unpausing it and finalizing it. The earlier reading of
// this note stopped at campaign create and is superseded on that point alone.
//
// Those actions are surfaced through their own action roots and slot panels, NOT
// through getAvailableActions (which stays all-disabled and describes the read path
// only). Each runs only on explicit user approval, EXISTS AS SOURCE, and none is a
// live-proven claim: a mounted control is never evidence that any particular attempt
// reached devnet. The coarse capability flags mirror the mode definition; the precise,
// user-visible scope lives in boundaryLabel.
const DEVNET_TX_ENABLED_DESCRIPTOR: RedaxModeDescriptor = {
  mode: 'DEVNET_TX_ENABLED',
  source: 'program-rpc',
  cluster: 'devnet',
  label: 'Devnet reads (DEVNET_TX_ENABLED)',
  boundaryLabel:
    'Devnet program/RPC reads, plus wallet-approved, devnet-only actions: on the Holder surface, preparing your output token account and converting the accepted input you choose; in the Team workspace, for a Team wallet that has signed in and been given access, creating a devnet campaign and then adding its accepted input token configs, setting the output token metadata once, activating, pausing, unpausing or finalizing that campaign. Every one of them runs only when you approve it in your wallet. No readiness claim.',
  capabilities: ['program-rpc-read', 'wallet-required-for-actions', 'transaction-actions-enabled'],
  walletRequiredForActions: true,
  rpcAllowed: true,
  transactionActionsAllowed: true,
  mockFallbackAllowed: false,
  readinessClaim: 'none',
}

/** The devnet program-data environment boundary view for `mode`. No readiness claim. */
export function mapEnvironmentView(mode: RedaxDevnetProgramAppMode): RedaxEnvironmentView {
  const descriptor =
    mode === 'DEVNET_WALLET_READONLY'
      ? DEVNET_WALLET_READONLY_DESCRIPTOR
      : mode === 'DEVNET_TX_ENABLED'
        ? DEVNET_TX_ENABLED_DESCRIPTOR
        : DEVNET_READONLY_DESCRIPTOR
  return {
    mode,
    source: 'program-rpc',
    cluster: 'devnet',
    modeDescriptor: descriptor,
    dataSourceLabel: descriptor.label,
    boundaryLabel: descriptor.boundaryLabel,
    rpcConfigured: true,
    walletRequiredForActions: descriptor.walletRequiredForActions,
    readinessClaim: 'none',
  }
}

// --- Protocol config --------------------------------------------------------

/** ProtocolConfig -> view. Fee bps / denominator are program constants. */
export function mapProtocolConfigView(data: DecodedProtocolConfig): RedaxProtocolConfigView {
  return {
    protocolFeeAuthority: data.protocolFeeAuthority.toBase58(),
    protocolEmergencyPauseAuthority: data.protocolEmergencyPauseAuthority.toBase58(),
    protocolFeeBps: Number(PROTOCOL_FEE_BPS),
    bpsDenominator: Number(BPS_DENOMINATOR),
  }
}

// --- Campaign ---------------------------------------------------------------

/**
 * Campaign -> view. tokenConfigCount is the on-chain counter; project identity
 * fields stay address-derived placeholders (no registry), while the output
 * token identity comes from the decoded Metaplex metadata when available.
 */
export function mapCampaignView(
  campaignAddress: string,
  data: DecodedCampaign,
  outputMetadata?: DecodedOutputTokenMetadata | null,
): RedaxCampaignView {
  const outputMint = data.outputMint.toBase58()
  return {
    id: campaignAddress,
    projectId: null,
    name: `Campaign ${shortLabel(campaignAddress)}`,
    programStatus: data.status,
    displayStatus: deriveDisplayStatus(data),
    campaignAddress,
    campaignAdmin: data.campaignAdmin.toBase58(),
    outputGovernance: data.outputGovernance.toBase58(),
    outputMint,
    outputMintLabel: shortLabel(outputMint),
    outputTokenIdentity: toOutputTokenIdentity(outputMetadata),
    protocolFeeVault: data.protocolFeeVault.toBase58(),
    metadataSetup: data.metadataSetup,
    endTs: data.endTs === null ? null : Number(data.endTs),
    maxOutputSupplyRaw: data.maxOutputSupply.toString(),
    totalOutputMintedRaw: data.totalOutputMinted.toString(),
    tokenConfigCount: data.tokenConfigCount,
    sortPriority: 0,
  }
}

// --- Token config -----------------------------------------------------------

/** TokenConfig -> view. The output mint (and its identity) come from the owning campaign. */
export function mapTokenConfigView(
  tokenConfigAddress: string,
  data: DecodedTokenConfig,
  campaign: DecodedCampaign,
  outputMetadata?: DecodedOutputTokenMetadata | null,
): RedaxTokenConfigView {
  const outputMint = campaign.outputMint.toBase58()
  const legacyMint = data.legacyMint.toBase58()
  return {
    id: tokenConfigAddress,
    campaignId: data.campaign.toBase58(),
    legacyMint,
    legacyMintLabel: shortLabel(legacyMint),
    outputMint,
    outputMintLabel: shortLabel(outputMint),
    outputTokenIdentity: toOutputTokenIdentity(outputMetadata),
    rateNumeratorRaw: data.rateNumerator.toString(),
    rateDenominatorRaw: data.rateDenominator.toString(),
    legacyDecimals: data.legacyDecimals,
    outputDecimals: data.outputDecimals,
    maxOutputFromTokenConfigRaw: data.maxOutputFromTc.toString(),
    totalOutputMintedFromTokenConfigRaw: data.totalOutputMintedFromTc.toString(),
    normalizationRemainderTotalRaw: data.normalizationRemainderTotal.toString(),
    tokenProgram: 'classic-spl',
    isPrimary: false,
  }
}

function mapInputConfigView(
  tokenConfigAddress: string,
  data: DecodedTokenConfig,
  campaign: DecodedCampaign,
  outputMetadata?: DecodedOutputTokenMetadata | null,
): RedaxInputConfigView {
  const outputMint = campaign.outputMint.toBase58()
  const legacyMint = data.legacyMint.toBase58()
  return {
    campaignId: data.campaign.toBase58(),
    tokenConfigId: tokenConfigAddress,
    legacyMint,
    legacyMintLabel: shortLabel(legacyMint),
    outputMint,
    outputMintLabel: shortLabel(outputMint),
    outputTokenIdentity: toOutputTokenIdentity(outputMetadata),
    rateNumeratorRaw: data.rateNumerator.toString(),
    rateDenominatorRaw: data.rateDenominator.toString(),
    legacyDecimals: data.legacyDecimals,
    outputDecimals: data.outputDecimals,
    maxOutputFromTokenConfigRaw: data.maxOutputFromTc.toString(),
    totalOutputMintedFromTokenConfigRaw: data.totalOutputMintedFromTc.toString(),
    capUtilizationBps: capUtilizationBps(data.totalOutputMintedFromTc, data.maxOutputFromTc),
    tokenProgram: 'classic-spl',
    isPrimary: false,
  }
}

/** Campaign + its token configs -> accepted-input summary. */
export function mapCampaignInputSummaryView(
  campaignAddress: string,
  campaign: DecodedCampaign,
  tokenConfigs: readonly LocatedTokenConfig[],
  outputMetadata?: DecodedOutputTokenMetadata | null,
): RedaxCampaignInputSummaryView {
  const outputMint = campaign.outputMint.toBase58()
  return {
    campaignId: campaignAddress,
    outputMint,
    outputMintLabel: shortLabel(outputMint),
    outputTokenIdentity: toOutputTokenIdentity(outputMetadata),
    acceptedInputCount: tokenConfigs.length,
    maxTokenConfigs: 10,
    inputConfigs: tokenConfigs.map((tc) =>
      mapInputConfigView(tc.address.toBase58(), tc.data, campaign, outputMetadata),
    ),
  }
}

// --- Directory row ----------------------------------------------------------

/**
 * Campaign -> directory row. Status / cap / ends-in are real-derived; project
 * identity and holder columns are honest placeholders (no on-chain project, no
 * holder personalization in this readonly slice), and the boundary proof value
 * carries an explicit "not indexed in this build" caption.
 */
export function mapDirectoryRowView(
  campaignAddress: string,
  data: DecodedCampaign,
  nowSec: number,
): RedaxDirectoryRowView {
  return {
    campaignId: campaignAddress,
    projectId: null,
    projectName: `Campaign ${shortLabel(campaignAddress)}`,
    symbol: '—',
    profile: '',
    programStatus: data.status,
    displayStatus: deriveDisplayStatus(data),
    holderEligible: null,
    holderBalanceRaw: null,
    capUtilizationBps: capUtilizationBps(data.totalOutputMinted, data.maxOutputSupply),
    endsInSeconds: data.endTs === null ? null : Math.max(0, Number(data.endTs) - nowSec),
    proofCompletenessPercent: 0,
    proofCaption: 'not indexed in this build',
    sortPriority: 0,
  }
}

// --- Actions / role ---------------------------------------------------------

const PHASE1_ACTION_IDS: readonly RedaxActionId[] = [
  'init_protocol',
  'init_campaign',
  'verify_output_mint',
  'add_token_config',
  'setup_metadata',
  'activate_campaign',
  'prepare_user_output_ata',
  'convert_exact_in',
  'pause_campaign',
  'unpause_campaign',
  'finalize_campaign',
]

/**
 * Every Phase 1 action is disabled in the read-only devnet modes. Read-only
 * search/filter inputs may arrive in a later gate; transaction actions require
 * DEVNET_TX_ENABLED plus a connected wallet. The machine reason code below
 * intentionally keeps its original spelling — it denotes "read-only devnet, no
 * transaction actions", which holds for both read-only modes.
 */
export function mapReadonlyActions(): readonly RedaxActionAvailabilityView[] {
  return PHASE1_ACTION_IDS.map((actionId): RedaxActionAvailabilityView => ({
    actionId,
    state: 'disabled',
    requiredMode: 'DEVNET_TX_ENABLED',
    disabledReasonCode: 'DEVNET_READONLY_NO_TRANSACTION_ACTIONS',
    disabledReasonText:
      'Read-only devnet mode — transaction actions require DEVNET_TX_ENABLED and a connected wallet.',
  }))
}

/** A public read-only role for the read-only devnet modes with no connected wallet. */
export function publicReadonlyRole(): RedaxRoleView {
  return {
    role: 'public',
    label: 'Public viewer — read-only devnet program reads',
    readOnly: true,
  }
}

/** The connected-address fallback role: connected but matching no REDAX authority. */
function connectedPublicRole(wallet: string): RedaxRoleView {
  return {
    role: 'public',
    walletAddress: wallet,
    label: 'Connected address — no matched REDAX authority (read-only)',
    readOnly: true,
  }
}

/**
 * Resolve the FULL set of REDAX authority roles a connected wallet matches, by
 * comparing its address against the protocol authorities and (when supplied) the
 * active campaign's admin / output governance. This is an address match against
 * real on-chain accounts — not wallet auth, not a capability grant. Every role is
 * read-only. All simultaneous matches are returned (never first-match only), in
 * campaign-admin → output-governance → protocol-fee → protocol-emergency-pause
 * precedence; when nothing matches, the connected-address fallback is the only
 * role. The raw wallet address is never logged here.
 */
export function mapConnectedWalletRoleContext(
  wallet: string,
  protocolConfig: DecodedProtocolConfig | null,
  campaign: DecodedCampaign | null,
): RedaxWalletRoleContextView {
  const matched: RedaxRoleView[] = []
  const pushRole = (role: RedaxRoleKind): void => {
    matched.push({
      role,
      walletAddress: wallet,
      matchedAccount: wallet,
      label: roleLabel(role),
      readOnly: true,
    })
  }
  if (campaign) {
    if (wallet === campaign.campaignAdmin.toBase58()) {
      pushRole('campaign_admin')
    }
    if (wallet === campaign.outputGovernance.toBase58()) {
      pushRole('output_governance')
    }
  }
  if (protocolConfig) {
    if (wallet === protocolConfig.protocolFeeAuthority.toBase58()) {
      pushRole('protocol_fee_authority')
    }
    if (wallet === protocolConfig.protocolEmergencyPauseAuthority.toBase58()) {
      pushRole('protocol_emergency_pause_authority')
    }
  }
  const matchedRoles: readonly RedaxRoleView[] =
    matched.length > 0 ? matched : [connectedPublicRole(wallet)]
  return {
    status: 'connected',
    shortPublicKey: shortLabel(wallet),
    matchedRoles,
    primaryRole: matchedRoles[0],
  }
}

/**
 * Single primary role for a connected wallet — the first matched authority (in
 * the same precedence) or the connected-address fallback. Preserved for callers
 * that want one role; derived from the full matched-role set so the single and
 * multi views can never disagree.
 */
export function mapConnectedWalletRole(
  wallet: string,
  protocolConfig: DecodedProtocolConfig | null,
  campaign: DecodedCampaign | null,
): RedaxRoleView {
  return (
    mapConnectedWalletRoleContext(wallet, protocolConfig, campaign).primaryRole ??
    connectedPublicRole(wallet)
  )
}

// --- Connected-wallet holder context (read-only balances / ATA) -------------

/** ClassicAtaRead.kind maps 1:1 onto the public RedaxWalletAtaStatus union. */
function toWalletAtaStatus(kind: ClassicAtaRead['kind']): RedaxWalletAtaStatus {
  return kind
}

/**
 * One accepted input's legacy-mint balance row for the connected wallet. The raw
 * balance is carried only for an existing account; every other status leaves it
 * null (never a fabricated zero). Display formatting happens in the screen.
 */
export function mapConnectedWalletInputBalance(
  tokenConfigAddress: string,
  data: DecodedTokenConfig,
  read: ClassicAtaRead,
): RedaxConnectedWalletInputBalanceView {
  const legacyMint = data.legacyMint.toBase58()
  return {
    tokenConfigId: tokenConfigAddress,
    legacyMint,
    legacyMintLabel: shortLabel(legacyMint),
    legacyDecimals: data.legacyDecimals,
    ataStatus: toWalletAtaStatus(read.kind),
    balanceRaw: read.kind === 'exists' && read.amount !== null ? read.amount.toString() : null,
  }
}

/** Campaign-level output-ATA preparedness for the connected wallet (read-only). */
export function mapConnectedWalletOutputAta(
  outputMint: string,
  read: ClassicAtaRead,
): RedaxConnectedWalletOutputAtaView {
  return {
    status: toWalletAtaStatus(read.kind),
    outputMint,
    outputMintLabel: shortLabel(outputMint),
    // Pass through the already-decoded classic-SPL output-ATA amount as a raw
    // base-unit decimal string (BigInt.toString(); never floating point),
    // carried only for an existing account and never a fabricated zero — mirrors
    // mapConnectedWalletInputBalance above. No new RPC read; no address logged.
    balanceRaw: read.kind === 'exists' && read.amount !== null ? read.amount.toString() : null,
  }
}

/**
 * Assemble the `connected` (real-read) holder context for a wallet from the
 * already-read per-input balances and output-ATA status. The non-connected states
 * (`unconnected` / `unavailable`) are literals produced by the data source, not
 * here. Read-only: carries no quote, no eligibility, and no capability.
 */
export function mapConnectedWalletHolderContext(
  wallet: string,
  campaignId: string | null,
  legacyInputBalances: readonly RedaxConnectedWalletInputBalanceView[],
  outputAta: RedaxConnectedWalletOutputAtaView | null,
): RedaxConnectedWalletHolderContextView {
  return {
    status: 'connected',
    shortPublicKey: shortLabel(wallet),
    campaignId,
    legacyInputBalances,
    outputAta,
  }
}
