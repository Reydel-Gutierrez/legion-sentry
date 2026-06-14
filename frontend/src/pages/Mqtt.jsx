import { useEffect, useState } from 'react';
import { Col, Form, Row } from 'react-bootstrap';
import { api } from '../api/client';
import KvRow from '../components/common/KvRow';
import PanelCard from '../components/common/PanelCard';
import StatusBadge from '../components/common/StatusBadge';
import PageHeader from '../components/common/PageHeader';

export default function MqttPage() {
  const [data, setData] = useState(null);
  const [form, setForm] = useState(null);
  const [message, setMessage] = useState(null);
  const [loading, setLoading] = useState(false);

  const load = () => api.getMqttStatus().then((status) => {
    setData(status);
    setForm({
      enabled: status.enabled,
      brokerUrl: status.brokerUrl,
      port: status.port,
      username: status.username,
      password: status.password,
      tlsEnabled: status.tlsEnabled,
      topics: { ...status.topics },
    });
  });

  useEffect(() => { load().catch(console.error); }, []);

  const update = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const updateTopic = (field, value) => {
    setForm((prev) => ({ ...prev, topics: { ...prev.topics, [field]: value } }));
  };

  const handleSave = async () => {
    setLoading(true);
    setMessage(null);
    try {
      const result = await api.saveMqttSettings(form);
      setData(result.data);
      setMessage({ type: 'success', text: 'MQTT settings saved.' });
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setLoading(false);
    }
  };

  const handleTest = async () => {
    setLoading(true);
    try {
      const result = await api.testMqtt();
      setMessage({ type: result.success ? 'success' : 'error', text: result.message });
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setLoading(false);
    }
  };

  const handlePublish = async () => {
    setLoading(true);
    try {
      const result = await api.publishMqttTest();
      setMessage({ type: result.success ? 'success' : 'error', text: result.message });
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setLoading(false);
    }
  };

  if (!form || !data) return <div className="loading-state">Loading MQTT configuration…</div>;

  return (
    <>
      <PageHeader title="MQTT" subtitle="MQTT client broker and topic configuration" />

      {message && (
        <div className={`alert-sentry alert-sentry-${message.type === 'success' ? 'success' : 'error'}`}>
          {message.text}
        </div>
      )}

      <Row>
        <Col lg={6}>
          <PanelCard title="Broker">
            <div className="kv-row mb-2">
              <span className="kv-label">Client Status</span>
              <span className="kv-value"><StatusBadge status={data.status} /></span>
            </div>
            <KvRow label="Client ID" value={data.clientId} />
            <Form.Check
              type="switch"
              id="mqtt-enabled"
              label="Enable MQTT Client"
              checked={form.enabled}
              onChange={(e) => update('enabled', e.target.checked)}
              className="mb-3 mt-2"
            />
            <Form.Group className="mb-2">
              <Form.Label>Broker URL</Form.Label>
              <Form.Control value={form.brokerUrl} onChange={(e) => update('brokerUrl', e.target.value)} />
            </Form.Group>
            <Row>
              <Col sm={6}>
                <Form.Group className="mb-2">
                  <Form.Label>Port</Form.Label>
                  <Form.Control type="number" value={form.port} onChange={(e) => update('port', Number(e.target.value))} />
                </Form.Group>
              </Col>
              <Col sm={6} className="d-flex align-items-end mb-2">
                <Form.Check
                  type="switch"
                  id="tls"
                  label="TLS Enabled"
                  checked={form.tlsEnabled}
                  onChange={(e) => update('tlsEnabled', e.target.checked)}
                />
              </Col>
            </Row>
            <Row>
              <Col sm={6}>
                <Form.Group className="mb-2">
                  <Form.Label>Username</Form.Label>
                  <Form.Control value={form.username} onChange={(e) => update('username', e.target.value)} />
                </Form.Group>
              </Col>
              <Col sm={6}>
                <Form.Group className="mb-2">
                  <Form.Label>Password</Form.Label>
                  <Form.Control type="password" value={form.password} onChange={(e) => update('password', e.target.value)} />
                </Form.Group>
              </Col>
            </Row>
          </PanelCard>
        </Col>

        <Col lg={6}>
          <PanelCard title="Topics">
            <Form.Group className="mb-2">
              <Form.Label>Base Topic</Form.Label>
              <Form.Control value={form.topics.base} onChange={(e) => updateTopic('base', e.target.value)} />
            </Form.Group>
            <Form.Group className="mb-2">
              <Form.Label>Telemetry Topic</Form.Label>
              <Form.Control value={form.topics.telemetry} onChange={(e) => updateTopic('telemetry', e.target.value)} />
            </Form.Group>
            <Form.Group className="mb-2">
              <Form.Label>Events Topic</Form.Label>
              <Form.Control value={form.topics.events} onChange={(e) => updateTopic('events', e.target.value)} />
            </Form.Group>
            <Form.Group className="mb-2">
              <Form.Label>Commands Topic</Form.Label>
              <Form.Control value={form.topics.commands} onChange={(e) => updateTopic('commands', e.target.value)} />
            </Form.Group>
            {data.enabled && (
              <>
                <KvRow label="Messages Published" value={data.messagesPublished} />
                <KvRow label="Messages Received" value={data.messagesReceived} />
              </>
            )}
          </PanelCard>
        </Col>
      </Row>

      <div className="action-bar">
        <button type="button" className="btn btn-sentry-primary" onClick={handleSave} disabled={loading}>
          Save MQTT Settings
        </button>
        <button type="button" className="btn btn-sentry-secondary" onClick={handleTest} disabled={loading}>
          Test Connection
        </button>
        <button type="button" className="btn btn-sentry-secondary" onClick={handlePublish} disabled={loading}>
          Publish Test Message
        </button>
      </div>
    </>
  );
}
