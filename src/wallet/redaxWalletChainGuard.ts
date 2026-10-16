// REDAX Holder chain guard — the two-phase, fail-closed check that must pass before
// a Holder transaction is built, and again before it is handed to the wallet.
//
// -----------------------------------------------------------------------------
// WHAT THIS IS FOR
// -----------------------------------------------------------------------------
// Sending a transaction is the point of no return: once the transport is invoked,
// a broadcast may have happened even if nothing is ever returned to us. So every
// question worth asking must be answered BEFORE that moment — and answered again
// immediately before it, because the chain does not hold still between the two.
//
// Phase A runs before any instruction or Transaction is constructed. Phase B runs
// immediately before the transport is invoked and re-reads everything mutable. A
// Phase-A pass is NEVER an authorization for Phase B; it is only a baseline that
// Phase B measures fresh observations against.
//
// This module consumes the attempt's Connection; it never creates one. Both
// `Connection` and `PublicKey` are imported as TYPES ONLY, so constructing either
// is not merely forbidden here — it is impossible.
//
// Results are typed and value-free: a refusal carries a code, a phase and (when
// honestly known) a context slot. It never carries a raw error, message, cause,
// address, endpoint, account byte or blockhash, and this module logs nothing.

import type { Connection, PublicKey } from '@solana/web3.js'
import { getChainForEndpoint } from '@solana/wallet-standard-util'

import {
  deriveProtocolFeeVaultAta,
  deriveTokenConfigPda,
  readRedaxGuardAccountsWithContext,
  type RedaxGuardAccountsReadFailureCode,
} from '../data/devnet/redaxDevnetAccounts'
import {
  isRedaxExpectedDevnetGenesisHash,
  isRedaxExpectedUpgradeableLoaderOwner,
} from './redaxChainIdentity'

// --- Exact expectations ------------------------------------------------------

/**
 * The only accepted classifier result.
 *
 * The installed classifier is a URL-token matcher whose fall-through is MAINNET:
 * an opaque, unrecognized, malformed or empty endpoint all classify as
 * `solana:mainnet`. Demanding EXACTLY `solana:devnet` therefore turns that
 * fail-open default into a fail-closed refusal, and no second, project-local
 * classifier is needed (one would be free to drift from the function the wallet
 * adapter itself uses).
 *
 * The classifier is necessary but NEVER sufficient: any URL merely containing the
 * token "devnet" also classifies as devnet while pointing anywhere at all. That
 * gap is closed by the fresh genesis check below, which no URL string can forge.
 */
const REDAX_EXPECTED_CHAIN = 'solana:devnet'

/** The only mode in which a Holder transaction may exist at all. */
const REDAX_EXPECTED_MODE = 'DEVNET_TX_ENABLED'

/** The only configured cluster label accepted alongside it. */
const REDAX_EXPECTED_CLUSTER = 'devnet'

/** Every guard read is `confirmed`: a `finalized` read is STALER, and a pre-send
 *  guard wants the freshest possible view of the chain, not the safest-to-quote
 *  one. Finality is an outcome question, and it is not this module's job. */
const REDAX_GUARD_COMMITMENT = 'confirmed' as const

// --- Public vocabulary -------------------------------------------------------

/** Which of the three guard operations produced a result. */
export type RedaxHolderChainGuardPhase = 'A' | 'BLOCKHASH' | 'B'

