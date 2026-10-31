// -----------------------------------------------------------------------------
// WHAT THIS FILE IS
// -----------------------------------------------------------------------------
// The ONE pure assembler for the six post-init mutations. Given a program, an approved
// Team wallet, a Campaign and an operation, it returns exactly one REDAX instruction plus
// the facts an attempt is judged against — and it CONSTRUCTS NO `Transaction`.
//
// It is PURE. There is no `Connection`, no `Transaction`, no RPC, no wallet, no broker,
// no journal, no storage, no signing, no send, no React and no environment read here,
// and no member of this module can reach one. A plan is a description; the one root that
// may act on it owns every irreversible step.
//
// -----------------------------------------------------------------------------
// EXACTLY ONE REDAX INSTRUCTION, PRECEDED BY THE FIXED ComputeBudget PAIR
// -----------------------------------------------------------------------------
// Every one of the six assembles to a SINGLE REDAX program instruction, and
// `CURRENT_COMPUTE_BUDGET_INSTRUCTIONS = 2`: the plan also carries the fixed Team/Admin
// mutation ComputeBudget pair — limit, then price — that the one transaction places
// BEFORE the REDAX instruction. The pair is there because an unsigned transaction with an
// empty ComputeBudget slot is one a documented wallet behaviour rewrites before signing,
// and the exact-message verifier then refuses it.
//
// THE PAIR IS CONSUMED, NEVER CHOSEN. `app/src/data/devnet/redaxDevnetTxBuilders.ts` owns
// it as a fixed table keyed by the operation; this module names the operation it already
// planned and receives fixed bytes. It is NOT the Holder pair, and it constructs nothing
// itself.
//
// THE VERIFIER DID NOT CHANGE, AND THAT IS THE POINT. The exact-one signed wire verifier
// deliberately carries NO top-level instruction-cardinality check
// (`SIGNED_WIRE_VERIFIER_TOP_LEVEL_INSTRUCTION_CARDINALITY_CHECK = NONE`), so the pair
// changes what this module assembles — and therefore what is committed BEFORE the wallet
// is asked — without weakening the verifier in any way.
//
// -----------------------------------------------------------------------------
// THE SIGNER TOPOLOGY IS COLLAPSED HERE, BEFORE ANY WALLET EXISTS
// -----------------------------------------------------------------------------
// Every REDAX signer role each of these instructions declares — `payer`,
// `campaign_admin`, `authority` — must be the EXACT approved Team wallet, and that is
// checked against the builder's own declared `signers` array rather than assumed from the
// inputs. The result is `EXACT_ONE_REQUIRED_WALLET_SIGNATURE`: one key fills every role,
// so the compiled message needs exactly one signature and the exact-one verifier is a
// statement about a topology this module already proved.
//
// -----------------------------------------------------------------------------
// DERIVED WITNESSES
// -----------------------------------------------------------------------------
// The TokenConfig PDA and the canonical metadata PDA are re-derived here and returned as
// WITNESSES. They are not mutation-identity dimensions — they are functions of the seeds
// that already are — and they exist so a later readback can look at the exact address the
// instruction addressed rather than at one somebody supplied alongside it.

import type { PublicKey, TransactionInstruction } from '@solana/web3.js'

import {
  deriveOutputTokenMetadataPda,
  deriveTokenConfigPda,
} from '../data/devnet/redaxDevnetAccounts'
import {
  buildActivateCampaignInstruction,
  buildAddTokenConfigInstruction,
  buildFinalizeCampaignInstruction,
  buildPauseCampaignInstruction,
  buildRedaxTeamAdminMutationComputeBudgetInstructions,
  buildSetupMetadataInstruction,
  buildUnpauseCampaignInstruction,
  type RedaxSignerRequirement,
} from '../data/devnet/redaxDevnetTxBuilders'
import type { RedaxTeamAdminCanonicalMetadataV1 } from './redaxTeamAdminMetadataCanonical'
import type {
  RedaxTeamAdminMutationCampaignStatus,
  RedaxTeamAdminMutationIdentityRequest,
  RedaxTeamAdminMutationOperation,
  RedaxTeamAdminMutationUnsigned,
} from './redaxTeamAdminMutationIdentity'

