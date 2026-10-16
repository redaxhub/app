// REDAX read-only devnet adapter — config-injected RedaxDataSource factory for
// the devnet program-data modes (DEVNET_READONLY / DEVNET_WALLET_READONLY /
// DEVNET_TX_ENABLED). THIS ADAPTER performs read-only program/RPC reads in every
// one of them; DEVNET_TX_ENABLED's wallet-gated actions live outside it entirely.
//
// Boundary: read-only devnet adapter core only. This factory constructs a
// Connection from a validated rpcUrl, reads/decodes program accounts, and maps
// them to Redax*View models. The optional config mode changes ONLY the truthful
// mode stamp on envelopes and the environment view — read/RPC/decode semantics
// are identical across all three devnet program-data modes. It reads no env (no
// import.meta.env), wires no provider, requires no wallet in any of them (the
// DEVNET_WALLET_READONLY wallet connection shell lives in the app chrome, never
// in this adapter), sends no transaction, never falls back to mock, and claims
// no readiness. Readonly
// search/filter inputs may arrive in a later gate; the transaction forms that do
// exist belong to their own action roots and panels — never here.
//
// First-slice scope: protocol config, campaigns, token configs, input summaries,
// directory rows, featured campaigns, environment, readonly actions, and
// address-match role are served from real devnet reads. The output mint's
// Metaplex metadata account is additionally read (and memoized) for display
// identity only — an absent/failed metadata read degrades to the address-derived
// label and never fails the core read path. Projects and holder profiles return
// honest empties (no on-chain registry). Holder eligibility / positions (which
// carry a conversion quote) remain typed-deferred; a connected-wallet read-only
// holder context (classic-SPL legacy balances + output-ATA preparedness) is
// served for a connected wallet in DEVNET_WALLET_READONLY. Receipts are
// typed-unavailable (event/indexer strategy is a later slice) — never mock data.

import { Connection, PublicKey } from '@solana/web3.js'
import type {
  RedaxDataSource,
  RedaxDataSourceContext,
  RedaxHolderRef,
} from '../redaxDataSource'
import type {
  RedaxCampaignInputSummaryView,
  RedaxCampaignView,
  RedaxConnectedWalletHolderContextView,
  RedaxConvertReceiptVerificationView,
  RedaxDataSourceResult,
  RedaxDirectoryRowView,
  RedaxHolderEligibilityView,
  RedaxHolderInputPositionView,
  RedaxHolderView,
  RedaxProjectView,
  RedaxProtocolConfigView,
  RedaxReceiptView,
  RedaxRoleView,
  RedaxTokenConfigView,
  RedaxWalletRoleContextView,
} from '../redaxViewModels'
import {
  buildAccountsCoder,
  fetchAllCampaigns,
  fetchCampaignByAddress,
  fetchOutputTokenMetadata,
  fetchProtocolConfig,
  fetchTokenConfigsForCampaign,
  readClassicAtaForOwner,
  type DecodedOutputTokenMetadata,
} from './redaxDevnetAccounts'
import {
  mapCampaignInputSummaryView,
  mapCampaignView,
  mapConnectedWalletHolderContext,
  mapConnectedWalletInputBalance,
  mapConnectedWalletOutputAta,
  mapConnectedWalletRole,
  mapConnectedWalletRoleContext,
  mapDirectoryRowView,
  mapEnvironmentView,
  mapProtocolConfigView,
  mapReadonlyActions,
  mapTokenConfigView,
  publicReadonlyRole,
} from './redaxDevnetMapper'
import { createDevnetResultBuilders, RedaxDevnetAccountError } from './redaxDevnetErrors'
import type { RedaxDevnetProgramAppMode } from './redaxDevnetErrors'
import { decodeConvertedReceipt } from './redaxDevnetReceipts'

