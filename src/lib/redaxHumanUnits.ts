// REDAX human units — exact conversion between what a person types and the canonical
// on-chain integers the Team/Admin plans carry.
//
// PURE AND EXACT. Every economic value is produced with BigInt arithmetic over the exact
// decimal digits the person typed. Nothing is routed through a JavaScript number, a
// rounded decimal, `parseFloat`, `toFixed` or scientific notation, so `7/3` stays the exact
// rational 7/3 and `30` output tokens is exactly `30000000000` base units at 9 decimals.
//
// ONE DECIMAL POLICY, STATED ONCE: a dot is the only decimal separator. A comma is refused
// with its own code ("use a dot"), because `1,5` and `1,500` are ambiguous between a
// decimal comma and a thousands separator, and guessing between them could move a value by
// a factor of a thousand. Spaces, signs, exponents, hexadecimal and leading-zero runs are
// refused. A refused value never becomes a raw value.
//
// It reads no environment, no storage, no network and no wallet. The only platform facts
// it touches are the browser's own calendar functions in the date helpers, and those are
// named and isolated below.

/** Largest u64 — the program's per-transaction token amount width. */
export const REDAX_HUMAN_U64_MAX = 18446744073709551615n

/** Largest u128 — the program's cap and rate width. */
export const REDAX_HUMAN_U128_MAX = 340282366920938463463374607431768211455n

/** Largest i64 — the program's optional `end_ts` width. */
export const REDAX_HUMAN_I64_MAX = 9223372036854775807n

/**
 * Unix seconds above this are refused as "looks like milliseconds". 10^11 seconds is the
 * year 5138; a millisecond timestamp for any date after 1973 is above it.
 */
export const REDAX_UNIX_SECONDS_PLAUSIBLE_MAX = 100_000_000_000n

/** The most fractional digits a rate side may carry. Bounded so a rate stays reviewable. */
export const REDAX_RATE_MAX_FRACTION_DIGITS = 12

/** Why a typed amount was refused. Closed and value-free. */
export type RedaxHumanAmountRefusal =
  | 'EMPTY'
  | 'COMMA_NOT_ALLOWED'
  | 'NOT_A_NUMBER'
  | 'TOO_MANY_DECIMALS'
  | 'ZERO_NOT_ALLOWED'
  | 'TOO_LARGE'

export type RedaxHumanAmountParse =
  | {
      readonly ok: true
      /** The exact canonical integer at the requested decimals. */
      readonly raw: bigint
      /** The exact decimal text the raw value represents, without trailing zeros. */
      readonly display: string
    }
  | { readonly ok: false; readonly refusal: RedaxHumanAmountRefusal }

/** Digits, then optionally one dot and at least one digit. No leading-zero runs. */
const DECIMAL_TEXT_PATTERN = /^(0|[1-9][0-9]*)(\.[0-9]+)?$/

/** 10^n as a BigInt, for a small non-negative safe integer n. */
export function redaxPow10(exponent: number): bigint {
  if (!Number.isSafeInteger(exponent) || exponent < 0) {
    throw new RangeError('exponent out of range')
  }
  let value = 1n
  for (let step = 0; step < exponent; step += 1) {
    value *= 10n
  }
  return value
}

/** Split strict decimal text into its integer and fractional digit strings, or refuse. */
function splitDecimalText(
  text: string,
): { readonly ok: true; readonly whole: string; readonly fraction: string } | { readonly ok: false; readonly refusal: RedaxHumanAmountRefusal } {
  const trimmed = text.trim()
  if (trimmed === '') {
    return { ok: false, refusal: 'EMPTY' }
  }
  if (trimmed.includes(',')) {
    return { ok: false, refusal: 'COMMA_NOT_ALLOWED' }
  }
  const match = DECIMAL_TEXT_PATTERN.exec(trimmed)
  if (match === null) {
    return { ok: false, refusal: 'NOT_A_NUMBER' }
  }
  return { ok: true, whole: match[1], fraction: match[2] === undefined ? '' : match[2].slice(1) }
}

/**
 * Format an exact raw integer at `decimals` as plain decimal text.
 *
 * Trailing fractional zeros are dropped and a whole value has no dot: `30000000000` at 9
 * decimals is `30`, `6000000001` is `6.000000001`. Never scientific notation.
 */
export function formatRedaxRawAmount(raw: bigint, decimals: number): string {
  if (raw < 0n) {
    return `-${formatRedaxRawAmount(-raw, decimals)}`
  }
  if (decimals === 0) {
    return raw.toString()
  }
  const scale = redaxPow10(decimals)
  const whole = raw / scale
  const fraction = (raw % scale).toString().padStart(decimals, '0').replace(/0+$/, '')
  return fraction === '' ? whole.toString() : `${whole.toString()}.${fraction}`
}

