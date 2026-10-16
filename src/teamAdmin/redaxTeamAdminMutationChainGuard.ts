// -----------------------------------------------------------------------------
// WHAT THIS FILE IS
// -----------------------------------------------------------------------------
// The chain-side admission control for the ONE post-init mutation corridor: what must be
// true before a plan exists, before the wallet is asked, and again immediately before the
// one irreversible raw send.
//
// It is an INDEPENDENT guard. `app/src/teamAdmin/redaxTeamAdminChainGuard.ts` is the closed
// S1 guard and is NOT imported, NOT generalized and NOT modified; neither is the Holder
// guard. This module owns its OWN private attempt baselines, its OWN witnesses and its OWN
// refusal vocabulary, and the three guards cannot acquire each other.
//
// What it DOES share is the committed leaf primitives — the pinned devnet genesis and the
// pinned upgradeable-loader identity in `app/src/wallet/redaxChainIdentity.ts`, and the
// authority-grade readers in `app/src/data/devnet/redaxDevnetAccounts.ts`. Sharing those is
// the correct answer rather than a second copy free to disagree about which chain devnet
// is; sharing a primitive is not sharing a route.
//
// -----------------------------------------------------------------------------
// WHAT THIS GUARD DOES *NOT* HAVE
// -----------------------------------------------------------------------------
// No `Keypair`, no `partialSign`, no ephemeral signer, no salt, no output-mint custody and
// no assumption that one exists. Those are S1's, and a post-init mutation has none of them:
// the Campaign and the output mint already EXIST, and every signer role collapses to the
// one approved Team wallet.

import type { Connection, PublicKey } from '@solana/web3.js'
import { getChainForEndpoint } from '@solana/wallet-standard-util'

import {
  readRedaxTeamAdminGuardAccountsWithContext,
  readRedaxTeamAdminMutationCoherentStateWithContext,
  type RedaxTeamAdminGuardAccountsReadFailureCode,
  type RedaxTeamAdminMutationCampaignPublicFacts,
  type RedaxTeamAdminMutationCoherentReadRequest,
} from '../data/devnet/redaxDevnetAccounts'
import {
  isRedaxExpectedDevnetGenesisHash,
  isRedaxExpectedUpgradeableLoaderOwner,
} from '../wallet/redaxChainIdentity'

// --- Exact expectations ------------------------------------------------------

/**
 * The only accepted classifier result.
 *
 * The installed classifier is a URL-token matcher whose fall-through is MAINNET, so
 * demanding EXACTLY `solana:devnet` turns that fail-open default into a fail-closed
 * refusal. It is necessary but NEVER sufficient: any URL merely containing the token
 * "devnet" also classifies as devnet while pointing anywhere at all. That gap is closed by
 * the fresh genesis check, which no URL string can forge.
 */
const REDAX_EXPECTED_CHAIN = 'solana:devnet'

/** The only mode in which a Team/Admin post-init mutation may exist at all. */
const REDAX_EXPECTED_MODE = 'DEVNET_TX_ENABLED'

/** The only configured cluster label accepted alongside it. */
const REDAX_EXPECTED_CLUSTER = 'devnet'

/** Every guard read is `confirmed`: a `finalized` read is STALER, and a pre-sign guard
 *  wants the freshest possible view of the chain, not the safest-to-quote one. */
const REDAX_MUTATION_GUARD_COMMITMENT = 'confirmed' as const

// --- Public vocabulary -------------------------------------------------------

/** Which guard operation produced a result. */
export type RedaxTeamAdminMutationGuardPhase = 'A' | 'BLOCKHASH' | 'B' | 'POST_WALLET'

/** Every way this guard can refuse. Value-free, closed and exhaustive. */
export type RedaxTeamAdminMutationGuardRefusalCode =
  | 'ATTEMPT_SNAPSHOT_INVALID'
  | 'CONNECTION_IDENTITY_MISMATCH'
  | 'WRONG_MODE'
  | 'WRONG_CLUSTER_LABEL'
  | 'ENDPOINT_NOT_DEVNET'
  | 'GENESIS_MISMATCH'
  | 'PROGRAM_ABSENT'
  | 'PROGRAM_NOT_EXECUTABLE'
  | 'PROGRAM_STATE_INVALID'
  | 'PROGRAM_OWNER_MISMATCH'
  | 'PROGRAM_DATA_ABSENT'
  | 'PROGRAM_DATA_STATE_INVALID'
  | 'PROGRAM_DATA_OWNER_MISMATCH'
  | 'PROGRAM_DATA_RELATION_DRIFT'
  | 'UPGRADE_AUTHORITY_CHANGED'
  | 'PROTOCOL_CONFIG_ABSENT'
  | 'PROTOCOL_CONFIG_OWNER_MISMATCH'
  | 'PROTOCOL_CONFIG_DISCRIMINATOR_MISMATCH'
  | 'PROTOCOL_CONFIG_DECODE_FAILED'
  | 'PROTOCOL_CONFIG_BUMP_MISMATCH'
  | 'PROTOCOL_CONFIG_CHANGED'
  | 'TEAM_IDENTITY_ABSENT'
  | 'TEAM_IDENTITY_MISMATCH'
  | 'TEAM_WALLET_IS_CUSTODY_AUTHORITY'
  | 'CAMPAIGN_ABSENT'
  | 'CAMPAIGN_UNREADABLE'
  | 'CAMPAIGN_PDA_NOT_SELF_CONSISTENT'
  | 'CAMPAIGN_ADMIN_MISMATCH'
  | 'CAMPAIGN_IDENTITY_DRIFT'
  | 'PRE_STATE_NOT_ADMISSIBLE'
  | 'LEGACY_MINT_NOT_CLASSIC_SPL'
  | 'LEGACY_MINT_DECIMALS_MISMATCH'
  | 'OUTPUT_MINT_NOT_CLASSIC_SPL'
  | 'OUTPUT_MINT_DECIMALS_MISMATCH'
  | 'MUTATION_PLAN_IDENTITY_MISMATCH'
  | 'PHASE_B_CONTINUITY_MISMATCH'
  | 'BLOCKHASH_INVALID'
  | 'MIN_CONTEXT_UNAVAILABLE'
  | 'RPC_READ_UNAVAILABLE'

/** A refusal. It says what failed and where — and nothing else. */
export interface RedaxTeamAdminMutationGuardRefusal {
  readonly ok: false
  readonly phase: RedaxTeamAdminMutationGuardPhase
  readonly code: RedaxTeamAdminMutationGuardRefusalCode
  readonly contextSlot: number | null
}

/**
 * The runtime facts the caller has already resolved.
 *
 * Injected rather than read here: this module owns no environment access, which is also
 * what lets it be tested without one. `mode` and `cluster` are plain strings on purpose —
 * they are compared against exact literals, so any unexpected value (including `null`) is a
 * refusal rather than something this module has to know how to name.
 */
export interface RedaxTeamAdminMutationGuardRuntime {
  readonly mode: string
  readonly cluster: string | null
  readonly programId: PublicKey
}

/** Which accounts this attempt's pre-state must be observed over. */
export type RedaxTeamAdminMutationGuardTarget = RedaxTeamAdminMutationCoherentReadRequest

/**
 * The CLOSED SIX post-init mutation operations, as one list and one derived type.
 *
 * A list rather than a bare union so the runtime resolver below and the compile-time type
 * cannot drift: adding a seventh operation to one of them adds it to both, and the
 * exhaustive `switch`es keyed on this type then fail to COMPILE until every rule that
 * depends on the operation has been extended too.
 */
const GUARD_OPERATIONS = Object.freeze([
  'ADD_TOKEN_CONFIG',
  'SETUP_METADATA',
  'ACTIVATE_CAMPAIGN',
  'PAUSE_CAMPAIGN',
  'UNPAUSE_CAMPAIGN',
  'FINALIZE_CAMPAIGN',
] as const)

type RedaxTeamAdminMutationGuardOperation = (typeof GUARD_OPERATIONS)[number]

/**
 * Narrow a CALLER-SUPPLIED operation string, or answer `null`.
 *
 * The operation arrives as a plain `string` for the same reason `runtime.mode` and
 * `runtime.cluster` do: an unexpected value must be a REFUSAL rather than something this
 * module has to know how to name. Membership is decided against the frozen list — never by
 * indexing an object literal, which would answer for inherited keys like `toString` — so no
 * prototype-borne name can resolve to an operation.
 */
function resolveGuardOperation(value: unknown): RedaxTeamAdminMutationGuardOperation | null {
  return typeof value === 'string' && (GUARD_OPERATIONS as readonly string[]).includes(value)
    ? (value as RedaxTeamAdminMutationGuardOperation)
    : null
}

/**
 * Which read family each of the closed six operations must be observed over.
 *
 * THE OPERATION SELECTS WHICH FACTS ARE COMPARED, so it is pinned three separate ways and a
 * caller controls none of them. It is validated against the closed six above; it is
 * required to AGREE with the read family, which is what actually decides which accounts get
 * read; and — the part that matters most — it is FROZEN AT PHASE A, so a later phase cannot
 * present a different one. The THREE remaining lifecycle operations share a single
 * `STATUS_ONLY` family, so the family alone could never have told them apart; without the
 * Phase-A freeze a caller could open an attempt as one of them and reassert as another.
 */
const OPERATION_READ_FAMILY: Readonly<
  Record<RedaxTeamAdminMutationGuardOperation, RedaxTeamAdminMutationGuardTarget['family']>
> = Object.freeze({
  ADD_TOKEN_CONFIG: 'ADD_TOKEN_CONFIG',
  SETUP_METADATA: 'SETUP_METADATA',
  ACTIVATE_CAMPAIGN: 'ACTIVATE_CAMPAIGN',
  PAUSE_CAMPAIGN: 'STATUS_ONLY',
  UNPAUSE_CAMPAIGN: 'STATUS_ONLY',
  FINALIZE_CAMPAIGN: 'STATUS_ONLY',
})

/**
 * The frozen mutation-plan identity Phase B and the post-wallet reassertion check against.
 *
 * Public identities only — there is no secret here and no field one could travel in. There
 * is deliberately no salt and no output-mint custody address: a post-init mutation neither
 * creates a mint nor derives a Campaign, so a plan carrying either would be describing S1.
 */
