import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Col, Form, Row, Table } from 'react-bootstrap';
import { api } from '../api/client';
import KvRow from '../components/common/KvRow';
import PanelCard from '../components/common/PanelCard';
import StatusBadge from '../components/common/StatusBadge';
import LoadingState from '../components/common/LoadingState';

const BAUD_RATES = [9600, 19200, 38400, 57600, 76800, 115200];

const DEFAULT_MSTP = {
  port: '/dev/serial0',
  baudRate: 38400,
  macAddress: 5,
  maxMaster: 127,
  maxInfoFrames: 1,
  networkNumber: 2,
};

function formatTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString();
}

function formatLastSeen(iso) {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60000) return 'Just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  return formatTime(iso);
}

function deviceAddress(device) {
  if (device.transport === 'BACnet MS/TP' || device.transport === 'mstp') {
    return device.macAddress != null ? `MAC ${device.macAddress}` : '—';
  }
  return device.address || '—';
}

export default function BacnetPage() {
  const navigate = useNavigate();
  const [bacnetStatus, setBacnetStatus] = useState(null);
  const [mstpStatus, setMstpStatus] = useState(null);
  const [devices, setDevices] = useState([]);
  const [logs, setLogs] = useState([]);
  const [mstpForm, setMstpForm] = useState(DEFAULT_MSTP);
  const [ipForm, setIpForm] = useState(null);
  const [message, setMessage] = useState(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    const [status, mstp, deviceData, logData] = await Promise.all([
      api.getBacnetStatus(),
      api.getBacnetMstpStatus(),
      api.getDevices(),
      api.getBacnetMstpLogs(),
    ]);
    setBacnetStatus(status);
    setMstpStatus(mstp.status);
    setDevices(deviceData.devices || []);
    setLogs(logData.logs || []);
    setIpForm({
      enabled: status.ip.enabled,
      deviceInstance: status.ip.deviceInstance,
      udpPort: status.ip.udpPort,
      networkNumber: status.ip.networkNumber,
    });
    setMstpForm({
      port: mstp.status?.port || status.mstp.serialPort || DEFAULT_MSTP.port,
      baudRate: mstp.status?.baudRate || status.mstp.baudRate || DEFAULT_MSTP.baudRate,
      macAddress: mstp.status?.macAddress ?? status.mstp.macAddress ?? DEFAULT_MSTP.macAddress,
      maxMaster: mstp.status?.maxMaster ?? status.mstp.maxMaster ?? DEFAULT_MSTP.maxMaster,
      maxInfoFrames: mstp.status?.maxInfoFrames ?? status.mstp.maxInfoFrames ?? DEFAULT_MSTP.maxInfoFrames,
      networkNumber: mstp.status?.networkNumber ?? status.mstp.networkNumber ?? DEFAULT_MSTP.networkNumber,
    });
  }, []);

  useEffect(() => {
    load().catch((err) => setMessage({ type: 'error', text: err.message }));
  }, [load]);

  const refreshLogs = async () => {
    const logData = await api.getBacnetMstpLogs();
    setLogs(logData.logs || []);
  };

  const updateMstp = (field, value) => {
    setMstpForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleDiscoverIp = async () => {
    setLoading(true);
    setMessage(null);
    try {
      const result = await api.discoverBacnetIp(5000);
      await load();
      const found = result.devices?.length ?? result.inventory?.devicesFound ?? 0;
      setMessage({
        type: found ? 'success' : 'info',
        text: found
          ? `BACnet/IP discovery found ${found} device(s) in ${result.durationMs}ms.`
          : 'No BACnet/IP devices discovered.',
      });
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setLoading(false);
    }
  };

  const handleOpenMstp = async () => {
    setLoading(true);
    setMessage(null);
    try {
      await api.openBacnetMstp(mstpForm);
      await load();
      setMessage({ type: 'success', text: `MS/TP interface opened on ${mstpForm.port}.` });
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setLoading(false);
    }
  };

  const handleCloseMstp = async () => {
    setLoading(true);
    setMessage(null);
    try {
      const result = await api.closeBacnetMstp();
      await load();
      setMessage({ type: 'success', text: result.message });
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setLoading(false);
    }
  };

  const handleDiscoverMstp = async () => {
    setLoading(true);
    setMessage(null);
    try {
      const result = await api.discoverBacnetMstp({ ...mstpForm, timeoutMs: 8000 });
      await load();
      const found = result.devices?.length ?? 0;
      if (result.message && found === 0) {
        setMessage({ type: 'info', text: result.message });
      } else if (found > 0) {
        setMessage({
          type: 'success',
          text: `BACnet MS/TP discovery found ${found} device(s) in ${result.durationMs}ms.`,
        });
      } else {
        setMessage({ type: 'info', text: 'No MS/TP responses received.' });
      }
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setLoading(false);
    }
  };

  const handleClearLogs = async () => {
    setLoading(true);
    try {
      await api.clearBacnetMstpLogs();
      await refreshLogs();
      setMessage({ type: 'success', text: 'Discovery logs cleared.' });
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setLoading(false);
    }
  };

  if (!bacnetStatus || !ipForm) {
    return <LoadingState message="Loading BACnet configuration…" />;
  }

  const mstp = mstpStatus || {};
  const interfaceOpen = Boolean(mstp.open);

  return (
    <>
      {message && (
        <div className={`alert-sentry alert-sentry-${message.type === 'success' ? 'success' : message.type === 'info' ? 'info' : 'error'} mb-3`}>
          {message.text}
        </div>
      )}

      <Row className="g-3">
        <Col lg={6}>
          <PanelCard title="BACnet/IP Discovery">
            <div className="kv-row mb-2">
              <span className="kv-label">Status</span>
              <span className="kv-value">
                <StatusBadge status={bacnetStatus.ip.status} label={bacnetStatus.ip.label} />
              </span>
            </div>
            <KvRow label="Device Instance" value={ipForm.deviceInstance} />
            <KvRow label="UDP Port" value={ipForm.udpPort} />
            <KvRow label="Network Number" value={ipForm.networkNumber} />
            <div className="action-bar mt-3">
              <button type="button" className="btn btn-sentry-primary" onClick={handleDiscoverIp} disabled={loading}>
                Discover BACnet/IP
              </button>
            </div>
          </PanelCard>
        </Col>

        <Col lg={6}>
          <PanelCard title="BACnet MS/TP Interface">
            <Row>
              <Col sm={6}>
                <Form.Group className="mb-2">
                  <Form.Label>Port</Form.Label>
                  <Form.Control
                    value={mstpForm.port}
                    onChange={(e) => updateMstp('port', e.target.value)}
                    disabled={interfaceOpen}
                  />
                </Form.Group>
              </Col>
              <Col sm={6}>
                <Form.Group className="mb-2">
                  <Form.Label>Baud Rate</Form.Label>
                  <Form.Select
                    value={mstpForm.baudRate}
                    onChange={(e) => updateMstp('baudRate', Number(e.target.value))}
                    disabled={interfaceOpen}
                  >
                    {BAUD_RATES.map((rate) => (
                      <option key={rate} value={rate}>{rate}</option>
                    ))}
                  </Form.Select>
                </Form.Group>
              </Col>
            </Row>
            <Row>
              <Col sm={4}>
                <Form.Group className="mb-2">
                  <Form.Label>MAC Address</Form.Label>
                  <Form.Control
                    type="number"
                    value={mstpForm.macAddress}
                    onChange={(e) => updateMstp('macAddress', Number(e.target.value))}
                    disabled={interfaceOpen}
                  />
                </Form.Group>
              </Col>
              <Col sm={4}>
                <Form.Group className="mb-2">
                  <Form.Label>Max Master</Form.Label>
                  <Form.Control
                    type="number"
                    value={mstpForm.maxMaster}
                    onChange={(e) => updateMstp('maxMaster', Number(e.target.value))}
                    disabled={interfaceOpen}
                  />
                </Form.Group>
              </Col>
              <Col sm={4}>
                <Form.Group className="mb-2">
                  <Form.Label>Max Info Frames</Form.Label>
                  <Form.Control
                    type="number"
                    value={mstpForm.maxInfoFrames}
                    onChange={(e) => updateMstp('maxInfoFrames', Number(e.target.value))}
                    disabled={interfaceOpen}
                  />
                </Form.Group>
              </Col>
            </Row>
            <Form.Group className="mb-2">
              <Form.Label>Network Number</Form.Label>
              <Form.Control
                type="number"
                value={mstpForm.networkNumber}
                onChange={(e) => updateMstp('networkNumber', Number(e.target.value))}
                disabled={interfaceOpen}
              />
            </Form.Group>
            <KvRow
              label="Interface Status"
              value={(
                <StatusBadge
                  status={interfaceOpen ? 'running' : 'not_configured'}
                  label={interfaceOpen ? 'Open' : 'Closed'}
                />
              )}
            />
            <KvRow label="RX Bytes" value={mstp.rxBytes ?? 0} />
            <KvRow label="TX Bytes" value={mstp.txBytes ?? 0} />
            <KvRow label="Last Activity" value={formatTime(mstp.lastActivityAt)} />
            <KvRow label="Last Error" value={mstp.lastError || '—'} />
            <div className="action-bar mt-3">
              <button type="button" className="btn btn-sentry-primary" onClick={handleOpenMstp} disabled={loading || interfaceOpen}>
                Open Interface
              </button>
              <button type="button" className="btn btn-sentry-secondary" onClick={handleCloseMstp} disabled={loading || !interfaceOpen}>
                Close Interface
              </button>
              <button type="button" className="btn btn-sentry-primary" onClick={handleDiscoverMstp} disabled={loading}>
                Discover BACnet MS/TP
              </button>
              <button type="button" className="btn btn-sentry-secondary" onClick={handleClearLogs} disabled={loading}>
                Clear Logs
              </button>
            </div>
          </PanelCard>
        </Col>
      </Row>

      <PanelCard title="Discovered Devices" className="mt-3">
        {devices.length === 0 ? (
          <p style={{ color: '#58677d', margin: 0 }}>No devices discovered yet. Run BACnet/IP or MS/TP discovery.</p>
        ) : (
          <Table responsive hover className="sentry-table mb-0">
            <thead>
              <tr>
                <th>Status</th>
                <th>Transport</th>
                <th>Device Instance</th>
                <th>Object Name</th>
                <th>Vendor</th>
                <th>Model</th>
                <th>Address/MAC</th>
                <th>Network</th>
                <th>Last Seen</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {devices.map((device) => (
                <tr key={device.id}>
                  <td><StatusBadge status={device.status} /></td>
                  <td>{device.network || device.transport}</td>
                  <td>{device.deviceInstance}</td>
                  <td>{device.objectName || '—'}</td>
                  <td>{device.vendor || device.vendorName || '—'}</td>
                  <td>{device.model || device.modelName || '—'}</td>
                  <td>{deviceAddress(device)}</td>
                  <td>{device.networkNumber ?? '—'}</td>
                  <td>{formatLastSeen(device.lastSeen || device.lastSeenAt)}</td>
                  <td>
                    <button
                      type="button"
                      className="btn btn-sentry-secondary btn-sm"
                      onClick={() => navigate(`/devices/${device.id}`)}
                    >
                      Details
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </PanelCard>

      <PanelCard title="Discovery Log" className="mt-3">
        {logs.length === 0 ? (
          <p style={{ color: '#58677d', margin: 0 }}>No discovery logs yet.</p>
        ) : (
          <Table responsive className="sentry-table mb-0">
            <thead>
              <tr>
                <th>Time</th>
                <th>Level</th>
                <th>Source</th>
                <th>Message</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((entry, index) => (
                <tr key={`${entry.time}-${index}`}>
                  <td>{formatTime(entry.time)}</td>
                  <td>{entry.level}</td>
                  <td>{entry.source}</td>
                  <td>{entry.message}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </PanelCard>

      <PanelCard title="Routing Status" className="mt-3">
        <p style={{ color: '#58677d', margin: 0 }}>Routing is not implemented in DEV-1 yet.</p>
      </PanelCard>
    </>
  );
}
