// REDAX customer service — connect a wallet and sign in. Nothing private renders here.

import { useRedaxWallet } from '../wallet/RedaxWalletProvider'
import { copyRedaxPublicText } from '../lib/redaxPublicLinks'
import { useRedaxCustomerSession } from './CustomerSessionProvider'
import { shortRedaxAddress } from './customerFormat'

export function CustomerSignInPanel() {
  const session = useRedaxCustomerSession()
  const wallet = useRedaxWallet()
  const state = session.state

  if (state.status === 'idle' || state.status === 'loading') {
    return (
      <section className="customer-card">
        <p className="customer-muted">Loading your workspace…</p>
      </section>
    )
  }
  if (state.status === 'unavailable') {
    return (
      <section className="customer-card">
        <h3 className="customer-title">Team workspace unavailable</h3>
        <p>{state.message}</p>
        <p className="customer-muted">Holder conversions are not affected.</p>
        <div className="customer-actions">
          <button className="customer-btn" onClick={() => void session.refresh()} type="button">
            Try again
          </button>
        </div>
      </section>
    )
  }
  const config = state.config
  if (!config.signInHere) {
    return (
      <section className="customer-card">
        <h3 className="customer-title">Sign in on the REDAX app</h3>
        <p>Team sign-in works only on the main REDAX address.</p>
        <p>
          <a className="customer-link" href={`${config.signInOrigin}/`}>
            Open {config.signInOrigin.replace('https://', '')}
          </a>
        </p>
        <p className="customer-muted">Holder links keep working on this address.</p>
      </section>
    )
  }

  const connected = wallet.status === 'connected' && wallet.publicKeyBase58 !== null
  const signedInAs = state.status === 'signed-in' ? state.me.wallet : null
  const mismatch = signedInAs !== null && connected && signedInAs !== wallet.publicKeyBase58

  return (
    <section className="customer-card customer-signin">
      <p className="customer-eyebrow">Team workspace · Solana Devnet</p>
      <h3 className="customer-title">{connected ? 'Sign in to your workspace' : 'Connect your Team wallet'}</h3>
      {state.status === 'no-access' && connected && state.wallet === wallet.publicKeyBase58 ? (
        <div className="customer-notice customer-notice--caution">
          <p>
            <strong>This wallet does not have access yet.</strong> Send this address to REDAX so they can approve
            it. Then sign in again.
          </p>
          <code className="customer-code">{state.wallet}</code>
          <div className="customer-actions">
            <button className="customer-btn" onClick={() => void copyRedaxPublicText(state.wallet)} type="button">
              Copy address
            </button>
          </div>
        </div>
      ) : null}
      {mismatch ? (
        <p className="customer-notice customer-notice--caution">
          You are signed in as {shortRedaxAddress(signedInAs ?? '')}, but {wallet.shortPublicKey} is connected. Sign in with
          the connected wallet to continue.
        </p>
      ) : null}
      {state.status === 'signed-out' && state.notice !== null ? (
        <p className="customer-notice customer-notice--caution">{state.notice}</p>
      ) : null}

      {!connected ? (
        wallet.walletsDetected ? (
          <div className="customer-actions">
            {wallet.wallets.map((option) => (
              <button
                className="customer-btn customer-btn--primary"
                disabled={!option.connectable || wallet.status === 'connecting'}
                key={option.name}
                onClick={() => void wallet.connect(option.name)}
                type="button"
              >
                {wallet.status === 'connecting' ? 'Connecting…' : `Connect ${option.name}`}
              </button>
            ))}
          </div>
        ) : (
          <p>No Solana wallet was found in this browser. Install Phantom, then reload this page.</p>
        )
      ) : (
        <>
          <p>
            Connected: <strong>{wallet.shortPublicKey}</strong>. Signing in asks your wallet for a free message signature.
            It does not send a transaction or move funds.
          </p>
          <div className="customer-actions">
            <button
              className="customer-btn customer-btn--primary"
              disabled={session.signingIn || !session.canSignIn}
              onClick={() => void session.signIn()}
              type="button"
            >
              {session.signingIn ? 'Waiting for your wallet…' : 'Sign in'}
            </button>
            <button className="customer-btn" onClick={() => void wallet.disconnect()} type="button">
              Disconnect
            </button>
          </div>
          {!session.canSignIn ? (
            <p className="customer-muted">This wallet does not support Sign In With Solana. Use Phantom.</p>
          ) : null}
        </>
      )}
      {wallet.errorMessage !== null ? <p className="customer-muted">{wallet.errorMessage}</p> : null}
    </section>
  )
}
