// REDAX DEVNET_READONLY adapter — pure account-helper definitions.
//
// Runtime program id: every helper takes the validated runtime program id (from
// config.programId / validated VITE_REDAX_PROGRAM_ID at the data-source layer)
// and uses it for getProgramAccounts and PDA derivation. The IDL-embedded address
// is provenance only and is NEVER the runtime source here.
//
// Field-casing note: a raw BorshAccountsCoder.decode() returns the verbatim IDL
// field names. The on-disk IDL (app/src/idl/redax_protocol.json) is snake_case,
// while the generated TS helper (redax_protocol.ts) is camelCase. To stay
// resilient to the coder's runtime casing, `pick()` reads the camelCase key first
// and falls back to the snake_case key. Account name strings, field casing, BN /
// enum / byte-array shapes are confirmed at the RPC-smoke gate.

import {
  Connection,
  PublicKey,
  SolanaJSONRPCErrorCode,
  SYSVAR_CLOCK_PUBKEY,
  type GetProgramAccountsFilter,
} from '@solana/web3.js'
import { BorshAccountsCoder, type Idl } from '@coral-xyz/anchor'
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  AccountState,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  unpackAccount,
  unpackMint,
} from '@solana/spl-token'
import { redaxIdlWithProgramId } from '../../idl/redaxProtocolIdl'
import { RedaxDevnetAccountError } from './redaxDevnetErrors'

// --- IDL account names + discriminators ------------------------------------
//
// Account-name strings match the IDL `accounts[].name` (and `types[].name`) that
// the BorshAccountsCoder is built from. Discriminators are the IDL's 8-byte
// account discriminators (used for getProgramAccounts memcmp filters and an
// explicit pre-decode check).

const ACCOUNT_NAME = {
  protocolConfig: 'ProtocolConfig',
  campaign: 'Campaign',
  tokenConfig: 'TokenConfig',
} as const

const PROTOCOL_CONFIG_DISCRIMINATOR: readonly number[] = [207, 91, 250, 28, 152, 179, 215, 209]
const CAMPAIGN_DISCRIMINATOR: readonly number[] = [50, 40, 49, 11, 157, 220, 229, 192]
const TOKEN_CONFIG_DISCRIMINATOR: readonly number[] = [92, 73, 255, 43, 107, 51, 117, 101]

// PDA seed prefixes — mirror programs/redax_protocol/src/constants.rs. A drift
// here breaks derivation; verified against constants.rs.
const SEED_PROTOCOL_CONFIG = new TextEncoder().encode('protocol_config')
const SEED_CAMPAIGN = new TextEncoder().encode('campaign')
const SEED_TOKEN_CONFIG = new TextEncoder().encode('token_config')

// Canonical Metaplex Token Metadata program id — mirrors METADATA_PROGRAM_ID in
// programs/redax_protocol/src/constants.rs. The output mint's metadata account
// is owned by this external program; this module only READS it for display
// identity (name/symbol/uri) and never writes or hardcodes identity values.
export const METAPLEX_TOKEN_METADATA_PROGRAM_ID = new PublicKey(
  'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s',
)

const SEED_METADATA = new TextEncoder().encode('metadata')

// --- Decoded account shapes (normalized, stable for the mapper) -------------

/** Normalized ProtocolConfig. */
export interface DecodedProtocolConfig {
  protocolFeeAuthority: PublicKey
  protocolEmergencyPauseAuthority: PublicKey
  bump: number
}

/** On-chain CampaignStatus, normalized to a lowercase name (≡ RedaxProgramCampaignStatus). */
export type CampaignStatusName = 'initialized' | 'active' | 'paused' | 'finalized'

/** Normalized Campaign. Integer fields are bigint; `salt` is the raw 32-byte seed. */
export interface DecodedCampaign {
  campaignAdmin: PublicKey
  outputGovernance: PublicKey
  outputMint: PublicKey
  protocolFeeVault: PublicKey
  metadataSetup: boolean
  status: CampaignStatusName
  /**
   * The program's `discovery_status` byte (`u8`), decoded in IDL field order.
   *
   * Decoded here because the Team/Admin S1 post-state readback compares the whole
   * public Campaign body against the frozen plan, and a field that is never read
   * cannot be compared. It is a raw byte on purpose: this adapter does not own the
   * program's discovery vocabulary, and inventing a name for a value the IDL states
   * only as a number would be adapter fiction.
   */
  discoveryStatus: number
  tokenConfigCount: number
  totalOutputMinted: bigint
  /**
   * Cumulative protocol fee minted from this campaign (`total_protocol_fees_minted`
   * in the tracked IDL).
   */
  totalProtocolFeesMinted: bigint
  bump: number
  salt: Uint8Array
  endTs: bigint | null
  maxOutputSupply: bigint
}

/** Normalized TokenConfig. */
export interface DecodedTokenConfig {
  campaign: PublicKey
  legacyMint: PublicKey
  rateNumerator: bigint
  rateDenominator: bigint
  legacyDecimals: number
  outputDecimals: number
  totalOutputMintedFromTc: bigint
  normalizationRemainderTotal: bigint
  maxOutputFromTc: bigint
  bump: number
}

/** A decoded account paired with its on-chain address. */
export interface LocatedCampaign {
  address: PublicKey
  data: DecodedCampaign
}

/** A decoded token config paired with its on-chain address. */
export interface LocatedTokenConfig {
  address: PublicKey
  data: DecodedTokenConfig
}

/**
 * Minimal decoded Metaplex token metadata for an output mint: display identity
 * only (name/symbol/uri after trailing-NUL trim), plus the account's declared
 * mint and update authority for integrity checks.
 */
export interface DecodedOutputTokenMetadata {
  updateAuthority: PublicKey
  mint: PublicKey
  name: string
  symbol: string
  uri: string
}

// --- Coder construction -----------------------------------------------------

/**
 * Build a BorshAccountsCoder bound to the validated runtime program id. The IDL
 * address is swapped to `programId` via the pure `redaxIdlWithProgramId` helper;
 * no provider, no wallet, no Program.
 */
export function buildAccountsCoder(programId: string): BorshAccountsCoder {
  return new BorshAccountsCoder(redaxIdlWithProgramId(programId) as unknown as Idl)
}

// --- Primitive readers (casing-resilient) -----------------------------------

function pick(raw: Record<string, unknown>, camel: string, snake: string): unknown {
  return raw[camel] !== undefined ? raw[camel] : raw[snake]
}

function asPublicKey(value: unknown): PublicKey {
  return value as PublicKey
}

function asBigInt(value: unknown): bigint {
  if (typeof value === 'bigint') {
    return value
  }
  if (value === null || value === undefined) {
    return 0n
  }
  return BigInt((value as { toString(): string }).toString())
}

function asNumber(value: unknown): number {
  if (typeof value === 'number') {
    return value
  }
  return Number((value as { toString(): string }).toString())
}

function asBool(value: unknown): boolean {
  return Boolean(value)
}

function asOptionalBigInt(value: unknown): bigint | null {
  return value === null || value === undefined ? null : asBigInt(value)
}

function asByteArray(value: unknown): Uint8Array {
  return value instanceof Uint8Array ? value : Uint8Array.from(value as ArrayLike<number>)
}

function normalizeStatus(value: unknown): CampaignStatusName {
  // Data-less enum decodes as an object with a single variant key. Anchor's JS
  // convention is a camelCase key (initialized/active/...); the on-disk variant
  // is PascalCase. Lowercase the present key so either casing resolves.
  const key = (Object.keys((value ?? {}) as object)[0] ?? '').toLowerCase()
  switch (key) {
    case 'active':
      return 'active'
    case 'paused':
      return 'paused'
    case 'finalized':
      return 'finalized'
    default:
      return 'initialized'
  }
}

// --- Normalizers ------------------------------------------------------------

function normalizeProtocolConfig(raw: Record<string, unknown>): DecodedProtocolConfig {
  return {
    protocolFeeAuthority: asPublicKey(pick(raw, 'protocolFeeAuthority', 'protocol_fee_authority')),
    protocolEmergencyPauseAuthority: asPublicKey(
      pick(raw, 'protocolEmergencyPauseAuthority', 'protocol_emergency_pause_authority'),
    ),
    bump: asNumber(pick(raw, 'bump', 'bump')),
  }
}

function normalizeCampaign(raw: Record<string, unknown>): DecodedCampaign {
  return {
    campaignAdmin: asPublicKey(pick(raw, 'campaignAdmin', 'campaign_admin')),
    outputGovernance: asPublicKey(pick(raw, 'outputGovernance', 'output_governance')),
    outputMint: asPublicKey(pick(raw, 'outputMint', 'output_mint')),
    protocolFeeVault: asPublicKey(pick(raw, 'protocolFeeVault', 'protocol_fee_vault')),
    metadataSetup: asBool(pick(raw, 'metadataSetup', 'metadata_setup')),
    status: normalizeStatus(raw.status),
    discoveryStatus: asNumber(pick(raw, 'discoveryStatus', 'discovery_status')),
    tokenConfigCount: asNumber(pick(raw, 'tokenConfigCount', 'token_config_count')),
    totalOutputMinted: asBigInt(pick(raw, 'totalOutputMinted', 'total_output_minted')),
    totalProtocolFeesMinted: asBigInt(
      pick(raw, 'totalProtocolFeesMinted', 'total_protocol_fees_minted'),
    ),
    bump: asNumber(pick(raw, 'bump', 'bump')),
    salt: asByteArray(pick(raw, 'salt', 'salt')),
    endTs: asOptionalBigInt(pick(raw, 'endTs', 'end_ts')),
    maxOutputSupply: asBigInt(pick(raw, 'maxOutputSupply', 'max_output_supply')),
  }
}

function normalizeTokenConfig(raw: Record<string, unknown>): DecodedTokenConfig {
  return {
    campaign: asPublicKey(pick(raw, 'campaign', 'campaign')),
    legacyMint: asPublicKey(pick(raw, 'legacyMint', 'legacy_mint')),
    rateNumerator: asBigInt(pick(raw, 'rateNumerator', 'rate_numerator')),
    rateDenominator: asBigInt(pick(raw, 'rateDenominator', 'rate_denominator')),
    legacyDecimals: asNumber(pick(raw, 'legacyDecimals', 'legacy_decimals')),
    outputDecimals: asNumber(pick(raw, 'outputDecimals', 'output_decimals')),
    totalOutputMintedFromTc: asBigInt(pick(raw, 'totalOutputMintedFromTc', 'total_output_minted_from_tc')),
    normalizationRemainderTotal: asBigInt(
      pick(raw, 'normalizationRemainderTotal', 'normalization_remainder_total'),
    ),
    maxOutputFromTc: asBigInt(pick(raw, 'maxOutputFromTc', 'max_output_from_tc')),
    bump: asNumber(pick(raw, 'bump', 'bump')),
  }
}

// --- Low-level guards / derivation ------------------------------------------

function discriminatorMatches(data: Uint8Array, discriminator: readonly number[]): boolean {
  if (data.length < discriminator.length) {
    return false
  }
  for (let i = 0; i < discriminator.length; i += 1) {
    if (data[i] !== discriminator[i]) {
      return false
    }
  }
  return true
}

// Self-contained base58 encoder (Bitcoin alphabet) for the 8-byte discriminator
// memcmp filter. Inlined so this module needs no bs58 dependency import and no
// Buffer; the runtime program id and PublicKey-derived filters use toBase58().
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'

function memcmpBase58(bytes: readonly number[]): string {
  let value = 0n
  for (const byte of bytes) {
    value = value * 256n + BigInt(byte)
  }
  let encoded = ''
  while (value > 0n) {
    encoded = BASE58_ALPHABET[Number(value % 58n)] + encoded
    value /= 58n
  }
  for (const byte of bytes) {
    if (byte !== 0) {
      break
    }
    encoded = `1${encoded}`
  }
  return encoded === '' ? '1' : encoded
}

/** ProtocolConfig PDA + bump for a runtime program id. */
export function deriveProtocolConfigPda(programId: PublicKey): { pda: PublicKey; bump: number } {
  const [pda, bump] = PublicKey.findProgramAddressSync([SEED_PROTOCOL_CONFIG], programId)
  return { pda, bump }
}

/** Recompute the Campaign PDA from its decoded seeds; check address + bump. */
export function verifyCampaignPda(
  address: PublicKey,
  data: DecodedCampaign,
  programId: PublicKey,
): boolean {
  const [derived, bump] = PublicKey.findProgramAddressSync(
    [SEED_CAMPAIGN, data.outputGovernance.toBytes(), data.salt],
    programId,
  )
  return derived.equals(address) && bump === data.bump
}

/** Recompute the TokenConfig PDA from campaign + decoded legacy mint; check link. */
export function verifyTokenConfigPda(
  address: PublicKey,
  data: DecodedTokenConfig,
  campaign: PublicKey,
  programId: PublicKey,
): boolean {
  if (!data.campaign.equals(campaign)) {
    return false
  }
  const [derived, bump] = PublicKey.findProgramAddressSync(
    [SEED_TOKEN_CONFIG, campaign.toBytes(), data.legacyMint.toBytes()],
    programId,
  )
  return derived.equals(address) && bump === data.bump
}


/** Fetch + decode the ProtocolConfig PDA. Missing account -> null (not an error). */
export async function fetchProtocolConfig(
  connection: Connection,
  programId: PublicKey,
  coder: BorshAccountsCoder,
): Promise<DecodedProtocolConfig | null> {
  const { pda, bump } = deriveProtocolConfigPda(programId)
  const info = await connection.getAccountInfo(pda)
  if (!info) {
    return null
  }
  if (!info.owner.equals(programId)) {
    throw new RedaxDevnetAccountError('ACCOUNT_OWNER_MISMATCH')
  }
  if (!discriminatorMatches(info.data, PROTOCOL_CONFIG_DISCRIMINATOR)) {
    throw new RedaxDevnetAccountError('ACCOUNT_DECODE_FAILED')
  }
  let raw: Record<string, unknown>
  try {
    raw = coder.decode(ACCOUNT_NAME.protocolConfig, info.data) as Record<string, unknown>
  } catch {
    throw new RedaxDevnetAccountError('ACCOUNT_DECODE_FAILED')
  }
  const data = normalizeProtocolConfig(raw)
  if (data.bump !== bump) {
    throw new RedaxDevnetAccountError('ACCOUNT_DECODE_FAILED')
  }
  return data
}

/** Fetch + decode one Campaign by address. Missing account -> null (not an error). */
export async function fetchCampaignByAddress(
  connection: Connection,
  programId: PublicKey,
  coder: BorshAccountsCoder,
  address: PublicKey,
): Promise<LocatedCampaign | null> {
  const info = await connection.getAccountInfo(address)
  if (!info) {
    return null
  }
  if (!info.owner.equals(programId)) {
    throw new RedaxDevnetAccountError('ACCOUNT_OWNER_MISMATCH')
  }
  if (!discriminatorMatches(info.data, CAMPAIGN_DISCRIMINATOR)) {
    throw new RedaxDevnetAccountError('ACCOUNT_DECODE_FAILED')
  }
  let raw: Record<string, unknown>
  try {
    raw = coder.decode(ACCOUNT_NAME.campaign, info.data) as Record<string, unknown>
  } catch {
    throw new RedaxDevnetAccountError('ACCOUNT_DECODE_FAILED')
  }
  const data = normalizeCampaign(raw)
  if (!verifyCampaignPda(address, data, programId)) {
    throw new RedaxDevnetAccountError('ACCOUNT_DECODE_FAILED')
  }
  return { address, data }
}

/**
 * List + decode every Campaign owned by the program via getProgramAccounts with a
 * discriminator memcmp filter. A malformed or non-canonical entry is skipped
 * (not a valid REDAX campaign PDA) rather than aborting the whole list.
 */
export async function fetchAllCampaigns(
  connection: Connection,
  programId: PublicKey,
  coder: BorshAccountsCoder,
): Promise<LocatedCampaign[]> {
  const filters: GetProgramAccountsFilter[] = [
    { memcmp: { offset: 0, bytes: memcmpBase58(CAMPAIGN_DISCRIMINATOR) } },
  ]
  const accounts = await connection.getProgramAccounts(programId, { filters })
  const out: LocatedCampaign[] = []
  for (const { pubkey, account } of accounts) {
    if (!discriminatorMatches(account.data, CAMPAIGN_DISCRIMINATOR)) {
      continue
    }
    let raw: Record<string, unknown>
    try {
      raw = coder.decode(ACCOUNT_NAME.campaign, account.data) as Record<string, unknown>
    } catch {
      continue
    }
    const data = normalizeCampaign(raw)
    if (verifyCampaignPda(pubkey, data, programId)) {
      out.push({ address: pubkey, data })
    }
  }
  return out
}

/**
 * List + decode the TokenConfigs of one campaign via getProgramAccounts with a
 * discriminator filter plus a `campaign` memcmp at byte offset 8 (the first field
 * after the 8-byte discriminator). Non-canonical entries are skipped.
 */
export async function fetchTokenConfigsForCampaign(
  connection: Connection,
  programId: PublicKey,
  coder: BorshAccountsCoder,
  campaign: PublicKey,
): Promise<LocatedTokenConfig[]> {
  const filters: GetProgramAccountsFilter[] = [
    { memcmp: { offset: 0, bytes: memcmpBase58(TOKEN_CONFIG_DISCRIMINATOR) } },
    { memcmp: { offset: 8, bytes: campaign.toBase58() } },
  ]
  const accounts = await connection.getProgramAccounts(programId, { filters })
  const out: LocatedTokenConfig[] = []
  for (const { pubkey, account } of accounts) {
    if (!discriminatorMatches(account.data, TOKEN_CONFIG_DISCRIMINATOR)) {
      continue
    }
    let raw: Record<string, unknown>
    try {
      raw = coder.decode(ACCOUNT_NAME.tokenConfig, account.data) as Record<string, unknown>
    } catch {
      continue
    }
    const data = normalizeTokenConfig(raw)
    if (verifyTokenConfigPda(pubkey, data, campaign, programId)) {
      out.push({ address: pubkey, data })
    }
  }
  return out
}

// --- Output-mint Metaplex metadata (read-only display identity) --------------

/** Metaplex metadata PDA for a mint under the canonical metadata program. */
export function deriveOutputTokenMetadataPda(mint: PublicKey): { pda: PublicKey; bump: number } {
  const [pda, bump] = PublicKey.findProgramAddressSync(
    [SEED_METADATA, METAPLEX_TOKEN_METADATA_PROGRAM_ID.toBytes(), mint.toBytes()],
    METAPLEX_TOKEN_METADATA_PROGRAM_ID,
  )
  return { pda, bump }
}

// Metaplex `Metadata` layout, minimally: key u8 (MetadataV1 = 4), update
// authority 32 bytes, mint 32 bytes, then borsh strings name / symbol / uri
// (u32 LE length + bytes; the metadata program pads ("puffs") them with
// trailing NULs). Decoding STOPS after uri — fee/creators/flag/option fields
// are never walked, so no option-layout offset risk exists here. Any bound or
// shape violation resolves to null, never a throw.
const METADATA_KEY_METADATA_V1 = 4
const METADATA_MAX_STRING_LENGTH = 1000

/** The one shape either decoder is used through. Structural, so no DOM or Node lib is needed. */
interface RedaxUtf8Decoder {
  decode(input: Uint8Array): string
}

/**
 * The ONE private UTF-8 decoder resolver, for BOTH decoders in this module.
 *
 * MODULE IMPORT MUST NOT DEPEND ON THE PLATFORM HAVING `TextDecoder`. Constructing one at
 * module scope made a missing `TextDecoder` throw during IMPORT — before any caller could
 * be answered at all, and before the attribution reader could fail closed to `UNREADABLE`.
 * An import that throws is not a fail-closed answer; it is no answer, and it takes every
 * unrelated export of this module down with it.
 *
 * Resolved from `globalThis` structurally and on EVERY call, never cached: a cached `null`
 * would outlive the condition that produced it, and a cached instance would outlive a realm
 * the caller believes it has left. `null` means the platform cannot decode, and each caller
 * turns that into its own fail-closed outcome — the display reader into its existing
 * "no display identity" `null`, and the attribution validator into `false`, which reaches
 * the caller as `UNREADABLE` and never as `ABSENT` or `PRESENT`.
 *
 * THE GLOBAL PROPERTY LOOKUP IS ITSELF INSIDE THE `try`, and that is the whole point of the
 * shape below. `globalThis.TextDecoder` is a PROPERTY ACCESS, not a guaranteed data read: a
 * host, a shim or a hostile realm may install an accessor whose getter throws, and reading
 * it outside the guard let that exception escape a function whose entire contract is to
 * answer `null` instead of throwing. All three hazards — the property lookup, the resulting
 * constructor reference and its invocation — are therefore covered by the SAME `catch`, so
 * no platform shape can turn "cannot decode" into a thrown failure at an unrelated caller.
 *
 * NOT A POLYFILL. Nothing is imported, substituted or hand-rolled; absence stays absence.
 */
function resolveUtf8Decoder(fatal: boolean): RedaxUtf8Decoder | null {
  try {
    const Decoder = (globalThis as { TextDecoder?: unknown }).TextDecoder
    if (typeof Decoder !== 'function') {
      return null
    }
    const decoder = new (Decoder as new (
      label: string,
      options: { fatal: boolean },
    ) => RedaxUtf8Decoder)('utf-8', { fatal })
    return typeof decoder.decode === 'function' ? decoder : null
  } catch {
    return null
  }
}

function readPuffedString(
  data: Uint8Array,
  offset: number,
): { value: string; next: number } | null {
  if (offset + 4 > data.length) {
    return null
  }
  const length = new DataView(data.buffer, data.byteOffset + offset, 4).getUint32(0, true)
  if (length > METADATA_MAX_STRING_LENGTH || offset + 4 + length > data.length) {
    return null
  }
  // A platform with no decoder yields no DISPLAY identity — the same `null` an absent,
  // foreign-owned or undecodable account already produces, and callers already fall back
  // to the address-derived short label. The normal platform behaviour is unchanged: this
  // is still the NON-FATAL decoder, still lossy on purpose, and still trims the metadata
  // program's trailing NUL padding for display and for display only.
  const decoder = resolveUtf8Decoder(false)
  if (decoder === null) {
    return null
  }
  const value = decoder.decode(data.subarray(offset + 4, offset + 4 + length))
  return { value: value.replace(/\0+$/u, '').trim(), next: offset + 4 + length }
}

