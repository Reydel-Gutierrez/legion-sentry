import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import PageHeader from '../components/common/PageHeader';
import SectionCard from '../components/common/SectionCard';
import StatusChip from '../components/common/StatusChip';
import ActionButton from '../components/common/ActionButton';
import DataTable from '../components/common/DataTable';
import ProgressBar from '../components/common/ProgressBar';

function formatTimestamp(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString();
}

const STATUS_TONE = {
  queued: 'neutral',
  waiting_token: 'warn',
  executing: 'warn',
  retrying: 'warn',
  completed: 'success',
  failed: 'danger',
  cancelled: 'neutral',
};

const TYPE_LABELS = {
  read_property: 'Manual Refresh',
  discover_points: 'Point Discovery',
  write_property: 'Write Property',
};

const SOURCE_LABELS = {
  ui: 'Operator',
  'point-discovery': 'Point Discovery',
  'legion-server': 'Legion Server',
};

const BUS_STATE_LABELS = {
  idle: 'Idle',
  discovery: 'Discovery',
  execution: 'Execution',
  paused: 'Paused',
};

const POLLING_MODE_LABELS = {
  running: 'Running',
  paused: 'Paused',
  backpressure: 'Backpressure',
  disabled: 'Disabled',
};

const QUALITY_TONE = {
  online: 'success',
  degraded: 'warn',
  stale: 'warn',
  offline: 'danger',
  unknown: 'neutral',
};

function statusChip(status) {
  const label = (status || 'unknown').replace(/_/g, ' ');
  return <StatusChip label={label} tone={STATUS_TONE[status] || 'neutral'} />;
}

function qualityChip(label, count) {
  if (!count) return null;
  return (
    <StatusChip
      key={label}
      label={`${label}: ${count}`}
      tone={QUALITY_TONE[label] || 'neutral'}
    />
  );
}

function jobTypeLabel(job) {
  if (job.type === 'read_property' && job.source === 'ui') {
    return TYPE_LABELS.read_property;
  }
  return TYPE_LABELS[job.type] || job.type;
}

