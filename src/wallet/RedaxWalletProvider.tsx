// REDAX wallet provider — the app-owned Wallet Standard discovery/connection
// shell for the wallet-enabled modes. App mounts this provider in the modes it
// selects as wallet-enabled; MOCK_LOCAL and DEVNET_READONLY never mount it, so no
// wallet discovery runs there.
//
// Boundary discipline:
//  - Discovery uses useStandardWalletAdapters([]) — discovered Wallet Standard
//    wallets only; no aggregate wallet list, no legacy per-wallet adapter
//    package, and no wallet-adapter-react/react-ui dependency.
//  - Raw adapters stay private in this module. The public context exposes only
//    the narrow RedaxWalletContextValue facade — connection state plus
//    user-initiated connect/disconnect. It gains no sign, send or transaction
//    member of any kind.
//  - No auto-connect, no persistence (nothing is written to localStorage),
//    no RPC, no env read. Connection happens only when the UI calls
//    connect(walletName); disconnection only via disconnect().
//  - Error copy is fixed and value-free: adapter error class names map to
//    fixed strings, and wallet-provided raw messages are never echoed.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { WalletReadyState } from '@solana/wallet-adapter-base'
import type { Adapter } from '@solana/wallet-adapter-base'
import { PublicKey } from '@solana/web3.js'
import type { Transaction } from '@solana/web3.js'
import { useStandardWalletAdapters } from '@solana/wallet-standard-wallet-adapter-react'
import type {
  RedaxWalletContextValue,
  RedaxWalletOptionView,
  RedaxWalletReadyState,
  RedaxWalletStatus,
} from './redaxWalletTypes'

const SHORT_KEY_HEAD = 4
const SHORT_KEY_TAIL = 4

// Fixed, value-free copy per adapter error class name. Raw wallet-provided
// messages are never rendered; unknown names fall back to the generic line.
const WALLET_ERROR_COPY: Record<string, string> = {
  WalletConnectionError: 'The wallet did not complete the connection request.',
  WalletWindowClosedError: 'The wallet window was closed before the connection completed.',
  WalletWindowBlockedError: 'The wallet window was blocked by the browser.',
  WalletNotReadyError: 'The selected wallet is not ready to connect in this browser.',
  WalletDisconnectionError: 'The wallet did not disconnect cleanly.',
  WalletDisconnectedError: 'The wallet disconnected.',
  WalletTimeoutError: 'The wallet request timed out.',
  WalletAccountError: 'The wallet could not provide an account for this connection.',
  WalletPublicKeyError: 'The wallet could not provide a public key.',
}

const GENERIC_WALLET_ERROR_COPY =
  'The wallet reported an error and no wallet action completed.'

function safeWalletErrorCopy(errorName: string | undefined): string {
  if (errorName !== undefined && WALLET_ERROR_COPY[errorName] !== undefined) {
    return WALLET_ERROR_COPY[errorName]
  }
  return GENERIC_WALLET_ERROR_COPY
}

function toRedaxReadyState(readyState: WalletReadyState): RedaxWalletReadyState {
  switch (readyState) {
    case WalletReadyState.Installed:
      return 'installed'
    case WalletReadyState.Loadable:
      return 'loadable'
    case WalletReadyState.Unsupported:
      return 'unsupported'
    default:
      return 'not-detected'
  }
}

function isConnectableReadyState(readyState: WalletReadyState): boolean {
  return readyState === WalletReadyState.Installed || readyState === WalletReadyState.Loadable
}

function toShortPublicKey(publicKeyBase58: string | null): string | null {
  if (publicKeyBase58 === null) {
    return null
  }
  if (publicKeyBase58.length <= SHORT_KEY_HEAD + SHORT_KEY_TAIL + 1) {
    return publicKeyBase58
  }
  return `${publicKeyBase58.slice(0, SHORT_KEY_HEAD)}…${publicKeyBase58.slice(-SHORT_KEY_TAIL)}`
}

// Inert default so useRedaxWallet stays total outside DEVNET_WALLET_READONLY:
// isWalletMode false, nothing detected, and deliberate no-op actions (never a
// throw). Chrome renders nothing from this value.
const INERT_REDAX_WALLET_CONTEXT: RedaxWalletContextValue = {
  isWalletMode: false,
  walletsDetected: false,
  wallets: [],
  selectedWalletName: null,
  status: 'no-wallet',
  publicKeyBase58: null,
  shortPublicKey: null,
  errorMessage: null,
  async connect() {
    // No provider mounted (not DEVNET_WALLET_READONLY): nothing to connect.
  },
  async disconnect() {
    // No provider mounted: nothing to disconnect.
  },
}

const RedaxWalletContext = createContext<RedaxWalletContextValue>(INERT_REDAX_WALLET_CONTEXT)

