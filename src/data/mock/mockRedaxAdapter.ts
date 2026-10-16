// REDAX MOCK_LOCAL data-source convergence — RedaxDataSource adapter.
//
// Boundary: this adapter realizes the RedaxDataSource contract for MOCK_LOCAL
// only. It owns the selector calls (reading the local fixtures via
// ../../lib/mockSelectors) and delegates all reshaping to the pure mapper
// (./mockRedaxMapper). It reads no env, constructs no RPC client, requires no
// wallet, and imports no React / wallet / RPC / Anchor / web3 / SPL / IDL and no
// raw fixture module. Every result carries mode 'MOCK_LOCAL' / source
// 'mock-fixtures'; results are deterministic so no fetchedAt stamp is emitted.
// No transaction action is ever enabled and no devnet identity is ever produced.

import type { RedaxDataSource, RedaxHolderRef } from '../redaxDataSource'
import type {
  RedaxActionAvailabilityView,
  RedaxActionId,
  RedaxCampaignInputSummaryView,
  RedaxCampaignView,
  RedaxConnectedWalletHolderContextView,
  RedaxConvertReceiptVerificationView,
  RedaxDataSourceResult,
  RedaxHolderEligibilityView,
  RedaxHolderInputPositionView,
  RedaxProjectView,
  RedaxProtocolConfigView,
  RedaxReceiptView,
  RedaxRoleView,
  RedaxTokenConfigView,
  RedaxWalletRoleContextView,
} from '../redaxViewModels'
import type { MockCampaign, MockConvertedReceipt } from '../../types/redaxMock'
import * as mockSelectors from '../../lib/mockSelectors'
import {
  mapMockCampaign,
  mapMockCampaignInputSummary,
  mapMockDirectoryRow,
  mapMockEnvironmentState,
  mapMockHolderEligibility,
  mapMockHolderInputPosition,
  mapMockHolderProfile,
  mapMockProject,
  mapMockProtocolConfig,
  mapMockReceipt,
  mapMockTokenConfig,
} from './mockRedaxMapper'

// --- Private result wrappers ------------------------------------------------

/** Wrap a successful MOCK_LOCAL read. Deterministic, so no fetchedAt is emitted. */
function ok<T>(data: T): RedaxDataSourceResult<T> {
  return { ok: true, mode: 'MOCK_LOCAL', source: 'mock-fixtures', data }
}

/**
 * A MOCK_LOCAL data error, used only for an impossible fixture inconsistency
 * (e.g. a receipt referencing a holder or token config the fixtures do not
 * contain). It is not a devnet/RPC error and implies no readiness.
 */
function mockDataError<T>(detail: string): RedaxDataSourceResult<T> {
  return {
    ok: false,
    mode: 'MOCK_LOCAL',
    source: 'mock-fixtures',
    error: {
      code: 'MOCK_DATA_UNAVAILABLE',
      title: 'Mock data unavailable',
      detail,
      recovery: 'This is local MOCK_LOCAL sample data; reload the local app to reset the fixtures.',
      blocks: 'display',
      mode: 'MOCK_LOCAL',
      source: 'mock-fixtures',
    },
  }
}

// --- Private resolution / context helpers -----------------------------------

/**
 * Resolve a caller holder reference to a mock holder id, without ever requiring
 * a real wallet. A mock-holder ref maps directly; a wallet ref resolves only by
 * matching a fixture mockAddress; a public ref (or an unmatched wallet) has no
 * holder. No devnet role state is produced.
 */
function resolveHolderId(holderRef: RedaxHolderRef): string | null {
  if (holderRef.kind === 'mock-holder') {
    return holderRef.holderId
  }
  if (holderRef.kind === 'wallet') {
    const matched = mockSelectors
      .getHolderProfiles()
      .find((holder) => holder.mockAddress === holderRef.walletAddress)
    return matched ? matched.id : null
  }
  return null
}

/** Map one campaign, supplying its accepted-input token-config count from the selectors. */
function mapCampaignWithCount(campaign: MockCampaign): RedaxCampaignView {
  return mapMockCampaign(
    campaign,
    mockSelectors.getTokenConfigsForCampaign(campaign.id).length,
  )
}

