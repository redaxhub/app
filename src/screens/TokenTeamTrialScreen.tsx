// Token / project team trial surface — the near-term required evaluation path
// (UX direction §16): a real team assessing REDAX on devnet. Props-driven by the
// App-facing RedaxDataSource provider (MOCK_LOCAL or one of the three devnet
// program-data modes): App passes Redax*View props in place of the raw mock
// fixtures. The team picks a campaign and sees its true REDAX shape — one
// campaign, one output mint, up to ten accepted classic-SPL input configs, each
// with its own rate, cap, and counters. In every devnet mode the provider
// performs read-only program/RPC reads against the deployed devnet program, and
// the DEVNET_WALLET_READONLY wallet connection shell lives in the app chrome,
// never on this screen.
//
// THIS SCREEN OWNS NO ACTION. In DEVNET_TX_ENABLED it renders an opaque,
// App-supplied Team/Admin action node (teamAdminActionSlot) and knows nothing
// about it: it imports no wallet facade, no Team/Admin action hook, no entrypoint
// of either Team/Admin corridor, and no adapter, and it receives no action method
// as a prop. The slot components own all of that inside App's providers.
//
// THE CAMPAIGN LIST BELOW IS THE CURATED PUBLIC ONE, in the devnet modes: it is what
// this deployment listed, not a census of every campaign account the program owns.
// A campaign opened by exact address is legitimately absent from it, and the setup
// checks below say so rather than computing a directory-derived result out of nothing.
//
// WHAT THAT NODE CONTAINS IS NOT THIS SCREEN'S BUSINESS. In DEVNET_TX_ENABLED it is a
// pointer to the Team workspace screen, where a customer signs in and runs their own setup.
// This screen imports nothing from the Team/Admin tree, receives one opaque node, and cannot
// reach a builder, a wallet, a signer or a send.
//
// The screen also hosts, in the modes that have no action slot, the Team/Admin
// wizard preview — the supply-side setup step model, whose fields are local draft
// inputs held in that component's own memory. The preview and the real Team/Admin
// action node are never rendered together, because the preview models steps and
// fields those actions deliberately do not take, and standing beside a live submit
// they would read as its inputs. Alongside either sits a read-only role diagnosis
// panel: it renders the connected-wallet role context App resolves through its
// existing bridge in DEVNET_WALLET_READONLY, opens no data-source call, watches no
// wallet, and enables no action. Neither the preview nor the role panel has
// a builder, a wallet bridge, a send/sign path, or a transaction of its own.

import { describeRedaxCampaignEnd, describeRedaxGrossCap } from '../lib/redaxCampaignFacts'
import type { ReactNode } from 'react'
import type {
  RedaxCampaignInputSummaryView,
  RedaxCampaignView,
  RedaxDirectoryRowView,
  RedaxEnvironmentView,
  RedaxInputConfigView,
  RedaxProjectView,
  RedaxRoleKind,
  RedaxWalletRoleContextView,
} from '../data/redaxViewModels'
import { isDevnetProgramMode } from '../data/redaxModePredicates'
import { MetricRow } from '../components/MetricRow'
import { ProofBoundaryNote } from '../components/ProofBoundaryNote'
import { RedaxTeamAdminWizardPreview } from '../components/RedaxTeamAdminWizardPreview'
import { StatusPill, type StatusTone } from '../components/StatusPill'
import { SurfaceCard } from '../components/SurfaceCard'
import {
  CAMPAIGN_NOT_DIRECTORY_DERIVED,
  CAMPAIGN_NOT_DIRECTORY_DERIVED_NOTE,
  PUBLIC_DIRECTORY_CURATION_SHORT,
  TEAM_ADMIN_ROLE_DIAGNOSIS,
} from '../lib/productCopy'
import {
  CampaignCard,
  capPercentLabel,
  formatCountdown,
  outputTokenDisplay,
  outputTokenHint,
  outputTokenSymbol,
  statusMeta,
} from './HomeScreen'

// Render a raw base-unit decimal string at the given token decimals with
// thousands separators, using BigInt math only (never floating point). Exported
// so the admin and observer surfaces share one amount formatter.
export function formatTokenAmount(raw: string, decimals: number): string {
  let value: bigint
  try {
    value = BigInt(raw)
  } catch {
    return raw
  }
  const negative = value < 0n
  if (negative) {
    value = -value
  }
  const base = 10n ** BigInt(decimals)
  const whole = (value / base).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  let fraction = ''
  if (decimals > 0) {
    const trimmed = (value % base).toString().padStart(decimals, '0').replace(/0+$/, '')
    if (trimmed.length > 0) {
      fraction = `.${trimmed}`
    }
  }
  return `${negative ? '-' : ''}${whole}${fraction}`
}

