// REDAX customer service — coordination of the customer's Team chain writes.
//
// THE PLAN IS THE AUTHORITY, NOT A TICK BOX. A guided step never fakes the per-step panels' review
// checkboxes. It ARMS the coordinator with the exact request the frozen, hash-verified plan
// implies, then calls the existing transaction root. The root runs every one of its own chain
// guards, opens its durable record, and — immediately before the one wallet prompt — asks this
// coordinator's write gate. The gate admits only a request that is byte-for-byte the armed
// one, and only after the customer service has, at its own boundary:
//
//   * re-checked the session's CURRENT permission for this operation (STOP_NEW etc.),
//   * checked the request against the stored frozen plan (a row, the exact metadata URI),
//   * for metadata, re-read the exact public JSON and image and compared their hashes,
//   * and taken the wallet's sticky Team-write claim for THIS browser.
//
// THE CLAIM IS RELEASED ONLY ON LOCAL EVIDENCE. After an attempt ends, the claim is released
// only if this browser's own durable journals — read through the two roots' own read-only
// members, `readRecoveryRecord` and `readMutationStatus` — show no unresolved attempt (EMPTY or
// a settled tombstone). A pending, unreadable or support-only attempt keeps it, so another browser with
// an empty journal can never start a second write beside an unresolved one. There is no
// timeout, no force-clear and no "start over" escape. An API success is never finality.
//
// AND IT RELEASES ONLY THE GENERATION THE EVIDENCE WAS READ FOR. Every admission is a new lease
// minted by the server. A settle reads the claim's lease FIRST and the journals AFTER it, and the
// release names exactly that lease; the server frees only that generation. Idle evidence read for
// an earlier attempt therefore can never free a newer one — not from another tab of this browser,
// not from a late callback — and any admission that begins in this coordinator while a settle is
// in flight voids that settle locally as well.
//
// AN ANSWER MUST STILL BELONG TO ITS CONTEXT. The admission request is a network round trip. When
// its answer arrives, the gate re-checks — synchronously, then again in the root immediately
// before the wallet is asked — that the same arm (or the same management scope) is still in
// place, that this tab's session is still the same session for the same wallet, and that the
// permission THIS operation needs is still granted as this tab currently knows it. Anything
// else admits nothing: the root settles its record as not sent and no wallet prompt happens.
//
// A MANAGEMENT ANSWER BELONGS TO ONE VISIT OF THE CAMPAIGN PAGE. Pause, unpause and finalize are
// admitted only for the visit that asked: each mount of the campaign page opens its own visit,
// and closing it (the page went away) is final. Coming back to the same campaign is a NEW visit
// with the same values, so an answer still on its way from the earlier visit is void and a new
// explicit action is needed. Within one visit, the page clearing and re-establishing the same
// scope (an ordinary effect re-run) is still the same context.
//
// THE SERVER DOES NOT LOCK THE CHAIN. This coordinates the supported app's own writes. The
// program remains permissionless for the campaign admin.

import type {
  RedaxTeamAdminS1SetupRequest,
  RedaxTeamAdminS1WriteGate,
  RedaxTeamAdminS1WriteGateRequest,
} from '../teamAdmin/RedaxTeamAdminActions'
import type {
  RedaxTeamAdminMutationRequest,
  RedaxTeamAdminMutationWriteGate,
  RedaxTeamAdminMutationWriteGateRequest,
} from '../teamAdmin/RedaxTeamAdminMutationActions'
import type { RedaxCustomerApiClient } from './customerApi'
import { redaxCanonicalJson } from './shared/customerCanonical.js'
import type {
  RedaxCustomerClaimRequest,
  RedaxCustomerClaimView,
  RedaxCustomerPermissions,
  RedaxCustomerPlanV1,
  RedaxCustomerTeamWriteOperation,
} from './shared/customerContract.js'
import { REDAX_CUSTOMER_OUTPUT_DECIMALS } from './shared/customerContract.js'

/** The setup a write belongs to. */
export interface RedaxCustomerWriteScope {
  readonly setupId: string
  readonly planHash: string
  readonly plan: RedaxCustomerPlanV1
  /** The bound campaign, once the setup is STARTED. */
  readonly campaign: { readonly address: string; readonly outputMint: string } | null
}

export type RedaxCustomerArmedRequest =
  | { readonly kind: 'S1'; readonly request: RedaxTeamAdminS1SetupRequest }
  | { readonly kind: 'MUTATION'; readonly request: RedaxTeamAdminMutationRequest }