/** Every way the guard can refuse. Value-free, and exhaustive. */
export type RedaxHolderChainGuardRefusalCode =
  | 'ATTEMPT_SNAPSHOT_INVALID'
  | 'CONNECTION_IDENTITY_MISMATCH'
  | 'WRONG_MODE'
  | 'WRONG_CLUSTER_LABEL'
  | 'ENDPOINT_NOT_DEVNET'
  | 'GENESIS_MISMATCH'
  | 'PROGRAM_ABSENT'
  | 'PROGRAM_NOT_EXECUTABLE'
  | 'PROGRAM_OWNER_MISMATCH'
  | 'PROGRAM_STATE_INVALID'
  | 'PROTOCOL_CONFIG_ABSENT'
  | 'PROTOCOL_CONFIG_OWNER_MISMATCH'
  | 'PROTOCOL_CONFIG_DISCRIMINATOR_MISMATCH'
  | 'PROTOCOL_CONFIG_DECODE_FAILED'
  | 'PROTOCOL_CONFIG_BUMP_MISMATCH'
  | 'PROTOCOL_CONFIG_CHANGED'
  | 'WALLET_IDENTITY_MISMATCH'
  | 'REQUEST_IDENTITY_MISMATCH'
  | 'BLOCKHASH_INVALID'
  | 'MIN_CONTEXT_UNAVAILABLE'
  | 'RPC_READ_UNAVAILABLE'

/** A refusal. It says what failed and where — and nothing else. */
export interface RedaxHolderChainGuardRefusal {
  readonly ok: false
  readonly phase: RedaxHolderChainGuardPhase
  readonly code: RedaxHolderChainGuardRefusalCode
  readonly contextSlot: number | null
}

/**
 * The runtime facts the caller has already resolved. Injected rather than read
 * here: this module owns no environment access, which is also what lets it be
 * tested without one.
 *
 * `mode` and `cluster` are plain strings on purpose — they are compared against
 * exact literals, so any unexpected value (including `null`) is a refusal rather
 * than something this module has to know how to name.
 */
export interface RedaxHolderChainGuardRuntime {
  readonly mode: string
  readonly cluster: string | null
  readonly programId: PublicKey
}

/** The Campaign the app actually read from chain. */
export interface RedaxHolderChainGuardLoadedCampaign {
  readonly address: PublicKey
  readonly outputMint: PublicKey
  readonly protocolFeeVault: PublicKey
}

/** The TokenConfig the app actually read from chain (convert only). */
export interface RedaxHolderChainGuardLoadedTokenConfig {
  readonly address: PublicKey
  readonly campaign: PublicKey
  readonly legacyMint: PublicKey
}

/** The loaded on-chain identity graph the request must agree with. */
export interface RedaxHolderChainGuardLoaded {
  readonly campaign: RedaxHolderChainGuardLoadedCampaign
  readonly tokenConfig?: RedaxHolderChainGuardLoadedTokenConfig
}

/**
 * Exactly the two Holder actions that exist. There is no third shape, so this
 * guard cannot be pointed at an instruction it was never designed for.
 */
export type RedaxHolderChainGuardRequest =
  | {
      readonly kind: 'prepare_user_output_ata'
      readonly campaign: PublicKey
      readonly outputMint: PublicKey
    }
  | {
      readonly kind: 'convert_exact_in'
      readonly campaign: PublicKey
      readonly tokenConfig: PublicKey
      readonly legacyMint: PublicKey
      readonly outputMint: PublicKey
      readonly protocolFeeVault: PublicKey
    }

/**
 * The opaque handle Phase A returns. Its ONLY public datum is the context slot
 * Phase A observed at.
 *
 * Everything that matters about the attempt is held privately, keyed by this
 * object's identity (see `ATTEMPTS` below). A snapshot that this module did not
 * mint — a literal, a clone, a spread, a JSON round-trip — is simply not a key in
 * that map, so Phase A cannot be forged, replayed or reconstructed.
 */
export interface RedaxHolderChainGuardAttemptSnapshot {
  readonly phaseAContextSlot: number
}

/** Phase-A outcome. */
export type RedaxHolderChainGuardPhaseAResult =
  | {
      readonly ok: true
      readonly phase: 'A'
      readonly snapshot: RedaxHolderChainGuardAttemptSnapshot
      readonly contextSlot: number
    }
  | RedaxHolderChainGuardRefusal

