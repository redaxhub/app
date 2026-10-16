// REDAX Team/Admin campaign-setup recovery — a pure, total state machine.
//
// Boundary: this module is a pure transition function over SERIALIZABLE PUBLIC
// state. It performs no RPC, builds no instruction and no Transaction, holds no
// Connection, touches no wallet, never signs, never sends, never confirms, reads
// no env, writes no storage, and imports nothing but a type. On-chain
// observations are supplied to it as plain event DATA — reading the chain is the
// caller's job, in a later, separately gated layer.
//
// WHY THIS EXISTS. A Solana confirmation call can throw while the transaction has
// in fact landed. Treating that exception as a send failure is the classic and
// expensive mistake: the client believes nothing happened, resends, and either
// duplicates work or — for a campaign setup whose mint account creation cannot be
// repeated — strands funds and leaves an orphan. The whole point of this machine
// is that once a SIGNATURE IS KNOWN, the outcome is UNKNOWN, not failed:
//
//   confirmation_exception  ->  signature_known_result_ambiguous
//                           ->  (reconcile against the chain)
//                           ->  reconciled_success | reconciled_failure
//                             | orphan_diagnosis   | terminal_conflict
//
// and NO send/resend/abandon event is permitted while a signature is known and
// unreconciled. A known signature is never blindly resent.
//
// There is deliberately NO `partially_signed` state, and the reason is not the one
// this comment used to give. The wallet transport is SIGN-ONLY: it returns signed
// bytes and never broadcasts, and the REDAX Team/Admin action root owns the single
// raw broadcast itself. A partially-signed moment therefore DOES exist in the future
// action root — in memory, for the span between the ephemeral output-mint signature
// being applied and the one wallet signing request returning — but it exists entirely
// inside that private context. This pure machine never observes it, is never handed
// it, and could not serialize it if it were: every event here is public DATA supplied
// by a caller. So the state stays unmodelled, because modelling a state that can
// never be entered from here would be fiction.
//
// What DOES cross into this machine is the consequence: the point of no return is the
// action root's one raw-broadcast invocation, and a sign-only refusal BEFORE it is a
// proven pre-broadcast refusal. Everything after it is unresolved until reconciled —
// which is what `submission_outcome_unknown_without_signature` is for.
//
// The frozen plan and its fingerprint are IMMUTABLE for the life of a recovery
// context: any event carrying a different fingerprint is refused. Rebuilding after
// a blockhash expiry reuses the SAME frozen plan — never a regenerated salt, which
// would move the Campaign PDA and permanently strand the mint whose authority was
// set to the old one.

import {
  type RedaxFrozenCampaignPlanV1,
  computeRedaxCampaignPlanFingerprint,
} from './redaxDevnetCampaignPlan'

/** Every state a campaign-setup attempt can occupy. No `partially_signed` (see above). */
export type RedaxCampaignSetupState =
  | 'draft'
  | 'invalid'
  | 'frozen'
  | 'ready_to_send'
  | 'awaiting_wallet_approval'
  /**
   * The submission was invoked and came back with NOTHING USABLE — no signature, no
   * confirmation, no proof either way.
   *
   * This is the worst state to be in and the easiest to get wrong. It is emphatically
   * NOT `failed_before_signature`: a generic throw out of a broadcast tells you that
   * the call did not return normally, and nothing whatsoever about whether the
   * transaction reached the cluster. Treating it as a failure is what produces the
   * second send.
   *
   * It is also not `signature_known_result_ambiguous`, because there is no signature to
   * reconcile against — recovery here has to go by the pre-derived Campaign, mint and
   * vault addresses instead.
   */
  | 'submission_outcome_unknown_without_signature'
  | 'sent_with_known_signature'
  | 'confirmation_pending'
  | 'confirmed'
  | 'failed_before_signature'
  | 'signature_known_result_ambiguous'
  | 'reconciling'
  | 'reconciled_success'
  | 'reconciled_failure'
  | 'expired_blockhash'
  | 'orphan_diagnosis'
  | 'terminal_conflict'
  | 'abandoned_by_user'

