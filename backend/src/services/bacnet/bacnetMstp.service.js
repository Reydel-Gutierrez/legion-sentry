const os = require('os');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { SerialPort } = require('serialport');
const { loadSettings } = require('../../lib/settingsStore');
const serialService = require('../interfaces/serial.service');
const {
  calcHeaderCrc,
  calcDataCrc,
  verifyHeaderCrc,
  verifyDataCrc,
} = require('./mstpCrc');

const MSTP_FRAME_TYPE = {
  TOKEN: 0x00,
  POLL_FOR_MASTER: 0x01,
  REPLY_TO_POLL_FOR_MASTER: 0x02,
  TEST_REQUEST: 0x03,
  TEST_RESPONSE: 0x04,
  BACNET_DATA_EXPECTING_REPLY: 0x05,
  BACNET_DATA_NOT_EXPECTING_REPLY: 0x06,
  REPLY_POSTPONED: 0x07,
};

const MSTP_BROADCAST_MAC = 0xff;
const BACNET_CONFIG_PATH = path.join(__dirname, '../../data/bacnet.json');
const MAX_LOG_ENTRIES = 500;
const MAX_FRAME_DATA_LEN = 501;
const MAX_FRAME_DIAGNOSTICS = 300;
const DEFAULT_TIMEOUT_MS = 20000;
const DEFAULT_WHO_IS_RETRIES = 5;
const DEFAULT_RETRY_INTERVAL_MS = 3000;
const TOKEN_PARTICIPATION_IMPLEMENTED = false;

const interfaceState = {
  open: false,
  port: null,
  serialPort: null,
  baudRate: null,
  macAddress: null,
  maxMaster: null,
  maxInfoFrames: null,
  networkNumber: null,
  timeoutMs: null,
  whoIsRetries: null,
  retryIntervalMs: null,
  tokenMode: false,
  rxBytes: 0,
  txBytes: 0,
  lastActivityAt: null,
  lastError: null,
  openedAt: null,
};

const discoveryLogs = [];

// Per-frame raw diagnostics ring buffer (separate from discovery logs and from
// persistent inventory). Cleared at the start of each discovery run so it always
// reflects the most recent scan.
const frameDiagnostics = [];

// Temporary discovery result buffer for the most recent run. This is NOT the
// persistent inventory — it only describes what was seen in the latest session.
let lastSession = null;

let processCleanupRegistered = false;
let activeDiscovery = null;

function logMstp(message, level = 'info') {
  const logFn = level === 'error' ? console.error : console.log;
  logFn(`[bacnet-mstp] ${message}`);
}

function addDiscoveryLog(level, message, extra = {}) {
  const entry = {
    time: new Date().toISOString(),
    level,
    source: 'bacnet-mstp',
    message,
    ...extra,
  };
  discoveryLogs.unshift(entry);
  if (discoveryLogs.length > MAX_LOG_ENTRIES) {
    discoveryLogs.length = MAX_LOG_ENTRIES;
  }
  logMstp(`[${level}] ${message}`, level === 'error' ? 'error' : 'info');
}

function loadPersistedMstpSettings() {
  const fromSettings = loadSettings().bacnet?.mstp || {};
  try {
    if (fs.existsSync(BACNET_CONFIG_PATH)) {
      const raw = JSON.parse(fs.readFileSync(BACNET_CONFIG_PATH, 'utf8'));
      return { ...fromSettings, ...(raw.mstp || {}) };
    }
  } catch {
    // ignore unreadable bacnet.json
  }
  return fromSettings;
}

function getDefaultConfig() {
  const settings = loadPersistedMstpSettings();
  return {
    port: settings.serialPort || '/dev/serial0',
    baudRate: settings.baudRate || 38400,
    macAddress: settings.macAddress ?? 3,
    maxMaster: settings.maxMaster ?? 127,
    maxInfoFrames: settings.maxInfoFrames ?? 1,
    networkNumber: settings.networkNumber ?? 2,
    timeoutMs: settings.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    whoIsRetries: settings.whoIsRetries ?? DEFAULT_WHO_IS_RETRIES,
    retryIntervalMs: settings.retryIntervalMs ?? DEFAULT_RETRY_INTERVAL_MS,
    tokenMode: Boolean(settings.tokenMode),
  };
}

function normalizeConfig(input = {}) {
  const defaults = getDefaultConfig();
  return {
    port: input.port || input.serialPort || defaults.port,
    baudRate: Number(input.baudRate ?? defaults.baudRate),
    macAddress: Number(input.macAddress ?? defaults.macAddress),
    maxMaster: Number(input.maxMaster ?? defaults.maxMaster),
    maxInfoFrames: Number(input.maxInfoFrames ?? defaults.maxInfoFrames),
    networkNumber: Number(input.networkNumber ?? defaults.networkNumber),
    timeoutMs: Number(input.timeoutMs ?? defaults.timeoutMs),
    whoIsRetries: Number(input.whoIsRetries ?? defaults.whoIsRetries),
    retryIntervalMs: Number(input.retryIntervalMs ?? defaults.retryIntervalMs),
    tokenMode: Boolean(input.tokenMode ?? defaults.tokenMode),
  };
}

