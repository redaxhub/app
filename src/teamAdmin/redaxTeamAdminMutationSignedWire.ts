// REDAX Team/Admin post-init mutation signed wire — the EXACT-ONE-SIGNATURE verifier.
//
// -----------------------------------------------------------------------------
// WHAT THIS FILE IS
// -----------------------------------------------------------------------------
// The ONE place a Team/Admin post-init MUTATION artifact is judged. It commits to the
// exact compiled legacy message before any signature exists, and it later proves that the
// bytes a wallet returned are that same message carrying exactly one valid signature from
// the approved Team wallet.
//
// It acquires NOTHING: no dependency, no `Connection`, no `Transaction`, no wallet, no
// adapter, no storage, no journal and no environment. It copies, splits, reads and
// compares bytes, and it asks Web Crypto two questions.
//
// -----------------------------------------------------------------------------
// A SEPARATE VERIFIER, AND WHY IT IS NOT A PARAMETER
// -----------------------------------------------------------------------------
// `app/src/teamAdmin/redaxTeamAdminSignedWire.ts` is the CLOSED S1 verifier and is fixed
// at exactly TWO required signatures. It is NOT imported here, NOT generalized and NOT
// modified — and neither is the Holder exact-one check, which lives inside the Holder
// action owner and is Holder's by construction.
//
// THERE IS NO SIGNER-COUNT ARGUMENT, and that absence is the security property. A
// verifier taking a count would be ABLE to express the S1 topology, which is precisely
// what a separate corridor exists to prevent: the first time a caller passed `2` the two
// corridors would have merged, and nothing in the type system would have noticed. This
// corridor is exact-one BY CONSTRUCTION, so a mutation route cannot verify an S1 artifact
// and an S1 route cannot verify a mutation artifact.
//
// -----------------------------------------------------------------------------
// WHAT THIS VERIFIER DELIBERATELY DOES *NOT* CHECK
// -----------------------------------------------------------------------------
// `SIGNED_WIRE_VERIFIER_TOP_LEVEL_INSTRUCTION_CARDINALITY_CHECK = NONE`. There is no
// `INSTRUCTION_COUNT_NOT_ONE` code and no top-level instruction-count rule, and neither
// may be added here.

// --- Fixed wire constants -----------------------------------------------------

/** One ed25519 signature. */
const REDAX_SIGNATURE_BYTES = 64

/** One raw public key on the wire. */
const REDAX_WIRE_KEY_BYTES = 32

/** THE topology: exactly one required signature. Not a parameter, not a default. */
const REDAX_MUTATION_REQUIRED_SIGNATURES = 1

/** The one signer slot — the approved Team wallet, which is also the fee payer. */
const REDAX_MUTATION_TEAM_WALLET_SLOT = 0

/** A compact-u16 byte sets its high bit when another byte follows. */
const REDAX_COMPACT_U16_CONTINUATION = 0x80

/** Below this a compact-u16 value is one byte; from here up a second is required. */
const REDAX_COMPACT_U16_ONE_BYTE_LIMIT = 0x80

/** Below this a compact-u16 value is two bytes; from here up a third is required. */
const REDAX_COMPACT_U16_TWO_BYTE_LIMIT = 0x4000

/** The widest value a compact-u16 can carry at all. */
const REDAX_COMPACT_U16_MAX_VALUE = 0xffff

/** The most bytes a compact-u16 can occupy. */
const REDAX_COMPACT_U16_MAX_BYTES = 3

/** The message header: required signers, readonly signed, readonly unsigned. */
const REDAX_MESSAGE_HEADER_BYTES = 3

/** A versioned message sets the high bit of its first byte. A legacy one never does. */
const REDAX_MESSAGE_VERSION_FLAG = 0x80

/** One signature count, one signature, one header — below this nothing can parse. */
const REDAX_MIN_SIGNED_WIRE_BYTES =
  1 + REDAX_SIGNATURE_BYTES * REDAX_MUTATION_REQUIRED_SIGNATURES + REDAX_MESSAGE_HEADER_BYTES

/** The on-chain packet size. A wire above it could not be broadcast in any case. */
const REDAX_MAX_SIGNED_WIRE_BYTES = 1232

/** The exact algorithm the one mutation signature is, named once. */
const REDAX_SIGNATURE_ALGORITHM = 'Ed25519'

/** The commitment scheme this module produces and checks. */
const REDAX_MUTATION_INTENDED_MESSAGE_COMMITMENT_KIND =
  'redax-team-admin-mutation-intended-legacy-message-sha256-v1' as const

// --- Public vocabulary --------------------------------------------------------

