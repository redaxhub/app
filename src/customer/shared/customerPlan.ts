// REDAX customer service — the draft, its validation and the frozen plan. Shared by both sides.
//
// THE CUSTOMER TYPES HUMAN UNITS; THE CHAIN STORES INTEGERS. This module is the one place the
// two meet for the customer flow. It reuses the existing exact converters (`redaxHumanUnits`)
// rather than re-deriving them, so a rate typed here and a rate typed in the V3 Team screen
// become byte-identical on-chain terms:
//
//   * "X old → Y gross new" is the exact reduced fraction Y/X (independent of decimals),
//   * a per-input or total limit is GROSS NEW tokens (holder share + the 1% fee) in the
//     output mint's 9 decimals — exactly what the program's `max_output_from_tc` and
//     `max_output_supply` count,
//   * "No limit" is an explicit choice that becomes the program's own `0`, never an empty box.
//
// THE SERVER FREEZES, THE BROWSER RE-CHECKS. `deriveRedaxCustomerPlanTerms` is pure and runs
// identically on both sides; the server's frozen output plus the publication commitments is
// the plan, and `computeRedaxCustomerPlanHash` is the one hash both sides compare.
//
// Imports use explicit `.js` specifiers because this file also runs inside the Vercel Function
// as native ESM; every module it imports has no runtime imports of its own.

import { isCanonicalRedaxPublicKey } from '../../config/redaxEnv.js'
import { calculateConversionQuote } from '../../lib/quoteMath.js'
import {
  REDAX_HUMAN_U128_MAX,
  describeRedaxHumanAmountRefusal,
  describeRedaxHumanRateRefusal,
  formatRedaxRawAmount,
  isPlausibleRedaxUnixSeconds,
  parseRedaxHumanRate,
  parseRedaxHumanTokenAmount,
  redaxPow10,
} from '../../lib/redaxHumanUnits.js'
import { redaxCanonicalJsonSha256 } from './customerCanonical.js'
import {
  REDAX_CUSTOMER_DESCRIPTION_MAX_CHARS,
  REDAX_CUSTOMER_MAX_INPUT_ROWS,
  REDAX_CUSTOMER_OUTPUT_DECIMALS,
  REDAX_CUSTOMER_PROTOCOL_FEE_BPS,
  type RedaxCustomerDraftRowV1,
  type RedaxCustomerDraftV1,
  type RedaxCustomerEndMode,
  type RedaxCustomerEndZone,
  type RedaxCustomerLimitMode,
  type RedaxCustomerLogoRefV1,
  type RedaxCustomerPlanRowV1,
  type RedaxCustomerPlanV1,
  type RedaxCustomerPublicationV1,
} from './customerContract.js'

/** On-chain byte bounds for the metadata strings (Metaplex / REDAX program). */
export const REDAX_CUSTOMER_NAME_MAX_BYTES = 32
export const REDAX_CUSTOMER_SYMBOL_MAX_BYTES = 10
export const REDAX_CUSTOMER_URI_MAX_BYTES = 200

/** An end time must leave at least this long to finish the setup steps. */
export const REDAX_CUSTOMER_END_MIN_LEAD_SECONDS = 5 * 60

export const EMPTY_REDAX_CUSTOMER_DRAFT: RedaxCustomerDraftV1 = Object.freeze({
  name: '',
  symbol: '',
  description: '',
  logo: null,
  rows: Object.freeze([]) as readonly RedaxCustomerDraftRowV1[],
  totalLimitMode: null,
  totalLimitAmount: '',
  endMode: null,
  endLocal: '',
  endZone: 'DEVICE' as RedaxCustomerEndZone,
  endZoneName: '',
  endUnixSeconds: '',
})

export function emptyRedaxCustomerDraftRow(rowId: string): RedaxCustomerDraftRowV1 {
  return {
    rowId,
    legacyMint: '',
    legacyDecimals: null,
    oldAmount: '',
    newAmount: '',
    limitMode: null,
    limitAmount: '',
  }
}

// --- Text rules ----------------------------------------------------------------------------

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).length
}

function isWellFormedUtf16(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index)
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = index + 1 < value.length ? value.charCodeAt(index + 1) : -1
      if (next < 0xdc00 || next > 0xdfff) {
        return false
      }
      index += 1
      continue
    }
    if (unit >= 0xdc00 && unit <= 0xdfff) {
      return false
    }
  }
  return true
}

