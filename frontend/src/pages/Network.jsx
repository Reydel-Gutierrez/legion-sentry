import { useEffect, useState } from 'react';
import { Col, Form, Row } from 'react-bootstrap';
import { api } from '../api/client';
import KvRow from '../components/common/KvRow';
import PanelCard from '../components/common/PanelCard';
import StatusBadge from '../components/common/StatusBadge';
import PageHeader from '../components/common/PageHeader';

export default function NetworkPage() {
  const [data, setData] = useState(null);
  const [form, setForm] = useState(null);
  const [message, setMessage] = useState(null);
  const [loading, setLoading] = useState(false);

  const load = () => api.getNetworkStatus().then((status) => {
    setData(status);
    setForm({
      ethernet: { ...status.ethernet },
      wifi: { ...status.wifi },
      hostname: status.hostname,
    });
  });

  useEffect(() => { load().catch(console.error); }, []);

  const updateEthernet = (field, value) => {
    setForm((prev) => ({
      ...prev,
      ethernet: { ...prev.ethernet, [field]: value },
    }));
  };

  const updateWifi = (field, value) => {
    setForm((prev) => ({
      ...prev,
      wifi: { ...prev.wifi, [field]: value },
    }));
  };

  const handleSave = async () => {
    setLoading(true);
    setMessage(null);
    try {
      const result = await api.saveNetworkSettings(form);
      setData(result.data);
      setMessage({ type: 'success', text: 'Network settings saved.' });
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setLoading(false);
    }
  };

  const handleRestart = async () => {
    setLoading(true);
    try {
      const result = await api.restartNetwork();
      setMessage({ type: 'success', text: result.message });
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setLoading(false);
    }
  };

  const handleTest = async () => {
    setLoading(true);
    try {
      const result = await api.testConnectivity();
      setMessage({
        type: 'success',
        text: `Connectivity OK — ${result.target} @ ${result.latencyMs}ms, packet loss ${result.packetLoss}%`,
      });
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setLoading(false);
    }
  };

  if (!form || !data) return <div className="loading-state">Loading network configuration…</div>;

  return (
    <>
      <PageHeader title="Network" subtitle="Ethernet, WiFi, and hostname configuration" />

      {message && (
        <div className={`alert-sentry alert-sentry-${message.type === 'success' ? 'success' : 'error'}`}>
          {message.text}
        </div>
      )}

      <Row>
        <Col lg={6}>
          <PanelCard title="Ethernet — eth0">
            <div className="kv-row">
              <span className="kv-label">Link Status</span>
              <span className="kv-value"><StatusBadge status={data.ethernet.status} label={data.ethernet.linkSpeed} /></span>
            </div>
            <KvRow label="MAC Address" value={data.ethernet.mac} />
            <KvRow label="Current IP" value={data.currentIp} />

            <Form className="mt-3">
              <Form.Check
                type="switch"
                id="dhcp"
                label="DHCP Enabled"
                checked={form.ethernet.dhcpEnabled}
                onChange={(e) => updateEthernet('dhcpEnabled', e.target.checked)}
                className="mb-3"
              />
              <Row>
                <Col sm={6}>
                  <Form.Group className="mb-2">
                    <Form.Label>Static IP</Form.Label>
                    <Form.Control
                      value={form.ethernet.staticIp}
                      disabled={form.ethernet.dhcpEnabled}
                      onChange={(e) => updateEthernet('staticIp', e.target.value)}
                    />
                  </Form.Group>
                </Col>
                <Col sm={6}>
                  <Form.Group className="mb-2">
                    <Form.Label>Subnet Mask</Form.Label>
                    <Form.Control
                      value={form.ethernet.subnetMask}
                      disabled={form.ethernet.dhcpEnabled}
                      onChange={(e) => updateEthernet('subnetMask', e.target.value)}
                    />
                  </Form.Group>
                </Col>
              </Row>
              <Row>
                <Col sm={6}>
                  <Form.Group className="mb-2">
                    <Form.Label>Gateway</Form.Label>
                    <Form.Control
                      value={form.ethernet.gateway}
                      onChange={(e) => updateEthernet('gateway', e.target.value)}
                    />
                  </Form.Group>
                </Col>
                <Col sm={6}>
                  <Form.Group className="mb-2">
                    <Form.Label>DNS</Form.Label>
                    <Form.Control
                      value={(form.ethernet.dns || []).join(', ')}
                      onChange={(e) => updateEthernet('dns', e.target.value.split(',').map((s) => s.trim()))}
                    />
                  </Form.Group>
                </Col>
              </Row>
            </Form>
          </PanelCard>
        </Col>

        <Col lg={6}>
          <PanelCard title="WiFi">
            <Form.Check
              type="switch"
              id="wifi-enabled"
              label="WiFi Enabled"
              checked={form.wifi.enabled}
              onChange={(e) => updateWifi('enabled', e.target.checked)}
              className="mb-3"
            />
            <Form.Group className="mb-2">
              <Form.Label>SSID</Form.Label>
              <Form.Control
                value={form.wifi.ssid}
                disabled={!form.wifi.enabled}
                onChange={(e) => updateWifi('ssid', e.target.value)}
              />
            </Form.Group>
            <Row>
              <Col sm={6}>
                <Form.Group className="mb-2">
                  <Form.Label>IP Address</Form.Label>
                  <Form.Control
                    value={form.wifi.ipAddress}
                    disabled={!form.wifi.enabled}
                    onChange={(e) => updateWifi('ipAddress', e.target.value)}
                  />
                </Form.Group>
              </Col>
              <Col sm={6}>
                <Form.Group className="mb-2">
                  <Form.Label>Signal Strength</Form.Label>
                  <Form.Control
                    value={form.wifi.signalStrength ? `${form.wifi.signalStrength}%` : 'N/A'}
                    disabled
                  />
                </Form.Group>
              </Col>
            </Row>
            <div className="kv-row mt-2">
              <span className="kv-label">Status</span>
              <span className="kv-value"><StatusBadge status={data.wifi.status} /></span>
            </div>
          </PanelCard>

          <PanelCard title="Hostname">
            <Form.Group className="mb-2">
              <Form.Label>Hostname</Form.Label>
              <Form.Control
                value={form.hostname}
                onChange={(e) => setForm((prev) => ({ ...prev, hostname: e.target.value }))}
              />
            </Form.Group>
            <KvRow label="Local URL" value={`http://${form.hostname}.local`} />
          </PanelCard>
        </Col>
      </Row>

      <div className="action-bar">
        <button type="button" className="btn btn-sentry-primary" onClick={handleSave} disabled={loading}>
          Save Network Settings
        </button>
        <button type="button" className="btn btn-sentry-secondary" onClick={handleRestart} disabled={loading}>
          Restart Network
        </button>
        <button type="button" className="btn btn-sentry-secondary" onClick={handleTest} disabled={loading}>
          Test Connectivity
        </button>
      </div>
    </>
  );
}
