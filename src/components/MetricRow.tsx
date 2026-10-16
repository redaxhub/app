
interface MetricRowProps {
  label: string
  value: string
  hint?: string
  emphasis?: boolean
}

export function MetricRow({ label, value, hint, emphasis = false }: MetricRowProps) {
  return (
    <div className={emphasis ? 'metric metric--emphasis' : 'metric'}>
      <div className="metric__label">
        <span>{label}</span>
        {hint ? <span className="metric__hint">{hint}</span> : null}
      </div>
      <span className="metric__value">{value}</span>
    </div>
  )
}
