// REDAX Holder action bridge — the ONLY place a REDAX transaction is submitted, and
// the only place that decides what happened afterwards.
//
// -----------------------------------------------------------------------------
// WHAT THIS FILE IS
// -----------------------------------------------------------------------------
//
// THE RECONCILER IS NOT A THIRD ACTION, AND IT CLOSES A LIVENESS GAP. A valid,
// finalized, effect-complete Holder attempt could otherwise block the Holder surface
// PERMANENTLY: the durable record retained the exact signature and a later read-only
// check could observe that signature as finalized, but nothing was allowed to
// TERMINATE the retained attempt from a later session, so the record stayed ACTIVE
// forever. `reconcileHolderRecovery` is the one explicit, human-gestured operation
// that may. It builds no instruction and no `Transaction`, never invokes the wallet
// transport, never signs, never sends, never simulates, never fetches a blockhash for
// a send and never reaches bounded HN2 discovery — its runtime type carries no
// discovery address to reach it with. It reads the durable record, observes the
// signature that record ALREADY retained, reads the exact action effect, and lets the
// EXISTING known-signature terminal logic write the EXISTING transitions under the
// EXISTING compare-and-set. Safety is not relaxed anywhere: every rule below that
// refuses to resolve still refuses, and an unresolved reconciliation is a correct one.
//
// This module is the sole integration root for the three shared-hardening
// foundations. It is the only product importer of the chain guard, the
// known-signature outcome module and the Holder recovery journal, the only importer
// of the private wallet transport, and the only owner of `getSignaturesForAddress`.
// It never fetches a transaction itself — that stays with the outcome module and the
// receipt decoder.
//
// -----------------------------------------------------------------------------
// THE ONE IDEA THE WHOLE FILE IS BUILT AROUND
// -----------------------------------------------------------------------------
// THE WALLET DOES NOT BROADCAST. It signs, and REDAX broadcasts — so the wallet
// prompt is no longer the point of no return, and the exact bytes that reach devnet
// are bytes this file has already read, compared and verified.
//
//   SIGN ONLY -> VERIFY THE EXACT SIGNED MESSAGE -> DURABLY RETAIN THE LOCAL
//   SIGNATURE -> SEND THE EXACT VERIFIED BYTES, ONCE
//
// `sendRawTransaction` IS THE POINT OF NO RETURN. Once it is called, a transaction
// may have been broadcast even if the call throws, even if nothing is returned, even
// if the tab closes. So:
//
//   * every question worth asking is asked BEFORE that moment, and the mutable ones
//     are asked again twice: once immediately before the wallet is asked to sign, and
//     once again after signing and immediately before the irreversible send;
//   * the wallet's signed transaction is UNTRUSTED. Its message bytes are extracted
//     from the signed wire itself — never recompiled — and are required to be
//     byte-identical to the message REDAX committed to, with the holder's signature
//     verified cryptographically against exactly those bytes. A wallet that adds,
//     removes or reorders anything is refused BEFORE any broadcast;
//   * the exact transaction signature is derived LOCALLY from the verified artifact,
//     and is durably retained and read-verified BEFORE the irreversible act — so a
//     failure at the boundary can never leave a landed transaction whose signature
//     REDAX never recorded;
//   * nothing thrown after the broadcast is inspected for provenance. There is no
//     reliable way to tell "the node refused it" from "it went out and the answer was
//     lost", so this file does not pretend to;
//   * a rejection of the SIGN request is different in kind: REDAX has not broadcast,
//     and the result says so rather than hedging;
//   * `confirmTransaction` is not used and is not the outcome authority. It answers
//     "did my wait finish?", which is a question about this process rather than
//     about the chain.
//
// SUCCESS IS NARROW. `ok: true` means: an exact known signature, an exact landed
// legacy message, finalized status, clean status and metadata errors, an exact
// action-specific effect read at or above the accepted preflight floor, AND a
// read-verified finalized-success tombstone in the journal. Anything else is
// `ok: false` carrying a truthful observation. A confirmed outcome is PROVISIONAL,
// never success.
//
// NOTHING HERE AUTHORIZES A RETRY. There is no retry, reset, resume or resend path,
// no timer, no poll, no subscription, and no action that runs from an effect or on
// mount. An unresolved attempt stays blocking. The journal answers "what is known?",
// never "what may be done?".

import { createContext, useContext, useMemo } from 'react'
import type { ReactNode } from 'react'
import { Connection, PublicKey, Transaction } from '@solana/web3.js'
// The classic-SPL token-account allocation, from the INSTALLED layout. A local copy of
// that width could drift from the layout with no test in the repository noticing.
import { ACCOUNT_SIZE } from '@solana/spl-token'
// The INSTALLED base58 codec — the one encoding a Solana transaction signature has.
// Used for exactly one thing: turning the 64 verified signature bytes this file
// extracted into the exact textual signature the chain knows them by. A local
// re-implementation of an encoding is a second copy free to disagree with the first.
import bs58 from 'bs58'
import {
  readRedaxConvertCoherentStateWithContext,
  readRedaxHolderLoadedIdentityWithContext,
  readRedaxPrepareOutputAtaStateWithContext,
  type RedaxConvertCoherentStateFacts,
} from '../data/devnet/redaxDevnetAccounts'
import {
  buildConvertExactInInstruction,
  buildPrepareUserOutputAtaInstruction,
  buildRedaxDevnetComputeBudgetInstructions,
  type RedaxConvertExactInInstructionResult,
  type RedaxPrepareUserOutputAtaInstructionResult,
} from '../data/devnet/redaxDevnetTxBuilders'
import { resolveRedaxRuntimeActionConfig } from '../data/redaxDataSourceProvider'
// `REDAX_U128_MAX` is acquired for ONE purpose and only one: the reconciler rebuilds
// the four cumulative counters an approved convert projected, from the exact durable
// pre-state and the exact durable amounts, under the ORACLE'S OWN width bound rather
// than a second copy of it. A live attempt still CARRIES the oracle's projection and
// never recomputes one — see `RedaxConvertApprovedAmounts`.
import {
  REDAX_U128_MAX,
  calculateRedaxTransactionAuthorityQuote,
  parseRawAmount,
  type RedaxTransactionAuthorityProjection,
} from '../lib/quoteMath'
import {
  checkRedaxHolderChainGuardPhaseA,
  checkRedaxHolderChainGuardPhaseB,
  fetchRedaxAttemptBlockhash,
  type RedaxHolderChainGuardLoaded,
  type RedaxHolderChainGuardRequest,
  type RedaxHolderChainGuardRuntime,
} from './redaxWalletChainGuard'
import {
  beginRedaxHolderRecoveryAttempt,
  readRedaxHolderRecoveryJournal,
  transitionRedaxHolderRecoveryAttempt,
  type RedaxHolderRecoveryAction,
  type RedaxHolderRecoveryJournalNamespace,
  type RedaxHolderRecoveryJournalObservation,
  type RedaxHolderRecoveryJournalRecordV1,
  type RedaxHolderRecoveryOutcomeFinality,
  type RedaxHolderRecoveryTransition,
} from './redaxHolderRecoveryJournal'
import {
  commitRedaxIntendedLegacyMessage,
  observeRedaxKnownSignatureOutcome,
  retainRedaxKnownSignature,
  type RedaxIntendedLegacyMessageCommitmentV1,
  type RedaxKnownSignature,
  type RedaxKnownSignatureOutcome,
  type RedaxOutcomeFinality,
} from './redaxTransactionOutcome'
import { useRedaxWalletActionTransport } from './RedaxWalletProvider'
import type { RedaxWalletActionTransport } from './RedaxWalletProvider'

// --- Vocabulary ---------------------------------------------------------------

/**
 * Typed, value-free failure reasons for a REDAX Holder action.
 *
 * Everything above the deprecated block is a PRE-BROADCAST refusal: REDAX never
 * called `sendRawTransaction`, so nothing was submitted and saying so is honest.
 * That now includes the six sign-only codes, which is the whole point of the
 * architecture — a wallet prompt is no longer the irreversible boundary, so a
 * declined or mutated signature is a fact about a transaction that does not exist.
 *
 * `SEND_FAILED`, `USER_REJECTED` and `CONFIRM_FAILED` are DEPRECATED COMPATIBILITY
 * LITERALS. They remain in the type ONLY because the Holder controls still keep a
 * total, fail-closed case for them, and removing the members would make those cases a
 * type error rather than a behavioural change. NO PRODUCTION BRANCH IN THIS FILE
 * EMITS ANY OF THE THREE, and the sign-only path must never reach for them:
 * `USER_REJECTED` in particular is the inference this architecture replaced with a
 * fact.
 */
export type RedaxWalletActionErrorCode =
  | 'WALLET_NOT_CONNECTED'
  | 'WRONG_MODE'
  | 'RUNTIME_CONFIG_UNAVAILABLE'
  | 'INVALID_REQUEST'
  | 'INVALID_AMOUNT'
  | 'BUILD_FAILED'
  | 'ATTEMPT_BLOCKED'
  | 'JOURNAL_UNAVAILABLE'
  | 'CHAIN_STATE_UNAVAILABLE'
  | 'CHAIN_GUARD_REFUSED'
  | 'QUOTE_REJECTED'
  | 'CAP_EXCEEDED'
  | 'MESSAGE_COMMITMENT_UNAVAILABLE'
  | 'OUTPUT_ACCOUNT_NOT_READY'
  | 'PAYER_SOL_INSUFFICIENT'
  // --- the sign-only vocabulary. Every one of these is ZERO REDAX BROADCAST. ---
  //
  // A PROVABLE difference and an UNDECIDABLE one stay distinct on purpose. Collapsing
  // them would let "this could not be read" be reported as "your wallet changed the
  // transaction", and the second is an accusation the first cannot support.
  | 'WALLET_SIGN_ONLY_UNAVAILABLE'
  | 'WALLET_SIGN_ONLY_FAILED'
  | 'SIGNED_TRANSACTION_UNREADABLE'
  | 'SIGNED_MESSAGE_VERIFICATION_UNAVAILABLE'
  | 'SIGNED_MESSAGE_MISMATCH'
  | 'SIGNATURE_UNUSABLE'
  | 'SEND_FAILED'
  | 'USER_REJECTED'
  | 'CONFIRM_FAILED'

/**
 * The five sign-only refusals that can only be reached once an attempt owns a slot.
 *
 * `WALLET_SIGN_ONLY_UNAVAILABLE` is deliberately NOT one of them: the capability is
 * checked before anything durable exists, so it has no record to close.
 */
type RedaxSignOnlyRefusalCode =
  | 'WALLET_SIGN_ONLY_FAILED'
  | 'SIGNED_TRANSACTION_UNREADABLE'
  | 'SIGNED_MESSAGE_VERIFICATION_UNAVAILABLE'
  | 'SIGNED_MESSAGE_MISMATCH'
  | 'SIGNATURE_UNUSABLE'

/**
 * What is KNOWN about an attempt after REDAX broadcast.
 *
 * These are observations, not verdicts and never permissions. Only
 * `FINALIZED_EFFECT_MATCHING` — and only after a read-verified journal resolution —
 * is success.
 *
 * `RPC_SIGNATURE_MISMATCH` is the one POST-BROADCAST member added by the sign-only
 * architecture: the node answered with a signature that is not the one REDAX derived
 * and retained, which leaves two candidate identities and no way to prefer either.
 */
export type RedaxHolderObservationCode =
  | 'PREFLIGHT_REFUSED'
  | 'SUBMISSION_OUTCOME_UNKNOWN_WITHOUT_SIGNATURE'
  | 'SIGNATURE_OBSERVED'
  | 'CONFIRMATION_PENDING'
  | 'LANDED_TRANSACTION_FAILED'
  | 'LANDED_MESSAGE_MISMATCH'
  | 'RPC_SIGNATURE_MISMATCH'
  | 'CONFIRMED_EFFECT_MATCHING'
  | 'FINALIZED_EFFECT_MATCHING'
  | 'READ_UNAVAILABLE'
  | 'SUPPORT_ONLY'

/**
 * Prepare alone can observe that the output token account is simply THERE without
 * being able to attribute it. Convert has no such state: an output account may
 * appear for reasons unrelated to an attempt, but burnt legacy tokens cannot.
 */
export type RedaxPrepareObservationCode =
  | RedaxHolderObservationCode
  | 'EFFECT_PRESENT_ORIGIN_UNKNOWN'

export type RedaxPrepareFailureCode = RedaxWalletActionErrorCode | RedaxPrepareObservationCode
export type RedaxConvertFailureCode = RedaxWalletActionErrorCode | RedaxHolderObservationCode

/**
 * Coarse progress phases a caller may observe during one attempt.
 *
 * `confirming` means BOUNDED CHAIN RECONCILIATION is in progress — a fixed number of
 * reads about a known signature. It is not a `confirmTransaction` wait and carries no
 * authority. Both literals are preserved for the existing controls.
 */
export type RedaxWalletActionPhase = 'awaiting_wallet_approval' | 'confirming'

// --- Fixed, value-free copy ----------------------------------------------------
//
// No raw account, signature, endpoint, error, URL or provider message is ever
// interpolated into any of these strings. None of them tells the holder that
// nothing happened unless that is exactly what is known.

const PREPARE_MESSAGE: Record<RedaxPrepareFailureCode, string> = {
  WALLET_NOT_CONNECTED: 'Connect a wallet to prepare the output token account.',
  WRONG_MODE: 'Preparing the output token account is available only in the devnet transaction mode.',
  RUNTIME_CONFIG_UNAVAILABLE: 'The devnet action configuration is unavailable.',
  INVALID_REQUEST: 'The prepare request referenced an invalid account.',
  INVALID_AMOUNT: 'Enter a whole token amount greater than zero.',
  BUILD_FAILED: 'The prepare instruction could not be built.',
  ATTEMPT_BLOCKED: 'An earlier attempt from this browser is still unresolved, so a new one cannot start.',
  JOURNAL_UNAVAILABLE: 'The attempt record could not be read or written safely, so nothing was started.',
  CHAIN_STATE_UNAVAILABLE: 'Devnet could not be read reliably, so nothing was prepared.',
  CHAIN_GUARD_REFUSED: 'The pre-send checks did not pass, so nothing was sent.',
  QUOTE_REJECTED: 'The conversion terms could not be confirmed against devnet, so nothing was sent.',
  CAP_EXCEEDED: 'This conversion would exceed a campaign limit, so nothing was sent.',
  MESSAGE_COMMITMENT_UNAVAILABLE:
    'The transaction could not be recorded before sending, so nothing was sent.',
  OUTPUT_ACCOUNT_NOT_READY: 'The output token account is not in a state this action can prepare.',
  PAYER_SOL_INSUFFICIENT:
    'The connected wallet does not hold enough devnet SOL for this action, so nothing was sent.',
  WALLET_SIGN_ONLY_UNAVAILABLE:
    'The connected wallet did not offer a signing-only request, so it was never asked and nothing was sent.',
  WALLET_SIGN_ONLY_FAILED:
    'The signing request did not complete in your wallet, so nothing was sent.',
  SIGNED_TRANSACTION_UNREADABLE:
    'The signed transaction returned by the wallet could not be read, so nothing was sent.',
  SIGNED_MESSAGE_VERIFICATION_UNAVAILABLE:
    'The signed transaction could not be verified here, so nothing was sent.',
  SIGNED_MESSAGE_MISMATCH:
    'The transaction your wallet signed is not the transaction that was approved, so nothing was sent.',
  SIGNATURE_UNUSABLE:
    'The signature returned by the wallet could not be used, so nothing was sent.',
  SEND_FAILED: 'The wallet did not complete sending the transaction.',
  USER_REJECTED: 'You declined the request in your wallet, so nothing was prepared.',
  CONFIRM_FAILED: 'The transaction was sent but could not be confirmed.',
  PREFLIGHT_REFUSED: 'The pre-send checks did not pass, so nothing was sent.',
  SUBMISSION_OUTCOME_UNKNOWN_WITHOUT_SIGNATURE:
    'The wallet returned no transaction signature, so whether the transaction was submitted is unknown.',
  SIGNATURE_OBSERVED: 'The transaction signature is known and is being checked against devnet.',
  CONFIRMATION_PENDING: 'The transaction is known to devnet and is not confirmed yet.',
  LANDED_TRANSACTION_FAILED: 'The transaction reached devnet and failed there.',
  LANDED_MESSAGE_MISMATCH:
    'A different transaction was found under this signature, so this attempt cannot be resolved from it.',
  RPC_SIGNATURE_MISMATCH:
    'Devnet answered with a different transaction signature, so this attempt cannot be resolved automatically.',
  CONFIRMED_EFFECT_MATCHING:
    'The output token account exists and the transaction is confirmed but not finalized yet.',
  FINALIZED_EFFECT_MATCHING: 'The output token account is prepared and finalized on devnet.',
  READ_UNAVAILABLE: 'Devnet could not be read, so the outcome of this attempt is not known yet.',
  SUPPORT_ONLY: 'This attempt could not be resolved automatically and needs support.',
  EFFECT_PRESENT_ORIGIN_UNKNOWN:
    'The output token account exists, but it cannot be attributed to this attempt.',
}

const CONVERT_MESSAGE: Record<RedaxConvertFailureCode, string> = {
  WALLET_NOT_CONNECTED: 'Connect a wallet to convert.',
  WRONG_MODE: 'Converting is available only in the devnet transaction mode.',
  RUNTIME_CONFIG_UNAVAILABLE: 'The devnet action configuration is unavailable.',
  INVALID_REQUEST: 'The convert request referenced an invalid account.',
  INVALID_AMOUNT: 'Enter a whole token amount greater than zero and within range.',
  BUILD_FAILED: 'The convert instruction could not be built.',
  ATTEMPT_BLOCKED: 'An earlier attempt from this browser is still unresolved, so a new one cannot start.',
  JOURNAL_UNAVAILABLE: 'The attempt record could not be read or written safely, so nothing was started.',
  CHAIN_STATE_UNAVAILABLE: 'Devnet could not be read reliably, so nothing was converted.',
  CHAIN_GUARD_REFUSED: 'The pre-send checks did not pass, so nothing was sent.',
  QUOTE_REJECTED: 'The conversion terms could not be confirmed against devnet, so nothing was sent.',
  CAP_EXCEEDED: 'This conversion would exceed a campaign limit, so nothing was sent.',
  MESSAGE_COMMITMENT_UNAVAILABLE:
    'The transaction could not be recorded before sending, so nothing was sent.',
  OUTPUT_ACCOUNT_NOT_READY: 'The output token account is not ready for a conversion.',
  PAYER_SOL_INSUFFICIENT:
    'The connected wallet does not hold enough devnet SOL for this action, so nothing was sent.',
  WALLET_SIGN_ONLY_UNAVAILABLE:
    'The connected wallet did not offer a signing-only request, so it was never asked and nothing was sent.',
  WALLET_SIGN_ONLY_FAILED:
    'The signing request did not complete in your wallet, so nothing was sent.',
  SIGNED_TRANSACTION_UNREADABLE:
    'The signed transaction returned by the wallet could not be read, so nothing was sent.',
  SIGNED_MESSAGE_VERIFICATION_UNAVAILABLE:
    'The signed transaction could not be verified here, so nothing was sent.',
  SIGNED_MESSAGE_MISMATCH:
    'The transaction your wallet signed is not the transaction that was approved, so nothing was sent.',
  SIGNATURE_UNUSABLE:
    'The signature returned by the wallet could not be used, so nothing was sent.',
  SEND_FAILED: 'The wallet did not complete sending the transaction.',
  USER_REJECTED: 'You declined the request in your wallet, so nothing was converted.',
  CONFIRM_FAILED: 'The transaction was sent but could not be confirmed.',
  PREFLIGHT_REFUSED: 'The pre-send checks did not pass, so nothing was sent.',
  SUBMISSION_OUTCOME_UNKNOWN_WITHOUT_SIGNATURE:
    'The wallet returned no transaction signature, so whether the transaction was submitted is unknown.',
  SIGNATURE_OBSERVED: 'The transaction signature is known and is being checked against devnet.',
  CONFIRMATION_PENDING: 'The transaction is known to devnet and is not confirmed yet.',
  LANDED_TRANSACTION_FAILED: 'The transaction reached devnet and failed there.',
  LANDED_MESSAGE_MISMATCH:
    'A different transaction was found under this signature, so this attempt cannot be resolved from it.',
  RPC_SIGNATURE_MISMATCH:
    'Devnet answered with a different transaction signature, so this attempt cannot be resolved automatically.',
  CONFIRMED_EFFECT_MATCHING:
    'The conversion is visible on devnet and is confirmed but not finalized yet.',
  FINALIZED_EFFECT_MATCHING: 'The conversion is finalized on devnet.',
  READ_UNAVAILABLE: 'Devnet could not be read, so the outcome of this attempt is not known yet.',
  SUPPORT_ONLY: 'This attempt could not be resolved automatically and needs support.',
}

// --- Amount parsing ------------------------------------------------------------

/**
 * Inclusive maximum classic-SPL amount (u64) — the width of the three token balances
 * this file compares directly.
 *
 * There is deliberately no u128 constant here any more. The cumulative counters are
 * projected by the checked quote oracle under ITS width bounds, and this file
 * compares against that projection rather than re-deriving one, so a second copy of
 * the on-chain width would have nothing to guard and everything to drift from.
 */
const U64_MAX = 18446744073709551615n

/**
 * Parse a base-unit integer amount string to a u64-bounded positive bigint. Accepts
 * only a non-empty run of ASCII digits (optionally surrounded by whitespace): no
 * sign, no decimal point, no separators. Returns null for anything empty,
 * non-integer, zero, or above the u64 max. Value-free; never throws.
 */
function parsePositiveU64Amount(raw: string): bigint | null {
  const trimmed = raw.trim()
  if (!/^[0-9]+$/.test(trimmed)) {
    return null
  }
  let value: bigint
  try {
    value = BigInt(trimmed)
  } catch {
    return null
  }
  if (value <= 0n || value > U64_MAX) {
    return null
  }
  return value
}

/** Addition that refuses to wrap past the on-chain width instead of producing nonsense. */
function checkedAdd(left: bigint, right: bigint, max: bigint): bigint | null {
  const sum = left + right
  return sum >= 0n && sum <= max ? sum : null
}

/** Subtraction that refuses to go negative — a balance cannot. */
function checkedSub(left: bigint, right: bigint): bigint | null {
  const difference = left - right
  return difference >= 0n ? difference : null
}

// --- Public request / result shapes ---------------------------------------------

/**
 * A request to prepare a connected wallet's canonical output ATA for a campaign.
 * `campaign` and `outputMint` are base58 strings from the loaded Redax*View data;
 * the payer/user is always the connected wallet (resolved inside the bridge).
 */
export interface RedaxPrepareUserOutputAtaRequest {
  campaign: string
  outputMint: string
}

/**
 * Result of one prepare attempt.
 *
 * `ok: true` means finalized, message- and metadata-clean, effect-verified AND
 * journal-resolved. Every other arm is `ok: false` and carries the exact observation,
 * the known signature when one exists, the observed finality and the observed context
 * slot. There is deliberately no `retry`, `reset`, `resume`, `canSend` or `retrySafe`
 * member on any arm — not omitted by convention, absent from the type, so no consumer
 * can read one.
 */
