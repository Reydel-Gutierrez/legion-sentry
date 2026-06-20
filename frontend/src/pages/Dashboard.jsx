import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Col, Row } from 'react-bootstrap';
import { api } from '../api/client';
import KvRow from '../components/common/KvRow';
import MetricBar from '../components/common/MetricBar';
import PanelCard from '../components/common/PanelCard';
import ServiceStatusRow from '../components/common/ServiceStatusRow';
import StatusBadge from '../components/common/StatusBadge';
import PageHeader from '../components/common/PageHeader';
import LoadingState from '../components/common/LoadingState';

function formatTimestamp(iso) {
  return new Date(iso).toLocaleString();
}

function deviceStat(value, scanned) {
  if (!scanned) return 'Not scanned yet';
  return value ?? 0;
}

export default function DashboardPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  const load = () => {
    api.getSystemStatus()
      .then(setData)
      .catch((err) => setError(err.message));
  };

  useEffect(() => {
    load();
    const interval = setInterval(load, 15000);
    return () => clearInterval(interval);
  }, []);

  if (error) return <div className="alert-sentry alert-sentry-error">{error}</div>;
  if (!data) return <LoadingState message="Loading system status…" />;

  const {
    system, services, devices, recentEvents, interfaces, serial, hostname, hardwareProfile, runtimeMode, topBar,
  } = data;
  const eth0 = interfaces?.eth0;
  const wlan0 = interfaces?.wlan0;
  const tempMax = 85;

  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle="Live hardware status, service configuration, and device overview"
      />

      {topBar?.liveDataNote && (
        <div className="alert-sentry alert-sentry-info mb-3">{topBar.liveDataNote}</div>
      )}

      <Row className="g-3 mb-3">
        <Col sm={6} lg={3}>
          <div className="stat-card">
            <div className="stat-card-label">BACnet Devices</div>
            <div className={`stat-card-value${!devices.scanned ? ' stat-card-value--muted' : ''}`}>
              {deviceStat(devices.bacnetDevices, devices.scanned)}
            </div>
          </div>
        </Col>
        <Col sm={6} lg={3}>
          <div className="stat-card stat-card--success">
            <div className="stat-card-label">Online Devices</div>
            <div className={`stat-card-value${!devices.scanned ? ' stat-card-value--muted' : ''}`}>
              {deviceStat(devices.onlineDevices, devices.scanned)}
            </div>
          </div>
        </Col>
        <Col sm={6} lg={3}>
          <div className="stat-card stat-card--danger">
            <div className="stat-card-label">Offline Devices</div>
            <div className={`stat-card-value${!devices.scanned ? ' stat-card-value--muted' : ''}`}>
              {deviceStat(devices.offlineDevices, devices.scanned)}
            </div>
          </div>
        </Col>
        <Col sm={6} lg={3}>
          <div className="stat-card">
            <div className="stat-card-label">MS/TP Networks</div>
            <div className={`stat-card-value${!devices.scanned ? ' stat-card-value--muted' : ''}`}>
              {deviceStat(devices.mstpNetworks, devices.scanned)}
            </div>
          </div>
        </Col>
      </Row>

      <Row>
        <Col lg={6}>
          <PanelCard title="Service Status">
            <ServiceStatusRow name={services.bacnetIp.name} status={services.bacnetIp.status} label={services.bacnetIp.label} />
            <ServiceStatusRow name={services.bacnetMstp.name} status={services.bacnetMstp.status} label={services.bacnetMstp.label} />
            <ServiceStatusRow name={services.modbusTcp.name} status={services.modbusTcp.status} label={services.modbusTcp.label} />
            <ServiceStatusRow name={services.modbusRtu.name} status={services.modbusRtu.status} label={services.modbusRtu.label} />
            <ServiceStatusRow name={services.mqtt.name} status={services.mqtt.status} label={services.mqtt.label} />
            {services.routing && (
              <ServiceStatusRow name={services.routing.name} status={services.routing.status} label={services.routing.label} />
            )}
          </PanelCard>
        </Col>

        <Col lg={6}>
          <PanelCard title="System Health">
            <MetricBar label="CPU Load" value={system.cpuUsage} barClass="bar-cpu" />
            <MetricBar label="Memory" value={system.memoryUsage} barClass="bar-memory" />
            <MetricBar label="Temperature" value={system.temperature} barClass="bar-temp" unit="°C" max={tempMax} />
            <MetricBar label="Disk" value={system.storageUsage} barClass="bar-storage" />
            <KvRow label="Uptime" value={system.uptime} />
            <KvRow label="OS" value={system.os} />
          </PanelCard>
        </Col>
      </Row>

      <Row className="mt-0">
        <Col lg={6}>
          <PanelCard title="Network">
            <KvRow
              label="eth0"
              value={(
                <>
                  <StatusBadge status={eth0?.status || 'not_present'} label={eth0?.status || 'not present'} />
                  {eth0?.ip && <span className="mono" style={{ marginLeft: '0.5rem' }}>{eth0.ip}</span>}
                </>
              )}
            />
            <KvRow
              label="wlan0"
              value={(
                <>
                  <StatusBadge status={wlan0?.status || 'not_present'} label={wlan0?.status || 'not present'} />
                  {wlan0?.ip && <span className="mono" style={{ marginLeft: '0.5rem' }}>{wlan0.ip}</span>}
                </>
              )}
            />
            <KvRow label="Primary IP" value={data.topBar?.ip || '—'} />
          </PanelCard>
        </Col>
        <Col lg={6}>
          <PanelCard title="Serial / RS485">
            <KvRow label="Recommended Port" value={serial?.recommendedPort || '—'} />
            <KvRow
              label="Port Open Check"
              value={(
                <StatusBadge
                  status={serial?.lastCheck?.success ? 'running' : serial?.lastCheck ? 'fault' : 'not_configured'}
                  label={serial?.lastCheck?.success ? 'OK' : serial?.lastCheck ? 'Failed' : 'Not checked'}
                />
              )}
            />
            {serial?.lastCheck && (
              <KvRow label="Last Check" value={`${serial.lastCheck.path} @ ${serial.lastCheck.baudRate} baud (${serial.lastCheck.responseTimeMs ?? '—'}ms)`} />
            )}
          </PanelCard>
        </Col>
      </Row>

      <Row className="mt-0">
        <Col lg={12}>
          <PanelCard title="Hardware">
            <Row>
              <Col md={6}>
                <KvRow label="Hostname" value={hostname} />
                <KvRow label="Hardware Profile" value={hardwareProfile} />
                <KvRow label="Runtime Mode" value={<StatusBadge status={runtimeMode === 'REAL HARDWARE' ? 'real hardware' : 'development'} label={runtimeMode} />} />
              </Col>
              <Col md={6}>
                <KvRow label="Product Code" value={data.topBar?.productCode} />
                <KvRow label="Firmware" value={data.identity?.firmwareVersion} />
              </Col>
            </Row>
          </PanelCard>
        </Col>
      </Row>

      <PanelCard title="Recent Events">
        {recentEvents.length === 0 ? (
          <p style={{ color: '#58677d', margin: 0 }}>No recent events</p>
        ) : (
          <div className="event-list">
            {recentEvents.map((event) => (
              <div key={event.id} className="event-row">
                <span className="event-ts">{formatTimestamp(event.timestamp)}</span>
                <span className={`log-level level-${event.level}`}>{event.level}</span>
                <span className="event-service">{event.service}</span>
                <span className="event-message">{event.message}</span>
              </div>
            ))}
          </div>
        )}
        <div className="action-bar" style={{ marginTop: '0.75rem', paddingTop: '0.75rem' }}>
          <Link to="/devices" className="btn btn-sentry-primary">View Devices</Link>
          <Link to="/diagnostics" className="btn btn-sentry-secondary">Diagnostics</Link>
          <Link to="/logs" className="btn btn-sentry-secondary">View Logs</Link>
        </div>
      </PanelCard>
    </>
  );
}
