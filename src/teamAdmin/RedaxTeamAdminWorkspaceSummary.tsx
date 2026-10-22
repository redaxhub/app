// The Team workspace summary — where this campaign stands, what is next, and one control to
// check and refresh everything (demo customer flow, 2026-10-22).
//
// READ-ONLY PRESENTATION. Every fact below comes from the campaign and accepted inputs App
// already loaded from devnet (or from its last bounded refresh), and it says when that was.
// It holds no wallet, no action root and no journal; its one control asks App for a bounded
// refresh, which re-reads the campaign and asks each panel to re-read its saved action once.
// A fresh reading shown here is never write permission: every action keeps its own guards.
//
// IT SEPARATES WHAT IS SAVED ON CHAIN FROM WHAT IS NOT. Inputs are counted from the chain;
// unsent drafts live in the setup panel and are not counted here. Creating a campaign did not
// add inputs, set metadata or open it to holders — each is its own approval below.

import { MetricRow } from '../components/MetricRow'
import { RedaxPublicAddress } from '../components/RedaxPublicAddress'
import { StatusPill } from '../components/StatusPill'
import { SurfaceCard } from '../components/SurfaceCard'
import type { RedaxCampaignView, RedaxTokenConfigView } from '../data/redaxViewModels'
import { describeRedaxCampaignEnd, describeRedaxGrossCap } from '../lib/redaxCampaignFacts'
import { buildRedaxCampaignShareUrl } from '../lib/redaxPublicLinks'

/** Re-exported so App names one Team/Admin presentation module for the workspace check. */
export type { RedaxTeamAdminWorkspaceCheckRequest } from './redaxTeamAdminWorkspaceRefresh'

/** The last bounded workspace check, as App recorded it. */
export interface RedaxTeamAdminWorkspaceCheckState {
  /** Device time of the last completed campaign read, in ms, or `null` for none yet. */
  readonly checkedAtMs: number | null
  readonly refreshing: boolean
  /** The last refresh could not read the campaign; the figures below are older. */
  readonly failed: boolean
}

export interface RedaxTeamAdminWorkspaceSummaryProps {
  readonly campaign: RedaxCampaignView | null
  readonly tokenConfigs: readonly RedaxTokenConfigView[]
  readonly approvedTeamWallet: string | null
  readonly explorerCluster: string | null
  readonly appBaseUrl: string | null
  readonly checkState: RedaxTeamAdminWorkspaceCheckState
  readonly onCheckAndRefresh: () => void
}

function lifecycleLabel(status: RedaxCampaignView['programStatus']): { label: string; tone: 'positive' | 'caution' | 'neutral' } {
  switch (status) {
    case 'active':
      return { label: 'Open to holders', tone: 'positive' }
    case 'paused':
      return { label: 'Paused — holders cannot convert', tone: 'caution' }
    case 'finalized':
      return { label: 'Finalized — closed for good', tone: 'neutral' }
    default:
      return { label: 'Setting up — not open to holders yet', tone: 'neutral' }
  }
}

