// REDAX Holder-side convert_exact_in PREVIEW + ACTION panel (DEVNET_TX_ENABLED only).
//
// Boundary: this panel previews a conversion AND performs it. The PREVIEW is unchanged —
// a display-unit amount input, the quote (gross output, disclosed protocol fee, net
// output), any normalization remainder, and the cap / window / status checks that would
// reject a conversion before any burn — for the connected wallet's focused accepted
// input. It is DISPLAY ONLY and is never transaction authority; the program remains the
// authority on rate, caps and the campaign window, and the browser clock is only a
// presentational gate. The ACTION is a separate, explicit convert step: it invokes the
// narrow wallet action bridge (useRedaxWalletActions -> convertExactIn) ONLY from an
// explicit button click — never on mount, in an effect, on connect, on a timer or on
// load. A convert button appears only after a valid preview, gated on an explicit
// consequence-specific acknowledgement, the pre-burn checks passing, and the bridge
// capability. It consumes only the narrow useRedaxWallet CONNECTION facade and the
// bridge (canConvertExactIn + convertExactIn + the read-only recheckHolderRecovery +
// the explicit non-transaction reconcileHolderRecovery) — never the raw adapter, a
// generic send, any transaction primitive, or a foundation module (not even type-only:
// every nested vocabulary below is derived structurally from the bridge's own exported
// unions).
//
// THE PANEL OWNS THREE GESTURES, AND ONLY ONE OF THEM IS A TRANSACTION. Converting is
// the transaction action. Checking the saved attempt is read-only and settles nothing.
// Reconciling the saved attempt is neither: it sends nothing and signs nothing, and it
// is the only gesture that may let the durable saved record settle — from devnet
// evidence that is already terminal, and never from anything this panel is showing.
// All three share ONE mounted-control latch, and the reconciliation is offered only
// against this panel's OWN unresolved saved attempt: a prepare-owned record leaves this
// panel generic, with no detail, no signature and no reconciliation control.
//
// AUTHORITY. `ok: true` from the bridge IS the finalized terminal result. It already
// requires a finalized, message- and metadata-clean, effect-verified attempt whose
// durable attempt record was resolved on that, read on the attempt's own connection.
// This panel therefore consumes `ok: true` directly and NEVER re-derives, re-reads or
// downgrades it: there is no balance snapshot, no counter snapshot and no readback
// verification here. The read-only holder-context read that remains drives resting
// preview gating only.
//
// PRESENTATION IS SOURCE-TOTAL. Every one of the bridge's 36 typed convert results and
// every one of the 52 typed saved-attempt combinations maps to exactly one fail-closed
// presentation class. Replaceability is never inferred from a `resolved` boolean.
// Deprecated compatibility literals stay total mapper cases, and no branch claims a
// decline or a non-submission.
//
// SEVEN OF THOSE RESULTS ARE NEW, AND SIX OF THEM MEAN "NOTHING WAS BURNED". The bridge
// asks a wallet to SIGN and sends the verified bytes itself, so a declined signature, an
// unreadable signed transaction and a signed message that is not the approved one are
// all facts about a conversion that does not exist — and the copy for them says that
// rather than hedging. The seventh is post-broadcast and never claims otherwise.
//
// The single-transaction receipt is ADDITIVE and strictly downstream of `ok: true`: it
// cannot create, remove, preserve, reopen or change the action result, and it authorizes
// nothing.
//
// A LATER SESSION CAN REACH THAT SAME RECEIPT, and only by asking for it. A reload leaves
// no finalized action projection behind, so the saved-attempt panel carries ONE additional
// explicit, read-only control for a conversion the durable record already resolved as a
// finalized success. It is not one of the three latched operations: it reads exactly the
// one transaction that record retained, using only the amounts and identities that
// record's own approved request carries. It asks no wallet for anything, sends nothing,
// writes nothing, adopts and searches for no other signature, and never runs by itself.
// What it produces is the same additive, non-authoritative evidence, rendered by the same
// card — and nothing ever repeats by itself: a read that produced a receipt withdraws the
// control, and a read that came back with nothing may be asked again, explicitly.
//
// Devnet only; classic SPL only; amounts are BigInt-only (never floating point); no raw
// identifier and no full signature rendered; no receipt-history / indexer or all-wallet
// proof claim; no readiness claim.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useRedaxWallet } from './RedaxWalletProvider'
import {
  useRedaxWalletActions,
  type RedaxConvertExactInResult,
  type RedaxHolderRecoveryRecheckResult,
  type RedaxHolderSolPreflightResult,
  type RedaxWalletActionPhase,
} from './RedaxWalletActions'
import type { RedaxDataSource } from '../data/redaxDataSource'
import type {
  RedaxCampaignView,
  RedaxConnectedWalletHolderContextView,
  RedaxConvertReceiptVerificationView,
  RedaxTokenConfigView,
  RedaxWalletAtaStatus,
} from '../data/redaxViewModels'
import { MetricRow } from '../components/MetricRow'
import { StatusPill } from '../components/StatusPill'
import {
  calculateConversionQuote,
  evaluateCapProjection,
  parseRawAmount,
  type ConversionAmounts,
  type QuoteRejectionKind,
} from '../lib/quoteMath'
import {
  CONVERT_ACTION_ACK_HELP,
  CONVERT_ACTION_ACK_LABEL,
  CONVERT_ACTION_AWAITING_APPROVAL,
  CONVERT_ACTION_AWAITING_APPROVAL_PILL,
  CONVERT_ACTION_BOUNDARY,
  CONVERT_ACTION_BUTTON,
  CONVERT_ACTION_CONFIRMING,
  CONVERT_ACTION_COPY,
  CONVERT_ACTION_DISABLED_ACK,
  CONVERT_ACTION_DISABLED_ATTEMPT_BLOCK,
  CONVERT_ACTION_DISABLED_BLOCKED,
  CONVERT_ACTION_DISABLED_SOL_INSUFFICIENT,
  CONVERT_ACTION_DISABLED_SOL_UNAVAILABLE,
  CONVERT_ACTION_DISABLED_UNAVAILABLE,
  CONVERT_ACTION_GATING_NOTE,
  CONVERT_ACTION_PROOF_NOTE,
  CONVERT_ACTION_RECONCILING_PILL,
  CONVERT_FORM_CLEAR_AFTER_FINALIZED_SUCCESS,
  CONVERT_FORM_CLEAR_AFTER_REPLACEABLE_TERMINAL,
  CONVERT_FORM_CLEAR_HELP,
  CONVERT_PREFLIGHT_FAILURE_COPY,
  CONVERT_PREVIEW_AMOUNT_INVALID,
  CONVERT_PREVIEW_AMOUNT_LABEL,
  CONVERT_PREVIEW_AMOUNT_OVER_BALANCE,
  CONVERT_PREVIEW_AMOUNT_PLACEHOLDER,
  CONVERT_PREVIEW_AMOUNT_TOO_LARGE,
  CONVERT_PREVIEW_AMOUNT_TOO_MANY_DECIMALS,
  CONVERT_PREVIEW_AMOUNT_ZERO,
  CONVERT_PREVIEW_BALANCE_UNAVAILABLE,
  CONVERT_PREVIEW_BLOCK_AMOUNT_TOO_SMALL,
  CONVERT_PREVIEW_BLOCK_CAMPAIGN_CAP,
  CONVERT_PREVIEW_BLOCK_INVALID_RATE,
  CONVERT_PREVIEW_BLOCK_METADATA,
  CONVERT_PREVIEW_BLOCK_NOT_ACTIVE,
  CONVERT_PREVIEW_BLOCK_TOKENCONFIG_CAP,
  CONVERT_PREVIEW_BLOCK_WINDOW_CLOSED,
  CONVERT_PREVIEW_BOUNDARY,
  CONVERT_PREVIEW_BURN_WARNING,
  CONVERT_PREVIEW_CONNECT_REQUIRED,
  CONVERT_PREVIEW_EYEBROW,
  CONVERT_PREVIEW_INTRO,
  CONVERT_PREVIEW_MAX_LABEL,
  CONVERT_PREVIEW_NO_BALANCE,
  CONVERT_PREVIEW_NO_TOKEN_CONFIG,
  CONVERT_PREVIEW_OUTPUT_ATA_MISMATCH,
  CONVERT_PREVIEW_OUTPUT_ATA_UNAVAILABLE,
  CONVERT_PREVIEW_PANEL_TITLE,
  CONVERT_PREVIEW_PREPARE_FIRST,
  CONVERT_PREVIEW_READING,
  CONVERT_PREVIEW_REMAINDER_NOTE,
  CONVERT_RECEIPT_BOUNDARY,
  CONVERT_RECEIPT_EYEBROW,
  CONVERT_RECEIPT_LOADING,
  CONVERT_RECEIPT_MISMATCH,
  CONVERT_RECEIPT_RECOVERY_BUTTON,
  CONVERT_RECEIPT_RECOVERY_HELP,
  CONVERT_RECEIPT_RECOVERY_UNAVAILABLE_HELP,
  CONVERT_RECEIPT_TITLE,
  CONVERT_RECEIPT_UNAVAILABLE,
  CONVERT_RECOVERY_COPY,
  CONVERT_SOL_PREFLIGHT_RECHECK_LABEL,
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
  type RedaxHolderActionPresentationKind,
  type RedaxHolderCurrentObservationCopyKey,
  type RedaxHolderDurableObservationCopyKey,
  type RedaxHolderFinalityCopyKey,
  type RedaxHolderPreflightFailureCopyKey,
  type RedaxHolderRecoveryPresentationKind,
} from '../lib/productCopy'

const PROTOCOL_FEE_LABEL = '100 bps (1%)'

// Inclusive maximum classic-SPL amount (u64). A base-unit amount above this cannot be
// encoded as an SPL `amount_in`, so it is not a previewable conversion amount.
const U64_MAX = 18446744073709551615n

/** Why a typed display-unit amount is not a usable base-unit amount. */
type AmountErrorReason = 'format' | 'too_many_decimals' | 'zero' | 'too_large'

/** The full set of amount errors surfaced by the panel (parse errors + over-balance). */
type PreviewAmountError = AmountErrorReason | 'over_balance'

type DisplayAmountParse = { ok: true; baseUnits: bigint } | { ok: false; reason: AmountErrorReason }

/**
 * Parse a display-unit decimal string into base units for `decimals`, BigInt-only.
 * Accepts a strict decimal form — digits, at most one '.', digits (caller trims
 * whitespace) — and rejects anything with a sign, exponent, or separators, more
 * fractional places than `decimals`, a zero/empty value, or a value above the u64 max.
 * Never throws and never uses floating point.
 */
function parseDisplayAmountToBaseUnits(raw: string, decimals: number): DisplayAmountParse {
  if (raw === '.' || !/^[0-9]*\.?[0-9]*$/.test(raw)) {
    return { ok: false, reason: 'format' }
  }
  const dotIndex = raw.indexOf('.')
  const wholePart = dotIndex === -1 ? raw : raw.slice(0, dotIndex)
  const fractionPart = dotIndex === -1 ? '' : raw.slice(dotIndex + 1)
  if (fractionPart.length > decimals) {
    return { ok: false, reason: 'too_many_decimals' }
  }
  const wholeDigits = wholePart === '' ? '0' : wholePart
  const fractionDigits = fractionPart.padEnd(decimals, '0')
  let baseUnits: bigint
  try {
    baseUnits =
      BigInt(wholeDigits) * 10n ** BigInt(decimals) +
      (fractionDigits === '' ? 0n : BigInt(fractionDigits))
  } catch {
    return { ok: false, reason: 'format' }
  }
  if (baseUnits <= 0n) {
    return { ok: false, reason: 'zero' }
  }
  if (baseUnits > U64_MAX) {
    return { ok: false, reason: 'too_large' }
  }
  return { ok: true, baseUnits }
}

/**
 * Render a raw base-unit bigint at `decimals` with thousands separators, trimming
 * trailing fractional zeros. Display only — BigInt math, never floating point.
 */
function formatBaseUnits(value: bigint, decimals: number): string {
  const negative = value < 0n
  const abs = negative ? -value : value
  const base = 10n ** BigInt(decimals)
  const whole = (abs / base).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  let fraction = ''
  if (decimals > 0) {
    const trimmed = (abs % base).toString().padStart(decimals, '0').replace(/0+$/, '')
    if (trimmed.length > 0) {
      fraction = `.${trimmed}`
    }
  }
  return `${negative ? '-' : ''}${whole}${fraction}`
}

/**
 * Render a raw base-unit bigint at `decimals` as a PLAIN decimal string (no thousands
 * separators) that `parseDisplayAmountToBaseUnits` round-trips exactly. Used only to
 * fill the amount field from a known balance ("Max") — it never submits or converts.
 */
function toPlainDecimalString(value: bigint, decimals: number): string {
  const abs = value < 0n ? -value : value
  const base = 10n ** BigInt(decimals)
  const whole = (abs / base).toString()
  if (decimals === 0) {
    return whole
  }
  const fraction = (abs % base).toString().padStart(decimals, '0').replace(/0+$/, '')
  return fraction.length > 0 ? `${whole}.${fraction}` : whole
}

/** Focused input's output display unit — the Metaplex symbol when set, else the label. */
function resolveOutputUnit(tokenConfig: RedaxTokenConfigView): string {
  const identity = tokenConfig.outputTokenIdentity
  if (identity && identity.source === 'metaplex' && identity.symbol.length > 0) {
    return identity.symbol
  }
  return tokenConfig.outputMintLabel
}