/** The narrow REDAX wallet facade. Total: inert outside the provider. */
export function useRedaxWallet(): RedaxWalletContextValue {
  return useContext(RedaxWalletContext)
}

// --- INTERNAL/GATED wallet action transport --------------------------------
//
// A deliberately minimal, private transport slice for the REDAX wallet action
// bridge ONLY (app/src/wallet/RedaxWalletActions.tsx). It exposes the connected
// public key, an immediately-evaluated CURRENT key read, and a SIGN-ONLY
// capability — NEVER the raw adapter, and never the adapter's own bound signer as
// a separate value. This is intentionally NOT part of the public
// `RedaxWalletContextValue` connection facade above, and screens/chrome must never
// import `useRedaxWalletActionTransport`.
//
// SIGN ONLY. This transport CANNOT broadcast. It has no `sendTransaction`, no
// `signAndSendTransaction`, and no fallback to either: a wallet that will not sign
// on its own is a wallet this transport reports as incapable, never one it asks to
// broadcast instead. Broadcasting is the action bridge's own raw-send, performed on
// the attempt's own `Connection` with bytes the bridge has already verified.
//
// A NARROW WALLET BROKER, AND NOTHING MORE. This module performs exactly one
// mechanical serialization of the foreign signed value and returns SIGNED BYTES. It
// never returns a `Transaction`, a wallet object, an adapter, a commitment or a
// security verdict; it compares nothing, verifies nothing, journals nothing, caches
// nothing and logs nothing. Every question about what those bytes MEAN belongs to
// RedaxWalletActions.tsx, which is the sole transaction-security authority.
//
// WHY A LIVE READ EXISTS AT ALL. `publicKey` below is a SNAPSHOT, memoized on
// connection changes. A pre-sign identity check that compared that snapshot against
// a baseline captured from the same snapshot would be comparing a value to itself,
// and an in-flight account switch on the SAME adapter object — which changes
// `adapter.publicKey` without changing connection status — would be invisible to
// it. `readCurrentPublicKey()` therefore re-reads the private adapter ref at CALL
// time so the caller's immediately-before-invocation check has something live to
// compare against.

/** Minimal, gated transport exposed only to the REDAX action bridge. */
export interface RedaxWalletActionTransport {
  /** True only when a wallet is connected with a public key under a mounted provider. */
  readonly isConnected: boolean
  /**
   * True only when the connected wallet actually advertises a usable sign-only
   * capability that this transport was able to acquire structurally.
   *
   * A capability signal, never an authorization: it says the prompt CAN be opened,
   * not that anything may be signed or sent. When it is false the action bridge
   * refuses BEFORE any wallet prompt, and there is deliberately nothing to fall back
   * to — falling back to a wallet-performed broadcast is exactly the contract this
   * architecture replaced.
   */
  readonly canSignOnly: boolean
  /**
   * The connected wallet public key as captured when this transport instance was
   * built — the attempt's INITIAL wallet identity. A snapshot, deliberately: it is
   * the value an attempt is approved against, and it must not move underneath one.
   */
  readonly publicKey: PublicKey | null
  /**
   * The adapter's public key RIGHT NOW, evaluated on every call.
   *
   * Returns null — never a stale value and never the adapter — when the active
   * adapter is no longer the exact adapter this transport instance captured, when
   * it is no longer connected, or when it has no current key. The returned value is
   * a freshly constructed `PublicKey` of this module's own package instance, so a
   * caller can neither reach the adapter's object through it nor be defeated by a
   * duplicated package copy.
   */
  readCurrentPublicKey(): PublicKey | null
  /**
   * Ask the connected wallet to SIGN one legacy transaction, and return the signed
   * transaction BYTES. FAIL-CLOSED on identity drift and on any hostile shape.
   *
   * Immediately before the underlying adapter invocation it re-verifies that the
   * active adapter is still the exact adapter this transport captured, that it is
   * still connected, and that its current key still equals the approved initial
   * key. Any difference — and any absent sign-only capability — rejects with one
   * fixed, value-free internal error and the adapter is never invoked.
   *
   * The wallet's return value is UNTRUSTED FOREIGN DATA. It is never checked by
   * `instanceof`, by constructor identity or by prototype identity: this repository
   * really does resolve duplicate `@solana/web3.js` copies, so nominal typing here
   * would be a guess. Exactly one serialization is performed, through protected
   * structural access, and its result is copied into memory REDAX owns. A throwing
   * getter, a throwing method or a malformed result is unavailability, never an
   * escaping exception and never a partially trusted value.
   *
   * The returned bytes are NOT retained here: no cache, no storage, no log.
   */
  signLegacyTransactionBytes(transaction: Transaction): Promise<Uint8Array>
}

