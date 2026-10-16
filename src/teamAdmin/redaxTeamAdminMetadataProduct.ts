// -----------------------------------------------------------------------------
// WHAT THIS FILE IS
// -----------------------------------------------------------------------------
// The PURE product half of the `setup_metadata` surface: the memory-only draft, the
// bounded URI selection, the FROZEN LOCAL APPROVAL SNAPSHOT an operator commits to
// before a wallet is ever asked, the rule that decides whether that snapshot is still
// current, the closed metadata product state, and the read-only recovery projection.
//
// It is a LEAF. There is no React and no JSX here, no `Connection`, no `Transaction`,
// no RPC, no wallet, no broker, no signing, no sending, no journal write, no storage,
// no Web Lock and no environment read of any kind — not a `VITE_` key, not a bundler
// meta value, not anything. It cannot start an
// attempt, cannot resolve one and cannot claim one succeeded; it decides what a
// surface may OFFER, and the mutation action root decides what actually happens.
//
// -----------------------------------------------------------------------------
// METADATA IS PERMANENT, IMMUTABLE AND ONCE-ONLY
// -----------------------------------------------------------------------------
// Phase 1 has no metadata-update instruction. Once a campaign's output token metadata
// exists it cannot be changed, replaced or corrected, and a mistake costs a NEW
// CAMPAIGN. Every rule below is written from that fact:
//
//   * a DIFFERENT name, symbol or URI is never permission for a second attempt —
//     there is no overwrite, no update and no edit-after-success anywhere in here;
//   * an UNREADABLE or INCONSISTENT metadata target is never read as an absent one,
//     because "we could not see it" and "it is not there" are different claims and
//     only one of them is safe to act on;
//   * approval is a SNAPSHOT rather than a live read of the fields. What the operator
//     saw is what the request carries, and any change to the values or to the context
//     they were approved against destroys the snapshot instead of quietly updating it.
//
// -----------------------------------------------------------------------------
// THE URI IS CHOSEN, NEVER TYPED
// -----------------------------------------------------------------------------
// The draft holds an INDEX into the deployment's resolved allowlist, not a string. A
// free-text URI field cannot exist here because there is no field for one to live in,
// and the value a snapshot carries is therefore always EXACTLY one member of the array
// the deployment approved — the same array the canonicalizer is handed.
//
// -----------------------------------------------------------------------------
// WHAT DECIDES WHAT
// -----------------------------------------------------------------------------
// `canonicalizeRedaxTeamAdminMetadata` in `redaxTeamAdminMetadataCanonical.ts` is the
// SOLE authority on metadata semantics and identity — https, parsing, percent escapes,
// the program's byte bounds, NFC, and whether a URI is an approved one. This module
// consumes its RESULT and re-decides none of it. The public env carrier in
// `config/redaxEnv.ts` owns bounded list transport and the public-secret refusal, and
// re-decides none of it either.

import { PublicKey } from '@solana/web3.js'

import { deriveOutputTokenMetadataPda } from '../data/devnet/redaxDevnetAccounts'
import type { RedaxTeamAdminCanonicalMetadataV1 } from './redaxTeamAdminMetadataCanonical'
import type { RedaxTeamAdminMutationOperation } from './redaxTeamAdminMutationIdentity'
import type { RedaxTeamAdminMutationResolution } from './redaxTeamAdminMutationJournal'

// --- The closed product state ---------------------------------------------------

/**
 * Every state the metadata surface may be in. Closed, exhaustive and nine wide.
 *
 * THERE IS NO `FAILED` AND NO `RETRY`. Both would be lies about a once-only,
 * irreversible write: an attempt whose outcome is unknown has not failed, and an
 * attempt that took no proven effect is not a retry of anything — it is over, and a
 * fresh attempt is a fresh decision the live chain has to admit again.
 */
export const REDAX_TEAM_ADMIN_METADATA_PRODUCT_STATES = [
  'NOT_CONFIGURED',
  'NOT_AUTHORIZED',
  'DRAFT',
  'READY_FOR_APPROVAL',
  'SAVED_ATTEMPT',
  'SUBMITTED_ATTEMPT',
  'METADATA_SET',
  'NO_EFFECT_PROVEN',
  'BLOCKED_SUPPORT',
] as const

/** One metadata product state. */
export type RedaxTeamAdminMetadataProductState =
  (typeof REDAX_TEAM_ADMIN_METADATA_PRODUCT_STATES)[number]

/**
 * What is known about the canonical metadata account itself. FOUR values, not three.
 *
 * `PRESENT` is the only one this surface can establish on its own, and only from
 * POSITIVE evidence — the campaign's own `metadataSetup` flag, or a freshly read
 * Metaplex identity. A cached identity that is `unavailable` or absent proves nothing
 * and yields `NOT_READ`.
 */
export type RedaxTeamAdminMetadataTargetPresence =
  | 'NOT_READ'
  | 'ABSENT'
  | 'PRESENT'
  | 'UNREADABLE'

