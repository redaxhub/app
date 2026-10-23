// REDAX customer service — the browser's one API client.
//
// SAME ORIGIN, COOKIE-ONLY. Every call goes to `/api/v1` on this page's own origin with the
// browser's HttpOnly session cookie (`credentials: 'same-origin'`). No token is ever held in
// JavaScript, localStorage or sessionStorage, and nothing here can name another host.
//
// Every request carries the REDAX request header (the CSRF boundary) and, once the page knows
// its session, the session's non-secret id — so a write from a tab that still shows a previous
// session is refused by the server instead of landing in the new one.
//
// Answers are typed and value-free on failure: a code, the server's fixed sentence, and — for
// a plan that does not validate — the field-level issues. A network failure is `NETWORK`,
// never a guess about what the server did.

import {
  REDAX_CUSTOMER_API_PATH,
  REDAX_CUSTOMER_REQUEST_HEADER,
  REDAX_CUSTOMER_SESSION_HEADER,
  type RedaxCustomerClaimRequest,
  type RedaxCustomerClaimView,
  type RedaxCustomerDraftV1,
  type RedaxCustomerErrorCode,
  type RedaxCustomerGrantRecordV1,
  type RedaxCustomerGrantStatus,
  type RedaxCustomerGrantSummary,
  type RedaxCustomerMe,
  type RedaxCustomerServiceConfigView,
  type RedaxCustomerSetupRecordV1,
  type RedaxCustomerSetupSummary,
  type RedaxCustomerSignInInput,
} from './shared/customerContract.js'
import type { RedaxCustomerIssue } from './shared/customerPlan.js'

export type RedaxCustomerApiFailure = {
  readonly ok: false
  readonly code: RedaxCustomerErrorCode | 'NETWORK'
  readonly message: string
  readonly status: number
  readonly issues?: readonly RedaxCustomerIssue[]
}

export type RedaxCustomerApiResult<T> = ({ readonly ok: true } & T) | RedaxCustomerApiFailure

export interface RedaxCustomerApiClient {
  config(): Promise<RedaxCustomerApiResult<{ readonly config: RedaxCustomerServiceConfigView }>>
  me(): Promise<RedaxCustomerApiResult<{ readonly me: RedaxCustomerMe }>>
  challenge(address: string): Promise<RedaxCustomerApiResult<{ readonly input: RedaxCustomerSignInInput }>>
  verify(body: {
    readonly address: string
    readonly signedMessage: string
    readonly signature: string
  }): Promise<
    RedaxCustomerApiResult<
      | { readonly access: 'NONE'; readonly wallet: string }
      | { readonly access: 'GRANTED'; readonly me: RedaxCustomerMe }
    >
  >
  logout(): Promise<RedaxCustomerApiResult<Record<never, never>>>
  listSetups(page: number): Promise<
    RedaxCustomerApiResult<{
      readonly items: readonly RedaxCustomerSetupSummary[]
      readonly page: number
      readonly total: number
      readonly hasMore: boolean
    }>
  >
  getSetup(id: string): Promise<RedaxCustomerApiResult<{ readonly setup: RedaxCustomerSetupRecordV1 }>>
  createSetup(): Promise<RedaxCustomerApiResult<{ readonly setup: RedaxCustomerSetupRecordV1 }>>
  saveSetup(input: {
    readonly id: string
    readonly expectedRevision: number
    readonly draft: Omit<RedaxCustomerDraftV1, 'logo'>
    readonly reopen?: boolean
  }): Promise<RedaxCustomerApiResult<{ readonly setup: RedaxCustomerSetupRecordV1 }>>
  deleteSetup(id: string, expectedRevision: number): Promise<RedaxCustomerApiResult<Record<never, never>>>
  uploadLogo(id: string, revision: number, bytes: Uint8Array): Promise<RedaxCustomerApiResult<{ readonly setup: RedaxCustomerSetupRecordV1 }>>
  previewLogo(sha256: string): Promise<RedaxCustomerApiResult<{ readonly bytes: Uint8Array }>>
  acceptLogo(id: string, expectedRevision: number, sha256: string): Promise<RedaxCustomerApiResult<{ readonly setup: RedaxCustomerSetupRecordV1 }>>
  prepare(id: string, expectedRevision: number): Promise<RedaxCustomerApiResult<{ readonly setup: RedaxCustomerSetupRecordV1 }>>
  publish(id: string, planHash: string): Promise<RedaxCustomerApiResult<{ readonly setup: RedaxCustomerSetupRecordV1 }>>
  verifyPublication(id: string): Promise<RedaxCustomerApiResult<Record<never, never>>>
  bind(id: string, campaign: string): Promise<RedaxCustomerApiResult<{ readonly setup: RedaxCustomerSetupRecordV1 }>>
  claimStatus(): Promise<RedaxCustomerApiResult<{ readonly claim: RedaxCustomerClaimView }>>
  claimEnter(input: {
    readonly setupId: string
    readonly planHash: string
    readonly request: RedaxCustomerClaimRequest
    /** This admission request's own random id (not a browser handle; never reused). */
    readonly attemptId: string
  }): Promise<RedaxCustomerApiResult<{ readonly claim: RedaxCustomerClaimView }>>
  /** Release exactly the named lease generation — never whatever happens to be held now. */
  claimRelease(input: { readonly leaseId: string }): Promise<RedaxCustomerApiResult<{ readonly claim: RedaxCustomerClaimView }>>
  operatorGrants(page: number): Promise<
    RedaxCustomerApiResult<{ readonly grants: readonly RedaxCustomerGrantSummary[]; readonly total: number; readonly hasMore: boolean }>
  >
  operatorGrantGet(wallet: string): Promise<RedaxCustomerApiResult<{ readonly grant: RedaxCustomerGrantRecordV1 | null }>>
  operatorGrantSet(input: {
    readonly wallet: string
    readonly status: RedaxCustomerGrantStatus
    readonly note: string
    readonly expectedRevision: number | null
  }): Promise<RedaxCustomerApiResult<{ readonly grant: RedaxCustomerGrantRecordV1 }>>
}

