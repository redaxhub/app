// App-facing REDAX data-source factory + runtime env-driven selection.
//
// This module is the ONLY controlled runtime import.meta.env read point in the
// app: createRedaxDataSource() reads the four public data VITE_* keys here, and
// all selection flows through createRedaxDataSourceFromEnv(rawEnv). The wallet
// action bridge's controlled runtime-config accessor
// (resolveRedaxRuntimeActionConfig) reads only those same four keys here, the
// Team/Admin product-carrier resolver (resolveRedaxTeamAdminProductCarrier) reads
// exactly the fifth public key here, the Team/Admin metadata-URI allowlist
// resolver (resolveRedaxTeamAdminMetadataUriAllowlist) reads exactly the sixth
// here, and createRedaxDataSource() additionally reads the SEVENTH — the curated
// Campaign discovery allowlist — into the same raw record it already builds. No
// other module reads env directly, and this module declares no resolver of its own
// for the seventh key: the ONE pure decision lives in redaxEnv.ts and is called from
// exactly one site below.
// redaxEnv.ts stays
// a pure validator (it reads no env); the devnet adapter stays config-injected
// (it reads no env). MOCK_LOCAL is the safe default; invalid public env config
// resolves to a typed config-error data source — never a mock fallback and never
// a silent downgrade. The three devnet program-data modes (DEVNET_READONLY /
// DEVNET_WALLET_READONLY / DEVNET_TX_ENABLED) route to the same read-only devnet
// adapter, differing only in the truthful mode stamp; the DEVNET_WALLET_READONLY
// wallet connection shell mounts in App, never here. THIS MODULE ITSELF opens no
// transaction path in any mode — DEVNET_TX_ENABLED's wallet-gated action surfaces
// live in App's provider subtree and their own action roots, never here, and an
// earlier "no transaction path exists in this build" reading of this note was a
// whole-build claim this module was never in a position to make. No RPC runs in
// this module.

import {
  REDAX_APPROVED_TEAM_WALLET_ENV_VAR_NAME,
  REDAX_CAMPAIGN_ALLOWLIST_ENV_VAR_NAME,
  REDAX_METADATA_URI_ALLOWLIST_ENV_VAR_NAME,
  resolveRedaxCampaignAllowlist,
  validateRedaxApprovedTeamWallet,
  validateRedaxEnv,
  validateRedaxTeamAdminMetadataUriAllowlist,
} from '../config/redaxEnv'
import type {
  RedaxEnvConfigError,
  RedaxEnvConfigErrorCode,
  RedaxRawEnv,
  RedaxTeamAdminCarrierStatus,
  RedaxTeamAdminMetadataUriAllowlistStatus,
} from '../config/redaxEnv'
import { createMockRedaxDataSource } from './mock/mockRedaxAdapter'
import { createRedaxDevnetDataSource } from './devnet/redaxDevnetDataSource'
import type { RedaxDevnetProgramAppMode } from './devnet/redaxDevnetErrors'
import { createRedaxConfigErrorDataSource, type RedaxConfigErrorEntry } from './redaxConfigErrorDataSource'
import type { RedaxDataSource } from './redaxDataSource'
import type { RedaxCluster, RedaxDataMode, RedaxDataSourceKind } from './redaxModes'
import type { RedaxDataErrorCode } from './redaxViewModels'

// Config errors only ever arise in a devnet / unknown-mode context (an unset or
// empty mode defaults to a valid MOCK_LOCAL), so the config-error envelope source
// is always program-rpc and never mock-fixtures.
const CONFIG_ERROR_SOURCE: RedaxDataSourceKind = 'program-rpc'

// validateRedaxEnv may report mode === null (an unknown VITE_REDAX_DATA_MODE).
// RedaxDataSourceResult/RedaxDataError require a non-null RedaxDataMode and there
// is no dedicated "unknown-mode" envelope type, so a null mode is stamped
// DEVNET_READONLY as a conservative, non-mock envelope. This avoids any
// mock-fallback / MOCK_LOCAL-success misread — it is NOT a devnet readiness claim
// and NOT a statement that DEVNET_READONLY was selected.
const NULL_MODE_ENVELOPE: RedaxDataMode = 'DEVNET_READONLY'