/** Blockhash-helper outcome. Internal foundation data — not UI copy. */
export type RedaxAttemptBlockhashResult =
  | {
      readonly ok: true
      readonly phase: 'BLOCKHASH'
      readonly blockhash: string
      readonly lastValidBlockHeight: number
      readonly blockhashContextSlot: number
    }
  | RedaxHolderChainGuardRefusal

/** Phase-B outcome. */
export type RedaxHolderChainGuardPhaseBResult =
  | {
      readonly ok: true
      readonly phase: 'B'
      readonly contextSlot: number
    }
  | RedaxHolderChainGuardRefusal

// --- Private attempt state ---------------------------------------------------

/**
 * The exact identity graph Phase A approved, flattened to immutable primitives.
 *
 * WHY PRIMITIVES, AND NOT THE CALLER'S OBJECTS. The first version of this state kept
 * the caller's `request` and `loaded` objects by reference. That is not a baseline —
 * it is an alias. A caller who mutated those same objects in place after Phase A
 * rewrote the "baseline" and the "current input" in one stroke, so Phase B compared
 * the new graph against itself and happily agreed. A completely different but
 * internally coherent Campaign / TokenConfig / mint / vault graph would have passed,
 * which is precisely the substitution this guard exists to prevent. `readonly` does
 * not help: it is erased at runtime and never applied to the caller's own object.
 *
 * So every field below is a copied base58 string or a number. There is nothing left
 * for a caller to reach into and change.
 *
 * Every request/loaded key that Phase A's graph validation examines appears here
 * exactly once, individually. No JSON serialization, no concatenated key, no hash —
 * comparison is field by field, so a difference cannot be lost in an encoding.
 */
type RedaxFrozenRequestIdentityBaseline =
  | Readonly<{
      action: 'prepare_user_output_ata'
      requestCampaign: string
      loadedCampaign: string
      requestOutputMint: string
      loadedCampaignOutputMint: string
    }>
  | Readonly<{
      action: 'convert_exact_in'
      requestCampaign: string
      loadedCampaign: string
      requestTokenConfig: string
      loadedTokenConfig: string
      loadedTokenConfigCampaign: string
      requestLegacyMint: string
      loadedTokenConfigLegacyMint: string
      requestOutputMint: string
      loadedCampaignOutputMint: string
      requestProtocolFeeVault: string
      loadedCampaignProtocolFeeVault: string
    }>

/**
 * What Phase A froze, so Phase B can detect drift.
 *
 * This is a BASELINE STORE and an AUTHENTICITY STORE. It deliberately holds no
 * Phase-A verdict: Phase B does not ask "did Phase A pass?", it re-reads the chain
 * and re-decides. It holds no raw RPC response, no raw error, no account bytes, no
 * adapter, no Transaction and no signed bytes — and, apart from the attempt's own
 * `Connection`, no caller-owned object of any kind. None of it is reachable from
 * outside this module.
 */
interface RedaxHolderAttemptState {
  readonly connection: Connection
  readonly programId: string
  readonly wallet: string
  readonly identity: RedaxFrozenRequestIdentityBaseline
  readonly protocolFeeAuthority: string
  readonly protocolEmergencyPauseAuthority: string
  readonly protocolConfigBump: number
  readonly phaseAContextSlot: number
}

const ATTEMPTS = new WeakMap<RedaxHolderChainGuardAttemptSnapshot, RedaxHolderAttemptState>()

// --- Helpers -----------------------------------------------------------------

function refuse(
  phase: RedaxHolderChainGuardPhase,
  code: RedaxHolderChainGuardRefusalCode,
  contextSlot: number | null,
): RedaxHolderChainGuardRefusal {
  return { ok: false, phase, code, contextSlot }
}

/** The reader's structural failures map 1:1 onto guard refusals. */
function fromReadFailure(code: RedaxGuardAccountsReadFailureCode): RedaxHolderChainGuardRefusalCode {
  return code
}

/**
 * Classify the attempt's endpoint. A classifier throw (a non-string endpoint, a
 * hostile object) is a refusal, never an exception the caller has to remember to
 * handle — and never a pass.
 */
