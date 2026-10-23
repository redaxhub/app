// REDAX customer service — the one composer: the new token, its logo, 1–10 old tokens, limits, time.
//
// THE CUSTOMER TYPES WHAT THEY MEAN. Names, a logo file, "X old → Y new", limits in new tokens
// and a date in their own time zone. Mint decimals are read from Devnet, never typed; raw base
// units, Unix seconds and URIs are never asked for. Every number becomes exact on-chain terms
// through the shared converters, and a live example shows what a holder actually receives
// after the 1% fee.
//
// SAVING IS AUTOMATIC AND HONEST. Edits are coalesced and saved shortly after typing stops —
// one save in flight at a time, each carrying the revision it was based on. The status says
// Saving, Saved or Save failed; a draft changed in another tab is never overwritten (the
// server refuses the stale revision and the page says so).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { isCanonicalRedaxPublicKey } from '../config/redaxEnv'
import {
  formatRedaxUnixSecondsUtc,
  parseRedaxHumanDateTime,
  parseRedaxHumanRate,
  describeRedaxHumanDateTimeRefusal,
  redaxDeviceTimeZoneName,
} from '../lib/redaxHumanUnits'
import { useRedaxTeamAdminMutationActions } from '../teamAdmin/RedaxTeamAdminMutationActions'
import { redaxCustomerClearInput, redaxCustomerInputFirstFile, redaxCustomerInputValue } from './customerDomEvents'
import { useRedaxCustomerSession } from './CustomerSessionProvider'
import { useCustomerLogoPreview } from './useCustomerLogoPreview'
import {
  REDAX_CUSTOMER_LOGO_MAX_INPUT_BYTES,
  REDAX_CUSTOMER_MAX_INPUT_ROWS,
  type RedaxCustomerDraftRowV1,
  type RedaxCustomerDraftV1,
  type RedaxCustomerSetupRecordV1,
} from './shared/customerContract.js'
import {
  deriveRedaxCustomerPlanTerms,
  emptyRedaxCustomerDraftRow,
  exampleRedaxCustomerRow,
  type RedaxCustomerIssue,
} from './shared/customerPlan.js'

type EditableDraft = Omit<RedaxCustomerDraftV1, 'logo'>
type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'failed' | 'stale'
type MintRead =
  | { readonly mint: string; readonly state: 'reading' }
  | { readonly mint: string; readonly state: 'ok'; readonly decimals: number }
  | { readonly mint: string; readonly state: 'error'; readonly message: string }

const SAVE_DELAY_MS = 1500

function editableOf(draft: RedaxCustomerDraftV1): EditableDraft {
  const { logo: _logo, ...rest } = draft
  void _logo
  return rest
}

function nextRowId(rows: readonly RedaxCustomerDraftRowV1[]): string {
  let index = rows.length + 1
  while (rows.some((row) => row.rowId === `r${index}`)) {
    index += 1
  }
  return `r${index}`
}

function describeMintFailure(code: string): string {
  switch (code) {
    case 'MINT_ACCOUNT_ABSENT':
      return 'No token mint exists at this address on Devnet.'
    case 'NOT_A_CLASSIC_SPL_MINT':
      return 'This is not a classic SPL token mint. Token-2022 and other programs are not supported in Phase 1.'
    case 'MINT_NOT_INITIALIZED':
      return 'This mint is not initialized.'
    case 'NOT_A_PUBLIC_KEY':
      return 'This is not a valid Solana address.'
    default:
      return 'Devnet could not be read just now. Try again in a moment.'
  }
}

