import { useEffect, useState } from 'react';
import { Col, Form, Row } from 'react-bootstrap';
import { api } from '../api/client';
import KvRow from '../components/common/KvRow';
import PanelCard from '../components/common/PanelCard';
import StatusBadge from '../components/common/StatusBadge';
import PageHeader from '../components/common/PageHeader';
import LoadingState from '../components/common/LoadingState';

function InterfaceConfigForm({ ifaceName, config, onChange, disabled }) {
  const isDhcp = config.mode === 'dhcp';

  return (
    <div className="interface-config-form">
      <h6 className="interface-config-title">{ifaceName}</h6>
      <Form.Check
        type="radio"
        id={`${ifaceName}-dhcp`}
        name={`${ifaceName}-mode`}
        label="DHCP"
        checked={isDhcp}
        disabled={disabled}
        onChange={() => onChange({ mode: 'dhcp' })}
        className="mb-1"
      />
      <Form.Check
        type="radio"
        id={`${ifaceName}-static`}
        name={`${ifaceName}-mode`}
        label="Static IP"
        checked={!isDhcp}
        disabled={disabled}
        onChange={() => onChange({ mode: 'static' })}
        className="mb-3"
      />
      <Row>
        <Col sm={6}>
          <Form.Group className="mb-2">
            <Form.Label>IP Address</Form.Label>
            <Form.Control
              value={config.ipAddress || ''}
              disabled={disabled || isDhcp}
              onChange={(e) => onChange({ ipAddress: e.target.value })}
            />
          </Form.Group>
        </Col>
        <Col sm={6}>
          <Form.Group className="mb-2">
            <Form.Label>Subnet / CIDR</Form.Label>
            <Form.Control
              value={config.cidr || ''}
              disabled={disabled || isDhcp}
              onChange={(e) => onChange({ cidr: e.target.value })}
              placeholder="255.255.255.0"
            />
          </Form.Group>
        </Col>
      </Row>
      <Row>
        <Col sm={6}>
          <Form.Group className="mb-2">
            <Form.Label>Gateway</Form.Label>
            <Form.Control
              value={config.gateway || ''}
              disabled={disabled || isDhcp}
              onChange={(e) => onChange({ gateway: e.target.value })}
            />
          </Form.Group>
        </Col>
        <Col sm={6}>
          <Form.Group className="mb-2">
            <Form.Label>DNS 1</Form.Label>
            <Form.Control
              value={config.dns1 || ''}
              disabled={disabled || isDhcp}
              onChange={(e) => onChange({ dns1: e.target.value })}
            />
          </Form.Group>
        </Col>
      </Row>
      <Form.Group className="mb-2">
        <Form.Label>DNS 2</Form.Label>
        <Form.Control
          value={config.dns2 || ''}
          disabled={disabled || isDhcp}
          onChange={(e) => onChange({ dns2: e.target.value })}
        />
      </Form.Group>
    </div>
  );
}