export function RedaxTeamAdminWorkspaceSummary({
  campaign,
  tokenConfigs,
  approvedTeamWallet,
  explorerCluster,
  appBaseUrl,
  checkState,
  onCheckAndRefresh,
}: RedaxTeamAdminWorkspaceSummaryProps) {
  const nowMs = Date.now()
  const checkedLine =
    checkState.refreshing
      ? 'Checking devnet…'
      : checkState.failed
        ? 'The last check could not read devnet. The figures below are from an earlier reading — check again.'
        : checkState.checkedAtMs === null
          ? 'Not checked yet in this session.'
          : `Last checked at ${new Date(checkState.checkedAtMs).toLocaleTimeString()} (this device).`

  if (campaign === null || campaign.campaignAddress === undefined) {
    return (
      <SurfaceCard eyebrow="Your campaign" title="No campaign open">
        <p className="note-line">
          Create a campaign below, or open one by its address on the Overview page. Nothing is listed or opened automatically.
        </p>
      </SurfaceCard>
    )
  }

  const campaignAddress = campaign.campaignAddress
  const ownCampaign = approvedTeamWallet !== null && campaign.campaignAdmin === approvedTeamWallet
  const inputs = tokenConfigs.filter((config) => config.campaignId === campaign.id)
  const outputDecimals = inputs[0]?.outputDecimals ?? 9
  const lifecycle = lifecycleLabel(campaign.programStatus)
  const shareUrl = appBaseUrl === null ? null : buildRedaxCampaignShareUrl(appBaseUrl, campaignAddress)
  const setupOpen = campaign.programStatus === 'initialized'

  return (
    <SurfaceCard eyebrow="Your campaign" title="Where this campaign stands">
      <div className="workspace-summary">
        {!ownCampaign ? (
          <p className="wizard-preview__fieldwarning">
            This campaign is managed by a different Team wallet than the one approved here. You can view it, but the actions below will not manage it.
          </p>
        ) : null}
        <RedaxPublicAddress
          explorerCluster={explorerCluster}
          hint="the Campaign account holders open"
          kind="address"
          label="Campaign address"
          value={campaignAddress}
        />
        <RedaxPublicAddress
          explorerCluster={explorerCluster}
          hint="the new output token"
          kind="address"
          label="Output token mint"
          value={campaign.outputMint}
        />

        <ol className="workspace-summary__steps">
          <li>
            <StatusPill label="Done" tone="positive" /> Campaign created on chain (limit and end are fixed).
          </li>
          <li>
            <StatusPill label={inputs.length > 0 ? `${inputs.length} / 10 saved` : 'None saved yet'} tone={inputs.length > 0 ? 'positive' : 'caution'} />{' '}
            Accepted input tokens — each is saved by its own approval; unsent drafts below are not counted.
          </li>
          <li>
            <StatusPill label={campaign.metadataSetup ? 'Saved' : 'Not set yet'} tone={campaign.metadataSetup ? 'positive' : 'caution'} />{' '}
            Token name, symbol and metadata reference — fixed on chain once set. The image and file the
            reference points to are hosted off chain; their bytes and availability are not guaranteed by it.
          </li>
          <li>
            <StatusPill label={lifecycle.label} tone={lifecycle.tone} /> Opening to holders is a separate approval after inputs and metadata.
          </li>
          <li>
            <StatusPill label={campaign.programStatus === 'initialized' ? 'After opening' : 'Ready to share'} tone="neutral" /> Share the campaign
            with holders.
          </li>
          <li>
            <StatusPill label={setupOpen ? 'Later' : 'Available'} tone="neutral" /> Manage: pause, unpause, or finalize (final).
          </li>
        </ol>

        <MetricRow
          label="Campaign output limit (gross)"
          value={describeRedaxGrossCap(campaign.maxOutputSupplyRaw, campaign.totalOutputMintedRaw, outputDecimals)}
          hint="holders’ net plus the REDAX fee; not reserved for anyone"
        />
        <MetricRow label="End" value={describeRedaxCampaignEnd(campaign.endTs, nowMs)} hint="the network’s clock decides; reaching it does not finalize" />
        {inputs.map((config, index) => (
          <MetricRow
            key={config.id}
            label={`Input ${index + 1}: ${config.legacyMint.slice(0, 4)}…${config.legacyMint.slice(-4)} (${config.legacyDecimals} decimals)`}
            value={`${config.rateDenominatorRaw} old → ${config.rateNumeratorRaw} new · ${describeRedaxGrossCap(
              config.maxOutputFromTokenConfigRaw,
              config.totalOutputMintedFromTokenConfigRaw,
              config.outputDecimals,
            )}`}
          />
        ))}

        {shareUrl !== null && campaign.programStatus !== 'initialized' ? (
          <RedaxPublicAddress
            explorerCluster={null}
            hint="fills in the address for holders; they still choose to open it, and it is not a REDAX listing"
            kind="link"
            label="Holder link"
            value={shareUrl}
          />
        ) : null}

        <div className="workspace-summary__check">
          <button className="wallet-badge__btn" disabled={checkState.refreshing} onClick={onCheckAndRefresh} type="button">
            Check and refresh
          </button>
          <p className={checkState.failed ? 'wizard-preview__fieldwarning' : 'wizard-preview__fieldnote'}>{checkedLine}</p>
          <p className="wizard-preview__fieldnote">
            Reads this campaign and each step's saved action again, once. It signs nothing and sends nothing; to resolve a sent action, use that step's own status check.
          </p>
        </div>
      </div>
    </SurfaceCard>
  )
}
