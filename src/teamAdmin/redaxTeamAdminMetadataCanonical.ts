// -----------------------------------------------------------------------------
// WHAT THIS FILE IS
// -----------------------------------------------------------------------------
// The ONE place a `setup_metadata` name, symbol and URI become the exact bytes a
// mutation identity, a durable journal record and a Borsh instruction are built from.
// It is PURE: no UI, no rendering, no React, no environment read, no `VITE_*`, no
// network, no storage, no wallet, no `Connection` and no transaction. It decides
// nothing about hosting, publishes nothing and fetches nothing.
//
// -----------------------------------------------------------------------------
// WHY WELL-FORMEDNESS IS CHECKED BY HAND
// -----------------------------------------------------------------------------
// A JavaScript string is a UTF-16 code-unit sequence, and it is free to carry a LONE
// SURROGATE — a high surrogate with no low one after it, or a low surrogate with no
// high one before it. That is not a character; it is a code unit that cannot be encoded
// to UTF-8 at all. Every UTF-8 encoder in the platform "handles" it the same way: by
// substituting U+FFFD. So an ill-formed input does not fail loudly, it QUIETLY BECOMES
// A DIFFERENT VALUE — and the value that would reach the chain would be one the user
// never typed and never approved.
//
// `String.prototype.isWellFormed()` answers exactly this question, and it is
// deliberately NOT used: the app's committed TypeScript lib is ES2022, which does not
// declare it, so calling it would either fail to compile or require a cast that asserts
// a platform capability this module cannot verify. The explicit scan below is the same
// semantics, written out, with no lib dependency and no cast.
//
// NOTHING IS REPAIRED. An ill-formed input is REFUSED. Substituting U+FFFD would be
// this module inventing a character, and a replacement character that reached a
// permanent, immutable, once-only on-chain metadata account could never be taken back.
//
// -----------------------------------------------------------------------------
// WHY THE URI IS TREATED DIFFERENTLY FROM THE NAME AND THE SYMBOL
// -----------------------------------------------------------------------------
// `name` and `symbol` are HUMAN TEXT, so two visually identical inputs must become one
// value: they are NFC-normalized, and the normalized UTF-8 bytes are the identity.
//
// A URI IS NOT HUMAN TEXT. It is an opaque locator whose bytes are decided by whoever
// operates the host, and every "helpful" transformation changes which document it names:
// NFC would rewrite a path segment, percent-decoding and re-encoding would change which
// octets are escaped, lowercasing would rewrite a case-sensitive path, and reordering a
// query would address a different resource. So the URI is compared and carried as EXACT
// STRING BYTES, and the allowlist question is whether it is EXACTLY one entry of a
// supplied allowlist.
//
// THE PLATFORM PARSER IS AN ORACLE, NEVER A REWRITER. `URL` is consulted to ANSWER
// questions — is this actually parseable, is the scheme really `https:`, does it carry
// credentials — and its normalized output is then DISCARDED. Nothing it produces becomes
// a value: not `href`, not `origin`, not `hostname`, not `pathname`. `URI_IDENTITY` stays
// the ORIGINAL SUPPLIED STRING throughout, which is also what the allowlist is matched
// against and what is hashed and encoded.
//
// It is consulted IN ADDITION to the explicit rules below, not instead of them, because
// the two catch different things. The parser rejects hosts and ports no hand rule
// enumerates — a malformed bracketed host, an out-of-range port — while the hand rules
// reject things the parser cheerfully ACCEPTS, including a bare or non-hex percent escape,
// which WHATWG parsing passes straight through. A URI whose escapes are malformed is one
// whose meaning depends on which client resolves it, and that must not reach a permanent,
// immutable, once-only on-chain metadata account.
//
// A PLATFORM WITHOUT `URL` IS UNAVAILABLE, NOT PERMISSIVE. Absence withholds the answer
// and refuses; it never supplies one.

// --- Program bounds, mirrored ------------------------------------------------
//
// UTF-8 BYTE bounds, matching `MAX_NAME_LENGTH`, `MAX_SYMBOL_LENGTH` and
// `MAX_URI_LENGTH` in `programs/redax_protocol/src/constants.rs`. Rust's `String::len()`
// counts bytes, so a character count would be a different — and sometimes wrong — bound.

/** `name` is `1..=32` UTF-8 bytes on chain. */
export const REDAX_TEAM_ADMIN_METADATA_NAME_MAX_BYTES = 32