function decodeOutputTokenMetadata(data: Uint8Array): DecodedOutputTokenMetadata | null {
  if (data.length < 65 || data[0] !== METADATA_KEY_METADATA_V1) {
    return null
  }
  const updateAuthority = new PublicKey(data.subarray(1, 33))
  const mint = new PublicKey(data.subarray(33, 65))
  const name = readPuffedString(data, 65)
  if (name === null) {
    return null
  }
  const symbol = readPuffedString(data, name.next)
  if (symbol === null) {
    return null
  }
  const uri = readPuffedString(data, symbol.next)
  if (uri === null) {
    return null
  }
  if (name.value === '' || symbol.value === '') {
    // An entry with no usable name/symbol is not a display identity.
    return null
  }
  return { updateAuthority, mint, name: name.value, symbol: symbol.value, uri: uri.value }
}

/**
 * Fetch + minimally decode the output mint's Metaplex metadata account.
 * Metadata is OPTIONAL display identity, so unlike the core account fetches this
 * helper NEVER throws: an absent account, a non-Metaplex owner, a decode/bounds
 * failure, or a mint mismatch all return null, and callers fall back to the
 * address-derived short label. Identity values come only from this on-chain
 * read — nothing is hardcoded.
 */
export async function fetchOutputTokenMetadata(
  connection: Connection,
  outputMint: PublicKey,
): Promise<DecodedOutputTokenMetadata | null> {
  try {
    const { pda } = deriveOutputTokenMetadataPda(outputMint)
    const info = await connection.getAccountInfo(pda)
    if (!info || !info.owner.equals(METAPLEX_TOKEN_METADATA_PROGRAM_ID)) {
      return null
    }
    const decoded = decodeOutputTokenMetadata(info.data)
    if (!decoded || !decoded.mint.equals(outputMint)) {
      return null
    }
    return decoded
  } catch {
    return null
  }
}

// --- Classic-SPL associated-token-account reads (read-only) ------------------
//
// Read-only balance / ATA-preparedness reads for a connected wallet. Classic SPL
// only: an account whose Solana owner is not the classic TOKEN_PROGRAM_ID (e.g. a
// Token-2022 account) is reported as a mismatch, never decoded as a balance. No
// associated token account is ever created and no transaction is built.

/** The status of a connected wallet's classic-SPL associated token account for one mint. */
export type ClassicAtaReadKind = 'missing' | 'exists' | 'mismatch' | 'unavailable'

/**
 * A single read of a connected wallet's classic-SPL ATA. `amount` is the decoded
 * base-unit balance only when `kind === 'exists'`; otherwise it is null.
 */
export interface ClassicAtaRead {
  kind: ClassicAtaReadKind
  amount: bigint | null
}

/**
 * Derive the canonical classic-SPL ATA for (owner, mint) under the classic token
 * program. Pure derivation only — no RPC, no send/sign, no mutation, classic SPL
 * only (TOKEN_PROGRAM_ID + ASSOCIATED_TOKEN_PROGRAM_ID; no Token-2022). Exported
 * so the pure `prepare_user_output_ata` instruction builder
 * (redaxDevnetTxBuilders.ts) derives the user output ATA with the exact same
 * derivation these read-only balance/ATA reads use, keeping build and read in
 * agreement and matching the program's own canonical ATA check.
 */
export function deriveClassicAta(owner: PublicKey, mint: PublicKey): PublicKey {
  return getAssociatedTokenAddressSync(
    mint,
    owner,
    false,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  )
}

/**
 * Read a connected wallet's canonical classic-SPL associated token account for
 * (owner, mint), read-only. A missing account -> 'missing' (a normal, non-error
 * state — no account yet / output ATA not prepared). A present account whose
 * Solana owner is not the classic TOKEN_PROGRAM_ID (e.g. Token-2022), or whose
 * decoded SPL owner / mint disagree with the expected wallet / mint, -> 'mismatch'.
 * Any RPC or decode failure -> 'unavailable'. Never throws, never mutates, and
 * never creates an associated token account.
 */
export async function readClassicAtaForOwner(
  connection: Connection,
  owner: PublicKey,
  mint: PublicKey,
): Promise<ClassicAtaRead> {
  try {
    const ata = deriveClassicAta(owner, mint)
    const info = await connection.getAccountInfo(ata)
    if (!info) {
      return { kind: 'missing', amount: null }
    }
    if (!info.owner.equals(TOKEN_PROGRAM_ID)) {
      // Non-classic token program (e.g. Token-2022) — unsupported in Phase 1.
      return { kind: 'mismatch', amount: null }
    }
    // A malformed/undecodable classic account throws here and falls to the outer
    // catch -> 'unavailable' (read could not complete), never a fabricated balance.
    const account = unpackAccount(ata, info, TOKEN_PROGRAM_ID)
    if (!account.owner.equals(owner) || !account.mint.equals(mint)) {
      return { kind: 'mismatch', amount: null }
    }
    return { kind: 'exists', amount: account.amount }
  } catch {
    return { kind: 'unavailable', amount: null }
  }
}

// --- Team/Admin campaign-setup derivations (pure, additive) ------------------
//
// Additive only: nothing above this line changes. These are the shared, pure
// derivations the future Team/Admin campaign-setup planning layer needs. They
// reuse the seed constants already defined in this module (SEED_CAMPAIGN /
// SEED_TOKEN_CONFIG) rather than redeclaring them, because a drifted seed here
// would move the Campaign PDA and permanently strand an output mint whose
// authority was set to the old address. No RPC, no Connection, no wallet, no
// send/sign, no mutation — derivation only. Classic SPL only.

/** The exact salt width the program's Campaign seed expects (`[u8; 32]`). */
export const REDAX_CAMPAIGN_SALT_BYTES = 32

/**
 * Campaign PDA + bump for a runtime program id, seeded exactly as the program
 * does: `[b"campaign", output_governance, salt]` (see the `seeds` constraint on
 * `InitCampaign.campaign`).
 *
 * NOTE the controller seed is **output_governance**, not `campaign_admin` — the
 * two are distinct roles that merely coincide under the initial topology.
 *
 * The Campaign PDA depends only on (output governance, salt) — never on the
 * output mint — so it can be derived BEFORE the mint exists. That ordering is
 * what makes the S1 setup possible at all: the mint is initialized with this
 * PDA as its mint authority.
 *
 * Throws a RangeError on a salt that is not exactly 32 bytes rather than
 * silently deriving a different address.
 */
export function deriveCampaignPda(
  programId: PublicKey,
  outputGovernance: PublicKey,
  salt: Uint8Array,
): { pda: PublicKey; bump: number } {
  if (salt.length !== REDAX_CAMPAIGN_SALT_BYTES) {
    throw new RangeError('campaign salt must be exactly 32 bytes')
  }
  const [pda, bump] = PublicKey.findProgramAddressSync(
    [SEED_CAMPAIGN, outputGovernance.toBytes(), salt],
    programId,
  )
  return { pda, bump }
}

/**
 * TokenConfig PDA + bump, seeded exactly as the program does:
 * `[b"token_config", campaign, legacy_mint]`. The legacy mint is part of the
 * seed, so one campaign can hold at most one TokenConfig per legacy mint — a
 * duplicate legacy mint is therefore a duplicate PDA, not a second row.
 */
export function deriveTokenConfigPda(
  programId: PublicKey,
  campaign: PublicKey,
  legacyMint: PublicKey,
): { pda: PublicKey; bump: number } {
  const [pda, bump] = PublicKey.findProgramAddressSync(
    [SEED_TOKEN_CONFIG, campaign.toBytes(), legacyMint.toBytes()],
    programId,
  )
  return { pda, bump }
}

/**
 * The canonical REDAX protocol fee vault: the classic-SPL associated token
 * account of the ProtocolConfig's `protocol_fee_authority` over the output mint.
 * This mirrors the program's own check, which re-derives the address from
 * ProtocolConfig and rejects any other account — so the destination is ALWAYS
 * derived and is never a team-supplied input.
 *
 * `allowOwnerOffCurve` is **true** here, deliberately and only here: the protocol
 * fee authority may be a PDA or another off-curve identity, and the canonical ATA
 * derivation is defined for such an owner. This is why the fee vault gets its own
 * helper instead of widening `deriveClassicAta` — that helper's on-curve
 * restriction is a USER-ATA safety invariant (a user ATA must belong to a real
 * wallet) and stays exactly as it is.
 */
export function deriveProtocolFeeVaultAta(
  protocolFeeAuthority: PublicKey,
  outputMint: PublicKey,
): PublicKey {
  return getAssociatedTokenAddressSync(
    outputMint,
    protocolFeeAuthority,
    true,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  )
}

// --- Chain-guard coherent account read (pure, additive) ----------------------
//
// Additive only: nothing above this line changes. `fetchProtocolConfig` and every
// existing reader keep their exact current semantics, because the read data source
// depends on them.
//
// This reader exists because those semantics are wrong for a pre-send guard:
// `fetchProtocolConfig` uses `getAccountInfo` (no context slot, no minContextSlot),
// THROWS on an invalid account, and returns `null` when the account is absent — so
// a stale read is indistinguishable from "no such account". A guard must never
// treat a stale or failed read as evidence of anything. This reader therefore
// returns a typed, value-free discriminated union in which every failure is a
// refusal, never a silent absence.
//
// It performs exactly ONE `getMultipleAccountsInfoAndContext`, so the program
// account and the ProtocolConfig account are observed at ONE coherent context
// slot. Reading them separately could straddle an upgrade or an authority change
// and produce a snapshot that never actually existed on chain.
//
// It stays in this module (not in the wallet layer) so the ProtocolConfig
// discriminator, coder, normalizer and bump rule are NOT duplicated: a second copy
// of the account layout would be free to drift from this one.

/** Expected `UpgradeableLoaderState::Program` account size: u32 tag + 32-byte address. */
const UPGRADEABLE_PROGRAM_STATE_LENGTH = 36

/** `UpgradeableLoaderState` enum tag for the `Program` variant (u32, little-endian). */
const UPGRADEABLE_PROGRAM_STATE_TAG = 2

/** Exact ProtocolConfig account size: 8-byte discriminator + two authorities + bump. */
const PROTOCOL_CONFIG_ACCOUNT_LENGTH = 73

/** Value-free reasons the coherent guard read could not produce a valid observation. */
export type RedaxGuardAccountsReadFailureCode =
  | 'PROGRAM_ABSENT'
  | 'PROGRAM_NOT_EXECUTABLE'
  | 'PROGRAM_STATE_INVALID'
  | 'PROTOCOL_CONFIG_ABSENT'
  | 'PROTOCOL_CONFIG_OWNER_MISMATCH'
  | 'PROTOCOL_CONFIG_DISCRIMINATOR_MISMATCH'
  | 'PROTOCOL_CONFIG_DECODE_FAILED'
  | 'PROTOCOL_CONFIG_BUMP_MISMATCH'
  | 'MIN_CONTEXT_UNAVAILABLE'
  | 'RPC_READ_UNAVAILABLE'

/**
 * Structural facts about the deployed program account. No raw bytes and no RPC
 * response object escape.
 *
 * `owner` is returned rather than checked here on purpose: the expected loader
 * identity lives in the wallet layer (`redaxChainIdentity`), and this data module
 * must not import it. The caller performs that equality.
 */
export interface RedaxGuardProgramFacts {
  readonly executable: boolean
  readonly owner: PublicKey
  readonly programDataAddress: PublicKey
}

/** The canonical ProtocolConfig: decoded public state plus the bump the PDA derives. */
export interface RedaxGuardProtocolConfigFacts {
  readonly derivedBump: number
  readonly data: DecodedProtocolConfig
}

/** Options for the coherent guard read. Commitment is explicit and never defaulted. */
export interface RedaxGuardAccountsReadOptions {
  readonly commitment: 'confirmed'
  readonly minContextSlot?: number
}

/** Typed result of the coherent guard read. A failure carries no value of any kind. */
export type RedaxGuardAccountsReadResult =
  | {
      readonly ok: true
      readonly contextSlot: number
      readonly program: RedaxGuardProgramFacts
      readonly protocolConfig: RedaxGuardProtocolConfigFacts
    }
  | {
      readonly ok: false
      readonly code: RedaxGuardAccountsReadFailureCode
      readonly contextSlot: number | null
    }

/**
 * Exactly the account-info shape the installed `Connection` hands back for one entry
 * of a coherent multi-account read — DERIVED from that method's own declaration
 * rather than restated by hand.
 *
 * Restating it is what went wrong the first time: these values were annotated as
 * `AccountInfo<Uint8Array>` to respect this codebase's convention of never naming
 * `Buffer`. But an annotation does not describe a value, it REPLACES its type — and
 * that one replaced the accurate, Buffer-backed type the RPC layer actually returns
 * with a wider one. `BorshAccountsCoder.decode` takes Buffer-backed data, so the
 * decode below stopped type-checking against a value that was, at runtime, already
 * exactly what it needed.
 *
 * Deriving the type from the API keeps both properties at once: no `Buffer` symbol is
 * named anywhere in app source, and the type tells the truth about the value. Nothing
 * is copied, converted or re-wrapped at runtime — there was never anything wrong with
 * the value, only with what we said about it.
 */
type RedaxGuardAccountInfo = Awaited<
  ReturnType<Connection['getMultipleAccountsInfoAndContext']>
>['value'][number]

/**
 * Classify a read exception STRUCTURALLY, by the provider's numeric JSON-RPC code.
 *
 * NOT by matching words in a message: an error string is vendor- and
 * attacker-influenced and is not evidence of anything.
 *
 * NOT by `instanceof SolanaJSONRPCError` either, which looks like the obvious choice
 * and is a trap. `instanceof` is a NOMINAL check against one particular copy of the
 * class, and duplicate package instances are real — this very repository resolves two
 * distinct `@solana/web3.js` copies (the app and the test runner pull different peer
 * contexts), so an error raised by one is not `instanceof` the other's class. The
 * numeric code is identical across copies; the class identity is not.
 *
 * Both outcomes are refusals, so a misclassification could only ever fail closed —
 * but it would make the min-context protection silently unobservable, which is
 * precisely the failure a guard must not have.
 *
 * THE READ ITSELF IS PROTECTED. `error` is whatever a provider threw, and a thrown
 * object can define `code` as an accessor that throws. A plain `error?.code` would
 * then raise INSIDE this classifier, inside the caller's `catch`, and the raw hostile
 * object would escape as a rejection — past the declared refusal union, which is the
 * one thing this reader promises never to do. So the property read happens
 * structurally, through `Reflect.get`, inside a `try`: an accessor failure falls
 * through to the generic refusal instead of becoming the caller's problem.
 *
 * Only the exact numeric code is consulted. No name, message, cause, stack, keyword
 * or stringification is examined, nothing is logged, and no part of `error` is
 * returned or retained.
 */
function classifyGuardReadError(error: unknown): 'MIN_CONTEXT_UNAVAILABLE' | 'RPC_READ_UNAVAILABLE' {
  try {
    if (
      typeof error === 'object' &&
      error !== null &&
      Reflect.get(error, 'code') ===
        SolanaJSONRPCErrorCode.JSON_RPC_SERVER_ERROR_MIN_CONTEXT_SLOT_NOT_REACHED
    ) {
      return 'MIN_CONTEXT_UNAVAILABLE'
    }
  } catch {
    // A throwing accessor is not evidence of anything. Fall through to the
    // value-free generic refusal.
  }
  return 'RPC_READ_UNAVAILABLE'
}

/**
 * Structurally decode an `UpgradeableLoaderState::Program` account: a 4-byte
 * little-endian enum tag of 2 followed by the 32-byte ProgramData address.
 *
 * Hand-decoded on purpose. `@coral-xyz/anchor` exports `decodeUpgradeableLoaderState`,
 * but it returns `any`, throws instead of refusing, and lives in a module that pulls
 * `cross-fetch` and a third-party registry endpoint into the bundle. This is the whole
 * layout we need, so we read it directly and add no dependency.
 */
function decodeUpgradeableProgramState(data: Uint8Array): PublicKey | null {
  if (data.length !== UPGRADEABLE_PROGRAM_STATE_LENGTH) {
    return null
  }
  const tag = new DataView(data.buffer, data.byteOffset, 4).getUint32(0, true)
  if (tag !== UPGRADEABLE_PROGRAM_STATE_TAG) {
    return null
  }
  try {
    return new PublicKey(data.subarray(4, UPGRADEABLE_PROGRAM_STATE_LENGTH))
  } catch {
    return null
  }
}

/**
 * Re-wrap a decoded value as a `PublicKey` of THIS module's web3.js instance, or
 * null. The Borsh coder's output is typed but not validated, and an `instanceof`
 * check would be unreliable across duplicated package instances — so we round-trip
 * through base58, which both validates and normalizes.
 */
function toValidatedPublicKey(value: unknown): PublicKey | null {
  try {
    const candidate = value as { toBase58?: () => string }
    if (typeof candidate?.toBase58 !== 'function') {
      return null
    }
    return new PublicKey(candidate.toBase58())
  } catch {
    return null
  }
}

/**
 * Read the deployed program account and the canonical ProtocolConfig at ONE coherent
 * context slot, for the Holder chain guard.
 *
 * Every failure — absent, malformed, wrong owner, wrong bump, stale, unreachable — is
 * a typed, value-free refusal. No raw error, message, cause, account byte, address or
 * RPC response object is ever returned, and nothing is logged.
 *
 * `minContextSlot` is passed to the request so a node that is behind the accepted
 * preflight context refuses to answer instead of answering staler. The caller must
 * ALSO reject a returned context slot below its own floor — the request option protects
 * request evaluation, not the returned value.
 */
export async function readRedaxGuardAccountsWithContext(
  connection: Connection,
  programId: PublicKey,
  options: RedaxGuardAccountsReadOptions,
): Promise<RedaxGuardAccountsReadResult> {
  const { pda: protocolConfigPda, bump: derivedBump } = deriveProtocolConfigPda(programId)

  let contextSlot: number
  let programInfo: RedaxGuardAccountInfo
  let protocolConfigInfo: RedaxGuardAccountInfo
  try {
    const response = await connection.getMultipleAccountsInfoAndContext(
      [programId, protocolConfigPda],
      options.minContextSlot === undefined
        ? { commitment: options.commitment }
        : { commitment: options.commitment, minContextSlot: options.minContextSlot },
    )
    contextSlot = response.context.slot
    programInfo = response.value[0]
    protocolConfigInfo = response.value[1]
  } catch (error) {
    // The context slot is unknown when the read itself failed. Reporting one would
    // be a fabrication, so it stays null.
    return { ok: false, code: classifyGuardReadError(error), contextSlot: null }
  }

  // --- program account ---
  if (programInfo === null) {
    return { ok: false, code: 'PROGRAM_ABSENT', contextSlot }
  }
  if (!programInfo.executable) {
    return { ok: false, code: 'PROGRAM_NOT_EXECUTABLE', contextSlot }
  }
  const programDataAddress = decodeUpgradeableProgramState(programInfo.data)
  if (programDataAddress === null) {
    return { ok: false, code: 'PROGRAM_STATE_INVALID', contextSlot }
  }

  // --- canonical ProtocolConfig ---
  if (protocolConfigInfo === null) {
    return { ok: false, code: 'PROTOCOL_CONFIG_ABSENT', contextSlot }
  }
  if (!protocolConfigInfo.owner.equals(programId)) {
    return { ok: false, code: 'PROTOCOL_CONFIG_OWNER_MISMATCH', contextSlot }
  }
  if (!discriminatorMatches(protocolConfigInfo.data, PROTOCOL_CONFIG_DISCRIMINATOR)) {
    return { ok: false, code: 'PROTOCOL_CONFIG_DISCRIMINATOR_MISMATCH', contextSlot }
  }
  if (protocolConfigInfo.data.length !== PROTOCOL_CONFIG_ACCOUNT_LENGTH) {
    return { ok: false, code: 'PROTOCOL_CONFIG_DECODE_FAILED', contextSlot }
  }
  let raw: Record<string, unknown>
  try {
    const coder = buildAccountsCoder(programId.toBase58())
    raw = coder.decode(ACCOUNT_NAME.protocolConfig, protocolConfigInfo.data) as Record<string, unknown>
  } catch {
    return { ok: false, code: 'PROTOCOL_CONFIG_DECODE_FAILED', contextSlot }
  }
  const decoded = normalizeProtocolConfig(raw)
  // The normalizer casts; it does not validate. Prove both authorities really are keys.
  const feeAuthority = toValidatedPublicKey(decoded.protocolFeeAuthority)
  const pauseAuthority = toValidatedPublicKey(decoded.protocolEmergencyPauseAuthority)
  if (feeAuthority === null || pauseAuthority === null) {
    return { ok: false, code: 'PROTOCOL_CONFIG_DECODE_FAILED', contextSlot }
  }
  if (decoded.bump !== derivedBump) {
    // A stored bump that is not the canonical bump means this is not the canonical PDA.
    return { ok: false, code: 'PROTOCOL_CONFIG_BUMP_MISMATCH', contextSlot }
  }

  return {
    ok: true,
    contextSlot,
    program: {
      executable: programInfo.executable,
      owner: programInfo.owner,
      programDataAddress,
    },
    protocolConfig: {
      derivedBump,
      data: {
        protocolFeeAuthority: feeAuthority,
        protocolEmergencyPauseAuthority: pauseAuthority,
        bump: decoded.bump,
      },
    },
  }
}

