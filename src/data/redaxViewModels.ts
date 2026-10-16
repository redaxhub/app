// REDAX data-source view-model types only. Type-only: no runtime values, no
// adapter, no mapper, no RPC, no wallet, no fixtures, no readiness claim.

import type {
  RedaxCluster,
  RedaxDataMode,
  RedaxDataSourceKind,
  RedaxModeDescriptor,
} from './redaxModes'

// --- Primitive aliases -----------------------------------------------------

/** A raw (base-unit) token amount as a decimal string; BigInt-safe, never a float. */
export type RedaxRawAmount = string

/** A public-key-shaped identifier. In mock data these are clearly-marked mock strings. */
export type RedaxPubkeyString = string

/** A Unix-seconds timestamp. */
export type RedaxTimestamp = number

// --- Transport / data-layer error + result --------------------------------
//
// RedaxDataError is a transport/mode/fetch error: the data layer failed, was
// unavailable, or the mode/source was wrong. It is distinct from
// RedaxRejectionReason (below), which is a domain/eligibility/quote rejection
// decided before any token moves. The two are kept separate and never merged.

/** Which part of a surface a data error blocks. */
export type RedaxDataErrorBlock = 'display' | 'action'

/** Transport/mode/fetch error codes. Not domain rejections. */
export type RedaxDataErrorCode =
  | 'MODE_MISMATCH'
  | 'DEVNET_RPC_UNAVAILABLE'
  | 'ACCOUNT_NOT_FOUND'
  | 'WRONG_PROGRAM_ID'
  | 'IDL_MISMATCH'
  | 'UNSUPPORTED_TOKEN_PROGRAM'
  | 'MOCK_DATA_UNAVAILABLE'
  | 'WALLET_NOT_CONNECTED'
  | 'WRONG_AUTHORITY'
  | 'TX_UNAVAILABLE_READ_ONLY'
  | 'DEVNET_RECEIPTS_UNAVAILABLE'
  | 'NO_FALLBACK_ALLOWED'

/** A transport/mode/fetch failure surfaced by a future adapter. */
export interface RedaxDataError {
  code: RedaxDataErrorCode
  title: string
  detail: string
  recovery: string
  blocks: RedaxDataErrorBlock
  mode: RedaxDataMode
  source: RedaxDataSourceKind
  /** Optional plain name of a related on-chain error; no IDL/program import. */
  programErrorName?: string
}

/**
 * The authoritative result wrapper for every data-source read. Carries the
 * resolving mode/source so a screen can render the right boundary state, and an
 * optional `fetchedAt` stamp. Per-view source provenance is intentionally NOT
 * duplicated onto each view in this first edit; the result wrapper is the source.
 */
export type RedaxDataSourceResult<T> =
  | { ok: true; mode: RedaxDataMode; source: RedaxDataSourceKind; data: T; fetchedAt?: RedaxTimestamp }
  | { ok: false; mode: RedaxDataMode; source: RedaxDataSourceKind; error: RedaxDataError; fetchedAt?: RedaxTimestamp }

// --- Campaign / status / token-program unions ------------------------------

/** Mirrors the on-chain CampaignStatus variants (Initialized / Active / Paused / Finalized). */
export type RedaxProgramCampaignStatus =
  | 'initialized'
  | 'active'
  | 'paused'
  | 'finalized'

/** Product-facing display status — a superset of the program status with UI nuance. */
export type RedaxDisplayCampaignStatus =
  | 'upcoming'
  | 'active'
  | 'paused'
  | 'finalized'
  | 'cap_near'
  | 'cap_reached'
  | 'metadata_pending'

/**
 * Token-program support for an accepted input. Phase 1 is classic SPL only.
 * `unsupported-token-program` is a rejection/misconfiguration sentinel for any
 * non-classic input program — it is NOT support for extensions-based token
 * programs. No supported value beyond classic SPL is introduced here.
 */
export type RedaxTokenProgramKind =
  | 'classic-spl'
  | 'unsupported-token-program'

// --- Receipt identity ------------------------------------------------------

