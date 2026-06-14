import { useEffect, useState } from 'react';
import { Col, Form, Row, Table } from 'react-bootstrap';
import { api } from '../api/client';
import PanelCard from '../components/common/PanelCard';
import StatusBadge from '../components/common/StatusBadge';
import PageHeader from '../components/common/PageHeader';

const BAUD_RATES = [9600, 19200, 38400, 76800, 115200];

export default function BacnetPage() {
  const [data, setData] = useState(null);
  const [form, setForm] = useState(null);
  const [discovered, setDiscovered] = useState([]);
  const [message, setMessage] = useState(null);
  const [loading, setLoading] = useState(false);

  const load = () => api.getBacnetStatus().then((status) => {
    setData(status);
    setForm({ ip: { ...status.ip }, mstp: { ...status.mstp } });
    setDiscovered(status.discoveredDevices || []);
  });

  useEffect(() => { load().catch(console.error); }, []);

  const updateIp = (field, value) => {
    setForm((prev) => ({ ...prev, ip: { ...prev.ip, [field]: value } }));
  };

  const updateMstp = (field, value) => {
    setForm((prev) => ({ ...prev, mstp: { ...prev.mstp, [field]: value } }));
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

  const handleDiscover = async () => {
    setLoading(true);
    setMessage(null);
    try {
      const result = await api.discoverBacnet();
      setDiscovered(result.devices);
      setMessage({ type: 'success', text: `Discovery complete — ${result.devices.length} devices found in ${result.durationMs}ms.` });
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setLoading(false);
    }
  };

  if (!form || !data) return <div className="loading-state">Loading BACnet configuration…</div>;

  return (
    <>
      <PageHeader title="BACnet" subtitle="BACnet/IP and MS/TP gateway configuration" />

      {message && (
        <div className={`alert-sentry alert-sentry-${message.type === 'success' ? 'success' : 'error'}`}>
          {message.text}
        </div>
      )}

      <Row>
        <Col lg={6}>
          <PanelCard title="BACnet/IP">
            <div className="kv-row mb-2">
              <span className="kv-label">Service</span>
              <span className="kv-value"><StatusBadge status={data.ip.status} /></span>
            </div>
            <Form.Check
              type="switch"
              id="bacnet-ip"
              label="Enable BACnet/IP"
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
            <Form.Check
              type="switch"
              id="bbmd"
              label="BBMD Enabled"
              checked={form.ip.bbmdEnabled}
              onChange={(e) => updateIp('bbmdEnabled', e.target.checked)}
              className="mb-2"
            />
            <Form.Check
              type="switch"
              id="foreign-device"
              label="Foreign Device Registration"
              checked={form.ip.foreignDeviceRegistrationEnabled}
              onChange={(e) => updateIp('foreignDeviceRegistrationEnabled', e.target.checked)}
            />
          </PanelCard>
        </Col>

        <Col lg={6}>
          <PanelCard title="BACnet MS/TP">
            <div className="kv-row mb-2">
              <span className="kv-label">Bus</span>
              <span className="kv-value"><StatusBadge status={data.mstp.busState} label={data.mstp.status} /></span>
            </div>
            <Form.Check
              type="switch"
              id="bacnet-mstp"
              label="Enable MS/TP"
              checked={form.mstp.enabled}
              onChange={(e) => updateMstp('enabled', e.target.checked)}
              className="mb-3"
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
      </Row>

      <PanelCard title="Discovered Devices">
        <Table responsive className="sentry-table mb-0">
          <thead>
            <tr>
              <th>Instance</th>
              <th>Vendor</th>
              <th>Model</th>
              <th>Address</th>
              <th>Network</th>
            </tr>
          </thead>
          <tbody>
            {discovered.length === 0 ? (
              <tr><td colSpan={5} style={{ textAlign: 'center', color: '#58677d' }}>No devices discovered yet</td></tr>
            ) : (
              discovered.map((device) => (
                <tr key={device.deviceInstance}>
                  <td>{device.deviceInstance}</td>
                  <td>{device.vendor}</td>
                  <td>{device.model}</td>
                  <td>{device.address}</td>
                  <td>{device.networkNumber}</td>
                </tr>
              ))
            )}
          </tbody>
        </Table>
      </PanelCard>

      <div className="action-bar">
        <button type="button" className="btn btn-sentry-primary" onClick={handleSave} disabled={loading}>
          Save BACnet Settings
        </button>
        <button type="button" className="btn btn-sentry-secondary" onClick={handleDiscover} disabled={loading}>
          Discover BACnet Devices
        </button>
      </div>
    </>
  );
}
