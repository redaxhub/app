// REDAX customer service — small display helpers. Pure; no data, no network, no wallet.

import { formatRedaxUnixSecondsDevice, formatRedaxUnixSecondsUtc } from '../lib/redaxHumanUnits'
import type { RedaxCustomerPlanV1, RedaxCustomerSetupState } from './shared/customerContract.js'

export function shortRedaxAddress(value: string): string {
  return value.length <= 12 ? value : `${value.slice(0, 4)}…${value.slice(-4)}`
}

export function describeRedaxCustomerSetupState(state: RedaxCustomerSetupState, chainStatus: string | null): string {
  if (chainStatus === 'active') {
    return 'Active'
  }
  if (chainStatus === 'paused') {
    return 'Paused'
  }
  if (chainStatus === 'finalized') {
    return 'Finalized'
  }
  switch (state) {
    case 'DRAFT':
      return 'Draft'
    case 'REVIEW_READY':
      return 'Ready to review'
    case 'PUBLISHED':
      return 'Setup started — create the campaign'
    case 'STARTED':
      return 'Setup in progress'
  }
}

export function describeRedaxCustomerEnd(plan: RedaxCustomerPlanV1): string {
  if (plan.end.mode === 'NONE') {
    return 'No end date'
  }
  const seconds = BigInt(plan.end.unixSeconds)
  return `${formatRedaxUnixSecondsUtc(seconds)} · ${formatRedaxUnixSecondsDevice(seconds)} on this device`
}

export function describeRedaxCustomerTime(epochMs: number): string {
  try {
    return new Date(epochMs).toLocaleString()
  } catch {
    return new Date(epochMs).toISOString()
  }
}

/** "X old → Y new" for a plan row. */
export function describeRedaxCustomerRate(oldAmount: string, newAmount: string): string {
  return `${oldAmount} old → ${newAmount} new (gross)`
}
