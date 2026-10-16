// REDAX MOCK_LOCAL data-source convergence — pure Mock* -> Redax*View mapper.
//
// Boundary: pure mapping only. This module reads no fixtures, calls no selector,
// reads no env, imports no React / wallet / RPC / Anchor / web3 / SPL / IDL, and
// makes no network call. Every function is a total, deterministic transform from
// the local Mock* shapes (app/src/types/redaxMock.ts) to the adapter-agnostic
// Redax*View shapes (../redaxViewModels). The owning MOCK_LOCAL adapter supplies
// the fixture data and any cross-entity context (token-config count, decimals,
// resolved holder/token-config); this file only reshapes what it is handed.
//
// Raw token amounts stay decimal strings handled with BigInt math only — never
// floating point. The normalize helper below mirrors the exact quotient/remainder
// logic in app/src/lib/mockSelectors.ts so a mapped quote/receipt agrees with the
// mock conversion math.

import type {
  MockCampaign,
  MockCampaignDirectoryRow,
  MockCampaignInputConfigRow,
  MockCampaignInputSummary,
  MockConversionQuote,
  MockConvertedReceipt,
  MockEnvironmentState,
  MockHolderCampaignEligibility,
  MockHolderInputPosition,
  MockHolderProfile,
  MockProject,
  MockProtocolConfig,
  MockRejectionReason,
  MockTokenConfig,
} from '../../types/redaxMock'
import type {
  RedaxCampaignInputSummaryView,
  RedaxCampaignView,
  RedaxDirectoryRowView,
  RedaxEnvironmentView,
  RedaxHolderEligibilityView,
  RedaxHolderInputPositionView,
  RedaxHolderView,
  RedaxInputConfigView,
  RedaxProjectView,
  RedaxProtocolConfigView,
  RedaxQuoteView,
  RedaxReceiptView,
  RedaxRejectionReason,
  RedaxTokenConfigView,
} from '../redaxViewModels'
import type { RedaxModeDescriptor } from '../redaxModes'
import { normalizeAmount, parseRawAmount } from '../../lib/quoteMath'

// --- Private normalized-amount helper (shared math from ../../lib/quoteMath) -
//
// The pow10 / parseRawAmount / normalize primitives now live in the shared,
// dependency-free quoteMath oracle, so this mapper no longer duplicates them.

/**
 * The normalized input amount as a raw decimal string. RedaxQuoteView /
 * RedaxReceiptView require this normalized value, which the Mock* quote/receipt
 * shapes do not carry, so callers pass the relevant token-config decimals.
 */
function normalizedAmountInRawString(
  amountInRaw: string,
  legacyDecimals: number,
  outputDecimals: number,
): string {
  const amountIn = parseRawAmount(amountInRaw)
  return normalizeAmount(amountIn, legacyDecimals, outputDecimals).normalized.toString()
}

// --- Private MOCK_LOCAL mode descriptor -------------------------------------
//
// Synthesized locally so the mapper never imports config/redaxEnv. It mirrors
// the canonical MOCK_LOCAL descriptor: local fixtures only, no wallet, no RPC,
// no transaction actions, no mock fallback, and no readiness claim.

const MOCK_LOCAL_MODE_DESCRIPTOR: RedaxModeDescriptor = {
  mode: 'MOCK_LOCAL',
  source: 'mock-fixtures',
  cluster: null,
  label: 'Local mock fixtures (MOCK_LOCAL)',
  boundaryLabel: 'Local fixtures / sample data only — not on-chain data.',
  capabilities: ['local-fixtures'],
  walletRequiredForActions: false,
  rpcAllowed: false,
  transactionActionsAllowed: false,
  mockFallbackAllowed: false,
  readinessClaim: 'none',
}

// --- Environment / protocol -------------------------------------------------

/**
 * MockEnvironmentState -> RedaxEnvironmentView. Emits the canonical MOCK_LOCAL
 * mode/source and never the legacy two-mode 'DEVNET' value; pins the boundary to
 * local fixtures with no RPC, no wallet requirement, and no readiness claim.
 */
export function mapMockEnvironmentState(env: MockEnvironmentState): RedaxEnvironmentView {
  return {
    mode: 'MOCK_LOCAL',
    source: 'mock-fixtures',
    cluster: null,
    modeDescriptor: MOCK_LOCAL_MODE_DESCRIPTOR,
    dataSourceLabel: MOCK_LOCAL_MODE_DESCRIPTOR.label,
    boundaryLabel: env.boundaryLabel,
    rpcConfigured: false,
    walletRequiredForActions: false,
    readinessClaim: 'none',
  }
}

