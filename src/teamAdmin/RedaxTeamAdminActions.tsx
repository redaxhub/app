// REDAX Team/Admin action root — the ONE place a Team/Admin S1 transaction is built,
// signed, verified, broadcast exactly once, and reconciled afterwards.
//
// -----------------------------------------------------------------------------
// WHAT THIS IS
// -----------------------------------------------------------------------------
// The single approved integration root for Team/Admin S1, and the sole owner of every
// S1 transaction capability — every item below is S1-SCOPED, never Team/Admin-wide:
//
//   * the ONLY `Keypair.generate()` in app source;
//   * the ONLY `partialSign` in app source;
//   * the ONLY Team/Admin S1 `new Transaction(`;
//   * the ONLY importer of the private Team/Admin S1 sign-only broker;
//   * the ONLY Team/Admin S1 raw broadcast (the mutation root owns its own — see below).
//
// It composes those with pieces that deliberately know nothing about each other — the
// private attempt / custody (redaxTeamAdminAttempt), the durable recovery journal
// (redaxTeamAdminRecoveryJournal), the Team/Admin chain guard, the fixed two-signature
// verifier, the pure plan freeze, the pure S1 assembler, the action-agnostic
// known-signature outcome module, the coherent Team/Admin account reader, the pure
// post-state judgment and the pure campaign-setup recovery FSM.
//
// -----------------------------------------------------------------------------
// THE POINT OF NO RETURN, AND THE TWO ENTRYPOINTS AROUND IT
// -----------------------------------------------------------------------------
//
//   SIGN ONLY -> VERIFY EXACTLY TWO SIGNATURES -> REASSERT THE CHAIN -> MARK THE
//   INVOCATION AND RETAIN THE LOCAL SIGNATURE, BOTH READ-VERIFIED -> SEND THE EXACT
//   VERIFIED BYTES, ONCE
//
// THE RAW BROADCAST INVOCATION IS THE POINT OF NO RETURN. Once it is called a
// transaction may have been broadcast even if the call throws, even if nothing is
// returned, even if the tab closes. So every question worth asking is asked BEFORE it,
// the durable record can already NAME the transaction that is about to exist, and
// nothing after it authorizes a retry, a second send, a rebuild or a fallback.
//
// THERE IS EXACTLY ONE S1 SIGNING CHOREOGRAPHY — `submitS1` — and deliberately no
// sibling no-send signing action kept for historical compatibility. Two places that could
// each believe they were the only one is precisely the shape that produces a second
// broadcast. `reconcileS1` is the second entrypoint and is RECONCILIATION-ONLY: it holds
// no custody, builds no transaction, opens no wallet, signs nothing and sends nothing.
//
// WHAT STILL DOES NOT EXIST HERE, structurally rather than by discipline: no wallet
// broadcast, no sign-and-send, no send-and-confirm, no simulation, no confirmation wait,
// no generic sender, no sender on the provider or on the sign-only broker, no second raw
// send, no automatic retry and no timer resend. The broker has no send member to call,
// and there is no fallback to try.
//
// EXACTLY ONE OPERATION CONSUMER, AND IT IS A PANEL. `App.tsx` owns the provider and
// calls nothing on it; `RedaxTeamAdminCampaignCreatePanel.tsx` is the one module that
// acquires this surface, and it is reachable only as an opaque node App passes down.
// `main.tsx`, every screen and every component still acquire nothing from this tree and
// receive no action as a prop. Outside that one panel nothing calls
// `useRedaxTeamAdminActions`, `submitS1`, `reconcileS1` or `advanceRecoveryRecord`. It
// runs NO effect: there is no `useEffect` in this file at all, which is the strongest
// available form of "no action on mount". Nothing happens on connect, on a screen or
// campaign selection, on a field change or on a timer — the two operations below run
// only when the panel's own explicit click handler invokes them.

import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Connection, Keypair, PublicKey, Transaction } from '@solana/web3.js'
// The CLASSIC SPL token-account allocation, from the installed library rather than a
// hand-maintained `165`. A literal here would be a second, quieter definition of a size
// the library already owns, and one that could not follow it if it ever moved.
import { ACCOUNT_SIZE as REDAX_CLASSIC_TOKEN_ACCOUNT_SPACE } from '@solana/spl-token'

import { resolveRedaxRuntimeActionConfig } from '../data/redaxDataSourceProvider'
import {
  REDAX_CAMPAIGN_SALT_BYTES,
  readRedaxTeamAdminS1CoherentStateWithContext,
} from '../data/devnet/redaxDevnetAccounts'
import {
  REDAX_OUTPUT_MINT_DECIMALS,
  computeRedaxCampaignPlanFingerprint,
  freezeRedaxCampaignPlan,
  redaxSaltHexFromBytes,
} from '../data/devnet/redaxDevnetCampaignPlan'
import type {
  RedaxCampaignLifecycleIntent,
  RedaxFrozenCampaignPlanV1,
  RedaxTokenConfigDraftRowV1,
} from '../data/devnet/redaxDevnetCampaignPlan'
import {
  initialRedaxCampaignRecoveryContext,
  transitionRedaxCampaignRecovery,
} from '../data/devnet/redaxDevnetCampaignRecovery'
import type {
  RedaxCampaignRecoveryContextV1,
  RedaxCampaignRecoveryEvent,
  RedaxCampaignRecoveryTransition,
} from '../data/devnet/redaxDevnetCampaignRecovery'
import { buildRedaxCampaignSetupPlanS1 } from '../data/devnet/redaxDevnetCampaignSetupPlan'
import { assessRedaxTeamAdminS1PostState } from '../data/devnet/redaxDevnetPostState'
import type {
  RedaxS1CoherentObservationV1,
  RedaxS1LandedMessageAssessmentV1,
  RedaxS1PlanExpectationV1,
  RedaxS1PostStateV1,
} from '../data/devnet/redaxDevnetPostState'
import { REDAX_CLASSIC_MINT_SPACE } from '../data/devnet/redaxDevnetSplPrepBuilders'
import { useRedaxTeamAdminS1SignOnlyBroker } from '../wallet/RedaxWalletProvider'
import type { RedaxTeamAdminS1SignOnlyBroker } from '../wallet/RedaxWalletProvider'
import {
  observeRedaxKnownSignatureOutcome,
  retainRedaxKnownSignature,
} from '../wallet/redaxTransactionOutcome'
import type {
  RedaxKnownSignature,
  RedaxKnownSignatureOutcome,
} from '../wallet/redaxTransactionOutcome'
import {
  initialRedaxTeamAdminAttempt,
  materializeRedaxTeamAdminOutputMintCustody,
  publicAttemptProjection,
  readRedaxTeamAdminOutputMintCustodyKeypair,
  transitionRedaxTeamAdminAttempt,
} from './redaxTeamAdminAttempt'
import type {
  RedaxTeamAdminAttemptEvent,
  RedaxTeamAdminAttemptProjectionV1,
  RedaxTeamAdminAttemptV1,
  RedaxTeamAdminAttemptViolationCode,
} from './redaxTeamAdminAttempt'
import {
  bindRedaxTeamAdminSolPreflightContextFloor,
  checkRedaxTeamAdminChainGuardPhaseA,
  checkRedaxTeamAdminChainGuardPhaseB,
  fetchRedaxTeamAdminAttemptBlockhash,
  reassertRedaxTeamAdminChainGuardAfterWallet,
} from './redaxTeamAdminChainGuard'
import type {
  RedaxTeamAdminChainGuardRuntime,
  RedaxTeamAdminFrozenPlanIdentity,
} from './redaxTeamAdminChainGuard'
import {
  beginRedaxTeamAdminRecoveryAttempt,
  readRedaxTeamAdminRecoveryJournal,
  transitionRedaxTeamAdminRecoveryAttempt,
} from './redaxTeamAdminRecoveryJournal'
import type {
  RedaxTeamAdminRecoveryAttemptIdentity,
  RedaxTeamAdminRecoveryBeginInput,
  RedaxTeamAdminRecoveryIssueCode,
  RedaxTeamAdminRecoveryNamespace,
  RedaxTeamAdminRecoveryObservation,
  RedaxTeamAdminRecoveryReadResult,
  RedaxTeamAdminRecoveryRecordV1,
  RedaxTeamAdminRecoveryTransition,
  RedaxTeamAdminRecoveryTransitionInput,
  RedaxTeamAdminRecoveryWriteResult,
} from './redaxTeamAdminRecoveryJournal'
import {
  commitRedaxTeamAdminIntendedLegacyMessage,
  verifyRedaxTeamAdminS1SignedWire,
} from './redaxTeamAdminSignedWire'

/**
 * What this root can do to a chain, stated as a value rather than as a comment.
 *
 * A literal type, not a boolean: widening it is a type change somebody has to make on
 * purpose and a reviewer can see in a diff.
 *
 * EVERY MEMBER OF THE LITERAL IS LOAD-BEARING, and it is deliberately long for that
 * reason. Source presence is not capability, a provider mount is not an action, and a
 * reader who sees only this value must not be able to mistake it for a live,
 * proven or exercised one. What it says, exactly and only, is: the provider is MOUNTED
 * in the product tree; its approved Team identity comes from DEPLOYMENT CONFIG and GATES
 * the action fail-closed; ONE VISIBLE CAMPAIGN CREATE ACTION exists, reachable only by
 * an explicit gesture; and this source contains one S1 route that signs, verifies, sends
 * and reconciles.
 *
 * What it does NOT say, and what no reader may infer from it:
 *
 *   * that any wallet is proven compatible      — none is;
 *   * that metadata was applied or a token       — neither is offered by this action;
 *     config added, or a campaign activated
 *   * that this is production or mainnet ready   — it is devnet exposure only;
 *   * that a live S1 capability is PROVEN        — source presence is not capability, and
 *                                                 a mount is not a live execution.
 */
export const REDAX_TEAM_ADMIN_TRANSACTION_CAPABILITY =
  'PROVIDER_MOUNTED_DEPLOY_CONFIG_IDENTITY_GATED_VISIBLE_CAMPAIGN_CREATE_ACTION_S1_SIGN_VERIFY_SEND_RECONCILE' as const

/**
 * `1` means this S1 root owns exactly ONE executable raw-send call — never that one
 * has been performed. The separate mutation root has its own literal `1`; any second call in
 * this S1 root would have to change this declaration, which is why it is a literal type.
 */
export const REDAX_TEAM_ADMIN_RAW_BROADCAST_CAPABILITY = 1 as const

/** The devnet cluster this journal namespace is pinned to. */
const REDAX_TEAM_ADMIN_JOURNAL_CLUSTER = 'devnet' as const

/**
 * The commitment of the SUBMIT path, and of nothing else.
 *
 *   * SUBMIT — plan freshness, every guard phase, the post-wallet reassertion and the
 *     `preflightCommitment` of the one raw broadcast all read at `confirmed`. Waiting
 *     for finality before an act that must happen while a blockhash is still valid
 *     would refuse liveness for a certainty the send does not need.
 *   * RECONCILE — the finalized no-land proof reads `getBlockHeight` and `getSlot` at
 *     `'finalized'`, anchors its history-enabled signature-status read at or above that
 *     finalized expiry floor, and performs its coherent account-absence read at
 *     `'finalized'` with that floor as `minContextSlot`. Proving something did NOT
 *     happen is exactly the claim confirmed state cannot support, because confirmed
 *     state can still be rolled back and an absence read below the floor would be an
 *     absence at the wrong moment.
 *
 * Those finalized reads AUTHORIZE NOTHING. They are recovery observations that may
 * resolve the durable record and may never lead to another broadcast, another wallet
 * prompt, a retry or a second attempt.
 */
const REDAX_TEAM_ADMIN_ACTION_COMMITMENT = 'confirmed' as const

// --- The S1 devnet SOL preflight cost model -----------------------------------
//
// WHAT THIS IS, AND WHAT IT IS NOT. The four terms below are the product-side floor an
// S1 Campaign Create must be able to pay before this root asks a human to approve it.
// They are a CONSERVATIVE PRODUCT BOUND, never a protocol constant, never a fee oracle
// result and never a promise that a later transaction will succeed — the program and the
// runtime remain the authority on whether a transaction can pay for itself. This only
// stops asking an operator to approve one that provably cannot.

/**
 * WHAT IT COVERS, from this source rather than from memory: the S1 transaction carries
 * EXACTLY TWO signatures — the approved Team wallet and the generated output mint — and
 * exactly ZERO Team/Admin ComputeBudget instructions, so no priority fee is set by this
 * corridor at all. At the current base rate that is `2 * 5000` = `10000` lamports, and
 * this bound is twice it.
 *
 * It is this corridor's OWN authority. It is not Holder's bound, does not import one, and
 * is deliberately a different number from the mutation root's so neither can be mistaken
 * for the other or quietly aliased to it.
 */
const TEAM_ADMIN_S1_SOL_PREFLIGHT_FEE_BOUND_LAMPORTS = 20000

/** A payer system account carries no data, so its rent floor is the zero-length minimum. */
const REDAX_TEAM_ADMIN_PAYER_ACCOUNT_DATA_LENGTH = 0

/**
 * The Campaign PDA's allocation, in bytes: `8 + Campaign::INIT_SPACE` = `8 + 223` = `231`.
 *
 * PROVENANCE, stated so a future edit cannot quietly guess a different number: `231` is
 * the exact `space` the current `init_campaign` account context declares — an 8-byte
 * Anchor discriminator plus the derived `INIT_SPACE` of the current `Campaign` body
 * (four `Pubkey`s, `bool`, `CampaignStatus`, `u8`, `u16`, two `u128`s, `u8`, `[u8; 32]`,
 * `Option<i64>` and `u128`). It is declared locally rather than imported because the
 * program's Rust constant is not reachable from app source; if the account body ever
 * changes, THIS constant is what must change with it.
 */
const REDAX_TEAM_ADMIN_CAMPAIGN_ACCOUNT_SPACE = 231

/**
 * The u64 ceiling every lamport sum is checked against after the RPC boundary.
 *
 * All preflight arithmetic in this file is `bigint`. `Number` appears only where the
 * library's own RPC input and output boundary requires it — a byte length going in, a
 * lamport count and a context slot coming out — and each of those is validated as a safe
 * integer before it becomes a `bigint`.
 */
const REDAX_TEAM_ADMIN_U64_MAX = 18446744073709551615n

/**
 * What ONE S1 preflight concluded, and nothing else.
 *
 * A bare string union rather than a record, so there is no member a lamport amount, a
 * threshold, a rent figure, a context slot, an endpoint, a provider name, a wallet address
 * or a raw error could be carried out in — not by convention, but because the type has
 * nowhere to put one.
 */
export type RedaxTeamAdminSolPreflightResult = 'SUFFICIENT' | 'INSUFFICIENT' | 'READ_UNAVAILABLE'

/**
 * What ONE observation saw INTERNALLY — the private shape, never returned to a caller.
 *
 * It carries the two facts a C2 caller still needs after a SUFFICIENT verdict: the context
 * slot the balance was read at, which must be bound into the chain guard before the attempt
 * continues, and the 82-byte mint rent this observation ALREADY read, which the four-
 * instruction S1 assembler consumes. Retaining the second is what lets the old post-entropy
 * duplicate rent read be removed rather than merely tolerated: the attempt now performs the
 * mint-rent read exactly ONCE, and the value the threshold was computed from is the same
 * value the transaction is built with.
 */
type RedaxTeamAdminSolPreflightObservation =
  | {
      readonly result: 'SUFFICIENT' | 'INSUFFICIENT'
      readonly balanceContextSlot: number
      readonly mintRentLamports: bigint
    }
  | {
      readonly result: 'READ_UNAVAILABLE'
      /**
       * WHY the observation is unavailable — INTERNAL ONLY, and never public.
       *
       * The S1 submit union already distinguishes an unreadable RENT figure from a
       * fail-closed guard refusal, and this preserves that distinction rather than
       * collapsing two different facts into one code. `RENT_READ` covers a rent read that
       * threw or answered with zero, a negative, a fractional or a non-safe integer;
       * `GUARD` covers an unreadable or malformed balance, a missing or invalid context, a
       * returned context below the requested floor, and checked-arithmetic overflow.
       *
       * IT NEVER LEAVES THIS ROOT. The public C1 result is the bare three-member union, so
       * both causes surface to a caller as the same `READ_UNAVAILABLE` and neither
       * discloses which read failed.
       */
      readonly cause: 'RENT_READ' | 'GUARD'
    }

const REDAX_TEAM_ADMIN_SOL_PREFLIGHT_RENT_UNAVAILABLE: RedaxTeamAdminSolPreflightObservation = {
  result: 'READ_UNAVAILABLE',
  cause: 'RENT_READ',
}

const REDAX_TEAM_ADMIN_SOL_PREFLIGHT_GUARD_UNAVAILABLE: RedaxTeamAdminSolPreflightObservation = {
  result: 'READ_UNAVAILABLE',
  cause: 'GUARD',
}

/** The frozen-plan facts a post-state comparison is made against, as public strings. */
export type RedaxTeamAdminPlanExpectation = RedaxS1PlanExpectationV1

/** The result of a private attempt transition, projected. Never carries custody. */
export interface RedaxTeamAdminAttemptOutcome {
  readonly ok: boolean
  readonly code: RedaxTeamAdminAttemptViolationCode | null
  readonly attempt: RedaxTeamAdminAttemptProjectionV1
}

/**
 * The campaign TERMS a caller chooses. The three signer ROLES are deliberately absent.
 *
 * Payer, output governance and campaign admin are filled from the injected
 * `approvedTeamWallet` and from nothing else, so there is no argument — and therefore no
 * form field, no URL parameter and no caller — by which a different Team identity could
 * enter an S1 plan.
 */
export interface RedaxTeamAdminS1SetupRequest {
  /** Optional deadline, Unix seconds. Empty string = no deadline. */
  readonly endTs: string
  /** Campaign-wide output cap in base units. `0` = uncapped. */
  readonly maxOutputSupply: string
  readonly metadataName: string
  readonly metadataSymbol: string
  readonly metadataUri: string
  readonly lifecycleIntent: RedaxCampaignLifecycleIntent
  readonly tokenConfigs: readonly RedaxTokenConfigDraftRowV1[]
}

