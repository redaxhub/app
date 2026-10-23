// -----------------------------------------------------------------------------
// WHAT THIS FILE IS
// -----------------------------------------------------------------------------
// The SECOND Team/Admin integration root, and the SECOND Team/Admin raw-send owner. It
// owns the whole post-init mutation corridor for the six operations — `add_token_config`,
// `setup_metadata`, `activate_campaign`, `pause_campaign`, `unpause_campaign`,
// `finalize_campaign` — and it is the ONLY place in `app/src` where a post-init mutation
// can be signed or broadcast.
//
// It is the ONLY Team/Admin mutation `new Connection(`, the ONLY Team/Admin mutation
// `new Transaction(`, and it holds EXACTLY ONE executable `sendRawTransaction` call. The
// S1 action root `app/src/teamAdmin/RedaxTeamAdminActions.tsx` keeps its own exact-one raw
// send, its own exact-two signer corridor, its own `Keypair.generate` and its own
// `partialSign`, and NOTHING here can reach any of them.
//
// A PRODUCT IMPORTER IS NOT AN OPERATION CONSUMER, and ALL SIX operations are now exposed:
// `add_token_config`, `setup_metadata` and `activate_campaign` one per panel, and the three
// lifecycle steps `pause_campaign`, `unpause_campaign` and `finalize_campaign` together on
// the fourth. `TEN VISIBLE MUTATION-ACTION CONTROLS` exist across the four — two, two, two
// and four — and no panel can reach an operation another one owns. The choreography below
// admits all six, and the product now offers all six. NONE OF THAT IS LIVE EXECUTION.
//
// THIS ROOT NOW PERFORMS TWO BALANCE-MODEL READS IT DID NOT BEFORE —
// `getMinimumBalanceForRentExemption` and `getBalanceAndContext`, both `confirmed`, and both
// only where an explicit call reaches them. The context-free balance RPC remains forbidden,
// and the dynamic compiled-message fee RPC remains outside `app/src` entirely. The
// `new Connection(` construction SITES here rise from two to three — attempt-scoped,
// reconciliation-scoped, and the passive C1 read-only one — while the Connection OWNER FILE
// count is unchanged: this file is still the ONLY Team/Admin mutation `new Connection(`, and
// neither chain guard constructs one or performs a balance or rent read.
//
// There is NO `useEffect`, NO `useLayoutEffect`, NO `setTimeout`, NO `setInterval`, NO
// `requestAnimationFrame`, NO `queueMicrotask`, NO event listener and NO subscription in
// this file. Nothing here runs on import, on render, on mount, on wallet connect, on
// disconnect, on selection change or on a timer. All FOUR entry points run only when
// something calls them, and the two that can write run only from an explicit click.
//
// -----------------------------------------------------------------------------
// THE POINT OF NO RETURN IS THE RAW SEND
// -----------------------------------------------------------------------------
// `TEAM_ADMIN_MUTATION_POINT_OF_NO_RETURN = RAW_SEND_INVOCATION` — the executable call to
// `Connection.sendRawTransaction`, and nothing else. The wallet prompt is NOT it. The
// wallet-sign invocation is NOT it. The returned wire, its verification, the locally
// derived signature and both durable markers are all strictly BEFORE it.
//
// The order below is the security argument, not a style. Every guard runs before the thing
// it protects can exist: no plan before the chain is proven, no message before the plan, no
// durable record before the message, no wallet request before Phase B, no marker before the
// artifact is verified and the chain re-asserted, no retained signature before the marker is
// READ BACK, and NO BROADCAST before both are. Past the send there is exactly one
// observation and, where evidence determines one, exactly one durable terminal — with no
// retry, no resend, no rebuild, no second prompt and no fallback anywhere below it.
//
// -----------------------------------------------------------------------------
// THE PRE-STATE THE PLAN WAS ADMITTED AGAINST IS RE-ASSERTED, TWICE
// -----------------------------------------------------------------------------
// Phase A returns the FRESH Campaign body, and the plan below is admitted against exactly
// it. The guard FREEZES the operation-specific admission footprint at that moment — the
// Campaign status, `metadataSetup`, `tokenConfigCount` and the operation's own target
// account presence — and re-asserts that exact footprint on BOTH later reads, at Phase B
// and again post-wallet, from re-fetched bytes rather than from anything remembered here.
//
// So a Campaign that was activated, paused, finalized, given its metadata or given a
// TokenConfig while this attempt was in flight refuses BEFORE the wallet prompt where the
// change is visible at Phase B, and BEFORE the pre-raw-send marker and the one raw send
// where it only becomes visible afterwards. This file computes none of that and cannot
// weaken it: the footprint lives in the guard's private per-attempt state, keyed by the
// opaque snapshot, and no value here participates in the comparison.

import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Connection, PublicKey, Transaction } from '@solana/web3.js'

import { resolveRedaxRuntimeActionConfig } from '../data/redaxDataSourceProvider'
import {
  deriveTokenConfigPda,
  readRedaxClassicMintFactsWithContext,
  readRedaxTeamAdminMutationCoherentStateWithContext,
} from '../data/devnet/redaxDevnetAccounts'
import { computeRedaxTeamAdminMutationRequiredLamports } from './redaxTeamAdminMutationSolModel'
import type {
  RedaxClassicMintFactsReadResult,
  RedaxTeamAdminMutationCoherentObservationV1,
} from '../data/devnet/redaxDevnetAccounts'
import {
  assessRedaxTeamAdminMutationPostState,
  type RedaxMutationCoherentObservationV1,
  type RedaxMutationExpectationV1,
  type RedaxMutationPostStateV1,
  type RedaxMutationTransactionAttestationV1,
} from '../data/devnet/redaxDevnetMutationPostState'
import {
  commitRedaxIntendedLegacyMessage,
  observeRedaxKnownSignatureOutcome,
  retainRedaxKnownSignature,
  type RedaxKnownSignature,
} from '../wallet/redaxTransactionOutcome'
import { useRedaxTeamAdminMutationSignOnlyBroker } from '../wallet/RedaxWalletProvider'
import type { RedaxTeamAdminMutationSignOnlyBroker } from '../wallet/RedaxWalletProvider'
import {
  canonicalizeRedaxTeamAdminMetadata,
  expectedRedaxTeamAdminPuffedMetadata,
} from './redaxTeamAdminMetadataCanonical'
import {
  bindRedaxTeamAdminMutationSolPreflightContextFloor,
  checkRedaxTeamAdminMutationGuardPhaseA,
  checkRedaxTeamAdminMutationGuardPhaseB,
  fetchRedaxTeamAdminMutationAttemptBlockhash,
  reassertRedaxTeamAdminMutationGuardAfterWallet,
  type RedaxTeamAdminMutationAddMintPreflight,
  type RedaxTeamAdminMutationFrozenPlanIdentity,
  type RedaxTeamAdminMutationGuardRuntime,
  type RedaxTeamAdminMutationGuardTarget,
} from './redaxTeamAdminMutationChainGuard'
import { computeRedaxTeamAdminMutationIdentity } from './redaxTeamAdminMutationIdentity'
import type { RedaxTeamAdminMutationOperation } from './redaxTeamAdminMutationIdentity'
import {
  beginRedaxTeamAdminMutationAttempt,
  readRedaxTeamAdminMutationJournal,
  transitionRedaxTeamAdminMutationAttempt,
  type RedaxTeamAdminMutationIssueCode,
  type RedaxTeamAdminMutationNamespace,
  type RedaxTeamAdminMutationObservation,
  type RedaxTeamAdminMutationReadResult,
  type RedaxTeamAdminMutationRecordV1,
  type RedaxTeamAdminMutationRequestFactsV1,
  type RedaxTeamAdminMutationResolution,
  type RedaxTeamAdminMutationWitnessFactsV1,
} from './redaxTeamAdminMutationJournal'
import {
  planRedaxTeamAdminMutation,
  type RedaxTeamAdminMutationObservedPreStateV1,
  type RedaxTeamAdminMutationPlanRequest,
} from './redaxTeamAdminMutationPlan'
import {
  commitRedaxTeamAdminMutationIntendedLegacyMessage,
  verifyRedaxTeamAdminMutationSignedWire,
} from './redaxTeamAdminMutationSignedWire'

// --- Capability literals -------------------------------------------------------

/**
 * What this root can do, as a literal a reader and a test can both pin.
 */
export const REDAX_TEAM_ADMIN_MUTATION_TRANSACTION_CAPABILITY =
  'PROVIDER_MOUNTED_DEPLOY_CONFIG_IDENTITY_GATED_VISIBLE_ADD_TOKEN_CONFIG_AND_SETUP_METADATA_AND_ACTIVATE_CAMPAIGN_AND_PAUSE_CAMPAIGN_AND_UNPAUSE_CAMPAIGN_AND_FINALIZE_CAMPAIGN_ACTIONS_POST_INIT_MUTATION_SIGN_VERIFY_SEND_RECONCILE' as const

/**
 * `1` means there is exactly ONE raw-send owner and exactly ONE executable raw-send call
 * IN THIS FILE — never that one has been performed.
 */
export const REDAX_TEAM_ADMIN_MUTATION_RAW_BROADCAST_CAPABILITY = 1 as const

/** Phase 1 mutates exactly one cluster. */
const REDAX_TEAM_ADMIN_MUTATION_JOURNAL_CLUSTER = 'devnet' as const

/** Every read this attempt performs is `confirmed`; only attribution reads are finalized. */
const REDAX_TEAM_ADMIN_MUTATION_ACTION_COMMITMENT = 'confirmed' as const

// --- The post-init mutation devnet SOL preflight cost model --------------------------
//
// SIX OPERATIONS, SIX THRESHOLDS, ONE FORMULA AUTHORITY. Each operation is priced from
// the accounts IT allocates plus one fee bound, and nothing else. These are CONSERVATIVE
// PRODUCT BOUNDS — never protocol constants, never fee oracle results, and never a promise
// that a later transaction will succeed. The program and the runtime remain the authority
// on whether a transaction can pay for itself; this only stops asking an operator to
// approve one that provably cannot.

/**
 * WHAT IT COVERS, from this source rather than from memory: every post-init mutation
 * carries EXACTLY ONE signature — the approved Team wallet — and exactly ZERO Team/Admin
 * ComputeBudget instructions, so no priority fee is set by this corridor at all. At the
 * current base rate that is `5000` lamports, and this bound is twice it.
 *
 * IT IS THIS CORRIDOR'S OWN AUTHORITY. The Holder corridor's bound is numerically equal
 * TODAY and is a SEPARATE decision about a different transaction shape; this constant is
 * declared locally and is deliberately NOT an import, an alias or a re-export of it, so
 * changing one can never silently change the other.
 */
const TEAM_ADMIN_MUTATION_SOL_PREFLIGHT_FEE_BOUND_LAMPORTS = 10000

/** A payer system account carries no data, so its rent floor is the zero-length minimum. */
const REDAX_TEAM_ADMIN_MUTATION_PAYER_ACCOUNT_DATA_LENGTH = 0

/**
 * The TokenConfig PDA's allocation, in bytes: `8 + TokenConfig::INIT_SPACE` = `8 + 147` = `155`.
 */
const REDAX_TOKEN_CONFIG_ACCOUNT_SPACE = 155

// --- The external Metaplex Token Metadata cost model, and its TWO-LAYER provenance ---
//
// THERE ARE TWO SEPARATE FACTS HERE, AND THEY MUST NEVER BE COLLAPSED INTO ONE.
//
//   LAYER 1 — `REDAX_MPL_TOKEN_METADATA_SDK_PIN`. The REDAX workspace Cargo dependency
//   `mpl-token-metadata = "5.1.1"` is the SDK / generated CPI-CLIENT pin that REDAX source
//   builds against. It fixes the instruction encoding this repository emits. It is NOT, by
//   itself, proof of the deployed Metaplex runtime program's code, and it prices nothing:
//   no number below is derived from it. It is deliberately NOT restated as a constant here,
//   because a documentary constant nothing consumes is exactly what invited the mislabel.
//
//     A  programs/token-metadata/program/src/state/metadata.rs
//        blob a3068f4ed0de82b0b329338e39c6042e50a2a19a   -> MAX_METADATA_LEN  = 607
//     B  programs/token-metadata/program/src/state/fee.rs
//        blob ed50c20b89a82f3dc28b9ad17e97447afde4caa7   -> CREATE_FEE_SCALAR = 1308
//                                                        -> CREATE_FEE_OFFSET = 5440
//        get_create_fee() = Rent::get()?.minimum_balance(CREATE_FEE_SCALAR)
//                           + CREATE_FEE_OFFSET, with CHECKED addition
//     C  programs/token-metadata/program/src/utils/fee.rs
//        blob c7b2d8f7ea6f65308d382c457230a01101131705   -> the levy the payer funds:
//        fee = get_create_fee() + rent.minimum_balance(MAX_METADATA_LEN), transferred from
//        the PAYER to the metadata account BEFORE that account is created
//     D  programs/token-metadata/program/src/processor/metadata/
//          create_medatata_accounts_v3.rs
//        (the upstream filename is literally `create_medatata_accounts_v3.rs`)
//        blob 639d74a0bccc952e3138a85d159e1a666ad07e41   -> levy(...) THEN
//        process_create_metadata_accounts_logic(...) THEN set_fee_flag(...)
//
//   REDAX's `setup_metadata` Rust handler uses `CreateMetadataAccountV3CpiBuilder`, so the
//   static model below is audited against exactly that upstream processor source.
//
// THESE ARE CLIENT-SIDE PREFLIGHT INPUTS ONLY. They change no REDAX protocol behaviour, no
// instruction, no account schema, no PDA derivation and no economics. They decide one thing:
// whether this product asks an operator to approve a metadata transaction.

/**
 * `MAX_METADATA_LEN` — the allocation `CreateMetadataAccountV3` rents, in bytes.
 *
 * FROM UPSTREAM RUNTIME SOURCE `state/metadata.rs` AT REVISION
 * `a7ee5e17ed60feaafeaa5582a4f46d9317c1b412` (Authority A above) — not from the SDK pin, not
 * from a guess, and NOT from a serialized `DataV2` length. The last distinction matters: the
 * runtime rents a FIXED MAXIMUM regardless of how short the submitted name, symbol and URI
 * are, so pricing this account from the bytes a particular request happens to carry would
 * understate the requirement for every request. The runtime's own arithmetic is
 *
 *   MAX_DATA_SIZE   = 4+32 + 4+10 + 4+200 + 2 + 1 + 4 + (5 * 34)              = 431
 *   MAX_METADATA_LEN = 1 + 32 + 32 + 431 + 1 + 1 + 9 + 2 + 34 + 18 + 10 + 35 + 1 = 607
 *
 * over `MAX_NAME_LENGTH = 32`, `MAX_SYMBOL_LENGTH = 10`, `MAX_URI_LENGTH = 200`,
 * `MAX_CREATOR_LIMIT = 5` and `MAX_CREATOR_LEN = 34`.
 *
 * IT IS FIXED, so metadata field text is NOT a cost dimension: editing a name, a symbol or
 * a URI cannot change this threshold, and must therefore never trigger a repeated read.
 */
const METADATA_ACCOUNT_SPACE = 607

/**
 * `CREATE_FEE_SCALAR` — the byte length whose rent-exempt minimum forms the create fee's
 * scaling term.
 *
 * FROM UPSTREAM RUNTIME SOURCE `state/fee.rs` AT THE SAME AUDITED REVISION (Authority B),
 * and not from the SDK pin. That source defines
 * `get_create_fee() = rent.minimum_balance(CREATE_FEE_SCALAR) + CREATE_FEE_OFFSET`, and
 * `utils/fee.rs` (Authority C) levies `get_create_fee() + rent.minimum_balance(
 * MAX_METADATA_LEN)` from the PAYER before the account is created. So this is a SECOND,
 * INDEPENDENT rent read at a different byte length — not a duplicate of the `607` one, and
 * not interchangeable with it.
 */
const METAPLEX_CREATE_FEE_SCALAR_SPACE = 1308

/**
 * `CREATE_FEE_OFFSET` — the flat lamport term of the Metaplex create fee, from upstream
 * runtime source `state/fee.rs` at the same audited revision (Authority B).
 *
 * `5440` IS NOT A REDAX PROTOCOL FEE, and must never be described as one. It is an EXTERNAL
 * Metaplex Token Metadata constant, charged by that program to itself.
 */
const METAPLEX_CREATE_FEE_OFFSET_LAMPORTS = 5440

/**
 * THE FLAT METAPLEX CREATE FEE OBSERVED ON THE DEPLOYED DEVNET RUNTIME — 0.01 SOL.
 *
 * WHY THE AUDITED FORMULA ALONE IS NOT ENOUGH (demo customer flow, 2026-10-22). The audited
 * source prices the create fee as `rent(1308) + 5440`, which was exactly 10,000,000 lamports
 * at the old 6,960-lamport-per-byte rent rate. Devnet rent is now lower, so that formula
 * yields LESS than 0.01 SOL — while a recorded no-send simulation against the deployed
 * Metaplex program (2026-10-21) levied a FLAT 10,000,000 lamports plus `rent(607)`. The
 * preflight therefore said "sufficient" for a payer in the gap between the two, and the
 * transaction would then fail on chain.
 *
 * THE CORRECTION TAKES THE LARGER OF THE TWO, so neither the audited source nor the observed
 * deployed behaviour can be under-funded. It is a CLIENT-SIDE PREFLIGHT ESTIMATE, labelled as
 * an estimate in the product; it changes no REDAX instruction, account, PDA or economics,
 * and it is not a claim about the deployed program's code — the deployed-runtime attestation
 * stays a separate, mandatory step before a bounded operation.
 */
const METAPLEX_OBSERVED_FLAT_CREATE_FEE_LAMPORTS = 10_000_000n

// The u64 ceiling every lamport sum is checked against now lives in the pure SOL model
// (`redaxTeamAdminMutationSolModel.ts`), which performs every lamport sum for this root.

