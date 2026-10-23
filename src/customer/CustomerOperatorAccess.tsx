// REDAX customer service — the operator's Customer access screen.
//
// One job: give a customer's PUBLIC wallet address access to the Team workspace, see who has it,
// and stop or allow new campaigns per wallet. Each customer is its own record, so changing one
// never touches another. Stopping new campaigns (`STOP_NEW`) leaves the customer able to finish
// a campaign they already created, manage their campaigns and read their records.
//
// The operator is an operator because the SERVER's configuration names the wallet, never because
// the page says so; every action here is checked again by the service.

import { useCallback, useEffect, useState } from 'react'
import { isCanonicalRedaxPublicKey } from '../config/redaxEnv'
import { StatusPill } from '../components/StatusPill'
import { redaxCustomerInputValue } from './customerDomEvents'
import { useRedaxCustomerSession } from './CustomerSessionProvider'
import { describeRedaxCustomerTime } from './customerFormat'
import type { RedaxCustomerGrantStatus, RedaxCustomerGrantSummary } from './shared/customerContract.js'

export function CustomerOperatorAccess() {
  const session = useRedaxCustomerSession()
  const api = session.api
  const [grants, setGrants] = useState<readonly RedaxCustomerGrantSummary[]>([])
  const [page, setPage] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState<{ readonly tone: 'positive' | 'caution'; readonly text: string } | null>(null)
  const [wallet, setWallet] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(
    async (target: number): Promise<void> => {
      setLoading(true)
      const result = await api.operatorGrants(target)
      setLoading(false)
      if (!result.ok) {
        setMessage({ tone: 'caution', text: result.message })
        return
      }
      setGrants((current) => (target === 0 ? result.grants : [...current, ...result.grants.filter((grant) => !current.some((entry) => entry.wallet === grant.wallet))]))
      setPage(target)
      setHasMore(result.hasMore)
    },
    [api],
  )

  useEffect(() => {
    void load(0)
  }, [load])

  async function setStatus(target: string, status: RedaxCustomerGrantStatus, targetNote: string): Promise<void> {
    if (busy !== null) {
      return
    }
    setBusy(target)
    setMessage(null)
    try {
      // The record's current revision is read fresh; a concurrent change is refused, not overwritten.
      const current = await api.operatorGrantGet(target)
      if (!current.ok) {
        setMessage({ tone: 'caution', text: current.message })
        return
      }
      const result = await api.operatorGrantSet({
        wallet: target,
        status,
        note: targetNote,
        expectedRevision: current.grant?.revision ?? null,
      })
      if (!result.ok) {
        setMessage({ tone: 'caution', text: result.message })
        return
      }
      setMessage({
        tone: 'positive',
        text: status === 'ACTIVE' ? `Access is active for ${target}. They can sign in now.` : `New campaigns are stopped for ${target}. Existing campaigns stay manageable.`,
      })
      await load(0)
    } finally {
      setBusy(null)
    }
  }

  const candidate = wallet.trim()
  const candidateValid = isCanonicalRedaxPublicKey(candidate)

  return (
    <div className="customer-stack">
      <section className="customer-card">
        <p className="customer-eyebrow">Operator</p>
        <h3 className="customer-title">Customer access</h3>
        <p className="customer-muted">
          Give a customer’s public Team wallet address access to the workspace. This is access to this app only — not an
          on-chain whitelist, not proof of token ownership and not a verification of any campaign.
        </p>
        <label className="customer-field">
          <span className="customer-field__label">Customer wallet address</span>
          <input
            className="customer-input customer-input--mono"
            onChange={(event) => setWallet(redaxCustomerInputValue(event))}
            placeholder="The customer’s public Solana address"
            spellCheck={false}
            value={wallet}
          />
          {candidate !== '' && !candidateValid ? <span className="customer-field__error">This is not a valid Solana address.</span> : null}
        </label>
        <label className="customer-field">
          <span className="customer-field__label">Note (optional)</span>
          <input className="customer-input" maxLength={120} onChange={(event) => setNote(redaxCustomerInputValue(event))} placeholder="e.g. Customer name" value={note} />
        </label>
        <div className="customer-actions">
          <button
            className="customer-btn customer-btn--primary"
            disabled={!candidateValid || busy !== null}
            onClick={() => void setStatus(candidate, 'ACTIVE', note.trim()).then(() => setWallet(''))}
            type="button"
          >
            {busy === candidate ? 'Saving…' : 'Give access'}
          </button>
        </div>
        {message !== null ? <p className={`customer-notice customer-notice--${message.tone}`}>{message.text}</p> : null}
      </section>

      <section className="customer-card">
        <h3 className="customer-title">Customers</h3>
        {grants.length === 0 && !loading ? <p className="customer-muted">No customer has access yet.</p> : null}
        <ul className="customer-list">
          {grants.map((grant) => (
            <li className="customer-list__item" key={grant.wallet}>
              <div className="customer-list__main">
                <code className="customer-code-inline">{grant.wallet}</code>
                <p className="customer-muted">
                  {grant.note !== '' ? `${grant.note} · ` : ''}updated {describeRedaxCustomerTime(grant.updatedAt)}
                </p>
              </div>
              <div className="customer-list__side">
                <StatusPill label={grant.status === 'ACTIVE' ? 'Access active' : 'New campaigns stopped'} tone={grant.status === 'ACTIVE' ? 'positive' : 'caution'} />
                {grant.status === 'ACTIVE' ? (
                  <button className="customer-btn" disabled={busy !== null} onClick={() => void setStatus(grant.wallet, 'STOP_NEW', grant.note)} type="button">
                    Stop new campaigns
                  </button>
                ) : (
                  <button className="customer-btn" disabled={busy !== null} onClick={() => void setStatus(grant.wallet, 'ACTIVE', grant.note)} type="button">
                    Allow new campaigns
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
        {hasMore ? (
          <button className="customer-btn" disabled={loading} onClick={() => void load(page + 1)} type="button">
            Show more
          </button>
        ) : null}
      </section>
    </div>
  )
}
