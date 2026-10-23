// REDAX customer service — the guided setup: Create → each old token → token details → open.
//
// ONE STEP AT A TIME, ONE CLICK PER WALLET APPROVAL. The page shows only the next step, a short
// true summary of it, and one explicit button. Each click runs exactly one existing transaction
// root call (`submitS1` or `submitMutation`) and so asks the wallet at most once. Nothing here
// chains prompts, retries, re-sends or signs on its own; a pending step offers only "Check
// status", which never signs and never sends.
//
// THE NEXT STEP COMES FROM THE CHAIN. After every result — and on every open — the campaign is
// re-read by its exact address and the frozen plan decides what is still missing
// (`deriveRedaxCustomerProgress`). A remembered click is never progress, an API answer is never
// finality, and a chain state the plan does not describe stops everything.
//
// THE REQUESTS COME FROM THE PLAN, VERIFIED. The plan's hash is re-checked here; each request is
// derived from the plan alone, armed in the coordinator, and admitted by the write gate only if
// the root is about to sign exactly that request (see `customerTeamWrites.ts`).
//
// A STEP THAT OUTLIVES ITS PAGE ASKS NOTHING. After each await before the wallet step (the plan
// re-check, the old token's decimals read) the step continues only if this page is still mounted
// under the same coordinator; leaving the page disarms the coordinator synchronously, so an
// admission still in flight comes back refused and the root records the attempt as not sent.
//
// WHAT ANOTHER BROWSER STARTED STAYS THERE. If this wallet's unresolved Team write belongs to
// another browser, this page reads and shares but starts no chain write, and says where to go.

import { useCallback, useEffect, useRef, useState } from 'react'
import { isRedaxTeamAdminVerifiedResolutionCode } from '../teamAdmin/redaxTeamAdminWorkspaceRefresh'
import {
  useRedaxTeamAdminActions,
  type RedaxTeamAdminS1ReconcileResult,
  type RedaxTeamAdminS1SubmitResult,
} from '../teamAdmin/RedaxTeamAdminActions'
import {
  useRedaxTeamAdminMutationActions,
  type RedaxTeamAdminMutationRequest,
  type RedaxTeamAdminMutationSubmitResult,
} from '../teamAdmin/RedaxTeamAdminMutationActions'
import { describeRedaxTeamAdminReconcileCode, describeRedaxTeamAdminSubmitCode } from '../teamAdmin/RedaxTeamAdminCampaignCreatePanel'
import {
  describeRedaxTeamAdminMutationReconcileCode,
  describeRedaxTeamAdminMutationSubmitCode,
} from '../teamAdmin/RedaxTeamAdminCampaignSetupPanel'
import { RedaxPublicAddress } from '../components/RedaxPublicAddress'
import { redaxCustomerInputChecked } from './customerDomEvents'
import { useRedaxCustomerSession } from './CustomerSessionProvider'
import { useRedaxCustomerTeamWrites } from './CustomerTeamRoots'
import type { RedaxCustomerCampaignTruthResult } from './CustomerWorkspace'
import { describeRedaxCustomerEnd, describeRedaxCustomerRate, describeRedaxCustomerTime } from './customerFormat'
import { deriveRedaxCustomerProgress, type RedaxCustomerChainView, type RedaxCustomerNext } from './customerProgress'
import {
  redaxCustomerAddRequestFromPlan,
  redaxCustomerMetadataRequestFromPlan,
  redaxCustomerS1RequestFromPlan,
  type RedaxCustomerWriteScope,
} from './customerTeamWrites'
import { useCustomerJournalReader } from './useCustomerJournalReader'
import { useCustomerLogoPreview } from './useCustomerLogoPreview'
import type { RedaxCustomerClaimView, RedaxCustomerPermissions, RedaxCustomerSetupRecordV1 } from './shared/customerContract.js'
import { describeRedaxCustomerLimit, isRedaxCustomerPlanHashCurrent } from './shared/customerPlan.js'