function validateConfig(config) {
  if (os.platform() === 'win32') {
    const error = new Error('BACnet MS/TP is not supported on Windows development hosts');
    error.statusCode = 501;
    error.code = 'UNSUPPORTED_PLATFORM';
    throw error;
  }

  serialService.validatePath(config.port);
  serialService.validateBaudRate(config.baudRate);

  if (!Number.isInteger(config.macAddress) || config.macAddress < 0 || config.macAddress > 127) {
    const error = new Error('macAddress must be an integer between 0 and 127');
    error.statusCode = 400;
    error.code = 'INVALID_MAC';
    throw error;
  }

  if (!Number.isInteger(config.maxMaster) || config.maxMaster < 0 || config.maxMaster > 127) {
    const error = new Error('maxMaster must be an integer between 0 and 127');
    error.statusCode = 400;
    error.code = 'INVALID_MAX_MASTER';
    throw error;
  }

  if (config.maxMaster < config.macAddress) {
    const error = new Error('maxMaster must be greater than or equal to macAddress');
    error.statusCode = 400;
    error.code = 'INVALID_MAX_MASTER';
    throw error;
  }

  if (!Number.isInteger(config.maxInfoFrames) || config.maxInfoFrames < 1) {
    const error = new Error('maxInfoFrames must be an integer >= 1');
    error.statusCode = 400;
    error.code = 'INVALID_MAX_INFO_FRAMES';
    throw error;
  }

  if (!Number.isFinite(config.timeoutMs) || config.timeoutMs < 1000 || config.timeoutMs > 120000) {
    const error = new Error('timeoutMs must be between 1000 and 120000');
    error.statusCode = 400;
    error.code = 'INVALID_TIMEOUT';
    throw error;
  }

  if (!Number.isInteger(config.whoIsRetries) || config.whoIsRetries < 1 || config.whoIsRetries > 20) {
    const error = new Error('whoIsRetries must be an integer between 1 and 20');
    error.statusCode = 400;
    error.code = 'INVALID_WHO_IS_RETRIES';
    throw error;
  }

  if (
    !Number.isFinite(config.retryIntervalMs)
    || config.retryIntervalMs < 250
    || config.retryIntervalMs >= config.timeoutMs
  ) {
    const error = new Error('retryIntervalMs must be between 250 and less than timeoutMs');
    error.statusCode = 400;
    error.code = 'INVALID_RETRY_INTERVAL';
    throw error;
  }

  return config;
}

function getStatusSnapshot() {
  const defaults = getDefaultConfig();
  return {
    open: interfaceState.open,
    port: interfaceState.port ?? defaults.port,
    baudRate: interfaceState.baudRate ?? defaults.baudRate,
    macAddress: interfaceState.macAddress ?? defaults.macAddress,
    maxMaster: interfaceState.maxMaster ?? defaults.maxMaster,
    maxInfoFrames: interfaceState.maxInfoFrames ?? defaults.maxInfoFrames,
    networkNumber: interfaceState.networkNumber ?? defaults.networkNumber,
    timeoutMs: interfaceState.timeoutMs ?? defaults.timeoutMs,
    whoIsRetries: interfaceState.whoIsRetries ?? defaults.whoIsRetries,
    retryIntervalMs: interfaceState.retryIntervalMs ?? defaults.retryIntervalMs,
    tokenMode: interfaceState.tokenMode ?? defaults.tokenMode,
    tokenParticipationImplemented: TOKEN_PARTICIPATION_IMPLEMENTED,
    rxBytes: interfaceState.rxBytes,
    txBytes: interfaceState.txBytes,
    lastActivityAt: interfaceState.lastActivityAt,
    lastError: interfaceState.lastError,
    openedAt: interfaceState.openedAt,
    discoveryInProgress: Boolean(activeDiscovery),
    lastDiscoverySessionId: lastSession?.discoverySessionId || null,
  };
}

function mstpStateForFrame(frame) {
  switch (frame.frameType) {
    case MSTP_FRAME_TYPE.TOKEN:
      return 'token';
    case MSTP_FRAME_TYPE.POLL_FOR_MASTER:
      return 'poll-for-master';
    case MSTP_FRAME_TYPE.REPLY_TO_POLL_FOR_MASTER:
      return 'reply-to-poll-for-master';
    case MSTP_FRAME_TYPE.BACNET_DATA_EXPECTING_REPLY:
    case MSTP_FRAME_TYPE.BACNET_DATA_NOT_EXPECTING_REPLY:
      return 'data';
    default:
      return frame.dataLength === 0 ? 'control' : 'unknown';
  }
}