/**
 * Why the immutable set may not be offered. A refusal, never a durable state.
 *
 * `null` means nothing is refusing, which is the ONLY way the final gesture is offered.
 */
export type RedaxTeamAdminMetadataBlockingCode =
  | 'ALLOWLIST_NOT_CONFIGURED'
  | 'CAMPAIGN_NOT_AUTHORIZED'
  | 'METADATA_ALREADY_SET'
  | 'METADATA_TARGET_INCONSISTENT'
  | 'METADATA_TARGET_UNREADABLE'
  | 'MUTATION_STATUS_UNAVAILABLE'
  | 'SAVED_ATTEMPT_OUTSTANDING'
  | 'GLOBAL_MUTATION_SLOT_ACTIVE'
  | 'SUPPORT_DISPOSITION_BLOCKED'
  | 'CHAIN_TRUTH_UNAVAILABLE'
  | 'NO_CURRENT_APPROVAL_SNAPSHOT'

// --- The memory-only draft ------------------------------------------------------

/**
 * The unsent metadata draft. MEMORY ONLY, and there is no URI string in it.
 *
 * `uriIndex` addresses the deployment's resolved allowlist. A free-text URI cannot be
 * expressed in this shape at all, so "the URI is exactly one approved entry" is a
 * property of the TYPE rather than a rule somebody has to keep enforcing.
 *
 * `generation` is a monotonic edit counter. It is not a clock and not entropy — this
 * module reads neither — and it exists so an approval can be bound to the exact draft
 * it was taken from rather than to values that may since have been retyped identically.
 */
export interface RedaxTeamAdminMetadataDraft {
  readonly name: string
  readonly symbol: string
  readonly uriIndex: number | null
  readonly generation: number
}

/** The three editable draft fields, and there is no fourth. */
export const REDAX_TEAM_ADMIN_METADATA_DRAFT_FIELD_IDS = ['name', 'symbol', 'uri'] as const

/** One editable draft field id. */
export type RedaxTeamAdminMetadataDraftFieldId =
  (typeof REDAX_TEAM_ADMIN_METADATA_DRAFT_FIELD_IDS)[number]

/** One draft edit. The URI arm carries an INDEX, never text. */
export type RedaxTeamAdminMetadataDraftAction =
  | { readonly kind: 'name'; readonly value: string }
  | { readonly kind: 'symbol'; readonly value: string }
  | { readonly kind: 'uri'; readonly index: number | null }

/**
 * A fresh empty draft.
 *
 * A ONE-ENTRY allowlist is PRESELECTED, because there is nothing to choose between and
 * offering a choice of one is a decision dressed up as a question. Two or more entries
 * start unselected, so the operator makes the choice explicitly.
 */
export function emptyRedaxTeamAdminMetadataDraft(
  entries: readonly string[],
  generation: number,
): RedaxTeamAdminMetadataDraft {
  return Object.freeze({
    name: '',
    symbol: '',
    uriIndex: entries.length === 1 ? 0 : null,
    generation,
  })
}

/**
 * Apply ONE edit. Pure, total, and it always advances the generation.
 *
 * An out-of-range index is refused to `null` rather than clamped: clamping would select
 * an entry nobody clicked, and the value is bound for a permanent write.
 */
export function reduceRedaxTeamAdminMetadataDraft(
  current: RedaxTeamAdminMetadataDraft,
  action: RedaxTeamAdminMetadataDraftAction,
  entries: readonly string[],
): RedaxTeamAdminMetadataDraft {
  const nextGeneration = current.generation + 1
  if (action.kind === 'name') {
    return Object.freeze({ ...current, name: action.value, generation: nextGeneration })
  }
  if (action.kind === 'symbol') {
    return Object.freeze({ ...current, symbol: action.value, generation: nextGeneration })
  }
  const index = action.index
  const usable =
    index !== null && Number.isInteger(index) && index >= 0 && index < entries.length
  return Object.freeze({ ...current, uriIndex: usable ? index : null, generation: nextGeneration })
}

/** The EXACT allowlist member this draft selects, or `null`. Never a constructed string. */
export function resolveRedaxTeamAdminMetadataDraftUri(
  draft: RedaxTeamAdminMetadataDraft,
  entries: readonly string[],
): string | null {
  const index = draft.uriIndex
  if (index === null || !Number.isInteger(index) || index < 0 || index >= entries.length) {
    return null
  }
  return entries[index]
}

// --- The bounded URI selection --------------------------------------------------

/** How the surface must present the deployment's approved locations. */
export type RedaxTeamAdminMetadataUriSelection =
  | { readonly kind: 'NOT_CONFIGURED' }
  | { readonly kind: 'SINGLE'; readonly uri: string }
  | {
      readonly kind: 'CHOICE'
      readonly entries: readonly string[]
      readonly selectedIndex: number | null
      readonly selectedUri: string | null
    }

