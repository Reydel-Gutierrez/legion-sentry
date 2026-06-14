import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Table } from 'react-bootstrap';
import { api } from '../api/client';
import PanelCard from '../components/common/PanelCard';
import StatusBadge from '../components/common/StatusBadge';
import PageHeader from '../components/common/PageHeader';

function formatLastSeen(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60000) return 'Just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return new Date(iso).toLocaleString();
}

export default function DevicesPage() {
  const navigate = useNavigate();
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState(null);

  const load = () => {
    api.getDevices()
      .then((data) => setDevices(data.devices))
      .catch((err) => setMessage({ type: 'error', text: err.message }));
  };

  useEffect(() => { load(); }, []);

  const handleRefresh = async () => {
    setLoading(true);
    setMessage(null);
    try {
      const result = await api.refreshDevices();
      setDevices(result.devices);
      setMessage({ type: 'success', text: 'Device list refreshed.' });
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setLoading(false);
    }
  };

  const handleDiscover = async (protocol) => {
    setLoading(true);
    setMessage(null);
    try {
      const result = await api.discoverDevices(protocol);
      setDevices(result.devices);
      const label = protocol === 'bacnet-ip' ? 'BACnet/IP' : 'BACnet MS/TP';
      setMessage({
        type: 'success',
        text: `${label} discovery complete — ${result.devicesFound} devices found in ${result.durationMs}ms.`,
      });
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Devices"
        subtitle="Discover and monitor BACnet/IP and MS/TP devices on connected networks"
      />

      {message && (
        <div className={`alert-sentry alert-sentry-${message.type === 'success' ? 'success' : 'error'}`}>
          {message.text}
        </div>
      )}

      <PanelCard title={`Discovered Devices (${devices.length})`}>
        <Table responsive className="sentry-table mb-0">
          <thead>
            <tr>
              <th>Status</th>
              <th>Device Instance</th>
              <th>Object Name</th>
              <th>Vendor</th>
              <th>Model</th>
              <th>Address</th>
              <th>Network</th>
              <th>Last Seen</th>
            </tr>
          </thead>
          <tbody>
            {devices.length === 0 ? (
              <tr>
                <td colSpan={8} style={{ textAlign: 'center', color: '#58677d' }}>
                  No devices discovered — run a BACnet discovery scan
                </td>
              </tr>
            ) : (
              devices.map((device) => (
                <tr
                  key={device.id}
                  className="device-row-clickable"
                  onClick={() => navigate(`/devices/${device.id}`)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => e.key === 'Enter' && navigate(`/devices/${device.id}`)}
                >
                  <td><StatusBadge status={device.status} label={device.status} /></td>
                  <td>{device.deviceInstance}</td>
                  <td>{device.objectName}</td>
                  <td>{device.vendor}</td>
                  <td>{device.model}</td>
                  <td className="mono">{device.address}</td>
                  <td>{device.network}</td>
                  <td>{formatLastSeen(device.lastSeen)}</td>
                </tr>
              ))
            )}
          </tbody>
        </Table>
      </PanelCard>

      <div className="action-bar">
        <button type="button" className="btn btn-sentry-secondary" onClick={handleRefresh} disabled={loading}>
          Refresh Devices
        </button>
        <button type="button" className="btn btn-sentry-primary" onClick={() => handleDiscover('bacnet-ip')} disabled={loading}>
          Discover BACnet/IP
        </button>
        <button type="button" className="btn btn-sentry-primary" onClick={() => handleDiscover('bacnet-mstp')} disabled={loading}>
          Discover BACnet MS/TP
        </button>
      </div>
    </>
  );
}