/** MockProtocolConfig -> RedaxProtocolConfigView. Drops mockOnly; keeps fee bps + denominator. */
export function mapMockProtocolConfig(config: MockProtocolConfig): RedaxProtocolConfigView {
  return {
    protocolFeeAuthority: config.protocolFeeAuthority,
    protocolEmergencyPauseAuthority: config.protocolEmergencyPauseAuthority,
    protocolFeeBps: config.protocolFeeBps,
    bpsDenominator: config.bpsDenominator,
  }
}

// --- Project / campaign / token-config --------------------------------------

/** MockProject -> RedaxProjectView. Identity/display only; phase1StoredState is always false. */
export function mapMockProject(project: MockProject): RedaxProjectView {
  return {
    id: project.id,
    name: project.name,
    symbol: project.symbol,
    profile: project.profile,
    tagline: project.tagline,
    teamPersona: project.teamPersona,
    proofCompletenessPercent: project.proofCompletenessPercent,
    proofLabel: project.proofLabel,
    phase1StoredState: false,
  }
}

/**
 * MockCampaign -> RedaxCampaignView. The primary legacy mint comes from oldMint /
 * oldMintLabel; tokenConfigCount is supplied by the adapter (it knows the campaign's
 * accepted-input count). Optional on-chain account fields absent from the mock
 * (campaignAddress / campaignAdmin / outputGovernance) are omitted, not invented.
 */
export function mapMockCampaign(
  campaign: MockCampaign,
  tokenConfigCount: number,
): RedaxCampaignView {
  return {
    id: campaign.id,
    projectId: campaign.projectId,
    name: campaign.name,
    programStatus: campaign.programStatus,
    displayStatus: campaign.displayStatus,
    outputMint: campaign.outputMint,
    outputMintLabel: campaign.outputMintLabel,
    primaryLegacyMint: campaign.oldMint,
    primaryLegacyMintLabel: campaign.oldMintLabel,
    protocolFeeVault: campaign.protocolFeeVault,
    metadataSetup: campaign.metadataSetup,
    startTs: campaign.startTs,
    endTs: campaign.endTs,
    maxOutputSupplyRaw: campaign.maxOutputSupplyRaw,
    totalOutputMintedRaw: campaign.totalOutputMintedRaw,
    tokenConfigCount,
    sortPriority: campaign.sortPriority,
    statusNote: campaign.statusNote,
  }
}

/**
 * MockTokenConfig -> RedaxTokenConfigView. The output mint / label and the
 * primary flag are campaign-derived (primary == this config's legacyMint equals
 * the campaign oldMint, mirroring mockSelectors.isPrimaryConfig); the
 * normalization-remainder total is preserved.
 */
export function mapMockTokenConfig(
  tokenConfig: MockTokenConfig,
  campaign: MockCampaign,
): RedaxTokenConfigView {
  return {
    id: tokenConfig.id,
    campaignId: tokenConfig.campaignId,
    legacyMint: tokenConfig.legacyMint,
    legacyMintLabel: tokenConfig.legacyMintLabel,
    outputMint: campaign.outputMint,
    outputMintLabel: campaign.outputMintLabel,
    rateNumeratorRaw: tokenConfig.rateNumeratorRaw,
    rateDenominatorRaw: tokenConfig.rateDenominatorRaw,
    legacyDecimals: tokenConfig.legacyDecimals,
    outputDecimals: tokenConfig.outputDecimals,
    maxOutputFromTokenConfigRaw: tokenConfig.maxOutputFromTokenConfigRaw,
    totalOutputMintedFromTokenConfigRaw: tokenConfig.totalOutputMintedFromTokenConfigRaw,
    normalizationRemainderTotalRaw: tokenConfig.normalizationRemainderTotalRaw,
    tokenProgram: tokenConfig.tokenProgram,
    isPrimary: tokenConfig.legacyMint === campaign.oldMint,
  }
}