export interface RedaxTeamAdminMutationFrozenPlanIdentity {
  readonly campaign: PublicKey
  readonly operation: string
  /** The identity digest, which is what makes "the same mutation" a comparable fact. */
  readonly mutationIdentitySha256Hex: string
  /** The re-derived TokenConfig or metadata PDA, or `null` when the operation creates none. */
  readonly witnessAddress: string | null
}

/**
 * The opaque handle Phase A returns. Its ONLY public datum is the context slot it observed.
 *
 * Everything that matters about the attempt is held privately, keyed by this object's
 * identity. A snapshot this module did not mint — a literal, a clone, a spread, a JSON
 * round trip — is simply not a key in that map, so Phase A cannot be forged, replayed or
 * reconstructed.
 */
export interface RedaxTeamAdminMutationGuardAttemptSnapshot {
  readonly phaseAContextSlot: number
}

/** Phase-A outcome. The fresh Campaign pre-state it read travels with it. */
export type RedaxTeamAdminMutationGuardPhaseAResult =
  | {
      readonly ok: true
      readonly phase: 'A'
      readonly snapshot: RedaxTeamAdminMutationGuardAttemptSnapshot
      readonly contextSlot: number
      /** The context the CAMPAIGN pre-state was observed at. */
      readonly preStateContextSlot: number
      /** Read FRESH. The plan is admitted against exactly this, never a caller input. */
      readonly campaign: RedaxTeamAdminMutationCampaignPublicFacts
      /** Was the operation's own target account positively observed ABSENT? */
      readonly targetAccountAbsent: boolean
    }
  | RedaxTeamAdminMutationGuardRefusal

/** Blockhash-helper outcome. Internal attempt data — not UI copy. */
export type RedaxTeamAdminMutationAttemptBlockhashResult =
  | {
      readonly ok: true
      readonly phase: 'BLOCKHASH'
      readonly blockhash: string
      readonly lastValidBlockHeight: number
      readonly blockhashContextSlot: number
    }
  | RedaxTeamAdminMutationGuardRefusal

/** A successful Phase B. Three members and no fourth — no send floor exists yet. */
export interface RedaxTeamAdminMutationGuardPhaseBSuccess {
  readonly ok: true
  readonly phase: 'B'
  readonly contextSlot: number
}

/**
 * A successful post-wallet reassertion. It is the ONLY shape carrying a send floor.
 *
 * `sendContextFloor` is computed INSIDE this module, on the post-wallet success path and
 * nowhere else, as the maximum of the exact TWO successful post-wallet observations — the
 * account read and the blockhash-validity read. The action root does not, and cannot,
 * reassemble it: a floor a caller reconstructs from separate values is a floor this guard
 * no longer enforces, and the two observations it is built from never leave this module
 * separately.
 *
 * It is NOT an arbitrary maximum over unrelated history. Neither a Phase-A context, nor a
 * Phase-B context, nor the blockhash INPUT context, nor a locally remembered slot
 * participates. Each of the two members was itself minContext-gated at its own accepted
 * floor before it was observed, so their maximum is a fact about two enforced reads rather
 * than arithmetic over things nobody re-checked.
 */
export interface RedaxTeamAdminMutationGuardPostWalletSuccess {
  readonly ok: true
  readonly phase: 'POST_WALLET'
  readonly contextSlot: number
  /** The ONE value a Team/Admin mutation raw send may pass as `minContextSlot`. */
  readonly sendContextFloor: number
}

/** What `checkRedaxTeamAdminMutationGuardPhaseB` returns — and nothing else. */
export type RedaxTeamAdminMutationGuardPhaseBResult =
  | RedaxTeamAdminMutationGuardPhaseBSuccess
  | RedaxTeamAdminMutationGuardRefusal

/** What `reassertRedaxTeamAdminMutationGuardAfterWallet` returns — and nothing else. */
export type RedaxTeamAdminMutationGuardPostWalletResult =
  | RedaxTeamAdminMutationGuardPostWalletSuccess
  | RedaxTeamAdminMutationGuardRefusal

// --- Private attempt state ------------------------------------------------------
//
// Every field is a copied base58 string, a number or a boolean. WHY PRIMITIVES, AND NOT THE
// CALLER'S OBJECTS: keeping caller objects by reference is not a baseline, it is an alias —
// a caller that mutated them in place after Phase A would rewrite the "baseline" and the
// "current input" in one stroke, and the comparison would be against itself. `readonly` does
// not help; it is erased at runtime and never applied to the caller's own object.

interface MutationAttemptState {
  readonly connection: Connection
  readonly programId: string
  readonly programDataAddress: string
  readonly upgradeAuthority: string | null
  readonly protocolFeeAuthority: string
  readonly protocolEmergencyPauseAuthority: string
  readonly protocolConfigBump: number
  readonly approvedTeamWallet: string
  readonly campaign: string
  readonly campaignAdmin: string
  readonly campaignOutputMint: string
  readonly campaignSaltHex: string
  /** Which accounts Phase A's pre-state was observed over. Reassertions must match it. */
  /**
   * `null` for every operation that registers no mint. Freezing it is what makes §29's rule
   * mechanical rather than aspirational: a later phase may re-observe the mints, but it may
   * not arrive with a DIFFERENT expectation, so a caller cannot widen its own preflight
   * after the wallet has been asked. `expectedLegacyDecimals` and `expectedOutputDecimals`
   * are compared, not merely carried.
   */
  readonly mintPreflight: RedaxTeamAdminMutationAddMintPreflight | null
  /** The two mint addresses Phase A bound. Neither may be swapped at a later phase. */
  readonly legacyMint: string | null
  readonly outputMint: string | null
  readonly targetFamily: RedaxTeamAdminMutationGuardTarget['family']
  /**
   * THE OPERATION THIS ATTEMPT IS, frozen at Phase A and never re-derived from a later
   * input. The four lifecycle operations share one `STATUS_ONLY` read family, so the family
   * alone cannot tell them apart; without this, an attempt opened as one of them could be
   * reasserted — and sent — as another, against a footprint built for something else.
   */
  readonly operation: RedaxTeamAdminMutationGuardOperation
  /** The COMPLETE operation-specific admission footprint, exactly as Phase A saw it. */
  readonly admission: MutationAdmissionFootprint
  readonly phaseAContextSlot: number
  readonly preStateContextSlot: number
}

/**
 * The MUTABLE pre-state ONE operation's own admission actually consumed — per operation.
 *
 * NOT "every mutable Campaign field" either. A Campaign also carries `discoveryStatus`,
 * `endTs`, `maxOutputSupplyRaw`, `totalOutputMintedRaw` and `totalProtocolFeesMintedRaw`,
 * and every one of those moves under ordinary Holder traffic. None of them appears in any
 * arm below and none is ever compared.
 *
 * WHAT EACH ARM CARRIES IS EXACTLY WHAT THE PLANNER ADMITTED THAT OPERATION AGAINST:
 *
 * - `ADD_TOKEN_CONFIG` — status (`initialized`), the count (the program's own
 *   `< MAX_TOKEN_CONFIGS_PER_CAMPAIGN` bound) and its own TokenConfig PDA's presence.
 *   `metadataSetup` is NOT admission-relevant: metadata may be set concurrently and this
 *   operation stays exactly as admissible as it was.
 * - `SETUP_METADATA` — status (`initialized`), `metadataSetup` (once-only, immutable) and
 *   the canonical metadata account's presence. The count is NOT admission-relevant.
 * - `ACTIVATE_CAMPAIGN` — status (`initialized`) and `metadataSetup`, which the PROGRAM
 *   itself requires for `activate_campaign` and which the product requires too. It creates
 *   no account, so it has no target presence.
 *
 * - `PAUSE_CAMPAIGN` / `UNPAUSE_CAMPAIGN` — the exact predecessor status and nothing else.
 * - `FINALIZE_CAMPAIGN` — the exact predecessor status Phase A OBSERVED. `active` and
 *   `paused` are both independently admissible predecessors, and that is precisely why
 *   equality is demanded rather than membership: the signed transaction was admitted from
 *   the one that was actually seen, and `predecessorStatus` is part of its mutation
 *   identity, so `active → paused` is a different admission and not an equivalent one.
 *
 * `targetPresence` is the TRI-STATE presence rather than the admitted boolean: `PRESENT` and
 * `UNREADABLE` are different failures and neither is the `ABSENT` an admission was granted
 * against.
 */
type MutationAdmissionFootprint =
  | {
      readonly operation: 'ADD_TOKEN_CONFIG'
      readonly campaignStatus: string
      readonly tokenConfigCount: number
      /** `ABSENT` / `PRESENT` / `UNREADABLE` — its own TokenConfig PDA. */
      readonly targetPresence: string | null
      readonly legacyMintPresence: string | null
      readonly legacyMintDecimals: number | null
      readonly outputMintPresence: string | null
      readonly outputMintDecimals: number | null
    }
  | {
      readonly operation: 'SETUP_METADATA'
      readonly campaignStatus: string
      readonly metadataSetup: boolean
      /** `ABSENT` / `PRESENT` / `UNREADABLE` — the canonical metadata account. */
      readonly targetPresence: string | null
    }
  | {
      readonly operation: 'ACTIVATE_CAMPAIGN'
      readonly campaignStatus: string
      readonly metadataSetup: boolean
    }
  | { readonly operation: 'PAUSE_CAMPAIGN'; readonly campaignStatus: string }
  | { readonly operation: 'UNPAUSE_CAMPAIGN'; readonly campaignStatus: string }
  | { readonly operation: 'FINALIZE_CAMPAIGN'; readonly campaignStatus: string }

interface MutationPlanBaseline {
  readonly campaign: string
  readonly operation: string
  readonly mutationIdentitySha256Hex: string
  readonly witnessAddress: string | null
}

interface MutationPhaseBWitness {
  readonly blockhash: string
  readonly blockhashContextSlot: number
  readonly accountsContextFloor: number
  readonly blockhashValidityContextFloor: number
}

/**
 * The private per-attempt maps. Keyed by the opaque snapshot's OBJECT IDENTITY.
 *
 * `WeakMap` on purpose: an attempt's baseline is reachable only while the caller still
 * holds the exact snapshot object this module minted, and it is collected with it. These are
 * this module's OWN maps — the S1 guard's are separate objects in a separate module, and
 * neither can reach the other's.
 */
