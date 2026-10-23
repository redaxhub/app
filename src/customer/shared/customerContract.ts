// REDAX customer service — the ONE API contract, shared by the browser and the server.
//
// WHAT THIS SERVICE IS FOR. A customer REDAX has accepted signs in with their own Team wallet,
// keeps private drafts of their campaigns, uploads a logo, reviews one frozen plan and has the
// exact token details published before their wallet ever approves a chain step. The service
// stores private drafts and coordinates; it never holds a key, never builds, signs or sends a
// transaction and never relays one. Every chain write is still the customer's own wallet
// approving the existing REDAX transaction roots in the browser.
//
// ONE ENDPOINT, ONE OPERATION PER REQUEST. Every call goes to `/api/v1?op=<name>` so the whole
// service is one Vercel Function. Endpoint count is not function count, and nothing here
// depends on rewrites. The operation set below is closed: an unknown `op` is a 404, never a
// fallback to some default behaviour.
//
// SERVER-SAFE BY CONSTRUCTION: no imports, no DOM, no environment.

export const REDAX_CUSTOMER_API_PATH = '/api/v1'

/**
 * A custom header every request must carry. A cross-site form or image cannot set it, and a
 * cross-origin `fetch` that sets it triggers a CORS preflight this API never answers — so its
 * presence, together with the exact `Origin` check on writes, is the CSRF boundary.
 */
export const REDAX_CUSTOMER_REQUEST_HEADER = 'x-redax-request'

/**
 * The NON-SECRET id of the session the page believes it holds, echoed on every write. Two
 * tabs share one cookie jar; when one tab signs in as another wallet, the other tab's stale
 * writes are refused as `SESSION_CHANGED` instead of landing in the new session's workspace.
 */
export const REDAX_CUSTOMER_SESSION_HEADER = 'x-redax-session'

/** `__Host-`: Secure, host-only (no Domain attribute), Path=/ — enforced by the browser. */
export const REDAX_CUSTOMER_SESSION_COOKIE = '__Host-redax_session'

/**
 * This browser's coordination handle for the sticky Team-write claim: random, HttpOnly, set by
 * the server and never readable by JavaScript. It outlives sessions on purpose — signing in
 * again is not a new owner — and it is not authentication.
 */
export const REDAX_CUSTOMER_BROWSER_COOKIE = '__Host-redax_browser'
export const REDAX_CUSTOMER_BROWSER_COOKIE_MAX_AGE_SECONDS = 400 * 24 * 60 * 60

/** The fixed SIWS statement. A wallet shows it; the server requires it byte for byte. */
export const REDAX_CUSTOMER_SIWS_STATEMENT =
  'Sign in to REDAX on Solana Devnet. This free message signature does not send a transaction or move funds.'

export const REDAX_CUSTOMER_SIWS_CHAIN_ID = 'solana:devnet'
export const REDAX_CUSTOMER_SIWS_VERSION = '1'

/** How long a sign-in challenge may be answered, and how long a session lasts. */
export const REDAX_CUSTOMER_CHALLENGE_TTL_SECONDS = 600
export const REDAX_CUSTOMER_SESSION_TTL_SECONDS = 8 * 60 * 60

/** 1–10 legacy inputs per CAMPAIGN. It is not a limit on how many campaigns a wallet runs. */
export const REDAX_CUSTOMER_MAX_INPUT_ROWS = 10
export const REDAX_CUSTOMER_MAX_SETUPS_PER_WALLET = 50
export const REDAX_CUSTOMER_SETUPS_PAGE_SIZE = 10
export const REDAX_CUSTOMER_GRANTS_PAGE_SIZE = 25

/** The largest logo file a customer may upload, before decoding. */
export const REDAX_CUSTOMER_LOGO_MAX_INPUT_BYTES = 2 * 1024 * 1024
/** The published logo is a square PNG of at most this edge. */
export const REDAX_CUSTOMER_LOGO_MAX_EDGE = 512
/** A smaller source than this is refused: it would be visibly blurred in every wallet. */
export const REDAX_CUSTOMER_LOGO_MIN_EDGE = 64
/** The decoder refuses any source above this many pixels before allocating it. */
export const REDAX_CUSTOMER_LOGO_MAX_INPUT_PIXELS = 25_000_000
/** The normalized PNG may not exceed this many bytes. */
export const REDAX_CUSTOMER_LOGO_MAX_OUTPUT_BYTES = 1024 * 1024

