import { useEffect, useState } from 'react';
import { Col, Form, Row } from 'react-bootstrap';
import { api } from '../api/client';
import KvRow from '../components/common/KvRow';
import PanelCard from '../components/common/PanelCard';
import StatusBadge from '../components/common/StatusBadge';
import LoadingState from '../components/common/LoadingState';

const EMPTY_IFACE_CONFIG = {
  mode: 'dhcp',
  ipAddress: '',
  cidr: '',
  gateway: '',
  dns1: '',
  dns2: '',
};

function isEth0Unavailable(iface) {
  if (!iface || iface.status === 'not_present') return true;
  if (iface.operstate === 'unavailable') return true;
  if (iface.operstate !== 'up' && !iface.ipv4) return true;
  return false;
}

function isInterfaceServingSession(iface) {
  if (!iface?.ipv4) return false;
  const host = window.location.hostname;
  if (!host || host === 'localhost' || host === '127.0.0.1') return false;
  return iface.ipv4 === host;
}

function InterfaceConfigCard({
  title,
  ifaceName,
  iface,
  config,
  onChange,
  onApply,
  onRestoreDhcp,
  loading,
  unavailableMessage,
}) {
  const isDhcp = config.mode === 'dhcp';
  const unavailable = Boolean(unavailableMessage);

  return (
    <PanelCard title={title} className="mb-3">
      <KvRow label="Interface" value={ifaceName} />
      <KvRow
        label="Status"
        value={(
          <>
            <StatusBadge status={iface?.status || 'down'} label={iface?.operstate || iface?.status || 'unknown'} />
            {iface?.ipv4 && <span className="mono ms-2">{iface.ipv4}</span>}
          </>
        )}
      />
      {ifaceName === 'wlan0' && iface?.connection && (
        <KvRow label="Active connection" value={iface.connection} />
      )}
      {ifaceName === 'wlan0' && iface?.ipv4 && (
        <KvRow label="Current IP" value={iface.ipv4} />
      )}

      {unavailable ? (
        <p className="text-muted mb-0 mt-2">{unavailableMessage}</p>
      ) : (
        <>
          <div className="interface-config-form mt-3">
            <Form.Check
              type="radio"
              id={`${ifaceName}-dhcp`}
              name={`${ifaceName}-mode`}
              label="DHCP"
              checked={isDhcp}
              disabled={loading}
              onChange={() => onChange({ mode: 'dhcp' })}
              className="mb-1"
            />
            <Form.Check
              type="radio"
              id={`${ifaceName}-static`}
              name={`${ifaceName}-mode`}
              label="Static IP"
              checked={!isDhcp}
              disabled={loading}
              onChange={() => onChange({ mode: 'static' })}
              className="mb-3"
            />
            <Row>
              <Col sm={6}>
                <Form.Group className="mb-2">
                  <Form.Label>IP Address</Form.Label>
                  <Form.Control
                    value={config.ipAddress}
                    disabled={loading || isDhcp}
                    onChange={(e) => onChange({ ipAddress: e.target.value })}
                    placeholder="192.168.1.48"
                  />
                </Form.Group>
              </Col>
              <Col sm={6}>
                <Form.Group className="mb-2">
                  <Form.Label>CIDR</Form.Label>
                  <Form.Control
                    value={config.cidr}
                    disabled={loading || isDhcp}
                    onChange={(e) => onChange({ cidr: e.target.value })}
                    placeholder="24"
                  />
                </Form.Group>
              </Col>
            </Row>
            <Row>
              <Col sm={6}>
                <Form.Group className="mb-2">
                  <Form.Label>Gateway</Form.Label>
                  <Form.Control
                    value={config.gateway}
                    disabled={loading || isDhcp}
                    onChange={(e) => onChange({ gateway: e.target.value })}
                    placeholder="192.168.1.1"
                  />
                </Form.Group>
              </Col>
              <Col sm={6}>
                <Form.Group className="mb-2">
                  <Form.Label>DNS 1</Form.Label>
                  <Form.Control
                    value={config.dns1}
                    disabled={loading || isDhcp}
                    onChange={(e) => onChange({ dns1: e.target.value })}
                    placeholder="192.168.1.1"
                  />
                </Form.Group>
              </Col>
            </Row>
            <Form.Group className="mb-2">
              <Form.Label>DNS 2</Form.Label>
              <Form.Control
                value={config.dns2}
                disabled={loading || isDhcp}
                onChange={(e) => onChange({ dns2: e.target.value })}
                placeholder="8.8.8.8"
              />
            </Form.Group>
          </div>
          <div className="action-bar mt-2">
            <button
              type="button"
              className="btn btn-sentry-primary btn-sm"
              onClick={onApply}
              disabled={loading}
            >
              {ifaceName === 'eth0' ? 'Apply Ethernet Settings' : 'Apply WiFi Settings'}
            </button>
            <button
              type="button"
              className="btn btn-sentry-secondary btn-sm"
              onClick={onRestoreDhcp}
              disabled={loading}
            >
              Restore DHCP
            </button>
          </div>
        </>
      )}
    </PanelCard>
  );
}

