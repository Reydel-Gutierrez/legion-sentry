const STATUS_MAP = {
  running: 'running',
  up: 'up',
  connected: 'connected',
  on: 'on',
  blink: 'blink',
  stopped: 'stopped',
  down: 'down',
  disconnected: 'disconnected',
  off: 'off',
  simulated: 'simulated',
  warn: 'warn',
  error: 'error',
  fault: 'fault',
  idle: 'running',
  online: 'running',
};

export default function StatusBadge({ status, label }) {
  const normalized = (status || 'stopped').toLowerCase();
  const variant = STATUS_MAP[normalized] || 'stopped';

  return (
    <span className={`status-badge badge-${variant}`}>
      <span className="status-dot" />
      {label || status}
    </span>
  );
}
