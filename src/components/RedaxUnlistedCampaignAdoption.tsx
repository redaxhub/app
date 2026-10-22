// WHAT IT IS. One text input and one explicit button. A human types an exact campaign
// account address, clicks once, and — only if the exact value is a canonical Solana
// public key — this control hands that exact string to its caller. That is the whole of
// it: the caller decides what a selection means, and this component decides nothing.
//
// WHAT IT IS NOT, AND CANNOT BE. It takes no wallet, no data source, no environment, no
// allowlist, no Team identity and no raw adapter, so none of those can be reached from
// here — not by import, not by prop, not by a hook. It registers no effect, opens no
// storage, touches no URL or router, starts no network activity of any kind, and reads
// no environment. It is a controlled input and a click handler.
//
// TYPING IS NEVER ADOPTION. The draft lives in this component's own memory and the
// callback fires ONLY from the button's own click handler — never from `onChange`, never
// from an effect, never from a keystroke, and there is no `<form>`, so Enter submits
// nothing. Adoption is a deliberate gesture or it does not happen.
//
// THE REFUSAL IS VALUE-FREE. A rejected value never reaches the refusal copy: the
// message is a fixed string that names no address, no substring and no reason specific
// to what was typed. The input keeps showing what the human typed because that is what
// a controlled text input does and it is their own text — that is not an error-message
// echo, and the two are deliberately not the same thing.
//
// ONE SPELLING AUTHORITY. The address is judged by `isCanonicalRedaxPublicKey`, the same
// single canonical-public-key decision the approved-Team carrier and the curated
// Campaign allowlist are judged by. There is no second regex here and no second idea of
// what an address is. Spelling is not existence: a canonical address proves only that
// the text is well formed, never that a REDAX campaign is there.
//
// A SHARE LINK IS A PREFILL (demo customer flow, 2026-10-22). When the page was opened with
// `?campaign=<address>`, App hands the parsed value here and it becomes the INITIAL draft —
// nothing more. The earlier "touches no URL" reading is superseded on exactly that point:
// adoption still happens only from the button's own click, after the person has seen the
// address, and an invalid or duplicated link value is refused here with a fixed notice and
// is never pre-filled.

import { useState } from 'react'

import { isCanonicalRedaxPublicKey } from '../config/redaxEnv'
import { UNLISTED_CAMPAIGN_ADOPTION } from '../lib/productCopy'
import type { RedaxCampaignLinkQuery } from '../lib/redaxPublicLinks'
import { SurfaceCard } from './SurfaceCard'

export interface RedaxUnlistedCampaignAdoptionProps {
  /**
   * Receives the EXACT canonical address, once, per deliberate click. It is never
   * called with an invalid value, never called from an effect, and never called
   * automatically.
   */
  readonly onAdoptCampaign: (campaignId: string) => void
  /** The page's `?campaign=` value as App parsed it once at load. A prefill only. */
  readonly campaignLinkQuery?: RedaxCampaignLinkQuery
  /** The campaign currently open, if any — only to say whether the link's one is it. */
  readonly openCampaignId?: string | null
}

const ADOPTION_INPUT_ID = 'redax-unlisted-campaign-address'

export function RedaxUnlistedCampaignAdoption({
  onAdoptCampaign,
  campaignLinkQuery = { kind: 'NONE' },
  openCampaignId = null,
}: RedaxUnlistedCampaignAdoptionProps) {
  const [draft, setDraft] = useState<string>(() =>
    campaignLinkQuery.kind === 'VALID' ? campaignLinkQuery.campaign : '',
  )
  const [refused, setRefused] = useState<boolean>(false)

  // THE WHOLE EFFECT OF A CLICK. Outer whitespace the human typed is trimmed exactly
  // once, here, and the trimmed value is what is judged and what is handed on — so the
  // string this control adopts and the string it validated are the same string.
  function handleAdopt(): void {
    const exact = draft.trim()
    if (!isCanonicalRedaxPublicKey(exact)) {
      setRefused(true)
      return
    }
    setRefused(false)
    onAdoptCampaign(exact)
  }

  return (
    <SurfaceCard
      eyebrow={UNLISTED_CAMPAIGN_ADOPTION.eyebrow}
      title={UNLISTED_CAMPAIGN_ADOPTION.title}
      footnote={UNLISTED_CAMPAIGN_ADOPTION.boundary}
    >
      <p className="note-line">{UNLISTED_CAMPAIGN_ADOPTION.intro}</p>
      {campaignLinkQuery.kind === 'VALID' ? (
        campaignLinkQuery.campaign === openCampaignId ? (
          <p className="wizard-preview__fieldhint">This page’s link names the campaign that is open now.</p>
        ) : (
          <p className="wizard-preview__fieldhint">
            This page was opened with a campaign link. Its address is filled in below — check it, then press the button to read it from devnet. Opening it does not list it, and does not mean REDAX reviewed it.
          </p>
        )
      ) : campaignLinkQuery.kind === 'INVALID' ? (
        <p className="wizard-preview__fieldwarning">
          {campaignLinkQuery.reason === 'DUPLICATE'
            ? 'This page’s link named more than one campaign, so none was used. Nothing was opened.'
            : 'This page’s link did not contain a valid campaign address, so it was not used. Nothing was opened.'}
        </p>
      ) : null}
      <div className="wizard-preview__field">
        <label className="wizard-preview__fieldname" htmlFor={ADOPTION_INPUT_ID}>
          {UNLISTED_CAMPAIGN_ADOPTION.inputLabel}
        </label>
        <div className="wizard-preview__fieldbody">
          <input
            className="wizard-preview__input"
            id={ADOPTION_INPUT_ID}
            inputMode="text"
            onChange={(event) => {
              // Draft only. Nothing is adopted, validated-as-final, read or navigated
              // to by a keystroke; the stale refusal is cleared so a corrected value is
              // not still shown as rejected.
              //
              // The structural read is a COMPILER PORTABILITY boundary and nothing else:
              // this module is also compiled by the repository test runtime, whose `lib`
              // carries no DOM. It grants no validation authority and no adoption
              // authority — `isCanonicalRedaxPublicKey`, after the click-time trim,
              // stays the one and only judge of an address.
              setDraft((event.target as unknown as { readonly value: string }).value)
              setRefused(false)
            }}
            spellCheck={false}
            type="text"
            placeholder={UNLISTED_CAMPAIGN_ADOPTION.inputPlaceholder}
            value={draft}
          />
          <p className="wizard-preview__fieldnote">{UNLISTED_CAMPAIGN_ADOPTION.inputHelp}</p>
          {refused ? (
            <p className="wizard-preview__fieldwarning">
              {UNLISTED_CAMPAIGN_ADOPTION.invalidNote}
            </p>
          ) : null}
        </div>
      </div>
      <button className="wallet-badge__btn" onClick={handleAdopt} type="button">
        {UNLISTED_CAMPAIGN_ADOPTION.buttonLabel}
      </button>
    </SurfaceCard>
  )
}