// One accepted-input TokenConfig of a campaign, shown the same way on the team
// and admin surfaces (legacy input, rate, decimals, per-input cap and counters).
// Each input converts on its own — not a bundled multi-token transaction.
export function InputConfigCard({ row }: { row: RedaxInputConfigView }) {
  return (
    <div className="config-card">
      <div className="config-card__head">
        <span className="config-card__title">{row.legacyMintLabel ?? '—'}</span>
        <span className="config-card__pills">
          <StatusPill
            tone={row.isPrimary ? 'accent' : 'neutral'}
            label={row.isPrimary ? 'Primary input' : 'Secondary input'}
          />
          <StatusPill
            tone={row.tokenProgram === 'classic-spl' ? 'info' : 'caution'}
            label={row.tokenProgram}
          />
        </span>
      </div>
      <span className="config-card__id">token config identifier · {row.tokenConfigId}</span>
      <MetricRow
        label="Conversion rate"
        value={`${row.rateNumeratorRaw} : ${row.rateDenominatorRaw}`}
        hint="output per accepted input, before decimal normalization"
      />
      <MetricRow
        label="Decimals"
        value={`${row.legacyDecimals} → ${row.outputDecimals}`}
        hint="legacy input decimals → output decimals"
      />
      <MetricRow
        label="Per-input cap"
        value={`${formatTokenAmount(row.maxOutputFromTokenConfigRaw, row.outputDecimals)} ${outputTokenSymbol(row.outputTokenIdentity, row.outputMintLabel)}`}
        hint="max output mintable from this input"
      />
      <MetricRow
        label="Per-input minted"
        value={`${formatTokenAmount(row.totalOutputMintedFromTokenConfigRaw, row.outputDecimals)} ${outputTokenSymbol(row.outputTokenIdentity, row.outputMintLabel)}`}
        hint="output minted from this input so far"
      />
      <MetricRow
        label="Cap utilization"
        value={capPercentLabel(row.capUtilizationBps)}
        hint="minted vs this input's cap"
      />
    </div>
  )
}

// A derived setup check over the selected campaign's current mock state. These
// are configuration checks — not a launch signal and not a claim of any kind.
interface SetupCheck {
  readonly label: string
  readonly value: string
  readonly tone: StatusTone
}

// AN ABSENT DIRECTORY ROW IS AN ABSENCE, NEVER A RESULT.
//
// Three of these six checks are computed from a curated directory row, and the selected
// campaign may legitimately have none: a campaign opened by exact address is unlisted by
// definition. The earlier arithmetic answered that absence with `?? 0` and a
// `row === null` window default, so a campaign nobody could compute anything about
// rendered as "Headroom · 0%", an open window and "0%" proof — three positive-toned
// statements manufactured out of missing data, on the one surface a team judges a
// campaign from. Each of them is now stated as not directory-derived, in a neutral tone.
//
// The three checks that come from the CAMPAIGN itself — lifecycle status, metadata setup
// and accepted inputs — are unaffected: those are read from the selected campaign and its
// own summary, and a missing directory row says nothing about them. The six labels and
// their order are identical in both arms.
function buildSetupChecks(
  campaign: RedaxCampaignView,
  row: RedaxDirectoryRowView | null,
  acceptedInputs: number,
): readonly SetupCheck[] {
  const status = statusMeta(campaign.displayStatus)
  const campaignChecks: readonly SetupCheck[] = [
    { label: 'Lifecycle status', value: status.label, tone: status.tone },
    {
      label: 'Metadata setup',
      value: campaign.metadataSetup ? 'Complete' : 'Not set yet',
      tone: campaign.metadataSetup ? 'positive' : 'caution',
    },
  ]
  const acceptedInputsCheck: SetupCheck = {
    label: 'Accepted inputs',
    value: `${acceptedInputs} / 10`,
    tone: 'info',
  }
  if (row === null) {
    // DEMO CUSTOMER FLOW (2026-10-22): the window and the output cap of an unlisted campaign
    // are read straight from its own Campaign account — App already loaded them — rather than
    // shown as "not directory-derived". Proof completeness is a directory metric and stays so.
    return [
      ...campaignChecks,
      { label: 'Campaign window', value: describeRedaxCampaignEnd(campaign.endTs, Date.now()), tone: 'neutral' },
      {
        label: 'Output cap',
        value: describeRedaxGrossCap(campaign.maxOutputSupplyRaw, campaign.totalOutputMintedRaw, 9),
        tone: 'neutral',
      },
      acceptedInputsCheck,
      { label: 'Proof completeness', value: CAMPAIGN_NOT_DIRECTORY_DERIVED, tone: 'neutral' },
    ]
  }
  const capBps = row.capUtilizationBps
  const capValue =
    capBps >= 10_000
      ? 'Cap reached'
      : `${capBps >= 9_000 ? 'Cap near' : 'Headroom'} · ${capPercentLabel(capBps)}`
  const windowOpen = row.endsInSeconds === null || row.endsInSeconds > 0
  return [
    ...campaignChecks,
    {
      label: 'Campaign window',
      value: formatCountdown(row.endsInSeconds),
      tone: windowOpen ? 'neutral' : 'caution',
    },
    { label: 'Output cap', value: capValue, tone: capBps >= 9_000 ? 'caution' : 'positive' },
    acceptedInputsCheck,
    {
      label: 'Proof completeness',
      value: row.proofCaption ?? `${row.proofCompletenessPercent}%`,
      tone: 'neutral',
    },
  ]
}

