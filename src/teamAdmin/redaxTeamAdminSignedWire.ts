// REDAX Team/Admin S1 fixed two-signature verifier — exactly two signers, or nothing.
//
// -----------------------------------------------------------------------------
// WHAT THIS IS FOR
// -----------------------------------------------------------------------------
// One question, asked about one artifact: is this wallet-returned wire EXACTLY the
// Team/Admin S1 transaction REDAX committed to, carrying EXACTLY the two signatures it
// requires, both cryptographically valid over EXACTLY the bytes that were signed?
//
// The answer is used to decide that no broadcast may happen. That is not a weaker use
// than authorizing one — it is the same fact — so nothing here is best-effort: a
// verdict this module cannot prove is a refusal, and unavailability is a third answer
// that is never folded into either of the other two.
//
// -----------------------------------------------------------------------------
// WHY A SECOND PARSER, AND WHY IT IS NOT PARAMETERIZED
// -----------------------------------------------------------------------------
// The Holder verifier is FIXED at exactly one required signer: that count governs its
// minimum wire length, its wire split and its header check. Sharing it would mean
// making the signature count a parameter — and a parameterized N-signer verifier is
// precisely the generic capability the Team/Admin `partialSign` exception was narrowed
// to avoid. Two fixed verifiers, each unable to express the other's topology, is a
// smaller surface than one flexible verifier that can express both.
//
// So this module imports NOTHING from the Holder verifier, exports no signer count
// parameter, and has no code path that would accept one signature or three.
//
// -----------------------------------------------------------------------------
// BOUNDARY
// -----------------------------------------------------------------------------
// PURE, AND ALMOST IMPORT-FREE. No React, no `Connection`, no `Transaction`, no wallet,
// no adapter, no storage, no journal, no logging, no network, no clock and no entropy.
// It cannot send, sign, re-sign or re-serialize anything: it reads bytes it was given
// and compares them with bytes it was given.
//
// NOTHING IS RECONSTRUCTED. The message region is taken from the wire itself — it is
// the exact byte range the signatures were computed over — so there is no second
// compilation anywhere that could disagree with it, and no normalization step that
// could turn a real wallet mutation into a match.

/** The Team/Admin S1 topology: the Team wallet, and the ephemeral output mint. */
const REDAX_TEAM_ADMIN_REQUIRED_SIGNATURES = 2

/** An ed25519 signature, exactly. */
const REDAX_SIGNATURE_BYTES = 64

/** A public key, and a blockhash, are both exactly this wide on the wire. */
const REDAX_WIRE_KEY_BYTES = 32

/** A compact-u16 never spends more than three bytes, by construction. */
const REDAX_COMPACT_U16_MAX_BYTES = 3

/** A compact-u16 byte sets its high bit when another byte follows. */
const REDAX_COMPACT_U16_CONTINUATION = 0x80

/** Below this a compact-u16 value is one byte; from here up a second is required. */
const REDAX_COMPACT_U16_ONE_BYTE_LIMIT = 0x80

/** Below this a compact-u16 value is two bytes; from here up a third is required. */
const REDAX_COMPACT_U16_TWO_BYTE_LIMIT = 0x4000

/** The widest value a compact-u16 can carry at all. */
const REDAX_COMPACT_U16_MAX_VALUE = 0xffff

/** The message header: required signers, readonly signed, readonly unsigned. */
const REDAX_MESSAGE_HEADER_BYTES = 3

/** A versioned message sets the high bit of its first byte. A legacy one never does. */
const REDAX_MESSAGE_VERSION_FLAG = 0x80

/** Two signature counts, two signatures, one header — below this nothing can parse. */
const REDAX_MIN_SIGNED_WIRE_BYTES =
  1 + REDAX_SIGNATURE_BYTES * REDAX_TEAM_ADMIN_REQUIRED_SIGNATURES + REDAX_MESSAGE_HEADER_BYTES