// Additive only: nothing above this line changes. Every existing reader, mapper and
// normalizer keeps its exact current semantics, because the read data source depends
// on them.
//
// WHY THESE EXIST, AND WHY THEY DO NOT REUSE THE NORMALIZERS ABOVE.
// `asBigInt` returns `0n` for a field that is absent, `null` or `undefined`, and
// `asNumber` returns `NaN`. That is a reasonable, forgiving convention for a display
// mapper. It is the wrong convention for a decision that precedes a transaction: a
// truncated, hostile or version-drifted account would silently present a zero
// counter, and a zero counter reads as "nothing minted yet" — the most permissive
// possible answer to a cap projection, and a pre-state that a later exact-delta
// check would then compare against. So every reader below decodes independently and
// REFUSES an absent, undefined or malformed required field. There is no
// missing-to-zero path anywhere in this section.
//
// Each reader is CONTEXT-BEARING. It passes `minContextSlot` so a lagging node
// refuses to answer, AND independently rejects a returned context below the caller's
// floor — the request option protects request EVALUATION, the local check rejects a
// stale ANSWER, and the two defend different things.
//
// Failures are typed and value-free: a code and (when honestly known) a context
// slot. No raw error, message, cause, account byte, RPC response object or endpoint
// is ever returned, and nothing here logs. Classic SPL only. No wallet-layer import,
// no Connection construction, no send, no sign, no simulate, no confirm.

/** Inclusive maxima for the exact on-chain integer widths decoded below. */
const STRICT_U8_MAX = 255
const STRICT_U64_MAX = 18446744073709551615n
const STRICT_U128_MAX = 340282366920938463463374607431768211455n

/** Inclusive bounds for the on-chain signed `i64` campaign deadline. */
const STRICT_I64_MIN = -9223372036854775808n
const STRICT_I64_MAX = 9223372036854775807n

/** Canonical unsigned decimal: no sign, no separators, no leading zero run. */
const STRICT_UNSIGNED_DECIMAL_PATTERN = /^(0|[1-9][0-9]*)$/

/** Canonical signed decimal: an optional single leading minus, then a canonical run. */
const STRICT_SIGNED_DECIMAL_PATTERN = /^-?(0|[1-9][0-9]*)$/

/** Exactly the classic-SPL token-account size. A different length is not one. */
const CLASSIC_TOKEN_ACCOUNT_LENGTH = 165

/** Exactly the classic-SPL mint size. A different length is not a classic mint. */
const CLASSIC_MINT_ACCOUNT_LENGTH = 82

/**
 * Exact Anchor-discriminator-inclusive account allocations.
 */
const CAMPAIGN_ACCOUNT_LENGTH = 231
const TOKEN_CONFIG_ACCOUNT_LENGTH = 155

/** A protected read of one property of an untrusted decoded value. */
type StrictRead = { readonly ok: true; readonly value: unknown } | { readonly ok: false }

const STRICT_READ_FAILED: StrictRead = Object.freeze({ ok: false as const })

/**
 * Read one property structurally.
 *
 * `Reflect.get` inside a `try`, every time: a decoded value is untrusted input, and a
 * hostile object can define a property as an accessor that throws. Consulted this
 * way, such an accessor is simply a failed read rather than an exception escaping
 * past the declared result union. No `instanceof` is used anywhere below — this
 * repository really does resolve duplicate `@solana/web3.js` copies, so a nominal
 * check would be unreliable.
 */
function strictProperty(source: unknown, key: string): StrictRead {
  if (typeof source !== 'object' || source === null) {
    return STRICT_READ_FAILED
  }
  try {
    return { ok: true, value: Reflect.get(source, key) }
  } catch {
    return STRICT_READ_FAILED
  }
}

/**
 * The casing-resilient read, strictly.
 *
 * Like `pick()` above it accepts either the camelCase or the snake_case spelling the
 * coder may produce — but unlike `pick()`, a field that is absent under BOTH
 * spellings, or present as `undefined`, is a FAILED READ and not a value.
 */
function strictPick(raw: unknown, camel: string, snake: string): StrictRead {
  const camelRead = strictProperty(raw, camel)
  if (camelRead.ok && camelRead.value !== undefined) {
    return camelRead
  }
  const snakeRead = strictProperty(raw, snake)
  if (snakeRead.ok && snakeRead.value !== undefined) {
    return snakeRead
  }
  return STRICT_READ_FAILED
}

/** Parse a canonical unsigned decimal string within an inclusive maximum. */
function parseStrictUnsignedDecimal(text: string, max: bigint): bigint | null {
  if (!STRICT_UNSIGNED_DECIMAL_PATTERN.test(text)) {
    return null
  }
  let value: bigint
  try {
    value = BigInt(text)
  } catch {
    return null
  }
  return value <= max ? value : null
}

/**
 * A required unsigned integer, within its exact on-chain width.
 *
 * Accepts the four shapes the coder can produce — bigint, safe number, canonical
 * decimal string, and a BN-like object whose `toString` yields one — and refuses
 * everything else, including a negative value, a non-integer, a non-canonical
 * spelling and an out-of-range magnitude. The BN branch calls `toString` through a
 * protected read, so a throwing or non-function `toString` refuses rather than
 * raises.
 */
function strictUnsignedInteger(read: StrictRead, max: bigint): bigint | null {
  if (!read.ok) {
    return null
  }
  const value = read.value
  if (typeof value === 'bigint') {
    return value >= 0n && value <= max ? value : null
  }
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) {
      return null
    }
    const widened = BigInt(value)
    return widened <= max ? widened : null
  }
  if (typeof value === 'string') {
    return parseStrictUnsignedDecimal(value, max)
  }
  if (typeof value !== 'object' || value === null) {
    return null
  }
  let text: unknown
  try {
    const toText = Reflect.get(value, 'toString')
    if (typeof toText !== 'function') {
      return null
    }
    text = (toText as (this: unknown) => unknown).call(value)
  } catch {
    return null
  }
  return typeof text === 'string' ? parseStrictUnsignedDecimal(text, max) : null
}

/** A required small unsigned integer (u8 / u16), as a JavaScript number. */
function strictSmallUnsigned(read: StrictRead, max: number): number | null {
  const widened = strictUnsignedInteger(read, BigInt(max))
  return widened === null ? null : Number(widened)
}

/**
 * A required account key, re-wrapped as a `PublicKey` of THIS module's package
 * instance. The base58 round-trip both validates and normalizes, which an
 * `instanceof` check could not do across duplicate package copies.
 */
function strictPublicKey(read: StrictRead): PublicKey | null {
  if (!read.ok) {
    return null
  }
  return toValidatedPublicKey(read.value)
}

/** A required fixed-width byte array, copied element by element through protected reads. */
function strictByteArray(read: StrictRead, length: number): Uint8Array | null {
  if (!read.ok || typeof read.value !== 'object' || read.value === null) {
    return null
  }
  const source = read.value
  const lengthRead = strictProperty(source, 'length')
  if (!lengthRead.ok || lengthRead.value !== length) {
    return null
  }
  const copy = new Uint8Array(length)
  for (let index = 0; index < length; index += 1) {
    const element = strictProperty(source, String(index))
    if (
      !element.ok ||
      typeof element.value !== 'number' ||
      !Number.isInteger(element.value) ||
      element.value < 0 ||
      element.value > STRICT_U8_MAX
    ) {
      return null
    }
    copy[index] = element.value
  }
  return copy
}

/** Parse a canonical signed decimal string within inclusive bounds. */
function parseStrictSignedDecimal(text: string, min: bigint, max: bigint): bigint | null {
  if (!STRICT_SIGNED_DECIMAL_PATTERN.test(text) || text === '-0') {
    return null
  }
  let value: bigint
  try {
    value = BigInt(text)
  } catch {
    return null
  }
  return value >= min && value <= max ? value : null
}

/**
 * A required SIGNED integer within its exact on-chain width, in the same four shapes
 * the coder can produce. Separate from `strictUnsignedInteger` because a negative
 * value is legal here and must round-trip rather than refuse.
 */
function strictSignedInteger(read: StrictRead, min: bigint, max: bigint): bigint | null {
  if (!read.ok) {
    return null
  }
  const value = read.value
  if (typeof value === 'bigint') {
    return value >= min && value <= max ? value : null
  }
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) {
      return null
    }
    const widened = BigInt(value)
    return widened >= min && widened <= max ? widened : null
  }
  if (typeof value === 'string') {
    return parseStrictSignedDecimal(value, min, max)
  }
  if (typeof value !== 'object' || value === null) {
    return null
  }
  let text: unknown
  try {
    const toText = Reflect.get(value, 'toString')
    if (typeof toText !== 'function') {
      return null
    }
    text = (toText as (this: unknown) => unknown).call(value)
  } catch {
    return null
  }
  return typeof text === 'string' ? parseStrictSignedDecimal(text, min, max) : null
}

/** A required boolean. Nothing is coerced: only `true` and `false` are readable. */
function strictBoolean(read: StrictRead): boolean | null {
  if (!read.ok || typeof read.value !== 'boolean') {
    return null
  }
  return read.value
}

/**
 * The Campaign lifecycle status, read from the data-less Anchor enum.
 *
 * Unlike `normalizeStatus` above — which folds every unrecognized shape to
 * `initialized` — an unreadable or unknown variant here REFUSES. A lifecycle gate
 * whose failure mode is "assume the earliest state" is not a gate.
 */
function strictCampaignStatus(read: StrictRead): CampaignStatusName | null {
  if (!read.ok || typeof read.value !== 'object' || read.value === null) {
    return null
  }
  let keys: string[]
  try {
    keys = Object.keys(read.value as object)
  } catch {
    return null
  }
  if (keys.length !== 1) {
    return null
  }
  switch (keys[0].toLowerCase()) {
    case 'initialized':
      return 'initialized'
    case 'active':
      return 'active'
    case 'paused':
      return 'paused'
    case 'finalized':
      return 'finalized'
    default:
      return null
  }
}

/** The optional campaign deadline, strictly. `null` is None; anything else is an i64. */
type StrictEndTs = { readonly ok: true; readonly value: bigint | null } | { readonly ok: false }

/**
 * Decode `end_ts` structurally and by width, and DO NOT COMPARE IT TO ANYTHING.
 */
function strictOptionalEndTs(read: StrictRead): StrictEndTs {
  if (!read.ok) {
    // Absent under both spellings, or unreadable. `None` decodes as an explicit
    // `null`, so an unreadable field is drift rather than an absent deadline.
    return { ok: false }
  }
  if (read.value === null) {
    return { ok: true, value: null }
  }
  const value = strictSignedInteger(read, STRICT_I64_MIN, STRICT_I64_MAX)
  return value === null ? { ok: false } : { ok: true, value }
}

/**
 * Exactly the fields of a Campaign that a Holder attempt decision depends on.
 *
 * Deliberately not every field. Each member below is load-bearing for a locked
 * check — PDA re-derivation, an identity link, a lifecycle gate, a recorded pre-state
 * counter, or a cap projection — so nothing here is decoded strictly (and therefore
 * able to refuse) without being used.
 */
interface StrictCampaignFacts {
  readonly campaignAdmin: PublicKey
  readonly outputGovernance: PublicKey
  readonly outputMint: PublicKey
  readonly protocolFeeVault: PublicKey
  readonly status: CampaignStatusName
  readonly metadataSetup: boolean
  readonly discoveryStatus: number
  readonly endTs: bigint | null
  readonly totalOutputMinted: bigint
  readonly totalProtocolFeesMinted: bigint
  readonly maxOutputSupply: bigint
  readonly bump: number
  readonly salt: Uint8Array
}

function strictDecodeCampaign(raw: unknown): StrictCampaignFacts | null {
  const status = strictCampaignStatus(strictProperty(raw, 'status'))
  const metadataSetup = strictBoolean(strictPick(raw, 'metadataSetup', 'metadata_setup'))
  // A `u8` read at full strictness, exactly like `bump`: an absent, wide or
  // non-integral discovery byte is a decode failure rather than a defaulted zero,
  // because a fabricated zero would compare EQUAL to a freshly created Campaign.
  const discoveryStatus = strictSmallUnsigned(
    strictPick(raw, 'discoveryStatus', 'discovery_status'),
    STRICT_U8_MAX,
  )
  const endTs = strictOptionalEndTs(strictPick(raw, 'endTs', 'end_ts'))
  const campaignAdmin = strictPublicKey(strictPick(raw, 'campaignAdmin', 'campaign_admin'))
  const outputGovernance = strictPublicKey(strictPick(raw, 'outputGovernance', 'output_governance'))
  const outputMint = strictPublicKey(strictPick(raw, 'outputMint', 'output_mint'))
  const protocolFeeVault = strictPublicKey(strictPick(raw, 'protocolFeeVault', 'protocol_fee_vault'))
  const totalOutputMinted = strictUnsignedInteger(
    strictPick(raw, 'totalOutputMinted', 'total_output_minted'),
    STRICT_U128_MAX,
  )
  const totalProtocolFeesMinted = strictUnsignedInteger(
    strictPick(raw, 'totalProtocolFeesMinted', 'total_protocol_fees_minted'),
    STRICT_U128_MAX,
  )
  const maxOutputSupply = strictUnsignedInteger(
    strictPick(raw, 'maxOutputSupply', 'max_output_supply'),
    STRICT_U128_MAX,
  )
  const bump = strictSmallUnsigned(strictPick(raw, 'bump', 'bump'), STRICT_U8_MAX)
  const salt = strictByteArray(strictPick(raw, 'salt', 'salt'), REDAX_CAMPAIGN_SALT_BYTES)
  if (
    status === null ||
    metadataSetup === null ||
    discoveryStatus === null ||
    !endTs.ok ||
    campaignAdmin === null ||
    outputGovernance === null ||
    outputMint === null ||
    protocolFeeVault === null ||
    totalOutputMinted === null ||
    totalProtocolFeesMinted === null ||
    maxOutputSupply === null ||
    bump === null ||
    salt === null
  ) {
    return null
  }
  return {
    campaignAdmin,
    outputGovernance,
    outputMint,
    protocolFeeVault,
    status,
    metadataSetup,
    discoveryStatus,
    endTs: endTs.value,
    totalOutputMinted,
    totalProtocolFeesMinted,
    maxOutputSupply,
    bump,
    salt,
  }
}

/** Exactly the fields of a TokenConfig a convert attempt decision depends on. */
interface StrictTokenConfigFacts {
  readonly campaign: PublicKey
  readonly legacyMint: PublicKey
  readonly rateNumerator: bigint
  readonly rateDenominator: bigint
  readonly legacyDecimals: number
  readonly outputDecimals: number
  readonly totalOutputMintedFromTc: bigint
  readonly normalizationRemainderTotal: bigint
  readonly maxOutputFromTc: bigint
  readonly bump: number
}

/**
 * Decode a TokenConfig strictly, naming WHICH class of field failed.
 *
 * The three outcomes are kept distinct because they are three different facts about
 * the account, and a caller that reported them all as one generic decode failure
 * would lose the ability to say that a registered pair really does carry an unusable
 * rate or unreadable decimals.
 *
 * "Valid decimals" here means exactly what the on-chain type guarantees: a present,
 * structurally readable `u8`. No additional numeric ceiling is imposed — the route
 * already carries 6, 9 and 12-decimal legacy mints, and inventing a tighter bound
 * would be a policy choice this reader has no authority to make. The normalization
 * math downstream is exact BigInt arithmetic at any u8 pair.
 */
type StrictTokenConfigDecode =
  | { readonly ok: true; readonly value: StrictTokenConfigFacts }
  | {
      readonly ok: false
      readonly code: 'TOKEN_CONFIG_DECODE_FAILED' | 'DECIMALS_INVALID' | 'RATE_INVALID'
    }

function strictDecodeTokenConfig(raw: unknown): StrictTokenConfigDecode {
  const legacyDecimals = strictSmallUnsigned(
    strictPick(raw, 'legacyDecimals', 'legacy_decimals'),
    STRICT_U8_MAX,
  )
  const outputDecimals = strictSmallUnsigned(
    strictPick(raw, 'outputDecimals', 'output_decimals'),
    STRICT_U8_MAX,
  )
  if (legacyDecimals === null || outputDecimals === null) {
    return { ok: false, code: 'DECIMALS_INVALID' }
  }

  const campaign = strictPublicKey(strictPick(raw, 'campaign', 'campaign'))
  const legacyMint = strictPublicKey(strictPick(raw, 'legacyMint', 'legacy_mint'))
  const rateNumerator = strictUnsignedInteger(
    strictPick(raw, 'rateNumerator', 'rate_numerator'),
    STRICT_U128_MAX,
  )
  const rateDenominator = strictUnsignedInteger(
    strictPick(raw, 'rateDenominator', 'rate_denominator'),
    STRICT_U128_MAX,
  )
  const totalOutputMintedFromTc = strictUnsignedInteger(
    strictPick(raw, 'totalOutputMintedFromTc', 'total_output_minted_from_tc'),
    STRICT_U128_MAX,
  )
  const normalizationRemainderTotal = strictUnsignedInteger(
    strictPick(raw, 'normalizationRemainderTotal', 'normalization_remainder_total'),
    STRICT_U128_MAX,
  )
  const maxOutputFromTc = strictUnsignedInteger(
    strictPick(raw, 'maxOutputFromTc', 'max_output_from_tc'),
    STRICT_U128_MAX,
  )
  const bump = strictSmallUnsigned(strictPick(raw, 'bump', 'bump'), STRICT_U8_MAX)
  if (
    campaign === null ||
    legacyMint === null ||
    rateNumerator === null ||
    rateDenominator === null ||
    totalOutputMintedFromTc === null ||
    normalizationRemainderTotal === null ||
    maxOutputFromTc === null ||
    bump === null
  ) {
    return { ok: false, code: 'TOKEN_CONFIG_DECODE_FAILED' }
  }
  if (rateNumerator === 0n || rateDenominator === 0n) {
    // A zero on either side of the rate cannot produce a conversion at all. The
    // program rejects it; there is no reason to build a transaction that will fail.
    return { ok: false, code: 'RATE_INVALID' }
  }
  return {
    ok: true,
    value: {
      campaign,
      legacyMint,
      rateNumerator,
      rateDenominator,
      legacyDecimals,
      outputDecimals,
      totalOutputMintedFromTc,
      normalizationRemainderTotal,
      maxOutputFromTc,
      bump,
    },
  }
}

/** Every value-free reason a strict Holder account read refuses. Closed and exact. */
export type RedaxHolderStrictReadFailureCode =
  | 'DERIVATION_FAILED'
  | 'CAMPAIGN_ABSENT'
  | 'CAMPAIGN_OWNER_MISMATCH'
  | 'CAMPAIGN_DISCRIMINATOR_MISMATCH'
  | 'CAMPAIGN_DECODE_FAILED'
  | 'CAMPAIGN_LENGTH_MISMATCH'
  | 'CAMPAIGN_PDA_MISMATCH'
  | 'CAMPAIGN_OUTPUT_MINT_MISMATCH'
  | 'CAMPAIGN_FEE_VAULT_MISMATCH'
  | 'CAMPAIGN_NOT_ACTIVE'
  | 'CAMPAIGN_METADATA_NOT_SET'
  | 'TOKEN_CONFIG_ABSENT'
  | 'TOKEN_CONFIG_OWNER_MISMATCH'
  | 'TOKEN_CONFIG_DISCRIMINATOR_MISMATCH'
  | 'TOKEN_CONFIG_DECODE_FAILED'
  | 'TOKEN_CONFIG_LENGTH_MISMATCH'
  | 'TOKEN_CONFIG_PDA_MISMATCH'
  | 'TOKEN_CONFIG_CAMPAIGN_MISMATCH'
  | 'TOKEN_CONFIG_LEGACY_MINT_MISMATCH'
  | 'RATE_INVALID'
  | 'DECIMALS_INVALID'
  | 'PROTOCOL_CONFIG_ABSENT'
  | 'PROTOCOL_CONFIG_OWNER_MISMATCH'
  | 'PROTOCOL_CONFIG_DISCRIMINATOR_MISMATCH'
  | 'PROTOCOL_CONFIG_DECODE_FAILED'
  | 'PROTOCOL_CONFIG_BUMP_MISMATCH'
  | 'TOKEN_ACCOUNT_ABSENT'
  | 'TOKEN_ACCOUNT_PROGRAM_MISMATCH'
  | 'TOKEN_ACCOUNT_DECODE_FAILED'
  | 'TOKEN_ACCOUNT_STATE_NOT_INITIALIZED'
  | 'TOKEN_ACCOUNT_OWNER_MISMATCH'
  | 'TOKEN_ACCOUNT_MINT_MISMATCH'
  | 'MINT_ACCOUNT_ABSENT'
  | 'MINT_ACCOUNT_PROGRAM_MISMATCH'
  | 'MINT_ACCOUNT_DECODE_FAILED'
  | 'MINT_NOT_INITIALIZED'
  | 'MINT_DECIMALS_MISMATCH'
  | 'OUTPUT_MINT_AUTHORITY_MISMATCH'
  | 'OUTPUT_MINT_FREEZE_AUTHORITY_PRESENT'
  | 'OUTPUT_MINT_SUPPLY_ABOVE_CAMPAIGN_TOTAL'
  | 'MIN_CONTEXT_UNAVAILABLE'
  | 'RPC_READ_UNAVAILABLE'

/** Options for a strict Holder read. Commitment is explicit and never defaulted. */
export interface RedaxHolderStrictReadOptions {
  readonly commitment: 'confirmed'
  readonly minContextSlot?: number
}

/** The Campaign identity a guard's loaded graph is built from. */
export interface RedaxHolderLoadedCampaignFacts {
  readonly address: PublicKey
  readonly outputMint: PublicKey
  readonly protocolFeeVault: PublicKey
}

/** The TokenConfig identity a convert attempt's loaded graph is built from. */
export interface RedaxHolderLoadedTokenConfigFacts {
  readonly address: PublicKey
  readonly campaign: PublicKey
  readonly legacyMint: PublicKey
}

