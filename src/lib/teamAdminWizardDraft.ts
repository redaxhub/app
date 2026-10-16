// REDAX Team/Admin wizard — local draft field model and field validation.
//
// Boundary: zero imports. No React, no wallet, no data source, no RPC, no
// Anchor / web3 / SPL / IDL, no network, no persistence, and no clock. Every
// export is a plain type or a total function over strings; nothing here throws,
// and THIS MODULE submits nothing — it decides only what a supplied string is.
//
// The THIRTEEN-FIELD draft record below stays preview-oriented — the Campaign
// Create panel owns its own separate five-field draft and only borrows this
// per-field policy. It derives no
// PDA, decodes no address, encodes no salt, and validates no address format —
// address-shaped fields carry a non-empty warning and nothing more. Bounds
// mirror the program's own guards so a local warning matches what the chain
// would reject: MAX_NAME_LENGTH / MAX_SYMBOL_LENGTH / MAX_URI_LENGTH
// (constants.rs) are byte lengths, because Rust's String::len() counts bytes;
// rate_numerator / rate_denominator / max_output_supply / max_output_from_tc
// are u128; and the campaign window is an Option<i64>.
//
// The draft holds the thirteen team-entered setup fields, and only those. The
// protocol fee vault is deliberately absent: it is the canonical classic-SPL
// associated token account the program derives from the output mint and the
// REDAX protocol fee authority, so a team never chooses or enters it and the
// program rejects any other account. The wizard presents it as a static row
// from productCopy.ts instead of an input; nothing here holds, validates, or
// derives an address for it.
//
// Numeric parsing is strict decimal only. Bare BigInt() would accept a 0x or 0b
// prefix and map the empty string to 0n, which is unsafe precisely where 0 is
// the meaningful "uncapped" sentinel; parseDraftUnsignedInteger separates empty
// from invalid from a parsed value. Number is never used: these are u128 base
// units, far beyond a double's exact integer range.

/** Every local draft field, in the order the wizard steps present them. */
export const TEAM_ADMIN_WIZARD_FIELD_IDS = [
  'outputMint',
  'campaignIdentitySalt',
  'outputGovernance',
  'campaignAdmin',
  'endTs',
  'maxOutputSupply',
  'legacyInputMint',
  'rateNumerator',
  'rateDenominator',
  'perInputCap',
  'metadataName',
  'metadataSymbol',
  'metadataUri',
] as const

export type TeamAdminWizardFieldId = (typeof TEAM_ADMIN_WIZARD_FIELD_IDS)[number]

/** The whole draft: one raw string per field, held in component memory only. */
export type TeamAdminWizardDraft = Record<TeamAdminWizardFieldId, string>

export const EMPTY_TEAM_ADMIN_WIZARD_DRAFT: TeamAdminWizardDraft = {
  outputMint: '',
  campaignIdentitySalt: '',
  outputGovernance: '',
  campaignAdmin: '',
  endTs: '',
  maxOutputSupply: '',
  legacyInputMint: '',
  rateNumerator: '',
  rateDenominator: '',
  perInputCap: '',
  metadataName: '',
  metadataSymbol: '',
  metadataUri: '',
}

// --- Bounds (mirror the program; never imported from it) ---------------------

/** Largest u128 — the ceiling for rates and output caps. */
export const U128_MAX = 340282366920938463463374607431768211455n

/** Largest i64 — the ceiling for an optional campaign end timestamp. */
export const I64_MAX = 9223372036854775807n

export const MAX_METADATA_NAME_BYTES = 32
export const MAX_METADATA_SYMBOL_BYTES = 10
export const MAX_METADATA_URI_BYTES = 200

// --- Strict decimal parsing --------------------------------------------------

/** An empty draft entry, an unparseable one, or a parsed unsigned integer. */
export type DraftNumberParse =
  | { kind: 'empty' }
  | { kind: 'invalid' }
  | { kind: 'ok'; value: bigint }

const DECIMAL_DIGITS = /^[0-9]+$/

const TEXT_ENCODER = new TextEncoder()

/**
 * Parse an unsigned integer from a draft entry. Decimal digits only: a sign, a
 * decimal point, an exponent, and a 0x / 0b prefix are all invalid rather than
 * silently accepted, and the empty entry is distinguished from a parsed zero.
 * Never throws.
 */
export function parseDraftUnsignedInteger(raw: string): DraftNumberParse {
  const trimmed = raw.trim()
  if (trimmed === '') {
    return { kind: 'empty' }
  }
  if (!DECIMAL_DIGITS.test(trimmed)) {
    return { kind: 'invalid' }
  }
  return { kind: 'ok', value: BigInt(trimmed) }
}

/** UTF-8 byte length — what the program's String::len() bound actually counts. */
export function draftByteLength(value: string): number {
  return TEXT_ENCODER.encode(value).length
}

// --- Field validation --------------------------------------------------------

/**
 * A field-level judgement, with two tones that now mean different things to
 * different callers.
 *
 * `note` stays neutral information and blocks nothing for either caller.
 */
export interface TeamAdminWizardFieldValidation {
  readonly tone: 'warning' | 'note'
  readonly message: string
}

const DIGITS_ONLY_MESSAGE =
  'Base units only — decimal digits, with no decimal point, sign, exponent, or 0x prefix.'