/** The on-chain packet size. A wire above it could not be broadcast in any case. */
const REDAX_MAX_SIGNED_WIRE_BYTES = 1232

/** The exact algorithm both S1 signatures are, named once. */
const REDAX_SIGNATURE_ALGORITHM = 'Ed25519'

/** The exact number of instructions an S1 message carries. */
const REDAX_TEAM_ADMIN_S1_INSTRUCTION_COUNT = 4

/** The signer slot the fee-paying Team wallet occupies. */
const REDAX_TEAM_WALLET_SLOT = 0

/** The signer slot the ephemeral output mint occupies. */
const REDAX_OUTPUT_MINT_SLOT = 1

// --- Public vocabulary --------------------------------------------------------

/** Every way this verifier can decline. Value-free, closed and exhaustive. */
export type RedaxTeamAdminSignedWireRefusalCode =
  | 'INPUT_INVALID'
  | 'WIRE_UNREADABLE'
  | 'SIGNATURE_COUNT_NOT_TWO'
  | 'MESSAGE_UNREADABLE'
  | 'MESSAGE_VERSIONED'
  | 'REQUIRED_SIGNATURES_NOT_TWO'
  | 'TEAM_WALLET_SLOT_MISMATCH'
  | 'OUTPUT_MINT_SLOT_MISMATCH'
  | 'MESSAGE_BYTE_LENGTH_MISMATCH'
  | 'MESSAGE_DIGEST_MISMATCH'
  | 'MESSAGE_BYTES_MISMATCH'
  | 'MESSAGE_STRUCTURE_MISMATCH'
  | 'TEAM_SIGNATURE_PLACEHOLDER'
  | 'OUTPUT_MINT_SIGNATURE_PLACEHOLDER'
  | 'TEAM_SIGNATURE_INVALID'
  | 'OUTPUT_MINT_SIGNATURE_INVALID'
  | 'VERIFICATION_UNAVAILABLE'

/**
 * Exactly the facts the verifier needs, and not one more.
 *
 * There is no `Transaction`, no `Connection`, no keypair and no adapter here, because
 * none of them is a fact about the artifact. The intended message arrives as BYTES plus
 * the commitment REDAX already took over those bytes, so the comparison is against
 * something that was frozen before the wallet ever saw it.
 */
export interface RedaxTeamAdminSignedWireRequest {
  /** The exact bytes the wallet returned. Copied on entry; never mutated. */
  readonly wire: Uint8Array
  /** The approved Team wallet, as raw 32 public-key bytes. It is also the fee payer. */
  readonly teamWallet: Uint8Array
  /** The frozen ephemeral output mint, as raw 32 public-key bytes. */
  readonly outputMint: Uint8Array
  /** The exact legacy message REDAX compiled and committed to, before any signature. */
  readonly intendedMessage: Uint8Array
  /** That message's frozen byte length. Compared before anything is hashed. */
  readonly intendedMessageByteLength: number
  /** That message's frozen lowercase SHA-256 hex. */
  readonly intendedMessageSha256Hex: string
}

/**
 * A verified S1 artifact.
 */
export interface RedaxTeamAdminVerifiedSignedWireV1 {
  readonly ok: true
  readonly knownSignatureBase58: string
}

export type RedaxTeamAdminSignedWireResult =
  | RedaxTeamAdminVerifiedSignedWireV1
  | { readonly ok: false; readonly code: RedaxTeamAdminSignedWireRefusalCode }

// --- Byte helpers -------------------------------------------------------------

/** Exact equality of two byte sequences. Length first, then every element. */
function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) {
    return false
  }
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false
    }
  }
  return true
}

/**
 * A signature slot the installed serializer fills with zeroes when nothing signed it.
 *
 * Serializing without requiring all signatures is what lets a partially signed artifact
 * be INSPECTED instead of throwing — and the placeholder that makes that possible must
 * then be refused explicitly, per slot, so "the mint never signed" and "the wallet
 * never signed" are different answers.
 */
