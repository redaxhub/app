// REDAX devnet single-transaction convert receipt decoder (Tier 1).
//
// Boundary: this module decodes exactly ONE just-executed convert_exact_in
// transaction's on-chain `Converted` event into a bounded receipt, reconciled
// against the caller's expected convert context.
//
// It is ONE OF EXACTLY TWO app-source files that may call `getTransaction`. It is
// NOT the outcome authority: `app/src/wallet/redaxTransactionOutcome.ts` owns the
// status / landed-message / meta question and decides what a signature is worth.
// This file only decodes the `Converted` event of a signature whose action has
// ALREADY resolved as a finalized success, so it runs strictly DOWNSTREAM of that
// decision and can neither create, preserve, block nor overturn it. A third owner
// would be a second, unreviewed answer to "what landed?".
//
// The read is `finalized`, matching the finality the action must already have
// proven — a `confirmed` read here could decode a block that is still reorganisable
// and present it beside a finalized success.
//
// It performs no signature-history lookup, no recent-history scan, and no indexer
// behavior — a single transaction is one receipt, never receipt history. It sends
// no transaction, signs nothing, creates no account, installs no package (uses the
// already-declared `@coral-xyz/anchor` + `@solana/web3.js` + the committed REDAX
// IDL), attaches no explorer link, and logs no raw identifier. A `null` return (tx
// not visible, no decodable Converted event, or a hard-identity mismatch) is a
// normal "no receipt this session" — never an error, never a claim that no
// conversion occurred, and never a change to any action outcome, journal state or
// retry truth.

import { BorshCoder, EventParser, type Idl } from '@coral-xyz/anchor'
import { Connection, PublicKey } from '@solana/web3.js'
import { redaxIdlWithProgramId } from '../../idl/redaxProtocolIdl'
import type { RedaxConvertReceiptRequest } from '../redaxDataSource'
import type {
  RedaxConvertReceiptVerificationView,
  RedaxReceiptIdentity,
  RedaxReceiptView,
} from '../redaxViewModels'

// IDL event name for the canonical Phase 1 convert event.
const CONVERTED_EVENT_NAME = 'Converted'

/** Read-only dependencies for one receipt decode. `connection` is injected. */
export interface RedaxDevnetConvertReceiptDeps {
  connection: Connection
  programId: string
}

// Casing-resilient field read: the committed IDL is snake_case, but a decoder may
// surface camelCase — mirrors the account-helper `pick()` convention.
function pick(data: Record<string, unknown>, camel: string, snake: string): unknown {
  return data[camel] !== undefined ? data[camel] : data[snake]
}

// A borsh numeric (BN / bigint / number / string) as a base-10 decimal string.
// Never floating point; missing values normalize to '0'.
function rawOf(value: unknown): string {
  if (value === null || value === undefined) {
    return '0'
  }
  if (typeof value === 'string') {
    return value
  }
  if (typeof value === 'bigint' || typeof value === 'number') {
    return value.toString()
  }
  return (value as { toString(): string }).toString()
}

// A borsh i64 timestamp as a number (safe for Unix-seconds within Number range).
function numberOf(value: unknown): number {
  if (typeof value === 'number') {
    return value
  }
  if (value === null || value === undefined) {
    return 0
  }
  const parsed = Number((value as { toString(): string }).toString())
  return Number.isFinite(parsed) ? parsed : 0
}

// A borsh pubkey as base58 (never a raw byte dump).
function base58Of(value: unknown): string {
  const candidate = value as { toBase58?: () => string } | null
  if (candidate !== null && candidate !== undefined && typeof candidate.toBase58 === 'function') {
    return candidate.toBase58()
  }
  return typeof value === 'string' ? value : ''
}

/**
 * Fetch one transaction by signature, decode its single `Converted` event, and
 * reconcile it against `request.expected`. Returns:
 *  - a verification view when decoded and the hard identity guard (campaign /
 *    user / output mint) passed;
 *  - `null` when the tx is not visible, no `Converted` event is decodable, or the
 *    hard identity guard fails (this signature is not the caller's convert).
 * Throws only on a transport/decode-infrastructure failure (the data-source layer
 * maps that to a typed transport error).
 */
