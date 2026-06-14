import { useEffect, useState } from 'react';
import { Col, Form, Row } from 'react-bootstrap';
import { api } from '../api/client';
import KvRow from '../components/common/KvRow';
import PanelCard from '../components/common/PanelCard';
import StatusBadge from '../components/common/StatusBadge';
import PageHeader from '../components/common/PageHeader';

const BAUD_RATES = [9600, 19200, 38400, 76800, 115200];
const PARITY_OPTIONS = ['none', 'even', 'odd'];

export default function ModbusPage() {
  const [data, setData] = useState(null);
  const [form, setForm] = useState(null);
  const [message, setMessage] = useState(null);
  const [loading, setLoading] = useState(false);

  const load = () => api.getModbusStatus().then((status) => {
    setData(status);
    setForm({ tcp: { ...status.tcp }, rtu: { ...status.rtu } });
  });

  useEffect(() => { load().catch(console.error); }, []);

  const updateTcp = (field, value) => {
    setForm((prev) => ({ ...prev, tcp: { ...prev.tcp, [field]: value } }));
  };

  const updateRtu = (field, value) => {
    setForm((prev) => ({ ...prev, rtu: { ...prev.rtu, [field]: value } }));
  };

  const handleSave = async () => {
    setLoading(true);
    setMessage(null);
    try {
      const result = await api.saveModbusSettings(form);
      setData(result.data);
      setMessage({ type: 'success', text: 'Modbus settings saved.' });
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setLoading(false);
    }
  };

  const handleTestRead = async () => {
    setLoading(true);
    try {
      const result = await api.testModbusRead();
      setMessage({
        type: 'success',
        text: `Register ${result.register} = ${result.value} (${result.responseTimeMs}ms)`,
      });
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setLoading(false);
    }
  };

  if (!form || !data) return <div className="loading-state">Loading Modbus configuration…</div>;

  return (
    <>
      <PageHeader title="Modbus" subtitle="Modbus TCP and RTU gateway configuration" />

      {message && (
        <div className={`alert-sentry alert-sentry-${message.type === 'success' ? 'success' : 'error'}`}>
          {message.text}
        </div>
      )}

      <Row>
        <Col lg={6}>
          <PanelCard title="Modbus TCP">
            <div className="kv-row mb-2">
              <span className="kv-label">Service</span>
              <span className="kv-value"><StatusBadge status={data.tcp.status} /></span>
            </div>
            <KvRow label="Connections" value={data.tcp.connections} />
            <KvRow label="Last Poll" value={`${data.tcp.lastPollMs}ms`} />
            <Form.Check
              type="switch"
              id="modbus-tcp"
              label="Enable Modbus TCP"
              checked={form.tcp.enabled}
              onChange={(e) => updateTcp('enabled', e.target.checked)}
              className="mb-3 mt-2"
            />
            <Row>
              <Col sm={6}>
                <Form.Group className="mb-2">
                  <Form.Label>Port</Form.Label>
                  <Form.Control type="number" value={form.tcp.port} onChange={(e) => updateTcp('port', Number(e.target.value))} />
                </Form.Group>
              </Col>
              <Col sm={6}>
                <Form.Group className="mb-2">
                  <Form.Label>Unit ID</Form.Label>
                  <Form.Control type="number" value={form.tcp.unitId} onChange={(e) => updateTcp('unitId', Number(e.target.value))} />
                </Form.Group>
              </Col>
            </Row>
            <Row>
              <Col sm={6}>
                <Form.Group className="mb-2">
                  <Form.Label>Timeout (ms)</Form.Label>
                  <Form.Control type="number" value={form.tcp.timeout} onChange={(e) => updateTcp('timeout', Number(e.target.value))} />
                </Form.Group>
              </Col>
              <Col sm={6}>
                <Form.Group className="mb-2">
                  <Form.Label>Poll Interval (ms)</Form.Label>
                  <Form.Control type="number" value={form.tcp.pollInterval} onChange={(e) => updateTcp('pollInterval', Number(e.target.value))} />
                </Form.Group>
              </Col>
            </Row>
          </PanelCard>
        </Col>

        <Col lg={6}>
          <PanelCard title="Modbus RTU">
            <div className="kv-row mb-2">
              <span className="kv-label">Bus</span>
              <span className="kv-value"><StatusBadge status={data.rtu.busState} label={data.rtu.status} /></span>
            </div>
            <KvRow label="Last Response" value={`${data.rtu.lastResponseMs}ms`} />
            <Form.Check
              type="switch"
              id="modbus-rtu"
              label="Enable Modbus RTU"
              checked={form.rtu.enabled}
              onChange={(e) => updateRtu('enabled', e.target.checked)}
              className="mb-3 mt-2"
            />
            <Form.Group className="mb-2">
              <Form.Label>Serial Port</Form.Label>
              <Form.Control value={form.rtu.serialPort} onChange={(e) => updateRtu('serialPort', e.target.value)} />
            </Form.Group>
            <Row>
              <Col sm={6}>
                <Form.Group className="mb-2">
                  <Form.Label>Baud Rate</Form.Label>
                  <Form.Select value={form.rtu.baudRate} onChange={(e) => updateRtu('baudRate', Number(e.target.value))}>
                    {BAUD_RATES.map((rate) => <option key={rate} value={rate}>{rate}</option>)}
                  </Form.Select>
                </Form.Group>
              </Col>
              <Col sm={6}>
                <Form.Group className="mb-2">
                  <Form.Label>Parity</Form.Label>
                  <Form.Select value={form.rtu.parity} onChange={(e) => updateRtu('parity', e.target.value)}>
                    {PARITY_OPTIONS.map((p) => <option key={p} value={p}>{p}</option>)}
                  </Form.Select>
                </Form.Group>
              </Col>
            </Row>
            <Row>
              <Col sm={4}>
                <Form.Group className="mb-2">
                  <Form.Label>Data Bits</Form.Label>
                  <Form.Control type="number" value={form.rtu.dataBits} onChange={(e) => updateRtu('dataBits', Number(e.target.value))} />
                </Form.Group>
              </Col>
              <Col sm={4}>
                <Form.Group className="mb-2">
                  <Form.Label>Stop Bits</Form.Label>
                  <Form.Control type="number" value={form.rtu.stopBits} onChange={(e) => updateRtu('stopBits', Number(e.target.value))} />
                </Form.Group>
              </Col>
              <Col sm={4}>
                <Form.Group className="mb-2">
                  <Form.Label>Unit ID</Form.Label>
                  <Form.Control type="number" value={form.rtu.unitId} onChange={(e) => updateRtu('unitId', Number(e.target.value))} />
                </Form.Group>
              </Col>
            </Row>
          </PanelCard>
        </Col>
      </Row>

      <div className="action-bar">
        <button type="button" className="btn btn-sentry-primary" onClick={handleSave} disabled={loading}>
          Save Modbus Settings
        </button>
        <button type="button" className="btn btn-sentry-secondary" onClick={handleTestRead} disabled={loading}>
          Test Read Register
        </button>
        <button type="button" className="btn btn-sentry-secondary" disabled title="Placeholder — scan not implemented">
          Discover / Scan Devices
        </button>
      </div>
    </>
  );
}
