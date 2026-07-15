const fieldExecutionEngine = require('./fieldExecutionEngine');
const mstpBusCoordinator = require('./mstpBusCoordinator');
const managedDevices = require('../devices/managedDevices');
const pointsStore = require('../devices/managedPointsStore');
const pointCache = require('./pointCache');
const logsService = require('../logs');
const { getPollIntervalMs, POLL_GROUPS } = require('./pollConfig');
const { BACNET_PROPERTIES } = require('../bacnet/bacnetApduCodec');

const SCHEDULER_INTERVAL_MS = 1000;
const MAX_POLLING_QUEUE_SIZE = 50;
const QUEUE_WARN_THRESHOLD = 50;
const MAX_DUE_POINTS_PER_TICK = 10;

let schedulerTimer = null;
let running = false;
let pausedForDiscovery = false;
let userPaused = false;
let lastQueueLimitLogAt = 0;
let lastStatus = {};

function log(level, message) {
  logsService.addLog({ level, service: 'bacnet', message });
}

function getDeviceMap() {
  const managed = managedDevices.getManagedDevices();
  return new Map((managed.devices || []).map((device) => [device.id, device]));
}

function isDevicePollable(device) {
  if (!device?.enabled) return false;
  const quality = device.deviceQuality;
  if (quality === 'offline' || quality === 'disabled') return false;
  return true;
}

function isPointDue(point) {
  if (!point.pollingEnabled || point.pollGroup === POLL_GROUPS.manual) return false;
  if (!point.nextPollAt) return true;
  return Date.now() >= new Date(point.nextPollAt).getTime();
}

function getDuePoints() {
  const deviceMap = getDeviceMap();
  return pointsStore.loadPoints()
    .filter((point) => {
      const device = deviceMap.get(point.managedDeviceId);
      if (!device || !isDevicePollable(device)) return false;
      if (!point.pollingEnabled || point.pollGroup === POLL_GROUPS.manual) return false;
      return isPointDue(point);
    })
    .sort((a, b) => {
      const aDue = a.nextPollAt ? new Date(a.nextPollAt).getTime() : 0;
      const bDue = b.nextPollAt ? new Date(b.nextPollAt).getTime() : 0;
      return aDue - bDue;
    });
}

