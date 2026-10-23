// REDAX customer service — one campaign: its live chain state, its addresses, its holder link and
// its management.
//
// EVERYTHING HERE IS PUBLIC CHAIN FACT except who is allowed to manage it. Terms, totals and
// status are read from Devnet by exact address; the holder link contains only the campaign
// address (no draft, no session, no secret). Management reuses the existing lifecycle panel —
// pause, unpause and the final, irreversible finalize with its own terminal review — admitted at
// the root by the write gate for THIS campaign only, and by the service's MANAGE_EXISTING check.
//
// Having access to the REDAX app is not a verification badge: nothing on this page says the
// campaign is reviewed, verified or endorsed, and opening it does not list it publicly.

import { useCallback, useEffect, useRef, useState } from 'react'
import { MetricRow } from '../components/MetricRow'
import { RedaxPublicAddress } from '../components/RedaxPublicAddress'
import { StatusPill } from '../components/StatusPill'
import { buildRedaxCampaignShareUrl } from '../lib/redaxPublicLinks'
import { formatRedaxRawAmount } from '../lib/redaxHumanUnits'
import {
  RedaxTeamAdminCampaignLifecyclePanel,
  type RedaxTeamAdminFreshCampaignLifecycleTruthResult,
} from '../teamAdmin/RedaxTeamAdminCampaignLifecyclePanel'
import type { RedaxTeamAdminWorkspaceCheckRequest } from '../teamAdmin/redaxTeamAdminWorkspaceRefresh'
import { useRedaxCustomerSession } from './CustomerSessionProvider'
import { useRedaxCustomerTeamWrites } from './CustomerTeamRoots'
import type { RedaxCustomerCampaignTruthResult } from './CustomerWorkspace'
import { describeRedaxCustomerEnd, describeRedaxCustomerRate } from './customerFormat'
import { deriveRedaxCustomerProgress, type RedaxCustomerChainView } from './customerProgress'
import type { RedaxCustomerManageVisit } from './customerTeamWrites'
import { useCustomerJournalReader } from './useCustomerJournalReader'
import { useCustomerLogoPreview } from './useCustomerLogoPreview'
import type { RedaxCustomerPermissions, RedaxCustomerSetupRecordV1 } from './shared/customerContract.js'
import { REDAX_CUSTOMER_OUTPUT_DECIMALS } from './shared/customerContract.js'
import { describeRedaxCustomerLimit, isRedaxCustomerPlanHashCurrent } from './shared/customerPlan.js'