function isExpectedDevnetEndpoint(connection: Connection): boolean {
  try {
    return getChainForEndpoint(connection.rpcEndpoint) === REDAX_EXPECTED_CHAIN
  } catch {
    return false
  }
}

/** Exact static checks shared by both phases. */
function checkRuntime(
  phase: RedaxHolderChainGuardPhase,
  connection: Connection,
  runtime: RedaxHolderChainGuardRuntime,
): RedaxHolderChainGuardRefusal | null {
  if (runtime.mode !== REDAX_EXPECTED_MODE) {
    return refuse(phase, 'WRONG_MODE', null)
  }
  if (runtime.cluster !== REDAX_EXPECTED_CLUSTER) {
    return refuse(phase, 'WRONG_CLUSTER_LABEL', null)
  }
  if (!isExpectedDevnetEndpoint(connection)) {
    return refuse(phase, 'ENDPOINT_NOT_DEVNET', null)
  }
  return null
}

/** Fresh live genesis. A read failure is a refusal, never an assumed match. */
async function checkGenesis(
  phase: RedaxHolderChainGuardPhase,
  connection: Connection,
): Promise<RedaxHolderChainGuardRefusal | null> {
  let genesisHash: string
  try {
    genesisHash = await connection.getGenesisHash()
  } catch {
    return refuse(phase, 'RPC_READ_UNAVAILABLE', null)
  }
  if (!isRedaxExpectedDevnetGenesisHash(genesisHash)) {
    return refuse(phase, 'GENESIS_MISMATCH', null)
  }
  return null
}

/**
 * Does the request agree with what we actually read from chain, and with what the
 * program itself will re-derive?
 *
 * Address equality against the loaded accounts is not enough on its own: the
 * TokenConfig PDA and the canonical protocol fee vault are both DERIVED by the
 * program, so we re-derive them here and require the request to match. That is what
 * makes a substituted TokenConfig or a substituted fee vault impossible to slip
 * past — rather than merely unlikely.
 */
function checkRequestIdentities(
  request: RedaxHolderChainGuardRequest,
  loaded: RedaxHolderChainGuardLoaded,
  programId: PublicKey,
  protocolFeeAuthority: PublicKey,
): boolean {
  const campaign = loaded.campaign
  if (!request.campaign.equals(campaign.address)) {
    return false
  }
  if (!request.outputMint.equals(campaign.outputMint)) {
    return false
  }
  if (request.kind === 'prepare_user_output_ata') {
    return true
  }

  const tokenConfig = loaded.tokenConfig
  if (tokenConfig === undefined) {
    return false
  }
  if (!tokenConfig.campaign.equals(campaign.address)) {
    return false
  }
  if (!request.tokenConfig.equals(tokenConfig.address)) {
    return false
  }
  if (!request.legacyMint.equals(tokenConfig.legacyMint)) {
    return false
  }
  if (!request.protocolFeeVault.equals(campaign.protocolFeeVault)) {
    return false
  }
  // Canonical TokenConfig PDA, re-derived exactly as the program seeds it.
  const derivedTokenConfig = deriveTokenConfigPda(programId, campaign.address, tokenConfig.legacyMint)
  if (!derivedTokenConfig.pda.equals(request.tokenConfig)) {
    return false
  }
  // Canonical classic-SPL fee vault, re-derived from the FRESH ProtocolConfig fee
  // authority — never from a caller-supplied address.
  const derivedFeeVault = deriveProtocolFeeVaultAta(protocolFeeAuthority, campaign.outputMint)
  if (!derivedFeeVault.equals(request.protocolFeeVault)) {
    return false
  }
  return true
}

/**
 * Copy the identity graph out of the caller's objects into frozen primitives.
 *
 * This is the moment the baseline stops being the caller's to change. `toBase58()`
 * produces a fresh string; nothing here holds a reference back into `request` or
 * `loaded`, so a later in-place mutation of those containers cannot reach it.
 *
 * Called once in Phase A (only after the graph has been validated) and again in
 * Phase B (from whatever the caller has passed the second time). Comparing the two
 * is what catches a swapped graph.
 */