// --- Public vocabulary ---------------------------------------------------------

/** Every way plan assembly declines. Value-free, closed and exhaustive. */
export type RedaxTeamAdminMutationPlanRefusalCode =
  | 'INPUT_INVALID'
  | 'OPERATION_UNKNOWN'
  | 'PRE_STATE_NOT_ADMISSIBLE'
  | 'SIGNER_TOPOLOGY_NOT_COLLAPSED'
  | 'DERIVATION_FAILED'
  | 'BUILD_FAILED'

/**
 * The chain facts an attempt observed BEFORE it planned anything.
 *
 * Supplied by the caller from a fresh authority-grade read, never invented here. This
 * module compares them against what the operation requires and refuses when they do not
 * admit it — which is what makes `predecessorStatus` in the identity a fact rather than
 * an assumption.
 */
export interface RedaxTeamAdminMutationObservedPreStateV1 {
  readonly campaignStatus: RedaxTeamAdminMutationCampaignStatus
  readonly metadataSetup: boolean
  readonly tokenConfigCount: number
  readonly campaignAdmin: string
  readonly outputMint: string
  /**
   * Was the operation's own target account observed ABSENT at that same read?
   *
   * `true` only for a positive absence observation. An UNREADABLE slot must arrive here
   * as `false`, because unreadable is not absent and a plan admitted on an unreadable
   * target would be a plan that assumed the thing it is about to create does not exist.
   * Operations that create nothing ignore it.
   */
  readonly targetAccountAbsent: boolean
}

/** The one signer topology the mutation corridor admits. */
export interface RedaxTeamAdminMutationTopologyV1 {
  readonly requiredWalletSignatureCount: 1
  readonly feePayer: string
  readonly collapsedTo: string
  readonly roles: readonly string[]
}

/** The account this operation creates, re-derived — or the explicit absence of one. */
export type RedaxTeamAdminMutationWitnessV1 =
  | { readonly kind: 'NONE' }
  | { readonly kind: 'TOKEN_CONFIG'; readonly address: string; readonly bump: number }
  | { readonly kind: 'METADATA'; readonly address: string }

/** What the chain had to look like for this plan to be admissible. */
export interface RedaxTeamAdminMutationExpectedPreStateV1 {
  readonly campaignStatusOneOf: readonly RedaxTeamAdminMutationCampaignStatus[]
  /** `null` when the operation does not constrain it. */
  readonly metadataSetup: boolean | null
  readonly targetAccountMustBeAbsent: boolean
  readonly tokenConfigCount: number
}

/**
 * What the chain must look like IMMEDIATELY after this exact mutation lands.
 *
 * "Immediately" is the operative word: a later legal mutation can move any of these, and
 * that case is the separate `LANDED_EXACT_BUT_POST_STATE_SUPERSEDED` classification
 * rather than a failure of this expectation.
 */
export interface RedaxTeamAdminMutationExpectedPostStateV1 {
  readonly campaignStatus: RedaxTeamAdminMutationCampaignStatus
  readonly metadataSetup: boolean
  readonly tokenConfigCount: number
  readonly createdAccount: string | null
}

/** One assembled mutation plan. It describes; it does not act. */
export interface RedaxTeamAdminMutationPlanV1 {
  readonly operation: RedaxTeamAdminMutationOperation
  /** Exactly the request the identity module hashes. Assembled here, never by a caller. */
  readonly identityRequest: RedaxTeamAdminMutationIdentityRequest
  readonly witness: RedaxTeamAdminMutationWitnessV1
  readonly topology: RedaxTeamAdminMutationTopologyV1
  /** The ONE REDAX program instruction. No `Transaction` is built here. */
  readonly instruction: TransactionInstruction
  /**
   * The fixed Team/Admin mutation ComputeBudget pair for THIS operation — limit, then
   * price — which the one transaction places BEFORE `instruction`. Fresh objects from
   * the one policy owner; never chosen here and never the Holder pair.
   */
  readonly computeBudgetInstructions: readonly [TransactionInstruction, TransactionInstruction]
  /** `1`, asserted rather than assumed, and proven by the structural tests. */
  readonly redaxInstructionCount: 1
  /** `2`: exactly the fixed pair above, and no other ComputeBudget instruction. */
  readonly computeBudgetInstructionCount: 2
  readonly expectedPreState: RedaxTeamAdminMutationExpectedPreStateV1
  readonly expectedImmediatePostState: RedaxTeamAdminMutationExpectedPostStateV1
}

