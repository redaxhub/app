// REDAX mock dynamic data — converted receipts (fixtures).
//
// Local mock data only. Each receipt conceptually maps to the on-chain Converted
// event (campaign, token config, holder, input/output mint, amount in, gross
// out, floor fee, user out, totals, timestamp). Receipts deliberately carry no
// on-chain transaction reference and no external link — there is no real chain
// history behind these fixtures. Amounts are decimal base units; fee is
// floor(grossOut * 100 / 10000) and userOut = grossOut - feeOut.

import type { MockConvertedReceipt } from '../types/redaxMock'
import { MOCK_NOW_TS } from './projects'

const DAY = 86_400

export const MOCK_CONVERTED_RECEIPTS: readonly MockConvertedReceipt[] = [
  {
    id: 'mock-receipt-astrapup-001',
    event: 'Converted',
    mockOnly: true,
    campaignId: 'campaign-astrapup',
    tokenConfigId: 'tc-astrapup',
    holderId: 'holder-small',
    inputMint: 'mock-pubkey:mint:astra-old',
    outputMint: 'mock-pubkey:mint:astra-new',
    amountInRaw: '1000000000000', // 1,000 legacy @ 9 decimals
    grossOutRaw: '1000000000', // 1,000 output @ 6 decimals (1:1, normalized down)
    feeOutRaw: '10000000', // floor(grossOut / 100)
    userOutRaw: '990000000',
    normalizationRemainderRaw: '0',
    totalOutputMintedAfterRaw: '120000000000',
    tokenConfigOutputMintedAfterRaw: '120000000000',
    timestamp: MOCK_NOW_TS - 4 * DAY,
    note: 'Mock receipt — AstraPup conversion, primary ASTRA input (local fixture).',
  },
  {
    id: 'mock-receipt-astrapup-points-001',
    event: 'Converted',
    mockOnly: true,
    campaignId: 'campaign-astrapup',
    tokenConfigId: 'tc-astrapup-points',
    holderId: 'holder-whale',
    inputMint: 'mock-pubkey:mint:pastra-points',
    outputMint: 'mock-pubkey:mint:astra-new',
    amountInRaw: '2000000000', // 2,000 pASTRA points @ 6 decimals
    grossOutRaw: '100000000', // rate 1/20 (equal decimals): 2,000 -> 100 output @ 6
    feeOutRaw: '1000000', // floor(grossOut / 100)
    userOutRaw: '99000000',
    normalizationRemainderRaw: '0',
    totalOutputMintedAfterRaw: '200000000000',
    tokenConfigOutputMintedAfterRaw: '10000000000',
    timestamp: MOCK_NOW_TS - 3 * DAY,
    note: 'Mock receipt — AstraPup conversion, pASTRA points input (local fixture).',
  },
  {
    id: 'mock-receipt-astrapup-escrow-001',
    event: 'Converted',
    mockOnly: true,
    campaignId: 'campaign-astrapup',
    tokenConfigId: 'tc-astrapup-escrow',
    holderId: 'holder-whale',
    inputMint: 'mock-pubkey:mint:xastra-escrow',
    outputMint: 'mock-pubkey:mint:astra-new',
    amountInRaw: '1000000000', // 1,000 xASTRA escrow @ 6 decimals
    grossOutRaw: '2000000000', // rate 2/1 (equal decimals): 1,000 -> 2,000 output @ 6
    feeOutRaw: '20000000', // floor(grossOut / 100)
    userOutRaw: '1980000000',
    normalizationRemainderRaw: '0',
    totalOutputMintedAfterRaw: '230000000000',
    tokenConfigOutputMintedAfterRaw: '20000000000',
    timestamp: MOCK_NOW_TS - 2 * DAY,
    note: 'Mock receipt — AstraPup conversion, xASTRA escrow input (local fixture).',
  },
  {
    id: 'mock-receipt-arcadeforge-001',
    event: 'Converted',
    mockOnly: true,
    campaignId: 'campaign-arcadeforge',
    tokenConfigId: 'tc-arcadeforge',
    holderId: 'holder-whale',
    inputMint: 'mock-pubkey:mint:arcade-old',
    outputMint: 'mock-pubkey:mint:arcade-new',
    amountInRaw: '5000000000', // 5,000 legacy @ 6 decimals
    grossOutRaw: '7500000000', // rate 3/2, same decimals
    feeOutRaw: '75000000', // floor(grossOut / 100)
    userOutRaw: '7425000000',
    normalizationRemainderRaw: '0',
    totalOutputMintedAfterRaw: '1500000000000',
    tokenConfigOutputMintedAfterRaw: '1500000000000',
    timestamp: MOCK_NOW_TS - 8 * DAY,
    note: 'Mock receipt — ArcadeForge S2 conversion (local fixture).',
  },
  {
    id: 'mock-receipt-novarift-001',
    event: 'Converted',
    mockOnly: true,
    campaignId: 'campaign-novarift',
    tokenConfigId: 'tc-novarift',
    holderId: 'holder-multi',
    inputMint: 'mock-pubkey:mint:nova-old',
    outputMint: 'mock-pubkey:mint:nova-new',
    amountInRaw: '2000000000', // 2,000 legacy @ 6 decimals
    grossOutRaw: '2000000000', // rate 1/1, same decimals
    feeOutRaw: '20000000', // floor(grossOut / 100)
    userOutRaw: '1980000000',
    normalizationRemainderRaw: '0',
    totalOutputMintedAfterRaw: '1350000000000',
    tokenConfigOutputMintedAfterRaw: '1350000000000',
    timestamp: MOCK_NOW_TS - 10 * DAY,
    note: 'Mock receipt — NovaRift relaunch conversion, finalized history (local fixture).',
  },
]
