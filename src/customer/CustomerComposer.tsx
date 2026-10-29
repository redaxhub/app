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
//
// A REFUSED REVISION IS CHECKED, NOT ASSUMED. Before the page says "changed elsewhere" it reads
// the draft once: if nothing changed there, the save simply failed and Retry stays offered; if
// the change is exactly this page's own earlier save whose answer was lost, that revision is
// taken and the newer edits are saved on top of it. Only a different change elsewhere is
// reported as one. Unsaved fields always stay on the page.
//
// LEAVING NEVER DROPS THEM SILENTLY. Back (and My campaigns, the app menu, and the reload offered
// after a change elsewhere) saves the newest edits first and leaves only once that save went
// through. Otherwise the page stays, says why, and leaves only if the customer confirms that the
// unsaved changes on it are discarded; Cancel keeps everything. Nothing is kept anywhere else.

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
import { redaxCanonicalJson } from './shared/customerCanonical.js'
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
type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'failed' | 'stale' | 'gone'
/** What a re-read says about a refused revision. */
type StaleCheck = 'adopted' | 'unchanged' | 'changed' | 'unknown'
/** A leave in progress, and next to which control its question is shown. */
type LeaveState = { readonly phase: 'saving' | 'confirm'; readonly at: 'status' | 'footer' } | null
/** Asks the open composer to leave: `proceed` runs once nothing unsaved would be lost silently. */
export type RedaxCustomerComposerLeaveGuard = (proceed: () => void) => void
type MintRead =
  | { readonly mint: string; readonly state: 'reading' }
  | { readonly mint: string; readonly state: 'ok'; readonly decimals: number }
  | { readonly mint: string; readonly state: 'error'; readonly message: string }

const SAVE_DELAY_MS = 1500

/** Shown when a save did not land but nothing changed elsewhere: the edits are still here. */
const SAVE_NOT_LANDED = 'Your latest changes could not be saved just now. They are still on this page — use Retry.'

function editableOf(draft: RedaxCustomerDraftV1): EditableDraft {
  const { logo: _logo, ...rest } = draft
  void _logo
  return rest
}