export type RedaxTeamAdminMutationPlanResult =
  | { readonly ok: true; readonly plan: RedaxTeamAdminMutationPlanV1 }
  | { readonly ok: false; readonly code: RedaxTeamAdminMutationPlanRefusalCode }

/** The operation-specific inputs. Discriminated, closed, and exactly six members. */
export type RedaxTeamAdminMutationOperationRequest =
  | {
      readonly operation: 'ADD_TOKEN_CONFIG'
      readonly legacyMint: PublicKey
      readonly outputMint: PublicKey
      readonly rateNumerator: RedaxTeamAdminMutationUnsigned
      readonly rateDenominator: RedaxTeamAdminMutationUnsigned
      readonly maxOutputFromTokenConfig: RedaxTeamAdminMutationUnsigned
    }
  | {
      readonly operation: 'SETUP_METADATA'
      readonly outputMint: PublicKey
      /** Already canonical. This module never normalizes, bounds or hashes user text. */
      readonly metadata: RedaxTeamAdminCanonicalMetadataV1
    }
  | { readonly operation: 'ACTIVATE_CAMPAIGN' }
  | { readonly operation: 'PAUSE_CAMPAIGN' }
  | { readonly operation: 'UNPAUSE_CAMPAIGN' }
  | { readonly operation: 'FINALIZE_CAMPAIGN' }

/** Everything one plan is assembled from. */
export type RedaxTeamAdminMutationPlanRequest = {
  readonly programId: PublicKey
  /** The trusted approved-Team identity. Every signer role collapses to exactly this. */
  readonly approvedTeamWallet: PublicKey
  readonly campaign: PublicKey
  readonly observedPreState: RedaxTeamAdminMutationObservedPreStateV1
} & RedaxTeamAdminMutationOperationRequest

// --- Internals -----------------------------------------------------------------

/**
 * The program's own per-campaign TokenConfig ceiling, mirrored.
 *
 * `MAX_TOKEN_CONFIGS_PER_CAMPAIGN` in `programs/redax_protocol/src/constants.rs`, where
 * `add_token_config` requires `campaign.token_config_count < MAX_TOKEN_CONFIGS_PER_CAMPAIGN`
 * and otherwise fails with `TooManyTokenConfigs`. The bound is `<`, not `<=`, so a campaign
 * already holding this many admits no further config.
 */
const MAX_TOKEN_CONFIGS_PER_CAMPAIGN = 10

/**
 * A canonical unsigned value as a `bigint`, or `null` when it is not one.
 *
 * TOTAL. `BigInt()` throws on anything it cannot read, and a throw here would be this
 * module's only one; a negative value is likewise refused rather than coerced. Used ONLY to
 * decide zero-ness — the value carried into the identity is the caller's original, which
 * the identity module validates and canonicalizes for itself.
 */
function unsignedOrNull(value: RedaxTeamAdminMutationUnsigned): bigint | null {
  try {
    const parsed = typeof value === 'bigint' ? value : BigInt(value)
    return parsed < 0n ? null : parsed
  } catch {
    return null
  }
}

/** The exact status each lifecycle mutation targets. Written once, read twice. */
const LIFECYCLE_TARGET: Readonly<Record<string, RedaxTeamAdminMutationCampaignStatus>> =
  Object.freeze({
    ACTIVATE_CAMPAIGN: 'active',
    PAUSE_CAMPAIGN: 'paused',
    UNPAUSE_CAMPAIGN: 'active',
    FINALIZE_CAMPAIGN: 'finalized',
  })

/** The statuses each lifecycle mutation may legally start from. */
const LIFECYCLE_PREDECESSORS: Readonly<
  Record<string, readonly RedaxTeamAdminMutationCampaignStatus[]>
