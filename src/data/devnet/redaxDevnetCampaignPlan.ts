// REDAX Team/Admin campaign plan — pure data, validation, canonical
// serialization and SHA-256 fingerprinting. NON-ACTIONABLE.
//
// Boundary: this module is pure data and validation. It builds no instruction,
// constructs no Transaction and no Connection, opens no RPC, touches no wallet
// or provider, reads no env, writes no storage, imports no React, and generates
// no entropy — it neither creates the campaign salt nor the output-mint keypair.
// Both of those are produced by a later, separately gated private action context
// and enter this module only as ALREADY-PUBLIC values (a 64-hex salt string and
// an output-mint PUBLIC key). No secret key is an input, a field, or an output
// of anything here.
//
// Three representations, deliberately distinct:
//
//   1. RedaxTeamAdminCampaignDraftV1   — raw editable strings (what a team types).
//   2. RedaxFrozenCampaignPlanV1       — the canonical, deeply frozen, plainly
//                                        serializable public plan. This is the
//                                        only shape that may ever be persisted or
//                                        carried as recovery state.
//   3. RedaxResolvedCampaignPlanV1     — the same plan resolved to PublicKey /
//                                        bigint for the instruction builders.
//                                        Never serialized as recovery state.
//
// The draft deliberately has NO output-mint field and NO salt field. The output
// mint is generated, never team-selected (a pasted arbitrary mint is not the
// product flow), and the salt is generated, never typed. Leaving them out of the
// draft type is what enforces that structurally, rather than by convention.
//
// Integer discipline: every protocol amount, rate, cap and timestamp is a decimal
// STRING in the frozen plan and a bigint in the resolved plan. JavaScript `number`
// is never used for any of them — a u128 cap is far outside a double's exact
// integer range, and `0` is a meaningful "uncapped" sentinel that must never be
// confused with an empty entry. Parsing is strict decimal only: a sign (other than
// a leading `-` on the signed timestamp), a decimal point, an exponent, a 0x/0b
// prefix and digit separators are all rejected rather than silently coerced.
//
// (The strict-decimal parsing here intentionally mirrors, rather than imports,
// the UI wizard's draft parser: this is the protocol-plan layer and must not
// depend on a UI module.)

import { PublicKey } from '@solana/web3.js'

import {
  REDAX_CAMPAIGN_SALT_BYTES,
  deriveCampaignPda,
  deriveOutputTokenMetadataPda,
  deriveProtocolConfigPda,
  deriveProtocolFeeVaultAta,
  deriveTokenConfigPda,
} from './redaxDevnetAccounts'

// --- Protocol constants (mirror programs/redax_protocol/src/constants.rs) -----

export const REDAX_OUTPUT_MINT_DECIMALS = 9

export const REDAX_OUTPUT_MINT_INITIAL_SUPPLY = '0'

export const REDAX_MAX_TOKEN_CONFIGS_PER_CAMPAIGN = 10

export const REDAX_MAX_METADATA_NAME_BYTES = 32
export const REDAX_MAX_METADATA_SYMBOL_BYTES = 10
export const REDAX_MAX_METADATA_URI_BYTES = 200

/** Largest u128 — the ceiling for rates and output caps. */
export const REDAX_U128_MAX = 340282366920938463463374607431768211455n
/** i64 bounds — the range of an optional campaign end timestamp. */
export const REDAX_I64_MAX = 9223372036854775807n
export const REDAX_I64_MIN = -9223372036854775808n

const TEXT_ENCODER = new TextEncoder()
const DECIMAL_DIGITS = /^[0-9]+$/
const SIGNED_DECIMAL = /^-?[0-9]+$/
const LOWERCASE_HEX_64 = /^[0-9a-f]{64}$/

// --- Lifecycle intent --------------------------------------------------------

/**
 * What the team intends AFTER the campaign exists. This is planning intent only:
 * S1 creates the Campaign in `Initialized`, and activation is a separate, later
 * instruction that the program will refuse unless metadata is set.
 */
export type RedaxCampaignLifecycleIntent = 'remain_initialized' | 'activate_after_setup'

// --- 1. Draft (raw editable strings) -----------------------------------------

/** One editable TokenConfig row. All values raw strings; identity is local. */
export interface RedaxTokenConfigDraftRowV1 {
  /**
   * Stable LOCAL row identity. Deliberately NOT the TokenConfig PDA: the PDA is
   * derived from the legacy mint, so editing the legacy mint moves the PDA while
   * the row itself is still the same row the team is editing.
   */
  readonly rowId: string
  readonly legacyMint: string
  /**
   * The legacy mint's decimals as the team expects them. This is OFF-CHAIN
   * PRECONDITION METADATA ONLY — it is NOT an `add_token_config` argument. The
   * program reads the ACTUAL decimals straight from the legacy and output mint
   * accounts and stores those; a wrong value here can never corrupt on-chain
   * state, it only means the local preview disagrees with the chain.
   */
  readonly expectedLegacyDecimals: string
  readonly rateNumerator: string
  readonly rateDenominator: string
  /** Per-TokenConfig output cap in base units. `0` = uncapped. */
  readonly maxOutputFromTokenConfig: string
}

