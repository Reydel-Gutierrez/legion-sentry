import { useEffect, useState } from 'react';
import { api } from '../api/client';
import SectionCard from '../components/common/SectionCard';
import PageHeader from '../components/common/PageHeader';
import ActionButton from '../components/common/ActionButton';
import DataTable from '../components/common/DataTable';

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'system', label: 'System' },
  { id: 'network', label: 'Network' },
  { id: 'bacnet', label: 'BACnet' },
  { id: 'modbus', label: 'Modbus' },
  { id: 'mqtt', label: 'MQTT' },
  { id: 'fault', label: 'Fault' },
];

function formatTimestamp(iso) {
  return new Date(iso).toLocaleString();
}

export default function LogsPage() {
  const [logs, setLogs] = useState([]);
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(false);

  const load = (f = filter) => {
    setLoading(true);
    api.getLogs(f)
      .then((data) => setLogs(data.logs))
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [filter]);

  const handleClear = async () => {
    await api.clearLogs();
    load();
  };

  const columns = [
    { key: 'timestamp', header: 'Timestamp', cellClassName: 'log-ts', render: (log) => formatTimestamp(log.timestamp) },
    { key: 'level', header: 'Level', render: (log) => <span className={`log-level level-${log.level}`}>{log.level}</span> },
    { key: 'service', header: 'Service' },
    { key: 'message', header: 'Message' },
  ];

  return (
    <>
      <PageHeader
        title="Logs"
        subtitle="Persistent local event log."
        actions={(
          <>
            <ActionButton size="sm" onClick={() => load()} disabled={loading}>
              Refresh
            </ActionButton>
            <ActionButton size="sm" disabled title="Download not yet implemented">
              Download
            </ActionButton>
            <ActionButton variant="danger" size="sm" onClick={handleClear} disabled={loading}>
              Clear
            </ActionButton>
          </>
        )}
      />

      <SectionCard title="Log Filter" className="mb-3">
        <div className="filter-bar">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              className={`filter-btn${filter === f.id ? ' active' : ''}`}
              onClick={() => setFilter(f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>
      </SectionCard>

      <SectionCard title={`Log Entries${loading ? ' — refreshing…' : ''}`}>
        <DataTable
          columns={columns}
          rows={logs}
          rowKey={(log) => log.id}
          pageSize={15}
          emptyMessage="No log entries."
        />
      </SectionCard>
    </>
  );
}