/**
 * What ONE post-init mutation preflight concluded, and nothing else.
 *
 * A bare string union rather than a record, so there is no member a lamport amount, a
 * threshold, a rent figure, a context slot, a Campaign address, an endpoint, a provider
 * name, a wallet address or a raw error could be carried out in — not by convention, but
 * because the type has nowhere to put one.
 */
export type RedaxTeamAdminMutationSolPreflightResult =
  | 'SUFFICIENT'
  | 'INSUFFICIENT'
  | 'READ_UNAVAILABLE'

/** What ONE observation saw INTERNALLY. Only the estimate member below exposes amounts. */
type RedaxTeamAdminMutationSolPreflightObservation =
  | {
      readonly result: 'SUFFICIENT' | 'INSUFFICIENT'
      readonly balanceContextSlot: number
      readonly requiredLamports: bigint
      readonly balanceLamports: bigint
    }
  | { readonly result: 'READ_UNAVAILABLE' }

/**
 * THE DISPLAYED SOL ESTIMATE for one operation: the verdict, the estimated lamports the
 * operation needs (rent floors, the fee bound and, for metadata, the Metaplex create fee
 * model above) and the connected Team wallet's observed balance. Decimal strings, or `null`
 * when unknown. DISPLAY ONLY — never authority; `submitMutation` re-observes regardless.
 *
 * The earlier "a bare verdict and nothing else" reading of the preflight surface is
 * superseded for this one member (demo customer flow, 2026-10-22): a person who is told a
 * balance is insufficient must be able to see by how much.
 */
export interface RedaxTeamAdminMutationSolEstimate {
  readonly result: RedaxTeamAdminMutationSolPreflightResult
  readonly requiredLamports: string | null
  readonly availableLamports: string | null
}

const REDAX_TEAM_ADMIN_MUTATION_SOL_PREFLIGHT_UNAVAILABLE: RedaxTeamAdminMutationSolPreflightObservation =
  { result: 'READ_UNAVAILABLE' }

// --- Public request vocabulary --------------------------------------------------

/**
 * ONE submit entry point, discriminated by operation — not six.
 *
 * A six-method surface would be six places to keep the choreography in step, and the first
 * time they drifted one operation would be guarded less than the others. Amounts are
 * CANONICAL DECIMAL STRINGS rather than numbers, because `u128` exceeds the safe-integer
 * range and a silent precision loss in a rate would be a silently wrong campaign.
 */
export type RedaxTeamAdminMutationRequest =
  | {
      readonly operation: 'ADD_TOKEN_CONFIG'
      readonly campaign: string
      readonly outputMint: string
      readonly legacyMint: string
      readonly rateNumerator: string
      readonly rateDenominator: string
      readonly maxOutputFromTokenConfig: string
      /**
       * THEY ARE NOT INSTRUCTION ARGUMENTS. The canonical `add_token_config` builder takes
       * exactly `rateNumerator`, `rateDenominator` and `maxOutputFromTokenConfig`, and it
       * still does: the program reads the real mints itself and stores THEIR decimals, so a
       * number supplied here could never change what the account ends up holding.
       *
       * THEY ARE NOT IDENTITY. They are not mutation-identity dimensions, not TokenConfig
       * PDA seeds, not journal request-identity facts and not status-projection fields —
       * `requestFactsFor` below has no member for either of them, and adding one would make
       * two attempts with the same terms and different expectations two different attempts.
       *
       * What they ARE is the expectation the authority-grade guard refuses against before a
       * wallet is asked, so a Token-2022, malformed, uninitialized or simply wrong mint
       * cannot reach a prompt.
       */
      readonly expectedLegacyDecimals: number
      readonly expectedOutputDecimals: number
    }
  | {
      readonly operation: 'SETUP_METADATA'
      readonly campaign: string
      readonly outputMint: string
      readonly metadataName: string
      readonly metadataSymbol: string
      readonly metadataUri: string
    }
  | { readonly operation: 'ACTIVATE_CAMPAIGN'; readonly campaign: string }
  | { readonly operation: 'PAUSE_CAMPAIGN'; readonly campaign: string }
  | { readonly operation: 'UNPAUSE_CAMPAIGN'; readonly campaign: string }
  | { readonly operation: 'FINALIZE_CAMPAIGN'; readonly campaign: string }

/**
 * Every way `submitMutation` can end. Closed, exhaustive and value-free.
 *
 * The two internal-failure codes are deliberately named for THIS corridor and share no
 * substring with the S1 root's `PRE_BROADCAST_INTERNAL_FAILURE` /
 * `POST_INVOCATION_INTERNAL_FAILURE`, so a scan for one family can never match the other.
 */
export type RedaxTeamAdminMutationSubmitCode =
  | 'RUNTIME_CONFIG_UNAVAILABLE'
  | 'WALLET_NOT_CONNECTED'
  | 'WALLET_SIGN_ONLY_UNAVAILABLE'
  | 'APPROVED_TEAM_IDENTITY_UNAVAILABLE'
  | 'REQUEST_INVALID'
  | 'CHAIN_GUARD_REFUSED'
  /**
   * A COMPLETE, VALID observation proved the approved Team payer's balance is below THIS
   * OPERATION's threshold. That is its entire meaning.
   *
   * It says the read SUCCEEDED and the answer was "not enough" — never that a read failed,
   * never that a guard refused, and never which term, which byte length or which amount was
   * involved. Every unreadable rent, unreadable or malformed balance, invalid or stale
   * context, overflow and failed floor bind is the value-free `CHAIN_GUARD_REFUSED` instead,
   * so this code can never be produced by an unknown. It is returned strictly BEFORE any
   * plan, mutation identity, transaction, journal write, wallet prompt, signature, marker or
   * send exists.
   */
  | 'PAYER_SOL_INSUFFICIENT'
  /**
   * The customer service's write gate refused immediately before the wallet prompt (customer
   * self-service, 2026-10-23). Pre-broadcast by construction: the wallet was never asked and
   * the saved attempt is settled as not sent.
   */
  | 'WRITE_GATE_REFUSED'
  | 'PRE_STATE_NOT_ADMISSIBLE'
  | 'METADATA_NOT_CANONICAL'
  | 'MUTATION_IDENTITY_UNAVAILABLE'
  | 'PLAN_INVALID'
  | 'ATTEMPT_BLOCKED'
  | 'MUTATION_IDENTITY_ALREADY_FULFILLED'
  | 'MESSAGE_COMMITMENT_UNAVAILABLE'
  | 'JOURNAL_UNAVAILABLE'
  | 'WALLET_SIGN_ONLY_REFUSED'
  | 'SIGNED_ARTIFACT_REJECTED'
  | 'PRE_RAW_SEND_RECORD_UNVERIFIED'
  | 'RAW_SEND_OUTCOME_UNKNOWN'
  | 'MATCHING_IMMEDIATE_STATE_RESOLVED'
  | 'LANDED_EXACT_POST_STATE_SUPERSEDED_RESOLVED'
  | 'FINALIZED_LANDED_FAILURE_RESOLVED'
  | 'OUTCOME_UNRESOLVED_SUPPORT'
  | 'MUTATION_PREFLIGHT_INTERNAL_FAILURE'
  | 'MUTATION_POST_SEND_INTERNAL_FAILURE'

/**
 * Every way the READ-ONLY status projection can refuse. Closed, and only three.
 */
export type RedaxTeamAdminMutationStatusReadCode =
  | 'RUNTIME_CONFIG_UNAVAILABLE'
  | 'APPROVED_TEAM_IDENTITY_UNAVAILABLE'
  | 'JOURNAL_UNAVAILABLE'

/**
 * The FOUR public canonical `add_token_config` request fields, and there is no fifth.
 *
 * Exactly the values the instruction itself carries, all of them public and all of them
 * already canonical decimal strings in the durable record. There is deliberately NO
 * generic request projection for the other five operations: a shape that could carry any
 * operation's arguments would be a shape somebody could widen without deciding to.
 */
export interface RedaxTeamAdminAddTokenConfigStatusRequest {
  readonly legacyMint: string
  readonly rateNumerator: string
  readonly rateDenominator: string
  readonly maxOutputFromTokenConfig: string
}

/**
 * What a consumer may learn about the ONE durable record. A SANITIZED projection.
 *
 * WHAT IS ABSENT IS THE POINT. There is no `knownSignature`, no message bytes, no
 * serialized wire, no intended-message digest, no blockhash, no `lastValidBlockHeight`, no
 * attempt nonce, no revision, no namespace, no Team wallet, no raw record, no issue code,
 * no raw error, no endpoint, no adapter, no transition function, no begin function, no
 * journal mutation, no storage key and no lock name. The projection has no FIELD for any
 * of them, so nothing downstream can render one by accident.
 *
 * The witness address is the DERIVED account the instruction addresses — a public
 * identity, re-derived by the choreography rather than supplied beside it — which is
 * exactly what makes a recovery row reconstructible after a reload.
 */
export interface RedaxTeamAdminMutationStatusRecordProjection {
  readonly operation: RedaxTeamAdminMutationOperation
  readonly campaign: string
  readonly mutationIdentitySha256Hex: string
  readonly witnessAddress: string | null
  readonly addTokenConfigRequest: RedaxTeamAdminAddTokenConfigStatusRequest | null
}

/** The closed result of ONE read-only status read. It writes nothing, ever. */
export type RedaxTeamAdminMutationStatusReadResult =
  | {
      readonly ok: false
      readonly code: RedaxTeamAdminMutationStatusReadCode
    }
  | {
      readonly ok: true
      readonly presence: 'EMPTY'
    }
  | ({
      readonly ok: true
      readonly presence: 'ACTIVE'
      readonly lifecycle:
        | 'PRE_RAW_SEND'
        | 'PRE_RAW_SEND_SIGNATURE_LOCAL_NOT_RETAINED'
        | 'KNOWN_SIGNATURE'
      readonly resolution: null
    } & RedaxTeamAdminMutationStatusRecordProjection)
  | ({
      readonly ok: true
      readonly presence: 'TOMBSTONE'
      readonly lifecycle: 'TOMBSTONE'
      readonly resolution: RedaxTeamAdminMutationResolution
    } & RedaxTeamAdminMutationStatusRecordProjection)

/** Every way `reconcileMutation` can end. Closed, exhaustive and value-free. */
export type RedaxTeamAdminMutationReconcileCode =
  | 'RUNTIME_CONFIG_UNAVAILABLE'
  | 'APPROVED_TEAM_IDENTITY_UNAVAILABLE'
  | 'JOURNAL_UNAVAILABLE'
  | 'NO_RECORD'
  | 'ALREADY_RESOLVED'
  | 'PRE_RAW_SEND_NO_BROADCAST_RESOLVED'
  | 'MATCHING_IMMEDIATE_STATE_RESOLVED'
  | 'LANDED_EXACT_POST_STATE_SUPERSEDED_RESOLVED'
  | 'FINALIZED_LANDED_FAILURE_RESOLVED'
  | 'OUTCOME_STILL_UNRESOLVED'
  | 'TERMINAL_RECORD_UNVERIFIED'
  | 'MUTATION_POST_SEND_INTERNAL_FAILURE'

/**
 * What one submit did — counted, never inferred.
 *
 * `rawBroadcastCount` is `1` if and only if the one `sendRawTransaction` call was reached.
 * `walletPromptCount` is `1` if and only if the wallet was asked. Neither is derived from
 * the other, and neither is derived from the result code.
 */
export interface RedaxTeamAdminMutationSubmitResult {
  readonly ok: boolean
  readonly code: RedaxTeamAdminMutationSubmitCode
  readonly rawBroadcastCount: 0 | 1
  readonly walletPromptCount: 0 | 1
  readonly operation: RedaxTeamAdminMutationOperation | null
  readonly campaign: string | null
  readonly mutationIdentitySha256Hex: string | null
  readonly busy: boolean
}

/** What one reconcile did. It signs nothing, sends nothing and starts nothing. */
export interface RedaxTeamAdminMutationReconcileResult {
  readonly ok: boolean
  readonly code: RedaxTeamAdminMutationReconcileCode
  readonly rawBroadcastCount: 0
  readonly walletPromptCount: 0
  readonly busy: boolean
}

/**
 * THE EXTERNAL WRITE GATE (customer self-service, 2026-10-23) — the mutation twin of the S1
 * root's port. Called once, after Phase B and immediately before the one wallet prompt, with
 * the exact request and mutation identity; any NO (or throw) settles the record as not sent
 * and returns `WRITE_GATE_REFUSED`. `null` keeps the root's behaviour exactly as before.
 *
 * As in the S1 root, an admission is used only if, when it arrives and again right before the
 * prompt, this provider still has the same gate and approved Team identity, a metadata write's
 * exact URI is still on the CURRENT allowlist, and the decision's `stillCurrent()` still holds.
 */
export interface RedaxTeamAdminMutationWriteGateRequest {
  readonly operation: RedaxTeamAdminMutationOperation
  readonly teamWallet: string
  readonly campaign: string
  readonly mutationIdentitySha256Hex: string
  readonly request: RedaxTeamAdminMutationRequest
}

export interface RedaxTeamAdminMutationWriteGate {
  /** Admit or refuse the one attempt, immediately before its one wallet prompt. */
  admit(
    request: RedaxTeamAdminMutationWriteGateRequest,
  ): Promise<{ readonly ok: true; readonly stillCurrent?: () => boolean } | { readonly ok: false }>
  /** Told once when an attempt ends; return value ignored, throw swallowed. */
  settled?(outcome: {
    readonly code: RedaxTeamAdminMutationSubmitCode
    readonly rawBroadcastCount: 0 | 1
    readonly walletPromptCount: 0 | 1
  }): void
}

/**
 * The composed Team/Admin mutation surface.
 *
 * WHAT IS STILL ABSENT is what a generic surface would have handed over. There is no
 * `advanceRecoveryRecord`, no transition passthrough, no begin passthrough, no namespace
 * accessor and no raw record accessor, because a generic surface would let a consumer
 * write a terminal the choreography is the only thing positioned to justify. There is
 * still NO identity member: exposing the approved Team wallet here would be a SECOND trust
 * source beside the guard, and a consumer comparing against it would be comparing against
 * something this root does not treat as authority.
 */
export interface RedaxTeamAdminMutationActionsValue {
  readonly transactionCapability: typeof REDAX_TEAM_ADMIN_MUTATION_TRANSACTION_CAPABILITY
  readonly rawBroadcastCapability: typeof REDAX_TEAM_ADMIN_MUTATION_RAW_BROADCAST_CAPABILITY
  /** THE ONE SIGNING CHOREOGRAPHY. */
  submitMutation(request: RedaxTeamAdminMutationRequest): Promise<RedaxTeamAdminMutationSubmitResult>
  /** RECONCILE ONLY, and it takes ZERO arguments. */
  reconcileMutation(): Promise<RedaxTeamAdminMutationReconcileResult>
  /**
   * READ ONLY, and it takes ZERO arguments.
   *
   * The consumer supplies NO namespace, NO Team wallet, NO program, NO campaign, NO
   * identity, NO journal key and NO record. This root builds the namespace itself, from
   * the SAME private runtime configuration and approved-Team identity `submitMutation` and
   * `reconcileMutation` use — there is exactly one namespace-construction authority, and a
   * parameter here would have created a second.
   */
  readMutationStatus(): Promise<RedaxTeamAdminMutationStatusReadResult>
  /**
   * C1 — THE PASSIVE, OPERATION-SCOPED DEVNET SOL READ. READ ONLY.
   *
   * ITS ONLY ARGUMENT IS THE CLOSED OPERATION DISCRIMINANT. There is deliberately no
   * parameter for a wallet, an endpoint, a program, a Campaign, a Connection, a threshold or
   * a commitment: this root resolves the bounded runtime configuration, the broker's own
   * current key and the INJECTED approved Team identity itself, from the SAME private
   * sources `submitMutation` and `readMutationStatus` use, and refuses as
   * `READ_UNAVAILABLE` unless the connected wallet EXACTLY equals the approved Team.
   *
   * THE DISCRIMINANT IS REQUIRED EVEN WHERE PRICES COINCIDE. The four lifecycle operations
   * are numerically equal today; passing the exact operation anyway is what makes a
   * wrong-operation reuse impossible rather than merely unlikely.
   *
   * IT BUILDS NO INSTRUCTION, creates no `Transaction`, opens no journal, writes nothing,
   * signs nothing, sends nothing, confirms nothing, reconciles nothing and returns no
   * permission. It is not authority: `submitMutation` re-observes at C2 on the attempt's own
   * Connection, at the attempt's own floor, through the SAME private observer, and refuses
   * there regardless of anything this member ever reported.
   *
   * It creates ONE fresh read-only scoped `Connection` per explicit call, raising this
   * root's construction SITES from two to three. The Connection OWNER FILE count is
   * unchanged, and no other module gains one.
   */
  readMutationSolPreflight(
    operation: RedaxTeamAdminMutationOperation,
  ): Promise<RedaxTeamAdminMutationSolPreflightResult>
  /**
   * The SAME passive read as `readMutationSolPreflight`, through the SAME private observer,
   * additionally returning the estimated requirement and the observed balance for DISPLAY.
   * Read only; same refusals; same one scoped Connection per call. Never authority.
   */
  readMutationSolEstimate(
    operation: RedaxTeamAdminMutationOperation,
  ): Promise<RedaxTeamAdminMutationSolEstimate>
  /**
   * A READ-ONLY classic-SPL mint read, so a person never has to know an input token's
   * decimals by heart. One scoped Connection per call; it builds, signs and sends nothing.
   * The answer pre-fills a draft only — `submitMutation` still re-reads both mints in its
   * own coherent read and refuses on any mismatch before the wallet is asked.
   */
  readClassicMintFacts(mint: string): Promise<RedaxTeamAdminClassicMintFactsResult>
}

/** The classic-mint read's answer, named here so a panel never acquires the data layer. */
export type RedaxTeamAdminClassicMintFactsResult = RedaxClassicMintFactsReadResult

const RedaxTeamAdminMutationActionsContext =
  createContext<RedaxTeamAdminMutationActionsValue | null>(null)

