// REDAX customer service — the LOCAL / TEST storage adapter.
//
// SAME CONTRACT, IN MEMORY. It implements create-only, ETag compare-and-set and latest-only
// reads exactly as the Vercel Blob adapter does, so the one handler, the one validation and
// the one authorization path run unchanged against it. It exists for unit tests and for the
// local wallet-free render harness, and nothing in production can select it: the Vercel entry
// constructs the Blob adapter unconditionally, and the development flag that would make the
// handler accept this adapter is refused on Vercel (`resolveRedaxCustomerServerConfig`).
//
// It also counts operations the way Vercel bills them (simple = latest read, advanced =
// create / replace), so a test can show that a flow stays inside a stated budget, and it can
// inject provider failures — including the "write landed but the response was lost" case the
// Blob adapter has to tell apart from a real conflict.

import {
  RedaxCustomerStoreUnavailableError,
  assertRedaxCustomerStorePath,
  type RedaxCustomerCreateResult,
  type RedaxCustomerPrivateStore,
  type RedaxCustomerPublicStore,
  type RedaxCustomerReplaceResult,
  type RedaxCustomerStoredObject,
} from './customerStore.js'

interface MemoryEntry {
  etag: string
  bytes: Uint8Array
  contentType: string
}

export type RedaxCustomerMemoryFault = 'UNAVAILABLE' | 'LOST_RESPONSE'

export class RedaxCustomerMemoryBlobSpace {
  readonly entries = new Map<string, MemoryEntry>()
  readonly counts = { simple: 0, advanced: 0, remove: 0 }
  private sequence = 0
  private faults: { readonly op: 'read' | 'create' | 'replace' | 'remove' | 'any'; readonly fault: RedaxCustomerMemoryFault }[] = []

  /** Make the next matching operation fail (or land without a response). */
  injectFault(op: 'read' | 'create' | 'replace' | 'remove' | 'any', fault: RedaxCustomerMemoryFault): void {
    this.faults.push({ op, fault })
  }

  takeFault(op: 'read' | 'create' | 'replace' | 'remove'): RedaxCustomerMemoryFault | null {
    const index = this.faults.findIndex((entry) => entry.op === op || entry.op === 'any')
    if (index === -1) {
      return null
    }
    const [taken] = this.faults.splice(index, 1)
    return taken.fault
  }

  nextEtag(): string {
    this.sequence += 1
    return `"m${this.sequence.toString(16)}"`
  }
}

function copyBytes(bytes: Uint8Array): Uint8Array {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy
}

export function createRedaxCustomerMemoryPrivateStore(space: RedaxCustomerMemoryBlobSpace): RedaxCustomerPrivateStore {
  return {
    async read(path): Promise<RedaxCustomerStoredObject | null> {
      assertRedaxCustomerStorePath(path)
      space.counts.simple += 1
      if (space.takeFault('read') !== null) {
        throw new RedaxCustomerStoreUnavailableError()
      }
      const entry = space.entries.get(path)
      return entry === undefined ? null : { etag: entry.etag, bytes: copyBytes(entry.bytes), contentType: entry.contentType }
    },
    async create(path, bytes, contentType): Promise<RedaxCustomerCreateResult> {
      assertRedaxCustomerStorePath(path)
      space.counts.advanced += 1
      const fault = space.takeFault('create')
      if (fault === 'UNAVAILABLE') {
        throw new RedaxCustomerStoreUnavailableError()
      }
      if (space.entries.has(path)) {
        return { ok: false, code: 'EXISTS' }
      }
      const etag = space.nextEtag()
      space.entries.set(path, { etag, bytes: copyBytes(bytes), contentType })
      if (fault === 'LOST_RESPONSE') {
        throw new RedaxCustomerStoreUnavailableError('response lost after write')
      }
      return { ok: true, etag }
    },
    async replace(path, bytes, contentType, ifMatch): Promise<RedaxCustomerReplaceResult> {
      assertRedaxCustomerStorePath(path)
      space.counts.advanced += 1
      const fault = space.takeFault('replace')
      if (fault === 'UNAVAILABLE') {
        throw new RedaxCustomerStoreUnavailableError()
      }
      const current = space.entries.get(path)
      if (current === undefined || current.etag !== ifMatch) {
        return { ok: false, code: 'PRECONDITION_FAILED' }
      }
      const etag = space.nextEtag()
      space.entries.set(path, { etag, bytes: copyBytes(bytes), contentType })
      if (fault === 'LOST_RESPONSE') {
        throw new RedaxCustomerStoreUnavailableError('response lost after write')
      }
      return { ok: true, etag }
    },
    async remove(path, ifMatch): Promise<void> {
      assertRedaxCustomerStorePath(path)
      space.counts.remove += 1
      if (space.takeFault('remove') !== null) {
        throw new RedaxCustomerStoreUnavailableError()
      }
      const current = space.entries.get(path)
      if (current === undefined) {
        return
      }
      if (ifMatch !== undefined && current.etag !== ifMatch) {
        throw new RedaxCustomerStoreUnavailableError('precondition failed on remove')
      }
      space.entries.delete(path)
    },
  }
}

export function createRedaxCustomerMemoryPublicStore(
  space: RedaxCustomerMemoryBlobSpace,
  baseUrl: string,
): RedaxCustomerPublicStore {
  const read = async (path: string): Promise<RedaxCustomerStoredObject | null> => {
    assertRedaxCustomerStorePath(path)
    space.counts.simple += 1
    if (space.takeFault('read') !== null) {
      throw new RedaxCustomerStoreUnavailableError()
    }
    const entry = space.entries.get(path)
    return entry === undefined ? null : { etag: entry.etag, bytes: copyBytes(entry.bytes), contentType: entry.contentType }
  }
  return {
    read,
    fetchServed: read,
    async create(path, bytes, contentType) {
      assertRedaxCustomerStorePath(path)
      space.counts.advanced += 1
      const fault = space.takeFault('create')
      if (fault === 'UNAVAILABLE') {
        throw new RedaxCustomerStoreUnavailableError()
      }
      if (space.entries.has(path)) {
        return { ok: false, code: 'EXISTS' }
      }
      space.entries.set(path, { etag: space.nextEtag(), bytes: copyBytes(bytes), contentType })
      if (fault === 'LOST_RESPONSE') {
        throw new RedaxCustomerStoreUnavailableError('response lost after write')
      }
      return { ok: true, url: `${baseUrl}/${path}` }
    },
    publicUrl(path) {
      assertRedaxCustomerStorePath(path)
      return `${baseUrl}/${path}`
    },
  }
}
