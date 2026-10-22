// One public address (or one transaction signature), shown IN FULL, copyable, and linked
// to the devnet explorer.
//
// PUBLIC DATA ONLY. Campaign accounts, output mints and transaction signatures are public
// chain facts; showing them in full is what lets a Team hand a Campaign to its holders and
// lets anyone check it independently. Wallet addresses may still be shown short elsewhere.
// This component has no wallet, no data source, no network and no storage of its own: copy
// is the platform clipboard, and the link is a plain anchor to the public explorer.
//
// COPY CAN FAIL, AND THEN THE TEXT IS STILL THERE. The full value is always rendered as
// selectable text, so a browser without clipboard permission loses nothing — the person
// selects and copies it by hand, and the component says so.

import { useState } from 'react'

import { buildRedaxExplorerUrl, copyRedaxPublicText } from '../lib/redaxPublicLinks'

export interface RedaxPublicAddressProps {
  readonly label: string
  readonly value: string
  /** `address` for an account, `tx` for a transaction signature, `link` for a share URL. */
  readonly kind: 'address' | 'tx' | 'link'
  /** The cluster the explorer link targets; anything but `devnet` renders no link. */
  readonly explorerCluster: string | null
  readonly hint?: string
}

type CopyState = 'idle' | 'copied' | 'failed'

export function RedaxPublicAddress({
  label,
  value,
  kind,
  explorerCluster,
  hint,
}: RedaxPublicAddressProps) {
  // Scoped to the exact value it was produced for, so a "Copied" from one address is never
  // shown beside a different one after the prop changes.
  const [copy, setCopy] = useState<{ readonly value: string; readonly state: CopyState }>({
    value,
    state: 'idle',
  })
  const copyState: CopyState = copy.value === value ? copy.state : 'idle'
  const explorerUrl = kind === 'link' ? null : buildRedaxExplorerUrl(kind, value, explorerCluster)

  async function handleCopy(): Promise<void> {
    const copiedValue = value
    const ok = await copyRedaxPublicText(copiedValue)
    setCopy({ value: copiedValue, state: ok ? 'copied' : 'failed' })
  }

  return (
    <div className="public-address">
      <div className="public-address__label">
        <span>{label}</span>
        {hint ? <span className="metric__hint">{hint}</span> : null}
      </div>
      <code className="public-address__value">{value}</code>
      <div className="public-address__actions">
        <button
          className="wallet-badge__btn"
          onClick={() => {
            void handleCopy()
          }}
          type="button"
        >
          {copyState === 'copied'
            ? 'Copied'
            : kind === 'tx'
              ? 'Copy signature'
              : kind === 'link'
                ? 'Copy link'
                : 'Copy address'}
        </button>
        {explorerUrl !== null ? (
          <a className="public-address__link" href={explorerUrl} rel="noopener noreferrer" target="_blank">
            {kind === 'tx' ? 'View transaction on Solana Explorer (devnet)' : 'View on Solana Explorer (devnet)'}
          </a>
        ) : null}
      </div>
      {copyState === 'failed' ? (
        <p className="wizard-preview__fieldwarning">
          Copying is not available in this browser. Select the full text above and copy it by hand.
        </p>
      ) : null}
    </div>
  )
}
