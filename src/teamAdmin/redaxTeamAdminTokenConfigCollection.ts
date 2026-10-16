// -----------------------------------------------------------------------------
// WHAT THIS FILE IS
// -----------------------------------------------------------------------------
// The product logic of ONE post-init product action — `add_token_config` — and of the
// campaign-scoped collection it edits. It answers two questions and no others:
//
//   1. is this draft row admissible against an ALREADY-EXISTING campaign, and what
//      exact TokenConfig account would it address;
//   2. what transactional state is that row in, given draft facts, loaded chain facts
//      and the SANITIZED mutation-status projection.
//
// -----------------------------------------------------------------------------
// WHAT IT REUSES RATHER THAN RESTATES
// -----------------------------------------------------------------------------
// The draft row shape, the ordered draft reducer, the strict unsigned-integer parser, the
// `u128` bound and the max-10 constant all come from `redaxDevnetCampaignPlan`, which is
// where the Campaign Create route already keeps them. The TokenConfig address comes from
// the canonical `deriveTokenConfigPda`. Nothing about a TokenConfig is spelled twice.
//
// The one thing this module adds is the POST-INIT half the create-time freeze never had:
// a campaign that already exists on chain has a live `tokenConfigCount`, a live set of
// accepted legacy mints and a live output mint, and every one of those is chain truth
// rather than something a team may type.
//
// -----------------------------------------------------------------------------
// FAIL CLOSED, EVERYWHERE
// -----------------------------------------------------------------------------
// Chain truth that is missing, unreadable or internally inconsistent NEVER yields
// `CONFIRMED` and NEVER yields `PREPARED`. It yields a null state and a bounded blocking
// code, because the honest answer to "we could not read it" is not "it is fine".
//
// STALE CHAIN TRUTH IS TREATED AS MISSING CHAIN TRUTH. A loaded snapshot may predate the
// very attempt it is being asked to judge, so `chainTruthKind` is a REQUIRED input and the
// two transitions an attempt produces — confirmation, and re-entry after a replaceable
// terminal — accept `FRESH_STATUS_READ` and nothing else. A cached exact match is not
// confirmation and a cached absence is not permission.
//
// The four durable row states are `PREPARED`, `PENDING`, `SUBMITTED` and `CONFIRMED`, and
// there is no fifth. A refusal is not a state: `FAILED`, `RETRYABLE`, `CONFLICT` and
// `BLOCKED` are deliberately absent, and every one of those situations is expressed as
// `state: null` plus a blocking code, so a row can never LOOK like a durable outcome it
// does not have.

import { PublicKey } from '@solana/web3.js'

import { deriveTokenConfigPda } from '../data/devnet/redaxDevnetAccounts'
import {
  REDAX_MAX_TOKEN_CONFIGS_PER_CAMPAIGN,
  REDAX_OUTPUT_MINT_DECIMALS,
  REDAX_U128_MAX,
  parseRedaxUnsignedInteger,
  reduceRedaxTokenConfigDraftRows,
} from '../data/devnet/redaxDevnetCampaignPlan'
import type {
  RedaxTokenConfigDraftAction,
  RedaxTokenConfigDraftRowV1,
  RedaxTokenConfigReducerResult,
} from '../data/devnet/redaxDevnetCampaignPlan'

// --- Draft vocabulary, re-aliased rather than re-declared -----------------------

/**
 * One editable post-init TokenConfig row.
 *
 * Deliberately the SAME shape the Campaign Create route already edits, aliased rather
 * than re-declared: a second row type would be a second place for `rowId` to stop being
 * distinct from the derived PDA, which is the one property this identity rests on.
 */
export type RedaxTeamAdminTokenConfigDraftRow = RedaxTokenConfigDraftRowV1

/** The four ordered draft edits. Draft-only: nothing here reaches a chain. */
export type RedaxTeamAdminTokenConfigDraftAction = RedaxTokenConfigDraftAction

/** What one ordered draft edit produced. */
export type RedaxTeamAdminTokenConfigDraftResult = RedaxTokenConfigReducerResult

/** The program maximum, read from the one place that already states it. */
export const REDAX_TEAM_ADMIN_MAX_TOKEN_CONFIGS = REDAX_MAX_TOKEN_CONFIGS_PER_CAMPAIGN

/**
 * Apply ONE ordered draft edit. A thin, deliberate delegation.
 *
 * It exists so the panel never acquires the campaign-plan module itself: the reducer is
 * shared, and the surface a product panel may reach is this one.
 */
export function reduceRedaxTeamAdminTokenConfigDraftRows(
  rows: readonly RedaxTeamAdminTokenConfigDraftRow[],
  action: RedaxTeamAdminTokenConfigDraftAction,
): RedaxTeamAdminTokenConfigDraftResult {
  return reduceRedaxTokenConfigDraftRows(rows, action)
}

/**
 * The next stable LOCAL row id, from a monotonically increasing counter.
 *
 * NOT the TokenConfig PDA, and never derived from one: the PDA moves the moment the
 * legacy mint is edited, and the row being edited is still the same row. It is also not
 * a clock reading and not entropy — this module reads neither — so the same counter
 * always produces the same id, which is what makes the reducer's behaviour testable.
 */
export function redaxTeamAdminTokenConfigRowId(sequence: number): string {
  return `redax-team-admin-token-config-row-${sequence}`
}

/** An empty draft row, ready to be edited. Every field is a raw string. */
export function emptyRedaxTeamAdminTokenConfigDraftRow(
  sequence: number,
): RedaxTeamAdminTokenConfigDraftRow {
  return {
    rowId: redaxTeamAdminTokenConfigRowId(sequence),
    legacyMint: '',
    expectedLegacyDecimals: '',
    rateNumerator: '',
    rateDenominator: '',
    maxOutputFromTokenConfig: '',
  }
}

// --- Validation ----------------------------------------------------------------

/**
 * Every way ONE post-init draft row can be inadmissible. Closed, and VALUE-FREE.
 *
 * No issue carries a typed value back: a message that echoed team input would be a
 * rendering path for unreviewed text, and the field name plus the code already say
 * everything the operator needs.
 */
export type RedaxTeamAdminTokenConfigIssueCode =
  | 'REQUIRED'
  | 'NOT_DECIMAL_INTEGER'
  | 'NEGATIVE_NOT_ALLOWED'
  | 'ABOVE_U128_MAX'
  | 'RATE_HALF_ZERO'
  | 'INVALID_PUBLIC_KEY'
  | 'INVALID_DECIMALS'
  | 'LEGACY_MINT_EQUALS_OUTPUT_MINT'
  | 'DUPLICATE_LEGACY_MINT'
  | 'DUPLICATE_TOKEN_CONFIG_PDA'
  | 'LEGACY_MINT_ALREADY_CONFIGURED'
  | 'CAMPAIGN_AT_TOKEN_CONFIG_CEILING'
  | 'CAMPAIGN_CONTEXT_UNUSABLE'