/** The one fixed, value-free rejection this transport ever raises. */
const REDAX_WALLET_ACTION_TRANSPORT_UNAVAILABLE = 'REDAX_WALLET_ACTION_TRANSPORT_UNAVAILABLE'

/**
 * Read one property of the EXTERNAL adapter object structurally.
 *
 * Every read below goes through this. An adapter is third-party code registered on
 * the page by a browser extension, and any of its properties may be an accessor that
 * throws — `connected`, `publicKey`, even `signTransaction`. A plain `adapter.x` would
 * then raise inside the transport factory or inside the pre-send identity check, and
 * the raw hostile value would escape past the declared contract: as a React render
 * error, or as a rejection the action bridge would have to classify. Consulted this
 * way, a throwing accessor is simply UNAVAILABILITY.
 *
 * `Reflect.get` rather than `instanceof` or optional chaining, because neither of
 * those protects against a throwing getter, and this repository really does resolve
 * duplicate `@solana/web3.js` copies so nominal checks are unreliable anyway.
 */
function readAdapterProperty(source: unknown, key: string): { ok: true; value: unknown } | { ok: false } {
  if (typeof source !== 'object' || source === null) {
    return { ok: false }
  }
  try {
    return { ok: true, value: Reflect.get(source, key) }
  } catch {
    return { ok: false }
  }
}

/** The adapter's `connected` flag, or `false` when it cannot be read at all. */
function adapterIsConnected(adapter: Adapter): boolean {
  const read = readAdapterProperty(adapter, 'connected')
  return read.ok && read.value === true
}

/**
 * A base58 string for a value that claims to be a public key, or null.
 *
 * The `toBase58` acquisition AND its invocation are both protected: a hostile object
 * can expose the method as a throwing getter, or as a function that throws when
 * called, and those are two different failures that must both fail closed.
 */
function safeBase58(value: unknown): string | null {
  const method = readAdapterProperty(value, 'toBase58')
  if (!method.ok || typeof method.value !== 'function') {
    return null
  }
  try {
    const text = (method.value as (this: unknown) => unknown).call(value)
    return typeof text === 'string' && text !== '' ? text : null
  } catch {
    return null
  }
}

/**
 * Copy an EXTERNAL byte sequence into freshly allocated memory REDAX owns.
 *
 * `.slice()` is deliberately NOT used. On a `Buffer` — which is exactly what the
 * installed web3.js hands back from a serialization — `slice` returns a VIEW over
 * the same memory, so the "copy" would still be mutable by whoever owns the
 * original. A fresh `Uint8Array` written index by index cannot alias anything.
 *
 * Every index read goes through `Reflect.get` inside a `try`: a hostile object can
 * define an element accessor that throws, and that must be a refusal here rather
 * than an exception escaping into the caller's control flow.
 */
function copyForeignBytes(input: unknown): Uint8Array | null {
  if (typeof input !== 'object' || input === null) {
    return null
  }
  const lengthRead = readAdapterProperty(input, 'length')
  if (!lengthRead.ok) {
    return null
  }
  const length = lengthRead.value
  if (typeof length !== 'number' || !Number.isSafeInteger(length) || length <= 0) {
    return null
  }
  const copy = new Uint8Array(length)
  for (let index = 0; index < length; index += 1) {
    const element = readAdapterProperty(input, String(index))
    if (!element.ok) {
      return null
    }
    const value = element.value
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 255) {
      return null
    }
    copy[index] = value
  }
  return copy
}

/**
 * The ONE mechanical serialization of the foreign wallet-returned signed value.
 *
 * `requireAllSignatures` and `verifySignatures` are BOTH false on purpose. This
 * module makes no signature judgment: asking the foreign object to validate its own
 * signatures would move a security decision into untrusted code AND would throw on
 * exactly the artifacts the action bridge must be able to inspect and refuse. The
 * bridge verifies the extracted message and the signature itself, against bytes.
 *
 * Both the method acquisition and its invocation are protected, because a hostile
 * object can expose the method as a throwing getter OR as a function that throws.
 */
function serializeForeignSignedTransaction(signed: unknown): Uint8Array | null {
  const method = readAdapterProperty(signed, 'serialize')
  if (!method.ok || typeof method.value !== 'function') {
    return null
  }
  let wire: unknown
  try {
    wire = (method.value as (this: unknown, options: unknown) => unknown).call(signed, {
      requireAllSignatures: false,
      verifySignatures: false,
    })
  } catch {
    return null
  }
  return copyForeignBytes(wire)
}

