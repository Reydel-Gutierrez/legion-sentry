export default function MetricBar({ label, value, barClass = 'bar-cpu', unit = '%', max = 100 }) {
  const unavailable = value === null || value === undefined;
  const numeric = unavailable ? 0 : Number(value) || 0;
  const pct = Math.min(100, Math.max(0, (numeric / max) * 100));

  const displayValue = unavailable
    ? '—'
    : unit === '°C'
      ? `${numeric}°C`
      : `${numeric}${unit}`;

  return (
    <div className="metric-bar">
      <div className="metric-header">
        <span className="metric-label">{label}</span>
        <span className="metric-value">{displayValue}</span>
      </div>
      <div className="progress">
        <div className={`progress-bar ${barClass}`} style={{ width: unavailable ? '0%' : `${pct}%` }} />
      </div>
    </div>
  );
}