function isPlaceholderSignature(signature: Uint8Array): boolean {
  for (const byte of signature) {
    if (byte !== 0) {
      return false
    }
  }
  return true
}

/**
 * The one canonical width of a compact-u16 value, derived from the value itself.
 *
 * A compact-u16 byte carries seven payload bits and sets its high bit when another
 * follows, so a value can be SPELLED more than one way: `02` and `82 00` both decode to
 * 2. Only the shortest spelling is its encoding.
 */
function canonicalCompactU16Length(value: number): number {
  if (value < REDAX_COMPACT_U16_ONE_BYTE_LIMIT) {
    return 1
  }
  return value < REDAX_COMPACT_U16_TWO_BYTE_LIMIT ? 2 : 3
}

/**
 * One compact-u16 at `offset`, with the offset just past it — or null.
 *
 * ONLY THE CANONICAL MINIMAL ENCODING IS READABLE, and that is a security property
 * rather than tidiness. The compact-u16 prefixes on this wire are NOT covered by either
 * signature: a wallet can widen the outer signature count from `02` to `82 00` and
 * leave both 64-byte signatures and the exact signed message untouched. Such a wire
 * still carries valid Ed25519 relations over the intended message, so byte equality and
 * both signature checks would pass on a wire whose bytes REDAX never approved.
 *
 * The rule is stated as a length equality — decode safely, derive the canonical width
 * FROM THE DECODED VALUE, then require the consumed bytes to be exactly that — because
 * that is the whole property rather than a sample of it.
 *
 * NOTHING IS REPAIRED HERE. An overlong spelling is refused, never rewritten.
 */
function readCompactU16(bytes: Uint8Array, offset: number): { value: number; next: number } | null {
  let value = 0
  let shift = 0
  let cursor = offset
  for (let step = 0; step < REDAX_COMPACT_U16_MAX_BYTES; step += 1) {
    if (cursor >= bytes.length) {
      return null
    }
    const byte = bytes[cursor]
    cursor += 1
    value += (byte & 0x7f) * 2 ** shift
    if ((byte & REDAX_COMPACT_U16_CONTINUATION) === 0) {
      // The value bound is decided FIRST: above it there is no canonical width for the
      // comparison below to be against, and a three-byte overflow would otherwise match
      // the three-byte answer and be admitted.
      if (value > REDAX_COMPACT_U16_MAX_VALUE) {
        return null
      }
      return cursor - offset === canonicalCompactU16Length(value) ? { value, next: cursor } : null
    }
    shift += 7
  }
  // Still continuing after the third byte: an encoding this format cannot terminate.
  return null
}

// --- Base58, locally ----------------------------------------------------------

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'

/**
 * Encode the 64 signature bytes as base58, without a dependency.
 *
 * The Holder route reaches for the installed `bs58`; this module deliberately acquires
 * nothing at all, and one fixed-length encoder is smaller than an import that would
 * make this file's dependency footprint non-zero for one string. Leading zero bytes
 * become leading `1`s, which is the encoding rather than a special case.
 */
function encodeBase58(bytes: Uint8Array): string {
  // Starts EMPTY rather than at `[0]`. With a seeded zero digit an all-zero input would
  // emit one `1` too many — unreachable here, because a placeholder signature is refused
  // before anything is encoded, but a latent wrong answer is not worth keeping.
  const digits: number[] = []
  for (const byte of bytes) {
    let carry = byte
    for (let index = 0; index < digits.length; index += 1) {
      carry += digits[index] << 8
      digits[index] = carry % 58
      carry = (carry / 58) | 0
    }
    while (carry > 0) {
      digits.push(carry % 58)
      carry = (carry / 58) | 0
    }
  }
  let leadingZeros = 0
  while (leadingZeros < bytes.length && bytes[leadingZeros] === 0) {
    leadingZeros += 1
  }
  let out = '1'.repeat(leadingZeros)
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    out += BASE58_ALPHABET[digits[index]]
  }
  return out
}

