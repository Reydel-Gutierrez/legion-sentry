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
  read_property: 'Read Property',
  discover_points: 'Discover Points',
  write_property: 'Write Property',
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

function statusChip(status) {
  const label = (status || 'unknown').replace(/_/g, ' ');
  return <StatusChip label={label} tone={STATUS_TONE[status] || 'neutral'} />;
}

export default function ExecutionPage() {
  const [status, setStatus] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([api.getExecutionStatus(), api.getExecutionJobs()])
      .then(([statusData, jobsData]) => {
        setStatus(statusData);
        setJobs(jobsData.jobs || []);
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

  const summary = status ? [
    { label: 'Queued', value: status.queuedJobs ?? 0 },
    { label: 'Active', value: status.activeJobs ?? 0, variant: 'warn' },
    { label: 'Completed', value: status.completedJobs ?? 0, variant: 'success' },
    { label: 'Failed', value: status.failedJobs ?? 0, variant: 'danger' },
  ] : [];

  const busState = status?.bus?.busState || 'idle';
  const pollingMode = status?.polling?.mode || 'disabled';
  const queueWarning = status?.queueHealth?.warning;

  const columns = [
    {
      key: 'status',
      header: 'Status',
      render: (job) => statusChip(job.status),
    },
    {
      key: 'type',
      header: 'Type',
      render: (job) => TYPE_LABELS[job.type] || job.type,
    },
    { key: 'source', header: 'Source' },
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
      key: 'startedAt',
      header: 'Started',
      render: (job) => formatTimestamp(job.startedAt),
    },
    {
      key: 'completedAt',
      header: 'Completed',
      render: (job) => formatTimestamp(job.completedAt),
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
        subtitle="MS/TP job scheduler — token timing, BACnet frames, retries, and status."
        summary={summary}
        actions={(
          <>
            <ActionButton size="sm" onClick={load} disabled={loading}>
              Refresh
            </ActionButton>
            <ActionButton
              size="sm"
              onClick={() => runAction(api.cancelQueuedExecutionJobs, 'Queued jobs cancelled.')}
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

      <SectionCard title="Queue Health" className="mb-3">
        <div className="d-flex flex-wrap gap-3 align-items-center mb-3">
          <StatusChip
            label={`Bus: ${BUS_STATE_LABELS[busState] || busState}`}
            tone={busState === 'idle' ? 'success' : busState === 'paused' ? 'warn' : 'warn'}
          />
          <StatusChip
            label={`Polling: ${POLLING_MODE_LABELS[pollingMode] || pollingMode}`}
            tone={pollingMode === 'running' ? 'success' : pollingMode === 'backpressure' ? 'warn' : 'neutral'}
          />
          {status?.executionPaused && (
            <StatusChip
              label={status.pauseMessage || 'Paused — discovery running'}
              tone="warn"
            />
          )}
        </div>
        <div className="d-flex flex-wrap gap-4 text-muted" style={{ fontSize: '0.85rem' }}>
          <span>
            Queued:
            {' '}
            {status?.queuedJobs ?? 0}
          </span>
          <span>
            Polling queued:
            {' '}
            {status?.pollingQueuedJobs ?? 0}
          </span>
          <span>
            Failed:
            {' '}
            {status?.failedJobs ?? 0}
          </span>
          <span>
            Pollable points:
            {' '}
            {status?.polling?.pollablePoints ?? 0}
          </span>
          <span>
            Backoff points:
            {' '}
            {status?.polling?.backoffPoints ?? 0}
          </span>
        </div>
        {status?.polling?.staleDevices?.length > 0 && (
          <p className="text-muted mt-3 mb-0" style={{ fontSize: '0.8rem' }}>
            Polling paused for
            {' '}
            {status.polling.staleDevices.length}
            {' '}
            stale device(s) — not recently seen on the trunk.
          </p>
        )}
      </SectionCard>

      <SectionCard title="Engine Status" className="mb-3">
        <div className="d-flex flex-wrap gap-3 align-items-center">
          <StatusChip
            label={status?.running ? 'Worker Active' : status?.executionPaused ? 'Worker Paused' : 'Worker Idle'}
            tone={status?.running ? 'warn' : status?.executionPaused ? 'warn' : 'neutral'}
          />
          {status?.activeJob && (
            <span className="text-muted">
              Active job:
              {' '}
              {TYPE_LABELS[status.activeJob.type] || status.activeJob.type}
              {' '}
              (
              {status.activeJob.id}
              )
            </span>
          )}
        </div>
        {status?.activeJob && (
          <div className="mt-3">
            <ProgressBar
              value={status.activeJob.progress}
              label="Active job progress"
              message={status.activeJob.progressMessage}
            />
          </div>
        )}
      </SectionCard>

      <SectionCard title={`Execution Jobs${loading ? ' — refreshing…' : ''}`}>
        <DataTable
          columns={columns}
          rows={jobs}
          rowKey={(job) => job.id}
          pageSize={15}
          emptyMessage="No execution jobs yet."
        />
      </SectionCard>
    </>
  );
}
