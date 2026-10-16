// REDAX mock dynamic data — type model (Stage 0, local-only).
//
// Boundary: types only. No runtime data here, no network code, no wallet, no
// RPC, no program-backed source. Raw token amounts are decimal strings handled
// with BigInt math only — never floating point.

// --- Primitive aliases -----------------------------------------------------

/** A raw (base-unit) token amount as a decimal string; BigInt-safe, never a float. */
export type RawAmount = string

/** A public-key-shaped identifier. In mock data these are clearly-marked mock strings. */
export type PubkeyString = string

// --- Unions ----------------------------------------------------------------

/** Active data mode. Only MOCK_LOCAL carries data here; DEVNET is a placeholder. */
export type MockEnvironmentMode = 'MOCK_LOCAL' | 'DEVNET'

/** Where the surface's data comes from. Stage 0 is always mock-fixtures. */
export type MockDataSourceKind = 'mock-fixtures' | 'program-rpc'

/** Mirrors the on-chain CampaignStatus enum (Initialized / Active / Paused / Finalized). */
export type MockProgramCampaignStatus = 'initialized' | 'active' | 'paused' | 'finalized'

/** Product-facing display status — a superset of the program status with UI nuance. */
export type MockCampaignStatus =
  | 'upcoming'
  | 'active'
  | 'paused'
  | 'finalized'
  | 'cap_near'
  | 'cap_reached'
  | 'metadata_pending'

export type MockProjectProfile =
  | 'meme-community'
  | 'dao-governance'
  | 'game-token'
  | 'infra-token'
  | 'distressed-relaunch'

export type MockHolderPersona =
  | 'whale'
  | 'small-holder'
  | 'ineligible'
  | 'multi-project'
  | 'missing-output-ata'
  | 'zero-balance'

export type MockTeamPersona =
  | 'clean-active'
  | 'metadata-pending'
  | 'paused-issue'
  | 'near-cap'
  | 'finalized'
  | 'unsupported-misconfigured'

/**
 * Pre-burn rejection concepts, aligned to the program's guard checks and the
 * Phase 1 ErrorCode catalog. Every rejection is decided before any token moves.
 */
export type MockRejectionCode =
  | 'unsupported_token_program'
  | 'campaign_not_active'
  | 'campaign_expired'
  | 'cap_reached'
  | 'metadata_not_ready'
  | 'output_ata_missing'
  | 'zero_amount'
  | 'amount_too_small'
  | 'holder_not_eligible'
  | 'finalized_campaign'
  | 'upcoming_campaign'
  | 'paused_campaign'
  | 'wrong_mint'
  | 'zero_balance'

/** Token-program support. Phase 1 is classic SPL only; anything else is rejected. */
export type MockTokenProgramKind = 'classic-spl' | 'unsupported-token-program'

/** A holder's stored sort preference for the campaign directory. */
export type MockHolderSortPreference =
  | 'ending-soon'
  | 'eligibility'
  | 'cap-utilization'
  | 'proof-completeness'

// --- Interfaces ------------------------------------------------------------

/** A migrating project / token team. One project owns one or more campaigns. */
export interface MockProject {
  readonly id: string
  readonly name: string
  readonly profile: MockProjectProfile
  readonly symbol: string
  readonly tagline: string
  readonly teamPersona: MockTeamPersona
  /** 0–100 — how much of the project's published proof material is in place. */
  readonly proofCompletenessPercent: number
  readonly proofLabel: string
  readonly mockOnly: true
}

/** Protocol-level config (mirrors the on-chain ProtocolConfig + fee constants). */
export interface MockProtocolConfig {
  readonly protocolFeeAuthority: PubkeyString
  readonly protocolEmergencyPauseAuthority: PubkeyString
  readonly protocolFeeBps: number
  readonly bpsDenominator: number
  readonly mockOnly: true
}

