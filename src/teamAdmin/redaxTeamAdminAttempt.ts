// REDAX Team/Admin S1 private attempt — the memory-only custody, and nowhere else.
//
// -----------------------------------------------------------------------------
// WHAT THIS IS
// -----------------------------------------------------------------------------
// The private, in-memory half of a Team/Admin S1 attempt: which ephemeral output-mint
// key it holds, which frozen plan it belongs to, which exact message it committed to,
// and which durable attempt nonce that commitment was recorded under. It is the
// counterpart of the PUBLIC recovery journal — that one is durable and public, this one
// is transient and never persisted.
//
// -----------------------------------------------------------------------------
// KEYPAIR DISPOSITION — MATERIALIZED HERE, GENERATED ELSEWHERE
// -----------------------------------------------------------------------------
// THIS MODULE GENERATES NO KEY MATERIAL. It draws no entropy, constructs no `Keypair`,
// reads no secret byte and writes none. What it now does — and deliberately did not do
// in the foundation slice — is HOLD the exact keypair the action root generated, in the
// opaque slot that was declared before any secret existed.
//
// The split is the whole point. `Keypair.generate()` lives at exactly ONE path,
// `RedaxTeamAdminActions.tsx`, and this module cannot reach it: `Keypair` is acquired
// here as a TYPE ONLY, so the import erases entirely and there is no value to call.
// Custody arrives through one narrow, action-named module function rather than through
// the context-exposed event API, so no secret-bearing event exists on a surface a React
// consumer can reach.
//
// -----------------------------------------------------------------------------
// BOUNDARY
// -----------------------------------------------------------------------------
// EXACTLY ONE ACQUISITION, AND IT IS A TYPE. No React, no wallet, no transport, no
// `Connection`, no `Transaction`, no entropy source, no storage, no RPC, no clock, no
// I/O, no logging. Pure total transitions: the same inputs always produce the same
// output, and nothing here can be awaited because nothing here does anything.
//
// NOTHING IS PERSISTED. The custody slot is unserializable by construction — its brand
// is a module-private `unique symbol`, so no JSON round trip, no structured clone and
// no storage write can reproduce one, and no module but this one can build a value that
// satisfies the type. `publicAttemptProjection` below is the only way to get a
// serializable view of an attempt, and that view carries the CUSTODY BOOLEAN and the
// PUBLIC mint address — never the keypair and never a secret byte.
//
// REFRESH DESTROYS THE KEYPAIR. There is no rehydration path, by construction, and that
// is the intended behaviour rather than a limitation: a plan whose key is gone can never
// be signed or resent, and the durable journal — not this module — is what stops a
// second attempt from starting.

import type { Keypair } from '@solana/web3.js'

// --- The opaque private custody slot -------------------------------------------

/**
 * The module-private brand.
 *
 * `declare const` on a `unique symbol` emits nothing at runtime and is not exported, so
 * no other module — and no test, and no hostile input — can construct a value that
 * satisfies the branded type. That is what makes the slot unforgeable rather than
 * merely conventional, and it is why custody can only enter through the one function
 * below.
 */
declare const REDAX_TEAM_ADMIN_CUSTODY_BRAND: unique symbol

/**
 * Where the ephemeral output-mint custody lives, for exactly as long as one attempt.
 *
 * It carries the EXACT `Keypair` the action root generated — not a copy, not a wrapper
 * and not a structural stand-in — so the partial signature the action root applies is
 * provably over the key this attempt is about. The public mint address sits beside it
 * because every other module in the route needs that address and none of them may be
 * handed the key to derive it from.
 *
 * The slot is deliberately not an alias for anything reconstructible: an opaque brand
 * cannot be serialized, cannot be logged usefully, cannot be compared to a foreign
 * object and cannot be rebuilt from storage. A slot that could be rehydrated would make
 * "memory-only" a comment rather than a property.
 */
export interface RedaxTeamAdminPrivateCustodySlotV1 {
  readonly [REDAX_TEAM_ADMIN_CUSTODY_BRAND]: 'redax-team-admin-output-mint-custody-v1'
  /** The ephemeral output-mint keypair. PRIVATE: never projected, never serialized. */
  readonly outputMintKeypair: Keypair
  /** The mint's PUBLIC base58 identity. Safe everywhere; carried so nothing else needs the key. */
  readonly outputMint: string
}

// --- Public vocabulary ----------------------------------------------------------

