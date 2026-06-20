const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');
const { SerialPort } = require('serialport');

const ALLOWED_PATHS = ['/dev/serial0', '/dev/ttyAMA0', '/dev/ttyS0', '/dev/ttyUSB0'];
const ALLOWED_BAUD_RATES = [9600, 19200, 38400, 57600, 76800, 115200];

const RS485_RECOMMENDED = new Set(['/dev/serial0', '/dev/ttyAMA0', '/dev/ttyS0']);

let lastOpenCheck = null;
let lastConfigure = null;

const monitorState = {
  running: false,
  path: null,
  baudRate: null,
  rxBytes: 0,
  txBytes: 0,
  lastActivityAt: null,
  lastError: null,
  startedAt: null,
  port: null,
};

function pathExists(devicePath) {
  try {
    fs.accessSync(devicePath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function readSymlinkTarget(devicePath) {
  try {
    const target = fs.readlinkSync(devicePath);
    return path.basename(target);
  } catch {
    return null;
  }
}

function readCurrentBaudRate(devicePath) {
  if (!pathExists(devicePath)) return null;
  try {
    const output = execSync(`stty -F ${devicePath} speed`, {
      encoding: 'utf8',
      timeout: 3000,
    }).trim();
    const match = output.match(/(\d+)/);
    return match ? Number(match[1]) : null;
  } catch {
    return null;
  }
}

function portNotes(devicePath) {
  if (devicePath === '/dev/serial0') return 'Recommended RS485 HAT port';
  if (devicePath === '/dev/ttyAMA0') return 'Primary UART (may conflict with Bluetooth)';
  if (devicePath === '/dev/ttyS0') return 'Mini UART behind /dev/serial0 symlink';
  if (devicePath === '/dev/ttyUSB0') return 'USB serial adapter';
  return null;
}

function buildPortDetail(devicePath) {
  const exists = pathExists(devicePath);
  return {
    path: devicePath,
    exists,
    symlinkTarget: exists ? readSymlinkTarget(devicePath) : null,
    currentBaudRate: exists ? readCurrentBaudRate(devicePath) : null,
    recommendedForRs485: RS485_RECOMMENDED.has(devicePath),
    openable: exists,
    notes: portNotes(devicePath),
  };
}

function getDefaultPort() {
  if (pathExists('/dev/serial0')) return '/dev/serial0';
  const first = ALLOWED_PATHS.find(pathExists);
  return first || '/dev/serial0';
}

function getSerialDetail() {
  const ports = ALLOWED_PATHS.map(buildPortDetail);
  return {
    ports,
    defaultPort: getDefaultPort(),
    monitor: getMonitorStatus(),
    lastOpenCheck,
    lastConfigure,
    scannedAt: new Date().toISOString(),
  };
}

function validatePath(devicePath) {
  if (!ALLOWED_PATHS.includes(devicePath)) {
    const error = new Error(`Serial path not allowed: ${devicePath}`);
    error.statusCode = 400;
    error.code = 'INVALID_PATH';
    throw error;
  }
  if (!pathExists(devicePath)) {
    const error = new Error(`Serial port not found: ${devicePath}`);
    error.statusCode = 404;
    error.code = 'PORT_NOT_FOUND';
    throw error;
  }
}

function validateBaudRate(baudRate) {
  const rate = Number(baudRate);
  if (!ALLOWED_BAUD_RATES.includes(rate)) {
    const error = new Error(`Baud rate not allowed: ${baudRate}`);
    error.statusCode = 400;
    error.code = 'INVALID_BAUD_RATE';
    throw error;
  }
  return rate;
}

function configureSerial({ path: devicePath, baudRate }) {
  validatePath(devicePath);
  const rate = validateBaudRate(baudRate);

  try {
    execSync(`stty -F ${devicePath} ${rate} cs8 -cstopb -parenb raw -echo`, {
      encoding: 'utf8',
      timeout: 5000,
    });
  } catch (err) {
    const error = new Error(`Failed to configure serial port: ${err.message}`);
    error.statusCode = 500;
    error.code = 'STTY_FAILED';
    throw error;
  }

  const port = buildPortDetail(devicePath);
  lastConfigure = {
    path: devicePath,
    baudRate: rate,
    configuredAt: new Date().toISOString(),
    success: true,
  };

  return {
    success: true,
    port,
    configuredAt: lastConfigure.configuredAt,
  };
}

function openSerialCheck({ path: devicePath, baudRate }) {
  validatePath(devicePath);
  const rate = validateBaudRate(baudRate);
  const startedAt = Date.now();

  return new Promise((resolve, reject) => {
    let port;
    let settled = false;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      lastOpenCheck = {
        ...result,
        path: devicePath,
        baudRate: rate,
        checkedAt: new Date().toISOString(),
      };
      resolve(result);
    };

    const fail = (err) => {
      if (settled) return;
      settled = true;
      const result = {
        success: false,
        path: devicePath,
        baudRate: rate,
        responseTimeMs: Date.now() - startedAt,
        error: err.message,
        checkedAt: new Date().toISOString(),
      };
      lastOpenCheck = result;
      resolve(result);
    };

    try {
      port = new SerialPort({
        path: devicePath,
        baudRate: rate,
        autoOpen: false,
      });

      port.open((openErr) => {
        const responseTimeMs = Date.now() - startedAt;
        if (openErr) {
          try { port.close(); } catch { /* ignore */ }
          fail(openErr);
          return;
        }

        port.close((closeErr) => {
          if (closeErr) {
            fail(closeErr);
            return;
          }
          finish({
            success: true,
            path: devicePath,
            baudRate: rate,
            responseTimeMs,
            error: null,
            checkedAt: new Date().toISOString(),
          });
        });
      });
    } catch (err) {
      fail(err);
    }
  });
}

function getLastOpenCheck() {
  return lastOpenCheck;
}

function getLastConfigure() {
  return lastConfigure;
}

function getMonitorStatus() {
  return {
    running: monitorState.running,
    path: monitorState.path,
    baudRate: monitorState.baudRate,
    rxBytes: monitorState.rxBytes,
    txBytes: monitorState.txBytes,
    lastActivityAt: monitorState.lastActivityAt,
    lastError: monitorState.lastError,
    startedAt: monitorState.startedAt,
  };
}

function stopMonitorInternal() {
  return new Promise((resolve) => {
    if (!monitorState.port) {
      monitorState.running = false;
      resolve(getMonitorStatus());
      return;
    }

    const port = monitorState.port;
    monitorState.port = null;
    monitorState.running = false;

    port.close(() => {
      resolve(getMonitorStatus());
    });
  });
}

function startSerialMonitor({ path: devicePath, baudRate }) {
  if (monitorState.running) {
    const error = new Error('Serial monitor is already running');
    error.statusCode = 409;
    error.code = 'MONITOR_RUNNING';
    throw error;
  }

  if (os.platform() === 'win32') {
    const error = new Error('Serial monitor is not supported on Windows development hosts');
    error.statusCode = 501;
    error.code = 'UNSUPPORTED_PLATFORM';
    throw error;
  }

  validatePath(devicePath);
  const rate = validateBaudRate(baudRate);

  return new Promise((resolve, reject) => {
    try {
      const port = new SerialPort({
        path: devicePath,
        baudRate: rate,
        autoOpen: false,
      });

      port.on('data', (data) => {
        monitorState.rxBytes += data.length;
        monitorState.lastActivityAt = new Date().toISOString();
      });

      port.on('error', (err) => {
        monitorState.lastError = err.message;
      });

      port.open((openErr) => {
        if (openErr) {
          monitorState.lastError = openErr.message;
          reject(openErr);
          return;
        }

        monitorState.running = true;
        monitorState.path = devicePath;
        monitorState.baudRate = rate;
        monitorState.rxBytes = 0;
        monitorState.txBytes = 0;
        monitorState.lastActivityAt = null;
        monitorState.lastError = null;
        monitorState.startedAt = new Date().toISOString();
        monitorState.port = port;
        resolve(getMonitorStatus());
      });
    } catch (err) {
      reject(err);
    }
  });
}

async function stopSerialMonitor() {
  if (!monitorState.running) {
    return getMonitorStatus();
  }
  return stopMonitorInternal();
}

module.exports = {
  ALLOWED_PATHS,
  ALLOWED_BAUD_RATES,
  getSerialDetail,
  configureSerial,
  openSerialCheck,
  getLastOpenCheck,
  getLastConfigure,
  getMonitorStatus,
  startSerialMonitor,
  stopSerialMonitor,
};
