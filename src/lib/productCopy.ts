// REDAX product copy — single source of truth for app shell strings.

import type { TeamAdminWizardFieldId } from './teamAdminWizardDraft'

export const PRODUCT_NAME = 'REDAX'

export const PRODUCT_TAGLINE =
  'Proof-bounded conversion infrastructure for classic-SPL token supply transitions on Solana.'

export const PRODUCT_DEFINITION =
  'REDAX Phase 1 is a bounded, same-chain, classic-SPL burn-to-mint campaign primitive: a holder burns an accepted old token and receives a configured output token under published campaign constraints — rate, output cap, campaign window, and a disclosed protocol fee.'

export const STAGE_LABEL = 'Proof-bounded app shell'

export const STAGE_BOUNDARY =
  'Mode-aware REDAX interface: the current mode determines whether data comes from local fixtures or devnet program/RPC reads. Transaction actions stay disabled outside DEVNET_TX_ENABLED. In DEVNET_TX_ENABLED the Holder surface offers two wallet-approved, devnet-only steps when eligible — preparing a holder’s output token account, and converting a chosen accepted input after an explicit burn acknowledgement and wallet approval — and the Team workspace lets a Team wallet that has signed in and been given access create a campaign and run its six post-init campaign steps. Every one of them runs only from an explicit click and a wallet approval. No readiness or production claim.'

// --- Proof boundary -------------------------------------------------------

export const PROOF_BOUNDARY_TITLE = 'Proof, not guarantee'

export const PROOF_BOUNDARY_BODY =
  'REDAX is designed to prove the mechanical facts of each conversion on-chain — burn, mint, rate, fee, and cap/window checks. Proof is not a guarantee of legitimacy, safety, liquidity, or price.'

export const PROVES: readonly string[] = [
  'a burn of the old token happened',
  'a mint of the output token happened',
  'the disclosed protocol fee was applied',
  'the configured rate was applied',
  'cap and window checks were applied',
  'the configured campaign and token config were used',
]

export const DOES_NOT_PROVE: readonly string[] = [
  'project legitimacy',
  'token value',
  'liquidity safety',
  'fair team behavior',
  'vesting correctness',
  'treasury behavior',
  'market outcome',
  'non-rug status',
]

// --- Use cases (the product is not reduced to any single one) --------------

export interface UseCaseCopy {
  readonly title: string
  readonly tag: string
  readonly body: string
}

export const USE_CASES: readonly UseCaseCopy[] = [
  {
    title: 'Token & project team devnet trial',
    tag: 'Required near-term use case',
    body: 'Real token and project teams evaluate REDAX campaign mechanics — campaign setup, accepted inputs, rates, caps, windows, and proof surfaces — as a devnet product trial. The current mode determines whether the surface uses local fixtures or devnet program/RPC data. In the devnet transaction mode a holder can prepare an output token account and convert a chosen accepted input after an explicit burn acknowledgement and wallet approval, and a Team wallet that has signed in and been given access can create a campaign in the Team workspace and then add its accepted inputs, set the output token metadata once, activate, pause, unpause or finalize it. Each of those exists as a product surface and each runs only from an explicit click and a wallet approval; a surface existing is not evidence that any particular step has been executed. No readiness, production, public-launch, fundraising, token-launch, or project-verification claim.',
  },
  {
    title: 'Investor walkthrough',
    tag: 'One required use case — not the only one',
    body: 'The same product surfaces support a guided walkthrough of campaign mechanics and proof receipts. The walkthrough rides on the real product shell; REDAX is not reduced to a demo skin.',
  },
  {
    title: 'Observer verification',
    tag: 'Read-only proof surface',
    body: 'Read-only surfaces are designed so that anyone can check what a conversion actually did on-chain — without trusting this interface or the campaign operator.',
  },
]

// --- Quality bar -----------------------------------------------------------

export const QUALITY_BAR_TITLE = 'Mainnet-grade craft, claimed as craft only'

export const QUALITY_BAR_BODY =
  'The UX quality bar is mainnet-grade: the same UX language — environment labels, proof receipts, copy boundaries — is built to carry forward. That is a statement about care, not a claim of mainnet, devnet, audit, or production readiness. The mainnet path is a future path under separate gates and separate review.'

// --- Phase 1 scope ----------------------------------------------------------

export const PHASE_1_SCOPE_TITLE = 'Phase 1 boundaries, stated plainly'

export const PHASE_1_SCOPE_NOTES: readonly string[] = [
  'Phase 1 is classic SPL only. Token-2022 remains Phase 2+ scope; a Token-2022 or otherwise unsupported token is rejected with an explicit unsupported reason.',
  'No MFT receipt token, no claim window, no refund path, no LP or AMM integration, and no team/vesting/treasury automation exist in Phase 1 — those surfaces remain outside the protocol.',
  'The output token is a different asset from the burned old token. External integrations may not recognize the new asset automatically.',
  'Liquidity, team behavior, vesting, and treasury remain outside REDAX; the protocol neither automates nor vouches for them.',
]

// --- Irreversibility ---------------------------------------------------------

export const BURN_WARNING_TITLE = 'Irreversible burn'

export const BURN_WARNING_BODY =
  'Converting permanently burns old-mint tokens. There is no undo, and REDAX cannot reverse a burn; Phase 1 has no refund path. The live surface will require an explicit, consequence-specific acknowledgement before any conversion is signed.'

export const REJECTED_BEFORE_BURN_NOTE =
  'Checks run before any token movement: a conversion rejected by the program — cap reached, window closed, unsupported token, wrong mint — leaves the holder balance untouched. Nothing partially executes.'

// --- Build boundary list (not currently rendered; kept truthful for reuse) ---

export const STAGE_0_BOUNDARIES: readonly string[] = [
  'MOCK_LOCAL and the read-only devnet modes offer no conversion path and run no transaction. In DEVNET_TX_ENABLED, when eligible, the Holder surface offers two wallet-approved, devnet-only steps — preparing an output token account, and converting a chosen accepted input after an explicit burn acknowledgement and wallet approval; the Team surface additionally offers seven deploy-config-gated devnet steps — creating a campaign, and then, for a campaign that already exists, adding one accepted input token config, setting its single-shot output token metadata, activating it, pausing it, unpausing it and finalizing it — with read-only submission-status checks beside them, and none of this is a readiness claim. Wallet connection in DEVNET_WALLET_READONLY stays read-only context only — user-initiated connect/disconnect and address display, with no signing path and no transaction actions.',
  'Data source is mode-dependent: MOCK_LOCAL uses local fixtures; DEVNET_READONLY uses read-only devnet program/RPC data; DEVNET_WALLET_READONLY uses the same read-only devnet program/RPC data plus a wallet connection context.',
  'This interface deploys nothing by itself and makes no claim about any campaign beyond the mechanical facts it can display.',
  'Read-only devnet data does not verify project legitimacy, liquidity, price, team behavior, vesting, treasury behavior, or market outcome.',
  'Wallet signing, transaction builders and the devnet-only state-changing flows that exist — adding an accepted input token config, setting single-shot output token metadata, and activating, pausing, unpausing or finalizing a campaign among them — are reached only from an explicit user gesture in DEVNET_TX_ENABLED, and each arrived under its own separate gate. Any mainnet or production path remains separately gated and is offered nowhere.',
]

// ONE COPY AUTHORITY, and this is it. The shell chrome renders the two unlisted
// warnings and the Home surface renders the adoption disclosure; neither declares its
// own prose, because two copies of a warning are two warnings that can drift, and a
// warning that drifts is the one nobody re-read.
//
// THE DISTINCTION THE COPY EXISTS TO HOLD. A curated public directory is a DEPLOYMENT
// choice about what this build lists. It is not protocol law — the REDAX program is
// permissionless and an unlisted campaign exists on chain exactly as a listed one does
// — and it is not a judgement: listed does not mean reviewed, verified, endorsed, safe
// or approved, and unlisted does not mean rejected, fraudulent or unsafe. None of these
// strings may say otherwise, in either direction.

/** How the curated public directory is described, wherever a count or list is shown. */
export const PUBLIC_DIRECTORY_CURATION_NOTE =
  'This directory lists only the campaigns this deployment curated into it. It is not a complete census of every campaign account the REDAX program owns, and the counts below describe the listed rows only. Listing is a deployment choice: it is not review, verification, endorsement, or a safety statement, and an active campaign that is not listed here is not shown by these rows.'

/** The short form, for a place that has room for one sentence rather than four. */
export const PUBLIC_DIRECTORY_CURATION_SHORT =
  'Curated listing — not a complete census of REDAX campaign accounts, and not review, verification or endorsement.'

/** The heading and body of the manual by-address workspace control. */
export const UNLISTED_CAMPAIGN_ADOPTION = {
  eyebrow: 'Campaign address',
  title: 'Open a campaign by exact address',
  intro:
    'A campaign that is not listed above can still be inspected by naming its exact account address. Opening one is a local navigation step on this page: it reads the campaign by address, it does not add it to the directory above, and it is not review, verification or endorsement of anything.',
  inputLabel: 'Campaign account address',
  inputPlaceholder: 'Exact base58 campaign account address',
  inputHelp:
    'The exact base58 address of the campaign account. Typing does nothing on its own — the workspace opens only when you click the button below.',
  buttonLabel: 'Open campaign workspace',
  /** VALUE-FREE. It never repeats what was typed, and never says whose address it is. */
  invalidNote:
    'That is not a canonical base58 Solana account address, so nothing was opened and nothing was read.',
  boundary:
    'Opening a workspace by address performs read-only campaign reads. It connects no wallet, signs nothing, sends nothing, and lists nothing.',
} as const

/** The type of the adoption copy block, so a consumer names its members exactly. */
export type RedaxUnlistedCampaignAdoptionCopy = typeof UNLISTED_CAMPAIGN_ADOPTION

/**
 * The REQUESTED phase: an address was named, and nothing has resolved under it yet.
 *
 * It must not call the address a campaign. A canonical 32-byte address is a well-formed
 * address and nothing more — the account may not exist, may not be owned by the REDAX
 * program, and may not be a Campaign at all.
 */
export const UNLISTED_CAMPAIGN_REQUESTED_WARNING =
  'This is an unlisted address request. It has not yet resolved to a REDAX campaign. It is not REDAX-reviewed, verified, or endorsed, and opening it does not list it.'

/**
 * The RESOLVED phase: a campaign loaded, and its own account address equals the one
 * that was named. Only here may the word "campaign" be used as a fact.
 */
export const UNLISTED_CAMPAIGN_RESOLVED_WARNING =
  'This is an unlisted campaign workspace. It is not REDAX-reviewed, verified, or endorsed, and opening it does not list it.'

/** Shown where a check can only be answered from a directory row this campaign has none of. */
export const CAMPAIGN_NOT_DIRECTORY_DERIVED = 'Not directory-derived'

/** Why that check is unanswered, stated as an absence rather than as a result. */
export const CAMPAIGN_NOT_DIRECTORY_DERIVED_NOTE =
  'This campaign has no row in the curated public directory, so the directory-derived checks below are not computed for it. That is an absence of a directory row — not a headroom, window or proof result.'

/** The S1 local-navigation control: label, help, and what it is not. */
export const TEAM_ADMIN_OPEN_UNLISTED_WORKSPACE = {
  label: 'Open the new campaign workspace',
  help:
    'Moves this page to the campaign that was just created, so its post-init steps can be worked on. It signs nothing, sends nothing and does not add the campaign to the public directory. The page then reads that campaign, and each step checks its own saved action once — read-only.',
} as const


// --- Wallet role context (DEVNET_WALLET_READONLY) ---------------------------

export const WALLET_ROLE_CONTEXT_BOUNDARY_NOTE =
  'role context only — matched read-only authorities by address; this mode enables no transaction action, and DEVNET_TX_ENABLED is a separate mode'

// Boundary line rendered on the connected-wallet holder context card. It reports
// classic-SPL legacy balances and output-ATA preparedness by reading canonical
// associated token accounts — no account is created, nothing is signed, and no
// conversion is offered. Preparing an output token account and converting are
// separately gated transaction steps that this read-only mode does not expose; both are
// implemented in DEVNET_TX_ENABLED. No readiness claim.
export const WALLET_HOLDER_CONTEXT_BOUNDARY_NOTE =
  'balance / ATA reads only — read-only holder context; no ATA creation and no conversion, because this mode enables no transaction action; DEVNET_TX_ENABLED is a separate mode'

// The Holder chooses the accepted input a conversion would burn, EXPLICITLY. Nothing
// preselects one: before a click there is no selection for conversion at all, and a
// campaign with exactly one accepted input is no exception — one option is still a
// choice somebody has to make.
//
// WHY THE COPY IS SEPARATE FROM THE PREVIEW COPY. Choosing an input is a LOCAL product
// gesture. It reads nothing, writes nothing, signs nothing and sends nothing, and it is
// not a program authorization, a wallet approval or a conversion. Every string here says
// what the choice is FOR — which accepted input the later, separately gated conversion
// would burn — and none of them describes the choice as progress toward one.
//
// The card renders in every mode, because an accepted input is a property of the
// campaign rather than of a wallet. Only DEVNET_TX_ENABLED renders the transaction-capable
// preview and convert controls beneath it; selecting stays local in all of them.

export const HOLDER_INPUT_SELECTOR_EYEBROW = 'Accepted input'

export const HOLDER_INPUT_SELECTOR_TITLE = 'Choose the accepted input to convert'

export const HOLDER_INPUT_SELECTOR_INTRO =
  'A conversion burns exactly one accepted input of this migration, so you choose which one here. Nothing is chosen for you, and choosing one selects nothing else: it is a local product choice on this page, not a program authorization, a wallet approval or a conversion.'

export const HOLDER_INPUT_SELECTOR_GROUP_LABEL = 'Accepted input to convert'

export const HOLDER_INPUT_SELECTOR_UNSELECTED =
  'No accepted input is selected for conversion yet. Select one above to see what converting it would produce; until then the conversion controls have no input to work from.'

export const HOLDER_INPUT_SELECTOR_NONE =
  'This migration has no accepted inputs in the configured data source, so there is nothing to select and nothing a conversion could burn.'

export const HOLDER_INPUT_SELECTOR_CAMPAIGN_UNRESOLVED =
  'The migration shown above is not the one currently selected, so an accepted input cannot be chosen for it. Select that migration explicitly in the directory above first.'

export const HOLDER_INPUT_SELECTOR_SELECTED_PILL = 'Selected for conversion'

export const HOLDER_INPUT_SELECTOR_DEFAULT_FOCUS_PILL = 'Default focus'

export const HOLDER_INPUT_SELECTOR_DEFAULT_FOCUS_NOTE =
  'One input is shown in the detail above by default so the page is not blank. That default is display only — it is not selected for conversion, and it reaches no conversion control.'

export const HOLDER_INPUT_SELECTOR_ONE_INPUT_NOTE =
  'This migration has one accepted input. It is still not selected until you select it.'

export const HOLDER_INPUT_SELECTOR_SINGLE_CHOICE_NOTE =
  'One accepted input at a time. Conversions are never combined across inputs, so this is a single choice rather than a list you tick.'

export const HOLDER_INPUT_SELECTOR_BOUNDARY =
  'Selecting an accepted input is local to this page. It reads no account, signs nothing, sends nothing and starts no conversion; converting stays a separate, explicitly gated step.'

export const HOLDER_INPUT_SELECTOR_RATE_HINT =
  'output per accepted input, before decimal normalization'

export const HOLDER_INPUT_SELECTOR_DECIMALS_HINT =
  'decimal places of this accepted input'

// --- Holder output-token-account preparation (DEVNET_TX_ENABLED, wallet-approved) ---
//
// The Holder-side prepare action: preparing the connected wallet's canonical
// classic-SPL output token account for a migration. It is NOT a conversion — no old
// token is burned, no output token is minted, and no amount is entered. Devnet only;
// the only cost is a small devnet SOL rent + fee for creating the account.
//
// AUTHORITY. The action bridge's `ok: true` IS the finalized terminal result: it
// already requires a finalized, message- and metadata-clean, effect-verified and
// durably journal-resolved attempt. No string here attributes a result to a panel
// re-read, describes a decline, or promises that a repeat is safe. Anything observed
// after the wallet was asked is reported as exactly what is known and nothing more.
// Every string stays value-free: no raw identifier, no endpoint, no provider message,
// no readiness / launch / production / mainnet claim.

export const PREPARE_ATA_EYEBROW = 'Output token account'

export const PREPARE_ATA_PANEL_TITLE = 'Prepare your output token account'

export const PREPARE_ATA_CONNECT_PROMPT =
  'Connect a wallet to check whether your output token account for this migration exists, and to prepare it if it does not. Connecting is user-initiated; nothing is signed on connect.'

export const PREPARE_ATA_CONNECT_NONE =
  'No compatible Wallet Standard wallet was detected in this browser.'

export const PREPARE_ATA_READING =
  'Reading your output token account status on devnet…'

export const PREPARE_ATA_MISSING_NOTE =
  'No output token account exists for this migration in the connected wallet yet.'

export const PREPARE_ATA_PREVIEW_BODY =
  'This prepares the connected wallet’s canonical output token account for the selected migration, so a later conversion has somewhere to receive the output token. It does not convert, burns no token, mints no token, and takes no amount.'

export const PREPARE_ATA_RENT_WARNING =
  'Preparing the account creates an on-chain associated token account and costs a small amount of devnet SOL for account rent and the transaction fee. Devnet only.'

export const PREPARE_ATA_BUTTON = 'Prepare output token account'

// The connected wallet's devnet SOL preflight, as the PREPARE panel states it.
//
// A hidden button says nothing, so the panel states the SOL condition in its own
// visible line rather than leaving a withheld action unexplained. These are truthful
// STATUS strings about what was observed — they carry no balance, no threshold, no
// lamport or SOL amount, no address, no endpoint, no provider name and no raw error,
// and none of them promises that a later action will succeed. They describe the
// current observation; the separate rent advisory above still describes the cost, and
// neither restates the other.

export const PREPARE_SOL_PREFLIGHT_READING =
  'Checking whether the connected wallet holds enough devnet SOL for this action…'

export const PREPARE_SOL_PREFLIGHT_INSUFFICIENT =
  'The connected wallet does not hold enough devnet SOL for this action, so it is not offered. Add devnet SOL to the connected wallet, then check again.'

export const PREPARE_SOL_PREFLIGHT_UNAVAILABLE =
  'The connected wallet’s devnet SOL balance could not be read, so this action is withheld until it can be.'

// The explicit human re-check. It is READ ONLY: it builds nothing, signs nothing,
// sends nothing, touches no saved attempt record and authorizes nothing. There is no
// timer, no polling and no automatic retry behind it.
export const PREPARE_SOL_PREFLIGHT_RECHECK_LABEL = 'Check the devnet SOL balance again'

// The two ephemeral progress states. They are LOCAL PROGRESS ONLY — never a result,
// never evidence, and never a durable record of anything.

export const PREPARE_ATA_AWAITING_APPROVAL_PILL = 'Awaiting approval'

export const PREPARE_ATA_AWAITING_APPROVAL =
  'Your wallet has been asked to approve the prepare transaction. This is a local progress state, not a result.'

export const PREPARE_ATA_RECONCILING_PILL = 'Reconciling'

export const PREPARE_ATA_CONFIRMING =
  'A bounded devnet reconciliation for this attempt is running. This is a local progress state, not a result and not a confirmation.'

// Offered only when the typed action presentation permits a later explicit gesture.
// It clears the panel's local presentation and returns to the account-status view; it
// starts nothing, sends nothing, and authorizes nothing.
export const PREPARE_RETURN_TO_STATUS_LABEL = 'Return to the account status'

export const PREPARE_RETURN_TO_STATUS_HELP =
  'This clears what this panel is showing and returns to the account-status view. It sends nothing and authorizes nothing; any later action needs its own explicit approval and passes the same checks.'

export const PREPARE_ATA_ALREADY_PREPARED =
  'Your output token account for this migration already exists — no preparation is needed.'

export const PREPARE_ATA_MISMATCH =
  'An account already exists at the canonical output token address but its owner or mint is unexpected (for example a non-classic token account). Preparation is blocked; this migration expects a classic-SPL output token account.'

export const PREPARE_ATA_UNAVAILABLE =
  'Your output token account status could not be read from devnet right now, so preparation is unavailable until it can be verified.'

export const PREPARE_ATA_INELIGIBLE =
  'Preparation is available only for an active migration whose output token metadata is set. This migration is not currently eligible.'

export const PREPARE_ATA_DEVNET_BOUNDARY =
  'Devnet only. Preparing an output token account is not a conversion, not a launch, and not a readiness or production claim.'

// --- Holder conversion PREVIEW + ACTION (DEVNET_TX_ENABLED; wallet-approved convert) ---
//
// Two parts. The PREVIEW shows what a convert_exact_in WOULD produce (gross output,
// disclosed protocol fee, net output) and the pre-burn checks that WOULD reject it, for
// the connected wallet's SELECTED accepted input — the one the holder explicitly chose on
// the surface above, never one this app picked; it signs nothing and burns nothing. The
// ACTION is a separate, explicit convert step: it appears only after a valid preview,
// requires an explicit consequence-specific acknowledgement and wallet approval. The
// action bridge's `ok: true` result IS the authoritative finalized success. The receipt
// is additive and non-authoritative; this panel does not re-verify success by rereading
// balances or counters. Every string stays truthful: "preview"
// for the preview (never "converted"), no "no convert control exists" wording once the
// button exists, no receipt-history / indexer or all-wallet / all-campaign proof
// claim (a single-transaction receipt is shown only after a successful convert),
// no readiness / launch / production / mainnet claim, and no raw identifier.

export const CONVERT_PREVIEW_EYEBROW = 'Conversion preview'

export const CONVERT_PREVIEW_PANEL_TITLE = 'Preview a conversion'

export const CONVERT_PREVIEW_INTRO =
  'This previews what converting your selected input would produce — gross output, the disclosed protocol fee, and your net output — plus any check that would reject it before a burn. Converting is a separate, explicit step below: it appears only after a valid preview and requires an explicit acknowledgement and wallet approval. The preview itself signs nothing and burns nothing.'

export const CONVERT_PREVIEW_CONNECT_REQUIRED =
  'Connect a wallet (using the prepare panel above) to preview a conversion for your balances. Connecting is user-initiated; nothing is signed, and no conversion runs.'

export const CONVERT_PREVIEW_READING =
  'Reading your balances and output token account status on devnet…'

export const CONVERT_PREVIEW_NO_TOKEN_CONFIG =
  'No accepted input has been selected for conversion, so there is nothing to preview. Accepted inputs are chosen explicitly on the surface above and none is chosen for you — and a migration may also have no accepted inputs at all, which the selection card above states directly.'

export const CONVERT_PREVIEW_PREPARE_FIRST =
  'Prepare your output token account first (in the panel above). A conversion needs an existing output token account to receive the output token; until it exists, there is nothing to preview converting into.'

export const CONVERT_PREVIEW_OUTPUT_ATA_MISMATCH =
  'An account already exists at the canonical output token address but its owner or mint is unexpected, so a conversion preview is blocked for this migration.'

export const CONVERT_PREVIEW_OUTPUT_ATA_UNAVAILABLE =
  'Your output token account status could not be read from devnet right now, so a conversion preview is unavailable until it can be verified.'

export const CONVERT_PREVIEW_NO_BALANCE =
  'The connected wallet holds no balance of the accepted input selected for conversion, so there is nothing to convert to preview.'

export const CONVERT_PREVIEW_BALANCE_UNAVAILABLE =
  'The connected wallet’s balance for this input could not be read as a classic-SPL balance right now, so a conversion preview is unavailable.'

export const CONVERT_PREVIEW_AMOUNT_LABEL = 'Amount to convert'

export const CONVERT_PREVIEW_AMOUNT_PLACEHOLDER = '0.0'

export const CONVERT_PREVIEW_MAX_LABEL = 'Max'

export const CONVERT_PREVIEW_AMOUNT_INVALID =
  'Enter a plain decimal amount — digits and an optional single decimal point only. No sign, exponent, or separators.'

export const CONVERT_PREVIEW_AMOUNT_TOO_MANY_DECIMALS =
  'That amount has more decimal places than this input token supports.'

export const CONVERT_PREVIEW_AMOUNT_ZERO =
  'Enter an amount greater than zero to preview a conversion.'

export const CONVERT_PREVIEW_AMOUNT_TOO_LARGE =
  'That amount is too large to convert as a classic-SPL amount.'

export const CONVERT_PREVIEW_AMOUNT_OVER_BALANCE =
  'That amount is more than your available balance of this input.'

export const CONVERT_PREVIEW_BLOCK_NOT_ACTIVE =
  'The campaign is not active, so a conversion would be rejected before any burn.'

export const CONVERT_PREVIEW_BLOCK_METADATA =
  'The campaign output token metadata is not set yet, so a conversion would be rejected before any burn.'

export const CONVERT_PREVIEW_BLOCK_WINDOW_CLOSED =
  'The campaign window has closed, so a conversion would be rejected before any burn.'

export const CONVERT_PREVIEW_BLOCK_CAMPAIGN_CAP =
  'This amount would exceed the campaign output cap, so a conversion would be rejected before any burn.'

