// REDAX customer service — the public token-metadata document, built and checked in one place.
//
// WHAT IS PUBLISHED. Two files per plan, both content-addressed and create-only:
//
//   m/v1/<sha256-of-png>.png   the exact final square PNG the customer accepted
//   m/v1/<sha256-of-json>.json the Metaplex-style document naming that PNG
//
// The document carries the image's location but NOT its own hash — a file cannot contain its
// own digest — and its bytes are canonical JSON, so the same plan always yields the same
// document, the same hash and therefore the same location. Publishing the same plan twice is
// idempotent; publishing a different file at an existing location is refused.
//
// WHAT IS CHECKED. `verifyRedaxCustomerMetadataDocument` is the exact-bytes test the server
// runs immediately before any wallet is asked to set metadata: the document must be byte for
// byte the one the plan committed to, and must name the committed image. A content-type,
// size or hash mismatch is a refusal, never a repair.
//
// SERVER-SAFE: explicit `.js` imports of import-free modules only.

import { redaxBytesEqual, redaxCanonicalJson, redaxSha256Hex, redaxUtf8Bytes } from './customerCanonical.js'
import { REDAX_CUSTOMER_METADATA_JSON_MAX_BYTES } from './customerContract.js'

export const REDAX_CUSTOMER_PUBLIC_PREFIX = 'm/v1/'

/** The public pathname for a content hash and extension. */
export function redaxCustomerPublicPath(sha256: string, extension: 'png' | 'json'): string {
  return `${REDAX_CUSTOMER_PUBLIC_PREFIX}${sha256}.${extension}`
}

export interface RedaxCustomerMetadataDocumentInput {
  readonly name: string
  readonly symbol: string
  readonly description: string
  readonly imageUri: string
}

/** The exact document object. Description is omitted when empty, never published blank. */
export function redaxCustomerMetadataDocumentObject(
  input: RedaxCustomerMetadataDocumentInput,
): Record<string, unknown> {
  const document: Record<string, unknown> = {
    name: input.name,
    symbol: input.symbol,
    image: input.imageUri,
    properties: {
      category: 'image',
      files: [{ type: 'image/png', uri: input.imageUri }],
    },
  }
  if (input.description !== '') {
    document.description = input.description
  }
  return document
}

/** The exact canonical bytes of the document. */
export function redaxCustomerMetadataDocumentBytes(input: RedaxCustomerMetadataDocumentInput): Uint8Array {
  return redaxUtf8Bytes(redaxCanonicalJson(redaxCustomerMetadataDocumentObject(input)))
}

export type RedaxCustomerPublishedCheck =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: 'JSON_MISMATCH' | 'IMAGE_MISMATCH' | 'TYPE_MISMATCH' | 'SIZE_MISMATCH' }

/**
 * Check fetched public bytes against the plan's commitments. Pure apart from hashing.
 *
 * `jsonBytes`/`imageBytes` are what was actually served; the expectations are the plan's.
 */
export async function verifyRedaxCustomerPublishedFiles(input: {
  readonly expected: RedaxCustomerMetadataDocumentInput & {
    readonly jsonSha256: string
    readonly jsonByteLength: number
    readonly imageSha256: string
    readonly imageByteLength: number
  }
  readonly jsonBytes: Uint8Array
  readonly jsonContentType: string
  readonly imageBytes: Uint8Array
  readonly imageContentType: string
}): Promise<RedaxCustomerPublishedCheck> {
  const { expected } = input
  if (!/^application\/json(;|$)/i.test(input.jsonContentType.trim())) {
    return { ok: false, reason: 'TYPE_MISMATCH' }
  }
  if (input.imageContentType.trim().toLowerCase() !== 'image/png') {
    return { ok: false, reason: 'TYPE_MISMATCH' }
  }
  if (
    input.jsonBytes.byteLength !== expected.jsonByteLength ||
    input.jsonBytes.byteLength > REDAX_CUSTOMER_METADATA_JSON_MAX_BYTES ||
    input.imageBytes.byteLength !== expected.imageByteLength
  ) {
    return { ok: false, reason: 'SIZE_MISMATCH' }
  }
  if ((await redaxSha256Hex(input.jsonBytes)) !== expected.jsonSha256) {
    return { ok: false, reason: 'JSON_MISMATCH' }
  }
  // The served document must ALSO be exactly the document this plan describes — the hash
  // alone proves only that it is the document the plan recorded, and this proves that the
  // recorded document names this plan's name, symbol and image.
  if (!redaxBytesEqual(input.jsonBytes, redaxCustomerMetadataDocumentBytes(expected))) {
    return { ok: false, reason: 'JSON_MISMATCH' }
  }
  if ((await redaxSha256Hex(input.imageBytes)) !== expected.imageSha256) {
    return { ok: false, reason: 'IMAGE_MISMATCH' }
  }
  return { ok: true }
}
