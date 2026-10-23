// REDAX customer service — where a setup stands, derived from the chain and the frozen plan.
//
// THE CHAIN DECIDES WHAT IS DONE. A step counts as done only when a fresh exact-address read of
// the campaign shows it: the accepted input exists with exactly the plan's terms, the metadata
// flag is set, the status moved past `initialized`. Nothing here trusts a remembered click, an
// API answer or a previous render.
//
// THE PLAN IS NEVER EDITED TO FIT THE CHAIN. If the chain shows something the plan does not —
// another admin, another output mint, an input that is not a plan row, a row with different
// terms, a different end or total limit — the progress is `MISMATCH` and every guided write
// stops. The customer is told what differs; nothing is "corrected".

import type { RedaxCampaignView, RedaxTokenConfigView } from '../data/redaxViewModels'
import type { RedaxCustomerPlanRowV1, RedaxCustomerSetupRecordV1 } from './shared/customerContract.js'

export type RedaxCustomerStepKind = 'CREATE' | 'ADD' | 'METADATA' | 'ACTIVATE'

export interface RedaxCustomerStep {
  readonly key: string
  readonly kind: RedaxCustomerStepKind
  readonly row: RedaxCustomerPlanRowV1 | null
  readonly done: boolean
}

export type RedaxCustomerNext =
  | { readonly kind: 'CREATE' }
  | { readonly kind: 'ADD'; readonly row: RedaxCustomerPlanRowV1; readonly index: number }
  | { readonly kind: 'METADATA' }
  | { readonly kind: 'ACTIVATE' }
  | { readonly kind: 'DONE'; readonly status: 'active' | 'paused' | 'finalized' }
  | { readonly kind: 'MISMATCH'; readonly reason: string }
  | { readonly kind: 'NOT_READY'; readonly reason: string }

export interface RedaxCustomerProgress {
  readonly steps: readonly RedaxCustomerStep[]
  readonly next: RedaxCustomerNext
  /** Wallet approvals this plan takes in total: Create + one per input + metadata + open. */
  readonly totalApprovals: number
  readonly doneApprovals: number
}

export interface RedaxCustomerChainView {
  readonly campaign: RedaxCampaignView
  readonly tokenConfigs: readonly RedaxTokenConfigView[]
}

function stepsFor(setup: RedaxCustomerSetupRecordV1, done: (kind: RedaxCustomerStepKind, row: RedaxCustomerPlanRowV1 | null) => boolean): RedaxCustomerStep[] {
  const plan = setup.plan
  if (plan === null) {
    return []
  }
  return [
    { key: 'create', kind: 'CREATE', row: null, done: done('CREATE', null) },
    ...plan.rows.map((row) => ({ key: `add:${row.rowId}`, kind: 'ADD' as const, row, done: done('ADD', row) })),
    { key: 'metadata', kind: 'METADATA', row: null, done: done('METADATA', null) },
    { key: 'activate', kind: 'ACTIVATE', row: null, done: done('ACTIVATE', null) },
  ]
}

function summarize(steps: readonly RedaxCustomerStep[], next: RedaxCustomerNext): RedaxCustomerProgress {
  return { steps, next, totalApprovals: steps.length, doneApprovals: steps.filter((step) => step.done).length }
}

/**
 * Derive progress. `chain` is the fresh reading of the bound campaign, or `null` when the
 * setup has no campaign yet (or the reading is not available — then STARTED is NOT_READY).
 */
