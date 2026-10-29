// REDAX customer service — record paths and strict record parsing.
//
// THE PATH IS THE TENANT BOUNDARY. Every private record of a customer lives under
// `v1/ws/<wallet>/…`, and that `<wallet>` is ALWAYS the signed-in session's wallet — never a
// value from the request. A guessed setup id, logo hash or path from another wallet therefore
// resolves inside the caller's own subtree, where it does not exist. There is no list
// operation over the store at all (listing is billed, and an index object is cheaper and
// bounded), and no request can name a path.
//
// RECORDS ARE PARSED, NOT TRUSTED. A record that does not match its schema exactly is treated
// as corrupt and the request fails closed; it is never "repaired" into something authoritative.

import { isCanonicalRedaxPublicKey } from '../src/config/redaxEnv.js'
import { isRedaxSha256Hex } from '../src/customer/shared/customerCanonical.js'
import {
  REDAX_CUSTOMER_DESCRIPTION_MAX_CHARS,
  REDAX_CUSTOMER_MAX_INPUT_ROWS,
  REDAX_CUSTOMER_TEAM_WRITE_OPERATIONS,
  type RedaxCustomerClaimRecordV1,
  type RedaxCustomerDraftRowV1,
  type RedaxCustomerDraftV1,
  type RedaxCustomerGrantRecordV1,
  type RedaxCustomerLogoRefV1,
  type RedaxCustomerSetupRecordV1,
  type RedaxCustomerTeamWriteOperation,
} from '../src/customer/shared/customerContract.js'

export const REDAX_CUSTOMER_PATHS = Object.freeze({
  nonce: (nonce: string): string => `v1/auth/nonce/${nonce}.json`,
  session: (sessionId: string): string => `v1/auth/session/${sessionId}.json`,
  grant: (wallet: string): string => `v1/grants/${wallet}.json`,
  grantsIndex: (): string => 'v1/grants-index.json',
  workspaceIndex: (wallet: string): string => `v1/ws/${wallet}/index.json`,
  setup: (wallet: string, setupId: string): string => `v1/ws/${wallet}/setups/${setupId}.json`,
  logo: (wallet: string, sha256: string): string => `v1/ws/${wallet}/logos/${sha256}.png`,
  claim: (programId: string, wallet: string): string => `v1/claims/devnet/${programId}/${wallet}.json`,
  claimAttempt: (programId: string, wallet: string, attemptId: string): string =>
    `v1/claims/devnet/${programId}/${wallet}/attempts/${attemptId}.json`,
})

export const REDAX_CUSTOMER_SETUP_ID_PATTERN = /^sp_[0-9a-f]{24}$/
export const REDAX_CUSTOMER_SESSION_ID_PATTERN = /^[0-9a-f]{32}$/
export const REDAX_CUSTOMER_SESSION_TOKEN_PATTERN = /^[0-9a-f]{64}$/
export const REDAX_CUSTOMER_BROWSER_HANDLE_PATTERN = /^[0-9a-f]{64}$/
/** A claim lease (server-minted) and a page attempt id: 128 random bits each, in hex. */
export const REDAX_CUSTOMER_CLAIM_ID_PATTERN = /^[0-9a-f]{32}$/
const ROW_ID_PATTERN = /^r[0-9a-z]{1,15}$/

/**
 * A session record. VERSION 2 IS BOUND TO THE SERVER SECRET: `secretTag` is a non-secret
 * fingerprint derived from the auth secret the session was issued under, and the cookie that
 * names this record carries a MAC under the same secret. A record of any other schema — every
 * version-1 record included — is not a session.
 */
export interface RedaxCustomerSessionRecordV2 {
  readonly schema: 'redax.customer.session.v2'
  readonly sessionId: string
  readonly wallet: string
  readonly tokenSha256: string
  readonly secretTag: string
  readonly createdAt: number
  readonly expiresAt: number
}

/**
 * ONE ATTEMPT ID, BOUND FOR GOOD. Created once (create-only) when an attempt id is first admitted,
 * under the same wallet + program + network boundary as the claim, and never rewritten or
 * deleted by the service: whatever later happens to the claim, that id stays bound to exactly
 * this request and this lease. `leaseId` also makes every creation's bytes unique, so a
 * create-only write can never mistake a second request for the first one's lost answer.
 */
export interface RedaxCustomerClaimAttemptRecordV1 {
  readonly schema: 'redax.customer.claim-attempt.v1'
  readonly team: string
  readonly network: 'devnet'
  readonly programId: string
  readonly attemptId: string
  readonly requestSha256: string
  readonly leaseId: string
  readonly createdAt: number
}

export interface RedaxCustomerWorkspaceIndexV1 {
  readonly schema: 'redax.customer.workspace.v1'
  readonly wallet: string
  readonly revision: number
  /** Newest first. */
  readonly setups: readonly { readonly id: string; readonly createdAt: number }[]
  readonly updatedAt: number
}