// Inert transport: not connected, no current key, no sign-only capability, and a
// sign that never proceeds. The action bridge checks `isConnected` first and returns
// a typed WALLET_NOT_CONNECTED; this rejection is only a defensive backstop and is
// value-free.
const INERT_REDAX_WALLET_ACTION_TRANSPORT: RedaxWalletActionTransport = {
  isConnected: false,
  canSignOnly: false,
  publicKey: null,
  readCurrentPublicKey() {
    return null
  },
  async signLegacyTransactionBytes() {
    throw new Error(REDAX_WALLET_ACTION_TRANSPORT_UNAVAILABLE)
  },
}

const RedaxWalletActionTransportContext = createContext<RedaxWalletActionTransport>(
  INERT_REDAX_WALLET_ACTION_TRANSPORT,
)

/**
 * INTERNAL/GATED hook — import ONLY from RedaxWalletActions.tsx. Returns the
 * minimal action transport (connected key + sign-only bytes); never the raw
 * adapter, and never a broadcast capability of any kind.
 * Total: inert outside a mounted provider or when disconnected.
 */
export function useRedaxWalletActionTransport(): RedaxWalletActionTransport {
  return useContext(RedaxWalletActionTransportContext)
}

// --- INTERNAL/GATED Team/Admin S1 sign-only broker ---------------------------
//
// A SECOND private surface, named for ONE action, for the Team/Admin S1 campaign
// setup and nothing else. It is imported by exactly one path,
// app/src/teamAdmin/RedaxTeamAdminActions.tsx, and the Team/Admin route does not
// use the Holder-oriented transport above.
//
// WHY A SEPARATE, ACTION-NAMED SURFACE RATHER THAN REUSE. The transport above is
// Holder's by construction and is documented as such. The two actions have
// different signer topologies — Holder is exactly one required signer, Team/Admin
// S1 is exactly two — so one shared surface would serve both, and the first time
// either topology moved the other would inherit the change silently. A separate
// named member keeps the capability boundary countable, which is how every other
// boundary on this route is enforced.
//
// IT REUSES THE MECHANICS AND ADDS NO CAPABILITY. Adapter acquisition, capability
// detection, live identity reading, the single sign-only invocation and the single
// mechanical serialization are the SAME code, reached through the same private
// object: there is one adapter-facing implementation in this module, not two.
//
// WHAT IT IS NOT. It has no `sendTransaction`, no `signAndSendTransaction`, no
// `sendRawTransaction`, no generic `signTransaction`, no signer array, no
// `partialSign` and no fallback of any kind. It never receives the S1
// `outputMintKeypair` — that key is generated, held and applied entirely inside the
// Team/Admin action root, and this module could not accept one if it were offered.
// It decides no Team admission, verifies no signature, writes no journal and
// broadcasts nothing.

/** The minimum private wallet surface the Team/Admin S1 action root needs. */
export interface RedaxTeamAdminS1SignOnlyBroker {
  /** True only when a wallet is connected with a public key under a mounted provider. */
  readonly isConnected: boolean
  /**
   * True only when the connected wallet advertises a usable sign-only capability
   * this module was able to acquire structurally.
   *
   * A capability signal, never an authorization. When it is false the Team/Admin
   * action root refuses BEFORE any entropy, any plan and any wallet prompt, and
   * there is deliberately nothing to fall back to.
   */
  readonly canSignOnly: boolean
  /** The connected wallet key as captured when this broker was built. A snapshot. */
  readonly publicKey: PublicKey | null
  /** The adapter's key RIGHT NOW, evaluated on every call. Null on any drift. */
  readCurrentPublicKey(): PublicKey | null
  /**
   * Ask the connected wallet to SIGN one legacy Team/Admin S1 transaction, and
   * return the signed transaction BYTES.
   *
   * The transaction handed in ALREADY carries the output-mint partial signature.
   * This module neither knows nor checks that: it performs the one wallet
   * invocation and the one mechanical serialization, and every question about what
   * the returned bytes MEAN — signature count, signer slots, message equality,
   * cryptographic validity — belongs to the Team/Admin action root, which is the
   * sole Team/Admin transaction-security authority.
   *
   * FAIL-CLOSED on identity drift and on any hostile shape, exactly as the Holder
   * transport is: the same live pre-invocation identity check runs, the adapter is
   * never invoked when it fails, and a throwing getter or a malformed return is
   * unavailability rather than an escaping exception. The returned bytes are not
   * retained here: no cache, no storage, no log.
   */
  signTeamAdminS1LegacyTransactionBytes(transaction: Transaction): Promise<Uint8Array>
}

/**
 * Project the private adapter-facing transport onto the Team/Admin S1 surface.
 *
 * A projection, not a second implementation: every member below forwards to the one
 * object built in the provider, so there is exactly one place in this module that
 * touches an adapter. What differs is the NAME of the signing member, and that is
 * the entire point — an action-specific member cannot be repurposed by accident.
 */