/**
 * Validated configuration for the read-only devnet data source. `programId` and
 * `rpcUrl` are the validated VITE_REDAX_PROGRAM_ID / VITE_SOLANA_RPC_URL values
 * (validation happens upstream; this adapter receives them, never reads env). An
 * optional `connection` may be injected for future testing. `mode` is the
 * devnet program-data mode stamped on every envelope and the environment view;
 * it defaults to DEVNET_READONLY. The adapter performs read-only program/RPC
 * reads in every mode — stamping DEVNET_TX_ENABLED adds no send/sign/transaction
 * path to this adapter (that mode's action surfaces are owned elsewhere).
 *
 * `campaignAllowlist` is REQUIRED and deliberately not optional. It is the resolved
 * curated set of Campaign addresses this build's public directory may list, decided
 * upstream by the one pure carrier policy; an empty array is a legitimate, meaningful
 * value that lists nothing. Making it optional would mean an omitted member and a
 * curated-empty deployment were indistinguishable, and the TypeScript requirement is
 * what turns an ordinary omission into a compile error rather than a silent default.
 * A plain JavaScript caller cannot be held to that, so the factory ALSO fails closed
 * on a missing or non-array runtime value — never open.
 */
export interface RedaxDevnetDataSourceConfig {
  programId: string
  rpcUrl: string
  connection?: Connection
  mode?: RedaxDevnetProgramAppMode
  readonly campaignAllowlist: readonly string[]
}

/** Parse a base58 address; returns null (not a throw) for an unparseable value. */
function parsePubkey(value: string): PublicKey | null {
  try {
    return new PublicKey(value)
  } catch {
    return null
  }
}

/**
 * Create the read-only devnet RedaxDataSource. The runtime program id comes from
 * config; the Connection is built from the validated rpcUrl only when none is
 * injected. The config mode (default DEVNET_READONLY) is stamped on every result
 * envelope and the environment view; nothing else differs between the two
 * read-only modes. No env read, no wallet, no transaction, no mock fallback.
 */