/** The editable campaign draft. No PublicKey, Keypair, wallet or Connection. */
export interface RedaxTeamAdminCampaignDraftV1 {
  readonly payer: string
  readonly outputGovernance: string
  readonly campaignAdmin: string
  /** Optional deadline, Unix seconds. Empty string = no deadline. */
  readonly endTs: string
  /** Campaign-wide output cap in base units. `0` = uncapped. */
  readonly maxOutputSupply: string
  readonly metadataName: string
  readonly metadataSymbol: string
  readonly metadataUri: string
  readonly lifecycleIntent: RedaxCampaignLifecycleIntent
  readonly tokenConfigs: readonly RedaxTokenConfigDraftRowV1[]
}

export const EMPTY_REDAX_TEAM_ADMIN_CAMPAIGN_DRAFT: RedaxTeamAdminCampaignDraftV1 = {
  payer: '',
  outputGovernance: '',
  campaignAdmin: '',
  endTs: '',
  maxOutputSupply: '',
  metadataName: '',
  metadataSymbol: '',
  metadataUri: '',
  lifecycleIntent: 'remain_initialized',
  tokenConfigs: [],
}

// --- 2. Frozen public plan (canonical, serializable) --------------------------

/** A frozen TokenConfig plan. Integers are canonical decimal strings. */
export interface RedaxFrozenTokenConfigPlanV1 {
  readonly rowId: string
  readonly legacyMint: string
  /** Off-chain precondition metadata only — never an instruction argument. */
  readonly expectedLegacyDecimals: number
  /** Always 9; the program reads the real value from the output mint account. */
  readonly expectedOutputDecimals: 9
  readonly rateNumerator: string
  readonly rateDenominator: string
  readonly maxOutputFromTokenConfig: string
  /** Derived: `[b"token_config", campaign, legacy_mint]`. */
  readonly tokenConfig: string
  readonly tokenConfigBump: number
}

/**
 * The frozen, canonical, PUBLIC campaign plan. Plain data only — every field is a
 * string, a number, `null`, or an array of the same — so it is safely
 * serializable and may be carried as recovery state.
 *
 * It contains NO secret key, NO Keypair, NO adapter/provider object and NO signed
 * transaction bytes. The output mint appears only as its PUBLIC key.
 */
export interface RedaxFrozenCampaignPlanV1 {
  readonly version: 1
  readonly cluster: 'devnet'
  readonly programId: string
  readonly payer: string
  readonly outputGovernance: string
  readonly campaignAdmin: string
  /** Exactly 64 lowercase hex characters = the program's `[u8; 32]` salt. */
  readonly saltHex: string
  /** Derived: `[b"campaign", output_governance, salt]`. */
  readonly campaign: string
  readonly campaignBump: number
  /** Derived: `[b"protocol_config"]`. */
  readonly protocolConfig: string
  readonly outputMint: string
  readonly outputMintDecimals: 9
  readonly outputMintInitialSupply: '0'
  /** The output mint's authority IS the Campaign PDA (equals `campaign`). */
  readonly outputMintAuthority: string
  readonly outputMintFreezeAuthority: null
  /** Read fresh from the on-chain ProtocolConfig by the caller; never typed by a team. */
  readonly protocolFeeAuthority: string
  /** Derived canonical ATA; never a team input. */
  readonly protocolFeeVault: string
  /** Canonical signed-i64 decimal string, or null for no deadline. */
  readonly endTs: string | null
  readonly maxOutputSupply: string
  readonly metadataName: string
  readonly metadataSymbol: string
  readonly metadataUri: string
  /** Derived Metaplex metadata PDA for the output mint. */
  readonly metadataAccount: string
  readonly lifecycleIntent: RedaxCampaignLifecycleIntent
  readonly tokenConfigs: readonly RedaxFrozenTokenConfigPlanV1[]
}

// --- 3. Resolved plan (PublicKey / bigint, for builders) ----------------------

/** A resolved TokenConfig plan for the instruction builders. Never serialized. */
export interface RedaxResolvedTokenConfigPlanV1 {
  readonly rowId: string
  readonly legacyMint: PublicKey
  readonly expectedLegacyDecimals: number
  readonly rateNumerator: bigint
  readonly rateDenominator: bigint
  readonly maxOutputFromTokenConfig: bigint
  readonly tokenConfig: PublicKey
  readonly tokenConfigBump: number
}

/**
 * The resolved plan for builder use. Holds PublicKey / bigint / Uint8Array, so it
 * is NOT plain serializable data and must never be used as recovery state — carry
 * `RedaxFrozenCampaignPlanV1` for that. Still holds no secret key.
 */
export interface RedaxResolvedCampaignPlanV1 {
  readonly programId: PublicKey
  readonly payer: PublicKey
  readonly outputGovernance: PublicKey
  readonly campaignAdmin: PublicKey
  readonly salt: Uint8Array
  readonly campaign: PublicKey
  readonly campaignBump: number
  readonly protocolConfig: PublicKey
  readonly outputMint: PublicKey
  readonly outputMintDecimals: 9
  readonly protocolFeeAuthority: PublicKey
  readonly protocolFeeVault: PublicKey
  readonly endTs: bigint | null
  readonly maxOutputSupply: bigint
  readonly metadataName: string
  readonly metadataSymbol: string
  readonly metadataUri: string
  readonly metadataAccount: PublicKey
  readonly lifecycleIntent: RedaxCampaignLifecycleIntent
  readonly tokenConfigs: readonly RedaxResolvedTokenConfigPlanV1[]
}