/** `symbol` is `1..=10` UTF-8 bytes on chain. */
export const REDAX_TEAM_ADMIN_METADATA_SYMBOL_MAX_BYTES = 10

/** `uri` is `1..=200` UTF-8 bytes on chain. */
export const REDAX_TEAM_ADMIN_METADATA_URI_MAX_BYTES = 200

/** The only scheme an approved metadata URI may carry, spelled exactly. */
const REDAX_REQUIRED_URI_PREFIX = 'https://'

// --- Public vocabulary -------------------------------------------------------

/**
 * Every way canonicalization declines. Value-free, closed and exhaustive.
 *
 * NOT ONE CODE CARRIES A VALUE. A refusal that echoed the offending string would put
 * unreviewed user text into a result object that a caller might render, log or persist
 * — and the whole reason this module exists is that unreviewed text must not travel.
 */
export type RedaxTeamAdminMetadataRefusalCode =
  | 'INPUT_INVALID'
  | 'NAME_ILL_FORMED'
  | 'NAME_BYTE_LENGTH_OUT_OF_RANGE'
  | 'SYMBOL_ILL_FORMED'
  | 'SYMBOL_BYTE_LENGTH_OUT_OF_RANGE'
  | 'URI_ILL_FORMED'
  | 'URI_SCHEME_NOT_HTTPS'
  | 'URI_CREDENTIAL_BEARING'
  | 'URI_BYTE_LENGTH_OUT_OF_RANGE'
  | 'URI_NOT_ALLOWLISTED'
  | 'ALLOWLIST_EMPTY'
  | 'CANONICALIZATION_UNAVAILABLE'

/**
 * One canonical metadata field: the exact string, the exact bytes, and the commitment.
 *
 * `bytes` is memory THIS module owns, freshly allocated. The encoder's own buffer is
 * never handed out, so a caller cannot write through it into a value another caller
 * already committed to.
 */
export interface RedaxTeamAdminCanonicalMetadataFieldV1 {
  /** The exact canonical string — NFC for name and symbol, verbatim for the URI. */
  readonly value: string
  /** Its exact UTF-8 bytes, in memory this module allocated. */
  readonly bytes: Uint8Array
  /** `bytes.length`, carried explicitly so a caller never re-measures it. */
  readonly byteLength: number
  /** Lowercase SHA-256 hex of exactly those bytes. */
  readonly sha256Hex: string
}

/** The three canonical `setup_metadata` fields, together. */
export interface RedaxTeamAdminCanonicalMetadataV1 {
  readonly name: RedaxTeamAdminCanonicalMetadataFieldV1
  readonly symbol: RedaxTeamAdminCanonicalMetadataFieldV1
  readonly uri: RedaxTeamAdminCanonicalMetadataFieldV1
}

/** The raw, unreviewed inputs. Exactly three, and nothing else is accepted. */
export interface RedaxTeamAdminMetadataInput {
  readonly name: string
  readonly symbol: string
  readonly uri: string
}

/**
 * The injected approval policy.
 *
 * `uriAllowlist` defaults to EMPTY, and an empty allowlist refuses every URI. There is
 * no wildcard, no prefix rule, no host rule and no "any https" mode: exact string
 * equality against an enumerated entry is the whole policy, because anything looser
 * would be this module deciding which documents are acceptable.
 */
export interface RedaxTeamAdminMetadataCanonicalizationOptions {
  readonly uriAllowlist?: readonly string[]
}

export type RedaxTeamAdminCanonicalMetadataResult =
  | { readonly ok: true; readonly metadata: RedaxTeamAdminCanonicalMetadataV1 }
  | { readonly ok: false; readonly code: RedaxTeamAdminMetadataRefusalCode }

// --- Well-formed UTF-16 -------------------------------------------------------

const HIGH_SURROGATE_FIRST = 0xd800
const HIGH_SURROGATE_LAST = 0xdbff
const LOW_SURROGATE_FIRST = 0xdc00
const LOW_SURROGATE_LAST = 0xdfff

/**
 * Is every surrogate in this string half of a properly ordered pair?
 *
 * The scan is explicit rather than delegated: a high surrogate must be followed
 * IMMEDIATELY by a low one, and a low surrogate must never appear on its own. Both
 * failures are the same fact — a code unit that has no UTF-8 encoding — and both are
 * refusals rather than substitutions.
 */