// C0/C1 controls, DEL, line/paragraph separators, BOM and bidi overrides: none of them
// belongs in a token name a wallet will render next to a balance.
const FORBIDDEN_TEXT = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\ufeff\u202a-\u202e\u2066-\u2069]/

export type RedaxCustomerTextCheck =
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly message: string }

/** The exact on-chain token name: NFC, no outer spaces, no control text, 1..32 bytes. */
export function checkRedaxCustomerTokenName(raw: string): RedaxCustomerTextCheck {
  if (typeof raw !== 'string' || !isWellFormedUtf16(raw)) {
    return { ok: false, message: 'The name contains characters that cannot be stored.' }
  }
  const value = raw.normalize('NFC')
  if (value.trim() === '') {
    return { ok: false, message: 'Enter the new token’s name.' }
  }
  if (value !== value.trim()) {
    return { ok: false, message: 'Remove the spaces at the start or end of the name.' }
  }
  if (FORBIDDEN_TEXT.test(value)) {
    return { ok: false, message: 'The name contains invisible or control characters.' }
  }
  if (utf8ByteLength(value) > REDAX_CUSTOMER_NAME_MAX_BYTES) {
    return { ok: false, message: `The name can be at most ${REDAX_CUSTOMER_NAME_MAX_BYTES} bytes (about 32 plain letters).` }
  }
  return { ok: true, value }
}

/** The exact on-chain symbol: NFC, no spaces at all, no control text, 1..10 bytes. */
export function checkRedaxCustomerTokenSymbol(raw: string): RedaxCustomerTextCheck {
  if (typeof raw !== 'string' || !isWellFormedUtf16(raw)) {
    return { ok: false, message: 'The symbol contains characters that cannot be stored.' }
  }
  const value = raw.normalize('NFC')
  if (value === '') {
    return { ok: false, message: 'Enter the new token’s symbol.' }
  }
  if (/\s/.test(value)) {
    return { ok: false, message: 'The symbol cannot contain spaces.' }
  }
  if (FORBIDDEN_TEXT.test(value)) {
    return { ok: false, message: 'The symbol contains invisible or control characters.' }
  }
  if (utf8ByteLength(value) > REDAX_CUSTOMER_SYMBOL_MAX_BYTES) {
    return { ok: false, message: `The symbol can be at most ${REDAX_CUSTOMER_SYMBOL_MAX_BYTES} bytes (about 10 plain letters).` }
  }
  return { ok: true, value }
}

export function checkRedaxCustomerDescription(raw: string): RedaxCustomerTextCheck {
  if (typeof raw !== 'string' || !isWellFormedUtf16(raw)) {
    return { ok: false, message: 'The description contains characters that cannot be stored.' }
  }
  const value = raw.normalize('NFC').trim()
  if (/[\u0000-\u0009\u000b-\u001f\u007f\u2028\u2029\ufeff\u202a-\u202e\u2066-\u2069]/.test(value)) {
    return { ok: false, message: 'The description contains invisible or control characters.' }
  }
  if (value.length > REDAX_CUSTOMER_DESCRIPTION_MAX_CHARS) {
    return { ok: false, message: `Keep the description under ${REDAX_CUSTOMER_DESCRIPTION_MAX_CHARS} characters.` }
  }
  return { ok: true, value }
}

// --- Rows ------------------------------------------------------------------------------------

export interface RedaxCustomerIssue {
  /** `name`, `symbol`, `description`, `logo`, `rows`, `totalLimit`, `end`, or `row:<rowId>:<field>`. */
  readonly field: string
  readonly message: string
}

/** What one whole-number example of a row produces for a holder. Display only. */
export interface RedaxCustomerRowExample {
  readonly oldAmount: string
  readonly grossNew: string
  readonly feeNew: string
  readonly netNew: string
}

/**
 * Run the row's own "X old" through the program-equivalent quote math: normalize to the
 * output decimals, multiply by the exact rate with FLOOR, then the 1% FLOOR fee. `null` when
 * the row is not usable yet or the amount yields nothing.
 */
