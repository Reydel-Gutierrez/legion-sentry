const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');
const { SerialPort } = require('serialport');
const serialOwnership = require('./serialOwnership');

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

let processCleanupRegistered = false;
let monitorFaultCleanupInProgress = false;

function logSerial(message, level = 'info') {
  const logFn = level === 'error' ? console.error : console.log;
  logFn(`[serial] ${message}`);
}

function attachPortErrorListener(port, context = 'serial') {
  if (!port || port.__legionSerialErrorBound) return;
  port.__legionSerialErrorBound = true;
  port.on('error', (err) => {
    const message = err?.message || String(err);
    if (context === 'monitor') {
      monitorState.lastError = message;
      logSerial(`serial monitor fault: ${message}`, 'error');
      scheduleMonitorFaultCleanup();
      return;
    }
    logSerial(`${context} fault: ${message}`, 'error');
  });
}

function safeClosePort(port) {
  return new Promise((resolve) => {
    if (!port) {
      resolve(null);
      return;
    }

    if (!port.isOpen) {
      logSerial('serial close skipped because port not open');
      resolve(null);
      return;
    }

    try {
      port.close((closeErr) => {
        if (closeErr) {
          logSerial(`serial close failed: ${closeErr.message}`, 'error');
        }
        resolve(closeErr || null);
      });
    } catch (err) {
      logSerial(`serial close failed: ${err.message}`, 'error');
      resolve(err);
    }
  });
}

async function detachAndDestroyPort(port) {
  if (!port) return;

  try {
    port.removeAllListeners();
  } catch {
    // ignore listener cleanup failures
  }

  await safeClosePort(port);
}

function resetMonitorState() {
  monitorState.running = false;
  monitorState.path = null;
  monitorState.baudRate = null;
  monitorState.rxBytes = 0;
  monitorState.txBytes = 0;
  monitorState.lastActivityAt = null;
  monitorState.lastError = null;
  monitorState.startedAt = null;
  monitorState.port = null;
}

function registerProcessCleanup() {
  if (processCleanupRegistered) return;
  processCleanupRegistered = true;

  const cleanup = () => {
    try {
      const port = monitorState.port;
      if (port && port.isOpen) {
        try {
          port.close(() => {});
        } catch {
          // ignore close failures during process shutdown
        }
      }
    } catch {
      // ignore cleanup failures during process shutdown
    } finally {
      monitorState.port = null;
      monitorState.running = false;
    }
  };

  process.once('SIGINT', cleanup);
  process.once('SIGTERM', cleanup);
  process.once('beforeExit', cleanup);
}

function scheduleMonitorFaultCleanup() {
  if (monitorFaultCleanupInProgress || !monitorState.running) return;
  monitorFaultCleanupInProgress = true;

  setImmediate(() => {
    stopMonitorInternal()
      .catch((err) => {
        logSerial(`serial monitor fault cleanup failed: ${err.message}`, 'error');
      })
      .finally(() => {
        monitorFaultCleanupInProgress = false;
      });
  });
}

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
    serialOwnership: serialOwnership.getOwner(),
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