export const CONVERT_PREVIEW_BLOCK_TOKENCONFIG_CAP =
  'This amount would exceed this input’s configured output cap, so a conversion would be rejected before any burn.'

export const CONVERT_PREVIEW_BLOCK_AMOUNT_TOO_SMALL =
  'This amount is too small to produce any output at the configured rate, so a conversion would be rejected before any burn.'

export const CONVERT_PREVIEW_BLOCK_INVALID_RATE =
  'The configured conversion rate for this input is unusable, so a conversion cannot be previewed for it.'

export const CONVERT_PREVIEW_REMAINDER_NOTE =
  'sub-precision input that does not map to whole output units'

export const CONVERT_PREVIEW_BURN_WARNING =
  'Converting permanently burns your input tokens. There is no undo and no refund. This preview burns nothing — a burn happens only when you convert below, after you check the acknowledgement and approve it in your wallet.'

export const CONVERT_PREVIEW_BOUNDARY =
  'Devnet only. A conversion preview is not a conversion, not a launch, and not a readiness or production claim.'

// --- Holder conversion ACTION (DEVNET_TX_ENABLED; wallet-approved convert) ---
//
// The convert action is separate from the preview and from the prepare action. It runs
// only from an explicit button click, only after a valid preview + explicit
// acknowledgement + wallet approval.
//
// AUTHORITY. The action bridge's `ok: true` IS the finalized terminal result: it
// already requires a finalized, message- and metadata-clean, effect-verified and
// durably journal-resolved attempt. No string here attributes a result to a panel
// balance re-read, describes a decline, or promises that a repeat is safe. The
// single-transaction receipt below is additive and downstream of that result — it is
// not receipt history, not an indexer proof, and not proof for all wallets or
// campaigns, and it neither creates nor removes a result. Copy stays value-free: it
// burns real devnet tokens, and it is not a readiness / launch / production / mainnet
// claim. No raw signature or address is rendered.

export const CONVERT_ACTION_GATING_NOTE =
  'Converting is available only after a valid preview, the explicit acknowledgement below, and wallet approval. It is devnet-only and separately gated; the on-chain result is final only after you approve it and it confirms.'

export const CONVERT_ACTION_ACK_LABEL =
  'I understand this conversion permanently burns my input tokens, and that the preview above is not final until I approve the transaction in my wallet and it confirms on devnet.'

export const CONVERT_ACTION_ACK_HELP =
  'Required before converting. Burning is irreversible and Phase 1 has no refund path. Checking this only enables the convert button — nothing is signed until you approve it in your wallet.'

export const CONVERT_ACTION_BUTTON = 'Convert on devnet'

export const CONVERT_ACTION_DISABLED_ACK =
  'Check the acknowledgement above to enable converting.'

export const CONVERT_ACTION_DISABLED_BLOCKED =
  'The checks shown above do not currently permit conversion. No transaction starts from this control.'

export const CONVERT_ACTION_DISABLED_UNAVAILABLE =
  'Conversion is unavailable in this panel right now. No transaction starts from this control.'

export const CONVERT_ACTION_DISABLED_ATTEMPT_BLOCK =
  'A saved attempt for this wallet blocks a new one. Check the saved attempt below.'

// The connected wallet's devnet SOL preflight, as the CONVERT panel states it.
//
// Both are EXPLICIT disabled reasons, never the neutral capability fallback: a holder
// who cannot tell an unaffordable action from an unavailable one has been told nothing.
// Value-free — no balance, no threshold, no lamport or SOL amount, no address, no
// endpoint, no provider name, no raw error — and neither promises a later success.

export const CONVERT_ACTION_DISABLED_SOL_INSUFFICIENT =
  'The connected wallet does not hold enough devnet SOL to convert. Add devnet SOL to the connected wallet, then check again. No transaction starts from this control.'

export const CONVERT_ACTION_DISABLED_SOL_UNAVAILABLE =
  'The connected wallet’s devnet SOL balance could not be read, so converting is withheld until it can be. No transaction starts from this control.'

// The explicit human re-check. It is READ ONLY: it builds nothing, signs nothing,
// sends nothing, touches no saved attempt record and authorizes nothing.
export const CONVERT_SOL_PREFLIGHT_RECHECK_LABEL = 'Check the devnet SOL balance again'

// The two ephemeral progress states. They are LOCAL PROGRESS ONLY — never a result,
// never evidence, and never a durable record of anything.

export const CONVERT_ACTION_AWAITING_APPROVAL_PILL = 'Awaiting approval'

export const CONVERT_ACTION_AWAITING_APPROVAL =
  'Your wallet has been asked to approve the conversion. This is a local progress state, not a result.'

export const CONVERT_ACTION_RECONCILING_PILL = 'Reconciling'

export const CONVERT_ACTION_CONFIRMING =
  'A bounded devnet reconciliation for this attempt is running. This is a local progress state, not a result and not a confirmation.'

export const CONVERT_ACTION_PROOF_NOTE =
  'This panel reports exactly what the action bridge established for this one attempt by this connected wallet. It is not receipt history, not an indexer proof, and not proof for all wallets or campaigns.'

export const CONVERT_ACTION_BOUNDARY =
  'Devnet only. Converting here is a real devnet burn-and-mint for the connected wallet — it is not a launch, and not a readiness or production claim.'

// The local form clear. It clears this panel's amount, acknowledgement and local
// presentation only. It never touches the saved attempt record, never starts an
// action, and never authorizes one. It is offered ONLY for a finalized terminal
// result or a typed replaceable terminal state.

export const CONVERT_FORM_CLEAR_AFTER_FINALIZED_SUCCESS = 'Clear the form'

export const CONVERT_FORM_CLEAR_AFTER_REPLACEABLE_TERMINAL = 'Clear the form'

export const CONVERT_FORM_CLEAR_HELP =
  'This clears the amount, the acknowledgement and what this panel is showing. It sends nothing, changes no saved attempt record, and authorizes nothing; any later conversion needs its own explicit acknowledgement, its own wallet approval, and passes the same checks.'

// --- Holder conversion single-transaction receipt (Tier 1; additive) --------
//
// Strictly downstream of the action bridge's finalized terminal result, the Holder
// card additionally decodes THIS one transaction's on-chain Converted event into a
// bounded receipt. It is a single-transaction receipt only — never receipt history,
// never an indexer result, and never a readiness / all-wallet / all-campaign claim.
//
// The receipt is ADDITIVE and NON-AUTHORITATIVE. An unavailable or mismatched decode
// cannot create, remove, preserve, reopen or change the action result, and it never
// authorizes another action. No raw signature or address is rendered.

export const CONVERT_RECEIPT_EYEBROW = 'Transaction receipt'

export const CONVERT_RECEIPT_TITLE = 'Single-transaction receipt'

export const CONVERT_RECEIPT_LOADING =
  'Decoding this transaction’s on-chain Converted event…'

export const CONVERT_RECEIPT_UNAVAILABLE =
  'The on-chain receipt for this transaction could not be decoded in this session. This receipt is additive: it does not change the action result reported above, which stands on its own.'

export const CONVERT_RECEIPT_MISMATCH =
  'The decoded on-chain amounts did not exactly match the preview. The on-chain values are authoritative. This receipt is additive: it does not change the action result reported above, and it authorizes nothing.'

export const CONVERT_RECEIPT_BOUNDARY =
  'Devnet only. A single-transaction receipt for this one conversion — not receipt history, not an indexer proof, not proof for all wallets or campaigns, and not a readiness or production claim.'

// --- The explicitly recovered finalized-conversion receipt ------------------
//
// A SECOND WAY TO REACH THE SAME CARD, and the difference is why it has its own copy.
// The card above appears as the tail of one conversion this browser tab performed. A
// later session — a reload, a closed tab, a different day — has no such tail, and the
// finalized conversion the saved record already holds would then have no receipt at all.
//
// This control reads exactly that one saved transaction, on an explicit human gesture,
// and nothing else. It never asks a wallet for anything, never sends, never starts an
// attempt, never looks for a different transaction, and never repeats itself: one press
// is one read, and a read that comes back with nothing simply says so.
//
// The receipt it produces is the SAME additive, non-authoritative evidence the direct
// card carries. It cannot create, remove, preserve, reopen or change a conversion
// result, and it authorizes nothing. Like every string in this family it carries no
// address, no signature, no amount, no endpoint, no provider name and no error.

export const CONVERT_RECEIPT_RECOVERY_BUTTON = 'Load finalized receipt'

export const CONVERT_RECEIPT_RECOVERY_HELP =
  'Reads the finalized saved conversion receipt for the saved attempt shown above. It is read-only: it asks your wallet to approve nothing, sends no transaction, and does not change the conversion result.'

export const CONVERT_RECEIPT_RECOVERY_UNAVAILABLE_HELP =
  'The finalized saved receipt was not available from this explicit read. You may make another explicit receipt read with the same control. It stays read-only: your wallet approves nothing, no transaction is sent, and the conversion result is unchanged.'

// --- Holder action + saved-attempt presentation vocabulary ------------------
//
// The Holder panels present the action bridge's typed results and the read-only
// saved-attempt check as FINITE, TOTAL discriminated classes. The unions below are the
// presentation vocabulary those panels map onto — they are this module's own naming,
// not a copy of any bridge or foundation union, and they exist here so the copy record
// for every class is checked for totality by the compiler.
//
// Rules every string below obeys:
//   * a finalized terminal result is the ONLY result; a confirmed outcome is
//     provisional and is never presented as one;
//   * nothing observed after the wallet was asked is described as a decline, and
//     nothing claims that a repeat is safe;
//   * a refusal states the REDAX SEND BOUNDARY and nothing wider. A pre-invocation
//     refusal means this app did not send the transaction; it does NOT mean the wallet
//     was never opened, never asked or never signed, and copy that implied otherwise
//     was untrue for exactly the refusals that arrive after a wallet has signed;
//   * an empty or unreadable saved-attempt record is never presented as proof that no
//     transaction reached devnet;
//   * no string promises that two panels agree, that a check searched devnet, that it
//     reports a record version, or that it reports a context slot;
//   * every string is fixed and value-free — no interpolation, no raw identifier, no
//     endpoint, no provider message, no readiness / launch / production / mainnet
//     claim.

/** The action presentation classes shared by both Holder actions. */
export type RedaxHolderActionPresentationKind =
  | 'FINALIZED_SUCCESS'
  | 'PREFLIGHT_REFUSED'
  | 'WALLET_UNAVAILABLE'
  | 'RUNTIME_REFUSED'
  | 'PREFLIGHT_FAILURE'
  | 'PRIOR_ATTEMPT_BLOCKS'
  | 'JOURNAL_FAIL_CLOSED'
  | 'POST_UNKNOWN_NO_SIGNATURE'
  | 'SIGNATURE_OBSERVED'
  | 'CONFIRMATION_PENDING'
  | 'LANDED_FAILED_PROVISIONAL'
  | 'LANDED_FAILED_RESOLVED'
  | 'LANDED_MESSAGE_MISMATCH'
  | 'CONFIRMED_MATCHING_PROVISIONAL'
  | 'READ_UNAVAILABLE'
  | 'SUPPORT_ONLY'
  | 'INCONSISTENT_NON_SUCCESS'
  | 'DEPRECATED_COMPATIBILITY_NON_SUCCESS'

/**
 * Prepare additionally observes an output token account that is simply THERE without
 * being attributable. Convert has no counterpart: an output account may appear for
 * unrelated reasons, but burnt input tokens cannot.
 */
export type RedaxHolderPrepareActionPresentationKind =
  | RedaxHolderActionPresentationKind
  | 'EFFECT_ORIGIN_UNKNOWN'

/** The pre-invocation refusals that carry their own specific explanation. */
export type RedaxHolderPreflightFailureCopyKey =
  | 'INVALID_REQUEST'
  | 'INVALID_AMOUNT'
  | 'BUILD_FAILED'
  | 'CHAIN_STATE_UNAVAILABLE'
  | 'CHAIN_GUARD_REFUSED'
  | 'QUOTE_REJECTED'
  | 'CAP_EXCEEDED'
  | 'MESSAGE_COMMITMENT_UNAVAILABLE'
  | 'OUTPUT_ACCOUNT_NOT_READY'
  | 'PAYER_SOL_INSUFFICIENT'

/** The saved-attempt presentation classes. Replaceability is never a boolean read. */
export type RedaxHolderRecoveryPresentationKind =
  | 'CURRENT_WALLET_REFUSED'
  | 'RUNTIME_REFUSED'
  | 'JOURNAL_FAIL_CLOSED'
  | 'NO_SAVED_ATTEMPT'
  | 'UNRESOLVED_ATTEMPT'
  | 'REPLACEABLE_PRE_INVOCATION_TOMBSTONE'
  | 'REPLACEABLE_FINALIZED_SUCCESS_TOMBSTONE'
  | 'REPLACEABLE_ACCEPTED_KNOWN_SIGNATURE_FAILURE_TOMBSTONE'
  | 'PERMANENTLY_NON_REPLACEABLE_SUPPORT_TOMBSTONE'
  | 'INCONSISTENT_RESOLVED_FAIL_CLOSED'

/** What a read-only check can currently report about a known signature. */
export type RedaxHolderCurrentObservationCopyKey =
  | 'PREFLIGHT_REFUSED'
  | 'SUBMISSION_OUTCOME_UNKNOWN_WITHOUT_SIGNATURE'
  | 'SIGNATURE_OBSERVED'
  | 'CONFIRMATION_PENDING'
  | 'LANDED_TRANSACTION_FAILED'
  | 'LANDED_MESSAGE_MISMATCH'
  | 'CONFIRMED_EFFECT_MATCHING'
  | 'FINALIZED_EFFECT_MATCHING'
  | 'READ_UNAVAILABLE'
  | 'SUPPORT_ONLY'

/** What the durable saved-attempt record can carry. */
export type RedaxHolderDurableObservationCopyKey =
  | RedaxHolderCurrentObservationCopyKey
  | 'EFFECT_PRESENT_ORIGIN_UNKNOWN'

/** Observed confirmation level. */
export type RedaxHolderFinalityCopyKey = 'unknown' | 'processed' | 'confirmed' | 'finalized'

// --- Short class labels (pills) --------------------------------------------

export const HOLDER_ACTION_PILL: Record<RedaxHolderPrepareActionPresentationKind, string> = {
  FINALIZED_SUCCESS: 'Finalized',
  PREFLIGHT_REFUSED: 'Refused before send',
  WALLET_UNAVAILABLE: 'Wallet required',
  RUNTIME_REFUSED: 'Unavailable',
  PREFLIGHT_FAILURE: 'Refused before send',
  PRIOR_ATTEMPT_BLOCKS: 'Blocked',
  JOURNAL_FAIL_CLOSED: 'Record unavailable',
  POST_UNKNOWN_NO_SIGNATURE: 'Outcome unknown',
  SIGNATURE_OBSERVED: 'Signature observed',
  CONFIRMATION_PENDING: 'Verification pending',
  LANDED_FAILED_PROVISIONAL: 'Failed — provisional',
  LANDED_FAILED_RESOLVED: 'Failed — finalized',
  LANDED_MESSAGE_MISMATCH: 'Message mismatch',
  CONFIRMED_MATCHING_PROVISIONAL: 'Confirmed — provisional',
  READ_UNAVAILABLE: 'Read unavailable',
  SUPPORT_ONLY: 'Needs support',
  INCONSISTENT_NON_SUCCESS: 'Fails closed',
  DEPRECATED_COMPATIBILITY_NON_SUCCESS: 'Unattributable',
  EFFECT_ORIGIN_UNKNOWN: 'Origin unknown',
}

export const HOLDER_RECOVERY_PILL: Record<RedaxHolderRecoveryPresentationKind, string> = {
  CURRENT_WALLET_REFUSED: 'Wallet required',
  RUNTIME_REFUSED: 'Unavailable',
  JOURNAL_FAIL_CLOSED: 'Record unavailable',
  NO_SAVED_ATTEMPT: 'No saved attempt',
  UNRESOLVED_ATTEMPT: 'Unresolved',
  REPLACEABLE_PRE_INVOCATION_TOMBSTONE: 'Resolved — refused',
  REPLACEABLE_FINALIZED_SUCCESS_TOMBSTONE: 'Resolved — finalized',
  REPLACEABLE_ACCEPTED_KNOWN_SIGNATURE_FAILURE_TOMBSTONE: 'Resolved — accepted failure',
  PERMANENTLY_NON_REPLACEABLE_SUPPORT_TOMBSTONE: 'Support — permanent',
  INCONSISTENT_RESOLVED_FAIL_CLOSED: 'Fails closed',
}

// --- Prepare: one string per action presentation class ----------------------

export const PREPARE_ACTION_COPY: Record<RedaxHolderPrepareActionPresentationKind, string> = {
  FINALIZED_SUCCESS:
    'Your output token account is prepared and finalized on devnet. The transaction is finalized, its message and metadata matched exactly, the account effect was verified, and the saved attempt record was resolved on that. No token was converted, burned, or minted.',
  PREFLIGHT_REFUSED:
    'The pre-send checks did not pass, so this attempt was refused before this app sent the transaction.',
  WALLET_UNAVAILABLE:
    'A connected wallet is required before preparing an output token account, so this attempt did not start.',
  RUNTIME_REFUSED:
    'Preparing an output token account is unavailable in the current mode or configuration, so this attempt did not start.',
  PREFLIGHT_FAILURE: 'This attempt was refused before your wallet was asked.',
  PRIOR_ATTEMPT_BLOCKS:
    'An earlier attempt saved in this browser for this wallet is still unresolved, so a new one cannot start. Check the saved attempt below.',
  JOURNAL_FAIL_CLOSED:
    'The saved attempt record could not be read or written safely, so this attempt stopped. Its state is unknown, so nothing here is unblocked.',
  POST_UNKNOWN_NO_SIGNATURE:
    'Your wallet returned no transaction signature, so whether a transaction was submitted is unknown. This attempt stays unresolved and no new one starts from this panel.',
  SIGNATURE_OBSERVED:
    'A transaction signature is known for this attempt and its message and metadata matched. That is an observation of the transaction, not proof of the account effect, so this attempt stays unresolved.',
  CONFIRMATION_PENDING:
    'The transaction was submitted and its signature is saved, but this view did not establish a finalized result for it, so this attempt stays unresolved here. No transaction is repeated automatically. Check the saved attempt below to refresh its status.',
  LANDED_FAILED_PROVISIONAL:
    'The transaction reached devnet and failed there, at a confirmation level below finalized. That is provisional, so this attempt stays unresolved.',
  LANDED_FAILED_RESOLVED:
    'The transaction reached devnet, failed there, and that failure is finalized. The saved attempt record was resolved on that finalized failure.',
  LANDED_MESSAGE_MISMATCH:
    'A different transaction was found under this signature, so this attempt cannot be resolved from it and stays unresolved.',
  CONFIRMED_MATCHING_PROVISIONAL:
    'The account effect matched and the transaction is confirmed but not finalized. A confirmed outcome is provisional and is never a result here, so this attempt stays unresolved.',
  READ_UNAVAILABLE:
    'Devnet could not be read, so the outcome of this attempt is not known and it stays unresolved.',
  SUPPORT_ONLY:
    'This attempt could not be resolved automatically and needs support. It stays blocking for this wallet.',
  INCONSISTENT_NON_SUCCESS:
    'This attempt reported a combination this panel cannot treat as a result, so it fails closed and stays blocking.',
  DEPRECATED_COMPATIBILITY_NON_SUCCESS:
    'This attempt reported a compatibility code this panel cannot attribute. It is treated as a non-result and stays blocking; it does not identify a wallet decision, and it says nothing about whether a transaction reached devnet.',
  EFFECT_ORIGIN_UNKNOWN:
    'An output token account exists, but it cannot be attributed to this attempt. This panel offers no second prepare for it.',
}

export const PREPARE_PREFLIGHT_FAILURE_COPY: Record<RedaxHolderPreflightFailureCopyKey, string> = {
  INVALID_REQUEST:
    'The prepare request referenced an account this action cannot use, so it was refused before your wallet was asked.',
  INVALID_AMOUNT:
    'The request carried an amount this action cannot use, so it was refused before your wallet was asked.',
  BUILD_FAILED:
    'The prepare instruction could not be built, so the request was refused before your wallet was asked.',
  CHAIN_STATE_UNAVAILABLE:
    'Devnet could not be read reliably, so the request was refused before your wallet was asked.',
  CHAIN_GUARD_REFUSED:
    'The devnet chain-identity checks did not pass, so the request was refused before your wallet was asked.',
  QUOTE_REJECTED:
    'The terms could not be confirmed against devnet, so the request was refused before your wallet was asked.',
  CAP_EXCEEDED:
    'This would exceed a campaign limit, so the request was refused before your wallet was asked.',
  MESSAGE_COMMITMENT_UNAVAILABLE:
    'The transaction could not be recorded first, so the request was refused before your wallet was asked.',
  OUTPUT_ACCOUNT_NOT_READY:
    'The output token account is not in a state this action can prepare, so the request was refused before your wallet was asked.',
  PAYER_SOL_INSUFFICIENT:
    'The connected wallet did not hold enough devnet SOL for this action, so the request was refused before your wallet was asked and nothing was prepared.',
}

// --- Convert: one string per action presentation class ----------------------

export const CONVERT_ACTION_COPY: Record<RedaxHolderActionPresentationKind, string> = {
  FINALIZED_SUCCESS:
    'Your conversion is finalized on devnet. The transaction is finalized, its message and metadata matched exactly, the conversion effect was verified, and the saved attempt record was resolved on that.',
  PREFLIGHT_REFUSED:
    'The pre-send checks did not pass, so this conversion was refused before this app sent the transaction and no input was burned.',
  WALLET_UNAVAILABLE:
    'A connected wallet is required before converting, so this conversion did not start.',
  RUNTIME_REFUSED:
    'Converting is unavailable in the current mode or configuration, so this conversion did not start.',
  PREFLIGHT_FAILURE: 'This conversion was refused before your wallet was asked.',
  PRIOR_ATTEMPT_BLOCKS:
    'An earlier attempt saved in this browser for this wallet is still unresolved, so a new one cannot start. Check the saved attempt below.',
  JOURNAL_FAIL_CLOSED:
    'The saved attempt record could not be read or written safely, so this conversion stopped. Its state is unknown, so nothing here is unblocked.',
  POST_UNKNOWN_NO_SIGNATURE:
    'Your wallet returned no transaction signature, so whether a transaction was submitted is unknown. This attempt stays unresolved and no new conversion starts from this panel.',
  SIGNATURE_OBSERVED:
    'A transaction signature is known for this attempt and its message and metadata matched. That is an observation of the transaction, not proof of the conversion effect, so this attempt stays unresolved.',
  CONFIRMATION_PENDING:
    'The transaction was submitted and its signature is saved, but this view did not establish a finalized result for it, so this attempt stays unresolved here. No transaction is repeated automatically and nothing is converted again. Check the saved attempt below to refresh its status.',
  LANDED_FAILED_PROVISIONAL:
    'The transaction reached devnet and failed there, at a confirmation level below finalized. That is provisional, so this attempt stays unresolved.',
  LANDED_FAILED_RESOLVED:
    'The transaction reached devnet, failed there, and that failure is finalized. The saved attempt record was resolved on that finalized failure.',
  LANDED_MESSAGE_MISMATCH:
    'A different transaction was found under this signature, so this attempt cannot be resolved from it and stays unresolved.',
  CONFIRMED_MATCHING_PROVISIONAL:
    'The conversion effect matched and the transaction is confirmed but not finalized. A confirmed outcome is provisional and is never a result here, so this attempt stays unresolved.',
  READ_UNAVAILABLE:
    'Devnet could not be read, so the outcome of this attempt is not known and it stays unresolved.',
  SUPPORT_ONLY:
    'This attempt could not be resolved automatically and needs support. It stays blocking for this wallet.',
  INCONSISTENT_NON_SUCCESS:
    'This attempt reported a combination this panel cannot treat as a result, so it fails closed and stays blocking.',
  DEPRECATED_COMPATIBILITY_NON_SUCCESS:
    'This attempt reported a compatibility code this panel cannot attribute. It is treated as a non-result and stays blocking; it does not identify a wallet decision, and it says nothing about whether a transaction reached devnet.',
}

export const CONVERT_PREFLIGHT_FAILURE_COPY: Record<RedaxHolderPreflightFailureCopyKey, string> = {
  INVALID_REQUEST:
    'The convert request referenced an account this action cannot use, so it was refused before your wallet was asked.',
  INVALID_AMOUNT:
    'The amount was not a usable base-unit amount within range, so the request was refused before your wallet was asked.',
  BUILD_FAILED:
    'The convert instruction could not be built, so the request was refused before your wallet was asked.',
  CHAIN_STATE_UNAVAILABLE:
    'Devnet could not be read reliably, so the request was refused before your wallet was asked.',
  CHAIN_GUARD_REFUSED:
    'The devnet chain-identity checks did not pass, so the request was refused before your wallet was asked.',
  QUOTE_REJECTED:
    'The conversion terms could not be confirmed against devnet, so the request was refused before your wallet was asked.',
  CAP_EXCEEDED:
    'This conversion would exceed a campaign limit, so the request was refused before your wallet was asked.',
  MESSAGE_COMMITMENT_UNAVAILABLE:
    'The transaction could not be recorded first, so the request was refused before your wallet was asked.',
  OUTPUT_ACCOUNT_NOT_READY:
    'The output token account is not ready for a conversion, so the request was refused before your wallet was asked.',
  PAYER_SOL_INSUFFICIENT:
    'The connected wallet did not hold enough devnet SOL for this conversion, so the request was refused before your wallet was asked and no input was burned.',
}