/** MockCampaignInputConfigRow -> RedaxInputConfigView. Flattened row; isPrimary preserved. */
export function mapMockInputConfigRow(row: MockCampaignInputConfigRow): RedaxInputConfigView {
  return {
    campaignId: row.campaignId,
    tokenConfigId: row.tokenConfigId,
    legacyMint: row.legacyMint,
    legacyMintLabel: row.legacyMintLabel,
    outputMint: row.outputMint,
    outputMintLabel: row.outputMintLabel,
    rateNumeratorRaw: row.rateNumeratorRaw,
    rateDenominatorRaw: row.rateDenominatorRaw,
    legacyDecimals: row.legacyDecimals,
    outputDecimals: row.outputDecimals,
    maxOutputFromTokenConfigRaw: row.maxOutputFromTokenConfigRaw,
    totalOutputMintedFromTokenConfigRaw: row.totalOutputMintedFromTokenConfigRaw,
    capUtilizationBps: row.capUtilizationBps,
    tokenProgram: row.tokenProgram,
    isPrimary: row.isPrimary,
  }
}

/**
 * MockCampaignInputSummary -> RedaxCampaignInputSummaryView. Rows map to
 * inputConfigs; maxTokenConfigs is the literal 10 the view requires (not widened
 * from the mock's number-typed field).
 */
export function mapMockCampaignInputSummary(
  summary: MockCampaignInputSummary,
): RedaxCampaignInputSummaryView {
  return {
    campaignId: summary.campaignId,
    outputMint: summary.outputMint,
    outputMintLabel: summary.outputMintLabel,
    acceptedInputCount: summary.acceptedInputCount,
    maxTokenConfigs: 10,
    inputConfigs: summary.rows.map(mapMockInputConfigRow),
  }
}

// --- Holder / quote / eligibility -------------------------------------------

/** MockHolderProfile -> RedaxHolderView. mockAddress becomes walletAddress; persona/sort kept. */
export function mapMockHolderProfile(holder: MockHolderProfile): RedaxHolderView {
  return {
    id: holder.id,
    label: holder.label,
    walletAddress: holder.mockAddress,
    walletLabel: holder.walletLabel,
    persona: holder.persona,
    preferredSort: holder.preferredSort,
  }
}

/**
 * MockConversionQuote -> RedaxQuoteView. The normalized input amount is computed
 * with the private BigInt normalize helper from the supplied token-config
 * decimals (the Mock* quote carries neither decimals nor rate, so the view's
 * required normalizedAmountInRaw must be derived here). The remainder is the
 * mock's own value, passed through; no math is approximated and no float is used.
 */
export function mapMockQuote(
  quote: MockConversionQuote,
  legacyDecimals: number,
  outputDecimals: number,
): RedaxQuoteView {
  return {
    campaignId: quote.campaignId,
    tokenConfigId: quote.tokenConfigId,
    amountInRaw: quote.amountInRaw,
    normalizedAmountInRaw: normalizedAmountInRawString(
      quote.amountInRaw,
      legacyDecimals,
      outputDecimals,
    ),
    normalizationRemainderRaw: quote.normalizationRemainderRaw,
    grossOutRaw: quote.grossOutRaw,
    feeOutRaw: quote.feeOutRaw,
    userOutRaw: quote.userOutRaw,
    rejectionReason: quote.rejectionReason
      ? mapMockRejectionReason(quote.rejectionReason)
      : undefined,
  }
}

/**
 * MockHolderInputPosition -> RedaxHolderInputPositionView. The per-input quote is
 * mapped via mapMockQuote using this position's own decimals; rejection reasons
 * are mapped one-for-one.
 */
export function mapMockHolderInputPosition(
  position: MockHolderInputPosition,
): RedaxHolderInputPositionView {
  return {
    holderId: position.holderId,
    campaignId: position.campaignId,
    tokenConfigId: position.tokenConfigId,
    legacyMint: position.legacyMint,
    legacyMintLabel: position.legacyMintLabel,
    outputMint: position.outputMint,
    outputMintLabel: position.outputMintLabel,
    legacyDecimals: position.legacyDecimals,
    outputDecimals: position.outputDecimals,
    holderBalanceRaw: position.holderBalanceRaw,
    outputAtaPrepared: position.outputAtaPrepared,
    eligible: position.eligible,
    isPrimary: position.isPrimary,
    quote: position.quote
      ? mapMockQuote(position.quote, position.legacyDecimals, position.outputDecimals)
      : undefined,
    rejectionReasons: position.rejectionReasons.map(mapMockRejectionReason),
  }
}

