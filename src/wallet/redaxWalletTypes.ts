// REDAX wallet facade types — the ONLY wallet surface the app chrome may see.
//
// Type-only boundary for the REDAX wallet connection surface, in every mode that
// mounts the provider — DEVNET_WALLET_READONLY and DEVNET_TX_ENABLED alike. No
// adapter type appears here, and the facade deliberately exposes no transaction
// or signing member of any kind — connection state, detected wallets, and
// user-initiated connect/disconnect only. Raw Wallet Standard adapters stay
// private inside RedaxWalletProvider and are never handed to screens or chrome.
// No readiness is asserted by any value in this module.

/**
 * Wallet connection lifecycle as the REDAX chrome sees it.
 *  - no-wallet      no compatible Wallet Standard wallet is detected on this page.
 *  - idle           wallets detected; nothing connected.
 *  - connecting     a user-initiated connect is in flight.
 *  - connected      a wallet is connected (public key display only).
 *  - disconnecting  a user-initiated disconnect is in flight.
 *  - error          the last user-initiated wallet action failed (safe copy in errorMessage).
 */
export type RedaxWalletStatus =
  | 'no-wallet'
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'disconnecting'
  | 'error'

/** Adapter ready-state mirrored into a plain, adapter-free union. */
export type RedaxWalletReadyState =
  | 'installed'
  | 'loadable'
  | 'not-detected'
  | 'unsupported'

/** One detected Wallet Standard wallet, flattened for display. No adapter object. */
export interface RedaxWalletOptionView {
  readonly name: string
  readonly icon: string
  readonly readyState: RedaxWalletReadyState
  readonly connectable: boolean
}

/**
 * The narrow REDAX wallet context value. Connection context only: there is
 * deliberately no send/sign member here, no transaction member, and no raw
 * adapter access. The DEVNET_TX_ENABLED action surfaces that exist reach signing
 * through their own gated action roots, exactly as this note required, and this
 * facade was never widened for them — a consumer of it still cannot sign or send.
 */
export interface RedaxWalletContextValue {
  /** True only under a mounted RedaxWalletProvider. */
  readonly isWalletMode: boolean
  readonly walletsDetected: boolean
  readonly wallets: readonly RedaxWalletOptionView[]
  readonly selectedWalletName: string | null
  readonly status: RedaxWalletStatus
  /** Connected wallet public key (base58); null unless connected. */
  readonly publicKeyBase58: string | null
  /** Shortened display form (4…4) of publicKeyBase58; null unless connected. */
  readonly shortPublicKey: string | null
  /** Safe, fixed error copy; never a wallet-provided raw message. */
  readonly errorMessage: string | null
  /** User-initiated connect to a detected wallet by name. */
  connect(walletName: string): Promise<void>
  /** User-initiated disconnect of the active wallet. */
  disconnect(): Promise<void>
}
