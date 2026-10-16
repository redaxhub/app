// REDAX wallet chrome control — the custom connect/disconnect UI for
// DEVNET_WALLET_READONLY. Renders only under RedaxWalletProvider (App mounts
// both only in that mode) and consumes only the narrow useRedaxWallet facade:
// no raw adapter, no transaction control, no signing control, no react-ui,
// no aggregate adapter UI. Wallet icons are deliberately omitted — names and
// states only. Truthful empty state when no compatible Wallet Standard wallet
// is detected.

import { useRedaxWallet } from './RedaxWalletProvider'
import type { RedaxRoleKind, RedaxWalletRoleContextView } from '../data/redaxViewModels'
import { WALLET_ROLE_CONTEXT_BOUNDARY_NOTE } from '../lib/productCopy'

const WALLET_BOUNDARY_NOTE = 'read-only wallet context — no transaction actions'

// Compact chip label per matched role kind. The role view also carries a full
// label (shown on hover). Read-only context only — a chip grants no capability.
const ROLE_SHORT_LABEL: Record<RedaxRoleKind, string> = {
  public: 'Connected address',
  holder: 'Holder',
  token_team: 'Token team',
  campaign_admin: 'Campaign admin',
  output_governance: 'Output governance',
  protocol_fee_authority: 'Fee authority',
  protocol_emergency_pause_authority: 'Emergency pause',
  observer: 'Observer',
  redax_operator: 'REDAX operator',
  unknown: 'Unknown',
}

interface RedaxWalletControlsProps {
  /** DEVNET_WALLET_READONLY connected-wallet role context; null before resolution. */
  roleContext?: RedaxWalletRoleContextView | null
}

export function RedaxWalletControls({ roleContext }: RedaxWalletControlsProps) {
  const wallet = useRedaxWallet()
  if (!wallet.isWalletMode) {
    // Defensive: outside a mounted provider this control renders nothing.
    return null
  }
  const busy = wallet.status === 'connecting' || wallet.status === 'disconnecting'
  // Matched read-only roles are shown only once resolved to the 'connected' state
  // for the connected wallet; any other state (unconnected / unavailable / null)
  // shows no chips and no role-context note.
  const matchedRoles =
    roleContext && roleContext.status === 'connected' ? roleContext.matchedRoles : []
  return (
    <span
      className="wallet-badge"
      title="Wallet connection context for DEVNET_WALLET_READONLY — read-only; no transaction actions."
    >
      <span className="wallet-badge__label">Wallet</span>
      {!wallet.walletsDetected ? (
        <span className="wallet-badge__note">No compatible Wallet Standard wallet detected</span>
      ) : wallet.status === 'connected' ? (
        <>
          <span className="wallet-badge__name">{wallet.selectedWalletName ?? 'Connected wallet'}</span>
          <span className="wallet-badge__key">{wallet.shortPublicKey ?? '—'}</span>
          <button
            type="button"
            className="wallet-badge__btn"
            onClick={() => {
              void wallet.disconnect()
            }}
          >
            Disconnect
          </button>
          {matchedRoles.length > 0 ? (
            <span
              className="wallet-badge__roles"
              role="group"
              aria-label="Matched REDAX roles for the connected wallet (read-only)"
            >
              {matchedRoles.map((roleView) => (
                <span key={roleView.role} className="wallet-badge__role" title={roleView.label}>
                  {ROLE_SHORT_LABEL[roleView.role]}
                </span>
              ))}
            </span>
          ) : null}
        </>
      ) : (
        <span className="wallet-badge__list" role="group" aria-label="Detected Wallet Standard wallets">
          {wallet.wallets.map((option) => (
            <button
              key={option.name}
              type="button"
              className="wallet-badge__btn"
              disabled={!option.connectable || busy}
              onClick={() => {
                void wallet.connect(option.name)
              }}
            >
              {wallet.status === 'connecting' && option.name === wallet.selectedWalletName
                ? `Connecting ${option.name}…`
                : `Connect ${option.name}`}
            </button>
          ))}
        </span>
      )}
      {wallet.errorMessage !== null ? (
        <span className="wallet-badge__error">{wallet.errorMessage}</span>
      ) : null}
      {matchedRoles.length > 0 ? (
        <span className="wallet-badge__note">{WALLET_ROLE_CONTEXT_BOUNDARY_NOTE}</span>
      ) : null}
      <span className="wallet-badge__note">{WALLET_BOUNDARY_NOTE}</span>
    </span>
  )
}