/**
 * Every way the one S1 submit operation can end. Value-free and closed.
 *
 * The union is DELIBERATELY SPLIT by the point of no return, because that boundary is
 * the only thing a caller ever really needs from a code here: the first group says
 * nothing was broadcast, and the second says something may have been. No code in the
 * first group can be produced after the raw send, and none in the second before it.
 */
export type RedaxTeamAdminS1SubmitCode =
  // --- BEFORE the point of no return: NOTHING WAS BROADCAST ------------------
  | 'RUNTIME_CONFIG_UNAVAILABLE'
  | 'WALLET_NOT_CONNECTED'
  | 'WALLET_SIGN_ONLY_UNAVAILABLE'
  | 'APPROVED_TEAM_IDENTITY_UNAVAILABLE'
  | 'CHAIN_GUARD_REFUSED'
  | 'ENTROPY_UNAVAILABLE'
  | 'ATTEMPT_STATE_INVALID'
  | 'PLAN_INVALID'
  | 'RENT_READ_UNAVAILABLE'
  /**
   * A COMPLETE, VALID observation proved the approved Team payer's balance is below the
   * S1 threshold. That is its entire meaning.
   *
   * It says the read SUCCEEDED and the answer was "not enough" — never that a read failed,
   * never that a guard refused, and never which term of the threshold or which amount was
   * involved. Every unreadable, invalid, stale-context, overflowing or unbindable
   * observation is `CHAIN_GUARD_REFUSED` instead, so this code can never be produced by an
   * unknown. It is returned strictly BEFORE any entropy, custody, plan, transaction,
   * journal write, wallet prompt, signature, marker or send exists.
   */
  | 'PAYER_SOL_INSUFFICIENT'
  | 'BUILD_FAILED'
  | 'MESSAGE_COMMITMENT_UNAVAILABLE'
  | 'ATTEMPT_BLOCKED'
  | 'JOURNAL_UNAVAILABLE'
  | 'WALLET_SIGN_ONLY_REFUSED'
  | 'SIGNED_ARTIFACT_REJECTED'
  /**
   * The invocation marker or the retained local signature could not be READ BACK.
   *
   * Both are written and read-verified BEFORE the irreversible act, so this code is
   * always a pre-broadcast one: the send is not reached at all. That is deliberately the
   * worse outcome for liveness and the correct one for safety — an attempt whose durable
   * record could not name the transaction that was about to exist must not create one.
   */
  | 'INVOCATION_RECORD_UNVERIFIED'
  /**
   * An UNEXPECTED internal failure after custody existed and before any broadcast could.
   *
   * Deliberately value-free and deliberately NOT one of the codes above: it must not be
   * mistakable for a wallet refusal, a guard refusal, a verification failure, a journal
   * refusal or any ambiguity about a broadcast — none of which it is evidence of. It
   * says only that this attempt ended without completing, that custody was released, and
   * that nothing was sent. It is not persisted, is no part of the journal's vocabulary,
   * and grants neither a retry nor a send.
   */
  | 'PRE_BROADCAST_INTERNAL_FAILURE'
  // --- AFTER the point of no return: SOMETHING MAY HAVE BEEN BROADCAST -------
  /** The planned state is present, coherent and complete, and the attempt is resolved. */
  | 'SUBMITTED_MATCHING_COMPLETE_STATE'
  /** A FINALIZED landed failure or landed-message mismatch, accepted as terminal. */
  | 'SUBMITTED_TERMINAL_FAILURE'
  /**
   * Not settled yet — including a CONFIRMED (not yet finalized) exact message whose planned
   * state was found complete: that observation is recorded and the attempt is left
   * unresolved until finality. Never a failure, never a licence to do anything.
   */
  | 'SUBMITTED_OUTCOME_PENDING'
  /**
   * The outcome or the planned accounts could not be READ just now. Recorded as exactly
   * that. Unreadable is never absence, failure or success, and a later explicit status
   * check reads again; nothing is sent again.
   */
  | 'SUBMITTED_OUTCOME_UNREADABLE'
  /** Broadcast, unresolved, and blocking. A human decides what happens next. */
  | 'SUBMITTED_OUTCOME_UNRESOLVED_SUPPORT'
  /**
   * THE EXPECTED DURABLE TERMINAL COULD NOT BE PROVEN.
   *
   * That is its whole meaning, before and after the point of no return alike. It does
   * NOT mean the write did not occur, that the terminal did not occur, or that the
   * record remained where it was — a code that named any one of those would be
   * asserting the very thing that could not be read. The durable state is
   * `DURABILITY_UNKNOWN_UNTIL_EXACT_READ`, and only a later explicit exact read
   * classifies it.
   */
  | 'TERMINAL_RECORD_UNVERIFIED'
  /**
   * An UNEXPECTED internal failure AFTER the raw send was invoked.
   *
   * A separate member from `PRE_BROADCAST_INTERNAL_FAILURE` because the two make
   * opposite claims about the only thing that matters. That one says nothing was sent;
   * this one says something may have been, and says nothing else. It grants no retry, no
   * resend and no second attempt, and the durable local signature remains the recovery
   * authority.
   */
  | 'POST_INVOCATION_INTERNAL_FAILURE'

/**
 * The SANITIZED public result. Bounded codes and public plan identities only.
 *
 * There is no signed wire, no message bytes, no raw signature, no keypair, no
 * `Connection`, no `Transaction`, no endpoint and no wallet error here — and no member
 * in which any of them could travel. In particular the transaction identity is NOT
 * returned: it lives in the durable record, which is the surface a recovery must read it
 * from, and a copy on a transient result would invite a caller to reconcile from
 * something that never became durable.
 *
 * `rawBroadcastCount` is `0 | 1` — a type-level statement rather than a runtime tally,
 * bounded at one so an edit that sent twice would have to change this type to say so.
 */
export interface RedaxTeamAdminS1SubmitResult {
  readonly ok: boolean
  readonly code: RedaxTeamAdminS1SubmitCode
  /** `0` before the point of no return; exactly `1` once the one raw send ran. */
  readonly rawBroadcastCount: 0 | 1
  /** Exactly one prompt on the paths that reach the wallet, and zero on every other. */
  readonly walletPromptCount: 0 | 1
  readonly planFingerprint: string | null
  readonly outputMint: string | null
  readonly campaign: string | null
  /**
   * The transaction signature, ONLY on the resolved matching-complete terminal — after
   * the tombstone that names it was written and READ BACK. A public chain fact for an
   * explorer link; never a recovery input (recovery reads the durable record, not this).
   */
  readonly resolvedSignature: string | null
  readonly attempt: RedaxTeamAdminAttemptProjectionV1
}

/**
 * Every way the reconciliation-only operation can end. Value-free and closed.
 *
 * None of these is a retry code, a send code or a permission. `reconcileS1` answers
 * "what is known now?" about an attempt that already exists, and the honest answer is
 * very often that it is still unresolved and still blocking.
 */
export type RedaxTeamAdminS1ReconcileCode =
  | 'RUNTIME_CONFIG_UNAVAILABLE'
  | 'APPROVED_TEAM_IDENTITY_UNAVAILABLE'
  | 'JOURNAL_UNAVAILABLE'
  /** No durable record exists for this namespace at all. */
  | 'NOTHING_TO_RECONCILE'
  /** The record is already a tombstone. Reconciliation has nothing to add. */
  | 'ALREADY_RESOLVED'
  /** `PRE_INVOCATION`: the point of no return was never crossed by this attempt. */
  | 'NOT_INVOCATION_STARTED'
  /** `POST_INVOCATION_SIGNATURE_UNKNOWN`: no signature to reconcile against. */
  | 'SIGNATURE_UNKNOWN_UNRESOLVED'
  /** Not settled yet — a confirmed-but-not-finalized landing included. */
  | 'OUTCOME_PENDING'
  /** The chain could not be read just now. Nothing is concluded; check again later. */
  | 'OUTCOME_UNREADABLE'
  | 'OUTCOME_UNRESOLVED_SUPPORT'
  /**
   * THE LATE SUCCESS TERMINAL. The exact retained signature's message FINALIZED without
   * error, one coherent read of the planned accounts matched the plan against the
   * expectations frozen BEFORE the broadcast, and the matching-complete tombstone was
   * written under compare-and-set and read back. Nothing was signed or sent to reach it.
   */
  | 'MATCHING_COMPLETE_STATE_RESOLVED'
  /**
   * The exact message finalized, but the saved record predates the frozen expectations
   * (record v1), so success cannot be proven without measuring the read against itself.
   * The record stays open and readable; nothing is guessed and nothing is deleted.
   */
  | 'LEGACY_RECORD_SUCCESS_UNPROVABLE'
  /** A FINALIZED landed failure or message mismatch, accepted as terminal. */
  | 'TERMINAL_FAILURE_RESOLVED'
  /** The full finalized no-land conjunction held, and the terminal was read back. */
  | 'FINALIZED_NO_LAND_RESOLVED'
  /** Strict expiry has NOT been reached. Equality is not expiry. */
  | 'NOT_EXPIRED'
  /** Expired, but at least one member of the conjunction did not hold. */
  | 'NO_LAND_NOT_PROVEN'
  | 'TERMINAL_RECORD_UNVERIFIED'
  | 'RECONCILE_INTERNAL_FAILURE'

/**
 * The reconciliation result. Three literal zeroes, and they are the point.
 *
 * `rawBroadcastCount`, `walletPromptCount` and `signingRequestCount` are the literal `0`
 * rather than numbers: this operation's inability to send, prompt or sign is stated in
 * the TYPE, so a future edit that did any of them would have to change this declaration
 * before it could compile.
 */
export interface RedaxTeamAdminS1ReconcileResult {
  readonly ok: boolean
  readonly code: RedaxTeamAdminS1ReconcileCode
  readonly rawBroadcastCount: 0
  readonly walletPromptCount: 0
  readonly signingRequestCount: 0
  /**
   * The saved attempt's PUBLIC planned Campaign and output mint, from the durable record,
   * or `null` when no record was read. Display facts only — never authority.
   */
  readonly campaign: string | null
  readonly outputMint: string | null
  /**
   * The Campaign a workspace may be OPENED for, or `null`. Set ONLY when the durable record
   * is (now, or already) the matching-complete tombstone — so a pending, unreadable,
   * failed, support-only or legacy record can never offer navigation. Opening a workspace
   * is local navigation; the workspace performs its own strict chain read.
   */
  readonly openableCampaign: string | null
  /** The retained signature, ONLY alongside `openableCampaign`. Display only. */
  readonly resolvedSignature: string | null
}

/**
 * The transitions the generic context member may never carry. Named once, here.
 *
 * TWO, not one. Both assert something no generic caller can possibly know:
 *
 *   * `RESOLVE_VERIFIED_NO_BROADCAST` says a wallet signed, an exact two-signature
 *     artifact verified, a guard reassertion passed and REDAX then broadcast nothing.
 *     No route in this file writes it any more, and the journal keeps it because
 *     existing durable tombstones must stay parseable and replaceable — but a generic
 *     caller could never have made it true, so it stays excluded.
 *   * `RESOLVE_FINALIZED_NO_LAND` says a transaction reached a node, its blockhash
 *     strictly expired, and at a FINALIZED context above a post-expiry floor the
 *     signature was absent and none of the three planned accounts existed. That is a
 *     ten-member conjunction of chain observations, and a caller holding a nonce and a
 *     revision has established none of it.
 *
 * `RESOLVE_PRE_INVOCATION_REFUSAL` is deliberately NOT here, and the asymmetry is the
 * reasoning: it says an attempt did NOT complete, so a caller asserting it fails safe.
 * These two say something succeeded or was proven, and a caller asserting either fails
 * open.
 */
const REDAX_TEAM_ADMIN_CHOREOGRAPHY_ONLY_TERMINALS = [
  'RESOLVE_VERIFIED_NO_BROADCAST',
  'RESOLVE_FINALIZED_NO_LAND',
] as const

/** The member type of that set, so the type-level and runtime rules share one source. */
type RedaxTeamAdminChoreographyOnlyTerminal =
  (typeof REDAX_TEAM_ADMIN_CHOREOGRAPHY_ONLY_TERMINALS)[number]

/**
 * Every journal transition EXCEPT the two choreography-owned terminals.
 *
 * The journal's own union is deliberately untouched — it must stay able to execute both
 * for the one choreography that can honestly reach them. What is narrowed is the
 * CONTEXT, because the two are different kinds of claim.
 *
 * Origin-only plus compare-and-set is NOT sufficient here, and for the finalized no-land
 * terminal origin-only is not even available: a consumer that opened the slot through
 * `openRecoveryRecord` is the origin realm and holds the exact nonce and revision, so
 * those controls are satisfied by construction and none of them is evidence about a
 * wallet request nobody made or a finalized read nobody performed. `RESOLVE_FINALIZED_
 * NO_LAND` additionally CANNOT be an `ORIGIN_ONLY_TRANSITIONS` member — that gate demands
 * `PRE_INVOCATION` and no invocation marker, which the terminal contradicts by
 * definition — so this context-level narrowing is the whole of its confinement.
 */
type RedaxTeamAdminGenericRecoveryTransition = Exclude<
  RedaxTeamAdminRecoveryTransition,
  { readonly type: RedaxTeamAdminChoreographyOnlyTerminal }
>

/**
 * The SECOND enforcement, for callers the type system never saw.
 *
 * Reads only the discriminant, and reads it as `unknown` rather than through a declared
 * shape: plain JavaScript, a hostile object and a value widened through `unknown` all
 * arrive here, and none of them was ever checked by the `Exclude` above.
 */
function isRedaxTeamAdminChoreographyOnlyTerminal(value: unknown): boolean {
  return (
    typeof value === 'string' &&
    (REDAX_TEAM_ADMIN_CHOREOGRAPHY_ONLY_TERMINALS as readonly string[]).includes(value)
  )
}

/**
 * The generic transition input, with the origin-only verified terminal removed.
 *
 * Structurally identical to `RedaxTeamAdminRecoveryTransitionInput` apart from that one
 * member, so the compare-and-set discipline the caller must satisfy is unchanged.
 */
interface RedaxTeamAdminGenericRecoveryTransitionInput {
  readonly namespace: RedaxTeamAdminRecoveryNamespace
  readonly expectedAttemptNonce: string
  readonly expectedRevision: number
  readonly transition: RedaxTeamAdminGenericRecoveryTransition
}

/**
 * The composed Team/Admin surface.
 *
 * Every member is a PURE projection, an explicit caller-invoked durable record
 * operation, the ONE S1 signing choreography, or the ONE reconciliation-only operation.
 * No member returns a `Transaction`, a `Keypair`, a `Connection`, a signature or a byte
 * of signed material, and there is no generic sender, no generic signer, no simulator
 * and no confirmer anywhere on it.
 *
 * EXACTLY ONE MEMBER CAN SIGN, AND EXACTLY ONE CAN SEND, AND THEY ARE THE SAME MEMBER.
 * `submitS1` is the whole of it. `reconcileS1` sits beside it and can do neither, which
 * is what makes it safe to call after a refresh, in a second tab, or twice.
 */
export interface RedaxTeamAdminActionsValue {
  readonly transactionCapability: typeof REDAX_TEAM_ADMIN_TRANSACTION_CAPABILITY
  readonly rawBroadcastCapability: typeof REDAX_TEAM_ADMIN_RAW_BROADCAST_CAPABILITY
  /** The public projection of the private attempt. Re-read after every transition. */
  readonly attempt: RedaxTeamAdminAttemptProjectionV1
  /**
   * Advance the private in-memory attempt with a NON-SECRET event. Pure; touches no
   * storage and no chain. Custody never travels through this member — see
   * `RedaxTeamAdminAttemptEvent`.
   */
  readonly advanceAttempt: (event: RedaxTeamAdminAttemptEvent) => RedaxTeamAdminAttemptOutcome
  /**
   * THE ONE S1 SIGNING CHOREOGRAPHY, and the only entrypoint that can reach a chain
   * mutation: build, guard, partial-sign, ask the wallet ONCE, verify exactly two
   * signatures, reassert the chain, durably mark the invocation and retain the local
   * signature — each read-verified — and then broadcast the exact verified bytes ONCE.
   */
  readonly submitS1: (
    request: RedaxTeamAdminS1SetupRequest,
  ) => Promise<RedaxTeamAdminS1SubmitResult>
  /**
   * THE ONE RECONCILIATION-ONLY OPERATION. It takes NO arguments at all.
   *
   * That is not an ergonomic choice, it is the security property: there is no parameter
   * through which a caller could supply a signature, a Campaign, a mint, a fee vault, a
   * plan fingerprint, a salt, a blockhash or a "this is definitively dead" boolean. Every
   * fact it acts on comes from the validated runtime, the injected approved-Team identity
   * and the current durable journal record — three things a caller cannot forge by
   * calling it differently.
   *
   * It generates no key, materializes no custody, builds no transaction, opens no wallet,
   * signs nothing, sends nothing, rebuilds nothing and retries nothing.
   */
  readonly reconcileS1: () => Promise<RedaxTeamAdminS1ReconcileResult>
  /**
   * THE PASSIVE C1 DEVNET SOL READ. READ ONLY, and it takes NO arguments at all.
   *
   * That is the security property, not an ergonomic one: there is no parameter through
   * which a caller could supply a wallet, an endpoint, a program, a Connection, a
   * threshold or a commitment. It resolves the bounded runtime configuration itself,
   * reads the broker's own current key itself, requires that key to EXACTLY equal the
   * injected approved Team identity, and refuses as `READ_UNAVAILABLE` on any of those —
   * so the answer is always about the one payer an S1 could actually use.
   *
   * IT BUILDS NO INSTRUCTION, creates no `Transaction`, opens no journal, writes nothing,
   * signs nothing, sends nothing, confirms nothing, reconciles nothing and returns no
   * permission. It is not authority and cannot become authority: `submitS1` performs its
   * OWN attempt-authoritative recheck on the attempt's own Connection, at the attempt's
   * own floor, through the SAME private observer, and refuses there regardless of anything
   * this member ever reported. Its only job is to decide what a panel may OFFER.
   *
   * It creates ONE fresh read-only scoped `Connection` per explicit call. That raises this
   * root's `new Connection` construction SITES from two to three; the Connection OWNER
   * FILE is unchanged, and no other module gains one.
   */
  readonly readTeamAdminSolPreflight: () => Promise<RedaxTeamAdminSolPreflightResult>
  /** Recompute a frozen plan's fingerprint. Pure apart from the Web Crypto digest. */
  readonly fingerprintPlan: (plan: RedaxFrozenCampaignPlanV1) => Promise<string>
  /** Read the one durable Team/Admin recovery slot. Never authorizes anything. */
  readonly readRecoveryRecord: (
    namespace: RedaxTeamAdminRecoveryNamespace,
  ) => Promise<RedaxTeamAdminRecoveryReadResult>
  /** Open the one durable recovery slot, or replace a replaceable tombstone. */
  readonly openRecoveryRecord: (
    input: RedaxTeamAdminRecoveryBeginInput,
  ) => Promise<RedaxTeamAdminRecoveryWriteResult>
  /**
   * Advance the durable recovery slot under exact compare-and-set.
   *
   * GENERIC, and therefore deliberately INCOMPLETE: it can neither represent nor execute
   * `RESOLVE_VERIFIED_NO_BROADCAST` or `RESOLVE_FINALIZED_NO_LAND`. Each asserts
   * something only the code that performed it could know — a wallet signature and an
   * exact two-signature verification for the first, a ten-member finalized conjunction
   * for the second — and both are owned privately by the choreographies that can
   * establish them, never routed through this member. No caller-supplied boolean, and in
   * particular nothing of the shape `submissionDefinitivelyDead`, exists anywhere on this
   * surface: a boolean is a claim, and the conjunction is a proof.
   *
   * The narrowing is enforced TWICE: in the type above, and again at runtime below for
   * callers that are not type-checked at all. The runtime half judges a discriminant
   * captured ONCE from a snapshot of the input, and the journal is handed that same
   * snapshot — never the caller's object — so no accessor can answer the check and the
   * journal differently.
   */
  readonly advanceRecoveryRecord: (
    input: RedaxTeamAdminGenericRecoveryTransitionInput,
  ) => Promise<RedaxTeamAdminRecoveryWriteResult>
  /** Judge an INJECTED coherent observation against an INJECTED plan expectation. */
  readonly projectPostState: (
    observation: RedaxS1CoherentObservationV1,
    landedMessage: RedaxS1LandedMessageAssessmentV1,
    plan: RedaxTeamAdminPlanExpectation,
  ) => RedaxS1PostStateV1
  /** The pure campaign-setup recovery FSM, exposed unchanged. */
  readonly projectRecoveryTransition: (
    context: RedaxCampaignRecoveryContextV1,
    event: RedaxCampaignRecoveryEvent,
  ) => RedaxCampaignRecoveryTransition
  /** A fresh recovery context. Pure. */
  readonly initialRecoveryContext: () => RedaxCampaignRecoveryContextV1
}