const ATTEMPTS = new WeakMap<RedaxTeamAdminMutationGuardAttemptSnapshot, MutationAttemptState>()
const PLAN_BASELINES = new WeakMap<
  RedaxTeamAdminMutationGuardAttemptSnapshot,
  MutationPlanBaseline
>()
const PHASE_B_WITNESSES = new WeakMap<
  RedaxTeamAdminMutationGuardAttemptSnapshot,
  MutationPhaseBWitness
>()

/**
 * THE BOUND C2 SOL-PREFLIGHT CONTEXT FLOOR, per mutation attempt. Private, single-assignment.
 *
 * The mutation action root performs its own operation-specific SOL observation between
 * Phase A and the plan, and that verdict is authoritative only if everything the attempt
 * does afterwards describes a chain at least as new as the balance it was read from. The
 * slot is handed here and never handed back: it is stored under the authentic snapshot's
 * object identity like every other private per-attempt fact, and from that moment it
 * participates in every later floor this guard computes.
 *
 * ITS OWN MAP, in its own module. It is deliberately NOT shared with the S1 guard's
 * equivalent — the two corridors are separate guards over separate attempts, and a shared
 * store would be one object either could reach into. There is no cross-corridor helper and
 * no generic "external floor" API another action family could acquire: the operation is
 * named for this corridor and this preflight, and nothing else can call it meaningfully.
 */
const SOL_PREFLIGHT_FLOORS = new WeakMap<RedaxTeamAdminMutationGuardAttemptSnapshot, number>()

// --- Refusal helpers ------------------------------------------------------------

function refuse(
  phase: RedaxTeamAdminMutationGuardPhase,
  code: RedaxTeamAdminMutationGuardRefusalCode,
  contextSlot: number | null,
): RedaxTeamAdminMutationGuardRefusal {
  return { ok: false, phase, code, contextSlot }
}

function isRefusal(value: unknown): value is RedaxTeamAdminMutationGuardRefusal {
  return typeof value === 'object' && value !== null && (value as { ok?: unknown }).ok === false
}

function classifyGuardRpcFailure(
  error: unknown,
): 'MIN_CONTEXT_UNAVAILABLE' | 'RPC_READ_UNAVAILABLE' {
  const message =
    typeof error === 'object' && error !== null && typeof (error as { message?: unknown }).message === 'string'
      ? ((error as { message: string }).message)
      : ''
  return message.includes('Minimum context slot has not been reached')
    ? 'MIN_CONTEXT_UNAVAILABLE'
    : 'RPC_READ_UNAVAILABLE'
}

function fromReadFailure(
  code: RedaxTeamAdminGuardAccountsReadFailureCode,
): RedaxTeamAdminMutationGuardRefusalCode {
  switch (code) {
    case 'PROGRAM_ABSENT':
      return 'PROGRAM_ABSENT'
    case 'PROGRAM_NOT_EXECUTABLE':
      return 'PROGRAM_NOT_EXECUTABLE'
    case 'PROGRAM_STATE_INVALID':
      return 'PROGRAM_STATE_INVALID'
    case 'PROGRAM_DATA_ABSENT':
      return 'PROGRAM_DATA_ABSENT'
    case 'PROGRAM_DATA_STATE_INVALID':
      return 'PROGRAM_DATA_STATE_INVALID'
    case 'PROGRAM_DATA_RELATION_DRIFT':
      return 'PROGRAM_DATA_RELATION_DRIFT'
    case 'PROTOCOL_CONFIG_ABSENT':
      return 'PROTOCOL_CONFIG_ABSENT'
    case 'PROTOCOL_CONFIG_OWNER_MISMATCH':
      return 'PROTOCOL_CONFIG_OWNER_MISMATCH'
    case 'PROTOCOL_CONFIG_DISCRIMINATOR_MISMATCH':
      return 'PROTOCOL_CONFIG_DISCRIMINATOR_MISMATCH'
    case 'PROTOCOL_CONFIG_DECODE_FAILED':
      return 'PROTOCOL_CONFIG_DECODE_FAILED'
    case 'PROTOCOL_CONFIG_BUMP_MISMATCH':
      return 'PROTOCOL_CONFIG_BUMP_MISMATCH'
    case 'MIN_CONTEXT_UNAVAILABLE':
      return 'MIN_CONTEXT_UNAVAILABLE'
    default:
      return 'RPC_READ_UNAVAILABLE'
  }
}

// --- Shared checks ----------------------------------------------------------------

/** Mode, cluster label and endpoint classification. Nothing is read from a chain here. */
function checkRuntime(
  phase: RedaxTeamAdminMutationGuardPhase,
  connection: Connection,
  runtime: RedaxTeamAdminMutationGuardRuntime,
): RedaxTeamAdminMutationGuardRefusal | null {
  if (runtime.mode !== REDAX_EXPECTED_MODE) {
    return refuse(phase, 'WRONG_MODE', null)
  }
  if (runtime.cluster !== REDAX_EXPECTED_CLUSTER) {
    return refuse(phase, 'WRONG_CLUSTER_LABEL', null)
  }
  let chain: string
  try {
    chain = String(getChainForEndpoint(connection.rpcEndpoint))
  } catch {
    return refuse(phase, 'ENDPOINT_NOT_DEVNET', null)
  }
  return chain === REDAX_EXPECTED_CHAIN ? null : refuse(phase, 'ENDPOINT_NOT_DEVNET', null)
}

/** The live genesis hash. A URL string cannot forge this. */
async function checkGenesis(
  phase: RedaxTeamAdminMutationGuardPhase,
  connection: Connection,
): Promise<RedaxTeamAdminMutationGuardRefusal | null> {
  let genesis: string
  try {
    genesis = await connection.getGenesisHash()
  } catch (error) {
    return refuse(phase, classifyGuardRpcFailure(error), null)
  }
  return isRedaxExpectedDevnetGenesisHash(genesis) ? null : refuse(phase, 'GENESIS_MISMATCH', null)
}

/**
 * All three present authorities participate — the protocol fee authority, the protocol
 * emergency-pause authority and the program upgrade authority. An immutable program has no
 * third key, and comparing against an absent one is not a comparison.
 */
function isCustodyAuthority(
  wallet: PublicKey,
  feeAuthority: PublicKey,
  pauseAuthority: PublicKey,
  upgradeAuthority: PublicKey | null,
): boolean {
  const candidate = wallet.toBase58()
  if (candidate === feeAuthority.toBase58() || candidate === pauseAuthority.toBase58()) {
    return true
  }
  return upgradeAuthority !== null && candidate === upgradeAuthority.toBase58()
}

/** Resolve an attempt baseline, requiring the caller's Connection to be the exact one. */
function resolveAttempt(
  phase: RedaxTeamAdminMutationGuardPhase,
  snapshot: RedaxTeamAdminMutationGuardAttemptSnapshot,
  connection: Connection,
): MutationAttemptState | RedaxTeamAdminMutationGuardRefusal {
  const state = typeof snapshot === 'object' && snapshot !== null ? ATTEMPTS.get(snapshot) : undefined
  if (state === undefined) {
    return refuse(phase, 'ATTEMPT_SNAPSHOT_INVALID', null)
  }
  if (state.connection !== connection) {
    // The attempt is SCOPED to one `Connection` object. A different one — even to the same
    // endpoint — is a different set of in-flight requests, a different commitment default
    // and a different node, and none of what Phase A proved is about it.
    return refuse(phase, 'CONNECTION_IDENTITY_MISMATCH', null)
  }
  return state
}

function capturePlanBaseline(
  plan: RedaxTeamAdminMutationFrozenPlanIdentity,
): MutationPlanBaseline {
  return {
    campaign: plan.campaign.toBase58(),
    operation: String(plan.operation),
    mutationIdentitySha256Hex: String(plan.mutationIdentitySha256Hex),
    witnessAddress: plan.witnessAddress === null ? null : String(plan.witnessAddress),
  }
}

function samePlanBaseline(left: MutationPlanBaseline, right: MutationPlanBaseline): boolean {
  return (
    left.campaign === right.campaign &&
    left.operation === right.operation &&
    left.mutationIdentitySha256Hex === right.mutationIdentitySha256Hex &&
    left.witnessAddress === right.witnessAddress
  )
}

/** Does the target this read is taken over name the Campaign the plan is about? */
function targetNamesCampaign(
  target: RedaxTeamAdminMutationGuardTarget,
  campaign: string,
): boolean {
  return target.campaign.toBase58() === campaign
}

/**
 * Classify the operation's own target account from a coherent observation.
 *
 * `true` ONLY for a positive absence. An `UNREADABLE` slot is `false` — because unreadable
 * is not absent, and admitting a plan on an unreadable target would be assuming the thing it
 * is about to create does not exist.
 */
function targetAbsentFrom(observation: {
  readonly tokenConfig: { readonly presence: string } | null
  readonly metadata: { readonly presence: string } | null
}): boolean {
  return targetPresenceFrom(observation) === 'ABSENT'
}

/**
 * The operation's OWN target-account presence, as observed — or `null` when it has none.
 *
 * Typed structurally, like `targetAbsentFrom`, so this module reads exactly the one field
 * it compares and acquires no further shape from the data module.
 */
function targetPresenceFrom(observation: {
  readonly tokenConfig: { readonly presence: string } | null
  readonly metadata: { readonly presence: string } | null
}): string | null {
  if (observation.tokenConfig !== null) {
    return observation.tokenConfig.presence
  }
  if (observation.metadata !== null) {
    return observation.metadata.presence
  }
  // A status-only operation creates nothing, so there is no target to be present or absent.
  return null
}

/** One mint slot's presence, as a primitive. `null` when the family observed no mint. */
function mintPresenceOf(
  observation: { readonly presence: string } | null | undefined,
): string | null {
  return observation === null || observation === undefined ? null : observation.presence
}

/** One mint slot's declared decimals, as a primitive, or `null` when it is not `PRESENT`. */
function mintDecimalsOf(
  observation: { readonly presence: string; readonly facts?: unknown } | null | undefined,
): number | null {
  if (observation === null || observation === undefined || observation.presence !== 'PRESENT') {
    return null
  }
  return isMintFacts(observation.facts) ? observation.facts.decimals : null
}

/**
 * The classic-SPL mint expectations an `add_token_config` attempt is preflighted against.
 *
 * The MINT ADDRESSES are deliberately absent: the legacy mint is already the target's own,
 * and the output mint is re-proven against the FRESH Campaign body rather than accepted from
 * a caller. Repeating either here would create a second place for them to disagree.
 */
