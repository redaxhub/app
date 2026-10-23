// REDAX customer service — Sign In With Solana (SIWS), server side.
//
// WHAT IS PROVEN. A session is issued only when ALL of these hold for one signed message:
//
//   * it parses as a SIWS message (the standard `@solana/wallet-standard-util` parser),
//   * its domain is exactly this deployment's sign-in host and its URI exactly its origin,
//   * its chain is `solana:devnet`, its version `1` and its statement the fixed REDAX one,
//   * its nonce is one THIS server issued for exactly these fields (an HMAC under the
//     server-only auth secret), and its issue/expiry window is current and short,
//   * the Ed25519 signature over the exact message verifies for the stated address
//     (`verifySignIn`, the same library the wallet ecosystem uses), and
//   * the nonce has never been used — enforced by a CREATE-ONLY marker, so of two concurrent
//     verifications of one message exactly one can create it and only that one gets a session.
//
// WHY THE CHALLENGE IS STATELESS. Issuing a challenge writes nothing: the nonce is a MAC over
// the fields, so an anonymous caller cannot spend storage operations by asking for challenges.
// Only a verification that already passed every check above, for a wallet that has access,
// writes anything at all.
//
// THERE IS NO GENERIC SIGNING SERVICE HERE. The server only ever issues the one fixed REDAX
// sign-in message for the one wallet that asked, and only ever accepts that message back.

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import bs58 from 'bs58'
import { parseSignInMessage, verifySignIn } from '@solana/wallet-standard-util'
import { isCanonicalRedaxPublicKey } from '../src/config/redaxEnv.js'
import {
  REDAX_CUSTOMER_CHALLENGE_TTL_SECONDS,
  REDAX_CUSTOMER_SIWS_CHAIN_ID,
  REDAX_CUSTOMER_SIWS_STATEMENT,
  REDAX_CUSTOMER_SIWS_VERSION,
  type RedaxCustomerSignInInput,
} from '../src/customer/shared/customerContract.js'

/** Clock skew tolerated between the wallet's device and the server, in seconds. */
const ISSUED_AT_SKEW_SECONDS = 120
const NONCE_PATTERN = /^[0-9a-f]{64}$/
const MAX_SIGNED_MESSAGE_BYTES = 2048

function isoSeconds(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z')
}

function parseIsoSeconds(value: string | undefined): number | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value)) {
    return null
  }
  const ms = Date.parse(value)
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null
}

function challengeMac(
  secret: Uint8Array,
  fields: Omit<RedaxCustomerSignInInput, 'nonce'> & { readonly random: string },
): string {
  const mac = createHmac('sha256', secret)
  // A length-prefixed concatenation: no field can be shifted into its neighbour.
  for (const part of [
    'redax-customer-siws-v1',
    fields.random,
    fields.domain,
    fields.address,
    fields.statement,
    fields.uri,
    fields.version,
    fields.chainId,
    fields.issuedAt,
    fields.expirationTime,
  ]) {
    mac.update(`${part.length}:${part};`)
  }
  return mac.digest('hex').slice(0, 32)
}

export interface RedaxCustomerSiwsConfig {
  readonly signInDomain: string
  readonly signInOrigin: string
  readonly authSecret: Uint8Array
}

/** Issue the one REDAX sign-in message input for `address`. Writes nothing. */
export function createRedaxCustomerSignInInput(
  config: RedaxCustomerSiwsConfig,
  address: string,
  nowSeconds: number,
): RedaxCustomerSignInInput {
  const issuedAt = isoSeconds(nowSeconds)
  const expirationTime = isoSeconds(nowSeconds + REDAX_CUSTOMER_CHALLENGE_TTL_SECONDS)
  const random = randomBytes(16).toString('hex')
  const base = {
    domain: config.signInDomain,
    address,
    statement: REDAX_CUSTOMER_SIWS_STATEMENT,
    uri: `${config.signInOrigin}/`,
    version: REDAX_CUSTOMER_SIWS_VERSION,
    chainId: REDAX_CUSTOMER_SIWS_CHAIN_ID,
    issuedAt,
    expirationTime,
  }
  return { ...base, nonce: `${random}${challengeMac(config.authSecret, { ...base, random })}` }
}

export type RedaxCustomerSiwsVerification =
  | { readonly ok: true; readonly wallet: string; readonly nonce: string; readonly expiresAtSeconds: number }
  | { readonly ok: false; readonly reason: string }