function teamAdminS1BrokerFrom(
  transport: RedaxWalletActionTransport,
): RedaxTeamAdminS1SignOnlyBroker {
  return {
    isConnected: transport.isConnected,
    canSignOnly: transport.canSignOnly,
    publicKey: transport.publicKey,
    readCurrentPublicKey: () => transport.readCurrentPublicKey(),
    signTeamAdminS1LegacyTransactionBytes: (transaction) =>
      transport.signLegacyTransactionBytes(transaction),
  }
}

const RedaxTeamAdminS1SignOnlyBrokerContext = createContext<RedaxTeamAdminS1SignOnlyBroker>(
  teamAdminS1BrokerFrom(INERT_REDAX_WALLET_ACTION_TRANSPORT),
)

/**
 * INTERNAL/GATED hook — import ONLY from app/src/teamAdmin/RedaxTeamAdminActions.tsx.
 * Returns the minimal Team/Admin S1 sign-only broker; never the raw adapter, never a
 * generic signer, and never a broadcast capability of any kind.
 * Total: inert outside a mounted provider or when disconnected.
 */
export function useRedaxTeamAdminS1SignOnlyBroker(): RedaxTeamAdminS1SignOnlyBroker {
  return useContext(RedaxTeamAdminS1SignOnlyBrokerContext)
}

// --- INTERNAL/GATED Team/Admin POST-INIT MUTATION sign-only broker -------------
//
// A THIRD private surface, named for ONE action family, for the six Team/Admin post-init
// mutations — `add_token_config`, `setup_metadata`, `activate_campaign`,
// `pause_campaign`, `unpause_campaign`, `finalize_campaign` — and nothing else. It is
// imported by exactly one path,
// app/src/teamAdmin/RedaxTeamAdminMutationActions.tsx, and neither the Holder route nor
// the S1 route uses it.
//
// WHY A THIRD ACTION-NAMED SURFACE RATHER THAN REUSING EITHER. The three corridors have
// three different signer topologies: Holder is exactly one required signer through its own
// owner, Team/Admin S1 is exactly TWO — a wallet signature beside an ephemeral output-mint
// `partialSign` — and this one is exactly ONE, with every signer role collapsed onto the
// approved Team wallet. A shared surface would serve all three, and the first time any
// topology moved the others would inherit the change silently. A separate named member
// keeps the capability boundary countable, which is how every other boundary here is
// enforced.
//
// IT REUSES THE MECHANICS AND ADDS NO CAPABILITY. Adapter acquisition, capability
// detection, live identity reading, the single sign-only invocation and the single
// mechanical serialization are the SAME code, reached through the same private object:
// there is one adapter-facing implementation in this module, not three.
//
// WHAT IT IS NOT. It has no `sendTransaction`, no `signAndSendTransaction`, no
// `sendRawTransaction`, no generic `signTransaction`, no signer array, no `partialSign`
// and no fallback of any kind. It never receives a keypair — the mutation corridor
// generates none and could not hand one over — and it returns BYTES, never a
// `Transaction`. It decides no Team admission, verifies no signature, writes no journal,
// opens no `Connection`, reads no chain and broadcasts nothing.

/** The minimum private wallet surface the Team/Admin mutation action root needs. */
export interface RedaxTeamAdminMutationSignOnlyBroker {
  /** True only when a wallet is connected with a public key under a mounted provider. */
  readonly isConnected: boolean
  /**
   * True only when the connected wallet advertises a usable sign-only capability this
   * module was able to acquire structurally.
   *
   * A capability signal, never an authorization. When it is false the mutation action root
   * refuses BEFORE any plan and any wallet prompt, and there is deliberately nothing to
   * fall back to.
   */
  readonly canSignOnly: boolean
  /** The connected wallet key as captured when this broker was built. A snapshot. */
  readonly publicKey: PublicKey | null
  /** The adapter's key RIGHT NOW, evaluated on every call. Null on any drift. */
  readCurrentPublicKey(): PublicKey | null
  /**
   * Ask the connected wallet to SIGN one legacy Team/Admin post-init mutation transaction,
   * and return the signed transaction BYTES.
   *
   * The transaction handed in carries NO other signature and needs none: the mutation
   * corridor's topology is exactly one required signer, and it is this wallet. This module
   * neither knows nor checks that — it performs the one wallet invocation and the one
   * mechanical serialization, and every question about what the returned bytes MEAN
   * (signature count, signer slot, message equality, cryptographic validity) belongs to the
   * mutation action root, which is the sole authority for this corridor.
   *
   * FAIL-CLOSED on identity drift and on any hostile shape, exactly as the other two
   * surfaces are: the same live pre-invocation identity check runs, the adapter is never
   * invoked when it fails, and a throwing getter or a malformed return is unavailability
   * rather than an escaping exception. The returned bytes are not retained here: no cache,
   * no storage, no log.
   */
  signTeamAdminMutationLegacyTransactionBytes(transaction: Transaction): Promise<Uint8Array>
}

