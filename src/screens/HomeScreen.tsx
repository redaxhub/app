// Overview / migration-directory surface — the REDAXHub-style multi-project
// directory. This surface is props-driven by the App-facing RedaxDataSource
// provider (MOCK_LOCAL or one of the three devnet program-data modes): App
// passes Redax*View props in place of the raw mock fixtures. Devnet-parity
// shape stays the same — only the data source changes behind the provider.
// Nothing on this screen uses a wallet or a transaction path (the
// DEVNET_WALLET_READONLY wallet connection shell lives in the app chrome,
// never here); in every devnet mode the provider performs read-only
// program/RPC reads for this screen and the copy below stays mode-aware and
// truthful.
//
// THE DIRECTORY IS CURATED, AND THE COPY SAYS SO. In the devnet modes the rows below
// are exactly the campaigns this deployment curated into its public directory — not a
// census of every campaign account the REDAX program owns. Listing is a deployment
// choice and never review, verification, endorsement or a safety statement, and being
// active is not what makes a campaign listed.

import type { MockCampaignStatus } from '../types/redaxMock'
import type {
  RedaxCampaignView,
  RedaxDirectoryRowView,
  RedaxEnvironmentView,
  RedaxOutputTokenIdentityView,
  RedaxProjectView,
} from '../data/redaxViewModels'
import { isDevnetProgramMode } from '../data/redaxModePredicates'
import { MetricRow } from '../components/MetricRow'
import { ProofBoundaryNote } from '../components/ProofBoundaryNote'
import { RedaxUnlistedCampaignAdoption } from '../components/RedaxUnlistedCampaignAdoption'
import { StatusPill, type StatusTone } from '../components/StatusPill'
import { SurfaceCard } from '../components/SurfaceCard'
import {
  PRODUCT_DEFINITION,
  PRODUCT_TAGLINE,
  PUBLIC_DIRECTORY_CURATION_NOTE,
  PUBLIC_DIRECTORY_CURATION_SHORT,
} from '../lib/productCopy'

// --- Shared directory vocabulary (also imported by the holder surface) ------

export type CampaignStatusFilter = 'all' | MockCampaignStatus
export type CampaignSortMode = 'priority' | 'ending-soon' | 'eligibility'

interface StatusMeta {
  readonly label: string
  readonly tone: StatusTone
}

const STATUS_META: Record<MockCampaignStatus, StatusMeta> = {
  active: { label: 'Active', tone: 'positive' },
  cap_near: { label: 'Cap near', tone: 'caution' },
  cap_reached: { label: 'Cap reached', tone: 'caution' },
  paused: { label: 'Paused', tone: 'caution' },
  upcoming: { label: 'Upcoming', tone: 'info' },
  finalized: { label: 'Finalized', tone: 'neutral' },
  metadata_pending: { label: 'Metadata pending', tone: 'info' },
}

const STATUS_COUNT_ORDER: readonly MockCampaignStatus[] = [
  'active',
  'cap_near',
  'cap_reached',
  'paused',
  'upcoming',
  'finalized',
]

const STATUS_FILTERS: readonly { value: CampaignStatusFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'cap_near', label: 'Cap near' },
  { value: 'cap_reached', label: 'Cap reached' },
  { value: 'paused', label: 'Paused' },
  { value: 'upcoming', label: 'Upcoming' },
  { value: 'finalized', label: 'Finalized' },
]

const SORT_OPTIONS: readonly { value: CampaignSortMode; label: string }[] = [
  { value: 'priority', label: 'Priority' },
  { value: 'ending-soon', label: 'Ending soon' },
  { value: 'eligibility', label: 'Eligibility' },
]

export function statusMeta(status: MockCampaignStatus): StatusMeta {
  return STATUS_META[status]
}

export function formatCountdown(endsInSeconds: number | null): string {
  if (endsInSeconds === null) {
    return 'Open window'
  }
  if (endsInSeconds <= 0) {
    return 'Window closed'
  }
  const days = Math.floor(endsInSeconds / 86_400)
  if (days >= 1) {
    return `Ends in ${days}d`
  }
  const hours = Math.max(1, Math.floor(endsInSeconds / 3_600))
  return `Ends in ${hours}h`
}

export function capPercentLabel(bps: number): string {
  return `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 1)}%`
}

function capTone(bps: number): 'accent' | 'caution' {
  return bps >= 9_000 ? 'caution' : 'accent'
}

