// REDAX devnet transaction builders — pure instruction construction only.
//
// Boundary: this module is a PURE builder. It constructs classic-SPL REDAX
// `TransactionInstruction`s from already-resolved public keys, derives their PDAs
// and canonical token accounts, and owns the ONE deterministic Holder Devnet
// ComputeBudget policy (bottom of this file). It performs NO RPC, builds no
// `Transaction`, holds no `Connection`, touches no wallet adapter, never signs,
// never sends, never confirms, and mutates nothing. It imports no React and no
// Anchor `Program`/provider, adds no package, and invokes none of what it builds.
//
// Holder instructions (live; submitted today by the wallet action bridge,
// RedaxWalletActions.tsx):
//
// `prepare_user_output_ata`: the frontend builds the OUTER instruction (8-byte
// discriminator, no args, eight account metas); the program performs the inner
// Associated-Token-Program `create_idempotent` CPI itself — that CPI is NOT built
// here. `convert_exact_in`: the frontend builds the OUTER instruction (8-byte
// discriminator + `amount_in` u64 little-endian, ten account metas); the program
// performs the classic-SPL `Burn` / `MintTo` CPIs itself — those are NOT built
// here. Classic SPL only; no Token-2022.
//
// Two traps these builders are written to avoid:
//   * The Campaign PDA's controller seed is `output_governance`, NOT `campaign_admin`
//     — they are distinct roles that merely coincide under the initial topology.
//   * `pause_campaign` has a DIFFERENT shape from the other lifecycle instructions
//     (three accounts including ProtocolConfig, and a signer named `authority` that
//     may be the campaign admin OR the protocol emergency-pause authority). It is
//     therefore implemented separately and is never templated off them.

import { ComputeBudgetProgram, SystemProgram, SYSVAR_RENT_PUBKEY, TransactionInstruction } from '@solana/web3.js'
import type { AccountMeta, PublicKey, TransactionInstructionCtorFields } from '@solana/web3.js'
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID } from '@solana/spl-token'
import {
  METAPLEX_TOKEN_METADATA_PROGRAM_ID,
  deriveCampaignPda,
  deriveClassicAta,
  deriveOutputTokenMetadataPda,
  deriveProtocolConfigPda,
  deriveProtocolFeeVaultAta,
  deriveTokenConfigPda,
} from './redaxDevnetAccounts'

// The 8-byte Anchor instruction discriminator for `prepare_user_output_ata`,
// taken verbatim from the committed IDL
// (app/src/idl/redax_protocol.json → instructions[name="prepare_user_output_ata"]
// .discriminator). Hardcoded here with this source comment, mirroring the account
// discriminators in redaxDevnetAccounts.ts. The instruction takes no args, so the
// instruction data is exactly these 8 bytes.
const PREPARE_USER_OUTPUT_ATA_DISCRIMINATOR: readonly number[] = [
  238, 48, 109, 185, 85, 209, 62, 211,
]

/**
 * Inputs for a `prepare_user_output_ata` instruction. `payer` funds/signs; `user`
 * is the recipient wallet whose canonical output ATA is prepared. `payer === user`
 * is supported (the connected wallet preparing its own output ATA), which the
 * program explicitly permits. All keys are already-validated runtime public keys;
 * this builder derives `user_output_ata` and never reads env.
 */
export interface RedaxPrepareUserOutputAtaInstructionRequest {
  programId: PublicKey
  campaign: PublicKey
  payer: PublicKey
  user: PublicKey
  outputMint: PublicKey
}

/** The built instruction plus the canonically derived user output ATA. */
export interface RedaxPrepareUserOutputAtaInstructionResult {
  instruction: TransactionInstruction
  userOutputAta: PublicKey
}

/**
 * Build the classic-SPL `prepare_user_output_ata` instruction. Pure: derives the
 * canonical user output ATA for (user, output mint) via the shared classic-SPL
 * helper and assembles the eight account metas in the exact IDL/program order:
 *   1. payer                    — writable signer
 *   2. campaign                 — read-only
 *   3. user                     — read-only
 *   4. output_mint              — read-only
 *   5. user_output_ata          — writable (derived)
 *   6. associated_token_program — read-only
 *   7. token_program            — read-only (classic SPL)
 *   8. system_program           — read-only
 * Instruction data is the 8-byte discriminator only. No RPC, no send, no sign, no
 * mutation. Does not invoke the instruction.
 */
