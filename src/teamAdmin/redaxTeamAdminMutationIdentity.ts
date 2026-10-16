// -----------------------------------------------------------------------------
// WHAT THIS FILE IS
// -----------------------------------------------------------------------------
// The ONE definition of WHICH MUTATION a Team/Admin post-init attempt is about. It is
// PURE: no `Connection`, no RPC, no wallet, no storage, no `Transaction`, no React and
// no environment read. It computes one canonical string and one digest, and it does
// nothing else.
//
// -----------------------------------------------------------------------------
// IDENTITY IS NOT THE MESSAGE COMMITMENT, AND MUST NOT BE ABLE TO BECOME ONE
// -----------------------------------------------------------------------------
// The intended-message SHA is ATTEMPT-SPECIFIC: the blockhash is part of the compiled
// message, so the same mutation compiled twice produces two different messages. Mutation
// identity is the opposite — it must be STABLE across attempts, because its whole job is
// to say "this is the same mutation you already have an unresolved record for".
//
// So the attempt-level facts are not merely omitted here, they are UNREPRESENTABLE:
// there is no field, no optional member and no extension point for a `blockhash`, a
// `lastValidBlockHeight`, a `preflightContextSlot`, a `transactionSlot`, a `signature`,
// an `attemptNonce` or an intended-message digest. A type that could carry one would
// eventually be handed one, and an identity that moved every attempt would silently
// disable the single-slot rule it exists to serve.
//
// DERIVED PDAs ARE WITNESSES, NOT DIMENSIONS. The TokenConfig PDA and the canonical
// metadata PDA are FUNCTIONS of the fields below — deriving them adds no information and
// carrying them here would let a caller supply a PDA that disagrees with the seeds beside
// it. They are recorded and re-derived elsewhere, as witnesses, and compared.
//
// -----------------------------------------------------------------------------
// WHY A FIXED-ORDER LINE ENCODING AND NOT JSON
// -----------------------------------------------------------------------------
// JSON has no canonical form. Key order, whitespace, escaping and number spelling are
// all implementation choices, and two serializers that "agree" today are free to differ
// tomorrow — at which point the same mutation would hash to two different identities and
// the unresolved-slot rule would stop matching. The encoding below is a FIXED SEQUENCE
// of `field=value` lines separated by `\n`, with every value already a canonical string,
// so there is exactly one spelling of any given identity and it is written out here.
//
// EVERY INTEGER IS A CANONICAL UNSIGNED DECIMAL STRING. A `bigint` is converted exactly
// ONCE, at the boundary; a string must ALREADY be canonical. Leading zeros, a sign, a
// separator, an exponent, hex and whitespace are all refused rather than normalized,
// because normalizing them would mean two spellings of one number could reach two
// different identities depending on which path the caller took.

// --- Fixed vocabulary --------------------------------------------------------

/** The identity scheme this module implements, spelled once. */
export const REDAX_TEAM_ADMIN_POST_INIT_MUTATION_IDENTITY_VERSION =
  'TEAM_ADMIN_POST_INIT_MUTATION_IDENTITY_V1' as const

/** The only cluster Phase 1 mutates. */
export const REDAX_TEAM_ADMIN_MUTATION_CLUSTER = 'devnet' as const

/** Digits only: no sign, no exponent, no separator, no leading zero except `0` itself. */
const CANONICAL_UNSIGNED_DECIMAL_PATTERN = /^(?:0|[1-9][0-9]*)$/

/** A public base58-looking account identifier. Never decoded here, never trusted further. */
const BASE58_ACCOUNT_PATTERN = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/

/** Exactly 64 lowercase hexadecimal characters. */
const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/

/** The widest value the program's `u128` arguments can carry. */
const U128_MAX = BigInt('340282366920938463463374607431768211455')

// --- Public vocabulary -------------------------------------------------------

/**
 * The complete, closed set of post-init mutations. There are SIX, and there is no
 * seventh.
 *
 * These are the union members, and they are also the exact `operation=` values in the
 * encoding — one spelling, used for both, so a reader of a canonical string and a reader
 * of the type are looking at the same vocabulary.
 */
export type RedaxTeamAdminMutationOperation =
  | 'ADD_TOKEN_CONFIG'
  | 'SETUP_METADATA'
  | 'ACTIVATE_CAMPAIGN'
  | 'PAUSE_CAMPAIGN'
  | 'UNPAUSE_CAMPAIGN'
  | 'FINALIZE_CAMPAIGN'

