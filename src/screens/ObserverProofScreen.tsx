// Observer / proof receipt surface — read-only verification view (PRD §11/§12;
// UX direction §14/§21). Props-driven by the App-facing RedaxDataSource provider
// (MOCK_LOCAL or a read-only devnet mode — DEVNET_READONLY /
// DEVNET_WALLET_READONLY): App passes Redax*View props — receipts, campaigns,
// projects, holders, and per-campaign input summaries — in place of the raw
// mock selectors. Each receipt's identity is the discriminated
// RedaxReceiptIdentity; in MOCK_LOCAL only the mock arm appears, and a mock
// receipt id is a local id, not a transaction signature. In the read-only
// devnet modes receipts are intentionally NOT indexed (empty list, honest
// copy) — the event/indexer slice is a later gate. THIS SCREEN has no transaction
// path and offers no action in any mode, which is a fact about this surface rather
// than about the build; the wallet connection shell lives in the app chrome, never
// on this screen.

import { useEffect, useState } from 'react'
import type {
  RedaxCampaignInputSummaryView,
  RedaxCampaignView,
  RedaxEnvironmentView,
  RedaxHolderView,
  RedaxInputConfigView,
  RedaxProjectView,
  RedaxReceiptIdentity,
  RedaxReceiptView,
} from '../data/redaxViewModels'
import { isDevnetProgramMode } from '../data/redaxModePredicates'
import { MetricRow } from '../components/MetricRow'
import { ProofBoundaryNote } from '../components/ProofBoundaryNote'
import { StatusPill } from '../components/StatusPill'
import { SurfaceCard } from '../components/SurfaceCard'
import { DOES_NOT_PROVE, PROVES } from '../lib/productCopy'
import { formatTokenAmount } from './TokenTeamTrialScreen'

const PLACEHOLDER = '—'

