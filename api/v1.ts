// REDAX customer service — the ONE Vercel Function entry (`/api/v1?op=<name>`).
//
// Vercel builds every file in the project's root `api/` directory as a Node.js Function; this
// is the only one, so the whole customer service is one Function on the Hobby plan. It wires
// the production adapters and nothing else:
//
//   * private + public Vercel Blob stores, each named by its own server-only store id and
//     authenticated by Vercel's OIDC token (or, only if the owner configured one, by that
//     store's own read-write token);
//   * the bounded Devnet `getAccountInfo` reader;
//   * the sharp/libvips logo normalizer.
//
// There is no fallback store. If the server configuration is incomplete, every operation but
// the public `config` answers `NOT_CONFIGURED`, and the local in-memory adapter cannot be
// reached from this file at all.

import { del, get, put } from '@vercel/blob'
import { createRedaxCustomerApi } from '../server/customerApi.js'
import { createRedaxCustomerChainReader } from '../server/customerChain.js'
import { resolveRedaxCustomerServerConfig } from '../server/customerConfig.js'
import { normalizeRedaxCustomerLogo } from '../server/customerImage.js'
import {
  createRedaxCustomerBlobPrivateStore,
  createRedaxCustomerBlobPublicStore,
  type RedaxCustomerBlobSdk,
} from '../server/customerStoreVercelBlob.js'

// The SDK retries a failed request up to ten times by default, and every retry of an upload is
// a billed operation. Two is enough to ride out a transient error; the handler's own read-back
// decides whether a write that "failed" actually landed.
if (process.env.VERCEL_BLOB_RETRIES === undefined) {
  process.env.VERCEL_BLOB_RETRIES = '2'
}

const config = resolveRedaxCustomerServerConfig(process.env, { onVercel: process.env.VERCEL === '1' })
if (!config.configured) {
  // Names of the missing pieces only — never a value.
  console.warn(`REDAX customer service not configured: ${config.problems.join('; ')}`)
}

const sdk = { put, get, del } as unknown as RedaxCustomerBlobSdk
const log = (event: string): void => console.info(`redax.customer ${event}`)

const handleRedaxCustomerRequest = createRedaxCustomerApi({
  config,
  privateStore: createRedaxCustomerBlobPrivateStore(sdk, { storeId: config.privateStoreId, token: config.privateStoreToken }, { diagnose: log }),
  publicStore: createRedaxCustomerBlobPublicStore(
    sdk,
    { storeId: config.publicStoreId, token: config.publicStoreToken },
    config.publicBaseUrl,
    fetch,
  ),
  readCampaign: createRedaxCustomerChainReader({ rpcUrl: config.rpcUrl, programId: config.programId, fetchImpl: fetch }),
  normalizeLogo: normalizeRedaxCustomerLogo,
  log,
})

export default {
  fetch(request: Request): Promise<Response> {
    return handleRedaxCustomerRequest(request)
  },
}