function isWellFormedUtf16(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index)
    if (unit >= HIGH_SURROGATE_FIRST && unit <= HIGH_SURROGATE_LAST) {
      const next = index + 1 < value.length ? value.charCodeAt(index + 1) : -1
      if (next < LOW_SURROGATE_FIRST || next > LOW_SURROGATE_LAST) {
        return false
      }
      // The pair is well formed; step over its second half so the low surrogate is not
      // then judged on its own.
      index += 1
      continue
    }
    if (unit >= LOW_SURROGATE_FIRST && unit <= LOW_SURROGATE_LAST) {
      // A low surrogate reached without its high half.
      return false
    }
  }
  return true
}

// --- Platform surfaces, structurally ------------------------------------------
//
// Both are declared structurally rather than against a DOM or Node type, so this module
// compiles identically under the app's DOM lib and under the test runner's Node types
// without importing either and without adding a dependency. A platform that cannot
// perform an operation is UNAVAILABLE, which withholds the answer — it never supplies
// one.

interface RedaxMetadataSubtle {
  readonly subtle: {
    digest(algorithm: string, data: Uint8Array): Promise<ArrayBuffer>
  }
}

function resolveSubtle(): RedaxMetadataSubtle | null {
  const candidate = (globalThis as { crypto?: unknown }).crypto
  if (typeof candidate !== 'object' || candidate === null) {
    return null
  }
  const subtle = (candidate as RedaxMetadataSubtle).subtle
  if (typeof subtle !== 'object' || subtle === null || typeof subtle.digest !== 'function') {
    return null
  }
  return candidate as RedaxMetadataSubtle
}

/** Lowercase SHA-256 hex of exactly these bytes, or null when unavailable. */
async function sha256Hex(platform: RedaxMetadataSubtle, bytes: Uint8Array): Promise<string | null> {
  let digest: ArrayBuffer
  try {
    digest = await platform.subtle.digest('SHA-256', bytes)
  } catch {
    return null
  }
  let out = ''
  for (const byte of new Uint8Array(digest)) {
    out += byte.toString(16).padStart(2, '0')
  }
  return out
}

/**
 * NFC, or nothing.
 *
 * `normalize` is ES2015 and is present everywhere this app runs, but a platform without
 * it must not silently skip normalization: an unnormalized name would be a DIFFERENT
 * identity carrying the same appearance, and two teams could commit to two accounts
 * nobody could tell apart. Absence is therefore unavailability.
 */
function toNfc(value: string): string | null {
  const normalize = (value as { normalize?: unknown }).normalize
  if (typeof normalize !== 'function') {
    return null
  }
  try {
    const normalized = (normalize as (this: string, form: string) => unknown).call(value, 'NFC')
    return typeof normalized === 'string' ? normalized : null
  } catch {
    return null
  }
}

/**
 * UTF-8 bytes in memory this module owns, or null.
 *
 * `TextEncoder` is resolved from `globalThis` structurally for the same reason the
 * digest is, and its output is COPIED: `encode` hands back a buffer the encoder built,
 * and a field this module publishes must not be a view onto anything a later caller
 * could still be holding.
 */
function toUtf8Bytes(value: string): Uint8Array | null {
  const Encoder = (globalThis as { TextEncoder?: unknown }).TextEncoder
  if (typeof Encoder !== 'function') {
    return null
  }
  try {
    const encoder = new (Encoder as new () => { encode(input: string): Uint8Array })()
    const encoded = encoder.encode(value)
    if (!(encoded instanceof Uint8Array)) {
      return null
    }
    return Uint8Array.from(encoded)
  } catch {
    return null
  }
}

// --- The URI structural rules --------------------------------------------------

/** Is this a hexadecimal digit, in either case? Written out — no locale, no regex. */
function isHexDigit(unit: number): boolean {
  return (
    (unit >= 0x30 && unit <= 0x39) ||
    (unit >= 0x41 && unit <= 0x46) ||
    (unit >= 0x61 && unit <= 0x66)
  )
}

/**
 * Is every `%` in this string the start of a complete `%HH` escape?
 *
 * NOTHING IS DECODED. The scan reads the two units after each `%` and answers whether they
 * are hexadecimal; it never converts them to an octet, never re-encodes and never rewrites
 * the string. A bare trailing `%`, a `%` with one following unit, and any non-hex pair are
 * all refusals.
 *
 * WHY IT IS NEEDED AT ALL: WHATWG URL parsing does NOT reject malformed escapes — it
 * carries them through verbatim — so a platform parse succeeding says nothing about them.
 * A URI whose escapes are malformed resolves differently depending on which client reads
 * it, and this account is permanent, immutable and once-only.
 */
