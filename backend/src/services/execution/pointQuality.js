/**
 * Normalized managed-point quality model (Phase 2).
 *
 * good | stale | uncertain | offline | fault | disabled | unknown
 *
 * Legacy aliases (online, offline_by_device, stale_by_device, error) map into
 * this vocabulary for API/UI compatibility.
 */
const POINT_QUALITY = Object.freeze({
  GOOD: 'good',
  STALE: 'stale',
  UNCERTAIN: 'uncertain',
  OFFLINE: 'offline',
  FAULT: 'fault',
  DISABLED: 'disabled',
  UNKNOWN: 'unknown',
  // Legacy aliases retained for stored records / UI during transition
  ONLINE: 'good',
  ERROR: 'fault',
  OFFLINE_BY_DEVICE: 'offline',
  STALE_BY_DEVICE: 'stale',
});

const DEVICE_OFFLINE = new Set(['offline']);
const DEVICE_DEGRADED = new Set(['degraded', 'stale']);

function normalizeStoredQuality(quality) {
  if (!quality) return POINT_QUALITY.UNKNOWN;
  if (quality === 'online' || quality === 'good') return POINT_QUALITY.GOOD;
  if (quality === 'error') return POINT_QUALITY.FAULT;
  if (quality === 'offline_by_device') return POINT_QUALITY.OFFLINE;
  if (quality === 'stale_by_device') return POINT_QUALITY.STALE;
  return quality;
}

function derivePointQuality(point, deviceQuality, runtimeState = null) {
  if (point?.pollingEnabled === false || point?.enabled === false) {
    return POINT_QUALITY.DISABLED;
  }

  if (runtimeState === 'stopped' || runtimeState === 'faulted') {
    if (point?.lastSuccessfulReadAt || point?.presentValue != null) {
      return POINT_QUALITY.STALE;
    }
    return POINT_QUALITY.UNKNOWN;
  }

  if (DEVICE_OFFLINE.has(deviceQuality)) {
    return POINT_QUALITY.OFFLINE;
  }

  if (point?.fault || point?.reliabilityFault) {
    return POINT_QUALITY.FAULT;
  }

  if (point?.statusFlags?.fault || point?.reliability === 'fault') {
    return POINT_QUALITY.FAULT;
  }

  if (
    point?.statusFlags?.outOfService
    || point?.reliability === 'unreliable'
    || point?.statusFlags?.overridden
  ) {
    return POINT_QUALITY.UNCERTAIN;
  }

  const failureCount = point?.failureCount || point?.consecutiveFailures || 0;
  if (failureCount >= 3 && !point?.lastSuccessfulReadAt) {
    return POINT_QUALITY.OFFLINE;
  }

  const staleAfterMs = point?.staleAfterMs;
  const lastOk = point?.lastSuccessfulReadAt;
  if (staleAfterMs && lastOk) {
    const age = Date.now() - new Date(lastOk).getTime();
    if (age > staleAfterMs) return POINT_QUALITY.STALE;
  } else if (!lastOk && (point?.lastReadAt || point?.lastAttemptAt)) {
    return failureCount > 0 ? POINT_QUALITY.UNCERTAIN : POINT_QUALITY.UNKNOWN;
  }

  if (DEVICE_DEGRADED.has(deviceQuality) && lastOk) {
    return POINT_QUALITY.STALE;
  }

  if (lastOk || point?.presentValue != null) {
    return POINT_QUALITY.GOOD;
  }

  return POINT_QUALITY.UNKNOWN;
}

function buildPointValueView(point, deviceQuality, runtimeState) {
  const quality = derivePointQuality(point, deviceQuality, runtimeState);
  const lastKnownValue = point?.presentValue ?? point?.lastKnownValue ?? null;
  const isRetainedStale = quality === POINT_QUALITY.STALE || quality === POINT_QUALITY.OFFLINE;

  return {
    value: quality === POINT_QUALITY.GOOD || quality === POINT_QUALITY.UNCERTAIN
      ? (point?.presentValue ?? lastKnownValue)
      : lastKnownValue,
    lastKnownValue,
    quality,
    lastUpdatedAt: point?.lastSuccessfulReadAt || point?.valueChangedAt || null,
    lastAttemptAt: point?.lastReadAt || point?.lastAttemptAt || point?.lastPollAt || null,
    isRetainedStale,
    units: point?.units || null,
    dataType: point?.dataType || null,
  };
}

module.exports = {
  POINT_QUALITY,
  normalizeStoredQuality,
  derivePointQuality,
  buildPointValueView,
};