// --- Output token identity display (shared by Holder / Token team / Admin) ---
//
// Renders the decoded on-chain Metaplex identity when present; otherwise falls
// back to the address-derived short label. No token name or symbol is ever
// hardcoded here — identity values come only from the data source's decode.

export function outputTokenDisplay(
  identity: RedaxOutputTokenIdentityView | undefined,
  fallbackLabel: string,
): string {
  return identity?.source === 'metaplex' ? `${identity.name} (${identity.symbol})` : fallbackLabel
}

export function outputTokenSymbol(
  identity: RedaxOutputTokenIdentityView | undefined,
  fallbackLabel: string,
): string {
  return identity?.source === 'metaplex' ? identity.symbol : fallbackLabel
}

export function outputTokenHint(
  identity: RedaxOutputTokenIdentityView | undefined,
  mintLabel: string,
): string {
  if (identity?.source === 'metaplex') {
    return `output mint ${mintLabel} — name and symbol read from the on-chain Metaplex metadata account`
  }
  if (identity?.source === 'unavailable') {
    return `output mint ${mintLabel} — on-chain metadata unavailable; showing the address-derived identifier`
  }
  return 'configured output — a different asset'
}

function eligibilityMeta(holderEligible: boolean | null): StatusMeta {
  if (holderEligible === null) {
    return { label: 'No holder', tone: 'neutral' }
  }
  return holderEligible
    ? { label: 'Eligible', tone: 'positive' }
    : { label: 'Not eligible', tone: 'neutral' }
}

// --- Meter (cap utilization / proof completeness progress bar) --------------

interface MeterProps {
  label: string
  percent: number
  caption?: string
  tone?: 'accent' | 'caution' | 'positive'
}

function Meter({ label, percent, caption, tone = 'accent' }: MeterProps) {
  const clamped = Math.max(0, Math.min(100, percent))
  return (
    <div className="meter">
      <div className="meter__head">
        <span className="meter__label">{label}</span>
        <span className="meter__value">{caption ?? `${Math.round(clamped)}%`}</span>
      </div>
      <div className="meter__track">
        <div className={`meter__fill meter__fill--${tone}`} style={{ width: `${clamped}%` }} />
      </div>
    </div>
  )
}

// --- Campaign card (shared directory primitive, reused on the holder surface)
//
// The row prop is typed RedaxDirectoryRowView. MockCampaignDirectoryRow is
// structurally assignable to it, so the non-migrated Holder/Token team surfaces
// keep passing their mock rows here without any edit.

interface CampaignCardProps {
  row: RedaxDirectoryRowView
  active: boolean
  showEligibility: boolean
  onSelect: (campaignId: string) => void
}

export function CampaignCard({ row, active, showEligibility, onSelect }: CampaignCardProps) {
  const status = statusMeta(row.displayStatus)
  const elig = eligibilityMeta(row.holderEligible)
  return (
    <div
      className={active ? 'campaign-card campaign-card--active' : 'campaign-card'}
      role="button"
      tabIndex={0}
      aria-pressed={active}
      onClick={() => onSelect(row.campaignId)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onSelect(row.campaignId)
        }
      }}
    >
      <div className="campaign-card__head">
        <div className="campaign-card__id">
          <span className="campaign-card__name">{row.projectName}</span>
          <span className="campaign-card__symbol">{row.symbol}</span>
        </div>
        <StatusPill tone={status.tone} label={status.label} />
      </div>
      <div className="meters">
        <Meter
          label="Cap used"
          percent={row.capUtilizationBps / 100}
          caption={capPercentLabel(row.capUtilizationBps)}
          tone={capTone(row.capUtilizationBps)}
        />
        <Meter label="Proof" percent={row.proofCompletenessPercent} caption={row.proofCaption} />
      </div>
      <div className="campaign-card__foot">
        <span className="campaign-card__window">{formatCountdown(row.endsInSeconds)}</span>
        {showEligibility ? <StatusPill tone={elig.tone} label={elig.label} /> : null}
      </div>
    </div>
  )
}

// --- Screen -----------------------------------------------------------------

export interface HomeScreenProps {
  environment: RedaxEnvironmentView | null
  directoryRows: readonly RedaxDirectoryRowView[]
  featuredCampaigns: readonly RedaxCampaignView[]
  selectedCampaign: RedaxCampaignView | null
  selectedProject: RedaxProjectView | null
  selectedCampaignId: string
  statusFilter: CampaignStatusFilter
  sortMode: CampaignSortMode
  holderLabel: string
  isLoading: boolean
  loadError: string | null
  onStatusFilterChange: (value: CampaignStatusFilter) => void
  onSortModeChange: (value: CampaignSortMode) => void
  /** A click on a CURATED directory row. Listed selection, and nothing else. */
  onSelectCampaign: (campaignId: string) => void
  /**
   * An EXACT address a human typed and deliberately clicked to open. It arrives
   * already trimmed and already proven canonical by the adoption control; this screen
   * passes it up unchanged and classifies nothing.
   */
  onAdoptUnlistedCampaign: (campaignId: string) => void
}