> = Object.freeze({
  ACTIVATE_CAMPAIGN: Object.freeze(['initialized'] as const),
  PAUSE_CAMPAIGN: Object.freeze(['active'] as const),
  UNPAUSE_CAMPAIGN: Object.freeze(['paused'] as const),
  // FINALIZE is the one with two admissible predecessors, and the identity records
  // WHICH one was actually observed rather than a set.
  FINALIZE_CAMPAIGN: Object.freeze(['active', 'paused'] as const),
})

/** Is this a plausible `PublicKey`-shaped value we can read a base58 string out of? */
function base58Of(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }
  const method = (value as { toBase58?: unknown }).toBase58
  if (typeof method !== 'function') {
    return null
  }
  try {
    const text = (method as (this: unknown) => unknown).call(value)
    return typeof text === 'string' && text.length > 0 ? text : null
  } catch {
    return null
  }
}

/**
 * Does EVERY declared signer role collapse to the approved Team wallet?
 *
 * The builder's own `signers` array is the subject, not the inputs that produced it: a
 * check against the inputs would be a check against itself. Any role naming a different
 * key means the compiled message would require a second signature, which the exact-one
 * corridor cannot express and must not attempt.
 */
function collapsesToApprovedTeam(
  signers: readonly RedaxSignerRequirement[],
  approved: string,
): boolean {
  if (signers.length === 0) {
    return false
  }
  for (const signer of signers) {
    if (base58Of(signer.pubkey) !== approved) {
      return false
    }
  }
  return true
}

/**
 * The fixed ComputeBudget pair for one already-admitted operation, or `null`.
 *
 * TOTAL: the policy owner throws for a name outside its closed table, and a throw here would
 * be this module's only one. A plan that cannot carry its pair is a plan that cannot be
 * built, so the caller refuses it as `BUILD_FAILED` — never a plan without the pair.
 */
function computeBudgetFor(
  operation: RedaxTeamAdminMutationOperation,
): readonly [TransactionInstruction, TransactionInstruction] | null {
  try {
    return buildRedaxTeamAdminMutationComputeBudgetInstructions(operation)
  } catch {
    return null
  }
}

function topologyOf(
  signers: readonly RedaxSignerRequirement[],
  approved: string,
): RedaxTeamAdminMutationTopologyV1 {
  return Object.freeze({
    requiredWalletSignatureCount: 1 as const,
    feePayer: approved,
    collapsedTo: approved,
    roles: Object.freeze(signers.map((signer) => signer.role)),
  })
}

// --- The one exported assembly ---------------------------------------------------

/**
 * Assemble one mutation plan, or refuse.
 *
 * THE ORDER IS THE ARGUMENT. Identities are read first, then the observed pre-state is
 * required to ADMIT the operation, then the instruction is built, then the builder's own
 * declared signers are required to collapse. Building before admitting would produce an
 * instruction for a mutation the chain does not allow, and a caller holding one is a
 * caller who might sign it.
 *
 * TOTAL AND VALUE-FREE: nothing throws, nothing is logged, and no refusal carries an
 * address, an amount or a fragment of user text.
 */