/**
 * MockHolderCampaignEligibility -> RedaxHolderEligibilityView. The adapter passes
 * the already-mapped per-input positions; the selected token config and its quote
 * are taken from the matching input position (the eligibility quote is the same
 * quote the selectors compute for that token config), so no decimals are threaded
 * here and the eligibility quote stays consistent with the position quote.
 */
export function mapMockHolderEligibility(
  eligibility: MockHolderCampaignEligibility,
  inputPositions: readonly RedaxHolderInputPositionView[],
): RedaxHolderEligibilityView {
  const selectedTokenConfigId = eligibility.quote?.tokenConfigId
  const selectedPosition =
    selectedTokenConfigId === undefined
      ? undefined
      : inputPositions.find((position) => position.tokenConfigId === selectedTokenConfigId)
  return {
    holderId: eligibility.holderId,
    campaignId: eligibility.campaignId,
    eligible: eligibility.eligible,
    balanceRaw: eligibility.balanceRaw,
    outputAtaPrepared: eligibility.outputAtaPrepared,
    selectedTokenConfigId,
    quote: selectedPosition?.quote,
    rejectionReasons: eligibility.rejectionReasons.map(mapMockRejectionReason),
    inputPositions,
  }
}

// --- Receipt ----------------------------------------------------------------

/**
 * MockConvertedReceipt -> RedaxReceiptView. Identity is always the mock arm
 * ('mock-receipt-id', mockOnly: true) — never a signature / slot / eventIndex /
 * explorerUrl. The user pubkey comes from the holder profile's mock address; the
 * normalized input amount is computed with the token-config decimals. Campaign /
 * token-config minted totals map to their *AfterRaw view fields.
 */
export function mapMockReceipt(
  receipt: MockConvertedReceipt,
  holder: MockHolderProfile,
  tokenConfig: MockTokenConfig,
): RedaxReceiptView {
  return {
    identity: { kind: 'mock-receipt-id', mockReceiptId: receipt.id, mockOnly: true },
    event: receipt.event,
    campaignId: receipt.campaignId,
    tokenConfigId: receipt.tokenConfigId,
    holderId: receipt.holderId,
    user: holder.mockAddress,
    inputMint: receipt.inputMint,
    outputMint: receipt.outputMint,
    amountInRaw: receipt.amountInRaw,
    amountInNormalizedRaw: normalizedAmountInRawString(
      receipt.amountInRaw,
      tokenConfig.legacyDecimals,
      tokenConfig.outputDecimals,
    ),
    normalizationRemainderRaw: receipt.normalizationRemainderRaw,
    grossOutRaw: receipt.grossOutRaw,
    feeOutRaw: receipt.feeOutRaw,
    userOutRaw: receipt.userOutRaw,
    campaignTotalOutputMintedAfterRaw: receipt.totalOutputMintedAfterRaw,
    tokenConfigTotalOutputMintedAfterRaw: receipt.tokenConfigOutputMintedAfterRaw,
    timestamp: receipt.timestamp,
    note: receipt.note,
  }
}

// --- Directory / rejection --------------------------------------------------

/** MockCampaignDirectoryRow -> RedaxDirectoryRowView. Direct mapping; sortPriority preserved. */
export function mapMockDirectoryRow(row: MockCampaignDirectoryRow): RedaxDirectoryRowView {
  return {
    campaignId: row.campaignId,
    projectId: row.projectId,
    projectName: row.projectName,
    symbol: row.symbol,
    profile: row.profile,
    programStatus: row.programStatus,
    displayStatus: row.displayStatus,
    holderEligible: row.holderEligible,
    holderBalanceRaw: row.holderBalanceRaw,
    capUtilizationBps: row.capUtilizationBps,
    endsInSeconds: row.endsInSeconds,
    proofCompletenessPercent: row.proofCompletenessPercent,
    sortPriority: row.sortPriority,
  }
}

/**
 * MockRejectionReason -> RedaxRejectionReason. Direct mapping; the program error
 * is preserved as a plain string only (no IDL / program import). The Mock and
 * Redax rejection-code unions are identical, so the code maps through directly.
 */
export function mapMockRejectionReason(reason: MockRejectionReason): RedaxRejectionReason {
  return {
    code: reason.code,
    label: reason.label,
    detail: reason.detail,
    preBurn: true,
    programError: reason.programError,
  }
}