/** Which editable field an issue belongs to. `campaign` means the context, not a field. */
export type RedaxTeamAdminTokenConfigField =
  | 'legacyMint'
  | 'expectedLegacyDecimals'
  | 'rateNumerator'
  | 'rateDenominator'
  | 'maxOutputFromTokenConfig'
  | 'campaign'

export interface RedaxTeamAdminTokenConfigIssue {
  readonly code: RedaxTeamAdminTokenConfigIssueCode
  readonly field: RedaxTeamAdminTokenConfigField
  readonly rowId: string
}

/**
 * The campaign-scoped facts a post-init row is validated AGAINST.
 *
 * Every member is chain or deployment truth. `outputMint`, `tokenConfigCount` and
 * `chainLegacyMints` come from the loaded Campaign and its loaded TokenConfigs;
 * `expectedOutputDecimals` is DISPLAYED from that same truth and is never a team input,
 * because the program reads the mints' real decimals and stores those.
 *
 * `tokenConfigCount` is `null` when chain truth is unavailable, and a null count refuses
 * rather than defaulting to zero — an unreadable ceiling is not an absent one.
 */
export interface RedaxTeamAdminTokenConfigCampaignContext {
  readonly programId: string
  readonly campaign: string
  readonly outputMint: string
  readonly expectedOutputDecimals: number
  readonly tokenConfigCount: number | null
  readonly chainLegacyMints: readonly string[]
}

/** One admissible row, with its derived account identity. Every amount is canonical. */
export interface RedaxTeamAdminValidatedTokenConfigRow {
  readonly rowId: string
  readonly campaign: string
  readonly outputMint: string
  readonly legacyMint: string
  /** The derived `add_token_config` target. Never typed, never supplied. */
  readonly tokenConfig: string
  readonly rateNumerator: string
  readonly rateDenominator: string
  readonly maxOutputFromTokenConfig: string
  readonly expectedLegacyDecimals: number
  readonly expectedOutputDecimals: number
}

/**
 * What validating ONE draft row established. TWO SEPARATE ANSWERS, on purpose.
 *
 *   * `ok` / `issues` — QUESTION A, may a NEW `add_token_config` attempt start. Unchanged
 *     and deliberately not weakened: an existing on-chain TokenConfig for the same campaign
 *     and legacy mint refuses a new submission PERMANENTLY, whatever rate or cap is typed,
 *     because that pair derives one PDA and that account already exists.
 *   * `identity` — QUESTION B's input, the row's EXACT derived identity: which TokenConfig
 *     account it addresses and on exactly what terms. Present whenever the draft is
 *     WELL-FORMED, and deliberately still present when the only thing wrong with it is that
 *     the chain already holds this mint or the campaign is full. Neither of those says
 *     anything about an attempt that has already run.
 *
 * A row can therefore be simultaneously "not startable" and "exactly attributable", which
 * is precisely the state a just-confirmed row is in.
 */
export type RedaxTeamAdminTokenConfigRowValidation =
  | {
      readonly ok: true
      readonly row: RedaxTeamAdminValidatedTokenConfigRow
      readonly identity: RedaxTeamAdminValidatedTokenConfigRow
    }
  | {
      readonly ok: false
      readonly issues: readonly RedaxTeamAdminTokenConfigIssue[]
      readonly identity: RedaxTeamAdminValidatedTokenConfigRow | null
    }

/**
 * The issue codes that refuse a NEW SUBMISSION and say NOTHING about an existing attempt.
 *
 * Both are statements about what the chain currently HOLDS rather than about what the
 * operator typed: this legacy mint already has a TokenConfig, or this campaign has no slot
 * left. Neither makes the row unidentifiable, so neither may erase its identity.
 *
 * The draft-local duplicates are deliberately NOT here. Two rows naming one legacy mint is
 * an ambiguity in what the operator is claiming, and attributing one chain account to two
 * rows would be inventing an answer rather than reporting one.
 */
const NEW_SUBMISSION_ONLY_ISSUE_CODES: readonly RedaxTeamAdminTokenConfigIssueCode[] =
  Object.freeze(['LEGACY_MINT_ALREADY_CONFIGURED', 'CAMPAIGN_AT_TOKEN_CONFIG_CEILING'])

/** A public base58-looking account identifier, before the decoder is asked. */
const BASE58_ACCOUNT_PATTERN = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/

/** The u8 the program stores for each mint's decimals. */
const MAX_MINT_DECIMALS = 255

function issue(
  code: RedaxTeamAdminTokenConfigIssueCode,
  field: RedaxTeamAdminTokenConfigField,
  rowId: string,
): RedaxTeamAdminTokenConfigIssue {
  return { code, field, rowId }
}

/** Decode a base58 account identifier, or `null`. Never throws. */
function accountKey(value: string): PublicKey | null {
  const trimmed = value.trim()
  if (!BASE58_ACCOUNT_PATTERN.test(trimmed)) {
    return null
  }
  try {
    return new PublicKey(trimmed)
  } catch {
    return null
  }
}

/**
 * One canonical unsigned decimal within `u128`, collecting its own issues.
 *
 * `nonZero` is the rate halves: a zero numerator or denominator is a rate the program
 * rejects, and refusing it here means the wallet is never asked to approve one.
 */
function unsignedU128(
  raw: string,
  field: RedaxTeamAdminTokenConfigField,
  rowId: string,
  nonZero: boolean,
  issues: RedaxTeamAdminTokenConfigIssue[],
): string | null {
  const parsed = parseRedaxUnsignedInteger(raw)
  if (parsed.kind === 'empty') {
    issues.push(issue('REQUIRED', field, rowId))
    return null
  }
  if (parsed.kind === 'negative') {
    issues.push(issue('NEGATIVE_NOT_ALLOWED', field, rowId))
    return null
  }
  if (parsed.kind === 'invalid') {
    issues.push(issue('NOT_DECIMAL_INTEGER', field, rowId))
    return null
  }
  if (parsed.value > REDAX_U128_MAX) {
    issues.push(issue('ABOVE_U128_MAX', field, rowId))
    return null
  }
  if (nonZero && parsed.value === 0n) {
    issues.push(issue('RATE_HALF_ZERO', field, rowId))
    return null
  }
  // CANONICALIZED, not echoed. The stored form is the parsed value re-rendered, so a
  // padded or whitespace-wrapped entry can never travel into a request as typed.
  return parsed.value.toString()
}

/** The `u8` decimals field: a canonical unsigned integer in `0 … 255`. */
function mintDecimals(
  raw: string,
  field: RedaxTeamAdminTokenConfigField,
  rowId: string,
  issues: RedaxTeamAdminTokenConfigIssue[],
): number | null {
  const parsed = parseRedaxUnsignedInteger(raw)
  if (parsed.kind === 'empty') {
    issues.push(issue('REQUIRED', field, rowId))
    return null
  }
  if (parsed.kind !== 'ok' || parsed.value > BigInt(MAX_MINT_DECIMALS)) {
    issues.push(issue('INVALID_DECIMALS', field, rowId))
    return null
  }
  return Number(parsed.value)
}

