// REDAX mock dynamic data — projects, campaigns, and token configs (fixtures).
//
// Boundary note: everything in this file is local mock data only. No project,
// token, mint, or address here is real or affiliated. These fixtures exist so
// the multi-project migration surface can be designed and exercised locally;
// they must be replaced or disabled when a real program adapter is wired for
// devnet mode. Raw amounts are decimal strings, handled with BigInt math only.
//
// Pubkey-shaped values use the mock form `mock-pubkey:<kind>:<slug>` so they can
// never be mistaken for real on-chain accounts.

import type {
  MockCampaign,
  MockEnvironmentState,
  MockProject,
  MockProtocolConfig,
  MockTokenConfig,
} from '../types/redaxMock'

// --- Protocol-wide mock constants ------------------------------------------

/** Protocol fee, in basis points (mirrors the on-chain PROTOCOL_FEE_BPS = 100). */
export const MOCK_PROTOCOL_FEE_BPS = 100

/** Basis-point denominator (mirrors the on-chain BPS_DENOMINATOR = 10_000). */
export const MOCK_BPS_DENOMINATOR = 10_000

/**
 * Program limit: a campaign accepts at most 10 TokenConfig accounts, all into
 * one output mint (mirrors add_token_config's token_config_count < 10 guard).
 */
export const MOCK_MAX_TOKEN_CONFIGS_PER_CAMPAIGN = 10

/** A fixed mock "now" (Unix seconds) so relative windows render deterministically. */
export const MOCK_NOW_TS = 1_780_000_000

const DAY = 86_400

export const MOCK_PROTOCOL_CONFIG: MockProtocolConfig = {
  protocolFeeAuthority: 'mock-pubkey:authority:protocol-fee',
  protocolEmergencyPauseAuthority: 'mock-pubkey:authority:protocol-pause',
  protocolFeeBps: MOCK_PROTOCOL_FEE_BPS,
  bpsDenominator: MOCK_BPS_DENOMINATOR,
  mockOnly: true,
}

export const MOCK_ENVIRONMENT_STATE: MockEnvironmentState = {
  mode: 'MOCK_LOCAL',
  dataSource: 'mock-fixtures',
  mockDataEnabled: true,
  devnetDataRequiresProgramAdapter: true,
  boundaryLabel: 'Local mock fixtures — not chain data',
  note: 'Every campaign, holder, and receipt on this surface is a local mock fixture. There is no wallet, no chain read, and no network access. Devnet mode requires a real program adapter and would not use this data.',
}

// --- Projects --------------------------------------------------------------

export const MOCK_PROJECTS: readonly MockProject[] = [
  {
    id: 'astrapup',
    name: 'AstraPup Migration',
    profile: 'meme-community',
    symbol: 'ASTRA',
    tagline: 'Community meme token consolidating an old supply into a clean v2 mint.',
    teamPersona: 'clean-active',
    proofCompletenessPercent: 64,
    proofLabel: 'Core proofs published',
    mockOnly: true,
  },
  {
    id: 'civicloop',
    name: 'CivicLoop DAO Upgrade',
    profile: 'dao-governance',
    symbol: 'CIVIC',
    tagline: 'Governance token migrating ahead of a scheduled DAO upgrade window.',
    teamPersona: 'metadata-pending',
    proofCompletenessPercent: 30,
    proofLabel: 'Proof setup pending',
    mockOnly: true,
  },
  {
    id: 'arcadeforge',
    name: 'ArcadeForge S2',
    profile: 'game-token',
    symbol: 'ARC',
    tagline: 'Game economy token rolling its season-1 supply into a season-2 mint.',
    teamPersona: 'near-cap',
    proofCompletenessPercent: 88,
    proofLabel: 'Proofs near complete',
    mockOnly: true,
  },
  {
    id: 'heliomesh',
    name: 'HelioMesh Infra',
    profile: 'infra-token',
    symbol: 'HELIO',
    tagline: 'Infrastructure token with a migration paused while an issue is resolved.',
    teamPersona: 'paused-issue',
    proofCompletenessPercent: 52,
    proofLabel: 'Proofs partial — paused',
    mockOnly: true,
  },
  {
    id: 'novarift',
    name: 'NovaRift Relaunch',
    profile: 'distressed-relaunch',
    symbol: 'NOVA',
    tagline: 'Distressed project relaunch whose migration window has closed.',
    teamPersona: 'finalized',
    proofCompletenessPercent: 95,
    proofLabel: 'Proofs complete — finalized',
    mockOnly: true,
  },
  {
    id: 'embervault',
    name: 'EmberVault Recovery',
    profile: 'distressed-relaunch',
    symbol: 'EMBER',
    tagline: 'Recovery rebrand whose supported config reached its output cap.',
    teamPersona: 'unsupported-misconfigured',
    proofCompletenessPercent: 41,
    proofLabel: 'Supported config capped; a secondary config was rejected',
    mockOnly: true,
  },
  {
    id: 'pulsegrid',
    name: 'PulseGrid Migration',
    profile: 'infra-token',
    symbol: 'PULSE',
    tagline: 'Infrastructure token running a clean, open migration with cap headroom.',
    teamPersona: 'clean-active',
    proofCompletenessPercent: 78,
    proofLabel: 'Core proofs published',
    mockOnly: true,
  },
]