function amountErrorText(error: PreviewAmountError): string {
  switch (error) {
    case 'format':
      return CONVERT_PREVIEW_AMOUNT_INVALID
    case 'too_many_decimals':
      return CONVERT_PREVIEW_AMOUNT_TOO_MANY_DECIMALS
    case 'zero':
      return CONVERT_PREVIEW_AMOUNT_ZERO
    case 'too_large':
      return CONVERT_PREVIEW_AMOUNT_TOO_LARGE
    case 'over_balance':
      return CONVERT_PREVIEW_AMOUNT_OVER_BALANCE
  }
}

function rejectionText(rejection: QuoteRejectionKind): string {
  switch (rejection) {
    case 'amount_too_small':
      return CONVERT_PREVIEW_BLOCK_AMOUNT_TOO_SMALL
    case 'invalid_rate':
      return CONVERT_PREVIEW_BLOCK_INVALID_RATE
    case 'zero_amount':
      return CONVERT_PREVIEW_AMOUNT_ZERO
  }
}

// Preview computed purely from the amount input + focused campaign/token config +
// the connected wallet's known legacy balance. `idle` = empty input; `amount_error`
// = the input is not a usable amount; `quote_rejected` = a valid amount the program
// would reject before any output; `quote` = the previewed amounts plus any pre-burn
// blocks (status / window / metadata / cap) that would still reject the conversion.
type PreviewState =
  | { kind: 'idle' }
  | { kind: 'amount_error'; error: PreviewAmountError }
  | { kind: 'quote_rejected'; rejection: QuoteRejectionKind; blocks: readonly string[] }
  | { kind: 'quote'; amountIn: bigint; amounts: ConversionAmounts; blocks: readonly string[] }

// --- Structural type derivation ------------------------------------------------
//
// The nested vocabulary the presentation needs is owned by foundation modules this
// component may not import — not even type-only. It is therefore derived from the
// bridge's exported public result unions with Extract / indexed access / NonNullable
// only. No literal union is re-declared, nothing is cast, and nothing is re-exported.

type ConvertFailure = Extract<RedaxConvertExactInResult, { ok: false }>
type ConvertFailureCode = ConvertFailure['code']
type RecoveryPresent = Extract<
  RedaxHolderRecoveryRecheckResult,
  { ok: true; kind: 'ATTEMPT_PRESENT' }
>
type RecoveryRefusal = Extract<RedaxHolderRecoveryRecheckResult, { ok: false }>
type RecoveryRefusalCode = RecoveryRefusal['code']
type RecoveryAction = RecoveryPresent['action']
type RecoveryObservation = RecoveryPresent['observation']
/**
 * The durable finalized-conversion context a saved-attempt projection may carry.
 *
 * Derived from the bridge's own optional member rather than re-declared, so the panel
 * cannot drift from the projection it consumes. It is INTERNAL to this panel: it is
 * never rendered, never stored anywhere durable, and never authority.
 */
type ConvertDurableReceiptContext = NonNullable<RecoveryPresent['convertReceipt']>

/** This panel's own action within the shared, wallet-scoped saved-attempt slot. */
const CONVERT_RECOVERY_ACTION: RecoveryAction = 'convert_exact_in'

// --- Presentation model --------------------------------------------------------

/** Visual tone of one presentation class. Presentation only; never authority. */
export type RedaxHolderPresentationTone = 'neutral' | 'positive' | 'caution' | 'info'

/** Which panel a saved-attempt record belongs to, relative to this one. */
export type RedaxHolderRecoveryScope = 'MATCHING_ACTION' | 'OTHER_ACTION' | 'NOT_ACTION_SPECIFIC'

