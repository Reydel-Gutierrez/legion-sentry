import { useEffect, useState } from 'react';
import { Col, Row } from 'react-bootstrap';
import { api } from '../api/client';
import KvRow from '../components/common/KvRow';
import MetricBar from '../components/common/MetricBar';
import PanelCard from '../components/common/PanelCard';
import StatusBadge from '../components/common/StatusBadge';
import PageHeader from '../components/common/PageHeader';

function formatTimestamp(iso) {
  return new Date(iso).toLocaleString();
}

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

  const { hardware, network, serial, bacnet, modbus, gpio, recentSerialLogs } = data;
  const tempMax = 85;

  return (
    <>
      <PageHeader title="Diagnostics" subtitle="Real hardware metrics, network interfaces, serial ports, and protocol status" />

      <Row>
        <Col lg={6}>
          <PanelCard title="Hardware Metrics">
            <MetricBar label="CPU Load" value={hardware?.cpuLoad?.percent} barClass="bar-cpu" />
            <MetricBar label="Memory" value={hardware?.memory?.usagePercent} barClass="bar-memory" />
            <MetricBar label="Temperature" value={hardware?.temperature} barClass="bar-temp" unit="°C" max={tempMax} />
            <MetricBar label="Disk" value={hardware?.disk?.usagePercent} barClass="bar-storage" />
            <KvRow label="Hostname" value={hardware?.hostname} />
            <KvRow label="Hardware Profile" value={hardware?.hardwareProfile} />
            <KvRow label="Runtime Mode" value={hardware?.runtimeMode} />
          </PanelCard>
        </Col>

        <Col lg={6}>
          <PanelCard title="Network Interfaces">
            {(network?.interfaces || []).map((iface) => (
              <div key={iface.name}>
                <KvRow
                  label={iface.name}
                  value={(
                    <>
                      <StatusBadge status={iface.status} label={iface.status} />
                      {iface.addresses?.map((a) => (
                        <span key={a.address} className="mono" style={{ marginLeft: '0.5rem' }}>{a.address}</span>
                      ))}
                    </>
                  )}
                />
              </div>
            ))}
            <KvRow label="Primary IP" value={network?.primaryIp || '—'} />
            {pingResult && (
              <div className={`alert-sentry alert-sentry-${pingResult.success ? 'success' : 'error'} mt-2`}>
                Ping {pingResult.target}: {pingResult.success ? `avg ${pingResult.avgMs ?? '—'}ms, loss ${pingResult.packetLoss}%` : `failed — ${pingResult.error || 'no response'}`}
              </div>
            )}
            <div className="action-bar" style={{ marginTop: '0.75rem', paddingTop: '0.75rem' }}>
              <button type="button" className="btn btn-sentry-secondary" onClick={handlePing} disabled={loading}>
                Run Ping Test
              </button>
            </div>
          </PanelCard>
        </Col>
      </Row>

      <Row>
        <Col lg={6}>
          <PanelCard title="Serial Ports">
            {(serial?.ports || []).filter((p) => p.exists).map((port) => (
              <KvRow
                key={port.path}
                label={port.path}
                value={`${port.currentBaudRate ?? '—'} baud${port.recommendedForRs485 ? ' (RS485 recommended)' : ''}`}
              />
            ))}
            {serial?.lastOpenCheck && (
              <>
                <KvRow
                  label="Last Open Check"
                  value={serial.lastOpenCheck.success ? `OK (${serial.lastOpenCheck.responseTimeMs}ms)` : `Failed — ${serial.lastOpenCheck.error}`}
                />
                <KvRow label="Checked At" value={formatTimestamp(serial.lastOpenCheck.checkedAt)} />
              </>
            )}
          </PanelCard>
        </Col>

        <Col lg={6}>
          <PanelCard title="BACnet / Protocol Status">
            <KvRow label="BACnet/IP Discovery" value={<StatusBadge status="ready" label="Implemented" />} />
            <KvRow label="BACnet MS/TP Discovery" value={<StatusBadge status="not_implemented" label="Not implemented" />} />
            <KvRow label="Routing" value={bacnet?.routingStatus || 'Not implemented'} />
            <KvRow label="Modbus" value={modbus?.note || 'Not implemented'} />
          </PanelCard>
        </Col>
      </Row>

      <Row>
        <Col lg={6}>
          <PanelCard title="BACnet/IP Discovery Logs">
            {(bacnet?.recentLogs || []).length === 0 ? (
              <p style={{ color: '#58677d', margin: 0 }}>No BACnet discovery logs yet</p>
            ) : (
              bacnet.recentLogs.map((log) => (
                <div key={log.id} className="event-row">
                  <span className="event-ts">{formatTimestamp(log.timestamp)}</span>
                  <span className={`log-level level-${log.level}`}>{log.level}</span>
                  <span className="event-message">{log.message}</span>
                </div>
              ))
            )}
          </PanelCard>
        </Col>

        <Col lg={6}>
          <PanelCard title="Serial Open-Check Logs">
            {(recentSerialLogs || []).length === 0 ? (
              <p style={{ color: '#58677d', margin: 0 }}>No serial check logs yet</p>
            ) : (
              recentSerialLogs.map((log) => (
                <div key={log.id} className="event-row">
                  <span className="event-ts">{formatTimestamp(log.timestamp)}</span>
                  <span className={`log-level level-${log.level}`}>{log.level}</span>
                  <span className="event-message">{log.message}</span>
                </div>
              ))
            )}
          </PanelCard>
        </Col>
      </Row>

      <PanelCard title="GPIO">
        <p style={{ color: '#58677d', margin: '0 0 0.5rem' }}>GPIO LED/button monitoring not implemented in DEV-1.</p>
        {Object.values(gpio || {}).map((item) => (
          <div key={item.name} className="kv-row">
            <span className="kv-label">{item.name}</span>
            <span className="kv-value">
              <StatusBadge status="not_implemented" label="Not implemented" />
            </span>
          </div>
        ))}
      </PanelCard>
    </>
  );
}
