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
  macAddress: 3,
  maxMaster: 127,
  maxInfoFrames: 1,
  networkNumber: 2,
  timeoutMs: 20000,
  whoIsRetries: 5,
  retryIntervalMs: 3000,
  tokenMode: false,
  directedWhoIsEnabled: false,
  directedWhoIsMacs: '',
  extraDiscoveryRetriesEnabled: false,
  preListenMs: 1000,
  postSendListenMs: 3000,
};

const MSTP_FRAME_TYPE = {
  TOKEN: 0,
  POLL_FOR_MASTER: 1,
  REPLY_TO_POLL_FOR_MASTER: 2,
};

const MSTP_STATUS_META = {
  seen_latest_scan: { variant: 'running', label: 'Seen latest scan' },
  recently_seen: { variant: 'warn', label: 'Recently seen' },
  stale: { variant: 'stopped', label: 'Not rediscovered' },
  never_confirmed: { variant: 'stopped', label: 'Unknown' },
};

function mstpStatusBadge(device) {
  const meta = MSTP_STATUS_META[device.mstpStatus] || MSTP_STATUS_META.never_confirmed;
  const title = device.mstpStatus === 'stale'
    ? 'Known inventory device, but it did not answer the latest Who-Is scan.'
    : undefined;
  return (
    <span className={`status-badge badge-${meta.variant}`} title={title}>
      {meta.label}
    </span>
  );
}

function validateMstpForm(form, { frames = [], devices = [] } = {}) {
  const errors = [];
  const warnings = [];

  const mac = Number(form.macAddress);
  const maxMaster = Number(form.maxMaster);
  const maxInfoFrames = Number(form.maxInfoFrames);
  const networkNumber = Number(form.networkNumber);
  const timeoutMs = Number(form.timeoutMs);
  const whoIsRetries = Number(form.whoIsRetries);
  const retryIntervalMs = Number(form.retryIntervalMs);

  if (!Number.isInteger(mac) || mac < 0 || mac > 127) {
    errors.push('MAC Address must be an integer between 0 and 127.');
  }
  if (!Number.isInteger(maxMaster) || maxMaster < 0 || maxMaster > 127) {
    errors.push('Max Master must be an integer between 0 and 127.');
  }
  if (Number.isInteger(mac) && Number.isInteger(maxMaster) && maxMaster < mac) {
    errors.push('Max Master must be greater than or equal to MAC Address.');
  }
  if (!Number.isInteger(maxInfoFrames) || maxInfoFrames < 1) {
    errors.push('Max Info Frames must be an integer >= 1.');
  }
  if (!Number.isInteger(networkNumber) || networkNumber < 1) {
    errors.push('Network Number must be an integer >= 1.');
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1000 || timeoutMs > 120000) {
    errors.push('Timeout must be between 1000 and 120000 ms.');
  }
  if (!Number.isInteger(whoIsRetries) || whoIsRetries < 1 || whoIsRetries > 20) {
    errors.push('Who-Is retries must be an integer between 1 and 20.');
  }
  if (!Number.isFinite(retryIntervalMs) || retryIntervalMs < 250 || retryIntervalMs >= timeoutMs) {
    errors.push('Retry interval must be between 250 ms and less than timeout.');
  }

  if (mac === 0) {
    warnings.push('MAC Address 0 is typically reserved — confirm before proceeding.');
  }

  if (Number.isInteger(mac)) {
    const frameConflict = frames.some((f) => f.sourceMac === mac);
    const deviceConflict = devices.some((d) => {
      if (!isMstp(d)) return false;
      const deviceMac = d.mstpMacAddress ?? d.macAddress;
      return deviceMac === mac;
    });
    if (frameConflict || deviceConflict) {
      warnings.push(`MAC conflict: MAC ${mac} is already active on the bus.`);
    }
  }

  return { valid: errors.length === 0, errors, warnings, macZeroConfirm: mac === 0 };
}