export function buildPrepareUserOutputAtaInstruction(
  request: RedaxPrepareUserOutputAtaInstructionRequest,
): RedaxPrepareUserOutputAtaInstructionResult {
  const { programId, campaign, payer, user, outputMint } = request

  const userOutputAta = deriveClassicAta(user, outputMint)

  const keys: AccountMeta[] = [
    { pubkey: payer, isSigner: true, isWritable: true },
    { pubkey: campaign, isSigner: false, isWritable: false },
    { pubkey: user, isSigner: false, isWritable: false },
    { pubkey: outputMint, isSigner: false, isWritable: false },
    { pubkey: userOutputAta, isSigner: false, isWritable: true },
    { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ]

  // Discriminator-only instruction data. Built as a browser-pure Uint8Array (the
  // codebase avoids Buffer) and typed to web3.js's own instruction-data field so
  // no `Buffer` identifier is needed here.
  const data = Uint8Array.from(PREPARE_USER_OUTPUT_ATA_DISCRIMINATOR) as unknown as
    TransactionInstructionCtorFields['data']

  const instruction = new TransactionInstruction({ programId, keys, data })

  return { instruction, userOutputAta }
}

// The 8-byte Anchor instruction discriminator for `convert_exact_in`, taken
// verbatim from the committed IDL
// (app/src/idl/redax_protocol.json → instructions[name="convert_exact_in"]
// .discriminator). Hardcoded here with this source comment, mirroring the prepare
// discriminator above and the account discriminators in redaxDevnetAccounts.ts.
// The instruction takes one `amount_in: u64` arg, appended little-endian after
// these 8 bytes (16 bytes of instruction data total).
const CONVERT_EXACT_IN_DISCRIMINATOR: readonly number[] = [
  15, 209, 11, 216, 241, 255, 120, 118,
]

// Inclusive maximum classic-SPL amount (u64). `amount_in` is a u64 on-chain; a
// value outside [0, U64_MAX] cannot be encoded and is a builder error.
const U64_MAX = 18446744073709551615n

/**
 * Inputs for a `convert_exact_in` instruction. `user` is the connected holder —
 * the sole signer, fee payer, `Burn` authority, and `MintTo` recipient owner.
 * `campaign` / `tokenConfig` / `legacyMint` / `outputMint` / `protocolFeeVault`
 * are already-resolved runtime public keys taken from the loaded Redax*View data;
 * `amountIn` is the base-unit legacy input amount to convert (u64). This builder
 * derives `protocol_config`, `user_legacy_ata`, and `user_output_ata`, and never
 * reads env, RPC, or a wallet.
 */
export interface RedaxConvertExactInInstructionRequest {
  programId: PublicKey
  user: PublicKey
  campaign: PublicKey
  tokenConfig: PublicKey
  legacyMint: PublicKey
  outputMint: PublicKey
  protocolFeeVault: PublicKey
  amountIn: bigint
}

/**
 * The built instruction plus the accounts the caller may reuse for a later UI
 * re-read: the ProtocolConfig PDA and the canonically derived user legacy/output
 * ATAs. All are pure derivations — nothing here is fetched or created.
 */
export interface RedaxConvertExactInInstructionResult {
  instruction: TransactionInstruction
  protocolConfig: PublicKey
  userLegacyAta: PublicKey
  userOutputAta: PublicKey
}

/**
 * Build the classic-SPL `convert_exact_in` instruction. Pure: derives the
 * ProtocolConfig PDA (from the runtime program id) and the canonical user legacy
 * and output ATAs (from the connected wallet + mints) via the shared helpers, then
 * assembles the ten account metas in the exact IDL/program order:
 *   1. user               — signer, writable
 *   2. protocol_config     — read-only (derived PDA)
 *   3. campaign            — writable
 *   4. token_config        — writable
 *   5. legacy_mint         — writable
 *   6. output_mint         — writable
 *   7. user_legacy_ata     — writable (derived)
 *   8. user_output_ata     — writable (derived; must already exist on-chain)
 *   9. protocol_fee_vault  — writable
 *  10. token_program       — read-only (classic SPL)
 * Instruction data is the 8-byte discriminator followed by `amountIn` as an
 * unsigned u64 little-endian (16 bytes total). Throws (never encodes) when
 * `amountIn` is outside the u64 range; a zero amount is not rejected here (the
 * action bridge rejects zero as INVALID_AMOUNT). No RPC, no send, no sign, no
 * mutation. Does not invoke the instruction.
 */
export function buildConvertExactInInstruction(
  request: RedaxConvertExactInInstructionRequest,
): RedaxConvertExactInInstructionResult {
  const {
    programId,
    user,
    campaign,
    tokenConfig,
    legacyMint,
    outputMint,
    protocolFeeVault,
    amountIn,
  } = request

  if (amountIn < 0n || amountIn > U64_MAX) {
    throw new RangeError('convert amountIn is outside the u64 range')
  }

  const { pda: protocolConfig } = deriveProtocolConfigPda(programId)
  const userLegacyAta = deriveClassicAta(user, legacyMint)
  const userOutputAta = deriveClassicAta(user, outputMint)

  const keys: AccountMeta[] = [
    { pubkey: user, isSigner: true, isWritable: true },
    { pubkey: protocolConfig, isSigner: false, isWritable: false },
    { pubkey: campaign, isSigner: false, isWritable: true },
    { pubkey: tokenConfig, isSigner: false, isWritable: true },
    { pubkey: legacyMint, isSigner: false, isWritable: true },
    { pubkey: outputMint, isSigner: false, isWritable: true },
    { pubkey: userLegacyAta, isSigner: false, isWritable: true },
    { pubkey: userOutputAta, isSigner: false, isWritable: true },
    { pubkey: protocolFeeVault, isSigner: false, isWritable: true },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
  ]

  // 16-byte instruction data: 8-byte discriminator ++ amountIn as u64 LE. Built as
  // a browser-pure Uint8Array (the codebase avoids Buffer); the u64 is written via
  // a DataView so no Buffer identifier is needed. Typed to web3.js's own
  // instruction-data field, mirroring the prepare builder above.
  const data = new Uint8Array(16)
  data.set(CONVERT_EXACT_IN_DISCRIMINATOR, 0)
  new DataView(data.buffer).setBigUint64(8, amountIn, true)

  const instruction = new TransactionInstruction({
    programId,
    keys,
    data: data as unknown as TransactionInstructionCtorFields['data'],
  })

  return { instruction, protocolConfig, userLegacyAta, userOutputAta }
}

// =============================================================================
// Team/Admin (supply-side) instruction builders — ADDITIVE, PURE, NON-ACTIONABLE
// =============================================================================
//
// Everything above this line is unchanged. Everything below builds instruction
// DATA ONLY: no wallet, no send, no Transaction, no RPC. Nothing in the app
// imports these yet, and no action-bridge member exposes them.

// --- Borsh encoding primitives ----------------------------------------------
//
// Anchor arguments are Borsh-encoded after the 8-byte discriminator. Built as
// browser-pure Uint8Array/DataView (the codebase avoids Buffer). Every encoder
// range-checks BEFORE it writes, so an out-of-range value throws instead of
// silently wrapping into a different on-chain number.

const U128_MAX = 340282366920938463463374607431768211455n
const I64_MAX = 9223372036854775807n
const I64_MIN = -9223372036854775808n
const U64_MODULUS = 1n << 64n

/**
 * UTF-8 bytes of a string.
 *
 * The encoder is constructed INSIDE this function rather than held in a
 * module-level constant, deliberately. A module-level `new TextEncoder()` is a
 * constructor call that a bundler cannot prove side-effect-free, so it survives
 * tree-shaking and ships in the production bundle even after every one of its
 * callers has been shaken away — which is exactly what a base-versus-current bundle
 * diff caught. Behind a function boundary it is dropped together with its callers.
 * The bytes produced are identical either way.
 */
function encodeUtf8(value: string): Uint8Array {
  return new TextEncoder().encode(value)
}

/** u128 -> 16 bytes little-endian (written as two little-endian u64 halves). */
function encodeU128LE(value: bigint): Uint8Array {
  if (value < 0n || value > U128_MAX) {
    throw new RangeError('value is outside the u128 range')
  }
  const bytes = new Uint8Array(16)
  const view = new DataView(bytes.buffer)
  // Little-endian u128 = low 64 bits first, then high 64 bits.
  view.setBigUint64(0, value % U64_MODULUS, true)
  view.setBigUint64(8, value / U64_MODULUS, true)
  return bytes
}

/** `Option<i64>` -> 1-byte Borsh tag (0 = None, 1 = Some) + 8-byte signed LE payload. */
function encodeOptionI64LE(value: bigint | null): Uint8Array {
  if (value === null) {
    return Uint8Array.from([0])
  }
  if (value < I64_MIN || value > I64_MAX) {
    throw new RangeError('value is outside the i64 range')
  }
  const bytes = new Uint8Array(9)
  bytes[0] = 1
  new DataView(bytes.buffer).setBigInt64(1, value, true)
  return bytes
}

/** Borsh `string` -> 4-byte u32 little-endian BYTE length + UTF-8 bytes. */
function encodeBorshString(value: string): Uint8Array {
  const utf8 = encodeUtf8(value)
  const bytes = new Uint8Array(4 + utf8.length)
  new DataView(bytes.buffer).setUint32(0, utf8.length, true)
  bytes.set(utf8, 4)
  return bytes
}

function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  let total = 0
  for (const part of parts) {
    total += part.length
  }
  const out = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

function instructionData(
  discriminator: readonly number[],
  args: readonly Uint8Array[],
): TransactionInstructionCtorFields['data'] {
  return concatBytes([
    Uint8Array.from(discriminator),
    ...args,
  ]) as unknown as TransactionInstructionCtorFields['data']
}

// --- Shared descriptors ------------------------------------------------------

/** Which protocol role a required signature stands for. */
export type RedaxSignerRole =
  | 'payer'
  | 'output_governance'
  | 'campaign_admin'
  | 'authority'
  | 'output_mint'

/** One required signature: the role, and the key that must provide it. */
export interface RedaxSignerRequirement {
  readonly role: RedaxSignerRole
  readonly pubkey: PublicKey
}

/** The accounts an instruction is expected to create and to mutate. */
export interface RedaxExpectedStateDelta {
  readonly creates: readonly string[]
  readonly mutates: readonly string[]
}

// --- init_campaign -----------------------------------------------------------

const INIT_CAMPAIGN_DISCRIMINATOR: readonly number[] = [154, 188, 249, 244, 226, 210, 253, 109]

/**
 * Inputs for `init_campaign`.
 *
 * Note what is NOT here: there is no `protocolFeeVault` parameter and no
 * `campaign` parameter. Both are DERIVED — the vault from the protocol fee
 * authority (which the caller must read fresh from the on-chain ProtocolConfig),
 * and the Campaign PDA from (output governance, salt). This is deliberate: the
 * program re-derives the vault itself and rejects any other account, so the type
 * shape makes a team-supplied fee destination unrepresentable rather than merely
 * discouraged.
 */
export interface RedaxInitCampaignInstructionRequest {
  readonly programId: PublicKey
  readonly payer: PublicKey
  readonly outputGovernance: PublicKey
  readonly campaignAdmin: PublicKey
  /** Exactly 32 bytes. Seeds the Campaign PDA together with the output governance. */
  readonly salt: Uint8Array
  readonly outputMint: PublicKey
  /** From a fresh on-chain ProtocolConfig read. NOT a signer of this instruction. */
  readonly protocolFeeAuthority: PublicKey
  readonly endTs: bigint | null
  readonly maxOutputSupply: bigint
}

export interface RedaxInitCampaignInstructionResult {
  readonly instruction: TransactionInstruction
  readonly campaign: PublicKey
  readonly campaignBump: number
  readonly protocolConfig: PublicKey
  readonly protocolFeeVault: PublicKey
  readonly signers: readonly RedaxSignerRequirement[]
  readonly expectedStateDelta: RedaxExpectedStateDelta
}

/**
 * Build `init_campaign`. Creates the Campaign PDA ONLY; the output mint and the
 * canonical protocol fee vault must already exist and are independently validated
 * by the program (classic-SPL owner, exact layout, initialized, mint authority ==
 * this exact Campaign PDA, freeze authority == None, decimals == 9, supply == 0,
 * and the vault's canonical ATA derivation).
 *
 * Eight account metas in the exact IDL/program order:
 *   1. payer               — signer, writable
 *   2. output_governance   — signer (the Campaign PDA's controller seed)
 *   3. campaign_admin      — signer
 *   4. protocol_config     — read-only (derived PDA)
 *   5. campaign            — writable (derived PDA; created by `init`)
 *   6. output_mint         — read-only (must pre-exist)
 *   7. protocol_fee_vault  — read-only (must pre-exist; derived, never supplied)
 *   8. system_program      — read-only
 *
 * Instruction data: 8-byte discriminator ++ salt (32 raw bytes, a fixed-size Borsh
 * array with no length prefix) ++ `end_ts` as Option<i64> ++ `max_output_supply`
 * as u128 little-endian. There is NO campaign-creation-fee instruction and no
 * lamport transfer: Phase 1 carries no campaign-opening fee.
 */
export function buildInitCampaignInstruction(
  request: RedaxInitCampaignInstructionRequest,
): RedaxInitCampaignInstructionResult {
  const {
    programId,
    payer,
    outputGovernance,
    campaignAdmin,
    salt,
    outputMint,
    protocolFeeAuthority,
    endTs,
    maxOutputSupply,
  } = request

  // Throws on any salt that is not exactly 32 bytes, rather than deriving a
  // different Campaign PDA than the one the mint authority was set to.
  const { pda: campaign, bump: campaignBump } = deriveCampaignPda(programId, outputGovernance, salt)
  const { pda: protocolConfig } = deriveProtocolConfigPda(programId)
  const protocolFeeVault = deriveProtocolFeeVaultAta(protocolFeeAuthority, outputMint)

  const keys: AccountMeta[] = [
    { pubkey: payer, isSigner: true, isWritable: true },
    { pubkey: outputGovernance, isSigner: true, isWritable: false },
    { pubkey: campaignAdmin, isSigner: true, isWritable: false },
    { pubkey: protocolConfig, isSigner: false, isWritable: false },
    { pubkey: campaign, isSigner: false, isWritable: true },
    { pubkey: outputMint, isSigner: false, isWritable: false },
    { pubkey: protocolFeeVault, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ]

  const data = instructionData(INIT_CAMPAIGN_DISCRIMINATOR, [
    salt,
    encodeOptionI64LE(endTs),
    encodeU128LE(maxOutputSupply),
  ])

  return {
    instruction: new TransactionInstruction({ programId, keys, data }),
    campaign,
    campaignBump,
    protocolConfig,
    protocolFeeVault,
    // The protocol fee authority is deliberately absent: it is NOT a signer.
    signers: [
      { role: 'payer', pubkey: payer },
      { role: 'output_governance', pubkey: outputGovernance },
      { role: 'campaign_admin', pubkey: campaignAdmin },
    ],
    expectedStateDelta: { creates: ['campaign'], mutates: ['payer'] },
  }
}

// --- add_token_config --------------------------------------------------------

const ADD_TOKEN_CONFIG_DISCRIMINATOR: readonly number[] = [138, 17, 119, 191, 118, 60, 75, 230]

/**
 * Inputs for `add_token_config`.
 *
 * Decimals are deliberately absent: they are NOT instruction arguments. The
 * program reads the actual legacy and output decimals straight from the mint
 * accounts and stores those, so a client cannot assert them.
 */
export interface RedaxAddTokenConfigInstructionRequest {
  readonly programId: PublicKey
  readonly payer: PublicKey
  readonly campaignAdmin: PublicKey
  readonly campaign: PublicKey
  readonly legacyMint: PublicKey
  readonly outputMint: PublicKey
  readonly rateNumerator: bigint
  readonly rateDenominator: bigint
  /** Per-TokenConfig output cap. `0` = uncapped. */
  readonly maxOutputFromTokenConfig: bigint
}

export interface RedaxAddTokenConfigInstructionResult {
  readonly instruction: TransactionInstruction
  readonly tokenConfig: PublicKey
  readonly tokenConfigBump: number
  readonly signers: readonly RedaxSignerRequirement[]
  readonly expectedStateDelta: RedaxExpectedStateDelta
}

/**
 * Build `add_token_config`. Seven account metas in the exact IDL/program order:
 *   1. payer          — signer, writable
 *   2. campaign_admin — signer
 *   3. campaign       — writable (its `token_config_count` increments)
 *   4. legacy_mint    — read-only
 *   5. output_mint    — read-only
 *   6. token_config   — writable (derived PDA; created by `init`)
 *   7. system_program — read-only
 *
 * Data: discriminator ++ three u128 little-endian args, in order — rate numerator,
 * rate denominator, per-TokenConfig cap.
 */
export function buildAddTokenConfigInstruction(
  request: RedaxAddTokenConfigInstructionRequest,
): RedaxAddTokenConfigInstructionResult {
  const {
    programId,
    payer,
    campaignAdmin,
    campaign,
    legacyMint,
    outputMint,
    rateNumerator,
    rateDenominator,
    maxOutputFromTokenConfig,
  } = request

  const { pda: tokenConfig, bump: tokenConfigBump } = deriveTokenConfigPda(
    programId,
    campaign,
    legacyMint,
  )

  const keys: AccountMeta[] = [
    { pubkey: payer, isSigner: true, isWritable: true },
    { pubkey: campaignAdmin, isSigner: true, isWritable: false },
    { pubkey: campaign, isSigner: false, isWritable: true },
    { pubkey: legacyMint, isSigner: false, isWritable: false },
    { pubkey: outputMint, isSigner: false, isWritable: false },
    { pubkey: tokenConfig, isSigner: false, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ]

  const data = instructionData(ADD_TOKEN_CONFIG_DISCRIMINATOR, [
    encodeU128LE(rateNumerator),
    encodeU128LE(rateDenominator),
    encodeU128LE(maxOutputFromTokenConfig),
  ])

  return {
    instruction: new TransactionInstruction({ programId, keys, data }),
    tokenConfig,
    tokenConfigBump,
    signers: [
      { role: 'payer', pubkey: payer },
      { role: 'campaign_admin', pubkey: campaignAdmin },
    ],
    expectedStateDelta: { creates: ['token_config'], mutates: ['campaign', 'payer'] },
  }
}

// --- setup_metadata ----------------------------------------------------------

const SETUP_METADATA_DISCRIMINATOR: readonly number[] = [33, 141, 154, 228, 169, 204, 90, 181]

// Byte (not character) bounds — Rust's `String::len()` counts UTF-8 bytes.
const MAX_METADATA_NAME_BYTES = 32
const MAX_METADATA_SYMBOL_BYTES = 10
const MAX_METADATA_URI_BYTES = 200

export interface RedaxSetupMetadataInstructionRequest {
  readonly programId: PublicKey
  readonly payer: PublicKey
  readonly campaignAdmin: PublicKey
  readonly campaign: PublicKey
  readonly outputMint: PublicKey
  readonly name: string
  readonly symbol: string
  readonly uri: string
}

export interface RedaxSetupMetadataInstructionResult {
  readonly instruction: TransactionInstruction
  readonly metadataAccount: PublicKey
  readonly signers: readonly RedaxSignerRequirement[]
  readonly expectedStateDelta: RedaxExpectedStateDelta
}

function assertMetadataBytes(value: string, maxBytes: number, field: string): void {
  const bytes = encodeUtf8(value).length
  if (bytes < 1 || bytes > maxBytes) {
    throw new RangeError(`${field} must be 1..${maxBytes} UTF-8 bytes`)
  }
}

/**
 * Build `setup_metadata`. The program performs the Metaplex
 * `CreateMetadataAccountV3` CPI itself (signed by the Campaign PDA, with
 * `is_mutable = false`); that inner CPI is NOT built here — only the outer
 * instruction is.
 *
 * Eight account metas in the exact IDL/program order:
 *   1. payer            — signer, writable
 *   2. campaign_admin   — signer
 *   3. campaign         — writable (`metadata_setup` flips to true)
 *   4. output_mint      — read-only
 *   5. metadata_account — writable (derived Metaplex PDA)
 *   6. metadata_program — read-only (pinned Metaplex Token Metadata program)
 *   7. system_program   — read-only
 *   8. rent             — read-only (rent sysvar)
 *
 * The Campaign PDA is NOT an outer signer — it signs the inner CPI via
 * `invoke_signed`. Empty strings are rejected: the program's bounds are 1..=N.
 */
export function buildSetupMetadataInstruction(
  request: RedaxSetupMetadataInstructionRequest,
): RedaxSetupMetadataInstructionResult {
  const { programId, payer, campaignAdmin, campaign, outputMint, name, symbol, uri } = request

  assertMetadataBytes(name, MAX_METADATA_NAME_BYTES, 'name')
  assertMetadataBytes(symbol, MAX_METADATA_SYMBOL_BYTES, 'symbol')
  assertMetadataBytes(uri, MAX_METADATA_URI_BYTES, 'uri')

  const { pda: metadataAccount } = deriveOutputTokenMetadataPda(outputMint)

  const keys: AccountMeta[] = [
    { pubkey: payer, isSigner: true, isWritable: true },
    { pubkey: campaignAdmin, isSigner: true, isWritable: false },
    { pubkey: campaign, isSigner: false, isWritable: true },
    { pubkey: outputMint, isSigner: false, isWritable: false },
    { pubkey: metadataAccount, isSigner: false, isWritable: true },
    { pubkey: METAPLEX_TOKEN_METADATA_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
  ]

  const data = instructionData(SETUP_METADATA_DISCRIMINATOR, [
    encodeBorshString(name),
    encodeBorshString(symbol),
    encodeBorshString(uri),
  ])

  return {
    instruction: new TransactionInstruction({ programId, keys, data }),
    metadataAccount,
    signers: [
      { role: 'payer', pubkey: payer },
      { role: 'campaign_admin', pubkey: campaignAdmin },
    ],
    expectedStateDelta: { creates: ['metadata_account'], mutates: ['campaign', 'payer'] },
  }
}

// --- Lifecycle: activate / unpause / finalize (campaign-admin only) -----------

const ACTIVATE_CAMPAIGN_DISCRIMINATOR: readonly number[] = [17, 214, 3, 27, 91, 67, 44, 171]
const UNPAUSE_CAMPAIGN_DISCRIMINATOR: readonly number[] = [177, 111, 91, 206, 169, 242, 87, 95]
const FINALIZE_CAMPAIGN_DISCRIMINATOR: readonly number[] = [241, 76, 201, 221, 33, 222, 220, 138]

/** Inputs shared by the three campaign-admin-only lifecycle instructions. */
export interface RedaxCampaignLifecycleInstructionRequest {
  readonly programId: PublicKey
  readonly campaign: PublicKey
  readonly campaignAdmin: PublicKey
}

export interface RedaxCampaignLifecycleInstructionResult {
  readonly instruction: TransactionInstruction
  readonly signers: readonly RedaxSignerRequirement[]
  readonly expectedStateDelta: RedaxExpectedStateDelta
}

/**
 * The account shape shared by `activate_campaign`, `unpause_campaign` and
 * `finalize_campaign` — and ONLY by those three. Two metas, in IDL order:
 *   1. campaign       — writable
 *   2. campaign_admin — signer
 *
 * No payer, no system program, no rent, no ProtocolConfig. `pause_campaign` is
 * NOT built from this helper: it has a different shape (see below).
 */
function buildCampaignAdminOnlyLifecycleInstruction(
  request: RedaxCampaignLifecycleInstructionRequest,
  discriminator: readonly number[],
): RedaxCampaignLifecycleInstructionResult {
  const { programId, campaign, campaignAdmin } = request

  const keys: AccountMeta[] = [
    { pubkey: campaign, isSigner: false, isWritable: true },
    { pubkey: campaignAdmin, isSigner: true, isWritable: false },
  ]

  return {
    instruction: new TransactionInstruction({
      programId,
      keys,
      data: instructionData(discriminator, []),
    }),
    signers: [{ role: 'campaign_admin', pubkey: campaignAdmin }],
    expectedStateDelta: { creates: [], mutates: ['campaign'] },
  }
}

/** `activate_campaign`: Initialized -> Active. Requires metadata already set. No args. */
export function buildActivateCampaignInstruction(
  request: RedaxCampaignLifecycleInstructionRequest,
): RedaxCampaignLifecycleInstructionResult {
  return buildCampaignAdminOnlyLifecycleInstruction(request, ACTIVATE_CAMPAIGN_DISCRIMINATOR)
}

/**
 * `unpause_campaign`: Paused -> Active. No args.
 *
 * Deliberately asymmetric with pause: only the campaign admin may unpause. The
 * protocol emergency-pause authority can stop a campaign but cannot restart it, so
 * this instruction takes no ProtocolConfig account at all.
 */
export function buildUnpauseCampaignInstruction(
  request: RedaxCampaignLifecycleInstructionRequest,
): RedaxCampaignLifecycleInstructionResult {
  return buildCampaignAdminOnlyLifecycleInstruction(request, UNPAUSE_CAMPAIGN_DISCRIMINATOR)
}

/** `finalize_campaign`: Active|Paused -> Finalized (terminal). Admin only. No args. */
export function buildFinalizeCampaignInstruction(
  request: RedaxCampaignLifecycleInstructionRequest,
): RedaxCampaignLifecycleInstructionResult {
  return buildCampaignAdminOnlyLifecycleInstruction(request, FINALIZE_CAMPAIGN_DISCRIMINATOR)
}

// --- pause_campaign (asymmetric — deliberately NOT templated) -----------------

const PAUSE_CAMPAIGN_DISCRIMINATOR: readonly number[] = [62, 247, 54, 192, 240, 158, 8, 161]

/**
 * Inputs for `pause_campaign`.
 *
 * The signer is named `authority`, not `campaign_admin`, because the program
 * authorizes EITHER the campaign admin OR the ProtocolConfig's emergency-pause
 * authority — an OR that cannot be expressed as an Anchor `has_one`, which is why
 * the program resolves it by hand and why this instruction alone carries the
 * ProtocolConfig account.
 */
export interface RedaxPauseCampaignInstructionRequest {
  readonly programId: PublicKey
  readonly campaign: PublicKey
  /** The campaign admin OR the protocol emergency-pause authority. */
  readonly authority: PublicKey
}

export interface RedaxPauseCampaignInstructionResult {
  readonly instruction: TransactionInstruction
  readonly protocolConfig: PublicKey
  readonly signers: readonly RedaxSignerRequirement[]
  readonly expectedStateDelta: RedaxExpectedStateDelta
}

/**
 * Build `pause_campaign`: Active -> Paused. No args. THREE account metas, in the
 * exact IDL/program order — note this order differs from every other lifecycle
 * instruction:
 *   1. campaign        — writable
 *   2. protocol_config — read-only (derived PDA; carries the emergency-pause authority)
 *   3. authority       — signer
 */
export function buildPauseCampaignInstruction(
  request: RedaxPauseCampaignInstructionRequest,
): RedaxPauseCampaignInstructionResult {
  const { programId, campaign, authority } = request

  const { pda: protocolConfig } = deriveProtocolConfigPda(programId)

  const keys: AccountMeta[] = [
    { pubkey: campaign, isSigner: false, isWritable: true },
    { pubkey: protocolConfig, isSigner: false, isWritable: false },
    { pubkey: authority, isSigner: true, isWritable: false },
  ]

  return {
    instruction: new TransactionInstruction({
      programId,
      keys,
      data: instructionData(PAUSE_CAMPAIGN_DISCRIMINATOR, []),
    }),
    protocolConfig,
    signers: [{ role: 'authority', pubkey: authority }],
    expectedStateDelta: { creates: [], mutates: ['campaign'] },
  }
}

// =============================================================================
// The Holder Devnet deterministic ComputeBudget policy — ONE authorized owner
// =============================================================================
//
// WHY THIS EXISTS AT ALL. A REDAX Holder transaction used to be committed with its
// ComputeBudget slot UNOCCUPIED. A documented browser-wallet signing behaviour fills
// that slot itself — it prepends compute-unit-limit and priority-fee instructions
// before returning the signed transaction — so the bytes that came back could no
// longer equal the bytes REDAX had already committed to, and the exact-message
// control refused them. The refusal was correct. THE REPAIR IS TO OCCUPY THE SLOT
// BEFORE SIGNING, never to tolerate a difference after it: REDAX owns the complete
// intended transaction, and a wallet may sign those exact bytes or refuse.
//
// This file is the ONE place in `app/src` that may name `ComputeBudgetProgram`, and
// the two existing Holder actions are its only consumers. There is deliberately no
// generic factory here: the values below are FIXED LITERALS, not parameters, not
// defaults and not configuration, so no caller — and no future caller — can choose a
// compute limit or a fee price. A generic surface would be a fee policy anybody
// could set; this is a policy nobody can set.
//
// BOUNDED TO DEVNET. This is not a Mainnet or production fee architecture, and it is
// not a wallet-brand exception: nothing here knows or asks which wallet is connected.

/**
 * The selected compute-unit limit for both Holder Devnet actions.
 *
 * More than twice the largest compute this route has actually observed (a Prepare at
 * 29018 CU, a Convert at 28647 CU), so it is headroom rather than a ceiling anybody
 * is close to — and it is small enough to keep the priority fee under the existing
 * preflight allowance without a second bound to maintain.
 */
export const REDAX_DEVNET_COMPUTE_UNIT_LIMIT = 60000

/**
 * The selected priority price, in micro-lamports per compute unit.
 *
 * With the limit above the priority fee is exactly
 * `ceil(60000 * 50000 / 1_000_000)` = `3000` lamports, so a one-signature Holder
 * transaction costs at most `5000 + 3000` = `8000` lamports — inside the Holder SOL
 * preflight's existing `10000`-lamport allowance, which therefore does not change.
 * There is NO fee query, NO oracle and NO fallback price: a fixed policy is the only
 * one whose bytes are knowable before the wallet is asked.
 */
export const REDAX_DEVNET_COMPUTE_UNIT_PRICE_MICROLAMPORTS = 50000

/**
 * The exact ComputeBudget pair every Holder Devnet transaction carries, in the exact
 * canonical order: the limit first, then the price.
 *
 * PURE and ARGUMENT-FREE by design. It takes no parameters, reads no environment or
 * runtime configuration, performs no RPC, touches no wallet, creates no
 * `Transaction`, signs nothing and sends nothing. It returns FRESH instruction
 * objects on every call, so a caller cannot mutate a shared one and change what a
 * later attempt commits to; the BYTES are identical every time, which is what makes
 * the intended message deterministic.
 *
 * The order lives HERE rather than at the two call sites, which is the point: a
 * consumer spreads what this returns and has nothing to reorder.
 */
export function buildRedaxDevnetComputeBudgetInstructions(): readonly [
  TransactionInstruction,
  TransactionInstruction,
] {
  return [
    ComputeBudgetProgram.setComputeUnitLimit({ units: REDAX_DEVNET_COMPUTE_UNIT_LIMIT }),
    ComputeBudgetProgram.setComputeUnitPrice({
      microLamports: REDAX_DEVNET_COMPUTE_UNIT_PRICE_MICROLAMPORTS,
    }),
  ]
}