export function createRedaxDevnetDataSource(config: RedaxDevnetDataSourceConfig): RedaxDataSource {
  const connection = config.connection ?? new Connection(config.rpcUrl, readOnlyRpcConfig())
  const programId = new PublicKey(config.programId)
  const coder = buildAccountsCoder(config.programId)
  const mode: RedaxDevnetProgramAppMode = config.mode ?? 'DEVNET_READONLY'
  const { devnetOk, devnetError } = createDevnetResultBuilders(mode)

  // The curated public-listing membership set, frozen at construction.
  //
  // FAIL CLOSED ON AN UNTYPED CALLER. The config member is REQUIRED in TypeScript, and
  // that is what catches an ordinary omission; a plain JavaScript caller that omits it,
  // or hands something that is not an array, lands here instead and gets the EMPTY set
  // — which lists nothing. There is no fail-open default anywhere on this path.
  //
  // It is a Set of exact base58 strings and holds no PublicKey, so membership is
  // decided by exact address equality with no parse, no normalization and no
  // near-match. It is read only by `readListedCampaigns` below.
  const listedCampaignIds: ReadonlySet<string> = new Set<string>(
    Array.isArray(config.campaignAllowlist) ? config.campaignAllowlist : [],
  )

  const nowSec = (): number => Math.floor(Date.now() / 1000)

  // --- Concurrency-safe in-flight de-duplication -----------------------------
  //
  // One App load fans out to several members that ask for the SAME underlying
  // account state at the same instant: getDirectoryRows, getFeaturedCampaigns and
  // getCampaigns each want the campaign list, and getCampaignById /
  // getTokenConfigsForCampaign / getCampaignInputSummary each re-read the same
  // campaign account. Each of those used to be its own RPC round trip, and
  // getProgramAccounts is the first method a public unkeyed endpoint rate-limits.
  //
  // WHAT IS SHARED IS THE IN-FLIGHT PROMISE, NEVER A SETTLED VALUE. The registry
  // entry is dropped as soon as the promise settles — on resolve AND on reject.
  // That distinction is the whole safety argument: Campaign status/counters and
  // TokenConfig counters are MUTABLE and must read fresh after a live transaction,
  // so a later call always starts a new request and can never be served a
  // remembered value. A rejected read is dropped for the same reason in reverse:
  // a transient failure must not become sticky for the life of the instance.
  const campaignListInFlight = new Map<
    string,
    Promise<Awaited<ReturnType<typeof fetchAllCampaigns>>>
  >()
  const campaignInFlight = new Map<
    string,
    Promise<Awaited<ReturnType<typeof fetchCampaignByAddress>>>
  >()
  const tokenConfigsInFlight = new Map<
    string,
    Promise<Awaited<ReturnType<typeof fetchTokenConfigsForCampaign>>>
  >()

  /** The campaign list, de-duplicated across concurrent consumers. */
  const readAllCampaigns = (): Promise<Awaited<ReturnType<typeof fetchAllCampaigns>>> =>
    shareInFlight(campaignListInFlight, 'campaigns', () =>
      withBoundedReadRetry(() => fetchAllCampaigns(connection, programId, coder)),
    )

  /** One campaign account, de-duplicated across concurrent consumers. */
  const readCampaignByAddress = (
    address: PublicKey,
  ): Promise<Awaited<ReturnType<typeof fetchCampaignByAddress>>> =>
    shareInFlight(campaignInFlight, address.toBase58(), () =>
      withBoundedReadRetry(() => fetchCampaignByAddress(connection, programId, coder, address)),
    )

  /** One campaign's token configs, de-duplicated across concurrent consumers. */
  const readTokenConfigsForCampaign = (
    address: PublicKey,
  ): Promise<Awaited<ReturnType<typeof fetchTokenConfigsForCampaign>>> =>
    shareInFlight(tokenConfigsInFlight, address.toBase58(), () =>
      withBoundedReadRetry(() =>
        fetchTokenConfigsForCampaign(connection, programId, coder, address),
      ),
    )

  /**
   * The CURATED campaign list — the ONE reader every multi-Campaign public member uses.
   *
   * GPA THEN FILTER, and the empty case skips the GPA entirely. An empty membership set
   * cannot admit anything, so asking the endpoint for every program-owned Campaign in
   * order to discard all of them would be a request nobody could use — and
   * getProgramAccounts is the first method a public unkeyed endpoint rate-limits. An
   * uncurated deployment therefore issues ZERO Campaign GPA rather than one.
   *
   * ADMISSION IS EXACT ADDRESS MEMBERSHIP AND NOTHING ELSE. No status, no metadata
   * state, no campaign admin, no window, no cap and no `Active` condition takes part:
   * `Active` is a SORT and DISPLAY input for the featured member below, and it is not
   * what makes a Campaign listable. An allowlisted Initialized, Paused or Finalized
   * Campaign stays listed; an Active Campaign nobody curated stays absent.
   *
   * It reuses `readAllCampaigns` unchanged, so the in-flight sharing, the bounded
   * retry, the settled-value discard and the transient-failure behaviour are all
   * exactly the ones already proven. It caches nothing of its own, remembers no
   * settled Campaign state, writes nothing and mutates nothing.
   */
  const readListedCampaigns = async (): Promise<
    Awaited<ReturnType<typeof fetchAllCampaigns>>
  > => {
    if (listedCampaignIds.size === 0) {
      return []
    }
    const all = await readAllCampaigns()
    return all.filter((located) => listedCampaignIds.has(located.address.toBase58()))
  }

  // Per-instance memo of decoded output-mint display metadata. Phase 1 metadata
  // is immutable once set (is_mutable = false, no update path), so caching a
  // decoded value is safe; a cached null (metadata not set / unreadable) simply
  // persists for this session and re-resolves on reload. fetchOutputTokenMetadata
  // never throws, so metadata can never fail a core read.
  //
  // The memo holds the PROMISE rather than the resolved value. Storing only the
  // settled value left a window in which every concurrent caller for the same mint
  // missed the cache and issued its own read — one App load asked for the same
  // immutable metadata account up to four times. Holding the promise closes that
  // window without changing what is remembered: the resolved value (including a
  // truthful null) still persists for the session. A rejection is evicted so a
  // metadata failure can never poison later reads for that mint.
  const outputMetadataCache = new Map<string, Promise<DecodedOutputTokenMetadata | null>>()

  function outputMetadataFor(outputMint: PublicKey): Promise<DecodedOutputTokenMetadata | null> {
    const key = outputMint.toBase58()
    const cached = outputMetadataCache.get(key)
    if (cached !== undefined) {
      return cached
    }
    const started = fetchOutputTokenMetadata(connection, outputMint)
    outputMetadataCache.set(key, started)
    started.then(undefined, () => {
      if (outputMetadataCache.get(key) === started) {
        outputMetadataCache.delete(key)
      }
    })
    return started
  }

  // Convert a caught error into a typed devnet result: a known account error maps
  // to its kind; any other (RPC/network) error maps to the supplied transport kind.
  function fromThrow<T>(
    error: unknown,
    transportKind: 'RPC_UNAVAILABLE' | 'GPA_UNAVAILABLE_OR_LIMITED',
  ): RedaxDataSourceResult<T> {
    if (error instanceof RedaxDevnetAccountError) {
      return devnetError<T>(error.kind)
    }
    return devnetError<T>(transportKind)
  }

  return {
    async getEnvironment() {
      return devnetOk(mapEnvironmentView(mode))
    },

    async getProtocolConfig() {
      try {
        const data = await fetchProtocolConfig(connection, programId, coder)
        return devnetOk<RedaxProtocolConfigView | null>(
          data ? mapProtocolConfigView(data) : null,
          nowSec(),
        )
      } catch (error) {
        return fromThrow<RedaxProtocolConfigView | null>(error, 'RPC_UNAVAILABLE')
      }
    },

    // CURATED. The public campaign list is the deployment's curated directory, never a
    // census of every program-owned Campaign account.
    async getCampaigns() {
      try {
        const located = await readListedCampaigns()
        const views = await Promise.all(
          located.map(async (c) =>
            mapCampaignView(c.address.toBase58(), c.data, await outputMetadataFor(c.data.outputMint)),
          ),
        )
        return devnetOk<readonly RedaxCampaignView[]>(views, nowSec())
      } catch (error) {
        return fromThrow<readonly RedaxCampaignView[]>(error, 'GPA_UNAVAILABLE_OR_LIMITED')
      }
    },

    async getCampaignById(campaignId) {
      const pubkey = parsePubkey(campaignId)
      if (!pubkey) {
        return devnetOk<RedaxCampaignView | null>(null)
      }
      try {
        const located = await readCampaignByAddress(pubkey)
        return devnetOk<RedaxCampaignView | null>(
          located
            ? mapCampaignView(
                located.address.toBase58(),
                located.data,
                await outputMetadataFor(located.data.outputMint),
              )
            : null,
          nowSec(),
        )
      } catch (error) {
        return fromThrow<RedaxCampaignView | null>(error, 'RPC_UNAVAILABLE')
      }
    },

    // No on-chain project account exists; readonly surfaces no project registry.
    async getProjects() {
      return devnetOk<readonly RedaxProjectView[]>([])
    },

    async getProjectById() {
      return devnetOk<RedaxProjectView | null>(null)
    },

    async getTokenConfigsForCampaign(campaignId) {
      const pubkey = parsePubkey(campaignId)
      if (!pubkey) {
        return devnetOk<readonly RedaxTokenConfigView[]>([])
      }
      try {
        const campaign = await readCampaignByAddress(pubkey)
        if (!campaign) {
          return devnetOk<readonly RedaxTokenConfigView[]>([])
        }
        const tokenConfigs = await readTokenConfigsForCampaign(pubkey)
        const outputMetadata = await outputMetadataFor(campaign.data.outputMint)
        return devnetOk<readonly RedaxTokenConfigView[]>(
          tokenConfigs.map((tc) =>
            mapTokenConfigView(tc.address.toBase58(), tc.data, campaign.data, outputMetadata),
          ),
          nowSec(),
        )
      } catch (error) {
        return fromThrow<readonly RedaxTokenConfigView[]>(error, 'GPA_UNAVAILABLE_OR_LIMITED')
      }
    },

    async getCampaignInputSummary(campaignId) {
      const pubkey = parsePubkey(campaignId)
      if (!pubkey) {
        return devnetOk<RedaxCampaignInputSummaryView | null>(null)
      }
      try {
        const campaign = await readCampaignByAddress(pubkey)
        if (!campaign) {
          return devnetOk<RedaxCampaignInputSummaryView | null>(null)
        }
        const tokenConfigs = await readTokenConfigsForCampaign(pubkey)
        const outputMetadata = await outputMetadataFor(campaign.data.outputMint)
        return devnetOk<RedaxCampaignInputSummaryView | null>(
          mapCampaignInputSummaryView(
            campaign.address.toBase58(),
            campaign.data,
            tokenConfigs,
            outputMetadata,
          ),
          nowSec(),
        )
      } catch (error) {
        return fromThrow<RedaxCampaignInputSummaryView | null>(error, 'GPA_UNAVAILABLE_OR_LIMITED')
      }
    },

    // No on-chain holder directory exists in readonly.
    async getHolderProfiles() {
      return devnetOk<readonly RedaxHolderView[]>([])
    },

    async getConnectedWalletRole(context: RedaxDataSourceContext) {
      const wallet = context.connectedWallet
      if (!wallet) {
        return devnetOk<RedaxRoleView>(publicReadonlyRole())
      }
      try {
        const protocolConfig = await fetchProtocolConfig(connection, programId, coder)
        const activePubkey = context.activeCampaignId ? parsePubkey(context.activeCampaignId) : null
        const campaign = activePubkey
          ? await readCampaignByAddress(activePubkey)
          : null
        return devnetOk<RedaxRoleView>(
          mapConnectedWalletRole(wallet, protocolConfig, campaign ? campaign.data : null),
          nowSec(),
        )
      } catch (error) {
        return fromThrow<RedaxRoleView>(error, 'RPC_UNAVAILABLE')
      }
    },

    async getConnectedWalletRoleContext(context: RedaxDataSourceContext) {
      const wallet = context.connectedWallet
      if (!wallet) {
        return devnetOk<RedaxWalletRoleContextView>({
          status: 'unconnected',
          shortPublicKey: null,
          matchedRoles: [],
        })
      }
      try {
        const protocolConfig = await fetchProtocolConfig(connection, programId, coder)
        const activePubkey = context.activeCampaignId ? parsePubkey(context.activeCampaignId) : null
        const campaign = activePubkey
          ? await readCampaignByAddress(activePubkey)
          : null
        return devnetOk<RedaxWalletRoleContextView>(
          mapConnectedWalletRoleContext(wallet, protocolConfig, campaign ? campaign.data : null),
          nowSec(),
        )
      } catch (error) {
        return fromThrow<RedaxWalletRoleContextView>(error, 'RPC_UNAVAILABLE')
      }
    },

    async getConnectedWalletHolderContext(context: RedaxDataSourceContext) {
      const wallet = context.connectedWallet
      if (!wallet) {
        return devnetOk<RedaxConnectedWalletHolderContextView>({
          status: 'unconnected',
          shortPublicKey: null,
          campaignId: null,
          legacyInputBalances: [],
          outputAta: null,
        })
      }
      const walletPubkey = parsePubkey(wallet)
      if (!walletPubkey) {
        return devnetOk<RedaxConnectedWalletHolderContextView>({
          status: 'unavailable',
          shortPublicKey: null,
          campaignId: null,
          legacyInputBalances: [],
          outputAta: null,
        })
      }
      const activeCampaignId = context.activeCampaignId
      const campaignPubkey = activeCampaignId ? parsePubkey(activeCampaignId) : null
      try {
        if (!activeCampaignId || !campaignPubkey) {
          return devnetOk<RedaxConnectedWalletHolderContextView>(
            mapConnectedWalletHolderContext(wallet, null, [], null),
          )
        }
        const campaign = await readCampaignByAddress(campaignPubkey)
        if (!campaign) {
          return devnetOk<RedaxConnectedWalletHolderContextView>(
            mapConnectedWalletHolderContext(wallet, activeCampaignId, [], null),
            nowSec(),
          )
        }
        const tokenConfigs = await readTokenConfigsForCampaign(campaignPubkey)
        const legacyInputBalances = await Promise.all(
          tokenConfigs.map(async (tc) =>
            mapConnectedWalletInputBalance(
              tc.address.toBase58(),
              tc.data,
              await readClassicAtaForOwner(connection, walletPubkey, tc.data.legacyMint),
            ),
          ),
        )
        const outputAta = mapConnectedWalletOutputAta(
          campaign.data.outputMint.toBase58(),
          await readClassicAtaForOwner(connection, walletPubkey, campaign.data.outputMint),
        )
        return devnetOk<RedaxConnectedWalletHolderContextView>(
          mapConnectedWalletHolderContext(wallet, activeCampaignId, legacyInputBalances, outputAta),
          nowSec(),
        )
      } catch (error) {
        return fromThrow<RedaxConnectedWalletHolderContextView>(error, 'RPC_UNAVAILABLE')
      }
    },

    // Holder eligibility/position reads (which carry a conversion quote) remain a
    // later devnet slice — typed-deferred here; read-only connected-wallet
    // balances/ATA are served by getConnectedWalletHolderContext above.
    async getHolderInputPositions(holderRef: RedaxHolderRef) {
      if (holderRef.kind === 'mock-holder') {
        return devnetError<readonly RedaxHolderInputPositionView[]>('UNSUPPORTED_HOLDER_REF')
      }
      if (holderRef.kind === 'public') {
        return devnetOk<readonly RedaxHolderInputPositionView[]>([])
      }
      return devnetError<readonly RedaxHolderInputPositionView[]>('HOLDER_BALANCE_DEFERRED')
    },

    async getHolderEligibilityForCampaign(holderRef: RedaxHolderRef) {
      if (holderRef.kind === 'mock-holder') {
        return devnetError<RedaxHolderEligibilityView>('UNSUPPORTED_HOLDER_REF')
      }
      return devnetError<RedaxHolderEligibilityView>('HOLDER_BALANCE_DEFERRED')
    },

    // Converted-event history is not on-chain state — typed-unavailable here.
    async getReceiptsForCampaign() {
      return devnetError<readonly RedaxReceiptView[]>('DEVNET_RECEIPTS_UNAVAILABLE')
    },

    async getReceiptsForHolder(holderRef: RedaxHolderRef) {
      if (holderRef.kind === 'mock-holder') {
        return devnetError<readonly RedaxReceiptView[]>('UNSUPPORTED_HOLDER_REF')
      }
      return devnetError<readonly RedaxReceiptView[]>('DEVNET_RECEIPTS_UNAVAILABLE')
    },

    async getReceiptsForTokenConfig() {
      return devnetError<readonly RedaxReceiptView[]>('DEVNET_RECEIPTS_UNAVAILABLE')
    },

    // Single just-executed convert receipt (Tier 1): decode this one
    // transaction's `Converted` event and reconcile it against the caller's
    // expected context, via the read-only receipt decoder. No history scan, no
    // indexer, no `DEVNET_RECEIPTS_UNAVAILABLE` (that stays history-only). A null
    // result (tx not visible / no matching event / identity mismatch) is not an
    // error; a transport/decode failure maps to RPC_UNAVAILABLE.
    async getConvertedReceiptForSignature(request) {
      try {
        const view = await decodeConvertedReceipt(
          { connection, programId: config.programId },
          request,
        )
        return devnetOk<RedaxConvertReceiptVerificationView | null>(view, nowSec())
      } catch (error) {
        return fromThrow<RedaxConvertReceiptVerificationView | null>(error, 'RPC_UNAVAILABLE')
      }
    },

    // CURATED directory rows from real campaigns; no holder personalization in this
    // slice. Same membership as getCampaigns and getFeaturedCampaigns, by construction:
    // all three read the one curated reader.
    async getDirectoryRows() {
      try {
        const located = await readListedCampaigns()
        const now = nowSec()
        return devnetOk<readonly RedaxDirectoryRowView[]>(
          located.map((c) => mapDirectoryRowView(c.address.toBase58(), c.data, now)),
          now,
        )
      } catch (error) {
        return fromThrow<readonly RedaxDirectoryRowView[]>(error, 'GPA_UNAVAILABLE_OR_LIMITED')
      }
    },

    // CURATED, then RANKED. The lifecycle rank below decides ORDER among Campaigns that
    // are already listed; it never decides membership, and an Active Campaign outside
    // the curated set is not reached by this member at all.
    async getFeaturedCampaigns(limit) {
      try {
        const located = await readListedCampaigns()
        const ordered = [...located].sort((a, b) => {
          const rankA = a.data.status === 'active' ? 0 : 1
          const rankB = b.data.status === 'active' ? 0 : 1
          if (rankA !== rankB) {
            return rankA - rankB
          }
          return a.address.toBase58().localeCompare(b.address.toBase58())
        })
        const limited = typeof limit === 'number' && limit >= 0 ? ordered.slice(0, limit) : ordered
        const views = await Promise.all(
          limited.map(async (c) =>
            mapCampaignView(c.address.toBase58(), c.data, await outputMetadataFor(c.data.outputMint)),
          ),
        )
        return devnetOk<readonly RedaxCampaignView[]>(views, nowSec())
      } catch (error) {
        return fromThrow<readonly RedaxCampaignView[]>(error, 'GPA_UNAVAILABLE_OR_LIMITED')
      }
    },

    // All Phase 1 transaction actions are disabled in the read-only devnet modes.
    async getAvailableActions() {
      return devnetOk(mapReadonlyActions())
    },
  }
}

