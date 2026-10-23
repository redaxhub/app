// REDAX customer service — reading form events without assuming a DOM type library.
//
// The customer components are also compiled by the repository's Node test configuration, which
// has no DOM lib; React's own types then describe form targets as empty interfaces. These
// helpers read exactly the one property each control needs, structurally, and nothing else.

interface RedaxCustomerFormEventLike {
  readonly target: unknown
}

/** The text value of an input, textarea or select. */
export function redaxCustomerInputValue(event: RedaxCustomerFormEventLike): string {
  const value = (event.target as { readonly value?: unknown }).value
  return typeof value === 'string' ? value : ''
}

/** The checked state of a checkbox or radio. */
export function redaxCustomerInputChecked(event: RedaxCustomerFormEventLike): boolean {
  return (event.target as { readonly checked?: unknown }).checked === true
}

/** The first file of a file input, as the two members the composer uses, or `null`. */
export function redaxCustomerInputFirstFile(
  event: RedaxCustomerFormEventLike,
): { readonly size: number; arrayBuffer(): Promise<ArrayBuffer> } | null {
  const files = (event.target as { readonly files?: { readonly length: number; readonly [index: number]: unknown } | null }).files
  if (files === undefined || files === null || files.length < 1) {
    return null
  }
  const file = files[0] as { readonly size?: unknown; readonly arrayBuffer?: unknown }
  return typeof file.size === 'number' && typeof file.arrayBuffer === 'function'
    ? (file as { readonly size: number; arrayBuffer(): Promise<ArrayBuffer> })
    : null
}

/** Clear a file input so choosing the same file again still fires a change. */
export function redaxCustomerClearInput(event: RedaxCustomerFormEventLike): void {
  try {
    ;(event.target as { value: string }).value = ''
  } catch {
    // A control that cannot be cleared simply keeps its value.
  }
}
