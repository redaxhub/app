// REDAX customer service — canonical JSON and SHA-256, shared by the browser and the server.
//
// ONE SERIALIZATION, TWO SIDES. A plan the server freezes and a plan the browser re-checks
// must hash to the same 32 bytes, so both sides serialize through this one function: object
// keys sorted by UTF-16 code unit, no whitespace, `JSON.stringify` string escaping, and no
// value kind that JSON cannot carry exactly. A `bigint`, `undefined`, a function, a symbol, a
// non-finite number or a non-plain object is refused rather than coerced — a hash over a
// silently rewritten value would be a commitment to something nobody reviewed.
//
// SERVER-SAFE BY CONSTRUCTION. This module imports nothing, reads no environment and touches
// no DOM, so the Vercel Function can load it as ESM and the browser bundle can load it as-is.
// The only platform surface is WebCrypto `subtle.digest`, present in every supported browser
// and in Node 24; its absence is a refusal, never a fallback.

export type RedaxCanonicalJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly RedaxCanonicalJsonValue[]
  | { readonly [key: string]: RedaxCanonicalJsonValue }

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false
  }
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

/**
 * Serialize `value` canonically, or throw `TypeError` for anything JSON cannot carry exactly.
 *
 * Throwing is deliberate here and only here: every caller is server or review code that is
 * about to commit to the bytes, and a value that cannot be serialized is a programming error
 * there, not user input to be reported.
 */
export function redaxCanonicalJson(value: unknown): string {
  if (value === null) {
    return 'null'
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false'
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError('non-finite number is not canonical JSON')
    }
    return JSON.stringify(value)
  }
  if (typeof value === 'string') {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => redaxCanonicalJson(entry)).join(',')}]`
  }
  if (isPlainObject(value)) {
    const keys = Object.keys(value).sort()
    const parts: string[] = []
    for (const key of keys) {
      const entry = value[key]
      if (entry === undefined) {
        throw new TypeError('undefined is not canonical JSON')
      }
      parts.push(`${JSON.stringify(key)}:${redaxCanonicalJson(entry)}`)
    }
    return `{${parts.join(',')}}`
  }
  throw new TypeError('value is not canonical JSON')
}

/** UTF-8 bytes of a string, through the platform encoder (well-formed input only). */
export function redaxUtf8Bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

interface RedaxSubtleDigest {
  digest(algorithm: string, data: Uint8Array): Promise<ArrayBuffer>
}

function resolveRedaxSubtle(): RedaxSubtleDigest | null {
  const crypto = (globalThis as { crypto?: { subtle?: unknown } }).crypto
  const subtle = crypto?.subtle as RedaxSubtleDigest | undefined
  return subtle !== undefined && typeof subtle.digest === 'function' ? subtle : null
}

/** Lowercase hex SHA-256 of exactly these bytes. Throws when WebCrypto is unavailable. */
export async function redaxSha256Hex(bytes: Uint8Array): Promise<string> {
  const subtle = resolveRedaxSubtle()
  if (subtle === null) {
    throw new Error('SHA-256 is unavailable on this platform')
  }
  // A fresh copy: the digest reads a buffer this module owns, never a caller's view of a
  // larger buffer that might be mutated while the promise is pending.
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  const digest = new Uint8Array(await subtle.digest('SHA-256', copy))
  let hex = ''
  for (const byte of digest) {
    hex += byte.toString(16).padStart(2, '0')
  }
  return hex
}

/** SHA-256 of the canonical JSON of `value`. */
export async function redaxCanonicalJsonSha256(value: unknown): Promise<string> {
  return redaxSha256Hex(redaxUtf8Bytes(redaxCanonicalJson(value)))
}

/** Constant-shape equality of two byte arrays (lengths first, then every byte). */
export function redaxBytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) {
    return false
  }
  let difference = 0
  for (let index = 0; index < left.byteLength; index += 1) {
    difference |= left[index] ^ right[index]
  }
  return difference === 0
}

/** `[0-9a-f]{64}` — the only spelling of a SHA-256 this service accepts or emits. */
export function isRedaxSha256Hex(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)
}
