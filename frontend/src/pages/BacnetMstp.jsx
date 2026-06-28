import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Form } from 'react-bootstrap';
import { api } from '../api/client';
import KvRow from '../components/common/KvRow';
import SectionCard from '../components/common/SectionCard';
import StatusChip from '../components/common/StatusChip';
import PageHeader from '../components/common/PageHeader';
import ActionButton from '../components/common/ActionButton';
import DataTable from '../components/common/DataTable';
import FormSection from '../components/common/FormSection';
import CollapsibleSection from '../components/common/CollapsibleSection';
import LoadingState from '../components/common/LoadingState';
import {
  BAUD_RATES,
  DEFAULT_MSTP,
  MSTP_STATUS_META,
  computeMacActivity,
  computeScanSummary,
  formatLastSeen,
  formatTime,
  isMstp,
  mstpMac,
  mstpNetwork,
  mstpParticipationLabel,
  MSTP_PARTICIPATION_STATUS_META,
  validateMstpForm,
} from './bacnetUtils';

function mstpStatusChip(device) {
  const meta = MSTP_STATUS_META[device.mstpStatus] || MSTP_STATUS_META.never_confirmed;
  const title = device.mstpStatus === 'stale'
    ? 'Known inventory device, but it did not answer the latest Who-Is scan.'
    : undefined;
  return <StatusChip tone={meta.tone} label={meta.label} title={title} />;
}

function crcChip(valid) {
  if (valid == null) return <span className="mono" style={{ color: '#58677d' }}>—</span>;
  return valid
    ? <StatusChip tone="success" label="OK" />
    : <StatusChip tone="danger" label="FAIL" />;
}

function NumberField({ label, value, onChange, disabled }) {
  return (
    <div className="field-group">
      <label className="form-label">{label}</label>
      <input
        className="form-control"
        type="number"
        value={value}
        disabled={disabled}
        onChange={onChange}
      />
    </div>
  );
}

