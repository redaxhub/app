
import type { ReactNode } from 'react'
import type {
  RedaxCampaignView,
  RedaxConnectedWalletHolderContextView,
  RedaxDirectoryRowView,
  RedaxEnvironmentView,
  RedaxHolderEligibilityView,
  RedaxHolderInputPositionView,
  RedaxHolderView,
  RedaxProjectView,
  RedaxTokenConfigView,
  RedaxWalletAtaStatus,
} from '../data/redaxViewModels'
import { isDevnetProgramMode } from '../data/redaxModePredicates'
import { MetricRow } from '../components/MetricRow'
import { ProofBoundaryNote } from '../components/ProofBoundaryNote'
import { StatusPill } from '../components/StatusPill'
import { SurfaceCard } from '../components/SurfaceCard'
import {
  BURN_WARNING_BODY,
  BURN_WARNING_TITLE,
  HOLDER_INPUT_SELECTOR_BOUNDARY,
  HOLDER_INPUT_SELECTOR_CAMPAIGN_UNRESOLVED,
  HOLDER_INPUT_SELECTOR_DECIMALS_HINT,
  HOLDER_INPUT_SELECTOR_DEFAULT_FOCUS_NOTE,
  HOLDER_INPUT_SELECTOR_DEFAULT_FOCUS_PILL,
  HOLDER_INPUT_SELECTOR_EYEBROW,
  HOLDER_INPUT_SELECTOR_GROUP_LABEL,
  HOLDER_INPUT_SELECTOR_INTRO,
  HOLDER_INPUT_SELECTOR_NONE,
  HOLDER_INPUT_SELECTOR_ONE_INPUT_NOTE,
  HOLDER_INPUT_SELECTOR_RATE_HINT,
  HOLDER_INPUT_SELECTOR_SELECTED_PILL,
  HOLDER_INPUT_SELECTOR_SINGLE_CHOICE_NOTE,
  HOLDER_INPUT_SELECTOR_TITLE,
  HOLDER_INPUT_SELECTOR_UNSELECTED,
  REJECTED_BEFORE_BURN_NOTE,
  WALLET_HOLDER_CONTEXT_BOUNDARY_NOTE,
} from '../lib/productCopy'
import {
  CampaignCard,
  capPercentLabel,
  formatCountdown,
  outputTokenDisplay,
  outputTokenHint,
  outputTokenSymbol,
  statusMeta,
} from './HomeScreen'

const PROTOCOL_FEE_LABEL = '100 bps (1%)'

// Integer-safe display formatting: render a raw base-unit decimal string at the
// given token decimals with thousands separators. BigInt math only.
function formatTokenAmount(raw: string, decimals: number): string {
  let value: bigint
  try {
    value = BigInt(raw)
  } catch {
    return raw
  }
  const negative = value < 0n
  if (negative) {
    value = -value
  }
  const base = 10n ** BigInt(decimals)
  const whole = (value / base).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  let fraction = ''
  if (decimals > 0) {
    const trimmed = (value % base).toString().padStart(decimals, '0').replace(/0+$/, '')
    if (trimmed.length > 0) {
      fraction = `.${trimmed}`
    }
  }
  return `${negative ? '-' : ''}${whole}${fraction}`
}

// Read-only connected-wallet ATA status → display text / tone. Records keep the
// mapping exhaustive over RedaxWalletAtaStatus at compile time. No value here
// implies eligibility, a quote, or any transaction path.
const LEGACY_ATA_PILL_LABEL: Record<RedaxWalletAtaStatus, string> = {
  exists: 'Account exists',
  missing: 'No account',
  mismatch: 'Unexpected account',
  unavailable: 'Unreadable',
}
const LEGACY_BALANCE_STATUS_TEXT: Record<RedaxWalletAtaStatus, string> = {
  exists: '—',
  missing: 'No legacy token account yet',
  mismatch: 'Unexpected token account owner or mint',
  unavailable: 'Balance could not be read',
}
const OUTPUT_ATA_VALUE_TEXT: Record<RedaxWalletAtaStatus, string> = {
  exists: 'Output token account exists',
  missing: 'Not prepared yet — preparation is a later transaction gate',
  mismatch: 'Unexpected token account owner or mint',
  unavailable: 'Output token account status could not be read',
}
const ATA_PILL_TONE: Record<RedaxWalletAtaStatus, 'positive' | 'neutral' | 'caution'> = {
  exists: 'positive',
  missing: 'neutral',
  mismatch: 'caution',
  unavailable: 'caution',
}