/**
 * Map a validator env-config error code onto an existing public RedaxDataErrorCode
 * carrier (RedaxDataErrorCode is NOT widened in this gate):
 *  - data-mode / cluster problems -> MODE_MISMATCH
 *  - program-id problems          -> WRONG_PROGRAM_ID
 *  - RPC-URL problems             -> DEVNET_RPC_UNAVAILABLE (the RPC URL is the
 *    unusable resource; no connection is attempted and no mock fallback occurs —
 *    the precise reason travels in the value-free title/detail/recovery text).
 */
function carrierForEnvConfigError(code: RedaxEnvConfigErrorCode): RedaxDataErrorCode {
  switch (code) {
    case 'INVALID_DATA_MODE':
    case 'MISSING_SOLANA_CLUSTER':
    case 'INVALID_SOLANA_CLUSTER':
      return 'MODE_MISMATCH'
    case 'MISSING_REDAX_PROGRAM_ID':
    case 'INVALID_REDAX_PROGRAM_ID':
      return 'WRONG_PROGRAM_ID'
    case 'MISSING_SOLANA_RPC_URL':
    case 'INVALID_SOLANA_RPC_URL':
    case 'SECRET_LIKE_SOLANA_RPC_URL':
      return 'DEVNET_RPC_UNAVAILABLE'
    default:
      // Unreachable today; a safe generic carrier that never widens the union.
      return 'MODE_MISMATCH'
  }
}

// Build a config-error data source from validator errors. The validator's
// title/detail/recovery are already value-free, so they are reused verbatim — no
// raw env value can leak. The first reported error is the primary surfaced error.
function configErrorDataSource(
  mode: RedaxDataMode | null,
  errors: readonly RedaxEnvConfigError[],
): RedaxDataSource {
  const first = errors[0]
  const primary: RedaxConfigErrorEntry = first
    ? {
        code: carrierForEnvConfigError(first.code),
        title: first.title,
        detail: first.detail,
        recovery: first.recovery,
      }
    : {
        code: 'MODE_MISMATCH',
        title: 'Invalid REDAX data configuration',
        detail: 'The public VITE_* data-source configuration is invalid.',
        recovery: 'Set VITE_REDAX_DATA_MODE and the devnet VITE_* values to valid public values.',
      }
  return createRedaxConfigErrorDataSource({
    mode: mode ?? NULL_MODE_ENVELOPE,
    source: CONFIG_ERROR_SOURCE,
    primary,
  })
}

// A validated devnet config that is unexpectedly incomplete (programId/rpcUrl
// null) or that fails adapter construction resolves to a sanitized config error
// stamped with the requesting read-only mode — never a mock fallback, never an
// exposed thrown message.
function devnetConfigErrorDataSource(
  mode: RedaxDevnetProgramAppMode,
  carrier: RedaxDataErrorCode,
  detail: string,
): RedaxDataSource {
  return createRedaxConfigErrorDataSource({
    mode,
    source: CONFIG_ERROR_SOURCE,
    primary: {
      code: carrier,
      title: 'Devnet data source unavailable',
      detail,
      recovery: 'Confirm the public VITE_REDAX_PROGRAM_ID and VITE_SOLANA_RPC_URL devnet values.',
    },
  })
}

/**
 * Resolve a RedaxDataSource from a raw public env record. Pure routing: no env read
 * here, no RPC. Exported for future unit/static validation.
 *
 * `validateRedaxEnv` is still the FOUR-CORE-key decision and nothing here widens it.
 * The seventh key travels in the same record and is consulted in exactly one place —
 * the devnet branch below — because a curated public directory is a devnet-rendering
 * fact. MOCK_LOCAL never consults it: local fixtures are not a public directory, and
 * an unusable Campaign carrier must not be able to erase them.
 */
