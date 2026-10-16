// REDAX mock dynamic data — holder personas and balances (fixtures).
//
// Local mock data only. Every wallet address here is a clearly-marked mock
// string, never a real wallet. Personas drive eligibility, directory views, and
// the "reasons not to convert" surface. Amounts are decimal base units (BigInt
// math only). Decimals on each balance match the corresponding legacy mint.

import type { MockHolderBalance, MockHolderProfile } from '../types/redaxMock'

export const MOCK_HOLDER_PROFILES: readonly MockHolderProfile[] = [
  {
    id: 'holder-whale',
    label: 'Whale holder',
    persona: 'whale',
    walletLabel: 'Mock wallet · whale',
    mockAddress: 'mock-pubkey:wallet:whale',
    outputAtaPreparedByCampaignId: {
      'campaign-astrapup': true,
      'campaign-arcadeforge': true,
    },
    preferredSort: 'cap-utilization',
  },
  {
    id: 'holder-small',
    label: 'Small holder',
    persona: 'small-holder',
    walletLabel: 'Mock wallet · small holder',
    mockAddress: 'mock-pubkey:wallet:small',
    outputAtaPreparedByCampaignId: {
      'campaign-astrapup': true,
    },
    preferredSort: 'ending-soon',
  },
  {
    id: 'holder-ineligible',
    label: 'Ineligible holder',
    persona: 'ineligible',
    walletLabel: 'Mock wallet · ineligible',
    mockAddress: 'mock-pubkey:wallet:ineligible',
    // Holds only an unsupported / unconfigured legacy mint; no campaign accepts it.
    outputAtaPreparedByCampaignId: {},
    preferredSort: 'eligibility',
  },
  {
    id: 'holder-multi',
    label: 'Multi-project holder',
    persona: 'multi-project',
    walletLabel: 'Mock wallet · multi-project',
    mockAddress: 'mock-pubkey:wallet:multi',
    // Eligible for the three active campaigns; also holds blocked positions in
    // HelioMesh (paused) and NovaRift (finalized), where no output ATA exists.
    outputAtaPreparedByCampaignId: {
      'campaign-astrapup': true,
      'campaign-arcadeforge': true,
      'campaign-pulsegrid': true,
    },
    preferredSort: 'eligibility',
  },
  {
    id: 'holder-missing-ata',
    label: 'Holder without output ATA',
    persona: 'missing-output-ata',
    walletLabel: 'Mock wallet · missing output ATA',
    mockAddress: 'mock-pubkey:wallet:missing-ata',
    // Has an eligible balance but the output ATA is not yet prepared.
    outputAtaPreparedByCampaignId: {
      'campaign-astrapup': false,
    },
    preferredSort: 'eligibility',
  },
  {
    id: 'holder-zero',
    label: 'Zero-balance holder',
    persona: 'zero-balance',
    walletLabel: 'Mock wallet · zero balance',
    mockAddress: 'mock-pubkey:wallet:zero',
    outputAtaPreparedByCampaignId: {
      'campaign-astrapup': false,
    },
    preferredSort: 'eligibility',
  },
]

export const MOCK_HOLDER_BALANCES: readonly MockHolderBalance[] = [
  // Whale — eligible for AstraPup and ArcadeForge. Also holds two of AstraPup's
  // other accepted classic-SPL inputs (each converts on its own).
  { holderId: 'holder-whale', legacyMint: 'mock-pubkey:mint:astra-old', amountRaw: '5000000000000000', decimals: 9 },
  { holderId: 'holder-whale', legacyMint: 'mock-pubkey:mint:pastra-points', amountRaw: '4000000000', decimals: 6 },
  { holderId: 'holder-whale', legacyMint: 'mock-pubkey:mint:xastra-escrow', amountRaw: '1000000000', decimals: 6 },
  { holderId: 'holder-whale', legacyMint: 'mock-pubkey:mint:arcade-old', amountRaw: '2000000000000', decimals: 6 },

  // Small holder — eligible for AstraPup only.
  { holderId: 'holder-small', legacyMint: 'mock-pubkey:mint:astra-old', amountRaw: '1500000000000', decimals: 9 },

  // Ineligible — balance only in an unsupported / unconfigured mint.
  { holderId: 'holder-ineligible', legacyMint: 'mock-pubkey:mint:legacy-unknown', amountRaw: '10000000000000', decimals: 9 },

  // Multi-project — eligible across AstraPup, ArcadeForge, and PulseGrid; also
  // holds positions in the paused HelioMesh and the finalized NovaRift. Holds
  // two more of AstraPup's accepted classic-SPL inputs alongside the primary.
  { holderId: 'holder-multi', legacyMint: 'mock-pubkey:mint:astra-old', amountRaw: '800000000000000', decimals: 9 },
  { holderId: 'holder-multi', legacyMint: 'mock-pubkey:mint:pastra-points', amountRaw: '600000000', decimals: 6 },
  { holderId: 'holder-multi', legacyMint: 'mock-pubkey:mint:astra-community-receipt', amountRaw: '2500000000', decimals: 6 },
  { holderId: 'holder-multi', legacyMint: 'mock-pubkey:mint:arcade-old', amountRaw: '300000000000', decimals: 6 },
  { holderId: 'holder-multi', legacyMint: 'mock-pubkey:mint:pulse-old', amountRaw: '120000000000', decimals: 6 },
  { holderId: 'holder-multi', legacyMint: 'mock-pubkey:mint:helio-old', amountRaw: '50000000000000', decimals: 9 },
  { holderId: 'holder-multi', legacyMint: 'mock-pubkey:mint:nova-old', amountRaw: '20000000000', decimals: 6 },

  // Missing output ATA — has supported AstraPup balances (primary plus one other
  // accepted input) but the output ATA for campaign-astrapup is not prepared.
  { holderId: 'holder-missing-ata', legacyMint: 'mock-pubkey:mint:astra-old', amountRaw: '4200000000000', decimals: 9 },
  { holderId: 'holder-missing-ata', legacyMint: 'mock-pubkey:mint:pastra-points', amountRaw: '800000000', decimals: 6 },

  // Zero balance — holds the supported mint but with a zero balance.
  { holderId: 'holder-zero', legacyMint: 'mock-pubkey:mint:astra-old', amountRaw: '0', decimals: 9 },
]
