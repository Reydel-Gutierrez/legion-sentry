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
import CollapsibleSection from '../components/common/CollapsibleSection';
import LoadingState from '../components/common/LoadingState';
import {
  BAUD_RATES,
  DEFAULT_MSTP,
  TOKEN_PARTICIPATION_MODES,
  buildDiscoverPayload,
  computeMacActivity,
  computeScanSummary,
  formatLastSeen,
  formatTime,
  formatTimeAgo,
  isMstp,
  mstpBusStatus,
  mstpContextWarnings,
  mstpMac,
  mstpNetwork,
  mstpParticipationLabel,
  mstpTokenStatus,
  MSTP_PARTICIPATION_STATUS_META,
  validateMstpForm,
} from './bacnetUtils';

function CompactNumberField({
  label, value, onChange, disabled, hint, width = 'sm',
}) {
  return (
    <div className={`field-group field-group--${width}`}>
      <label className="form-label">{label}</label>
      <input
        className="form-control"
        type="number"
        value={value}
        disabled={disabled}
        onChange={onChange}
      />
      {hint && <p className="field-hint mb-0">{hint}</p>}
    </div>
  );
}

function StatusItem({ label, children }) {
  return (
    <div className="mstp-status-item">
      <span className="mstp-status-label">{label}</span>
      <div>{children}</div>
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
      tokenMode: savedConfig.tokenMode !== false,
      tokenParticipationMode: savedConfig.tokenParticipationMode ?? DEFAULT_MSTP.tokenParticipationMode,
      directedWhoIsEnabled: savedConfig.directedWhoIsEnabled ?? DEFAULT_MSTP.directedWhoIsEnabled,
      directedWhoIsMacs: savedConfig.directedWhoIsMacs ?? DEFAULT_MSTP.directedWhoIsMacs,
      extraDiscoveryRetriesEnabled: savedConfig.extraDiscoveryRetriesEnabled
        ?? savedConfig.extraFecRetryEnabled
        ?? DEFAULT_MSTP.extraDiscoveryRetriesEnabled,
      preListenMs: savedConfig.preListenMs ?? DEFAULT_MSTP.preListenMs,
      postSendListenMs: savedConfig.postSendListenMs ?? DEFAULT_MSTP.postSendListenMs,
      recentActivityWindowMs: savedConfig.recentActivityWindowMs ?? DEFAULT_MSTP.recentActivityWindowMs,
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
          tokenMode: mstpForm.tokenMode !== false,
          tokenParticipationMode: mstpForm.tokenParticipationMode,
          directedWhoIsEnabled: mstpForm.directedWhoIsEnabled,
          directedWhoIsMacs: mstpForm.directedWhoIsMacs,
          extraDiscoveryRetriesEnabled: mstpForm.extraDiscoveryRetriesEnabled,
          preListenMs: mstpForm.preListenMs,
          postSendListenMs: mstpForm.postSendListenMs,
          recentActivityWindowMs: mstpForm.recentActivityWindowMs,
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
      const result = await api.discoverBacnetMstp(buildDiscoverPayload(mstpForm));
      await load();
      const seen = result.devices?.length ?? 0;
      const missed = result.missedDevices || [];
      const totalInventory = result.inventoryTotals?.mstp ?? '—';
      setMissedDevices(missed);
      const warningText = result.warnings?.length ? ` ${result.warnings.join(' ')}` : '';
      const summaryText = `Discovery complete — ${seen} device(s) seen, ${missed.length} not rediscovered, ${totalInventory} in inventory (${result.durationMs}ms).`;
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
    return <LoadingState message="Loading BACnet MS/TP…" />;
  }

  const mstp = mstpStatus || {};
  const interfaceOpen = Boolean(mstp.open);
  const scanSummary = computeScanSummary(frames);
  const macActivity = computeMacActivity(frames, mstpForm.macAddress);
  const mstpDevices = devices.filter(isMstp);
  const busStatus = mstpBusStatus(mstp);
  const tokenStatus = mstpTokenStatus(mstp);
  const contextWarnings = mstpContextWarnings(mstp, macActivity);
  const te = mstp.tokenEngine;
  const lastFrameAt = te?.lastValidFrameAt || mstp.busAlive?.lastValidFrameAt || mstp.lastActivityAt;

  const deviceColumns = [
    { key: 'mac', header: 'MAC', cellClassName: 'mono', render: (d) => mstpMac(d) },
    { key: 'deviceInstance', header: 'Instance', cellClassName: 'mono' },
    { key: 'vendor', header: 'Vendor', render: (d) => d.vendor || d.vendorName || '—' },
    { key: 'model', header: 'Model', render: (d) => d.model || d.modelName || '—' },
    { key: 'network', header: 'Address', render: (d) => mstpNetwork(d) },
    { key: 'lastSeen', header: 'Last Seen', render: (d) => formatLastSeen(d.lastSeen || d.lastSeenAt) },
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
            title={managedKeys.has(managedKey(device)) ? 'Already managed' : 'Add to managed devices'}
          >
            {managedKeys.has(managedKey(device)) ? 'Managed' : 'Add'}
          </ActionButton>
        </div>
      ),
    },
  ];

  const logColumns = [
    { key: 'time', header: 'Time', render: (e) => formatTime(e.time) },
    { key: 'level', header: 'Level' },
    { key: 'message', header: 'Message' },
  ];

  const frameColumns = [
    { key: 'timestamp', header: 'Time', render: (f) => formatTime(f.timestamp) },
    { key: 'sourceMac', header: 'Src', cellClassName: 'mono', render: (f) => f.sourceMac ?? '—' },
    { key: 'destinationMac', header: 'Dst', cellClassName: 'mono', render: (f) => f.destinationMac ?? '—' },
    { key: 'frameType', header: 'Type', render: (f) => f.frameTypeLabel || f.frameType },
    { key: 'parseResult', header: 'Parse', render: (f) => f.parseResult || '—' },
    { key: 'mstpState', header: 'State', render: (f) => f.mstpState || '—' },
  ];

  return (
    <>
      <PageHeader
        title="BACnet MS/TP"
        subtitle="Discover devices on the FC Bus. Sentry joins an active ring or starts an idle ring automatically."
      />

      {message && (
        <div className={`alert-sentry alert-sentry-${message.type === 'success' ? 'success' : message.type === 'info' ? 'info' : 'error'} mb-3`}>
          {message.text}
        </div>
      )}

      {contextWarnings.map((w) => (
        <div key={w.text} className={`alert-sentry alert-sentry-${w.tone === 'danger' ? 'error' : w.tone === 'warn' ? 'info' : 'info'} mb-3`}>
          {w.text}
        </div>
      ))}

      <SectionCard title="Status Summary" className="mb-3">
        <div className="mstp-status-grid">
          <StatusItem label="Interface">
            <StatusChip label={interfaceOpen ? 'Open' : 'Closed'} tone={interfaceOpen ? 'success' : 'neutral'} />
          </StatusItem>
          <StatusItem label="Bus">
            <StatusChip tone={busStatus.tone} label={busStatus.label} />
          </StatusItem>
          <StatusItem label="Token">
            <StatusChip tone={tokenStatus.tone} label={tokenStatus.label} />
          </StatusItem>
          <StatusItem label="Last Frame">
            <span>{formatTimeAgo(lastFrameAt)}</span>
          </StatusItem>
          <StatusItem label="Local MAC">
            <span className="mono">{mstp.macAddress ?? mstpForm.macAddress}</span>
          </StatusItem>
          <StatusItem label="Masters Detected">
            <span>{te?.mastersDetected?.length ?? 0}</span>
          </StatusItem>
        </div>
        {te && (
          <div className="mt-3 pt-2" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
            <StatusChip
              tone={MSTP_PARTICIPATION_STATUS_META[te.participationStatus]?.tone || 'neutral'}
              label={mstpParticipationLabel(te.participationStatus)}
            />
            <span className="text-muted ms-2" style={{ fontSize: '0.85rem' }}>
              Auto Token Mode — pre-listen, join active ring, or start idle ring
            </span>
          </div>
        )}
      </SectionCard>

      <SectionCard title="Discover Devices" className="mb-3">
        <p className="text-muted mb-3">
          Sentry will join an active MS/TP ring or start an idle ring automatically. Who-Is is sent only while holding the token.
        </p>
        <div className="action-bar">
          <ActionButton variant="primary" onClick={handleDiscoverMstp} disabled={loading}>
            Discover Devices
          </ActionButton>
          <ActionButton onClick={() => load()} disabled={loading}>
            Refresh Status
          </ActionButton>
          {interfaceOpen && (
            <ActionButton size="sm" onClick={handleCloseMstp} disabled={loading}>
              Close Interface
            </ActionButton>
          )}
        </div>
      </SectionCard>

      <SectionCard
        title="Basic MS/TP Settings"
        status={<StatusChip label={interfaceOpen ? 'Interface open' : 'Ready'} />}
        className="mb-3"
      >
        <div className="form-grid form-grid--2 mb-3">
          <div className="field-group field-group--lg">
            <label className="form-label">Serial Port</label>
            <input
              className="form-control"
              value={mstpForm.port}
              onChange={(e) => updateMstp('port', e.target.value)}
              disabled={interfaceOpen}
            />
          </div>
          <div className="field-group field-group--md">
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

        <div className="form-grid form-grid--4 mb-3">
          <CompactNumberField
            label="Sentry MAC Address"
            value={mstpForm.macAddress}
            disabled={interfaceOpen}
            width="xs"
            hint="Sentry's MS/TP master MAC. Must be unique on the trunk."
            onChange={(e) => updateMstp('macAddress', Number(e.target.value))}
          />
          <CompactNumberField
            label="Max Master"
            value={mstpForm.maxMaster}
            disabled={interfaceOpen}
            width="xs"
            hint="Highest master MAC to search for. 127 is safest; lower is faster if known."
            onChange={(e) => updateMstp('maxMaster', Number(e.target.value))}
          />
          <CompactNumberField
            label="Network Number"
            value={mstpForm.networkNumber}
            disabled={interfaceOpen}
            width="sm"
            onChange={(e) => updateMstp('networkNumber', Number(e.target.value))}
          />
          <CompactNumberField
            label="Timeout (ms)"
            value={mstpForm.timeoutMs}
            width="md"
            onChange={(e) => updateMstp('timeoutMs', Number(e.target.value))}
          />
        </div>

        <p className="field-hint mb-3">
          Auto Token Mode: Sentry will join an active ring or start an idle ring automatically.
        </p>

        <div className="action-bar">
          <ActionButton onClick={handleSaveMstpConfig} disabled={loading}>
            Save Settings
          </ActionButton>
          <ActionButton onClick={handleClearSession} disabled={loading}>
            Clear Latest Scan
          </ActionButton>
        </div>
      </SectionCard>

      <SectionCard title="Discovered Devices" className="mb-3">
        <DataTable
          columns={deviceColumns}
          rows={mstpDevices}
          rowKey={(d) => d.id}
          pageSize={10}
          emptyMessage="No MS/TP devices discovered yet. Click Discover Devices."
        />
      </SectionCard>

      <SectionCard title="Advanced Diagnostics" className="mb-3">
        <CollapsibleSection title="Token Engine, Timing & Manual Modes" defaultOpen={false}>
          <div className="p-3">
            <div className="form-section-title">Auto Token Mode</div>
            <p className="field-hint mb-3">
              Pre-listen, join active ring, or start idle ring. Who-Is is sent only while holding token.
            </p>

            <div className="form-grid form-grid--2 mb-3">
              <div className="field-group">
                <label className="form-label">Participation Override</label>
                <select
                  className="form-select"
                  value={mstpForm.tokenParticipationMode}
                  onChange={(e) => updateMstp('tokenParticipationMode', e.target.value)}
                >
                  {TOKEN_PARTICIPATION_MODES.map((mode) => (
                    <option key={mode.value} value={mode.value}>{mode.label}</option>
                  ))}
                </select>
              </div>
              <div className="field-group">
                <Form.Check
                  type="checkbox"
                  id="mstp-send-only"
                  className="mt-4"
                  label="Send-only mode (disable Auto Token Mode — diagnostic only)"
                  checked={mstpForm.tokenMode === false}
                  onChange={(e) => updateMstp('tokenMode', !e.target.checked)}
                />
              </div>
            </div>

            <div className="form-section-title">Discovery Timing</div>
            <div className="form-grid form-grid--4 mb-3">
              <CompactNumberField label="Pre-listen (ms)" value={mstpForm.preListenMs} width="sm" onChange={(e) => updateMstp('preListenMs', Number(e.target.value))} />
              <CompactNumberField label="Post-send Listen (ms)" value={mstpForm.postSendListenMs} width="sm" onChange={(e) => updateMstp('postSendListenMs', Number(e.target.value))} />
              <CompactNumberField label="Who-Is Retries" value={mstpForm.whoIsRetries} width="xs" onChange={(e) => updateMstp('whoIsRetries', Number(e.target.value))} />
              <CompactNumberField label="Retry Interval (ms)" value={mstpForm.retryIntervalMs} width="sm" onChange={(e) => updateMstp('retryIntervalMs', Number(e.target.value))} />
              <CompactNumberField label="Recent Activity Window (ms)" value={mstpForm.recentActivityWindowMs} width="sm" onChange={(e) => updateMstp('recentActivityWindowMs', Number(e.target.value))} />
              <CompactNumberField label="Max Info Frames" value={mstpForm.maxInfoFrames} width="xs" disabled={interfaceOpen} onChange={(e) => updateMstp('maxInfoFrames', Number(e.target.value))} />
            </div>

            <div className="form-section-title">Directed Who-Is</div>
            <Form.Check
              type="checkbox"
              id="mstp-directed-whois"
              className="mb-2"
              label="Directed Who-Is (not fully implemented)"
              checked={Boolean(mstpForm.directedWhoIsEnabled)}
              onChange={(e) => updateMstp('directedWhoIsEnabled', e.target.checked)}
            />
            {mstpForm.directedWhoIsEnabled && (
              <div className="field-group field-group--md mb-3">
                <label className="form-label">Directed Who-Is MACs</label>
                <input
                  className="form-control"
                  value={mstpForm.directedWhoIsMacs}
                  placeholder="e.g. 7, 12"
                  onChange={(e) => updateMstp('directedWhoIsMacs', e.target.value)}
                />
              </div>
            )}

            <Form.Check
              type="checkbox"
              id="mstp-extended-discovery-retries"
              className="mb-3"
              label="Extended discovery retries"
              checked={Boolean(mstpForm.extraDiscoveryRetriesEnabled)}
              onChange={(e) => updateMstp('extraDiscoveryRetriesEnabled', e.target.checked)}
            />

            {te && (
              <div className="status-readout mb-3">
                <KvRow label="Startup Mode" value={te.startupMode || '—'} />
                <KvRow label="Token Ring Established" value={te.tokenRingEstablished ? 'Yes' : 'No'} />
                <KvRow label="Sole Master Startup" value={te.soleMasterStartupActive ? 'Active' : 'No'} />
                <KvRow label="Operating as Sole Master" value={te.operatingAsSoleMaster ? 'Yes' : 'No'} />
                <KvRow label="Last Poll For Master" value={te.lastPollForMasterMac ?? '—'} />
                <KvRow label="Engine State" value={`${te.state}${te.holdingToken ? ' (holding)' : ''}`} />
                <KvRow label="RX / TX Bytes" value={`${mstp.rxBytes ?? 0} / ${mstp.txBytes ?? 0}`} />
              </div>
            )}

            {frames.length > 0 && (
              <>
                <div className="form-section-title">Scan Summary</div>
                <div className="status-readout mb-3">
                  <KvRow label="Total Frames" value={scanSummary.totalFrames} />
                  <KvRow label="Token Frames" value={scanSummary.tokenFrames} />
                  <KvRow label="Poll For Master" value={scanSummary.pollForMasterFrames} />
                  <KvRow label="Unique Source MACs" value={scanSummary.uniqueSourceMacs} />
                  <KvRow label="Header CRC Failures" value={scanSummary.headerCrcFailures} />
                </div>
              </>
            )}
          </div>
        </CollapsibleSection>
      </SectionCard>

      <SectionCard title="Logs & Raw Frames" className="mb-3">
        <CollapsibleSection title="Discovery Log" defaultOpen={false}>
          <div className="p-2">
            <div className="action-bar mb-2">
              <ActionButton size="sm" onClick={handleClearLogs} disabled={loading}>
                Clear Logs
              </ActionButton>
            </div>
            <DataTable
              columns={logColumns}
              rows={logs}
              rowKey={(e, i) => `${e.time}-${i}`}
              pageSize={8}
              emptyMessage="No discovery logs yet."
            />
          </div>
        </CollapsibleSection>

        <CollapsibleSection title="Raw MS/TP Frames" defaultOpen={false}>
          <div className="p-2">
            <DataTable
              columns={frameColumns}
              rows={frames}
              rowKey={(f, i) => `${f.timestamp}-${i}`}
              pageSize={8}
              emptyMessage="No frames captured yet."
            />
          </div>
        </CollapsibleSection>
      </SectionCard>
    </>
  );
}