export function CustomerCampaignPage({
  setupId,
  appBaseUrl,
  explorerCluster,
  permissions,
  programId,
  readCampaignTruth,
  readLifecycleTruth,
  teamWallet,
  onContinueSetup,
  onOpenHolderView,
}: {
  readonly setupId: string
  readonly appBaseUrl: string | null
  readonly explorerCluster: string | null
  readonly permissions: RedaxCustomerPermissions
  readonly programId: string | null
  readonly readCampaignTruth: (campaignId: string) => Promise<RedaxCustomerCampaignTruthResult>
  readonly readLifecycleTruth: (campaignId: string) => Promise<RedaxTeamAdminFreshCampaignLifecycleTruthResult>
  readonly teamWallet: string | null
  readonly onContinueSetup: (setupId: string) => void
  readonly onOpenHolderView?: (campaignId: string) => void
}) {
  const session = useRedaxCustomerSession()
  const api = session.api
  const coordinator = useRedaxCustomerTeamWrites()
  const [setup, setSetup] = useState<RedaxCustomerSetupRecordV1 | null>(null)
  const [hashOk, setHashOk] = useState<boolean | null>(null)
  const [chain, setChain] = useState<RedaxCustomerChainView | null>(null)
  const [chainState, setChainState] = useState<'reading' | 'ok' | 'failed'>('reading')
  const [checkedAt, setCheckedAt] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  // The management panel enables nothing until it has read its own saved-attempt slot. It reads
  // that slot only on an explicit request, so this page issues one read-only request each time
  // the panel appears and after each verified change — never a write, never a wallet prompt.
  const [workspaceCheck, setWorkspaceCheck] = useState<RedaxTeamAdminWorkspaceCheckRequest | null>(null)
  const mountedRef = useRef(true)
  const generationRef = useRef(0)
  const logoUrl = useCustomerLogoPreview(api, setup?.plan?.publication.imageSha256 ?? null)
  const readJournals = useCustomerJournalReader(programId, teamWallet)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const refreshChain = useCallback(
    async (campaign: string): Promise<void> => {
      const generation = generationRef.current + 1
      generationRef.current = generation
      setChainState('reading')
      const truth = await readCampaignTruth(campaign)
      // Only the NEWEST read may land, and only on the campaign it was asked about.
      if (!mountedRef.current || generation !== generationRef.current) {
        return
      }
      if (truth.ok && truth.campaign.id !== campaign) {
        setChainState('failed')
        return
      }
      if (truth.ok) {
        setChain({ campaign: truth.campaign, tokenConfigs: truth.tokenConfigs })
        setChainState('ok')
        setCheckedAt(Date.now())
      } else {
        setChainState('failed')
      }
    },
    [readCampaignTruth],
  )

  useEffect(() => {
    let cancelled = false
    // A different setup (or identity) invalidates any read still in flight for the previous one.
    generationRef.current += 1
    void api.getSetup(setupId).then(async (result) => {
      if (cancelled) {
        return
      }
      if (!result.ok) {
        setError(result.message)
        return
      }
      if (result.setup.id !== setupId || result.setup.owner !== teamWallet) {
        return
      }
      const loaded = result.setup
      const ok = loaded.plan !== null && loaded.planHash !== null && (await isRedaxCustomerPlanHashCurrent(loaded.plan, loaded.planHash))
      if (cancelled) {
        return
      }
      setSetup(loaded)
      setHashOk(ok)
      const address = loaded.campaign?.address ?? null
      setChain((current) => (current !== null && current.campaign.id === address ? current : null))
      if (loaded.campaign !== null) {
        void refreshChain(loaded.campaign.address)
      }
    })
    return () => {
      cancelled = true
    }
  }, [api, refreshChain, setupId, teamWallet])

  // ONE MOUNT OF THIS PAGE IS ONE MANAGEMENT VISIT. It is opened inside an effect — so React's
  // development re-mount simply opens a fresh one — and closed for good when the page goes away
  // or the session's coordinator is replaced. A pause / unpause / finalize answer that arrives
  // after its visit closed is void, even if the same campaign has been opened again since.
  const visitRef = useRef<RedaxCustomerManageVisit | null>(null)
  useEffect(() => {
    if (coordinator === null) {
      return
    }
    const visit = coordinator.openManageVisit()
    visitRef.current = visit
    return () => {
      visit.close()
      if (visitRef.current === visit) {
        visitRef.current = null
      }
    }
  }, [coordinator])

  // This page's campaign is the ONLY campaign pause / unpause / finalize may be admitted for.
  useEffect(() => {
    const visit = visitRef.current
    if (coordinator === null || visit === null || setup === null || setup.plan === null || setup.planHash === null || setup.campaign === null || hashOk !== true) {
      return
    }
    visit.setScope({ setupId: setup.id, planHash: setup.planHash, plan: setup.plan, campaign: setup.campaign })
    void coordinator.settleIfIdle(readJournals)
    // A management attempt ended (the gate is told by the root): settle from this browser's own
    // journals, which this page reads through the roots.
    const unsubscribe = coordinator.subscribe(() => {
      if (coordinator.needsSettle()) {
        void coordinator.settleIfIdle(readJournals)
      }
    })
    return () => {
      unsubscribe()
      // Same visit: an effect re-run that sets the same scope again is still this context.
      visit.setScope(null)
    }
  }, [coordinator, hashOk, readJournals, setup])

  const handleVerifiedChange = useCallback(
    (campaignId: string): void => {
      if (setup?.campaign?.address === campaignId) {
        void refreshChain(campaignId)
        void coordinator?.settleIfIdle(readJournals)
        setWorkspaceCheck((current) => ({ campaignId, sequence: (current?.sequence ?? 0) + 1 }))
      }
    },
    [coordinator, readJournals, refreshChain, setup],
  )

  // Whether the management panel is on screen (the same condition the render uses below).
  const managedCampaign =
    hashOk === true && chain !== null && setup !== null && setup.plan !== null && setup.campaign !== null
      ? (() => {
          const kind = deriveRedaxCustomerProgress(setup, chain).next.kind
          return kind === 'ADD' || kind === 'METADATA' || kind === 'ACTIVATE' || kind === 'MISMATCH' ? null : setup.campaign.address
        })()
      : null
  useEffect(() => {
    if (managedCampaign !== null) {
      // Issued after the panel has mounted, so it is a NEW request the panel answers once.
      setWorkspaceCheck((current) => ({ campaignId: managedCampaign, sequence: (current?.sequence ?? 0) + 1 }))
    }
  }, [managedCampaign])

  if (error !== null) {
    return (
      <section className="customer-card">
        <p className="customer-notice customer-notice--caution">{error}</p>
      </section>
    )
  }
  if (setup === null || setup.plan === null || setup.campaign === null) {
    return (
      <section className="customer-card">
        <p className="customer-muted">Loading the campaign…</p>
      </section>
    )
  }
  const plan = setup.plan
  const campaignAddress = setup.campaign.address
  const progress = deriveRedaxCustomerProgress(setup, chain)
  const status = chain?.campaign.programStatus ?? null
  const shareUrl = appBaseUrl === null ? null : buildRedaxCampaignShareUrl(appBaseUrl, campaignAddress)
  const setupUnfinished = progress.next.kind === 'ADD' || progress.next.kind === 'METADATA' || progress.next.kind === 'ACTIVATE'

  return (
    <div className="customer-stack">
      <section className="customer-card">
        <div className="customer-row customer-row--spread">
          <div className="customer-review__token">
            {logoUrl !== null ? <img alt="Token logo" className="customer-logo__image" height={56} src={logoUrl} width={56} /> : null}
            <div>
              <p className="customer-eyebrow">Campaign · Solana Devnet</p>
              <h3 className="customer-title">
                {plan.token.name} <span className="customer-muted">· {plan.token.symbol}</span>
              </h3>
            </div>
          </div>
          <StatusPill
            label={status === null ? (chainState === 'failed' ? 'Status unreadable' : 'Reading…') : status[0].toUpperCase() + status.slice(1)}
            tone={status === 'active' ? 'positive' : status === 'paused' ? 'caution' : 'neutral'}
          />
        </div>
        {hashOk === false ? <p className="customer-notice customer-notice--caution">The saved plan could not be verified; management is disabled on this page.</p> : null}
        {progress.next.kind === 'MISMATCH' ? <p className="customer-notice customer-notice--caution">{progress.next.reason}</p> : null}
        {setupUnfinished ? (
          <div className="customer-notice">
            The setup is not finished yet.{' '}
            <button className="customer-btn customer-btn--small" onClick={() => onContinueSetup(setupId)} type="button">
              Continue setup
            </button>
          </div>
        ) : null}
        <RedaxPublicAddress explorerCluster={explorerCluster} kind="address" label="Campaign address" value={campaignAddress} />
        <RedaxPublicAddress explorerCluster={explorerCluster} kind="address" label="New token mint" value={setup.campaign.outputMint} />
        {shareUrl !== null ? (
          <RedaxPublicAddress
            explorerCluster={explorerCluster}
            hint="Holders open this, connect their own wallet and convert. It contains only the campaign address."
            kind="link"
            label="Holder link"
            value={shareUrl}
          />
        ) : null}
        <div className="customer-actions">
          {onOpenHolderView !== undefined ? (
            <button className="customer-btn" onClick={() => onOpenHolderView(campaignAddress)} type="button">
              Open holder view
            </button>
          ) : null}
          <button className="customer-btn" disabled={chainState === 'reading'} onClick={() => void refreshChain(campaignAddress)} type="button">
            {chainState === 'reading' ? 'Reading…' : 'Refresh from Devnet'}
          </button>
          {checkedAt !== null ? <span className="customer-muted">Last read {new Date(checkedAt).toLocaleTimeString()}</span> : null}
        </div>
        {chainState === 'failed' ? (
          <p className="customer-notice customer-notice--caution">
            Devnet could not be read just now{chain !== null ? '; the figures below are from the last successful read' : ''}. Nothing
            was changed.
          </p>
        ) : null}
      </section>

      <section className="customer-card">
        <h3 className="customer-title">Terms</h3>
        {chain !== null ? (
          <MetricRow
            label="New tokens minted"
            value={`${formatRedaxRawAmount(BigInt(chain.campaign.totalOutputMintedRaw), REDAX_CUSTOMER_OUTPUT_DECIMALS)}${
              plan.totalLimit.mode === 'NONE' ? '' : ` of ${plan.totalLimit.amount}`
            }`}
            hint="gross, including the 1% fee"
          />
        ) : null}
        <MetricRow label="End" value={describeRedaxCustomerEnd(plan)} />
        <ol className="customer-review__rows">
          {plan.rows.map((row) => {
            const onChain = chain?.tokenConfigs.find((config) => config.legacyMint === row.legacyMint) ?? null
            return (
              <li key={row.rowId}>
                <code className="customer-code-inline">{row.legacyMint}</code>
                <div>{describeRedaxCustomerRate(row.oldAmount, row.newAmount)}</div>
                <div className="customer-muted">
                  Limit: {describeRedaxCustomerLimit(row.limitMode, row.limitAmount)}
                  {onChain !== null
                    ? ` · minted ${formatRedaxRawAmount(BigInt(onChain.totalOutputMintedFromTokenConfigRaw), REDAX_CUSTOMER_OUTPUT_DECIMALS)}`
                    : ' · not added yet'}
                </div>
              </li>
            )
          })}
        </ol>
      </section>

      {hashOk === true && chain !== null && !setupUnfinished && progress.next.kind !== 'MISMATCH' ? (
        <section className="customer-card">
          <h3 className="customer-title">Manage</h3>
          {!permissions.manageExisting ? <p className="customer-muted">Management is not available for this wallet.</p> : null}
          <RedaxTeamAdminCampaignLifecyclePanel
            approvedTeamWallet={permissions.manageExisting ? teamWallet : null}
            campaignDataReady={chainState === 'ok'}
            effectiveSelectedCampaignId={campaignAddress}
            onVerifiedChainChange={handleVerifiedChange}
            programId={programId}
            readFreshCampaignLifecycleTruth={readLifecycleTruth}
            selectedCampaign={chain.campaign}
            selectedCampaignId={campaignAddress}
            workspaceCheck={workspaceCheck}
          />
        </section>
      ) : null}
    </div>
  )
}
