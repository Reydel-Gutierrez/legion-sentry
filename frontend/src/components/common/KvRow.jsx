export default function KvRow({ label, value }) {
  return (
    <div className="kv-row">
      <span className="kv-label">{label}</span>
      <span className="kv-value">{value ?? '—'}</span>
    </div>
  );
}
