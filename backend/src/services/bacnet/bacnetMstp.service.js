const os = require('os');
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
const MAX_LOG_ENTRIES = 500;
const MAX_FRAME_DATA_LEN = 501;

const interfaceState = {
  open: false,
  port: null,
  serialPort: null,
  baudRate: null,
  macAddress: null,
  maxMaster: null,
  maxInfoFrames: null,
  networkNumber: null,
  rxBytes: 0,
  txBytes: 0,
  lastActivityAt: null,
  lastError: null,
  openedAt: null,
};

const discoveryLogs = [];

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

function getDefaultConfig() {
  const settings = loadSettings().bacnet?.mstp || {};
  return {
    port: settings.serialPort || '/dev/serial0',
    baudRate: settings.baudRate || 38400,
    macAddress: settings.macAddress ?? 5,
    maxMaster: settings.maxMaster ?? 127,
    maxInfoFrames: settings.maxInfoFrames ?? 1,
    networkNumber: settings.networkNumber ?? 2,
  };
}

function normalizeConfig(input = {}) {
  const defaults = getDefaultConfig();
  return {
    port: input.port || defaults.port,
    baudRate: Number(input.baudRate ?? defaults.baudRate),
    macAddress: Number(input.macAddress ?? defaults.macAddress),
    maxMaster: Number(input.maxMaster ?? defaults.maxMaster),
    maxInfoFrames: Number(input.maxInfoFrames ?? defaults.maxInfoFrames),
    networkNumber: Number(input.networkNumber ?? defaults.networkNumber),
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

  if (!Number.isInteger(config.macAddress) || config.macAddress < 0 || config.macAddress > 254) {
    const error = new Error('macAddress must be an integer between 0 and 254');
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

  return config;
}

function getStatusSnapshot() {
  return {
    open: interfaceState.open,
    port: interfaceState.port,
    baudRate: interfaceState.baudRate,
    macAddress: interfaceState.macAddress,
    maxMaster: interfaceState.maxMaster,
    maxInfoFrames: interfaceState.maxInfoFrames,
    networkNumber: interfaceState.networkNumber,
    rxBytes: interfaceState.rxBytes,
    txBytes: interfaceState.txBytes,
    lastActivityAt: interfaceState.lastActivityAt,
    lastError: interfaceState.lastError,
    openedAt: interfaceState.openedAt,
    discoveryInProgress: Boolean(activeDiscovery),
  };
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
    return { npduOffset: null, apduOffset: null, npduControl: null };
  }

  let offset = 0;
  const version = data[offset];
  if (version !== 0x01) {
    return { npduOffset: 0, apduOffset: null, npduControl: null, version };
  }

  offset += 1;
  const control = data[offset];
  offset += 1;

  if (control & 0x20) {
    if (offset + 2 > data.length) {
      return { npduOffset: 0, apduOffset: null, npduControl: control, version };
    }
    const dnet = (data[offset] << 8) | data[offset + 1];
    offset += 2;
    if (offset >= data.length) {
      return { npduOffset: 0, apduOffset: null, npduControl: control, version };
    }
    const dadrLen = data[offset];
    offset += 1 + dadrLen;
    if (dnet === 0xffff && dadrLen === 0 && offset < data.length) {
      offset += 1;
    }
  }

  if (control & 0x08) {
    if (offset + 2 > data.length) {
      return { npduOffset: 0, apduOffset: null, npduControl: control, version };
    }
    offset += 2;
    if (offset >= data.length) {
      return { npduOffset: 0, apduOffset: null, npduControl: control, version };
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
  };
}

function decodeUnsignedTag(data, offset) {
  const tag = data[offset];
  const tagNumber = (tag >> 4) & 0x0f;
  const length = tag & 0x0f;
  const valueBytes = data.slice(offset + 1, offset + 1 + length);
  let value = 0;
  for (const byte of valueBytes) {
    value = (value << 8) | byte;
  }
  return { tagNumber, length, value, nextOffset: offset + 1 + length };
}

function parseObjectIdentifier(data, offset) {
  const encoded = (data[offset] << 24)
    | (data[offset + 1] << 16)
    | (data[offset + 2] << 8)
    | data[offset + 3];
  const objectType = (encoded >> 22) & 0x3ff;
  const instance = encoded & 0x3fffff;
  return { objectType, instance };
}

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

  while (offset < data.length) {
    const tagByte = data[offset];
    const tagClass = (tagByte >> 4) & 0x07;
    const tagNumber = (tagByte >> 4) & 0x0f;
    const length = tagByte & 0x0f;

    if (length === 0x0f || tagClass === 0x07) {
      break;
    }

    if (tagNumber === 0x0c && length === 4) {
      const objectId = parseObjectIdentifier(data, offset + 1);
      if (objectId.objectType === 8) {
        deviceInstance = objectId.instance;
      }
    } else if (tagNumber === 0x02 || tagNumber === 0x01) {
      const decoded = decodeUnsignedTag(data, offset);
      if (maxApdu == null) {
        maxApdu = decoded.value;
      } else if (vendorId == null) {
        vendorId = decoded.value;
      }
      offset = decoded.nextOffset;
      continue;
    } else if (tagNumber === 0x09 && length === 1) {
      segmentation = data[offset + 1];
    }

    offset += 1 + length;
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
    const frameEnd = index + 8 + dataLength + (dataLength > 0 ? 2 : 0);

    if (frameEnd > buffer.length) {
      break;
    }

    if (!verifyHeaderCrc(frameType, destination, source, lenMsb, lenLsb, headerCrc)) {
      addDiscoveryLog('warn', 'MS/TP header CRC mismatch — skipping frame', {
        sourceMac: source,
        frameType,
      });
      index += 2;
      continue;
    }

    let data = Buffer.alloc(0);
    let dataValid = true;

    if (dataLength > 0) {
      data = buffer.slice(index + 8, index + 8 + dataLength);
      const crcLsb = buffer[index + 8 + dataLength];
      const crcMsb = buffer[index + 8 + dataLength + 1];
      dataValid = verifyDataCrc(data, crcLsb, crcMsb);
      if (!dataValid) {
        addDiscoveryLog('warn', 'MS/TP data CRC mismatch — skipping frame', {
          sourceMac: source,
          frameType,
        });
      }
    }

    const npduInfo = dataValid && dataLength > 0 ? findNpduApdu(data) : null;
    const iAm = dataValid && npduInfo?.apduOffset != null
      ? parseIAmApdu(data, npduInfo.apduOffset)
      : null;

    frames.push({
      frameType,
      frameTypeLabel: frameTypeLabel(frameType),
      destination,
      source,
      dataLength,
      dataValid,
      data: dataValid ? data : Buffer.alloc(0),
      npdu: npduInfo,
      iAm,
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
  const timeoutMs = Math.min(Math.max(Number(input.timeoutMs) || 8000, 1000), 60000);
  const wasOpenBefore = interfaceState.open;
  const openedForDiscovery = !wasOpenBefore;

  ensureSerialMonitorNotRunning();

  const seen = new Map();
  const sessionLogs = [];
  let rxBuffer = Buffer.alloc(0);
  let dataListener = null;
  let discoveryTimer = null;

  const recordSessionLog = (level, message, extra = {}) => {
    sessionLogs.push({
      time: new Date().toISOString(),
      level,
      source: 'bacnet-mstp',
      message,
      ...extra,
    });
    addDiscoveryLog(level, message, extra);
  };

  activeDiscovery = { startedAt, config, timeoutMs };

  try {
    if (!interfaceState.open) {
      await openInterface(config);
    } else {
      Object.assign(interfaceState, {
        macAddress: config.macAddress,
        maxMaster: config.maxMaster,
        maxInfoFrames: config.maxInfoFrames,
        networkNumber: config.networkNumber,
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
          if (frame.iAm) {
            const key = `${frame.source}:${frame.iAm.deviceInstance}`;
            if (seen.has(key)) continue;

            const device = {
              protocol: 'BACnet',
              transport: 'BACnet MS/TP',
              deviceInstance: frame.iAm.deviceInstance,
              macAddress: frame.source,
              networkNumber: config.networkNumber,
              vendorId: frame.iAm.vendorId ?? null,
              maxApdu: frame.iAm.maxApdu ?? null,
              segmentation: frame.iAm.segmentation ?? null,
              status: 'online',
              lastSeenAt: new Date().toISOString(),
              source: 'bacnet-mstp-discovery',
              frameType: frame.frameType,
              frameTypeLabel: frame.frameTypeLabel,
            };

            seen.set(key, device);
            recordSessionLog('info', `I-Am received from MAC ${frame.source}, device instance ${frame.iAm.deviceInstance}`, {
              macAddress: frame.source,
              deviceInstance: frame.iAm.deviceInstance,
            });
            recordSessionLog('info', `Device discovered — instance ${frame.iAm.deviceInstance} at MAC ${frame.source}`, {
              macAddress: frame.source,
              deviceInstance: frame.iAm.deviceInstance,
            });
          } else if (
            frame.dataValid
            && (frame.frameType === MSTP_FRAME_TYPE.BACNET_DATA_EXPECTING_REPLY
              || frame.frameType === MSTP_FRAME_TYPE.BACNET_DATA_NOT_EXPECTING_REPLY)
          ) {
            recordSessionLog('debug', `BACnet MS/TP data frame from MAC ${frame.source} (${frame.frameTypeLabel})`, {
              sourceMac: frame.source,
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

    recordSessionLog('info', `Sending BACnet Who-Is broadcast (${whoIsFrame.length} bytes)`, {
      macAddress: config.macAddress,
      frameBytes: whoIsFrame.length,
    });
    recordSessionLog('warn', 'MS/TP token participation not implemented — frame sent directly on bus');

    await writeToPort(port, whoIsFrame);
    interfaceState.txBytes += whoIsFrame.length;
    interfaceState.lastActivityAt = new Date().toISOString();

    await new Promise((resolve) => {
      discoveryTimer = setTimeout(resolve, timeoutMs);
    });

    const devices = Array.from(seen.values());
    const durationMs = Date.now() - startedAt;

    if (devices.length === 0) {
      recordSessionLog('info', 'Discovery timeout — no MS/TP I-Am responses received');
    } else {
      recordSessionLog('info', `Discovery complete — ${devices.length} device(s) found in ${durationMs}ms`);
    }

    return {
      success: true,
      implemented: true,
      discoveredAt: new Date().toISOString(),
      durationMs,
      devices,
      logs: sessionLogs,
      message: devices.length === 0 ? 'No MS/TP responses received.' : undefined,
      status: getStatusSnapshot(),
    };
  } catch (err) {
    interfaceState.lastError = err.message;
    recordSessionLog('error', `Discovery failed: ${err.message}`);
    return {
      success: false,
      implemented: true,
      message: err.message,
      discoveredAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
      devices: [],
      logs: sessionLogs,
      status: getStatusSnapshot(),
    };
  } finally {
    if (discoveryTimer) {
      clearTimeout(discoveryTimer);
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
  getStatus,
  getLogs,
  clearLogs,
  openInterface,
  closeInterface,
  discover,
  buildWhoIsNpdu,
  buildMstpFrame,
  parseMstpFrames,
  parseIAmApdu,
};
