// REDAX read-only devnet adapter — internal error taxonomy + result builders.
//
// Boundary: this is the read-only devnet adapter core only. No provider wiring,
// no env runtime, no wallet, no transaction, no UI forms, no mock fallback, no
// readiness claim. Readonly search/filter inputs may arrive in a later gate; the
// DEVNET_TX_ENABLED transaction forms that exist live in their own action roots
// and panels — never here.
//
// This module defines a richer read-only devnet error taxonomy WITHOUT widening
// the public `RedaxDataErrorCode` union (which lives in the out-of-scope
// redaxViewModels.ts). Each internal kind maps onto an existing public code; the
// finer meaning travels in the title/detail/recovery text. Every result carries
// the devnet program-data app mode it was built for (DEVNET_READONLY,
// DEVNET_WALLET_READONLY, or DEVNET_TX_ENABLED) / source 'program-rpc' and never
// throws for normal missing data — callers return
// ok(null)/ok([]) for "not found", and reserve these typed errors for transport
// failures, malformed accounts, and deliberately-deferred reads.

import type { RedaxDataSourceKind } from '../redaxModes'
import type {
  RedaxDataError,
  RedaxDataErrorBlock,
  RedaxDataErrorCode,
  RedaxDataSourceResult,
  RedaxTimestamp,
} from '../redaxViewModels'

/**
 * The devnet program-data app modes this adapter may be constructed for and stamp
 * on read envelopes: DEVNET_READONLY, DEVNET_WALLET_READONLY, and
 * DEVNET_TX_ENABLED. This is a READ-ENVELOPE / program-data mode stamp ONLY —
 * including DEVNET_TX_ENABLED here does NOT imply transaction sending, does NOT
 * enable any action, and adds no wallet or signing capability. The adapter stays
 * read-only in every one of these modes; DEVNET_TX_ENABLED's wallet-gated action
 * surfaces are owned entirely outside it and are no part of this stamp.
 */
export type RedaxDevnetProgramAppMode =
  | 'DEVNET_READONLY'
  | 'DEVNET_WALLET_READONLY'
  | 'DEVNET_TX_ENABLED'

const SOURCE: RedaxDataSourceKind = 'program-rpc'

/**
 * Internal read-only devnet error taxonomy. Finer-grained than the public
 * `RedaxDataErrorCode`; each kind is mapped to an in-union public code by
 * `DEVNET_ERROR_META` below so results stay `RedaxDataSourceResult`-compatible.
 */
export type RedaxDevnetErrorKind =
  | 'RPC_UNAVAILABLE'
  | 'ACCOUNT_NOT_FOUND'
  | 'ACCOUNT_OWNER_MISMATCH'
  | 'ACCOUNT_DECODE_FAILED'
  | 'PROGRAM_ID_MISMATCH'
  | 'GPA_UNAVAILABLE_OR_LIMITED'
  | 'DEVNET_RECEIPTS_UNAVAILABLE'
  | 'UNSUPPORTED_HOLDER_REF'
  | 'HOLDER_BALANCE_DEFERRED'

interface DevnetErrorMeta {
  code: RedaxDataErrorCode
  title: string
  detail: string
  recovery: string
  blocks: RedaxDataErrorBlock
}