// --- Structural wire and message reading ---------------------------------------

/** The signed wire, split into its exact regions. Neither is reconstructed. */
interface TeamAdminSignedWire {
  readonly signatures: readonly Uint8Array[]
  readonly message: Uint8Array
}

/**
 * Split one signed legacy wire into its TWO signatures and its EXACT signed message.
 *
 * The count is required to be exactly two here rather than read and judged later: a
 * wire carrying one or three signatures is not an under-verified S1 artifact, it is a
 * different transaction shape, and this module has no representation for one.
 */
function parseTeamAdminSignedWire(
  wire: Uint8Array,
): { readonly ok: true; readonly wire: TeamAdminSignedWire } | { readonly ok: false; readonly code: RedaxTeamAdminSignedWireRefusalCode } {
  if (wire.length < REDAX_MIN_SIGNED_WIRE_BYTES || wire.length > REDAX_MAX_SIGNED_WIRE_BYTES) {
    return { ok: false, code: 'WIRE_UNREADABLE' }
  }
  const count = readCompactU16(wire, 0)
  if (count === null) {
    return { ok: false, code: 'WIRE_UNREADABLE' }
  }
  if (count.value !== REDAX_TEAM_ADMIN_REQUIRED_SIGNATURES) {
    return { ok: false, code: 'SIGNATURE_COUNT_NOT_TWO' }
  }
  const messageStart = count.next + REDAX_SIGNATURE_BYTES * count.value
  if (messageStart + REDAX_MESSAGE_HEADER_BYTES > wire.length) {
    return { ok: false, code: 'WIRE_UNREADABLE' }
  }
  const signatures: Uint8Array[] = []
  for (let index = 0; index < count.value; index += 1) {
    const start = count.next + REDAX_SIGNATURE_BYTES * index
    signatures.push(wire.slice(start, start + REDAX_SIGNATURE_BYTES))
  }
  return { ok: true, wire: { signatures, message: wire.slice(messageStart) } }
}

/** One instruction, exactly as the wire carries it. */
interface TeamAdminWireInstruction {
  readonly programIdIndex: number
  readonly accountIndexes: Uint8Array
  readonly data: Uint8Array
}

/** One legacy message, structurally. Every field is a byte range, never a decoding. */
interface TeamAdminWireMessage {
  readonly requiredSignatures: number
  readonly readonlySigned: number
  readonly readonlyUnsigned: number
  readonly accountKeys: readonly Uint8Array[]
  readonly recentBlockhash: Uint8Array
  readonly instructions: readonly TeamAdminWireInstruction[]
}

/**
 * Read one legacy message's structure, or refuse.
 *
 * Every read is bounds-checked and the message must end EXACTLY where its last
 * instruction does: trailing bytes are a shape nobody decided on, and a parser that
 * ignored them could accept a message carrying something it never looked at.
 */
