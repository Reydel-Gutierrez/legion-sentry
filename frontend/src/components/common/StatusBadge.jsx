const STATUS_MAP = {
  running: 'running',
  up: 'up',
  connected: 'connected',
  on: 'on',
  blink: 'blink',
  online: 'running',
  stopped: 'stopped',
  down: 'down',
  disconnected: 'disconnected',
  off: 'off',
  offline: 'error',
  warning: 'warn',
  warn: 'warn',
  error: 'error',
  fault: 'fault',
  idle: 'running',
  not_configured: 'stopped',
  not_implemented: 'stopped',
  ready: 'running',
  disabled: 'stopped',
  not_present: 'stopped',
  'real hardware': 'hardware',
  development: 'simulated',
};

export default function StatusBadge({ status, label, variant }) {
  const normalized = (status || 'stopped').toLowerCase();
  const badgeVariant = variant || STATUS_MAP[normalized] || 'stopped';

  return (
    <span className={`status-badge badge-${badgeVariant}`}>
      <span className="status-dot" />
      {label || status}
    </span>
  );
}