function tokenEventForFrame(frame) {
  switch (frame.frameType) {
    case MSTP_FRAME_TYPE.TOKEN:
      return 'token-pass';
    case MSTP_FRAME_TYPE.POLL_FOR_MASTER:
      return 'poll-for-master';
    case MSTP_FRAME_TYPE.REPLY_TO_POLL_FOR_MASTER:
      return 'reply-to-poll-for-master';
    default:
      return null;
  }
}

function recordFrameDiagnostic(frame, discoverySessionId) {
  const payload = frame.data && frame.data.length ? frame.data : null;
  const entry = {
    discoverySessionId: discoverySessionId || null,
    timestamp: new Date().toISOString(),
    sourceMac: frame.source ?? null,
    destinationMac: frame.destination ?? null,
    frameType: frame.frameType ?? null,
    frameTypeLabel: frame.frameTypeLabel ?? null,
    length: frame.dataLength ?? 0,
    headerCrcValid: frame.headerCrcValid ?? null,
    dataCrcValid: frame.dataCrcValid ?? null,
    payloadHex: payload ? payload.slice(0, 32).toString('hex') : '',
    parseResult: frame.parseResult ?? null,
    parseError: frame.parseError ?? null,
    mstpState: mstpStateForFrame(frame),
    tokenEvent: tokenEventForFrame(frame),
  };

  frameDiagnostics.unshift(entry);
  if (frameDiagnostics.length > MAX_FRAME_DIAGNOSTICS) {
    frameDiagnostics.length = MAX_FRAME_DIAGNOSTICS;
  }
  return entry;
}

function getFrames() {
  return {
    success: true,
    discoverySessionId: lastSession?.discoverySessionId || null,
    frames: [...frameDiagnostics],
  };
}

function getSession() {
  return {
    success: true,
    session: lastSession ? { ...lastSession, devices: [...lastSession.devices] } : null,
  };
}

function clearSession() {
  const cleared = lastSession?.discoverySessionId || null;
  lastSession = null;
  frameDiagnostics.length = 0;
  addDiscoveryLog('info', 'Latest MS/TP discovery session results cleared (inventory untouched)');
  return { success: true, clearedSessionId: cleared };
}

function getStatus() {
  return {
    success: true,
    implemented: true,
    status: getStatusSnapshot(),
  };
}

function getLogs() {
  return {
    success: true,
    logs: [...discoveryLogs],
  };
}

function clearLogs() {
  discoveryLogs.length = 0;
  addDiscoveryLog('info', 'Discovery logs cleared');
  return { success: true, logs: [] };
}

function registerProcessCleanup() {
  if (processCleanupRegistered) return;
  processCleanupRegistered = true;

  const cleanup = () => {
    try {
      const port = interfaceState.serialPort;
      if (port && port.isOpen) {
        port.close(() => {});
      }
    } catch {
      // ignore shutdown cleanup failures
    } finally {
      interfaceState.serialPort = null;
      interfaceState.open = false;
    }
  };

  process.once('SIGINT', cleanup);
  process.once('SIGTERM', cleanup);
  process.once('beforeExit', cleanup);
}

function safeClosePort(port) {
  return new Promise((resolve) => {
    if (!port) {
      resolve(null);
      return;
    }

    if (!port.isOpen) {
      resolve(null);
      return;
    }

    try {
      port.close((err) => resolve(err || null));
    } catch (err) {
      resolve(err);
    }
  });
}

async function detachPort(port) {
  if (!port) return;

  try {
    port.removeAllListeners();
  } catch {
    // ignore listener cleanup failures
  }

  await safeClosePort(port);
}

function attachPortErrorHandler(port) {
  if (!port || port.__legionMstpErrorBound) return;
  port.__legionMstpErrorBound = true;
  port.on('error', (err) => {
    const message = err?.message || String(err);
    interfaceState.lastError = message;
    addDiscoveryLog('error', `Serial port error: ${message}`);
    scheduleInterfaceFaultCleanup();
  });
}

function scheduleInterfaceFaultCleanup() {
  setImmediate(() => {
    closeInterfaceInternal('Serial port fault')
      .catch((err) => addDiscoveryLog('error', `Fault cleanup failed: ${err.message}`));
  });
}

function ensureSerialMonitorNotRunning() {
  const monitor = serialService.getMonitorStatus();
  if (monitor.running) {
    const error = new Error('Serial monitor is running — stop it before using BACnet MS/TP');
    error.statusCode = 409;
    error.code = 'MONITOR_RUNNING';
    throw error;
  }
}

function buildWhoIsNpdu() {
  // Local MS/TP Who-Is: NPDU version 1, expecting reply, unconfirmed Who-Is APDU.
  return Buffer.from([0x01, 0x04, 0x10, 0x08]);
}