/**
 * Validate ONE draft row against an already-existing campaign.
 *
 * STANDALONE, and deliberately not the create-time freeze: that one validates a whole
 * campaign that does not exist yet, and every rule that matters here — the live
 * `tokenConfigCount` ceiling, the live accepted-mint set, the live output mint — is a
 * fact about a campaign that already does.
 *
 * Every issue is collected rather than short-circuited, so an operator sees the complete
 * set at once. Pure: no RPC, no clock, no entropy.
 */
export function validateRedaxTeamAdminPostInitTokenConfigRow(
  row: RedaxTeamAdminTokenConfigDraftRow,
  context: RedaxTeamAdminTokenConfigCampaignContext,
  draftRows: readonly RedaxTeamAdminTokenConfigDraftRow[],
): RedaxTeamAdminTokenConfigRowValidation {
  const issues: RedaxTeamAdminTokenConfigIssue[] = []
  const rowId = row.rowId

  const programId = accountKey(context.programId)
  const campaign = accountKey(context.campaign)
  const outputMint = accountKey(context.outputMint)
  const outputDecimalsUsable =
    Number.isInteger(context.expectedOutputDecimals) &&
    context.expectedOutputDecimals >= 0 &&
    context.expectedOutputDecimals <= MAX_MINT_DECIMALS
  if (programId === null || campaign === null || outputMint === null || !outputDecimalsUsable) {
    // The context itself is unusable, so nothing derived from it could be trusted. This
    // is a refusal, never a default — including for the DISPLAYED output decimals, which
    // are chain truth this module reports and never a value it may invent.
    issues.push(issue('CAMPAIGN_CONTEXT_UNUSABLE', 'campaign', rowId))
  }

  // THE CEILING IS CHAIN TRUTH, never the local draft count. A campaign with ten accepted
  // inputs admits no eleventh however few rows are on screen, and an unreadable count
  // refuses rather than being treated as zero.
  const chainCount = context.tokenConfigCount
  if (
    chainCount === null ||
    !Number.isInteger(chainCount) ||
    chainCount < 0 ||
    chainCount > REDAX_TEAM_ADMIN_MAX_TOKEN_CONFIGS
  ) {
    issues.push(issue('CAMPAIGN_CONTEXT_UNUSABLE', 'campaign', rowId))
  } else if (chainCount >= REDAX_TEAM_ADMIN_MAX_TOKEN_CONFIGS) {
    issues.push(issue('CAMPAIGN_AT_TOKEN_CONFIG_CEILING', 'campaign', rowId))
  }

  const legacyMint = accountKey(row.legacyMint)
  if (row.legacyMint.trim() === '') {
    issues.push(issue('REQUIRED', 'legacyMint', rowId))
  } else if (legacyMint === null) {
    issues.push(issue('INVALID_PUBLIC_KEY', 'legacyMint', rowId))
  } else if (outputMint !== null && legacyMint.toBase58() === outputMint.toBase58()) {
    // The program refuses a campaign's own output mint as an accepted input, and so does
    // this — before a wallet is ever asked.
    issues.push(issue('LEGACY_MINT_EQUALS_OUTPUT_MINT', 'legacyMint', rowId))
  }

  const rateNumerator = unsignedU128(row.rateNumerator, 'rateNumerator', rowId, true, issues)
  const rateDenominator = unsignedU128(row.rateDenominator, 'rateDenominator', rowId, true, issues)
  // `0` IS ADMISSIBLE HERE, and means uncapped. It is the one place a zero is a value
  // rather than a defect, which is why the rate halves are checked with a different rule.
  const maxOutputFromTokenConfig = unsignedU128(
    row.maxOutputFromTokenConfig,
    'maxOutputFromTokenConfig',
    rowId,
    false,
    issues,
  )
  const expectedLegacyDecimals = mintDecimals(
    row.expectedLegacyDecimals,
    'expectedLegacyDecimals',
    rowId,
    issues,
  )

  let tokenConfig: string | null = null
  if (legacyMint !== null && programId !== null && campaign !== null) {
    try {
      tokenConfig = deriveTokenConfigPda(programId, campaign, legacyMint).pda.toBase58()
    } catch {
      tokenConfig = null
      issues.push(issue('CAMPAIGN_CONTEXT_UNUSABLE', 'campaign', rowId))
    }
  }

  if (legacyMint !== null) {
    const legacyBase58 = legacyMint.toBase58()
    // A DUPLICATE IN THE DRAFT is refused rather than de-duplicated: two rows for one
    // legacy mint address one account, and silently dropping one would hide which terms
    // the operator believed they were submitting.
    const duplicateDraft = draftRows.some(
      (other) => other.rowId !== rowId && accountKey(other.legacyMint)?.toBase58() === legacyBase58,
    )
    if (duplicateDraft) {
      issues.push(issue('DUPLICATE_LEGACY_MINT', 'legacyMint', rowId))
    }
    // ALREADY ON CHAIN is a harder refusal still. A TokenConfig's terms are immutable, so
    // a second one for the same legacy mint is not an edit and not a correction — its PDA
    // is the same account, and that account already exists.
    if (context.chainLegacyMints.some((mint) => mint === legacyBase58)) {
      issues.push(issue('LEGACY_MINT_ALREADY_CONFIGURED', 'legacyMint', rowId))
    }
  }

  if (tokenConfig !== null && programId !== null && campaign !== null) {
    const duplicatePda = draftRows.some((other) => {
      if (other.rowId === rowId) {
        return false
      }
      const otherMint = accountKey(other.legacyMint)
      if (otherMint === null) {
        return false
      }
      try {
        return deriveTokenConfigPda(programId, campaign, otherMint).pda.toBase58() === tokenConfig
      } catch {
        return false
      }
    })
    if (duplicatePda) {
      issues.push(issue('DUPLICATE_TOKEN_CONFIG_PDA', 'legacyMint', rowId))
    }
  }

  // THE CANDIDATE IS BUILT ONCE, from the value-grade checks alone. Its existence answers
  // "is this row well-formed enough to NAME an account", which is a strictly weaker question
  // than "may it be submitted" — and the one the attribution half needs.
  const candidate: RedaxTeamAdminValidatedTokenConfigRow | null =
    legacyMint === null ||
    outputMint === null ||
    campaign === null ||
    tokenConfig === null ||
    rateNumerator === null ||
    rateDenominator === null ||
    maxOutputFromTokenConfig === null ||
    expectedLegacyDecimals === null
      ? null
      : {
          rowId,
          campaign: campaign.toBase58(),
          outputMint: outputMint.toBase58(),
          legacyMint: legacyMint.toBase58(),
          tokenConfig,
          rateNumerator,
          rateDenominator,
          maxOutputFromTokenConfig,
          expectedLegacyDecimals,
          expectedOutputDecimals: context.expectedOutputDecimals,
        }

  // THE IDENTITY SURVIVES A CHAIN-OCCUPANCY REFUSAL, and nothing else. If any issue is a
  // value-grade or context-grade defect the row is not identifiable at all, and no amount of
  // chain truth would make it so.
  const identity =
    candidate !== null &&
    issues.every((entry) => NEW_SUBMISSION_ONLY_ISSUE_CODES.includes(entry.code))
      ? candidate
      : null

  if (issues.length > 0 || candidate === null) {
    return { ok: false, issues, identity }
  }

  return { ok: true, row: candidate, identity: candidate }
}