// --- Campaigns -------------------------------------------------------------
// Output amounts are output-decimal base units. capUtilizationBps is derived in
// the selectors from totalOutputMintedRaw / maxOutputSupplyRaw.

export const MOCK_CAMPAIGNS: readonly MockCampaign[] = [
  {
    id: 'campaign-astrapup',
    projectId: 'astrapup',
    name: 'AstraPup v2 conversion',
    programStatus: 'active',
    displayStatus: 'active',
    oldMintLabel: 'ASTRA (legacy)',
    oldMint: 'mock-pubkey:mint:astra-old',
    outputMintLabel: 'ASTRA v2',
    outputMint: 'mock-pubkey:mint:astra-new',
    protocolFeeVault: 'mock-pubkey:vault:astrapup',
    metadataSetup: true,
    startTs: MOCK_NOW_TS - 5 * DAY,
    endTs: MOCK_NOW_TS + 20 * DAY,
    maxOutputSupplyRaw: '1000000000000', // 1,000,000 @ 6 decimals
    totalOutputMintedRaw: '250000000000', // 250,000 @ 6 decimals -> ~25%
    statusNote: 'Open and converting; cap and window both have headroom.',
    sortPriority: 1,
    mockOnly: true,
  },
  {
    id: 'campaign-arcadeforge',
    projectId: 'arcadeforge',
    name: 'ArcadeForge S2 conversion',
    programStatus: 'active',
    displayStatus: 'cap_near',
    oldMintLabel: 'ARC S1',
    oldMint: 'mock-pubkey:mint:arcade-old',
    outputMintLabel: 'ARC S2',
    outputMint: 'mock-pubkey:mint:arcade-new',
    protocolFeeVault: 'mock-pubkey:vault:arcadeforge',
    metadataSetup: true,
    startTs: MOCK_NOW_TS - 10 * DAY,
    endTs: MOCK_NOW_TS + 3 * DAY,
    maxOutputSupplyRaw: '2000000000000', // 2,000,000 @ 6 decimals
    totalOutputMintedRaw: '1900000000000', // 1,900,000 @ 6 decimals -> 95%
    statusNote: 'Active but close to the output cap; remaining headroom is small.',
    sortPriority: 2,
    mockOnly: true,
  },
  {
    id: 'campaign-pulsegrid',
    projectId: 'pulsegrid',
    name: 'PulseGrid migration',
    programStatus: 'active',
    displayStatus: 'active',
    oldMintLabel: 'PULSE (legacy)',
    oldMint: 'mock-pubkey:mint:pulse-old',
    outputMintLabel: 'PULSE v2',
    outputMint: 'mock-pubkey:mint:pulse-new',
    protocolFeeVault: 'mock-pubkey:vault:pulsegrid',
    metadataSetup: true,
    startTs: MOCK_NOW_TS - 8 * DAY,
    endTs: MOCK_NOW_TS + 25 * DAY,
    maxOutputSupplyRaw: '600000000000', // 600,000 @ 6 decimals
    totalOutputMintedRaw: '180000000000', // 180,000 @ 6 decimals -> 30%
    statusNote: 'Open and converting; broad cap and window headroom.',
    sortPriority: 3,
    mockOnly: true,
  },
  {
    id: 'campaign-embervault',
    projectId: 'embervault',
    name: 'EmberVault recovery conversion',
    programStatus: 'active',
    displayStatus: 'cap_reached',
    oldMintLabel: 'EMBER (legacy)',
    oldMint: 'mock-pubkey:mint:ember-old',
    outputMintLabel: 'EMBER v2',
    outputMint: 'mock-pubkey:mint:ember-new',
    protocolFeeVault: 'mock-pubkey:vault:embervault',
    metadataSetup: true,
    startTs: MOCK_NOW_TS - 12 * DAY,
    endTs: MOCK_NOW_TS + 8 * DAY,
    maxOutputSupplyRaw: '800000000000000', // 800,000 @ 9 decimals
    totalOutputMintedRaw: '800000000000000', // 800,000 @ 9 decimals -> 100%
    statusNote: 'Output cap reached; further conversions are rejected before any burn.',
    sortPriority: 4,
    mockOnly: true,
  },
  {
    id: 'campaign-heliomesh',
    projectId: 'heliomesh',
    name: 'HelioMesh infra conversion',
    programStatus: 'paused',
    displayStatus: 'paused',
    oldMintLabel: 'HELIO (legacy)',
    oldMint: 'mock-pubkey:mint:helio-old',
    outputMintLabel: 'HELIO v2',
    outputMint: 'mock-pubkey:mint:helio-new',
    protocolFeeVault: 'mock-pubkey:vault:heliomesh',
    metadataSetup: true,
    startTs: MOCK_NOW_TS - 15 * DAY,
    endTs: null, // open window; paused by the campaign admin
    maxOutputSupplyRaw: '750000000000000', // 750,000 @ 9 decimals
    totalOutputMintedRaw: '300000000000000', // 300,000 @ 9 decimals -> 40%
    statusNote: 'Paused by the campaign admin; conversions are rejected while paused.',
    sortPriority: 5,
    mockOnly: true,
  },
  {
    id: 'campaign-civicloop',
    projectId: 'civicloop',
    name: 'CivicLoop DAO upgrade conversion',
    programStatus: 'initialized',
    displayStatus: 'upcoming',
    oldMintLabel: 'CIVIC (legacy)',
    oldMint: 'mock-pubkey:mint:civic-old',
    outputMintLabel: 'CIVIC v2',
    outputMint: 'mock-pubkey:mint:civic-new',
    protocolFeeVault: 'mock-pubkey:vault:civicloop',
    metadataSetup: false,
    startTs: MOCK_NOW_TS + 7 * DAY,
    endTs: MOCK_NOW_TS + 37 * DAY,
    maxOutputSupplyRaw: '500000000000000', // 500,000 @ 9 decimals
    totalOutputMintedRaw: '0',
    statusNote: 'Initialized but not yet active; metadata setup is still pending.',
    sortPriority: 6,
    mockOnly: true,
  },
  {
    id: 'campaign-novarift',
    projectId: 'novarift',
    name: 'NovaRift relaunch conversion',
    programStatus: 'finalized',
    displayStatus: 'finalized',
    oldMintLabel: 'NOVA (legacy)',
    oldMint: 'mock-pubkey:mint:nova-old',
    outputMintLabel: 'NOVA v2',
    outputMint: 'mock-pubkey:mint:nova-new',
    protocolFeeVault: 'mock-pubkey:vault:novarift',
    metadataSetup: true,
    startTs: MOCK_NOW_TS - 60 * DAY,
    endTs: MOCK_NOW_TS - 5 * DAY,
    maxOutputSupplyRaw: '1500000000000', // 1,500,000 @ 6 decimals
    totalOutputMintedRaw: '1350000000000', // 1,350,000 @ 6 decimals -> 90%
    statusNote: 'Finalized; the window has closed and no further conversions are accepted.',
    sortPriority: 7,
    mockOnly: true,
  },
]