export type RedaxPrepareUserOutputAtaResult =
  | {
      ok: true
      signature: string
      /** Always exactly `'finalized'`: a confirmed outcome is provisional, never success. */
      finality: RedaxOutcomeFinality
      /** The exact context slot of the finalized action-effect read that proved it. */
      contextSlot: number
      userOutputAta: string
    }
  | {
      ok: false
      code: RedaxPrepareFailureCode
      message: string
      signature?: string
      finality?: RedaxOutcomeFinality
      contextSlot?: number
      userOutputAta?: string
    }

/**
 * A request to convert `amountInRaw` base units of a connected wallet's legacy input
 * token into the campaign output token. All keys are base58 strings from the loaded
 * Redax*View data; the user/fee-payer is always the connected wallet.
 * `amountInRaw` is a base-unit integer string (BigInt-safe).
 */
export interface RedaxConvertExactInRequest {
  campaign: string
  tokenConfig: string
  legacyMint: string
  outputMint: string
  protocolFeeVault: string
  amountInRaw: string
}

/** Result of one convert attempt. Same narrow success rule as prepare. */
export type RedaxConvertExactInResult =
  | {
      ok: true
      signature: string
      /** Always exactly `'finalized'`: a confirmed outcome is provisional, never success. */
      finality: RedaxOutcomeFinality
      /** The exact context slot of the finalized action-effect read that proved it. */
      contextSlot: number
      userLegacyAta: string
      userOutputAta: string
      protocolConfig: string
    }
  | {
      ok: false
      code: RedaxConvertFailureCode
      message: string
      signature?: string
      finality?: RedaxOutcomeFinality
      contextSlot?: number
    }

/**
 * What the explicit read-only re-check may currently observe about a known signature.
 *
 * The action vocabulary MINUS `RPC_SIGNATURE_MISMATCH`, and that exclusion is
 * architectural rather than cosmetic. A signature mismatch is what REDAX learns from a
 * node's answer to ITS OWN broadcast, so it is a POST-BROADCAST ACTION result. The
 * re-check broadcasts nothing — it reads the durable record and, at most, observes one
 * already-retained signature — so it cannot produce that code, and the type says so
 * rather than obliging a read-only caller to present a state that never arrives.
 */
type RedaxHolderRecoveryCurrentObservation = Exclude<
  RedaxHolderObservationCode,
  'RPC_SIGNATURE_MISMATCH'
>

/** What an explicit read-only recovery re-check can report. Never a permission. */
export type RedaxHolderRecoveryRecheckResult =
  | { ok: true; kind: 'NO_ATTEMPT' }
  | {
      ok: true
      kind: 'ATTEMPT_PRESENT'
      action: RedaxHolderRecoveryAction
      resolved: boolean
      observation: RedaxHolderRecoveryJournalObservation | null
      signature: string | null
      outcome?: RedaxHolderRecoveryCurrentObservation
      finality?: RedaxOutcomeFinality; convertReceipt?: RedaxHolderRecoveryConvertReceiptContext
    }
  | { ok: false; code: 'WALLET_NOT_CONNECTED' | 'RUNTIME_CONFIG_UNAVAILABLE' | 'JOURNAL_UNAVAILABLE' }

/**
 * The narrow action-bridge context.
 *
 * EXACTLY TWO TRANSACTION ACTIONS, and three members that are not actions: two
 * read-only reads and one explicit non-transaction reconciler. None of the three has a
 * capability flag on purpose: a `can*` beside any of them would read as a third
 * action, and none of them authorizes anything.
 */
export interface RedaxWalletActionsContextValue {
  /** True only in DEVNET_TX_ENABLED with a connected wallet. A capability signal; no UI is enabled by it here. */
  readonly canPrepareUserOutputAta: boolean
  prepareUserOutputAta(
    request: RedaxPrepareUserOutputAtaRequest,
    onPhase?: (phase: RedaxWalletActionPhase) => void,
  ): Promise<RedaxPrepareUserOutputAtaResult>
  /** True only in DEVNET_TX_ENABLED with a connected wallet. A capability signal; no UI is enabled by it here. */
  readonly canConvertExactIn: boolean
  convertExactIn(
    request: RedaxConvertExactInRequest,
    onPhase?: (phase: RedaxWalletActionPhase) => void,
  ): Promise<RedaxConvertExactInResult>
  /**
   * Explicit, read-only re-check of the durable attempt record.
   *
   * NOT a transaction action. It builds no instruction and no Transaction, signs
   * nothing, sends nothing, confirms nothing, writes no journal state, runs on no
   * timer, and returns no send or retry authorization. It runs only when something
   * explicitly calls it.
   */
  recheckHolderRecovery(): Promise<RedaxHolderRecoveryRecheckResult>
  /**
   * The explicit, NON-TRANSACTION durable reconciliation of the saved attempt.
   *
   * NOT a transaction action, and it never becomes one. It builds no instruction and
   * no `Transaction`, invokes no wallet transport, signs nothing, sends nothing,
   * simulates nothing, fetches no blockhash for a send, performs no signature
   * discovery and adopts no new transaction identity. It takes NO campaign, token
   * config, amount or transaction request: every identity it uses comes from the
   * durable record, never from present screen state.
   *
   * What it may do is exactly two things: observe the signature the durable record
   * ALREADY retained, and — when and only when the existing terminal rules are
   * satisfied — write the existing journal transitions under the existing
   * compare-and-set. It runs only when something explicitly calls it: no mount, no
   * effect, no timer, no poll, no subscription and no automatic retry.
   *
   * It is deliberately FLAGLESS for the same reason the two read-only members are, and
   * its result is the same read-only recovery projection they speak: a durable
   * observation, never a permission.
   */
  reconcileHolderRecovery(): Promise<RedaxHolderRecoveryRecheckResult>
  /**
   * The passive C1 read: can the connected wallet afford this action right now?
   *
   * NOT a transaction action, and NOT transaction authority. It builds no instruction
   * and no Transaction, signs nothing, sends nothing, confirms nothing, writes no
   * journal state, runs on no timer and returns no send authorization. It exists so a
   * control can withhold a button and say why, and it is deliberately flagless: a
   * `can*` beside it would read as a third action.
   *
   * The attempt's own recheck inside each action is the authority, and it runs again
   * regardless of what this ever returned.
   */
  readHolderSolPreflight(
    actionKind: RedaxHolderSolPreflightActionKind,
  ): Promise<RedaxHolderSolPreflightResult>
}

// Inert default (outside a mounted provider): capability off; the actions never
// proceed and return typed unavailable results. Never throws, never sends.
const INERT_REDAX_WALLET_ACTIONS: RedaxWalletActionsContextValue = {
  canPrepareUserOutputAta: false,
  async prepareUserOutputAta() {
    return {
      ok: false,
      code: 'RUNTIME_CONFIG_UNAVAILABLE',
      message: PREPARE_MESSAGE.RUNTIME_CONFIG_UNAVAILABLE,
    }
  },
  canConvertExactIn: false,
  async convertExactIn() {
    return {
      ok: false,
      code: 'RUNTIME_CONFIG_UNAVAILABLE',
      message: CONVERT_MESSAGE.RUNTIME_CONFIG_UNAVAILABLE,
    }
  },
  async recheckHolderRecovery() {
    return { ok: false, code: 'RUNTIME_CONFIG_UNAVAILABLE' }
  },
  async reconcileHolderRecovery() {
    return { ok: false, code: 'RUNTIME_CONFIG_UNAVAILABLE' }
  },
  async readHolderSolPreflight() {
    // Unknown never means sufficient, so the inert default withholds rather than allows.
    return 'READ_UNAVAILABLE'
  },
}

const RedaxWalletActionsContext = createContext<RedaxWalletActionsContextValue>(
  INERT_REDAX_WALLET_ACTIONS,
)

/** Consume the REDAX action bridge. */
export function useRedaxWalletActions(): RedaxWalletActionsContextValue {
  return useContext(RedaxWalletActionsContext)
}

// --- The composition seam ------------------------------------------------------
//
// A NARROW, ACTION-SPECIFIC, TEST-ONLY COMPOSITION PORT — and deliberately nothing
// more. Each of the two actions is produced by its own factory below, and the React
// provider builds the exact same executors the tests do. That is the whole point: a
// test that exercised a second, test-only copy of the choreography would prove
// nothing about the code that actually runs.
//
// What it is NOT, and cannot become:
//   * not a generic transaction executor or sender — there is no shared "send this"
//     entry point, and each action owns its own construction and its own invocation;
//   * not a raw-adapter escape — the transport it receives is the same narrow facade
//     the provider hands out, and the adapter never leaves the provider module;
//   * not a `Connection` escape — the constructor binding is never passed, returned
//     or stored. Each action constructs its own attempt-scoped instance directly;
//   * not an authorization object — no port can grant a send, skip a guard, or
//     resolve a journal record;
//   * not reachable from runtime env or config — nothing in the app reads a flag to
//     get here. The provider calls the factories with the production ports, full
//     stop, and there is no debug or bypass path.
//
// The default ports ARE the production implementations, so composing an executor
// without overriding anything is exactly production behaviour. A test overrides ports
// to keep the network out; it cannot thereby weaken what production does.

/** Exactly the external operations an attempt performs. Nothing else is injectable. */
export interface RedaxHolderActionPorts {
  readonly readLoadedIdentity: typeof readRedaxHolderLoadedIdentityWithContext
  readonly readPrepareState: typeof readRedaxPrepareOutputAtaStateWithContext
  readonly readConvertState: typeof readRedaxConvertCoherentStateWithContext
  readonly checkPhaseA: typeof checkRedaxHolderChainGuardPhaseA
  readonly fetchBlockhash: typeof fetchRedaxAttemptBlockhash
  readonly checkPhaseB: typeof checkRedaxHolderChainGuardPhaseB
  readonly readJournal: typeof readRedaxHolderRecoveryJournal
  readonly beginAttempt: typeof beginRedaxHolderRecoveryAttempt
  readonly transitionAttempt: typeof transitionRedaxHolderRecoveryAttempt
  readonly retainSignature: typeof retainRedaxKnownSignature
  readonly commitIntendedMessage: typeof commitRedaxIntendedLegacyMessage
  readonly observeOutcome: typeof observeRedaxKnownSignatureOutcome
  /**
   * THE IRREVERSIBLE ACT — the raw broadcast of already-verified signed bytes.
   *
   * NOTHING EXECUTABLE HERE CHANGED. It takes the ATTEMPT'S OWN `Connection` by argument
   * rather than closing over one, so the same-Connection rule the chain guard establishes
   * is visible at the call site instead of being a matter of trust.
   *
   * Every option is REQUIRED and fixed by the caller: preflight stays ON, the accepted
   * post-sign guard floor is carried, and the node is told to retry nothing. The
   * response is typed `unknown` because it comes off the wire and is compared against
   * a signature this file already knows — never trusted as an identity.
   */
  readonly sendRawTransaction: (
    connection: Connection,
    wire: Uint8Array,
    options: {
      readonly skipPreflight: false
      readonly preflightCommitment: 'confirmed'
      readonly minContextSlot: number
      readonly maxRetries: 0
    },
  ) => Promise<unknown>
  /**
   * The bounded HN2 discovery read. Its production implementation is the ONLY
   * `getSignaturesForAddress` call in app source, and it lives here so that the
   * ownership rule is a property of this file rather than of a convention.
   */
  readonly listSignaturesForAddress: (
    connection: Connection,
    address: PublicKey,
    options: { readonly limit: number; readonly minContextSlot: number },
  ) => Promise<unknown>
  /**
   * The connected wallet's lamport balance WITH the context it was read at.
   *
   * `getBalanceAndContext`, never plain `getBalance`: a balance with no context slot
   * cannot be compared against an accepted preflight floor, so it could be arbitrarily
   * stale and there would be no way to tell. The response is deliberately typed
   * `unknown` — it comes off the wire, and the reader below refuses anything it cannot
   * structurally verify rather than trusting a shape.
   *
   * `minContextSlot` is `null` only for the passive read, which has no attempt floor to
   * hold. An attempt always supplies one.
   */
  readonly readPayerLamports: (
    connection: Connection,
    payer: PublicKey,
    options: { readonly commitment: 'confirmed'; readonly minContextSlot: number | null },
  ) => Promise<unknown>
  /**
   * The live rent-exempt minimum for an account of exactly `dataLength` bytes.
   *
   * Read FRESH for every passive request and every attempt. There is no default, no
   * fallback and no carried value: the installed wrapper reports an RPC failure as
   * numeric `0` rather than throwing, so a remembered rent would be indistinguishable
   * from a rent nobody could read.
   */
  readonly readRentExemptMinimum: (
    connection: Connection,
    dataLength: number,
    options: { readonly commitment: 'confirmed' },
  ) => Promise<unknown>
}

export const REDAX_PRODUCTION_HOLDER_ACTION_PORTS: RedaxHolderActionPorts = {
  readLoadedIdentity: readRedaxHolderLoadedIdentityWithContext,
  readPrepareState: readRedaxPrepareOutputAtaStateWithContext,
  readConvertState: readRedaxConvertCoherentStateWithContext,
  checkPhaseA: checkRedaxHolderChainGuardPhaseA,
  fetchBlockhash: fetchRedaxAttemptBlockhash,
  checkPhaseB: checkRedaxHolderChainGuardPhaseB,
  readJournal: readRedaxHolderRecoveryJournal,
  beginAttempt: beginRedaxHolderRecoveryAttempt,
  transitionAttempt: transitionRedaxHolderRecoveryAttempt,
  retainSignature: retainRedaxKnownSignature,
  commitIntendedMessage: commitRedaxIntendedLegacyMessage,
  observeOutcome: observeRedaxKnownSignatureOutcome,
  sendRawTransaction: (connection, wire, options) =>
    connection.sendRawTransaction(wire, {
      skipPreflight: options.skipPreflight,
      preflightCommitment: options.preflightCommitment,
      minContextSlot: options.minContextSlot,
      maxRetries: options.maxRetries,
    }),
  listSignaturesForAddress: (connection, address, options) =>
    connection.getSignaturesForAddress(
      address,
      { limit: options.limit, minContextSlot: options.minContextSlot },
      'confirmed',
    ),
  readPayerLamports: (connection, payer, options) =>
    connection.getBalanceAndContext(
      payer,
      options.minContextSlot === null
        ? { commitment: options.commitment }
        : { commitment: options.commitment, minContextSlot: options.minContextSlot },
    ),
  readRentExemptMinimum: (connection, dataLength, options) =>
    connection.getMinimumBalanceForRentExemption(dataLength, options.commitment),
}

/** The validated DEVNET_TX_ENABLED runtime facts an action needs. */
export interface RedaxHolderActionRuntimeConfig {
  readonly mode: string
  readonly cluster: string
  readonly programId: string
  readonly rpcUrl: string
}

/** What a composed action is built from. */
export interface RedaxHolderActionDeps {
  readonly runtimeConfig: RedaxHolderActionRuntimeConfig | null
  readonly runtimeConfigCode?: 'NOT_DEVNET_TX_MODE' | 'CONFIG_INVALID' | 'CONFIG_INCOMPLETE'
  readonly transport: RedaxWalletActionTransport
  readonly ports?: RedaxHolderActionPorts
}

// --- Shared attempt machinery ---------------------------------------------------

/** The journal cluster is a Phase-1 constant, never derived from a label at runtime. */
const REDAX_JOURNAL_CLUSTER = 'devnet' as const

/** HN2 discovery is exactly one page of exactly this many records. Never paginated. */
const REDAX_HN2_DISCOVERY_LIMIT = 25

/** Every guard read, account read and discovery read is `confirmed`. */
const REDAX_ACTION_COMMITMENT = 'confirmed' as const

// --- The connected wallet's SOL preflight -----------------------------------------
//
//   * C1 — the PASSIVE arm. Availability information for a control: may this action be
//     offered at all? It runs on its own read-only `Connection`, builds no instruction,
//     creates no `Transaction`, invokes no wallet, touches no journal and authorizes
//     nothing. It runs once per wallet/action scope and once more per explicit human
//     re-check — no timer, no polling, no subscription, no automatic retry.
//
//   * C2 — the ATTEMPT-AUTHORITATIVE arm. The only balance decision that can stop an
//     invocation. It runs on the attempt's OWN `Connection` — never a second one — and
//     immediately before the attempt slot is opened, so a refusal writes no journal
//     record, prompts no wallet and cannot leave a support tombstone behind a wallet
//     that was never asked.
//
// NEITHER IS A GUARANTEE. A balance observed at one slot is not a balance at the next,
// and the residual time-of-check / time-of-use window is disclosed rather than claimed
// closed. The program remains the authority on whether a transaction can pay for
// itself; this only stops asking a holder to approve one that provably cannot.

/** The two actions a preflight may be asked about. There is no third. */
export type RedaxHolderSolPreflightActionKind = 'PREPARE_USER_OUTPUT_ATA' | 'CONVERT_EXACT_IN'

/**
 * What a preflight concluded, and nothing else.
 *
 * A bare string union rather than a record, so there is no member a lamport amount, a
 * threshold, an endpoint, a provider name, a wallet address or a raw error could be
 * carried out in — not by convention, but because the type has nowhere to put one.
 */
export type RedaxHolderSolPreflightResult = 'SUFFICIENT' | 'INSUFFICIENT' | 'READ_UNAVAILABLE'

/**
 * The shared conservative single-signature fee allowance, in lamports.
 *
 * WHAT IT NOW HAS TO COVER. Both Holder transactions are single-signature, and both
 * carry the fixed devnet ComputeBudget policy this file consumes from its one authorized
 * owner: a compute-unit limit of `60000` at `50000` micro-lamports per unit. That is a
 * priority fee of exactly `ceil(60000 * 50000 / 1000000)` = `3000` lamports on top of the
 * `5000`-lamport one-signature base fee, so the selected policy's absolute maximum is
 * `8000` lamports and it stays inside this bound with `2000` to spare. The bound is
 * therefore UNCHANGED by that repair rather than merely still plausible under it.
 */
const HOLDER_SOL_PREFLIGHT_FEE_BOUND_LAMPORTS = 10000

/** A payer system account carries no data, so its rent floor is the zero-length minimum. */
const REDAX_PAYER_ACCOUNT_DATA_LENGTH = 0

// A prepared output ATA's allocation is the imported `ACCOUNT_SIZE`, never re-declared.

/** What one preflight observed, plus the context the balance was read at. */
type RedaxSolPreflightObservation =
  | { readonly result: 'SUFFICIENT'; readonly balanceContextSlot: number }
  | { readonly result: 'INSUFFICIENT'; readonly balanceContextSlot: number }
  | { readonly result: 'READ_UNAVAILABLE' }

const SOL_PREFLIGHT_UNAVAILABLE: RedaxSolPreflightObservation = { result: 'READ_UNAVAILABLE' }

/**
 * A lamport BALANCE from an untrusted response, or null.
 */
function readSafeBalanceLamports(value: unknown): bigint | null {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    return null
  }
  return BigInt(value)
}

/**
 * A RENT lamport quantity from an untrusted response, or null — `VALID_RENT_LAMPORTS`.
 *
 * Strictly positive AND a safe integer. The asymmetry with a balance is deliberate and
 * runs the other way: the installed rent wrapper returns numeric `0` on an RPC error
 * instead of throwing, and `0` and negatives are both safe integers, so a safe-integer
 * test alone would accept a FAILED READ as "rent is zero" and understate the threshold
 * by the entire rent term. Zero is not a devnet rent requirement, so it never enters
 * arithmetic; it withholds the action instead. No fallback, no default, no inherited or
 * carried value.
 */
function readValidRentLamports(value: unknown): bigint | null {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    return null
  }
  return BigInt(value)
}