// --- Read-only transport policy ------------------------------------------------

/**
 * The read-only Connection configuration.
 *
 * `disableRetryOnRateLimit` is deliberately TRUE, and that is the opposite of what
 * it looks like. The pinned `@solana/web3.js` 1.98.4 rpc client, left at its
 * default, answers HTTP 429 with its own hidden loop: up to five attempts with a
 * 500ms delay that doubles each time. A single logical read could therefore span
 * five HTTP attempts and several seconds before the caller learns anything, and a
 * bounded retry layered on top of that would multiply the two budgets into an
 * uncontrolled nested retry — attempts nobody chose, at a cadence nobody can see.
 *
 * Turning the hidden loop off makes the retry budget exactly the one written down
 * in `withBoundedReadRetry`: one initial attempt and at most one bounded retry, all
 * of it observable at this layer. This is a READ-ONLY transport policy and touches
 * no signing, sending or attempt-scoped Connection — those are constructed at their
 * own owning sites and are not affected by anything in this module.
 */
function readOnlyRpcConfig(): { commitment: 'confirmed'; disableRetryOnRateLimit: true } {
  return { commitment: 'confirmed', disableRetryOnRateLimit: true }
}

/** Total logical attempts per underlying read: the initial one plus ONE retry. */
const REDAX_READ_MAX_ATTEMPTS = 2
/** Bounded pause before the single retry when the endpoint reported rate limiting. */
const REDAX_READ_RATE_LIMIT_BACKOFF_MS = 1200
/** Bounded pause before the single retry for any other transient transport failure. */
const REDAX_READ_TRANSIENT_BACKOFF_MS = 400

