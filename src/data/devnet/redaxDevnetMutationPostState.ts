// REDAX Team/Admin POST-INIT MUTATION post-state — a pure, total judgment.
//
// -----------------------------------------------------------------------------
// BOUNDARY
// -----------------------------------------------------------------------------
// ZERO IMPORTS. No React, no `Connection`, no `Transaction`, no `PublicKey`, no keypair,
// no `localStorage`, no RPC, no wallet, no clock, no entropy, no I/O and no logging. It
// reads nothing and writes nothing: an observation is handed to it as plain serializable
// DATA, and a verdict comes back. Performing the reads is the caller's job, in the data
// layer that already owns a `Connection`.
//
// The input shapes below are RE-DECLARED structurally rather than imported, exactly as the
// S1 post-state judgment re-declares its own: this module must stay an independently
// committable leaf that cannot drag the account adapter — and through it the whole web3
// package — into a bundle. The structural tests prove the declarations agree by reading
// both sources, without ever creating an import specifier.
//
// -----------------------------------------------------------------------------
// SUCCESS IS NEVER INFERRED FROM POST-STATE ALONE
// -----------------------------------------------------------------------------
// A Campaign that is `Active` does not prove THIS attempt activated it. A TokenConfig at
// the expected PDA does not prove THIS attempt created it. Somebody else's transaction,
// an earlier attempt, or a later legal mutation could each produce a state that looks
// exactly like the one this attempt intended.
//
// So every success verdict here requires the FULL conjunction, and the transaction half of
// it is supplied by the caller as an attestation this module cannot fabricate:
//
//   * a retained exact signature, locally derived before the send;
//   * that signature FINALIZED;
//   * `err = null`;
//   * the landed message byte-identical to the intended one;
//   * the exact finalized transaction slot;
//   * the pre-state this attempt RECORDED before it planned anything;
//   * a finalized coherent post-state read at or above the floor.
//
// Because the exact landed message is required, its account-key slot 0 is the fee payer,
// which is the approved Team wallet, which is what makes effect origin a PROOF rather than
// an inference. A success verdict here therefore always carries a non-null `payer`.
//
// -----------------------------------------------------------------------------
// A LATER LEGAL MUTATION IS NOT A FAILURE, AND IS NOT RETRY AUTHORITY
// -----------------------------------------------------------------------------
// Current state can legitimately differ from the immediate post-state this attempt
// intended, because the campaign lifecycle keeps moving: a pause after an activate, a
// second token config after the first, a metadata setup after a token config. That is
// `LANDED_EXACT_BUT_POST_STATE_SUPERSEDED` — a distinct TERMINAL classification meaning
//
//   OUR TRANSACTION LANDED EXACT       = YES
//   CURRENT STATE HAS A LATER SUCCESSOR = YES
//   RETRY AUTHORITY                     = NO
//
// and it is reached ONLY when the difference is demonstrably reachable from the intended
// post-state by legal later mutations. A difference that is NOT so reachable is never
// guessed at: it is `OUTCOME_UNRESOLVED_SUPPORT`, which resends nothing and closes nothing.

// --- Re-declared observation shapes ---------------------------------------------

/**
 * What one planned account was observed to be.
 *
 * THREE ANSWERS, NEVER TWO. `UNREADABLE` is not `ABSENT`: an account that could not be
 * read has not been proven not to exist, and treating the two alike is exactly how a
 * mutation gets attempted twice.
 */
export type RedaxMutationAccountObservation<TFacts> =
  | { readonly presence: 'ABSENT' }
  | { readonly presence: 'PRESENT'; readonly facts: TFacts }
  | { readonly presence: 'UNREADABLE' }

/** The complete public Campaign body, as plain serializable data. */
export interface RedaxMutationCampaignFactsV1 {
  readonly campaignAdmin: string
  readonly outputGovernance: string
  readonly outputMint: string
  readonly protocolFeeVault: string
  readonly status: 'initialized' | 'active' | 'paused' | 'finalized'
  readonly metadataSetup: boolean
  readonly discoveryStatus: number
  readonly bump: number
  readonly saltHex: string
  readonly endTs: string | null
  readonly maxOutputSupplyRaw: string
  readonly totalOutputMintedRaw: string
  readonly totalProtocolFeesMintedRaw: string
  readonly tokenConfigCount: number
  readonly pdaSelfConsistent: boolean
}