/** Exactly the two Holder actions, as a fresh-identity read request. */
export type RedaxHolderLoadedIdentityRequest =
  | {
      readonly kind: 'prepare_user_output_ata'
      readonly campaign: PublicKey
      readonly outputMint: PublicKey
    }
  | {
      readonly kind: 'convert_exact_in'
      readonly campaign: PublicKey
      readonly tokenConfig: PublicKey
      readonly legacyMint: PublicKey
      readonly outputMint: PublicKey
      readonly protocolFeeVault: PublicKey
    }

export type RedaxHolderLoadedIdentityResult =
  | {
      readonly ok: true
      readonly contextSlot: number
      readonly campaign: RedaxHolderLoadedCampaignFacts
      readonly tokenConfig: RedaxHolderLoadedTokenConfigFacts | null
    }
  | {
      readonly ok: false
      readonly code: RedaxHolderStrictReadFailureCode
      readonly contextSlot: number | null
    }

function strictReadFailure(
  code: RedaxHolderStrictReadFailureCode,
  contextSlot: number | null,
): { readonly ok: false; readonly code: RedaxHolderStrictReadFailureCode; readonly contextSlot: number | null } {
  return { ok: false, code, contextSlot }
}

/**
 * Read the FRESH on-chain identity graph a Holder attempt's guard baseline is built
 * from, at one coherent context slot.
 *
 * This exists because a guard whose "loaded" graph is the caller's own request
 * reflected back at it validates nothing: it would compare the request to itself and
 * agree. The graph must come from chain, and it must come from chain BEFORE the
 * baseline is frozen — which is why this read precedes Phase A rather than following
 * it.
 *
 * Everything the program itself re-derives is re-derived here: the Campaign PDA from
 * its own decoded seeds, and (for convert) the TokenConfig PDA from campaign and
 * legacy mint. Address equality alone would accept a structurally valid account that
 * simply is not the canonical one.
 */
export async function readRedaxHolderLoadedIdentityWithContext(
  connection: Connection,
  programId: PublicKey,
  request: RedaxHolderLoadedIdentityRequest,
  options: RedaxHolderStrictReadOptions,
): Promise<RedaxHolderLoadedIdentityResult> {
  const isConvert = request.kind === 'convert_exact_in'
  const addresses = isConvert ? [request.campaign, request.tokenConfig] : [request.campaign]

  let contextSlot: number
  let values: readonly RedaxGuardAccountInfo[]
  try {
    const response = await connection.getMultipleAccountsInfoAndContext(
      [...addresses],
      options.minContextSlot === undefined
        ? { commitment: options.commitment }
        : { commitment: options.commitment, minContextSlot: options.minContextSlot },
    )
    contextSlot = response.context.slot
    values = response.value
  } catch (error) {
    return strictReadFailure(classifyGuardReadError(error), null)
  }
  if (options.minContextSlot !== undefined && contextSlot < options.minContextSlot) {
    // The request option protects request EVALUATION; this rejects a stale ANSWER.
    return strictReadFailure('MIN_CONTEXT_UNAVAILABLE', contextSlot)
  }

  const coder = buildAccountsCoder(programId.toBase58())

  // --- Campaign ---
  const campaignInfo = values[0] ?? null
  if (campaignInfo === null) {
    return strictReadFailure('CAMPAIGN_ABSENT', contextSlot)
  }
  if (!campaignInfo.owner.equals(programId)) {
    return strictReadFailure('CAMPAIGN_OWNER_MISMATCH', contextSlot)
  }
  if (!discriminatorMatches(campaignInfo.data, CAMPAIGN_DISCRIMINATOR)) {
    return strictReadFailure('CAMPAIGN_DISCRIMINATOR_MISMATCH', contextSlot)
  }
  if (campaignInfo.data.length !== CAMPAIGN_ACCOUNT_LENGTH) {
    // Exact equality, not a minimum: Anchor's Borsh decode does not require slice
    // exhaustion, so a longer account can decode into plausible values.
    return strictReadFailure('CAMPAIGN_LENGTH_MISMATCH', contextSlot)
  }
  let campaignRaw: unknown
  try {
    campaignRaw = coder.decode(ACCOUNT_NAME.campaign, campaignInfo.data)
  } catch {
    return strictReadFailure('CAMPAIGN_DECODE_FAILED', contextSlot)
  }
  const campaign = strictDecodeCampaign(campaignRaw)
  if (campaign === null) {
    return strictReadFailure('CAMPAIGN_DECODE_FAILED', contextSlot)
  }
  let derivedCampaign: { pda: PublicKey; bump: number }
  try {
    derivedCampaign = deriveCampaignPda(programId, campaign.outputGovernance, campaign.salt)
  } catch {
    return strictReadFailure('CAMPAIGN_PDA_MISMATCH', contextSlot)
  }
  if (!derivedCampaign.pda.equals(request.campaign) || derivedCampaign.bump !== campaign.bump) {
    return strictReadFailure('CAMPAIGN_PDA_MISMATCH', contextSlot)
  }
  if (!campaign.outputMint.equals(request.outputMint)) {
    return strictReadFailure('CAMPAIGN_OUTPUT_MINT_MISMATCH', contextSlot)
  }

  const loadedCampaign: RedaxHolderLoadedCampaignFacts = {
    address: request.campaign,
    outputMint: campaign.outputMint,
    protocolFeeVault: campaign.protocolFeeVault,
  }

  if (!isConvert) {
    return { ok: true, contextSlot, campaign: loadedCampaign, tokenConfig: null }
  }

  // The vault the request names must be the vault this Campaign actually carries.
  // The canonical DERIVATION from the fresh ProtocolConfig fee authority is the chain
  // guard's check, not this module's — this is the Campaign-side half of it.
  if (!campaign.protocolFeeVault.equals(request.protocolFeeVault)) {
    return strictReadFailure('CAMPAIGN_FEE_VAULT_MISMATCH', contextSlot)
  }

  // --- TokenConfig ---
  const tokenConfigInfo = values[1] ?? null
  if (tokenConfigInfo === null) {
    return strictReadFailure('TOKEN_CONFIG_ABSENT', contextSlot)
  }
  if (!tokenConfigInfo.owner.equals(programId)) {
    return strictReadFailure('TOKEN_CONFIG_OWNER_MISMATCH', contextSlot)
  }
  if (!discriminatorMatches(tokenConfigInfo.data, TOKEN_CONFIG_DISCRIMINATOR)) {
    return strictReadFailure('TOKEN_CONFIG_DISCRIMINATOR_MISMATCH', contextSlot)
  }
  if (tokenConfigInfo.data.length !== TOKEN_CONFIG_ACCOUNT_LENGTH) {
    return strictReadFailure('TOKEN_CONFIG_LENGTH_MISMATCH', contextSlot)
  }
  let tokenConfigRaw: unknown
  try {
    tokenConfigRaw = coder.decode(ACCOUNT_NAME.tokenConfig, tokenConfigInfo.data)
  } catch {
    return strictReadFailure('TOKEN_CONFIG_DECODE_FAILED', contextSlot)
  }
  const tokenConfigDecode = strictDecodeTokenConfig(tokenConfigRaw)
  if (!tokenConfigDecode.ok) {
    return strictReadFailure(tokenConfigDecode.code, contextSlot)
  }
  const tokenConfig = tokenConfigDecode.value
  if (!tokenConfig.campaign.equals(request.campaign)) {
    return strictReadFailure('TOKEN_CONFIG_CAMPAIGN_MISMATCH', contextSlot)
  }
  const derivedTokenConfig = deriveTokenConfigPda(programId, request.campaign, tokenConfig.legacyMint)
  if (
    !derivedTokenConfig.pda.equals(request.tokenConfig) ||
    derivedTokenConfig.bump !== tokenConfig.bump
  ) {
    return strictReadFailure('TOKEN_CONFIG_PDA_MISMATCH', contextSlot)
  }
  if (!tokenConfig.legacyMint.equals(request.legacyMint)) {
    return strictReadFailure('TOKEN_CONFIG_LEGACY_MINT_MISMATCH', contextSlot)
  }

  return {
    ok: true,
    contextSlot,
    campaign: loadedCampaign,
    tokenConfig: {
      address: request.tokenConfig,
      campaign: tokenConfig.campaign,
      legacyMint: tokenConfig.legacyMint,
    },
  }
}

// --- Prepare pre-state / effect reader ---------------------------------------

/**
 * Exactly the account-info shape the installed `Connection` hands back for a single
 * context-bearing account read. Derived from the method's own declaration for the
 * same reason `RedaxGuardAccountInfo` is: an annotation would REPLACE the accurate
 * Buffer-backed type rather than describe it.
 */
type RedaxSingleAccountInfo = Awaited<
  ReturnType<Connection['getAccountInfoAndContext']>
>['value']

/** What the canonical user output ATA is, at one observed context. */
export type RedaxPrepareOutputAtaStateKind = 'MISSING' | 'PRESENT_CANONICAL' | 'MISMATCH'

/** Why the state could not be observed. Never confused with `MISSING`. */
export type RedaxPrepareOutputAtaReadFailureCode =
  | 'DERIVATION_FAILED'
  | 'READ_UNAVAILABLE'
  | 'CONTEXT_BEHIND_MINIMUM'

export type RedaxPrepareOutputAtaStateResult =
  | {
      readonly ok: true
      readonly kind: RedaxPrepareOutputAtaStateKind
      readonly userOutputAta: PublicKey
      readonly amount: bigint | null
      readonly contextSlot: number
    }
  | {
      readonly ok: false
      readonly code: RedaxPrepareOutputAtaReadFailureCode
      readonly userOutputAta: PublicKey | null
      readonly contextSlot: number | null
    }

/**
 * Observe the connected wallet's canonical output ATA, with context.
 *
 * The distinction this reader exists to preserve is between "the account is not
 * there" and "we could not find out". `readClassicAtaForOwner` above collapses an RPC
 * or decode failure into `unavailable` with no context slot at all, which is fine for
 * a display panel and useless for an attempt: a prepare that treats an unreadable
 * account as MISSING would record a false pre-state, and one that treats a STALE read
 * as MISSING would record a pre-state from before an ATA it is about to create.
 *
 * So: a missing account is `MISSING`; a present account that is not the wallet's
 * canonical classic-SPL account for this mint is `MISMATCH`; and every RPC, decode or
 * staleness failure is a REFUSAL that is never any of those.
 */
export async function readRedaxPrepareOutputAtaStateWithContext(
  connection: Connection,
  request: { readonly wallet: PublicKey; readonly outputMint: PublicKey },
  options: RedaxHolderStrictReadOptions,
): Promise<RedaxPrepareOutputAtaStateResult> {
  let userOutputAta: PublicKey
  try {
    userOutputAta = deriveClassicAta(request.wallet, request.outputMint)
  } catch {
    return { ok: false, code: 'DERIVATION_FAILED', userOutputAta: null, contextSlot: null }
  }

  let contextSlot: number
  let info: RedaxSingleAccountInfo
  try {
    const response = await connection.getAccountInfoAndContext(
      userOutputAta,
      options.minContextSlot === undefined
        ? { commitment: options.commitment }
        : { commitment: options.commitment, minContextSlot: options.minContextSlot },
    )
    contextSlot = response.context.slot
    info = response.value
  } catch (error) {
    return {
      ok: false,
      code:
        classifyGuardReadError(error) === 'MIN_CONTEXT_UNAVAILABLE'
          ? 'CONTEXT_BEHIND_MINIMUM'
          : 'READ_UNAVAILABLE',
      userOutputAta,
      contextSlot: null,
    }
  }
  if (options.minContextSlot !== undefined && contextSlot < options.minContextSlot) {
    return { ok: false, code: 'CONTEXT_BEHIND_MINIMUM', userOutputAta, contextSlot }
  }

  if (info === null) {
    return { ok: true, kind: 'MISSING', userOutputAta, amount: null, contextSlot }
  }
  if (!info.owner.equals(TOKEN_PROGRAM_ID)) {
    // A non-classic token program (Token-2022) is unsupported in Phase 1 — and it is
    // a MISMATCH, never an absence.
    return { ok: true, kind: 'MISMATCH', userOutputAta, amount: null, contextSlot }
  }
  if (info.data.length !== CLASSIC_TOKEN_ACCOUNT_LENGTH) {
    return { ok: true, kind: 'MISMATCH', userOutputAta, amount: null, contextSlot }
  }
  let account: ReturnType<typeof unpackAccount>
  try {
    account = unpackAccount(userOutputAta, info, TOKEN_PROGRAM_ID)
  } catch {
    // An undecodable account is a read we could not complete — never MISSING.
    return { ok: false, code: 'READ_UNAVAILABLE', userOutputAta, contextSlot }
  }
  if (classicTokenAccountState(account) !== AccountState.Initialized) {
    // Exactly `Initialized`. An uninitialized allocation is not a prepared account,
    // and a FROZEN one cannot receive the output mint — neither is canonical, and
    // neither is an absence either.
    return { ok: true, kind: 'MISMATCH', userOutputAta, amount: null, contextSlot }
  }
  if (!account.owner.equals(request.wallet) || !account.mint.equals(request.outputMint)) {
    return { ok: true, kind: 'MISMATCH', userOutputAta, amount: null, contextSlot }
  }
  return { ok: true, kind: 'PRESENT_CANONICAL', userOutputAta, amount: account.amount, contextSlot }
}

// --- Convert coherent pre-state / effect reader -------------------------------

/** The five accounts a convert attempt's exact delta check is measured against. */
export interface RedaxConvertCoherentStateRequest {
  readonly wallet: PublicKey
  readonly campaign: PublicKey
  readonly tokenConfig: PublicKey
  readonly legacyMint: PublicKey
  readonly outputMint: PublicKey
  readonly protocolFeeVault: PublicKey
}

/** Every value a convert pre-state, quote revalidation or effect check consumes. */
export interface RedaxConvertCoherentStateFacts {
  readonly userLegacyAta: PublicKey
  readonly userOutputAta: PublicKey
  readonly userLegacyAmount: bigint
  readonly userOutputAmount: bigint
  readonly protocolFeeVaultAmount: bigint
  readonly campaignTotalOutputMinted: bigint
  readonly campaignTotalProtocolFeesMinted: bigint
  readonly tokenConfigTotalOutputMintedFromTc: bigint
  readonly tokenConfigNormalizationRemainderTotal: bigint
  readonly rateNumerator: bigint
  readonly rateDenominator: bigint
  readonly legacyDecimals: number
  readonly outputDecimals: number
  readonly maxOutputSupply: bigint
  readonly maxOutputFromTc: bigint
}

export type RedaxConvertCoherentStateResult =
  | {
      readonly ok: true
      readonly contextSlot: number
      readonly state: RedaxConvertCoherentStateFacts
    }
  | {
      readonly ok: false
      readonly code: RedaxHolderStrictReadFailureCode
      readonly contextSlot: number | null
    }

/**
 * Validate one classic-SPL token account against its exact expected owner and mint.
 *
 * Returns the balance, or the exact reason it is not a usable observation. A token
 * account read for an exact-delta comparison must be all-or-nothing: a balance
 * accepted from an account that is not the one we think it is would make the later
 * "before + netOut" check meaningless.
 */
/**
 * The exact `AccountState` of an unpacked classic-SPL token account.
 *
 * `unpackAccount` exposes the raw state byte only as the derived pair
 * `isInitialized` / `isFrozen`, and that pair determines the variant exactly:
 * uninitialized iff not initialized, frozen iff frozen, and initialized otherwise.
 * Recovering the enum here lets the caller compare against
 * `AccountState.Initialized` itself rather than against two booleans that happen to
 * mean the same thing.
 */
function classicTokenAccountState(account: ReturnType<typeof unpackAccount>): AccountState {
  if (account.isFrozen) {
    return AccountState.Frozen
  }
  return account.isInitialized ? AccountState.Initialized : AccountState.Uninitialized
}

function strictTokenAccountAmount(
  address: PublicKey,
  info: RedaxGuardAccountInfo,
  expectedOwner: PublicKey,
  expectedMint: PublicKey,
): { readonly ok: true; readonly amount: bigint } | { readonly ok: false; readonly code: RedaxHolderStrictReadFailureCode } {
  if (info === null) {
    return { ok: false, code: 'TOKEN_ACCOUNT_ABSENT' }
  }
  if (!info.owner.equals(TOKEN_PROGRAM_ID)) {
    return { ok: false, code: 'TOKEN_ACCOUNT_PROGRAM_MISMATCH' }
  }
  if (info.data.length !== CLASSIC_TOKEN_ACCOUNT_LENGTH) {
    return { ok: false, code: 'TOKEN_ACCOUNT_DECODE_FAILED' }
  }
  let account: ReturnType<typeof unpackAccount>
  try {
    account = unpackAccount(address, info, TOKEN_PROGRAM_ID)
  } catch {
    return { ok: false, code: 'TOKEN_ACCOUNT_DECODE_FAILED' }
  }
  if (classicTokenAccountState(account) !== AccountState.Initialized) {
    // Exactly `Initialized`, so neither an uninitialized allocation nor a FROZEN
    // account passes. A frozen account cannot receive a mint or authorise a burn, and
    // a pre-state measured from one would predict a delta that cannot happen.
    return { ok: false, code: 'TOKEN_ACCOUNT_STATE_NOT_INITIALIZED' }
  }
  if (!account.owner.equals(expectedOwner)) {
    return { ok: false, code: 'TOKEN_ACCOUNT_OWNER_MISMATCH' }
  }
  if (!account.mint.equals(expectedMint)) {
    return { ok: false, code: 'TOKEN_ACCOUNT_MINT_MISMATCH' }
  }
  if (account.amount < 0n || account.amount > STRICT_U64_MAX) {
    return { ok: false, code: 'TOKEN_ACCOUNT_DECODE_FAILED' }
  }
  return { ok: true, amount: account.amount }
}

/** The classic-SPL mint facts a convert decision links against. */
interface StrictMintFacts {
  readonly decimals: number
  readonly supply: bigint
  readonly mintAuthority: PublicKey | null
  readonly freezeAuthority: PublicKey | null
}

/**
 * Validate one classic-SPL mint account: owner, exact 82-byte length, decodability,
 * initialized state, and the declared decimals.
 *
 * The DECIMALS LINK is the point. `TokenConfig.legacy_decimals` and
 * `.output_decimals` are immutable copies taken at registration from mint accounts
 * the program validated then. Re-reading the mints now proves the normalization the
 * quote is about to perform still matches the tokens that will actually move.
 */
function strictMintFacts(
  address: PublicKey,
  info: RedaxGuardAccountInfo,
  expectedDecimals: number,
): { readonly ok: true; readonly value: StrictMintFacts } | { readonly ok: false; readonly code: RedaxHolderStrictReadFailureCode } {
  if (info === null) {
    return { ok: false, code: 'MINT_ACCOUNT_ABSENT' }
  }
  if (!info.owner.equals(TOKEN_PROGRAM_ID)) {
    return { ok: false, code: 'MINT_ACCOUNT_PROGRAM_MISMATCH' }
  }
  if (info.data.length !== CLASSIC_MINT_ACCOUNT_LENGTH) {
    // Exactly the classic layout. A longer account is a Token-2022 or extension mint,
    // which Phase 1 does not support and must not silently accept.
    return { ok: false, code: 'MINT_ACCOUNT_DECODE_FAILED' }
  }
  let mint: ReturnType<typeof unpackMint>
  try {
    mint = unpackMint(address, info, TOKEN_PROGRAM_ID)
  } catch {
    return { ok: false, code: 'MINT_ACCOUNT_DECODE_FAILED' }
  }
  if (!mint.isInitialized) {
    return { ok: false, code: 'MINT_NOT_INITIALIZED' }
  }
  if (mint.decimals !== expectedDecimals) {
    return { ok: false, code: 'MINT_DECIMALS_MISMATCH' }
  }
  if (mint.supply < 0n || mint.supply > STRICT_U64_MAX) {
    return { ok: false, code: 'MINT_ACCOUNT_DECODE_FAILED' }
  }
  return {
    ok: true,
    value: {
      decimals: mint.decimals,
      supply: mint.supply,
      mintAuthority: mint.mintAuthority,
      freezeAuthority: mint.freezeAuthority,
    },
  }
}

/**
 * Validate the canonical ProtocolConfig for this program, at the caller's already
 * observed coherent context.
 *
 * The fee AUTHORITY is what a convert needs: the protocol fee vault's internal token
 * owner must be the authority the protocol currently declares, and a vault owned by
 * anybody else is not the canonical vault however plausible its mint and balance
 * look. The address is re-derived from the program id — never accepted from a caller.
 */
function strictProtocolConfigFeeAuthority(
  info: RedaxGuardAccountInfo,
  programId: PublicKey,
  derivedBump: number,
): { readonly ok: true; readonly feeAuthority: PublicKey } | { readonly ok: false; readonly code: RedaxHolderStrictReadFailureCode } {
  if (info === null) {
    return { ok: false, code: 'PROTOCOL_CONFIG_ABSENT' }
  }
  if (!info.owner.equals(programId)) {
    return { ok: false, code: 'PROTOCOL_CONFIG_OWNER_MISMATCH' }
  }
  if (!discriminatorMatches(info.data, PROTOCOL_CONFIG_DISCRIMINATOR)) {
    return { ok: false, code: 'PROTOCOL_CONFIG_DISCRIMINATOR_MISMATCH' }
  }
  if (info.data.length !== PROTOCOL_CONFIG_ACCOUNT_LENGTH) {
    return { ok: false, code: 'PROTOCOL_CONFIG_DECODE_FAILED' }
  }
  let raw: unknown
  try {
    raw = buildAccountsCoder(programId.toBase58()).decode(ACCOUNT_NAME.protocolConfig, info.data)
  } catch {
    return { ok: false, code: 'PROTOCOL_CONFIG_DECODE_FAILED' }
  }
  const feeAuthority = strictPublicKey(
    strictPick(raw, 'protocolFeeAuthority', 'protocol_fee_authority'),
  )
  const pauseAuthority = strictPublicKey(
    strictPick(raw, 'protocolEmergencyPauseAuthority', 'protocol_emergency_pause_authority'),
  )
  const bump = strictSmallUnsigned(strictPick(raw, 'bump', 'bump'), STRICT_U8_MAX)
  if (feeAuthority === null || pauseAuthority === null || bump === null) {
    return { ok: false, code: 'PROTOCOL_CONFIG_DECODE_FAILED' }
  }
  if (bump !== derivedBump) {
    // A stored bump that is not the canonical bump means this is not the canonical PDA.
    return { ok: false, code: 'PROTOCOL_CONFIG_BUMP_MISMATCH' }
  }
  return { ok: true, feeAuthority }
}