// --- The shared mounted-control operation explanation -----------------------
//
// One panel runs at most ONE Holder operation at a time, and that exclusion is
// deliberately NOT scoped to a wallet, campaign or token config: an operation this panel
// started under a previous identity keeps its controls unavailable rather than leaving
// them enabled-but-silent. When that latch is the load-bearing reason and the panel's
// current scoped projections cannot truthfully name it, both panels state exactly this
// one fixed, scope-neutral sentence instead of a scoped instruction that would be false.
//
// It is deliberately opaque: it names no wallet, campaign, token config, operation kind,
// signature or approval; it claims nothing about sending, broadcast, landing or finality;
// it invites no retry, resend or resume; it claims no synchronization between panels and
// no receipt authority. It is a local progress explanation and never a result.

export const HOLDER_OPERATION_ACTIVE =
  'This panel is still completing a Holder operation. Its transaction and saved-attempt controls remain unavailable until that operation finishes. This message is not a transaction result.'

// --- The shared saved-attempt (recovery) control ----------------------------
//
// Preparing an output token account and converting share ONE saved-attempt slot for
// the connected wallet — the record is namespaced by cluster, program and wallet, and
// deliberately not by campaign or token config. Each panel offers its own explicit,
// read-only check of that shared slot. The panel whose action matches the saved record
// shows the detail; the other panel shows a fixed generic block and infers nothing
// about the campaign or token config from it.

export const HOLDER_RECOVERY_EYEBROW = 'Saved attempt'

export const HOLDER_RECOVERY_TITLE = 'Saved attempt for the connected wallet'

export const HOLDER_RECOVERY_BUTTON = 'Check the saved attempt'

export const HOLDER_RECOVERY_CHECKING =
  'Reading the saved attempt record for the connected wallet. This is a local progress state.'

export const HOLDER_RECOVERY_NOT_CHECKED =
  'The saved attempt record has not been read by this panel. Reading it is explicit and read-only.'

export const HOLDER_RECOVERY_NON_AUTHORIZATION =
  'Checking is read-only. It writes nothing, sends nothing, confirms nothing, resolves nothing, and authorizes no action. An empty result is not proof that no transaction reached devnet.'

export const HOLDER_RECOVERY_SCOPE_NOTE =
  'A check reads the saved record for the connected wallet, and looks devnet up only when that record already carries a transaction signature. It never looks for candidate signatures, reports no record version, and reports no context slot.'

export const HOLDER_RECOVERY_SHARED_SLOT_NOTE =
  'Preparing an output token account and converting share one saved-attempt slot for the connected wallet. That slot belongs to the wallet and not to any accepted input, so a saved attempt in it may belong to a different accepted input than the one selected for conversion now. While that slot is unresolved, both stay blocked.'

export const HOLDER_RECOVERY_LOCAL_PROJECTION_NOTE =
  'Each panel shows only what it last read itself. The two panels are independent local views and may differ until each is checked; the action bridge and the saved attempt record remain the only authority.'

export const HOLDER_RECOVERY_NO_LOCAL_CHANGE =
  'This reading matched what this panel was already showing. That is a comparison of two local views only — it is not a devnet result, and it is not proof that no transaction reached devnet.'

export const HOLDER_RECOVERY_OTHER_ACTION_BLOCK =
  'A saved attempt for the other Holder action is present in this wallet’s shared attempt slot. Its details belong to that panel. While it blocks, this action stays blocked too.'

export const HOLDER_RECOVERY_OTHER_ACTION_CLEAR =
  'A saved attempt for the other Holder action is present in this wallet’s shared attempt slot and is resolved. Its details belong to that panel; it does not block this action.'

export const HOLDER_RECOVERY_BOUNDARY =
  'Devnet only. A read-only check of one saved attempt for the connected wallet — not history, not a list, and not a readiness or production claim.'

// --- The explicit saved-attempt reconciliation ------------------------------
//
// A SECOND, DIFFERENT GESTURE, and the difference is the whole reason it has its own
// copy. Checking is read-only and settles nothing: it can observe that the saved
// attempt's transaction is finalized on devnet and still leave the saved record
// exactly as it was, which is how a completed Holder action ends up blocking both
// panels for good. Reconciling is the one explicit gesture that may settle the saved
// record — and only from devnet evidence that is already terminal.
//
// These strings belong to the `HOLDER_RECOVERY_` family on purpose, so they are
// governed by exactly the same value-free, non-authorizing copy rules as the check
// beside them. Like every string above, none of them carries a wallet address, a
// campaign, a signature, an amount, a provider name, an endpoint or an error.
//
// NOTHING HERE PROMISES A RESULT. Reconciling may legitimately leave the saved attempt
// unresolved, and the copy says so rather than implying that pressing it will clear
// the block.

export const HOLDER_RECOVERY_RECONCILE_BUTTON = 'Reconcile saved attempt'

export const HOLDER_RECOVERY_RECONCILE_EXPLANATION =
  'Reconciling reads devnet for the transaction this saved attempt already recorded, and settles the saved record against what devnet shows about that exact transaction.'

export const HOLDER_RECOVERY_RECONCILE_NON_AUTHORIZATION =
  'Reconciling does not ask your wallet to sign anything, sends no transaction, and starts no new attempt. It reads devnet for the transaction the saved record already holds and never looks for a different one.'

export const HOLDER_RECOVERY_RECONCILE_IN_PROGRESS =
  'Reading devnet and reconciling the saved attempt… This is a local progress state.'

export const HOLDER_RECOVERY_RECONCILE_NO_PROMISE =
  'Reconciling may leave the saved attempt unresolved. Devnet evidence that is not yet final, or that does not match the saved record exactly, settles nothing — and an unresolved reading is a correct outcome of this control, not a fault in it.'

export const PREPARE_RECOVERY_COPY: Record<RedaxHolderRecoveryPresentationKind, string> = {
  CURRENT_WALLET_REFUSED:
    'A connected wallet is required to read the saved attempt record for this browser.',
  RUNTIME_REFUSED:
    'The devnet action configuration is unavailable, so the saved attempt record could not be read.',
  JOURNAL_FAIL_CLOSED:
    'The saved attempt record could not be read safely. That is not proof that no attempt exists, so nothing is unblocked.',
  NO_SAVED_ATTEMPT:
    'No saved attempt was found for the connected wallet in this browser. That is not proof that no transaction reached devnet and it authorizes nothing; the action bridge still decides under its own record lock.',
  UNRESOLVED_ATTEMPT:
    'A saved prepare attempt for this wallet is unresolved. Both Holder actions share one saved-attempt slot for this wallet, so both stay blocked while it is unresolved.',
  REPLACEABLE_PRE_INVOCATION_TOMBSTONE:
    'The saved prepare attempt was resolved as refused before this app sent the transaction. A later explicit action may be allowed under the normal checks.',
  REPLACEABLE_FINALIZED_SUCCESS_TOMBSTONE:
    'The saved prepare attempt was resolved as finalized. A later explicit action may be allowed under the normal checks.',
  REPLACEABLE_ACCEPTED_KNOWN_SIGNATURE_FAILURE_TOMBSTONE:
    'The saved prepare attempt was resolved on a finalized known-signature failure that was accepted. A later explicit action may be allowed under the normal checks.',
  PERMANENTLY_NON_REPLACEABLE_SUPPORT_TOMBSTONE:
    'The saved prepare attempt was resolved to a support disposition. That record is permanent, and both Holder actions stay blocked for this wallet.',
  INCONSISTENT_RESOLVED_FAIL_CLOSED:
    'The saved prepare attempt reports a resolved combination this panel cannot interpret, so it fails closed and both Holder actions stay blocked for this wallet.',
}

export const CONVERT_RECOVERY_COPY: Record<RedaxHolderRecoveryPresentationKind, string> = {
  CURRENT_WALLET_REFUSED:
    'A connected wallet is required to read the saved attempt record for this browser.',
  RUNTIME_REFUSED:
    'The devnet action configuration is unavailable, so the saved attempt record could not be read.',
  JOURNAL_FAIL_CLOSED:
    'The saved attempt record could not be read safely. That is not proof that no attempt exists, so nothing is unblocked.',
  NO_SAVED_ATTEMPT:
    'No saved attempt was found for the connected wallet in this browser. That is not proof that no transaction reached devnet and it authorizes nothing; the action bridge still decides under its own record lock.',
  UNRESOLVED_ATTEMPT:
    'A saved conversion attempt for this wallet is unresolved. Both Holder actions share one saved-attempt slot for this wallet, so both stay blocked while it is unresolved.',
  REPLACEABLE_PRE_INVOCATION_TOMBSTONE:
    'The saved conversion attempt was resolved as refused before this app sent the transaction. A later explicit action may be allowed under the normal checks.',
  REPLACEABLE_FINALIZED_SUCCESS_TOMBSTONE:
    'The saved conversion attempt was resolved as finalized. A later explicit action may be allowed under the normal checks.',
  REPLACEABLE_ACCEPTED_KNOWN_SIGNATURE_FAILURE_TOMBSTONE:
    'The saved conversion attempt was resolved on a finalized known-signature failure that was accepted. A later explicit action may be allowed under the normal checks.',
  PERMANENTLY_NON_REPLACEABLE_SUPPORT_TOMBSTONE:
    'The saved conversion attempt was resolved to a support disposition. That record is permanent, and both Holder actions stay blocked for this wallet.',
  INCONSISTENT_RESOLVED_FAIL_CLOSED:
    'The saved conversion attempt reports a resolved combination this panel cannot interpret, so it fails closed and both Holder actions stay blocked for this wallet.',
}

// --- Evidence labels -------------------------------------------------------
//
// Evidence is shown ONLY when the typed result actually carries it. A signature is
// always shortened. The durable saved observation and a current read-only observation
// are labelled as two distinct things, and the current one never rewrites the durable
// one. A context slot belongs to an action result only — a saved-attempt check does
// not report one.

export const HOLDER_EVIDENCE_SIGNATURE_LABEL = 'Transaction signature (shortened)'

export const HOLDER_EVIDENCE_SIGNATURE_NOTE =
  'Shortened for display. This panel shows one attempt’s own signature — never a list, never a candidate page, and never a full stale value.'

export const HOLDER_EVIDENCE_DURABLE_OBSERVATION_LABEL = 'Saved observation'

export const HOLDER_EVIDENCE_CURRENT_OBSERVATION_LABEL = 'Current read-only observation'

export const HOLDER_EVIDENCE_CURRENT_OBSERVATION_NOTE =
  'A current read-only observation. It does not rewrite the saved observation, does not resolve the saved attempt, and authorizes nothing.'

export const HOLDER_EVIDENCE_FINALITY_LABEL = 'Observed finality'

export const HOLDER_EVIDENCE_ACTION_CONTEXT_SLOT_LABEL = 'Action result context slot'

export const HOLDER_FINALITY_COPY: Record<RedaxHolderFinalityCopyKey, string> = {
  unknown: 'not stated',
  processed: 'processed',
  confirmed: 'confirmed (provisional)',
  finalized: 'finalized',
}

export const HOLDER_DURABLE_OBSERVATION_COPY: Record<RedaxHolderDurableObservationCopyKey, string> = {
  PREFLIGHT_REFUSED: 'refused before this app sent the transaction',
  SUBMISSION_OUTCOME_UNKNOWN_WITHOUT_SIGNATURE: 'no transaction signature was returned',
  SIGNATURE_OBSERVED: 'a transaction signature was observed',
  CONFIRMATION_PENDING: 'known to devnet and not confirmed',
  LANDED_TRANSACTION_FAILED: 'the transaction reached devnet and failed there',
  LANDED_MESSAGE_MISMATCH: 'a different transaction was found under this signature',
  CONFIRMED_EFFECT_MATCHING: 'the effect matched at a confirmed, not finalized, level',
  FINALIZED_EFFECT_MATCHING: 'the effect matched and is finalized',
  READ_UNAVAILABLE: 'devnet could not be read',
  SUPPORT_ONLY: 'could not be resolved automatically',
  EFFECT_PRESENT_ORIGIN_UNKNOWN: 'the effect is present but cannot be attributed',
}

export const HOLDER_CURRENT_OBSERVATION_COPY: Record<RedaxHolderCurrentObservationCopyKey, string> = {
  PREFLIGHT_REFUSED: 'refused before this app sent the transaction',
  SUBMISSION_OUTCOME_UNKNOWN_WITHOUT_SIGNATURE: 'no transaction signature is known',
  SIGNATURE_OBSERVED:
    'the transaction message and metadata matched — an observation of the transaction, not proof of the action effect',
  CONFIRMATION_PENDING: 'known to devnet and not confirmed',
  LANDED_TRANSACTION_FAILED: 'the transaction reached devnet and failed there',
  LANDED_MESSAGE_MISMATCH: 'a different transaction was found under this signature',
  CONFIRMED_EFFECT_MATCHING: 'matched at a confirmed, not finalized, level',
  FINALIZED_EFFECT_MATCHING: 'matched and finalized',
  READ_UNAVAILABLE: 'devnet could not be read',
  SUPPORT_ONLY: 'could not be resolved automatically',
}

// --- Team / admin setup wizard preview (local draft fields; no transaction path)
//
// The supply-side counterpart of the holder surfaces: a token / project team
// setting a campaign up. "Create a campaign" is product language for a staged
// sequence of existing Phase 1 instructions plus SPL prerequisites that sit
// outside REDAX instruction scope entirely — never one transaction.
//
// This copy backs a local-draft preview, and NOT the campaign-create form. It
// describes what each step will eventually take and check, and the wizard renders
// those inputs as editable draft fields held in component memory alone; THE
// PREVIEW wires no builder, no wallet-action bridge, no send/sign path and no
// transaction, and offers no way to submit anything. A real Team/Admin campaign
// create action exists in DEVNET_TX_ENABLED, owned by the Campaign Create panel,
// and no field here feeds it. Field names are protocol argument names, never values:
// no raw identifier, no example metadata location, and no wallet, mint, or
// account address — and no draft entry a team types is ever read back here.
// Every claim stays negated — a setup wizard is not a launch signal, and REDAX
// enforces published conversion rules rather than certifying any project.
//
// One setup row is not a draft field at all. The protocol fee vault is the
// account the program itself derives from the output mint and the REDAX
// protocol fee authority, so presenting it as an entry a team fills in would
// misstate the protocol. It is modeled separately as a derived row: static
// copy, no entry, and — like every other row here — no address.

/** One wizard draft field, named and explained — never a value. */
export interface TeamAdminWizardFieldCopy {
  readonly id: TeamAdminWizardFieldId
  readonly name: string
  readonly note: string
}

/**
 * One program-derived setup row, named and explained — never a value, never an
 * entry. It carries no field id because no draft state backs it.
 */
export interface TeamAdminWizardDerivedFieldCopy {
  readonly name: string
  readonly title: string
  readonly notes: readonly string[]
}

/** One step of the staged supply-side setup flow. */
export interface TeamAdminWizardStepCopy {
  /** Display eyebrow, e.g. "Step 0". Also the React key. */
  readonly index: string
  readonly title: string
  readonly purpose: string
  readonly fields: readonly TeamAdminWizardFieldCopy[]
  /** Program-derived rows this step displays but never takes as entry. */
  readonly derivedFields?: readonly TeamAdminWizardDerivedFieldCopy[]
  readonly checks: readonly string[]
  /** The Phase 1 instruction this step will eventually build, or null when the step sits outside REDAX instruction scope. */
  readonly futureTransaction: string | null
  readonly transactionState: string
  readonly warning?: string
}

/** Static framing, role/signing policy, and labels for the wizard preview. */
export interface TeamAdminWizardPreviewCopy {
  readonly eyebrow: string
  readonly title: string
  readonly intro: string
  readonly boundary: string
  readonly draftNotice: string
  readonly stepStateBadge: string
  readonly laterInstructionLabel: string
  readonly noInstructionLabel: string
  readonly fieldsTitle: string
  readonly derivedFieldsTitle: string
  readonly checksTitle: string
  readonly rolePolicyTitle: string
  readonly rolePolicyNotes: readonly string[]
  readonly nonClaimsTitle: string
  readonly footnote: string
}

export const TEAM_ADMIN_WIZARD_PREVIEW: TeamAdminWizardPreviewCopy = {
  eyebrow: 'Supply-side setup',
  title: 'Team/Admin wizard preview',
  intro:
    'Setting a campaign up is a staged sequence of existing Phase 1 instructions, not a single “create campaign” transaction — and its first step happens outside REDAX instruction scope. The steps below map onto instructions that already exist; this preview adds no new instruction, account, event, or error.',
  boundary:
    'This is a preview-only surface, and it is not the campaign-create form. It shows the shape of the whole staged setup flow and the inputs each step will eventually take. Editable fields here are local draft inputs only, and the derived protocol-fee-vault row takes no entry; nothing on this surface is sent, signed, submitted, persisted, or built. This preview invokes no builder, reaches no wallet bridge, opens no send/sign path and starts no transaction — a real devnet campaign-create action exists elsewhere, in DEVNET_TX_ENABLED, and none of these fields feeds it.',
  draftNotice: 'Local draft only — nothing is sent, and no campaign is created.',
  stepStateBadge: 'Non-actionable preview',
  laterInstructionLabel: 'later instruction',
  noInstructionLabel: 'outside REDAX instruction scope — a setup / RPC / SPL verification step',
  fieldsTitle: 'Local draft fields',
  derivedFieldsTitle: 'Derived account — not entered here',
  checksTitle: 'Checks and constraints',
  rolePolicyTitle: 'Roles and signing — devnet first',
  rolePolicyNotes: [
    'A devnet trial may assume single-wallet-all-roles: payer = output_governance = campaign_admin, one connected wallet filling every signer.',
    'Even then the roles stay named separately — payer, output_governance, and campaign_admin are distinct authorities, and this surface never collapses the labels.',
    'Separate signers per role, with co-signing, are a later concern: multi-wallet role choreography is deferred to a separately gated stage.',
    'An existing devnet campaign may be controlled by a different authority. A browser wallet can only operate a campaign whose stored campaign admin or output governance it matches.',
    'No private key is ever used in the browser, and no raw address is displayed — shortened forms only.',
  ],
  nonClaimsTitle: 'What this preview does not claim',
  footnote:
    'A step model and an input inventory, covering more of the staged flow than any built action does. Setup steps map to existing program instructions only, and no step on this preview surface has a transaction path.',
}

export const TEAM_ADMIN_WIZARD_STEPS: readonly TeamAdminWizardStepCopy[] = [
  {
    index: 'Step 0',
    title: 'SPL prerequisites — output mint preconditions',
    purpose:
      'Before REDAX campaign setup begins, the campaign’s output mint must already exist and satisfy every precondition init_campaign validates. The setup / client flow prepares that mint; REDAX creates no SPL mint and no token account at this step, and init_campaign validates the pre-existing mint rather than creating it.',
    fields: [
      {
        id: 'outputMint',
        name: 'output mint',
        note: 'the classic-SPL mint a campaign mints as its output token; the setup / client flow prepares it before campaign setup, and init_campaign validates it',
      },
    ],
    derivedFields: [
      {
        name: 'protocol fee vault token account',
        title: 'Derived REDAX protocol fee vault',
        notes: [
          'Computed from the output mint and the REDAX protocol fee authority under the classic-SPL associated token account derivation. The team does not choose or enter this account; the program derives the canonical address and rejects any other.',
          'A REDAX protocol account, not a team or project account. Conversion fees accrue here automatically when conversions execute.',
          'Phase 1 has no REDAX instruction that moves tokens out of this account. No address is shown or derived on this preview surface.',
        ],
      },
    ],
    checks: [
      'Phase 1 is classic SPL only — a Token-2022 mint is out of scope and is not offered.',
      'The output mint must exist before REDAX campaign setup: the setup / client flow prepares it, and init_campaign validates it rather than creating it.',
      'The output mint’s mint authority must be the exact Campaign PDA, so only the campaign can mint the output token.',
      'The output mint’s freeze authority must be None.',
      'The output mint’s decimals must equal exactly 9.',
      'The output mint’s initial supply must equal exactly 0 — every output token originates from a conversion.',
      'The protocol fee vault ATA must be canonical for the protocol fee authority and that output mint.',
      'In the normal flow the team does not paste or select an arbitrary existing output mint; a mint that fails any precondition is rejected.',
    ],
    futureTransaction: null,
    transactionState:
      'This preview step creates no SPL mint, no token account and no transaction.',
  },
  {
    index: 'Step 1',
    title: 'Campaign initialization preview',
    purpose:
      'Create the campaign account that owns the output mint authority and carries the campaign-level cap, window, and lifecycle status.',
    fields: [
      {
        id: 'campaignIdentitySalt',
        name: 'salt / campaign identity',
        note: 'a 32-byte campaign salt; with the output governance wallet it derives the campaign account address',
      },
      {
        id: 'outputGovernance',
        name: 'output governance',
        note: 'the governance wallet for the campaign’s output token; also an input to the campaign address derivation',
      },
      {
        id: 'campaignAdmin',
        name: 'campaign admin',
        note: 'the wallet allowed to pause, unpause, and finalize this campaign',
      },
      {
        id: 'endTs',
        name: 'end_ts / campaign window',
        note: 'an optional campaign end timestamp; conversions are rejected once the window closes',
      },
      {
        id: 'maxOutputSupply',
        name: 'max_output_supply',
        note: 'campaign-level output cap in base units; 0 = uncapped',
      },
    ],
    checks: [
      'The campaign account address is derived from the output governance wallet and the salt.',
      'A provided end_ts must be strictly in the future at initialization.',
      'max_output_supply of 0 = uncapped; any other value caps campaign-wide output.',
      'Amounts are base units throughout — never a floating-point entry.',
    ],
    futureTransaction: 'init_campaign',
    transactionState:
      'This preview step invokes no builder, reaches no wallet bridge, opens no send/sign path and starts no transaction.',
  },
  {
    index: 'Step 2',
    title: 'Accepted input / token config preview',
    purpose:
      'Add each accepted old token as its own config, with its own conversion rate and its own output cap. Each conversion later uses exactly one config — never a bundled multi-token transaction.',
    fields: [
      {
        id: 'legacyInputMint',
        name: 'legacy input mint',
        note: 'the accepted classic-SPL old mint a holder burns for this config',
      },
      {
        id: 'rateNumerator',
        name: 'rate numerator',
        note: 'output per accepted input, numerator; cannot be zero',
      },
      {
        id: 'rateDenominator',
        name: 'rate denominator',
        note: 'output per accepted input, denominator; cannot be zero',
      },
      {
        id: 'perInputCap',
        name: 'per-input cap',
        note: 'maximum output mintable from this one input, in base units; 0 = uncapped',
      },
    ],
    checks: [
      'A campaign accepts at most 10 input configs.',
      'The rate denominator cannot be zero, and neither can the rate numerator.',
      'Per-input cap of 0 = uncapped; it sits underneath the campaign-level cap.',
      'Input and output decimals are derived on-chain from the mints — they are not entered here.',
      'Classic SPL only; a Token-2022 input is out of scope in Phase 1.',
    ],
    futureTransaction: 'add_token_config',
    transactionState:
      'This preview step invokes no builder, reaches no wallet bridge, opens no send/sign path and starts no transaction.',
  },
  {
    index: 'Step 3',
    title: 'Metadata setup preview',
    purpose:
      'Attach the output token’s on-chain metadata once, before the campaign can be activated.',
    fields: [
      {
        id: 'metadataName',
        name: 'metadata name',
        note: 'output token name; required, at most 32 bytes',
      },
      {
        id: 'metadataSymbol',
        name: 'metadata symbol',
        note: 'output token symbol; required, at most 10 bytes',
      },
      {
        id: 'metadataUri',
        name: 'metadata URI',
        note: 'where the output token’s off-chain metadata lives; required, at most 200 bytes — no example is shown on this surface',
      },
    ],
    checks: [
      'Name is required and capped at 32 bytes.',
      'Symbol is required and capped at 10 bytes.',
      'URI is required and capped at 200 bytes.',
      'The program bounds these by byte length, so a non-ASCII character can cost more than one.',
      'Metadata can be attached only once per campaign; a second attempt is rejected.',
    ],
    warning:
      'Output token metadata is single-shot and immutable once set. Phase 1 has no metadata-update instruction — wrong metadata requires a new campaign, not a correction.',
    futureTransaction: 'setup_metadata',
    transactionState:
      'This preview step invokes no builder, reaches no wallet bridge, opens no send/sign path and starts no transaction.',
  },
  {
    index: 'Step 4',
    title: 'Activation preview',
    purpose:
      'Move the campaign from initialized to active, opening it to holder conversions under the published rules.',
    fields: [],
    checks: [
      'Program prerequisite — the campaign must still be in the initialized status.',
      'Program prerequisite — metadata_setup must already be true for the campaign.',
      'Program prerequisite — where the campaign carries an end_ts, execution requires the on-chain clock to still be before it. The program reads that clock itself; a browser clock is never the authority.',
      'REDAX product prerequisite — the campaign must already hold at least one accepted token config (token_config_count >= 1). The program itself has no such requirement; REDAX adds it because activation is one-way and accepted inputs can only be added while a campaign is initialized.',
    ],
    warning:
      'Activation is one-way. Once a campaign is active, the setup choices above are locked in for it — a campaign does not return to initialized, and no further accepted token config can be added to it.',
    futureTransaction: 'activate_campaign',
    transactionState:
      'This preview step invokes no builder, reaches no wallet bridge, opens no send/sign path and starts no transaction.',
  },
  {
    index: 'Step 5',
    title: 'Lifecycle controls preview',
    purpose:
      'Operate an active campaign: pause it, resume it, or close it permanently. These are the same controls the admin overview already shows as non-actionable.',
    fields: [],
    checks: [
      'Pause — the campaign admin, or the protocol emergency pause authority.',
      'Unpause — the campaign admin only.',
      'Finalize — the campaign admin only.',
      'Emergency pause is not a separate instruction: it is the same pause instruction invoked by the emergency pause authority role.',
      'That is the program. This application exposes pause only to the approved Team wallet acting as the campaign’s campaign admin — the protocol emergency pause authority is out of browser product scope and is not connectable or operable here.',
    ],
    warning:
      'Finalize is terminal and irreversible — a finalized campaign does not reopen, and no later step undoes it.',
    futureTransaction: 'pause_campaign · unpause_campaign · finalize_campaign',
    transactionState:
      'This preview step invokes no builder, reaches no wallet bridge, opens no send/sign path and starts no transaction.',
  },
]

