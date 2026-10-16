// REDAX shared quote math — pure, dependency-free BigInt oracle.
//
// Mirrors the on-chain conversion math (programs/redax_protocol/src/math/
// precision.rs) and the convert_exact_in gross-output cap projection
// (programs/redax_protocol/src/instructions/convert_exact_in.rs §14.5). It is the
// single source the MOCK_LOCAL selector / mapper layers share; a future devnet
// adapter can reuse it unchanged.
//
// Boundary: zero imports. No React, no wallet, no RPC, no Anchor / web3 / SPL /
// IDL, no fixtures, no env reads, no network. All arithmetic is BigInt — never
// floating point. This module makes no readiness claim.

// --- Fee constants (mirror constants.rs) -----------------------------------

/** Protocol fee in basis points (1% = 100 / 10000). FLOOR rounding. */
export const PROTOCOL_FEE_BPS = 100n

/** Basis-point denominator for all fee math. */
export const BPS_DENOMINATOR = 10_000n

// --- Integer-safe primitives -----------------------------------------------

/** Integer power of ten as BigInt (10^exp), via multiplication; exp assumed >= 0. */
export function pow10(exp: number): bigint {
  let acc = 1n
  for (let i = 0; i < exp; i += 1) {
    acc *= 10n
  }
  return acc
}

/** Parse a raw decimal-string amount to BigInt; invalid input falls back to 0n. */
export function parseRawAmount(raw: string): bigint {
  try {
    return BigInt(raw)
  } catch {
    return 0n
  }
}

/** Result of decimal normalization between legacy-input and output mint decimals. */
export interface NormalizationResult {
  normalized: bigint
  remainder: bigint
}

/**
 * Decimal normalization, mirroring the program: a down-scale (legacy > output)
 * divides and carries a remainder; equal decimals or an up-scale multiply with
 * no remainder. BigInt only.
 */
export function normalizeAmount(
  amountIn: bigint,
  legacyDecimals: number,
  outputDecimals: number,
): NormalizationResult {
  if (legacyDecimals > outputDecimals) {
    const divisor = pow10(legacyDecimals - outputDecimals)
    return { normalized: amountIn / divisor, remainder: amountIn % divisor }
  }
  const multiplier = pow10(outputDecimals - legacyDecimals)
  return { normalized: amountIn * multiplier, remainder: 0n }
}

/** Protocol fee out: floor(grossOut * PROTOCOL_FEE_BPS / BPS_DENOMINATOR). */
export function calculateFeeOut(grossOut: bigint): bigint {
  return (grossOut * PROTOCOL_FEE_BPS) / BPS_DENOMINATOR
}

/** The user / fee split of a gross output. userOut = grossOut - feeOut (exact). */
export interface OutputSplit {
  userOut: bigint
  feeOut: bigint
}

export function splitUserAndFee(grossOut: bigint): OutputSplit {
  const feeOut = calculateFeeOut(grossOut)
  return { userOut: grossOut - feeOut, feeOut }
}

// --- Conversion quote (non-throwing; on-chain guards surfaced as returns) ----

/**
 * A pre-burn quote rejection. Mirrors the distinct on-chain guard errors:
 * ZeroAmount, InvalidRate (zero numerator or denominator), and ZeroGrossOut.
 */
export type QuoteRejectionKind = 'zero_amount' | 'invalid_rate' | 'amount_too_small'

/** The five conversion amounts for an accepted quote. BigInt only. */
export interface ConversionAmounts {
  amountInNormalized: bigint
  normalizationRemainder: bigint
  grossOut: bigint
  feeOut: bigint
  userOut: bigint
}

/** Result of a conversion quote: accepted amounts, or a pre-burn rejection. */
export type ConversionQuoteResult =
  | { ok: true; amounts: ConversionAmounts }
  | { ok: false; rejection: QuoteRejectionKind; normalizationRemainder: bigint }

/**
 * Compute a conversion quote, never throwing. The check order and remainder
 * semantics mirror the program (and the prior mock selector): a zero amount and
 * an invalid rate reject before normalization (remainder 0); a zero gross output
 * rejects after normalization (remainder carried).
 */