// --- The sanitized mutation-status projection, re-declared structurally -----------
//
// STRUCTURAL, NEVER IMPORTED, exactly as the mutation journal re-declares the operation
// and status vocabularies it shares with the program. This module must stay a leaf, and a
// leaf that imported the action root would be a leaf holding a send.
//
// It also states, as a type, exactly how little this module is allowed to see: an
// operation, a campaign, a lifecycle or a resolution, the derived witness address and the
// four PUBLIC canonical `add_token_config` request fields. There is no member here for a
// signature, a message, a digest, a blockhash, a nonce, a namespace, a Team wallet, a
// storage key or a raw error, so no amount of editing downstream can render one.

export type RedaxTeamAdminTokenConfigStatusOperation =
  | 'ADD_TOKEN_CONFIG'
  | 'SETUP_METADATA'
  | 'ACTIVATE_CAMPAIGN'
  | 'PAUSE_CAMPAIGN'
  | 'UNPAUSE_CAMPAIGN'
  | 'FINALIZE_CAMPAIGN'

export type RedaxTeamAdminTokenConfigStatusLifecycle =
  | 'PRE_RAW_SEND'
  | 'PRE_RAW_SEND_SIGNATURE_LOCAL_NOT_RETAINED'
  | 'KNOWN_SIGNATURE'

export type RedaxTeamAdminTokenConfigStatusResolution =
  | 'RESOLVED_PRE_RAW_SEND_NO_BROADCAST'
  | 'RESOLVED_MATCHING_IMMEDIATE_STATE'
  | 'RESOLVED_LANDED_EXACT_POST_STATE_SUPERSEDED'
  | 'RESOLVED_FINALIZED_LANDED_FAILURE'
  | 'RESOLVED_FINALIZED_NO_LAND'
  | 'ACCEPTED_SUPPORT_DISPOSITION'

/** The four public canonical request fields, and there is no fifth. */
export interface RedaxTeamAdminTokenConfigStatusRequest {
  readonly legacyMint: string
  readonly rateNumerator: string
  readonly rateDenominator: string
  readonly maxOutputFromTokenConfig: string
}

export type RedaxTeamAdminTokenConfigStatusInput =
  | { readonly kind: 'UNAVAILABLE' }
  | { readonly kind: 'EMPTY' }
  | {
      readonly kind: 'ACTIVE'
      readonly operation: RedaxTeamAdminTokenConfigStatusOperation
      readonly campaign: string
      readonly lifecycle: RedaxTeamAdminTokenConfigStatusLifecycle
      readonly witnessAddress: string | null
      readonly addTokenConfigRequest: RedaxTeamAdminTokenConfigStatusRequest | null
    }
  | {
      readonly kind: 'TOMBSTONE'
      readonly operation: RedaxTeamAdminTokenConfigStatusOperation
      readonly campaign: string
      readonly resolution: RedaxTeamAdminTokenConfigStatusResolution
      readonly witnessAddress: string | null
      readonly addTokenConfigRequest: RedaxTeamAdminTokenConfigStatusRequest | null
    }

/**
 * WHICH READING OF THE CHAIN a judgment is allowed to rest on.
 *
 *   * `LOADED_DISPLAY` — the app-level snapshot. Honest for drafting, for capacity and for
 *     the ordinary pre-attempt route to `PREPARED`, and NEVER authority for confirmation
 *     or for terminal re-entry.
 *   * `FRESH_STATUS_READ` — a reading taken by the explicit status gesture ITSELF, after
 *     the journal was reconciled and re-read. The only reading either of those two
 *     transitions accepts.
 *
 * It is a REQUIRED input rather than an optional one on purpose: a caller that has not
 * decided which reading it holds has not established that it holds a fresh one, and a
 * default would silently decide for it.
 */
export type RedaxTeamAdminTokenConfigChainTruthKind = 'LOADED_DISPLAY' | 'FRESH_STATUS_READ'

/**
 * The terminals that claim the mutation TOOK EFFECT. Corroborated by chain, or refused.
 *
 * These do not BLOCK a later distinct attempt — see the note below — but they do settle the
 * identity they belong to: a success that the chain cannot corroborate is a disagreement,
 * and this module refuses rather than picking a side.
 */
const SUCCESS_RESOLUTIONS: readonly RedaxTeamAdminTokenConfigStatusResolution[] = Object.freeze([
  'RESOLVED_MATCHING_IMMEDIATE_STATE',
  'RESOLVED_LANDED_EXACT_POST_STATE_SUPERSEDED',
])

/**
 * ONE SLOT AT A TIME IS NOT ONE MUTATION FOREVER, and the pre-repair reading of that rule
 * was a product defect rather than a safety property. REDAX campaigns hold ONE to TEN
 * accepted inputs; every one of them is a separate `add_token_config` with a separate
 * TokenConfig PDA. Treating a RESOLVED successful tombstone for TokenConfig A as a global
 * blocker meant the first input a campaign ever accepted was also its last — the topology
 * the product exists to build became unreachable after its first success.
 *
 * So a RESOLVED terminal — whatever it resolved to — releases the slot for a LATER DISTINCT
 * mutation, subject to every ordinary admission rule: fresh chain truth, the target absent,
 * the campaign still admitting inputs, the ceiling not reached. What it never releases is
 * its OWN identity: a legacy mint whose TokenConfig already exists is refused by the chain
 * rules above, permanently, however the journal slot reads.
 *
 * `ACCEPTED_SUPPORT_DISPOSITION` is the exception, and it is not a resolution at all in the
 * sense the other five are: it records that an attempt's outcome is UNKNOWN and was
 * acknowledged as such. Acknowledging an unresolved attempt never resolves it, so it never
 * becomes permission to start another one.
 */
const PERMANENTLY_UNREPLACEABLE_RESOLUTION: RedaxTeamAdminTokenConfigStatusResolution =
  'ACCEPTED_SUPPORT_DISPOSITION'

/**
 * The pre-repair surface described every tombstone with one sentence — "a finished attempt
 * that cannot be replaced" — which was false for four of the six resolutions and misleading
 * for a fifth. These three classes are the honest partition, and each carries a different
 * consequence for the operator:
 *
 *   * `PROVEN_NO_EFFECT` — nothing was broadcast, nothing landed, or the exact intended
 *     transaction landed and FAILED. The attempt is over and it changed nothing, so a fresh
 *     explicit attempt may become possible once chain admission allows it.
 *   * `RESOLVED_WITH_EFFECT` — the mutation took effect. The exact chain state decides what
 *     is confirmed, and THAT token config is not resubmittable — but the campaign's other
 *     slots are untouched.
 *   * `SUPPORT_ONLY` — the outcome was acknowledged as unknown. No new mutation may start.
 */