// Internal-kind -> public-code mapping. Only existing `RedaxDataErrorCode`
// values are used; no public union widening.
//
// Two kinds have no exact public code, so a code is chosen consistently and
// explained here:
//  - UNSUPPORTED_HOLDER_REF -> MODE_MISMATCH: a MOCK_LOCAL fixture holder id is
//    being used against a read-only devnet (program-rpc) source. That is a
//    mode/source mismatch, not a transport failure — MODE_MISMATCH fits best.
//  - HOLDER_BALANCE_DEFERRED -> NO_FALLBACK_ALLOWED: holder SPL balance / ATA
//    reads are intentionally not implemented in the readonly first slice and the
//    adapter must NOT fabricate or fall back to mock balance data.
//    NO_FALLBACK_ALLOWED carries exactly that "no mock substitute" meaning.
const DEVNET_ERROR_META: Record<RedaxDevnetErrorKind, DevnetErrorMeta> = {
  RPC_UNAVAILABLE: {
    code: 'DEVNET_RPC_UNAVAILABLE',
    title: 'Devnet RPC unavailable',
    detail: 'The devnet RPC endpoint did not respond to a read request.',
    recovery: 'Check the configured devnet RPC URL and retry.',
    blocks: 'display',
  },
  ACCOUNT_NOT_FOUND: {
    code: 'ACCOUNT_NOT_FOUND',
    title: 'Account not found',
    detail: 'The requested program account does not exist on devnet.',
    recovery: 'Verify the address and that the account has been created on devnet.',
    blocks: 'display',
  },
  ACCOUNT_OWNER_MISMATCH: {
    code: 'WRONG_PROGRAM_ID',
    title: 'Account not owned by the REDAX program',
    detail: 'The fetched account is not owned by the configured REDAX program id.',
    recovery: 'Confirm the configured program id matches the deployed REDAX program.',
    blocks: 'display',
  },
  ACCOUNT_DECODE_FAILED: {
    code: 'IDL_MISMATCH',
    title: 'Account decode failed',
    detail: 'The account discriminator or layout did not match the REDAX IDL.',
    recovery: 'Confirm the frontend IDL matches the deployed program.',
    blocks: 'display',
  },
  PROGRAM_ID_MISMATCH: {
    code: 'WRONG_PROGRAM_ID',
    title: 'Program id mismatch',
    detail: 'The runtime program id does not match the expected REDAX program id.',
    recovery: 'Set VITE_REDAX_PROGRAM_ID to the deployed REDAX program id.',
    blocks: 'display',
  },
  GPA_UNAVAILABLE_OR_LIMITED: {
    code: 'DEVNET_RPC_UNAVAILABLE',
    title: 'Program-account listing unavailable',
    detail:
      'getProgramAccounts failed or was rate-limited by the devnet RPC endpoint; campaign/token-config discovery could not complete.',
    recovery: 'Use an RPC endpoint that permits getProgramAccounts, or look up a campaign by address.',
    blocks: 'display',
  },
  DEVNET_RECEIPTS_UNAVAILABLE: {
    code: 'DEVNET_RECEIPTS_UNAVAILABLE',
    title: 'Receipts unavailable in readonly',
    detail:
      'Converted-event history is not stored on-chain; receipt history requires an event-log scan or indexer not implemented in this readonly slice.',
    recovery: 'A later devnet slice adds event/indexer-based receipt history.',
    blocks: 'display',
  },
  UNSUPPORTED_HOLDER_REF: {
    code: 'MODE_MISMATCH',
    title: 'Unsupported holder reference',
    detail:
      'A MOCK_LOCAL fixture holder id is not valid against a read-only devnet program-rpc source.',
    recovery: 'Use a wallet/public holder reference; mock holder ids exist only in MOCK_LOCAL.',
    blocks: 'display',
  },
  HOLDER_BALANCE_DEFERRED: {
    code: 'NO_FALLBACK_ALLOWED',
    title: 'Holder balance reads deferred',
    detail:
      'Holder SPL balance and output-ATA reads are not implemented in the read-only devnet first slice; the adapter will not fall back to mock balance data.',
    recovery: 'A later devnet slice adds classic-SPL holder balance and ATA-preparedness reads.',
    blocks: 'display',
  },
}

/** Map an internal devnet error kind to its public `RedaxDataErrorCode`. */
export function toRedaxDataErrorCode(kind: RedaxDevnetErrorKind): RedaxDataErrorCode {
  return DEVNET_ERROR_META[kind].code
}

/** Optional overrides when building a devnet error result. */
export interface DevnetErrorOptions {
  detail?: string
  blocks?: RedaxDataErrorBlock
  fetchedAt?: RedaxTimestamp
}

/** Result builders bound to one read-only devnet app mode. */
export interface RedaxDevnetResultBuilders {
  /** Wrap a successful read. `fetchedAt` is stamped when supplied. */
  devnetOk<T>(data: T, fetchedAt?: RedaxTimestamp): RedaxDataSourceResult<T>
  /** Build a typed error result. Never throws; carries no raw value. */
  devnetError<T>(kind: RedaxDevnetErrorKind, options?: DevnetErrorOptions): RedaxDataSourceResult<T>
}

/**
 * Create result builders that stamp every envelope with the given devnet
 * program-data app mode and source 'program-rpc'. The mode may be any of the
 * three devnet program-data modes (including DEVNET_TX_ENABLED); the builders
 * stamp the mode on READ envelopes only and add no send/sign/transaction
 * capability — DEVNET_TX_ENABLED's action surfaces are owned elsewhere.
 */
export function createDevnetResultBuilders(
  mode: RedaxDevnetProgramAppMode,
): RedaxDevnetResultBuilders {
  return {
    devnetOk<T>(data: T, fetchedAt?: RedaxTimestamp): RedaxDataSourceResult<T> {
      return fetchedAt === undefined
        ? { ok: true, mode, source: SOURCE, data }
        : { ok: true, mode, source: SOURCE, data, fetchedAt }
    },
    devnetError<T>(
      kind: RedaxDevnetErrorKind,
      options?: DevnetErrorOptions,
    ): RedaxDataSourceResult<T> {
      const meta = DEVNET_ERROR_META[kind]
      const error: RedaxDataError = {
        code: meta.code,
        title: meta.title,
        detail: options?.detail ?? meta.detail,
        recovery: meta.recovery,
        blocks: options?.blocks ?? meta.blocks,
        mode,
        source: SOURCE,
      }
      const fetchedAt = options?.fetchedAt
      return fetchedAt === undefined
        ? { ok: false, mode, source: SOURCE, error }
        : { ok: false, mode, source: SOURCE, error, fetchedAt }
    },
  }
}

/**
 * Thrown by the account-helper layer for an exceptional (present-but-wrong)
 * account — owner mismatch or decode failure. Normal "missing account" is NOT a
 * throw (helpers return null). The data-source layer catches this and converts
 * `kind` into a typed `devnetError`, so no raw exception escapes a RedaxDataSource
 * method.
 */
export class RedaxDevnetAccountError extends Error {
  readonly kind: RedaxDevnetErrorKind

  constructor(kind: RedaxDevnetErrorKind, message?: string) {
    super(message ?? kind)
    this.name = 'RedaxDevnetAccountError'
    this.kind = kind
  }
}