/** One typed convert result, resolved to exactly one fail-closed presentation class. */
export interface RedaxConvertActionPresentation {
  readonly kind: RedaxHolderActionPresentationKind
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
export interface RedaxConvertRecoveryPresentation {
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

const CONVERT_ACTION_CLASS: Record<RedaxHolderActionPresentationKind, ActionClassFacts> = {
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
}

/**
 * Which pre-invocation refusals are an ordinary input / state correction the holder can
 * act on, and which are not. Both are pre-invocation, so neither is a repeat of a
 * submitted transaction.
 */
const CONVERT_PREFLIGHT_ORDINARY_CORRECTION: Record<RedaxHolderPreflightFailureCopyKey, boolean> = {
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
  // refusal was pre-invocation — nothing was burned — so a later explicit gesture is
  // permitted. It still has to pass every check again, this one included.
  PAYER_SOL_INSUFFICIENT: true,
}

interface RecoveryClassFacts {
  readonly tone: RedaxHolderPresentationTone
  readonly blocksNewAction: boolean
  readonly clearsLocalBlock: boolean
  readonly showsEvidence: boolean
}

const CONVERT_RECOVERY_CLASS: Record<RedaxHolderRecoveryPresentationKind, RecoveryClassFacts> = {
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
function convertUnhandledLiteral(_value: never): 'INCONSISTENT_NON_SUCCESS' {
  return 'INCONSISTENT_NON_SUCCESS'
}

function convertUnhandledRecoveryLiteral(_value: never): 'INCONSISTENT_RESOLVED_FAIL_CLOSED' {
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
export function redaxShortConvertSignature(signature: string): string | null {
  const trimmed = signature.trim()
  if (trimmed.length < REDAX_SHORT_SIGNATURE_MINIMUM) {
    return null
  }
  const head = trimmed.slice(0, REDAX_SHORT_SIGNATURE_EDGE)
  const tail = trimmed.slice(trimmed.length - REDAX_SHORT_SIGNATURE_EDGE)
  return `${head}…${tail}`
}

function convertActionPresentation(
  kind: RedaxHolderActionPresentationKind,
  detail: string | null,
  permitsOverride: boolean | null,
): RedaxConvertActionPresentation {
  const facts = CONVERT_ACTION_CLASS[kind]
  return {
    kind,
    tone: facts.tone,
    pill: HOLDER_ACTION_PILL[kind],
    lead: CONVERT_ACTION_COPY[kind],
    detail,
    permitsNewExplicitAction:
      permitsOverride === null ? facts.permitsNewExplicitAction : permitsOverride,
    offersRecoveryCheck: facts.offersRecoveryCheck,
    showsEvidence: facts.showsEvidence,
  }
}

function convertPreflightFailurePresentation(
  code: RedaxHolderPreflightFailureCopyKey,
): RedaxConvertActionPresentation {
  return convertActionPresentation(
    'PREFLIGHT_FAILURE',
    CONVERT_PREFLIGHT_FAILURE_COPY[code],
    CONVERT_PREFLIGHT_ORDINARY_CORRECTION[code],
  )
}

// --- The sign-only vocabulary ------------------------------------------------------
//
// WHY THIS COPY IS OWNED HERE. The bridge no longer asks a wallet to SEND: it asks a
// wallet to SIGN, verifies the signed transaction against the exact approved one, and
// sends the bytes itself. That makes six new results possible, and every one of them
// is a fact about a conversion this app never broadcast — no burn, no mint, no fee.
//
// The shared copy table has no sentence for that. Its closest classes both say
// "refused before your wallet was asked", which is precisely what is NOT true once a
// wallet has been asked to sign and has declined, or has handed back something other
// than the approved transaction. So the CLASS is still a shared one — this panel
// invents no new presentation class, no new pill and no new tone — and only the lead
// sentence is owned here. Like every other, it is fixed and value-free: no address, no
// signature, no wallet name, no provider message, no error text and no amount.

/** The sign-only results, derived from the bridge's own union rather than re-declared. */
type ConvertSignOnlyCode = Extract<
  ConvertFailureCode,
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
const CONVERT_SIGN_ONLY_CLASS: Record<ConvertSignOnlyCode, RedaxHolderActionPresentationKind> = {
  WALLET_SIGN_ONLY_UNAVAILABLE: 'WALLET_UNAVAILABLE',
  WALLET_SIGN_ONLY_FAILED: 'PREFLIGHT_REFUSED',
  SIGNED_TRANSACTION_UNREADABLE: 'PREFLIGHT_REFUSED',
  SIGNED_MESSAGE_VERIFICATION_UNAVAILABLE: 'PREFLIGHT_REFUSED',
  SIGNED_MESSAGE_MISMATCH: 'PREFLIGHT_REFUSED',
  SIGNATURE_UNUSABLE: 'PREFLIGHT_REFUSED',
  RPC_SIGNATURE_MISMATCH: 'SUPPORT_ONLY',
}

const CONVERT_SIGN_ONLY_COPY: Record<ConvertSignOnlyCode, string> = {
  WALLET_SIGN_ONLY_UNAVAILABLE:
    'Your wallet did not offer a signing-only request, so it was never asked and nothing was sent. Nothing was burned and nothing was converted. This app signs and sends as two separate steps and does not ask a wallet to send a transaction on your behalf.',
  WALLET_SIGN_ONLY_FAILED:
    'The signing request did not complete in your wallet. Nothing was sent to devnet, nothing was burned and nothing was converted: this app sends the transaction itself, and it never reached that step.',
  SIGNED_TRANSACTION_UNREADABLE:
    'The signed transaction your wallet returned could not be read here, so it was not sent. Nothing reached devnet, nothing was burned and nothing was converted.',
  SIGNED_MESSAGE_VERIFICATION_UNAVAILABLE:
    'The signed transaction could not be verified in this browser, so it was not sent. Nothing reached devnet, nothing was burned and nothing was converted.',
  SIGNED_MESSAGE_MISMATCH:
    'The transaction your wallet signed is not the transaction that was approved here, so it was not sent. Nothing reached devnet, nothing was burned and nothing was converted.',
  SIGNATURE_UNUSABLE:
    'The signature your wallet returned could not be used, so the transaction was not sent. Nothing reached devnet, nothing was burned and nothing was converted.',
  RPC_SIGNATURE_MISMATCH:
    'The transaction was sent, and devnet answered with a different transaction signature than the one signed here. This attempt cannot be resolved automatically and needs support. Nothing is sent again.',
}

function convertSignOnlyPresentation(code: ConvertSignOnlyCode): RedaxConvertActionPresentation {
  const kind = CONVERT_SIGN_ONLY_CLASS[code]
  const facts = CONVERT_ACTION_CLASS[kind]
  return {
    kind,
    tone: facts.tone,
    pill: HOLDER_ACTION_PILL[kind],
    lead: CONVERT_SIGN_ONLY_COPY[code],
    detail: null,
    permitsNewExplicitAction: facts.permitsNewExplicitAction,
    offersRecoveryCheck: facts.offersRecoveryCheck,
    showsEvidence: facts.showsEvidence,
  }
}

/**
 * Resolve one typed convert result to exactly one presentation class.
 *
 * TOTAL over all 36 typed inputs — `ok: true` plus the 35 failure codes, including the
 * seven sign-only results, the three deprecated compatibility literals and the
 * inconsistent `ok: false` + `FINALIZED_EFFECT_MATCHING` arm, which can never become a
 * success. Pure: it reads no runtime state, sends nothing, and returns no
 * authorization.
 */
export function resolveRedaxConvertActionPresentation(
  result: RedaxConvertExactInResult,
): RedaxConvertActionPresentation {
  if (result.ok) {
    return convertActionPresentation('FINALIZED_SUCCESS', null, null)
  }
  const code: ConvertFailureCode = result.code
  switch (code) {
    case 'PREFLIGHT_REFUSED':
      return convertActionPresentation('PREFLIGHT_REFUSED', null, null)
    case 'WALLET_NOT_CONNECTED':
      return convertActionPresentation('WALLET_UNAVAILABLE', null, null)
    case 'WRONG_MODE':
    case 'RUNTIME_CONFIG_UNAVAILABLE':
      return convertActionPresentation('RUNTIME_REFUSED', null, null)
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
      return convertPreflightFailurePresentation(code)
    case 'ATTEMPT_BLOCKED':
      return convertActionPresentation('PRIOR_ATTEMPT_BLOCKS', null, null)
    case 'JOURNAL_UNAVAILABLE':
      return convertActionPresentation('JOURNAL_FAIL_CLOSED', null, null)
    case 'SUBMISSION_OUTCOME_UNKNOWN_WITHOUT_SIGNATURE':
      return convertActionPresentation('POST_UNKNOWN_NO_SIGNATURE', null, null)
    case 'SIGNATURE_OBSERVED':
      return convertActionPresentation('SIGNATURE_OBSERVED', null, null)
    case 'CONFIRMATION_PENDING':
      return convertActionPresentation('CONFIRMATION_PENDING', null, null)
    case 'LANDED_TRANSACTION_FAILED':
      return convertActionPresentation(
        result.finality === 'finalized' ? 'LANDED_FAILED_RESOLVED' : 'LANDED_FAILED_PROVISIONAL',
        null,
        null,
      )
    case 'LANDED_MESSAGE_MISMATCH':
      return convertActionPresentation('LANDED_MESSAGE_MISMATCH', null, null)
    // The sign-only vocabulary. The first six are ZERO REDAX BROADCAST and say so; the
    // last is post-broadcast and must never be presented as though nothing was sent.
    case 'WALLET_SIGN_ONLY_UNAVAILABLE':
    case 'WALLET_SIGN_ONLY_FAILED':
    case 'SIGNED_TRANSACTION_UNREADABLE':
    case 'SIGNED_MESSAGE_VERIFICATION_UNAVAILABLE':
    case 'SIGNED_MESSAGE_MISMATCH':
    case 'SIGNATURE_UNUSABLE':
    case 'RPC_SIGNATURE_MISMATCH':
      return convertSignOnlyPresentation(code)
    case 'CONFIRMED_EFFECT_MATCHING':
      return convertActionPresentation('CONFIRMED_MATCHING_PROVISIONAL', null, null)
    // `ok: false` can never be a success, whatever it observed.
    case 'FINALIZED_EFFECT_MATCHING':
      return convertActionPresentation('INCONSISTENT_NON_SUCCESS', null, null)
    case 'READ_UNAVAILABLE':
      return convertActionPresentation('READ_UNAVAILABLE', null, null)
    case 'SUPPORT_ONLY':
      return convertActionPresentation('SUPPORT_ONLY', null, null)
    // Deprecated compatibility literals. No production path emits them after
    // invocation; they remain total, fail-closed cases and claim nothing.
    case 'SEND_FAILED':
    case 'USER_REJECTED':
    case 'CONFIRM_FAILED':
      return convertActionPresentation('DEPRECATED_COMPATIBILITY_NON_SUCCESS', null, null)
    default:
      return convertActionPresentation(convertUnhandledLiteral(code), null, null)
  }
}

function convertRecoveryPresentation(
  kind: RedaxHolderRecoveryPresentationKind,
  scope: RedaxHolderRecoveryScope,
  record: RecoveryPresent | null,
): RedaxConvertRecoveryPresentation {
  const facts = CONVERT_RECOVERY_CLASS[kind]
  // Only the panel whose own action matches the saved record shows its detail. The
  // sibling panel infers nothing from it — no campaign, no token config, no signature.
  const showsEvidence = facts.showsEvidence && scope === 'MATCHING_ACTION' && record !== null
  const text =
    scope === 'OTHER_ACTION'
      ? facts.blocksNewAction
        ? HOLDER_RECOVERY_OTHER_ACTION_BLOCK
        : HOLDER_RECOVERY_OTHER_ACTION_CLEAR
      : CONVERT_RECOVERY_COPY[kind]
  const signature =
    showsEvidence && record !== null && record.signature !== null
      ? redaxShortConvertSignature(record.signature)
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
export function resolveRedaxConvertRecoveryPresentation(
  result: RedaxHolderRecoveryRecheckResult,
): RedaxConvertRecoveryPresentation {
  if (!result.ok) {
    const code: RecoveryRefusalCode = result.code
    switch (code) {
      case 'WALLET_NOT_CONNECTED':
        return convertRecoveryPresentation('CURRENT_WALLET_REFUSED', 'NOT_ACTION_SPECIFIC', null)
      case 'RUNTIME_CONFIG_UNAVAILABLE':
        return convertRecoveryPresentation('RUNTIME_REFUSED', 'NOT_ACTION_SPECIFIC', null)
      case 'JOURNAL_UNAVAILABLE':
        return convertRecoveryPresentation('JOURNAL_FAIL_CLOSED', 'NOT_ACTION_SPECIFIC', null)
      default:
        return convertRecoveryPresentation(
          convertUnhandledRecoveryLiteral(code),
          'NOT_ACTION_SPECIFIC',
          null,
        )
    }
  }
  if (result.kind === 'NO_ATTEMPT') {
    return convertRecoveryPresentation('NO_SAVED_ATTEMPT', 'NOT_ACTION_SPECIFIC', null)
  }
  const scope: RedaxHolderRecoveryScope =
    result.action === CONVERT_RECOVERY_ACTION ? 'MATCHING_ACTION' : 'OTHER_ACTION'
  if (!result.resolved) {
    return convertRecoveryPresentation('UNRESOLVED_ATTEMPT', scope, result)
  }
  const observation: RecoveryObservation = result.observation
  switch (observation) {
    case 'PREFLIGHT_REFUSED':
      return convertRecoveryPresentation('REPLACEABLE_PRE_INVOCATION_TOMBSTONE', scope, result)
    case 'FINALIZED_EFFECT_MATCHING':
      return convertRecoveryPresentation('REPLACEABLE_FINALIZED_SUCCESS_TOMBSTONE', scope, result)
    case 'LANDED_TRANSACTION_FAILED':
    case 'LANDED_MESSAGE_MISMATCH':
      return convertRecoveryPresentation(
        'REPLACEABLE_ACCEPTED_KNOWN_SIGNATURE_FAILURE_TOMBSTONE',
        scope,
        result,
      )
    case 'SUPPORT_ONLY':
      return convertRecoveryPresentation(
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
      return convertRecoveryPresentation('INCONSISTENT_RESOLVED_FAIL_CLOSED', scope, result)
    default:
      return convertRecoveryPresentation(
        convertUnhandledRecoveryLiteral(observation),
        scope,
        result,
      )
  }
}

/**
 * Whether this panel may offer a new explicit convert gesture right now.
 *
 * Pure, and a WITHHOLDING rule only: it can refuse, it can never grant. The action
 * bridge and the durable attempt record remain the sole exclusion authority, and they
 * refuse independently of whatever any panel is currently showing.
 */
export function redaxConvertNewActionPermitted(
  recovery: RedaxConvertRecoveryPresentation | null,
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
// above a resolved saved attempt states two different things about one conversion.
//
// PRESENTATION ONLY, AND IN ONE DIRECTION. This confers no action authority. It selects
// what the action strip renders and nothing else: it invents no class, reads no chain,
// infers nothing from React state, writes no durable record, sends nothing, burns nothing
// and authorizes nothing. The durable journal stays the authority, and the ONLY trigger is
// a typed saved-attempt projection resolved from its readback.
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
// IT NEVER REOPENS THE FORM. Every disposition leaves this panel SETTLED rather than
// resting, so the amount field, the acknowledgement and the convert call to action stay
// unrendered exactly as they were: the only thing offered afterwards is the existing
// explicit form clear, and a later conversion still needs its own fresh amount, its own
// fresh acknowledgement and its own fresh gesture.

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
const CONVERT_ACTION_TERMINAL: Record<RedaxHolderActionPresentationKind, boolean> = {
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
export type RedaxConvertTerminalSyncDisposition =
  | { readonly kind: 'NO_SYNCHRONIZATION' }
  | {
      readonly kind: 'ACTION_PRESENTATION'
      readonly presentation: RedaxHolderActionPresentationKind
    }
  | { readonly kind: 'RECOVERY_PANEL_ONLY' }

const CONVERT_NO_TERMINAL_SYNC: RedaxConvertTerminalSyncDisposition = {
  kind: 'NO_SYNCHRONIZATION',
}
const CONVERT_TERMINAL_SYNC_RECOVERY_PANEL_ONLY: RedaxConvertTerminalSyncDisposition = {
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
export function redaxConvertTerminalSyncDisposition(
  recovery: RedaxConvertRecoveryPresentation,
  current: RedaxHolderActionPresentationKind,
): RedaxConvertTerminalSyncDisposition {
  // A record the sibling panel owns says nothing about this panel's own attempt.
  if (recovery.scope !== 'MATCHING_ACTION') {
    return CONVERT_NO_TERMINAL_SYNC
  }
  if (CONVERT_ACTION_TERMINAL[current]) {
    return CONVERT_NO_TERMINAL_SYNC
  }
  // The durable finalized-success tombstone, admitted only on the finalized matching
  // effect it is resolved on.
  if (recovery.kind === 'REPLACEABLE_FINALIZED_SUCCESS_TOMBSTONE') {
    return recovery.durableObservation === 'FINALIZED_EFFECT_MATCHING'
      ? { kind: 'ACTION_PRESENTATION', presentation: 'FINALIZED_SUCCESS' }
      : CONVERT_NO_TERMINAL_SYNC
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
      return CONVERT_TERMINAL_SYNC_RECOVERY_PANEL_ONLY
    }
    return CONVERT_NO_TERMINAL_SYNC
  }
  return CONVERT_NO_TERMINAL_SYNC
}

// --- Panel-local state ---------------------------------------------------------

interface ConvertActionEvidence {
  readonly shortSignature: string | null
  readonly finality: RedaxHolderFinalityCopyKey | null
  readonly contextSlot: number | null
}

const NO_ACTION_EVIDENCE: ConvertActionEvidence = {
  shortSignature: null,
  finality: null,
  contextSlot: null,
}

// `in_flight` carries the bridge's ephemeral progress phase. It is LOCAL PROGRESS
// ONLY: it is never evidence, never a durable record and never authority.
// `settled` carries one more fact than the class it holds: whether the durable record
// RETIRED that class instead of replacing it. A retired projection renders no pill, no
// lead, no detail and no evidence — the saved-attempt panel is the sole terminal truth —
// while the panel stays SETTLED rather than resting, so the amount, the acknowledgement
// and the call to action stay unrendered. Only the existing explicit form clear reopens
// a fresh conversion form, and it clears both of those to their empty values first.
type ConvertActionState =
  | { kind: 'resting' }
  | { kind: 'in_flight'; phase: RedaxWalletActionPhase }
  | {
      kind: 'settled'
      presentation: RedaxConvertActionPresentation
      evidence: ConvertActionEvidence
      recoveryPanelOnly: boolean
    }

// `reconciling` CARRIES the projection it started from, and that is not decoration:
// the reconcile control must stay rendered and visibly disabled for the whole
// operation. A state that dropped the projection would make the control vanish the
// instant it was pressed, which is indistinguishable — to anyone looking — from a
// control that did nothing.
//
// `settled` additionally CARRIES the durable finalized-conversion context the readback
// projected, when there is one. It is an INTERNAL member: nothing renders it, nothing
// derives a presentation class from it, and it is OPTIONAL rather than nullable so that
// the fail-closed arms below state nothing about a receipt at all.
type ConvertRecoveryState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'reconciling'; presentation: RedaxConvertRecoveryPresentation }
  | {
      kind: 'settled'
      presentation: RedaxConvertRecoveryPresentation
      unchanged: boolean
      receiptContext?: ConvertDurableReceiptContext
    }

// Additive Tier 1 receipt-card state. Strictly downstream of a finalized terminal
// result — a failed or unavailable decode never changes it.
type ReceiptCardState =
  | { kind: 'none' }
  | { kind: 'loading' }
  | { kind: 'ready'; view: RedaxConvertReceiptVerificationView }
  | { kind: 'unavailable' }

// One explicitly recovered receipt, TOGETHER WITH the exact durable context it was read
// for. The pairing is the invalidation rule: a card whose context is no longer the one
// the saved record projects is not this attempt's card, and is never shown as one.
interface ConvertRecoveredReceiptState {
  readonly context: ConvertDurableReceiptContext
  readonly card: ReceiptCardState
}

// The connected wallet's devnet SOL preflight, as this panel holds it.
//
// AVAILABILITY INFORMATION, never authority. It gates only what this panel OFFERS; the
// action bridge rechecks the balance itself, on the attempt's own connection and
// immediately before the attempt slot is opened. `idle` exists only for a disconnected
// identity — a connected one is READING until its own read settles, so an unread
// balance is never mistaken for a sufficient one.
type ConvertSolPreflightState =
  | { kind: 'idle' }
  | { kind: 'reading' }
  | { kind: 'settled'; result: RedaxHolderSolPreflightResult }

/** The neutral values every out-of-scope projection resolves to while rendering. */
const CONVERT_RESTING_ACTION_STATE: ConvertActionState = { kind: 'resting' }
const CONVERT_IDLE_RECOVERY_STATE: ConvertRecoveryState = { kind: 'idle' }
const CONVERT_NO_RECEIPT_STATE: ReceiptCardState = { kind: 'none' }
const CONVERT_SOL_PREFLIGHT_IDLE: ConvertSolPreflightState = { kind: 'idle' }
const CONVERT_SOL_PREFLIGHT_READING_STATE: ConvertSolPreflightState = { kind: 'reading' }

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
// evidence, never authority and never a durable record. The additive receipt tail stays
// OUTSIDE it, exactly as it stays outside the synchronous latch.

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
// a new wallet, campaign or token config — before any passive effect runs, and whether or
// not one ever does. The passive resets further down are memory hygiene and generation
// bookkeeping only; neither privacy nor call-to-action gating depends on them.

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
 * no prior wallet's, campaign's or token config's projection can reach the returned tree.
 */
function inScope<T>(record: ScopedState<T>, currentScope: string, restingValue: T): T {
  return record.scope === currentScope ? record.value : restingValue
}

/**
 * Exactly the identifiers and raw amounts the receipt decode compares against, captured
 * from the accepted preview before the action runs.
 *
 * There is deliberately NO "before" balance and NO counter here: nothing in this panel
 * verifies an effect any more, so a snapshot of anything else would only be a second,
 * weaker authority.
 */
interface ConvertReceiptExpectation {
  readonly campaignId: string
  readonly tokenConfigId: string
  readonly user: string
  readonly legacyMint: string
  readonly outputMint: string
  readonly amountInRaw: string
  readonly grossOutRaw: string
  readonly feeOutRaw: string
  readonly userOutRaw: string
  readonly protocolFeeVault: string
}

/** A stable projection of what this panel is showing, for a purely LOCAL comparison. */
function recoveryProjectionKey(presentation: RedaxConvertRecoveryPresentation): string {
  return [
    presentation.kind,
    presentation.scope,
    presentation.durableObservation ?? '',
    presentation.shortSignature ?? '',
    presentation.currentObservation ?? '',
    presentation.currentFinality ?? '',
  ].join('|')
}

/**
 * The durable finalized-conversion context ONE typed saved-attempt result carries.
 *
 * Read from the RESULT, never from the presentation class beside it: a class is this
 * panel's own summary, and summarising is exactly where an ineligible record could
 * acquire a receipt it never earned. The bridge projects the member only for a convert
 * tombstone its own resolving transition wrote as a finalized success, so an absent
 * member here is the fail-closed answer for every other combination.
 */
function readConvertRecoveryReceiptContext(
  result: RedaxHolderRecoveryRecheckResult,
): ConvertDurableReceiptContext | null {
  if (!result.ok || result.kind !== 'ATTEMPT_PRESENT') {
    return null
  }
  if (result.action !== CONVERT_RECOVERY_ACTION) {
    return null
  }
  return result.convertReceipt ?? null
}

/**
 * Whether two durable contexts describe the SAME durable conversion.
 *
 * A pure, field-by-field comparison. Nothing is serialized, hashed, logged or rendered —
 * a comparison that stringified these values would be one more place a whole signature
 * could reach — and every member is compared, so a record replaced by a different
 * conversion of the same amount is still a different context.
 */
function sameConvertReceiptContext(
  left: ConvertDurableReceiptContext | null,
  right: ConvertDurableReceiptContext | null,
): boolean {
  if (left === null || right === null) {
    return left === right
  }
  return (
    left.signature === right.signature &&
    left.user === right.user &&
    left.campaignId === right.campaignId &&
    left.tokenConfigId === right.tokenConfigId &&
    left.legacyMint === right.legacyMint &&
    left.outputMint === right.outputMint &&
    left.amountInRaw === right.amountInRaw &&
    left.grossOutRaw === right.grossOutRaw &&
    left.feeOutRaw === right.feeOutRaw &&
    left.userOutRaw === right.userOutRaw &&
    left.amountInNormalizedRaw === right.amountInNormalizedRaw &&
    left.normalizationRemainderRaw === right.normalizationRemainderRaw &&
    left.userOutputAta === right.userOutputAta &&
    left.protocolFeeVault === right.protocolFeeVault
  )
}

function readConvertEvidence(
  result: RedaxConvertExactInResult,
  presentation: RedaxConvertActionPresentation,
): ConvertActionEvidence {
  if (!presentation.showsEvidence) {
    return NO_ACTION_EVIDENCE
  }
  if (result.ok) {
    return {
      shortSignature: redaxShortConvertSignature(result.signature),
      finality: result.finality,
      contextSlot: result.contextSlot,
    }
  }
  return {
    shortSignature:
      result.signature === undefined ? null : redaxShortConvertSignature(result.signature),
    finality: result.finality ?? null,
    contextSlot: result.contextSlot ?? null,
  }
}

export interface RedaxHolderConvertControlsProps {
  /** True only in DEVNET_TX_ENABLED; the panel renders nothing otherwise. */
  isDevnetTxEnabled: boolean
  /** App-facing data source (read-only reads only here). */
  dataSource: RedaxDataSource
  /** The active migration whose conversion is previewed. */
  campaign: RedaxCampaignView | null
  /** The focused accepted-input token config the preview converts (one at a time). */
  tokenConfig: RedaxTokenConfigView | null
  /** The campaign id the App resolved (may be '' when none). */
  activeCampaignId: string
}

export function RedaxHolderConvertControls({
  isDevnetTxEnabled,
  dataSource,
  campaign,
  tokenConfig,
  activeCampaignId,
}: RedaxHolderConvertControlsProps) {
  const wallet = useRedaxWallet()
  const actions = useRedaxWalletActions()

  const connectedKey = wallet.status === 'connected' ? wallet.publicKeyBase58 : null
  const tokenConfigId = tokenConfig?.id ?? null

  // Two scopes, because the durable attempt record is namespaced by wallet and NOT by
  // campaign or token config. Wallet identity scopes everything; the campaign and the
  // focused token config additionally scope the action projection.
  const walletScopeKey = connectedKey ?? ''
  const actionScopeKey = `${walletScopeKey} ${activeCampaignId} ${tokenConfigId ?? ''}`

  // Each record carries the identity that produced it; nothing below is read directly.
  const [holderContextState, setHolderContextState] = useState<
    ScopedState<RedaxConnectedWalletHolderContextView | null>
  >(() => scopedState(actionScopeKey, null))
  // Initialised the same way the render-time gate resolves an out-of-scope record: a
  // connected identity with no read of its own yet is READING, never "resolved".
  const [contextLoadingState, setContextLoadingState] = useState<ScopedState<boolean>>(() =>
    scopedState(actionScopeKey, connectedKey !== null),
  )
  const [amountInputRecord, setAmountInputRecord] = useState<ScopedState<string>>(() =>
    scopedState(actionScopeKey, ''),
  )
  // One convert attempt's local presentation (resting at `resting`), plus a separate
  // unchecked-by-default acknowledgement. Neither invokes anything; the action runs
  // only from the explicit button click below.
  const [actionStateRecord, setActionStateRecord] = useState<ScopedState<ConvertActionState>>(() =>
    scopedState(actionScopeKey, CONVERT_RESTING_ACTION_STATE),
  )
  const [acknowledgedRecord, setAcknowledgedRecord] = useState<ScopedState<boolean>>(() =>
    scopedState(actionScopeKey, false),
  )
  const [recoveryStateRecord, setRecoveryStateRecord] = useState<ScopedState<ConvertRecoveryState>>(
    () => scopedState(walletScopeKey, CONVERT_IDLE_RECOVERY_STATE),
  )
  // A LOCAL, fail-closed suppression. It only ever withholds this panel's call to
  // action; it authorizes nothing, and it clears no durable record.
  const [attemptBlockRecord, setAttemptBlockRecord] = useState<ScopedState<boolean>>(() =>
    scopedState(walletScopeKey, false),
  )
  // Additive Tier 1 receipt: populated only after a finalized terminal result; never a
  // precondition for it, and never able to change it.
  const [receiptStateRecord, setReceiptStateRecord] = useState<ScopedState<ReceiptCardState>>(() =>
    scopedState(actionScopeKey, CONVERT_NO_RECEIPT_STATE),
  )
  // The EXPLICITLY RECOVERED receipt, kept strictly apart from the direct one above. The
  // two can never be confused for one another: this one is wallet-scoped because the
  // durable record it belongs to is, it is only ever written by the explicit receipt
  // handler, and it carries the durable context it was read for so a superseded attempt
  // cannot keep a card that was never about it.
  const [recoveredReceiptRecord, setRecoveredReceiptRecord] = useState<
    ScopedState<ConvertRecoveredReceiptState | null>
  >(() => scopedState(walletScopeKey, null))
  // Initialised the way the render-time gate resolves an out-of-scope record: a
  // connected identity with no read of its own yet is READING, never "sufficient".
  const [solPreflightRecord, setSolPreflightRecord] = useState<ScopedState<ConvertSolPreflightState>>(
    () =>
      scopedState(
        actionScopeKey,
        connectedKey !== null ? CONVERT_SOL_PREFLIGHT_READING_STATE : CONVERT_SOL_PREFLIGHT_IDLE,
      ),
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
  // status, the balances, the preview, the call-to-action enablement or its reason, and
  // no prior amount, acknowledgement, evidence or receipt survives an identity change.
  const holderContext = inScope(holderContextState, actionScopeKey, null)
  const contextLoading = inScope(contextLoadingState, actionScopeKey, connectedKey !== null)
  const amountInput = inScope(amountInputRecord, actionScopeKey, '')
  const actionState = inScope(actionStateRecord, actionScopeKey, CONVERT_RESTING_ACTION_STATE)
  const acknowledged = inScope(acknowledgedRecord, actionScopeKey, false)
  const recoveryState = inScope(recoveryStateRecord, walletScopeKey, CONVERT_IDLE_RECOVERY_STATE)
  const attemptBlockActive = inScope(attemptBlockRecord, walletScopeKey, false)
  const receiptState = inScope(receiptStateRecord, actionScopeKey, CONVERT_NO_RECEIPT_STATE)
  const recoveredReceipt = inScope(recoveredReceiptRecord, walletScopeKey, null)
  const solPreflight = inScope(
    solPreflightRecord,
    actionScopeKey,
    connectedKey !== null ? CONVERT_SOL_PREFLIGHT_READING_STATE : CONVERT_SOL_PREFLIGHT_IDLE,
  )

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
  // The explicit recovered-receipt read carries its OWN generation and its OWN
  // synchronous single-flight latch, for the same reason the SOL preflight does: it is
  // not one of the three mounted-control operations, so it must neither acquire nor
  // extend their latch — and a second press inside one render must still start nothing.
  const recoveredReceiptGenerationRef = useRef(0)
  const recoveredReceiptInFlightRef = useRef(false)
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

  // The recovered receipt is gated on BOTH committed scopes. The durable context is
  // wallet-scoped, but the card is formatted with the CURRENT campaign's and token
  // config's decimals and labels, so a response that lands after either changed is
  // discarded rather than rendered against identifiers it was never read for.
  const isRecoveredReceiptCurrent = useCallback(
    (walletKey: string, actionKey: string, generation: number): boolean => {
      return (
        mountedRef.current &&
        committedWalletScopeRef.current === walletKey &&
        committedActionScopeRef.current === actionKey &&
        recoveredReceiptGenerationRef.current === generation
      )
    },
    [],
  )

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
  // authorization — it only decides whether this panel may OFFER the conversion. Each
  // call supersedes the previous one, so a slow earlier read is never the last writer.
  const runSolPreflightRead = useCallback(
    async (scopeKey: string): Promise<void> => {
      solPreflightGenerationRef.current += 1
      const generation = solPreflightGenerationRef.current
      setSolPreflightRecord(scopedState(scopeKey, CONVERT_SOL_PREFLIGHT_READING_STATE))
      try {
        const result = await readHolderSolPreflightRef.current('CONVERT_EXACT_IN')
        if (!isSolPreflightCurrent(scopeKey, generation)) {
          return
        }
        setSolPreflightRecord(
          scopedState<ConvertSolPreflightState>(scopeKey, { kind: 'settled', result }),
        )
      } catch {
        // A REJECTED read is not an observation. It settles as the panel's existing
        // read-unavailable state — which WITHHOLDS the conversion — rather than as an
        // unhandled rejection or an optimistic sufficiency. No raw error is read,
        // rendered or logged.
        if (!isSolPreflightCurrent(scopeKey, generation)) {
          return
        }
        setSolPreflightRecord(
          scopedState<ConvertSolPreflightState>(scopeKey, {
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

  // Read-only holder/output-ATA + legacy-balance read for the connected wallet. READ
  // ONLY: getConnectedWalletHolderContext performs no signing and no transaction. The
  // same call the prepare panel uses; here it drives preview gating only, and it is
  // never evidence and never verifies, confirms, upgrades or downgrades a result.
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

  // Campaign, token-config or wallet change: invalidate every in-flight action-scoped
  // completion and drop the obsolete records. The render-time gate above has ALREADY
  // hidden them, so this is memory hygiene plus the generation bump the async guards
  // read — never the thing that makes the new identity private. It clears no durable
  // attempt record, resolves nothing, and reinterprets nothing; the record is
  // wallet-scoped and survives untouched.
  useEffect(() => {
    actionGenerationRef.current += 1
    setAmountInputRecord(scopedState(actionScopeKey, ''))
    setAcknowledgedRecord(scopedState(actionScopeKey, false))
    setActionStateRecord(scopedState(actionScopeKey, CONVERT_RESTING_ACTION_STATE))
    setReceiptStateRecord(scopedState(actionScopeKey, CONVERT_NO_RECEIPT_STATE))
    // AND THE EXPLICITLY RECOVERED RECEIPT, whose durable context is wallet-scoped but
    // whose card is formatted with THIS campaign's and token config's decimals and labels.
    // The generation is MONOTONIC, which is the whole point: a string comparison alone
    // would let an A -> B -> A round trip make an old response current again simply by
    // matching the same scope key a second time, so a read started before the churn is
    // stale afterwards whether or not the screen came back to where it started.
    // Panel-local READ and PRESENTATION state only. The durable receipt context the
    // saved-attempt projection carries is deliberately NOT touched here — it stays
    // wallet-scoped and may become eligible again under its own campaign and token config —
    // and no journal, durable record or action authority is read, written or reinterpreted.
    // What it costs is one fresh explicit press, which is exactly the gesture this control
    // is built out of.
    recoveredReceiptGenerationRef.current += 1
    recoveredReceiptInFlightRef.current = false
    setRecoveredReceiptRecord(scopedState(walletScopeKey, null))
  }, [actionScopeKey, walletScopeKey])

  // Wallet change or disconnect: additionally invalidate every wallet-scoped projection —
  // saved-attempt detail and the local block alike. The previous wallet's durable
  // record is never deleted, cleared, acknowledged, overwritten or reinterpreted, and
  // reconnecting that wallet makes its namespace current again.
  useEffect(() => {
    recoveryGenerationRef.current += 1
    recoveredReceiptGenerationRef.current += 1
    recoveredReceiptInFlightRef.current = false
    setRecoveryStateRecord(scopedState(walletScopeKey, CONVERT_IDLE_RECOVERY_STATE))
    setAttemptBlockRecord(scopedState(walletScopeKey, false))
    setRecoveredReceiptRecord(scopedState(walletScopeKey, null))
  }, [walletScopeKey])

  // Resolve the connected-wallet holder context on connect + campaign or token-config
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
  // reading is corrected by an explicit human re-check, never by this panel deciding on
  // its own to ask again. Declared after the invalidation effects for the same reason
  // the holder-context read is.
  useEffect(() => {
    if (!isDevnetTxEnabled || connectedKey === null) {
      setSolPreflightRecord(scopedState(actionScopeKey, CONVERT_SOL_PREFLIGHT_IDLE))
      return
    }
    void runSolPreflightRead(actionScopeKey)
  }, [isDevnetTxEnabled, connectedKey, actionScopeKey, runSolPreflightRead])

  // The connected wallet's balance row for the focused input, if the context resolved.
  const focusedBalanceRow = useMemo(() => {
    if (holderContext === null || holderContext.status !== 'connected' || tokenConfig === null) {
      return null
    }
    return (
      holderContext.legacyInputBalances.find((row) => row.tokenConfigId === tokenConfig.id) ?? null
    )
  }, [holderContext, tokenConfig])

  // The focused input's known raw balance, only when its classic-SPL ATA exists.
  const selectedBalanceRaw =
    focusedBalanceRow !== null && focusedBalanceRow.ataStatus === 'exists'
      ? focusedBalanceRow.balanceRaw
      : null

  // Pure preview: parse the amount, then compute the quote + pre-burn blocks. Never
  // signs, sends, or mutates, and it is never transaction authority. `Date.now()` is
  // read once here for the window check — the preview is "as of now" and refreshes on
  // the next amount change; the program remains the expiry authority.
  const preview = useMemo<PreviewState>(() => {
    if (tokenConfig === null || campaign === null) {
      return { kind: 'idle' }
    }
    const trimmed = amountInput.trim()
    if (trimmed === '') {
      return { kind: 'idle' }
    }
    const parsed = parseDisplayAmountToBaseUnits(trimmed, tokenConfig.legacyDecimals)
    if (!parsed.ok) {
      return { kind: 'amount_error', error: parsed.reason }
    }
    const amountIn = parsed.baseUnits
    if (selectedBalanceRaw !== null && amountIn > parseRawAmount(selectedBalanceRaw)) {
      return { kind: 'amount_error', error: 'over_balance' }
    }
    const nowSec = Math.floor(Date.now() / 1000)
    const statusBlocks: string[] = []
    if (campaign.programStatus !== 'active') {
      statusBlocks.push(CONVERT_PREVIEW_BLOCK_NOT_ACTIVE)
    }
    if (!campaign.metadataSetup) {
      statusBlocks.push(CONVERT_PREVIEW_BLOCK_METADATA)
    }
    if (campaign.endTs !== null && campaign.endTs <= nowSec) {
      statusBlocks.push(CONVERT_PREVIEW_BLOCK_WINDOW_CLOSED)
    }
    const quote = calculateConversionQuote(
      amountIn,
      tokenConfig.legacyDecimals,
      tokenConfig.outputDecimals,
      parseRawAmount(tokenConfig.rateNumeratorRaw),
      parseRawAmount(tokenConfig.rateDenominatorRaw),
    )
    if (!quote.ok) {
      return { kind: 'quote_rejected', rejection: quote.rejection, blocks: statusBlocks }
    }
    const cap = evaluateCapProjection(
      quote.amounts.grossOut,
      parseRawAmount(campaign.maxOutputSupplyRaw),
      parseRawAmount(campaign.totalOutputMintedRaw),
      parseRawAmount(tokenConfig.maxOutputFromTokenConfigRaw),
      parseRawAmount(tokenConfig.totalOutputMintedFromTokenConfigRaw),
    )
    const blocks = [...statusBlocks]
    if (!cap.ok) {
      blocks.push(
        cap.breach === 'campaign'
          ? CONVERT_PREVIEW_BLOCK_CAMPAIGN_CAP
          : CONVERT_PREVIEW_BLOCK_TOKENCONFIG_CAP,
      )
    }
    return { kind: 'quote', amountIn, amounts: quote.amounts, blocks }
  }, [amountInput, tokenConfig, campaign, selectedBalanceRaw])

  if (!isDevnetTxEnabled) {
    return null
  }

  const isConnected = wallet.status === 'connected'
  const outputAtaStatus: RedaxWalletAtaStatus | null =
    holderContext === null
      ? null
      : holderContext.status === 'connected'
        ? holderContext.outputAta?.status ?? 'unavailable'
        : holderContext.status === 'unavailable'
          ? 'unavailable'
          : null

  // Resolve which resting state the panel shows. The amount input appears only when a
  // wallet is connected, the output ATA exists, and the focused input has a positive
  // known classic-SPL balance — never on a fabricated zero.
  type ConvertStage =
    | { kind: 'connect' }
    | { kind: 'reading' }
    | { kind: 'no_token_config' }
    | { kind: 'prepare_first' }
    | { kind: 'output_mismatch' }
    | { kind: 'output_unavailable' }
    | { kind: 'no_balance' }
    | { kind: 'balance_unavailable' }
    | { kind: 'input'; balanceRaw: string; legacyDecimals: number }

  let stage: ConvertStage
  if (!isConnected) {
    stage = { kind: 'connect' }
  } else if (contextLoading && holderContext === null) {
    stage = { kind: 'reading' }
  } else if (tokenConfig === null || campaign === null) {
    stage = { kind: 'no_token_config' }
  } else if (outputAtaStatus === 'mismatch') {
    stage = { kind: 'output_mismatch' }
  } else if (outputAtaStatus !== 'exists') {
    stage = outputAtaStatus === 'missing' ? { kind: 'prepare_first' } : { kind: 'output_unavailable' }
  } else if (focusedBalanceRow === null || focusedBalanceRow.ataStatus === 'missing') {
    stage = { kind: 'no_balance' }
  } else if (focusedBalanceRow.ataStatus === 'mismatch' || focusedBalanceRow.ataStatus === 'unavailable') {
    stage = { kind: 'balance_unavailable' }
  } else if (focusedBalanceRow.balanceRaw === null || parseRawAmount(focusedBalanceRow.balanceRaw) <= 0n) {
    stage = { kind: 'no_balance' }
  } else {
    stage = {
      kind: 'input',
      balanceRaw: focusedBalanceRow.balanceRaw,
      legacyDecimals: focusedBalanceRow.legacyDecimals,
    }
  }

  const legacyLabel = tokenConfig?.legacyMintLabel ?? '—'
  const outputUnit = tokenConfig !== null ? resolveOutputUnit(tokenConfig) : '—'
  const outputDecimals = tokenConfig?.outputDecimals ?? 0

  // The convertible preview (a computed quote); null unless the amount yields a quote.
  const previewQuote = preview.kind === 'quote' ? preview : null
  // Every pre-burn check passed (no status / window / metadata / cap block).
  const previewClean = previewQuote !== null && previewQuote.blocks.length === 0

  const settledRecovery = recoveryState.kind === 'settled' ? recoveryState.presentation : null
  // The scope-independent operation latch is part of `busy`, so an operation this
  // control started under a previous identity keeps every call to action, the read-only
  // recheck and the reconciliation DISABLED rather than enabled-but-silent.
  const busy =
    activeOperation !== null ||
    actionState.kind === 'in_flight' ||
    recoveryState.kind === 'checking' ||
    recoveryState.kind === 'reconciling'
  const newActionPermitted = redaxConvertNewActionPermitted(settledRecovery, attemptBlockActive)

  // The saved-attempt projection the RECONCILE control is offered against.
  //
  // It survives the operation deliberately: while the reconciliation runs, the control
  // must remain visible and disabled rather than disappearing. It is NOT
  // `settledRecovery` — that stays strictly settled, so nothing in flight can widen the
  // call-to-action gate or the form-clear affordance.
  const reconcilableRecovery =
    recoveryState.kind === 'settled' || recoveryState.kind === 'reconciling'
      ? recoveryState.presentation
      : null

  // THE EXACT OFFER RULE, symmetric with the prepare panel's. The reconciliation belongs
  // to the panel whose OWN action the saved record names, and only while that record is
  // an unresolved attempt carrying a known saved signature. A prepare-owned record keeps
  // this panel generic: no detail, no signature and no control. A resolved record has
  // nothing to reconcile, and an attempt with no retained signature has no transaction
  // identity to read devnet about — this operation is forbidden to go looking for one.
  const reconcileOffered =
    reconcilableRecovery !== null &&
    reconcilableRecovery.scope === 'MATCHING_ACTION' &&
    reconcilableRecovery.kind === 'UNRESOLVED_ATTEMPT' &&
    reconcilableRecovery.shortSignature !== null

  // --- The explicitly recovered finalized-conversion receipt -------------------------
  //
  // THE DURABLE CONTEXT IS THE ONLY SOURCE. It arrives with the saved-attempt readback
  // and is never reconstructed from the form, the preview, a fresh quote, a balance or the
  // current selection — the conversion it describes may well predate all of them.
  const settledReceiptContext =
    recoveryState.kind === 'settled' ? recoveryState.receiptContext ?? null : null

  // DISPLAY-SCOPE WITHHOLDING, AND NOTHING MORE. The existing card formats the durable
  // amounts with the CURRENT token config's decimals and label and the CURRENT campaign's
  // output unit, so the receipt may only be offered while those identities are materially
  // the ones the durable request names. Present screen state can therefore WITHHOLD this
  // receipt; it never supplies a value to it and is never the authority for one.
  const displayMatchedReceiptContext: ConvertDurableReceiptContext | null =
    settledReceiptContext !== null &&
    campaign !== null &&
    tokenConfig !== null &&
    connectedKey !== null &&
    settledReceiptContext.user === connectedKey &&
    settledReceiptContext.campaignId === campaign.id &&
    settledReceiptContext.tokenConfigId === tokenConfig.id &&
    settledReceiptContext.legacyMint === tokenConfig.legacyMint &&
    settledReceiptContext.outputMint === campaign.outputMint &&
    settledReceiptContext.protocolFeeVault === campaign.protocolFeeVault
      ? settledReceiptContext
      : null

  // WHICH OF THE TWO OWNERSHIP SITES HOLDS THE RECEIPT RIGHT NOW. The card has ONE
  // implementation and exactly TWO mutually exclusive owners, so the direct finalized tail
  // is asked first, and it answers MECHANICALLY: this state leaves `none` only where that
  // tail itself wrote it, which is only downstream of a direct `ok: true` finalized
  // conversion. Loading, ready-matching, ready-mismatch and unavailable are all the SAME
  // answer here — the direct surface owns the presentation — because an unavailable DIRECT
  // read is a DIRECT state and must never be read as the recovered re-offer arm.
  //
  // The ACTION presentation is deliberately not the discriminator. A late-finality check or
  // reconciliation may synchronize a stale local action to FINALIZED_SUCCESS while no direct
  // receipt ever ran, and that gap is the very case the recovered route exists to close;
  // keying the exclusion off the presentation would suppress the route precisely there.
  const directReceiptSurfaceActive = receiptState.kind !== 'none'

  // RENDER-TIME COHERENCE, on the same rule every scoped projection follows. A loaded
  // receipt belongs to exactly ONE durable conversion, so a later check or reconciliation
  // that projects a DIFFERENT one — or none at all — makes it unusable in the very render
  // that observes the change, before any effect runs and whether or not one ever does.
  // The direct owner WITHHOLDS it on the same render rule: the durable context and any card
  // already read for it are RETAINED — neither is erased, retired or reinterpreted — but
  // while the direct surface owns the presentation this site renders nothing at all.
  const recoveredReceiptCard: ReceiptCardState =
    !directReceiptSurfaceActive &&
    recoveredReceipt !== null &&
    displayMatchedReceiptContext !== null &&
    sameConvertReceiptContext(recoveredReceipt.context, displayMatchedReceiptContext)
      ? recoveredReceipt.card
      : CONVERT_NO_RECEIPT_STATE

  // R-C, THE RE-OFFER POLICY, EXACTLY, AND UNCHANGED. Offered while nothing has been read,
  // and offered AGAIN after a read came back with nothing so a second read is always an
  // explicit human gesture; never offered while one is in flight; and WITHDRAWN once a
  // receipt has settled, whether or not it matched what was expected. No automatic repeat.
  //
  // The direct owner withholds the control on ITS OWN conjunct rather than through the card
  // above: a card withheld for ownership reads as `none`, and `none` is an OFFER arm, so the
  // exclusion has to be stated here as well or the control would return the moment the card
  // was suppressed. Withholding only; the durable context underneath is left untouched, and
  // an explicit local form clear releases direct ownership and may make this offerable again
  // — still explicitly, and still without any operation running by itself.
  const recoveredReceiptOffered =
    isConnected &&
    !directReceiptSurfaceActive &&
    recoveryState.kind === 'settled' &&
    recoveryState.presentation.scope === 'MATCHING_ACTION' &&
    displayMatchedReceiptContext !== null &&
    (recoveredReceiptCard.kind === 'none' || recoveredReceiptCard.kind === 'unavailable')

  // THE START AUTHORITY FOR THE OFFER ABOVE, captured — READ, never written — in the very
  // render that owns the control. Everything the explicit handler would otherwise decide
  // from is a RENDER-CLOSURE value: the offer itself, the durable context it names, and
  // `busy` alike. A handler retained from an older render therefore still believes an offer
  // this panel has since retired, and a scope comparison cannot see that — a new conversion
  // retires the durable slot without either scope key moving at all. The MONOTONIC
  // generation can: a new conversion bumps it, a check or reconciliation that replaced or
  // removed the durable context bumps it, and action- or wallet-scope churn bumps it.
  //
  // Refusing a stale handler can never leave an enabled-but-silent control behind, because
  // every one of those bumps is accompanied by a scoped state write and `scopedState`
  // allocates — so a fresh render always follows, and ITS handler carries the current value.
  const recoveredReceiptOfferGeneration = recoveredReceiptGenerationRef.current

  // Whether the explicit convert button may be enabled RIGHT NOW. Every condition the
  // gate enumerates is AND-ed here: devnet-tx mode, a connected wallet, the bridge
  // capability, an existing output ATA, a known-positive focused legacy balance, a valid
  // in-range quote (amount valid and <= balance), all pre-burn checks passing (active,
  // metadata set, window open, both caps), the acknowledgement checked, and no action
  // already begun. A saved attempt that is positively known to block withholds it too.
  // The button renders only when a quote exists and is DISABLED (not hidden) whenever
  // this is false.
  // The SOL condition, as an EXPLICIT reason or null — never a silent conjunct. A
  // reading, an idle projection and a failed read all block, because an unknown balance
  // must withhold the action rather than allow it, and each says which it is.
  const solPreflightBlock: string | null =
    solPreflight.kind === 'settled' && solPreflight.result === 'SUFFICIENT'
      ? null
      : solPreflight.kind === 'settled' && solPreflight.result === 'INSUFFICIENT'
        ? CONVERT_ACTION_DISABLED_SOL_INSUFFICIENT
        : CONVERT_ACTION_DISABLED_SOL_UNAVAILABLE

  const solPreflightSufficient = solPreflightBlock === null

  const canConvertNow =
    isDevnetTxEnabled &&
    isConnected &&
    actions.canConvertExactIn &&
    outputAtaStatus === 'exists' &&
    selectedBalanceRaw !== null &&
    parseRawAmount(selectedBalanceRaw) > 0n &&
    previewQuote !== null &&
    previewClean &&
    acknowledged &&
    actionState.kind === 'resting' &&
    newActionPermitted &&
    solPreflightSufficient &&
    !busy

  // The specific reason the button is disabled, shown beneath it.
  //
  // THE ACTIVE MOUNTED-CONTROL OPERATION HAS FIRST PRIORITY. While that latch is
  // load-bearing it is the ONLY truthful reason: every lower reason would either be
  // false (the acknowledgement is already checked, the quote already clean) or state a
  // condition the holder cannot clear while the operation runs (the saved-attempt
  // recheck is itself disabled by the same latch). Below it the order is capability,
  // then a saved attempt that blocks, then the payer's devnet SOL, then a
  // would-be-rejected quote, then the missing acknowledgement.
  //
  // THE SAVED-ATTEMPT BLOCK OUTRANKS THE SOL REASON DELIBERATELY. It is the one
  // condition a holder cannot clear, so telling them to add devnet SOL while an
  // unresolved attempt is what actually blocks them would send them off to fix the
  // wrong thing. The SOL branch sits immediately below it and is EXPLICIT — a new
  // exposure conjunct must never reach the neutral capability fallback and leave a
  // holder with no idea what to do.
  //
  // The chain starts NEUTRAL and ends in a capability-neutral fallback. No reason is an
  // initializer or a fall-through default, so a future conjunct added to
  // `canConvertNow` cannot silently inherit an unrelated reason's text: it reaches the
  // explicit fallback instead.
  let disabledReason: string | null = null
  if (busy) {
    disabledReason = HOLDER_OPERATION_ACTIVE
  } else if (!isConnected || !actions.canConvertExactIn) {
    disabledReason = CONVERT_ACTION_DISABLED_UNAVAILABLE
  } else if (!newActionPermitted) {
    disabledReason = CONVERT_ACTION_DISABLED_ATTEMPT_BLOCK
  } else if (solPreflightBlock !== null) {
    disabledReason = solPreflightBlock
  } else if (previewQuote !== null && previewQuote.blocks.length > 0) {
    disabledReason = CONVERT_ACTION_DISABLED_BLOCKED
  } else if (!acknowledged) {
    disabledReason = CONVERT_ACTION_DISABLED_ACK
  } else if (!canConvertNow) {
    disabledReason = CONVERT_ACTION_DISABLED_UNAVAILABLE
  }

  // The unscoped operation latch is load-bearing, but this panel's OWN scoped
  // projections cannot name it: under the current identity the action is not in flight
  // and the saved-attempt read is not running, so the operation belongs to a scope this
  // panel no longer shows. Same-scope progress copy already explains the operation
  // truthfully, so this stays false there and nothing is duplicated.
  const operationUnexplained =
    activeOperation !== null &&
    actionState.kind !== 'in_flight' &&
    recoveryState.kind !== 'checking' &&
    recoveryState.kind !== 'reconciling'

  // Whether the rendered quote call to action is ALREADY showing the neutral operation
  // explanation as its disabled reason. When it is, the saved-attempt block below must
  // not repeat it — the explanation is rendered exactly once per tree.
  const ctaShowsOperationReason =
    actionState.kind === 'resting' &&
    stage.kind === 'input' &&
    previewQuote !== null &&
    !canConvertNow &&
    disabledReason === HOLDER_OPERATION_ACTIVE

  // Whether the durable record RETIRED this panel's local action projection instead of
  // replacing it. A plain read of the state the synchronization already wrote — never a
  // second, render-time rule that could reach a different answer, and never inferred from
  // the currently displayed saved-attempt projection, which is wallet-scoped while this
  // one is campaign- and token-config-scoped and would otherwise suppress a later,
  // unrelated conversion's own result.
  const actionPresentationRetired = actionState.kind === 'settled' && actionState.recoveryPanelOnly

  // An ordinary local form clear is offered only for a finalized terminal result or a
  // typed replaceable terminal state — never on an unresolved, provisional, support,
  // read-unavailable, mismatch or fail-closed arm, and never from `resolved` alone.
  const formClearOffered =
    actionState.kind === 'settled' &&
    (actionState.presentation.permitsNewExplicitAction ||
      (settledRecovery !== null && settledRecovery.clearsLocalBlock))
  const formClearLabel =
    actionState.kind === 'settled' && actionState.presentation.kind === 'FINALIZED_SUCCESS'
      ? CONVERT_FORM_CLEAR_AFTER_FINALIZED_SUCCESS
      : CONVERT_FORM_CLEAR_AFTER_REPLACEABLE_TERMINAL

  // Amount edits reset the acknowledgement (it must reflect the exact previewed amount);
  // the input renders only at rest, so no in-flight edit is possible. No action here.
  function updateAmount(next: string) {
    setAmountInputRecord(scopedState(actionScopeKey, next))
    setAcknowledgedRecord(scopedState(actionScopeKey, false))
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

  // Clears this panel's LOCAL form and presentation back to the resting preview. It
  // sends nothing, starts nothing, touches no durable record and authorizes nothing.
  // The generation bump is what makes a still-pending additive receipt from the cleared
  // attempt unable to write anything back.
  function clearForm() {
    actionGenerationRef.current += 1
    setAmountInputRecord(scopedState(actionScopeKey, ''))
    setAcknowledgedRecord(scopedState(actionScopeKey, false))
    setActionStateRecord(scopedState(actionScopeKey, CONVERT_RESTING_ACTION_STATE))
    setReceiptStateRecord(scopedState(actionScopeKey, CONVERT_NO_RECEIPT_STATE))
  }

  // The ONLY convertExactIn call site in this component. Invoked solely from the
  // explicit button click below — never on mount, in an effect, on connect, on a timer
  // or on load, and with no automatic repeat of any kind. It re-validates every gate,
  // captures the receipt expectation, submits through the narrow bridge, and consumes
  // `ok: true` directly as the finalized terminal result.
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

  async function handleConvert() {
    // COMMITTED-CLOSURE OPERATION IDENTITY. The request, the receipt expectation and the
    // tag every scoped write carries all come from THIS committed render's closure —
    // never from a mutable ref an interruptible work-in-progress render for another
    // identity could have retargeted. Request identity, state tag and receipt identity
    // therefore share one provenance.
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
    if (!isDevnetTxEnabled || !isConnected || !actions.canConvertExactIn) {
      return
    }
    if (campaign === null || tokenConfig === null || outputAtaStatus !== 'exists') {
      return
    }
    if (previewQuote === null || previewQuote.blocks.length > 0 || !acknowledged) {
      return
    }
    if (selectedBalanceRaw === null || parseRawAmount(selectedBalanceRaw) <= 0n) {
      return
    }
    if (!newActionPermitted || connectedKey === null) {
      return
    }
    // The exposure conjunct, repeated SYNCHRONOUSLY from this committed render's own
    // projection before the latch is taken. A handler retained across a state change
    // must not start a conversion the current render would not have offered — and the
    // bridge rechecks the balance itself regardless, on the attempt's own connection.
    if (!solPreflightSufficient) {
      return
    }

    // `amountInRaw` is the parsed base-unit integer decimal string (BigInt -> string);
    // never a display amount and never floating point.
    const amountInRaw = previewQuote.amountIn.toString()
    const receiptExpectation: ConvertReceiptExpectation = {
      campaignId: campaign.id,
      tokenConfigId: tokenConfig.id,
      user: connectedKey,
      legacyMint: tokenConfig.legacyMint,
      outputMint: campaign.outputMint,
      amountInRaw,
      grossOutRaw: previewQuote.amounts.grossOut.toString(),
      feeOutRaw: previewQuote.amounts.feeOut.toString(),
      userOutRaw: previewQuote.amounts.userOut.toString(),
      protocolFeeVault: campaign.protocolFeeVault,
    }

    const operation = acquireHolderOperation('action')
    if (operation === null) {
      return
    }
    actionGenerationRef.current += 1
    const generation = actionGenerationRef.current
    // A NEW conversion is about to replace the durable slot the recovered receipt was
    // read for, so that receipt — and any read still in flight for it — is invalidated
    // HERE, before anything is sent. LOCAL presentation and read state only: no durable
    // record is written, cleared, acknowledged or reopened by any of these lines.
    recoveredReceiptGenerationRef.current += 1
    recoveredReceiptInFlightRef.current = false
    setRecoveredReceiptRecord(scopedState(walletKey, null))
    // AND THE CONTEXT ITSELF, not merely the card that was read for it. Retiring the card
    // alone would leave the OLD durable context standing in this panel's saved-attempt
    // projection, and the moment this operation released `busy` the panel would offer an
    // explicit read for a slot this conversion has already replaced. The projection is
    // rewritten to the SAME class, the SAME presentation and the SAME `unchanged` fact,
    // with the optional member simply ABSENT — never present-and-undefined, which would
    // still be a member the offer rule could read. Nothing durable is written, cleared,
    // acknowledged or reinterpreted, and no recovery observation is invented: a later
    // explicit check or reconciliation projects whatever the record then actually holds.
    if (recoveryState.kind === 'settled' && recoveryState.receiptContext !== undefined) {
      setRecoveryStateRecord(
        scopedState<ConvertRecoveryState>(walletKey, {
          kind: 'settled',
          presentation: recoveryState.presentation,
          unchanged: recoveryState.unchanged,
        }),
      )
    }
    setActionStateRecord(
      scopedState<ConvertActionState>(scopeKey, {
        kind: 'in_flight',
        phase: 'awaiting_wallet_approval',
      }),
    )
    setReceiptStateRecord(scopedState(scopeKey, CONVERT_NO_RECEIPT_STATE))

    // THE ACTION LATCH COVERS THE ACTION, NEVER THE RECEIPT. The synchronous
    // `inFlightRef` and the rendered `activeOperation` it mirrors are the exclusion latch
    // for the transaction action and the read-only recheck alone; BOTH are released
    // together as soon as the authoritative result has been processed and the receipt
    // request has been captured. The additive receipt is then awaited in a
    // separately guarded tail, so a delayed or hung receipt can neither hold the latch,
    // leave an enabled-but-silent call to action, block a later explicit gesture, block
    // a read-only recheck, authorize anything, nor alter the finalized action result.
    let receiptSignature: string | null = null
    try {
      const result = await actions.convertExactIn(
        {
          campaign: campaign.id,
          tokenConfig: tokenConfig.id,
          legacyMint: tokenConfig.legacyMint,
          outputMint: campaign.outputMint,
          protocolFeeVault: campaign.protocolFeeVault,
          amountInRaw,
        },
        (progress) => {
          if (!isActionCurrent(scopeKey, generation)) {
            return
          }
          setActionStateRecord(
            scopedState<ConvertActionState>(scopeKey, { kind: 'in_flight', phase: progress }),
          )
        },
      )
      if (!isActionCurrent(scopeKey, generation)) {
        return
      }
      const presentation = resolveRedaxConvertActionPresentation(result)
      setActionStateRecord(
        scopedState<ConvertActionState>(scopeKey, {
          kind: 'settled',
          presentation,
          evidence: readConvertEvidence(result, presentation),
          recoveryPanelOnly: false,
        }),
      )
      if (!presentation.permitsNewExplicitAction) {
        setAttemptBlockRecord(scopedState(walletKey, true))
      }
      if (!result.ok) {
        return
      }
      // The finalized result is displayed BEFORE the receipt is asked for.
      setReceiptStateRecord(scopedState<ReceiptCardState>(scopeKey, { kind: 'loading' }))
      receiptSignature = result.signature
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
        scopedState<ConvertActionState>(scopeKey, {
          kind: 'settled',
          presentation: convertActionPresentation('POST_UNKNOWN_NO_SIGNATURE', null, null),
          evidence: NO_ACTION_EVIDENCE,
          recoveryPanelOnly: false,
        }),
      )
      setAttemptBlockRecord(scopedState(walletKey, true))
    } finally {
      releaseHolderOperation(operation)
    }
    if (receiptSignature === null) {
      return
    }

    // Additive Tier 1 receipt, strictly downstream of the finalized terminal result:
    // decode THIS one transaction's Converted event and reconcile it. A null / error
    // result leaves the action result exactly as it is — the receipt card can never
    // create, remove, preserve, reopen or change it, and it authorizes nothing. This is
    // a single read of one transaction; no history is scanned. Every write is guarded by
    // mountedness plus the captured action scope AND generation, so a local clear or a
    // later action makes an older receipt unable to overwrite the current state, and a
    // rejected read settles here rather than as an unhandled rejection.
    try {
      const receiptResult = await dataSource.getConvertedReceiptForSignature({
        signature: receiptSignature,
        expected: receiptExpectation,
      })
      if (!isActionCurrent(scopeKey, generation)) {
        return
      }
      setReceiptStateRecord(
        scopedState<ReceiptCardState>(
          scopeKey,
          receiptResult.ok && receiptResult.data !== null
            ? { kind: 'ready', view: receiptResult.data }
            : { kind: 'unavailable' },
        ),
      )
    } catch {
      if (!isActionCurrent(scopeKey, generation)) {
        return
      }
      setReceiptStateRecord(scopedState<ReceiptCardState>(scopeKey, { kind: 'unavailable' }))
    }
  }

  // PRESENTATION SYNCHRONIZATION, AND NOTHING ELSE. Called only from a settled
  // saved-attempt projection that came back from the durable readback — never from a
  // chain read, a React value, an effect, a timer or an optimistic guess. It starts no
  // operation, takes no latch, sends nothing, burns nothing, writes no durable record
  // and authorizes nothing; it replaces one stale LOCAL presentation class with another
  // EXISTING one, and it never returns this panel to its resting form.
  function synchronizeActionWithDurableRecovery(presentation: RedaxConvertRecoveryPresentation) {
    // THIS committed render's own action scope, on the same provenance rule every
    // operation follows. The action projection is campaign- and token-config-scoped and
    // the saved attempt is not, so a scope that changed under a still-connected wallet
    // must leave the new projection alone rather than be overwritten by the old one's.
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
    const disposition = redaxConvertTerminalSyncDisposition(
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
    // previous amount and the previous acknowledgement are not reopened as a new
    // authorized conversion here: only the existing explicit form clear does that, and it
    // empties both first.
    if (disposition.kind === 'RECOVERY_PANEL_ONLY') {
      setActionStateRecord(
        scopedState<ConvertActionState>(actionKey, {
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
    //
    // THE ADDITIVE RECEIPT IS UNTOUCHED, and stays absent on its own invariant rather
    // than by being cleared here: it is only ever populated downstream of an `ok: true`
    // conversion, that result is already the finalized-success class, and an already
    // terminal class is never superseded — so a superseded projection cannot have one.
    setActionStateRecord(
      scopedState<ConvertActionState>(actionKey, {
        kind: 'settled',
        presentation: convertActionPresentation(disposition.presentation, null, null),
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
    const previousReceiptContext =
      recoveryState.kind === 'settled' ? recoveryState.receiptContext ?? null : null
    setRecoveryStateRecord(scopedState<ConvertRecoveryState>(scopeKey, { kind: 'checking' }))
    try {
      const result = await actions.recheckHolderRecovery()
      if (!isRecoveryCurrent(scopeKey, generation)) {
        return
      }
      const presentation = resolveRedaxConvertRecoveryPresentation(result)
      // THE READBACK IS THE ONLY SOURCE OF THE DURABLE RECEIPT CONTEXT, and this check
      // still reads NO receipt: it stores what the saved record projected and nothing
      // else. A context that is materially different — or gone — invalidates any receipt
      // already loaded for the previous one AND any read still in flight for it. The
      // SINGLE-FLIGHT LATCH IS RELEASED WITH THE GENERATION BUMP, and not as a courtesy: a
      // newly eligible context is offered its own control the moment this operation
      // releases `busy`, and a latch still held by the superseded read would let that
      // control render enabled while the handler silently refused every press — for ever,
      // if the old read never resolves. The superseded read stays unable to write because
      // its generation is now stale, and its own generation-matched `finally` can no longer
      // unlatch the newer read either.
      const receiptContext = readConvertRecoveryReceiptContext(result)
      if (!sameConvertReceiptContext(previousReceiptContext, receiptContext)) {
        recoveredReceiptGenerationRef.current += 1
        recoveredReceiptInFlightRef.current = false
        setRecoveredReceiptRecord(scopedState(scopeKey, null))
      }
      setRecoveryStateRecord(
        scopedState<ConvertRecoveryState>(scopeKey, {
          kind: 'settled',
          presentation,
          unchanged: previousKey !== null && previousKey === recoveryProjectionKey(presentation),
          ...(receiptContext === null ? {} : { receiptContext }),
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
        scopedState<ConvertRecoveryState>(scopeKey, {
          kind: 'settled',
          presentation: convertRecoveryPresentation(
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
  // builds nothing, signs nothing, sends nothing, burns nothing and starts no new
  // attempt. What it may do — and the read-only check above may not — is let the durable
  // saved record settle itself from devnet evidence that is already terminal.
  //
  // It runs ONLY from the button click below. No effect calls it, nothing calls it
  // after a check, nothing calls it after a reload, and there is no retry loop: one
  // gesture is one reconciliation, and a reading that resolves nothing simply stands.
  // No campaign, token config, amount or request of any kind is passed to it.
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
    const previousReceiptContext = recoveryState.receiptContext ?? null
    recoveryGenerationRef.current += 1
    const generation = recoveryGenerationRef.current
    const previousKey = recoveryProjectionKey(previousPresentation)
    setRecoveryStateRecord(
      scopedState<ConvertRecoveryState>(scopeKey, {
        kind: 'reconciling',
        presentation: previousPresentation,
      }),
    )
    try {
      const result = await actions.reconcileHolderRecovery()
      if (!isRecoveryCurrent(scopeKey, generation)) {
        return
      }
      const presentation = resolveRedaxConvertRecoveryPresentation(result)
      // The same rule the read-only check follows, for the same reason: the durable
      // readback is the only source of the context, this operation reads NO receipt, and
      // a materially different (or absent) context invalidates the previous one's card
      // and any read still in flight for it — INCLUDING the single-flight latch, so a
      // newly eligible context can start its own explicit read as soon as this operation
      // releases `busy` rather than rendering an enabled control that silently refuses.
      const receiptContext = readConvertRecoveryReceiptContext(result)
      if (!sameConvertReceiptContext(previousReceiptContext, receiptContext)) {
        recoveredReceiptGenerationRef.current += 1
        recoveredReceiptInFlightRef.current = false
        setRecoveredReceiptRecord(scopedState(scopeKey, null))
      }
      setRecoveryStateRecord(
        scopedState<ConvertRecoveryState>(scopeKey, {
          kind: 'settled',
          presentation,
          unchanged: previousKey === recoveryProjectionKey(presentation),
          ...(receiptContext === null ? {} : { receiptContext }),
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
      // durable observation, no outcome, no finality, no signature and no context slot
      // are invented, no refusal code is added, and the raw error is neither read,
      // rendered nor logged. The local block stays on.
      if (!isRecoveryCurrent(scopeKey, generation)) {
        return
      }
      setRecoveryStateRecord(
        scopedState<ConvertRecoveryState>(scopeKey, {
          kind: 'settled',
          presentation: convertRecoveryPresentation(
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

  // The EXPLICIT recovered-receipt read, and the only receipt call site outside the
  // direct finalized-action tail above.
  //
  // It is NOT a transaction action, NOT the saved-attempt check and NOT the
  // reconciliation. It builds nothing, signs nothing, sends nothing, confirms nothing,
  // writes no durable record, adopts no signature and searches for none: it hands the
  // ONE signature the durable record already retained, plus the ONE expectation that
  // record's own approved request describes, to the existing single-transaction receipt
  // read. It runs ONLY from the button click below — never on mount, in an effect, after
  // a check, after a reconciliation, on a timer, on a poll or on a subscription — and one
  // press is at most one read, with no automatic repeat of any kind.
  async function handleRecoveredReceiptLoad() {
    // BOTH committed identities, from THIS committed render's closure. The durable
    // context is wallet-scoped and the card's formatting is campaign- and
    // token-config-scoped, so a handler retained from an older committed render must
    // start nothing once either identity has moved on.
    const walletKey = walletScopeKey
    const actionKey = actionScopeKey
    if (walletKey !== committedWalletScopeRef.current || actionKey !== committedActionScopeRef.current) {
      return
    }
    // THE START AUTHORITY, before anything this render merely believes. Scope equality is
    // not enough on its own: a new conversion retires the durable slot this read was
    // offered for while BOTH scope keys stay exactly what they were, and the offer, the
    // context and `busy` in this closure would all still say yes. A handler whose render's
    // generation is no longer the current one therefore starts NOTHING — no receipt read,
    // no state write, no wallet prompt, no transaction, no journal action — and it stays
    // refused after whatever superseded it has released the mounted-control latch, which is
    // the window every other guard here has by then stopped covering.
    if (recoveredReceiptGenerationRef.current !== recoveredReceiptOfferGeneration) {
      return
    }
    // The offer conjuncts, repeated SYNCHRONOUSLY from this committed render's own
    // projection: a handler retained across a state change must not start a read the
    // current render would not have offered.
    if (!recoveredReceiptOffered) {
      return
    }
    const context = displayMatchedReceiptContext
    if (context === null) {
      return
    }
    // THE MOUNTED-OPERATION EXCLUSION, read from the SYNCHRONOUS latch first and from
    // render-time `busy` second. `busy` is projected from committed state, so inside the
    // very render in which a conversion, a check or a reconciliation has already acquired
    // that latch it is still false, and this read would start beside one of them. The ref
    // is the only authority that can see the acquisition in the same render it happened in.
    //
    // INSPECTING the latch is the whole of the interaction: this read never ACQUIRES it. It
    // is not a fourth Holder operation, and a hung receipt read must never be able to leave
    // a conversion, a check or a reconciliation disabled — so a receipt read that started
    // FIRST still leaves every one of them free to run, and to invalidate this one.
    if (inFlightRef.current !== null) {
      return
    }
    // And its OWN dedicated single-flight latch, so a second press inside one render starts
    // nothing either.
    if (recoveredReceiptInFlightRef.current || busy) {
      return
    }
    recoveredReceiptInFlightRef.current = true
    recoveredReceiptGenerationRef.current += 1
    const generation = recoveredReceiptGenerationRef.current
    setRecoveredReceiptRecord(
      scopedState<ConvertRecoveredReceiptState | null>(walletKey, {
        context,
        card: { kind: 'loading' },
      }),
    )
    try {
      const receiptResult = await dataSource.getConvertedReceiptForSignature({
        signature: context.signature,
        expected: {
          campaignId: context.campaignId,
          tokenConfigId: context.tokenConfigId,
          user: context.user,
          legacyMint: context.legacyMint,
          outputMint: context.outputMint,
          amountInRaw: context.amountInRaw,
          grossOutRaw: context.grossOutRaw,
          feeOutRaw: context.feeOutRaw,
          userOutRaw: context.userOutRaw,
          amountInNormalizedRaw: context.amountInNormalizedRaw,
          normalizationRemainderRaw: context.normalizationRemainderRaw,
          userOutputAta: context.userOutputAta,
          protocolFeeVault: context.protocolFeeVault,
        },
      })
      if (!isRecoveredReceiptCurrent(walletKey, actionKey, generation)) {
        return
      }
      setRecoveredReceiptRecord(
        scopedState<ConvertRecoveredReceiptState | null>(walletKey, {
          context,
          card:
            receiptResult.ok && receiptResult.data !== null
              ? { kind: 'ready', view: receiptResult.data }
              : { kind: 'unavailable' },
        }),
      )
    } catch {
      // A REJECTED read is not an observation. It settles as the existing unavailable
      // card — which the re-offer policy then makes explicitly readable again — rather
      // than as an unhandled rejection or a permanently loading panel. No raw error is
      // read, rendered or logged, and no action or recovery result is touched.
      if (!isRecoveredReceiptCurrent(walletKey, actionKey, generation)) {
        return
      }
      setRecoveredReceiptRecord(
        scopedState<ConvertRecoveredReceiptState | null>(walletKey, {
          context,
          card: { kind: 'unavailable' },
        }),
      )
    } finally {
      // Generation-matched, so a late release from a superseded read can never unlatch a
      // newer one — and a superseded read leaves no scope permanently in flight either.
      if (recoveredReceiptGenerationRef.current === generation) {
        recoveredReceiptInFlightRef.current = false
      }
    }
  }

  // Additive Tier 1 receipt card. ONE implementation, rendered from two mutually
  // exclusive ownership sites: the direct finalized-action tail, and the explicitly
  // recovered read in the saved-attempt panel. Shows the decoded one-transaction
  // Converted event (or a loading / unavailable note). No raw signature or address is
  // rendered; a soft-reconcile mismatch surfaces a caution and never changes a result.
  function renderReceiptCard(card: ReceiptCardState) {
    if (card.kind === 'none') {
      return null
    }
    if (card.kind === 'loading') {
      return (
        <div className="convert-panel__receipt">
          <p className="convert-panel__receipthint">{CONVERT_RECEIPT_LOADING}</p>
        </div>
      )
    }
    if (card.kind === 'unavailable') {
      return (
        <div className="convert-panel__receipt">
          <p className="convert-panel__receipthint">{CONVERT_RECEIPT_UNAVAILABLE}</p>
        </div>
      )
    }
    const { receipt, matchesExpected } = card.view
    const receiptLegacyDecimals = tokenConfig?.legacyDecimals ?? 0
    return (
      <div className="convert-panel__receipt">
        <div className="convert-panel__receipthead">
          <span className="convert-panel__receipteyebrow">{CONVERT_RECEIPT_EYEBROW}</span>
          <StatusPill
            tone={matchesExpected ? 'positive' : 'caution'}
            label={matchesExpected ? 'Converted' : 'Check values'}
          />
        </div>
        <h4 className="convert-panel__receipttitle">{CONVERT_RECEIPT_TITLE}</h4>
        <MetricRow
          label="Input burned"
          value={`${formatBaseUnits(BigInt(receipt.amountInRaw), receiptLegacyDecimals)} ${legacyLabel}`}
        />
        <MetricRow
          label="Gross output"
          value={`${formatBaseUnits(BigInt(receipt.grossOutRaw), outputDecimals)} ${outputUnit}`}
          hint="before the protocol fee"
        />
        <MetricRow
          label="Protocol fee"
          value={`${formatBaseUnits(BigInt(receipt.feeOutRaw), outputDecimals)} ${outputUnit}`}
        />
        <MetricRow
          label="Net output"
          value={`${formatBaseUnits(BigInt(receipt.userOutRaw), outputDecimals)} ${outputUnit}`}
          emphasis
        />
        {!matchesExpected ? (
          <p className="convert-panel__receipthint convert-panel__receipthint--warn">
            {CONVERT_RECEIPT_MISMATCH}
          </p>
        ) : null}
        <p className="convert-panel__receiptboundary">{CONVERT_RECEIPT_BOUNDARY}</p>
      </div>
    )
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
      <div className="convert-panel__preview">
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

  // In-flight / terminal action view (shown instead of the preview once an attempt
  // begins). Read-only render.
  function renderActionStatus() {
    // A RETIRED projection states nothing: no pill, no lead, no detail and no evidence.
    // The resting preview is NOT substituted in its place either — the panel is not
    // resting, and reopening the form here is exactly what would present the previous
    // amount and acknowledgement as a new authorized conversion. The saved-attempt panel
    // below states the terminal truth on its own, and the existing explicit form clear
    // stays offered under its own rules.
    const line = actionPresentationRetired
      ? null
      : actionState.kind === 'in_flight'
        ? actionState.phase === 'awaiting_wallet_approval'
          ? {
              tone: 'info' as const,
              pill: CONVERT_ACTION_AWAITING_APPROVAL_PILL,
              text: CONVERT_ACTION_AWAITING_APPROVAL,
            }
          : {
              tone: 'info' as const,
              pill: CONVERT_ACTION_RECONCILING_PILL,
              text: CONVERT_ACTION_CONFIRMING,
            }
        : actionState.kind === 'settled'
          ? {
              tone: actionState.presentation.tone,
              pill: actionState.presentation.pill,
              text: actionState.presentation.lead,
            }
          : null
    return (
      <div className="convert-panel__actionblock">
        {line !== null ? (
          <div className={`convert-panel__status convert-panel__status--${line.tone}`}>
            <StatusPill tone={line.tone} label={line.pill} />
            <p className="note-line">{line.text}</p>
          </div>
        ) : null}
        {actionState.kind === 'settled' &&
        !actionState.recoveryPanelOnly &&
        actionState.presentation.detail !== null ? (
          <p className="note-line">{actionState.presentation.detail}</p>
        ) : null}
        {renderActionEvidence()}
        <p className="convert-panel__proofnote">{CONVERT_ACTION_PROOF_NOTE}</p>
        {actionState.kind === 'settled' &&
        actionState.presentation.kind === 'FINALIZED_SUCCESS' ? (
          renderReceiptCard(receiptState)
        ) : null}
        {formClearOffered ? (
          <>
            <button
              type="button"
              className="convert-panel__reset"
              disabled={busy}
              onClick={clearForm}
            >
              {formClearLabel}
            </button>
            <p className="convert-panel__ackhelp">{CONVERT_FORM_CLEAR_HELP}</p>
          </>
        ) : null}
      </div>
    )
  }

  function renderRecoveryDetail(presentation: RedaxConvertRecoveryPresentation) {
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
      <div className="convert-panel__actionblock" role="group" aria-label={HOLDER_RECOVERY_TITLE}>
        <span className="convert-panel__receipteyebrow">{HOLDER_RECOVERY_EYEBROW}</span>
        <h4 className="convert-panel__receipttitle">{HOLDER_RECOVERY_TITLE}</h4>
        <p className="note-line">{HOLDER_RECOVERY_SHARED_SLOT_NOTE}</p>
        {/*
          The neutral operation explanation, rendered EXACTLY ONCE. It appears only when
          the latch is load-bearing and no current-scope progress copy already names the
          operation, and it is suppressed when the quote call to action is already
          showing the same sentence as its disabled reason. It discloses no previous
          wallet, campaign, token config or operation kind.
        */}
        {operationUnexplained && !ctaShowsOperationReason ? (
          <p className="note-line">{HOLDER_OPERATION_ACTIVE}</p>
        ) : null}
        <button
          type="button"
          className="convert-panel__reset"
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
            <div
              className={`convert-panel__status convert-panel__status--${recoveryState.presentation.tone}`}
            >
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
          <div className="convert-panel__actionblock">
            <p className="note-line">{HOLDER_RECOVERY_RECONCILE_EXPLANATION}</p>
            <button
              type="button"
              className="convert-panel__reset"
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
        {/*
          The explicitly recovered finalized-conversion receipt. The card is the SAME
          implementation the direct finalized tail renders, and the two ownership sites
          are mutually exclusive: this one is reached only through the saved-attempt
          panel, and only for a durable finalized conversion this panel's own record
          carries. It stays ADDITIVE evidence — it changes no action result, no
          saved-attempt resolution and no local block — and nothing repeats by itself: a
          settled receipt WITHDRAWS the control, while a read that found none may be asked
          again, and either way a second read is always another explicit gesture.
        */}
        {renderReceiptCard(recoveredReceiptCard)}
        {recoveredReceiptOffered ? (
          <div className="convert-panel__actionblock">
            <p className="note-line">
              {recoveredReceiptCard.kind === 'unavailable'
                ? CONVERT_RECEIPT_RECOVERY_UNAVAILABLE_HELP
                : CONVERT_RECEIPT_RECOVERY_HELP}
            </p>
            <button
              type="button"
              className="convert-panel__reset"
              disabled={busy}
              onClick={() => {
                void handleRecoveredReceiptLoad()
              }}
            >
              {CONVERT_RECEIPT_RECOVERY_BUTTON}
            </button>
          </div>
        ) : null}
        <p className="note-line">{HOLDER_RECOVERY_NON_AUTHORIZATION}</p>
        <p className="note-line">{HOLDER_RECOVERY_SCOPE_NOTE}</p>
        <p className="note-line">{HOLDER_RECOVERY_LOCAL_PROJECTION_NOTE}</p>
        <p className="convert-panel__actionboundary">{HOLDER_RECOVERY_BOUNDARY}</p>
      </div>
    )
  }

  function renderBody(stage: ConvertStage) {
    switch (stage.kind) {
      case 'connect':
        return <p className="note-line">{CONVERT_PREVIEW_CONNECT_REQUIRED}</p>
      case 'reading':
        return <p className="note-line">{CONVERT_PREVIEW_READING}</p>
      case 'no_token_config':
        return <p className="note-line">{CONVERT_PREVIEW_NO_TOKEN_CONFIG}</p>
      case 'prepare_first':
        return <p className="note-line">{CONVERT_PREVIEW_PREPARE_FIRST}</p>
      case 'output_mismatch':
        return <p className="note-line">{CONVERT_PREVIEW_OUTPUT_ATA_MISMATCH}</p>
      case 'output_unavailable':
        return <p className="note-line">{CONVERT_PREVIEW_OUTPUT_ATA_UNAVAILABLE}</p>
      case 'no_balance':
        return <p className="note-line">{CONVERT_PREVIEW_NO_BALANCE}</p>
      case 'balance_unavailable':
        return <p className="note-line">{CONVERT_PREVIEW_BALANCE_UNAVAILABLE}</p>
      case 'input': {
        const { balanceRaw, legacyDecimals } = stage
        const balanceBaseUnits = parseRawAmount(balanceRaw)
        return (
          <div className="convert-panel__action">
            <label className="convert-panel__field">
              <span className="convert-panel__fieldlabel">
                {CONVERT_PREVIEW_AMOUNT_LABEL} — {legacyLabel}
                {legacyDecimals > 0 ? ` (up to ${legacyDecimals} decimals)` : ''}
              </span>
              <div className="convert-panel__inputrow">
                <input
                  className="convert-panel__input"
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={CONVERT_PREVIEW_AMOUNT_PLACEHOLDER}
                  value={amountInput}
                  aria-label={CONVERT_PREVIEW_AMOUNT_LABEL}
                  onChange={(event) => {
                    const target = event.target
                    if ('value' in target && typeof target.value === 'string') {
                      updateAmount(target.value)
                    }
                  }}
                />
                <button
                  type="button"
                  className="convert-panel__max"
                  onClick={() =>
                    updateAmount(toPlainDecimalString(balanceBaseUnits, legacyDecimals))
                  }
                >
                  {CONVERT_PREVIEW_MAX_LABEL}
                </button>
              </div>
              <span className="convert-panel__balance">
                Balance: {formatBaseUnits(balanceBaseUnits, legacyDecimals)} {legacyLabel}
              </span>
            </label>

            {preview.kind === 'amount_error' ? (
              <p className="convert-panel__hint convert-panel__hint--warn">
                {amountErrorText(preview.error)}
              </p>
            ) : null}

            {preview.kind === 'quote_rejected' ? (
              <div className="convert-panel__preview">
                <p className="convert-panel__hint convert-panel__hint--warn">
                  {rejectionText(preview.rejection)}
                </p>
                {preview.blocks.map((block) => (
                  <p className="convert-panel__block" key={block}>
                    {block}
                  </p>
                ))}
              </div>
            ) : null}

            {preview.kind === 'quote' ? (
              <div className="convert-panel__preview">
                <MetricRow
                  label="Input burned"
                  value={`${formatBaseUnits(preview.amountIn, legacyDecimals)} ${legacyLabel}`}
                  hint="your input, burned on conversion"
                />
                <MetricRow
                  label="Gross output"
                  value={`${formatBaseUnits(preview.amounts.grossOut, outputDecimals)} ${outputUnit}`}
                  hint="before the protocol fee"
                />
                <MetricRow
                  label={`Protocol fee (${PROTOCOL_FEE_LABEL})`}
                  value={`${formatBaseUnits(preview.amounts.feeOut, outputDecimals)} ${outputUnit}`}
                  hint="deducted from gross output"
                />
                <MetricRow
                  label="Net output to you"
                  value={`${formatBaseUnits(preview.amounts.userOut, outputDecimals)} ${outputUnit}`}
                  emphasis
                />
                {preview.amounts.normalizationRemainder > 0n ? (
                  <MetricRow
                    label="Normalization remainder"
                    value={`${formatBaseUnits(preview.amounts.normalizationRemainder, legacyDecimals)} ${legacyLabel}`}
                    hint={CONVERT_PREVIEW_REMAINDER_NOTE}
                  />
                ) : null}
                {preview.blocks.length > 0 ? (
                  <div className="convert-panel__blocks">
                    <StatusPill tone="caution" label="Would be rejected before burn" />
                    {preview.blocks.map((block) => (
                      <p className="convert-panel__block" key={block}>
                        {block}
                      </p>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}

            <p className="convert-panel__warn">{CONVERT_PREVIEW_BURN_WARNING}</p>

            {preview.kind === 'quote' ? (
              <div className="convert-panel__actionblock">
                <p className="convert-panel__note">{CONVERT_ACTION_GATING_NOTE}</p>
                <label className="convert-panel__ack">
                  <input
                    type="checkbox"
                    className="convert-panel__ackbox"
                    checked={acknowledged}
                    onChange={(event) => {
                      const target = event.target
                      if ('checked' in target && typeof target.checked === 'boolean') {
                        setAcknowledgedRecord(scopedState(actionScopeKey, target.checked))
                      }
                    }}
                  />
                  <span className="convert-panel__acktext">{CONVERT_ACTION_ACK_LABEL}</span>
                </label>
                <p className="convert-panel__ackhelp">{CONVERT_ACTION_ACK_HELP}</p>
                <button
                  type="button"
                  className="convert-panel__cta"
                  disabled={!canConvertNow}
                  onClick={() => {
                    void handleConvert()
                  }}
                >
                  {CONVERT_ACTION_BUTTON}
                </button>
                {!canConvertNow && disabledReason !== null ? (
                  <p className="convert-panel__disabledreason">{disabledReason}</p>
                ) : null}
                {/*
                  The explicit read-only devnet SOL re-check, offered only while the SOL
                  condition is what withholds the conversion. It reads a balance and
                  nothing else: no transaction, no wallet, no saved attempt record.
                */}
                {solPreflightBlock !== null ? (
                  <button
                    type="button"
                    className="convert-panel__btn"
                    disabled={busy || solPreflight.kind === 'reading'}
                    onClick={handleSolPreflightCheck}
                  >
                    {CONVERT_SOL_PREFLIGHT_RECHECK_LABEL}
                  </button>
                ) : null}
                <p className="convert-panel__actionboundary">{CONVERT_ACTION_BOUNDARY}</p>
              </div>
            ) : null}
          </div>
        )
      }
      default:
        return null
    }
  }

  return (
    <section className="convert-panel" aria-label="Conversion preview">
      <div className="convert-panel__head">
        <span className="convert-panel__eyebrow">{CONVERT_PREVIEW_EYEBROW}</span>
        <h3 className="convert-panel__title">{CONVERT_PREVIEW_PANEL_TITLE}</h3>
      </div>

      <p className="convert-panel__intro">{CONVERT_PREVIEW_INTRO}</p>

      <div className="convert-panel__body">
        {actionState.kind === 'resting' ? renderBody(stage) : renderActionStatus()}
        {isConnected ? renderRecoveryPanel() : null}
      </div>

      <p className="convert-panel__boundary">{CONVERT_PREVIEW_BOUNDARY}</p>
    </section>
  )
}
