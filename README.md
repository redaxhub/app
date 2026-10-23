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
- **Access is not verification.** Being allowed to use the Team workspace is an app permission. It
  is not an on-chain whitelist, not proof of token ownership and not a review of any campaign.

## Wallet actions

Every transaction action is explicit:

- each action needs its own click and its own wallet approval;
- nothing connects a wallet, signs or sends on page load, on a timer or on a selection change;
- there is no automatic retry or resend;
- the wallet context available to screens exposes connection state only — there is no generic
  signing or sending API, and no generic message-signing API.

Holder actions are preparing the wallet's output token account and converting one accepted input.

## Team workspace

In `DEVNET_TX_ENABLED` the app offers a Team workspace for customers the operator has given access:

1. **Sign in** with the Team wallet by approving one fixed Sign-In-With-Solana message. It is free and
   sends no transaction. Sign-in works only on the deployment's canonical origin.
2. **Create a campaign** from one form: the new token's name, symbol and logo, one to ten old tokens
   with their exchange rates and optional limits, an optional total limit and an optional end time.
   Drafts are saved privately as you type.
3. **Review once.** One screen shows every value; one checkbox confirms it.
4. **Start setup** publishes the final logo and token details as public, content-addressed files.
   No wallet opens for this step.
5. **Approve each chain step** in the wallet: create the campaign, add each old token, set the token
   details, open conversions — `N + 3` approvals for `N` old tokens. Nothing is batched.
6. **Manage** the campaign: share its holder link, pause, unpause and finalize.

One wallet can run several campaigns; each keeps its own draft, plan, public files and chain state.
Only one chain step is in flight per wallet at a time, from the browser that started it.

Customer access is managed by the operator in **Customer access**: give access by public address,
or stop new campaigns for an address. Stopping new campaigns keeps finishing a started setup,
managing existing campaigns and reading records available.

The workspace talks to one same-origin endpoint, `/api/v1`, implemented as a Vercel Function in
`api/v1.ts` with its modules in `server/`. It keeps private records (access, sessions, drafts) in a
**private** Vercel Blob store and publishes the token files to a **public** Vercel Blob store. The
browser holds no token: the session is an `HttpOnly`, `Secure`, `SameSite=Strict`, host-only cookie.

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
pnpm dev        # local development server (the Team workspace needs the /api/v1 service)
pnpm preview    # serve the production build locally
pnpm exec tsc -p tsconfig.server.json --noEmit   # type-check the server code
```

`pnpm-workspace.yaml` declines the native build scripts of `bufferutil`, `utf-8-validate`,
`bigint-buffer` and `sharp`; their JavaScript fallbacks or prebuilt binaries are used.

## Configuration

### Public build variables

The browser app is configured only through public `VITE_*` build variables. **Every `VITE_*` value
present in the build environment is compiled into the public JavaScript bundle.** Never put a
private key, seed, password, API key, store token, authenticated RPC URL or any other secret in one.
`.env` files are ignored by Git; no example environment file is shipped.

| Variable | Value |
|---|---|
| `VITE_REDAX_DATA_MODE` | `MOCK_LOCAL` (the default when unset), `DEVNET_READONLY`, `DEVNET_WALLET_READONLY` or `DEVNET_TX_ENABLED` |
| `VITE_SOLANA_CLUSTER` | `devnet` (required by the devnet modes) |
| `VITE_REDAX_PROGRAM_ID` | the public REDAX program id, base58 (required by the devnet modes) |
| `VITE_SOLANA_RPC_URL` | a public `https://` Solana Devnet RPC endpoint without credentials or secret query parameters (required by the devnet modes) |
| `VITE_REDAX_CAMPAIGN_ALLOWLIST` | whitespace-separated exact campaign addresses for the public directory; missing, empty or invalid lists none |

`VITE_REDAX_APPROVED_TEAM_WALLET` and `VITE_REDAX_METADATA_URI_ALLOWLIST` are no longer read by the
app: Team access is granted in the service, and each campaign's metadata location is the one its
own reviewed plan published.

Modes:

- `MOCK_LOCAL` renders local demonstration fixtures and reads no chain data.
- `DEVNET_READONLY` reads REDAX program accounts on Devnet; no wallet, no transactions.
- `DEVNET_WALLET_READONLY` adds a wallet connection context; no signing, no transactions.
- `DEVNET_TX_ENABLED` adds the explicit, wallet-approved Devnet actions and the Team workspace.

An invalid devnet configuration renders a configuration-error state; the app never falls back to
mock data.

### Server variables (the `/api/v1` function)

Server variables never start with `VITE_` and never reach the browser. A missing or invalid required
value makes the service answer "not configured"; there is no fallback that grants access.

| Variable | Value |
|---|---|
| `REDAX_CUSTOMER_PROGRAM_ID` | the public REDAX program id; must equal `VITE_REDAX_PROGRAM_ID` |
| `REDAX_CUSTOMER_OPERATOR_WALLETS` | whitespace-separated public addresses that may manage customer access |
| `REDAX_CUSTOMER_AUTH_SECRET` | **secret**, at least 32 characters, used to sign sign-in challenges |
| `REDAX_CUSTOMER_PRIVATE_STORE_ID` | the id of the private Vercel Blob store |
| `REDAX_CUSTOMER_PUBLIC_STORE_ID` | the id of the public Vercel Blob store |
| `REDAX_CUSTOMER_SIGN_IN_ORIGIN` | optional; the canonical origin sign-in works on |
| `REDAX_CUSTOMER_PUBLIC_BASE_URL` | optional; the public store's base URL when it cannot be derived from its id |
| `REDAX_CUSTOMER_PRIVATE_STORE_TOKEN`, `REDAX_CUSTOMER_PUBLIC_STORE_TOKEN` | optional **secrets**; when unset the stores are reached with the deployment's Vercel OIDC identity |
| `REDAX_CUSTOMER_DEVNET_RPC_URL` | optional; the Devnet RPC the service reads campaign accounts from |

The generic `BLOB_READ_WRITE_TOKEN` is refused, so a store connected under that name cannot be used
by accident.

## Links

- Website: <https://redaxhub.com>
- Documentation: <https://docs.redaxhub.com>
- Specification: <https://github.com/redaxhub/spec>
- Litepaper: <https://github.com/redaxhub/litepaper>

## License

License: not yet selected.
