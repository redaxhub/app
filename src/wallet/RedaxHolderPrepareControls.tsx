// REDAX Holder-only "prepare output token account" panel (DEVNET_TX_ENABLED only).
//
// Boundary: this is one of exactly two surfaces that invoke a wallet action bridge
// transaction action, and it does so exclusively from an explicit user button click —
// never on mount, never in an effect, never on connect, never on page load, and never
// automatically. It is a wallet/ module component (like RedaxWalletControls), so the
// "screens never see the wallet facade" boundary holds: HolderTrialScreen renders this
// as an opaque slot.
//
// It consumes only the narrow facade hooks — useRedaxWallet (connection state +
// user-initiated connect/disconnect) and useRedaxWalletActions (canPrepareUserOutputAta
// + prepareUserOutputAta + the read-only recheckHolderRecovery + the explicit
// non-transaction reconcileHolderRecovery) — never the raw adapter, never a generic
// sendTransaction, and never a foundation module (not even for a type: every nested
// vocabulary below is derived structurally from the bridge's own exported unions).
//
// THE PANEL OWNS THREE GESTURES, AND ONLY ONE OF THEM IS A TRANSACTION. Preparing is
// the transaction action. Checking the saved attempt is read-only and settles nothing.
// Reconciling the saved attempt is neither: it sends nothing and signs nothing, and it
// is the only gesture that may let the durable saved record settle — from devnet
// evidence that is already terminal, and never from anything this panel is showing.
// All three share ONE mounted-control latch, and the reconciliation is offered only
// against this panel's OWN unresolved saved attempt.
//
// AUTHORITY. `ok: true` from the bridge IS the finalized terminal result. It already
// requires a finalized, message- and metadata-clean, effect-verified attempt whose
// durable attempt record was resolved on that, read on the attempt's own connection.
// This panel therefore consumes `ok: true` directly and NEVER re-derives, re-reads or
// downgrades it. The read-only holder-context read that remains is for resting account
// presentation and call-to-action gating only; it is not evidence and not authority.
//
// PRESENTATION IS SOURCE-TOTAL. Every one of the bridge's 37 typed prepare results and
// every one of the 52 typed saved-attempt combinations maps to exactly one fail-closed
// presentation class. Replaceability is never inferred from a `resolved` boolean; it is
// derived from the typed (resolved, observation) combination. Deprecated compatibility
// literals stay total mapper cases, and no branch claims a decline or a non-submission.
//
// SEVEN OF THOSE RESULTS ARE NEW, AND SIX OF THEM MEAN "NOTHING WAS SENT". The bridge
// asks a wallet to SIGN and sends the verified bytes itself, so a declined signature, an
// unreadable signed transaction and a signed message that is not the approved one are
// all facts about a transaction that does not exist — and the copy for them says that
// rather than hedging. The seventh is post-broadcast and never claims otherwise.
//
// Devnet only. No raw signature (only a shortened one, and only when the typed result
// carries it), no raw address, no provider message, no readiness claim.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  useRedaxWalletActions,
  type RedaxHolderRecoveryRecheckResult,
  type RedaxHolderSolPreflightResult,
  type RedaxPrepareUserOutputAtaResult,
  type RedaxWalletActionPhase,
} from './RedaxWalletActions'
import { useRedaxWallet } from './RedaxWalletProvider'
import type { RedaxDataSource } from '../data/redaxDataSource'
import type {
  RedaxCampaignView,
  RedaxConnectedWalletHolderContextView,
  RedaxWalletAtaStatus,
} from '../data/redaxViewModels'
import { StatusPill } from '../components/StatusPill'
import {
  HOLDER_ACTION_PILL,
  HOLDER_CURRENT_OBSERVATION_COPY,
  HOLDER_DURABLE_OBSERVATION_COPY,
  HOLDER_EVIDENCE_ACTION_CONTEXT_SLOT_LABEL,
  HOLDER_EVIDENCE_CURRENT_OBSERVATION_LABEL,
  HOLDER_EVIDENCE_CURRENT_OBSERVATION_NOTE,
  HOLDER_EVIDENCE_DURABLE_OBSERVATION_LABEL,
  HOLDER_EVIDENCE_FINALITY_LABEL,
  HOLDER_EVIDENCE_SIGNATURE_LABEL,
  HOLDER_EVIDENCE_SIGNATURE_NOTE,
  HOLDER_FINALITY_COPY,
  HOLDER_OPERATION_ACTIVE,
  HOLDER_RECOVERY_BOUNDARY,
  HOLDER_RECOVERY_BUTTON,
  HOLDER_RECOVERY_CHECKING,
  HOLDER_RECOVERY_EYEBROW,
  HOLDER_RECOVERY_LOCAL_PROJECTION_NOTE,
  HOLDER_RECOVERY_NON_AUTHORIZATION,
  HOLDER_RECOVERY_NOT_CHECKED,
  HOLDER_RECOVERY_NO_LOCAL_CHANGE,
  HOLDER_RECOVERY_OTHER_ACTION_BLOCK,
  HOLDER_RECOVERY_OTHER_ACTION_CLEAR,
  HOLDER_RECOVERY_PILL,
  HOLDER_RECOVERY_RECONCILE_BUTTON,
  HOLDER_RECOVERY_RECONCILE_EXPLANATION,
  HOLDER_RECOVERY_RECONCILE_IN_PROGRESS,
  HOLDER_RECOVERY_RECONCILE_NON_AUTHORIZATION,
  HOLDER_RECOVERY_RECONCILE_NO_PROMISE,
  HOLDER_RECOVERY_SCOPE_NOTE,
  HOLDER_RECOVERY_SHARED_SLOT_NOTE,
  HOLDER_RECOVERY_TITLE,
  PREPARE_ACTION_COPY,
  PREPARE_ATA_ALREADY_PREPARED,
  PREPARE_ATA_AWAITING_APPROVAL,
  PREPARE_ATA_AWAITING_APPROVAL_PILL,
  PREPARE_ATA_BUTTON,
  PREPARE_ATA_CONFIRMING,
  PREPARE_ATA_CONNECT_NONE,
  PREPARE_ATA_CONNECT_PROMPT,
  PREPARE_ATA_DEVNET_BOUNDARY,
  PREPARE_ATA_EYEBROW,
  PREPARE_ATA_INELIGIBLE,
  PREPARE_ATA_MISMATCH,
  PREPARE_ATA_MISSING_NOTE,
  PREPARE_ATA_PANEL_TITLE,
  PREPARE_ATA_PREVIEW_BODY,
  PREPARE_ATA_READING,
  PREPARE_ATA_RECONCILING_PILL,
  PREPARE_ATA_RENT_WARNING,
  PREPARE_ATA_UNAVAILABLE,
  PREPARE_PREFLIGHT_FAILURE_COPY,
  PREPARE_RECOVERY_COPY,
  PREPARE_RETURN_TO_STATUS_HELP,
  PREPARE_RETURN_TO_STATUS_LABEL,
  PREPARE_SOL_PREFLIGHT_INSUFFICIENT,
  PREPARE_SOL_PREFLIGHT_READING,
  PREPARE_SOL_PREFLIGHT_RECHECK_LABEL,
  PREPARE_SOL_PREFLIGHT_UNAVAILABLE,
  type RedaxHolderCurrentObservationCopyKey,
  type RedaxHolderDurableObservationCopyKey,
  type RedaxHolderFinalityCopyKey,
  type RedaxHolderPreflightFailureCopyKey,
  type RedaxHolderPrepareActionPresentationKind,
  type RedaxHolderRecoveryPresentationKind,
} from '../lib/productCopy'

// --- Structural type derivation ------------------------------------------------
//
// The nested vocabulary the presentation needs is owned by foundation modules this
// component may not import — not even type-only. It is therefore derived from the
// bridge's exported public result unions with Extract / indexed access / NonNullable
// only. No literal union is re-declared, nothing is cast, and nothing is re-exported.

type PrepareFailure = Extract<RedaxPrepareUserOutputAtaResult, { ok: false }>
type PrepareFailureCode = PrepareFailure['code']
type RecoveryPresent = Extract<
  RedaxHolderRecoveryRecheckResult,
  { ok: true; kind: 'ATTEMPT_PRESENT' }
>
type RecoveryRefusal = Extract<RedaxHolderRecoveryRecheckResult, { ok: false }>
type RecoveryRefusalCode = RecoveryRefusal['code']
type RecoveryAction = RecoveryPresent['action']
type RecoveryObservation = RecoveryPresent['observation']

/** This panel's own action within the shared, wallet-scoped saved-attempt slot. */
const PREPARE_RECOVERY_ACTION: RecoveryAction = 'prepare_user_output_ata'

// --- Presentation model --------------------------------------------------------

/** Visual tone of one presentation class. Presentation only; never authority. */
export type RedaxHolderPresentationTone = 'neutral' | 'positive' | 'caution' | 'info'

/** Which panel a saved-attempt record belongs to, relative to this one. */
export type RedaxHolderRecoveryScope = 'MATCHING_ACTION' | 'OTHER_ACTION' | 'NOT_ACTION_SPECIFIC'

/** One typed prepare result, resolved to exactly one fail-closed presentation class. */
export interface RedaxPrepareActionPresentation {
  readonly kind: RedaxHolderPrepareActionPresentationKind
  readonly tone: RedaxHolderPresentationTone
  readonly pill: string
  readonly lead: string
  /** The code-specific explanation for a pre-invocation refusal; null otherwise. */
  readonly detail: string | null
  /** Whether a LATER, separately gated, explicit human gesture may start a new action. */
  readonly permitsNewExplicitAction: boolean
  readonly offersRecoveryCheck: boolean
  /** Whether this class may display a shortened signature / finality / context slot. */
  readonly showsEvidence: boolean
}

/** One typed saved-attempt result, resolved to exactly one fail-closed class. */
export interface RedaxPrepareRecoveryPresentation {
  readonly kind: RedaxHolderRecoveryPresentationKind
  readonly scope: RedaxHolderRecoveryScope
  readonly tone: RedaxHolderPresentationTone
  readonly pill: string
  readonly text: string
  /** Positively known to block. Never derived from `resolved` alone. */
  readonly blocksNewAction: boolean
  /** Source-proven replaceable (or absent), so a local fail-closed block may lift. */
  readonly clearsLocalBlock: boolean
  readonly showsEvidence: boolean
  readonly durableObservation: RedaxHolderDurableObservationCopyKey | null
  readonly shortSignature: string | null
  readonly currentObservation: RedaxHolderCurrentObservationCopyKey | null
  readonly currentFinality: RedaxHolderFinalityCopyKey | null
}

interface ActionClassFacts {
  readonly tone: RedaxHolderPresentationTone
  readonly permitsNewExplicitAction: boolean
  readonly offersRecoveryCheck: boolean
  readonly showsEvidence: boolean
}