// --- Internal helpers ------------------------------------------------------------

/** Digits only, no sign, no exponent, no separator, no leading zero except `0`. */
const CANONICAL_UNSIGNED_DECIMAL_PATTERN = /^(?:0|[1-9][0-9]*)$/

/** A public base58-looking account identifier. */
const BASE58_ACCOUNT_PATTERN = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/

/** The fixed widths the Metaplex program stores each metadata string at. */
const REDAX_PUFFED_NAME_BYTES = 32
const REDAX_PUFFED_SYMBOL_BYTES = 10
const REDAX_PUFFED_URI_BYTES = 200

/**
 * Lowercase SHA-256 hex of exactly these bytes, or null when the platform cannot.
 *
 * Structurally resolved for the same reason every other REDAX crypto touchpoint is: this
 * file compiles under the app's DOM lib and under the test runner's Node types, and a
 * platform that cannot digest is UNAVAILABLE rather than an exception.
 */
async function sha256HexOf(bytes: Uint8Array): Promise<string | null> {
  const candidate = (globalThis as { crypto?: unknown }).crypto
  if (typeof candidate !== 'object' || candidate === null) {
    return null
  }
  const subtle = (candidate as { subtle?: { digest?: unknown } }).subtle
  if (typeof subtle !== 'object' || subtle === null || typeof subtle.digest !== 'function') {
    return null
  }
  let digest: ArrayBuffer
  try {
    digest = await (subtle.digest as (algorithm: string, data: Uint8Array) => Promise<ArrayBuffer>)(
      'SHA-256',
      bytes,
    )
  } catch {
    return null
  }
  let out = ''
  for (const byte of new Uint8Array(digest)) {
    out += byte.toString(16).padStart(2, '0')
  }
  return out
}

/**
 * The broker's IMMEDIATELY current key — not a snapshot compared to itself.
 *
 * A pre-sign identity check comparing the broker's memoized `publicKey` against a baseline
 * captured from that same snapshot would be comparing a value to itself, and an in-flight
 * account switch on the SAME adapter would be invisible to it.
 */
function readLiveTeamWallet(broker: RedaxTeamAdminMutationSignOnlyBroker): PublicKey | null {
  let live: PublicKey | null
  try {
    live = broker.readCurrentPublicKey()
  } catch {
    return null
  }
  if (live === null) {
    return null
  }
  let base58: string
  try {
    base58 = live.toBase58()
  } catch {
    return null
  }
  try {
    // Re-wrapped through THIS module's package instance, so a duplicated web3 copy cannot
    // make an object comparison unreliable downstream.
    return new PublicKey(base58)
  } catch {
    return null
  }
}

// --- The ONE post-init mutation SOL-preflight observer ------------------------------
//
// C1 AND C2 CALL EXACTLY THIS, and both pass the CLOSED operation discriminant. The
// passive read a panel exposes and the attempt-authoritative recheck inside
// `submitMutation` differ in WHEN they run and in what a refusal costs — never in what
// "enough SOL" means for a given operation. One private observer makes that structural.
//
// NO CROSS-OPERATION THRESHOLD REUSE. The four lifecycle operations are numerically equal
// TODAY, and the observer still requires the exact discriminant rather than a shared
// "lifecycle" verdict: equal arithmetic is a coincidence of the current account model, not
// a licence to answer one operation's question with another's result. A seventh operation
// would fail the exhaustive `never` below rather than silently inherit a price.


/**
 * A lamport BALANCE from an untrusted response, or null.
 *
 * ZERO IS VALID and means insufficient whenever the requirement is positive — the
 * contextual balance read throws on an RPC error rather than returning zero, so an observed
 * zero is a REAL balance, and reclassifying it as a failed read would hide exactly the
 * state this preflight exists to surface.
 */
function readSafeMutationBalanceLamports(value: unknown): bigint | null {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    return null
  }
  return BigInt(value)
}

/**
 * A RENT lamport quantity from an untrusted response, or null.
 *
 * STRICTLY POSITIVE and a safe integer. Zero, negative and fractional rents are each a
 * FAILED READ rather than a requirement: zero is not a devnet rent figure, and accepting one
 * would understate the threshold by an entire term. No fallback, no default, no carried value.
 */
function readValidMutationRentLamports(value: unknown): bigint | null {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    return null
  }
  return BigInt(value)
}

/** One protected property read: a hostile accessor that throws becomes a refusal. */
function readMutationCandidateProperty(
  source: unknown,
  key: string,
): { readonly ok: true; readonly value: unknown } | { readonly ok: false } {
  if (typeof source !== 'object' || source === null) {
    return { ok: false }
  }
  try {
    return { ok: true, value: (source as Record<string, unknown>)[key] }
  } catch {
    return { ok: false }
  }
}

/** The balance and its context slot, from an untrusted response, or null. */
function readMutationContextualBalance(
  response: unknown,
): { readonly lamports: bigint; readonly contextSlot: number } | null {
  const context = readMutationCandidateProperty(response, 'context')
  if (!context.ok) {
    return null
  }
  const slot = readMutationCandidateProperty(context.value, 'slot')
  if (
    !slot.ok ||
    typeof slot.value !== 'number' ||
    !Number.isSafeInteger(slot.value) ||
    slot.value < 0
  ) {
    return null
  }
  const value = readMutationCandidateProperty(response, 'value')
  if (!value.ok) {
    return null
  }
  const lamports = readSafeMutationBalanceLamports(value.value)
  if (lamports === null) {
    return null
  }
  return { lamports, contextSlot: slot.value }
}

/**
 * THE BYTE LENGTHS ONE OPERATION MUST READ RENT FOR — exactly those, and no others.
 *
 * `rent(0)` is common to all six because every operation's payer must itself stay
 * rent-exempt. Beyond that:
 *
 *   * ADD_TOKEN_CONFIG creates the TokenConfig PDA          -> `155`
 *   * SETUP_METADATA rents the external metadata account    -> `607`
 *     and the create fee's scaling term                     -> `1308`
 *   * ACTIVATE / PAUSE / UNPAUSE / FINALIZE create NOTHING   -> no allocation term at all
 *
 * THE ABSENT TERMS ARE THE POINT for the last four: charging a lifecycle step for an
 * account it never allocates would refuse operators who can in fact afford the transaction.
 */
function mutationRentSpacesFor(operation: RedaxTeamAdminMutationOperation): readonly number[] {
  switch (operation) {
    case 'ADD_TOKEN_CONFIG':
      return [REDAX_TEAM_ADMIN_MUTATION_PAYER_ACCOUNT_DATA_LENGTH, REDAX_TOKEN_CONFIG_ACCOUNT_SPACE]
    case 'SETUP_METADATA':
      return [
        REDAX_TEAM_ADMIN_MUTATION_PAYER_ACCOUNT_DATA_LENGTH,
        METADATA_ACCOUNT_SPACE,
        METAPLEX_CREATE_FEE_SCALAR_SPACE,
      ]
    case 'ACTIVATE_CAMPAIGN':
    case 'PAUSE_CAMPAIGN':
    case 'UNPAUSE_CAMPAIGN':
    case 'FINALIZE_CAMPAIGN':
      return [REDAX_TEAM_ADMIN_MUTATION_PAYER_ACCOUNT_DATA_LENGTH]
    default: {
      // Outside the closed six. `operation` is `never` here, so a seventh member becomes a
      // COMPILE failure rather than a silent fall-through to somebody else's price.
      const exhaustive: never = operation
      void exhaustive
      return []
    }
  }
}

/**
 * Read this operation's live rent floors and the live contextual balance, and compare.
 *
 * UNKNOWN NEVER MEANS SUFFICIENT. A throw, an unreadable response, a rent that is not
 * strictly positive, a balance that is not a non-negative safe integer, a missing or invalid
 * context, a returned context below the requested floor and any overflow ALL yield
 * `READ_UNAVAILABLE`, and every one of them WITHHOLDS the action rather than allowing it.
 *
 * EXACT EQUALITY IS SUFFICIENT. The threshold already carries the conservative fee
 * allowance, and demanding one lamport more would be a second, undeclared buffer.
 *
 * `getBalanceAndContext` and never the context-free balance RPC, which remains forbidden: a
 * balance with no context slot cannot be gated against an attempt floor or bound into the
 * chain guard, and both are mandatory for C2. The dynamic compiled-message fee RPC is never
 * called.
 */
async function observeRedaxTeamAdminMutationSolPreflight(
  connection: Connection,
  payer: PublicKey,
  operation: RedaxTeamAdminMutationOperation,
  minContextSlot: number | null,
): Promise<RedaxTeamAdminMutationSolPreflightObservation> {
  const spaces = mutationRentSpacesFor(operation)
  if (spaces.length === 0) {
    return REDAX_TEAM_ADMIN_MUTATION_SOL_PREFLIGHT_UNAVAILABLE
  }

  // READ every needed rent floor first, then sum them through the ONE pure model
  // (`redaxTeamAdminMutationSolModel.ts`): the fee bound, the allocated rents and — for
  // SETUP_METADATA — the larger-of Metaplex create fee. The earlier inline sum, which
  // under-estimated the metadata levy at today's devnet rent rate, is superseded by it.
  const rentBySpace = new Map<number, bigint>()
  for (const space of spaces) {
    let rentRead: unknown
    try {
      rentRead = await connection.getMinimumBalanceForRentExemption(
        space,
        REDAX_TEAM_ADMIN_MUTATION_ACTION_COMMITMENT,
      )
    } catch {
      return REDAX_TEAM_ADMIN_MUTATION_SOL_PREFLIGHT_UNAVAILABLE
    }
    const rent = readValidMutationRentLamports(rentRead)
    if (rent === null) {
      return REDAX_TEAM_ADMIN_MUTATION_SOL_PREFLIGHT_UNAVAILABLE
    }
    rentBySpace.set(space, rent)
  }
  const required = computeRedaxTeamAdminMutationRequiredLamports({
    operation,
    feeBoundLamports: BigInt(TEAM_ADMIN_MUTATION_SOL_PREFLIGHT_FEE_BOUND_LAMPORTS),
    rentBySpace,
    allocatedSpaces: spaces.filter((space) => space !== METAPLEX_CREATE_FEE_SCALAR_SPACE),
    metadataCreateFee:
      operation === 'SETUP_METADATA'
        ? {
            scalarSpace: METAPLEX_CREATE_FEE_SCALAR_SPACE,
            auditedOffsetLamports: BigInt(METAPLEX_CREATE_FEE_OFFSET_LAMPORTS),
            observedFlatFeeLamports: METAPLEX_OBSERVED_FLAT_CREATE_FEE_LAMPORTS,
          }
        : null,
  })
  if (required === null) {
    return REDAX_TEAM_ADMIN_MUTATION_SOL_PREFLIGHT_UNAVAILABLE
  }

  let balanceRead: unknown
  try {
    balanceRead = await connection.getBalanceAndContext(
      payer,
      minContextSlot === null
        ? { commitment: REDAX_TEAM_ADMIN_MUTATION_ACTION_COMMITMENT }
        : { commitment: REDAX_TEAM_ADMIN_MUTATION_ACTION_COMMITMENT, minContextSlot },
    )
  } catch {
    return REDAX_TEAM_ADMIN_MUTATION_SOL_PREFLIGHT_UNAVAILABLE
  }
  const observed = readMutationContextualBalance(balanceRead)
  if (observed === null) {
    return REDAX_TEAM_ADMIN_MUTATION_SOL_PREFLIGHT_UNAVAILABLE
  }
  // The request-level `minContextSlot` protects request EVALUATION; this rejects a stale
  // RETURNED context. Both are mandatory — a node may honour neither, and only the local
  // check can tell.
  if (minContextSlot !== null && observed.contextSlot < minContextSlot) {
    return REDAX_TEAM_ADMIN_MUTATION_SOL_PREFLIGHT_UNAVAILABLE
  }
  return {
    result: observed.lamports >= required ? 'SUFFICIENT' : 'INSUFFICIENT',
    balanceContextSlot: observed.contextSlot,
    requiredLamports: required,
    balanceLamports: observed.lamports,
  }
}

// THE PROBLEM THIS CLOSES, stated exactly. The early ACTIVE check at 6b reads the mutation
// journal under its exclusive lock and then RELEASES that lock before the awaited C2 SOL
// work runs. A second tab may therefore establish a durable ACTIVE attempt inside that
// window. When C2 SUCCEEDS the later durable `begin` — a compare-and-set under the same
// lock — still refuses it. When C2 REFUSES the path never reaches `begin`, so without this
// read the session would answer "you are short of SOL" while the higher-priority truth is
// "you already hold an unresolved attempt". Funding the wallet would not unblock that.
//
// THE FIX IS A LINEARIZATION POINT, NOT A LOCK HELD ACROSS THE RPC. Immediately before a
// C2 SOL refusal is returned, the journal is read ONCE MORE under its own exclusive lock,
// and THAT read is the moment the refusal is decided at.
//
// WHAT IS AND IS NOT GUARANTEED, stated narrowly so no reader can widen it:
// `ACTIVE_AT_FINAL_SOL_REFUSAL_LINEARIZATION_POINT_CANNOT_BE_MASKED`. A session whose
// durable `begin` lands AFTER this read has linearized is a strictly later event, and it
// does not retroactively change an already-decided refusal. The race is NOT eliminated
// globally, and this must never be described as if it were.
//
// IT IS STRICTLY READ-ONLY, and it is the EXISTING exported journal read — no new journal
// API, no new lock helper and no journal-module edit. It writes nothing, transitions
// nothing, tombstones nothing, deletes nothing, prompts no wallet, signs nothing and sends
// nothing. A C2 refusal remains a NO-ATTEMPT path unless another session independently
// created the ACTIVE record this read observes.
//
// IT IS THIS ROOT'S OWN. The S1 root has its separate equivalent over its separate journal,
// and there is deliberately NO shared helper: one classifier reachable from both corridors
// would be one more thing that could be given the wrong namespace.

/** The C2 SOL-preflight refusal codes this classifier may be asked to fall back to. */
type RedaxTeamAdminMutationSolRefusalFallback = Extract<
  RedaxTeamAdminMutationSubmitCode,
  'PAYER_SOL_INSUFFICIENT' | 'CHAIN_GUARD_REFUSED'
>

/** What a C2 SOL refusal finally resolves to, once the journal has had the last word. */
type RedaxTeamAdminMutationSolRefusalCode =
  | RedaxTeamAdminMutationSolRefusalFallback
  | 'ATTEMPT_BLOCKED'
  | 'JOURNAL_UNAVAILABLE'

/**
 * Decide ONE C2 SOL refusal, at one final locked journal read.
 *
 * ROOT-PRIVATE BY CONSTRUCTION: not exported, not a provider member, not reachable from any
 * panel and never handed a journal WRITE capability. The reader is injected only so the
 * interleaving is deterministically testable; production passes the real exported read.
 *
 * IT RETURNS A BARE CODE AND NOTHING ELSE — no amount, no threshold, no signature, no
 * mutation identity, no attempt nonce, no revision and no record ever leaves this function.
 *
 * FAIL-CLOSED ON AN UNTRUSTWORTHY READ. An unavailable lock, an unavailable storage port, a
 * corrupt or incompatible record and an unexpected throw all yield `JOURNAL_UNAVAILABLE`
 * rather than the original SOL code, because a journal that cannot be read is not evidence
 * that no attempt exists.
 */
async function finalizeRedaxTeamAdminMutationSolRefusal(
  namespace: RedaxTeamAdminMutationNamespace,
  fallback: RedaxTeamAdminMutationSolRefusalFallback,
  readJournal: (
    namespace: RedaxTeamAdminMutationNamespace,
  ) => Promise<RedaxTeamAdminMutationReadResult>,
): Promise<RedaxTeamAdminMutationSolRefusalCode> {
  let finalRead: RedaxTeamAdminMutationReadResult
  try {
    finalRead = await readJournal(namespace)
  } catch {
    return 'JOURNAL_UNAVAILABLE'
  }
  if (finalRead === null || typeof finalRead !== 'object' || !finalRead.ok) {
    return 'JOURNAL_UNAVAILABLE'
  }
  if (finalRead.kind === 'ACTIVE') {
    // THE DURABLE RECORD OUTRANKS THE BALANCE. It outranks the insufficiency code and the
    // value-free unavailable code alike, because it answers a different and more urgent
    // question than either of them.
    return 'ATTEMPT_BLOCKED'
  }
  // EMPTY and TOMBSTONE both mean no unresolved attempt exists, so the SOL refusal the C2
  // phase actually produced is preserved exactly as it was.
  return fallback
}

/**
 * The terminals a fresh attempt may follow with the SAME mutation identity.
 */
const SAME_IDENTITY_REENTRY_AFTER: readonly RedaxTeamAdminMutationResolution[] = Object.freeze([
  'RESOLVED_PRE_RAW_SEND_NO_BROADCAST',
  'RESOLVED_FINALIZED_NO_LAND',
  'RESOLVED_FINALIZED_LANDED_FAILURE',
])

/**
 * The operations whose success is PERMANENT, so the same identity is fulfilled forever.
 *
 * A TokenConfig PDA exists once and its terms cannot be edited; metadata is once-only and
 * immutable; activation happens once; finalization is terminal. Only `PAUSE_CAMPAIGN` and
 * `UNPAUSE_CAMPAIGN` are repeatable, and even they are gated on the fresh chain pre-state
 * actually showing the required predecessor again — a NEW lifecycle occurrence, never a
 * retry of the old one.
 */
const ONCE_ONLY_OPERATIONS: readonly RedaxTeamAdminMutationOperation[] = Object.freeze([
  'ADD_TOKEN_CONFIG',
  'SETUP_METADATA',
  'ACTIVATE_CAMPAIGN',
  'FINALIZE_CAMPAIGN',
])

/** Was this tombstone a SUCCESS — that is, did the mutation take effect? */
function isSuccessResolution(resolution: RedaxTeamAdminMutationResolution): boolean {
  return (
    resolution === 'RESOLVED_MATCHING_IMMEDIATE_STATE' ||
    resolution === 'RESOLVED_LANDED_EXACT_POST_STATE_SUPERSEDED'
  )
}