/** The balance and its context slot, from an untrusted response, or null. */
function readContextualBalance(
  response: unknown,
): { readonly lamports: bigint; readonly contextSlot: number } | null {
  // `readCandidateProperty` is a generic PROTECTED property read — a hostile accessor
  // that throws becomes a refusal rather than an escaping exception. It is named for
  // its first caller, not for a discovery record.
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
 * requiredPrepare — the payer rent floor, the classic output-token-account rent, and
 * the shared fee bound. Preparing CREATES an account, so its rent is part of the price.
 */
function requiredPrepareLamports(payerRent: bigint, outputAccountRent: bigint): bigint | null {
  const rentTotal = checkedAdd(payerRent, outputAccountRent, U64_MAX)
  if (rentTotal === null) {
    return null
  }
  return checkedAdd(rentTotal, BigInt(HOLDER_SOL_PREFLIGHT_FEE_BOUND_LAMPORTS), U64_MAX)
}

/**
 * requiredConvert — the payer rent floor and the shared fee bound, and NOTHING else.
 *
 * A convert creates no account, so charging it output-ATA rent would refuse holders who
 * can in fact afford the transaction. The absent term is the point of the function.
 */
function requiredConvertLamports(payerRent: bigint): bigint | null {
  return checkedAdd(payerRent, BigInt(HOLDER_SOL_PREFLIGHT_FEE_BOUND_LAMPORTS), U64_MAX)
}

/**
 * Read the live rent floors and the live balance, and compare — the ONE place either
 * arm's verdict is decided.
 *
 * Everything after the RPC boundary is `bigint` with checked addition; a value that is
 * not a finite safe integer, a rent that is not strictly positive, an unreadable
 * response, a returned context older than the accepted floor and any overflow all yield
 * `READ_UNAVAILABLE`. UNKNOWN NEVER MEANS SUFFICIENT: every one of those withholds the
 * action rather than allowing it. Exact equality with the threshold IS sufficient — the
 * threshold already carries the conservative allowance, and demanding a lamport more
 * would be a second, undeclared buffer.
 */
async function observeHolderSolPreflight(
  ports: RedaxHolderActionPorts,
  connection: Connection,
  payer: PublicKey,
  actionKind: RedaxHolderSolPreflightActionKind,
  minContextSlot: number | null,
): Promise<RedaxSolPreflightObservation> {
  let payerRentRead: unknown
  try {
    payerRentRead = await ports.readRentExemptMinimum(connection, REDAX_PAYER_ACCOUNT_DATA_LENGTH, {
      commitment: REDAX_ACTION_COMMITMENT,
    })
  } catch {
    return SOL_PREFLIGHT_UNAVAILABLE
  }
  const payerRent = readValidRentLamports(payerRentRead)
  if (payerRent === null) {
    return SOL_PREFLIGHT_UNAVAILABLE
  }

  let required: bigint | null
  if (actionKind === 'CONVERT_EXACT_IN') {
    required = requiredConvertLamports(payerRent)
  } else {
    let outputRentRead: unknown
    try {
      outputRentRead = await ports.readRentExemptMinimum(connection, ACCOUNT_SIZE, {
        commitment: REDAX_ACTION_COMMITMENT,
      })
    } catch {
      return SOL_PREFLIGHT_UNAVAILABLE
    }
    const outputAccountRent = readValidRentLamports(outputRentRead)
    if (outputAccountRent === null) {
      return SOL_PREFLIGHT_UNAVAILABLE
    }
    required = requiredPrepareLamports(payerRent, outputAccountRent)
  }
  if (required === null) {
    return SOL_PREFLIGHT_UNAVAILABLE
  }

  let balanceRead: unknown
  try {
    balanceRead = await ports.readPayerLamports(connection, payer, {
      commitment: REDAX_ACTION_COMMITMENT,
      minContextSlot,
    })
  } catch {
    return SOL_PREFLIGHT_UNAVAILABLE
  }
  const observed = readContextualBalance(balanceRead)
  if (observed === null) {
    return SOL_PREFLIGHT_UNAVAILABLE
  }
  // The request-level `minContextSlot` protects request EVALUATION; this rejects a
  // stale RETURNED context. They are separate protections and both are mandatory —
  // a node may honour neither, and only the local check can tell.
  if (minContextSlot !== null && observed.contextSlot < minContextSlot) {
    return SOL_PREFLIGHT_UNAVAILABLE
  }
  // Exact equality IS sufficient: the threshold already carries the conservative
  // allowance, and demanding one lamport more would be a second, undeclared buffer.
  if (observed.lamports >= required) {
    return { result: 'SUFFICIENT', balanceContextSlot: observed.contextSlot }
  }
  return { result: 'INSUFFICIENT', balanceContextSlot: observed.contextSlot }
}

/**
 * The exact identity a compare-and-set mutation must present, advanced in step with
 * the journal. Mutable by design: each accepted write returns the next revision, and
 * presenting a stale one is a conflict rather than a merge.
 */
interface RedaxAttemptCursor {
  attemptNonce: string
  revision: number
}

/** What an action-specific readback concluded, and at what context. */
type RedaxEffectVerdict =
  | { readonly kind: 'MATCHING'; readonly contextSlot: number }
  | { readonly kind: 'NOT_MATCHING'; readonly contextSlot: number }
  | { readonly kind: 'UNAVAILABLE' }

const EFFECT_UNAVAILABLE: RedaxEffectVerdict = { kind: 'UNAVAILABLE' }

/**
 * The two action-specific questions the shared machinery asks, and nothing else.
 *
 * Keeping them behind this tiny interface is what lets one bounded recovery
 * algorithm serve both actions without either of them acquiring the other's notion
 * of "it worked".
 */
interface RedaxActionEffectProbe {
  /** Did the intended effect happen, exactly, at or above this floor? */
  readonly readEffectMatching: (minContextSlot: number) => Promise<RedaxEffectVerdict>
  /** Is there provably NO effect and no residue, at or above this floor? */
  readonly readNoEffect: (minContextSlot: number) => Promise<RedaxEffectVerdict>
  /**
   * May this action report a present effect it cannot attribute? Prepare may;
   * convert never can, and the journal itself refuses to record it for convert.
   */
  readonly allowsEffectPresentOriginUnknown: boolean
}

/**
 * Everything KNOWN-SIGNATURE resolution needs, and deliberately nothing more.
 *
 * THE ABSENT MEMBER IS THE POINT. `discoveryAddress` is HN2's — the bounded
 * signature-discovery pass exists for an invocation that returned no usable signature,
 * and it is the only thing in this file that could ever adopt an identity nobody
 * retained. A runtime that does not carry that address cannot be handed to
 * `runBoundedHn2Pass` or to `resolveSignatureless` AT ALL, so an operation built on
 * this narrower type is structurally incapable of discovery rather than merely
 * declining to perform it.
 *
 * This is what lets the explicit recovery reconciler reuse the exact terminal
 * semantics below instead of growing a second copy of them: the resolver never needed
 * the discovery address, and now it no longer asks for one.
 */
interface RedaxKnownSignatureRuntime {
  readonly ports: RedaxHolderActionPorts
  readonly connection: Connection
  readonly namespace: RedaxHolderRecoveryJournalNamespace
  readonly cursor: RedaxAttemptCursor
  readonly intendedMessage: RedaxIntendedLegacyMessageCommitmentV1
  readonly preflightFloor: number
  readonly lastValidBlockHeight: number
  readonly probe: RedaxActionEffectProbe
}

/**
 * Everything the shared post-invocation machinery needs about one ATTEMPT.
 *
 * The known-signature runtime plus the one HN2-only member. Every attempt satisfies
 * the narrower type, so nothing about the two Holder actions changes; only the
 * direction of the dependency does.
 */
interface RedaxAttemptRuntime extends RedaxKnownSignatureRuntime {
  readonly discoveryAddress: PublicKey
}

/**
 * One neutral post-invocation conclusion, before an action shapes it into its own
 * result.
 *
 * A DISCRIMINATED UNION, so success cannot be spelled without its evidence. The
 * `ok: true` arm requires the exact terminal observation, a non-null signature,
 * finality exactly `'finalized'` and a non-null effect context slot — all four, by
 * type. That is what makes the public success shapes constructible without a cast and
 * without synthesising a value: an outcome that cannot prove itself is simply not
 * expressible as a success, so no branch can accidentally emit one.
 */
type RedaxNeutralOutcome =
  | {
      readonly ok: true
      readonly observation: 'FINALIZED_EFFECT_MATCHING'
      readonly signature: string
      readonly finality: 'finalized'
      readonly contextSlot: number
    }
  | {
      readonly ok: false
      readonly observation: RedaxPrepareObservationCode
      readonly signature: string | null
      readonly finality: RedaxOutcomeFinality | null
      readonly contextSlot: number | null
    }

/** A non-success conclusion, carrying whatever is HONESTLY known and nothing more. */
function neutral(
  observation: RedaxPrepareObservationCode,
  signature: string | null,
  finality: RedaxOutcomeFinality | null,
  contextSlot: number | null,
): RedaxNeutralOutcome {
  return { ok: false, observation, signature, finality, contextSlot }
}

/**
 * The ONLY success constructor.
 *
 * It takes the signature and the effect-read context as required arguments and fixes
 * the observation and the finality itself, so every success arm in this file — direct
 * known signature, HN2 after a thrown transport, HN2 after an unusable return —
 * carries byte-identical evidence. Nothing here is synthesised: both values are
 * measured, and a caller that does not have them cannot call this.
 */
function neutralSuccess(signature: string, contextSlot: number): RedaxNeutralOutcome {
  return {
    ok: true,
    observation: 'FINALIZED_EFFECT_MATCHING',
    signature,
    finality: 'finalized',
    contextSlot,
  }
}

/**
 * The honestly-known evidence of one non-success outcome, as optional result fields.
 *
 * Every failure, provisional and support arm of both actions shapes its result
 * through THIS function, which is what makes the arms symmetric rather than
 * similar-looking. The asymmetry it removes was real: the unusable-return branches
 * dropped a known finality that their sibling throw branches carried, so two attempts
 * that reached the same conclusion by two signatureless routes reported it
 * differently. A null still stays absent — nothing is synthesised to fill a gap.
 */
function outcomeEvidence(outcome: Extract<RedaxNeutralOutcome, { ok: false }>): {
  signature?: string
  finality?: RedaxOutcomeFinality
  contextSlot?: number
} {
  return {
    ...(outcome.signature === null ? {} : { signature: outcome.signature }),
    ...(outcome.finality === null ? {} : { finality: outcome.finality }),
    ...(outcome.contextSlot === null ? {} : { contextSlot: outcome.contextSlot }),
  }
}

/** The three account identities a convert's terminal success reports. */
interface RedaxConvertLandedAccounts {
  readonly userLegacyAta: string
  readonly userOutputAta: string
  readonly protocolConfig: string
}

/**
 * Prepare's terminal success, and convert's, built from PROVEN evidence only.
 *
 * Both take the success arm of the neutral union, whose type already guarantees a
 * non-null signature, `finality: 'finalized'` and a non-null effect context slot. So
 * every success this file can emit — from all three arms of both actions — carries
 * exactly the same evidence, and neither function has anywhere to synthesise a value
 * from even if a later edit wanted to.
 */
function prepared(
  outcome: Extract<RedaxNeutralOutcome, { ok: true }>,
  userOutputAta: string,
): RedaxPrepareUserOutputAtaResult {
  return {
    ok: true,
    signature: outcome.signature,
    finality: outcome.finality,
    contextSlot: outcome.contextSlot,
    userOutputAta,
  }
}

function converted(
  outcome: Extract<RedaxNeutralOutcome, { ok: true }>,
  landed: RedaxConvertLandedAccounts,
): RedaxConvertExactInResult {
  return {
    ok: true,
    signature: outcome.signature,
    finality: outcome.finality,
    contextSlot: outcome.contextSlot,
    userLegacyAta: landed.userLegacyAta,
    userOutputAta: landed.userOutputAta,
    protocolConfig: landed.protocolConfig,
  }
}

/**
 * The wallet's IMMEDIATELY current key, or null — never an exception.
 *
 * The transport is expected to be the provider's own protected facade, but this is
 * the last read before the point of no return and it is also the seam a composed
 * executor is handed. A transport whose live read throws must enter the SAME typed
 * pre-invocation refusal path as one that reports a drifted key: nothing has been
 * invoked either way, so an exception escaping here would turn a clean refusal into a
 * rejected action promise with an unresolved journal slot behind it.
 */
function readLiveWalletKey(transport: RedaxWalletActionTransport): PublicKey | null {
  try {
    return transport.readCurrentPublicKey()
  } catch {
    return null
  }
}

// --- The signed wire artifact ------------------------------------------------------
//
// EVERYTHING BELOW READS BYTES. Nothing here compiles, recompiles, normalizes or
// reconstructs a message, and nothing here trusts a foreign object: the authority is
// the byte sequence the wallet actually signed, extracted from the signed wire itself.
//
// WHY THAT MATTERS, CONCRETELY. Two different legacy account-ordering algorithms exist
// in the installed stack, and the parsed-message reuse that normally avoids the second
// one is a cache condition rather than a guarantee. If the comparison message were
// regenerated by compiling anything, a difference between the two algorithms would look
// exactly like a wallet mutation — or, far worse, a real wallet mutation could be
// normalized away into a match. So the compiled message is never regenerated here, and
// the signature is verified against the bytes that were extracted, not against bytes
// that were rebuilt to resemble them.

/** The one signer this bounded Holder topology has: the approved connected wallet. */
const REDAX_HOLDER_REQUIRED_SIGNATURES = 1

/** An ed25519 signature, exactly. */
const REDAX_SIGNATURE_BYTES = 64

/** A public key, and a blockhash, are both exactly this wide on the wire. */
const REDAX_WIRE_KEY_BYTES = 32

/** A compact-u16 never spends more than three bytes, by construction. */
const REDAX_COMPACT_U16_MAX_BYTES = 3

/** A compact-u16 byte sets its high bit when another byte follows. */
const REDAX_COMPACT_U16_CONTINUATION = 0x80

/** Below this a compact-u16 value is one byte; from here up a second is required. */
const REDAX_COMPACT_U16_ONE_BYTE_LIMIT = 0x80

/** Below this a compact-u16 value is two bytes; from here up a third is required. */
const REDAX_COMPACT_U16_TWO_BYTE_LIMIT = 0x4000

/** The widest value a compact-u16 can carry at all. */
const REDAX_COMPACT_U16_MAX_VALUE = 0xffff

/** The message header: required signers, readonly signed, readonly unsigned. */
const REDAX_MESSAGE_HEADER_BYTES = 3

/** A versioned message sets the high bit of its first byte. A legacy one never does. */
const REDAX_MESSAGE_VERSION_FLAG = 0x80

/** One signature count, one signature, one header — below this nothing can parse. */
const REDAX_MIN_SIGNED_WIRE_BYTES =
  1 + REDAX_SIGNATURE_BYTES * REDAX_HOLDER_REQUIRED_SIGNATURES + REDAX_MESSAGE_HEADER_BYTES

/** The on-chain packet size. A wire above it could not be broadcast in any case. */
const REDAX_MAX_SIGNED_WIRE_BYTES = 1232

/** The exact algorithm the Holder signature is, named once. */
const REDAX_SIGNATURE_ALGORITHM = 'Ed25519'

/** Exact equality of two byte sequences. Length first, then every element. */
function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) {
    return false
  }
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false
    }
  }
  return true
}

/**
 * A signature slot the installed serializer fills with zeroes when nothing signed it.
 *
 * Serializing without requiring all signatures is what lets this file INSPECT a
 * partially signed artifact instead of having a foreign object throw on it — and the
 * placeholder that makes that possible must then be refused explicitly.
 */
function isPlaceholderSignature(signature: Uint8Array): boolean {
  for (const byte of signature) {
    if (byte !== 0) {
      return false
    }
  }
  return true
}

/**
 * The one canonical width of a compact-u16 value, derived from the value itself.
 *
 * A compact-u16 byte carries seven payload bits and sets its high bit when another
 * follows, so a value can be SPELLED more than one way: `01` and `81 00` both decode to
 * 1. Only the shortest spelling is its encoding. Every longer one is a different byte
 * sequence claiming the same meaning, and there is exactly one of the former.
 */
function canonicalCompactU16Length(value: number): number {
  if (value < REDAX_COMPACT_U16_ONE_BYTE_LIMIT) {
    return 1
  }
  return value < REDAX_COMPACT_U16_TWO_BYTE_LIMIT ? 2 : 3
}

/**
 * One compact-u16 at `offset`, with the offset just past it — or null.
 *
 * ONLY THE CANONICAL MINIMAL ENCODING IS READABLE, and that is a security property
 * rather than tidiness. The compact-u16 prefixes on this wire are NOT covered by the
 * Holder signature: a wallet can widen the outer signature count from `01` to `81 00`
 * and leave the 64-byte signature and the exact signed message bytes untouched. Such a
 * wire still carries a valid Ed25519 relation over the intended message, so message
 * attribution, byte equality and signature verification would all pass on a wire whose
 * bytes REDAX never approved — and the artifact that reached the node would not be the
 * artifact that was checked.
 *
 * The rule is stated as a length equality — decode safely, derive the canonical width
 * FROM THE DECODED VALUE, then require the consumed bytes to be exactly that — because
 * that is the whole property rather than a sample of it. "The last byte is non-zero"
 * would still admit `80 81 00` for 128.
 *
 * NOTHING IS REPAIRED HERE. An overlong spelling is refused, never rewritten into the
 * canonical one: this reads the wallet's wire and answers whether it can be read, and a
 * parser that normalized its input would be deciding what the wallet meant.
 */
function readCompactU16(bytes: Uint8Array, offset: number): { value: number; next: number } | null {
  let value = 0
  let shift = 0
  let cursor = offset
  for (let step = 0; step < REDAX_COMPACT_U16_MAX_BYTES; step += 1) {
    if (cursor >= bytes.length) {
      return null
    }
    const byte = bytes[cursor]
    cursor += 1
    value += (byte & 0x7f) * 2 ** shift
    if ((byte & REDAX_COMPACT_U16_CONTINUATION) === 0) {
      // The value bound is decided FIRST: above it there is no canonical width for the
      // comparison below to be against, and a three-byte overflow would otherwise match
      // the three-byte answer and be admitted.
      if (value > REDAX_COMPACT_U16_MAX_VALUE) {
        return null
      }
      return cursor - offset === canonicalCompactU16Length(value)
        ? { value, next: cursor }
        : null
    }
    shift += 7
  }
  // Still continuing after the third byte: an encoding this format cannot terminate.
  return null
}

/** The signed wire, split into exactly its two regions. Neither is reconstructed. */
interface RedaxSignedWire {
  readonly signature: Uint8Array
  readonly message: Uint8Array
}

/**
 * Split one signed legacy wire into its signature and its EXACT signed message bytes.
 *
 * The message region is taken directly from the wire — it is the byte range the
 * signature was computed over — so no second compilation exists to disagree with it.
 * `Uint8Array.prototype.slice` copies rather than viewing, unlike `Buffer`'s.
 */
function parseRedaxSignedWire(wire: Uint8Array): RedaxSignedWire | null {
  if (wire.length < REDAX_MIN_SIGNED_WIRE_BYTES || wire.length > REDAX_MAX_SIGNED_WIRE_BYTES) {
    return null
  }
  const count = readCompactU16(wire, 0)
  if (count === null || count.value !== REDAX_HOLDER_REQUIRED_SIGNATURES) {
    return null
  }
  const messageStart = count.next + REDAX_SIGNATURE_BYTES * count.value
  if (messageStart + REDAX_MESSAGE_HEADER_BYTES > wire.length) {
    return null
  }
  return {
    signature: wire.slice(count.next, messageStart),
    message: wire.slice(messageStart),
  }
}

/** One instruction, exactly as the wire carries it. */
interface RedaxWireInstruction {
  readonly programIdIndex: number
  readonly accountIndexes: Uint8Array
  readonly data: Uint8Array
}

/** One legacy message, structurally. Every field is a byte range, never a decoding. */
interface RedaxWireMessage {
  readonly requiredSignatures: number
  readonly readonlySigned: number
  readonly readonlyUnsigned: number
  readonly accountKeys: readonly Uint8Array[]
  readonly recentBlockhash: Uint8Array
  readonly instructions: readonly RedaxWireInstruction[]
}

/**
 * Read one legacy message's structure, or refuse.
 *
 * Every read is bounds-checked and the message must end EXACTLY where its last
 * instruction does: trailing bytes are a shape nobody decided on, and a parser that
 * ignored them could accept a message carrying something it never looked at.
 */
function parseRedaxWireMessage(message: Uint8Array): RedaxWireMessage | null {
  if (message.length < REDAX_MESSAGE_HEADER_BYTES) {
    return null
  }
  if ((message[0] & REDAX_MESSAGE_VERSION_FLAG) !== 0) {
    // A versioned message. Provably not the legacy message REDAX built.
    return null
  }
  const requiredSignatures = message[0]
  const readonlySigned = message[1]
  const readonlyUnsigned = message[2]

  const accountCount = readCompactU16(message, REDAX_MESSAGE_HEADER_BYTES)
  if (accountCount === null || accountCount.value === 0) {
    return null
  }
  let cursor = accountCount.next
  const accountKeys: Uint8Array[] = []
  for (let index = 0; index < accountCount.value; index += 1) {
    if (cursor + REDAX_WIRE_KEY_BYTES > message.length) {
      return null
    }
    accountKeys.push(message.slice(cursor, cursor + REDAX_WIRE_KEY_BYTES))
    cursor += REDAX_WIRE_KEY_BYTES
  }

  if (cursor + REDAX_WIRE_KEY_BYTES > message.length) {
    return null
  }
  const recentBlockhash = message.slice(cursor, cursor + REDAX_WIRE_KEY_BYTES)
  cursor += REDAX_WIRE_KEY_BYTES

  const instructionCount = readCompactU16(message, cursor)
  if (instructionCount === null) {
    return null
  }
  cursor = instructionCount.next
  const instructions: RedaxWireInstruction[] = []
  for (let index = 0; index < instructionCount.value; index += 1) {
    if (cursor >= message.length) {
      return null
    }
    const programIdIndex = message[cursor]
    cursor += 1
    const accountIndexCount = readCompactU16(message, cursor)
    if (accountIndexCount === null || accountIndexCount.next + accountIndexCount.value > message.length) {
      return null
    }
    const accountIndexes = message.slice(
      accountIndexCount.next,
      accountIndexCount.next + accountIndexCount.value,
    )
    cursor = accountIndexCount.next + accountIndexCount.value
    const dataLength = readCompactU16(message, cursor)
    if (dataLength === null || dataLength.next + dataLength.value > message.length) {
      return null
    }
    const data = message.slice(dataLength.next, dataLength.next + dataLength.value)
    cursor = dataLength.next + dataLength.value
    instructions.push({ programIdIndex, accountIndexes, data })
  }
  if (cursor !== message.length) {
    return null
  }
  return {
    requiredSignatures,
    readonlySigned,
    readonlyUnsigned,
    accountKeys,
    recentBlockhash,
    instructions,
  }
}

/**
 * Are two parsed legacy messages the SAME message, field by field?
 *
 * Written out rather than folded into the byte comparison, because the byte
 * comparison answers "are these identical" while this answers "and here is exactly
 * what would have differed": an added or removed instruction, a reordered account, a
 * changed payer, a changed blockhash, a rewritten instruction payload. Both run, and
 * neither substitutes for the other.
 */
function wireMessagesEqual(left: RedaxWireMessage, right: RedaxWireMessage): boolean {
  if (
    left.requiredSignatures !== right.requiredSignatures ||
    left.readonlySigned !== right.readonlySigned ||
    left.readonlyUnsigned !== right.readonlyUnsigned ||
    left.accountKeys.length !== right.accountKeys.length ||
    left.instructions.length !== right.instructions.length ||
    !bytesEqual(left.recentBlockhash, right.recentBlockhash)
  ) {
    return false
  }
  for (let index = 0; index < left.accountKeys.length; index += 1) {
    if (!bytesEqual(left.accountKeys[index], right.accountKeys[index])) {
      return false
    }
  }
  for (let index = 0; index < left.instructions.length; index += 1) {
    const one = left.instructions[index]
    const other = right.instructions[index]
    if (
      one.programIdIndex !== other.programIdIndex ||
      !bytesEqual(one.accountIndexes, other.accountIndexes) ||
      !bytesEqual(one.data, other.data)
    ) {
      return false
    }
  }
  return true
}

/**
 * Minimal structural view of the Web Crypto verification surface.
 *
 * Typed structurally so this module compiles identically under the app's DOM lib and
 * under the test runner's Node types, without importing either and without adding a
 * dependency. A platform that cannot perform this verification is UNAVAILABLE, which
 * withholds the broadcast — it never permits one.
 */
interface RedaxSubtleVerify {
  readonly subtle: {
    importKey(
      format: 'raw',
      keyData: Uint8Array,
      algorithm: string,
      extractable: boolean,
      keyUsages: readonly string[],
    ): Promise<unknown>
    verify(algorithm: string, key: unknown, signature: Uint8Array, data: Uint8Array): Promise<unknown>
  }
}

function resolveSignatureVerifier(): RedaxSubtleVerify | null {
  const candidate = (globalThis as { crypto?: unknown }).crypto
  if (typeof candidate !== 'object' || candidate === null) {
    return null
  }
  const subtle = (candidate as RedaxSubtleVerify).subtle
  if (
    typeof subtle !== 'object' ||
    subtle === null ||
    typeof subtle.importKey !== 'function' ||
    typeof subtle.verify !== 'function'
  ) {
    return null
  }
  return candidate as RedaxSubtleVerify
}

/** What a cryptographic check concluded. `UNAVAILABLE` is never a pass. */
type RedaxSignatureVerdict = 'VALID' | 'INVALID' | 'UNAVAILABLE'

/**
 * Verify the Holder signature against the EXACT extracted signed-message bytes.
 *
 * MANDATORY, not best-effort. Byte and digest equality establish that the bytes are
 * the approved ones; this establishes that those exact bytes are the ones the wallet
 * signed. If the emitted bytes were ever a recompilation rather than the signed
 * message, this fails closed and no broadcast happens.
 *
 * A non-boolean answer is not a pass: a platform that returns something else is one
 * this file does not understand, and not understanding is unavailability.
 */