export default function NetworkPage() {
  const [data, setData] = useState(null);
  const [form, setForm] = useState(null);
  const [message, setMessage] = useState(null);
  const [loading, setLoading] = useState(false);
  const [showApplyWarning, setShowApplyWarning] = useState(false);

  const load = () => api.getNetworkStatus().then((status) => {
    setData(status);
    setForm({
      hostname: status.saved?.hostname || status.hostname,
      eth0: { ...status.saved?.interfaces?.eth0 },
      wlan0: { ...status.saved?.interfaces?.wlan0 },
    });
  });

  useEffect(() => { load().catch(console.error); }, []);

  const updateIface = (iface, patch) => {
    setForm((prev) => ({
      ...prev,
      [iface]: { ...prev[iface], ...patch },
    }));
  };

  const handleSave = async () => {
    setLoading(true);
    setMessage(null);
    try {
      const result = await api.saveNetworkSettings(form);
      setData(result.data);
      setMessage({ type: 'success', text: 'Network settings saved to appliance configuration.' });
      load();
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setLoading(false);
    }
  };

  const handleApply = async () => {
    if (!showApplyWarning) {
      setShowApplyWarning(true);
      return;
    }
    setLoading(true);
    try {
      const result = await api.applyNetworkSettings();
      setMessage({ type: 'info', text: result.message });
      load();
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setLoading(false);
      setShowApplyWarning(false);
    }
  };

  const handleRestart = async () => {
    if (!window.confirm('Restart network services? This may briefly disconnect this session.')) return;
    setLoading(true);
    try {
      const result = await api.restartNetwork();
      setMessage({ type: result.success ? 'success' : 'error', text: result.message });
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setLoading(false);
    }
  };

  const handleTestGateway = async () => {
    setLoading(true);
    try {
      const result = await api.testGatewayPing();
      setMessage({
        type: result.success ? 'success' : 'error',
        text: result.success
          ? `Gateway ping OK — ${result.target} @ ${result.latencyMs}ms`
          : `Gateway ping failed — ${result.error || 'unreachable'}`,
      });
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setLoading(false);
    }
  };

  const handleTestDns = async () => {
    setLoading(true);
    try {
      const result = await api.testDns();
      setMessage({
        type: result.success ? 'success' : 'error',
        text: result.success ? `DNS test OK — ${result.dns || result.target}` : 'DNS test failed',
      });
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setLoading(false);
    }
  };

  if (!form || !data) return <LoadingState message="Loading network configuration…" />;

  const liveInterfaces = data.live?.interfaces || [];
  const applyStatus = data.applyStatus || data.saved?.applyStatus || 'none';

  return (
    <>
      <PageHeader title="Network" subtitle="Live interface status and staged network configuration" />

      {message && (
        <div className={`alert-sentry alert-sentry-${message.type === 'success' ? 'success' : message.type === 'info' ? 'info' : 'error'}`}>
          {message.text}
        </div>
      )}

      {showApplyWarning && (
        <div className="alert-sentry alert-sentry-warn">
          Changing IP settings may disconnect this session. Apply saves staged config only — OS-level changes are not automated in DEV-1.
          {' '}
          <button type="button" className="btn btn-sentry-danger btn-sm ms-2" onClick={handleApply} disabled={loading}>
            Confirm Apply
          </button>
          <button type="button" className="btn btn-sentry-secondary btn-sm ms-2" onClick={() => setShowApplyWarning(false)}>
            Cancel
          </button>
        </div>
      )}

      <Row>
        <Col lg={6}>
          <PanelCard title="Current Live Network">
            {liveInterfaces.map((iface) => (
              <div key={iface.name} className="mb-2">
                <KvRow
                  label={iface.name}
                  value={(
                    <>
                      <StatusBadge status={iface.status} label={iface.operstate || iface.status} />
                      {iface.ipv4 && <span className="mono ms-2">{iface.ipv4}</span>}
                    </>
                  )}
                />
                {iface.mac && <KvRow label="MAC" value={iface.mac} />}
              </div>
            ))}
            <KvRow label="Hostname (live)" value={data.live?.hostname} />
            <KvRow label="Primary IP" value={data.currentIp || '—'} />
          </PanelCard>
        </Col>

        <Col lg={6}>
          <PanelCard title="Saved Desired Configuration">
            <KvRow label="Apply Status" value={<StatusBadge status={applyStatus} label={applyStatus} />} />
            <KvRow label="Saved At" value={data.saved?.savedAt ? new Date(data.saved.savedAt).toLocaleString() : '—'} />
            <Form.Group className="mb-3 mt-2">
              <Form.Label>Hostname</Form.Label>
              <Form.Control
                value={form.hostname}
                onChange={(e) => setForm((prev) => ({ ...prev, hostname: e.target.value }))}
              />
            </Form.Group>
            <InterfaceConfigForm
              ifaceName="eth0"
              config={form.eth0}
              onChange={(patch) => updateIface('eth0', patch)}
            />
            <InterfaceConfigForm
              ifaceName="wlan0"
              config={form.wlan0}
              onChange={(patch) => updateIface('wlan0', patch)}
            />
          </PanelCard>
        </Col>
      </Row>

      <div className="action-bar">
        <button type="button" className="btn btn-sentry-primary" onClick={handleSave} disabled={loading}>
          Save Network Settings
        </button>
        <button type="button" className="btn btn-sentry-secondary" onClick={handleApply} disabled={loading}>
          Apply Network Settings
        </button>
        <button type="button" className="btn btn-sentry-secondary" onClick={handleRestart} disabled={loading}>
          Restart Network
        </button>
        <button type="button" className="btn btn-sentry-secondary" onClick={handleTestGateway} disabled={loading}>
          Test Gateway Ping
        </button>
        <button type="button" className="btn btn-sentry-secondary" onClick={handleTestDns} disabled={loading}>
          Test DNS
        </button>
      </div>
    </>
  );
}