const PREPARE_ACTION_CLASS: Record<RedaxHolderPrepareActionPresentationKind, ActionClassFacts> = {
  FINALIZED_SUCCESS: {
    tone: 'positive',
    permitsNewExplicitAction: true,
    offersRecoveryCheck: false,
    showsEvidence: true,
  },
  PREFLIGHT_REFUSED: {
    tone: 'caution',
    permitsNewExplicitAction: true,
    offersRecoveryCheck: true,
    showsEvidence: false,
  },
  WALLET_UNAVAILABLE: {
    tone: 'neutral',
    permitsNewExplicitAction: false,
    offersRecoveryCheck: false,
    showsEvidence: false,
  },
  RUNTIME_REFUSED: {
    tone: 'neutral',
    permitsNewExplicitAction: false,
    offersRecoveryCheck: false,
    showsEvidence: false,
  },
  // The base is fail-closed; only the codes that are an ordinary input correction
  // widen it, and they do so per code rather than per class.
  PREFLIGHT_FAILURE: {
    tone: 'caution',
    permitsNewExplicitAction: false,
    offersRecoveryCheck: false,
    showsEvidence: false,
  },
  PRIOR_ATTEMPT_BLOCKS: {
    tone: 'caution',
    permitsNewExplicitAction: false,
    offersRecoveryCheck: true,
    showsEvidence: false,
  },
  JOURNAL_FAIL_CLOSED: {
    tone: 'caution',
    permitsNewExplicitAction: false,
    offersRecoveryCheck: true,
    showsEvidence: false,
  },
  POST_UNKNOWN_NO_SIGNATURE: {
    tone: 'caution',
    permitsNewExplicitAction: false,
    offersRecoveryCheck: true,
    showsEvidence: false,
  },
  SIGNATURE_OBSERVED: {
    tone: 'info',
    permitsNewExplicitAction: false,
    offersRecoveryCheck: true,
    showsEvidence: true,
  },
  CONFIRMATION_PENDING: {
    tone: 'info',
    permitsNewExplicitAction: false,
    offersRecoveryCheck: true,
    showsEvidence: true,
  },
  LANDED_FAILED_PROVISIONAL: {
    tone: 'caution',
    permitsNewExplicitAction: false,
    offersRecoveryCheck: true,
    showsEvidence: true,
  },
  LANDED_FAILED_RESOLVED: {
    tone: 'caution',
    permitsNewExplicitAction: true,
    offersRecoveryCheck: true,
    showsEvidence: true,
  },
  LANDED_MESSAGE_MISMATCH: {
    tone: 'caution',
    permitsNewExplicitAction: false,
    offersRecoveryCheck: true,
    showsEvidence: true,
  },
  CONFIRMED_MATCHING_PROVISIONAL: {
    tone: 'info',
    permitsNewExplicitAction: false,
    offersRecoveryCheck: true,
    showsEvidence: true,
  },
  READ_UNAVAILABLE: {
    tone: 'caution',
    permitsNewExplicitAction: false,
    offersRecoveryCheck: true,
    showsEvidence: true,
  },
  SUPPORT_ONLY: {
    tone: 'caution',
    permitsNewExplicitAction: false,
    offersRecoveryCheck: true,
    showsEvidence: true,
  },
  INCONSISTENT_NON_SUCCESS: {
    tone: 'caution',
    permitsNewExplicitAction: false,
    offersRecoveryCheck: true,
    showsEvidence: true,
  },
  DEPRECATED_COMPATIBILITY_NON_SUCCESS: {
    tone: 'caution',
    permitsNewExplicitAction: false,
    offersRecoveryCheck: true,
    showsEvidence: true,
  },
  EFFECT_ORIGIN_UNKNOWN: {
    tone: 'caution',
    permitsNewExplicitAction: false,
    offersRecoveryCheck: true,
    showsEvidence: false,
  },
}

/**
 * Which pre-invocation refusals are an ordinary input / state correction the holder can
 * act on, and which are not. Both are pre-invocation, so neither is a repeat of a
 * submitted transaction.
 */
const PREPARE_PREFLIGHT_ORDINARY_CORRECTION: Record<RedaxHolderPreflightFailureCopyKey, boolean> = {
  INVALID_REQUEST: true,
  INVALID_AMOUNT: true,
  BUILD_FAILED: true,
  CHAIN_STATE_UNAVAILABLE: true,
  CHAIN_GUARD_REFUSED: false,
  QUOTE_REJECTED: true,
  CAP_EXCEEDED: true,
  MESSAGE_COMMITMENT_UNAVAILABLE: false,
  OUTPUT_ACCOUNT_NOT_READY: true,
  // Funding the connected wallet is an ordinary correction a holder can make, and the
  // refusal was pre-invocation, so a later explicit gesture is permitted. It still has
  // to pass every check again, this one included.
  PAYER_SOL_INSUFFICIENT: true,
}

interface RecoveryClassFacts {
  readonly tone: RedaxHolderPresentationTone
  readonly blocksNewAction: boolean
  readonly clearsLocalBlock: boolean
  readonly showsEvidence: boolean
}

const PREPARE_RECOVERY_CLASS: Record<RedaxHolderRecoveryPresentationKind, RecoveryClassFacts> = {
  CURRENT_WALLET_REFUSED: {
    tone: 'neutral',
    blocksNewAction: false,
    clearsLocalBlock: false,
    showsEvidence: false,
  },
  RUNTIME_REFUSED: {
    tone: 'neutral',
    blocksNewAction: false,
    clearsLocalBlock: false,
    showsEvidence: false,
  },
  JOURNAL_FAIL_CLOSED: {
    tone: 'caution',
    blocksNewAction: true,
    clearsLocalBlock: false,
    showsEvidence: false,
  },
  NO_SAVED_ATTEMPT: {
    tone: 'neutral',
    blocksNewAction: false,
    clearsLocalBlock: true,
    showsEvidence: false,
  },
  UNRESOLVED_ATTEMPT: {
    tone: 'caution',
    blocksNewAction: true,
    clearsLocalBlock: false,
    showsEvidence: true,
  },
  REPLACEABLE_PRE_INVOCATION_TOMBSTONE: {
    tone: 'neutral',
    blocksNewAction: false,
    clearsLocalBlock: true,
    showsEvidence: true,
  },
  REPLACEABLE_FINALIZED_SUCCESS_TOMBSTONE: {
    tone: 'positive',
    blocksNewAction: false,
    clearsLocalBlock: true,
    showsEvidence: true,
  },
  REPLACEABLE_ACCEPTED_KNOWN_SIGNATURE_FAILURE_TOMBSTONE: {
    tone: 'caution',
    blocksNewAction: false,
    clearsLocalBlock: true,
    showsEvidence: true,
  },
  PERMANENTLY_NON_REPLACEABLE_SUPPORT_TOMBSTONE: {
    tone: 'caution',
    blocksNewAction: true,
    clearsLocalBlock: false,
    showsEvidence: true,
  },
  INCONSISTENT_RESOLVED_FAIL_CLOSED: {
    tone: 'caution',
    blocksNewAction: true,
    clearsLocalBlock: false,
    showsEvidence: true,
  },
}

/**
 * Compile-time exhaustiveness gate. A literal that is not handled above becomes a type
 * error here; at runtime the caller still fails closed rather than interpreting it.
 */
function prepareUnhandledLiteral(_value: never): 'INCONSISTENT_NON_SUCCESS' {
  return 'INCONSISTENT_NON_SUCCESS'
}

function prepareUnhandledRecoveryLiteral(_value: never): 'INCONSISTENT_RESOLVED_FAIL_CLOSED' {
  return 'INCONSISTENT_RESOLVED_FAIL_CLOSED'
}

// A base58 transaction signature is far longer than this; anything shorter cannot be
// shortened without disclosing it whole, so it is not displayed at all.
const REDAX_SHORT_SIGNATURE_MINIMUM = 16
const REDAX_SHORT_SIGNATURE_EDGE = 4

/**
 * Shorten one attempt's own transaction signature for display.
 *
 * Pure and total: it never throws, never renders a full value, and returns null when
 * the input is too short to shorten. It is never a list, a candidate page or history.
 */
export function redaxShortSignature(signature: string): string | null {
  const trimmed = signature.trim()
  if (trimmed.length < REDAX_SHORT_SIGNATURE_MINIMUM) {
    return null
  }
  const head = trimmed.slice(0, REDAX_SHORT_SIGNATURE_EDGE)
  const tail = trimmed.slice(trimmed.length - REDAX_SHORT_SIGNATURE_EDGE)
  return `${head}…${tail}`
}

function prepareActionPresentation(
  kind: RedaxHolderPrepareActionPresentationKind,
  detail: string | null,
  permitsOverride: boolean | null,
): RedaxPrepareActionPresentation {
  const facts = PREPARE_ACTION_CLASS[kind]
  return {
    kind,
    tone: facts.tone,
    pill: HOLDER_ACTION_PILL[kind],
    lead: PREPARE_ACTION_COPY[kind],
    detail,
    permitsNewExplicitAction:
      permitsOverride === null ? facts.permitsNewExplicitAction : permitsOverride,
    offersRecoveryCheck: facts.offersRecoveryCheck,
    showsEvidence: facts.showsEvidence,
  }
}

function preparePreflightFailurePresentation(
  code: RedaxHolderPreflightFailureCopyKey,
): RedaxPrepareActionPresentation {
  return prepareActionPresentation(
    'PREFLIGHT_FAILURE',
    PREPARE_PREFLIGHT_FAILURE_COPY[code],
    PREPARE_PREFLIGHT_ORDINARY_CORRECTION[code],
  )
}

// --- The sign-only vocabulary ------------------------------------------------------
//
// WHY THIS COPY IS OWNED HERE. The bridge no longer asks a wallet to SEND: it asks a
// wallet to SIGN, verifies the signed transaction against the exact approved one, and
// sends the bytes itself. That makes six new results possible, and every one of them
// is a fact about a transaction this app never broadcast.
//
// The shared copy table has no sentence for that. Its closest classes both say
// "refused before your wallet was asked", which is precisely what is NOT true once a
// wallet has been asked to sign and has declined, or has handed back something other
// than the approved transaction. So the CLASS is still a shared one — this panel
// invents no new presentation class, no new pill and no new tone — and only the lead
// sentence is owned here. Like every other, it is fixed and value-free: no address, no
// signature, no wallet name, no provider message, no error text and no number.

/** The sign-only results, derived from the bridge's own union rather than re-declared. */
type PrepareSignOnlyCode = Extract<
  PrepareFailureCode,
  | 'WALLET_SIGN_ONLY_UNAVAILABLE'
  | 'WALLET_SIGN_ONLY_FAILED'
  | 'SIGNED_TRANSACTION_UNREADABLE'
  | 'SIGNED_MESSAGE_VERIFICATION_UNAVAILABLE'
  | 'SIGNED_MESSAGE_MISMATCH'
  | 'SIGNATURE_UNUSABLE'
  | 'RPC_SIGNATURE_MISMATCH'
>

/**
 * Which shared class each one presents as.
 *
 * The six pre-broadcast results carry the "refused before send" class: nothing was
 * broadcast, the durable record closed as a pre-invocation refusal, and a later
 * explicit human gesture may start a fresh attempt. An absent signing capability is
 * the exception — there is nothing to correct in this panel and no action authority,
 * so it presents as the wallet-unavailable class.
 *
 * The one POST-broadcast result carries the support class, which is the only honest
 * place for it: the transaction was sent, two candidate identities exist, and neither
 * this panel nor the bridge may prefer one or send anything again.
 */
const PREPARE_SIGN_ONLY_CLASS: Record<
  PrepareSignOnlyCode,
  RedaxHolderPrepareActionPresentationKind
> = {
  WALLET_SIGN_ONLY_UNAVAILABLE: 'WALLET_UNAVAILABLE',
  WALLET_SIGN_ONLY_FAILED: 'PREFLIGHT_REFUSED',
  SIGNED_TRANSACTION_UNREADABLE: 'PREFLIGHT_REFUSED',
  SIGNED_MESSAGE_VERIFICATION_UNAVAILABLE: 'PREFLIGHT_REFUSED',
  SIGNED_MESSAGE_MISMATCH: 'PREFLIGHT_REFUSED',
  SIGNATURE_UNUSABLE: 'PREFLIGHT_REFUSED',
  RPC_SIGNATURE_MISMATCH: 'SUPPORT_ONLY',
}

const PREPARE_SIGN_ONLY_COPY: Record<PrepareSignOnlyCode, string> = {
  WALLET_SIGN_ONLY_UNAVAILABLE:
    'Your wallet did not offer a signing-only request, so it was never asked and nothing was sent. This app signs and sends as two separate steps and does not ask a wallet to send a transaction on your behalf.',
  WALLET_SIGN_ONLY_FAILED:
    'The signing request did not complete in your wallet. Nothing was sent to devnet: this app sends the transaction itself, and it never reached that step.',
  SIGNED_TRANSACTION_UNREADABLE:
    'The signed transaction your wallet returned could not be read here, so it was not sent. Nothing reached devnet.',
  SIGNED_MESSAGE_VERIFICATION_UNAVAILABLE:
    'The signed transaction could not be verified in this browser, so it was not sent. Nothing reached devnet.',
  SIGNED_MESSAGE_MISMATCH:
    'The transaction your wallet signed is not the transaction that was approved here, so it was not sent. Nothing reached devnet.',
  SIGNATURE_UNUSABLE:
    'The signature your wallet returned could not be used, so the transaction was not sent. Nothing reached devnet.',
  RPC_SIGNATURE_MISMATCH:
    'The transaction was sent, and devnet answered with a different transaction signature than the one signed here. This attempt cannot be resolved automatically and needs support. Nothing is sent again.',
}

