// REDAX customer service — the Vercel Blob storage adapter (production).
//
// EXACT SDK SEMANTICS, NOT A COPY OF THEM. Every primitive maps onto one documented
// `@vercel/blob` 2.8.1 call, and the options are the point:
//
//   read     — `get(path, { access: 'private', storeId, useCache: false })`: served from origin
//              storage, never from the CDN cache (the SDK adds `cache=0`), so a revoked grant or
//              a superseded revision cannot be read back as current (overwrites otherwise
//              propagate in up to 60 s). The SDK applies `useCache: false` to PRIVATE reads
//              only; public files are content-addressed and never overwritten, so a cached
//              public read and an origin read return the same bytes.
//   create   — `put(path, bytes, { allowOverwrite: false, addRandomSuffix: false })`: the store
//              refuses an existing pathname, which is the single-winner primitive.
//   replace  — `put(path, bytes, { allowOverwrite: true, ifMatch: etag })`: a real ETag
//              compare-and-set; a superseded ETag throws `BlobPreconditionFailedError`.
//   remove   — `del(path, { ifMatch })`.
//
// EVERY CALL NAMES ITS STORE. `storeId` is passed explicitly on every call, so the private
// store and the public store can never be swapped by an ambient `BLOB_STORE_ID`. With a store
// id and Vercel's OIDC token present the SDK authenticates by OIDC. An explicit read-write
// token is used only when the owner configured one for exactly that store (the configuration
// checks the store id inside it), and an ambient default `BLOB_READ_WRITE_TOKEN` makes the
// service unconfigured, because the SDK would otherwise fall back to it silently. No token is
// ever returned to a browser.
//
// THE SDK RETRIES, SO A "FAILED" WRITE MAY HAVE LANDED. A create that reports a conflict or a
// replace that reports a precondition failure is therefore READ BACK: if the stored bytes are
// exactly the bytes this request meant to write, the write is reported as landed; otherwise the
// conflict is real. Every record that must have a single winner carries a request-unique field,
// so two different requests never write identical bytes and this rule can never let a loser
// win.

import {
  RedaxCustomerStoreUnavailableError,
  assertRedaxCustomerStorePath,
  redaxCustomerStoreRecordKind,
  type RedaxCustomerPrivateStore,
  type RedaxCustomerPublicStore,
  type RedaxCustomerStoredObject,
} from './customerStore.js'

/** The three SDK members this adapter uses, injectable so a test can see every call. */
export interface RedaxCustomerBlobSdk {
  put(
    pathname: string,
    body: Buffer,
    options: {
      readonly access: 'private' | 'public'
      readonly storeId: string
      readonly token?: string
      readonly addRandomSuffix: false
      readonly allowOverwrite: boolean
      readonly contentType: string
      readonly cacheControlMaxAge?: number
      readonly ifMatch?: string
    },
  ): Promise<{ readonly url: string; readonly etag: string; readonly pathname: string }>
  get(
    pathname: string,
    options: { readonly access: 'private' | 'public'; readonly storeId: string; readonly token?: string; readonly useCache: false },
  ): Promise<
    | {
        readonly statusCode: 200
        readonly stream: ReadableStream<Uint8Array>
        readonly blob: { readonly etag: string; readonly contentType: string; readonly size: number }
      }
    | { readonly statusCode: 304 }
    | null
  >
  del(pathname: string, options: { readonly storeId: string; readonly token?: string; readonly ifMatch?: string }): Promise<void>
}

/**
 * The SDK's own error class, recognized by NAME so no class identity is assumed. `@vercel/blob`
 * 2.8.1 never sets `name` on its errors — every instance reports `name === 'Error'` — so the
 * class name is read from the constructor first; an explicit `name` is honored as well. The
 * result is a fixed SDK class name (or `Error` / `TypeError`), safe to log.
 */
function blobErrorClass(error: unknown): string {
  if (!(error instanceof Error)) {
    return 'NonError'
  }
  for (const candidate of [error.constructor?.name, error.name]) {
    if (typeof candidate === 'string' && /^Blob[A-Za-z]{1,48}$/.test(candidate)) {
      return candidate
    }
  }
  return error.name === 'TypeError' ? 'TypeError' : 'Error'
}