export default function ExecutionPage() {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    api.getExecutionStatus()
      .then((statusData) => {
        setStatus(statusData);
      })
      .catch((err) => setMessage({ type: 'error', text: err.message }))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, 2000);
    return () => clearInterval(interval);
  }, [load]);

  const runAction = async (action, successText) => {
    try {
      await action();
      load();
      setMessage({ type: 'success', text: successText });
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    }
  };

  const handleCancel = async (job) => {
    try {
      await api.cancelExecutionJob(job.id);
      load();
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    }
  };

  const fieldOps = status?.fieldOperations || {};
  const background = status?.backgroundActivity || {};
  const fieldJobs = status?.fieldOperationJobs || [];

  const summary = status ? [
    { label: 'Field Queued', value: fieldOps.queued ?? 0 },
    { label: 'Field Active', value: fieldOps.active ?? 0, variant: 'warn' },
    { label: 'Background', value: background.totalActive ?? 0, variant: 'neutral' },
    { label: 'Failed', value: fieldOps.failed ?? 0, variant: 'danger' },
  ] : [];

  const busState = status?.bus?.busState || 'idle';
  const pollingMode = status?.polling?.mode || 'disabled';
  const queueWarning = status?.queueHealth?.warning;
  const pollingPaused = status?.polling?.paused;
  const deviceHealth = status?.deviceHealth || {};
  const pointQuality = status?.pointQualityCounts || status?.polling?.pointQualityCounts || {};
  const activeFieldJob = status?.activeJob && fieldJobs.some((j) => j.id === status.activeJob.id)
    ? status.activeJob
    : (fieldJobs.find((j) => ['queued', 'waiting_token', 'executing', 'retrying'].includes(j.status)) || null);

  const columns = [
    {
      key: 'status',
      header: 'Status',
      render: (job) => statusChip(job.status),
    },
    {
      key: 'type',
      header: 'Operation',
      render: (job) => jobTypeLabel(job),
    },
    {
      key: 'source',
      header: 'Source',
      render: (job) => SOURCE_LABELS[job.source] || job.source,
    },
    {
      key: 'device',
      header: 'Device',
      render: (job) => job.deviceLabel || job.managedDeviceId || '—',
    },
    {
      key: 'progress',
      header: 'Progress',
      render: (job) => (
        <ProgressBar
          value={job.progress}
          message={job.progressMessage}
          className="sentry-progress--compact"
        />
      ),
    },
    {
      key: 'message',
      header: 'Message',
      render: (job) => job.error || job.progressMessage || '—',
    },
    {
      key: 'createdAt',
      header: 'Created',
      render: (job) => formatTimestamp(job.createdAt),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (job) => (
        !['completed', 'failed', 'cancelled'].includes(job.status) ? (
          <ActionButton size="sm" onClick={() => handleCancel(job)} disabled={loading}>
            Cancel
          </ActionButton>
        ) : null
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Field Execution"
        subtitle="Discovery, point discovery, manual refresh, and background MS/TP activity."
        summary={summary}
        actions={(
          <>
            <ActionButton size="sm" onClick={load} disabled={loading}>
              Refresh
            </ActionButton>
            {pollingPaused ? (
              <ActionButton
                size="sm"
                onClick={() => runAction(api.resumePolling, 'Point polling resumed.')}
                disabled={loading}
              >
                Resume Polling
              </ActionButton>
            ) : (
              <ActionButton
                size="sm"
                onClick={() => runAction(api.pausePolling, 'Point polling paused.')}
                disabled={loading}
              >
                Pause Polling
              </ActionButton>
            )}
            <ActionButton
              size="sm"
              onClick={() => runAction(api.cancelQueuedPollingJobs, 'Queued polling jobs cancelled.')}
              disabled={loading}
            >
              Cancel Polling Queue
            </ActionButton>
            <ActionButton
              size="sm"
              onClick={() => runAction(api.cancelQueuedExecutionJobs, 'Queued field jobs cancelled.')}
              disabled={loading}
            >
              Cancel Queued
            </ActionButton>
            <ActionButton
              size="sm"
              onClick={() => runAction(api.clearFailedExecutionJobs, 'Failed jobs cleared.')}
              disabled={loading}
            >
              Clear Failed
            </ActionButton>
            <ActionButton
              size="sm"
              onClick={() => runAction(api.clearCompletedExecutionJobs, 'Completed jobs cleared.')}
              disabled={loading}
            >
              Clear Completed
            </ActionButton>
          </>
        )}
      />

      {message && (
        <div className={`alert-sentry alert-sentry-${message.type === 'error' ? 'error' : 'success'} mb-3`}>
          {message.text}
        </div>
      )}

      {queueWarning && (
        <div className="alert-sentry alert-sentry-error mb-3">
          {queueWarning}
        </div>
      )}

      <SectionCard title="Current Background Polling" className="mb-3">
        <div className="d-flex flex-wrap gap-3 align-items-center mb-3">
          <StatusChip
            label={`Bus: ${BUS_STATE_LABELS[busState] || busState}`}
            tone={busState === 'idle' ? 'success' : 'warn'}
          />
          <StatusChip
            label={`Polling: ${POLLING_MODE_LABELS[pollingMode] || pollingMode}`}
            tone={pollingMode === 'running' ? 'success' : pollingMode === 'backpressure' ? 'warn' : 'neutral'}
          />
          <StatusChip
            label={`Device Health: ${deviceHealth.mode || '—'}`}
            tone={deviceHealth.mode === 'running' ? 'success' : 'neutral'}
          />
          {status?.executionPaused && (
            <StatusChip
              label={status.pauseMessage || 'Paused — discovery running'}
              tone="warn"
            />
          )}
        </div>
        <div className="d-flex flex-wrap gap-4 text-muted" style={{ fontSize: '0.85rem' }}>
          <span>Polling queued: {background.polling?.queued ?? 0}</span>
          <span>Polling active: {background.polling?.active ?? 0}</span>
          <span>Health queued: {background.deviceHealth?.queued ?? 0}</span>
          <span>Due points: {status?.polling?.duePoints ?? 0}</span>
          <span>Pollable points: {status?.polling?.pollablePoints ?? 0}</span>
        </div>
        {background.polling?.activeJob && (
          <div className="mt-3">
            <p className="text-muted mb-1" style={{ fontSize: '0.8rem' }}>
              Active poll:
              {' '}
              {background.polling.activeJob.deviceLabel || '—'}
            </p>
            <ProgressBar
              value={background.polling.activeJob.progress}
              message={background.polling.activeJob.progressMessage}
              className="sentry-progress--compact"
            />
          </div>
        )}
        <div className="d-flex flex-wrap gap-2 mt-3">
          {Object.entries(deviceHealth.deviceQualityCounts || {}).map(([label, count]) => (
            qualityChip(label, count)
          ))}
          {Object.entries(pointQuality).map(([label, count]) => (
            qualityChip(label.replace(/_/g, ' '), count)
          ))}
        </div>
        {status?.polling?.lastTick?.backpressure && (
          <p className="text-muted mt-3 mb-0" style={{ fontSize: '0.8rem' }}>
            Backpressure active — polling throttled because the execution queue is at limit.
          </p>
        )}
      </SectionCard>

      <SectionCard title="Engine Status" className="mb-3">
        <div className="d-flex flex-wrap gap-3 align-items-center">
          <StatusChip
            label={status?.running ? 'Worker Active' : status?.executionPaused ? 'Worker Paused' : 'Worker Idle'}
            tone={status?.running ? 'warn' : status?.executionPaused ? 'warn' : 'neutral'}
          />
          {activeFieldJob && (
            <span className="text-muted">
              Active field operation:
              {' '}
              {jobTypeLabel(activeFieldJob)}
              {' '}
              (
              {SOURCE_LABELS[activeFieldJob.source] || activeFieldJob.source}
              )
            </span>
          )}
        </div>
        {activeFieldJob && (
          <div className="mt-3">
            <ProgressBar
              value={activeFieldJob.progress}
              label="Active field operation"
              message={activeFieldJob.progressMessage}
            />
          </div>
        )}
      </SectionCard>

      <SectionCard title={`Field Operations${loading ? ' — refreshing…' : ''}`}>
        <p className="text-muted mb-3" style={{ fontSize: '0.8rem' }}>
          Point discovery, manual refresh, and future write/download operations.
          Background polling and device health heartbeats are summarized above.
        </p>
        <DataTable
          columns={columns}
          rows={fieldJobs}
          rowKey={(job) => job.id}
          pageSize={15}
          emptyMessage="No field operations yet. Run discovery or point discovery from Managed Devices."
        />
      </SectionCard>
    </>
  );
}