export function calculateConversionQuote(
  amountIn: bigint,
  legacyDecimals: number,
  outputDecimals: number,
  rateNumerator: bigint,
  rateDenominator: bigint,
): ConversionQuoteResult {
  if (amountIn === 0n) {
    return { ok: false, rejection: 'zero_amount', normalizationRemainder: 0n }
  }
  if (rateNumerator === 0n || rateDenominator === 0n) {
    return { ok: false, rejection: 'invalid_rate', normalizationRemainder: 0n }
  }
  const { normalized, remainder } = normalizeAmount(amountIn, legacyDecimals, outputDecimals)
  const grossOut = (normalized * rateNumerator) / rateDenominator
  if (grossOut === 0n) {
    return { ok: false, rejection: 'amount_too_small', normalizationRemainder: remainder }
  }
  const { userOut, feeOut } = splitUserAndFee(grossOut)
  return {
    ok: true,
    amounts: {
      amountInNormalized: normalized,
      normalizationRemainder: remainder,
      grossOut,
      feeOut,
      userOut,
    },
  }
}

// --- Cap projection guard (mirrors convert_exact_in §14.5; uses grossOut) -----

/** Which cap a projected conversion would breach. */
export type CapBreach = 'campaign' | 'token_config'

/** Result of a cap projection: within cap, or a breach of a specific level. */
export type CapProjectionResult = { ok: true } | { ok: false; breach: CapBreach }

/**
 * Whether a conversion's grossOut keeps the campaign total within its cap. A cap
 * of 0n means uncapped (always within). Otherwise within iff
 * (minted + grossOut) <= cap.
 */
export function projectCampaignCap(grossOut: bigint, cap: bigint, minted: bigint): boolean {
  if (cap === 0n) {
    return true
  }
  return minted + grossOut <= cap
}

/** As projectCampaignCap, for a token-config-level cap. */
export function projectTokenConfigCap(grossOut: bigint, cap: bigint, minted: bigint): boolean {
  if (cap === 0n) {
    return true
  }
  return minted + grossOut <= cap
}

/**
 * Project a conversion's grossOut against both caps. The campaign cap is checked
 * first (mirroring the program's order), so a campaign breach takes precedence
 * over a token-config breach.
 */
export function evaluateCapProjection(
  grossOut: bigint,
  campaignCap: bigint,
  campaignMinted: bigint,
  tokenConfigCap: bigint,
  tokenConfigMinted: bigint,
): CapProjectionResult {
  if (!projectCampaignCap(grossOut, campaignCap, campaignMinted)) {
    return { ok: false, breach: 'campaign' }
  }
  if (!projectTokenConfigCap(grossOut, tokenConfigCap, tokenConfigMinted)) {
    return { ok: false, breach: 'token_config' }
  }
  return { ok: true }
}

// EVERYTHING ABOVE THIS LINE IS PRESENTATION MATH AND KEEPS ITS EXACT SEMANTICS.
// `calculateConversionQuote` and `evaluateCapProjection` compute a mathematically
// correct answer in arbitrary precision — which is right for a preview panel and
// WRONG for a transaction. JavaScript BigInt happily produces a value at exactly the
// points where the program refuses, so a wallet prompt built on it can be certain to
// fail on chain.
//
// This section adds the one API that is TRANSACTION AUTHORITY. It mirrors the Rust
// handler's FINITE WIDTHS, in the handler's order, at every intermediate:
//
//   * `10^exp` is accumulated CHECKED against u128 and is never assumed to fit;
//   * the up-scaling multiplication is checked;
//   * `normalized × rate_numerator` is checked BEFORE the division, so a product
//     that overflows refuses even when the quotient would have fitted;
//   * `gross_out × PROTOCOL_FEE_BPS` is checked before its division;
//   * `gross_out − fee_out` is a checked subtraction;
//   * `user_out` and then `fee_out` must EACH fit u64 inclusively, because the
//     classic SPL Token program takes u64 amounts;
//   * every counter the handler later advances is projected with a checked u128
//     addition — including where the matching cap is the `0 = uncapped` sentinel,
//     since the counter is written whether or not a cap is enforced.
//
// Arbitrary precision is NOT parity. Nothing below relies on BigInt's unboundedness
// as evidence that an on-chain operation fits; every bound is asserted explicitly.
//
// Pure, zero-import, BigInt-only, and NONTHROWING for every declared input: a refusal
// is a returned code, never an exception, so a caller can refuse before it constructs
// an instruction, before it writes a durable attempt record, and before it asks a
// holder to approve anything.