/**
 * Project the private adapter-facing transport onto the Team/Admin mutation surface.
 *
 * A projection, not a third implementation: every member below forwards to the one object
 * built in the provider, so there is exactly one place in this module that touches an
 * adapter. What differs is the NAME of the signing member, and that is the entire point —
 * an action-specific member cannot be repurposed by accident.
 */
function teamAdminMutationBrokerFrom(
  transport: RedaxWalletActionTransport,
): RedaxTeamAdminMutationSignOnlyBroker {
  return {
    isConnected: transport.isConnected,
    canSignOnly: transport.canSignOnly,
    publicKey: transport.publicKey,
    readCurrentPublicKey: () => transport.readCurrentPublicKey(),
    signTeamAdminMutationLegacyTransactionBytes: (transaction) =>
      transport.signLegacyTransactionBytes(transaction),
  }
}

const RedaxTeamAdminMutationSignOnlyBrokerContext =
  createContext<RedaxTeamAdminMutationSignOnlyBroker>(
    teamAdminMutationBrokerFrom(INERT_REDAX_WALLET_ACTION_TRANSPORT),
  )

/**
 * INTERNAL/GATED hook — import ONLY from
 * app/src/teamAdmin/RedaxTeamAdminMutationActions.tsx. Returns the minimal Team/Admin
 * post-init mutation sign-only broker; never the raw adapter, never a generic signer, and
 * never a broadcast capability of any kind.
 * Total: inert outside a mounted provider or when disconnected.
 */
export function useRedaxTeamAdminMutationSignOnlyBroker(): RedaxTeamAdminMutationSignOnlyBroker {
  return useContext(RedaxTeamAdminMutationSignOnlyBrokerContext)
}

interface RedaxWalletProviderProps {
  children: ReactNode
}

