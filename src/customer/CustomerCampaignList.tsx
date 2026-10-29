// REDAX customer service — My campaigns: this wallet's own drafts, setups and campaigns.
//
// The list comes from the service's own index of THIS wallet's setups — never a scan of every
// program account — and is loaded page by page, so a long list is never silently cut. A bound
// campaign's live status is read from the chain by its exact address. Every row is its own
// campaign with its own id, plan, output mint and lifecycle; opening one changes nothing else.
//
// DELETE DRAFT is offered only for a draft whose setup never started, and only after a short
// confirmation that names it. The server decides from the stored record; the list is then read
// again, so a draft disappears only once the service confirmed it — a failure keeps it listed.

import { useCallback, useEffect, useRef, useState } from 'react'
import { StatusPill } from '../components/StatusPill'
import { useRedaxCustomerSession } from './CustomerSessionProvider'
import type { RedaxCustomerCampaignTruthResult, RedaxCustomerView } from './CustomerWorkspace'
import type { RedaxCustomerApiFailure } from './customerApi'
import { describeRedaxCustomerSetupState, describeRedaxCustomerTime } from './customerFormat'
import type { RedaxCustomerSetupSummary } from './shared/customerContract.js'

function describeDeleteFailure(failure: RedaxCustomerApiFailure): string {
  if (failure.code === 'INVALID_STATE') {
    return 'This draft can no longer be deleted: its setup has started or its files were already published. It is kept.'
  }
  if (failure.code === 'STALE_REVISION') {
    return 'This draft changed somewhere else, so it was not deleted. Reload the list and try again.'
  }
  if (failure.code === 'NETWORK' || failure.code === 'STORE_UNAVAILABLE' || failure.code === 'INTERNAL' || failure.status >= 500) {
    return 'The deletion could not be confirmed. Reload the list to see whether the draft is still there.'
  }
  return failure.message
}

