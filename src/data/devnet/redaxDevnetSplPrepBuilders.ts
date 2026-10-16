// REDAX classic-SPL preparation builders — pure instruction construction only.
//
// Boundary: this module is a PURE builder. It constructs the three classic-SPL
// instructions that must run BEFORE `init_campaign` in the S1 setup transaction,
// from already-resolved public keys. It performs NO RPC, builds no `Transaction`,
// holds no `Connection`, touches no wallet adapter, never signs, never sends,
// never confirms, reads no env, writes no storage, and mutates nothing. It imports
// no React and adds no package. Classic SPL only; no Token-2022.
//
// Why these instructions exist at all: `init_campaign` CREATES only the Campaign
// PDA. It requires the output mint and the canonical protocol fee vault to ALREADY
// EXIST, and it independently validates both (classic-SPL owner, exact layout,
// initialized, mint authority == the exact Campaign PDA, freeze authority == None,
// decimals == 9, supply == 0, and the vault's canonical ATA derivation). So the
// client must prepare them, in the same atomic transaction, immediately before it.
//
// NOTE on the mint keypair: the output-mint ACCOUNT is created here, but the
// keypair that signs its creation is NOT an input to this module. These builders
// take only the mint's PUBLIC key. The secret key lives solely in a later private
// in-memory action context; it is never passed here, never returned, never
// serialized and never logged.
//
// NOTE on rent: the minimum rent-exempt balance is an RPC read
// (`getMinimumBalanceForRentExemptMint` needs a `Connection`), so it can never be
// fetched from a pure layer. It is supplied as an INPUT instead — that is the
// purity boundary, not an oversight.

import { SystemProgram, TransactionInstruction } from '@solana/web3.js'
import type { PublicKey } from '@solana/web3.js'
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  MINT_SIZE,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createInitializeMint2Instruction,
} from '@solana/spl-token'

import { REDAX_OUTPUT_MINT_DECIMALS } from './redaxDevnetCampaignPlan'

// Re-exported so the test runner (and any later pure layer) can assert against the
// exact classic-SPL identities this module uses, without importing @solana/spl-token
// itself — the repository root resolves @solana/web3.js but not @solana/spl-token,
// which is an app-scoped dependency.
export const REDAX_CLASSIC_TOKEN_PROGRAM_ID = TOKEN_PROGRAM_ID
export const REDAX_ASSOCIATED_TOKEN_PROGRAM_ID = ASSOCIATED_TOKEN_PROGRAM_ID
/** The classic SPL `Mint` account size (82 bytes). */
export const REDAX_CLASSIC_MINT_SPACE = MINT_SIZE

// Inclusive maximum lamport value that can be represented exactly as a JS number.
// Lamports are a u64 on-chain, but `SystemProgram.createAccount` takes a `number`,
// so the bigint input is range-guarded at that library boundary rather than being
// silently narrowed.
const MAX_SAFE_LAMPORTS = BigInt(Number.MAX_SAFE_INTEGER)

/** Inputs for the output-mint account creation instruction. */
export interface RedaxCreateOutputMintAccountRequest {
  readonly payer: PublicKey
  /** The PUBLIC key of the freshly generated mint. The secret key never comes here. */
  readonly outputMint: PublicKey
  /** Minimum rent-exempt lamports for an 82-byte classic mint. Supplied, never fetched. */
  readonly mintRentLamports: bigint
}

export interface RedaxCreateOutputMintAccountResult {
  readonly instruction: TransactionInstruction
  readonly space: number
  readonly owner: PublicKey
}

/**
 * Build the System Program instruction that allocates the output-mint account:
 * exactly `MINT_SIZE` bytes, owned by the CLASSIC SPL token program.
 *
 * Both the payer and the new mint account must sign this instruction — the mint's
 * signature is contributed by the ephemeral generated keypair in a later action
 * context, never here.
 */