export const TEAM_ADMIN_WIZARD_NON_CLAIMS: readonly string[] = [
  'not campaign creation, not token config creation, and not metadata setup — nothing here is submitted',
  'not a launch signal — a setup wizard says nothing about whether a campaign should exist',
  'not project verification — REDAX enforces a campaign’s published conversion rules and certifies no project',
  'not product readiness',
  'not mainnet, and not production',
  'not an audit',
  'not L5 PASS — no verdict is claimed by this surface',
]

// --- Team/Admin connected-wallet role diagnosis (read-only display) ----------
//
// Copy for the screen-level role panel rendered beside the wizard preview. The
// panel displays the connected-wallet role context App resolves through its
// existing bridge; it opens no data-source call, subscribes to no wallet, wires
// no builder, and enables no action.
//
// Two copy decisions carry weight. First, an authority match is written as
// identity, never as capability — matching a stored authority is not transaction
// readiness, and THIS PANEL enables no action, so nothing follows from a match.
// That is now the load-bearing wording: a Team/Admin campaign-create action does
// exist in DEVNET_TX_ENABLED, gated on a deploy-config identity that this
// read-only role match is deliberately not, so an earlier "no Team/Admin action
// exists in this build" reading here is superseded. Second, matching nothing is
// written as neutral information rather than a failed check, because most
// addresses match no authority and an existing devnet campaign may be owned by
// another authority entirely.
//
// The dedicated boundary line below is deliberately NOT the wallet chrome's
// WALLET_ROLE_CONTEXT_BOUNDARY_NOTE, and it must not imply that matching an
// authority here unlocks the Team/Admin action. It does not: that action is
// gated on the configured approved-Team carrier and on nothing this panel reads.

/** Arm copy and framing for the read-only Team/Admin role diagnosis panel. */
export interface TeamAdminRoleDiagnosisCopy {
  readonly eyebrow: string
  readonly title: string
  readonly footnote: string
  /** Modes that resolve no role context at all — a fact about the build, not the wallet. */
  readonly modeInactive: string
  readonly unconnected: string
  readonly unavailable: string
  readonly connectedIntro: string
  readonly connectedKeyLabel: string
  readonly connectedKeyHint: string
  readonly authoritiesTitle: string
  /** Rendered when the connected address matches no Team/Admin authority. Neutral, not an error. */
  readonly noAuthority: string
  readonly boundaryTitle: string
  readonly boundaryNotes: readonly string[]
}

export const TEAM_ADMIN_ROLE_DIAGNOSIS: TeamAdminRoleDiagnosisCopy = {
  eyebrow: 'Connected wallet',
  title: 'Team/Admin role context (read-only)',
  footnote:
    'role context only — a read-only authority match against stored state; this panel enables no action and gates none',
  modeInactive:
    'Wallet role context is not resolved in this app mode — it is resolved only in the read-only devnet wallet mode. That is a statement about the build, not about any wallet: no authority match was attempted here, and none is implied either way.',
  unconnected:
    'Connect a wallet to read which REDAX authorities its address matches for the selected campaign. Reading only — no action is enabled, and connecting builds nothing and signs nothing.',
  unavailable:
    'The connected wallet’s role context could not be read from the read-only devnet source right now. No role is assumed, and none is fabricated.',
  connectedIntro:
    'A read-only authority match for the connected wallet, computed by comparing its address against the selected campaign’s stored authorities and the protocol config.',
  connectedKeyLabel: 'Connected address (shortened)',
  connectedKeyHint: 'shortened form only — the full address is never displayed',
  authoritiesTitle: 'Matched REDAX authorities',
  noAuthority:
    'No matching Team/Admin authority for the selected campaign. That is a neutral result rather than an error or a failed check — most addresses match no authority.',
  boundaryTitle: 'What a match does and does not mean',
  boundaryNotes: [
    'A matched authority is read-only context, not transaction readiness — no action is enabled on this surface, and this panel reaches no builder, no wallet bridge, no send/sign path and no transaction. Matching an authority here does not enable the Team/Admin campaign-create action, which is gated on the separately configured approved-Team wallet.',
    'An existing devnet campaign may be owned by another authority. Matching nothing here means only that this address is not one of that campaign’s stored authorities.',
    'Role context is read-only. It creates no campaign, adds no token config, sets no metadata, changes no lifecycle state, and it does not verify a project.',
    'Addresses are never shown in full — a shortened form only.',
  ],
}

// The copy for the campaign-scoped TokenConfig workspace: the SECOND visible
// Team/Admin surface, and the first that mutates a campaign that already exists.
//
// It is deliberately separate from both neighbours. TEAM_ADMIN_WIZARD_PREVIEW
// models a whole staged setup flow and submits nothing; TEAM_ADMIN_CAMPAIGN_CREATE
// creates a campaign and adds no accepted input; this block adds exactly one
// accepted input to one already-initialized campaign, and does nothing else.
//
//   1. A DRAFT IS NOT A SUBMISSION AND A SUBMISSION IS NOT A CONFIRMATION. The
//      four row states are distinct claims — an editable draft, an attempt with
//      no proven broadcast, an attempt that may have reached the network, and an
//      exact account the chain shows — and no line may blur two of them.
//   2. UNSENT DRAFTS ARE MEMORY-ONLY and are stated as such. Reloading discards
//      them, which is honest rather than hidden: what survives a reload is the
//      durable mutation record and the chain.
//   4. THE STATUS CHECK IS NEVER A RETRY. It reads what is already known and can
//      neither sign, prompt, send nor start a second attempt, so it is never
//      labelled Retry, Resubmit or Send again.

/** The five — and only five — editable inputs of one accepted-input row. */
export const TEAM_ADMIN_ADD_TOKEN_CONFIG_FIELD_IDS = [
  'legacyMint',
  'expectedLegacyDecimals',
  'rateNumerator',
  'rateDenominator',
  'maxOutputFromTokenConfig',
] as const

/** One editable row input id. */
export type TeamAdminAddTokenConfigFieldId =
  (typeof TEAM_ADMIN_ADD_TOKEN_CONFIG_FIELD_IDS)[number]

/** One row input, named and explained — never a value. */
export interface TeamAdminAddTokenConfigFieldCopy {
  readonly id: TeamAdminAddTokenConfigFieldId
  readonly label: string
  readonly note: string
}

/**
 * The four durable row states, as copy keys.
 *
 * RE-DECLARED HERE rather than imported: this module is product copy and reaches no
 * Team/Admin module at all. The panel indexes these records with the collection
 * module's own union, so a state added there and not described here stops the panel
 * compiling — which is exactly the coupling that keeps the two in step.
 */
export type TeamAdminAddTokenConfigRowStateKey =
  | 'PREPARED'
  | 'PENDING'
  | 'SUBMITTED'
  | 'CONFIRMED'

/** Why a row may not be submitted. A refusal, never a durable state. */
export type TeamAdminAddTokenConfigBlockingKey =
  | 'CHAIN_TRUTH_UNAVAILABLE'
  | 'MUTATION_STATUS_UNAVAILABLE'
  | 'ROW_NOT_ADMISSIBLE'
  | 'CHAIN_FACTS_CONFLICT'
  | 'GLOBAL_MUTATION_SLOT_ACTIVE'
  | 'SUPPORT_DISPOSITION_BLOCKED'
  | 'SUCCESS_TERMINAL_WITHOUT_CHAIN_STATE'
  | 'CAMPAIGN_AT_TOKEN_CONFIG_CEILING'

/**
 * What a FINISHED saved attempt means, in the three ways that actually differ.
 *
 * RE-DECLARED HERE rather than imported, like every other key union in this module. The
 * panel indexes the record below with the collection module's own class union, so a class
 * added there and not described here stops the panel compiling.
 */
export type TeamAdminAddTokenConfigTombstoneKey =
  | 'PROVEN_NO_EFFECT'
  | 'RESOLVED_WITH_EFFECT'
  | 'SUPPORT_ONLY'

/** What ONE recovered attempt is, after a reload. Re-declared, never imported. */
export type TeamAdminAddTokenConfigRecoveryKey =
  | 'PENDING'
  | 'SUBMITTED'
  | 'CONFIRMED'
  | 'NO_PROVEN_EFFECT'
  | 'EFFECT_WITHOUT_CHAIN_STATE'
  | 'SUPPORT_ONLY'
  | 'CHAIN_TRUTH_UNAVAILABLE'
  | 'CHAIN_FACTS_CONFLICT'

/** Why one editable value is inadmissible. Value-free: no entry is ever echoed. */
export type TeamAdminAddTokenConfigIssueKey =
  | 'REQUIRED'
  | 'NOT_DECIMAL_INTEGER'
  | 'NEGATIVE_NOT_ALLOWED'
  | 'ABOVE_U128_MAX'
  | 'RATE_HALF_ZERO'
  | 'INVALID_PUBLIC_KEY'
  | 'INVALID_DECIMALS'
  | 'LEGACY_MINT_EQUALS_OUTPUT_MINT'
  | 'DUPLICATE_LEGACY_MINT'
  | 'DUPLICATE_TOKEN_CONFIG_PDA'
  | 'LEGACY_MINT_ALREADY_CONFIGURED'
  | 'CAMPAIGN_AT_TOKEN_CONFIG_CEILING'
  | 'CAMPAIGN_CONTEXT_UNUSABLE'

/** Why the explicitly selected campaign is, or is not, a mutation target. */
export type TeamAdminAddTokenConfigAuthorityKey =
  | 'EXPLICIT_SELECTION_CONFIRMED'
  | 'APPROVED_TEAM_UNAVAILABLE'
  | 'NO_EXPLICIT_SELECTION'
  | 'SELECTION_NOT_EFFECTIVE'
  | 'CAMPAIGN_UNAVAILABLE'
  | 'CAMPAIGN_IDENTITY_MISMATCH'
  | 'CAMPAIGN_ADMIN_MISMATCH'
  | 'CAMPAIGN_NOT_INITIALIZED'

/** Static framing for the post-init TokenConfig workspace. */
export interface TeamAdminAddTokenConfigCopy {
  readonly eyebrow: string
  readonly title: string
  readonly intro: string
  readonly boundary: string
  readonly authorityTitle: string
  readonly authority: Record<TeamAdminAddTokenConfigAuthorityKey, string>
  readonly walletTitle: string
  readonly carrierUnavailable: string
  readonly disconnected: string
  readonly connectedMatch: string
  readonly connectedMismatch: string
  readonly connectPrompt: string
  readonly noWalletsDetected: string
  readonly disconnectLabel: string
  readonly connectedKeyLabel: string
  readonly approvedKeyLabel: string
  readonly capacityTitle: string
  readonly capacityConfirmedLabel: string
  readonly capacityRemainingLabel: string
  readonly capacityDraftLabel: string
  readonly capacitySlotLabel: string
  readonly capacityNote: string
  readonly draftTitle: string
  readonly draftEmpty: string
  readonly draftNotice: string
  readonly fields: readonly TeamAdminAddTokenConfigFieldCopy[]
  readonly outputDecimalsLabel: string
  readonly outputDecimalsHint: string
  readonly derivedAddressLabel: string
  readonly derivedAddressHint: string
  readonly addRowLabel: string
  readonly removeRowLabel: string
  readonly moveUpLabel: string
  readonly moveDownLabel: string
  readonly draftControlNote: string
  readonly rowStateLabel: Record<TeamAdminAddTokenConfigRowStateKey, string>
  readonly rowStateNote: Record<TeamAdminAddTokenConfigRowStateKey, string>
  readonly blockingNote: Record<TeamAdminAddTokenConfigBlockingKey, string>
  readonly tombstoneSummary: Record<TeamAdminAddTokenConfigTombstoneKey, string>
  readonly recoveryTitle: string
  readonly recoveryIntro: string
  readonly recoveryLabel: Record<TeamAdminAddTokenConfigRecoveryKey, string>
  readonly recoveryNote: Record<TeamAdminAddTokenConfigRecoveryKey, string>
  readonly issueNote: Record<TeamAdminAddTokenConfigIssueKey, string>
  readonly submitActionLabel: string
  readonly submitActionBusyLabel: string
  readonly submitActionHelp: string
  readonly submitActionBlockedHelp: string
  readonly statusActionLabel: string
  readonly statusActionBusyLabel: string
  readonly statusActionHelp: string
  readonly statusEmpty: string
  readonly statusUnread: string
  /**
   * A SEPARATE SENTENCE from every failure line, because it is not a failure: the
   * single-flight latch refused to start a SECOND action while one was already
   * running, so nothing was built, nothing was signed and nothing was sent by the
   * one that was refused. Rendering the generic blocked-attempt line here would
   * describe a durable saved attempt that may not exist.
   */
  readonly anotherMutationRunning: string
  readonly resultTitle: string
  readonly nonClaimsTitle: string
  readonly nonClaims: readonly string[]
  readonly footnote: string
}

export const TEAM_ADMIN_ADD_TOKEN_CONFIG: TeamAdminAddTokenConfigCopy = {
  eyebrow: 'Team / admin action',
  title: 'Add an accepted input token config',
  intro:
    'The supply-side step after a campaign exists: one accepted classic-SPL input, with its own conversion rate and its own output cap, added to the campaign you selected. Each row is one devnet transaction, and it runs only when you click Submit this token config and approve it in the approved Team wallet.',
  boundary:
    'Devnet only, and one campaign at a time. A token config’s terms are fixed once the account exists, so a rate or a cap is never edited afterwards. Applying metadata, activating a campaign, pausing, unpausing and finalizing are separate steps on their own surfaces, which this one neither performs nor offers. Nothing here is a mainnet, production, audit or readiness claim.',
  authorityTitle: 'Selected campaign',
  authority: {
    EXPLICIT_SELECTION_CONFIRMED:
      'The campaign you explicitly selected is the campaign loaded here, its stored address matches the selection, and its stored campaign admin matches the configured approved Team wallet. That agreement enables the control; it is not the authority — the action re-reads the campaign from devnet and re-checks every one of those facts before anything is signed.',
    APPROVED_TEAM_UNAVAILABLE:
      'No approved Team wallet is configured for this deployment, so there is nothing to compare the campaign’s stored admin against and this surface stays disabled.',
    NO_EXPLICIT_SELECTION:
      'No campaign has been explicitly selected. Choose one before adding an accepted input: a campaign shown by fallback is a display convenience and is never treated as the target of a change.',
    SELECTION_NOT_EFFECTIVE:
      'The campaign shown is a fallback rather than the one you selected, so this surface stays disabled. A fallback is fine for reading and is never a mutation target.',
    CAMPAIGN_UNAVAILABLE:
      'The selected campaign could not be read right now, so nothing about it is assumed. Reload the campaign before adding an accepted input.',
    CAMPAIGN_IDENTITY_MISMATCH:
      'The loaded campaign’s own stored address does not agree with the selection, so this surface stays disabled. A mismatch is refused rather than reconciled.',
    CAMPAIGN_ADMIN_MISMATCH:
      'The selected campaign’s stored campaign admin is not the configured approved Team wallet, so this surface stays disabled. Another authority owns that campaign.',
    CAMPAIGN_NOT_INITIALIZED:
      'Accepted inputs are added while a campaign is still in the initialized lifecycle state. The selected campaign is past it, so this surface stays disabled.',
  },
  walletTitle: 'Approved Team wallet',
  carrierUnavailable:
    'No approved Team wallet is configured for this deployment, so this action is disabled. The approved identity is a deployment configuration value; it is never taken from the connected wallet, a URL, browser storage, or anything typed on this page.',
  disconnected:
    'Connect the approved Team wallet to enable Submit this token config. Connecting on its own builds nothing, signs nothing and sends nothing.',
  connectedMatch:
    'The connected wallet matches the configured approved Team wallet. That match enables the control here; it is not the authority — the chain guard re-checks identity and eligibility against live devnet state before anything is signed.',
  connectedMismatch:
    'The connected wallet is not the configured approved Team wallet, so this action stays disabled. Connect the approved Team wallet, or leave this surface alone — a connected wallet never approves itself here.',
  connectPrompt: 'Connect a wallet to continue.',
  noWalletsDetected:
    'No compatible wallet was detected on this page. Install or unlock a Wallet Standard wallet and reload.',
  disconnectLabel: 'Disconnect',
  connectedKeyLabel: 'Connected address (shortened)',
  approvedKeyLabel: 'Approved address (shortened)',
  capacityTitle: 'Accepted inputs on this campaign',
  capacityConfirmedLabel: 'Confirmed on chain',
  capacityRemainingLabel: 'Remaining chain capacity',
  capacityDraftLabel: 'Unsent drafts in this tab',
  capacitySlotLabel: 'Saved attempt slot',
  capacityNote:
    'A campaign accepts at most ten input token configs, and the ceiling is the count the chain reports — never the number of rows on this page. Unsent drafts occupy no chain capacity at all. Exactly one saved attempt exists at a time for the approved Team wallet, across every campaign and every operation.',
  draftTitle: 'Accepted input rows',
  draftEmpty:
    'No rows yet. Add one to describe an accepted input; nothing is built or sent until you submit that row.',
  draftNotice:
    'Unsent rows live in this tab’s memory only. They are not saved to this browser, and reloading discards them — what survives a reload is the saved attempt for the approved Team wallet and whatever the chain already holds, and both are read back rather than remembered.',
  fields: [
    {
      id: 'legacyMint',
      label: 'Legacy input mint address',
      note: 'Required. The classic-SPL mint holders convert FROM. It cannot be the campaign’s own output mint, and it cannot be a mint this campaign already accepts.',
    },
    {
      id: 'expectedLegacyDecimals',
      label: 'Expected legacy mint decimals',
      note: 'Required, 0–255. Local precondition metadata only: it is not an instruction argument, and the program reads the mint’s real decimals and stores those.',
    },
    {
      id: 'rateNumerator',
      label: 'Conversion rate numerator (base units)',
      note: 'Required and non-zero, up to the u128 maximum. Base units only — decimal digits, with no decimal point, sign, exponent or 0x prefix.',
    },
    {
      id: 'rateDenominator',
      label: 'Conversion rate denominator (base units)',
      note: 'Required and non-zero, up to the u128 maximum. Base units only — decimal digits, with no decimal point, sign, exponent or 0x prefix.',
    },
    {
      id: 'maxOutputFromTokenConfig',
      label: 'Maximum output from this input (base units)',
      note: 'Required, in base units of the output token, up to the u128 maximum. Enter 0 for uncapped.',
    },
  ],
  outputDecimalsLabel: 'Output token decimals',
  outputDecimalsHint: 'read from the selected campaign’s own truth — never entered here',
  derivedAddressLabel: 'Derived token config address (shortened)',
  derivedAddressHint: 'derived from the campaign and the legacy mint — never typed, never supplied',
  addRowLabel: 'Add a row',
  removeRowLabel: 'Remove',
  moveUpLabel: 'Move up',
  moveDownLabel: 'Move down',
  draftControlNote:
    'Adding, editing, removing and reordering rows changes this page only. None of them builds a transaction, opens a wallet or reaches devnet, and row order carries no protocol meaning: each accepted input is its own independent transaction.',
  rowStateLabel: {
    PREPARED: 'Draft',
    PENDING: 'Attempt saved',
    SUBMITTED: 'Attempt sent',
    CONFIRMED: 'On chain',
  },
  rowStateNote: {
    PREPARED:
      'A valid, unsent row. Nothing has been built, signed or sent for it, and the exact account it would create is absent from the campaign’s loaded token configs.',
    PENDING:
      'A saved attempt exists for exactly this row and no broadcast is proven. Do not start a second one — use Check submission status, which signs nothing and sends nothing.',
    SUBMITTED:
      'A saved attempt for exactly this row holds a known signature, so it may already have reached devnet. A second submission would not be a retry, and none is offered: use Check submission status.',
    CONFIRMED:
      'The campaign’s loaded token configs hold the exact account this row describes, with exactly these immutable terms. Nothing further is offered for it.',
  },
  blockingNote: {
    CHAIN_TRUTH_UNAVAILABLE:
      'The campaign or token-config state this row would be judged against could not be read, so no state is claimed for it and nothing is enabled. An unreadable campaign is not an empty one.',
    MUTATION_STATUS_UNAVAILABLE:
      'The saved attempt slot could not be read, so it is treated as occupied rather than free. Nothing is enabled until it can be read.',
    ROW_NOT_ADMISSIBLE:
      'This row is not yet a value the program would accept. The notes beside each input say which part.',
    CHAIN_FACTS_CONFLICT:
      'An account already exists at exactly the address this row would create, and its stored terms are not the terms shown here. A token config’s terms are fixed once it exists, so this is a conflict rather than an edit: change the row to match, or remove it. No submission is offered.',
    GLOBAL_MUTATION_SLOT_ACTIVE:
      'An unresolved saved attempt already exists for the approved Team wallet. There is exactly one attempt slot — across every campaign and every operation — so nothing new may start until that one is resolved. Use Check submission status.',
    SUPPORT_DISPOSITION_BLOCKED:
      'The saved attempt was acknowledged as unresolved. Acknowledging an unresolved attempt does not resolve it, so it never becomes permission to start another one — this needs support rather than a new submission.',
    SUCCESS_TERMINAL_WITHOUT_CHAIN_STATE:
      'The saved attempt reports that exactly this row succeeded, and the campaign’s loaded token configs do not show that account. The two disagree, so nothing is claimed and nothing is enabled.',
    CAMPAIGN_AT_TOKEN_CONFIG_CEILING:
      'The campaign already holds the maximum number of accepted inputs the program allows, so no further input can be added to it.',
  },
  tombstoneSummary: {
    PROVEN_NO_EFFECT:
      'The saved attempt slot holds a finished attempt that produced no proven effect: nothing was broadcast, nothing landed, or the transaction landed and failed. It is over, and it changed nothing. A fresh token config can be prepared and submitted once the campaign’s live state admits one — that is decided by re-reading devnet, not by this note.',
    RESOLVED_WITH_EFFECT:
      'The saved attempt slot holds a finished attempt that took effect. What exists is decided by the campaign’s live state rather than by this record, so use Check submission status to see it. That token config is fixed once its account exists and is never submitted again; the campaign’s other accepted-input slots are unaffected.',
    SUPPORT_ONLY:
      'The saved attempt was acknowledged as unresolved. Acknowledging an unresolved attempt does not resolve it, so it never becomes permission to start another one — this needs support rather than a new submission.',
  },
  recoveryTitle: 'Recovered saved attempt',
  recoveryIntro:
    'Unsent rows are held in this tab only and are discarded on reload. A saved attempt is not: it is recorded durably, so it is shown here after a reload from that record plus a fresh reading of devnet. It is a report rather than an editable row — it offers no submission, and starting again means preparing an ordinary new row.',
  recoveryLabel: {
    PENDING: 'Pending',
    SUBMITTED: 'Submitted',
    CONFIRMED: 'Confirmed',
    NO_PROVEN_EFFECT: 'No proven effect',
    EFFECT_WITHOUT_CHAIN_STATE: 'Unconfirmed',
    SUPPORT_ONLY: 'Support only',
    CHAIN_TRUTH_UNAVAILABLE: 'Not read',
    CHAIN_FACTS_CONFLICT: 'Conflict',
  },
  recoveryNote: {
    PENDING:
      'A saved attempt reached the durable record and no signature was retained for it, so it is not shown as sent. It is not a failure either, and it is not a reason to start the same token config again. Use Check submission status.',
    SUBMITTED:
      'A signature was retained for this saved attempt, so it may already have reached the network. There is no retry here and there never will be: the only step offered is Check submission status.',
    CONFIRMED:
      'This saved attempt is finished and the campaign’s freshly read state holds exactly the token config it described. Nothing further is offered for it, and its terms are fixed.',
    NO_PROVEN_EFFECT:
      'This saved attempt is finished with no proven effect, and the campaign’s freshly read state does not hold the token config it described. Preparing a new row for the same input token may become possible; that is decided by re-reading devnet when you do.',
    EFFECT_WITHOUT_CHAIN_STATE:
      'This saved attempt reports that it took effect, and the campaign’s freshly read state does not show the account it describes. The two disagree, so nothing is claimed and nothing is offered.',
    SUPPORT_ONLY:
      'This saved attempt was acknowledged as unresolved rather than resolved, so no outcome is claimed for it and no new submission may start from it.',
    CHAIN_TRUTH_UNAVAILABLE:
      'The campaign state this saved attempt would be judged against has not been read with the freshness that judgment needs, so no outcome is claimed for it. Use Check submission status.',
    CHAIN_FACTS_CONFLICT:
      'An account exists at exactly the address this saved attempt describes, and its stored terms are not the terms the attempt asked for. A token config’s terms are fixed once it exists, so this is reported rather than reconciled.',
  },
  issueNote: {
    REQUIRED: 'This value is required.',
    NOT_DECIMAL_INTEGER:
      'Base units only — decimal digits, with no decimal point, sign, exponent, separator or 0x prefix.',
    NEGATIVE_NOT_ALLOWED: 'This value cannot be negative.',
    ABOVE_U128_MAX: 'This value is above the u128 maximum the program stores.',
    RATE_HALF_ZERO: 'A rate half must be non-zero — a zero numerator or denominator is invalid.',
    INVALID_PUBLIC_KEY: 'This is not a valid base58 account address.',
    INVALID_DECIMALS: 'Decimals must be a whole number between 0 and 255.',
    LEGACY_MINT_EQUALS_OUTPUT_MINT:
      'A campaign’s own output mint cannot be one of its accepted inputs.',
    DUPLICATE_LEGACY_MINT:
      'Another row on this page already names this legacy mint. One legacy mint is one accepted input.',
    DUPLICATE_TOKEN_CONFIG_PDA:
      'Another row on this page already derives this exact token config address.',
    LEGACY_MINT_ALREADY_CONFIGURED:
      'This campaign already accepts this legacy mint. Its terms are fixed, and a second entry is not an edit of the first.',
    CAMPAIGN_AT_TOKEN_CONFIG_CEILING:
      'The campaign already holds the maximum number of accepted inputs the program allows.',
    CAMPAIGN_CONTEXT_UNUSABLE:
      'The selected campaign’s own facts could not be used to judge this row, so nothing about it is assumed.',
  },
  submitActionLabel: 'Submit this token config',
  submitActionBusyLabel: 'Submitting…',
  submitActionHelp:
    'One click, one wallet approval, one devnet transaction, for this row alone. There is no submit-all, no automatic next row, no automatic retry and no second send.',
  submitActionBlockedHelp:
    'Submit this token config stays disabled until the approved Team wallet is configured and connected, the campaign you explicitly selected is the one loaded here, this row is valid, and the single saved attempt slot is free.',
  statusActionLabel: 'Check submission status',
  statusActionBusyLabel: 'Checking…',
  statusActionHelp:
    'Reads what is already known about the saved attempt and re-reads it afterwards. It signs nothing, opens no wallet, sends nothing and starts no new attempt — so it is safe after a reload or a disconnect, and it needs no connected wallet.',
  statusEmpty: 'No saved attempt exists for the approved Team wallet right now.',
  statusUnread:
    'The saved attempt slot has not been read in this tab yet. Every row is treated as blocked until it is.',
  anotherMutationRunning:
    'Another Team/Admin mutation was already running in this tab, so this one did not start. Nothing was built, nothing was signed and nothing was sent by it. Wait for the running action to finish; this is not a failure and there is nothing to undo.',
  resultTitle: 'What the last action reported',
  nonClaimsTitle: 'What adding an accepted input does not mean',
  nonClaims: [
    'not a mainnet, production or public-product step',
    'not an audit, and not a readiness claim of any kind',
    'no metadata step was performed, no campaign was activated, and no lifecycle state was changed',
    'a visible control is never evidence that any particular attempt reached devnet',
    'not a claim about any wallet other than the one that approved it',
  ],
  footnote:
    'Devnet-only accepted-input setup for one selected campaign. A visible control is not evidence that a transaction was submitted or landed, and it does not imply metadata, activation or campaign completion.',
}