/**
 * Read the complete convert state — three token accounts, the Campaign, the
 * TokenConfig, the canonical ProtocolConfig and BOTH mints — at ONE coherent context
 * slot.
 *
 * ONE `getMultipleAccountsInfoAndContext`, deliberately, over exactly eight accounts.
 * Reading them separately could straddle another conversion, an authority rotation or
 * a lifecycle change and produce a "pre-state" that never existed on chain at any
 * single moment; the exact seven-field delta check that runs after the attempt would
 * then be measured against a snapshot nobody ever observed. There is deliberately NO
 * follow-up account read: a second round trip would reintroduce exactly that straddle.
 *
 * Every account is REQUIRED. There is no partial state: a convert whose fee vault,
 * ProtocolConfig or mint could not be read has no pre-state, and a pre-state with a
 * fabricated zero in it is worse than none at all.
 */
export async function readRedaxConvertCoherentStateWithContext(
  connection: Connection,
  programId: PublicKey,
  request: RedaxConvertCoherentStateRequest,
  options: RedaxHolderStrictReadOptions,
): Promise<RedaxConvertCoherentStateResult> {
  let userLegacyAta: PublicKey
  let userOutputAta: PublicKey
  let protocolConfigPda: PublicKey
  let protocolConfigBump: number
  try {
    userLegacyAta = deriveClassicAta(request.wallet, request.legacyMint)
    userOutputAta = deriveClassicAta(request.wallet, request.outputMint)
    const derived = deriveProtocolConfigPda(programId)
    protocolConfigPda = derived.pda
    protocolConfigBump = derived.bump
  } catch {
    return strictReadFailure('DERIVATION_FAILED', null)
  }

  let contextSlot: number
  let values: readonly RedaxGuardAccountInfo[]
  try {
    const response = await connection.getMultipleAccountsInfoAndContext(
      [
        userLegacyAta,
        userOutputAta,
        request.protocolFeeVault,
        request.campaign,
        request.tokenConfig,
        protocolConfigPda,
        request.legacyMint,
        request.outputMint,
      ],
      options.minContextSlot === undefined
        ? { commitment: options.commitment }
        : { commitment: options.commitment, minContextSlot: options.minContextSlot },
    )
    contextSlot = response.context.slot
    values = response.value
  } catch (error) {
    return strictReadFailure(classifyGuardReadError(error), null)
  }
  if (options.minContextSlot !== undefined && contextSlot < options.minContextSlot) {
    return strictReadFailure('MIN_CONTEXT_UNAVAILABLE', contextSlot)
  }

  // --- the canonical ProtocolConfig, which the fee vault is then measured against ---
  const protocolConfig = strictProtocolConfigFeeAuthority(
    values[5] ?? null,
    programId,
    protocolConfigBump,
  )
  if (!protocolConfig.ok) {
    return strictReadFailure(protocolConfig.code, contextSlot)
  }

  // --- the three classic-SPL token accounts ---
  const legacy = strictTokenAccountAmount(
    userLegacyAta,
    values[0] ?? null,
    request.wallet,
    request.legacyMint,
  )
  if (!legacy.ok) {
    return strictReadFailure(legacy.code, contextSlot)
  }
  const output = strictTokenAccountAmount(
    userOutputAta,
    values[1] ?? null,
    request.wallet,
    request.outputMint,
  )
  if (!output.ok) {
    return strictReadFailure(output.code, contextSlot)
  }
  // The fee vault is now measured all the way to its authority: its internal token
  // owner must be the FRESH protocol fee authority read in this same coherent
  // snapshot. A vault owned by anybody else is not the canonical vault, however
  // plausible its mint and balance look.
  const feeVault = strictTokenAccountAmount(
    request.protocolFeeVault,
    values[2] ?? null,
    protocolConfig.feeAuthority,
    request.outputMint,
  )
  if (!feeVault.ok) {
    return strictReadFailure(feeVault.code, contextSlot)
  }

  const coder = buildAccountsCoder(programId.toBase58())

  // --- Campaign ---
  const campaignInfo = values[3] ?? null
  if (campaignInfo === null) {
    return strictReadFailure('CAMPAIGN_ABSENT', contextSlot)
  }
  if (!campaignInfo.owner.equals(programId)) {
    return strictReadFailure('CAMPAIGN_OWNER_MISMATCH', contextSlot)
  }
  if (!discriminatorMatches(campaignInfo.data, CAMPAIGN_DISCRIMINATOR)) {
    return strictReadFailure('CAMPAIGN_DISCRIMINATOR_MISMATCH', contextSlot)
  }
  if (campaignInfo.data.length !== CAMPAIGN_ACCOUNT_LENGTH) {
    return strictReadFailure('CAMPAIGN_LENGTH_MISMATCH', contextSlot)
  }
  let campaignRaw: unknown
  try {
    campaignRaw = coder.decode(ACCOUNT_NAME.campaign, campaignInfo.data)
  } catch {
    return strictReadFailure('CAMPAIGN_DECODE_FAILED', contextSlot)
  }
  const campaign = strictDecodeCampaign(campaignRaw)
  if (campaign === null) {
    return strictReadFailure('CAMPAIGN_DECODE_FAILED', contextSlot)
  }
  let derivedCampaign: { pda: PublicKey; bump: number }
  try {
    derivedCampaign = deriveCampaignPda(programId, campaign.outputGovernance, campaign.salt)
  } catch {
    return strictReadFailure('CAMPAIGN_PDA_MISMATCH', contextSlot)
  }
  if (!derivedCampaign.pda.equals(request.campaign) || derivedCampaign.bump !== campaign.bump) {
    return strictReadFailure('CAMPAIGN_PDA_MISMATCH', contextSlot)
  }
  if (!campaign.outputMint.equals(request.outputMint)) {
    return strictReadFailure('CAMPAIGN_OUTPUT_MINT_MISMATCH', contextSlot)
  }
  if (!campaign.protocolFeeVault.equals(request.protocolFeeVault)) {
    return strictReadFailure('CAMPAIGN_FEE_VAULT_MISMATCH', contextSlot)
  }
  // The two lifecycle gates a convert depends on. `Initialized`, `Paused` and
  // `Finalized` all refuse, and so does a campaign whose metadata was never set up.
  if (campaign.status !== 'active') {
    return strictReadFailure('CAMPAIGN_NOT_ACTIVE', contextSlot)
  }
  if (!campaign.metadataSetup) {
    return strictReadFailure('CAMPAIGN_METADATA_NOT_SET', contextSlot)
  }

  // --- TokenConfig ---
  const tokenConfigInfo = values[4] ?? null
  if (tokenConfigInfo === null) {
    return strictReadFailure('TOKEN_CONFIG_ABSENT', contextSlot)
  }
  if (!tokenConfigInfo.owner.equals(programId)) {
    return strictReadFailure('TOKEN_CONFIG_OWNER_MISMATCH', contextSlot)
  }
  if (!discriminatorMatches(tokenConfigInfo.data, TOKEN_CONFIG_DISCRIMINATOR)) {
    return strictReadFailure('TOKEN_CONFIG_DISCRIMINATOR_MISMATCH', contextSlot)
  }
  if (tokenConfigInfo.data.length !== TOKEN_CONFIG_ACCOUNT_LENGTH) {
    return strictReadFailure('TOKEN_CONFIG_LENGTH_MISMATCH', contextSlot)
  }
  let tokenConfigRaw: unknown
  try {
    tokenConfigRaw = coder.decode(ACCOUNT_NAME.tokenConfig, tokenConfigInfo.data)
  } catch {
    return strictReadFailure('TOKEN_CONFIG_DECODE_FAILED', contextSlot)
  }
  const tokenConfigDecode = strictDecodeTokenConfig(tokenConfigRaw)
  if (!tokenConfigDecode.ok) {
    return strictReadFailure(tokenConfigDecode.code, contextSlot)
  }
  const tokenConfig = tokenConfigDecode.value
  if (!tokenConfig.campaign.equals(request.campaign)) {
    return strictReadFailure('TOKEN_CONFIG_CAMPAIGN_MISMATCH', contextSlot)
  }
  const derivedTokenConfig = deriveTokenConfigPda(programId, request.campaign, tokenConfig.legacyMint)
  if (
    !derivedTokenConfig.pda.equals(request.tokenConfig) ||
    derivedTokenConfig.bump !== tokenConfig.bump
  ) {
    return strictReadFailure('TOKEN_CONFIG_PDA_MISMATCH', contextSlot)
  }
  if (!tokenConfig.legacyMint.equals(request.legacyMint)) {
    return strictReadFailure('TOKEN_CONFIG_LEGACY_MINT_MISMATCH', contextSlot)
  }

  // --- both classic-SPL mints, in the SAME snapshot as the counters ---
  const legacyMint = strictMintFacts(
    request.legacyMint,
    values[6] ?? null,
    tokenConfig.legacyDecimals,
  )
  if (!legacyMint.ok) {
    return strictReadFailure(legacyMint.code, contextSlot)
  }
  const outputMint = strictMintFacts(
    request.outputMint,
    values[7] ?? null,
    tokenConfig.outputDecimals,
  )
  if (!outputMint.ok) {
    return strictReadFailure(outputMint.code, contextSlot)
  }
  if (
    outputMint.value.mintAuthority === null ||
    !outputMint.value.mintAuthority.equals(request.campaign)
  ) {
    // Only the exact Campaign PDA may mint the output token. Anything else means the
    // amounts this attempt is about to approve are not under campaign control.
    return strictReadFailure('OUTPUT_MINT_AUTHORITY_MISMATCH', contextSlot)
  }
  if (outputMint.value.freezeAuthority !== null) {
    return strictReadFailure('OUTPUT_MINT_FREEZE_AUTHORITY_PRESENT', contextSlot)
  }
  if (outputMint.value.supply > campaign.totalOutputMinted) {
    // `<=`, never equality: the counter is cumulative and only ever grows, while
    // supply also falls when a holder voluntarily burns output tokens. A supply ABOVE
    // the campaign's own cumulative total would mean tokens this campaign never
    // minted, which is drift the attempt must not build on.
    return strictReadFailure('OUTPUT_MINT_SUPPLY_ABOVE_CAMPAIGN_TOTAL', contextSlot)
  }

  return {
    ok: true,
    contextSlot,
    state: {
      userLegacyAta,
      userOutputAta,
      userLegacyAmount: legacy.amount,
      userOutputAmount: output.amount,
      protocolFeeVaultAmount: feeVault.amount,
      campaignTotalOutputMinted: campaign.totalOutputMinted,
      campaignTotalProtocolFeesMinted: campaign.totalProtocolFeesMinted,
      tokenConfigTotalOutputMintedFromTc: tokenConfig.totalOutputMintedFromTc,
      tokenConfigNormalizationRemainderTotal: tokenConfig.normalizationRemainderTotal,
      rateNumerator: tokenConfig.rateNumerator,
      rateDenominator: tokenConfig.rateDenominator,
      legacyDecimals: tokenConfig.legacyDecimals,
      outputDecimals: tokenConfig.outputDecimals,
      maxOutputSupply: campaign.maxOutputSupply,
      maxOutputFromTc: tokenConfig.maxOutputFromTc,
    },
  }
}

// --- Team/Admin S1 additive read helpers (read-only, additive) -----------------
//
// Three additions, and they add no capability this module did not already have: it
// already opens no `Connection` of its own, builds no instruction, holds no wallet
// and sends nothing. Every helper below takes the caller's `Connection` as a
// parameter and performs exactly one read.
//
// WHY THEY EXIST. The Team/Admin S1 post-state question — "did the four-instruction
// setup land, and if not, what is on chain right now?" — cannot be answered from the
// Holder readers. Those refuse an absent account, because a convert whose Campaign is
// missing has no pre-state at all. An S1 readback is the opposite case: ABSENCE IS
// THE ANSWER it is looking for, and collapsing it into a refusal would make "nothing
// was created" indistinguishable from "we could not find out".
//
// So the coherent reader below reports each planned account as PRESENT, ABSENT or
// UNREADABLE and never conflates the last two, while the two single-account readers
// keep the strict all-or-nothing shape for the callers that genuinely require the
// account to exist.
//
// NOTHING HERE DECIDES ANYTHING. These helpers produce observations; the pure
// Team/Admin post-state mapper turns an observation plus a frozen plan into a
// verdict. Keeping the crypto (PDA re-derivation, decode, unpack) here and the
// judgment there is what lets the judgment be a pure, dependency-free function.

/** The classic-SPL mint facts a strict single-mint read yields. */
export type RedaxClassicMintFacts = StrictMintFacts

export type RedaxClassicMintReadResult =
  | { readonly ok: true; readonly contextSlot: number; readonly facts: RedaxClassicMintFacts }
  | {
      readonly ok: false
      readonly code: RedaxHolderStrictReadFailureCode
      readonly contextSlot: number | null
    }

/**
 * Read ONE classic-SPL mint account, strictly, at an observed context slot.
 *
 * Validation is `strictMintFacts` itself — not a second copy of it — so owner, exact
 * 82-byte length, decodability, initialized state and the declared decimals are
 * judged by exactly the rules the Holder convert path is judged by. An absent mint is
 * a REFUSAL here: this reader's contract is that the mint exists.
 *
 * The DECIMALS ARGUMENT is the availability proof. A mint whose declared decimals are
 * unreadable, or disagree with what the caller planned for, is not a usable
 * observation of the mint the caller means — so the comparison and the read are the
 * same operation rather than two steps a caller could forget to pair.
 */
export async function readRedaxClassicMintWithContext(
  connection: Connection,
  mint: PublicKey,
  expectedDecimals: number,
  options: RedaxHolderStrictReadOptions,
): Promise<RedaxClassicMintReadResult> {
  let contextSlot: number
  let info: RedaxSingleAccountInfo
  try {
    const response = await connection.getAccountInfoAndContext(
      mint,
      options.minContextSlot === undefined
        ? { commitment: options.commitment }
        : { commitment: options.commitment, minContextSlot: options.minContextSlot },
    )
    contextSlot = response.context.slot
    info = response.value
  } catch (error) {
    return { ok: false, code: classifyGuardReadError(error), contextSlot: null }
  }
  if (options.minContextSlot !== undefined && contextSlot < options.minContextSlot) {
    return { ok: false, code: 'MIN_CONTEXT_UNAVAILABLE', contextSlot }
  }
  const facts = strictMintFacts(mint, info, expectedDecimals)
  if (!facts.ok) {
    return { ok: false, code: facts.code, contextSlot }
  }
  return { ok: true, contextSlot, facts: facts.value }
}

/** An explicit token-account address, plus the exact identity it must carry. */
export interface RedaxClassicTokenAccountReadRequest {
  readonly address: PublicKey
  readonly expectedOwner: PublicKey
  readonly expectedMint: PublicKey
}

export type RedaxClassicTokenAccountReadResult =
  | { readonly ok: true; readonly contextSlot: number; readonly amount: bigint }
  | {
      readonly ok: false
      readonly code: RedaxHolderStrictReadFailureCode
      readonly contextSlot: number | null
    }

/**
 * Read ONE classic-SPL token account AT AN EXPLICIT ADDRESS, strictly.
 *
 * Deliberately distinct from `readClassicAtaForOwner` and from
 * `readRedaxPrepareOutputAtaStateWithContext`, which both DERIVE the address from an
 * owner and a mint. The canonical protocol fee vault is not the caller's ATA: its
 * address comes from the frozen plan's own off-curve-safe derivation and its internal
 * owner is the protocol fee authority, so an owner-derived reader cannot express it
 * at all.
 *
 * Validation is `strictTokenAccountAmount` itself — the same classic-program owner,
 * exact 165-byte shape, `AccountState.Initialized` check (via
 * `classicTokenAccountState`, so a FROZEN account never passes), exact internal owner
 * and mint equality, and `u64` bound. Absent, undecodable and mismatched are all
 * refusals with their exact code; only a fully validated account yields an amount.
 */
export async function readRedaxClassicTokenAccountAtAddressWithContext(
  connection: Connection,
  request: RedaxClassicTokenAccountReadRequest,
  options: RedaxHolderStrictReadOptions,
): Promise<RedaxClassicTokenAccountReadResult> {
  let contextSlot: number
  let info: RedaxSingleAccountInfo
  try {
    const response = await connection.getAccountInfoAndContext(
      request.address,
      options.minContextSlot === undefined
        ? { commitment: options.commitment }
        : { commitment: options.commitment, minContextSlot: options.minContextSlot },
    )
    contextSlot = response.context.slot
    info = response.value
  } catch (error) {
    return { ok: false, code: classifyGuardReadError(error), contextSlot: null }
  }
  if (options.minContextSlot !== undefined && contextSlot < options.minContextSlot) {
    return { ok: false, code: 'MIN_CONTEXT_UNAVAILABLE', contextSlot }
  }
  const read = strictTokenAccountAmount(
    request.address,
    info,
    request.expectedOwner,
    request.expectedMint,
  )
  if (!read.ok) {
    return { ok: false, code: read.code, contextSlot }
  }
  return { ok: true, contextSlot, amount: read.amount }
}

/** Lowercase hex for a fixed-width public byte array. Never a secret. */
function toLowercaseHex(bytes: Uint8Array): string {
  let hex = ''
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, '0')
  }
  return hex
}

/**
 * What one planned account was observed to be.
 *
 * THREE ANSWERS, NEVER TWO. `UNREADABLE` is not `ABSENT`: a plan whose Campaign could
 * not be read has not been proven not to exist, and treating the two alike is exactly
 * how a second orphan gets created.
 */
export type RedaxTeamAdminS1AccountObservation<TFacts> =
  | { readonly presence: 'ABSENT' }
  | { readonly presence: 'PRESENT'; readonly facts: TFacts }
  | { readonly presence: 'UNREADABLE'; readonly code: RedaxHolderStrictReadFailureCode }

/** The canonical ProtocolConfig fact an S1 readback compares against its plan. */
export interface RedaxTeamAdminS1ProtocolConfigPublicFacts {
  readonly protocolFeeAuthority: string
}

/**
 * The complete public Campaign body, as plain serializable data.
 *
 * Strings and numbers on purpose: the pure mapper that consumes this must not acquire
 * `PublicKey`, `BigInt` widths or any web3 type, and a frozen plan already carries
 * every one of these as a canonical string. Comparing like with like is what keeps
 * the judgment a dependency-free equality check.
 */
export interface RedaxTeamAdminS1CampaignPublicFacts {
  readonly campaignAdmin: string
  readonly outputGovernance: string
  readonly outputMint: string
  readonly protocolFeeVault: string
  readonly status: CampaignStatusName
  readonly metadataSetup: boolean
  readonly discoveryStatus: number
  readonly bump: number
  readonly saltHex: string
  readonly endTs: string | null
  readonly maxOutputSupplyRaw: string
  readonly totalOutputMintedRaw: string
  readonly totalProtocolFeesMintedRaw: string
  /**
   * Does `[b"campaign", output_governance, salt]` re-derive to the address this
   * account was read at, with this stored bump?
   *
   * The re-derivation is CRYPTO, so it happens here and never in the pure mapper. A
   * decoded account that does not re-derive is a Campaign somebody else's seeds
   * produced, and no field comparison would notice.
   */
  readonly pdaSelfConsistent: boolean
}

/** The output mint facts an S1 readback compares against its plan. */
export interface RedaxTeamAdminS1OutputMintPublicFacts {
  readonly decimals: number
  readonly supplyRaw: string
  readonly mintAuthority: string | null
  readonly freezeAuthority: string | null
}

/** The canonical fee vault fact an S1 readback compares against its plan. */
export interface RedaxTeamAdminS1FeeVaultPublicFacts {
  readonly amountRaw: string
}

/** One coherent, slot-consistent observation of the four planned S1 accounts. */
export interface RedaxTeamAdminS1CoherentObservationV1 {
  readonly protocolConfig: RedaxTeamAdminS1AccountObservation<RedaxTeamAdminS1ProtocolConfigPublicFacts>
  readonly campaign: RedaxTeamAdminS1AccountObservation<RedaxTeamAdminS1CampaignPublicFacts>
  readonly outputMint: RedaxTeamAdminS1AccountObservation<RedaxTeamAdminS1OutputMintPublicFacts>
  readonly protocolFeeVault: RedaxTeamAdminS1AccountObservation<RedaxTeamAdminS1FeeVaultPublicFacts>
}

/** Exactly the planned addresses an S1 post-state observation is taken against. */
export interface RedaxTeamAdminS1CoherentReadRequest {
  readonly campaign: PublicKey
  readonly outputMint: PublicKey
  readonly outputMintDecimals: number
  readonly protocolFeeVault: PublicKey
}

/**
 * Options for the TEAM/ADMIN S1 coherent read — the ONE reader whose commitment is a
 * caller policy rather than a fixed property of the read.
 *
 * A SEPARATE type, deliberately, and NOT a widening of `RedaxHolderStrictReadOptions`.
 * The Holder options stay `'confirmed'`-only: every Holder read is an attempt-time
 * freshness question, none of them is ever a finality question, and widening a shared
 * type would have handed a finality knob to five readers that must not have one.
 *
 * The Team/Admin S1 reader is the exception because the SAME four-account observation
 * answers two genuinely different questions:
 *
 *   * ordinary post-send effect assessment  -> `'confirmed'`
 *   * the strict finalized no-land proof    -> `'finalized'`, at a context floor that
 *                                              itself post-dates strict blockhash expiry
 *
 * The second cannot be answered at `'confirmed'`: confirmed state can still be
 * reorganised, so "the Campaign is absent" observed there is not the same statement as
 * "the Campaign is absent and cannot appear". Substituting one for the other would
 * silently weaken the account-absence half of the finalized no-land proof.
 *
 * There is NO default and NO coercion. The commitment is written explicitly at every
 * call site, because which of those two questions is being asked is exactly the thing a
 * reader of the call site needs to be told.
 */