export function CustomerCampaignList({
  canCreate,
  canDeleteDrafts,
  onOpen,
  readCampaignTruth,
}: {
  readonly canCreate: boolean
  readonly canDeleteDrafts: boolean
  readonly onOpen: (view: RedaxCustomerView) => void
  readonly readCampaignTruth: (campaignId: string) => Promise<RedaxCustomerCampaignTruthResult>
}) {
  const session = useRedaxCustomerSession()
  const api = session.api
  const [items, setItems] = useState<readonly RedaxCustomerSetupSummary[]>([])
  const [page, setPage] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [chainStatus, setChainStatus] = useState<Readonly<Record<string, string>>>({})
  const [confirming, setConfirming] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [deleteNotice, setDeleteNotice] = useState<{ readonly id: string | null; readonly message: string } | null>(null)
  const generationRef = useRef(0)

  const loadPage = useCallback(
    async (target: number, append: boolean): Promise<void> => {
      const generation = generationRef.current + 1
      generationRef.current = generation
      setLoading(true)
      setError(null)
      const result = await api.listSetups(target)
      if (generation !== generationRef.current) {
        return
      }
      setLoading(false)
      if (!result.ok) {
        setError(result.message)
        return
      }
      setItems((current) => (append ? [...current, ...result.items.filter((item) => !current.some((existing) => existing.id === item.id))] : result.items))
      setPage(result.page)
      setHasMore(result.hasMore)
      setTotal(result.total)
      for (const item of result.items) {
        if (item.campaign === null) {
          continue
        }
        const campaign = item.campaign
        void readCampaignTruth(campaign).then((truth) => {
          if (generation !== generationRef.current && !append) {
            return
          }
          setChainStatus((current) => ({ ...current, [campaign]: truth.ok ? truth.campaign.programStatus : 'unreadable' }))
        })
      }
    },
    [api, readCampaignTruth],
  )

  useEffect(() => {
    void loadPage(0, false)
  }, [loadPage])

  async function handleNew(): Promise<void> {
    if (creating) {
      return
    }
    setCreating(true)
    const created = await api.createSetup()
    setCreating(false)
    if (!created.ok) {
      setError(created.message)
      return
    }
    onOpen({ kind: 'compose', setupId: created.setup.id })
  }

  async function handleDelete(item: RedaxCustomerSetupSummary): Promise<void> {
    if (deleting !== null) {
      return
    }
    setDeleting(item.id)
    setDeleteNotice(null)
    const result = await api.deleteSetup(item.id, item.revision)
    setDeleting(null)
    setConfirming(null)
    if (result.ok || result.code === 'NOT_FOUND') {
      // Gone on the server (now, or already). The list is read again, not edited locally.
      setDeleteNotice({ id: null, message: 'Draft deleted.' })
      await loadPage(0, false)
      return
    }
    setDeleteNotice({ id: item.id, message: describeDeleteFailure(result) })
  }

  function openItem(item: RedaxCustomerSetupSummary): void {
    const status = item.campaign === null ? null : chainStatus[item.campaign] ?? null
    if (item.state === 'DRAFT') {
      onOpen({ kind: 'compose', setupId: item.id })
    } else if (item.state === 'REVIEW_READY') {
      onOpen({ kind: 'review', setupId: item.id })
    } else if (item.state === 'STARTED' && (status === 'active' || status === 'paused' || status === 'finalized')) {
      onOpen({ kind: 'campaign', setupId: item.id })
    } else {
      onOpen({ kind: 'progress', setupId: item.id })
    }
  }

  return (
    <section className="customer-card">
      <div className="customer-row customer-row--spread">
        <div>
          <h3 className="customer-title">My campaigns</h3>
          <p className="customer-muted">
            {total === 0 && !loading ? 'No campaigns yet.' : `${total} in this workspace`}
          </p>
        </div>
        <button className="customer-btn customer-btn--primary" disabled={!canCreate || creating} onClick={() => void handleNew()} type="button">
          {creating ? 'Creating…' : 'New campaign'}
        </button>
      </div>
      {!canCreate ? <p className="customer-muted">New campaigns are paused for this wallet.</p> : null}
      {error !== null ? (
        <p className="customer-notice customer-notice--caution">
          {error}{' '}
          <button className="customer-btn" onClick={() => void loadPage(0, false)} type="button">
            Retry
          </button>
        </p>
      ) : null}
      {deleteNotice !== null && deleteNotice.id === null ? <p className="customer-notice customer-notice--positive">{deleteNotice.message}</p> : null}
      <ul className="customer-list">
        {items.map((item) => {
          const status = item.campaign === null ? null : chainStatus[item.campaign] ?? null
          const label = describeRedaxCustomerSetupState(item.state, status)
          const action =
            item.state === 'STARTED' && (status === 'active' || status === 'paused' || status === 'finalized')
              ? 'Manage'
              : item.state === 'DRAFT' || item.state === 'REVIEW_READY'
                ? 'Continue'
                : 'Continue setup'
          const name = item.name === '' ? 'Untitled campaign' : item.name
          const offerDelete = canDeleteDrafts && item.deletable && (item.state === 'DRAFT' || item.state === 'REVIEW_READY') && item.campaign === null
          return (
            <li className="customer-list__item" key={item.id}>
              <div className="customer-list__main">
                <p className="customer-list__name">
                  {name}
                  {item.symbol !== '' ? <span className="customer-muted"> · {item.symbol}</span> : null}
                </p>
                <p className="customer-muted">
                  {item.inputCount} old {item.inputCount === 1 ? 'token' : 'tokens'}
                  {item.campaign !== null ? <> · Campaign <code className="customer-code-inline">{item.campaign}</code></> : null}
                </p>
                <p className="customer-muted">Updated {describeRedaxCustomerTime(item.updatedAt)}</p>
              </div>
              <div className="customer-list__side">
                <StatusPill label={label} tone={status === 'active' ? 'positive' : status === 'paused' ? 'caution' : 'neutral'} />
                <button className="customer-btn" onClick={() => openItem(item)} type="button">
                  {action}
                </button>
                {offerDelete && confirming !== item.id ? (
                  <button
                    className="customer-btn customer-btn--small"
                    disabled={deleting !== null}
                    onClick={() => {
                      setDeleteNotice(null)
                      setConfirming(item.id)
                    }}
                    type="button"
                  >
                    Delete draft
                  </button>
                ) : null}
              </div>
              {offerDelete && confirming === item.id ? (
                <div className="customer-notice customer-notice--caution customer-list__confirm" role="alertdialog" aria-label="Delete this draft?">
                  <p>
                    <strong>Delete this draft?</strong>
                  </p>
                  <p>“{name}” and any changes to it that are not saved yet will be deleted. This cannot be undone.</p>
                  <div className="customer-actions">
                    <button className="customer-btn" disabled={deleting !== null} onClick={() => setConfirming(null)} type="button">
                      Cancel
                    </button>
                    <button className="customer-btn customer-btn--primary" disabled={deleting !== null} onClick={() => void handleDelete(item)} type="button">
                      {deleting === item.id ? 'Deleting…' : 'Delete draft'}
                    </button>
                  </div>
                </div>
              ) : null}
              {deleteNotice !== null && deleteNotice.id === item.id ? (
                <p className="customer-notice customer-notice--caution customer-list__confirm">
                  {deleteNotice.message}{' '}
                  <button className="customer-btn customer-btn--small" onClick={() => void loadPage(0, false)} type="button">
                    Reload list
                  </button>
                </p>
              ) : null}
            </li>
          )
        })}
      </ul>
      {hasMore ? (
        <button className="customer-btn" disabled={loading} onClick={() => void loadPage(page + 1, true)} type="button">
          {loading ? 'Loading…' : 'Show more'}
        </button>
      ) : null}
      {loading && items.length === 0 ? <p className="customer-muted">Loading…</p> : null}
    </section>
  )
}
