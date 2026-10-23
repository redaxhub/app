// REDAX customer service — logo decoding and normalization (server side, sharp/libvips).
//
// A TRUSTED DECODER, BOUNDED BEFORE IT RUNS. The upload is identified by its own leading bytes
// — PNG, JPEG or WebP, nothing else — and never by a file name, an extension or a browser-sent
// content type. Only then is it handed to libvips (through `sharp`), with a pixel ceiling that
// refuses decompression bombs before allocation, `failOn: 'error'` so a damaged file is a
// refusal rather than a partial picture, and animation refused (one frame only). SVG, HTML,
// GIF, TIFF, AVIF, HEIC and everything else libvips could open is never offered to it: the
// signature check runs first, and the decoder's own format answer must agree with it.
//
// ONE OUTPUT SHAPE. Every accepted logo becomes a square PNG of at most 512 × 512, re-encoded
// from decoded pixels, so no metadata chunk, no EXIF block, no ICC profile and no trailing
// payload of the upload survives into a public file. A non-square or larger image is
// centre-cropped and/or scaled; the result is returned with `transformed: true`, shown to the
// customer, and must be explicitly accepted before it can be reviewed — it is never silently
// substituted.

import sharp from 'sharp'
import { createHash } from 'node:crypto'
import {
  REDAX_CUSTOMER_LOGO_MAX_EDGE,
  REDAX_CUSTOMER_LOGO_MAX_INPUT_BYTES,
  REDAX_CUSTOMER_LOGO_MAX_INPUT_PIXELS,
  REDAX_CUSTOMER_LOGO_MAX_OUTPUT_BYTES,
  REDAX_CUSTOMER_LOGO_MIN_EDGE,
} from '../src/customer/shared/customerContract.js'

export type RedaxCustomerImageFormat = 'png' | 'jpeg' | 'webp'

export type RedaxCustomerImageResult =
  | {
      readonly ok: true
      readonly png: Uint8Array
      readonly sha256: string
      readonly width: number
      readonly height: number
      readonly sourceFormat: RedaxCustomerImageFormat
      readonly sourceWidth: number
      readonly sourceHeight: number
      readonly sourceByteLength: number
      readonly transformed: boolean
    }
  | { readonly ok: false; readonly code: 'PAYLOAD_TOO_LARGE' | 'UNSUPPORTED_IMAGE' }

export type RedaxCustomerImageNormalizer = (input: Uint8Array) => Promise<RedaxCustomerImageResult>

/** Identify the container from its signature bytes. Anything else is `null`. */
export function sniffRedaxCustomerImageFormat(bytes: Uint8Array): RedaxCustomerImageFormat | null {
  const at = (index: number): number => (index < bytes.byteLength ? bytes[index] : -1)
  if (
    at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47 &&
    at(4) === 0x0d && at(5) === 0x0a && at(6) === 0x1a && at(7) === 0x0a
  ) {
    return 'png'
  }
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) {
    return 'jpeg'
  }
  if (
    at(0) === 0x52 && at(1) === 0x49 && at(2) === 0x46 && at(3) === 0x46 &&
    at(8) === 0x57 && at(9) === 0x45 && at(10) === 0x42 && at(11) === 0x50
  ) {
    return 'webp'
  }
  return null
}

/** The production normalizer. */
export const normalizeRedaxCustomerLogo: RedaxCustomerImageNormalizer = async (input) => {
  if (input.byteLength > REDAX_CUSTOMER_LOGO_MAX_INPUT_BYTES) {
    return { ok: false, code: 'PAYLOAD_TOO_LARGE' }
  }
  const format = sniffRedaxCustomerImageFormat(input)
  if (format === null) {
    return { ok: false, code: 'UNSUPPORTED_IMAGE' }
  }
  const buffer = Buffer.from(input.buffer, input.byteOffset, input.byteLength)
  const options = {
    limitInputPixels: REDAX_CUSTOMER_LOGO_MAX_INPUT_PIXELS,
    failOn: 'error' as const,
    animated: false,
    pages: 1,
  }
  let width: number
  let height: number
  try {
    const metadata = await sharp(buffer, options).metadata()
    if (metadata.format !== format) {
      return { ok: false, code: 'UNSUPPORTED_IMAGE' }
    }
    if ((metadata.pages ?? 1) > 1) {
      // An animated PNG/WebP: refused, rather than published as its first frame.
      return { ok: false, code: 'UNSUPPORTED_IMAGE' }
    }
    width = metadata.autoOrient?.width ?? metadata.width ?? 0
    height = metadata.autoOrient?.height ?? metadata.height ?? 0
  } catch {
    return { ok: false, code: 'UNSUPPORTED_IMAGE' }
  }
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < REDAX_CUSTOMER_LOGO_MIN_EDGE ||
    height < REDAX_CUSTOMER_LOGO_MIN_EDGE ||
    width * height > REDAX_CUSTOMER_LOGO_MAX_INPUT_PIXELS
  ) {
    return { ok: false, code: 'UNSUPPORTED_IMAGE' }
  }
  const edge = Math.min(width, height, REDAX_CUSTOMER_LOGO_MAX_EDGE)
  let png: Buffer
  try {
    png = await sharp(buffer, options)
      .rotate()
      .resize(edge, edge, { fit: 'cover', position: 'centre' })
      .png({ compressionLevel: 9, adaptiveFiltering: true, palette: false })
      .toBuffer()
  } catch {
    return { ok: false, code: 'UNSUPPORTED_IMAGE' }
  }
  if (png.byteLength > REDAX_CUSTOMER_LOGO_MAX_OUTPUT_BYTES) {
    return { ok: false, code: 'UNSUPPORTED_IMAGE' }
  }
  // Decode the result once more: what is published must itself be a clean, single-frame PNG
  // of exactly the stated size.
  try {
    const check = await sharp(png, options).metadata()
    if (check.format !== 'png' || check.width !== edge || check.height !== edge) {
      return { ok: false, code: 'UNSUPPORTED_IMAGE' }
    }
  } catch {
    return { ok: false, code: 'UNSUPPORTED_IMAGE' }
  }
  const bytes = new Uint8Array(png.buffer, png.byteOffset, png.byteLength)
  return {
    ok: true,
    png: bytes,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    width: edge,
    height: edge,
    sourceFormat: format,
    sourceWidth: width,
    sourceHeight: height,
    sourceByteLength: input.byteLength,
    // Any crop or scale is a visible change; a pure re-encode of an already-square, small
    // enough logo is not, though the bytes always differ from the upload.
    transformed: width !== edge || height !== edge,
  }
}
