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
  STALE: 'stale',
  OFFLINE: 'offline',
  UNKNOWN: 'unknown',
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

function scheduleNextHeartbeat(deviceId, intervalMs = DEFAULT_HEARTBEAT_INTERVAL_MS) {
  nextHeartbeatAt.set(deviceId, Date.now() + intervalMs);
}

function recordHeartbeatSuccess(managedDeviceId) {
  const result = managedDevices.recordHeartbeatResult(managedDeviceId, { success: true });
  if (result?.device) {
    pointCache.refreshQualitiesForDevice(managedDeviceId, result.device.deviceQuality);
  }
  scheduleNextHeartbeat(managedDeviceId);
  return result;
}

function recordHeartbeatFailure(managedDeviceId, errorMessage) {
  const result = managedDevices.recordHeartbeatResult(managedDeviceId, {
    success: false,
    error: errorMessage,
  });
  if (result?.device) {
    pointCache.refreshQualitiesForDevice(managedDeviceId, result.device.deviceQuality);
  }
  scheduleNextHeartbeat(managedDeviceId);
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
  const qualityCounts = { online: 0, degraded: 0, stale: 0, offline: 0, unknown: 0 };

  for (const device of devices) {
    const q = device.deviceQuality || DEVICE_QUALITY.UNKNOWN;
    if (qualityCounts[q] != null) qualityCounts[q] += 1;
    else qualityCounts.unknown += 1;
  }

  let mode = 'running';
  if (!running) mode = 'disabled';
  else if (pausedForDiscovery || userPaused) mode = 'paused';

  return {
    running,
    paused: pausedForDiscovery || userPaused,
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
