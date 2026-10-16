// Standard surface card: eyebrow, title, body, optional footnote. The
// `warning` tone is reserved for the irreversible-burn surface so that the
// one warning that matters stays visually primary (UX direction §19).

import type { ReactNode } from 'react'

interface SurfaceCardProps {
  eyebrow?: string
  title?: string
  footnote?: string
  tone?: 'default' | 'warning'
  children: ReactNode
}

export function SurfaceCard({
  eyebrow,
  title,
  footnote,
  tone = 'default',
  children,
}: SurfaceCardProps) {
  return (
    <section className={tone === 'warning' ? 'card card--warning' : 'card'}>
      {eyebrow ? <p className="card__eyebrow">{eyebrow}</p> : null}
      {title ? <h3 className="card__title">{title}</h3> : null}
      <div className="card__body">{children}</div>
      {footnote ? <p className="card__footnote">{footnote}</p> : null}
    </section>
  )
}