// The copy for the ONE visible Team/Admin action surface. It is deliberately
// separate from TEAM_ADMIN_WIZARD_PREVIEW: the preview models the whole staged
// setup flow and submits nothing, while this panel is the real, minimal S1
// campaign-create action and submits exactly what it shows.
//
//   2. NOTHING CLAIMS READINESS. A created devnet campaign is a devnet campaign:
//      not a product proof, not a mainnet path, not an audit, not an activation,
//      and not a token-config or metadata step.
//   3. THE STATUS CHECK IS NEVER A RETRY. It reads what is already known and can
//      neither sign, prompt, send nor start a second attempt, so it is never
//      labelled Retry, Resubmit or Send again.

/** The five — and only five — user-editable Campaign Create planning inputs. */
export const TEAM_ADMIN_CAMPAIGN_CREATE_FIELD_IDS = [
  'endTs',
  'maxOutputSupply',
  'metadataName',
  'metadataSymbol',
  'metadataUri',
] as const

/** One Campaign Create planning input id. A strict subset of the wizard ids. */
export type TeamAdminCampaignCreateFieldId =
  (typeof TEAM_ADMIN_CAMPAIGN_CREATE_FIELD_IDS)[number]

/** One Campaign Create input, named and explained — never a value. */
export interface TeamAdminCampaignCreateFieldCopy {
  readonly id: TeamAdminCampaignCreateFieldId
  readonly label: string
  readonly note: string
}

/** Static framing for the Campaign Create panel. Carries no action vocabulary. */
export interface TeamAdminCampaignCreateCopy {
  readonly eyebrow: string
  readonly title: string
  readonly intro: string
  readonly boundary: string
  readonly identityTitle: string
  /** No approved-Team wallet is configured for this deployment. */
  readonly carrierUnavailable: string
  readonly disconnected: string
  readonly connectedMatch: string
  readonly connectedMismatch: string
  readonly connectPrompt: string
  readonly noWalletsDetected: string
  readonly disconnectLabel: string
  readonly connectedKeyLabel: string
  readonly approvedKeyLabel: string
  readonly fieldsTitle: string
  readonly fields: readonly TeamAdminCampaignCreateFieldCopy[]
  readonly metadataNotice: string
  readonly fixedTitle: string
  readonly fixedNotes: readonly string[]
  readonly submitLabel: string
  readonly submitBusyLabel: string
  readonly submitHelp: string
  readonly submitBlockedHelp: string
  readonly reconcileLabel: string
  readonly reconcileBusyLabel: string
  readonly reconcileHelp: string
  readonly preBroadcastTitle: string
  readonly postInvocationTitle: string
  readonly postBroadcastNotice: string
  readonly resultCampaignLabel: string
  readonly resultOutputMintLabel: string
  readonly resultFingerprintLabel: string
  readonly nonClaimsTitle: string
  readonly nonClaims: readonly string[]
  readonly footnote: string
}

export const TEAM_ADMIN_CAMPAIGN_CREATE: TeamAdminCampaignCreateCopy = {
  eyebrow: 'Team / admin action',
  title: 'Create a devnet campaign',
  intro:
    'The one supply-side action on this surface: a single atomic devnet transaction that creates the campaign’s output mint, its canonical protocol fee vault, and the Campaign account itself. It runs only when you click Create devnet campaign and approve it in the approved Team wallet.',
  boundary:
    'Devnet only. The campaign is created in the initialized lifecycle state with no accepted input configs: adding token configs, applying metadata and activating the campaign are separate, separately gated steps that this action does not perform. Nothing here is a mainnet, production, audit or readiness claim.',
  identityTitle: 'Approved Team wallet',
  carrierUnavailable:
    'No approved Team wallet is configured for this deployment, so this action is disabled. The approved identity is a deployment configuration value; it is never taken from the connected wallet, a URL, browser storage, or anything typed on this page.',
  disconnected:
    'Connect the approved Team wallet to enable Create devnet campaign. Connecting on its own builds nothing, signs nothing and sends nothing.',
  connectedMatch:
    'The connected wallet matches the configured approved Team wallet. That match enables the control here; it is not the authority — the chain guard re-checks identity and eligibility against live devnet state before anything is signed.',
  connectedMismatch:
    'The connected wallet is not the configured approved Team wallet, so this action stays disabled. Connect the approved Team wallet, or leave this surface alone — a connected wallet never approves itself here.',
  connectPrompt: 'Connect a wallet to continue.',
  noWalletsDetected:
    'No compatible wallet was detected on this page. Install or unlock a Wallet Standard wallet and reload.',
  disconnectLabel: 'Disconnect',
  connectedKeyLabel: 'Connected address (shortened)',
  approvedKeyLabel: 'Approved address (shortened)',
  fieldsTitle: 'Campaign terms',
  fields: [
    {
      id: 'endTs',
      label: 'Campaign end date and time',
      note: 'Choose a date and time with a visible time zone, or choose No end date. It must be in the future when the campaign is created.',
    },
    {
      id: 'maxOutputSupply',
      label: 'Campaign output limit (new tokens, before the fee)',
      note: 'Enter an amount of new tokens, or choose No limit. It is converted exactly to the output token’s 9-decimal base units.',
    },
    {
      id: 'metadataName',
      label: 'Planned output token name',
      note: 'Required. A planned value carried in this submission’s plan and fingerprint — this action sets no on-chain name.',
    },
    {
      id: 'metadataSymbol',
      label: 'Planned output token symbol',
      note: 'Required. A planned value carried in this submission’s plan and fingerprint — this action sets no on-chain symbol.',
    },
    {
      id: 'metadataUri',
      label: 'Planned metadata location',
      note: 'Required. A planned value carried in this submission’s plan and fingerprint — this action publishes nothing to it and sets no on-chain URI.',
    },
  ],
  metadataNotice:
    'The three planned metadata values are recorded in this submission’s plan and fingerprint only. This action applies NO metadata on chain — no name, no symbol and no URI is written to any account by it, and the metadata step remains separate.',
  fixedTitle: 'Fixed by this action',
  fixedNotes: [
    'The campaign is created in the initialized lifecycle state. Activation is not offered here.',
    'No accepted input token config is created. Adding one is a separate, separately gated step.',
    'The output mint and the campaign identity salt are generated for this attempt and are never entered here.',
    'Payer, output governance and campaign admin are all filled from the configured approved Team wallet, and from nothing else.',
  ],
  submitLabel: 'Create devnet campaign',
  submitBusyLabel: 'Creating…',
  submitHelp:
    'One click, one wallet approval, one devnet transaction. There is no automatic retry and no second send.',
  submitBlockedHelp:
    'Create devnet campaign stays disabled until the approved Team wallet is configured and connected and every term above is valid.',
  reconcileLabel: 'Check submission status',
  reconcileBusyLabel: 'Checking…',
  reconcileHelp:
    'Reads what is already known about a saved submission. It signs nothing, opens no wallet, sends nothing and starts no new attempt — so it is safe after a refresh or a disconnect, and it needs no connected wallet.',
  preBroadcastTitle: 'Nothing was submitted',
  postInvocationTitle: 'A submission was sent',
  postBroadcastNotice:
    'This attempt reached the network, so creating another campaign is NOT a retry and is not offered here. Use Check submission status to find out what happened to the one that was sent.',
  resultCampaignLabel: 'Campaign address (shortened)',
  resultOutputMintLabel: 'Output mint address (shortened)',
  resultFingerprintLabel: 'Plan fingerprint (shortened)',
  nonClaimsTitle: 'What creating a devnet campaign does not mean',
  nonClaims: [
    'not a mainnet, production or public-product step',
    'not an audit, and not a readiness claim of any kind',
    'no metadata was applied, no token config was added, and no campaign was activated',
    'not a claim about any wallet other than the one that approved it',
  ],
  footnote:
    'Devnet-only Campaign Create. A visible control is not proof that a transaction was submitted or landed, and it does not imply metadata, TokenConfig, or activation completion.',
}

// --- Campaign Create in human units (demo customer flow, 2026-10-22) ---------
//
// The person types amounts of tokens and a date-time; the panel converts both EXACTLY to
// the raw strings the S1 plan has always carried, shows the conversion beside the field,
// and freezes it in a review that needs an acknowledgement. "No limit" and "No end date"
// are explicit choices, never what an empty field means.

export const TEAM_ADMIN_CREATE_TERMS = {
  permanenceNote:
    'The output limit and the end date are written into the campaign permanently. They cannot be changed later; a mistake needs a new campaign.',
  capLegend: 'Campaign output limit',
  capLimitChoice: 'Set a limit',
  capNoneChoice: 'No limit',
  capAmountLabel: 'Limit in new tokens (before the 1% fee)',
  capNote:
    'This limits the GROSS new tokens all holders together can receive (each holder’s net amount plus the REDAX fee). It is not reserved for anyone, and per-input limits may add up to more than it.',
  capChooseNote: 'Choose Set a limit or No limit.',
  capNoneSummary: 'No campaign-wide limit (stored as 0, which the program reads as unlimited).',
  endLegend: 'Campaign end',
  endNoneChoice: 'No end date',
  endAtChoice: 'Ends at a date and time',
  endDateTimeLabel: 'End date and time',
  endZoneLabel: 'Time zone of the date and time above',
  endNote:
    'Shown in your time zone and in UTC. The network’s clock — not this device’s — decides when conversions stop. Reaching the end does not finalize the campaign by itself.',
  endChooseNote: 'Choose No end date or Ends at a date and time.',
  endNoneSummary: 'No end date.',
  metadataLegend: 'Planned output token details',
  presetNote:
    'Ready-made identities this deployment approved. Choosing one fills all three values consistently; it is still only a plan until the separate metadata step.',
  reviewTitle: 'Review the permanent terms',
  reviewLabel: 'Review campaign terms',
  reviewBlockedNote: 'Fix the highlighted terms first; nothing was reviewed.',
  reviewStaleNote:
    'The terms or the connected wallet changed after the review. Review again before creating the campaign.',
  endPassedDuringReviewNote:
    'The chosen end time has passed while the review was open. Choose a later time and review again. Nothing was sent.',
  reviewCapLabel: 'Output limit (gross)',
  reviewEndLabel: 'End',
  reviewPlannedLabel: 'Planned token',
  acknowledgeLabel:
    'I checked the output limit and end above and understand they cannot be changed after the campaign is created.',
  createdTitle: 'Your campaign',
  startAnotherLabel: 'Start another campaign',
  startAnotherHelp:
    'Clears this form so a new campaign can be prepared. It does not change the campaign that was created.',
} as const

// --- Accepted inputs in human units (demo customer flow, 2026-10-22) ----------
//
// An accepted input is described as a person thinks of it: which token, how many old
// tokens become how many new tokens before the fee, and how many new tokens this input may
// mint at most (or no limit). The token's decimals are READ from the chain, never typed.

export const TEAM_ADMIN_TOKEN_CONFIG_TERMS = {
  mintLabel: 'Old token mint address',
  mintReading: 'Reading the token from devnet…',
  mintReadAgain: 'Read token details again',
  mintRefused: {
    NOT_A_PUBLIC_KEY: 'This is not a valid token mint address.',
    READ_UNAVAILABLE: 'The token could not be read from devnet just now. Try Read token details again.',
    MINT_ACCOUNT_ABSENT: 'No token exists at this address on devnet.',
    NOT_A_CLASSIC_SPL_MINT: 'This address is not a classic SPL token mint. Phase 1 accepts classic SPL tokens only.',
    MINT_NOT_INITIALIZED: 'This token mint is not initialized.',
  },
  mintPending: 'Paste the full mint address of the old token; its details are read from devnet.',
  rateLegend: 'Conversion rate',
  rateOldLabel: 'Old tokens',
  rateNewLabel: 'become new tokens (gross, before the 1% fee)',
  rateNote:
    'Whole tokens on both sides — for example 1 → 1, 2 → 3, 3 → 7. The program first adjusts for each token’s decimals, then applies this exact ratio, then takes the 1% fee; the ratio is stored exactly, never rounded to a decimal.',
  capLegend: 'Limit for this input',
  capLimitChoice: 'Set a limit',
  capNoneChoice: 'No limit',
  capAmountLabel: 'Most new tokens this input may produce (gross)',
  capNote:
    'Counts gross new tokens (holders’ net plus the REDAX fee) produced from this input across all holders. It is not reserved for anyone.',
  reviewTitle: 'Review this input — it cannot be changed after it is added',
  acknowledgeLabel: 'I checked this input’s token, rate and limit.',
  acknowledgeRequired: 'Review and tick the box above before adding this input.',
  capSumNote:
    'The per-input limits together exceed the campaign limit. That is allowed: every conversion must fit BOTH its input limit and the campaign limit, and whoever converts first uses the room.',
} as const

/** Business-language names for the raw row fields an issue can point at. */
export const TEAM_ADMIN_TOKEN_CONFIG_FIELD_NAMES: Readonly<Record<string, string>> = {
  legacyMint: 'Old token',
  expectedLegacyDecimals: 'Old token decimals',
  rateNumerator: 'Rate',
  rateDenominator: 'Rate',
  maxOutputFromTokenConfig: 'Input limit',
  campaign: 'Campaign',
}

/** Business-language labels for the setup authority states. The code stays in details. */
export const TEAM_ADMIN_AUTHORITY_LABELS: Readonly<Record<string, string>> = {
  EXPLICIT_SELECTION_CONFIRMED: 'Your campaign',
  APPROVED_TEAM_UNAVAILABLE: 'No approved Team wallet configured',
  NO_EXPLICIT_SELECTION: 'No campaign selected',
  SELECTION_NOT_EFFECTIVE: 'Selected campaign not loaded',
  CAMPAIGN_UNAVAILABLE: 'Campaign not readable',
  CAMPAIGN_IDENTITY_MISMATCH: 'Campaign mismatch',
  CAMPAIGN_ADMIN_MISMATCH: 'Not this Team’s campaign',
  CAMPAIGN_NOT_INITIALIZED: 'Setup already closed',
}

/**
 * Business-language labels for post-init mutation submit results. A busy refusal is
 * classified FIRST (`ANOTHER_TEAM_ADMIN_MUTATION_IS_RUNNING` — the second action did not
 * start), and whether anything was sent is read from the root's own `rawBroadcastCount`,
 * never guessed from a code name. The exact code stays available in details.
 */
export function teamAdminMutationResultLabel(
  code: string,
  busy: boolean,
  rawBroadcastCount: number,
): string {
  if (busy) {
    return 'Another Team action is running'
  }
  switch (code) {
    case 'MATCHING_IMMEDIATE_STATE_RESOLVED':
    case 'LANDED_EXACT_POST_STATE_SUPERSEDED_RESOLVED':
      return 'Saved on chain'
    case 'FINALIZED_LANDED_FAILURE_RESOLVED':
      return 'Failed on the network — nothing changed'
    case 'WALLET_SIGN_ONLY_REFUSED':
      return 'Not sent — approval declined'
    case 'PAYER_SOL_INSUFFICIENT':
      return 'Not sent — not enough devnet SOL'
    case 'ATTEMPT_BLOCKED':
      return 'Not sent — a saved action needs checking'
    default:
      return rawBroadcastCount === 1 ? 'Sent — check status' : 'Not sent'
  }
}

// The copy for the output token's PERMANENT metadata: the THIRD visible Team/Admin
// surface, a sibling of the accepted-input workspace under the same post-init
// mutation provider, and the only one whose result can never be corrected.
//
// Five wording rules are load-bearing here, and the first is unlike anything the
// neighbouring blocks need.
//
//   1. PERMANENT MEANS PERMANENT. Phase 1 has no metadata-update instruction. Once
//      this campaign's metadata exists it cannot be changed, replaced, edited or
//      undone, and a mistake costs a NEW CAMPAIGN. No line here may say "for now",
//      "initially", "you can change this later" or anything that reads as one.
//   2. A REVIEW IS NOT A SUBMISSION. Reviewing canonicalizes locally and freezes
//      what the operator approved; it signs nothing, sends nothing, opens no wallet
//      and touches no network. The two controls are never described alike.
//   3. WHAT WAS PREVIEWED IS WHAT IS REQUESTED. The preview shows the exact
//      canonical name, symbol and URI the request carries — never a prettied,
//      re-cased or re-normalized rendering of them.
//   4. A URI IS CHOSEN, NEVER TYPED, and never linked. It is one of the locations
//      the deployment approved, displayed as plain text, and this surface neither
//      opens it, fetches it, previews it nor renders it as a link.
//   5. UNREADABLE IS NEVER ABSENT. A metadata account that could not be read, or
//      that disagrees with the campaign's own flag, is reported as a conflict — it
//      is never described as "not set yet" and never becomes permission to write.
//
// NO REAL URI AND NO HOSTING PROVIDER APPEARS ANYWHERE IN THIS BLOCK. The approved
// locations are a deployment configuration value; naming one here would be this
// module choosing it.

/** The two — and only two — typed metadata inputs. The URI is selected, not typed. */
export const TEAM_ADMIN_SETUP_METADATA_FIELD_IDS = ['name', 'symbol'] as const

/** One typed metadata input id. */
export type TeamAdminSetupMetadataFieldId =
  (typeof TEAM_ADMIN_SETUP_METADATA_FIELD_IDS)[number]

/** One typed metadata input, named and explained — never a value. */
export interface TeamAdminSetupMetadataFieldCopy {
  readonly id: TeamAdminSetupMetadataFieldId
  readonly label: string
  readonly note: string
}

/**
 * The nine metadata product states, as copy keys.
 *
 * RE-DECLARED HERE rather than imported, like every other key union in this module:
 * this file is product copy and reaches no Team/Admin module at all. The panel
 * indexes these records with the product module's own union, so a state added there
 * and not described here stops the panel compiling.
 */
export type TeamAdminSetupMetadataStateKey =
  | 'NOT_CONFIGURED'
  | 'NOT_AUTHORIZED'
  | 'DRAFT'
  | 'READY_FOR_APPROVAL'
  | 'SAVED_ATTEMPT'
  | 'SUBMITTED_ATTEMPT'
  | 'METADATA_SET'
  | 'NO_EFFECT_PROVEN'
  | 'BLOCKED_SUPPORT'

/** Why the immutable set may not be offered. A refusal, never a durable state. */
export type TeamAdminSetupMetadataBlockingKey =
  | 'ALLOWLIST_NOT_CONFIGURED'
  | 'CAMPAIGN_NOT_AUTHORIZED'
  | 'METADATA_ALREADY_SET'
  | 'METADATA_TARGET_INCONSISTENT'
  | 'METADATA_TARGET_UNREADABLE'
  | 'MUTATION_STATUS_UNAVAILABLE'
  | 'SAVED_ATTEMPT_OUTSTANDING'
  | 'GLOBAL_MUTATION_SLOT_ACTIVE'
  | 'SUPPORT_DISPOSITION_BLOCKED'
  | 'CHAIN_TRUTH_UNAVAILABLE'
  | 'NO_CURRENT_APPROVAL_SNAPSHOT'

/** Why the selected campaign is, or is not, a metadata target. */
export type TeamAdminSetupMetadataAuthorityKey =
  | 'EXPLICIT_SELECTION_CONFIRMED'
  | 'APPROVED_TEAM_UNAVAILABLE'
  | 'NO_EXPLICIT_SELECTION'
  | 'SELECTION_NOT_EFFECTIVE'
  | 'CAMPAIGN_UNAVAILABLE'
  | 'CAMPAIGN_IDENTITY_MISMATCH'
  | 'CAMPAIGN_ADMIN_MISMATCH'
  | 'CAMPAIGN_NOT_INITIALIZED'

/**
 * Why a local review declined. The canonicalizer's OWN closed vocabulary, re-declared.
 *
 * Every one of them is VALUE-FREE by construction on the other side: the refusal
 * carries a code and never a fragment of what was typed, so no sentence here can
 * echo an entry either.
 */
export type TeamAdminSetupMetadataRefusalKey =
  | 'INPUT_INVALID'
  | 'NAME_ILL_FORMED'
  | 'NAME_BYTE_LENGTH_OUT_OF_RANGE'
  | 'SYMBOL_ILL_FORMED'
  | 'SYMBOL_BYTE_LENGTH_OUT_OF_RANGE'
  | 'URI_ILL_FORMED'
  | 'URI_SCHEME_NOT_HTTPS'
  | 'URI_CREDENTIAL_BEARING'
  | 'URI_BYTE_LENGTH_OUT_OF_RANGE'
  | 'URI_NOT_ALLOWLISTED'
  | 'ALLOWLIST_EMPTY'
  | 'CANONICALIZATION_UNAVAILABLE'

