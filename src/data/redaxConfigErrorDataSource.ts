// REDAX config-error data source.
//
// Boundary: config-error datasource only. It performs no env reads, no mock
// fallback, no devnet adapter import, no RPC, no wallet, and no tx; it builds no
// UI forms and claims no readiness. Every RedaxDataSource method returns one
// typed, value-free RedaxDataSourceResult error built from a single precomputed
// RedaxDataError; nothing here fabricates or falls back to mock data. The
// provider maps validated env-config problems onto an existing public
// RedaxDataErrorCode and hands a sanitized entry in — this module never reads or
// sees a raw env value. A VALID DEVNET_TX_ENABLED CONFIG IS NOT ROUTED HERE: it
// resolves to the read-only devnet adapter like the other two devnet modes, and
// the earlier "recognized-but-blocked DEVNET_TX_ENABLED mode" reading is
// superseded. This module itself still has no transaction behaviour of any kind.

import type { RedaxDataSource } from './redaxDataSource'
import type { RedaxDataMode, RedaxDataSourceKind } from './redaxModes'
import type {
  RedaxActionAvailabilityView,
  RedaxCampaignInputSummaryView,
  RedaxCampaignView,
  RedaxConnectedWalletHolderContextView,
  RedaxConvertReceiptVerificationView,
  RedaxDataError,
  RedaxDataErrorCode,
  RedaxDataSourceResult,
  RedaxDirectoryRowView,
  RedaxEnvironmentView,
  RedaxHolderEligibilityView,
  RedaxHolderInputPositionView,
  RedaxHolderView,
  RedaxProjectView,
  RedaxProtocolConfigView,
  RedaxReceiptView,
  RedaxRoleView,
  RedaxTokenConfigView,
  RedaxWalletRoleContextView,
} from './redaxViewModels'

/**
 * A sanitized, carrier-coded config error. It carries only an existing public
 * `RedaxDataErrorCode` plus value-free text — never a raw env value. The provider
 * builds this from a validator error (or a fixed unsupported-mode message).
 */
export interface RedaxConfigErrorEntry {
  code: RedaxDataErrorCode
  title: string
  detail: string
  recovery: string
}

/**
 * Options for the config-error data source. `mode`/`source` form the honest
 * result envelope and are stamped on every result and on the error itself.
 */
export interface RedaxConfigErrorDataSourceOptions {
  mode: RedaxDataMode
  source: RedaxDataSourceKind
  primary: RedaxConfigErrorEntry
}

/**
 * Create a RedaxDataSource whose every read fails with one sanitized config
 * error. No mock fallback, no RPC, no wallet, no tx, no readiness. Used by the
 * provider for INVALID or unusable public env config only — never for a valid
 * mode, DEVNET_TX_ENABLED included, which resolves to the devnet adapter.
 */
export function createRedaxConfigErrorDataSource(
  options: RedaxConfigErrorDataSourceOptions,
): RedaxDataSource {
  // One precomputed error; config errors block display. error.mode/source match
  // the result envelope so a screen renders a single consistent boundary state.
  const error: RedaxDataError = {
    code: options.primary.code,
    title: options.primary.title,
    detail: options.primary.detail,
    recovery: options.primary.recovery,
    blocks: 'display',
    mode: options.mode,
    source: options.source,
  }

  // Build a typed error result for any read. Never throws, never returns data,
  // never performs RPC, never falls back to mock.
  async function fail<T>(): Promise<RedaxDataSourceResult<T>> {
    return { ok: false, mode: options.mode, source: options.source, error }
  }

  // Method parameters are intentionally omitted (a zero-arg implementation stays
  // assignable to the param'd RedaxDataSource methods) so noUnusedParameters is
  // never tripped; no caller input is consulted in a config-error state.
  return {
    getEnvironment() {
      return fail<RedaxEnvironmentView>()
    },
    getProtocolConfig() {
      return fail<RedaxProtocolConfigView | null>()
    },
    getCampaigns() {
      return fail<readonly RedaxCampaignView[]>()
    },
    getCampaignById() {
      return fail<RedaxCampaignView | null>()
    },
    getProjects() {
      return fail<readonly RedaxProjectView[]>()
    },
    getProjectById() {
      return fail<RedaxProjectView | null>()
    },
    getTokenConfigsForCampaign() {
      return fail<readonly RedaxTokenConfigView[]>()
    },
    getCampaignInputSummary() {
      return fail<RedaxCampaignInputSummaryView | null>()
    },
    getHolderProfiles() {
      return fail<readonly RedaxHolderView[]>()
    },
    getConnectedWalletRole() {
      return fail<RedaxRoleView>()
    },
    getConnectedWalletRoleContext() {
      return fail<RedaxWalletRoleContextView>()
    },
    getConnectedWalletHolderContext() {
      return fail<RedaxConnectedWalletHolderContextView>()
    },
    getHolderInputPositions() {
      return fail<readonly RedaxHolderInputPositionView[]>()
    },
    getHolderEligibilityForCampaign() {
      return fail<RedaxHolderEligibilityView>()
    },
    getReceiptsForCampaign() {
      return fail<readonly RedaxReceiptView[]>()
    },
    getReceiptsForHolder() {
      return fail<readonly RedaxReceiptView[]>()
    },
    getReceiptsForTokenConfig() {
      return fail<readonly RedaxReceiptView[]>()
    },
    getConvertedReceiptForSignature() {
      return fail<RedaxConvertReceiptVerificationView | null>()
    },
    getDirectoryRows() {
      return fail<readonly RedaxDirectoryRowView[]>()
    },
    getFeaturedCampaigns() {
      return fail<readonly RedaxCampaignView[]>()
    },
    getAvailableActions() {
      return fail<readonly RedaxActionAvailabilityView[]>()
    },
  }
}