const RedaxTeamAdminActionsContext = createContext<RedaxTeamAdminActionsValue | null>(null)

// --- Local, bounded platform access ---------------------------------------------

/**
 * The CSPRNG, resolved structurally on every call and never cached.
 *
 * `Math.random` is not an alternative and is not named anywhere in this file: the salt
 * decides the Campaign PDA, so a predictable one is a predictable campaign address.
 * A platform without a real generator refuses the attempt.
 */
function drawSaltBytes(): Uint8Array | null {
  const candidate = (globalThis as { crypto?: unknown }).crypto
  if (typeof candidate !== 'object' || candidate === null) {
    return null
  }
  const generator = (candidate as { getRandomValues?: unknown }).getRandomValues
  if (typeof generator !== 'function') {
    return null
  }
  const salt = new Uint8Array(REDAX_CAMPAIGN_SALT_BYTES)
  try {
    ;(generator as (this: unknown, target: Uint8Array) => unknown).call(candidate, salt)
  } catch {
    return null
  }
  // A generator that returned all zeroes is not a generator this file can trust.
  return salt.some((byte) => byte !== 0) ? salt : null
}

/**
 * Read one property from an untrusted value and CONTAIN whatever that read runs.
 *
 * Reading a property MAY EXECUTE CALLER CODE — a getter, or a `Proxy` `get` trap — and on
 * a revoked `Proxy` it throws before any handler is consulted at all. None of that can be
 * prevented from here, so it is bounded instead: the read happens exactly ONCE, a throw
 * becomes `ok: false` rather than an escaping exception, and nothing is read from a value
 * that is not an object. A shape that answers differently on a second read never gets one,
 * and no thrown value, message or endpoint of the caller's survives this frame.
 */
function readUntrusted(source: unknown, key: string): { ok: boolean; value: unknown } {
  if (typeof source !== 'object' || source === null) {
    return { ok: false, value: undefined }
  }
  try {
    return { ok: true, value: (source as Record<string, unknown>)[key] }
  } catch {
    return { ok: false, value: undefined }
  }
}

// --- The generic recovery boundary's ONE stable snapshot -------------------------

/**
 * The MOST MEMBERS any array the journal could accept is able to have.
 *
 * The generic surface has exactly ONE array-valued payload — `RECORD_OBSERVATION`'s
 * `issueCodes` — and the journal judges it against a CLOSED twenty-member vocabulary while
 * refusing any repeat. A twenty-first entry therefore contains a duplicate by counting
 * alone, so no array longer than this can be part of an input the journal ACCEPTS: the
 * bound refuses earlier exactly what the layer behind it would refuse anyway, and refuses
 * nothing it would have taken.
 *
 * It exists because a length is a CALLER-CONTROLLED NUMBER. A `Proxy` answering
 * `4294967296` would otherwise reach an allocation, which is a `RangeError` or an
 * out-of-memory attempt rather than a refusal, and a boundary whose job is to fail closed
 * must not be a way to spend this tab's memory instead.
 *
 * It is deliberately LOCAL and unexported. The vocabulary belongs to the journal, and a
 * second exported copy of that fact is a second thing that can drift away from it.
 */
const REDAX_TEAM_ADMIN_GENERIC_RECOVERY_SNAPSHOT_MAX_ARRAY_LENGTH = 20

/**
 * Is this untrusted value an ARRAY? Answered as a VALUE, because ASKING can throw.
 *
 * `Array.isArray` is not a passive question. On a revoked `Proxy` it throws a `TypeError`
 * before any handler runs — and it is asked of exactly the caller-controlled values a
 * hostile input is made of: the record itself, and every member of it. An exception
 * escaping there would leave the generic boundary neither refusing nor succeeding, so the
 * throw is contained here and becomes `ok: false`. A value that cannot even be CLASSIFIED
 * is a value this boundary refuses, value-free, through its existing codes.
 *
 * Every untrusted array classification in this file goes through THIS ONE primitive; a
 * bare `Array.isArray` anywhere in the snapshot path would be the same defect again.
 */
function classifyUntrustedArray(value: unknown): { ok: boolean; value: boolean } {
  try {
    return { ok: true, value: Array.isArray(value) }
  } catch {
    return { ok: false, value: false }
  }
}

/**
 * Copy an untrusted ARRAY member into a NEW frozen array, reading each slot ONCE.
 *
 * The caller's array may be a `Proxy` whose `length` and whose elements are all traps, so
 * each is consulted exactly once THROUGH THE PROTECTED READER above and the captured
 * answers are what travel onward. The source of the mapping is a plain local `{ length }`,
 * never the caller's value, so no `Symbol.iterator` and no `Symbol.species` of theirs
 * participates, and the caller's array reference itself never leaves this frame.
 *
 * `length` is judged BEFORE anything is allocated and BEFORE any index is read, and a
 * length past the bound above is REFUSED rather than shortened: a snapshot STABILISES an
 * input, it never SANITISES one, and a boundary that quietly truncated an over-long array
 * would hand the journal a value the caller never sent. On that path no index trap is
 * entered at all and nothing proportional to the claimed length is allocated.
 *
 * The construction and the copy sit inside the same failure boundary, so an allocation
 * that fails is a refusal too — the callbacks themselves cannot throw, but a rule about a
 * REGION keeps holding the day another operation joins it.
 *
 * It VALIDATES NOTHING. Which codes are legal, and in what order, stays the journal's.
 */
function copyUntrustedArray(value: unknown): readonly unknown[] | null {
  const length = readUntrusted(value, 'length')
  if (
    !length.ok ||
    typeof length.value !== 'number' ||
    !Number.isSafeInteger(length.value) ||
    length.value < 0 ||
    length.value > REDAX_TEAM_ADMIN_GENERIC_RECOVERY_SNAPSHOT_MAX_ARRAY_LENGTH
  ) {
    return null
  }
  const bounded = length.value
  try {
    const slots = Array.from({ length: bounded }, (_slot, index) =>
      readUntrusted(value, String(index)),
    )
    return slots.every((slot) => slot.ok)
      ? Object.freeze(slots.map((slot) => slot.value))
      : null
  } catch {
    return null
  }
}

/**
 * Rebuild an untrusted record as PLAIN FROZEN OWN DATA, reading every member ONCE.
 *
 * It copies EXACTLY THE ENUMERABLE OWN STRING KEYS that are there — `Object.keys`, which
 * is precisely the universe the journal's own exact-key rule is computed over — and it
 * adds none, drops none and renames none. That matters as much as the freezing: the
 * journal decides what a valid key set is, and a boundary that quietly normalised one
 * would be accepting inputs the layer behind it rejects. What changes is only that every
 * member is now a fixed own DATA property of a new plain object: no accessor, no
 * descriptor and no prototype of the caller's is forwarded, and none of their code can
 * run again on the far side of this function.
 *
 * `alreadyRead` names the ONE member the caller has already captured — the discriminant
 * — which is therefore skipped rather than consulted a second time. Its own-key PRESENCE
 * is still required, because reconstructing it from a capture while it was never an own
 * key would manufacture a key set the original did not have.
 *
 * Both places this asks "is that an array?" go through the contained classifier, because
 * both are asking it of a value the caller chose — the record here, and every member of
 * it below.
 */
function snapshotUntrustedRecord(
  value: unknown,
  alreadyRead?: string,
): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }
  const classified = classifyUntrustedArray(value)
  if (!classified.ok || classified.value) {
    return null
  }
  let keys: string[]
  try {
    keys = Object.keys(value)
  } catch {
    return null
  }
  if (alreadyRead !== undefined && !keys.includes(alreadyRead)) {
    return null
  }
  const members = keys
    .filter((key) => key !== alreadyRead)
    .map((key) => {
      const read = readUntrusted(value, key)
      if (!read.ok) {
        return { key, ok: false, value: undefined as unknown }
      }
      const member = classifyUntrustedArray(read.value)
      if (!member.ok) {
        return { key, ok: false, value: undefined as unknown }
      }
      if (member.value) {
        const copied = copyUntrustedArray(read.value)
        return { key, ok: copied !== null, value: copied as unknown }
      }
      return { key, ok: true, value: read.value }
    })
  return members.every((member) => member.ok)
    ? Object.fromEntries(members.map((member) => [member.key, member.value]))
    : null
}

/**
 * What the generic boundary hands onward: ONE captured discriminant, ONE plain input.
 *
 * `capturedTransitionType` is present on BOTH arms deliberately. The runtime exclusion
 * must be able to judge the discriminant even when the rest of the input could not be
 * captured, because "this input was malformed" must never become a reason to skip
 * "this input asked for a terminal it may not ask for".
 */
type RedaxTeamAdminGenericInputSnapshot =
  | {
      readonly ok: true
      readonly capturedTransitionType: unknown
      readonly input: RedaxTeamAdminRecoveryTransitionInput
    }
  | {
      readonly ok: false
      readonly capturedTransitionType: unknown
      readonly code: 'NAMESPACE_INVALID' | 'INPUT_INVALID'
    }

/**
 * Read the caller's mutation input ONCE, and rebuild it as plain frozen own data.
 *
 * THIS IS THE SECURITY PRIMITIVE, and the reason it exists is that inspecting a value
 * and then forwarding the object it came from are two different reads. A getter or a
 * `Proxy` can answer differently each time, so a boundary that checked `input.transition`
 * and then passed `input` onward would let the journal observe a transition the check
 * never approved — including a choreography-owned terminal whose ten-member finalized
 * proof nobody performed. The journal reads the namespace more than once besides, so the
 * same shape could approve one durable slot and write a different one.
 *
 * Nothing here trusts a shape to hold still. `Object.freeze` on the CALLER's object would
 * freeze a `Proxy`'s handler rather than its answers, `readonly` and the interface above
 * are erased long before any of this runs, and JavaScript offers no way to detect a
 * `Proxy` at all. What it does offer is to READ ONCE, COPY INTO PLAIN OWN PROPERTIES,
 * FREEZE THE COPY, and never look at the original again — after which every later read,
 * by this file or by the journal, is a read of the same fixed value.
 *
 * It VALIDATES NOTHING, and it NORMALISES NOTHING. Cluster membership, base58 identities,
 * the nonce pattern, the revision, the transition vocabulary, the per-transition key sets,
 * the observation vocabulary and the issue codes are all still judged by the journal, over
 * the copy — which is exactly why this file spells none of them and cannot fall out of
 * step with them.
 */
function snapshotGenericRecoveryTransitionInput(
  input: RedaxTeamAdminGenericRecoveryTransitionInput,
): RedaxTeamAdminGenericInputSnapshot {
  // ONE read of `transition`, and then ONE read of its discriminant. Every later decision
  // in this file is made from these two captured values and from nothing else, and the
  // discriminant is a captured PRIMITIVE — it has no accessor and cannot answer twice.
  const rawTransition = readUntrusted(input, 'transition')
  const rawType = readUntrusted(rawTransition.value, 'type')
  const capturedTransitionType = rawType.ok ? rawType.value : undefined
  const refuse = (
    code: 'NAMESPACE_INVALID' | 'INPUT_INVALID',
  ): RedaxTeamAdminGenericInputSnapshot => ({ ok: false, capturedTransitionType, code })

  // The transition REFERENCE and its discriminant are already captured ABOVE, ahead of
  // everything else, so the exclusion can still judge an input nothing else about could
  // be captured. What is ordered HERE is the two REFUSALS: the namespace RECORD is
  // snapshotted before the transition MEMBERS, because the journal refuses an invalid
  // namespace before it looks at the transition at all, and a repair must not renumber
  // which refusal a caller sees.
  const rawNamespace = readUntrusted(input, 'namespace')
  const namespace = snapshotUntrustedRecord(rawNamespace.value)
  if (namespace === null) {
    return refuse('NAMESPACE_INVALID')
  }
  const members = snapshotUntrustedRecord(rawTransition.value, 'type')
  if (members === null) {
    return refuse('INPUT_INVALID')
  }
  const expectedAttemptNonce = readUntrusted(input, 'expectedAttemptNonce')
  const expectedRevision = readUntrusted(input, 'expectedRevision')
  if (!expectedAttemptNonce.ok || !expectedRevision.ok) {
    return refuse('INPUT_INVALID')
  }
  return {
    ok: true,
    capturedTransitionType,
    // The one assertion in this file, and it claims only that the members are FIXED —
    // never that they are valid. Every one of them is still judged by the journal, which
    // is why this cast cannot hide a bad value: it would be refused on the other side.
    input: Object.freeze({
      namespace: Object.freeze(namespace),
      expectedAttemptNonce: expectedAttemptNonce.value,
      expectedRevision: expectedRevision.value,
      transition: Object.freeze({ ...members, type: capturedTransitionType }),
    }) as unknown as RedaxTeamAdminRecoveryTransitionInput,
  }
}

/**
 * Is this signature-status response EXACTLY ONE NULL ENTRY, at or above `floorSlot`?
 *
 * FOUR SEPARATE REQUIREMENTS, and the whole point is that none of them is inferred from
 * another:
 *
 *   1. the response parses as a context-bearing object with a whole-number slot;
 *   2. that slot is at or above the post-expiry finalized floor — the request option
 *      protects request EVALUATION, and this rejects a stale ANSWER;
 *   3. `value` is an array of exactly the arity the single-element query implies;
 *   4. its one element is GENUINELY `null`.
 *
 * `undefined` IS NOT NULL. A missing array member is not null. A malformed response is
 * not null. An error shape is not null. Each of those is an UNKNOWN, and the one thing
 * this function exists to prevent is an unknown being read as an absence — which, for the
 * terminal it gates, would mean recording that a transaction provably never landed on the
 * strength of a question nobody answered.
 */
function isExactlyOneNullStatusAtOrAbove(response: unknown, floorSlot: number): boolean {
  const context = readUntrusted(response, 'context')
  if (!context.ok) {
    return false
  }
  const slot = readUntrusted(context.value, 'slot')
  if (!slot.ok || typeof slot.value !== 'number' || !Number.isSafeInteger(slot.value)) {
    return false
  }
  if (slot.value < floorSlot) {
    return false
  }
  const value = readUntrusted(response, 'value')
  if (!value.ok || !Array.isArray(value.value) || value.value.length !== 1) {
    return false
  }
  const entry = readUntrusted(value.value, '0')
  return entry.ok && entry.value === null
}

/** The broker's key RIGHT NOW. A throwing broker is unavailability, not an exception. */
function readLiveTeamWallet(broker: RedaxTeamAdminS1SignOnlyBroker): PublicKey | null {
  try {
    return broker.readCurrentPublicKey()
  } catch {
    return null
  }
}

// --- The ONE S1 SOL-preflight observer ----------------------------------------
//
// C1 AND C2 CALL EXACTLY THIS. The passive read the panel exposes and the
// attempt-authoritative recheck inside `submitS1` differ in WHEN they run and in what a
// refusal costs — never in what "enough SOL" means. One private observer is what makes
// that structural: there is a single threshold formula, a single set of validity rules
// and a single comparison, so the number the operator was shown and the number the
// attempt refuses against cannot drift apart.
//
// The two callers differ in exactly ONE argument: C1 passes `minContextSlot = null`,
// because no attempt floor exists yet for a passive read; C2 passes the attempt's accepted
// Phase-A floor, so a lagging node can neither answer nor be believed.

/** Addition that refuses to wrap past the u64 width instead of producing nonsense. */
function checkedAddLamports(left: bigint, right: bigint): bigint | null {
  const sum = left + right
  return sum >= 0n && sum <= REDAX_TEAM_ADMIN_U64_MAX ? sum : null
}