function captureRequestIdentityBaseline(
  request: RedaxHolderChainGuardRequest,
  loaded: RedaxHolderChainGuardLoaded,
): RedaxFrozenRequestIdentityBaseline | null {
  const campaign = loaded.campaign
  if (request.kind === 'prepare_user_output_ata') {
    return Object.freeze({
      action: 'prepare_user_output_ata' as const,
      requestCampaign: request.campaign.toBase58(),
      loadedCampaign: campaign.address.toBase58(),
      requestOutputMint: request.outputMint.toBase58(),
      loadedCampaignOutputMint: campaign.outputMint.toBase58(),
    })
  }

  const tokenConfig = loaded.tokenConfig
  if (tokenConfig === undefined) {
    return null
  }
  return Object.freeze({
    action: 'convert_exact_in' as const,
    requestCampaign: request.campaign.toBase58(),
    loadedCampaign: campaign.address.toBase58(),
    requestTokenConfig: request.tokenConfig.toBase58(),
    loadedTokenConfig: tokenConfig.address.toBase58(),
    loadedTokenConfigCampaign: tokenConfig.campaign.toBase58(),
    requestLegacyMint: request.legacyMint.toBase58(),
    loadedTokenConfigLegacyMint: tokenConfig.legacyMint.toBase58(),
    requestOutputMint: request.outputMint.toBase58(),
    loadedCampaignOutputMint: campaign.outputMint.toBase58(),
    requestProtocolFeeVault: request.protocolFeeVault.toBase58(),
    loadedCampaignProtocolFeeVault: campaign.protocolFeeVault.toBase58(),
  })
}

/**
 * Field-by-field equality of two frozen baselines.
 *
 * Deliberately explicit rather than `JSON.stringify`-based: a serializer decides key
 * order, silently drops `undefined`, and would let a whole field go missing without
 * anyone noticing. Here every field is named, so a new field cannot be added to the
 * baseline and forgotten here without the compiler objecting.
 */
function sameRequestIdentityBaseline(
  a: RedaxFrozenRequestIdentityBaseline,
  b: RedaxFrozenRequestIdentityBaseline,
): boolean {
  if (a.action !== b.action) {
    return false
  }
  if (a.action === 'prepare_user_output_ata' && b.action === 'prepare_user_output_ata') {
    return (
      a.requestCampaign === b.requestCampaign &&
      a.loadedCampaign === b.loadedCampaign &&
      a.requestOutputMint === b.requestOutputMint &&
      a.loadedCampaignOutputMint === b.loadedCampaignOutputMint
    )
  }
  if (a.action === 'convert_exact_in' && b.action === 'convert_exact_in') {
    return (
      a.requestCampaign === b.requestCampaign &&
      a.loadedCampaign === b.loadedCampaign &&
      a.requestTokenConfig === b.requestTokenConfig &&
      a.loadedTokenConfig === b.loadedTokenConfig &&
      a.loadedTokenConfigCampaign === b.loadedTokenConfigCampaign &&
      a.requestLegacyMint === b.requestLegacyMint &&
      a.loadedTokenConfigLegacyMint === b.loadedTokenConfigLegacyMint &&
      a.requestOutputMint === b.requestOutputMint &&
      a.loadedCampaignOutputMint === b.loadedCampaignOutputMint &&
      a.requestProtocolFeeVault === b.requestProtocolFeeVault &&
      a.loadedCampaignProtocolFeeVault === b.loadedCampaignProtocolFeeVault
    )
  }
  return false
}

/**
 * The JSON-RPC code a node raises when it has not yet reached the requested slot.
 * Kept local so the guard's blockhash paths need no import to classify it.
 */
const MIN_CONTEXT_SLOT_NOT_REACHED_CODE = -32016

