// REDAX customer service — the storage contract both adapters implement.
//
// FOUR PRIMITIVES, AND THE SEMANTICS ARE THE POINT.
//
//   read     — always the LATEST bytes, never a CDN copy. Every authority decision (a session,
//              a grant, a claim, a draft revision) is made on a read that cannot be stale.
//   create   — CREATE-ONLY. A second create at the same path fails with `EXISTS`; this is the
//              atomic single-winner primitive behind single-use nonces and new records.
//   replace  — COMPARE-AND-SET on the real ETag. A replace against a superseded ETag fails with
//              `PRECONDITION_FAILED`; there is no unconditional overwrite in this interface.
//   remove   — delete, optionally conditional on the ETag.
//
// Two separate objects are never updated as one transaction, and nothing here pretends they
// are: every multi-object operation in the service is ordered so that a crash between its
// writes leaves a state the next request can see and repair, and the authority for each
// decision lives in exactly one object.
//
// WHAT AN OUTAGE MEANS. Any provider failure — quota, rate limit, network, a suspended store —
// surfaces as `RedaxCustomerStoreUnavailableError`. The service then answers
// `STORE_UNAVAILABLE`, keeps what is already stored, deletes nothing and never sends anything.

export interface RedaxCustomerStoredObject {
  readonly etag: string
  readonly bytes: Uint8Array
  readonly contentType: string
}

export type RedaxCustomerCreateResult =
  | { readonly ok: true; readonly etag: string }
  | { readonly ok: false; readonly code: 'EXISTS' }

export type RedaxCustomerReplaceResult =
  | { readonly ok: true; readonly etag: string }
  | { readonly ok: false; readonly code: 'PRECONDITION_FAILED' }

export interface RedaxCustomerPrivateStore {
  read(path: string): Promise<RedaxCustomerStoredObject | null>
  create(path: string, bytes: Uint8Array, contentType: string): Promise<RedaxCustomerCreateResult>
  replace(path: string, bytes: Uint8Array, contentType: string, ifMatch: string): Promise<RedaxCustomerReplaceResult>
  remove(path: string, ifMatch?: string): Promise<void>
}

export interface RedaxCustomerPublicStore {
  /** The latest bytes at a public path, read from origin storage. */
  read(path: string): Promise<RedaxCustomerStoredObject | null>
  /** The bytes a client would receive from the public URL right now (CDN path). */
  fetchServed(path: string): Promise<RedaxCustomerStoredObject | null>
  /** Create-only, immutable cache. Returns the URL the store actually assigned. */
  create(
    path: string,
    bytes: Uint8Array,
    contentType: string,
  ): Promise<{ readonly ok: true; readonly url: string } | { readonly ok: false; readonly code: 'EXISTS' }>
  /** The URL a path will be served at. Deterministic; used before publishing. */
  publicUrl(path: string): string
}

export class RedaxCustomerStoreUnavailableError extends Error {
  /**
   * A fixed, value-free diagnostic tag for the server log — which primitive, which kind of
   * record and which provider error class, e.g. `replace.setup.BlobServiceRateLimited`. Never a
   * path, a provider message, a header or a token.
   */
  readonly detail: string | null
  constructor(message = 'storage unavailable', detail: string | null = null) {
    super(message)
    this.name = 'RedaxCustomerStoreUnavailableError'
    this.detail = detail
  }
}

/** The kind of record a store path names: one fixed word for diagnostics, never the path. */
export function redaxCustomerStoreRecordKind(path: string): string {
  if (path.startsWith('v1/auth/session/')) {
    return 'session'
  }
  if (path.startsWith('v1/auth/nonce/')) {
    return 'nonce'
  }
  if (path === 'v1/grants-index.json') {
    return 'grants-index'
  }
  if (path.startsWith('v1/grants/')) {
    return 'grant'
  }
  if (path.startsWith('v1/claims/')) {
    return path.includes('/attempts/') ? 'attempt' : 'claim'
  }
  if (path.startsWith('v1/ws/')) {
    return path.endsWith('/index.json') ? 'index' : path.includes('/logos/') ? 'logo' : path.includes('/setups/') ? 'setup' : 'workspace'
  }
  return path.startsWith('m/') ? 'public' : 'other'
}

/** Only these characters may appear in a store path: no traversal, no query, no host. */
const STORE_PATH_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*(\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/

/** Refuse anything that is not a plain relative path the service itself constructed. */
export function assertRedaxCustomerStorePath(path: string): string {
  if (typeof path !== 'string' || path.length > 256 || !STORE_PATH_PATTERN.test(path) || path.includes('..')) {
    throw new TypeError('invalid store path')
  }
  return path
}

const decoder = new TextDecoder('utf-8', { fatal: true })

/** Parse stored JSON, or `null` when it is not JSON at all (treated as corrupt). */
export function parseRedaxCustomerStoredJson(object: RedaxCustomerStoredObject): unknown {
  try {
    return JSON.parse(decoder.decode(object.bytes))
  } catch {
    return null
  }
}

export function encodeRedaxCustomerJson(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value))
}