export interface RedaxCustomerGrantsIndexV1 {
  readonly schema: 'redax.customer.grants-index.v1'
  readonly revision: number
  readonly grants: readonly { readonly wallet: string; readonly status: 'ACTIVE' | 'STOP_NEW'; readonly note: string; readonly revision: number; readonly updatedAt: number }[]
  readonly updatedAt: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isTime(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function isRevision(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1
}

function isShortString(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length <= max
}

export function parseRedaxCustomerSession(value: unknown): RedaxCustomerSessionRecordV2 | null {
  if (
    !isRecord(value) ||
    value.schema !== 'redax.customer.session.v2' ||
    typeof value.sessionId !== 'string' ||
    !REDAX_CUSTOMER_SESSION_ID_PATTERN.test(value.sessionId) ||
    typeof value.wallet !== 'string' ||
    !isCanonicalRedaxPublicKey(value.wallet) ||
    !isRedaxSha256Hex(value.tokenSha256) ||
    typeof value.secretTag !== 'string' ||
    !REDAX_CUSTOMER_CLAIM_ID_PATTERN.test(value.secretTag) ||
    !isTime(value.createdAt) ||
    !isTime(value.expiresAt)
  ) {
    return null
  }
  return value as unknown as RedaxCustomerSessionRecordV2
}

export function parseRedaxCustomerGrant(value: unknown): RedaxCustomerGrantRecordV1 | null {
  if (
    !isRecord(value) ||
    value.schema !== 'redax.customer.grant.v1' ||
    typeof value.wallet !== 'string' ||
    !isCanonicalRedaxPublicKey(value.wallet) ||
    (value.status !== 'ACTIVE' && value.status !== 'STOP_NEW') ||
    !isShortString(value.note, 200) ||
    !isRevision(value.revision) ||
    !isTime(value.createdAt) ||
    !isTime(value.updatedAt) ||
    typeof value.updatedBy !== 'string' ||
    !isCanonicalRedaxPublicKey(value.updatedBy)
  ) {
    return null
  }
  return value as unknown as RedaxCustomerGrantRecordV1
}

export function parseRedaxCustomerGrantsIndex(value: unknown): RedaxCustomerGrantsIndexV1 | null {
  if (!isRecord(value) || value.schema !== 'redax.customer.grants-index.v1' || !isRevision(value.revision) || !Array.isArray(value.grants)) {
    return null
  }
  for (const entry of value.grants) {
    if (
      !isRecord(entry) ||
      typeof entry.wallet !== 'string' ||
      !isCanonicalRedaxPublicKey(entry.wallet) ||
      (entry.status !== 'ACTIVE' && entry.status !== 'STOP_NEW') ||
      !isShortString(entry.note, 200) ||
      !isRevision(entry.revision) ||
      !isTime(entry.updatedAt)
    ) {
      return null
    }
  }
  return value as unknown as RedaxCustomerGrantsIndexV1
}

export function parseRedaxCustomerWorkspaceIndex(value: unknown, wallet: string): RedaxCustomerWorkspaceIndexV1 | null {
  if (
    !isRecord(value) ||
    value.schema !== 'redax.customer.workspace.v1' ||
    value.wallet !== wallet ||
    !isRevision(value.revision) ||
    !Array.isArray(value.setups) ||
    !isTime(value.updatedAt)
  ) {
    return null
  }
  for (const entry of value.setups) {
    if (!isRecord(entry) || typeof entry.id !== 'string' || !REDAX_CUSTOMER_SETUP_ID_PATTERN.test(entry.id) || !isTime(entry.createdAt)) {
      return null
    }
  }
  return value as unknown as RedaxCustomerWorkspaceIndexV1
}

export function parseRedaxCustomerClaim(value: unknown): RedaxCustomerClaimRecordV1 | null {
  if (
    !isRecord(value) ||
    value.schema !== 'redax.customer.claim.v1' ||
    typeof value.team !== 'string' ||
    !isCanonicalRedaxPublicKey(value.team) ||
    value.network !== 'devnet' ||
    typeof value.programId !== 'string' ||
    (value.state !== 'FREE' && value.state !== 'HELD') ||
    !isRevision(value.revision) ||
    !isTime(value.updatedAt)
  ) {
    return null
  }
  if (value.state === 'HELD') {
    if (
      !isRedaxSha256Hex(value.holderHash) ||
      typeof value.leaseId !== 'string' ||
      !REDAX_CUSTOMER_CLAIM_ID_PATTERN.test(value.leaseId) ||
      typeof value.attemptId !== 'string' ||
      !REDAX_CUSTOMER_CLAIM_ID_PATTERN.test(value.attemptId) ||
      !isRedaxSha256Hex(value.requestSha256) ||
      typeof value.setupId !== 'string' ||
      !REDAX_CUSTOMER_SETUP_ID_PATTERN.test(value.setupId) ||
      typeof value.operation !== 'string' ||
      !(REDAX_CUSTOMER_TEAM_WRITE_OPERATIONS as readonly string[]).includes(value.operation) ||
      !isTime(value.heldAt)
    ) {
      return null
    }
  } else if (value.leaseId !== null || value.attemptId !== null || value.requestSha256 !== null) {
    // A FREE claim names no lease: nothing can be released from it, and nothing continues it.
    return null
  }
  return value as unknown as RedaxCustomerClaimRecordV1
}

export function parseRedaxCustomerClaimAttempt(value: unknown): RedaxCustomerClaimAttemptRecordV1 | null {
  if (
    !isRecord(value) ||
    value.schema !== 'redax.customer.claim-attempt.v1' ||
    typeof value.team !== 'string' ||
    !isCanonicalRedaxPublicKey(value.team) ||
    value.network !== 'devnet' ||
    typeof value.programId !== 'string' ||
    typeof value.attemptId !== 'string' ||
    !REDAX_CUSTOMER_CLAIM_ID_PATTERN.test(value.attemptId) ||
    !isRedaxSha256Hex(value.requestSha256) ||
    typeof value.leaseId !== 'string' ||
    !REDAX_CUSTOMER_CLAIM_ID_PATTERN.test(value.leaseId) ||
    !isTime(value.createdAt)
  ) {
    return null
  }
  return value as unknown as RedaxCustomerClaimAttemptRecordV1
}

function parseLogoRef(value: unknown): RedaxCustomerLogoRefV1 | null | undefined {
  if (value === null) {
    return null
  }
  if (
    !isRecord(value) ||
    !isRedaxSha256Hex(value.sha256) ||
    !isTime(value.byteLength) ||
    !isTime(value.width) ||
    !isTime(value.height) ||
    (value.sourceFormat !== 'png' && value.sourceFormat !== 'jpeg' && value.sourceFormat !== 'webp') ||
    !isTime(value.sourceWidth) ||
    !isTime(value.sourceHeight) ||
    !isTime(value.sourceByteLength) ||
    typeof value.transformed !== 'boolean' ||
    typeof value.accepted !== 'boolean'
  ) {
    return undefined
  }
  return value as unknown as RedaxCustomerLogoRefV1
}

/**
 * Accept the EDITABLE part of a draft from a request. Structure and bounds only: semantic
 * validation is `deriveRedaxCustomerPlanTerms`, at review time. The logo is never taken from
 * the request — it is whatever the server's own upload produced, passed in as `logo`.
 */
export function sanitizeRedaxCustomerDraftInput(
  value: unknown,
  logo: RedaxCustomerLogoRefV1 | null,
): RedaxCustomerDraftV1 | null {
  if (!isRecord(value)) {
    return null
  }
  const text = (key: string, max: number): string | null => {
    const entry = value[key]
    return typeof entry === 'string' && entry.length <= max ? entry : null
  }
  const name = text('name', 128)
  const symbol = text('symbol', 64)
  const description = text('description', REDAX_CUSTOMER_DESCRIPTION_MAX_CHARS * 2)
  const totalLimitAmount = text('totalLimitAmount', 64)
  const endLocal = text('endLocal', 32)
  const endZoneName = text('endZoneName', 64)
  const endUnixSeconds = text('endUnixSeconds', 20)
  const limitMode = (entry: unknown): 'LIMIT' | 'NONE' | null | undefined =>
    entry === null ? null : entry === 'LIMIT' || entry === 'NONE' ? entry : undefined
  const totalLimitMode = limitMode(value.totalLimitMode)
  const endMode = value.endMode === null ? null : value.endMode === 'NONE' || value.endMode === 'DATE' ? value.endMode : undefined
  const endZone = value.endZone === 'DEVICE' || value.endZone === 'UTC' ? value.endZone : undefined
  if (
    name === null ||
    symbol === null ||
    description === null ||
    totalLimitAmount === null ||
    endLocal === null ||
    endZoneName === null ||
    endUnixSeconds === null ||
    totalLimitMode === undefined ||
    endMode === undefined ||
    endZone === undefined ||
    !Array.isArray(value.rows) ||
    value.rows.length > REDAX_CUSTOMER_MAX_INPUT_ROWS
  ) {
    return null
  }
  const rows: RedaxCustomerDraftRowV1[] = []
  const seen = new Set<string>()
  for (const raw of value.rows) {
    if (!isRecord(raw)) {
      return null
    }
    const rowId = raw.rowId
    const legacyMint = raw.legacyMint
    const decimals = raw.legacyDecimals
    const rowLimitMode = limitMode(raw.limitMode)
    if (
      typeof rowId !== 'string' ||
      !ROW_ID_PATTERN.test(rowId) ||
      seen.has(rowId) ||
      typeof legacyMint !== 'string' ||
      legacyMint.length > 64 ||
      !(decimals === null || (typeof decimals === 'number' && Number.isSafeInteger(decimals) && decimals >= 0 && decimals <= 255)) ||
      !isShortString(raw.oldAmount, 64) ||
      !isShortString(raw.newAmount, 64) ||
      rowLimitMode === undefined ||
      !isShortString(raw.limitAmount, 64)
    ) {
      return null
    }
    seen.add(rowId)
    rows.push({
      rowId,
      legacyMint,
      legacyDecimals: decimals as number | null,
      oldAmount: raw.oldAmount as string,
      newAmount: raw.newAmount as string,
      limitMode: rowLimitMode,
      limitAmount: raw.limitAmount as string,
    })
  }
  return {
    name,
    symbol,
    description,
    logo,
    rows,
    totalLimitMode,
    totalLimitAmount,
    endMode,
    endLocal,
    endZone,
    endZoneName,
    endUnixSeconds,
  }
}

/** Parse a stored setup record. Strict on identity, state and ownership; `null` = corrupt. */
export function parseRedaxCustomerSetup(value: unknown, wallet: string, setupId: string): RedaxCustomerSetupRecordV1 | null {
  if (
    !isRecord(value) ||
    value.schema !== 'redax.customer.setup.v1' ||
    value.id !== setupId ||
    value.owner !== wallet ||
    value.network !== 'devnet' ||
    typeof value.programId !== 'string' ||
    !isRevision(value.revision) ||
    !isTime(value.createdAt) ||
    !isTime(value.updatedAt) ||
    !['DRAFT', 'REVIEW_READY', 'PUBLISHED', 'STARTED'].includes(value.state as string) ||
    !isRecord(value.draft) ||
    !Array.isArray(value.attempts)
  ) {
    return null
  }
  const logo = parseLogoRef(value.draft.logo)
  if (logo === undefined) {
    return null
  }
  const draft = sanitizeRedaxCustomerDraftInput(value.draft, logo)
  if (draft === null) {
    return null
  }
  const hasPlan = value.plan !== null
  if (hasPlan !== (value.planHash !== null) || (hasPlan && (!isRecord(value.plan) || !isRedaxSha256Hex(value.planHash)))) {
    return null
  }
  if ((value.state === 'DRAFT') === hasPlan) {
    return null
  }
  for (const attempt of value.attempts) {
    if (
      !isRecord(attempt) ||
      typeof attempt.campaign !== 'string' ||
      !isCanonicalRedaxPublicKey(attempt.campaign) ||
      typeof attempt.outputMint !== 'string' ||
      !isCanonicalRedaxPublicKey(attempt.outputMint) ||
      !isShortString(attempt.planFingerprint, 128) ||
      !isTime(attempt.at)
    ) {
      return null
    }
  }
  if (value.state === 'STARTED') {
    const campaign = value.campaign
    if (!isRecord(campaign) || typeof campaign.address !== 'string' || !isCanonicalRedaxPublicKey(campaign.address)) {
      return null
    }
  } else if (value.campaign !== null) {
    return null
  }
  return { ...(value as unknown as RedaxCustomerSetupRecordV1), draft }
}

/**
 * A DELETED draft. The setup record is not removed: a compare-and-set replaces it with this
 * marker at the same path. Every request that read the draft before the deletion then fails its
 * own compare-and-set (the ETag moved on), and every later read sees "deleted" — so neither an
 * old tab nor a delayed request can recreate it, whatever the provider does with a conditional
 * write to a missing object. It carries no draft content.
 */
export interface RedaxCustomerSetupTombstoneV1 {
  readonly schema: 'redax.customer.setup-deleted.v1'
  readonly id: string
  readonly owner: string
  /** The deleted record's revision + 1. */
  readonly revision: number
  readonly deletedAt: number
}

export function parseRedaxCustomerSetupTombstone(value: unknown, wallet: string, setupId: string): RedaxCustomerSetupTombstoneV1 | null {
  if (
    !isRecord(value) ||
    value.schema !== 'redax.customer.setup-deleted.v1' ||
    value.id !== setupId ||
    value.owner !== wallet ||
    !isRevision(value.revision) ||
    !isTime(value.deletedAt)
  ) {
    return null
  }
  return value as unknown as RedaxCustomerSetupTombstoneV1
}

export function isRedaxCustomerTeamWriteOperation(value: unknown): value is RedaxCustomerTeamWriteOperation {
  return typeof value === 'string' && (REDAX_CUSTOMER_TEAM_WRITE_OPERATIONS as readonly string[]).includes(value)
}