function countPollablePoints() {
  const deviceMap = getDeviceMap();
  return pointsStore.loadPoints().filter((point) => {
    const device = deviceMap.get(point.managedDeviceId);
    return device && isDevicePollable(device) && point.pollingEnabled && point.pollGroup !== POLL_GROUPS.manual;
  }).length;
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

function isPaused() {
  return pausedForDiscovery || userPaused || !running;
}

function tick() {
  if (!running || pausedForDiscovery || userPaused) return;
  if (!mstpBusCoordinator.canCreatePollingJobs()) return;

  const pollingQueued = fieldExecutionEngine.countPollingPendingJobs();
  if (pollingQueued >= MAX_POLLING_QUEUE_SIZE || fieldExecutionEngine.isQueueFull()) {
    const now = Date.now();
    if (now - lastQueueLimitLogAt >= 30000) {
      log('warn', 'Point polling skipped — execution queue at limit');
      lastQueueLimitLogAt = now;
    }
    lastStatus = {
      ...lastStatus,
      backpressure: true,
      lastSkipReason: 'execution queue at limit',
      pollingQueued,
    };
    return;
  }

  const deviceMap = getDeviceMap();
  const duePoints = getDuePoints();
  let submitted = 0;
  let skippedDup = 0;

  for (const point of duePoints) {
    if (submitted >= MAX_DUE_POINTS_PER_TICK) break;
    if (fieldExecutionEngine.countPollingPendingJobs() >= MAX_POLLING_QUEUE_SIZE) break;
    if (fieldExecutionEngine.isQueueFull()) break;

    if (fieldExecutionEngine.hasPendingJobForPoint(point.id)) {
      skippedDup += 1;
      continue;
    }

    const device = deviceMap.get(point.managedDeviceId);
    const nowIso = new Date().toISOString();
    const intervalMs = getPollIntervalMs(point.pollGroup);
    // Advance nextPollAt on enqueue so missed intervals are not replayed in a burst.
    const nextPollAt = new Date(Date.now() + intervalMs).toISOString();
    const points = pointsStore.loadPoints();
    const idx = points.findIndex((p) => p.id === point.id);
    if (idx >= 0) {
      points[idx] = { ...points[idx], lastPollAt: nowIso, nextPollAt };
      pointsStore.savePoints(points);
    }

    try {
      fieldExecutionEngine.submitReadProperty({
        source: 'polling',
        managedDeviceId: point.managedDeviceId,
        managedPointId: point.id,
        objectType: point.objectType,
        objectInstance: point.objectInstance,
        propertyIdentifier: BACNET_PROPERTIES.presentValue,
        maxRetries: 1,
        timeoutMs: 30000,
      });
      submitted += 1;
    } catch (err) {
      if (err.code === 'BUS_PAUSED_DISCOVERY' || err.code === 'QUEUE_FULL' || err.code === 'RUNTIME_NOT_READY') {
        break;
      }
      throw err;
    }
  }

  lastStatus = {
    submitted,
    skippedDup,
    duePoints: duePoints.length,
    pollingQueued: fieldExecutionEngine.countPollingPendingJobs(),
    backpressure: false,
    pollablePoints: countPollablePoints(),
  };
}

function start() {
  if (schedulerTimer) return;
  running = true;
  schedulerTimer = setInterval(tick, SCHEDULER_INTERVAL_MS);
}

function stop() {
  running = false;
  if (schedulerTimer) {
    clearInterval(schedulerTimer);
    schedulerTimer = null;
  }
}

function getStatus() {
  const deviceMap = getDeviceMap();
  const allPoints = pointsStore.loadPoints();
  const qualityCounts = {
    online: 0, stale: 0, offline: 0, offline_by_device: 0,
    stale_by_device: 0, unknown: 0, error: 0,
  };

  for (const point of allPoints) {
    const device = deviceMap.get(point.managedDeviceId);
    const q = pointCache.derivePointQuality(point, device?.deviceQuality);
    if (qualityCounts[q] != null) qualityCounts[q] += 1;
    else qualityCounts.unknown += 1;
  }

  let mode = 'running';
  if (!running) mode = 'disabled';
  else if (pausedForDiscovery || mstpBusCoordinator.isDiscoveryActive()) mode = 'paused_discovery';
  else if (userPaused) mode = 'paused';
  else if (lastStatus.backpressure || fieldExecutionEngine.countPollingPendingJobs() >= QUEUE_WARN_THRESHOLD) {
    mode = 'backpressure';
  }

  const discoveryPaused = pausedForDiscovery || mstpBusCoordinator.isDiscoveryActive();

  return {
    running,
    paused: discoveryPaused || userPaused,
    pauseReason: discoveryPaused ? 'discovery' : userPaused ? 'user' : null,
    mode,
    schedulerIntervalMs: SCHEDULER_INTERVAL_MS,
    pollablePoints: countPollablePoints(),
    duePoints: getDuePoints().length,
    pollingQueuedJobs: fieldExecutionEngine.countPollingPendingJobs(),
    maxPollingQueueSize: MAX_POLLING_QUEUE_SIZE,
    queueWarnThreshold: QUEUE_WARN_THRESHOLD,
    pointQualityCounts: qualityCounts,
    lastTick: lastStatus,
  };
}

module.exports = {
  start,
  stop,
  getStatus,
  tick,
  pauseForDiscovery,
  resumeFromDiscovery,
  pause,
  resume,
  isPaused,
  isDevicePollable,
  MAX_POLLING_QUEUE_SIZE,
  getPollIntervalMs,
};
