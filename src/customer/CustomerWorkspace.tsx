// REDAX customer service — the Team workspace: sign-in gate, My campaigns, and one setup at a time.
//
// WHAT RENDERS PRIVATE DATA. Only `CustomerSignedInWorkspace`, and only when the session gate is
// open in THIS render (signed in, and the connected wallet is exactly the session wallet). It
// is keyed by the session epoch and wallet, so a sign-out, a wallet switch or another tab's
// sign-in unmounts it — every draft in memory, every review approval, every preview object URL
// and every pending answer for the previous identity is dropped, and nothing comes back when
// the same wallet returns.
//
// ONE WALLET, MANY CAMPAIGNS. The list is the wallet's own setups, each with its own id,
// revision, plan, output mint, metadata and lifecycle. Opening one never touches another, and
// switching between them never asks the wallet to connect or sign in again. Leaving an open
// draft through the header, or through the app's own menu (`leaveGuard`), goes through the
// composer's own check, exactly like its Back. A sign-out or wallet switch is never held by it.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { RedaxTeamAdminMutationActionsProvider } from '../teamAdmin/RedaxTeamAdminMutationActions'
import type { RedaxTeamAdminFreshCampaignLifecycleTruthResult } from '../teamAdmin/RedaxTeamAdminCampaignLifecyclePanel'
import type { RedaxCampaignView, RedaxTokenConfigView } from '../data/redaxViewModels'
import { StatusPill } from '../components/StatusPill'
import { CustomerCampaignList } from './CustomerCampaignList'
import { CustomerCampaignPage } from './CustomerCampaignPage'
import { CustomerComposer, type RedaxCustomerComposerLeaveGuard } from './CustomerComposer'
import { CustomerOperatorAccess } from './CustomerOperatorAccess'
import { CustomerReview } from './CustomerReview'
import { CustomerSetupProgress } from './CustomerSetupProgress'
import { CustomerSignInPanel } from './CustomerSignInPanel'
import { useRedaxCustomerSession } from './CustomerSessionProvider'
import { useRedaxCustomerTeamWrites } from './CustomerTeamRoots'
import { shortRedaxAddress } from './customerFormat'
import { REDAX_CUSTOMER_REFUSING_MUTATION_GATE } from './customerTeamWrites'

export type RedaxCustomerCampaignTruthResult =
  | { readonly ok: true; readonly campaign: RedaxCampaignView; readonly tokenConfigs: readonly RedaxTokenConfigView[] }
  | { readonly ok: false; readonly code: string }

export interface RedaxCustomerWorkspaceProps {
  readonly explorerCluster: string | null
  readonly appBaseUrl: string | null
  readonly programId: string | null
  /** One bounded exact-address read of a campaign and its accepted inputs. */
  readonly readCampaignTruth: (campaignId: string) => Promise<RedaxCustomerCampaignTruthResult>
  /** One bounded campaign-only read, for the management panel. */
  readonly readLifecycleTruth: (campaignId: string) => Promise<RedaxTeamAdminFreshCampaignLifecycleTruthResult>
  /** Open the public holder view of a campaign (local navigation). */
  readonly onOpenHolderView?: (campaignId: string) => void
  /** Filled while a signed-in workspace is mounted: the app's menu leaves through it. */
  readonly leaveGuard?: { current: RedaxCustomerComposerLeaveGuard | null }
}

export type RedaxCustomerView =
  | { readonly kind: 'list' }
  | { readonly kind: 'compose'; readonly setupId: string }
  | { readonly kind: 'review'; readonly setupId: string }
  | { readonly kind: 'progress'; readonly setupId: string }
  | { readonly kind: 'campaign'; readonly setupId: string }
  | { readonly kind: 'operator' }

export function CustomerWorkspace(props: RedaxCustomerWorkspaceProps) {
  const session = useRedaxCustomerSession()
  const { activate } = session
  useEffect(() => {
    activate()
  }, [activate])
  if (!session.privateOpen || session.state.status !== 'signed-in') {
    return <CustomerSignInPanel />
  }
  return <CustomerSignedInWorkspace key={`${session.epoch}:${session.state.me.wallet}`} {...props} />
}