/** Inclusive maximum u64 — the classic-SPL amount width. */
export const REDAX_U64_MAX = 18446744073709551615n

/** Inclusive maximum u128 — the width of every rate, cap and cumulative counter. */
export const REDAX_U128_MAX = 340282366920938463463374607431768211455n

/** Largest `u8` decimal exponent an on-chain mint can declare. */
const REDAX_DECIMALS_MAX = 255

/** The exact fresh chain facts a transaction-authority quote is computed from. */
export interface RedaxTransactionAuthorityQuoteInput {
  readonly amountIn: bigint
  readonly legacyDecimals: number
  readonly outputDecimals: number
  readonly rateNumerator: bigint
  readonly rateDenominator: bigint
  readonly campaignTotalOutputMinted: bigint
  readonly campaignTotalProtocolFeesMinted: bigint
  readonly maxOutputSupply: bigint
  readonly tokenConfigTotalOutputMintedFromTc: bigint
  readonly tokenConfigNormalizationRemainderTotal: bigint
  readonly maxOutputFromTc: bigint
}

/**
 * The exact counter values a successful conversion would leave behind.
 *
 * Returned rather than recomputed downstream: an exact post-effect comparison that
 * re-derived these from its own copy of the formulas would be checking a second
 * implementation, and the single-oracle discipline exists precisely to stop that.
 */
export interface RedaxTransactionAuthorityProjection {
  readonly campaignTotalOutputMinted: bigint
  readonly campaignTotalProtocolFeesMinted: bigint
  readonly tokenConfigTotalOutputMintedFromTc: bigint
  readonly tokenConfigNormalizationRemainderTotal: bigint
}

/** Every value-free reason the checked quote refuses. Closed, exact, ordered. */
export type RedaxTransactionAuthorityQuoteRejectionCode =
  | 'AMOUNT_OUT_OF_RANGE'
  | 'DECIMALS_OUT_OF_RANGE'
  | 'RATE_OUT_OF_RANGE'
  | 'RATE_INVALID'
  | 'COUNTER_OUT_OF_RANGE'
  | 'POW10_OVERFLOW'
  | 'NORMALIZATION_OVERFLOW'
  | 'RATE_PRODUCT_OVERFLOW'
  | 'ZERO_GROSS_OUT'
  | 'FEE_PRODUCT_OVERFLOW'
  | 'USER_SUBTRACTION_UNDERFLOW'
  | 'USER_OUTPUT_U64_OVERFLOW'
  | 'FEE_OUTPUT_U64_OVERFLOW'
  | 'CAMPAIGN_TOTAL_OVERFLOW'
  | 'CAMPAIGN_CAP_EXCEEDED'
  | 'TOKEN_CONFIG_TOTAL_OVERFLOW'
  | 'TOKEN_CONFIG_CAP_EXCEEDED'
  | 'CAMPAIGN_FEE_TOTAL_OVERFLOW'
  | 'TOKEN_CONFIG_REMAINDER_TOTAL_OVERFLOW'

export type RedaxTransactionAuthorityQuoteResult =
  | {
      readonly ok: true
      readonly amounts: ConversionAmounts
      readonly projection: RedaxTransactionAuthorityProjection
    }
  | { readonly ok: false; readonly rejection: RedaxTransactionAuthorityQuoteRejectionCode }

/** A u128-bounded value, or null. The bound is asserted, never assumed. */
function checkedU128(value: bigint): bigint | null {
  return value >= 0n && value <= REDAX_U128_MAX ? value : null
}

