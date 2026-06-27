import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Col, Row } from 'react-bootstrap';
import { api } from '../api/client';
import KvRow from '../components/common/KvRow';
import PanelCard from '../components/common/PanelCard';
import StatusBadge from '../components/common/StatusBadge';
import LoadingState from '../components/common/LoadingState';

function formatLastSeen(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString();
}

function isMstpDevice(device) {
  return device.transport === 'BACnet MS/TP' || device.transport === 'mstp';
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

const SEGMENTATION_LABELS = {
  0: 'Segmented Both',
  1: 'Segmented Transmit',
  2: 'Segmented Receive',
  3: 'No Segmentation',
};

const MSTP_STATUS_LABELS = {
  seen_latest_scan: 'Seen in latest scan',
  recently_seen: 'Recently seen',
  stale: 'Not rediscovered (stale)',
  never_confirmed: 'Unknown / never confirmed',
};

export default function DeviceDetailPage() {
  const { id } = useParams();
  const [device, setDevice] = useState(null);
  const [health, setHealth] = useState(null);
  const [objects, setObjects] = useState(null);
  const [bacnetDetails, setBacnetDetails] = useState(null);
  const [error, setError] = useState(null);
  const [loadingDetails, setLoadingDetails] = useState(false);

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

        if (!isMstpDevice(deviceRes.device) && deviceRes.device.address) {
          setLoadingDetails(true);
          api.readBacnetDevice(deviceRes.device.address, deviceRes.device.deviceInstance)
            .then(setBacnetDetails)
            .catch(() => setBacnetDetails(null))
            .finally(() => setLoadingDetails(false));
        }
      })
      .catch((err) => setError(err.message));
  }, [id]);

  if (error) return <div className="alert-sentry alert-sentry-error">{error}</div>;
  if (!device) return <LoadingState message="Loading device details…" />;

  const summary = objects?.objectSummary || {};
  const details = bacnetDetails || {};
  const deviceTitle = device.objectName || `Device ${device.deviceInstance}`;
  const mstp = isMstpDevice(device);

  return (
    <>
      <Row>
        <Col lg={4}>
          <PanelCard title="Device Information">
            <KvRow label="Device Instance" value={device.deviceInstance} />
            {!mstp && (
              <>
                <KvRow label="Object Name" value={details.objectName || device.objectName || '—'} />
                <KvRow label="Vendor" value={details.vendorName || device.vendor || device.vendorName || '—'} />
                <KvRow label="Model" value={details.modelName || device.model || device.modelName || '—'} />
                <KvRow label="Address" value={device.address} />
              </>
            )}
            {mstp && (
              <>
                <KvRow label="MS/TP MAC Address" value={device.mstpMacAddress ?? device.macAddress ?? '—'} />
                <KvRow
                  label="Rediscovery Status"
                  value={MSTP_STATUS_LABELS[device.mstpStatus] || MSTP_STATUS_LABELS.never_confirmed}
                />
                <KvRow label="Missed Scans" value={device.missedScans ?? 0} />
                <KvRow
                  label="Configured Network Number"
                  value={device.configuredNetworkNumber ?? device.networkNumber ?? '—'}
                />
                <KvRow
                  label="Unverified routed source network"
                  value={device.sourceNetworkRaw != null ? device.sourceNetworkRaw : '—'}
                />
                <KvRow label="Discovery Session" value={device.discoverySessionId || '—'} />
                <KvRow label="First Seen" value={formatLastSeen(device.firstSeenAt)} />
                <KvRow label="Last Seen" value={formatLastSeen(device.lastSeenAt || device.lastSeen)} />
                <KvRow label="Sightings" value={device.sightings ?? '—'} />
                <KvRow label="Vendor ID" value={device.vendorId ?? '—'} />
                <KvRow label="Max APDU" value={device.maxApdu ?? '—'} />
                <KvRow
                  label="Segmentation"
                  value={device.segmentation != null
                    ? (SEGMENTATION_LABELS[device.segmentation] ?? device.segmentation)
                    : '—'}
                />
                <KvRow label="Source" value="BACnet MS/TP Discovery" />
              </>
            )}
            <KvRow label="Network" value={device.network} />
            <KvRow label="Protocol" value={device.protocol} />
            {!mstp && <KvRow label="Source" value={device.source || '—'} />}
            {!mstp && (
              <KvRow label="Last Seen" value={formatLastSeen(device.lastSeen || device.lastSeenAt)} />
            )}
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
              value={health?.responseTimeMs != null ? `${health.responseTimeMs}ms` : (device.lastResponseMs != null ? `${device.lastResponseMs}ms` : '—')}
            />
            <KvRow label="Communication Errors" value={health?.communicationErrors ?? '—'} />
          </PanelCard>

          {!mstp && (
            <PanelCard title="BACnet Device Properties" className="mt-3">
              {loadingDetails && <p style={{ color: '#58677d', margin: 0 }}>Reading device properties…</p>}
              {!loadingDetails && !bacnetDetails && (
                <p style={{ color: '#58677d', margin: 0 }}>Could not read BACnet device properties.</p>
              )}
              {bacnetDetails && (
                <>
                  <KvRow label="Description" value={details.description || '—'} />
                  <KvRow label="Firmware Revision" value={details.firmwareRevision || '—'} />
                  <KvRow label="Application Software" value={details.applicationSoftwareVersion || '—'} />
                  <KvRow label="Protocol Version" value={details.protocolVersion || '—'} />
                  <KvRow label="Protocol Revision" value={details.protocolRevision || '—'} />
                  <KvRow label="Object List Count" value={details.objectListCount ?? '—'} />
                  {details.durationMs != null && (
                    <KvRow label="Read Duration" value={`${details.durationMs}ms`} />
                  )}
                </>
              )}
            </PanelCard>
          )}
        </Col>

        <Col lg={4}>
          <PanelCard title="Object Summary">
            {mstp ? (
              <p style={{ color: '#58677d', margin: 0 }}>Object discovery not implemented yet.</p>
            ) : (
              <>
                {OBJECT_LABELS.map(([key, label]) => (
                  <KvRow key={key} label={label} value={summary[key] ?? 0} />
                ))}
                {objects && (
                  <KvRow label="Total Objects" value={objects.totalObjects} />
                )}
                {details.objectListCount != null && (
                  <KvRow label="Device Object List" value={details.objectListCount} />
                )}
              </>
            )}
          </PanelCard>
        </Col>
      </Row>

      <PanelCard title={`Actions — ${deviceTitle}`} className="mt-3">
        <div className="action-bar">
          <Link to="/devices" className="btn btn-sentry-secondary">
            Back to Devices
          </Link>
          <Link to="/bacnet/ip" className="btn btn-sentry-secondary">
            BACnet
          </Link>
          {!mstp && (
            <>
              <button type="button" className="btn btn-sentry-primary" disabled title="Object browser — not implemented in DEV-1">
                Browse Objects
              </button>
              <button type="button" className="btn btn-sentry-secondary" disabled title="Live read — not implemented in DEV-1">
                Live Read
              </button>
            </>
          )}
        </div>
      </PanelCard>
    </>
  );
}
