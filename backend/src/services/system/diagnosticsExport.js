/**
 * Sanitized diagnostic export for field troubleshooting.
 * Never includes passwords, hashes, Wi-Fi/MQTT credentials, tokens, or keys.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');
const { resolveDataDir, DATA_FILES, dataFilePath } = require('../../lib/dataPaths');
const { loadSettings } = require('../../lib/settingsStore');
const bacnetMstpService = require('../bacnet/bacnetMstp.service');
const serialOwnership = require('../interfaces/serialOwnership');
const fieldExecutionEngine = require('../execution/fieldExecutionEngine');
const managedDevices = require('../devices/managedDevices');
const pointsStore = require('../devices/managedPointsStore');
const pointCache = require('../execution/pointCache');
const pointPollingEngine = require('../execution/pointPollingEngine');
const deviceHealthPoller = require('../execution/deviceHealthPoller');
const logsService = require('../logs');
const { getCovCapability } = require('../bacnet/covSubscriptions');
const { WRITE_CAPABILITY } = require('../bacnet/writeProperty');

const SENSITIVE_KEY = /pass(word)?|secret|token|cookie|credential|private.?key|api.?key|mqtt.*(user|pass)|wifi.*(psk|pass)|hash|session/i;

function getAppVersion() {
  try {
    // eslint-disable-next-line global-require
    return require('../../../../package.json').version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

function getCommitHash() {
  try {
    return execSync('git rev-parse --short HEAD', {
      encoding: 'utf8',
      timeout: 2000,
      cwd: path.join(__dirname, '../../../..'),
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return process.env.LEGION_SENTRY_COMMIT || null;
  }
}

function redactValue(key, value) {
  if (SENSITIVE_KEY.test(String(key))) return '[REDACTED]';
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return redactObject(value);
  }
  if (Array.isArray(value)) {
    return value.map((item, idx) => (typeof item === 'object' ? redactObject(item) : item));
  }
  return value;
}

function redactObject(input) {
  if (!input || typeof input !== 'object') return input;
  if (Array.isArray(input)) return input.map((item) => redactObject(item));
  const out = {};
  for (const [key, value] of Object.entries(input)) {
    out[key] = redactValue(key, value);
  }
  return out;
}

function fileSizeInfo(filePath) {
  try {
    if (!fs.existsSync(filePath)) return { exists: false, sizeBytes: 0 };
    const stat = fs.statSync(filePath);
    return { exists: true, sizeBytes: stat.size, mtime: stat.mtime.toISOString() };
  } catch (err) {
    return { exists: false, sizeBytes: 0, error: err.message };
  }
}

function summarizeDevices() {
  const managed = managedDevices.getManagedDevices();
  const devices = managed.devices || [];
  const counts = { total: devices.length, online: 0, degraded: 0, offline: 0, unknown: 0 };
  for (const d of devices) {
    const q = d.deviceQuality || 'unknown';
    if (counts[q] != null) counts[q] += 1;
    else counts.unknown += 1;
  }
  return counts;
}

function summarizePoints() {
  const points = pointsStore.loadPoints();
  const deviceMap = new Map((managedDevices.getManagedDevices().devices || []).map((d) => [d.id, d]));
  const counts = {
    total: points.length,
    good: 0,
    stale: 0,
    faulted: 0,
    offline: 0,
    other: 0,
  };
  for (const point of points) {
    const device = deviceMap.get(point.managedDeviceId);
    const q = pointCache.derivePointQuality(point, device?.deviceQuality);
    if (q === 'online') counts.good += 1;
    else if (q === 'stale' || q === 'stale_by_device') counts.stale += 1;
    else if (q === 'offline' || q === 'offline_by_device') counts.offline += 1;
    else if (q === 'fault' || q === 'error') counts.faulted += 1;
    else counts.other += 1;
  }
  return counts;
}

function buildDiagnosticsExport() {
  const dataDir = resolveDataDir();
  const runtime = bacnetMstpService.getRuntimeSnapshot();
  const mem = process.memoryUsage();

  const dataFiles = {};
  for (const name of DATA_FILES) {
    dataFiles[name] = fileSizeInfo(dataFilePath(name, dataDir));
  }

  const settings = loadSettings();
  const recentLogs = (logsService.getLogs('all') || []).slice(0, 100).map((entry) => ({
    id: entry.id,
    timestamp: entry.timestamp,
    level: entry.level,
    service: entry.service,
    message: entry.message,
  }));

  return {
    exportedAt: new Date().toISOString(),
    application: {
      name: 'legion-sentry',
      version: getAppVersion(),
      commit: getCommitHash(),
      phase: '2.5',
    },
    runtime,
    tokenEngine: runtime.tokenEngine || null,
    serialOwnership: serialOwnership.getOwner(),
    queue: fieldExecutionEngine.getQueueSummary(),
    deviceHealth: summarizeDevices(),
    pointQuality: summarizePoints(),
    polling: pointPollingEngine.getStatus(),
    healthPoller: deviceHealthPoller.getStatus(),
    limitations: {
      cov: getCovCapability(),
      writeProperty: WRITE_CAPABILITY,
      routing: 'not_implemented',
    },
    recentLogs,
    dataDirectory: {
      path: dataDir,
      files: dataFiles,
    },
    system: {
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      osRelease: os.release(),
      hostname: os.hostname(),
      uptimeSec: Math.floor(process.uptime()),
      memory: {
        rss: mem.rss,
        heapUsed: mem.heapUsed,
        heapTotal: mem.heapTotal,
        external: mem.external,
      },
      cpus: os.cpus()?.length || null,
      loadavg: typeof os.loadavg === 'function' ? os.loadavg() : null,
    },
    configuration: redactObject({
      settings: {
        bacnet: settings.bacnet || null,
        network: settings.network ? { ...settings.network, wifi: settings.network.wifi ? '[REDACTED_OBJECT]' : undefined } : null,
        mqtt: settings.mqtt ? { enabled: settings.mqtt.enabled, host: settings.mqtt.host, port: settings.mqtt.port } : null,
      },
    }),
  };
}

module.exports = {
  buildDiagnosticsExport,
  redactObject,
  getAppVersion,
  getCommitHash,
};