function hasWellFormedPercentEscapes(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) !== 0x25) {
      continue
    }
    if (index + 2 >= value.length) {
      return false
    }
    if (!isHexDigit(value.charCodeAt(index + 1)) || !isHexDigit(value.charCodeAt(index + 2))) {
      return false
    }
    // Step over the two hex units so an escape's own payload is never read as a new `%`.
    index += 2
  }
  return true
}

/** The three parsed facts this module asks the platform for — and nothing else. */
interface RedaxParsedUriFacts {
  readonly protocol: string
  readonly username: string
  readonly password: string
}

/**
 * Parse with the platform `URL`, as an ORACLE.
 *
 * `'UNAVAILABLE'` when the platform has no parser, which FAILS CLOSED rather than skipping
 * the question. `'INVALID'` when it throws or hands back something that is not the shape
 * asked for. On success ONLY these three strings are read, and the normalized `href`,
 * `origin`, `hostname`, `pathname` and `search` are never touched — reading one and
 * carrying it forward is exactly the rewrite this module exists to prevent.
 */
function parseUriFacts(value: string): RedaxParsedUriFacts | 'UNAVAILABLE' | 'INVALID' {
  const Parser = (globalThis as { URL?: unknown }).URL
  if (typeof Parser !== 'function') {
    return 'UNAVAILABLE'
  }
  let parsed: unknown
  try {
    parsed = new (Parser as new (input: string) => unknown)(value)
  } catch {
    return 'INVALID'
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return 'INVALID'
  }
  const facts = parsed as { protocol?: unknown; username?: unknown; password?: unknown }
  if (
    typeof facts.protocol !== 'string' ||
    typeof facts.username !== 'string' ||
    typeof facts.password !== 'string'
  ) {
    return 'INVALID'
  }
  return { protocol: facts.protocol, username: facts.username, password: facts.password }
}

/**
 * Is this URI structurally acceptable, BEFORE the allowlist is consulted?
 *
 * NOTHING HERE REWRITES THE VALUE. Every rule is a question answered about the exact
 * supplied string, and the answer is either "acceptable" or a refusal code. The string that
 * leaves this module is the string that entered it.
 *
 * The explicit rules, each a refusal:
 *
 *   * the scheme is EXACTLY the lowercase `https://` (an uppercase or mixed spelling is
 *     refused rather than lowercased, because lowercasing is a rewrite);
 *   * no C0 control, DEL or space appears anywhere (they cannot appear in a URI, and a
 *     platform that trimmed one would change the identity);
 *   * every `%` begins a complete `%HH` escape, which the platform parser does NOT check;
 *   * the AUTHORITY carries no `@`, which is what a credential-bearing URL looks like.
 *
 * Then the platform parse, as an oracle over the same exact string:
 *
 *   * it must parse at all — which is what rejects a malformed bracketed host and an
 *     out-of-range port, neither of which any rule above enumerates;
 *   * its `protocol` must be exactly `https:`;
 *   * its `username` and `password` must both be empty, which closes any credential form
 *     the authority scan above did not see.
 *
 * ORDER MATTERS. The explicit rules run FIRST, so a credential-bearing or control-bearing
 * value is named by its own specific code rather than by whatever the parser happened to
 * think of it.
 */
function classifyUriStructure(
  value: string,
): { readonly ok: true } | { readonly ok: false; readonly code: RedaxTeamAdminMetadataRefusalCode } {
  if (!value.startsWith(REDAX_REQUIRED_URI_PREFIX)) {
    return { ok: false, code: 'URI_SCHEME_NOT_HTTPS' }
  }
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index)
    if (unit <= 0x20 || unit === 0x7f) {
      return { ok: false, code: 'URI_ILL_FORMED' }
    }
  }
  if (!hasWellFormedPercentEscapes(value)) {
    return { ok: false, code: 'URI_ILL_FORMED' }
  }
  const authorityStart = REDAX_REQUIRED_URI_PREFIX.length
  let authorityEnd = value.length
  for (let index = authorityStart; index < value.length; index += 1) {
    const character = value[index]
    if (character === '/' || character === '?' || character === '#') {
      authorityEnd = index
      break
    }
  }
  const authority = value.slice(authorityStart, authorityEnd)
  if (authority.length === 0) {
    return { ok: false, code: 'URI_ILL_FORMED' }
  }
  if (authority.includes('@')) {
    return { ok: false, code: 'URI_CREDENTIAL_BEARING' }
  }
  const parsed = parseUriFacts(value)
  if (parsed === 'UNAVAILABLE') {
    // FAIL CLOSED. A platform that cannot answer the question does not get to skip it.
    return { ok: false, code: 'CANONICALIZATION_UNAVAILABLE' }
  }
  if (parsed === 'INVALID') {
    return { ok: false, code: 'URI_ILL_FORMED' }
  }
  if (parsed.protocol !== 'https:') {
    return { ok: false, code: 'URI_SCHEME_NOT_HTTPS' }
  }
  if (parsed.username !== '' || parsed.password !== '') {
    return { ok: false, code: 'URI_CREDENTIAL_BEARING' }
  }
  return { ok: true }
}