// --- Validation issues -------------------------------------------------------

export type RedaxCampaignPlanIssueCode =
  | 'INVALID_PUBLIC_KEY'
  | 'INVALID_SALT_HEX'
  | 'TOPOLOGY_1_ROLES_MUST_MATCH'
  | 'REQUIRED'
  | 'NOT_DECIMAL_INTEGER'
  | 'NEGATIVE_NOT_ALLOWED'
  | 'ABOVE_U128_MAX'
  | 'OUT_OF_I64_RANGE'
  | 'END_TS_NOT_POSITIVE'
  | 'RATE_HALF_ZERO'
  | 'METADATA_BYTES_OUT_OF_BOUNDS'
  | 'INVALID_DECIMALS'
  | 'LEGACY_MINT_EQUALS_OUTPUT_MINT'
  | 'DUPLICATE_LEGACY_MINT'
  | 'DUPLICATE_TOKEN_CONFIG_PDA'
  | 'DUPLICATE_ROW_ID'
  | 'TOO_MANY_TOKEN_CONFIGS'
  | 'ACTIVATION_REQUIRES_TOKEN_CONFIG'

/** One validation problem. Value-free: no raw team input is echoed back. */
export interface RedaxCampaignPlanIssue {
  readonly code: RedaxCampaignPlanIssueCode
  readonly field: string
  readonly rowId: string | null
  readonly message: string
}

export type RedaxFreezeCampaignPlanResult =
  | { ok: true; plan: RedaxFrozenCampaignPlanV1 }
  | { ok: false; issues: readonly RedaxCampaignPlanIssue[] }

function issue(
  code: RedaxCampaignPlanIssueCode,
  field: string,
  message: string,
  rowId: string | null = null,
): RedaxCampaignPlanIssue {
  return { code, field, rowId, message }
}

// --- Strict parsing helpers --------------------------------------------------

/** UTF-8 byte length — what the program's `String::len()` bound actually counts. */
export function redaxUtf8ByteLength(value: string): number {
  return TEXT_ENCODER.encode(value).length
}

/**
 * Parse an unsigned decimal integer. Decimal digits only: a sign, a decimal
 * point, an exponent, a 0x/0b prefix and separators are all rejected, and the
 * empty entry is distinguished from a parsed zero (`0` is the uncapped sentinel).
 */
export function parseRedaxUnsignedInteger(
  raw: string,
): { kind: 'empty' } | { kind: 'invalid' } | { kind: 'negative' } | { kind: 'ok'; value: bigint } {
  const trimmed = raw.trim()
  if (trimmed === '') {
    return { kind: 'empty' }
  }
  if (trimmed.startsWith('-')) {
    return { kind: 'negative' }
  }
  if (!DECIMAL_DIGITS.test(trimmed)) {
    return { kind: 'invalid' }
  }
  return { kind: 'ok', value: BigInt(trimmed) }
}

/** Parse a signed decimal integer (the i64 campaign deadline). */
export function parseRedaxSignedInteger(
  raw: string,
): { kind: 'empty' } | { kind: 'invalid' } | { kind: 'ok'; value: bigint } {
  const trimmed = raw.trim()
  if (trimmed === '') {
    return { kind: 'empty' }
  }
  if (!SIGNED_DECIMAL.test(trimmed) || trimmed === '-') {
    return { kind: 'invalid' }
  }
  return { kind: 'ok', value: BigInt(trimmed) }
}

/** 32 salt bytes -> the canonical 64 lowercase hex characters. */
export function redaxSaltHexFromBytes(salt: Uint8Array): string {
  if (salt.length !== REDAX_CAMPAIGN_SALT_BYTES) {
    throw new RangeError('campaign salt must be exactly 32 bytes')
  }
  let hex = ''
  for (const byte of salt) {
    hex += byte.toString(16).padStart(2, '0')
  }
  return hex
}

/** Canonical 64 lowercase hex characters -> the 32 salt bytes. */
export function redaxSaltBytesFromHex(saltHex: string): Uint8Array {
  if (!LOWERCASE_HEX_64.test(saltHex)) {
    throw new RangeError('campaign salt must be exactly 64 lowercase hex characters')
  }
  const bytes = new Uint8Array(REDAX_CAMPAIGN_SALT_BYTES)
  for (let i = 0; i < REDAX_CAMPAIGN_SALT_BYTES; i += 1) {
    bytes[i] = Number.parseInt(saltHex.slice(i * 2, i * 2 + 2), 16)
  }
  return bytes
}

function parsePublicKey(value: string): PublicKey | null {
  const trimmed = value.trim()
  if (trimmed === '') {
    return null
  }
  try {
    return new PublicKey(trimmed)
  } catch {
    return null
  }
}

// --- Ordered TokenConfig reducer (draft only) --------------------------------

export type RedaxTokenConfigDraftAction =
  | { kind: 'add'; row: RedaxTokenConfigDraftRowV1 }
  | { kind: 'edit'; rowId: string; patch: Partial<Omit<RedaxTokenConfigDraftRowV1, 'rowId'>> }
  | { kind: 'remove'; rowId: string }
  | { kind: 'reorder'; rowId: string; toIndex: number }

export type RedaxTokenConfigReducerErrorCode =
  | 'TOO_MANY_TOKEN_CONFIGS'
  | 'DUPLICATE_ROW_ID'
  | 'ROW_NOT_FOUND'
  | 'INDEX_OUT_OF_RANGE'

