const TONE_BY_LABEL = {
  ready: 'success',
  up: 'success',
  open: 'success',
  enabled: 'success',
  online: 'success',
  ok: 'success',
  running: 'success',
  connected: 'success',
  'real hardware': 'success',
  'seen latest scan': 'success',
  'seen in latest scan': 'success',
  implemented: 'success',

  closed: 'neutral',
  disabled: 'neutral',
  down: 'neutral',
  off: 'neutral',
  offline: 'neutral',
  stopped: 'neutral',
  'not rediscovered': 'neutral',
  'not present': 'neutral',
  'not configured': 'neutral',
  'not implemented': 'neutral',
  'not checked': 'neutral',
  unknown: 'neutral',

  warn: 'warn',
  warning: 'warn',
  'recently seen': 'warn',
  blink: 'warn',
  development: 'warn',

  error: 'danger',
  fault: 'danger',
  failed: 'danger',
  fail: 'danger',
  offline_error: 'danger',
};

export default function StatusChip({ label, tone, title, className = '' }) {
  const resolvedTone = tone
    || TONE_BY_LABEL[(label || '').toString().toLowerCase()]
    || 'neutral';
  return (
    <span
      className={`status-chip status-chip--${resolvedTone}${className ? ` ${className}` : ''}`}
      title={title}
    >
      <span className="status-chip-dot" aria-hidden="true" />
      {label}
    </span>
  );
}