export async function decodeConvertedReceipt(
  deps: RedaxDevnetConvertReceiptDeps,
  request: RedaxConvertReceiptRequest,
): Promise<RedaxConvertReceiptVerificationView | null> {
  const tx = await deps.connection.getTransaction(request.signature, {
    commitment: 'finalized',
    maxSupportedTransactionVersion: 0,
  })
  const logs = tx?.meta?.logMessages
  if (logs === null || logs === undefined || logs.length === 0) {
    return null
  }

  const programId = new PublicKey(deps.programId)
  const parser = new EventParser(
    programId,
    new BorshCoder(redaxIdlWithProgramId(deps.programId) as unknown as Idl),
  )

  // Accept exactly one Converted event (the convert emits exactly one).
  let decoded: Record<string, unknown> | null = null
  for (const parsed of parser.parseLogs(logs)) {
    if (parsed.name === CONVERTED_EVENT_NAME) {
      decoded = parsed.data as Record<string, unknown>
      break
    }
  }
  if (decoded === null) {
    return null
  }

  const campaign = base58Of(pick(decoded, 'campaign', 'campaign'))
  const tokenConfig = base58Of(pick(decoded, 'tokenConfig', 'token_config'))
  const user = base58Of(pick(decoded, 'user', 'user'))
  const legacyMint = base58Of(pick(decoded, 'legacyMint', 'legacy_mint'))
  const outputMint = base58Of(pick(decoded, 'outputMint', 'output_mint'))
  const userOutputAta = base58Of(pick(decoded, 'userOutputAta', 'user_output_ata'))
  const protocolFeeVault = base58Of(pick(decoded, 'protocolFeeVault', 'protocol_fee_vault'))
  const amountInRaw = rawOf(pick(decoded, 'amountIn', 'amount_in'))
  const amountInNormalizedRaw = rawOf(pick(decoded, 'amountInNormalized', 'amount_in_normalized'))
  const normalizationRemainderRaw = rawOf(
    pick(decoded, 'normalizationRemainder', 'normalization_remainder'),
  )
  const grossOutRaw = rawOf(pick(decoded, 'grossOut', 'gross_out'))
  const userOutRaw = rawOf(pick(decoded, 'userOut', 'user_out'))
  const feeOutRaw = rawOf(pick(decoded, 'feeOut', 'fee_out'))
  const campaignTotalOutputMintedAfterRaw = rawOf(
    pick(decoded, 'campaignTotalOutputMintedAfter', 'campaign_total_output_minted_after'),
  )
  const tokenConfigTotalOutputMintedAfterRaw = rawOf(
    pick(
      decoded,
      'tokenConfigTotalOutputMintedFromTcAfter',
      'token_config_total_output_minted_from_tc_after',
    ),
  )
  const timestamp = numberOf(pick(decoded, 'timestamp', 'timestamp'))

  const expected = request.expected

  // Hard identity guard: a mismatch means this signature is not the caller's
  // convert — never surface a wrong receipt.
  if (
    campaign !== expected.campaignId ||
    user !== expected.user ||
    outputMint !== expected.outputMint
  ) {
    return null
  }

  // Soft reconciliation: name any expected field that differs. Post-counters and
  // timestamp are carried for display but are not reconciled as sole proof.
  const mismatchedFields: string[] = []
  if (tokenConfig !== expected.tokenConfigId) {
    mismatchedFields.push('tokenConfig')
  }
  if (legacyMint !== expected.legacyMint) {
    mismatchedFields.push('legacyMint')
  }
  if (amountInRaw !== expected.amountInRaw) {
    mismatchedFields.push('amountIn')
  }
  if (grossOutRaw !== expected.grossOutRaw) {
    mismatchedFields.push('grossOut')
  }
  if (userOutRaw !== expected.userOutRaw) {
    mismatchedFields.push('userOut')
  }
  if (feeOutRaw !== expected.feeOutRaw) {
    mismatchedFields.push('feeOut')
  }
  if (
    expected.amountInNormalizedRaw !== undefined &&
    amountInNormalizedRaw !== expected.amountInNormalizedRaw
  ) {
    mismatchedFields.push('amountInNormalized')
  }
  if (
    expected.normalizationRemainderRaw !== undefined &&
    normalizationRemainderRaw !== expected.normalizationRemainderRaw
  ) {
    mismatchedFields.push('normalizationRemainder')
  }
  if (expected.userOutputAta !== undefined && userOutputAta !== expected.userOutputAta) {
    mismatchedFields.push('userOutputAta')
  }
  if (expected.protocolFeeVault !== undefined && protocolFeeVault !== expected.protocolFeeVault) {
    mismatchedFields.push('protocolFeeVault')
  }

  // Real, single-transaction identity only. No explorer link in Tier 1.
  const identity: RedaxReceiptIdentity =
    request.slot !== undefined
      ? { kind: 'devnet-signature', signature: request.signature, slot: request.slot, eventIndex: 0 }
      : { kind: 'devnet-signature', signature: request.signature, eventIndex: 0 }

  const receipt: RedaxReceiptView = {
    identity,
    event: 'Converted',
    campaignId: expected.campaignId,
    tokenConfigId: tokenConfig,
    holderId: user,
    user,
    inputMint: legacyMint,
    outputMint,
    amountInRaw,
    amountInNormalizedRaw,
    normalizationRemainderRaw,
    grossOutRaw,
    feeOutRaw,
    userOutRaw,
    campaignTotalOutputMintedAfterRaw,
    tokenConfigTotalOutputMintedAfterRaw,
    timestamp,
  }

  return {
    receipt,
    matchesExpected: mismatchedFields.length === 0,
    mismatchedFields,
  }
}