export function buildCreateOutputMintAccountInstruction(
  request: RedaxCreateOutputMintAccountRequest,
): RedaxCreateOutputMintAccountResult {
  const { payer, outputMint, mintRentLamports } = request

  if (mintRentLamports < 0n || mintRentLamports > MAX_SAFE_LAMPORTS) {
    throw new RangeError('mintRentLamports is outside the safe lamport range')
  }

  const instruction = SystemProgram.createAccount({
    fromPubkey: payer,
    newAccountPubkey: outputMint,
    lamports: Number(mintRentLamports),
    space: REDAX_CLASSIC_MINT_SPACE,
    programId: TOKEN_PROGRAM_ID,
  })

  return { instruction, space: REDAX_CLASSIC_MINT_SPACE, owner: TOKEN_PROGRAM_ID }
}

/** Inputs for the output-mint initialization instruction. */
export interface RedaxInitializeOutputMintRequest {
  readonly outputMint: PublicKey
  /**
   * The EXACT Campaign PDA. It becomes the mint authority, which is precisely what
   * `init_campaign` re-checks — so it must be the PDA derived from
   * (output governance, salt), never a wallet.
   */
  readonly campaign: PublicKey
}

export interface RedaxInitializeOutputMintResult {
  readonly instruction: TransactionInstruction
  readonly decimals: 9
  readonly mintAuthority: PublicKey
  readonly freezeAuthority: null
}

/**
 * Build the classic-SPL `InitializeMint2` instruction for the output mint:
 * decimals 9, mint authority = the exact Campaign PDA, freeze authority = None.
 *
 * `InitializeMint2` (not `InitializeMint`) is used deliberately: it needs no rent
 * sysvar account, so the S1 transaction carries one account meta fewer.
 */
export function buildInitializeOutputMintInstruction(
  request: RedaxInitializeOutputMintRequest,
): RedaxInitializeOutputMintResult {
  const { outputMint, campaign } = request

  const instruction = createInitializeMint2Instruction(
    outputMint,
    REDAX_OUTPUT_MINT_DECIMALS,
    campaign,
    // `null` is freeze authority None — the program rejects any freeze authority (6009).
    null,
    TOKEN_PROGRAM_ID,
  )

  return {
    instruction,
    decimals: REDAX_OUTPUT_MINT_DECIMALS,
    mintAuthority: campaign,
    freezeAuthority: null,
  }
}

/** Inputs for the canonical protocol-fee-vault ATA creation instruction. */
export interface RedaxCreateProtocolFeeVaultAtaRequest {
  readonly payer: PublicKey
  /**
   * The ALREADY-DERIVED canonical vault address, produced only by
   * `deriveProtocolFeeVaultAta`. There is deliberately no code path by which a
   * team could name this destination.
   */
  readonly protocolFeeVault: PublicKey
  /** The vault owner: the ProtocolConfig's fee authority (may be off-curve). */
  readonly protocolFeeAuthority: PublicKey
  readonly outputMint: PublicKey
}

export interface RedaxCreateProtocolFeeVaultAtaResult {
  readonly instruction: TransactionInstruction
  readonly protocolFeeVault: PublicKey
}

/**
 * Build the idempotent creation instruction for the canonical protocol fee vault.
 *
 * This uses the EXPLICIT already-derived-address constructor. The sibling
 * `createAssociatedTokenAccountIdempotentInstructionWithDerivation` is deliberately
 * NOT used: it re-derives the address internally behind an `allowOwnerOffCurve`
 * flag, and the fee authority may legitimately be off-curve. Passing the address
 * that `deriveProtocolFeeVaultAta` already produced keeps one derivation, in one
 * place, that provably matches the program's own check.
 *
 * Idempotent creation means a vault that already exists is not an error, so a
 * second campaign over the same output-mint/authority pair cannot fail here — and
 * it removes any need for a separate "does the vault exist?" round trip.
 */
export function buildCreateProtocolFeeVaultAtaInstruction(
  request: RedaxCreateProtocolFeeVaultAtaRequest,
): RedaxCreateProtocolFeeVaultAtaResult {
  const { payer, protocolFeeVault, protocolFeeAuthority, outputMint } = request

  const instruction = createAssociatedTokenAccountIdempotentInstruction(
    payer,
    protocolFeeVault,
    protocolFeeAuthority,
    outputMint,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  )

  return { instruction, protocolFeeVault }
}