export type RedaxTokenConfigReducerResult =
  | { ok: true; rows: readonly RedaxTokenConfigDraftRowV1[] }
  | { ok: false; code: RedaxTokenConfigReducerErrorCode }

/**
 * Ordered, deterministic, pure reducer over DRAFT rows.
 *
 * Only draft rows are reducible. A frozen plan is deeply frozen and can never be
 * reordered or mutated — there is no reducer path that accepts one, and
 * `Object.freeze` makes an attempted write throw in strict mode.
 *
 * Ordering is product/display/execution ordering only: each `add_token_config` is
 * an independent instruction and the on-chain TokenConfig PDA is seeded by
 * (campaign, legacy_mint), so row order carries no protocol meaning.
 */
export function reduceRedaxTokenConfigDraftRows(
  rows: readonly RedaxTokenConfigDraftRowV1[],
  action: RedaxTokenConfigDraftAction,
): RedaxTokenConfigReducerResult {
  switch (action.kind) {
    case 'add': {
      if (rows.length >= REDAX_MAX_TOKEN_CONFIGS_PER_CAMPAIGN) {
        // The eleventh row is refused here, not silently dropped on-chain (6031).
        return { ok: false, code: 'TOO_MANY_TOKEN_CONFIGS' }
      }
      if (rows.some((row) => row.rowId === action.row.rowId)) {
        return { ok: false, code: 'DUPLICATE_ROW_ID' }
      }
      return { ok: true, rows: [...rows, action.row] }
    }
    case 'edit': {
      const index = rows.findIndex((row) => row.rowId === action.rowId)
      if (index < 0) {
        return { ok: false, code: 'ROW_NOT_FOUND' }
      }
      const current = rows[index]
      // rowId is intentionally not patchable: identity is stable across an edit,
      // even one that moves the derived TokenConfig PDA by changing the legacy mint.
      const next: RedaxTokenConfigDraftRowV1 = { ...current, ...action.patch, rowId: current.rowId }
      const copy = [...rows]
      copy[index] = next
      return { ok: true, rows: copy }
    }
    case 'remove': {
      const index = rows.findIndex((row) => row.rowId === action.rowId)
      if (index < 0) {
        return { ok: false, code: 'ROW_NOT_FOUND' }
      }
      return { ok: true, rows: rows.filter((row) => row.rowId !== action.rowId) }
    }
    case 'reorder': {
      const index = rows.findIndex((row) => row.rowId === action.rowId)
      if (index < 0) {
        return { ok: false, code: 'ROW_NOT_FOUND' }
      }
      if (
        !Number.isInteger(action.toIndex) ||
        action.toIndex < 0 ||
        action.toIndex >= rows.length
      ) {
        return { ok: false, code: 'INDEX_OUT_OF_RANGE' }
      }
      const copy = [...rows]
      const [moved] = copy.splice(index, 1)
      copy.splice(action.toIndex, 0, moved)
      return { ok: true, rows: copy }
    }
  }
}

// --- Freeze context ----------------------------------------------------------

/**
 * The public, non-team-entered values a draft needs before it can be frozen.
 *
 * `outputMintPublicKey` is the PUBLIC key of a freshly generated mint keypair and
 * `saltHex` is a freshly generated 32-byte salt — both produced OUTSIDE this
 * module by a later private action context. The mint's SECRET key is never passed
 * here, never stored here, and never appears in the frozen plan.
 *
 * `protocolFeeAuthority` must come from a FRESH on-chain ProtocolConfig read. It
 * is never typed by a team, and the fee vault is derived from it — so there is no
 * parameter anywhere in this layer by which a team could name a fee destination.
 */
export interface RedaxCampaignPlanFreezeContextV1 {
  readonly programId: string
  readonly saltHex: string
  readonly outputMintPublicKey: string
  readonly protocolFeeAuthority: string
}

// --- Freeze (validate + derive + deep-freeze) --------------------------------

function deepFreezePlan(plan: RedaxFrozenCampaignPlanV1): RedaxFrozenCampaignPlanV1 {
  for (const row of plan.tokenConfigs) {
    Object.freeze(row)
  }
  Object.freeze(plan.tokenConfigs)
  return Object.freeze(plan)
}

function validateMetadataText(
  value: string,
  maxBytes: number,
  field: string,
  issues: RedaxCampaignPlanIssue[],
): void {
  if (value.trim() === '') {
    issues.push(issue('REQUIRED', field, `${field} is required and cannot be empty.`))
    return
  }
  const bytes = redaxUtf8ByteLength(value)
  if (bytes < 1 || bytes > maxBytes) {
    issues.push(
      issue(
        'METADATA_BYTES_OUT_OF_BOUNDS',
        field,
        `${field} must be 1..${maxBytes} UTF-8 bytes.`,
      ),
    )
  }
}

