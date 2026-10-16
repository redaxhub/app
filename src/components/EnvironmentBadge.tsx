// Always-visible environment badge (UX direction §9/§17). Shows the configured
// target environment label; whether on-chain data is actually read is
// determined by the current data-source mode, not by this badge.

import { DISPLAY_TARGET_ENVIRONMENT, ENVIRONMENTS } from '../config/env'
import { networkBadgeLabel } from '../lib/networkLabels'

export function EnvironmentBadge() {
  const environment = ENVIRONMENTS[DISPLAY_TARGET_ENVIRONMENT]
  return (
    <span className="env-badge" title={environment.purpose}>
      <span className="env-badge__dot" aria-hidden="true" />
      <span className="env-badge__label">{networkBadgeLabel(environment.key)}</span>
      <span className="env-badge__note">environment label</span>
    </span>
  )
}