async function verifyHolderSignature(
  publicKey: Uint8Array,
  signature: Uint8Array,
  message: Uint8Array,
): Promise<RedaxSignatureVerdict> {
  const verifier = resolveSignatureVerifier()
  if (verifier === null) {
    return 'UNAVAILABLE'
  }
  let key: unknown
  try {
    key = await verifier.subtle.importKey('raw', publicKey, REDAX_SIGNATURE_ALGORITHM, false, [
      'verify',
    ])
  } catch {
    return 'UNAVAILABLE'
  }
  let verified: unknown
  try {
    verified = await verifier.subtle.verify(REDAX_SIGNATURE_ALGORITHM, key, signature, message)
  } catch {
    return 'UNAVAILABLE'
  }
  if (typeof verified !== 'boolean') {
    return 'UNAVAILABLE'
  }
  return verified ? 'VALID' : 'INVALID'
}

/** The exact facts an attempt approved, against which one signed artifact is judged. */
interface RedaxApprovedArtifact {
  readonly wallet: PublicKey
  readonly intendedMessage: RedaxIntendedLegacyMessageCommitmentV1
  readonly intendedMessageBytes: Uint8Array
}

/**
 * One verified signed artifact — the ONLY thing that may reach a raw broadcast.
 *
 * `wire` is the attempt-local owned byte sequence, and `knownSignature` was derived
 * from it rather than learned from anybody. There is no arm carrying a partial
 * verdict: an artifact that cannot prove all of it is simply not one of these.
 */
type RedaxSignedArtifactVerdict =
  | { readonly ok: true; readonly wire: Uint8Array; readonly knownSignature: RedaxKnownSignature }
  | { readonly ok: false; readonly code: RedaxSignOnlyRefusalCode }

const SIGNED_ARTIFACT_MISMATCH: RedaxSignedArtifactVerdict = {
  ok: false,
  code: 'SIGNED_MESSAGE_MISMATCH',
}

/**
 * Freeze, read and verify one wallet-signed transaction — and derive its signature.
 *
 * THE ORDER IS THE ARGUMENT. Readability is decided first, so "unreadable" is only
 * ever said about something that really could not be parsed. Everything after that is
 * a PROVABLE difference and says so. Verification unavailability — a platform without
 * the primitive, a digest that could not be taken — is a third answer and is never
 * folded into either of the other two.
 *
 * NOTHING IS SERIALIZED HERE. The provider performed the one serialization; this
 * copies, slices and reads. No `Transaction` is constructed, compiled or touched.
 */
async function verifySignedArtifact(
  ports: RedaxHolderActionPorts,
  provided: Uint8Array,
  approved: RedaxApprovedArtifact,
): Promise<RedaxSignedArtifactVerdict> {
  // The attempt's own copy. Everything from here on is memory REDAX owns; the value
  // the provider handed over is never read again.
  const wire = Uint8Array.from(provided)

  const parsed = parseRedaxSignedWire(wire)
  if (parsed === null) {
    return { ok: false, code: 'SIGNED_TRANSACTION_UNREADABLE' }
  }
  const signed = parseRedaxWireMessage(parsed.message)
  if (signed === null) {
    // Unparseable OR versioned. A versioned message is a provable difference from the
    // legacy message REDAX committed to, and the byte comparison below would refuse it
    // anyway — but it must not be reported as an unreadable artifact.
    return (parsed.message[0] & REDAX_MESSAGE_VERSION_FLAG) !== 0
      ? SIGNED_ARTIFACT_MISMATCH
      : { ok: false, code: 'SIGNED_TRANSACTION_UNREADABLE' }
  }
  const intended = parseRedaxWireMessage(approved.intendedMessageBytes)
  if (intended === null) {
    // REDAX's own committed bytes did not parse. Nothing can be decided from that, and
    // an undecidable comparison must never be reported as a wallet mutation.
    return { ok: false, code: 'SIGNED_MESSAGE_VERIFICATION_UNAVAILABLE' }
  }

  // The bounded Holder topology: exactly one required signer, and it is the payer.
  if (signed.requiredSignatures !== REDAX_HOLDER_REQUIRED_SIGNATURES) {
    return SIGNED_ARTIFACT_MISMATCH
  }
  if (!bytesEqual(signed.accountKeys[0], approved.wallet.toBytes())) {
    return SIGNED_ARTIFACT_MISMATCH
  }
  // Exact size, then exact digest, then exact bytes, then exact structure. The first
  // three are the same identity asked three ways; the fourth is what names the
  // difference when there is one.
  if (parsed.message.length !== approved.intendedMessage.byteLength) {
    return SIGNED_ARTIFACT_MISMATCH
  }
  const actualCommitment = await ports.commitIntendedMessage(parsed.message)
  if (!actualCommitment.ok) {
    return { ok: false, code: 'SIGNED_MESSAGE_VERIFICATION_UNAVAILABLE' }
  }
  if (
    actualCommitment.commitment.byteLength !== approved.intendedMessage.byteLength ||
    actualCommitment.commitment.sha256Hex !== approved.intendedMessage.sha256Hex
  ) {
    return SIGNED_ARTIFACT_MISMATCH
  }
  if (!bytesEqual(parsed.message, approved.intendedMessageBytes)) {
    return SIGNED_ARTIFACT_MISMATCH
  }
  if (!wireMessagesEqual(signed, intended)) {
    return SIGNED_ARTIFACT_MISMATCH
  }

  if (isPlaceholderSignature(parsed.signature)) {
    return { ok: false, code: 'SIGNATURE_UNUSABLE' }
  }
  const verdict = await verifyHolderSignature(
    approved.wallet.toBytes(),
    parsed.signature,
    parsed.message,
  )
  if (verdict === 'UNAVAILABLE') {
    return { ok: false, code: 'SIGNED_MESSAGE_VERIFICATION_UNAVAILABLE' }
  }
  if (verdict === 'INVALID') {
    return { ok: false, code: 'SIGNATURE_UNUSABLE' }
  }

  // The transaction's identity, derived from the artifact rather than learned from a
  // node. Nothing normalizes it and nothing guesses it.
  let signatureText: string
  try {
    signatureText = bs58.encode(parsed.signature)
  } catch {
    return { ok: false, code: 'SIGNATURE_UNUSABLE' }
  }
  const retained = ports.retainSignature(signatureText)
  if (!retained.ok) {
    return { ok: false, code: 'SIGNATURE_UNUSABLE' }
  }
  return { ok: true, wire, knownSignature: retained.knownSignature }
}

/**
 * Narrow a neutral observation to convert's vocabulary, without a cast.
 *
 * `EFFECT_PRESENT_ORIGIN_UNKNOWN` is unreachable for a convert — its probe declares
 * `allowsEffectPresentOriginUnknown: false`, and the journal refuses to record the
 * observation for a convert at all — but the mapping is written out rather than
 * asserted away, so the impossibility is enforced by the compiler instead of by a
 * comment.
 */
function convertObservation(observation: RedaxPrepareObservationCode): RedaxHolderObservationCode {
  return observation === 'EFFECT_PRESENT_ORIGIN_UNKNOWN' ? 'SUPPORT_ONLY' : observation
}

/**
 * Apply one journal transition under exact compare-and-set, and advance the cursor.
 *
 * A `true` return is READ-VERIFIED: the journal writes, reads back and compares the
 * canonical bytes before reporting success, so there is no separate verification step
 * for this file to forget. A `false` return means the record did NOT move, and every
 * caller below treats that as blocking rather than as something to work around.
 */
async function applyJournalTransition(
  runtime: RedaxKnownSignatureRuntime,
  transition: RedaxHolderRecoveryTransition,
): Promise<boolean> {
  const result = await runtime.ports.transitionAttempt({
    namespace: runtime.namespace,
    expectedAttemptNonce: runtime.cursor.attemptNonce,
    expectedRevision: runtime.cursor.revision,
    transition,
  })
  if (!result.ok) {
    return false
  }
  runtime.cursor.attemptNonce = result.record.attemptNonce
  runtime.cursor.revision = result.record.revision
  return true
}

/** Record an observation. A failure to record never invents a better outcome. */
async function recordObservation(
  runtime: RedaxKnownSignatureRuntime,
  observation: RedaxHolderRecoveryJournalObservation,
  finality: RedaxHolderRecoveryOutcomeFinality | null,
): Promise<boolean> {
  return applyJournalTransition(runtime, {
    type: 'RECORD_OBSERVATION',
    observation,
    outcomeFinality: finality,
  })
}

// --- HN2: bounded, explicit, internal signature recovery -------------------------
//
// HN2 exists for exactly one situation: the transport was invoked and no usable
// signature came back. The chain may still know the answer, and the address the
// action touches is the only handle left.
//
// It is NOT a history feature. One page, twenty-five records, no `before`, no
// `until`, no pagination, no automatic repetition, no polling, and the page itself is
// never logged, rendered, returned or persisted. Only an ADOPTED exact signature ever
// leaves this function.
//
// Worst case for one explicit pass: 1 discovery read + up to 25 × (blockheight +
// status + transaction) + at most 1 final effect snapshot = 77 app-owned reads.
// Wallet and provider internal RPC lies outside this census and is NOT claimed
// bounded.

/** What one bounded pass concluded. `NONE` means nothing qualified — never "it did not land". */
type RedaxHn2Disposition =
  | {
      readonly kind: 'ADOPTED'
      readonly signature: RedaxKnownSignature
      readonly outcome: RedaxKnownSignatureOutcome
      readonly candidateClass: 'SUCCESS' | 'FAILURE'
      readonly effectContextSlot: number
    }
  | { readonly kind: 'NONE' }
  | { readonly kind: 'SUPPORT_ONLY' }
  | { readonly kind: 'READ_UNAVAILABLE' }

/** One discovery record, reduced to the exact facts a coherence check needs. */
interface RedaxHn2Candidate {
  readonly signature: string
  readonly slot: number
  readonly finalityText: string | null
  readonly hasError: boolean
}

function readCandidateProperty(source: unknown, key: string): { ok: boolean; value: unknown } {
  if (typeof source !== 'object' || source === null) {
    return { ok: false, value: undefined }
  }
  try {
    return { ok: true, value: Reflect.get(source, key) }
  } catch {
    return { ok: false, value: undefined }
  }
}

/**
 * The `err` member of one untrusted discovery record, as a CATEGORY and never a value.
 *
 * `err` is a REQUIRED, structurally present, nullable member. The four cases are
 * distinct on purpose:
 *
 *   * the property is ABSENT — malformed. The previous reading treated an absent
 *     member as null-like, which silently promoted "this record does not say" into
 *     "this record says there was no error";
 *   * the property is present but `undefined` — malformed, for the same reason;
 *   * reading it THROWS — malformed; a hostile accessor is not evidence;
 *   * the property is exactly `null` — the sole clean discovery fact;
 *   * anything else — an error is present. Only that Boolean survives.
 */
function readCandidateErrorFact(
  entry: unknown,
): { readonly ok: true; readonly hasError: boolean } | { readonly ok: false } {
  if (typeof entry !== 'object' || entry === null) {
    return { ok: false }
  }
  let present: boolean
  try {
    present = Object.prototype.hasOwnProperty.call(entry, 'err')
  } catch {
    return { ok: false }
  }
  if (!present) {
    return { ok: false }
  }
  const read = readCandidateProperty(entry, 'err')
  if (!read.ok || read.value === undefined) {
    return { ok: false }
  }
  return { ok: true, hasError: read.value !== null }
}

/**
 * Reduce one untrusted discovery record, or refuse.
 *
 * A record whose signature, slot or `err` cannot be read is not a record this pass
 * can reason about, and a pass that silently skipped it could conclude "nothing
 * qualified" while a qualifying transaction sat in the part it could not read. Every
 * refusal here becomes `READ_UNAVAILABLE` at the caller — never an empty page.
 */
function readHn2Candidate(entry: unknown): RedaxHn2Candidate | null {
  const signature = readCandidateProperty(entry, 'signature')
  if (!signature.ok || typeof signature.value !== 'string' || signature.value.trim() === '') {
    return null
  }
  const slot = readCandidateProperty(entry, 'slot')
  if (!slot.ok || typeof slot.value !== 'number' || !Number.isSafeInteger(slot.value) || slot.value < 0) {
    return null
  }
  const finality = readCandidateProperty(entry, 'confirmationStatus')
  const error = readCandidateErrorFact(entry)
  if (!error.ok) {
    return null
  }
  return {
    signature: signature.value,
    slot: slot.value,
    finalityText:
      finality.ok && typeof finality.value === 'string' ? finality.value : null,
    // Read, but NEVER used to pre-filter: a discovery record's `err` is not the
    // outcome authority, and skipping a record because of it would hide exactly the
    // failed transaction a no-effect proof needs to find.
    hasError: error.hasError,
  }
}

/**
 * Two records for one signature agree only if every fact they expose agrees — and a
 * pair in which EITHER record carries an error never agrees at all.
 *
 * That is the strict bounded rule, and it is deliberately stronger than equality on
 * the Boolean. Two non-null `err` values are two distinct error facts reduced to one
 * bit; proving they describe the same failure would mean retaining and comparing the
 * raw payloads, which this pass will not do. A null paired with a non-null is a plain
 * contradiction. Either way the page has stopped being coherent, and an incoherent
 * page resolves to SUPPORT_ONLY rather than to a collapsed "duplicate".
 */
function coherentDuplicate(left: RedaxHn2Candidate, right: RedaxHn2Candidate): boolean {
  if (left.hasError || right.hasError) {
    return false
  }
  return left.slot === right.slot && left.finalityText === right.finalityText
}

async function runBoundedHn2Pass(runtime: RedaxAttemptRuntime): Promise<RedaxHn2Disposition> {
  let page: unknown
  try {
    page = await runtime.ports.listSignaturesForAddress(runtime.connection, runtime.discoveryAddress, {
      limit: REDAX_HN2_DISCOVERY_LIMIT,
      minContextSlot: runtime.preflightFloor,
    })
  } catch {
    return { kind: 'READ_UNAVAILABLE' }
  }
  if (!Array.isArray(page)) {
    return { kind: 'READ_UNAVAILABLE' }
  }
  if (page.length > REDAX_HN2_DISCOVERY_LIMIT) {
    // More than one page's worth is not something this bounded pass asked for.
    return { kind: 'READ_UNAVAILABLE' }
  }

  const distinct: RedaxHn2Candidate[] = []
  for (const entry of page) {
    const candidate = readHn2Candidate(entry)
    if (candidate === null) {
      return { kind: 'READ_UNAVAILABLE' }
    }
    // The request-level `minContextSlot` protects request EVALUATION. This rejects a
    // stale RECORD. The two are separate protections and both are mandatory.
    if (candidate.slot < runtime.preflightFloor) {
      continue
    }
    const existing = distinct.find((other) => other.signature === candidate.signature)
    if (existing === undefined) {
      distinct.push(candidate)
      continue
    }
    if (!coherentDuplicate(existing, candidate)) {
      // The same signature described two different ways is not a duplicate to
      // collapse; it is a reason to stop trusting the page.
      return { kind: 'SUPPORT_ONLY' }
    }
  }

  let qualifying: {
    readonly signature: RedaxKnownSignature
    readonly outcome: RedaxKnownSignatureOutcome
    readonly candidateClass: 'SUCCESS' | 'FAILURE'
  } | null = null

  for (const candidate of distinct) {
    const retained = runtime.ports.retainSignature(candidate.signature)
    if (!retained.ok) {
      return { kind: 'READ_UNAVAILABLE' }
    }
    const outcome = await runtime.ports.observeOutcome(runtime.connection, {
      signature: retained.knownSignature,
      intendedMessage: runtime.intendedMessage,
      minimumContextSlot: runtime.preflightFloor,
      lastValidBlockHeight: runtime.lastValidBlockHeight,
    })
    if (outcome.kind === 'READ_UNAVAILABLE') {
      // A read failure before uniqueness is established makes the whole pass
      // inconclusive. Adopting from a partially readable set could adopt the second
      // best candidate.
      return { kind: 'READ_UNAVAILABLE' }
    }
    // A merely CONFIRMED candidate is never durably adopted: a confirmed block can
    // still be reorganised, and adoption is permanent.
    const candidateClass: 'SUCCESS' | 'FAILURE' | null =
      outcome.kind === 'FINALIZED_MESSAGE_META_MATCHING'
        ? 'SUCCESS'
        : outcome.kind === 'LANDED_TRANSACTION_FAILED' && outcome.finality === 'finalized'
          ? 'FAILURE'
          : null
    if (candidateClass === null) {
      continue
    }
    if (qualifying !== null) {
      // A second distinct qualifying candidate has made uniqueness impossible. There
      // is nothing further to learn from the rest of the page.
      return { kind: 'SUPPORT_ONLY' }
    }
    qualifying = { signature: retained.knownSignature, outcome, candidateClass }
  }

  if (qualifying === null) {
    return { kind: 'NONE' }
  }

  // Exactly one qualifying candidate: ONE final action-specific snapshot decides
  // whether it may be adopted. A finalized transaction that did not produce the
  // exact effect is not this attempt's success, and a finalized failure that left
  // residue is not a clean no-effect.
  const transactionSlot = qualifying.outcome.transactionSlot
  const floor = Math.max(
    runtime.preflightFloor,
    transactionSlot === null ? runtime.preflightFloor : transactionSlot,
  )
  const verdict =
    qualifying.candidateClass === 'SUCCESS'
      ? await runtime.probe.readEffectMatching(floor)
      : await runtime.probe.readNoEffect(floor)
  if (verdict.kind === 'UNAVAILABLE') {
    return { kind: 'READ_UNAVAILABLE' }
  }
  if (verdict.kind === 'NOT_MATCHING') {
    return { kind: 'SUPPORT_ONLY' }
  }
  return {
    kind: 'ADOPTED',
    signature: qualifying.signature,
    outcome: qualifying.outcome,
    candidateClass: qualifying.candidateClass,
    effectContextSlot: verdict.contextSlot,
  }
}

// --- Known-signature resolution --------------------------------------------------

/**
 * `signaturePersisted` is load-bearing. When the retention write did not become
 * durable the signature is still known IN MEMORY and is still carried on the result —
 * discarding it would be the one unforgivable move — but no further durable claim may
 * be made from it, so this path observes read-only and returns support.
 *
 * IT TAKES THE NARROW RUNTIME. This is the one function the explicit recovery
 * reconciler reuses, and it is reused rather than duplicated: a second copy of these
 * terminal rules is exactly how a liveness repair turns into a safety regression. The
 * narrower parameter is what makes that reuse safe — the reconciler cannot reach HN2
 * through a runtime that has no discovery address on it.
 */
async function resolveKnownSignature(
  runtime: RedaxKnownSignatureRuntime,
  signature: RedaxKnownSignature,
  signaturePersisted: boolean,
): Promise<RedaxNeutralOutcome> {
  const outcome = await runtime.ports.observeOutcome(runtime.connection, {
    signature,
    intendedMessage: runtime.intendedMessage,
    minimumContextSlot: runtime.preflightFloor,
    lastValidBlockHeight: runtime.lastValidBlockHeight,
  })

  if (!signaturePersisted) {
    return neutral(
      outcome.kind === 'READ_UNAVAILABLE' ? 'READ_UNAVAILABLE' : 'SUPPORT_ONLY',
      signature,
      outcome.finality,
      outcome.statusContextSlot,
    )
  }

  switch (outcome.kind) {
    case 'CONFIRMATION_PENDING':
    case 'TRANSACTION_NOT_YET_READABLE': {
      // The status is not settled, or it is settled and the transaction is not
      // readable yet. Both are pending; neither is a failure and neither is a licence
      // to do anything.
      await recordObservation(runtime, 'CONFIRMATION_PENDING', outcome.finality)
      return neutral('CONFIRMATION_PENDING', signature, outcome.finality, outcome.statusContextSlot)
    }

    case 'READ_UNAVAILABLE': {
      await recordObservation(runtime, 'READ_UNAVAILABLE', null)
      return neutral('READ_UNAVAILABLE', signature, outcome.finality, outcome.statusContextSlot)
    }

    case 'LANDED_MESSAGE_MISMATCH': {
      // Something landed under this signature that is NOT the approved message. It is
      // recorded, and it is never resolved as this attempt's success or failure —
      // attributing another transaction's outcome would be the worst kind of wrong.
      await recordObservation(runtime, 'LANDED_MESSAGE_MISMATCH', outcome.finality)
      return neutral('LANDED_MESSAGE_MISMATCH', signature, outcome.finality, outcome.transactionSlot)
    }

    case 'LANDED_TRANSACTION_FAILED': {
      if (outcome.finality !== 'finalized') {
        // A confirmed failure is still provisional. Record it; resolve nothing.
        await recordObservation(runtime, 'LANDED_TRANSACTION_FAILED', outcome.finality)
        return neutral(
          'LANDED_TRANSACTION_FAILED',
          signature,
          outcome.finality,
          outcome.transactionSlot,
        )
      }
      const floor = Math.max(
        runtime.preflightFloor,
        outcome.transactionSlot === null ? runtime.preflightFloor : outcome.transactionSlot,
      )
      const noEffect = await runtime.probe.readNoEffect(floor)
      if (noEffect.kind === 'UNAVAILABLE') {
        await recordObservation(runtime, 'READ_UNAVAILABLE', null)
        return neutral('READ_UNAVAILABLE', signature, outcome.finality, outcome.transactionSlot)
      }
      if (noEffect.kind === 'NOT_MATCHING') {
        // Finalized-failed, yet something moved. That contradiction is support's, not
        // this file's, and it is certainly not a resolution.
        await recordObservation(runtime, 'SUPPORT_ONLY', null)
        return neutral('SUPPORT_ONLY', signature, outcome.finality, noEffect.contextSlot)
      }
      const recorded = await recordObservation(runtime, 'LANDED_TRANSACTION_FAILED', 'finalized')
      if (!recorded) {
        return neutral('SUPPORT_ONLY', signature, outcome.finality, noEffect.contextSlot)
      }
      const resolved = await applyJournalTransition(runtime, {
        type: 'RESOLVE_KNOWN_SIGNATURE_FAILURE',
      })
      if (!resolved) {
        return neutral('SUPPORT_ONLY', signature, outcome.finality, noEffect.contextSlot)
      }
      // Terminal, and resolved. A further attempt is a later, explicit human decision
      // — nothing here offers or performs one.
      return neutral(
        'LANDED_TRANSACTION_FAILED',
        signature,
        outcome.finality,
        outcome.transactionSlot,
      )
    }

    case 'CONFIRMED_MESSAGE_META_MATCHING': {
      const floor = Math.max(
        runtime.preflightFloor,
        outcome.transactionSlot === null ? runtime.preflightFloor : outcome.transactionSlot,
      )
      const effect = await runtime.probe.readEffectMatching(floor)
      if (effect.kind === 'UNAVAILABLE') {
        await recordObservation(runtime, 'READ_UNAVAILABLE', null)
        return neutral('READ_UNAVAILABLE', signature, outcome.finality, outcome.transactionSlot)
      }
      if (effect.kind === 'NOT_MATCHING') {
        await recordObservation(runtime, 'SUPPORT_ONLY', null)
        return neutral('SUPPORT_ONLY', signature, outcome.finality, effect.contextSlot)
      }
      // The approved message landed cleanly AND the exact effect is visible — but
      // confirmed is PROVISIONAL. This is not success.
      await recordObservation(runtime, 'CONFIRMED_EFFECT_MATCHING', 'confirmed')
      return neutral('CONFIRMED_EFFECT_MATCHING', signature, outcome.finality, effect.contextSlot)
    }

    case 'FINALIZED_MESSAGE_META_MATCHING': {
      if (outcome.transactionSlot === null || outcome.transactionSlot < runtime.preflightFloor) {
        // A finalized transaction below the accepted preflight floor cannot be this
        // attempt: the attempt did not exist yet at that slot.
        await recordObservation(runtime, 'SUPPORT_ONLY', null)
        return neutral('SUPPORT_ONLY', signature, outcome.finality, outcome.transactionSlot)
      }
      const floor = Math.max(runtime.preflightFloor, outcome.transactionSlot)
      const effect = await runtime.probe.readEffectMatching(floor)
      if (effect.kind === 'UNAVAILABLE') {
        await recordObservation(runtime, 'READ_UNAVAILABLE', null)
        return neutral('READ_UNAVAILABLE', signature, outcome.finality, outcome.transactionSlot)
      }
      if (effect.kind === 'NOT_MATCHING') {
        await recordObservation(runtime, 'SUPPORT_ONLY', null)
        return neutral('SUPPORT_ONLY', signature, outcome.finality, effect.contextSlot)
      }
      const recorded = await recordObservation(runtime, 'FINALIZED_EFFECT_MATCHING', 'finalized')
      if (!recorded) {
        // The chain effect may well be real, but the durable record does not say so.
        // Reporting success on a record that could not be written would leave the slot
        // in a state a later session cannot reconcile.
        return neutral('SUPPORT_ONLY', signature, outcome.finality, effect.contextSlot)
      }
      const resolved = await applyJournalTransition(runtime, { type: 'RESOLVE_FINALIZED_SUCCESS' })
      if (!resolved) {
        return neutral('SUPPORT_ONLY', signature, outcome.finality, effect.contextSlot)
      }
      return neutralSuccess(signature, effect.contextSlot)
    }
  }
}

