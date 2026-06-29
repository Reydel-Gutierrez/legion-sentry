import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import SectionCard from '../components/common/SectionCard';
import PageHeader from '../components/common/PageHeader';
import StatusChip from '../components/common/StatusChip';
import ActionButton from '../components/common/ActionButton';
import DataTable from '../components/common/DataTable';
import ProgressBar from '../components/common/ProgressBar';

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

const POINT_QUALITY_TONE = {
  online: 'success',
  stale: 'warn',
  offline: 'danger',
  offline_by_device: 'danger',
  stale_by_device: 'warn',
  unknown: 'neutral',
  error: 'danger',
};

const POLL_GROUPS = ['fast', 'normal', 'slow', 'manual'];

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

function formatPresentValue(value) {
  if (value == null || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return String(value);
}

function PointsPanel({
  device,
  points,
  loading,
  discoveryJob,
  refreshJobs,
  onDiscover,
  onClear,
  onClose,
  onPollGroupChange,
  onTogglePolling,
  onRefreshPoint,
}) {
  const pointColumns = [
    { key: 'objectType', header: 'Object Type', render: (p) => p.objectTypeLabel || p.objectType },
    { key: 'objectInstance', header: 'Instance', cellClassName: 'mono' },
    { key: 'objectName', header: 'Object Name', render: (p) => p.objectName || '—' },
    {
      key: 'pollGroup',
      header: 'Poll Group',
      render: (p) => (
        <select
          className="form-select form-select-sm"
          value={p.pollGroup || 'normal'}
          disabled={loading}
          onChange={(e) => onPollGroupChange(p, e.target.value)}
        >
          {POLL_GROUPS.map((g) => (
            <option key={g} value={g}>{g}</option>
          ))}
        </select>
      ),
    },
    {
      key: 'pollIntervalMs',
      header: 'Interval',
      render: (p) => (p.pollIntervalMs ? `${Math.round(p.pollIntervalMs / 1000)}s` : '—'),
    },
    { key: 'presentValue', header: 'Present Value', cellClassName: 'mono', render: (p) => formatPresentValue(p.presentValue) },
    {
      key: 'quality',
      header: 'Quality',
      render: (p) => (
        <StatusChip
          tone={POINT_QUALITY_TONE[p.quality] || 'neutral'}
          label={(p.quality || 'unknown').replace(/_/g, ' ')}
          title={p.lastError || undefined}
        />
      ),
    },
    { key: 'lastReadAt', header: 'Last Read', render: (p) => formatLastSeen(p.lastReadAt) },
    { key: 'nextPollAt', header: 'Next Poll', render: (p) => formatLastSeen(p.nextPollAt) },
    { key: 'failureCount', header: 'Failures', render: (p) => p.failureCount ?? 0 },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (p) => {
        const refreshJob = refreshJobs[p.id];
        const refreshing = refreshJob && !['completed', 'failed', 'cancelled'].includes(refreshJob.status);
        return (
          <div className="d-flex flex-wrap gap-2 justify-content-end">
            {refreshing && (
              <div style={{ minWidth: '120px' }}>
                <ProgressBar value={refreshJob.progress} className="sentry-progress--compact" />
              </div>
            )}
            <ActionButton
              size="sm"
              onClick={() => onTogglePolling(p)}
              disabled={loading}
            >
              {p.pollingEnabled ? 'Disable Poll' : 'Enable Poll'}
            </ActionButton>
            <ActionButton
              size="sm"
              onClick={() => onRefreshPoint(p)}
              disabled={loading || refreshing || !device.enabled}
            >
              Refresh
            </ActionButton>
          </div>
        );
      },
    },
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
      {discoveryJob && !['completed', 'failed', 'cancelled'].includes(discoveryJob.status) && (
        <div className="mb-3">
          <ProgressBar
            value={discoveryJob.progress}
            label="Point discovery"
            message={discoveryJob.progressMessage}
          />
        </div>
      )}
      {discoveryJob?.status === 'failed' && (
        <div className="alert-sentry alert-sentry-error mb-3">
          {discoveryJob.error || discoveryJob.progressMessage || 'Point discovery failed.'}
        </div>
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
  const [discoveryJobsByDevice, setDiscoveryJobsByDevice] = useState({});
  const [refreshJobsByPoint, setRefreshJobsByPoint] = useState({});
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

  const stopDiscoveryPolling = (deviceId) => {
    if (pollTimersRef.current[deviceId]) {
      clearInterval(pollTimersRef.current[deviceId]);
      delete pollTimersRef.current[deviceId];
    }
  };

  const updateDiscoveryJob = (deviceId, job) => {
    setDiscoveryJobsByDevice((prev) => ({
      ...prev,
      [deviceId]: {
        jobId: job.id,
        status: job.status,
        progress: job.progress,
        progressMessage: job.progressMessage,
        error: job.error,
      },
    }));
  };

  const pollDiscoveryJob = (deviceId, jobId) => {
    stopDiscoveryPolling(deviceId);
    pollTimersRef.current[deviceId] = setInterval(async () => {
      try {
        const job = await api.getExecutionJob(jobId);
        updateDiscoveryJob(deviceId, job);

        if (job.status === 'completed') {
          stopDiscoveryPolling(deviceId);
          try {
            await loadPoints(deviceId);
          } catch {
            setPointsByDevice((prev) => ({ ...prev, [deviceId]: job.result?.points || [] }));
          }
          setViewingDeviceId(deviceId);
          setMessage({
            type: 'success',
            text: job.result?.message || `Discovered ${job.result?.pointsFound ?? 0} point(s).`,
          });
          setLoading(false);
        } else if (job.status === 'failed' || job.status === 'cancelled') {
          stopDiscoveryPolling(deviceId);
          if (job.result?.points) {
            setPointsByDevice((prev) => ({ ...prev, [deviceId]: job.result.points }));
            setViewingDeviceId(deviceId);
          }
          setMessage({
            type: 'error',
            text: job.error || job.progressMessage || 'Point discovery failed.',
          });
          setLoading(false);
        }
      } catch (err) {
        stopDiscoveryPolling(deviceId);
        setMessage({ type: 'error', text: err.message });
        setLoading(false);
      }
    }, 1000);
  };

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
      const result = await api.discoverManagedDevicePoints(device.id, { async: true });
      const job = result.job;
      if (!job?.id) {
        throw new Error('Point discovery job was not created');
      }
      updateDiscoveryJob(device.id, job);
      setViewingDeviceId(device.id);
      pollDiscoveryJob(device.id, job.id);
    } catch (err) {
      if (err.body?.points) {
        setPointsByDevice((prev) => ({ ...prev, [device.id]: err.body.points }));
        setViewingDeviceId(device.id);
      }
      setMessage({ type: 'error', text: err.message });
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

  const handlePollGroupChange = async (point, pollGroup) => {
    if (!viewingDeviceId) return;
    try {
      const result = await api.updateManagedPoint(viewingDeviceId, point.id, { pollGroup });
      setPointsByDevice((prev) => ({
        ...prev,
        [viewingDeviceId]: (prev[viewingDeviceId] || []).map((p) => (
          p.id === point.id ? result.point : p
        )),
      }));
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    }
  };

  const handleTogglePolling = async (point) => {
    if (!viewingDeviceId) return;
    try {
      const result = await api.updateManagedPoint(viewingDeviceId, point.id, {
        pollingEnabled: !point.pollingEnabled,
      });
      setPointsByDevice((prev) => ({
        ...prev,
        [viewingDeviceId]: (prev[viewingDeviceId] || []).map((p) => (
          p.id === point.id ? result.point : p
        )),
      }));
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    }
  };

  const handleRefreshPoint = async (point) => {
    if (!viewingDeviceId) return;
    try {
      const result = await api.refreshManagedPoint(viewingDeviceId, point.id, { async: true });
      const job = result.job;
      if (!job?.id) return;

      setRefreshJobsByPoint((prev) => ({ ...prev, [point.id]: job }));

      const timer = setInterval(async () => {
        try {
          const updated = await api.getExecutionJob(job.id);
          setRefreshJobsByPoint((prev) => ({ ...prev, [point.id]: updated }));
          if (['completed', 'failed', 'cancelled'].includes(updated.status)) {
            clearInterval(timer);
            await loadPoints(viewingDeviceId);
          }
        } catch {
          clearInterval(timer);
        }
      }, 1000);
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    }
  };

  const viewingDevice = devices.find((d) => d.id === viewingDeviceId) || null;

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
    { key: 'points', header: 'Points', render: (d) => d.managedPointCount ?? 0 },
    {
      key: 'pointHealth',
      header: 'Point Status',
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
      render: (device) => {
        const discoveryJob = discoveryJobsByDevice[device.id];
        const discovering = discoveryJob
          && !['completed', 'failed', 'cancelled'].includes(discoveryJob.status);
        return (
        <div className="d-flex flex-wrap gap-2 justify-content-end align-items-center">
          {discovering && (
            <div style={{ minWidth: '160px' }}>
              <ProgressBar
                value={discoveryJob.progress}
                message={discoveryJob.progressMessage}
                className="sentry-progress--compact"
              />
            </div>
          )}
          <ActionButton
            size="sm"
            onClick={() => handleDiscoverPoints(device)}
            disabled={loading || !device.enabled || discovering}
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
        );
      },
    },
  ];

  return (
    <>
      <PageHeader
        title="Managed MS/TP Devices"
        subtitle="Persistent field devices with heartbeat monitoring and point polling."
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
          discoveryJob={discoveryJobsByDevice[viewingDevice.id]}
          refreshJobs={refreshJobsByPoint}
          onDiscover={() => handleDiscoverPoints(viewingDevice)}
          onClear={() => handleClearPoints(viewingDevice)}
          onClose={() => setViewingDeviceId(null)}
          onPollGroupChange={handlePollGroupChange}
          onTogglePolling={handleTogglePolling}
          onRefreshPoint={handleRefreshPoint}
        />
      )}
    </>
  );
}