export type RedaxCustomerJournalState = 'IDLE' | 'ACTIVE' | 'UNKNOWN'

export type RedaxCustomerJournalReader = () => Promise<{
  readonly s1: RedaxCustomerJournalState
  readonly mutation: RedaxCustomerJournalState
}>

export interface RedaxCustomerGateRefusal {
  readonly code: string
  readonly message: string
}

/** The signed-in session exactly as this tab knows it at one instant. */
export interface RedaxCustomerLiveSession {
  readonly sessionId: string
  readonly wallet: string
  readonly permissions: RedaxCustomerPermissions
}

/** What a gate hands the root on admission: `stillCurrent` is asked again right before the prompt. */
export type RedaxCustomerGateDecision = { readonly ok: true; readonly stillCurrent: () => boolean } | { readonly ok: false }

/** One mount of the campaign page: the only owner of a management scope. */
export interface RedaxCustomerManageVisit {
  /** The campaign this visit manages, or `null` while it shows none. A closed or replaced visit sets nothing. */
  setScope(scope: RedaxCustomerWriteScope | null): void
  /** The visit is over for good: nothing it admitted can be used, even if the same campaign is opened again. */
  close(): void
}

export interface RedaxCustomerTeamWriteCoordinator {
  readonly teamWallet: string
  readonly s1Gate: RedaxTeamAdminS1WriteGate
  readonly mutationGate: RedaxTeamAdminMutationWriteGate
  /** Arm one write. Returns the disarm function; arming again replaces the previous arm. */
  arm(scope: RedaxCustomerWriteScope, expected: RedaxCustomerArmedRequest): () => void
  /**
   * Open a new visit of the campaign page, for pause / unpause / finalize. The newest visit is the
   * page on screen: opening one ends the previous visit's hold on the management scope.
   */
  openManageVisit(): RedaxCustomerManageVisit
  /** The reason the last gate refusal happened, once. */
  takeRefusal(): RedaxCustomerGateRefusal | null
  claimStatus(): Promise<RedaxCustomerClaimView | null>
  /**
   * Release this browser's claim if, and only if, its own journals show nothing unresolved.
   * The reader comes from the caller, who sits inside both roots and reads them through their
   * own read-only members; this module imports no journal.
   */
  settleIfIdle(readJournals: RedaxCustomerJournalReader): Promise<RedaxCustomerClaimView | null>
  /** True after an admitted attempt ended and its claim has not been settled yet. */
  readonly needsSettle: () => boolean
  subscribe(listener: () => void): () => void
  /** This coordinator's session is over: everything armed, scoped or admitted is void. */
  dispose(): void
}

// --- Plan → exact root requests ------------------------------------------------------------

/** The exact S1 request the plan implies. All rows are carried into the plan fingerprint. */
export function redaxCustomerS1RequestFromPlan(plan: RedaxCustomerPlanV1): RedaxTeamAdminS1SetupRequest {
  return {
    endTs: plan.end.mode === 'DATE' ? plan.end.unixSeconds : '',
    maxOutputSupply: plan.totalLimit.maxOutputSupply,
    metadataName: plan.token.name,
    metadataSymbol: plan.token.symbol,
    metadataUri: plan.publication.jsonUri,
    lifecycleIntent: 'activate_after_setup',
    tokenConfigs: plan.rows.map((row) => ({
      rowId: row.rowId,
      legacyMint: row.legacyMint,
      expectedLegacyDecimals: String(row.legacyDecimals),
      rateNumerator: row.rateNumerator,
      rateDenominator: row.rateDenominator,
      maxOutputFromTokenConfig: row.maxOutputFromTokenConfig,
    })),
  }
}

export function redaxCustomerAddRequestFromPlan(
  plan: RedaxCustomerPlanV1,
  campaign: { readonly address: string; readonly outputMint: string },
  rowId: string,
): RedaxTeamAdminMutationRequest | null {
  const row = plan.rows.find((entry) => entry.rowId === rowId)
  if (row === undefined) {
    return null
  }
  return {
    operation: 'ADD_TOKEN_CONFIG',
    campaign: campaign.address,
    outputMint: campaign.outputMint,
    legacyMint: row.legacyMint,
    rateNumerator: row.rateNumerator,
    rateDenominator: row.rateDenominator,
    maxOutputFromTokenConfig: row.maxOutputFromTokenConfig,
    expectedLegacyDecimals: row.legacyDecimals,
    expectedOutputDecimals: REDAX_CUSTOMER_OUTPUT_DECIMALS,
  }
}