// --- Token configs ---------------------------------------------------------
// Campaigns can have one or more accepted input TokenConfigs. One campaign may
// accept up to 10 classic-SPL legacy input configs into one output mint; each
// conversion still uses one selected token config, and this mock does not model
// a bundled multi-token transaction. AstraPup demonstrates 4 accepted
// classic-SPL inputs under one campaign. The program limit is 10 TokenConfigs
// per campaign. tokenProgram is classic-spl for every supported config; Phase 1
// remains classic SPL only and any other token program is surfaced through
// rejection data, never by marking it supported here.

export const MOCK_TOKEN_CONFIGS: readonly MockTokenConfig[] = [
  // AstraPup accepts four classic-SPL legacy inputs into one output mint
  // (ASTRA v2). Per-config caps sum to the campaign maxOutputSupplyRaw
  // (1,000,000 @ 6) and per-config minted totals sum to the campaign
  // totalOutputMintedRaw (250,000 @ 6). Each input still converts on its own.
  {
    id: 'tc-astrapup',
    campaignId: 'campaign-astrapup',
    legacyMint: 'mock-pubkey:mint:astra-old',
    legacyMintLabel: 'ASTRA (legacy)',
    rateNumeratorRaw: '1',
    rateDenominatorRaw: '1',
    legacyDecimals: 9,
    outputDecimals: 6,
    maxOutputFromTokenConfigRaw: '500000000000', // 500,000 @ 6 decimals
    totalOutputMintedFromTokenConfigRaw: '160000000000', // 160,000 @ 6 decimals
    normalizationRemainderTotalRaw: '0',
    tokenProgram: 'classic-spl',
    mockOnly: true,
  },
  {
    id: 'tc-astrapup-points',
    campaignId: 'campaign-astrapup',
    legacyMint: 'mock-pubkey:mint:pastra-points',
    legacyMintLabel: 'pASTRA points',
    rateNumeratorRaw: '1', // 1 output unit per 20 input units
    rateDenominatorRaw: '20',
    legacyDecimals: 6,
    outputDecimals: 6,
    maxOutputFromTokenConfigRaw: '150000000000', // 150,000 @ 6 decimals
    totalOutputMintedFromTokenConfigRaw: '30000000000', // 30,000 @ 6 decimals
    normalizationRemainderTotalRaw: '0',
    tokenProgram: 'classic-spl',
    mockOnly: true,
  },
  {
    id: 'tc-astrapup-escrow',
    campaignId: 'campaign-astrapup',
    legacyMint: 'mock-pubkey:mint:xastra-escrow',
    legacyMintLabel: 'xASTRA escrow',
    rateNumeratorRaw: '2', // 2 output units per 1 input unit
    rateDenominatorRaw: '1',
    legacyDecimals: 6,
    outputDecimals: 6,
    maxOutputFromTokenConfigRaw: '250000000000', // 250,000 @ 6 decimals
    totalOutputMintedFromTokenConfigRaw: '40000000000', // 40,000 @ 6 decimals
    normalizationRemainderTotalRaw: '0',
    tokenProgram: 'classic-spl',
    mockOnly: true,
  },
  {
    id: 'tc-astrapup-receipt',
    campaignId: 'campaign-astrapup',
    legacyMint: 'mock-pubkey:mint:astra-community-receipt',
    legacyMintLabel: 'ASTRA community receipt',
    rateNumeratorRaw: '1', // 1 output unit per 5 input units
    rateDenominatorRaw: '5',
    legacyDecimals: 6,
    outputDecimals: 6,
    maxOutputFromTokenConfigRaw: '100000000000', // 100,000 @ 6 decimals
    totalOutputMintedFromTokenConfigRaw: '20000000000', // 20,000 @ 6 decimals
    normalizationRemainderTotalRaw: '0',
    tokenProgram: 'classic-spl',
    mockOnly: true,
  },
  {
    id: 'tc-arcadeforge',
    campaignId: 'campaign-arcadeforge',
    legacyMint: 'mock-pubkey:mint:arcade-old',
    legacyMintLabel: 'ARC S1',
    rateNumeratorRaw: '3',
    rateDenominatorRaw: '2',
    legacyDecimals: 6,
    outputDecimals: 6,
    maxOutputFromTokenConfigRaw: '2000000000000',
    totalOutputMintedFromTokenConfigRaw: '1900000000000',
    normalizationRemainderTotalRaw: '0',
    tokenProgram: 'classic-spl',
    mockOnly: true,
  },
  {
    id: 'tc-pulsegrid',
    campaignId: 'campaign-pulsegrid',
    legacyMint: 'mock-pubkey:mint:pulse-old',
    legacyMintLabel: 'PULSE (legacy)',
    rateNumeratorRaw: '1',
    rateDenominatorRaw: '1',
    legacyDecimals: 6,
    outputDecimals: 6,
    maxOutputFromTokenConfigRaw: '600000000000',
    totalOutputMintedFromTokenConfigRaw: '180000000000',
    normalizationRemainderTotalRaw: '0',
    tokenProgram: 'classic-spl',
    mockOnly: true,
  },
  {
    id: 'tc-embervault',
    campaignId: 'campaign-embervault',
    legacyMint: 'mock-pubkey:mint:ember-old',
    legacyMintLabel: 'EMBER (legacy)',
    rateNumeratorRaw: '1',
    rateDenominatorRaw: '1',
    legacyDecimals: 9,
    outputDecimals: 9,
    maxOutputFromTokenConfigRaw: '800000000000000',
    totalOutputMintedFromTokenConfigRaw: '800000000000000',
    normalizationRemainderTotalRaw: '0',
    tokenProgram: 'classic-spl',
    mockOnly: true,
  },
  {
    id: 'tc-heliomesh',
    campaignId: 'campaign-heliomesh',
    legacyMint: 'mock-pubkey:mint:helio-old',
    legacyMintLabel: 'HELIO (legacy)',
    rateNumeratorRaw: '1',
    rateDenominatorRaw: '4',
    legacyDecimals: 9,
    outputDecimals: 9,
    maxOutputFromTokenConfigRaw: '750000000000000',
    totalOutputMintedFromTokenConfigRaw: '300000000000000',
    normalizationRemainderTotalRaw: '0',
    tokenProgram: 'classic-spl',
    mockOnly: true,
  },
  {
    id: 'tc-civicloop',
    campaignId: 'campaign-civicloop',
    legacyMint: 'mock-pubkey:mint:civic-old',
    legacyMintLabel: 'CIVIC (legacy)',
    rateNumeratorRaw: '1',
    rateDenominatorRaw: '1',
    legacyDecimals: 6,
    outputDecimals: 9,
    maxOutputFromTokenConfigRaw: '500000000000000',
    totalOutputMintedFromTokenConfigRaw: '0',
    normalizationRemainderTotalRaw: '0',
    tokenProgram: 'classic-spl',
    mockOnly: true,
  },
  {
    id: 'tc-novarift',
    campaignId: 'campaign-novarift',
    legacyMint: 'mock-pubkey:mint:nova-old',
    legacyMintLabel: 'NOVA (legacy)',
    rateNumeratorRaw: '1',
    rateDenominatorRaw: '1',
    legacyDecimals: 6,
    outputDecimals: 6,
    maxOutputFromTokenConfigRaw: '1500000000000',
    totalOutputMintedFromTokenConfigRaw: '1350000000000',
    normalizationRemainderTotalRaw: '0',
    tokenProgram: 'classic-spl',
    mockOnly: true,
  },
]
