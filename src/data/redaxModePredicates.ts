// REDAX data-mode runtime predicates — the runtime companion to the type-only
// redaxModes.ts contract (which deliberately declares no runtime values).
//
// isProgramReadonlyMode answers exactly one question: does this mode read real
// devnet program/RPC data while every transaction action stays disabled? True
// for exactly the two read-only devnet modes. MOCK_LOCAL is excluded (local
// fixtures, no RPC). DEVNET_TX_ENABLED is deliberately excluded — it is the
// separately gated wallet-gated transaction mode and must never be grouped
// with the read-only modes by this predicate. No env read, no RPC, no wallet
// import, no readiness assertion.

import type { RedaxDataMode } from './redaxModes'

/** The two read-only devnet program/RPC modes. DEVNET_TX_ENABLED is excluded. */
export const PROGRAM_READONLY_MODES = ['DEVNET_READONLY', 'DEVNET_WALLET_READONLY'] as const

/** A mode in which surfaces render read-only devnet program/RPC data. */
export type RedaxProgramReadonlyMode = (typeof PROGRAM_READONLY_MODES)[number]

/**
 * True exactly for the read-only devnet modes (DEVNET_READONLY /
 * DEVNET_WALLET_READONLY); false for MOCK_LOCAL, DEVNET_TX_ENABLED, and a
 * null/undefined (not-yet-loaded) mode.
 */
export function isProgramReadonlyMode(
  mode: RedaxDataMode | null | undefined,
): mode is RedaxProgramReadonlyMode {
  return mode === 'DEVNET_READONLY' || mode === 'DEVNET_WALLET_READONLY'
}

/**
 * Every devnet program/RPC data mode — the modes whose surfaces render real
 * devnet program data read over RPC. A superset of PROGRAM_READONLY_MODES that
 * also includes DEVNET_TX_ENABLED: that mode reads the same devnet program data
 * and IS ALREADY the wallet-gated transaction mode (an earlier "in a later slice"
 * reading here is superseded). Including it in THIS grouping is a data-load /
 * read-copy decision ONLY, and confers no transaction path, wallet or action.
 */
export const DEVNET_PROGRAM_MODES = [
  'DEVNET_READONLY',
  'DEVNET_WALLET_READONLY',
  'DEVNET_TX_ENABLED',
] as const

/** A mode in which surfaces render devnet program/RPC data (read path). */
export type RedaxDevnetProgramMode = (typeof DEVNET_PROGRAM_MODES)[number]

/**
 * True for every devnet program-data mode (DEVNET_READONLY /
 * DEVNET_WALLET_READONLY / DEVNET_TX_ENABLED); false for MOCK_LOCAL and a
 * null/undefined (not-yet-loaded) mode. Use this for "renders devnet program
 * data" branches. It is deliberately broader than isProgramReadonlyMode, which
 * stays true only for the two read-only modes and continues to gate
 * "read-only / no transaction" semantics.
 */
export function isDevnetProgramMode(
  mode: RedaxDataMode | null | undefined,
): mode is RedaxDevnetProgramMode {
  return (
    mode === 'DEVNET_READONLY' ||
    mode === 'DEVNET_WALLET_READONLY' ||
    mode === 'DEVNET_TX_ENABLED'
  )
}
