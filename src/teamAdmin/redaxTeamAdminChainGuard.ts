// REDAX Team/Admin S1 chain guard — fail-closed, three times, before anything exists.
//
// -----------------------------------------------------------------------------
// WHAT THIS IS FOR
// -----------------------------------------------------------------------------
// A Team/Admin S1 attempt creates an output mint whose authority is a Campaign PDA
// derived from a fresh salt. The mint account can be created exactly once, and a
// regenerated salt moves the Campaign — so an S1 built against the wrong chain, the
// wrong program or the wrong Team identity does not merely fail, it can strand a mint
// under an address no campaign controls. Every question worth asking is therefore asked
// BEFORE any entropy is drawn, and the mutable ones are asked again twice.
//
//   PHASE A          before the keypair, the salt, the plan and the transaction exist
//   BLOCKHASH        at a context that may not regress below Phase A
//   PHASE B          immediately before the partial signature and the wallet request
//   POST-WALLET      after verification, and before the durable terminal is written
//
// A PHASE-A PASS IS NEVER AN AUTHORIZATION. It is a baseline that the later phases
// measure fresh observations against; each of them re-reads the chain and re-decides.
//
// Before entropy, the connected wallet must NOT equal any present custody authority:
// the protocol fee authority, the protocol emergency-pause authority, or — when the
// program is upgradeable — the ProgramData upgrade authority. Those are three different
// keys and the third may differ from the first two, which is why the ProgramData
// account is fetched and decoded here (through the data layer's strict reader) rather
// than assumed to agree with the ProtocolConfig.
//
// And the check runs in BOTH directions. A negative census — "the wallet is none of the
// authorities" — cannot establish that it IS the approved Team wallet, so a POSITIVE
// equality against an injected trusted Team identity is required as well. The identity
// itself is injected by the private action root; this module invents no address, reads
// no environment and has no default.
//
// -----------------------------------------------------------------------------
// BOUNDARY
// -----------------------------------------------------------------------------
// This module consumes the attempt's `Connection`; it never creates one. Both
// `Connection` and `PublicKey` are imported as TYPES ONLY, so constructing either is
// not merely forbidden here — it is impossible.
//
// It never sends, signs, partial-signs, simulates or confirms; it touches no wallet
// adapter, no provider, no transport, no React, no UI, no storage, no journal, no
// logger, no environment, no `Transaction`, no instruction, no `Keypair` and no
// ComputeBudget. It does not import the Holder guard and does not widen it: the Holder
// action union is untouched, and the two guards share only the chain-identity
// primitives that name devnet's genesis and the upgradeable loader.
//
// Results are typed and value-free: a refusal carries a code, a phase and (when
// honestly known) a context slot. It never carries a raw error, message, cause,
// address, endpoint, account byte or blockhash, and this module logs nothing.

import type { Connection, PublicKey } from '@solana/web3.js'
import { getChainForEndpoint } from '@solana/wallet-standard-util'