/**
 * The serializable public recovery context.
 *
 * Every field is a string, `null`, or an array of strings. There is NO secret key,
 * NO Keypair, NO signed transaction bytes, NO raw wallet error and NO adapter
 * object here — and there is no field in which any of those could be carried. This
 * is the shape that may be persisted.
 */
export interface RedaxCampaignRecoveryContextV1 {
  readonly state: RedaxCampaignSetupState
  /** The frozen plan's fingerprint. Immutable once set. */
  readonly fingerprint: string | null
  /** The transaction signature, once one is KNOWN. Its presence locks out resend. */
  readonly signature: string | null
  readonly issueCodes: readonly string[]
}

/**
 * What a caller observed on-chain during reconciliation. Pure event data: this
 * module never performs the reads that produce it.
 *
 * `campaignMatchesPlan` means the on-chain Campaign's public fields agree with the
 * frozen plan (same campaign address, output mint, fee vault, governance, admin).
 * A Campaign that exists at the planned address but disagrees is NOT a success —
 * it is a terminal conflict.
 */
export interface RedaxOnChainObservation {
  readonly campaignPresent: boolean
  readonly campaignMatchesPlan: boolean
  readonly outputMintPresent: boolean
  readonly protocolFeeVaultPresent: boolean
  /** True only when the signature's failure is DEFINITIVE (not merely unconfirmed). */
  readonly signatureDefinitivelyFailed: boolean
  /**
   * The submission is proven DEAD — nothing landed, and nothing ever will under this
   * attempt.
   *
   * The bar is deliberately high, and it is the CALLER'S to clear before setting this:
   * a FINALIZED, COHERENT read proving no Campaign, no output mint and no fee vault,
   * with the finalized / failure evidence agreeing. Not a timeout. Not an expired
   * blockhash. Not an RPC that stopped answering. TIME IS NOT EVIDENCE, and neither is
   * an unreadable account — "we could not find out" is not "nothing is there", and the
   * indeterminate branch below exists precisely so it does not have to be.
   *
   * This machine still checks the claim rather than trusting it: residue outranks it
   * (see `resolveObservation`), so an observation asserting death while a mint or vault
   * is present is resolved as an ORPHAN and never as a failure.
   *
   * It is the ONLY exit from `submission_outcome_unknown_without_signature`, where
   * there is no signature and therefore `signatureDefinitivelyFailed` can never help.
   */
  readonly submissionDefinitivelyDead: boolean
}

export type RedaxCampaignRecoveryEvent =
  | { readonly kind: 'validation_failed'; readonly issueCodes: readonly string[] }
  | { readonly kind: 'plan_frozen'; readonly fingerprint: string }
  | { readonly kind: 'preflight_ok' }
  | { readonly kind: 'send_requested' }
  | { readonly kind: 'user_rejected' }
  | { readonly kind: 'send_failed_before_signature'; readonly reasonCode: string }
  /**
   * The submission came back with nothing usable.
   *
   * A generic post-invocation throw, a rejected promise with no signature, a torn-down
   * tab — anything that leaves the caller unable to say whether the transaction
   * reached the cluster. It is DELIBERATELY a different event from
   * `send_failed_before_signature`, which asserts something much stronger.
   */
  | { readonly kind: 'send_outcome_unknown' }
  | { readonly kind: 'signature_observed'; readonly signature: string }
  | { readonly kind: 'confirmation_started' }
  | { readonly kind: 'confirmation_succeeded' }
  | { readonly kind: 'confirmation_exception' }
  | { readonly kind: 'blockhash_expired' }
  | { readonly kind: 'reconcile_started' }
  | { readonly kind: 'reconcile_observed'; readonly observation: RedaxOnChainObservation }
  | { readonly kind: 'rebuild_with_same_plan' }
  | { readonly kind: 'abandon' }