function buildMstpFrame(frameType, destination, source, data) {
  const payload = data ? Buffer.from(data) : Buffer.alloc(0);
  const dataLen = payload.length;

  if (dataLen > MAX_FRAME_DATA_LEN) {
    throw new Error(`MS/TP data length ${dataLen} exceeds maximum ${MAX_FRAME_DATA_LEN}`);
  }

  const lenMsb = (dataLen >> 8) & 0xff;
  const lenLsb = dataLen & 0xff;
  const headerCrc = calcHeaderCrc([frameType, destination, source, lenMsb, lenLsb]);

  const frameParts = [
    0x55,
    0xff,
    frameType,
    destination,
    source,
    lenMsb,
    lenLsb,
    headerCrc,
  ];

  if (dataLen > 0) {
    const dataCrc = calcDataCrc(payload);
    frameParts.push(...payload, dataCrc & 0xff, (dataCrc >> 8) & 0xff);
  }

  return Buffer.from(frameParts);
}

function frameTypeLabel(frameType) {
  const labels = {
    [MSTP_FRAME_TYPE.TOKEN]: 'Token',
    [MSTP_FRAME_TYPE.POLL_FOR_MASTER]: 'Poll For Master',
    [MSTP_FRAME_TYPE.REPLY_TO_POLL_FOR_MASTER]: 'Reply To Poll For Master',
    [MSTP_FRAME_TYPE.TEST_REQUEST]: 'Test Request',
    [MSTP_FRAME_TYPE.TEST_RESPONSE]: 'Test Response',
    [MSTP_FRAME_TYPE.BACNET_DATA_EXPECTING_REPLY]: 'BACnet Data Expecting Reply',
    [MSTP_FRAME_TYPE.BACNET_DATA_NOT_EXPECTING_REPLY]: 'BACnet Data Not Expecting Reply',
    [MSTP_FRAME_TYPE.REPLY_POSTPONED]: 'Reply Postponed',
  };
  return labels[frameType] || `Unknown (${frameType})`;
}

function findNpduApdu(data) {
  if (!data || data.length < 2) {
    return { npduOffset: null, apduOffset: null, npduControl: null, sourceNet: null };
  }

  let offset = 0;
  const version = data[offset];
  if (version !== 0x01) {
    return {
      npduOffset: 0, apduOffset: null, npduControl: null, version, sourceNet: null,
    };
  }

  offset += 1;
  const control = data[offset];
  offset += 1;
  let sourceNet = null;

  if (control & 0x20) {
    if (offset + 2 > data.length) {
      return {
        npduOffset: 0, apduOffset: null, npduControl: control, version, sourceNet,
      };
    }
    const dnet = (data[offset] << 8) | data[offset + 1];
    offset += 2;
    if (offset >= data.length) {
      return {
        npduOffset: 0, apduOffset: null, npduControl: control, version, sourceNet,
      };
    }
    const dadrLen = data[offset];
    offset += 1 + dadrLen;
    if (dnet === 0xffff && dadrLen === 0 && offset < data.length) {
      offset += 1;
    }
  }

  if (control & 0x08) {
    if (offset + 2 > data.length) {
      return {
        npduOffset: 0, apduOffset: null, npduControl: control, version, sourceNet,
      };
    }
    // Source network specifier present — this indicates a routed NPDU. We capture
    // the raw value but do NOT treat it as the device's local network number.
    sourceNet = (data[offset] << 8) | data[offset + 1];
    offset += 2;
    if (offset >= data.length) {
      return {
        npduOffset: 0, apduOffset: null, npduControl: control, version, sourceNet,
      };
    }
    const sadrLen = data[offset];
    offset += 1 + sadrLen;
  }

  if (control & 0x80) {
    offset += 1;
  }

  return {
    npduOffset: 0,
    apduOffset: offset < data.length ? offset : null,
    npduControl: control,
    version,
    sourceNet,
  };
}

function readUnsigned(data, offset, length) {
  let value = 0;
  for (let i = 0; i < length; i += 1) {
    value = (value * 256) + data[offset + i];
  }
  return value;
}

function parseObjectIdentifier(data, offset) {
  // Use unsigned arithmetic to avoid 32-bit signed shift overflow.
  const encoded = (data[offset] * 0x1000000)
    + (data[offset + 1] * 0x10000)
    + (data[offset + 2] * 0x100)
    + data[offset + 3];
  const objectType = Math.floor(encoded / 0x400000);
  const instance = encoded % 0x400000;
  return { objectType, instance };
}