function endsKey(endsInSeconds: number | null): number {
  if (endsInSeconds === null || endsInSeconds <= 0) {
    return Number.POSITIVE_INFINITY
  }
  return endsInSeconds
}

export function HomeScreen({
  environment,
  directoryRows,
  featuredCampaigns,
  selectedCampaign,
  selectedProject,
  selectedCampaignId,
  statusFilter,
  sortMode,
  holderLabel,
  isLoading,
  loadError,
  onStatusFilterChange,
  onSortModeChange,
  onSelectCampaign,
  onAdoptUnlistedCampaign,
}: HomeScreenProps) {
  const isDevnetProgram = isDevnetProgramMode(environment?.mode)

  const counts = STATUS_COUNT_ORDER.map((status) => ({
    status,
    count: directoryRows.filter((row) => row.displayStatus === status).length,
  }))

  const featuredRows = featuredCampaigns
    .map((campaign) => directoryRows.find((row) => row.campaignId === campaign.id))
    .filter((row): row is RedaxDirectoryRowView => row !== undefined)

  const filteredRows =
    statusFilter === 'all'
      ? directoryRows
      : directoryRows.filter((row) => row.displayStatus === statusFilter)

  const sortedRows = [...filteredRows].sort((a, b) => {
    if (sortMode === 'ending-soon') {
      const delta = endsKey(a.endsInSeconds) - endsKey(b.endsInSeconds)
      return delta !== 0 ? delta : a.sortPriority - b.sortPriority
    }
    if (sortMode === 'eligibility') {
      const aRank = a.holderEligible ? 0 : 1
      const bRank = b.holderEligible ? 0 : 1
      return aRank !== bRank ? aRank - bRank : a.sortPriority - b.sortPriority
    }
    return a.sortPriority - b.sortPriority
  })

  const selectedRow = selectedCampaign
    ? directoryRows.find((row) => row.campaignId === selectedCampaign.id) ?? null
    : null

  return (
    <>
      <section className="hero">
        <p className="hero__eyebrow">REDAX — Phase 1</p>
        <h1 className="hero__title">Conversion infrastructure that proves what it did.</h1>
        <p className="hero__lede">{PRODUCT_TAGLINE}</p>
        <p className="hero__lede">{PRODUCT_DEFINITION}</p>
        <div className="hero__pills">
          <StatusPill tone="accent" label="Proof-bounded" />
          <StatusPill tone="info" label="Multi-project directory" />
          <StatusPill tone="neutral" label={environment?.dataSourceLabel ?? 'Loading data source…'} />
          <StatusPill tone="neutral" label="No readiness signal" />
        </div>
      </section>

      {loadError ? (
        <SurfaceCard eyebrow="Migration directory" title="Data load failed">
          <p className="note-line">{loadError}</p>
        </SurfaceCard>
      ) : isLoading ? (
        <SurfaceCard eyebrow="Migration directory" title="Loading directory data">
          <p className="note-line">Loading the migration directory from the configured data source…</p>
        </SurfaceCard>
      ) : (
        <>
          <SurfaceCard
            eyebrow="Migration directory"
            title="Directory snapshot"
            footnote={environment?.dataSourceLabel ?? 'Loading data source…'}
          >
            <p className="note-line">
              {environment?.boundaryLabel ?? 'Data source is loading.'}{' '}
              {isDevnetProgram ? (
                <>
                  Campaign names are address-derived campaign identifiers — no on-chain project
                  registry or profile exists. Holder eligibility personalization is not read on
                  this surface.
                </>
              ) : (
                <>
                  Eligibility is shown for <strong>{holderLabel}</strong> — switch holder on the
                  Holder trial surface.
                </>
              )}
            </p>
            {isDevnetProgram ? (
              <p className="note-line">{PUBLIC_DIRECTORY_CURATION_NOTE}</p>
            ) : null}
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
            eyebrow="Open now"
            title="Featured migrations"
            footnote="Featured orders the listed campaigns by lifecycle state; being active is a display order and never what makes a campaign listed. Selecting a card updates the summary below."
          >
            <div className="campaign-grid">
              {featuredRows.map((row) => (
                <CampaignCard
                  key={row.campaignId}
                  row={row}
                  active={row.campaignId === selectedCampaignId}
                  showEligibility
                  onSelect={onSelectCampaign}
                />
              ))}
            </div>
          </SurfaceCard>

          <SurfaceCard
            eyebrow="Directory"
            title={isDevnetProgram ? 'Listed migrations' : 'All migrations'}
            footnote={isDevnetProgram ? PUBLIC_DIRECTORY_CURATION_SHORT : undefined}
          >
            <div className="toolbar">
              <div className="toolbar__group">
                <span className="toolbar__label">Filter by status</span>
                <div className="seg" role="group" aria-label="Filter by status">
                  {STATUS_FILTERS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      className={option.value === statusFilter ? 'seg__btn seg__btn--active' : 'seg__btn'}
                      aria-pressed={option.value === statusFilter}
                      onClick={() => onStatusFilterChange(option.value)}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="toolbar__group">
                <span className="toolbar__label">Sort</span>
                <div className="seg" role="group" aria-label="Sort migrations">
                  {SORT_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      className={option.value === sortMode ? 'seg__btn seg__btn--active' : 'seg__btn'}
                      aria-pressed={option.value === sortMode}
                      onClick={() => onSortModeChange(option.value)}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {sortedRows.length > 0 ? (
              <div className="campaign-grid">
                {sortedRows.map((row) => (
                  <CampaignCard
                    key={row.campaignId}
                    row={row}
                    active={row.campaignId === selectedCampaignId}
                    showEligibility
                    onSelect={onSelectCampaign}
                  />
                ))}
              </div>
            ) : (
              <p className="note-line">
                {isDevnetProgram
                  ? 'No listed migration matches this status filter. An unlisted campaign is never shown by these rows — open one by its exact address below.'
                  : 'No migrations match this status filter.'}
              </p>
            )}
          </SurfaceCard>

          {/*
            The by-address workspace opener, mounted ONCE and only in the devnet modes.
            MOCK_LOCAL has no addresses to open and no directory to be unlisted from, so
            it is not offered there. This screen hands the callback straight up to App;
            it opens nothing itself, reads nothing, and lists nothing.
          */}
          {isDevnetProgram ? (
            <RedaxUnlistedCampaignAdoption onAdoptCampaign={onAdoptUnlistedCampaign} />
          ) : null}

          {selectedCampaign ? (
            <SurfaceCard
              eyebrow="Selected migration"
              title={selectedCampaign.name}
              footnote={
                selectedCampaign.statusNote ??
                (isDevnetProgram
                  ? 'The title above is an address-derived campaign identifier (campaign account) — not a project or product name.'
                  : undefined)
              }
            >
              <div className="summary__head">
                <StatusPill
                  tone={statusMeta(selectedCampaign.displayStatus).tone}
                  label={statusMeta(selectedCampaign.displayStatus).label}
                />
                <span className="note-line">
                  {selectedProject?.tagline ??
                    'No on-chain project registry or profile is attached to this campaign.'}
                </span>
              </div>
              {selectedRow ? (
                <div className="meters">
                  <Meter
                    label="Cap utilization"
                    percent={selectedRow.capUtilizationBps / 100}
                    caption={capPercentLabel(selectedRow.capUtilizationBps)}
                    tone={capTone(selectedRow.capUtilizationBps)}
                  />
                  <Meter
                    label="Proof completeness"
                    percent={selectedRow.proofCompletenessPercent}
                    caption={selectedRow.proofCaption}
                  />
                </div>
              ) : null}
              <MetricRow
                label="Legacy input mint"
                value={selectedCampaign.primaryLegacyMintLabel ?? '— (see accepted inputs)'}
                hint="legacy input mint identifier — burned on conversion"
              />
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
                label="Campaign window"
                value={selectedRow ? formatCountdown(selectedRow.endsInSeconds) : '—'}
                hint="conversions are rejected after the window closes"
              />
              <MetricRow label="Protocol fee" value="100 bps (1%)" hint="disclosed up front, deducted from gross output" />
            </SurfaceCard>
          ) : (
            <SurfaceCard eyebrow="Selected migration" title="No migration selected">
              <p className="note-line">Select a card above to see the campaign summary.</p>
            </SurfaceCard>
          )}
        </>
      )}

      <ProofBoundaryNote />
    </>
  )
}