function prepareSignOnlyPresentation(code: PrepareSignOnlyCode): RedaxPrepareActionPresentation {
  const kind = PREPARE_SIGN_ONLY_CLASS[code]
  const facts = PREPARE_ACTION_CLASS[kind]
  return {
    kind,
    tone: facts.tone,
    pill: HOLDER_ACTION_PILL[kind],
    lead: PREPARE_SIGN_ONLY_COPY[code],
    detail: null,
    permitsNewExplicitAction: facts.permitsNewExplicitAction,
    offersRecoveryCheck: facts.offersRecoveryCheck,
    showsEvidence: facts.showsEvidence,
  }
}

/**
 * Resolve one typed prepare result to exactly one presentation class.
 *
 * TOTAL over all 37 typed inputs — `ok: true` plus the 36 failure codes, including the
 * seven sign-only results, the three deprecated compatibility literals and the
 * inconsistent `ok: false` + `FINALIZED_EFFECT_MATCHING` arm, which can never become a
 * success. Pure: it reads no runtime state, sends nothing, and returns no
 * authorization.
 */
export function resolveRedaxPrepareActionPresentation(
  result: RedaxPrepareUserOutputAtaResult,
): RedaxPrepareActionPresentation {
  if (result.ok) {
    return prepareActionPresentation('FINALIZED_SUCCESS', null, null)
  }
  const code: PrepareFailureCode = result.code
  switch (code) {
    case 'PREFLIGHT_REFUSED':
      return prepareActionPresentation('PREFLIGHT_REFUSED', null, null)
    case 'WALLET_NOT_CONNECTED':
      return prepareActionPresentation('WALLET_UNAVAILABLE', null, null)
    case 'WRONG_MODE':
    case 'RUNTIME_CONFIG_UNAVAILABLE':
      return prepareActionPresentation('RUNTIME_REFUSED', null, null)
    case 'INVALID_REQUEST':
    case 'INVALID_AMOUNT':
    case 'BUILD_FAILED':
    case 'CHAIN_STATE_UNAVAILABLE':
    case 'CHAIN_GUARD_REFUSED':
    case 'QUOTE_REJECTED':
    case 'CAP_EXCEEDED':
    case 'MESSAGE_COMMITMENT_UNAVAILABLE':
    case 'OUTPUT_ACCOUNT_NOT_READY':
    case 'PAYER_SOL_INSUFFICIENT':
      return preparePreflightFailurePresentation(code)
    case 'ATTEMPT_BLOCKED':
      return prepareActionPresentation('PRIOR_ATTEMPT_BLOCKS', null, null)
    case 'JOURNAL_UNAVAILABLE':
      return prepareActionPresentation('JOURNAL_FAIL_CLOSED', null, null)
    case 'SUBMISSION_OUTCOME_UNKNOWN_WITHOUT_SIGNATURE':
      return prepareActionPresentation('POST_UNKNOWN_NO_SIGNATURE', null, null)
    case 'SIGNATURE_OBSERVED':
      return prepareActionPresentation('SIGNATURE_OBSERVED', null, null)
    case 'CONFIRMATION_PENDING':
      return prepareActionPresentation('CONFIRMATION_PENDING', null, null)
    case 'LANDED_TRANSACTION_FAILED':
      return prepareActionPresentation(
        result.finality === 'finalized' ? 'LANDED_FAILED_RESOLVED' : 'LANDED_FAILED_PROVISIONAL',
        null,
        null,
      )
    case 'LANDED_MESSAGE_MISMATCH':
      return prepareActionPresentation('LANDED_MESSAGE_MISMATCH', null, null)
    // The sign-only vocabulary. The first six are ZERO REDAX BROADCAST and say so; the
    // last is post-broadcast and must never be presented as though nothing was sent.
    case 'WALLET_SIGN_ONLY_UNAVAILABLE':
    case 'WALLET_SIGN_ONLY_FAILED':
    case 'SIGNED_TRANSACTION_UNREADABLE':
    case 'SIGNED_MESSAGE_VERIFICATION_UNAVAILABLE':
    case 'SIGNED_MESSAGE_MISMATCH':
    case 'SIGNATURE_UNUSABLE':
    case 'RPC_SIGNATURE_MISMATCH':
      return prepareSignOnlyPresentation(code)
    case 'CONFIRMED_EFFECT_MATCHING':
      return prepareActionPresentation('CONFIRMED_MATCHING_PROVISIONAL', null, null)
    // `ok: false` can never be a success, whatever it observed.
    case 'FINALIZED_EFFECT_MATCHING':
      return prepareActionPresentation('INCONSISTENT_NON_SUCCESS', null, null)
    case 'READ_UNAVAILABLE':
      return prepareActionPresentation('READ_UNAVAILABLE', null, null)
    case 'SUPPORT_ONLY':
      return prepareActionPresentation('SUPPORT_ONLY', null, null)
    case 'EFFECT_PRESENT_ORIGIN_UNKNOWN':
      return prepareActionPresentation('EFFECT_ORIGIN_UNKNOWN', null, null)
    // Deprecated compatibility literals. No production path emits them after
    // invocation; they remain total, fail-closed cases and claim nothing.
    case 'SEND_FAILED':
    case 'USER_REJECTED':
    case 'CONFIRM_FAILED':
      return prepareActionPresentation('DEPRECATED_COMPATIBILITY_NON_SUCCESS', null, null)
    default:
      return prepareActionPresentation(prepareUnhandledLiteral(code), null, null)
  }
}

function prepareRecoveryPresentation(
  kind: RedaxHolderRecoveryPresentationKind,
  scope: RedaxHolderRecoveryScope,
  record: RecoveryPresent | null,
): RedaxPrepareRecoveryPresentation {
  const facts = PREPARE_RECOVERY_CLASS[kind]
  // Only the panel whose own action matches the saved record shows its detail. The
  // sibling panel infers nothing from it — no campaign, no token config, no signature.
  const showsEvidence = facts.showsEvidence && scope === 'MATCHING_ACTION' && record !== null
  const text =
    scope === 'OTHER_ACTION'
      ? facts.blocksNewAction
        ? HOLDER_RECOVERY_OTHER_ACTION_BLOCK
        : HOLDER_RECOVERY_OTHER_ACTION_CLEAR
      : PREPARE_RECOVERY_COPY[kind]
  const signature = showsEvidence && record !== null && record.signature !== null
    ? redaxShortSignature(record.signature)
    : null
  return {
    kind,
    scope,
    tone: facts.tone,
    pill: HOLDER_RECOVERY_PILL[kind],
    text,
    blocksNewAction: facts.blocksNewAction,
    clearsLocalBlock: facts.clearsLocalBlock,
    showsEvidence,
    durableObservation: showsEvidence && record !== null ? record.observation : null,
    shortSignature: signature,
    currentObservation: showsEvidence && record !== null ? record.outcome ?? null : null,
    currentFinality: showsEvidence && record !== null ? record.finality ?? null : null,
  }
}

/**
 * Resolve one typed saved-attempt result to exactly one presentation class.
 *
 * TOTAL over all 52 typed inputs — 3 refusals, `NO_ATTEMPT`, and both actions across
 * both `resolved` values across all 11 observations plus `null`.
 *
 * Replaceability is NEVER inferred from `resolved: true` alone. Only the four
 * observation sets that the durable record's own resolving transitions write are
 * treated as tombstones, exactly three of them are replaceable, the support disposition
 * is permanently non-replaceable, and every other resolved combination fails closed.
 */
export function resolveRedaxPrepareRecoveryPresentation(
  result: RedaxHolderRecoveryRecheckResult,
): RedaxPrepareRecoveryPresentation {
  if (!result.ok) {
    const code: RecoveryRefusalCode = result.code
    switch (code) {
      case 'WALLET_NOT_CONNECTED':
        return prepareRecoveryPresentation('CURRENT_WALLET_REFUSED', 'NOT_ACTION_SPECIFIC', null)
      case 'RUNTIME_CONFIG_UNAVAILABLE':
        return prepareRecoveryPresentation('RUNTIME_REFUSED', 'NOT_ACTION_SPECIFIC', null)
      case 'JOURNAL_UNAVAILABLE':
        return prepareRecoveryPresentation('JOURNAL_FAIL_CLOSED', 'NOT_ACTION_SPECIFIC', null)
      default:
        return prepareRecoveryPresentation(
          prepareUnhandledRecoveryLiteral(code),
          'NOT_ACTION_SPECIFIC',
          null,
        )
    }
  }
  if (result.kind === 'NO_ATTEMPT') {
    return prepareRecoveryPresentation('NO_SAVED_ATTEMPT', 'NOT_ACTION_SPECIFIC', null)
  }
  const scope: RedaxHolderRecoveryScope =
    result.action === PREPARE_RECOVERY_ACTION ? 'MATCHING_ACTION' : 'OTHER_ACTION'
  if (!result.resolved) {
    return prepareRecoveryPresentation('UNRESOLVED_ATTEMPT', scope, result)
  }
  const observation: RecoveryObservation = result.observation
  switch (observation) {
    case 'PREFLIGHT_REFUSED':
      return prepareRecoveryPresentation('REPLACEABLE_PRE_INVOCATION_TOMBSTONE', scope, result)
    case 'FINALIZED_EFFECT_MATCHING':
      return prepareRecoveryPresentation('REPLACEABLE_FINALIZED_SUCCESS_TOMBSTONE', scope, result)
    case 'LANDED_TRANSACTION_FAILED':
    case 'LANDED_MESSAGE_MISMATCH':
      return prepareRecoveryPresentation(
        'REPLACEABLE_ACCEPTED_KNOWN_SIGNATURE_FAILURE_TOMBSTONE',
        scope,
        result,
      )
    case 'SUPPORT_ONLY':
      return prepareRecoveryPresentation(
        'PERMANENTLY_NON_REPLACEABLE_SUPPORT_TOMBSTONE',
        scope,
        result,
      )
    case 'SUBMISSION_OUTCOME_UNKNOWN_WITHOUT_SIGNATURE':
    case 'SIGNATURE_OBSERVED':
    case 'CONFIRMATION_PENDING':
    case 'CONFIRMED_EFFECT_MATCHING':
    case 'READ_UNAVAILABLE':
    case 'EFFECT_PRESENT_ORIGIN_UNKNOWN':
    case null:
      return prepareRecoveryPresentation('INCONSISTENT_RESOLVED_FAIL_CLOSED', scope, result)
    default:
      return prepareRecoveryPresentation(
        prepareUnhandledRecoveryLiteral(observation),
        scope,
        result,
      )
  }
}

/**
 * Whether this panel may offer a new explicit prepare gesture right now.
 *
 * Pure, and a WITHHOLDING rule only: it can refuse, it can never grant. The action
 * bridge and the durable attempt record remain the sole exclusion authority, and they
 * refuse independently of whatever any panel is currently showing.
 */
export function redaxPrepareNewActionPermitted(
  recovery: RedaxPrepareRecoveryPresentation | null,
  localAttemptBlockActive: boolean,
): boolean {
  if (localAttemptBlockActive) {
    return false
  }
  return recovery === null || !recovery.blocksNewAction
}

