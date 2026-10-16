// REDAX app — public VITE environment-config validation policy.
//
// Pure validation policy for the public VITE_* frontend environment only. This
// module performs no RPC, wallet, or network action of any kind, constructs no
// client, and reads no environment by itself: callers pass a plain record and
// receive either a validated config or typed, value-free config errors. It does
// not authorize devnet execution and asserts no readiness of any kind (every
// mode descriptor pins readinessClaim to 'none').
//
// Public-bundle trust boundary: every VITE_* value is compiled into the public
// frontend bundle, so none may carry a private key, seed phrase, keypair or
// deployer path, an authenticated endpoint, or an API/secret token. Wallet
// signing comes from a wallet adapter — never from an environment value — and
// that stays true of the THREE public carriers below, which are a public key, a
// list of public locations and a list of public Campaign addresses rather than any
// kind of signing material.
// Accordingly this validator rejects embedded URL userinfo credentials and
// secret-like RPC query keys, refuses a metadata-URI entry that could carry a
// signed, capability or credential form at all, and never copies a supplied value
// into an error object.
//
// Scope: validation POLICY only, in both halves. This module still reads no env
// and constructs nothing; the runtime read point that applies these policies is
// app/src/data/redaxDataSourceProvider.ts, and it is the only one.
//
// TWO SETS, DELIBERATELY NOT ONE. REDAX_PUBLIC_ENV_VAR_NAMES is the complete
// closed public universe — SEVEN keys. REDAX_CORE_CONFIG_ENV_VAR_NAMES is the
// four-key subset the core data/runtime configuration is decided on, and it is
// named for that subset rather than for the universe. The three carriers beyond it
// are public and are members of the universe, but none is a member of the core
// decision, so a broken carrier disables one bounded surface instead of the app:
//   fifth   — the approved Team/Admin wallet          (ACTION-specific);
//   sixth   — the approved metadata-URI allowlist     (ACTION-specific);
//   seventh — the curated Campaign allowlist          (PUBLIC-DISCOVERY-specific).
// The first two bound what a Team/Admin ACTION may do; the seventh bounds only what
// the public directory LISTS, and it authorizes no action at all.

import type {
  RedaxCluster,
  RedaxDataMode,
  RedaxDataSourceKind,
  RedaxModeCapability,
  RedaxModeDescriptor,
} from '../data/redaxModes'

// --- Public types ----------------------------------------------------------

/**
 * The four CORE data/runtime config keys — NOT the whole public universe.
 *
 * These are exactly the public `VITE_*` names whose validity participates in
 * `validateRedaxEnv` and therefore in the core `RedaxDataSource` decision. The
 * complete frontend-public universe is `REDAX_PUBLIC_ENV_VAR_NAMES` and is
 * larger: it also carries the three carriers declared at the foot of this file —
 * the two Team/Admin action carriers and the curated Campaign discovery allowlist —
 * none of which is part of the core config decision. The scoped name is the point —
 * a constant called "the env var names" reads as though it enumerated every public
 * key, and it does not.
 */
export type RedaxCoreConfigEnvVarName =
  | 'VITE_REDAX_DATA_MODE'
  | 'VITE_SOLANA_CLUSTER'
  | 'VITE_REDAX_PROGRAM_ID'
  | 'VITE_SOLANA_RPC_URL'

/** A caller-supplied raw env record. This module never reads env itself. */
export type RedaxRawEnv = Record<string, string | undefined>

/** A fully validated env configuration for one data mode. */
export interface RedaxValidatedEnv {
  mode: RedaxDataMode
  source: RedaxDataSourceKind
  cluster: RedaxCluster
  modeDescriptor: RedaxModeDescriptor
  programId: string | null
  rpcUrl: string | null
}

/** Stable machine codes for each way the env policy can reject a config. */
export type RedaxEnvConfigErrorCode =
  | 'INVALID_DATA_MODE'
  | 'MISSING_SOLANA_CLUSTER'
  | 'INVALID_SOLANA_CLUSTER'
  | 'MISSING_REDAX_PROGRAM_ID'
  | 'INVALID_REDAX_PROGRAM_ID'
  | 'MISSING_SOLANA_RPC_URL'
  | 'INVALID_SOLANA_RPC_URL'
  | 'SECRET_LIKE_SOLANA_RPC_URL'

/**
 * A single config error. It intentionally carries no raw env value so an
 * accidentally supplied secret-like value never leaks into UI or logs.
 */
export interface RedaxEnvConfigError {
  code: RedaxEnvConfigErrorCode
  variable: RedaxCoreConfigEnvVarName
  title: string
  detail: string
  recovery: string
}

/** The result of validating a raw env record against the policy. */
export type RedaxEnvValidationResult =
  | { ok: true, env: RedaxValidatedEnv }
  | { ok: false, mode: RedaxDataMode | null, errors: readonly RedaxEnvConfigError[] }

// --- Public constants ------------------------------------------------------

/**
 * The four CORE config key names. No superseded name is exported.
 *
 * Scoped, like the type above: this is the core data/runtime configuration set
 * that `validateRedaxEnv` decides on, not the closed public universe. For that,
 * read `REDAX_PUBLIC_ENV_VAR_NAMES`, which is exactly these four plus the two
 * Team/Admin action carriers and the curated Campaign discovery allowlist.
 */
export const REDAX_CORE_CONFIG_ENV_VAR_NAMES = {
  dataMode: 'VITE_REDAX_DATA_MODE',
  solanaCluster: 'VITE_SOLANA_CLUSTER',
  redaxProgramId: 'VITE_REDAX_PROGRAM_ID',
  solanaRpcUrl: 'VITE_SOLANA_RPC_URL',
} as const satisfies Record<string, RedaxCoreConfigEnvVarName>