/**
 * Every way this verifier declines. EXACTLY FOURTEEN, value-free, closed and exhaustive.
 *
 * There is no instruction-count code and there is no fifteenth. The family is the closed
 * S1 family's seventeen minus its three output-mint-specific codes, with `NOT_TWO` read
 * as `NOT_ONE` — structurally parallel, separately declared, and neither importing the
 * other.
 */
export type RedaxTeamAdminMutationSignedWireRefusalCode =
  | 'INPUT_INVALID'
  | 'WIRE_UNREADABLE'
  | 'SIGNATURE_COUNT_NOT_ONE'
  | 'MESSAGE_UNREADABLE'
  | 'MESSAGE_VERSIONED'
  | 'REQUIRED_SIGNATURES_NOT_ONE'
  | 'TEAM_WALLET_SLOT_MISMATCH'
  | 'MESSAGE_BYTE_LENGTH_MISMATCH'
  | 'MESSAGE_DIGEST_MISMATCH'
  | 'MESSAGE_BYTES_MISMATCH'
  | 'MESSAGE_STRUCTURE_MISMATCH'
  | 'TEAM_SIGNATURE_PLACEHOLDER'
  | 'TEAM_SIGNATURE_INVALID'
  | 'VERIFICATION_UNAVAILABLE'

/**
 * Exactly the facts the verifier needs, and not one more.
 *
 * NOTE WHAT IS ABSENT: there is no signature count, no signer array, no second key, no
 * `Transaction`, no `Connection` and no adapter. The intended message arrives as BYTES
 * plus the commitment REDAX already took over those bytes, so every comparison is against
 * something frozen before the wallet ever saw it.
 */
export interface RedaxTeamAdminMutationSignedWireRequest {
  /** The exact bytes the wallet returned. Copied on entry; never mutated. */
  readonly wire: Uint8Array
  /** The approved Team wallet, as raw 32 public-key bytes. It is also the fee payer. */
  readonly teamWallet: Uint8Array
  /** The exact legacy message REDAX compiled and committed to, before any signature. */
  readonly intendedMessage: Uint8Array
  /** That message's frozen byte length. Compared before anything is hashed. */
  readonly intendedMessageByteLength: number
  /** That message's frozen lowercase SHA-256 hex. */
  readonly intendedMessageSha256Hex: string
}

/**
 * A verified mutation artifact.
 *
 * `knownSignatureBase58` is derived from SIGNATURE SLOT 0 — the only slot there is —
 * which is the approved Team wallet's, which is the fee payer's, which is the
 * transaction's identity. It is derived from the ARTIFACT rather than learned from a
 * node, so it exists before anything is broadcast and is independent of what any node
 * later returns.
 */
export interface RedaxTeamAdminMutationVerifiedSignedWireV1 {
  readonly ok: true
  readonly knownSignatureBase58: string
}

export type RedaxTeamAdminMutationSignedWireResult =
  | RedaxTeamAdminMutationVerifiedSignedWireV1
  | { readonly ok: false; readonly code: RedaxTeamAdminMutationSignedWireRefusalCode }

/** One frozen commitment to one compiled legacy mutation message. */
export interface RedaxTeamAdminMutationIntendedMessageCommitmentV1 {
  readonly kind: typeof REDAX_MUTATION_INTENDED_MESSAGE_COMMITMENT_KIND
  readonly byteLength: number
  readonly sha256Hex: string
}

export type RedaxTeamAdminMutationIntendedMessageCommitmentResult =
  | {
      readonly ok: true
      readonly commitment: RedaxTeamAdminMutationIntendedMessageCommitmentV1
    }
  | { readonly ok: false }

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
 * Serializing without requiring all signatures is what lets an unsigned artifact be
 * INSPECTED instead of throwing — and the placeholder that makes that possible must then
 * be refused explicitly, so "the wallet never signed" is a distinct answer from "the
 * wallet signed something else".
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
 * follows, so a value can be SPELLED more than one way: `01` and `81 00` both decode to
 * 1. Only the shortest spelling is its encoding.
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
 * ONLY THE CANONICAL MINIMAL ENCODING IS READABLE, and that is a security property. The
 * compact-u16 prefixes on this wire are NOT covered by the signature: a wallet can widen
 * the outer signature count from `01` to `81 00` and leave the 64-byte signature and the
 * exact signed message untouched. Such a wire still carries a valid ed25519 relation over
 * the intended message, so byte equality and the signature check would both pass on bytes
 * REDAX never approved.
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
 * This module acquires nothing at all, and one fixed-length encoder is smaller than an
 * import that would make its dependency footprint non-zero for one string. Leading zero
 * bytes become leading `1`s, which is the encoding rather than a special case.
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
interface MutationSignedWire {
  readonly signature: Uint8Array
  readonly message: Uint8Array
}