// --- Durable terminal recovery outranks a stale local action projection ------------
//
// THE DEFECT THIS CLOSES. An action projection is a snapshot of what ONE invocation
// returned; a saved-attempt projection is a readback of the DURABLE record. Once that
// record has since become a terminal tombstone for THIS panel's own action, the older
// snapshot is not a second opinion — it is out of date, and rendering the pending class
// above a resolved saved attempt states two different things about one attempt.
//
// PRESENTATION ONLY, AND IN ONE DIRECTION. This confers no action authority. It selects
// what the action strip renders and nothing else: it invents no class, reads no chain,
// infers nothing from React state, writes no durable record, sends nothing and authorizes
// nothing. The durable journal stays the authority, and the ONLY trigger is a typed
// saved-attempt projection resolved from its readback.
//
// THE TRIGGER IS THE WHOLE TRIPLE — scope, class and DURABLE OBSERVATION. The tombstone
// class alone says only that the record was resolved; the observation says what it was
// resolved ON, and the accepted known-signature failure tombstone carries two genuinely
// different ones. A transaction that reached devnet and failed there has an existing
// action sentence. A signature that carried a DIFFERENT transaction does not: the
// finalized-failure class would claim a transaction failure the record never observed,
// and the mismatch class says the attempt stays unresolved, which a resolved tombstone
// contradicts. So that one disposition retires the strip WITHOUT stating an action
// result, and the durable panel keeps the terminal truth alone.
//
// IT NEVER FABRICATES A TERMINAL RESULT. A resting projection stays resting, an already
// terminal one is left exactly as it is, a sibling-owned record rewrites nothing, and
// every unresolved, provisional, refused, support, incoherent or fail-closed readback
// leaves the local projection untouched.

/**
 * Whether one action presentation class is ALREADY a settled, terminal statement about
 * the attempt it describes.
 *
 * Total, and conservative in the safe direction: `true` means "never rewritten". The
 * four pre-invocation classes are terminal because nothing was sent under them, and the
 * two finalized classes are terminal because they are the destinations this rule moves
 * TO. Everything else says, in its own copy, that the attempt stays unresolved or stays
 * blocking — which is exactly the claim a durable tombstone contradicts.
 */
const PREPARE_ACTION_TERMINAL: Record<RedaxHolderPrepareActionPresentationKind, boolean> = {
  FINALIZED_SUCCESS: true,
  PREFLIGHT_REFUSED: true,
  WALLET_UNAVAILABLE: true,
  RUNTIME_REFUSED: true,
  PREFLIGHT_FAILURE: true,
  PRIOR_ATTEMPT_BLOCKS: false,
  JOURNAL_FAIL_CLOSED: false,
  POST_UNKNOWN_NO_SIGNATURE: false,
  SIGNATURE_OBSERVED: false,
  CONFIRMATION_PENDING: false,
  LANDED_FAILED_PROVISIONAL: false,
  LANDED_FAILED_RESOLVED: true,
  LANDED_MESSAGE_MISMATCH: false,
  CONFIRMED_MATCHING_PROVISIONAL: false,
  READ_UNAVAILABLE: false,
  SUPPORT_ONLY: false,
  INCONSISTENT_NON_SUCCESS: false,
  DEPRECATED_COMPATIBILITY_NON_SUCCESS: false,
  EFFECT_ORIGIN_UNKNOWN: false,
}

/**
 * What a durable terminal saved-attempt readback does to this panel's local action
 * presentation. Exactly three dispositions, and no fourth.
 *
 * `ACTION_PRESENTATION` names an EXISTING action class of this panel — never a new one.
 * `RECOVERY_PANEL_ONLY` retires the stale strip while stating no action result at all,
 * for the one durable resolution this panel has no truthful action sentence for.
 * `NO_SYNCHRONIZATION` is the fail-closed default: leave the local projection exactly as
 * it is.
 */
export type RedaxPrepareTerminalSyncDisposition =
  | { readonly kind: 'NO_SYNCHRONIZATION' }
  | {
      readonly kind: 'ACTION_PRESENTATION'
      readonly presentation: RedaxHolderPrepareActionPresentationKind
    }
  | { readonly kind: 'RECOVERY_PANEL_ONLY' }

const PREPARE_NO_TERMINAL_SYNC: RedaxPrepareTerminalSyncDisposition = {
  kind: 'NO_SYNCHRONIZATION',
}
const PREPARE_TERMINAL_SYNC_RECOVERY_PANEL_ONLY: RedaxPrepareTerminalSyncDisposition = {
  kind: 'RECOVERY_PANEL_ONLY',
}

/**
 * The disposition one durable terminal saved-attempt projection produces for this panel.
 *
 * Pure and total, and it reads exactly three fields of the projection: the scope, the
 * class and the durable observation. Only two classes are terminal enough to supersede a
 * local projection at all, and each is admitted only together with the observation that
 * class was actually resolved on — a tombstone carrying anything else is incoherent and
 * fails closed rather than being interpreted. `NO_SYNCHRONIZATION` is the answer for
 * every other input, including every sibling-owned record, every non-action-specific
 * refusal and every already-terminal local projection.
 */
export function redaxPrepareTerminalSyncDisposition(
  recovery: RedaxPrepareRecoveryPresentation,
  current: RedaxHolderPrepareActionPresentationKind,
): RedaxPrepareTerminalSyncDisposition {
  // A record the sibling panel owns says nothing about this panel's own attempt.
  if (recovery.scope !== 'MATCHING_ACTION') {
    return PREPARE_NO_TERMINAL_SYNC
  }
  if (PREPARE_ACTION_TERMINAL[current]) {
    return PREPARE_NO_TERMINAL_SYNC
  }
  // The durable finalized-success tombstone, admitted only on the finalized matching
  // effect it is resolved on.
  if (recovery.kind === 'REPLACEABLE_FINALIZED_SUCCESS_TOMBSTONE') {
    return recovery.durableObservation === 'FINALIZED_EFFECT_MATCHING'
      ? { kind: 'ACTION_PRESENTATION', presentation: 'FINALIZED_SUCCESS' }
      : PREPARE_NO_TERMINAL_SYNC
  }
  // The accepted known-signature failure tombstone, split by the observation it was
  // resolved on — because the two it can carry are not the same fact.
  if (recovery.kind === 'REPLACEABLE_ACCEPTED_KNOWN_SIGNATURE_FAILURE_TOMBSTONE') {
    // A transaction that reached devnet and failed there, finalized. This panel's
    // finalized-failure class states exactly that and nothing more.
    if (recovery.durableObservation === 'LANDED_TRANSACTION_FAILED') {
      return { kind: 'ACTION_PRESENTATION', presentation: 'LANDED_FAILED_RESOLVED' }
    }
    // A DIFFERENT transaction found under this signature. No action class of this panel
    // is true of it, and a new one would be new failure vocabulary, so the strip states
    // nothing rather than overclaiming a transaction failure.
    if (recovery.durableObservation === 'LANDED_MESSAGE_MISMATCH') {
      return PREPARE_TERMINAL_SYNC_RECOVERY_PANEL_ONLY
    }
    return PREPARE_NO_TERMINAL_SYNC
  }
  return PREPARE_NO_TERMINAL_SYNC
}

// --- Panel-local state ---------------------------------------------------------

interface PrepareActionEvidence {
  readonly shortSignature: string | null
  readonly finality: RedaxHolderFinalityCopyKey | null
  readonly contextSlot: number | null
}

const NO_ACTION_EVIDENCE: PrepareActionEvidence = {
  shortSignature: null,
  finality: null,
  contextSlot: null,
}

// `in_flight` carries the bridge's ephemeral progress phase. It is LOCAL PROGRESS
// ONLY: it is never evidence, never a durable record and never authority.
// `settled` carries one more fact than the class it holds: whether the durable record
// RETIRED that class instead of replacing it. A retired projection renders no pill, no
// lead, no detail and no evidence — the saved-attempt panel is the sole terminal truth —
// while the panel stays SETTLED rather than resting, so nothing about it reopens on its
// own. Only this panel's existing explicit local clear returns it to the resting view.
type PrepareActionState =
  | { kind: 'resting' }
  | { kind: 'in_flight'; phase: RedaxWalletActionPhase }
  | {
      kind: 'settled'
      presentation: RedaxPrepareActionPresentation
      evidence: PrepareActionEvidence
      recoveryPanelOnly: boolean
    }

// `reconciling` CARRIES the projection it started from, and that is not decoration:
// the reconcile control must stay rendered and visibly disabled for the whole
// operation. A state that dropped the projection would make the control vanish the
// instant it was pressed, which is indistinguishable — to anyone looking — from a
// control that did nothing.
type PrepareRecoveryState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'reconciling'; presentation: RedaxPrepareRecoveryPresentation }
  | { kind: 'settled'; presentation: RedaxPrepareRecoveryPresentation; unchanged: boolean }

// The connected wallet's devnet SOL preflight, as this panel holds it.
//
// AVAILABILITY INFORMATION, never authority. It gates only what this panel OFFERS; the
// action bridge rechecks the balance itself, on the attempt's own connection and
// immediately before the attempt slot is opened, so a stale or optimistic value here
// can widen no gate that matters. `idle` exists only for a disconnected identity — a
// connected one is READING until its own read settles, exactly like the holder-context
// projection, so an unread balance is never mistaken for a sufficient one.
type PrepareSolPreflightState =
  | { kind: 'idle' }
  | { kind: 'reading' }
  | { kind: 'settled'; result: RedaxHolderSolPreflightResult }

/** The neutral values every out-of-scope projection resolves to while rendering. */
const PREPARE_RESTING_ACTION_STATE: PrepareActionState = { kind: 'resting' }
const PREPARE_IDLE_RECOVERY_STATE: PrepareRecoveryState = { kind: 'idle' }
const PREPARE_SOL_PREFLIGHT_IDLE: PrepareSolPreflightState = { kind: 'idle' }
const PREPARE_SOL_PREFLIGHT_READING_STATE: PrepareSolPreflightState = { kind: 'reading' }

// --- Mounted-control operation exclusion ------------------------------------------
//
// EXACTLY ONE Holder operation may run per mounted control — the transaction action,
// the read-only saved-attempt check, or the explicit saved-attempt reconciliation —
// and that exclusion must be VISIBLE. A ref alone cannot be: it is invisible to
// rendering, and every scoped projection collapses to its neutral value the moment the
// identity changes — so a still-pending operation from the previous identity would
// otherwise leave a freshly enabled call to action that silently returns at a hidden
// guard.
//
// The reconciliation joins the SAME latch as the other two rather than getting one of
// its own. Two exclusion mechanisms would be two chances to overlap, and the three
// operations genuinely cannot: they share one saved-attempt slot and one wallet scope.
//
// This record is therefore deliberately NOT scoped by wallet, campaign or token config
// and is never read through `inScope`: it belongs to the mounted control. It carries an
// opaque local token and which kind of operation holds it — no signature, address,
// amount, campaign, token config or receipt value — so it is exclusion truth only, never
// evidence, never authority and never a durable record.

type RedaxHolderOperationKind = 'action' | 'recheck' | 'reconcile'

interface RedaxHolderActiveOperation {
  readonly token: number
  readonly kind: RedaxHolderOperationKind
}

// --- Identity-scoped local state ------------------------------------------------
//
// IDENTITY PRIVACY IS A RENDER-TIME RULE, NOT A CLEANUP RACE. Every panel-local value
// is stored together with the EXACT identity scope that produced it and is read back
// through `inScope` while the tree is computed. A value whose recorded scope is not the
// current one is therefore invisible AND unusable in the very first render that observes
// a new wallet or campaign — before any passive effect runs, and whether or not one ever
// does. The passive resets further down are memory hygiene and generation bookkeeping
// only; neither privacy nor call-to-action gating depends on them.

/** One panel-local value together with the identity scope that produced it. */
interface ScopedState<T> {
  readonly scope: string
  readonly value: T
}

function scopedState<T>(scope: string, value: T): ScopedState<T> {
  return { scope, value }
}

/**
 * Render-time visibility gate: a stored value is usable only under its own identity.
 * Under any other identity the caller sees `restingValue` and never the stored one, so
 * no prior wallet's or campaign's projection can reach the returned tree.
 */
