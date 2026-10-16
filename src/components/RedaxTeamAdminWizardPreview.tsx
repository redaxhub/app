// Zero-prop and presentational. It holds exactly one piece of state: a draft
// record of the thirteen editable setup fields, living in component memory and
// nowhere else. Nothing is persisted — no browser storage is touched — and the
// draft dies with the component.
//
// Step 0 shows a fourteenth setup row that is not a field: the protocol fee
// vault, which the program derives rather than a team chooses. It renders from
// the step's derivedFields copy as static text — never an input, and never an
// inert look-alike of one, so there is no entry to type, no draft key to hold,
// and no address to show.
//
// The surface reads no data source, subscribes to no wallet, opens no RPC, and
// imports no instruction builder. There is no submit control and no action
// control of any kind in the subtree, and the inputs sit outside any enclosing
// element that could submit them, so pressing Enter in a field does nothing.
// The sentence this surface prints — that THIS PREVIEW invokes no builder,
// reaches no wallet bridge, opens no send/sign path and starts no transaction —
// is therefore structurally true of the component rather than merely asserted by
// its copy. It is deliberately a claim about this component and not about the
// build: a real Team/Admin campaign-create action exists in DEVNET_TX_ENABLED,
// owned by a different module, and none of the fields here feeds it.
//
// Validation is warning-only and computed during render by a pure helper. It
// blocks nothing, because nothing here submits; it exists so a team sees the
// same bounds the program would enforce.
//
// Because it touches no wallet and no action bridge, it needs no provider and
// therefore no App-level slot: the Token Team screen imports and renders it
// directly, the way it already renders ProofBoundaryNote. That screen renders it
// only where no real Team/Admin action slot is supplied, so the preview and the
// live Campaign Create panel never appear together and its thirteen fields can
// never be mistaken for that action's five. Binding the steps to a selected
// campaign's real state is a later, separately gated slice.

import { useId, useState } from 'react'

import {
  TEAM_ADMIN_WIZARD_NON_CLAIMS,
  TEAM_ADMIN_WIZARD_PREVIEW,
  TEAM_ADMIN_WIZARD_STEPS,
} from '../lib/productCopy'
import {
  EMPTY_TEAM_ADMIN_WIZARD_DRAFT,
  getTeamAdminWizardInputMode,
  validateTeamAdminWizardField,
  type TeamAdminWizardDraft,
  type TeamAdminWizardFieldId,
} from '../lib/teamAdminWizardDraft'
import { StatusPill } from './StatusPill'
import { SurfaceCard } from './SurfaceCard'

