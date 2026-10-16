// REDAX app — environment label/config shape.
//
// Display labels only. This module configures no endpoint and drives no network
// activity itself; whether the app reads local fixtures or read-only devnet
// program/RPC data is determined by the separately validated data-source mode
// (config/redaxEnv.ts), not by this module. It holds no secret, references no
// private env var name, and reads no env file. Mainnet is not active and has no
// configuration here.

export type NetworkEnvironmentKey = 'localnet' | 'devnet'

export interface EnvironmentLabelConfig {
  readonly key: NetworkEnvironmentKey
  readonly displayLabel: string
  readonly purpose: string
  /** Always false in this label config: no endpoint is configured HERE — the runtime RPC endpoint, if any, comes from the validated data-source env. */
  readonly endpointConfigured: false
  /** Always false in this label config: this label module drives no network activity — data reads are governed by the data-source mode. */
  readonly active: false
}

export const ENVIRONMENTS: Record<NetworkEnvironmentKey, EnvironmentLabelConfig> = {
  localnet: {
    key: 'localnet',
    displayLabel: 'Localnet',
    purpose:
      'Labeled local rehearsal target for a separately gated rehearsal stage. A localnet run is always labeled Localnet — never presented as devnet.',
    endpointConfigured: false,
    active: false,
  },
  devnet: {
    key: 'devnet',
    displayLabel: 'Devnet',
    purpose:
      'Devnet product trial target. Whether devnet data is actually read is determined by the selected data-source mode; devnet activity is a demonstration and evaluation surface — not a readiness, production, mainnet, fundraising, or token-launch claim.',
    endpointConfigured: false,
    active: false,
  },
}

/**
 * Display target only: which environment label the shell shows in the badge.
 * The badge renders labels; actual data reads are governed by the data-source
 * mode, not by this constant.
 */
export const DISPLAY_TARGET_ENVIRONMENT: NetworkEnvironmentKey = 'devnet'

/** Mainnet is not active in this build and has no configuration shape here. */
export const MAINNET_ACTIVE = false as const

export const MAINNET_PATH_NOTE =
  'Mainnet is a future path only, behind separate gates and separate review. It is not active in this build, and no mainnet readiness is claimed.'