/** `left * right`, refused when the product leaves u128. */
function checkedMulU128(left: bigint, right: bigint): bigint | null {
  return checkedU128(left * right)
}

/** `left + right`, refused when the sum leaves u128. */
function checkedAddU128(left: bigint, right: bigint): bigint | null {
  return checkedU128(left + right)
}

/** `left - right`, refused when the difference would go negative. */
function checkedSubU128(left: bigint, right: bigint): bigint | null {
  const difference = left - right
  return difference >= 0n ? difference : null
}

/**
 * `10^exp` by CHECKED repeated multiplication.
 *
 * Every partial product is bounded, so the refusal happens at the exact step the
 * handler's own accumulation would fail — not after computing an enormous value and
 * looking at it afterwards.
 */
function checkedPow10U128(exp: number): bigint | null {
  if (!Number.isSafeInteger(exp) || exp < 0) {
    return null
  }
  let accumulator = 1n
  for (let step = 0; step < exp; step += 1) {
    const next = checkedMulU128(accumulator, 10n)
    if (next === null) {
      return null
    }
    accumulator = next
  }
  return accumulator
}

/** Is this a declared, in-range decimal exponent for a classic-SPL mint? */
function isDeclaredDecimals(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0 && value <= REDAX_DECIMALS_MAX
}

const rejected = (
  rejection: RedaxTransactionAuthorityQuoteRejectionCode,
): RedaxTransactionAuthorityQuoteResult => ({ ok: false, rejection })

/**
 * The transaction-authority quote: the exact amounts and counter projections a
 * conversion would produce, or the exact finite-width reason the program would refuse
 * it. Never throws for any declared input.
 */
