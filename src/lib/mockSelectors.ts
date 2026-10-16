// REDAX mock dynamic data — pure selectors / helpers over the local fixtures.

import type {
  MockCampaign,
  MockCampaignDirectoryRow,
  MockCampaignInputConfigRow,
  MockCampaignInputSummary,
  MockCampaignStatus,
  MockConversionQuote,
  MockConvertedReceipt,
  MockEnvironmentState,
  MockHolderBalance,
  MockHolderCampaignEligibility,
  MockHolderInputPosition,
  MockHolderProfile,
  MockProject,
  MockProtocolConfig,
  MockRejectionCode,
  MockRejectionReason,
  MockTokenConfig,
  RawAmount,
} from '../types/redaxMock'
import {
  MOCK_BPS_DENOMINATOR,
  MOCK_CAMPAIGNS,
  MOCK_ENVIRONMENT_STATE,
  MOCK_MAX_TOKEN_CONFIGS_PER_CAMPAIGN,
  MOCK_NOW_TS,
  MOCK_PROJECTS,
  MOCK_PROTOCOL_CONFIG,
  MOCK_TOKEN_CONFIGS,
} from '../mock/projects'
import { MOCK_HOLDER_BALANCES, MOCK_HOLDER_PROFILES } from '../mock/holders'
import { MOCK_CONVERTED_RECEIPTS } from '../mock/receipts'
import {
  calculateConversionQuote,
  evaluateCapProjection,
  parseRawAmount as parseRaw,
} from './quoteMath'

// --- Integer-safe raw-amount helpers ---------------------------------------
//
// The pow10 / parseRaw / normalize / fee primitives now live in the shared,
// dependency-free ./quoteMath oracle (parseRaw is the imported parseRawAmount).
// Cap utilization below stays a display-only basis-point ratio, distinct from
// the pre-burn cap projection in ./quoteMath used by the conversion quote.

/** Cap utilization in basis points (display-only); 0 means uncapped, capped at 10000. */
function capUtilizationBps(campaign: MockCampaign): number {
  const cap = parseRaw(campaign.maxOutputSupplyRaw)
  if (cap === 0n) {
    return 0
  }
  const minted = parseRaw(campaign.totalOutputMintedRaw)
  const bps = Number((minted * 10000n) / cap)
  return bps > 10000 ? 10000 : bps
}

/** Per-TokenConfig cap utilization in basis points (display-only); capped at 10000. */
function tokenConfigCapUtilizationBps(tc: MockTokenConfig): number {
  const cap = parseRaw(tc.maxOutputFromTokenConfigRaw)
  if (cap === 0n) {
    return 0
  }
  const minted = parseRaw(tc.totalOutputMintedFromTokenConfigRaw)
  const bps = Number((minted * 10000n) / cap)
  return bps > 10000 ? 10000 : bps
}

function findHolderBalance(holderId: string, legacyMint: string): MockHolderBalance | undefined {
  return MOCK_HOLDER_BALANCES.find((b) => b.holderId === holderId && b.legacyMint === legacyMint)
}

function findHolderProfile(holderId: string): MockHolderProfile | undefined {
  return MOCK_HOLDER_PROFILES.find((h) => h.id === holderId)
}

// --- Rejection library (aligned to the Phase 1 ErrorCode catalog) -----------

const REJECTION_LIBRARY: Record<
  MockRejectionCode,
  { label: string; programError?: string; detail: string }
