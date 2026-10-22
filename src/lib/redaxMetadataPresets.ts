// REDAX ready-made output-token metadata identities — the accepted Devnet demo A and B.
//
// WHAT THESE ARE. The exact name, symbol and location of the two metadata documents the
// REDAX operator already published and accepted: fixed public strings, with the
// document's SHA-256 inside its own file name. They exist so a person can CHOOSE a whole,
// mutually consistent identity instead of retyping three strings that must agree.
//
// WHAT THEY ARE NOT. A preset is not an upload, not hosting, not a chain record and not a
// review. It is offered ONLY when the deployment's own metadata-URI allowlist contains its
// exact location, it only fills a draft, and the permanent metadata step still requires its
// own frozen review and its own explicit approval. Nothing here fetches the document: the
// bytes behind a location are checked by the operator's published-asset verification, not
// by this table, and the table makes no claim about them beyond the hash in the file name.

export interface RedaxMetadataPreset {
  /** A short stable key, for the control only. */
  readonly key: 'DEMO_A' | 'DEMO_B'
  readonly label: string
  readonly name: string
  readonly symbol: string
  readonly uri: string
  /** The SHA-256 of the JSON document, exactly as it appears in the location's file name. */
  readonly documentSha256: string
}

/**
 * A planned metadata identity a campaign-create review carried forward, offered to the
 * metadata step as a PREFILL only. It is not a chain record and not a metadata review: the
 * permanent step still freezes its own review and asks for its own approval.
 */
export interface RedaxPlannedMetadata {
  readonly name: string
  readonly symbol: string
  readonly uri: string
}

export const REDAX_METADATA_PRESETS: readonly RedaxMetadataPreset[] = Object.freeze([
  Object.freeze({
    key: 'DEMO_A' as const,
    label: 'REDAX Devnet Demo A',
    name: 'REDAX Devnet Demo A',
    symbol: 'RDXDEMOA',
    uri: 'https://metadata.redaxhub.com/metadata/v1/redax-devnet-demo-a.e87221e00865c57a5de5586147564af8a8246179494b53e2f9b4616d7ae3e190.json',
    documentSha256: 'e87221e00865c57a5de5586147564af8a8246179494b53e2f9b4616d7ae3e190',
  }),
  Object.freeze({
    key: 'DEMO_B' as const,
    label: 'REDAX Devnet Demo B',
    name: 'REDAX Devnet Demo B',
    symbol: 'RDXDEMOB',
    uri: 'https://metadata.redaxhub.com/metadata/v1/redax-devnet-demo-b.dd2b0412af400905e52f993b084bcdde22d3e0bad7d187c2f3140da866307f3e.json',
    documentSha256: 'dd2b0412af400905e52f993b084bcdde22d3e0bad7d187c2f3140da866307f3e',
  }),
])

/** The presets this deployment actually approved: exact allowlist membership, nothing looser. */
export function redaxAvailableMetadataPresets(
  allowlist: readonly string[],
): readonly RedaxMetadataPreset[] {
  return REDAX_METADATA_PRESETS.filter((preset) => allowlist.includes(preset.uri))
}

/** The preset whose three values a draft matches EXACTLY, or `null`. */
export function redaxMatchingMetadataPreset(draft: {
  readonly name: string
  readonly symbol: string
  readonly uri: string
}): RedaxMetadataPreset | null {
  return (
    REDAX_METADATA_PRESETS.find(
      (preset) =>
        preset.name === draft.name && preset.symbol === draft.symbol && preset.uri === draft.uri,
    ) ?? null
  )
}