export default function NetworkPage() {
  const [data, setData] = useState(null);
  const [manager, setManager] = useState(null);
  const [eth0Config, setEth0Config] = useState(EMPTY_IFACE_CONFIG);
  const [wlan0Config, setWlan0Config] = useState(EMPTY_IFACE_CONFIG);
  const [hostnameInput, setHostnameInput] = useState('');
  const [message, setMessage] = useState(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    const [status, managerInfo] = await Promise.all([
      api.getNetworkStatus(),
      api.getNetworkManager(),
    ]);
    setData(status);
    setManager(managerInfo);
    setHostnameInput(status.hostname || status.live?.hostname || '');
  };

  useEffect(() => {
    load().catch((err) => setMessage({ type: 'error', text: err.message }));
  }, []);

  const refreshAfterDelay = () => {
    setTimeout(() => {
      load().catch(console.error);
    }, 4000);
  };

  const buildApplyPayload = (ifaceName, config) => {
    const payload = {
      interface: ifaceName,
      mode: config.mode,
    };
    if (config.mode === 'static') {
      payload.ipAddress = config.ipAddress.trim();
      payload.cidr = Number(config.cidr);
      payload.gateway = config.gateway.trim();
      payload.dns = [config.dns1, config.dns2].map((d) => d.trim()).filter(Boolean);
    }
    return payload;
  };

  const handleApply = async (ifaceName, config) => {
    if (config.mode === 'static') {
      if (!config.ipAddress || !config.cidr || !config.gateway || !config.dns1) {
        setMessage({ type: 'error', text: 'Static configuration requires IP address, CIDR, gateway, and at least one DNS server.' });
        return;
      }
    }

    const iface = ifaceName === 'eth0' ? data?.eth0 : data?.wlan0;
    const serving = isInterfaceServingSession(iface);
    const baseWarning = 'Applying network settings may disconnect your current session. Continue?';
    const strongWarning = 'You are changing the active interface currently used to access Sentry. If the IP changes, reconnect using the new address. Continue?';

    if (!window.confirm(serving ? strongWarning : baseWarning)) return;

    setLoading(true);
    setMessage(null);
    try {
      const result = await api.applyNetworkSettings(buildApplyPayload(ifaceName, config));
      setMessage({ type: 'success', text: result.message });
      refreshAfterDelay();
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setLoading(false);
    }
  };

  const handleRestoreDhcp = async (ifaceName) => {
    if (!window.confirm(`Restore DHCP on ${ifaceName}?`)) return;
    setLoading(true);
    setMessage(null);
    try {
      const result = await api.restoreDhcp(ifaceName);
      setMessage({ type: 'success', text: result.message });
      refreshAfterDelay();
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setLoading(false);
    }
  };

  const handleSaveHostname = async () => {
    setLoading(true);
    setMessage(null);
    try {
      const result = await api.setHostname(hostnameInput);
      setMessage({ type: 'success', text: result.message });
      load();
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setLoading(false);
    }
  };

  const handleReboot = async () => {
    if (!window.confirm('Rebooting Sentry will disconnect all sessions. Continue?')) return;
    setLoading(true);
    setMessage(null);
    try {
      const result = await api.rebootDevice();
      setMessage({ type: 'info', text: result.message });
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setLoading(false);
    }
  };

  const handleTestGateway = async () => {
    setLoading(true);
    setMessage(null);
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
    setMessage(null);
    try {
      const result = await api.testDns();
      setMessage({
        type: result.success ? 'success' : 'error',
        text: result.success ? `DNS test OK — ${result.resolved || result.dns}` : 'DNS test failed',
      });
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setLoading(false);
    }
  };

  const handleRefreshInterfaces = async () => {
    setLoading(true);
    setMessage(null);
    try {
      await load();
      setMessage({ type: 'success', text: 'Interface data refreshed.' });
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setLoading(false);
    }
  };

  if (!data) return <LoadingState message="Loading network configuration…" />;

  const eth0 = data.eth0;
  const wlan0 = data.wlan0;
  const eth0Unavailable = isEth0Unavailable(eth0);
  const managerName = manager?.manager || data.manager?.name || 'unknown';
  const wlanConnection = wlan0?.connection || manager?.connections?.find((c) => c.device === 'wlan0')?.name;

  return (
    <>
      {message && (
        <div className={`alert-sentry alert-sentry-${message.type === 'success' ? 'success' : message.type === 'info' ? 'info' : 'error'} mb-3`}>
          {message.text}
        </div>
      )}

      <PanelCard title="Interface Status" className="mb-3">
        <KvRow
          label="eth0"
          value={(
            <>
              <StatusBadge status={eth0?.status || 'down'} label={eth0?.operstate || eth0?.status || 'unavailable'} />
              {eth0?.ipv4 && <span className="mono ms-2">{eth0.ipv4}</span>}
            </>
          )}
        />
        {eth0?.mac && <KvRow label="eth0 MAC" value={eth0.mac} />}
        <KvRow
          label="wlan0"
          value={(
            <>
              <StatusBadge status={wlan0?.status || 'down'} label={wlan0?.operstate || wlan0?.status || 'unknown'} />
              {wlan0?.ipv4 && <span className="mono ms-2">{wlan0.ipv4}</span>}
            </>
          )}
        />
        {wlan0?.mac && <KvRow label="wlan0 MAC" value={wlan0.mac} />}
        <KvRow label="Current IPv4" value={data.currentIp || data.live?.primaryIp || '—'} />
        <KvRow label="Manager" value={managerName} />
        <KvRow label="Active connection" value={wlanConnection || eth0?.connection || '—'} />
        <KvRow label="Hostname" value={data.hostname || data.live?.hostname} />
        <KvRow label="Primary IP" value={data.currentIp || '—'} />
      </PanelCard>

      <Row>
        <Col lg={6}>
          <InterfaceConfigCard
            title="Ethernet Configuration"
            ifaceName="eth0"
            iface={eth0}
            config={eth0Config}
            onChange={(patch) => setEth0Config((prev) => ({ ...prev, ...patch }))}
            onApply={() => handleApply('eth0', eth0Config)}
            onRestoreDhcp={() => handleRestoreDhcp('eth0')}
            loading={loading}
            unavailableMessage={eth0Unavailable ? 'Ethernet is not connected.' : null}
          />
        </Col>
        <Col lg={6}>
          <InterfaceConfigCard
            title="WiFi Configuration"
            ifaceName="wlan0"
            iface={{ ...wlan0, connection: wlanConnection }}
            config={wlan0Config}
            onChange={(patch) => setWlan0Config((prev) => ({ ...prev, ...patch }))}
            onApply={() => handleApply('wlan0', wlan0Config)}
            onRestoreDhcp={() => handleRestoreDhcp('wlan0')}
            loading={loading}
          />
        </Col>
      </Row>

      <PanelCard title="Hostname" className="mb-3">
        <KvRow label="Current hostname" value={data.hostname || data.live?.hostname} />
        <Form.Group className="mb-3 mt-2">
          <Form.Label>Hostname</Form.Label>
          <Form.Control
            value={hostnameInput}
            disabled={loading}
            onChange={(e) => setHostnameInput(e.target.value)}
            placeholder="sentry-dev-1"
          />
        </Form.Group>
        <p className="text-muted small mb-2">Hostname change may require reconnect or reboot.</p>
        <button type="button" className="btn btn-sentry-primary btn-sm" onClick={handleSaveHostname} disabled={loading}>
          Save Hostname
        </button>
      </PanelCard>

      <PanelCard title="Network Tools" className="mb-3">
        <div className="action-bar">
          <button type="button" className="btn btn-sentry-secondary btn-sm" onClick={handleTestGateway} disabled={loading}>
            Test Gateway Ping
          </button>
          <button type="button" className="btn btn-sentry-secondary btn-sm" onClick={handleTestDns} disabled={loading}>
            Test DNS
          </button>
          <button type="button" className="btn btn-sentry-secondary btn-sm" onClick={handleRefreshInterfaces} disabled={loading}>
            Refresh Interfaces
          </button>
        </div>
      </PanelCard>

      <PanelCard title="Network Actions">
        <div className="action-bar">
          <button type="button" className="btn btn-sentry-danger btn-sm" onClick={handleReboot} disabled={loading}>
            Reboot Device
          </button>
        </div>
      </PanelCard>
    </>
  );
}