/**
 * The program's four campaign statuses, RE-DECLARED rather than imported.
 *
 * Structurally identical to the data adapter's `CampaignStatusName` and deliberately not
 * an import: this module acquires nothing, so it can be reasoned about — and tested —
 * without the devnet adapter, the IDL coder or `@solana/web3.js` existing at all. A drift
 * between the two spellings is caught by the structural tests, which read both.
 */
export type RedaxTeamAdminMutationCampaignStatus =
  | 'initialized'
  | 'active'
  | 'paused'
  | 'finalized'

/** The one authority role a browser-product pause may ever claim. */
export type RedaxTeamAdminMutationAuthorityRole = 'campaign_admin'

/** An unsigned integer argument, as the caller has it. Converted exactly once. */
export type RedaxTeamAdminMutationUnsigned = bigint | string

/**
 * The identity dimensions every mutation shares.
 *
 * `cluster` is fixed rather than free: Phase 1 mutates exactly one cluster, and a
 * configurable one would let a devnet record and a mainnet record collide.
 */
export interface RedaxTeamAdminMutationCommonIdentity {
  readonly programId: string
  readonly teamWallet: string
  readonly campaign: string
}

/**
 * The operation-specific dimensions, discriminated.
 *
 * `SETUP_METADATA` carries the CANONICAL COMMITMENTS rather than the strings themselves.
 * The bytes are what the program stores and what identity must be about, the digests are
 * fixed-width and value-free, and an identity that embedded raw user text would put
 * unreviewed strings into a value that is hashed, compared and persisted.
 */
export type RedaxTeamAdminMutationOperationIdentity =
  | {
      readonly operation: 'ADD_TOKEN_CONFIG'
      readonly legacyMint: string
      readonly rateNumerator: RedaxTeamAdminMutationUnsigned
      readonly rateDenominator: RedaxTeamAdminMutationUnsigned
      readonly maxOutputFromTokenConfig: RedaxTeamAdminMutationUnsigned
    }
  | {
      readonly operation: 'SETUP_METADATA'
      readonly nameSha256Hex: string
      readonly nameByteLength: number
      readonly symbolSha256Hex: string
      readonly symbolByteLength: number
      readonly uriSha256Hex: string
      readonly uriByteLength: number
    }
  | {
      readonly operation: 'ACTIVATE_CAMPAIGN'
      readonly predecessorStatus: RedaxTeamAdminMutationCampaignStatus
      readonly targetStatus: RedaxTeamAdminMutationCampaignStatus
    }
  | {
      readonly operation: 'PAUSE_CAMPAIGN'
      readonly predecessorStatus: RedaxTeamAdminMutationCampaignStatus
      readonly targetStatus: RedaxTeamAdminMutationCampaignStatus
      readonly authorityRole: RedaxTeamAdminMutationAuthorityRole
    }
  | {
      readonly operation: 'UNPAUSE_CAMPAIGN'
      readonly predecessorStatus: RedaxTeamAdminMutationCampaignStatus
      readonly targetStatus: RedaxTeamAdminMutationCampaignStatus
    }
  | {
      readonly operation: 'FINALIZE_CAMPAIGN'
      readonly predecessorStatus: RedaxTeamAdminMutationCampaignStatus
      readonly targetStatus: RedaxTeamAdminMutationCampaignStatus
    }

/** One complete mutation identity request: the common dimensions plus the operation's. */
export type RedaxTeamAdminMutationIdentityRequest = RedaxTeamAdminMutationCommonIdentity &
  RedaxTeamAdminMutationOperationIdentity

/** A computed identity: the exact canonical text and its digest. */
export interface RedaxTeamAdminMutationIdentityV1 {
  readonly version: typeof REDAX_TEAM_ADMIN_POST_INIT_MUTATION_IDENTITY_VERSION
  readonly cluster: typeof REDAX_TEAM_ADMIN_MUTATION_CLUSTER
  readonly operation: RedaxTeamAdminMutationOperation
  /** The exact LF-separated `field=value` text the digest is taken over. */
  readonly canonicalText: string
  /** Lowercase SHA-256 hex of that text's UTF-8 bytes. */
  readonly sha256Hex: string
}

/** Every way identity computation declines. Value-free and closed. */
export type RedaxTeamAdminMutationIdentityRefusalCode = 'INPUT_INVALID' | 'IDENTITY_UNAVAILABLE'

export type RedaxTeamAdminMutationIdentityResult =
  | { readonly ok: true; readonly identity: RedaxTeamAdminMutationIdentityV1 }
  | { readonly ok: false; readonly code: RedaxTeamAdminMutationIdentityRefusalCode }

// --- Canonical value coercion --------------------------------------------------