/** A safe, read-only no-holder eligibility for a public viewer or unmatched wallet. */
function emptyEligibility(campaignId: string): RedaxHolderEligibilityView {
  return {
    holderId: '',
    campaignId,
    eligible: false,
    balanceRaw: '0',
    outputAtaPrepared: false,
    rejectionReasons: [],
    inputPositions: [],
  }
}

/**
 * Map a list of mock receipts, resolving each receipt's holder profile and token
 * config for the mapper. Returns null if any receipt's context is missing — an
 * impossible inconsistency in the internally-consistent fixtures — so the caller
 * can surface a mock data error rather than fabricate a value.
 */
function mapReceiptList(
  receipts: readonly MockConvertedReceipt[],
): readonly RedaxReceiptView[] | null {
  const mapped: RedaxReceiptView[] = []
  for (const receipt of receipts) {
    const holder = mockSelectors
      .getHolderProfiles()
      .find((candidate) => candidate.id === receipt.holderId)
    const tokenConfig = mockSelectors
      .getTokenConfigsForCampaign(receipt.campaignId)
      .find((candidate) => candidate.id === receipt.tokenConfigId)
    if (holder === undefined || tokenConfig === undefined) {
      return null
    }
    mapped.push(mapMockReceipt(receipt, holder, tokenConfig))
  }
  return mapped
}

/** Wrap a receipt list into a result, surfacing a mock data error on inconsistency. */
function mapReceiptResult(
  receipts: readonly MockConvertedReceipt[],
): RedaxDataSourceResult<readonly RedaxReceiptView[]> {
  const mapped = mapReceiptList(receipts)
  if (mapped === null) {
    return mockDataError<readonly RedaxReceiptView[]>(
      'A mock receipt referenced a holder or token config absent from the local fixtures.',
    )
  }
  return ok(mapped)
}

// --- MOCK_LOCAL action policy -----------------------------------------------
//
// MOCK_LOCAL offers no transaction action. Every current RedaxActionId is
// surfaced as disabled with sample-data copy; none is enabled and none implies a
// wallet / RPC / devnet capability. There is no emergency_pause_campaign action
// id (emergency pause is a role on pause_campaign, not a separate action).