/**
 * Decide the presentation. THREE shapes and no free-text arm.
 *
 * Zero entries is NOT CONFIGURED and offers nothing at all; one entry is shown exactly
 * as configured and read-only; more than one requires an explicit exact selection.
 */
export function selectRedaxTeamAdminMetadataUri(
  entries: readonly string[],
  selectedIndex: number | null,
): RedaxTeamAdminMetadataUriSelection {
  if (entries.length === 0) {
    return { kind: 'NOT_CONFIGURED' }
  }
  if (entries.length === 1) {
    return { kind: 'SINGLE', uri: entries[0] }
  }
  const usable =
    selectedIndex !== null &&
    Number.isInteger(selectedIndex) &&
    selectedIndex >= 0 &&
    selectedIndex < entries.length
      ? selectedIndex
      : null
  return {
    kind: 'CHOICE',
    entries,
    selectedIndex: usable,
    selectedUri: usable === null ? null : entries[usable],
  }
}

/**
 * A content identity for one resolved allowlist. Order-sensitive and injective.
 *
 * The carrier refuses an entry containing ASCII whitespace by construction — it is what
 * the entries were split on — so a newline can never appear INSIDE one, and joining on
 * newlines cannot make two different lists agree. The count is carried too so an empty
 * list and a list of one empty string could never collide.
 *
 * It identifies a LIST. It decides nothing about any URI in it.
 */
export function redaxTeamAdminMetadataAllowlistIdentity(entries: readonly string[]): string {
  return `${entries.length}:${entries.join('\n')}`
}

// --- The immutable approval context ---------------------------------------------

/**
 * Everything an approval is bound TO. Every member is an immutable public fact.
 *
 * NOT ONE OF THEM IS A SECRET, an adapter, a transaction, a wire, a signature or a
 * durable record, and none of them is persisted anywhere. What they are is the exact
 * situation the operator approved in — so a snapshot can be checked against the CURRENT
 * situation by value equality rather than by hoping nothing moved.
 */
export interface RedaxTeamAdminMetadataApprovalContext {
  /** The RAW explicit selection, never the loader's fallback. */
  readonly rawSelectedCampaignId: string
  /** The campaign the loader actually resolved. Admission requires the two agree. */
  readonly effectiveSelectedCampaignId: string
  /** The campaign account's OWN stored address. */
  readonly campaignAddress: string
  /** The campaign's stored admin, which must be the approved Team wallet. */
  readonly campaignAdmin: string
  /** The campaign's output mint. Never editable and never pasted. */
  readonly campaignOutputMint: string
  /** The campaign's observed lifecycle status. */
  readonly campaignStatus: string
  /** The observed `metadataSetup` flag. An approval may only be taken while it is false. */
  readonly campaignMetadataSetup: boolean
  /** The canonical metadata PDA this write would address, re-derived rather than supplied. */
  readonly metadataTarget: string
  /** What was known about that account when the approval was taken. */
  readonly metadataTargetPresence: RedaxTeamAdminMetadataTargetPresence
  /** The configured approved-Team identity. A deployment fact, never the connected wallet. */
  readonly approvedTeamWallet: string
  /** The exact identity of the resolved allowlist the URI was chosen from. */
  readonly allowlistIdentity: string
  /** The canonical runtime program identity. */
  readonly programId: string
}

/**
 * The context fields, as a list.
 *
 * The comparison below is DRIVEN BY THIS LIST rather than written out field by field,
 * so a member that exists in the interface and not here cannot silently stop being
 * compared. A structural test pins the list against the keys a real context carries,
 * which is what makes "every field participates" checkable rather than hopeful.
 */
export const REDAX_TEAM_ADMIN_METADATA_APPROVAL_CONTEXT_FIELDS = [
  'rawSelectedCampaignId',
  'effectiveSelectedCampaignId',
  'campaignAddress',
  'campaignAdmin',
  'campaignOutputMint',
  'campaignStatus',
  'campaignMetadataSetup',
  'metadataTarget',
  'metadataTargetPresence',
  'approvedTeamWallet',
  'allowlistIdentity',
  'programId',
] as const satisfies readonly (keyof RedaxTeamAdminMetadataApprovalContext)[]

/** The raw facts a context is built from. Any missing one refuses the whole context. */
export interface RedaxTeamAdminMetadataApprovalContextInput {
  readonly rawSelectedCampaignId: string
  readonly effectiveSelectedCampaignId: string
  readonly campaignAddress: string | null
  readonly campaignAdmin: string | null
  readonly campaignOutputMint: string | null
  readonly campaignStatus: string | null
  readonly campaignMetadataSetup: boolean | null
  readonly metadataTargetPresence: RedaxTeamAdminMetadataTargetPresence
  readonly approvedTeamWallet: string | null
  readonly allowlistEntries: readonly string[]
  readonly programId: string | null
}