export interface RedaxTeamAdminMutationAddMintPreflight {
  readonly expectedLegacyDecimals: number
  readonly expectedOutputDecimals: number
}

/** A `u8` the program could actually store. Rejects `NaN`, fractions and out-of-range. */
function isMintDecimalsValue(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 255
}

/**
 * Is the supplied preflight STRUCTURALLY the one this operation requires?
 *
 * Required for `ADD_TOKEN_CONFIG` and forbidden for every other operation, so a caller
 * cannot omit the check for the one operation that needs it, and cannot attach expectations
 * to an operation that would silently ignore them. Both mistakes are the same kind of caller
 * inconsistency the plan-identity refusal already names, so no new vocabulary is minted.
 */
function preflightShapeRefusalCode(
  operation: RedaxTeamAdminMutationGuardOperation,
  preflight: RedaxTeamAdminMutationAddMintPreflight | null,
): RedaxTeamAdminMutationGuardRefusalCode | null {
  if (operation !== 'ADD_TOKEN_CONFIG') {
    return preflight === null ? null : 'MUTATION_PLAN_IDENTITY_MISMATCH'
  }
  if (
    preflight === null ||
    !isMintDecimalsValue(preflight.expectedLegacyDecimals) ||
    !isMintDecimalsValue(preflight.expectedOutputDecimals)
  ) {
    return 'MUTATION_PLAN_IDENTITY_MISMATCH'
  }
  return null
}

/**
 * WHY IT EXISTS. The program validates both mints, but it does so INSIDE the transaction —
 * which means the wallet has already been prompted, the operator has already approved, and
 * the fee has already been spent by the time a Token-2022 legacy mint is refused. Worse, a
 * mint that is merely the WRONG one is not refused at all: the program copies whatever
 * decimals it finds into the TokenConfig, and an attempt that registers `6` where the
 * operator believed `9` produces an immutable account with silently wrong normalization.
 *
 * WHAT IT PROVES, for both mints, from the ONE coherent observation the caller already has:
 * the account exists, its owner is the classic `TOKEN_PROGRAM_ID`, its layout is the exact
 * classic Mint layout, it decodes, it is initialized — all five of which the data module has
 * already folded into `presence === 'PRESENT'` — and its ACTUAL decimals equal the ones the
 * product expected. For the output mint it additionally proves the account observed is the
 * very one the FRESH Campaign body names, so a stale or substituted output mint refuses
 * here rather than being carried into a plan.
 *
 * THE DECISION IS THE GUARD'S. It is not the panel's and not the action root's: those hold
 * product state, and a preflight decided beside the state it is checking is a preflight a
 * later caller can talk out of refusing.
 *
 * VALUE-FREE. Four narrow codes, and not one of them carries an address, a decimal, an
 * owner or a raw decode error.
 */
function mintPreflightRefusalCode(
  campaign: RedaxTeamAdminMutationCampaignPublicFacts,
  observation: {
    readonly legacyMint: { readonly presence: string; readonly facts?: unknown } | null
    readonly outputMint: { readonly presence: string; readonly facts?: unknown } | null
  },
  preflight: RedaxTeamAdminMutationAddMintPreflight,
): RedaxTeamAdminMutationGuardRefusalCode | null {
  const legacy = observation.legacyMint
  if (legacy === null || legacy.presence !== 'PRESENT') {
    // ABSENT, wrong owner, wrong length, undecodable and uninitialized all land here, and
    // all of them mean the same thing: this is not a classic SPL mint this attempt may use.
    return 'LEGACY_MINT_NOT_CLASSIC_SPL'
  }
  const legacyFacts = legacy.facts
  if (!isMintFacts(legacyFacts)) {
    return 'LEGACY_MINT_NOT_CLASSIC_SPL'
  }
  if (legacyFacts.decimals !== preflight.expectedLegacyDecimals) {
    return 'LEGACY_MINT_DECIMALS_MISMATCH'
  }

  const output = observation.outputMint
  if (output === null || output.presence !== 'PRESENT') {
    return 'OUTPUT_MINT_NOT_CLASSIC_SPL'
  }
  const outputFacts = output.facts
  if (!isMintFacts(outputFacts)) {
    return 'OUTPUT_MINT_NOT_CLASSIC_SPL'
  }
  // THE OUTPUT MINT MUST BE THE CAMPAIGN'S OWN. The address was named by the caller so the
  // coherent read could include it; the Campaign account is what makes it authoritative.
  if (outputFacts.address !== campaign.outputMint) {
    return 'OUTPUT_MINT_NOT_CLASSIC_SPL'
  }
  if (outputFacts.decimals !== preflight.expectedOutputDecimals) {
    return 'OUTPUT_MINT_DECIMALS_MISMATCH'
  }
  return null
}

/**
 * The two mint fields this module reads, narrowed structurally.
 *
 * Typed here rather than imported, exactly like `targetAbsentFrom` and `targetPresenceFrom`:
 * this module compares two primitives and acquires no further shape from the data module.
 */
function isMintFacts(value: unknown): value is { readonly address: string; readonly decimals: number } {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const candidate = value as { address?: unknown; decimals?: unknown }
  return typeof candidate.address === 'string' && isMintDecimalsValue(candidate.decimals)
}

/**
 * PRIVATE, AND DELIBERATELY NOT PART OF `RedaxTeamAdminMutationGuardRefusalCode`. These
 * two names exist so the branch that refuses says WHICH of the two questions it answered
 * — "the window is closed" and "the chain's own time could not be established" are
 * different facts, and a single code would have collapsed them. What travels OUTWARD is
 * the existing `PRE_STATE_NOT_ADMISSIBLE`, and the action root narrows even that to
 * `CHAIN_GUARD_REFUSED`: an activation-specific PUBLIC code would tell a caller which
 * chain fact refused it, which is a value leak dressed as diagnostics.
 *
 * Both are VALUE-FREE regardless: no address, no timestamp, no deadline, no endpoint and
 * no raw RPC error can travel in a name.
 */
type MutationActivationTimeRefusalCode = 'ACTIVATION_WINDOW_CLOSED' | 'CHAIN_TIME_UNAVAILABLE'

/** The ONE clock field this module compares, narrowed structurally. */
function isClockFacts(value: unknown): value is { readonly unixTimestamp: bigint } {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { unixTimestamp?: unknown }).unixTimestamp === 'bigint'
  )
}

/**
 * A Campaign's stored `end_ts` as a `bigint`, or `null` when it is not one.
 *
 * TOTAL. `BigInt()` throws on anything it cannot read and a throw here would be this
 * module's only one, so it is caught and answered as `null` — which the caller treats as a
 * REFUSAL rather than as "no deadline". An absent deadline is `endTs === null` on the
 * account itself and is decided before this is ever called.
 */
function endTsOrNull(value: string): bigint | null {
  try {
    return BigInt(value)
  } catch {
    return null
  }
}

/**
 * IT IS A CURRENT PREDICATE, NOT A FROZEN FOOTPRINT. It is re-decided from scratch at
 * Phase A, at Phase B and again after the wallet, against the Clock observed in THAT
 * call's own coherent response — so a deadline crossed while an operator was reading a
 * wallet prompt refuses before the raw send rather than being compared against a value
 * somebody remembered. Nothing here is stored, and no phase compares one phase's chain
 * time to another's: two different current times are not a drift.
 *
 * THE CLOCK MUST BE PRESENT, EVEN WHEN THERE IS NO DEADLINE. An `ACTIVATE_CAMPAIGN`
 * attempt selected the family that reads the canonical Clock; an absent, wrong-owner,
 * executable, short or undecodable Clock therefore means this attempt did not get the
 * coherent observation it was admitted on the basis of, and it fails CLOSED — a campaign
 * with `end_ts === null` is not a licence to proceed without one.
 *
 * EQUALITY IS REFUSED. The program admits activation strictly BEFORE `end_ts`, so `now ==
 * end_ts` is closed and `<=` would be the exact off-by-one that signs a transaction the
 * program rejects. There is no safety margin, no local-clock fallback, no sleep, no timer
 * and no scheduled re-check: this returns an answer about the moment it was called and
 * makes no claim about the moment the transaction executes.
 */
function activationTimeRefusalCode(
  campaign: RedaxTeamAdminMutationCampaignPublicFacts,
  observation: {
    readonly clock?: { readonly presence: string; readonly facts?: unknown } | null
  },
): MutationActivationTimeRefusalCode | null {
  const clock = observation.clock
  if (clock === null || clock === undefined || clock.presence !== 'PRESENT') {
    return 'CHAIN_TIME_UNAVAILABLE'
  }
  const facts = clock.facts
  if (!isClockFacts(facts)) {
    return 'CHAIN_TIME_UNAVAILABLE'
  }
  const endTs = campaign.endTs
  if (endTs === null) {
    // No deadline exists on this Campaign, so the time DIMENSION passes — and it passes
    // only because a valid coherent Clock was proven above.
    return null
  }
  const deadline = endTsOrNull(endTs)
  if (deadline === null) {
    // The strict reader produces a canonical decimal string; reaching here means the two
    // disagree, and an unparseable deadline is refused rather than ignored.
    return 'CHAIN_TIME_UNAVAILABLE'
  }
  return facts.unixTimestamp < deadline ? null : 'ACTIVATION_WINDOW_CLOSED'
}

/**
 * The admission footprint ONE coherent observation carries, FOR ONE OPERATION.
 *
 * Copied as primitives, never referenced: a caller object kept by reference is an alias, and
 * a comparison against an alias is a comparison against itself. The `switch` is exhaustive
 * with one arm per member of the closed six, so a seventh operation is a COMPILE failure
 * rather than a footprint that silently records nothing.
 */