function sameEditable(left: EditableDraft, right: EditableDraft): boolean {
  try {
    return redaxCanonicalJson(left) === redaxCanonicalJson(right)
  } catch {
    return false
  }
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
  leaveGuard,
}: {
  readonly setupId: string
  readonly canEdit: boolean
  readonly onBack: () => void
  readonly onReview: (setupId: string) => void
  /** Filled while mounted, so the workspace's own navigation leaves through the same check. */
  readonly leaveGuard?: { current: RedaxCustomerComposerLeaveGuard | null }
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
  const [leave, setLeave] = useState<LeaveState>(null)

  const mountedRef = useRef(true)
  const draftRef = useRef<EditableDraft | null>(null)
  const revisionRef = useRef(0)
  const dirtyRef = useRef(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const queueRef = useRef<Promise<void>>(Promise.resolve())
  const lastSaveOkRef = useRef(true)
  const mintGenerationRef = useRef<Record<string, number>>({})
  const setupStateRef = useRef<RedaxCustomerSetupRecordV1['state'] | null>(null)
  // Saves whose outcome is unknown (no answer, or a server-side failure), with the revision they
  // were based on: one of them may have landed even though the page never heard back.
  const uncertainRef = useRef<{ readonly revision: number; readonly snapshots: EditableDraft[] } | null>(null)
  const saveNoticeRef = useRef<string | null>(null)
  const goneRef = useRef(false)
  // Where a leave goes: always the NEWEST request (Back, a header or menu destination), and run at
  // most once. `leaveRef` mirrors `leave` for decisions made between renders.
  const leaveTargetRef = useRef<(() => void) | null>(null)
  const leaveRef = useRef<LeaveState>(null)
  const questionRef = useRef<HTMLDivElement | null>(null)
  const questionCancelRef = useRef<HTMLButtonElement | null>(null)
  // The control that asked to leave (a menu item, Back, a header button): Cancel gives focus back.
  const openerRef = useRef<HTMLElement | null>(null)
  const [asked, setAsked] = useState(0)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      // A page that is gone (closed for a sign-out, a wallet switch, another draft) navigates nowhere.
      leaveTargetRef.current = null
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
        setLoadError(result.code === 'NOT_FOUND' ? 'This draft no longer exists. It may have been deleted.' : result.message)
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

  /**
   * The server refused `expectedRevision`. Read the draft once and say why — never by guessing,
   * and never by writing over anything.
   */
  const checkStaleRefusal = useCallback(
    async (expectedRevision: number): Promise<{ readonly check: StaleCheck; readonly setup: RedaxCustomerSetupRecordV1 | null }> => {
      const latest = await api.getSetup(setupId)
      if (!latest.ok || latest.setup.id !== setupId || latest.setup.owner !== wallet) {
        return { check: 'unknown', setup: null }
      }
      if (latest.setup.revision === expectedRevision) {
        // Nothing changed there: the save did not land, and nobody else's edit is in the way.
        return { check: 'unchanged', setup: null }
      }
      const uncertain = uncertainRef.current
      const editable = editableOf(latest.setup.draft)
      if (
        uncertain !== null &&
        uncertain.revision === expectedRevision &&
        latest.setup.revision === expectedRevision + 1 &&
        latest.setup.state === 'DRAFT' &&
        uncertain.snapshots.some((snapshot) => sameEditable(snapshot, editable))
      ) {
        // Exactly one of this page's own unanswered saves, and nothing after it: take it.
        return accept(latest.setup) ? { check: 'adopted', setup: latest.setup } : { check: 'unknown', setup: null }
      }
      return { check: 'changed', setup: null }
    },
    [accept, api, setupId, wallet],
  )

  const flush = useCallback(async (): Promise<boolean> => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    const run = queueRef.current.then(async () => {
      if (!dirtyRef.current || draftRef.current === null || goneRef.current) {
        return
      }
      dirtyRef.current = false
      const snapshot = draftRef.current
      setSaveState('saving')
      // A published-but-never-created plan may be reopened for editing; its public files stay.
      let reopen = setupStateRef.current === 'PUBLISHED'
      // The revision the request IN FLIGHT was sent with. Each request below carries its own, and
      // an unanswered one is remembered with exactly that revision — never an earlier request's.
      let sentRevision = revisionRef.current
      let result = await api.saveSetup({ id: setupId, expectedRevision: sentRevision, draft: snapshot, reopen })
      if (!mountedRef.current) {
        return
      }
      let check: StaleCheck | null = null
      // Bounded: a further round needs a further own unanswered save to be recognized.
      for (let round = 0; round < 3 && !result.ok && result.code === 'STALE_REVISION'; round += 1) {
        const settled = await checkStaleRefusal(sentRevision)
        if (!mountedRef.current) {
          return
        }
        check = settled.check
        if (settled.setup === null) {
          break
        }
        // Adopted: that save landed. Only the snapshot itself is left to write, if it differs.
        if (sameEditable(snapshot, editableOf(settled.setup.draft))) {
          // It already holds exactly this snapshot: nothing left to write.
          result = { ok: true, setup: settled.setup }
          break
        }
        reopen = false
        sentRevision = revisionRef.current
        result = await api.saveSetup({ id: setupId, expectedRevision: sentRevision, draft: snapshot, reopen })
        if (!mountedRef.current) {
          return
        }
        check = null
      }
      if (result.ok) {
        accept(result.setup)
        uncertainRef.current = null
        lastSaveOkRef.current = true
        const shown = saveNoticeRef.current
        if (shown !== null) {
          // The failure this page reported is over; other notices stay.
          saveNoticeRef.current = null
          setNotice((current) => (current === shown ? null : current))
        }
        setSaveState(dirtyRef.current ? 'dirty' : 'saved')
        if (!dirtyRef.current && leaveRef.current?.phase === 'confirm') {
          // Nothing is unsaved any more: the question is moot. Back now leaves at once.
          leaveTargetRef.current = null
          leaveRef.current = null
          setLeave(null)
        }
        return
      }
      lastSaveOkRef.current = false
      if (result.code === 'NOT_FOUND') {
        // The draft was deleted (in another tab or browser). Nothing is saved from here again.
        goneRef.current = true
        setSaveState('gone')
        setNotice('This draft was deleted, so these changes cannot be saved.')
        return
      }
      dirtyRef.current = true
      if (result.code === 'NETWORK' || result.code === 'STORE_UNAVAILABLE' || result.code === 'INTERNAL' || result.status >= 500) {
        // No answer, or a server-side failure: this snapshot may or may not have landed.
        const uncertain = uncertainRef.current
        uncertainRef.current = {
          revision: sentRevision,
          snapshots: [...(uncertain !== null && uncertain.revision === sentRevision ? uncertain.snapshots : []), snapshot].slice(-8),
        }
      }
      if (result.code === 'STALE_REVISION' && check === 'changed') {
        setSaveState('stale')
        return
      }
      const message = result.code === 'STALE_REVISION' ? SAVE_NOT_LANDED : result.message
      saveNoticeRef.current = message
      setNotice(message)
      setSaveState('failed')
    })
    queueRef.current = run.catch(() => undefined)
    await run
    return !dirtyRef.current && lastSaveOkRef.current
  }, [accept, api, checkStaleRefusal, setupId])

  const showLeave = useCallback((next: LeaveState): void => {
    leaveRef.current = next
    setLeave(next)
  }, [])

  /** Save first; go to the newest destination only if that went through, otherwise ask. */
  const runLeave = useCallback(
    async (at: 'status' | 'footer'): Promise<void> => {
      showLeave({ phase: 'saving', at })
      let saved = await flush()
      // Edits typed while that save was in flight are saved too (possibly by an autosave already
      // queued, which the next flush waits for) — a bounded number of times, and never after a failure.
      for (let round = 0; !saved && round < 2 && lastSaveOkRef.current && !goneRef.current && mountedRef.current; round += 1) {
        saved = await flush()
      }
      if (!mountedRef.current) {
        return
      }
      if (saved) {
        const proceed = leaveTargetRef.current
        leaveTargetRef.current = null
        showLeave(null)
        proceed?.()
        return
      }
      showLeave({ phase: 'confirm', at })
      setAsked((count) => count + 1)
    },
    [flush, showLeave],
  )

  /**
   * One leave at a time, and the NEWEST request is its destination: a request while it saves
   * only changes where it goes; a request while it asks only changes that and shows the
   * question again — neither starts another save.
   */
  const requestLeave = useCallback(
    (proceed: () => void, at: 'status' | 'footer'): void => {
      leaveTargetRef.current = proceed
      openerRef.current = typeof document === 'undefined' ? null : (document.activeElement as HTMLElement | null)
      const current = leaveRef.current
      if (current?.phase === 'saving') {
        return
      }
      if (current?.phase === 'confirm') {
        setAsked((count) => count + 1)
        return
      }
      void runLeave(at)
    },
    [runLeave],
  )

  useEffect(() => {
    if (leaveGuard === undefined) {
      return
    }
    const guard: RedaxCustomerComposerLeaveGuard = (proceed) => requestLeave(proceed, 'status')
    leaveGuard.current = guard
    return () => {
      if (leaveGuard.current === guard) {
        leaveGuard.current = null
      }
    }
  }, [leaveGuard, requestLeave])

  // The question is brought into view and focused where it was asked from — on a phone the menu
  // that was tapped is far above it.
  useEffect(() => {
    if (asked === 0) {
      return
    }
    questionRef.current?.scrollIntoView?.({ block: 'center' })
    questionCancelRef.current?.focus?.({ preventScroll: true })
  }, [asked])

  function cancelLeave(): void {
    const opener = openerRef.current
    openerRef.current = null
    leaveTargetRef.current = null
    showLeave(null)
    // After the re-render, so a control disabled while asking is enabled again.
    setTimeout(() => opener?.focus?.(), 0)
  }

  function leaveWithoutSaving(): void {
    const proceed = leaveTargetRef.current
    leaveTargetRef.current = null
    showLeave(null)
    proceed?.()
  }

  const update = useCallback(
    (patch: Partial<EditableDraft>): void => {
      if (!canEdit || draftRef.current === null || goneRef.current) {
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
            : saveState === 'gone'
              ? 'Deleted'
              : 'Saved'
  const nowMs = Date.now()
  const leaveQuestion = (at: 'status' | 'footer') =>
    leave !== null && leave.phase === 'confirm' && leave.at === at ? (
      <div className="customer-notice customer-notice--caution" ref={questionRef} role="alertdialog" aria-label="Leave without saving?">
        <p>
          <strong>Leave without saving?</strong>
        </p>
        <p>
          {saveState === 'stale'
            ? 'This draft was changed in another tab or browser, so the changes on this page were not saved.'
            : saveState === 'gone'
              ? 'This draft was deleted, so the changes on this page cannot be saved.'
              : saveState === 'failed'
                ? 'Your latest changes could not be saved.'
                : 'Your latest changes are not saved yet.'}{' '}
          If you leave now, the changes on this page that are not saved are discarded.
        </p>
        <div className="customer-actions">
          <button className="customer-btn" onClick={cancelLeave} ref={questionCancelRef} type="button">
            Cancel
          </button>
          {saveState !== 'stale' && saveState !== 'gone' ? (
            <button
              className="customer-btn"
              onClick={() => {
                if (leaveTargetRef.current !== null) {
                  void runLeave(at)
                }
              }}
              type="button"
            >
              {saveState === 'failed' ? 'Retry and leave' : 'Save and leave'}
            </button>
          ) : null}
          <button className="customer-btn" onClick={leaveWithoutSaving} type="button">
            Leave without saving
          </button>
        </div>
      </div>
    ) : null

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
            <button className="customer-btn" disabled={leave !== null} onClick={() => requestLeave(onBack, 'status')} type="button">
              Reload from My campaigns
            </button>
          </p>
        ) : null}
        {leaveQuestion('status')}
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
        {leaveQuestion('footer')}
        <div className="customer-actions">
          <button className="customer-btn" disabled={leave !== null} onClick={() => requestLeave(onBack, 'footer')} type="button">
            {leave?.phase === 'saving' && leave.at === 'footer' ? 'Saving…' : 'Back'}
          </button>
          <button
            className="customer-btn customer-btn--primary"
            disabled={!canEdit || busy !== null || saveState === 'stale' || saveState === 'gone'}
            onClick={() => void handleReview()}
            type="button"
          >
            {busy === 'review' ? 'Preparing review…' : 'Review setup'}
          </button>
        </div>
      </section>
    </div>
  )
}
