const pointsStore = require('../devices/managedPointsStore');
const {
  getPollIntervalMs,
  computeStaleAfterMs,
  POINT_OFFLINE_FAILURE_THRESHOLD,
  POLL_GROUPS,
} = require('./pollConfig');

const DEVICE_QUALITY_OFFLINE = new Set(['offline']);
const DEVICE_QUALITY_STALE = new Set(['stale']);

const POINT_QUALITY = Object.freeze({
  ONLINE: 'online',
  STALE: 'stale',
  OFFLINE: 'offline',
  OFFLINE_BY_DEVICE: 'offline_by_device',
  STALE_BY_DEVICE: 'stale_by_device',
  UNKNOWN: 'unknown',
  ERROR: 'error',
});

function createCacheFields(pollDefaults = {}) {
  const now = new Date().toISOString();
  return {
    presentValue: pollDefaults.presentValue ?? null,
    previousValue: null,
    lastReadAt: pollDefaults.lastReadAt ?? null,
    lastSuccessfulReadAt: pollDefaults.lastSuccessfulReadAt ?? null,
    lastPollAt: null,
    nextPollAt: pollDefaults.nextPollAt ?? null,
    quality: POINT_QUALITY.UNKNOWN,
    failureCount: 0,
    lastError: null,
    valueChangedAt: null,
    pollGroup: pollDefaults.pollGroup ?? POLL_GROUPS.normal,
    pollingEnabled: pollDefaults.pollingEnabled !== false,
    pollIntervalMs: pollDefaults.pollIntervalMs ?? getPollIntervalMs(POLL_GROUPS.normal),
    staleAfterMs: pollDefaults.staleAfterMs ?? computeStaleAfterMs(getPollIntervalMs(POLL_GROUPS.normal)),
  };
}

function valuesEqual(a, b) {
  if (a === b) return true;
  if (a == null && b == null) return true;
  return JSON.stringify(a) === JSON.stringify(b);
}

function derivePointQuality(point, deviceQuality) {
  if (DEVICE_QUALITY_OFFLINE.has(deviceQuality)) {
    return POINT_QUALITY.OFFLINE_BY_DEVICE;
  }
  if (DEVICE_QUALITY_STALE.has(deviceQuality)) {
    return POINT_QUALITY.STALE_BY_DEVICE;
  }

  if ((point.failureCount || 0) >= POINT_OFFLINE_FAILURE_THRESHOLD) {
    return POINT_QUALITY.OFFLINE;
  }

  const staleAfterMs = point.staleAfterMs;
  const lastOk = point.lastSuccessfulReadAt;
  if (staleAfterMs && lastOk) {
    const age = Date.now() - new Date(lastOk).getTime();
    if (age > staleAfterMs) return POINT_QUALITY.STALE;
  } else if (!lastOk && point.lastReadAt) {
    return POINT_QUALITY.STALE;
  }

  if (point.lastSuccessfulReadAt) return POINT_QUALITY.ONLINE;
  return point.quality || POINT_QUALITY.UNKNOWN;
}

function applyReadSuccess(pointId, value, options = {}) {
  const points = pointsStore.loadPoints();
  const index = points.findIndex((p) => p.id === pointId);
  if (index < 0) return null;

  const point = points[index];
  const now = new Date().toISOString();
  const pollIntervalMs = getPollIntervalMs(point.pollGroup, point.pollIntervalMs);
  const valueChanged = !valuesEqual(point.presentValue, value);

  const next = {
    ...point,
    previousValue: valueChanged ? point.presentValue : point.previousValue,
    presentValue: value ?? point.presentValue,
    lastReadAt: now,
    lastSuccessfulReadAt: now,
    lastPollAt: options.lastPollAt || point.lastPollAt || now,
    nextPollAt: options.scheduleNext !== false
      ? new Date(Date.now() + pollIntervalMs).toISOString()
      : point.nextPollAt,
    failureCount: 0,
    lastError: null,
    valueChangedAt: valueChanged ? now : point.valueChangedAt,
  };

  next.quality = derivePointQuality(next, options.deviceQuality);
  points[index] = next;
  pointsStore.savePoints(points);
  return next;
}

function applyReadFailure(pointId, errorMessage, options = {}) {
  const points = pointsStore.loadPoints();
  const index = points.findIndex((p) => p.id === pointId);
  if (index < 0) return null;

  const point = points[index];
  const now = new Date().toISOString();
  const pollIntervalMs = getPollIntervalMs(point.pollGroup, point.pollIntervalMs);
  const failureCount = (point.failureCount || 0) + 1;

  const next = {
    ...point,
    lastReadAt: now,
    lastPollAt: options.lastPollAt || point.lastPollAt || now,
    nextPollAt: new Date(Date.now() + pollIntervalMs).toISOString(),
    failureCount,
    lastError: errorMessage || 'Read failed',
  };

  next.quality = derivePointQuality(next, options.deviceQuality);
  points[index] = next;
  pointsStore.savePoints(points);
  return next;
}

function refreshQualitiesForDevice(managedDeviceId, deviceQuality) {
  const points = pointsStore.loadPoints();
  let changed = false;

  const updated = points.map((point) => {
    if (point.managedDeviceId !== managedDeviceId) return point;
    const quality = derivePointQuality(point, deviceQuality);
    if (quality === point.quality) return point;
    changed = true;
    return { ...point, quality };
  });

  if (changed) pointsStore.savePoints(updated);
  return changed;
}

function updatePollConfig(pointId, patch) {
  const points = pointsStore.loadPoints();
  const index = points.findIndex((p) => p.id === pointId);
  if (index < 0) return null;

  const point = points[index];
  const pollGroup = patch.pollGroup ?? point.pollGroup;
  const pollingEnabled = patch.pollingEnabled !== undefined
    ? Boolean(patch.pollingEnabled)
    : point.pollingEnabled;
  const pollIntervalMs = getPollIntervalMs(pollGroup, patch.pollIntervalMs ?? point.pollIntervalMs);
  const staleAfterMs = computeStaleAfterMs(pollIntervalMs);

  const next = {
    ...point,
    pollGroup,
    pollingEnabled,
    pollIntervalMs,
    staleAfterMs,
    nextPollAt: pollingEnabled
      ? (patch.nextPollAt || new Date().toISOString())
      : null,
  };

  points[index] = next;
  pointsStore.savePoints(points);
  return next;
}

function countByQuality(points) {
  const counts = {
    online: 0,
    stale: 0,
    offline: 0,
    offline_by_device: 0,
    stale_by_device: 0,
    unknown: 0,
    error: 0,
  };

  for (const point of points) {
    const q = point.quality || 'unknown';
    if (counts[q] != null) counts[q] += 1;
    else counts.unknown += 1;
  }

  return counts;
}

function summarizeDevicePoints(managedDeviceId) {
  const points = pointsStore.loadPoints().filter((p) => p.managedDeviceId === managedDeviceId);
  const quality = countByQuality(points);
  return {
    managedPointCount: points.length,
    onlinePoints: quality.online,
    stalePoints: quality.stale + quality.stale_by_device,
    offlinePoints: quality.offline + quality.offline_by_device,
    quality,
  };
}

module.exports = {
  POINT_QUALITY,
  createCacheFields,
  derivePointQuality,
  applyReadSuccess,
  applyReadFailure,
  refreshQualitiesForDevice,
  updatePollConfig,
  countByQuality,
  summarizeDevicePoints,
};