> = {
  unsupported_token_program: {
    label: 'Unsupported token program',
    programError: 'WrongTokenProgram',
    detail: 'Phase 1 accepts classic SPL only; any other token program is rejected before any burn.',
  },
  campaign_not_active: {
    label: 'Campaign not active',
    programError: 'CampaignNotActive',
    detail: 'The campaign must be Active to convert.',
  },
  campaign_expired: {
    label: 'Campaign window closed',
    programError: 'CampaignExpired',
    detail: 'The conversion window has passed its deadline.',
  },
  cap_reached: {
    label: 'Output cap reached',
    programError: 'CapExceededCampaign',
    detail: 'The campaign output cap is reached; no further output can be minted.',
  },
  metadata_not_ready: {
    label: 'Metadata not ready',
    programError: 'MetadataNotSet',
    detail: 'Output-mint metadata setup is not complete for this campaign.',
  },
  output_ata_missing: {
    label: 'Output token account missing',
    programError: 'UserOutputAtaNotFound',
    detail: 'The holder output token account must be prepared before converting.',
  },
  zero_amount: {
    label: 'Zero amount',
    programError: 'ZeroAmount',
    detail: 'The conversion amount must be greater than zero.',
  },
  amount_too_small: {
    label: 'Amount too small',
    programError: 'ZeroGrossOut',
    detail: 'The amount is too small to produce any output at the configured rate.',
  },
  holder_not_eligible: {
    label: 'Holder not eligible',
    detail: 'The holder does not meet the eligibility conditions for this campaign.',
  },
  finalized_campaign: {
    label: 'Campaign finalized',
    programError: 'CampaignNotActive',
    detail: 'The campaign is finalized; no further conversions are accepted.',
  },
  upcoming_campaign: {
    label: 'Campaign not started',
    programError: 'CampaignNotActive',
    detail: 'The campaign is not active yet; it has not started.',
  },
  paused_campaign: {
    label: 'Campaign paused',
    programError: 'CampaignNotActive',
    detail: 'The campaign is paused; conversions are rejected while paused.',
  },
  wrong_mint: {
    label: 'Wrong mint',
    programError: 'WrongLegacyMint',
    detail: 'The holder balance is in a mint this campaign does not accept.',
  },
  zero_balance: {
    label: 'No eligible balance',
    detail: 'The selected mock holder has no accepted old-token balance for this campaign; nothing can be converted.',
  },
}

function makeRejection(code: MockRejectionCode, programErrorOverride?: string): MockRejectionReason {
  const entry = REJECTION_LIBRARY[code]
  return {
    code,
    label: entry.label,
    programError: programErrorOverride ?? entry.programError,
    preBurn: true,
    detail: entry.detail,
  }
}

// --- Basic fixture accessors -----------------------------------------------

export function getProjects(): readonly MockProject[] {
  return MOCK_PROJECTS
}

export function getProjectById(projectId: string): MockProject | undefined {
  return MOCK_PROJECTS.find((p) => p.id === projectId)
}

export function getCampaigns(): readonly MockCampaign[] {
  return MOCK_CAMPAIGNS
}

export function getCampaignById(campaignId: string): MockCampaign | undefined {
  return MOCK_CAMPAIGNS.find((c) => c.id === campaignId)
}

export function getCampaignsByStatus(status: MockCampaignStatus): readonly MockCampaign[] {
  return MOCK_CAMPAIGNS.filter((c) => c.displayStatus === status)
}

// One campaign may accept up to 10 classic-SPL legacy input configs into one
// output mint. Each conversion still uses one selected token config; this mock
// does not model a bundled multi-token transaction.

/** True when this config is the campaign's primary input (legacyMint == oldMint). */
function isPrimaryConfig(campaign: MockCampaign, tc: MockTokenConfig): boolean {
  return tc.legacyMint === campaign.oldMint
}

/** All accepted-input token configs for a campaign, stable order, primary first. */
export function getTokenConfigsForCampaign(campaignId: string): readonly MockTokenConfig[] {
  const configs = MOCK_TOKEN_CONFIGS.filter((tc) => tc.campaignId === campaignId)
  const campaign = getCampaignById(campaignId)
  if (!campaign) {
    return configs
  }
  // Stable sort (Array.prototype.sort is stable): primary first, then fixture order.
  return [...configs].sort((a, b) => {
    const aPrimary = isPrimaryConfig(campaign, a) ? 0 : 1
    const bPrimary = isPrimaryConfig(campaign, b) ? 0 : 1
    return aPrimary - bPrimary
  })
}

/**
 * The campaign's primary (first) accepted-input token config — backward-compatible
 * for surfaces that still show a single config.
 */
export function getTokenConfigForCampaign(campaignId: string): MockTokenConfig | undefined {
  return getTokenConfigsForCampaign(campaignId)[0]
}

/** Count of accepted-input token configs for a campaign (program limit is 10). */
export function getAcceptedInputCountForCampaign(campaignId: string): number {
  return getTokenConfigsForCampaign(campaignId).length
}

