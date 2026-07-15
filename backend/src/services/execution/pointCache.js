const pointsStore = require('../devices/managedPointsStore');
const {
  getPollIntervalMs,
  computeStaleAfterMs,
  POINT_OFFLINE_FAILURE_THRESHOLD,
  POLL_GROUPS,
} = require('./pollConfig');
const {
  POINT_QUALITY,
  derivePointQuality,
  buildPointValueView,
  normalizeStoredQuality,
} = require('./pointQuality');

function createCacheFields(pollDefaults = {}) {
  const now = new Date().toISOString();
  return {
    presentValue: pollDefaults.presentValue ?? null,
    lastKnownValue: pollDefaults.lastKnownValue ?? pollDefaults.presentValue ?? null,
    previousValue: null,
    normalizedValue: pollDefaults.normalizedValue ?? null,
    rawValue: pollDefaults.rawValue ?? null,
    dataType: pollDefaults.dataType ?? null,
    units: pollDefaults.units ?? null,
    statusFlags: pollDefaults.statusFlags ?? null,
    reliability: pollDefaults.reliability ?? null,
    lastReadAt: pollDefaults.lastReadAt ?? null,
    lastAttemptAt: pollDefaults.lastAttemptAt ?? null,
    lastSuccessfulReadAt: pollDefaults.lastSuccessfulReadAt ?? null,
    lastFailureAt: null,
    lastPollAt: null,
    nextPollAt: pollDefaults.nextPollAt ?? null,
    quality: POINT_QUALITY.UNKNOWN,
    failureCount: 0,
    consecutiveFailures: 0,
    lastError: null,
    errorCode: null,
    errorMessage: null,
    valueChangedAt: null,
    pollGroup: pollDefaults.pollGroup ?? POLL_GROUPS.normal,
    pollingEnabled: pollDefaults.pollingEnabled !== false,
    enabled: pollDefaults.enabled !== false,
    pollIntervalMs: pollDefaults.pollIntervalMs ?? getPollIntervalMs(POLL_GROUPS.normal),
    staleAfterMs: pollDefaults.staleAfterMs ?? computeStaleAfterMs(getPollIntervalMs(POLL_GROUPS.normal)),
    priority: pollDefaults.priority ?? 10,
    timeoutMs: pollDefaults.timeoutMs ?? 30000,
  };
}

function valuesEqual(a, b) {
  if (a === b) return true;
  if (a == null && b == null) return true;
  return JSON.stringify(a) === JSON.stringify(b);
}

function applyReadSuccess(pointId, value, options = {}) {
  const points = pointsStore.loadPoints();
  const index = points.findIndex((p) => p.id === pointId);
  if (index < 0) return null;

  const point = points[index];
  const now = new Date().toISOString();
  const pollIntervalMs = getPollIntervalMs(point.pollGroup, point.pollIntervalMs);
  const jitter = Math.floor(Math.random() * Math.min(pollIntervalMs * 0.1, 2000));
  const valueChanged = !valuesEqual(point.presentValue, value);

  const next = {
    ...point,
    previousValue: valueChanged ? point.presentValue : point.previousValue,
    presentValue: value ?? point.presentValue,
    lastKnownValue: value ?? point.lastKnownValue ?? point.presentValue,
    normalizedValue: value ?? point.normalizedValue,
    rawValue: options.rawValue !== undefined ? options.rawValue : point.rawValue,
    lastReadAt: now,
    lastAttemptAt: now,
    lastSuccessfulReadAt: now,
    lastPollAt: options.lastPollAt || point.lastPollAt || now,
    nextPollAt: options.scheduleNext !== false
      ? new Date(Date.now() + pollIntervalMs + jitter).toISOString()
      : point.nextPollAt,
    failureCount: 0,
    consecutiveFailures: 0,
    lastError: null,
    errorCode: null,
    errorMessage: null,
    valueChangedAt: valueChanged ? now : point.valueChangedAt,
  };

  next.quality = derivePointQuality(next, options.deviceQuality, options.runtimeState);
  points[index] = next;
  pointsStore.savePoints(points);
  return next;
}