/**
 * How far the private attempt has got.
 *
 * Each phase is one the S1 submit choreography actually reaches, in the order it
 * reaches them, and the ordering is not cosmetic: custody exists BEFORE the plan can be
 * frozen (the plan is derived from the mint the custody names), the plan exists before a
 * message can be compiled from it, and the durable attempt nonce exists only after the
 * journal mints one — which happens after the message is committed. A machine that
 * demanded them in any other order would be describing a route nobody performs.
 *
 * That division is what makes recovery possible at all. A later reconciliation, after a
 * reload, must work from the journal alone — so it must NOT need a rehydrated keypair,
 * and adding a post-broadcast phase here would invite exactly the state that pretends
 * one is available. A state that cannot be entered is fiction, and fiction in a state
 * machine is how an unreachable branch quietly becomes reachable later.
 */
export type RedaxTeamAdminAttemptPhase =
  | 'no_attempt'
  | 'custody_materialized'
  | 'plan_frozen'
  | 'intended_message_committed'
  | 'attempt_identity_bound'
  | 'attempt_released'

/** A versioned commitment to one compiled legacy message. Re-declared, not imported. */
export interface RedaxTeamAdminAttemptMessageCommitmentV1 {
  readonly kind: 'redax-intended-legacy-message-sha256-v1'
  readonly byteLength: number
  readonly sha256Hex: string
}

/**
 * The private attempt.
 *
 * `custody` is the opaque slot, and it is the ONLY member of this type that is not
 * public information. It is excluded from every projection by construction: see
 * `publicAttemptProjection`.
 */
export interface RedaxTeamAdminAttemptV1 {
  readonly phase: RedaxTeamAdminAttemptPhase
  /** The public attempt identity the recovery journal minted. Never a secret. */
  readonly attemptNonce: string | null
  /** The frozen plan's public fingerprint. Immutable once set. */
  readonly planFingerprint: string | null
  readonly intendedMessage: RedaxTeamAdminAttemptMessageCommitmentV1 | null
  readonly custody: RedaxTeamAdminPrivateCustodySlotV1 | null
  readonly issueCodes: readonly string[]
}

/**
 * The serializable view. There is no custody member, by construction.
 *
 * `custodyPresent` is now a real runtime boolean rather than the literal `false` the
 * foundation slice could honestly type it as. It says WHETHER a key is held; there is
 * no member on this type through which any part of one could travel.
 */
export interface RedaxTeamAdminAttemptProjectionV1 {
  readonly phase: RedaxTeamAdminAttemptPhase
  readonly attemptNonce: string | null
  readonly planFingerprint: string | null
  readonly intendedMessageSha256Hex: string | null
  readonly custodyPresent: boolean
  /** The PUBLIC output-mint address this attempt is about, once custody exists. */
  readonly outputMint: string | null
  readonly issueCodes: readonly string[]
}

/**
 * The non-secret attempt events.
 *
 * CUSTODY IS NOT ONE OF THEM, and its absence here is the load-bearing part of this
 * type. This union is what the React action context exposes; putting a keypair-bearing
 * member on it would place secret material on a surface any consumer of the context
 * could construct a value for. Custody enters through
 * `materializeRedaxTeamAdminOutputMintCustody` instead — a module function, reachable
 * only by a module that imports this file, which is exactly one path.
 */
export type RedaxTeamAdminAttemptEvent =
  | {
      readonly kind: 'freeze_plan'
      readonly planFingerprint: string
    }
  | {
      readonly kind: 'commit_intended_message'
      readonly commitment: RedaxTeamAdminAttemptMessageCommitmentV1
    }
  | {
      readonly kind: 'bind_attempt_identity'
      readonly attemptNonce: string
    }
  | { readonly kind: 'release_attempt'; readonly reasonCode: string }

/**
 * Every way a transition can be refused.
 *
 * `CUSTODY_ALREADY_MATERIALIZED` is the one-attempt rule: custody is non-null in
 * exactly the open phases, so it is also what refuses a second attempt while the first
 * is still open. There is no separate second-attempt code, because there is no longer a
 * separate event that could ask for one.
 */
export type RedaxTeamAdminAttemptViolationCode =
  | 'INVALID_TRANSITION'
  | 'ATTEMPT_IDENTITY_MUTATION_FORBIDDEN'
  | 'CUSTODY_ALREADY_MATERIALIZED'

export type RedaxTeamAdminAttemptTransition =
  | { readonly ok: true; readonly attempt: RedaxTeamAdminAttemptV1 }
  | {
      readonly ok: false
      readonly code: RedaxTeamAdminAttemptViolationCode
      /** Unchanged: a refused event never advances or corrupts the attempt. */
      readonly attempt: RedaxTeamAdminAttemptV1
    }