function admissionFootprintOf(
  operation: RedaxTeamAdminMutationGuardOperation,
  campaign: RedaxTeamAdminMutationCampaignPublicFacts,
  observation: {
    readonly tokenConfig: { readonly presence: string } | null
    readonly metadata: { readonly presence: string } | null
    readonly legacyMint?: { readonly presence: string; readonly facts?: unknown } | null
    readonly outputMint?: { readonly presence: string; readonly facts?: unknown } | null
  },
): MutationAdmissionFootprint {
  const campaignStatus = String(campaign.status)
  switch (operation) {
    case 'ADD_TOKEN_CONFIG':
      return Object.freeze({
        operation,
        campaignStatus,
        tokenConfigCount: campaign.tokenConfigCount,
        targetPresence: targetPresenceFrom(observation),
        legacyMintPresence: mintPresenceOf(observation.legacyMint),
        legacyMintDecimals: mintDecimalsOf(observation.legacyMint),
        outputMintPresence: mintPresenceOf(observation.outputMint),
        outputMintDecimals: mintDecimalsOf(observation.outputMint),
      })
    case 'SETUP_METADATA':
      return Object.freeze({
        operation,
        campaignStatus,
        metadataSetup: campaign.metadataSetup === true,
        targetPresence: targetPresenceFrom(observation),
      })
    case 'ACTIVATE_CAMPAIGN':
      return Object.freeze({
        operation,
        campaignStatus,
        metadataSetup: campaign.metadataSetup === true,
      })
    case 'PAUSE_CAMPAIGN':
      return Object.freeze({ operation, campaignStatus })
    case 'UNPAUSE_CAMPAIGN':
      return Object.freeze({ operation, campaignStatus })
    case 'FINALIZE_CAMPAIGN':
      return Object.freeze({ operation, campaignStatus })
  }
}

/**
 * Equality of TWO footprints for THE SAME operation, over that operation's own fields only.
 *
 * The operation is compared first and is the discriminant, so each arm compares exactly the
 * facts its own admission consumed and CANNOT reach a field the other arms carry — an
 * unrelated concurrent mutation is therefore not a refusal of this attempt, and a fact this
 * operation DID consume still is. Both sides are re-narrowed independently, because
 * narrowing `left` tells the compiler nothing about `right`.
 */
function sameAdmissionFootprint(
  left: MutationAdmissionFootprint,
  right: MutationAdmissionFootprint,
): boolean {
  if (left.operation !== right.operation) {
    return false
  }
  switch (left.operation) {
    case 'ADD_TOKEN_CONFIG':
      return (
        right.operation === 'ADD_TOKEN_CONFIG' &&
        left.campaignStatus === right.campaignStatus &&
        left.tokenConfigCount === right.tokenConfigCount &&
        left.targetPresence === right.targetPresence &&
        left.legacyMintPresence === right.legacyMintPresence &&
        left.legacyMintDecimals === right.legacyMintDecimals &&
        left.outputMintPresence === right.outputMintPresence &&
        left.outputMintDecimals === right.outputMintDecimals
      )
    case 'SETUP_METADATA':
      return (
        right.operation === 'SETUP_METADATA' &&
        left.campaignStatus === right.campaignStatus &&
        left.metadataSetup === right.metadataSetup &&
        left.targetPresence === right.targetPresence
      )
    case 'ACTIVATE_CAMPAIGN':
      return (
        right.operation === 'ACTIVATE_CAMPAIGN' &&
        left.campaignStatus === right.campaignStatus &&
        left.metadataSetup === right.metadataSetup
      )
    case 'PAUSE_CAMPAIGN':
      return right.operation === 'PAUSE_CAMPAIGN' && left.campaignStatus === right.campaignStatus
    case 'UNPAUSE_CAMPAIGN':
      return right.operation === 'UNPAUSE_CAMPAIGN' && left.campaignStatus === right.campaignStatus
    case 'FINALIZE_CAMPAIGN':
      // EQUALITY, never membership. See the type above: both admissible predecessors are
      // real, and the one Phase A observed is the one the identity was built from.
      return right.operation === 'FINALIZE_CAMPAIGN' && left.campaignStatus === right.campaignStatus
    default: {
      // A seventh operation fails to COMPILE here rather than comparing nothing at all.
      const exhaustive: never = left
      void exhaustive
      return false
    }
  }
}

// --- Phase A -----------------------------------------------------------------------

/**
 * Run BEFORE any plan, instruction or `Transaction` exists.
 *
 * On success it freezes an attempt baseline and returns an opaque snapshot plus the FRESH
 * Campaign facts the plan must be admitted against. It has authorized nothing: the snapshot
 * is a handle, not a permit.
 *
 * TWO FLOOR-GATED READS, AND THEY ARE NOT CLAIMED TO BE ONE. The first is the authority
 * read — program, ProgramData, ProtocolConfig — and the second is the Campaign pre-state,
 * taken at a floor no lower than the first. They are two observations at two contexts and
 * are reported as such; nothing here describes them as sharing a slot, because they do not.
 * What each of them individually gates is exactly what it individually proves.
 */
export async function checkRedaxTeamAdminMutationGuardPhaseA(input: {
  readonly connection: Connection
  readonly runtime: RedaxTeamAdminMutationGuardRuntime
  /** The wallet the broker reports as connected, right now. */
  readonly connectedWallet: PublicKey | null
  /** The trusted approved-Team identity, injected at the private action-root boundary. */
  readonly approvedTeamWallet: PublicKey | null
  /**
   * WHICH OF THE CLOSED SIX this attempt is. Frozen here and reasserted at both later
   * phases, because it — not the read family — selects which mutable facts are compared.
   */
  readonly operation: string
  /** Which accounts this operation's pre-state is observed over. */
  readonly target: RedaxTeamAdminMutationGuardTarget
  readonly mintPreflight: RedaxTeamAdminMutationAddMintPreflight | null
}): Promise<RedaxTeamAdminMutationGuardPhaseAResult> {
  const { connection, runtime, connectedWallet, approvedTeamWallet, target } = input
  const mintPreflight = input.mintPreflight ?? null

  const runtimeRefusal = checkRuntime('A', connection, runtime)
  if (runtimeRefusal !== null) {
    return runtimeRefusal
  }

  // THE OPERATION, RESOLVED AND MADE CONSISTENT WITH THE READ — before any network call,
  // because neither half of it is a question about the chain. An operation outside the
  // closed six, or one whose required read family is not the family the caller is actually
  // reading over, is a caller choosing which of its own preconditions get re-checked. No
  // new refusal vocabulary is minted for it: this is exactly the plan-identity
  // inconsistency the later phases already refuse under, observed one phase earlier.
  const operation = resolveGuardOperation(input.operation)
  if (operation === null || OPERATION_READ_FAMILY[operation] !== target.family) {
    return refuse('A', 'MUTATION_PLAN_IDENTITY_MISMATCH', null)
  }
  // THE PREFLIGHT'S SHAPE, decided here for the same reason the operation is: neither half
  // is a question about the chain, and a structurally wrong preflight must not reach a read.
  const preflightShapeRefusal = preflightShapeRefusalCode(operation, mintPreflight)
  if (preflightShapeRefusal !== null) {
    return refuse('A', preflightShapeRefusal, null)
  }

  const genesisRefusal = await checkGenesis('A', connection)
  if (genesisRefusal !== null) {
    return genesisRefusal
  }

  const read = await readRedaxTeamAdminGuardAccountsWithContext(connection, runtime.programId, {
    commitment: REDAX_MUTATION_GUARD_COMMITMENT,
  })
  if (!read.ok) {
    return refuse('A', fromReadFailure(read.code), read.contextSlot)
  }

  // The loader-owner equalities live here, not in the data module: the expected identity is
  // a wallet-layer constant and the data module must not import it. BOTH accounts are
  // checked — a ProgramData account owned by something else is not the upgrade record of
  // this program, whatever authority it happens to carry.
  if (!isRedaxExpectedUpgradeableLoaderOwner(read.program.owner)) {
    return refuse('A', 'PROGRAM_OWNER_MISMATCH', read.contextSlot)
  }
  if (!isRedaxExpectedUpgradeableLoaderOwner(read.program.programDataOwner)) {
    return refuse('A', 'PROGRAM_DATA_OWNER_MISMATCH', read.contextSlot)
  }

  // POSITIVE Team identity, first. A wallet that is merely "none of the authorities" is not
  // the approved Team wallet, and an absent trusted identity is not permission to proceed
  // with whatever is connected.
  if (approvedTeamWallet === null) {
    return refuse('A', 'TEAM_IDENTITY_ABSENT', read.contextSlot)
  }
  if (connectedWallet === null) {
    return refuse('A', 'TEAM_IDENTITY_MISMATCH', read.contextSlot)
  }
  const approved = approvedTeamWallet.toBase58()
  if (connectedWallet.toBase58() !== approved) {
    return refuse('A', 'TEAM_IDENTITY_MISMATCH', read.contextSlot)
  }

  const feeAuthority = read.protocolConfig.data.protocolFeeAuthority
  const pauseAuthority = read.protocolConfig.data.protocolEmergencyPauseAuthority
  if (
    isCustodyAuthority(connectedWallet, feeAuthority, pauseAuthority, read.program.upgradeAuthority)
  ) {
    return refuse('A', 'TEAM_WALLET_IS_CUSTODY_AUTHORITY', read.contextSlot)
  }

  // THE CAMPAIGN PRE-STATE, at a floor no lower than the authority read.
  const preState = await readRedaxTeamAdminMutationCoherentStateWithContext(
    connection,
    runtime.programId,
    target,
    { commitment: REDAX_MUTATION_GUARD_COMMITMENT, minContextSlot: read.contextSlot },
  )
  if (!preState.ok) {
    return refuse(
      'A',
      preState.code === 'MIN_CONTEXT_UNAVAILABLE' ? 'MIN_CONTEXT_UNAVAILABLE' : 'RPC_READ_UNAVAILABLE',
      preState.contextSlot,
    )
  }
  if (preState.contextSlot < read.contextSlot) {
    // The request option protects request EVALUATION; this rejects a stale ANSWER.
    return refuse('A', 'MIN_CONTEXT_UNAVAILABLE', preState.contextSlot)
  }
  if (preState.observation.campaign.presence === 'UNREADABLE') {
    return refuse('A', 'CAMPAIGN_UNREADABLE', preState.contextSlot)
  }
  if (preState.observation.campaign.presence === 'ABSENT') {
    // A post-init mutation cannot create the Campaign it mutates.
    return refuse('A', 'CAMPAIGN_ABSENT', preState.contextSlot)
  }
  const campaign = preState.observation.campaign.facts
  if (!campaign.pdaSelfConsistent) {
    return refuse('A', 'CAMPAIGN_PDA_NOT_SELF_CONSISTENT', preState.contextSlot)
  }
  // THE ADMIN EQUALITY. A plan whose signer is not the account's own admin is one the
  // program would reject, and building it would mean a wallet prompt for a transaction that
  // cannot succeed.
  if (campaign.campaignAdmin !== approved) {
    return refuse('A', 'CAMPAIGN_ADMIN_MISMATCH', preState.contextSlot)
  }
  // THE OUTPUT MINT THE CALLER NAMED MUST BE THE ONE THE CAMPAIGN NAMES.
  //
  // `SETUP_METADATA` addresses a metadata PDA DERIVED FROM the output mint, and the caller
  // supplies that mint from already-loaded product data. Loaded data is a starting point,
  // never authority: it is re-proven here against the account read in THIS snapshot, so a
  // stale or substituted mint refuses before a plan exists rather than being carried into a
  // metadata PDA nobody re-derived.
  //
  // `ADD_TOKEN_CONFIG` needs no equivalent check HERE — its TokenConfig PDA is derived from
  // the campaign and the legacy mint, and its own output-mint equality is enforced where the
  // plan is assembled, against this same fresh Campaign body.
  if (target.family === 'SETUP_METADATA' && target.outputMint.toBase58() !== campaign.outputMint) {
    return refuse('A', 'CAMPAIGN_IDENTITY_DRIFT', preState.contextSlot)
  }

  // It runs against the SAME coherent observation the admission above rests on, so the mint
  // facts and the account facts are one reading at one context rather than two readings that
  // happen to have been taken nearby.
  if (operation === 'ADD_TOKEN_CONFIG' && mintPreflight !== null) {
    const mintRefusal = mintPreflightRefusalCode(campaign, preState.observation, mintPreflight)
    if (mintRefusal !== null) {
      return refuse('A', mintRefusal, preState.contextSlot)
    }
  }

  // It runs against the SAME coherent observation the admission above rests on: the
  // Campaign and the Clock came back at ONE context slot, so "this campaign's window was
  // still open" is a statement about one moment rather than two readings taken nearby.
  //
  // The private code is CLASSIFIED and then DISCARDED. Both members map to the existing
  // `PRE_STATE_NOT_ADMISSIBLE`, because a public code naming which chain fact refused would
  // be exactly the value leak this guard's vocabulary exists to prevent.
  if (operation === 'ACTIVATE_CAMPAIGN') {
    const timeRefusal = activationTimeRefusalCode(campaign, preState.observation)
    if (timeRefusal !== null) {
      return refuse('A', 'PRE_STATE_NOT_ADMISSIBLE', preState.contextSlot)
    }
  }

  const snapshot: RedaxTeamAdminMutationGuardAttemptSnapshot = Object.freeze({
    phaseAContextSlot: read.contextSlot,
  })
  ATTEMPTS.set(
    snapshot,
    Object.freeze({
      connection,
      programId: runtime.programId.toBase58(),
      programDataAddress: read.program.programDataAddress.toBase58(),
      upgradeAuthority:
        read.program.upgradeAuthority === null ? null : read.program.upgradeAuthority.toBase58(),
      protocolFeeAuthority: feeAuthority.toBase58(),
      protocolEmergencyPauseAuthority: pauseAuthority.toBase58(),
      protocolConfigBump: read.protocolConfig.data.bump,
      approvedTeamWallet: approved,
      campaign: target.campaign.toBase58(),
      campaignAdmin: campaign.campaignAdmin,
      campaignOutputMint: campaign.outputMint,
      campaignSaltHex: campaign.saltHex,
      targetFamily: target.family,
      operation,
      // FROZEN, and compared at both later phases. §29: the four ADD preflight facts are
      // bound HERE and cannot be caller-swapped afterwards.
      mintPreflight:
        mintPreflight === null
          ? null
          : Object.freeze({
              expectedLegacyDecimals: mintPreflight.expectedLegacyDecimals,
              expectedOutputDecimals: mintPreflight.expectedOutputDecimals,
            }),
      legacyMint: target.family === 'ADD_TOKEN_CONFIG' ? target.legacyMint.toBase58() : null,
      outputMint: target.family === 'ADD_TOKEN_CONFIG' ? target.outputMint.toBase58() : null,
      // THE ADMISSION FOOTPRINT, FROZEN — and built FOR THIS OPERATION, so it records only
      // the mutable facts this operation's own admission consumed. Copied out of the fresh
      // observation as primitives, for the same reason every other baseline field is: a
      // caller object kept by reference is an alias, and a comparison against an alias is a
      // comparison against itself.
      admission: admissionFootprintOf(operation, campaign, preState.observation),
      phaseAContextSlot: read.contextSlot,
      preStateContextSlot: preState.contextSlot,
    }),
  )

  return {
    ok: true,
    phase: 'A',
    snapshot,
    contextSlot: read.contextSlot,
    preStateContextSlot: preState.contextSlot,
    campaign,
    targetAccountAbsent: targetAbsentFrom(preState.observation),
  }
}