/** A single migration campaign (mirrors the on-chain Campaign account). */
export interface MockCampaign {
  readonly id: string
  readonly projectId: string
  readonly name: string
  readonly programStatus: MockProgramCampaignStatus
  readonly displayStatus: MockCampaignStatus
  readonly oldMintLabel: string
  readonly oldMint: PubkeyString
  readonly outputMintLabel: string
  readonly outputMint: PubkeyString
  readonly protocolFeeVault: PubkeyString
  readonly metadataSetup: boolean
  readonly startTs: number
  /** Unix seconds, or null for an open window (on-chain Option<i64> == None). */
  readonly endTs: number | null
  readonly maxOutputSupplyRaw: RawAmount
  readonly totalOutputMintedRaw: RawAmount
  readonly statusNote: string
  /** Lower sorts earlier in the default directory order. */
  readonly sortPriority: number
  readonly mockOnly: true
}

/** A per-campaign accepted-input token config (mirrors the on-chain TokenConfig). */
export interface MockTokenConfig {
  readonly id: string
  readonly campaignId: string
  readonly legacyMint: PubkeyString
  /** Optional display label for this legacy input mint (e.g. "pASTRA points"). */
  readonly legacyMintLabel?: string
  readonly rateNumeratorRaw: RawAmount
  readonly rateDenominatorRaw: RawAmount
  readonly legacyDecimals: number
  readonly outputDecimals: number
  readonly maxOutputFromTokenConfigRaw: RawAmount
  readonly totalOutputMintedFromTokenConfigRaw: RawAmount
  readonly normalizationRemainderTotalRaw: RawAmount
  readonly tokenProgram: MockTokenProgramKind
  readonly mockOnly: true
}

/** A mock holder / wallet persona used to drive eligibility and directory views. */
export interface MockHolderProfile {
  readonly id: string
  readonly label: string
  readonly persona: MockHolderPersona
  readonly walletLabel: string
  readonly mockAddress: PubkeyString
  /** campaignId -> whether the holder's output ATA is already prepared. */
  readonly outputAtaPreparedByCampaignId: Readonly<Record<string, boolean>>
  readonly preferredSort: MockHolderSortPreference
}

/** A holder's balance in one legacy mint. */
export interface MockHolderBalance {
  readonly holderId: string
  readonly legacyMint: PubkeyString
  readonly amountRaw: RawAmount
  readonly decimals: number
}

/** A computed conversion quote (display-only; derives nothing on-chain). */
export interface MockConversionQuote {
  readonly campaignId: string
  readonly tokenConfigId: string
  readonly holderId: string
  readonly amountInRaw: RawAmount
  readonly grossOutRaw: RawAmount
  readonly feeOutRaw: RawAmount
  readonly userOutRaw: RawAmount
  readonly normalizationRemainderRaw: RawAmount
  readonly rejectionReason?: MockRejectionReason
  readonly mockOnly: true
}

/**
 * A mock conversion receipt. Shape conceptually maps to the on-chain Converted
 * event. It deliberately carries no on-chain transaction reference and no
 * external link — there is no real chain history behind these fixtures.
 */
export interface MockConvertedReceipt {
  readonly id: string
  readonly event: 'Converted'
  readonly mockOnly: true
  readonly campaignId: string
  readonly tokenConfigId: string
  readonly holderId: string
  readonly inputMint: PubkeyString
  readonly outputMint: PubkeyString
  readonly amountInRaw: RawAmount
  readonly grossOutRaw: RawAmount
  readonly feeOutRaw: RawAmount
  readonly userOutRaw: RawAmount
  readonly normalizationRemainderRaw: RawAmount
  readonly totalOutputMintedAfterRaw: RawAmount
  readonly tokenConfigOutputMintedAfterRaw: RawAmount
  readonly timestamp: number
  readonly note: string
}

/** A reason a conversion would be rejected, decided before any token movement. */
export interface MockRejectionReason {
  readonly code: MockRejectionCode
  readonly label: string
  /** The closest on-chain ErrorCode variant, when one maps directly. */
  readonly programError?: string
  readonly preBurn: true
  readonly detail: string
}

