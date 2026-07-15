const fieldExecutionEngine = require('./fieldExecutionEngine');
const mstpBusCoordinator = require('./mstpBusCoordinator');
const managedDevices = require('../devices/managedDevices');
const pointCache = require('./pointCache');
const logsService = require('../logs');
const { BACNET_PROPERTIES, DEVICE_OBJECT_TYPE } = require('../bacnet/bacnetApduCodec');

const DEFAULT_HEARTBEAT_INTERVAL_MS = 30000;
const HEARTBEAT_PROPERTY_PRIMARY = BACNET_PROPERTIES.systemStatus;
const HEARTBEAT_PROPERTY_FALLBACK = BACNET_PROPERTIES.objectName;

const DEVICE_QUALITY = Object.freeze({
  ONLINE: 'online',
  DEGRADED: 'degraded',
  STALE: 'degraded',
  OFFLINE: 'offline',
  UNKNOWN: 'unknown',
  DISABLED: 'disabled',
});

let heartbeatTimer = null;
let running = false;
let pausedForDiscovery = false;
let userPaused = false;
const nextHeartbeatAt = new Map();
let lastStatus = {};

function log(level, message) {
  logsService.addLog({ level, service: 'bacnet', message });
}

function qualityFromFailureCount(count) {
  if (count >= 3) return DEVICE_QUALITY.OFFLINE;
  if (count === 2) return DEVICE_QUALITY.STALE;
  if (count === 1) return DEVICE_QUALITY.DEGRADED;
  return DEVICE_QUALITY.ONLINE;
}

function getEnabledDevices() {
  return (managedDevices.getManagedDevices().devices || []).filter((d) => d.enabled);
}

function isDeviceDue(deviceId) {
  const dueAt = nextHeartbeatAt.get(deviceId);
  if (!dueAt) return true;
  return Date.now() >= dueAt;
}

function scheduleNextHeartbeat(deviceId, intervalMs = DEFAULT_HEARTBEAT_INTERVAL_MS, withJitter = false) {
  const jitter = withJitter ? Math.floor(Math.random() * Math.min(intervalMs * 0.25, 5000)) : 0;
  const stagger = (hashString(deviceId) % Math.min(intervalMs, 10000));
  nextHeartbeatAt.set(deviceId, Date.now() + intervalMs + jitter + stagger);
}

function hashString(value) {
  const str = String(value || '');
  let hash = 0;
  for (let i = 0; i < str.length; i += 1) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function recordHeartbeatSuccess(managedDeviceId, meta = {}) {
  const result = managedDevices.recordHeartbeatResult(managedDeviceId, {
    success: true,
    responseTimeMs: meta.responseTimeMs,
  });
  if (result?.device) {
    pointCache.refreshQualitiesForDevice(managedDeviceId, result.device.deviceQuality);
  }
  scheduleNextHeartbeat(managedDeviceId, DEFAULT_HEARTBEAT_INTERVAL_MS, true);
  return result;
}

function recordHeartbeatFailure(managedDeviceId, errorMessage) {
  if (mstpBusCoordinator.isDiscoveryActive()) {
    return { skipped: true, reason: 'paused_discovery' };
  }

  const result = managedDevices.recordHeartbeatResult(managedDeviceId, {
    success: false,
    error: errorMessage,
  });
  if (result?.device) {
    pointCache.refreshQualitiesForDevice(managedDeviceId, result.device.deviceQuality);
  }
  scheduleNextHeartbeat(managedDeviceId, DEFAULT_HEARTBEAT_INTERVAL_MS, true);
  return result;
}

function hasPendingHeartbeatJob(managedDeviceId) {
  return fieldExecutionEngine.hasPendingJobForDevice(managedDeviceId, 'device-health');
}

function tick() {
  if (!running || pausedForDiscovery || userPaused) return;
  if (!mstpBusCoordinator.canCreatePollingJobs()) return;

  const devices = getEnabledDevices();
  let submitted = 0;
  let skippedPending = 0;
  let skippedNotDue = 0;

  for (const device of devices) {
    if (!isDeviceDue(device.id)) {
      skippedNotDue += 1;
      continue;
    }

    if (hasPendingHeartbeatJob(device.id)) {
      skippedPending += 1;
      continue;
    }

    if (fieldExecutionEngine.isQueueFull()) break;

    try {
      fieldExecutionEngine.submitReadProperty({
        source: 'device-health',
        managedDeviceId: device.id,
        objectType: DEVICE_OBJECT_TYPE,
        objectInstance: device.deviceInstance,
        propertyIdentifier: HEARTBEAT_PROPERTY_PRIMARY,
        fallbackPropertyIdentifier: HEARTBEAT_PROPERTY_FALLBACK,
        maxRetries: 1,
        timeoutMs: 30000,
      });
      submitted += 1;
      scheduleNextHeartbeat(device.id);
    } catch (err) {
      if (err.code !== 'BUS_PAUSED_DISCOVERY') {
        throw err;
      }
    }
  }

  lastStatus = {
    submitted,
    skippedPending,
    skippedNotDue,
    enabledDevices: devices.length,
  };
}

function start() {
  if (heartbeatTimer) return;
  running = true;
  heartbeatTimer = setInterval(tick, 5000);
}

function stop() {
  running = false;
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

function pauseForDiscovery() {
  pausedForDiscovery = true;
}

function resumeFromDiscovery() {
  pausedForDiscovery = false;
}

function pause() {
  userPaused = true;
}

function resume() {
  userPaused = false;
}

function getStatus() {
  const devices = getEnabledDevices();
  const qualityCounts = { online: 0, degraded: 0, offline: 0, unknown: 0, disabled: 0 };

  for (const device of devices) {
    const q = device.deviceQuality || DEVICE_QUALITY.UNKNOWN;
    if (qualityCounts[q] != null) qualityCounts[q] += 1;
    else qualityCounts.unknown += 1;
  }

  const discoveryPaused = pausedForDiscovery || mstpBusCoordinator.isDiscoveryActive();
  let mode = 'running';
  if (!running) mode = 'disabled';
  else if (discoveryPaused) mode = 'paused_discovery';
  else if (userPaused) mode = 'paused';

  return {
    running,
    paused: discoveryPaused || userPaused,
    pauseReason: discoveryPaused ? 'discovery' : userPaused ? 'user' : null,
    mode,
    heartbeatIntervalMs: DEFAULT_HEARTBEAT_INTERVAL_MS,
    enabledDevices: devices.length,
    deviceQualityCounts: qualityCounts,
    lastTick: lastStatus,
  };
}

module.exports = {
  DEVICE_QUALITY,
  DEFAULT_HEARTBEAT_INTERVAL_MS,
  start,
  stop,
  tick,
  pauseForDiscovery,
  resumeFromDiscovery,
  pause,
  resume,
  getStatus,
  recordHeartbeatSuccess,
  recordHeartbeatFailure,
};