function CustomerSignedInWorkspace(props: RedaxCustomerWorkspaceProps) {
  const session = useRedaxCustomerSession()
  const coordinator = useRedaxCustomerTeamWrites()
  const me = session.state.status === 'signed-in' ? session.state.me : null
  const [view, setView] = useState<RedaxCustomerView>(() =>
    me !== null && me.operator && me.grant === null ? { kind: 'operator' } : { kind: 'list' },
  )
  // The ONE approved metadata location the mutation root may accept right now: the exact URI of
  // the setup being worked on. Nothing else, and empty everywhere else.
  const [activeMetadataUri, setActiveMetadataUri] = useState<string | null>(null)
  const allowlist = useMemo(() => (activeMetadataUri === null ? [] : [activeMetadataUri]), [activeMetadataUri])
  const open = useCallback((next: RedaxCustomerView) => {
    setActiveMetadataUri(null)
    setView(next)
  }, [])
  const composerLeave = useRef<RedaxCustomerComposerLeaveGuard | null>(null)
  const appLeave = props.leaveGuard
  useEffect(() => {
    if (appLeave === undefined) {
      return
    }
    // Only an open composer has anything to keep; otherwise the app navigates at once.
    const guard: RedaxCustomerComposerLeaveGuard = (proceed) => {
      const composer = composerLeave.current
      if (composer === null) {
        proceed()
      } else {
        composer(proceed)
      }
    }
    appLeave.current = guard
    return () => {
      if (appLeave.current === guard) {
        appLeave.current = null
      }
    }
  }, [appLeave])
  const leaveTo = (next: RedaxCustomerView): void => {
    const guard = view.kind === 'compose' ? composerLeave.current : null
    if (guard === null) {
      open(next)
    } else {
      guard(() => open(next))
    }
  }
  if (me === null) {
    return null
  }
  const teamWallet = session.teamWallet
  const accessLabel = me.grant === null ? (me.operator ? 'Operator' : 'No access') : me.grant.status === 'ACTIVE' ? 'Access active' : 'New campaigns paused'
  return (
    <div className="customer-workspace">
      <header className="customer-header">
        <div>
          <p className="customer-eyebrow">Team workspace · Solana Devnet</p>
          <p className="customer-header__wallet">
            Signed in as <strong>{shortRedaxAddress(me.wallet)}</strong>{' '}
            <StatusPill label={accessLabel} tone={me.grant?.status === 'ACTIVE' ? 'positive' : 'caution'} />
          </p>
        </div>
        <div className="customer-actions">
          {me.grant !== null ? (
            <button className="customer-btn" disabled={view.kind === 'list'} onClick={() => leaveTo({ kind: 'list' })} type="button">
              My campaigns
            </button>
          ) : null}
          {me.operator ? (
            <button className="customer-btn" disabled={view.kind === 'operator'} onClick={() => leaveTo({ kind: 'operator' })} type="button">
              Customer access
            </button>
          ) : null}
          <button className="customer-btn" onClick={() => void session.signOut()} type="button">
            Sign out
          </button>
        </div>
      </header>
      {me.grant?.status === 'STOP_NEW' ? (
        <p className="customer-notice customer-notice--caution">
          New campaigns are paused for this wallet. You can still finish a campaign you already created, manage your
          campaigns and share their holder links.
        </p>
      ) : null}
      <RedaxTeamAdminMutationActionsProvider
        approvedTeamWallet={coordinator === null ? null : teamWallet}
        metadataUriAllowlist={allowlist}
        writeGate={coordinator?.mutationGate ?? REDAX_CUSTOMER_REFUSING_MUTATION_GATE}
      >
        {view.kind === 'operator' && me.operator ? <CustomerOperatorAccess /> : null}
        {view.kind === 'list' && me.grant !== null ? (
          <CustomerCampaignList
            canCreate={me.permissions.create}
            canDeleteDrafts={me.permissions.manageExisting}
            onOpen={open}
            readCampaignTruth={props.readCampaignTruth}
          />
        ) : null}
        {view.kind === 'compose' ? (
          <CustomerComposer
            key={view.setupId}
            canEdit={me.permissions.create}
            leaveGuard={composerLeave}
            onBack={() => open({ kind: 'list' })}
            onReview={(setupId) => open({ kind: 'review', setupId })}
            setupId={view.setupId}
          />
        ) : null}
        {view.kind === 'review' ? (
          <CustomerReview
            key={view.setupId}
            canStart={me.permissions.create}
            onEdit={(setupId) => open({ kind: 'compose', setupId })}
            onStarted={(setupId) => open({ kind: 'progress', setupId })}
            setupId={view.setupId}
          />
        ) : null}
        {view.kind === 'progress' ? (
          <CustomerSetupProgress
            key={view.setupId}
            explorerCluster={props.explorerCluster}
            onDone={(setupId) => open({ kind: 'campaign', setupId })}
            onEdit={(setupId) => open({ kind: 'compose', setupId })}
            onMetadataUri={setActiveMetadataUri}
            permissions={me.permissions}
            programId={props.programId}
            readCampaignTruth={props.readCampaignTruth}
            setupId={view.setupId}
            teamWallet={teamWallet}
          />
        ) : null}
        {view.kind === 'campaign' ? (
          <CustomerCampaignPage
            key={view.setupId}
            appBaseUrl={props.appBaseUrl}
            explorerCluster={props.explorerCluster}
            onContinueSetup={(setupId) => open({ kind: 'progress', setupId })}
            onOpenHolderView={props.onOpenHolderView}
            permissions={me.permissions}
            programId={props.programId}
            readCampaignTruth={props.readCampaignTruth}
            readLifecycleTruth={props.readLifecycleTruth}
            setupId={view.setupId}
            teamWallet={teamWallet}
          />
        ) : null}
      </RedaxTeamAdminMutationActionsProvider>
    </div>
  )
}
