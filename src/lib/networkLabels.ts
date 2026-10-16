// REDAX app — network display labels.
//
// Labels and descriptions only. These strings feed the environment badge and
// environment copy surfaces; whether any network is contacted is determined by
// the current data-source mode, not by this module.

import type { NetworkEnvironmentKey } from '../config/env'
import { ENVIRONMENTS, MAINNET_PATH_NOTE } from '../config/env'

export const NETWORK_BADGE_LABELS: Record<NetworkEnvironmentKey, string> = {
  localnet: 'Localnet — labeled rehearsal',
  devnet: 'Devnet — product trial target',
}

export const NETWORK_DESCRIPTIONS: Record<NetworkEnvironmentKey, string> = {
  localnet:
    'Local rehearsal runs are always labeled Localnet. A localnet run is never relabeled or presented as devnet.',
  devnet:
    'The near-term network target is a devnet product trial for real token and project teams. Devnet activity is a demonstration and evaluation surface, not a readiness claim.',
}

export function networkBadgeLabel(key: NetworkEnvironmentKey): string {
  return NETWORK_BADGE_LABELS[key]
}

export function environmentDisplayName(key: NetworkEnvironmentKey): string {
  return ENVIRONMENTS[key].displayLabel
}

export const MAINNET_FUTURE_PATH_LABEL = MAINNET_PATH_NOTE

export const STAGE_ZERO_NETWORK_NOTE =
  'Environment names describe the configured target; whether on-chain data is read is determined by the current data-source mode.'