function decodeBase64(value: unknown, maxBytes: number): Uint8Array | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > Math.ceil((maxBytes * 4) / 3) + 4) {
    return null
  }
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    return null
  }
  const bytes = new Uint8Array(Buffer.from(value, 'base64'))
  return bytes.byteLength > 0 && bytes.byteLength <= maxBytes ? bytes : null
}

/**
 * Verify one signed SIWS message. Pure apart from the clock and the HMAC; writes nothing.
 *
 * The single-use rule is NOT here: the caller enforces it with a create-only marker after this
 * returns `ok`, so that verification itself stays side-effect free and testable.
 */
export function verifyRedaxCustomerSignIn(
  config: RedaxCustomerSiwsConfig,
  body: { readonly address?: unknown; readonly signedMessage?: unknown; readonly signature?: unknown },
  nowSeconds: number,
): RedaxCustomerSiwsVerification {
  const address = body.address
  if (typeof address !== 'string' || !isCanonicalRedaxPublicKey(address)) {
    return { ok: false, reason: 'address' }
  }
  const signedMessage = decodeBase64(body.signedMessage, MAX_SIGNED_MESSAGE_BYTES)
  const signature = decodeBase64(body.signature, 64)
  if (signedMessage === null || signature === null || signature.byteLength !== 64) {
    return { ok: false, reason: 'encoding' }
  }
  const parsed = parseSignInMessage(signedMessage)
  if (parsed === null) {
    return { ok: false, reason: 'parse' }
  }
  if (
    parsed.domain !== config.signInDomain ||
    parsed.address !== address ||
    parsed.statement !== REDAX_CUSTOMER_SIWS_STATEMENT ||
    parsed.uri !== `${config.signInOrigin}/` ||
    parsed.version !== REDAX_CUSTOMER_SIWS_VERSION ||
    parsed.chainId !== REDAX_CUSTOMER_SIWS_CHAIN_ID ||
    parsed.notBefore !== undefined ||
    parsed.requestId !== undefined ||
    parsed.resources !== undefined
  ) {
    return { ok: false, reason: 'fields' }
  }
  const nonce = parsed.nonce
  if (typeof nonce !== 'string' || !NONCE_PATTERN.test(nonce)) {
    return { ok: false, reason: 'nonce' }
  }
  const issuedAt = parseIsoSeconds(parsed.issuedAt)
  const expiresAt = parseIsoSeconds(parsed.expirationTime)
  if (issuedAt === null || expiresAt === null || parsed.issuedAt === undefined || parsed.expirationTime === undefined) {
    return { ok: false, reason: 'time' }
  }
  if (
    expiresAt - issuedAt !== REDAX_CUSTOMER_CHALLENGE_TTL_SECONDS ||
    nowSeconds + ISSUED_AT_SKEW_SECONDS < issuedAt ||
    nowSeconds >= expiresAt
  ) {
    return { ok: false, reason: 'window' }
  }
  // Every field below was just proven equal to the issued constant, so the MAC is recomputed
  // over exactly the values this server would have issued.
  const fields = {
    domain: config.signInDomain,
    address,
    statement: REDAX_CUSTOMER_SIWS_STATEMENT,
    uri: `${config.signInOrigin}/`,
    version: REDAX_CUSTOMER_SIWS_VERSION,
    chainId: REDAX_CUSTOMER_SIWS_CHAIN_ID,
    issuedAt: parsed.issuedAt,
    expirationTime: parsed.expirationTime,
  }
  const expectedMac = challengeMac(config.authSecret, { ...fields, random: nonce.slice(0, 32) })
  if (!timingSafeEqual(Buffer.from(expectedMac, 'hex'), Buffer.from(nonce.slice(32), 'hex'))) {
    return { ok: false, reason: 'mac' }
  }
  let publicKey: Uint8Array
  try {
    publicKey = bs58.decode(address)
  } catch {
    return { ok: false, reason: 'address' }
  }
  const input: RedaxCustomerSignInInput = { ...fields, nonce }
  let verified = false
  try {
    verified = verifySignIn(input, {
      account: { address, publicKey, chains: [], features: [] },
      signedMessage,
      signature,
    } as Parameters<typeof verifySignIn>[1])
  } catch {
    verified = false
  }
  if (!verified) {
    return { ok: false, reason: 'signature' }
  }
  return { ok: true, wallet: address, nonce, expiresAtSeconds: expiresAt }
}