function validateUnsignedU128(
  raw: string,
  field: string,
  issues: RedaxCampaignPlanIssue[],
  rowId: string | null,
  options: { readonly nonZero: boolean },
): bigint | null {
  const parsed = parseRedaxUnsignedInteger(raw)
  if (parsed.kind === 'empty') {
    issues.push(issue('REQUIRED', field, `${field} is required (enter 0 for uncapped).`, rowId))
    return null
  }
  if (parsed.kind === 'negative') {
    issues.push(issue('NEGATIVE_NOT_ALLOWED', field, `${field} cannot be negative.`, rowId))
    return null
  }
  if (parsed.kind === 'invalid') {
    issues.push(
      issue(
        'NOT_DECIMAL_INTEGER',
        field,
        `${field} must be base units — decimal digits only, with no decimal point, sign, exponent or 0x prefix.`,
        rowId,
      ),
    )
    return null
  }
  if (parsed.value > REDAX_U128_MAX) {
    issues.push(issue('ABOVE_U128_MAX', field, `${field} is above the u128 maximum.`, rowId))
    return null
  }
  if (options.nonZero && parsed.value === 0n) {
    issues.push(
      issue('RATE_HALF_ZERO', field, `${field} must be non-zero — a zero rate half is invalid.`, rowId),
    )
    return null
  }
  return parsed.value
}

/**
 * Validate a draft against a freeze context and, if it is wholly valid, derive
 * every public account identity and return the deeply frozen canonical plan.
 *
 * Every issue is collected — validation never short-circuits on the first one —
 * so a team sees the complete set at once. Pure: no RPC, no clock, no entropy.
 */
