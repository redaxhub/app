// Global product chrome: text wordmark, navigation, environment badge,
// standing stage + proof boundary lines. Navigation is local view state passed
// in by the caller; this chrome contains no wallet logic and initiates no
// transaction. It only hosts an optional caller-supplied wallet-status slot
// (`walletSlot`, used by App solely in DEVNET_WALLET_READONLY) — when the slot
// is absent the chrome renders exactly as before. Whether on-chain data is
// read belongs to the mode-aware data source, not to this component.

import type { ReactNode } from 'react'
import {
  PRODUCT_NAME,
  PROOF_BOUNDARY_BODY,
  STAGE_BOUNDARY,
  STAGE_LABEL,
  UNLISTED_CAMPAIGN_REQUESTED_WARNING,
  UNLISTED_CAMPAIGN_RESOLVED_WARNING,
} from '../lib/productCopy'
import { EnvironmentBadge } from './EnvironmentBadge'

export interface ShellNavItem {
  readonly id: string
  readonly label: string
  readonly hint: string
}

interface AppShellProps {
  navItems: readonly ShellNavItem[]
  activeId: string
  onNavigate: (id: string) => void
  /** Optional data-source badge text (the resolved data mode + note). Display only. */
  mockModeLabel?: string
  mockModeNote?: string
  mockModeTitle?: string
  /** Optional wallet-status slot (DEVNET_WALLET_READONLY only). Caller-supplied; no wallet logic here. */
  walletSlot?: ReactNode
  /**
   * Which unlisted-campaign statement this render may make, or none.
   *
   * `'requested'` — an address was named and nothing has resolved under it yet, so the
   * warning must not call it a campaign. `'resolved'` — a campaign loaded under that
   * exact address, so it may. `null`/absent — the selection is a curated listing and no
   * warning renders at all. Display only: no address travels in this prop.
   */
  unlistedCampaignPhase?: 'requested' | 'resolved' | null
  children: ReactNode
}

export function AppShell({
  navItems,
  activeId,
  onNavigate,
  mockModeLabel,
  mockModeNote,
  mockModeTitle,
  walletSlot,
  unlistedCampaignPhase = null,
  children,
}: AppShellProps) {
  return (
    <div className="shell">
      <aside className="shell__sidebar">
        <div className="wordmark">
          <span className="wordmark__name">{PRODUCT_NAME}</span>
          <span className="wordmark__sub">Conversion infrastructure</span>
        </div>
        <nav className="nav" aria-label="Product surfaces">
          {navItems.map((item) => (
            <button
              key={item.id}
              type="button"
              className={item.id === activeId ? 'nav__item nav__item--active' : 'nav__item'}
              aria-current={item.id === activeId ? 'page' : undefined}
              onClick={() => onNavigate(item.id)}
            >
              <span className="nav__label">{item.label}</span>
              <span className="nav__hint">{item.hint}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar__foot">
          <p>{STAGE_BOUNDARY}</p>
        </div>
      </aside>
      <div className="shell__main">
        <header className="topbar">
          <span className="topbar__stage">{STAGE_LABEL}</span>
          <div className="topbar__badges">
            {mockModeLabel ? (
              <span className="mock-badge" title={mockModeTitle}>
                <span className="mock-badge__dot" aria-hidden="true" />
                <span className="mock-badge__label">{mockModeLabel}</span>
                {mockModeNote ? <span className="mock-badge__note">{mockModeNote}</span> : null}
              </span>
            ) : null}
            {walletSlot ?? null}
            <EnvironmentBadge />
          </div>
        </header>
        {unlistedCampaignPhase !== null ? (
          <div className="topbar" role="note">
            <p className="note-line">
              {unlistedCampaignPhase === 'resolved'
                ? UNLISTED_CAMPAIGN_RESOLVED_WARNING
                : UNLISTED_CAMPAIGN_REQUESTED_WARNING}
            </p>
          </div>
        ) : null}
        <main className="content">{children}</main>
        <footer className="footer">
          <p>{PROOF_BOUNDARY_BODY}</p>
          <p className="footer__fine">
            REDAX Phase 1 interface. Proof-bounded — any wallet-approved action is devnet-only and
            limited to explicitly gated surfaces. Campaign listings are curated by this deployment
            and are not review, verification or endorsement. No readiness, investor, mainnet or
            production claim is made, and nothing here states that this build is deployed or
            accepted anywhere.
          </p>
        </footer>
      </div>
    </div>
  )
}
