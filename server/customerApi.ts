// REDAX customer service — THE request handler.
//
// ONE PIPELINE, EVERY ROUTE. Each operation below runs, in its own body and in this order:
//
//   1. the CSRF boundary (request header on every call, exact Origin on every write);
//   2. the SESSION — the HttpOnly cookie's MAC under the CURRENT auth secret is verified
//      first, and only a cookie that passes is looked up: a fresh read of the record it names;
//   3. the session-instance echo on writes, so a tab that still shows another wallet's
//      workspace cannot write into the one the shared cookie now names;
//   4. the TENANT — every private path is built from the session's wallet, never from input;
//   5. OBJECT OWNERSHIP — the record must parse as exactly that wallet's record;
//   6. the OPERATION PERMISSION — a fresh read of the wallet's grant, every time.
//
// Hiding a button in the UI decides nothing here. The same checks run whether or not the page
// would have offered the action.
//
// WHAT THE SERVER NEVER DOES: hold a key, build, sign, simulate, send or relay a transaction,
// fetch a URL a request supplied, proxy RPC, list the store, or accept a client's claim that a
// hash, a publication or a chain state is correct.

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { isCanonicalRedaxPublicKey } from '../src/config/redaxEnv.js'
import { canonicalizeRedaxTeamAdminMetadata } from '../src/teamAdmin/redaxTeamAdminMetadataCanonical.js'
import { isRedaxSha256Hex, redaxSha256Hex } from '../src/customer/shared/customerCanonical.js'
import {
  REDAX_CUSTOMER_GRANTS_PAGE_SIZE,
  REDAX_CUSTOMER_LOGO_MAX_INPUT_BYTES,
  REDAX_CUSTOMER_BROWSER_COOKIE,
  REDAX_CUSTOMER_BROWSER_COOKIE_MAX_AGE_SECONDS,
  REDAX_CUSTOMER_MAX_SETUPS_PER_WALLET,
  REDAX_CUSTOMER_SESSION_COOKIE,
  REDAX_CUSTOMER_SESSION_HEADER,
  REDAX_CUSTOMER_SESSION_TTL_SECONDS,
  REDAX_CUSTOMER_SETUPS_PAGE_SIZE,
  type RedaxCustomerClaimRecordV1,
  type RedaxCustomerClaimRequest,
  type RedaxCustomerClaimView,
  type RedaxCustomerGrantRecordV1,
  type RedaxCustomerGrantStatus,
  type RedaxCustomerMe,
  type RedaxCustomerPermissions,
  type RedaxCustomerPublicationV1,
  type RedaxCustomerServiceConfigView,
  type RedaxCustomerSetupRecordV1,
  type RedaxCustomerSetupSummary,
  type RedaxCustomerTeamWriteOperation,
} from '../src/customer/shared/customerContract.js'
import {
  redaxCustomerMetadataDocumentBytes,
  redaxCustomerPublicPath,
  verifyRedaxCustomerPublishedFiles,
} from '../src/customer/shared/customerMetadataDocument.js'
import {
  REDAX_CUSTOMER_URI_MAX_BYTES,
  buildRedaxCustomerPlan,
  computeRedaxCustomerPlanHash,
  deriveRedaxCustomerPlanTerms,
} from '../src/customer/shared/customerPlan.js'
import type { RedaxCustomerChainReader } from './customerChain.js'
import type { RedaxCustomerServerConfig } from './customerConfig.js'
import {
  RedaxCustomerHttpError,
  RedaxCustomerSoftRateLimiter,
  assertRedaxCustomerRequestOrigin,
  parseRedaxCustomerCookies,
  readRedaxCustomerBody,
  readRedaxCustomerJsonBody,
  redaxCustomerBytes,
  redaxCustomerError,
  redaxCustomerJson,
  redaxCustomerSessionCookie,
} from './customerHttp.js'
import type { RedaxCustomerImageNormalizer } from './customerImage.js'
import {
  REDAX_CUSTOMER_BROWSER_HANDLE_PATTERN,
  REDAX_CUSTOMER_CLAIM_ID_PATTERN,
  REDAX_CUSTOMER_PATHS as PATHS,
  REDAX_CUSTOMER_SESSION_ID_PATTERN,
  REDAX_CUSTOMER_SESSION_TOKEN_PATTERN,
  REDAX_CUSTOMER_SETUP_ID_PATTERN,
  isRedaxCustomerTeamWriteOperation,
  parseRedaxCustomerClaim,
  parseRedaxCustomerClaimAttempt,
  parseRedaxCustomerGrant,
  parseRedaxCustomerGrantsIndex,
  parseRedaxCustomerSession,
  parseRedaxCustomerSetup,
  parseRedaxCustomerSetupTombstone,
  parseRedaxCustomerWorkspaceIndex,
  sanitizeRedaxCustomerDraftInput,
  type RedaxCustomerClaimAttemptRecordV1,
  type RedaxCustomerGrantsIndexV1,
  type RedaxCustomerSessionRecordV2,
  type RedaxCustomerSetupTombstoneV1,
  type RedaxCustomerWorkspaceIndexV1,
} from './customerRecords.js'
import { createRedaxCustomerSignInInput, verifyRedaxCustomerSignIn } from './customerSiws.js'
import {
  RedaxCustomerStoreUnavailableError,
  encodeRedaxCustomerJson,
  parseRedaxCustomerStoredJson,
  type RedaxCustomerPrivateStore,
  type RedaxCustomerPublicStore,
  type RedaxCustomerStoredObject,
} from './customerStore.js'

export interface RedaxCustomerApiDeps {
  readonly config: RedaxCustomerServerConfig
  readonly privateStore: RedaxCustomerPrivateStore
  readonly publicStore: RedaxCustomerPublicStore
  readonly readCampaign: RedaxCustomerChainReader
  readonly normalizeLogo: RedaxCustomerImageNormalizer
  readonly nowMs?: () => number
  /** Server log hook: event names and non-secret counters only. */
  readonly log?: (event: string) => void
}

interface Session {
  readonly record: RedaxCustomerSessionRecordV2
  readonly wallet: string
  readonly operator: boolean
}

interface Context {
  readonly request: Request
  readonly url: URL
  readonly now: number
  session: Session | null
}

const JSON_TYPE = 'application/json'

function hex(bytes: number): string {
  return randomBytes(bytes).toString('hex')
}