/**
 * Judged at the request boundary, exactly like the canonical amount strings: a value that is
 * not an integer in `0 … 255` is not a decimals expectation, and repairing one would let two
 * spellings of one expectation refuse differently depending on which path a caller took.
 */
function isRedaxMintDecimalsValue(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 255
}

/** Build the flat, total request-facts shape the journal stores. */
function requestFactsFor(
  request: RedaxTeamAdminMutationRequest,
  predecessorStatus: 'initialized' | 'active' | 'paused' | 'finalized',
  targetStatus: 'initialized' | 'active' | 'paused' | 'finalized',
  metadataDigests: {
    readonly nameSha256Hex: string
    readonly nameByteLength: number
    readonly symbolSha256Hex: string
    readonly symbolByteLength: number
    readonly uriSha256Hex: string
    readonly uriByteLength: number
    readonly expectedPuffedNameSha256Hex: string
    readonly expectedPuffedSymbolSha256Hex: string
    readonly expectedPuffedUriSha256Hex: string
  } | null,
): RedaxTeamAdminMutationRequestFactsV1 {
  const empty: RedaxTeamAdminMutationRequestFactsV1 = {
    legacyMint: null,
    rateNumerator: null,
    rateDenominator: null,
    maxOutputFromTokenConfig: null,
    nameSha256Hex: null,
    nameByteLength: null,
    symbolSha256Hex: null,
    symbolByteLength: null,
    uriSha256Hex: null,
    uriByteLength: null,
    expectedPuffedNameSha256Hex: null,
    expectedPuffedSymbolSha256Hex: null,
    expectedPuffedUriSha256Hex: null,
    predecessorStatus: null,
    targetStatus: null,
    authorityRole: null,
  }
  if (request.operation === 'ADD_TOKEN_CONFIG') {
    return {
      ...empty,
      legacyMint: request.legacyMint,
      rateNumerator: request.rateNumerator,
      rateDenominator: request.rateDenominator,
      maxOutputFromTokenConfig: request.maxOutputFromTokenConfig,
    }
  }
  if (request.operation === 'SETUP_METADATA') {
    return metadataDigests === null ? empty : { ...empty, ...metadataDigests }
  }
  if (request.operation === 'PAUSE_CAMPAIGN') {
    return { ...empty, predecessorStatus, targetStatus, authorityRole: 'campaign_admin' }
  }
  return { ...empty, predecessorStatus, targetStatus }
}

// --- The provider ------------------------------------------------------------------

/**
 * THE ONE PASSIVE READ-ONLY `Connection` SITE of this root (demo customer flow, 2026-10-22).
 *
 * The passive SOL verdict, its display estimate and the read-only mint read each take one
 * fresh scoped Connection per explicit call — from HERE, so the root's construction-site
 * census is unchanged: the attempt Connection, the reconciliation Connection and this one.
 * A passive Connection is never an attempt Connection, is never registered with the chain
 * guard and cannot bind a floor.
 */
function createRedaxTeamAdminPassiveReadConnection(rpcUrl: string): Connection {
  return new Connection(rpcUrl, REDAX_TEAM_ADMIN_MUTATION_ACTION_COMMITMENT)
}

/** The passive (C1) observation through the SAME private observer C2 uses. */
function observePassiveMutationSolPreflight(
  rpcUrl: string,
  payer: PublicKey,
  operation: RedaxTeamAdminMutationOperation,
): Promise<RedaxTeamAdminMutationSolPreflightObservation> {
  return observeRedaxTeamAdminMutationSolPreflight(
    createRedaxTeamAdminPassiveReadConnection(rpcUrl),
    payer,
    operation,
    null,
  )
}