/** Flattened, display-shaped rows for every accepted input of a campaign. */
export function getCampaignInputConfigRows(campaignId: string): readonly MockCampaignInputConfigRow[] {
  const campaign = getCampaignById(campaignId)
  if (!campaign) {
    return []
  }
  return getTokenConfigsForCampaign(campaignId).map((tc): MockCampaignInputConfigRow => ({
    campaignId: campaign.id,
    tokenConfigId: tc.id,
    legacyMint: tc.legacyMint,
    legacyMintLabel: tc.legacyMintLabel ?? campaign.oldMintLabel,
    outputMint: campaign.outputMint,
    outputMintLabel: campaign.outputMintLabel,
    rateNumeratorRaw: tc.rateNumeratorRaw,
    rateDenominatorRaw: tc.rateDenominatorRaw,
    legacyDecimals: tc.legacyDecimals,
    outputDecimals: tc.outputDecimals,
    maxOutputFromTokenConfigRaw: tc.maxOutputFromTokenConfigRaw,
    totalOutputMintedFromTokenConfigRaw: tc.totalOutputMintedFromTokenConfigRaw,
    capUtilizationBps: tokenConfigCapUtilizationBps(tc),
    tokenProgram: tc.tokenProgram,
    isPrimary: isPrimaryConfig(campaign, tc),
    mockOnly: true,
  }))
}

/** Accepted-input summary for a campaign: one output mint, up to 10 inputs. */
export function getCampaignInputSummary(campaignId: string): MockCampaignInputSummary | undefined {
  const campaign = getCampaignById(campaignId)
  if (!campaign) {
    return undefined
  }
  const rows = getCampaignInputConfigRows(campaignId)
  return {
    campaignId: campaign.id,
    outputMint: campaign.outputMint,
    outputMintLabel: campaign.outputMintLabel,
    acceptedInputCount: rows.length,
    maxTokenConfigs: MOCK_MAX_TOKEN_CONFIGS_PER_CAMPAIGN,
    rows,
    mockOnly: true,
  }
}

export function getHolderProfiles(): readonly MockHolderProfile[] {
  return MOCK_HOLDER_PROFILES
}

export function getMockEnvironmentState(): MockEnvironmentState {
  return MOCK_ENVIRONMENT_STATE
}

export function getMockProtocolConfig(): MockProtocolConfig {
  return MOCK_PROTOCOL_CONFIG
}


/**
 * Quote for an explicitly selected token config (one selected input per
 * conversion). BigInt raw-amount math only; never throws on a bad denominator.
 */
export function calculateMockQuoteForTokenConfig(
  campaignId: string,
  tokenConfigId: string,
  holderId: string,
  amountInRaw: RawAmount,
): MockConversionQuote {
  const tc = MOCK_TOKEN_CONFIGS.find(
    (config) => config.id === tokenConfigId && config.campaignId === campaignId,
  )
  const base = {
    campaignId,
    tokenConfigId: tc?.id ?? tokenConfigId ?? 'unknown',
    holderId,
    amountInRaw,
    grossOutRaw: '0',
    feeOutRaw: '0',
    userOutRaw: '0',
    normalizationRemainderRaw: '0',
    mockOnly: true as const,
  }

  // Invalid token config / campaign pairing — surface a rejection, never throw.
  if (!tc) {
    return { ...base, rejectionReason: makeRejection('wrong_mint') }
  }

  // Program-faithful conversion math via the shared ./quoteMath oracle (never
  // throws). The distinct invalid_rate / amount_too_small quote kinds collapse
  // onto the existing 'amount_too_small' rejection code, preserving the prior
  // display behavior; only the cap-projection path below is new.
  const quote = calculateConversionQuote(
    parseRaw(amountInRaw),
    tc.legacyDecimals,
    tc.outputDecimals,
    parseRaw(tc.rateNumeratorRaw),
    parseRaw(tc.rateDenominatorRaw),
  )
  if (!quote.ok) {
    const code: MockRejectionCode =
      quote.rejection === 'zero_amount' ? 'zero_amount' : 'amount_too_small'
    return {
      ...base,
      normalizationRemainderRaw: quote.normalizationRemainder.toString(),
      rejectionReason: makeRejection(code),
    }
  }

  // Gross-output cap projection, mirroring convert_exact_in §14.5: a proposed
  // conversion that would push the campaign or token-config minted total past
  // its cap is rejected pre-burn (a campaign breach takes precedence). The
  // projection uses grossOut, not userOut; a cap of 0 is uncapped.
  const campaign = getCampaignById(campaignId)
  const projection = evaluateCapProjection(
    quote.amounts.grossOut,
    campaign ? parseRaw(campaign.maxOutputSupplyRaw) : 0n,
    campaign ? parseRaw(campaign.totalOutputMintedRaw) : 0n,
    parseRaw(tc.maxOutputFromTokenConfigRaw),
    parseRaw(tc.totalOutputMintedFromTokenConfigRaw),
  )
  if (!projection.ok) {
    const programError =
      projection.breach === 'campaign' ? 'CapExceededCampaign' : 'CapExceededTokenConfig'
    return {
      ...base,
      normalizationRemainderRaw: quote.amounts.normalizationRemainder.toString(),
      rejectionReason: makeRejection('cap_reached', programError),
    }
  }

  return {
    campaignId,
    tokenConfigId: tc.id,
    holderId,
    amountInRaw,
    grossOutRaw: quote.amounts.grossOut.toString(),
    feeOutRaw: quote.amounts.feeOut.toString(),
    userOutRaw: quote.amounts.userOut.toString(),
    normalizationRemainderRaw: quote.amounts.normalizationRemainder.toString(),
    mockOnly: true,
  }
}

