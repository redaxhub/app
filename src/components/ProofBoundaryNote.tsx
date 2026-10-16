// The standing proof/non-proof boundary disclosure (PRD §12). Rendered near
// decision and observer surfaces so proof is never read as a legitimacy,
// safety, liquidity, or price signal.

import { PROOF_BOUNDARY_BODY, PROOF_BOUNDARY_TITLE } from '../lib/productCopy'

export function ProofBoundaryNote() {
  return (
    <aside className="proof-note">
      <span className="proof-note__title">{PROOF_BOUNDARY_TITLE}</span>
      <p className="proof-note__body">{PROOF_BOUNDARY_BODY}</p>
    </aside>
  )
}
