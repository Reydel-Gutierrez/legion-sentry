import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import SectionCard from '../components/common/SectionCard';
import PageHeader from '../components/common/PageHeader';
import StatusChip from '../components/common/StatusChip';
import ActionButton from '../components/common/ActionButton';
import DataTable from '../components/common/DataTable';
import DevicePointsModal from '../components/devices/DevicePointsModal';

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

const DEVICE_QUALITY_TONE = {
  online: 'success',
  degraded: 'warn',
  stale: 'warn',
  offline: 'danger',
  unknown: 'neutral',
};

function mstpStatusChip(device) {
  const meta = MSTP_STATUS_META[device.mstpStatus] || MSTP_STATUS_META.never_confirmed;
  return <StatusChip tone={meta.tone} label={meta.label} />;
}

function deviceQualityChip(device) {
  const quality = device.deviceQuality || 'unknown';
  return (
    <StatusChip
      tone={DEVICE_QUALITY_TONE[quality] || 'neutral'}
      label={quality.replace(/_/g, ' ')}
      title={device.lastHeartbeatError || undefined}
    />
  );
}

export default function ManagedDevicesPage() {
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState(null);
  const [pointsModalDevice, setPointsModalDevice] = useState(null);
  const pollTimersRef = useRef({});

  const load = () => {
    api.getManagedDevices()
      .then((data) => setDevices(data.devices || []))
      .catch((err) => setMessage({ type: 'error', text: err.message }));
  };

  useEffect(() => { load(); }, []);

  useEffect(() => () => {
    Object.values(pollTimersRef.current).forEach((timer) => clearInterval(timer));
  }, []);

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
      if (pointsModalDevice?.id === device.id) {
        setPointsModalDevice(null);
      }
      load();
      setMessage({ type: 'success', text: 'Device removed from managed list.' });
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setLoading(false);
    }
  };

  const handleOpenPoints = (device) => {
    setMessage(null);
    setPointsModalDevice(device);
  };

  const enabledCount = devices.filter((d) => d.enabled).length;
  const onlineDevices = devices.filter((d) => d.deviceQuality === 'online').length;

  const summary = [
    { label: 'Total', value: devices.length },
    { label: 'Enabled', value: enabledCount, variant: 'success' },
    { label: 'Online', value: onlineDevices, variant: 'success' },
    { label: 'Disabled', value: devices.length - enabledCount },
  ];

  const columns = [
    { key: 'rediscovery', header: 'Rediscovery', render: (d) => mstpStatusChip(d) },
    { key: 'health', header: 'Health', render: (d) => deviceQualityChip(d) },
    {
      key: 'enabled',
      header: 'Enabled',
      render: (d) => <StatusChip tone={d.enabled ? 'success' : 'neutral'} label={d.enabled ? 'Enabled' : 'Disabled'} />,
    },
    { key: 'network', header: 'Network', render: (d) => d.configuredNetworkNumber ?? '—' },
    { key: 'mac', header: 'MS/TP MAC', cellClassName: 'mono', render: (d) => d.mstpMacAddress },
    { key: 'deviceInstance', header: 'Instance' },
    { key: 'objectName', header: 'Object Name', render: (d) => d.objectName || '—' },
    { key: 'heartbeat', header: 'Last Heartbeat', render: (d) => formatLastSeen(d.lastHeartbeatAt) },
    { key: 'hbFailures', header: 'HB Failures', render: (d) => d.heartbeatFailureCount ?? 0 },
    {
      key: 'discovered',
      header: 'Discovered',
      render: (d) => d.discoveredPointCount ?? 0,
    },
    {
      key: 'managed',
      header: 'Managed',
      render: (d) => d.managedPointCount ?? 0,
    },
    {
      key: 'pointHealth',
      header: 'Managed Quality',
      render: (d) => (
        <span className="text-muted" style={{ fontSize: '0.85rem' }}>
          {d.onlinePoints ?? 0}
          {' '}
          on /
          {d.stalePoints ?? 0}
          {' '}
          stale /
          {d.offlinePoints ?? 0}
          {' '}
          off
        </span>
      ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (device) => (
        <div className="d-flex flex-wrap gap-2 justify-content-end align-items-center">
          <ActionButton
            size="sm"
            variant="primary"
            onClick={() => handleOpenPoints(device)}
            disabled={loading}
          >
            Points
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
        subtitle="Persistent field devices with heartbeat monitoring and selective point management."
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

      <DevicePointsModal
        device={pointsModalDevice}
        show={Boolean(pointsModalDevice)}
        onHide={() => setPointsModalDevice(null)}
        onMessage={setMessage}
        onDevicesChanged={load}
      />
    </>
  );
}
