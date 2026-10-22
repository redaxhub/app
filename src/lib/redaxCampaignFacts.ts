// REDAX campaign facts as text — pure display helpers over values read from the Campaign and
// TokenConfig accounts themselves (demo customer flow, 2026-10-22).
//
// They exist so an UNLISTED campaign — one with no curated directory row — still shows its
// end, its gross limit and what remains of it, straight from the chain values App already
// loaded, instead of "—". They decide nothing and authorize nothing.

import { formatRedaxRawAmount, formatRedaxUnixSecondsDevice, formatRedaxUnixSecondsUtc } from './redaxHumanUnits'

/** Remaining gross output under one cap, as text. `0` on chain means no limit. */
export function describeRedaxGrossCap(
  capRaw: string | undefined,
  mintedRaw: string | undefined,
  decimals: number,
): string {
  let cap: bigint
  let minted: bigint
  if (typeof capRaw !== 'string' || typeof mintedRaw !== 'string') {
    return '—'
  }
  try {
    cap = BigInt(capRaw)
    minted = BigInt(mintedRaw)
  } catch {
    return '—'
  }
  if (cap === 0n) {
    return `No limit · ${formatRedaxRawAmount(minted, decimals)} produced so far`
  }
  const remaining = cap > minted ? cap - minted : 0n
  return `${formatRedaxRawAmount(minted, decimals)} of ${formatRedaxRawAmount(cap, decimals)} produced · ${
    remaining === 0n ? '0 remaining (limit reached)' : `${formatRedaxRawAmount(remaining, decimals)} remaining`
  }`
}

/** The campaign end, in this device's zone and in UTC, or "No end date". */
export function describeRedaxCampaignEnd(endTs: number | null | undefined, nowMs: number): string {
  if (endTs === null) {
    return 'No end date'
  }
  if (typeof endTs !== 'number' || !Number.isSafeInteger(endTs)) {
    // Not a value read from a Campaign account: say nothing rather than invent a date.
    return '—'
  }
  const seconds = BigInt(endTs)
  const passed = endTs * 1000 <= nowMs
  return `${formatRedaxUnixSecondsDevice(seconds)} · ${formatRedaxUnixSecondsUtc(seconds)}${
    passed ? ' · end time reached (this device’s clock)' : ''
  }`
}
