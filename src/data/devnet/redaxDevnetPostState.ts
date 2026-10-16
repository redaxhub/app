// REDAX Team/Admin S1 post-state — a pure, total judgment over injected observations.
//
// -----------------------------------------------------------------------------
// BOUNDARY
// -----------------------------------------------------------------------------
// ZERO IMPORTS. No React, no `Connection`, no `Transaction`, no `PublicKey`, no
// keypair, no `localStorage`, no RPC, no wallet, no clock, no entropy, no I/O and no
// logging. It reads nothing and writes nothing: an observation is handed to it as
// plain serializable DATA, and a verdict comes back. Performing the reads is the
// caller's job, in the data layer that already owns a `Connection`.
//
// -----------------------------------------------------------------------------
// WHY THIS EXISTS
// -----------------------------------------------------------------------------
// S1 is one atomic four-instruction transaction. It either creates the Campaign, the
// output mint and the canonical fee vault together, or it creates nothing. The
// dangerous case is the third one: an attempt whose outcome nobody knows, where the
// only safe next step depends on what is actually on chain right now.
//
// Every rule here exists to keep the three genuinely different situations apart:
//
//   * WE COULD NOT FIND OUT              -> READ_UNAVAILABLE
//   * NOTHING IS THERE                   -> NO_STATE
//   * SOMETHING IS THERE, BUT NOT OURS   -> CAMPAIGN_MISMATCH / ORPHAN_RESIDUE /
//                                           PROTOCOL_CONFIG_CHANGED /
//                                           LANDED_MESSAGE_MISMATCH
//
// `READ_UNAVAILABLE` NEVER BECOMES `NO_STATE`. That single collapse is what would let
// a caller conclude "nothing happened" from "the RPC did not answer", and then create
// a second mint whose authority points at a Campaign PDA the first one already
// stranded.
//
// -----------------------------------------------------------------------------
// WHAT IT DELIBERATELY CANNOT DO
// -----------------------------------------------------------------------------
// It authorizes nothing. There is no retry verdict, no "safe to send", no resend and
// no plan mutation: the vocabulary below describes what was observed and stops there.
// A payer is reported ONLY when the caller supplied an EXACT landed message, and then
// only from that message's account key slot 0 — the Campaign has no payer field, and
// inventing one would be fabricating provenance out of an account body that never
// carried it.

// --- Injected observation vocabulary (re-declared, never imported) -------------

/**
 * What one planned account was observed to be.
 *
 * THREE ANSWERS, NEVER TWO. `UNREADABLE` is not `ABSENT`, anywhere, ever.
 */
export type RedaxS1AccountObservation<TFacts> =
  | { readonly presence: 'ABSENT' }
  | { readonly presence: 'PRESENT'; readonly facts: TFacts }
  | { readonly presence: 'UNREADABLE'; readonly code: string }

/** The canonical ProtocolConfig fact this judgment consumes. */
export interface RedaxS1ProtocolConfigFactsV1 {
  readonly protocolFeeAuthority: string
}

/** The public Campaign body, exactly as the coherent adapter read produces it. */
export interface RedaxS1CampaignFactsV1 {
  readonly campaignAdmin: string
  readonly outputGovernance: string
  readonly outputMint: string
  readonly protocolFeeVault: string
  readonly status: string
  readonly metadataSetup: boolean
  readonly discoveryStatus: number
  readonly bump: number
  readonly saltHex: string
  readonly endTs: string | null
  readonly maxOutputSupplyRaw: string
  readonly totalOutputMintedRaw: string
  readonly totalProtocolFeesMintedRaw: string
  /** Did `[b"campaign", output_governance, salt]` re-derive to the read address? */
  readonly pdaSelfConsistent: boolean
}

/** The output mint facts this judgment consumes. */
export interface RedaxS1OutputMintFactsV1 {
  readonly decimals: number
  readonly supplyRaw: string
  readonly mintAuthority: string | null
  readonly freezeAuthority: string | null
}

/** The canonical fee vault fact this judgment consumes. */
export interface RedaxS1FeeVaultFactsV1 {
  readonly amountRaw: string
}

/** One coherent, slot-consistent observation of the four planned S1 accounts. */
export interface RedaxS1CoherentObservationV1 {
  readonly protocolConfig: RedaxS1AccountObservation<RedaxS1ProtocolConfigFactsV1>
  readonly campaign: RedaxS1AccountObservation<RedaxS1CampaignFactsV1>
  readonly outputMint: RedaxS1AccountObservation<RedaxS1OutputMintFactsV1>
  readonly protocolFeeVault: RedaxS1AccountObservation<RedaxS1FeeVaultFactsV1>
}