// --- The one exported canonicalization ------------------------------------------

/**
 * Turn three raw inputs into three canonical fields, or refuse.
 *
 * THE ORDER IS THE ARGUMENT. Well-formedness is decided FIRST for every field, because
 * every later step — normalization, encoding, measuring, hashing — either silently
 * substitutes for an ill-formed unit or produces a value derived from that
 * substitution. Then the two human fields are normalized and bounded, and only then is
 * the URI structurally judged and matched against the allowlist.
 *
 * The allowlist is consulted LAST, and against the exact original string. Matching a
 * normalized or re-encoded value against the allowlist would be matching a value nobody
 * approved.
 *
 * TOTAL AND VALUE-FREE. Nothing throws, nothing is logged, nothing is stored, and no
 * refusal carries a fragment of the input.
 */
export async function canonicalizeRedaxTeamAdminMetadata(
  input: RedaxTeamAdminMetadataInput,
  options: RedaxTeamAdminMetadataCanonicalizationOptions = {},
): Promise<RedaxTeamAdminCanonicalMetadataResult> {
  if (
    typeof input !== 'object' ||
    input === null ||
    typeof input.name !== 'string' ||
    typeof input.symbol !== 'string' ||
    typeof input.uri !== 'string'
  ) {
    return { ok: false, code: 'INPUT_INVALID' }
  }

  const allowlistInput = options.uriAllowlist
  if (allowlistInput !== undefined && !Array.isArray(allowlistInput)) {
    return { ok: false, code: 'INPUT_INVALID' }
  }
  // The DEFAULT IS EMPTY, and an empty allowlist refuses everything. Stated as its own
  // code so an unconfigured deployment is distinguishable from a rejected URI.
  const allowlist: readonly string[] = allowlistInput === undefined ? [] : allowlistInput
  for (const entry of allowlist) {
    if (typeof entry !== 'string') {
      return { ok: false, code: 'INPUT_INVALID' }
    }
  }
  if (allowlist.length === 0) {
    return { ok: false, code: 'ALLOWLIST_EMPTY' }
  }

  // 1. WELL-FORMEDNESS, for all three, before anything is transformed.
  if (!isWellFormedUtf16(input.name)) {
    return { ok: false, code: 'NAME_ILL_FORMED' }
  }
  if (!isWellFormedUtf16(input.symbol)) {
    return { ok: false, code: 'SYMBOL_ILL_FORMED' }
  }
  if (!isWellFormedUtf16(input.uri)) {
    return { ok: false, code: 'URI_ILL_FORMED' }
  }

  const platform = resolveSubtle()
  if (platform === null) {
    return { ok: false, code: 'CANONICALIZATION_UNAVAILABLE' }
  }

  // 2. THE HUMAN FIELDS: NFC, then UTF-8, then the program's byte bounds.
  const nameNfc = toNfc(input.name)
  const symbolNfc = toNfc(input.symbol)
  if (nameNfc === null || symbolNfc === null) {
    return { ok: false, code: 'CANONICALIZATION_UNAVAILABLE' }
  }
  const nameBytes = toUtf8Bytes(nameNfc)
  const symbolBytes = toUtf8Bytes(symbolNfc)
  if (nameBytes === null || symbolBytes === null) {
    return { ok: false, code: 'CANONICALIZATION_UNAVAILABLE' }
  }
  if (nameBytes.length < 1 || nameBytes.length > REDAX_TEAM_ADMIN_METADATA_NAME_MAX_BYTES) {
    return { ok: false, code: 'NAME_BYTE_LENGTH_OUT_OF_RANGE' }
  }
  if (symbolBytes.length < 1 || symbolBytes.length > REDAX_TEAM_ADMIN_METADATA_SYMBOL_MAX_BYTES) {
    return { ok: false, code: 'SYMBOL_BYTE_LENGTH_OUT_OF_RANGE' }
  }

  // 3. THE URI: exact string identity throughout. Structure — including the platform
  //    parse oracle, whose normalized output is discarded — then bytes, then bounds, then
  //    exact allowlist membership. Every one of those is a question about `input.uri`, and
  //    `input.uri` is what is carried forward.
  const structure = classifyUriStructure(input.uri)
  if (!structure.ok) {
    return { ok: false, code: structure.code }
  }
  const uriBytes = toUtf8Bytes(input.uri)
  if (uriBytes === null) {
    return { ok: false, code: 'CANONICALIZATION_UNAVAILABLE' }
  }
  if (uriBytes.length < 1 || uriBytes.length > REDAX_TEAM_ADMIN_METADATA_URI_MAX_BYTES) {
    return { ok: false, code: 'URI_BYTE_LENGTH_OUT_OF_RANGE' }
  }
  // EXACT STRING EQUALITY, against the string as supplied. No normalization, no
  // decoding, no case folding and no prefix rule participates.
  let allowed = false
  for (const entry of allowlist) {
    if (entry === input.uri) {
      allowed = true
      break
    }
  }
  if (!allowed) {
    return { ok: false, code: 'URI_NOT_ALLOWLISTED' }
  }

  // 4. The three commitments, over exactly the bytes above.
  const nameSha = await sha256Hex(platform, nameBytes)
  const symbolSha = await sha256Hex(platform, symbolBytes)
  const uriSha = await sha256Hex(platform, uriBytes)
  if (nameSha === null || symbolSha === null || uriSha === null) {
    return { ok: false, code: 'CANONICALIZATION_UNAVAILABLE' }
  }

  return {
    ok: true,
    metadata: Object.freeze({
      name: Object.freeze({
        value: nameNfc,
        bytes: nameBytes,
        byteLength: nameBytes.length,
        sha256Hex: nameSha,
      }),
      symbol: Object.freeze({
        value: symbolNfc,
        bytes: symbolBytes,
        byteLength: symbolBytes.length,
        sha256Hex: symbolSha,
      }),
      uri: Object.freeze({
        value: input.uri,
        bytes: uriBytes,
        byteLength: uriBytes.length,
        sha256Hex: uriSha,
      }),
    }),
  }
}