export function createRedaxDataSourceFromEnv(rawEnv: RedaxRawEnv): RedaxDataSource {
  const result = validateRedaxEnv(rawEnv)
  if (!result.ok) {
    // Invalid public env config -> typed config error; never a mock fallback.
    return configErrorDataSource(result.mode, result.errors)
  }

  const env = result.env
  switch (env.mode) {
    case 'MOCK_LOCAL':
      // Fixtures, untouched. The Campaign carrier is never a reason to disable them.
      return createMockRedaxDataSource()
    // All three devnet program-data modes (DEVNET_READONLY /
    // DEVNET_WALLET_READONLY / DEVNET_TX_ENABLED) share the same validated config
    // and the same read-only devnet adapter; only the truthful mode stamp differs.
    // The DEVNET_WALLET_READONLY wallet connection shell (Wallet Standard
    // discovery + custom connect/disconnect chrome) mounts in App — never here.
    // Nothing ROUTED HERE gains a transaction path from being routed here:
    // DEVNET_TX_ENABLED reads the same devnet data through the same read-only
    // adapter, and its wallet-gated action surfaces are mounted by App and owned
    // by their own action roots (no send/sign is added here, in any mode).
    case 'DEVNET_READONLY':
    case 'DEVNET_WALLET_READONLY':
    case 'DEVNET_TX_ENABLED': {
      if (!env.programId || !env.rpcUrl) {
        // Construction-prevented by the validator; defensive non-mock guard.
        return devnetConfigErrorDataSource(
          env.mode,
          'MODE_MISMATCH',
          'The validated devnet configuration was incomplete (missing program id or RPC URL).',
        )
      }
      // THE ONE Campaign-allowlist resolution, at the ONE site that needs it. Both
      // refusals — MISSING and INVALID alike — carry the same frozen empty array, so a
      // missing curation and a broken one inject exactly the same thing: an empty
      // curated directory that lists nothing and issues no Campaign GPA at all.
      const campaignAllowlist = resolveRedaxCampaignAllowlist(
        rawEnv[REDAX_CAMPAIGN_ALLOWLIST_ENV_VAR_NAME],
      ).entries
      try {
        return createRedaxDevnetDataSource({
          campaignAllowlist,
          programId: env.programId,
          rpcUrl: env.rpcUrl,
          mode: env.mode,
        })
      } catch {
        // Sanitized: the thrown construction error/message is never exposed.
        return devnetConfigErrorDataSource(
          env.mode,
          'MODE_MISMATCH',
          'The devnet data source could not be constructed from the validated configuration.',
        )
      }
    }
    default:
      // Unreachable (RedaxDataMode is exhausted above); safe config error, no mock.
      return configErrorDataSource(null, [])
  }
}

/**
 * App-facing REDAX data-source factory. This is the ONLY controlled runtime
 * import.meta.env read point: it reads the four public core VITE_* keys plus the
 * seventh — the curated Campaign discovery allowlist — and delegates all selection
 * to createRedaxDataSourceFromEnv. No env is read anywhere else and no env value is
 * printed. Remains no-arg so App.tsx is unchanged.
 *
 * The seventh key is read HERE and decided in redaxEnv.ts, for the same reason the
 * other two carriers are: a second env reader anywhere would be a second trust source
 * for what the public product shows.
 */
export function createRedaxDataSource(): RedaxDataSource {
  const viteEnv = import.meta.env as unknown as Record<string, string | undefined>
  const rawEnv: RedaxRawEnv = {
    VITE_REDAX_DATA_MODE: viteEnv.VITE_REDAX_DATA_MODE,
    VITE_SOLANA_CLUSTER: viteEnv.VITE_SOLANA_CLUSTER,
    VITE_REDAX_PROGRAM_ID: viteEnv.VITE_REDAX_PROGRAM_ID,
    VITE_SOLANA_RPC_URL: viteEnv.VITE_SOLANA_RPC_URL,
    [REDAX_CAMPAIGN_ALLOWLIST_ENV_VAR_NAME]:
      viteEnv[REDAX_CAMPAIGN_ALLOWLIST_ENV_VAR_NAME],
  }
  return createRedaxDataSourceFromEnv(rawEnv)
}

