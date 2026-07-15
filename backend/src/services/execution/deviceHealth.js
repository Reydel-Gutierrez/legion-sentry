/**
 * Managed-device health state machine (Phase 2).
 *
 * States: online | degraded | offline | unknown | disabled
 *
 * One failure never marks a device offline.
 */
const DEVICE_HEALTH = Object.freeze({
  ONLINE: 'online',
  DEGRADED: 'degraded',
  OFFLINE: 'offline',
  UNKNOWN: 'unknown',
  DISABLED: 'disabled',
});

const DEFAULT_THRESHOLDS = Object.freeze({
  /** failures while online before degraded */
  degradedAfterFailures: 2,
  /** failures while degraded before offline */
  offlineAfterFailures: 4,
  /** successes while offline before online */
  onlineAfterSuccessesFromOffline: 2,
  /** successes while degraded before online */
  onlineAfterSuccessesFromDegraded: 1,
});

function createHealthFields() {
  return {
    deviceQuality: DEVICE_HEALTH.UNKNOWN,
    lastSeenAt: null,
    lastSuccessfulReadAt: null,
    lastFailedReadAt: null,
    consecutiveSuccesses: 0,
    consecutiveFailures: 0,
    responseTimeMs: null,
    averageResponseTimeMs: null,
    lastErrorCode: null,
    lastErrorMessage: null,
    healthChangedAt: null,
    heartbeatFailureCount: 0,
    lastHeartbeatAt: null,
    lastHeartbeatError: null,
  };
}

function nextHealthState(current, { success, enabled = true }, thresholds = DEFAULT_THRESHOLDS) {
  if (!enabled) return DEVICE_HEALTH.DISABLED;

  const state = current.deviceQuality || DEVICE_HEALTH.UNKNOWN;
  let consecutiveSuccesses = current.consecutiveSuccesses || 0;
  let consecutiveFailures = current.consecutiveFailures || 0;

  if (success) {
    consecutiveSuccesses += 1;
    consecutiveFailures = 0;
  } else {
    consecutiveFailures += 1;
    consecutiveSuccesses = 0;
  }

  let next = state;

  if (success) {
    if (state === DEVICE_HEALTH.UNKNOWN || state === DEVICE_HEALTH.DISABLED) {
      next = DEVICE_HEALTH.ONLINE;
    } else if (state === DEVICE_HEALTH.DEGRADED) {
      if (consecutiveSuccesses >= thresholds.onlineAfterSuccessesFromDegraded) {
        next = DEVICE_HEALTH.ONLINE;
      }
    } else if (state === DEVICE_HEALTH.OFFLINE) {
      if (consecutiveSuccesses >= thresholds.onlineAfterSuccessesFromOffline) {
        next = DEVICE_HEALTH.ONLINE;
      } else {
        next = DEVICE_HEALTH.DEGRADED;
      }
    } else {
      next = DEVICE_HEALTH.ONLINE;
    }
  } else if (state === DEVICE_HEALTH.ONLINE) {
    if (consecutiveFailures >= thresholds.degradedAfterFailures) {
      next = DEVICE_HEALTH.DEGRADED;
    }
  } else if (state === DEVICE_HEALTH.DEGRADED || state === DEVICE_HEALTH.UNKNOWN) {
    if (consecutiveFailures >= thresholds.offlineAfterFailures) {
      next = DEVICE_HEALTH.OFFLINE;
    } else if (consecutiveFailures >= thresholds.degradedAfterFailures) {
      next = DEVICE_HEALTH.DEGRADED;
    }
  } else if (state === DEVICE_HEALTH.OFFLINE) {
    next = DEVICE_HEALTH.OFFLINE;
  }

  return {
    deviceQuality: next,
    consecutiveSuccesses,
    consecutiveFailures,
    // legacy mirror used by older UI
    heartbeatFailureCount: consecutiveFailures,
  };
}

function applyHealthResult(current, { success, error, errorCode, responseTimeMs, enabled = true }, thresholds = DEFAULT_THRESHOLDS) {
  const now = new Date().toISOString();
  const transition = nextHealthState(current, { success, enabled }, thresholds);
  const healthChanged = transition.deviceQuality !== (current.deviceQuality || DEVICE_HEALTH.UNKNOWN);

  let averageResponseTimeMs = current.averageResponseTimeMs ?? null;
  if (success && Number.isFinite(responseTimeMs)) {
    if (averageResponseTimeMs == null) averageResponseTimeMs = responseTimeMs;
    else averageResponseTimeMs = Math.round((averageResponseTimeMs * 0.7) + (responseTimeMs * 0.3));
  }

  return {
    ...current,
    ...transition,
    lastSeenAt: success ? now : current.lastSeenAt,
    lastSuccessfulReadAt: success ? now : current.lastSuccessfulReadAt,
    lastFailedReadAt: success ? current.lastFailedReadAt : now,
    lastHeartbeatAt: now,
    lastHeartbeatError: success ? null : (error || 'Health check failed'),
    lastErrorCode: success ? null : (errorCode || null),
    lastErrorMessage: success ? null : (error || null),
    responseTimeMs: success && Number.isFinite(responseTimeMs) ? responseTimeMs : current.responseTimeMs,
    averageResponseTimeMs,
    healthChangedAt: healthChanged ? now : (current.healthChangedAt || null),
  };
}

module.exports = {
  DEVICE_HEALTH,
  DEFAULT_THRESHOLDS,
  createHealthFields,
  nextHealthState,
  applyHealthResult,
};