function inScope<T>(record: ScopedState<T>, currentScope: string, restingValue: T): T {
  return record.scope === currentScope ? record.value : restingValue
}

/** A stable projection of what this panel is showing, for a purely LOCAL comparison. */
function recoveryProjectionKey(presentation: RedaxPrepareRecoveryPresentation): string {
  return [
    presentation.kind,
    presentation.scope,
    presentation.durableObservation ?? '',
    presentation.shortSignature ?? '',
    presentation.currentObservation ?? '',
    presentation.currentFinality ?? '',
  ].join('|')
}

function readPrepareEvidence(
  result: RedaxPrepareUserOutputAtaResult,
  presentation: RedaxPrepareActionPresentation,
): PrepareActionEvidence {
  if (!presentation.showsEvidence) {
    return NO_ACTION_EVIDENCE
  }
  if (result.ok) {
    return {
      shortSignature: redaxShortSignature(result.signature),
      finality: result.finality,
      contextSlot: result.contextSlot,
    }
  }
  return {
    shortSignature: result.signature === undefined ? null : redaxShortSignature(result.signature),
    finality: result.finality ?? null,
    contextSlot: result.contextSlot ?? null,
  }
}

interface StatusLine {
  tone: RedaxHolderPresentationTone
  pill: string
  text: string
}

export interface RedaxHolderPrepareControlsProps {
  /** True only in DEVNET_TX_ENABLED; the panel renders nothing otherwise. */
  isDevnetTxEnabled: boolean
  /** App-facing data source (read-only reads only here). */
  dataSource: RedaxDataSource
  /** The active migration whose output token account is prepared. */
  campaign: RedaxCampaignView | null
  /** The campaign id the App resolved (may be '' when none). */
  activeCampaignId: string
}