/** The exact, case-sensitive set of accepted data-mode values. */
export const REDAX_ALLOWED_DATA_MODES = [
  'MOCK_LOCAL',
  'DEVNET_READONLY',
  'DEVNET_WALLET_READONLY',
  'DEVNET_TX_ENABLED',
] as const satisfies readonly RedaxDataMode[]

/** The only runtime Solana cluster accepted in devnet modes. */
export const REDAX_ALLOWED_DEVNET_CLUSTER = 'devnet' as const

// --- Mode descriptors (constants) ------------------------------------------

const MOCK_LOCAL_CAPABILITIES: readonly RedaxModeCapability[] = ['local-fixtures']

const DEVNET_READONLY_CAPABILITIES: readonly RedaxModeCapability[] = [
  'program-rpc-read',
]

const DEVNET_WALLET_READONLY_CAPABILITIES: readonly RedaxModeCapability[] = [
  'program-rpc-read',
  'wallet-connect-readonly',
]

const DEVNET_TX_ENABLED_CAPABILITIES: readonly RedaxModeCapability[] = [
  'program-rpc-read',
  'wallet-required-for-actions',
  'transaction-actions-enabled',
]

const MOCK_LOCAL_DESCRIPTOR: RedaxModeDescriptor = {
  mode: 'MOCK_LOCAL',
  source: 'mock-fixtures',
  cluster: null,
  label: 'Local mock fixtures (MOCK_LOCAL)',
  boundaryLabel: 'Local fixtures / sample data only — not on-chain data.',
  capabilities: MOCK_LOCAL_CAPABILITIES,
  walletRequiredForActions: false,
  rpcAllowed: false,
  transactionActionsAllowed: false,
  mockFallbackAllowed: false,
  readinessClaim: 'none',
}

const DEVNET_READONLY_DESCRIPTOR: RedaxModeDescriptor = {
  mode: 'DEVNET_READONLY',
  source: 'program-rpc',
  cluster: 'devnet',
  label: 'Devnet reads (DEVNET_READONLY)',
  boundaryLabel: 'Devnet program/RPC reads only — no transaction actions.',
  capabilities: DEVNET_READONLY_CAPABILITIES,
  walletRequiredForActions: false,
  rpcAllowed: true,
  transactionActionsAllowed: false,
  mockFallbackAllowed: false,
  readinessClaim: 'none',
}

const DEVNET_WALLET_READONLY_DESCRIPTOR: RedaxModeDescriptor = {
  mode: 'DEVNET_WALLET_READONLY',
  source: 'program-rpc',
  cluster: 'devnet',
  label: 'Devnet reads + wallet context (DEVNET_WALLET_READONLY)',
  boundaryLabel:
    'Devnet program/RPC reads plus wallet connection for role/balance context only — no transaction actions.',
  capabilities: DEVNET_WALLET_READONLY_CAPABILITIES,
  walletRequiredForActions: false,
  rpcAllowed: true,
  transactionActionsAllowed: false,
  mockFallbackAllowed: false,
  readinessClaim: 'none',
}

const DEVNET_TX_ENABLED_DESCRIPTOR: RedaxModeDescriptor = {
  mode: 'DEVNET_TX_ENABLED',
  source: 'program-rpc',
  cluster: 'devnet',
  label: 'Devnet reads + wallet-gated actions (DEVNET_TX_ENABLED)',
  boundaryLabel:
    'Devnet program/RPC reads plus wallet-gated transaction actions.',
  capabilities: DEVNET_TX_ENABLED_CAPABILITIES,
  walletRequiredForActions: true,
  rpcAllowed: true,
  transactionActionsAllowed: true,
  mockFallbackAllowed: false,
  readinessClaim: 'none',
}

// --- Validation helpers (private) ------------------------------------------

/** Lightweight base58 program-id shape (32–44 base58 characters). */
const BASE58_PROGRAM_ID_PATTERN = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/

/** Query keys that strongly imply an embedded secret in a public URL. */
const SECRET_LIKE_QUERY_KEYS: readonly string[] = [
  'api-key',
  'apikey',
  'token',
  'access_token',
  'auth',
  'key',
]

function trimOrEmpty(value: string | undefined): string {
  return value === undefined ? '' : value.trim()
}

function isBase58Shaped(value: string): boolean {
  return BASE58_PROGRAM_ID_PATTERN.test(value)
}

function isHttpsUrlShaped(value: string): boolean {
  const prefix = 'https://'
  if (!value.startsWith(prefix)) {
    return false
  }
  const afterScheme = value.slice(prefix.length)
  // Require at least one non-slash hostname character right after the scheme.
  return afterScheme.length > 0 && afterScheme[0] !== '/'
}