/**
 * A lamport BALANCE from an untrusted response, or null.
 *
 * ZERO IS VALID and means insufficient whenever the requirement is positive — the
 * contextual balance read throws on an RPC error rather than returning zero, so an
 * observed zero is a REAL balance, and reclassifying it as a failed read would hide
 * exactly the state this preflight exists to surface.
 */
function readSafeBalanceLamports(value: unknown): bigint | null {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    return null
  }
  return BigInt(value)
}

/**
 * A RENT lamport quantity from an untrusted response, or null.
 *
 * STRICTLY POSITIVE and a safe integer. The asymmetry with a balance runs the other way
 * and is deliberate: zero, negative and fractional rents are each treated as a FAILED READ
 * rather than as a requirement, because zero is not a devnet rent figure and accepting one
 * would understate the threshold by an entire term. There is no fallback, no default and
 * no carried-over value — an unreadable rent withholds the action.
 */
function readValidRentLamports(value: unknown): bigint | null {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    return null
  }
  return BigInt(value)
}

/** One protected property read: a hostile accessor that throws becomes a refusal. */
function readCandidateProperty(
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
function readContextualBalance(
  response: unknown,
): { readonly lamports: bigint; readonly contextSlot: number } | null {
  const context = readCandidateProperty(response, 'context')
  if (!context.ok) {
    return null
  }
  const slot = readCandidateProperty(context.value, 'slot')
  if (
    !slot.ok ||
    typeof slot.value !== 'number' ||
    !Number.isSafeInteger(slot.value) ||
    slot.value < 0
  ) {
    return null
  }
  const value = readCandidateProperty(response, 'value')
  if (!value.ok) {
    return null
  }
  const lamports = readSafeBalanceLamports(value.value)
  if (lamports === null) {
    return null
  }
  return { lamports, contextSlot: slot.value }
}

/**
 * THE ONE S1 THRESHOLD FORMULA.
 *
 * requiredS1 = rent(0) + rent(82) + rent(165) + rent(231) + 20000
 *
 * Four allocations and one fee bound, and NOTHING else:
 *
 *   * `rent(0)`   — the payer's own rent-exempt floor;
 *   * `rent(82)`  — the classic SPL output MINT this S1 creates, at the library's own
 *                   `MINT_SIZE` via the existing `REDAX_CLASSIC_MINT_SPACE`;
 *   * `rent(165)` — the classic SPL protocol fee-vault token ACCOUNT S1 creates, at the
 *                   library's own `ACCOUNT_SIZE`;
 *   * `rent(231)` — the Campaign PDA, `8 + Campaign::INIT_SPACE`.
 */
function requiredS1Lamports(
  payerRent: bigint,
  mintRent: bigint,
  tokenAccountRent: bigint,
  campaignRent: bigint,
): bigint | null {
  const withMint = checkedAddLamports(payerRent, mintRent)
  if (withMint === null) {
    return null
  }
  const withTokenAccount = checkedAddLamports(withMint, tokenAccountRent)
  if (withTokenAccount === null) {
    return null
  }
  const withCampaign = checkedAddLamports(withTokenAccount, campaignRent)
  if (withCampaign === null) {
    return null
  }
  return checkedAddLamports(withCampaign, BigInt(TEAM_ADMIN_S1_SOL_PREFLIGHT_FEE_BOUND_LAMPORTS))
}

/**
 * Read the four live rent floors and the live contextual balance, and compare.
 *
 * UNKNOWN NEVER MEANS SUFFICIENT. A throw, an unreadable response, a rent that is not
 * strictly positive, a balance that is not a non-negative safe integer, a missing or
 * invalid context, a returned context below the requested floor and any overflow ALL
 * yield `READ_UNAVAILABLE`, and every one of them WITHHOLDS the action rather than
 * allowing it.
 *
 * EXACT EQUALITY IS SUFFICIENT. The threshold already carries the conservative fee
 * allowance, and demanding one lamport more would be a second, undeclared buffer.
 *
 * `getBalanceAndContext` and never the context-free balance RPC, which remains forbidden: a
 * balance with no context slot cannot be gated against an attempt floor or bound into the
 * chain guard, and both are mandatory for C2. The dynamic compiled-message fee RPC is never
 * called.
 */
async function observeRedaxTeamAdminS1SolPreflight(
  connection: Connection,
  payer: PublicKey,
  minContextSlot: number | null,
): Promise<RedaxTeamAdminSolPreflightObservation> {
  let payerRent: bigint
  let mintRent: bigint
  let tokenAccountRent: bigint
  let campaignRent: bigint
  try {
    const payerRentRead = await connection.getMinimumBalanceForRentExemption(
      REDAX_TEAM_ADMIN_PAYER_ACCOUNT_DATA_LENGTH,
      REDAX_TEAM_ADMIN_ACTION_COMMITMENT,
    )
    const mintRentRead = await connection.getMinimumBalanceForRentExemption(
      REDAX_CLASSIC_MINT_SPACE,
      REDAX_TEAM_ADMIN_ACTION_COMMITMENT,
    )
    const tokenAccountRentRead = await connection.getMinimumBalanceForRentExemption(
      REDAX_CLASSIC_TOKEN_ACCOUNT_SPACE,
      REDAX_TEAM_ADMIN_ACTION_COMMITMENT,
    )
    const campaignRentRead = await connection.getMinimumBalanceForRentExemption(
      REDAX_TEAM_ADMIN_CAMPAIGN_ACCOUNT_SPACE,
      REDAX_TEAM_ADMIN_ACTION_COMMITMENT,
    )
    const payer0 = readValidRentLamports(payerRentRead)
    const mint82 = readValidRentLamports(mintRentRead)
    const account165 = readValidRentLamports(tokenAccountRentRead)
    const campaign231 = readValidRentLamports(campaignRentRead)
    if (payer0 === null || mint82 === null || account165 === null || campaign231 === null) {
      return REDAX_TEAM_ADMIN_SOL_PREFLIGHT_RENT_UNAVAILABLE
    }
    payerRent = payer0
    mintRent = mint82
    tokenAccountRent = account165
    campaignRent = campaign231
  } catch {
    return REDAX_TEAM_ADMIN_SOL_PREFLIGHT_RENT_UNAVAILABLE
  }

  // AN OVERFLOW IS A GUARD REFUSAL, NOT A RENT FAILURE. Every rent figure was already
  // validated above, so a sum that cannot fit the u64 width is arithmetic this attempt
  // must not proceed on rather than evidence that a read failed.
  const required = requiredS1Lamports(payerRent, mintRent, tokenAccountRent, campaignRent)
  if (required === null) {
    return REDAX_TEAM_ADMIN_SOL_PREFLIGHT_GUARD_UNAVAILABLE
  }

  let balanceRead: unknown
  try {
    balanceRead = await connection.getBalanceAndContext(
      payer,
      minContextSlot === null
        ? { commitment: REDAX_TEAM_ADMIN_ACTION_COMMITMENT }
        : { commitment: REDAX_TEAM_ADMIN_ACTION_COMMITMENT, minContextSlot },
    )
  } catch {
    return REDAX_TEAM_ADMIN_SOL_PREFLIGHT_GUARD_UNAVAILABLE
  }
  const observed = readContextualBalance(balanceRead)
  if (observed === null) {
    return REDAX_TEAM_ADMIN_SOL_PREFLIGHT_GUARD_UNAVAILABLE
  }
  // The request-level `minContextSlot` protects request EVALUATION; this rejects a stale
  // RETURNED context. Both are mandatory — a node may honour neither, and only the local
  // check can tell.
  if (minContextSlot !== null && observed.contextSlot < minContextSlot) {
    return REDAX_TEAM_ADMIN_SOL_PREFLIGHT_GUARD_UNAVAILABLE
  }
  return {
    result: observed.lamports >= required ? 'SUFFICIENT' : 'INSUFFICIENT',
    balanceContextSlot: observed.contextSlot,
    mintRentLamports: mintRent,
  }
}

// THE PROBLEM THIS CLOSES, stated exactly. The early ACTIVE check at 6b reads the journal
// under its exclusive lock and then RELEASES that lock before the awaited C2 SOL work runs.
// A second tab may therefore establish a durable ACTIVE attempt inside that window. When C2
// SUCCEEDS the later durable `begin` — a compare-and-set under the same lock — still catches
// it. When C2 REFUSES the path never reaches `begin`, so without this read the session would
// answer "you are short of SOL" while the higher-priority truth is "you already hold an
// unresolved attempt". Funding the wallet would not unblock that attempt.
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

/** The C2 SOL-preflight refusal codes this classifier may be asked to fall back to. */
type RedaxTeamAdminS1SolRefusalFallback = Extract<
  RedaxTeamAdminS1SubmitCode,
  'PAYER_SOL_INSUFFICIENT' | 'RENT_READ_UNAVAILABLE' | 'CHAIN_GUARD_REFUSED'
>

/** What a C2 SOL refusal finally resolves to, once the journal has had the last word. */
type RedaxTeamAdminS1SolRefusalCode =
  | RedaxTeamAdminS1SolRefusalFallback
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
 * attempt nonce, no revision, no record and no journal identity ever leaves this function.
 *
 * FAIL-CLOSED ON AN UNTRUSTWORTHY READ. An unavailable lock, an unavailable storage port, a
 * corrupt or incompatible record and an unexpected throw all yield `JOURNAL_UNAVAILABLE`
 * rather than the original SOL code, because a journal that cannot be read is not evidence
 * that no attempt exists.
 */
async function finalizeRedaxTeamAdminS1SolRefusal(
  namespace: RedaxTeamAdminRecoveryNamespace,
  fallback: RedaxTeamAdminS1SolRefusalFallback,
  readJournal: (
    namespace: RedaxTeamAdminRecoveryNamespace,
  ) => Promise<RedaxTeamAdminRecoveryReadResult>,
): Promise<RedaxTeamAdminS1SolRefusalCode> {
  let finalRead: RedaxTeamAdminRecoveryReadResult
  try {
    finalRead = await readJournal(namespace)
  } catch {
    return 'JOURNAL_UNAVAILABLE'
  }
  if (finalRead === null || typeof finalRead !== 'object' || !finalRead.ok) {
    return 'JOURNAL_UNAVAILABLE'
  }
  if (finalRead.kind === 'ACTIVE') {
    // THE DURABLE RECORD OUTRANKS THE BALANCE. It outranks the insufficiency code and both
    // unavailable-observation codes alike, because it answers a different and more urgent
    // question than any of them.
    return 'ATTEMPT_BLOCKED'
  }
  // EMPTY and TOMBSTONE both mean no unresolved attempt exists, so the SOL refusal the C2
  // phase actually produced is preserved exactly as it was.
  return fallback
}

/** Exactly what a durable write must be able to prove it produced. */
interface RedaxTeamAdminExpectedRecordV1 {
  readonly lifecycle: string
  readonly observation: string | null
  readonly resolution: string | null
  readonly knownSignature: string | null
  readonly issueCodes: readonly RedaxTeamAdminRecoveryIssueCode[]
}

/** The write-then-read-back primitive, as the settlement helper consumes it. */
type RedaxTeamAdminApplyAndVerify = (
  input: RedaxTeamAdminRecoveryTransitionInput,
  expect: RedaxTeamAdminExpectedRecordV1,
) => Promise<boolean>

/** One bounded settlement verdict. Carries no value of any kind. */
interface RedaxTeamAdminSettlementV1 {
  readonly ok: boolean
  readonly code: RedaxTeamAdminS1SubmitCode
}

/**
 * Map ONE post-send observation onto the ALREADY ACCEPTED journal and post-state
 * semantics. It decides no new outcome and grants no new permission.
 *
 * WHY IT RESOLVES ONLY ON `finalized`. Two of the terminals it can reach —
 * `RESOLVED_MATCHING_COMPLETE_STATE` and `ACCEPTED_RESOLVED_TERMINAL_FAILURE` — are
 * REPLACEABLE, so reaching either eventually permits a separately authorized human to
 * start a NEW attempt. A confirmed block can still be reorganised, so adopting a merely
 * confirmed observation as terminal would let a reorganisation turn a resolved attempt
 * into a second live one. A confirmed observation is therefore RECORDED and left
 * unresolved: recording is what is known, resolving is what is permanent, and only the
 * second one needs finality. Declining to resolve invents nothing — it is the default —
 * and it is the same discipline the accepted Holder route already applies.
 *
 * NOTHING HERE ACKNOWLEDGES SUPPORT. `ACCEPTED_SUPPORT_DISPOSITION` is permanently
 * non-replaceable, and reaching it automatically would let a machine close an attempt
 * nobody understood. Orphan residue, a changed ProtocolConfig, an unreadable member and
 * every other support state stay UNRESOLVED and BLOCKING.
 *
 * It sends nothing, signs nothing, prompts nothing and retries nothing.
 */
async function settleSubmittedOutcome(input: {
  readonly outcome: RedaxKnownSignatureOutcome
  readonly namespace: RedaxTeamAdminRecoveryNamespace
  readonly connection: Connection
  readonly programId: PublicKey
  /**
   * THE FROZEN POST-STATE EXPECTATION. In the submit choreography it comes straight from
   * the in-memory frozen plan; in the explicit reconciliation it is rebuilt from the
   * durable v2 record, whose expectations were written and read back BEFORE the one raw
   * send. Neither caller ever derives a member of it from the read it is compared against.
   */
  readonly expectation: RedaxTeamAdminPlanExpectation
  readonly localKnownSignature: RedaxKnownSignature
  /** The minimum context the coherent account read may be answered at. */
  readonly readFloor: number
  readonly applyAndVerify: RedaxTeamAdminApplyAndVerify
  readonly readCursor: () => RedaxTeamAdminRecoveryAttemptIdentity
}): Promise<RedaxTeamAdminSettlementV1> {
  const { outcome, namespace, expectation, localKnownSignature, applyAndVerify, readCursor } =
    input

  /** Record one observation at `KNOWN_SIGNATURE`, and read it back exactly. */
  const record = async (
    observation: RedaxTeamAdminRecoveryObservation,
    issueCodes: readonly RedaxTeamAdminRecoveryIssueCode[],
  ): Promise<boolean> => {
    const cursor = readCursor()
    return applyAndVerify(
      {
        namespace,
        expectedAttemptNonce: cursor.attemptNonce,
        expectedRevision: cursor.revision,
        transition: { type: 'RECORD_OBSERVATION', observation, issueCodes },
      },
      {
        lifecycle: 'KNOWN_SIGNATURE',
        observation,
        resolution: null,
        knownSignature: localKnownSignature,
        issueCodes,
      },
    )
  }

  /**
   * Record, then leave the attempt unresolved and blocking. Never a terminal.
   *
   * An unreadable observation answers with its own code, so a transient read failure is
   * never presented as a case for support; every other recorded state keeps the
   * support-only code it always had.
   */
  const recordAndBlock = async (
    observation: RedaxTeamAdminRecoveryObservation,
    issueCodes: readonly RedaxTeamAdminRecoveryIssueCode[],
  ): Promise<RedaxTeamAdminSettlementV1> => {
    const recorded = await record(observation, issueCodes)
    if (!recorded) {
      return { ok: false, code: 'TERMINAL_RECORD_UNVERIFIED' }
    }
    return {
      ok: false,
      code:
        observation === 'READ_UNAVAILABLE'
          ? 'SUBMITTED_OUTCOME_UNREADABLE'
          : 'SUBMITTED_OUTCOME_UNRESOLVED_SUPPORT',
    }
  }

  /**
   * A landed terminal failure: record the exact observation, and resolve it ONLY when
   * the chain has finalized it.
   */
  const settleLandedFailure = async (
    observation: 'LANDED_TRANSACTION_FAILED' | 'LANDED_MESSAGE_MISMATCH',
    issueCodes: readonly RedaxTeamAdminRecoveryIssueCode[],
  ): Promise<RedaxTeamAdminSettlementV1> => {
    if (!(await record(observation, issueCodes))) {
      return { ok: false, code: 'TERMINAL_RECORD_UNVERIFIED' }
    }
    if (outcome.finality !== 'finalized') {
      return { ok: false, code: 'SUBMITTED_OUTCOME_UNRESOLVED_SUPPORT' }
    }
    const cursor = readCursor()
    const resolved = await applyAndVerify(
      {
        namespace,
        expectedAttemptNonce: cursor.attemptNonce,
        expectedRevision: cursor.revision,
        transition: { type: 'RESOLVE_TERMINAL_FAILURE' },
      },
      {
        lifecycle: 'TOMBSTONE',
        observation,
        resolution: 'ACCEPTED_RESOLVED_TERMINAL_FAILURE',
        knownSignature: localKnownSignature,
        issueCodes,
      },
    )
    return resolved
      ? { ok: false, code: 'SUBMITTED_TERMINAL_FAILURE' }
      : { ok: false, code: 'TERMINAL_RECORD_UNVERIFIED' }
  }

  switch (outcome.kind) {
    case 'CONFIRMATION_PENDING':
    case 'TRANSACTION_NOT_YET_READABLE':
      // Not settled, or settled and not yet readable. Both are PENDING; neither is a
      // failure and neither is a licence to do anything. Nothing is recorded, because the
      // durable record already says `SIGNATURE_OBSERVED`, which is exactly what is known.
      return { ok: false, code: 'SUBMITTED_OUTCOME_PENDING' }

    case 'READ_UNAVAILABLE':
      // Unreadable is UNKNOWN, and unknown is never absence, never failure and never
      // success. It is recorded as exactly that.
      return recordAndBlock('READ_UNAVAILABLE', [])

    case 'LANDED_MESSAGE_MISMATCH':
      // Something landed under this signature that is NOT the approved message. It is
      // never resolved as this attempt's success — attributing another transaction's
      // outcome would be the worst kind of wrong.
      return settleLandedFailure('LANDED_MESSAGE_MISMATCH', ['LANDED_MESSAGE_NOT_EXACT'])

    case 'LANDED_TRANSACTION_FAILED':
      return settleLandedFailure('LANDED_TRANSACTION_FAILED', [])

    case 'CONFIRMED_MESSAGE_META_MATCHING':
    case 'FINALIZED_MESSAGE_META_MATCHING':
      break
  }

  // The approved message landed and its metadata reports no error. What the ACCOUNTS say
  // is a separate question, and it is asked ONCE, coherently, at the accepted floor.
  let plannedCampaign: PublicKey
  let plannedOutputMint: PublicKey
  let plannedFeeVault: PublicKey
  try {
    plannedCampaign = new PublicKey(expectation.campaign)
    plannedOutputMint = new PublicKey(expectation.outputMint)
    plannedFeeVault = new PublicKey(expectation.protocolFeeVault)
  } catch {
    // A planned identity that is not a key cannot be read about, and is not a state a
    // machine may close.
    return recordAndBlock('SUPPORT_ONLY', [])
  }
  const read = await readRedaxTeamAdminS1CoherentStateWithContext(
    input.connection,
    input.programId,
    {
      campaign: plannedCampaign,
      outputMint: plannedOutputMint,
      outputMintDecimals: expectation.outputMintDecimals,
      protocolFeeVault: plannedFeeVault,
    },
    // ORDINARY POST-SEND EFFECT ASSESSMENT, and therefore `'confirmed'`. The strict
    // finalized no-land proof is the ONLY caller that reads at `'finalized'`, and it is
    // in the reconciliation entrypoint, not here. The SUCCESS terminal still requires the
    // MESSAGE to be finalized (below); the assessor compares only identities and frozen
    // terms, which later confirmed blocks cannot legitimately change.
    { commitment: 'confirmed', minContextSlot: input.readFloor },
  )
  if (!read.ok) {
    return recordAndBlock('READ_UNAVAILABLE', [])
  }

  const post = assessRedaxTeamAdminS1PostState(
    read.observation,
    // THE MESSAGE IS PROVEN EXACT — that is precisely what a `*_MESSAGE_META_MATCHING`
    // outcome means, established byte for byte by the action-agnostic outcome module
    // against the commitment this attempt froze before anything was signed.
    //
    // `accountKeys` IS DELIBERATELY EMPTY, and it is not a shortcut. The outcome module
    // does not return the landed account keys, so this route cannot name the payer, and
    // inventing one would be fabricating provenance. An empty list makes `payer` null,
    // which makes the judgment carry `EFFECT_ORIGIN_NOT_PROVEN` — the exact accepted
    // disposition: the planned state is there, and this attempt has NOT been proven to
    // have created it. Reporting the message as `UNAVAILABLE` instead would be the
    // opposite of true, since it demonstrably WAS read.
    { kind: 'EXACT', accountKeys: [] },
    expectation,
  )

  switch (post.verdict) {
    case 'MATCHING_COMPLETE_STATE': {
      if (!(await record('MATCHING_COMPLETE_STATE', post.issueCodes))) {
        return { ok: false, code: 'TERMINAL_RECORD_UNVERIFIED' }
      }
      if (outcome.kind !== 'FINALIZED_MESSAGE_META_MATCHING') {
        // Recorded, and deliberately NOT resolved — see the note above this function. It
        // is PENDING FINALITY rather than a support case: the same explicit status check
        // resolves it once the exact message is finalized, and nothing is sent again.
        return { ok: false, code: 'SUBMITTED_OUTCOME_PENDING' }
      }
      const cursor = readCursor()
      const resolved = await applyAndVerify(
        {
          namespace,
          expectedAttemptNonce: cursor.attemptNonce,
          expectedRevision: cursor.revision,
          transition: { type: 'RESOLVE_MATCHING_COMPLETE_STATE' },
        },
        {
          lifecycle: 'TOMBSTONE',
          observation: 'MATCHING_COMPLETE_STATE',
          resolution: 'RESOLVED_MATCHING_COMPLETE_STATE',
          knownSignature: localKnownSignature,
          issueCodes: post.issueCodes,
        },
      )
      return resolved
        ? { ok: true, code: 'SUBMITTED_MATCHING_COMPLETE_STATE' }
        : { ok: false, code: 'TERMINAL_RECORD_UNVERIFIED' }
    }

    case 'LANDED_MESSAGE_MISMATCH':
      return settleLandedFailure('LANDED_MESSAGE_MISMATCH', post.issueCodes)

    case 'READ_UNAVAILABLE':
      return recordAndBlock('READ_UNAVAILABLE', post.issueCodes)

    case 'ORPHAN_RESIDUE':
      return recordAndBlock('ORPHAN_RESIDUE', post.issueCodes)

    case 'PROTOCOL_CONFIG_CHANGED':
      return recordAndBlock('PROTOCOL_CONFIG_CHANGED', post.issueCodes)

    case 'CAMPAIGN_MISMATCH':
    case 'NO_STATE':
      // A Campaign at the planned address that disagrees with the plan, or an exact
      // approved message that landed while NOTHING exists. Neither has a dedicated
      // observation, and neither is a state a machine may close: they are exactly the
      // shape support exists for.
      return recordAndBlock('SUPPORT_ONLY', post.issueCodes)
  }
}

/**
 * MOUNTED IN THE PRODUCT, AND STILL INERT ITSELF. `app/src/App.tsx` mounts it in the
 * `DEVNET_TX_ENABLED` branch only, inside `RedaxWalletProvider`, with the resolved
 * approved-Team carrier. It renders exactly its children and nothing else — no shell,
 * no panel, no copy, no control — so mounting it still makes nothing appear; the visible
 * Campaign Create surface is a separate panel App passes down. It runs NO effect, and
 * its TWO operations run only on an explicit call: nothing happens on mount, on connect,
 * on a timer or on a storage event. The mount makes `App.tsx` a PROVIDER OWNER; it does
 * not make it a consumer, and exactly one panel is one.
 */
export function RedaxTeamAdminActionsProvider({
  approvedTeamWallet = null,
  children,
}: {
  /**
   * The trusted approved-Team public key, as base58, or `null`.
   */
  readonly approvedTeamWallet?: string | null
  readonly children?: ReactNode
}): ReactNode {
  // The PRIVATE attempt lives in a ref, never in state. A ref is the honest home for a
  // value that holds memory-only custody: state is snapshotted, batched and replayed by
  // the renderer, and none of those is a thing to do with a secret key.
  const attemptRef = useRef<RedaxTeamAdminAttemptV1>(initialRedaxTeamAdminAttempt())
  // Only the PROJECTION is rendered. It has no custody member at all.
  const [attempt, setAttempt] = useState<RedaxTeamAdminAttemptProjectionV1>(() =>
    publicAttemptProjection(attemptRef.current),
  )
  // The one private wallet surface this root may use. It is action-named, sign-only, and
  // has no send member of any kind.
  const broker = useRedaxTeamAdminS1SignOnlyBroker()

  const publish = useCallback((next: RedaxTeamAdminAttemptV1): RedaxTeamAdminAttemptProjectionV1 => {
    attemptRef.current = next
    const projection = publicAttemptProjection(next)
    setAttempt(projection)
    return projection
  }, [])

  const advanceAttempt = useCallback(
    (event: RedaxTeamAdminAttemptEvent): RedaxTeamAdminAttemptOutcome => {
      const result = transitionRedaxTeamAdminAttempt(attemptRef.current, event)
      if (!result.ok) {
        // A refused event never advances the attempt, so there is nothing to publish.
        return { ok: false, code: result.code, attempt: publicAttemptProjection(attemptRef.current) }
      }
      return { ok: true, code: null, attempt: publish(result.attempt) }
    },
    [publish],
  )

  // ===========================================================================
  // THE ONE S1 SIGNING CHOREOGRAPHY
  // ===========================================================================
  //
  // The order below is the security argument, not a style. Every guard runs before the
  // thing it protects can exist: no entropy before Phase A, no plan before custody, no
  // message before the plan, no durable record before the message, no signature before
  // the record is read back, no wallet request before Phase B, no invocation marker
  // before the artifact has been verified and the chain re-asserted, no retained
  // signature before the marker is read back, and NO BROADCAST before both are.
  //
  // AND WHAT COMES AFTER IT CAN ONLY OBSERVE. Past the raw send there is exactly one
  // one-shot observation and, where accepted authority determines a terminal, exactly one
  // durable resolution. There is no retry, no resend, no rebuild, no second prompt and no
  // fallback anywhere below the send — every one of those would make an already ambiguous
  // attempt more ambiguous, and none of them is evidence that nothing was sent.
  const submitS1 = useCallback(
    async (
      request: RedaxTeamAdminS1SetupRequest,
    ): Promise<RedaxTeamAdminS1SubmitResult> => {
      let promptCount: 0 | 1 = 0
      let broadcastCount: 0 | 1 = 0
      let planFingerprint: string | null = null
      let outputMintAddress: string | null = null
      let campaignAddress: string | null = null
      // Set only after the matching-complete tombstone that names it was read back.
      let resolvedSignature: string | null = null

      /** Drop custody and every transient, then answer. The ONLY way out of this function. */
      const finish = (
        ok: boolean,
        code: RedaxTeamAdminS1SubmitCode,
        reasonCode: string,
      ): RedaxTeamAdminS1SubmitResult => {
        const released = transitionRedaxTeamAdminAttempt(attemptRef.current, {
          kind: 'release_attempt',
          reasonCode,
        })
        // A release is refused only from `no_attempt` / `attempt_released`, where there
        // was never any custody to drop — so a refusal here is not a leak, it is the
        // machine saying the slot was already empty.
        const projection = released.ok
          ? publish(released.attempt)
          : publicAttemptProjection(attemptRef.current)
        return {
          ok,
          code,
          rawBroadcastCount: broadcastCount,
          walletPromptCount: promptCount,
          planFingerprint,
          outputMint: outputMintAddress,
          campaign: campaignAddress,
          resolvedSignature: ok && code === 'SUBMITTED_MATCHING_COMPLETE_STATE' ? resolvedSignature : null,
          attempt: projection,
        }
      }

      // 1. The bounded devnet runtime configuration. No env is read here — the one
      //    controlled accessor owns that, and an unusable config is a typed refusal.
      const runtimeConfig = resolveRedaxRuntimeActionConfig()
      if (!runtimeConfig.ok) {
        return finish(false, 'RUNTIME_CONFIG_UNAVAILABLE', 'CHAIN_GUARD_REFUSAL')
      }

      // 2/3. The named broker, and the three preconditions that cost nothing to check.
      //      A wallet that cannot sign on its own is refused with NOTHING behind it: no
      //      chain read, no entropy, no attempt slot, no journal record and — above all —
      //      no wallet prompt. There is deliberately nothing to fall back to.
      if (!broker.isConnected) {
        return finish(false, 'WALLET_NOT_CONNECTED', 'SIGN_ONLY_REFUSAL')
      }
      if (!broker.canSignOnly) {
        return finish(false, 'WALLET_SIGN_ONLY_UNAVAILABLE', 'SIGN_ONLY_REFUSAL')
      }
      if (approvedTeamWallet === null) {
        return finish(false, 'APPROVED_TEAM_IDENTITY_UNAVAILABLE', 'CHAIN_GUARD_REFUSAL')
      }
      let approvedTeam: PublicKey
      let programId: PublicKey
      try {
        approvedTeam = new PublicKey(approvedTeamWallet)
        programId = new PublicKey(runtimeConfig.programId)
      } catch {
        return finish(false, 'APPROVED_TEAM_IDENTITY_UNAVAILABLE', 'CHAIN_GUARD_REFUSAL')
      }

      // 4. Exactly one attempt-scoped Connection. Constructed directly, here, and used
      //    by every read this attempt performs — the guard consumes it and never makes
      //    one of its own.
      const connection = new Connection(runtimeConfig.rpcUrl, REDAX_TEAM_ADMIN_ACTION_COMMITMENT)

      // 5. The broker's IMMEDIATELY current key — not a snapshot compared to itself.
      const connectedWallet = readLiveTeamWallet(broker)
      if (connectedWallet === null) {
        return finish(false, 'WALLET_NOT_CONNECTED', 'SIGN_ONLY_REFUSAL')
      }

      const guardRuntime: RedaxTeamAdminChainGuardRuntime = {
        mode: runtimeConfig.mode,
        cluster: runtimeConfig.cluster,
        programId,
      }

      const phaseA = await checkRedaxTeamAdminChainGuardPhaseA({
        connection,
        runtime: guardRuntime,
        connectedWallet,
        approvedTeamWallet: approvedTeam,
        requestedTopology: {
          payer: approvedTeam,
          outputGovernance: approvedTeam,
          campaignAdmin: approvedTeam,
        },
      })
      if (!phaseA.ok) {
        return finish(false, 'CHAIN_GUARD_REFUSED', 'CHAIN_GUARD_REFUSAL')
      }

      // The S1 journal namespace depends on the CLUSTER, the PROGRAM and the TEAM WALLET
      // and on nothing else — no campaign, no mint, no plan and no salt — so it is fully
      // determined here, before any entropy exists. That is what makes the early read below
      // possible at all.
      const namespace: RedaxTeamAdminRecoveryNamespace = {
        cluster: REDAX_TEAM_ADMIN_JOURNAL_CLUSTER,
        program: programId.toBase58(),
        teamWallet: approvedTeam.toBase58(),
      }

      // 6b. THE EARLY READ-ONLY ACTIVE CHECK — AN EXISTING UNRESOLVED ATTEMPT OUTRANKS
      //     EVERYTHING BELOW IT.
      //
      //     An operator holding an unresolved attempt must be told THAT, and must be told it
      //     even when the wallet also happens to be short of SOL. Reporting an insufficiency
      //     first would answer the wrong question: funding the wallet would not unblock the
      //     attempt, and the durable record is the fact that actually decides what may
      //     happen next. So this runs BEFORE the SOL observation rather than after it.
      //
      //     IT IS STRICTLY READ-ONLY. It writes nothing, transitions nothing, deletes
      //     nothing, replaces nothing, prompts no wallet and touches no chain. The durable
      //     BEGIN — and its compare-and-set — stays exactly where it was, later, after the
      //     plan and the message commitment; a concurrent session that changes the slot
      //     between this read and that write is still caught there, by the Web-Lock and
      //     compare-and-set semantics this read deliberately does not weaken.
      const earlyJournal = await readRedaxTeamAdminRecoveryJournal(namespace)
      if (!earlyJournal.ok) {
        return finish(false, 'JOURNAL_UNAVAILABLE', 'CHAIN_GUARD_REFUSAL')
      }
      if (earlyJournal.kind === 'ACTIVE') {
        return finish(false, 'ATTEMPT_BLOCKED', 'CHAIN_GUARD_REFUSAL')
      }
      // A REPLACEABLE TOMBSTONE'S EXACT IDENTITY, captured here and used by the later
      // `begin`. `begin` requires it to replace a tombstone, and capturing it now is what
      // lets the OLD second advisory pre-begin read be removed rather than kept as a
      // duplicate: one read, one captured identity, one durable admission.
      const earlyReplaces: RedaxTeamAdminRecoveryAttemptIdentity | null =
        earlyJournal.kind === 'TOMBSTONE'
          ? {
              attemptNonce: earlyJournal.record.attemptNonce,
              revision: earlyJournal.record.revision,
            }
          : null

      // 6c. C2 — THE ATTEMPT-AUTHORITATIVE SOL PREFLIGHT, on THIS attempt's Connection and
      //     at THIS attempt's accepted Phase-A floor.
      //
      //     IT RUNS BEFORE ANY ENTROPY. Nothing below this point has happened yet: no
      //     keypair, no custody, no salt, no plan, no transaction, no journal write, no
      //     wallet prompt, no signature, no marker and no send. A refusal here therefore
      //     costs the attempt nothing at all and leaves nothing to resolve — which is
      //     precisely why the check is placed here rather than nearer the send.
      //
      //     It calls the SAME private observer the passive C1 member calls, so the number an
      //     operator was shown and the number this attempt refuses against are one formula.
      const solPreflight = await observeRedaxTeamAdminS1SolPreflight(
        connection,
        approvedTeam,
        phaseA.contextSlot,
      )
      if (solPreflight.result === 'READ_UNAVAILABLE') {
        // FAIL-CLOSED, and deliberately NOT the insufficiency code: an unknown balance is
        // not evidence of a small one.
        //
        // TWO CODES, ONE FOR EACH KIND OF UNKNOWN. An unreadable rent figure keeps the
        // union's existing `RENT_READ_UNAVAILABLE`, which is what this route has always
        // said when a rent read failed; everything else — an unreadable or malformed
        // balance, an invalid or stale context, an overflow — is the value-free
        // `CHAIN_GUARD_REFUSED`. Neither names a term, a threshold or an amount.
        return finish(
          false,
          await finalizeRedaxTeamAdminS1SolRefusal(
            namespace,
            solPreflight.cause === 'RENT_READ' ? 'RENT_READ_UNAVAILABLE' : 'CHAIN_GUARD_REFUSED',
            readRedaxTeamAdminRecoveryJournal,
          ),
          'CHAIN_GUARD_REFUSAL',
        )
      }
      if (solPreflight.result === 'INSUFFICIENT') {
        return finish(
          false,
          await finalizeRedaxTeamAdminS1SolRefusal(
            namespace,
            'PAYER_SOL_INSUFFICIENT',
            readRedaxTeamAdminRecoveryJournal,
          ),
          'CHAIN_GUARD_REFUSAL',
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
      //     A REFUSED BIND IS FATAL TO THE ATTEMPT. An unbound observation is not
      //     authoritative, so continuing on one would be continuing on a balance nothing
      //     later checked against — it fails closed, value-free.
      if (
        !bindRedaxTeamAdminSolPreflightContextFloor({
          snapshot: phaseA.snapshot,
          connection,
          balanceContextSlot: solPreflight.balanceContextSlot,
        })
      ) {
        return finish(
          false,
          await finalizeRedaxTeamAdminS1SolRefusal(
            namespace,
            'CHAIN_GUARD_REFUSED',
            readRedaxTeamAdminRecoveryJournal,
          ),
          'CHAIN_GUARD_REFUSAL',
        )
      }

      // THE MINT RENT THIS ATTEMPT WILL BUILD WITH — already read, exactly once, by the C2
      // observation above. The old duplicate post-entropy 82-byte read is REMOVED: two reads
      // meant the threshold could be computed from one value and the transaction built from
      // another, and one read makes that impossible rather than merely unlikely.
      const mintRentLamports = solPreflight.mintRentLamports

      // 7. THE ONE KEYPAIR. Generated exactly once, here, and nowhere else in app source.
      const outputMintKeypair = Keypair.generate()

      // ===================================================================
      // THE POST-CUSTODY EXCEPTION BOUNDARY
      // ===================================================================
      //
      // A keypair now exists. From this line until this function returns, an UNEXPECTED
      // exception — one no declared result union describes — must not escape, because an
      // escaping rejection would return a raw rejected Promise instead of the bounded
      // result AND leave the private attempt holding custody, which blocks every later
      // attempt while proving nothing about this one.
      //
      // It is a REGION, not a patch over the two SHA-256 awaits that prompted it. Every
      // await and every call between here and the last return is inside it, so work added
      // later inherits the guarantee instead of quietly falling outside it.
      //
      // There is no `finally`. Every ordinary path already leaves through `finish`, and a
      // `finally` would release a second time and overwrite the projection those paths
      // deliberately returned. The catch is the ONE additional exit, and it exits the same
      // way: through `finish`.
      try {

        // 8. Memory-only custody, in the private attempt. It is dropped by `finish` on
        //    every path out of this function, including the successful one.
        const materialized = materializeRedaxTeamAdminOutputMintCustody(
          attemptRef.current,
          outputMintKeypair,
        )
        if (!materialized.ok) {
          // An unresolved private attempt is already open. Refuse rather than overwrite:
          // two keys under one attempt would mean the plan, the signature and the durable
          // record could each be about a different mint.
          return finish(false, 'ATTEMPT_BLOCKED', 'CHAIN_GUARD_REFUSAL')
        }
        publish(materialized.attempt)
        outputMintAddress = outputMintKeypair.publicKey.toBase58()

        // 9. The fresh S1 salt, from the platform CSPRNG.
        const salt = drawSaltBytes()
        if (salt === null) {
          return finish(false, 'ENTROPY_UNAVAILABLE', 'CHAIN_GUARD_REFUSAL')
        }
        let saltHex: string
        try {
          saltHex = redaxSaltHexFromBytes(salt)
        } catch {
          return finish(false, 'ENTROPY_UNAVAILABLE', 'CHAIN_GUARD_REFUSAL')
        }

        // 10. FREEZE THE PLAN. The three signer roles are the approved Team wallet and
        //     nothing else; the fee authority is the FRESH one Phase A read, never a
        //     caller input; and the mint is the key just generated.
        const frozen = freezeRedaxCampaignPlan(
          {
            payer: approvedTeamWallet,
            outputGovernance: approvedTeamWallet,
            campaignAdmin: approvedTeamWallet,
            endTs: request.endTs,
            maxOutputSupply: request.maxOutputSupply,
            metadataName: request.metadataName,
            metadataSymbol: request.metadataSymbol,
            metadataUri: request.metadataUri,
            lifecycleIntent: request.lifecycleIntent,
            tokenConfigs: request.tokenConfigs,
          },
          {
            programId: runtimeConfig.programId,
            saltHex,
            outputMintPublicKey: outputMintAddress,
            protocolFeeAuthority: phaseA.protocolFeeAuthority.toBase58(),
          },
        )
        if (!frozen.ok) {
          return finish(false, 'PLAN_INVALID', 'CHAIN_GUARD_REFUSAL')
        }
        const plan = frozen.plan
        campaignAddress = plan.campaign
        planFingerprint = await computeRedaxCampaignPlanFingerprint(plan)
        const planFrozen = transitionRedaxTeamAdminAttempt(attemptRef.current, {
          kind: 'freeze_plan',
          planFingerprint,
        })
        if (!planFrozen.ok) {
          return finish(false, 'ATTEMPT_STATE_INVALID', 'CHAIN_GUARD_REFUSAL')
        }
        publish(planFrozen.attempt)

        // 11. THE MINT RENT IS ALREADY KNOWN. It was read ONCE by the C2 observation above,
        //     validated there as a strictly positive safe integer, and used there to compute
        //     the very threshold this attempt was admitted against. Reading it again here
        //     would be a second RPC round trip whose answer could differ from the one the
        //     admission was based on — so the duplicate read is gone and `mintRentLamports`
        //     carries that single observation forward.
        //
        //     `RENT_READ_UNAVAILABLE` is still reachable: a rent read that throws or returns
        //     zero, a negative, a fractional or a non-safe integer is refused at C2 as an
        //     unavailable observation. What is no longer possible is the threshold and the
        //     transaction disagreeing about the same number.

        // 12. The four S1 instructions, from their one pure assembler.
        const setup = await buildRedaxCampaignSetupPlanS1({ plan, mintRentLamports })
        if (!setup.ok) {
          return finish(false, 'BUILD_FAILED', 'CHAIN_GUARD_REFUSAL')
        }
        if (setup.setup.fingerprint !== planFingerprint) {
          // The assembler recomputes the fingerprint from the same frozen plan. A
          // disagreement means the plan moved between the two, which is not a state this
          // attempt may sign from.
          return finish(false, 'PLAN_INVALID', 'CHAIN_GUARD_REFUSAL')
        }

        // 13/14. EXACTLY ONE legacy Transaction, carrying exactly the four instructions in
        //        the assembler's own order. No ComputeBudget instruction: S1 does not have
        //        one, and adding one here would change the message the program measured.
        const transaction = new Transaction().add(...setup.setup.instructions)

        // 15. The fee payer is the approved Team wallet, which is also signer slot 0.
        transaction.feePayer = approvedTeam

        // 16. The GUARDED late blockhash, at a context that may not regress below Phase A.
        const blockhash = await fetchRedaxTeamAdminAttemptBlockhash({
          connection,
          snapshot: phaseA.snapshot,
        })
        if (!blockhash.ok) {
          return finish(false, 'CHAIN_GUARD_REFUSED', 'CHAIN_GUARD_REFUSAL')
        }

        // 17. Exact blockhash.
        transaction.recentBlockhash = blockhash.blockhash

        // 18. Serialize the legacy message EXACTLY ONCE, BEFORE any signature exists — so
        //     the committed bytes are the unsigned message every later comparison is
        //     against. `serializeMessage` hands back a view, and the frozen original must
        //     be memory nothing else can write through, so it is copied. This is the ONLY
        //     message serialization the whole attempt performs, and nothing re-serializes
        //     anything after the wallet returns.
        let serializedMessage: Uint8Array
        try {
          serializedMessage = transaction.serializeMessage()
        } catch {
          return finish(false, 'MESSAGE_COMMITMENT_UNAVAILABLE', 'CHAIN_GUARD_REFUSAL')
        }
        const intendedMessageBytes = Uint8Array.from(serializedMessage)

        // 19. The exact commitment — byte length and SHA-256 — taken by the same module
        //     that will later check it, so the two cannot drift.
        const committed = await commitRedaxTeamAdminIntendedLegacyMessage(intendedMessageBytes)
        if (!committed.ok) {
          return finish(false, 'MESSAGE_COMMITMENT_UNAVAILABLE', 'CHAIN_GUARD_REFUSAL')
        }

        // 20. The private attempt records exactly that commitment.
        const messageCommitted = transitionRedaxTeamAdminAttempt(attemptRef.current, {
          kind: 'commit_intended_message',
          commitment: committed.commitment,
        })
        if (!messageCommitted.ok) {
          return finish(false, 'ATTEMPT_STATE_INVALID', 'CHAIN_GUARD_REFUSAL')
        }
        publish(messageCommitted.attempt)

        // 21. OPEN THE DURABLE SLOT, from the identity the EARLY read already captured.
        //
        //     THE OLD SECOND ADVISORY READ IS GONE. It existed only to recover the exact
        //     identity of a replaceable tombstone, and step 6b above already read the slot
        //     and captured exactly that as `earlyReplaces` — so re-reading here would be a
        //     duplicate whose answer could differ from the one the attempt was admitted
        //     against, for no gain.
        //
        //     NOTHING IS WEAKENED BY REMOVING IT. That read was ADVISORY and never the
        //     protection: `begin` itself is compare-and-set under the journal's Web Lock,
        //     and it refuses `ACTIVE_ATTEMPT_EXISTS` and `TOMBSTONE_NOT_REPLACEABLE` on its
        //     own. A concurrent session that opened or advanced the slot after step 6b is
        //     therefore still caught — by the write, which is the only place it could ever
        //     have been caught safely.
        const replaces = earlyReplaces
        const begun = await beginRedaxTeamAdminRecoveryAttempt({
          namespace,
          planFingerprint,
          // ONLY approved public facts. There is no keypair, no signature, no wire, no
          // endpoint and no error here, and the record type has no field for one.
          plan: {
            campaign: plan.campaign,
            outputMint: plan.outputMint,
            protocolFeeVault: plan.protocolFeeVault,
            outputGovernance: plan.outputGovernance,
            campaignAdmin: plan.campaignAdmin,
            saltHex: plan.saltHex,
            endTs: plan.endTs,
            maxOutputSupply: plan.maxOutputSupply,
          },
          // THE FROZEN POST-STATE EXPECTATION, durable and read back BEFORE anything is
          // signed — the fee authority Phase A froze this plan against. It is what lets a
          // later explicit status check prove a late-finalized success against the plan
          // instead of against the very read it is judging.
          frozenExpectations: { protocolFeeAuthority: plan.protocolFeeAuthority },
          blockhashValidity: {
            preflightContextSlot: Math.max(phaseA.contextSlot, blockhash.blockhashContextSlot),
            lastValidBlockHeight: blockhash.lastValidBlockHeight,
          },
          intendedMessage: committed.commitment,
          replaces,
        })
        if (!begun.ok) {
          return finish(
            false,
            begun.code === 'ACTIVE_ATTEMPT_EXISTS' || begun.code === 'TOMBSTONE_NOT_REPLACEABLE'
              ? 'ATTEMPT_BLOCKED'
              : 'JOURNAL_UNAVAILABLE',
            'CHAIN_GUARD_REFUSAL',
          )
        }
        // THE COMPARE-AND-SET CURSOR, and it is a `let` on purpose. The route now writes
        // a CHAIN of durable transitions rather than exactly one, and every link must
        // present the revision the previous link produced. Keeping the cursor here and
        // letting `applyAndVerify` advance it — from the record it just READ BACK, never
        // from the one the write returned — means no call site can pass a stale revision,
        // because no call site owns one.
        let cursor = { attemptNonce: begun.record.attemptNonce, revision: begun.record.revision }
        const identityBound = transitionRedaxTeamAdminAttempt(attemptRef.current, {
          kind: 'bind_attempt_identity',
          attemptNonce: cursor.attemptNonce,
        })
        if (!identityBound.ok) {
          return finish(false, 'ATTEMPT_STATE_INVALID', 'CHAIN_GUARD_REFUSAL')
        }
        publish(identityBound.attempt)

        /**
         * Write one durable transition and READ IT BACK. A write nobody verified is not one.
         *
         * THE CALLER SUPPLIES THE COMPLETE EXPECTED TUPLE. The earlier version hard-coded
         * `knownSignature === null` and `issueCodes.length === 0`, which was correct for
         * the two pre-raw-send terminals and correct for nothing else: it could not have
         * verified the retained signature, the support-only record or the finalized
         * no-land terminal, all three of which carry a signature on purpose. Hard-coding
         * an expectation that happens to hold for today's call sites is exactly how a
         * later call site silently stops being verified at all.
         *
         * On success it ADVANCES the cursor from the record it read back, so the next
         * link in the chain compares and sets against durable bytes rather than against a
         * return value. There is NO RETRY inside here and no silent rewrite: one write,
         * one read, one verdict.
         */
        const applyAndVerify = async (
          input: RedaxTeamAdminRecoveryTransitionInput,
          expect: RedaxTeamAdminExpectedRecordV1,
        ): Promise<boolean> => {
          const written = await transitionRedaxTeamAdminRecoveryAttempt(input)
          if (!written.ok) {
            return false
          }
          const readBack = await readRedaxTeamAdminRecoveryJournal(input.namespace)
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
            // AN EXACT SET, not an exact sequence. The journal emits issue codes in ITS
            // own canonical order, which is not the order any caller assembled them in,
            // and both sides are duplicate-free by construction — so equal length plus
            // containment IS exact equality here, and comparing by index would fail on a
            // correct record purely because two codes were listed the other way round.
            record.issueCodes.length === expect.issueCodes.length &&
            expect.issueCodes.every((code) => record.issueCodes.includes(code))
          if (!matches) {
            return false
          }
          cursor = { attemptNonce: record.attemptNonce, revision: record.revision }
          return true
        }

        /**
         * THE PRE-RAW-SEND REFUSAL TERMINAL, and ONLY where it is truthful: the attempt
         * failed or was refused BEFORE the point of no return.
         *
         * EVERY CALL SITE BELOW IS STRICTLY BEFORE THE INVOCATION MARKER, and that is what
         * makes it honest. The transition itself would refuse otherwise — it is origin-only
         * and demands `PRE_INVOCATION` with no marker written — so this is not a rule that
         * could be broken quietly here; but it is also the reason no path after the send
         * calls it, and no path after the send does.
         *
         * If the terminal write or its read-back fails, the record is deliberately left
         * UNRESOLVED. An unresolved `PRE_INVOCATION` record is still literally true — the
         * point of no return was not crossed — and it blocks a new attempt by construction,
         * which is the conservative failure rather than the dangerous one.
         */
        const resolveRefusal = async (): Promise<void> => {
          await applyAndVerify(
            {
              namespace,
              expectedAttemptNonce: cursor.attemptNonce,
              expectedRevision: cursor.revision,
              transition: { type: 'RESOLVE_PRE_INVOCATION_REFUSAL' },
            },
            {
              lifecycle: 'TOMBSTONE',
              observation: 'PREFLIGHT_REFUSED',
              resolution: 'PRE_INVOCATION_REFUSAL',
              knownSignature: null,
              issueCodes: [],
            },
          )
        }

        // 22. READ-BACK / VERIFY the exact opened record BEFORE anything is signed. If the
        //     durable slot is not what it says it is, no wallet is prompted and nothing is
        //     signed — and there is nothing to resolve, because the record is the thing in
        //     doubt.
        const openedReadBack = await readRedaxTeamAdminRecoveryJournal(namespace)
        if (
          !openedReadBack.ok ||
          openedReadBack.kind !== 'ACTIVE' ||
          openedReadBack.record.attemptNonce !== cursor.attemptNonce ||
          openedReadBack.record.revision !== cursor.revision ||
          openedReadBack.record.lifecycle !== 'PRE_INVOCATION' ||
          openedReadBack.record.planFingerprint !== planFingerprint ||
          openedReadBack.record.frozenExpectations === null ||
          openedReadBack.record.frozenExpectations.protocolFeeAuthority !==
            plan.protocolFeeAuthority ||
          openedReadBack.record.intendedMessage.sha256Hex !== committed.commitment.sha256Hex ||
          openedReadBack.record.intendedMessage.byteLength !== committed.commitment.byteLength
        ) {
          return finish(false, 'JOURNAL_UNAVAILABLE', 'CHAIN_GUARD_REFUSAL')
        }

        const planIdentity: RedaxTeamAdminFrozenPlanIdentity = {
          planFingerprint,
          payer: approvedTeam,
          outputGovernance: approvedTeam,
          campaignAdmin: approvedTeam,
          outputMint: outputMintKeypair.publicKey,
          campaign: new PublicKey(plan.campaign),
          protocolConfig: new PublicKey(plan.protocolConfig),
          protocolFeeVault: new PublicKey(plan.protocolFeeVault),
          saltHex: plan.saltHex,
        }

        // 23. A fresh broker key read, immediately before Phase B.
        const walletBeforeSign = readLiveTeamWallet(broker)
        if (walletBeforeSign === null) {
          await resolveRefusal()
          return finish(false, 'WALLET_NOT_CONNECTED', 'SIGN_ONLY_REFUSAL')
        }

        // 24. PHASE B — every mutable fact re-read and re-decided, immediately before the
        //     partial signature and the one wallet request.
        const phaseB = await checkRedaxTeamAdminChainGuardPhaseB({
          connection,
          snapshot: phaseA.snapshot,
          runtime: guardRuntime,
          connectedWallet: walletBeforeSign,
          plan: planIdentity,
          outputMintCustodyAddress: outputMintAddress,
          blockhash: blockhash.blockhash,
          blockhashContextSlot: blockhash.blockhashContextSlot,
        })
        if (!phaseB.ok) {
          await resolveRefusal()
          return finish(false, 'CHAIN_GUARD_REFUSED', 'CHAIN_GUARD_REFUSAL')
        }

        // 25. THE ONE PARTIAL SIGNATURE. Exactly one call, on the exact keypair this
        //     attempt holds custody of, read back from the private attempt rather than from
        //     a local variable — so what signs is provably what the attempt is about. There
        //     is no `addSignature`, no signer array and no second `partialSign` anywhere in
        //     app source.
        const custodyKeypair = readRedaxTeamAdminOutputMintCustodyKeypair(attemptRef.current)
        if (custodyKeypair === null) {
          await resolveRefusal()
          return finish(false, 'ATTEMPT_STATE_INVALID', 'CHAIN_GUARD_REFUSAL')
        }
        try {
          transaction.partialSign(custodyKeypair)
        } catch {
          await resolveRefusal()
          return finish(false, 'BUILD_FAILED', 'CHAIN_GUARD_REFUSAL')
        }

        // 26. THE ONE SIGN-ONLY REQUEST. The wallet receives a transaction that ALREADY
        //     carries the output-mint signature, and it is asked exactly once. This is not
        //     a broadcast and there is nothing behind it that could become one: the broker
        //     has no send member, and there is no retry, no second prompt and no fallback.
        promptCount = 1
        let signedWire: Uint8Array
        try {
          signedWire = await broker.signTeamAdminS1LegacyTransactionBytes(transaction)
        } catch {
          // The thrown value is NOT inspected and never leaves: nothing was broadcast
          // either way, so no wallet error text could add anything true.
          await resolveRefusal()
          return finish(false, 'WALLET_SIGN_ONLY_REFUSED', 'SIGN_ONLY_REFUSAL')
        }

        // 27/28. The fixed two-signature verification, against the EXACT committed bytes.
        //        Nothing is serialized, recompiled or normalized here.
        const verified = await verifyRedaxTeamAdminS1SignedWire({
          wire: signedWire,
          teamWallet: approvedTeam.toBytes(),
          outputMint: outputMintKeypair.publicKey.toBytes(),
          intendedMessage: intendedMessageBytes,
          intendedMessageByteLength: committed.commitment.byteLength,
          intendedMessageSha256Hex: committed.commitment.sha256Hex,
        })
        // 29. Any verification failure: ZERO broadcast, the refusal terminal, and the
        //     artifact is destroyed with everything else on the way out.
        if (!verified.ok) {
          await resolveRefusal()
          return finish(false, 'SIGNED_ARTIFACT_REJECTED', 'SIGN_ONLY_REFUSAL')
        }

        // 30. THE POST-WALLET REASSERTION. A verified artifact proves what the wallet did;
        //     it proves nothing about what the chain did while the prompt was open.
        const walletAfterSign = readLiveTeamWallet(broker)
        const postWallet =
          walletAfterSign === null
            ? null
            : await reassertRedaxTeamAdminChainGuardAfterWallet({
                connection,
                snapshot: phaseA.snapshot,
                runtime: guardRuntime,
                connectedWallet: walletAfterSign,
                plan: planIdentity,
                outputMintCustodyAddress: outputMintAddress,
                blockhash: blockhash.blockhash,
                blockhashContextSlot: blockhash.blockhashContextSlot,
              })
        if (postWallet === null || !postWallet.ok) {
          // Zero broadcast, no second prompt, no retry. The refusal terminal is the
          // truthful one: the guard rejected this attempt before it could complete.
          await resolveRefusal()
          return finish(false, 'CHAIN_GUARD_REFUSED', 'CHAIN_GUARD_REFUSAL')
        }

        // 31. THE TRANSACTION'S IDENTITY, derived LOCALLY from signature slot 0 of the
        //     VERIFIED bytes — the Team wallet, which is the fee payer, which is the
        //     transaction's identity. It exists before anything is sent, so it is exact
        //     and is independent of whatever the node does or does not return.
        //
        //     It is retained through the action-agnostic primitive rather than used as a
        //     bare string, which makes the retention step statically visible here instead
        //     of being an easily forgotten convention. A locally underivable signature is
        //     a verification failure, refused BEFORE the point of no return.
        const localRetention = retainRedaxKnownSignature(verified.knownSignatureBase58)
        if (!localRetention.ok) {
          await resolveRefusal()
          return finish(false, 'SIGNED_ARTIFACT_REJECTED', 'SIGN_ONLY_REFUSAL')
        }
        const localKnownSignature: RedaxKnownSignature = localRetention.knownSignature

        // 32. THE DURABLE "WE ARE ABOUT TO HAND THIS TO THE TRANSPORT" MARKER, written
        //     and READ BACK. A write that succeeded and a write that can be read back are
        //     different facts, and only the second one survives a tab close.
        const marked = await applyAndVerify(
          {
            namespace,
            expectedAttemptNonce: cursor.attemptNonce,
            expectedRevision: cursor.revision,
            transition: { type: 'MARK_INVOCATION_STARTED' },
          },
          {
            lifecycle: 'POST_INVOCATION_SIGNATURE_UNKNOWN',
            observation: 'SUBMISSION_OUTCOME_UNKNOWN_WITHOUT_SIGNATURE',
            resolution: null,
            knownSignature: null,
            issueCodes: [],
          },
        )
        if (!marked) {
          // NO BROADCAST. The record is left unresolved, which is still literally true —
          // the point of no return was not crossed — and it blocks a new attempt by
          // construction. Deliberately the worse outcome for liveness, the correct one
          // for safety.
          return finish(false, 'INVOCATION_RECORD_UNVERIFIED', 'SIGN_ONLY_REFUSAL')
        }

        // 33. THE EXACT LOCAL SIGNATURE BECOMES DURABLE, and is read back, BEFORE the
        //     irreversible act. That ordering removes the dangerous window entirely: a
        //     failure at the boundary can no longer leave a landed transaction whose
        //     signature REDAX never recorded.
        const retained = await applyAndVerify(
          {
            namespace,
            expectedAttemptNonce: cursor.attemptNonce,
            expectedRevision: cursor.revision,
            transition: { type: 'RETAIN_KNOWN_SIGNATURE', knownSignature: localKnownSignature },
          },
          {
            lifecycle: 'KNOWN_SIGNATURE',
            observation: 'SIGNATURE_OBSERVED',
            resolution: null,
            knownSignature: localKnownSignature,
            issueCodes: [],
          },
        )
        if (!retained) {
          // NO BROADCAST, for the same reason as above and more sharply: the durable
          // record cannot yet NAME the transaction that would exist.
          return finish(false, 'INVOCATION_RECORD_UNVERIFIED', 'SIGN_ONLY_REFUSAL')
        }

        // 34. THE POINT OF NO RETURN — the exact verified bytes, ONCE, on the attempt's
        //     own Connection. `signedWire` is the SAME value the verifier accepted: there
        //     is no reconstruction, no recompilation, no reserialization, no
        //     normalization, no second signing and no second prompt between the two.
        //
        //     ALL FOUR OPTIONS ARE WRITTEN EXPLICITLY. No provider default, adapter
        //     default, library default or ambient configuration is authority for any of
        //     them, because a default is a property of a dependency version and this is a
        //     property of this route. `preflightCommitment` is the same `'confirmed'`
        //     every read on this attempt uses; `minContextSlot` is the guard's OWN
        //     `sendContextFloor`, which this file never reassembles; and `maxRetries` is
        //     `0`, which is what makes "exactly one broadcast" a property of the wire
        //     rather than only of the application call count.
        //
        //     Nothing is awaited between the read-verified retention above and this call.
        broadcastCount = 1
        // Initialized, because the catch below deliberately does NOT return: a throw
        // after invocation is not a failed-before-send and must fall through to the same
        // reconciliation an equal or unusable return does.
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
          // The thrown value is NOT bound, NOT inspected and NOT classified. A throw here
          // is not evidence that nothing was sent — the transaction may be on the wire, in
          // a leader's queue or already landed — so it is emphatically not a
          // failed-before-send, and nothing is sent again. The exact signature is already
          // known AND already durable, so reconciliation proceeds on that.
          broadcastThrew = true
        }

        // 35. A RETURNED SIGNATURE MUST *BE* THE SIGNATURE REDAX DERIVED AND RETAINED.
        //     No trim, no coercion, no normalization, no re-encoding, no alternate
        //     adoption. Equality makes the return corroboration and nothing more.
        if (!broadcastThrew) {
          const returned = retainRedaxKnownSignature(broadcast)
          if (returned.ok && returned.knownSignature !== localKnownSignature) {
            // USABLE BUT DIFFERENT. A node that returns a signature other than the one
            // slot 0 already fixes is not describing this transaction, and the correct
            // durable statement is that the situation needs a human.
            //
            // The conflicting value is never persisted, never logged, never adopted and
            // NEVER QUERIED — querying it would turn a value REDAX cannot explain into a
            // value REDAX acted on. It is not carried into the record below, into the
            // result, or into any chain read.
            const supported = await applyAndVerify(
              {
                namespace,
                expectedAttemptNonce: cursor.attemptNonce,
                expectedRevision: cursor.revision,
                transition: { type: 'RECORD_OBSERVATION', observation: 'SUPPORT_ONLY', issueCodes: [] },
              },
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
            return finish(
              false,
              supported ? 'SUBMITTED_OUTCOME_UNRESOLVED_SUPPORT' : 'TERMINAL_RECORD_UNVERIFIED',
              'SIGN_ONLY_REFUSAL',
            )
          }
          // An UNUSABLE return is not a second identity and is not evidence of no
          // broadcast or no landing: a value REDAX could not parse says nothing whatsoever
          // about what reached the network. The retained local signature stands, and
          // reconciliation continues on it exactly as it does after an equal return.
        }

        // 36. ONE explicit immediate observation of the exact retained local signature.
        //     ONE SHOT: no loop, no timer, no polling and no automatic recursion. A
        //     caller that wants another observation makes another explicit call.
        const outcome = await observeRedaxKnownSignatureOutcome(connection, {
          signature: localKnownSignature,
          intendedMessage: committed.commitment,
          minimumContextSlot: postWallet.sendContextFloor,
          lastValidBlockHeight: blockhash.lastValidBlockHeight,
        })

        // 37. Map that observation onto the ALREADY ACCEPTED Team/Admin journal and
        //     post-state semantics. Nothing new is decided here.
        const settled = await settleSubmittedOutcome({
          outcome,
          namespace,
          connection,
          programId,
          expectation: {
            campaign: plan.campaign,
            campaignAdmin: plan.campaignAdmin,
            outputGovernance: plan.outputGovernance,
            outputMint: plan.outputMint,
            outputMintDecimals: plan.outputMintDecimals,
            outputMintAuthority: plan.outputMintAuthority,
            protocolFeeVault: plan.protocolFeeVault,
            protocolFeeAuthority: plan.protocolFeeAuthority,
            saltHex: plan.saltHex,
            endTs: plan.endTs,
            maxOutputSupply: plan.maxOutputSupply,
          },
          localKnownSignature,
          readFloor: postWallet.sendContextFloor,
          applyAndVerify,
          readCursor: () => cursor,
        })
        if (settled.ok && settled.code === 'SUBMITTED_MATCHING_COMPLETE_STATE') {
          resolvedSignature = localKnownSignature
        }
        return finish(settled.ok, settled.code, 'SIGN_ONLY_REFUSAL')

      } catch {
        // The thrown value is NOT BOUND — there is no identifier here through which a
        // message, a cause, a stack or a wallet error could reach the result — and it is
        // neither inspected, rethrown, logged nor classified.
        //
        // What this path may and may not claim is the load-bearing part. It releases
        // custody and answers with ONE bounded code, chosen by the only fact that matters:
        // whether the raw send was invoked. Before it, the code says nothing was sent and
        // that is true. After it, the code says something MAY have been sent and says
        // nothing else — an unexpected exception is never evidence that a broadcast did
        // not happen, and a post-send path answering `PRE_BROADCAST_INTERNAL_FAILURE`
        // would be asserting exactly that.
        //
        // It does NOT resolve the durable record either way: an exception is not evidence
        // of any named observation, so the record is left UNRESOLVED — still literally
        // true, and still blocking a new attempt, which is the conservative failure.
        // Nothing here broadcasts, prompts the wallet again, retries, marks an invocation,
        // retains a signature or writes a terminal of any kind.
        return finish(
          false,
          broadcastCount === 1 ? 'POST_INVOCATION_INTERNAL_FAILURE' : 'PRE_BROADCAST_INTERNAL_FAILURE',
          'PRE_BROADCAST_INTERNAL_FAILURE',
        )
      }
    },
    [approvedTeamWallet, broker, publish],
  )

  // ===========================================================================
  // THE ONE RECONCILIATION-ONLY OPERATION
  // ===========================================================================
  //
  // IT IS NOT A SECOND SIGNING CHOREOGRAPHY, and the way to check that is not to read
  // this comment: `Keypair`, `Transaction`, `partialSign`, the broker and every send verb
  // are ABSENT from its body, and it takes no arguments through which a caller could
  // supply a signature, an address, a plan, a blockhash or a "definitively dead" boolean.
  //
  // It answers ONE question — what is known about the attempt that already exists? — and
  // the honest answer is very often "still unresolved, still blocking". It writes a
  // terminal in exactly three situations: a FINALIZED landed failure or message mismatch;
  // the full ten-member finalized no-land conjunction; and — for a v2 record only — a
  // FINALIZED exact message whose planned state matches the expectations frozen before the
  // broadcast, through the very settlement the submit choreography uses. (The earlier
  // "exactly two" reading predates the v2 record and is superseded on that point only.)
  // Everything else is recorded and left blocking.
  const reconcileS1 = useCallback(async (): Promise<RedaxTeamAdminS1ReconcileResult> => {
    // The record's public planned identities, once a record has been read. They travel on
    // every later answer as DISPLAY facts; only `openableCampaign` may offer navigation.
    let recordedCampaign: string | null = null
    let recordedOutputMint: string | null = null
    let recordedSignature: string | null = null
    const answer = (
      ok: boolean,
      code: RedaxTeamAdminS1ReconcileCode,
      openableCampaign: string | null = null,
    ): RedaxTeamAdminS1ReconcileResult => ({
      ok,
      code,
      rawBroadcastCount: 0,
      walletPromptCount: 0,
      signingRequestCount: 0,
      campaign: recordedCampaign,
      outputMint: recordedOutputMint,
      openableCampaign,
      resolvedSignature: openableCampaign === null ? null : recordedSignature,
    })

    try {
      // 1. Authority comes from the validated runtime and the INJECTED approved-Team
      //    identity. There is no argument here and no environment read.
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

      const namespace: RedaxTeamAdminRecoveryNamespace = {
        cluster: REDAX_TEAM_ADMIN_JOURNAL_CLUSTER,
        program: programId.toBase58(),
        teamWallet: approvedTeam.toBase58(),
      }

      // 2. THE DURABLE RECORD IS THE ONLY SOURCE OF THE ATTEMPT'S FACTS. Not a caller,
      //    not a React state, not a remembered local — the record, read now.
      const existing = await readRedaxTeamAdminRecoveryJournal(namespace)
      if (!existing.ok) {
        return answer(false, 'JOURNAL_UNAVAILABLE')
      }
      if (existing.kind === 'EMPTY') {
        return answer(false, 'NOTHING_TO_RECONCILE')
      }
      recordedCampaign = existing.record.plan.campaign
      recordedOutputMint = existing.record.plan.outputMint
      recordedSignature = existing.record.knownSignature
      if (existing.kind === 'TOMBSTONE') {
        // Already resolved. A tombstone never moves again, and re-deciding one would be
        // the single most dangerous thing a reconciliation could do. A matching-complete
        // tombstone is the one resolution whose Campaign a workspace may be opened for —
        // which is what lets a reload return to the same campaign with one explicit check.
        return answer(
          true,
          'ALREADY_RESOLVED',
          existing.record.resolution === 'RESOLVED_MATCHING_COMPLETE_STATE'
            ? existing.record.plan.campaign
            : null,
        )
      }
      const record: RedaxTeamAdminRecoveryRecordV1 = existing.record
      if (record.lifecycle === 'PRE_INVOCATION') {
        return answer(false, 'NOT_INVOCATION_STARTED')
      }
      if (record.lifecycle !== 'KNOWN_SIGNATURE' || record.knownSignature === null) {
        // `POST_INVOCATION_SIGNATURE_UNKNOWN`: the marker exists and no signature does.
        // There is nothing to observe against, and nothing here may invent one.
        return answer(false, 'SIGNATURE_UNKNOWN_UNRESOLVED')
      }
      const retention = retainRedaxKnownSignature(record.knownSignature)
      if (!retention.ok) {
        return answer(false, 'JOURNAL_UNAVAILABLE')
      }
      const knownSignature: RedaxKnownSignature = retention.knownSignature

      // 3. A RECOVERY-SCOPED, READ-ONLY Connection. It is NOT an attempt Connection: no
      //    attempt is opened here, no guard snapshot is minted against it and nothing it
      //    touches is ever signed, so the guard's same-Connection rule is untouched.
      const connection = new Connection(runtimeConfig.rpcUrl, REDAX_TEAM_ADMIN_ACTION_COMMITMENT)

      /** The compare-and-set cursor, advanced from what was READ BACK. */
      let cursor: RedaxTeamAdminRecoveryAttemptIdentity = {
        attemptNonce: record.attemptNonce,
        revision: record.revision,
      }
      // NAMED DISTINCTLY from the submit choreography's helper on purpose. Two different
      // compare-and-set cursors under one name in one file is exactly the confusion that
      // produces a write against a stale revision, and the exact-call censuses that pin
      // the submit route would silently start counting this one too.
      const applyRecoveryTransition: RedaxTeamAdminApplyAndVerify = async (transitionInput, expect) => {
        const written = await transitionRedaxTeamAdminRecoveryAttempt(transitionInput)
        if (!written.ok) {
          return false
        }
        const readBack = await readRedaxTeamAdminRecoveryJournal(transitionInput.namespace)
        if (!readBack.ok || readBack.kind === 'EMPTY') {
          return false
        }
        const seen = readBack.record
        const matches =
          seen.attemptNonce === written.record.attemptNonce &&
          seen.revision === written.record.revision &&
          seen.lifecycle === expect.lifecycle &&
          seen.observation === expect.observation &&
          seen.resolution === expect.resolution &&
          seen.knownSignature === expect.knownSignature &&
          seen.issueCodes.length === expect.issueCodes.length &&
          expect.issueCodes.every((code) => seen.issueCodes.includes(code))
        if (!matches) {
          return false
        }
        cursor = { attemptNonce: seen.attemptNonce, revision: seen.revision }
        return true
      }

      // 4. STRICT EXPIRY, FIRST — because every absence claim below has to be anchored
      //    in a world where this transaction can no longer land.
      //
      //    A blockhash is valid THROUGH `lastValidBlockHeight`, so the comparison is
      //    STRICTLY GREATER. At equality the transaction can still be accepted, and `>=`
      //    would declare a live transaction dead.
      let finalizedBlockHeight: number
      try {
        finalizedBlockHeight = await connection.getBlockHeight({ commitment: 'finalized' })
      } catch {
        // Nothing was read, nothing was written and nothing is concluded.
        return answer(false, 'OUTCOME_UNREADABLE')
      }
      const strictlyExpired = finalizedBlockHeight > record.blockhashValidity.lastValidBlockHeight

      // 5. ONE explicit observation of the exact retained signature. One shot: no loop,
      //    no timer, no polling, no automatic recursion.
      const outcome = await observeRedaxKnownSignatureOutcome(connection, {
        signature: knownSignature,
        intendedMessage: record.intendedMessage,
        minimumContextSlot: record.blockhashValidity.preflightContextSlot,
        lastValidBlockHeight: record.blockhashValidity.lastValidBlockHeight,
      })

      /** Record one observation at `KNOWN_SIGNATURE` and read it back exactly. */
      const observe = async (
        observation: RedaxTeamAdminRecoveryObservation,
        issueCodes: readonly RedaxTeamAdminRecoveryIssueCode[],
      ): Promise<boolean> =>
        applyRecoveryTransition(
          {
            namespace,
            expectedAttemptNonce: cursor.attemptNonce,
            expectedRevision: cursor.revision,
            transition: { type: 'RECORD_OBSERVATION', observation, issueCodes },
          },
          {
            lifecycle: 'KNOWN_SIGNATURE',
            observation,
            resolution: null,
            knownSignature,
            issueCodes,
          },
        )

      // 6. A LANDED OUTCOME OUTRANKS EVERY ABSENCE QUESTION. If the chain can see this
      //    transaction at all, "it never landed" is already false and the no-land branch
      //    below must never be reached.
      if (outcome.kind === 'LANDED_TRANSACTION_FAILED' || outcome.kind === 'LANDED_MESSAGE_MISMATCH') {
        const issueCodes: readonly RedaxTeamAdminRecoveryIssueCode[] =
          outcome.kind === 'LANDED_MESSAGE_MISMATCH' ? ['LANDED_MESSAGE_NOT_EXACT'] : []
        if (!(await observe(outcome.kind, issueCodes))) {
          return answer(false, 'TERMINAL_RECORD_UNVERIFIED')
        }
        if (outcome.finality !== 'finalized') {
          return answer(false, 'OUTCOME_UNRESOLVED_SUPPORT')
        }
        const resolved = await applyRecoveryTransition(
          {
            namespace,
            expectedAttemptNonce: cursor.attemptNonce,
            expectedRevision: cursor.revision,
            transition: { type: 'RESOLVE_TERMINAL_FAILURE' },
          },
          {
            lifecycle: 'TOMBSTONE',
            observation: outcome.kind,
            resolution: 'ACCEPTED_RESOLVED_TERMINAL_FAILURE',
            knownSignature,
            issueCodes,
          },
        )
        return resolved
          ? answer(true, 'TERMINAL_FAILURE_RESOLVED')
          : answer(false, 'TERMINAL_RECORD_UNVERIFIED')
      }
      if (
        outcome.kind === 'CONFIRMED_MESSAGE_META_MATCHING' ||
        outcome.kind === 'FINALIZED_MESSAGE_META_MATCHING'
      ) {
        // It LANDED and the exact approved message matched.
        //
        // A v1 RECORD CANNOT BE PROVEN HERE, and is not guessed: it carries no frozen
        // protocol-fee-authority expectation, so a plan comparison would have to measure
        // the read against itself. Exactly the historical behaviour — recorded,
        // blocking, readable — under a code that says why.
        if (record.frozenExpectations === null) {
          if (outcome.kind === 'CONFIRMED_MESSAGE_META_MATCHING') {
            return answer(false, 'OUTCOME_PENDING')
          }
          return (await observe('SUPPORT_ONLY', []))
            ? answer(false, 'LEGACY_RECORD_SUCCESS_UNPROVABLE')
            : answer(false, 'TERMINAL_RECORD_UNVERIFIED')
        }
        // A v2 RECORD runs the SAME settlement the submit choreography runs, against the
        // expectation that was durable and read back BEFORE the one raw send. The
        // identities and terms come from the record; the mint authority is the planned
        // Campaign PDA (the program's own rule, also enforced by the setup assembler);
        // the decimals are the fixed Phase 1 output decimals. Nothing comes from the read.
        if (outcome.transactionSlot === null) {
          return answer(false, 'OUTCOME_UNREADABLE')
        }
        const settled = await settleSubmittedOutcome({
          outcome,
          namespace,
          connection,
          programId,
          expectation: {
            campaign: record.plan.campaign,
            campaignAdmin: record.plan.campaignAdmin,
            outputGovernance: record.plan.outputGovernance,
            outputMint: record.plan.outputMint,
            outputMintDecimals: REDAX_OUTPUT_MINT_DECIMALS,
            outputMintAuthority: record.plan.campaign,
            protocolFeeVault: record.plan.protocolFeeVault,
            protocolFeeAuthority: record.frozenExpectations.protocolFeeAuthority,
            saltHex: record.plan.saltHex,
            endTs: record.plan.endTs,
            maxOutputSupply: record.plan.maxOutputSupply,
          },
          localKnownSignature: knownSignature,
          readFloor: Math.max(
            record.blockhashValidity.preflightContextSlot,
            outcome.transactionSlot,
          ),
          applyAndVerify: applyRecoveryTransition,
          readCursor: () => cursor,
        })
        switch (settled.code) {
          case 'SUBMITTED_MATCHING_COMPLETE_STATE':
            return answer(true, 'MATCHING_COMPLETE_STATE_RESOLVED', record.plan.campaign)
          case 'SUBMITTED_TERMINAL_FAILURE':
            return answer(true, 'TERMINAL_FAILURE_RESOLVED')
          case 'SUBMITTED_OUTCOME_PENDING':
            return answer(false, 'OUTCOME_PENDING')
          case 'SUBMITTED_OUTCOME_UNREADABLE':
            return answer(false, 'OUTCOME_UNREADABLE')
          case 'SUBMITTED_OUTCOME_UNRESOLVED_SUPPORT':
            return answer(false, 'OUTCOME_UNRESOLVED_SUPPORT')
          case 'TERMINAL_RECORD_UNVERIFIED':
            return answer(false, 'TERMINAL_RECORD_UNVERIFIED')
          default:
            // No other settlement code exists after a matching landing. An impossible one
            // concludes nothing.
            return answer(false, 'RECONCILE_INTERNAL_FAILURE')
        }
      }
      if (outcome.kind === 'TRANSACTION_NOT_YET_READABLE') {
        return answer(false, 'OUTCOME_PENDING')
      }
      if (outcome.kind === 'READ_UNAVAILABLE') {
        return (await observe('READ_UNAVAILABLE', []))
          ? answer(false, 'OUTCOME_UNREADABLE')
          : answer(false, 'TERMINAL_RECORD_UNVERIFIED')
      }

      // --- From here the observation is CONFIRMATION_PENDING: no status was found. ---

      // 7. BEFORE STRICT EXPIRY, a missing status is simply "not yet". It is never
      //    absence, and no part of the no-land conjunction may be attempted from it.
      if (!strictlyExpired) {
        return answer(false, 'NOT_EXPIRED')
      }

      // 8. THE FINALIZED FLOOR, established AFTER strict expiry. A slot observed before
      //    the transaction could no longer land tells you nothing about the world in
      //    which it can no longer land, so every absence claim below is anchored at or
      //    above this one.
      let expiryFloorSlot: number
      try {
        expiryFloorSlot = await connection.getSlot({ commitment: 'finalized' })
      } catch {
        return answer(false, 'NO_LAND_NOT_PROVEN')
      }

      // 9. THE CHOREOGRAPHY-OWNED SIGNATURE-ABSENCE PROOF, read DIRECTLY and checked for
      //    an EXACT NULL.
      //
      //    This is deliberately NOT delegated to the general outcome observation above.
      //    That observation's pending arm is BROADER than this proof: it also admits an
      //    `undefined` element, and it is floored at the attempt's preflight context
      //    rather than at a post-expiry finalized slot. Both differences are fine for
      //    "is it settled yet?" and neither is acceptable for "it provably never landed".
      //
      //    `searchTransactionHistory: true` is required, not optional: a status query
      //    without it can miss a landed transaction that has aged out of the recent-status
      //    cache, and a missed landing read as an absence is the exact failure this
      //    terminal exists to prevent.
      let statusResponse: unknown
      try {
        statusResponse = await connection.getSignatureStatuses([knownSignature], {
          searchTransactionHistory: true,
        })
      } catch {
        // An RPC failure is NOT a null entry. It is an unknown.
        return answer(false, 'NO_LAND_NOT_PROVEN')
      }
      if (!isExactlyOneNullStatusAtOrAbove(statusResponse, expiryFloorSlot)) {
        return answer(false, 'NO_LAND_NOT_PROVEN')
      }

      // 10. ONE COHERENT FINALIZED ACCOUNT READ, at or above the same floor. FOUR
      //     accounts at ONE context, never four reads at four moments: a Campaign created
      //     between read one and read four would be invisible to all of them.
      //
      //     `'finalized'` is required and is not substitutable. Confirmed state can still
      //     be reorganised, so "the Campaign is absent" observed there is not the same
      //     statement as "the Campaign is absent and cannot appear".
      const finalizedRead = await readRedaxTeamAdminS1CoherentStateWithContext(
        connection,
        programId,
        {
          campaign: new PublicKey(record.plan.campaign),
          outputMint: new PublicKey(record.plan.outputMint),
          outputMintDecimals: REDAX_OUTPUT_MINT_DECIMALS,
          protocolFeeVault: new PublicKey(record.plan.protocolFeeVault),
        },
        { commitment: 'finalized', minContextSlot: expiryFloorSlot },
      )
      if (!finalizedRead.ok || finalizedRead.contextSlot < expiryFloorSlot) {
        // The request option protects request EVALUATION; this rejects a stale ANSWER.
        return answer(false, 'NO_LAND_NOT_PROVEN')
      }
      const seenState = finalizedRead.observation
      // UNREADABLE IS NEVER ABSENT — not for the ProtocolConfig, and not for any of the
      // three planned accounts. `ProtocolConfig` must be POSITIVELY readable: a read that
      // cannot see the account that certainly exists is not evidence about the accounts
      // that should not.
      if (
        seenState.protocolConfig.presence !== 'PRESENT' ||
        seenState.campaign.presence !== 'ABSENT' ||
        seenState.outputMint.presence !== 'ABSENT' ||
        seenState.protocolFeeVault.presence !== 'ABSENT'
      ) {
        return answer(false, 'NO_LAND_NOT_PROVEN')
      }

      // 11. THE ONE POST-RAW-SEND TERMINAL, written under exact compare-and-set and read
      //     back exactly. The retained signature is carried through UNCHANGED — a
      //     tombstone that forgot the signature it just proved absent could never be
      //     re-checked by anyone, ever.
      const terminal = await applyRecoveryTransition(
        {
          namespace,
          expectedAttemptNonce: cursor.attemptNonce,
          expectedRevision: cursor.revision,
          transition: { type: 'RESOLVE_FINALIZED_NO_LAND' },
        },
        {
          lifecycle: 'TOMBSTONE',
          observation: 'FINALIZED_NO_LAND_PROVEN',
          resolution: 'RESOLVED_FINALIZED_NO_LAND',
          knownSignature,
          issueCodes: [],
        },
      )
      if (!terminal) {
        // DURABILITY_UNKNOWN_UNTIL_EXACT_READ. The write may have landed, the prior
        // record may still stand, or storage may be unreadable — and a failure observed
        // after `setItem` is consistent with ALL THREE. So this claims none of them:
        // no rollback, no automatic second terminal write, no new attempt, no resend.
        // Only a LATER explicit exact read classifies it, and this same entrypoint is
        // what performs that read — an already-resolved record returns `ALREADY_RESOLVED`
        // above, a surviving `KNOWN_SIGNATURE` record re-enters this flow, and anything
        // else stays unresolved and support-blocking.
        return answer(false, 'TERMINAL_RECORD_UNVERIFIED')
      }
      return answer(true, 'FINALIZED_NO_LAND_RESOLVED')
    } catch {
      // Value-free, unbound and unclassified, exactly as the submit boundary is. It holds
      // no custody to release — this operation never had any — and it grants no retry,
      // no resend and no new attempt.
      return answer(false, 'RECONCILE_INTERNAL_FAILURE')
    }
  }, [approvedTeamWallet])

  /**
   * C1 — THE PASSIVE, READ-ONLY DEVNET SOL READ. It takes no arguments and returns a bare
   * verdict.
   *
   * EVERY PRECONDITION IS RESOLVED HERE, from the same private sources `submitS1` uses, so
   * a caller cannot steer it: the bounded runtime configuration, the broker's own current
   * key, and the INJECTED approved Team identity. A missing configuration, a disconnected
   * broker, a broker that cannot sign-only, an absent or malformed approved identity, and a
   * connected wallet that is not EXACTLY the approved Team all resolve to `READ_UNAVAILABLE`
   * — never to a verdict about some other account.
   *
   * The sign-only precondition is required even though nothing here signs: this member
   * answers "can the wallet that would actually pay for an S1 afford one", and a broker
   * that could not sign is not that wallet.
   *
   * ONE FRESH READ-ONLY SCOPED `Connection` PER CALL, constructed here and used for nothing
   * else. It is not the attempt Connection, is never registered with the chain guard, and
   * cannot bind a floor — a passive read must not be able to raise an attempt's floor, and
   * structurally it cannot, because the guard refuses any bind whose Connection is not the
   * exact object Phase A registered.
   *
   * IT BUILDS, SIGNS, SENDS, WRITES AND AUTHORIZES NOTHING. It reaches no journal, no
   * custody, no attempt transition and no `Transaction`, and its answer grants no
   * permission: `submitS1` re-observes at C2 through the SAME observer regardless.
   */
  const readTeamAdminSolPreflight =
    useCallback(async (): Promise<RedaxTeamAdminSolPreflightResult> => {
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
      const connection = new Connection(runtimeConfig.rpcUrl, REDAX_TEAM_ADMIN_ACTION_COMMITMENT)
      // `minContextSlot = null`: a passive read has no attempt, and therefore no attempt
      // floor to be measured against. C2 is the call that supplies one.
      const observation = await observeRedaxTeamAdminS1SolPreflight(connection, approvedTeam, null)
      // THE BARE VERDICT AND NOTHING ELSE. The internal cause, the context slot and the
      // observed mint rent all stop here.
      return observation.result
    }, [approvedTeamWallet, broker])

  const fingerprintPlan = useCallback(
    (plan: RedaxFrozenCampaignPlanV1): Promise<string> => computeRedaxCampaignPlanFingerprint(plan),
    [],
  )

  const readRecoveryRecord = useCallback(
    (namespace: RedaxTeamAdminRecoveryNamespace): Promise<RedaxTeamAdminRecoveryReadResult> =>
      readRedaxTeamAdminRecoveryJournal(namespace),
    [],
  )

  const openRecoveryRecord = useCallback(
    (input: RedaxTeamAdminRecoveryBeginInput): Promise<RedaxTeamAdminRecoveryWriteResult> =>
      beginRedaxTeamAdminRecoveryAttempt(input),
    [],
  )

  const advanceRecoveryRecord = useCallback(
    (
      input: RedaxTeamAdminGenericRecoveryTransitionInput,
    ): Promise<RedaxTeamAdminRecoveryWriteResult> => {
      // The SECOND enforcement of the narrowing above, for callers the type system never
      // saw: plain JavaScript, a hostile object, a value widened through `unknown`. It
      // reads only the discriminant, refuses BEFORE the journal is called at all, and
      // therefore performs no storage read, no lock acquisition, no revision advance and
      // no write. A refusal here is not a failure of the durable record — nothing was
      // asked of it — so the existing closed failure vocabulary carries it unchanged.
      //
      // It covers BOTH choreography-owned terminals from the one named set, so the set is
      // the single place either is spelled and a third could not be added to one rule and
      // forgotten in the other.
      //
      // THE INPUT IS SNAPSHOTTED FIRST, AND THE ORIGINAL IS NEVER USED AGAIN. Checking one
      // object and forwarding that same object are two separate reads, and a getter or a
      // `Proxy` is free to answer differently each time — so a boundary that judged
      // `input.transition` and then handed `input` to the journal would be judging a value
      // the journal need never see. What the exclusion below judges and what the journal
      // is given are therefore the SAME captured discriminant and the SAME plain frozen
      // input, with no read of the caller's object in between.
      const snapshot = snapshotGenericRecoveryTransitionInput(input)
      if (isRedaxTeamAdminChoreographyOnlyTerminal(snapshot.capturedTransitionType)) {
        return Promise.resolve<RedaxTeamAdminRecoveryWriteResult>({
          ok: false,
          code: 'TRANSITION_INVALID',
        })
      }
      if (!snapshot.ok) {
        // An input that could not be captured is refused with the SAME closed vocabulary
        // the journal would have refused it with, in the same order — value-free, with
        // nothing thrown, nothing logged and nothing persisted.
        return Promise.resolve<RedaxTeamAdminRecoveryWriteResult>({
          ok: false,
          code: snapshot.code,
        })
      }
      return transitionRedaxTeamAdminRecoveryAttempt(snapshot.input)
    },
    [],
  )

  const projectPostState = useCallback(
    (
      observation: RedaxS1CoherentObservationV1,
      landedMessage: RedaxS1LandedMessageAssessmentV1,
      plan: RedaxTeamAdminPlanExpectation,
    ): RedaxS1PostStateV1 => assessRedaxTeamAdminS1PostState(observation, landedMessage, plan),
    [],
  )

  const projectRecoveryTransition = useCallback(
    (
      context: RedaxCampaignRecoveryContextV1,
      event: RedaxCampaignRecoveryEvent,
    ): RedaxCampaignRecoveryTransition => transitionRedaxCampaignRecovery(context, event),
    [],
  )

  const initialRecoveryContext = useCallback(
    (): RedaxCampaignRecoveryContextV1 => initialRedaxCampaignRecoveryContext(),
    [],
  )

  const value = useMemo<RedaxTeamAdminActionsValue>(
    () => ({
      transactionCapability: REDAX_TEAM_ADMIN_TRANSACTION_CAPABILITY,
      rawBroadcastCapability: REDAX_TEAM_ADMIN_RAW_BROADCAST_CAPABILITY,
      attempt,
      advanceAttempt,
      submitS1,
      reconcileS1,
      readTeamAdminSolPreflight,
      fingerprintPlan,
      readRecoveryRecord,
      openRecoveryRecord,
      advanceRecoveryRecord,
      projectPostState,
      projectRecoveryTransition,
      initialRecoveryContext,
    }),
    [
      attempt,
      advanceAttempt,
      submitS1,
      reconcileS1,
      readTeamAdminSolPreflight,
      fingerprintPlan,
      readRecoveryRecord,
      openRecoveryRecord,
      advanceRecoveryRecord,
      projectPostState,
      projectRecoveryTransition,
      initialRecoveryContext,
    ],
  )

  return (
    <RedaxTeamAdminActionsContext.Provider value={value}>
      {children}
    </RedaxTeamAdminActionsContext.Provider>
  )
}

/**
 * Read the composed Team/Admin surface.
 *
 * Throws outside the provider rather than returning a permissive default: a default
 * would be a second, unreviewed surface that appears exactly when the real one is
 * absent, and "no provider" is a wiring mistake rather than a runtime state to tolerate.
 */
export function useRedaxTeamAdminActions(): RedaxTeamAdminActionsValue {
  const value = useContext(RedaxTeamAdminActionsContext)
  if (value === null) {
    throw new Error('useRedaxTeamAdminActions must be used inside RedaxTeamAdminActionsProvider')
  }
  return value
}