export function CustomerComposer({
  setupId,
  canEdit,
  onBack,
  onReview,
}: {
  readonly setupId: string
  readonly canEdit: boolean
  readonly onBack: () => void
  readonly onReview: (setupId: string) => void
}) {
  const session = useRedaxCustomerSession()
  const api = session.api
  const actions = useRedaxTeamAdminMutationActions()
  const wallet = session.teamWallet
  const [setup, setSetup] = useState<RedaxCustomerSetupRecordV1 | null>(null)
  const [draft, setDraft] = useState<EditableDraft | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [mintReads, setMintReads] = useState<Readonly<Record<string, MintRead>>>({})
  const [issues, setIssues] = useState<readonly RedaxCustomerIssue[] | null>(null)
  const [busy, setBusy] = useState<'upload' | 'accept' | 'review' | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [endError, setEndError] = useState<string | null>(null)

  const mountedRef = useRef(true)
  const draftRef = useRef<EditableDraft | null>(null)
  const revisionRef = useRef(0)
  const dirtyRef = useRef(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const queueRef = useRef<Promise<void>>(Promise.resolve())
  const lastSaveOkRef = useRef(true)
  const mintGenerationRef = useRef<Record<string, number>>({})
  const setupStateRef = useRef<RedaxCustomerSetupRecordV1['state'] | null>(null)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current)
      }
    }
  }, [])

  const accept = useCallback(
    (next: RedaxCustomerSetupRecordV1): boolean => {
      // A response is only ever applied to the setup and the wallet it was asked about.
      if (!mountedRef.current || next.id !== setupId || next.owner !== wallet) {
        return false
      }
      revisionRef.current = next.revision
      setupStateRef.current = next.state
      setSetup(next)
      return true
    },
    [setupId, wallet],
  )

  useEffect(() => {
    let cancelled = false
    void api.getSetup(setupId).then((result) => {
      if (cancelled) {
        return
      }
      if (!result.ok) {
        setLoadError(result.message)
        return
      }
      if (accept(result.setup)) {
        const editable = editableOf(result.setup.draft)
        draftRef.current = editable
        setDraft(editable)
        setSaveState('saved')
      }
    })
    return () => {
      cancelled = true
    }
  }, [accept, api, setupId])

  // Preview the server's own final logo bytes — the exact file that would be published.
  const logo = setup?.draft.logo ?? null
  // Keyed on the HASH, not the record: a save returns a new record object, and re-fetching the
  // same final image on every save would be wasted reads.
  const logoUrl = useCustomerLogoPreview(api, logo?.sha256 ?? null)

  const flush = useCallback(async (): Promise<boolean> => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    const run = queueRef.current.then(async () => {
      if (!dirtyRef.current || draftRef.current === null) {
        return
      }
      dirtyRef.current = false
      const snapshot = draftRef.current
      setSaveState('saving')
      // A published-but-never-created plan may be reopened for editing; its public files stay.
      const reopen = setupStateRef.current === 'PUBLISHED'
      const result = await api.saveSetup({ id: setupId, expectedRevision: revisionRef.current, draft: snapshot, reopen })
      if (!mountedRef.current) {
        return
      }
      if (result.ok) {
        accept(result.setup)
        lastSaveOkRef.current = true
        setSaveState(dirtyRef.current ? 'dirty' : 'saved')
        return
      }
      dirtyRef.current = true
      lastSaveOkRef.current = false
      setSaveState(result.code === 'STALE_REVISION' ? 'stale' : 'failed')
      if (result.code !== 'STALE_REVISION') {
        setNotice(result.message)
      }
    })
    queueRef.current = run.catch(() => undefined)
    await run
    return !dirtyRef.current && lastSaveOkRef.current
  }, [accept, api, setupId])

  const update = useCallback(
    (patch: Partial<EditableDraft>): void => {
      if (!canEdit || draftRef.current === null) {
        return
      }
      const next = { ...draftRef.current, ...patch }
      draftRef.current = next
      setDraft(next)
      dirtyRef.current = true
      setSaveState('dirty')
      setIssues(null)
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current)
      }
      timerRef.current = setTimeout(() => {
        timerRef.current = null
        void flush()
      }, SAVE_DELAY_MS)
    },
    [canEdit, flush],
  )

  const updateRow = useCallback(
    (rowId: string, patch: Partial<RedaxCustomerDraftRowV1>): void => {
      const current = draftRef.current
      if (current === null) {
        return
      }
      update({ rows: current.rows.map((row) => (row.rowId === rowId ? { ...row, ...patch } : row)) })
    },
    [update],
  )

  // The old token's decimals come from a read-only Devnet mint read, never from typing.
  const readMint = useCallback(
    async (rowId: string, mint: string): Promise<void> => {
      const generation = (mintGenerationRef.current[rowId] ?? 0) + 1
      mintGenerationRef.current[rowId] = generation
      if (!isCanonicalRedaxPublicKey(mint)) {
        setMintReads((current) => ({ ...current, [rowId]: { mint, state: 'error', message: 'This is not a valid Solana address.' } }))
        updateRow(rowId, { legacyDecimals: null })
        return
      }
      setMintReads((current) => ({ ...current, [rowId]: { mint, state: 'reading' } }))
      const result = await actions.readClassicMintFacts(mint)
      if (!mountedRef.current || mintGenerationRef.current[rowId] !== generation) {
        return
      }
      const row = draftRef.current?.rows.find((entry) => entry.rowId === rowId)
      if (row === undefined || row.legacyMint.trim() !== mint) {
        return
      }
      if (result.ok) {
        setMintReads((current) => ({ ...current, [rowId]: { mint, state: 'ok', decimals: result.decimals } }))
        updateRow(rowId, { legacyDecimals: result.decimals })
      } else {
        setMintReads((current) => ({ ...current, [rowId]: { mint, state: 'error', message: describeMintFailure(result.code) } }))
        updateRow(rowId, { legacyDecimals: null })
      }
    },
    [actions, updateRow],
  )

  async function handleLogo(file: { readonly size: number; arrayBuffer(): Promise<ArrayBuffer> } | null): Promise<void> {
    if (file === null || busy !== null) {
      return
    }
    if (file.size > REDAX_CUSTOMER_LOGO_MAX_INPUT_BYTES) {
      setNotice('The image is larger than 2 MB. Choose a smaller PNG, JPEG or WebP file.')
      return
    }
    setBusy('upload')
    setNotice(null)
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      if (setupStateRef.current === 'PUBLISHED') {
        // Reopen first, so the upload lands on an editable draft.
        dirtyRef.current = true
      }
      if (!(await flush())) {
        setNotice('Save your changes first, then upload the logo again.')
        return
      }
      const result = await api.uploadLogo(setupId, revisionRef.current, bytes)
      if (!result.ok) {
        setNotice(result.message)
        return
      }
      accept(result.setup)
    } finally {
      if (mountedRef.current) {
        setBusy(null)
      }
    }
  }

  async function handleAcceptLogo(): Promise<void> {
    if (logo === null || busy !== null) {
      return
    }
    setBusy('accept')
    try {
      await flush()
      const result = await api.acceptLogo(setupId, revisionRef.current, logo.sha256)
      if (result.ok) {
        accept(result.setup)
      } else {
        setNotice(result.message)
      }
    } finally {
      if (mountedRef.current) {
        setBusy(null)
      }
    }
  }

  async function handleReview(): Promise<void> {
    if (busy !== null || draft === null || setup === null) {
      return
    }
    const local = deriveRedaxCustomerPlanTerms({ ...draft, logo: setup.draft.logo }, Math.floor(Date.now() / 1000))
    if (!local.ok) {
      setIssues(local.issues)
      return
    }
    setBusy('review')
    try {
      if (!(await flush())) {
        setNotice('Your latest changes are not saved yet. Try again in a moment.')
        return
      }
      const prepared = await api.prepare(setupId, revisionRef.current)
      if (!prepared.ok) {
        if (prepared.issues !== undefined) {
          setIssues(prepared.issues)
        } else {
          setNotice(prepared.message)
        }
        return
      }
      if (accept(prepared.setup)) {
        onReview(setupId)
      }
    } finally {
      if (mountedRef.current) {
        setBusy(null)
      }
    }
  }

  const issueFor = useMemo(() => {
    const map = new Map<string, string>()
    for (const issue of issues ?? []) {
      if (!map.has(issue.field)) {
        map.set(issue.field, issue.message)
      }
    }
    return map
  }, [issues])

  if (loadError !== null) {
    return (
      <section className="customer-card">
        <p className="customer-notice customer-notice--caution">{loadError}</p>
        <button className="customer-btn" onClick={onBack} type="button">
          Back to My campaigns
        </button>
      </section>
    )
  }
  if (setup === null || draft === null) {
    return (
      <section className="customer-card">
        <p className="customer-muted">Loading your draft…</p>
      </section>
    )
  }
  const reopenable = setup.state === 'PUBLISHED' && setup.attempts.length === 0
  if (setup.state !== 'DRAFT' && setup.state !== 'REVIEW_READY' && !reopenable) {
    return (
      <section className="customer-card">
        <p>This campaign’s setup has already started, so its details can no longer be edited.</p>
        <button className="customer-btn" onClick={onBack} type="button">
          Back to My campaigns
        </button>
      </section>
    )
  }

  const saveLabel =
    saveState === 'saving'
      ? 'Saving…'
      : saveState === 'dirty'
        ? 'Unsaved changes'
        : saveState === 'failed'
          ? 'Save failed'
          : saveState === 'stale'
            ? 'Changed elsewhere'
            : 'Saved'
  const nowMs = Date.now()

  return (
    <div className="customer-stack">
      <section className="customer-card">
        <div className="customer-row customer-row--spread">
          <div>
            <p className="customer-eyebrow">New campaign</p>
            <h3 className="customer-title">{draft.name === '' ? 'Untitled campaign' : draft.name}</h3>
          </div>
          <span className={`customer-save customer-save--${saveState}`} aria-live="polite">
            {saveLabel}
            {saveState === 'failed' ? (
              <button className="customer-btn customer-btn--small" onClick={() => void flush()} type="button">
                Retry
              </button>
            ) : null}
          </span>
        </div>
        {saveState === 'stale' ? (
          <p className="customer-notice customer-notice--caution">
            This draft was changed in another tab or browser. Reload it to continue — nothing here was overwritten.{' '}
            <button className="customer-btn" onClick={onBack} type="button">
              Reload from My campaigns
            </button>
          </p>
        ) : null}
        {!canEdit ? <p className="customer-notice customer-notice--caution">New campaigns are paused for this wallet, so this draft is read-only.</p> : null}
        {reopenable ? (
          <p className="customer-notice">
            This plan was already published. Changing it creates a new review and new public files; the files published
            before stay public.
          </p>
        ) : null}
        {notice !== null ? <p className="customer-notice customer-notice--caution">{notice}</p> : null}
      </section>

      <section className="customer-card">
        <h3 className="customer-title">New token</h3>
        <label className="customer-field">
          <span className="customer-field__label">Token name</span>
          <input
            className="customer-input"
            disabled={!canEdit}
            maxLength={64}
            onChange={(event) => update({ name: redaxCustomerInputValue(event) })}
            placeholder="e.g. Acme Token"
            value={draft.name}
          />
          <span className="customer-field__hint">Up to 32 bytes. This becomes the on-chain name and cannot be changed later.</span>
          {issueFor.has('name') ? <span className="customer-field__error">{issueFor.get('name')}</span> : null}
        </label>
        <label className="customer-field">
          <span className="customer-field__label">Symbol</span>
          <input
            className="customer-input customer-input--short"
            disabled={!canEdit}
            maxLength={32}
            onChange={(event) => update({ symbol: redaxCustomerInputValue(event) })}
            placeholder="e.g. ACME"
            value={draft.symbol}
          />
          <span className="customer-field__hint">Up to 10 bytes, no spaces.</span>
          {issueFor.has('symbol') ? <span className="customer-field__error">{issueFor.get('symbol')}</span> : null}
        </label>
        <label className="customer-field">
          <span className="customer-field__label">Short description (optional)</span>
          <textarea
            className="customer-input customer-textarea"
            disabled={!canEdit}
            maxLength={300}
            onChange={(event) => update({ description: redaxCustomerInputValue(event) })}
            rows={2}
            value={draft.description}
          />
          {issueFor.has('description') ? <span className="customer-field__error">{issueFor.get('description')}</span> : null}
        </label>
        <div className="customer-field">
          <span className="customer-field__label">Logo</span>
          <div className="customer-logo">
            {logoUrl !== null && logo !== null ? (
              <img alt="Final logo that will be published" className="customer-logo__image" height={96} src={logoUrl} width={96} />
            ) : (
              <div className="customer-logo__placeholder">{logo === null ? 'No logo yet' : 'Loading…'}</div>
            )}
            <div className="customer-logo__side">
              <label className="customer-btn">
                {busy === 'upload' ? 'Uploading…' : logo === null ? 'Upload logo' : 'Replace logo'}
                <input
                  accept="image/png,image/jpeg,image/webp"
                  className="customer-file"
                  disabled={!canEdit || busy !== null}
                  onChange={(event) => {
                    const file = redaxCustomerInputFirstFile(event)
                    redaxCustomerClearInput(event)
                    void handleLogo(file)
                  }}
                  type="file"
                />
              </label>
              <span className="customer-field__hint">PNG, JPEG or WebP, up to 2 MB. Published as a square PNG (max 512 × 512).</span>
              {logo !== null ? (
                <span className="customer-field__hint">
                  Final file: {logo.width} × {logo.height} PNG
                  {logo.transformed ? ` — cropped/resized from ${logo.sourceWidth} × ${logo.sourceHeight}` : ''}.
                </span>
              ) : null}
              {logo !== null && logo.transformed && !logo.accepted ? (
                <div className="customer-notice">
                  We made your image square and resized it. The picture on the left is exactly the file that will be
                  published.
                  <div className="customer-actions">
                    <button className="customer-btn customer-btn--primary" disabled={busy !== null || !canEdit} onClick={() => void handleAcceptLogo()} type="button">
                      Use this logo
                    </button>
                  </div>
                </div>
              ) : null}
              {issueFor.has('logo') ? <span className="customer-field__error">{issueFor.get('logo')}</span> : null}
            </div>
          </div>
        </div>
      </section>

      <section className="customer-card">
        <h3 className="customer-title">Old tokens holders can convert</h3>
        <p className="customer-muted">
          Add 1–{REDAX_CUSTOMER_MAX_INPUT_ROWS} classic SPL tokens. Each conversion uses one old token. REDAX keeps 1% of
          the new tokens minted as the protocol fee; holders receive the rest.
        </p>
        {issueFor.has('rows') ? <p className="customer-field__error">{issueFor.get('rows')}</p> : null}
        {draft.rows.map((row, index) => {
          const read = mintReads[row.rowId]
          const rate = parseRedaxHumanRate(row.oldAmount, row.newAmount)
          const example =
            rate.ok && row.legacyDecimals !== null
              ? exampleRedaxCustomerRow({
                  oldAmount: row.oldAmount,
                  legacyDecimals: row.legacyDecimals,
                  rateNumerator: rate.numerator.toString(),
                  rateDenominator: rate.denominator.toString(),
                })
              : null
          const field = (name: string): string | undefined => issueFor.get(`row:${row.rowId}:${name}`)
          return (
            <fieldset className="customer-rowcard" key={row.rowId}>
              <legend className="customer-rowcard__legend">Old token {index + 1}</legend>
              <label className="customer-field">
                <span className="customer-field__label">Mint address</span>
                <input
                  className="customer-input customer-input--mono"
                  disabled={!canEdit}
                  onBlur={() => {
                    const mint = row.legacyMint.trim()
                    if (mint !== '' && (read === undefined || read.mint !== mint)) {
                      void readMint(row.rowId, mint)
                    }
                  }}
                  onChange={(event) => {
                    updateRow(row.rowId, { legacyMint: redaxCustomerInputValue(event), legacyDecimals: null })
                    const mint = redaxCustomerInputValue(event).trim()
                    if (isCanonicalRedaxPublicKey(mint)) {
                      void readMint(row.rowId, mint)
                    }
                  }}
                  placeholder="Paste the old token's mint address"
                  spellCheck={false}
                  value={row.legacyMint}
                />
                {read !== undefined && read.mint === row.legacyMint.trim() ? (
                  read.state === 'reading' ? (
                    <span className="customer-field__hint">Checking on Devnet…</span>
                  ) : read.state === 'ok' ? (
                    <span className="customer-field__ok">Classic SPL token · {read.decimals} decimals</span>
                  ) : (
                    <span className="customer-field__error">{read.message}</span>
                  )
                ) : row.legacyDecimals !== null ? (
                  <span className="customer-field__ok">Classic SPL token · {row.legacyDecimals} decimals</span>
                ) : null}
                {field('mint') !== undefined && read?.state !== 'reading' ? <span className="customer-field__error">{field('mint')}</span> : null}
              </label>
              <div className="customer-field">
                <span className="customer-field__label">Rate</span>
                <div className="customer-rate">
                  <input
                    aria-label="Old tokens"
                    className="customer-input customer-input--number"
                    disabled={!canEdit}
                    inputMode="decimal"
                    onChange={(event) => updateRow(row.rowId, { oldAmount: redaxCustomerInputValue(event) })}
                    placeholder="1"
                    value={row.oldAmount}
                  />
                  <span>old →</span>
                  <input
                    aria-label="New tokens"
                    className="customer-input customer-input--number"
                    disabled={!canEdit}
                    inputMode="decimal"
                    onChange={(event) => updateRow(row.rowId, { newAmount: redaxCustomerInputValue(event) })}
                    placeholder="2"
                    value={row.newAmount}
                  />
                  <span>new (gross)</span>
                </div>
                {example !== null ? (
                  <span className="customer-field__hint">
                    A holder converting {example.oldAmount} old receives {example.netNew} new ({example.grossNew} gross − {example.feeNew} fee).
                  </span>
                ) : null}
                {field('rate') !== undefined ? <span className="customer-field__error">{field('rate')}</span> : null}
              </div>
              <fieldset className="customer-choice">
                <legend className="customer-field__label">Limit for this old token</legend>
                <label className="customer-choice__option">
                  <input checked={row.limitMode === 'NONE'} disabled={!canEdit} name={`limit-${row.rowId}`} onChange={() => updateRow(row.rowId, { limitMode: 'NONE' })} type="radio" />
                  No limit
                </label>
                <label className="customer-choice__option">
                  <input checked={row.limitMode === 'LIMIT'} disabled={!canEdit} name={`limit-${row.rowId}`} onChange={() => updateRow(row.rowId, { limitMode: 'LIMIT' })} type="radio" />
                  At most
                  <input
                    aria-label="Per-token limit in new tokens"
                    className="customer-input customer-input--number"
                    disabled={!canEdit || row.limitMode !== 'LIMIT'}
                    inputMode="decimal"
                    onChange={(event) => updateRow(row.rowId, { limitAmount: redaxCustomerInputValue(event) })}
                    value={row.limitAmount}
                  />
                  new tokens (gross) minted from this old token
                </label>
                {field('limit') !== undefined ? <span className="customer-field__error">{field('limit')}</span> : null}
              </fieldset>
              <div className="customer-actions">
                <button
                  className="customer-btn customer-btn--small"
                  disabled={!canEdit}
                  onClick={() => update({ rows: draft.rows.filter((entry) => entry.rowId !== row.rowId) })}
                  type="button"
                >
                  Remove
                </button>
              </div>
            </fieldset>
          )
        })}
        <button
          className="customer-btn"
          disabled={!canEdit || draft.rows.length >= REDAX_CUSTOMER_MAX_INPUT_ROWS}
          onClick={() => update({ rows: [...draft.rows, emptyRedaxCustomerDraftRow(nextRowId(draft.rows))] })}
          type="button"
        >
          {draft.rows.length === 0 ? 'Add an old token' : 'Add another old token'}
        </button>
        {draft.rows.length >= REDAX_CUSTOMER_MAX_INPUT_ROWS ? <p className="customer-muted">A campaign accepts at most {REDAX_CUSTOMER_MAX_INPUT_ROWS} old tokens.</p> : null}
      </section>

      <section className="customer-card">
        <h3 className="customer-title">Limits and time</h3>
        <fieldset className="customer-choice">
          <legend className="customer-field__label">Total limit for the campaign</legend>
          <label className="customer-choice__option">
            <input checked={draft.totalLimitMode === 'NONE'} disabled={!canEdit} name="total-limit" onChange={() => update({ totalLimitMode: 'NONE' })} type="radio" />
            No limit
          </label>
          <label className="customer-choice__option">
            <input checked={draft.totalLimitMode === 'LIMIT'} disabled={!canEdit} name="total-limit" onChange={() => update({ totalLimitMode: 'LIMIT' })} type="radio" />
            At most
            <input
              aria-label="Total limit in new tokens"
              className="customer-input customer-input--number"
              disabled={!canEdit || draft.totalLimitMode !== 'LIMIT'}
              inputMode="decimal"
              onChange={(event) => update({ totalLimitAmount: redaxCustomerInputValue(event) })}
              value={draft.totalLimitAmount}
            />
            new tokens (gross, including the 1% fee) minted by the whole campaign
          </label>
          {issueFor.has('totalLimit') ? <span className="customer-field__error">{issueFor.get('totalLimit')}</span> : null}
        </fieldset>
        <fieldset className="customer-choice">
          <legend className="customer-field__label">End</legend>
          <label className="customer-choice__option">
            <input checked={draft.endMode === 'NONE'} disabled={!canEdit} name="end" onChange={() => update({ endMode: 'NONE', endUnixSeconds: '', endLocal: '' })} type="radio" />
            No end date
          </label>
          <label className="customer-choice__option">
            <input checked={draft.endMode === 'DATE'} disabled={!canEdit} name="end" onChange={() => update({ endMode: 'DATE' })} type="radio" />
            Ends at
          </label>
          {draft.endMode === 'DATE' ? (
            <div className="customer-end">
              <input
                aria-label="End date and time"
                className="customer-input"
                disabled={!canEdit}
                onChange={(event) => {
                  const value = redaxCustomerInputValue(event)
                  const parsed = parseRedaxHumanDateTime(value, draft.endZone, Date.now())
                  setEndError(parsed.ok ? null : describeRedaxHumanDateTimeRefusal(parsed.refusal))
                  update({
                    endLocal: value,
                    endUnixSeconds: parsed.ok ? parsed.unixSeconds.toString() : '',
                    endZoneName: draft.endZone === 'UTC' ? 'UTC' : redaxDeviceTimeZoneName(),
                  })
                }}
                type="datetime-local"
                value={draft.endLocal}
              />
              <select
                aria-label="Time zone"
                className="customer-input customer-input--short"
                disabled={!canEdit}
                onChange={(event) => {
                  const zone = redaxCustomerInputValue(event) === 'UTC' ? 'UTC' : 'DEVICE'
                  const parsed = parseRedaxHumanDateTime(draft.endLocal, zone, Date.now())
                  setEndError(draft.endLocal === '' || parsed.ok ? null : describeRedaxHumanDateTimeRefusal(parsed.ok ? 'EMPTY' : parsed.refusal))
                  update({
                    endZone: zone,
                    endUnixSeconds: parsed.ok ? parsed.unixSeconds.toString() : '',
                    endZoneName: zone === 'UTC' ? 'UTC' : redaxDeviceTimeZoneName(),
                  })
                }}
                value={draft.endZone}
              >
                <option value="DEVICE">This device ({redaxDeviceTimeZoneName()})</option>
                <option value="UTC">UTC</option>
              </select>
              {draft.endUnixSeconds !== '' ? (
                <span className="customer-field__hint">= {formatRedaxUnixSecondsUtc(BigInt(draft.endUnixSeconds))}. Conversions stop at this time.</span>
              ) : null}
              {endError !== null ? <span className="customer-field__error">{endError}</span> : null}
            </div>
          ) : null}
          {issueFor.has('end') ? <span className="customer-field__error">{issueFor.get('end')}</span> : null}
        </fieldset>
        <p className="customer-muted">Checked against this device’s clock ({new Date(nowMs).toISOString().slice(0, 16).replace('T', ' ')} UTC); Solana checks again.</p>
      </section>

      <section className="customer-card customer-footer">
        {issues !== null && issues.length > 0 ? (
          <p className="customer-field__error">Fix the {issues.length === 1 ? 'item' : `${issues.length} items`} marked above, then review again.</p>
        ) : null}
        <div className="customer-actions">
          <button className="customer-btn" onClick={() => void flush().then(onBack)} type="button">
            Back
          </button>
          <button className="customer-btn customer-btn--primary" disabled={!canEdit || busy !== null || saveState === 'stale'} onClick={() => void handleReview()} type="button">
            {busy === 'review' ? 'Preparing review…' : 'Review setup'}
          </button>
        </div>
      </section>
    </div>
  )
}