/**
 * What the caller established about the landed compiled message, as injected DATA.
 *
 * Supplied rather than computed on purpose: the generic transaction-outcome module is
 * the exact-message authority and it stays byte-identical, so this judgment consumes
 * its conclusion instead of acquiring it. That keeps the boundary narrow — this
 * module never fetches a transaction, never compares message bytes and never learns
 * what an RPC said.
 *
 *   * `NOT_APPLICABLE` — no signature is known, so no landed message was ever sought.
 *   * `UNAVAILABLE`    — one was sought and could not be read. Never a conclusion.
 *   * `MISMATCH`       — a message landed and it is NOT the approved one. Terminal.
 *   * `EXACT`          — the approved message landed, byte for byte.
 */
export type RedaxS1LandedMessageAssessmentV1 =
  | { readonly kind: 'NOT_APPLICABLE' }
  | { readonly kind: 'UNAVAILABLE' }
  | { readonly kind: 'MISMATCH' }
  | { readonly kind: 'EXACT'; readonly accountKeys: readonly string[] }

/**
 * Exactly the frozen-plan facts a post-state comparison is made against.
 *
 * Public identities and canonical decimal strings only — the same spellings the
 * frozen plan already carries, so the comparison is plain equality rather than a
 * conversion nobody can audit.
 */
export interface RedaxS1PlanExpectationV1 {
  readonly campaign: string
  readonly campaignAdmin: string
  readonly outputGovernance: string
  readonly outputMint: string
  readonly outputMintDecimals: number
  readonly outputMintAuthority: string
  readonly protocolFeeVault: string
  readonly protocolFeeAuthority: string
  readonly saltHex: string
  readonly endTs: string | null
  readonly maxOutputSupply: string
}

// --- The verdict vocabulary ----------------------------------------------------

/** The exact, closed result vocabulary. There is no eighth verdict. */
export type RedaxS1PostStateVerdict =
  | 'MATCHING_COMPLETE_STATE'
  | 'CAMPAIGN_MISMATCH'
  | 'ORPHAN_RESIDUE'
  | 'NO_STATE'
  | 'READ_UNAVAILABLE'
  | 'PROTOCOL_CONFIG_CHANGED'
  | 'LANDED_MESSAGE_MISMATCH'

/** Sanitized, fixed reason codes. Never a raw error, address, endpoint or byte. */
export type RedaxS1PostStateIssueCode =
  | 'PROTOCOL_CONFIG_UNREADABLE'
  | 'PROTOCOL_CONFIG_ABSENT'
  | 'PROTOCOL_FEE_AUTHORITY_CHANGED'
  | 'CAMPAIGN_UNREADABLE'
  | 'CAMPAIGN_PDA_NOT_SELF_CONSISTENT'
  | 'CAMPAIGN_IDENTITY_MISMATCH'
  | 'CAMPAIGN_TERMS_MISMATCH'
  | 'OUTPUT_MINT_UNREADABLE'
  | 'OUTPUT_MINT_ABSENT'
  | 'OUTPUT_MINT_MISMATCH'
  | 'OUTPUT_MINT_RESIDUE'
  | 'PROTOCOL_FEE_VAULT_UNREADABLE'
  | 'PROTOCOL_FEE_VAULT_ABSENT'
  | 'PROTOCOL_FEE_VAULT_RESIDUE'
  | 'LANDED_MESSAGE_UNREADABLE'
  | 'LANDED_MESSAGE_NOT_EXACT'
  | 'EFFECT_ORIGIN_NOT_PROVEN'

/**
 * The judgment.
 *
 * `payer` is `null` unless an EXACT landed message was supplied, and then it is that
 * message's account key slot 0 and nothing else. A `MATCHING_COMPLETE_STATE` carrying
 * a `null` payer additionally carries `EFFECT_ORIGIN_NOT_PROVEN`: the planned state is
 * there, and this judgment has NOT established that this attempt created it.
 */
export interface RedaxS1PostStateV1 {
  readonly verdict: RedaxS1PostStateVerdict
  readonly payer: string | null
  readonly issueCodes: readonly RedaxS1PostStateIssueCode[]
}

// --- Internals ------------------------------------------------------------------

function verdict(
  value: RedaxS1PostStateVerdict,
  payer: string | null,
  issueCodes: readonly RedaxS1PostStateIssueCode[],
): RedaxS1PostStateV1 {
  return Object.freeze({ verdict: value, payer, issueCodes: Object.freeze([...issueCodes]) })
}

/**
 * The payer, and ONLY from account key slot 0 of an exact landed message.
 *
 * A Campaign has no payer field, so there is nowhere else this could honestly come
 * from. A non-exact, unavailable or inapplicable assessment yields `null` — never a
 * best guess, and never a value lifted out of an account body.
 */