// --- The C2 SOL-preflight context floor -----------------------------------------------

/**
 * BIND the mutation attempt's operation-specific SOL observation as a guard floor.
 *
 * THE ROOT OBSERVES; THIS MODULE OWNS THE FLOOR — the same division the S1 corridor makes,
 * implemented separately here because the two corridors share no guard state. The mutation
 * root reads the approved payer's contextual balance on the attempt's own `Connection`
 * after Phase A and before any plan exists, and handing the slot here means this attempt
 * has exactly ONE floor authority: the module that already owns its Phase-A, pre-state,
 * blockhash, Phase-B and send floors.
 *
 * THE MINIMUM PRE-BIND FLOOR IS `max(phaseAContextSlot, preStateContextSlot)`, not Phase A
 * alone. Phase A's pre-state read is a SEPARATE, LATER context this attempt already
 * accepted and already admitted its plan against, so accepting a balance older than it
 * would let the SOL verdict vouch for a chain the attempt has demonstrably moved past.
 *
 * WHAT THIS DOES NOT DO, structurally: it constructs no `Connection`, performs no RPC,
 * reads no wallet, reads no environment, reads and writes no journal, builds no
 * transaction, signs nothing and sends nothing.
 *
 * THE RESULT IS A BARE BOOLEAN, so no floor, slot or existing baseline leaves this module.
 * A refusal is FAIL-CLOSED at the root: the attempt is abandoned, never continued with an
 * unbound observation. It is refused when the snapshot is foreign, when the `Connection` is
 * not the exact object Phase A registered, when the slot is not a non-negative safe
 * integer, when the slot is below that minimum floor, and when a floor is ALREADY bound —
 * single assignment, so a second bind is refused whether it is higher, equal or lower.
 */
export function bindRedaxTeamAdminMutationSolPreflightContextFloor(input: {
  readonly snapshot: RedaxTeamAdminMutationGuardAttemptSnapshot
  readonly connection: Connection
  readonly balanceContextSlot: number
}): boolean {
  const { snapshot, connection, balanceContextSlot } = input
  const state = ATTEMPTS.get(snapshot)
  if (state === undefined) {
    return false
  }
  if (state.connection !== connection) {
    return false
  }
  if (!Number.isSafeInteger(balanceContextSlot) || balanceContextSlot < 0) {
    return false
  }
  if (balanceContextSlot < Math.max(state.phaseAContextSlot, state.preStateContextSlot)) {
    return false
  }
  if (SOL_PREFLIGHT_FLOORS.has(snapshot)) {
    return false
  }
  SOL_PREFLIGHT_FLOORS.set(snapshot, balanceContextSlot)
  return true
}

/**
 * The attempt's bound SOL floor, or `0` when none is bound. PRIVATE — never exported.
 *
 * `0` is the correct neutral: it is the identity of `Math.max` over non-negative slots, so
 * an attempt that never bound one is measured exactly as it was before this floor existed.
 */
function solPreflightFloorOf(snapshot: RedaxTeamAdminMutationGuardAttemptSnapshot): number {
  return SOL_PREFLIGHT_FLOORS.get(snapshot) ?? 0
}

// --- Blockhash ---------------------------------------------------------------------

/**
 * Obtain the attempt's blockhash at a context NO OLDER than Phase A's pre-state read.
 *
 * Both protections are applied, because they defend different things: `minContextSlot` makes
 * a lagging node refuse to answer, and the local floor check makes a lagging ANSWER refuse
 * to be used.
 */