/**
 * Quote against a campaign's primary input — backward-compatible wrapper over
 * calculateMockQuoteForTokenConfig for surfaces that show a single config.
 */
export function calculateMockQuote(
  campaignId: string,
  holderId: string,
  amountInRaw: RawAmount,
): MockConversionQuote {
  const primary = getTokenConfigForCampaign(campaignId)
  if (!primary) {
    return {
      campaignId,
      tokenConfigId: 'unknown',
      holderId,
      amountInRaw,
      grossOutRaw: '0',
      feeOutRaw: '0',
      userOutRaw: '0',
      normalizationRemainderRaw: '0',
      mockOnly: true,
      rejectionReason: makeRejection('wrong_mint'),
    }
  }
  return calculateMockQuoteForTokenConfig(campaignId, primary.id, holderId, amountInRaw)
}

// --- Eligibility ------------------------------------------------------------

/** The per-input evaluation a holder gets against one accepted TokenConfig. */
interface TokenConfigEvaluation {
  eligible: boolean
  balanceRaw: RawAmount
  outputAtaPrepared: boolean
  hasSupportedBalance: boolean
  rejectionReasons: MockRejectionReason[]
  quote?: MockConversionQuote
}

/**
 * Evaluate one accepted-input TokenConfig for a holder. All rejections are
 * pre-burn. A campaign with a single input reduces to the prior behavior; with
 * several inputs, each input is gated on its own balance, rate, and per-input cap.
 */
function evaluateTokenConfigForHolder(
  holderId: string,
  campaign: MockCampaign,
  tc: MockTokenConfig,
): TokenConfigEvaluation {
  const holder = findHolderProfile(holderId)
  const outputAtaPrepared = holder?.outputAtaPreparedByCampaignId[campaign.id] ?? false
  const rejectionReasons: MockRejectionReason[] = []

  const balance = findHolderBalance(holderId, tc.legacyMint)
  const balanceRaw: RawAmount = balance ? balance.amountRaw : '0'
  const campaignCapBps = capUtilizationBps(campaign)
  const configCapBps = tokenConfigCapUtilizationBps(tc)

  // Lifecycle gates (a conversion is rejected before any token moves).
  if (campaign.displayStatus === 'upcoming' || campaign.programStatus === 'initialized') {
    rejectionReasons.push(makeRejection('upcoming_campaign'))
  }
  if (campaign.displayStatus === 'paused' || campaign.programStatus === 'paused') {
    rejectionReasons.push(makeRejection('paused_campaign'))
  }
  if (campaign.displayStatus === 'finalized' || campaign.programStatus === 'finalized') {
    rejectionReasons.push(makeRejection('finalized_campaign'))
  }
  if (!campaign.metadataSetup || campaign.displayStatus === 'metadata_pending') {
    rejectionReasons.push(makeRejection('metadata_not_ready'))
  }
  // Either the campaign output cap or this input's own cap being reached blocks it.
  if (
    campaign.displayStatus === 'cap_reached' ||
    campaignCapBps >= MOCK_BPS_DENOMINATOR ||
    configCapBps >= MOCK_BPS_DENOMINATOR
  ) {
    rejectionReasons.push(makeRejection('cap_reached'))
  }

  // Token-program support (Phase 1 classic SPL only).
  if (tc.tokenProgram !== 'classic-spl') {
    rejectionReasons.push(makeRejection('unsupported_token_program'))
  }

  // Balance gates (for this specific input mint).
  if (!balance) {
    const holdsOtherMint = MOCK_HOLDER_BALANCES.some(
      (b) => b.holderId === holderId && parseRaw(b.amountRaw) > 0n,
    )
    rejectionReasons.push(makeRejection(holdsOtherMint ? 'wrong_mint' : 'zero_balance'))
  } else if (parseRaw(balance.amountRaw) === 0n) {
    rejectionReasons.push(makeRejection('zero_balance'))
  }

  // Output ATA requirement.
  if (!outputAtaPrepared) {
    rejectionReasons.push(makeRejection('output_ata_missing'))
  }

  const hasSupportedBalance = balance !== undefined && parseRaw(balance.amountRaw) > 0n
  const statusActive =
    campaign.programStatus === 'active' &&
    (campaign.displayStatus === 'active' || campaign.displayStatus === 'cap_near')
  const eligible =
    statusActive &&
    campaign.metadataSetup &&
    tc.tokenProgram === 'classic-spl' &&
    hasSupportedBalance &&
    outputAtaPrepared &&
    campaignCapBps < MOCK_BPS_DENOMINATOR &&
    configCapBps < MOCK_BPS_DENOMINATOR &&
    rejectionReasons.length === 0

  const quote = hasSupportedBalance
    ? calculateMockQuoteForTokenConfig(campaign.id, tc.id, holderId, balanceRaw)
    : undefined

  return { eligible, balanceRaw, outputAtaPrepared, hasSupportedBalance, rejectionReasons, quote }
}