export function calculateRedaxTransactionAuthorityQuote(
  input: RedaxTransactionAuthorityQuoteInput,
): RedaxTransactionAuthorityQuoteResult {
  // 1. The burn amount is a positive classic-SPL u64.
  if (input.amountIn <= 0n || input.amountIn > REDAX_U64_MAX) {
    return rejected('AMOUNT_OUT_OF_RANGE')
  }
  // 2. Both decimal exponents are declared u8 values.
  if (!isDeclaredDecimals(input.legacyDecimals) || !isDeclaredDecimals(input.outputDecimals)) {
    return rejected('DECIMALS_OUT_OF_RANGE')
  }
  if (checkedU128(input.rateNumerator) === null || checkedU128(input.rateDenominator) === null) {
    return rejected('RATE_OUT_OF_RANGE')
  }
  if (input.rateNumerator === 0n || input.rateDenominator === 0n) {
    return rejected('RATE_INVALID')
  }
  // 4. Every counter and cap the projection consumes is itself a u128.
  for (const counter of [
    input.campaignTotalOutputMinted,
    input.campaignTotalProtocolFeesMinted,
    input.maxOutputSupply,
    input.tokenConfigTotalOutputMintedFromTc,
    input.tokenConfigNormalizationRemainderTotal,
    input.maxOutputFromTc,
  ]) {
    if (checkedU128(counter) === null) {
      return rejected('COUNTER_OUT_OF_RANGE')
    }
  }

  // 5/6. Checked normalization. FLOOR down-scale carries a remainder in input units;
  //      an up-scale multiplies and carries none.
  const downScales = input.legacyDecimals > input.outputDecimals
  const exponent = downScales
    ? input.legacyDecimals - input.outputDecimals
    : input.outputDecimals - input.legacyDecimals
  const scale = checkedPow10U128(exponent)
  if (scale === null) {
    return rejected('POW10_OVERFLOW')
  }
  let normalized: bigint
  let normalizationRemainder: bigint
  if (downScales) {
    normalized = input.amountIn / scale
    normalizationRemainder = input.amountIn % scale
  } else {
    const scaled = checkedMulU128(input.amountIn, scale)
    if (scaled === null) {
      return rejected('NORMALIZATION_OVERFLOW')
    }
    normalized = scaled
    normalizationRemainder = 0n
  }

  // 7. The rate product is checked BEFORE the division — an overflowing product is a
  //    real, reachable refusal in the full u128 rate domain, not a theoretical one.
  const rateProduct = checkedMulU128(normalized, input.rateNumerator)
  if (rateProduct === null) {
    return rejected('RATE_PRODUCT_OVERFLOW')
  }
  const grossOut = rateProduct / input.rateDenominator

  // 8. Nothing to mint is a refusal, not a zero-value conversion.
  if (grossOut === 0n) {
    return rejected('ZERO_GROSS_OUT')
  }

  // 9/10. The FLOOR fee split, checked at both steps.
  const feeProduct = checkedMulU128(grossOut, PROTOCOL_FEE_BPS)
  if (feeProduct === null) {
    return rejected('FEE_PRODUCT_OVERFLOW')
  }
  const feeOut = feeProduct / BPS_DENOMINATOR
  const userOut = checkedSubU128(grossOut, feeOut)
  if (userOut === null) {
    return rejected('USER_SUBTRACTION_UNDERFLOW')
  }

  // 11. Both minted amounts reach a classic-SPL CPI, so both must fit u64 —
  //     inclusively, and user-first, exactly as the handler narrows them.
  if (userOut > REDAX_U64_MAX) {
    return rejected('USER_OUTPUT_U64_OVERFLOW')
  }
  if (feeOut > REDAX_U64_MAX) {
    // Defense in depth. With a fixed 100-bps FLOOR fee, `user_out = 99q + r` while
    // `fee_out = q`, so a fee above u64 implies a user amount above u64 and the check
    // above has already refused. This guard is retained, not relied upon.
    return rejected('FEE_OUTPUT_U64_OVERFLOW')
  }

  // 12. Campaign gross-output counter: project, then compare against the cap.
  const campaignTotalOutputMinted = checkedAddU128(input.campaignTotalOutputMinted, grossOut)
  if (campaignTotalOutputMinted === null) {
    return rejected('CAMPAIGN_TOTAL_OVERFLOW')
  }
  if (input.maxOutputSupply > 0n && campaignTotalOutputMinted > input.maxOutputSupply) {
    return rejected('CAMPAIGN_CAP_EXCEEDED')
  }

  // 13. TokenConfig gross-output counter, same shape, checked after the campaign.
  const tokenConfigTotalOutputMintedFromTc = checkedAddU128(
    input.tokenConfigTotalOutputMintedFromTc,
    grossOut,
  )
  if (tokenConfigTotalOutputMintedFromTc === null) {
    return rejected('TOKEN_CONFIG_TOTAL_OVERFLOW')
  }
  if (input.maxOutputFromTc > 0n && tokenConfigTotalOutputMintedFromTc > input.maxOutputFromTc) {
    return rejected('TOKEN_CONFIG_CAP_EXCEEDED')
  }

  // 14/15. The two uncapped counters. A `0` cap means UNCAPPED, never unwritten — the
  //        handler still advances both, so both projections must fit u128.
  const campaignTotalProtocolFeesMinted = checkedAddU128(
    input.campaignTotalProtocolFeesMinted,
    feeOut,
  )
  if (campaignTotalProtocolFeesMinted === null) {
    return rejected('CAMPAIGN_FEE_TOTAL_OVERFLOW')
  }
  const tokenConfigNormalizationRemainderTotal = checkedAddU128(
    input.tokenConfigNormalizationRemainderTotal,
    normalizationRemainder,
  )
  if (tokenConfigNormalizationRemainderTotal === null) {
    return rejected('TOKEN_CONFIG_REMAINDER_TOTAL_OVERFLOW')
  }

  return {
    ok: true,
    amounts: {
      amountInNormalized: normalized,
      normalizationRemainder,
      grossOut,
      feeOut,
      userOut,
    },
    projection: {
      campaignTotalOutputMinted,
      campaignTotalProtocolFeesMinted,
      tokenConfigTotalOutputMintedFromTc,
      tokenConfigNormalizationRemainderTotal,
    },
  }
}