function hasUrlCredentials(value: string): boolean {
  const prefix = 'https://'
  if (!value.startsWith(prefix)) {
    return false
  }
  const afterScheme = value.slice(prefix.length)
  const authorityEnd = afterScheme.search(/[/?#]/)
  const authority =
    authorityEnd === -1 ? afterScheme : afterScheme.slice(0, authorityEnd)
  // Embedded userinfo (user:pass@host) is a credential leak in a public bundle.
  return authority.includes('@')
}

function hasSecretLikeQueryKey(value: string): boolean {
  const queryStart = value.indexOf('?')
  if (queryStart === -1) {
    return false
  }
  let query = value.slice(queryStart + 1)
  const fragmentStart = query.indexOf('#')
  if (fragmentStart !== -1) {
    query = query.slice(0, fragmentStart)
  }
  if (query === '') {
    return false
  }
  for (const pair of query.split('&')) {
    if (pair === '') {
      continue
    }
    const equalsIndex = pair.indexOf('=')
    const rawKey = equalsIndex === -1 ? pair : pair.slice(0, equalsIndex)
    const key = rawKey.trim().toLowerCase()
    for (const secretKey of SECRET_LIKE_QUERY_KEYS) {
      if (key === secretKey) {
        return true
      }
    }
  }
  return false
}

interface DevnetConfigParse {
  errors: RedaxEnvConfigError[]
  programId: string | null
  rpcUrl: string | null
}

function parseDevnetConfig(raw: RedaxRawEnv): DevnetConfigParse {
  const errors: RedaxEnvConfigError[] = []

  const clusterValue = trimOrEmpty(raw.VITE_SOLANA_CLUSTER)
  if (clusterValue === '') {
    errors.push({
      code: 'MISSING_SOLANA_CLUSTER',
      variable: REDAX_CORE_CONFIG_ENV_VAR_NAMES.solanaCluster,
      title: 'Missing Solana cluster',
      detail: 'Devnet modes require VITE_SOLANA_CLUSTER to be set to devnet.',
      recovery: 'Set VITE_SOLANA_CLUSTER=devnet.',
    })
  } else if (clusterValue !== REDAX_ALLOWED_DEVNET_CLUSTER) {
    errors.push({
      code: 'INVALID_SOLANA_CLUSTER',
      variable: REDAX_CORE_CONFIG_ENV_VAR_NAMES.solanaCluster,
      title: 'Unsupported Solana cluster',
      detail:
        'Only devnet is supported for REDAX devnet modes; no other cluster value is accepted.',
      recovery: 'Set VITE_SOLANA_CLUSTER=devnet.',
    })
  }

  const programIdValue = trimOrEmpty(raw.VITE_REDAX_PROGRAM_ID)
  let programId: string | null = null
  if (programIdValue === '') {
    errors.push({
      code: 'MISSING_REDAX_PROGRAM_ID',
      variable: REDAX_CORE_CONFIG_ENV_VAR_NAMES.redaxProgramId,
      title: 'Missing program id',
      detail: 'Devnet modes require VITE_REDAX_PROGRAM_ID to be set.',
      recovery: 'Set VITE_REDAX_PROGRAM_ID to the deployed REDAX program id.',
    })
  } else if (!isBase58Shaped(programIdValue)) {
    errors.push({
      code: 'INVALID_REDAX_PROGRAM_ID',
      variable: REDAX_CORE_CONFIG_ENV_VAR_NAMES.redaxProgramId,
      title: 'Malformed program id',
      detail:
        'VITE_REDAX_PROGRAM_ID must be a base58-shaped Solana program id (32–44 base58 characters).',
      recovery: 'Set VITE_REDAX_PROGRAM_ID to a valid base58 program id.',
    })
  } else {
    programId = programIdValue
  }

  const rpcUrlValue = trimOrEmpty(raw.VITE_SOLANA_RPC_URL)
  let rpcUrl: string | null = null
  if (rpcUrlValue === '') {
    errors.push({
      code: 'MISSING_SOLANA_RPC_URL',
      variable: REDAX_CORE_CONFIG_ENV_VAR_NAMES.solanaRpcUrl,
      title: 'Missing RPC URL',
      detail: 'Devnet modes require VITE_SOLANA_RPC_URL to be set.',
      recovery: 'Set VITE_SOLANA_RPC_URL to a public https devnet RPC endpoint.',
    })
  } else if (!isHttpsUrlShaped(rpcUrlValue)) {
    errors.push({
      code: 'INVALID_SOLANA_RPC_URL',
      variable: REDAX_CORE_CONFIG_ENV_VAR_NAMES.solanaRpcUrl,
      title: 'Malformed RPC URL',
      detail: 'VITE_SOLANA_RPC_URL must be an https:// URL with a hostname.',
      recovery: 'Set VITE_SOLANA_RPC_URL to a public https devnet RPC endpoint.',
    })
  } else if (hasUrlCredentials(rpcUrlValue) || hasSecretLikeQueryKey(rpcUrlValue)) {
    errors.push({
      code: 'SECRET_LIKE_SOLANA_RPC_URL',
      variable: REDAX_CORE_CONFIG_ENV_VAR_NAMES.solanaRpcUrl,
      title: 'RPC URL appears to carry a secret',
      detail:
        'VITE_SOLANA_RPC_URL must not embed userinfo credentials or secret-like query keys; all VITE_* values ship in the public frontend bundle.',
      recovery:
        'Use a public, unauthenticated https devnet RPC URL with no embedded credentials and no secret query keys.',
    })
  } else {
    rpcUrl = rpcUrlValue
  }

  return { errors, programId, rpcUrl }
}

// --- Public functions ------------------------------------------------------

/**
 * Normalize a raw data-mode string into a known mode.
 *  - undefined or empty (after trim) -> 'MOCK_LOCAL'
 *  - an exact, uppercase allowed value -> that value
 *  - any other casing or unknown value -> null
 *
 * Whitespace is trimmed; casing is never normalized and no lowercase alias is
 * silently accepted.
 */
export function normalizeRedaxDataMode(
  value: string | undefined,
): RedaxDataMode | null {
  const trimmed = trimOrEmpty(value)
  if (trimmed === '') {
    return 'MOCK_LOCAL'
  }
  for (const mode of REDAX_ALLOWED_DATA_MODES) {
    if (trimmed === mode) {
      return mode
    }
  }
  return null
}

/**
 * Validate a raw env record against the REDAX public env policy. MOCK_LOCAL is
 * the safe default; devnet modes are validated strictly and an invalid devnet
 * config is reported as an error — it never falls back to mock.
 */
export function validateRedaxEnv(raw: RedaxRawEnv): RedaxEnvValidationResult {
  const mode = normalizeRedaxDataMode(raw.VITE_REDAX_DATA_MODE)

  if (mode === null) {
    return {
      ok: false,
      mode: null,
      errors: [
        {
          code: 'INVALID_DATA_MODE',
          variable: REDAX_CORE_CONFIG_ENV_VAR_NAMES.dataMode,
          title: 'Unknown data mode',
          detail:
            'VITE_REDAX_DATA_MODE must be one of MOCK_LOCAL, DEVNET_READONLY, DEVNET_WALLET_READONLY, or DEVNET_TX_ENABLED (exact uppercase). Unset or empty defaults to MOCK_LOCAL.',
          recovery:
            'Set VITE_REDAX_DATA_MODE to an exact allowed value, or unset it to default to MOCK_LOCAL.',
        },
      ],
    }
  }

  if (mode === 'MOCK_LOCAL') {
    return {
      ok: true,
      env: {
        mode: 'MOCK_LOCAL',
        source: 'mock-fixtures',
        cluster: null,
        modeDescriptor: MOCK_LOCAL_DESCRIPTOR,
        programId: null,
        rpcUrl: null,
      },
    }
  }

  // DEVNET_READONLY, DEVNET_WALLET_READONLY, and DEVNET_TX_ENABLED share the
  // same strict devnet checks.
  const parsed = parseDevnetConfig(raw)
  if (parsed.errors.length > 0) {
    return {
      ok: false,
      mode,
      errors: parsed.errors,
    }
  }

  const descriptor =
    mode === 'DEVNET_READONLY'
      ? DEVNET_READONLY_DESCRIPTOR
      : mode === 'DEVNET_WALLET_READONLY'
        ? DEVNET_WALLET_READONLY_DESCRIPTOR
        : DEVNET_TX_ENABLED_DESCRIPTOR

  return {
    ok: true,
    env: {
      mode,
      source: 'program-rpc',
      cluster: 'devnet',
      modeDescriptor: descriptor,
      programId: parsed.programId,
      rpcUrl: parsed.rpcUrl,
    },
  }
}

// --- Team/Admin approved-carrier policy (the fifth public key) ---------------
//
// IT IS DELIBERATELY NOT PART OF validateRedaxEnv. The four data/runtime keys
// above remain the complete core data-source configuration, and this policy is
// evaluated separately so that a missing or malformed Team carrier fails the
// Team/Admin action surface CLOSED while leaving the core RedaxDataSource, the
// read-only devnet rendering and the existing Holder flows entirely untouched.
// Folding the fifth key into the four-key ok/fail decision would let a Team
// deployment detail break the whole product, which is the opposite of the rule.
//
// Like every other policy in this module it reads no env of its own and copies
// no supplied value into its result: an unusable carrier yields a bare status,
// never the raw text that was supplied.

/** The Team/Admin approved-wallet carrier key. Public; never a secret. */
export const REDAX_APPROVED_TEAM_WALLET_ENV_VAR_NAME =
  'VITE_REDAX_APPROVED_TEAM_WALLET' as const

/** The carrier key's name, as a type. */
export type RedaxTeamAdminCarrierEnvVarName = typeof REDAX_APPROVED_TEAM_WALLET_ENV_VAR_NAME

/**
 * The complete closed public VITE_* universe: the four core config keys plus the
 * two Team/Admin action carriers plus the curated Campaign discovery allowlist.
 * Exactly SEVEN, and none of the last three is a CORE CONFIG input.
 *
 * This constant — not `REDAX_CORE_CONFIG_ENV_VAR_NAMES` — is the answer to
 * "which public env keys may this app read". The two are deliberately separate
 * declarations because they answer deliberately separate questions, and the
 * four-key one is scoped in its name so it can never be mistaken for this one.
 *
 * What it is NOT: it is not a member of `REDAX_CORE_CONFIG_ENV_VAR_NAMES`, not a
 * `validateRedaxEnv` core-validity input, not a gate on a BY-ADDRESS read, not a wallet
 * identity source, and not a Holder or Team/Admin action authorization. A missing or
 * malformed Campaign carrier fails public multi-Campaign discovery CLOSED to an empty
 * curated directory; it does not invalidate the four-key core runtime, and an exactly
 * named unlisted address remains inspectable by address.
 */
export const REDAX_PUBLIC_ENV_VAR_NAMES = [
  'VITE_REDAX_DATA_MODE',
  'VITE_SOLANA_CLUSTER',
  'VITE_REDAX_PROGRAM_ID',
  'VITE_SOLANA_RPC_URL',
  'VITE_REDAX_APPROVED_TEAM_WALLET',
  'VITE_REDAX_METADATA_URI_ALLOWLIST',
  'VITE_REDAX_CAMPAIGN_ALLOWLIST',
] as const satisfies readonly (
  | RedaxCoreConfigEnvVarName
  | RedaxTeamAdminCarrierEnvVarName
  | RedaxTeamAdminMetadataUriAllowlistEnvVarName
  | RedaxCampaignAllowlistEnvVarName
)[]

/** Every public env name this app may read. Exactly seven. */
export type RedaxPublicEnvVarName = (typeof REDAX_PUBLIC_ENV_VAR_NAMES)[number]

/** Whether a supplied Team carrier is usable, and if not, which way it failed. */
export type RedaxTeamAdminCarrierStatus = 'AVAILABLE' | 'MISSING' | 'INVALID'

/**
 * The SANITIZED carrier decision.
 *
 * `AVAILABLE` carries the one canonical public-key string. `MISSING` and
 * `INVALID` carry `null` and deliberately have no member in which the supplied
 * value could travel — a malformed carrier must not reach a message, a log or a
 * rendered surface, exactly as RedaxEnvConfigError already refuses to carry one.
 */
export type RedaxTeamAdminCarrierValidation =
  | { readonly status: 'AVAILABLE'; readonly approvedTeamWallet: string }
  | { readonly status: 'MISSING' | 'INVALID'; readonly approvedTeamWallet: null }

/** The base58 alphabet Solana public keys are written in. */
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'

/** A 32-byte value is 32-44 base58 characters. Anything longer is not one. */
const MAX_BASE58_PUBLIC_KEY_LENGTH = 44

/** Exactly the byte length of an Ed25519 public key. */
const PUBLIC_KEY_BYTE_LENGTH = 32

/**
 * Decode base58 to bytes, or null when a character is outside the alphabet.
 *
 * Pure and dependency-free on purpose: this module imports no wallet adapter and
 * no web3 client, and adding one to validate a public string would widen the
 * app's measured @solana/web3.js edge census for a pure parsing job.
 */
function decodeBase58(value: string): readonly number[] | null {
  let accumulated = 0n
  for (const character of value) {
    const digit = BASE58_ALPHABET.indexOf(character)
    if (digit < 0) {
      return null
    }
    accumulated = accumulated * 58n + BigInt(digit)
  }
  const bytes: number[] = []
  while (accumulated > 0n) {
    bytes.unshift(Number(accumulated % 256n))
    accumulated /= 256n
  }
  // Each leading '1' is one leading zero byte, which the numeric value cannot carry.
  for (let index = 0; index < value.length && value[index] === '1'; index += 1) {
    bytes.unshift(0)
  }
  return bytes
}

/** Encode bytes back to base58, so canonicity can be decided by round-trip. */
function encodeBase58(bytes: readonly number[]): string {
  let accumulated = 0n
  for (const byte of bytes) {
    accumulated = accumulated * 256n + BigInt(byte)
  }
  let encoded = ''
  while (accumulated > 0n) {
    encoded = BASE58_ALPHABET[Number(accumulated % 58n)] + encoded
    accumulated /= 58n
  }
  for (let index = 0; index < bytes.length && bytes[index] === 0; index += 1) {
    encoded = `1${encoded}`
  }
  return encoded
}

/**
 * THE ONE canonical-public-key decision in this app. Pure, total, non-throwing.
 *
 * It judges an EXACT value and trims nothing: whitespace handling belongs to whichever
 * carrier is speaking, because "the operator typed a space" and "the entry contains a
 * space" are different deployment facts and only the caller knows which it is holding.
 *
 * A canonical Solana public key is decided by ROUND TRIP and by nothing else: the text
 * is bounded before any work, decoded through this module's own base58 machinery, must
 * be exactly 32 bytes, and must re-encode to the supplied text character for character.
 * A non-canonical spelling of a real key is therefore refused rather than silently
 * normalized into one, and there is deliberately NO regex substitute — a `32..44`
 * character-class test accepts strings that decode to 31 or 33 bytes and accepts
 * leading-zero spellings that are not the canonical form of anything.
 *
 * IT DECIDES NOTHING ELSE. Whether the key is an eligible Team authority, an existing
 * account, a REDAX Campaign, or anything at all on chain is not asked here and cannot
 * be: this is spelling, and spelling is not existence.
 */
export function isCanonicalRedaxPublicKey(value: string): boolean {
  if (typeof value !== 'string' || value === '') {
    // Defensive on the type: the declared parameter cannot enforce it against a plain
    // JavaScript caller, and an unexpected shape is a refusal rather than a coerce.
    return false
  }
  if (value.length > MAX_BASE58_PUBLIC_KEY_LENGTH) {
    // Bounded before any decode: an oversized value is refused without work.
    return false
  }
  const decoded = decodeBase58(value)
  if (decoded === null || decoded.length !== PUBLIC_KEY_BYTE_LENGTH) {
    return false
  }
  return encodeBase58(decoded) === value
}

/**
 * Validate the PUBLIC approved-Team carrier. Pure, total and non-throwing.
 *
 * Outer whitespace is trimmed; an absent or empty entry is MISSING rather than
 * INVALID, because "not configured" and "configured wrongly" are different
 * deployment facts. Everything else must be a CANONICAL 32-byte base58 public key,
 * and that judgement is made by `isCanonicalRedaxPublicKey` above — THE one such
 * decision in the app. Routing through it changes no external semantics of this
 * function; it removes the second copy that could have drifted from the first.
 * Whether that key is an eligible Team authority is not decided here — the chain
 * guard owns that and keeps it.
 */
export function validateRedaxApprovedTeamWallet(
  value: string | undefined,
): RedaxTeamAdminCarrierValidation {
  const trimmed = trimOrEmpty(value)
  if (trimmed === '') {
    return { status: 'MISSING', approvedTeamWallet: null }
  }
  if (!isCanonicalRedaxPublicKey(trimmed)) {
    return { status: 'INVALID', approvedTeamWallet: null }
  }
  return { status: 'AVAILABLE', approvedTeamWallet: trimmed }
}

// --- Team/Admin metadata-URI allowlist policy (the sixth public key) ----------
//
// URI SEMANTIC AUTHORITY IS NOT HERE AND MUST NOT MOVE HERE. Whether a string is
// a usable metadata URI — https semantics, parser semantics, percent-escape
// well-formedness, the program's 1..200 UTF-8 byte bound, normalization, and
// whether a mutation request's URI is an approved one — is decided by
// `canonicalizeRedaxTeamAdminMetadata` in
// app/src/teamAdmin/redaxTeamAdminMetadataCanonical.ts, which stays the SOLE
// semantic and identity authority. This module owns exactly two things: BOUNDED
// LIST TRANSPORT, and the public-secret carrier refusal above. The byte ceilings
// below are transport anti-abuse, not the program's URI bound, and they are named
// so the two can never be confused.
//
// THE TRANSPORT IS ASCII-WHITESPACE-DELIMITED EXACT ENTRIES. Nothing is split on
// a comma or a semicolon, nothing is lowercased, NFC-normalized, percent-decoded,
// re-encoded, rewritten, sorted or silently deduplicated, and nothing inside an
// entry is trimmed. An exact duplicate entry is INVALID_CONFIG rather than a
// silent dedupe, because a configuration that says one thing twice is a
// configuration nobody checked.
//
// Like every other policy in this module it reads no env of its own and copies no
// supplied value into its result: an unusable list yields a bare status and the
// one frozen empty array, never the raw text that was supplied, and never a URI,
// host, path, query, fragment or substring of one.

/** The Team/Admin metadata-URI allowlist key. Public; never a secret. */
export const REDAX_METADATA_URI_ALLOWLIST_ENV_VAR_NAME =
  'VITE_REDAX_METADATA_URI_ALLOWLIST' as const

/** The allowlist key's name, as a type. */
export type RedaxTeamAdminMetadataUriAllowlistEnvVarName =
  typeof REDAX_METADATA_URI_ALLOWLIST_ENV_VAR_NAME

/** At most this many entries may be configured. TRANSPORT anti-abuse only. */
export const MAX_METADATA_URI_ALLOWLIST_ENTRIES = 32

/** The whole raw value may not exceed this many UTF-8 bytes. TRANSPORT only. */
export const MAX_METADATA_URI_ALLOWLIST_RAW_UTF8_BYTES = 8192

/**
 * One entry may not exceed this many UTF-8 bytes AT THE TRANSPORT LAYER.
 *
 * Deliberately LARGER than the program's `1..200` URI bound and deliberately not
 * a restatement of it: this ceiling exists so a hostile or fat-fingered
 * environment value cannot make the parse expensive, and the canonicalizer
 * remains the only thing that decides whether an entry is a usable metadata URI.
 */
export const MAX_METADATA_URI_ALLOWLIST_ENTRY_TRANSPORT_BYTES = 512

/**
 * The three characters an entry may never contain, at the CONFIG CARRIER layer.
 *
 *   `?` — a query, which is where a signed URL's signature and expiry travel;
 *   `#` — a fragment, which is where a capability token is commonly hidden;
 *   `@` — userinfo, which is what an embedded credential looks like.
 *
 * NO EXCEPTIONS, and no entropy, length or path-shape heuristic beside them: a
 * heuristic that guessed at secrets would refuse honest URIs and admit clever
 * ones, while these three answer a structural question exactly.
 */
export const METADATA_URI_ALLOWLIST_FORBIDDEN_ENTRY_CHARACTERS: readonly string[] =
  Object.freeze(['?', '#', '@'])

/** Whether a supplied allowlist is usable, and if not, which way it failed. */
export type RedaxTeamAdminMetadataUriAllowlistStatus = 'AVAILABLE' | 'MISSING' | 'INVALID'

/**
 * The SANITIZED allowlist decision. Total, and value-free on every refusal.
 *
 * `AVAILABLE` carries the exact entries in the exact configured order, frozen.
 * `MISSING` and `INVALID` both carry THE ONE frozen empty array below, so a
 * rejected value has nowhere to travel — not a raw string, not a URI, not a host,
 * not a path, not a query, not a fragment and not a substring of one. There is no
 * message member and nothing is logged.
 */
export type RedaxTeamAdminMetadataUriAllowlistValidation =
  | { readonly status: 'AVAILABLE'; readonly entries: readonly string[] }
  | { readonly status: 'MISSING' | 'INVALID'; readonly entries: readonly string[] }

/** The ONE frozen empty result both refusals carry. Allocated once, shared. */
const EMPTY_METADATA_URI_ALLOWLIST_ENTRIES: readonly string[] = Object.freeze([] as string[])

/** The exact ASCII whitespace this transport delimits on, and nothing wider. */
function isAsciiWhitespaceUnit(unit: number): boolean {
  return (
    unit === 0x20 || // space
    unit === 0x09 || // tab
    unit === 0x0a || // line feed
    unit === 0x0b || // vertical tab
    unit === 0x0c || // form feed
    unit === 0x0d //   carriage return
  )
}

/**
 * Split on RUNS of ASCII whitespace, and on nothing else.
 *
 * Written out rather than delegated to `/\s+/`, because the regex class also
 * matches U+00A0, U+2028 and U+FEFF among others — so a no-break space INSIDE an
 * entry would be silently treated as a delimiter, which is exactly the "trim
 * inside an entry" this transport refuses to do. Here such a character stays part
 * of the entry, and whether that makes the entry a usable URI is the
 * canonicalizer's question rather than this module's.
 */
function splitOnAsciiWhitespace(value: string): string[] {
  const entries: string[] = []
  let start = -1
  for (let index = 0; index < value.length; index += 1) {
    if (isAsciiWhitespaceUnit(value.charCodeAt(index))) {
      if (start !== -1) {
        entries.push(value.slice(start, index))
        start = -1
      }
      continue
    }
    if (start === -1) {
      start = index
    }
  }
  if (start !== -1) {
    entries.push(value.slice(start))
  }
  return entries
}

/**
 * The exact UTF-8 byte length of a string, or `null` when it has none.
 *
 * A JavaScript string may carry a LONE SURROGATE, which is a code unit with no
 * UTF-8 encoding at all; every platform encoder substitutes U+FFFD for it, so a
 * length measured through one would be the length of a DIFFERENT value. Counting
 * by hand answers the question exactly, and an unencodable value is `null` — a
 * refusal, never a repair. This is transport measurement and nothing more: it
 * decides no URI semantics and normalizes nothing.
 */
function utf8ByteLengthOf(value: string): number | null {
  let bytes = 0
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index)
    if (unit < 0x80) {
      bytes += 1
      continue
    }
    if (unit < 0x800) {
      bytes += 2
      continue
    }
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = index + 1 < value.length ? value.charCodeAt(index + 1) : -1
      if (next < 0xdc00 || next > 0xdfff) {
        return null
      }
      bytes += 4
      // Step over the pair's second half so it is never counted on its own.
      index += 1
      continue
    }
    if (unit >= 0xdc00 && unit <= 0xdfff) {
      return null
    }
    bytes += 3
  }
  return bytes
}