export function freezeRedaxCampaignPlan(
  draft: RedaxTeamAdminCampaignDraftV1,
  context: RedaxCampaignPlanFreezeContextV1,
): RedaxFreezeCampaignPlanResult {
  const issues: RedaxCampaignPlanIssue[] = []

  // --- Context keys ---------------------------------------------------------
  const programId = parsePublicKey(context.programId)
  if (programId === null) {
    issues.push(issue('INVALID_PUBLIC_KEY', 'programId', 'The program id is not a valid base58 public key.'))
  }
  const outputMint = parsePublicKey(context.outputMintPublicKey)
  if (outputMint === null) {
    issues.push(
      issue('INVALID_PUBLIC_KEY', 'outputMint', 'The output mint is not a valid base58 public key.'),
    )
  }
  const protocolFeeAuthority = parsePublicKey(context.protocolFeeAuthority)
  if (protocolFeeAuthority === null) {
    issues.push(
      issue(
        'INVALID_PUBLIC_KEY',
        'protocolFeeAuthority',
        'The protocol fee authority is not a valid base58 public key.',
      ),
    )
  }
  if (!LOWERCASE_HEX_64.test(context.saltHex)) {
    issues.push(
      issue('INVALID_SALT_HEX', 'saltHex', 'The campaign salt must be exactly 64 lowercase hex characters.'),
    )
  }

  // --- Signer roles ---------------------------------------------------------
  const payer = parsePublicKey(draft.payer)
  if (payer === null) {
    issues.push(issue('INVALID_PUBLIC_KEY', 'payer', 'The payer is not a valid base58 public key.'))
  }
  const outputGovernance = parsePublicKey(draft.outputGovernance)
  if (outputGovernance === null) {
    issues.push(
      issue('INVALID_PUBLIC_KEY', 'outputGovernance', 'The output governance is not a valid base58 public key.'),
    )
  }
  const campaignAdmin = parsePublicKey(draft.campaignAdmin)
  if (campaignAdmin === null) {
    issues.push(
      issue('INVALID_PUBLIC_KEY', 'campaignAdmin', 'The campaign admin is not a valid base58 public key.'),
    )
  }

  if (
    payer !== null &&
    outputGovernance !== null &&
    campaignAdmin !== null &&
    (!payer.equals(outputGovernance) || !payer.equals(campaignAdmin))
  ) {
    issues.push(
      issue(
        'TOPOLOGY_1_ROLES_MUST_MATCH',
        'signerTopology',
        'The initial setup supports one wallet only: payer, output governance and campaign admin must be the same key.',
      ),
    )
  }

  // --- Campaign-level values ------------------------------------------------
  const maxOutputSupply = validateUnsignedU128(draft.maxOutputSupply, 'maxOutputSupply', issues, null, {
    nonZero: false,
  })

  let endTs: bigint | null = null
  const endTsParsed = parseRedaxSignedInteger(draft.endTs)
  if (endTsParsed.kind === 'invalid') {
    issues.push(
      issue('NOT_DECIMAL_INTEGER', 'endTs', 'The deadline must be Unix seconds — decimal digits only.'),
    )
  } else if (endTsParsed.kind === 'ok') {
    if (endTsParsed.value < REDAX_I64_MIN || endTsParsed.value > REDAX_I64_MAX) {
      issues.push(issue('OUT_OF_I64_RANGE', 'endTs', 'The deadline is outside the i64 range.'))
    } else if (endTsParsed.value <= 0n) {
      // The program requires `end_ts > now` strictly (6033); a non-positive Unix
      // second can never be in the future, so it is rejected here rather than
      // failing on-chain.
      issues.push(issue('END_TS_NOT_POSITIVE', 'endTs', 'The deadline must be a positive Unix timestamp.'))
    } else {
      endTs = endTsParsed.value
    }
  }

  validateMetadataText(draft.metadataName, REDAX_MAX_METADATA_NAME_BYTES, 'metadataName', issues)
  validateMetadataText(draft.metadataSymbol, REDAX_MAX_METADATA_SYMBOL_BYTES, 'metadataSymbol', issues)
  validateMetadataText(draft.metadataUri, REDAX_MAX_METADATA_URI_BYTES, 'metadataUri', issues)

  // --- TokenConfig rows -----------------------------------------------------
  if (draft.tokenConfigs.length > REDAX_MAX_TOKEN_CONFIGS_PER_CAMPAIGN) {
    issues.push(
      issue(
        'TOO_MANY_TOKEN_CONFIGS',
        'tokenConfigs',
        `A campaign accepts at most ${REDAX_MAX_TOKEN_CONFIGS_PER_CAMPAIGN} TokenConfigs.`,
      ),
    )
  }
  if (draft.lifecycleIntent === 'activate_after_setup' && draft.tokenConfigs.length < 1) {
    issues.push(
      issue(
        'ACTIVATION_REQUIRES_TOKEN_CONFIG',
        'tokenConfigs',
        'Activating a campaign requires at least one TokenConfig.',
      ),
    )
  }

  const seenRowIds = new Set<string>()
  const seenLegacyMints = new Set<string>()
  const resolvedRows: {
    row: RedaxTokenConfigDraftRowV1
    legacyMint: PublicKey
    expectedLegacyDecimals: number
    rateNumerator: bigint
    rateDenominator: bigint
    maxOutputFromTokenConfig: bigint
  }[] = []

  for (const row of draft.tokenConfigs) {
    if (seenRowIds.has(row.rowId)) {
      issues.push(issue('DUPLICATE_ROW_ID', 'rowId', 'Two rows share the same local row id.', row.rowId))
    }
    seenRowIds.add(row.rowId)

    const legacyMint = parsePublicKey(row.legacyMint)
    if (legacyMint === null) {
      issues.push(
        issue('INVALID_PUBLIC_KEY', 'legacyMint', 'The legacy mint is not a valid base58 public key.', row.rowId),
      )
    } else {
      const key = legacyMint.toBase58()
      if (seenLegacyMints.has(key)) {
        // A duplicate legacy mint is a duplicate TokenConfig PDA, not a second row:
        // the PDA is seeded by (campaign, legacy_mint).
        issues.push(
          issue(
            'DUPLICATE_LEGACY_MINT',
            'legacyMint',
            'This legacy mint is already registered on another row.',
            row.rowId,
          ),
        )
      }
      seenLegacyMints.add(key)
      if (outputMint !== null && legacyMint.equals(outputMint)) {
        issues.push(
          issue(
            'LEGACY_MINT_EQUALS_OUTPUT_MINT',
            'legacyMint',
            'The legacy mint cannot be the output mint.',
            row.rowId,
          ),
        )
      }
    }

    const decimalsParsed = parseRedaxUnsignedInteger(row.expectedLegacyDecimals)
    let expectedLegacyDecimals: number | null = null
    if (decimalsParsed.kind === 'ok' && decimalsParsed.value >= 0n && decimalsParsed.value <= 255n) {
      expectedLegacyDecimals = Number(decimalsParsed.value)
    } else {
      issues.push(
        issue(
          'INVALID_DECIMALS',
          'expectedLegacyDecimals',
          'The expected legacy decimals must be a whole number in 0..255.',
          row.rowId,
        ),
      )
    }

    const rateNumerator = validateUnsignedU128(row.rateNumerator, 'rateNumerator', issues, row.rowId, {
      nonZero: true,
    })
    const rateDenominator = validateUnsignedU128(
      row.rateDenominator,
      'rateDenominator',
      issues,
      row.rowId,
      { nonZero: true },
    )
    const maxOutputFromTokenConfig = validateUnsignedU128(
      row.maxOutputFromTokenConfig,
      'maxOutputFromTokenConfig',
      issues,
      row.rowId,
      { nonZero: false },
    )

    if (
      legacyMint !== null &&
      expectedLegacyDecimals !== null &&
      rateNumerator !== null &&
      rateDenominator !== null &&
      maxOutputFromTokenConfig !== null
    ) {
      resolvedRows.push({
        row,
        legacyMint,
        expectedLegacyDecimals,
        rateNumerator,
        rateDenominator,
        maxOutputFromTokenConfig,
      })
    }
  }

  if (issues.length > 0) {
    return { ok: false, issues }
  }

  // Every branch above pushed an issue on failure, so the survivors are non-null.
  const resolvedProgramId = programId as PublicKey
  const resolvedOutputMint = outputMint as PublicKey
  const resolvedFeeAuthority = protocolFeeAuthority as PublicKey
  const resolvedPayer = payer as PublicKey
  const resolvedGovernance = outputGovernance as PublicKey
  const resolvedAdmin = campaignAdmin as PublicKey

  const salt = redaxSaltBytesFromHex(context.saltHex)
  const { pda: campaign, bump: campaignBump } = deriveCampaignPda(
    resolvedProgramId,
    resolvedGovernance,
    salt,
  )
  const { pda: protocolConfig } = deriveProtocolConfigPda(resolvedProgramId)
  const protocolFeeVault = deriveProtocolFeeVaultAta(resolvedFeeAuthority, resolvedOutputMint)
  const { pda: metadataAccount } = deriveOutputTokenMetadataPda(resolvedOutputMint)

  const tokenConfigs: RedaxFrozenTokenConfigPlanV1[] = []
  const seenTokenConfigPdas = new Set<string>()
  for (const entry of resolvedRows) {
    const { pda: tokenConfig, bump: tokenConfigBump } = deriveTokenConfigPda(
      resolvedProgramId,
      campaign,
      entry.legacyMint,
    )
    const tokenConfigKey = tokenConfig.toBase58()
    if (seenTokenConfigPdas.has(tokenConfigKey)) {
      // Defence in depth: a duplicate legacy mint is already refused above, and a
      // PDA collision is otherwise unreachable — but a duplicate PDA would mean a
      // second `add_token_config` for an existing account, so it is refused here too.
      issues.push(
        issue(
          'DUPLICATE_TOKEN_CONFIG_PDA',
          'tokenConfig',
          'Two rows derive the same TokenConfig address.',
          entry.row.rowId,
        ),
      )
      continue
    }
    seenTokenConfigPdas.add(tokenConfigKey)
    tokenConfigs.push({
      rowId: entry.row.rowId,
      legacyMint: entry.legacyMint.toBase58(),
      expectedLegacyDecimals: entry.expectedLegacyDecimals,
      expectedOutputDecimals: REDAX_OUTPUT_MINT_DECIMALS,
      rateNumerator: entry.rateNumerator.toString(10),
      rateDenominator: entry.rateDenominator.toString(10),
      maxOutputFromTokenConfig: entry.maxOutputFromTokenConfig.toString(10),
      tokenConfig: tokenConfigKey,
      tokenConfigBump,
    })
  }

  if (issues.length > 0) {
    return { ok: false, issues }
  }

  const plan: RedaxFrozenCampaignPlanV1 = {
    version: 1,
    cluster: 'devnet',
    programId: resolvedProgramId.toBase58(),
    payer: resolvedPayer.toBase58(),
    outputGovernance: resolvedGovernance.toBase58(),
    campaignAdmin: resolvedAdmin.toBase58(),
    saltHex: context.saltHex,
    campaign: campaign.toBase58(),
    campaignBump,
    protocolConfig: protocolConfig.toBase58(),
    outputMint: resolvedOutputMint.toBase58(),
    outputMintDecimals: REDAX_OUTPUT_MINT_DECIMALS,
    outputMintInitialSupply: REDAX_OUTPUT_MINT_INITIAL_SUPPLY,
    // The output mint's authority IS the Campaign PDA — the program checks exactly this.
    outputMintAuthority: campaign.toBase58(),
    outputMintFreezeAuthority: null,
    protocolFeeAuthority: resolvedFeeAuthority.toBase58(),
    protocolFeeVault: protocolFeeVault.toBase58(),
    endTs: endTs === null ? null : endTs.toString(10),
    maxOutputSupply: (maxOutputSupply as bigint).toString(10),
    metadataName: draft.metadataName,
    metadataSymbol: draft.metadataSymbol,
    metadataUri: draft.metadataUri,
    metadataAccount: metadataAccount.toBase58(),
    lifecycleIntent: draft.lifecycleIntent,
    tokenConfigs,
  }

  return { ok: true, plan: deepFreezePlan(plan) }
}