// Format a receipt's Unix-second timestamp as a UTC date-time. Display only; the
// timestamp comes from the data source, not verified chain history.
function formatTimestamp(unixSeconds: number): string {
  const iso = new Date(unixSeconds * 1000).toISOString()
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`
}

// Stable selection key for a receipt's discriminated identity. The mock arm keys
// on its local mock receipt id; the devnet-signature arm (future proof, never
// present in MOCK_LOCAL) keys on signature + slot + event index so it can never
// collide with or be mistaken for a mock id. Used for selection, active-row
// state, and React keys only — never rendered as a transaction reference.
function receiptIdentityKey(identity: RedaxReceiptIdentity): string {
  if (identity.kind === 'mock-receipt-id') {
    return `mock:${identity.mockReceiptId}`
  }
  return `devnet:${identity.signature}:${identity.slot ?? 'no-slot'}:${identity.eventIndex ?? 'no-event'}`
}

// Human label for a receipt identity. Only the mock arm can appear today (the
// devnet adapter indexes no receipts). The devnet-signature arm is handled
// exhaustively but never renders an explorer link and asserts no readiness
// here; it shows a clearly-negative not-indexed label only.
function receiptIdentityLabel(identity: RedaxReceiptIdentity): string {
  if (identity.kind === 'mock-receipt-id') {
    return identity.mockReceiptId
  }
  return 'Devnet signature receipts are not indexed in this build'
}

export interface ObserverProofScreenProps {
  environment: RedaxEnvironmentView | null
  receipts: readonly RedaxReceiptView[]
  campaigns: readonly RedaxCampaignView[]
  projects: readonly RedaxProjectView[]
  holderProfiles: readonly RedaxHolderView[]
  campaignInputSummaries: readonly RedaxCampaignInputSummaryView[]
  isLoading: boolean
  loadError: string | null
}

export function ObserverProofScreen({
  environment,
  receipts,
  campaigns,
  projects,
  holderProfiles,
  campaignInputSummaries,
  isLoading,
  loadError,
}: ObserverProofScreenProps) {
  const mode = environment?.mode ?? null
  const isDevnetProgram = isDevnetProgramMode(mode)
  const isMockLocal = mode === 'MOCK_LOCAL'

  // Selection is keyed by the receipt's identity key, never a loose receipt id.
  const [selectedReceiptKey, setSelectedReceiptKey] = useState<string | null>(
    receipts[0] ? receiptIdentityKey(receipts[0].identity) : null,
  )

  // Resync when async receipt props arrive, or when the selected key no longer
  // matches any loaded receipt: move selection to the first available key, or to
  // null when there are no receipts.
  useEffect(() => {
    const keys = receipts.map((item) => receiptIdentityKey(item.identity))
    if (selectedReceiptKey !== null && keys.includes(selectedReceiptKey)) {
      return
    }
    setSelectedReceiptKey(keys[0] ?? null)
  }, [receipts, selectedReceiptKey])

  const selectedReceipt: RedaxReceiptView | null =
    receipts.find((item) => receiptIdentityKey(item.identity) === selectedReceiptKey) ??
    receipts[0] ??
    null

  const campaign = selectedReceipt
    ? campaigns.find((entry) => entry.id === selectedReceipt.campaignId) ?? null
    : null
  const project = campaign
    ? projects.find((entry) => entry.id === campaign.projectId) ?? null
    : null
  const configRow: RedaxInputConfigView | undefined = selectedReceipt
    ? campaignInputSummaries
        .find((summary) => summary.campaignId === selectedReceipt.campaignId)
        ?.inputConfigs.find((row) => row.tokenConfigId === selectedReceipt.tokenConfigId)
    : undefined
  const holder = selectedReceipt
    ? holderProfiles.find((entry) => entry.id === selectedReceipt.holderId) ?? null
    : null

  const legacyDecimals = configRow?.legacyDecimals ?? 0
  const outputDecimals = configRow?.outputDecimals ?? 0
  const legacyLabel = configRow?.legacyMintLabel ?? PLACEHOLDER
  const outputLabel = configRow?.outputMintLabel ?? PLACEHOLDER

  return (
    <>
      <header className="screen-header">
        <p className="screen-header__eyebrow">Observer surface</p>
        <h2 className="screen-header__title">Proof and receipts</h2>
        <p className="screen-header__lede">
          The read-only surface where anyone — community member, investor, or third party — can check
          what a conversion did, without trusting this interface or the campaign operator.{' '}
          {isDevnetProgram ? (
            <>
              Receipts/event indexing is not included in this build — receipt history arrives with a
              later event/indexer gate.
            </>
          ) : isMockLocal ? (
            <>Every receipt below is local sample data from the RedaxDataSource.</>
          ) : (
            <>Data source is loading.</>
          )}
        </p>
        <div className="screen-header__pills">
          <StatusPill tone="neutral" label="Read-only by design" />
          <StatusPill tone="neutral" label={environment?.dataSourceLabel ?? 'Loading data source…'} />
          <StatusPill
            tone="neutral"
            label={
              isDevnetProgram
                ? 'Receipts not indexed in this build'
                : isMockLocal
                  ? 'Local sample data, not chain data'
                  : 'Data source loading'
            }
          />
        </div>
      </header>

      {loadError ? (
        <SurfaceCard eyebrow="Observer surface" title="Data load failed">
          <p className="note-line">{loadError}</p>
        </SurfaceCard>
      ) : isLoading ? (
        <SurfaceCard eyebrow="Observer surface" title="Loading receipt data">
          <p className="note-line">Loading observer receipts from the configured data source…</p>
        </SurfaceCard>
      ) : (
        <>
          <SurfaceCard
            eyebrow={
              environment
                ? isDevnetProgram
                  ? 'Devnet observer (read-only)'
                  : 'MOCK_LOCAL sample data'
                : 'Receipts'
            }
            title="Converted receipts"
            footnote={
              isDevnetProgram
                ? 'Converted-event receipt history requires an event/indexer slice that is not included in this build.'
                : 'Each row maps to a Converted event in the local sample data. Selecting a receipt shows its full fact grid below.'
            }
          >
            {receipts.length > 0 ? (
              <div className="receipt-list">
                {receipts.map((item) => {
                  const key = receiptIdentityKey(item.identity)
                  const itemCampaign = campaigns.find((entry) => entry.id === item.campaignId) ?? null
                  const active = key === selectedReceiptKey
                  return (
                    <div
                      key={key}
                      className={active ? 'receipt-item receipt-item--active' : 'receipt-item'}
                      role="button"
                      tabIndex={0}
                      aria-pressed={active}
                      onClick={() => setSelectedReceiptKey(key)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault()
                          setSelectedReceiptKey(key)
                        }
                      }}
                    >
                      <div className="receipt-item__head">
                        <span className="receipt-item__title">
                          {itemCampaign ? itemCampaign.name : item.campaignId}
                        </span>
                        <StatusPill tone="info" label="Converted" />
                      </div>
                      <span className="receipt-item__sub">token config · {item.tokenConfigId}</span>
                      <span className="receipt-item__sub receipt-item__id">
                        {receiptIdentityLabel(item.identity)}
                      </span>
                    </div>
                  )
                })}
              </div>
            ) : (
              <p className="note-line">
                {isDevnetProgram
                  ? 'Receipts are not indexed in this build — Converted-event history requires an event/indexer slice (a later gate). An empty list here is not evidence that no conversions occurred.'
                  : 'No receipts in the local sample data.'}
              </p>
            )}
          </SurfaceCard>

          {selectedReceipt ? (
            <SurfaceCard
              eyebrow="Converted event"
              title={campaign ? campaign.name : 'Converted receipt'}
              footnote={selectedReceipt.note ?? undefined}
            >
              <MetricRow label="Holder" value={holder ? holder.label : selectedReceipt.holderId} />
              <MetricRow
                label="Campaign"
                value={campaign ? campaign.name : selectedReceipt.campaignId}
                hint={project?.tagline}
              />
              <MetricRow
                label="Token config"
                value={`${legacyLabel} · ${selectedReceipt.tokenConfigId}`}
                hint="one selected token config per conversion"
              />
              <MetricRow label="Input mint (burned)" value={legacyLabel} hint={selectedReceipt.inputMint} />
              <MetricRow label="Output mint (minted)" value={outputLabel} hint={selectedReceipt.outputMint} />
              <MetricRow
                label="Amount in"
                value={`${formatTokenAmount(selectedReceipt.amountInRaw, legacyDecimals)} ${legacyLabel}`}
                hint="old token burned"
              />
              <MetricRow
                label="Gross output"
                value={`${formatTokenAmount(selectedReceipt.grossOutRaw, outputDecimals)} ${outputLabel}`}
                hint="before the protocol fee"
              />
              <MetricRow
                label="Protocol fee"
                value={`${formatTokenAmount(selectedReceipt.feeOutRaw, outputDecimals)} ${outputLabel}`}
                hint="floor fee, deducted from gross output"
              />
              <MetricRow
                label="Net output to holder"
                value={`${formatTokenAmount(selectedReceipt.userOutRaw, outputDecimals)} ${outputLabel}`}
                emphasis
              />
              <MetricRow
                label="Campaign output minted after"
                value={`${formatTokenAmount(selectedReceipt.campaignTotalOutputMintedAfterRaw, outputDecimals)} ${outputLabel}`}
                hint="campaign-level total after this conversion"
              />
              <MetricRow
                label="Token config minted after"
                value={`${formatTokenAmount(selectedReceipt.tokenConfigTotalOutputMintedAfterRaw, outputDecimals)} ${outputLabel}`}
                hint="per-config total after this conversion"
              />
              <MetricRow
                label="Timestamp"
                value={formatTimestamp(selectedReceipt.timestamp)}
                hint="from the data source"
              />
            </SurfaceCard>
          ) : null}

          <SurfaceCard
            eyebrow="Receipt identity"
            title={
              isDevnetProgram
                ? 'Receipts are not indexed in this build'
                : 'Local ids, not transaction signatures'
            }
            footnote={
              isDevnetProgram
                ? 'A later, separately gated devnet slice adds Converted-event receipts with real transaction signatures and explorer references.'
                : 'A later, separately gated devnet stage would attach an on-chain transaction reference; this build does not.'
            }
          >
            {isDevnetProgram ? (
              <p>
                This observer surface indexes no receipts and renders no transaction signatures.
                Devnet signature receipts arrive with the event/indexer slice — an empty list here
                is not evidence that no conversions occurred.
              </p>
            ) : (
              <>
                <MetricRow
                  label="Mock receipt id"
                  value={
                    selectedReceipt ? receiptIdentityLabel(selectedReceipt.identity) : PLACEHOLDER
                  }
                />
                <p>
                  Mock receipt ids are local ids, not transaction signatures. These local fixtures
                  carry no on-chain transaction reference and no external link. No wallet, no RPC,
                  and no devnet connection exist in MOCK_LOCAL.
                </p>
              </>
            )}
          </SurfaceCard>
        </>
      )}

      <div className="grid grid--two">
        <SurfaceCard eyebrow="Proof boundary" title="What a receipt proves">
          <ul>
            {PROVES.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </SurfaceCard>
        <SurfaceCard
          eyebrow="Proof boundary"
          title="What a receipt does not prove"
          footnote="A receipt is mechanical accounting. It is never evidence of project legitimacy."
        >
          <ul>
            {DOES_NOT_PROVE.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </SurfaceCard>
      </div>

      <ProofBoundaryNote />
    </>
  )
}