/** The complete public TokenConfig body, as plain serializable data. */
export interface RedaxMutationTokenConfigFactsV1 {
  readonly campaign: string
  readonly legacyMint: string
  readonly rateNumeratorRaw: string
  readonly rateDenominatorRaw: string
  readonly legacyDecimals: number
  readonly outputDecimals: number
  readonly maxOutputFromTcRaw: string
  readonly totalOutputMintedFromTcRaw: string
  readonly normalizationRemainderTotalRaw: string
  readonly bump: number
  readonly pdaSelfConsistent: boolean
}

/**
 * The attribution-grade Metaplex metadata facts.
 *
 * `storedPuffed…` throughout, and never `rawPrePuff…`. The metadata program PADS each
 * string with trailing NUL bytes to a fixed width, so the stored account CANNOT uniquely
 * recover the original unpadded arguments — naming a stored field after the pre-puff value
 * would encode a false inverse directly into the source. What exists is compared FORWARD:
 * expected canonical bytes are padded to the stored widths, and those are compared against
 * what is stored.
 */
export interface RedaxMutationMetadataFactsV1 {
  readonly updateAuthority: string
  readonly mint: string
  readonly storedPuffedNameSha256Hex: string
  readonly storedPuffedSymbolSha256Hex: string
  readonly storedPuffedUriSha256Hex: string
  readonly storedPuffedNameByteLength: number
  readonly storedPuffedSymbolByteLength: number
  readonly storedPuffedUriByteLength: number
  readonly sellerFeeBasisPoints: number
  /** `false` proves `creators = None`. `true` means a vector is present. */
  readonly creatorsPresent: boolean
  /** `0` when absent. Present so `None` and an empty vector stay distinguishable. */
  readonly creatorCount: number
  readonly primarySaleHappened: boolean
  readonly isMutable: boolean
}

/**
 * One coherent, slot-consistent observation.
 *
 * `tokenConfig` and `metadata` are `null` when the operation did not ask for them — which
 * is different from an `ABSENT` observation of an account that WAS asked for.
 */
export interface RedaxMutationCoherentObservationV1 {
  readonly contextSlot: number
  readonly campaign: RedaxMutationAccountObservation<RedaxMutationCampaignFactsV1>
  readonly tokenConfig: RedaxMutationAccountObservation<RedaxMutationTokenConfigFactsV1> | null
  readonly metadata: RedaxMutationAccountObservation<RedaxMutationMetadataFactsV1> | null
}

/**
 * What the caller established about the transaction itself.
 *
 * This module cannot read a chain, so the transaction half of every proof arrives as an
 * attestation. `FINALIZED_EXACT` is the ONLY arm any success verdict can be built on, and
 * it carries the account keys so `payer` is derived from the landed message rather than
 * lifted out of an account body.
 */
export type RedaxMutationTransactionAttestationV1 =
  /** No signature was retained, so no landed message was ever sought. */
  | { readonly kind: 'NOT_APPLICABLE' }
  /** One was sought and could not be read, or is not yet finalized. Never a conclusion. */
  | { readonly kind: 'UNAVAILABLE' }
  /** A message landed under this signature and it is NOT the approved one. */
  | { readonly kind: 'LANDED_MESSAGE_MISMATCH' }
  /** The approved message landed, finalized, and the transaction FAILED. */
  | { readonly kind: 'FINALIZED_FAILED'; readonly transactionSlot: number }
  /** The approved message landed, finalized, `err = null`. */
  | {
      readonly kind: 'FINALIZED_EXACT'
      readonly transactionSlot: number
      readonly accountKeys: readonly string[]
    }

/** The recorded pre-state, exactly as the durable record carries it. */
export interface RedaxMutationRecordedPreStateV1 {
  readonly campaignStatus: 'initialized' | 'active' | 'paused' | 'finalized'
  readonly metadataSetup: boolean
  readonly tokenConfigCount: number
  readonly targetAccountAbsent: boolean
}

