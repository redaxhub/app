// Admin / campaign lifecycle overview — props-driven by the App-facing
// RedaxDataSource provider (MOCK_LOCAL or any devnet program-data mode): App
// passes Redax*View props in place of the raw mock fixtures. A non-actionable
// operations view over the three source-bound Phase 1 stored-state entities
// (ERD §7: ProtocolConfig, Campaign, TokenConfig): every campaign's status,
// caps, counters, and accepted input configs. THIS SCREEN enables no action in
// any mode — every control on it is a non-actionable preview, it holds no admin
// authority, and nothing on it executes. That is a statement about THIS SCREEN and
// not about the product: the Team/Admin surface does mount wallet-gated devnet
// actions, and they live there rather than here. Its devnet reads are read-only
// program/RPC reads, and neither the wallet connection shell nor any
// wallet-gated action surface lives here.
//
// TWO SUMMARY SOURCES, DELIBERATELY NOT ONE. The campaign LIST below is the curated
// public set, and it keeps reading the global curated summaries. The SELECTED campaign
// detail reads its own selection-scoped summary instead, because the selected campaign
// may be one a human opened by exact address — which has no row in the curated set at
// all — and looking it up there would have described a campaign with ten accepted
// inputs as one with none. Neither source is appended to the other.

import type {
  RedaxCampaignInputSummaryView,
  RedaxCampaignView,
  RedaxDirectoryRowView,
  RedaxDisplayCampaignStatus,
  RedaxEnvironmentView,
  RedaxProjectView,
} from '../data/redaxViewModels'
import { isDevnetProgramMode } from '../data/redaxModePredicates'
import { MetricRow } from '../components/MetricRow'
import { ProofBoundaryNote } from '../components/ProofBoundaryNote'
import { StatusPill } from '../components/StatusPill'
import { SurfaceCard } from '../components/SurfaceCard'
import {
  capPercentLabel,
  formatCountdown,
  outputTokenDisplay,
  outputTokenHint,
  outputTokenSymbol,
  statusMeta,
} from './HomeScreen'
import { formatTokenAmount, InputConfigCard } from './TokenTeamTrialScreen'
import { PUBLIC_DIRECTORY_CURATION_SHORT } from '../lib/productCopy'

const PROTOCOL_FEE_LABEL = '100 bps / 1%'

const STATUS_COUNT_ORDER: readonly RedaxDisplayCampaignStatus[] = [
  'active',
  'cap_near',
  'cap_reached',
  'paused',
  'upcoming',
  'finalized',
]

const LIFECYCLE_STATES = ['Initialized', 'Active', 'Paused', 'Finalized'] as const

const LIFECYCLE_CONTROLS: readonly { name: string; note: string }[] = [
  {
    name: 'Pause',
    note: 'Campaign admin or the protocol emergency pause authority may pause an active campaign.',
  },
  {
    name: 'Unpause',
    note: 'Campaign admin only; returns a paused campaign to active.',
  },
  {
    name: 'Finalize',
    note: 'Campaign admin only; terminal — a finalized campaign does not reopen.',
  },
]

export interface AdminOverviewScreenProps {
  environment: RedaxEnvironmentView | null
  campaigns: readonly RedaxCampaignView[]
  directoryRows: readonly RedaxDirectoryRowView[]
  selectedCampaign: RedaxCampaignView | null
  selectedProject: RedaxProjectView | null
  selectedCampaignId: string
  /** The GLOBAL CURATED summaries — the campaign list's source, and only that. */
  campaignInputSummaries: readonly RedaxCampaignInputSummaryView[]
  /**
   * The CURRENT WORKSPACE's own summary, loaded for the selected campaign whether or
   * not it is curated. Used for the selected-campaign detail only, and only when its
   * `campaignId` agrees exactly with the selected id.
   */
  selectedInputSummary: RedaxCampaignInputSummaryView | null
  isLoading: boolean
  loadError: string | null
  onSelectCampaign: (campaignId: string) => void
}