function createSerialError(message, statusCode = 500, code = 'SERIAL_ERROR') {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function openSerialCheck({ path: devicePath, baudRate }) {
  validatePath(devicePath);
  const rate = validateBaudRate(baudRate);
  const startedAt = Date.now();

  return new Promise((resolve) => {
    let port = null;
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
      const message = err?.message || String(err);
      logSerial(`serial open failed: ${message}`, 'error');
      const result = {
        success: false,
        path: devicePath,
        baudRate: rate,
        responseTimeMs: Date.now() - startedAt,
        error: message,
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
      attachPortErrorListener(port, 'open-check');
    } catch (err) {
      fail(err);
      return;
    }

    try {
      port.open(async (openErr) => {
        const responseTimeMs = Date.now() - startedAt;

        if (openErr) {
          await detachAndDestroyPort(port);
          fail(openErr);
          return;
        }

        await safeClosePort(port);

        try {
          port.removeAllListeners();
        } catch {
          // ignore listener cleanup failures
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
    } catch (err) {
      detachAndDestroyPort(port)
        .catch(() => {})
        .finally(() => fail(err));
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
    serialOwner: serialOwnership.getOwner().owner,
  };
}

async function stopMonitorInternal() {
  const port = monitorState.port;
  const previousStatus = getMonitorStatus();

  monitorState.port = null;
  monitorState.running = false;

  if (!port) {
    serialOwnership.release(serialOwnership.SERIAL_OWNER.DIAGNOSTICS, {
      force: true,
      reason: 'monitor_already_stopped',
    });
    return previousStatus;
  }

  try {
    await safeClosePort(port);
  } catch (err) {
    logSerial(`serial monitor stop cleanup failed: ${err.message}`, 'error');
  }

  try {
    port.removeAllListeners();
  } catch {
    // ignore listener cleanup failures
  }

  serialOwnership.release(serialOwnership.SERIAL_OWNER.DIAGNOSTICS, {
    force: true,
    reason: 'monitor_stopped',
  });
  logSerial('serial monitor stopped');
  return getMonitorStatus();
}

function startSerialMonitor({ path: devicePath, baudRate }) {
  if (monitorState.running) {
    throw createSerialError('Serial monitor is already running', 409, 'MONITOR_RUNNING');
  }

  if (os.platform() === 'win32') {
    throw createSerialError(
      'Serial monitor is not supported on Windows development hosts',
      501,
      'UNSUPPORTED_PLATFORM',
    );
  }

  try {
    serialOwnership.assertCanAcquire(serialOwnership.SERIAL_OWNER.DIAGNOSTICS);
  } catch (err) {
    throw createSerialError(
      err.message || 'Serial port is owned by BACnet MS/TP',
      409,
      'SERIAL_OWNERSHIP_CONFLICT',
    );
  }

  validatePath(devicePath);
  const rate = validateBaudRate(baudRate);

  serialOwnership.acquire(serialOwnership.SERIAL_OWNER.DIAGNOSTICS, {
    portPath: devicePath,
    reason: 'diagnostics_monitor_start',
    onTimeout: () => {
      logSerial('diagnostics serial ownership timed out — stopping monitor', 'warn');
      stopSerialMonitor().catch(() => {});
    },
  });

  return new Promise((resolve, reject) => {
    let port = null;

    const failStart = async (err, statusCode = 500, code = 'MONITOR_OPEN_FAILED') => {
      await detachAndDestroyPort(port);
      port = null;
      resetMonitorState();
      serialOwnership.release(serialOwnership.SERIAL_OWNER.DIAGNOSTICS, {
        force: true,
        reason: 'monitor_open_failed',
      });
      logSerial(`serial open failed: ${err?.message || String(err)}`, 'error');
      reject(createSerialError(err?.message || String(err), statusCode, code));
    };

    try {
      port = new SerialPort({
        path: devicePath,
        baudRate: rate,
        autoOpen: false,
      });
      attachPortErrorListener(port, 'monitor');

      port.on('data', (data) => {
        monitorState.rxBytes += data.length;
        monitorState.lastActivityAt = new Date().toISOString();
      });
    } catch (err) {
      failStart(err);
      return;
    }

    try {
      port.open((openErr) => {
        if (openErr) {
          failStart(openErr);
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
        registerProcessCleanup();
        resolve(getMonitorStatus());
      });
    } catch (err) {
      failStart(err);
    }
  });
}

async function stopSerialMonitor() {
  if (!monitorState.running && !monitorState.port) {
    return {
      ...getMonitorStatus(),
      running: false,
      message: 'Serial monitor is not running',
    };
  }

  try {
    return await stopMonitorInternal();
  } catch (err) {
    logSerial(`serial monitor fault: ${err.message}`, 'error');
    resetMonitorState();
    return {
      ...getMonitorStatus(),
      running: false,
      message: 'Serial monitor stopped after fault',
      error: err.message,
    };
  }
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
  validatePath,
  validateBaudRate,
};