export const REDAX_CUSTOMER_DESCRIPTION_MAX_CHARS = 300
export const REDAX_CUSTOMER_METADATA_JSON_MAX_BYTES = 16 * 1024
/** The output mint decimals every REDAX Phase 1 campaign uses (enforced by the program). */
export const REDAX_CUSTOMER_OUTPUT_DECIMALS = 9
/** The protocol conversion fee, in basis points, FLOOR-rounded and accrued (unchanged). */
export const REDAX_CUSTOMER_PROTOCOL_FEE_BPS = 100

// --- Access ---------------------------------------------------------------------------

/**
 * A customer's service access, set by a REDAX operator.
 *
 * `ACTIVE`   — may start new campaigns and manage existing ones.
 * `STOP_NEW` — may NOT start anything new (no new draft, no new publication, no new Create),
 *              but keeps finishing a setup whose campaign already exists on chain, managing
 *              their own campaigns and reading their own records.
 *
 * Access is a SERVICE decision about this app. It is not an on-chain whitelist, not proof of
 * mint ownership and not a verification badge for any campaign.
 */
export type RedaxCustomerGrantStatus = 'ACTIVE' | 'STOP_NEW'

export interface RedaxCustomerPermissions {
  /** Draft, upload, publish and Create a NEW campaign. */
  readonly create: boolean
  /** Finish the remaining steps of a setup whose campaign already exists on chain. */
  readonly completeStartedSetup: boolean
  /** Pause, unpause and finalize the customer's own campaigns. */
  readonly manageExisting: boolean
  /** Read own records and check the status of own attempts. Always true with a session. */
  readonly readReconcile: true
}

/** The Team chain writes the service coordinates. Exactly the existing REDAX operations. */
export type RedaxCustomerTeamWriteOperation =
  | 'CREATE_CAMPAIGN'
  | 'ADD_TOKEN_CONFIG'
  | 'SETUP_METADATA'
  | 'ACTIVATE_CAMPAIGN'
  | 'PAUSE_CAMPAIGN'
  | 'UNPAUSE_CAMPAIGN'
  | 'FINALIZE_CAMPAIGN'

export const REDAX_CUSTOMER_TEAM_WRITE_OPERATIONS: readonly RedaxCustomerTeamWriteOperation[] =
  Object.freeze([
    'CREATE_CAMPAIGN',
    'ADD_TOKEN_CONFIG',
    'SETUP_METADATA',
    'ACTIVATE_CAMPAIGN',
    'PAUSE_CAMPAIGN',
    'UNPAUSE_CAMPAIGN',
    'FINALIZE_CAMPAIGN',
  ])

export interface RedaxCustomerMe {
  readonly wallet: string
  /** Non-secret session id; echoed in `x-redax-session` on writes. */
  readonly sessionId: string
  readonly expiresAt: number
  readonly operator: boolean
  readonly grant: { readonly status: RedaxCustomerGrantStatus; readonly updatedAt: number } | null
  readonly permissions: RedaxCustomerPermissions
}

export interface RedaxCustomerGrantRecordV1 {
  readonly schema: 'redax.customer.grant.v1'
  readonly wallet: string
  readonly status: RedaxCustomerGrantStatus
  readonly note: string
  readonly revision: number
  readonly createdAt: number
  readonly updatedAt: number
  readonly updatedBy: string
}

export interface RedaxCustomerGrantSummary {
  readonly wallet: string
  readonly status: RedaxCustomerGrantStatus
  readonly note: string
  readonly revision: number
  readonly updatedAt: number
}

// --- Drafts, logos, plans ----------------------------------------------------------------

export type RedaxCustomerLimitMode = 'LIMIT' | 'NONE'
export type RedaxCustomerEndMode = 'NONE' | 'DATE'
export type RedaxCustomerEndZone = 'DEVICE' | 'UTC'

/** One legacy input row, as the customer typed it. Human units only. */
export interface RedaxCustomerDraftRowV1 {
  /** Stable local id; never a chain identity. */
  readonly rowId: string
  readonly legacyMint: string
  /** Filled from a read-only mint read. `null` until that read succeeded. */
  readonly legacyDecimals: number | null
  /** X old tokens… */
  readonly oldAmount: string
  /** …become Y gross new tokens (before the 1% fee). */
  readonly newAmount: string
  readonly limitMode: RedaxCustomerLimitMode | null
  /** Gross NEW tokens this input may mint in total. Only read with `LIMIT`. */
  readonly limitAmount: string
}