export function redaxCustomerMetadataRequestFromPlan(
  plan: RedaxCustomerPlanV1,
  campaign: { readonly address: string; readonly outputMint: string },
): RedaxTeamAdminMutationRequest {
  return {
    operation: 'SETUP_METADATA',
    campaign: campaign.address,
    outputMint: campaign.outputMint,
    metadataName: plan.token.name,
    metadataSymbol: plan.token.symbol,
    metadataUri: plan.publication.jsonUri,
  }
}

/** The customer-service claim request for a root request. `null` = not a coordinated write. */
function claimRequestFor(request: RedaxTeamAdminMutationRequest): RedaxCustomerClaimRequest | null {
  switch (request.operation) {
    case 'ADD_TOKEN_CONFIG':
      return {
        operation: 'ADD_TOKEN_CONFIG',
        campaign: request.campaign,
        legacyMint: request.legacyMint,
        rateNumerator: request.rateNumerator,
        rateDenominator: request.rateDenominator,
        maxOutputFromTokenConfig: request.maxOutputFromTokenConfig,
      }
    case 'SETUP_METADATA':
      return {
        operation: 'SETUP_METADATA',
        campaign: request.campaign,
        metadataName: request.metadataName,
        metadataSymbol: request.metadataSymbol,
        metadataUri: request.metadataUri,
      }
    case 'ACTIVATE_CAMPAIGN':
    case 'PAUSE_CAMPAIGN':
    case 'UNPAUSE_CAMPAIGN':
    case 'FINALIZE_CAMPAIGN':
      return { operation: request.operation, campaign: request.campaign }
    default:
      return null
  }
}

function sameRequest(left: unknown, right: unknown): boolean {
  try {
    return redaxCanonicalJson(left) === redaxCanonicalJson(right)
  } catch {
    return false
  }
}

// --- The coordinator -------------------------------------------------------------------------

/** The permission a Team write needs, by operation — the same split the server enforces. */
function permits(permissions: RedaxCustomerPermissions, operation: RedaxCustomerTeamWriteOperation): boolean {
  switch (operation) {
    case 'CREATE_CAMPAIGN':
      return permissions.create
    case 'PAUSE_CAMPAIGN':
    case 'UNPAUSE_CAMPAIGN':
    case 'FINALIZE_CAMPAIGN':
      return permissions.manageExisting
    default:
      return permissions.completeStartedSetup
  }
}