export interface RedaxTeamAdminS1CoherentReadOptions {
  readonly commitment: 'confirmed' | 'finalized'
  readonly minContextSlot?: number
}

export type RedaxTeamAdminS1CoherentReadResult =
  | {
      readonly ok: true
      readonly contextSlot: number
      readonly observation: RedaxTeamAdminS1CoherentObservationV1
    }
  | {
      readonly ok: false
      readonly code: RedaxHolderStrictReadFailureCode
      readonly contextSlot: number | null
    }

/**
 * Observe the ProtocolConfig, the Campaign, the output mint and the canonical
 * protocol fee vault at ONE coherent context slot.
 *
 * ONE `getMultipleAccountsInfoAndContext` over exactly four accounts, and
 * deliberately NO FOLLOW-UP READ. A second round trip could straddle the very
 * transaction whose effect is being assessed, producing a "post-state" that never
 * existed on chain at any single moment — and an S1 readback is precisely the
 * situation where a straddle would be read as an orphan.
 *
 * The whole read is a REFUSAL only when the RPC call itself fails or the context slot
 * is behind the caller's floor. Everything else is reported per account, because an
 * S1 readback must be able to say "no Campaign, but the mint is there" — the shape
 * that means an orphan — and a whole-read refusal cannot express it.
 *
 * The fee vault is validated against the fee authority read in THIS SAME snapshot,
 * never a remembered one; if the ProtocolConfig is absent or unreadable the vault is
 * `UNREADABLE` too, because there is nothing to validate its internal owner against.
 *
 * TIME IS NOT READ HERE. `end_ts` is strict-decoded for structure and width and then
 * carried as its canonical decimal string. No `Date.now`, no wall clock, no Clock RPC.
 */
export async function readRedaxTeamAdminS1CoherentStateWithContext(
  connection: Connection,
  programId: PublicKey,
  request: RedaxTeamAdminS1CoherentReadRequest,
  options: RedaxTeamAdminS1CoherentReadOptions,
): Promise<RedaxTeamAdminS1CoherentReadResult> {
  let protocolConfigPda: PublicKey
  let protocolConfigBump: number
  try {
    const derived = deriveProtocolConfigPda(programId)
    protocolConfigPda = derived.pda
    protocolConfigBump = derived.bump
  } catch {
    return { ok: false, code: 'DERIVATION_FAILED', contextSlot: null }
  }

  let contextSlot: number
  let values: readonly RedaxGuardAccountInfo[]
  try {
    const response = await connection.getMultipleAccountsInfoAndContext(
      [protocolConfigPda, request.campaign, request.outputMint, request.protocolFeeVault],
      options.minContextSlot === undefined
        ? { commitment: options.commitment }
        : { commitment: options.commitment, minContextSlot: options.minContextSlot },
    )
    contextSlot = response.context.slot
    values = response.value
  } catch (error) {
    return { ok: false, code: classifyGuardReadError(error), contextSlot: null }
  }
  if (options.minContextSlot !== undefined && contextSlot < options.minContextSlot) {
    return { ok: false, code: 'MIN_CONTEXT_UNAVAILABLE', contextSlot }
  }

  // --- the canonical ProtocolConfig ---
  const protocolConfigInfo = values[0] ?? null
  let protocolConfig: RedaxTeamAdminS1AccountObservation<RedaxTeamAdminS1ProtocolConfigPublicFacts>
  let feeAuthority: PublicKey | null = null
  if (protocolConfigInfo === null) {
    protocolConfig = { presence: 'ABSENT' }
  } else {
    const read = strictProtocolConfigFeeAuthority(
      protocolConfigInfo,
      programId,
      protocolConfigBump,
    )
    if (read.ok) {
      feeAuthority = read.feeAuthority
      protocolConfig = {
        presence: 'PRESENT',
        facts: { protocolFeeAuthority: read.feeAuthority.toBase58() },
      }
    } else {
      protocolConfig = { presence: 'UNREADABLE', code: read.code }
    }
  }

  // --- the Campaign ---
  const campaign = observeS1Campaign(values[1] ?? null, programId, request.campaign)

  // --- the output mint ---
  const outputMintInfo = values[2] ?? null
  let outputMint: RedaxTeamAdminS1AccountObservation<RedaxTeamAdminS1OutputMintPublicFacts>
  if (outputMintInfo === null) {
    outputMint = { presence: 'ABSENT' }
  } else {
    const read = strictMintFacts(request.outputMint, outputMintInfo, request.outputMintDecimals)
    outputMint = read.ok
      ? {
          presence: 'PRESENT',
          facts: {
            decimals: read.value.decimals,
            supplyRaw: read.value.supply.toString(),
            mintAuthority: read.value.mintAuthority === null ? null : read.value.mintAuthority.toBase58(),
            freezeAuthority:
              read.value.freezeAuthority === null ? null : read.value.freezeAuthority.toBase58(),
          },
        }
      : { presence: 'UNREADABLE', code: read.code }
  }

  // --- the canonical protocol fee vault, against THIS snapshot's fee authority ---
  const feeVaultInfo = values[3] ?? null
  let protocolFeeVault: RedaxTeamAdminS1AccountObservation<RedaxTeamAdminS1FeeVaultPublicFacts>
  if (feeVaultInfo === null) {
    protocolFeeVault = { presence: 'ABSENT' }
  } else if (feeAuthority === null) {
    // Present, but there is no fresh authority to measure it against. That is not a
    // canonical vault observation, and it is certainly not an absence.
    protocolFeeVault = { presence: 'UNREADABLE', code: 'PROTOCOL_CONFIG_ABSENT' }
  } else {
    const read = strictTokenAccountAmount(
      request.protocolFeeVault,
      feeVaultInfo,
      feeAuthority,
      request.outputMint,
    )
    protocolFeeVault = read.ok
      ? { presence: 'PRESENT', facts: { amountRaw: read.amount.toString() } }
      : { presence: 'UNREADABLE', code: read.code }
  }

  return {
    ok: true,
    contextSlot,
    observation: { protocolConfig, campaign, outputMint, protocolFeeVault },
  }
}

/**
 * Classify the Campaign slot of a coherent S1 observation.
 *
 * Split out only so the coherent reader above stays readable; it performs no read of
 * its own and is called exactly once, with the value that read already produced.
 */
function observeS1Campaign(
  info: RedaxGuardAccountInfo,
  programId: PublicKey,
  address: PublicKey,
): RedaxTeamAdminS1AccountObservation<RedaxTeamAdminS1CampaignPublicFacts> {
  if (info === null) {
    return { presence: 'ABSENT' }
  }
  if (!info.owner.equals(programId)) {
    return { presence: 'UNREADABLE', code: 'CAMPAIGN_OWNER_MISMATCH' }
  }
  if (!discriminatorMatches(info.data, CAMPAIGN_DISCRIMINATOR)) {
    return { presence: 'UNREADABLE', code: 'CAMPAIGN_DISCRIMINATOR_MISMATCH' }
  }
  if (info.data.length !== CAMPAIGN_ACCOUNT_LENGTH) {
    return { presence: 'UNREADABLE', code: 'CAMPAIGN_LENGTH_MISMATCH' }
  }
  let raw: unknown
  try {
    raw = buildAccountsCoder(programId.toBase58()).decode(ACCOUNT_NAME.campaign, info.data)
  } catch {
    return { presence: 'UNREADABLE', code: 'CAMPAIGN_DECODE_FAILED' }
  }
  const decoded = strictDecodeCampaign(raw)
  if (decoded === null) {
    return { presence: 'UNREADABLE', code: 'CAMPAIGN_DECODE_FAILED' }
  }
  let pdaSelfConsistent = false
  try {
    const derived = deriveCampaignPda(programId, decoded.outputGovernance, decoded.salt)
    pdaSelfConsistent = derived.pda.equals(address) && derived.bump === decoded.bump
  } catch {
    pdaSelfConsistent = false
  }
  return {
    presence: 'PRESENT',
    facts: {
      campaignAdmin: decoded.campaignAdmin.toBase58(),
      outputGovernance: decoded.outputGovernance.toBase58(),
      outputMint: decoded.outputMint.toBase58(),
      protocolFeeVault: decoded.protocolFeeVault.toBase58(),
      status: decoded.status,
      metadataSetup: decoded.metadataSetup,
      discoveryStatus: decoded.discoveryStatus,
      bump: decoded.bump,
      saltHex: toLowercaseHex(decoded.salt),
      endTs: decoded.endTs === null ? null : decoded.endTs.toString(),
      maxOutputSupplyRaw: decoded.maxOutputSupply.toString(),
      totalOutputMintedRaw: decoded.totalOutputMinted.toString(),
      totalProtocolFeesMintedRaw: decoded.totalProtocolFeesMinted.toString(),
      pdaSelfConsistent,
    },
  }
}

// --- Team/Admin S1 authoritative guard read (read-only, additive) ---------------
//
// Additive only: nothing above this line changes, and the Holder guard reader keeps
// its exact current semantics and its exact current shape. This is a SECOND reader
// for a DIFFERENT question, not a widening of the first.
//
// WHY TWO READS, AND WHY THE FIRST ONE PROVES NOTHING. The ProgramData ADDRESS is not
// a constant: it is named by the Program account's own state, so it has to be read
// before it can be read at. That discovery read is therefore NOT the security
// snapshot — treating it as one would mean trusting a Program state observed at one
// slot and a ProgramData account observed at another, which is a pair that may never
// have existed together on chain.
//
// So the authoritative observation is the SECOND read, and it carries all three
// accounts — Program, ProgramData, ProtocolConfig — at ONE returned context. The
// Program is then re-decoded FROM THAT READ and required to still name exactly the
// ProgramData address that was fetched: if an upgrade moved it between the two reads,
// the relation breaks and this refuses rather than reporting an authority belonging to
// an account the program no longer points at.
//
// EVERY FAILURE IS A TYPED, VALUE-FREE REFUSAL. No raw error, message, cause, account
// byte, address or RPC response object is ever returned, and nothing is logged. The
// loader-owner EQUALITY is deliberately not performed here: the expected loader
// identity is a wallet-layer constant and this data module must not import it, so both
// owners are RETURNED and the Team/Admin chain guard performs both comparisons — the
// same split the Holder reader already uses.

/** `UpgradeableLoaderState` enum tag for the `ProgramData` variant (u32, little-endian). */
const UPGRADEABLE_PROGRAM_DATA_STATE_TAG = 3

/** Offset of the `Option<Pubkey>` upgrade-authority tag: u32 variant + u64 deploy slot. */
const UPGRADEABLE_PROGRAM_DATA_AUTHORITY_TAG_OFFSET = 12

/** Exact metadata prefix of a ProgramData account: 4 + 8 + 1 + 32. */
const UPGRADEABLE_PROGRAM_DATA_METADATA_LENGTH = 45

/** Value-free reasons the authoritative Team/Admin guard read produced no observation. */
export type RedaxTeamAdminGuardAccountsReadFailureCode =
  | RedaxGuardAccountsReadFailureCode
  | 'PROGRAM_DATA_ABSENT'
  | 'PROGRAM_DATA_STATE_INVALID'
  | 'PROGRAM_DATA_RELATION_DRIFT'

/**
 * The upgradeable-loader facts the Team/Admin guard reasons about.
 *
 * `upgradeAuthority` is `null` when — and only when — the program is IMMUTABLE. It is
 * never null because a read was unavailable or a field was unreadable: those are
 * refusals, so a null here is positive evidence rather than an absence of evidence.
 */
export interface RedaxTeamAdminGuardProgramFacts {
  readonly executable: boolean
  readonly owner: PublicKey
  readonly programDataAddress: PublicKey
  readonly programDataOwner: PublicKey
  readonly upgradeAuthority: PublicKey | null
}

/** Typed result of the authoritative Team/Admin guard read. */
export type RedaxTeamAdminGuardAccountsReadResult =
  | {
      readonly ok: true
      readonly contextSlot: number
      readonly program: RedaxTeamAdminGuardProgramFacts
      readonly protocolConfig: RedaxGuardProtocolConfigFacts
    }
  | {
      readonly ok: false
      readonly code: RedaxTeamAdminGuardAccountsReadFailureCode
      readonly contextSlot: number | null
    }

/**
 * Strictly decode an `UpgradeableLoaderState::ProgramData` header: a 4-byte
 * little-endian variant tag of 3, an 8-byte deploy slot, and a bincode `Option<Pubkey>`
 * whose tag byte is exactly 0 (immutable) or exactly 1 (upgradeable, followed by the
 * 32-byte authority).
 *
 * Hand-decoded for the same reasons the Program state above is: the exported
 * `decodeUpgradeableLoaderState` returns `any`, throws instead of refusing, and drags a
 * third-party registry endpoint into the bundle. This is the whole layout we need.
 *
 * `{ ok: false }` rather than `null`, because `null` is a MEANINGFUL success here — an
 * immutable program — and a decoder whose failure value collided with its most
 * security-relevant answer would be one misread away from reporting an unreadable
 * account as an unowned program.
 *
 * ANY OTHER OPTION TAG IS A REFUSAL. A byte that is neither 0 nor 1 is not a value this
 * layout admits, and guessing which one it "meant" is exactly the guess a fail-closed
 * decoder must not make.
 */
function decodeUpgradeableProgramDataState(
  data: Uint8Array,
): { readonly ok: true; readonly upgradeAuthority: PublicKey | null } | { readonly ok: false } {
  if (data.length < UPGRADEABLE_PROGRAM_DATA_METADATA_LENGTH) {
    return { ok: false }
  }
  const tag = new DataView(data.buffer, data.byteOffset, 4).getUint32(0, true)
  if (tag !== UPGRADEABLE_PROGRAM_DATA_STATE_TAG) {
    return { ok: false }
  }
  const optionTag = data[UPGRADEABLE_PROGRAM_DATA_AUTHORITY_TAG_OFFSET]
  if (optionTag === 0) {
    return { ok: true, upgradeAuthority: null }
  }
  if (optionTag !== 1) {
    return { ok: false }
  }
  try {
    return {
      ok: true,
      upgradeAuthority: new PublicKey(
        data.subarray(
          UPGRADEABLE_PROGRAM_DATA_AUTHORITY_TAG_OFFSET + 1,
          UPGRADEABLE_PROGRAM_DATA_METADATA_LENGTH,
        ),
      ),
    }
  } catch {
    return { ok: false }
  }
}

/**
 * Read the deployed program, its ProgramData account and the canonical ProtocolConfig
 * for the Team/Admin S1 chain guard.
 *
 * TWO READS, ONE SNAPSHOT. The first exists solely to learn the ProgramData address and
 * is treated as evidence of nothing else. The second is the authoritative one: all
 * three accounts at ONE context slot, with the Program re-decoded from that same read
 * and required to still name the ProgramData account that was fetched.
 *
 * `minContextSlot` is passed to BOTH requests so a node behind the caller's accepted
 * floor refuses to answer rather than answering staler. The caller must ALSO reject a
 * returned context slot below its own floor — the request option protects request
 * evaluation, not the returned value.
 */
export async function readRedaxTeamAdminGuardAccountsWithContext(
  connection: Connection,
  programId: PublicKey,
  options: RedaxGuardAccountsReadOptions,
): Promise<RedaxTeamAdminGuardAccountsReadResult> {
  const requestOptions =
    options.minContextSlot === undefined
      ? { commitment: options.commitment }
      : { commitment: options.commitment, minContextSlot: options.minContextSlot }

  // --- read 1: discovery ONLY. Its context slot is deliberately discarded. ---
  let discoveredProgramInfo: RedaxGuardAccountInfo
  try {
    const response = await connection.getMultipleAccountsInfoAndContext([programId], requestOptions)
    discoveredProgramInfo = response.value[0]
  } catch (error) {
    return { ok: false, code: classifyGuardReadError(error), contextSlot: null }
  }
  if (discoveredProgramInfo === null) {
    return { ok: false, code: 'PROGRAM_ABSENT', contextSlot: null }
  }
  if (!discoveredProgramInfo.executable) {
    return { ok: false, code: 'PROGRAM_NOT_EXECUTABLE', contextSlot: null }
  }
  const discoveredProgramDataAddress = decodeUpgradeableProgramState(discoveredProgramInfo.data)
  if (discoveredProgramDataAddress === null) {
    return { ok: false, code: 'PROGRAM_STATE_INVALID', contextSlot: null }
  }

  // --- read 2: THE authoritative observation, all three accounts at one context ---
  const { pda: protocolConfigPda, bump: derivedBump } = deriveProtocolConfigPda(programId)
  let contextSlot: number
  let programInfo: RedaxGuardAccountInfo
  let programDataInfo: RedaxGuardAccountInfo
  let protocolConfigInfo: RedaxGuardAccountInfo
  try {
    const response = await connection.getMultipleAccountsInfoAndContext(
      [programId, discoveredProgramDataAddress, protocolConfigPda],
      requestOptions,
    )
    contextSlot = response.context.slot
    programInfo = response.value[0]
    programDataInfo = response.value[1]
    protocolConfigInfo = response.value[2]
  } catch (error) {
    return { ok: false, code: classifyGuardReadError(error), contextSlot: null }
  }

  // --- program account, re-read and re-decoded at the authoritative context ---
  if (programInfo === null) {
    return { ok: false, code: 'PROGRAM_ABSENT', contextSlot }
  }
  if (!programInfo.executable) {
    return { ok: false, code: 'PROGRAM_NOT_EXECUTABLE', contextSlot }
  }
  const programDataAddress = decodeUpgradeableProgramState(programInfo.data)
  if (programDataAddress === null) {
    return { ok: false, code: 'PROGRAM_STATE_INVALID', contextSlot }
  }
  if (!programDataAddress.equals(discoveredProgramDataAddress)) {
    // The program now names a DIFFERENT ProgramData account than the one just
    // fetched. Whatever authority that account carried belongs to a relation this
    // program no longer has.
    return { ok: false, code: 'PROGRAM_DATA_RELATION_DRIFT', contextSlot }
  }

  // --- ProgramData account ---
  if (programDataInfo === null) {
    return { ok: false, code: 'PROGRAM_DATA_ABSENT', contextSlot }
  }
  const programDataState = decodeUpgradeableProgramDataState(programDataInfo.data)
  if (!programDataState.ok) {
    return { ok: false, code: 'PROGRAM_DATA_STATE_INVALID', contextSlot }
  }

  // --- canonical ProtocolConfig, at the same context ---
  if (protocolConfigInfo === null) {
    return { ok: false, code: 'PROTOCOL_CONFIG_ABSENT', contextSlot }
  }
  if (!protocolConfigInfo.owner.equals(programId)) {
    return { ok: false, code: 'PROTOCOL_CONFIG_OWNER_MISMATCH', contextSlot }
  }
  if (!discriminatorMatches(protocolConfigInfo.data, PROTOCOL_CONFIG_DISCRIMINATOR)) {
    return { ok: false, code: 'PROTOCOL_CONFIG_DISCRIMINATOR_MISMATCH', contextSlot }
  }
  if (protocolConfigInfo.data.length !== PROTOCOL_CONFIG_ACCOUNT_LENGTH) {
    return { ok: false, code: 'PROTOCOL_CONFIG_DECODE_FAILED', contextSlot }
  }
  let raw: Record<string, unknown>
  try {
    const coder = buildAccountsCoder(programId.toBase58())
    raw = coder.decode(ACCOUNT_NAME.protocolConfig, protocolConfigInfo.data) as Record<string, unknown>
  } catch {
    return { ok: false, code: 'PROTOCOL_CONFIG_DECODE_FAILED', contextSlot }
  }
  const decoded = normalizeProtocolConfig(raw)
  // The normalizer casts; it does not validate. Prove both authorities really are keys.
  const feeAuthority = toValidatedPublicKey(decoded.protocolFeeAuthority)
  const pauseAuthority = toValidatedPublicKey(decoded.protocolEmergencyPauseAuthority)
  if (feeAuthority === null || pauseAuthority === null) {
    return { ok: false, code: 'PROTOCOL_CONFIG_DECODE_FAILED', contextSlot }
  }
  if (decoded.bump !== derivedBump) {
    // A stored bump that is not the canonical bump means this is not the canonical PDA.
    return { ok: false, code: 'PROTOCOL_CONFIG_BUMP_MISMATCH', contextSlot }
  }

  return {
    ok: true,
    contextSlot,
    program: {
      executable: programInfo.executable,
      owner: programInfo.owner,
      programDataAddress,
      programDataOwner: programDataInfo.owner,
      upgradeAuthority: programDataState.upgradeAuthority,
    },
    protocolConfig: {
      derivedBump,
      data: {
        protocolFeeAuthority: feeAuthority,
        protocolEmergencyPauseAuthority: pauseAuthority,
        bump: decoded.bump,
      },
    },
  }
}

