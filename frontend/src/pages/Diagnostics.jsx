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
      <PageHeader title="Diagnostics" subtitle="Network, protocol, and hardware diagnostic tests" />

      <Row>
        <Col lg={6}>
          <PanelCard title="Network Diagnostics">
            <KvRow label="Ping Test" value={network.ping.success ? `${network.ping.latencyMs}ms` : 'Failed'} />
            <KvRow label="Gateway Reachability" value={network.gateway.success ? `${network.gateway.latencyMs}ms` : 'Failed'} />
            <KvRow label="DNS Test" value={network.dns.resolvedIp} />
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

        <Col lg={6}>
          <PanelCard title="BACnet Diagnostics">
            <KvRow label="IP RX Packets" value={bacnet.ipRxPackets.toLocaleString()} />
            <KvRow label="IP TX Packets" value={bacnet.ipTxPackets.toLocaleString()} />
            <KvRow label="MS/TP RX Packets" value={bacnet.mstpRxPackets.toLocaleString()} />
            <KvRow label="MS/TP TX Packets" value={bacnet.mstpTxPackets.toLocaleString()} />
            <KvRow label="Timeouts" value={bacnet.timeouts} />
            <KvRow label="Retries" value={bacnet.retries} />
            <KvRow label="CRC Errors" value={bacnet.crcErrors} />
            <KvRow label="Last BACnet Error" value={bacnet.lastError} />
          </PanelCard>
        </Col>
      </Row>

      <Row>
        <Col lg={6}>
          <PanelCard title="Modbus Diagnostics">
            <div className="kv-row">
              <span className="kv-label">TCP Status</span>
              <span className="kv-value"><StatusBadge status={modbus.tcpStatus} /></span>
            </div>
            <div className="kv-row">
              <span className="kv-label">RTU Status</span>
              <span className="kv-value"><StatusBadge status={modbus.rtuStatus} /></span>
            </div>
            <KvRow label="Last Response Time" value={`${modbus.lastResponseTimeMs}ms`} />
            <KvRow label="Error Count" value={modbus.errorCount} />
          </PanelCard>
        </Col>

        <Col lg={6}>
          <PanelCard title="GPIO Diagnostics">
            {Object.values(gpio).map((item) => (
              <div key={item.name} className="kv-row">
                <span className="kv-label">{item.name}</span>
                <span className="kv-value">
                  <StatusBadge
                    status={item.state === 'on' || item.state === 'blink' ? 'on' : item.state === 'released' ? 'off' : item.state}
                    label={item.state}
                  />
                </span>
              </div>
            ))}
          </PanelCard>
        </Col>
      </Row>
    </>
  );
}