function parseTeamAdminWireMessage(message: Uint8Array): TeamAdminWireMessage | null {
  if (message.length < REDAX_MESSAGE_HEADER_BYTES) {
    return null
  }
  if ((message[0] & REDAX_MESSAGE_VERSION_FLAG) !== 0) {
    // A versioned message. Provably not the legacy message REDAX built.
    return null
  }
  const requiredSignatures = message[0]
  const readonlySigned = message[1]
  const readonlyUnsigned = message[2]

  const accountCount = readCompactU16(message, REDAX_MESSAGE_HEADER_BYTES)
  if (accountCount === null || accountCount.value === 0) {
    return null
  }
  let cursor = accountCount.next
  const accountKeys: Uint8Array[] = []
  for (let index = 0; index < accountCount.value; index += 1) {
    if (cursor + REDAX_WIRE_KEY_BYTES > message.length) {
      return null
    }
    accountKeys.push(message.slice(cursor, cursor + REDAX_WIRE_KEY_BYTES))
    cursor += REDAX_WIRE_KEY_BYTES
  }

  if (cursor + REDAX_WIRE_KEY_BYTES > message.length) {
    return null
  }
  const recentBlockhash = message.slice(cursor, cursor + REDAX_WIRE_KEY_BYTES)
  cursor += REDAX_WIRE_KEY_BYTES

  const instructionCount = readCompactU16(message, cursor)
  if (instructionCount === null) {
    return null
  }
  cursor = instructionCount.next
  const instructions: TeamAdminWireInstruction[] = []
  for (let index = 0; index < instructionCount.value; index += 1) {
    if (cursor >= message.length) {
      return null
    }
    const programIdIndex = message[cursor]
    cursor += 1
    const accountIndexCount = readCompactU16(message, cursor)
    if (
      accountIndexCount === null ||
      accountIndexCount.next + accountIndexCount.value > message.length
    ) {
      return null
    }
    const accountIndexes = message.slice(
      accountIndexCount.next,
      accountIndexCount.next + accountIndexCount.value,
    )
    cursor = accountIndexCount.next + accountIndexCount.value
    const dataLength = readCompactU16(message, cursor)
    if (dataLength === null || dataLength.next + dataLength.value > message.length) {
      return null
    }
    const data = message.slice(dataLength.next, dataLength.next + dataLength.value)
    cursor = dataLength.next + dataLength.value
    instructions.push({ programIdIndex, accountIndexes, data })
  }
  if (cursor !== message.length) {
    return null
  }
  return {
    requiredSignatures,
    readonlySigned,
    readonlyUnsigned,
    accountKeys,
    recentBlockhash,
    instructions,
  }
}

/**
 * Are two parsed legacy messages the SAME message, field by field?
 *
 * Written out rather than folded into the byte comparison, because the byte comparison
 * answers "are these identical" while this answers "and here is exactly what would have
 * differed": an added or removed instruction, a reordered account, a changed payer, a
 * changed blockhash, a rewritten instruction payload. Both run, and neither substitutes
 * for the other.
 */
function wireMessagesEqual(left: TeamAdminWireMessage, right: TeamAdminWireMessage): boolean {
  if (
    left.requiredSignatures !== right.requiredSignatures ||
    left.readonlySigned !== right.readonlySigned ||
    left.readonlyUnsigned !== right.readonlyUnsigned ||
    left.accountKeys.length !== right.accountKeys.length ||
    left.instructions.length !== right.instructions.length ||
    !bytesEqual(left.recentBlockhash, right.recentBlockhash)
  ) {
    return false
  }
  for (let index = 0; index < left.accountKeys.length; index += 1) {
    if (!bytesEqual(left.accountKeys[index], right.accountKeys[index])) {
      return false
    }
  }
  for (let index = 0; index < left.instructions.length; index += 1) {
    const one = left.instructions[index]
    const other = right.instructions[index]
    if (
      one.programIdIndex !== other.programIdIndex ||
      !bytesEqual(one.accountIndexes, other.accountIndexes) ||
      !bytesEqual(one.data, other.data)
    ) {
      return false
    }
  }
  return true
}

// --- Web Crypto, structurally ---------------------------------------------------

/**
 * Minimal structural view of the Web Crypto surface this module uses.
 *
 * Typed structurally so this module compiles identically under the app's DOM lib and
 * under the test runner's Node types, without importing either and without adding a
 * dependency. A platform that cannot perform these operations is UNAVAILABLE, which
 * withholds the verdict — it never supplies one.
 */
interface RedaxTeamAdminSubtle {
  readonly subtle: {
    digest(algorithm: string, data: Uint8Array): Promise<ArrayBuffer>
    importKey(
      format: 'raw',
      keyData: Uint8Array,
      algorithm: string,
      extractable: boolean,
      keyUsages: readonly string[],
    ): Promise<unknown>
    verify(algorithm: string, key: unknown, signature: Uint8Array, data: Uint8Array): Promise<unknown>
  }
}