/**
 * The canonical metadata PDA for one output mint, as base58, or `null`.
 *
 * DERIVED, never supplied, and derived through the ONE existing authority rather than
 * by re-spelling its seeds here — a second derivation would be a second answer to a
 * question that must have exactly one. A malformed mint is a refusal, not a throw.
 */
function metadataTargetForOutputMint(outputMint: string): string | null {
  let mint: PublicKey
  try {
    mint = new PublicKey(outputMint)
  } catch {
    return null
  }
  try {
    return deriveOutputTokenMetadataPda(mint).pda.toBase58()
  } catch {
    return null
  }
}

/**
 * Build the immutable approval context, or refuse.
 *
 * EVERY FACT MUST BE PRESENT AND POSITIVE. An absent stored address, an absent admin, an
 * unresolved program id, an unconfigured carrier, an empty allowlist and an unreadable
 * `metadataSetup` are all refusals — a view that OMITTED a field is not a view that
 * agreed with anything. `metadataSetup` must be observed FALSE: an approval taken while
 * the campaign already reports metadata would be an approval to overwrite, and there is
 * no overwrite.
 */
export function buildRedaxTeamAdminMetadataApprovalContext(
  input: RedaxTeamAdminMetadataApprovalContextInput,
): RedaxTeamAdminMetadataApprovalContext | null {
  if (
    input.campaignAddress === null ||
    input.campaignAdmin === null ||
    input.campaignOutputMint === null ||
    input.campaignStatus === null ||
    input.approvedTeamWallet === null ||
    input.programId === null
  ) {
    return null
  }
  if (input.campaignMetadataSetup !== false) {
    return null
  }
  if (input.allowlistEntries.length === 0) {
    return null
  }
  if (input.rawSelectedCampaignId.trim() === '') {
    return null
  }
  if (input.rawSelectedCampaignId !== input.effectiveSelectedCampaignId) {
    return null
  }
  if (input.campaignAddress !== input.rawSelectedCampaignId) {
    return null
  }
  if (input.campaignAdmin !== input.approvedTeamWallet) {
    return null
  }
  const metadataTarget = metadataTargetForOutputMint(input.campaignOutputMint)
  if (metadataTarget === null) {
    return null
  }
  return Object.freeze({
    rawSelectedCampaignId: input.rawSelectedCampaignId,
    effectiveSelectedCampaignId: input.effectiveSelectedCampaignId,
    campaignAddress: input.campaignAddress,
    campaignAdmin: input.campaignAdmin,
    campaignOutputMint: input.campaignOutputMint,
    campaignStatus: input.campaignStatus,
    campaignMetadataSetup: false,
    metadataTarget,
    metadataTargetPresence: input.metadataTargetPresence,
    approvedTeamWallet: input.approvedTeamWallet,
    allowlistIdentity: redaxTeamAdminMetadataAllowlistIdentity(input.allowlistEntries),
    programId: input.programId,
  })
}

// --- The frozen local approval snapshot -----------------------------------------

/** One approved metadata field: the exact value, its byte length, its commitment. */
export interface RedaxTeamAdminMetadataApprovedFieldV1 {
  readonly value: string
  readonly byteLength: number
  readonly sha256Hex: string
}

/**
 * What the operator committed to, frozen. `C5`.
 *
 * IT CARRIES NO BYTES, no adapter, no `Connection`, no `Transaction`, no wire, no
 * message, no blockhash, no signature and no durable record — there is no member any of
 * them could travel in. It is not persisted: it lives in one component's memory and a
 * reload discards it, exactly like the draft it was taken from.
 *
 * `draftGeneration` binds the snapshot to the EXACT edit it was taken from, so retyping
 * the same characters after an invalidation does not silently revive an approval.
 */
export interface RedaxTeamAdminMetadataApprovalSnapshot {
  readonly name: RedaxTeamAdminMetadataApprovedFieldV1
  readonly symbol: RedaxTeamAdminMetadataApprovedFieldV1
  readonly uri: RedaxTeamAdminMetadataApprovedFieldV1
  readonly draftGeneration: number
  readonly context: RedaxTeamAdminMetadataApprovalContext
}

/**
 * Freeze one canonicalization result into an approval snapshot.
 *
 * The canonical STRINGS, their byte lengths and their SHA-256 commitments are copied;
 * the canonicalizer's `bytes` views are deliberately NOT, because a snapshot that
 * carried mutable memory would be a snapshot another caller could still write through.
 */