/**
 * Validate the PUBLIC metadata-URI allowlist carrier. Pure, total, non-throwing.
 *
 * An absent or whitespace-only entry is MISSING rather than INVALID, because "not
 * configured" and "configured wrongly" are different deployment facts and the
 * product distinguishes them. Everything else is judged as TRANSPORT: the raw
 * value is bounded, split on ASCII whitespace into exact entries, and each entry
 * is bounded, refused if it carries `?`, `#` or `@`, and refused if an earlier
 * entry already said exactly the same thing.
 *
 * WHAT IT DOES NOT DO is the point. It does not decide the scheme, does not parse
 * the URI, does not check percent escapes, does not apply the program's `1..200`
 * byte bound, does not normalize and does not decide whether a mutation request's
 * URI is approved. `canonicalizeRedaxTeamAdminMetadata` owns every one of those,
 * and an entry that passes here can still be refused there.
 */
export function validateRedaxTeamAdminMetadataUriAllowlist(
  value: string | undefined,
): RedaxTeamAdminMetadataUriAllowlistValidation {
  if (value === undefined) {
    return { status: 'MISSING', entries: EMPTY_METADATA_URI_ALLOWLIST_ENTRIES }
  }
  if (typeof value !== 'string') {
    // Defensive: the declared parameter type cannot enforce this against a plain
    // JavaScript caller, and an unexpected shape is a refusal rather than a coerce.
    return { status: 'INVALID', entries: EMPTY_METADATA_URI_ALLOWLIST_ENTRIES }
  }
  // Bounded BEFORE any scan. Every UTF-16 code unit encodes to at least one UTF-8
  // byte, so a value longer than the byte ceiling cannot possibly fit inside it.
  if (value.length > MAX_METADATA_URI_ALLOWLIST_RAW_UTF8_BYTES) {
    return { status: 'INVALID', entries: EMPTY_METADATA_URI_ALLOWLIST_ENTRIES }
  }
  const rawBytes = utf8ByteLengthOf(value)
  if (rawBytes === null || rawBytes > MAX_METADATA_URI_ALLOWLIST_RAW_UTF8_BYTES) {
    return { status: 'INVALID', entries: EMPTY_METADATA_URI_ALLOWLIST_ENTRIES }
  }
  const entries = splitOnAsciiWhitespace(value)
  if (entries.length === 0) {
    // Whitespace-only is NOT CONFIGURED, exactly as an empty string is.
    return { status: 'MISSING', entries: EMPTY_METADATA_URI_ALLOWLIST_ENTRIES }
  }
  if (entries.length > MAX_METADATA_URI_ALLOWLIST_ENTRIES) {
    return { status: 'INVALID', entries: EMPTY_METADATA_URI_ALLOWLIST_ENTRIES }
  }
  const seen = new Set<string>()
  for (const entry of entries) {
    const entryBytes = utf8ByteLengthOf(entry)
    if (entryBytes === null || entryBytes > MAX_METADATA_URI_ALLOWLIST_ENTRY_TRANSPORT_BYTES) {
      return { status: 'INVALID', entries: EMPTY_METADATA_URI_ALLOWLIST_ENTRIES }
    }
    for (const forbidden of METADATA_URI_ALLOWLIST_FORBIDDEN_ENTRY_CHARACTERS) {
      if (entry.includes(forbidden)) {
        // A signed query, a capability fragment or an embedded credential cannot
        // enter the resolved allowlist. The offending entry is not echoed.
        return { status: 'INVALID', entries: EMPTY_METADATA_URI_ALLOWLIST_ENTRIES }
      }
    }
    if (seen.has(entry)) {
      // INVALID_CONFIG, never a silent dedupe.
      return { status: 'INVALID', entries: EMPTY_METADATA_URI_ALLOWLIST_ENTRIES }
    }
    seen.add(entry)
  }
  // EXACT ENTRIES, IN THE EXACT CONFIGURED ORDER, frozen. Nothing was rewritten.
  return { status: 'AVAILABLE', entries: Object.freeze(entries) }
}

