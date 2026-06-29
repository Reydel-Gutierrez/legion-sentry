const fieldExecutionEngine = require('./fieldExecutionEngine');
const mstpBusCoordinator = require('./mstpBusCoordinator');
const managedDevices = require('../devices/managedDevices');
const pointsStore = require('../devices/managedPointsStore');
const logsService = require('../logs');
const { BACNET_PROPERTIES } = require('../bacnet/bacnetApduCodec');

const DEFAULT_POLL_INTERVAL_MS = 5000;
const MAX_POLLING_QUEUE_SIZE = 50;
const QUEUE_WARN_THRESHOLD = 50;

const POLLABLE_MSTP_STATUSES = new Set(['seen_latest_scan', 'recently_seen']);

const BACKOFF_MS = {
  first: 30 * 1000,
  repeated: 2 * 60 * 1000,
  many: 5 * 60 * 1000,
};
const MANY_FAILURES_THRESHOLD = 5;

let pollTimer = null;
let running = false;
let pausedForDiscovery = false;
let lastQueueLimitLogAt = 0;
let lastStaleLogAt = 0;
const lastDupLogAt = new Map();
let lastStatus = {};

const pollBackoff = new Map();

function log(level, message) {
  logsService.addLog({ level, service: 'bacnet', message });
}

function getPollIntervalMs() {
  return DEFAULT_POLL_INTERVAL_MS;
}

function getDeviceMap() {
  const managed = managedDevices.getManagedDevices();
  return new Map((managed.devices || []).map((device) => [device.id, device]));
}

function isDevicePollable(device) {
  if (!device?.enabled) return false;
  return POLLABLE_MSTP_STATUSES.has(device.mstpStatus);
}

function getPollablePoints() {
  const deviceMap = getDeviceMap();
  return pointsStore.loadPoints().filter((point) => {
    const device = deviceMap.get(point.managedDeviceId);
    return device && isDevicePollable(device);
  });
}

function recordPollFailure(pointId) {
  const entry = pollBackoff.get(pointId) || { failures: 0, nextRetryAt: 0 };
  entry.failures += 1;
  let delayMs = BACKOFF_MS.first;
  if (entry.failures >= MANY_FAILURES_THRESHOLD) {
    delayMs = BACKOFF_MS.many;
  } else if (entry.failures > 1) {
    delayMs = BACKOFF_MS.repeated;
  }
  entry.nextRetryAt = Date.now() + delayMs;
  pollBackoff.set(pointId, entry);
}

function recordPollSuccess(pointId) {
  pollBackoff.delete(pointId);
}

function isPointInBackoff(pointId) {
  const entry = pollBackoff.get(pointId);
  if (!entry) return false;
  if (Date.now() >= entry.nextRetryAt) return false;
  return true;
}

function countPollingQueuedJobs() {
  return fieldExecutionEngine.countPollingPendingJobs();
}

function pauseForDiscovery() {
  pausedForDiscovery = true;
}

function resumeFromDiscovery() {
  pausedForDiscovery = false;
}

function isPaused() {
  return pausedForDiscovery || !running;
}

function tick() {
  if (!running || pausedForDiscovery) return;
  if (!mstpBusCoordinator.canCreatePollingJobs()) return;

  const pollingQueued = countPollingQueuedJobs();
  if (pollingQueued >= MAX_POLLING_QUEUE_SIZE) {
    const now = Date.now();
    if (now - lastQueueLimitLogAt >= getPollIntervalMs()) {
      log('warn', 'Polling skipped because execution queue above limit');
      lastQueueLimitLogAt = now;
    }
    lastStatus = {
      ...lastStatus,
      backpressure: true,
      lastSkipReason: 'execution queue above limit',
    };
    return;
  }

  const deviceMap = getDeviceMap();
  const points = pointsStore.loadPoints();
  let skippedStale = 0;
  let skippedDup = 0;
  let skippedBackoff = 0;
  let submitted = 0;

  for (const point of points) {
    const device = deviceMap.get(point.managedDeviceId);
    if (!device?.enabled) continue;

    if (!isDevicePollable(device)) {
      if (!POLLABLE_MSTP_STATUSES.has(device.mstpStatus)) {
        skippedStale += 1;
      }
      continue;
    }

    if (fieldExecutionEngine.hasPendingJobForPoint(point.id)) {
      skippedDup += 1;
      const lastLogged = lastDupLogAt.get(point.id) || 0;
      if (Date.now() - lastLogged >= getPollIntervalMs()) {
        log('info', `Polling skipped for point ${point.id} because job already queued`);
        lastDupLogAt.set(point.id, Date.now());
      }
      continue;
    }

    if (isPointInBackoff(point.id)) {
      skippedBackoff += 1;
      continue;
    }

    if (countPollingQueuedJobs() >= MAX_POLLING_QUEUE_SIZE) {
      break;
    }

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
  }

  if (skippedStale > 0) {
    const now = Date.now();
    if (now - lastStaleLogAt >= getPollIntervalMs()) {
      const staleDevices = [...deviceMap.values()].filter(
        (d) => d.enabled && !POLLABLE_MSTP_STATUSES.has(d.mstpStatus),
      );
      for (const device of staleDevices) {
        log('info', `Polling paused for device MAC ${device.mstpMacAddress} because device is stale`);
      }
      lastStaleLogAt = now;
    }
  }

  lastStatus = {
    submitted,
    skippedStale,
    skippedDup,
    skippedBackoff,
    pollingQueued: countPollingQueuedJobs(),
    backpressure: false,
    pollablePoints: getPollablePoints().length,
  };
}

function start() {
  if (pollTimer) return;
  running = true;
  pollTimer = setInterval(() => {
    tick();
  }, getPollIntervalMs());
}

function stop() {
  running = false;
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

function getStatus() {
  const deviceMap = getDeviceMap();
  const staleDevices = [...deviceMap.values()]
    .filter((d) => d.enabled && !POLLABLE_MSTP_STATUSES.has(d.mstpStatus))
    .map((d) => ({
      managedDeviceId: d.id,
      mstpMacAddress: d.mstpMacAddress,
      mstpStatus: d.mstpStatus,
      reason: 'Device not recently seen',
    }));

  let mode = 'running';
  if (!running) mode = 'disabled';
  else if (pausedForDiscovery) mode = 'paused';
  else if (mstpBusCoordinator.isDiscoveryActive()) mode = 'paused';
  else if (lastStatus.backpressure || countPollingQueuedJobs() >= QUEUE_WARN_THRESHOLD) mode = 'backpressure';

  return {
    running,
    paused: pausedForDiscovery || mstpBusCoordinator.isDiscoveryActive(),
    pauseReason: pausedForDiscovery ? 'discovery' : null,
    mode,
    pollIntervalMs: getPollIntervalMs(),
    pollablePoints: getPollablePoints().length,
    pollingQueuedJobs: countPollingQueuedJobs(),
    maxPollingQueueSize: MAX_POLLING_QUEUE_SIZE,
    queueWarnThreshold: QUEUE_WARN_THRESHOLD,
    staleDevices,
    lastTick: lastStatus,
    backoffPoints: pollBackoff.size,
  };
}

module.exports = {
  start,
  stop,
  getStatus,
  tick,
  pauseForDiscovery,
  resumeFromDiscovery,
  isPaused,
  recordPollFailure,
  recordPollSuccess,
  isDevicePollable,
  MAX_POLLING_QUEUE_SIZE,
};