/**
 * Split one signed legacy wire into its ONE signature and its EXACT signed message.
 *
 * The count is required to be exactly one HERE rather than read and judged later: a wire
 * carrying two or three signatures is not an under-verified mutation artifact, it is a
 * different transaction shape — an S1 artifact is exactly that shape — and this module has
 * no representation for one.
 */
function parseMutationSignedWire(
  wire: Uint8Array,
):
  | { readonly ok: true; readonly wire: MutationSignedWire }
  | { readonly ok: false; readonly code: RedaxTeamAdminMutationSignedWireRefusalCode } {
  if (wire.length < REDAX_MIN_SIGNED_WIRE_BYTES || wire.length > REDAX_MAX_SIGNED_WIRE_BYTES) {
    return { ok: false, code: 'WIRE_UNREADABLE' }
  }
  const count = readCompactU16(wire, 0)
  if (count === null) {
    return { ok: false, code: 'WIRE_UNREADABLE' }
  }
  if (count.value !== REDAX_MUTATION_REQUIRED_SIGNATURES) {
    return { ok: false, code: 'SIGNATURE_COUNT_NOT_ONE' }
  }
  const messageStart = count.next + REDAX_SIGNATURE_BYTES * count.value
  if (messageStart + REDAX_MESSAGE_HEADER_BYTES > wire.length) {
    return { ok: false, code: 'WIRE_UNREADABLE' }
  }
  return {
    ok: true,
    wire: {
      signature: wire.slice(count.next, count.next + REDAX_SIGNATURE_BYTES),
      message: wire.slice(messageStart),
    },
  }
}

/** One instruction, exactly as the wire carries it. */
interface MutationWireInstruction {
  readonly programIdIndex: number
  readonly accountIndexes: Uint8Array
  readonly data: Uint8Array
}

/** One legacy message, structurally. Every field is a byte range, never a decoding. */
interface MutationWireMessage {
  readonly requiredSignatures: number
  readonly readonlySigned: number
  readonly readonlyUnsigned: number
  readonly accountKeys: readonly Uint8Array[]
  readonly recentBlockhash: Uint8Array
  readonly instructions: readonly MutationWireInstruction[]
}

/**
 * Read one legacy message's structure, or refuse.
 *
 * Every read is bounds-checked and the message must end EXACTLY where its last
 * instruction does: trailing bytes are a shape nobody decided on, and a parser that
 * ignored them could accept a message carrying something it never looked at.
 *
 * THE INSTRUCTION COUNT IS READ, NOT JUDGED. Whatever the message declares is parsed and
 * carried into the structural comparison, where it is required to equal the INTENDED
 * message's — which is a statement about this exact plan, not a fixed cardinality rule.
 */