// Decode an application-tagged I-Am APDU. I-Am content is, in order:
//   1. BACnetObjectIdentifier (tag 12, 4 bytes)
//   2. Max APDU length accepted (Unsigned, tag 2)
//   3. Segmentation supported (Enumerated, tag 9)
//   4. Vendor ID (Unsigned, tag 2)
function parseIAmApdu(data, apduOffset) {
  if (apduOffset == null || data.length < apduOffset + 2) {
    return null;
  }

  const pduType = data[apduOffset];
  const serviceChoice = data[apduOffset + 1];

  if ((pduType & 0xf0) !== 0x10 || serviceChoice !== 0x00) {
    return null;
  }

  let offset = apduOffset + 2;
  let deviceInstance = null;
  let maxApdu = null;
  let segmentation = null;
  let vendorId = null;
  let unsignedSeen = 0;

  while (offset < data.length) {
    const tagByte = data[offset];
    const isContext = (tagByte & 0x08) !== 0;
    const tagNumber = (tagByte >> 4) & 0x0f;
    let length = tagByte & 0x07;
    let headerLen = 1;

    // Extended length form: low 3 bits == 5, real length in following byte.
    if (length === 5) {
      length = data[offset + 1];
      headerLen = 2;
    }

    // I-Am uses application tags only; a context tag means malformed/unexpected.
    if (isContext) {
      break;
    }

    const valueOffset = offset + headerLen;
    if (valueOffset + length > data.length) {
      break;
    }

    if (tagNumber === 12 && length === 4) {
      const objectId = parseObjectIdentifier(data, valueOffset);
      if (objectId.objectType === 8) {
        deviceInstance = objectId.instance;
      }
    } else if (tagNumber === 2) {
      const value = readUnsigned(data, valueOffset, length);
      if (unsignedSeen === 0) {
        maxApdu = value;
      } else if (unsignedSeen === 1) {
        vendorId = value;
      }
      unsignedSeen += 1;
    } else if (tagNumber === 9) {
      segmentation = readUnsigned(data, valueOffset, length);
    }

    offset = valueOffset + length;
  }

  if (deviceInstance == null) {
    return null;
  }

  return {
    deviceInstance,
    maxApdu,
    segmentation,
    vendorId,
    apduType: pduType,
    serviceChoice,
  };
}

function parseMstpFrames(buffer) {
  const frames = [];
  let index = 0;

  while (index < buffer.length - 7) {
    if (buffer[index] !== 0x55) {
      index += 1;
      continue;
    }

    if (buffer[index + 1] !== 0xff) {
      index += 1;
      continue;
    }

    const frameType = buffer[index + 2];
    const destination = buffer[index + 3];
    const source = buffer[index + 4];
    const lenMsb = buffer[index + 5];
    const lenLsb = buffer[index + 6];
    const headerCrc = buffer[index + 7];
    const dataLength = (lenMsb << 8) | lenLsb;

    const headerCrcValid = verifyHeaderCrc(frameType, destination, source, lenMsb, lenLsb, headerCrc);

    if (!headerCrcValid) {
      // Header CRC failed — the length bytes cannot be trusted. Record a
      // diagnostic frame and resynchronise on the next preamble.
      frames.push({
        frameType,
        frameTypeLabel: frameTypeLabel(frameType),
        destination,
        source,
        dataLength,
        headerCrcValid: false,
        dataCrcValid: null,
        data: Buffer.alloc(0),
        npdu: null,
        iAm: null,
        parseResult: 'header-crc-invalid',
        parseError: 'MS/TP header CRC mismatch',
        rawLength: 8,
      });
      index += 2;
      continue;
    }

    const frameEnd = index + 8 + dataLength + (dataLength > 0 ? 2 : 0);
    if (frameEnd > buffer.length) {
      // Incomplete frame — wait for the rest of the bytes.
      break;
    }

    let data = Buffer.alloc(0);
    let dataCrcValid = true;

    if (dataLength > 0) {
      data = buffer.slice(index + 8, index + 8 + dataLength);
      const crcLsb = buffer[index + 8 + dataLength];
      const crcMsb = buffer[index + 8 + dataLength + 1];
      dataCrcValid = verifyDataCrc(data, crcLsb, crcMsb);
    }

    let npduInfo = null;
    let iAm = null;
    let parseResult = null;
    let parseError = null;

    if (dataLength === 0) {
      parseResult = 'control-frame';
    } else if (!dataCrcValid) {
      parseResult = 'data-crc-invalid';
      parseError = 'MS/TP data CRC mismatch';
    } else {
      try {
        npduInfo = findNpduApdu(data);
        if (npduInfo?.apduOffset == null) {
          parseResult = 'no-apdu';
        } else {
          iAm = parseIAmApdu(data, npduInfo.apduOffset);
          if (iAm) {
            parseResult = 'i-am';
          } else if (
            frameType === MSTP_FRAME_TYPE.BACNET_DATA_EXPECTING_REPLY
            || frameType === MSTP_FRAME_TYPE.BACNET_DATA_NOT_EXPECTING_REPLY
          ) {
            parseResult = 'bacnet-apdu';
          } else {
            parseResult = 'parsed';
          }
        }
      } catch (err) {
        parseResult = 'parse-error';
        parseError = err.message;
      }
    }

    frames.push({
      frameType,
      frameTypeLabel: frameTypeLabel(frameType),
      destination,
      source,
      dataLength,
      headerCrcValid: true,
      dataCrcValid: dataLength > 0 ? dataCrcValid : null,
      // Keep the raw payload available for diagnostics even when the data CRC
      // failed. Device parsing is gated separately on a valid `iAm`.
      data,
      npdu: npduInfo,
      iAm,
      parseResult,
      parseError,
      rawLength: frameEnd - index,
    });

    index = frameEnd;
  }

  return { frames, remaining: buffer.slice(index) };
}

