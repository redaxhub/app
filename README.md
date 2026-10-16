# REDAX App

REDAX Phase 1 frontend for classic-SPL migration campaigns on Solana Devnet.

## Scope

- **Solana Devnet only.** The app accepts no other cluster.
- **Classic SPL tokens only.** Token-2022 is not supported.
- **Phase 1 single-project migration.** Each conversion uses one selected accepted-input token
  configuration, one legacy mint and one wallet transaction. There is no batch conversion.
- **Protocol fee.** Conversions carry a 1% protocol fee (100 basis points), rounded down, which
  accrues to the protocol fee vault.

## What this repository does not claim

- No mainnet, audit, production, investor or public-product readiness.
- No token launch and no fundraising.
- **Source is not live proof.** The presence of an action in this source code is not evidence that
  any transaction has been executed, and a visible control is not proof that it works with any
  particular wallet.

## Wallet actions

Every transaction action is explicit:

- each action needs its own click and its own wallet approval;
- nothing connects a wallet, signs or sends on page load, on a timer or on a selection change;
- there is no automatic retry or resend;
- the wallet context available to screens exposes connection state only — there is no generic
  signing or sending API.

Holder actions are preparing the wallet's output token account and converting one accepted input.
Team/Admin actions exist only when the deployment configures an approved Team wallet: creating a
campaign, adding an accepted input, setting the output token metadata once, activating, pausing,
unpausing and finalizing.

## Campaign listing

The public directory lists only the campaigns a deployment curates. **A listing is not a review, a
verification or an endorsement.** A campaign that is not listed is not rejected or unsafe; it can be
opened by its exact address, and the app then shows that it is unlisted and not reviewed.

## Requirements

- Node.js 24.x
- pnpm 11.0.9 (declared in `packageManager`; Corepack can provide it)

## Install, build and run

```sh
pnpm install --frozen-lockfile
pnpm build      # tsc -b && vite build, output in dist/
pnpm dev        # local development server
pnpm preview    # serve the production build locally
```

`pnpm-workspace.yaml` declines the native build scripts of `bufferutil`, `utf-8-validate` and
`bigint-buffer`; their JavaScript fallbacks are used.

## Configuration

The app is configured only through public `VITE_*` build variables. **Every `VITE_*` value present
in the build environment is compiled into the public JavaScript bundle.** Never put a private key,
seed, password, API key, authenticated RPC URL or any other secret in one. `.env` files are ignored
by Git; no example environment file is shipped.

| Variable | Value |
|---|---|
| `VITE_REDAX_DATA_MODE` | `MOCK_LOCAL` (the default when unset), `DEVNET_READONLY`, `DEVNET_WALLET_READONLY` or `DEVNET_TX_ENABLED` |
| `VITE_SOLANA_CLUSTER` | `devnet` (required by the devnet modes) |
| `VITE_REDAX_PROGRAM_ID` | the public REDAX program id, base58 (required by the devnet modes) |
| `VITE_SOLANA_RPC_URL` | a public `https://` Solana Devnet RPC endpoint without credentials or secret query parameters (required by the devnet modes) |
| `VITE_REDAX_APPROVED_TEAM_WALLET` | the public key of the approved Team wallet; missing or invalid disables the Team/Admin actions |
| `VITE_REDAX_METADATA_URI_ALLOWLIST` | whitespace-separated exact public `https://` metadata URIs allowed for the one-time metadata step; empty allows none |
| `VITE_REDAX_CAMPAIGN_ALLOWLIST` | whitespace-separated exact campaign addresses for the public directory; missing, empty or invalid lists none |

Modes:

- `MOCK_LOCAL` renders local demonstration fixtures and reads no chain data.
- `DEVNET_READONLY` reads REDAX program accounts on Devnet; no wallet, no transactions.
- `DEVNET_WALLET_READONLY` adds a wallet connection context; no signing, no transactions.
- `DEVNET_TX_ENABLED` adds the explicit, wallet-approved Devnet actions listed above.

An invalid devnet configuration renders a configuration-error state; the app never falls back to
mock data.

## Links

- Website: <https://redaxhub.com>
- Documentation: <https://docs.redaxhub.com>
- Specification: <https://github.com/redaxhub/spec>
- Litepaper: <https://github.com/redaxhub/litepaper>

## License

License: not yet selected.