function parseMutationWireMessage(message: Uint8Array): MutationWireMessage | null {
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
  const instructions: MutationWireInstruction[] = []
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
function wireMessagesEqual(left: MutationWireMessage, right: MutationWireMessage): boolean {
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
interface RedaxMutationSubtle {
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

function resolveSubtle(): RedaxMutationSubtle | null {
  const candidate = (globalThis as { crypto?: unknown }).crypto
  if (typeof candidate !== 'object' || candidate === null) {
    return null
  }
  const subtle = (candidate as RedaxMutationSubtle).subtle
  if (
    typeof subtle !== 'object' ||
    subtle === null ||
    typeof subtle.digest !== 'function' ||
    typeof subtle.importKey !== 'function' ||
    typeof subtle.verify !== 'function'
  ) {
    return null
  }
  return candidate as RedaxMutationSubtle
}

/** What a cryptographic check concluded. `UNAVAILABLE` is never a pass. */
type SignatureVerdict = 'VALID' | 'INVALID' | 'UNAVAILABLE'

/**
 * Verify ONE ed25519 signature against the EXACT extracted signed-message bytes.
 *
 * A non-boolean answer is not a pass: a platform that returns something else is one this
 * file does not understand, and not understanding is unavailability.
 */
async function verifyEd25519(
  platform: RedaxMutationSubtle,
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
async function sha256Hex(platform: RedaxMutationSubtle, bytes: Uint8Array): Promise<string | null> {
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

/**
 * Commit to the exact compiled legacy mutation message, ONCE, before any signature exists.
 *
 * It lives beside the verifier deliberately. The committer and the checker have to agree
 * byte for byte and digest for digest, so they use ONE digest implementation rather than
 * two that happen to match today: a second copy elsewhere would be free to drift, and the
 * failure it produced would look exactly like a wallet mutation.
 *
 * Its `kind` literal is the MUTATION corridor's own, distinct from the S1 corridor's, so a
 * commitment taken for one route is not structurally interchangeable with the other's.
 *
 * A platform without the digest is UNAVAILABLE, which stops the attempt. It is never a
 * commitment nobody can check.
 */
export async function commitRedaxTeamAdminMutationIntendedLegacyMessage(
  message: Uint8Array,
): Promise<RedaxTeamAdminMutationIntendedMessageCommitmentResult> {
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
      kind: REDAX_MUTATION_INTENDED_MESSAGE_COMMITMENT_KIND,
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
 * Verify one Team/Admin post-init mutation signed wire against the exact committed message.
 *
 * THE ORDER IS THE ARGUMENT. Readability is decided first, so "unreadable" is only ever
 * said about something that really could not be parsed. Then the fixed exact-one topology,
 * then the message identity asked three ways — length, digest, bytes — and once
 * structurally, and only then the one cryptographic check. Every step names what differed,
 * because a refusal that cannot say what was wrong is a refusal nobody can act on.
 *
 * NOTHING IS SERIALIZED, COMPILED OR NORMALIZED HERE. The provider performed the one
 * serialization; this copies, slices and reads.
 */
export async function verifyRedaxTeamAdminMutationSignedWire(
  request: RedaxTeamAdminMutationSignedWireRequest,
): Promise<RedaxTeamAdminMutationSignedWireResult> {
  if (
    typeof request !== 'object' ||
    request === null ||
    !(request.wire instanceof Uint8Array) ||
    !isWireKey(request.teamWallet) ||
    !(request.intendedMessage instanceof Uint8Array) ||
    !Number.isSafeInteger(request.intendedMessageByteLength) ||
    request.intendedMessageByteLength <= 0 ||
    typeof request.intendedMessageSha256Hex !== 'string' ||
    !/^[0-9a-f]{64}$/.test(request.intendedMessageSha256Hex)
  ) {
    return { ok: false, code: 'INPUT_INVALID' }
  }

  // The verifier's OWN copy. Everything from here on is memory this module owns; the
  // value the caller handed over is never read again.
  const wire = Uint8Array.from(request.wire)

  const split = parseMutationSignedWire(wire)
  if (!split.ok) {
    return { ok: false, code: split.code }
  }
  const signed = parseMutationWireMessage(split.wire.message)
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
  const intended = parseMutationWireMessage(request.intendedMessage)
  if (intended === null) {
    // REDAX's own committed bytes did not parse. Nothing can be decided from that, and an
    // undecidable comparison must never be reported as a wallet mutation.
    return { ok: false, code: 'VERIFICATION_UNAVAILABLE' }
  }

  // The fixed topology: exactly ONE required signer, the approved Team wallet in slot 0,
  // where the fee payer always is. There is no second slot to check and no argument that
  // could ask for one.
  if (signed.requiredSignatures !== REDAX_MUTATION_REQUIRED_SIGNATURES) {
    return { ok: false, code: 'REQUIRED_SIGNATURES_NOT_ONE' }
  }
  if (signed.accountKeys.length <= REDAX_MUTATION_TEAM_WALLET_SLOT) {
    return { ok: false, code: 'MESSAGE_STRUCTURE_MISMATCH' }
  }
  if (!bytesEqual(signed.accountKeys[REDAX_MUTATION_TEAM_WALLET_SLOT], request.teamWallet)) {
    return { ok: false, code: 'TEAM_WALLET_SLOT_MISMATCH' }
  }

  // Exact size, then exact digest, then exact bytes, then exact structure. The first three
  // are the same identity asked three ways; the fourth is what names the difference when
  // there is one.
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

  // The ONE signature, against the SAME exact extracted message bytes.
  const teamSignature = split.wire.signature
  if (isPlaceholderSignature(teamSignature)) {
    return { ok: false, code: 'TEAM_SIGNATURE_PLACEHOLDER' }
  }
  const verdict = await verifyEd25519(
    platform,
    request.teamWallet,
    teamSignature,
    split.wire.message,
  )
  if (verdict === 'UNAVAILABLE') {
    return { ok: false, code: 'VERIFICATION_UNAVAILABLE' }
  }
  if (verdict === 'INVALID') {
    return { ok: false, code: 'TEAM_SIGNATURE_INVALID' }
  }

  // The transaction's identity, derived from SLOT 0 and from the artifact rather than
  // learned from a node. Nothing normalizes it and nothing guesses it.
  let knownSignatureBase58: string
  try {
    knownSignatureBase58 = encodeBase58(teamSignature)
  } catch {
    return { ok: false, code: 'VERIFICATION_UNAVAILABLE' }
  }
  return { ok: true, knownSignatureBase58 }
}