function openSerialPort(config) {
  return new Promise((resolve, reject) => {
    let port = null;

    try {
      port = new SerialPort({
        path: config.port,
        baudRate: config.baudRate,
        autoOpen: false,
      });
      attachPortErrorHandler(port);
    } catch (err) {
      reject(err);
      return;
    }

    port.open((openErr) => {
      if (openErr) {
        detachPort(port).finally(() => reject(openErr));
        return;
      }
      resolve(port);
    });
  });
}

async function openInterface(input = {}) {
  if (interfaceState.open) {
    addDiscoveryLog('info', 'MS/TP interface already open');
    return {
      success: true,
      message: 'MS/TP interface already open',
      status: getStatusSnapshot(),
    };
  }

  ensureSerialMonitorNotRunning();
  const config = validateConfig(normalizeConfig(input));

  try {
    serialService.configureSerial({ path: config.port, baudRate: config.baudRate });
  } catch (err) {
    interfaceState.lastError = err.message;
    addDiscoveryLog('error', `Serial configure failed: ${err.message}`);
    throw err;
  }

  let port;
  try {
    port = await openSerialPort(config);
  } catch (err) {
    interfaceState.lastError = err.message;
    addDiscoveryLog('error', `MS/TP interface open failed: ${err.message}`);
    throw err;
  }

  interfaceState.open = true;
  interfaceState.port = config.port;
  interfaceState.baudRate = config.baudRate;
  interfaceState.macAddress = config.macAddress;
  interfaceState.maxMaster = config.maxMaster;
  interfaceState.maxInfoFrames = config.maxInfoFrames;
  interfaceState.networkNumber = config.networkNumber;
  interfaceState.timeoutMs = config.timeoutMs;
  interfaceState.whoIsRetries = config.whoIsRetries;
  interfaceState.retryIntervalMs = config.retryIntervalMs;
  interfaceState.tokenMode = config.tokenMode;
  interfaceState.serialPort = port;
  interfaceState.rxBytes = 0;
  interfaceState.txBytes = 0;
  interfaceState.lastActivityAt = null;
  interfaceState.lastError = null;
  interfaceState.openedAt = new Date().toISOString();

  registerProcessCleanup();
  addDiscoveryLog('info', `MS/TP interface opened on ${config.port} at ${config.baudRate} baud (MAC ${config.macAddress})`);

  return {
    success: true,
    message: 'MS/TP interface opened',
    status: getStatusSnapshot(),
  };
}

async function closeInterfaceInternal(reason = null) {
  const port = interfaceState.serialPort;
  const wasOpen = interfaceState.open;

  interfaceState.serialPort = null;
  interfaceState.open = false;

  if (port) {
    await detachPort(port);
  }

  if (wasOpen) {
    addDiscoveryLog('info', reason ? `MS/TP interface closed — ${reason}` : 'MS/TP interface closed');
  }

  return {
    success: true,
    message: wasOpen ? 'MS/TP interface closed' : 'MS/TP interface already closed',
    status: getStatusSnapshot(),
  };
}

async function closeInterface() {
  return closeInterfaceInternal();
}

function writeToPort(port, buffer) {
  return new Promise((resolve, reject) => {
    port.write(buffer, (writeErr) => {
      if (writeErr) {
        reject(writeErr);
        return;
      }
      port.drain((drainErr) => {
        if (drainErr) {
          reject(drainErr);
          return;
        }
        resolve();
      });
    });
  });
}