function resolveSubtle(): RedaxTeamAdminSubtle | null {
  const candidate = (globalThis as { crypto?: unknown }).crypto
  if (typeof candidate !== 'object' || candidate === null) {
    return null
  }
  const subtle = (candidate as RedaxTeamAdminSubtle).subtle
  if (
    typeof subtle !== 'object' ||
    subtle === null ||
    typeof subtle.digest !== 'function' ||
    typeof subtle.importKey !== 'function' ||
    typeof subtle.verify !== 'function'
  ) {
    return null
  }
  return candidate as RedaxTeamAdminSubtle
}

/** What a cryptographic check concluded. `UNAVAILABLE` is never a pass. */
type SignatureVerdict = 'VALID' | 'INVALID' | 'UNAVAILABLE'

/**
 * Verify ONE ed25519 signature against the EXACT extracted signed-message bytes.
 *
 * A non-boolean answer is not a pass: a platform that returns something else is one
 * this file does not understand, and not understanding is unavailability.
 */
async function verifyEd25519(
  platform: RedaxTeamAdminSubtle,
  publicKey: Uint8Array,
  signature: Uint8Array,
  message: Uint8Array,
): Promise<SignatureVerdict> {
  let key: unknown
  try {
    key = await platform.subtle.importKey('raw', publicKey, REDAX_SIGNATURE_ALGORITHM, false, [
      'verify',
    ])
  } catch {
    return 'UNAVAILABLE'
  }
  let verified: unknown
  try {
    verified = await platform.subtle.verify(REDAX_SIGNATURE_ALGORITHM, key, signature, message)
  } catch {
    return 'UNAVAILABLE'
  }
  if (typeof verified !== 'boolean') {
    return 'UNAVAILABLE'
  }
  return verified ? 'VALID' : 'INVALID'
}