export function RedaxTeamAdminMutationActionsProvider({
  approvedTeamWallet = null,
  metadataUriAllowlist = [],
  writeGate = null,
  children,
}: {
  /**
   * The trusted approved-Team public key, as base58, or `null`.
   *
   * A PROVIDER PROP, deliberately: it is a deployment fact, not a user input, so it enters
   * at the provider boundary. NO ENVIRONMENT IS READ HERE, and `null` remains the honest
   * default and the fail-closed state — refusing rather than proceeding with whatever
   * happens to be connected.
   */
  readonly approvedTeamWallet?: string | null
  /**
   * The approved metadata URI allowlist, injected.
   */
  readonly metadataUriAllowlist?: readonly string[]
  /** The optional external write gate; see `RedaxTeamAdminMutationWriteGate`. */
  readonly writeGate?: RedaxTeamAdminMutationWriteGate | null
  readonly children?: ReactNode
}): ReactNode {
  // THE PRIVATE SINGLE-FLIGHT LATCH lives in a ref, and its RENDERED shadow lives in state.
  // A ref is synchronous, so two calls in one tick cannot both pass; the state exists only
  // so a future consumer could render a busy affordance. Neither is authority: the durable
  // single-slot journal is, and this latch merely stops this tab from racing itself.
  const inFlightRef = useRef<boolean>(false)
  const [busy, setBusy] = useState<boolean>(false)

  // The ONE private wallet surface this root may use. It is action-named, sign-only, and has
  // no send member of any kind.
  const broker = useRedaxTeamAdminMutationSignOnlyBroker()

  // THE LATEST GATE, IDENTITY AND METADATA ALLOWLIST this provider was rendered with — written
  // during render (no effect, no subscription). An attempt compares them with the ones it was
  // admitted under after the gate's await and again right before the prompt; the allowlist is
  // compared by VALUE, so a new array with the same entries is the same context.
  const liveGateRef = useRef<{
    readonly writeGate: RedaxTeamAdminMutationWriteGate | null
    readonly approvedTeamWallet: string | null
    readonly metadataUriAllowlist: readonly string[]
  }>({ writeGate, approvedTeamWallet, metadataUriAllowlist })
  liveGateRef.current = { writeGate, approvedTeamWallet, metadataUriAllowlist }

  const claimFlight = useCallback((): boolean => {
    if (inFlightRef.current) {
      return false
    }
    inFlightRef.current = true
    setBusy(true)
    return true
  }, [])

  const releaseFlight = useCallback((): void => {
    inFlightRef.current = false
    setBusy(false)
  }, [])

  // ===========================================================================
  // THE ONE MUTATION SIGNING CHOREOGRAPHY
  // ===========================================================================
  const submitMutation = useCallback(
    async (
      request: RedaxTeamAdminMutationRequest,
    ): Promise<RedaxTeamAdminMutationSubmitResult> => {
      let promptCount: 0 | 1 = 0
      let broadcastCount: 0 | 1 = 0
      let identityHex: string | null = null
      let campaignAddress: string | null = null
      let operation: RedaxTeamAdminMutationOperation | null = null

      /** The ONLY way out of this function. It always releases the latch. */
      const finish = (
        ok: boolean,
        code: RedaxTeamAdminMutationSubmitCode,
      ): RedaxTeamAdminMutationSubmitResult => {
        releaseFlight()
        if (writeGate !== null && typeof writeGate.settled === 'function') {
          try {
            writeGate.settled({ code, rawBroadcastCount: broadcastCount, walletPromptCount: promptCount })
          } catch {
            // The gate's bookkeeping can never change what this attempt did.
          }
        }
        return {
          ok,
          code,
          rawBroadcastCount: broadcastCount,
          walletPromptCount: promptCount,
          operation,
          campaign: campaignAddress,
          mutationIdentitySha256Hex: identityHex,
          busy: false,
        }
      }

      if (!claimFlight()) {
        // Already in flight in THIS tab. Refused without releasing, because the flight that
        // is running owns the latch and must be the one to drop it.
        return {
          ok: false,
          code: 'ATTEMPT_BLOCKED',
          rawBroadcastCount: 0,
          walletPromptCount: 0,
          operation: null,
          campaign: null,
          mutationIdentitySha256Hex: null,
          busy: true,
        }
      }

      // 1. THE BOUNDED DEVNET RUNTIME CONFIGURATION. No env is read here — the one
      //    controlled accessor owns that, and an unusable config is a typed refusal.
      const runtimeConfig = resolveRedaxRuntimeActionConfig()
      if (!runtimeConfig.ok) {
        return finish(false, 'RUNTIME_CONFIG_UNAVAILABLE')
      }

      // 2/3. THE NAMED BROKER, and the preconditions that cost nothing to check. A wallet
      //      that cannot sign on its own is refused with NOTHING behind it: no chain read,
      //      no plan, no journal record and — above all — no wallet prompt.
      if (!broker.isConnected) {
        return finish(false, 'WALLET_NOT_CONNECTED')
      }
      if (!broker.canSignOnly) {
        return finish(false, 'WALLET_SIGN_ONLY_UNAVAILABLE')
      }
      if (approvedTeamWallet === null) {
        return finish(false, 'APPROVED_TEAM_IDENTITY_UNAVAILABLE')
      }

      if (
        typeof request !== 'object' ||
        request === null ||
        typeof request.campaign !== 'string' ||
        !BASE58_ACCOUNT_PATTERN.test(request.campaign)
      ) {
        return finish(false, 'REQUEST_INVALID')
      }
      operation = request.operation
      campaignAddress = request.campaign

      // THE AMOUNT STRINGS ARE JUDGED AT THE BOUNDARY, not deep inside the identity module.
      // They must ALREADY be canonical unsigned decimal — `"007"`, `"+7"`, `"1_000"`, `"7e0"`,
      // `"0x7"` and `" 7 "` are all refused rather than repaired, because a normalizer here
      // would let two spellings of one rate reach two different mutation identities depending
      // on which path a caller took. Refusing early also means an unusable request never
      // reaches a chain read, a plan or a wallet.
      if (
        request.operation === 'ADD_TOKEN_CONFIG' &&
        (!CANONICAL_UNSIGNED_DECIMAL_PATTERN.test(request.rateNumerator) ||
          !CANONICAL_UNSIGNED_DECIMAL_PATTERN.test(request.rateDenominator) ||
          !CANONICAL_UNSIGNED_DECIMAL_PATTERN.test(request.maxOutputFromTokenConfig) ||
          !BASE58_ACCOUNT_PATTERN.test(request.legacyMint) ||
          !BASE58_ACCOUNT_PATTERN.test(request.outputMint) ||
          // THE TWO PREFLIGHT EXPECTATIONS ARE `u8`s, judged at the same boundary as every
          // other request value. A fraction, a `NaN` or an out-of-range value is refused
          // here rather than reaching a guard that would have to decide what it meant.
          !isRedaxMintDecimalsValue(request.expectedLegacyDecimals) ||
          !isRedaxMintDecimalsValue(request.expectedOutputDecimals))
      ) {
        return finish(false, 'REQUEST_INVALID')
      }
      if (
        request.operation === 'SETUP_METADATA' &&
        (!BASE58_ACCOUNT_PATTERN.test(request.outputMint) ||
          typeof request.metadataName !== 'string' ||
          typeof request.metadataSymbol !== 'string' ||
          typeof request.metadataUri !== 'string')
      ) {
        return finish(false, 'REQUEST_INVALID')
      }

      let approvedTeam: PublicKey
      let programId: PublicKey
      let campaign: PublicKey
      try {
        approvedTeam = new PublicKey(approvedTeamWallet)
        programId = new PublicKey(runtimeConfig.programId)
        campaign = new PublicKey(request.campaign)
      } catch {
        return finish(false, 'APPROVED_TEAM_IDENTITY_UNAVAILABLE')
      }

      // EVERY UNEXPECTED EXCEPTION FROM HERE ON IS CONTAINED. An escaping rejection would
      // return a raw rejected Promise instead of the bounded result AND would leave the
      // single-flight latch held, blocking every later attempt while proving nothing about
      // this one. It is a REGION, not a patch over one call, so work added later inherits
      // the guarantee instead of quietly falling outside it.
      let broadcastReached = false
      try {
        // 4. EXACTLY ONE ATTEMPT-SCOPED Connection. Constructed directly, here, and used by
        //    every read this attempt performs — the guard consumes it and never makes one.
        const connection = new Connection(
          runtimeConfig.rpcUrl,
          REDAX_TEAM_ADMIN_MUTATION_ACTION_COMMITMENT,
        )

        // 5. THE BROKER'S IMMEDIATELY CURRENT KEY.
        const connectedWallet = readLiveTeamWallet(broker)
        if (connectedWallet === null) {
          return finish(false, 'WALLET_NOT_CONNECTED')
        }

        const guardRuntime: RedaxTeamAdminMutationGuardRuntime = {
          mode: runtimeConfig.mode,
          cluster: runtimeConfig.cluster,
          programId,
        }

        // The accounts this operation's pre-state must be observed over, derived BEFORE any
        // read so the read itself is coherent over exactly them.
        let target: RedaxTeamAdminMutationGuardTarget
        const mintPreflight: RedaxTeamAdminMutationAddMintPreflight | null =
          request.operation === 'ADD_TOKEN_CONFIG'
            ? {
                expectedLegacyDecimals: request.expectedLegacyDecimals,
                expectedOutputDecimals: request.expectedOutputDecimals,
              }
            : null
        try {
          if (request.operation === 'ADD_TOKEN_CONFIG') {
            const legacyMint = new PublicKey(request.legacyMint)
            target = {
              family: 'ADD_TOKEN_CONFIG',
              campaign,
              tokenConfig: deriveTokenConfigPda(programId, campaign, legacyMint).pda,
              legacyMint,
              // NAMED so the coherent read observes it in the SAME response; RE-PROVEN by the
              // guard against the fresh Campaign body, which is what makes it authoritative.
              outputMint: new PublicKey(request.outputMint),
            }
          } else if (request.operation === 'SETUP_METADATA') {
            target = {
              family: 'SETUP_METADATA',
              campaign,
              outputMint: new PublicKey(request.outputMint),
            }
          } else if (request.operation === 'ACTIVATE_CAMPAIGN') {
            target = { family: 'ACTIVATE_CAMPAIGN', campaign }
          } else {
            // PAUSE, UNPAUSE and FINALIZE. None of them has a deadline, so none of them
            // acquires a clock, and all three stay on the status-only read.
            target = { family: 'STATUS_ONLY', campaign }
          }
        } catch {
          return finish(false, 'REQUEST_INVALID')
        }

        const phaseA = await checkRedaxTeamAdminMutationGuardPhaseA({
          connection,
          runtime: guardRuntime,
          connectedWallet,
          approvedTeamWallet: approvedTeam,
          // THE OPERATION IS BOUND AT PHASE A, not first named at Phase B. It is the SAME
          // value the target above was derived from and the SAME value the planner below
          // executes, so the guard freezes the operation this attempt actually is and every
          // later phase is reasserted against exactly that one.
          operation: request.operation,
          target,
          mintPreflight,
        })
        if (!phaseA.ok) {
          return finish(false, 'CHAIN_GUARD_REFUSED')
        }

        // The mutation journal namespace depends on the CLUSTER, the PROGRAM and the TEAM
        // WALLET and on nothing else — no campaign, no operation and no identity — so it is
        // fully determined here, before any plan or identity exists. That is what makes the
        // early read below possible at all.
        const namespace: RedaxTeamAdminMutationNamespace = {
          cluster: REDAX_TEAM_ADMIN_MUTATION_JOURNAL_CLUSTER,
          program: programId.toBase58(),
          teamWallet: approvedTeam.toBase58(),
        }

        // 6b. THE EARLY READ-ONLY ACTIVE CHECK — AN EXISTING UNRESOLVED ATTEMPT OUTRANKS
        //     EVERYTHING BELOW IT.
        //
        //     An operator holding an unresolved attempt must be told THAT, and must be told
        //     it even when the wallet also happens to be short of SOL. Reporting an
        //     insufficiency first would answer the wrong question: funding the wallet would
        //     not unblock the attempt, and the durable record is the fact that actually
        //     decides what may happen next. So this outranks both `PAYER_SOL_INSUFFICIENT`
        //     and every unavailable-observation refusal, by running before them.
        //
        //     IT IS STRICTLY READ-ONLY. It writes nothing, transitions nothing, deletes
        //     nothing, replaces nothing, prompts no wallet and touches no chain. The durable
        //     BEGIN — and its compare-and-set under the journal's Web Lock — stays exactly
        //     where it was, later, after the plan, the identity and the message commitments;
        //     a concurrent session that opens a newer ACTIVE record after this read is still
        //     refused there, and none of those semantics is weakened here.
        const earlyJournal = await readRedaxTeamAdminMutationJournal(namespace)
        if (!earlyJournal.ok) {
          return finish(false, 'JOURNAL_UNAVAILABLE')
        }
        if (earlyJournal.kind === 'ACTIVE') {
          return finish(false, 'ATTEMPT_BLOCKED')
        }
        // THE TOMBSTONE RECORD ITSELF, captured here — not merely its identity. The existing
        // two-gate re-entry judgement below needs the previous record's mutation identity and
        // resolution to decide whether this attempt may re-enter it, and it is applied to
        // THIS captured record later, once the plan and the identity exist. Its semantics are
        // unchanged; only the read that supplies it has moved earlier.
        const earlyTombstone = earlyJournal.kind === 'TOMBSTONE' ? earlyJournal.record : null

        // 6c. C2 — THE ATTEMPT-AUTHORITATIVE, OPERATION-SPECIFIC SOL PREFLIGHT, on THIS
        //     attempt's Connection and at THIS attempt's accepted floor.
        //
        //     THE FLOOR IS `max(phaseA.contextSlot, phaseA.preStateContextSlot)`. The
        //     pre-state read is a separate, later context this attempt already accepted and
        //     already admitted its plan against, so a balance older than it would vouch for a
        //     chain the attempt has demonstrably moved past.
        //
        //     IT RUNS BEFORE THE PLAN. Nothing below has happened yet: no metadata
        //     canonicalization, no plan, no mutation identity, no transaction, no journal
        //     write, no wallet prompt, no signature, no marker and no send. A refusal here
        //     costs the attempt nothing and leaves nothing to resolve.
        //
        //     METADATA CANONICALIZATION IS NOT A PREREQUISITE OF THIS THRESHOLD. The
        //     STATICALLY AUDITED upstream Metaplex runtime source rents a FIXED maximum
        //     allocation, so no name, symbol or URI can change what SETUP_METADATA costs —
        //     which is exactly why canonicalization now runs AFTER this step rather than
        //     before it. That audit is of SOURCE, not of the deployed program: see the
        //     two-layer provenance block above, where the SDK pin and the audited runtime
        //     revision are kept separate and deployed-runtime attestation stays mandatory.
        const solPreflight = await observeRedaxTeamAdminMutationSolPreflight(
          connection,
          approvedTeam,
          request.operation,
          Math.max(phaseA.contextSlot, phaseA.preStateContextSlot),
        )
        if (solPreflight.result === 'READ_UNAVAILABLE') {
          // FAIL-CLOSED, and deliberately NOT the insufficiency code: an unknown balance is
          // not evidence of a small one. Value-free — it names no term, byte length,
          // threshold or amount, and there is no metadata-rent-specific public code.
          return finish(
            false,
            await finalizeRedaxTeamAdminMutationSolRefusal(
              namespace,
              'CHAIN_GUARD_REFUSED',
              readRedaxTeamAdminMutationJournal,
            ),
          )
        }
        if (solPreflight.result === 'INSUFFICIENT') {
          return finish(
            false,
            await finalizeRedaxTeamAdminMutationSolRefusal(
              namespace,
              'PAYER_SOL_INSUFFICIENT',
              readRedaxTeamAdminMutationJournal,
            ),
          )
        }

        // 6d. BIND THE OBSERVATION'S CONTEXT INTO THE GUARD, BEFORE CONTINUING.
        //
        //     A SUFFICIENT verdict is authoritative only if the rest of the attempt describes
        //     a chain at least as new as the balance it was read from. The guard owns that
        //     floor: from here the blockhash, Phase B, the post-wallet reassertion and the
        //     guard-owned send floor are each unable to accept a context below this slot, and
        //     this root never reassembles the send floor itself.
        //
        //     A REFUSED BIND IS FATAL TO THE ATTEMPT — an unbound observation is not
        //     authoritative, so continuing on one would be continuing on a balance nothing
        //     later checked against.
        if (
          !bindRedaxTeamAdminMutationSolPreflightContextFloor({
            snapshot: phaseA.snapshot,
            connection,
            balanceContextSlot: solPreflight.balanceContextSlot,
          })
        ) {
          return finish(
            false,
            await finalizeRedaxTeamAdminMutationSolRefusal(
              namespace,
              'CHAIN_GUARD_REFUSED',
              readRedaxTeamAdminMutationJournal,
            ),
          )
        }

        // 7. THE CANONICAL METADATA, where the operation has any. Well-formedness, NFC for
        //    name and symbol, exact allowlisted URI bytes and the program's byte bounds —
        //    all decided before an identity or an instruction can exist.
        let canonicalMetadata: Awaited<ReturnType<typeof canonicalizeRedaxTeamAdminMetadata>> | null =
          null
        if (request.operation === 'SETUP_METADATA') {
          canonicalMetadata = await canonicalizeRedaxTeamAdminMetadata(
            {
              name: request.metadataName,
              symbol: request.metadataSymbol,
              uri: request.metadataUri,
            },
            { uriAllowlist: metadataUriAllowlist },
          )
          if (!canonicalMetadata.ok) {
            return finish(false, 'METADATA_NOT_CANONICAL')
          }
        }

        // 8. THE PLAN. Pure, and admitted against the FRESH pre-state Phase A read — never
        //    against a caller input and never against loaded product data.
        //
        //    THE OPERATION IS DISCRIMINATED EXHAUSTIVELY, one arm per member of the closed
        //    six, and each arm builds exactly its OWN request variant. A conditional chain
        //    could not: its middle test is a CONJUNCTION, and TypeScript does not narrow
        //    the false branch of one — so the final arm saw the whole remaining union and
        //    built a request whose `operation` was five literals wide. A `switch` narrows
        //    per case, and the `never` below turns a seventh operation into a COMPILE
        //    failure instead of a silent fall-through into a plan built for something else.
        const observedPreState: RedaxTeamAdminMutationObservedPreStateV1 = {
          campaignStatus: phaseA.campaign.status,
          metadataSetup: phaseA.campaign.metadataSetup,
          tokenConfigCount: phaseA.campaign.tokenConfigCount,
          campaignAdmin: phaseA.campaign.campaignAdmin,
          outputMint: phaseA.campaign.outputMint,
          targetAccountAbsent: phaseA.targetAccountAbsent,
        }
        let planRequest: RedaxTeamAdminMutationPlanRequest
        switch (request.operation) {
          case 'ADD_TOKEN_CONFIG':
            planRequest = {
              programId,
              approvedTeamWallet: approvedTeam,
              campaign,
              observedPreState,
              operation: 'ADD_TOKEN_CONFIG',
              legacyMint: new PublicKey(request.legacyMint),
              outputMint: new PublicKey(request.outputMint),
              rateNumerator: request.rateNumerator,
              rateDenominator: request.rateDenominator,
              maxOutputFromTokenConfig: request.maxOutputFromTokenConfig,
            }
            break
          case 'SETUP_METADATA':
            // Step 7 ALREADY canonicalized and ALREADY refused a non-canonical input.
            // Restating the condition is how this arm reaches `metadata` fail-closed: a
            // non-null assertion, an `as` cast or an `any` would each SUPPRESS the question
            // rather than answer it, and this way a state that cannot occur still refuses
            // instead of planning against metadata nothing validated.
            if (canonicalMetadata === null || !canonicalMetadata.ok) {
              return finish(false, 'METADATA_NOT_CANONICAL')
            }
            planRequest = {
              programId,
              approvedTeamWallet: approvedTeam,
              campaign,
              observedPreState,
              operation: 'SETUP_METADATA',
              outputMint: new PublicKey(request.outputMint),
              metadata: canonicalMetadata.metadata,
            }
            break
          case 'ACTIVATE_CAMPAIGN':
            planRequest = {
              programId,
              approvedTeamWallet: approvedTeam,
              campaign,
              observedPreState,
              operation: 'ACTIVATE_CAMPAIGN',
            }
            break
          case 'PAUSE_CAMPAIGN':
            planRequest = {
              programId,
              approvedTeamWallet: approvedTeam,
              campaign,
              observedPreState,
              operation: 'PAUSE_CAMPAIGN',
            }
            break
          case 'UNPAUSE_CAMPAIGN':
            planRequest = {
              programId,
              approvedTeamWallet: approvedTeam,
              campaign,
              observedPreState,
              operation: 'UNPAUSE_CAMPAIGN',
            }
            break
          case 'FINALIZE_CAMPAIGN':
            planRequest = {
              programId,
              approvedTeamWallet: approvedTeam,
              campaign,
              observedPreState,
              operation: 'FINALIZE_CAMPAIGN',
            }
            break
          default: {
            // Outside the closed six. `request` is `never` here, so this arm is unreachable
            // through the type and refuses for callers the type system never saw.
            const exhaustive: never = request
            void exhaustive
            return finish(false, 'REQUEST_INVALID')
          }
        }
        const planned = planRedaxTeamAdminMutation(planRequest)
        if (!planned.ok) {
          return finish(
            false,
            planned.code === 'PRE_STATE_NOT_ADMISSIBLE' ? 'PRE_STATE_NOT_ADMISSIBLE' : 'PLAN_INVALID',
          )
        }
        const plan = planned.plan

        // 9. THE MUTATION IDENTITY, from the plan's own assembled request — never from
        //    anything a caller could have supplied beside it.
        const identity = await computeRedaxTeamAdminMutationIdentity(plan.identityRequest)
        if (!identity.ok) {
          return finish(false, 'MUTATION_IDENTITY_UNAVAILABLE')
        }
        identityHex = identity.identity.sha256Hex

        // 10/11/12/13/14. EXACTLY ONE legacy Transaction, carrying EXACTLY ONE REDAX
        //    instruction. NO ComputeBudget instruction: none is authorized for this
        //    corridor, and adding one would change the message that is about to be
        //    committed to and signed.
        const transaction = new Transaction().add(plan.instruction)
        transaction.feePayer = approvedTeam

        // 15. THE GUARDED LATE BLOCKHASH, at a context that may not regress below Phase A.
        const blockhash = await fetchRedaxTeamAdminMutationAttemptBlockhash({
          connection,
          snapshot: phaseA.snapshot,
        })
        if (!blockhash.ok) {
          return finish(false, 'CHAIN_GUARD_REFUSED')
        }
        transaction.recentBlockhash = blockhash.blockhash

        // 16. SERIALIZE THE LEGACY MESSAGE EXACTLY ONCE, BEFORE any signature exists — so the
        //     committed bytes are the unsigned message every later comparison is against.
        //     `serializeMessage` hands back a view, and the frozen original must be memory
        //     nothing else can write through, so it is copied. This is the ONLY message
        //     serialization the whole attempt performs, and nothing re-serializes anything
        //     after the wallet returns.
        let serializedMessage: Uint8Array
        try {
          serializedMessage = transaction.serializeMessage()
        } catch {
          return finish(false, 'MESSAGE_COMMITMENT_UNAVAILABLE')
        }
        const intendedMessageBytes = Uint8Array.from(serializedMessage)

        // 17. THE TWO COMMITMENTS, over the SAME exact bytes.
        //
        //     The mutation corridor's own commitment is what the exact-one verifier checks;
        //     the action-agnostic one is what the shared outcome module later compares a
        //     LANDED message against. They are separate schemes on purpose — a commitment
        //     taken for one corridor is not structurally interchangeable with another's —
        //     and requiring their digests to agree makes two independent implementations
        //     corroborate the same bytes rather than one being taken on trust.
        const committed = await commitRedaxTeamAdminMutationIntendedLegacyMessage(
          intendedMessageBytes,
        )
        const outcomeCommitment = await commitRedaxIntendedLegacyMessage(intendedMessageBytes)
        if (!committed.ok || !outcomeCommitment.ok) {
          return finish(false, 'MESSAGE_COMMITMENT_UNAVAILABLE')
        }
        if (
          committed.commitment.sha256Hex !== outcomeCommitment.commitment.sha256Hex ||
          committed.commitment.byteLength !== outcomeCommitment.commitment.byteLength
        ) {
          return finish(false, 'MESSAGE_COMMITMENT_UNAVAILABLE')
        }

        // 18/19. THE TWO-GATE RE-ENTRY MODEL, and then the durable slot.
        //
        //     GATE ONE: ANY unresolved record blocks EVERY new mutation — same Campaign or
        //     different, same operation or different, same identity or different. It is now
        //     applied EARLIER, at step 6b, so an unresolved attempt outranks a SOL
        //     insufficiency instead of being reported after one. Its semantics are unchanged.
        //
        //     GATE TWO, UNCHANGED AND STILL HERE: a terminal record carrying THIS SAME
        //     mutation identity is admitted only when it proves no effect occurred, or when
        //     the operation is a repeatable lifecycle step whose required predecessor the
        //     FRESH pre-state has restored — which the plan above already proved, because it
        //     was admitted against that fresh read. A once-only operation whose identity
        //     already SUCCEEDED is refused permanently, and changing a rate or a cap for the
        //     same legacy mint is not a new mutation: its PDA is the same one, so its target
        //     is no longer absent. It must stay here because it needs the plan and the
        //     mutation identity, neither of which exists at step 6b.
        //
        //     THE ORDINARY SECOND PRE-BEGIN READ IS GONE. It existed only to rediscover the
        //     same slot step 6b already read, and re-reading would be a duplicate whose
        //     answer could differ from the one this attempt was admitted against. Nothing is
        //     weakened: that read was ADVISORY, and `begin` below is compare-and-set under
        //     the journal's Web Lock — it refuses a concurrent newer ACTIVE record on its
        //     own, which is the only place such a race could ever have been caught safely.
        let replaces: { attemptNonce: string; revision: number } | null = null
        if (earlyTombstone !== null) {
          const previous = earlyTombstone
          if (
            previous.mutationIdentitySha256Hex === identity.identity.sha256Hex &&
            previous.resolution !== null
          ) {
            const proveNoEffect = SAME_IDENTITY_REENTRY_AFTER.includes(previous.resolution)
            const succeeded = isSuccessResolution(previous.resolution)
            if (succeeded && ONCE_ONLY_OPERATIONS.includes(plan.operation)) {
              return finish(false, 'MUTATION_IDENTITY_ALREADY_FULFILLED')
            }
            if (!proveNoEffect && !succeeded) {
              // An unexplained or support-blocking terminal. It is not proof of no effect,
              // so the same identity may not be re-entered from it.
              return finish(false, 'MUTATION_IDENTITY_ALREADY_FULFILLED')
            }
          }
          replaces = { attemptNonce: previous.attemptNonce, revision: previous.revision }
        }

        // THE EXPECTED PUFFED DIGESTS, derived FORWARD from the canonical bytes: padded with
        // `0x00` to the fixed stored widths, then hashed. They are recorded beside the
        // canonical digests so a LATER reconcile — which no longer holds the bytes — can still
        // assert exact metadata attribution instead of reporting an unresolved outcome for a
        // mutation that plainly succeeded. Nothing here inverts an account.
        let metadataDigests: {
          nameSha256Hex: string
          nameByteLength: number
          symbolSha256Hex: string
          symbolByteLength: number
          uriSha256Hex: string
          uriByteLength: number
          expectedPuffedNameSha256Hex: string
          expectedPuffedSymbolSha256Hex: string
          expectedPuffedUriSha256Hex: string
        } | null = null
        if (
          request.operation === 'SETUP_METADATA' &&
          canonicalMetadata !== null &&
          canonicalMetadata.ok
        ) {
          const puffed = expectedRedaxTeamAdminPuffedMetadata(canonicalMetadata.metadata)
          if (puffed === null) {
            return finish(false, 'METADATA_NOT_CANONICAL')
          }
          const puffedDigests = await Promise.all([
            sha256HexOf(puffed.name),
            sha256HexOf(puffed.symbol),
            sha256HexOf(puffed.uri),
          ])
          if (puffedDigests.some((digest) => digest === null)) {
            return finish(false, 'METADATA_NOT_CANONICAL')
          }
          metadataDigests = {
            nameSha256Hex: canonicalMetadata.metadata.name.sha256Hex,
            nameByteLength: canonicalMetadata.metadata.name.byteLength,
            symbolSha256Hex: canonicalMetadata.metadata.symbol.sha256Hex,
            symbolByteLength: canonicalMetadata.metadata.symbol.byteLength,
            uriSha256Hex: canonicalMetadata.metadata.uri.sha256Hex,
            uriByteLength: canonicalMetadata.metadata.uri.byteLength,
            expectedPuffedNameSha256Hex: puffedDigests[0] as string,
            expectedPuffedSymbolSha256Hex: puffedDigests[1] as string,
            expectedPuffedUriSha256Hex: puffedDigests[2] as string,
          }
        }

        const witnessFacts: RedaxTeamAdminMutationWitnessFactsV1 =
          plan.witness.kind === 'NONE'
            ? { kind: 'NONE', address: null }
            : { kind: plan.witness.kind, address: plan.witness.address }

        const begun = await beginRedaxTeamAdminMutationAttempt({
          namespace,
          campaign: request.campaign,
          operation: plan.operation,
          mutationIdentitySha256Hex: identity.identity.sha256Hex,
          // ONLY approved public facts. There is no key, no signature, no wire, no endpoint
          // and no raw error here, and the record type has no field for one.
          request: requestFactsFor(
            request,
            phaseA.campaign.status,
            plan.expectedImmediatePostState.campaignStatus,
            metadataDigests,
          ),
          witness: witnessFacts,
          preState: {
            campaignStatus: phaseA.campaign.status,
            metadataSetup: phaseA.campaign.metadataSetup,
            tokenConfigCount: phaseA.campaign.tokenConfigCount,
            campaignAdmin: phaseA.campaign.campaignAdmin,
            outputMint: phaseA.campaign.outputMint,
            targetAccountAbsent: phaseA.targetAccountAbsent,
            contextSlot: phaseA.preStateContextSlot,
          },
          intendedMessage: committed.commitment,
          blockhashValidity: {
            preflightContextSlot: Math.max(
              phaseA.contextSlot,
              phaseA.preStateContextSlot,
              blockhash.blockhashContextSlot,
            ),
            lastValidBlockHeight: blockhash.lastValidBlockHeight,
          },
          replaces,
        })
        if (!begun.ok) {
          return finish(
            false,
            begun.code === 'ACTIVE_ATTEMPT_EXISTS' || begun.code === 'TOMBSTONE_NOT_REPLACEABLE'
              ? 'ATTEMPT_BLOCKED'
              : 'JOURNAL_UNAVAILABLE',
          )
        }
        // THE COMPARE-AND-SET CURSOR, and it is a `let` on purpose. This route writes a CHAIN
        // of durable transitions, and every link must present the revision the previous link
        // produced — read back from durable bytes, never taken from a return value.
        let cursor = { attemptNonce: begun.record.attemptNonce, revision: begun.record.revision }

        /** Write one durable transition and READ IT BACK. A write nobody verified is not one. */
        const applyAndVerify = async (
          transition: Parameters<typeof transitionRedaxTeamAdminMutationAttempt>[0]['transition'],
          expect: {
            readonly lifecycle: RedaxTeamAdminMutationRecordV1['lifecycle']
            readonly observation: RedaxTeamAdminMutationObservation | null
            readonly resolution: RedaxTeamAdminMutationResolution | null
            readonly knownSignature: string | null
            readonly issueCodes: readonly RedaxTeamAdminMutationIssueCode[]
          },
        ): Promise<boolean> => {
          const written = await transitionRedaxTeamAdminMutationAttempt({
            namespace,
            expectedAttemptNonce: cursor.attemptNonce,
            expectedRevision: cursor.revision,
            transition,
          })
          if (!written.ok) {
            return false
          }
          const readBack = await readRedaxTeamAdminMutationJournal(namespace)
          if (!readBack.ok || readBack.kind === 'EMPTY') {
            return false
          }
          const record = readBack.record
          const matches =
            record.attemptNonce === written.record.attemptNonce &&
            record.revision === written.record.revision &&
            record.lifecycle === expect.lifecycle &&
            record.observation === expect.observation &&
            record.resolution === expect.resolution &&
            record.knownSignature === expect.knownSignature &&
            // AN EXACT SET, not an exact sequence. The journal emits issue codes in ITS own
            // canonical order, and both sides are duplicate-free by construction — so equal
            // length plus containment IS exact equality here.
            record.issueCodes.length === expect.issueCodes.length &&
            expect.issueCodes.every((code) => record.issueCodes.includes(code))
          if (!matches) {
            return false
          }
          cursor = { attemptNonce: record.attemptNonce, revision: record.revision }
          return true
        }

        /**
         * THE PRE-RAW-SEND NO-BROADCAST TERMINAL, and ONLY where it is truthful.
         *
         * EVERY call site below is strictly before the one raw send. The transition itself
         * would refuse otherwise — it is origin-only and forbidden from `KNOWN_SIGNATURE` —
         * so this is not a rule that could be broken quietly here; but it is also the reason
         * no path after the send calls it, and no path after the send does.
         *
         * If the terminal write or its read-back fails, the record is deliberately left
         * UNRESOLVED. An unresolved pre-raw-send record is still literally true — the point
         * of no return was not crossed — and it blocks a new attempt by construction, which
         * is the conservative failure rather than the dangerous one.
         */
        const resolveNoBroadcast = async (
          observation: RedaxTeamAdminMutationObservation,
          issueCodes: readonly RedaxTeamAdminMutationIssueCode[],
        ): Promise<void> => {
          const observed = await applyAndVerify(
            { type: 'RECORD_OBSERVATION', observation, issueCodes },
            {
              lifecycle: 'PRE_RAW_SEND',
              observation,
              resolution: null,
              knownSignature: null,
              issueCodes,
            },
          )
          if (!observed) {
            return
          }
          await applyAndVerify(
            { type: 'RESOLVE_PRE_RAW_SEND_NO_BROADCAST' },
            {
              lifecycle: 'TOMBSTONE',
              observation,
              resolution: 'RESOLVED_PRE_RAW_SEND_NO_BROADCAST',
              knownSignature: null,
              issueCodes,
            },
          )
        }

        // 20. READ-BACK / VERIFY the exact opened record BEFORE anything is signed.
        const openedReadBack = await readRedaxTeamAdminMutationJournal(namespace)
        if (
          !openedReadBack.ok ||
          openedReadBack.kind !== 'ACTIVE' ||
          openedReadBack.record.attemptNonce !== cursor.attemptNonce ||
          openedReadBack.record.revision !== cursor.revision ||
          openedReadBack.record.lifecycle !== 'PRE_RAW_SEND' ||
          openedReadBack.record.mutationIdentitySha256Hex !== identity.identity.sha256Hex ||
          openedReadBack.record.intendedMessage.sha256Hex !== committed.commitment.sha256Hex ||
          openedReadBack.record.intendedMessage.byteLength !== committed.commitment.byteLength
        ) {
          return finish(false, 'JOURNAL_UNAVAILABLE')
        }

        const planIdentity: RedaxTeamAdminMutationFrozenPlanIdentity = {
          campaign,
          operation: plan.operation,
          mutationIdentitySha256Hex: identity.identity.sha256Hex,
          witnessAddress: plan.witness.kind === 'NONE' ? null : plan.witness.address,
        }

        // 21. A fresh broker key read, immediately before Phase B.
        const walletBeforeSign = readLiveTeamWallet(broker)
        if (walletBeforeSign === null) {
          await resolveNoBroadcast('PRE_RAW_SEND_REFUSED', ['SIGN_ONLY_REFUSAL'])
          return finish(false, 'WALLET_NOT_CONNECTED')
        }

        // 22. PHASE B — every mutable fact re-read and re-decided, immediately before the one
        //     wallet request. That includes the frozen ADMISSION FOOTPRINT, which is
        //     OPERATION-SPECIFIC: exactly the facts THIS operation's own admission consumed
        //     must still be what Phase A admitted this plan against, and a fact it never
        //     consumed is not compared at all. A refusal here is strictly before the prompt,
        //     so `walletPromptCount` stays `0` and nothing was signed.
        const phaseB = await checkRedaxTeamAdminMutationGuardPhaseB({
          connection,
          snapshot: phaseA.snapshot,
          runtime: guardRuntime,
          connectedWallet: walletBeforeSign,
          plan: planIdentity,
          target,
          blockhash: blockhash.blockhash,
          blockhashContextSlot: blockhash.blockhashContextSlot,
          mintPreflight,
        })
        if (!phaseB.ok) {
          await resolveNoBroadcast('PRE_RAW_SEND_REFUSED', ['CHAIN_GUARD_REFUSAL'])
          return finish(false, 'CHAIN_GUARD_REFUSED')
        }

        // 22b. THE EXTERNAL WRITE GATE — the last question before the wallet is asked. Any NO,
        //      including a throw, settles the record as not sent; the prompt never happens.
        let gateStillAdmits: (() => boolean) | null = null
        if (writeGate !== null) {
          try {
            const decision = await writeGate.admit({
              operation: plan.operation,
              teamWallet: approvedTeam.toBase58(),
              campaign: campaign.toBase58(),
              mutationIdentitySha256Hex: identity.identity.sha256Hex,
              request,
            })
            if (decision !== null && typeof decision === 'object' && decision.ok === true) {
              const decisionStillCurrent = decision.stillCurrent
              gateStillAdmits = (): boolean => {
                const live = liveGateRef.current
                if (live.writeGate !== writeGate || live.approvedTeamWallet !== approvedTeamWallet) {
                  return false
                }
                if (request.operation === 'SETUP_METADATA' && !live.metadataUriAllowlist.includes(request.metadataUri)) {
                  return false
                }
                if (typeof decisionStillCurrent !== 'function') {
                  return true
                }
                try {
                  return decisionStillCurrent() === true
                } catch {
                  return false
                }
              }
            }
          } catch {
            gateStillAdmits = null
          }
          if (gateStillAdmits === null || !gateStillAdmits()) {
            await resolveNoBroadcast('PRE_RAW_SEND_REFUSED', ['CHAIN_GUARD_REFUSAL'])
            return finish(false, 'WRITE_GATE_REFUSED')
          }
        }

        // 22c. The admission, asked once more immediately before the prompt.
        if (gateStillAdmits !== null && !gateStillAdmits()) {
          await resolveNoBroadcast('PRE_RAW_SEND_REFUSED', ['CHAIN_GUARD_REFUSAL'])
          return finish(false, 'WRITE_GATE_REFUSED')
        }

        // 23. THE ONE SIGN-ONLY REQUEST. The wallet is asked EXACTLY once. This is not a
        //     broadcast and there is nothing behind it that could become one: the broker has
        //     no send member, and there is no retry, no second prompt and no fallback.
        promptCount = 1
        let signedWire: Uint8Array
        try {
          signedWire = await broker.signTeamAdminMutationLegacyTransactionBytes(transaction)
        } catch {
          // The thrown value is NOT inspected and never leaves: nothing was broadcast either
          // way, so no wallet error text could add anything true.
          await resolveNoBroadcast('PRE_RAW_SEND_REFUSED', ['SIGN_ONLY_REFUSAL'])
          return finish(false, 'WALLET_SIGN_ONLY_REFUSED')
        }

        // 24. THE EXACT-ONE-SIGNATURE VERIFICATION, against the EXACT committed bytes.
        //     Nothing is serialized, recompiled or normalized here.
        const verified = await verifyRedaxTeamAdminMutationSignedWire({
          wire: signedWire,
          teamWallet: approvedTeam.toBytes(),
          intendedMessage: intendedMessageBytes,
          intendedMessageByteLength: committed.commitment.byteLength,
          intendedMessageSha256Hex: committed.commitment.sha256Hex,
        })
        if (!verified.ok) {
          // ZERO broadcast, the no-broadcast terminal, and the artifact is discarded.
          await resolveNoBroadcast('PRE_RAW_SEND_REFUSED', ['SIGN_ONLY_REFUSAL'])
          return finish(false, 'SIGNED_ARTIFACT_REJECTED')
        }

        // 25. THE POST-WALLET REASSERTION. A verified artifact proves what the wallet did; it
        //     proves nothing about what the chain did while the prompt was open — so the SAME
        //     frozen operation-specific admission footprint is re-asserted here, from a fresh
        //     read, before the marker corridor and the one raw send. A Campaign whose OWN
        //     admission facts for this operation moved while the prompt was open refuses
        //     here, the verified artifact is discarded, and `broadcastCount` stays `0` — no
        //     marker is written that could imply the send became reachable.
        const walletAfterSign = readLiveTeamWallet(broker)
        const postWallet =
          walletAfterSign === null
            ? null
            : await reassertRedaxTeamAdminMutationGuardAfterWallet({
                connection,
                snapshot: phaseA.snapshot,
                runtime: guardRuntime,
                connectedWallet: walletAfterSign,
                plan: planIdentity,
                target,
                blockhash: blockhash.blockhash,
                blockhashContextSlot: blockhash.blockhashContextSlot,
                mintPreflight,
              })
        if (postWallet === null || !postWallet.ok) {
          await resolveNoBroadcast('PRE_RAW_SEND_REFUSED', ['CHAIN_GUARD_REFUSAL'])
          return finish(false, 'CHAIN_GUARD_REFUSED')
        }

        // 26. THE TRANSACTION'S IDENTITY, derived LOCALLY from signature slot 0 of the
        //     VERIFIED bytes. It exists before anything is sent, so it is exact and is
        //     independent of whatever the node does or does not return.
        const localRetention = retainRedaxKnownSignature(verified.knownSignatureBase58)
        if (!localRetention.ok) {
          await resolveNoBroadcast('PRE_RAW_SEND_REFUSED', ['SIGN_ONLY_REFUSAL'])
          return finish(false, 'SIGNED_ARTIFACT_REJECTED')
        }
        const localKnownSignature: RedaxKnownSignature = localRetention.knownSignature

        // 27/28. THE LOCAL-SIGNATURE MARKER, written and READ BACK. A write that succeeded
        //        and a write that can be read back are different facts, and only the second
        //        survives a tab close.
        const marked = await applyAndVerify(
          { type: 'MARK_PRE_RAW_SEND_SIGNATURE_LOCAL' },
          {
            lifecycle: 'PRE_RAW_SEND_SIGNATURE_LOCAL_NOT_RETAINED',
            observation: null,
            resolution: null,
            knownSignature: null,
            issueCodes: [],
          },
        )
        if (!marked) {
          // NO BROADCAST. The record is left unresolved, which is still literally true — the
          // point of no return was not crossed — and it blocks a new attempt by construction.
          return finish(false, 'PRE_RAW_SEND_RECORD_UNVERIFIED')
        }

        // 29. THE EXACT LOCAL SIGNATURE BECOMES DURABLE, and is READ BACK, BEFORE the
        //     irreversible act. That ordering removes the dangerous window entirely: a failure
        //     at the boundary can no longer leave a landed transaction whose signature REDAX
        //     never recorded.
        const retained = await applyAndVerify(
          { type: 'RETAIN_KNOWN_SIGNATURE', knownSignature: localKnownSignature },
          {
            lifecycle: 'KNOWN_SIGNATURE',
            observation: 'SIGNATURE_OBSERVED',
            resolution: null,
            knownSignature: localKnownSignature,
            issueCodes: [],
          },
        )
        if (!retained) {
          // NO BROADCAST, and more sharply: the durable record cannot yet NAME the
          // transaction that would exist.
          return finish(false, 'PRE_RAW_SEND_RECORD_UNVERIFIED')
        }

        // 30. THE POINT OF NO RETURN — the exact verified bytes, ONCE, on the attempt's own
        //     Connection. `signedWire` is the SAME value the verifier accepted: there is no
        //     reconstruction, no recompilation, no reserialization, no normalization, no
        //     second signing and no second prompt between the two.
        //
        //     ALL FOUR OPTIONS ARE WRITTEN EXPLICITLY. No provider default, adapter default,
        //     library default or ambient configuration is authority for any of them, because
        //     a default is a property of a dependency version and this is a property of this
        //     route. `minContextSlot` is the guard's OWN `sendContextFloor`, which this file
        //     never reassembles; and `maxRetries` is `0`, which is what makes "exactly one
        //     broadcast" a property of the wire rather than only of the application call
        //     count.
        //
        //     Nothing is awaited between the read-verified retention above and this call.
        broadcastCount = 1
        broadcastReached = true
        let broadcast: unknown = null
        let broadcastThrew = false
        try {
          broadcast = await connection.sendRawTransaction(signedWire, {
            skipPreflight: false,
            preflightCommitment: 'confirmed',
            minContextSlot: postWallet.sendContextFloor,
            maxRetries: 0,
          })
        } catch {
          // The thrown value is NOT bound, NOT inspected and NOT classified. A throw here is
          // NOT evidence that nothing was sent — the transaction may be on the wire, in a
          // leader's queue or already landed — so it is emphatically not a
          // failed-before-send, and nothing is sent again. The exact signature is already
          // known AND already durable, so reconciliation proceeds on that.
          broadcastThrew = true
        }

        // 31. A RETURNED SIGNATURE MUST *BE* THE SIGNATURE REDAX DERIVED AND RETAINED. No
        //     trim, no coercion, no normalization, no re-encoding, no alternate adoption.
        //     Equality makes the return corroboration and nothing more.
        if (!broadcastThrew) {
          const returned = retainRedaxKnownSignature(broadcast)
          if (returned.ok && returned.knownSignature !== localKnownSignature) {
            // USABLE BUT DIFFERENT. A node that returns a signature other than the one slot 0
            // already fixes is not describing this transaction, and the correct durable
            // statement is that the situation needs a human. The conflicting value is never
            // persisted, never logged, never adopted and NEVER QUERIED.
            await applyAndVerify(
              { type: 'RECORD_OBSERVATION', observation: 'SUPPORT_ONLY', issueCodes: [] },
              {
                lifecycle: 'KNOWN_SIGNATURE',
                observation: 'SUPPORT_ONLY',
                resolution: null,
                knownSignature: localKnownSignature,
                issueCodes: [],
              },
            )
            // `ACKNOWLEDGE_SUPPORT_DISPOSITION` is NOT written. It is permanently
            // non-replaceable, and reaching it automatically would let a machine close an
            // attempt nobody understood. This submit stops here, unresolved and blocking.
            return finish(false, 'OUTCOME_UNRESOLVED_SUPPORT')
          }
        }

        // 32. ONE observation of the outcome, then ONE durable terminal where the evidence
        //     determines one. There is no retry, no resend, no rebuild and no second prompt
        //     below this line.
        const settled = await settleMutationOutcome({
          connection,
          programId,
          namespace,
          target,
          localKnownSignature,
          applyAndVerify,
        })
        return finish(settled.ok, settled.code)
      } catch {
        // Value-free, unbound and unclassified. WHICH failure it is depends on whether the
        // one raw send had already been reached, because those are genuinely different facts
        // about the chain: before it, nothing was broadcast; after it, something may have
        // been. Neither grants a retry, a resend or a new attempt.
        return finish(
          false,
          broadcastReached
            ? 'MUTATION_POST_SEND_INTERNAL_FAILURE'
            : 'MUTATION_PREFLIGHT_INTERNAL_FAILURE',
        )
      }
    },
    [approvedTeamWallet, broker, claimFlight, metadataUriAllowlist, releaseFlight, writeGate],
  )

  // ===========================================================================
  // THE ONE RECONCILIATION ENTRY POINT — ZERO ARGUMENTS
  // ===========================================================================
  //
  // It reads the current journal namespace and reconciles only that durable record. It
  // builds no instruction and no `Transaction`, never invokes the wallet, never signs, never
  // sends, never simulates and never starts a new mutation. It requires no connected wallet,
  // so recovery survives a refresh or a disconnect.
  const reconcileMutation = useCallback(async (): Promise<RedaxTeamAdminMutationReconcileResult> => {
    const answer = (
      ok: boolean,
      code: RedaxTeamAdminMutationReconcileCode,
    ): RedaxTeamAdminMutationReconcileResult => {
      releaseFlight()
      return { ok, code, rawBroadcastCount: 0, walletPromptCount: 0, busy: false }
    }

    if (!claimFlight()) {
      return {
        ok: false,
        code: 'OUTCOME_STILL_UNRESOLVED',
        rawBroadcastCount: 0,
        walletPromptCount: 0,
        busy: true,
      }
    }

    try {
      const runtimeConfig = resolveRedaxRuntimeActionConfig()
      if (!runtimeConfig.ok) {
        return answer(false, 'RUNTIME_CONFIG_UNAVAILABLE')
      }
      if (approvedTeamWallet === null) {
        return answer(false, 'APPROVED_TEAM_IDENTITY_UNAVAILABLE')
      }
      let approvedTeam: PublicKey
      let programId: PublicKey
      try {
        approvedTeam = new PublicKey(approvedTeamWallet)
        programId = new PublicKey(runtimeConfig.programId)
      } catch {
        return answer(false, 'APPROVED_TEAM_IDENTITY_UNAVAILABLE')
      }

      const namespace: RedaxTeamAdminMutationNamespace = {
        cluster: REDAX_TEAM_ADMIN_MUTATION_JOURNAL_CLUSTER,
        program: programId.toBase58(),
        teamWallet: approvedTeam.toBase58(),
      }
      const read = await readRedaxTeamAdminMutationJournal(namespace)
      if (!read.ok) {
        return answer(false, 'JOURNAL_UNAVAILABLE')
      }
      if (read.kind === 'EMPTY') {
        return answer(false, 'NO_RECORD')
      }
      if (read.kind === 'TOMBSTONE') {
        // Already terminal. This is also the LATER EXACT READ that classifies a terminal
        // whose own write could not be verified: an already-resolved record proves the write
        // landed after all.
        return answer(true, 'ALREADY_RESOLVED')
      }

      const record = read.record
      let cursor = { attemptNonce: record.attemptNonce, revision: record.revision }

      const applyAndVerify = async (
        transition: Parameters<typeof transitionRedaxTeamAdminMutationAttempt>[0]['transition'],
        expect: {
          readonly lifecycle: RedaxTeamAdminMutationRecordV1['lifecycle']
          readonly observation: RedaxTeamAdminMutationObservation | null
          readonly resolution: RedaxTeamAdminMutationResolution | null
          readonly knownSignature: string | null
          readonly issueCodes: readonly RedaxTeamAdminMutationIssueCode[]
        },
      ): Promise<boolean> => {
        const written = await transitionRedaxTeamAdminMutationAttempt({
          namespace,
          expectedAttemptNonce: cursor.attemptNonce,
          expectedRevision: cursor.revision,
          transition,
        })
        if (!written.ok) {
          return false
        }
        const readBack = await readRedaxTeamAdminMutationJournal(namespace)
        if (!readBack.ok || readBack.kind === 'EMPTY') {
          return false
        }
        const back = readBack.record
        const matches =
          back.attemptNonce === written.record.attemptNonce &&
          back.revision === written.record.revision &&
          back.lifecycle === expect.lifecycle &&
          back.observation === expect.observation &&
          back.resolution === expect.resolution &&
          back.knownSignature === expect.knownSignature &&
          back.issueCodes.length === expect.issueCodes.length &&
          expect.issueCodes.every((code) => back.issueCodes.includes(code))
        if (!matches) {
          return false
        }
        cursor = { attemptNonce: back.attemptNonce, revision: back.revision }
        return true
      }

      // A PRE-RAW-SEND record: the point of no return was never crossed, so the only terminal
      // it may reach is the no-broadcast one.
      //
      // THIS WORKS AFTER A RELOAD, AND THAT IS THE POINT. The durable record survives the
      // realm that wrote it, and a page refresh or a new tab is exactly when a human comes
      // back to reconcile. The journal admits the pre-raw-send terminal from either
      // pre-raw-send lifecycle regardless of which realm created the attempt, because the
      // no-broadcast fact is STRUCTURAL rather than remembered: the raw send is unreachable
      // until a signature has been durably retained AND read back, so a record still in the
      // pre-raw-send family provably never reached it. What the journal does NOT relax is
      // everything that makes the claim safe — a `KNOWN_SIGNATURE` record can never reach
      // this terminal, a record already carrying a signature can never reach it, a
      // `TOMBSTONE` is terminal, live deletion and rollback are still detected, and every
      // write is still exact compare-and-set on both the nonce and the revision.
      if (
        record.lifecycle === 'PRE_RAW_SEND' ||
        record.lifecycle === 'PRE_RAW_SEND_SIGNATURE_LOCAL_NOT_RETAINED'
      ) {
        const observed = await applyAndVerify(
          {
            type: 'RECORD_OBSERVATION',
            observation: 'PRE_RAW_SEND_REFUSED',
            issueCodes: [],
          },
          {
            lifecycle: record.lifecycle,
            observation: 'PRE_RAW_SEND_REFUSED',
            resolution: null,
            knownSignature: null,
            issueCodes: [],
          },
        )
        if (!observed) {
          return answer(false, 'OUTCOME_STILL_UNRESOLVED')
        }
        const resolved = await applyAndVerify(
          { type: 'RESOLVE_PRE_RAW_SEND_NO_BROADCAST' },
          {
            lifecycle: 'TOMBSTONE',
            observation: 'PRE_RAW_SEND_REFUSED',
            resolution: 'RESOLVED_PRE_RAW_SEND_NO_BROADCAST',
            knownSignature: null,
            issueCodes: [],
          },
        )
        return resolved
          ? answer(true, 'PRE_RAW_SEND_NO_BROADCAST_RESOLVED')
          : answer(false, 'TERMINAL_RECORD_UNVERIFIED')
      }

      // A KNOWN_SIGNATURE record. The RETAINED signature is the only handle used — never a
      // value a node returned, and never one reconstructed here.
      const knownSignature = record.knownSignature
      if (knownSignature === null) {
        return answer(false, 'OUTCOME_STILL_UNRESOLVED')
      }
      const retained = retainRedaxKnownSignature(knownSignature)
      if (!retained.ok) {
        return answer(false, 'OUTCOME_STILL_UNRESOLVED')
      }

      const connection = new Connection(
        runtimeConfig.rpcUrl,
        REDAX_TEAM_ADMIN_MUTATION_ACTION_COMMITMENT,
      )
      const target = targetForRecord(programId, record)
      if (target === null) {
        return answer(false, 'OUTCOME_STILL_UNRESOLVED')
      }

      const settled = await settleMutationOutcomeForRecord({
        connection,
        programId,
        namespace,
        record,
        target,
        knownSignature: retained.knownSignature,
        applyAndVerify,
      })
      return answer(settled.ok, settled.code)
    } catch {
      // Value-free and unclassified. Reconciliation broadcast nothing and signed nothing, so
      // a failure here grants no retry, no resend and no new attempt.
      return answer(false, 'MUTATION_POST_SEND_INTERNAL_FAILURE')
    }
  }, [approvedTeamWallet, claimFlight, releaseFlight])

  // ===========================================================================
  // THE ONE READ-ONLY STATUS ENTRY POINT — ZERO ARGUMENTS, ZERO WRITES
  // ===========================================================================
  //
  // IT WRITES NOTHING. No `beginRedaxTeamAdminMutationAttempt`, no
  // `transitionRedaxTeamAdminMutationAttempt`, no reconcile, no classification, no
  // `Connection`, no `Transaction`, no wallet request and no send. It takes no arguments,
  // so a consumer cannot point it at a namespace this root did not build, and it returns a
  // SANITIZED PROJECTION rather than the record: everything that could identify, replay or
  // re-derive an attempt stays inside this file.
  //
  // IT DOES NOT REQUIRE A CONNECTED WALLET, deliberately. Namespace authority comes from
  // the approved-Team deployment identity and the runtime program configuration, never
  // from whatever happens to be connected — and a reload or a disconnect is exactly when a
  // human needs to see what is already known. Connected-wallet equality remains a SUBMIT
  // admission requirement and is not one here, because reading writes nothing.
  //
  // IT DOES NOT TAKE THE SINGLE-FLIGHT LATCH. The latch exists to stop this tab racing
  // itself into two attempts; a read starts none, and taking it would let a status read
  // and a submit refuse each other for no safety reason. The journal's own exclusive lock
  // is what keeps this read from observing a half-written value.
  const readMutationStatus =
    useCallback(async (): Promise<RedaxTeamAdminMutationStatusReadResult> => {
      try {
        const runtimeConfig = resolveRedaxRuntimeActionConfig()
        if (!runtimeConfig.ok) {
          return { ok: false, code: 'RUNTIME_CONFIG_UNAVAILABLE' }
        }
        if (approvedTeamWallet === null) {
          return { ok: false, code: 'APPROVED_TEAM_IDENTITY_UNAVAILABLE' }
        }
        let approvedTeam: PublicKey
        let programId: PublicKey
        try {
          approvedTeam = new PublicKey(approvedTeamWallet)
          programId = new PublicKey(runtimeConfig.programId)
        } catch {
          return { ok: false, code: 'APPROVED_TEAM_IDENTITY_UNAVAILABLE' }
        }

        // THE SAME NAMESPACE `submitMutation` AND `reconcileMutation` BUILD, built the same
        // way from the same two private inputs. One authority, three readers.
        const namespace: RedaxTeamAdminMutationNamespace = {
          cluster: REDAX_TEAM_ADMIN_MUTATION_JOURNAL_CLUSTER,
          program: programId.toBase58(),
          teamWallet: approvedTeam.toBase58(),
        }
        const read = await readRedaxTeamAdminMutationJournal(namespace)
        if (!read.ok) {
          // Every storage, lock, schema and corruption failure collapses to ONE code. A
          // refusal is never a licence to start an attempt, and a caller learns nothing
          // about the shape of the failure.
          return { ok: false, code: 'JOURNAL_UNAVAILABLE' }
        }
        if (read.kind === 'EMPTY') {
          return { ok: true, presence: 'EMPTY' }
        }

        const record = read.record
        // The ADD projection is ALL FOUR FIELDS OR NOTHING. The journal already refuses an
        // incoherent record, so a record that reaches here claiming `ADD_TOKEN_CONFIG`
        // without its four canonical values is unreadable rather than partially readable.
        let addTokenConfigRequest: RedaxTeamAdminAddTokenConfigStatusRequest | null = null
        if (record.operation === 'ADD_TOKEN_CONFIG') {
          const request = record.request
          if (
            request.legacyMint === null ||
            request.rateNumerator === null ||
            request.rateDenominator === null ||
            request.maxOutputFromTokenConfig === null
          ) {
            return { ok: false, code: 'JOURNAL_UNAVAILABLE' }
          }
          addTokenConfigRequest = {
            legacyMint: request.legacyMint,
            rateNumerator: request.rateNumerator,
            rateDenominator: request.rateDenominator,
            maxOutputFromTokenConfig: request.maxOutputFromTokenConfig,
          }
        }
        const projection: RedaxTeamAdminMutationStatusRecordProjection = {
          operation: record.operation,
          campaign: record.campaign,
          mutationIdentitySha256Hex: record.mutationIdentitySha256Hex,
          witnessAddress: record.witness.address,
          addTokenConfigRequest,
        }

        if (read.kind === 'TOMBSTONE') {
          if (record.resolution === null) {
            // A terminal with no disposition is not a terminal this projection can
            // describe. Unreadable, rather than reported as an unresolved one.
            return { ok: false, code: 'JOURNAL_UNAVAILABLE' }
          }
          return {
            ok: true,
            presence: 'TOMBSTONE',
            lifecycle: 'TOMBSTONE',
            resolution: record.resolution,
            ...projection,
          }
        }
        if (record.lifecycle === 'TOMBSTONE') {
          return { ok: false, code: 'JOURNAL_UNAVAILABLE' }
        }
        return {
          ok: true,
          presence: 'ACTIVE',
          lifecycle: record.lifecycle,
          resolution: null,
          ...projection,
        }
      } catch {
        // Value-free and unclassified. Nothing was written, nothing was transitioned and
        // nothing was sent, so there is no outcome here to report beyond "unreadable".
        return { ok: false, code: 'JOURNAL_UNAVAILABLE' }
      }
    }, [approvedTeamWallet])

  /**
   * C1 — THE PASSIVE, OPERATION-SCOPED, READ-ONLY DEVNET SOL READ.
   *
   * EVERY PRECONDITION IS RESOLVED HERE, from the same private sources `submitMutation` uses,
   * so a caller cannot steer it: the bounded runtime configuration, the broker's own current
   * key, and the INJECTED approved Team identity. A missing configuration, a disconnected
   * broker, a broker that cannot sign-only, an absent or malformed approved identity, and a
   * connected wallet that is not EXACTLY the approved Team all resolve to `READ_UNAVAILABLE`
   * — never to a verdict about some other account.
   *
   * The sign-only precondition is required even though nothing here signs: this member
   * answers "can the wallet that would actually pay for this operation afford it", and a
   * broker that could not sign is not that wallet.
   *
   * ONE FRESH READ-ONLY SCOPED `Connection` PER CALL, used for nothing else. It is not the
   * attempt Connection, is never registered with the mutation chain guard, and cannot bind a
   * floor — a passive read must not be able to raise an attempt's floor, and structurally it
   * cannot, because the guard refuses any bind whose Connection is not the exact object
   * Phase A registered.
   *
   * IT DOES NOT TAKE THE SINGLE-FLIGHT LATCH. It is not a transaction action and cannot
   * become one: taking the latch would let a read-only gesture block a submission, and
   * would make an in-flight submission suppress the very reading that explains why an
   * action is withheld.
   *
   * IT BUILDS, SIGNS, SENDS, WRITES AND AUTHORIZES NOTHING, and its answer grants no
   * permission: `submitMutation` re-observes at C2 through the SAME observer regardless.
   */
  const readMutationSolPreflight = useCallback(
    async (
      operation: RedaxTeamAdminMutationOperation,
    ): Promise<RedaxTeamAdminMutationSolPreflightResult> => {
      const runtimeConfig = resolveRedaxRuntimeActionConfig()
      if (!runtimeConfig.ok) {
        return 'READ_UNAVAILABLE'
      }
      if (!broker.isConnected || !broker.canSignOnly) {
        return 'READ_UNAVAILABLE'
      }
      if (approvedTeamWallet === null) {
        return 'READ_UNAVAILABLE'
      }
      let approvedTeam: PublicKey
      try {
        approvedTeam = new PublicKey(approvedTeamWallet)
      } catch {
        return 'READ_UNAVAILABLE'
      }
      const connectedWallet = readLiveTeamWallet(broker)
      if (connectedWallet === null) {
        return 'READ_UNAVAILABLE'
      }
      // A CONNECTED WALLET MUST NOT APPROVE ITSELF, and it must not be reported ON either:
      // exact equality, no normalization and no near match, because a different wallet's
      // balance is not an answer to this question.
      if (!connectedWallet.equals(approvedTeam)) {
        return 'READ_UNAVAILABLE'
      }
      // `minContextSlot = null`: a passive read has no attempt, and therefore no attempt
      // floor to be measured against. C2 is the call that supplies one.
      const observation = await observePassiveMutationSolPreflight(
        runtimeConfig.rpcUrl,
        approvedTeam,
        operation,
      )
      // THE BARE VERDICT AND NOTHING ELSE. The observed context slot stops here.
      return observation.result
    },
    [approvedTeamWallet, broker],
  )

  /** The display estimate — the same refusals and observer as the bare verdict above. */
  const readMutationSolEstimate = useCallback(
    async (operation: RedaxTeamAdminMutationOperation): Promise<RedaxTeamAdminMutationSolEstimate> => {
      const unknown: RedaxTeamAdminMutationSolEstimate = {
        result: 'READ_UNAVAILABLE',
        requiredLamports: null,
        availableLamports: null,
      }
      const runtimeConfig = resolveRedaxRuntimeActionConfig()
      if (!runtimeConfig.ok || !broker.isConnected || !broker.canSignOnly || approvedTeamWallet === null) {
        return unknown
      }
      let approvedTeam: PublicKey
      try {
        approvedTeam = new PublicKey(approvedTeamWallet)
      } catch {
        return unknown
      }
      const connectedWallet = readLiveTeamWallet(broker)
      if (connectedWallet === null || !connectedWallet.equals(approvedTeam)) {
        return unknown
      }
      const observation = await observePassiveMutationSolPreflight(
        runtimeConfig.rpcUrl,
        approvedTeam,
        operation,
      )
      if (observation.result === 'READ_UNAVAILABLE') {
        return unknown
      }
      return {
        result: observation.result,
        requiredLamports: observation.requiredLamports.toString(),
        availableLamports: observation.balanceLamports.toString(),
      }
    },
    [approvedTeamWallet, broker],
  )

  /** One read-only classic-SPL mint read. No wallet is needed: a mint is public. */
  const readClassicMintFacts = useCallback(
    async (mint: string): Promise<RedaxClassicMintFactsReadResult> => {
      const runtimeConfig = resolveRedaxRuntimeActionConfig()
      if (!runtimeConfig.ok) {
        return { ok: false, code: 'READ_UNAVAILABLE' }
      }
      let mintKey: PublicKey
      try {
        mintKey = new PublicKey(mint)
      } catch {
        return { ok: false, code: 'NOT_A_PUBLIC_KEY' }
      }
      return readRedaxClassicMintFactsWithContext(
        createRedaxTeamAdminPassiveReadConnection(runtimeConfig.rpcUrl),
        mintKey,
      )
    },
    [],
  )

  const value = useMemo<RedaxTeamAdminMutationActionsValue>(
    () => ({
      transactionCapability: REDAX_TEAM_ADMIN_MUTATION_TRANSACTION_CAPABILITY,
      rawBroadcastCapability: REDAX_TEAM_ADMIN_MUTATION_RAW_BROADCAST_CAPABILITY,
      submitMutation,
      reconcileMutation,
      readMutationStatus,
      readMutationSolPreflight,
      readMutationSolEstimate,
      readClassicMintFacts,
    }),
    [
      submitMutation,
      reconcileMutation,
      readMutationStatus,
      readMutationSolPreflight,
      readMutationSolEstimate,
      readClassicMintFacts,
    ],
  )
  // `busy` drives no rendering here — this root renders no control of its own — but it is
  // read so the rendered latch is a real state dependency rather than dead weight a later
  // refactor would delete along with the re-render it exists to cause.
  void busy

  return (
    <RedaxTeamAdminMutationActionsContext.Provider value={value}>
      {children}
    </RedaxTeamAdminMutationActionsContext.Provider>
  )
}