// --- Curated Campaign discovery allowlist (the seventh public key) ------------
//
// IT IS A FRONTEND DEPLOYMENT POLICY AND NOT PROTOCOL LAW. The REDAX program is
// permissionless and knows nothing about this list: an unlisted Campaign exists on
// chain exactly as a listed one does, and a listed Campaign is neither reviewed,
// verified, endorsed nor made safe by appearing here. This carrier decides ONE
// question — which Campaigns a curated public directory enumerates — and it is not a
// discovery capacity, not a scale claim and not a statement about any Campaign.
//
// DEFAULT DENY, AND WHOLE-CONFIG POISONING. Missing, empty and ASCII-whitespace-only
// are MISSING; anything malformed at all is INVALID; and BOTH resolve to the same
// empty list, which lists nothing. One bad member invalidates the ENTIRE
// configuration — nothing is silently dropped, no partial list survives, nothing is
// deduplicated and nothing is normalized — because a directory assembled from the
// half of a configuration that happened to parse is a directory nobody approved.
//
// THE TRANSPORT IS ASCII-WHITESPACE-DELIMITED EXACT ENTRIES, exactly as the metadata
// carrier's is, and it reuses that carrier's measuring and splitting helpers rather
// than restating them. Each entry is then judged by `isCanonicalRedaxPublicKey` —
// THE one canonical-public-key decision in this app — so there is no second base58
// regex, no second decoder and no second idea of what an address is.
//
// Like every other policy in this module it reads no env of its own and copies no
// supplied value into its result: an unusable list yields a bare status and the one
// frozen empty array, never the raw text that was supplied and never a substring of
// one.