/**
 * Receipt identity as a discriminated union so a mock receipt id and a real
 * devnet signature can never be confused. The mock arm carries `mockOnly: true`
 * and no explorer link; the devnet arm carries a real `signature` (plus optional
 * slot / eventIndex / explorerUrl) and is never marked mockOnly. There is no
 * loose shared `signature` / `explorerUrl` / `id` outside these arms.
 */
export type RedaxReceiptIdentity =
  | { kind: 'mock-receipt-id'; mockReceiptId: string; mockOnly: true }
  | { kind: 'devnet-signature'; signature: string; slot?: number; eventIndex?: number; explorerUrl?: string }

// --- Domain rejection (pre-burn) -------------------------------------------
//
// Mirrors the current mock `MockRejectionCode` concept without importing it.
// Every code below is one of the existing codes in app/src/types/redaxMock.ts
// (including `zero_balance`); none is omitted.

/** Pre-burn rejection codes, aligned to the program guard checks / ErrorCode catalog. */
export type RedaxRejectionCode =
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

/**
 * A domain/eligibility/quote rejection, decided before any token moves. Distinct
 * from RedaxDataError (transport/mode/fetch). Not merged with it.
 */
export interface RedaxRejectionReason {
  code: RedaxRejectionCode
  label: string
  detail: string
  preBurn: true
  /** The closest on-chain ErrorCode variant name, when one maps directly. */
  programError?: string
}

// --- Environment / protocol views ------------------------------------------

/** The data-mode / boundary state surfaced to the UI. */
export interface RedaxEnvironmentView {
  mode: RedaxDataMode
  source: RedaxDataSourceKind
  cluster: RedaxCluster
  modeDescriptor: RedaxModeDescriptor
  dataSourceLabel: string
  boundaryLabel: string
  rpcConfigured: boolean
  walletRequiredForActions: boolean
  readinessClaim: 'none'
}

/** Protocol-level config (mirrors the on-chain ProtocolConfig + fee constants). */
export interface RedaxProtocolConfigView {
  protocolFeeAuthority: RedaxPubkeyString
  protocolEmergencyPauseAuthority: RedaxPubkeyString
  protocolFeeBps: number
  bpsDenominator: number
}

// --- Output token identity (Metaplex metadata) ------------------------------

/**
 * Display identity of a campaign's output mint, decoded from the on-chain
 * Metaplex Token Metadata account by a devnet adapter. `unavailable` means the
 * metadata account was absent/unreadable in that read — surfaces then fall back
 * to the address-derived short label. Never hardcoded, and never a project
 * registry identity; `uri` is carried typed but is not rendered as a raw link.
 */
export type RedaxOutputTokenIdentityView =
  | { source: 'metaplex'; name: string; symbol: string; uri: string }
  | { source: 'unavailable' }

// --- Project / campaign / token-config views -------------------------------

/**
 * Off-chain presentation metadata. Phase 1 REDAX program has no on-chain Project
 * account; devnet project data must not be presented as program-stored project
 * state.
 */
export interface RedaxProjectView {
  id: string
  name: string
  symbol: string
  profile: string
  tagline?: string
  teamPersona?: string
  proofCompletenessPercent: number
  proofLabel?: string
  phase1StoredState: false
}

/** A single migration campaign (mirrors the on-chain Campaign account). */
export interface RedaxCampaignView {
  id: string
  projectId: string | null
  name: string
  programStatus: RedaxProgramCampaignStatus
  displayStatus: RedaxDisplayCampaignStatus
  campaignAddress?: RedaxPubkeyString
  campaignAdmin?: RedaxPubkeyString
  outputGovernance?: RedaxPubkeyString
  outputMint: RedaxPubkeyString
  outputMintLabel: string
  outputTokenIdentity?: RedaxOutputTokenIdentityView
  primaryLegacyMint?: RedaxPubkeyString
  primaryLegacyMintLabel?: string
  protocolFeeVault: RedaxPubkeyString
  metadataSetup: boolean
  startTs?: RedaxTimestamp
  endTs: RedaxTimestamp | null
  maxOutputSupplyRaw: RedaxRawAmount
  totalOutputMintedRaw: RedaxRawAmount
  tokenConfigCount: number
  sortPriority: number
  statusNote?: string
}

