export const BAUD_RATES = [9600, 19200, 38400, 57600, 76800, 115200];

export const TOKEN_PARTICIPATION_MODES = [
  { value: 'auto', label: 'Auto (default)' },
  { value: 'listen-only', label: 'Listen Only' },
  { value: 'join-only', label: 'Join Existing Ring Only' },
  { value: 'force-sole-master', label: 'Force Sole Master Startup (diagnostics)' },
];

export const DEFAULT_MSTP = {
  port: '/dev/serial0',
  baudRate: 38400,
  macAddress: 3,
  maxMaster: 127,
  maxInfoFrames: 1,
  networkNumber: 2,
  timeoutMs: 20000,
  whoIsRetries: 5,
  retryIntervalMs: 3000,
  tokenMode: true,
  tokenParticipationMode: 'auto',
  directedWhoIsEnabled: false,
  directedWhoIsMacs: '',
  extraDiscoveryRetriesEnabled: false,
  preListenMs: 400,
  postSendListenMs: 3000,
  recentActivityWindowMs: 5000,
};

export const MSTP_FRAME_TYPE = {
  TOKEN: 0,
  POLL_FOR_MASTER: 1,
  REPLY_TO_POLL_FOR_MASTER: 2,
};

export const MSTP_STATUS_META = {
  seen_latest_scan: { tone: 'success', label: 'Seen latest scan' },
  recently_seen: { tone: 'warn', label: 'Recently seen' },
  stale: { tone: 'neutral', label: 'Not rediscovered' },
  never_confirmed: { tone: 'neutral', label: 'Unknown' },
};

export const MSTP_PARTICIPATION_STATUS_META = {
  'listening-only': { tone: 'neutral', label: 'Listening only' },
  'joining-active-ring': { tone: 'warn', label: 'Joining active ring' },
  'starting-idle-ring': { tone: 'warn', label: 'Starting idle ring' },
  'holding-token': { tone: 'success', label: 'Holding token' },
  'passing-token': { tone: 'neutral', label: 'Passing token' },
};

export function mstpParticipationLabel(status) {
  return MSTP_PARTICIPATION_STATUS_META[status]?.label || status || '—';
}

export function mstpBusStatus(mstp = {}) {
  const te = mstp.tokenEngine;
  const bus = mstp.busAlive;
  if (te?.soleMasterStartupActive || te?.startupMode === 'sole-master-startup') {
    return { label: 'Starting Idle Ring', tone: 'warn' };
  }
  if (bus?.busAliveRecently || te?.busActivityDetected || te?.busAliveRecently) {
    return { label: 'Active', tone: 'success' };
  }
  if (mstp.open || mstp.discoveryInProgress) {
    return { label: 'Silent', tone: 'neutral' };
  }
  return { label: 'Unknown', tone: 'neutral' };
}

export function mstpTokenStatus(mstp = {}) {
  const te = mstp.tokenEngine;
  if (!te) return { label: 'Not active', tone: 'neutral' };
  if (te.holdingToken) return { label: 'Holding', tone: 'success' };
  if (te.state === 'pass-token' || te.participationStatus === 'passing-token') {
    return { label: 'Passing', tone: 'neutral' };
  }
  if (te.tokenRingEstablished || te.startupMode === 'recent-active') {
    return { label: 'Waiting', tone: 'warn' };
  }
  return { label: 'Not active', tone: 'neutral' };
}

export function mstpContextWarnings(mstp = {}, macActivity = []) {
  const warnings = [];
  const te = mstp.tokenEngine;
  const bus = mstpBusStatus(mstp);

  if (bus.label === 'Silent' && (mstp.open || mstp.discoveryInProgress)) {
    warnings.push({ tone: 'neutral', text: 'No MS/TP activity detected yet.' });
  }
  if (bus.label === 'Starting Idle Ring') {
    warnings.push({ tone: 'warn', text: 'Sentry is starting the MS/TP ring.' });
  }
  if (te?.stats?.duplicateTokens > 0) {
    warnings.push({ tone: 'danger', text: 'Duplicate token detected on the trunk.' });
  }
  if (macActivity.some((entry) => entry.conflict)) {
    warnings.push({ tone: 'danger', text: 'MAC conflict detected — configured Sentry MAC matches traffic from another station.' });
  }
  return warnings;
}

export function isMstp(device) {
  return device.transport === 'BACnet MS/TP' || device.transport === 'mstp';
}

export function mstpMac(device) {
  if (!isMstp(device)) return '—';
  const mac = device.mstpMacAddress ?? device.macAddress;
  return mac != null ? mac : '—';
}

export function mstpNetwork(device) {
  if (!isMstp(device)) return device.networkNumber ?? '—';
  return device.configuredNetworkNumber ?? device.networkNumber ?? '—';
}

export function formatTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString();
}

export function formatLastSeen(iso) {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60000) return 'Just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  return formatTime(iso);
}

export function formatTimeAgo(iso) {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 5000) return 'Just now';
  if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  return formatTime(iso);
}

export function validateMstpForm(form, { frames = [], devices = [] } = {}) {
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

  if (form.tokenMode === false && (form.tokenParticipationMode || 'auto') === 'auto') {
    warnings.push('Send-only mode is enabled — Auto Token Mode is recommended for normal discovery.');
  }

  if (form.tokenParticipationMode === 'force-sole-master') {
    warnings.push('Force sole-master startup is a diagnostic mode only.');
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

export function computeScanSummary(frames) {
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

export function computeMacActivity(frames, localMacAddress) {
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

export function buildDiscoverPayload(form) {
  return {
    ...form,
    tokenMode: form.tokenMode !== false,
    tokenParticipationMode: form.tokenParticipationMode || 'auto',
  };
}