/** The immediate post-state this exact mutation intended. */
export interface RedaxMutationExpectedPostStateV1 {
  readonly campaignStatus: 'initialized' | 'active' | 'paused' | 'finalized'
  readonly metadataSetup: boolean
  readonly tokenConfigCount: number
  readonly createdAccount: string | null
}

/** The exact TokenConfig body `ADD_TOKEN_CONFIG` intended to create. */
export interface RedaxMutationExpectedTokenConfigV1 {
  readonly address: string
  readonly legacyMint: string
  readonly rateNumeratorRaw: string
  readonly rateDenominatorRaw: string
  readonly maxOutputFromTcRaw: string
}

/**
 * The exact stored payload `SETUP_METADATA` intended to create.
 *
 * The three digests are over the EXPECTED PUFFED bytes — canonical UTF-8 padded forward
 * with `0x00` to `32` / `10` / `200` — and the three lengths are those fixed widths. The
 * comparison is `EXPECTED_PUFFED_BYTES_VS_STORED_PUFFED_BYTES`, in that one direction.
 */
export interface RedaxMutationExpectedMetadataV1 {
  readonly address: string
  readonly updateAuthority: string
  readonly mint: string
  readonly expectedPuffedNameSha256Hex: string
  readonly expectedPuffedSymbolSha256Hex: string
  readonly expectedPuffedUriSha256Hex: string
  readonly expectedPuffedNameByteLength: number
  readonly expectedPuffedSymbolByteLength: number
  readonly expectedPuffedUriByteLength: number
}

/** Everything one judgment is made against. */
export interface RedaxMutationExpectationV1 {
  readonly operation:
    | 'ADD_TOKEN_CONFIG'
    | 'SETUP_METADATA'
    | 'ACTIVATE_CAMPAIGN'
    | 'PAUSE_CAMPAIGN'
    | 'UNPAUSE_CAMPAIGN'
    | 'FINALIZE_CAMPAIGN'
  /** The Campaign address this mutation was about. */
  readonly campaign: string
  readonly campaignAdmin: string
  readonly outputMint: string
  readonly recordedPreState: RedaxMutationRecordedPreStateV1
  readonly expectedPostState: RedaxMutationExpectedPostStateV1
  /** Non-null for `ADD_TOKEN_CONFIG` only. */
  readonly expectedTokenConfig: RedaxMutationExpectedTokenConfigV1 | null
  /** Non-null for `SETUP_METADATA` only. */
  readonly expectedMetadata: RedaxMutationExpectedMetadataV1 | null
  /** `max(preflightContextSlot, transactionSlot)`. The read must be at or above it. */
  readonly finalizedFloorSlot: number
}

// --- The verdict vocabulary ----------------------------------------------------

/**
 * The exact, closed result vocabulary. NINE verdicts, and there is no tenth.
 *
 * `LANDED_MESSAGE_MISMATCH` sits beside the eight the decision enumerates for the same
 * reason the S1 judgment carries one: a proven mismatch is a definite fact about the
 * transaction, and collapsing it into `TARGET_MISMATCH` (a fact about an ACCOUNT) or into
 * `OUTCOME_UNRESOLVED_SUPPORT` (a statement that nothing was established) would report it
 * as something it is not.
 */
export type RedaxMutationPostStateVerdict =
  | 'MATCHING_IMMEDIATE_STATE'
  | 'LANDED_EXACT_BUT_POST_STATE_SUPERSEDED'
  | 'FINALIZED_LANDED_FAILURE'
  | 'LANDED_MESSAGE_MISMATCH'
  | 'PRE_STATE_MISMATCH'
  | 'TARGET_MISMATCH'
  | 'NO_EFFECT'
  | 'READ_UNAVAILABLE'
  | 'OUTCOME_UNRESOLVED_SUPPORT'