// --- Team/Admin POST-INIT MUTATION readback (read-only, additive) ---------------
//
// ADDITIVE ONLY. Nothing above this line changes. The Holder readers, the S1 coherent
// reader, the guard readers and — deliberately — `fetchOutputTokenMetadata` and its
// display decoder all keep their exact current semantics and their exact current shapes.
// This is a THIRD family of readers for a DIFFERENT question, not a widening of any of
// them, and no S1 fact type gains a member.
//
// -----------------------------------------------------------------------------
// WHY THE DISPLAY DECODER CANNOT BE REUSED FOR ATTRIBUTION
// -----------------------------------------------------------------------------
// `decodeOutputTokenMetadata` above answers "what should this token be CALLED". It is
// deliberately LOSSY for that purpose: it strips trailing NULs, it trims surrounding
// whitespace, it stops after the URI, and it returns `null` for an entry with no usable
// name — every one of which is right for a label and wrong for evidence.
//
// Attribution asks a different question: "are the bytes stored on chain EXACTLY the bytes
// this attempt asked for". A trim or a NUL strip would make a stored value compare equal
// to a value nobody requested, and stopping at the URI would leave `is_mutable` — the
// permanence fact — unread. So there is a SECOND decoder below, it normalizes nothing,
// and it walks the layout through `is_mutable`.
//
// -----------------------------------------------------------------------------
// PUFFED BYTES ARE COMPARED FORWARD, NEVER INVERTED
// -----------------------------------------------------------------------------
// The Metaplex program PUFFS: it pads name, symbol and URI with trailing NUL bytes to
// fixed widths, so the stored account CANNOT uniquely recover the original arguments — a
// value that genuinely ended in `U+0000` and a value that was padded are the same bytes.
//
// Therefore `PRE_PUFF_BYTES_DERIVED_FROM_ACCOUNT = NO`. Every field below is named
// `storedPuffed…`, and there is deliberately NO `rawPrePuff…` field: naming one would
// encode a false inverse into the source. What was requested is proven by the canonical
// commitments the journal already holds plus the exact finalized landed message; what
// EXISTS is proven by these stored bytes.

/** What one mutation-relevant account was observed to be. Three answers, never two. */
export type RedaxTeamAdminMutationAccountObservation<TFacts> =
  | { readonly presence: 'ABSENT' }
  | { readonly presence: 'PRESENT'; readonly facts: TFacts }
  | { readonly presence: 'UNREADABLE'; readonly code: RedaxHolderStrictReadFailureCode }

/**
 * The complete public Campaign body a mutation readback compares against.
 *
 * A SEPARATE type from `RedaxTeamAdminS1CampaignPublicFacts`, and not a widening of it:
 * post-init attribution needs `tokenConfigCount`, which the S1 shape does not carry and
 * must not gain. Strings and numbers on purpose, so the pure assessor that consumes this
 * acquires no `PublicKey`, no `BigInt` width and no web3 type.
 */
export interface RedaxTeamAdminMutationCampaignPublicFacts {
  readonly campaignAdmin: string
  readonly outputGovernance: string
  readonly outputMint: string
  readonly protocolFeeVault: string
  readonly status: CampaignStatusName
  readonly metadataSetup: boolean
  readonly discoveryStatus: number
  readonly bump: number
  readonly saltHex: string
  readonly endTs: string | null
  readonly maxOutputSupplyRaw: string
  readonly totalOutputMintedRaw: string
  readonly totalProtocolFeesMintedRaw: string
  readonly tokenConfigCount: number
  /**
   * Does `[b"campaign", output_governance, salt]` re-derive to the address this account
   * was read at, with this stored bump?
   *
   * The re-derivation is CRYPTO, so it happens here and never in the pure assessor. A
   * decoded account that does not re-derive is a Campaign somebody else's seeds produced,
   * and no field comparison would notice.
   */
  readonly pdaSelfConsistent: boolean
}

/** The complete public TokenConfig body a mutation readback compares against. */
export interface RedaxTeamAdminMutationTokenConfigPublicFacts {
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
  /** `[b"token_config", campaign, legacy_mint]` re-derived against the read address. */
  readonly pdaSelfConsistent: boolean
}

/**
 * The ONE canonical Clock sysvar OWNER, mirrored as a private source constant.
 *
 * It is an EXPECTATION, never an address this module reads. The address it reads is
 * `SYSVAR_CLOCK_PUBKEY` and nothing else.
 */
const SYSVAR_OWNER_PROGRAM_ID = new PublicKey('Sysvar1111111111111111111111111111111111111')

/** The `Clock` sysvar layout's minimum width, and where `unix_timestamp` sits in it. */
const CLOCK_SYSVAR_MINIMUM_BYTES = 40
const CLOCK_SYSVAR_UNIX_TIMESTAMP_OFFSET = 32

/**
 * The MINIMUM post-init mutation read fact about chain time, and there is no second one.
 *
 * ONE MEMBER. `slot` is deliberately absent — the coherent result already carries the ONE
 * shared context slot every account in the response was observed at, and a second copy
 * inside the fact would be a second answer to the same question. `epoch`,
 * `epoch_start_timestamp` and `leader_schedule_epoch` are absent because nothing in the
 * activation corridor asks about them.
 *
 * `bigint`, NEVER `number`. `unix_timestamp` is a signed `i64` and the comparison it feeds
 * is an inequality against a Campaign's `end_ts`; converting to `Number` would silently
 * round beyond the safe-integer range, and a rounded deadline is a wrong deadline.
 */
export interface RedaxTeamAdminMutationClockPublicFacts {
  readonly unixTimestamp: bigint
}

/**
 * Why the canonical Clock account could not be read as one. Closed, private-grade, four.
 *
 * A SEPARATE vocabulary from `RedaxHolderStrictReadFailureCode`, which is the Holder
 * strict-read union and gains no member for this: a sysvar is not a Holder account, and
 * widening a shared union would put four Clock codes in reach of every Holder reader.
 * Every one of them is value-free — no address, no owner, no byte and no timestamp.
 */
export type RedaxTeamAdminMutationClockReadFailureCode =
  | 'CLOCK_OWNER_MISMATCH'
  | 'CLOCK_ACCOUNT_EXECUTABLE'
  | 'CLOCK_LENGTH_MISMATCH'
  | 'CLOCK_DECODE_FAILED'

/** What the canonical Clock account was observed to be. Three answers, never two. */
export type RedaxTeamAdminMutationClockObservation =
  | { readonly presence: 'ABSENT' }
  | { readonly presence: 'PRESENT'; readonly facts: RedaxTeamAdminMutationClockPublicFacts }
  | {
      readonly presence: 'UNREADABLE'
      readonly code: RedaxTeamAdminMutationClockReadFailureCode
    }

/**
 * The classic-SPL mint facts a post-init mutation PREFLIGHT compares against.
 *
 * DELIBERATELY TINY. It carries the address it was read at and the decimals the account
 * declares, and nothing else: a preflight asks whether the two mints this attempt is about
 * are the classic Phase 1 mints the product expects, and supply, authorities and raw bytes
 * answer no part of that question. Nothing here can travel into an instruction argument.
 *
 * `PRESENT` IS A PROOF, NOT A LABEL. An observation only reaches this shape when the
 * account exists, is owned by the classic `TOKEN_PROGRAM_ID`, is exactly the classic
 * 82-byte Mint layout, decodes, and is initialized. Every other reading — a Token-2022
 * mint, an extension mint, a truncated account, an uninitialized one — is `UNREADABLE`,
 * never `PRESENT`, so a caller that checks `presence === 'PRESENT'` has already been told
 * the whole classic-SPL question was answered yes.
 */
export interface RedaxTeamAdminMutationMintPublicFacts {
  readonly address: string
  readonly decimals: number
}

/**
 * The attribution-grade Metaplex metadata facts.
 *
 * `storedPuffed…` throughout, never `rawPrePuff…` — see the note above. The three digests
 * are lowercase SHA-256 over the EXACT stored Borsh string payload bytes, with nothing
 * trimmed, stripped or normalized, and the three lengths are those payloads' exact widths.
 *
 * `creatorsPresent` plus `creatorCount` together are what prove `creators = None`: the
 * option tag being `0` is a different fact from a present-but-empty vector, and one
 * boolean could not tell them apart.
 */
export interface RedaxTeamAdminMutationMetadataPublicFacts {
  readonly updateAuthority: string
  readonly mint: string
  readonly storedPuffedNameSha256Hex: string
  readonly storedPuffedSymbolSha256Hex: string
  readonly storedPuffedUriSha256Hex: string
  readonly storedPuffedNameByteLength: number
  readonly storedPuffedSymbolByteLength: number
  readonly storedPuffedUriByteLength: number
  readonly sellerFeeBasisPoints: number
  readonly creatorsPresent: boolean
  readonly creatorCount: number
  readonly primarySaleHappened: boolean
  readonly isMutable: boolean
}

/** One coherent, slot-consistent observation for one mutation operation. */
export interface RedaxTeamAdminMutationCoherentObservationV1 {
  readonly campaign: RedaxTeamAdminMutationAccountObservation<RedaxTeamAdminMutationCampaignPublicFacts>
  /** `null` when this operation did not ask for a TokenConfig at all. */
  readonly tokenConfig: RedaxTeamAdminMutationAccountObservation<RedaxTeamAdminMutationTokenConfigPublicFacts> | null
  /** `null` when this operation did not ask for a metadata account at all. */
  readonly metadata: RedaxTeamAdminMutationAccountObservation<RedaxTeamAdminMutationMetadataPublicFacts> | null
  /**
   * The accepted input mint, observed IN THE SAME RESPONSE. `null` for every family that
   * does not register one.
   */
  readonly legacyMint: RedaxTeamAdminMutationAccountObservation<RedaxTeamAdminMutationMintPublicFacts> | null
  /** The campaign's output mint, observed in that SAME response. `null` for other families. */
  readonly outputMint: RedaxTeamAdminMutationAccountObservation<RedaxTeamAdminMutationMintPublicFacts> | null
  /**
   * NON-NULL FOR EXACTLY ONE FAMILY. `ACTIVATE_CAMPAIGN` carries it; `ADD_TOKEN_CONFIG`,
   * `SETUP_METADATA` and `STATUS_ONLY` carry `null` — which is what keeps chain time out
   * of the four operations that have no deadline question, `PAUSE_CAMPAIGN`,
   * `UNPAUSE_CAMPAIGN` and `FINALIZE_CAMPAIGN` among them. This is NOT a generic clock
   * service and there is no request that turns it into one.
   *
   * WHY IT IS HERE AND NOT BESIDE THE CAMPAIGN FACTS. `activate_campaign` executes only
   * while the chain's own clock is still before the Campaign's `end_ts`, so an activation
   * attempt is admitted against TWO facts that must have been true AT ONE MOMENT. Reading
   * the Clock in a second round trip would produce a pair that never co-existed. It is
   * therefore an OBSERVATION member — beside the accounts, at their shared context slot —
   * and emphatically not a Campaign field: a Campaign does not carry the current time, and
   * widening its facts with one would make a re-read of the account look like a re-read of
   * the clock.
   */
  readonly clock: RedaxTeamAdminMutationClockObservation | null
}

/**
 * Exactly which accounts one mutation readback is taken over. FOUR families, closed.
 *
 * Discriminated rather than optional, so a `STATUS_ONLY` request cannot carry a TokenConfig
 * address and an `ADD_TOKEN_CONFIG` request cannot omit one.
 */
export type RedaxTeamAdminMutationCoherentReadRequest =
  | {
      readonly family: 'ADD_TOKEN_CONFIG'
      readonly campaign: PublicKey
      readonly tokenConfig: PublicKey
      readonly legacyMint: PublicKey
      /**
       * The campaign's output mint, named by the caller and RE-PROVEN by the guard.
       *
       * It is on the REQUEST rather than being derived here because this module reads
       * accounts and decides nothing: which mint the campaign actually names is a fact the
       * Campaign account carries, and comparing the two is the guard's job. Naming it here
       * is only what puts it in the same coherent response.
       */
      readonly outputMint: PublicKey
    }
  | {
      readonly family: 'SETUP_METADATA'
      readonly campaign: PublicKey
      readonly outputMint: PublicKey
    }
  | { readonly family: 'ACTIVATE_CAMPAIGN'; readonly campaign: PublicKey }
  | { readonly family: 'STATUS_ONLY'; readonly campaign: PublicKey }

/**
 * Options for the mutation coherent read.
 *
 * A SEPARATE type from `RedaxHolderStrictReadOptions`, whose `commitment` stays
 * `'confirmed'`-only, and from `RedaxTeamAdminS1CoherentReadOptions`. There is NO default
 * and NO coercion: the commitment is written explicitly at every call site, because which
 * question is being asked — a fresh pre-state read, or a finalized effect attribution — is
 * exactly the thing a reader of the call site needs to be told.
 */
export interface RedaxTeamAdminMutationCoherentReadOptions {
  readonly commitment: 'confirmed' | 'finalized'
  readonly minContextSlot?: number
}

export type RedaxTeamAdminMutationCoherentReadResult =
  | {
      readonly ok: true
      readonly contextSlot: number
      readonly observation: RedaxTeamAdminMutationCoherentObservationV1
    }
  | {
      readonly ok: false
      readonly code: RedaxHolderStrictReadFailureCode
      readonly contextSlot: number | null
    }

// --- The attribution-grade Metaplex decoder ---------------------------------------

/** `Metadata` account discriminator byte for the `MetadataV1` variant. */
const METAPLEX_ATTRIBUTION_KEY_METADATA_V1 = 4

/** One `Creator`: 32-byte address, a `bool` verified flag, and a `u8` share. */
const METAPLEX_CREATOR_RECORD_BYTES = 34

/** Where the `verified` bool sits inside one `Creator` record — after the 32-byte address. */
const METAPLEX_CREATOR_ADDRESS_BYTES = 32

/**
 * A structurally decoded metadata account, WITHOUT the digests.
 *
 * Split from the public facts because hashing is asynchronous and this walk is not: the
 * layout is decided here, synchronously and totally, and the three digests are taken over
 * the exact payload slices afterwards.
 */
interface MetaplexAttributionDecode {
  readonly updateAuthority: PublicKey
  readonly mint: PublicKey
  readonly nameBytes: Uint8Array
  readonly symbolBytes: Uint8Array
  readonly uriBytes: Uint8Array
  readonly sellerFeeBasisPoints: number
  readonly creatorsPresent: boolean
  readonly creatorCount: number
  readonly primarySaleHappened: boolean
  readonly isMutable: boolean
}

/**
 * A FATAL UTF-8 decoder, for VALIDATION ONLY, private to the attribution path.
 *
 * Deliberately NOT the non-fatal display decoder: that one is lossy on purpose, because a
 * display surface degrades rather than refuses. Attribution
 * is the opposite question — an account whose Borsh strings are not valid UTF-8 is not a
 * readable `Metadata` account, and reporting it as readable would put a malformed account
 * into an effect-origin proof. Reusing the lossy decoder here would silently substitute
 * U+FFFD and answer "readable" about bytes nobody can read.
 *
 * Resolved through the SAME private resolver the display decoder uses, on every call and
 * at no point during module import: a platform without `TextDecoder` yields `null`, and the
 * validator then answers `false`, which fails CLOSED to `UNREADABLE` — never to `ABSENT`,
 * never to `PRESENT`, and never to an import-time throw that would answer nothing at all.
 */
function resolveAttributionStrictUtf8Decoder(): RedaxUtf8Decoder | null {
  return resolveUtf8Decoder(true)
}

/**
 * Is this complete byte slice valid UTF-8?
 *
 * VALIDATION ONLY. The decoded string is produced, discarded and never returned: identity
 * stays the exact stored bytes, so nothing here trims, normalizes, NFC-folds, strips a NUL,
 * depuffs, re-encodes, percent-decodes or otherwise reconstructs a pre-puff input.
 *
 * `0x00` IS VALID UTF-8, so the metadata program's trailing NUL padding — and an embedded
 * U+0000 a Team deliberately chose — both remain readable. The ambiguity that padding
 * creates is an INVERSION ambiguity, and it is answered by exact landed-message attribution
 * rather than by banning a code point on input.
 *
 * The full standard is enforced by the platform decoder rather than hand-rolled: `0xFF`,
 * an isolated continuation byte, a truncated multi-byte sequence, an overlong encoding, an
 * encoded surrogate code point and a code point above U+10FFFF are all rejected by it, and
 * a partial hand-written check would accept some of them. It NEVER throws.
 */
function strictAttributionUtf8(bytes: Uint8Array): boolean {
  const decoder = resolveAttributionStrictUtf8Decoder()
  if (decoder === null) {
    return false
  }
  try {
    decoder.decode(bytes)
    return true
  } catch {
    return false
  }
}

/**
 * One Borsh string payload as EXACT bytes — no trim, no NUL strip, no decode kept.
 *
 * A Borsh `String` is REQUIRED to hold valid UTF-8, so bounds alone are not the whole of
 * validity: a structurally in-range payload of arbitrary bytes is not a string. Validation
 * happens HERE, at the single point every attribution Borsh string is read, so a field added
 * later inherits it instead of needing to remember it.
 */
function readAttributionBorshStringBytes(
  data: Uint8Array,
  offset: number,
): { bytes: Uint8Array; next: number } | null {
  if (offset < 0 || offset + 4 > data.length) {
    return null
  }
  const length = new DataView(data.buffer, data.byteOffset + offset, 4).getUint32(0, true)
  // The remaining-length guard is applied to the DECLARED length directly, before any
  // slice is taken, and `length` is a `u32` so it cannot overflow the addition below in
  // JavaScript's number range.
  if (offset + 4 + length > data.length) {
    return null
  }
  const bytes = data.slice(offset + 4, offset + 4 + length)
  // STRICT UTF-8, over the COMPLETE payload, after bounds and before the bytes are kept.
  // `null` here reaches the caller as `UNREADABLE` — the account could not be read — and
  // never as `ABSENT`, which would be a claim that nothing was created.
  if (!strictAttributionUtf8(bytes)) {
    return null
  }
  return { bytes, next: offset + 4 + length }
}

/** A Borsh `bool`: exactly `0` or exactly `1`. Anything else is not a bool. */
function readAttributionBool(
  data: Uint8Array,
  offset: number,
): { value: boolean; next: number } | null {
  if (offset < 0 || offset + 1 > data.length) {
    return null
  }
  const byte = data[offset]
  if (byte !== 0 && byte !== 1) {
    return null
  }
  return { value: byte === 1, next: offset + 1 }
}

/**
 * Decode the pinned Metaplex layout through `is_mutable`, or refuse.
 *
 * NEVER THROWS, and a refusal is `null` — which the caller reports as `UNREADABLE` and
 * NEVER as `ABSENT`. Absence is a proof input; unreadability is a proof failure, and
 * collapsing them would let an unparseable account masquerade as evidence that nothing was
 * created.
 *
 * THE CREATOR COUNT IS GUARDED BEFORE IT IS MULTIPLIED. A hostile `u32` multiplied by `34`
 * first could exceed the safe-integer range, and a product that lost precision would pass
 * a naive bounds check. So the REMAINING byte count is divided instead: the count must fit
 * in what is actually left, and no product is ever formed from an unchecked value. Each
 * admitted record is then WALKED rather than skipped, so its `verified` bool is really a
 * bool — a vector stepped over wholesale is a vector nobody parsed.
 *
 * NOTHING IS NORMALIZED. No `trim`, no trailing-NUL stripping, no depuffing and no inverse
 * reconstruction — every one of those would make a stored value compare equal to a value
 * that was never requested.
 */
function decodeMetaplexAttributionMetadata(data: Uint8Array): MetaplexAttributionDecode | null {
  // key(1) + updateAuthority(32) + mint(32)
  if (data.length < 65 || data[0] !== METAPLEX_ATTRIBUTION_KEY_METADATA_V1) {
    return null
  }
  let updateAuthority: PublicKey
  let mint: PublicKey
  try {
    updateAuthority = new PublicKey(data.subarray(1, 33))
    mint = new PublicKey(data.subarray(33, 65))
  } catch {
    return null
  }

  const name = readAttributionBorshStringBytes(data, 65)
  if (name === null) {
    return null
  }
  const symbol = readAttributionBorshStringBytes(data, name.next)
  if (symbol === null) {
    return null
  }
  const uri = readAttributionBorshStringBytes(data, symbol.next)
  if (uri === null) {
    return null
  }

  // sellerFeeBasisPoints: u16 little-endian.
  let cursor = uri.next
  if (cursor + 2 > data.length) {
    return null
  }
  const sellerFeeBasisPoints = new DataView(
    data.buffer,
    data.byteOffset + cursor,
    2,
  ).getUint16(0, true)
  cursor += 2

  // Option<Vec<Creator>>: a tag byte that is EXACTLY 0 or EXACTLY 1. Any other byte is a
  // value this layout does not admit, and guessing which one it "meant" is precisely the
  // guess a fail-closed decoder must not make.
  if (cursor + 1 > data.length) {
    return null
  }
  const optionTag = data[cursor]
  if (optionTag !== 0 && optionTag !== 1) {
    return null
  }
  cursor += 1
  let creatorsPresent = false
  let creatorCount = 0
  if (optionTag === 1) {
    creatorsPresent = true
    if (cursor + 4 > data.length) {
      return null
    }
    creatorCount = new DataView(data.buffer, data.byteOffset + cursor, 4).getUint32(0, true)
    cursor += 4
    const remaining = data.length - cursor
    // DIVISION, NOT MULTIPLICATION. The count must fit in what is actually left.
    if (creatorCount > Math.floor(remaining / METAPLEX_CREATOR_RECORD_BYTES)) {
      return null
    }
    // EACH CREATOR RECORD IS WALKED, NOT SKIPPED — 32 bytes of address, then `verified` as
    // a Borsh `bool`, then the `share` byte.
    //
    // `verified` is a BOOL, so it is EXACTLY `0` or EXACTLY `1`; any other byte is a value
    // this layout does not admit, and a decoder that stepped over it would report an
    // account it never actually parsed as readable. Skipping the whole vector was that
    // decoder. The walk is bounded by the division check above, so the loop can only run as
    // far as the bytes that are really there, and no product is formed from an unchecked
    // count.
    //
    // `share` is deliberately NOT constrained here: this repair is attribution-grade
    // DECODING, and a share-sum or per-creator range rule would be a new product rule
    // nobody decided on.
    for (let index = 0; index < creatorCount; index += 1) {
      const verified = readAttributionBool(data, cursor + METAPLEX_CREATOR_ADDRESS_BYTES)
      if (verified === null) {
        return null
      }
      cursor += METAPLEX_CREATOR_RECORD_BYTES
    }
  }

  const primarySale = readAttributionBool(data, cursor)
  if (primarySale === null) {
    return null
  }
  const mutable = readAttributionBool(data, primarySale.next)
  if (mutable === null) {
    return null
  }

  return {
    updateAuthority,
    mint,
    nameBytes: name.bytes,
    symbolBytes: symbol.bytes,
    uriBytes: uri.bytes,
    sellerFeeBasisPoints,
    creatorsPresent,
    creatorCount,
    primarySaleHappened: primarySale.value,
    isMutable: mutable.value,
  }
}