// --- Outcome settlement ------------------------------------------------------------

/**
 * Rebuild the coherent-read target from a durable record's own facts.
 */
function targetForRecord(
  programId: PublicKey,
  record: RedaxTeamAdminMutationRecordV1,
): RedaxTeamAdminMutationGuardTarget | null {
  try {
    const campaign = new PublicKey(record.campaign)
    if (record.operation === 'ADD_TOKEN_CONFIG') {
      if (record.request.legacyMint === null) {
        return null
      }
      const legacyMint = new PublicKey(record.request.legacyMint)
      return {
        family: 'ADD_TOKEN_CONFIG',
        campaign,
        tokenConfig: deriveTokenConfigPda(programId, campaign, legacyMint).pda,
        legacyMint,
        // THE RECORD'S OWN OBSERVED PRE-STATE, never a caller input and never loaded product
        // data: a reconcile happens after a reload, so the only output mint it may trust is
        // the one this attempt durably wrote down when it started.
        outputMint: new PublicKey(record.preState.outputMint),
      }
    }
    if (record.operation === 'SETUP_METADATA') {
      return {
        family: 'SETUP_METADATA',
        campaign,
        outputMint: new PublicKey(record.preState.outputMint),
      }
    }
    return { family: 'STATUS_ONLY', campaign }
  } catch {
    return null
  }
}