export interface HolderTrialScreenProps {
  environment: RedaxEnvironmentView | null
  holderProfiles: readonly RedaxHolderView[]
  selectedHolder: RedaxHolderView | null
  selectedHolderId: string
  directoryRows: readonly RedaxDirectoryRowView[]
  selectedCampaign: RedaxCampaignView | null
  selectedProject: RedaxProjectView | null
  selectedCampaignId: string
  eligibility: RedaxHolderEligibilityView | null
  /**
   * The campaign's accepted-input TokenConfigs as loaded, in load order.
   *
   * The selection card renders from THIS and never from `eligibility.inputPositions`: an
   * eligibility projection is absent in every read-only devnet mode and in
   * DEVNET_TX_ENABLED, which is precisely where a holder needs to choose an input. It is
   * display and choice material only — which input a conversion may use is App's explicit
   * selection, not this list's order or its `isPrimary` flag.
   */
  tokenConfigs: readonly RedaxTokenConfigView[]
  /**
   * What the detail rows below describe. It follows the explicit selection whenever there
   * is one, so the rate, the decimals and the focused row cannot describe one accepted
   * input while a conversion is armed with another. With nothing selected it is App's
   * DEFAULT DISPLAY focus — a value nobody chose, which reaches no action.
   */
  displayFocusedTokenConfig: RedaxTokenConfigView | null
  /**
   * The accepted input the holder EXPLICITLY selected for conversion, or `null` when they
   * have not selected one. `null` is the normal starting state and stays `null` until a
   * click — a campaign with a single accepted input is no exception.
   */
  selectedForConversionTokenConfigId: string | null
  /**
   * Whether the campaign context is exact enough for an accepted input to be chosen for it
   * — the raw selection, the effective id the load resolved and the loaded campaign's own
   * id all agreeing. Only App can know this: the screen is handed the EFFECTIVE id, so it
   * cannot see that a `campaigns[0]` fallback was substituted for a selection that was not
   * a loaded campaign. It is a display fact here and never the guard itself; App refuses
   * such a gesture regardless of what this screen renders.
   */
  campaignSelectionIsExact: boolean
  /**
   * The holder's selection gesture. The screen calls it from an explicit click on one
   * option and from nowhere else: not on mount, not on render, not on a campaign or holder
   * change, and never from an effect. It performs no read and no transaction.
   */
  onSelectTokenConfig: (tokenConfigId: string) => void
  walletHolderContext?: RedaxConnectedWalletHolderContextView | null
  /**
   * Opaque, App-supplied Holder prepare-output-ATA slot, passed only in
   * DEVNET_TX_ENABLED. The screen renders it but never consumes the wallet facade
   * itself; all wallet/action logic lives inside the slot component.
   */
  prepareOutputAtaSlot?: ReactNode
  /**
   * Opaque, App-supplied Holder convert slot (preview + convert action), passed only
   * in DEVNET_TX_ENABLED. The preview signs nothing; the convert action is a separate
   * explicit step inside the slot, gated on an acknowledgement and wallet approval. The
   * screen renders the slot but never consumes the wallet facade or invokes any action
   * itself. (Prop name retained for the App wiring.)
   */
  convertPreviewSlot?: ReactNode
  isLoading: boolean
  loadError: string | null
  onSelectHolder: (holderId: string) => void
  onSelectCampaign: (campaignId: string) => void
}

