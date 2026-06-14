import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Col, Row } from 'react-bootstrap';
import { api } from '../api/client';
import MetricBar from '../components/common/MetricBar';
import PanelCard from '../components/common/PanelCard';
import ServiceStatusRow from '../components/common/ServiceStatusRow';
import PageHeader from '../components/common/PageHeader';

function formatTimestamp(iso) {
  return new Date(iso).toLocaleString();
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
  if (!data) return <div className="loading-state">Loading router status…</div>;

  const { system, services, devices, recentEvents } = data;

  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle="Router health, device status, and service overview"
      />

      <Row className="g-3 mb-3">
        <Col sm={6} lg={3}>
          <div className="stat-card">
            <div className="stat-card-label">BACnet Devices</div>
            <div className="stat-card-value">{devices.bacnetDevices}</div>
          </div>
        </Col>
        <Col sm={6} lg={3}>
          <div className="stat-card stat-card--success">
            <div className="stat-card-label">Online Devices</div>
            <div className="stat-card-value">{devices.onlineDevices}</div>
          </div>
        </Col>
        <Col sm={6} lg={3}>
          <div className="stat-card stat-card--danger">
            <div className="stat-card-label">Offline Devices</div>
            <div className="stat-card-value">{devices.offlineDevices}</div>
          </div>
        </Col>
        <Col sm={6} lg={3}>
          <div className="stat-card">
            <div className="stat-card-label">MS/TP Networks</div>
            <div className="stat-card-value">{devices.mstpNetworks}</div>
          </div>
        </Col>
      </Row>

      <Row>
        <Col lg={6}>
          <PanelCard title="Service Status">
            <ServiceStatusRow name={services.bacnetIp.name} status={services.bacnetIp.status} detail={`UDP ${services.bacnetIp.port}`} />
            <ServiceStatusRow name={services.bacnetMstp.name} status={services.bacnetMstp.status} detail={services.bacnetMstp.port} />
            <ServiceStatusRow name={services.modbusTcp.name} status={services.modbusTcp.status} detail={`TCP ${services.modbusTcp.port}`} />
            <ServiceStatusRow name={services.modbusRtu.name} status={services.modbusRtu.status} detail={services.modbusRtu.port} />
            <ServiceStatusRow name={services.mqtt.name} status={services.mqtt.status} detail={services.mqtt.port ? `Port ${services.mqtt.port}` : null} />
          </PanelCard>
        </Col>

        <Col lg={6}>
          <PanelCard title="System Health">
            <MetricBar label="CPU" value={system.cpuUsage} barClass="bar-cpu" />
            <MetricBar label="Memory" value={system.memoryUsage} barClass="bar-memory" />
            <MetricBar label="Temperature" value={system.temperature} barClass="bar-temp" />
            <MetricBar label="Storage" value={system.storageUsage} barClass="bar-storage" />
            <div className="kv-row">
              <span className="kv-label">Uptime</span>
              <span className="kv-value">{system.uptime}</span>
            </div>
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