/**
 * Campaign-level eligibility across every accepted input. A holder is eligible
 * if any one accepted input is convertible (the primary input is preferred when
 * it is eligible). When none is convertible, a representative position's reasons
 * are surfaced, de-duplicated by code in stable order. Each conversion still
 * uses one selected input; this does not model a bundled multi-token transaction.
 */
export function getHolderEligibilityForCampaign(
  holderId: string,
  campaignId: string,
): MockHolderCampaignEligibility {
  const campaign = getCampaignById(campaignId)
  const configs = getTokenConfigsForCampaign(campaignId)
  const holder = findHolderProfile(holderId)
  const outputAtaPrepared = holder?.outputAtaPreparedByCampaignId[campaignId] ?? false

  if (!campaign || configs.length === 0) {
    return {
      holderId,
      campaignId,
      eligible: false,
      balanceRaw: '0',
      outputAtaPrepared,
      rejectionReasons: [makeRejection('wrong_mint')],
    }
  }

  const evaluations = configs.map((tc) => ({
    primary: isPrimaryConfig(campaign, tc),
    result: evaluateTokenConfigForHolder(holderId, campaign, tc),
  }))

  // Eligible if any input is convertible; prefer the primary input when eligible.
  const eligibleChoice =
    evaluations.find((e) => e.primary && e.result.eligible) ??
    evaluations.find((e) => e.result.eligible)

  if (eligibleChoice) {
    return {
      holderId,
      campaignId,
      eligible: true,
      balanceRaw: eligibleChoice.result.balanceRaw,
      outputAtaPrepared: eligibleChoice.result.outputAtaPrepared,
      rejectionReasons: [],
      quote: eligibleChoice.result.quote,
    }
  }

  // Not convertible via any input — surface a representative position: the
  // primary when it carries a balance, else the first input that does, else the
  // primary. Reasons are de-duplicated by code in stable order.
  const primaryEval = evaluations.find((e) => e.primary) ?? evaluations[0]
  const withBalance = evaluations.find((e) => e.result.hasSupportedBalance)
  const chosen = primaryEval.result.hasSupportedBalance ? primaryEval : (withBalance ?? primaryEval)

  const seen = new Set<MockRejectionCode>()
  const rejectionReasons: MockRejectionReason[] = []
  for (const reason of chosen.result.rejectionReasons) {
    if (!seen.has(reason.code)) {
      seen.add(reason.code)
      rejectionReasons.push(reason)
    }
  }

  return {
    holderId,
    campaignId,
    eligible: false,
    balanceRaw: chosen.result.balanceRaw,
    outputAtaPrepared: chosen.result.outputAtaPrepared,
    rejectionReasons,
    quote: chosen.result.quote,
  }
}

/**
 * One row per accepted input for a campaign, personalized to a holder: balance,
 * output-ATA readiness, per-input eligibility, a display quote when a balance
 * exists, and the pre-burn reasons otherwise. Each row is a separate conversion.
 */