export type RedaxRecoveryViolationCode =
  | 'INVALID_TRANSITION'
  | 'RESEND_WITH_KNOWN_SIGNATURE_FORBIDDEN'
  | 'ABANDON_WITH_KNOWN_SIGNATURE_FORBIDDEN'
  /** The outcome is unresolved and there is no signature. Both exits stay closed. */
  | 'RESEND_WITH_UNRESOLVED_OUTCOME_FORBIDDEN'
  | 'ABANDON_WITH_UNRESOLVED_OUTCOME_FORBIDDEN'
  | 'BLOCKHASH_EXPIRY_AFTER_SIGNATURE_FORBIDDEN'
  | 'RETRY_BEFORE_RECONCILE_FORBIDDEN'
  | 'ORPHAN_AUTO_RECOVERY_FORBIDDEN'
  | 'FINGERPRINT_MUTATION_FORBIDDEN'

export type RedaxCampaignRecoveryTransition =
  | { readonly ok: true; readonly context: RedaxCampaignRecoveryContextV1 }
  | {
      readonly ok: false
      readonly code: RedaxRecoveryViolationCode
      /** Unchanged: a refused event never advances or corrupts the context. */
      readonly context: RedaxCampaignRecoveryContextV1
    }

/** A fresh draft context. */
export function initialRedaxCampaignRecoveryContext(): RedaxCampaignRecoveryContextV1 {
  return { state: 'draft', fingerprint: null, signature: null, issueCodes: [] }
}

/**
 * States in which reconciliation has CONCLUDED. Only from these may a user abandon
 * an attempt whose signature is known — before that, abandoning would walk away
 * from a transaction that may well have landed.
 */
const RECONCILIATION_CONCLUDED: readonly RedaxCampaignSetupState[] = [
  'reconciled_success',
  'reconciled_failure',
  'orphan_diagnosis',
  'terminal_conflict',
]

function next(
  context: RedaxCampaignRecoveryContextV1,
  patch: Partial<RedaxCampaignRecoveryContextV1>,
): RedaxCampaignRecoveryTransition {
  return { ok: true, context: { ...context, ...patch } }
}

function refuse(
  context: RedaxCampaignRecoveryContextV1,
  code: RedaxRecoveryViolationCode,
): RedaxCampaignRecoveryTransition {
  return { ok: false, code, context }
}

/** Resolve a reconciliation observation. Fail-closed, and orphan-aware. */
function resolveObservation(
  context: RedaxCampaignRecoveryContextV1,
  observation: RedaxOnChainObservation,
): RedaxCampaignRecoveryTransition {
  // The planned Campaign exists and agrees with the plan: the transaction landed.
  if (observation.campaignPresent && observation.campaignMatchesPlan) {
    return next(context, { state: 'reconciled_success' })
  }
  // Something exists at the planned address but is NOT our campaign. Never treat
  // this as success and never overwrite it: it is a terminal support case.
  if (observation.campaignPresent) {
    return next(context, { state: 'terminal_conflict' })
  }
  // No Campaign, but a mint and/or a vault exist. Checked BEFORE the failure case,
  // deliberately: on-chain residue outranks a "definitely failed" signature, because
  // acting as though nothing exists is what creates a second orphan. Support-only,
  // fail-closed — this NEVER auto-runs init_campaign against the found accounts.
  if (observation.outputMintPresent || observation.protocolFeeVaultPresent) {
    return next(context, { state: 'orphan_diagnosis' })
  }
  // The signature definitively failed and none of the expected accounts exist:
  // the transaction rolled back atomically. Nothing was created.
  if (observation.signatureDefinitivelyFailed) {
    return next(context, { state: 'reconciled_failure' })
  }
  // The no-signature equivalent, and the ONLY exit from the unresolved-outcome state.
  // Reachable only here, AFTER the three residue and conflict checks above, so a
  // caller's "definitively dead" claim can never overrule an account that actually
  // exists — residue outranks death, exactly as it outranks a definitively failed
  // signature. The claim itself must have been earned by a finalized coherent no-land
  // read; see `submissionDefinitivelyDead`.
  if (observation.submissionDefinitivelyDead) {
    return next(context, { state: 'reconciled_failure' })
  }
  // Indeterminate — no Campaign, no residue, and the signature is not definitively
  // failed. Stay in reconciling and observe again rather than guess.
  return next(context, { state: 'reconciling' })
}

/**
 * The transition function. Total: every (state, event) pair either advances the
 * context or is refused with a typed violation code and an UNCHANGED context.
 * Pure — no I/O, no clock, no entropy.
 */