export function deriveRedaxCustomerProgress(
  setup: RedaxCustomerSetupRecordV1,
  chain: RedaxCustomerChainView | null,
): RedaxCustomerProgress {
  const plan = setup.plan
  if (plan === null || setup.planHash === null) {
    return summarize([], { kind: 'NOT_READY', reason: 'This setup has not been reviewed yet.' })
  }
  if (setup.state === 'DRAFT' || setup.state === 'REVIEW_READY') {
    return summarize(stepsFor(setup, () => false), { kind: 'NOT_READY', reason: 'Start the setup from its review first.' })
  }
  if (setup.state === 'PUBLISHED' || setup.campaign === null) {
    return summarize(stepsFor(setup, () => false), { kind: 'CREATE' })
  }
  if (chain === null) {
    return summarize(
      stepsFor(setup, (kind) => kind === 'CREATE'),
      { kind: 'NOT_READY', reason: 'The campaign could not be read from Devnet just now.' },
    )
  }
  const { campaign, tokenConfigs } = chain
  if (campaign.id !== setup.campaign.address) {
    return summarize(stepsFor(setup, (kind) => kind === 'CREATE'), { kind: 'MISMATCH', reason: 'The campaign read does not belong to this setup.' })
  }
  if (campaign.campaignAdmin !== undefined && campaign.campaignAdmin !== plan.teamWallet) {
    return summarize(stepsFor(setup, (kind) => kind === 'CREATE'), { kind: 'MISMATCH', reason: 'The campaign on chain has a different admin wallet.' })
  }
  if (campaign.outputMint !== setup.campaign.outputMint) {
    return summarize(stepsFor(setup, (kind) => kind === 'CREATE'), { kind: 'MISMATCH', reason: 'The campaign on chain has a different new-token mint.' })
  }
  const planEnd = plan.end.mode === 'DATE' ? plan.end.unixSeconds : null
  const chainEnd = campaign.endTs === null ? null : String(campaign.endTs)
  if (planEnd !== chainEnd) {
    return summarize(stepsFor(setup, (kind) => kind === 'CREATE'), { kind: 'MISMATCH', reason: 'The campaign on chain has a different end time than the reviewed plan.' })
  }
  if (campaign.maxOutputSupplyRaw !== plan.totalLimit.maxOutputSupply) {
    return summarize(stepsFor(setup, (kind) => kind === 'CREATE'), { kind: 'MISMATCH', reason: 'The campaign on chain has a different total limit than the reviewed plan.' })
  }
  const present = new Set<string>()
  for (const config of tokenConfigs) {
    const row = plan.rows.find((entry) => entry.legacyMint === config.legacyMint)
    if (row === undefined) {
      return summarize(stepsFor(setup, (kind) => kind === 'CREATE'), { kind: 'MISMATCH', reason: 'The campaign on chain accepts an old token that is not in the reviewed plan.' })
    }
    if (
      config.rateNumeratorRaw !== row.rateNumerator ||
      config.rateDenominatorRaw !== row.rateDenominator ||
      config.maxOutputFromTokenConfigRaw !== row.maxOutputFromTokenConfig ||
      config.legacyDecimals !== row.legacyDecimals
    ) {
      return summarize(stepsFor(setup, (kind) => kind === 'CREATE'), { kind: 'MISMATCH', reason: 'An old token on chain has different terms than the reviewed plan.' })
    }
    present.add(row.rowId)
  }
  const statusMovedOn = campaign.programStatus !== 'initialized'
  const steps = stepsFor(setup, (kind, row) => {
    switch (kind) {
      case 'CREATE':
        return true
      case 'ADD':
        return row !== null && present.has(row.rowId)
      case 'METADATA':
        return campaign.metadataSetup
      case 'ACTIVATE':
        return statusMovedOn
    }
  })
  const missingIndex = plan.rows.findIndex((row) => !present.has(row.rowId))
  if (missingIndex !== -1) {
    if (statusMovedOn) {
      return summarize(steps, { kind: 'MISMATCH', reason: 'The campaign was opened before every planned old token was added.' })
    }
    return summarize(steps, { kind: 'ADD', row: plan.rows[missingIndex], index: missingIndex })
  }
  if (!campaign.metadataSetup) {
    return summarize(steps, statusMovedOn ? { kind: 'MISMATCH', reason: 'The campaign was opened before its token details were set.' } : { kind: 'METADATA' })
  }
  if (!statusMovedOn) {
    return summarize(steps, { kind: 'ACTIVATE' })
  }
  return summarize(steps, { kind: 'DONE', status: campaign.programStatus as 'active' | 'paused' | 'finalized' })
}
