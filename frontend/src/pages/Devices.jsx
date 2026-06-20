import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Table } from 'react-bootstrap';
import { api } from '../api/client';
import PanelCard from '../components/common/PanelCard';
import StatusBadge from '../components/common/StatusBadge';
import PageHeader from '../components/common/PageHeader';

function formatLastSeen(iso) {
  if (!iso) return '—';
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
      if (result.devices.length === 0) {
        setMessage({ type: 'info', text: 'No devices in inventory. Run BACnet/IP discovery first.' });
      } else {
        const online = result.summary?.online ?? result.devices.filter((d) => d.status === 'online').length;
        setMessage({ type: 'success', text: `Health refresh complete — ${online} of ${result.devices.length} online.` });
      }
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setLoading(false);
    }
  };

  const handleDiscoverIp = async () => {
    setLoading(true);
    setMessage(null);
    try {
      const result = await api.discoverBacnetIp(5000);
      const inventory = result.inventory || {};
      setDevices(inventory.devices || []);
      const found = result.devices?.length ?? inventory.devicesFound ?? 0;
      if (found === 0) {
        setMessage({ type: 'info', text: 'No BACnet/IP devices discovered.' });
      } else {
        setMessage({
          type: 'success',
          text: `BACnet/IP discovery complete — ${found} device(s) found in ${result.durationMs}ms.`,
        });
      }
      load();
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (e, id) => {
    e.stopPropagation();
    if (!window.confirm('Remove this device from inventory?')) return;
    setLoading(true);
    try {
      await api.deleteDevice(id);
      load();
      setMessage({ type: 'success', text: 'Device removed from inventory.' });
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setLoading(false);
    }
  };

  const handleDiscoverMstp = () => {
    setMessage({
      type: 'info',
      text: 'BACnet MS/TP discovery is not implemented yet. Use RS485 Diagnostics to validate serial traffic first.',
    });
  };

  const handleClear = async () => {
    if (!window.confirm('Clear entire device inventory? This cannot be undone.')) return;
    setLoading(true);
    try {
      await api.clearDevices();
      setDevices([]);
      setMessage({ type: 'success', text: 'Device inventory cleared.' });
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
        subtitle="Discover and monitor BACnet/IP devices on connected networks"
      />

      {message && (
        <div className={`alert-sentry alert-sentry-${message.type === 'error' ? 'error' : message.type === 'info' ? 'info' : 'success'}`}>
          {message.text}
        </div>
      )}

      <PanelCard title={`Device Inventory (${devices.length})`}>
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
              <th />
            </tr>
          </thead>
          <tbody>
            {devices.length === 0 ? (
              <tr>
                <td colSpan={9} style={{ textAlign: 'center', color: '#58677d' }}>
                  No devices discovered yet. Run BACnet/IP discovery to scan the local network.
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
                  onKeyDown={(k) => k.key === 'Enter' && navigate(`/devices/${device.id}`)}
                >
                  <td><StatusBadge status={device.status} label={device.status} /></td>
                  <td>{device.deviceInstance}</td>
                  <td>{device.objectName || '—'}</td>
                  <td>{device.vendor || device.vendorName || '—'}</td>
                  <td>{device.model || device.modelName || '—'}</td>
                  <td className="mono">{device.address}</td>
                  <td>{device.network}</td>
                  <td>{formatLastSeen(device.lastSeen || device.lastSeenAt)}</td>
                  <td>
                    <button
                      type="button"
                      className="btn btn-sentry-secondary btn-sm"
                      onClick={(e) => handleDelete(e, device.id)}
                      disabled={loading}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </Table>
      </PanelCard>

      <div className="action-bar">
        <button type="button" className="btn btn-sentry-secondary" onClick={handleRefresh} disabled={loading}>
          Refresh
        </button>
        <button type="button" className="btn btn-sentry-primary" onClick={handleDiscoverIp} disabled={loading}>
          Discover BACnet/IP
        </button>
        <button type="button" className="btn btn-sentry-secondary" onClick={handleDiscoverMstp} disabled={loading}>
          Discover BACnet MS/TP
        </button>
        <button type="button" className="btn btn-sentry-danger" onClick={handleClear} disabled={loading || devices.length === 0}>
          Clear Inventory
        </button>
      </div>
    </>
  );
}