/** Group the integer part with thin spaces for reading only. Never parsed back. */
export function groupRedaxRawDigits(raw: bigint): string {
  return raw.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
}

/**
 * Parse a typed token amount into the exact raw integer at `decimals`.
 *
 * `allowZero` is false for every economic amount except where zero is a deliberate,
 * separately chosen value; a cap's "no limit" is a separate explicit choice and is never
 * reached by typing 0.
 */
export function parseRedaxHumanTokenAmount(
  text: string,
  decimals: number,
  max: bigint,
  options: { readonly allowZero?: boolean } = {},
): RedaxHumanAmountParse {
  const split = splitDecimalText(text)
  if (!split.ok) {
    return split
  }
  if (split.fraction.length > decimals) {
    return { ok: false, refusal: 'TOO_MANY_DECIMALS' }
  }
  const raw =
    BigInt(split.whole) * redaxPow10(decimals) +
    (split.fraction === '' ? 0n : BigInt(split.fraction.padEnd(decimals, '0')))
  if (raw === 0n && options.allowZero !== true) {
    return { ok: false, refusal: 'ZERO_NOT_ALLOWED' }
  }
  if (raw > max) {
    return { ok: false, refusal: 'TOO_LARGE' }
  }
  return { ok: true, raw, display: formatRedaxRawAmount(raw, decimals) }
}

/** A human-readable sentence for each amount refusal. */
export function describeRedaxHumanAmountRefusal(
  refusal: RedaxHumanAmountRefusal,
  decimals: number,
): string {
  switch (refusal) {
    case 'EMPTY':
      return 'Enter an amount.'
    case 'COMMA_NOT_ALLOWED':
      return 'Use a dot for decimals, for example 1.5. Commas and thousands separators are not accepted.'
    case 'NOT_A_NUMBER':
      return 'Enter a plain number such as 30 or 2.5 — no spaces, signs, letters or exponents.'
    case 'TOO_MANY_DECIMALS':
      return `This token has ${decimals} decimal places; enter at most ${decimals} digits after the dot.`
    case 'ZERO_NOT_ALLOWED':
      return 'Enter an amount above zero.'
    case 'TOO_LARGE':
      return 'This amount is above what the program can store.'
  }
}

// --- Exact rational rates -----------------------------------------------------------

/** Why a typed rate was refused. Closed and value-free. */
export type RedaxHumanRateRefusal =
  | 'OLD_AMOUNT_INVALID'
  | 'NEW_AMOUNT_INVALID'
  | 'TOO_MANY_DECIMALS'
  | 'ZERO_NOT_ALLOWED'
  | 'COMMA_NOT_ALLOWED'
  | 'TOO_LARGE'

export type RedaxHumanRateParse =
  | {
      readonly ok: true
      /** Gross NEW tokens per OLD token, as an exact reduced fraction. */
      readonly numerator: bigint
      readonly denominator: bigint
    }
  | { readonly ok: false; readonly refusal: RedaxHumanRateRefusal }

function gcd(left: bigint, right: bigint): bigint {
  let a = left < 0n ? -left : left
  let b = right < 0n ? -right : right
  while (b !== 0n) {
    const t = a % b
    a = b
    b = t
  }
  return a
}

/** One side of a rate, as an exact scaled integer, or a refusal. */
function parseRateSide(
  text: string,
): { readonly ok: true; readonly scaled: bigint; readonly exponent: number } | { readonly ok: false; readonly refusal: RedaxHumanAmountRefusal } {
  const split = splitDecimalText(text)
  if (!split.ok) {
    return split
  }
  if (split.fraction.length > REDAX_RATE_MAX_FRACTION_DIGITS) {
    return { ok: false, refusal: 'TOO_MANY_DECIMALS' }
  }
  const scaled = BigInt(split.whole + split.fraction)
  if (scaled === 0n) {
    return { ok: false, refusal: 'ZERO_NOT_ALLOWED' }
  }
  return { ok: true, scaled, exponent: split.fraction.length }
}

/**
 * "X whole OLD tokens → Y whole gross NEW tokens" as the exact on-chain rate.
 *
 * The program normalizes the input amount to the output decimals FIRST, then multiplies by
 * `rate_numerator / rate_denominator` with FLOOR, then takes the 1% FLOOR fee. So a rate
 * between WHOLE tokens is exactly `Y / X`, independent of either mint's decimals. With
 * `X = a / 10^p` and `Y = b / 10^q` the fraction is `(b · 10^p) / (a · 10^q)`, reduced by
 * its greatest common divisor — never rounded and never approximated.
 */