export type RedaxTeamAdminTokenConfigTombstoneClass =
  | 'PROVEN_NO_EFFECT'
  | 'RESOLVED_WITH_EFFECT'
  | 'SUPPORT_ONLY'

/**
 * Classify one tombstone. TOTAL over the closed six, with no default arm.
 *
 * The `never` binding is the point: a seventh resolution stops this file compiling until
 * somebody decides which of the three things it means, rather than silently inheriting the
 * wording of whichever branch happened to be last.
 */
export function classifyRedaxTeamAdminTokenConfigTombstone(
  resolution: RedaxTeamAdminTokenConfigStatusResolution,
): RedaxTeamAdminTokenConfigTombstoneClass {
  switch (resolution) {
    case 'RESOLVED_PRE_RAW_SEND_NO_BROADCAST':
    case 'RESOLVED_FINALIZED_NO_LAND':
    case 'RESOLVED_FINALIZED_LANDED_FAILURE':
      return 'PROVEN_NO_EFFECT'
    case 'RESOLVED_MATCHING_IMMEDIATE_STATE':
    case 'RESOLVED_LANDED_EXACT_POST_STATE_SUPERSEDED':
      return 'RESOLVED_WITH_EFFECT'
    case 'ACCEPTED_SUPPORT_DISPOSITION':
      return 'SUPPORT_ONLY'
    default: {
      const exhaustive: never = resolution
      return exhaustive
    }
  }
}

// --- Row state ------------------------------------------------------------------

/** The FOUR durable row states, and there is no fifth. */
export type RedaxTeamAdminTokenConfigRowState =
  | 'PREPARED'
  | 'PENDING'
  | 'SUBMITTED'
  | 'CONFIRMED'

/**
 * Why a row may not be submitted. A refusal, never a durable state.
 *
 * These are separate from the four states on purpose: `FAILED`, `RETRYABLE`, `CONFLICT`
 * and `BLOCKED` as row STATES would each read as an outcome the route is entitled to act
 * on, and none of them is. A blocked row has no state at all.
 */
export type RedaxTeamAdminTokenConfigBlockingCode =
  | 'CHAIN_TRUTH_UNAVAILABLE'
  | 'MUTATION_STATUS_UNAVAILABLE'
  | 'ROW_NOT_ADMISSIBLE'
  | 'CHAIN_FACTS_CONFLICT'
  | 'GLOBAL_MUTATION_SLOT_ACTIVE'
  | 'SUPPORT_DISPOSITION_BLOCKED'
  | 'SUCCESS_TERMINAL_WITHOUT_CHAIN_STATE'
  | 'CAMPAIGN_AT_TOKEN_CONFIG_CEILING'

/** The immutable chain facts of ONE existing TokenConfig, as loaded. */
export interface RedaxTeamAdminTokenConfigChainFacts {
  readonly tokenConfig: string
  readonly campaign: string
  readonly legacyMint: string
  readonly rateNumerator: string
  readonly rateDenominator: string
  readonly maxOutputFromTokenConfig: string
  readonly legacyDecimals: number
  readonly outputDecimals: number
}

export interface RedaxTeamAdminTokenConfigRowStateInput {
  /**
   * The row's EXACT derived identity — `validation.identity`, not `validation.row`.
   */
  readonly row: RedaxTeamAdminValidatedTokenConfigRow | null
  /**
   * May a NEW `add_token_config` attempt start for this row? `validation.ok`.
   *
   * STRUCTURALLY SEPARATE from `row`, and REQUIRED. It gates only the routes that would
   * OFFER a submission, and it is never consulted before attribution: the duplicate-mint
   * refusal is an answer about starting something new, and running it first is exactly the
   * ordering defect that made a fresh exact success unreachable.
   */
  readonly newSubmissionAdmissible: boolean
  /** Whether the campaign and TokenConfig reads this judgment needs actually resolved. */
  readonly chainAvailable: boolean
  readonly chainTokenConfigs: readonly RedaxTeamAdminTokenConfigChainFacts[]
  /**
   * It is not a hint and not a preference: the two transitions an attempt can produce —
   * confirmation, and re-entry after a replaceable terminal — are refused outright unless
   * this says `FRESH_STATUS_READ`. Every other judgment this function makes is a refusal
   * or a pre-attempt state, and those a loaded snapshot may still answer.
   */
  readonly chainTruthKind: RedaxTeamAdminTokenConfigChainTruthKind
  /** `10 - tokenConfigCount`, or `null` when the chain count is unusable. */
  readonly capacityRemaining: number | null
  readonly status: RedaxTeamAdminTokenConfigStatusInput
}

/**
 * One row's disposition.
 *
 * `submitAdmissible` is true ONLY for a `PREPARED` row with no blocking code. It is a
 * derived convenience, never a second opinion: the panel reads it to enable a control,
 * and the mutation action root's own fresh authority-grade chain guard is what actually
 * decides whether an attempt may proceed.
 */
export interface RedaxTeamAdminTokenConfigRowDisposition {
  readonly state: RedaxTeamAdminTokenConfigRowState | null
  readonly blocking: RedaxTeamAdminTokenConfigBlockingCode | null
  readonly submitAdmissible: boolean
}

function blocked(
  blocking: RedaxTeamAdminTokenConfigBlockingCode,
): RedaxTeamAdminTokenConfigRowDisposition {
  return { state: null, blocking, submitAdmissible: false }
}

function settled(
  state: RedaxTeamAdminTokenConfigRowState,
): RedaxTeamAdminTokenConfigRowDisposition {
  return { state, blocking: null, submitAdmissible: state === 'PREPARED' }
}

/** Does this ACTIVE / TOMBSTONE record describe exactly THIS row's `add_token_config`? */
function describesRow(
  status: Extract<RedaxTeamAdminTokenConfigStatusInput, { kind: 'ACTIVE' | 'TOMBSTONE' }>,
  row: RedaxTeamAdminValidatedTokenConfigRow,
): boolean {
  if (status.operation !== 'ADD_TOKEN_CONFIG' || status.campaign !== row.campaign) {
    return false
  }
  const request = status.addTokenConfigRequest
  if (request === null) {
    return false
  }
  if (status.witnessAddress !== null && status.witnessAddress !== row.tokenConfig) {
    return false
  }
  return (
    request.legacyMint === row.legacyMint &&
    request.rateNumerator === row.rateNumerator &&
    request.rateDenominator === row.rateDenominator &&
    request.maxOutputFromTokenConfig === row.maxOutputFromTokenConfig
  )
}

/**
 * Does the chain hold EXACTLY the TokenConfig this row intended?
 *
 * PDA PRESENCE ALONE IS NOT CONFIRMATION. The account exists once and its terms are
 * immutable, so an account at the derived address carrying different terms is not this
 * row's mutation having succeeded — it is a conflict, and the only honest answer is to
 * refuse rather than to relabel it.
 */
