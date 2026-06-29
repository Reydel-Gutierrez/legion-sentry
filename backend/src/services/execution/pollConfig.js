const POLL_GROUPS = Object.freeze({
  fast: 'fast',
  normal: 'normal',
  slow: 'slow',
  manual: 'manual',
});

const POLL_INTERVAL_MS = Object.freeze({
  fast: 10000,
  normal: 60000,
  slow: 300000,
  manual: null,
});

const DEFAULT_STALE_MULTIPLIER = 2;
const MIN_STALE_AFTER_MS = 60000;
const POINT_OFFLINE_FAILURE_THRESHOLD = 3;

// BACnet object type → default poll group
const DEFAULT_POLL_GROUP_BY_OBJECT_TYPE = Object.freeze({
  0: POLL_GROUPS.normal, // analog-input
  1: POLL_GROUPS.normal, // analog-output
  2: POLL_GROUPS.normal, // analog-value
  3: POLL_GROUPS.fast, // binary-input
  4: POLL_GROUPS.fast, // binary-output
  5: POLL_GROUPS.normal, // binary-value
  6: POLL_GROUPS.manual, // calendar
  8: POLL_GROUPS.slow, // device
  10: POLL_GROUPS.manual, // file
  13: POLL_GROUPS.normal, // multi-state-input
  14: POLL_GROUPS.normal, // multi-state-output
  15: POLL_GROUPS.manual, // notification-class
  17: POLL_GROUPS.manual, // schedule
  19: POLL_GROUPS.normal, // multi-state-value
  20: POLL_GROUPS.manual, // trend-log
});

const STATIC_OBJECT_TYPES = new Set([6, 10, 11, 15, 17, 20, 25, 27]);

function isValidPollGroup(group) {
  return Object.values(POLL_GROUPS).includes(group);
}

function getPollIntervalMs(pollGroup, overrideMs) {
  if (Number.isFinite(overrideMs) && overrideMs > 0) return overrideMs;
  const interval = POLL_INTERVAL_MS[pollGroup];
  return interval ?? POLL_INTERVAL_MS.normal;
}

function defaultPollGroupForObjectType(objectType) {
  if (DEFAULT_POLL_GROUP_BY_OBJECT_TYPE[objectType] != null) {
    return DEFAULT_POLL_GROUP_BY_OBJECT_TYPE[objectType];
  }
  if (STATIC_OBJECT_TYPES.has(objectType)) return POLL_GROUPS.manual;
  return POLL_GROUPS.normal;
}

function defaultPollingEnabledForObjectType(objectType) {
  const group = defaultPollGroupForObjectType(objectType);
  return group !== POLL_GROUPS.manual;
}

function computeStaleAfterMs(pollIntervalMs) {
  if (!Number.isFinite(pollIntervalMs) || pollIntervalMs <= 0) return null;
  return Math.max(pollIntervalMs * DEFAULT_STALE_MULTIPLIER, MIN_STALE_AFTER_MS);
}

function createPollDefaults(objectType) {
  const pollGroup = defaultPollGroupForObjectType(objectType);
  const pollingEnabled = defaultPollingEnabledForObjectType(objectType);
  const pollIntervalMs = getPollIntervalMs(pollGroup);
  const staleAfterMs = computeStaleAfterMs(pollIntervalMs);
  const now = Date.now();
  const jitter = pollingEnabled && pollIntervalMs
    ? Math.floor(Math.random() * Math.min(pollIntervalMs, 10000))
    : 0;

  return {
    pollGroup,
    pollingEnabled,
    pollIntervalMs,
    staleAfterMs,
    nextPollAt: pollingEnabled ? new Date(now + jitter).toISOString() : null,
  };
}

module.exports = {
  POLL_GROUPS,
  POLL_INTERVAL_MS,
  POINT_OFFLINE_FAILURE_THRESHOLD,
  DEFAULT_POLL_GROUP_BY_OBJECT_TYPE,
  isValidPollGroup,
  getPollIntervalMs,
  defaultPollGroupForObjectType,
  defaultPollingEnabledForObjectType,
  computeStaleAfterMs,
  createPollDefaults,
};