/** The data-mode / boundary state surfaced to the UI. */
export interface MockEnvironmentState {
  readonly mode: MockEnvironmentMode
  readonly dataSource: MockDataSourceKind
  readonly mockDataEnabled: boolean
  readonly devnetDataRequiresProgramAdapter: boolean
  readonly boundaryLabel: string
  readonly note: string
}

/** One row of the campaign directory, optionally personalized to a holder. */
export interface MockCampaignDirectoryRow {
  readonly campaignId: string
  readonly projectId: string
  readonly projectName: string
  readonly symbol: string
  readonly profile: MockProjectProfile
  readonly displayStatus: MockCampaignStatus
  readonly programStatus: MockProgramCampaignStatus
  /** null when no holder is selected. */
  readonly holderEligible: boolean | null
  /** null when no holder is selected. */
  readonly holderBalanceRaw: RawAmount | null
  readonly capUtilizationBps: number
  /** Seconds until the window closes; null for an open window. */
  readonly endsInSeconds: number | null
  readonly proofCompletenessPercent: number
  readonly sortPriority: number
}

/** A holder's eligibility for one campaign, with the reasons not to convert. */
export interface MockHolderCampaignEligibility {
  readonly holderId: string
  readonly campaignId: string
  readonly eligible: boolean
  readonly balanceRaw: RawAmount
  readonly outputAtaPrepared: boolean
  readonly rejectionReasons: readonly MockRejectionReason[]
  readonly quote?: MockConversionQuote
}

// --- Multi-token-config support --------------------------------------------
//
// One campaign may accept up to 10 classic-SPL legacy input configs into one
// output mint. Each conversion still uses one selected token config; this mock
// does not model a bundled multi-token transaction.

/** One accepted-input TokenConfig of a campaign, flattened for display. */
export interface MockCampaignInputConfigRow {
  readonly campaignId: string
  readonly tokenConfigId: string
  readonly legacyMint: PubkeyString
  readonly legacyMintLabel: string
  readonly outputMint: PubkeyString
  readonly outputMintLabel: string
  readonly rateNumeratorRaw: RawAmount
  readonly rateDenominatorRaw: RawAmount
  readonly legacyDecimals: number
  readonly outputDecimals: number
  readonly maxOutputFromTokenConfigRaw: RawAmount
  readonly totalOutputMintedFromTokenConfigRaw: RawAmount
  readonly capUtilizationBps: number
  readonly tokenProgram: MockTokenProgramKind
  /** True for the campaign's primary input (its legacyMint == campaign.oldMint). */
  readonly isPrimary: boolean
  readonly mockOnly: true
}

/** A holder's position against one accepted-input TokenConfig of a campaign. */
export interface MockHolderInputPosition {
  readonly holderId: string
  readonly campaignId: string
  readonly tokenConfigId: string
  readonly legacyMint: PubkeyString
  readonly legacyMintLabel: string
  readonly outputMint: PubkeyString
  readonly outputMintLabel: string
  readonly holderBalanceRaw: RawAmount
  readonly legacyDecimals: number
  readonly outputDecimals: number
  readonly outputAtaPrepared: boolean
  readonly eligible: boolean
  /** True for the campaign's primary input (its legacyMint == campaign.oldMint). */
  readonly isPrimary: boolean
  /** Display-only quote for this specific input, present when a balance exists. */
  readonly quote?: MockConversionQuote
  /** Pre-burn reasons this specific input cannot convert; empty when eligible. */
  readonly rejectionReasons: readonly MockRejectionReason[]
  readonly mockOnly: true
}

/** A campaign's accepted-input summary: one output mint, up to 10 inputs. */
export interface MockCampaignInputSummary {
  readonly campaignId: string
  readonly outputMint: PubkeyString
  readonly outputMintLabel: string
  readonly acceptedInputCount: number
  readonly maxTokenConfigs: number
  readonly rows: readonly MockCampaignInputConfigRow[]
  readonly mockOnly: true
}