/** The curated Campaign discovery allowlist key. Public; never a secret. */
export const REDAX_CAMPAIGN_ALLOWLIST_ENV_VAR_NAME =
  'VITE_REDAX_CAMPAIGN_ALLOWLIST' as const

/** The Campaign allowlist key's name, as a type. */
export type RedaxCampaignAllowlistEnvVarName =
  typeof REDAX_CAMPAIGN_ALLOWLIST_ENV_VAR_NAME

/** At most this many Campaigns may be listed. TRANSPORT anti-abuse only. */
export const MAX_CAMPAIGN_ALLOWLIST_ENTRIES = 16

/** The whole raw value may not exceed this many UTF-8 bytes. TRANSPORT only. */
export const MAX_CAMPAIGN_ALLOWLIST_RAW_UTF8_BYTES = 1024

/** Whether a supplied Campaign allowlist is usable, and if not, which way it failed. */
export type RedaxCampaignAllowlistStatus = 'AVAILABLE' | 'MISSING' | 'INVALID'

/**
 * The SANITIZED Campaign allowlist decision. Total, and value-free on every refusal.
 *
 * `AVAILABLE` carries at least one entry, in the exact configured order, frozen.
 * `MISSING` and `INVALID` both carry THE ONE frozen empty array below, so a rejected
 * value has nowhere to travel — not a raw string, not an address, not a substring of
 * one. There is no message member, no rejected-value member, no partial list and
 * nothing is logged.
 */