type FetchLike = (input: string, init: Record<string, unknown>) => Promise<{
  readonly ok: boolean
  readonly status: number
  readonly headers: { get(name: string): string | null }
  json(): Promise<unknown>
  arrayBuffer(): Promise<ArrayBuffer>
}>

export interface RedaxCustomerApiClientOptions {
  /** Defaults to the platform `fetch`. Injected in tests. */
  readonly fetchImpl?: FetchLike
  /** The non-secret session id to echo, or `null` before sign-in. Read on every call. */
  readonly sessionId: () => string | null
  /** Told when the server says the session is gone or changed, so the page re-reads `/me`. */
  readonly onSessionLost?: () => void
}

const NETWORK_FAILURE: RedaxCustomerApiFailure = Object.freeze({
  ok: false,
  code: 'NETWORK',
  message: 'The REDAX service could not be reached. Nothing was changed; check your connection and try again.',
  status: 0,
})

export function createRedaxCustomerApiClient(options: RedaxCustomerApiClientOptions): RedaxCustomerApiClient {
  const fetchImpl: FetchLike =
    options.fetchImpl ?? ((input, init) => (globalThis as unknown as { fetch: FetchLike }).fetch(input, init))

  async function request<T>(
    op: string,
    init: {
      readonly method: 'GET' | 'POST' | 'PUT'
      readonly query?: Record<string, string>
      readonly json?: unknown
      readonly bytes?: Uint8Array
      readonly binary?: boolean
    },
  ): Promise<RedaxCustomerApiResult<T>> {
    const params = new URLSearchParams({ op, ...(init.query ?? {}) })
    const headers: Record<string, string> = { [REDAX_CUSTOMER_REQUEST_HEADER]: '1' }
    const sessionId = options.sessionId()
    if (sessionId !== null) {
      headers[REDAX_CUSTOMER_SESSION_HEADER] = sessionId
    }
    let body: string | Uint8Array | undefined
    if (init.json !== undefined) {
      headers['content-type'] = 'application/json'
      body = JSON.stringify(init.json)
    } else if (init.bytes !== undefined) {
      headers['content-type'] = 'application/octet-stream'
      body = init.bytes
    }
    let response: Awaited<ReturnType<FetchLike>>
    try {
      response = await fetchImpl(`${REDAX_CUSTOMER_API_PATH}?${params.toString()}`, {
        method: init.method,
        headers,
        body,
        credentials: 'same-origin',
        cache: 'no-store',
        redirect: 'error',
      })
    } catch {
      return NETWORK_FAILURE
    }
    if (init.binary === true && response.ok) {
      try {
        return { ok: true, bytes: new Uint8Array(await response.arrayBuffer()) } as unknown as RedaxCustomerApiResult<T>
      } catch {
        return NETWORK_FAILURE
      }
    }
    let parsed: unknown
    try {
      parsed = await response.json()
    } catch {
      return { ...NETWORK_FAILURE, status: response.status }
    }
    if (typeof parsed !== 'object' || parsed === null) {
      return { ...NETWORK_FAILURE, status: response.status }
    }
    const record = parsed as Record<string, unknown>
    if (response.ok && record.ok === true) {
      return record as unknown as RedaxCustomerApiResult<T>
    }
    if ((record.code === 'SESSION_CHANGED' || record.code === 'NOT_SIGNED_IN') && op !== 'me') {
      options.onSessionLost?.()
    }
    return {
      ok: false,
      code: (typeof record.code === 'string' ? record.code : 'INTERNAL') as RedaxCustomerErrorCode,
      message: typeof record.message === 'string' ? record.message : 'Something went wrong.',
      status: response.status,
      issues: Array.isArray(record.issues) ? (record.issues as RedaxCustomerIssue[]) : undefined,
    }
  }

  return {
    config: () => request('config', { method: 'GET' }),
    me: () => request('me', { method: 'GET' }),
    challenge: (address) => request('auth.challenge', { method: 'POST', json: { address } }),
    verify: (body) => request('auth.verify', { method: 'POST', json: body }),
    logout: () => request('auth.logout', { method: 'POST', json: {} }),
    listSetups: (page) => request('workspace.list', { method: 'GET', query: { page: String(page) } }),
    getSetup: (id) => request('setup.get', { method: 'GET', query: { id } }),
    createSetup: () => request('setup.create', { method: 'POST', json: {} }),
    saveSetup: (input) => request('setup.save', { method: 'POST', json: input }),
    deleteSetup: (id, expectedRevision) => request('setup.delete', { method: 'POST', json: { id, expectedRevision } }),
    uploadLogo: (id, revision, bytes) =>
      request('logo.upload', { method: 'PUT', query: { id, revision: String(revision) }, bytes }),
    previewLogo: (sha256) => request('logo.preview', { method: 'GET', query: { sha: sha256 }, binary: true }),
    acceptLogo: (id, expectedRevision, sha256) => request('logo.accept', { method: 'POST', json: { id, expectedRevision, sha256 } }),
    prepare: (id, expectedRevision) => request('setup.prepare', { method: 'POST', json: { id, expectedRevision } }),
    publish: (id, planHash) => request('setup.publish', { method: 'POST', json: { id, planHash } }),
    verifyPublication: (id) => request('setup.verifyPublication', { method: 'POST', json: { id } }),
    bind: (id, campaign) => request('setup.bind', { method: 'POST', json: { id, campaign } }),
    claimStatus: () => request('claim.status', { method: 'POST', json: {} }),
    claimEnter: (input) => request('claim.enter', { method: 'POST', json: input }),
    claimRelease: (input) => request('claim.release', { method: 'POST', json: { leaseId: input.leaseId } }),
    operatorGrants: (page) => request('operator.grants', { method: 'GET', query: { page: String(page) } }),
    operatorGrantGet: (wallet) => request('operator.grant.get', { method: 'GET', query: { wallet } }),
    operatorGrantSet: (input) => request('operator.grant.set', { method: 'POST', json: input }),
  }
}

/** Standard base64 of bytes, for the SIWS verify body. */
export function redaxCustomerBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let index = 0; index < bytes.byteLength; index += 1) {
    binary += String.fromCharCode(bytes[index])
  }
  return (globalThis as unknown as { btoa(text: string): string }).btoa(binary)
}
