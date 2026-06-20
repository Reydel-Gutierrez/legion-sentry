import { useEffect, useState } from 'react';
import { Col, Form, Row } from 'react-bootstrap';
import { api } from '../api/client';
import KvRow from '../components/common/KvRow';
import MetricBar from '../components/common/MetricBar';
import PanelCard from '../components/common/PanelCard';
import StatusBadge from '../components/common/StatusBadge';
import PageHeader from '../components/common/PageHeader';

function formatTimestamp(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString();
}

const DEFAULT_BAUD = 38400;
const DEFAULT_PORT = '/dev/serial0';

export default function DiagnosticsPage() {
  const [data, setData] = useState(null);
  const [serialDetail, setSerialDetail] = useState(null);
  const [monitor, setMonitor] = useState(null);
  const [pingResult, setPingResult] = useState(null);
  const [message, setMessage] = useState(null);
  const [loading, setLoading] = useState(false);
  const [baudRate, setBaudRate] = useState(DEFAULT_BAUD);
  const [portPath, setPortPath] = useState(DEFAULT_PORT);

  const load = async () => {
    const [diag, serial] = await Promise.all([
      api.getDiagnostics(),
      api.getSerialDetail(),
    ]);
    setData(diag);
    setSerialDetail(serial);
    setMonitor(serial.monitor || null);
    if (serial.defaultPort) setPortPath(serial.defaultPort);
  };

  useEffect(() => {
    load().catch(console.error);
    const interval = setInterval(() => {
      if (monitor?.running) {
        api.getSerialMonitorStatus().then(setMonitor).catch(() => {});
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [monitor?.running]);

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

  const handleConfigure = async () => {
    setLoading(true);
    setMessage(null);
    try {
      await api.configureSerial({ path: portPath, baudRate });
      await load();
      setMessage({ type: 'success', text: `Serial configured — ${portPath} at ${baudRate} baud` });
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setLoading(false);
    }
  };

  const handleOpenCheck = async () => {
    setLoading(true);
    setMessage(null);
    try {
      const result = await api.openSerialCheck({ path: portPath, baudRate });
      await load();
      setMessage({
        type: result.success ? 'success' : 'error',
        text: result.success
          ? `Open check OK — ${result.path} (${result.responseTimeMs}ms)`
          : `Open check failed — ${result.error}`,
      });
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setLoading(false);
    }
  };

  const handleStartMonitor = async () => {
    setLoading(true);
    setMessage(null);
    try {
      const result = await api.startSerialMonitor({ path: portPath, baudRate });
      setMonitor(result);
      setMessage({ type: 'success', text: `RS485 monitor started on ${portPath}` });
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setLoading(false);
    }
  };

  const handleStopMonitor = async () => {
    setLoading(true);
    try {
      const result = await api.stopSerialMonitor();
      setMonitor(result);
      await load();
      setMessage({ type: 'success', text: `Monitor stopped — RX ${result.rxBytes} bytes` });
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = () => {
    setLoading(true);
    load()
      .then(() => setMessage({ type: 'info', text: 'Diagnostics refreshed.' }))
      .catch((err) => setMessage({ type: 'error', text: err.message }))
      .finally(() => setLoading(false));
  };

  if (!data) return <div className="loading-state">Loading diagnostics…</div>;

  const { hardware, network, serial, bacnet, modbus, gpio, recentSerialLogs } = data;
  const recommended = serialDetail?.ports?.find((p) => p.recommendedForRs485 && p.exists)
    || serialDetail?.ports?.find((p) => p.exists);
  const tempMax = 85;

  return (
    <>
      <PageHeader title="Diagnostics" subtitle="Hardware, network, RS485 serial, and protocol status" />

      {message && (
        <div className={`alert-sentry alert-sentry-${message.type === 'error' ? 'error' : message.type === 'success' ? 'success' : 'info'}`}>
          {message.text}
        </div>
      )}

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
                Ping {pingResult.target}: {pingResult.success ? `avg ${pingResult.avgMs ?? pingResult.latencyMs ?? '—'}ms` : `failed — ${pingResult.error || 'no response'}`}
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
        <Col lg={12}>
          <PanelCard title="RS485 / Serial Diagnostics">
            <Row>
              <Col md={6}>
                <KvRow label="Recommended Port" value={serialDetail?.defaultPort || recommended?.path || '/dev/serial0'} />
                <KvRow label="Current Baud" value={recommended?.currentBaudRate ?? baudRate} />
                <KvRow label="Openable" value={recommended?.openable ? 'Yes' : 'No / not present'} />
                <KvRow label="Monitor Running" value={monitor?.running ? 'Yes' : 'No'} />
                <KvRow label="RX Bytes" value={monitor?.rxBytes ?? 0} />
                <KvRow label="TX Bytes" value={monitor?.txBytes ?? 0} />
                <KvRow label="Last Activity" value={formatTimestamp(monitor?.lastActivityAt)} />
                <KvRow label="Last Error" value={monitor?.lastError || '—'} />
              </Col>
              <Col md={6}>
                <Form.Group className="mb-2">
                  <Form.Label>Serial Port</Form.Label>
                  <Form.Select value={portPath} onChange={(e) => setPortPath(e.target.value)}>
                    {(serialDetail?.ports || []).filter((p) => p.exists).map((p) => (
                      <option key={p.path} value={p.path}>{p.path}{p.recommendedForRs485 ? ' (recommended)' : ''}</option>
                    ))}
                  </Form.Select>
                </Form.Group>
                <Form.Group className="mb-3">
                  <Form.Label>Baud Rate</Form.Label>
                  <Form.Select value={baudRate} onChange={(e) => setBaudRate(Number(e.target.value))}>
                    {[9600, 19200, 38400, 57600, 76800, 115200].map((r) => (
                      <option key={r} value={r}>{r}</option>
                    ))}
                  </Form.Select>
                </Form.Group>
                <div className="action-bar">
                  <button type="button" className="btn btn-sentry-secondary btn-sm" onClick={() => { setBaudRate(38400); handleConfigure(); }} disabled={loading}>
                    Configure 38400
                  </button>
                  <button type="button" className="btn btn-sentry-secondary btn-sm" onClick={handleOpenCheck} disabled={loading}>
                    Open Check
                  </button>
                  <button type="button" className="btn btn-sentry-primary btn-sm" onClick={handleStartMonitor} disabled={loading || monitor?.running}>
                    Start Monitor
                  </button>
                  <button type="button" className="btn btn-sentry-secondary btn-sm" onClick={handleStopMonitor} disabled={loading || !monitor?.running}>
                    Stop Monitor
                  </button>
                  <button type="button" className="btn btn-sentry-secondary btn-sm" onClick={handleRefresh} disabled={loading}>
                    Refresh
                  </button>
                </div>
              </Col>
            </Row>
          </PanelCard>
        </Col>
      </Row>

      <Row>
        <Col lg={6}>
          <PanelCard title="BACnet / Protocol Status">
            <KvRow label="BACnet/IP Discovery" value={<StatusBadge status="ready" label="Implemented" />} />
            <KvRow label="BACnet MS/TP Discovery" value={<StatusBadge status="not_implemented" label="Not implemented" />} />
            <KvRow label="Routing" value={bacnet?.routingStatus || 'Not implemented in DEV-1'} />
            <KvRow label="Modbus" value={modbus?.note || 'Not implemented'} />
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
        <p style={{ color: '#58677d', margin: '0 0 0.5rem' }}>GPIO LED/button monitoring not configured in DEV-1.</p>
        {Object.values(gpio || {}).map((item) => (
          <div key={item.name} className="kv-row">
            <span className="kv-label">{item.name}</span>
            <span className="kv-value">
              <StatusBadge status="not_implemented" label="Not configured" />
            </span>
          </div>
        ))}
      </PanelCard>
    </>
  );
}