/** Sanitized, fixed reason codes. Never a raw error, address, endpoint or byte. */
export type RedaxMutationPostStateIssueCode =
  | 'PRE_STATE_UNREADABLE'
  | 'PRE_STATE_NOT_ADMISSIBLE'
  | 'CAMPAIGN_UNREADABLE'
  | 'CAMPAIGN_ABSENT'
  | 'CAMPAIGN_PDA_NOT_SELF_CONSISTENT'
  | 'CAMPAIGN_IDENTITY_MISMATCH'
  | 'TARGET_ACCOUNT_UNREADABLE'
  | 'TARGET_ACCOUNT_ABSENT'
  | 'TARGET_ACCOUNT_MISMATCH'
  | 'METADATA_ACCOUNT_UNREADABLE'
  | 'METADATA_ATTRIBUTION_MISMATCH'
  | 'TOKEN_CONFIG_COUNT_UNEXPECTED'
  | 'LANDED_MESSAGE_UNREADABLE'
  | 'LANDED_MESSAGE_NOT_EXACT'
  | 'TRANSACTION_FAILED_ON_CHAIN'
  | 'POST_STATE_SUPERSEDED'
  | 'EFFECT_ORIGIN_NOT_PROVEN'
  | 'READ_UNAVAILABLE'

/**
 * The judgment.
 *
 * `payer` is `null` unless a `FINALIZED_EXACT` attestation was supplied, and then it is
 * that landed message's account key slot 0 and nothing else. Because every success verdict
 * requires that attestation, a success always carries one — which is what discharges
 * effect origin rather than deferring it.
 */
export interface RedaxMutationPostStateV1 {
  readonly verdict: RedaxMutationPostStateVerdict
  readonly payer: string | null
  readonly issueCodes: readonly RedaxMutationPostStateIssueCode[]
}

// --- Internals ------------------------------------------------------------------

function verdictOf(
  value: RedaxMutationPostStateVerdict,
  payer: string | null,
  issueCodes: readonly RedaxMutationPostStateIssueCode[],
): RedaxMutationPostStateV1 {
  return Object.freeze({ verdict: value, payer, issueCodes: Object.freeze([...issueCodes]) })
}

/**
 * The payer, and ONLY from account key slot 0 of an exact finalized landed message.
 *
 * A Campaign has no payer field, so there is nowhere else this could honestly come from.
 * Any other attestation yields `null` — never a best guess, and never a value lifted out of
 * an account body.
 */
function payerFrom(attestation: RedaxMutationTransactionAttestationV1): string | null {
  if (attestation.kind !== 'FINALIZED_EXACT') {
    return null
  }
  const slotZero = attestation.accountKeys[0]
  return typeof slotZero === 'string' && slotZero.length > 0 ? slotZero : null
}

type CampaignStatus = 'initialized' | 'active' | 'paused' | 'finalized'

/**
 * Every status legally reachable FROM a given status by later mutations.
 *
 * The program's lifecycle graph, written out: `initialized -> active`, `active <-> paused`,
 * and `active | paused -> finalized`, with `finalized` terminal. A status is included in
 * its own reachable set, because "nothing further happened" is the ordinary case.
 *
 * This is what separates a supersession from an unexplained difference. `finalized`
 * reaches only itself, so a finalize whose campaign is not finalized can never be
 * explained away — and an activate whose campaign is back to `initialized` cannot either,
 * because nothing legal moves a campaign backwards.
 */
const REACHABLE_FROM: Readonly<Record<CampaignStatus, readonly CampaignStatus[]>> = Object.freeze({
  initialized: Object.freeze(['initialized', 'active', 'paused', 'finalized'] as const),
  active: Object.freeze(['active', 'paused', 'finalized'] as const),
  paused: Object.freeze(['paused', 'active', 'finalized'] as const),
  finalized: Object.freeze(['finalized'] as const),
})

function statusExplainableAsLaterLegal(expected: CampaignStatus, current: CampaignStatus): boolean {
  const reachable = REACHABLE_FROM[expected]
  return reachable !== undefined && reachable.includes(current)
}

