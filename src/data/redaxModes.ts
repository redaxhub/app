// REDAX data-source boundary types only; no runtime mode selection, no adapter,
// no RPC, no wallet, no readiness claim.
//
// Mode boundary rules (encoded as this type contract plus these notes; a later
// adapter must honour them — nothing here enforces them at runtime):
//   - MOCK_LOCAL uses local fixtures/selectors only.
//   - MOCK_LOCAL must not require a wallet.
//   - MOCK_LOCAL must not construct an RPC client.
//   - MOCK_LOCAL must not render real signatures or explorer links.
//   - DEVNET_READONLY uses devnet program/RPC account + event data only.
//   - DEVNET_READONLY exposes no transaction actions.
//   - DEVNET_WALLET_READONLY uses devnet program/RPC reads plus wallet connection
//     for role/balance context only.
//   - DEVNET_WALLET_READONLY exposes no transaction actions, no signing, no
//     transaction builders, no sendTransaction, and no signTransaction.
//   - DEVNET_TX_ENABLED uses devnet account + event data plus wallet-gated actions.
//   - DEVNET modes must never fall back to mock fixtures.
//   - DEVNET modes must never render `mockOnly: true` receipts.
//   - If a devnet read fails, a later adapter must surface a devnet error — never mock data.
//   - Screen components should later become adapter-agnostic and consume Redax*View props.

// --- Mode unions -----------------------------------------------------------

/**
 * The data-source mode a future REDAX surface runs in.
 *  - MOCK_LOCAL        local fixtures/selectors only; no wallet, no RPC, no real signatures.
 *  - DEVNET_READONLY   devnet program/RPC account + event reads only; no transaction actions.
 *  - DEVNET_WALLET_READONLY devnet program/RPC reads plus wallet connection for
 *                      role/balance context only; no transaction actions, no signing,
 *                      no transaction builders, no sendTransaction, no signTransaction.
 *  - DEVNET_TX_ENABLED devnet reads plus wallet-gated transaction actions.
 */
export type RedaxDataMode =
  | 'MOCK_LOCAL'
  | 'DEVNET_READONLY'
  | 'DEVNET_WALLET_READONLY'
  | 'DEVNET_TX_ENABLED'

/** Where a surface's data physically originates. */
export type RedaxDataSourceKind =
  | 'mock-fixtures'
  | 'program-rpc'

/**
 * Target Solana cluster for a mode. Only devnet is in scope for this first
 * boundary edit; MOCK_LOCAL has no cluster (null). No other cluster value is
 * introduced here.
 */
export type RedaxCluster =
  | 'devnet'
  | null

/** A single capability a mode may grant. */
export type RedaxModeCapability =
  | 'local-fixtures'
  | 'program-rpc-read'
  | 'wallet-connect-readonly'
  | 'wallet-required-for-actions'
  | 'transaction-actions-enabled'

// --- Mode descriptor shape -------------------------------------------------

/**
 * The shape a future runtime would use to describe one mode. Type only — this
 * edit creates no descriptor values. `mockFallbackAllowed` is pinned to the
 * literal false (no mode may fall back to mock data) and `readinessClaim` to the
 * literal 'none' (no mode asserts any devnet/production readiness).
 */
export interface RedaxModeDescriptor {
  mode: RedaxDataMode
  source: RedaxDataSourceKind
  cluster: RedaxCluster
  label: string
  boundaryLabel: string
  capabilities: readonly RedaxModeCapability[]
  walletRequiredForActions: boolean
  rpcAllowed: boolean
  transactionActionsAllowed: boolean
  mockFallbackAllowed: false
  readinessClaim: 'none'
}