function chainMatchFor(
  row: RedaxTeamAdminValidatedTokenConfigRow,
  chainTokenConfigs: readonly RedaxTeamAdminTokenConfigChainFacts[],
): 'ABSENT' | 'EXACT' | 'MISMATCH' {
  const present = chainTokenConfigs.filter((facts) => facts.tokenConfig === row.tokenConfig)
  if (present.length === 0) {
    return 'ABSENT'
  }
  if (present.length > 1) {
    // One address, two readings. Internally inconsistent chain truth is refused.
    return 'MISMATCH'
  }
  const facts = present[0]
  const exact =
    facts.campaign === row.campaign &&
    facts.legacyMint === row.legacyMint &&
    facts.rateNumerator === row.rateNumerator &&
    facts.rateDenominator === row.rateDenominator &&
    facts.maxOutputFromTokenConfig === row.maxOutputFromTokenConfig &&
    facts.legacyDecimals === row.expectedLegacyDecimals &&
    facts.outputDecimals === row.expectedOutputDecimals
  return exact ? 'EXACT' : 'MISMATCH'
}

/**
 * Derive ONE row's transactional state, FAIL CLOSED at every unknown.
 *
 *   B. WHAT IS THE STATE OF THIS ROW'S OWN ATTEMPT — chain readability, then status
 *      readability, then whether the row is identifiable at all, then the chain account
 *      itself, then the durable slot. Every outcome here is a state or a refusal about
 *      something that has ALREADY happened, and none of them offers a submission.
 *   A. MAY A NEW ATTEMPT START — `newSubmissionAdmissible`, then capacity. Reached only
 *      once question B has produced nothing, because these are the rules about starting
 *      something, and starting is the one thing an already-started row is not doing.
 *
 * Running A first is what made a fresh exact success unreachable: a successful attempt
 * necessarily leaves its own legacy mint in the campaign's accepted set, so the
 * already-configured refusal fired on the very row it was describing and returned
 * `ROW_NOT_ADMISSIBLE` before the exact account it created could be looked at.
 *
 * Nothing about question A is weakened by moving it. An already-configured legacy mint can
 * no longer reach `PREPARED` by ANY route: `chainMatchFor` is never `ABSENT` for it, so it
 * settles or conflicts long before the admission gate — and the gate refuses it as well.
 *
 * TWO of those steps additionally require `chainTruthKind === 'FRESH_STATUS_READ'`, and
 * they are exactly the two an attempt can move: `CONFIRMED`, and re-entry to `PREPARED`
 * after a replaceable terminal. Both rest on a claim about the chain AS IT IS NOW — the
 * exact account is there, or the exact account is still absent — and a snapshot loaded
 * before the attempt can support neither. Every other outcome is a refusal or a
 * pre-attempt state, so a loaded reading answers those without weakening anything.
 */
export function deriveRedaxTeamAdminTokenConfigRowDisposition(
  input: RedaxTeamAdminTokenConfigRowStateInput,
): RedaxTeamAdminTokenConfigRowDisposition {
  if (!input.chainAvailable) {
    return blocked('CHAIN_TRUTH_UNAVAILABLE')
  }
  if (input.status.kind === 'UNAVAILABLE') {
    return blocked('MUTATION_STATUS_UNAVAILABLE')
  }
  const row = input.row
  if (row === null) {
    // NOT IDENTIFIABLE, which is a different thing from not submittable. A row that cannot
    // name an account cannot be attributed to one either, so this is the one refusal that
    // legitimately precedes attribution.
    return blocked('ROW_NOT_ADMISSIBLE')
  }

  const fresh = input.chainTruthKind === 'FRESH_STATUS_READ'
  const status = input.status

  /**
   * Does the ONE durable slot describe THIS row's own attempted `add_token_config`?
   */
  const attributed =
    (status.kind === 'ACTIVE' || status.kind === 'TOMBSTONE') && describesRow(status, row)

  const match = chainMatchFor(row, input.chainTokenConfigs)
  if (match === 'EXACT') {
    // CONFIRMATION IS A CLAIM ABOUT NOW. A snapshot loaded before the attempt cannot make
    // it — it can only report what was true when it was taken — so a cached exact match is
    // refused rather than promoted, and the refusal is the same one an unread chain gets.
    // The honest reading of "the authority-grade reading has not been taken" is not "it is
    // fine": it is that this judgment has no chain truth to rest on.
    if (!fresh) {
      return blocked('CHAIN_TRUTH_UNAVAILABLE')
    }
    if (attributed) {
      return settled('CONFIRMED')
    }
    // Fresh, exact — and not this row's attempt. It is not a confirmation, and question A
    // below refuses it as a new submission rather than offering the account a second time.
  }
  if (match === 'MISMATCH') {
    // The exact address is taken by different immutable terms. No submit, no retry, and
    // deliberately no downgrade to `PREPARED`.
    return blocked('CHAIN_FACTS_CONFLICT')
  }

  if (status.kind === 'ACTIVE') {
    if (attributed) {
      // A KNOWN, retained signature means a raw send MAY have happened. Reconcile-only
      // from here: a second submit would not be a retry, it would be a second attempt at
      // an account that may already exist.
      return settled(status.lifecycle === 'KNOWN_SIGNATURE' ? 'SUBMITTED' : 'PENDING')
    }
    // ANY unresolved record blocks EVERY new submit — different campaign, different
    // operation and different identity alike. There is exactly one slot.
    return blocked('GLOBAL_MUTATION_SLOT_ACTIVE')
  }

  if (status.kind === 'TOMBSTONE') {
    if (status.resolution === PERMANENTLY_UNREPLACEABLE_RESOLUTION) {
      // PERMANENTLY support-only, and the ONE terminal that is. Acknowledging that an
      // attempt is unresolved never makes it resolved, and must never become a licence to
      // start another one.
      return blocked('SUPPORT_DISPOSITION_BLOCKED')
    }
    if (SUCCESS_RESOLUTIONS.includes(status.resolution) && attributed) {
      // It claims THIS row succeeded and the exact account is not there. Fail closed: the
      // claim and the chain disagree, and the chain is not the one that is wrong.
      return blocked('SUCCESS_TERMINAL_WITHOUT_CHAIN_STATE')
    }
    // EVERY RESOLVED TERMINAL RELEASES THE SLOT for a later distinct attempt, subject to
    // every ordinary admission rule below. The target is absent in the chain truth read
    // above, and that absence is what admits a fresh explicit attempt — never the tombstone
    // on its own.
    //
    // AND THE ABSENCE MUST BE A FRESH ONE. A snapshot taken before the attempt would show
    // the target absent whether or not the attempt created it, so a STALE absence proves
    // nothing at all here: re-entering `PREPARED` on it would offer a second attempt at an
    // account that may already exist. Refused, with the same code an unread chain gets.
    if (!fresh) {
      return blocked('CHAIN_TRUTH_UNAVAILABLE')
    }
  }

  // --- QUESTION A, AND ONLY NOW -------------------------------------------------
  //
  // Everything above answered question B: what state is this row's own attempt in. Nothing
  // above could OFFER a submission, so the new-submission refusals had no business running
  // first. From here the row is being asked to become a NEW attempt, and every rule about
  // whether one may start applies.
  if (match === 'EXACT') {
    // THE ACCOUNT IS ALREADY THERE and no attempt of this row's own explains it. A
    // TokenConfig is initialized once and its terms are immutable, so a second
    // `add_token_config` for it would fail against an existing account — this never becomes
    // a submission, whatever a caller believed about admissibility. Fail closed on the
    // chain fact rather than on the caller's answer, using the same bounded refusal the
    // already-configured admission rule raises.
    return blocked('ROW_NOT_ADMISSIBLE')
  }
  if (!input.newSubmissionAdmissible) {
    return blocked('ROW_NOT_ADMISSIBLE')
  }

  const remaining = input.capacityRemaining
  if (remaining === null || !Number.isInteger(remaining)) {
    return blocked('CHAIN_TRUTH_UNAVAILABLE')
  }
  if (remaining <= 0) {
    return blocked('CAMPAIGN_AT_TOKEN_CONFIG_CEILING')
  }
  return settled('PREPARED')
}

