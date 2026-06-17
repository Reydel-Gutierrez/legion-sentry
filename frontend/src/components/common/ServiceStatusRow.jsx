import StatusBadge from './StatusBadge';

export default function ServiceStatusRow({ name, status, label, detail }) {
  const displayLabel = label || status;

  return (
    <div className="kv-row">
      <span className="kv-label">{name}</span>
      <span className="kv-value" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', justifyContent: 'flex-end' }}>
        <StatusBadge status={status} label={displayLabel} />
        {detail && <span style={{ color: '#58677d', fontSize: '0.75rem' }}>{detail}</span>}
      </span>
    </div>
  );
}
