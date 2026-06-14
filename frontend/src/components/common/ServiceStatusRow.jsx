import StatusBadge from './StatusBadge';

export default function ServiceStatusRow({ name, status, detail }) {
  return (
    <div className="kv-row">
      <span className="kv-label">{name}</span>
      <span className="kv-value" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', justifyContent: 'flex-end' }}>
        <StatusBadge status={status} />
        {detail && <span style={{ color: '#58677d', fontSize: '0.75rem' }}>{detail}</span>}
      </span>
    </div>
  );
}