export function RedaxHolderPrepareControls({
  isDevnetTxEnabled,
  dataSource,
  campaign,
  activeCampaignId,
}: RedaxHolderPrepareControlsProps) {
  const wallet = useRedaxWallet()
  const actions = useRedaxWalletActions()

  const connectedKey = wallet.status === 'connected' ? wallet.publicKeyBase58 : null

  // Two scopes, because the durable attempt record is namespaced by wallet and NOT by
  // campaign. Wallet identity scopes everything; the campaign additionally scopes the
  // action projection, which is campaign-specific.
  const walletScopeKey = connectedKey ?? ''
  const actionScopeKey = `${walletScopeKey} ${activeCampaignId}`

  // Each record carries the identity that produced it; nothing below is read directly.
  const [holderContextState, setHolderContextState] = useState<
    ScopedState<RedaxConnectedWalletHolderContextView | null>
  >(() => scopedState(actionScopeKey, null))
  // Initialised the same way the render-time gate resolves an out-of-scope record: a
  // connected identity with no read of its own yet is READING, never "resolved".
  const [contextLoadingState, setContextLoadingState] = useState<ScopedState<boolean>>(() =>
    scopedState(actionScopeKey, connectedKey !== null),
  )
  const [actionStateRecord, setActionStateRecord] = useState<ScopedState<PrepareActionState>>(() =>
    scopedState(actionScopeKey, PREPARE_RESTING_ACTION_STATE),
  )
  // Initialised the way the render-time gate resolves an out-of-scope record: a
  // connected identity with no read of its own yet is READING, never "sufficient".
  const [solPreflightRecord, setSolPreflightRecord] = useState<ScopedState<PrepareSolPreflightState>>(
    () =>
      scopedState(
        actionScopeKey,
        connectedKey !== null ? PREPARE_SOL_PREFLIGHT_READING_STATE : PREPARE_SOL_PREFLIGHT_IDLE,
      ),
  )
  const [recoveryStateRecord, setRecoveryStateRecord] = useState<ScopedState<PrepareRecoveryState>>(
    () => scopedState(walletScopeKey, PREPARE_IDLE_RECOVERY_STATE),
  )
  // A LOCAL, fail-closed suppression. It only ever withholds this panel's call to
  // action; it authorizes nothing, and it clears no durable record.
  const [attemptBlockRecord, setAttemptBlockRecord] = useState<ScopedState<boolean>>(() =>
    scopedState(walletScopeKey, false),
  )
  // Scope-INDEPENDENT mounted-control exclusion (see the note above). Deliberately not a
  // `ScopedState`: an identity change must never hide the fact that an operation this
  // control started is still running, because that is exactly what would leave an
  // enabled-but-silent call to action behind.
  const [activeOperation, setActiveOperation] = useState<RedaxHolderActiveOperation | null>(null)

  // RENDER-TIME IDENTITY GATING. Each projection collapses to its neutral resting value
  // the moment the identity that produced it stops being current — in THIS render, not
  // in a later effect. A pending read reports itself as a read rather than borrowing the
  // previous identity's account state, so old holder context can never drive the ATA
  // status, the balances, the preview, the call-to-action enablement or its reason.
  const holderContext = inScope(holderContextState, actionScopeKey, null)
  const contextLoading = inScope(contextLoadingState, actionScopeKey, connectedKey !== null)
  const actionState = inScope(actionStateRecord, actionScopeKey, PREPARE_RESTING_ACTION_STATE)
  const solPreflight = inScope(
    solPreflightRecord,
    actionScopeKey,
    connectedKey !== null ? PREPARE_SOL_PREFLIGHT_READING_STATE : PREPARE_SOL_PREFLIGHT_IDLE,
  )
  const recoveryState = inScope(recoveryStateRecord, walletScopeKey, PREPARE_IDLE_RECOVERY_STATE)
  const attemptBlockActive = inScope(attemptBlockRecord, walletScopeKey, false)

  const mountedRef = useRef(true)
  // COMMITTED IDENTITY — PUBLISHED AT COMMIT, NEVER DURING RENDER. React shares one ref
  // object between the current fiber and an interruptible work-in-progress fiber, so a
  // render-phase write would let an ABANDONABLE render for a new identity retag an
  // operation the still-committed identity owns, and symmetrically invalidate a valid
  // one. These are seeded at hook creation and republished only by the layout effects
  // below, which run after the tree is committed and before any passive effect.
  const committedWalletScopeRef = useRef(walletScopeKey)
  const committedActionScopeRef = useRef(actionScopeKey)
  const actionGenerationRef = useRef(0)
  const recoveryGenerationRef = useRef(0)
  // The SOL preflight carries its OWN generation rather than sharing the action one.
  // An explicit re-check must not invalidate an in-flight holder-context read: that
  // read's `finally` is itself scope-and-generation guarded, so cancelling it would
  // leave this scope reading forever.
  const solPreflightGenerationRef = useRef(0)
  // The LATEST read-only SOL-preflight member, held so the reader below can depend on
  // nothing that churns.
  //
  // `useRedaxWalletActions()` hands back the provider's context VALUE, memoized on the
  // provider's own inputs and not on this panel's. Depending on that object would give
  // the reader a new identity on any render that produced a fresh wrapper; the one
  // automatic-read effect would then re-run, set state, and schedule itself again — an
  // unbounded render loop issuing unbounded balance and rent reads at a live endpoint.
  // So the object is never a dependency: the member is read through this ref instead.
  // Seeded from the current member, so even the first render has the real one.
  const readHolderSolPreflightRef = useRef(actions.readHolderSolPreflight)
  // Synchronous re-entrancy latch. State cannot serve here alone: two clicks inside one
  // render would both observe the pre-update state. It holds the SAME record the
  // rendered `activeOperation` carries, so the two can never disagree.
  const inFlightRef = useRef<RedaxHolderActiveOperation | null>(null)
  const operationTokenRef = useRef(0)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  // The commit-phase publication of each scope. A layout effect runs after the commit
  // and before passive effects, so a handler retained from an older COMMITTED render can
  // always be told apart from an identity that is merely being rendered speculatively.
  useLayoutEffect(() => {
    committedWalletScopeRef.current = walletScopeKey
  }, [walletScopeKey])

  useLayoutEffect(() => {
    committedActionScopeRef.current = actionScopeKey
  }, [actionScopeKey])

  const isActionCurrent = useCallback((scopeKey: string, generation: number): boolean => {
    return (
      mountedRef.current &&
      committedActionScopeRef.current === scopeKey &&
      actionGenerationRef.current === generation
    )
  }, [])

  const isRecoveryCurrent = useCallback((scopeKey: string, generation: number): boolean => {
    return (
      mountedRef.current &&
      committedWalletScopeRef.current === scopeKey &&
      recoveryGenerationRef.current === generation
    )
  }, [])

  const isSolPreflightCurrent = useCallback((scopeKey: string, generation: number): boolean => {
    return (
      mountedRef.current &&
      committedActionScopeRef.current === scopeKey &&
      solPreflightGenerationRef.current === generation
    )
  }, [])

  // Republish the current member. A LAYOUT effect, like the two scope publications
  // above: every layout effect of a commit runs before any passive effect of the same
  // commit, so the ref is already current when the automatic read for a changed scope
  // runs. The dependency is the MEMBER, never the wrapper object — and because the body
  // only writes a ref, a churning member costs a pointer assignment and cannot start a
  // render loop the way a state write would.
  useLayoutEffect(() => {
    readHolderSolPreflightRef.current = actions.readHolderSolPreflight
  }, [actions.readHolderSolPreflight])

  // ONE read-only devnet SOL preflight read. It builds nothing, signs nothing, sends
  // nothing, confirms nothing, touches no saved attempt record and returns no
  // authorization — it only decides whether this panel may OFFER the action. Each call
  // supersedes the previous one, so a slow earlier read can never be the last writer.
  const runSolPreflightRead = useCallback(
    async (scopeKey: string): Promise<void> => {
      solPreflightGenerationRef.current += 1
      const generation = solPreflightGenerationRef.current
      setSolPreflightRecord(scopedState(scopeKey, PREPARE_SOL_PREFLIGHT_READING_STATE))
      try {
        const result = await readHolderSolPreflightRef.current('PREPARE_USER_OUTPUT_ATA')
        if (!isSolPreflightCurrent(scopeKey, generation)) {
          return
        }
        setSolPreflightRecord(
          scopedState<PrepareSolPreflightState>(scopeKey, { kind: 'settled', result }),
        )
      } catch {
        // A REJECTED read is not an observation. It settles as the panel's existing
        // read-unavailable state — which WITHHOLDS the action — rather than as an
        // unhandled rejection or an optimistic sufficiency. No raw error is read,
        // rendered or logged.
        if (!isSolPreflightCurrent(scopeKey, generation)) {
          return
        }
        setSolPreflightRecord(
          scopedState<PrepareSolPreflightState>(scopeKey, {
            kind: 'settled',
            result: 'READ_UNAVAILABLE',
          }),
        )
      }
    },
    // `isSolPreflightCurrent` is itself dependency-free, so this reader's identity is
    // STABLE for the life of the panel. That stability is the contract: the automatic
    // effect below re-runs only for a genuinely changed wallet/action scope, never for
    // an unrelated re-render.
    [isSolPreflightCurrent],
  )

  // Read-only re-usable holder/output-ATA read for the connected wallet. READ ONLY:
  // getConnectedWalletHolderContext performs no signing and no transaction. It drives
  // resting presentation and call-to-action gating only — it is never evidence, and it
  // never verifies, confirms, upgrades or downgrades an action result.
  const readHolderContext =
    useCallback(async (): Promise<RedaxConnectedWalletHolderContextView | null> => {
      if (!isDevnetTxEnabled || connectedKey === null) {
        return null
      }
      const result = await dataSource.getConnectedWalletHolderContext({
        mode: 'DEVNET_TX_ENABLED',
        connectedWallet: connectedKey,
        activeCampaignId: activeCampaignId === '' ? undefined : activeCampaignId,
      })
      return result.ok ? result.data : null
    }, [isDevnetTxEnabled, dataSource, connectedKey, activeCampaignId])

  // ORDER MATTERS. The two scope-invalidation effects are declared BEFORE the
  // holder-context read effect so that on a scope change the generation is already
  // bumped when the new read captures it — otherwise the new read would invalidate
  // itself, and an older read could still be the last writer.

  // Campaign or wallet change: invalidate every in-flight action-scoped completion and
  // drop the obsolete record. The render-time gate above has ALREADY hidden it, so this
  // is memory hygiene plus the generation bump the async guards read — never the thing
  // that makes the new identity private. It clears no durable attempt record, resolves
  // nothing, and reinterprets nothing; the record is wallet-scoped and survives
  // untouched.
  useEffect(() => {
    actionGenerationRef.current += 1
    setActionStateRecord(scopedState(actionScopeKey, PREPARE_RESTING_ACTION_STATE))
  }, [actionScopeKey])

  // Wallet change or disconnect: additionally invalidate every wallet-scoped projection —
  // saved-attempt detail and the local block alike. The previous wallet's durable
  // record is never deleted, cleared, acknowledged, overwritten or reinterpreted, and
  // reconnecting that wallet makes its namespace current again.
  useEffect(() => {
    recoveryGenerationRef.current += 1
    setRecoveryStateRecord(scopedState(walletScopeKey, PREPARE_IDLE_RECOVERY_STATE))
    setAttemptBlockRecord(scopedState(walletScopeKey, false))
  }, [walletScopeKey])

  // Resolve the connected-wallet holder/output-ATA context on connect + campaign
  // change. READ ONLY, and every completion is checked against mountedness and the
  // scope/generation it was started in before it may touch state. The result is stored
  // UNDER that scope, so it can never be read back under a different identity even if
  // the completion wins the race against the invalidation effects.
  useEffect(() => {
    if (!isDevnetTxEnabled || connectedKey === null) {
      setHolderContextState(scopedState(actionScopeKey, null))
      setContextLoadingState(scopedState(actionScopeKey, false))
      return
    }
    // The effect's OWN closure scope, for the same reason the handlers use theirs: an
    // effect body belongs to the render that scheduled it, never to a later draft.
    const scopeKey = actionScopeKey
    const generation = actionGenerationRef.current
    setContextLoadingState(scopedState(scopeKey, true))
    void (async () => {
      // A REJECTED read settles as the panel's ordinary null (unavailable) projection
      // rather than as an unhandled rejection, and the loading flag is always cleared in
      // `finally` — otherwise this scope would read forever. Every write stays guarded by
      // mountedness plus the captured scope AND generation, so a stale or unmounted
      // rejection writes nothing at all. No raw error is read, rendered or logged.
      try {
        const context = await readHolderContext()
        if (!isActionCurrent(scopeKey, generation)) {
          return
        }
        setHolderContextState(scopedState(scopeKey, context))
      } catch {
        if (!isActionCurrent(scopeKey, generation)) {
          return
        }
        setHolderContextState(scopedState(scopeKey, null))
      } finally {
        if (isActionCurrent(scopeKey, generation)) {
          setContextLoadingState(scopedState(scopeKey, false))
        }
      }
    })()
  }, [isDevnetTxEnabled, connectedKey, actionScopeKey, readHolderContext, isActionCurrent])

  // EXACTLY ONE automatic devnet SOL read per wallet/action scope, and no more. There is
  // no timer, no interval, no polling, no subscription and no automatic retry: a stale
  // reading is corrected by an explicit human re-check, and never by this panel deciding
  // on its own to ask again. Declared after the invalidation effects for the same reason
  // the holder-context read is.
  useEffect(() => {
    if (!isDevnetTxEnabled || connectedKey === null) {
      setSolPreflightRecord(scopedState(actionScopeKey, PREPARE_SOL_PREFLIGHT_IDLE))
      return
    }
    void runSolPreflightRead(actionScopeKey)
  }, [isDevnetTxEnabled, connectedKey, actionScopeKey, runSolPreflightRead])

  if (!isDevnetTxEnabled) {
    return null
  }

  const isConnected = wallet.status === 'connected'
  const walletBusy = wallet.status === 'connecting' || wallet.status === 'disconnecting'
  const contextResolved = holderContext !== null
  const outputAtaStatus: RedaxWalletAtaStatus | null =
    holderContext === null
      ? null
      : holderContext.status === 'connected'
        ? holderContext.outputAta?.status ?? 'unavailable'
        : holderContext.status === 'unavailable'
          ? 'unavailable'
          : null

  const campaignActive = campaign?.programStatus === 'active'
  const metadataReady = campaign?.metadataSetup === true
  const hasOutputMint = campaign !== null && campaign.outputMint.length > 0
  const campaignEligible = campaign !== null && campaignActive && metadataReady && hasOutputMint

  const settledRecovery = recoveryState.kind === 'settled' ? recoveryState.presentation : null
  // The scope-independent operation latch is part of `busy`, so an operation this
  // control started under a previous identity keeps every call to action, the read-only
  // recheck and the reconciliation DISABLED rather than enabled-but-silent.
  const busy =
    activeOperation !== null ||
    actionState.kind === 'in_flight' ||
    recoveryState.kind === 'checking' ||
    recoveryState.kind === 'reconciling'
  const newActionPermitted = redaxPrepareNewActionPermitted(settledRecovery, attemptBlockActive)

  // The saved-attempt projection the RECONCILE control is offered against.
  //
  // It survives the operation deliberately: while the reconciliation runs, the control
  // must remain visible and disabled rather than disappearing. It is NOT
  // `settledRecovery` — that stays strictly settled, so nothing in flight can widen the
  // call-to-action gate or the return-to-resting affordance.
  const reconcilableRecovery =
    recoveryState.kind === 'settled' || recoveryState.kind === 'reconciling'
      ? recoveryState.presentation
      : null

  // THE EXACT OFFER RULE. The reconciliation belongs to the panel whose OWN action the
  // saved record names, and only while that record is an unresolved attempt carrying a
  // known saved signature. A record owned by the sibling action keeps this panel
  // generic: no detail, no signature and no control. A resolved record has nothing to
  // reconcile, and an attempt with no retained signature has no transaction identity to
  // read devnet about — this operation is forbidden to go looking for one.
  const reconcileOffered =
    reconcilableRecovery !== null &&
    reconcilableRecovery.scope === 'MATCHING_ACTION' &&
    reconcilableRecovery.kind === 'UNRESOLVED_ATTEMPT' &&
    reconcilableRecovery.shortSignature !== null

  // The unscoped operation latch is load-bearing, but this panel's OWN scoped
  // projections cannot name it: under the current identity the action is not in flight
  // and the saved-attempt read is not running, so the operation belongs to a scope this
  // panel no longer shows. This panel states no disabled reason of its own, so without
  // this line the withdrawn call to action and the disabled recheck, return-to-status
  // and disconnect controls would carry no explanation at all. Same-scope progress copy
  // already explains the operation truthfully, so this stays false there.
  const operationUnexplained =
    activeOperation !== null &&
    actionState.kind !== 'in_flight' &&
    recoveryState.kind !== 'checking' &&
    recoveryState.kind !== 'reconciling'

  // KNOWN-SUFFICIENT ONLY. A reading, an idle projection and a failed read all resolve
  // to false, because an unknown balance must withhold an action rather than allow one.
  const solPreflightSufficient =
    solPreflight.kind === 'settled' && solPreflight.result === 'SUFFICIENT'

  // The truthful SOL line, and null exactly when the state is a plain known-sufficient
  // one — which needs no sentence, and certainly no amount.
  const solPreflightNote: string | null =
    solPreflight.kind === 'reading'
      ? PREPARE_SOL_PREFLIGHT_READING
      : solPreflight.kind === 'idle'
        ? null
        : solPreflight.result === 'INSUFFICIENT'
          ? PREPARE_SOL_PREFLIGHT_INSUFFICIENT
          : solPreflight.result === 'READ_UNAVAILABLE'
            ? PREPARE_SOL_PREFLIGHT_UNAVAILABLE
            : null

  const showPrepareButton =
    campaignEligible &&
    actions.canPrepareUserOutputAta &&
    outputAtaStatus === 'missing' &&
    actionState.kind === 'resting' &&
    newActionPermitted &&
    solPreflightSufficient &&
    !busy

  // Whether the durable record RETIRED this panel's local action projection instead of
  // replacing it. A plain read of the state the synchronization already wrote — never a
  // second, render-time rule that could reach a different answer, and never inferred from
  // the currently displayed saved-attempt projection, which is wallet-scoped while this
  // one is not and outlives the action projection it would otherwise silently suppress.
  const actionPresentationRetired = actionState.kind === 'settled' && actionState.recoveryPanelOnly

  // A settled projection may be cleared back to the resting account view only when the
  // typed result itself permits a later explicit gesture, or when a typed saved-attempt
  // result proves a source-proven replaceable (or absent) record. Never from `resolved`
  // alone, never automatically, and never labelled as a repeat of a submission.
  const returnToRestingOffered =
    actionState.kind === 'settled' &&
    (actionState.presentation.permitsNewExplicitAction ||
      (settledRecovery !== null && settledRecovery.clearsLocalBlock))

  // ONE mounted-control operation at a time, in the ref AND in the rendered state.
  // Acquisition is synchronous, so a second gesture inside the same render is refused
  // before it can start anything. Release is token-matched, so a late `finally` from an
  // older operation can never clear a newer one.
  function acquireHolderOperation(
    kind: RedaxHolderOperationKind,
  ): RedaxHolderActiveOperation | null {
    if (inFlightRef.current !== null) {
      return null
    }
    operationTokenRef.current += 1
    const operation: RedaxHolderActiveOperation = { token: operationTokenRef.current, kind }
    inFlightRef.current = operation
    setActiveOperation(operation)
    return operation
  }

  function releaseHolderOperation(operation: RedaxHolderActiveOperation) {
    if (inFlightRef.current !== null && inFlightRef.current.token === operation.token) {
      inFlightRef.current = null
    }
    if (mountedRef.current) {
      setActiveOperation((current) =>
        current !== null && current.token === operation.token ? null : current,
      )
    }
  }

  // The single prepareUserOutputAta call site. Invoked ONLY from the explicit button
  // click below — never from an effect, on connect, on a timer or on load.
  async function handlePrepare() {
    // COMMITTED-CLOSURE OPERATION IDENTITY. The request and the tag every scoped write
    // carries both come from THIS committed render's closure — never from a mutable ref
    // an interruptible work-in-progress render for another identity could have
    // retargeted. Request identity and state tag therefore share one provenance.
    const scopeKey = actionScopeKey
    const walletKey = walletScopeKey
    // A handler retained from an older committed render starts nothing once a different
    // identity has committed.
    if (scopeKey !== committedActionScopeRef.current) {
      return
    }
    if (inFlightRef.current !== null) {
      return
    }
    if (actionState.kind !== 'resting' || busy) {
      return
    }
    if (!campaignEligible || campaign === null || !hasOutputMint) {
      return
    }
    if (outputAtaStatus !== 'missing' || !actions.canPrepareUserOutputAta) {
      return
    }
    if (!newActionPermitted) {
      return
    }
    // The exposure conjunct, repeated SYNCHRONOUSLY from this committed render's own
    // projection before the latch is taken. A handler retained across a state change
    // must not start an action the current render would not have offered — and the
    // bridge rechecks the balance itself regardless, on the attempt's own connection.
    if (!solPreflightSufficient) {
      return
    }
    const operation = acquireHolderOperation('action')
    if (operation === null) {
      return
    }
    actionGenerationRef.current += 1
    const generation = actionGenerationRef.current
    setActionStateRecord(
      scopedState<PrepareActionState>(scopeKey, {
        kind: 'in_flight',
        phase: 'awaiting_wallet_approval',
      }),
    )
    try {
      const result = await actions.prepareUserOutputAta(
        { campaign: campaign.id, outputMint: campaign.outputMint },
        (progress) => {
          if (!isActionCurrent(scopeKey, generation)) {
            return
          }
          setActionStateRecord(
            scopedState<PrepareActionState>(scopeKey, { kind: 'in_flight', phase: progress }),
          )
        },
      )
      if (!isActionCurrent(scopeKey, generation)) {
        return
      }
      const presentation = resolveRedaxPrepareActionPresentation(result)
      setActionStateRecord(
        scopedState<PrepareActionState>(scopeKey, {
          kind: 'settled',
          presentation,
          evidence: readPrepareEvidence(result, presentation),
          recoveryPanelOnly: false,
        }),
      )
      if (!presentation.permitsNewExplicitAction) {
        setAttemptBlockRecord(scopedState(walletKey, true))
      }
    } catch {
      // A REJECTED bridge promise is not a typed result and is never treated as one. It
      // settles into the panel's existing fail-closed unknown-without-signature class:
      // no signature, no finality, no context slot, no public result code invented, and
      // the raw error is neither read, rendered nor logged. A new explicit action stays
      // blocked and the wallet-scoped local block is set conservatively, because a
      // rejection here cannot prove that nothing reached devnet. Without this the
      // `in_flight` record would survive and hold this scope busy for its whole life.
      if (!isActionCurrent(scopeKey, generation)) {
        return
      }
      setActionStateRecord(
        scopedState<PrepareActionState>(scopeKey, {
          kind: 'settled',
          presentation: prepareActionPresentation('POST_UNKNOWN_NO_SIGNATURE', null, null),
          evidence: NO_ACTION_EVIDENCE,
          recoveryPanelOnly: false,
        }),
      )
      setAttemptBlockRecord(scopedState(walletKey, true))
    } finally {
      releaseHolderOperation(operation)
    }
  }

  // PRESENTATION SYNCHRONIZATION, AND NOTHING ELSE. Called only from a settled
  // saved-attempt projection that came back from the durable readback — never from a
  // chain read, a React value, an effect, a timer or an optimistic guess. It starts no
  // operation, takes no latch, sends nothing, writes no durable record and authorizes
  // nothing; it replaces one stale LOCAL presentation class with another EXISTING one.
  function synchronizeActionWithDurableRecovery(presentation: RedaxPrepareRecoveryPresentation) {
    // THIS committed render's own action scope, on the same provenance rule every
    // operation follows. The action projection is campaign-scoped and the saved attempt
    // is not, so a campaign that changed under a still-connected wallet must leave the
    // new scope's projection alone rather than be overwritten by the old one's.
    const actionKey = actionScopeKey
    if (actionKey !== committedActionScopeRef.current) {
      return
    }
    // Nothing is synchronized into a resting or in-flight panel: there is no stale
    // projection to supersede, and a terminal class conjured onto one would be exactly
    // the fabricated result this rule forbids.
    if (actionState.kind !== 'settled') {
      return
    }
    const disposition = redaxPrepareTerminalSyncDisposition(
      presentation,
      actionState.presentation.kind,
    )
    if (disposition.kind === 'NO_SYNCHRONIZATION') {
      return
    }
    // THE RETIRING DISPOSITION. The stale class is KEPT rather than exchanged for another
    // one — exchanging it is what would state a result the durable record never observed,
    // and a retired projection is never rendered again anyway — while the strip stops
    // stating it and the evidence it carried is dropped. The panel stays SETTLED, so the
    // account view, the amount and the acknowledgement of a fresh flow are not reopened
    // here: only this panel's own explicit local clear does that.
    if (disposition.kind === 'RECOVERY_PANEL_ONLY') {
      setActionStateRecord(
        scopedState<PrepareActionState>(actionKey, {
          kind: 'settled',
          presentation: actionState.presentation,
          evidence: NO_ACTION_EVIDENCE,
          recoveryPanelOnly: true,
        }),
      )
      return
    }
    // NO EVIDENCE IS CARRIED ACROSS. The durable saved-attempt projection below owns the
    // signature, observation and finality it actually proved; this strip has none of its
    // own for the class it now shows, and inventing one would be a second, weaker
    // authority and a duplicate signature surface.
    setActionStateRecord(
      scopedState<PrepareActionState>(actionKey, {
        kind: 'settled',
        presentation: prepareActionPresentation(disposition.presentation, null, null),
        evidence: NO_ACTION_EVIDENCE,
        recoveryPanelOnly: false,
      }),
    )
  }

  // The explicit, read-only saved-attempt check. It builds nothing, signs nothing,
  // sends nothing, confirms nothing, writes no record and returns no authorization,
  // and it runs ONLY from the button click below — never on mount, in an effect, on a
  // timer, on a poll, on a storage event or on a subscription.
  //
  // It may still SYNCHRONIZE this panel's local presentation when the readback shows the
  // durable record is already a terminal tombstone. That is presentation only: the check
  // remains read-only, and the durable record is unchanged by it either way.
  async function handleRecoveryCheck() {
    // The read-only check is wallet-scoped, and its identity comes from THIS committed
    // render's closure for exactly the same reason the transaction action's does.
    const scopeKey = walletScopeKey
    if (scopeKey !== committedWalletScopeRef.current) {
      return
    }
    if (inFlightRef.current !== null) {
      return
    }
    if (!isConnected || busy) {
      return
    }
    const operation = acquireHolderOperation('recheck')
    if (operation === null) {
      return
    }
    recoveryGenerationRef.current += 1
    const generation = recoveryGenerationRef.current
    const previousKey =
      recoveryState.kind === 'settled' ? recoveryProjectionKey(recoveryState.presentation) : null
    setRecoveryStateRecord(scopedState<PrepareRecoveryState>(scopeKey, { kind: 'checking' }))
    try {
      const result = await actions.recheckHolderRecovery()
      if (!isRecoveryCurrent(scopeKey, generation)) {
        return
      }
      const presentation = resolveRedaxPrepareRecoveryPresentation(result)
      setRecoveryStateRecord(
        scopedState<PrepareRecoveryState>(scopeKey, {
          kind: 'settled',
          presentation,
          unchanged: previousKey !== null && previousKey === recoveryProjectionKey(presentation),
        }),
      )
      if (presentation.blocksNewAction) {
        setAttemptBlockRecord(scopedState(scopeKey, true))
      } else if (presentation.clearsLocalBlock) {
        setAttemptBlockRecord(scopedState(scopeKey, false))
      }
      // A durable terminal readback for this panel's OWN action supersedes a stale local
      // non-terminal projection. Presentation only, from the durable record alone.
      synchronizeActionWithDurableRecovery(presentation)
    } catch {
      // A REJECTED read is not an observation. It settles into the panel's existing
      // fail-closed journal class: no durable observation, no current outcome, no
      // finality, no signature and no context slot are invented, no public refusal code
      // is added, and the raw error is neither read, rendered nor logged. A new explicit
      // action stays blocked. Without this the `checking` record would survive and hold
      // this wallet scope busy for its whole life.
      if (!isRecoveryCurrent(scopeKey, generation)) {
        return
      }
      setRecoveryStateRecord(
        scopedState<PrepareRecoveryState>(scopeKey, {
          kind: 'settled',
          presentation: prepareRecoveryPresentation(
            'JOURNAL_FAIL_CLOSED',
            'NOT_ACTION_SPECIFIC',
            null,
          ),
          unchanged: false,
        }),
      )
      setAttemptBlockRecord(scopedState(scopeKey, true))
    } finally {
      releaseHolderOperation(operation)
    }
  }

  // The explicit saved-attempt RECONCILIATION. It is not a transaction action: it
  // builds nothing, signs nothing, sends nothing and starts no new attempt. What it may
  // do — and the read-only check above may not — is let the durable saved record settle
  // itself from devnet evidence that is already terminal.
  //
  // It runs ONLY from the button click below. No effect calls it, nothing calls it
  // after a check, nothing calls it after a reload, and there is no retry loop: one
  // gesture is one reconciliation, and a reading that resolves nothing simply stands.
  async function handleRecoveryReconcile() {
    // Wallet-scoped, from THIS committed render's closure — the same provenance rule the
    // transaction action and the read-only check follow.
    const scopeKey = walletScopeKey
    if (scopeKey !== committedWalletScopeRef.current) {
      return
    }
    if (inFlightRef.current !== null) {
      return
    }
    if (!isConnected || busy) {
      return
    }
    // The offer conjunct, repeated SYNCHRONOUSLY from this committed render's own
    // projection before the latch is taken: a handler retained across a state change
    // must not start an operation the current render would not have offered.
    if (!reconcileOffered || recoveryState.kind !== 'settled') {
      return
    }
    const operation = acquireHolderOperation('reconcile')
    if (operation === null) {
      return
    }
    const previousPresentation = recoveryState.presentation
    recoveryGenerationRef.current += 1
    const generation = recoveryGenerationRef.current
    const previousKey = recoveryProjectionKey(previousPresentation)
    setRecoveryStateRecord(
      scopedState<PrepareRecoveryState>(scopeKey, {
        kind: 'reconciling',
        presentation: previousPresentation,
      }),
    )
    try {
      const result = await actions.reconcileHolderRecovery()
      if (!isRecoveryCurrent(scopeKey, generation)) {
        return
      }
      const presentation = resolveRedaxPrepareRecoveryPresentation(result)
      setRecoveryStateRecord(
        scopedState<PrepareRecoveryState>(scopeKey, {
          kind: 'settled',
          presentation,
          unchanged: previousKey === recoveryProjectionKey(presentation),
        }),
      )
      // THE DURABLE RESULT IS THE ONLY THING THAT MAY UNBLOCK THIS PANEL. The returned
      // projection is resolved from the record as it was read back AFTER the operation,
      // so a source-proven replaceable (or absent) record is the sole reason the local
      // block lifts. Every other outcome — unresolved, support, fail-closed, refused —
      // SETS it rather than leaving it as it was: a reconciliation that did not settle
      // the record is a reason to stay blocked, never a reason to stop being.
      setAttemptBlockRecord(scopedState(scopeKey, !presentation.clearsLocalBlock))
      // And when it DID settle the record terminally for this panel's own action, the
      // stale local projection above it is superseded — presentation only, from the same
      // durable readback the block decision was taken from.
      synchronizeActionWithDurableRecovery(presentation)
    } catch {
      // A REJECTED reconciliation is not an observation, and it is certainly not a
      // resolution. It settles into the panel's existing fail-closed journal class: no
      // durable observation, no outcome, no signature and no context slot are invented,
      // no refusal code is added, and the raw error is neither read, rendered nor
      // logged. The local block stays on.
      if (!isRecoveryCurrent(scopeKey, generation)) {
        return
      }
      setRecoveryStateRecord(
        scopedState<PrepareRecoveryState>(scopeKey, {
          kind: 'settled',
          presentation: prepareRecoveryPresentation(
            'JOURNAL_FAIL_CLOSED',
            'NOT_ACTION_SPECIFIC',
            null,
          ),
          unchanged: false,
        }),
      )
      setAttemptBlockRecord(scopedState(scopeKey, true))
    } finally {
      releaseHolderOperation(operation)
    }
  }

  // The explicit, read-only devnet SOL re-check. It builds nothing, signs nothing,
  // sends nothing, confirms nothing, writes no record and returns no authorization,
  // and it runs ONLY from the button click below — never on a timer, a poll, a storage
  // event or a subscription. It does not take the mounted-control operation latch: it
  // is not a transaction action and not a saved-attempt read, and it supersedes only
  // its own previous read.
  function handleSolPreflightCheck() {
    const scopeKey = actionScopeKey
    if (scopeKey !== committedActionScopeRef.current) {
      return
    }
    if (busy || solPreflight.kind === 'reading') {
      return
    }
    void runSolPreflightRead(scopeKey)
  }

  // Clears this panel's LOCAL presentation back to the resting account view. It sends
  // nothing, starts nothing, touches no durable record and authorizes nothing.
  function returnToResting() {
    actionGenerationRef.current += 1
    setActionStateRecord(scopedState(actionScopeKey, PREPARE_RESTING_ACTION_STATE))
  }

  function restingStatusLine(): StatusLine {
    if (!campaignEligible) {
      return { tone: 'neutral', pill: 'Unavailable here', text: PREPARE_ATA_INELIGIBLE }
    }
    if (outputAtaStatus === 'exists') {
      return { tone: 'positive', pill: 'Account exists', text: PREPARE_ATA_ALREADY_PREPARED }
    }
    if (outputAtaStatus === 'mismatch') {
      return { tone: 'caution', pill: 'Blocked', text: PREPARE_ATA_MISMATCH }
    }
    if (outputAtaStatus === 'missing') {
      return { tone: 'neutral', pill: 'Not prepared', text: PREPARE_ATA_MISSING_NOTE }
    }
    return { tone: 'caution', pill: 'Unreadable', text: PREPARE_ATA_UNAVAILABLE }
  }

  // Null exactly when the durable record retired this panel's projection. The resting
  // account view is NOT substituted there either: the panel is not resting, and a
  // truthful account line in the retired strip's place would still read as this attempt's
  // outcome. The saved-attempt panel below states the terminal truth on its own.
  function currentStatusLine(): StatusLine | null {
    if (actionPresentationRetired) {
      return null
    }
    if (actionState.kind === 'in_flight') {
      return actionState.phase === 'awaiting_wallet_approval'
        ? {
            tone: 'info',
            pill: PREPARE_ATA_AWAITING_APPROVAL_PILL,
            text: PREPARE_ATA_AWAITING_APPROVAL,
          }
        : { tone: 'info', pill: PREPARE_ATA_RECONCILING_PILL, text: PREPARE_ATA_CONFIRMING }
    }
    if (actionState.kind === 'settled') {
      return {
        tone: actionState.presentation.tone,
        pill: actionState.presentation.pill,
        text: actionState.presentation.lead,
      }
    }
    return restingStatusLine()
  }

  function renderActionEvidence() {
    if (
      actionState.kind !== 'settled' ||
      actionState.recoveryPanelOnly ||
      !actionState.presentation.showsEvidence
    ) {
      return null
    }
    const { shortSignature, finality, contextSlot } = actionState.evidence
    if (shortSignature === null && finality === null && contextSlot === null) {
      return null
    }
    return (
      <div className="prepare-panel__action">
        {shortSignature !== null ? (
          <>
            <p className="note-line">
              {HOLDER_EVIDENCE_SIGNATURE_LABEL}: {shortSignature}
            </p>
            <p className="note-line">{HOLDER_EVIDENCE_SIGNATURE_NOTE}</p>
          </>
        ) : null}
        {finality !== null ? (
          <p className="note-line">
            {HOLDER_EVIDENCE_FINALITY_LABEL}: {HOLDER_FINALITY_COPY[finality]}
          </p>
        ) : null}
        {contextSlot !== null ? (
          <p className="note-line">
            {HOLDER_EVIDENCE_ACTION_CONTEXT_SLOT_LABEL}: {contextSlot}
          </p>
        ) : null}
      </div>
    )
  }

  function renderRecoveryDetail(presentation: RedaxPrepareRecoveryPresentation) {
    if (!presentation.showsEvidence) {
      return null
    }
    return (
      <>
        {presentation.durableObservation !== null ? (
          <p className="note-line">
            {HOLDER_EVIDENCE_DURABLE_OBSERVATION_LABEL}:{' '}
            {HOLDER_DURABLE_OBSERVATION_COPY[presentation.durableObservation]}
          </p>
        ) : null}
        {presentation.shortSignature !== null ? (
          <p className="note-line">
            {HOLDER_EVIDENCE_SIGNATURE_LABEL}: {presentation.shortSignature}
          </p>
        ) : null}
        {presentation.currentObservation !== null ? (
          <>
            <p className="note-line">
              {HOLDER_EVIDENCE_CURRENT_OBSERVATION_LABEL}:{' '}
              {HOLDER_CURRENT_OBSERVATION_COPY[presentation.currentObservation]}
            </p>
            <p className="note-line">{HOLDER_EVIDENCE_CURRENT_OBSERVATION_NOTE}</p>
          </>
        ) : null}
        {presentation.currentFinality !== null ? (
          <p className="note-line">
            {HOLDER_EVIDENCE_FINALITY_LABEL}: {HOLDER_FINALITY_COPY[presentation.currentFinality]}
          </p>
        ) : null}
      </>
    )
  }

  function renderRecoveryPanel() {
    return (
      <div className="prepare-panel__action" role="group" aria-label={HOLDER_RECOVERY_TITLE}>
        <span className="prepare-panel__eyebrow">{HOLDER_RECOVERY_EYEBROW}</span>
        <h4 className="prepare-panel__title">{HOLDER_RECOVERY_TITLE}</h4>
        <p className="note-line">{HOLDER_RECOVERY_SHARED_SLOT_NOTE}</p>
        {/*
          The neutral operation explanation, rendered EXACTLY ONCE. It appears only when
          the latch is load-bearing and no current-scope progress copy already names the
          operation. It discloses no previous wallet, campaign or operation kind.
        */}
        {operationUnexplained ? (
          <p className="note-line">{HOLDER_OPERATION_ACTIVE}</p>
        ) : null}
        <button
          type="button"
          className="prepare-panel__btn"
          disabled={busy}
          onClick={() => {
            void handleRecoveryCheck()
          }}
        >
          {HOLDER_RECOVERY_BUTTON}
        </button>
        {recoveryState.kind === 'idle' ? (
          <p className="note-line">{HOLDER_RECOVERY_NOT_CHECKED}</p>
        ) : null}
        {recoveryState.kind === 'checking' ? (
          <p className="note-line">{HOLDER_RECOVERY_CHECKING}</p>
        ) : null}
        {recoveryState.kind === 'reconciling' ? (
          <p className="note-line">{HOLDER_RECOVERY_RECONCILE_IN_PROGRESS}</p>
        ) : null}
        {recoveryState.kind === 'settled' ? (
          <>
            <div className="prepare-panel__status">
              <StatusPill
                tone={recoveryState.presentation.tone}
                label={recoveryState.presentation.pill}
              />
              <p className="note-line">{recoveryState.presentation.text}</p>
            </div>
            {renderRecoveryDetail(recoveryState.presentation)}
            {recoveryState.unchanged ? (
              <p className="note-line">{HOLDER_RECOVERY_NO_LOCAL_CHANGE}</p>
            ) : null}
          </>
        ) : null}
        {/*
          The explicit reconciliation, offered ONLY against this panel's own unresolved
          saved attempt with a known saved signature. It stays rendered and disabled for
          the whole operation, so pressing it is visibly doing something.
        */}
        {reconcileOffered ? (
          <div className="prepare-panel__action">
            <p className="note-line">{HOLDER_RECOVERY_RECONCILE_EXPLANATION}</p>
            <button
              type="button"
              className="prepare-panel__btn"
              disabled={busy}
              onClick={() => {
                void handleRecoveryReconcile()
              }}
            >
              {HOLDER_RECOVERY_RECONCILE_BUTTON}
            </button>
            <p className="note-line">{HOLDER_RECOVERY_RECONCILE_NON_AUTHORIZATION}</p>
            <p className="note-line">{HOLDER_RECOVERY_RECONCILE_NO_PROMISE}</p>
          </div>
        ) : null}
        <p className="note-line">{HOLDER_RECOVERY_NON_AUTHORIZATION}</p>
        <p className="note-line">{HOLDER_RECOVERY_SCOPE_NOTE}</p>
        <p className="note-line">{HOLDER_RECOVERY_LOCAL_PROJECTION_NOTE}</p>
        <p className="prepare-panel__boundary">{HOLDER_RECOVERY_BOUNDARY}</p>
      </div>
    )
  }

  const status = currentStatusLine()

  return (
    <section className="prepare-panel" aria-label="Prepare output token account">
      <div className="prepare-panel__head">
        <span className="prepare-panel__eyebrow">{PREPARE_ATA_EYEBROW}</span>
        <h3 className="prepare-panel__title">{PREPARE_ATA_PANEL_TITLE}</h3>
      </div>

      {!isConnected ? (
        <div className="prepare-panel__body">
          <p className="note-line">{PREPARE_ATA_CONNECT_PROMPT}</p>
          {!wallet.walletsDetected ? (
            <p className="note-line">{PREPARE_ATA_CONNECT_NONE}</p>
          ) : (
            <div
              className="prepare-panel__wallets"
              role="group"
              aria-label="Detected Wallet Standard wallets"
            >
              {wallet.wallets.map((option) => (
                <button
                  key={option.name}
                  type="button"
                  className="prepare-panel__btn"
                  disabled={!option.connectable || walletBusy}
                  onClick={() => {
                    void wallet.connect(option.name)
                  }}
                >
                  {wallet.status === 'connecting' && option.name === wallet.selectedWalletName
                    ? `Connecting ${option.name}…`
                    : `Connect ${option.name}`}
                </button>
              ))}
            </div>
          )}
          {wallet.errorMessage !== null ? (
            <p className="prepare-panel__error">{wallet.errorMessage}</p>
          ) : null}
        </div>
      ) : (
        <div className="prepare-panel__body">
          <div className="prepare-panel__identity">
            <span className="prepare-panel__idlabel">Connected wallet</span>
            <span className="prepare-panel__idkey">{wallet.shortPublicKey ?? '—'}</span>
            <button
              type="button"
              className="prepare-panel__btn"
              disabled={walletBusy || busy}
              onClick={() => {
                void wallet.disconnect()
              }}
            >
              Disconnect
            </button>
          </div>

          {contextLoading && !contextResolved ? (
            <p className="note-line">{PREPARE_ATA_READING}</p>
          ) : (
            <>
              {status !== null ? (
                <div className="prepare-panel__status">
                  <StatusPill tone={status.tone} label={status.pill} />
                  <p className="note-line">{status.text}</p>
                </div>
              ) : null}
              {actionState.kind === 'settled' &&
              !actionState.recoveryPanelOnly &&
              actionState.presentation.detail !== null ? (
                <p className="note-line">{actionState.presentation.detail}</p>
              ) : null}
              {renderActionEvidence()}
              {showPrepareButton ? (
                <div className="prepare-panel__action">
                  <p className="note-line">{PREPARE_ATA_PREVIEW_BODY}</p>
                  <p className="prepare-panel__warn">{PREPARE_ATA_RENT_WARNING}</p>
                  <button
                    type="button"
                    className="prepare-panel__cta"
                    disabled={busy}
                    onClick={() => {
                      void handlePrepare()
                    }}
                  >
                    {PREPARE_ATA_BUTTON}
                  </button>
                </div>
              ) : null}
              {returnToRestingOffered ? (
                <div className="prepare-panel__action">
                  <button
                    type="button"
                    className="prepare-panel__btn"
                    disabled={busy}
                    onClick={returnToResting}
                  >
                    {PREPARE_RETURN_TO_STATUS_LABEL}
                  </button>
                  <p className="note-line">{PREPARE_RETURN_TO_STATUS_HELP}</p>
                </div>
              ) : null}
            </>
          )}

          {/*
            The visible SOL status line and its explicit read-only re-check. They
            appear together and only while the balance is not a plain known-
            sufficient one — a hidden button explains nothing, and a sufficient
            balance needs no sentence and no amount. The panel is NOT converted to
            disabled-button presentation, and the rent advisory above still owns the
            cost explanation.
          */}
          {solPreflightNote !== null ? (
            <div className="prepare-panel__action">
              <p className="note-line">{solPreflightNote}</p>
              <button
                type="button"
                className="prepare-panel__btn"
                disabled={busy || solPreflight.kind === 'reading'}
                onClick={handleSolPreflightCheck}
              >
                {PREPARE_SOL_PREFLIGHT_RECHECK_LABEL}
              </button>
            </div>
          ) : null}

          {renderRecoveryPanel()}
        </div>
      )}

      <p className="prepare-panel__boundary">{PREPARE_ATA_DEVNET_BOUNDARY}</p>
    </section>
  )
}