/** What ONE recovered metadata attempt is, after a reload. Re-declared, never imported. */
export type TeamAdminSetupMetadataRecoveryKey =
  | 'SAVED'
  | 'SUBMITTED'
  | 'METADATA_SET'
  | 'NO_PROVEN_EFFECT'
  | 'EFFECT_WITHOUT_CHAIN_STATE'
  | 'SUPPORT_ONLY'
  | 'CHAIN_TRUTH_UNAVAILABLE'
  | 'TARGET_INCONSISTENT'

/** Static framing for the permanent-metadata surface. */
export interface TeamAdminSetupMetadataCopy {
  readonly eyebrow: string
  readonly title: string
  readonly intro: string
  readonly boundary: string
  readonly authorityTitle: string
  readonly authority: Record<TeamAdminSetupMetadataAuthorityKey, string>
  readonly walletTitle: string
  readonly carrierUnavailable: string
  readonly disconnected: string
  readonly connectedMatch: string
  readonly connectedMismatch: string
  readonly connectPrompt: string
  readonly noWalletsDetected: string
  readonly disconnectLabel: string
  readonly connectedKeyLabel: string
  readonly approvedKeyLabel: string
  readonly locationTitle: string
  readonly locationNotConfigured: string
  readonly locationNote: string
  readonly locationSingleLabel: string
  readonly locationChoiceLabel: string
  readonly locationChoiceUnselected: string
  readonly locationPlainTextNote: string
  readonly draftTitle: string
  readonly draftNotice: string
  readonly fields: readonly TeamAdminSetupMetadataFieldCopy[]
  readonly reviewTitle: string
  readonly reviewActionLabel: string
  readonly reviewActionBusyLabel: string
  readonly reviewActionHelp: string
  readonly reviewActionBlockedHelp: string
  readonly reviewRefusal: Record<TeamAdminSetupMetadataRefusalKey, string>
  readonly previewTitle: string
  readonly previewIntro: string
  readonly previewNameLabel: string
  readonly previewSymbolLabel: string
  readonly previewUriLabel: string
  readonly previewCampaignLabel: string
  readonly previewOutputMintLabel: string
  readonly previewTargetLabel: string
  readonly previewTargetHint: string
  readonly immutableWarningTitle: string
  readonly immutableWarning: string
  readonly setActionLabel: string
  readonly setActionBusyLabel: string
  readonly setActionHelp: string
  readonly setActionBlockedHelp: string
  readonly stateLabel: Record<TeamAdminSetupMetadataStateKey, string>
  readonly stateNote: Record<TeamAdminSetupMetadataStateKey, string>
  readonly blockingNote: Record<TeamAdminSetupMetadataBlockingKey, string>
  readonly statusActionLabel: string
  readonly statusActionBusyLabel: string
  readonly statusActionHelp: string
  readonly statusEmpty: string
  readonly statusUnread: string
  readonly anotherMutationRunning: string
  readonly recoveryTitle: string
  readonly recoveryIntro: string
  readonly recoveryLabel: Record<TeamAdminSetupMetadataRecoveryKey, string>
  readonly recoveryNote: Record<TeamAdminSetupMetadataRecoveryKey, string>
  readonly resultTitle: string
  readonly nonClaimsTitle: string
  readonly nonClaims: readonly string[]
  readonly footnote: string
}

export const TEAM_ADMIN_SETUP_METADATA: TeamAdminSetupMetadataCopy = {
  eyebrow: 'Team / admin action',
  title: 'Set the output token’s permanent metadata',
  intro:
    'The naming step for a campaign that already exists: one name, one symbol and one approved location, written once to the output token’s metadata account. You review it locally first, then set it — and it runs only when you click Set immutable metadata and approve it in the approved Team wallet.',
  boundary:
    'Devnet only, and one campaign at a time. This step is single-shot: Phase 1 has no metadata-update instruction, so what is written here is what the token carries for good. Adding accepted input token configs, activating a campaign, pausing, unpausing and finalizing are separate steps on their own surfaces, which this one neither performs nor offers. Nothing here is a mainnet, production, audit or readiness claim.',
  authorityTitle: 'Selected campaign',
  authority: {
    EXPLICIT_SELECTION_CONFIRMED:
      'The campaign you explicitly selected is the campaign loaded here, its stored address matches the selection, and its stored campaign admin matches the configured approved Team wallet. That agreement enables the control; it is not the authority — the action re-reads the campaign from devnet and re-checks every one of those facts before anything is signed.',
    APPROVED_TEAM_UNAVAILABLE:
      'No approved Team wallet is configured for this deployment, so there is nothing to compare the campaign’s stored admin against and this surface stays disabled.',
    NO_EXPLICIT_SELECTION:
      'No campaign has been explicitly selected. Choose one before naming its output token: a campaign shown by fallback is a display convenience and is never treated as the target of a permanent write.',
    SELECTION_NOT_EFFECTIVE:
      'The campaign shown is a fallback rather than the one you selected, so this surface stays disabled. A fallback is fine for reading and is never a mutation target.',
    CAMPAIGN_UNAVAILABLE:
      'The selected campaign could not be read right now, so nothing about it is assumed. Reload the campaign before naming its output token.',
    CAMPAIGN_IDENTITY_MISMATCH:
      'The loaded campaign’s own stored address does not agree with the selection, so this surface stays disabled. A mismatch is refused rather than reconciled.',
    CAMPAIGN_ADMIN_MISMATCH:
      'The selected campaign’s stored campaign admin is not the configured approved Team wallet, so this surface stays disabled. Another authority owns that campaign.',
    CAMPAIGN_NOT_INITIALIZED:
      'Metadata is applied while a campaign is still in the initialized lifecycle state. The selected campaign is past it, so this surface stays disabled.',
  },
  walletTitle: 'Approved Team wallet',
  carrierUnavailable:
    'No approved Team wallet is configured for this deployment, so this action is disabled. The approved identity is a deployment configuration value; it is never taken from the connected wallet, a URL, browser storage, or anything typed on this page.',
  disconnected:
    'Connect the approved Team wallet to enable Set immutable metadata. Connecting on its own builds nothing, signs nothing and sends nothing, and reviewing does not need a wallet at all.',
  connectedMatch:
    'The connected wallet matches the configured approved Team wallet. That match enables the control here; it is not the authority — the chain guard re-checks identity and eligibility against live devnet state before anything is signed.',
  connectedMismatch:
    'The connected wallet is not the configured approved Team wallet, so this action stays disabled. Connect the approved Team wallet, or leave this surface alone — a connected wallet never approves itself here.',
  connectPrompt: 'Connect a wallet to continue.',
  noWalletsDetected:
    'No compatible wallet was detected on this page. Install or unlock a Wallet Standard wallet and reload.',
  disconnectLabel: 'Disconnect',
  connectedKeyLabel: 'Connected address (shortened)',
  approvedKeyLabel: 'Approved address (shortened)',
  locationTitle: 'Approved metadata location',
  locationNotConfigured:
    'This deployment has no approved metadata locations configured, so nothing can be set from here. The approved locations are a public deployment configuration value: they are intentionally public, stable and unauthenticated, and a private, signed or credential-bearing address is never configured as one. Configure them for the deployment and reload.',
  locationNote:
    'The location is chosen from what the deployment approved — it is never typed here and never edited here. It is the address of the document describing the token, and setting metadata records that address on chain; it does not publish, upload or verify anything at it.',
  locationSingleLabel: 'Approved location',
  locationChoiceLabel: 'Choose the approved location',
  locationChoiceUnselected:
    'More than one location is approved for this deployment, so choose exactly one. Nothing is preselected: a permanent write does not get a default.',
  locationPlainTextNote:
    'Shown as plain text on purpose. This page does not open it, does not fetch it, does not preview it and does not render it as a link.',
  draftTitle: 'Metadata to review',
  draftNotice:
    'What you type here lives in this tab’s memory only. It is not saved to this browser, it is not carried over from the campaign planning step, and reloading discards it — what survives a reload is the saved attempt for the approved Team wallet and whatever the chain already holds, and both are read back rather than remembered.',
  fields: [
    {
      id: 'name',
      label: 'Output token name',
      note: 'Required, 1–32 bytes once encoded. It is normalized for comparison and written exactly as reviewed. It cannot be changed after this step succeeds.',
    },
    {
      id: 'symbol',
      label: 'Output token symbol',
      note: 'Required, 1–10 bytes once encoded. It is normalized for comparison and written exactly as reviewed. It cannot be changed after this step succeeds.',
    },
  ],
  reviewTitle: 'Review before anything is built',
  reviewActionLabel: 'Review immutable metadata',
  reviewActionBusyLabel: 'Reviewing…',
  reviewActionHelp:
    'A local check only. It works out the exact bytes that would be written and freezes them for your approval. It opens no wallet, signs nothing, sends nothing, reaches no network and records nothing — and it is the only way to reach the final control.',
  reviewActionBlockedHelp:
    'Review immutable metadata stays disabled until this deployment has an approved location, the campaign you explicitly selected is the one loaded here, and this campaign has no metadata and no unfinished attempt.',
  reviewRefusal: {
    INPUT_INVALID: 'The values were not in a form that could be reviewed at all.',
    NAME_ILL_FORMED:
      'The name contains a character that has no valid encoding. It is refused rather than substituted, because a substituted character would be written permanently.',
    NAME_BYTE_LENGTH_OUT_OF_RANGE:
      'The name must be between 1 and 32 bytes once encoded. Accented and non-Latin characters take more than one byte each.',
    SYMBOL_ILL_FORMED:
      'The symbol contains a character that has no valid encoding. It is refused rather than substituted.',
    SYMBOL_BYTE_LENGTH_OUT_OF_RANGE:
      'The symbol must be between 1 and 10 bytes once encoded. Accented and non-Latin characters take more than one byte each.',
    URI_ILL_FORMED:
      'The approved location is not well formed. It is refused rather than repaired: a rewritten address names a different document.',
    URI_SCHEME_NOT_HTTPS: 'An approved location must be an https address, spelled exactly.',
    URI_CREDENTIAL_BEARING:
      'The approved location carries embedded credentials. That is refused outright and is never written.',
    URI_BYTE_LENGTH_OUT_OF_RANGE:
      'The approved location must be between 1 and 200 bytes once encoded.',
    URI_NOT_ALLOWLISTED:
      'The location is not one this deployment approved. Only an exact approved entry may be written.',
    ALLOWLIST_EMPTY:
      'This deployment has no approved metadata locations configured, so nothing can be reviewed or set.',
    CANONICALIZATION_UNAVAILABLE:
      'This browser could not perform the checks this step requires, so nothing was reviewed. Nothing is assumed and nothing is offered.',
  },
  previewTitle: 'Exactly what would be written',
  previewIntro:
    'These are the exact values the request carries — the same bytes that were reviewed, not a tidied rendering of them. If any of them is wrong, edit the draft above: editing discards this approval and you review again.',
  previewNameLabel: 'Name, exactly as it would be written',
  previewSymbolLabel: 'Symbol, exactly as it would be written',
  previewUriLabel: 'Location, exactly as it would be written',
  previewCampaignLabel: 'Campaign address (shortened)',
  previewOutputMintLabel: 'Output mint address (shortened)',
  previewTargetLabel: 'Metadata account (shortened)',
  previewTargetHint:
    'derived from the campaign’s output mint — never typed, never supplied, never editable',
  immutableWarningTitle: 'This cannot be undone',
  immutableWarning:
    'This metadata is permanent for this Phase 1 campaign. After it succeeds it cannot be changed, replaced, corrected or removed — there is no update step, and none is coming in this phase. A mistake is fixed by creating a new campaign, not by editing this one. Read the three values above before you approve.',
  setActionLabel: 'Set immutable metadata',
  setActionBusyLabel: 'Setting…',
  setActionHelp:
    'One click, one wallet approval, one devnet transaction, carrying exactly the values previewed above. There is no automatic retry, no second send and no way back.',
  setActionBlockedHelp:
    'Set immutable metadata stays disabled until the approved Team wallet is configured and connected, the campaign you explicitly selected is the one loaded here, the values above have been reviewed and are still current, and the single saved attempt slot is free.',
  stateLabel: {
    NOT_CONFIGURED: 'Not configured',
    NOT_AUTHORIZED: 'Not available',
    DRAFT: 'Draft',
    READY_FOR_APPROVAL: 'Reviewed',
    SAVED_ATTEMPT: 'Attempt saved',
    SUBMITTED_ATTEMPT: 'Attempt sent',
    METADATA_SET: 'Metadata set',
    NO_EFFECT_PROVEN: 'No proven effect',
    BLOCKED_SUPPORT: 'Needs support',
  },
  stateNote: {
    NOT_CONFIGURED:
      'This deployment approved no metadata locations, so this step offers nothing. Nothing else on this page is affected by that.',
    NOT_AUTHORIZED:
      'This surface is not available for the campaign currently shown. The note under Selected campaign says which check refused.',
    DRAFT:
      'Nothing has been reviewed yet. Type a name and a symbol, choose an approved location, then review — nothing is built, signed or sent by any of that.',
    READY_FOR_APPROVAL:
      'These exact values have been reviewed and frozen for your approval. Editing any of them, or the campaign selection changing, discards this approval and you review again.',
    SAVED_ATTEMPT:
      'A saved attempt exists for this campaign’s metadata and no broadcast is proven. Do not start a second one — use Check metadata submission status, which signs nothing and sends nothing.',
    SUBMITTED_ATTEMPT:
      'A saved attempt for this campaign’s metadata holds a known signature, so it may already have reached devnet. A second attempt would not be a retry, and none is offered: use Check metadata submission status.',
    METADATA_SET:
      'This campaign’s output token metadata is set. It is permanent and single-shot, so nothing further is offered here — not an edit, not a replacement and not a correction. A different name, symbol or location does not reopen this step.',
    NO_EFFECT_PROVEN:
      'The last saved attempt is finished with no proven effect, and the campaign’s freshly read state shows no metadata. Reviewing and setting again may become possible; that is decided by re-reading devnet when you do, not by this note.',
    BLOCKED_SUPPORT:
      'What this campaign’s metadata is could not be established, so nothing is claimed and nothing is offered. This needs support rather than another attempt.',
  },
  blockingNote: {
    ALLOWLIST_NOT_CONFIGURED:
      'This deployment has no approved metadata locations configured, so there is nothing this step could write.',
    CAMPAIGN_NOT_AUTHORIZED:
      'The campaign shown is not an authorized target for this step. The note under Selected campaign says which check refused.',
    METADATA_ALREADY_SET:
      'This campaign already has its output token metadata. It is permanent and single-shot: there is no update instruction in this phase, so it is never overwritten, replaced or edited, and different values are not a reason to set it again.',
    METADATA_TARGET_INCONSISTENT:
      'The campaign reports no metadata, and a metadata account for its output token appears to exist anyway. The two disagree, so nothing is claimed and nothing is offered — this needs support rather than a write.',
    METADATA_TARGET_UNREADABLE:
      'The metadata account for this campaign’s output token could not be read. An unreadable account is not an absent one, so nothing is assumed and nothing is enabled.',
    MUTATION_STATUS_UNAVAILABLE:
      'The saved attempt slot could not be read, so it is treated as occupied rather than free. Nothing is enabled until it can be read.',
    SAVED_ATTEMPT_OUTSTANDING:
      'A saved attempt for this campaign’s metadata is still unresolved. There is exactly one attempt slot, and nothing new may start until that one is resolved. Use Check metadata submission status.',
    GLOBAL_MUTATION_SLOT_ACTIVE:
      'An unresolved saved attempt already exists for the approved Team wallet. There is exactly one attempt slot — across every campaign and every operation — so nothing new may start until that one is resolved. Use Check metadata submission status.',
    SUPPORT_DISPOSITION_BLOCKED:
      'The saved attempt was acknowledged as unresolved. Acknowledging an unresolved attempt does not resolve it, so it never becomes permission to start another one — this needs support rather than a new attempt.',
    CHAIN_TRUTH_UNAVAILABLE:
      'The campaign state this step would be judged against could not be read with the freshness that judgment needs, so no state is claimed for it and nothing is enabled. An unreadable campaign is not one without metadata.',
    NO_CURRENT_APPROVAL_SNAPSHOT:
      'Nothing has been reviewed, or what was reviewed is no longer current. Review the exact values again before the final control is offered — a permanent write is never made from values nobody approved.',
  },
  statusActionLabel: 'Check metadata submission status',
  statusActionBusyLabel: 'Checking…',
  statusActionHelp:
    'Reads what is already known about the saved attempt and re-reads it afterwards. It signs nothing, opens no wallet, sends nothing and starts no new attempt — so it is safe after a reload or a disconnect, and it needs no connected wallet.',
  statusEmpty: 'No saved attempt exists for the approved Team wallet right now.',
  statusUnread:
    'The saved attempt slot has not been read in this tab yet. This step is treated as blocked until it is.',
  anotherMutationRunning:
    'Another Team/Admin mutation was already running in this tab, so this one did not start. Nothing was built, nothing was signed and nothing was sent by it. Wait for the running action to finish; this is not a failure and there is nothing to undo.',
  recoveryTitle: 'Recovered saved attempt',
  recoveryIntro:
    'What you typed is held in this tab only and is discarded on reload. A saved attempt is not: it is recorded durably, so it is shown here after a reload from that record plus a fresh reading of devnet. The record keeps commitments rather than text, so the name, symbol and location are deliberately not reproduced — and this is a report rather than an editable draft. It offers no submission.',
  recoveryLabel: {
    SAVED: 'Attempt saved',
    SUBMITTED: 'Attempt sent',
    METADATA_SET: 'Metadata set',
    NO_PROVEN_EFFECT: 'No proven effect',
    EFFECT_WITHOUT_CHAIN_STATE: 'Unconfirmed',
    SUPPORT_ONLY: 'Support only',
    CHAIN_TRUTH_UNAVAILABLE: 'Not read',
    TARGET_INCONSISTENT: 'Conflict',
  },
  recoveryNote: {
    SAVED:
      'A saved attempt reached the durable record and no signature was retained for it, so it is not shown as sent. It is not a failure either, and it is not a reason to start again. Use Check metadata submission status.',
    SUBMITTED:
      'A signature was retained for this saved attempt, so it may already have reached the network. There is no retry here and there never will be: the only step offered is Check metadata submission status.',
    METADATA_SET:
      'This saved attempt is finished and the campaign’s freshly read state reports its metadata as set. It is permanent, and nothing further is offered for it.',
    NO_PROVEN_EFFECT:
      'This saved attempt is finished with no proven effect, and the campaign’s freshly read state shows no metadata. Reviewing and setting again may become possible; that is decided by re-reading devnet when you do.',
    EFFECT_WITHOUT_CHAIN_STATE:
      'This saved attempt reports that it took effect, and the campaign’s freshly read state does not report metadata. The two disagree, so nothing is claimed and nothing is offered.',
    SUPPORT_ONLY:
      'This saved attempt was acknowledged as unresolved rather than resolved, so no outcome is claimed for it and no new attempt may start from it.',
    CHAIN_TRUTH_UNAVAILABLE:
      'The campaign state this saved attempt would be judged against has not been read with the freshness that judgment needs, so no outcome is claimed for it. Use Check metadata submission status.',
    TARGET_INCONSISTENT:
      'This saved attempt took no proven effect, and the campaign or its metadata account says otherwise. The two disagree, so this is reported rather than reconciled.',
  },
  resultTitle: 'What the last action reported',
  nonClaimsTitle: 'What setting metadata does not mean',
  nonClaims: [
    'not a mainnet, production or public-product step',
    'not an audit, and not a readiness claim of any kind',
    'no campaign was activated, no accepted input was added, and no lifecycle state was changed',
    'nothing was published, uploaded or verified at the approved location — only its address is recorded',
    'a visible control is never evidence that any particular attempt reached devnet',
    'not a claim about any wallet other than the one that approved it',
  ],
  footnote:
    'Devnet-only, single-shot metadata for one selected campaign. A visible control is not evidence that a transaction was submitted or landed, and it does not imply activation or campaign completion.',
}

// The copy for the ONE-WAY step: the FOURTH visible Team/Admin surface, a sibling of
// the accepted-input workspace and the permanent-metadata surface under the same
// post-init mutation provider, and the only one that closes a campaign's setup.
//
// Six wording rules are load-bearing here.
//
//   1. PROGRAM AND PRODUCT ARE NAMED SEPARATELY. `activate_campaign` requires the
//      initialized status and `metadata_setup`; where an `end_ts` exists it also
//      requires the ON-CHAIN clock to still be before it. REDAX ADDITIONALLY requires
//      at least one accepted token config, and the program does not. No sentence here
//      may attribute the product's rule to the program.
//   2. THE BROWSER CLOCK IS NOT AUTHORITY. The deadline shown is the campaign's own
//      stored `end_ts`, rendered for reading. Whether the window is open is decided
//      from the chain's own clock, read beside the campaign, immediately before the
//      wallet is asked and again immediately before anything is sent.
//   3. ONE-WAY MEANS ONE-WAY. A campaign does not return to `initialized`, and no
//      further accepted token config can be added after activation. No line may say
//      "for now", "initially" or "you can change this later".
//   4. A STATE IS NOT AN ATTRIBUTION. A campaign that is active, paused or finalized
//      is past the activation predecessor — that is ALL it proves. Without a matching
//      local record, no sentence here may say this product activated it.
//   5. A LANDED FAILURE IS NOT AN EXPIRY. Where all that is known is that the exact
//      intended transaction landed and the program rejected it, the copy says exactly
//      that. `CampaignExpired` is never named as the cause of anything.
//   6. A REVIEW IS NOT A SUBMISSION. Reviewing freezes what the operator read; it
//      signs nothing, sends nothing, opens no wallet and touches no network.

/**
 * The fifteen activation product states, as copy keys.
 *
 * RE-DECLARED HERE rather than imported, like every other key union in this module:
 * this file is product copy and reaches no Team/Admin module at all. The panel indexes
 * these records with the product module's own union, so a state added there and not
 * described here stops the panel compiling.
 */
export type TeamAdminActivateCampaignStateKey =
  | 'NOT_CONFIGURED'
  | 'NOT_AUTHORIZED'
  | 'NOT_INITIALIZED'
  | 'METADATA_NOT_SET'
  | 'NO_TOKEN_CONFIGS'
  | 'CHAIN_TRUTH_UNAVAILABLE'
  | 'READY_FOR_ACKNOWLEDGEMENT'
  | 'READY_FOR_ACTIVATION'
  | 'SAVED_ATTEMPT'
  | 'SUBMITTED_ATTEMPT'
  | 'CAMPAIGN_ACTIVATED'
  | 'ACTIVATION_SUPERSEDED'
  | 'NO_EFFECT_PROVEN'
  | 'BLOCKED_SUPPORT'
  | 'POST_ACTIVATION_STATE_UNATTRIBUTED'

/** Why activation may not be offered. A refusal, never a durable state. */
export type TeamAdminActivateCampaignBlockingKey =
  | 'DEPLOYMENT_NOT_CONFIGURED'
  | 'CAMPAIGN_NOT_AUTHORIZED'
  | 'ACTIVATION_ALREADY_ATTRIBUTED'
  | 'POST_ACTIVATION_STATE_UNATTRIBUTED'
  | 'SUPPORT_DISPOSITION_BLOCKED'
  | 'MUTATION_STATUS_UNAVAILABLE'
  | 'SAVED_ATTEMPT_OUTSTANDING'
  | 'GLOBAL_MUTATION_SLOT_ACTIVE'
  | 'CHAIN_TRUTH_UNAVAILABLE'
  | 'CAMPAIGN_NOT_INITIALIZED'
  | 'METADATA_NOT_SET'
  | 'NO_TOKEN_CONFIGS'
  | 'NO_CURRENT_ACKNOWLEDGEMENT'

/** Why the selected campaign is, or is not, an activation target. */
export type TeamAdminActivateCampaignAuthorityKey =
  | 'EXPLICIT_SELECTION_CONFIRMED'
  | 'APPROVED_TEAM_UNAVAILABLE'
  | 'NO_EXPLICIT_SELECTION'
  | 'SELECTION_NOT_EFFECTIVE'
  | 'CAMPAIGN_UNAVAILABLE'
  | 'CAMPAIGN_IDENTITY_MISMATCH'
  | 'CAMPAIGN_ADMIN_MISMATCH'
  | 'CAMPAIGN_NOT_INITIALIZED'

/** What ONE recovered activation attempt is, after a reload. Re-declared, never imported. */
export type TeamAdminActivateCampaignRecoveryKey =
  | 'SAVED'
  | 'SUBMITTED'
  | 'CAMPAIGN_ACTIVATED'
  | 'ACTIVATION_SUPERSEDED'
  | 'NO_PROVEN_EFFECT'
  | 'EFFECT_WITHOUT_CHAIN_STATE'
  | 'SUPPORT_ONLY'
  | 'CHAIN_TRUTH_UNAVAILABLE'
  | 'STATE_INCONSISTENT'