export type RedaxCampaignAllowlistValidation =
  | { readonly status: 'AVAILABLE'; readonly entries: readonly string[] }
  | { readonly status: 'MISSING' | 'INVALID'; readonly entries: readonly string[] }

/** The ONE frozen empty result both refusals carry. Allocated once, shared. */
const EMPTY_CAMPAIGN_ALLOWLIST_ENTRIES: readonly string[] = Object.freeze([] as string[])

/**
 * Resolve the PUBLIC curated Campaign allowlist. Pure, total, non-throwing.
 *
 * An absent, empty or ASCII-whitespace-only value is MISSING rather than INVALID,
 * because "no directory was curated" and "a directory was curated wrongly" are
 * different deployment facts. There is deliberately no `AVAILABLE_EMPTY`: an
 * AVAILABLE result always names at least one Campaign, so "the list is available"
 * and "the list lists something" cannot come apart.
 *
 * Everything else is judged as TRANSPORT first and as IDENTITY second: the raw value
 * is bounded before any scan, split on runs of ASCII whitespace into exact entries,
 * bounded again by entry count, and each entry must be a canonical Solana public key
 * that no earlier entry already said. No entry is trimmed after the split, no
 * spelling is repaired, and an exact duplicate is INVALID rather than a silent
 * dedupe — a configuration that says one thing twice is a configuration nobody
 * checked.
 *
 * WHAT IT DOES NOT DO. It reads no chain, so it cannot know whether an entry is a
 * REDAX Campaign, whether the account exists, or what state it is in. A canonical
 * address is a well-formed address and nothing more.
 */
