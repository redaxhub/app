// REDAX customer service — the browser's session state, and the gate in front of every private view.
//
// LAZY. Nothing here talks to the service until the Team workspace is opened (`activate`), so a
// holder browsing campaigns never costs the service a request and never depends on it.
//
// THE PRIVATE GATE IS DECIDED DURING RENDER. `privateOpen` is true only when the service says
// this browser is signed in AND the wallet connected right now is exactly the signed-in wallet.
// It is computed from the current render's values, not set by an effect, so the very first
// render after a wallet switch, a disconnect or a sign-out already shows nothing private.
//
// EVERY IDENTITY CHANGE IS A NEW EPOCH. Sign-in, sign-out, a different wallet answering `/me`,
// and another tab's sign-in noticed on the next `/me` read all advance `epoch`. The workspace is keyed by it, so
// everything held in memory for the previous identity — reviews, approvals, previews, pending
// reads — is discarded, and nothing returns if the same wallet comes back.
//
// THE LIVE SESSION IS READABLE SYNCHRONOUSLY. `readLive()` answers from the state this tab
// applied last — sign-in, sign-out, a `/me` read with a changed grant — and from the wallet
// connected in the latest render, not from a render that may still be pending. A chain-write
// admission whose answer arrives after any of those changed asks it again and admits nothing
// (see `customerTeamWrites.ts`). It knows only what this tab has observed: a grant change the
// tab has not read yet is decided by the server's own check on the next request.
//
// SIGN-OUT IS LOCAL FIRST. When Sign out is clicked — before anything is awaited — this tab
// forgets the session: `readLive()` answers `null` at once, the private view closes on the next
// render and every read still in flight is void. Only then is the server asked to end the
// session, and its answer can reopen nothing. A session this tab has ended is never reopened by
// a later automatic `/me` read either (focus, pageshow, a late answer) — only an explicit new
// sign-in opens a session again. If the server's answer does not confirm the sign-out — the
// request may never have arrived, or its answer may have been lost after the server ended the
// session — the tab says the server sign-out is unconfirmed, without claiming either outcome.
// Sign-in and sign-out of one tab run one after the other, so an older sign-out's answer can never
// clear the cookie of a newer session, and a sign-out asked for during a sign-in ends whatever
// session that sign-in created.
//
// AN AUTH OUTCOME IS THE NEWEST CONTEXT. Applying the outcome of a sign-in or sign-out voids every
// read that began before it — also one that began while the sign-in was on its way (a focus
// re-read while the wallet was asked). A `/me` answer from that earlier context can then neither
// close the new session nor reopen an ended one; a read that begins afterwards is current again.
//
// TWO TABS SHARE ONE COOKIE. Every tab re-reads `/me` when it becomes visible or regains
// focus, and whenever the server answers that the session is gone or changed; the server also
// refuses any write that echoes a different session id, so a stale tab cannot write into the
// session another tab created. No cross-tab channel and no storage listener is used — the fresh
// `/me` read is the invalidation — and no login token is ever stored in JavaScript.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useRedaxCustomerSignInBroker, useRedaxWallet } from '../wallet/RedaxWalletProvider'
import { createRedaxCustomerApiClient, redaxCustomerBase64, type RedaxCustomerApiClient } from './customerApi'
import type { RedaxCustomerLiveSession } from './customerTeamWrites'
import type { RedaxCustomerMe, RedaxCustomerServiceConfigView } from './shared/customerContract.js'

export type RedaxCustomerSessionState =
  | { readonly status: 'idle' }
  | { readonly status: 'loading' }
  | { readonly status: 'unavailable'; readonly message: string }
  | { readonly status: 'signed-out'; readonly config: RedaxCustomerServiceConfigView; readonly notice: string | null }
  | { readonly status: 'no-access'; readonly config: RedaxCustomerServiceConfigView; readonly wallet: string }
  | { readonly status: 'signed-in'; readonly config: RedaxCustomerServiceConfigView; readonly me: RedaxCustomerMe }

export interface RedaxCustomerSessionValue {
  readonly state: RedaxCustomerSessionState
  readonly epoch: number
  readonly api: RedaxCustomerApiClient
  readonly connectedWallet: string | null
  readonly canSignIn: boolean
  readonly signingIn: boolean
  /** Signed in, AND the connected wallet is exactly the session wallet — decided this render. */
  readonly privateOpen: boolean
  /** The session wallet whenever `privateOpen`, else `null`. The only positive Team identity. */
  readonly teamWallet: string | null
  /** The open private session as this tab knows it at this instant, or `null`. Synchronous. */
  readonly readLive: () => RedaxCustomerLiveSession | null
  activate(): void
  signIn(): Promise<void>
  signOut(): Promise<void>
  refresh(): Promise<void>
}