function applyReadFailure(pointId, errorMessage, options = {}) {
  // eslint-disable-next-line global-require
  const mstpBusCoordinator = require('./mstpBusCoordinator');
  if (mstpBusCoordinator.isDiscoveryActive()) {
    return null;
  }

  const points = pointsStore.loadPoints();
  const index = points.findIndex((p) => p.id === pointId);
  if (index < 0) return null;

  const point = points[index];
  const now = new Date().toISOString();
  const pollIntervalMs = getPollIntervalMs(point.pollGroup, point.pollIntervalMs);
  const jitter = Math.floor(Math.random() * Math.min(pollIntervalMs * 0.1, 2000));
  const failureCount = (point.failureCount || 0) + 1;

  const next = {
    ...point,
    // Preserve last-known presentValue / lastKnownValue on failure
    lastKnownValue: point.lastKnownValue ?? point.presentValue ?? null,
    lastReadAt: now,
    lastAttemptAt: now,
    lastFailureAt: now,
    lastPollAt: options.lastPollAt || point.lastPollAt || now,
    nextPollAt: new Date(Date.now() + pollIntervalMs + jitter).toISOString(),
    failureCount,
    consecutiveFailures: failureCount,
    lastError: errorMessage || 'Read failed',
    errorCode: options.errorCode || null,
    errorMessage: errorMessage || 'Read failed',
  };

  next.quality = derivePointQuality(next, options.deviceQuality, options.runtimeState);
  points[index] = next;
  pointsStore.savePoints(points);
  return next;
}

function refreshQualitiesForDevice(managedDeviceId, deviceQuality, runtimeState) {
  const points = pointsStore.loadPoints();
  let changed = false;

  const updated = points.map((point) => {
    if (point.managedDeviceId !== managedDeviceId) return point;
    const quality = derivePointQuality(point, deviceQuality, runtimeState);
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
    enabled: patch.enabled !== undefined ? Boolean(patch.enabled) : point.enabled,
    pollIntervalMs,
    staleAfterMs,
    priority: patch.priority ?? point.priority,
    timeoutMs: patch.timeoutMs ?? point.timeoutMs,
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
    good: 0,
    online: 0,
    stale: 0,
    uncertain: 0,
    offline: 0,
    offline_by_device: 0,
    stale_by_device: 0,
    fault: 0,
    disabled: 0,
    unknown: 0,
    error: 0,
  };

  for (const point of points) {
    const q = normalizeStoredQuality(point.quality) || 'unknown';
    if (counts[q] != null) counts[q] += 1;
    else if (q === 'good') counts.good += 1;
    else counts.unknown += 1;
    // legacy online mirror
    if (q === 'good') counts.online += 1;
  }

  return counts;
}

function summarizeDevicePoints(managedDeviceId) {
  const points = pointsStore.loadPoints().filter((p) => p.managedDeviceId === managedDeviceId);
  const quality = countByQuality(points);
  return {
    managedPointCount: points.length,
    onlinePoints: quality.good + quality.online,
    stalePoints: quality.stale + quality.stale_by_device,
    offlinePoints: quality.offline + quality.offline_by_device,
    quality,
  };
}

function enrichPointForApi(point, deviceQuality, runtimeState) {
  const view = buildPointValueView(point, deviceQuality, runtimeState);
  return {
    ...point,
    ...view,
    quality: view.quality,
  };
}

module.exports = {
  POINT_QUALITY,
  POINT_OFFLINE_FAILURE_THRESHOLD,
  createCacheFields,
  derivePointQuality,
  applyReadSuccess,
  applyReadFailure,
  refreshQualitiesForDevice,
  updatePollConfig,
  countByQuality,
  summarizeDevicePoints,
  enrichPointForApi,
  buildPointValueView,
};
