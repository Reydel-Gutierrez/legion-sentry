import { useEffect, useState } from 'react';
import { Table } from 'react-bootstrap';
import { api } from '../api/client';
import PanelCard from '../components/common/PanelCard';
import PageHeader from '../components/common/PageHeader';

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

  return (
    <>
      <PageHeader title="Logs" subtitle="System, network, and protocol event log" />

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

      <PanelCard title={`Log Entries${loading ? ' — refreshing…' : ''}`}>
        <Table responsive className="sentry-table mb-0">
          <thead>
            <tr>
              <th>Timestamp</th>
              <th>Level</th>
              <th>Service</th>
              <th>Message</th>
            </tr>
          </thead>
          <tbody>
            {logs.length === 0 ? (
              <tr><td colSpan={4} style={{ textAlign: 'center', color: '#58677d' }}>No log entries</td></tr>
            ) : (
              logs.map((log) => (
                <tr key={log.id}>
                  <td className="log-ts">{formatTimestamp(log.timestamp)}</td>
                  <td><span className={`log-level level-${log.level}`}>{log.level}</span></td>
                  <td>{log.service}</td>
                  <td>{log.message}</td>
                </tr>
              ))
            )}
          </tbody>
        </Table>
      </PanelCard>

      <div className="action-bar">
        <button type="button" className="btn btn-sentry-secondary" onClick={() => load()} disabled={loading}>
          Refresh
        </button>
        <button type="button" className="btn btn-sentry-secondary" onClick={handleClear} disabled={loading}>
          Clear
        </button>
        <button type="button" className="btn btn-sentry-secondary" disabled title="Download not yet implemented">
          Download
        </button>
      </div>
    </>
  );
}