export function createRedaxTeamAdminMetadataApprovalSnapshot(
  metadata: RedaxTeamAdminCanonicalMetadataV1,
  draftGeneration: number,
  context: RedaxTeamAdminMetadataApprovalContext,
): RedaxTeamAdminMetadataApprovalSnapshot {
  return Object.freeze({
    name: Object.freeze({
      value: metadata.name.value,
      byteLength: metadata.name.byteLength,
      sha256Hex: metadata.name.sha256Hex,
    }),
    symbol: Object.freeze({
      value: metadata.symbol.value,
      byteLength: metadata.symbol.byteLength,
      sha256Hex: metadata.symbol.sha256Hex,
    }),
    uri: Object.freeze({
      value: metadata.uri.value,
      byteLength: metadata.uri.byteLength,
      sha256Hex: metadata.uri.sha256Hex,
    }),
    draftGeneration,
    context,
  })
}

/** Field-by-field context equality, driven by the pinned field list. */
function approvalContextsAgree(
  left: RedaxTeamAdminMetadataApprovalContext,
  right: RedaxTeamAdminMetadataApprovalContext,
): boolean {
  for (const field of REDAX_TEAM_ADMIN_METADATA_APPROVAL_CONTEXT_FIELDS) {
    if (left[field] !== right[field]) {
      return false
    }
  }
  return true
}

/**
 * Is this snapshot still the thing the operator approved? `C5`.
 *
 * TOTAL AND CONSERVATIVE. An absent snapshot, an absent current context, a changed draft
 * generation, and ANY changed context field all answer `false` — which is what a name
 * edit, a symbol edit, a URI reselection, a campaign reselection, a fallback that stopped
 * agreeing, a changed stored address, a changed admin, a changed output mint, a changed
 * lifecycle status, a metadata flag that flipped, a changed approved-Team carrier, a
 * changed allowlist, a changed program identity, a re-derived metadata target and a fresh
 * observation that the target is present or unreadable each reduce to.
 *
 * The snapshot is DESTROYED by the caller rather than repaired here: this answers a
 * question and rewrites nothing.
 */
export function isRedaxTeamAdminMetadataApprovalSnapshotCurrent(
  snapshot: RedaxTeamAdminMetadataApprovalSnapshot | null,
  context: RedaxTeamAdminMetadataApprovalContext | null,
  draftGeneration: number,
): boolean {
  if (snapshot === null || context === null) {
    return false
  }
  if (snapshot.draftGeneration !== draftGeneration) {
    return false
  }
  return approvalContextsAgree(snapshot.context, context)
}

// --- Preview / request equality --------------------------------------------------

/**
 * The EXACT values one `SETUP_METADATA` request carries. `C24`.
 *
 * There is ONE function that produces them and the preview renders THE SAME snapshot
 * fields, so "what was previewed is what is requested" is true by construction rather
 * than by two code paths agreeing. Nothing is canonicalized, normalized or repaired
 * here: canonicalization happened at Review, and a first canonicalization after the
 * final click would mean the operator approved something the request did not carry.
 */
export interface RedaxTeamAdminMetadataSubmitValues {
  readonly campaign: string
  readonly outputMint: string
  readonly metadataName: string
  readonly metadataSymbol: string
  readonly metadataUri: string
}

/** Project the frozen snapshot into the exact request values. No transformation. */
export function redaxTeamAdminMetadataSubmitValuesFromSnapshot(
  snapshot: RedaxTeamAdminMetadataApprovalSnapshot,
): RedaxTeamAdminMetadataSubmitValues {
  return Object.freeze({
    campaign: snapshot.context.campaignAddress,
    outputMint: snapshot.context.campaignOutputMint,
    metadataName: snapshot.name.value,
    metadataSymbol: snapshot.symbol.value,
    metadataUri: snapshot.uri.value,
  })
}

// --- The durable slot, as this surface reads it -----------------------------------

/**
 * The sanitized status projection, folded into a structural input.
 *
 * A read that has not happened, and a read that failed, are BOTH `UNAVAILABLE`: an
 * unread slot is not a slot known to be empty, and nothing is offered until it has
 * actually been read.
 */
export type RedaxTeamAdminMetadataStatusInput =
  | { readonly kind: 'UNAVAILABLE' }
  | { readonly kind: 'EMPTY' }
  | {
      readonly kind: 'ACTIVE'
      readonly operation: RedaxTeamAdminMutationOperation
      readonly campaign: string
      readonly lifecycle:
        | 'PRE_RAW_SEND'
        | 'PRE_RAW_SEND_SIGNATURE_LOCAL_NOT_RETAINED'
        | 'KNOWN_SIGNATURE'
      readonly witnessAddress: string | null
    }
  | {
      readonly kind: 'TOMBSTONE'
      readonly operation: RedaxTeamAdminMutationOperation
      readonly campaign: string
      readonly resolution: RedaxTeamAdminMutationResolution
      readonly witnessAddress: string | null
    }

/** What a FINISHED saved attempt means, in the three ways that actually differ. */
export type RedaxTeamAdminMetadataTombstoneClass =
  | 'PROVEN_NO_EFFECT'
  | 'RESOLVED_WITH_EFFECT'
  | 'SUPPORT_ONLY'