/** Static framing for the one-way activation surface. */
export interface TeamAdminActivateCampaignCopy {
  readonly eyebrow: string
  readonly title: string
  readonly intro: string
  readonly boundary: string
  readonly authorityTitle: string
  readonly authority: Record<TeamAdminActivateCampaignAuthorityKey, string>
  readonly walletTitle: string
  readonly walletNote: string
  readonly walletCarrierUnavailable: string
  readonly approvedKeyLabel: string
  readonly prerequisitesTitle: string
  readonly programPrerequisites: readonly string[]
  readonly productPrerequisites: readonly string[]
  readonly deadlineTitle: string
  readonly deadlineLabel: string
  readonly deadlineNone: string
  readonly deadlineUnavailable: string
  readonly deadlineAuthorityNote: string
  readonly tokenConfigCountLabel: string
  readonly tokenConfigCountHint: string
  readonly metadataStateLabel: string
  readonly metadataStateSet: string
  readonly metadataStateNotSet: string
  readonly reviewTitle: string
  readonly reviewActionLabel: string
  readonly reviewActionHelp: string
  readonly reviewActionBlockedHelp: string
  readonly previewTitle: string
  readonly previewIntro: string
  readonly previewCampaignLabel: string
  readonly oneWayWarningTitle: string
  readonly oneWayWarning: string
  readonly activateActionLabel: string
  readonly activateActionBusyLabel: string
  readonly activateActionHelp: string
  readonly activateActionBlockedHelp: string
  readonly stateLabel: Record<TeamAdminActivateCampaignStateKey, string>
  readonly stateNote: Record<TeamAdminActivateCampaignStateKey, string>
  readonly blockingNote: Record<TeamAdminActivateCampaignBlockingKey, string>
  readonly statusActionLabel: string
  readonly statusActionBusyLabel: string
  readonly statusActionHelp: string
  readonly statusEmpty: string
  readonly statusUnread: string
  readonly anotherMutationRunning: string
  readonly recoveryTitle: string
  readonly recoveryIntro: string
  readonly recoveryLabel: Record<TeamAdminActivateCampaignRecoveryKey, string>
  readonly recoveryNote: Record<TeamAdminActivateCampaignRecoveryKey, string>
  readonly resultTitle: string
  readonly nonClaimsTitle: string
  readonly nonClaims: readonly string[]
  readonly footnote: string
}

export const TEAM_ADMIN_ACTIVATE_CAMPAIGN: TeamAdminActivateCampaignCopy = {
  eyebrow: 'Team / admin action',
  title: 'Activate the selected campaign',
  intro:
    'The step that opens a campaign to holder conversions. You review the exact setup first, then activate it — and it runs only when you click Activate campaign and approve it in the approved Team wallet. It is one-way.',
  boundary:
    'Devnet only, and one campaign at a time. Adding accepted input token configs and naming the output token are separate surfaces, and both of them close when this step succeeds. Pausing, unpausing and finalizing a campaign are separate steps on their own surface, which this one neither performs nor offers. Nothing here is a mainnet, production, audit or readiness claim.',
  authorityTitle: 'Selected campaign',
  authority: {
    EXPLICIT_SELECTION_CONFIRMED:
      'The campaign you explicitly selected is the campaign loaded here, its stored address matches the selection, and its stored campaign admin matches the configured approved Team wallet. That agreement enables the control; it is not the authority — the action re-reads the campaign from devnet and re-checks every one of those facts before anything is signed.',
    APPROVED_TEAM_UNAVAILABLE:
      'No approved Team wallet is configured for this deployment, so there is nothing to compare the campaign’s stored admin against and this surface stays disabled.',
    NO_EXPLICIT_SELECTION:
      'No campaign has been explicitly selected. Choose one before activating: a campaign shown by fallback is a display convenience and is never treated as the target of a one-way step.',
    SELECTION_NOT_EFFECTIVE:
      'The campaign shown is a fallback rather than the one you selected, so this surface stays disabled. A fallback is fine for reading and is never a mutation target.',
    CAMPAIGN_UNAVAILABLE:
      'The selected campaign could not be read right now, so nothing about it is assumed. Reload the campaign before activating it.',
    CAMPAIGN_IDENTITY_MISMATCH:
      'The loaded campaign’s own stored address does not agree with the selection, so this surface stays disabled. A mismatch is refused rather than reconciled.',
    CAMPAIGN_ADMIN_MISMATCH:
      'The selected campaign’s stored campaign admin is not the configured approved Team wallet, so this surface stays disabled. Another authority owns that campaign.',
    CAMPAIGN_NOT_INITIALIZED:
      'A campaign is activated out of the initialized lifecycle state. The selected campaign is past it, so this surface stays disabled.',
  },
  walletTitle: 'Approved Team wallet',
  walletNote:
    'This surface holds no wallet of its own: it reads no connection state, offers no connect or disconnect control and can prompt no wallet by itself. Connect the approved Team wallet on the accepted-input or metadata surface above. Whether the wallet approving this transaction is the approved Team wallet is decided by the action itself, against live devnet state, immediately before anything is signed — and a wallet that is not it is refused there.',
  walletCarrierUnavailable:
    'No approved Team wallet is configured for this deployment, so this action is disabled. The approved identity is a deployment configuration value; it is never taken from the connected wallet, a URL, browser storage, or anything typed on this page.',
  approvedKeyLabel: 'Approved address (shortened)',
  prerequisitesTitle: 'What has to be true',
  programPrerequisites: [
    'The program requires the campaign to still be in the initialized lifecycle state.',
    'The program requires the campaign’s metadata_setup to already be true.',
    'Where the campaign carries an end_ts, the program requires the on-chain clock to still be before it when the transaction executes. That clock is read from the chain — this page’s own clock is never the authority, and no allowance or margin is added to it.',
  ],
  productPrerequisites: [
    'REDAX additionally requires the campaign to already hold at least one accepted token config. The program has no such requirement; REDAX adds it because activation is one-way and accepted token configs can only be added while a campaign is initialized.',
  ],
  deadlineTitle: 'Campaign window',
  deadlineLabel: 'Campaign end (UTC)',
  deadlineNone:
    'This campaign carries no end_ts, so there is no window to close. The chain’s own clock is still read before anything is signed and again before anything is sent.',
  deadlineUnavailable:
    'This campaign’s stored end_ts could not be read as a date, so nothing is shown for it and nothing is assumed about it.',
  deadlineAuthorityNote:
    'Shown for reading only, from the campaign’s own stored value. Whether the window is still open is decided from the chain’s own clock, read alongside the campaign — immediately before the wallet is asked, and again immediately before anything is sent. A window that closes while you are reading the wallet prompt stops the send.',
  tokenConfigCountLabel: 'Accepted token configs',
  tokenConfigCountHint:
    'read from the campaign; REDAX requires at least one before activation, and none can be added afterwards',
  metadataStateLabel: 'Output token metadata',
  metadataStateSet: 'set — the program requires this before activation',
  metadataStateNotSet: 'not set — the program refuses activation without it',
  reviewTitle: 'Review before anything is built',
  reviewActionLabel: 'Review activation',
  reviewActionHelp:
    'A local check only. It freezes the exact campaign setup shown above — the campaign, its admin, its lifecycle state, its metadata flag, its accepted token config count and its end_ts — for your approval. It opens no wallet, signs nothing, sends nothing, reaches no network, reads no clock and records nothing, and it is the only way to reach the final control.',
  reviewActionBlockedHelp:
    'Review activation stays disabled until the campaign you explicitly selected is the one loaded here, that campaign is still initialized with metadata set and at least one accepted token config, and there is no unfinished attempt.',
  previewTitle: 'Exactly what would be activated',
  previewIntro:
    'This is the campaign the request carries — the same one that was reviewed. If anything above changes, this approval is discarded and you review again.',
  previewCampaignLabel: 'Campaign address (shortened)',
  oneWayWarningTitle: 'This cannot be undone',
  oneWayWarning:
    'Activation is one-way. After it succeeds this campaign does not return to the initialized state, and no further accepted token config can be added to it — adding one requires the initialized state this step leaves behind. Naming the output token is likewise closed. Read the setup above before you approve.',
  activateActionLabel: 'Activate campaign',
  activateActionBusyLabel: 'Activating…',
  activateActionHelp:
    'One click, one wallet approval in the approved Team wallet, one devnet transaction, for exactly the campaign previewed above. There is no automatic retry, no second send and no way back. There is exactly one Team/Admin attempt slot, so another Team/Admin action running in this tab will refuse this one before it starts.',
  activateActionBlockedHelp:
    'Activate campaign stays disabled until the approved Team wallet is configured for this deployment, the campaign you explicitly selected is the one loaded here, that campaign is still initialized with metadata set and at least one accepted token config, the setup above has been reviewed and is still current, and the single saved attempt slot is free.',
  stateLabel: {
    NOT_CONFIGURED: 'Not configured',
    NOT_AUTHORIZED: 'Not available',
    NOT_INITIALIZED: 'Not initialized',
    METADATA_NOT_SET: 'Metadata not set',
    NO_TOKEN_CONFIGS: 'No accepted inputs',
    CHAIN_TRUTH_UNAVAILABLE: 'Not read',
    READY_FOR_ACKNOWLEDGEMENT: 'Ready to review',
    READY_FOR_ACTIVATION: 'Reviewed',
    SAVED_ATTEMPT: 'Attempt saved',
    SUBMITTED_ATTEMPT: 'Attempt sent',
    CAMPAIGN_ACTIVATED: 'Campaign activated',
    ACTIVATION_SUPERSEDED: 'Activated, then moved on',
    NO_EFFECT_PROVEN: 'No proven effect',
    BLOCKED_SUPPORT: 'Needs support',
    POST_ACTIVATION_STATE_UNATTRIBUTED: 'Past setup — not attributed here',
  },
  stateNote: {
    NOT_CONFIGURED:
      'This deployment did not resolve an approved Team wallet and a runtime program identity, so this step offers nothing.',
    NOT_AUTHORIZED:
      'This surface is not available for the campaign currently shown. The note under Selected campaign says which check refused.',
    NOT_INITIALIZED:
      'A campaign is activated out of the initialized lifecycle state, and the campaign read here is not in it.',
    METADATA_NOT_SET:
      'The program requires the campaign’s output token metadata before it will activate it, and this campaign reports none. Set the metadata on its own surface first; nothing here can do it.',
    NO_TOKEN_CONFIGS:
      'This campaign holds no accepted token config. The program would activate it anyway; REDAX will not, because accepted token configs can only be added while a campaign is initialized — activating first would leave a campaign holders can see and cannot use.',
    CHAIN_TRUTH_UNAVAILABLE:
      'The campaign state this step would be judged against could not be read with the freshness that judgment needs, so no state is claimed for it and nothing is enabled.',
    READY_FOR_ACKNOWLEDGEMENT:
      'The setup above has not been reviewed yet. Review it — that builds nothing, signs nothing and sends nothing — and the final control appears afterwards.',
    READY_FOR_ACTIVATION:
      'This exact setup has been reviewed and frozen for your approval. Anything about it changing — the campaign selection, its admin, its lifecycle state, its metadata flag, its accepted token config count or its end_ts — discards this approval and you review again.',
    SAVED_ATTEMPT:
      'A saved attempt exists for this campaign’s activation and no broadcast is proven. Do not start a second one — use Check activation status, which signs nothing and sends nothing.',
    SUBMITTED_ATTEMPT:
      'A saved attempt for this campaign’s activation holds a known signature, so it may already have reached devnet. A second attempt would not be a retry, and none is offered: use Check activation status.',
    CAMPAIGN_ACTIVATED:
      'This campaign’s own activation attempt is recorded here as having taken effect, and the campaign’s state matches what that attempt expected. Activation is one-way, so nothing further is offered here.',
    ACTIVATION_SUPERSEDED:
      'This campaign’s own activation attempt is recorded here as having landed exactly as intended, and the campaign has since moved on from the state that attempt expected — it may have been paused or finalized after activation. What is claimed is the landing, not the current lifecycle; the current state is read separately and is not evidence of a cycle nobody observed.',
    NO_EFFECT_PROVEN:
      'The last saved attempt is finished with no proven effect, and the campaign’s freshly read state still shows it as initialized. Reviewing and activating again may become possible; that is decided by re-reading devnet when you do, and the chain’s own clock is checked again then.',
    BLOCKED_SUPPORT:
      'What this campaign’s activation attempt did could not be established, so nothing is claimed and nothing is offered. This needs support rather than another attempt.',
    POST_ACTIVATION_STATE_UNATTRIBUTED:
      'This campaign is past the setup and activation state — it reads as active, paused or finalized — so it cannot be activated again. This product holds no matching local record of activating it, so it does not claim that it did; what moved the campaign is not something this surface can establish.',
  },
  blockingNote: {
    DEPLOYMENT_NOT_CONFIGURED:
      'This deployment did not resolve both an approved Team wallet and a runtime program identity, so there is nothing this step could act on.',
    CAMPAIGN_NOT_AUTHORIZED:
      'The campaign shown is not an authorized target for this step. The note under Selected campaign says which check refused.',
    ACTIVATION_ALREADY_ATTRIBUTED:
      'This campaign’s own activation attempt is already recorded here as having taken effect. Activation is one-way and is never offered twice.',
    POST_ACTIVATION_STATE_UNATTRIBUTED:
      'This campaign has already left the initialized state, so it cannot be activated again. This product holds no matching local record of activating it and does not claim to have done so.',
    SUPPORT_DISPOSITION_BLOCKED:
      'The saved attempt was acknowledged as unresolved. Acknowledging an unresolved attempt does not resolve it, so it never becomes permission to start another one — this needs support rather than a new attempt.',
    MUTATION_STATUS_UNAVAILABLE:
      'The saved attempt slot could not be read, so it is treated as occupied rather than free. Nothing is enabled until it can be read.',
    SAVED_ATTEMPT_OUTSTANDING:
      'A saved attempt for this campaign’s activation is still unresolved. There is exactly one attempt slot, and nothing new may start until that one is resolved. Use Check activation status.',
    GLOBAL_MUTATION_SLOT_ACTIVE:
      'An unresolved saved attempt already exists for the approved Team wallet. There is exactly one attempt slot — across every campaign and every operation — so nothing new may start until that one is resolved. Use Check activation status.',
    CHAIN_TRUTH_UNAVAILABLE:
      'The campaign state this step would be judged against could not be read with the freshness that judgment needs, so no state is claimed for it and nothing is enabled.',
    CAMPAIGN_NOT_INITIALIZED:
      'A campaign is activated out of the initialized lifecycle state, and the campaign read here is not in it.',
    METADATA_NOT_SET:
      'The program requires the campaign’s output token metadata before it will activate it, and this campaign reports none.',
    NO_TOKEN_CONFIGS:
      'This campaign holds no accepted token config. That is a REDAX product requirement rather than a program one, and it exists because accepted token configs can only be added while a campaign is initialized.',
    NO_CURRENT_ACKNOWLEDGEMENT:
      'Nothing has been reviewed, or what was reviewed is no longer current. Review the exact setup again before the final control is offered — a one-way step is never taken from a situation nobody approved.',
  },
  statusActionLabel: 'Check activation status',
  statusActionBusyLabel: 'Checking…',
  statusActionHelp:
    'Reads what is already known about the saved attempt and re-reads it afterwards. It signs nothing, opens no wallet, sends nothing and starts no new attempt — so it is safe after a reload or a disconnect, and it needs no connected wallet. Nothing on this page polls: this runs once, when you click it.',
  statusEmpty: 'No saved attempt exists for the approved Team wallet right now.',
  statusUnread:
    'The saved attempt slot has not been read in this tab yet. This step is treated as blocked until it is.',
  anotherMutationRunning:
    'Another Team/Admin mutation was already running in this tab, so this one did not start. Nothing was built, nothing was signed and nothing was sent by it. Wait for the running action to finish; this is not a failure, this campaign was not activated, and there is nothing to undo.',
  recoveryTitle: 'Recovered saved attempt',
  recoveryIntro:
    'What you review here is held in this tab only and is discarded on reload. A saved attempt is not: it is recorded durably, so it is shown here after a reload from that record plus a fresh reading of devnet. This is a report rather than a control — it offers no submission.',
  recoveryLabel: {
    SAVED: 'Attempt saved',
    SUBMITTED: 'Attempt sent',
    CAMPAIGN_ACTIVATED: 'Campaign activated',
    ACTIVATION_SUPERSEDED: 'Activated, then moved on',
    NO_PROVEN_EFFECT: 'No proven effect',
    EFFECT_WITHOUT_CHAIN_STATE: 'Unconfirmed',
    SUPPORT_ONLY: 'Support only',
    CHAIN_TRUTH_UNAVAILABLE: 'Not read',
    STATE_INCONSISTENT: 'Conflict',
  },
  recoveryNote: {
    SAVED:
      'A saved attempt reached the durable record and no signature was retained for it, so it is not shown as sent. It is not a failure either, and it is not a reason to start again. Use Check activation status.',
    SUBMITTED:
      'A signature was retained for this saved attempt, so it may already have reached the network. There is no retry here and there never will be: the only step offered is Check activation status.',
    CAMPAIGN_ACTIVATED:
      'This saved attempt is finished, it is recorded as having taken effect, and the campaign’s freshly read state is past the initialized step. Activation is one-way, and nothing further is offered for it.',
    ACTIVATION_SUPERSEDED:
      'This saved attempt is recorded as having landed exactly as intended, and the campaign has since moved on from the state it expected. The landing is what is claimed; the campaign’s current lifecycle state is read separately and proves nothing about how it got there.',
    NO_PROVEN_EFFECT:
      'This saved attempt is finished with no proven effect — nothing was broadcast, nothing landed, or the exact intended transaction landed and the program rejected it — and the campaign’s freshly read state still shows it as initialized. No cause is claimed for it. Reviewing and activating again may become possible; that is decided by re-reading devnet when you do.',
    EFFECT_WITHOUT_CHAIN_STATE:
      'This saved attempt reports that it took effect, and the campaign’s freshly read state still shows it as initialized. The two disagree, so nothing is claimed and nothing is offered.',
    SUPPORT_ONLY:
      'This saved attempt was acknowledged as unresolved rather than resolved, so no outcome is claimed for it and no new attempt may start from it.',
    CHAIN_TRUTH_UNAVAILABLE:
      'The campaign state this saved attempt would be judged against has not been read with the freshness that judgment needs, so no outcome is claimed for it. Use Check activation status.',
    STATE_INCONSISTENT:
      'This saved attempt took no proven effect, and the campaign has nevertheless left the initialized state. The two disagree, so this is reported rather than reconciled — and which route moved the campaign is not something this surface can establish.',
  },
  resultTitle: 'What the last action reported',
  nonClaimsTitle: 'What activating does not mean',
  nonClaims: [
    'source implementation is not live execution — a visible control is never evidence that any particular attempt reached devnet',
    'no wallet approval is proven, no broadcast is proven, and no campaign activation is proven by this surface existing',
    'not a mainnet, production or public-product step, and not an audit or readiness claim of any kind',
    'activation runs on devnet only, and only when you click Activate campaign and approve it in the approved Team wallet — it is not an investor-ready or production-ready claim',
    'activating a campaign does not list it in the public directory, and it is not REDAX review, verification or endorsement',
    'a campaign that reads as active, paused or finalized is not evidence that this product activated it',
    'a transaction that landed and failed proves no effect and no cause — it is never reported as an expired campaign',
    'not a claim about any wallet other than the one that approved it',
  ],
  footnote:
    'Devnet-only, one-way activation for one selected campaign. A visible control is not evidence that a transaction was submitted or landed, and it does not imply campaign completion, holder conversion or any readiness claim.',
}

// The copy for the LAST three post-init operations — `pause_campaign`,
// `unpause_campaign` and `finalize_campaign` — on the FIFTH visible Team/Admin
// surface. One shared surface rather than three, because they are one decision:
// which lifecycle step, if any, a campaign should take next.
//
// Seven wording rules are load-bearing here.
//
//   1. A STATE IS NOT AN ATTRIBUTION. A campaign that reads as paused is CURRENTLY
//      PAUSED — that is all it proves. Without a matching local record, no sentence
//      here may say this product paused, unpaused or finalized it.
//   2. TWO REVERSIBLE STEPS AND ONE TERMINAL ONE. Pause and unpause may each happen
//      many times; a later one is a NEW occurrence and never a retry, and no line
//      here may offer to try again, resend or repeat an attempt. Finalize is
//      terminal, and no line may soften that with "for now" or "initially".
//   3. PROGRAM AND BROWSER PRODUCT ARE NAMED SEPARATELY. The program's
//      `pause_campaign` accepts the campaign admin OR the protocol emergency-pause
//      authority. This browser product exposes only the first. Neither fact may
//      erase the other, and the emergency role is described as out of product scope
//      rather than as unavailable-for-now.
//   4. NO CLOCK, AND NO DEADLINE RULE. A deadline does not cause a pause, a deadline
//      does not cause a finalization, and a reached cap does not cause one either. An
//      expired campaign may still be active or paused, and unpausing one changes
//      nothing about its window, its cap or the program's own conversion checks.
//   5. CHAIN ORDERING GOVERNS RACES. A holder conversion that executes before a pause
//      or a finalize may succeed, and one that executes after is subject to the
//      program's own status, deadline and cap guards. Click order establishes nothing,
//      and no lifecycle step reaches back into a conversion that already executed.
//   6. A LANDED FAILURE IS NOT A DIAGNOSIS. Where all that is known is that the exact
//      intended transaction landed and the program rejected it, the copy says exactly
//      that. `WrongCampaignStatus`, `Unauthorized` and `CampaignExpired` are never
//      named as the cause of anything.
//   7. A REVIEW IS NOT A SUBMISSION. Reviewing a finalization freezes what the
//      operator read; it signs nothing, sends nothing, opens no wallet and touches no
//      network.

/** The FIVE current-chain states. Re-declared here, like every key union in this module. */
export type TeamAdminCampaignLifecycleChainStateKey =
  | 'INITIALIZED'
  | 'ACTIVE'
  | 'PAUSED'
  | 'FINALIZED'
  | 'UNAVAILABLE'

/** The ELEVEN local attributions. What this product's own attempt did, never what the campaign is. */
export type TeamAdminCampaignLifecycleAttributionKey =
  | 'EMPTY'
  | 'SAVED'
  | 'SUBMITTED'
  | 'PAUSE_CONFIRMED'
  | 'UNPAUSE_CONFIRMED'
  | 'FINALIZE_CONFIRMED'
  | 'SUPERSEDED'
  | 'NO_EFFECT_PROVEN'
  | 'SUPPORT'
  | 'CHAIN_TRUTH_UNAVAILABLE'
  | 'STATE_INCONSISTENT'

/** Why NO lifecycle step may be attempted. A global refusal, never a durable state. */
export type TeamAdminCampaignLifecycleBlockingKey =
  | 'DEPLOYMENT_NOT_CONFIGURED'
  | 'CAMPAIGN_NOT_AUTHORIZED'
  | 'SUPPORT_DISPOSITION_BLOCKED'
  | 'LOCAL_RECORD_STATE_INCONSISTENT'
  | 'MUTATION_STATUS_UNAVAILABLE'
  | 'SAVED_ATTEMPT_OUTSTANDING'
  | 'GLOBAL_MUTATION_SLOT_ACTIVE'
  | 'CHAIN_TRUTH_UNAVAILABLE'
  | 'CAMPAIGN_NOT_ACTIVATED'
  | 'CAMPAIGN_FINALIZED'

/** Why the selected campaign is, or is not, a lifecycle target. */
export type TeamAdminCampaignLifecycleAuthorityKey =
  | 'EXPLICIT_SELECTION_CONFIRMED'
  | 'APPROVED_TEAM_UNAVAILABLE'
  | 'NO_EXPLICIT_SELECTION'
  | 'SELECTION_NOT_EFFECTIVE'
  | 'CAMPAIGN_UNAVAILABLE'
  | 'CAMPAIGN_IDENTITY_MISMATCH'
  | 'CAMPAIGN_ADMIN_MISMATCH'
  | 'CAMPAIGN_NOT_INITIALIZED'

/**
 * All SIX post-init operations, as copy keys.
 *
 * The single durable attempt slot may hold a record for ANY of them and for any campaign,
 * so the shared status control has to be able to name whichever one it actually found. A
 * surface that could only spell its own three would have had to relabel a sibling's record.
 */
export type TeamAdminCampaignLifecycleOperationKey =
  | 'ADD_TOKEN_CONFIG'
  | 'SETUP_METADATA'
  | 'ACTIVATE_CAMPAIGN'
  | 'PAUSE_CAMPAIGN'
  | 'UNPAUSE_CAMPAIGN'
  | 'FINALIZE_CAMPAIGN'

