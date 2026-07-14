/**
 * Authoritative MS/TP runtime state model.
 * Derived from bacnetMstp.service session flags — callers must not invent
 * contradictory boolean combinations.
 */
const RUNTIME_STATE = Object.freeze({
  STOPPED: 'stopped',
  STARTING: 'starting',
  LISTENING: 'listening',
  JOINING: 'joining',
  ACTIVE: 'active',
  BUSY: 'busy',
  DEGRADED: 'degraded',
  FAULTED: 'faulted',
  STOPPING: 'stopping',
});

function deriveRuntimeState({
  open = false,
  opening = false,
  closing = false,
  discoveryInProgress = false,
  pointDiscoveryInProgress = false,
  fieldReadInProgress = false,
  lastError = null,
  degraded = false,
} = {}) {
  if (closing) return RUNTIME_STATE.STOPPING;
  if (opening) return RUNTIME_STATE.STARTING;
  if (lastError && !open) return RUNTIME_STATE.FAULTED;
  if (!open) return RUNTIME_STATE.STOPPED;
  if (discoveryInProgress || pointDiscoveryInProgress || fieldReadInProgress) {
    return RUNTIME_STATE.BUSY;
  }
  if (degraded || lastError) return RUNTIME_STATE.DEGRADED;
  return RUNTIME_STATE.ACTIVE;
}

function buildRuntimeSnapshot(parts = {}) {
  const state = deriveRuntimeState(parts);
  return {
    state,
    open: Boolean(parts.open),
    port: parts.port || null,
    baudRate: parts.baudRate ?? null,
    macAddress: parts.macAddress ?? null,
    networkNumber: parts.networkNumber ?? null,
    lastError: parts.lastError || null,
    activeOperation: parts.discoveryInProgress
      ? 'device_discovery'
      : parts.pointDiscoveryInProgress
        ? 'point_discovery'
        : parts.fieldReadInProgress
          ? 'field_read'
          : null,
    serialOwner: 'bacnetMstp.service',
    openedAt: parts.openedAt || null,
  };
}

module.exports = {
  RUNTIME_STATE,
  deriveRuntimeState,
  buildRuntimeSnapshot,
};
