// REDAX customer service — the ONE bounded Devnet read the server performs.
//
// WHY THE SERVER READS THE CHAIN AT ALL. A campaign enters a customer's private index only
// after the server has itself confirmed, by an exact-address read, that the account exists, is
// owned by the REDAX program, is a Campaign, names the signed-in wallet as `campaign_admin`,
// and names the output mint that this setup's own Create request carried. A browser cannot
// attach somebody else's campaign, or an arbitrary address, to its workspace.
//
// WHAT IT IS NOT. It is not an RPC proxy: the endpoint is server configuration, the method is
// fixed (`getAccountInfo`), the address is one this service already recorded, and the result
// is decoded here and reduced to five public facts. No request parameter can choose the URL,
// the method or the commitment.

import bs58 from 'bs58'

/** Anchor discriminator of the REDAX `Campaign` account (from the program IDL). */
export const REDAX_CUSTOMER_CAMPAIGN_DISCRIMINATOR = Object.freeze([50, 40, 49, 11, 157, 220, 229, 192])

/** 8 discriminator + 4×32 keys + bool + status + u8 + u16 + 2×u128 + u8 + [u8;32] + Option<i64> + u128. */
const CAMPAIGN_MIN_BYTES = 8 + 32 * 4 + 1 + 1 + 1 + 2 + 16 + 16 + 1 + 32 + 1 + 16

export type RedaxCustomerChainCampaignStatus = 'initialized' | 'active' | 'paused' | 'finalized'

export interface RedaxCustomerChainCampaign {
  readonly address: string
  readonly campaignAdmin: string
  readonly outputMint: string
  readonly status: RedaxCustomerChainCampaignStatus
  readonly metadataSetup: boolean
  readonly tokenConfigCount: number
}

export type RedaxCustomerChainRead =
  | { readonly ok: true; readonly campaign: RedaxCustomerChainCampaign | null }
  | { readonly ok: false }

export type RedaxCustomerChainReader = (address: string) => Promise<RedaxCustomerChainRead>

const STATUS: readonly RedaxCustomerChainCampaignStatus[] = ['initialized', 'active', 'paused', 'finalized']

/** Decode the five facts this service needs from a Campaign account body. `null` if not one. */
export function decodeRedaxCustomerCampaignAccount(address: string, data: Uint8Array): RedaxCustomerChainCampaign | null {
  if (data.byteLength < CAMPAIGN_MIN_BYTES) {
    return null
  }
  for (let index = 0; index < 8; index += 1) {
    if (data[index] !== REDAX_CUSTOMER_CAMPAIGN_DISCRIMINATOR[index]) {
      return null
    }
  }
  const key = (offset: number): string => bs58.encode(data.subarray(offset, offset + 32))
  const metadataByte = data[8 + 128]
  const statusByte = data[8 + 128 + 1]
  if (metadataByte > 1 || statusByte >= STATUS.length) {
    return null
  }
  return {
    address,
    campaignAdmin: key(8),
    outputMint: key(8 + 64),
    status: STATUS[statusByte],
    metadataSetup: metadataByte === 1,
    tokenConfigCount: data[8 + 128 + 3] | (data[8 + 128 + 4] << 8),
  }
}

/** The production reader: one fixed JSON-RPC `getAccountInfo` at `finalized` commitment. */
export function createRedaxCustomerChainReader(input: {
  readonly rpcUrl: string
  readonly programId: string
  readonly fetchImpl: typeof fetch
  readonly timeoutMs?: number
}): RedaxCustomerChainReader {
  return async (address) => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), input.timeoutMs ?? 8000)
    try {
      const response = await input.fetchImpl(input.rpcUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'getAccountInfo',
          params: [address, { encoding: 'base64', commitment: 'finalized' }],
        }),
        redirect: 'error',
        signal: controller.signal,
      })
      if (!response.ok) {
        return { ok: false }
      }
      const body = (await response.json()) as {
        result?: { value?: { owner?: unknown; data?: unknown } | null }
        error?: unknown
      }
      if (body.error !== undefined || body.result === undefined) {
        return { ok: false }
      }
      const value = body.result.value
      if (value === null || value === undefined) {
        return { ok: true, campaign: null }
      }
      if (value.owner !== input.programId || !Array.isArray(value.data) || typeof value.data[0] !== 'string') {
        // Not an account of this program: for this service's purposes there is no campaign here.
        return { ok: true, campaign: null }
      }
      const data = new Uint8Array(Buffer.from(value.data[0], 'base64'))
      return { ok: true, campaign: decodeRedaxCustomerCampaignAccount(address, data) }
    } catch {
      return { ok: false }
    } finally {
      clearTimeout(timer)
    }
  }
}
