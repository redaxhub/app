// REDAX customer service — HTTP boundary helpers.
//
// PRIVATE RESPONSES ARE NEVER CACHED. Every JSON answer and every private preview carries
// `Cache-Control: no-store` and `Vary: Cookie`, so neither a browser nor a shared cache can
// replay one customer's record to anyone. Public token files are not served from here at all —
// they are served by the public store's CDN under their own immutable cache policy.
//
// ERRORS ARE CLOSED CODES. A response body never carries a stack, a provider message, a store
// path, an ETag or a key; the code and its fixed sentence are the whole of it.

import {
  REDAX_CUSTOMER_REQUEST_HEADER,
  describeRedaxCustomerError,
  type RedaxCustomerErrorCode,
} from '../src/customer/shared/customerContract.js'

const PRIVATE_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  'cache-control': 'no-store',
  vary: 'Cookie',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'cross-origin-resource-policy': 'same-origin',
})

export class RedaxCustomerHttpError extends Error {
  readonly status: number
  readonly code: RedaxCustomerErrorCode

  constructor(status: number, code: RedaxCustomerErrorCode) {
    super(code)
    this.name = 'RedaxCustomerHttpError'
    this.status = status
    this.code = code
  }
}

export function redaxCustomerJson(status: number, body: unknown, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...PRIVATE_HEADERS, 'content-type': 'application/json; charset=utf-8', ...extraHeaders },
  })
}

export function redaxCustomerError(status: number, code: RedaxCustomerErrorCode): Response {
  return redaxCustomerJson(status, { ok: false, code, message: describeRedaxCustomerError(code) })
}

export function redaxCustomerBytes(bytes: Uint8Array, contentType: string): Response {
  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      ...PRIVATE_HEADERS,
      'content-type': contentType,
      'content-disposition': 'inline',
      'content-security-policy': "default-src 'none'; sandbox",
    },
  })
}

/** Read the body as bytes with a hard ceiling, without trusting `Content-Length`. */
export async function readRedaxCustomerBody(request: Request, maxBytes: number): Promise<Uint8Array> {
  const declared = request.headers.get('content-length')
  if (declared !== null && /^\d+$/.test(declared) && Number(declared) > maxBytes) {
    throw new RedaxCustomerHttpError(413, 'PAYLOAD_TOO_LARGE')
  }
  if (request.body === null) {
    return new Uint8Array(0)
  }
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) {
      break
    }
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel()
      throw new RedaxCustomerHttpError(413, 'PAYLOAD_TOO_LARGE')
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

/** Parse a small JSON object body. Anything else is `BAD_REQUEST`. */
export async function readRedaxCustomerJsonBody(request: Request, maxBytes = 64 * 1024): Promise<Record<string, unknown>> {
  const contentType = request.headers.get('content-type') ?? ''
  if (!/^application\/json(;|$)/i.test(contentType.trim())) {
    throw new RedaxCustomerHttpError(415, 'BAD_REQUEST')
  }
  const bytes = await readRedaxCustomerBody(request, maxBytes)
  let parsed: unknown
  try {
    parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  } catch {
    throw new RedaxCustomerHttpError(400, 'BAD_REQUEST')
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new RedaxCustomerHttpError(400, 'BAD_REQUEST')
  }
  return parsed as Record<string, unknown>
}

/**
 * THE CSRF BOUNDARY. Every request must carry the REDAX request header; every state-changing
 * request must also come from an allowed origin, checked against `Origin` (and, when a browser
 * sends it, `Sec-Fetch-Site`). There is no wildcard and no suffix rule.
 */
export function assertRedaxCustomerRequestOrigin(request: Request, allowedOrigins: readonly string[]): void {
  if (request.headers.get(REDAX_CUSTOMER_REQUEST_HEADER) !== '1') {
    throw new RedaxCustomerHttpError(403, 'ORIGIN_REFUSED')
  }
  const fetchSite = request.headers.get('sec-fetch-site')
  if (fetchSite !== null && fetchSite !== 'same-origin') {
    throw new RedaxCustomerHttpError(403, 'ORIGIN_REFUSED')
  }
  if (request.method !== 'GET') {
    const origin = request.headers.get('origin')
    if (origin === null || !allowedOrigins.includes(origin)) {
      throw new RedaxCustomerHttpError(403, 'ORIGIN_REFUSED')
    }
  }
}

export function parseRedaxCustomerCookies(request: Request): Map<string, string> {
  const cookies = new Map<string, string>()
  const header = request.headers.get('cookie')
  if (header === null) {
    return cookies
  }
  for (const part of header.split(';')) {
    const index = part.indexOf('=')
    if (index <= 0) {
      continue
    }
    const name = part.slice(0, index).trim()
    const value = part.slice(index + 1).trim()
    if (!cookies.has(name)) {
      cookies.set(name, value)
    }
  }
  return cookies
}

/** The session cookie: HttpOnly, Secure, SameSite=Strict, host-only, Path=/. */
export function redaxCustomerSessionCookie(input: {
  readonly name: string
  readonly value: string
  readonly maxAgeSeconds: number
  readonly secure: boolean
}): string {
  const parts = [
    `${input.name}=${input.value}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${Math.max(0, Math.floor(input.maxAgeSeconds))}`,
  ]
  if (input.secure) {
    parts.push('Secure')
  }
  return parts.join('; ')
}

/**
 * Best-effort limiter for the anonymous auth endpoints. Not a lock; a brake. It is IN MEMORY
 * and PER FUNCTION INSTANCE: it is not shared between instances, it starts empty on every cold
 * start, and it is therefore not a distributed limit of any kind. What keeps forged session
 * cookies away from the store is the session MAC, not this.
 */
export class RedaxCustomerSoftRateLimiter {
  private readonly hits = new Map<string, { count: number; resetAt: number }>()
  private readonly limit: number
  private readonly windowMs: number

  constructor(limit: number, windowMs: number) {
    this.limit = limit
    this.windowMs = windowMs
  }

  allow(key: string, nowMs: number): boolean {
    if (this.hits.size > 5000) {
      this.hits.clear()
    }
    const current = this.hits.get(key)
    if (current === undefined || current.resetAt <= nowMs) {
      this.hits.set(key, { count: 1, resetAt: nowMs + this.windowMs })
      return true
    }
    current.count += 1
    return current.count <= this.limit
  }
}
