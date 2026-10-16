// REDAX holder TokenConfig selection — a pure, explicit, fail-closed resolver.
//
// Boundary: pure data and comparison. No React, no wallet, no data source, no RPC,
// no Anchor/web3/SPL/IDL, no network, no persistence, no clock. Every export is a
// plain type or a total function; nothing here throws and nothing here submits.
//
// WHY THIS EXISTS. A conversion burns a holder's real tokens. Exactly ONE
// TokenConfig — and therefore exactly one legacy mint, one rate and one cap —
// decides what is burned and what is minted, and the holder must have chosen it
// EXPLICITLY. So this resolver requires the caller to name a TokenConfig id and
// refuses to invent one:
//
//   * it never falls back to the campaign's "primary" input;
//   * it never falls back to the first eligible input;
//   * it never returns more than one selection;
//   * it never batches.
//
// Anything ambiguous — an id that is absent, duplicated, belongs to another
// campaign, is not eligible, or whose legacy mint disagrees with what the caller
// expected — is a typed failure, not a guess. Failing closed here is much cheaper
// than burning the wrong token.
//
// The invariant it preserves, end to end:
//
//   one explicit TokenConfig
//     -> one legacy mint
//       -> one convert_exact_in instruction
//         -> one wallet transaction        (never a batch)

/**
 * The minimum a candidate must expose to be selectable. Deliberately structural
 * and narrow — `RedaxTokenConfigView` (app/src/data/redaxViewModels.ts) already
 * satisfies it, so the real loaded views can be passed straight in without this
 * module depending on the data layer.
 */
export interface RedaxSelectableTokenConfig {
  readonly id: string
  readonly campaignId: string
  readonly legacyMint: string
  readonly outputMint: string
}

/** Exactly one resolved, explicitly chosen TokenConfig. */
export interface RedaxTokenConfigSelectionV1 {
  readonly campaignId: string
  readonly tokenConfigId: string
  readonly legacyMint: string
  readonly outputMint: string
}

export type RedaxTokenConfigSelectionErrorCode =
  | 'NO_TOKEN_CONFIG_REQUESTED'
  | 'TOKEN_CONFIG_NOT_FOUND'
  | 'TOKEN_CONFIG_WRONG_CAMPAIGN'
  | 'TOKEN_CONFIG_DUPLICATE_ID'
  | 'TOKEN_CONFIG_NOT_ELIGIBLE'
  | 'LEGACY_MINT_MISMATCH'

export type RedaxTokenConfigSelectionResult =
  | { readonly ok: true; readonly selection: RedaxTokenConfigSelectionV1 }
  | { readonly ok: false; readonly code: RedaxTokenConfigSelectionErrorCode }

export interface RedaxTokenConfigSelectionRequest {
  /** The campaign the holder is converting within. */
  readonly campaignId: string
  /** The TokenConfig the holder EXPLICITLY chose. Never defaulted. */
  readonly requestedTokenConfigId: string | null
  /** The loaded candidates. May contain configs of other campaigns; they are refused. */
  readonly candidates: readonly RedaxSelectableTokenConfig[]
  /**
   * When supplied, the ids the holder is actually allowed to convert through (e.g.
   * the inputs they hold a balance in). An id outside this set is refused rather
   * than silently converted.
   */
  readonly eligibleTokenConfigIds?: readonly string[]
  /**
   * When supplied, the legacy mint the CALLER believes it is burning. If the
   * resolved TokenConfig disagrees, the selection is refused — this is the guard
   * against a stale UI selection pointing at a reloaded, different TokenConfig.
   */
  readonly expectedLegacyMint?: string
}

/**
 * Resolve exactly one explicitly requested TokenConfig, or fail closed.
 *
 * Total and pure. Never falls back, never guesses, never returns a batch.
 */
export function selectRedaxTokenConfig(
  request: RedaxTokenConfigSelectionRequest,
): RedaxTokenConfigSelectionResult {
  const {
    campaignId,
    requestedTokenConfigId,
    candidates,
    eligibleTokenConfigIds,
    expectedLegacyMint,
  } = request

  // An absent choice is NOT an invitation to pick one.
  if (requestedTokenConfigId === null || requestedTokenConfigId.trim() === '') {
    return { ok: false, code: 'NO_TOKEN_CONFIG_REQUESTED' }
  }

  const matches = candidates.filter((candidate) => candidate.id === requestedTokenConfigId)

  if (matches.length === 0) {
    return { ok: false, code: 'TOKEN_CONFIG_NOT_FOUND' }
  }
  // An ambiguous id cannot identify "one" TokenConfig, so it identifies none.
  if (matches.length > 1) {
    return { ok: false, code: 'TOKEN_CONFIG_DUPLICATE_ID' }
  }

  const selected = matches[0]

  if (selected.campaignId !== campaignId) {
    return { ok: false, code: 'TOKEN_CONFIG_WRONG_CAMPAIGN' }
  }

  if (
    eligibleTokenConfigIds !== undefined &&
    !eligibleTokenConfigIds.includes(selected.id)
  ) {
    return { ok: false, code: 'TOKEN_CONFIG_NOT_ELIGIBLE' }
  }

  if (expectedLegacyMint !== undefined && selected.legacyMint !== expectedLegacyMint) {
    return { ok: false, code: 'LEGACY_MINT_MISMATCH' }
  }

  return {
    ok: true,
    selection: {
      campaignId: selected.campaignId,
      tokenConfigId: selected.id,
      legacyMint: selected.legacyMint,
      outputMint: selected.outputMint,
    },
  }
}