/**
 * Adopt exactly one HN2-discovered signature into the durable record.
 *
 * Retention comes first, because a signature nobody wrote down is a signature that
 * will be lost. Only after it is retained is the qualified outcome recorded and, when
 * proven, resolved.
 */
async function adoptHn2Signature(
  runtime: RedaxAttemptRuntime,
  disposition: Extract<RedaxHn2Disposition, { kind: 'ADOPTED' }>,
): Promise<RedaxNeutralOutcome> {
  const retained = await applyJournalTransition(runtime, {
    type: 'RETAIN_KNOWN_SIGNATURE',
    knownSignature: disposition.signature,
  })
  if (!retained) {
    return neutral(
      'SUPPORT_ONLY',
      disposition.signature,
      disposition.outcome.finality,
      disposition.effectContextSlot,
    )
  }
  if (disposition.candidateClass === 'SUCCESS') {
    const recorded = await recordObservation(runtime, 'FINALIZED_EFFECT_MATCHING', 'finalized')
    if (!recorded) {
      return neutral('SUPPORT_ONLY', disposition.signature, 'finalized', disposition.effectContextSlot)
    }
    const resolved = await applyJournalTransition(runtime, { type: 'RESOLVE_FINALIZED_SUCCESS' })
    if (!resolved) {
      return neutral('SUPPORT_ONLY', disposition.signature, 'finalized', disposition.effectContextSlot)
    }
    return neutralSuccess(disposition.signature, disposition.effectContextSlot)
  }
  const recorded = await recordObservation(runtime, 'LANDED_TRANSACTION_FAILED', 'finalized')
  if (!recorded) {
    return neutral('SUPPORT_ONLY', disposition.signature, 'finalized', disposition.effectContextSlot)
  }
  const resolved = await applyJournalTransition(runtime, { type: 'RESOLVE_KNOWN_SIGNATURE_FAILURE' })
  if (!resolved) {
    return neutral('SUPPORT_ONLY', disposition.signature, 'finalized', disposition.effectContextSlot)
  }
  return neutral(
    'LANDED_TRANSACTION_FAILED',
    disposition.signature,
    'finalized',
    disposition.effectContextSlot,
  )
}

/**
 * The path taken when the transport threw, or returned something unusable.
 *
 * NOTHING about the thrown value is inspected. Not its code, name, message, cause,
 * stack, shape or stringification, and no wallet-specific keyword. A provider may
 * broadcast and then throw before returning a signature, so a throw is not evidence
 * of non-broadcast — and pretending otherwise is precisely how a duplicate send gets
 * offered to a holder.
 *
 * The durable marker already records
 * `SUBMISSION_OUTCOME_UNKNOWN_WITHOUT_SIGNATURE`. At most ONE bounded HN2 pass runs
 * from here, and only from this explicit invocation.
 */
async function resolveSignatureless(runtime: RedaxAttemptRuntime): Promise<RedaxNeutralOutcome> {
  const disposition = await runBoundedHn2Pass(runtime)

  if (disposition.kind === 'ADOPTED') {
    return adoptHn2Signature(runtime, disposition)
  }
  if (disposition.kind === 'SUPPORT_ONLY') {
    await recordObservation(runtime, 'SUPPORT_ONLY', null)
    return neutral('SUPPORT_ONLY', null, null, null)
  }
  if (disposition.kind === 'READ_UNAVAILABLE') {
    await recordObservation(runtime, 'READ_UNAVAILABLE', null)
    return neutral('READ_UNAVAILABLE', null, null, null)
  }

  // Zero qualifying candidates. That is NOT evidence that nothing landed — only that
  // nothing this bounded pass could see qualified.
  if (runtime.probe.allowsEffectPresentOriginUnknown) {
    const present = await runtime.probe.readEffectMatching(runtime.preflightFloor)
    if (present.kind === 'MATCHING') {
      // The account is there. The attempt may or may not have put it there, and no
      // second prepare is offered either way.
      const recorded = await recordObservation(runtime, 'EFFECT_PRESENT_ORIGIN_UNKNOWN', null)
      if (recorded) {
        return neutral('EFFECT_PRESENT_ORIGIN_UNKNOWN', null, null, present.contextSlot)
      }
      return neutral('SUPPORT_ONLY', null, null, present.contextSlot)
    }
    if (present.kind === 'UNAVAILABLE') {
      await recordObservation(runtime, 'READ_UNAVAILABLE', null)
      return neutral('READ_UNAVAILABLE', null, null, null)
    }
  }

  // The marker's own observation still stands, and it is the truthful one.
  return neutral('SUBMISSION_OUTCOME_UNKNOWN_WITHOUT_SIGNATURE', null, null, null)
}

// --- Shared pre-invocation helpers ------------------------------------------------

/** What the advisory journal read concluded about starting a fresh attempt. */
type RedaxJournalStartVerdict =
  | { readonly ok: true; readonly replaces: { attemptNonce: string; revision: number } | null }
  | { readonly ok: false; readonly code: 'ATTEMPT_BLOCKED' | 'JOURNAL_UNAVAILABLE' }

/**
 * Look at the one attempt slot BEFORE anything else happens.
 *
 * This read is ADVISORY and never authorizes sending. It exists because the locked
 * begin operation is a compare-and-set: it needs the exact identity of a replaceable
 * tombstone, or an explicit `null`, and there is no way to supply either without
 * looking first. The authoritative exclusion decision is still made under the
 * exclusive lock inside `begin`.
 */
async function readJournalStartVerdict(
  ports: RedaxHolderActionPorts,
  namespace: RedaxHolderRecoveryJournalNamespace,
): Promise<RedaxJournalStartVerdict> {
  const read = await ports.readJournal(namespace)
  if (!read.ok) {
    // Corrupt, incompatible, storage- or lock-unavailable, deleted, rolled back: all
    // fail closed. A damaged record might be the only evidence that something was
    // sent, and it is never overwritten to make room.
    return { ok: false, code: 'JOURNAL_UNAVAILABLE' }
  }
  if (read.kind === 'EMPTY') {
    return { ok: true, replaces: null }
  }
  if (read.kind === 'ACTIVE') {
    // One wallet, one program, one unresolved attempt. A prepare in flight blocks a
    // convert and vice versa — that is the entire point of the slot.
    return { ok: false, code: 'ATTEMPT_BLOCKED' }
  }
  const resolution = read.record.resolution
  if (
    resolution === 'PRE_INVOCATION_REFUSAL' ||
    resolution === 'FINALIZED_SUCCESS' ||
    resolution === 'ACCEPTED_RESOLVED_KNOWN_SIGNATURE_FAILURE'
  ) {
    return {
      ok: true,
      replaces: { attemptNonce: read.record.attemptNonce, revision: read.record.revision },
    }
  }
  // An acknowledged support disposition is permanent. Acknowledging that an attempt
  // is unresolved never made it resolved, and it is not a licence to start another.
  return { ok: false, code: 'ATTEMPT_BLOCKED' }
}

/**
 * A Phase-B refusal happens strictly BEFORE invocation, so nothing was sent — but
 * saying so out loud requires proving the record really did close that way.
 *
 * Only a read-verified pre-invocation-refusal tombstone earns `PREFLIGHT_REFUSED`.
 * Anything else stays support: an unverified claim that nothing happened is exactly
 * the claim this whole route exists to stop making.
 */
async function resolvePreInvocationRefusal(
  runtime: RedaxAttemptRuntime,
): Promise<'PREFLIGHT_REFUSED' | 'SUPPORT_ONLY'> {
  const resolved = await applyJournalTransition(runtime, {
    type: 'RESOLVE_PRE_INVOCATION_REFUSAL',
  })
  return resolved ? 'PREFLIGHT_REFUSED' : 'SUPPORT_ONLY'
}

/**
 * The marker transition failed. Nothing may be invoked, and nothing may be assumed.
 *
 * A second journal write is NOT assumed to succeed either, so the record is re-read
 * once and the decision is made from what it actually says. Only a record that is
 * verifiably still `PRE_INVOCATION` and still ours may be closed as a refusal; every
 * ambiguous, moved, unreadable or conflicted state stays blocking. No loop, no clear,
 * no reset, no retry.
 */
async function handleMarkerFailure(
  runtime: RedaxAttemptRuntime,
): Promise<'PREFLIGHT_REFUSED' | 'SUPPORT_ONLY' | 'READ_UNAVAILABLE'> {
  const reread = await runtime.ports.readJournal(runtime.namespace)
  if (!reread.ok) {
    return 'READ_UNAVAILABLE'
  }
  if (reread.kind === 'EMPTY') {
    // The slot we wrote is not there. That is less knowable, not more.
    return 'SUPPORT_ONLY'
  }
  const record = reread.record
  if (
    record.attemptNonce !== runtime.cursor.attemptNonce ||
    record.lifecycle !== 'PRE_INVOCATION'
  ) {
    // Either the marker persisted after all, or somebody else owns the slot now.
    // Neither permits a claim that the invocation never started.
    return 'SUPPORT_ONLY'
  }
  runtime.cursor.revision = record.revision
  return resolvePreInvocationRefusal(runtime)
}

/**
 * Close one PRE-BROADCAST sign-only refusal, as precisely as the record allows.
 *
 * Every one of these codes is a claim that REDAX did not broadcast, and that claim is
 * only earned once the pre-invocation tombstone is written AND read back. When it is
 * not, the honest answer is the support disposition — an unverified claim that nothing
 * happened is exactly the claim this whole route exists to stop making.
 *
 * This runs strictly before `MARK_INVOCATION_STARTED`, so the record really is still
 * `PRE_INVOCATION` and the refusal transition really is the right one.
 */
async function resolveSignOnlyRefusal(
  runtime: RedaxAttemptRuntime,
  code: RedaxSignOnlyRefusalCode,
): Promise<RedaxSignOnlyRefusalCode | 'SUPPORT_ONLY'> {
  const observation = await resolvePreInvocationRefusal(runtime)
  return observation === 'PREFLIGHT_REFUSED' ? code : 'SUPPORT_ONLY'
}

/**
 * Reconcile one attempt whose raw broadcast has already been invoked.
 *
 * Under the sign-only architecture the exact signature is derived from the verified
 * signed artifact, read-verified into the durable record and only THEN broadcast — so
 * `knownSignature` is never null at either Holder call site, and the bounded
 * signatureless discovery arm is not reached from them. A raw-send throw no longer
 * produces a signatureless ambiguity at all: the identity is already known and already
 * persisted, so it is reconciled rather than searched for.
 *
 * The discovery arm is retained, and retained reachable, because it answers a question
 * this module must still be able to answer — "a broadcast happened and its signature
 * was never learned" — and removing a bounded, owner-pinned capability is not a repair
 * decision to make in passing.
 */
async function resolveBroadcastOutcome(
  runtime: RedaxAttemptRuntime,
  knownSignature: RedaxKnownSignature | null,
): Promise<RedaxNeutralOutcome> {
  if (knownSignature === null) {
    return resolveSignatureless(runtime)
  }
  // Persisted is TRUE by construction: the retention is read-verified before the
  // irreversible act, and a retention that did not read back never reaches a broadcast.
  return resolveKnownSignature(runtime, knownSignature, true)
}

// --- Prepare -----------------------------------------------------------------------

/**
 * Compose the `prepare_user_output_ata` action.
 *
 * The whole order below is load-bearing and is not a style choice — see the module
 * header. Every step that can refuse, refuses before the one irreversible step.
 */
export function createRedaxPrepareUserOutputAtaAction(
  deps: RedaxHolderActionDeps,
): (
  request: RedaxPrepareUserOutputAtaRequest,
  onPhase?: (phase: RedaxWalletActionPhase) => void,
) => Promise<RedaxPrepareUserOutputAtaResult> {
  const ports = deps.ports ?? REDAX_PRODUCTION_HOLDER_ACTION_PORTS

  const fail = (
    code: RedaxPrepareFailureCode,
    extra?: { signature?: string; finality?: RedaxOutcomeFinality; contextSlot?: number; userOutputAta?: string },
  ): RedaxPrepareUserOutputAtaResult => ({
    ok: false,
    code,
    message: PREPARE_MESSAGE[code],
    ...(extra ?? {}),
  })

  return async function prepareUserOutputAta(request, onPhase) {
    // 1. A valid DEVNET_TX_ENABLED runtime config.
    const runtimeConfig = deps.runtimeConfig
    if (runtimeConfig === null) {
      return fail(deps.runtimeConfigCode === 'NOT_DEVNET_TX_MODE' ? 'WRONG_MODE' : 'RUNTIME_CONFIG_UNAVAILABLE')
    }
    // 2. A connected transport, and the attempt's INITIAL wallet identity.
    const wallet = deps.transport.publicKey
    if (!deps.transport.isConnected || wallet === null) {
      return fail('WALLET_NOT_CONNECTED')
    }
    // 2b. SIGN-ONLY CAPABILITY, before anything else happens. Asked here so a wallet
    //     that cannot sign on its own is refused with nothing behind it: no chain read,
    //     no attempt slot, no journal record and — above all — no wallet prompt. There
    //     is deliberately nothing to fall back to.
    if (!deps.transport.canSignOnly) {
      return fail('WALLET_SIGN_ONLY_UNAVAILABLE')
    }
    // 3. Strict identity parsing, before anything is read or built.
    let campaign: PublicKey
    let outputMint: PublicKey
    let programId: PublicKey
    try {
      campaign = new PublicKey(request.campaign)
      outputMint = new PublicKey(request.outputMint)
      programId = new PublicKey(runtimeConfig.programId)
    } catch {
      return fail('INVALID_REQUEST')
    }

    // 4. The one attempt slot for (devnet, this program, this wallet).
    const namespace: RedaxHolderRecoveryJournalNamespace = {
      cluster: REDAX_JOURNAL_CLUSTER,
      program: programId.toBase58(),
      wallet: wallet.toBase58(),
    }

    // 5. The advisory journal read — before any Connection, RPC, builder or Transaction.
    const start = await readJournalStartVerdict(ports, namespace)
    if (!start.ok) {
      return fail(start.code)
    }

    // 6. Exactly one attempt-scoped Connection. Constructed directly, here.
    const connection = new Connection(runtimeConfig.rpcUrl, REDAX_ACTION_COMMITMENT)

    // 7. The FRESH loaded identity, read from chain — never the request reflected back.
    const loadedRead = await ports.readLoadedIdentity(
      connection,
      programId,
      { kind: 'prepare_user_output_ata', campaign, outputMint },
      { commitment: REDAX_ACTION_COMMITMENT },
    )
    if (!loadedRead.ok) {
      return fail('CHAIN_STATE_UNAVAILABLE')
    }
    const guardRuntime: RedaxHolderChainGuardRuntime = {
      mode: runtimeConfig.mode,
      cluster: runtimeConfig.cluster,
      programId,
    }
    const guardRequest: RedaxHolderChainGuardRequest = {
      kind: 'prepare_user_output_ata',
      campaign,
      outputMint,
    }
    const guardLoaded: RedaxHolderChainGuardLoaded = { campaign: loadedRead.campaign }

    // 8. Phase A — before any instruction and before any Transaction exists.
    const phaseA = await ports.checkPhaseA({
      connection,
      runtime: guardRuntime,
      wallet,
      request: guardRequest,
      loaded: guardLoaded,
    })
    if (!phaseA.ok) {
      return fail('CHAIN_GUARD_REFUSED')
    }

    // 9. The strict, context-bearing pre-state, AFTER Phase A.
    const preStateFloor = Math.max(loadedRead.contextSlot, phaseA.contextSlot)
    const preState = await ports.readPrepareState(
      connection,
      { wallet, outputMint },
      { commitment: REDAX_ACTION_COMMITMENT, minContextSlot: preStateFloor },
    )
    if (!preState.ok) {
      return fail('CHAIN_STATE_UNAVAILABLE')
    }
    if (preState.kind !== 'MISSING') {
      // Preparing is only meaningful from MISSING. A canonical account that already
      // exists needs nothing, and a mismatch is not something this action may fix.
      return fail('OUTPUT_ACCOUNT_NOT_READY', { userOutputAta: preState.userOutputAta.toBase58() })
    }

    // 10/11. Build the instruction and the fixed policy pair, then exactly one legacy
    //        Transaction carrying all three.
    let built: RedaxPrepareUserOutputAtaInstructionResult
    try {
      built = buildPrepareUserOutputAtaInstruction({
        programId,
        campaign,
        payer: wallet,
        user: wallet,
        outputMint,
      })
    } catch {
      return fail('BUILD_FAILED')
    }
    if (!built.userOutputAta.equals(preState.userOutputAta)) {
      // The account the instruction targets and the account the pre-state describes
      // must be the same account, or the recorded pre-state describes nothing.
      return fail('INVALID_REQUEST')
    }
    // THE COMPUTEBUDGET SLOT IS OCCUPIED HERE, BEFORE ANYTHING IS COMMITTED. An empty
    // slot is what a signing wallet fills in for itself, and anything it adds after
    // this attempt has committed to a message makes the signed bytes a different
    // transaction — correctly refused, and refused too late to be useful. The pair is
    // taken whole from its one authorized owner and spread in that owner's order, so
    // there is nothing to choose and nothing to reorder here.
    const computeBudget = buildRedaxDevnetComputeBudgetInstructions()
    const transaction = new Transaction().add(...computeBudget, built.instruction)

    // 12. The guarded, contextual blockhash.
    const blockhash = await ports.fetchBlockhash({ connection, snapshot: phaseA.snapshot })
    if (!blockhash.ok) {
      return fail('CHAIN_GUARD_REFUSED')
    }

    // 13. Exact fee payer and blockhash.
    transaction.feePayer = wallet
    transaction.recentBlockhash = blockhash.blockhash

    // 14. Serialize the legacy message EXACTLY ONCE, before the wallet ever sees it.
    let serializedMessage: Uint8Array
    try {
      serializedMessage = transaction.serializeMessage()
    } catch {
      return fail('MESSAGE_COMMITMENT_UNAVAILABLE')
    }
    // The attempt's OWN copy of those exact bytes, and the comparison authority the
    // signed artifact is judged against. `serializeMessage` hands back a Buffer, and a
    // Buffer is a VIEW — the frozen original must be memory nothing else can write
    // through. This is the ONLY message serialization the whole attempt performs.
    const intendedMessageBytes = Uint8Array.from(serializedMessage)

    // 15. Commit to it. The live Transaction is never serialized again after handoff.
    const commitment = await ports.commitIntendedMessage(serializedMessage)
    if (!commitment.ok) {
      return fail('MESSAGE_COMMITMENT_UNAVAILABLE')
    }

    // 16. The floor accepted from the identity, guard, pre-state and blockhash reads.
    const readFloor = Math.max(
      loadedRead.contextSlot,
      phaseA.contextSlot,
      preState.contextSlot,
      blockhash.blockhashContextSlot,
    )

    // 17. THE TRANSACTION-AUTHORITATIVE SOL PREFLIGHT (C2), on the attempt's OWN
    //     Connection and IMMEDIATELY BEFORE the slot is opened. Everything it needs
    //     already exists — the message is committed and the floor is accepted — and
    //     nothing durable has happened yet, so a refusal here writes no journal record,
    //     prompts no wallet, invokes no transport and creates no support disposition.
    //     Placing it any later would mean refusing an attempt that already owns a slot.
    const solPreflight = await observeHolderSolPreflight(
      ports,
      connection,
      wallet,
      'PREPARE_USER_OUTPUT_ATA',
      readFloor,
    )
    if (solPreflight.result !== 'SUFFICIENT') {
      return fail(
        solPreflight.result === 'INSUFFICIENT' ? 'PAYER_SOL_INSUFFICIENT' : 'CHAIN_STATE_UNAVAILABLE',
      )
    }

    // 18. The accepted preflight floor, now including the balance context: nothing
    //     observed later may be older than the newest read this attempt accepted.
    const preflightFloor = Math.max(readFloor, solPreflight.balanceContextSlot)

    // 19. Open the slot, under the exact replacement identity the advisory read saw.
    const begun = await ports.beginAttempt({
      namespace,
      action: 'prepare_user_output_ata',
      intendedMessage: commitment.commitment,
      preflightContextSlot: preflightFloor,
      lastValidBlockHeight: blockhash.lastValidBlockHeight,
      request: {
        campaign: campaign.toBase58(),
        outputMint: outputMint.toBase58(),
        userOutputAta: built.userOutputAta.toBase58(),
      },
      preState: { outputAta: 'MISSING' },
      replaces: start.replaces,
    })
    if (!begun.ok) {
      return fail(begun.code === 'ACTIVE_ATTEMPT_EXISTS' || begun.code === 'TOMBSTONE_NOT_REPLACEABLE'
        ? 'ATTEMPT_BLOCKED'
        : 'JOURNAL_UNAVAILABLE')
    }

    const probe: RedaxActionEffectProbe = {
      readEffectMatching: async (minContextSlot) => {
        const read = await ports.readPrepareState(
          connection,
          { wallet, outputMint },
          { commitment: REDAX_ACTION_COMMITMENT, minContextSlot },
        )
        if (!read.ok) {
          return EFFECT_UNAVAILABLE
        }
        return read.kind === 'PRESENT_CANONICAL'
          ? { kind: 'MATCHING', contextSlot: read.contextSlot }
          : { kind: 'NOT_MATCHING', contextSlot: read.contextSlot }
      },
      readNoEffect: async (minContextSlot) => {
        const read = await ports.readPrepareState(
          connection,
          { wallet, outputMint },
          { commitment: REDAX_ACTION_COMMITMENT, minContextSlot },
        )
        if (!read.ok) {
          return EFFECT_UNAVAILABLE
        }
        // No residue means the canonical account is still simply not there.
        return read.kind === 'MISSING'
          ? { kind: 'MATCHING', contextSlot: read.contextSlot }
          : { kind: 'NOT_MATCHING', contextSlot: read.contextSlot }
      },
      allowsEffectPresentOriginUnknown: true,
    }

    const runtime: RedaxAttemptRuntime = {
      ports,
      connection,
      namespace,
      cursor: { attemptNonce: begun.record.attemptNonce, revision: begun.record.revision },
      intendedMessage: commitment.commitment,
      preflightFloor,
      lastValidBlockHeight: blockhash.lastValidBlockHeight,
      discoveryAddress: built.userOutputAta,
      probe,
    }
    const userOutputAta = built.userOutputAta.toBase58()

    // 20. The wallet's IMMEDIATELY current key — not the snapshot compared to itself,
    //     and a throwing read is unavailability rather than an escaping exception.
    const liveWallet = readLiveWalletKey(deps.transport)
    if (liveWallet === null || !liveWallet.equals(wallet)) {
      const observation = await resolvePreInvocationRefusal(runtime)
      return fail(observation, { userOutputAta })
    }

    // 21. PRE-SIGN Phase B — every mutable fact re-read and re-decided, against the
    //     live wallet, immediately before the ONE sign-only request. The balance
    //     context joins the floor it must not be older than: the payer read is one of
    //     this attempt's accepted observations, not a side note.
    const phaseB = await ports.checkPhaseB({
      connection,
      snapshot: phaseA.snapshot,
      runtime: guardRuntime,
      wallet: liveWallet,
      request: guardRequest,
      loaded: guardLoaded,
      blockhash: blockhash.blockhash,
      blockhashContextSlot: blockhash.blockhashContextSlot,
      preStateContextSlot: Math.max(
        loadedRead.contextSlot,
        preState.contextSlot,
        solPreflight.balanceContextSlot,
      ),
    })
    if (!phaseB.ok) {
      const observation = await resolvePreInvocationRefusal(runtime)
      return fail(observation, { userOutputAta })
    }

    // 22. THE ONE SIGN-ONLY REQUEST. This is NOT a broadcast: REDAX holds the raw send,
    //     so a rejection here is a fact about a transaction that does not exist. The
    //     wallet is asked exactly once, on every path, and never asked again.
    onPhase?.('awaiting_wallet_approval')
    let signedWire: Uint8Array
    try {
      signedWire = await deps.transport.signLegacyTransactionBytes(transaction)
    } catch {
      // The thrown value is NOT inspected, and it does not need to be: nothing was
      // broadcast either way, so no wallet error code could add anything true.
      const observation = await resolveSignOnlyRefusal(runtime, 'WALLET_SIGN_ONLY_FAILED')
      return fail(observation, { userOutputAta })
    }

    // 23. The signed artifact is judged against the EXACT approved message, and the
    //     signature is verified against the bytes that were actually signed. Any
    //     difference — an added instruction included — refuses here, before broadcast.
    const verified = await verifySignedArtifact(ports, signedWire, {
      wallet,
      intendedMessage: commitment.commitment,
      intendedMessageBytes,
    })
    if (!verified.ok) {
      const observation = await resolveSignOnlyRefusal(runtime, verified.code)
      return fail(observation, { userOutputAta })
    }

    // 24. THE SECOND LIVE REASSERTION, on the SAME attempt Connection. The sign-only
    //     adapter path carries no cluster argument and performs no cluster check, so
    //     adopting it REMOVED an adapter-level guard — this is the compensating
    //     control, and it is not optional. Its accepted context becomes the broadcast
    //     floor below.
    const liveAfterSign = readLiveWalletKey(deps.transport)
    if (liveAfterSign === null || !liveAfterSign.equals(wallet)) {
      const observation = await resolvePreInvocationRefusal(runtime)
      return fail(observation, { userOutputAta })
    }
    const postSignGuard = await ports.checkPhaseB({
      connection,
      snapshot: phaseA.snapshot,
      runtime: guardRuntime,
      wallet: liveAfterSign,
      request: guardRequest,
      loaded: guardLoaded,
      blockhash: blockhash.blockhash,
      blockhashContextSlot: blockhash.blockhashContextSlot,
      preStateContextSlot: Math.max(
        loadedRead.contextSlot,
        preState.contextSlot,
        solPreflight.balanceContextSlot,
      ),
    })
    if (!postSignGuard.ok) {
      const observation = await resolvePreInvocationRefusal(runtime)
      return fail(observation, { userOutputAta })
    }

    // 25. The durable "we are about to broadcast" marker.
    const marked = await applyJournalTransition(runtime, { type: 'MARK_INVOCATION_STARTED' })
    if (!marked) {
      const observation = await handleMarkerFailure(runtime)
      return fail(observation, { userOutputAta })
    }

    // 26. The exact locally derived signature becomes DURABLE before the irreversible
    //     act. That ordering removes the old window entirely: a failure at the boundary
    //     can no longer leave a landed transaction whose signature was never recorded.
    //     If it does not read back, the record is conservative-inaccurate rather than
    //     dangerous-inaccurate — and nothing is broadcast.
    const persisted = await applyJournalTransition(runtime, {
      type: 'RETAIN_KNOWN_SIGNATURE',
      knownSignature: verified.knownSignature,
    })
    if (!persisted) {
      await recordObservation(runtime, 'SUPPORT_ONLY', null)
      return fail('SUPPORT_ONLY', { signature: verified.knownSignature, userOutputAta })
    }

    // 27. THE POINT OF NO RETURN — the exact verified bytes, once, on the attempt's own
    //     Connection. Nothing is awaited between the read-verified retention above and
    //     this call, and nothing rebuilds, re-signs or refreshes anything.
    let broadcast: unknown
    try {
      broadcast = await ports.sendRawTransaction(connection, verified.wire, {
        skipPreflight: false,
        preflightCommitment: REDAX_ACTION_COMMITMENT,
        minContextSlot: postSignGuard.contextSlot,
        maxRetries: 0,
      })
    } catch {
      // Nothing about the thrown value is inspected and nothing is sent again. The
      // exact signature is already known AND already durable, so this reconciles it.
      onPhase?.('confirming')
      const thrownOutcome = await resolveBroadcastOutcome(runtime, verified.knownSignature)
      if (thrownOutcome.ok) return prepared(thrownOutcome, userOutputAta)
      return fail(thrownOutcome.observation, { ...outcomeEvidence(thrownOutcome), userOutputAta })
    }

    onPhase?.('confirming')
    // 28. A returned signature must BE the signature REDAX derived and retained. A
    //     different one leaves two candidate identities and no way to prefer either, so
    //     the local one is kept, the returned one is not adopted, and nothing is resent.
    //     A value that is not a usable signature at all is not a second identity — the
    //     locally derived one still stands and reconciliation proceeds on it.
    const returnedSignature = ports.retainSignature(broadcast)
    if (returnedSignature.ok && returnedSignature.knownSignature !== verified.knownSignature) {
      await recordObservation(runtime, 'SUPPORT_ONLY', null)
      return fail('RPC_SIGNATURE_MISMATCH', {
        signature: verified.knownSignature,
        userOutputAta,
      })
    }

    // 29. Observe the exact known signature.
    const outcome = await resolveBroadcastOutcome(runtime, verified.knownSignature)
    if (outcome.ok) {
      return prepared(outcome, userOutputAta)
    }
    return fail(outcome.observation, { ...outcomeEvidence(outcome), userOutputAta })
  }
}