// --- Wallet action runtime config accessor ---------------------------------
//
// Controlled runtime config for the DEVNET_TX_ENABLED wallet action bridge. It
// reuses the same pure validator (validateRedaxEnv) and the same four public
// VITE_* keys read above — the action bridge never reads env itself. It returns
// only the validated public runtime values the bridge needs (mode, cluster,
// program id, RPC URL); it never logs, never prints a raw value, never falls back
// to mock, and never throws — an unusable config is a typed unavailable result.

/** Why the wallet action runtime config is unavailable. */
export type RedaxRuntimeActionConfigErrorCode =
  | 'NOT_DEVNET_TX_MODE'
  | 'CONFIG_INVALID'
  | 'CONFIG_INCOMPLETE'

/** Validated public runtime config for the wallet action bridge, or a typed reason it is unavailable. */
export type RedaxRuntimeActionConfigResult =
  | { ok: true; mode: RedaxDataMode; cluster: RedaxCluster; programId: string; rpcUrl: string }
  | { ok: false; code: RedaxRuntimeActionConfigErrorCode }

/**
 * Resolve the wallet action bridge's runtime config from the four public VITE_*
 * keys — still exactly four, and the seventh key is deliberately not among them: a
 * curated public directory decides what is LISTED and never what may be SIGNED. Only
 * DEVNET_TX_ENABLED yields an `ok` config; any other mode, an invalid public config,
 * or an unexpectedly incomplete devnet config yields a typed unavailable result
 * (never a throw, never a mock fallback, never a raw value).
 */
export function resolveRedaxRuntimeActionConfig(): RedaxRuntimeActionConfigResult {
  const viteEnv = import.meta.env as unknown as Record<string, string | undefined>
  const rawEnv: RedaxRawEnv = {
    VITE_REDAX_DATA_MODE: viteEnv.VITE_REDAX_DATA_MODE,
    VITE_SOLANA_CLUSTER: viteEnv.VITE_SOLANA_CLUSTER,
    VITE_REDAX_PROGRAM_ID: viteEnv.VITE_REDAX_PROGRAM_ID,
    VITE_SOLANA_RPC_URL: viteEnv.VITE_SOLANA_RPC_URL,
  }
  const result = validateRedaxEnv(rawEnv)
  if (!result.ok) {
    return { ok: false, code: 'CONFIG_INVALID' }
  }
  const env = result.env
  if (env.mode !== 'DEVNET_TX_ENABLED') {
    // Read-only / mock modes never expose an action runtime config.
    return { ok: false, code: 'NOT_DEVNET_TX_MODE' }
  }
  if (env.programId === null || env.rpcUrl === null || env.cluster === null) {
    // Construction-prevented by the validator; defensive completeness guard.
    return { ok: false, code: 'CONFIG_INCOMPLETE' }
  }
  return {
    ok: true,
    mode: env.mode,
    cluster: env.cluster,
    programId: env.programId,
    rpcUrl: env.rpcUrl,
  }
}

// --- Team/Admin product-carrier resolver ------------------------------------
//
// THE ONE canonical runtime resolution point for the approved Team/Admin wallet.
//
// It lives here, beside the other two runtime accessors, for a single reason:
// this module is the app's only executable import.meta.env read owner, and a
// second reader anywhere else would be a second trust source for the identity
// that gates a raw broadcast. The action root does not read env. The Campaign
// Create panel does not read env. No screen and no component reads env. They all
// receive the ONE value App resolves from this function.
//
// It is deliberately SEPARATE from createRedaxDataSource: a missing or malformed
// Team carrier must fail the Team/Admin action surface closed and must NOT touch
// the core data source, the read-only devnet rendering, or the Holder flows.

