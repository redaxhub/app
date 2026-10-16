// REDAX Team/Admin S1 campaign-setup assembler — pure composition only.
//
// S1 — one atomic legacy transaction, four instructions, in this exact order:
//
//   1. System Program creates the output-mint account (82 bytes, classic-SPL owner).
//   2. Classic SPL `InitializeMint2` — decimals 9, mint authority = the exact
//      Campaign PDA, freeze authority = None.
//   3. Idempotent creation of the canonical protocol fee vault, at the address the
//      dedicated off-curve-safe derivation already produced.
//   4. REDAX `init_campaign` — creates the Campaign PDA and independently validates
//      the mint and the vault prepared by (1)-(3).
//
// NO TRANSACTION IS CONSTRUCTED HERE, and none ever will be: this module composes
// instructions and returns them as data.
//
// NOTHING ABOUT THIS MODULE CHANGED. It still constructs no transaction, owns no send,
// and composes instructions it returns as data.

import type { PublicKey, TransactionInstruction } from '@solana/web3.js'

import {
  type RedaxFrozenCampaignPlanV1,
  computeRedaxCampaignPlanFingerprint,
  resolveRedaxCampaignPlan,
} from './redaxDevnetCampaignPlan'
import {
  buildCreateOutputMintAccountInstruction,
  buildCreateProtocolFeeVaultAtaInstruction,
  buildInitializeOutputMintInstruction,
} from './redaxDevnetSplPrepBuilders'
import {
  buildInitCampaignInstruction,
  type RedaxSignerRequirement,
} from './redaxDevnetTxBuilders'

/** The legacy-transaction wire limit. A plan above this cannot be sent at all. */
export const REDAX_LEGACY_PACKET_SIZE_LIMIT = 1232

/** The number of instructions in an S1 setup transaction. Always exactly four. */
export const REDAX_S1_INSTRUCTION_COUNT = 4

/**
 * Everything needed to assemble and MEASURE the legacy transaction offline —
 * without RPC, without a wallet, and without sending anything.
 *
 * A measured size is planning evidence ONLY. It is not a claim that any transaction
 * has been built, signed, sent, confirmed, or that it fits within the compute
 * budget — none of which this gate establishes.
 */
export interface RedaxOfflineMeasurementDescriptor {
  readonly transactionKind: 'legacy'
  readonly feePayer: PublicKey
  readonly instructionCount: number
  /** Byte length of each instruction's data, in instruction order. */
  readonly instructionDataBytes: readonly number[]
  readonly totalInstructionDataBytes: number
  readonly accountMetaCount: number
  readonly uniqueSignerCount: number
  readonly legacyPacketSizeLimit: number
  readonly note: string
}

/** The public on-chain state S1 is expected to leave behind, if it succeeds. */
export interface RedaxS1ExpectedPostState {
  readonly campaign: string
  readonly campaignStatus: 'initialized'
  readonly outputMint: string
  readonly outputMintDecimals: 9
  readonly outputMintSupply: '0'
  readonly outputMintAuthority: string
  readonly outputMintFreezeAuthority: null
  readonly protocolFeeVault: string
  readonly protocolFeeVaultCreation: 'idempotent'
  readonly metadataSetup: false
  readonly tokenConfigCount: 0
}

export interface RedaxCampaignSetupPlanRequest {
  readonly plan: RedaxFrozenCampaignPlanV1
  /** Minimum rent-exempt lamports for an 82-byte classic mint. Read by the caller, never here. */
  readonly mintRentLamports: bigint
}

export interface RedaxCampaignSetupPlanV1 {
  readonly fingerprint: string
  /** Exactly four, in S1 order. */
  readonly instructions: readonly TransactionInstruction[]
  readonly instructionCount: number
  readonly campaign: PublicKey
  readonly campaignBump: number
  readonly protocolConfig: PublicKey
  readonly protocolFeeVault: PublicKey
  readonly outputMint: PublicKey
  readonly signerRequirements: readonly RedaxSignerRequirement[]
  readonly uniqueSignerPublicKeys: readonly PublicKey[]
  readonly expectedPostState: RedaxS1ExpectedPostState
  readonly measurement: RedaxOfflineMeasurementDescriptor
}

export type RedaxCampaignSetupPlanErrorCode =
  | 'TOPOLOGY_1_ROLES_MUST_MATCH'
  | 'MINT_AUTHORITY_MUST_BE_CAMPAIGN_PDA'

export type RedaxCampaignSetupPlanResult =
  | { ok: true; setup: RedaxCampaignSetupPlanV1 }
  | { ok: false; code: RedaxCampaignSetupPlanErrorCode }

/**
 * Assemble the four-instruction S1 setup plan from a FROZEN public campaign plan.
 *
 * Async only because the plan fingerprint is a Web Crypto SHA-256 digest, which is
 * async by API. Still pure: no I/O, no clock, no entropy.
 *
 * THE OUTPUT MINT'S SECRET KEY IS NOT AN INPUT, NOT A FIELD, AND NOT A RETURN VALUE.
 * The mint appears here only as its PUBLIC key, and that is the only mint fact this
 * plan has ever carried or will carry: nothing secret is serialized, logged, persisted
 * or returned, and there is no field in which any of it could travel.
 *
 * WHERE THE SECOND SIGNATURE COMES FROM. An early version of this note said the
 * ephemeral key was handed to the wallet transport's signer options at send time. That
 * carrier is retired. In the Team/Admin S1 action root, the memory-only ephemeral key
 * is applied by exactly ONE action-root-only partial signature, BEFORE the single
 * wallet sign-only request — so the wallet is asked to sign a transaction that already
 * carries it.
 *
 * NONE OF IT HAPPENS HERE. This module constructs no key, signs nothing, sends nothing,
 * calls no provider and executes no carrier; it composes four instructions and returns
 * them as data.
 */