/**
 * Map one coherent observation onto the pure assessor's re-declared shape.
 *
 * The two shapes are structurally identical by construction — the assessor re-declares them
 * rather than importing them, so it stays an independently committable leaf — and this is
 * the ONE place the correspondence is asserted. The structural tests read both sources and
 * prove the declarations agree, so the cast here is checked by something other than itself.
 */
function toAssessorObservation(
  contextSlot: number,
  observation: RedaxTeamAdminMutationCoherentObservationV1,
): RedaxMutationCoherentObservationV1 {
  return {
    contextSlot,
    campaign: observation.campaign,
    tokenConfig: observation.tokenConfig,
    metadata: observation.metadata,
  } as unknown as RedaxMutationCoherentObservationV1
}

/** The terminal a verdict determines, or `null` when the evidence determines none. */
function terminalFor(
  verdict: RedaxMutationPostStateV1['verdict'],
): {
  readonly observation: RedaxTeamAdminMutationObservation
  readonly transition:
    | 'RESOLVE_MATCHING_IMMEDIATE_STATE'
    | 'RESOLVE_LANDED_EXACT_POST_STATE_SUPERSEDED'
    | 'RESOLVE_FINALIZED_LANDED_FAILURE'
  readonly resolution: RedaxTeamAdminMutationResolution
  readonly code: RedaxTeamAdminMutationSubmitCode & RedaxTeamAdminMutationReconcileCode
} | null {
  if (verdict === 'MATCHING_IMMEDIATE_STATE') {
    return {
      observation: 'MATCHING_IMMEDIATE_STATE',
      transition: 'RESOLVE_MATCHING_IMMEDIATE_STATE',
      resolution: 'RESOLVED_MATCHING_IMMEDIATE_STATE',
      code: 'MATCHING_IMMEDIATE_STATE_RESOLVED',
    }
  }
  if (verdict === 'LANDED_EXACT_BUT_POST_STATE_SUPERSEDED') {
    return {
      observation: 'LANDED_EXACT_BUT_POST_STATE_SUPERSEDED',
      transition: 'RESOLVE_LANDED_EXACT_POST_STATE_SUPERSEDED',
      resolution: 'RESOLVED_LANDED_EXACT_POST_STATE_SUPERSEDED',
      code: 'LANDED_EXACT_POST_STATE_SUPERSEDED_RESOLVED',
    }
  }
  if (verdict === 'FINALIZED_LANDED_FAILURE') {
    return {
      observation: 'LANDED_TRANSACTION_FAILED',
      transition: 'RESOLVE_FINALIZED_LANDED_FAILURE',
      resolution: 'RESOLVED_FINALIZED_LANDED_FAILURE',
      code: 'FINALIZED_LANDED_FAILURE_RESOLVED',
    }
  }
  // READ_UNAVAILABLE, TARGET_MISMATCH, PRE_STATE_MISMATCH, NO_EFFECT,
  // LANDED_MESSAGE_MISMATCH and OUTCOME_UNRESOLVED_SUPPORT determine NO terminal. They stay
  // unresolved and blocking, exactly as intended: uncertainty is never laundered into a
  // tombstone by a transition that merely happens to be available.
  return null
}