/**
 * Classify a blockhash-RPC failure STRUCTURALLY, by numeric code.
 *
 * The account reader already does this; the two blockhash calls did not, so a node
 * that could not reach the requested `minContextSlot` was reported as a generic RPC
 * failure — the min-context protection was there, but its result was unobservable.
 *
 * Numeric code only: never `instanceof` (nominal checks break across duplicate
 * package instances, and this repository really does resolve two `@solana/web3.js`
 * copies), never an error name, message or keyword. `Reflect.get` is wrapped because
 * a hostile object can define a throwing getter; that falls through to the generic
 * refusal rather than escaping as an exception. Both outcomes refuse.
 */
function classifyGuardRpcFailure(
  error: unknown,
): 'MIN_CONTEXT_UNAVAILABLE' | 'RPC_READ_UNAVAILABLE' {
  try {
    if (
      typeof error === 'object' &&
      error !== null &&
      Reflect.get(error, 'code') === MIN_CONTEXT_SLOT_NOT_REACHED_CODE
    ) {
      return 'MIN_CONTEXT_UNAVAILABLE'
    }
  } catch {
    // Fall through to the value-free generic refusal.
  }
  return 'RPC_READ_UNAVAILABLE'
}

/**
 * Recover the private state for an attempt, proving both that the snapshot is one
 * we minted AND that the caller is still on the same Connection object.
 *
 * The same-Connection requirement is not pedantry: a guard that validated one
 * endpoint while the transaction was sent down another would prove nothing at all.
 */
function resolveAttempt(
  phase: RedaxHolderChainGuardPhase,
  snapshot: RedaxHolderChainGuardAttemptSnapshot,
  connection: Connection,
): RedaxHolderAttemptState | RedaxHolderChainGuardRefusal {
  const state = ATTEMPTS.get(snapshot)
  if (state === undefined) {
    return refuse(phase, 'ATTEMPT_SNAPSHOT_INVALID', null)
  }
  if (state.connection !== connection) {
    return refuse(phase, 'CONNECTION_IDENTITY_MISMATCH', null)
  }
  return state
}

function isRefusal(
  value: RedaxHolderAttemptState | RedaxHolderChainGuardRefusal,
): value is RedaxHolderChainGuardRefusal {
  return (value as RedaxHolderChainGuardRefusal).ok === false
}

// --- Phase A -----------------------------------------------------------------

/**
 * Run BEFORE any instruction or Transaction is constructed.
 *
 * On success it freezes an attempt baseline and returns an opaque snapshot. It has
 * authorized nothing: the snapshot is a handle, not a permit.
 */