function payerFromLandedMessage(assessment: RedaxS1LandedMessageAssessmentV1): string | null {
  if (assessment.kind !== 'EXACT') {
    return null
  }
  const slotZero = assessment.accountKeys[0]
  if (typeof slotZero !== 'string' || slotZero.length === 0) {
    return null
  }
  return slotZero
}

/** Does the observed Campaign body agree with the plan on every identity it names? */
function campaignIdentityMatches(
  facts: RedaxS1CampaignFactsV1,
  plan: RedaxS1PlanExpectationV1,
): boolean {
  return (
    facts.campaignAdmin === plan.campaignAdmin &&
    facts.outputGovernance === plan.outputGovernance &&
    facts.outputMint === plan.outputMint &&
    facts.protocolFeeVault === plan.protocolFeeVault &&
    facts.saltHex === plan.saltHex
  )
}

/**
 * Does it agree on the terms the plan froze?
 *
 * Deliberately NOT `status`, `metadataSetup`, `discoveryStatus` or any counter. Those
 * advance legitimately through the later lifecycle steps, and comparing them would
 * make a Campaign that S1 created and a later gate advanced look like somebody else's.
 */
function campaignTermsMatch(
  facts: RedaxS1CampaignFactsV1,
  plan: RedaxS1PlanExpectationV1,
): boolean {
  return facts.endTs === plan.endTs && facts.maxOutputSupplyRaw === plan.maxOutputSupply
}

/** Is this the output mint the plan describes, under the authority it requires? */
function outputMintMatches(
  facts: RedaxS1OutputMintFactsV1,
  plan: RedaxS1PlanExpectationV1,
): boolean {
  return (
    facts.decimals === plan.outputMintDecimals &&
    facts.mintAuthority !== null &&
    facts.mintAuthority === plan.outputMintAuthority &&
    facts.freezeAuthority === null
  )
}

// --- The judgment ---------------------------------------------------------------

/**
 * Turn one coherent observation, one landed-message assessment and one frozen-plan
 * expectation into exactly one verdict.
 *
 * TOTAL and PURE: every input combination produces a verdict, nothing throws, nothing
 * is read, nothing is written, and the same inputs always produce the same answer.
 *
 * THE ORDER IS THE ARGUMENT, and each step is here because collapsing it would be a
 * real failure rather than a tidier function:
 *
 *   1. A PROVEN landed-message mismatch is terminal on its own. Something other than
 *      the approved message landed under this signature; no arrangement of accounts
 *      makes that a success, and the account reads cannot overturn it.
 *   2. A Campaign that IS there is judged next, on its own terms. It can never be a
 *      `NO_STATE`, an `ORPHAN_RESIDUE` or a bare configuration change — a Campaign
 *      exists at the planned address, and every disagreement about it is terminal.
 *   3. An unreadable slot becomes `READ_UNAVAILABLE`, never an absence.
 *   4. With NO Campaign, on-chain RESIDUE outranks everything else, because acting as
 *      though nothing exists is exactly what creates a second orphan.
 *   5. Only then does a changed ProtocolConfig mark the old plan dead.
 *   6. And only a complete, coherent, fully readable nothing is `NO_STATE`.
 */