/** The server-produced logo the draft uses. The client can only clear or accept it. */
export interface RedaxCustomerLogoRefV1 {
  readonly sha256: string
  readonly byteLength: number
  readonly width: number
  readonly height: number
  readonly sourceFormat: 'png' | 'jpeg' | 'webp'
  readonly sourceWidth: number
  readonly sourceHeight: number
  readonly sourceByteLength: number
  /** True when the final square PNG differs in size or framing from the upload. */
  readonly transformed: boolean
  /** The customer explicitly accepted THIS final image. Required to review. */
  readonly accepted: boolean
}

export interface RedaxCustomerDraftV1 {
  readonly name: string
  readonly symbol: string
  readonly description: string
  readonly logo: RedaxCustomerLogoRefV1 | null
  readonly rows: readonly RedaxCustomerDraftRowV1[]
  readonly totalLimitMode: RedaxCustomerLimitMode | null
  readonly totalLimitAmount: string
  readonly endMode: RedaxCustomerEndMode | null
  /** `datetime-local` text as typed. */
  readonly endLocal: string
  readonly endZone: RedaxCustomerEndZone
  /** The device's IANA zone when the date was entered — display only. */
  readonly endZoneName: string
  /** Exact Unix seconds the browser computed from `endLocal` + `endZone`; '' when none. */
  readonly endUnixSeconds: string
}

/** One accepted input in the frozen plan: what the customer typed AND the exact raw terms. */
export interface RedaxCustomerPlanRowV1 {
  readonly rowId: string
  readonly legacyMint: string
  readonly legacyDecimals: number
  readonly oldAmount: string
  readonly newAmount: string
  readonly rateNumerator: string
  readonly rateDenominator: string
  readonly limitMode: RedaxCustomerLimitMode
  readonly limitAmount: string
  /** Raw output base units; '0' is the program's "no per-input limit". */
  readonly maxOutputFromTokenConfig: string
}

/** The exact public files the plan commits to. Content-addressed, create-only. */
export interface RedaxCustomerPublicationV1 {
  readonly imageUri: string
  readonly imageSha256: string
  readonly imageByteLength: number
  readonly imageWidth: number
  readonly imageHeight: number
  readonly jsonUri: string
  readonly jsonSha256: string
  readonly jsonByteLength: number
}

/**
 * THE FROZEN PLAN — everything the one master review approves, and nothing else.
 *
 * Produced by the server from a complete draft, hashed canonically (`planHash`), and never
 * edited: any later draft edit discards it. Every guided chain step is checked against these
 * exact values and these exact public commitments.
 */
export interface RedaxCustomerPlanV1 {
  readonly schema: 'redax.customer.plan.v1'
  readonly setupId: string
  readonly network: 'devnet'
  readonly programId: string
  readonly teamWallet: string
  readonly token: {
    /** NFC-normalized, 1..32 UTF-8 bytes. */
    readonly name: string
    /** NFC-normalized, 1..10 UTF-8 bytes. */
    readonly symbol: string
    readonly description: string
  }
  readonly outputDecimals: number
  readonly protocolFeeBps: number
  readonly rows: readonly RedaxCustomerPlanRowV1[]
  readonly totalLimit: {
    readonly mode: RedaxCustomerLimitMode
    readonly amount: string
    /** Raw output base units; '0' is the program's "no campaign-wide limit". */
    readonly maxOutputSupply: string
  }
  readonly end: {
    readonly mode: RedaxCustomerEndMode
    /** Exact Unix seconds, or '' with `NONE`. */
    readonly unixSeconds: string
    readonly local: string
    readonly zone: RedaxCustomerEndZone
    readonly zoneName: string
  }
  readonly publication: RedaxCustomerPublicationV1
  readonly preparedAt: number
}

/** The S1 attempt identities this setup's own requests actually carried, newest last. */
export interface RedaxCustomerCreateAttemptV1 {
  readonly campaign: string
  readonly outputMint: string
  readonly planFingerprint: string
  readonly at: number
}

export type RedaxCustomerSetupState = 'DRAFT' | 'REVIEW_READY' | 'PUBLISHED' | 'STARTED'

export interface RedaxCustomerSetupRecordV1 {
  readonly schema: 'redax.customer.setup.v1'
  readonly id: string
  readonly owner: string
  readonly network: 'devnet'
  readonly programId: string
  readonly revision: number
  readonly createdAt: number
  readonly updatedAt: number
  /**
   * `DRAFT`        — editable; nothing public exists.
   * `REVIEW_READY` — a frozen plan exists; nothing public exists yet.
   * `PUBLISHED`    — the plan's exact public files were published; no campaign is bound yet.
   * `STARTED`      — a campaign this wallet administers on chain is bound, verified by the
   *                  server's own exact-address read; the remaining steps come from the plan.
   */
  readonly state: RedaxCustomerSetupState
  readonly draft: RedaxCustomerDraftV1
  readonly plan: RedaxCustomerPlanV1 | null
  readonly planHash: string | null
  readonly publishedAt: number | null
  readonly attempts: readonly RedaxCustomerCreateAttemptV1[]
  readonly campaign: {
    readonly address: string
    readonly outputMint: string
    readonly planFingerprint: string
    readonly boundAt: number
  } | null
}