// --- Construction and projection -------------------------------------------------

/** A fresh, empty attempt. No custody, no plan, no message, no identity. */
export function initialRedaxTeamAdminAttempt(): RedaxTeamAdminAttemptV1 {
  return Object.freeze({
    phase: 'no_attempt',
    attemptNonce: null,
    planFingerprint: null,
    intendedMessage: null,
    custody: null,
    issueCodes: Object.freeze([]),
  })
}

/**
 * The ONLY way to look at an attempt from outside.
 *
 * The keypair is not narrowed, redacted or stringified — it is simply not one of the
 * members this function reads, so there is no code path along which it could reach a
 * caller, a record or a log. What crosses the boundary is a boolean and a public
 * address, and neither is derived from secret bytes.
 */
export function publicAttemptProjection(
  attempt: RedaxTeamAdminAttemptV1,
): RedaxTeamAdminAttemptProjectionV1 {
  return Object.freeze({
    phase: attempt.phase,
    attemptNonce: attempt.attemptNonce,
    planFingerprint: attempt.planFingerprint,
    intendedMessageSha256Hex:
      attempt.intendedMessage === null ? null : attempt.intendedMessage.sha256Hex,
    custodyPresent: attempt.custody !== null,
    outputMint: attempt.custody === null ? null : attempt.custody.outputMint,
    issueCodes: Object.freeze([...attempt.issueCodes]),
  })
}

// --- Internals --------------------------------------------------------------------

function advance(
  attempt: RedaxTeamAdminAttemptV1,
  patch: Partial<RedaxTeamAdminAttemptV1>,
): RedaxTeamAdminAttemptTransition {
  return { ok: true, attempt: Object.freeze({ ...attempt, ...patch }) }
}

function refuse(
  attempt: RedaxTeamAdminAttemptV1,
  code: RedaxTeamAdminAttemptViolationCode,
): RedaxTeamAdminAttemptTransition {
  return { ok: false, code, attempt }
}

/** The phases in which an attempt is open and occupying the one slot. */
const ACTIVE_PHASES: readonly RedaxTeamAdminAttemptPhase[] = [
  'custody_materialized',
  'plan_frozen',
  'intended_message_committed',
  'attempt_identity_bound',
]

// --- Custody: the one narrow, action-named private helper --------------------------

/**
 * Put the EXACT generated output-mint keypair into this attempt's opaque slot.
 *
 * A MODULE FUNCTION, NOT AN EVENT. It is deliberately outside
 * `RedaxTeamAdminAttemptEvent` so that the keypair never appears in a value the React
 * action context accepts, and it is named for the one thing it does so it cannot drift
 * into a general-purpose custody or signer helper.
 *
 * EXACTLY ONCE PER ATTEMPT. A second materialization is refused rather than overwriting
 * the first: two keys under one attempt would mean the plan, the partial signature and
 * the durable record could each be talking about a different mint.
 *
 * The public address is taken from the key itself, here, so no caller can supply a mint
 * address that disagrees with the key that will sign for it.
 */
export function materializeRedaxTeamAdminOutputMintCustody(
  attempt: RedaxTeamAdminAttemptV1,
  outputMintKeypair: Keypair,
): RedaxTeamAdminAttemptTransition {
  if (attempt.custody !== null) {
    // Custody is held in exactly the open phases, so this is also the refusal that
    // stops a second attempt from starting while the first is unresolved.
    return refuse(attempt, 'CUSTODY_ALREADY_MATERIALIZED')
  }
  if (attempt.phase !== 'no_attempt' && attempt.phase !== 'attempt_released') {
    // Defensive completeness guard. Custody-null and open is a state no transition
    // produces; if one ever did, this refuses rather than materializing into it.
    return refuse(attempt, 'INVALID_TRANSITION')
  }
  // The one place a value of the branded type is minted. The assertion is unavoidable
  // and is exactly what the brand is for: the symbol is `declare const`, so no
  // expression anywhere — here included — can produce that property. Confining the
  // construction to this function is what makes every other module structurally
  // incapable of forging one.
  const custody = Object.freeze({
    outputMintKeypair,
    outputMint: outputMintKeypair.publicKey.toBase58(),
  }) as unknown as RedaxTeamAdminPrivateCustodySlotV1
  return advance(attempt, {
    phase: 'custody_materialized',
    attemptNonce: null,
    planFingerprint: null,
    intendedMessage: null,
    custody,
    issueCodes: Object.freeze([]),
  })
}

