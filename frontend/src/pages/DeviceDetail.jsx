import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Col, Row } from 'react-bootstrap';
import { api } from '../api/client';
import KvRow from '../components/common/KvRow';
import PanelCard from '../components/common/PanelCard';
import StatusBadge from '../components/common/StatusBadge';
import PageHeader from '../components/common/PageHeader';

function formatLastSeen(iso) {
  return new Date(iso).toLocaleString();
}

const OBJECT_LABELS = [
  ['ai', 'AI'],
  ['ao', 'AO'],
  ['av', 'AV'],
  ['bi', 'BI'],
  ['bo', 'BO'],
  ['bv', 'BV'],
  ['schedules', 'Schedules'],
  ['trendLogs', 'Trend Logs'],
  ['files', 'Files'],
];

export default function DeviceDetailPage() {
  const { id } = useParams();
  const [device, setDevice] = useState(null);
  const [health, setHealth] = useState(null);
  const [objects, setObjects] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    Promise.all([
      api.getDevice(id),
      api.getDeviceHealth(id),
      api.getDeviceObjects(id),
    ])
      .then(([deviceRes, healthRes, objectsRes]) => {
        setDevice(deviceRes.device);
        setHealth(healthRes);
        setObjects(objectsRes);
      })
      .catch((err) => setError(err.message));
  }, [id]);

  if (error) return <div className="alert-sentry alert-sentry-error">{error}</div>;
  if (!device) return <div className="loading-state">Loading device details…</div>;

  const summary = objects?.objectSummary || {};

  return (
    <>
      <PageHeader
        title={device.objectName}
        subtitle={`Device Instance ${device.deviceInstance} · ${device.network}`}
      >
        <Link to="/devices" className="btn btn-sentry-secondary">
          Back to Devices
        </Link>
      </PageHeader>

      <Row>
        <Col lg={4}>
          <PanelCard title="Device Information">
            <KvRow label="Device Instance" value={device.deviceInstance} />
            <KvRow label="Object Name" value={device.objectName} />
            <KvRow label="Vendor" value={device.vendor} />
            <KvRow label="Model" value={device.model} />
            <KvRow label="Address" value={device.address} />
            <KvRow label="Network" value={device.network} />
            <KvRow label="Firmware" value={device.firmware} />
            <KvRow label="Last Seen" value={formatLastSeen(device.lastSeen)} />
          </PanelCard>
        </Col>

        <Col lg={4}>
          <PanelCard title="Health">
            <div className="kv-row">
              <span className="kv-label">Online Status</span>
              <span className="kv-value">
                <StatusBadge status={health?.status || device.status} />
              </span>
            </div>
            <KvRow
              label="Response Time"
              value={health?.responseTimeMs != null ? `${health.responseTimeMs}ms` : '—'}
            />
            <KvRow label="Communication Errors" value={health?.communicationErrors ?? '—'} />
          </PanelCard>
        </Col>

        <Col lg={4}>
          <PanelCard title="Object Summary">
            {OBJECT_LABELS.map(([key, label]) => (
              <KvRow key={key} label={label} value={summary[key] ?? 0} />
            ))}
            {objects && (
              <KvRow label="Total Objects" value={objects.totalObjects} />
            )}
          </PanelCard>
        </Col>
      </Row>

      <div className="action-bar">
        <button type="button" className="btn btn-sentry-primary" disabled title="Object browser — coming soon">
          Browse Objects
        </button>
        <button type="button" className="btn btn-sentry-secondary" disabled title="Live read — coming soon">
          Live Read
        </button>
        <Link to="/diagnostics" className="btn btn-sentry-secondary">
          Diagnostics
        </Link>
      </div>
    </>
  );
}