export async function checkRedaxHolderChainGuardPhaseA(input: {
  readonly connection: Connection
  readonly runtime: RedaxHolderChainGuardRuntime
  readonly wallet: PublicKey | null
  readonly request: RedaxHolderChainGuardRequest
  readonly loaded: RedaxHolderChainGuardLoaded
}): Promise<RedaxHolderChainGuardPhaseAResult> {
  const { connection, runtime, wallet, request, loaded } = input

  const runtimeRefusal = checkRuntime('A', connection, runtime)
  if (runtimeRefusal !== null) {
    return runtimeRefusal
  }

  const genesisRefusal = await checkGenesis('A', connection)
  if (genesisRefusal !== null) {
    return genesisRefusal
  }

  const read = await readRedaxGuardAccountsWithContext(connection, runtime.programId, {
    commitment: REDAX_GUARD_COMMITMENT,
  })
  if (!read.ok) {
    return refuse('A', fromReadFailure(read.code), read.contextSlot)
  }

  // The loader-owner equality lives here, not in the data module: the expected
  // identity is a wallet-layer secret-by-construction, and the data module must not
  // import it.
  if (!isRedaxExpectedUpgradeableLoaderOwner(read.program.owner)) {
    return refuse('A', 'PROGRAM_OWNER_MISMATCH', read.contextSlot)
  }

  // Holder topology: the connected wallet IS the user and IS the fee payer. The
  // Team/Admin payer = governance = admin topology is deliberately NOT imposed, and
  // the protocol fee authority remains a non-signer.
  if (wallet === null) {
    return refuse('A', 'WALLET_IDENTITY_MISMATCH', read.contextSlot)
  }

  const protocolFeeAuthority = read.protocolConfig.data.protocolFeeAuthority
  if (!checkRequestIdentities(request, loaded, runtime.programId, protocolFeeAuthority)) {
    return refuse('A', 'REQUEST_IDENTITY_MISMATCH', read.contextSlot)
  }

  // Only now — after the graph has been validated — is it copied out of the caller's
  // objects and frozen. From here on, the attempt's identity is ours, not theirs.
  const identity = captureRequestIdentityBaseline(request, loaded)
  if (identity === null) {
    return refuse('A', 'REQUEST_IDENTITY_MISMATCH', read.contextSlot)
  }

  const snapshot: RedaxHolderChainGuardAttemptSnapshot = Object.freeze({
    phaseAContextSlot: read.contextSlot,
  })
  ATTEMPTS.set(
    snapshot,
    Object.freeze({
      connection,
      programId: runtime.programId.toBase58(),
      wallet: wallet.toBase58(),
      identity,
      protocolFeeAuthority: protocolFeeAuthority.toBase58(),
      protocolEmergencyPauseAuthority:
        read.protocolConfig.data.protocolEmergencyPauseAuthority.toBase58(),
      protocolConfigBump: read.protocolConfig.data.bump,
      phaseAContextSlot: read.contextSlot,
    }),
  )

  return { ok: true, phase: 'A', snapshot, contextSlot: read.contextSlot }
}

// --- Blockhash ---------------------------------------------------------------

/**
 * Obtain the attempt's blockhash at a context NO OLDER than Phase A.
 *
 * Both protections are applied, because they defend different things:
 * `minContextSlot` makes a lagging node refuse to answer, and the local floor check
 * makes a lagging ANSWER refuse to be used.
 */
export async function fetchRedaxAttemptBlockhash(input: {
  readonly connection: Connection
  readonly snapshot: RedaxHolderChainGuardAttemptSnapshot
}): Promise<RedaxAttemptBlockhashResult> {
  const { connection, snapshot } = input

  const state = resolveAttempt('BLOCKHASH', snapshot, connection)
  if (isRefusal(state)) {
    return state
  }

  try {
    const response = await connection.getLatestBlockhashAndContext({
      commitment: REDAX_GUARD_COMMITMENT,
      minContextSlot: state.phaseAContextSlot,
    })
    if (response.context.slot < state.phaseAContextSlot) {
      return refuse('BLOCKHASH', 'MIN_CONTEXT_UNAVAILABLE', response.context.slot)
    }
    return {
      ok: true,
      phase: 'BLOCKHASH',
      blockhash: response.value.blockhash,
      lastValidBlockHeight: response.value.lastValidBlockHeight,
      blockhashContextSlot: response.context.slot,
    }
  } catch (error) {
    return refuse('BLOCKHASH', classifyGuardRpcFailure(error), null)
  }
}

// --- Phase B -----------------------------------------------------------------

/**
 * Run IMMEDIATELY before the transport is invoked.
 *
 * Every mutable fact is read again, live, and re-decided against the source-pinned
 * expectations — Phase A's success is never consulted. A refusal here happens
 * strictly before invocation, so it produces no wallet prompt and cannot have
 * broadcast anything.
 */
