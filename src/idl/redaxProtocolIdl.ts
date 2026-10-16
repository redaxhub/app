// REDAX frontend IDL provenance wrapper.
//
// Boundary:
// - The embedded IDL address / Rust declare_id is provenance only, not proof of
//   devnet deployment or readiness.
// - A future devnet adapter must use validated VITE_REDAX_PROGRAM_ID from
//   app/src/config/redaxEnv.ts as the runtime program id source.
// - This module does not read env, construct clients, create signing adapters,
//   select data sources, perform network actions, or claim app/devnet readiness.

import redaxProtocolIdlJson from './redax_protocol.json'
import type { RedaxProtocol } from './redax_protocol'

export type { RedaxProtocol } from './redax_protocol'

export const REDAX_IDL = redaxProtocolIdlJson as unknown as RedaxProtocol

/** Provenance only — not a deployment or readiness claim. */
export const REDAX_PROGRAM_ID_FROM_IDL: string = REDAX_IDL.address

/** Pure helper: clone the IDL with a validated runtime program id. */
export function redaxIdlWithProgramId(programId: string): RedaxProtocol {
  return {
    ...REDAX_IDL,
    address: programId,
  } as unknown as RedaxProtocol
}