/**
 * Observe once, judge once, and write at most one terminal — the shared settlement.
 *
 * Reached from BOTH entry points, from a durable record either way, so the two cannot drift
 * about what a verdict means. It performs no send, no sign, no rebuild and no retry.
 */
async function settleMutationOutcomeForRecord(input: {
  readonly connection: Connection
  readonly programId: PublicKey
  readonly namespace: RedaxTeamAdminMutationNamespace
  readonly record: RedaxTeamAdminMutationRecordV1
  readonly target: RedaxTeamAdminMutationGuardTarget
  readonly knownSignature: RedaxKnownSignature
  readonly applyAndVerify: (
    transition: Parameters<typeof transitionRedaxTeamAdminMutationAttempt>[0]['transition'],
    expect: {
      readonly lifecycle: RedaxTeamAdminMutationRecordV1['lifecycle']
      readonly observation: RedaxTeamAdminMutationObservation | null
      readonly resolution: RedaxTeamAdminMutationResolution | null
      readonly knownSignature: string | null
      readonly issueCodes: readonly RedaxTeamAdminMutationIssueCode[]
    },
  ) => Promise<boolean>
}): Promise<{ ok: boolean; code: RedaxTeamAdminMutationReconcileCode }> {
  const { connection, programId, record, target, knownSignature, applyAndVerify } = input

  // ONE one-shot observation, through the shared outcome module, used AS-IS.
  const outcome = await observeRedaxKnownSignatureOutcome(connection, {
    signature: knownSignature,
    intendedMessage: {
      kind: 'redax-intended-legacy-message-sha256-v1',
      byteLength: record.intendedMessage.byteLength,
      sha256Hex: record.intendedMessage.sha256Hex,
    },
    minimumContextSlot: record.blockhashValidity.preflightContextSlot,
    lastValidBlockHeight: record.blockhashValidity.lastValidBlockHeight,
  })

  let attestation: RedaxMutationTransactionAttestationV1
  if (outcome.kind === 'LANDED_MESSAGE_MISMATCH') {
    attestation = { kind: 'LANDED_MESSAGE_MISMATCH' }
  } else if (outcome.kind === 'LANDED_TRANSACTION_FAILED' && outcome.finality === 'finalized') {
    attestation = { kind: 'FINALIZED_FAILED', transactionSlot: outcome.transactionSlot ?? 0 }
  } else if (outcome.kind === 'FINALIZED_MESSAGE_META_MATCHING' && outcome.transactionSlot !== null) {
    // ACCOUNT KEYS ARE NOT AVAILABLE FROM THIS OBSERVATION, so effect origin is carried by
    // the fee payer the mutation corridor already fixes: every signer role collapsed onto the
    // approved Team wallet BEFORE the message was compiled, the verifier proved slot 0 IS
    // that wallet, and the landed message is byte-identical to that exact message. Slot 0 of
    // the landed message therefore cannot be anything else.
    attestation = {
      kind: 'FINALIZED_EXACT',
      transactionSlot: outcome.transactionSlot,
      accountKeys: [record.preState.campaignAdmin],
    }
  } else {
    attestation = { kind: 'UNAVAILABLE' }
  }

  if (attestation.kind === 'UNAVAILABLE') {
    // Not yet finalized, or not readable. Record the observation and stop: an unresolved
    // record is still literally true, and it blocks a new attempt by construction.
    await applyAndVerify(
      {
        type: 'RECORD_OBSERVATION',
        observation: 'RAW_SEND_OUTCOME_UNKNOWN_WITH_KNOWN_SIGNATURE',
        issueCodes: ['READ_UNAVAILABLE'],
      },
      {
        lifecycle: 'KNOWN_SIGNATURE',
        observation: 'RAW_SEND_OUTCOME_UNKNOWN_WITH_KNOWN_SIGNATURE',
        resolution: null,
        knownSignature,
        issueCodes: ['READ_UNAVAILABLE'],
      },
    )
    return { ok: false, code: 'OUTCOME_STILL_UNRESOLVED' }
  }

  const transactionSlot =
    attestation.kind === 'FINALIZED_EXACT' || attestation.kind === 'FINALIZED_FAILED'
      ? attestation.transactionSlot
      : 0
  const floor = Math.max(record.blockhashValidity.preflightContextSlot, transactionSlot)

  // THE FINALIZED ATTRIBUTION READ, at or above the floor. `finalized`, explicitly: confirmed
  // state can still be reorganised, so "the account is there" observed at `confirmed` is not
  // the same statement as "the account is there and cannot vanish".
  const post = await readRedaxTeamAdminMutationCoherentStateWithContext(
    connection,
    programId,
    target,
    { commitment: 'finalized', minContextSlot: floor },
  )
  if (!post.ok || post.contextSlot < floor) {
    await applyAndVerify(
      {
        type: 'RECORD_OBSERVATION',
        observation: 'READ_UNAVAILABLE',
        issueCodes: ['READ_UNAVAILABLE'],
      },
      {
        lifecycle: 'KNOWN_SIGNATURE',
        observation: 'READ_UNAVAILABLE',
        resolution: null,
        knownSignature,
        issueCodes: ['READ_UNAVAILABLE'],
      },
    )
    return { ok: false, code: 'OUTCOME_STILL_UNRESOLVED' }
  }

  const expectation = expectationForRecord(record, floor)
  if (expectation === null) {
    return { ok: false, code: 'OUTCOME_STILL_UNRESOLVED' }
  }
  const judged = assessRedaxTeamAdminMutationPostState(
    toAssessorObservation(post.contextSlot, post.observation),
    attestation,
    expectation,
  )

  const terminal = terminalFor(judged.verdict)
  if (terminal === null) {
    const observation: RedaxTeamAdminMutationObservation =
      judged.verdict === 'LANDED_MESSAGE_MISMATCH'
        ? 'LANDED_MESSAGE_MISMATCH'
        : judged.verdict === 'READ_UNAVAILABLE'
          ? 'READ_UNAVAILABLE'
          : 'SUPPORT_ONLY'
    const issueCodes = judged.issueCodes as readonly RedaxTeamAdminMutationIssueCode[]
    await applyAndVerify(
      { type: 'RECORD_OBSERVATION', observation, issueCodes },
      {
        lifecycle: 'KNOWN_SIGNATURE',
        observation,
        resolution: null,
        knownSignature,
        issueCodes,
      },
    )
    // `ACKNOWLEDGE_SUPPORT_DISPOSITION` is deliberately NOT written automatically. It is
    // permanently non-replaceable, and reaching it by machine would close an attempt nobody
    // understood.
    return { ok: false, code: 'OUTCOME_STILL_UNRESOLVED' }
  }

  const issueCodes = judged.issueCodes as readonly RedaxTeamAdminMutationIssueCode[]
  const observed = await applyAndVerify(
    { type: 'RECORD_OBSERVATION', observation: terminal.observation, issueCodes },
    {
      lifecycle: 'KNOWN_SIGNATURE',
      observation: terminal.observation,
      resolution: null,
      knownSignature,
      issueCodes,
    },
  )
  if (!observed) {
    return { ok: false, code: 'OUTCOME_STILL_UNRESOLVED' }
  }
  const resolved = await applyAndVerify(
    { type: terminal.transition },
    {
      lifecycle: 'TOMBSTONE',
      observation: terminal.observation,
      resolution: terminal.resolution,
      knownSignature,
      issueCodes,
    },
  )
  if (!resolved) {
    // DURABILITY UNKNOWN UNTIL AN EXACT READ. The write may have landed, the prior record may
    // still stand, or storage may be unreadable — and a failure observed after `setItem` is
    // consistent with all three. So this claims none of them: no rollback, no automatic
    // second terminal write, no new attempt, no resend. Only a LATER explicit exact read
    // classifies it, and `reconcileMutation` is what performs that read.
    return { ok: false, code: 'TERMINAL_RECORD_UNVERIFIED' }
  }
  return { ok: true, code: terminal.code }
}

/** Rebuild the pure assessor's expectation from the durable record's own facts. */
function expectationForRecord(
  record: RedaxTeamAdminMutationRecordV1,
  finalizedFloorSlot: number,
): RedaxMutationExpectationV1 | null {
  const pre = record.preState
  let expectedStatus: RedaxMutationExpectationV1['expectedPostState']['campaignStatus']
  let expectedMetadataSetup = pre.metadataSetup
  let expectedCount = pre.tokenConfigCount
  let createdAccount: string | null = record.witness.address

  if (record.operation === 'ADD_TOKEN_CONFIG') {
    expectedStatus = pre.campaignStatus
    expectedCount = pre.tokenConfigCount + 1
  } else if (record.operation === 'SETUP_METADATA') {
    expectedStatus = pre.campaignStatus
    expectedMetadataSetup = true
  } else if (record.request.targetStatus === null) {
    return null
  } else {
    expectedStatus = record.request.targetStatus
    createdAccount = null
  }

  return {
    operation: record.operation,
    campaign: record.campaign,
    campaignAdmin: pre.campaignAdmin,
    outputMint: pre.outputMint,
    recordedPreState: {
      campaignStatus: pre.campaignStatus,
      metadataSetup: pre.metadataSetup,
      tokenConfigCount: pre.tokenConfigCount,
      targetAccountAbsent: pre.targetAccountAbsent,
    },
    expectedPostState: {
      campaignStatus: expectedStatus,
      metadataSetup: expectedMetadataSetup,
      tokenConfigCount: expectedCount,
      createdAccount,
    },
    expectedTokenConfig:
      record.operation === 'ADD_TOKEN_CONFIG' &&
      record.witness.address !== null &&
      record.request.legacyMint !== null &&
      record.request.rateNumerator !== null &&
      record.request.rateDenominator !== null &&
      record.request.maxOutputFromTokenConfig !== null
        ? {
            address: record.witness.address,
            legacyMint: record.request.legacyMint,
            rateNumeratorRaw: record.request.rateNumerator,
            rateDenominatorRaw: record.request.rateDenominator,
            maxOutputFromTcRaw: record.request.maxOutputFromTokenConfig,
          }
        : null,
    // The metadata expectation is rebuilt from the record's OWN expected-puffed digests, so
    // submit and reconcile assert exactly the same attribution from exactly the same durable
    // facts. `updateAuthority` is the Campaign PDA — the program signs the Metaplex CPI with
    // it — and `mint` is the Campaign's own output mint.
    expectedMetadata:
      record.operation === 'SETUP_METADATA' &&
      record.witness.address !== null &&
      record.request.expectedPuffedNameSha256Hex !== null &&
      record.request.expectedPuffedSymbolSha256Hex !== null &&
      record.request.expectedPuffedUriSha256Hex !== null
        ? {
            address: record.witness.address,
            updateAuthority: record.campaign,
            mint: pre.outputMint,
            expectedPuffedNameSha256Hex: record.request.expectedPuffedNameSha256Hex,
            expectedPuffedSymbolSha256Hex: record.request.expectedPuffedSymbolSha256Hex,
            expectedPuffedUriSha256Hex: record.request.expectedPuffedUriSha256Hex,
            expectedPuffedNameByteLength: REDAX_PUFFED_NAME_BYTES,
            expectedPuffedSymbolByteLength: REDAX_PUFFED_SYMBOL_BYTES,
            expectedPuffedUriByteLength: REDAX_PUFFED_URI_BYTES,
          }
        : null,
    finalizedFloorSlot,
  }
}

/**
 * The submit path's settlement.
 *
 * It deliberately takes NOTHING the reconcile path does not also have. Both settle from the
 * SAME re-read durable record through the SAME shared body below, so neither can reach a
 * conclusion the other could not reach from storage alone — which is what makes an
 * interrupted submit and a later reconcile agree rather than merely tend to.
 */
async function settleMutationOutcome(input: {
  readonly connection: Connection
  readonly programId: PublicKey
  readonly namespace: RedaxTeamAdminMutationNamespace
  readonly target: RedaxTeamAdminMutationGuardTarget
  readonly localKnownSignature: RedaxKnownSignature
  readonly applyAndVerify: (
    transition: Parameters<typeof transitionRedaxTeamAdminMutationAttempt>[0]['transition'],
    expect: {
      readonly lifecycle: RedaxTeamAdminMutationRecordV1['lifecycle']
      readonly observation: RedaxTeamAdminMutationObservation | null
      readonly resolution: RedaxTeamAdminMutationResolution | null
      readonly knownSignature: string | null
      readonly issueCodes: readonly RedaxTeamAdminMutationIssueCode[]
    },
  ) => Promise<boolean>
}): Promise<{ ok: boolean; code: RedaxTeamAdminMutationSubmitCode }> {
  // The durable record is re-read rather than reconstructed, so BOTH entry points settle from
  // the same durable facts and neither can settle from something only it happened to hold.
  const read = await readRedaxTeamAdminMutationJournal(input.namespace)
  if (!read.ok || read.kind !== 'ACTIVE') {
    return { ok: false, code: 'RAW_SEND_OUTCOME_UNKNOWN' }
  }
  const settled = await settleMutationOutcomeForRecord({
    connection: input.connection,
    programId: input.programId,
    namespace: input.namespace,
    record: read.record,
    target: input.target,
    knownSignature: input.localKnownSignature,
    applyAndVerify: input.applyAndVerify,
  })
  if (settled.code === 'MATCHING_IMMEDIATE_STATE_RESOLVED') {
    return { ok: settled.ok, code: 'MATCHING_IMMEDIATE_STATE_RESOLVED' }
  }
  if (settled.code === 'LANDED_EXACT_POST_STATE_SUPERSEDED_RESOLVED') {
    return { ok: settled.ok, code: 'LANDED_EXACT_POST_STATE_SUPERSEDED_RESOLVED' }
  }
  if (settled.code === 'FINALIZED_LANDED_FAILURE_RESOLVED') {
    return { ok: settled.ok, code: 'FINALIZED_LANDED_FAILURE_RESOLVED' }
  }
  if (settled.code === 'TERMINAL_RECORD_UNVERIFIED') {
    return { ok: false, code: 'OUTCOME_UNRESOLVED_SUPPORT' }
  }
  return { ok: false, code: 'RAW_SEND_OUTCOME_UNKNOWN' }
}

/**
 * Read the composed Team/Admin mutation surface.
 *
 * Throws outside the provider rather than returning a permissive default: a default would be
 * a second, unreviewed surface that appears exactly when the real one is absent, and "no
 * provider" is a wiring mistake rather than a runtime state to tolerate.
 */
export function useRedaxTeamAdminMutationActions(): RedaxTeamAdminMutationActionsValue {
  const value = useContext(RedaxTeamAdminMutationActionsContext)
  if (value === null) {
    throw new Error(
      'useRedaxTeamAdminMutationActions must be used inside RedaxTeamAdminMutationActionsProvider',
    )
  }
  return value
}