// --- Convert -------------------------------------------------------------------------

/**
 * The exact amounts an attempt was approved for, recomputed from FRESH chain state by
 * the checked transaction-authority oracle — together with the exact counter values
 * that oracle projected.
 *
 * The projection is CARRIED, not recomputed. Four of the seven post-effect counters
 * are exactly the values `calculateRedaxTransactionAuthorityQuote` already produced
 * under checked u128 addition; re-deriving them here would be a second copy of the
 * same formulas, free to drift from the one the wallet prompt was built on.
 */
interface RedaxConvertApprovedAmounts {
  readonly amountIn: bigint
  readonly amountInNormalized: bigint
  readonly normalizationRemainder: bigint
  readonly grossOut: bigint
  readonly protocolFee: bigint
  readonly netOut: bigint
  readonly projection: RedaxTransactionAuthorityProjection
}

/**
 * EXACTLY the seven values the two comparisons below read, and nothing else.
 *
 * Derived with `Pick` from the strict reader's own facts rather than re-declared, so
 * the seven names and their widths have ONE definition and a rename at the reader
 * cannot leave a stale copy here. Nothing is widened by this: a full
 * `RedaxConvertCoherentStateFacts` satisfies it structurally, so both live Holder
 * comparison sites are unchanged.
 *
 * The narrowing exists because a coherent chain READ is not the only place these seven
 * values can honestly come from. The durable attempt record measured the same seven
 * before the transaction was ever signed, and the explicit recovery reconciler must be
 * able to compare against THOSE — without inventing a rate, a decimals pair or a cap
 * it never recorded merely to satisfy a parameter type.
 */
type RedaxConvertMeasuredCounters = Pick<
  RedaxConvertCoherentStateFacts,
  | 'userLegacyAmount'
  | 'userOutputAmount'
  | 'protocolFeeVaultAmount'
  | 'campaignTotalOutputMinted'
  | 'campaignTotalProtocolFeesMinted'
  | 'tokenConfigTotalOutputMintedFromTc'
  | 'tokenConfigNormalizationRemainderTotal'
>

/**
 * Are the seven counters exactly what a successful conversion would have made them?
 *
 * All seven, exactly, or nothing. A partial match is not a partial success — it is a
 * state nobody predicted, and the only safe response is to refuse to call it either
 * outcome.
 *
 * The three classic-SPL balances are checked u64 deltas from the measured pre-state;
 * the four cumulative counters are compared against the oracle's own projection.
 */
function convertEffectMatches(
  before: RedaxConvertMeasuredCounters,
  after: RedaxConvertMeasuredCounters,
  amounts: RedaxConvertApprovedAmounts,
): boolean {
  const expectedLegacy = checkedSub(before.userLegacyAmount, amounts.amountIn)
  const expectedOutput = checkedAdd(before.userOutputAmount, amounts.netOut, U64_MAX)
  const expectedFeeVault = checkedAdd(before.protocolFeeVaultAmount, amounts.protocolFee, U64_MAX)
  if (expectedLegacy === null || expectedOutput === null || expectedFeeVault === null) {
    return false
  }
  const projection = amounts.projection
  return (
    after.userLegacyAmount === expectedLegacy &&
    after.userOutputAmount === expectedOutput &&
    after.protocolFeeVaultAmount === expectedFeeVault &&
    after.campaignTotalOutputMinted === projection.campaignTotalOutputMinted &&
    after.campaignTotalProtocolFeesMinted === projection.campaignTotalProtocolFeesMinted &&
    after.tokenConfigTotalOutputMintedFromTc === projection.tokenConfigTotalOutputMintedFromTc &&
    after.tokenConfigNormalizationRemainderTotal ===
      projection.tokenConfigNormalizationRemainderTotal
  )
}

/** Is every one of the seven values exactly what it was before? Anything else is not no-effect. */
function convertNoEffect(
  before: RedaxConvertMeasuredCounters,
  after: RedaxConvertMeasuredCounters,
): boolean {
  return (
    after.userLegacyAmount === before.userLegacyAmount &&
    after.userOutputAmount === before.userOutputAmount &&
    after.protocolFeeVaultAmount === before.protocolFeeVaultAmount &&
    after.campaignTotalOutputMinted === before.campaignTotalOutputMinted &&
    after.campaignTotalProtocolFeesMinted === before.campaignTotalProtocolFeesMinted &&
    after.tokenConfigTotalOutputMintedFromTc === before.tokenConfigTotalOutputMintedFromTc &&
    after.tokenConfigNormalizationRemainderTotal === before.tokenConfigNormalizationRemainderTotal
  )
}

/**
 * Compose the `convert_exact_in` action.
 *
 * Same order as prepare, plus one thing prepare does not need: the quote is
 * RECOMPUTED from the freshly read rate and decimals and checked against the caller's
 * request and the fresh caps BEFORE a single instruction byte exists. A quote taken
 * from props and never re-read is a quote the chain never agreed to.
 */