// --- Resolve (frozen -> PublicKey / bigint) ----------------------------------

/** Resolve a frozen public plan into PublicKey / bigint for the builders. Pure. */
export function resolveRedaxCampaignPlan(
  plan: RedaxFrozenCampaignPlanV1,
): RedaxResolvedCampaignPlanV1 {
  return {
    programId: new PublicKey(plan.programId),
    payer: new PublicKey(plan.payer),
    outputGovernance: new PublicKey(plan.outputGovernance),
    campaignAdmin: new PublicKey(plan.campaignAdmin),
    salt: redaxSaltBytesFromHex(plan.saltHex),
    campaign: new PublicKey(plan.campaign),
    campaignBump: plan.campaignBump,
    protocolConfig: new PublicKey(plan.protocolConfig),
    outputMint: new PublicKey(plan.outputMint),
    outputMintDecimals: REDAX_OUTPUT_MINT_DECIMALS,
    protocolFeeAuthority: new PublicKey(plan.protocolFeeAuthority),
    protocolFeeVault: new PublicKey(plan.protocolFeeVault),
    endTs: plan.endTs === null ? null : BigInt(plan.endTs),
    maxOutputSupply: BigInt(plan.maxOutputSupply),
    metadataName: plan.metadataName,
    metadataSymbol: plan.metadataSymbol,
    metadataUri: plan.metadataUri,
    metadataAccount: new PublicKey(plan.metadataAccount),
    lifecycleIntent: plan.lifecycleIntent,
    tokenConfigs: plan.tokenConfigs.map((row) => ({
      rowId: row.rowId,
      legacyMint: new PublicKey(row.legacyMint),
      expectedLegacyDecimals: row.expectedLegacyDecimals,
      rateNumerator: BigInt(row.rateNumerator),
      rateDenominator: BigInt(row.rateDenominator),
      maxOutputFromTokenConfig: BigInt(row.maxOutputFromTokenConfig),
      tokenConfig: new PublicKey(row.tokenConfig),
      tokenConfigBump: row.tokenConfigBump,
    })),
  }
}

// --- Canonical serialization + SHA-256 fingerprint ---------------------------

/** The fingerprint's domain-separation prefix. Version-pinned on purpose. */
export const REDAX_CAMPAIGN_PLAN_FINGERPRINT_PREFIX = 'redax-team-admin-plan-v1'