export async function checkRedaxHolderChainGuardPhaseB(input: {
  readonly connection: Connection
  readonly snapshot: RedaxHolderChainGuardAttemptSnapshot
  readonly runtime: RedaxHolderChainGuardRuntime
  readonly wallet: PublicKey | null
  readonly request: RedaxHolderChainGuardRequest
  readonly loaded: RedaxHolderChainGuardLoaded
  readonly blockhash: string
  readonly blockhashContextSlot: number
  readonly preStateContextSlot?: number
}): Promise<RedaxHolderChainGuardPhaseBResult> {
  const { connection, snapshot, runtime, wallet, request, loaded, blockhash } = input

  const state = resolveAttempt('B', snapshot, connection)
  if (isRefusal(state)) {
    return state
  }

  const runtimeRefusal = checkRuntime('B', connection, runtime)
  if (runtimeRefusal !== null) {
    return runtimeRefusal
  }

  const genesisRefusal = await checkGenesis('B', connection)
  if (genesisRefusal !== null) {
    return genesisRefusal
  }

  // Nothing observed after this point may be older than anything already accepted.
  const floor = Math.max(
    state.phaseAContextSlot,
    input.preStateContextSlot ?? 0,
    input.blockhashContextSlot,
  )

  const read = await readRedaxGuardAccountsWithContext(connection, runtime.programId, {
    commitment: REDAX_GUARD_COMMITMENT,
    minContextSlot: floor,
  })
  if (!read.ok) {
    return refuse('B', fromReadFailure(read.code), read.contextSlot)
  }
  if (read.contextSlot < floor) {
    // The request option protects request EVALUATION; this rejects a stale ANSWER.
    return refuse('B', 'MIN_CONTEXT_UNAVAILABLE', read.contextSlot)
  }

  if (!isRedaxExpectedUpgradeableLoaderOwner(read.program.owner)) {
    return refuse('B', 'PROGRAM_OWNER_MISMATCH', read.contextSlot)
  }

  // The ProtocolConfig was valid in Phase A and is valid now — but is it the SAME
  // one? A re-pointed fee authority between the two phases would redirect the fee,
  // and every individual check would still have passed.
  const fresh = read.protocolConfig.data
  if (
    fresh.protocolFeeAuthority.toBase58() !== state.protocolFeeAuthority ||
    fresh.protocolEmergencyPauseAuthority.toBase58() !== state.protocolEmergencyPauseAuthority ||
    fresh.bump !== state.protocolConfigBump
  ) {
    return refuse('B', 'PROTOCOL_CONFIG_CHANGED', read.contextSlot)
  }

  if (wallet === null || wallet.toBase58() !== state.wallet) {
    return refuse('B', 'WALLET_IDENTITY_MISMATCH', read.contextSlot)
  }

  // 1. Re-run the FULL relationship validation on what the caller is handing us now,
  //    against the FRESH fee authority — the request must still be internally sound.
  if (
    runtime.programId.toBase58() !== state.programId ||
    !checkRequestIdentities(request, loaded, runtime.programId, fresh.protocolFeeAuthority)
  ) {
    return refuse('B', 'REQUEST_IDENTITY_MISMATCH', read.contextSlot)
  }
  // 2. Being internally sound is not enough. Flatten what we were just handed into
  //    primitives and compare it, field by field, against what Phase A approved. A
  //    different-but-coherent graph — a swapped Campaign, TokenConfig, mint or vault —
  //    is caught here, and the comparison cannot be defeated by mutating the caller's
  //    own objects, because the Phase-A side of it no longer lives in them.
  const current = captureRequestIdentityBaseline(request, loaded)
  if (current === null || !sameRequestIdentityBaseline(current, state.identity)) {
    return refuse('B', 'REQUEST_IDENTITY_MISMATCH', read.contextSlot)
  }

  try {
    const response = await connection.isBlockhashValid(blockhash, {
      commitment: REDAX_GUARD_COMMITMENT,
      minContextSlot: floor,
    })
    if (response.context.slot < floor) {
      return refuse('B', 'MIN_CONTEXT_UNAVAILABLE', response.context.slot)
    }
    if (response.value !== true) {
      return refuse('B', 'BLOCKHASH_INVALID', response.context.slot)
    }
  } catch (error) {
    return refuse('B', classifyGuardRpcFailure(error), read.contextSlot)
  }

  return { ok: true, phase: 'B', contextSlot: read.contextSlot }
}