export async function buildRedaxCampaignSetupPlanS1(
  request: RedaxCampaignSetupPlanRequest,
): Promise<RedaxCampaignSetupPlanResult> {
  const { plan, mintRentLamports } = request
  const resolved = resolveRedaxCampaignPlan(plan)

  if (
    !resolved.payer.equals(resolved.outputGovernance) ||
    !resolved.payer.equals(resolved.campaignAdmin)
  ) {
    return { ok: false, code: 'TOPOLOGY_1_ROLES_MUST_MATCH' }
  }

  // The mint is initialized with the Campaign PDA as its authority, and
  // `init_campaign` then re-checks exactly that. If the plan's stated authority
  // ever disagreed with its own Campaign PDA, the mint would be permanently
  // stranded under an address no campaign controls — so refuse to build.
  if (plan.outputMintAuthority !== plan.campaign) {
    return { ok: false, code: 'MINT_AUTHORITY_MUST_BE_CAMPAIGN_PDA' }
  }

  // 1. Create the output-mint account.
  const createMint = buildCreateOutputMintAccountInstruction({
    payer: resolved.payer,
    outputMint: resolved.outputMint,
    mintRentLamports,
  })

  // 2. Initialize it: 9 decimals, Campaign-PDA authority, no freeze authority.
  const initializeMint = buildInitializeOutputMintInstruction({
    outputMint: resolved.outputMint,
    campaign: resolved.campaign,
  })

  // 3. Create the canonical fee vault idempotently, at the already-derived address.
  const createFeeVault = buildCreateProtocolFeeVaultAtaInstruction({
    payer: resolved.payer,
    protocolFeeVault: resolved.protocolFeeVault,
    protocolFeeAuthority: resolved.protocolFeeAuthority,
    outputMint: resolved.outputMint,
  })

  // 4. init_campaign — creates the Campaign PDA, validates the mint and the vault.
  const initCampaign = buildInitCampaignInstruction({
    programId: resolved.programId,
    payer: resolved.payer,
    outputGovernance: resolved.outputGovernance,
    campaignAdmin: resolved.campaignAdmin,
    salt: resolved.salt,
    outputMint: resolved.outputMint,
    protocolFeeAuthority: resolved.protocolFeeAuthority,
    endTs: resolved.endTs,
    maxOutputSupply: resolved.maxOutputSupply,
  })

  const instructions: readonly TransactionInstruction[] = [
    createMint.instruction,
    initializeMint.instruction,
    createFeeVault.instruction,
    initCampaign.instruction,
  ]

  // Required signatures. The connected wallet covers payer + output governance +
  // campaign admin (one human approval), and the ephemeral output-mint keypair
  // co-signs its own account creation. The protocol fee authority is NOT a signer.
  const signerRequirements: readonly RedaxSignerRequirement[] = [
    ...initCampaign.signers,
    { role: 'output_mint', pubkey: resolved.outputMint },
  ]

  const uniqueSignerPublicKeys: PublicKey[] = []
  for (const requirement of signerRequirements) {
    if (!uniqueSignerPublicKeys.some((key) => key.equals(requirement.pubkey))) {
      uniqueSignerPublicKeys.push(requirement.pubkey)
    }
  }

  const instructionDataBytes = instructions.map((instruction) => instruction.data.length)
  const accountMetaCount = instructions.reduce(
    (total, instruction) => total + instruction.keys.length,
    0,
  )

  const fingerprint = await computeRedaxCampaignPlanFingerprint(plan)

  return {
    ok: true,
    setup: {
      fingerprint,
      instructions,
      instructionCount: REDAX_S1_INSTRUCTION_COUNT,
      campaign: initCampaign.campaign,
      campaignBump: initCampaign.campaignBump,
      protocolConfig: initCampaign.protocolConfig,
      protocolFeeVault: initCampaign.protocolFeeVault,
      outputMint: resolved.outputMint,
      signerRequirements,
      uniqueSignerPublicKeys,
      expectedPostState: {
        campaign: plan.campaign,
        campaignStatus: 'initialized',
        outputMint: plan.outputMint,
        outputMintDecimals: 9,
        outputMintSupply: '0',
        outputMintAuthority: plan.campaign,
        outputMintFreezeAuthority: null,
        protocolFeeVault: plan.protocolFeeVault,
        protocolFeeVaultCreation: 'idempotent',
        // S1 creates the Campaign ONLY. Metadata and TokenConfigs are separate,
        // later instructions — the campaign is not activatable when S1 lands.
        metadataSetup: false,
        tokenConfigCount: 0,
      },
      measurement: {
        transactionKind: 'legacy',
        feePayer: resolved.payer,
        instructionCount: instructions.length,
        instructionDataBytes,
        totalInstructionDataBytes: instructionDataBytes.reduce((sum, size) => sum + size, 0),
        accountMetaCount,
        uniqueSignerCount: uniqueSignerPublicKeys.length,
        legacyPacketSizeLimit: REDAX_LEGACY_PACKET_SIZE_LIMIT,
        note: 'Offline planning descriptor only. No transaction has been built, signed, sent, confirmed or compute-measured.',
      },
    },
  }
}