/** The sanitized public carrier resolution handed to App. Never a raw value. */
export type RedaxTeamAdminProductCarrierResult =
  | { readonly status: 'AVAILABLE'; readonly approvedTeamWallet: string }
  | {
      readonly status: Exclude<RedaxTeamAdminCarrierStatus, 'AVAILABLE'>
      readonly approvedTeamWallet: null
    }

/**
 * Resolve the approved Team/Admin wallet from the fifth public VITE_* key.
 *
 * Reads exactly one key and delegates every judgement to the pure policy in
 * redaxEnv.ts. It never throws, never logs, never prints or returns the raw
 * supplied value, never falls back to a mock or a default identity, and never
 * consults the connected wallet, a URL, browser storage or user input — the
 * approved identity is a deployment fact and may enter from nowhere else.
 *
 * A `MISSING` or `INVALID` result is a fail-closed Team/Admin surface and
 * nothing more: the core data source is resolved independently and is unaffected.
 */
export function resolveRedaxTeamAdminProductCarrier(): RedaxTeamAdminProductCarrierResult {
  const viteEnv = import.meta.env as unknown as Record<string, string | undefined>
  const validated = validateRedaxApprovedTeamWallet(
    viteEnv[REDAX_APPROVED_TEAM_WALLET_ENV_VAR_NAME],
  )
  if (validated.status === 'AVAILABLE') {
    return { status: 'AVAILABLE', approvedTeamWallet: validated.approvedTeamWallet }
  }
  return { status: validated.status, approvedTeamWallet: null }
}

// --- Team/Admin metadata-URI allowlist resolver -----------------------------
//
// THE ONE canonical runtime resolution point for the approved metadata-URI
// allowlist, and it lives here for the same reason the carrier resolver does:
// this module is the app's only executable import.meta.env read owner, and a
// second reader anywhere else would be a second trust source for the list that
// bounds a permanent, immutable, once-only on-chain write. No panel reads env.
// The mutation action root does not read env. They all receive the ONE resolved
// entries array App resolves from this function, and the SAME array reaches both
// the metadata panel and the mutation provider — so the list an operator selects
// from and the list the canonicalizer matches against cannot diverge.
//
// It is deliberately SEPARATE from createRedaxDataSource, exactly like the
// carrier: a missing or malformed allowlist must fail SETUP_METADATA closed and
// must not touch the core data source, the read-only devnet rendering, the Holder
// flows, Campaign Create or ADD_TOKEN_CONFIG.

/** The sanitized public allowlist resolution handed to App. Never a raw value. */
export type RedaxTeamAdminMetadataUriAllowlistResult =
  | { readonly status: 'AVAILABLE'; readonly entries: readonly string[] }
  | {
      readonly status: Exclude<RedaxTeamAdminMetadataUriAllowlistStatus, 'AVAILABLE'>
      readonly entries: readonly string[]
    }

/**
 * Resolve the approved metadata-URI allowlist from the sixth public VITE_* key.
 *
 * Reads exactly one key and delegates every judgement to the pure policy in
 * redaxEnv.ts. It never throws, never logs, never prints or returns the raw
 * supplied value, never falls back to a default list or a hosting provider, and
 * never consults the connected wallet, a URL, browser storage or user input — the
 * approved locations are a deployment fact and may enter from nowhere else.
 *
 * A `MISSING` or `INVALID` result carries the same frozen empty array the policy
 * returns, and an empty array refuses every URI: the SETUP_METADATA surface is
 * NOT_CONFIGURED and nothing else in the app is affected.
 */
export function resolveRedaxTeamAdminMetadataUriAllowlist(): RedaxTeamAdminMetadataUriAllowlistResult {
  const viteEnv = import.meta.env as unknown as Record<string, string | undefined>
  const validated = validateRedaxTeamAdminMetadataUriAllowlist(
    viteEnv[REDAX_METADATA_URI_ALLOWLIST_ENV_VAR_NAME],
  )
  if (validated.status === 'AVAILABLE') {
    return { status: 'AVAILABLE', entries: validated.entries }
  }
  return { status: validated.status, entries: validated.entries }
}