export function transitionRedaxCampaignRecovery(
  context: RedaxCampaignRecoveryContextV1,
  event: RedaxCampaignRecoveryEvent,
): RedaxCampaignRecoveryTransition {
  const signatureKnown = context.signature !== null
  // The window in which a submission was invoked, produced no signature, and has not
  // been reconciled. `reconciling` is included because with no signature it is only
  // ever reachable from the unresolved state — starting reconciliation is progress,
  // not resolution, and neither exit may open while it is under way.
  const outcomeUnresolvedWithoutSignature =
    !signatureKnown &&
    (context.state === 'submission_outcome_unknown_without_signature' ||
      context.state === 'reconciling')

  // --- Global guards, checked before any state-specific transition ------------

  // The frozen plan is immutable: a fingerprint may be set once, and never changed.
  if (
    event.kind === 'plan_frozen' &&
    context.fingerprint !== null &&
    context.fingerprint !== event.fingerprint
  ) {
    return refuse(context, 'FINGERPRINT_MUTATION_FORBIDDEN')
  }

  // A KNOWN SIGNATURE IS NEVER BLINDLY RESENT. This is the single most important
  // rule in this module and it is enforced here, before any state logic, so no
  // state can accidentally permit it.
  if (event.kind === 'send_requested' && signatureKnown) {
    return refuse(context, 'RESEND_WITH_KNOWN_SIGNATURE_FORBIDDEN')
  }

  // AND NEITHER IS AN UNRESOLVED SUBMISSION WITH NO SIGNATURE. This is the harder half
  // of the same rule: with no signature there is nothing to look up, so the temptation
  // to "just send it again" is strongest exactly where the evidence is weakest.
  if (event.kind === 'send_requested' && outcomeUnresolvedWithoutSignature) {
    return refuse(context, 'RESEND_WITH_UNRESOLVED_OUTCOME_FORBIDDEN')
  }

  // A blockhash expiry only means "not sent" while no signature exists. Once one
  // does, expiry proves nothing about the outcome — reconcile instead.
  if (event.kind === 'blockhash_expired' && signatureKnown) {
    return refuse(context, 'BLOCKHASH_EXPIRY_AFTER_SIGNATURE_FORBIDDEN')
  }

  // Abandoning with a known but unreconciled signature would walk away from a
  // transaction that may have landed.
  if (
    event.kind === 'abandon' &&
    signatureKnown &&
    !RECONCILIATION_CONCLUDED.includes(context.state)
  ) {
    return refuse(context, 'ABANDON_WITH_KNOWN_SIGNATURE_FORBIDDEN')
  }

  // Walking away from an unresolved submission is worse still: there is not even a
  // signature left behind for anybody to reconcile later.
  if (event.kind === 'abandon' && outcomeUnresolvedWithoutSignature) {
    return refuse(context, 'ABANDON_WITH_UNRESOLVED_OUTCOME_FORBIDDEN')
  }

  // --- State-specific transitions --------------------------------------------

  switch (context.state) {
    case 'draft':
    case 'invalid':
      if (event.kind === 'validation_failed') {
        return next(context, { state: 'invalid', issueCodes: event.issueCodes })
      }
      if (event.kind === 'plan_frozen') {
        return next(context, { state: 'frozen', fingerprint: event.fingerprint, issueCodes: [] })
      }
      if (event.kind === 'abandon') {
        return next(context, { state: 'abandoned_by_user' })
      }
      return refuse(context, 'INVALID_TRANSITION')

    case 'frozen':
      if (event.kind === 'preflight_ok') {
        return next(context, { state: 'ready_to_send' })
      }
      if (event.kind === 'abandon') {
        return next(context, { state: 'abandoned_by_user' })
      }
      return refuse(context, 'INVALID_TRANSITION')

    case 'ready_to_send':
      if (event.kind === 'send_requested') {
        // Reachable only with no known signature (guarded above).
        return next(context, { state: 'awaiting_wallet_approval' })
      }
      if (event.kind === 'blockhash_expired') {
        return next(context, { state: 'expired_blockhash' })
      }
      if (event.kind === 'abandon') {
        return next(context, { state: 'abandoned_by_user' })
      }
      return refuse(context, 'INVALID_TRANSITION')

    case 'awaiting_wallet_approval':
      if (event.kind === 'signature_observed') {
        return next(context, {
          state: 'sent_with_known_signature',
          signature: event.signature,
        })
      }
      if (event.kind === 'user_rejected') {
        return next(context, { state: 'failed_before_signature', issueCodes: ['USER_REJECTED'] })
      }
      if (event.kind === 'send_failed_before_signature') {
        return next(context, {
          state: 'failed_before_signature',
          issueCodes: [event.reasonCode],
        })
      }
      if (event.kind === 'send_outcome_unknown') {
        // THE CRITICAL NO-SIGNATURE EDGE. The submission was invoked and told us
        // nothing. It is NOT `failed_before_signature`, which would make a retry look
        // safe, and it is not ambiguity-with-a-signature either — there is nothing to
        // look up. It becomes its own unresolved state, and both exits close behind it.
        return next(context, { state: 'submission_outcome_unknown_without_signature' })
      }
      if (event.kind === 'blockhash_expired') {
        // Still retry-safe HERE, and only here: under the sign-only transport REDAX
        // itself holds the broadcast, so an expiry reached before that call means
        // nothing was submitted — a fact REDAX knows rather than infers. The moment the
        // caller cannot say that any more it emits `send_outcome_unknown` instead, and
        // from that state expiry is refused, because then it proves nothing at all.
        return next(context, { state: 'expired_blockhash' })
      }
      if (event.kind === 'abandon') {
        return next(context, { state: 'abandoned_by_user' })
      }
      return refuse(context, 'INVALID_TRANSITION')

    case 'submission_outcome_unknown_without_signature':
      // Recovery goes by the PRE-DERIVED addresses, because there is no signature to
      // go by. Exactly two events move this state, and neither of them sends anything.
      if (event.kind === 'signature_observed') {
        // A signature recovered out of band — from account history, from a provider log
        // the user still has. It resolves the no-signature half of the problem and
        // hands the attempt to the known-signature path, which is strictly better
        // evidence than address reconciliation alone.
        return next(context, {
          state: 'sent_with_known_signature',
          signature: event.signature,
        })
      }
      if (event.kind === 'reconcile_started') {
        return next(context, { state: 'reconciling' })
      }
      if (event.kind === 'rebuild_with_same_plan') {
        return refuse(context, 'RETRY_BEFORE_RECONCILE_FORBIDDEN')
      }
      // Everything else is refused, and three refusals are worth naming: a generic
      // post-invocation throw can never be replayed as `send_failed_before_signature`
      // from here, `user_rejected` cannot be claimed after the fact, and
      // `blockhash_expired` is not retry proof once the outcome is unknown. Resend and
      // abandon were already refused by the global guards above, with their own codes.
      return refuse(context, 'INVALID_TRANSITION')

    case 'sent_with_known_signature':
    case 'confirmation_pending':
      if (event.kind === 'confirmation_started') {
        return next(context, { state: 'confirmation_pending' })
      }
      if (event.kind === 'confirmation_succeeded') {
        return next(context, { state: 'confirmed' })
      }
      if (event.kind === 'confirmation_exception') {
        // THE CRITICAL EDGE. A confirmation that threw is NOT a send failure: the
        // signature is known, so the transaction may well have landed. It becomes
        // ambiguous, never `failed_before_signature`.
        return next(context, { state: 'signature_known_result_ambiguous' })
      }
      if (event.kind === 'reconcile_started') {
        return next(context, { state: 'reconciling' })
      }
      return refuse(context, 'INVALID_TRANSITION')

    case 'signature_known_result_ambiguous':
      if (event.kind === 'reconcile_started') {
        return next(context, { state: 'reconciling' })
      }
      if (event.kind === 'rebuild_with_same_plan') {
        // Reconciliation precedes ANY retry. Rebuilding here would risk a second
        // send against a transaction that may already have landed.
        return refuse(context, 'RETRY_BEFORE_RECONCILE_FORBIDDEN')
      }
      return refuse(context, 'INVALID_TRANSITION')

    case 'reconciling':
      if (event.kind === 'reconcile_observed') {
        return resolveObservation(context, event.observation)
      }
      if (event.kind === 'rebuild_with_same_plan') {
        return refuse(context, 'RETRY_BEFORE_RECONCILE_FORBIDDEN')
      }
      return refuse(context, 'INVALID_TRANSITION')

    case 'failed_before_signature':
      // No signature was ever produced, so there is nothing to reconcile and a
      // retry is safe. The frozen plan — and its fingerprint — are reused as-is.
      if (event.kind === 'send_requested') {
        return next(context, { state: 'awaiting_wallet_approval' })
      }
      if (event.kind === 'rebuild_with_same_plan') {
        return next(context, { state: 'ready_to_send' })
      }
      if (event.kind === 'abandon') {
        return next(context, { state: 'abandoned_by_user' })
      }
      return refuse(context, 'INVALID_TRANSITION')

    case 'expired_blockhash':
      // Reachable only with no signature (guarded above), so a rebuild is safe.
      // It reuses the SAME frozen plan: same salt, same Campaign PDA, same mint.
      if (event.kind === 'rebuild_with_same_plan') {
        return next(context, { state: 'ready_to_send' })
      }
      if (event.kind === 'abandon') {
        return next(context, { state: 'abandoned_by_user' })
      }
      return refuse(context, 'INVALID_TRANSITION')

    case 'reconciled_failure':
      // Reconciliation PROVED the signature failed and left nothing behind. Only
      // now may the signature be cleared and the same frozen plan retried — a
      // definitively-failed signature is not an ambiguous one. A fresh send will
      // produce a fresh signature.
      if (event.kind === 'rebuild_with_same_plan') {
        return next(context, { state: 'ready_to_send', signature: null })
      }
      if (event.kind === 'abandon') {
        return next(context, { state: 'abandoned_by_user' })
      }
      return refuse(context, 'INVALID_TRANSITION')

    case 'orphan_diagnosis':
      // A mint and/or vault exist with no Campaign. Support-only and fail-closed:
      // there is NO transition from here that sends anything. Recovery is a human,
      // out-of-band diagnosis — this machine will never auto-run init_campaign
      // against found accounts.
      if (event.kind === 'rebuild_with_same_plan') {
        return refuse(context, 'ORPHAN_AUTO_RECOVERY_FORBIDDEN')
      }
      if (event.kind === 'send_requested') {
        return refuse(context, 'ORPHAN_AUTO_RECOVERY_FORBIDDEN')
      }
      if (event.kind === 'abandon') {
        return next(context, { state: 'abandoned_by_user' })
      }
      return refuse(context, 'INVALID_TRANSITION')

    case 'terminal_conflict':
      // On-chain public state disagrees with the plan. Terminal: never retried,
      // never overwritten.
      if (event.kind === 'abandon') {
        return next(context, { state: 'abandoned_by_user' })
      }
      return refuse(context, 'INVALID_TRANSITION')

    case 'confirmed':
    case 'reconciled_success':
    case 'abandoned_by_user':
      // Terminal.
      return refuse(context, 'INVALID_TRANSITION')
  }
}

/**
 * True when the frozen plan a context is carrying is still, byte for byte, the plan
 * it was frozen with.
 *
 * The fingerprint is RECOMPUTED from the supplied plan and compared with the one
 * the context recorded at freeze time — so a plan that was mutated underneath an
 * in-flight transaction fails this check instead of passing it. That makes "the
 * frozen plan cannot silently change" verifiable rather than merely asserted.
 *
 * Async only because SHA-256 via Web Crypto is async. This is an identity /
 * mutation check — NOT an authorization check, and it grants nothing.
 */
export async function redaxRecoveryContextMatchesPlan(
  context: RedaxCampaignRecoveryContextV1,
  plan: RedaxFrozenCampaignPlanV1,
): Promise<boolean> {
  if (context.fingerprint === null) {
    return false
  }
  return context.fingerprint === (await computeRedaxCampaignPlanFingerprint(plan))
}