/** A per-campaign accepted-input token config (mirrors the on-chain TokenConfig). */
export interface RedaxTokenConfigView {
  id: string
  campaignId: string
  legacyMint: RedaxPubkeyString
  legacyMintLabel?: string
  outputMint: RedaxPubkeyString
  outputMintLabel: string
  outputTokenIdentity?: RedaxOutputTokenIdentityView
  rateNumeratorRaw: RedaxRawAmount
  rateDenominatorRaw: RedaxRawAmount
  legacyDecimals: number
  outputDecimals: number
  maxOutputFromTokenConfigRaw: RedaxRawAmount
  totalOutputMintedFromTokenConfigRaw: RedaxRawAmount
  normalizationRemainderTotalRaw: RedaxRawAmount
  tokenProgram: RedaxTokenProgramKind
  isPrimary: boolean
}

/** One accepted-input TokenConfig of a campaign, flattened for display. */
export interface RedaxInputConfigView {
  campaignId: string
  tokenConfigId: string
  legacyMint: RedaxPubkeyString
  legacyMintLabel?: string
  outputMint: RedaxPubkeyString
  outputMintLabel: string
  outputTokenIdentity?: RedaxOutputTokenIdentityView
  rateNumeratorRaw: RedaxRawAmount
  rateDenominatorRaw: RedaxRawAmount
  legacyDecimals: number
  outputDecimals: number
  maxOutputFromTokenConfigRaw: RedaxRawAmount
  totalOutputMintedFromTokenConfigRaw: RedaxRawAmount
  capUtilizationBps: number
  tokenProgram: RedaxTokenProgramKind
  isPrimary: boolean
}

/** A campaign's accepted-input summary: one output mint, up to 10 inputs. */
export interface RedaxCampaignInputSummaryView {
  campaignId: string
  outputMint: RedaxPubkeyString
  outputMintLabel: string
  outputTokenIdentity?: RedaxOutputTokenIdentityView
  acceptedInputCount: number
  maxTokenConfigs: 10
  inputConfigs: readonly RedaxInputConfigView[]
}

// --- Holder / quote / eligibility views ------------------------------------
//
// Holder identity inside views uses plain `holderId: string` fields. The richer
// caller-side holder reference (RedaxHolderRef) is defined in redaxDataSource.ts
// to avoid a circular concern between views and the data-source contract.

/** A mock/devnet holder identity used to drive eligibility and directory views. */
export interface RedaxHolderView {
  id: string
  label: string
  walletAddress: RedaxPubkeyString | null
  walletLabel?: string
  persona?: string
  preferredSort?: string
}

/** A computed conversion quote (display-only; derives nothing on-chain). */
export interface RedaxQuoteView {
  campaignId: string
  tokenConfigId: string
  amountInRaw: RedaxRawAmount
  normalizedAmountInRaw: RedaxRawAmount
  normalizationRemainderRaw: RedaxRawAmount
  grossOutRaw: RedaxRawAmount
  feeOutRaw: RedaxRawAmount
  userOutRaw: RedaxRawAmount
  rejectionReason?: RedaxRejectionReason
}

/** A holder's position against one accepted-input TokenConfig of a campaign. */
export interface RedaxHolderInputPositionView {
  holderId: string
  campaignId: string
  tokenConfigId: string
  legacyMint: RedaxPubkeyString
  legacyMintLabel?: string
  outputMint: RedaxPubkeyString
  outputMintLabel: string
  legacyDecimals: number
  outputDecimals: number
  holderBalanceRaw: RedaxRawAmount
  outputAtaPrepared: boolean
  eligible: boolean
  isPrimary: boolean
  quote?: RedaxQuoteView
  rejectionReasons: readonly RedaxRejectionReason[]
}

/** A holder's eligibility for one campaign, with the reasons not to convert. */
export interface RedaxHolderEligibilityView {
  holderId: string
  campaignId: string
  eligible: boolean
  balanceRaw: RedaxRawAmount
  outputAtaPrepared: boolean
  selectedTokenConfigId?: string
  quote?: RedaxQuoteView
  rejectionReasons: readonly RedaxRejectionReason[]
  inputPositions: readonly RedaxHolderInputPositionView[]
}

// --- Receipt view ----------------------------------------------------------

