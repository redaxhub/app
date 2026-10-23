// REDAX customer service — the ONE full review, and the start of the setup.
//
// Everything the campaign will be is shown once: the exact name, symbol and final logo, every old
// token with its exact rate and limit, the total limit, the end time in UTC and on this device,
// the 1% fee, the wallet that will sign and the exact public locations of the token files.
// One checkbox confirms it all. The approval is memory-only and bound to THIS plan hash, setup
// revision and session: a different plan, a reload or another wallet never inherits it.
//
// "Start setup" PUBLISHES THE PUBLIC FILES AND NOTHING ELSE. No wallet opens here. The chain
// steps follow one by one on the next screen, each with its own explicit approval.

import { useEffect, useState } from 'react'
import { redaxCustomerInputChecked } from './customerDomEvents'
import { useRedaxCustomerSession } from './CustomerSessionProvider'
import { describeRedaxCustomerEnd, describeRedaxCustomerRate } from './customerFormat'
import { useCustomerLogoPreview } from './useCustomerLogoPreview'
import type { RedaxCustomerSetupRecordV1 } from './shared/customerContract.js'
import { describeRedaxCustomerLimit, exampleRedaxCustomerRow, isRedaxCustomerPlanHashCurrent } from './shared/customerPlan.js'

export function CustomerReview({
  setupId,
  canStart,
  onEdit,
  onStarted,
}: {
  readonly setupId: string
  readonly canStart: boolean
  readonly onEdit: (setupId: string) => void
  readonly onStarted: (setupId: string) => void
}) {
  const session = useRedaxCustomerSession()
  const api = session.api
  const [setup, setSetup] = useState<RedaxCustomerSetupRecordV1 | null>(null)
  const [hashOk, setHashOk] = useState<boolean | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Memory-only approval, bound to the exact plan it was given for.
  const [approval, setApproval] = useState<{ readonly planHash: string; readonly revision: number } | null>(null)
  const [starting, setStarting] = useState(false)
  const logoUrl = useCustomerLogoPreview(api, setup?.plan?.publication.imageSha256 ?? null)

  useEffect(() => {
    let cancelled = false
    void api.getSetup(setupId).then(async (result) => {
      if (cancelled) {
        return
      }
      if (!result.ok) {
        setError(result.message)
        return
      }
      if (result.setup.id !== setupId || result.setup.owner !== session.teamWallet) {
        return
      }
      setSetup(result.setup)
      const plan = result.setup.plan
      const ok = plan !== null && result.setup.planHash !== null && (await isRedaxCustomerPlanHashCurrent(plan, result.setup.planHash))
      if (!cancelled) {
        setHashOk(ok)
      }
    })
    return () => {
      cancelled = true
    }
  }, [api, session.teamWallet, setupId])

  if (error !== null) {
    return (
      <section className="customer-card">
        <p className="customer-notice customer-notice--caution">{error}</p>
      </section>
    )
  }
  if (setup === null || hashOk === null) {
    return (
      <section className="customer-card">
        <p className="customer-muted">Loading the review…</p>
      </section>
    )
  }
  const plan = setup.plan
  if (setup.state !== 'REVIEW_READY' || plan === null || setup.planHash === null) {
    return (
      <section className="customer-card">
        <p>This campaign is not waiting for a review.</p>
        <button className="customer-btn" onClick={() => onEdit(setupId)} type="button">
          Open the draft
        </button>
      </section>
    )
  }
  if (!hashOk) {
    return (
      <section className="customer-card">
        <p className="customer-notice customer-notice--caution">
          This plan could not be verified, so it cannot be started. Nothing was published or sent. Open the draft and review it again.
        </p>
        <button className="customer-btn" onClick={() => onEdit(setupId)} type="button">
          Open the draft
        </button>
      </section>
    )
  }
  const planHash = setup.planHash
  const approved = approval !== null && approval.planHash === planHash && approval.revision === setup.revision
  const approvals = plan.rows.length + 3

  async function handleStart(): Promise<void> {
    if (!approved || starting || !canStart) {
      return
    }
    setStarting(true)
    setError(null)
    const published = await api.publish(setupId, planHash)
    setStarting(false)
    if (!published.ok) {
      setError(published.message)
      return
    }
    onStarted(setupId)
  }

  return (
    <div className="customer-stack">
      <section className="customer-card">
        <p className="customer-eyebrow">Review · Solana Devnet</p>
        <h3 className="customer-title">Check everything once</h3>
        <div className="customer-review__token">
          {logoUrl !== null ? (
            <img alt="Final logo" className="customer-logo__image" height={96} src={logoUrl} width={96} />
          ) : (
            <div className="customer-logo__placeholder">Loading…</div>
          )}
          <dl className="customer-dl">
            <dt>Token name</dt>
            <dd>{plan.token.name}</dd>
            <dt>Symbol</dt>
            <dd>{plan.token.symbol}</dd>
            {plan.token.description !== '' ? (
              <>
                <dt>Description</dt>
                <dd>{plan.token.description}</dd>
              </>
            ) : null}
            <dt>Logo</dt>
            <dd>
              {plan.publication.imageWidth} × {plan.publication.imageHeight} PNG
            </dd>
          </dl>
        </div>
      </section>

      <section className="customer-card">
        <h3 className="customer-title">Old tokens ({plan.rows.length})</h3>
        <ol className="customer-review__rows">
          {plan.rows.map((row) => {
            const example = exampleRedaxCustomerRow({
              oldAmount: row.oldAmount,
              legacyDecimals: row.legacyDecimals,
              rateNumerator: row.rateNumerator,
              rateDenominator: row.rateDenominator,
            })
            return (
              <li key={row.rowId}>
                <code className="customer-code-inline">{row.legacyMint}</code>
                <span className="customer-muted"> · {row.legacyDecimals} decimals</span>
                <div>{describeRedaxCustomerRate(row.oldAmount, row.newAmount)}</div>
                <div className="customer-muted">Limit: {describeRedaxCustomerLimit(row.limitMode, row.limitAmount)}</div>
                {example !== null ? (
                  <div className="customer-muted">
                    Holder converting {example.oldAmount} old receives {example.netNew} new ({example.grossNew} gross − {example.feeNew} fee)
                  </div>
                ) : null}
              </li>
            )
          })}
        </ol>
      </section>

      <section className="customer-card">
        <h3 className="customer-title">Limits, time and fee</h3>
        <dl className="customer-dl">
          <dt>Total limit</dt>
          <dd>{plan.totalLimit.mode === 'NONE' ? 'No limit' : `${plan.totalLimit.amount} new tokens (gross, including the 1% fee)`}</dd>
          <dt>End</dt>
          <dd>{describeRedaxCustomerEnd(plan)}</dd>
          <dt>Fee</dt>
          <dd>1% of the new tokens of every conversion goes to the REDAX protocol fee account; holders receive 99%.</dd>
          <dt>Team wallet</dt>
          <dd>
            <code className="customer-code-inline">{plan.teamWallet}</code> — signs every step and becomes the campaign admin.
          </dd>
          <dt>New token mint</dt>
          <dd>Created for this campaign in the first step; only the campaign can mint it.</dd>
          <dt>Network</dt>
          <dd>Solana Devnet</dd>
        </dl>
      </section>

      <section className="customer-card customer-card--emphasis">
        <h3 className="customer-title">What happens next</h3>
        <ul className="customer-bullets">
          <li>
            <strong>Start setup</strong> publishes the final logo and token details as public files:
            <code className="customer-code">{plan.publication.jsonUri}</code>
            They are public from that moment and stay public even if you never create the campaign.
          </li>
          <li>
            Then you approve {approvals} transactions in Phantom, one at a time: create the campaign, add {plan.rows.length}{' '}
            old {plan.rows.length === 1 ? 'token' : 'tokens'}, set the token details, open conversions. Each needs a little
            Devnet SOL.
          </li>
          <li>The token name, symbol and details become permanent on chain. Rates, limits and the end time cannot be changed later.</li>
        </ul>
        <label className="customer-check">
          <input
            checked={approved}
            disabled={!canStart}
            onChange={(event) => setApproval(redaxCustomerInputChecked(event) ? { planHash, revision: setup.revision } : null)}
            type="checkbox"
          />
          I reviewed every detail above. Use them exactly as shown.
        </label>
        {error !== null ? <p className="customer-notice customer-notice--caution">{error}</p> : null}
        {!canStart ? <p className="customer-muted">New campaigns are paused for this wallet.</p> : null}
        <div className="customer-actions">
          <button className="customer-btn" disabled={starting} onClick={() => onEdit(setupId)} type="button">
            Edit
          </button>
          <button className="customer-btn customer-btn--primary" disabled={!approved || starting || !canStart} onClick={() => void handleStart()} type="button">
            {starting ? 'Publishing…' : 'Start setup'}
          </button>
        </div>
      </section>
    </div>
  )
}
