
import type { RedaxDataMode } from './redaxModes'
import type {
  RedaxActionAvailabilityView,
  RedaxCampaignInputSummaryView,
  RedaxCampaignView,
  RedaxConnectedWalletHolderContextView,
  RedaxConvertReceiptVerificationView,
  RedaxDataSourceResult,
  RedaxDirectoryRowView,
  RedaxEnvironmentView,
  RedaxHolderEligibilityView,
  RedaxHolderInputPositionView,
  RedaxHolderView,
  RedaxProjectView,
  RedaxProtocolConfigView,
  RedaxPubkeyString,
  RedaxRawAmount,
  RedaxReceiptView,
  RedaxRoleView,
  RedaxTokenConfigView,
  RedaxWalletRoleContextView,
} from './redaxViewModels'

// --- Caller refs / inputs / context ----------------------------------------

/**
 * How a caller identifies the holder a query is about. The mock arm carries a
 * fixture holder id; the wallet arm carries a connected wallet address; the
 * public arm is the unauthenticated viewer. Defined here (not in the view
 * models) to avoid a circular concern between views and this contract.
 */
export type RedaxHolderRef =
  | { kind: 'mock-holder'; holderId: string }
  | { kind: 'wallet'; walletAddress: RedaxPubkeyString }
  | { kind: 'public' }

/** A reference to a single campaign. */
export interface RedaxCampaignRef {
  campaignId: string
}

/** A reference to a single accepted-input token config within a campaign. */
export interface RedaxTokenConfigRef {
  campaignId: string
  tokenConfigId: string
}

/**
 * Input for a future quote computation. The quote method itself is intentionally
 * NOT part of RedaxDataSource in this first edit; shared pure quote math comes
 * later. This shape is declared now so callers and the later math agree.
 */
export interface RedaxQuoteInput {
  campaignId: string
  tokenConfigId: string
  amountInRaw: RedaxRawAmount
}

/** Ambient context a data source resolves against (mode + optional wallet/campaign). */
export interface RedaxDataSourceContext {
  mode: RedaxDataMode
  connectedWallet?: RedaxPubkeyString
  activeCampaignId?: string
}

/**
 * Input for a single just-executed convert receipt read. `signature` is the
 * transaction the caller already submitted; `expected` is the convert context the
 * caller expects the decoded on-chain `Converted` event to match — used for the
 * hard identity guard (campaign / user / output mint) and the soft reconciliation.
 * No transaction history is scanned; exactly one transaction is read.
 */
export interface RedaxConvertReceiptRequest {
  signature: string
  expected: {
    campaignId: string
    tokenConfigId: string
    user: RedaxPubkeyString
    legacyMint: RedaxPubkeyString
    outputMint: RedaxPubkeyString
    amountInRaw: RedaxRawAmount
    grossOutRaw: RedaxRawAmount
    feeOutRaw: RedaxRawAmount
    userOutRaw: RedaxRawAmount
    amountInNormalizedRaw?: RedaxRawAmount
    normalizationRemainderRaw?: RedaxRawAmount
    userOutputAta?: RedaxPubkeyString
    protocolFeeVault?: RedaxPubkeyString
  }
  slot?: number
}

// --- Data-source contract --------------------------------------------------

/**
 * The adapter-agnostic data-source contract every mode will implement. Each
 * method returns a `RedaxDataSourceResult<T>` so the resolving mode/source and
 * any transport/mode error travel with the data. This is a *type* only: no
 * implementation, no factory, no selector, and no quote math live here.
 */
export interface RedaxDataSource {
  getEnvironment(): Promise<RedaxDataSourceResult<RedaxEnvironmentView>>
  getProtocolConfig(): Promise<RedaxDataSourceResult<RedaxProtocolConfigView | null>>
  getCampaigns(): Promise<RedaxDataSourceResult<readonly RedaxCampaignView[]>>
  getCampaignById(campaignId: string): Promise<RedaxDataSourceResult<RedaxCampaignView | null>>
  getProjects(): Promise<RedaxDataSourceResult<readonly RedaxProjectView[]>>
  getProjectById(projectId: string): Promise<RedaxDataSourceResult<RedaxProjectView | null>>
  getTokenConfigsForCampaign(campaignId: string): Promise<RedaxDataSourceResult<readonly RedaxTokenConfigView[]>>
  getCampaignInputSummary(campaignId: string): Promise<RedaxDataSourceResult<RedaxCampaignInputSummaryView | null>>
  getHolderProfiles(): Promise<RedaxDataSourceResult<readonly RedaxHolderView[]>>
  getConnectedWalletRole(context: RedaxDataSourceContext): Promise<RedaxDataSourceResult<RedaxRoleView>>
  getConnectedWalletRoleContext(context: RedaxDataSourceContext): Promise<RedaxDataSourceResult<RedaxWalletRoleContextView>>
  getConnectedWalletHolderContext(context: RedaxDataSourceContext): Promise<RedaxDataSourceResult<RedaxConnectedWalletHolderContextView>>
  getHolderInputPositions(holderRef: RedaxHolderRef, campaignId: string): Promise<RedaxDataSourceResult<readonly RedaxHolderInputPositionView[]>>
  getHolderEligibilityForCampaign(holderRef: RedaxHolderRef, campaignId: string): Promise<RedaxDataSourceResult<RedaxHolderEligibilityView>>
  getReceiptsForCampaign(campaignId: string): Promise<RedaxDataSourceResult<readonly RedaxReceiptView[]>>
  getReceiptsForHolder(holderRef: RedaxHolderRef): Promise<RedaxDataSourceResult<readonly RedaxReceiptView[]>>
  getReceiptsForTokenConfig(tokenConfigId: string): Promise<RedaxDataSourceResult<readonly RedaxReceiptView[]>>
  getConvertedReceiptForSignature(request: RedaxConvertReceiptRequest): Promise<RedaxDataSourceResult<RedaxConvertReceiptVerificationView | null>>
  getDirectoryRows(holderRef?: RedaxHolderRef): Promise<RedaxDataSourceResult<readonly RedaxDirectoryRowView[]>>
  getFeaturedCampaigns(limit?: number): Promise<RedaxDataSourceResult<readonly RedaxCampaignView[]>>
  getAvailableActions(context: RedaxDataSourceContext): Promise<RedaxDataSourceResult<readonly RedaxActionAvailabilityView[]>>
}
