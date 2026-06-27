import { useEffect, useState } from 'react';
import { Col, Form, Row } from 'react-bootstrap';
import { api } from '../api/client';
import KvRow from '../components/common/KvRow';
import SectionCard from '../components/common/SectionCard';
import StatusChip from '../components/common/StatusChip';
import PageHeader from '../components/common/PageHeader';
import ActionButton from '../components/common/ActionButton';
import LoadingState from '../components/common/LoadingState';

const EMPTY_IFACE_CONFIG = {
  mode: 'dhcp',
  ipAddress: '',
  subnetMask: '',
  gateway: '',
  dns1: '',
  dns2: '',
};

const SUBNET_MASK_TO_CIDR = {
  '255.255.255.255': 32,
  '255.255.255.254': 31,
  '255.255.255.252': 30,
  '255.255.255.248': 29,
  '255.255.255.240': 28,
  '255.255.255.224': 27,
  '255.255.255.192': 26,
  '255.255.255.128': 25,
  '255.255.255.0': 24,
  '255.255.254.0': 23,
  '255.255.252.0': 22,
  '255.255.248.0': 21,
  '255.255.240.0': 20,
  '255.255.224.0': 19,
  '255.255.192.0': 18,
  '255.255.128.0': 17,
  '255.255.0.0': 16,
  '255.254.0.0': 15,
  '255.252.0.0': 14,
  '255.248.0.0': 13,
  '255.240.0.0': 12,
  '255.224.0.0': 11,
  '255.192.0.0': 10,
  '255.128.0.0': 9,
  '255.0.0.0': 8,
};

function subnetMaskToCidr(mask) {
  return SUBNET_MASK_TO_CIDR[String(mask).trim()] ?? null;
}

function isEth0Unavailable(iface) {
  if (!iface || iface.status === 'not_present') return true;
  if (iface.operstate === 'unavailable') return true;
  if (iface.operstate !== 'up' && !iface.ipv4) return true;
  return false;
}