function computeScanSummary(frames) {
  const sourceMacs = new Set();
  let headerCrcFailures = 0;
  let dataCrcFailures = 0;
  let parseErrors = 0;
  let tokenFrames = 0;
  let pollForMasterFrames = 0;
  let replyToPollForMasterFrames = 0;

  for (const frame of frames) {
    if (frame.headerCrcValid === false) headerCrcFailures += 1;
    if (frame.dataCrcValid === false) dataCrcFailures += 1;
    if (frame.parseError) parseErrors += 1;
    if (frame.sourceMac != null) sourceMacs.add(frame.sourceMac);
    if (frame.frameType === MSTP_FRAME_TYPE.TOKEN) tokenFrames += 1;
    if (frame.frameType === MSTP_FRAME_TYPE.POLL_FOR_MASTER) pollForMasterFrames += 1;
    if (frame.frameType === MSTP_FRAME_TYPE.REPLY_TO_POLL_FOR_MASTER) {
      replyToPollForMasterFrames += 1;
    }
  }

  return {
    totalFrames: frames.length,
    headerCrcFailures,
    dataCrcFailures,
    parseErrors,
    uniqueSourceMacs: sourceMacs.size,
    tokenFrames,
    pollForMasterFrames,
    replyToPollForMasterFrames,
  };
}

function computeMacActivity(frames, localMacAddress) {
  const byMac = new Map();

  for (const frame of frames) {
    const mac = frame.sourceMac;
    if (mac == null) continue;

    if (!byMac.has(mac)) {
      byMac.set(mac, {
        sourceMac: mac,
        frameCount: 0,
        lastSeen: frame.timestamp,
        frameTypes: new Set(),
      });
    }

    const entry = byMac.get(mac);
    entry.frameCount += 1;
    if (frame.timestamp && (!entry.lastSeen || frame.timestamp > entry.lastSeen)) {
      entry.lastSeen = frame.timestamp;
    }
    if (frame.frameTypeLabel) {
      entry.frameTypes.add(frame.frameTypeLabel);
    }
  }

  return Array.from(byMac.values())
    .map((entry) => ({
      sourceMac: entry.sourceMac,
      frameCount: entry.frameCount,
      lastSeen: entry.lastSeen,
      frameTypesSeen: [...entry.frameTypes].join(', ') || '—',
      conflict: entry.sourceMac === localMacAddress,
    }))
    .sort((a, b) => a.sourceMac - b.sourceMac);
}

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

function isMstp(device) {
  return device.transport === 'BACnet MS/TP' || device.transport === 'mstp';
}

function mstpMac(device) {
  if (!isMstp(device)) return '—';
  const mac = device.mstpMacAddress ?? device.macAddress;
  return mac != null ? mac : '—';
}

function mstpNetwork(device) {
  if (!isMstp(device)) return device.networkNumber ?? '—';
  return device.configuredNetworkNumber ?? device.networkNumber ?? '—';
}

function crcBadge(valid) {
  if (valid == null) return <span style={{ color: '#58677d' }}>—</span>;
  return valid
    ? <span className="status-badge badge-running">OK</span>
    : <span className="status-badge badge-error">FAIL</span>;
}