export function getHolderInputPositionsForCampaign(
  holderId: string,
  campaignId: string,
): readonly MockHolderInputPosition[] {
  const campaign = getCampaignById(campaignId)
  if (!campaign) {
    return []
  }
  return getTokenConfigsForCampaign(campaignId).map((tc): MockHolderInputPosition => {
    const evaluation = evaluateTokenConfigForHolder(holderId, campaign, tc)
    return {
      holderId,
      campaignId: campaign.id,
      tokenConfigId: tc.id,
      legacyMint: tc.legacyMint,
      legacyMintLabel: tc.legacyMintLabel ?? campaign.oldMintLabel,
      outputMint: campaign.outputMint,
      outputMintLabel: campaign.outputMintLabel,
      holderBalanceRaw: evaluation.balanceRaw,
      legacyDecimals: tc.legacyDecimals,
      outputDecimals: tc.outputDecimals,
      outputAtaPrepared: evaluation.outputAtaPrepared,
      eligible: evaluation.eligible,
      isPrimary: isPrimaryConfig(campaign, tc),
      quote: evaluation.quote,
      rejectionReasons: evaluation.rejectionReasons,
      mockOnly: true,
    }
  })
}

// --- Directory rows ---------------------------------------------------------

export function getCampaignDirectoryRows(holderId?: string): readonly MockCampaignDirectoryRow[] {
  return MOCK_CAMPAIGNS.map((campaign) => {
    const project = getProjectById(campaign.projectId)
    let holderEligible: boolean | null = null
    let holderBalanceRaw: RawAmount | null = null
    if (holderId) {
      const eligibility = getHolderEligibilityForCampaign(holderId, campaign.id)
      holderEligible = eligibility.eligible
      holderBalanceRaw = eligibility.balanceRaw
    }
    return {
      campaignId: campaign.id,
      projectId: campaign.projectId,
      projectName: project?.name ?? campaign.name,
      symbol: project?.symbol ?? '—',
      profile: project?.profile ?? 'infra-token',
      displayStatus: campaign.displayStatus,
      programStatus: campaign.programStatus,
      holderEligible,
      holderBalanceRaw,
      capUtilizationBps: capUtilizationBps(campaign),
      endsInSeconds: campaign.endTs === null ? null : campaign.endTs - MOCK_NOW_TS,
      proofCompletenessPercent: project?.proofCompletenessPercent ?? 0,
      sortPriority: campaign.sortPriority,
    }
  })
}

// --- Sorting / featured -----------------------------------------------------

export function sortCampaignsByEndingSoon(
  campaigns: readonly MockCampaign[] = MOCK_CAMPAIGNS,
): readonly MockCampaign[] {
  return [...campaigns].sort((a, b) => {
    if (a.endTs === null && b.endTs === null) {
      return a.sortPriority - b.sortPriority
    }
    if (a.endTs === null) {
      return 1
    }
    if (b.endTs === null) {
      return -1
    }
    return a.endTs - b.endTs
  })
}

export function sortCampaignsByEligibility(
  holderId: string,
  campaigns: readonly MockCampaign[] = MOCK_CAMPAIGNS,
): readonly MockCampaign[] {
  return [...campaigns].sort((a, b) => {
    const aRank = getHolderEligibilityForCampaign(holderId, a.id).eligible ? 0 : 1
    const bRank = getHolderEligibilityForCampaign(holderId, b.id).eligible ? 0 : 1
    if (aRank !== bRank) {
      return aRank - bRank
    }
    return a.sortPriority - b.sortPriority
  })
}

export function getFeaturedCampaigns(limit = 3): readonly MockCampaign[] {
  const open = MOCK_CAMPAIGNS.filter(
    (c) => c.displayStatus === 'active' || c.displayStatus === 'cap_near',
  )
  return [...open].sort((a, b) => a.sortPriority - b.sortPriority).slice(0, limit)
}

// --- Receipts ---------------------------------------------------------------

export function getReceiptsForCampaign(campaignId: string): readonly MockConvertedReceipt[] {
  return MOCK_CONVERTED_RECEIPTS.filter((r) => r.campaignId === campaignId)
}

export function getReceiptsForHolder(holderId: string): readonly MockConvertedReceipt[] {
  return MOCK_CONVERTED_RECEIPTS.filter((r) => r.holderId === holderId)
}

/** Receipts for one specific accepted input (token config) of a campaign. */
export function getReceiptsForTokenConfig(tokenConfigId: string): readonly MockConvertedReceipt[] {
  return MOCK_CONVERTED_RECEIPTS.filter((r) => r.tokenConfigId === tokenConfigId)
}