function isWlan0Unavailable(iface) {
  if (!iface || iface.status === 'not_present') return true;
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
  const fieldsDisabled = loading || isDhcp;

  return (
    <SectionCard
      title={title}
      className="mb-3"
      status={(
        <StatusChip
          label={iface?.operstate || iface?.status || 'unknown'}
        />
      )}
    >
      <KvRow label="Interface" value={ifaceName} />
      <KvRow label="Address" value={iface?.ipv4 ? <span className="mono">{iface.ipv4}</span> : '—'} />
      {ifaceName === 'wlan0' && iface?.connection && (
        <KvRow label="Active connection" value={iface.connection} />
      )}

      {unavailable ? (
        <p className="text-muted mb-0 mt-2">{unavailableMessage}</p>
      ) : (
        <>
          <div className="form-section mt-3">
            <div className="d-flex gap-3 mb-3">
              <Form.Check
                type="radio"
                id={`${ifaceName}-dhcp`}
                name={`${ifaceName}-mode`}
                label="DHCP"
                checked={isDhcp}
                disabled={loading}
                onChange={() => onChange({ mode: 'dhcp' })}
              />
              <Form.Check
                type="radio"
                id={`${ifaceName}-static`}
                name={`${ifaceName}-mode`}
                label="Static IP"
                checked={!isDhcp}
                disabled={loading}
                onChange={() => onChange({ mode: 'static' })}
              />
            </div>
            <div className="form-grid form-grid--2">
              <div className="field-group">
                <label className="form-label">IP Address</label>
                <input className="form-control" value={config.ipAddress} disabled={fieldsDisabled} onChange={(e) => onChange({ ipAddress: e.target.value })} placeholder="192.168.1.48" />
              </div>
              <div className="field-group">
                <label className="form-label">Subnet Mask</label>
                <input className="form-control" value={config.subnetMask} disabled={fieldsDisabled} onChange={(e) => onChange({ subnetMask: e.target.value })} placeholder="255.255.255.0" />
              </div>
              <div className="field-group">
                <label className="form-label">Gateway</label>
                <input className="form-control" value={config.gateway} disabled={fieldsDisabled} onChange={(e) => onChange({ gateway: e.target.value })} placeholder="192.168.1.1" />
              </div>
              <div className="field-group">
                <label className="form-label">DNS 1</label>
                <input className="form-control" value={config.dns1} disabled={fieldsDisabled} onChange={(e) => onChange({ dns1: e.target.value })} placeholder="192.168.1.1" />
              </div>
              <div className="field-group">
                <label className="form-label">DNS 2</label>
                <input className="form-control" value={config.dns2} disabled={fieldsDisabled} onChange={(e) => onChange({ dns2: e.target.value })} placeholder="8.8.8.8" />
              </div>
            </div>
          </div>
          <div className="action-bar mt-3">
            <ActionButton variant="primary" size="sm" onClick={onApply} disabled={loading}>
              {ifaceName === 'eth0' ? 'Apply Ethernet Settings' : 'Apply WiFi Settings'}
            </ActionButton>
            <ActionButton size="sm" onClick={onRestoreDhcp} disabled={loading}>
              Restore DHCP
            </ActionButton>
          </div>
        </>
      )}
    </SectionCard>
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
      const subnetMask = config.subnetMask.trim();
      payload.ipAddress = config.ipAddress.trim();
      payload.subnetMask = subnetMask;
      const cidr = subnetMaskToCidr(subnetMask);
      if (cidr !== null) payload.cidr = cidr;
      const gateway = config.gateway.trim();
      if (gateway) payload.gateway = gateway;
      payload.dns = [config.dns1, config.dns2].map((d) => d.trim()).filter(Boolean);
    }
    return payload;
  };

  const handleApply = async (ifaceName, config) => {
    if (config.mode === 'static') {
      if (!config.ipAddress.trim() || !config.subnetMask.trim()) {
        setMessage({ type: 'error', text: 'Static configuration requires IP address and subnet mask. Gateway and DNS are optional.' });
        return;
      }
      if (subnetMaskToCidr(config.subnetMask.trim()) === null) {
        setMessage({ type: 'error', text: 'Subnet mask must be a valid value such as 255.255.255.0.' });
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
  const wlan0Unavailable = isWlan0Unavailable(wlan0);
  const managerName = manager?.manager || data.manager?.name || 'unknown';
  const wlanConnection = wlan0?.connection || manager?.connections?.find((c) => c.device === 'wlan0')?.name;

  return (
    <>
      <PageHeader
        title="Network"
        subtitle="Interface status, addressing, hostname and network tools."
        actions={(
          <ActionButton size="sm" onClick={handleRefreshInterfaces} disabled={loading}>
            Refresh Interfaces
          </ActionButton>
        )}
      />

      {message && (
        <div className={`alert-sentry alert-sentry-${message.type === 'success' ? 'success' : message.type === 'info' ? 'info' : 'error'} mb-3`}>
          {message.text}
        </div>
      )}

      <SectionCard title="Interface Status" className="mb-3">
        <KvRow
          label="eth0"
          value={(
            <>
              <StatusChip label={eth0?.operstate || eth0?.status || 'unavailable'} />
              {eth0?.ipv4 && <span className="mono ms-2">{eth0.ipv4}</span>}
            </>
          )}
        />
        {eth0?.mac && <KvRow label="eth0 MAC" value={eth0.mac} />}
        <KvRow
          label="wlan0"
          value={(
            <>
              <StatusChip label={wlan0?.operstate || wlan0?.status || 'unknown'} />
              {wlan0?.ipv4 && <span className="mono ms-2">{wlan0.ipv4}</span>}
            </>
          )}
        />
        {wlan0?.mac && <KvRow label="wlan0 MAC" value={wlan0.mac} />}
        <KvRow label="Current IPv4" value={data.currentIp || data.live?.primaryIp || '—'} />
        <KvRow label="Manager" value={managerName} />
        <KvRow label="Active connection" value={wlanConnection || eth0?.connection || '—'} />
        <KvRow label="Hostname" value={data.hostname || data.live?.hostname} />
      </SectionCard>

      <Row>
        <Col lg={6}>
          <InterfaceConfigCard
            title="Ethernet"
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
            title="WiFi"
            ifaceName="wlan0"
            iface={{ ...wlan0, connection: wlanConnection }}
            config={wlan0Config}
            onChange={(patch) => setWlan0Config((prev) => ({ ...prev, ...patch }))}
            onApply={() => handleApply('wlan0', wlan0Config)}
            onRestoreDhcp={() => handleRestoreDhcp('wlan0')}
            loading={loading}
            unavailableMessage={wlan0Unavailable ? 'No wireless interface detected.' : null}
          />
        </Col>
      </Row>

      <SectionCard title="Hostname" className="mb-3">
        <KvRow label="Current hostname" value={data.hostname || data.live?.hostname} />
        <div className="field-group mt-3" style={{ maxWidth: '320px' }}>
          <label className="form-label">Hostname</label>
          <input
            className="form-control"
            value={hostnameInput}
            disabled={loading}
            onChange={(e) => setHostnameInput(e.target.value)}
            placeholder="sentry-dev-1"
          />
        </div>
        <div className="action-bar mt-3">
          <ActionButton variant="primary" size="sm" onClick={handleSaveHostname} disabled={loading}>
            Save Hostname
          </ActionButton>
        </div>
      </SectionCard>

      <SectionCard title="Network Tools" className="mb-3">
        <div className="action-bar">
          <ActionButton size="sm" onClick={handleTestGateway} disabled={loading}>
            Test Gateway Ping
          </ActionButton>
          <ActionButton size="sm" onClick={handleTestDns} disabled={loading}>
            Test DNS
          </ActionButton>
          <ActionButton size="sm" onClick={handleRefreshInterfaces} disabled={loading}>
            Refresh Interfaces
          </ActionButton>
          <ActionButton variant="danger" size="sm" onClick={handleReboot} disabled={loading}>
            Reboot Device
          </ActionButton>
        </div>
      </SectionCard>
    </>
  );
}
