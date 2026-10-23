// REDAX customer service — server-only configuration.
//
// EVERY VALUE HERE IS SERVER-ONLY. None of these names starts with `VITE_`, none is read by the
// browser bundle, and none is echoed by any response. The browser learns only the public facts
// in `RedaxCustomerServiceConfigView` (the sign-in origin and the program id).
//
// NO SILENT DEFAULT GRANTS ANYTHING. A missing store id, a missing auth secret or a malformed
// operator list makes the service `configured: false`, and every operation then answers
// `NOT_CONFIGURED`. There is no in-memory fallback and no "everybody approved" mode in
// production: the local adapter exists only behind an explicit development flag that is
// refused on Vercel.

import { isCanonicalRedaxPublicKey } from '../src/config/redaxEnv.js'

export interface RedaxCustomerServerConfig {
  readonly configured: boolean
  /** Why the service is not configured; server logs only, never a response body. */
  readonly problems: readonly string[]
  readonly development: boolean
  /** The SIWS `domain`, e.g. `app.redaxhub.com`. */
  readonly signInDomain: string
  /** The one origin Team sign-in works on, e.g. `https://app.redaxhub.com`. */
  readonly signInOrigin: string
  /** Origins whose writes are accepted. Production: exactly `[signInOrigin]`. */
  readonly allowedOrigins: readonly string[]
  readonly programId: string
  readonly operatorWallets: readonly string[]
  readonly authSecret: Uint8Array
  readonly privateStoreId: string
  readonly publicStoreId: string
  /** Optional explicit read-write tokens; when absent the SDK uses Vercel OIDC + store id. */
  readonly privateStoreToken: string | null
  readonly publicStoreToken: string | null
  readonly publicBaseUrl: string
  readonly rpcUrl: string
  /** `__Host-` cookies require Secure; local http development uses a plain name instead. */
  readonly secureCookies: boolean
}

export type RedaxCustomerRawEnv = Readonly<Record<string, string | undefined>>

export const REDAX_CUSTOMER_SERVER_ENV = Object.freeze({
  signInOrigin: 'REDAX_CUSTOMER_SIGN_IN_ORIGIN',
  programId: 'REDAX_CUSTOMER_PROGRAM_ID',
  operatorWallets: 'REDAX_CUSTOMER_OPERATOR_WALLETS',
  authSecret: 'REDAX_CUSTOMER_AUTH_SECRET',
  privateStoreId: 'REDAX_CUSTOMER_PRIVATE_STORE_ID',
  publicStoreId: 'REDAX_CUSTOMER_PUBLIC_STORE_ID',
  privateStoreToken: 'REDAX_CUSTOMER_PRIVATE_STORE_TOKEN',
  publicStoreToken: 'REDAX_CUSTOMER_PUBLIC_STORE_TOKEN',
  publicBaseUrl: 'REDAX_CUSTOMER_PUBLIC_BASE_URL',
  rpcUrl: 'REDAX_CUSTOMER_DEVNET_RPC_URL',
  development: 'REDAX_CUSTOMER_DEVELOPMENT',
})

export const REDAX_CUSTOMER_DEFAULT_SIGN_IN_ORIGIN = 'https://app.redaxhub.com'
export const REDAX_CUSTOMER_DEFAULT_DEVNET_RPC_URL = 'https://api.devnet.solana.com'

function trimmed(value: string | undefined): string {
  return typeof value === 'string' ? value.trim() : ''
}

function parseOrigin(value: string, allowHttpLoopback: boolean): string | null {
  try {
    const url = new URL(value)
    const loopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1'
    if (url.protocol !== 'https:' && !(allowHttpLoopback && loopback && url.protocol === 'http:')) {
      return null
    }
    if (url.username !== '' || url.password !== '' || url.pathname !== '/' || url.search !== '' || url.hash !== '') {
      return null
    }
    return url.origin
  } catch {
    return null
  }
}

function parseSecret(value: string): Uint8Array | null {
  // At least 32 characters of whatever the owner generated; the bytes are used as an HMAC
  // key, so the encoding does not matter, only the entropy behind it.
  if (value.length < 32 || value.length > 512) {
    return null
  }
  return new TextEncoder().encode(value)
}

function normalizeStoreId(value: string): string {
  return value.startsWith('store_') ? value.slice('store_'.length) : value
}

/**
 * Resolve the server configuration from an environment snapshot. Pure and total.
 *
 * `onVercel` is passed in rather than read, so a test can prove the development flag is
 * refused on Vercel without touching `process.env`.
 */