/**
 * One unsigned integer, as its single canonical decimal spelling — or null.
 *
 * A `bigint` is converted exactly ONCE, here, and `BigInt.prototype.toString` has one
 * spelling per value by construction. A `string` is NOT converted: it must already be
 * canonical, and `"007"`, `"+7"`, `"7n"`, `"0x7"`, `"7e0"`, `"1_000"` and `" 7 "` are all
 * REFUSED rather than repaired — a normalizer here would mean two callers spelling the
 * same number differently could still reach the same identity through one path and a
 * different one through another.
 */
function canonicalUnsigned(value: unknown): string | null {
  if (typeof value === 'bigint') {
    if (value < 0n || value > U128_MAX) {
      return null
    }
    return value.toString()
  }
  if (typeof value !== 'string' || !CANONICAL_UNSIGNED_DECIMAL_PATTERN.test(value)) {
    return null
  }
  let parsed: bigint
  try {
    parsed = BigInt(value)
  } catch {
    return null
  }
  // Width is checked on the PARSED value, and the accepted spelling is the ORIGINAL
  // string — which the pattern already proved canonical, so the two cannot disagree.
  return parsed > U128_MAX ? null : value
}

/** A small non-negative count, as its canonical decimal spelling — or null. */
function canonicalCount(value: unknown): string | null {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    return null
  }
  return value.toString()
}

/** A public base58 account identifier, unchanged — or null. */
function canonicalAccount(value: unknown): string | null {
  return typeof value === 'string' && BASE58_ACCOUNT_PATTERN.test(value) ? value : null
}

/** A lowercase SHA-256 hex digest, unchanged — or null. Uppercase is refused, not folded. */
function canonicalDigest(value: unknown): string | null {
  return typeof value === 'string' && SHA256_HEX_PATTERN.test(value) ? value : null
}

const CAMPAIGN_STATUSES: readonly RedaxTeamAdminMutationCampaignStatus[] = Object.freeze([
  'initialized',
  'active',
  'paused',
  'finalized',
])

function canonicalStatus(value: unknown): RedaxTeamAdminMutationCampaignStatus | null {
  return typeof value === 'string' &&
    (CAMPAIGN_STATUSES as readonly string[]).includes(value)
    ? (value as RedaxTeamAdminMutationCampaignStatus)
    : null
}

// --- The canonical encoding ------------------------------------------------------

/**
 * Build the exact canonical text, in the exact fixed order — or null.
 *
 * The common six come FIRST, always, in the order the decision fixes:
 * `version`, `cluster`, `programId`, `teamWallet`, `campaign`, `operation`. The
 * operation's own fields follow, in their own fixed order. No field is optional, no
 * field is omitted when empty, and there is no trailing newline: an encoder that
 * sometimes emitted one and sometimes did not would be two encoders.
 */
function encodeCanonicalText(request: RedaxTeamAdminMutationIdentityRequest): string | null {
  const programId = canonicalAccount(request.programId)
  const teamWallet = canonicalAccount(request.teamWallet)
  const campaign = canonicalAccount(request.campaign)
  if (programId === null || teamWallet === null || campaign === null) {
    return null
  }

  const lines: string[] = [
    `version=${REDAX_TEAM_ADMIN_POST_INIT_MUTATION_IDENTITY_VERSION}`,
    `cluster=${REDAX_TEAM_ADMIN_MUTATION_CLUSTER}`,
    `programId=${programId}`,
    `teamWallet=${teamWallet}`,
    `campaign=${campaign}`,
    `operation=${request.operation}`,
  ]

  switch (request.operation) {
    case 'ADD_TOKEN_CONFIG': {
      const legacyMint = canonicalAccount(request.legacyMint)
      const rateNumerator = canonicalUnsigned(request.rateNumerator)
      const rateDenominator = canonicalUnsigned(request.rateDenominator)
      const maxOutput = canonicalUnsigned(request.maxOutputFromTokenConfig)
      if (
        legacyMint === null ||
        rateNumerator === null ||
        rateDenominator === null ||
        maxOutput === null
      ) {
        return null
      }
      lines.push(
        `legacyMint=${legacyMint}`,
        `rateNumerator=${rateNumerator}`,
        `rateDenominator=${rateDenominator}`,
        `maxOutputFromTokenConfig=${maxOutput}`,
      )
      break
    }
    case 'SETUP_METADATA': {
      const nameSha = canonicalDigest(request.nameSha256Hex)
      const nameLength = canonicalCount(request.nameByteLength)
      const symbolSha = canonicalDigest(request.symbolSha256Hex)
      const symbolLength = canonicalCount(request.symbolByteLength)
      const uriSha = canonicalDigest(request.uriSha256Hex)
      const uriLength = canonicalCount(request.uriByteLength)
      if (
        nameSha === null ||
        nameLength === null ||
        symbolSha === null ||
        symbolLength === null ||
        uriSha === null ||
        uriLength === null
      ) {
        return null
      }
      lines.push(
        `nameSha256Hex=${nameSha}`,
        `nameByteLength=${nameLength}`,
        `symbolSha256Hex=${symbolSha}`,
        `symbolByteLength=${symbolLength}`,
        `uriSha256Hex=${uriSha}`,
        `uriByteLength=${uriLength}`,
      )
      break
    }
    case 'PAUSE_CAMPAIGN': {
      const predecessor = canonicalStatus(request.predecessorStatus)
      const target = canonicalStatus(request.targetStatus)
      if (predecessor === null || target === null || request.authorityRole !== 'campaign_admin') {
        return null
      }
      lines.push(
        `predecessorStatus=${predecessor}`,
        `targetStatus=${target}`,
        `authorityRole=${request.authorityRole}`,
      )
      break
    }
    case 'ACTIVATE_CAMPAIGN':
    case 'UNPAUSE_CAMPAIGN':
    case 'FINALIZE_CAMPAIGN': {
      const predecessor = canonicalStatus(request.predecessorStatus)
      const target = canonicalStatus(request.targetStatus)
      if (predecessor === null || target === null) {
        return null
      }
      lines.push(`predecessorStatus=${predecessor}`, `targetStatus=${target}`)
      break
    }
    default:
      // An operation outside the closed six. Unreachable through the type, and refused
      // for callers the type system never saw.
      return null
  }

  return lines.join('\n')
}