/**
 * Lowercase SHA-256 hex of exactly these bytes, or null when the platform cannot.
 *
 * Structural resolution, for the same reason every other REDAX crypto touchpoint uses one:
 * this module compiles under the app's DOM lib and under the test runner's Node types, and
 * a platform that cannot digest is UNAVAILABLE rather than an exception.
 */
async function attributionSha256Hex(bytes: Uint8Array): Promise<string | null> {
  const candidate = (globalThis as { crypto?: unknown }).crypto
  if (typeof candidate !== 'object' || candidate === null) {
    return null
  }
  const subtle = (candidate as { subtle?: { digest?: unknown } }).subtle
  if (typeof subtle !== 'object' || subtle === null || typeof subtle.digest !== 'function') {
    return null
  }
  let digest: ArrayBuffer
  try {
    digest = (await (subtle.digest as (algorithm: string, data: Uint8Array) => Promise<ArrayBuffer>)(
      'SHA-256',
      bytes,
    )) as ArrayBuffer
  } catch {
    return null
  }
  let out = ''
  for (const byte of new Uint8Array(digest)) {
    out += byte.toString(16).padStart(2, '0')
  }
  return out
}

// --- Per-account classification ------------------------------------------------------

/** Classify the Campaign slot of a coherent mutation observation. */
function observeMutationCampaign(
  info: RedaxGuardAccountInfo,
  programId: PublicKey,
  address: PublicKey,
): RedaxTeamAdminMutationAccountObservation<RedaxTeamAdminMutationCampaignPublicFacts> {
  if (info === null) {
    return { presence: 'ABSENT' }
  }
  if (!info.owner.equals(programId)) {
    return { presence: 'UNREADABLE', code: 'CAMPAIGN_OWNER_MISMATCH' }
  }
  if (!discriminatorMatches(info.data, CAMPAIGN_DISCRIMINATOR)) {
    return { presence: 'UNREADABLE', code: 'CAMPAIGN_DISCRIMINATOR_MISMATCH' }
  }
  if (info.data.length !== CAMPAIGN_ACCOUNT_LENGTH) {
    return { presence: 'UNREADABLE', code: 'CAMPAIGN_LENGTH_MISMATCH' }
  }
  let raw: unknown
  try {
    raw = buildAccountsCoder(programId.toBase58()).decode(ACCOUNT_NAME.campaign, info.data)
  } catch {
    return { presence: 'UNREADABLE', code: 'CAMPAIGN_DECODE_FAILED' }
  }
  const decoded = strictDecodeCampaign(raw)
  if (decoded === null) {
    return { presence: 'UNREADABLE', code: 'CAMPAIGN_DECODE_FAILED' }
  }
  // `token_config_count` is the one field this family needs that the strict S1 decode does
  // not carry. It is read at FULL strictness — an absent, wide or non-integral count is a
  // decode failure rather than a defaulted zero, because a fabricated zero would compare
  // equal to a Campaign that genuinely has no configs.
  const countRead = strictSmallUnsigned(
    strictPick(raw, 'tokenConfigCount', 'token_config_count'),
    STRICT_U8_MAX,
  )
  if (countRead === null) {
    return { presence: 'UNREADABLE', code: 'CAMPAIGN_DECODE_FAILED' }
  }
  let pdaSelfConsistent = false
  try {
    const derived = deriveCampaignPda(programId, decoded.outputGovernance, decoded.salt)
    pdaSelfConsistent = derived.pda.equals(address) && derived.bump === decoded.bump
  } catch {
    pdaSelfConsistent = false
  }
  return {
    presence: 'PRESENT',
    facts: {
      campaignAdmin: decoded.campaignAdmin.toBase58(),
      outputGovernance: decoded.outputGovernance.toBase58(),
      outputMint: decoded.outputMint.toBase58(),
      protocolFeeVault: decoded.protocolFeeVault.toBase58(),
      status: decoded.status,
      metadataSetup: decoded.metadataSetup,
      discoveryStatus: decoded.discoveryStatus,
      bump: decoded.bump,
      saltHex: toLowercaseHex(decoded.salt),
      endTs: decoded.endTs === null ? null : decoded.endTs.toString(),
      maxOutputSupplyRaw: decoded.maxOutputSupply.toString(),
      totalOutputMintedRaw: decoded.totalOutputMinted.toString(),
      totalProtocolFeesMintedRaw: decoded.totalProtocolFeesMinted.toString(),
      tokenConfigCount: countRead,
      pdaSelfConsistent,
    },
  }
}

/** Classify the TokenConfig slot of a coherent mutation observation. */
function observeMutationTokenConfig(
  info: RedaxGuardAccountInfo,
  programId: PublicKey,
  address: PublicKey,
  campaign: PublicKey,
  legacyMint: PublicKey,
): RedaxTeamAdminMutationAccountObservation<RedaxTeamAdminMutationTokenConfigPublicFacts> {
  if (info === null) {
    return { presence: 'ABSENT' }
  }
  if (!info.owner.equals(programId)) {
    return { presence: 'UNREADABLE', code: 'TOKEN_CONFIG_OWNER_MISMATCH' }
  }
  if (!discriminatorMatches(info.data, TOKEN_CONFIG_DISCRIMINATOR)) {
    return { presence: 'UNREADABLE', code: 'TOKEN_CONFIG_DISCRIMINATOR_MISMATCH' }
  }
  if (info.data.length !== TOKEN_CONFIG_ACCOUNT_LENGTH) {
    return { presence: 'UNREADABLE', code: 'TOKEN_CONFIG_LENGTH_MISMATCH' }
  }
  let raw: unknown
  try {
    raw = buildAccountsCoder(programId.toBase58()).decode(ACCOUNT_NAME.tokenConfig, info.data)
  } catch {
    return { presence: 'UNREADABLE', code: 'TOKEN_CONFIG_DECODE_FAILED' }
  }
  const decoded = strictDecodeTokenConfig(raw)
  if (!decoded.ok) {
    return { presence: 'UNREADABLE', code: decoded.code }
  }
  let pdaSelfConsistent = false
  try {
    const derived = deriveTokenConfigPda(programId, campaign, legacyMint)
    pdaSelfConsistent = derived.pda.equals(address) && derived.bump === decoded.value.bump
  } catch {
    pdaSelfConsistent = false
  }
  return {
    presence: 'PRESENT',
    facts: {
      campaign: decoded.value.campaign.toBase58(),
      legacyMint: decoded.value.legacyMint.toBase58(),
      rateNumeratorRaw: decoded.value.rateNumerator.toString(),
      rateDenominatorRaw: decoded.value.rateDenominator.toString(),
      legacyDecimals: decoded.value.legacyDecimals,
      outputDecimals: decoded.value.outputDecimals,
      maxOutputFromTcRaw: decoded.value.maxOutputFromTc.toString(),
      totalOutputMintedFromTcRaw: decoded.value.totalOutputMintedFromTc.toString(),
      normalizationRemainderTotalRaw: decoded.value.normalizationRemainderTotal.toString(),
      bump: decoded.value.bump,
      pdaSelfConsistent,
    },
  }
}

/**
 * FAIL CLOSED, AND `PRESENT` MEANS CLASSIC. The five conditions below are the whole
 * classic-SPL question, and every one of them must hold before this returns `PRESENT`:
 * the account exists, its Solana owner is the classic `TOKEN_PROGRAM_ID`, its data is
 * exactly the classic 82-byte Mint layout, `unpackMint` decodes it, and the decoded mint
 * is initialized. A Token-2022 mint fails the owner check, an extension mint fails the
 * length check, and a rent-exempt-but-uninitialized account fails the last one — none of
 * them becomes `PRESENT`, and none of them becomes `ABSENT` either, because "we read
 * something we cannot use" is a different answer from "there is nothing there".
 *
 * NO EXPECTATION IS COMPARED HERE, deliberately. This module observes; the guard decides.
 * `strictMintFacts` above takes an `expectedDecimals` because its caller is a quote path
 * that already holds the TokenConfig's own stored copy; a PREFLIGHT has no stored copy yet
 * — the expectation is a product fact — so folding the comparison in here would put a
 * product decision inside a reader.
 *
 * NO RAW BYTES ESCAPE. The returned facts are an address and a `u8`.
 */
function observeMutationMint(
  info: RedaxGuardAccountInfo,
  address: PublicKey,
): RedaxTeamAdminMutationAccountObservation<RedaxTeamAdminMutationMintPublicFacts> {
  if (info === null) {
    return { presence: 'ABSENT' }
  }
  if (!info.owner.equals(TOKEN_PROGRAM_ID)) {
    return { presence: 'UNREADABLE', code: 'MINT_ACCOUNT_PROGRAM_MISMATCH' }
  }
  if (info.data.length !== CLASSIC_MINT_ACCOUNT_LENGTH) {
    // EXACTLY the classic layout. A longer account is a Token-2022 or extension mint, which
    // Phase 1 does not support and must not silently accept.
    return { presence: 'UNREADABLE', code: 'MINT_ACCOUNT_DECODE_FAILED' }
  }
  let mint: ReturnType<typeof unpackMint>
  try {
    mint = unpackMint(address, info, TOKEN_PROGRAM_ID)
  } catch {
    return { presence: 'UNREADABLE', code: 'MINT_ACCOUNT_DECODE_FAILED' }
  }
  if (!mint.isInitialized) {
    return { presence: 'UNREADABLE', code: 'MINT_NOT_INITIALIZED' }
  }
  return {
    presence: 'PRESENT',
    facts: { address: address.toBase58(), decimals: mint.decimals },
  }
}

/**
 * TOTAL, PRIVATE AND FAIL-CLOSED. It NEVER throws outward, and every reading that is not
 * an exact canonical Clock is `UNREADABLE` rather than `ABSENT`: "we read something we
 * cannot use" and "there is nothing there" are different claims, and only the second one
 * would ever be safe to treat as an answer. A `null` slot — the account genuinely not in
 * the response — is the one and only `ABSENT`.
 *
 * FOUR CONDITIONS, all of which must hold before this returns `PRESENT`: the account's
 * owner is the sysvar owner program, the account is NOT executable, its data is at least
 * the `Clock` layout's `unix_timestamp` field, and the signed little-endian `i64` at
 * offset 32 decodes.
 *
 * SIGNED, AND A `bigint`. `getBigInt64` and not `getBigUint64`: `unix_timestamp` is an
 * `i64` and a negative value is representable in it, so an unsigned read would turn one
 * into an enormous positive time. Nothing here converts to `Number`, and nothing here
 * reads `Date`, `Date.now`, `performance`, `getBlockTime`, `getSlot` or `getEpochInfo` —
 * the browser's own clock is not an authority about a chain.
 *
 * THE ADDRESS IS NOT A PARAMETER. The caller passes the info slot the reader itself
 * appended `SYSVAR_CLOCK_PUBKEY` for, so there is no argument a caller could substitute.
 */
function observeMutationClock(info: RedaxGuardAccountInfo): RedaxTeamAdminMutationClockObservation {
  if (info === null) {
    return { presence: 'ABSENT' }
  }
  if (!info.owner.equals(SYSVAR_OWNER_PROGRAM_ID)) {
    return { presence: 'UNREADABLE', code: 'CLOCK_OWNER_MISMATCH' }
  }
  if (info.executable) {
    // A sysvar is data. An executable account at this address is not the Clock.
    return { presence: 'UNREADABLE', code: 'CLOCK_ACCOUNT_EXECUTABLE' }
  }
  if (info.data.length < CLOCK_SYSVAR_MINIMUM_BYTES) {
    return { presence: 'UNREADABLE', code: 'CLOCK_LENGTH_MISMATCH' }
  }
  let unixTimestamp: bigint
  try {
    unixTimestamp = new DataView(
      info.data.buffer,
      info.data.byteOffset,
      info.data.byteLength,
    ).getBigInt64(CLOCK_SYSVAR_UNIX_TIMESTAMP_OFFSET, true)
  } catch {
    return { presence: 'UNREADABLE', code: 'CLOCK_DECODE_FAILED' }
  }
  return { presence: 'PRESENT', facts: { unixTimestamp } }
}

/**
 * Classify the metadata slot of a coherent mutation observation.
 *
 * Asynchronous because the three commitments are digests. A platform that cannot digest
 * yields `UNREADABLE` — never `ABSENT`, and never a partially populated fact set.
 */
async function observeMutationMetadata(
  info: RedaxGuardAccountInfo,
  address: PublicKey,
): Promise<RedaxTeamAdminMutationAccountObservation<RedaxTeamAdminMutationMetadataPublicFacts>> {
  if (info === null) {
    return { presence: 'ABSENT' }
  }
  if (!info.owner.equals(METAPLEX_TOKEN_METADATA_PROGRAM_ID)) {
    // Present, but owned by something other than the metadata program. That is an account
    // at the canonical address that is NOT metadata, which is emphatically not an absence.
    return { presence: 'UNREADABLE', code: 'TOKEN_ACCOUNT_PROGRAM_MISMATCH' }
  }
  const decoded = decodeMetaplexAttributionMetadata(info.data)
  if (decoded === null) {
    return { presence: 'UNREADABLE', code: 'TOKEN_ACCOUNT_DECODE_FAILED' }
  }
  const nameSha = await attributionSha256Hex(decoded.nameBytes)
  const symbolSha = await attributionSha256Hex(decoded.symbolBytes)
  const uriSha = await attributionSha256Hex(decoded.uriBytes)
  if (nameSha === null || symbolSha === null || uriSha === null) {
    return { presence: 'UNREADABLE', code: 'RPC_READ_UNAVAILABLE' }
  }
  // The account was read at the canonical PDA the caller derived; re-checking that the
  // decoded `mint` is the expected one is the CALLER's comparison, because the expected
  // mint is a plan fact rather than a property of this read.
  void address
  return {
    presence: 'PRESENT',
    facts: {
      updateAuthority: decoded.updateAuthority.toBase58(),
      mint: decoded.mint.toBase58(),
      storedPuffedNameSha256Hex: nameSha,
      storedPuffedSymbolSha256Hex: symbolSha,
      storedPuffedUriSha256Hex: uriSha,
      storedPuffedNameByteLength: decoded.nameBytes.length,
      storedPuffedSymbolByteLength: decoded.symbolBytes.length,
      storedPuffedUriByteLength: decoded.uriBytes.length,
      sellerFeeBasisPoints: decoded.sellerFeeBasisPoints,
      creatorsPresent: decoded.creatorsPresent,
      creatorCount: decoded.creatorCount,
      primarySaleHappened: decoded.primarySaleHappened,
      isMutable: decoded.isMutable,
    },
  }
}

// --- The one coherent mutation read ----------------------------------------------------

/**
 * Observe exactly the accounts one post-init mutation is about, at ONE coherent context.
 *
 * ONE `getMultipleAccountsInfoAndContext`, and deliberately NO FOLLOW-UP READ. A second
 * round trip could straddle the very transaction whose effect is being assessed, producing
 * a "post-state" that never existed on chain at any single moment. A `STATUS_ONLY` request
 * reads one account through the same call, so every family answers from one context and no
 * family is coherent by a different rule than the others.
 *
 * THE CONTEXT FLOOR IS CHECKED TWICE, on purpose. `minContextSlot` in the request protects
 * request EVALUATION — a lagging node refuses to answer — and the explicit comparison below
 * rejects a lagging ANSWER. For effect attribution the caller passes `commitment:
 * 'finalized'` with the floor `max(preflightContextSlot, transactionSlot)`; for a fresh
 * pre-state it passes `'confirmed'`.
 *
 * The whole read is a REFUSAL only when the RPC call itself fails or the context is behind
 * the floor. Everything else is reported PER ACCOUNT, because an attribution must be able
 * to say "the Campaign is there, the TokenConfig is not" — the shape that means the
 * mutation did not take effect — and a whole-read refusal cannot express it.
 */
export async function readRedaxTeamAdminMutationCoherentStateWithContext(
  connection: Connection,
  programId: PublicKey,
  request: RedaxTeamAdminMutationCoherentReadRequest,
  options: RedaxTeamAdminMutationCoherentReadOptions,
): Promise<RedaxTeamAdminMutationCoherentReadResult> {
  let addresses: PublicKey[]
  let metadataAddress: PublicKey | null = null
  if (request.family === 'ADD_TOKEN_CONFIG') {
    addresses = [request.campaign, request.tokenConfig, request.legacyMint, request.outputMint]
  } else if (request.family === 'SETUP_METADATA') {
    try {
      metadataAddress = deriveOutputTokenMetadataPda(request.outputMint).pda
    } catch {
      return { ok: false, code: 'DERIVATION_FAILED', contextSlot: null }
    }
    addresses = [request.campaign, metadataAddress]
  } else if (request.family === 'ACTIVATE_CAMPAIGN') {
    addresses = [request.campaign, SYSVAR_CLOCK_PUBKEY]
  } else {
    addresses = [request.campaign]
  }

  let contextSlot: number
  let values: readonly RedaxGuardAccountInfo[]
  try {
    const response = await connection.getMultipleAccountsInfoAndContext(
      addresses,
      options.minContextSlot === undefined
        ? { commitment: options.commitment }
        : { commitment: options.commitment, minContextSlot: options.minContextSlot },
    )
    contextSlot = response.context.slot
    values = response.value
  } catch (error) {
    return { ok: false, code: classifyGuardReadError(error), contextSlot: null }
  }
  if (options.minContextSlot !== undefined && contextSlot < options.minContextSlot) {
    return { ok: false, code: 'MIN_CONTEXT_UNAVAILABLE', contextSlot }
  }

  const campaign = observeMutationCampaign(values[0] ?? null, programId, request.campaign)

  let tokenConfig: RedaxTeamAdminMutationCoherentObservationV1['tokenConfig'] = null
  let metadata: RedaxTeamAdminMutationCoherentObservationV1['metadata'] = null
  let legacyMint: RedaxTeamAdminMutationCoherentObservationV1['legacyMint'] = null
  let outputMint: RedaxTeamAdminMutationCoherentObservationV1['outputMint'] = null
  let clock: RedaxTeamAdminMutationCoherentObservationV1['clock'] = null

  if (request.family === 'ADD_TOKEN_CONFIG') {
    tokenConfig = observeMutationTokenConfig(
      values[1] ?? null,
      programId,
      request.tokenConfig,
      request.campaign,
      request.legacyMint,
    )
    legacyMint = observeMutationMint(values[2] ?? null, request.legacyMint)
    outputMint = observeMutationMint(values[3] ?? null, request.outputMint)
  } else if (request.family === 'SETUP_METADATA' && metadataAddress !== null) {
    metadata = await observeMutationMetadata(values[1] ?? null, metadataAddress)
  } else if (request.family === 'ACTIVATE_CAMPAIGN') {
    // Position 1 is interpreted as the Clock ONLY because position 1 is where this reader
    // itself put `SYSVAR_CLOCK_PUBKEY`. Every other family leaves `clock` at `null`.
    clock = observeMutationClock(values[1] ?? null)
  }

  return {
    ok: true,
    contextSlot,
    observation: { campaign, tokenConfig, metadata, legacyMint, outputMint, clock },
  }
}

// --- Read-only classic-SPL mint facts (demo customer flow, 2026-10-22) -------------
//
// ONE account read so a person adding an accepted input never has to know its decimals by
// heart. It validates exactly what the program will validate — the SPL Token program owns
// the account, the classic 82-byte mint layout, an initialized mint — and returns the mint's
// declared decimals. Token-2022 and extension mints are refused (Phase 1 is classic SPL
// only). It is a PREFILL source: the mutation root re-reads both mints in its own coherent
// read and refuses on any mismatch before a wallet is asked.

export type RedaxClassicMintFactsReadCode =
  | 'NOT_A_PUBLIC_KEY'
  | 'READ_UNAVAILABLE'
  | 'MINT_ACCOUNT_ABSENT'
  | 'NOT_A_CLASSIC_SPL_MINT'
  | 'MINT_NOT_INITIALIZED'

export type RedaxClassicMintFactsReadResult =
  | {
      readonly ok: true
      readonly mint: string
      readonly decimals: number
      readonly contextSlot: number
    }
  | { readonly ok: false; readonly code: RedaxClassicMintFactsReadCode }

export async function readRedaxClassicMintFactsWithContext(
  connection: Pick<Connection, 'getAccountInfoAndContext'>,
  mint: PublicKey,
): Promise<RedaxClassicMintFactsReadResult> {
  let response: Awaited<ReturnType<Connection['getAccountInfoAndContext']>>
  try {
    response = await connection.getAccountInfoAndContext(mint, { commitment: 'confirmed' })
  } catch {
    return { ok: false, code: 'READ_UNAVAILABLE' }
  }
  const contextSlot = response?.context?.slot
  if (typeof contextSlot !== 'number' || !Number.isSafeInteger(contextSlot)) {
    return { ok: false, code: 'READ_UNAVAILABLE' }
  }
  const info = response.value
  if (info === null) {
    return { ok: false, code: 'MINT_ACCOUNT_ABSENT' }
  }
  if (!info.owner.equals(TOKEN_PROGRAM_ID) || info.data.length !== CLASSIC_MINT_ACCOUNT_LENGTH) {
    return { ok: false, code: 'NOT_A_CLASSIC_SPL_MINT' }
  }
  let decoded: ReturnType<typeof unpackMint>
  try {
    decoded = unpackMint(mint, info, TOKEN_PROGRAM_ID)
  } catch {
    return { ok: false, code: 'NOT_A_CLASSIC_SPL_MINT' }
  }
  if (!decoded.isInitialized) {
    return { ok: false, code: 'MINT_NOT_INITIALIZED' }
  }
  return { ok: true, mint: mint.toBase58(), decimals: decoded.decimals, contextSlot }
}