// The four stored-authority roles a Team/Admin surface can meaningfully match:
// two carried by the selected campaign, two by the protocol config.
//
// Authority presence must be decided by role kind, never by the size of the
// matched-role list. When a connected address matches nothing, the devnet
// resolver still returns one role view — a 'public' sentinel — so a length test
// would report every connected wallet as a match.
const TEAM_ADMIN_AUTHORITY_ROLES = [
  'campaign_admin',
  'output_governance',
  'protocol_fee_authority',
  'protocol_emergency_pause_authority',
] as const

type TeamAdminAuthorityRole = (typeof TEAM_ADMIN_AUTHORITY_ROLES)[number]

const TEAM_ADMIN_AUTHORITY_ROLE_LABEL: Record<TeamAdminAuthorityRole, string> = {
  campaign_admin: 'Campaign admin',
  output_governance: 'Output governance',
  protocol_fee_authority: 'Protocol fee authority',
  protocol_emergency_pause_authority: 'Protocol emergency-pause authority',
}

function isTeamAdminAuthorityRole(role: RedaxRoleKind): role is TeamAdminAuthorityRole {
  return (TEAM_ADMIN_AUTHORITY_ROLES as readonly RedaxRoleKind[]).includes(role)
}

/**
 * Read-only connected-wallet role diagnosis, rendered beside the wizard preview.
 *
 * Presentational only: it takes the role context App already holds, reads no
 * data source, subscribes to no wallet, and offers no control. Only the role
 * label and the pre-shortened public key are rendered — the role view's
 * full-address fields are never read here.
 *
 * Four arms, in order: no role context in this app mode (null — MOCK_LOCAL,
 * DEVNET_READONLY, and DEVNET_TX_ENABLED, where the bridge does not mount);
 * wallet unconnected; context unavailable; wallet connected. In the connected
 * arm a matched authority renders as a label, and matching nothing renders as
 * neutral information rather than a warning.
 */