export function HolderTrialScreen({
  environment,
  holderProfiles,
  selectedHolder,
  selectedHolderId,
  directoryRows,
  selectedCampaign,
  selectedProject,
  selectedCampaignId,
  eligibility,
  tokenConfigs,
  displayFocusedTokenConfig,
  selectedForConversionTokenConfigId,
  campaignSelectionIsExact,
  onSelectTokenConfig,
  walletHolderContext,
  prepareOutputAtaSlot,
  convertPreviewSlot,
  isLoading,
  loadError,
  onSelectHolder,
  onSelectCampaign,
}: HolderTrialScreenProps) {
  const pickerRows = [...directoryRows].sort((a, b) => {
    const aRank = a.holderEligible ? 0 : 1
    const bRank = b.holderEligible ? 0 : 1
    return aRank !== bRank ? aRank - bRank : a.sortPriority - b.sortPriority
  })

  const selectedRow = selectedCampaign
    ? directoryRows.find((row) => row.campaignId === selectedCampaign.id) ?? null
    : null
  // Decimals / labels / rate come from the selected token config (the campaign's
  // primary accepted input by default), with campaign-level fallbacks.
  const legacyDecimals = displayFocusedTokenConfig?.legacyDecimals ?? 0
  const outputDecimals = displayFocusedTokenConfig?.outputDecimals ?? 0
  const oldLabel =
    displayFocusedTokenConfig?.legacyMintLabel ?? selectedCampaign?.primaryLegacyMintLabel ?? '—'
  const outputLabel =
    displayFocusedTokenConfig?.outputMintLabel ?? selectedCampaign?.outputMintLabel ?? '—'
  // Output token identity decoded from on-chain Metaplex metadata (when the
  // data source provides it); the symbol becomes the display unit for output
  // amounts, falling back to the address-derived short label.
  const outputIdentity =
    displayFocusedTokenConfig?.outputTokenIdentity ?? selectedCampaign?.outputTokenIdentity
  const outputUnit = outputTokenSymbol(outputIdentity, outputLabel)

  const mode = environment?.mode ?? null
  const isDevnetProgram = isDevnetProgramMode(mode)
  const isMockLocal = mode === 'MOCK_LOCAL'
  const isDevnetWalletReadonly = mode === 'DEVNET_WALLET_READONLY'
  const isDevnetTxEnabled = mode === 'DEVNET_TX_ENABLED'

  const quote = eligibility?.eligible ? eligibility.quote : undefined
  const showRemainder = quote !== undefined && quote.normalizationRemainderRaw !== '0'

  // Read-only multi-input positions for this holder + migration, and NOT the selector.
  // The accepted-input choice is the single-choice card above, sourced from the loaded
  // TokenConfig set; this block stays what it has always been — a MOCK_LOCAL-only
  // explanatory view of per-position balance, eligibility and outcome, absent wherever
  // eligibility is. Each accepted legacy mint is its own input position; the focused
  // position (the display-focused token config, which follows the holder's explicit
  // choice once there is one, then the primary, then the first eligible, then the first)
  // is only highlighted — it still converts on its own, never combined. It owns no
  // selection: no data-source call, no second selector and no transaction.
  const inputPositions = eligibility?.inputPositions ?? []
  const focusedPosition: RedaxHolderInputPositionView | null =
    inputPositions.find((position) => position.tokenConfigId === displayFocusedTokenConfig?.id) ??
    inputPositions.find((position) => position.isPrimary) ??
    inputPositions.find((position) => position.eligible) ??
    inputPositions[0] ??
    null

  return (
    <>
      <header className="screen-header">
        <p className="screen-header__eyebrow">Holder surface</p>
        <h2 className="screen-header__title">Conversion decision surface</h2>
        <p className="screen-header__lede">
          Weigh a conversion with the full outcome visible up front: which token burns, which
          token arrives, gross output, the disclosed protocol fee, your net output, and the reasons
          not to convert.{' '}
          {isDevnetTxEnabled ? (
            <>
              Every figure below is read from the devnet program over RPC (read-only). Preparing
              your output token account and converting are two separate, wallet-approved holder
              actions below: converting appears only after a valid preview and requires an explicit
              acknowledgement and your wallet approval. Both are devnet-only and separately gated,
              and nothing is signed until you approve it. This is not a readiness or production claim.
            </>
          ) : isDevnetProgram ? (
            <>
              Every figure below is read from the devnet program over RPC (read-only) — no
              transaction actions.
            </>
          ) : isMockLocal ? (
            <>Every figure below comes from local sample data.</>
          ) : (
            <>Data source is loading.</>
          )}
        </p>
        <div className="screen-header__pills">
          <StatusPill tone="accent" label="Decision surface" />
          <StatusPill tone="neutral" label={environment?.dataSourceLabel ?? 'Loading data source…'} />
          <StatusPill
            tone="neutral"
            label={isDevnetTxEnabled ? 'Prepare · convert actions' : 'No transaction path'}
          />
        </div>
      </header>

      {loadError ? (
        <SurfaceCard eyebrow="Holder surface" title="Data load failed">
          <p className="note-line">{loadError}</p>
        </SurfaceCard>
      ) : isLoading ? (
        <SurfaceCard eyebrow="Holder surface" title="Loading holder data">
          <p className="note-line">Loading the holder decision surface from the configured data source…</p>
        </SurfaceCard>
      ) : (
        <>
          <SurfaceCard
            eyebrow="Holder"
            title="Choose a holder"
            footnote={environment?.boundaryLabel ?? 'Data source is loading.'}
          >
            <div className="chips">
              {holderProfiles.map((holder) => (
                <button
                  key={holder.id}
                  type="button"
                  className={holder.id === selectedHolderId ? 'chip chip--active' : 'chip'}
                  aria-pressed={holder.id === selectedHolderId}
                  onClick={() => onSelectHolder(holder.id)}
                >
                  {holder.label}
                </button>
              ))}
            </div>
            {holderProfiles.length === 0 ? (
              <p className="note-line">
                {isDevnetProgram
                  ? `No on-chain holder registry exists, so this surface lists no holder personas — holder balances, eligibility, and input positions are not read in ${mode}; a connected wallet's own read-only holder context is resolved separately.`
                  : 'No holder profiles are available in this data source.'}
              </p>
            ) : null}
            {selectedHolder ? (
              <div className="holder-meta">
                <span>{selectedHolder.walletLabel ?? 'Holder wallet'}</span>
                <span>Prefers: {selectedHolder.preferredSort ?? 'eligibility'}</span>
                <span className="holder-meta__addr">
                  {selectedHolder.walletAddress ?? 'No wallet address'}
                </span>
              </div>
            ) : null}
          </SurfaceCard>

          <SurfaceCard
            eyebrow="Directory"
            title="Pick a migration"
            footnote="Migrations this holder is eligible for sort first. Selecting a card updates the detail and outcome below."
          >
            <div className="campaign-grid">
              {pickerRows.map((row) => (
                <CampaignCard
                  key={row.campaignId}
                  row={row}
                  active={row.campaignId === selectedCampaignId}
                  showEligibility
                  onSelect={onSelectCampaign}
                />
              ))}
            </div>
          </SurfaceCard>

          {selectedCampaign ? (
            <SurfaceCard
              eyebrow="Selected migration"
              title={selectedCampaign.name}
              footnote={
                selectedCampaign.statusNote ??
                (isDevnetProgram
                  ? 'The title above is an address-derived campaign identifier (campaign account) — not a project or product name.'
                  : undefined)
              }
            >
              <div className="summary__head">
                <StatusPill
                  tone={statusMeta(selectedCampaign.displayStatus).tone}
                  label={statusMeta(selectedCampaign.displayStatus).label}
                />
                <span className="note-line">
                  {selectedProject?.tagline ??
                    'No on-chain project registry or profile is attached to this campaign.'}
                </span>
              </div>
              <MetricRow
                label="Legacy input mint"
                value={oldLabel}
                hint="legacy input mint identifier — burned on conversion"
              />
              <MetricRow
                label="Output token"
                value={outputTokenDisplay(outputIdentity, outputLabel)}
                hint={outputTokenHint(outputIdentity, outputLabel)}
              />
              {displayFocusedTokenConfig ? (
                <MetricRow
                  label="Conversion rate"
                  value={`${displayFocusedTokenConfig.rateNumeratorRaw} : ${displayFocusedTokenConfig.rateDenominatorRaw}`}
                  hint="output per accepted input, before decimal normalization"
                />
              ) : null}
              <MetricRow
                label="Campaign window"
                value={selectedRow ? formatCountdown(selectedRow.endsInSeconds) : '—'}
                hint="conversions are rejected after the window closes"
              />
              <MetricRow
                label="Cap utilization"
                value={selectedRow ? capPercentLabel(selectedRow.capUtilizationBps) : '—'}
                hint="output minted vs configured cap"
              />
              <MetricRow
                label="Proof completeness"
                value={
                  selectedRow
                    ? selectedRow.proofCaption ?? `${selectedRow.proofCompletenessPercent}%`
                    : '—'
                }
                hint="not a receipt/indexer proof metric in this build"
              />
              <MetricRow label="Protocol fee" value={PROTOCOL_FEE_LABEL} hint="disclosed up front, deducted from gross output" />
            </SurfaceCard>
          ) : (
            <SurfaceCard eyebrow="Selected migration" title="No migration selected">
              <p className="note-line">Pick a migration above to see its details and your outcome.</p>
            </SurfaceCard>
          )}

          {/* The accepted-input selection card — the one place a holder chooses what a
              conversion would burn, and it comes BEFORE the prepare and preview slots
              because choosing the input is the decision those two steps are about.

              It renders from `tokenConfigs` in EVERY mode, including when `eligibility` is
              null: eligibility is a MOCK_LOCAL-only projection, and DEVNET_TX_ENABLED — the
              one mode with a transaction-capable convert control beneath — never has it.
              Sourcing the card from eligibility would have hidden the selector exactly
              where it matters. Nothing here reads an account, connects a wallet or builds
              anything; the click calls `onSelectTokenConfig` and does nothing else. */}
          <SurfaceCard
            eyebrow={HOLDER_INPUT_SELECTOR_EYEBROW}
            title={HOLDER_INPUT_SELECTOR_TITLE}
            footnote={HOLDER_INPUT_SELECTOR_BOUNDARY}
          >
            <p className="note-line">{HOLDER_INPUT_SELECTOR_INTRO}</p>
            {campaignSelectionIsExact ? null : (
              <p className="note-line">{HOLDER_INPUT_SELECTOR_CAMPAIGN_UNRESOLVED}</p>
            )}
            {tokenConfigs.length === 0 ? (
              <p className="note-line">{HOLDER_INPUT_SELECTOR_NONE}</p>
            ) : (
              <>
                <p className="note-line">{HOLDER_INPUT_SELECTOR_SINGLE_CHOICE_NOTE}</p>
                {tokenConfigs.length === 1 ? (
                  <p className="note-line">{HOLDER_INPUT_SELECTOR_ONE_INPUT_NOTE}</p>
                ) : null}
                {/* One single-choice group. Each option is its own radio and the checked
                    one is the EXPLICIT selection — never the default focus, which is why
                    an unselected group has no checked option at all. */}
                <div
                  className="config-list"
                  role="radiogroup"
                  aria-label={HOLDER_INPUT_SELECTOR_GROUP_LABEL}
                >
                  {tokenConfigs.map((config) => {
                    const legacyLabel = config.legacyMintLabel ?? '—'
                    const isSelectedForConversion =
                      selectedForConversionTokenConfigId !== null &&
                      config.id === selectedForConversionTokenConfigId
                    // Shown only while nothing is selected. Once a holder has chosen, the
                    // display focus IS the choice and a second badge would be noise.
                    const isDefaultFocusOnly =
                      selectedForConversionTokenConfigId === null &&
                      displayFocusedTokenConfig !== null &&
                      config.id === displayFocusedTokenConfig.id
                    return (
                      <button
                        key={config.id}
                        type="button"
                        role="radio"
                        aria-checked={isSelectedForConversion}
                        // Disabled on an inexact campaign context so the control says what
                        // App would do anyway, rather than accepting a click it refuses.
                        disabled={!campaignSelectionIsExact}
                        // The one existing accepted-input card class, unchanged and with no
                        // selected variant: the checked state is carried by `aria-checked`
                        // and by a labelled pill, never by colour alone.
                        className="config-card"
                        onClick={() => onSelectTokenConfig(config.id)}
                      >
                        <span className="config-card__head">
                          <span className="config-card__title">
                            {legacyLabel} → {config.outputMintLabel}
                          </span>
                          <span className="config-card__pills">
                            {config.isPrimary ? (
                              <StatusPill tone="accent" label="Primary input" />
                            ) : null}
                            {isSelectedForConversion ? (
                              <StatusPill
                                tone="positive"
                                label={HOLDER_INPUT_SELECTOR_SELECTED_PILL}
                              />
                            ) : null}
                            {isDefaultFocusOnly ? (
                              <StatusPill
                                tone="info"
                                label={HOLDER_INPUT_SELECTOR_DEFAULT_FOCUS_PILL}
                              />
                            ) : null}
                          </span>
                        </span>
                        <span className="note-line">
                          Conversion rate {config.rateNumeratorRaw} : {config.rateDenominatorRaw} —{' '}
                          {HOLDER_INPUT_SELECTOR_RATE_HINT}
                        </span>
                        <span className="note-line">
                          Input decimals {config.legacyDecimals} —{' '}
                          {HOLDER_INPUT_SELECTOR_DECIMALS_HINT}
                        </span>
                      </button>
                    )
                  })}
                </div>
                {selectedForConversionTokenConfigId === null ? (
                  <>
                    <p className="note-line">{HOLDER_INPUT_SELECTOR_UNSELECTED}</p>
                    {displayFocusedTokenConfig ? (
                      <p className="note-line">{HOLDER_INPUT_SELECTOR_DEFAULT_FOCUS_NOTE}</p>
                    ) : null}
                  </>
                ) : null}
              </>
            )}
          </SurfaceCard>

          {/* DEVNET_TX_ENABLED only: App-supplied prepare-output-ATA slot. Opaque
              to this screen — the wallet facade and the single wallet-approved
              action live inside the slot component, never in this screen. */}
          {prepareOutputAtaSlot ?? null}

          {/* DEVNET_TX_ENABLED only: App-supplied convert slot (preview + convert action).
              Distinct from the prepare slot and opaque to this screen — the preview signs
              nothing, and the convert action lives inside the slot, never in this screen. */}
          {convertPreviewSlot ?? null}

          {isDevnetWalletReadonly && walletHolderContext ? (
            <SurfaceCard
              eyebrow="Connected wallet"
              title="Your holder context (read-only)"
              footnote={WALLET_HOLDER_CONTEXT_BOUNDARY_NOTE}
            >
              {walletHolderContext.status === 'unconnected' ? (
                <p className="note-line">
                  Connect a wallet to read your legacy balances and output token account status.
                  Balance and ATA reads only — this mode enables no transaction action, and
                  DEVNET_TX_ENABLED is a separate mode.
                </p>
              ) : walletHolderContext.status === 'unavailable' ? (
                <p className="note-line">
                  The connected wallet&rsquo;s holder context could not be read from the devnet
                  program/RPC right now. No transaction actions.
                </p>
              ) : (
                <>
                  <p className="note-line">
                    Read-only classic-SPL balances and output token account status for the connected
                    wallet. Nothing on this read-only context card builds or signs a transaction;
                    preparing an output token account and converting are separately gated holder
                    actions that this mode does not expose — they live in DEVNET_TX_ENABLED.
                  </p>
                  {walletHolderContext.outputAta ? (
                    <MetricRow
                      label="Output token account"
                      value={OUTPUT_ATA_VALUE_TEXT[walletHolderContext.outputAta.status]}
                      hint="campaign output mint — preparing it is a later, separately gated transaction step"
                    />
                  ) : null}
                  {walletHolderContext.legacyInputBalances.length > 0 ? (
                    <div className="config-list">
                      {walletHolderContext.legacyInputBalances.map((row) => {
                        const legacyLabel = row.legacyMintLabel ?? '—'
                        const balanceValue =
                          row.ataStatus === 'exists' && row.balanceRaw !== null
                            ? `${formatTokenAmount(row.balanceRaw, row.legacyDecimals)} ${legacyLabel}`
                            : LEGACY_BALANCE_STATUS_TEXT[row.ataStatus]
                        return (
                          <div className="config-card" key={row.tokenConfigId}>
                            <div className="config-card__head">
                              <span className="config-card__title">{legacyLabel}</span>
                              <span className="config-card__pills">
                                <StatusPill
                                  tone={ATA_PILL_TONE[row.ataStatus]}
                                  label={LEGACY_ATA_PILL_LABEL[row.ataStatus]}
                                />
                              </span>
                            </div>
                            <MetricRow
                              label="Legacy balance"
                              value={balanceValue}
                              hint="classic-SPL balance in the connected wallet's associated token account for this legacy mint"
                            />
                          </div>
                        )
                      })}
                    </div>
                  ) : (
                    <p className="note-line">
                      No accepted-input token configs were read for this migration, so there are no
                      legacy balances to show.
                    </p>
                  )}
                </>
              )}
            </SurfaceCard>
          ) : null}

          {selectedCampaign && eligibility ? (
            <SurfaceCard
              eyebrow="Outcome"
              title="Eligibility and outcome"
              footnote={environment?.boundaryLabel ?? 'Data source is loading.'}
            >
              <div className="eligibility-head">
                <StatusPill
                  tone={eligibility.eligible ? 'positive' : 'caution'}
                  label={eligibility.eligible ? 'Eligible' : 'Not eligible'}
                />
                <span className="note-line">
                  {eligibility.eligible
                    ? 'Every pre-burn check passes for this holder and migration.'
                    : 'One or more pre-burn checks block this conversion. Nothing is burned.'}
                </span>
              </div>

              {eligibility.eligible && quote ? (
                <>
                  <MetricRow
                    label="Conversion amount (full balance)"
                    value={`${formatTokenAmount(quote.amountInRaw, legacyDecimals)} ${oldLabel}`}
                    hint="your full eligible balance, burned on conversion"
                  />
                  <MetricRow
                    label="Gross output"
                    value={`${formatTokenAmount(quote.grossOutRaw, outputDecimals)} ${outputUnit}`}
                    hint="before the protocol fee"
                  />
                  <MetricRow
                    label={`Protocol fee (${PROTOCOL_FEE_LABEL})`}
                    value={`${formatTokenAmount(quote.feeOutRaw, outputDecimals)} ${outputUnit}`}
                    hint="deducted from gross output"
                  />
                  <MetricRow
                    label="Net output to you"
                    value={`${formatTokenAmount(quote.userOutRaw, outputDecimals)} ${outputUnit}`}
                    emphasis
                  />
                  {showRemainder ? (
                    <MetricRow
                      label="Normalization remainder"
                      value={`${formatTokenAmount(quote.normalizationRemainderRaw, legacyDecimals)} ${oldLabel}`}
                      hint="sub-precision input that does not map to output units"
                    />
                  ) : null}
                </>
              ) : (
                <div className="reasons">
                  {eligibility.rejectionReasons.map((reason) => (
                    <div className="reason" key={reason.code}>
                      <div className="reason__head">
                        <span className="reason__label">{reason.label}</span>
                        <StatusPill tone="caution" label="Checked before burn" />
                      </div>
                      <p className="reason__detail">{reason.detail}</p>
                      <span className="reason__code">
                        {reason.code}
                        {reason.programError ? ` · ${reason.programError}` : ''}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              <MetricRow
                label="Output token account"
                value={eligibility.outputAtaPrepared ? 'Prepared' : 'Not yet prepared'}
                hint="preparing the output token account is a later, separately gated step"
              />
            </SurfaceCard>
          ) : null}

          {selectedCampaign && eligibility ? (
            <SurfaceCard
              eyebrow="Input positions"
              title="Accepted-input positions"
              footnote={`${environment?.dataSourceLabel ?? 'Loading data source…'} — this list is read-only and runs no transaction.`}
            >
              <p className="note-line">
                Each accepted legacy mint is a separate input position with its own balance,
                eligibility, and outcome. Conversion happens one input position at a time — each
                position is a separate conversion, never combined.
              </p>

              {inputPositions.length > 0 ? (
                <>
                  {focusedPosition ? (
                    <p className="note-line">
                      Focused input: <strong>{focusedPosition.legacyMintLabel ?? '—'}</strong> →{' '}
                      {focusedPosition.outputMintLabel}. The eligibility and outcome above preview
                      this one input position; only one position converts at a time.
                    </p>
                  ) : null}

                  <div className="config-list">
                    {inputPositions.map((position) => {
                      const legacyLabel = position.legacyMintLabel ?? '—'
                      const positionQuote = position.eligible ? position.quote : undefined
                      const isFocused =
                        focusedPosition !== null &&
                        position.tokenConfigId === focusedPosition.tokenConfigId
                      return (
                        <div className="config-card" key={position.tokenConfigId}>
                          <div className="config-card__head">
                            <span className="config-card__title">
                              {legacyLabel} → {position.outputMintLabel}
                            </span>
                            <span className="config-card__pills">
                              {position.isPrimary ? (
                                <StatusPill tone="accent" label="Primary input" />
                              ) : null}
                              {isFocused ? <StatusPill tone="info" label="Focused input" /> : null}
                              <StatusPill
                                tone={position.eligible ? 'positive' : 'caution'}
                                label={position.eligible ? 'Eligible' : 'Not eligible'}
                              />
                            </span>
                          </div>

                          <MetricRow
                            label="Holder balance"
                            value={`${formatTokenAmount(position.holderBalanceRaw, position.legacyDecimals)} ${legacyLabel}`}
                            hint="this input position's own balance, burned only on its own conversion"
                          />
                          <MetricRow
                            label="Output token account"
                            value={position.outputAtaPrepared ? 'Prepared' : 'Not yet prepared'}
                            hint="preparing the output token account is a later, separately gated step"
                          />

                          {position.eligible && positionQuote ? (
                            <>
                              <MetricRow
                                label="Gross output"
                                value={`${formatTokenAmount(positionQuote.grossOutRaw, position.outputDecimals)} ${position.outputMintLabel}`}
                                hint="before the protocol fee"
                              />
                              <MetricRow
                                label={`Protocol fee (${PROTOCOL_FEE_LABEL})`}
                                value={`${formatTokenAmount(positionQuote.feeOutRaw, position.outputDecimals)} ${position.outputMintLabel}`}
                                hint="deducted from gross output"
                              />
                              <MetricRow
                                label="Net output to you"
                                value={`${formatTokenAmount(positionQuote.userOutRaw, position.outputDecimals)} ${position.outputMintLabel}`}
                                emphasis
                              />
                            </>
                          ) : (
                            <div className="reasons">
                              {position.rejectionReasons.map((reason) => (
                                <div className="reason" key={reason.code}>
                                  <div className="reason__head">
                                    <span className="reason__label">{reason.label}</span>
                                    <StatusPill tone="caution" label="Checked before burn" />
                                  </div>
                                  <p className="reason__detail">{reason.detail}</p>
                                  <span className="reason__code">
                                    {reason.code}
                                    {reason.programError ? ` · ${reason.programError}` : ''}
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </>
              ) : (
                <p className="note-line">
                  This holder has no accepted-input positions for this migration in this data
                  source.
                </p>
              )}
            </SurfaceCard>
          ) : null}
        </>
      )}

      <SurfaceCard tone="warning" eyebrow="Warning" title={BURN_WARNING_TITLE}>
        <p>{BURN_WARNING_BODY}</p>
        <p>{REJECTED_BEFORE_BURN_NOTE}</p>
      </SurfaceCard>

      {isDevnetTxEnabled ? (
        <SurfaceCard
          eyebrow="Action boundary"
          title="Prepare and convert are separate holder actions"
          footnote="Each is a single devnet-only, wallet-approved step. A live devnet transaction runs only when you explicitly approve it in your wallet."
        >
          <p>
            Preparing your output token account and converting are two separate holder actions on
            this surface, each wallet-approved and devnet-only. Converting appears only after a valid
            preview and requires an explicit, consequence-specific acknowledgement that it burns your
            input tokens, plus your wallet approval; it is treated as done only after a post-confirm
            re-read of your balances. Both actions are separately gated, and no admin or team action
            is here. This is not a readiness, product, or mainnet claim.
          </p>
        </SurfaceCard>
      ) : (
        <SurfaceCard
          eyebrow="Action boundary"
          title="No conversion control in this mode"
          footnote="The signing flow — approval, pending, receipt or specific rejection — is implemented in DEVNET_TX_ENABLED, a separate and separately gated mode. It is not exposed here."
        >
          <p>
            This surface renders no transaction control, so nothing can imply execution. Choosing
            an accepted input above is a local product choice on this page — it starts nothing —
            and this surface builds no transaction and includes no wallet control
            {isDevnetProgram ? `; ${mode} performs read-only program/RPC reads only` : ''}.
          </p>
        </SurfaceCard>
      )}

      <ProofBoundaryNote />
    </>
  )
}