/** The class, plus the HTTP status `get` puts in its message ("Failed to fetch blob: 403 …"). */
function blobErrorCause(error: unknown): string {
  const status = error instanceof Error ? /Failed to fetch blob: (\d{3})\b/.exec(error.message)?.[1] : undefined
  return status === undefined ? blobErrorClass(error) : `${blobErrorClass(error)}.http${status}`
}

function isPreconditionFailure(error: unknown): boolean {
  return blobErrorClass(error) === 'BlobPreconditionFailedError'
}

function isNotFound(error: unknown): boolean {
  return blobErrorClass(error) === 'BlobNotFoundError'
}

function unavailable(primitive: string, path: string, cause: string): RedaxCustomerStoreUnavailableError {
  return new RedaxCustomerStoreUnavailableError('storage unavailable', `${primitive}.${redaxCustomerStoreRecordKind(path)}.${cause}`)
}

/** The largest object this service ever reads back. Everything it stores is far smaller. */
const MAX_READ_BYTES = 4 * 1024 * 1024

async function readBounded(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) {
      break
    }
    total += value.byteLength
    if (total > MAX_READ_BYTES) {
      await reader.cancel()
      throw new RedaxCustomerStoreUnavailableError('object larger than expected', 'read.too-large')
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) {
    return false
  }
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) {
      return false
    }
  }
  return true
}

function toBuffer(bytes: Uint8Array): Buffer {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
}

/** Which store a call targets, and — only if the owner configured one — its explicit token. */
export interface RedaxCustomerBlobStoreCredentials {
  readonly storeId: string
  readonly token: string | null
}

function auth(credentials: RedaxCustomerBlobStoreCredentials): { readonly storeId: string; readonly token?: string } {
  return credentials.token === null ? { storeId: credentials.storeId } : { storeId: credentials.storeId, token: credentials.token }
}

async function readLatest(
  sdk: RedaxCustomerBlobSdk,
  access: 'private' | 'public',
  credentials: RedaxCustomerBlobStoreCredentials,
  path: string,
): Promise<RedaxCustomerStoredObject | null> {
  assertRedaxCustomerStorePath(path)
  let result: Awaited<ReturnType<RedaxCustomerBlobSdk['get']>>
  try {
    result = await sdk.get(path, { access, ...auth(credentials), useCache: false })
  } catch (error) {
    if (isNotFound(error)) {
      return null
    }
    throw unavailable('read', path, blobErrorCause(error))
  }
  if (result === null) {
    return null
  }
  if (result.statusCode !== 200) {
    // A 304 is impossible without `ifNoneMatch`; anything but a full body is not a reading.
    throw unavailable('read', path, `status${result.statusCode}`)
  }
  const bytes = await readBounded(result.stream)
  return { etag: result.blob.etag, bytes, contentType: result.blob.contentType }
}

export interface RedaxCustomerBlobStoreOptions {
  /** Server log hook for value-free provider anomalies (fixed words only). */
  readonly diagnose?: (event: string) => void
}