// --- Platform digest, structurally -------------------------------------------------

interface RedaxMutationIdentitySubtle {
  readonly subtle: {
    digest(algorithm: string, data: Uint8Array): Promise<ArrayBuffer>
  }
}

function resolveSubtle(): RedaxMutationIdentitySubtle | null {
  const candidate = (globalThis as { crypto?: unknown }).crypto
  if (typeof candidate !== 'object' || candidate === null) {
    return null
  }
  const subtle = (candidate as RedaxMutationIdentitySubtle).subtle
  if (typeof subtle !== 'object' || subtle === null || typeof subtle.digest !== 'function') {
    return null
  }
  return candidate as RedaxMutationIdentitySubtle
}

function toUtf8Bytes(value: string): Uint8Array | null {
  const Encoder = (globalThis as { TextEncoder?: unknown }).TextEncoder
  if (typeof Encoder !== 'function') {
    return null
  }
  try {
    const encoder = new (Encoder as new () => { encode(input: string): Uint8Array })()
    const encoded = encoder.encode(value)
    return encoded instanceof Uint8Array ? Uint8Array.from(encoded) : null
  } catch {
    return null
  }
}

// --- The one exported computation ---------------------------------------------------

/**
 * Compute one mutation identity, or refuse.
 *
 * TOTAL AND VALUE-FREE: nothing throws, nothing is logged, nothing is stored, and a
 * refusal names a class rather than a value. `IDENTITY_UNAVAILABLE` is reserved for a
 * platform that cannot encode or digest — it is never a way of saying the input was
 * wrong, because an identity nobody can compute and an identity that is invalid are
 * different facts about an attempt.
 */
export async function computeRedaxTeamAdminMutationIdentity(
  request: RedaxTeamAdminMutationIdentityRequest,
): Promise<RedaxTeamAdminMutationIdentityResult> {
  if (typeof request !== 'object' || request === null) {
    return { ok: false, code: 'INPUT_INVALID' }
  }
  const canonicalText = encodeCanonicalText(request)
  if (canonicalText === null) {
    return { ok: false, code: 'INPUT_INVALID' }
  }
  const bytes = toUtf8Bytes(canonicalText)
  if (bytes === null) {
    return { ok: false, code: 'IDENTITY_UNAVAILABLE' }
  }
  const platform = resolveSubtle()
  if (platform === null) {
    return { ok: false, code: 'IDENTITY_UNAVAILABLE' }
  }
  let digest: ArrayBuffer
  try {
    digest = await platform.subtle.digest('SHA-256', bytes)
  } catch {
    return { ok: false, code: 'IDENTITY_UNAVAILABLE' }
  }
  let sha256Hex = ''
  for (const byte of new Uint8Array(digest)) {
    sha256Hex += byte.toString(16).padStart(2, '0')
  }
  return {
    ok: true,
    identity: Object.freeze({
      version: REDAX_TEAM_ADMIN_POST_INIT_MUTATION_IDENTITY_VERSION,
      cluster: REDAX_TEAM_ADMIN_MUTATION_CLUSTER,
      operation: request.operation,
      canonicalText,
      sha256Hex,
    }),
  }
}
