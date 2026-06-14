import { useEffect, useState } from 'react';
import { Col, Row } from 'react-bootstrap';
import { api } from '../api/client';
import KvRow from '../components/common/KvRow';
import PanelCard from '../components/common/PanelCard';
import StatusBadge from '../components/common/StatusBadge';
import PageHeader from '../components/common/PageHeader';

export default function DiagnosticsPage() {
  const [data, setData] = useState(null);
  const [pingResult, setPingResult] = useState(null);
  const [loading, setLoading] = useState(false);

  const load = () => api.getDiagnostics().then(setData);

  useEffect(() => { load().catch(console.error); }, []);

  const handlePing = async () => {
    setLoading(true);
    try {
      const result = await api.runPing('8.8.8.8');
      setPingResult(result);
      load();
    } finally {
      setLoading(false);
    }
  };

  if (!data) return <div className="loading-state">Loading diagnostics…</div>;

  const { network, bacnet, modbus, gpio } = data;

  return (
    <>
      <PageHeader title="Diagnostics" subtitle="Network, protocol, and hardware diagnostic status" />

      <Row>
        <Col lg={4}>
          <PanelCard title="Network Diagnostics">
            <KvRow label="Ping (8.8.8.8)" value={network.ping.success ? `${network.ping.latencyMs}ms` : 'Failed'} />
            <KvRow label="DNS (google.com)" value={network.dns.resolvedIp} />
            <KvRow label="Gateway (192.168.1.1)" value={network.gateway.success ? `${network.gateway.latencyMs}ms` : 'Failed'} />
            {pingResult && (
              <div className="alert-sentry alert-sentry-success mt-2">
                Ping {pingResult.target}: avg {pingResult.avgMs}ms, loss {pingResult.packetLoss}%
              </div>
            )}
            <div className="action-bar" style={{ marginTop: '0.75rem', paddingTop: '0.75rem' }}>
              <button type="button" className="btn btn-sentry-secondary" onClick={handlePing} disabled={loading}>
                Run Ping Test
              </button>
            </div>
          </PanelCard>
        </Col>

        <Col lg={4}>
          <PanelCard title="BACnet Diagnostics">
            <KvRow label="IP Devices Discovered" value={bacnet.ipDevicesDiscovered} />
            <KvRow label="MS/TP Bus Status" value={bacnet.mstpBusStatus} />
            <KvRow label="RX Count" value={bacnet.rxCount.toLocaleString()} />
            <KvRow label="TX Count" value={bacnet.txCount.toLocaleString()} />
            <KvRow label="Error Count" value={bacnet.errorCount} />
            <KvRow label="Last Error" value={bacnet.lastError} />
          </PanelCard>
        </Col>

        <Col lg={4}>
          <PanelCard title="Modbus Diagnostics">
            <div className="kv-row">
              <span className="kv-label">RTU Status</span>
              <span className="kv-value"><StatusBadge status={modbus.rtuStatus} /></span>
            </div>
            <div className="kv-row">
              <span className="kv-label">TCP Status</span>
              <span className="kv-value"><StatusBadge status={modbus.tcpStatus} /></span>
            </div>
            <KvRow label="Last Response Time" value={`${modbus.lastResponseTimeMs}ms`} />
            <KvRow label="Error Count" value={modbus.errorCount} />
          </PanelCard>
        </Col>
      </Row>

      <PanelCard title="GPIO / LED Diagnostics">
        <Row>
          {Object.values(gpio).map((item) => (
            <Col key={item.name} sm={6} md={4} lg={3}>
              <div className="kv-row">
                <span className="kv-label">{item.name}</span>
                <span className="kv-value">
                  <StatusBadge
                    status={item.state === 'on' || item.state === 'blink' ? 'on' : item.state === 'released' ? 'off' : item.state}
                    label={item.state}
                  />
                </span>
              </div>
            </Col>
          ))}
        </Row>
      </PanelCard>
    </>
  );
}