/** What the campaign list shows per item. */
export interface RedaxCustomerSetupSummary {
  readonly id: string
  readonly state: RedaxCustomerSetupState
  readonly revision: number
  readonly name: string
  readonly symbol: string
  readonly inputCount: number
  readonly campaign: string | null
  readonly outputMint: string | null
  readonly createdAt: number
  readonly updatedAt: number
}

// --- Coordination ------------------------------------------------------------------------

/**
 * The sticky Team-write claim, as the page sees it.
 *
 * `FREE`  — no unresolved Team chain write is recorded for this wallet.
 * `MINE`  — THIS browser holds it (the same browser that started the write).
 * `OTHER` — another browser holds it; only that browser can resolve it. This page may still
 *           read, save drafts and share links, but starts no new chain write.
 *
 * `leaseId` is shown to the HOLDING browser only (`MINE`). It names the one admitted attempt
 * generation the claim is held for, and a release must carry exactly it: evidence that an
 * EARLIER attempt is settled can never release a newer one.
 */
export interface RedaxCustomerClaimView {
  readonly state: 'FREE' | 'MINE' | 'OTHER'
  readonly setupId: string | null
  readonly operation: RedaxCustomerTeamWriteOperation | null
  readonly campaign: string | null
  readonly heldAt: number | null
  readonly leaseId: string | null
}

export interface RedaxCustomerClaimRecordV1 {
  readonly schema: 'redax.customer.claim.v1'
  readonly team: string
  readonly network: 'devnet'
  readonly programId: string
  readonly state: 'FREE' | 'HELD'
  readonly revision: number
  /** SHA-256 of the holding browser's handle. A coordination token, not authentication. */
  readonly holderHash: string | null
  /**
   * The admitted attempt generation, minted by the server for each new admission and never
   * reused. Only a release that names exactly this lease can free the claim.
   */
  readonly leaseId: string | null
  /** The page's id for the admission request, so a repeated delivery of it is the same lease. */
  readonly attemptId: string | null
  /** SHA-256 of the exact admitted request (setup, plan hash and chain request). */
  readonly requestSha256: string | null
  readonly setupId: string | null
  readonly planHash: string | null
  readonly operation: RedaxCustomerTeamWriteOperation | null
  readonly campaign: string | null
  readonly heldAt: number | null
  readonly updatedAt: number
}

/** The exact chain request a claim is entered for. The server checks it against the plan. */
export type RedaxCustomerClaimRequest =
  | {
      readonly operation: 'CREATE_CAMPAIGN'
      readonly campaign: string
      readonly outputMint: string
      readonly planFingerprint: string
    }
  | {
      readonly operation: 'ADD_TOKEN_CONFIG'
      readonly campaign: string
      readonly legacyMint: string
      readonly rateNumerator: string
      readonly rateDenominator: string
      readonly maxOutputFromTokenConfig: string
    }
  | {
      readonly operation: 'SETUP_METADATA'
      readonly campaign: string
      readonly metadataName: string
      readonly metadataSymbol: string
      readonly metadataUri: string
    }
  | {
      readonly operation: 'ACTIVATE_CAMPAIGN' | 'PAUSE_CAMPAIGN' | 'UNPAUSE_CAMPAIGN' | 'FINALIZE_CAMPAIGN'
      readonly campaign: string
    }

// --- Errors ------------------------------------------------------------------------------

export type RedaxCustomerErrorCode =
  | 'BAD_REQUEST'
  | 'UNKNOWN_OPERATION'
  | 'METHOD_NOT_ALLOWED'
  | 'ORIGIN_REFUSED'
  | 'NOT_SIGNED_IN'
  | 'SESSION_CHANGED'
  | 'SIGN_IN_REFUSED'
  | 'NO_ACCESS'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'STALE_REVISION'
  | 'INVALID_STATE'
  | 'PLAN_INVALID'
  | 'LIMIT_REACHED'
  | 'PAYLOAD_TOO_LARGE'
  | 'UNSUPPORTED_IMAGE'
  | 'CLAIM_HELD_ELSEWHERE'
  | 'CLAIM_NOT_HELD'
  | 'CLAIM_LEASE_CHANGED'
  | 'ATTEMPT_ALREADY_USED'
  | 'PUBLICATION_CONFLICT'
  | 'PUBLICATION_UNAVAILABLE'
  | 'PUBLICATION_MISMATCH'
  | 'CHAIN_UNAVAILABLE'
  | 'CHAIN_MISMATCH'
  | 'STORE_UNAVAILABLE'
  | 'RATE_LIMITED'
  | 'NOT_CONFIGURED'
  | 'INTERNAL'