/**
 * Deterministic canonical serialization of a frozen public plan.
 *
 * Fixed key order, fixed array order, one field per line, UTF-8. Every integer is
 * already a canonical decimal string (no JSON BigInt problem). Free-text values
 * are emitted through `JSON.stringify`, which escapes newlines and quotes
 * deterministically — so a metadata name containing a newline cannot forge a field
 * boundary. Nothing here depends on the locale, the clock, or any environment
 * formatting.
 */
export function canonicalRedaxCampaignPlanString(plan: RedaxFrozenCampaignPlanV1): string {
  const lines: string[] = [
    REDAX_CAMPAIGN_PLAN_FINGERPRINT_PREFIX,
    `version=${plan.version}`,
    `cluster=${plan.cluster}`,
    `programId=${plan.programId}`,
    `payer=${plan.payer}`,
    `outputGovernance=${plan.outputGovernance}`,
    `campaignAdmin=${plan.campaignAdmin}`,
    `saltHex=${plan.saltHex}`,
    `campaign=${plan.campaign}`,
    `campaignBump=${plan.campaignBump}`,
    `protocolConfig=${plan.protocolConfig}`,
    `outputMint=${plan.outputMint}`,
    `outputMintDecimals=${plan.outputMintDecimals}`,
    `outputMintInitialSupply=${plan.outputMintInitialSupply}`,
    `outputMintAuthority=${plan.outputMintAuthority}`,
    `outputMintFreezeAuthority=null`,
    `protocolFeeAuthority=${plan.protocolFeeAuthority}`,
    `protocolFeeVault=${plan.protocolFeeVault}`,
    `endTs=${plan.endTs === null ? 'null' : plan.endTs}`,
    `maxOutputSupply=${plan.maxOutputSupply}`,
    `metadataName=${JSON.stringify(plan.metadataName)}`,
    `metadataSymbol=${JSON.stringify(plan.metadataSymbol)}`,
    `metadataUri=${JSON.stringify(plan.metadataUri)}`,
    `metadataAccount=${plan.metadataAccount}`,
    `lifecycleIntent=${plan.lifecycleIntent}`,
    `tokenConfigCount=${plan.tokenConfigs.length}`,
  ]
  plan.tokenConfigs.forEach((row, index) => {
    lines.push(
      `tokenConfig[${index}].rowId=${JSON.stringify(row.rowId)}`,
      `tokenConfig[${index}].legacyMint=${row.legacyMint}`,
      `tokenConfig[${index}].expectedLegacyDecimals=${row.expectedLegacyDecimals}`,
      `tokenConfig[${index}].expectedOutputDecimals=${row.expectedOutputDecimals}`,
      `tokenConfig[${index}].rateNumerator=${row.rateNumerator}`,
      `tokenConfig[${index}].rateDenominator=${row.rateDenominator}`,
      `tokenConfig[${index}].maxOutputFromTokenConfig=${row.maxOutputFromTokenConfig}`,
      `tokenConfig[${index}].tokenConfig=${row.tokenConfig}`,
      `tokenConfig[${index}].tokenConfigBump=${row.tokenConfigBump}`,
    )
  })
  return `${lines.join('\n')}\n`
}

/**
 * Minimal structural view of the Web Crypto digest surface. Typed structurally so
 * this module compiles identically under the app's DOM lib and under the test
 * runner's Node types, without importing either.
 */
interface RedaxSubtleDigest {
  readonly subtle: {
    digest(algorithm: string, data: Uint8Array): Promise<ArrayBuffer>
  }
}

function requireWebCrypto(): RedaxSubtleDigest {
  const candidate = (globalThis as { crypto?: unknown }).crypto
  if (
    typeof candidate !== 'object' ||
    candidate === null ||
    typeof (candidate as RedaxSubtleDigest).subtle !== 'object' ||
    typeof (candidate as RedaxSubtleDigest).subtle?.digest !== 'function'
  ) {
    throw new Error('REDAX_WEB_CRYPTO_UNAVAILABLE')
  }
  return candidate as RedaxSubtleDigest
}

function toHex(bytes: Uint8Array): string {
  let hex = ''
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, '0')
  }
  return hex
}

/**
 * SHA-256 of a UTF-8 string, lowercase hex. Async because Web Crypto's digest is
 * async; still pure (no I/O, no entropy, no clock) and deterministic. Uses only
 * the platform's Web Crypto — no dependency is added.
 */
export async function redaxSha256HexUtf8(text: string): Promise<string> {
  const digest = await requireWebCrypto().subtle.digest('SHA-256', TEXT_ENCODER.encode(text))
  return toHex(new Uint8Array(digest))
}

/**
 * The plan fingerprint: `redax-team-admin-plan-v1:<64 lowercase hex>` over the
 * canonical UTF-8 serialization of the frozen public plan.
 *
 * It is a deterministic PLAN / RECOVERY IDENTITY and a MUTATION DETECTOR: the same
 * plan always fingerprints the same, and any change to any field changes it. It is
 * NOT an authorization, NOT a signature, NOT a commitment, and NOT a security
 * credential — it authorizes nothing and proves nothing about who produced it.
 */
export async function computeRedaxCampaignPlanFingerprint(
  plan: RedaxFrozenCampaignPlanV1,
): Promise<string> {
  const hex = await redaxSha256HexUtf8(canonicalRedaxCampaignPlanString(plan))
  return `${REDAX_CAMPAIGN_PLAN_FINGERPRINT_PREFIX}:${hex}`
}