export async function fetchRedaxTeamAdminMutationAttemptBlockhash(input: {
  readonly connection: Connection
  readonly snapshot: RedaxTeamAdminMutationGuardAttemptSnapshot
}): Promise<RedaxTeamAdminMutationAttemptBlockhashResult> {
  const { connection, snapshot } = input

  const state = resolveAttempt('BLOCKHASH', snapshot, connection)
  if (isRefusal(state)) {
    return state
  }

  // Phase A, its pre-state read AND the bound C2 SOL observation — three contexts this
  // attempt has already accepted, so a blockhash older than any of them is refused.
  const floor = Math.max(
    state.phaseAContextSlot,
    state.preStateContextSlot,
    solPreflightFloorOf(snapshot),
  )
  try {
    const response = await connection.getLatestBlockhashAndContext({
      commitment: REDAX_MUTATION_GUARD_COMMITMENT,
      minContextSlot: floor,
    })
    if (response.context.slot < floor) {
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

// --- Phase B and the post-wallet reassertion ------------------------------------------

/**
 * What a SUCCESSFUL reassertion observed — the private hand-off between the shared
 * implementation and the two phase-specific entry points.
 *
 * It is not a result and never leaves this module. It carries the two contexts this call
 * itself read and gated, and no verdict, no phase and no floor: the floor is arithmetic only
 * the post-wallet entry point is allowed to do, and putting it here would offer it to Phase
 * B as well.
 */
type ReassertionObservations = Readonly<{
  readonly ok: true
  readonly accountsContextSlot: number
  readonly blockhashValidityContextSlot: number
}>

/**
 * Re-read and re-decide every mutable fact, at one named phase.
 *
 * ONE implementation serves both reassertions on purpose. They ask exactly the same
 * questions — the difference is only WHEN, and what a failure means: before the wallet
 * request nothing has been signed, and after it a verified artifact exists and is about to be
 * discarded without any broadcast. Two copies of this logic would be two things to keep in
 * step, and the first time they drifted one of the two moments would be checked less than
 * the other.
 *
 * Phase A's success is never consulted. What Phase A left behind is a BASELINE — the exact
 * authorities, the exact ProgramData relation, the exact approved Team wallet, the exact
 * Campaign identity — and everything below is measured against it from a fresh read.
 */
async function reassert(
  phase: 'B' | 'POST_WALLET',
  input: {
    readonly connection: Connection
    readonly snapshot: RedaxTeamAdminMutationGuardAttemptSnapshot
    readonly runtime: RedaxTeamAdminMutationGuardRuntime
    readonly connectedWallet: PublicKey | null
    readonly plan: RedaxTeamAdminMutationFrozenPlanIdentity
    readonly target: RedaxTeamAdminMutationGuardTarget
    readonly blockhash: string
    readonly blockhashContextSlot: number
    readonly mintPreflight: RedaxTeamAdminMutationAddMintPreflight | null
  },
): Promise<ReassertionObservations | RedaxTeamAdminMutationGuardRefusal> {
  const { connection, snapshot, runtime, connectedWallet, plan, target, blockhash } = input

  const state = resolveAttempt(phase, snapshot, connection)
  if (isRefusal(state)) {
    return state
  }

  const runtimeRefusal = checkRuntime(phase, connection, runtime)
  if (runtimeRefusal !== null) {
    return runtimeRefusal
  }

  const genesisRefusal = await checkGenesis(phase, connection)
  if (genesisRefusal !== null) {
    return genesisRefusal
  }

  const witness = PHASE_B_WITNESSES.get(snapshot)

  // A post-wallet reassertion is only ever ABOUT a successful Phase B. Without one there is
  // no moment at which this guard approved anything for the wallet to have signed, and the
  // artifact must be about the exact blockhash — and the exact blockhash observation — that
  // Phase B validated. Both are checked here, before a single read is issued, because a
  // continuity that is already broken cannot be repaired by fresher data.
  if (phase === 'POST_WALLET') {
    if (
      witness === undefined ||
      witness.blockhash !== blockhash ||
      witness.blockhashContextSlot !== input.blockhashContextSlot
    ) {
      return refuse(phase, 'PHASE_B_CONTINUITY_MISMATCH', null)
    }
  }

  // The bound C2 SOL slot joins Phase A, the pre-state read and the blockhash as a FOURTH
  // accepted context, so both reassertions — and therefore the send floor built from the
  // post-wallet one — cannot accept an observation older than the balance read that
  // authorized this attempt. An attempt that bound no floor reads `0` and is measured
  // exactly as it was before this floor existed.
  const baseFloor = Math.max(
    state.phaseAContextSlot,
    state.preStateContextSlot,
    input.blockhashContextSlot,
    solPreflightFloorOf(snapshot),
  )
  const accountsFloor =
    witness === undefined ? baseFloor : Math.max(baseFloor, witness.accountsContextFloor)
  const blockhashValidityFloor =
    witness === undefined ? baseFloor : Math.max(baseFloor, witness.blockhashValidityContextFloor)

  const read = await readRedaxTeamAdminGuardAccountsWithContext(connection, runtime.programId, {
    commitment: REDAX_MUTATION_GUARD_COMMITMENT,
    minContextSlot: accountsFloor,
  })
  if (!read.ok) {
    return refuse(phase, fromReadFailure(read.code), read.contextSlot)
  }
  if (read.contextSlot < accountsFloor) {
    return refuse(phase, 'MIN_CONTEXT_UNAVAILABLE', read.contextSlot)
  }

  if (!isRedaxExpectedUpgradeableLoaderOwner(read.program.owner)) {
    return refuse(phase, 'PROGRAM_OWNER_MISMATCH', read.contextSlot)
  }
  if (!isRedaxExpectedUpgradeableLoaderOwner(read.program.programDataOwner)) {
    return refuse(phase, 'PROGRAM_DATA_OWNER_MISMATCH', read.contextSlot)
  }
  if (runtime.programId.toBase58() !== state.programId) {
    return refuse(phase, 'PROGRAM_STATE_INVALID', read.contextSlot)
  }
  if (read.program.programDataAddress.toBase58() !== state.programDataAddress) {
    return refuse(phase, 'PROGRAM_DATA_RELATION_DRIFT', read.contextSlot)
  }

  // The upgrade authority was valid in Phase A and is valid now — but is it the SAME one? An
  // authority that changed between the phases means the program can be replaced by a key
  // this attempt never checked itself against. `null` participates on both sides: becoming
  // immutable, or ceasing to be, are both changes.
  const freshUpgradeAuthority =
    read.program.upgradeAuthority === null ? null : read.program.upgradeAuthority.toBase58()
  if (freshUpgradeAuthority !== state.upgradeAuthority) {
    return refuse(phase, 'UPGRADE_AUTHORITY_CHANGED', read.contextSlot)
  }

  const fresh = read.protocolConfig.data
  if (
    fresh.protocolFeeAuthority.toBase58() !== state.protocolFeeAuthority ||
    fresh.protocolEmergencyPauseAuthority.toBase58() !== state.protocolEmergencyPauseAuthority ||
    fresh.bump !== state.protocolConfigBump
  ) {
    return refuse(phase, 'PROTOCOL_CONFIG_CHANGED', read.contextSlot)
  }

  // The live wallet is still exactly the approved Team wallet Phase A froze.
  if (connectedWallet === null || connectedWallet.toBase58() !== state.approvedTeamWallet) {
    return refuse(phase, 'TEAM_IDENTITY_MISMATCH', read.contextSlot)
  }
  // And it is still none of the present custody authorities.
  if (
    isCustodyAuthority(
      connectedWallet,
      fresh.protocolFeeAuthority,
      fresh.protocolEmergencyPauseAuthority,
      read.program.upgradeAuthority,
    )
  ) {
    return refuse(phase, 'TEAM_WALLET_IS_CUSTODY_AUTHORITY', read.contextSlot)
  }

  // THE PLAN. Its Campaign must be the attempt's Campaign, and the read it is validated
  // against must be taken over that same Campaign — a plan validated against a read of a
  // DIFFERENT account would be validated against nothing.
  if (plan.campaign.toBase58() !== state.campaign || !targetNamesCampaign(target, state.campaign)) {
    return refuse(phase, 'MUTATION_PLAN_IDENTITY_MISMATCH', read.contextSlot)
  }
  // AND IT MUST BE THE SAME OPERATION, READ OVER THE SAME ACCOUNTS PHASE A OBSERVED.
  //
  // Three separate equalities, and each closes a different door. The plan's operation must
  // be EXACTLY the one Phase A froze — the four lifecycle operations share one read family,
  // so without this an attempt opened as `PAUSE_CAMPAIGN` could be reasserted as
  // `FINALIZE_CAMPAIGN` and compared against a footprint built for the wrong admission. The
  // read family must be the one Phase A observed, because a reassertion over a different
  // family re-reads different accounts. And the operation's required family must still be
  // that family, so the two can never be made to disagree.
  const planOperation = resolveGuardOperation(plan.operation)
  if (
    planOperation === null ||
    planOperation !== state.operation ||
    target.family !== state.targetFamily ||
    OPERATION_READ_FAMILY[planOperation] !== state.targetFamily
  ) {
    return refuse(phase, 'MUTATION_PLAN_IDENTITY_MISMATCH', read.contextSlot)
  }
  // Not merely a valid one — the SAME one. Mint owner, layout and decimals are structurally
  // immutable once a mint is initialized, and it would be tempting to conclude that a later
  // phase therefore need not re-check anything. That conclusion is about the CHAIN; this
  // equality is about the CALLER. Nothing stops a caller from arriving at Phase B with a
  // different expectation than the one Phase A refused against, and a phase that accepted it
  // would let an attempt be re-admitted under expectations the earlier phase never saw.
  //
  // Both mint ADDRESSES are compared for the same reason: the target's own legacy mint and
  // the output mint the coherent read observes are bound at Phase A, and a later phase that
  // read a different pair would be reasserting a different attempt.
  const currentPreflight = input.mintPreflight ?? null
  const frozenPreflight = state.mintPreflight
  if (
    (frozenPreflight === null) !== (currentPreflight === null) ||
    (frozenPreflight !== null &&
      currentPreflight !== null &&
      (frozenPreflight.expectedLegacyDecimals !== currentPreflight.expectedLegacyDecimals ||
        frozenPreflight.expectedOutputDecimals !== currentPreflight.expectedOutputDecimals))
  ) {
    return refuse(phase, 'MUTATION_PLAN_IDENTITY_MISMATCH', read.contextSlot)
  }
  const currentLegacyMint =
    target.family === 'ADD_TOKEN_CONFIG' ? target.legacyMint.toBase58() : null
  const currentOutputMint =
    target.family === 'ADD_TOKEN_CONFIG' ? target.outputMint.toBase58() : null
  if (currentLegacyMint !== state.legacyMint || currentOutputMint !== state.outputMint) {
    return refuse(phase, 'MUTATION_PLAN_IDENTITY_MISMATCH', read.contextSlot)
  }

  const currentPlan = capturePlanBaseline(plan)
  const baseline = PLAN_BASELINES.get(snapshot)
  if (baseline === undefined) {
    if (phase !== 'B') {
      // A post-wallet reassertion with no Phase-B baseline means the wallet was asked about
      // a plan this guard never approved.
      return refuse(phase, 'MUTATION_PLAN_IDENTITY_MISMATCH', read.contextSlot)
    }
    PLAN_BASELINES.set(snapshot, currentPlan)
  } else if (!samePlanBaseline(baseline, currentPlan)) {
    return refuse(phase, 'MUTATION_PLAN_IDENTITY_MISMATCH', read.contextSlot)
  }

  // THE CAMPAIGN, RE-READ. Its admin, its output mint and its own seeds must not have moved
  // under the attempt, and a mutation whose Campaign changed identity mid-attempt is one
  // whose plan describes an account that no longer exists in that form.
  const campaignRead = await readRedaxTeamAdminMutationCoherentStateWithContext(
    connection,
    runtime.programId,
    target,
    { commitment: REDAX_MUTATION_GUARD_COMMITMENT, minContextSlot: read.contextSlot },
  )
  if (!campaignRead.ok || campaignRead.contextSlot < read.contextSlot) {
    return refuse(
      phase,
      campaignRead.ok ? 'MIN_CONTEXT_UNAVAILABLE' : 'RPC_READ_UNAVAILABLE',
      campaignRead.ok ? campaignRead.contextSlot : campaignRead.contextSlot,
    )
  }
  if (campaignRead.observation.campaign.presence === 'UNREADABLE') {
    return refuse(phase, 'CAMPAIGN_UNREADABLE', campaignRead.contextSlot)
  }
  if (campaignRead.observation.campaign.presence === 'ABSENT') {
    return refuse(phase, 'CAMPAIGN_ABSENT', campaignRead.contextSlot)
  }
  const currentCampaign = campaignRead.observation.campaign.facts
  if (!currentCampaign.pdaSelfConsistent) {
    return refuse(phase, 'CAMPAIGN_PDA_NOT_SELF_CONSISTENT', campaignRead.contextSlot)
  }
  if (currentCampaign.campaignAdmin !== state.approvedTeamWallet) {
    return refuse(phase, 'CAMPAIGN_ADMIN_MISMATCH', campaignRead.contextSlot)
  }
  if (
    currentCampaign.campaignAdmin !== state.campaignAdmin ||
    currentCampaign.outputMint !== state.campaignOutputMint ||
    currentCampaign.saltHex !== state.campaignSaltHex
  ) {
    return refuse(phase, 'CAMPAIGN_IDENTITY_DRIFT', campaignRead.contextSlot)
  }

  // THE FROZEN ADMISSION FOOTPRINT, REASSERTED — the whole reason this re-read is not
  // merely an identity check.
  //
  // Identity says the account is still the same account. It says NOTHING about whether the
  // MUTABLE facts THIS OPERATION was admitted against are still true. Between Phase A and
  // here the fact its own admission consumed may have moved under a different signer
  // entirely, which makes the assembled plan one this guard already knows will fail.
  //
  // AND IT IS DELIBERATELY OPERATION-SPECIFIC. The footprint is rebuilt under
  // `state.operation` — the one Phase A froze and the one just proven equal to the plan's —
  // so exactly the facts that operation consumed are compared and no others. A `PAUSE`
  // attempt is NOT refused because somebody set metadata concurrently, and an
  // `ADD_TOKEN_CONFIG` attempt is NOT refused because metadata appeared: neither fact
  // participated in admitting it, and refusing on one would be inventing a rejection rather
  // than enforcing a precondition. What each operation DID consume still refuses here.
  //
  // AT PHASE B this refusal precedes the wallet request, so no prompt is raised. AT
  // POST_WALLET it precedes the pre-raw-send marker and the one raw send, so the verified
  // artifact is discarded with `REDAX_BROADCAST = 0`; nothing here writes a marker, and
  // refusing before the corridor is exactly what keeps the pre-raw-send terminal literally
  // true.
  // THE MINT PREFLIGHT, RE-DECIDED FROM THE FRESH OBSERVATION — not replayed from Phase A.
  //
  // At Phase B this precedes the wallet request, so a refusal raises no prompt. At
  // `POST_WALLET` it precedes the pre-raw-send marker and the one raw send, so a verified
  // artifact is discarded with nothing broadcast. Either way the mints are proven classic,
  // correctly decimalled and the campaign's own at the last moment before they matter.
  if (state.operation === 'ADD_TOKEN_CONFIG' && frozenPreflight !== null) {
    const mintRefusal = mintPreflightRefusalCode(
      currentCampaign,
      campaignRead.observation,
      frozenPreflight,
    )
    if (mintRefusal !== null) {
      return refuse(phase, mintRefusal, campaignRead.contextSlot)
    }
  }

  const currentAdmission = admissionFootprintOf(
    state.operation,
    currentCampaign,
    campaignRead.observation,
  )
  if (!sameAdmissionFootprint(state.admission, currentAdmission)) {
    return refuse(phase, 'PRE_STATE_NOT_ADMISSIBLE', campaignRead.contextSlot)
  }

  // THE FRESH CLOCK IS NEVER COMPARED TO THE OLD ONE. Time is a CURRENT predicate: the
  // question is whether the window is open NOW, and demanding that two phases observe the
  // same timestamp would refuse every attempt that took longer than a slot. Nothing here
  // reads a stored `clockUnixTimestamp`, because no phase stores one.
  //
  // IT IS NOT A GUARANTEE OF EXECUTION. Even a post-wallet pass leaves a residual race: the
  // transaction can still be executed by the cluster after `end_ts`, and the program stays
  // the final authority on that. No safety margin is applied to pretend otherwise.
  if (state.operation === 'ACTIVATE_CAMPAIGN') {
    const timeRefusal = activationTimeRefusalCode(currentCampaign, campaignRead.observation)
    if (timeRefusal !== null) {
      return refuse(phase, 'PRE_STATE_NOT_ADMISSIBLE', campaignRead.contextSlot)
    }
  }

  let blockhashValidityContextSlot: number
  try {
    const response = await connection.isBlockhashValid(blockhash, {
      commitment: REDAX_MUTATION_GUARD_COMMITMENT,
      minContextSlot: blockhashValidityFloor,
    })
    if (response.context.slot < blockhashValidityFloor) {
      return refuse(phase, 'MIN_CONTEXT_UNAVAILABLE', response.context.slot)
    }
    if (response.value !== true) {
      return refuse(phase, 'BLOCKHASH_INVALID', response.context.slot)
    }
    blockhashValidityContextSlot = response.context.slot
  } catch (error) {
    return refuse(phase, classifyGuardRpcFailure(error), read.contextSlot)
  }

  // THE ONE WITNESS WRITE, and it is here — after the last check, on the success path only.
  // Recording it any earlier would let a Phase B that went on to refuse raise the floor
  // anyway, which is the same false statement in the opposite direction.
  //
  // MONOTONIC MAX, never last-write-wins: if this API is reached twice, the SECOND success
  // may raise both floors and may not lower either. The blockhash identity tracks the most
  // recent successful Phase B — the last artifact this guard actually approved — so a
  // post-wallet call about any other one is refused above.
  if (phase === 'B') {
    PHASE_B_WITNESSES.set(
      snapshot,
      Object.freeze({
        blockhash,
        blockhashContextSlot: input.blockhashContextSlot,
        accountsContextFloor:
          witness === undefined
            ? campaignRead.contextSlot
            : Math.max(witness.accountsContextFloor, campaignRead.contextSlot),
        blockhashValidityContextFloor:
          witness === undefined
            ? blockhashValidityContextSlot
            : Math.max(witness.blockhashValidityContextFloor, blockhashValidityContextSlot),
      }),
    )
  }

  // THE SUCCESS HAND-OFF, and it is deliberately not a result. Both phases observed and
  // gated exactly these two contexts; which of them becomes a reported `contextSlot`, and
  // whether a send floor is built from them at all, is the entry point's decision and not
  // this shared body's. Neither observation is handed to any caller outside this module as a
  // separate value it could combine itself.
  return {
    ok: true,
    accountsContextSlot: campaignRead.contextSlot,
    blockhashValidityContextSlot,
  }
}

/**
 * Run IMMEDIATELY before the one wallet sign-only request.
 *
 * A refusal here happens strictly before it, so it produces no wallet prompt, applies no
 * signature and cannot have broadcast anything.
 */
export async function checkRedaxTeamAdminMutationGuardPhaseB(input: {
  readonly connection: Connection
  readonly snapshot: RedaxTeamAdminMutationGuardAttemptSnapshot
  readonly runtime: RedaxTeamAdminMutationGuardRuntime
  readonly connectedWallet: PublicKey | null
  readonly plan: RedaxTeamAdminMutationFrozenPlanIdentity
  readonly target: RedaxTeamAdminMutationGuardTarget
  readonly blockhash: string
  readonly blockhashContextSlot: number
  readonly mintPreflight: RedaxTeamAdminMutationAddMintPreflight | null
}): Promise<RedaxTeamAdminMutationGuardPhaseBResult> {
  const observed = await reassert('B', input)
  if (!observed.ok) {
    return observed
  }
  // Three members and no fourth. A send floor here would be a floor for a send that cannot
  // happen yet, so this arm does not compute one and has nowhere to put it.
  return { ok: true, phase: 'B', contextSlot: observed.accountsContextSlot }
}

/**
 * Run AFTER the returned bytes pass exact-one-signature verification, and BEFORE the
 * pre-raw-send marker, the retained signature and the ONE raw broadcast.
 *
 * THIS IS THE LAST GATE BEFORE THE POINT OF NO RETURN, which is why its success arm is the
 * one that carries `sendContextFloor`. A verified artifact proves what the wallet did; it
 * proves nothing about what the chain did while the prompt was open, and the send that
 * follows is irreversible.
 *
 * A refusal here means the verified signed artifact is discarded before broadcast. The
 * action root resolves the still-pre-raw-send attempt through its pre-raw-send no-broadcast
 * terminal; nothing is broadcast, the wallet is not asked again, and no retry exists. That
 * terminal is literally true because the point of no return is the raw send itself and this
 * refusal precedes it — a signature already existing does not cross it.
 */
export async function reassertRedaxTeamAdminMutationGuardAfterWallet(input: {
  readonly connection: Connection
  readonly snapshot: RedaxTeamAdminMutationGuardAttemptSnapshot
  readonly runtime: RedaxTeamAdminMutationGuardRuntime
  readonly connectedWallet: PublicKey | null
  readonly plan: RedaxTeamAdminMutationFrozenPlanIdentity
  readonly target: RedaxTeamAdminMutationGuardTarget
  readonly blockhash: string
  readonly blockhashContextSlot: number
  readonly mintPreflight: RedaxTeamAdminMutationAddMintPreflight | null
}): Promise<RedaxTeamAdminMutationGuardPostWalletResult> {
  const observed = await reassert('POST_WALLET', input)
  if (!observed.ok) {
    return observed
  }
  // THE ONE PLACE THE SEND FLOOR IS BUILT. Both members come from THIS successful post-wallet
  // reassertion, each already gated at its own accepted floor before it was observed. Nothing
  // older participates, and the two independent predecessor floors are unchanged by the fact
  // that their maximum is reported.
  return {
    ok: true,
    phase: 'POST_WALLET',
    contextSlot: observed.accountsContextSlot,
    // The bound C2 SOL slot is named EXPLICITLY rather than left implied. Both observations
    // were already gated at a floor that includes it, so the maximum could not fall below
    // it in any case — stating it here makes the send floor's dependence on the SOL
    // observation a fact of THIS arithmetic rather than an inference about an upstream gate.
    sendContextFloor: Math.max(
      observed.accountsContextSlot,
      observed.blockhashValidityContextSlot,
      solPreflightFloorOf(input.snapshot),
    ),
  }
}
