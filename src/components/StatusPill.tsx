// Small status pill with calm, consistent tone semantics (never color-only:
// the label always carries the meaning).

export type StatusTone = 'neutral' | 'positive' | 'caution' | 'info' | 'accent'

interface StatusPillProps {
  label: string
  tone?: StatusTone
}

export function StatusPill({ label, tone = 'neutral' }: StatusPillProps) {
  return <span className={`pill pill--${tone}`}>{label}</span>
}
