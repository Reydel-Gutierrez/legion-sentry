export default function MetricBar({ label, value, barClass = 'bar-cpu' }) {
  const pct = Math.min(100, Math.max(0, Number(value) || 0));

  return (
    <div className="metric-bar">
      <div className="metric-header">
        <span className="metric-label">{label}</span>
        <span className="metric-value">{pct}%</span>
      </div>
      <div className="progress">
        <div className={`progress-bar ${barClass}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
