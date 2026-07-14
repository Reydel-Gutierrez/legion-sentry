import { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Nav } from 'react-bootstrap';
import { api } from '../../api/client';
import DataTable from '../common/DataTable';
import ActionButton from '../common/ActionButton';
import StatusChip from '../common/StatusChip';
import ProgressBar from '../common/ProgressBar';

const POLL_GROUPS = ['fast', 'normal', 'slow', 'manual'];

const POINT_QUALITY_TONE = {
  online: 'success',
  stale: 'warn',
  offline: 'danger',
  offline_by_device: 'danger',
  stale_by_device: 'warn',
  unknown: 'neutral',
  error: 'danger',
};

function formatLastSeen(iso) {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60000) return 'Just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return new Date(iso).toLocaleString();
}

function formatPresentValue(value) {
  if (value == null || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return String(value);
}

export default function DevicePointsModal({
  device,
  show,
  onHide,
  onMessage,
  onDevicesChanged,
}) {
  const [activeTab, setActiveTab] = useState('managed');
  const [managedPoints, setManagedPoints] = useState([]);
  const [discoveredPoints, setDiscoveredPoints] = useState([]);
  const [lastDiscoveryAt, setLastDiscoveryAt] = useState(null);
  const [loading, setLoading] = useState(false);
  const [discoveryJob, setDiscoveryJob] = useState(null);
  const [refreshJobs, setRefreshJobs] = useState({});
  const [selectedKeys, setSelectedKeys] = useState(new Set());
  const [discoveryFilter, setDiscoveryFilter] = useState('');
  const discoveryPollRef = useRef(null);

  const loadManaged = async () => {
    const data = await api.getManagedDevicePoints(device.id);
    setManagedPoints(data.points || []);
    return data.points || [];
  };

  const loadDiscovered = async () => {
    const data = await api.getDiscoveredDevicePoints(device.id);
    setDiscoveredPoints(data.points || []);
    setLastDiscoveryAt(data.lastDiscoveryAt || null);
    return data.points || [];
  };

  const loadAll = async () => {
    await Promise.all([loadManaged(), loadDiscovered()]);
  };

  useEffect(() => {
    if (!show || !device) return undefined;
    setActiveTab('managed');
    setSelectedKeys(new Set());
    setDiscoveryFilter('');
    setDiscoveryJob(null);
    setRefreshJobs({});
    setLoading(true);
    loadAll()
      .catch((err) => onMessage?.({ type: 'error', text: err.message }))
      .finally(() => setLoading(false));

    return () => {
      if (discoveryPollRef.current) {
        clearInterval(discoveryPollRef.current);
        discoveryPollRef.current = null;
      }
    };
  }, [show, device?.id]);

  const stopDiscoveryPolling = () => {
    if (discoveryPollRef.current) {
      clearInterval(discoveryPollRef.current);
      discoveryPollRef.current = null;
    }
  };

  const pollDiscoveryJob = (jobId) => {
    stopDiscoveryPolling();
    discoveryPollRef.current = setInterval(async () => {
      try {
        const job = await api.getExecutionJob(jobId);
        setDiscoveryJob({
          jobId: job.id,
          status: job.status,
          progress: job.progress,
          progressMessage: job.progressMessage,
          error: job.error,
        });

        if (job.status === 'completed') {
          stopDiscoveryPolling();
          await loadDiscovered();
          setActiveTab('discovery');
          onMessage?.({
            type: 'success',
            text: job.result?.message || `Discovered ${job.result?.pointsFound ?? 0} point(s).`,
          });
          setDiscoveryJob(null);
          setLoading(false);
        } else if (job.status === 'failed' || job.status === 'cancelled') {
          stopDiscoveryPolling();
          if (job.result?.points) {
            setDiscoveredPoints(job.result.points);
            setActiveTab('discovery');
          }
          onMessage?.({
            type: 'error',
            text: job.error || job.progressMessage || 'Point discovery failed.',
          });
          setLoading(false);
        }
      } catch (err) {
        stopDiscoveryPolling();
        onMessage?.({ type: 'error', text: err.message });
        setLoading(false);
      }
    }, 1000);
  };

  const handleDiscover = async () => {
    if (loading) return;
    setLoading(true);
    onMessage?.(null);
    setDiscoveryJob(null);
    try {
      const result = await api.discoverManagedDevicePoints(device.id, { async: true });
      const job = result.job || result.data?.job;
      if (!job?.id) throw new Error('Point discovery job was not created');
      setDiscoveryJob({
        jobId: job.id,
        status: job.status,
        progress: job.progress,
        progressMessage: job.progressMessage,
      });
      setActiveTab('discovery');
      pollDiscoveryJob(job.id);
    } catch (err) {
      const partialPoints = err.body?.points || err.body?.error?.details?.points;
      if (Array.isArray(partialPoints)) {
        setDiscoveredPoints(partialPoints);
        setActiveTab('discovery');
      }
      onMessage?.({ type: 'error', text: err.message });
      setDiscoveryJob(null);
      setLoading(false);
    }
  };

  const filteredDiscovered = useMemo(() => {
    const q = discoveryFilter.trim().toLowerCase();
    if (!q) return discoveredPoints;
    return discoveredPoints.filter((p) => {
      const haystack = [
        p.objectTypeLabel,
        p.objectType,
        p.objectInstance,
        p.objectName,
        p.description,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [discoveredPoints, discoveryFilter]);

  const toggleSelect = (pointKey) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(pointKey)) next.delete(pointKey);
      else next.add(pointKey);
      return next;
    });
  };

  const selectableKeys = filteredDiscovered
    .filter((p) => !p.alreadyManaged)
    .map((p) => p.pointKey);

  const toggleSelectAllVisible = () => {
    const allSelected = selectableKeys.length > 0 && selectableKeys.every((k) => selectedKeys.has(k));
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (allSelected) {
        selectableKeys.forEach((k) => next.delete(k));
      } else {
        selectableKeys.forEach((k) => next.add(k));
      }
      return next;
    });
  };

  const handleManageSelected = async (keys) => {
    if (!keys.length) return;
    setLoading(true);
    try {
      const result = await api.manageDevicePoints(device.id, keys);
      setSelectedKeys(new Set());
      setManagedPoints(result.points || []);
      await loadDiscovered();
      setActiveTab('managed');
      onDevicesChanged?.();
      onMessage?.({
        type: 'success',
        text: `Added ${result.addedCount} point(s) to managed list.`,
      });
    } catch (err) {
      onMessage?.({ type: 'error', text: err.message });
    } finally {
      setLoading(false);
    }
  };

  const handleUnmanage = async (point) => {
    if (!window.confirm(`Stop managing ${point.objectTypeLabel || point.objectType}:${point.objectInstance}?`)) {
      return;
    }
    setLoading(true);
    try {
      const result = await api.unmanageDevicePoint(device.id, point.id);
      setManagedPoints(result.points || []);
      await loadDiscovered();
      onDevicesChanged?.();
      onMessage?.({ type: 'success', text: 'Point removed from managed list.' });
    } catch (err) {
      onMessage?.({ type: 'error', text: err.message });
    } finally {
      setLoading(false);
    }
  };

  const handleUnmanageAll = async () => {
    if (!window.confirm(`Unmanage all ${managedPoints.length} point(s) for this device?`)) return;
    setLoading(true);
    try {
      const result = await api.clearManagedDevicePoints(device.id);
      setManagedPoints([]);
      await loadDiscovered();
      onDevicesChanged?.();
      onMessage?.({
        type: 'success',
        text: `Unmanaged ${result.removedCount} point(s).`,
      });
    } catch (err) {
      onMessage?.({ type: 'error', text: err.message });
    } finally {
      setLoading(false);
    }
  };

  const handlePollGroupChange = async (point, pollGroup) => {
    try {
      const result = await api.updateManagedPoint(device.id, point.id, { pollGroup });
      setManagedPoints((prev) => prev.map((p) => (p.id === point.id ? result.point : p)));
    } catch (err) {
      onMessage?.({ type: 'error', text: err.message });
    }
  };

  const handleTogglePolling = async (point) => {
    try {
      const result = await api.updateManagedPoint(device.id, point.id, {
        pollingEnabled: !point.pollingEnabled,
      });
      setManagedPoints((prev) => prev.map((p) => (p.id === point.id ? result.point : p)));
    } catch (err) {
      onMessage?.({ type: 'error', text: err.message });
    }
  };

  const handleRefreshPoint = async (point) => {
    try {
      const result = await api.refreshManagedPoint(device.id, point.id, { async: true });
      const job = result.job;
      if (!job?.id) return;

      setRefreshJobs((prev) => ({ ...prev, [point.id]: job }));

      const timer = setInterval(async () => {
        try {
          const updated = await api.getExecutionJob(job.id);
          setRefreshJobs((prev) => ({ ...prev, [point.id]: updated }));
          if (['completed', 'failed', 'cancelled'].includes(updated.status)) {
            clearInterval(timer);
            await loadManaged();
            onDevicesChanged?.();
          }
        } catch {
          clearInterval(timer);
        }
      }, 1000);
    } catch (err) {
      onMessage?.({ type: 'error', text: err.message });
    }
  };

  const discovering = discoveryJob
    && !['completed', 'failed', 'cancelled'].includes(discoveryJob.status);

  const discoveryColumns = [
    {
      key: 'select',
      header: (
        <input
          type="checkbox"
          aria-label="Select all visible"
          checked={selectableKeys.length > 0 && selectableKeys.every((k) => selectedKeys.has(k))}
          disabled={loading || selectableKeys.length === 0}
          onChange={toggleSelectAllVisible}
        />
      ),
      render: (p) => (
        <input
          type="checkbox"
          checked={selectedKeys.has(p.pointKey)}
          disabled={loading || p.alreadyManaged}
          onChange={() => toggleSelect(p.pointKey)}
          aria-label={`Select ${p.objectTypeLabel}:${p.objectInstance}`}
        />
      ),
    },
    { key: 'objectType', header: 'Object Type', render: (p) => p.objectTypeLabel || p.objectType },
    { key: 'objectInstance', header: 'Instance', cellClassName: 'mono' },
    { key: 'objectName', header: 'Object Name', render: (p) => p.objectName || '—' },
    { key: 'description', header: 'Description', render: (p) => p.description || '—' },
    {
      key: 'presentValue',
      header: 'Present Value',
      cellClassName: 'mono',
      render: (p) => formatPresentValue(p.presentValue),
    },
    { key: 'units', header: 'Units', render: (p) => p.units || '—' },
    { key: 'reliability', header: 'Reliability', render: (p) => p.reliability || '—' },
    { key: 'status', header: 'Status', render: (p) => p.status || '—' },
    {
      key: 'alreadyManaged',
      header: 'Already Managed',
      render: (p) => (
        <StatusChip
          tone={p.alreadyManaged ? 'success' : 'neutral'}
          label={p.alreadyManaged ? 'Yes' : 'No'}
        />
      ),
    },
  ];

  const managedColumns = [
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
          onChange={(e) => handlePollGroupChange(p, e.target.value)}
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
    {
      key: 'presentValue',
      header: 'Present Value',
      cellClassName: 'mono',
      render: (p) => formatPresentValue(p.presentValue),
    },
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
        const refreshing = refreshJob
          && !['completed', 'failed', 'cancelled'].includes(refreshJob.status);
        return (
          <div className="d-flex flex-wrap gap-2 justify-content-end">
            {refreshing && (
              <div style={{ minWidth: '120px' }}>
                <ProgressBar value={refreshJob.progress} className="sentry-progress--compact" />
              </div>
            )}
            <ActionButton size="sm" onClick={() => handleTogglePolling(p)} disabled={loading}>
              {p.pollingEnabled ? 'Disable Poll' : 'Enable Poll'}
            </ActionButton>
            <ActionButton
              size="sm"
              onClick={() => handleRefreshPoint(p)}
              disabled={loading || refreshing || !device.enabled}
            >
              Refresh
            </ActionButton>
            <ActionButton size="sm" variant="danger" onClick={() => handleUnmanage(p)} disabled={loading}>
              Unmanage
            </ActionButton>
          </div>
        );
      },
    },
  ];

  if (!device) return null;

  return (
    <Modal
      show={show}
      onHide={onHide}
      size="xl"
      centered
      scrollable
      className="sentry-modal"
      contentClassName="sentry-modal-content"
    >
      <Modal.Header closeButton className="sentry-modal-header">
        <Modal.Title>
          Points — MAC {device.mstpMacAddress} / Instance {device.deviceInstance}
        </Modal.Title>
      </Modal.Header>
      <Modal.Body className="sentry-modal-body">
        <Nav variant="tabs" className="sentry-tabs mb-3">
          <Nav.Item>
            <Nav.Link
              active={activeTab === 'managed'}
              onClick={() => setActiveTab('managed')}
              eventKey="managed"
            >
              Managed Points ({managedPoints.length})
            </Nav.Link>
          </Nav.Item>
          <Nav.Item>
            <Nav.Link
              active={activeTab === 'discovery'}
              onClick={() => setActiveTab('discovery')}
              eventKey="discovery"
            >
              Point Discovery ({discoveredPoints.length})
            </Nav.Link>
          </Nav.Item>
        </Nav>

        {activeTab === 'discovery' && (
          <>
            <div className="d-flex flex-wrap gap-2 align-items-center justify-content-between mb-3">
              <div className="text-muted">
                Last discovery:
                {' '}
                {lastDiscoveryAt ? formatLastSeen(lastDiscoveryAt) : 'Never'}
              </div>
              <div className="d-flex flex-wrap gap-2">
                <ActionButton
                  variant="primary"
                  size="sm"
                  onClick={handleDiscover}
                  disabled={loading || !device.enabled || discovering}
                >
                  {lastDiscoveryAt ? 'Scan Again' : 'Discover'}
                </ActionButton>
                <ActionButton
                  size="sm"
                  onClick={() => handleManageSelected(Array.from(selectedKeys))}
                  disabled={loading || selectedKeys.size === 0}
                >
                  Add Selected to Managed
                </ActionButton>
                <ActionButton
                  size="sm"
                  onClick={() => handleManageSelected(selectableKeys)}
                  disabled={loading || selectableKeys.length === 0}
                >
                  Add All Visible to Managed
                </ActionButton>
              </div>
            </div>

            {discovering && (
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

            <input
              type="search"
              className="form-control mb-3"
              placeholder="Filter by name, type, or instance…"
              value={discoveryFilter}
              onChange={(e) => setDiscoveryFilter(e.target.value)}
            />

            <DataTable
              columns={discoveryColumns}
              rows={filteredDiscovered}
              rowKey={(p) => p.pointKey}
              pageSize={15}
              emptyMessage="No discovered points yet. Run discovery to scan this device."
            />
          </>
        )}

        {activeTab === 'managed' && (
          <>
            <div className="d-flex flex-wrap gap-2 justify-content-end mb-3">
              <ActionButton
                size="sm"
                variant="danger"
                onClick={handleUnmanageAll}
                disabled={loading || managedPoints.length === 0}
              >
                Unmanage All Points
              </ActionButton>
            </div>
            <DataTable
              columns={managedColumns}
              rows={managedPoints}
              rowKey={(p) => p.id}
              pageSize={15}
              emptyMessage="No managed points yet. Discover points and add the ones you want to manage."
            />
          </>
        )}
      </Modal.Body>
    </Modal>
  );
}