export default function BacnetMstpPage() {
  const navigate = useNavigate();
  const [mstpStatus, setMstpStatus] = useState(null);
  const [devices, setDevices] = useState([]);
  const [logs, setLogs] = useState([]);
  const [frames, setFrames] = useState([]);
  const [mstpForm, setMstpForm] = useState(DEFAULT_MSTP);
  const [statusLoaded, setStatusLoaded] = useState(false);
  const [message, setMessage] = useState(null);
  const [loading, setLoading] = useState(false);
  const [missedDevices, setMissedDevices] = useState([]);
  const [managedKeys, setManagedKeys] = useState(new Set());

  const load = useCallback(async () => {
    const [status, mstp, deviceData, managedData, logData, frameData] = await Promise.all([
      api.getBacnetStatus(),
      api.getBacnetMstpStatus(),
      api.getDevices(),
      api.getManagedDevices(),
      api.getBacnetMstpLogs(),
      api.getBacnetMstpFrames(),
    ]);
    setMstpStatus(mstp.status);
    setDevices(deviceData.devices || []);
    setManagedKeys(new Set(
      (managedData.devices || []).map((d) => `${d.transport}:${d.mstpMacAddress}:${d.deviceInstance}`),
    ));
    setLogs(logData.logs || []);
    setFrames(frameData.frames || []);

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
    setStatusLoaded(true);
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

  const managedKey = (device) => {
    const mac = device.mstpMacAddress ?? device.macAddress;
    const transport = device.transport === 'mstp' ? 'BACnet MS/TP' : device.transport;
    return `${transport}:${mac}:${device.deviceInstance}`;
  };

  const handleAddManaged = async (device) => {
    setLoading(true);
    setMessage(null);
    try {
      await api.addManagedDevice({ discoveredDeviceId: device.id });
      await load();
      setMessage({
        type: 'success',
        text: `MAC ${mstpMac(device)} (instance ${device.deviceInstance}) added to managed devices.`,
      });
    } catch (err) {
      setMessage({
        type: 'error',
        text: err.code === 'ALREADY_MANAGED' ? 'Device is already managed.' : err.message,
      });
    } finally {
      setLoading(false);
    }
  };

  if (!statusLoaded) {
    return <LoadingState message="Loading BACnet MS/TP configuration…" />;
  }

  const mstp = mstpStatus || {};
  const interfaceOpen = Boolean(mstp.open);
  const scanSummary = computeScanSummary(frames);
  const macActivity = computeMacActivity(frames, mstpForm.macAddress);
  const mstpDevices = devices.filter(isMstp);

  const deviceColumns = [
    { key: 'status', header: 'Status', render: (d) => mstpStatusChip(d) },
    { key: 'network', header: 'Network', render: (d) => mstpNetwork(d) },
    { key: 'mac', header: 'MS/TP MAC', cellClassName: 'mono', render: (d) => mstpMac(d) },
    { key: 'deviceInstance', header: 'Instance' },
    { key: 'objectName', header: 'Object Name', render: (d) => d.objectName || '—' },
    { key: 'vendor', header: 'Vendor', render: (d) => d.vendor || d.vendorName || '—' },
    { key: 'model', header: 'Model', render: (d) => d.model || d.modelName || '—' },
    { key: 'firstSeen', header: 'First Seen', render: (d) => formatLastSeen(d.firstSeenAt) },
    { key: 'lastSeen', header: 'Last Seen', render: (d) => formatLastSeen(d.lastSeen || d.lastSeenAt) },
    { key: 'sightings', header: 'Sightings', render: (d) => d.sightings ?? '—' },
    { key: 'missed', header: 'Missed', render: (d) => d.missedScans ?? 0 },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (device) => (
        <div className="d-flex gap-2 justify-content-end">
          <ActionButton size="sm" onClick={() => navigate(`/devices/${device.id}`)}>
            Details
          </ActionButton>
          <ActionButton
            variant="primary"
            size="sm"
            onClick={() => handleAddManaged(device)}
            disabled={loading || managedKeys.has(managedKey(device))}
            title={managedKeys.has(managedKey(device)) ? 'Already managed' : 'Promote to managed devices'}
          >
            {managedKeys.has(managedKey(device)) ? 'Managed' : 'Add to Managed'}
          </ActionButton>
        </div>
      ),
    },
  ];

  const missedColumns = [
    { key: 'mac', header: 'MAC', cellClassName: 'mono', render: (m) => m.mstpMacAddress ?? '—' },
    { key: 'deviceInstance', header: 'Device Instance' },
    { key: 'lastSeen', header: 'Last Seen', render: (m) => formatLastSeen(m.lastSeenAt) },
    { key: 'missedScans', header: 'Missed Scans' },
  ];

  const logColumns = [
    { key: 'time', header: 'Time', render: (e) => formatTime(e.time) },
    { key: 'level', header: 'Level' },
    { key: 'source', header: 'Source' },
    { key: 'message', header: 'Message' },
  ];

  const macColumns = [
    { key: 'sourceMac', header: 'Source MAC', cellClassName: 'mono' },
    { key: 'frameCount', header: 'Frame Count' },
    { key: 'lastSeen', header: 'Last Seen', render: (e) => formatTime(e.lastSeen) },
    { key: 'frameTypesSeen', header: 'Frame Types Seen' },
    {
      key: 'conflict',
      header: '',
      align: 'right',
      render: (e) => (e.conflict
        ? <StatusChip tone="danger" label="MAC Conflict" title="Matches configured local MAC" />
        : null),
    },
  ];

  const frameColumns = [
    { key: 'timestamp', header: 'Time', render: (f) => formatTime(f.timestamp) },
    {
      key: 'session',
      header: 'Session',
      cellClassName: 'mono',
      render: (f) => (f.discoverySessionId ? f.discoverySessionId.slice(0, 8) : '—'),
    },
    { key: 'sourceMac', header: 'Src', cellClassName: 'mono', render: (f) => f.sourceMac ?? '—' },
    { key: 'destinationMac', header: 'Dst', cellClassName: 'mono', render: (f) => f.destinationMac ?? '—' },
    { key: 'frameType', header: 'Frame Type', render: (f) => f.frameTypeLabel || f.frameType },
    { key: 'length', header: 'Len' },
    { key: 'hdrCrc', header: 'Hdr CRC', render: (f) => crcChip(f.headerCrcValid) },
    { key: 'dataCrc', header: 'Data CRC', render: (f) => crcChip(f.dataCrcValid) },
    { key: 'parseResult', header: 'Parse Result', render: (f) => f.parseResult || '—' },
    {
      key: 'parseError',
      header: 'Parse Error',
      render: (f) => (
        <span style={{ color: f.parseError ? '#fa5252' : undefined }}>{f.parseError || '—'}</span>
      ),
    },
    { key: 'mstpState', header: 'MS/TP State', render: (f) => f.mstpState || '—' },
    { key: 'tokenEvent', header: 'Token Event', render: (f) => f.tokenEvent || '—' },
    {
      key: 'payload',
      header: 'Payload (first 32 bytes)',
      cellClassName: 'mono',
      render: (f) => f.payloadHex || '—',
    },
  ];

  return (
    <>
      <PageHeader
        title="BACnet MS/TP"
        subtitle="Serial interface, token participation and MS/TP discovery."
        actions={(
          <ActionButton variant="primary" onClick={handleDiscoverMstp} disabled={loading}>
            Discover BACnet MS/TP
          </ActionButton>
        )}
      />

      {message && (
        <div className={`alert-sentry alert-sentry-${message.type === 'success' ? 'success' : message.type === 'info' ? 'info' : 'error'} mb-3`}>
          {message.text}
        </div>
      )}

      <SectionCard
        title="MS/TP Interface"
        status={<StatusChip label={interfaceOpen ? 'Open' : 'Closed'} />}
        className="mb-3"
      >
        <FormSection title="Serial Interface">
          <div className="form-grid form-grid--2">
            <div className="field-group">
              <label className="form-label">Port</label>
              <input
                className="form-control"
                value={mstpForm.port}
                onChange={(e) => updateMstp('port', e.target.value)}
                disabled={interfaceOpen}
              />
            </div>
            <div className="field-group">
              <label className="form-label">Baud Rate</label>
              <select
                className="form-select"
                value={mstpForm.baudRate}
                onChange={(e) => updateMstp('baudRate', Number(e.target.value))}
                disabled={interfaceOpen}
              >
                {BAUD_RATES.map((rate) => (
                  <option key={rate} value={rate}>{rate}</option>
                ))}
              </select>
            </div>
          </div>
        </FormSection>

        <FormSection title="BACnet Identity">
          <div className="form-grid">
            <NumberField label="MAC Address" value={mstpForm.macAddress} disabled={interfaceOpen} onChange={(e) => updateMstp('macAddress', Number(e.target.value))} />
            <NumberField label="Max Master" value={mstpForm.maxMaster} disabled={interfaceOpen} onChange={(e) => updateMstp('maxMaster', Number(e.target.value))} />
            <NumberField label="Max Info Frames" value={mstpForm.maxInfoFrames} disabled={interfaceOpen} onChange={(e) => updateMstp('maxInfoFrames', Number(e.target.value))} />
            <NumberField label="Network Number" value={mstpForm.networkNumber} disabled={interfaceOpen} onChange={(e) => updateMstp('networkNumber', Number(e.target.value))} />
          </div>
        </FormSection>

        <FormSection title="Token Participation">
          <Form.Check
            type="checkbox"
            id="mstp-token-mode"
            label="Token Mode (pre-listen, join active ring, or start idle ring — Who-Is only while holding token)"
            checked={Boolean(mstpForm.tokenMode)}
            onChange={(e) => updateMstp('tokenMode', e.target.checked)}
          />
        </FormSection>

        <FormSection>
          <CollapsibleSection title="Advanced Settings">
            <div className="form-section-title">Discovery Timing</div>
            <div className="form-grid form-grid--3 mb-3">
              <NumberField label="Timeout (ms)" value={mstpForm.timeoutMs} onChange={(e) => updateMstp('timeoutMs', Number(e.target.value))} />
              <NumberField label="Who-Is Retries" value={mstpForm.whoIsRetries} onChange={(e) => updateMstp('whoIsRetries', Number(e.target.value))} />
              <NumberField label="Retry Interval (ms)" value={mstpForm.retryIntervalMs} onChange={(e) => updateMstp('retryIntervalMs', Number(e.target.value))} />
              <NumberField label="Pre-listen Delay (ms)" value={mstpForm.preListenMs} onChange={(e) => updateMstp('preListenMs', Number(e.target.value))} />
              <NumberField label="Post-send Listen (ms)" value={mstpForm.postSendListenMs} onChange={(e) => updateMstp('postSendListenMs', Number(e.target.value))} />
            </div>

            <div className="form-section-title">Advanced Discovery</div>
            <Form.Check
              type="checkbox"
              id="mstp-extended-discovery-retries"
              className="mb-2"
              label="Extended discovery retries"
              checked={Boolean(mstpForm.extraDiscoveryRetriesEnabled)}
              onChange={(e) => updateMstp('extraDiscoveryRetriesEnabled', e.target.checked)}
            />
            <Form.Check
              type="checkbox"
              id="mstp-directed-whois"
              className="mb-2"
              label="Directed Who-Is"
              checked={Boolean(mstpForm.directedWhoIsEnabled)}
              onChange={(e) => updateMstp('directedWhoIsEnabled', e.target.checked)}
            />
            {mstpForm.directedWhoIsEnabled && (
              <div className="field-group" style={{ maxWidth: '320px' }}>
                <label className="form-label">Directed Who-Is MACs (comma separated)</label>
                <input
                  className="form-control"
                  value={mstpForm.directedWhoIsMacs}
                  placeholder="e.g. 7, 12"
                  onChange={(e) => updateMstp('directedWhoIsMacs', e.target.value)}
                />
              </div>
            )}
          </CollapsibleSection>
        </FormSection>

        <div className="action-bar mt-3">
          <ActionButton onClick={handleSaveMstpConfig} disabled={loading}>
            Save Config
          </ActionButton>
          <ActionButton onClick={handleOpenMstp} disabled={loading || interfaceOpen}>
            Open Interface
          </ActionButton>
          <ActionButton onClick={handleCloseMstp} disabled={loading || !interfaceOpen}>
            Close Interface
          </ActionButton>
          <ActionButton onClick={handleClearSession} disabled={loading}>
            Clear Latest Scan
          </ActionButton>
          <ActionButton onClick={handleClearLogs} disabled={loading}>
            Clear Logs
          </ActionButton>
        </div>
      </SectionCard>

      <SectionCard title="Interface Status" className="mb-3">
        <KvRow
          label="Interface"
          value={<StatusChip label={interfaceOpen ? 'Open' : 'Closed'} />}
        />
        <KvRow label="RX Bytes" value={mstp.rxBytes ?? 0} />
        <KvRow label="TX Bytes" value={mstp.txBytes ?? 0} />
        <KvRow label="Token Mode" value={mstp.tokenMode ? 'Enabled' : 'Disabled'} />
        <KvRow
          label="Token Participation"
          value={mstp.tokenParticipationImplemented ? 'Sole-master startup supported' : 'Not implemented'}
        />
        {mstp.tokenEngine && (
          <>
            <KvRow
              label="Ring Participation"
              value={(
                <StatusChip
                  tone={MSTP_PARTICIPATION_STATUS_META[mstp.tokenEngine.participationStatus]?.tone || 'neutral'}
                  label={mstpParticipationLabel(mstp.tokenEngine.participationStatus)}
                />
              )}
            />
            <KvRow label="Startup Mode" value={mstp.tokenEngine.startupMode || '—'} />
            <KvRow
              label="Bus Activity Detected"
              value={mstp.tokenEngine.busActivityDetected ? 'Yes' : 'No'}
            />
            <KvRow
              label="Sole-Master Startup"
              value={mstp.tokenEngine.soleMasterStartupActive ? 'Active' : 'No'}
            />
            <KvRow
              label="Token Ring Established"
              value={mstp.tokenEngine.tokenRingEstablished ? 'Yes' : 'No'}
            />
            <KvRow
              label="Last Poll For Master"
              value={mstp.tokenEngine.lastPollForMasterMac ?? '—'}
            />
            <KvRow
              label="Token Engine State"
              value={`${mstp.tokenEngine.state}${mstp.tokenEngine.holdingToken ? ' (holding)' : ''}`}
            />
          </>
        )}
        <KvRow label="Last Activity" value={formatTime(mstp.lastActivityAt)} />
        <KvRow label="Last Error" value={mstp.lastError || '—'} />
      </SectionCard>

      <SectionCard title="Discovered MS/TP Devices" className="mb-3">
        <DataTable
          columns={deviceColumns}
          rows={mstpDevices}
          rowKey={(d) => d.id}
          pageSize={10}
          emptyMessage="No MS/TP devices discovered yet. Run BACnet MS/TP discovery."
        />
      </SectionCard>

      {missedDevices.length > 0 && (
        <SectionCard title="Missed Devices" className="mb-3">
          <DataTable
            columns={missedColumns}
            rows={missedDevices}
            rowKey={(m) => `${m.mstpMacAddress}-${m.deviceInstance}`}
            pageSize={10}
            emptyMessage="No missed devices."
          />
        </SectionCard>
      )}

      <SectionCard title="Discovery Log" className="mb-3">
        <DataTable
          columns={logColumns}
          rows={logs}
          rowKey={(e, i) => `${e.time}-${i}`}
          pageSize={10}
          emptyMessage="No discovery logs yet."
        />
      </SectionCard>

      <SectionCard title="Scan Summary" className="mb-3">
        {frames.length === 0 ? (
          <p className="text-muted mb-0">No frames captured yet. Run an MS/TP discovery.</p>
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
      </SectionCard>

      <SectionCard title="Known MAC Activity" className="mb-3">
        <DataTable
          columns={macColumns}
          rows={macActivity}
          rowKey={(e) => e.sourceMac}
          pageSize={10}
          emptyMessage="No source MAC activity recorded yet."
        />
      </SectionCard>

      <SectionCard title="Frame Diagnostics">
        <CollapsibleSection title="MS/TP Frame Diagnostics">
          <DataTable
            columns={frameColumns}
            rows={frames}
            rowKey={(f, i) => `${f.timestamp}-${i}`}
            pageSize={10}
            emptyMessage="No frames captured yet. Run an MS/TP discovery."
          />
        </CollapsibleSection>
      </SectionCard>
    </>
  );
}