/**
 * A conversion receipt. Shape conceptually maps to the on-chain Converted event.
 * Its identity is the discriminated `RedaxReceiptIdentity` — there is no loose
 * `id`, loose `signature`, or loose `explorerUrl` on this view.
 */
export interface RedaxReceiptView {
  identity: RedaxReceiptIdentity
  event: 'Converted'
  campaignId: string
  tokenConfigId: string
  holderId: string
  user: RedaxPubkeyString
  inputMint: RedaxPubkeyString
  outputMint: RedaxPubkeyString
  amountInRaw: RedaxRawAmount
  amountInNormalizedRaw: RedaxRawAmount
  normalizationRemainderRaw: RedaxRawAmount
  grossOutRaw: RedaxRawAmount
  feeOutRaw: RedaxRawAmount
  userOutRaw: RedaxRawAmount
  campaignTotalOutputMintedAfterRaw: RedaxRawAmount
  tokenConfigTotalOutputMintedAfterRaw: RedaxRawAmount
  timestamp: RedaxTimestamp
  note?: string
}

/**
 * A single, just-executed convert transaction's decoded receipt, paired with a
 * reconciliation result against the caller's expected convert context. The inner
 * `receipt` always carries the `devnet-signature` identity (never a mock id).
 * This is a one-transaction receipt only — never receipt history and never an
 * indexer result. `mismatchedFields` names the soft-reconcile fields (if any)
 * that did not match the expected values; the hard identity guard (campaign /
 * user / output mint) is enforced by the decoder, so a returned view always
 * passed it.
 */
export interface RedaxConvertReceiptVerificationView {
  receipt: RedaxReceiptView
  matchesExpected: boolean
  mismatchedFields: readonly string[]
}

// --- Role / action views ---------------------------------------------------

/** A resolved viewer role. Roles are derived from matched accounts, not asserted. */
export type RedaxRoleKind =
  | 'public'
  | 'holder'
  | 'token_team'
  | 'campaign_admin'
  | 'output_governance'
  | 'protocol_fee_authority'
  | 'protocol_emergency_pause_authority'
  | 'observer'
  | 'redax_operator'
  | 'unknown'

/** The viewer's role for the current surface. */
export interface RedaxRoleView {
  role: RedaxRoleKind
  walletAddress?: RedaxPubkeyString
  matchedAccount?: RedaxPubkeyString
  label: string
  readOnly: boolean
}

/** Connection state of the read-only connected-wallet role context. */
export type RedaxWalletRoleContextStatus =
  | 'unconnected'
  | 'connected'
  | 'unavailable'

/**
 * Read-only connected-wallet role context for DEVNET_WALLET_READONLY: the full
 * set of REDAX authority roles a connected public key matches, resolved by
 * address comparison against already-read on-chain authority fields. This is an
 * additive view — it does NOT replace the single `RedaxRoleView`. It asserts no
 * capability: every role is read-only, no action is enabled, and no readiness is
 * claimed. `matchedRoles` carries every match (not first-match only), and
 * `primaryRole` is a convenience pointer to the first matched role, when any.
 */
export interface RedaxWalletRoleContextView {
  status: RedaxWalletRoleContextStatus
  shortPublicKey: RedaxPubkeyString | null
  matchedRoles: readonly RedaxRoleView[]
  primaryRole?: RedaxRoleView
}

// --- Connected-wallet holder context (DEVNET_WALLET_READONLY, read-only) -----
//
// Additive read-only classic-SPL balance / ATA context for a connected wallet.
// It is deliberately distinct from RedaxHolderEligibilityView: it carries NO
// conversion quote, NO eligibility verdict, and enables NO action. Balances are
// raw base-unit decimal strings (BigInt-safe; the screen formats them). A
// missing associated token account is a normal state (no account yet / output
// ATA not prepared), never an error and never fabricated as a zero success.

/** Classic-SPL associated-token-account read status for a connected wallet's ATA. */
export type RedaxWalletAtaStatus =
  | 'missing'
  | 'exists'
  | 'mismatch'
  | 'unavailable'

/** Connection state of the connected-wallet holder context. */
export type RedaxConnectedWalletHolderContextStatus =
  | 'unconnected'
  | 'connected'
  | 'unavailable'