/**
 * Read the held keypair back, for the ONE partial signature this route applies.
 *
 * Returns `null` rather than throwing when nothing is held: an absent key is a state
 * the caller must handle, not an exception it may forget to catch.
 *
 * There is no second reader and no getter on the attempt type itself, so every use of
 * the key is a call to this function and is countable in the import graph. What the
 * caller may do with it is bounded elsewhere — by the single-`partialSign`-owner census
 * — because a module this small cannot enforce what happens after it returns.
 */
export function readRedaxTeamAdminOutputMintCustodyKeypair(
  attempt: RedaxTeamAdminAttemptV1,
): Keypair | null {
  return attempt.custody === null ? null : attempt.custody.outputMintKeypair
}

/** The PUBLIC output-mint address this attempt holds custody for, or null. */
export function readRedaxTeamAdminOutputMintAddress(attempt: RedaxTeamAdminAttemptV1): string | null {
  return attempt.custody === null ? null : attempt.custody.outputMint
}

// --- The transition function --------------------------------------------------------

/**
 * The transition function. TOTAL: every (phase, event) pair either advances the attempt
 * or is refused with a typed code and an UNCHANGED attempt. Pure — no I/O, no clock, no
 * entropy, and no capability of any kind.
 *
 * The identity rules are the load-bearing ones. A plan fingerprint and an attempt nonce
 * are set ONCE and never change: the fingerprint proves the plan under this attempt is
 * still the plan it was frozen with, and the nonce is what a compare-and-set against the
 * public journal is talking about. Letting either drift would let a second plan inherit
 * the first one's durable record.
 */
export function transitionRedaxTeamAdminAttempt(
  attempt: RedaxTeamAdminAttemptV1,
  event: RedaxTeamAdminAttemptEvent,
): RedaxTeamAdminAttemptTransition {
  switch (event.kind) {
    case 'freeze_plan':
      if (attempt.phase !== 'custody_materialized') {
        // A plan is frozen against the mint this attempt already holds. Freezing one
        // first would mean deriving the Campaign PDA and the mint account from a key
        // that does not exist yet.
        return refuse(attempt, 'INVALID_TRANSITION')
      }
      if (attempt.planFingerprint !== null) {
        return refuse(attempt, 'ATTEMPT_IDENTITY_MUTATION_FORBIDDEN')
      }
      return advance(attempt, {
        phase: 'plan_frozen',
        planFingerprint: event.planFingerprint,
      })

    case 'commit_intended_message':
      if (attempt.phase !== 'plan_frozen') {
        return refuse(attempt, 'INVALID_TRANSITION')
      }
      if (attempt.intendedMessage !== null) {
        return refuse(attempt, 'ATTEMPT_IDENTITY_MUTATION_FORBIDDEN')
      }
      return advance(attempt, {
        phase: 'intended_message_committed',
        intendedMessage: Object.freeze({ ...event.commitment }),
      })

    case 'bind_attempt_identity':
      if (attempt.phase !== 'intended_message_committed') {
        // The nonce is the JOURNAL'S, minted when the durable record opens — which
        // happens after the message it records is committed. Binding it earlier would
        // mean inventing one.
        return refuse(attempt, 'INVALID_TRANSITION')
      }
      if (attempt.attemptNonce !== null) {
        return refuse(attempt, 'ATTEMPT_IDENTITY_MUTATION_FORBIDDEN')
      }
      return advance(attempt, {
        phase: 'attempt_identity_bound',
        attemptNonce: event.attemptNonce,
      })

    case 'release_attempt':
      if (attempt.phase === 'no_attempt' || attempt.phase === 'attempt_released') {
        return refuse(attempt, 'INVALID_TRANSITION')
      }
      // Releasing DROPS the slot. This is where the memory-only keypair stops being
      // reachable through this attempt at all — the reference is gone, and there is no
      // other holder of it and no way to reconstruct one.
      return advance(attempt, {
        phase: 'attempt_released',
        custody: null,
        issueCodes: Object.freeze([event.reasonCode]),
      })
  }
}

/**
 * Does this attempt hold custody?
 *
 * A real runtime question now. It is what `custodyPresent` projects, and it is the
 * predicate a cleanup path asserts against after a release: an attempt that still
 * reported custody after being released would mean the reference had escaped the drop.
 */
export function attemptHoldsCustody(attempt: RedaxTeamAdminAttemptV1): boolean {
  return attempt.custody !== null
}

/** Is this attempt open — occupying the one private slot? */
export function attemptIsActive(attempt: RedaxTeamAdminAttemptV1): boolean {
  return ACTIVE_PHASES.includes(attempt.phase)
}