import {
  deriveCampaignPda,
  deriveProtocolConfigPda,
  deriveProtocolFeeVaultAta,
  readRedaxTeamAdminGuardAccountsWithContext,
  type RedaxTeamAdminGuardAccountsReadFailureCode,
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
 * "devnet" also classifies as devnet while pointing anywhere at all. That gap is closed
 * by the fresh genesis check, which no URL string can forge.
 */
const REDAX_EXPECTED_CHAIN = 'solana:devnet'

/** The only mode in which a Team/Admin S1 transaction may exist at all. */
const REDAX_EXPECTED_MODE = 'DEVNET_TX_ENABLED'

/** The only configured cluster label accepted alongside it. */
const REDAX_EXPECTED_CLUSTER = 'devnet'

/** Every guard read is `confirmed`: a `finalized` read is STALER, and a pre-sign guard
 *  wants the freshest possible view of the chain, not the safest-to-quote one. */
const REDAX_GUARD_COMMITMENT = 'confirmed' as const

// --- Public vocabulary -------------------------------------------------------

/** Which guard operation produced a result. */
export type RedaxTeamAdminChainGuardPhase = 'A' | 'BLOCKHASH' | 'B' | 'POST_WALLET'

/** Every way this guard can refuse. Value-free, and exhaustive. */
export type RedaxTeamAdminChainGuardRefusalCode =
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
  | 'PLAN_IDENTITY_MISMATCH'
  | 'PHASE_B_CONTINUITY_MISMATCH'
  | 'BLOCKHASH_INVALID'
  | 'MIN_CONTEXT_UNAVAILABLE'
  | 'RPC_READ_UNAVAILABLE'

/** A refusal. It says what failed and where — and nothing else. */
export interface RedaxTeamAdminChainGuardRefusal {
  readonly ok: false
  readonly phase: RedaxTeamAdminChainGuardPhase
  readonly code: RedaxTeamAdminChainGuardRefusalCode
  readonly contextSlot: number | null
}

/**
 * The runtime facts the caller has already resolved. Injected rather than read here:
 * this module owns no environment access, which is also what lets it be tested without
 * one. `mode` and `cluster` are plain strings on purpose — they are compared against
 * exact literals, so any unexpected value (including `null`) is a refusal rather than
 * something this module has to know how to name.
 */
export interface RedaxTeamAdminChainGuardRuntime {
  readonly mode: string
  readonly cluster: string | null
  readonly programId: PublicKey
}

/**
 * The Team topology this attempt intends, as far as it is known BEFORE the plan is
 * frozen: the one wallet that must fill payer, output governance and campaign admin.
 */
export interface RedaxTeamAdminRequestedTopology {
  readonly payer: PublicKey
  readonly outputGovernance: PublicKey
  readonly campaignAdmin: PublicKey
}

/**
 * The frozen plan identity Phase B and the post-wallet reassertion are checked against.
 *
 * Public identities only — there is no secret here and no field one could travel in.
 * The Campaign PDA and the fee vault are RE-DERIVED from these and required to match,
 * so a plan whose derived addresses disagree with its own inputs cannot be signed.
 */
export interface RedaxTeamAdminFrozenPlanIdentity {
  readonly planFingerprint: string
  readonly payer: PublicKey
  readonly outputGovernance: PublicKey
  readonly campaignAdmin: PublicKey
  readonly outputMint: PublicKey
  readonly campaign: PublicKey
  readonly protocolConfig: PublicKey
  readonly protocolFeeVault: PublicKey
  readonly saltHex: string
}

/**
 * The opaque handle Phase A returns. Its ONLY public datum is the context slot Phase A
 * observed at.
 *
 * Everything that matters about the attempt is held privately, keyed by this object's
 * identity (see `ATTEMPTS`). A snapshot this module did not mint — a literal, a clone, a
 * spread, a JSON round trip — is simply not a key in that map, so Phase A cannot be
 * forged, replayed or reconstructed.
 */
export interface RedaxTeamAdminChainGuardAttemptSnapshot {
  readonly phaseAContextSlot: number
}

/** Phase-A outcome. The fresh public authorities it read travel with it. */
export type RedaxTeamAdminChainGuardPhaseAResult =
  | {
      readonly ok: true
      readonly phase: 'A'
      readonly snapshot: RedaxTeamAdminChainGuardAttemptSnapshot
      readonly contextSlot: number
      /** Read FRESH from the canonical ProtocolConfig. The plan freeze needs exactly this. */
      readonly protocolFeeAuthority: PublicKey
    }
  | RedaxTeamAdminChainGuardRefusal

/** Blockhash-helper outcome. Internal attempt data — not UI copy. */
export type RedaxTeamAdminAttemptBlockhashResult =
  | {
      readonly ok: true
      readonly phase: 'BLOCKHASH'
      readonly blockhash: string
      readonly lastValidBlockHeight: number
      readonly blockhashContextSlot: number
    }
  | RedaxTeamAdminChainGuardRefusal

/**
 * Phase-B and post-wallet outcome, discriminated on the PHASE.
 *
 * Two success shapes rather than one, because the two phases do not hand back the same
 * thing. Both report `contextSlot`, which is and remains the ACCOUNT-READ context. Only
 * the post-wallet shape additionally reports `sendContextFloor`, and that asymmetry is
 * the point: a send floor is only meaningful for the one reassertion that runs
 * immediately before the irreversible act, and a Phase B that offered one would be
 * offering a floor for a send that cannot happen yet.
 *
 * The two shapes are named, and each public entry point returns the ONE phase-specific
 * union its own phase can produce. The combined union below still exists, but nothing
 * returns it: a wrapper that knows its phase and hides that in its type is a wrapper
 * whose callers must handle an arm it will never hand them.
 *
 * `sendContextFloor` is computed INSIDE this module, on the post-wallet success path
 * and nowhere else, as the maximum of the exact TWO successful post-wallet observations
 * — the account read and the blockhash-validity read. The action root does not, and
 * cannot, reassemble it: a floor a caller reconstructs from separate values is a floor
 * this guard no longer enforces, and the two observations it is built from never leave
 * this module separately.
 *
 * It is NOT an arbitrary maximum over unrelated history. Neither a Phase-A context, nor
 * a Phase-B context, nor the blockhash INPUT context, nor a locally remembered slot
 * participates. Each of the two members was itself minContext-gated at its own accepted
 * floor before it was observed, so their maximum is at or above every floor either of
 * them had to clear — which is a fact about two enforced reads rather than arithmetic
 * over things nobody re-checked.
 */
export interface RedaxTeamAdminChainGuardPhaseBSuccess {
  readonly ok: true
  readonly phase: 'B'
  readonly contextSlot: number
}

/** A successful post-wallet reassertion. It is the ONLY shape carrying a send floor. */
export interface RedaxTeamAdminChainGuardPostWalletSuccess {
  readonly ok: true
  readonly phase: 'POST_WALLET'
  /** The ACCOUNT-READ context, unchanged in meaning from the single-arm shape. */
  readonly contextSlot: number
  /**
   * `max(accountsContext, blockhashValidityContext)` of THIS successful reassertion.
   *
   * The one value a Team/Admin raw send may pass as `minContextSlot`, and the only
   * one this module will ever produce for that purpose.
   */
  readonly sendContextFloor: number
}

/**
 * What `checkRedaxTeamAdminChainGuardPhaseB` returns — and nothing else.
 *
 * WHY A PHASE-SPECIFIC UNION AND NOT THE COMBINED ONE: an entry point that already
 * knows which phase it asked for must SAY so in its type. A wrapper returning the
 * combined union forces every caller to re-handle a phase that call can never produce,
 * and the only ways out of that are the ones this module refuses — a cast, a non-null
 * assertion, an invented fallback floor, or an `in` test written to quiet the compiler
 * rather than to decide anything.
 */
export type RedaxTeamAdminChainGuardPhaseBResult =
  | RedaxTeamAdminChainGuardPhaseBSuccess
  | RedaxTeamAdminChainGuardRefusal

/** What `reassertRedaxTeamAdminChainGuardAfterWallet` returns — and nothing else. */
export type RedaxTeamAdminChainGuardPostWalletResult =
  | RedaxTeamAdminChainGuardPostWalletSuccess
  | RedaxTeamAdminChainGuardRefusal

/**
 * Either reassertion outcome, for the rare caller that genuinely handles both.
 *
 * Neither public entry point returns this. It is a description of the family, not a
 * return type, and no entry point widens itself to it.
 */
export type RedaxTeamAdminChainGuardReassertionResult =
  | RedaxTeamAdminChainGuardPhaseBResult
  | RedaxTeamAdminChainGuardPostWalletResult

// --- Private attempt state ---------------------------------------------------

/**
 * What Phase A froze, so the later phases can detect drift.
 *
 * Every field is a copied base58 string, a number or a boolean. WHY PRIMITIVES, AND NOT
 * THE CALLER'S OBJECTS: keeping caller objects by reference is not a baseline, it is an
 * alias — a caller that mutated them in place after Phase A would rewrite the
 * "baseline" and the "current input" in one stroke, and the comparison would be against
 * itself. `readonly` does not help; it is erased at runtime and never applied to the
 * caller's own object.
 *
 * `upgradeAuthority` is `null` when and only when the program is IMMUTABLE, which is a
 * meaningful state and not an unknown: the reader refuses rather than reporting null for
 * anything it could not read.
 *
 * It holds no verdict, no raw RPC response, no account bytes, no adapter, no
 * `Transaction`, no signed bytes and — apart from the attempt's own `Connection` — no
 * caller-owned object of any kind.
 */
interface RedaxTeamAdminAttemptState {
  readonly connection: Connection
  readonly programId: string
  readonly programDataAddress: string
  readonly upgradeAuthority: string | null
  readonly protocolFeeAuthority: string
  readonly protocolEmergencyPauseAuthority: string
  readonly protocolConfigBump: number
  readonly approvedTeamWallet: string
  readonly phaseAContextSlot: number
}

const ATTEMPTS = new WeakMap<
  RedaxTeamAdminChainGuardAttemptSnapshot,
  RedaxTeamAdminAttemptState
>()

/**
 * The plan identity flattened to primitives, as the FIRST reassertion saw it.
 *
 * Phase A cannot hold a plan baseline: no plan exists yet when it runs. So the baseline
 * is taken at Phase B — the last moment before the wallet is asked — and the post-wallet
 * reassertion is required to be about EXACTLY the same plan. Without it, "the plan was
 * valid before the prompt" and "the plan is valid after the prompt" could both be true
 * of two different plans.
 *
 * Primitives, not the caller's objects, for the same reason the attempt state is: a
 * caller that mutated its own plan object in place would otherwise rewrite the baseline
 * and the current value together.
 */
const PLAN_BASELINES = new WeakMap<RedaxTeamAdminChainGuardAttemptSnapshot, FrozenPlanBaseline>()

type FrozenPlanBaseline = Readonly<{
  planFingerprint: string
  payer: string
  outputGovernance: string
  campaignAdmin: string
  outputMint: string
  campaign: string
  protocolConfig: string
  protocolFeeVault: string
  saltHex: string
}>

/** Copy the plan identity out of the caller's object into frozen primitives. */
function capturePlanBaseline(plan: RedaxTeamAdminFrozenPlanIdentity): FrozenPlanBaseline {
  return Object.freeze({
    planFingerprint: plan.planFingerprint,
    payer: plan.payer.toBase58(),
    outputGovernance: plan.outputGovernance.toBase58(),
    campaignAdmin: plan.campaignAdmin.toBase58(),
    outputMint: plan.outputMint.toBase58(),
    campaign: plan.campaign.toBase58(),
    protocolConfig: plan.protocolConfig.toBase58(),
    protocolFeeVault: plan.protocolFeeVault.toBase58(),
    saltHex: plan.saltHex,
  })
}

/**
 * Field-by-field equality of two frozen plan baselines.
 *
 * Deliberately explicit rather than `JSON.stringify`-based: a serializer decides key
 * order, silently drops `undefined`, and would let a whole field go missing without
 * anyone noticing. Here every field is named, so a new one cannot be added to the
 * baseline and forgotten here without the compiler objecting.
 */
function samePlanBaseline(a: FrozenPlanBaseline, b: FrozenPlanBaseline): boolean {
  return (
    a.planFingerprint === b.planFingerprint &&
    a.payer === b.payer &&
    a.outputGovernance === b.outputGovernance &&
    a.campaignAdmin === b.campaignAdmin &&
    a.outputMint === b.outputMint &&
    a.campaign === b.campaign &&
    a.protocolConfig === b.protocolConfig &&
    a.protocolFeeVault === b.protocolFeeVault &&
    a.saltHex === b.saltHex
  )
}

/**
 * What a SUCCESSFUL Phase B accepted — the floor no later phase may fall below.
 *
 * Phase A and the late blockhash establish the FIRST floor of an attempt. But a Phase B
 * that passed may have observed a context NEWER than both, and once it has, that newer
 * context is a fact this attempt already accepted. Measuring the post-wallet reassertion
 * against the older baseline would leave a corridor — an observation newer than Phase A
 * and the blockhash, but OLDER than the successful Phase B — in which a post-wallet read
 * from a lagging node passes while describing a chain the attempt has already moved past.
 *
 * The two context-bearing observations are kept SEPARATELY, because they are two
 * different reads of two different things: the authoritative three-account read, and the
 * blockhash-validity read. Collapsing them into one number would let a high slot from
 * either raise the bar for the other and call it freshness it never established.
 *
 * It is a freshness witness and NOTHING ELSE: it grants nothing, permits nothing and is
 * never consulted to decide that something may happen — only to decide that an
 * observation is too old to be believed.
 */
type PhaseBFreshnessWitness = Readonly<{
  /** The exact blockhash the successful Phase B validated — and the artifact's identity. */
  blockhash: string
  blockhashContextSlot: number
  /** The authoritative accounts context that Phase B ACCEPTED. Only ever raised. */
  accountsContextFloor: number
  /** The blockhash-validity context that Phase B ACCEPTED. Only ever raised. */
  blockhashValidityContextFloor: number
}>

/**
 * The witness store, private to this module and keyed by the AUTHENTIC snapshot.
 *
 * Deliberately not a field on any caller-reachable object: a floor a caller could write
 * is not a floor. A forged, cloned, spread or JSON-round-tripped snapshot is not a key
 * here, so a caller cannot install a floor, lower one, or borrow another attempt's.
 *
 * It is written in exactly ONE place — after every Phase-B check has passed — and only
 * ever upward. A Phase B that REFUSED writes nothing at all: a refusal establishes no
 * freshness, and letting one raise the floor would let a failing observation vouch for
 * an attempt it just rejected.
 */
const PHASE_B_WITNESSES = new WeakMap<
  RedaxTeamAdminChainGuardAttemptSnapshot,
  PhaseBFreshnessWitness
>()

/**
 * THE BOUND C2 SOL-PREFLIGHT CONTEXT FLOOR, per attempt. Private, and single-assignment.
 *
 * The S1 action root performs its own attempt-authoritative SOL observation between Phase
 * A and the output-mint entropy, and that observation is only worth anything if the rest
 * of the attempt is measured at or above the context it was read at. A floor the ROOT
 * kept would be a floor the root could also forget, lower or reassemble — so the value is
 * handed to this module and never handed back: it is stored under the authentic snapshot's
 * object identity, exactly like every other private per-attempt fact here, and from that
 * moment it participates in every later floor this guard computes.
 *
 * SINGLE ASSIGNMENT, not last-write-wins. One attempt performs exactly one authoritative
 * SOL observation, so a second bind is a bug or an attack rather than a refinement, and a
 * LOWER bind is refused for the same reason a Phase-B witness is only ever raised. There
 * is no unbind, no clear and no read accessor: nothing outside this module can learn the
 * value, and nothing inside it can be talked into forgetting one.
 */
const SOL_PREFLIGHT_FLOORS = new WeakMap<RedaxTeamAdminChainGuardAttemptSnapshot, number>()

// --- Helpers -----------------------------------------------------------------

function refuse(
  phase: RedaxTeamAdminChainGuardPhase,
  code: RedaxTeamAdminChainGuardRefusalCode,
  contextSlot: number | null,
): RedaxTeamAdminChainGuardRefusal {
  return { ok: false, phase, code, contextSlot }
}

/** The reader's structural failures map 1:1 onto guard refusals. */
function fromReadFailure(
  code: RedaxTeamAdminGuardAccountsReadFailureCode,
): RedaxTeamAdminChainGuardRefusalCode {
  return code
}

/**
 * Classify the attempt's endpoint. A classifier throw (a non-string endpoint, a hostile
 * object) is a refusal, never an exception the caller has to remember to handle — and
 * never a pass.
 */
function isExpectedDevnetEndpoint(connection: Connection): boolean {
  try {
    return getChainForEndpoint(connection.rpcEndpoint) === REDAX_EXPECTED_CHAIN
  } catch {
    return false
  }
}

/** Exact static checks shared by every phase. */
function checkRuntime(
  phase: RedaxTeamAdminChainGuardPhase,
  connection: Connection,
  runtime: RedaxTeamAdminChainGuardRuntime,
): RedaxTeamAdminChainGuardRefusal | null {
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
  phase: RedaxTeamAdminChainGuardPhase,
  connection: Connection,
): Promise<RedaxTeamAdminChainGuardRefusal | null> {
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
 * Is the connected wallet one of the present custody authorities?
 */
function isCustodyAuthority(
  wallet: PublicKey,
  protocolFeeAuthority: PublicKey,
  protocolEmergencyPauseAuthority: PublicKey,
  upgradeAuthority: PublicKey | null,
): boolean {
  const key = wallet.toBase58()
  return (
    key === protocolFeeAuthority.toBase58() ||
    key === protocolEmergencyPauseAuthority.toBase58() ||
    (upgradeAuthority !== null && key === upgradeAuthority.toBase58())
  )
}

/**
 * The JSON-RPC code a node raises when it has not yet reached the requested slot. Kept
 * local so the blockhash paths need no import to classify it.
 */
const MIN_CONTEXT_SLOT_NOT_REACHED_CODE = -32016

/**
 * Classify a blockhash-RPC failure STRUCTURALLY, by numeric code.
 *
 * Numeric code only: never `instanceof` (nominal checks break across duplicate package
 * instances, and this repository really does resolve two `@solana/web3.js` copies),
 * never an error name, message or keyword. `Reflect.get` is wrapped because a hostile
 * object can define a throwing getter; that falls through to the generic refusal rather
 * than escaping as an exception. Both outcomes refuse.
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
 * Recover the private state for an attempt, proving both that the snapshot is one we
 * minted AND that the caller is still on the same `Connection` object.
 *
 * The same-Connection requirement is not pedantry: a guard that validated one endpoint
 * while the transaction was signed for another would prove nothing at all.
 */
function resolveAttempt(
  phase: RedaxTeamAdminChainGuardPhase,
  snapshot: RedaxTeamAdminChainGuardAttemptSnapshot,
  connection: Connection,
): RedaxTeamAdminAttemptState | RedaxTeamAdminChainGuardRefusal {
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
  value: RedaxTeamAdminAttemptState | RedaxTeamAdminChainGuardRefusal,
): value is RedaxTeamAdminChainGuardRefusal {
  return (value as RedaxTeamAdminChainGuardRefusal).ok === false
}

/**
 * Does the frozen plan agree with itself, with the program, and with the fresh fee
 * authority?
 *
 * The derived addresses are RE-DERIVED here rather than trusted: the Campaign PDA is
 * seeded from the output governance and the salt, and the canonical fee vault from the
 * FRESH ProtocolConfig fee authority and the output mint. A plan carrying a Campaign or
 * a vault that its own inputs do not produce is a plan whose durable record would name
 * accounts the transaction never touches.
 */
function checkPlanIdentity(
  plan: RedaxTeamAdminFrozenPlanIdentity,
  programId: PublicKey,
  approvedTeamWallet: string,
  protocolFeeAuthority: PublicKey,
): boolean {
  if (
    plan.payer.toBase58() !== approvedTeamWallet ||
    plan.outputGovernance.toBase58() !== approvedTeamWallet ||
    plan.campaignAdmin.toBase58() !== approvedTeamWallet
  ) {
    return false
  }
  if (!/^[0-9a-f]{64}$/.test(plan.saltHex)) {
    return false
  }
  const salt = new Uint8Array(32)
  for (let index = 0; index < 32; index += 1) {
    salt[index] = Number.parseInt(plan.saltHex.slice(index * 2, index * 2 + 2), 16)
  }
  // Every derivation is wrapped: the helpers throw on inputs they refuse to derive
  // from, and an escaping exception would leave the caller with something outside this
  // module's declared refusal union.
  try {
    const derivedCampaign = deriveCampaignPda(programId, plan.outputGovernance, salt)
    if (!derivedCampaign.pda.equals(plan.campaign)) {
      return false
    }
    const derivedProtocolConfig = deriveProtocolConfigPda(programId)
    if (!derivedProtocolConfig.pda.equals(plan.protocolConfig)) {
      return false
    }
    const derivedFeeVault = deriveProtocolFeeVaultAta(protocolFeeAuthority, plan.outputMint)
    if (!derivedFeeVault.equals(plan.protocolFeeVault)) {
      return false
    }
  } catch {
    return false
  }
  return true
}

// --- Phase A -----------------------------------------------------------------

/**
 * Run BEFORE any entropy, keypair, salt, plan, instruction or `Transaction` exists.
 *
 * On success it freezes an attempt baseline and returns an opaque snapshot plus the
 * FRESH protocol fee authority the plan freeze requires. It has authorized nothing: the
 * snapshot is a handle, not a permit.
 */
export async function checkRedaxTeamAdminChainGuardPhaseA(input: {
  readonly connection: Connection
  readonly runtime: RedaxTeamAdminChainGuardRuntime
  /** The wallet the broker reports as connected, right now. */
  readonly connectedWallet: PublicKey | null
  /** The trusted approved-Team identity, injected at the private action-root boundary. */
  readonly approvedTeamWallet: PublicKey | null
  /** The Team topology this attempt intends, as far as it is known before the freeze. */
  readonly requestedTopology: RedaxTeamAdminRequestedTopology
}): Promise<RedaxTeamAdminChainGuardPhaseAResult> {
  const { connection, runtime, connectedWallet, approvedTeamWallet, requestedTopology } = input

  const runtimeRefusal = checkRuntime('A', connection, runtime)
  if (runtimeRefusal !== null) {
    return runtimeRefusal
  }

  const genesisRefusal = await checkGenesis('A', connection)
  if (genesisRefusal !== null) {
    return genesisRefusal
  }

  const read = await readRedaxTeamAdminGuardAccountsWithContext(connection, runtime.programId, {
    commitment: REDAX_GUARD_COMMITMENT,
  })
  if (!read.ok) {
    return refuse('A', fromReadFailure(read.code), read.contextSlot)
  }

  // The loader-owner equalities live here, not in the data module: the expected identity
  // is a wallet-layer constant and the data module must not import it. BOTH accounts are
  // checked — a ProgramData account owned by something else is not the upgrade record of
  // this program, whatever authority it happens to carry.
  if (!isRedaxExpectedUpgradeableLoaderOwner(read.program.owner)) {
    return refuse('A', 'PROGRAM_OWNER_MISMATCH', read.contextSlot)
  }
  if (!isRedaxExpectedUpgradeableLoaderOwner(read.program.programDataOwner)) {
    return refuse('A', 'PROGRAM_DATA_OWNER_MISMATCH', read.contextSlot)
  }

  // POSITIVE Team identity, first. A wallet that is merely "none of the authorities" is
  // not the approved Team wallet, and an absent trusted identity is not a permission to
  // proceed with whatever is connected.
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

  // The topology inputs that are known before the freeze must already agree with the
  // approved identity — otherwise entropy would be drawn for a plan that cannot pass
  // Phase B.
  if (
    requestedTopology.payer.toBase58() !== approved ||
    requestedTopology.outputGovernance.toBase58() !== approved ||
    requestedTopology.campaignAdmin.toBase58() !== approved
  ) {
    return refuse('A', 'PLAN_IDENTITY_MISMATCH', read.contextSlot)
  }

  const snapshot: RedaxTeamAdminChainGuardAttemptSnapshot = Object.freeze({
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
      phaseAContextSlot: read.contextSlot,
    }),
  )

  return {
    ok: true,
    phase: 'A',
    snapshot,
    contextSlot: read.contextSlot,
    protocolFeeAuthority: feeAuthority,
  }
}

// --- The C2 SOL-preflight context floor ---------------------------------------

/**
 * BIND the attempt-authoritative SOL observation's context slot as a guard floor.
 *
 * THE ROOT OBSERVES; THIS MODULE OWNS THE FLOOR. The S1 action root reads the approved
 * payer's contextual balance on the attempt's own `Connection` after Phase A and before
 * any entropy exists, and a SUFFICIENT verdict is authoritative only if everything the
 * attempt does afterwards describes a chain at least that new. Handing the slot here —
 * rather than keeping it at the root and re-deriving a floor at each later call — means
 * there is exactly ONE floor authority for this attempt, and it is the same module that
 * already owns the Phase-A, blockhash, Phase-B and send floors.
 *
 * WHAT THIS DOES NOT DO, structurally: it constructs no `Connection`, performs no RPC,
 * reads no wallet, reads no environment, reads and writes no journal, builds no
 * transaction, signs nothing and sends nothing. It is arithmetic over a value the caller
 * already observed, plus the same authenticity checks every other phase makes.
 *
 * THE RESULT IS A BARE BOOLEAN on purpose. A record would be a place to put the floor,
 * and a floor a caller can read is a floor a caller can reassemble; `false` says the bind
 * was refused and says nothing about which check refused it, at what slot, or what the
 * attempt's existing floor is. A refusal is FAIL-CLOSED at the root: the caller must
 * abandon the attempt, never continue with an unbound observation.
 *
 * REFUSED, in every one of these cases:
 *
 *   * the snapshot is not one Phase A minted here — a literal, clone, spread or JSON
 *     round trip is not a key in `ATTEMPTS` and cannot become one;
 *   * the `Connection` is not the exact object Phase A registered, so a balance read on
 *     one endpoint can never raise the floor of an attempt guarded on another;
 *   * the slot is not a non-negative safe integer;
 *   * the slot is BELOW the attempt's existing Phase-A floor — an observation older than
 *     the guard's own baseline establishes no freshness and may not be believed;
 *   * a floor is ALREADY bound for this attempt. Single assignment: one attempt makes one
 *     authoritative SOL observation, so a second is refused whether it is higher, equal
 *     or lower, and a lower one is refused by that same rule rather than silently ignored.
 */
export function bindRedaxTeamAdminSolPreflightContextFloor(input: {
  readonly snapshot: RedaxTeamAdminChainGuardAttemptSnapshot
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
  if (balanceContextSlot < state.phaseAContextSlot) {
    return false
  }
  if (SOL_PREFLIGHT_FLOORS.has(snapshot)) {
    return false
  }
  SOL_PREFLIGHT_FLOORS.set(snapshot, balanceContextSlot)
  return true
}

/**
 * The attempt's SOL floor, or `0` when none is bound.
 *
 * PRIVATE, and `0` is the correct neutral: it is the identity of `Math.max` over
 * non-negative slots, so an attempt that never bound one is measured exactly as it was
 * before this floor existed. It is deliberately not exported — the value never leaves
 * this module — and it is read on every later floor computation rather than cached.
 */
function solPreflightFloorOf(snapshot: RedaxTeamAdminChainGuardAttemptSnapshot): number {
  return SOL_PREFLIGHT_FLOORS.get(snapshot) ?? 0
}

// --- Blockhash ---------------------------------------------------------------

/**
 * Obtain the attempt's blockhash at a context NO OLDER than Phase A.
 *
 * Both protections are applied, because they defend different things: `minContextSlot`
 * makes a lagging node refuse to answer, and the local floor check makes a lagging
 * ANSWER refuse to be used.
 */
export async function fetchRedaxTeamAdminAttemptBlockhash(input: {
  readonly connection: Connection
  readonly snapshot: RedaxTeamAdminChainGuardAttemptSnapshot
}): Promise<RedaxTeamAdminAttemptBlockhashResult> {
  const { connection, snapshot } = input

  const state = resolveAttempt('BLOCKHASH', snapshot, connection)
  if (isRefusal(state)) {
    return state
  }

  // The floor is Phase A's context AND the bound C2 SOL observation's, because both are
  // contexts this attempt has already accepted. A blockhash older than the balance read
  // that authorized the attempt would describe a chain the attempt has moved past.
  const floor = Math.max(state.phaseAContextSlot, solPreflightFloorOf(snapshot))
  try {
    const response = await connection.getLatestBlockhashAndContext({
      commitment: REDAX_GUARD_COMMITMENT,
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

// --- Phase B and the post-wallet reassertion ----------------------------------

/**
 * What a SUCCESSFUL reassertion observed — the private hand-off between the shared
 * implementation and the two phase-specific entry points.
 *
 * It is not a result and never leaves this module. It carries the two contexts this
 * call itself read and gated, and no verdict, no phase and no floor: the floor is
 * arithmetic only the post-wallet entry point is allowed to do, and putting it here
 * would offer it to Phase B as well.
 */
type ReassertionObservations = Readonly<{
  readonly ok: true
  /** The ACCOUNT-READ context this reassertion accepted. */
  readonly accountsContextSlot: number
  /** The BLOCKHASH-VALIDITY context this reassertion accepted. */
  readonly blockhashValidityContextSlot: number
}>

/**
 * Re-read and re-decide every mutable fact, at one named phase.
 *
 * ONE implementation serves both reassertions on purpose. They ask exactly the same
 * questions — the difference is only WHEN, and what a failure means: before the wallet
 * request nothing has been signed, and after it a verified artifact exists and is about
 * to be discarded without any broadcast. Two copies of this logic would be two things to
 * keep in step, and the first time they drifted one of the two moments would be checked
 * less than the other.
 *
 * Phase A's success is never consulted. What Phase A left behind is a BASELINE — the
 * exact authorities, the exact ProgramData relation, the exact approved Team wallet —
 * and everything below is measured against it from a fresh read.
 */
async function reassert(
  phase: 'B' | 'POST_WALLET',
  input: {
    readonly connection: Connection
    readonly snapshot: RedaxTeamAdminChainGuardAttemptSnapshot
    readonly runtime: RedaxTeamAdminChainGuardRuntime
    readonly connectedWallet: PublicKey | null
    readonly plan: RedaxTeamAdminFrozenPlanIdentity
    readonly outputMintCustodyAddress: string
    readonly blockhash: string
    readonly blockhashContextSlot: number
  },
): Promise<ReassertionObservations | RedaxTeamAdminChainGuardRefusal> {
  const { connection, snapshot, runtime, connectedWallet, plan, blockhash } = input

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

  // Nothing observed after this point may be older than anything already accepted —
  // and what has already been accepted includes whatever a SUCCESSFUL Phase B saw, not
  // merely Phase A and the blockhash.
  const witness = PHASE_B_WITNESSES.get(snapshot)

  // A post-wallet reassertion is only ever ABOUT a successful Phase B. Without one there
  // is no moment at which this guard approved anything for the wallet to have signed, and
  // the artifact must be about the exact blockhash — and the exact blockhash observation
  // — that Phase B validated. Both are checked here, before a single read is issued,
  // because a continuity that is already broken cannot be repaired by fresher data.
  if (phase === 'POST_WALLET') {
    if (
      witness === undefined ||
      witness.blockhash !== blockhash ||
      witness.blockhashContextSlot !== input.blockhashContextSlot
    ) {
      return refuse(phase, 'PHASE_B_CONTINUITY_MISMATCH', null)
    }
  }

  // The bound C2 SOL slot joins Phase A and the blockhash as a THIRD accepted context, so
  // both reassertions — and therefore the send floor built from the post-wallet one —
  // are unable to accept an observation older than the balance read that authorized this
  // attempt. An attempt that bound no floor reads `0` here and is measured exactly as it
  // was before this floor existed.
  const baseFloor = Math.max(
    state.phaseAContextSlot,
    input.blockhashContextSlot,
    solPreflightFloorOf(snapshot),
  )
  const accountsFloor =
    witness === undefined ? baseFloor : Math.max(baseFloor, witness.accountsContextFloor)
  const blockhashValidityFloor =
    witness === undefined
      ? baseFloor
      : Math.max(baseFloor, witness.blockhashValidityContextFloor)

  const read = await readRedaxTeamAdminGuardAccountsWithContext(connection, runtime.programId, {
    commitment: REDAX_GUARD_COMMITMENT,
    minContextSlot: accountsFloor,
  })
  if (!read.ok) {
    return refuse(phase, fromReadFailure(read.code), read.contextSlot)
  }
  if (read.contextSlot < accountsFloor) {
    // The request option protects request EVALUATION; this rejects a stale ANSWER.
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

  // The upgrade authority was valid in Phase A and is valid now — but is it the SAME
  // one? An authority that changed between the phases means the program can be replaced
  // by a key this attempt never checked itself against. `null` participates on both
  // sides: becoming immutable, or ceasing to be, are both changes.
  const freshUpgradeAuthority =
    read.program.upgradeAuthority === null ? null : read.program.upgradeAuthority.toBase58()
  if (freshUpgradeAuthority !== state.upgradeAuthority) {
    return refuse(phase, 'UPGRADE_AUTHORITY_CHANGED', read.contextSlot)
  }

  // Same question for the ProtocolConfig: a re-pointed fee authority between the phases
  // would redirect the fee vault, and every individual check would still have passed.
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

  // The frozen plan is re-validated in full against the FRESH fee authority, and the
  // mint it names is the mint the attempt actually holds custody for. A plan that is
  // internally sound but describes a different mint would be signed by a key that is
  // not in it.
  if (
    !checkPlanIdentity(plan, runtime.programId, state.approvedTeamWallet, fresh.protocolFeeAuthority)
  ) {
    return refuse(phase, 'PLAN_IDENTITY_MISMATCH', read.contextSlot)
  }
  if (plan.outputMint.toBase58() !== input.outputMintCustodyAddress) {
    return refuse(phase, 'PLAN_IDENTITY_MISMATCH', read.contextSlot)
  }

  // The plan the wallet was asked about, and the plan the post-wallet reassertion is
  // about, must be the same plan. Phase B records the baseline; every later phase is
  // compared against it. A different-but-internally-coherent plan is caught here, and
  // the comparison cannot be defeated by mutating the caller's own object, because the
  // baseline side of it no longer lives in one.
  const currentPlan = capturePlanBaseline(plan)
  const baseline = PLAN_BASELINES.get(snapshot)
  if (baseline === undefined) {
    if (phase !== 'B') {
      // A post-wallet reassertion with no Phase-B baseline means the wallet was asked
      // about a plan this guard never approved.
      return refuse(phase, 'PLAN_IDENTITY_MISMATCH', read.contextSlot)
    }
    PLAN_BASELINES.set(snapshot, currentPlan)
  } else if (!samePlanBaseline(baseline, currentPlan)) {
    return refuse(phase, 'PLAN_IDENTITY_MISMATCH', read.contextSlot)
  }

  let blockhashValidityContextSlot: number
  try {
    const response = await connection.isBlockhashValid(blockhash, {
      commitment: REDAX_GUARD_COMMITMENT,
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

  // THE ONE WITNESS WRITE, and it is here — after the last check, on the success path
  // only. Recording it any earlier would let a Phase B that went on to refuse raise the
  // floor anyway, which is the same false statement in the opposite direction.
  //
  // MONOTONIC MAX, never last-write-wins: if this API is reached twice, the SECOND
  // success may raise both floors and may not lower either. The blockhash identity
  // tracks the most recent successful Phase B — the last artifact this guard actually
  // approved — so a post-wallet call about any other one is refused above.
  if (phase === 'B') {
    PHASE_B_WITNESSES.set(
      snapshot,
      Object.freeze({
        blockhash,
        blockhashContextSlot: input.blockhashContextSlot,
        accountsContextFloor:
          witness === undefined
            ? read.contextSlot
            : Math.max(witness.accountsContextFloor, read.contextSlot),
        blockhashValidityContextFloor:
          witness === undefined
            ? blockhashValidityContextSlot
            : Math.max(witness.blockhashValidityContextFloor, blockhashValidityContextSlot),
      }),
    )
  }

  // THE SUCCESS HAND-OFF, and it is deliberately not a result. Both phases observed and
  // gated exactly these two contexts; which of them becomes a reported `contextSlot`,
  // and whether a send floor is built from them at all, is the entry point's decision
  // and not this shared body's. Neither observation is handed to any caller outside
  // this module as a separate value it could combine itself.
  return {
    ok: true,
    accountsContextSlot: read.contextSlot,
    blockhashValidityContextSlot,
  }
}

/**
 * Run IMMEDIATELY before the one `partialSign` and the one wallet sign-only request.
 */
export async function checkRedaxTeamAdminChainGuardPhaseB(input: {
  readonly connection: Connection
  readonly snapshot: RedaxTeamAdminChainGuardAttemptSnapshot
  readonly runtime: RedaxTeamAdminChainGuardRuntime
  readonly connectedWallet: PublicKey | null
  readonly plan: RedaxTeamAdminFrozenPlanIdentity
  readonly outputMintCustodyAddress: string
  readonly blockhash: string
  readonly blockhashContextSlot: number
}): Promise<RedaxTeamAdminChainGuardPhaseBResult> {
  const observed = await reassert('B', input)
  if (!observed.ok) {
    return observed
  }
  // Three members and no fourth. A send floor here would be a floor for a send that
  // cannot happen yet, so this arm does not compute one and has nowhere to put it.
  return { ok: true, phase: 'B', contextSlot: observed.accountsContextSlot }
}

/**
 * Run AFTER the returned bytes pass exact two-signature verification, and BEFORE the
 * invocation marker, the retained signature and the ONE raw broadcast.
 *
 * THIS IS THE LAST GATE BEFORE THE POINT OF NO RETURN, which is why its success arm is
 * the one that carries `sendContextFloor`. A verified artifact proves what the wallet
 * did; it proves nothing about what the chain did while the prompt was open, and the
 * send that follows is irreversible.
 *
 * A refusal here means the verified signed artifact is discarded before broadcast. The
 * action root resolves the still-pre-invocation attempt through its existing
 * `PRE_INVOCATION_REFUSAL` tombstone path; nothing is broadcast, the wallet is not asked
 * again, and no retry exists. That tombstone is literally true because the point of no
 * return is the raw send itself and this refusal precedes it — a signature already
 * existing does not cross it.
 *
 * It is deliberately DISTINCT from the `VERIFIED_NO_BROADCAST_DISCARDED` terminal, which
 * represents the separately authorized clean verified-stop path rather than a guard
 * refusal. Writing THAT terminal here would be the false durable statement: it would
 * claim a clean verified stop for an attempt the chain moved underneath.
 */
export async function reassertRedaxTeamAdminChainGuardAfterWallet(input: {
  readonly connection: Connection
  readonly snapshot: RedaxTeamAdminChainGuardAttemptSnapshot
  readonly runtime: RedaxTeamAdminChainGuardRuntime
  readonly connectedWallet: PublicKey | null
  readonly plan: RedaxTeamAdminFrozenPlanIdentity
  readonly outputMintCustodyAddress: string
  readonly blockhash: string
  readonly blockhashContextSlot: number
}): Promise<RedaxTeamAdminChainGuardPostWalletResult> {
  const observed = await reassert('POST_WALLET', input)
  if (!observed.ok) {
    return observed
  }
  // THE ONE PLACE THE SEND FLOOR IS BUILT. Both members come from THIS successful
  // post-wallet reassertion, each already gated at its own accepted floor before it was
  // observed. Nothing older participates, and the two independent predecessor floors
  // are unchanged by the fact that their maximum is reported.
  //
  // The bound C2 SOL slot is named EXPLICITLY rather than left implied. Both observations
  // above were already gated at a floor that includes it, so the maximum could not fall
  // below it in any case — but stating it here makes the send floor's dependence on the
  // SOL observation a fact of THIS arithmetic rather than an inference about somebody
  // else's, and an edit that weakened an upstream gate could not silently weaken this.
  return {
    ok: true,
    phase: 'POST_WALLET',
    contextSlot: observed.accountsContextSlot,
    sendContextFloor: Math.max(
      observed.accountsContextSlot,
      observed.blockhashValidityContextSlot,
      solPreflightFloorOf(input.snapshot),
    ),
  }
}