export interface RedaxCustomerErrorBody {
  readonly ok: false
  readonly code: RedaxCustomerErrorCode
  readonly message: string
}

/** Short, customer-facing copy per code. Never a stack, a path, a key or a provider message. */
export function describeRedaxCustomerError(code: RedaxCustomerErrorCode): string {
  switch (code) {
    case 'BAD_REQUEST':
      return 'The request was not valid.'
    case 'UNKNOWN_OPERATION':
      return 'This action does not exist.'
    case 'METHOD_NOT_ALLOWED':
      return 'This action does not accept that request method.'
    case 'ORIGIN_REFUSED':
      return 'Requests are only accepted from the REDAX app itself.'
    case 'NOT_SIGNED_IN':
      return 'Please sign in again.'
    case 'SESSION_CHANGED':
      return 'Your session changed in another tab. Reload your workspace.'
    case 'SIGN_IN_REFUSED':
      return 'The sign-in message could not be verified. Nothing was changed; please sign in again.'
    case 'NO_ACCESS':
      return 'This wallet does not have access yet.'
    case 'FORBIDDEN':
      return 'Your access does not allow this action.'
    case 'NOT_FOUND':
      return 'Not found.'
    case 'STALE_REVISION':
      return 'This item changed somewhere else. Reload it before continuing.'
    case 'INVALID_STATE':
      return 'This step is not available in the current state.'
    case 'PLAN_INVALID':
      return 'Some details are missing or not valid yet.'
    case 'LIMIT_REACHED':
      return 'The limit for this workspace was reached.'
    case 'PAYLOAD_TOO_LARGE':
      return 'The file is too large.'
    case 'UNSUPPORTED_IMAGE':
      return 'Use a PNG, JPEG or WebP image of at least 64 × 64 pixels.'
    case 'CLAIM_HELD_ELSEWHERE':
      return 'A chain step for this wallet is still unresolved in another browser. Open it there and use Check status.'
    case 'CLAIM_NOT_HELD':
      return 'This browser does not hold the step it tried to finish.'
    case 'CLAIM_LEASE_CHANGED':
      return 'A newer chain step for this wallet started in this browser, so nothing was released. Check its status first.'
    case 'ATTEMPT_ALREADY_USED':
      return 'This step request was already used once. Nothing was changed; start the step again.'
    case 'PUBLICATION_CONFLICT':
      return 'A different file already exists at a published location. Nothing was overwritten.'
    case 'PUBLICATION_UNAVAILABLE':
      return 'The published token details could not be read just now. Nothing was sent; try again shortly.'
    case 'PUBLICATION_MISMATCH':
      return 'The published token details do not match the reviewed plan. Nothing was sent.'
    case 'CHAIN_UNAVAILABLE':
      return 'Solana Devnet could not be read just now. Try again shortly.'
    case 'CHAIN_MISMATCH':
      return 'The campaign on chain does not match this setup.'
    case 'STORE_UNAVAILABLE':
      return 'The REDAX service is temporarily unavailable. Your saved data is kept; try again later.'
    case 'RATE_LIMITED':
      return 'Too many requests. Please wait a moment.'
    case 'NOT_CONFIGURED':
      return 'The REDAX customer service is not configured on this deployment.'
    case 'INTERNAL':
      return 'Something went wrong. Nothing was sent.'
    default: {
      const exhaustive: never = code
      return exhaustive
    }
  }
}

/** The SIWS input shape the server issues and a wallet signs. */
export interface RedaxCustomerSignInInput {
  readonly domain: string
  readonly address: string
  readonly statement: string
  readonly uri: string
  readonly version: string
  readonly chainId: string
  readonly nonce: string
  readonly issuedAt: string
  readonly expirationTime: string
}

/** Public service configuration for the page. No secret, no store id, no path. */
export interface RedaxCustomerServiceConfigView {
  readonly configured: boolean
  /** The one origin Team sign-in works on, e.g. `https://app.redaxhub.com`. */
  readonly signInOrigin: string
  readonly signInHere: boolean
  readonly network: 'devnet'
  readonly programId: string | null
}
