// REDAX customer service — show the server's own final logo bytes, privately.
//
// The preview is fetched through the session (`logo.preview`, no-store) and shown from a local
// object URL, so the image on screen is exactly the file that would be published — never the
// file the browser picked. The URL is revoked when the hash changes or the view unmounts, so
// no preview outlives the session view that loaded it.

import { useEffect, useState } from 'react'
import type { RedaxCustomerApiClient } from './customerApi'

export function useCustomerLogoPreview(api: RedaxCustomerApiClient, sha256: string | null): string | null {
  const [preview, setPreview] = useState<{ readonly sha: string; readonly url: string } | null>(null)
  useEffect(() => {
    if (sha256 === null) {
      setPreview(null)
      return
    }
    let cancelled = false
    let url: string | null = null
    void api.previewLogo(sha256).then((result) => {
      if (cancelled || !result.ok) {
        return
      }
      url = URL.createObjectURL(new Blob([new Uint8Array(result.bytes)], { type: 'image/png' }))
      setPreview({ sha: sha256, url })
    })
    return () => {
      cancelled = true
      if (url !== null) {
        URL.revokeObjectURL(url)
      }
    }
  }, [api, sha256])
  return preview !== null && preview.sha === sha256 ? preview.url : null
}