export function createRedaxConvertExactInAction(
  deps: RedaxHolderActionDeps,
): (
  request: RedaxConvertExactInRequest,
  onPhase?: (phase: RedaxWalletActionPhase) => void,
) => Promise<RedaxConvertExactInResult> {
  const ports = deps.ports ?? REDAX_PRODUCTION_HOLDER_ACTION_PORTS

  const fail = (
    code: RedaxConvertFailureCode,
    extra?: { signature?: string; finality?: RedaxOutcomeFinality; contextSlot?: number },
  ): RedaxConvertExactInResult => ({
    ok: false,
    code,
    message: CONVERT_MESSAGE[code],
    ...(extra ?? {}),
  })

  return async function convertExactIn(request, onPhase) {
    // 1. A valid DEVNET_TX_ENABLED runtime config.
    const runtimeConfig = deps.runtimeConfig
    if (runtimeConfig === null) {
      return fail(deps.runtimeConfigCode === 'NOT_DEVNET_TX_MODE' ? 'WRONG_MODE' : 'RUNTIME_CONFIG_UNAVAILABLE')
    }
    // 2. A connected transport, and the attempt's INITIAL wallet identity.
    const wallet = deps.transport.publicKey
    if (!deps.transport.isConnected || wallet === null) {
      return fail('WALLET_NOT_CONNECTED')
    }
    // 2b. SIGN-ONLY CAPABILITY, before anything else happens. Asked here so a wallet
    //     that cannot sign on its own is refused with nothing behind it: no chain read,
    //     no attempt slot, no journal record and — above all — no wallet prompt. There
    //     is deliberately nothing to fall back to.
    if (!deps.transport.canSignOnly) {
      return fail('WALLET_SIGN_ONLY_UNAVAILABLE')
    }
    // 3. Strict identity and amount parsing, before anything is read or built.
    let campaign: PublicKey
    let tokenConfig: PublicKey
    let legacyMint: PublicKey
    let outputMint: PublicKey
    let protocolFeeVault: PublicKey
    let programId: PublicKey
    try {
      campaign = new PublicKey(request.campaign)
      tokenConfig = new PublicKey(request.tokenConfig)
      legacyMint = new PublicKey(request.legacyMint)
      outputMint = new PublicKey(request.outputMint)
      protocolFeeVault = new PublicKey(request.protocolFeeVault)
      programId = new PublicKey(runtimeConfig.programId)
    } catch {
      return fail('INVALID_REQUEST')
    }
    const amountIn = parsePositiveU64Amount(request.amountInRaw)
    if (amountIn === null) {
      return fail('INVALID_AMOUNT')
    }

    // 4. The one attempt slot for (devnet, this program, this wallet).
    const namespace: RedaxHolderRecoveryJournalNamespace = {
      cluster: REDAX_JOURNAL_CLUSTER,
      program: programId.toBase58(),
      wallet: wallet.toBase58(),
    }

    // 5. The advisory journal read — before any Connection, RPC, builder or Transaction.
    const start = await readJournalStartVerdict(ports, namespace)
    if (!start.ok) {
      return fail(start.code)
    }

    // 6. Exactly one attempt-scoped Connection. Constructed directly, here.
    const connection = new Connection(runtimeConfig.rpcUrl, REDAX_ACTION_COMMITMENT)

    // 7. The FRESH loaded identity graph, read from chain.
    const loadedRead = await ports.readLoadedIdentity(
      connection,
      programId,
      {
        kind: 'convert_exact_in',
        campaign,
        tokenConfig,
        legacyMint,
        outputMint,
        protocolFeeVault,
      },
      { commitment: REDAX_ACTION_COMMITMENT },
    )
    if (!loadedRead.ok || loadedRead.tokenConfig === null) {
      return fail('CHAIN_STATE_UNAVAILABLE')
    }
    const guardRuntime: RedaxHolderChainGuardRuntime = {
      mode: runtimeConfig.mode,
      cluster: runtimeConfig.cluster,
      programId,
    }
    const guardRequest: RedaxHolderChainGuardRequest = {
      kind: 'convert_exact_in',
      campaign,
      tokenConfig,
      legacyMint,
      outputMint,
      protocolFeeVault,
    }
    const guardLoaded: RedaxHolderChainGuardLoaded = {
      campaign: loadedRead.campaign,
      tokenConfig: loadedRead.tokenConfig,
    }

    // 8. Phase A — before any instruction and before any Transaction exists.
    const phaseA = await ports.checkPhaseA({
      connection,
      runtime: guardRuntime,
      wallet,
      request: guardRequest,
      loaded: guardLoaded,
    })
    if (!phaseA.ok) {
      return fail('CHAIN_GUARD_REFUSED')
    }

    // 9. One coherent five-account pre-state, AFTER Phase A.
    const preStateFloor = Math.max(loadedRead.contextSlot, phaseA.contextSlot)
    const preStateRead = await ports.readConvertState(
      connection,
      programId,
      { wallet, campaign, tokenConfig, legacyMint, outputMint, protocolFeeVault },
      { commitment: REDAX_ACTION_COMMITMENT, minContextSlot: preStateFloor },
    )
    if (!preStateRead.ok) {
      return fail('CHAIN_STATE_UNAVAILABLE')
    }
    const before = preStateRead.state

    // 10. Recompute the quote from the FRESH rate, decimals, counters and caps —
    //     through the CHECKED transaction-authority oracle, which mirrors the
    //     program's finite widths at every intermediate. This refusal happens BEFORE
    //     any instruction is built, BEFORE any Transaction exists, BEFORE the journal
    //     is opened and BEFORE the wallet is ever invoked, so a quote the program
    //     would reject never becomes a prompt the holder is asked to approve.
    const quote = calculateRedaxTransactionAuthorityQuote({
      amountIn,
      legacyDecimals: before.legacyDecimals,
      outputDecimals: before.outputDecimals,
      rateNumerator: before.rateNumerator,
      rateDenominator: before.rateDenominator,
      campaignTotalOutputMinted: before.campaignTotalOutputMinted,
      campaignTotalProtocolFeesMinted: before.campaignTotalProtocolFeesMinted,
      maxOutputSupply: before.maxOutputSupply,
      tokenConfigTotalOutputMintedFromTc: before.tokenConfigTotalOutputMintedFromTc,
      tokenConfigNormalizationRemainderTotal: before.tokenConfigNormalizationRemainderTotal,
      maxOutputFromTc: before.maxOutputFromTc,
    })
    if (!quote.ok) {
      // A cap breach is the one refusal a holder can act on — reduce the amount or
      // wait — so it keeps its own code. Every other checked refusal is a term the
      // chain would not honour, and they share one value-free code.
      return fail(
        quote.rejection === 'CAMPAIGN_CAP_EXCEEDED' ||
          quote.rejection === 'TOKEN_CONFIG_CAP_EXCEEDED'
          ? 'CAP_EXCEEDED'
          : 'QUOTE_REJECTED',
      )
    }
    const amounts: RedaxConvertApprovedAmounts = {
      amountIn,
      amountInNormalized: quote.amounts.amountInNormalized,
      normalizationRemainder: quote.amounts.normalizationRemainder,
      grossOut: quote.amounts.grossOut,
      protocolFee: quote.amounts.feeOut,
      netOut: quote.amounts.userOut,
      projection: quote.projection,
    }
    if (parseRawAmount(request.amountInRaw) !== amounts.amountIn) {
      // The exact string the caller supplied must be the exact amount being sent.
      return fail('INVALID_AMOUNT')
    }
    if (checkedSub(before.userLegacyAmount, amounts.amountIn) === null) {
      // The burn would take more than the wallet holds. The program would reject it;
      // there is no reason to ask a holder to approve it.
      return fail('QUOTE_REJECTED')
    }

    // 11/12. Build the instruction and the fixed policy pair, then exactly one legacy
    //        Transaction carrying all three.
    let built: RedaxConvertExactInInstructionResult
    try {
      built = buildConvertExactInInstruction({
        programId,
        user: wallet,
        campaign,
        tokenConfig,
        legacyMint,
        outputMint,
        protocolFeeVault,
        amountIn: amounts.amountIn,
      })
    } catch {
      return fail('BUILD_FAILED')
    }
    if (
      !built.userLegacyAta.equals(before.userLegacyAta) ||
      !built.userOutputAta.equals(before.userOutputAta)
    ) {
      // The accounts the instruction touches and the accounts the pre-state measured
      // must be the same accounts, or the exact delta check is meaningless.
      return fail('INVALID_REQUEST')
    }
    // The same fixed policy, from the same one authorized owner, in the same canonical
    // order — see the prepare action for why the slot is occupied before anything is
    // committed. The conversion arithmetic, the quote, the accounts and the program
    // instruction data are untouched by it: only the transaction it travels in changed.
    const computeBudget = buildRedaxDevnetComputeBudgetInstructions()
    const transaction = new Transaction().add(...computeBudget, built.instruction)

    // 13. The guarded, contextual blockhash.
    const blockhash = await ports.fetchBlockhash({ connection, snapshot: phaseA.snapshot })
    if (!blockhash.ok) {
      return fail('CHAIN_GUARD_REFUSED')
    }

    // 14. Exact fee payer and blockhash.
    transaction.feePayer = wallet
    transaction.recentBlockhash = blockhash.blockhash

    // 15. Serialize the legacy message EXACTLY ONCE, before the wallet ever sees it.
    let serializedMessage: Uint8Array
    try {
      serializedMessage = transaction.serializeMessage()
    } catch {
      return fail('MESSAGE_COMMITMENT_UNAVAILABLE')
    }
    // The attempt's OWN copy of those exact bytes, and the comparison authority the
    // signed artifact is judged against. `serializeMessage` hands back a Buffer, and a
    // Buffer is a VIEW — the frozen original must be memory nothing else can write
    // through. This is the ONLY message serialization the whole attempt performs.
    const intendedMessageBytes = Uint8Array.from(serializedMessage)

    // 16. Commit to it. The live Transaction is never serialized again after handoff.
    const commitment = await ports.commitIntendedMessage(serializedMessage)
    if (!commitment.ok) {
      return fail('MESSAGE_COMMITMENT_UNAVAILABLE')
    }

    // 17. The floor accepted from the identity, guard, pre-state and blockhash reads.
    const readFloor = Math.max(
      loadedRead.contextSlot,
      phaseA.contextSlot,
      preStateRead.contextSlot,
      blockhash.blockhashContextSlot,
    )

    // 18. THE TRANSACTION-AUTHORITATIVE SOL PREFLIGHT (C2), on the attempt's OWN
    //     Connection and IMMEDIATELY BEFORE the slot is opened. A convert creates no
    //     account, so its threshold carries the payer rent floor and the shared fee
    //     bound only — charging it output-ATA rent would refuse holders who can in fact
    //     pay. A refusal here writes no journal record, prompts no wallet and invokes
    //     no transport.
    const solPreflight = await observeHolderSolPreflight(
      ports,
      connection,
      wallet,
      'CONVERT_EXACT_IN',
      readFloor,
    )
    if (solPreflight.result !== 'SUFFICIENT') {
      return fail(
        solPreflight.result === 'INSUFFICIENT' ? 'PAYER_SOL_INSUFFICIENT' : 'CHAIN_STATE_UNAVAILABLE',
      )
    }

    // 19. The accepted preflight floor, now including the balance context.
    const preflightFloor = Math.max(readFloor, solPreflight.balanceContextSlot)

    // 20. Open the slot, recording the exact request and the exact measured pre-state.
    const begun = await ports.beginAttempt({
      namespace,
      action: 'convert_exact_in',
      intendedMessage: commitment.commitment,
      preflightContextSlot: preflightFloor,
      lastValidBlockHeight: blockhash.lastValidBlockHeight,
      request: {
        campaign: campaign.toBase58(),
        tokenConfig: tokenConfig.toBase58(),
        legacyMint: legacyMint.toBase58(),
        outputMint: outputMint.toBase58(),
        protocolFeeVault: protocolFeeVault.toBase58(),
        userLegacyAta: before.userLegacyAta.toBase58(),
        userOutputAta: before.userOutputAta.toBase58(),
        amountInRaw: amounts.amountIn.toString(),
        amountInNormalizedRaw: amounts.amountInNormalized.toString(),
        grossOutRaw: amounts.grossOut.toString(),
        protocolFeeRaw: amounts.protocolFee.toString(),
        netOutRaw: amounts.netOut.toString(),
        normalizationRemainderRaw: amounts.normalizationRemainder.toString(),
      },
      preState: {
        userLegacyAmountRaw: before.userLegacyAmount.toString(),
        userOutputAmountRaw: before.userOutputAmount.toString(),
        protocolFeeVaultAmountRaw: before.protocolFeeVaultAmount.toString(),
        campaignTotalOutputMintedRaw: before.campaignTotalOutputMinted.toString(),
        campaignTotalProtocolFeesMintedRaw: before.campaignTotalProtocolFeesMinted.toString(),
        tokenConfigTotalOutputMintedFromTcRaw: before.tokenConfigTotalOutputMintedFromTc.toString(),
        tokenConfigNormalizationRemainderTotalRaw:
          before.tokenConfigNormalizationRemainderTotal.toString(),
      },
      replaces: start.replaces,
    })
    if (!begun.ok) {
      return fail(begun.code === 'ACTIVE_ATTEMPT_EXISTS' || begun.code === 'TOMBSTONE_NOT_REPLACEABLE'
        ? 'ATTEMPT_BLOCKED'
        : 'JOURNAL_UNAVAILABLE')
    }

    const readAfterState = async (minContextSlot: number) =>
      ports.readConvertState(
        connection,
        programId,
        { wallet, campaign, tokenConfig, legacyMint, outputMint, protocolFeeVault },
        { commitment: REDAX_ACTION_COMMITMENT, minContextSlot },
      )

    const probe: RedaxActionEffectProbe = {
      readEffectMatching: async (minContextSlot) => {
        const read = await readAfterState(minContextSlot)
        if (!read.ok) {
          return EFFECT_UNAVAILABLE
        }
        return convertEffectMatches(before, read.state, amounts)
          ? { kind: 'MATCHING', contextSlot: read.contextSlot }
          : { kind: 'NOT_MATCHING', contextSlot: read.contextSlot }
      },
      readNoEffect: async (minContextSlot) => {
        const read = await readAfterState(minContextSlot)
        if (!read.ok) {
          return EFFECT_UNAVAILABLE
        }
        return convertNoEffect(before, read.state)
          ? { kind: 'MATCHING', contextSlot: read.contextSlot }
          : { kind: 'NOT_MATCHING', contextSlot: read.contextSlot }
      },
      // A convert NEVER attributes itself from balances or counters alone. Tokens can
      // move for other reasons, and an unattributed conversion is not a conversion
      // this attempt may claim.
      allowsEffectPresentOriginUnknown: false,
    }

    const runtime: RedaxAttemptRuntime = {
      ports,
      connection,
      namespace,
      cursor: { attemptNonce: begun.record.attemptNonce, revision: begun.record.revision },
      intendedMessage: commitment.commitment,
      preflightFloor,
      lastValidBlockHeight: blockhash.lastValidBlockHeight,
      // The legacy INPUT account is the one this action provably touches.
      discoveryAddress: before.userLegacyAta,
      probe,
    }
    // Resolved once, here, and never between the marker and the invocation — every
    // statement on that path must stay inert.
    const landed: RedaxConvertLandedAccounts = {
      userLegacyAta: built.userLegacyAta.toBase58(),
      userOutputAta: built.userOutputAta.toBase58(),
      protocolConfig: built.protocolConfig.toBase58(),
    }

    // 21. The wallet's IMMEDIATELY current key — not the snapshot compared to itself,
    //     and a throwing read is unavailability rather than an escaping exception.
    const liveWallet = readLiveWalletKey(deps.transport)
    if (liveWallet === null || !liveWallet.equals(wallet)) {
      return fail(await resolvePreInvocationRefusal(runtime))
    }

    // 22. PRE-SIGN Phase B — every mutable fact re-read and re-decided, against the
    //     live wallet, immediately before the ONE sign-only request. The balance
    //     context joins the floor it must not be older than.
    const phaseB = await ports.checkPhaseB({
      connection,
      snapshot: phaseA.snapshot,
      runtime: guardRuntime,
      wallet: liveWallet,
      request: guardRequest,
      loaded: guardLoaded,
      blockhash: blockhash.blockhash,
      blockhashContextSlot: blockhash.blockhashContextSlot,
      preStateContextSlot: Math.max(
        loadedRead.contextSlot,
        preStateRead.contextSlot,
        solPreflight.balanceContextSlot,
      ),
    })
    if (!phaseB.ok) {
      return fail(await resolvePreInvocationRefusal(runtime))
    }

    // 23. THE ONE SIGN-ONLY REQUEST. This is NOT a broadcast: REDAX holds the raw send,
    //     so a rejection here is a fact about a transaction that does not exist. The
    //     wallet is asked exactly once, on every path, and never asked again.
    onPhase?.('awaiting_wallet_approval')
    let signedWire: Uint8Array
    try {
      signedWire = await deps.transport.signLegacyTransactionBytes(transaction)
    } catch {
      // The thrown value is NOT inspected, and it does not need to be: nothing was
      // broadcast either way, so no wallet error code could add anything true.
      return fail(await resolveSignOnlyRefusal(runtime, 'WALLET_SIGN_ONLY_FAILED'))
    }

    // 24. The signed artifact is judged against the EXACT approved message, and the
    //     signature is verified against the bytes that were actually signed. Any
    //     difference — an added instruction included — refuses here, before broadcast.
    const verified = await verifySignedArtifact(ports, signedWire, {
      wallet,
      intendedMessage: commitment.commitment,
      intendedMessageBytes,
    })
    if (!verified.ok) {
      return fail(await resolveSignOnlyRefusal(runtime, verified.code))
    }

    // 25. THE SECOND LIVE REASSERTION, on the SAME attempt Connection. The sign-only
    //     adapter path carries no cluster argument and performs no cluster check, so
    //     adopting it REMOVED an adapter-level guard — this is the compensating
    //     control, and it is not optional. Its accepted context becomes the broadcast
    //     floor below.
    const liveAfterSign = readLiveWalletKey(deps.transport)
    if (liveAfterSign === null || !liveAfterSign.equals(wallet)) {
      return fail(await resolvePreInvocationRefusal(runtime))
    }
    const postSignGuard = await ports.checkPhaseB({
      connection,
      snapshot: phaseA.snapshot,
      runtime: guardRuntime,
      wallet: liveAfterSign,
      request: guardRequest,
      loaded: guardLoaded,
      blockhash: blockhash.blockhash,
      blockhashContextSlot: blockhash.blockhashContextSlot,
      preStateContextSlot: Math.max(
        loadedRead.contextSlot,
        preStateRead.contextSlot,
        solPreflight.balanceContextSlot,
      ),
    })
    if (!postSignGuard.ok) {
      return fail(await resolvePreInvocationRefusal(runtime))
    }

    // 26. The durable "we are about to broadcast" marker.
    const marked = await applyJournalTransition(runtime, { type: 'MARK_INVOCATION_STARTED' })
    if (!marked) {
      return fail(await handleMarkerFailure(runtime))
    }

    // 27. The exact locally derived signature becomes DURABLE before the irreversible
    //     act. That ordering removes the old window entirely: a failure at the boundary
    //     can no longer leave a landed transaction whose signature was never recorded.
    //     If it does not read back, the record is conservative-inaccurate rather than
    //     dangerous-inaccurate — and nothing is broadcast.
    const persisted = await applyJournalTransition(runtime, {
      type: 'RETAIN_KNOWN_SIGNATURE',
      knownSignature: verified.knownSignature,
    })
    if (!persisted) {
      await recordObservation(runtime, 'SUPPORT_ONLY', null)
      return fail('SUPPORT_ONLY', { signature: verified.knownSignature })
    }

    // 28. THE POINT OF NO RETURN — the exact verified bytes, once, on the attempt's own
    //     Connection. Nothing is awaited between the read-verified retention above and
    //     this call, and nothing rebuilds, re-signs or refreshes anything.
    let broadcast: unknown
    try {
      broadcast = await ports.sendRawTransaction(connection, verified.wire, {
        skipPreflight: false,
        preflightCommitment: REDAX_ACTION_COMMITMENT,
        minContextSlot: postSignGuard.contextSlot,
        maxRetries: 0,
      })
    } catch {
      // Nothing about the thrown value is inspected and nothing is sent again. The
      // exact signature is already known AND already durable, so this reconciles it.
      onPhase?.('confirming')
      const thrownOutcome = await resolveBroadcastOutcome(runtime, verified.knownSignature)
      if (thrownOutcome.ok) return converted(thrownOutcome, landed)
      return fail(convertObservation(thrownOutcome.observation), outcomeEvidence(thrownOutcome))
    }

    onPhase?.('confirming')
    // 29. A returned signature must BE the signature REDAX derived and retained. A
    //     different one leaves two candidate identities and no way to prefer either, so
    //     the local one is kept, the returned one is not adopted, and nothing is resent.
    //     A value that is not a usable signature at all is not a second identity — the
    //     locally derived one still stands and reconciliation proceeds on it.
    const returnedSignature = ports.retainSignature(broadcast)
    if (returnedSignature.ok && returnedSignature.knownSignature !== verified.knownSignature) {
      await recordObservation(runtime, 'SUPPORT_ONLY', null)
      return fail('RPC_SIGNATURE_MISMATCH', { signature: verified.knownSignature })
    }

    // 30. Observe the exact known signature.
    const outcome = await resolveBroadcastOutcome(runtime, verified.knownSignature)
    if (outcome.ok) {
      return converted(outcome, landed)
    }
    return fail(convertObservation(outcome.observation), outcomeEvidence(outcome))
  }
}

// --- The members that are not actions -------------------------------------------------

/**
 * One durable record, projected into the recovery vocabulary — with nothing added.
 *
 * PURE, and pure is the property: it reads a frozen record and returns a value. No
 * chain read, no journal write, no transport, no permission, and nothing synthesised
 * for a field the record does not carry. `resolved` is the RECORD'S OWN lifecycle and
 * never an inference from an observation.
 *
 * Both non-transaction recovery members shape their result through this one function,
 * so "what the saved attempt currently is" has exactly ONE spelling. That matters more
 * than the few lines it saves: a reconciler with a recovery vocabulary of its own would
 * be free to describe a record more generously than the read-only check describes the
 * same record, and the two panels would then disagree about the same durable bytes.
 */
function projectHolderRecoveryRecord(
  record: RedaxHolderRecoveryJournalRecordV1,
): Extract<RedaxHolderRecoveryRecheckResult, { kind: 'ATTEMPT_PRESENT' }> { const convertReceipt = projectHolderRecoveryConvertReceipt(record)
  return {
    ok: true,
    kind: 'ATTEMPT_PRESENT',
    action: record.action,
    resolved: record.lifecycle === 'TOMBSTONE',
    observation: record.observation,
    signature: record.knownSignature, ...(convertReceipt === null ? {} : { convertReceipt }),
  }
}

/**
 * Compose the explicit read-only recovery re-check.
 *
 * It is NOT an action. It constructs no instruction and no Transaction, calls no
 * transport, signs nothing, sends nothing, confirms nothing, and — deliberately —
 * writes NOTHING to the journal. It reads the durable record and, when that record
 * carries an exact signature, performs at most one bounded observation of it.
 *
 * It runs only when something calls it. There is no timer, no polling, no
 * subscription and no mount-time invocation, and its result carries no permission of
 * any kind.
 */
export function createRedaxHolderRecoveryRecheck(
  deps: RedaxHolderActionDeps,
): () => Promise<RedaxHolderRecoveryRecheckResult> {
  const ports = deps.ports ?? REDAX_PRODUCTION_HOLDER_ACTION_PORTS

  return async function recheckHolderRecovery() {
    const runtimeConfig = deps.runtimeConfig
    if (runtimeConfig === null) {
      return { ok: false, code: 'RUNTIME_CONFIG_UNAVAILABLE' }
    }
    const wallet = deps.transport.publicKey
    if (!deps.transport.isConnected || wallet === null) {
      return { ok: false, code: 'WALLET_NOT_CONNECTED' }
    }
    let programId: PublicKey
    try {
      programId = new PublicKey(runtimeConfig.programId)
    } catch {
      return { ok: false, code: 'RUNTIME_CONFIG_UNAVAILABLE' }
    }
    const namespace: RedaxHolderRecoveryJournalNamespace = {
      cluster: REDAX_JOURNAL_CLUSTER,
      program: programId.toBase58(),
      wallet: wallet.toBase58(),
    }
    const read = await ports.readJournal(namespace)
    if (!read.ok) {
      return { ok: false, code: 'JOURNAL_UNAVAILABLE' }
    }
    if (read.kind === 'EMPTY') {
      return { ok: true, kind: 'NO_ATTEMPT' }
    }
    const record: RedaxHolderRecoveryJournalRecordV1 = read.record
    const base = projectHolderRecoveryRecord(record)
    if (record.lifecycle !== 'KNOWN_SIGNATURE' || record.knownSignature === null) {
      return base
    }
    const retained = ports.retainSignature(record.knownSignature)
    if (!retained.ok) {
      return base
    }
    // One bounded observation, on its own read-only scoped Connection. This is the
    // only chain read the re-check performs, and it changes nothing.
    const connection = new Connection(runtimeConfig.rpcUrl, REDAX_ACTION_COMMITMENT)
    const outcome = await ports.observeOutcome(connection, {
      signature: retained.knownSignature,
      intendedMessage: record.intendedMessage,
      minimumContextSlot: record.preflightContextSlot,
      lastValidBlockHeight: record.lastValidBlockHeight,
    })
    // Five literals, none of them post-broadcast: the annotation is the exact narrowed
    // re-check vocabulary, not the wider action one, so no mismatch code can leave here.
    const summary: RedaxHolderRecoveryCurrentObservation =
      outcome.kind === 'FINALIZED_MESSAGE_META_MATCHING' ||
      outcome.kind === 'CONFIRMED_MESSAGE_META_MATCHING'
        ? 'SIGNATURE_OBSERVED'
        : outcome.kind === 'LANDED_TRANSACTION_FAILED'
          ? 'LANDED_TRANSACTION_FAILED'
          : outcome.kind === 'LANDED_MESSAGE_MISMATCH'
            ? 'LANDED_MESSAGE_MISMATCH'
            : outcome.kind === 'READ_UNAVAILABLE'
              ? 'READ_UNAVAILABLE'
              : 'CONFIRMATION_PENDING'
    return { ...base, outcome: summary, finality: outcome.finality }
  }
}

// --- The explicit, non-transaction recovery reconciler ---------------------------------
//
// WHY THIS EXISTS. The architecture above retains an exact signature and can OBSERVE
// its finality read-only, but until now nothing was allowed to TERMINATE the retained
// attempt from a later session. A Holder action that finalized, produced its exact
// effect and left a clean record could therefore block both Holder surfaces forever:
// the record correctly refused to advance itself, and no lawful path advanced it. That
// is a LIVENESS gap, and closing it relaxes no safety rule — every refusal below is
// the same refusal the action path makes.
//
// WHAT IT IS NOT. Not a transaction action, not a retry, not a resend, not a resume and
// not a replacement attempt. It opens no slot, mints no attempt nonce, builds no
// instruction and no `Transaction`, asks no wallet for anything, fetches no blockhash,
// simulates nothing and broadcasts nothing. It performs no signature discovery: the
// runtime it builds carries no discovery address, so `runBoundedHn2Pass` and
// `resolveSignatureless` are not merely unused here — they are untypeable here.
//
// THE DURABLE RECORD IS THE ONLY AUTHORITY. Every identity, amount and floor comes
// from the record itself. The currently selected Campaign, the currently selected
// TokenConfig and every other piece of present screen state are not consulted, cannot
// be passed in, and would be the wrong answer if they were: the attempt being
// reconciled may well predate whatever the screen is showing now.

/**
 * One durable string field, read defensively. Never throws; `null` is a refusal.
 *
 * The record is already parsed and frozen by the journal, which validates every field
 * against the exact table for its action. This reads it again anyway — a frozen object
 * is not the same thing as an object whose shape this function has personally
 * established, and every refusal here costs one unreconciled attempt while a wrong
 * acceptance would cost an attribution.
 */
function readDurableText(source: object, key: string): string | null {
  let value: unknown
  try {
    value = Reflect.get(source, key)
  } catch {
    return null
  }
  return typeof value === 'string' && value !== '' ? value : null
}

/** One durable account identifier, parsed. A value that is not a key is a refusal. */
function readDurableAccount(source: object, key: string): PublicKey | null {
  const text = readDurableText(source, key)
  if (text === null) {
    return null
  }
  try {
    return new PublicKey(text)
  } catch {
    return null
  }
}

/** The canonical unsigned decimal every durable raw amount is written as. */
const REDAX_DURABLE_AMOUNT_PATTERN = /^(?:0|[1-9][0-9]*)$/

/**
 * One durable raw amount, bounded by the exact on-chain width it is stored under.
 *
 * Canonical spelling only — no sign, no separators, no leading-zero run — and then the
 * width. A malformed or out-of-range value fails closed: the reconciliation simply does
 * not happen, which leaves the record exactly as it was.
 */
function readDurableAmount(source: object, key: string, max: bigint): bigint | null {
  const text = readDurableText(source, key)
  if (text === null || !REDAX_DURABLE_AMOUNT_PATTERN.test(text)) {
    return null
  }
  let value: bigint
  try {
    value = BigInt(text)
  } catch {
    return null
  }
  return value >= 0n && value <= max ? value : null
}

/**
 * Rebuild the four cumulative counters an approved convert projected.
 *
 * NOT A SECOND CONVERSION FORMULA, and the distinction is the whole point. The rate,
 * the normalization, the gross output and the FLOOR fee split are NOT recomputed here
 * and could not be: this function never sees a rate, a decimals pair or a cap. It reads
 * `grossOut`, `protocolFee` and `normalizationRemainder` VERBATIM from the durable
 * record — the exact amounts the checked oracle produced and the holder approved — and
 * performs the same four checked additions onto the exact durable pre-state counters
 * that the oracle performed onto the same four values at approval time.
 *
 * A live attempt still CARRIES the oracle's own projection and never calls this; there
 * is nothing to consult here at approval time and nothing to reconstruct. The bound is
 * the oracle's own `REDAX_U128_MAX` rather than a local copy, so the two cannot drift.
 * An overflow returns `null` and the attempt stays unreconciled — a counter the chain
 * could not hold is not a counter to predict a match against.
 */
function projectRedaxConvertCounters(
  before: RedaxConvertMeasuredCounters,
  grossOut: bigint,
  protocolFee: bigint,
  normalizationRemainder: bigint,
): RedaxTransactionAuthorityProjection | null {
  const campaignTotalOutputMinted = checkedAdd(
    before.campaignTotalOutputMinted,
    grossOut,
    REDAX_U128_MAX,
  )
  const campaignTotalProtocolFeesMinted = checkedAdd(
    before.campaignTotalProtocolFeesMinted,
    protocolFee,
    REDAX_U128_MAX,
  )
  const tokenConfigTotalOutputMintedFromTc = checkedAdd(
    before.tokenConfigTotalOutputMintedFromTc,
    grossOut,
    REDAX_U128_MAX,
  )
  const tokenConfigNormalizationRemainderTotal = checkedAdd(
    before.tokenConfigNormalizationRemainderTotal,
    normalizationRemainder,
    REDAX_U128_MAX,
  )
  if (
    campaignTotalOutputMinted === null ||
    campaignTotalProtocolFeesMinted === null ||
    tokenConfigTotalOutputMintedFromTc === null ||
    tokenConfigNormalizationRemainderTotal === null
  ) {
    return null
  }
  return {
    campaignTotalOutputMinted,
    campaignTotalProtocolFeesMinted,
    tokenConfigTotalOutputMintedFromTc,
    tokenConfigNormalizationRemainderTotal,
  }
}

/**
 * A probe that has been fully planned from the durable record, awaiting only the one
 * read-only `Connection` it will read through.
 *
 * Planning happens BEFORE any connection exists, so a malformed or incoherent record is
 * refused without a single chain resource being created for it.
 */
type RedaxRecoveryProbePlan = (connection: Connection) => RedaxActionEffectProbe

/**
 * Plan the Prepare effect probe from the durable record alone.
 *
 * The canonical derivation check is the load-bearing one. The reader derives the
 * wallet's canonical classic-SPL account for the RECORDED output mint and returns the
 * address it derived; that address is then required to equal the `userOutputAta` the
 * record committed to when the attempt was opened. If they differ, the account being
 * read is not the account the attempt was about, and NEITHER arm may answer: a
 * mismatch is `NOT_MATCHING` on both, which reaches the existing support semantics and
 * resolves nothing at all.
 */