export function resolveRedaxCampaignAllowlist(
  value: string | undefined,
): RedaxCampaignAllowlistValidation {
  if (value === undefined) {
    return { status: 'MISSING', entries: EMPTY_CAMPAIGN_ALLOWLIST_ENTRIES }
  }
  if (typeof value !== 'string') {
    // Defensive: the declared parameter type cannot enforce this against a plain
    // JavaScript caller, and an unexpected shape is a refusal rather than a coerce.
    return { status: 'INVALID', entries: EMPTY_CAMPAIGN_ALLOWLIST_ENTRIES }
  }
  // Bounded BEFORE any scan. Every UTF-16 code unit encodes to at least one UTF-8
  // byte, so a value longer than the byte ceiling cannot possibly fit inside it.
  if (value.length > MAX_CAMPAIGN_ALLOWLIST_RAW_UTF8_BYTES) {
    return { status: 'INVALID', entries: EMPTY_CAMPAIGN_ALLOWLIST_ENTRIES }
  }
  const rawBytes = utf8ByteLengthOf(value)
  if (rawBytes === null || rawBytes > MAX_CAMPAIGN_ALLOWLIST_RAW_UTF8_BYTES) {
    // `null` is an unencodable value — a lone surrogate — and it is refused rather
    // than measured through a substitution character that would size a DIFFERENT value.
    return { status: 'INVALID', entries: EMPTY_CAMPAIGN_ALLOWLIST_ENTRIES }
  }
  const entries = splitOnAsciiWhitespace(value)
  if (entries.length === 0) {
    // Whitespace-only is NOT CURATED, exactly as an empty string is.
    return { status: 'MISSING', entries: EMPTY_CAMPAIGN_ALLOWLIST_ENTRIES }
  }
  if (entries.length > MAX_CAMPAIGN_ALLOWLIST_ENTRIES) {
    return { status: 'INVALID', entries: EMPTY_CAMPAIGN_ALLOWLIST_ENTRIES }
  }
  const seen = new Set<string>()
  for (const entry of entries) {
    if (!isCanonicalRedaxPublicKey(entry)) {
      // One malformed member poisons the whole configuration. The offending entry is
      // not echoed, and its valid neighbours are not silently retained.
      return { status: 'INVALID', entries: EMPTY_CAMPAIGN_ALLOWLIST_ENTRIES }
    }
    if (seen.has(entry)) {
      // INVALID_CONFIG, never a silent dedupe.
      return { status: 'INVALID', entries: EMPTY_CAMPAIGN_ALLOWLIST_ENTRIES }
    }
    seen.add(entry)
  }
  // EXACT ENTRIES, IN THE EXACT CONFIGURED ORDER, frozen. Nothing was rewritten.
  return { status: 'AVAILABLE', entries: Object.freeze(entries) }
}