function warn(message: string): TeamAdminWizardFieldValidation {
  return { tone: 'warning', message }
}

function note(message: string): TeamAdminWizardFieldValidation {
  return { tone: 'note', message }
}

function requireNonEmpty(
  value: string,
  message: string,
): TeamAdminWizardFieldValidation | null {
  return value.trim() === '' ? warn(message) : null
}

/** A campaign-level or per-input output cap: required, u128, and 0 = uncapped. */
function validateCap(value: string): TeamAdminWizardFieldValidation | null {
  const parsed = parseDraftUnsignedInteger(value)
  if (parsed.kind === 'empty') {
    return warn('Required — enter 0 for uncapped.')
  }
  if (parsed.kind === 'invalid') {
    return warn(DIGITS_ONLY_MESSAGE)
  }
  if (parsed.value > U128_MAX) {
    return warn('Above the u128 maximum.')
  }
  if (parsed.value === 0n) {
    return note('0 = uncapped.')
  }
  return null
}

/** A rate half: required, u128, and non-zero — a zero half is an invalid rate. */
function validateRateHalf(value: string): TeamAdminWizardFieldValidation | null {
  const parsed = parseDraftUnsignedInteger(value)
  if (parsed.kind === 'empty') {
    return warn('Required — a rate half cannot be empty.')
  }
  if (parsed.kind === 'invalid') {
    return warn(DIGITS_ONLY_MESSAGE)
  }
  if (parsed.value > U128_MAX) {
    return warn('Above the u128 maximum.')
  }
  if (parsed.value === 0n) {
    return warn('Must be non-zero — a zero numerator or denominator is an invalid rate.')
  }
  return null
}

/**
 * The optional campaign window. Empty means no window; no clock is consulted.
 *
 * A SUPPLIED deadline must be positive. The frozen campaign-plan validator
 * rejects a non-positive supplied `endTs`, so leaving zero as a neutral note let
 * the Campaign Create panel enable a submission that could not succeed. The
 * parser is unsigned, which makes zero the one reachable non-positive value, and
 * rejecting it needs no clock: whether a positive timestamp is strictly in the
 * future is a chain-time question this module still refuses to guess.
 */
function validateEndTs(value: string): TeamAdminWizardFieldValidation | null {
  const parsed = parseDraftUnsignedInteger(value)
  if (parsed.kind === 'empty') {
    return null
  }
  if (parsed.kind === 'invalid') {
    return warn('Unix seconds only — decimal digits, with no decimal point or sign.')
  }
  if (parsed.value === 0n) {
    return warn('If set, the deadline must be a positive Unix timestamp.')
  }
  if (parsed.value > I64_MAX) {
    return warn('Above the i64 maximum.')
  }
  return note('Optional. If set, it must be strictly in the future at initialization.')
}

/** Metadata text: required, and bounded by the program's byte length, not characters. */
function validateMetadataText(
  value: string,
  maxBytes: number,
  emptyMessage: string,
): TeamAdminWizardFieldValidation | null {
  if (value.trim() === '') {
    return warn(emptyMessage)
  }
  const bytes = draftByteLength(value)
  if (bytes > maxBytes) {
    return warn(`Over the ${maxBytes}-byte limit — this draft is ${bytes} bytes.`)
  }
  return null
}

/**
 * Validate one draft field. Returns null when there is nothing to say. Total,
 * pure, and non-throwing; it queries no chain, derives no address, and stores
 * nothing.
 */
export function validateTeamAdminWizardField(
  id: TeamAdminWizardFieldId,
  value: string,
): TeamAdminWizardFieldValidation | null {
  switch (id) {
    case 'outputMint':
    case 'outputGovernance':
    case 'campaignAdmin':
    case 'legacyInputMint':
      return requireNonEmpty(value, 'Required — a draft entry, checked by eye only.')
    case 'campaignIdentitySalt':
      return requireNonEmpty(
        value,
        'Required — a draft label. The campaign salt is 32 bytes; this draft encodes and derives nothing.',
      )
    case 'endTs':
      return validateEndTs(value)
    case 'maxOutputSupply':
    case 'perInputCap':
      return validateCap(value)
    case 'rateNumerator':
    case 'rateDenominator':
      return validateRateHalf(value)
    case 'metadataName':
      return validateMetadataText(
        value,
        MAX_METADATA_NAME_BYTES,
        'Required — the output token name cannot be empty.',
      )
    case 'metadataSymbol':
      return validateMetadataText(
        value,
        MAX_METADATA_SYMBOL_BYTES,
        'Required — the output token symbol cannot be empty.',
      )
    case 'metadataUri':
      return validateMetadataText(
        value,
        MAX_METADATA_URI_BYTES,
        'Required — the metadata location cannot be empty.',
      )
  }
}

/** Keyboard hint for the numeric base-unit and timestamp fields. */
export function getTeamAdminWizardInputMode(
  id: TeamAdminWizardFieldId,
): 'text' | 'numeric' {
  switch (id) {
    case 'endTs':
    case 'maxOutputSupply':
    case 'rateNumerator':
    case 'rateDenominator':
    case 'perInputCap':
      return 'numeric'
    default:
      return 'text'
  }
}