/** 128 random bits, hex: this admission request's own id. */
function newAttemptId(): string {
  const bytes = new Uint8Array(16)
  ;(globalThis as unknown as { crypto: { getRandomValues(array: Uint8Array): Uint8Array } }).crypto.getRandomValues(bytes)
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

const CONTEXT_CHANGED: RedaxCustomerGateRefusal = Object.freeze({
  code: 'CONTEXT_CHANGED',
  message: 'The page changed while this step was being checked. Nothing was sent — open the step again.',
})

const PERMISSION_CHANGED: RedaxCustomerGateRefusal = Object.freeze({
  code: 'PERMISSION_CHANGED',
  message: 'Your access no longer allows this step for this wallet. Nothing was sent.',
})

export function createRedaxCustomerTeamWriteCoordinator(input: {
  readonly api: RedaxCustomerApiClient
  readonly teamWallet: string
  readonly programId: string
  /**
   * The session as this tab knows it RIGHT NOW (synchronous), or `null` once it is gone. The
   * coordinator is bound to the session it was created under, and re-reads this after every
   * await of an admission and again right before the wallet prompt.
   */
  readonly readLiveSession: () => RedaxCustomerLiveSession | null
}): RedaxCustomerTeamWriteCoordinator {
  const { api, teamWallet, readLiveSession } = input
  const bound = readLiveSession()
  const boundSessionId = bound !== null && bound.wallet === teamWallet ? bound.sessionId : null
  let disposed = false
  let armed: { readonly scope: RedaxCustomerWriteScope; readonly expected: RedaxCustomerArmedRequest; readonly token: number } | null = null
  // The campaign page's visit on screen. Identity, not value, is what an answer is checked against.
  type ManageVisit = { scope: RedaxCustomerWriteScope | null; closed: boolean }
  let manageVisit: ManageVisit | null = null
  let armToken = 0
  // Advanced when an admission BEGINS. A settle that started before it reads no evidence for it.
  let enterGeneration = 0
  let enteredSinceSettle = false
  let refusal: RedaxCustomerGateRefusal | null = null
  const listeners = new Set<() => void>()

  const notify = (): void => {
    for (const listener of [...listeners]) {
      listener()
    }
  }

  const refuse = (code: string, message: string): { readonly ok: false } => {
    refusal = { code, message }
    return { ok: false }
  }

  /** Is this coordinator's session still THE session, allowed `operation`, right now? */
  function sessionRefusal(operation: RedaxCustomerTeamWriteOperation): RedaxCustomerGateRefusal | null {
    if (disposed || boundSessionId === null) {
      return CONTEXT_CHANGED
    }
    let live: RedaxCustomerLiveSession | null
    try {
      live = readLiveSession()
    } catch {
      return CONTEXT_CHANGED
    }
    if (live === null || live.sessionId !== boundSessionId || live.wallet !== teamWallet) {
      return CONTEXT_CHANGED
    }
    return permits(live.permissions, operation) ? null : PERMISSION_CHANGED
  }

  async function enter(
    scope: RedaxCustomerWriteScope,
    request: RedaxCustomerClaimRequest,
    contextHolds: () => boolean,
  ): Promise<RedaxCustomerGateDecision> {
    const before = sessionRefusal(request.operation)
    if (before !== null) {
      return refuse(before.code, before.message)
    }
    enterGeneration += 1
    // The browser is identified by its own HttpOnly coordination cookie, which the server set at
    // sign-in; this page never sees or sends it. The attempt id is this request's own id only.
    const entered = await api.claimEnter({ setupId: scope.setupId, planHash: scope.planHash, request, attemptId: newAttemptId() })
    if (!entered.ok) {
      return refuse(entered.code, entered.message)
    }
    enteredSinceSettle = true
    const stillCurrent = (): boolean => contextHolds() && sessionRefusal(request.operation) === null
    if (!stillCurrent()) {
      // The answer arrived for a context that no longer exists. The claim this request took is
      // released only by a later settle, from this browser's journals, once the root has
      // recorded the attempt as not sent.
      const reason = sessionRefusal(request.operation) ?? CONTEXT_CHANGED
      notify()
      return refuse(reason.code, reason.message)
    }
    notify()
    return { ok: true, stillCurrent }
  }

  const settleIfIdle = async (readJournals: RedaxCustomerJournalReader): Promise<RedaxCustomerClaimView | null> => {
    const generation = enterGeneration
    const status = await api.claimStatus()
    if (!status.ok) {
      return null
    }
    if (status.claim.state !== 'MINE' || status.claim.leaseId === null || disposed || generation !== enterGeneration) {
      return status.claim
    }
    // The journals are read AFTER the lease: they are evidence about that generation or newer.
    const journals = await readJournals()
    if (journals.s1 !== 'IDLE' || journals.mutation !== 'IDLE') {
      // Unresolved or unreadable local evidence keeps the claim: no other browser may start
      // a write beside an attempt this browser cannot prove is settled.
      return status.claim
    }
    if (disposed || generation !== enterGeneration) {
      // An admission began while the evidence was being read: it is not evidence for that one.
      return status.claim
    }
    const released = await api.claimRelease({ leaseId: status.claim.leaseId })
    if (released.ok) {
      enteredSinceSettle = false
      notify()
      return released.claim
    }
    // A newer generation (CLAIM_LEASE_CHANGED) or an outage: nothing was released.
    return status.claim
  }

  // The root tells the gate when an attempt ends. Settling needs the journals, which only the
  // pages inside both roots can read, so the gate announces it and those pages settle.
  const settledAfterAttempt = (): void => {
    if (enteredSinceSettle && !disposed) {
      notify()
    }
  }

  const s1Gate: RedaxTeamAdminS1WriteGate = {
    async admit(request: RedaxTeamAdminS1WriteGateRequest) {
      const current = armed
      if (current === null || current.expected.kind !== 'S1') {
        return refuse('NOT_ARMED', 'This step was not started from the reviewed plan. Nothing was sent.')
      }
      if (request.teamWallet !== teamWallet || !sameRequest(request.request, current.expected.request)) {
        return refuse('REQUEST_CHANGED', 'The request no longer matches the reviewed plan. Nothing was sent.')
      }
      return enter(
        current.scope,
        {
          operation: 'CREATE_CAMPAIGN',
          campaign: request.campaign,
          outputMint: request.outputMint,
          planFingerprint: request.planFingerprint,
        },
        // Exactly this arm, still in place: a disarm (the page left, the step ended) or a new
        // arm voids the answer.
        () => armed !== null && armed.token === current.token,
      )
    },
    settled: settledAfterAttempt,
  }

  const mutationGate: RedaxTeamAdminMutationWriteGate = {
    async admit(request: RedaxTeamAdminMutationWriteGateRequest) {
      if (request.teamWallet !== teamWallet) {
        return refuse('REQUEST_CHANGED', 'The connected Team wallet changed. Nothing was sent.')
      }
      const claimRequest = claimRequestFor(request.request)
      if (claimRequest === null || claimRequest.campaign !== request.campaign) {
        return refuse('NOT_ARMED', 'This step is not part of a reviewed plan. Nothing was sent.')
      }
      const current = armed
      if (current !== null && current.expected.kind === 'MUTATION') {
        if (!sameRequest(request.request, current.expected.request)) {
          return refuse('REQUEST_CHANGED', 'The request no longer matches the reviewed plan. Nothing was sent.')
        }
        return enter(current.scope, claimRequest, () => armed !== null && armed.token === current.token)
      }
      // Pause / unpause / finalize come from the campaign page's management panel. They are
      // admitted only for the campaign that page is showing, and only by the server's own
      // MANAGE_EXISTING check.
      const lifecycle =
        request.operation === 'PAUSE_CAMPAIGN' || request.operation === 'UNPAUSE_CAMPAIGN' || request.operation === 'FINALIZE_CAMPAIGN'
      const visit = manageVisit
      const scope = visit?.scope ?? null
      if (!lifecycle || visit === null || scope === null || scope.campaign === null || scope.campaign.address !== request.campaign) {
        return refuse('NOT_ARMED', 'This step was not started from your campaign page. Nothing was sent.')
      }
      // The SAME visit must still be on screen, managing THIS campaign of THIS setup. The visit is
      // compared by identity: a later visit with equal values (the page left and opened again) is
      // not this one. The scope inside it is compared by value: the same visit re-establishing
      // the same scope on an effect re-run is the same context.
      return enter(scope, claimRequest, () => {
        const now = visit.scope
        return (
          manageVisit === visit &&
          !visit.closed &&
          now !== null &&
          now.setupId === scope.setupId &&
          now.planHash === scope.planHash &&
          now.campaign !== null &&
          now.campaign.address === request.campaign
        )
      })
    },
    settled: settledAfterAttempt,
  }

  return {
    teamWallet,
    s1Gate,
    mutationGate,
    arm(scope, expected) {
      armToken += 1
      const token = armToken
      armed = disposed ? null : { scope, expected, token }
      refusal = null
      return () => {
        if (armed !== null && armed.token === token) {
          armed = null
        }
      }
    },
    openManageVisit() {
      const visit: ManageVisit = { scope: null, closed: disposed }
      if (!disposed) {
        // The newest visit is the page on screen; an older one can no longer set or keep a scope.
        manageVisit = visit
      }
      return {
        setScope(scope) {
          if (!visit.closed && !disposed && manageVisit === visit) {
            visit.scope = scope
          }
        },
        close() {
          visit.closed = true
          visit.scope = null
          // A late close of an older visit never touches a newer one.
          if (manageVisit === visit) {
            manageVisit = null
          }
        },
      }
    },
    takeRefusal() {
      const value = refusal
      refusal = null
      return value
    },
    async claimStatus() {
      const status = await api.claimStatus()
      return status.ok ? status.claim : null
    },
    settleIfIdle,
    needsSettle: () => enteredSinceSettle,
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    dispose() {
      disposed = true
      armed = null
      if (manageVisit !== null) {
        manageVisit.closed = true
        manageVisit.scope = null
      }
      manageVisit = null
    },
  }
}

/** A gate pair that refuses everything — used whenever no signed-in coordinator exists. */
export const REDAX_CUSTOMER_REFUSING_S1_GATE: RedaxTeamAdminS1WriteGate = Object.freeze({
  admit: async () => ({ ok: false as const }),
})

export const REDAX_CUSTOMER_REFUSING_MUTATION_GATE: RedaxTeamAdminMutationWriteGate = Object.freeze({
  admit: async () => ({ ok: false as const }),
})