export function exampleRedaxCustomerRow(input: {
  readonly oldAmount: string
  readonly legacyDecimals: number | null
  readonly rateNumerator: string
  readonly rateDenominator: string
}): RedaxCustomerRowExample | null {
  if (input.legacyDecimals === null || input.rateNumerator === '' || input.rateDenominator === '') {
    return null
  }
  const amount = parseRedaxHumanTokenAmount(input.oldAmount, input.legacyDecimals, (1n << 64n) - 1n)
  if (!amount.ok) {
    return null
  }
  const quote = calculateConversionQuote(
    amount.raw,
    input.legacyDecimals,
    REDAX_CUSTOMER_OUTPUT_DECIMALS,
    BigInt(input.rateNumerator),
    BigInt(input.rateDenominator),
  )
  if (!quote.ok) {
    return null
  }
  return {
    oldAmount: amount.display,
    grossNew: formatRedaxRawAmount(quote.amounts.grossOut, REDAX_CUSTOMER_OUTPUT_DECIMALS),
    feeNew: formatRedaxRawAmount(quote.amounts.feeOut, REDAX_CUSTOMER_OUTPUT_DECIMALS),
    netNew: formatRedaxRawAmount(quote.amounts.userOut, REDAX_CUSTOMER_OUTPUT_DECIMALS),
  }
}

/** One row converted to exact terms, or its issues. Pure. */
export function convertRedaxCustomerRow(
  row: RedaxCustomerDraftRowV1,
): { readonly ok: true; readonly row: RedaxCustomerPlanRowV1 } | { readonly ok: false; readonly issues: readonly RedaxCustomerIssue[] } {
  const issues: RedaxCustomerIssue[] = []
  const field = (name: string): string => `row:${row.rowId}:${name}`
  const mint = typeof row.legacyMint === 'string' ? row.legacyMint.trim() : ''
  if (mint === '') {
    issues.push({ field: field('mint'), message: 'Paste the old token’s mint address.' })
  } else if (!isCanonicalRedaxPublicKey(mint)) {
    issues.push({ field: field('mint'), message: 'This is not a valid Solana mint address.' })
  }
  const decimals = row.legacyDecimals
  if (decimals === null || !Number.isSafeInteger(decimals) || decimals < 0 || decimals > 255) {
    issues.push({ field: field('mint'), message: 'Check this mint first, so its decimals are read from Devnet.' })
  }
  let rateNumerator = ''
  let rateDenominator = ''
  if (row.oldAmount.trim() === '' && row.newAmount.trim() === '') {
    issues.push({ field: field('rate'), message: 'Enter how many old tokens become how many new tokens.' })
  } else {
    const rate = parseRedaxHumanRate(row.oldAmount, row.newAmount)
    if (rate.ok) {
      rateNumerator = rate.numerator.toString()
      rateDenominator = rate.denominator.toString()
    } else {
      issues.push({ field: field('rate'), message: describeRedaxHumanRateRefusal(rate.refusal) })
    }
  }
  if (rateNumerator !== '' && decimals !== null && Number.isSafeInteger(decimals) && decimals >= 0 && decimals <= 255) {
    // One whole old token must mint at least one base unit, or holders could convert and
    // receive nothing at all.
    const quote = calculateConversionQuote(
      redaxPow10(decimals),
      decimals,
      REDAX_CUSTOMER_OUTPUT_DECIMALS,
      BigInt(rateNumerator),
      BigInt(rateDenominator),
    )
    if (!quote.ok) {
      issues.push({ field: field('rate'), message: 'One old token would produce less than the smallest unit of the new token. Raise the rate.' })
    }
  }
  let maxOutputFromTokenConfig = ''
  let limitAmount = ''
  if (row.limitMode === null) {
    issues.push({ field: field('limit'), message: 'Choose a limit for this input, or No limit.' })
  } else if (row.limitMode === 'NONE') {
    maxOutputFromTokenConfig = '0'
  } else {
    const cap = parseRedaxHumanTokenAmount(row.limitAmount, REDAX_CUSTOMER_OUTPUT_DECIMALS, REDAX_HUMAN_U128_MAX)
    if (cap.ok) {
      maxOutputFromTokenConfig = cap.raw.toString()
      limitAmount = cap.display
    } else {
      issues.push({ field: field('limit'), message: describeRedaxHumanAmountRefusal(cap.refusal, REDAX_CUSTOMER_OUTPUT_DECIMALS) })
    }
  }
  if (issues.length > 0 || decimals === null || row.limitMode === null) {
    return { ok: false, issues }
  }
  return {
    ok: true,
    row: {
      rowId: row.rowId,
      legacyMint: mint,
      legacyDecimals: decimals,
      oldAmount: row.oldAmount.trim(),
      newAmount: row.newAmount.trim(),
      rateNumerator,
      rateDenominator,
      limitMode: row.limitMode,
      limitAmount,
      maxOutputFromTokenConfig,
    },
  }
}