// --- Expected stored (puffed) payloads -------------------------------------------

/**
 * The exact fixed widths the Metaplex metadata program stores each string at.
 *
 * The program PUFFS: it pads each string with trailing NUL bytes to a fixed width, so
 * the stored account cannot uniquely recover what was asked for. That is why these are
 * used in ONE direction only — expected canonical bytes are padded FORWARD and compared
 * against what is stored — and never inverted.
 */
const PUFFED_NAME_BYTES = 32
const PUFFED_SYMBOL_BYTES = 10
const PUFFED_URI_BYTES = 200

/** The three expected stored payloads, as exact bytes. */
export interface RedaxTeamAdminExpectedPuffedMetadataV1 {
  readonly name: Uint8Array
  readonly symbol: Uint8Array
  readonly uri: Uint8Array
}

/**
 * Pad the canonical bytes forward to the exact stored widths.
 *
 * TRUNCATION IS UNREACHABLE AND IS NOT PERFORMED. The canonical fields already satisfy
 * the program's bounds — `32`, `10` and `200` — so padding is total. A value that would
 * need truncating never reaches here, because canonicalization refused it, and a silent
 * trim would compare equal to a value nobody requested.
 *
 * `null` when a field somehow exceeds its width, which is a refusal rather than a trim.
 */
export function expectedRedaxTeamAdminPuffedMetadata(
  metadata: RedaxTeamAdminCanonicalMetadataV1,
): RedaxTeamAdminExpectedPuffedMetadataV1 | null {
  const pad = (bytes: Uint8Array, width: number): Uint8Array | null => {
    if (bytes.length > width) {
      return null
    }
    // Zero-filled by construction, so the trailing NUL padding is the allocation itself.
    const out = new Uint8Array(width)
    out.set(bytes, 0)
    return out
  }
  const name = pad(metadata.name.bytes, PUFFED_NAME_BYTES)
  const symbol = pad(metadata.symbol.bytes, PUFFED_SYMBOL_BYTES)
  const uri = pad(metadata.uri.bytes, PUFFED_URI_BYTES)
  if (name === null || symbol === null || uri === null) {
    return null
  }
  return Object.freeze({ name, symbol, uri })
}