const MOCK_LOCAL_ACTION_IDS: readonly RedaxActionId[] = [
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

// --- Adapter factory --------------------------------------------------------

/** Create the MOCK_LOCAL RedaxDataSource. Local fixtures only — no wallet, RPC, or provider. */
export function createMockRedaxDataSource(): RedaxDataSource {
  return {
    async getEnvironment() {
      return ok(mapMockEnvironmentState(mockSelectors.getMockEnvironmentState()))
    },

    async getProtocolConfig() {
      return ok<RedaxProtocolConfigView | null>(
        mapMockProtocolConfig(mockSelectors.getMockProtocolConfig()),
      )
    },

    async getCampaigns() {
      return ok(mockSelectors.getCampaigns().map(mapCampaignWithCount))
    },

    async getCampaignById(campaignId) {
      const campaign = mockSelectors.getCampaignById(campaignId)
      return ok<RedaxCampaignView | null>(campaign ? mapCampaignWithCount(campaign) : null)
    },

    async getProjects() {
      return ok(mockSelectors.getProjects().map(mapMockProject))
    },

    async getProjectById(projectId) {
      const project = mockSelectors.getProjectById(projectId)
      return ok<RedaxProjectView | null>(project ? mapMockProject(project) : null)
    },

    async getTokenConfigsForCampaign(campaignId) {
      const campaign = mockSelectors.getCampaignById(campaignId)
      if (!campaign) {
        return ok<readonly RedaxTokenConfigView[]>([])
      }
      return ok(
        mockSelectors
          .getTokenConfigsForCampaign(campaignId)
          .map((tokenConfig) => mapMockTokenConfig(tokenConfig, campaign)),
      )
    },

    async getCampaignInputSummary(campaignId) {
      const summary = mockSelectors.getCampaignInputSummary(campaignId)
      return ok<RedaxCampaignInputSummaryView | null>(
        summary ? mapMockCampaignInputSummary(summary) : null,
      )
    },

    async getHolderProfiles() {
      return ok(mockSelectors.getHolderProfiles().map(mapMockHolderProfile))
    },

    async getConnectedWalletRole(_context) {
      return ok<RedaxRoleView>({
        role: 'public',
        label: 'Public viewer — MOCK_LOCAL sample data (read-only)',
        readOnly: true,
      })
    },

    async getConnectedWalletRoleContext(_context) {
      // MOCK_LOCAL has no on-chain authority accounts and no connected-wallet
      // concept; connected-wallet role context is simply unavailable here — never
      // a fabricated or overclaimed role.
      return ok<RedaxWalletRoleContextView>({
        status: 'unavailable',
        shortPublicKey: null,
        matchedRoles: [],
      })
    },

    async getConnectedWalletHolderContext(_context) {
      // MOCK_LOCAL has no real wallet and no on-chain token accounts; connected-
      // wallet holder balance / ATA context is simply unavailable here — never a
      // fabricated balance or ATA status.
      return ok<RedaxConnectedWalletHolderContextView>({
        status: 'unavailable',
        shortPublicKey: null,
        campaignId: null,
        legacyInputBalances: [],
        outputAta: null,
      })
    },

    async getHolderInputPositions(holderRef, campaignId) {
      const holderId = resolveHolderId(holderRef)
      if (holderId === null) {
        return ok<readonly RedaxHolderInputPositionView[]>([])
      }
      return ok(
        mockSelectors
          .getHolderInputPositionsForCampaign(holderId, campaignId)
          .map(mapMockHolderInputPosition),
      )
    },

    async getHolderEligibilityForCampaign(holderRef, campaignId) {
      const holderId = resolveHolderId(holderRef)
      if (holderId === null) {
        return ok(emptyEligibility(campaignId))
      }
      const eligibility = mockSelectors.getHolderEligibilityForCampaign(holderId, campaignId)
      const inputPositions = mockSelectors
        .getHolderInputPositionsForCampaign(holderId, campaignId)
        .map(mapMockHolderInputPosition)
      return ok(mapMockHolderEligibility(eligibility, inputPositions))
    },

    async getReceiptsForCampaign(campaignId) {
      return mapReceiptResult(mockSelectors.getReceiptsForCampaign(campaignId))
    },

    async getReceiptsForHolder(holderRef) {
      const holderId = resolveHolderId(holderRef)
      if (holderId === null) {
        return ok<readonly RedaxReceiptView[]>([])
      }
      return mapReceiptResult(mockSelectors.getReceiptsForHolder(holderId))
    },

    async getReceiptsForTokenConfig(tokenConfigId) {
      return mapReceiptResult(mockSelectors.getReceiptsForTokenConfig(tokenConfigId))
    },

    async getConvertedReceiptForSignature(_request) {
      // MOCK_LOCAL has no real devnet transaction and never produces a
      // devnet-signature receipt; a single-transaction receipt is unavailable
      // here (never a mockOnly receipt in a devnet-signature slot).
      return ok<RedaxConvertReceiptVerificationView | null>(null)
    },

    async getDirectoryRows(holderRef) {
      const holderId = holderRef ? resolveHolderId(holderRef) : null
      return ok(
        mockSelectors
          .getCampaignDirectoryRows(holderId ?? undefined)
          .map(mapMockDirectoryRow),
      )
    },

    async getFeaturedCampaigns(limit) {
      return ok(mockSelectors.getFeaturedCampaigns(limit).map(mapCampaignWithCount))
    },

    async getAvailableActions(_context) {
      return ok(
        MOCK_LOCAL_ACTION_IDS.map((actionId): RedaxActionAvailabilityView => ({
          actionId,
          state: 'disabled',
          disabledReasonCode: 'MOCK_LOCAL_NO_TRANSACTION_ACTIONS',
          disabledReasonText:
            'MOCK_LOCAL sample data — no transaction actions; local fixtures only, no wallet or RPC.',
        })),
      )
    },
  }
}
