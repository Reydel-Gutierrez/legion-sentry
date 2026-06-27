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

function formatPresentValue(value) {
  if (value == null || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return String(value);
}

function PointsPanel({
  device,
  points,
  loading,
  onDiscover,
  onClear,
  onClose,
}) {
  return (
    <div className="mt-3 pt-3" style={{ borderTop: '1px solid #e3e8ef' }}>
      <div className="d-flex justify-content-between align-items-center mb-2">
        <h6 style={{ margin: 0 }}>
          Points for MAC {device.mstpMacAddress} (instance {device.deviceInstance})
        </h6>
        <div className="d-flex gap-2">
          <button
            type="button"
            className="btn btn-sentry-primary btn-sm"
            onClick={onDiscover}
            disabled={loading || !device.enabled}
          >
            Discover Points
          </button>
          <button
            type="button"
            className="btn btn-sentry-secondary btn-sm"
            onClick={onClear}
            disabled={loading || points.length === 0}
          >
            Clear Points
          </button>
          <button
            type="button"
            className="btn btn-sentry-secondary btn-sm"
            onClick={onClose}
          >
            Close
          </button>
        </div>
      </div>
      {!device.enabled && (
        <p style={{ color: '#58677d', marginBottom: '0.75rem' }}>
          Enable this managed device before discovering points.
        </p>
      )}
      <Table responsive className="sentry-table mb-0">
        <thead>
          <tr>
            <th>Object Type</th>
            <th>Instance</th>
            <th>Object Name</th>
            <th>Present Value</th>
            <th>Units</th>
            <th>Reliability</th>
            <th>Status</th>
            <th>Last Read</th>
          </tr>
        </thead>
        <tbody>
          {points.length === 0 ? (
            <tr>
              <td colSpan={8} style={{ textAlign: 'center', color: '#58677d' }}>
                No points discovered yet.
              </td>
            </tr>
          ) : (
            points.map((point) => (
              <tr key={point.id}>
                <td>{point.objectTypeLabel || point.objectType}</td>
                <td className="mono">{point.objectInstance}</td>
                <td>{point.objectName || '—'}</td>
                <td className="mono">{formatPresentValue(point.presentValue)}</td>
                <td>{point.units ?? '—'}</td>
                <td>{point.reliability ?? '—'}</td>
                <td>{point.status || '—'}</td>
                <td>{formatLastSeen(point.lastReadAt)}</td>
              </tr>
            ))
          )}
        </tbody>
      </Table>
    </div>
  );
}

export default function ManagedDevicesPage() {
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState(null);
  const [viewingDeviceId, setViewingDeviceId] = useState(null);
  const [pointsByDevice, setPointsByDevice] = useState({});

  const load = () => {
    api.getManagedDevices()
      .then((data) => setDevices(data.devices || []))
      .catch((err) => setMessage({ type: 'error', text: err.message }));
  };

  useEffect(() => { load(); }, []);

  const loadPoints = async (deviceId) => {
    const data = await api.getManagedDevicePoints(deviceId);
    setPointsByDevice((prev) => ({ ...prev, [deviceId]: data.points || [] }));
    return data.points || [];
  };

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
      if (viewingDeviceId === device.id) {
        setViewingDeviceId(null);
      }
      setPointsByDevice((prev) => {
        const next = { ...prev };
        delete next[device.id];
        return next;
      });
      load();
      setMessage({ type: 'success', text: 'Device removed from managed list.' });
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setLoading(false);
    }
  };

  const handleViewPoints = async (device) => {
    if (viewingDeviceId === device.id) {
      setViewingDeviceId(null);
      return;
    }
    setLoading(true);
    setMessage(null);
    try {
      await loadPoints(device.id);
      setViewingDeviceId(device.id);
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setLoading(false);
    }
  };

  const handleDiscoverPoints = async (device) => {
    setLoading(true);
    setMessage(null);
    try {
      const result = await api.discoverManagedDevicePoints(device.id);
      setPointsByDevice((prev) => ({ ...prev, [device.id]: result.points || [] }));
      setViewingDeviceId(device.id);
      setMessage({
        type: result.success === false ? 'error' : 'success',
        text: result.message || `Discovered ${result.pointsFound ?? result.points?.length ?? 0} point(s).`,
      });
    } catch (err) {
      if (err.body?.points) {
        setPointsByDevice((prev) => ({ ...prev, [device.id]: err.body.points }));
        setViewingDeviceId(device.id);
      }
      setMessage({ type: 'error', text: err.message });
    } finally {
      setLoading(false);
    }
  };

  const handleClearPoints = async (device) => {
    if (!window.confirm(`Clear all discovered points for MAC ${device.mstpMacAddress}?`)) return;
    setLoading(true);
    setMessage(null);
    try {
      await api.clearManagedDevicePoints(device.id);
      setPointsByDevice((prev) => ({ ...prev, [device.id]: [] }));
      setMessage({ type: 'success', text: 'Discovered points cleared.' });
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setLoading(false);
    }
  };

  const viewingDevice = devices.find((d) => d.id === viewingDeviceId) || null;

  return (
    <>
      {message && (
        <div className={`alert-sentry alert-sentry-${message.type === 'error' ? 'error' : 'success'} mb-3`}>
          {message.text}
        </div>
      )}

      <PanelCard title="Managed MS/TP Devices">
        <p style={{ color: '#58677d', marginTop: 0, marginBottom: '0.75rem' }}>
          Devices promoted from discovery for persistent field execution. Discover BACnet
          objects/points through MS/TP for enabled managed devices.
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
                    <div className="d-flex flex-wrap gap-2">
                      <button
                        type="button"
                        className="btn btn-sentry-primary btn-sm"
                        onClick={() => handleDiscoverPoints(device)}
                        disabled={loading || !device.enabled}
                        title={device.enabled ? 'Read objectList and point properties via MS/TP' : 'Enable device first'}
                      >
                        Discover Points
                      </button>
                      <button
                        type="button"
                        className="btn btn-sentry-secondary btn-sm"
                        onClick={() => handleViewPoints(device)}
                        disabled={loading}
                      >
                        {viewingDeviceId === device.id ? 'Hide Points' : 'View Points'}
                      </button>
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

        {viewingDevice && (
          <PointsPanel
            device={viewingDevice}
            points={pointsByDevice[viewingDevice.id] || []}
            loading={loading}
            onDiscover={() => handleDiscoverPoints(viewingDevice)}
            onClear={() => handleClearPoints(viewingDevice)}
            onClose={() => setViewingDeviceId(null)}
          />
        )}
      </PanelCard>
    </>
  );
}