export default function BacnetPage() {
  const navigate = useNavigate();
  const [bacnetStatus, setBacnetStatus] = useState(null);
  const [mstpStatus, setMstpStatus] = useState(null);
  const [devices, setDevices] = useState([]);
  const [logs, setLogs] = useState([]);
  const [frames, setFrames] = useState([]);
  const [latestSessionId, setLatestSessionId] = useState(null);
  const [mstpForm, setMstpForm] = useState(DEFAULT_MSTP);
  const [ipForm, setIpForm] = useState(null);
  const [message, setMessage] = useState(null);
  const [loading, setLoading] = useState(false);
  const [missedDevices, setMissedDevices] = useState([]);

  const load = useCallback(async () => {
    const [status, mstp, deviceData, logData, frameData] = await Promise.all([
      api.getBacnetStatus(),
      api.getBacnetMstpStatus(),
      api.getDevices(),
      api.getBacnetMstpLogs(),
      api.getBacnetMstpFrames(),
    ]);
    setBacnetStatus(status);
    setMstpStatus(mstp.status);
    setDevices(deviceData.devices || []);
    setLatestSessionId(deviceData.latestDiscoverySessionId || null);
    setLogs(logData.logs || []);
    setFrames(frameData.frames || []);
    setIpForm({
      enabled: status.ip.enabled,
      deviceInstance: status.ip.deviceInstance,
      udpPort: status.ip.udpPort,
      networkNumber: status.ip.networkNumber,
    });

    const activeStatus = mstp.status?.open ? mstp.status : null;
    const savedConfig = status.mstp || {};

    setMstpForm({
      port: activeStatus?.port || savedConfig.serialPort || DEFAULT_MSTP.port,
      baudRate: activeStatus?.baudRate ?? savedConfig.baudRate ?? DEFAULT_MSTP.baudRate,
      macAddress: activeStatus?.macAddress ?? savedConfig.macAddress ?? DEFAULT_MSTP.macAddress,
      maxMaster: activeStatus?.maxMaster ?? savedConfig.maxMaster ?? DEFAULT_MSTP.maxMaster,
      maxInfoFrames: activeStatus?.maxInfoFrames ?? savedConfig.maxInfoFrames ?? DEFAULT_MSTP.maxInfoFrames,
      networkNumber: activeStatus?.networkNumber ?? savedConfig.networkNumber ?? DEFAULT_MSTP.networkNumber,
      timeoutMs: activeStatus?.timeoutMs ?? savedConfig.timeoutMs ?? DEFAULT_MSTP.timeoutMs,
      whoIsRetries: activeStatus?.whoIsRetries ?? savedConfig.whoIsRetries ?? DEFAULT_MSTP.whoIsRetries,
      retryIntervalMs: activeStatus?.retryIntervalMs ?? savedConfig.retryIntervalMs ?? DEFAULT_MSTP.retryIntervalMs,
      tokenMode: activeStatus?.tokenMode ?? savedConfig.tokenMode ?? DEFAULT_MSTP.tokenMode,
      directedWhoIsEnabled: savedConfig.directedWhoIsEnabled ?? DEFAULT_MSTP.directedWhoIsEnabled,
      directedWhoIsMacs: savedConfig.directedWhoIsMacs ?? DEFAULT_MSTP.directedWhoIsMacs,
      extraDiscoveryRetriesEnabled: savedConfig.extraDiscoveryRetriesEnabled
        ?? savedConfig.extraFecRetryEnabled
        ?? DEFAULT_MSTP.extraDiscoveryRetriesEnabled,
      preListenMs: savedConfig.preListenMs ?? DEFAULT_MSTP.preListenMs,
      postSendListenMs: savedConfig.postSendListenMs ?? DEFAULT_MSTP.postSendListenMs,
    });
  }, []);

  useEffect(() => {
    load().catch((err) => setMessage({ type: 'error', text: err.message }));
  }, [load]);

  const refreshLogs = async () => {
    const [logData, frameData] = await Promise.all([
      api.getBacnetMstpLogs(),
      api.getBacnetMstpFrames(),
    ]);
    setLogs(logData.logs || []);
    setFrames(frameData.frames || []);
  };

  const updateMstp = (field, value) => {
    setMstpForm((prev) => ({ ...prev, [field]: value }));
  };

  const runMstpValidation = () => validateMstpForm(mstpForm, { frames, devices });

  const confirmMstpAction = (validation) => {
    if (!validation.valid) {
      setMessage({ type: 'error', text: validation.errors.join(' ') });
      return false;
    }
    if (validation.macZeroConfirm) {
      const confirmed = window.confirm(
        'MAC Address 0 is typically reserved on MS/TP networks. Continue anyway?',
      );
      if (!confirmed) return false;
    }
    if (validation.warnings.length > 0) {
      setMessage({ type: 'info', text: validation.warnings.join(' ') });
    }
    return true;
  };

  const handleSaveMstpConfig = async () => {
    const validation = runMstpValidation();
    if (!validation.valid) {
      setMessage({ type: 'error', text: validation.errors.join(' ') });
      return;
    }
    if (validation.macZeroConfirm) {
      const confirmed = window.confirm(
        'MAC Address 0 is typically reserved on MS/TP networks. Save this configuration anyway?',
      );
      if (!confirmed) return;
    }

    setLoading(true);
    setMessage(null);
    try {
      await api.saveBacnetSettings({
        mstp: {
          serialPort: mstpForm.port,
          baudRate: mstpForm.baudRate,
          macAddress: mstpForm.macAddress,
          maxMaster: mstpForm.maxMaster,
          maxInfoFrames: mstpForm.maxInfoFrames,
          networkNumber: mstpForm.networkNumber,
          timeoutMs: mstpForm.timeoutMs,
          whoIsRetries: mstpForm.whoIsRetries,
          retryIntervalMs: mstpForm.retryIntervalMs,
          tokenMode: mstpForm.tokenMode,
          directedWhoIsEnabled: mstpForm.directedWhoIsEnabled,
          directedWhoIsMacs: mstpForm.directedWhoIsMacs,
          extraDiscoveryRetriesEnabled: mstpForm.extraDiscoveryRetriesEnabled,
          preListenMs: mstpForm.preListenMs,
          postSendListenMs: mstpForm.postSendListenMs,
        },
      });
      await load();
      const saveWarnings = validation.warnings.length > 0
        ? ` ${validation.warnings.join(' ')}`
        : '';
      setMessage({ type: 'success', text: `MS/TP configuration saved.${saveWarnings}` });
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setLoading(false);
    }
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
    const validation = runMstpValidation();
    if (!confirmMstpAction(validation)) return;

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
    const validation = runMstpValidation();
    if (!confirmMstpAction(validation)) return;

    setLoading(true);
    if (validation.warnings.length === 0) {
      setMessage(null);
    }
    try {
      const result = await api.discoverBacnetMstp({ ...mstpForm });
      await load();
      const seen = result.devices?.length ?? 0;
      const missed = result.missedDevices || [];
      const totalInventory = result.inventoryTotals?.mstp ?? '—';
      setMissedDevices(missed);
      const warningText = result.warnings?.length ? ` ${result.warnings.join(' ')}` : '';
      const summaryText = `BACnet MS/TP discovery complete — ${seen} seen, ${missed.length} not rediscovered, ${totalInventory} total inventory, completed in ${result.durationMs}ms.`;
      setMessage({
        type: seen > 0 ? 'success' : 'info',
        text: `${summaryText}${warningText}`,
      });
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

  const handleClearSession = async () => {
    setLoading(true);
    setMessage(null);
    try {
      await api.clearBacnetMstpSession();
      await load();
      setMissedDevices([]);
      setMessage({
        type: 'success',
        text: 'Latest scan results cleared. Device inventory was preserved.',
      });
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
  const scanSummary = computeScanSummary(frames);
  const macActivity = computeMacActivity(frames, mstpForm.macAddress);

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
            <Row>
              <Col sm={4}>
                <Form.Group className="mb-2">
                  <Form.Label>Timeout (ms)</Form.Label>
                  <Form.Control
                    type="number"
                    value={mstpForm.timeoutMs}
                    onChange={(e) => updateMstp('timeoutMs', Number(e.target.value))}
                  />
                </Form.Group>
              </Col>
              <Col sm={4}>
                <Form.Group className="mb-2">
                  <Form.Label>Who-Is Retries</Form.Label>
                  <Form.Control
                    type="number"
                    value={mstpForm.whoIsRetries}
                    onChange={(e) => updateMstp('whoIsRetries', Number(e.target.value))}
                  />
                </Form.Group>
              </Col>
              <Col sm={4}>
                <Form.Group className="mb-2">
                  <Form.Label>Retry Interval (ms)</Form.Label>
                  <Form.Control
                    type="number"
                    value={mstpForm.retryIntervalMs}
                    onChange={(e) => updateMstp('retryIntervalMs', Number(e.target.value))}
                  />
                </Form.Group>
              </Col>
            </Row>
            <Form.Group className="mb-2">
              <Form.Check
                type="checkbox"
                id="mstp-token-mode"
                label="Token Mode (not implemented — send-only discovery used)"
                checked={Boolean(mstpForm.tokenMode)}
                onChange={(e) => updateMstp('tokenMode', e.target.checked)}
              />
            </Form.Group>
            <p style={{ color: '#58677d', marginBottom: '0.5rem', marginTop: '0.25rem' }}>Discovery timing</p>
            <Row>
              <Col sm={6}>
                <Form.Group className="mb-2">
                  <Form.Label>Pre-listen delay (ms)</Form.Label>
                  <Form.Control
                    type="number"
                    value={mstpForm.preListenMs}
                    onChange={(e) => updateMstp('preListenMs', Number(e.target.value))}
                  />
                </Form.Group>
              </Col>
              <Col sm={6}>
                <Form.Group className="mb-2">
                  <Form.Label>Post-send listen window (ms)</Form.Label>
                  <Form.Control
                    type="number"
                    value={mstpForm.postSendListenMs}
                    onChange={(e) => updateMstp('postSendListenMs', Number(e.target.value))}
                  />
                </Form.Group>
              </Col>
            </Row>
            <Form.Group className="mb-2">
              <Form.Check
                type="checkbox"
                id="mstp-extended-discovery-retries"
                label="Extended discovery retries"
                checked={Boolean(mstpForm.extraDiscoveryRetriesEnabled)}
                onChange={(e) => updateMstp('extraDiscoveryRetriesEnabled', e.target.checked)}
              />
              <Form.Text muted>
                Send additional Who-Is attempts during the scan window for slower or intermittently responding MS/TP devices.
              </Form.Text>
            </Form.Group>
            <Form.Group className="mb-2">
              <Form.Check
                type="checkbox"
                id="mstp-directed-whois"
                label="Directed Who-Is (not implemented — broadcast discovery only)"
                checked={Boolean(mstpForm.directedWhoIsEnabled)}
                onChange={(e) => updateMstp('directedWhoIsEnabled', e.target.checked)}
              />
            </Form.Group>
            <Form.Group className="mb-2">
              <Form.Label>Directed Who-Is MACs (comma separated)</Form.Label>
              <Form.Control
                value={mstpForm.directedWhoIsMacs}
                placeholder="e.g. 7, 12"
                onChange={(e) => updateMstp('directedWhoIsMacs', e.target.value)}
                disabled={!mstpForm.directedWhoIsEnabled}
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
            <KvRow label="Token Mode" value={mstp.tokenMode ? 'Enabled' : 'Disabled'} />
            <KvRow
              label="Token Participation"
              value={mstp.tokenParticipationImplemented ? 'Implemented' : 'Not implemented'}
            />
            <KvRow label="Last Activity" value={formatTime(mstp.lastActivityAt)} />
            <KvRow label="Last Error" value={mstp.lastError || '—'} />
            <div className="action-bar mt-3">
              <button type="button" className="btn btn-sentry-secondary" onClick={handleSaveMstpConfig} disabled={loading}>
                Save MS/TP Config
              </button>
              <button type="button" className="btn btn-sentry-primary" onClick={handleOpenMstp} disabled={loading || interfaceOpen}>
                Open Interface
              </button>
              <button type="button" className="btn btn-sentry-secondary" onClick={handleCloseMstp} disabled={loading || !interfaceOpen}>
                Close Interface
              </button>
              <button type="button" className="btn btn-sentry-primary" onClick={handleDiscoverMstp} disabled={loading}>
                Discover BACnet MS/TP
              </button>
              <button type="button" className="btn btn-sentry-secondary" onClick={handleClearSession} disabled={loading}>
                Clear Latest Scan
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
                <th>Network</th>
                <th>MS/TP MAC</th>
                <th>Device Instance</th>
                <th>Object Name</th>
                <th>Vendor</th>
                <th>Model</th>
                <th>First Seen</th>
                <th>Last Seen</th>
                <th>Sightings</th>
                <th>Missed Scans</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {devices.map((device) => {
                const mstpDevice = isMstp(device);
                const seenLatest = Boolean(latestSessionId)
                  && device.discoverySessionId === latestSessionId;
                return (
                  <tr key={device.id}>
                    <td>
                      {mstpDevice ? (
                        mstpStatusBadge(device)
                      ) : (
                        <>
                          <StatusBadge status={device.status} />
                          {seenLatest && (
                            <span
                              className="status-badge badge-running"
                              style={{ marginLeft: '0.4rem' }}
                              title="Responded in the most recent scan"
                            >
                              Seen in latest scan
                            </span>
                          )}
                        </>
                      )}
                    </td>
                    <td>{device.network || device.transport}</td>
                    <td>{mstpNetwork(device)}</td>
                    <td className="mono">{mstpMac(device)}</td>
                    <td>{device.deviceInstance}</td>
                    <td>{device.objectName || '—'}</td>
                    <td>{device.vendor || device.vendorName || '—'}</td>
                    <td>{device.model || device.modelName || '—'}</td>
                    <td>{mstpDevice ? formatLastSeen(device.firstSeenAt) : '—'}</td>
                    <td>{formatLastSeen(device.lastSeen || device.lastSeenAt)}</td>
                    <td>{mstpDevice ? (device.sightings ?? '—') : '—'}</td>
                    <td>{mstpDevice ? (device.missedScans ?? 0) : '—'}</td>
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
                );
              })}
            </tbody>
          </Table>
        )}
      </PanelCard>

      {missedDevices.length > 0 && (
        <PanelCard title="Missed Devices" className="mt-3">
          <p style={{ color: '#58677d', marginTop: 0, marginBottom: '0.75rem' }}>
            Device is still in inventory but was not seen in latest scan.
          </p>
          <Table responsive className="sentry-table mb-0">
            <thead>
              <tr>
                <th>MAC</th>
                <th>Device Instance</th>
                <th>Last Seen</th>
                <th>Missed Scans</th>
              </tr>
            </thead>
            <tbody>
              {missedDevices.map((missed) => (
                <tr key={`${missed.mstpMacAddress}-${missed.deviceInstance}`}>
                  <td className="mono">{missed.mstpMacAddress ?? '—'}</td>
                  <td>{missed.deviceInstance}</td>
                  <td>{formatLastSeen(missed.lastSeenAt)}</td>
                  <td>{missed.missedScans}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </PanelCard>
      )}

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

      <PanelCard title="MS/TP Scan Summary" className="mt-3">
        {frames.length === 0 ? (
          <p style={{ color: '#58677d', margin: 0 }}>No frames captured yet. Run an MS/TP discovery.</p>
        ) : (
          <>
            <KvRow label="Total Frames" value={scanSummary.totalFrames} />
            <KvRow label="Header CRC Failures" value={scanSummary.headerCrcFailures} />
            <KvRow label="Data CRC Failures" value={scanSummary.dataCrcFailures} />
            <KvRow label="Parse Errors" value={scanSummary.parseErrors} />
            <KvRow label="Unique Source MACs" value={scanSummary.uniqueSourceMacs} />
            <KvRow label="Token Frames" value={scanSummary.tokenFrames} />
            <KvRow label="Poll For Master Frames" value={scanSummary.pollForMasterFrames} />
            <KvRow label="Reply To Poll For Master Frames" value={scanSummary.replyToPollForMasterFrames} />
          </>
        )}
      </PanelCard>

      <PanelCard title="Known MAC Activity" className="mt-3">
        {macActivity.length === 0 ? (
          <p style={{ color: '#58677d', margin: 0 }}>No source MAC activity recorded yet.</p>
        ) : (
          <Table responsive className="sentry-table mb-0">
            <thead>
              <tr>
                <th>Source MAC</th>
                <th>Frame Count</th>
                <th>Last Seen</th>
                <th>Frame Types Seen</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {macActivity.map((entry) => (
                <tr key={entry.sourceMac}>
                  <td className="mono">{entry.sourceMac}</td>
                  <td>{entry.frameCount}</td>
                  <td>{formatTime(entry.lastSeen)}</td>
                  <td>{entry.frameTypesSeen}</td>
                  <td>
                    {entry.conflict && (
                      <span className="status-badge badge-error" title="Matches configured local MAC">
                        MAC Conflict
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </PanelCard>

      <PanelCard title="MS/TP Frame Diagnostics" className="mt-3">
        <p style={{ color: '#58677d', marginTop: 0, marginBottom: '0.75rem' }}>
          Raw decoded frames from the most recent scan (newest first). Use this to
          understand why a device was or was not parsed.
        </p>
        {frames.length === 0 ? (
          <p style={{ color: '#58677d', margin: 0 }}>No frames captured yet. Run an MS/TP discovery.</p>
        ) : (
          <Table responsive className="sentry-table mb-0">
            <thead>
              <tr>
                <th>Time</th>
                <th>Discovery Session</th>
                <th>Src MAC</th>
                <th>Dst MAC</th>
                <th>Frame Type</th>
                <th>Len</th>
                <th>Hdr CRC</th>
                <th>Data CRC</th>
                <th>Parse Result</th>
                <th>Parse Error</th>
                <th>MS/TP State</th>
                <th>Token Event</th>
                <th>Payload (first 32 bytes)</th>
              </tr>
            </thead>
            <tbody>
              {frames.map((frame, index) => (
                <tr key={`${frame.timestamp}-${index}`}>
                  <td>{formatTime(frame.timestamp)}</td>
                  <td className="mono" style={{ fontSize: '0.75em', wordBreak: 'break-all' }}>
                    {frame.discoverySessionId ? frame.discoverySessionId.slice(0, 8) : '—'}
                  </td>
                  <td className="mono">{frame.sourceMac ?? '—'}</td>
                  <td className="mono">{frame.destinationMac ?? '—'}</td>
                  <td>{frame.frameTypeLabel || frame.frameType}</td>
                  <td>{frame.length}</td>
                  <td>{crcBadge(frame.headerCrcValid)}</td>
                  <td>{crcBadge(frame.dataCrcValid)}</td>
                  <td>{frame.parseResult || '—'}</td>
                  <td style={{ color: frame.parseError ? '#d9534f' : undefined }}>
                    {frame.parseError || '—'}
                  </td>
                  <td>{frame.mstpState || '—'}</td>
                  <td>{frame.tokenEvent || '—'}</td>
                  <td className="mono" style={{ wordBreak: 'break-all', fontSize: '0.8em' }}>
                    {frame.payloadHex || '—'}
                  </td>
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
