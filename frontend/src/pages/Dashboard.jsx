import { useEffect, useState } from 'react';
import { Col, Row } from 'react-bootstrap';
import { api } from '../api/client';
import KvRow from '../components/common/KvRow';
import MetricBar from '../components/common/MetricBar';
import PanelCard from '../components/common/PanelCard';
import ServiceStatusRow from '../components/common/ServiceStatusRow';
import StatusBadge from '../components/common/StatusBadge';
import PageHeader from '../components/common/PageHeader';

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
  if (!data) return <div className="loading-state">Loading device status…</div>;

  const { identity, system, interfaces, services } = data;

  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle="Device identity, system health, interfaces, and service status"
      />

      <Row>
        <Col lg={4}>
          <PanelCard title="Device Identity">
            <KvRow label="Product" value={identity.product} />
            <KvRow label="Hardware Profile" value={identity.hardwareProfile} />
            <KvRow label="Hostname" value={identity.hostname} />
            <KvRow label="Firmware Version" value={identity.firmwareVersion} />
            <KvRow label="Product Code" value={identity.productCode} />
          </PanelCard>
        </Col>

        <Col lg={4}>
          <PanelCard title="System Status">
            <MetricBar label="CPU Usage" value={system.cpuUsage} barClass="bar-cpu" />
            <MetricBar label="Memory Usage" value={system.memoryUsage} barClass="bar-memory" />
            <MetricBar label="Storage Usage" value={system.storageUsage} barClass="bar-storage" />
            <MetricBar label="Temperature" value={system.temperature} barClass="bar-temp" />
            <KvRow label="Uptime" value={system.uptime} />
          </PanelCard>
        </Col>

        <Col lg={4}>
          <PanelCard title="Interfaces">
            <div className="kv-row">
              <span className="kv-label">ETH0</span>
              <span className="kv-value">
                <StatusBadge status={interfaces.eth0.status} label={interfaces.eth0.link} />
              </span>
            </div>
            <KvRow label="ETH0 IP" value={interfaces.eth0.ip} />
            <div className="kv-row">
              <span className="kv-label">WiFi</span>
              <span className="kv-value">
                <StatusBadge status={interfaces.wifi.status} />
              </span>
            </div>
            <div className="kv-row">
              <span className="kv-label">RS485-1</span>
              <span className="kv-value">
                <StatusBadge status={interfaces.rs485.status} label={interfaces.rs485.port} />
              </span>
            </div>
            <div className="kv-row">
              <span className="kv-label">GPIO</span>
              <span className="kv-value">
                <StatusBadge status={interfaces.gpio.status} label={`${interfaces.gpio.leds} LEDs`} />
              </span>
            </div>
          </PanelCard>
        </Col>
      </Row>

      <PanelCard title="Services">
        <Row>
          <Col md={6}>
            <ServiceStatusRow name={services.bacnetIp.name} status={services.bacnetIp.status} detail={`UDP ${services.bacnetIp.port}`} />
            <ServiceStatusRow name={services.bacnetMstp.name} status={services.bacnetMstp.status} detail={services.bacnetMstp.port} />
            <ServiceStatusRow name={services.modbusTcp.name} status={services.modbusTcp.status} detail={`TCP ${services.modbusTcp.port}`} />
          </Col>
          <Col md={6}>
            <ServiceStatusRow name={services.modbusRtu.name} status={services.modbusRtu.status} detail={services.modbusRtu.port} />
            <ServiceStatusRow name={services.mqtt.name} status={services.mqtt.status} detail={services.mqtt.port ? `Port ${services.mqtt.port}` : null} />
            <ServiceStatusRow name={services.diagnostics.name} status={services.diagnostics.status} />
          </Col>
        </Row>
      </PanelCard>
    </>
  );
}