export function AdminOverviewScreen({
  environment,
  campaigns,
  directoryRows,
  selectedCampaign,
  selectedProject,
  selectedCampaignId,
  campaignInputSummaries,
  selectedInputSummary,
  isLoading,
  loadError,
  onSelectCampaign,
}: AdminOverviewScreenProps) {
  // EXACT AGREEMENT OR NOTHING. A summary that is about a different campaign is not a
  // summary of this one, and a near-miss here would print another campaign's accepted
  // inputs under this campaign's name.
  const selectedSummary =
    selectedInputSummary !== null && selectedInputSummary.campaignId === selectedCampaignId
      ? selectedInputSummary
      : null

  const mode = environment?.mode ?? null
  const isDevnetProgram = isDevnetProgramMode(mode)
  const isMockLocal = mode === 'MOCK_LOCAL'

  const counts = STATUS_COUNT_ORDER.map((status) => ({
    status,
    count: campaigns.filter((campaign) => campaign.displayStatus === status).length,
  }))

  const selectedConfigRows = selectedSummary?.inputConfigs ?? []
  // `number | null`, and never `?? 0`. Decimals are a property of the output mint that
  // only an accepted-input config proves here; a campaign with no proven decimals — no
  // summary, or no token config yet — has UNKNOWN display decimals, and formatting a
  // raw base-unit amount at an assumed zero would print a number that is wrong by
  // whatever the real decimals turn out to be. Unknown renders as an em dash instead.
  const selectedOutputDecimals: number | null =
    selectedSummary?.inputConfigs[0]?.outputDecimals ?? null
  const selectedOutputSymbol = selectedCampaign
    ? outputTokenSymbol(selectedCampaign.outputTokenIdentity, selectedCampaign.outputMintLabel)
    : '—'
  const formatSelectedOutputAmount = (raw: string): string =>
    selectedOutputDecimals === null
      ? '—'
      : `${formatTokenAmount(raw, selectedOutputDecimals)} ${selectedOutputSymbol}`

  return (
    <>
      <header className="screen-header">
        <p className="screen-header__eyebrow">Admin surface</p>
        <h2 className="screen-header__title">Campaign lifecycle overview</h2>
        <p className="screen-header__lede">
          The operational view for campaign operators: stored campaign state, accepted input
          configs, caps, and counters.{' '}
          {isDevnetProgram ? (
            <>
              Phase 1 stored truth lives in exactly three on-chain accounts; every value here is
              read from the devnet program over RPC (read-only), and every control on this screen
              is a non-actionable preview that runs no transaction.
            </>
          ) : isMockLocal ? (
            <>
              Phase 1 stored truth lives in exactly three on-chain accounts; everything here is a
              local mock view, and every control is a non-actionable preview.
            </>
          ) : (
            <>Data source is loading.</>
          )}
        </p>
        <div className="screen-header__pills">
          <StatusPill tone="neutral" label={environment?.dataSourceLabel ?? 'Loading data source…'} />
          <StatusPill tone="neutral" label="Non-actionable preview" />
        </div>
      </header>

      {loadError ? (
        <SurfaceCard eyebrow="Admin surface" title="Data load failed">
          <p className="note-line">{loadError}</p>
        </SurfaceCard>
      ) : isLoading ? (
        <SurfaceCard eyebrow="Admin surface" title="Loading campaign data">
          <p className="note-line">Loading the admin overview from the configured data source…</p>
        </SurfaceCard>
      ) : (
        <>
          <SurfaceCard
            eyebrow={
              environment
                ? isDevnetProgram
                  ? 'Devnet admin overview (read-only)'
                  : 'MOCK_LOCAL admin overview'
                : 'Admin overview'
            }
            title="Protocol and campaign snapshot"
            footnote={environment?.boundaryLabel ?? 'Data source is loading.'}
          >
            <MetricRow
              label="Protocol fee"
              value={PROTOCOL_FEE_LABEL}
              hint="disclosed per conversion, deducted from gross output"
            />
            <MetricRow
              label="Campaigns"
              value={`${campaigns.length}`}
              hint={
                isDevnetProgram
                  ? 'campaigns this deployment curated into its public list — not every campaign account the program owns'
                  : 'mock campaigns in this mode'
              }
            />
            <div className="count-grid">
              {counts.map(({ status, count }) => (
                <div className="count" key={status}>
                  <span className="count__num">{count}</span>
                  <span className="count__label">{statusMeta(status).label}</span>
                </div>
              ))}
            </div>
          </SurfaceCard>

          <SurfaceCard
            eyebrow="Campaigns"
            title="Campaign lifecycle state"
            footnote="Select a campaign to inspect its accepted input configs and counters. Selecting a campaign is inspection only — it executes nothing."
          >
            {isDevnetProgram ? (
              <>
                <p className="note-line">
                  Campaign names are address-derived campaign identifiers — no on-chain project
                  registry or profile exists.
                </p>
                <p className="note-line">{PUBLIC_DIRECTORY_CURATION_SHORT}</p>
              </>
            ) : null}
            <div className="admin-list">
              {campaigns.map((campaign) => {
                const row = directoryRows.find((entry) => entry.campaignId === campaign.id) ?? null
                const summary =
                  campaignInputSummaries.find((entry) => entry.campaignId === campaign.id) ?? null
                const status = statusMeta(campaign.displayStatus)
                const active = campaign.id === selectedCampaignId
                const outputDecimals = summary?.inputConfigs[0]?.outputDecimals ?? 0
                return (
                  <div
                    key={campaign.id}
                    className={active ? 'admin-row admin-row--active' : 'admin-row'}
                    role="button"
                    tabIndex={0}
                    aria-pressed={active}
                    onClick={() => onSelectCampaign(campaign.id)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        onSelectCampaign(campaign.id)
                      }
                    }}
                  >
                    <div className="admin-row__head">
                      <span className="admin-row__title">{campaign.name}</span>
                      <StatusPill tone={status.tone} label={status.label} />
                    </div>
                    <div className="admin-row__facts">
                      <span className="admin-fact">
                        <span className="admin-fact__label">Output token</span>
                        <span className="admin-fact__value">
                          {outputTokenSymbol(campaign.outputTokenIdentity, campaign.outputMintLabel)}
                        </span>
                      </span>
                      <span className="admin-fact">
                        <span className="admin-fact__label">Accepted inputs</span>
                        <span className="admin-fact__value">
                          {summary?.acceptedInputCount ?? 0} / 10
                        </span>
                      </span>
                      <span className="admin-fact">
                        <span className="admin-fact__label">Cap utilization</span>
                        <span className="admin-fact__value">
                          {row ? capPercentLabel(row.capUtilizationBps) : '—'}
                        </span>
                      </span>
                      <span className="admin-fact">
                        <span className="admin-fact__label">Output minted</span>
                        <span className="admin-fact__value">
                          {formatTokenAmount(campaign.totalOutputMintedRaw, outputDecimals)}
                        </span>
                      </span>
                      <span className="admin-fact">
                        <span className="admin-fact__label">Window</span>
                        <span className="admin-fact__value">
                          {row ? formatCountdown(row.endsInSeconds) : '—'}
                        </span>
                      </span>
                      <span className="admin-fact">
                        <span className="admin-fact__label">Metadata setup</span>
                        <span className="admin-fact__value">
                          {campaign.metadataSetup ? 'Complete' : 'metadata_not_ready'}
                        </span>
                      </span>
                    </div>
                    <span className="admin-row__vault">fee vault · {campaign.protocolFeeVault}</span>
                  </div>
                )
              })}
            </div>
          </SurfaceCard>

          {selectedCampaign ? (
            <SurfaceCard
              eyebrow="Selected campaign"
              title={`${selectedCampaign.name} — accepted input configs`}
              footnote="Per-config caps and counters for the selected campaign. Each conversion uses one selected token config — not a bundled multi-token transaction."
            >
              <div className="summary__head">
                <StatusPill
                  tone={statusMeta(selectedCampaign.displayStatus).tone}
                  label={statusMeta(selectedCampaign.displayStatus).label}
                />
                <span className="note-line">
                  {selectedProject
                    ? selectedProject.tagline
                    : 'No on-chain project registry or profile is attached to this campaign.'}
                </span>
              </div>
              <MetricRow
                label="Output token"
                value={outputTokenDisplay(
                  selectedCampaign.outputTokenIdentity,
                  selectedCampaign.outputMintLabel,
                )}
                hint={outputTokenHint(
                  selectedCampaign.outputTokenIdentity,
                  selectedCampaign.outputMintLabel,
                )}
              />
              <MetricRow
                label="Campaign cap"
                value={formatSelectedOutputAmount(selectedCampaign.maxOutputSupplyRaw)}
                hint={
                  selectedOutputDecimals === null
                    ? 'campaign-level output cap — output decimals are not established for this campaign, so no formatted amount is shown'
                    : 'campaign-level output cap'
                }
              />
              <MetricRow
                label="Output minted"
                value={formatSelectedOutputAmount(selectedCampaign.totalOutputMintedRaw)}
                hint={
                  selectedOutputDecimals === null
                    ? 'campaign-level output minted so far — output decimals are not established for this campaign, so no formatted amount is shown'
                    : 'campaign-level output minted so far'
                }
              />
              <div className="config-list">
                {selectedConfigRows.map((configRow) => (
                  <InputConfigCard key={configRow.tokenConfigId} row={configRow} />
                ))}
              </div>
            </SurfaceCard>
          ) : (
            <SurfaceCard eyebrow="Selected campaign" title="No campaign selected">
              <p className="note-line">
                Select a campaign above to inspect its accepted input configs and counters.
              </p>
            </SurfaceCard>
          )}
        </>
      )}

      <SurfaceCard
        eyebrow="Lifecycle"
        title="Status flow — non-actionable preview"
        footnote="These map to existing program instructions only; the shell adds no new instruction, account, event, or error, and executes nothing."
      >
        <div className="lifecycle" aria-label="Campaign status chain">
          {LIFECYCLE_STATES.map((state, index) => (
            <span key={state} style={{ display: 'contents' }}>
              {index > 0 ? (
                <span className="lifecycle__arrow" aria-hidden="true">
                  →
                </span>
              ) : null}
              <span className="lifecycle__state">{state}</span>
            </span>
          ))}
        </div>
        <div className="checklist">
          {LIFECYCLE_CONTROLS.map((control) => (
            <div className="checklist__item" key={control.name}>
              <span className="checklist__text">
                <span className="checklist__marker" aria-hidden="true" />
                <span>
                  <strong>{control.name}</strong> — {control.note}
                </span>
              </span>
              <StatusPill tone="neutral" label="Non-actionable preview" />
            </div>
          ))}
        </div>
      </SurfaceCard>

      <SurfaceCard
        eyebrow="Authority model"
        title="Constrained minting, stated honestly"
        footnote="REDAX does not certify any project; it enforces the campaign's published conversion rules."
      >
        <p>
          The campaign account is the output mint's minting authority and can only mint per the
          published conversion rules — removing arbitrary-mint risk.{' '}
          {isDevnetProgram ? (
            <>
              This screen reads devnet program state over RPC (read-only);{' '}
              {mode === 'DEVNET_WALLET_READONLY'
                ? 'wallet connection is read-only context in the app chrome only, and this screen offers no transaction path.'
                : 'this screen connects no wallet and offers no transaction path.'}
            </>
          ) : isMockLocal ? (
            <>
              This MOCK_LOCAL view uses local sample data only: it connects no wallet, performs no
              RPC, and opens no devnet connection. Every value here is local sample data from the
              RedaxDataSource, not chain data.
            </>
          ) : (
            <>Data source is loading.</>
          )}
        </p>
      </SurfaceCard>

      <ProofBoundaryNote />
    </>
  )
}