async function discover(input = {}) {
  if (activeDiscovery) {
    const error = new Error('BACnet MS/TP discovery is already in progress');
    error.statusCode = 409;
    error.code = 'DISCOVERY_IN_PROGRESS';
    throw error;
  }

  const startedAt = Date.now();
  const config = validateConfig(normalizeConfig(input));
  const timeoutMs = config.timeoutMs;
  const whoIsRetries = config.whoIsRetries;
  const retryIntervalMs = config.retryIntervalMs;
  const wasOpenBefore = interfaceState.open;
  const openedForDiscovery = !wasOpenBefore;
  const warnings = [];

  ensureSerialMonitorNotRunning();

  // Each discovery run gets a unique session id. Every log line, discovered
  // device, and frame diagnostic is tagged with it.
  const discoverySessionId = crypto.randomUUID();

  // Clear only the temporary discovery result buffers — never the persistent
  // inventory. The session buffer and frame diagnostics start fresh each run.
  frameDiagnostics.length = 0;
  lastSession = {
    discoverySessionId,
    startedAt: new Date(startedAt).toISOString(),
    finishedAt: null,
    durationMs: null,
    configuredNetworkNumber: config.networkNumber,
    devices: [],
  };

  const seen = new Map();
  const sessionLogs = [];
  let rxBuffer = Buffer.alloc(0);
  let dataListener = null;
  let discoveryTimer = null;
  let retryTimer = null;

  const recordSessionLog = (level, message, extra = {}) => {
    const enriched = { discoverySessionId, ...extra };
    sessionLogs.push({
      time: new Date().toISOString(),
      level,
      source: 'bacnet-mstp',
      message,
      ...enriched,
    });
    addDiscoveryLog(level, message, enriched);
  };

  activeDiscovery = { startedAt, config, timeoutMs, discoverySessionId };

  try {
    if (!interfaceState.open) {
      await openInterface(config);
    } else {
      Object.assign(interfaceState, {
        macAddress: config.macAddress,
        maxMaster: config.maxMaster,
        maxInfoFrames: config.maxInfoFrames,
        networkNumber: config.networkNumber,
        timeoutMs: config.timeoutMs,
        whoIsRetries: config.whoIsRetries,
        retryIntervalMs: config.retryIntervalMs,
        tokenMode: config.tokenMode,
      });
    }

    const port = interfaceState.serialPort;
    if (!port || !port.isOpen) {
      throw new Error('MS/TP serial port is not open');
    }

    dataListener = (chunk) => {
      try {
        interfaceState.rxBytes += chunk.length;
        interfaceState.lastActivityAt = new Date().toISOString();
        rxBuffer = Buffer.concat([rxBuffer, chunk]);

        const { frames, remaining } = parseMstpFrames(rxBuffer);
        rxBuffer = remaining;

        for (const frame of frames) {
          // Record a raw diagnostic for every received frame, regardless of
          // whether it parsed into a device.
          recordFrameDiagnostic(frame, discoverySessionId);

          if (frame.iAm) {
            // Deduplicate by deviceInstance + MS/TP MAC. Update lastSeenAt for
            // devices already seen this session rather than creating duplicates.
            const key = `${frame.source}:${frame.iAm.deviceInstance}`;
            const existing = seen.get(key);
            if (existing) {
              existing.lastSeenAt = new Date().toISOString();
              existing.sightings += 1;
              continue;
            }

            const sourceNetworkRaw = frame.npdu?.sourceNet ?? null;
            const nowIso = new Date().toISOString();
            const device = {
              protocol: 'BACnet',
              transport: 'BACnet MS/TP',
              deviceInstance: frame.iAm.deviceInstance,
              // Distinct MS/TP MAC field — never reuse the generic "address".
              mstpMacAddress: frame.source,
              macAddress: frame.source,
              // networkNumber for a locally discovered device is the configured
              // local MS/TP network number, NOT a value inferred from the payload.
              configuredNetworkNumber: config.networkNumber,
              networkNumber: config.networkNumber,
              // Raw routed source network, if the NPDU carried one. Stored
              // separately and never promoted to networkNumber until verified.
              sourceNetworkRaw,
              vendorId: frame.iAm.vendorId ?? null,
              maxApdu: frame.iAm.maxApdu ?? null,
              segmentation: frame.iAm.segmentation ?? null,
              status: 'online',
              firstSeenAt: nowIso,
              lastSeenAt: nowIso,
              sightings: 1,
              discoverySessionId,
              source: 'bacnet-mstp-discovery',
              frameType: frame.frameType,
              frameTypeLabel: frame.frameTypeLabel,
            };

            seen.set(key, device);
            recordSessionLog('info', `I-Am received from MAC ${frame.source}, device instance ${frame.iAm.deviceInstance}`, {
              mstpMacAddress: frame.source,
              deviceInstance: frame.iAm.deviceInstance,
              configuredNetworkNumber: config.networkNumber,
              sourceNetworkRaw,
            });
            if (sourceNetworkRaw != null) {
              recordSessionLog('warn', `Routed source network ${sourceNetworkRaw} detected on I-Am from MAC ${frame.source} — stored as sourceNetworkRaw only (not verified)`, {
                mstpMacAddress: frame.source,
                deviceInstance: frame.iAm.deviceInstance,
                sourceNetworkRaw,
              });
            }
          } else if (
            frame.headerCrcValid
            && frame.dataCrcValid
            && (frame.frameType === MSTP_FRAME_TYPE.BACNET_DATA_EXPECTING_REPLY
              || frame.frameType === MSTP_FRAME_TYPE.BACNET_DATA_NOT_EXPECTING_REPLY)
          ) {
            recordSessionLog('debug', `BACnet MS/TP data frame from MAC ${frame.source} (${frame.frameTypeLabel})`, {
              mstpMacAddress: frame.source,
              frameType: frame.frameType,
            });
          }
        }
      } catch (err) {
        recordSessionLog('warn', `RX parse error (ignored): ${err.message}`);
      }
    };

    port.on('data', dataListener);

    const whoIsData = buildWhoIsNpdu();
    const whoIsFrame = buildMstpFrame(
      MSTP_FRAME_TYPE.BACNET_DATA_NOT_EXPECTING_REPLY,
      MSTP_BROADCAST_MAC,
      config.macAddress,
      whoIsData,
    );

    if (config.tokenMode && !TOKEN_PARTICIPATION_IMPLEMENTED) {
      const tokenWarning = 'Token mode requested, but MS/TP token participation is not implemented yet. Falling back to send-only diagnostic discovery.';
      warnings.push(tokenWarning);
      recordSessionLog('warn', tokenWarning);
    } else if (!TOKEN_PARTICIPATION_IMPLEMENTED) {
      recordSessionLog('warn', 'MS/TP token participation not implemented — frames are sent directly on the bus');
    }

    let sends = 0;
    const sendWhoIs = async () => {
      sends += 1;
      await writeToPort(port, whoIsFrame);
      interfaceState.txBytes += whoIsFrame.length;
      interfaceState.lastActivityAt = new Date().toISOString();
      recordSessionLog('info', `Who-Is broadcast ${sends}/${whoIsRetries} sent (${whoIsFrame.length} bytes)`, {
        macAddress: config.macAddress,
        frameBytes: whoIsFrame.length,
        attempt: sends,
        whoIsRetries,
      });
    };

    // Active retry: send Who-Is up to `whoIsRetries` times, spaced
    // `retryIntervalMs` apart, all within the discovery window.
    await sendWhoIs();
    if (whoIsRetries > 1) {
      retryTimer = setInterval(() => {
        if (sends >= whoIsRetries) {
          clearInterval(retryTimer);
          retryTimer = null;
          return;
        }
        sendWhoIs().catch((err) => {
          recordSessionLog('warn', `Who-Is retry failed: ${err.message}`);
        });
      }, retryIntervalMs);
    }

    await new Promise((resolve) => {
      discoveryTimer = setTimeout(resolve, timeoutMs);
    });

    if (retryTimer) {
      clearInterval(retryTimer);
      retryTimer = null;
    }

    const devices = Array.from(seen.values());
    const durationMs = Date.now() - startedAt;

    lastSession.finishedAt = new Date().toISOString();
    lastSession.durationMs = durationMs;
    lastSession.devices = devices;

    if (devices.length === 0) {
      recordSessionLog('info', 'Discovery timeout — no MS/TP I-Am responses received');
    } else {
      recordSessionLog('info', `Discovery complete — ${devices.length} device(s) found in ${durationMs}ms`);
    }

    return {
      success: true,
      implemented: true,
      discoverySessionId,
      discoveredAt: new Date().toISOString(),
      durationMs,
      devices,
      logs: sessionLogs,
      frames: [...frameDiagnostics],
      warnings,
      tokenMode: config.tokenMode,
      tokenParticipationImplemented: TOKEN_PARTICIPATION_IMPLEMENTED,
      message: devices.length === 0 ? 'No MS/TP responses received.' : undefined,
      status: getStatusSnapshot(),
    };
  } catch (err) {
    interfaceState.lastError = err.message;
    recordSessionLog('error', `Discovery failed: ${err.message}`);
    if (lastSession) {
      lastSession.finishedAt = new Date().toISOString();
      lastSession.durationMs = Date.now() - startedAt;
    }
    return {
      success: false,
      implemented: true,
      discoverySessionId,
      message: err.message,
      discoveredAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
      devices: [],
      logs: sessionLogs,
      frames: [...frameDiagnostics],
      warnings,
      tokenMode: config.tokenMode,
      tokenParticipationImplemented: TOKEN_PARTICIPATION_IMPLEMENTED,
      status: getStatusSnapshot(),
    };
  } finally {
    if (discoveryTimer) {
      clearTimeout(discoveryTimer);
    }
    if (retryTimer) {
      clearInterval(retryTimer);
    }

    const port = interfaceState.serialPort;
    if (port && dataListener) {
      try {
        port.removeListener('data', dataListener);
      } catch {
        // ignore listener cleanup failures
      }
    }

    activeDiscovery = null;

    if (openedForDiscovery) {
      await closeInterfaceInternal('Discovery finished');
    }
  }
}

module.exports = {
  getDefaultConfig,
  normalizeConfig,
  getStatus,
  getLogs,
  clearLogs,
  getFrames,
  getSession,
  clearSession,
  openInterface,
  closeInterface,
  discover,
  buildWhoIsNpdu,
  buildMstpFrame,
  parseMstpFrames,
  parseIAmApdu,
};