export function createRedaxCustomerBlobPrivateStore(
  sdk: RedaxCustomerBlobSdk,
  credentials: RedaxCustomerBlobStoreCredentials,
  options: RedaxCustomerBlobStoreOptions = {},
): RedaxCustomerPrivateStore {
  const diagnose = options.diagnose ?? (() => undefined)
  /** The read-back after a write the SDK reported as failed; its own failure keeps the write's cause. */
  async function readBack(primitive: string, path: string, cause: string): Promise<RedaxCustomerStoredObject | null> {
    try {
      return await readLatest(sdk, 'private', credentials, path)
    } catch {
      throw unavailable(primitive, path, `${cause}.readback-failed`)
    }
  }
  return {
    read: (path) => readLatest(sdk, 'private', credentials, path),
    async create(path, bytes, contentType) {
      assertRedaxCustomerStorePath(path)
      try {
        const written = await sdk.put(path, toBuffer(bytes), {
          access: 'private',
          ...auth(credentials),
          addRandomSuffix: false,
          allowOverwrite: false,
          contentType,
        })
        return { ok: true, etag: written.etag }
      } catch (error) {
        // Either the path already existed or the SDK cannot say. Read back to decide.
        const cause = blobErrorCause(error)
        const current = await readBack('create', path, cause)
        if (current === null) {
          throw unavailable('create', path, cause)
        }
        return bytesEqual(current.bytes, bytes) ? { ok: true, etag: current.etag } : { ok: false, code: 'EXISTS' }
      }
    },
    async replace(path, bytes, contentType, ifMatch) {
      assertRedaxCustomerStorePath(path)
      try {
        const written = await sdk.put(path, toBuffer(bytes), {
          access: 'private',
          ...auth(credentials),
          addRandomSuffix: false,
          allowOverwrite: true,
          contentType,
          ifMatch,
        })
        return { ok: true, etag: written.etag }
      } catch (error) {
        const cause = blobErrorCause(error)
        const current = await readBack('replace', path, cause)
        if (current !== null && bytesEqual(current.bytes, bytes)) {
          return { ok: true, etag: current.etag }
        }
        if (isPreconditionFailure(error) || current === null || current.etag !== ifMatch) {
          if (isPreconditionFailure(error) && current !== null && current.etag === ifMatch) {
            // The provider refused an ETag that a latest read still reports for the same bytes:
            // nobody else wrote. It is still refused (never a blind overwrite), but the log says
            // so — the page re-reads and tells this apart from a real edit elsewhere.
            diagnose(`blob.replace.${redaxCustomerStoreRecordKind(path)}.precondition-etag-unchanged${current.etag.startsWith('W/') ? '.weak-etag' : ''}`)
          }
          return { ok: false, code: 'PRECONDITION_FAILED' }
        }
        throw unavailable('replace', path, cause)
      }
    },
    async remove(path, ifMatch) {
      assertRedaxCustomerStorePath(path)
      try {
        await sdk.del(path, ifMatch === undefined ? auth(credentials) : { ...auth(credentials), ifMatch })
      } catch (error) {
        if (isNotFound(error)) {
          return
        }
        throw unavailable('remove', path, blobErrorCause(error))
      }
    },
  }
}

/** Public files are content-addressed and never change, so they may be cached for a year. */
const PUBLIC_CACHE_MAX_AGE_SECONDS = 365 * 24 * 60 * 60

export function createRedaxCustomerBlobPublicStore(
  sdk: RedaxCustomerBlobSdk,
  credentials: RedaxCustomerBlobStoreCredentials,
  baseUrl: string,
  fetchImpl: typeof fetch,
): RedaxCustomerPublicStore {
  const publicUrl = (path: string): string => `${baseUrl}/${assertRedaxCustomerStorePath(path)}`
  return {
    read: (path) => readLatest(sdk, 'public', credentials, path),
    async fetchServed(path) {
      // The public URL exactly as a wallet or explorer will request it. Fixed host, fixed
      // path built by this service — never a URL a request supplied.
      let response: Response
      try {
        response = await fetchImpl(publicUrl(path), { method: 'GET', redirect: 'error' })
      } catch (error) {
        throw unavailable('served', path, blobErrorCause(error))
      }
      if (response.status === 404) {
        return null
      }
      if (!response.ok || response.body === null) {
        throw unavailable('served', path, `http${response.status}`)
      }
      const bytes = await readBounded(response.body)
      return { etag: response.headers.get('etag') ?? '', bytes, contentType: response.headers.get('content-type') ?? '' }
    },
    async create(path, bytes, contentType) {
      assertRedaxCustomerStorePath(path)
      try {
        const written = await sdk.put(path, toBuffer(bytes), {
          access: 'public',
          ...auth(credentials),
          addRandomSuffix: false,
          allowOverwrite: false,
          contentType,
          cacheControlMaxAge: PUBLIC_CACHE_MAX_AGE_SECONDS,
        })
        return { ok: true, url: written.url }
      } catch (error) {
        const current = await readLatest(sdk, 'public', credentials, path)
        if (current === null) {
          throw unavailable('create', path, blobErrorCause(error))
        }
        return bytesEqual(current.bytes, bytes) ? { ok: true, url: publicUrl(path) } : { ok: false, code: 'EXISTS' }
      }
    },
    publicUrl,
  }
}