function TeamAdminRoleDiagnosisCard({
  walletRoleContext,
}: {
  walletRoleContext: RedaxWalletRoleContextView | null | undefined
}) {
  const authorityRoles =
    walletRoleContext && walletRoleContext.status === 'connected'
      ? walletRoleContext.matchedRoles
          .map((roleView) => roleView.role)
          .filter(isTeamAdminAuthorityRole)
      : []

  return (
    <SurfaceCard
      eyebrow={TEAM_ADMIN_ROLE_DIAGNOSIS.eyebrow}
      title={TEAM_ADMIN_ROLE_DIAGNOSIS.title}
      footnote={TEAM_ADMIN_ROLE_DIAGNOSIS.footnote}
    >
      <div className="team-role-diagnosis">
        {!walletRoleContext ? (
          <p className="team-role-diagnosis__status">{TEAM_ADMIN_ROLE_DIAGNOSIS.modeInactive}</p>
        ) : walletRoleContext.status === 'unconnected' ? (
          <p className="team-role-diagnosis__status">{TEAM_ADMIN_ROLE_DIAGNOSIS.unconnected}</p>
        ) : walletRoleContext.status === 'unavailable' ? (
          <p className="team-role-diagnosis__status">{TEAM_ADMIN_ROLE_DIAGNOSIS.unavailable}</p>
        ) : (
          <>
            <p className="team-role-diagnosis__status">
              {TEAM_ADMIN_ROLE_DIAGNOSIS.connectedIntro}
            </p>

            {walletRoleContext.shortPublicKey ? (
              <MetricRow
                label={TEAM_ADMIN_ROLE_DIAGNOSIS.connectedKeyLabel}
                value={walletRoleContext.shortPublicKey}
                hint={TEAM_ADMIN_ROLE_DIAGNOSIS.connectedKeyHint}
              />
            ) : null}

            {authorityRoles.length > 0 ? (
              <>
                <p className="team-role-diagnosis__header">
                  {TEAM_ADMIN_ROLE_DIAGNOSIS.authoritiesTitle}
                </p>
                <ul className="team-role-diagnosis__roles">
                  {authorityRoles.map((role) => (
                    <li className="team-role-diagnosis__role" key={role}>
                      {TEAM_ADMIN_AUTHORITY_ROLE_LABEL[role]}
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="team-role-diagnosis__status">{TEAM_ADMIN_ROLE_DIAGNOSIS.noAuthority}</p>
            )}
          </>
        )}

        <div className="team-role-diagnosis__boundary">
          <p className="team-role-diagnosis__header">{TEAM_ADMIN_ROLE_DIAGNOSIS.boundaryTitle}</p>
          <ul>
            {TEAM_ADMIN_ROLE_DIAGNOSIS.boundaryNotes.map((boundaryNote) => (
              <li className="team-role-diagnosis__note" key={boundaryNote}>
                {boundaryNote}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </SurfaceCard>
  )
}

export interface TokenTeamTrialScreenProps {
  environment: RedaxEnvironmentView | null
  selectedCampaign: RedaxCampaignView | null
  selectedProject: RedaxProjectView | null
  selectedCampaignId: string
  directoryRows: readonly RedaxDirectoryRowView[]
  /**
   * The SELECTED campaign's own accepted-input summary — a selection-scoped fact App
   * loads for whichever campaign is selected, curated or not. It is deliberately not a
   * lookup in the curated set: an unlisted campaign has no row there and would have
   * rendered as a campaign with no accepted inputs.
   */
  inputSummary: RedaxCampaignInputSummaryView | null
  /**
   * DEVNET_WALLET_READONLY connected-wallet role context, resolved by App's
   * existing bridge and passed down unchanged. Null in every other mode, and
   * before resolution; the panel renders that as an explicit mode arm.
   */
  walletRoleContext?: RedaxWalletRoleContextView | null
  /**
   * The opaque Team/Admin action node, constructed by App in DEVNET_TX_ENABLED and
   * absent in every other mode. The screen renders it and nothing more: it is a
   * ReactNode, so no wallet facade, action method or adapter can arrive through it,
   * and the screen cannot invoke anything it contains.
   */
  teamAdminActionSlot?: ReactNode
  isLoading: boolean
  loadError: string | null
  onSelectCampaign: (campaignId: string) => void
}

export function TokenTeamTrialScreen({
  environment,
  selectedCampaign,
  selectedProject,
  selectedCampaignId,
  directoryRows,
  inputSummary,
  walletRoleContext,
  teamAdminActionSlot,
  isLoading,
  loadError,
  onSelectCampaign,
}: TokenTeamTrialScreenProps) {
  const selectedRow = directoryRows.find((row) => row.campaignId === selectedCampaignId) ?? null
  const setupChecks = selectedCampaign
    ? buildSetupChecks(selectedCampaign, selectedRow, inputSummary?.acceptedInputCount ?? 0)
    : []

  const mode = environment?.mode ?? null
  const isDevnetProgram = isDevnetProgramMode(mode)
  const isDevnetTxEnabled = mode === 'DEVNET_TX_ENABLED'
  const isMockLocal = mode === 'MOCK_LOCAL'

  return (
    <>
      <header className="screen-header">
        <p className="screen-header__eyebrow">Token / project team surface</p>
        <h2 className="screen-header__title">Devnet product trial for real teams</h2>
        <p className="screen-header__lede">
          The evaluation path for a token or project team considering REDAX for a supply transition:
          one campaign, one output mint, and up to ten accepted classic-SPL input configs.{' '}
          {isDevnetProgram ? (
            <>
              Every figure below is read from the deployed devnet program over RPC (read-only).
              {isDevnetTxEnabled
                ? ' Teams set up and manage their own campaigns in the Team workspace: one form, one review, then each Devnet step approved in their own wallet. That a control exists is never evidence that it has been run.'
                : ' This mode enables no transaction action.'}
            </>
          ) : isMockLocal ? (
            <>
              Every figure below comes from the local sample datasource — no campaign here is
              deployed.
            </>
          ) : (
            <>Data source is loading.</>
          )}
        </p>
        <div className="screen-header__pills">
          <StatusPill tone="info" label="Required near-term use case" />
          <StatusPill tone="neutral" label={environment?.dataSourceLabel ?? 'Loading data source…'} />
          <StatusPill tone="neutral" label="Setup checks, not a launch signal" />
        </div>
      </header>

      {loadError ? (
        <SurfaceCard eyebrow="Token team surface" title="Data load failed">
          <p className="note-line">{loadError}</p>
        </SurfaceCard>
      ) : isLoading ? (
        <SurfaceCard eyebrow="Token team surface" title="Loading campaign data">
          <p className="note-line">Loading the token team trial from the configured data source…</p>
        </SurfaceCard>
      ) : (
        <>
          <SurfaceCard
            eyebrow={
              environment
                ? isDevnetProgram
                  ? 'Devnet campaigns (read-only)'
                  : 'MOCK_LOCAL sample data'
                : 'Campaigns'
            }
            title="Choose a campaign to evaluate"
            footnote={environment?.boundaryLabel ?? 'Data source is loading.'}
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
            <div className="campaign-grid">
              {directoryRows.map((row) => (
                <CampaignCard
                  key={row.campaignId}
                  row={row}
                  active={row.campaignId === selectedCampaignId}
                  showEligibility={false}
                  onSelect={onSelectCampaign}
                />
              ))}
            </div>
          </SurfaceCard>

          {selectedCampaign && inputSummary ? (
            <>
              <SurfaceCard
                eyebrow="Campaign setup"
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
                    {selectedProject
                      ? selectedProject.tagline
                      : 'No on-chain project registry or profile is attached to this campaign.'}
                  </span>
                </div>
                <MetricRow label="Project profile" value={selectedProject ? selectedProject.profile : '—'} />
                <MetricRow label="Team persona" value={selectedProject?.teamPersona ?? '—'} />
                <MetricRow
                  label="Output token"
                  value={outputTokenDisplay(
                    inputSummary.outputTokenIdentity,
                    inputSummary.outputMintLabel,
                  )}
                  hint={outputTokenHint(
                    inputSummary.outputTokenIdentity,
                    inputSummary.outputMintLabel,
                  )}
                />
                <MetricRow
                  label="Accepted inputs"
                  value={`${inputSummary.acceptedInputCount} / ${inputSummary.maxTokenConfigs}`}
                  hint="accepted input configs, shown as N / 10 against the program limit"
                />
                <MetricRow
                  label="Campaign window"
                  value={selectedRow ? formatCountdown(selectedRow.endsInSeconds) : '—'}
                  hint="conversions are rejected after the window closes"
                />
                <MetricRow
                  label="Cap utilization"
                  value={selectedRow ? capPercentLabel(selectedRow.capUtilizationBps) : '—'}
                  hint="campaign output minted vs the campaign cap"
                />
                <MetricRow
                  label="Proof completeness"
                  value={
                    selectedRow
                      ? selectedRow.proofCaption ?? `${selectedRow.proofCompletenessPercent}%`
                      : '—'
                  }
                  hint="not a receipt/indexer proof metric in this build"
                />
              </SurfaceCard>

              <SurfaceCard
                eyebrow="Setup checks"
                title="Configuration state, not a launch signal"
                footnote={
                  selectedRow === null
                    ? `Setup checks reflect the current campaign state from the configured data source. They are configuration checks only — not a go/no-go and not a claim of any kind. ${CAMPAIGN_NOT_DIRECTORY_DERIVED_NOTE}`
                    : 'Setup checks reflect the current campaign state from the configured data source. They are configuration checks only — not a go/no-go and not a claim of any kind.'
                }
              >
                <div className="checklist">
                  {setupChecks.map((check) => (
                    <div className="checklist__item" key={check.label}>
                      <span className="checklist__text">
                        <span className="checklist__marker" aria-hidden="true" />
                        {check.label}
                      </span>
                      <StatusPill tone={check.tone} label={check.value} />
                    </div>
                  ))}
                </div>
              </SurfaceCard>

              <SurfaceCard
                eyebrow="Accepted input configs"
                title={`${inputSummary.acceptedInputCount} accepted input configs into one output mint`}
                footnote="Each conversion uses one selected token config — not a bundled multi-token transaction. Phase 1 is classic SPL only."
              >
                <div className="config-list">
                  {inputSummary.inputConfigs.map((row) => (
                    <InputConfigCard key={row.tokenConfigId} row={row} />
                  ))}
                </div>
              </SurfaceCard>
            </>
          ) : (
            <SurfaceCard eyebrow="Campaign setup" title="No campaign selected">
              <p className="note-line">
                Pick a campaign above to see its setup, checks, and accepted input configs.
              </p>
            </SurfaceCard>
          )}
        </>
      )}

      {/*
        Read-only role diagnosis, rendered beside the Team/Admin surface rather
        than inside it: the wizard preview stays zero-prop and free of any
        data-source or wallet coupling, and this panel carries the
        connected-wallet context instead. It renders in every mode — the null arm
        states that the mode resolves no role context, which is a fact about the
        build and not about any wallet. This panel itself adds no control, no
        action and no transaction path, and matching an authority in it enables
        nothing: the Team/Admin action is gated on the configured approved-Team
        carrier, which this panel neither reads nor supplies.
      */}
      <TeamAdminRoleDiagnosisCard walletRoleContext={walletRoleContext} />

      {/*
        The Team/Admin surface, and only ever ONE of the two.

        When App supplies the action slot — DEVNET_TX_ENABLED alone — the real
        Team/Admin action node renders and the preview does not. That is deliberate:
        the preview models thirteen setup fields across the whole staged flow, the
        real actions take far fewer, and standing side by side the ones they do not
        take would read as inputs to a live submit.

        Otherwise the supply-side wizard renders as a local draft preview only. Its
        fields are editable, but every value stays in that component's own memory:
        nothing is persisted, and THE PREVIEW reaches no wallet, no data-source read,
        no builder, no send/sign path and no transaction. It stays zero-prop and
        hosted directly here, needing no provider and no App-level slot.
      */}
      {teamAdminActionSlot ?? <RedaxTeamAdminWizardPreview />}

      <SurfaceCard
        eyebrow="What REDAX does not automate"
        title="Stated limits, up front"
        footnote="REDAX enforces published conversion rules; it does not certify the project."
      >
        <ul>
          <li>No liquidity or LP automation</li>
          <li>No team allocation automation</li>
          <li>No vesting or treasury automation</li>
          <li>No Token-2022 input in Phase 1 — that remains Phase 2+ scope</li>
        </ul>
      </SurfaceCard>

      <SurfaceCard
        eyebrow="Boundary"
        title="A devnet trial is an evaluation, not a verdict"
        footnote="A devnet-only control existing in source is never evidence that any particular transaction was submitted or landed."
      >
        <p>
          {isDevnetProgram ? (
            <>
              This surface reads devnet program state over RPC (read-only).{' '}
              {mode === 'DEVNET_WALLET_READONLY'
                ? 'Wallet connection is read-only context in the app chrome only, and this mode enables no transaction action'
                : isDevnetTxEnabled
                  ? 'Each devnet-only Team/Admin action here — creating a campaign, adding one accepted input token config to a campaign that already exists, setting that campaign’s permanent output token metadata once, activating it, and pausing, unpausing or finalizing it afterwards — runs solely when you click it in the Team workspace and approve it with a Team wallet that has signed in and been given access, and none of them is claimed to have been run'
                  : 'This mode connects no wallet and enables no transaction action'}{' '}
              — nothing else here executes. This surface is an evaluation and demonstration
              foundation — not a production claim and not a verdict on any team's campaign.
            </>
          ) : isMockLocal ? (
            <>
              This MOCK_LOCAL view uses local sample data only: it connects no wallet, performs no
              RPC, and opens no devnet connection. Every campaign, rate, cap, and counter above is
              local sample data from the RedaxDataSource, not chain data.
              This surface is an evaluation and demonstration foundation — not a production claim
              and not a verdict on any team's campaign.
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
