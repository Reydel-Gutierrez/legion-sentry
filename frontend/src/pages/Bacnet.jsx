import { useEffect, useState } from 'react';
import { Col, Form, Nav, Row, Tab } from 'react-bootstrap';
import { api } from '../api/client';
import KvRow from '../components/common/KvRow';
import PanelCard from '../components/common/PanelCard';
import StatusBadge from '../components/common/StatusBadge';
import LoadingState from '../components/common/LoadingState';

const BAUD_RATES = [9600, 19200, 38400, 57600, 76800, 115200];

export default function BacnetPage() {
  const [data, setData] = useState(null);
  const [form, setForm] = useState(null);
  const [serialDetail, setSerialDetail] = useState(null);
  const [message, setMessage] = useState(null);
  const [loading, setLoading] = useState(false);
  const [discoveryResult, setDiscoveryResult] = useState(null);
  const [activeTab, setActiveTab] = useState('ip');

  const load = async () => {
    const [status, serial] = await Promise.all([
      api.getBacnetStatus(),
      api.getSerialDetail(),
    ]);
    setData(status);
    setSerialDetail(serial);
    setForm({
      ip: { ...status.ip },
      mstp: { ...status.mstp },
      routing: { ...status.routing },
    });
  };

  useEffect(() => { load().catch(console.error); }, []);

  const updateIp = (field, value) => {
    setForm((prev) => ({ ...prev, ip: { ...prev.ip, [field]: value } }));
  };

  const updateMstp = (field, value) => {
    setForm((prev) => ({ ...prev, mstp: { ...prev.mstp, [field]: value } }));
  };

  const updateRouting = (field, value) => {
    setForm((prev) => ({ ...prev, routing: { ...prev.routing, [field]: value } }));
  };

  const handleSave = async () => {
    setLoading(true);
    setMessage(null);
    try {
      const result = await api.saveBacnetSettings(form);
      setData(result.data);
      setMessage({ type: 'success', text: 'BACnet settings saved.' });
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setLoading(false);
    }
  };

  const handleDiscoverIp = async () => {
    setLoading(true);
    setMessage(null);
    setDiscoveryResult(null);
    try {
      const result = await api.discoverBacnetIp(5000);
      setDiscoveryResult(result);
      const found = result.devices?.length ?? 0;
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

  const handleSerialCheck = async () => {
    setLoading(true);
    setMessage(null);
    try {
      const path = form.mstp.serialPort;
      const baudRate = form.mstp.baudRate;
      const result = await api.openSerialCheck({ path, baudRate });
      await load();
      setMessage({
        type: result.success ? 'success' : 'error',
        text: result.success
          ? `RS485 port check OK — ${result.path} opened in ${result.responseTimeMs}ms`
          : `RS485 port check failed — ${result.error}`,
      });
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setLoading(false);
    }
  };

  const handleApplySerial = async () => {
    setLoading(true);
    setMessage(null);
    try {
      const result = await api.configureSerial({
        path: form.mstp.serialPort,
        baudRate: form.mstp.baudRate,
      });
      await load();
      setMessage({
        type: 'success',
        text: `MS/TP serial settings applied — ${result.port.path} at ${result.port.currentBaudRate} baud`,
      });
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setLoading(false);
    }
  };

  if (!form || !data) return <LoadingState message="Loading BACnet configuration…" />;

  const recommendedPort = serialDetail?.ports?.find((p) => p.recommendedForRs485 && p.exists);
  const lastSerialCheck = data.mstp.lastSerialCheck || serialDetail?.lastOpenCheck;

  return (
    <>
      {message && (
        <div className={`alert-sentry alert-sentry-${message.type === 'success' ? 'success' : message.type === 'info' ? 'info' : 'error'} mb-3`}>
          {message.text}
        </div>
      )}

      <Tab.Container activeKey={activeTab} onSelect={(k) => setActiveTab(k || 'ip')}>
        <Nav variant="tabs" className="mb-3 sentry-tabs">
          <Nav.Item>
            <Nav.Link eventKey="ip">BACnet/IP Discovery</Nav.Link>
          </Nav.Item>
          <Nav.Item>
            <Nav.Link eventKey="mstp">BACnet MS/TP Serial</Nav.Link>
          </Nav.Item>
          <Nav.Item>
            <Nav.Link eventKey="routing">Routing Status</Nav.Link>
          </Nav.Item>
        </Nav>

        <Tab.Content>
          <Tab.Pane eventKey="ip">
            <Row>
              <Col lg={6}>
                <PanelCard title="BACnet/IP Service">
                  <div className="kv-row mb-2">
                    <span className="kv-label">Service</span>
                    <span className="kv-value"><StatusBadge status={data.ip.status} label={data.ip.label} /></span>
                  </div>
                  <Form.Check
                    type="switch"
                    id="bacnet-ip"
                    label="Enable Service"
                    checked={form.ip.enabled}
                    onChange={(e) => updateIp('enabled', e.target.checked)}
                    className="mb-3"
                  />
                  <Row>
                    <Col sm={6}>
                      <Form.Group className="mb-2">
                        <Form.Label>Device Instance</Form.Label>
                        <Form.Control
                          type="number"
                          value={form.ip.deviceInstance}
                          onChange={(e) => updateIp('deviceInstance', Number(e.target.value))}
                        />
                      </Form.Group>
                    </Col>
                    <Col sm={6}>
                      <Form.Group className="mb-2">
                        <Form.Label>UDP Port</Form.Label>
                        <Form.Control
                          type="number"
                          value={form.ip.udpPort}
                          onChange={(e) => updateIp('udpPort', Number(e.target.value))}
                        />
                      </Form.Group>
                    </Col>
                  </Row>
                  <Form.Group className="mb-2">
                    <Form.Label>Network Number</Form.Label>
                    <Form.Control
                      type="number"
                      value={form.ip.networkNumber}
                      onChange={(e) => updateIp('networkNumber', Number(e.target.value))}
                    />
                  </Form.Group>
                </PanelCard>
              </Col>
              <Col lg={6}>
                <PanelCard title="BACnet/IP Discovery">
                  <div className="action-bar">
                    <button type="button" className="btn btn-sentry-primary" onClick={handleDiscoverIp} disabled={loading}>
                      Discover BACnet/IP
                    </button>
                  </div>
                  {discoveryResult && (
                    <div className="mt-3">
                      <KvRow label="Duration" value={`${discoveryResult.durationMs}ms`} />
                      <KvRow label="Devices Found" value={discoveryResult.devices?.length ?? 0} />
                    </div>
                  )}
                </PanelCard>
              </Col>
            </Row>
          </Tab.Pane>

          <Tab.Pane eventKey="mstp">
            <Row>
              <Col lg={6}>
                <PanelCard title="MS/TP Serial Interface">
                  <div className="kv-row mb-2">
                    <span className="kv-label">Service</span>
                    <span className="kv-value"><StatusBadge status={data.mstp.status} label={data.mstp.label} /></span>
                  </div>
                  <KvRow label="Recommended Port" value={recommendedPort?.path || '/dev/serial0'} />
                  <KvRow
                    label="Monitor Status"
                    value={data.mstp.monitor?.running ? 'Running' : 'Stopped'}
                  />
                  {data.mstp.monitor?.running && (
                    <KvRow label="RX Bytes" value={data.mstp.monitor.rxBytes ?? 0} />
                  )}
                  <KvRow
                    label="Serial Port Open Status"
                    value={(
                      <StatusBadge
                        status={lastSerialCheck?.success ? 'running' : lastSerialCheck ? 'fault' : 'not_configured'}
                        label={lastSerialCheck?.success ? 'Open OK' : lastSerialCheck ? 'Failed' : 'Not checked'}
                      />
                    )}
                  />
                  {lastSerialCheck && (
                    <KvRow label="Last Serial Check" value={`${lastSerialCheck.checkedAt} (${lastSerialCheck.responseTimeMs ?? '—'}ms)`} />
                  )}
                  <Form.Check
                    type="switch"
                    id="bacnet-mstp"
                    label="Enable Service"
                    checked={form.mstp.enabled}
                    onChange={(e) => updateMstp('enabled', e.target.checked)}
                    className="mb-3 mt-2"
                  />
                  <Form.Group className="mb-2">
                    <Form.Label>Serial Port</Form.Label>
                    <Form.Control
                      value={form.mstp.serialPort}
                      onChange={(e) => updateMstp('serialPort', e.target.value)}
                    />
                  </Form.Group>
                  <Row>
                    <Col sm={6}>
                      <Form.Group className="mb-2">
                        <Form.Label>MAC Address</Form.Label>
                        <Form.Control
                          type="number"
                          value={form.mstp.macAddress}
                          onChange={(e) => updateMstp('macAddress', Number(e.target.value))}
                        />
                      </Form.Group>
                    </Col>
                    <Col sm={6}>
                      <Form.Group className="mb-2">
                        <Form.Label>Baud Rate</Form.Label>
                        <Form.Select
                          value={form.mstp.baudRate}
                          onChange={(e) => updateMstp('baudRate', Number(e.target.value))}
                        >
                          {BAUD_RATES.map((rate) => (
                            <option key={rate} value={rate}>{rate}</option>
                          ))}
                        </Form.Select>
                      </Form.Group>
                    </Col>
                  </Row>
                  <Row>
                    <Col sm={6}>
                      <Form.Group className="mb-2">
                        <Form.Label>Max Master</Form.Label>
                        <Form.Control
                          type="number"
                          value={form.mstp.maxMaster}
                          onChange={(e) => updateMstp('maxMaster', Number(e.target.value))}
                        />
                      </Form.Group>
                    </Col>
                    <Col sm={6}>
                      <Form.Group className="mb-2">
                        <Form.Label>Max Info Frames</Form.Label>
                        <Form.Control
                          type="number"
                          value={form.mstp.maxInfoFrames}
                          onChange={(e) => updateMstp('maxInfoFrames', Number(e.target.value))}
                        />
                      </Form.Group>
                    </Col>
                  </Row>
                  <Form.Group>
                    <Form.Label>Network Number</Form.Label>
                    <Form.Control
                      type="number"
                      value={form.mstp.networkNumber}
                      onChange={(e) => updateMstp('networkNumber', Number(e.target.value))}
                    />
                  </Form.Group>
                </PanelCard>
              </Col>
              <Col lg={6}>
                <PanelCard title="RS485 Port Actions">
                  <div className="action-bar">
                    <button type="button" className="btn btn-sentry-primary" onClick={handleSerialCheck} disabled={loading}>
                      Check RS485 Port
                    </button>
                    <button type="button" className="btn btn-sentry-secondary" onClick={handleApplySerial} disabled={loading}>
                      Apply MS/TP Serial Settings
                    </button>
                    <button type="button" className="btn btn-sentry-secondary" disabled title="BACnet MS/TP discovery not implemented yet">
                      Discover BACnet MS/TP
                    </button>
                  </div>
                  {serialDetail?.ports && (
                    <div className="mt-3">
                      <strong>Detected Ports</strong>
                      {serialDetail.ports.filter((p) => p.exists).map((port) => (
                        <KvRow
                          key={port.path}
                          label={port.path}
                          value={`${port.currentBaudRate ?? '—'} baud${port.notes ? ` — ${port.notes}` : ''}`}
                        />
                      ))}
                    </div>
                  )}
                </PanelCard>
              </Col>
            </Row>
          </Tab.Pane>

          <Tab.Pane eventKey="routing">
            <PanelCard title="Routing Status">
              <div className="alert-sentry alert-sentry-info">
                Routing not implemented in DEV-1 software yet.
              </div>
              <KvRow label="Status" value={<StatusBadge status="not_configured" label="Not implemented" />} />
              <Row className="mt-2">
                <Col sm={4}>
                  <Form.Group className="mb-2">
                    <Form.Label>IP Network</Form.Label>
                    <Form.Control
                      type="number"
                      value={form.routing.ipNetwork}
                      onChange={(e) => updateRouting('ipNetwork', Number(e.target.value))}
                      disabled
                    />
                  </Form.Group>
                </Col>
                <Col sm={4}>
                  <Form.Group className="mb-2">
                    <Form.Label>MS/TP Network</Form.Label>
                    <Form.Control
                      type="number"
                      value={form.routing.mstpNetwork}
                      onChange={(e) => updateRouting('mstpNetwork', Number(e.target.value))}
                      disabled
                    />
                  </Form.Group>
                </Col>
                <Col sm={4}>
                  <Form.Check
                    type="switch"
                    id="route-enabled"
                    label="Route Enabled"
                    checked={form.routing.routeEnabled}
                    onChange={(e) => updateRouting('routeEnabled', e.target.checked)}
                    className="mt-4"
                    disabled
                  />
                </Col>
              </Row>
            </PanelCard>
          </Tab.Pane>
        </Tab.Content>
      </Tab.Container>

      <PanelCard title="Configuration Actions" className="mt-3">
        <div className="action-bar">
          <button type="button" className="btn btn-sentry-primary" onClick={handleSave} disabled={loading}>
            Save Settings
          </button>
        </div>
      </PanelCard>
    </>
  );
}