/**
 * Classify one terminal.
 *
 * THE THREE PROVEN-NO-EFFECT TERMINALS all establish that the intended mutation did not
 * take effect: nothing was broadcast, nothing landed, or the exact intended transaction
 * landed and FAILED. `ACCEPTED_SUPPORT_DISPOSITION` establishes nothing at all — it
 * records that an unresolved attempt was acknowledged, which is never permission.
 */
export function classifyRedaxTeamAdminMetadataTombstone(
  resolution: RedaxTeamAdminMutationResolution,
): RedaxTeamAdminMetadataTombstoneClass {
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

/** Is this record a `SETUP_METADATA` record for exactly this campaign? */
function isThisCampaignMetadataRecord(
  status: RedaxTeamAdminMetadataStatusInput,
  campaignAddress: string | null,
): boolean {
  if (status.kind !== 'ACTIVE' && status.kind !== 'TOMBSTONE') {
    return false
  }
  if (status.operation !== 'SETUP_METADATA') {
    return false
  }
  return campaignAddress !== null && status.campaign === campaignAddress
}

// --- The disposition ---------------------------------------------------------------

/** Everything the metadata disposition is decided from. Every input is injected. */
export interface RedaxTeamAdminMetadataDispositionInput {
  /** How many entries the deployment's resolved allowlist actually holds. */
  readonly allowlistEntryCount: number
  /** Whether this surface established POSITIVE authority over the selected campaign. */
  readonly authorityConfirmed: boolean
  /** The campaign account's own stored address, or `null` when there is none to trust. */
  readonly campaignAddress: string | null
  /** The FRESH `metadataSetup` flag, or `null` when it has not been read that freshly. */
  readonly campaignMetadataSetup: boolean | null
  /** What is known about the canonical metadata account. `NOT_READ` is not absence. */
  readonly metadataTargetPresence: RedaxTeamAdminMetadataTargetPresence
  /** The durable single attempt slot, as this surface last read it. */
  readonly status: RedaxTeamAdminMetadataStatusInput
  /** Whether a frozen approval snapshot exists AND still matches the current context. */
  readonly snapshotCurrent: boolean
}

/** What the surface is, what refuses it, and what it may offer. */
export interface RedaxTeamAdminMetadataDisposition {
  readonly state: RedaxTeamAdminMetadataProductState
  readonly blocking: RedaxTeamAdminMetadataBlockingCode | null
  /** The immutable set may be offered. Requires `blocking === null` and nothing weaker. */
  readonly setAdmissible: boolean
  /** The purely local, non-mutating review may be offered. */
  readonly reviewAdmissible: boolean
}

/**
 * Why the immutable set is refused, or `null`. FIRST reason wins, and the order is the
 * argument: configuration before authority, authority before the chain, the chain before
 * the journal, and the operator's own unfinished business before their next step.
 */
function metadataBlockingFor(input: RedaxTeamAdminMetadataDispositionInput): {
  readonly blocking: RedaxTeamAdminMetadataBlockingCode | null
  readonly alreadySet: boolean
  readonly supportBlocked: boolean
} {
  if (input.allowlistEntryCount <= 0) {
    return { blocking: 'ALLOWLIST_NOT_CONFIGURED', alreadySet: false, supportBlocked: false }
  }
  if (!input.authorityConfirmed) {
    return { blocking: 'CAMPAIGN_NOT_AUTHORIZED', alreadySet: false, supportBlocked: false }
  }
  // ONCE-ONLY, from either of the two things that can establish it: the campaign's own
  // flag, or this campaign's own settled successful metadata attempt.
  const successTombstone =
    input.status.kind === 'TOMBSTONE' &&
    isThisCampaignMetadataRecord(input.status, input.campaignAddress) &&
    classifyRedaxTeamAdminMetadataTombstone(input.status.resolution) === 'RESOLVED_WITH_EFFECT'
  if (input.campaignMetadataSetup === true || successTombstone) {
    return { blocking: 'METADATA_ALREADY_SET', alreadySet: true, supportBlocked: false }
  }
  // NEVER TREAT UNREADABLE AS ABSENT, and never treat a present target beside a false
  // flag as something to work around. Both are conflicts, and both need support.
  if (input.metadataTargetPresence === 'PRESENT') {
    return { blocking: 'METADATA_TARGET_INCONSISTENT', alreadySet: false, supportBlocked: false }
  }
  if (input.metadataTargetPresence === 'UNREADABLE') {
    return { blocking: 'METADATA_TARGET_UNREADABLE', alreadySet: false, supportBlocked: false }
  }
  if (input.status.kind === 'UNAVAILABLE') {
    return { blocking: 'MUTATION_STATUS_UNAVAILABLE', alreadySet: false, supportBlocked: false }
  }
  if (input.status.kind === 'ACTIVE') {
    return {
      blocking: isThisCampaignMetadataRecord(input.status, input.campaignAddress)
        ? 'SAVED_ATTEMPT_OUTSTANDING'
        : 'GLOBAL_MUTATION_SLOT_ACTIVE',
      alreadySet: false,
      supportBlocked: false,
    }
  }
  if (
    input.status.kind === 'TOMBSTONE' &&
    classifyRedaxTeamAdminMetadataTombstone(input.status.resolution) === 'SUPPORT_ONLY'
  ) {
    return { blocking: 'SUPPORT_DISPOSITION_BLOCKED', alreadySet: false, supportBlocked: true }
  }
  // RE-ENTRY AFTER A PROVEN-NO-EFFECT TERMINAL IS A SECOND DECISION, and it needs a
  // POSITIVE current absence rather than the terminal alone.
  //
  // The terminal establishes exactly one thing: THAT attempt changed nothing. It does not
  // establish that the metadata is still unset, because it says nothing about any other
  // route that may have set it since — and a permanent, once-only, irreversible write is
  // never offered on the strength of a fact nobody established. `NOT_READ` is precisely
  // the admission that no authority-grade reading of the target is held here, so it
  // refuses for the same reason the unread campaign flag below refuses. `PRESENT` and
  // `UNREADABLE` are already refused further up; this branch is what closes `NOT_READ`,
  // and it is written against every non-`ABSENT` value so reordering the cascade cannot
  // reopen it.
  //
  // THIS IS AN ADMISSION RULE AND NOT A STATE RULE. The previous attempt is still
  // described truthfully wherever it is described; only the ADMISSION of a NEW set is
  // withheld. It also leaves the INITIAL attempt untouched — a surface with no terminal at
  // all still proceeds without an authority-grade target read, because the mutation root
  // takes that reading itself before any wallet is asked.
  if (
    input.status.kind === 'TOMBSTONE' &&
    isThisCampaignMetadataRecord(input.status, input.campaignAddress) &&
    classifyRedaxTeamAdminMetadataTombstone(input.status.resolution) === 'PROVEN_NO_EFFECT' &&
    input.metadataTargetPresence !== 'ABSENT'
  ) {
    return { blocking: 'CHAIN_TRUTH_UNAVAILABLE', alreadySet: false, supportBlocked: false }
  }
  if (input.campaignMetadataSetup === null) {
    return { blocking: 'CHAIN_TRUTH_UNAVAILABLE', alreadySet: false, supportBlocked: false }
  }
  if (!input.snapshotCurrent) {
    return { blocking: 'NO_CURRENT_APPROVAL_SNAPSHOT', alreadySet: false, supportBlocked: false }
  }
  return { blocking: null, alreadySet: false, supportBlocked: false }
}

/**
 * The metadata product state. `C4` — projected from the generic status, not a new one.
 *
 * The cascade is ordered so the most permanent fact wins: metadata that already exists
 * beats everything, a conflict about the target beats the journal, the operator's own
 * outstanding attempt beats a fresh draft, and only when nothing above applies does the
 * surface describe the drafting step it is actually on.
 *
 * `NO_EFFECT_PROVEN` requires ALL THREE of its conditions and is never inferred from the
 * terminal alone: a settled attempt that took no effect says nothing about whether some
 * OTHER route set the metadata, and only a positive `ABSENT` reading of the canonical
 * account closes that gap. `NOT_READ` therefore does not qualify — by design.
 */
export function deriveRedaxTeamAdminMetadataDisposition(
  input: RedaxTeamAdminMetadataDispositionInput,
): RedaxTeamAdminMetadataDisposition {
  const { blocking, alreadySet, supportBlocked } = metadataBlockingFor(input)
  const setAdmissible = blocking === null

  let state: RedaxTeamAdminMetadataProductState
  if (input.allowlistEntryCount <= 0) {
    state = 'NOT_CONFIGURED'
  } else if (!input.authorityConfirmed) {
    state = 'NOT_AUTHORIZED'
  } else if (alreadySet) {
    state = 'METADATA_SET'
  } else if (
    input.metadataTargetPresence === 'PRESENT' ||
    input.metadataTargetPresence === 'UNREADABLE' ||
    supportBlocked
  ) {
    state = 'BLOCKED_SUPPORT'
  } else if (
    input.status.kind === 'ACTIVE' &&
    isThisCampaignMetadataRecord(input.status, input.campaignAddress)
  ) {
    state =
      input.status.lifecycle === 'KNOWN_SIGNATURE' ? 'SUBMITTED_ATTEMPT' : 'SAVED_ATTEMPT'
  } else if (
    input.status.kind === 'TOMBSTONE' &&
    isThisCampaignMetadataRecord(input.status, input.campaignAddress) &&
    classifyRedaxTeamAdminMetadataTombstone(input.status.resolution) === 'PROVEN_NO_EFFECT' &&
    input.campaignMetadataSetup === false &&
    input.metadataTargetPresence === 'ABSENT'
  ) {
    state = 'NO_EFFECT_PROVEN'
  } else if (input.snapshotCurrent) {
    state = 'READY_FOR_APPROVAL'
  } else {
    state = 'DRAFT'
  }

  // Review is LOCAL and mutates nothing, so it is offered wherever drafting is still a
  // sensible thing to be doing — and withheld once the answer is settled, conflicted or
  // waiting on an attempt, because offering it there would read as a way to try again.
  const reviewAdmissible =
    state === 'DRAFT' || state === 'READY_FOR_APPROVAL' || state === 'NO_EFFECT_PROVEN'

  return Object.freeze({ state, blocking, setAdmissible, reviewAdmissible })
}

// --- The read-only recovery projection ----------------------------------------------

/** What ONE recovered metadata attempt is, after a reload. */
export type RedaxTeamAdminMetadataRecoveryOutcome =
  | 'SAVED'
  | 'SUBMITTED'
  | 'METADATA_SET'
  | 'NO_PROVEN_EFFECT'
  | 'EFFECT_WITHOUT_CHAIN_STATE'
  | 'SUPPORT_ONLY'
  | 'CHAIN_TRUTH_UNAVAILABLE'
  | 'TARGET_INCONSISTENT'

/**
 * The ONE thing that survives a reload, projected. It is a REPORT and never a control.
 *
 * IT CARRIES NO RAW TEXT. There is no name, no symbol and no URI member, because the
 * durable record holds only commitments and puffed-byte digests of them — and a hash is
 * not invertible. What it carries is the campaign and the DERIVED metadata account the
 * attempt addressed, both of which are public identities the choreography re-derived
 * rather than values somebody stored.
 */
export interface RedaxTeamAdminMetadataRecoveryRow {
  readonly outcome: RedaxTeamAdminMetadataRecoveryOutcome
  readonly campaign: string
  readonly metadataTarget: string | null
}

/** Everything the recovery projection is decided from. */
export interface RedaxTeamAdminMetadataRecoveryInput {
  readonly status: RedaxTeamAdminMetadataStatusInput
  readonly campaignAddress: string | null
  readonly campaignMetadataSetup: boolean | null
  readonly metadataTargetPresence: RedaxTeamAdminMetadataTargetPresence
}

/**
 * Project the durable slot into a recovery row, or `null`.
 *
 * `null` for an unread slot, an empty slot, a record for another campaign and a record
 * for any of the other five operations — none of those is a metadata attempt, and
 * manufacturing a metadata row out of one would be rendering a capability this slice
 * does not have.
 */
export function projectRedaxTeamAdminMetadataRecoveryRow(
  input: RedaxTeamAdminMetadataRecoveryInput,
): RedaxTeamAdminMetadataRecoveryRow | null {
  const status = input.status
  if (!isThisCampaignMetadataRecord(status, input.campaignAddress)) {
    return null
  }
  if (status.kind !== 'ACTIVE' && status.kind !== 'TOMBSTONE') {
    return null
  }
  const campaign = status.campaign
  const metadataTarget = status.witnessAddress
  if (status.kind === 'ACTIVE') {
    return Object.freeze({
      outcome: status.lifecycle === 'KNOWN_SIGNATURE' ? 'SUBMITTED' : 'SAVED',
      campaign,
      metadataTarget,
    })
  }
  const settled = classifyRedaxTeamAdminMetadataTombstone(status.resolution)
  if (settled === 'SUPPORT_ONLY') {
    return Object.freeze({ outcome: 'SUPPORT_ONLY', campaign, metadataTarget })
  }
  if (input.campaignMetadataSetup === null) {
    return Object.freeze({ outcome: 'CHAIN_TRUTH_UNAVAILABLE', campaign, metadataTarget })
  }
  if (settled === 'RESOLVED_WITH_EFFECT') {
    return Object.freeze({
      outcome: input.campaignMetadataSetup ? 'METADATA_SET' : 'EFFECT_WITHOUT_CHAIN_STATE',
      campaign,
      metadataTarget,
    })
  }
  // PROVEN_NO_EFFECT. A campaign that nevertheless reports metadata, or a target seen to
  // be present beside a false flag, is a conflict rather than a clean nothing-happened.
  if (input.campaignMetadataSetup === true) {
    return Object.freeze({ outcome: 'TARGET_INCONSISTENT', campaign, metadataTarget })
  }
  if (input.metadataTargetPresence === 'PRESENT') {
    return Object.freeze({ outcome: 'TARGET_INCONSISTENT', campaign, metadataTarget })
  }
  if (input.metadataTargetPresence === 'ABSENT') {
    return Object.freeze({ outcome: 'NO_PROVEN_EFFECT', campaign, metadataTarget })
  }
  // `NOT_READ` and `UNREADABLE` both withhold the claim rather than making it.
  return Object.freeze({ outcome: 'CHAIN_TRUTH_UNAVAILABLE', campaign, metadataTarget })
}