/** One accepted-input legacy-mint balance row for the connected wallet (read-only). */
export interface RedaxConnectedWalletInputBalanceView {
  tokenConfigId: string
  legacyMint: RedaxPubkeyString
  legacyMintLabel?: string
  legacyDecimals: number
  ataStatus: RedaxWalletAtaStatus
  /** Raw base-unit legacy balance as a decimal string; null unless ataStatus === 'exists'. */
  balanceRaw: RedaxRawAmount | null
}

/** Campaign-level output-ATA preparedness for the connected wallet (read-only). */
export interface RedaxConnectedWalletOutputAtaView {
  status: RedaxWalletAtaStatus
  outputMint: RedaxPubkeyString
  outputMintLabel?: string
  /**
   * Raw base-unit output-token balance as a decimal string; carried only when
   * status === 'exists' and the classic-SPL amount was decoded, else null (never
   * a fabricated zero). Mirrors RedaxConnectedWalletInputBalanceView.balanceRaw;
   * a later convert action UI reads it to verify a post-confirm output increase.
   * Display formatting (output decimals) happens in the screen, not here.
   */
  balanceRaw: RedaxRawAmount | null
}

/**
 * Read-only connected-wallet holder context for DEVNET_WALLET_READONLY: the
 * classic-SPL legacy balance per accepted input plus the campaign output-ATA
 * preparedness, resolved by deriving canonical ATAs for the connected public key
 * and reading them. Additive — it is NOT eligibility, NOT a quote, and grants NO
 * capability. `unconnected` = no wallet connected; `unavailable` = not applicable
 * (e.g. MOCK_LOCAL) or the whole read could not complete; `connected` = a real
 * read (which may still contain per-row missing/unavailable statuses).
 */
export interface RedaxConnectedWalletHolderContextView {
  status: RedaxConnectedWalletHolderContextStatus
  shortPublicKey: RedaxPubkeyString | null
  campaignId: string | null
  legacyInputBalances: readonly RedaxConnectedWalletInputBalanceView[]
  outputAta: RedaxConnectedWalletOutputAtaView | null
}

/** Whether an action is hidden, shown-disabled, or shown-enabled. */
export type RedaxActionState =
  | 'hidden'
  | 'disabled'
  | 'enabled'

// There is deliberately no `emergency_pause_campaign` action id: emergency pause
// is NOT a separate Phase 1 instruction. It is the same `pause_campaign`
// instruction invoked by the protocol emergency pause authority — a role
// distinction (RedaxRoleKind 'protocol_emergency_pause_authority'), not a
// distinct action. `verify_output_mint` is a setup/RPC/SPL verification step,
// not a REDAX program instruction; `prepare_user_output_ata` is a REDAX
// instruction that also creates/verifies the user's output ATA.

/** A Phase 1 action a surface may offer. */
export type RedaxActionId =
  | 'init_protocol'
  | 'init_campaign'
  | 'verify_output_mint'
  | 'add_token_config'
  | 'setup_metadata'
  | 'activate_campaign'
  | 'prepare_user_output_ata'
  | 'convert_exact_in'
  | 'pause_campaign'
  | 'unpause_campaign'
  | 'finalize_campaign'

/** Whether/why an action is available for the viewer in the current mode/role. */
export interface RedaxActionAvailabilityView {
  actionId: RedaxActionId
  state: RedaxActionState
  requiredMode?: RedaxDataMode
  requiredRole?: RedaxRoleKind
  disabledReasonCode?: string
  disabledReasonText?: string
}

// --- Directory row view ----------------------------------------------------

/** One row of the campaign directory, optionally personalized to a holder. */
export interface RedaxDirectoryRowView {
  campaignId: string
  projectId: string | null
  projectName: string
  symbol: string
  profile: string
  programStatus: RedaxProgramCampaignStatus
  displayStatus: RedaxDisplayCampaignStatus
  holderEligible: boolean | null
  holderBalanceRaw: RedaxRawAmount | null
  capUtilizationBps: number
  endsInSeconds: number | null
  proofCompletenessPercent: number
  /**
   * Optional caption replacing the percent display (e.g. the devnet boundary
   * "not indexed in this build"). Absent -> render the numeric percent.
   */
  proofCaption?: string
  sortPriority: number
}
