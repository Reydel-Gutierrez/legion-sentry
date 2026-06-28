export default function ProgressBar({
  value = 0,
  label,
  message,
  className = '',
  barClassName = 'bar-accent',
}) {
  const pct = Math.max(0, Math.min(100, Number(value) || 0));

  return (
    <div className={`sentry-progress${className ? ` ${className}` : ''}`}>
      {(label || message) && (
        <div className="sentry-progress-header">
          {label && <span className="sentry-progress-label">{label}</span>}
          {message && <span className="sentry-progress-message">{message}</span>}
          <span className="sentry-progress-value">{pct}%</span>
        </div>
      )}
      <div className="progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <div className={`progress-bar ${barClassName}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