/** Does the observed Campaign agree with the identities this attempt was about? */
function campaignIdentityMatches(
  facts: RedaxMutationCampaignFactsV1,
  expectation: RedaxMutationExpectationV1,
): boolean {
  return (
    facts.campaignAdmin === expectation.campaignAdmin && facts.outputMint === expectation.outputMint
  )
}

/**
 * Does the observed TokenConfig body equal the one this attempt intended, exactly?
 *
 * The stored `campaign` link is checked too, and it is not redundant with reading the
 * account at the derived address: a structurally valid TokenConfig that names a DIFFERENT
 * campaign is somebody else's account, and every field comparison below would still pass.
 */
function tokenConfigMatches(
  facts: RedaxMutationTokenConfigFactsV1,
  expected: RedaxMutationExpectedTokenConfigV1,
  campaignAddress: string,
): boolean {
  return (
    facts.campaign === campaignAddress &&
    facts.legacyMint === expected.legacyMint &&
    facts.rateNumeratorRaw === expected.rateNumeratorRaw &&
    facts.rateDenominatorRaw === expected.rateDenominatorRaw &&
    facts.maxOutputFromTcRaw === expected.maxOutputFromTcRaw &&
    facts.pdaSelfConsistent
  )
}

/**
 * Does the stored metadata payload equal the EXPECTED PUFFED bytes, exactly?
 *
 * Plus the four permanence facts the REDAX CPI fixes: a zero seller fee, no creators, an
 * unsold primary and — above all — `isMutable = false`. A metadata account that is still
 * mutable is not the account this program creates.
 */
function metadataMatches(
  facts: RedaxMutationMetadataFactsV1,
  expected: RedaxMutationExpectedMetadataV1,
): boolean {
  return (
    facts.updateAuthority === expected.updateAuthority &&
    facts.mint === expected.mint &&
    facts.storedPuffedNameSha256Hex === expected.expectedPuffedNameSha256Hex &&
    facts.storedPuffedSymbolSha256Hex === expected.expectedPuffedSymbolSha256Hex &&
    facts.storedPuffedUriSha256Hex === expected.expectedPuffedUriSha256Hex &&
    facts.storedPuffedNameByteLength === expected.expectedPuffedNameByteLength &&
    facts.storedPuffedSymbolByteLength === expected.expectedPuffedSymbolByteLength &&
    facts.storedPuffedUriByteLength === expected.expectedPuffedUriByteLength &&
    facts.sellerFeeBasisPoints === 0 &&
    !facts.creatorsPresent &&
    facts.creatorCount === 0 &&
    !facts.primarySaleHappened &&
    !facts.isMutable
  )
}

// --- The judgment ---------------------------------------------------------------

/**
 * Turn one coherent observation, one transaction attestation and one expectation into
 * exactly one verdict.
 *
 * TOTAL AND PURE: every input combination produces a verdict, nothing throws, nothing is
 * read, nothing is written, and the same inputs always produce the same answer.
 *
 * THE ORDER IS THE ARGUMENT:
 *
 *   1. The TRANSACTION is judged first, because no arrangement of accounts can overturn a
 *      proven message mismatch or a proven on-chain failure, and no arrangement of accounts
 *      can supply the attribution a success needs.
 *   2. The read FLOOR is then required. A post-state observed below
 *      `max(preflightContextSlot, transactionSlot)` may predate the transaction entirely,
 *      and reading one as a post-state is how a straddle becomes a false conclusion.
 *   3. An unreadable or absent Campaign is `READ_UNAVAILABLE` or `NO_EFFECT` — and
 *      unreadable is never absent.
 *   4. The operation's own target is judged on its own terms.
 *   5. A difference reachable by legal later mutations is a SUPERSESSION.
 *   6. Anything else is `OUTCOME_UNRESOLVED_SUPPORT`. It is never a resend.
 */