export function parseRedaxHumanRate(oldText: string, newText: string): RedaxHumanRateParse {
  const oldSide = parseRateSide(oldText)
  if (!oldSide.ok) {
    return {
      ok: false,
      refusal:
        oldSide.refusal === 'COMMA_NOT_ALLOWED'
          ? 'COMMA_NOT_ALLOWED'
          : oldSide.refusal === 'TOO_MANY_DECIMALS'
            ? 'TOO_MANY_DECIMALS'
            : oldSide.refusal === 'ZERO_NOT_ALLOWED'
              ? 'ZERO_NOT_ALLOWED'
              : 'OLD_AMOUNT_INVALID',
    }
  }
  const newSide = parseRateSide(newText)
  if (!newSide.ok) {
    return {
      ok: false,
      refusal:
        newSide.refusal === 'COMMA_NOT_ALLOWED'
          ? 'COMMA_NOT_ALLOWED'
          : newSide.refusal === 'TOO_MANY_DECIMALS'
            ? 'TOO_MANY_DECIMALS'
            : newSide.refusal === 'ZERO_NOT_ALLOWED'
              ? 'ZERO_NOT_ALLOWED'
              : 'NEW_AMOUNT_INVALID',
    }
  }
  const numerator = newSide.scaled * redaxPow10(oldSide.exponent)
  const denominator = oldSide.scaled * redaxPow10(newSide.exponent)
  const divisor = gcd(numerator, denominator)
  const reducedNumerator = numerator / divisor
  const reducedDenominator = denominator / divisor
  if (reducedNumerator > REDAX_HUMAN_U128_MAX || reducedDenominator > REDAX_HUMAN_U128_MAX) {
    return { ok: false, refusal: 'TOO_LARGE' }
  }
  return { ok: true, numerator: reducedNumerator, denominator: reducedDenominator }
}

export function describeRedaxHumanRateRefusal(refusal: RedaxHumanRateRefusal): string {
  switch (refusal) {
    case 'OLD_AMOUNT_INVALID':
      return 'Enter how many old tokens, as a plain number such as 1, 2 or 3.'
    case 'NEW_AMOUNT_INVALID':
      return 'Enter how many new tokens, as a plain number such as 1, 3 or 7.'
    case 'TOO_MANY_DECIMALS':
      return `Use at most ${REDAX_RATE_MAX_FRACTION_DIGITS} digits after the dot in a rate.`
    case 'ZERO_NOT_ALLOWED':
      return 'Both sides of the rate must be above zero.'
    case 'COMMA_NOT_ALLOWED':
      return 'Use a dot for decimals, for example 1.5. Commas are not accepted.'
    case 'TOO_LARGE':
      return 'This rate is above what the program can store.'
  }
}

/** The exact rate, as text a person can read: "3 old → 7 new (before the 1% fee)". */
export function describeRedaxExactRate(numerator: bigint, denominator: bigint): string {
  return `${denominator.toString()} old → ${numerator.toString()} new (gross, before the 1% fee)`
}

// --- Date and time ----------------------------------------------------------------------

/** How the person's typed local date-time is anchored. */
export type RedaxDateTimeZoneChoice = 'DEVICE' | 'UTC'

export type RedaxHumanDateTimeRefusal =
  | 'EMPTY'
  | 'NOT_A_DATE_TIME'
  | 'NONEXISTENT_LOCAL_TIME'
  | 'NOT_IN_FUTURE'
  | 'LOOKS_LIKE_MILLISECONDS'

export type RedaxHumanDateTimeParse =
  | {
      readonly ok: true
      /** Canonical Unix SECONDS, the exact value an S1 plan carries as `end_ts`. */
      readonly unixSeconds: bigint
    }
  | { readonly ok: false; readonly refusal: RedaxHumanDateTimeRefusal }

/** `YYYY-MM-DDTHH:MM` or `YYYY-MM-DDTHH:MM:SS`, as a `datetime-local` control yields it. */
const DATE_TIME_LOCAL_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/

/**
 * Convert one `datetime-local` value to exact Unix seconds.
 *
 * In `DEVICE` mode the wall-clock time is interpreted in this device's time zone; in `UTC`
 * mode it is UTC. A wall-clock time that does not exist on this device (a daylight-saving
 * gap) or a calendar impossibility such as 31 April is refused rather than silently moved.
 * `nowMs` is the comparison clock for "in the future": the device clock, shown to the person
 * as such. The program's own Clock is what finally enforces the deadline.
 */