export function RedaxWalletProvider({ children }: RedaxWalletProviderProps) {
  // Discovered, adapter-compatible Wallet Standard wallets registered on this
  // page. Empty base-adapter list by design: discovery only, nothing bundled.
  const adapters = useStandardWalletAdapters([])

  const [selectedWalletName, setSelectedWalletName] = useState<string | null>(null)
  // Lifecycle excluding 'no-wallet': that arm is derived from detection below.
  const [lifecycle, setLifecycle] = useState<Exclude<RedaxWalletStatus, 'no-wallet'>>('idle')
  const [publicKeyBase58, setPublicKeyBase58] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const activeAdapterRef = useRef<Adapter | null>(null)
  const detachRef = useRef<(() => void) | null>(null)

  const wallets = useMemo<readonly RedaxWalletOptionView[]>(
    () =>
      adapters.map((adapter) => ({
        name: String(adapter.name),
        icon: adapter.icon,
        readyState: toRedaxReadyState(adapter.readyState),
        connectable: isConnectableReadyState(adapter.readyState),
      })),
    [adapters],
  )

  // Attach connection-lifecycle listeners to one adapter. The adapter object
  // never leaves this closure; detachRef holds the cleanup.
  const attachAdapter = useCallback((adapter: Adapter) => {
    detachRef.current?.()
    const handleConnect = () => {
      setLifecycle('connected')
      setErrorMessage(null)
      setPublicKeyBase58(adapter.publicKey?.toBase58() ?? null)
    }
    const handleDisconnect = () => {
      setLifecycle('idle')
      setPublicKeyBase58(null)
    }
    const handleError = (error: { name?: string }) => {
      setErrorMessage(safeWalletErrorCopy(error.name))
    }
    adapter.on('connect', handleConnect)
    adapter.on('disconnect', handleDisconnect)
    adapter.on('error', handleError)
    activeAdapterRef.current = adapter
    detachRef.current = () => {
      adapter.off('connect', handleConnect)
      adapter.off('disconnect', handleDisconnect)
      adapter.off('error', handleError)
      activeAdapterRef.current = null
      detachRef.current = null
    }
  }, [])

  // Detach listeners on unmount (mode switch / app teardown).
  useEffect(
    () => () => {
      detachRef.current?.()
    },
    [],
  )

  // If the selected wallet unregisters from the page, reset to a truthful
  // idle state instead of pointing at a wallet that no longer exists.
  useEffect(() => {
    if (selectedWalletName === null) {
      return
    }
    const stillRegistered = adapters.some((adapter) => String(adapter.name) === selectedWalletName)
    if (!stillRegistered) {
      detachRef.current?.()
      setSelectedWalletName(null)
      setLifecycle('idle')
      setPublicKeyBase58(null)
    }
  }, [adapters, selectedWalletName])

  const connect = useCallback(
    async (walletName: string) => {
      if (lifecycle === 'connecting' || lifecycle === 'disconnecting') {
        return
      }
      const adapter = adapters.find((entry) => String(entry.name) === walletName) ?? null
      if (adapter === null) {
        setSelectedWalletName(null)
        setLifecycle('error')
        setErrorMessage('The selected wallet is no longer detected on this page.')
        return
      }
      setSelectedWalletName(walletName)
      if (!isConnectableReadyState(adapter.readyState)) {
        setLifecycle('error')
        setErrorMessage('The selected wallet is not ready to connect in this browser.')
        return
      }
      attachAdapter(adapter)
      setLifecycle('connecting')
      setErrorMessage(null)
      try {
        // User-initiated only: reached exclusively from the connect control.
        await adapter.connect()
        setLifecycle('connected')
        setPublicKeyBase58(adapter.publicKey?.toBase58() ?? null)
      } catch (error) {
        setLifecycle('error')
        setPublicKeyBase58(null)
        setErrorMessage(safeWalletErrorCopy(error instanceof Error ? error.name : undefined))
      }
    },
    [adapters, attachAdapter, lifecycle],
  )

  const disconnect = useCallback(async () => {
    const adapter = activeAdapterRef.current
    if (adapter === null) {
      setLifecycle('idle')
      setPublicKeyBase58(null)
      return
    }
    setLifecycle('disconnecting')
    try {
      // User-initiated only: reached exclusively from the disconnect control.
      await adapter.disconnect()
      setLifecycle('idle')
    } catch (error) {
      setLifecycle('error')
      setErrorMessage(safeWalletErrorCopy(error instanceof Error ? error.name : undefined))
    } finally {
      setPublicKeyBase58(null)
      detachRef.current?.()
    }
  }, [])

  const walletsDetected = wallets.length > 0
  const status: RedaxWalletStatus = walletsDetected ? lifecycle : 'no-wallet'

  const value = useMemo<RedaxWalletContextValue>(
    () => ({
      isWalletMode: true,
      walletsDetected,
      wallets,
      selectedWalletName,
      status,
      publicKeyBase58,
      shortPublicKey: toShortPublicKey(publicKeyBase58),
      errorMessage,
      connect,
      disconnect,
    }),
    [
      connect,
      disconnect,
      errorMessage,
      publicKeyBase58,
      selectedWalletName,
      status,
      wallets,
      walletsDetected,
    ],
  )

  // INTERNAL/GATED action transport (see useRedaxWalletActionTransport). Recomputed
  // only on connection changes; reads the private adapter ref and, in the connected
  // branch, captures the exact adapter and the approved initial key. It renders
  // nothing and runs no action itself — the action bridge invokes it only on an
  // explicit future UI call.
  const actionTransport = useMemo<RedaxWalletActionTransport>(() => {
    const capturedAdapter = activeAdapterRef.current
    if (status !== 'connected' || publicKeyBase58 === null || capturedAdapter === null) {
      return INERT_REDAX_WALLET_ACTION_TRANSPORT
    }

    // Every external read below is protected. A failure to read the adapter's IDENTITY
    // yields the INERT transport rather than a partially-armed one — a transport whose
    // key cannot be read is not a transport. A failure to acquire the SIGNER is
    // different in kind and is handled where it is acquired: identity is still known,
    // so the transport exists and truthfully reports that it cannot sign.
    const capturedKeyRead = readAdapterProperty(capturedAdapter, 'publicKey')
    if (!capturedKeyRead.ok) {
      return INERT_REDAX_WALLET_ACTION_TRANSPORT
    }
    // The approved initial identity, copied to a base58 string. Comparing strings
    // rather than objects is deliberate: a duplicated `@solana/web3.js` copy makes
    // object identity and `instanceof` unreliable, while base58 is exact.
    const approvedKeyBase58 = safeBase58(capturedKeyRead.value)
    if (approvedKeyBase58 === null) {
      return INERT_REDAX_WALLET_ACTION_TRANSPORT
    }
    // Re-wrapped as a key of THIS module's package instance, so the adapter's own
    // object never leaves this closure on the snapshot either.
    let capturedPublicKey: PublicKey
    try {
      capturedPublicKey = new PublicKey(approvedKeyBase58)
    } catch {
      return INERT_REDAX_WALLET_ACTION_TRANSPORT
    }

    // Acquiring the adapter's own signer is itself an external property read, and the
    // `bind` can throw for a non-function. The bound reference stays a CLOSURE LOCAL
    // and is never placed on the returned object, so the only way to reach it is
    // through the drift-checking wrapper below.
    //
    // AN ABSENT SIGNER IS NOT AN ABSENT TRANSPORT. The wallet is still connected and
    // its identity is still readable, so the transport is built with
    // `canSignOnly: false` rather than replaced by the inert one — that is what lets
    // the action bridge refuse with a truthful sign-only-unavailable result instead of
    // claiming no wallet is connected. There is no second capability to try.
    const signRead = readAdapterProperty(capturedAdapter, 'signTransaction')
    let boundAdapterSign: ((transaction: Transaction) => Promise<unknown>) | null = null
    if (signRead.ok && typeof signRead.value === 'function') {
      try {
        boundAdapterSign = (
          signRead.value as (this: unknown, transaction: Transaction) => Promise<unknown>
        ).bind(capturedAdapter)
      } catch {
        boundAdapterSign = null
      }
    }

    /**
     * The adapter's live key, or null.
     *
     * Every condition is re-evaluated here, at call time: same adapter object, still
     * connected, current key present. A hostile or merely broken adapter whose
     * `connected` or `publicKey` accessor throws is unavailability, not an exception
     * for the caller — and `connected` is read through the same protected path as the
     * key, because a throwing flag would otherwise escape before the key was reached.
     */
    const readCurrentPublicKey = (): PublicKey | null => {
      const active = activeAdapterRef.current
      if (active === null || active !== capturedAdapter || !adapterIsConnected(active)) {
        return null
      }
      // Widened deliberately: the declared type says `PublicKey | null`, but this is
      // an external object and a missing key must refuse rather than be trusted to be
      // exactly `null`.
      const currentRead = readAdapterProperty(active, 'publicKey')
      if (!currentRead.ok) {
        return null
      }
      const currentBase58 = safeBase58(currentRead.value)
      if (currentBase58 === null) {
        return null
      }
      try {
        // A fresh key of THIS module's package instance: the adapter's own object
        // never leaves the closure, and an invalid value refuses rather than escapes.
        return new PublicKey(currentBase58)
      } catch {
        return null
      }
    }

    return {
      isConnected: true,
      canSignOnly: boundAdapterSign !== null,
      publicKey: capturedPublicKey,
      readCurrentPublicKey,
      async signLegacyTransactionBytes(transaction) {
        // Bound once, here, so what runs below is exactly what the capability flag was
        // computed from — not whatever the closure variable holds at some later moment.
        const sign = boundAdapterSign
        // Last check before the wallet is asked anything at all. It runs INSIDE the
        // provider so the comparison is against the live adapter, not against a value
        // the caller could already be holding. The underlying adapter signer runs ONLY
        // after this immediate live identity check succeeds.
        const live = readCurrentPublicKey()
        if (sign === null || live === null || live.toBase58() !== approvedKeyBase58) {
          throw new Error(REDAX_WALLET_ACTION_TRANSPORT_UNAVAILABLE)
        }
        const signed = await sign(transaction)
        // The one serialization, and the only thing that leaves: bytes REDAX owns.
        const wire = serializeForeignSignedTransaction(signed)
        if (wire === null) {
          throw new Error(REDAX_WALLET_ACTION_TRANSPORT_UNAVAILABLE)
        }
        return wire
      },
    }
  }, [status, publicKeyBase58])

  // The Team/Admin S1 sign-only broker, projected from the SAME private transport
  // object above. It adds no adapter access and no capability — it renames one
  // member for one action — and it is recomputed only when that object is.
  const teamAdminS1Broker = useMemo<RedaxTeamAdminS1SignOnlyBroker>(
    () => teamAdminS1BrokerFrom(actionTransport),
    [actionTransport],
  )

  // The Team/Admin POST-INIT MUTATION sign-only broker, projected from the SAME private
  // transport object above. Like the S1 broker it adds no adapter access and no capability
  // — it renames one member for one action family — and it is recomputed only when that
  // object is.
  const teamAdminMutationBroker = useMemo<RedaxTeamAdminMutationSignOnlyBroker>(
    () => teamAdminMutationBrokerFrom(actionTransport),
    [actionTransport],
  )

  return (
    <RedaxWalletContext.Provider value={value}>
      <RedaxWalletActionTransportContext.Provider value={actionTransport}>
        <RedaxTeamAdminS1SignOnlyBrokerContext.Provider value={teamAdminS1Broker}>
          <RedaxTeamAdminMutationSignOnlyBrokerContext.Provider value={teamAdminMutationBroker}>
            {children}
          </RedaxTeamAdminMutationSignOnlyBrokerContext.Provider>
        </RedaxTeamAdminS1SignOnlyBrokerContext.Provider>
      </RedaxWalletActionTransportContext.Provider>
    </RedaxWalletContext.Provider>
  )
}