export function assessRedaxTeamAdminMutationPostState(
  observation: RedaxMutationCoherentObservationV1,
  attestation: RedaxMutationTransactionAttestationV1,
  expectation: RedaxMutationExpectationV1,
): RedaxMutationPostStateV1 {
  // 1. THE TRANSACTION, first and on its own terms.
  if (attestation.kind === 'LANDED_MESSAGE_MISMATCH') {
    return verdictOf('LANDED_MESSAGE_MISMATCH', null, ['LANDED_MESSAGE_NOT_EXACT'])
  }
  if (attestation.kind === 'FINALIZED_FAILED') {
    // The intended message landed and the transaction failed. That is terminal and it is
    // knowable, so it is not an unresolved outcome.
    return verdictOf('FINALIZED_LANDED_FAILURE', null, ['TRANSACTION_FAILED_ON_CHAIN'])
  }
  if (attestation.kind === 'UNAVAILABLE') {
    return verdictOf('READ_UNAVAILABLE', null, ['LANDED_MESSAGE_UNREADABLE'])
  }
  if (attestation.kind === 'NOT_APPLICABLE') {
    // No retained signature, so nothing can be attributed to this attempt in either
    // direction. Explicitly NOT `NO_EFFECT`: the absence of a handle is not evidence that
    // nothing happened.
    return verdictOf('OUTCOME_UNRESOLVED_SUPPORT', null, ['EFFECT_ORIGIN_NOT_PROVEN'])
  }

  const payer = payerFrom(attestation)
  if (payer === null) {
    // An exact finalized message whose slot 0 could not be read. The conjunction is
    // incomplete, so no success verdict is available.
    return verdictOf('OUTCOME_UNRESOLVED_SUPPORT', null, ['EFFECT_ORIGIN_NOT_PROVEN'])
  }

  // 2. THE FLOOR. A read below it may predate the transaction.
  if (
    !Number.isSafeInteger(observation.contextSlot) ||
    !Number.isSafeInteger(expectation.finalizedFloorSlot) ||
    observation.contextSlot < expectation.finalizedFloorSlot
  ) {
    return verdictOf('READ_UNAVAILABLE', payer, ['READ_UNAVAILABLE'])
  }

  // 3. THE CAMPAIGN.
  if (observation.campaign.presence === 'UNREADABLE') {
    return verdictOf('READ_UNAVAILABLE', payer, ['CAMPAIGN_UNREADABLE'])
  }
  if (observation.campaign.presence === 'ABSENT') {
    // The Campaign this mutation was about is gone. A post-init mutation cannot have
    // created it and cannot have removed it, so nothing here is explained.
    return verdictOf('NO_EFFECT', payer, ['CAMPAIGN_ABSENT'])
  }
  const campaign = observation.campaign.facts
  if (!campaign.pdaSelfConsistent) {
    return verdictOf('TARGET_MISMATCH', payer, ['CAMPAIGN_PDA_NOT_SELF_CONSISTENT'])
  }
  if (!campaignIdentityMatches(campaign, expectation)) {
    return verdictOf('TARGET_MISMATCH', payer, ['CAMPAIGN_IDENTITY_MISMATCH'])
  }

  const expected = expectation.expectedPostState
  const issues: RedaxMutationPostStateIssueCode[] = []
  let superseded = false

  // 4. THE OPERATION'S OWN TARGET.
  if (expectation.operation === 'ADD_TOKEN_CONFIG') {
    const target = observation.tokenConfig
    const expectedConfig = expectation.expectedTokenConfig
    if (target === null || expectedConfig === null) {
      return verdictOf('OUTCOME_UNRESOLVED_SUPPORT', payer, ['TARGET_ACCOUNT_UNREADABLE'])
    }
    if (target.presence === 'UNREADABLE') {
      return verdictOf('READ_UNAVAILABLE', payer, ['TARGET_ACCOUNT_UNREADABLE'])
    }
    if (target.presence === 'ABSENT') {
      // The exact message landed and finalized without error, and the account it creates
      // is not there. Nothing legal removes a TokenConfig, so this is not explainable.
      return verdictOf('OUTCOME_UNRESOLVED_SUPPORT', payer, ['TARGET_ACCOUNT_ABSENT'])
    }
    if (!tokenConfigMatches(target.facts, expectedConfig, expectation.campaign)) {
      return verdictOf('TARGET_MISMATCH', payer, ['TARGET_ACCOUNT_MISMATCH'])
    }
    // COUNT. Later legal additions can only INCREASE it; it can never fall.
    if (campaign.tokenConfigCount < expected.tokenConfigCount) {
      return verdictOf('OUTCOME_UNRESOLVED_SUPPORT', payer, ['TOKEN_CONFIG_COUNT_UNEXPECTED'])
    }
    if (campaign.tokenConfigCount > expected.tokenConfigCount) {
      superseded = true
      issues.push('POST_STATE_SUPERSEDED')
    }
  } else if (expectation.operation === 'SETUP_METADATA') {
    const target = observation.metadata
    const expectedMetadata = expectation.expectedMetadata
    if (target === null || expectedMetadata === null) {
      return verdictOf('OUTCOME_UNRESOLVED_SUPPORT', payer, ['METADATA_ACCOUNT_UNREADABLE'])
    }
    if (target.presence === 'UNREADABLE') {
      return verdictOf('READ_UNAVAILABLE', payer, ['METADATA_ACCOUNT_UNREADABLE'])
    }
    if (target.presence === 'ABSENT') {
      return verdictOf('OUTCOME_UNRESOLVED_SUPPORT', payer, ['TARGET_ACCOUNT_ABSENT'])
    }
    if (!metadataMatches(target.facts, expectedMetadata)) {
      // Metadata is created once and is immutable, so a stored payload that differs from
      // the expected puffed bytes is not this attempt's effect at all.
      return verdictOf('TARGET_MISMATCH', payer, ['METADATA_ATTRIBUTION_MISMATCH'])
    }
    if (!campaign.metadataSetup) {
      // The account exists and matches, but the Campaign does not agree that metadata is
      // set. Nothing legal moves that flag back, so this is unexplained.
      return verdictOf('OUTCOME_UNRESOLVED_SUPPORT', payer, ['TARGET_ACCOUNT_MISMATCH'])
    }
  }

  // 5. THE CAMPAIGN'S OWN EXPECTED POST-STATE, and whether any difference is explainable.
  if (campaign.metadataSetup !== expected.metadataSetup) {
    if (expected.metadataSetup && !campaign.metadataSetup) {
      // `true -> false` is not a legal transition in either direction of time.
      return verdictOf('OUTCOME_UNRESOLVED_SUPPORT', payer, ['TARGET_ACCOUNT_MISMATCH'])
    }
    // `false -> true`: a later legal `setup_metadata` landed after this attempt.
    superseded = true
    if (!issues.includes('POST_STATE_SUPERSEDED')) {
      issues.push('POST_STATE_SUPERSEDED')
    }
  }

  if (campaign.status !== expected.campaignStatus) {
    if (!statusExplainableAsLaterLegal(expected.campaignStatus, campaign.status)) {
      return verdictOf('OUTCOME_UNRESOLVED_SUPPORT', payer, ['TARGET_ACCOUNT_MISMATCH'])
    }
    superseded = true
    if (!issues.includes('POST_STATE_SUPERSEDED')) {
      issues.push('POST_STATE_SUPERSEDED')
    }
  }

  if (
    expectation.operation !== 'ADD_TOKEN_CONFIG' &&
    campaign.tokenConfigCount !== expected.tokenConfigCount
  ) {
    if (campaign.tokenConfigCount < expected.tokenConfigCount) {
      return verdictOf('OUTCOME_UNRESOLVED_SUPPORT', payer, ['TOKEN_CONFIG_COUNT_UNEXPECTED'])
    }
    superseded = true
    if (!issues.includes('POST_STATE_SUPERSEDED')) {
      issues.push('POST_STATE_SUPERSEDED')
    }
  }

  // 6. THE TWO TERMINAL SUCCESS SHAPES. Both are terminal; neither is retry authority.
  if (superseded) {
    return verdictOf('LANDED_EXACT_BUT_POST_STATE_SUPERSEDED', payer, issues)
  }
  // A clean, complete, fully attributed immediate match. The issue-code set is EMPTY by
  // construction — every path that would have added one returned above.
  return verdictOf('MATCHING_IMMEDIATE_STATE', payer, [])
}