export function parseRedaxHumanDateTime(
  value: string,
  zone: RedaxDateTimeZoneChoice,
  nowMs: number,
): RedaxHumanDateTimeParse {
  const trimmed = value.trim()
  if (trimmed === '') {
    return { ok: false, refusal: 'EMPTY' }
  }
  const match = DATE_TIME_LOCAL_PATTERN.exec(trimmed)
  if (match === null) {
    return { ok: false, refusal: 'NOT_A_DATE_TIME' }
  }
  const [year, month, day, hour, minute] = [1, 2, 3, 4, 5].map((index) => Number(match[index]))
  const second = match[6] === undefined ? 0 : Number(match[6])
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) {
    return { ok: false, refusal: 'NOT_A_DATE_TIME' }
  }
  let epochMs: number
  if (zone === 'UTC') {
    epochMs = Date.UTC(year, month - 1, day, hour, minute, second, 0)
    const check = new Date(epochMs)
    if (
      check.getUTCFullYear() !== year ||
      check.getUTCMonth() !== month - 1 ||
      check.getUTCDate() !== day
    ) {
      return { ok: false, refusal: 'NOT_A_DATE_TIME' }
    }
  } else {
    const local = new Date(year, month - 1, day, hour, minute, second, 0)
    epochMs = local.getTime()
    if (
      local.getFullYear() !== year ||
      local.getMonth() !== month - 1 ||
      local.getDate() !== day
    ) {
      return { ok: false, refusal: 'NOT_A_DATE_TIME' }
    }
    if (local.getHours() !== hour || local.getMinutes() !== minute) {
      return { ok: false, refusal: 'NONEXISTENT_LOCAL_TIME' }
    }
  }
  if (!Number.isSafeInteger(epochMs)) {
    return { ok: false, refusal: 'NOT_A_DATE_TIME' }
  }
  // Integer milliseconds to integer seconds: an exact division, because the control has no
  // sub-second precision and the value above is a whole number of seconds by construction.
  const unixSeconds = BigInt(epochMs) / 1000n
  if (unixSeconds >= REDAX_UNIX_SECONDS_PLAUSIBLE_MAX) {
    return { ok: false, refusal: 'LOOKS_LIKE_MILLISECONDS' }
  }
  if (epochMs <= nowMs) {
    return { ok: false, refusal: 'NOT_IN_FUTURE' }
  }
  return { ok: true, unixSeconds }
}

export function describeRedaxHumanDateTimeRefusal(refusal: RedaxHumanDateTimeRefusal): string {
  switch (refusal) {
    case 'EMPTY':
      return 'Choose an end date and time, or choose “No end date”.'
    case 'NOT_A_DATE_TIME':
      return 'This is not a valid calendar date and time.'
    case 'NONEXISTENT_LOCAL_TIME':
      return 'This local time does not exist on this device (a daylight-saving change). Choose another time or switch to UTC.'
    case 'NOT_IN_FUTURE':
      return 'The end time must be in the future (checked against this device’s clock; the network checks again).'
    case 'LOOKS_LIKE_MILLISECONDS':
      return 'This date is beyond any plausible campaign end (the value would read like milliseconds rather than seconds). Choose an earlier date.'
  }
}

/** Is this a plausible canonical Unix-seconds value (positive, i64, not milliseconds)? */
export function isPlausibleRedaxUnixSeconds(value: bigint): boolean {
  return value > 0n && value < REDAX_UNIX_SECONDS_PLAUSIBLE_MAX && value <= REDAX_HUMAN_I64_MAX
}

/** `2026-10-22 11:35:00 UTC` — exact, from integer seconds. */
export function formatRedaxUnixSecondsUtc(seconds: bigint): string {
  if (!isPlausibleRedaxUnixSeconds(seconds)) {
    return `Unix ${seconds.toString()}`
  }
  const iso = new Date(Number(seconds) * 1000).toISOString()
  return `${iso.slice(0, 10)} ${iso.slice(11, 19)} UTC`
}

/** The device's IANA zone name, or a neutral label when the platform will not say. */
export function redaxDeviceTimeZoneName(): string {
  try {
    const zone = new Intl.DateTimeFormat().resolvedOptions().timeZone
    return typeof zone === 'string' && zone !== '' ? zone : 'this device'
  } catch {
    return 'this device'
  }
}

/** The device's UTC offset at an instant, as `UTC+03:00`. */
export function redaxDeviceUtcOffsetLabel(epochMs: number): string {
  const offsetMinutes = -new Date(epochMs).getTimezoneOffset()
  const sign = offsetMinutes >= 0 ? '+' : '-'
  const absolute = Math.abs(offsetMinutes)
  const hours = Math.floor(absolute / 60).toString().padStart(2, '0')
  const minutes = (absolute % 60).toString().padStart(2, '0')
  return `UTC${sign}${hours}:${minutes}`
}

/** `2026-10-22 14:35` on this device's wall clock, plus its zone and offset. */
export function formatRedaxUnixSecondsDevice(seconds: bigint): string {
  if (!isPlausibleRedaxUnixSeconds(seconds)) {
    return `Unix ${seconds.toString()}`
  }
  const epochMs = Number(seconds) * 1000
  const date = new Date(epochMs)
  const pad = (value: number): string => value.toString().padStart(2, '0')
  const text = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
  return `${text} ${redaxDeviceTimeZoneName()} (${redaxDeviceUtcOffsetLabel(epochMs)})`
}
