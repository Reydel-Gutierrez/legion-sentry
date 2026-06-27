import { useEffect, useState } from 'react';
import { api } from '../api/client';
import SectionCard from '../components/common/SectionCard';
import PageHeader from '../components/common/PageHeader';
import StatusChip from '../components/common/StatusChip';
import ActionButton from '../components/common/ActionButton';
import DataTable from '../components/common/DataTable';

function formatLastSeen(iso) {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60000) return 'Just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return new Date(iso).toLocaleString();
}

const MSTP_STATUS_META = {
  seen_latest_scan: { tone: 'success', label: 'Seen latest scan' },
  recently_seen: { tone: 'warn', label: 'Recently seen' },
  stale: { tone: 'neutral', label: 'Not rediscovered' },
  never_confirmed: { tone: 'neutral', label: 'Unknown' },
};

function mstpStatusChip(device) {
  const meta = MSTP_STATUS_META[device.mstpStatus] || MSTP_STATUS_META.never_confirmed;
  const title = device.mstpStatus === 'stale'
    ? 'Managed device was not seen in the latest Who-Is scan.'
    : undefined;
  return <StatusChip tone={meta.tone} label={meta.label} title={title} />;
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
  const pointColumns = [
    { key: 'objectType', header: 'Object Type', render: (p) => p.objectTypeLabel || p.objectType },
    { key: 'objectInstance', header: 'Instance', cellClassName: 'mono' },
    { key: 'objectName', header: 'Object Name', render: (p) => p.objectName || '—' },
    { key: 'presentValue', header: 'Present Value', cellClassName: 'mono', render: (p) => formatPresentValue(p.presentValue) },
    { key: 'units', header: 'Units', render: (p) => p.units ?? '—' },
    { key: 'reliability', header: 'Reliability', render: (p) => p.reliability ?? '—' },
    { key: 'status', header: 'Status', render: (p) => p.status || '—' },
    { key: 'lastReadAt', header: 'Last Read', render: (p) => formatLastSeen(p.lastReadAt) },
  ];

  return (
    <SectionCard
      title={`Points — MAC ${device.mstpMacAddress} (instance ${device.deviceInstance})`}
      className="mt-3"
      actions={(
        <>
          <ActionButton variant="primary" size="sm" onClick={onDiscover} disabled={loading || !device.enabled}>
            Discover Points
          </ActionButton>
          <ActionButton size="sm" onClick={onClear} disabled={loading || points.length === 0}>
            Clear Points
          </ActionButton>
          <ActionButton size="sm" onClick={onClose}>
            Close
          </ActionButton>
        </>
      )}
    >
      {!device.enabled && (
        <p className="text-muted mb-3">Enable this managed device before discovering points.</p>
      )}
      <DataTable
        columns={pointColumns}
        rows={points}
        rowKey={(p) => p.id}
        pageSize={10}
        emptyMessage="No points discovered yet."
      />
    </SectionCard>
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

  const enabledCount = devices.filter((d) => d.enabled).length;
  const lastScan = devices.reduce((latest, d) => {
    const t = d.lastSeenAt ? new Date(d.lastSeenAt).getTime() : 0;
    return t > latest ? t : latest;
  }, 0);

  const summary = [
    { label: 'Total', value: devices.length },
    { label: 'Enabled', value: enabledCount, variant: 'success' },
    { label: 'Disabled', value: devices.length - enabledCount },
    { label: 'Last Scan', value: lastScan ? formatLastSeen(new Date(lastScan).toISOString()) : '—' },
  ];

  const columns = [
    { key: 'rediscovery', header: 'Rediscovery', render: (d) => mstpStatusChip(d) },
    {
      key: 'enabled',
      header: 'Enabled',
      render: (d) => <StatusChip tone={d.enabled ? 'success' : 'neutral'} label={d.enabled ? 'Enabled' : 'Disabled'} />,
    },
    { key: 'network', header: 'Network', render: (d) => d.configuredNetworkNumber ?? '—' },
    { key: 'mac', header: 'MS/TP MAC', cellClassName: 'mono', render: (d) => d.mstpMacAddress },
    { key: 'deviceInstance', header: 'Instance' },
    { key: 'objectName', header: 'Object Name', render: (d) => d.objectName || '—' },
    { key: 'vendor', header: 'Vendor', render: (d) => d.vendor || '—' },
    { key: 'lastSeen', header: 'Last Seen', render: (d) => formatLastSeen(d.lastSeenAt) },
    { key: 'missed', header: 'Missed', render: (d) => d.missedScans ?? 0 },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (device) => (
        <div className="d-flex flex-wrap gap-2 justify-content-end">
          <ActionButton
            size="sm"
            onClick={() => handleDiscoverPoints(device)}
            disabled={loading || !device.enabled}
            title={device.enabled ? 'Read objectList and point properties via MS/TP' : 'Enable device first'}
          >
            Discover Points
          </ActionButton>
          <ActionButton size="sm" onClick={() => handleViewPoints(device)} disabled={loading}>
            {viewingDeviceId === device.id ? 'Hide Points' : 'View Points'}
          </ActionButton>
          <ActionButton size="sm" onClick={() => handleToggleEnabled(device)} disabled={loading}>
            {device.enabled ? 'Disable' : 'Enable'}
          </ActionButton>
          <ActionButton variant="danger" size="sm" onClick={() => handleUnmanage(device)} disabled={loading}>
            Unmanage
          </ActionButton>
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Managed MS/TP Devices"
        subtitle="Persistent field devices promoted from discovery."
        summary={summary}
      />

      {message && (
        <div className={`alert-sentry alert-sentry-${message.type === 'error' ? 'error' : 'success'} mb-3`}>
          {message.text}
        </div>
      )}

      <SectionCard title="Managed Devices">
        <DataTable
          columns={columns}
          rows={devices}
          rowKey={(d) => d.id}
          pageSize={10}
          emptyMessage="No managed devices yet. Promote MS/TP devices from BACnet discovery."
        />
      </SectionCard>

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
    </>
  );
}