/** A tab that becomes visible or focused re-reads `/me` at most this often. */
const FOCUS_REFRESH_MIN_MS = 5_000

const SIGN_OUT_UNCONFIRMED =
  'You are signed out in this tab. We could not confirm the server sign-out, so your server session may remain active until it expires. Other open tabs may still show an earlier sign-in until they refresh.'

const INERT_API = createRedaxCustomerApiClient({ sessionId: () => null })

const RedaxCustomerSessionContext = createContext<RedaxCustomerSessionValue>({
  state: { status: 'idle' },
  epoch: 0,
  api: INERT_API,
  connectedWallet: null,
  canSignIn: false,
  signingIn: false,
  privateOpen: false,
  teamWallet: null,
  readLive: () => null,
  activate: () => undefined,
  signIn: async () => undefined,
  signOut: async () => undefined,
  refresh: async () => undefined,
})

export function useRedaxCustomerSession(): RedaxCustomerSessionValue {
  return useContext(RedaxCustomerSessionContext)
}

/** Pure: may this render show private data? */
export function isRedaxCustomerPrivateOpen(state: RedaxCustomerSessionState, connectedWallet: string | null): boolean {
  return state.status === 'signed-in' && connectedWallet !== null && state.me.wallet === connectedWallet
}

/** Pure: the live session a chain-write admission may still act for, or `null`. */
export function redaxCustomerLiveSessionOf(state: RedaxCustomerSessionState, connectedWallet: string | null): RedaxCustomerLiveSession | null {
  if (state.status !== 'signed-in' || !isRedaxCustomerPrivateOpen(state, connectedWallet)) {
    return null
  }
  return { sessionId: state.me.sessionId, wallet: state.me.wallet, permissions: state.me.permissions }
}