/** Static framing for the shared pause / unpause / finalize surface. */
export interface TeamAdminCampaignLifecycleCopy {
  readonly eyebrow: string
  readonly title: string
  readonly intro: string
  readonly boundary: string
  readonly chainStateTitle: string
  readonly chainStateLabel: Record<TeamAdminCampaignLifecycleChainStateKey, string>
  readonly chainStateNote: Record<TeamAdminCampaignLifecycleChainStateKey, string>
  readonly attributionTitle: string
  readonly attributionLabel: Record<TeamAdminCampaignLifecycleAttributionKey, string>
  readonly attributionNote: Record<TeamAdminCampaignLifecycleAttributionKey, string>
  readonly blockingNote: Record<TeamAdminCampaignLifecycleBlockingKey, string>
  readonly authorityTitle: string
  readonly authority: Record<TeamAdminCampaignLifecycleAuthorityKey, string>
  readonly walletTitle: string
  readonly walletNote: string
  readonly walletCarrierUnavailable: string
  readonly approvedKeyLabel: string
  readonly emergencyTitle: string
  readonly emergencyProgramNote: string
  readonly emergencyProductNote: string
  readonly deadlineTitle: string
  readonly deadlineNote: string
  readonly holderRaceTitle: string
  readonly holderRaceNote: string
  readonly pauseTitle: string
  readonly pauseRules: readonly string[]
  readonly pauseActionLabel: string
  readonly pauseActionBusyLabel: string
  readonly pauseActionHelp: string
  readonly pauseActionBlockedHelp: string
  readonly unpauseTitle: string
  readonly unpauseRules: readonly string[]
  readonly unpauseActionLabel: string
  readonly unpauseActionBusyLabel: string
  readonly unpauseActionHelp: string
  readonly unpauseActionBlockedHelp: string
  readonly finalizeTitle: string
  readonly finalizeRules: readonly string[]
  readonly reviewActionLabel: string
  readonly reviewActionHelp: string
  readonly reviewActionBlockedHelp: string
  readonly finalizeAcknowledgementRequiredNote: string
  readonly previewTitle: string
  readonly previewIntro: string
  readonly previewCampaignLabel: string
  readonly previewPredecessorLabel: string
  readonly previewPredecessorHint: string
  readonly terminalWarningTitle: string
  readonly terminalWarning: string
  readonly finalizeActionLabel: string
  readonly finalizeActionBusyLabel: string
  readonly finalizeActionHelp: string
  readonly finalizeActionBlockedHelp: string
  readonly operationLabel: Record<TeamAdminCampaignLifecycleOperationKey, string>
  readonly statusActionLabel: string
  readonly statusActionBusyLabel: string
  readonly statusActionHelp: string
  readonly statusEmpty: string
  readonly statusUnread: string
  readonly statusRecordOperationLabel: string
  readonly statusRecordOperationHint: string
  readonly statusRecordCampaignLabel: string
  readonly statusRecordCampaignHint: string
  readonly statusRecordForeignCampaignNote: string
  readonly anotherMutationRunning: string
  readonly recoveryTitle: string
  readonly recoveryIntro: string
  readonly recoveryOperationLabel: string
  readonly resultTitle: string
  readonly nonClaimsTitle: string
  readonly nonClaims: readonly string[]
  readonly footnote: string
}

export const TEAM_ADMIN_CAMPAIGN_LIFECYCLE: TeamAdminCampaignLifecycleCopy = {
  eyebrow: 'Team / admin action',
  title: 'Campaign lifecycle — pause, unpause, finalize',
  intro:
    'The three steps that operate a campaign after it is live: pause it, resume it, or close it permanently. Each runs only when you click it and approve it in the approved Team wallet. Pausing and resuming may each happen more than once; finalizing happens once.',
  boundary:
    'Devnet only, and one campaign at a time. Which step is offered follows the campaign’s current lifecycle state as it is actually read — not what this page did earlier, and not what it would prefer. Nothing here is a mainnet, production, audit or readiness claim.',
  chainStateTitle: 'What this campaign is right now',
  chainStateLabel: {
    INITIALIZED: 'Initialized',
    ACTIVE: 'Active',
    PAUSED: 'Paused',
    FINALIZED: 'Finalized',
    UNAVAILABLE: 'Not read',
  },
  chainStateNote: {
    INITIALIZED:
      'This campaign has been created but never activated, so no lifecycle step applies to it yet. Activating it is a separate surface, and nothing here can do it.',
    ACTIVE:
      'This campaign is open to holder conversions. It may be paused, and it may be finalized. This is a reading of the campaign and says nothing about who last moved it.',
    PAUSED:
      'This campaign is currently paused, so holder conversions are refused by the program while it stays that way. It may be unpaused, and it may be finalized. This is a reading of the campaign and says nothing about who paused it.',
    FINALIZED:
      'This campaign is finalized. That is terminal: it does not return to active or paused, and no lifecycle step is offered for it. This is a reading of the campaign and says nothing about who finalized it.',
    UNAVAILABLE:
      'The campaign’s lifecycle state could not be read with the freshness that judgment needs, so no state is claimed for it and nothing is enabled. Use Check lifecycle status.',
  },
  attributionTitle: 'What this page’s own attempt did',
  attributionLabel: {
    EMPTY: 'Nothing recorded here',
    SAVED: 'Attempt saved',
    SUBMITTED: 'Attempt sent',
    PAUSE_CONFIRMED: 'Paused by this page',
    UNPAUSE_CONFIRMED: 'Unpaused by this page',
    FINALIZE_CONFIRMED: 'Finalized by this page',
    SUPERSEDED: 'Landed, then moved on',
    NO_EFFECT_PROVEN: 'No proven effect',
    SUPPORT: 'Needs support',
    CHAIN_TRUTH_UNAVAILABLE: 'Not read',
    STATE_INCONSISTENT: 'Conflict',
  },
  attributionNote: {
    EMPTY:
      'This page holds no lifecycle attempt of its own for this campaign. Whatever state the campaign is in above, this product does not claim to have put it there.',
    SAVED:
      'A saved lifecycle attempt exists for this campaign and no broadcast is proven. Do not start a second one — use Check lifecycle status, which signs nothing and sends nothing.',
    SUBMITTED:
      'A saved lifecycle attempt for this campaign holds a known signature, so it may already have reached devnet. Nothing here offers to send it again: use Check lifecycle status.',
    PAUSE_CONFIRMED:
      'This page’s own pause attempt is recorded as having landed, and the campaign reads as paused. That is what is claimed — the pause landed. A later explicit unpause may return it to active, and doing so would not be undoing an error.',
    UNPAUSE_CONFIRMED:
      'This page’s own unpause attempt is recorded as having landed, and the campaign reads as active. That is what is claimed — the unpause landed. It reopens no deadline and resets no cap.',
    FINALIZE_CONFIRMED:
      'This page’s own finalize attempt is recorded as having landed, and the campaign reads as finalized. Finalizing is terminal, so nothing further is offered for this campaign.',
    SUPERSEDED:
      'This page’s own lifecycle attempt is recorded as having landed exactly as intended, and the campaign has since moved to a different lifecycle state. Pausing and unpausing are reversible by design, so a later legal change is expected rather than a fault. What is claimed is the landing, not the campaign’s current state.',
    NO_EFFECT_PROVEN:
      'The last saved lifecycle attempt is finished with no proven effect — nothing was broadcast, nothing landed, or the exact intended transaction landed and the program rejected it. No cause is claimed for it. Whether a fresh attempt is admissible is decided by re-reading the campaign when you make one.',
    SUPPORT:
      'What this campaign’s lifecycle attempt did could not be established, so nothing is claimed and nothing is offered. This needs support rather than another attempt.',
    CHAIN_TRUTH_UNAVAILABLE:
      'The campaign state this saved attempt would be judged against has not been read with the freshness that judgment needs, so no outcome is claimed for it. Use Check lifecycle status.',
    STATE_INCONSISTENT:
      'This page’s saved lifecycle attempt and the campaign’s freshly read state disagree, and no legal sequence produces that pair. It is reported rather than reconciled — which of the two is wrong is not something this surface can establish.',
  },
  blockingNote: {
    DEPLOYMENT_NOT_CONFIGURED:
      'This deployment did not resolve both an approved Team wallet and a runtime program identity, so there is nothing these steps could act on.',
    CAMPAIGN_NOT_AUTHORIZED:
      'The campaign shown is not an authorized target for these steps. The note under Selected campaign says which check refused.',
    SUPPORT_DISPOSITION_BLOCKED:
      'The saved attempt was acknowledged as unresolved. Acknowledging an unresolved attempt does not resolve it, so it never becomes permission to start another one — this needs support rather than a new attempt.',
    LOCAL_RECORD_STATE_INCONSISTENT:
      'This page’s saved attempt and the campaign’s freshly read state disagree, so every step is withheld. That disagreement is reported rather than resolved here.',
    MUTATION_STATUS_UNAVAILABLE:
      'The saved attempt slot could not be read, so it is treated as occupied rather than free. Nothing is enabled until it can be read.',
    SAVED_ATTEMPT_OUTSTANDING:
      'A saved lifecycle attempt for this campaign is still unresolved. There is exactly one attempt slot, and nothing new may start until that one is resolved. Use Check lifecycle status.',
    GLOBAL_MUTATION_SLOT_ACTIVE:
      'An unresolved saved attempt already exists for the approved Team wallet. There is exactly one attempt slot — across every campaign and every operation — so nothing new may start until that one is resolved. Use Check lifecycle status.',
    CHAIN_TRUTH_UNAVAILABLE:
      'The campaign state these steps would be judged against could not be read with the freshness that judgment needs, so no state is claimed for it and nothing is enabled.',
    CAMPAIGN_NOT_ACTIVATED:
      'This campaign is still in the initialized lifecycle state. Pausing, unpausing and finalizing all act on a campaign that has been activated, and activating one is a separate surface.',
    CAMPAIGN_FINALIZED:
      'This campaign is finalized. That is terminal: it does not return to active or paused, and no lifecycle step is offered for it.',
  },
  authorityTitle: 'Selected campaign',
  authority: {
    EXPLICIT_SELECTION_CONFIRMED:
      'The campaign you explicitly selected is the campaign loaded here, its stored address matches the selection, and its stored campaign admin matches the configured approved Team wallet. That agreement enables a control; it is not the authority — the action re-reads the campaign from devnet and re-checks every one of those facts before anything is signed.',
    APPROVED_TEAM_UNAVAILABLE:
      'No approved Team wallet is configured for this deployment, so there is nothing to compare the campaign’s stored admin against and this surface stays disabled.',
    NO_EXPLICIT_SELECTION:
      'No campaign has been explicitly selected. Choose one first: a campaign shown by fallback is a display convenience and is never treated as the target of a lifecycle step.',
    SELECTION_NOT_EFFECTIVE:
      'The campaign shown is a fallback rather than the one you selected, so this surface stays disabled. A fallback is fine for reading and is never a mutation target.',
    CAMPAIGN_UNAVAILABLE:
      'The selected campaign could not be read right now, so nothing about it is assumed. Reload the campaign before operating on it.',
    CAMPAIGN_IDENTITY_MISMATCH:
      'The loaded campaign’s own stored address does not agree with the selection, so this surface stays disabled. A mismatch is refused rather than reconciled.',
    CAMPAIGN_ADMIN_MISMATCH:
      'The selected campaign’s stored campaign admin is not the configured approved Team wallet, so this surface stays disabled. Another authority owns that campaign.',
    CAMPAIGN_NOT_INITIALIZED:
      'The campaign you explicitly selected is the one loaded here, its stored address matches the selection, and its stored campaign admin matches the configured approved Team wallet — identity is confirmed. Which lifecycle step that campaign may take is decided separately, from its current lifecycle state, and is shown above.',
  },
  walletTitle: 'Approved Team wallet',
  walletNote:
    'This surface holds no wallet of its own: it reads no connection state, offers no connect or disconnect control and can prompt no wallet by itself. Connect the approved Team wallet on the accepted-input or metadata surface above. Whether the wallet approving a transaction is the approved Team wallet is decided by the action itself, against live devnet state, immediately before anything is signed — and a wallet that is not it is refused there.',
  walletCarrierUnavailable:
    'No approved Team wallet is configured for this deployment, so these actions are disabled. The approved identity is a deployment configuration value; it is never taken from the connected wallet, a URL, browser storage, or anything typed on this page.',
  approvedKeyLabel: 'Approved address (shortened)',
  emergencyTitle: 'Who may pause, in the program and in this product',
  emergencyProgramNote:
    'In the program, pause_campaign accepts either the campaign admin or the protocol emergency pause authority. Emergency pause is not a separate instruction — it is the same instruction invoked by that other role. Unpause and finalize accept the campaign admin only.',
  emergencyProductNote:
    'This browser product exposes pause to the approved Team wallet acting as the campaign’s campaign admin, and to nothing else. The protocol emergency pause authority is out of browser product scope: it cannot be selected here, cannot be connected here, cannot be operated here, and is never used as a fallback when a campaign-admin check refuses. If the approved Team wallet were itself one of the protocol’s custody keys, the action would refuse it outright rather than proceed under any other role — and this page is never told which key that was.',
  deadlineTitle: 'What a deadline and a cap do not do',
  deadlineNote:
    'A campaign’s end timestamp and its output cap are conditions the program applies to holder conversions. Neither one causes a lifecycle step by itself: reaching a deadline leaves the campaign in whichever lifecycle state it was already in, and so does reaching a cap. A campaign whose window has closed may still read as active, or as paused, and which step is offered follows that lifecycle state alone. Nothing on this page reads a clock.',
  holderRaceTitle: 'Holder conversions running at the same time',
  holderRaceNote:
    'Pausing and finalizing take effect according to the order the chain actually executes transactions in, which is not the order controls are clicked in. A holder conversion that executes before the lifecycle transaction may succeed; one that executes after it is subject to the program’s own status, deadline and cap checks at that moment and may be refused there. A conversion that has already executed stays executed — no lifecycle step reaches back into it, reverses it, or cancels it.',
  pauseTitle: 'Pause the campaign',
  pauseRules: [
    'The campaign must currently be active. A campaign that is initialized, already paused or finalized cannot be paused.',
    'This browser product performs the pause as the campaign admin, using the approved Team wallet. The protocol emergency pause authority is out of product scope here and is not offered as an alternative.',
    'Pausing is not terminal. A later explicit campaign-admin unpause may return the campaign to active.',
    'Pausing is never automatic. No deadline triggers it, no cap triggers it, and nothing on this page schedules or repeats it.',
    'Pausing may happen more than once over a campaign’s life. Each pause is a separate occurrence admitted by the campaign’s state at that moment.',
  ],
  pauseActionLabel: 'Pause campaign',
  pauseActionBusyLabel: 'Pausing…',
  pauseActionHelp:
    'One click, one wallet approval in the approved Team wallet, one devnet transaction, for exactly the campaign shown above. The campaign is re-read immediately before the request is built, and the step is withheld unless it still reads as active. There is exactly one Team/Admin attempt slot, so another Team/Admin action running in this tab will refuse this one before it starts.',
  pauseActionBlockedHelp:
    'Pause campaign stays disabled until the approved Team wallet is configured for this deployment, the campaign you explicitly selected is the one loaded here, that campaign reads as active, and the single saved attempt slot is free.',
  unpauseTitle: 'Unpause the campaign',
  unpauseRules: [
    'The campaign must currently be paused. A campaign that is initialized, already active or finalized cannot be unpaused.',
    'Unpause accepts the campaign admin only. The protocol emergency pause authority cannot unpause a campaign in the program, and no role other than the campaign admin is offered here.',
    'Unpausing returns the campaign from paused to active, and that is the whole of its effect.',
    'It does not extend or reopen the campaign’s end timestamp, does not reset or raise the campaign cap, does not reset or raise any per-input cap, and does not bypass any check the program applies to a holder conversion. A campaign whose window has already closed stays closed to conversions after it is unpaused.',
    'Unpausing may happen more than once over a campaign’s life. Each unpause is a separate occurrence admitted by the campaign’s state at that moment.',
  ],
  unpauseActionLabel: 'Unpause campaign',
  unpauseActionBusyLabel: 'Unpausing…',
  unpauseActionHelp:
    'One click, one wallet approval in the approved Team wallet, one devnet transaction, for exactly the campaign shown above. The campaign is re-read immediately before the request is built, and the step is withheld unless it still reads as paused. There is exactly one Team/Admin attempt slot, so another Team/Admin action running in this tab will refuse this one before it starts.',
  unpauseActionBlockedHelp:
    'Unpause campaign stays disabled until the approved Team wallet is configured for this deployment, the campaign you explicitly selected is the one loaded here, that campaign reads as paused, and the single saved attempt slot is free.',
  finalizeTitle: 'Finalize the campaign',
  finalizeRules: [
    'The campaign may be either active or paused. A campaign that is initialized, or already finalized, cannot be finalized.',
    'Finalize accepts the campaign admin only. The protocol emergency pause authority cannot finalize a campaign in the program, and no role other than the campaign admin is offered here.',
    'Finalizing is terminal and irreversible. A finalized campaign does not return to active and does not return to paused, and no later step here undoes it.',
    'Finalizing is never automatic. No deadline triggers it, no cap triggers it, and nothing on this page schedules or repeats it.',
    'It requires an explicit review first. Reviewing freezes the exact campaign, admin, lifecycle state, approved wallet and program identity you were shown; if any of those changes, the approval is discarded and you review again.',
  ],
  reviewActionLabel: 'Review finalization',
  reviewActionHelp:
    'A local check only. It freezes the exact situation shown above — the selection, the campaign’s stored address, its campaign admin, its current lifecycle state, the approved Team wallet and the program identity — for your approval. It opens no wallet, signs nothing, sends nothing, reaches no network, reads no clock and records nothing, and it is the only way to reach the final control.',
  reviewActionBlockedHelp:
    'Review finalization stays disabled until the campaign you explicitly selected has been read freshly on this page, that reading shows it as active or paused, its stored admin matches the configured approved Team wallet, and there is no unfinished attempt. A campaign shown from the earlier page load is not enough on its own — use Check lifecycle status first.',
  finalizeAcknowledgementRequiredNote:
    'Nothing has been reviewed, or what was reviewed is no longer current. Review the situation again before the final control is offered — a terminal step is never taken from a situation nobody approved.',
  previewTitle: 'Exactly what would be finalized',
  previewIntro:
    'This is the campaign the request carries — the same one that was reviewed. If anything above changes, this approval is discarded and you review again.',
  previewCampaignLabel: 'Campaign address (shortened)',
  previewPredecessorLabel: 'Lifecycle state reviewed',
  previewPredecessorHint:
    'finalizing from active and finalizing from paused are different attempts, so this exact state is part of what you approved',
  terminalWarningTitle: 'This cannot be undone',
  terminalWarning:
    'Finalizing is terminal. After it succeeds this campaign does not return to active and does not return to paused, no lifecycle step remains for it, and nothing here reverses it. Read the situation above before you approve.',
  finalizeActionLabel: 'Finalize campaign',
  finalizeActionBusyLabel: 'Finalizing…',
  finalizeActionHelp:
    'One click, one wallet approval in the approved Team wallet, one devnet transaction, for exactly the campaign previewed above. The campaign is re-read immediately before the request is built and compared against what you approved; anything that moved discards the approval instead of proceeding. There is no automatic retry, no second send and no way back.',
  finalizeActionBlockedHelp:
    'Finalize campaign stays disabled until the approved Team wallet is configured for this deployment, the campaign you explicitly selected has been read freshly and reads as active or paused, the situation above has been reviewed and is still current, and the single saved attempt slot is free.',
  operationLabel: {
    ADD_TOKEN_CONFIG: 'Add accepted input',
    SETUP_METADATA: 'Set output token metadata',
    ACTIVATE_CAMPAIGN: 'Activate campaign',
    PAUSE_CAMPAIGN: 'Pause campaign',
    UNPAUSE_CAMPAIGN: 'Unpause campaign',
    FINALIZE_CAMPAIGN: 'Finalize campaign',
  },
  statusActionLabel: 'Check lifecycle status',
  statusActionBusyLabel: 'Checking…',
  statusActionHelp:
    'Reads what is already known about the single saved attempt and re-reads it afterwards, then re-reads this campaign. It signs nothing, opens no wallet, sends nothing and starts no new attempt — so it is safe after a reload or a disconnect, and it needs no connected wallet. There is one attempt slot rather than one per step, so this is the only status control here, and what it reports is whatever the slot actually holds. Nothing on this page polls: this runs once, when you click it.',
  statusEmpty: 'No saved attempt exists for the approved Team wallet right now.',
  statusUnread:
    'The saved attempt slot has not been read in this tab yet. These steps are treated as blocked until it is.',
  statusRecordOperationLabel: 'Saved attempt is for',
  statusRecordOperationHint:
    'the operation the saved record actually names — there is one attempt slot for every Team/Admin operation',
  statusRecordCampaignLabel: 'Saved attempt campaign (shortened)',
  statusRecordCampaignHint: 'the campaign the saved record actually names',
  statusRecordForeignCampaignNote:
    'The saved attempt in the single slot is for a different campaign than the one selected here. It is shown as it is rather than relabelled, and it still occupies the one slot until it is resolved.',
  anotherMutationRunning:
    'Another Team/Admin mutation was already running in this tab, so this one did not start. Nothing was built, nothing was signed and nothing was sent by it. Wait for the running action to finish; this is not a failure, this campaign was not changed, and there is nothing to undo.',
  recoveryTitle: 'Recovered saved attempt',
  recoveryIntro:
    'What you review here is held in this tab only and is discarded on reload. A saved attempt is not: it is recorded durably, so it is shown here after a reload from that record plus a fresh reading of devnet. This is a report rather than a control — it offers no submission.',
  recoveryOperationLabel: 'Recovered attempt is for',
  resultTitle: 'What the last action reported',
  nonClaimsTitle: 'What these steps do not mean',
  nonClaims: [
    'source implementation is not live execution — a visible control is never evidence that any particular attempt reached devnet',
    'no lifecycle wallet approval is proven, no lifecycle broadcast is proven, and no lifecycle transaction is proven to have landed by this surface existing',
    'not a mainnet, production or public-product step, and not an audit or readiness claim of any kind',
    'pause, unpause and finalize run on devnet only, and each only when you click it and approve it in the approved Team wallet — it is not an investor-ready or production-ready claim',
    'changing a campaign’s lifecycle state does not list it in the public directory, and it is not REDAX review, verification or endorsement',
    'a campaign that reads as paused, active or finalized is not evidence that this product put it there',
    'a transaction that landed and failed proves no effect and no cause — no program error is named for it',
    'not a claim about any wallet other than the one that approved it',
  ],
  footnote:
    'Devnet-only lifecycle steps for one selected campaign. A visible control is not evidence that a transaction was submitted or landed, and it does not imply campaign completion, holder conversion or any readiness claim.',
}

// --- Team/Admin devnet SOL preflight — ONE canonical copy source ------------------
//
// FIVE TEAM/ADMIN PANELS, ONE SET OF STRINGS. The Campaign Create, token-config setup,
// metadata, activation and lifecycle panels each read a devnet SOL availability state and
// each state it to an operator, and they all say it from HERE. Five divergent wordings
// would be five slightly different promises about the same observation, and the first time
// one drifted an operator would be told something the others do not mean.
//
// THESE ARE STATUS SENTENCES ABOUT WHAT WAS OBSERVED — never a guarantee. None of them
// promises that a later action will succeed: the program and the runtime remain the
// authority on whether a transaction can pay for itself, and the action root re-reads the
// balance itself on the attempt's own connection immediately before the attempt continues.
// A sufficient reading is permission to OFFER an action, and nothing more.
//
// THEY ARE VALUE-FREE, and the type of the underlying result gives them nowhere to put a
// value even if a later edit wanted to. No lamport or SOL amount, no balance, no threshold,
// no rent figure, no fee bound, no `607`, no `1308`, no `5440`, no byte length, no context
// slot, no RPC URL, no provider name, no wallet address, no Campaign address and no raw
// error appears in any of them.
//
// They also make no readiness claim of any kind: not devnet, mainnet, production, audit or
// public-product readiness, and not a claim that any wallet is compatible.

export const TEAM_ADMIN_SOL_PREFLIGHT_READING =
  'Checking whether the connected Team wallet can cover this devnet action…'

export const TEAM_ADMIN_SOL_PREFLIGHT_INSUFFICIENT =
  'The connected Team wallet is known to have insufficient devnet SOL for this action, so it is not offered. Add devnet SOL to that wallet, then check again.'

export const TEAM_ADMIN_SOL_PREFLIGHT_UNAVAILABLE =
  'SOL availability could not be established, so this action remains unavailable until it can be.'

// The explicit human re-check. It is READ ONLY: it builds nothing, signs nothing, sends
// nothing, writes no durable record and authorizes nothing, and it is NOT a transaction
// action — it never counts toward any Team/Admin transaction-control census. There is no
// timer, no polling, no subscription and no automatic retry behind it.
export const TEAM_ADMIN_SOL_PREFLIGHT_RECHECK_LABEL = 'Re-check SOL availability'

// The refusal an operator sees when a COMPLETE, VALID reading proved the balance too low.
//
// It is deliberately distinct from the unreadable case above: an operator who cannot tell
// "known to be short" from "could not be read" has been told nothing useful. Both are
// value-free, and both state exactly how far the attempt got — which, for this refusal, is
// nowhere at all.
export const TEAM_ADMIN_SOL_PREFLIGHT_SUBMIT_REFUSED =
  'The connected Team wallet was read and is known to have insufficient devnet SOL for this action, so it was refused before anything was built. No transaction was assembled, no wallet approval was requested, nothing was signed and nothing was sent.'
