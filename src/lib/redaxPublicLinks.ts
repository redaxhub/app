// REDAX public links — explorer URLs, the `?campaign=` share link, and copy-to-clipboard.
//
// PUBLIC FACTS ONLY. Everything built or parsed here is a public account address or a
// public transaction signature. A share link carries exactly one thing — a Campaign
// address — and nothing that could change where the app reads from or what it may do:
// no RPC URL, no program id, no cluster, no wallet, no signature, no signed bytes and no
// key material. A link is an address PREFILL; opening a workspace still needs the person's
// explicit click and the strict by-address chain read every adoption already performs.
//
// The platform objects it touches (`location`, `history`, `navigator.clipboard`) are read
// STRUCTURALLY from `globalThis`, so this module compiles under the repository test runtime
// whose `lib` carries no DOM, and a platform that lacks one simply gets a refusal.

import bs58 from 'bs58'

import { isCanonicalRedaxPublicKey } from '../config/redaxEnv'

/** The one explorer this app links to, and the one cluster it links for. */
const REDAX_EXPLORER_ORIGIN = 'https://explorer.solana.com'

/** A Solana transaction signature is exactly 64 bytes. */
const SIGNATURE_BYTE_LENGTH = 64

/** The only share-link query key. */
export const REDAX_CAMPAIGN_LINK_QUERY_KEY = 'campaign'

/** Is this text exactly a base58 64-byte signature, with no normalization? */
export function isRedaxTransactionSignature(value: string): boolean {
  if (value.length < 64 || value.length > 88) {
    return false
  }
  try {
    const decoded = bs58.decode(value)
    return decoded.length === SIGNATURE_BYTE_LENGTH && bs58.encode(decoded) === value
  } catch {
    return false
  }
}

/**
 * The devnet explorer page for one public account or one transaction, or `null`.
 *
 * Only `devnet` is linked, because the app runs on devnet only; any other cluster value
 * yields no link rather than a link to the wrong network. A value that is not exactly an
 * address (or a signature) yields no link either — never a link to a mangled value.
 */
export function buildRedaxExplorerUrl(
  kind: 'address' | 'tx',
  value: string,
  cluster: string | null,
): string | null {
  if (cluster !== 'devnet') {
    return null
  }
  if (kind === 'address' && !isCanonicalRedaxPublicKey(value)) {
    return null
  }
  if (kind === 'tx' && !isRedaxTransactionSignature(value)) {
    return null
  }
  return `${REDAX_EXPLORER_ORIGIN}/${kind}/${value}?cluster=devnet`
}

/** What one `?campaign=` query says. */
export type RedaxCampaignLinkQuery =
  | { readonly kind: 'NONE' }
  | { readonly kind: 'VALID'; readonly campaign: string }
  | { readonly kind: 'INVALID'; readonly reason: 'EMPTY' | 'DUPLICATE' | 'NOT_A_PUBLIC_KEY' }

/**
 * Parse a location search string for the one share-link parameter.
 *
 * Exactly one `campaign` value, which must be exactly a canonical 32-byte public key —
 * not trimmed, not re-cased, not decoded twice. A duplicate is refused rather than
 * resolved by position, because "the first" and "the last" are both guesses. Every other
 * query key is ignored: none of them can select a cluster, an endpoint or a program.
 *
 * Spelling is not existence: a VALID value proves only that the text is a well-formed
 * address. Whether a REDAX Campaign is there is decided later by the strict chain read.
 */
export function parseRedaxCampaignLinkQuery(search: string): RedaxCampaignLinkQuery {
  let params: URLSearchParams
  try {
    params = new URLSearchParams(search)
  } catch {
    return { kind: 'INVALID', reason: 'NOT_A_PUBLIC_KEY' }
  }
  const values = params.getAll(REDAX_CAMPAIGN_LINK_QUERY_KEY)
  if (values.length === 0) {
    return { kind: 'NONE' }
  }
  if (values.length > 1) {
    return { kind: 'INVALID', reason: 'DUPLICATE' }
  }
  const value = values[0]
  if (value === '') {
    return { kind: 'INVALID', reason: 'EMPTY' }
  }
  if (!isCanonicalRedaxPublicKey(value)) {
    return { kind: 'INVALID', reason: 'NOT_A_PUBLIC_KEY' }
  }
  return { kind: 'VALID', campaign: value }
}

/**
 * The share link for one Campaign on THIS app's own origin and path.
 *
 * `baseUrl` is the app's origin plus path; any query or fragment it carried is dropped, so
 * nothing else can ride along. Returns `null` for a value that is not an address.
 */
export function buildRedaxCampaignShareUrl(baseUrl: string, campaign: string): string | null {
  if (!isCanonicalRedaxPublicKey(campaign)) {
    return null
  }
  let url: URL
  try {
    url = new URL(baseUrl)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return null
  }
  return `${url.origin}${url.pathname}?${REDAX_CAMPAIGN_LINK_QUERY_KEY}=${campaign}`
}

// --- Platform access, structural and fail-closed -------------------------------------

interface RedaxLocationPort {
  readonly origin: string
  readonly pathname: string
  readonly search: string
}

interface RedaxHistoryPort {
  replaceState(data: unknown, unused: string, url: string): void
}

function readGlobalMember(name: string): unknown {
  try {
    return (globalThis as Record<string, unknown>)[name]
  } catch {
    return undefined
  }
}

/** This page's origin + path, or `null` outside a browser. */
export function readRedaxAppBaseUrl(): string | null {
  const location = readGlobalMember('location') as RedaxLocationPort | undefined
  if (location === undefined || location === null) {
    return null
  }
  try {
    return `${location.origin}${location.pathname}`
  } catch {
    return null
  }
}

/** This page's search string, or `''` outside a browser. */
export function readRedaxLocationSearch(): string {
  const location = readGlobalMember('location') as RedaxLocationPort | undefined
  if (location === undefined || location === null) {
    return ''
  }
  try {
    return typeof location.search === 'string' ? location.search : ''
  } catch {
    return ''
  }
}

/**
 * Reflect an EXPLICITLY chosen Campaign into the address bar, on the same path.
 *
 * `replaceState`, never `pushState` and never a navigation: nothing reloads, nothing is
 * fetched, and the history gains no entry. `null` clears the parameter. It never throws.
 */
export function replaceRedaxCampaignLinkInLocation(campaign: string | null): void {
  const history = readGlobalMember('history') as RedaxHistoryPort | undefined
  const location = readGlobalMember('location') as RedaxLocationPort | undefined
  if (
    history === undefined ||
    history === null ||
    location === undefined ||
    location === null ||
    typeof history.replaceState !== 'function'
  ) {
    return
  }
  if (campaign !== null && !isCanonicalRedaxPublicKey(campaign)) {
    return
  }
  try {
    const next =
      campaign === null
        ? location.pathname
        : `${location.pathname}?${REDAX_CAMPAIGN_LINK_QUERY_KEY}=${campaign}`
    history.replaceState(null, '', next)
  } catch {
    // An address bar that cannot be updated changes nothing about the selection.
  }
}

/**
 * Copy public text to the clipboard. Resolves `true` only when the platform reports
 * success; every absence, refusal and exception resolves `false`, and the caller then
 * offers the full text for manual selection instead.
 */
export async function copyRedaxPublicText(text: string): Promise<boolean> {
  const navigatorValue = readGlobalMember('navigator') as
    | { readonly clipboard?: { writeText?: (value: string) => Promise<void> } }
    | undefined
  const clipboard = navigatorValue?.clipboard
  if (clipboard === undefined || typeof clipboard.writeText !== 'function') {
    return false
  }
  try {
    await clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}