type JournalState = 'IDLE' | 'ACTIVE' | 'UNKNOWN'

interface Outcome {
  readonly tone: 'positive' | 'caution' | 'info'
  readonly title: string
  readonly technical?: string
}

// AFTER THE POINT OF NO RETURN, ANYTHING NOT PROVEN IS STILL PENDING. A sent attempt is shown
// as done only on the root's verified matching state, as failed only on its finalized landed
// failure, and as support-only on its explicit support code; every other post-send answer —
// whatever the root's internal reason — is "sent, waiting", offering only Check status.

function notSentOutcome(code: string, technical: string, gateMessage: string | null): Outcome {
  switch (code) {
    case 'WALLET_SIGN_ONLY_REFUSED':
      return { tone: 'caution', title: 'You declined in your wallet. Nothing was sent — you can try again.', technical }
    case 'PAYER_SOL_INSUFFICIENT':
      return { tone: 'caution', title: 'This wallet does not have enough Devnet SOL for this step. Nothing was sent.', technical }
    case 'ATTEMPT_BLOCKED':
      return { tone: 'caution', title: 'An earlier step is still waiting for its result. Use Check status first.', technical }
    case 'WRITE_GATE_REFUSED':
      return { tone: 'caution', title: gateMessage ?? 'The REDAX service did not admit this step. Nothing was sent.', technical }
    case 'WALLET_NOT_CONNECTED':
      return { tone: 'caution', title: 'Your wallet disconnected. Nothing was sent.', technical }
    default:
      return { tone: 'caution', title: 'This step stopped before anything was sent. Check the details and try again.', technical }
  }
}

