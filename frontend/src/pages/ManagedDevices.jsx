import { useEffect, useState } from 'react';
import { Table } from 'react-bootstrap';
import { api } from '../api/client';
import PanelCard from '../components/common/PanelCard';

function formatLastSeen(iso) {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60000) return 'Just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return new Date(iso).toLocaleString();
}

const MSTP_STATUS_META = {
  seen_latest_scan: { variant: 'running', label: 'Seen latest scan' },
  recently_seen: { variant: 'warn', label: 'Recently seen' },
  stale: { variant: 'stopped', label: 'Not rediscovered' },
  never_confirmed: { variant: 'stopped', label: 'Unknown' },
};

function mstpStatusBadge(device) {
  const meta = MSTP_STATUS_META[device.mstpStatus] || MSTP_STATUS_META.never_confirmed;
  const title = device.mstpStatus === 'stale'
    ? 'Managed device was not seen in the latest Who-Is scan.'
    : undefined;
  return (
    <span className={`status-badge badge-${meta.variant}`} title={title}>
      {meta.label}
    </span>
  );
}

function enabledBadge(enabled) {
  return enabled
    ? <span className="status-badge badge-running">Enabled</span>
    : <span className="status-badge badge-stopped">Disabled</span>;
}

export default function ManagedDevicesPage() {
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState(null);

  const load = () => {
    api.getManagedDevices()
      .then((data) => setDevices(data.devices || []))
      .catch((err) => setMessage({ type: 'error', text: err.message }));
  };

  useEffect(() => { load(); }, []);

  const handleToggleEnabled = async (device) => {
    setLoading(true);
    setMessage(null);
    try {
      await api.updateManagedDevice(device.id, { enabled: !device.enabled });
      load();
      setMessage({
        type: 'success',
        text: `Device MAC ${device.mstpMacAddress} ${device.enabled ? 'disabled' : 'enabled'}.`,
      });
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setLoading(false);
    }
  };

  const handleUnmanage = async (device) => {
    if (!window.confirm(`Remove MAC ${device.mstpMacAddress} (instance ${device.deviceInstance}) from managed devices?`)) {
      return;
    }
    setLoading(true);
    setMessage(null);
    try {
      await api.unmanageDevice(device.id);
      load();
      setMessage({ type: 'success', text: 'Device removed from managed list.' });
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      {message && (
        <div className={`alert-sentry alert-sentry-${message.type === 'error' ? 'error' : 'success'} mb-3`}>
          {message.text}
        </div>
      )}

      <PanelCard title="Managed MS/TP Devices">
        <p style={{ color: '#58677d', marginTop: 0, marginBottom: '0.75rem' }}>
          Devices promoted from discovery for persistent field execution. Managed devices remain
          listed across scans and restarts; rediscovery status updates after each MS/TP scan.
        </p>
        <Table responsive className="sentry-table mb-0">
          <thead>
            <tr>
              <th>Rediscovery</th>
              <th>Enabled</th>
              <th>Transport</th>
              <th>Network</th>
              <th>MS/TP MAC</th>
              <th>Device Instance</th>
              <th>Object Name</th>
              <th>Vendor</th>
              <th>Model</th>
              <th>First Seen</th>
              <th>Last Seen</th>
              <th>Managed At</th>
              <th>Missed Scans</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {devices.length === 0 ? (
              <tr>
                <td colSpan={14} style={{ textAlign: 'center', color: '#58677d' }}>
                  No managed devices yet. Promote MS/TP devices from BACnet discovery.
                </td>
              </tr>
            ) : (
              devices.map((device) => (
                <tr key={device.id}>
                  <td>{mstpStatusBadge(device)}</td>
                  <td>{enabledBadge(device.enabled)}</td>
                  <td>{device.transport}</td>
                  <td>{device.configuredNetworkNumber ?? '—'}</td>
                  <td className="mono">{device.mstpMacAddress}</td>
                  <td>{device.deviceInstance}</td>
                  <td>{device.objectName || '—'}</td>
                  <td>{device.vendor || '—'}</td>
                  <td>{device.model || '—'}</td>
                  <td>{formatLastSeen(device.firstSeenAt)}</td>
                  <td>{formatLastSeen(device.lastSeenAt)}</td>
                  <td>{formatLastSeen(device.managedAt)}</td>
                  <td>{device.missedScans ?? 0}</td>
                  <td>
                    <div className="d-flex gap-2">
                      <button
                        type="button"
                        className="btn btn-sentry-secondary btn-sm"
                        onClick={() => handleToggleEnabled(device)}
                        disabled={loading}
                      >
                        {device.enabled ? 'Disable' : 'Enable'}
                      </button>
                      <button
                        type="button"
                        className="btn btn-sentry-danger btn-sm"
                        onClick={() => handleUnmanage(device)}
                        disabled={loading}
                      >
                        Unmanage
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </Table>
      </PanelCard>
    </>
  );
}