export function resolveRedaxCustomerServerConfig(
  env: RedaxCustomerRawEnv,
  options: { readonly onVercel: boolean },
): RedaxCustomerServerConfig {
  const problems: string[] = []
  const developmentRequested = trimmed(env[REDAX_CUSTOMER_SERVER_ENV.development]) === '1'
  if (developmentRequested && options.onVercel) {
    problems.push('the development flag is refused on Vercel')
  }
  const development = developmentRequested && !options.onVercel

  const originRaw = trimmed(env[REDAX_CUSTOMER_SERVER_ENV.signInOrigin]) || REDAX_CUSTOMER_DEFAULT_SIGN_IN_ORIGIN
  const signInOrigin = parseOrigin(originRaw, development)
  if (signInOrigin === null) {
    problems.push('sign-in origin is not an https origin')
  }
  const signInDomain = signInOrigin === null ? '' : new URL(signInOrigin).host

  const programId = trimmed(env[REDAX_CUSTOMER_SERVER_ENV.programId])
  if (!isCanonicalRedaxPublicKey(programId)) {
    problems.push('program id is missing or not canonical')
  }

  const operatorWallets = trimmed(env[REDAX_CUSTOMER_SERVER_ENV.operatorWallets])
    .split(/[\s,]+/)
    .filter((entry) => entry !== '')
  if (operatorWallets.length === 0) {
    problems.push('no operator wallet is configured')
  }
  if (operatorWallets.some((wallet) => !isCanonicalRedaxPublicKey(wallet))) {
    problems.push('an operator wallet is not canonical')
  }
  if (new Set(operatorWallets).size !== operatorWallets.length) {
    problems.push('an operator wallet is listed twice')
  }

  const authSecret = parseSecret(trimmed(env[REDAX_CUSTOMER_SERVER_ENV.authSecret]))
  if (authSecret === null) {
    problems.push('auth secret is missing or shorter than 32 characters')
  }

  const privateStoreId = normalizeStoreId(trimmed(env[REDAX_CUSTOMER_SERVER_ENV.privateStoreId]))
  const publicStoreId = normalizeStoreId(trimmed(env[REDAX_CUSTOMER_SERVER_ENV.publicStoreId]))
  if (!development) {
    if (!/^[A-Za-z0-9]{8,64}$/.test(privateStoreId)) {
      problems.push('private store id is missing')
    }
    if (!/^[A-Za-z0-9]{8,64}$/.test(publicStoreId)) {
      problems.push('public store id is missing')
    }
    if (privateStoreId !== '' && privateStoreId === publicStoreId) {
      problems.push('private and public store ids must differ')
    }
  }

  // THE SDK'S AMBIENT FALLBACK IS REFUSED. Without an OIDC token the SDK silently uses
  // `BLOB_READ_WRITE_TOKEN` — and the store THAT token names, whatever `storeId` says. A
  // default-named token in this project could therefore route private records to the wrong
  // store, so its mere presence makes the service unconfigured: connect both stores with a
  // custom environment-variable prefix instead.
  if (trimmed(env.BLOB_READ_WRITE_TOKEN) !== '') {
    problems.push('an ambient BLOB_READ_WRITE_TOKEN is present; connect the stores with a custom prefix')
  }
  const tokenFor = (name: string, storeId: string): string | null => {
    const token = trimmed(env[name])
    if (token === '') {
      return null
    }
    const parts = token.split('_')
    if (parts.length < 5 || parts[0] !== 'vercel' || parts[1] !== 'blob' || parts[2] !== 'rw' || normalizeStoreId(parts[3]) !== storeId) {
      problems.push(`${name} does not belong to its configured store`)
      return null
    }
    return token
  }
  const privateStoreToken = tokenFor(REDAX_CUSTOMER_SERVER_ENV.privateStoreToken, privateStoreId)
  const publicStoreToken = tokenFor(REDAX_CUSTOMER_SERVER_ENV.publicStoreToken, publicStoreId)

  const explicitBase = trimmed(env[REDAX_CUSTOMER_SERVER_ENV.publicBaseUrl])
  let publicBaseUrl = ''
  if (explicitBase !== '') {
    const parsed = parseOrigin(explicitBase.endsWith('/') ? explicitBase : `${explicitBase}/`, development)
    if (parsed === null) {
      problems.push('public base URL is not an https origin')
    } else {
      publicBaseUrl = parsed
    }
  } else if (publicStoreId !== '') {
    publicBaseUrl = `https://${publicStoreId.toLowerCase()}.public.blob.vercel-storage.com`
  } else if (!development) {
    problems.push('public base URL cannot be derived')
  }

  const rpcRaw = trimmed(env[REDAX_CUSTOMER_SERVER_ENV.rpcUrl]) || REDAX_CUSTOMER_DEFAULT_DEVNET_RPC_URL
  let rpcUrl = ''
  try {
    const url = new URL(rpcRaw)
    if (url.protocol === 'https:' && url.username === '' && url.password === '') {
      rpcUrl = url.toString()
    }
  } catch {
    rpcUrl = ''
  }
  if (rpcUrl === '') {
    problems.push('devnet RPC URL is not an https URL')
  }

  const allowedOrigins = signInOrigin === null ? [] : [signInOrigin]
  return {
    configured: problems.length === 0,
    problems,
    development,
    signInDomain,
    signInOrigin: signInOrigin ?? '',
    allowedOrigins,
    programId,
    operatorWallets,
    authSecret: authSecret ?? new Uint8Array(0),
    privateStoreId,
    publicStoreId,
    privateStoreToken,
    publicStoreToken,
    publicBaseUrl,
    rpcUrl,
    secureCookies: !development || signInOrigin === null || signInOrigin.startsWith('https:'),
  }
}