export function CustomerSetupProgress({
  setupId,
  explorerCluster,
  permissions,
  programId,
  readCampaignTruth,
  teamWallet,
  onDone,
  onEdit,
  onMetadataUri,
}: {
  readonly setupId: string
  readonly explorerCluster: string | null
  readonly permissions: RedaxCustomerPermissions
  readonly programId: string | null
  readonly readCampaignTruth: (campaignId: string) => Promise<RedaxCustomerCampaignTruthResult>
  readonly teamWallet: string | null
  readonly onDone: (setupId: string) => void
  readonly onEdit: (setupId: string) => void
  readonly onMetadataUri: (uri: string | null) => void
}) {
  const session = useRedaxCustomerSession()
  const api = session.api
  const s1 = useRedaxTeamAdminActions()
  const mutation = useRedaxTeamAdminMutationActions()
  const coordinator = useRedaxCustomerTeamWrites()

  const [setup, setSetup] = useState<RedaxCustomerSetupRecordV1 | null>(null)
  const [hashOk, setHashOk] = useState<boolean | null>(null)
  const [chain, setChain] = useState<RedaxCustomerChainView | null>(null)
  const [chainFailed, setChainFailed] = useState(false)
  const [claim, setClaim] = useState<RedaxCustomerClaimView | null>(null)
  const [journals, setJournals] = useState<{ readonly s1: JournalState; readonly mutation: JournalState; readonly mutationCampaign: string | null }>({
    s1: 'UNKNOWN',
    mutation: 'UNKNOWN',
    mutationCampaign: null,
  })
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<'submit' | 'check' | null>(null)
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [activationAck, setActivationAck] = useState<string | null>(null)
  const mountedRef = useRef(true)
  const inFlightRef = useRef(false)
  const loadGenerationRef = useRef(0)
  const coordinatorRef = useRef(coordinator)
  coordinatorRef.current = coordinator
  const disarmRef = useRef<(() => void) | null>(null)
  const logoUrl = useCustomerLogoPreview(api, setup?.plan?.publication.imageSha256 ?? null)
  const readJournals = useCustomerJournalReader(programId, teamWallet)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      // Leaving the page voids an armed step at once — including one whose admission is in flight.
      disarmRef.current?.()
      disarmRef.current = null
    }
  }, [])

  /** Still this page, under the same coordinator (session), as when the step began? */
  const stillHere = (started: typeof coordinator): boolean => mountedRef.current && started !== null && coordinatorRef.current === started

  const load = useCallback(async (): Promise<void> => {
    const generation = loadGenerationRef.current + 1
    loadGenerationRef.current = generation
    const stale = (): boolean => !mountedRef.current || generation !== loadGenerationRef.current
    setLoading(true)
    const result = await api.getSetup(setupId)
    if (stale()) {
      return
    }
    if (!result.ok) {
      setError(result.message)
      setLoading(false)
      return
    }
    const loaded = result.setup
    if (loaded.id !== setupId || loaded.owner !== teamWallet) {
      setLoading(false)
      return
    }
    const ok = loaded.plan !== null && loaded.planHash !== null && (await isRedaxCustomerPlanHashCurrent(loaded.plan, loaded.planHash))
    if (stale()) {
      return
    }
    setSetup(loaded)
    setHashOk(ok)
    onMetadataUri(ok && loaded.plan !== null ? loaded.plan.publication.jsonUri : null)
    if (loaded.campaign !== null) {
      const truth = await readCampaignTruth(loaded.campaign.address)
      if (stale()) {
        return
      }
      if (truth.ok) {
        setChain({ campaign: truth.campaign, tokenConfigs: truth.tokenConfigs })
        setChainFailed(false)
      } else {
        setChain(null)
        setChainFailed(true)
      }
    } else {
      setChain(null)
      setChainFailed(false)
    }
    const settled = coordinator === null ? null : await coordinator.settleIfIdle(readJournals)
    if (stale()) {
      return
    }
    setClaim(settled)
    if (programId !== null && teamWallet !== null) {
      const [record, status] = await Promise.all([
        s1.readRecoveryRecord({ cluster: 'devnet', program: programId, teamWallet }),
        mutation.readMutationStatus(),
      ])
      if (stale()) {
        return
      }
      setJournals({
        s1: !record.ok ? 'UNKNOWN' : record.kind === 'ACTIVE' ? 'ACTIVE' : 'IDLE',
        mutation: !status.ok ? 'UNKNOWN' : status.presence === 'ACTIVE' ? 'ACTIVE' : 'IDLE',
        mutationCampaign: status.ok && status.presence === 'ACTIVE' ? status.campaign : null,
      })
    }
    setLoading(false)
  }, [api, coordinator, mutation, onMetadataUri, programId, readCampaignTruth, readJournals, s1, setupId, teamWallet])

  useEffect(() => {
    void load()
  }, [load])

  const plan = setup?.plan ?? null
  const progress = setup === null ? null : deriveRedaxCustomerProgress(setup, chain)
  const next: RedaxCustomerNext | null = progress?.next ?? null

  useEffect(() => {
    if (next?.kind === 'DONE') {
      onDone(setupId)
    }
  }, [next?.kind, onDone, setupId])

  const scope = (): RedaxCustomerWriteScope | null =>
    setup === null || setup.plan === null || setup.planHash === null
      ? null
      : { setupId: setup.id, planHash: setup.planHash, plan: setup.plan, campaign: setup.campaign }

  /** Re-verify the plan right before any write; a plan that no longer hashes stops here. */
  async function planStillCurrent(): Promise<boolean> {
    if (setup === null || setup.plan === null || setup.planHash === null) {
      return false
    }
    const ok = await isRedaxCustomerPlanHashCurrent(setup.plan, setup.planHash)
    if (!ok) {
      setHashOk(false)
    }
    return ok
  }

  async function bindCampaign(campaign: string): Promise<boolean> {
    const bound = await api.bind(setupId, campaign)
    if (!bound.ok) {
      setOutcome({ tone: 'caution', title: `The campaign was created, but it could not be recorded yet: ${bound.message} Use Check status again shortly.` })
      return false
    }
    return true
  }

  async function runCreate(): Promise<void> {
    const writeScope = scope()
    if (inFlightRef.current || writeScope === null || coordinator === null) {
      return
    }
    inFlightRef.current = true
    setBusy('submit')
    setOutcome(null)
    try {
      if (!(await planStillCurrent()) || !stillHere(coordinator)) {
        return
      }
      if (writeScope.plan.end.mode === 'DATE' && BigInt(Math.floor(Date.now() / 1000)) >= BigInt(writeScope.plan.end.unixSeconds)) {
        setOutcome({ tone: 'caution', title: 'The end time of this plan has already passed, so the campaign cannot be created. Nothing was sent.' })
        return
      }
      const request = redaxCustomerS1RequestFromPlan(writeScope.plan)
      const disarm = coordinator.arm(writeScope, { kind: 'S1', request })
      disarmRef.current = disarm
      let result: RedaxTeamAdminS1SubmitResult
      try {
        result = await s1.submitS1(request)
      } finally {
        disarm()
        if (disarmRef.current === disarm) {
          disarmRef.current = null
        }
      }
      const technical = describeRedaxTeamAdminSubmitCode(result.code)
      if (result.ok && result.code === 'SUBMITTED_MATCHING_COMPLETE_STATE' && result.campaign !== null) {
        if (await bindCampaign(result.campaign)) {
          setOutcome({ tone: 'positive', title: 'Campaign created. Next: add the old tokens.', technical })
        }
      } else if (result.rawBroadcastCount === 1 && result.code === 'SUBMITTED_TERMINAL_FAILURE') {
        setOutcome({ tone: 'caution', title: 'The transaction reached Devnet and failed, so nothing was created. You can try again.', technical })
      } else if (result.rawBroadcastCount === 1 && result.code === 'SUBMITTED_OUTCOME_UNRESOLVED_SUPPORT') {
        setOutcome({ tone: 'caution', title: 'The result could not be determined automatically. Nothing will be sent again. Use Check status later or contact REDAX with your wallet address.', technical })
      } else if (result.rawBroadcastCount === 1) {
        setOutcome({ tone: 'info', title: 'Sent. Waiting for Devnet to confirm — use Check status in a few seconds. Do not approve it again.', technical })
      } else {
        setOutcome(notSentOutcome(result.code, technical, coordinator.takeRefusal()?.message ?? null))
      }
    } finally {
      inFlightRef.current = false
      if (mountedRef.current) {
        setBusy(null)
        await load()
      }
    }
  }

  async function checkCreate(): Promise<void> {
    if (inFlightRef.current || setup === null) {
      return
    }
    inFlightRef.current = true
    setBusy('check')
    setOutcome(null)
    try {
      let reconciled: RedaxTeamAdminS1ReconcileResult | null = null
      if (journals.s1 === 'ACTIVE') {
        reconciled = await s1.reconcileS1()
      }
      if (reconciled !== null && reconciled.openableCampaign !== null) {
        if (await bindCampaign(reconciled.openableCampaign)) {
          setOutcome({ tone: 'positive', title: 'Campaign created. Next: add the old tokens.' })
        }
        return
      }
      // Another device may have finished the Create: try the campaigns this setup's own Create
      // requests named. The server binds one only if it exists on chain with this wallet as admin.
      for (const attempt of [...setup.attempts].reverse()) {
        const bound = await api.bind(setupId, attempt.campaign)
        if (bound.ok) {
          setOutcome({ tone: 'positive', title: 'Campaign found on Devnet and recorded. Next: add the old tokens.' })
          return
        }
      }
      setOutcome(
        reconciled !== null
          ? { tone: 'info', title: describeRedaxTeamAdminReconcileCode(reconciled.code) }
          : { tone: 'info', title: 'No created campaign was found yet. If you approved the Create step, check again in a few seconds.' },
      )
    } finally {
      inFlightRef.current = false
      if (mountedRef.current) {
        setBusy(null)
        await load()
      }
    }
  }

  async function runMutation(request: RedaxTeamAdminMutationRequest, success: string): Promise<void> {
    const writeScope = scope()
    if (inFlightRef.current || writeScope === null || coordinator === null) {
      return
    }
    inFlightRef.current = true
    setBusy('submit')
    setOutcome(null)
    try {
      if (!(await planStillCurrent()) || !stillHere(coordinator)) {
        return
      }
      if (request.operation === 'ADD_TOKEN_CONFIG') {
        // The old token's decimals must still be what the plan recorded.
        const facts = await mutation.readClassicMintFacts(request.legacyMint)
        if (!stillHere(coordinator)) {
          return
        }
        if (!facts.ok || facts.decimals !== request.expectedLegacyDecimals) {
          setOutcome({ tone: 'caution', title: 'This old token could not be confirmed on Devnet with the decimals in your plan. Nothing was sent.' })
          return
        }
      }
      const disarm = coordinator.arm(writeScope, { kind: 'MUTATION', request })
      disarmRef.current = disarm
      let result: RedaxTeamAdminMutationSubmitResult
      try {
        result = await mutation.submitMutation(request)
      } finally {
        disarm()
        if (disarmRef.current === disarm) {
          disarmRef.current = null
        }
      }
      const technical = describeRedaxTeamAdminMutationSubmitCode(result.code)
      if (isRedaxTeamAdminVerifiedResolutionCode(result.code)) {
        setOutcome({ tone: 'positive', title: success, technical })
      } else if (result.rawBroadcastCount === 1 && result.code === 'FINALIZED_LANDED_FAILURE_RESOLVED') {
        setOutcome({ tone: 'caution', title: 'The transaction reached Devnet and failed, so nothing changed. You can try again.', technical })
      } else if (result.rawBroadcastCount === 1 && result.code === 'OUTCOME_UNRESOLVED_SUPPORT') {
        setOutcome({ tone: 'caution', title: 'The result could not be determined automatically. Nothing will be sent again. Use Check status later or contact REDAX.', technical })
      } else if (result.rawBroadcastCount === 1) {
        setOutcome({ tone: 'info', title: 'Sent. Waiting for Devnet to confirm — use Check status in a few seconds. Do not approve it again.', technical })
      } else {
        setOutcome(notSentOutcome(result.code, technical, coordinator.takeRefusal()?.message ?? null))
      }
    } finally {
      inFlightRef.current = false
      if (mountedRef.current) {
        setBusy(null)
        await load()
      }
    }
  }

  async function checkMutation(): Promise<void> {
    if (inFlightRef.current) {
      return
    }
    inFlightRef.current = true
    setBusy('check')
    setOutcome(null)
    try {
      const reconciled = await mutation.reconcileMutation()
      setOutcome({ tone: isRedaxTeamAdminVerifiedResolutionCode(reconciled.code) ? 'positive' : 'info', title: describeRedaxTeamAdminMutationReconcileCode(reconciled.code) })
    } finally {
      inFlightRef.current = false
      if (mountedRef.current) {
        setBusy(null)
        await load()
      }
    }
  }

  const activationKey =
    chain === null ? null : `${chain.campaign.id}:${chain.campaign.programStatus}:${chain.campaign.tokenConfigCount}:${chain.campaign.metadataSetup}:${String(chain.campaign.endTs)}`

  async function runActivate(): Promise<void> {
    if (setup === null || setup.campaign === null || activationAck === null || activationAck !== activationKey) {
      return
    }
    // A fresh exact read immediately before the wallet is asked: the acknowledged context must
    // still be the chain's context, and the plan must still say "open" is the next step.
    const startedUnder = coordinator
    const fresh = await readCampaignTruth(setup.campaign.address)
    if (!stillHere(startedUnder)) {
      return
    }
    if (!fresh.ok) {
      setOutcome({ tone: 'caution', title: 'Devnet could not be read just now. Nothing was sent; try again.' })
      return
    }
    const freshKey = `${fresh.campaign.id}:${fresh.campaign.programStatus}:${fresh.campaign.tokenConfigCount}:${fresh.campaign.metadataSetup}:${String(fresh.campaign.endTs)}`
    const freshNext = deriveRedaxCustomerProgress(setup, { campaign: fresh.campaign, tokenConfigs: fresh.tokenConfigs }).next
    if (freshKey !== activationAck || freshNext.kind !== 'ACTIVATE') {
      setActivationAck(null)
      setOutcome({ tone: 'caution', title: 'The campaign changed since you confirmed. Review the summary and confirm again. Nothing was sent.' })
      await load()
      return
    }
    if (fresh.campaign.endTs !== null && Date.now() / 1000 >= fresh.campaign.endTs) {
      setOutcome({ tone: 'caution', title: 'The end time has passed, so conversions can no longer be opened. Nothing was sent.' })
      return
    }
    await runMutation({ operation: 'ACTIVATE_CAMPAIGN', campaign: setup.campaign.address }, 'Conversions are open. Your campaign is active.')
    setActivationAck(null)
  }

  // --- render -----------------------------------------------------------------------------------

  if (error !== null) {
    return (
      <section className="customer-card">
        <p className="customer-notice customer-notice--caution">{error}</p>
      </section>
    )
  }
  if (setup === null || plan === null || progress === null || hashOk === null) {
    return (
      <section className="customer-card">
        <p className="customer-muted">Loading the setup…</p>
      </section>
    )
  }
  if (!hashOk) {
    return (
      <section className="customer-card">
        <p className="customer-notice customer-notice--caution">
          This plan could not be verified against what you reviewed. Nothing will be sent from this page.
        </p>
      </section>
    )
  }

  const otherBrowser = claim?.state === 'OTHER'
  const mutationElsewhere = journals.mutation === 'ACTIVE' && journals.mutationCampaign !== setup.campaign?.address
  const blockedReason: string | null =
    coordinator === null
      ? 'Chain steps are not available for this session. Reload the page and sign in again.'
      : otherBrowser
          ? `A chain step for this wallet is still unresolved in another browser${claim?.heldAt ? ` (started ${describeRedaxCustomerTime(claim.heldAt)})` : ''}. Open REDAX in that browser and use Check status there. You can still read and share here.`
          : mutationElsewhere
            ? 'A step for another of your campaigns is still waiting for its result in this browser. Open that campaign and use Check status first.'
            : null
  const stepNumber = progress.doneApprovals + 1
  const totalSteps = progress.totalApprovals
  const campaignAddress = setup.campaign?.address ?? null

  function renderStep() {
    if (next === null || plan === null || setup === null) {
      return null
    }
    if (next.kind === 'MISMATCH') {
      return <p className="customer-notice customer-notice--caution">{next.reason} The setup stops here; nothing will be sent. Contact REDAX if you need help.</p>
    }
    if (next.kind === 'NOT_READY') {
      return (
        <>
          <p className="customer-notice customer-notice--caution">{next.reason}</p>
          {chainFailed ? (
            <button className="customer-btn" disabled={loading} onClick={() => void load()} type="button">
              Read again
            </button>
          ) : null}
        </>
      )
    }
    if (next.kind === 'DONE') {
      return <p>Your campaign is {next.status}.</p>
    }
    const pendingCreate = next.kind === 'CREATE' && journals.s1 === 'ACTIVE'
    const pendingMutation = next.kind !== 'CREATE' && journals.mutation === 'ACTIVE' && !mutationElsewhere
    const writeAllowed = blockedReason === null && busy === null && !loading && (next.kind === 'CREATE' ? permissions.create : permissions.completeStartedSetup)
    if (next.kind === 'CREATE') {
      return (
        <>
          <h4 className="customer-step__title">Step {stepNumber} of {totalSteps} · Create the campaign</h4>
          <p>
            Creates your campaign and its new token mint ({plan.token.symbol}) on Solana Devnet, with {plan.rows.length} old{' '}
            {plan.rows.length === 1 ? 'token' : 'tokens'} planned, total limit{' '}
            {plan.totalLimit.mode === 'NONE' ? 'none' : `${plan.totalLimit.amount} new tokens`}, end: {describeRedaxCustomerEnd(plan)}.
          </p>
          {setup.state === 'PUBLISHED' && setup.attempts.length > 0 && !pendingCreate ? (
            <p className="customer-muted">If you already approved this step somewhere, use Check status before trying again.</p>
          ) : null}
          {!permissions.create ? <p className="customer-notice customer-notice--caution">New campaigns are paused for this wallet, so this campaign cannot be created.</p> : null}
          <div className="customer-actions">
            {pendingCreate ? null : (
              <button className="customer-btn customer-btn--primary" disabled={!writeAllowed} onClick={() => void runCreate()} type="button">
                {busy === 'submit' ? 'Waiting for your wallet…' : 'Create campaign in wallet'}
              </button>
            )}
            <button className="customer-btn" disabled={busy !== null} onClick={() => void checkCreate()} type="button">
              {busy === 'check' ? 'Checking…' : 'Check status'}
            </button>
          </div>
        </>
      )
    }
    if (setup.campaign === null) {
      return null
    }
    const campaign = setup.campaign
    if (pendingMutation) {
      return (
        <>
          <h4 className="customer-step__title">Step {stepNumber} of {totalSteps} · Waiting for the result</h4>
          <p>A step you approved is still waiting for Devnet. Check its status; nothing is sent again.</p>
          <div className="customer-actions">
            <button className="customer-btn customer-btn--primary" disabled={busy !== null} onClick={() => void checkMutation()} type="button">
              {busy === 'check' ? 'Checking…' : 'Check status'}
            </button>
          </div>
        </>
      )
    }
    if (next.kind === 'ADD') {
      const request = redaxCustomerAddRequestFromPlan(plan, campaign, next.row.rowId)
      return (
        <>
          <h4 className="customer-step__title">
            Step {stepNumber} of {totalSteps} · Add old token {next.index + 1} of {plan.rows.length}
          </h4>
          <p>
            <code className="customer-code-inline">{next.row.legacyMint}</code>
          </p>
          <p>
            {describeRedaxCustomerRate(next.row.oldAmount, next.row.newAmount)} · limit {describeRedaxCustomerLimit(next.row.limitMode, next.row.limitAmount)}
          </p>
          <div className="customer-actions">
            <button
              className="customer-btn customer-btn--primary"
              disabled={!writeAllowed || request === null}
              onClick={() => request !== null && void runMutation(request, `Old token ${next.index + 1} added.`)}
              type="button"
            >
              {busy === 'submit' ? 'Waiting for your wallet…' : 'Add old token in wallet'}
            </button>
            <button className="customer-btn" disabled={busy !== null} onClick={() => void checkMutation()} type="button">
              Check status
            </button>
          </div>
        </>
      )
    }
    if (next.kind === 'METADATA') {
      const request = redaxCustomerMetadataRequestFromPlan(plan, campaign)
      return (
        <>
          <h4 className="customer-step__title">Step {stepNumber} of {totalSteps} · Set the token details</h4>
          <div className="customer-review__token">
            {logoUrl !== null ? <img alt="Token logo" className="customer-logo__image" height={64} src={logoUrl} width={64} /> : null}
            <p>
              <strong>{plan.token.name}</strong> · {plan.token.symbol}
              <br />
              <span className="customer-muted">Permanent: these details cannot be changed after this step.</span>
            </p>
          </div>
          <p className="customer-muted">Right before your wallet opens, REDAX re-reads the published files and checks them against your plan.</p>
          <div className="customer-actions">
            <button className="customer-btn customer-btn--primary" disabled={!writeAllowed} onClick={() => void runMutation(request, 'Token details set.')} type="button">
              {busy === 'submit' ? 'Checking files, then your wallet…' : 'Set token details in wallet'}
            </button>
            <button className="customer-btn" disabled={busy !== null} onClick={() => void checkMutation()} type="button">
              Check status
            </button>
          </div>
        </>
      )
    }
    // ACTIVATE
    return (
      <>
        <h4 className="customer-step__title">Step {stepNumber} of {totalSteps} · Open conversions</h4>
        <p>
          Holders can convert as soon as this is approved: {chain?.campaign.tokenConfigCount ?? 0} old{' '}
          {(chain?.campaign.tokenConfigCount ?? 0) === 1 ? 'token' : 'tokens'}, token details set, end: {describeRedaxCustomerEnd(plan)}.
        </p>
        <label className="customer-check">
          <input
            checked={activationAck !== null && activationAck === activationKey}
            onChange={(event) => setActivationAck(redaxCustomerInputChecked(event) ? activationKey : null)}
            type="checkbox"
          />
          Open conversions for this campaign now.
        </label>
        <div className="customer-actions">
          <button
            className="customer-btn customer-btn--primary"
            disabled={!writeAllowed || activationAck === null || activationAck !== activationKey}
            onClick={() => void runActivate()}
            type="button"
          >
            {busy === 'submit' ? 'Waiting for your wallet…' : 'Open conversions in wallet'}
          </button>
          <button className="customer-btn" disabled={busy !== null} onClick={() => void checkMutation()} type="button">
            Check status
          </button>
        </div>
      </>
    )
  }

  return (
    <div className="customer-stack">
      <section className="customer-card">
        <p className="customer-eyebrow">Setup · Solana Devnet</p>
        <h3 className="customer-title">
          {plan.token.name} <span className="customer-muted">· {plan.token.symbol}</span>
        </h3>
        <ol className="customer-steps">
          {progress.steps.map((step, index) => (
            <li className={step.done ? 'customer-steps__item customer-steps__item--done' : 'customer-steps__item'} key={step.key}>
              <span className="customer-steps__mark">{step.done ? '✓' : index + 1}</span>
              {step.kind === 'CREATE'
                ? 'Create campaign'
                : step.kind === 'ADD'
                  ? `Add old token ${plan.rows.findIndex((row) => row.rowId === step.row?.rowId) + 1}`
                  : step.kind === 'METADATA'
                    ? 'Token details'
                    : 'Open conversions'}
            </li>
          ))}
        </ol>
        <p className="customer-muted">
          {progress.doneApprovals} of {progress.totalApprovals} wallet approvals done. Each step is a separate Devnet transaction.
        </p>
        {campaignAddress !== null ? (
          <RedaxPublicAddress explorerCluster={explorerCluster} kind="address" label="Campaign" value={campaignAddress} />
        ) : null}
      </section>
      <section className="customer-card customer-step">
        {blockedReason !== null ? <p className="customer-notice customer-notice--caution">{blockedReason}</p> : null}
        {renderStep()}
        {outcome !== null ? (
          <div className={`customer-notice customer-notice--${outcome.tone}`} aria-live="polite">
            <p>{outcome.title}</p>
            {outcome.technical !== undefined ? (
              <details className="technical-details">
                <summary>Technical details</summary>
                <p>{outcome.technical}</p>
              </details>
            ) : null}
          </div>
        ) : null}
        {setup.state === 'PUBLISHED' && setup.attempts.length === 0 && blockedReason === null ? (
          <button className="customer-btn customer-btn--small" onClick={() => onEdit(setupId)} type="button">
            Change details (published files stay public)
          </button>
        ) : null}
      </section>
    </div>
  )
}