// --- The reload recovery row --------------------------------------------------------
//
// The repair is a PROJECTION, not a store: the journal already survives the reload, and this
// turns what it says into something renderable. Nothing here is persisted, nothing here is
// remembered, and nothing here becomes a draft.

/**
 * What ONE recovered attempt IS, as a presentation. Closed, total and value-free.
 *
 * DELIBERATELY NOT the draft row's four-state vocabulary plus a blocking code. Those answer
 * "may this be submitted", and a recovery row is never submittable — it is a report about an
 * attempt that already exists. Reusing them would have made every recovery row carry a
 * `submitAdmissible` question nobody may ask it.
 */
export type RedaxTeamAdminTokenConfigRecoveryOutcome =
  /** Reached the journal, no retained signature: a raw send is not proven to have happened. */
  | 'PENDING'
  /** A signature was retained. A raw send MAY have happened; reconcile, never retry. */
  | 'SUBMITTED'
  /** Resolved, and fresh chain truth holds exactly the TokenConfig this attempt described. */
  | 'CONFIRMED'
  /** Resolved with NO proven effect. A fresh explicit attempt may become possible. */
  | 'NO_PROVEN_EFFECT'
  /** Claims an effect the fresh chain does not corroborate. Refused, never relabelled. */
  | 'EFFECT_WITHOUT_CHAIN_STATE'
  /** The outcome was acknowledged as unknown. Support-only; no new mutation may start. */
  | 'SUPPORT_ONLY'
  /** No authority-grade reading was available, so no claim about a terminal is made. */
  | 'CHAIN_TRUTH_UNAVAILABLE'
  /** The witnessed address holds terms this attempt did not describe. */
  | 'CHAIN_FACTS_CONFLICT'

/**
 * ONE outstanding or resolved `add_token_config`, reconstructed WITHOUT component memory.
 *
 * Every field comes from the sanitized status projection the panel already receives plus
 * fresh chain truth. There is no member here for a signature, a message, a digest, a nonce,
 * a namespace, a storage key or a raw error, because the projection this is built from
 * carries none — the privacy surface is unchanged by this repair, not widened for it.
 *
 *   * SAME-SESSION, with the validated draft still in memory: the operator's own
 *     `expectedLegacyDecimals` and the campaign's `expectedOutputDecimals` are present, so
 *     `chainMatchFor` above compares all seven facts and a decimals surprise is a conflict.
 *     That path stays exactly as strict as it is.
 *   * AFTER A RELOAD, reconstructed from the durable journal projection alone: those two
 *     values are gone, and they were never durable. They are PRE-SUBMISSION PREFLIGHT
 *     FACTS — not mutation identity, not PDA dimensions, not instruction arguments, not
 *     journal request identity, not status members. The program itself never accepts them:
 *     it reads the real decimals out of the mint accounts and stores those.
 *
 * `observedLegacyDecimals` / `observedOutputDecimals` are exactly that — READ BACK, never
 * reconstructed. They are what the program stored, reported as chain state, and no equality
 * against a vanished draft value is claimed for either.
 */
export interface RedaxTeamAdminTokenConfigRecoveryRow {
  readonly campaign: string
  /** The witnessed `add_token_config` target, or `null` when the projection names none. */
  readonly tokenConfig: string | null
  readonly legacyMint: string
  readonly rateNumerator: string
  readonly rateDenominator: string
  readonly maxOutputFromTokenConfig: string
  /**
   * The legacy decimals the PROGRAM stored, as fresh chain truth READ BACK. `null` whenever
   * no single TokenConfig was read at the witnessed address.
   */
  readonly observedLegacyDecimals: number | null
  /** The output decimals the program stored, read back. Observed chain state, as above. */
  readonly observedOutputDecimals: number | null
  readonly outcome: RedaxTeamAdminTokenConfigRecoveryOutcome
  /** ALWAYS false. A recovery row is a report, never a submit affordance. */
  readonly submitAdmissible: false
}

/**
 * Does fresh chain truth hold EXACTLY the TokenConfig this recovered attempt described?
 *
 * EXACT OVER EVERY DURABLE FACT, and every one of them is required. The attempt's durable
 * identity is a campaign, a legacy mint, two rate halves, a cap and the witnessed address —
 * the last of which is this lookup's own key, so an account at a different address is never
 * this attempt's. None of the six may be waived.
 *
 * PLUS ONE PROTOCOL INVARIANT, and deliberately only one. Phase 1 fixes the output mint at
 * `REDAX_OUTPUT_MINT_DECIMALS`, which is campaign-and-protocol truth rather than vanished
 * draft memory, so a TokenConfig reporting anything else is chain state this route refuses
 * to call a confirmation. The legacy decimals get no such rule: they are per-mint, no
 * durable expectation for them survives a reload, and comparing the read-back value to
 * itself would be a check in name only.
 *
 * The observed facts are returned alongside the verdict so the row can REPORT what the
 * program stored without any of it being mistaken for a recovered expectation.
 */
function recoveryChainMatch(
  tokenConfig: string,
  campaign: string,
  request: RedaxTeamAdminTokenConfigStatusRequest,
  chainTokenConfigs: readonly RedaxTeamAdminTokenConfigChainFacts[],
): {
  readonly verdict: 'ABSENT' | 'EXACT' | 'MISMATCH'
  readonly observed: RedaxTeamAdminTokenConfigChainFacts | null
} {
  const present = chainTokenConfigs.filter((facts) => facts.tokenConfig === tokenConfig)
  if (present.length === 0) {
    return { verdict: 'ABSENT', observed: null }
  }
  if (present.length > 1) {
    // One address, two readings. Internally inconsistent chain truth is refused, and
    // nothing is reported as observed from a reading that contradicts itself.
    return { verdict: 'MISMATCH', observed: null }
  }
  const facts = present[0]
  const durable =
    facts.campaign === campaign &&
    facts.legacyMint === request.legacyMint &&
    facts.rateNumerator === request.rateNumerator &&
    facts.rateDenominator === request.rateDenominator &&
    facts.maxOutputFromTokenConfig === request.maxOutputFromTokenConfig
  const canonicalOutputDecimals = facts.outputDecimals === REDAX_OUTPUT_MINT_DECIMALS
  return { verdict: durable && canonicalOutputDecimals ? 'EXACT' : 'MISMATCH', observed: facts }
}