export function RedaxTeamAdminWizardPreview() {
  const fieldIdPrefix = useId()
  const [draft, setDraft] = useState<TeamAdminWizardDraft>(EMPTY_TEAM_ADMIN_WIZARD_DRAFT)

  const updateDraftField = (id: TeamAdminWizardFieldId, value: string): void => {
    setDraft((current) => ({ ...current, [id]: value }))
  }

  return (
    <SurfaceCard
      eyebrow={TEAM_ADMIN_WIZARD_PREVIEW.eyebrow}
      title={TEAM_ADMIN_WIZARD_PREVIEW.title}
      footnote={TEAM_ADMIN_WIZARD_PREVIEW.footnote}
    >
      <div className="wizard-preview">
        <div className="wizard-preview__header">
          <p className="wizard-preview__intro">{TEAM_ADMIN_WIZARD_PREVIEW.intro}</p>
          <p className="wizard-preview__boundary">{TEAM_ADMIN_WIZARD_PREVIEW.boundary}</p>
          <p className="wizard-preview__draftnotice">{TEAM_ADMIN_WIZARD_PREVIEW.draftNotice}</p>
        </div>

        <ol className="wizard-preview__steps">
          {TEAM_ADMIN_WIZARD_STEPS.map((step) => (
            <li className="wizard-preview__step" key={step.index}>
              <div className="wizard-preview__stephead">
                <span className="wizard-preview__stepindex">{step.index}</span>
                <span className="wizard-preview__steptitle">{step.title}</span>
                <StatusPill tone="neutral" label={TEAM_ADMIN_WIZARD_PREVIEW.stepStateBadge} />
              </div>

              <p className="wizard-preview__purpose">{step.purpose}</p>

              {step.fields.length > 0 ? (
                <>
                  <p className="wizard-preview__subtitle">
                    {TEAM_ADMIN_WIZARD_PREVIEW.fieldsTitle}
                  </p>
                  <div className="wizard-preview__fields">
                    {step.fields.map((field) => {
                      const inputId = `${fieldIdPrefix}-${field.id}`
                      const noteId = `${inputId}-note`
                      const validationId = `${inputId}-validation`
                      const validation = validateTeamAdminWizardField(field.id, draft[field.id])

                      return (
                        <div className="wizard-preview__field" key={field.id}>
                          <label className="wizard-preview__fieldname" htmlFor={inputId}>
                            {field.name}
                          </label>

                          <div className="wizard-preview__fieldbody">
                            <input
                              className="wizard-preview__input"
                              id={inputId}
                              type="text"
                              inputMode={getTeamAdminWizardInputMode(field.id)}
                              autoComplete="off"
                              spellCheck={false}
                              value={draft[field.id]}
                              aria-describedby={
                                validation ? `${noteId} ${validationId}` : noteId
                              }
                              onChange={(event) =>
                                updateDraftField(field.id, event.currentTarget.value)
                              }
                            />

                            <p className="wizard-preview__fieldnote" id={noteId}>
                              {field.note}
                            </p>

                            {validation ? (
                              <p
                                className={
                                  validation.tone === 'warning'
                                    ? 'wizard-preview__fieldwarning'
                                    : 'wizard-preview__fieldhint'
                                }
                                id={validationId}
                              >
                                {validation.message}
                              </p>
                            ) : null}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </>
              ) : null}

              {step.derivedFields && step.derivedFields.length > 0 ? (
                <>
                  <p className="wizard-preview__subtitle">
                    {TEAM_ADMIN_WIZARD_PREVIEW.derivedFieldsTitle}
                  </p>
                  <div className="wizard-preview__fields">
                    {step.derivedFields.map((derived) => (
                      <div className="wizard-preview__derivedrow" key={derived.name}>
                        <span className="wizard-preview__fieldname">{derived.name}</span>

                        <div className="wizard-preview__fieldbody">
                          <p className="wizard-preview__derivedtitle">{derived.title}</p>

                          {derived.notes.map((derivedNote) => (
                            <p className="wizard-preview__derivednote" key={derivedNote}>
                              {derivedNote}
                            </p>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              ) : null}

              <p className="wizard-preview__subtitle">{TEAM_ADMIN_WIZARD_PREVIEW.checksTitle}</p>
              <ul className="wizard-preview__checks">
                {step.checks.map((check) => (
                  <li key={check}>{check}</li>
                ))}
              </ul>

              {step.warning ? (
                <p className="wizard-preview__warning">{step.warning}</p>
              ) : null}

              <div className="wizard-preview__stepfoot">
                <span className="wizard-preview__badge">
                  {step.futureTransaction === null
                    ? TEAM_ADMIN_WIZARD_PREVIEW.noInstructionLabel
                    : `${TEAM_ADMIN_WIZARD_PREVIEW.laterInstructionLabel} · ${step.futureTransaction}`}
                </span>
                <span className="wizard-preview__state">{step.transactionState}</span>
              </div>
            </li>
          ))}
        </ol>

        <div className="wizard-preview__policy">
          <p className="wizard-preview__subtitle">{TEAM_ADMIN_WIZARD_PREVIEW.rolePolicyTitle}</p>
          <ul className="wizard-preview__policylist">
            {TEAM_ADMIN_WIZARD_PREVIEW.rolePolicyNotes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </div>

        <div className="wizard-preview__policy">
          <p className="wizard-preview__subtitle">{TEAM_ADMIN_WIZARD_PREVIEW.nonClaimsTitle}</p>
          <ul className="wizard-preview__claims">
            {TEAM_ADMIN_WIZARD_NON_CLAIMS.map((claim) => (
              <li key={claim}>{claim}</li>
            ))}
          </ul>
        </div>
      </div>
    </SurfaceCard>
  )
}