/**
 * Did the endpoint report rate limiting?
 *
 * The pinned client surfaces a non-ok response as `Error("<status> <statusText>: <body>")`
 * and does not expose response headers, so `Retry-After` is NOT safely observable
 * here — the status is. A rate-limited retry therefore waits a bounded constant
 * chosen by this module rather than a server-advertised delay: the wait is capped by
 * construction, never read from an untrusted body, and never unbounded. If a future
 * transport makes `Retry-After` observable, honoring it must still clamp to a cap.
 */
function isRateLimitedReadError(error: unknown): boolean {
  return error instanceof Error && /(^|\D)429(\D|$)/.test(error.message)
}

/**
 * May this failed read be attempted once more?
 *
 * `RedaxDevnetAccountError` is this adapter's SEMANTIC channel: it is thrown only
 * for `ACCOUNT_DECODE_FAILED` and `ACCOUNT_OWNER_MISMATCH` — a malformed, non-canonical
 * or wrong-owner account. Those are facts about what the chain holds; they do not
 * become different on a second attempt, and retrying one would only delay a
 * fail-closed answer while implying the adapter doubted it. Identity and decode
 * failures stay fail-closed on the FIRST answer.
 *
 * Everything else reaching here is transport — an unreachable endpoint, a dropped
 * socket, a rate-limited response — which is exactly the class the live diagnosis
 * reproduced and the only class this retry exists for.
 */