function planPrepareRecoveryProbe(
  ports: RedaxHolderActionPorts,
  wallet: PublicKey,
  record: RedaxHolderRecoveryJournalRecordV1,
): RedaxRecoveryProbePlan | null {
  // A prepare attempt is opened from MISSING and from nothing else. A record that says
  // otherwise is not one this probe can reason about.
  if (readDurableText(record.preState, 'outputAta') !== 'MISSING') {
    return null
  }
  const campaign = readDurableAccount(record.request, 'campaign')
  const outputMint = readDurableAccount(record.request, 'outputMint')
  const recordedOutputAta = readDurableAccount(record.request, 'userOutputAta')
  if (campaign === null || outputMint === null || recordedOutputAta === null) {
    return null
  }
  const recordedOutputAtaText = recordedOutputAta.toBase58()

  return (connection: Connection): RedaxActionEffectProbe => {
    const readOutputAtaState = async (minContextSlot: number) =>
      ports.readPrepareState(
        connection,
        { wallet, outputMint },
        { commitment: REDAX_ACTION_COMMITMENT, minContextSlot },
      )
    return {
      readEffectMatching: async (minContextSlot) => {
        const read = await readOutputAtaState(minContextSlot)
        if (!read.ok) {
          return EFFECT_UNAVAILABLE
        }
        if (read.userOutputAta.toBase58() !== recordedOutputAtaText) {
          return { kind: 'NOT_MATCHING', contextSlot: read.contextSlot }
        }
        // The SAME effect definition the original action uses. There is deliberately no
        // weaker recovery-specific one: "the account is there" would attribute an
        // account this attempt may never have created.
        return read.kind === 'PRESENT_CANONICAL'
          ? { kind: 'MATCHING', contextSlot: read.contextSlot }
          : { kind: 'NOT_MATCHING', contextSlot: read.contextSlot }
      },
      readNoEffect: async (minContextSlot) => {
        const read = await readOutputAtaState(minContextSlot)
        if (!read.ok) {
          return EFFECT_UNAVAILABLE
        }
        if (read.userOutputAta.toBase58() !== recordedOutputAtaText) {
          return { kind: 'NOT_MATCHING', contextSlot: read.contextSlot }
        }
        // No residue means the canonical account is still simply not there.
        return read.kind === 'MISSING'
          ? { kind: 'MATCHING', contextSlot: read.contextSlot }
          : { kind: 'NOT_MATCHING', contextSlot: read.contextSlot }
      },
      // Carried to match the original Prepare probe exactly. It is UNREACHABLE from a
      // reconciliation: only the signatureless discovery arm reads it, and this runtime
      // cannot reach that arm.
      allowsEffectPresentOriginUnknown: true,
    }
  }
}

/**
 * Plan the Convert effect probe from the durable record alone.
 *
 * The exact seven-value proof, reconstructed rather than weakened. The identities, the
 * six approved amounts and the seven measured pre-state values all come from the
 * record; the four projected counters are rebuilt from those same durable values; and
 * the comparison itself is the ORIGINAL `convertEffectMatches` / `convertNoEffect`.
 * Nothing here re-quotes the campaign, and nothing attributes a conversion from a
 * balance alone.
 */
function planConvertRecoveryProbe(
  ports: RedaxHolderActionPorts,
  programId: PublicKey,
  wallet: PublicKey,
  record: RedaxHolderRecoveryJournalRecordV1,
): RedaxRecoveryProbePlan | null {
  const campaign = readDurableAccount(record.request, 'campaign')
  const tokenConfig = readDurableAccount(record.request, 'tokenConfig')
  const legacyMint = readDurableAccount(record.request, 'legacyMint')
  const outputMint = readDurableAccount(record.request, 'outputMint')
  const protocolFeeVault = readDurableAccount(record.request, 'protocolFeeVault')
  const recordedLegacyAta = readDurableAccount(record.request, 'userLegacyAta')
  const recordedOutputAta = readDurableAccount(record.request, 'userOutputAta')
  if (
    campaign === null ||
    tokenConfig === null ||
    legacyMint === null ||
    outputMint === null ||
    protocolFeeVault === null ||
    recordedLegacyAta === null ||
    recordedOutputAta === null
  ) {
    return null
  }

  // The six approved amounts, at the exact widths the record stores them under.
  const amountIn = readDurableAmount(record.request, 'amountInRaw', U64_MAX)
  const amountInNormalized = readDurableAmount(
    record.request,
    'amountInNormalizedRaw',
    REDAX_U128_MAX,
  )
  const normalizationRemainder = readDurableAmount(
    record.request,
    'normalizationRemainderRaw',
    REDAX_U128_MAX,
  )
  const grossOut = readDurableAmount(record.request, 'grossOutRaw', REDAX_U128_MAX)
  const protocolFee = readDurableAmount(record.request, 'protocolFeeRaw', REDAX_U128_MAX)
  const netOut = readDurableAmount(record.request, 'netOutRaw', REDAX_U128_MAX)
  if (
    amountIn === null ||
    amountInNormalized === null ||
    normalizationRemainder === null ||
    grossOut === null ||
    protocolFee === null ||
    netOut === null
  ) {
    return null
  }

  // The seven values measured before the attempt was ever signed.
  const userLegacyAmount = readDurableAmount(record.preState, 'userLegacyAmountRaw', U64_MAX)
  const userOutputAmount = readDurableAmount(record.preState, 'userOutputAmountRaw', U64_MAX)
  const protocolFeeVaultAmount = readDurableAmount(
    record.preState,
    'protocolFeeVaultAmountRaw',
    U64_MAX,
  )
  const campaignTotalOutputMinted = readDurableAmount(
    record.preState,
    'campaignTotalOutputMintedRaw',
    REDAX_U128_MAX,
  )
  const campaignTotalProtocolFeesMinted = readDurableAmount(
    record.preState,
    'campaignTotalProtocolFeesMintedRaw',
    REDAX_U128_MAX,
  )
  const tokenConfigTotalOutputMintedFromTc = readDurableAmount(
    record.preState,
    'tokenConfigTotalOutputMintedFromTcRaw',
    REDAX_U128_MAX,
  )
  const tokenConfigNormalizationRemainderTotal = readDurableAmount(
    record.preState,
    'tokenConfigNormalizationRemainderTotalRaw',
    REDAX_U128_MAX,
  )
  if (
    userLegacyAmount === null ||
    userOutputAmount === null ||
    protocolFeeVaultAmount === null ||
    campaignTotalOutputMinted === null ||
    campaignTotalProtocolFeesMinted === null ||
    tokenConfigTotalOutputMintedFromTc === null ||
    tokenConfigNormalizationRemainderTotal === null
  ) {
    return null
  }

  const before: RedaxConvertMeasuredCounters = {
    userLegacyAmount,
    userOutputAmount,
    protocolFeeVaultAmount,
    campaignTotalOutputMinted,
    campaignTotalProtocolFeesMinted,
    tokenConfigTotalOutputMintedFromTc,
    tokenConfigNormalizationRemainderTotal,
  }
  const projection = projectRedaxConvertCounters(
    before,
    grossOut,
    protocolFee,
    normalizationRemainder,
  )
  if (projection === null) {
    return null
  }
  const amounts: RedaxConvertApprovedAmounts = {
    amountIn,
    amountInNormalized,
    normalizationRemainder,
    grossOut,
    protocolFee,
    netOut,
    projection,
  }
  const recordedLegacyAtaText = recordedLegacyAta.toBase58()
  const recordedOutputAtaText = recordedOutputAta.toBase58()

  return (connection: Connection): RedaxActionEffectProbe => {
    const readCoherentState = async (minContextSlot: number) =>
      ports.readConvertState(
        connection,
        programId,
        { wallet, campaign, tokenConfig, legacyMint, outputMint, protocolFeeVault },
        { commitment: REDAX_ACTION_COMMITMENT, minContextSlot },
      )
    /** The two token accounts the read resolved must be the two the record named. */
    const sameAccounts = (state: RedaxConvertCoherentStateFacts): boolean =>
      state.userLegacyAta.toBase58() === recordedLegacyAtaText &&
      state.userOutputAta.toBase58() === recordedOutputAtaText
    return {
      readEffectMatching: async (minContextSlot) => {
        const read = await readCoherentState(minContextSlot)
        if (!read.ok) {
          return EFFECT_UNAVAILABLE
        }
        if (!sameAccounts(read.state)) {
          return { kind: 'NOT_MATCHING', contextSlot: read.contextSlot }
        }
        return convertEffectMatches(before, read.state, amounts)
          ? { kind: 'MATCHING', contextSlot: read.contextSlot }
          : { kind: 'NOT_MATCHING', contextSlot: read.contextSlot }
      },
      readNoEffect: async (minContextSlot) => {
        const read = await readCoherentState(minContextSlot)
        if (!read.ok) {
          return EFFECT_UNAVAILABLE
        }
        if (!sameAccounts(read.state)) {
          return { kind: 'NOT_MATCHING', contextSlot: read.contextSlot }
        }
        return convertNoEffect(before, read.state)
          ? { kind: 'MATCHING', contextSlot: read.contextSlot }
          : { kind: 'NOT_MATCHING', contextSlot: read.contextSlot }
      },
      // As in the original convert: tokens can move for other reasons, so an
      // unattributed conversion is never this attempt's.
      allowsEffectPresentOriginUnknown: false,
    }
  }
}

/** The action-specific probe for one durable record, or a refusal. */
function planRedaxRecoveryEffectProbe(
  ports: RedaxHolderActionPorts,
  programId: PublicKey,
  wallet: PublicKey,
  record: RedaxHolderRecoveryJournalRecordV1,
): RedaxRecoveryProbePlan | null {
  return record.action === 'convert_exact_in'
    ? planConvertRecoveryProbe(ports, programId, wallet, record)
    : planPrepareRecoveryProbe(ports, wallet, record)
}

/**
 * Compose the explicit, non-transaction recovery reconciler.
 *
 * ONE explicit gesture gets ONE bounded terminal observation sequence, plus exactly the
 * journal readbacks and compare-and-set writes that sequence performs, plus ONE final
 * durable readback. There is no loop, no retry, no timer, no poll, no subscription and
 * no automatic second pass — a reconciliation that did not resolve is a completed
 * reconciliation, and asking again is a later human decision.
 *
 * THE RESULT IS READ FROM THE JOURNAL, NOT FROM THE OUTCOME. The neutral conclusion the
 * resolver returns is deliberately discarded: it describes what was OBSERVED, and the
 * caller must be told what is now DURABLY TRUE. Those differ exactly when a durable
 * write did not land, which is precisely the case a UI must not be allowed to unblock
 * on. So the record is re-read once and the projection comes from those bytes.
 */
export function createRedaxHolderRecoveryReconcile(
  deps: RedaxHolderActionDeps,
): () => Promise<RedaxHolderRecoveryRecheckResult> {
  const ports = deps.ports ?? REDAX_PRODUCTION_HOLDER_ACTION_PORTS

  return async function reconcileHolderRecovery() {
    const runtimeConfig = deps.runtimeConfig
    if (runtimeConfig === null) {
      return { ok: false, code: 'RUNTIME_CONFIG_UNAVAILABLE' }
    }
    // The connected wallet is read for ONE reason: it is a third of the journal
    // namespace. No signing capability is consulted, because nothing here signs.
    const wallet = deps.transport.publicKey
    if (!deps.transport.isConnected || wallet === null) {
      return { ok: false, code: 'WALLET_NOT_CONNECTED' }
    }
    let programId: PublicKey
    try {
      programId = new PublicKey(runtimeConfig.programId)
    } catch {
      return { ok: false, code: 'RUNTIME_CONFIG_UNAVAILABLE' }
    }
    const namespace: RedaxHolderRecoveryJournalNamespace = {
      cluster: REDAX_JOURNAL_CLUSTER,
      program: programId.toBase58(),
      wallet: wallet.toBase58(),
    }

    // 1. ADMISSION. The durable record is read FIRST and is the only authority for what
    //    happens next. Corrupt, incompatible, locked or unreadable all fail closed.
    const read = await ports.readJournal(namespace)
    if (!read.ok) {
      return { ok: false, code: 'JOURNAL_UNAVAILABLE' }
    }
    if (read.kind === 'EMPTY') {
      // Nothing to reconcile, and nothing written to say so.
      return { ok: true, kind: 'NO_ATTEMPT' }
    }
    const record: RedaxHolderRecoveryJournalRecordV1 = read.record
    if (
      // A tombstone is OVER. It is never reopened, never re-resolved and never
      // mutated — a second reconciliation of one is a projection and nothing else.
      read.kind === 'TOMBSTONE' ||
      // PRE_INVOCATION has observed nothing to reconcile, and its two transitions
      // belong to the origin session alone. It is never terminally reconciled here.
      record.lifecycle !== 'KNOWN_SIGNATURE' ||
      // No retained signature is no transaction identity, and this operation is
      // forbidden to go looking for one.
      record.knownSignature === null
    ) {
      return projectHolderRecoveryRecord(record)
    }
    // The EXACT retained signature, through the existing retention primitive — which is
    // where the branded type comes from. Nothing is searched for and nothing adopted.
    const retained = ports.retainSignature(record.knownSignature)
    if (!retained.ok) {
      return projectHolderRecoveryRecord(record)
    }

    // 2. The action-specific probe, planned from the durable record BEFORE any chain
    //    resource exists. An incoherent record stops here, having changed nothing.
    const plan = planRedaxRecoveryEffectProbe(ports, programId, wallet, record)
    if (plan === null) {
      return projectHolderRecoveryRecord(record)
    }

    // 3. One fresh READ-ONLY scoped Connection, the same shape the read-only re-check
    //    and the passive preflight use. It is never an attempt Connection: no attempt is
    //    opened here, and nothing send-capable is introduced by constructing it.
    const connection = new Connection(runtimeConfig.rpcUrl, REDAX_ACTION_COMMITMENT)

    // 4. The NARROW known-signature runtime, reconstructed entirely from the record.
    //    The cursor is the record's exact current identity, so every write below is a
    //    compare-and-set against the state this operation actually read. A concurrent
    //    session that has moved the record wins: the transition is refused, and there is
    //    no retry, no overwrite, no merge and no reset.
    const runtime: RedaxKnownSignatureRuntime = {
      ports,
      connection,
      namespace,
      cursor: { attemptNonce: record.attemptNonce, revision: record.revision },
      intendedMessage: record.intendedMessage,
      preflightFloor: record.preflightContextSlot,
      lastValidBlockHeight: record.lastValidBlockHeight,
      probe: plan(connection),
    }

    // 5. The EXISTING terminal logic, reused whole. Pending stays pending, unreadable
    //    stays unreadable, a message mismatch never resolves, confirmed is recorded and
    //    never resolved, and only finalized-plus-exact-effect resolves a success.
    await resolveKnownSignature(runtime, retained.knownSignature, true)

    // 6. ONE durable readback. Whatever the resolver concluded, this is what the record
    //    now says — and only what the record says may unblock anything.
    const after = await ports.readJournal(namespace)
    if (!after.ok) {
      return { ok: false, code: 'JOURNAL_UNAVAILABLE' }
    }
    if (after.kind === 'EMPTY') {
      return { ok: true, kind: 'NO_ATTEMPT' }
    }
    return projectHolderRecoveryRecord(after.record)
  }
}

/**
 * Compose the passive C1 SOL preflight read.
 *
 * It is NOT an action. It constructs no instruction and no Transaction, calls no
 * transport, signs nothing, sends nothing, confirms nothing, writes nothing to the
 * journal — it does not read the journal either — and returns no permission of any
 * kind. It runs only when something calls it: there is no timer, no polling, no
 * subscription and no automatic retry, and a caller that never calls it simply never
 * exposes the action.
 *
 * Every refusal is `READ_UNAVAILABLE` rather than a silent `SUFFICIENT`, because an
 * unknown balance must withhold an action, never allow one.
 */
export function createRedaxHolderSolPreflightRead(
  deps: RedaxHolderActionDeps,
): (actionKind: RedaxHolderSolPreflightActionKind) => Promise<RedaxHolderSolPreflightResult> {
  const ports = deps.ports ?? REDAX_PRODUCTION_HOLDER_ACTION_PORTS

  return async function readHolderSolPreflight(actionKind) {
    const runtimeConfig = deps.runtimeConfig
    if (runtimeConfig === null) {
      return 'READ_UNAVAILABLE'
    }
    const wallet = deps.transport.publicKey
    if (!deps.transport.isConnected || wallet === null) {
      return 'READ_UNAVAILABLE'
    }
    // One read-only scoped Connection, the same shape the explicit recovery re-check
    // uses. It is never an attempt Connection: no attempt exists here, so there is no
    // attempt floor to hold and no journal slot this read could belong to.
    const connection = new Connection(runtimeConfig.rpcUrl, REDAX_ACTION_COMMITMENT)
    const observation = await observeHolderSolPreflight(ports, connection, wallet, actionKind, null)
    // Only the verdict leaves. The balance, the threshold, the rent terms and the
    // context slot stay inside this file.
    return observation.result
  }
}

// --- The durable Convert receipt projection --------------------------------------------
//
// PLACED HERE DELIBERATELY, below every pinned construction site, and that placement is
// the only thing about it that is not next to its one caller. The construction-site
// census pins absolute `path:line` positions and remeasures a pin only when the COUNT or
// the OWNER of a site changes. This block constructs nothing and owns nothing, so it may
// not move one — and an interface and a function declaration are both usable above their
// own text, so reading order is all that changes here.
//
// The caller folds its two added statements onto lines that already existed, for exactly
// the same reason. Neither the move nor the folds change what is computed.

/**
 * The DURABLE context of one finalized conversion, projected for an explicit,
 * READ-ONLY receipt read.
 *
 * It is a projection of the saved record and nothing else — no chain read, no quote, no
 * decode, no screen state and no permission. Every member is copied verbatim from the
 * durable convert request the holder actually approved, so a later session can ask for
 * the receipt of THAT exact transaction without reconstructing anything.
 *
 * `signature` carries the whole known signature, and it is named `signature` on purpose:
 * the existing rule that no `.signature` member may be read inside rendered output then
 * governs this member too, so it can reach a request and never a rendered tree.
 *
 * It is NOT authority. It authorizes no action, resolves nothing, unblocks nothing, and
 * a caller that never reads it behaves exactly as it did before.
 */
export interface RedaxHolderRecoveryConvertReceiptContext {
  readonly signature: string
  readonly user: string
  readonly campaignId: string
  readonly tokenConfigId: string
  readonly legacyMint: string
  readonly outputMint: string
  readonly amountInRaw: string
  readonly grossOutRaw: string
  readonly feeOutRaw: string
  readonly userOutRaw: string
  readonly amountInNormalizedRaw: string
  readonly normalizationRemainderRaw: string
  readonly userOutputAta: string
  readonly protocolFeeVault: string
}

/**
 * The durable Convert receipt context one record carries, or `null`.
 *
 * FAIL-CLOSED, and every conjunct is checked EXPLICITLY. `resolved: true` alone is not
 * evidence of anything here — the record must be a convert tombstone whose own resolving
 * transitions wrote a finalized success, whose observation is the matching finalized
 * effect, whose finality is `finalized`, and which retained an exact signature. Anything
 * else — a prepare record, an unresolved attempt, a pre-invocation refusal, an accepted
 * failure, a message mismatch, a support disposition or an incoherent tombstone — has no
 * context at all, and the member is then ABSENT rather than present-and-undefined.
 *
 * Pure: it reads a frozen record and returns a value. Nothing is fetched, decoded,
 * recomputed or searched for, and the two amount members it renames — the protocol fee
 * and the net output — are the durable ones, never a fresh quote.
 */
function projectHolderRecoveryConvertReceipt(
  record: RedaxHolderRecoveryJournalRecordV1,
): RedaxHolderRecoveryConvertReceiptContext | null {
  if (
    record.action !== 'convert_exact_in' ||
    record.lifecycle !== 'TOMBSTONE' ||
    record.resolution !== 'FINALIZED_SUCCESS' ||
    record.observation !== 'FINALIZED_EFFECT_MATCHING' ||
    record.outcomeFinality !== 'finalized'
  ) {
    return null
  }
  const signature = record.knownSignature
  const request = record.request
  // The exact durable convert request, or nothing. A prepare request has no
  // `tokenConfig`, so this narrows structurally rather than by trusting the action.
  if (signature === null || !('tokenConfig' in request)) {
    return null
  }
  const context: RedaxHolderRecoveryConvertReceiptContext = {
    signature,
    // The journal namespace's own wallet — never a currently connected one.
    user: record.namespace.wallet,
    campaignId: request.campaign,
    tokenConfigId: request.tokenConfig,
    legacyMint: request.legacyMint,
    outputMint: request.outputMint,
    amountInRaw: request.amountInRaw,
    grossOutRaw: request.grossOutRaw,
    feeOutRaw: request.protocolFeeRaw,
    userOutRaw: request.netOutRaw,
    amountInNormalizedRaw: request.amountInNormalizedRaw,
    normalizationRemainderRaw: request.normalizationRemainderRaw,
    userOutputAta: request.userOutputAta,
    protocolFeeVault: request.protocolFeeVault,
  }
  // One last fail-closed pass. The journal already validates each field, and a frozen
  // record is still not the same thing as a record this function has established the
  // shape of — a missing or empty member yields no context rather than a partial one.
  for (const value of Object.values(context)) {
    if (typeof value !== 'string' || value === '') {
      return null
    }
  }
  return context
}

// --- The provider ---------------------------------------------------------------------

interface RedaxWalletActionsProviderProps {
  children: ReactNode
}

/**
 * Mounts the REDAX Holder action bridge.
 *
 * It resolves the controlled runtime action config once (pure; no RPC), consumes the
 * private wallet transport, and composes exactly the two production action executors
 * plus the three members that are not actions — the read-only re-check, the explicit
 * non-transaction reconciler and the passive SOL preflight. It renders only its children
 * and runs NOTHING on mount or in any effect: every one of the five executes solely when
 * something explicitly calls it. Composition itself performs no read, no write and no
 * reconciliation.
 *
 * When the runtime config is unavailable (any non-DEVNET_TX_ENABLED or invalid
 * config), the composed actions still exist but refuse immediately with a typed,
 * value-free result. There is no partially-armed state.
 */
export function RedaxWalletActionsProvider({ children }: RedaxWalletActionsProviderProps) {
  const transport = useRedaxWalletActionTransport()
  const runtimeConfig = useMemo(() => resolveRedaxRuntimeActionConfig(), [])

  const value = useMemo<RedaxWalletActionsContextValue>(() => {
    const deps: RedaxHolderActionDeps = {
      // The resolver refuses a null cluster before reporting success; only its declared
      // type still admits one. Requiring it explicitly here keeps the executor
      // dependency non-null without a cast, and fails closed rather than assuming it.
      runtimeConfig:
        runtimeConfig.ok && runtimeConfig.cluster !== null
          ? {
              mode: runtimeConfig.mode,
              cluster: runtimeConfig.cluster,
              programId: runtimeConfig.programId,
              rpcUrl: runtimeConfig.rpcUrl,
            }
          : null,
      runtimeConfigCode: runtimeConfig.ok ? undefined : runtimeConfig.code,
      transport,
      ports: REDAX_PRODUCTION_HOLDER_ACTION_PORTS,
    }
    return {
      canPrepareUserOutputAta: runtimeConfig.ok && transport.isConnected,
      prepareUserOutputAta: createRedaxPrepareUserOutputAtaAction(deps),
      canConvertExactIn: runtimeConfig.ok && transport.isConnected,
      convertExactIn: createRedaxConvertExactInAction(deps),
      recheckHolderRecovery: createRedaxHolderRecoveryRecheck(deps),
      reconcileHolderRecovery: createRedaxHolderRecoveryReconcile(deps),
      readHolderSolPreflight: createRedaxHolderSolPreflightRead(deps),
    }
  }, [runtimeConfig, transport])

  return <RedaxWalletActionsContext.Provider value={value}>{children}</RedaxWalletActionsContext.Provider>
}