export function RedaxCustomerSessionProvider({
  children,
  api: injectedApi,
}: {
  readonly children?: ReactNode
  /** Injected in tests; production builds its own same-origin client. */
  readonly api?: RedaxCustomerApiClient
}) {
  const wallet = useRedaxWallet()
  const broker = useRedaxCustomerSignInBroker()
  const connectedWallet = wallet.status === 'connected' ? wallet.publicKeyBase58 : null

  const [state, setState] = useState<RedaxCustomerSessionState>({ status: 'idle' })
  const [epoch, setEpoch] = useState(0)
  const [signingIn, setSigningIn] = useState(false)
  const sessionIdRef = useRef<string | null>(null)
  const stateRef = useRef<RedaxCustomerSessionState>(state)
  stateRef.current = state
  const connectedWalletRef = useRef<string | null>(connectedWallet)
  connectedWalletRef.current = connectedWallet
  const activeRef = useRef(false)
  const readGenerationRef = useRef(0)
  const lastFocusReadRef = useRef(0)
  const refreshRef = useRef<() => void>(() => undefined)
  // Sessions this tab has signed out of. A `/me` answer naming one of them is not a session here.
  const endedSessionsRef = useRef<Set<string>>(new Set())
  // Advanced by every sign-in and sign-out: an older one's late answer then changes nothing.
  const authSequenceRef = useRef(0)
  // This tab's sign-in and sign-out network steps, strictly one after the other: each answer's
  // cookie change lands before the next step starts, so none can clear a newer session's cookie.
  const authChainRef = useRef<Promise<void>>(Promise.resolve())

  const api = useMemo(
    () =>
      injectedApi ??
      createRedaxCustomerApiClient({
        sessionId: () => sessionIdRef.current,
        // The server says the session is gone or belongs to another tab's sign-in: re-read.
        onSessionLost: () => refreshRef.current(),
      }),
    [injectedApi],
  )

  /** Apply a new state; advance the epoch whenever the signed-in identity changes. */
  const apply = useCallback((next: RedaxCustomerSessionState) => {
    const previous = stateRef.current
    const previousId = previous.status === 'signed-in' ? `${previous.me.wallet}:${previous.me.sessionId}` : null
    const nextId = next.status === 'signed-in' ? `${next.me.wallet}:${next.me.sessionId}` : null
    sessionIdRef.current = next.status === 'signed-in' ? next.me.sessionId : null
    stateRef.current = next
    setState(next)
    if (previousId !== nextId) {
      setEpoch((value) => value + 1)
    }
  }, [])

  const refresh = useCallback(async (): Promise<void> => {
    const generation = readGenerationRef.current + 1
    readGenerationRef.current = generation
    const current = stateRef.current
    const configResult =
      current.status === 'signed-in' || current.status === 'signed-out' || current.status === 'no-access'
        ? { ok: true as const, config: current.config }
        : await api.config()
    if (generation !== readGenerationRef.current) {
      return
    }
    if (!configResult.ok) {
      apply({ status: 'unavailable', message: configResult.message })
      return
    }
    const config = configResult.config
    if (!config.configured) {
      apply({ status: 'unavailable', message: 'The REDAX customer service is not configured on this deployment yet.' })
      return
    }
    const me = await api.me()
    if (generation !== readGenerationRef.current) {
      return
    }
    if (me.ok && endedSessionsRef.current.has(me.me.sessionId)) {
      // The server still knows a session this tab signed out of (its sign-out has not reached
      // the server yet, or could not). It is not reopened by a read; a new sign-in is needed.
      const keep = stateRef.current
      apply(keep.status === 'signed-out' || keep.status === 'no-access' ? keep : { status: 'signed-out', config, notice: null })
    } else if (me.ok) {
      apply({ status: 'signed-in', config, me: me.me })
    } else if (me.code === 'NOT_SIGNED_IN') {
      // No session: a view that is already signed out stays exactly as it is, notice included —
      // a read never erases what the last sign-in or sign-out told the customer.
      const keep = stateRef.current
      apply(keep.status === 'signed-out' || keep.status === 'no-access' ? keep : { status: 'signed-out', config, notice: null })
    } else {
      apply({ status: 'unavailable', message: me.message })
    }
  }, [api, apply])

  refreshRef.current = () => {
    if (activeRef.current) {
      void refresh()
    }
  }

  const activate = useCallback(() => {
    if (activeRef.current) {
      return
    }
    activeRef.current = true
    apply({ status: 'loading' })
    void refresh()
  }, [apply, refresh])

  // Visibility and focus revalidation — only once the workspace has been opened.
  useEffect(() => {
    type Target = {
      addEventListener?: (name: string, listener: () => void) => void
      removeEventListener?: (name: string, listener: () => void) => void
    }
    const target = globalThis as unknown as Target
    const page = (globalThis as unknown as { document?: Target & { visibilityState?: string } }).document
    const onFocus = (): void => {
      if (!activeRef.current || page?.visibilityState === 'hidden') {
        return
      }
      const now = Date.now()
      if (now - lastFocusReadRef.current < FOCUS_REFRESH_MIN_MS) {
        return
      }
      lastFocusReadRef.current = now
      void refresh()
    }
    target.addEventListener?.('focus', onFocus)
    target.addEventListener?.('pageshow', onFocus)
    page?.addEventListener?.('visibilitychange', onFocus)
    return () => {
      target.removeEventListener?.('focus', onFocus)
      target.removeEventListener?.('pageshow', onFocus)
      page?.removeEventListener?.('visibilitychange', onFocus)
    }
  }, [refresh])

  /** Apply an auth action's outcome as the newest context: every read that began before now is void. */
  const applyAuthOutcome = useCallback(
    (next: RedaxCustomerSessionState) => {
      readGenerationRef.current += 1
      apply(next)
    },
    [apply],
  )

  /** The server half of a sign-out, queued behind this tab's earlier auth steps. `true` only if the server confirmed it. */
  const endOnServer = useCallback((): Promise<boolean> => {
    const done = authChainRef.current.then(async () => {
      try {
        return (await api.logout()).ok
      } catch {
        return false
      }
    })
    authChainRef.current = done.then(() => undefined)
    return done
  }, [api])

  const signOut = useCallback(async (): Promise<void> => {
    const current = stateRef.current
    const config = current.status === 'signed-in' || current.status === 'signed-out' || current.status === 'no-access' ? current.config : null
    // LOCAL FIRST, before any await: from this line on nothing in this tab acts for the session.
    readGenerationRef.current += 1
    authSequenceRef.current += 1
    const sequence = authSequenceRef.current
    if (current.status === 'signed-in') {
      endedSessionsRef.current.add(current.me.sessionId)
    }
    if (config !== null) {
      apply({ status: 'signed-out', config, notice: null })
    } else {
      apply({ status: 'idle' })
      activeRef.current = false
    }
    const confirmed = await endOnServer()
    if (config !== null && !confirmed && sequence === authSequenceRef.current) {
      applyAuthOutcome({ status: 'signed-out', config, notice: SIGN_OUT_UNCONFIRMED })
    }
  }, [apply, applyAuthOutcome, endOnServer])

  const signIn = useCallback(async (): Promise<void> => {
    const current = stateRef.current
    if (signingIn || (current.status !== 'signed-out' && current.status !== 'no-access' && current.status !== 'signed-in')) {
      return
    }
    const config = current.config
    const address = broker.publicKeyBase58
    if (!broker.isConnected || !broker.canSignIn || address === null || address !== connectedWallet) {
      apply({ status: 'signed-out', config, notice: 'Connect a wallet that supports Sign In With Solana (for example Phantom), then try again.' })
      return
    }
    setSigningIn(true)
    readGenerationRef.current += 1
    authSequenceRef.current += 1
    const sequence = authSequenceRef.current
    // A sign-out asked for while this sign-in is on its way wins: nothing below is applied then.
    const superseded = (): boolean => sequence !== authSequenceRef.current
    if (current.status === 'signed-in') {
      // A different wallet is signing in: the previous session ends first — in this tab at
      // once, then on the server.
      endedSessionsRef.current.add(current.me.sessionId)
      apply({ status: 'signed-out', config, notice: null })
      void endOnServer()
    }
    // This sign-in holds the tab's auth chain until it ends: a sign-out still on its way finishes
    // first, and a sign-out asked for meanwhile reaches the server only afterwards — with the
    // cookie this sign-in did or did not receive.
    const previous = authChainRef.current
    let release!: () => void
    authChainRef.current = new Promise<void>((resolveChain) => {
      release = resolveChain
    })
    try {
      await previous
      if (superseded()) {
        return
      }
      const challenge = await api.challenge(address)
      if (superseded()) {
        return
      }
      if (!challenge.ok) {
        applyAuthOutcome({ status: 'signed-out', config, notice: challenge.message })
        return
      }
      let output: { readonly address: string; readonly signedMessage: Uint8Array; readonly signature: Uint8Array }
      try {
        output = await broker.signInWithRedaxChallenge(challenge.input)
      } catch {
        if (!superseded()) {
          applyAuthOutcome({ status: 'signed-out', config, notice: 'The sign-in message was not signed. Nothing was sent; you can try again.' })
        }
        return
      }
      if (superseded()) {
        return
      }
      if (output.address !== address) {
        applyAuthOutcome({ status: 'signed-out', config, notice: 'The wallet changed during sign-in. Please sign in again.' })
        return
      }
      const verified = await api.verify({
        address,
        signedMessage: redaxCustomerBase64(output.signedMessage),
        signature: redaxCustomerBase64(output.signature),
      })
      if (superseded()) {
        // Signed out meanwhile. Nothing is opened, and the sign-out queued behind this sign-in
        // ends the session it may have created.
        if (verified.ok && verified.access === 'GRANTED') {
          endedSessionsRef.current.add(verified.me.sessionId)
        }
        return
      }
      if (!verified.ok) {
        applyAuthOutcome({ status: 'signed-out', config, notice: verified.message })
        return
      }
      // The new session is the newest context: a read that began before this line — including
      // one started while the wallet was being asked — no longer applies.
      if (verified.access === 'NONE') {
        applyAuthOutcome({ status: 'no-access', config, wallet: verified.wallet })
      } else {
        applyAuthOutcome({ status: 'signed-in', config, me: verified.me })
      }
    } finally {
      release()
      setSigningIn(false)
    }
  }, [api, apply, applyAuthOutcome, broker, connectedWallet, endOnServer, signingIn])

  const privateOpen = isRedaxCustomerPrivateOpen(state, connectedWallet)
  const teamWallet = privateOpen && state.status === 'signed-in' ? state.me.wallet : null
  const readLive = useCallback(() => redaxCustomerLiveSessionOf(stateRef.current, connectedWalletRef.current), [])

  const value = useMemo<RedaxCustomerSessionValue>(
    () => ({
      state,
      epoch,
      api,
      connectedWallet,
      canSignIn: broker.isConnected && broker.canSignIn,
      signingIn,
      privateOpen,
      teamWallet,
      readLive,
      activate,
      signIn,
      signOut,
      refresh,
    }),
    [activate, api, broker.canSignIn, broker.isConnected, connectedWallet, epoch, privateOpen, readLive, refresh, signIn, signOut, signingIn, state, teamWallet],
  )

  return <RedaxCustomerSessionContext.Provider value={value}>{children}</RedaxCustomerSessionContext.Provider>
}