export function planRedaxTeamAdminMutation(
  request: RedaxTeamAdminMutationPlanRequest,
): RedaxTeamAdminMutationPlanResult {
  if (typeof request !== 'object' || request === null) {
    return { ok: false, code: 'INPUT_INVALID' }
  }
  const programId = base58Of(request.programId)
  const approved = base58Of(request.approvedTeamWallet)
  const campaign = base58Of(request.campaign)
  if (programId === null || approved === null || campaign === null) {
    return { ok: false, code: 'INPUT_INVALID' }
  }

  const pre = request.observedPreState
  if (
    typeof pre !== 'object' ||
    pre === null ||
    typeof pre.metadataSetup !== 'boolean' ||
    typeof pre.targetAccountAbsent !== 'boolean' ||
    typeof pre.campaignAdmin !== 'string' ||
    typeof pre.outputMint !== 'string' ||
    !Number.isSafeInteger(pre.tokenConfigCount) ||
    pre.tokenConfigCount < 0
  ) {
    return { ok: false, code: 'INPUT_INVALID' }
  }
  // The Campaign's own admin must ALREADY be the approved Team wallet. A plan whose
  // signer is not the account's admin is one the program would reject, and building it
  // would mean a wallet prompt for a transaction that cannot succeed.
  if (pre.campaignAdmin !== approved) {
    return { ok: false, code: 'PRE_STATE_NOT_ADMISSIBLE' }
  }

  const common = { programId, teamWallet: approved, campaign }

  switch (request.operation) {
    case 'ADD_TOKEN_CONFIG': {
      const legacyMint = base58Of(request.legacyMint)
      const outputMint = base58Of(request.outputMint)
      if (legacyMint === null || outputMint === null) {
        return { ok: false, code: 'INPUT_INVALID' }
      }
      // The mint the Campaign itself names, not one a caller supplied beside it.
      if (outputMint !== pre.outputMint) {
        return { ok: false, code: 'PRE_STATE_NOT_ADMISSIBLE' }
      }
      // A TokenConfig may be added while the Campaign is still being set up, and only
      // then: an Active, Paused or Finalized campaign is past the point where its
      // conversion terms may change.
      if (pre.campaignStatus !== 'initialized') {
        return { ok: false, code: 'PRE_STATE_NOT_ADMISSIBLE' }
      }
      // The target PDA must have been positively observed ABSENT. Unreadable arrives
      // here as `false`, and refusing is the whole point: a config that already exists
      // is a fulfilled identity, not a mutation to attempt again.
      if (!pre.targetAccountAbsent) {
        return { ok: false, code: 'PRE_STATE_NOT_ADMISSIBLE' }
      }
      // THE PROGRAM'S OWN CARDINALITY BOUND, ENFORCED BEFORE THE WALLET IS ASKED.
      // `add_token_config` requires `token_config_count < MAX_TOKEN_CONFIGS_PER_CAMPAIGN`
      // and otherwise fails `TooManyTokenConfigs`. Admitting a plan at or above it would
      // mean a wallet prompt, a signature and a fee for a transaction the program is
      // already known to reject. This is a PRE-STATE fact, so it is refused as one — and
      // the count is a validated non-negative safe integer above, so a hostile observation
      // beyond the ceiling is refused by the same comparison rather than by a second rule.
      if (pre.tokenConfigCount >= MAX_TOKEN_CONFIGS_PER_CAMPAIGN) {
        return { ok: false, code: 'PRE_STATE_NOT_ADMISSIBLE' }
      }
      // THE PROGRAM'S RATE SANITY, LIKEWISE. `require!(rate_numerator != 0)` and
      // `require!(rate_denominator != 0)` both fail `InvalidRate`, and a zero denominator
      // is additionally a conversion rate no quote could ever use. These are properties of
      // the REQUEST rather than of the chain, so they refuse as `INPUT_INVALID`. Neither
      // value is echoed, and nothing is coerced, clamped or defaulted.
      const numerator = unsignedOrNull(request.rateNumerator)
      const denominator = unsignedOrNull(request.rateDenominator)
      if (numerator === null || denominator === null || numerator === 0n || denominator === 0n) {
        return { ok: false, code: 'INPUT_INVALID' }
      }

      let tokenConfig: string
      let tokenConfigBump: number
      try {
        const derived = deriveTokenConfigPda(request.programId, request.campaign, request.legacyMint)
        tokenConfig = derived.pda.toBase58()
        tokenConfigBump = derived.bump
      } catch {
        return { ok: false, code: 'DERIVATION_FAILED' }
      }

      let built: ReturnType<typeof buildAddTokenConfigInstruction>
      try {
        built = buildAddTokenConfigInstruction({
          programId: request.programId,
          payer: request.approvedTeamWallet,
          campaignAdmin: request.approvedTeamWallet,
          campaign: request.campaign,
          legacyMint: request.legacyMint,
          outputMint: request.outputMint,
          rateNumerator: BigInt(request.rateNumerator),
          rateDenominator: BigInt(request.rateDenominator),
          maxOutputFromTokenConfig: BigInt(request.maxOutputFromTokenConfig),
        })
      } catch {
        return { ok: false, code: 'BUILD_FAILED' }
      }
      if (built.tokenConfig.toBase58() !== tokenConfig) {
        // The builder derives the same PDA independently. A disagreement means one of
        // the two derivations is about different seeds, and neither may be trusted.
        return { ok: false, code: 'DERIVATION_FAILED' }
      }
      if (!collapsesToApprovedTeam(built.signers, approved)) {
        return { ok: false, code: 'SIGNER_TOPOLOGY_NOT_COLLAPSED' }
      }
      const computeBudget = computeBudgetFor('ADD_TOKEN_CONFIG')
      if (computeBudget === null) {
        return { ok: false, code: 'BUILD_FAILED' }
      }

      return {
        ok: true,
        plan: Object.freeze({
          operation: 'ADD_TOKEN_CONFIG' as const,
          identityRequest: Object.freeze({
            ...common,
            operation: 'ADD_TOKEN_CONFIG' as const,
            legacyMint,
            rateNumerator: request.rateNumerator,
            rateDenominator: request.rateDenominator,
            maxOutputFromTokenConfig: request.maxOutputFromTokenConfig,
          }),
          witness: Object.freeze({
            kind: 'TOKEN_CONFIG' as const,
            address: tokenConfig,
            bump: tokenConfigBump,
          }),
          topology: topologyOf(built.signers, approved),
          instruction: built.instruction,
          computeBudgetInstructions: computeBudget,
          redaxInstructionCount: 1 as const,
          computeBudgetInstructionCount: 2 as const,
          expectedPreState: Object.freeze({
            campaignStatusOneOf: Object.freeze(['initialized'] as const),
            metadataSetup: null,
            targetAccountMustBeAbsent: true,
            tokenConfigCount: pre.tokenConfigCount,
          }),
          expectedImmediatePostState: Object.freeze({
            campaignStatus: 'initialized' as const,
            metadataSetup: pre.metadataSetup,
            tokenConfigCount: pre.tokenConfigCount + 1,
            createdAccount: tokenConfig,
          }),
        }),
      }
    }

    case 'SETUP_METADATA': {
      const outputMint = base58Of(request.outputMint)
      if (outputMint === null) {
        return { ok: false, code: 'INPUT_INVALID' }
      }
      if (outputMint !== pre.outputMint) {
        return { ok: false, code: 'PRE_STATE_NOT_ADMISSIBLE' }
      }
      const metadata = request.metadata
      if (
        typeof metadata !== 'object' ||
        metadata === null ||
        typeof metadata.name !== 'object' ||
        typeof metadata.symbol !== 'object' ||
        typeof metadata.uri !== 'object'
      ) {
        return { ok: false, code: 'INPUT_INVALID' }
      }
      // Metadata is ONCE-ONLY and IMMUTABLE on chain. Both halves of the pre-state must
      // agree that it has not happened: the Campaign's own flag, and a positive absence
      // observation of the canonical account.
      if (pre.metadataSetup) {
        return { ok: false, code: 'PRE_STATE_NOT_ADMISSIBLE' }
      }
      if (!pre.targetAccountAbsent) {
        return { ok: false, code: 'PRE_STATE_NOT_ADMISSIBLE' }
      }
      if (pre.campaignStatus !== 'initialized') {
        return { ok: false, code: 'PRE_STATE_NOT_ADMISSIBLE' }
      }

      let metadataAccount: string
      try {
        metadataAccount = deriveOutputTokenMetadataPda(request.outputMint).pda.toBase58()
      } catch {
        return { ok: false, code: 'DERIVATION_FAILED' }
      }

      let built: ReturnType<typeof buildSetupMetadataInstruction>
      try {
        built = buildSetupMetadataInstruction({
          programId: request.programId,
          payer: request.approvedTeamWallet,
          campaignAdmin: request.approvedTeamWallet,
          campaign: request.campaign,
          outputMint: request.outputMint,
          // The CANONICAL strings, exactly as canonicalization produced them. This module
          // does not normalize, trim, bound or re-encode them, and could not: it holds no
          // encoder and no normalizer.
          name: metadata.name.value,
          symbol: metadata.symbol.value,
          uri: metadata.uri.value,
        })
      } catch {
        // The builder enforces the program's byte bounds itself and throws a RangeError
        // outside them. Canonicalization already refused those, so reaching here means
        // the two disagree — which is a build failure, never a silent trim.
        return { ok: false, code: 'BUILD_FAILED' }
      }
      if (built.metadataAccount.toBase58() !== metadataAccount) {
        return { ok: false, code: 'DERIVATION_FAILED' }
      }
      if (!collapsesToApprovedTeam(built.signers, approved)) {
        return { ok: false, code: 'SIGNER_TOPOLOGY_NOT_COLLAPSED' }
      }
      const computeBudget = computeBudgetFor('SETUP_METADATA')
      if (computeBudget === null) {
        return { ok: false, code: 'BUILD_FAILED' }
      }

      return {
        ok: true,
        plan: Object.freeze({
          operation: 'SETUP_METADATA' as const,
          identityRequest: Object.freeze({
            ...common,
            operation: 'SETUP_METADATA' as const,
            nameSha256Hex: metadata.name.sha256Hex,
            nameByteLength: metadata.name.byteLength,
            symbolSha256Hex: metadata.symbol.sha256Hex,
            symbolByteLength: metadata.symbol.byteLength,
            uriSha256Hex: metadata.uri.sha256Hex,
            uriByteLength: metadata.uri.byteLength,
          }),
          witness: Object.freeze({ kind: 'METADATA' as const, address: metadataAccount }),
          topology: topologyOf(built.signers, approved),
          instruction: built.instruction,
          computeBudgetInstructions: computeBudget,
          redaxInstructionCount: 1 as const,
          computeBudgetInstructionCount: 2 as const,
          expectedPreState: Object.freeze({
            campaignStatusOneOf: Object.freeze(['initialized'] as const),
            metadataSetup: false,
            targetAccountMustBeAbsent: true,
            tokenConfigCount: pre.tokenConfigCount,
          }),
          expectedImmediatePostState: Object.freeze({
            campaignStatus: 'initialized' as const,
            metadataSetup: true,
            tokenConfigCount: pre.tokenConfigCount,
            createdAccount: metadataAccount,
          }),
        }),
      }
    }

    case 'ACTIVATE_CAMPAIGN':
    case 'PAUSE_CAMPAIGN':
    case 'UNPAUSE_CAMPAIGN':
    case 'FINALIZE_CAMPAIGN': {
      const admissible = LIFECYCLE_PREDECESSORS[request.operation]
      const target = LIFECYCLE_TARGET[request.operation]
      if (admissible === undefined || target === undefined) {
        return { ok: false, code: 'OPERATION_UNKNOWN' }
      }
      if (!admissible.includes(pre.campaignStatus)) {
        return { ok: false, code: 'PRE_STATE_NOT_ADMISSIBLE' }
      }
      // `metadata_setup` IS A PROGRAM REQUIREMENT AND A PRODUCT REQUIREMENT BOTH.
      //
      // `activate_campaign` in `programs/redax_protocol/` requires `campaign.metadata_setup`
      // and fails without it; the other three lifecycle mutations require nothing of it.
      // Checking it here is therefore MIRRORING the program's own precondition before a
      // wallet is asked — the product is NOT "stronger than the program" on this fact, and
      // an earlier reading of this comment that said so was wrong about the program.
      if (request.operation === 'ACTIVATE_CAMPAIGN' && !pre.metadataSetup) {
        return { ok: false, code: 'PRE_STATE_NOT_ADMISSIBLE' }
      }
      // PROGRAM: `activate_campaign` has NO `token_config_count` guard at all. A campaign
      // with zero accepted inputs activates perfectly well on chain, and this module cannot
      // and does not claim otherwise.
      //
      // REDAX PRODUCT: activation is admitted only from `token_config_count >= 1`. An
      // active campaign that accepts nothing is a campaign holders can see and cannot use,
      // and `add_token_config` requires the `initialized` status — so activating first
      // means the terms can never be added afterwards. The prerequisite is a PRODUCT
      // decision about an irreversible one-way step, stated as one.
      //
      // IT IS AN ADMISSION RULE DECIDED HERE, ONCE, against the Phase-A authority-grade
      // pre-state — never against loaded product data and never against a caller input.
      // No new refusal code is minted for it: an operation the observed pre-state does not
      // admit is exactly what `PRE_STATE_NOT_ADMISSIBLE` already names. The count is a
      // validated non-negative safe integer above, so a hostile observation is refused by
      // the same comparison rather than by a second rule.
      if (request.operation === 'ACTIVATE_CAMPAIGN' && pre.tokenConfigCount < 1) {
        return { ok: false, code: 'PRE_STATE_NOT_ADMISSIBLE' }
      }

      let built: {
        instruction: TransactionInstruction
        signers: readonly RedaxSignerRequirement[]
      }
      try {
        if (request.operation === 'ACTIVATE_CAMPAIGN') {
          built = buildActivateCampaignInstruction({
            programId: request.programId,
            campaign: request.campaign,
            campaignAdmin: request.approvedTeamWallet,
          })
        } else if (request.operation === 'UNPAUSE_CAMPAIGN') {
          built = buildUnpauseCampaignInstruction({
            programId: request.programId,
            campaign: request.campaign,
            campaignAdmin: request.approvedTeamWallet,
          })
        } else if (request.operation === 'FINALIZE_CAMPAIGN') {
          built = buildFinalizeCampaignInstruction({
            programId: request.programId,
            campaign: request.campaign,
            campaignAdmin: request.approvedTeamWallet,
          })
        } else {
          // PAUSE. The program would also accept the protocol emergency-pause authority
          // here; the browser product may only ever be the campaign admin, so the
          // approved Team wallet is what fills `authority` and nothing else can.
          built = buildPauseCampaignInstruction({
            programId: request.programId,
            campaign: request.campaign,
            authority: request.approvedTeamWallet,
          })
        }
      } catch {
        return { ok: false, code: 'BUILD_FAILED' }
      }
      if (!collapsesToApprovedTeam(built.signers, approved)) {
        return { ok: false, code: 'SIGNER_TOPOLOGY_NOT_COLLAPSED' }
      }
      const computeBudget = computeBudgetFor(request.operation)
      if (computeBudget === null) {
        return { ok: false, code: 'BUILD_FAILED' }
      }

      const identityRequest: RedaxTeamAdminMutationIdentityRequest =
        request.operation === 'PAUSE_CAMPAIGN'
          ? Object.freeze({
              ...common,
              operation: 'PAUSE_CAMPAIGN' as const,
              predecessorStatus: pre.campaignStatus,
              targetStatus: target,
              authorityRole: 'campaign_admin' as const,
            })
          : Object.freeze({
              ...common,
              operation: request.operation,
              predecessorStatus: pre.campaignStatus,
              targetStatus: target,
            })

      return {
        ok: true,
        plan: Object.freeze({
          operation: request.operation,
          identityRequest,
          witness: Object.freeze({ kind: 'NONE' as const }),
          topology: topologyOf(built.signers, approved),
          instruction: built.instruction,
          computeBudgetInstructions: computeBudget,
          redaxInstructionCount: 1 as const,
          computeBudgetInstructionCount: 2 as const,
          expectedPreState: Object.freeze({
            campaignStatusOneOf: admissible,
            metadataSetup: request.operation === 'ACTIVATE_CAMPAIGN' ? true : null,
            targetAccountMustBeAbsent: false,
            tokenConfigCount: pre.tokenConfigCount,
          }),
          expectedImmediatePostState: Object.freeze({
            campaignStatus: target,
            metadataSetup: pre.metadataSetup,
            tokenConfigCount: pre.tokenConfigCount,
            createdAccount: null,
          }),
        }),
      }
    }

    default:
      // Outside the closed six. Unreachable through the type; refused for callers the
      // type system never saw.
      return { ok: false, code: 'OPERATION_UNKNOWN' }
  }
}