// --- Whole draft -----------------------------------------------------------------------------

/** Everything the plan carries except the publication commitments and the identities. */
export interface RedaxCustomerPlanTerms {
  readonly token: RedaxCustomerPlanV1['token']
  readonly rows: readonly RedaxCustomerPlanRowV1[]
  readonly totalLimit: RedaxCustomerPlanV1['totalLimit']
  readonly end: RedaxCustomerPlanV1['end']
  readonly logo: RedaxCustomerLogoRefV1
}

export type RedaxCustomerPlanTermsResult =
  | { readonly ok: true; readonly terms: RedaxCustomerPlanTerms }
  | { readonly ok: false; readonly issues: readonly RedaxCustomerIssue[] }

/**
 * Validate a complete draft and convert it to exact terms. Pure, total, never throws.
 *
 * `nowSeconds` is the judging clock for "the end is far enough in the future": the server's
 * clock when the server freezes, the device clock when the composer only previews. The
 * program's own Clock is what finally enforces the deadline either way.
 */
export function deriveRedaxCustomerPlanTerms(
  draft: RedaxCustomerDraftV1,
  nowSeconds: number,
): RedaxCustomerPlanTermsResult {
  const issues: RedaxCustomerIssue[] = []
  const name = checkRedaxCustomerTokenName(draft.name)
  if (!name.ok) {
    issues.push({ field: 'name', message: name.message })
  }
  const symbol = checkRedaxCustomerTokenSymbol(draft.symbol)
  if (!symbol.ok) {
    issues.push({ field: 'symbol', message: symbol.message })
  }
  const description = checkRedaxCustomerDescription(draft.description)
  if (!description.ok) {
    issues.push({ field: 'description', message: description.message })
  }
  const logo = draft.logo
  if (logo === null) {
    issues.push({ field: 'logo', message: 'Upload the new token’s logo.' })
  } else if (!logo.accepted) {
    issues.push({ field: 'logo', message: 'Confirm the final logo with “Use this logo”.' })
  }

  const rows: RedaxCustomerPlanRowV1[] = []
  if (draft.rows.length === 0) {
    issues.push({ field: 'rows', message: 'Add at least one old token.' })
  }
  if (draft.rows.length > REDAX_CUSTOMER_MAX_INPUT_ROWS) {
    issues.push({ field: 'rows', message: `A campaign accepts at most ${REDAX_CUSTOMER_MAX_INPUT_ROWS} old tokens.` })
  }
  const seenMints = new Set<string>()
  const seenRowIds = new Set<string>()
  for (const row of draft.rows) {
    if (seenRowIds.has(row.rowId)) {
      issues.push({ field: 'rows', message: 'Two rows share one id. Remove one and add it again.' })
    }
    seenRowIds.add(row.rowId)
    const converted = convertRedaxCustomerRow(row)
    if (!converted.ok) {
      issues.push(...converted.issues)
      continue
    }
    if (seenMints.has(converted.row.legacyMint)) {
      issues.push({ field: `row:${row.rowId}:mint`, message: 'This old token is already on another row.' })
      continue
    }
    seenMints.add(converted.row.legacyMint)
    rows.push(converted.row)
  }

  let totalLimit: RedaxCustomerPlanV1['totalLimit'] | null = null
  if (draft.totalLimitMode === null) {
    issues.push({ field: 'totalLimit', message: 'Choose a total limit, or No limit.' })
  } else if (draft.totalLimitMode === 'NONE') {
    totalLimit = { mode: 'NONE', amount: '', maxOutputSupply: '0' }
  } else {
    const cap = parseRedaxHumanTokenAmount(draft.totalLimitAmount, REDAX_CUSTOMER_OUTPUT_DECIMALS, REDAX_HUMAN_U128_MAX)
    if (cap.ok) {
      totalLimit = { mode: 'LIMIT', amount: cap.display, maxOutputSupply: cap.raw.toString() }
    } else {
      issues.push({ field: 'totalLimit', message: describeRedaxHumanAmountRefusal(cap.refusal, REDAX_CUSTOMER_OUTPUT_DECIMALS) })
    }
  }

  let end: RedaxCustomerPlanV1['end'] | null = null
  if (draft.endMode === null) {
    issues.push({ field: 'end', message: 'Choose an end date, or No end date.' })
  } else if (draft.endMode === 'NONE') {
    end = { mode: 'NONE', unixSeconds: '', local: '', zone: draft.endZone, zoneName: '' }
  } else {
    let seconds: bigint | null = null
    if (/^[1-9][0-9]{0,15}$/.test(draft.endUnixSeconds)) {
      seconds = BigInt(draft.endUnixSeconds)
    }
    if (seconds === null || !isPlausibleRedaxUnixSeconds(seconds)) {
      issues.push({ field: 'end', message: 'Choose a valid end date and time.' })
    } else if (seconds < BigInt(Math.floor(nowSeconds)) + BigInt(REDAX_CUSTOMER_END_MIN_LEAD_SECONDS)) {
      issues.push({ field: 'end', message: 'The end must be at least 5 minutes from now, so the setup can be finished first.' })
    } else {
      end = {
        mode: 'DATE',
        unixSeconds: seconds.toString(),
        local: draft.endLocal,
        zone: draft.endZone,
        zoneName: draft.endZoneName,
      }
    }
  }

  if (issues.length > 0 || !name.ok || !symbol.ok || !description.ok || logo === null || totalLimit === null || end === null) {
    return { ok: false, issues }
  }
  return {
    ok: true,
    terms: {
      token: { name: name.value, symbol: symbol.value, description: description.value },
      rows,
      totalLimit,
      end,
      logo,
    },
  }
}