export function assessRedaxTeamAdminS1PostState(
  observation: RedaxS1CoherentObservationV1,
  landedMessage: RedaxS1LandedMessageAssessmentV1,
  plan: RedaxS1PlanExpectationV1,
): RedaxS1PostStateV1 {
  // 1. A proven mismatch of the exact approved message. Terminal, and independent of
  //    what any account currently looks like.
  if (landedMessage.kind === 'MISMATCH') {
    return verdict('LANDED_MESSAGE_MISMATCH', null, ['LANDED_MESSAGE_NOT_EXACT'])
  }

  const payer = payerFromLandedMessage(landedMessage)

  // 2. A Campaign at the planned address.
  if (observation.campaign.presence === 'PRESENT') {
    const facts = observation.campaign.facts
    const issues: RedaxS1PostStateIssueCode[] = []
    if (!facts.pdaSelfConsistent) {
      issues.push('CAMPAIGN_PDA_NOT_SELF_CONSISTENT')
    }
    if (!campaignIdentityMatches(facts, plan)) {
      issues.push('CAMPAIGN_IDENTITY_MISMATCH')
    }
    if (!campaignTermsMatch(facts, plan)) {
      issues.push('CAMPAIGN_TERMS_MISMATCH')
    }
    if (
      observation.protocolConfig.presence === 'PRESENT' &&
      observation.protocolConfig.facts.protocolFeeAuthority !== plan.protocolFeeAuthority
    ) {
      // A Campaign IS present, so this is not the no-Campaign disposition: a config
      // that moved under an existing Campaign is a terminal support case, never a
      // "the old plan is simply dead" one.
      issues.push('PROTOCOL_FEE_AUTHORITY_CHANGED')
    }
    if (issues.length > 0) {
      return verdict('CAMPAIGN_MISMATCH', payer, issues)
    }

    // Nothing disagrees. Completeness now has to be PROVEN, and an unreadable
    // supporting account proves nothing at all.
    if (observation.protocolConfig.presence === 'UNREADABLE') {
      return verdict('READ_UNAVAILABLE', payer, ['PROTOCOL_CONFIG_UNREADABLE'])
    }
    if (observation.outputMint.presence === 'UNREADABLE') {
      return verdict('READ_UNAVAILABLE', payer, ['OUTPUT_MINT_UNREADABLE'])
    }
    if (observation.protocolFeeVault.presence === 'UNREADABLE') {
      return verdict('READ_UNAVAILABLE', payer, ['PROTOCOL_FEE_VAULT_UNREADABLE'])
    }
    if (landedMessage.kind === 'UNAVAILABLE') {
      return verdict('READ_UNAVAILABLE', payer, ['LANDED_MESSAGE_UNREADABLE'])
    }
    if (observation.protocolConfig.presence === 'ABSENT') {
      return verdict('CAMPAIGN_MISMATCH', payer, ['PROTOCOL_CONFIG_ABSENT'])
    }
    if (observation.outputMint.presence === 'ABSENT') {
      // A Campaign whose output mint is not there is incoherent, and it is emphatically
      // not a success.
      return verdict('CAMPAIGN_MISMATCH', payer, ['OUTPUT_MINT_ABSENT'])
    }
    if (!outputMintMatches(observation.outputMint.facts, plan)) {
      return verdict('CAMPAIGN_MISMATCH', payer, ['OUTPUT_MINT_MISMATCH'])
    }
    if (observation.protocolFeeVault.presence === 'ABSENT') {
      return verdict('CAMPAIGN_MISMATCH', payer, ['PROTOCOL_FEE_VAULT_ABSENT'])
    }

    // Complete and coherent. If no exact landed message tied it to this attempt, say
    // so in the record rather than letting a null payer pass unremarked.
    return verdict(
      'MATCHING_COMPLETE_STATE',
      payer,
      payer === null ? ['EFFECT_ORIGIN_NOT_PROVEN'] : [],
    )
  }

  // 3. The Campaign slot itself could not be read. Absence is not proven, so nothing
  //    downstream may be concluded from it.
  if (observation.campaign.presence === 'UNREADABLE') {
    return verdict('READ_UNAVAILABLE', payer, ['CAMPAIGN_UNREADABLE'])
  }

  // --- From here on the Campaign is provably ABSENT. ---

  // A residue slot we could not read is not "no residue".
  if (observation.outputMint.presence === 'UNREADABLE') {
    return verdict('READ_UNAVAILABLE', payer, ['OUTPUT_MINT_UNREADABLE'])
  }
  if (observation.protocolFeeVault.presence === 'UNREADABLE') {
    return verdict('READ_UNAVAILABLE', payer, ['PROTOCOL_FEE_VAULT_UNREADABLE'])
  }

  // 4. Residue outranks every other no-Campaign disposition.
  const residue: RedaxS1PostStateIssueCode[] = []
  if (observation.outputMint.presence === 'PRESENT') {
    residue.push('OUTPUT_MINT_RESIDUE')
  }
  if (observation.protocolFeeVault.presence === 'PRESENT') {
    residue.push('PROTOCOL_FEE_VAULT_RESIDUE')
  }
  if (residue.length > 0) {
    return verdict('ORPHAN_RESIDUE', payer, residue)
  }

  // 5. No Campaign and no residue: is the plan still the plan?
  if (observation.protocolConfig.presence === 'UNREADABLE') {
    return verdict('READ_UNAVAILABLE', payer, ['PROTOCOL_CONFIG_UNREADABLE'])
  }
  if (observation.protocolConfig.presence === 'ABSENT') {
    // The canonical config the plan was built against is not there at all. That is the
    // strongest possible form of "changed", and the old plan is not retry-safe.
    return verdict('PROTOCOL_CONFIG_CHANGED', payer, ['PROTOCOL_CONFIG_ABSENT'])
  }
  if (observation.protocolConfig.facts.protocolFeeAuthority !== plan.protocolFeeAuthority) {
    return verdict('PROTOCOL_CONFIG_CHANGED', payer, ['PROTOCOL_FEE_AUTHORITY_CHANGED'])
  }

  // 6. A landed message that was sought and not obtained is still an unknown.
  if (landedMessage.kind === 'UNAVAILABLE') {
    return verdict('READ_UNAVAILABLE', payer, ['LANDED_MESSAGE_UNREADABLE'])
  }

  // Nothing is there, everything was readable, and the plan's configuration still
  // holds. This — and only this — is `NO_STATE`.
  return verdict('NO_STATE', payer, [])
}