function sha256HexOf(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

function fail(status: number, code: ConstructorParameters<typeof RedaxCustomerHttpError>[1]): never {
  throw new RedaxCustomerHttpError(status, code)
}

function permissionsFor(grant: RedaxCustomerGrantRecordV1 | null): RedaxCustomerPermissions {
  const active = grant?.status === 'ACTIVE'
  const continuing = active || grant?.status === 'STOP_NEW'
  return { create: active, completeStartedSetup: continuing, manageExisting: continuing, readReconcile: true }
}

function summaryOf(setup: RedaxCustomerSetupRecordV1): RedaxCustomerSetupSummary {
  return {
    id: setup.id,
    state: setup.state,
    revision: setup.revision,
    name: setup.plan?.token.name ?? setup.draft.name,
    symbol: setup.plan?.token.symbol ?? setup.draft.symbol,
    inputCount: setup.plan?.rows.length ?? setup.draft.rows.length,
    campaign: setup.campaign?.address ?? null,
    outputMint: setup.campaign?.outputMint ?? null,
    createdAt: setup.createdAt,
    updatedAt: setup.updatedAt,
    deletable:
      (setup.state === 'DRAFT' || setup.state === 'REVIEW_READY') &&
      setup.publishedAt === null &&
      setup.attempts.length === 0 &&
      setup.campaign === null,
  }
}

function claimViewOf(claim: RedaxCustomerClaimRecordV1 | null, handleHash: string | null): RedaxCustomerClaimView {
  if (claim === null || claim.state === 'FREE') {
    return { state: 'FREE', setupId: null, operation: null, campaign: null, heldAt: null, leaseId: null }
  }
  const mine = handleHash !== null && claim.holderHash === handleHash
  return {
    state: mine ? 'MINE' : 'OTHER',
    setupId: claim.setupId,
    operation: claim.operation,
    campaign: claim.campaign,
    heldAt: claim.heldAt,
    // Only the holding browser learns the lease; it is the one thing a release must name.
    leaseId: mine ? claim.leaseId : null,
  }
}

/** The claim as FREE: no holder, no lease, no request — a new revision of the same record. */
function freedClaim(claim: RedaxCustomerClaimRecordV1, now: number): RedaxCustomerClaimRecordV1 {
  return {
    ...claim,
    state: 'FREE',
    holderHash: null,
    leaseId: null,
    attemptId: null,
    requestSha256: null,
    setupId: null,
    planHash: null,
    operation: null,
    campaign: null,
    heldAt: null,
    revision: claim.revision + 1,
    updatedAt: now,
  }
}

const SESSION_COOKIE_VERSION = 's2'
const SESSION_EXPIRY_PATTERN = /^[1-9][0-9]{12}$/
const SESSION_MAC_PATTERN = /^[0-9a-f]{64}$/

export function createRedaxCustomerApi(deps: RedaxCustomerApiDeps): (request: Request) => Promise<Response> {
  const { config, privateStore, publicStore } = deps
  const nowMs = deps.nowMs ?? (() => Date.now())
  const log = deps.log ?? (() => undefined)
  const authLimiter = new RedaxCustomerSoftRateLimiter(30, 60_000)
  const cookieName = config.secureCookies ? REDAX_CUSTOMER_SESSION_COOKIE : 'redax_session_dev'
  const browserCookieName = config.secureCookies ? REDAX_CUSTOMER_BROWSER_COOKIE : 'redax_browser_dev'
  // THE SESSION CREDENTIAL IS BOUND TO THE CURRENT AUTH SECRET. A key derived from it (domain
  // separated from the sign-in challenge MAC) authenticates every session cookie, and a
  // non-secret tag derived from it is stored in every session record. Changing the secret
  // therefore ends, on every deployment that runs the new secret, every session issued under
  // the previous one: their cookies fail the MAC before any lookup, and their records no longer
  // carry the current tag.
  const sessionKey = createHmac('sha256', config.authSecret).update('redax.customer.session-key.v2').digest()
  const sessionSecretTag = createHmac('sha256', sessionKey).update('redax.customer.session-secret-tag.v2').digest('hex').slice(0, 32)

  // --- storage helpers ---------------------------------------------------------------------

  async function readJson<T>(path: string, parse: (value: unknown) => T | null): Promise<{ readonly value: T; readonly etag: string } | null> {
    const object: RedaxCustomerStoredObject | null = await privateStore.read(path)
    if (object === null) {
      return null
    }
    const value = parse(parseRedaxCustomerStoredJson(object))
    if (value === null) {
      // A record that does not parse is not an authority for anything. Fail closed.
      fail(500, 'INTERNAL')
    }
    return { value, etag: object.etag }
  }

  async function writeNew(path: string, value: unknown): Promise<boolean> {
    const result = await privateStore.create(path, encodeRedaxCustomerJson(value), JSON_TYPE)
    return result.ok
  }

  async function writeOver(path: string, value: unknown, etag: string): Promise<boolean> {
    const result = await privateStore.replace(path, encodeRedaxCustomerJson(value), JSON_TYPE, etag)
    return result.ok
  }

  /**
   * Read-modify-write a DERIVED object (an index) with a short bounded retry on conflict. A
   * `mutate` that returns `null` means "already as wanted": nothing is written.
   */
  async function updateDerived<T>(
    path: string,
    parse: (value: unknown) => T | null,
    mutate: (current: T | null) => T | null,
  ): Promise<T | null> {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const current = await readJson(path, parse)
      const next = mutate(current?.value ?? null)
      if (next === null) {
        return current?.value ?? null
      }
      const written = current === null ? await writeNew(path, next) : await writeOver(path, next, current.etag)
      if (written) {
        return next
      }
    }
    fail(503, 'STORE_UNAVAILABLE')
  }

  // --- session, grant, permission ----------------------------------------------------------

  function sessionMacOf(sessionId: string, token: string, expiresAt: number): Buffer {
    return createHmac('sha256', sessionKey).update(`redax.customer.session.v2|${sessionId}|${token}|${expiresAt}`).digest()
  }

  /** The cookie value: `s2.<session id>.<token>.<expiry ms>.<MAC under the current secret>`. */
  function sessionCookieValue(sessionId: string, token: string, expiresAt: number): string {
    return `${SESSION_COOKIE_VERSION}.${sessionId}.${token}.${expiresAt}.${sessionMacOf(sessionId, token, expiresAt).toString('hex')}`
  }

  /**
   * THE STORE IS NOT TOUCHED UNTIL THE COOKIE PROVES ITSELF. Version, shape, length and MAC
   * (constant-time, under the current secret) are checked first, then the expiry the MAC
   * covers; a forged, tampered, old-format, old-secret or expired cookie is refused with no
   * private-store read at all. Only then is the record read, and it must be a version-2 record
   * for the same id, token, secret tag and expiry — so logout (the record removed) and the
   * stored expiry keep ending a session exactly as before.
   */
  async function resolveSession(context: Context): Promise<Session | null> {
    const cookie = parseRedaxCustomerCookies(context.request).get(cookieName)
    if (cookie === undefined || cookie.length > 256) {
      return null
    }
    const parts = cookie.split('.')
    if (parts.length !== 5) {
      return null
    }
    const [version, sessionId, token, expiresText, mac] = parts
    if (
      version !== SESSION_COOKIE_VERSION ||
      !REDAX_CUSTOMER_SESSION_ID_PATTERN.test(sessionId) ||
      !REDAX_CUSTOMER_SESSION_TOKEN_PATTERN.test(token) ||
      !SESSION_EXPIRY_PATTERN.test(expiresText) ||
      !SESSION_MAC_PATTERN.test(mac)
    ) {
      return null
    }
    const expiresAt = Number(expiresText)
    if (!timingSafeEqual(sessionMacOf(sessionId, token, expiresAt), Buffer.from(mac, 'hex'))) {
      return null
    }
    if (!Number.isSafeInteger(expiresAt) || expiresAt <= context.now) {
      return null
    }
    const object = await privateStore.read(PATHS.session(sessionId))
    if (object === null) {
      return null
    }
    // An unparseable or older-schema record is not a session: its holder simply signs in again.
    const record = parseRedaxCustomerSession(parseRedaxCustomerStoredJson(object))
    if (record === null || record.sessionId !== sessionId || record.expiresAt !== expiresAt) {
      return null
    }
    if (!timingSafeEqual(Buffer.from(sha256HexOf(token), 'hex'), Buffer.from(record.tokenSha256, 'hex'))) {
      return null
    }
    if (!timingSafeEqual(Buffer.from(record.secretTag, 'hex'), Buffer.from(sessionSecretTag, 'hex'))) {
      return null
    }
    if (record.expiresAt <= context.now) {
      return null
    }
    return {
      record,
      wallet: record.wallet,
      // Operator status comes from server configuration on EVERY request, never from the
      // session record, so removing a wallet from the operator list takes effect at once.
      operator: config.operatorWallets.includes(record.wallet),
    }
  }

  async function requireSession(context: Context, options: { readonly echo: boolean }): Promise<Session> {
    const session = context.session ?? (await resolveSession(context))
    if (session === null) {
      fail(401, 'NOT_SIGNED_IN')
    }
    if (options.echo && context.request.headers.get(REDAX_CUSTOMER_SESSION_HEADER) !== session.record.sessionId) {
      fail(409, 'SESSION_CHANGED')
    }
    context.session = session
    return session
  }

  async function readGrant(wallet: string): Promise<RedaxCustomerGrantRecordV1 | null> {
    const stored = await readJson(PATHS.grant(wallet), parseRedaxCustomerGrant)
    if (stored !== null && stored.value.wallet !== wallet) {
      fail(500, 'INTERNAL')
    }
    return stored?.value ?? null
  }

  async function requirePermission(wallet: string, permission: keyof Omit<RedaxCustomerPermissions, 'readReconcile'>): Promise<RedaxCustomerGrantRecordV1> {
    const grant = await readGrant(wallet)
    if (grant === null) {
      fail(403, 'NO_ACCESS')
    }
    if (!permissionsFor(grant)[permission]) {
      fail(403, 'FORBIDDEN')
    }
    return grant
  }

  async function meOf(session: Session): Promise<RedaxCustomerMe> {
    const grant = await readGrant(session.wallet)
    return {
      wallet: session.wallet,
      sessionId: session.record.sessionId,
      expiresAt: session.record.expiresAt,
      operator: session.operator,
      grant: grant === null ? null : { status: grant.status, updatedAt: grant.updatedAt },
      permissions: permissionsFor(grant),
    }
  }

  // --- setups ------------------------------------------------------------------------------

  function setupIdFrom(value: unknown): string {
    if (typeof value !== 'string' || !REDAX_CUSTOMER_SETUP_ID_PATTERN.test(value)) {
      fail(400, 'BAD_REQUEST')
    }
    return value
  }

  /** The record at a setup path: a live setup, the marker of a deleted one, or nothing. */
  async function readSetupEntry(
    wallet: string,
    setupId: string,
  ): Promise<
    | { readonly kind: 'live'; readonly value: RedaxCustomerSetupRecordV1; readonly etag: string }
    | { readonly kind: 'deleted'; readonly value: RedaxCustomerSetupTombstoneV1; readonly etag: string }
    | null
  > {
    const object = await privateStore.read(PATHS.setup(wallet, setupId))
    if (object === null) {
      return null
    }
    const json = parseRedaxCustomerStoredJson(object)
    const tombstone = parseRedaxCustomerSetupTombstone(json, wallet, setupId)
    if (tombstone !== null) {
      return { kind: 'deleted', value: tombstone, etag: object.etag }
    }
    const value = parseRedaxCustomerSetup(json, wallet, setupId)
    if (value === null) {
      // A record that does not parse is not an authority for anything. Fail closed.
      fail(500, 'INTERNAL')
    }
    return { kind: 'live', value, etag: object.etag }
  }

  /**
   * The index entries whose record is a confirmed deletion marker: a delete whose last step (the
   * index) failed leaves one. Read only when the index is full, at most one read per entry. An
   * entry that cannot be read now is kept — only a marker actually read frees a slot.
   */
  async function deletedIndexEntries(wallet: string, entries: readonly { readonly id: string }[]): Promise<ReadonlySet<string>> {
    const deleted = new Set<string>()
    let unreadable: RedaxCustomerStoreUnavailableError | null = null
    for (const entry of entries) {
      try {
        if ((await readSetupEntry(wallet, entry.id))?.kind === 'deleted') {
          deleted.add(entry.id)
        }
      } catch (error) {
        if (error instanceof RedaxCustomerStoreUnavailableError) {
          unreadable ??= error
        } else if (!(error instanceof RedaxCustomerHttpError)) {
          throw error
        }
      }
    }
    if (deleted.size === 0 && unreadable !== null) {
      // Nothing could be freed and the check was incomplete: say "unavailable", not "full".
      throw unreadable
    }
    return deleted
  }

  /** A live setup. A deleted one is gone for every operation, exactly like one never created. */
  async function readSetup(wallet: string, setupId: string): Promise<{ readonly value: RedaxCustomerSetupRecordV1; readonly etag: string }> {
    const entry = await readSetupEntry(wallet, setupId)
    if (entry === null || entry.kind === 'deleted') {
      fail(404, 'NOT_FOUND')
    }
    return { value: entry.value, etag: entry.etag }
  }

  /**
   * DELETE DRAFT, NARROWLY. Only a draft whose setup never started may go: DRAFT or REVIEW_READY,
   * no plan files ever published, no Create attempt, no campaign, and no Team chain write held
   * for it. Anything that cannot be confirmed is kept.
   */
  async function refuseUnlessDeletableDraft(wallet: string, setup: RedaxCustomerSetupRecordV1): Promise<void> {
    if (
      (setup.state !== 'DRAFT' && setup.state !== 'REVIEW_READY') ||
      setup.publishedAt !== null ||
      setup.attempts.length > 0 ||
      setup.campaign !== null
    ) {
      fail(409, 'INVALID_STATE')
    }
    // A held claim always names a published setup, so none should name this one; if one does,
    // it is the recovery record of a chain step and the draft is kept.
    const claim = await readClaim(wallet)
    if (claim !== null && claim.value.state === 'HELD' && claim.value.setupId === setup.id) {
      fail(409, 'INVALID_STATE')
    }
    // A plan reopened for editing before `publishedAt` was kept across a reopen carries no
    // marker — but its final logo was published as the plan's image. If this draft's final logo
    // is public, the draft is kept (even when another draft published the same image).
    if (setup.draft.logo !== null && (await publicStore.read(redaxCustomerPublicPath(setup.draft.logo.sha256, 'png'))) !== null) {
      fail(409, 'INVALID_STATE')
    }
  }

  /**
   * `refusal` is a fixed log word naming the operation's branch, so the server log tells a
   * revision the page sent stale from a compare-and-set the store refused — both answer
   * `STALE_REVISION`. Never a value.
   */
  function expectRevision(setup: RedaxCustomerSetupRecordV1, value: unknown, refusal?: string): void {
    if (typeof value !== 'number' || value !== setup.revision) {
      if (refusal !== undefined) {
        log(refusal)
      }
      fail(409, 'STALE_REVISION')
    }
  }

  async function replaceSetup(
    wallet: string,
    current: { readonly value: RedaxCustomerSetupRecordV1; readonly etag: string },
    patch: Partial<RedaxCustomerSetupRecordV1>,
    now: number,
    refusal?: string,
  ): Promise<RedaxCustomerSetupRecordV1> {
    const next: RedaxCustomerSetupRecordV1 = { ...current.value, ...patch, revision: current.value.revision + 1, updatedAt: now }
    if (!(await writeOver(PATHS.setup(wallet, current.value.id), next, current.etag))) {
      if (refusal !== undefined) {
        log(refusal)
      }
      fail(409, 'STALE_REVISION')
    }
    return next
  }

  // --- claims ------------------------------------------------------------------------------

  /**
   * THIS BROWSER'S COORDINATION HANDLE, from its own HttpOnly cookie. JavaScript can neither
   * read nor set it, it survives sign-in and sign-out (so a new session is never a new owner),
   * and the server keeps only its SHA-256 in a claim. It is not authentication — the session
   * is. A browser that has none is given one in the response; it then holds nothing yet.
   */
  function browserHandleOf(context: Context): { readonly hash: string | null; readonly issue: string | null } {
    const value = parseRedaxCustomerCookies(context.request).get(browserCookieName)
    if (value !== undefined && REDAX_CUSTOMER_BROWSER_HANDLE_PATTERN.test(value)) {
      return { hash: sha256HexOf(value), issue: null }
    }
    return { hash: null, issue: hex(32) }
  }

  function browserCookieHeader(handle: string): Record<string, string> {
    return {
      'set-cookie': redaxCustomerSessionCookie({
        name: browserCookieName,
        value: handle,
        maxAgeSeconds: REDAX_CUSTOMER_BROWSER_COOKIE_MAX_AGE_SECONDS,
        secure: config.secureCookies,
      }),
    }
  }

  async function readClaim(wallet: string): Promise<{ readonly value: RedaxCustomerClaimRecordV1; readonly etag: string } | null> {
    const stored = await readJson(PATHS.claim(config.programId, wallet), parseRedaxCustomerClaim)
    if (stored !== null && (stored.value.team !== wallet || stored.value.programId !== config.programId)) {
      fail(500, 'INTERNAL')
    }
    return stored
  }

  /** Verify the plan's public files are served exactly as committed, right now. */
  async function verifyPublication(setup: RedaxCustomerSetupRecordV1): Promise<void> {
    const plan = setup.plan
    if (plan === null) {
      fail(409, 'INVALID_STATE')
    }
    const publication = plan.publication
    const jsonPath = redaxCustomerPublicPath(publication.jsonSha256, 'json')
    const imagePath = redaxCustomerPublicPath(publication.imageSha256, 'png')
    let reads: (RedaxCustomerStoredObject | null)[]
    try {
      reads = await Promise.all([
        publicStore.read(jsonPath),
        publicStore.read(imagePath),
        publicStore.fetchServed(jsonPath),
        publicStore.fetchServed(imagePath),
      ])
    } catch (error) {
      if (error instanceof RedaxCustomerStoreUnavailableError) {
        fail(503, 'PUBLICATION_UNAVAILABLE')
      }
      throw error
    }
    const [jsonOrigin, imageOrigin, jsonServed, imageServed] = reads
    if (jsonOrigin === null || imageOrigin === null || jsonServed === null || imageServed === null) {
      fail(503, 'PUBLICATION_UNAVAILABLE')
    }
    const expected = {
      name: plan.token.name,
      symbol: plan.token.symbol,
      description: plan.token.description,
      imageUri: publication.imageUri,
      jsonSha256: publication.jsonSha256,
      jsonByteLength: publication.jsonByteLength,
      imageSha256: publication.imageSha256,
      imageByteLength: publication.imageByteLength,
    }
    for (const [json, image] of [
      [jsonOrigin, imageOrigin],
      [jsonServed, imageServed],
    ] as const) {
      const check = await verifyRedaxCustomerPublishedFiles({
        expected,
        jsonBytes: json.bytes,
        jsonContentType: json.contentType,
        imageBytes: image.bytes,
        imageContentType: image.contentType,
      })
      if (!check.ok) {
        fail(409, 'PUBLICATION_MISMATCH')
      }
    }
  }

  /** The server-side half of a Team write's admission: permission, plan binding, state. */
  async function admitTeamWrite(
    wallet: string,
    setup: RedaxCustomerSetupRecordV1,
    request: RedaxCustomerClaimRequest,
  ): Promise<void> {
    const plan = setup.plan
    if (plan === null) {
      fail(409, 'INVALID_STATE')
    }
    if (request.operation === 'CREATE_CAMPAIGN') {
      await requirePermission(wallet, 'create')
      if (setup.state !== 'PUBLISHED') {
        fail(409, 'INVALID_STATE')
      }
      if (
        !isCanonicalRedaxPublicKey(request.campaign) ||
        !isCanonicalRedaxPublicKey(request.outputMint) ||
        typeof request.planFingerprint !== 'string' ||
        request.planFingerprint.length > 128
      ) {
        fail(400, 'BAD_REQUEST')
      }
      return
    }
    const managing = request.operation === 'PAUSE_CAMPAIGN' || request.operation === 'UNPAUSE_CAMPAIGN' || request.operation === 'FINALIZE_CAMPAIGN'
    await requirePermission(wallet, managing ? 'manageExisting' : 'completeStartedSetup')
    if (setup.state !== 'STARTED' || setup.campaign === null || request.campaign !== setup.campaign.address) {
      fail(409, 'INVALID_STATE')
    }
    if (request.operation === 'ADD_TOKEN_CONFIG') {
      const row = plan.rows.find((entry) => entry.legacyMint === request.legacyMint)
      if (
        row === undefined ||
        row.rateNumerator !== request.rateNumerator ||
        row.rateDenominator !== request.rateDenominator ||
        row.maxOutputFromTokenConfig !== request.maxOutputFromTokenConfig
      ) {
        fail(409, 'PLAN_INVALID')
      }
      return
    }
    if (request.operation === 'SETUP_METADATA') {
      if (
        request.metadataName !== plan.token.name ||
        request.metadataSymbol !== plan.token.symbol ||
        request.metadataUri !== plan.publication.jsonUri
      ) {
        fail(409, 'PLAN_INVALID')
      }
      // The exact JSON and image the wallet's metadata will point at, read again right now.
      await verifyPublication(setup)
    }
  }

  function parseClaimRequest(value: unknown): RedaxCustomerClaimRequest {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      fail(400, 'BAD_REQUEST')
    }
    const record = value as Record<string, unknown>
    const operation = record.operation
    if (!isRedaxCustomerTeamWriteOperation(operation) || typeof record.campaign !== 'string' || !isCanonicalRedaxPublicKey(record.campaign)) {
      fail(400, 'BAD_REQUEST')
    }
    const text = (key: string): string => {
      const entry = record[key]
      if (typeof entry !== 'string' || entry.length > 256) {
        fail(400, 'BAD_REQUEST')
      }
      return entry
    }
    switch (operation) {
      case 'CREATE_CAMPAIGN':
        return { operation, campaign: record.campaign, outputMint: text('outputMint'), planFingerprint: text('planFingerprint') }
      case 'ADD_TOKEN_CONFIG':
        return {
          operation,
          campaign: record.campaign,
          legacyMint: text('legacyMint'),
          rateNumerator: text('rateNumerator'),
          rateDenominator: text('rateDenominator'),
          maxOutputFromTokenConfig: text('maxOutputFromTokenConfig'),
        }
      case 'SETUP_METADATA':
        return {
          operation,
          campaign: record.campaign,
          metadataName: text('metadataName'),
          metadataSymbol: text('metadataSymbol'),
          metadataUri: text('metadataUri'),
        }
      default:
        return { operation, campaign: record.campaign }
    }
  }

  // --- operations --------------------------------------------------------------------------

  type Handler = (context: Context) => Promise<Response>

  const configView = (context: Context): RedaxCustomerServiceConfigView => ({
    configured: config.configured,
    signInOrigin: config.signInOrigin,
    signInHere: config.configured && context.url.origin === config.signInOrigin,
    network: 'devnet',
    programId: config.configured ? config.programId : null,
  })

  const operations: Record<string, { readonly method: 'GET' | 'POST' | 'PUT'; readonly handler: Handler; readonly anonymous?: boolean }> = {
    config: {
      method: 'GET',
      anonymous: true,
      handler: async (context) => redaxCustomerJson(200, { ok: true, config: configView(context) }),
    },

    me: {
      method: 'GET',
      handler: async (context) => {
        const session = await requireSession(context, { echo: false })
        return redaxCustomerJson(200, { ok: true, me: await meOf(session) })
      },
    },

    'auth.challenge': {
      method: 'POST',
      anonymous: true,
      handler: async (context) => {
        const body = await readRedaxCustomerJsonBody(context.request, 1024)
        const address = body.address
        if (typeof address !== 'string' || !isCanonicalRedaxPublicKey(address)) {
          fail(400, 'BAD_REQUEST')
        }
        if (context.url.origin !== config.signInOrigin) {
          // Sign-in exists on the one canonical origin only; an alias or preview URL gets a
          // pointer there instead of a challenge its wallet would sign for the wrong domain.
          fail(403, 'ORIGIN_REFUSED')
        }
        const input = createRedaxCustomerSignInInput(config, address, Math.floor(context.now / 1000))
        return redaxCustomerJson(200, { ok: true, input })
      },
    },

    'auth.verify': {
      method: 'POST',
      anonymous: true,
      handler: async (context) => {
        const body = await readRedaxCustomerJsonBody(context.request, 8 * 1024)
        const verification = verifyRedaxCustomerSignIn(config, body, Math.floor(context.now / 1000))
        if (!verification.ok) {
          log(`auth.verify.refused.${verification.reason}`)
          fail(401, 'SIGN_IN_REFUSED')
        }
        const wallet = verification.wallet
        const grant = await readGrant(wallet)
        const operator = config.operatorWallets.includes(wallet)
        if (grant === null && !operator) {
          // No access: say so, and write nothing at all. An unapproved wallet gets no session,
          // so it cannot read anything and costs no storage writes.
          return redaxCustomerJson(200, { ok: true, access: 'NONE', wallet })
        }
        const sessionId = hex(16)
        const token = hex(32)
        // SINGLE USE. Of two concurrent verifications of one signed message, exactly one can
        // create this marker; the session id inside makes the two attempts' bytes different, so
        // the loser can never be mistaken for a lost response of the winner.
        const marked = await writeNew(PATHS.nonce(verification.nonce), {
          schema: 'redax.customer.nonce.v1',
          wallet,
          sessionId,
          usedAt: context.now,
        })
        if (!marked) {
          log('auth.verify.replay')
          fail(401, 'SIGN_IN_REFUSED')
        }
        const record: RedaxCustomerSessionRecordV2 = {
          schema: 'redax.customer.session.v2',
          sessionId,
          wallet,
          tokenSha256: sha256HexOf(token),
          secretTag: sessionSecretTag,
          createdAt: context.now,
          expiresAt: context.now + REDAX_CUSTOMER_SESSION_TTL_SECONDS * 1000,
        }
        if (!(await writeNew(PATHS.session(sessionId), record))) {
          fail(503, 'STORE_UNAVAILABLE')
        }
        const session: Session = { record, wallet, operator }
        const response = redaxCustomerJson(200, { ok: true, access: 'GRANTED', me: await meOf(session) }, {
          'set-cookie': redaxCustomerSessionCookie({
            name: cookieName,
            value: sessionCookieValue(sessionId, token, record.expiresAt),
            maxAgeSeconds: REDAX_CUSTOMER_SESSION_TTL_SECONDS,
            secure: config.secureCookies,
          }),
        })
        // A browser seen for the first time also receives its coordination handle.
        const browser = browserHandleOf(context)
        if (browser.issue !== null) {
          response.headers.append('set-cookie', browserCookieHeader(browser.issue)['set-cookie'])
        }
        return response
      },
    },

    'auth.logout': {
      method: 'POST',
      anonymous: true,
      handler: async (context) => {
        const session = await resolveSession(context)
        if (session !== null) {
          await privateStore.remove(PATHS.session(session.record.sessionId))
        }
        return redaxCustomerJson(200, { ok: true }, {
          'set-cookie': redaxCustomerSessionCookie({ name: cookieName, value: '', maxAgeSeconds: 0, secure: config.secureCookies }),
        })
      },
    },

    'workspace.list': {
      method: 'GET',
      handler: async (context) => {
        const session = await requireSession(context, { echo: true })
        const page = Number(context.url.searchParams.get('page') ?? '0')
        if (!Number.isSafeInteger(page) || page < 0 || page > 100) {
          fail(400, 'BAD_REQUEST')
        }
        const index = await readJson(PATHS.workspaceIndex(session.wallet), (value) => parseRedaxCustomerWorkspaceIndex(value, session.wallet))
        const all = index?.value.setups ?? []
        const slice = all.slice(page * REDAX_CUSTOMER_SETUPS_PAGE_SIZE, (page + 1) * REDAX_CUSTOMER_SETUPS_PAGE_SIZE)
        const items: RedaxCustomerSetupSummary[] = []
        let missing = 0
        for (const entry of slice) {
          const stored = await readSetupEntry(session.wallet, entry.id)
          if (stored === null || stored.kind === 'deleted') {
            // A deleted draft whose index entry is not cleaned up yet is not listed.
            missing += 1
            continue
          }
          items.push(summaryOf(stored.value))
        }
        return redaxCustomerJson(200, {
          ok: true,
          items,
          page,
          pageSize: REDAX_CUSTOMER_SETUPS_PAGE_SIZE,
          total: all.length,
          hasMore: (page + 1) * REDAX_CUSTOMER_SETUPS_PAGE_SIZE < all.length,
          missing,
        })
      },
    },

    'setup.get': {
      method: 'GET',
      handler: async (context) => {
        const session = await requireSession(context, { echo: true })
        const setup = await readSetup(session.wallet, setupIdFrom(context.url.searchParams.get('id')))
        return redaxCustomerJson(200, { ok: true, setup: setup.value })
      },
    },

    'setup.create': {
      method: 'POST',
      handler: async (context) => {
        const session = await requireSession(context, { echo: true })
        await requirePermission(session.wallet, 'create')
        const indexPath = PATHS.workspaceIndex(session.wallet)
        const parseIndex = (value: unknown): RedaxCustomerWorkspaceIndexV1 | null => parseRedaxCustomerWorkspaceIndex(value, session.wallet)
        const existing = await readJson(indexPath, parseIndex)
        const listed = existing?.value.setups ?? []
        // A deleted draft holds no capacity, also when its index entry is still there.
        const reclaimed = listed.length >= REDAX_CUSTOMER_MAX_SETUPS_PER_WALLET ? await deletedIndexEntries(session.wallet, listed) : new Set<string>()
        if (listed.length - reclaimed.size >= REDAX_CUSTOMER_MAX_SETUPS_PER_WALLET) {
          fail(409, 'LIMIT_REACHED')
        }
        const id = `sp_${hex(12)}`
        const setup: RedaxCustomerSetupRecordV1 = {
          schema: 'redax.customer.setup.v1',
          id,
          owner: session.wallet,
          network: 'devnet',
          programId: config.programId,
          revision: 1,
          createdAt: context.now,
          updatedAt: context.now,
          state: 'DRAFT',
          draft: {
            name: '',
            symbol: '',
            description: '',
            logo: null,
            rows: [],
            totalLimitMode: null,
            totalLimitAmount: '',
            endMode: null,
            endLocal: '',
            endZone: 'DEVICE',
            endZoneName: '',
            endUnixSeconds: '',
          },
          plan: null,
          planHash: null,
          publishedAt: null,
          attempts: [],
          campaign: null,
        }
        // The record first, then the index: a crash between the two leaves an unlisted draft,
        // never a listed id that points at nothing.
        if (!(await writeNew(PATHS.setup(session.wallet, id), setup))) {
          fail(503, 'STORE_UNAVAILABLE')
        }
        // The limit is checked again on the very index that is written, so two creates never pass
        // it together. A marker is never live again, so its entry may go from any later index.
        let admitted = false
        await updateDerived(indexPath, parseIndex, (current): RedaxCustomerWorkspaceIndexV1 | null => {
          const kept = (current?.setups ?? []).filter((entry) => entry.id !== id && !reclaimed.has(entry.id))
          admitted = kept.length < REDAX_CUSTOMER_MAX_SETUPS_PER_WALLET
          return admitted
            ? {
                schema: 'redax.customer.workspace.v1',
                wallet: session.wallet,
                revision: (current?.revision ?? 0) + 1,
                setups: [{ id, createdAt: context.now }, ...kept],
                updatedAt: context.now,
              }
            : null
        })
        if (!admitted) {
          // The record written above stays unlisted, exactly as after a crash between the two.
          fail(409, 'LIMIT_REACHED')
        }
        return redaxCustomerJson(200, { ok: true, setup })
      },
    },

    'setup.save': {
      method: 'POST',
      handler: async (context) => {
        const session = await requireSession(context, { echo: true })
        const body = await readRedaxCustomerJsonBody(context.request)
        await requirePermission(session.wallet, 'create')
        const current = await readSetup(session.wallet, setupIdFrom(body.id))
        expectRevision(current.value, body.expectedRevision, 'setup.save.stale-revision.app')
        const reopen = body.reopen === true
        const state = current.value.state
        const editable =
          state === 'DRAFT' ||
          state === 'REVIEW_READY' ||
          (state === 'PUBLISHED' && reopen && current.value.attempts.length === 0)
        if (!editable) {
          fail(409, 'INVALID_STATE')
        }
        const draft = sanitizeRedaxCustomerDraftInput(body.draft, current.value.draft.logo)
        if (draft === null) {
          fail(400, 'BAD_REQUEST')
        }
        // `publishedAt` is kept: a reopened plan's files stay public, and that stays on record.
        const setup = await replaceSetup(
          session.wallet,
          current,
          { draft, state: 'DRAFT', plan: null, planHash: null },
          context.now,
          'setup.save.stale-revision.cas',
        )
        return redaxCustomerJson(200, { ok: true, setup })
      },
    },

    'setup.delete': {
      method: 'POST',
      handler: async (context) => {
        const session = await requireSession(context, { echo: true })
        const body = await readRedaxCustomerJsonBody(context.request)
        // Any customer who still has access may delete a draft of their own — also while new
        // campaigns are paused for them. A wallet without access deletes nothing.
        await requirePermission(session.wallet, 'manageExisting')
        const setupId = setupIdFrom(body.id)
        const setupPath = PATHS.setup(session.wallet, setupId)
        let entry = await readSetupEntry(session.wallet, setupId)
        if (entry === null) {
          fail(404, 'NOT_FOUND')
        }
        if (entry.kind === 'live') {
          const current = entry
          expectRevision(current.value, body.expectedRevision, 'setup.delete.stale-revision.app')
          await refuseUnlessDeletableDraft(session.wallet, current.value)
          const tombstone: RedaxCustomerSetupTombstoneV1 = {
            schema: 'redax.customer.setup-deleted.v1',
            id: setupId,
            owner: session.wallet,
            revision: current.value.revision + 1,
            deletedAt: context.now,
          }
          // Compare-and-set on the exact record that was checked: a save, prepare or publish
          // that landed in between moves the ETag, and then nothing is deleted.
          if (!(await writeOver(setupPath, tombstone, current.etag))) {
            entry = await readSetupEntry(session.wallet, setupId)
            if (entry === null || entry.kind !== 'deleted') {
              log('setup.delete.stale-revision.cas')
              fail(409, 'STALE_REVISION')
            }
          }
        }
        // Deleted — now, or by an earlier delivery of this same request whose answer was lost.
        // The listing follows. If that last step fails the deletion still stands and is answered
        // as done: the list already skips the entry, and a create that needs its slot frees it.
        try {
          await updateDerived(
            PATHS.workspaceIndex(session.wallet),
            (value) => parseRedaxCustomerWorkspaceIndex(value, session.wallet),
            (index): RedaxCustomerWorkspaceIndexV1 | null =>
              index === null || !index.setups.some((item) => item.id === setupId)
                ? null
                : {
                    schema: 'redax.customer.workspace.v1',
                    wallet: session.wallet,
                    revision: index.revision + 1,
                    setups: index.setups.filter((item) => item.id !== setupId),
                    updatedAt: context.now,
                  },
          )
        } catch (error) {
          if (error instanceof RedaxCustomerStoreUnavailableError) {
            log(`setup.delete.index-deferred${error.detail === null ? '' : ` ${error.detail}`}`)
          } else if (error instanceof RedaxCustomerHttpError && error.code === 'STORE_UNAVAILABLE') {
            log('setup.delete.index-deferred')
          } else {
            throw error
          }
        }
        return redaxCustomerJson(200, { ok: true })
      },
    },

    'logo.upload': {
      method: 'PUT',
      handler: async (context) => {
        const session = await requireSession(context, { echo: true })
        await requirePermission(session.wallet, 'create')
        const current = await readSetup(session.wallet, setupIdFrom(context.url.searchParams.get('id')))
        expectRevision(current.value, Number(context.url.searchParams.get('revision')))
        if (current.value.state !== 'DRAFT' && current.value.state !== 'REVIEW_READY') {
          fail(409, 'INVALID_STATE')
        }
        const bytes = await readRedaxCustomerBody(context.request, REDAX_CUSTOMER_LOGO_MAX_INPUT_BYTES)
        const normalized = await deps.normalizeLogo(bytes)
        if (!normalized.ok) {
          fail(normalized.code === 'PAYLOAD_TOO_LARGE' ? 413 : 415, normalized.code)
        }
        // Content-addressed, create-only: the same final image is stored once per wallet.
        const stored = await privateStore.create(PATHS.logo(session.wallet, normalized.sha256), normalized.png, 'image/png')
        if (!stored.ok) {
          const existing = await privateStore.read(PATHS.logo(session.wallet, normalized.sha256))
          if (existing === null || (await redaxSha256Hex(existing.bytes)) !== normalized.sha256) {
            fail(500, 'INTERNAL')
          }
        }
        const logo = {
          sha256: normalized.sha256,
          byteLength: normalized.png.byteLength,
          width: normalized.width,
          height: normalized.height,
          sourceFormat: normalized.sourceFormat,
          sourceWidth: normalized.sourceWidth,
          sourceHeight: normalized.sourceHeight,
          sourceByteLength: normalized.sourceByteLength,
          transformed: normalized.transformed,
          // A cropped or scaled result must be explicitly accepted; an unchanged square
          // re-encode is shown in the review like every other value.
          accepted: !normalized.transformed,
        }
        const setup = await replaceSetup(
          session.wallet,
          current,
          { draft: { ...current.value.draft, logo }, state: 'DRAFT', plan: null, planHash: null },
          context.now,
        )
        return redaxCustomerJson(200, { ok: true, setup })
      },
    },

    'logo.preview': {
      method: 'GET',
      handler: async (context) => {
        const session = await requireSession(context, { echo: true })
        const sha = context.url.searchParams.get('sha')
        if (!isRedaxSha256Hex(sha)) {
          fail(400, 'BAD_REQUEST')
        }
        const object = await privateStore.read(PATHS.logo(session.wallet, sha))
        if (object === null) {
          fail(404, 'NOT_FOUND')
        }
        return redaxCustomerBytes(object.bytes, 'image/png')
      },
    },

    'logo.accept': {
      method: 'POST',
      handler: async (context) => {
        const session = await requireSession(context, { echo: true })
        const body = await readRedaxCustomerJsonBody(context.request)
        await requirePermission(session.wallet, 'create')
        const current = await readSetup(session.wallet, setupIdFrom(body.id))
        expectRevision(current.value, body.expectedRevision)
        const logo = current.value.draft.logo
        if ((current.value.state !== 'DRAFT' && current.value.state !== 'REVIEW_READY') || logo === null || logo.sha256 !== body.sha256) {
          fail(409, 'INVALID_STATE')
        }
        const setup = await replaceSetup(
          session.wallet,
          current,
          { draft: { ...current.value.draft, logo: { ...logo, accepted: true } }, state: 'DRAFT', plan: null, planHash: null },
          context.now,
        )
        return redaxCustomerJson(200, { ok: true, setup })
      },
    },

    'setup.prepare': {
      method: 'POST',
      handler: async (context) => {
        const session = await requireSession(context, { echo: true })
        const body = await readRedaxCustomerJsonBody(context.request)
        await requirePermission(session.wallet, 'create')
        const current = await readSetup(session.wallet, setupIdFrom(body.id))
        expectRevision(current.value, body.expectedRevision)
        if (current.value.state !== 'DRAFT' && current.value.state !== 'REVIEW_READY') {
          fail(409, 'INVALID_STATE')
        }
        const derived = deriveRedaxCustomerPlanTerms(current.value.draft, Math.floor(context.now / 1000))
        if (!derived.ok) {
          return redaxCustomerJson(422, { ok: false, code: 'PLAN_INVALID', message: 'Some details are missing or not valid yet.', issues: derived.issues })
        }
        const terms = derived.terms
        const image = await privateStore.read(PATHS.logo(session.wallet, terms.logo.sha256))
        if (image === null || (await redaxSha256Hex(image.bytes)) !== terms.logo.sha256) {
          fail(409, 'PLAN_INVALID')
        }
        const imageUri = publicStore.publicUrl(redaxCustomerPublicPath(terms.logo.sha256, 'png'))
        const documentBytes = redaxCustomerMetadataDocumentBytes({
          name: terms.token.name,
          symbol: terms.token.symbol,
          description: terms.token.description,
          imageUri,
        })
        const jsonSha256 = await redaxSha256Hex(documentBytes)
        const jsonUri = publicStore.publicUrl(redaxCustomerPublicPath(jsonSha256, 'json'))
        if (new TextEncoder().encode(jsonUri).byteLength > REDAX_CUSTOMER_URI_MAX_BYTES) {
          fail(500, 'NOT_CONFIGURED')
        }
        // The exact on-chain metadata request this plan will make must already be canonical,
        // with the plan's own URI as the ONLY approved location.
        const canonical = await canonicalizeRedaxTeamAdminMetadata(
          { name: terms.token.name, symbol: terms.token.symbol, uri: jsonUri },
          { uriAllowlist: [jsonUri] },
        )
        if (!canonical.ok || canonical.metadata.name.value !== terms.token.name || canonical.metadata.symbol.value !== terms.token.symbol) {
          fail(422, 'PLAN_INVALID')
        }
        const publication: RedaxCustomerPublicationV1 = {
          imageUri,
          imageSha256: terms.logo.sha256,
          imageByteLength: image.bytes.byteLength,
          imageWidth: terms.logo.width,
          imageHeight: terms.logo.height,
          jsonUri,
          jsonSha256,
          jsonByteLength: documentBytes.byteLength,
        }
        const plan = buildRedaxCustomerPlan({
          setupId: current.value.id,
          programId: config.programId,
          teamWallet: session.wallet,
          terms,
          publication,
          preparedAt: context.now,
        })
        const planHash = await computeRedaxCustomerPlanHash(plan)
        const setup = await replaceSetup(session.wallet, current, { state: 'REVIEW_READY', plan, planHash }, context.now)
        return redaxCustomerJson(200, { ok: true, setup })
      },
    },

    'setup.publish': {
      method: 'POST',
      handler: async (context) => {
        const session = await requireSession(context, { echo: true })
        const body = await readRedaxCustomerJsonBody(context.request)
        const current = await readSetup(session.wallet, setupIdFrom(body.id))
        const setupValue = current.value
        if (setupValue.plan === null || setupValue.planHash === null || body.planHash !== setupValue.planHash) {
          fail(409, 'STALE_REVISION')
        }
        if (setupValue.state === 'REVIEW_READY' || setupValue.state === 'PUBLISHED') {
          await requirePermission(session.wallet, 'create')
        } else {
          // Re-publishing the exact files of a setup whose campaign already exists completes
          // that setup; it opens nothing new.
          await requirePermission(session.wallet, 'completeStartedSetup')
        }
        const plan = setupValue.plan
        const image = await privateStore.read(PATHS.logo(session.wallet, plan.publication.imageSha256))
        if (image === null || (await redaxSha256Hex(image.bytes)) !== plan.publication.imageSha256) {
          fail(409, 'PLAN_INVALID')
        }
        const documentBytes = redaxCustomerMetadataDocumentBytes({
          name: plan.token.name,
          symbol: plan.token.symbol,
          description: plan.token.description,
          imageUri: plan.publication.imageUri,
        })
        if ((await redaxSha256Hex(documentBytes)) !== plan.publication.jsonSha256) {
          fail(500, 'INTERNAL')
        }
        // Image first, document second: a document never names an image that is not there.
        for (const [path, bytes, type, uri] of [
          [redaxCustomerPublicPath(plan.publication.imageSha256, 'png'), image.bytes, 'image/png', plan.publication.imageUri],
          [redaxCustomerPublicPath(plan.publication.jsonSha256, 'json'), documentBytes, JSON_TYPE, plan.publication.jsonUri],
        ] as const) {
          const created = await publicStore.create(path, bytes, type)
          if (!created.ok) {
            const existing = await publicStore.read(path)
            if (existing === null || (await redaxSha256Hex(existing.bytes)) !== (await redaxSha256Hex(bytes))) {
              fail(409, 'PUBLICATION_CONFLICT')
            }
          } else if (created.url !== uri) {
            fail(500, 'NOT_CONFIGURED')
          }
        }
        await verifyPublication(setupValue)
        const setup =
          setupValue.state === 'REVIEW_READY'
            ? await replaceSetup(session.wallet, current, { state: 'PUBLISHED', publishedAt: context.now }, context.now)
            : setupValue
        return redaxCustomerJson(200, { ok: true, setup })
      },
    },

    'setup.verifyPublication': {
      method: 'POST',
      handler: async (context) => {
        const session = await requireSession(context, { echo: true })
        const body = await readRedaxCustomerJsonBody(context.request)
        const current = await readSetup(session.wallet, setupIdFrom(body.id))
        await verifyPublication(current.value)
        return redaxCustomerJson(200, { ok: true })
      },
    },

    'setup.bind': {
      method: 'POST',
      handler: async (context) => {
        const session = await requireSession(context, { echo: true })
        const body = await readRedaxCustomerJsonBody(context.request)
        const current = await readSetup(session.wallet, setupIdFrom(body.id))
        const campaignAddress = body.campaign
        if (typeof campaignAddress !== 'string' || !isCanonicalRedaxPublicKey(campaignAddress)) {
          fail(400, 'BAD_REQUEST')
        }
        const setupValue = current.value
        if (setupValue.state === 'STARTED') {
          if (setupValue.campaign?.address !== campaignAddress) {
            fail(409, 'CHAIN_MISMATCH')
          }
          return redaxCustomerJson(200, { ok: true, setup: setupValue })
        }
        if (setupValue.state !== 'PUBLISHED') {
          fail(409, 'INVALID_STATE')
        }
        // Only a campaign THIS setup's own Create request named can be bound — never an
        // address the page merely asserts.
        const attempt = setupValue.attempts.find((entry) => entry.campaign === campaignAddress)
        if (attempt === undefined) {
          fail(409, 'CHAIN_MISMATCH')
        }
        const read = await deps.readCampaign(campaignAddress)
        if (!read.ok) {
          fail(503, 'CHAIN_UNAVAILABLE')
        }
        const chain = read.campaign
        if (chain === null) {
          // Not on chain at finalized commitment yet. Nothing is concluded; check again later.
          fail(409, 'CHAIN_MISMATCH')
        }
        if (chain.campaignAdmin !== session.wallet || chain.outputMint !== attempt.outputMint) {
          fail(409, 'CHAIN_MISMATCH')
        }
        const setup = await replaceSetup(
          session.wallet,
          current,
          {
            state: 'STARTED',
            campaign: { address: campaignAddress, outputMint: attempt.outputMint, planFingerprint: attempt.planFingerprint, boundAt: context.now },
          },
          context.now,
        )
        return redaxCustomerJson(200, { ok: true, setup })
      },
    },

    'claim.status': {
      method: 'POST',
      handler: async (context) => {
        const session = await requireSession(context, { echo: true })
        const browser = browserHandleOf(context)
        const claim = await readClaim(session.wallet)
        return redaxCustomerJson(
          200,
          { ok: true, claim: claimViewOf(claim?.value ?? null, browser.hash) },
          browser.issue === null ? {} : browserCookieHeader(browser.issue),
        )
      },
    },

    'claim.enter': {
      method: 'POST',
      handler: async (context) => {
        const session = await requireSession(context, { echo: true })
        const body = await readRedaxCustomerJsonBody(context.request, 8 * 1024)
        const browser = browserHandleOf(context)
        const handleHash = browser.hash ?? sha256HexOf(browser.issue ?? '')
        const setupId = setupIdFrom(body.setupId)
        const request = parseClaimRequest(body.request)
        // The page's own id for THIS admission request. ONE ID IS ONE ADMISSION, FOR GOOD. The
        // same exact request delivered again while its own generation still holds the claim is
        // the same admission and the same lease. Anything else under an id that was used — the
        // exact request after the claim moved on or was released, or any different request — is
        // refused and writes nothing. The id's binding is its own record (`claimAttempt`), so it
        // outlives the claim.
        const attemptId = body.attemptId
        if (typeof attemptId !== 'string' || !REDAX_CUSTOMER_CLAIM_ID_PATTERN.test(attemptId)) {
          fail(400, 'BAD_REQUEST')
        }
        const current = await readSetup(session.wallet, setupId)
        if (current.value.planHash === null || body.planHash !== current.value.planHash) {
          fail(409, 'STALE_REVISION')
        }
        await admitTeamWrite(session.wallet, current.value, request)
        const requestSha256 = sha256HexOf(JSON.stringify({ setupId, planHash: current.value.planHash, request }))
        const claimPath = PATHS.claim(config.programId, session.wallet)
        const attemptPath = PATHS.claimAttempt(config.programId, session.wallet, attemptId)
        let entered: RedaxCustomerClaimRecordV1 | null = null
        let mintedHere = false
        let claim = await readClaim(session.wallet)
        if (claim !== null && claim.value.state === 'HELD' && claim.value.holderHash !== handleHash) {
          // Another browser holds an unresolved Team write. No timeout hands it over, and no
          // request can clear it: only that browser, from its own evidence, releases it.
          fail(409, 'CLAIM_HELD_ELSEWHERE')
        }
        if (claim !== null && claim.value.state === 'HELD' && claim.value.attemptId === attemptId) {
          if (claim.value.requestSha256 !== requestSha256) {
            fail(400, 'BAD_REQUEST')
          }
          // The same admission delivered again: the same lease, no claim written.
          entered = claim.value
        } else {
          // A NEW ADMISSION IS A NEW GENERATION. Its lease is minted here and never reused, so a
          // release carrying an earlier generation's lease — even from this same browser, even
          // one that read idle evidence a moment ago — can no longer free the claim. Its id is
          // bound to this exact request and this lease BEFORE any claim is written, by a
          // create-only record: of two requests carrying one id, exactly one creates it.
          const leaseId = hex(16)
          const binding: RedaxCustomerClaimAttemptRecordV1 = {
            schema: 'redax.customer.claim-attempt.v1',
            team: session.wallet,
            network: 'devnet',
            programId: config.programId,
            attemptId,
            requestSha256,
            leaseId,
            createdAt: context.now,
          }
          if (!(await writeNew(attemptPath, binding))) {
            const used = await readJson(attemptPath, parseRedaxCustomerClaimAttempt)
            if (used === null) {
              fail(503, 'STORE_UNAVAILABLE')
            }
            if (used.value.team !== session.wallet || used.value.programId !== config.programId || used.value.attemptId !== attemptId) {
              fail(500, 'INTERNAL')
            }
            if (used.value.requestSha256 !== requestSha256) {
              // An id is never carried over to another request, setup, plan or campaign.
              fail(400, 'BAD_REQUEST')
            }
            // The exact request again. Only while the generation it minted still holds the claim
            // is it the same admission; once the claim moved on or was released, it is refused —
            // never a new lease, never a continuation of anything newer.
            const now = await readClaim(session.wallet)
            if (now === null || now.value.state !== 'HELD' || now.value.holderHash !== handleHash || now.value.leaseId !== used.value.leaseId) {
              fail(409, 'ATTEMPT_ALREADY_USED')
            }
            entered = now.value
          } else {
            for (let round = 0; round < 3 && entered === null; round += 1) {
              if (round > 0) {
                claim = await readClaim(session.wallet)
              }
              if (claim !== null && claim.value.state === 'HELD' && claim.value.holderHash !== handleHash) {
                fail(409, 'CLAIM_HELD_ELSEWHERE')
              }
              const next: RedaxCustomerClaimRecordV1 = {
                schema: 'redax.customer.claim.v1',
                team: session.wallet,
                network: 'devnet',
                programId: config.programId,
                state: 'HELD',
                revision: (claim?.value.revision ?? 0) + 1,
                holderHash: handleHash,
                leaseId,
                attemptId,
                requestSha256,
                setupId,
                planHash: current.value.planHash,
                operation: request.operation as RedaxCustomerTeamWriteOperation,
                campaign: request.campaign,
                heldAt: claim !== null && claim.value.state === 'HELD' ? claim.value.heldAt : context.now,
                updatedAt: context.now,
              }
              const written = claim === null ? await writeNew(claimPath, next) : await writeOver(claimPath, next, claim.etag)
              if (written) {
                entered = next
                mintedHere = true
              }
            }
          }
        }
        if (entered === null) {
          fail(409, 'CLAIM_HELD_ELSEWHERE')
        }
        if (request.operation === 'CREATE_CAMPAIGN') {
          // Record the exact identity this setup's Create carries BEFORE the wallet is asked.
          // It is the only campaign this setup may later be bound to. A delivery of the same
          // admission again writes only if that identity is somehow not recorded yet.
          let recorded = false
          for (let attempt = 0; attempt < 3 && !recorded; attempt += 1) {
            const latest = await readSetup(session.wallet, setupId)
            if (
              !mintedHere &&
              latest.value.attempts.some(
                (entry) => entry.campaign === request.campaign && entry.outputMint === request.outputMint && entry.planFingerprint === request.planFingerprint,
              )
            ) {
              recorded = true
              break
            }
            const attempts = [
              ...latest.value.attempts.filter((entry) => entry.campaign !== request.campaign).slice(-7),
              { campaign: request.campaign, outputMint: request.outputMint, planFingerprint: request.planFingerprint, at: context.now },
            ]
            recorded = await writeOver(
              PATHS.setup(session.wallet, setupId),
              { ...latest.value, attempts, revision: latest.value.revision + 1, updatedAt: context.now },
              latest.etag,
            )
          }
          if (!recorded) {
            // Nothing has been asked of a wallet yet (this request is refused, so its page never
            // reaches one), so the claim is released and the step can simply be tried again —
            // but ONLY the generation this very request minted, by its lease and by CAS on the
            // record that carries it. A newer generation is never touched from here.
            const claim = await readClaim(session.wallet)
            if (mintedHere && claim !== null && claim.value.state === 'HELD' && claim.value.leaseId === entered.leaseId) {
              await writeOver(claimPath, freedClaim(claim.value, context.now), claim.etag)
            }
            fail(503, 'STORE_UNAVAILABLE')
          }
        }
        return redaxCustomerJson(
          200,
          { ok: true, claim: claimViewOf(entered, handleHash) },
          browser.issue === null ? {} : browserCookieHeader(browser.issue),
        )
      },
    },

    'claim.release': {
      method: 'POST',
      handler: async (context) => {
        const session = await requireSession(context, { echo: true })
        const body = await readRedaxCustomerJsonBody(context.request, 1024)
        const leaseId = body.leaseId
        if (typeof leaseId !== 'string' || !REDAX_CUSTOMER_CLAIM_ID_PATTERN.test(leaseId)) {
          fail(400, 'BAD_REQUEST')
        }
        const browser = browserHandleOf(context)
        const handleHash = browser.hash
        const claimPath = PATHS.claim(config.programId, session.wallet)
        for (let attempt = 0; attempt < 3; attempt += 1) {
          const claim = await readClaim(session.wallet)
          if (claim === null || claim.value.state === 'FREE') {
            return redaxCustomerJson(200, { ok: true, claim: claimViewOf(null, handleHash) })
          }
          if (handleHash === null || claim.value.holderHash !== handleHash) {
            fail(409, 'CLAIM_NOT_HELD')
          }
          // EXACTLY THE NAMED GENERATION. A different lease means a newer admission holds the
          // claim now; it is left untouched, and the caller is told so. A lost compare-and-set
          // re-reads and applies this same test again, so a retry can never adapt to a newer
          // generation and release it instead.
          if (claim.value.leaseId !== leaseId) {
            fail(409, 'CLAIM_LEASE_CHANGED')
          }
          const next = freedClaim(claim.value, context.now)
          if (await writeOver(claimPath, next, claim.etag)) {
            return redaxCustomerJson(200, { ok: true, claim: claimViewOf(next, handleHash) })
          }
        }
        fail(503, 'STORE_UNAVAILABLE')
      },
    },

    'operator.grants': {
      method: 'GET',
      handler: async (context) => {
        const session = await requireSession(context, { echo: true })
        if (!session.operator) {
          fail(403, 'FORBIDDEN')
        }
        const page = Number(context.url.searchParams.get('page') ?? '0')
        if (!Number.isSafeInteger(page) || page < 0 || page > 1000) {
          fail(400, 'BAD_REQUEST')
        }
        const index = await readJson(PATHS.grantsIndex(), parseRedaxCustomerGrantsIndex)
        const all = index?.value.grants ?? []
        return redaxCustomerJson(200, {
          ok: true,
          grants: all.slice(page * REDAX_CUSTOMER_GRANTS_PAGE_SIZE, (page + 1) * REDAX_CUSTOMER_GRANTS_PAGE_SIZE),
          page,
          total: all.length,
          hasMore: (page + 1) * REDAX_CUSTOMER_GRANTS_PAGE_SIZE < all.length,
        })
      },
    },

    'operator.grant.get': {
      method: 'GET',
      handler: async (context) => {
        const session = await requireSession(context, { echo: true })
        if (!session.operator) {
          fail(403, 'FORBIDDEN')
        }
        const wallet = context.url.searchParams.get('wallet') ?? ''
        if (!isCanonicalRedaxPublicKey(wallet)) {
          fail(400, 'BAD_REQUEST')
        }
        return redaxCustomerJson(200, { ok: true, grant: await readGrant(wallet) })
      },
    },

    'operator.grant.set': {
      method: 'POST',
      handler: async (context) => {
        const session = await requireSession(context, { echo: true })
        if (!session.operator) {
          fail(403, 'FORBIDDEN')
        }
        const body = await readRedaxCustomerJsonBody(context.request, 2048)
        const wallet = body.wallet
        const status = body.status
        const note = typeof body.note === 'string' ? body.note.trim() : ''
        if (
          typeof wallet !== 'string' ||
          !isCanonicalRedaxPublicKey(wallet) ||
          (status !== 'ACTIVE' && status !== 'STOP_NEW') ||
          note.length > 120 ||
          /[\u0000-\u001f\u007f]/.test(note)
        ) {
          fail(400, 'BAD_REQUEST')
        }
        const grantPath = PATHS.grant(wallet)
        const existing = await readJson(grantPath, parseRedaxCustomerGrant)
        const expected = body.expectedRevision
        if (existing === null ? expected !== null : expected !== existing.value.revision) {
          fail(409, 'STALE_REVISION')
        }
        const grant: RedaxCustomerGrantRecordV1 = {
          schema: 'redax.customer.grant.v1',
          wallet,
          status: status as RedaxCustomerGrantStatus,
          note,
          revision: (existing?.value.revision ?? 0) + 1,
          createdAt: existing?.value.createdAt ?? context.now,
          updatedAt: context.now,
          updatedBy: session.wallet,
        }
        // THE PER-WALLET RECORD IS THE AUTHORITY, written alone. Granting one customer never
        // rewrites another customer's record; the index below is a listing aid only.
        const written = existing === null ? await writeNew(grantPath, grant) : await writeOver(grantPath, grant, existing.etag)
        if (!written) {
          fail(409, 'STALE_REVISION')
        }
        await updateDerived(PATHS.grantsIndex(), parseRedaxCustomerGrantsIndex, (index): RedaxCustomerGrantsIndexV1 => ({
          schema: 'redax.customer.grants-index.v1',
          revision: (index?.revision ?? 0) + 1,
          grants: [
            { wallet, status: grant.status, note, revision: grant.revision, updatedAt: grant.updatedAt },
            ...(index?.grants ?? []).filter((entry) => entry.wallet !== wallet),
          ],
          updatedAt: context.now,
        }))
        return redaxCustomerJson(200, { ok: true, grant })
      },
    },
  }

  return async function handleRedaxCustomerRequest(request: Request): Promise<Response> {
    let url: URL
    try {
      url = new URL(request.url)
    } catch {
      return redaxCustomerError(400, 'BAD_REQUEST')
    }
    const op = url.searchParams.get('op') ?? ''
    const operation = Object.prototype.hasOwnProperty.call(operations, op) ? operations[op] : undefined
    if (operation === undefined) {
      return redaxCustomerError(404, 'UNKNOWN_OPERATION')
    }
    if (request.method !== operation.method) {
      return redaxCustomerError(405, 'METHOD_NOT_ALLOWED')
    }
    const context: Context = { request, url, now: nowMs(), session: null }
    try {
      assertRedaxCustomerRequestOrigin(request, config.allowedOrigins)
      if (op !== 'config' && !config.configured) {
        return redaxCustomerError(503, 'NOT_CONFIGURED')
      }
      if (op === 'auth.challenge' || op === 'auth.verify') {
        const client = (request.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown'
        if (!authLimiter.allow(`${op}:${client}`, context.now)) {
          return redaxCustomerError(429, 'RATE_LIMITED')
        }
      }
      return await operation.handler(context)
    } catch (error) {
      if (error instanceof RedaxCustomerHttpError) {
        return redaxCustomerError(error.status, error.code)
      }
      if (error instanceof RedaxCustomerStoreUnavailableError) {
        // Which primitive, record kind and provider error class — fixed words, never a value.
        log(`store.unavailable.${op}${error.detail === null ? '' : ` ${error.detail}`}`)
        return redaxCustomerError(503, 'STORE_UNAVAILABLE')
      }
      log(`internal.${op}`)
      return redaxCustomerError(500, 'INTERNAL')
    }
  }
}