export interface RedaxTeamAdminTokenConfigRecoveryInput {
  readonly status: RedaxTeamAdminTokenConfigStatusInput
  readonly chainAvailable: boolean
  readonly chainTokenConfigs: readonly RedaxTeamAdminTokenConfigChainFacts[]
  readonly chainTruthKind: RedaxTeamAdminTokenConfigChainTruthKind
}

/**
 * Reconstruct ONE `add_token_config` recovery row from the journal projection. PURE.
 *
 * IT NEVER PRODUCES A DRAFT. `PREPARED` is not in the outcome vocabulary and cannot be: a
 * recovered attempt is not an editable row, and a proven-no-effect terminal does not silently
 * become one. Starting again after a reload means creating an ordinary draft, explicitly,
 * which is exactly what keeps `PREPARED_DRAFT_PERSISTENCE = MEMORY_ONLY` true.
 */
export function projectRedaxTeamAdminTokenConfigRecoveryRow(
  input: RedaxTeamAdminTokenConfigRecoveryInput,
): RedaxTeamAdminTokenConfigRecoveryRow | null {
  const status = input.status
  if (status.kind === 'UNAVAILABLE' || status.kind === 'EMPTY') {
    return null
  }
  if (status.operation !== 'ADD_TOKEN_CONFIG') {
    return null
  }
  const request = status.addTokenConfigRequest
  if (request === null) {
    // An `ADD_TOKEN_CONFIG` reading with no canonical request is internally inconsistent.
    // Nothing is manufactured from it.
    return null
  }

  // `null` observed decimals until a single TokenConfig is actually read at the witnessed
  // address. Absent chain state is reported as absent, never defaulted to a plausible value.
  const base: Omit<RedaxTeamAdminTokenConfigRecoveryRow, 'outcome'> = {
    campaign: status.campaign,
    tokenConfig: status.witnessAddress,
    legacyMint: request.legacyMint,
    rateNumerator: request.rateNumerator,
    rateDenominator: request.rateDenominator,
    maxOutputFromTokenConfig: request.maxOutputFromTokenConfig,
    observedLegacyDecimals: null,
    observedOutputDecimals: null,
    submitAdmissible: false,
  }

  if (status.kind === 'ACTIVE') {
    // THE JOURNAL ALONE DECIDES THESE TWO, and it is entitled to: both are statements about
    // what this tab did, not about what the chain now holds. A retained signature means a
    // raw send may already have reached the network, which is reconcile-only forever.
    return {
      ...base,
      outcome: status.lifecycle === 'KNOWN_SIGNATURE' ? 'SUBMITTED' : 'PENDING',
    }
  }

  if (status.resolution === PERMANENTLY_UNREPLACEABLE_RESOLUTION) {
    return { ...base, outcome: 'SUPPORT_ONLY' }
  }

  const succeeded = SUCCESS_RESOLUTIONS.includes(status.resolution)

  // A TERMINAL'S MEANING RESTS ON THE CHAIN, so it needs an authority-grade reading of it.
  // A loaded snapshot may predate the very attempt being reported, and reporting a stale
  // absence as "no effect" would be the same false confidence in the opposite direction.
  if (!input.chainAvailable || input.chainTruthKind !== 'FRESH_STATUS_READ') {
    return { ...base, outcome: 'CHAIN_TRUTH_UNAVAILABLE' }
  }
  if (base.tokenConfig === null) {
    // No witnessed address means no exact account to look at, so no confirmation is
    // possible. A success claim with nothing to corroborate it fails closed.
    return { ...base, outcome: succeeded ? 'EFFECT_WITHOUT_CHAIN_STATE' : 'NO_PROVEN_EFFECT' }
  }
  const match = recoveryChainMatch(
    base.tokenConfig,
    status.campaign,
    request,
    input.chainTokenConfigs,
  )
  // WHAT THE PROGRAM STORED, read back and reported as such. Carried on every verdict,
  // including a conflicting one, because the observed value is the thing an operator looking
  // at a disagreement needs to see. It is never compared to a recovered expectation.
  const observed: Pick<
    RedaxTeamAdminTokenConfigRecoveryRow,
    'observedLegacyDecimals' | 'observedOutputDecimals'
  > = {
    observedLegacyDecimals: match.observed === null ? null : match.observed.legacyDecimals,
    observedOutputDecimals: match.observed === null ? null : match.observed.outputDecimals,
  }
  if (match.verdict === 'EXACT') {
    return { ...base, ...observed, outcome: 'CONFIRMED' }
  }
  if (match.verdict === 'MISMATCH') {
    return { ...base, ...observed, outcome: 'CHAIN_FACTS_CONFLICT' }
  }
  return {
    ...base,
    ...observed,
    outcome: succeeded ? 'EFFECT_WITHOUT_CHAIN_STATE' : 'NO_PROVEN_EFFECT',
  }
}

// --- Capacity ---------------------------------------------------------------------

/**
 * What the campaign's ten slots are actually doing.
 *
 * THREE DIFFERENT THINGS, kept apart on purpose: TokenConfigs the chain confirms, rows
 * that exist only in this tab's memory, and the ONE durable mutation slot. Collapsing any
 * two of them would let a draft look like capacity it does not hold.
 */
export interface RedaxTeamAdminTokenConfigCapacity {
  readonly chainCount: number | null
  readonly remaining: number | null
  readonly unsentDraftCount: number
  readonly mutationSlotOccupied: boolean
}

export function summarizeRedaxTeamAdminTokenConfigCapacity(
  tokenConfigCount: number | null,
  unsentDraftCount: number,
  status: RedaxTeamAdminTokenConfigStatusInput,
): RedaxTeamAdminTokenConfigCapacity {
  const chainCount =
    tokenConfigCount !== null &&
    Number.isInteger(tokenConfigCount) &&
    tokenConfigCount >= 0 &&
    tokenConfigCount <= REDAX_TEAM_ADMIN_MAX_TOKEN_CONFIGS
      ? tokenConfigCount
      : null
  return {
    chainCount,
    remaining: chainCount === null ? null : REDAX_TEAM_ADMIN_MAX_TOKEN_CONFIGS - chainCount,
    unsentDraftCount,
    // `EMPTY` is the only reading that leaves the slot free. `UNAVAILABLE` counts as
    // occupied, because a slot nobody could read is not a slot known to be empty.
    mutationSlotOccupied: status.kind !== 'EMPTY',
  }
}
