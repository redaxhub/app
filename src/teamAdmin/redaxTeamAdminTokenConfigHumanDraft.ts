// REDAX Team/Admin — one accepted-input row in HUMAN units.
//
// A person describes an accepted input the way they think about it: "X whole old tokens
// become Y whole new tokens before the 1% fee", and "this input may mint at most N new
// tokens, or has no limit". This pure module turns that into the EXACT raw row the
// `add_token_config` corridor has always carried — `rate_numerator`, `rate_denominator`,
// `max_output_from_tc` — and nothing else. The raw row, its validation, its derived PDA,
// the mutation identity and the instruction are untouched; only how the row is typed is.
//
// The legacy mint's decimals are NOT typed at all any more: they are filled from a
// read-only mint read (see `readClassicMintFacts`), and the mutation root re-reads the mint
// itself before the wallet is asked.

import { calculateConversionQuote } from '../lib/quoteMath'
import {
  REDAX_HUMAN_U128_MAX,
  describeRedaxHumanAmountRefusal,
  describeRedaxHumanRateRefusal,
  formatRedaxRawAmount,
  parseRedaxHumanRate,
  parseRedaxHumanTokenAmount,
  redaxPow10,
} from '../lib/redaxHumanUnits'

/** The human half of one row. Held in panel memory only, beside the raw row. */
export interface RedaxTeamAdminTokenConfigHumanDraft {
  /** Whole OLD tokens on the left of the rate, as typed. */
  readonly oldAmount: string
  /** Whole gross NEW tokens on the right of the rate, as typed. */
  readonly newAmount: string
  /** `null` until the person chooses; "No limit" is never what an empty field means. */
  readonly capMode: 'LIMIT' | 'NONE' | null
  /** Gross NEW tokens, as typed. Only read when `capMode === 'LIMIT'`. */
  readonly capAmount: string
}

export const EMPTY_REDAX_TEAM_ADMIN_TOKEN_CONFIG_HUMAN_DRAFT: RedaxTeamAdminTokenConfigHumanDraft =
  Object.freeze({ oldAmount: '', newAmount: '', capMode: null, capAmount: '' })

/** The raw values the human half converts to. `''` where the human value is not usable. */
export interface RedaxTeamAdminTokenConfigHumanConversion {
  readonly rateNumerator: string
  readonly rateDenominator: string
  readonly maxOutputFromTokenConfig: string
  readonly rateIssue: string | null
  readonly capIssue: string | null
}

/**
 * Convert the human half to the exact raw row fields.
 *
 * An empty raw string is deliberately what an unusable human value becomes: the existing
 * raw-row validation then refuses the row as `REQUIRED`, so there is one admission
 * authority and the human layer can never smuggle a value past it.
 */
export function convertRedaxTeamAdminTokenConfigHumanDraft(
  human: RedaxTeamAdminTokenConfigHumanDraft,
  outputDecimals: number,
): RedaxTeamAdminTokenConfigHumanConversion {
  let rateNumerator = ''
  let rateDenominator = ''
  let rateIssue: string | null = null
  if (human.oldAmount.trim() === '' && human.newAmount.trim() === '') {
    rateIssue = 'Enter how many old tokens become how many new tokens.'
  } else {
    const rate = parseRedaxHumanRate(human.oldAmount, human.newAmount)
    if (rate.ok) {
      rateNumerator = rate.numerator.toString()
      rateDenominator = rate.denominator.toString()
    } else {
      rateIssue = describeRedaxHumanRateRefusal(rate.refusal)
    }
  }

  let maxOutputFromTokenConfig = ''
  let capIssue: string | null = null
  if (human.capMode === null) {
    capIssue = 'Choose Set a limit or No limit for this input.'
  } else if (human.capMode === 'NONE') {
    // The program's own encoding of "no per-input limit".
    maxOutputFromTokenConfig = '0'
  } else {
    const cap = parseRedaxHumanTokenAmount(human.capAmount, outputDecimals, REDAX_HUMAN_U128_MAX)
    if (cap.ok) {
      maxOutputFromTokenConfig = cap.raw.toString()
    } else {
      capIssue = describeRedaxHumanAmountRefusal(cap.refusal, outputDecimals)
    }
  }
  return { rateNumerator, rateDenominator, maxOutputFromTokenConfig, rateIssue, capIssue }
}

/** One worked example a person can check by eye: what ONE whole old token yields. */
export interface RedaxTeamAdminTokenConfigExample {
  readonly grossOut: string
  readonly feeOut: string
  readonly netOut: string
}

/**
 * Run ONE whole old token through the program-equivalent quote math (normalize the input
 * to the output decimals, multiply by the exact rate with FLOOR, then the 1% FLOOR fee).
 * `null` when the inputs are not usable or one whole token yields nothing.
 */
export function exampleRedaxTeamAdminTokenConfigQuote(
  rateNumerator: string,
  rateDenominator: string,
  legacyDecimals: number | null,
  outputDecimals: number,
): RedaxTeamAdminTokenConfigExample | null {
  if (legacyDecimals === null || rateNumerator === '' || rateDenominator === '') {
    return null
  }
  let numerator: bigint
  let denominator: bigint
  try {
    numerator = BigInt(rateNumerator)
    denominator = BigInt(rateDenominator)
  } catch {
    return null
  }
  const quote = calculateConversionQuote(
    redaxPow10(legacyDecimals),
    legacyDecimals,
    outputDecimals,
    numerator,
    denominator,
  )
  if (!quote.ok) {
    return null
  }
  return {
    grossOut: formatRedaxRawAmount(quote.amounts.grossOut, outputDecimals),
    feeOut: formatRedaxRawAmount(quote.amounts.feeOut, outputDecimals),
    netOut: formatRedaxRawAmount(quote.amounts.userOut, outputDecimals),
  }
}

/**
 * EVERYTHING a row's review is about, beyond its own terms: the exact target campaign and its
 * output mint, the network and program, the approved Team and the wallet actually connected,
 * and a context epoch that advances whenever the selection or the connected wallet changes.
 *
 * The same raw terms are a DIFFERENT approval in another campaign: identical rates in campaign
 * B never inherit a review a person gave in campaign A, and a wallet that disconnects and comes
 * back starts a new epoch, so its earlier tick is not silently revived.
 */
export interface RedaxTeamAdminTokenConfigReviewBinding {
  readonly campaign: string
  readonly outputMint: string
  readonly programId: string
  readonly network: string
  readonly approvedTeamWallet: string
  readonly connectedWallet: string
  readonly contextEpoch: number
}

/**
 * A stable key over the exact raw terms AND the exact target a review acknowledgement belongs
 * to, or `null` when the target is not fully known — and with no target there is no review.
 */
export function redaxTeamAdminTokenConfigReviewKey(
  row: {
    readonly legacyMint: string
    readonly expectedLegacyDecimals: string
    readonly rateNumerator: string
    readonly rateDenominator: string
    readonly maxOutputFromTokenConfig: string
  },
  binding: RedaxTeamAdminTokenConfigReviewBinding | null,
): string | null {
  if (binding === null) {
    return null
  }
  return JSON.stringify([
    binding.network,
    binding.programId,
    binding.campaign,
    binding.outputMint,
    binding.approvedTeamWallet,
    binding.connectedWallet,
    binding.contextEpoch,
    row.legacyMint,
    row.expectedLegacyDecimals,
    row.rateNumerator,
    row.rateDenominator,
    row.maxOutputFromTokenConfig,
  ])
}