/** Lowercase SHA-256 hex of exactly these bytes, or null when unavailable. */
async function sha256Hex(platform: RedaxTeamAdminSubtle, bytes: Uint8Array): Promise<string | null> {
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

// --- The intended-message commitment ---------------------------------------------

/** One frozen commitment to one compiled legacy message. */
export interface RedaxTeamAdminIntendedMessageCommitmentV1 {
  readonly kind: 'redax-intended-legacy-message-sha256-v1'
  readonly byteLength: number
  readonly sha256Hex: string
}

export type RedaxTeamAdminIntendedMessageCommitmentResult =
  | { readonly ok: true; readonly commitment: RedaxTeamAdminIntendedMessageCommitmentV1 }
  | { readonly ok: false }

/**
 * Commit to the exact compiled legacy message, ONCE, before any signature exists.
 *
 * It lives beside the verifier deliberately. The committer and the checker have to
 * agree byte for byte and digest for digest, so they use ONE digest implementation
 * rather than two that happen to match today: a second copy elsewhere would be free to
 * drift, and the failure it produced would look exactly like a wallet mutation.
 *
 * The Holder's outcome module answers the same question for the Holder route and is
 * deliberately NOT imported here — the Team/Admin tree acquires none of it, because
 * that module also carries known-signature and landed-message reasoning this route must
 * not have.
 *
 * A platform without the digest is UNAVAILABLE, which stops the attempt. It is never a
 * commitment nobody can check.
 */
export async function commitRedaxTeamAdminIntendedLegacyMessage(
  message: Uint8Array,
): Promise<RedaxTeamAdminIntendedMessageCommitmentResult> {
  if (!(message instanceof Uint8Array) || message.length === 0) {
    return { ok: false }
  }
  const platform = resolveSubtle()
  if (platform === null) {
    return { ok: false }
  }
  const digest = await sha256Hex(platform, message)
  if (digest === null) {
    return { ok: false }
  }
  return {
    ok: true,
    commitment: Object.freeze({
      kind: 'redax-intended-legacy-message-sha256-v1' as const,
      byteLength: message.length,
      sha256Hex: digest,
    }),
  }
}

// --- The one exported verification ----------------------------------------------

/** Is this a plausible raw 32-byte public key? A length question, not an identity one. */
function isWireKey(value: unknown): value is Uint8Array {
  return value instanceof Uint8Array && value.length === REDAX_WIRE_KEY_BYTES
}

/**
 * Verify one Team/Admin S1 signed wire against the exact committed message.
 *
 * THE ORDER IS THE ARGUMENT. Readability is decided first, so "unreadable" is only ever
 * said about something that really could not be parsed. Then the fixed topology, then
 * the message identity asked three ways (length, digest, bytes) and once structurally,
 * and only then the two cryptographic checks. Every step names what differed, because a
 * refusal that cannot say what was wrong is a refusal nobody can act on.
 *
 * NOTHING IS SERIALIZED, COMPILED OR NORMALIZED HERE. The provider performed the one
 * serialization; this copies, slices and reads.
 */
export async function verifyRedaxTeamAdminS1SignedWire(
  request: RedaxTeamAdminSignedWireRequest,
): Promise<RedaxTeamAdminSignedWireResult> {
  if (
    !(request.wire instanceof Uint8Array) ||
    !isWireKey(request.teamWallet) ||
    !isWireKey(request.outputMint) ||
    !(request.intendedMessage instanceof Uint8Array) ||
    !Number.isSafeInteger(request.intendedMessageByteLength) ||
    request.intendedMessageByteLength <= 0 ||
    typeof request.intendedMessageSha256Hex !== 'string' ||
    !/^[0-9a-f]{64}$/.test(request.intendedMessageSha256Hex)
  ) {
    return { ok: false, code: 'INPUT_INVALID' }
  }
  if (bytesEqual(request.teamWallet, request.outputMint)) {
    // Two required signers that are the same key is not the S1 topology at all — and it
    // would make the two slot checks below indistinguishable from one.
    return { ok: false, code: 'INPUT_INVALID' }
  }

  // The verifier's OWN copy. Everything from here on is memory this module owns; the
  // value the caller handed over is never read again.
  const wire = Uint8Array.from(request.wire)

  const split = parseTeamAdminSignedWire(wire)
  if (!split.ok) {
    return { ok: false, code: split.code }
  }
  const signed = parseTeamAdminWireMessage(split.wire.message)
  if (signed === null) {
    // Unparseable OR versioned. A versioned message is a provable difference from the
    // legacy message REDAX committed to — but it must not be reported as an unreadable
    // artifact, because those are different facts about the wallet.
    return {
      ok: false,
      code:
        (split.wire.message[0] & REDAX_MESSAGE_VERSION_FLAG) !== 0
          ? 'MESSAGE_VERSIONED'
          : 'MESSAGE_UNREADABLE',
    }
  }
  const intended = parseTeamAdminWireMessage(request.intendedMessage)
  if (intended === null) {
    // REDAX's own committed bytes did not parse. Nothing can be decided from that, and
    // an undecidable comparison must never be reported as a wallet mutation.
    return { ok: false, code: 'VERIFICATION_UNAVAILABLE' }
  }

  // The fixed topology: exactly two required signers, the Team wallet in slot 0 — where
  // the fee payer always is — and the frozen output mint in slot 1. There is no third.
  if (signed.requiredSignatures !== REDAX_TEAM_ADMIN_REQUIRED_SIGNATURES) {
    return { ok: false, code: 'REQUIRED_SIGNATURES_NOT_TWO' }
  }
  if (signed.accountKeys.length <= REDAX_OUTPUT_MINT_SLOT) {
    return { ok: false, code: 'MESSAGE_STRUCTURE_MISMATCH' }
  }
  if (!bytesEqual(signed.accountKeys[REDAX_TEAM_WALLET_SLOT], request.teamWallet)) {
    return { ok: false, code: 'TEAM_WALLET_SLOT_MISMATCH' }
  }
  if (!bytesEqual(signed.accountKeys[REDAX_OUTPUT_MINT_SLOT], request.outputMint)) {
    return { ok: false, code: 'OUTPUT_MINT_SLOT_MISMATCH' }
  }
  if (signed.instructions.length !== REDAX_TEAM_ADMIN_S1_INSTRUCTION_COUNT) {
    return { ok: false, code: 'MESSAGE_STRUCTURE_MISMATCH' }
  }

  // Exact size, then exact digest, then exact bytes, then exact structure. The first
  // three are the same identity asked three ways; the fourth is what names the
  // difference when there is one.
  if (split.wire.message.length !== request.intendedMessageByteLength) {
    return { ok: false, code: 'MESSAGE_BYTE_LENGTH_MISMATCH' }
  }
  const platform = resolveSubtle()
  if (platform === null) {
    return { ok: false, code: 'VERIFICATION_UNAVAILABLE' }
  }
  const actualDigest = await sha256Hex(platform, split.wire.message)
  if (actualDigest === null) {
    return { ok: false, code: 'VERIFICATION_UNAVAILABLE' }
  }
  if (actualDigest !== request.intendedMessageSha256Hex) {
    return { ok: false, code: 'MESSAGE_DIGEST_MISMATCH' }
  }
  if (!bytesEqual(split.wire.message, request.intendedMessage)) {
    return { ok: false, code: 'MESSAGE_BYTES_MISMATCH' }
  }
  if (!wireMessagesEqual(signed, intended)) {
    return { ok: false, code: 'MESSAGE_STRUCTURE_MISMATCH' }
  }

  // Both signatures, per slot, against the SAME exact extracted message bytes. Slot
  // order matters to the answer: "the mint's signature did not survive the wallet" and
  // "the wallet signed something else" are the two outcomes this whole route exists to
  // tell apart, and one shared code would erase the distinction.
  const teamSignature = split.wire.signatures[REDAX_TEAM_WALLET_SLOT]
  const mintSignature = split.wire.signatures[REDAX_OUTPUT_MINT_SLOT]
  if (isPlaceholderSignature(teamSignature)) {
    return { ok: false, code: 'TEAM_SIGNATURE_PLACEHOLDER' }
  }
  if (isPlaceholderSignature(mintSignature)) {
    return { ok: false, code: 'OUTPUT_MINT_SIGNATURE_PLACEHOLDER' }
  }
  const teamVerdict = await verifyEd25519(
    platform,
    request.teamWallet,
    teamSignature,
    split.wire.message,
  )
  if (teamVerdict === 'UNAVAILABLE') {
    return { ok: false, code: 'VERIFICATION_UNAVAILABLE' }
  }
  if (teamVerdict === 'INVALID') {
    return { ok: false, code: 'TEAM_SIGNATURE_INVALID' }
  }
  const mintVerdict = await verifyEd25519(
    platform,
    request.outputMint,
    mintSignature,
    split.wire.message,
  )
  if (mintVerdict === 'UNAVAILABLE') {
    return { ok: false, code: 'VERIFICATION_UNAVAILABLE' }
  }
  if (mintVerdict === 'INVALID') {
    return { ok: false, code: 'OUTPUT_MINT_SIGNATURE_INVALID' }
  }

  // The transaction's identity, derived from SLOT 0 ONLY and from the artifact rather
  // than learned from a node. Nothing normalizes it and nothing guesses it.
  let knownSignatureBase58: string
  try {
    knownSignatureBase58 = encodeBase58(teamSignature)
  } catch {
    return { ok: false, code: 'VERIFICATION_UNAVAILABLE' }
  }
  return { ok: true, knownSignatureBase58 }
}