/** Assemble the frozen plan from validated terms and the publication commitments. */
export function buildRedaxCustomerPlan(input: {
  readonly setupId: string
  readonly programId: string
  readonly teamWallet: string
  readonly terms: RedaxCustomerPlanTerms
  readonly publication: RedaxCustomerPublicationV1
  readonly preparedAt: number
}): RedaxCustomerPlanV1 {
  return {
    schema: 'redax.customer.plan.v1',
    setupId: input.setupId,
    network: 'devnet',
    programId: input.programId,
    teamWallet: input.teamWallet,
    token: input.terms.token,
    outputDecimals: REDAX_CUSTOMER_OUTPUT_DECIMALS,
    protocolFeeBps: REDAX_CUSTOMER_PROTOCOL_FEE_BPS,
    rows: input.terms.rows,
    totalLimit: input.terms.totalLimit,
    end: input.terms.end,
    publication: input.publication,
    preparedAt: input.preparedAt,
  }
}

/** THE plan hash: SHA-256 of the canonical JSON of the whole frozen plan. */
export function computeRedaxCustomerPlanHash(plan: RedaxCustomerPlanV1): Promise<string> {
  return redaxCanonicalJsonSha256(plan)
}

/** Does the plan still hash to what was reviewed? A false here stops every guided step. */
export async function isRedaxCustomerPlanHashCurrent(
  plan: RedaxCustomerPlanV1,
  expected: string,
): Promise<boolean> {
  try {
    return (await computeRedaxCustomerPlanHash(plan)) === expected
  } catch {
    return false
  }
}

/** The display label of a gross-new-token amount ('No limit' for the program's 0). */
export function describeRedaxCustomerLimit(mode: RedaxCustomerLimitMode, amount: string): string {
  return mode === 'NONE' ? 'No limit' : `${amount} new tokens (gross)`
}

/** The fee share of a gross amount, as text, for review copy. */
export function describeRedaxCustomerFee(): string {
  return `${REDAX_CUSTOMER_PROTOCOL_FEE_BPS / 100}%`
}

export type { RedaxCustomerEndMode, RedaxCustomerLimitMode }