function isRetryableReadError(error: unknown): boolean {
  return !(error instanceof RedaxDevnetAccountError)
}

/** A bounded pause. Uses the ambient timer so a test may drive it deterministically. */
function delayForRetry(milliseconds: number): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds)
  })
}

/**
 * Run one read with at most ONE bounded retry, and only for a transient transport
 * failure. Never retries a decode, owner or identity failure; never applies to a
 * signing, sending or confirmation path, none of which exist in this module.
 */
async function withBoundedReadRetry<T>(read: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await read()
    } catch (error) {
      if (attempt >= REDAX_READ_MAX_ATTEMPTS || !isRetryableReadError(error)) {
        throw error
      }
      await delayForRetry(
        isRateLimitedReadError(error)
          ? REDAX_READ_RATE_LIMIT_BACKOFF_MS
          : REDAX_READ_TRANSIENT_BACKOFF_MS,
      )
    }
  }
}

/**
 * Share one in-flight promise per key, and forget it the moment it settles.
 *
 * The identity check before deleting matters: by the time an entry settles, a later
 * call may already have installed a NEWER promise under the same key, and deleting
 * blindly would evict that live entry and let the next caller start a third request.
 */
function shareInFlight<T>(
  registry: Map<string, Promise<T>>,
  key: string,
  start: () => Promise<T>,
): Promise<T> {
  const existing = registry.get(key)
  if (existing !== undefined) {
    return existing
  }
  const started = start()
  registry.set(key, started)
  const forget = (): void => {
    if (registry.get(key) === started) {
      registry.delete(key)
    }
  }
  started.then(forget, forget)
  return started
}
