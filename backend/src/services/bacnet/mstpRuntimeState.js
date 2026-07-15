/**
 * Authoritative MS/TP runtime state machine.
 * All public runtime state must flow through transitionTo() — callers must not
 * invent contradictory boolean combinations.
 */
const RUNTIME_STATE = Object.freeze({
  STOPPED: 'stopped',
  STARTING: 'starting',
  LISTENING: 'listening',
  JOINING: 'joining',
  ACTIVE: 'active',
  BUSY: 'busy',
  DEGRADED: 'degraded',
  RECOVERING: 'recovering',
  FAULTED: 'faulted',
  STOPPING: 'stopping',
});

const ALLOWED_TRANSITIONS = Object.freeze({
  [RUNTIME_STATE.STOPPED]: [RUNTIME_STATE.STARTING],
  [RUNTIME_STATE.STARTING]: [
    RUNTIME_STATE.LISTENING,
    RUNTIME_STATE.JOINING,
    RUNTIME_STATE.ACTIVE,
    RUNTIME_STATE.FAULTED,
    RUNTIME_STATE.STOPPING,
  ],
  [RUNTIME_STATE.LISTENING]: [
    RUNTIME_STATE.JOINING,
    RUNTIME_STATE.ACTIVE,
    RUNTIME_STATE.DEGRADED,
    RUNTIME_STATE.RECOVERING,
    RUNTIME_STATE.STOPPING,
  ],
  [RUNTIME_STATE.JOINING]: [
    RUNTIME_STATE.ACTIVE,
    RUNTIME_STATE.DEGRADED,
    RUNTIME_STATE.RECOVERING,
    RUNTIME_STATE.FAULTED,
    RUNTIME_STATE.STOPPING,
  ],
  [RUNTIME_STATE.ACTIVE]: [
    RUNTIME_STATE.BUSY,
    RUNTIME_STATE.DEGRADED,
    RUNTIME_STATE.RECOVERING,
    RUNTIME_STATE.STOPPING,
  ],
  [RUNTIME_STATE.BUSY]: [
    RUNTIME_STATE.ACTIVE,
    RUNTIME_STATE.DEGRADED,
    RUNTIME_STATE.RECOVERING,
    RUNTIME_STATE.STOPPING,
  ],
  [RUNTIME_STATE.DEGRADED]: [
    RUNTIME_STATE.ACTIVE,
    RUNTIME_STATE.BUSY,
    RUNTIME_STATE.RECOVERING,
    RUNTIME_STATE.FAULTED,
    RUNTIME_STATE.STOPPING,
  ],
  [RUNTIME_STATE.RECOVERING]: [
    RUNTIME_STATE.STARTING,
    RUNTIME_STATE.LISTENING,
    RUNTIME_STATE.ACTIVE,
    RUNTIME_STATE.FAULTED,
    RUNTIME_STATE.STOPPING,
  ],
  [RUNTIME_STATE.FAULTED]: [
    RUNTIME_STATE.RECOVERING,
    RUNTIME_STATE.STARTING,
    RUNTIME_STATE.STOPPING,
  ],
  [RUNTIME_STATE.STOPPING]: [RUNTIME_STATE.STOPPED],
});

function createRuntimeMachine(initialState = RUNTIME_STATE.STOPPED) {
  let state = initialState;
  let stateSince = new Date().toISOString();
  let runtimeGeneration = 0;
  let lastTransition = null;
  const listeners = new Set();

  function onTransition(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  function getState() {
    return state;
  }

  function getStateSince() {
    return stateSince;
  }

  function getRuntimeGeneration() {
    return runtimeGeneration;
  }

  function getLastTransition() {
    return lastTransition ? { ...lastTransition } : null;
  }

  function canTransition(nextState) {
    const allowed = ALLOWED_TRANSITIONS[state] || [];
    return allowed.includes(nextState);
  }

  function bumpGeneration(reason = 'generation_bump') {
    runtimeGeneration += 1;
    return {
      runtimeGeneration,
      reason,
      at: new Date().toISOString(),
    };
  }

  function transitionTo(nextState, reason = 'unspecified', meta = {}) {
    if (nextState === state) {
      return {
        ok: true,
        noop: true,
        previousState: state,
        nextState: state,
        reason,
        at: new Date().toISOString(),
        runtimeGeneration,
      };
    }

    if (!canTransition(nextState)) {
      const rejected = {
        ok: false,
        previousState: state,
        nextState,
        reason,
        at: new Date().toISOString(),
        runtimeGeneration,
        error: `Invalid transition ${state} → ${nextState}`,
        ...meta,
      };
      for (const listener of listeners) {
        try {
          listener({ type: 'rejected', ...rejected });
        } catch {
          // ignore listener failures
        }
      }
      return rejected;
    }

    const previousState = state;
    state = nextState;
    stateSince = new Date().toISOString();
    lastTransition = {
      ok: true,
      previousState,
      nextState,
      reason,
      at: stateSince,
      runtimeGeneration,
      ...meta,
    };

    for (const listener of listeners) {
      try {
        listener({ type: 'transition', ...lastTransition });
      } catch {
        // ignore listener failures
      }
    }

    return lastTransition;
  }

  function isOperational() {
    return [
      RUNTIME_STATE.LISTENING,
      RUNTIME_STATE.JOINING,
      RUNTIME_STATE.ACTIVE,
      RUNTIME_STATE.BUSY,
      RUNTIME_STATE.DEGRADED,
    ].includes(state);
  }

  function acceptsBackgroundWork() {
    return [
      RUNTIME_STATE.ACTIVE,
      RUNTIME_STATE.BUSY,
      RUNTIME_STATE.LISTENING,
      RUNTIME_STATE.JOINING,
    ].includes(state);
  }

  function resetForTests(nextState = RUNTIME_STATE.STOPPED) {
    state = nextState;
    stateSince = new Date().toISOString();
    runtimeGeneration = 0;
    lastTransition = null;
  }

  return {
    RUNTIME_STATE,
    ALLOWED_TRANSITIONS,
    getState,
    getStateSince,
    getRuntimeGeneration,
    getLastTransition,
    canTransition,
    transitionTo,
    bumpGeneration,
    isOperational,
    acceptsBackgroundWork,
    onTransition,
    resetForTests,
  };
}

/**
 * Legacy derive helper — prefer the machine. Kept for backward-compatible tests
 * and snapshots that still pass session flags.
 */
function deriveRuntimeState({
  open = false,
  opening = false,
  closing = false,
  discoveryInProgress = false,
  pointDiscoveryInProgress = false,
  fieldReadInProgress = false,
  lastError = null,
  degraded = false,
  recovering = false,
  machineState = null,
} = {}) {
  if (machineState) return machineState;
  if (closing) return RUNTIME_STATE.STOPPING;
  if (recovering) return RUNTIME_STATE.RECOVERING;
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
  const machine = parts.machine || null;
  const state = machine
    ? machine.getState()
    : deriveRuntimeState(parts);
  const stateSince = machine ? machine.getStateSince() : (parts.stateSince || null);
  const runtimeGeneration = machine
    ? machine.getRuntimeGeneration()
    : (parts.runtimeGeneration ?? 0);

  return {
    state,
    stateSince,
    runtimeGeneration,
    open: Boolean(parts.open),
    serialPort: parts.port || parts.serialPort || null,
    port: parts.port || parts.serialPort || null,
    baudRate: parts.baudRate ?? null,
    localMac: parts.macAddress ?? parts.localMac ?? null,
    macAddress: parts.macAddress ?? parts.localMac ?? null,
    networkNumber: parts.networkNumber ?? null,
    tokenStatus: parts.tokenStatus || null,
    lastError: parts.lastError || null,
    activeOperation: parts.activeOperation
      || (parts.discoveryInProgress
        ? 'device_discovery'
        : parts.pointDiscoveryInProgress
          ? 'point_discovery'
          : parts.fieldReadInProgress
            ? 'field_read'
            : null),
    queueDepth: parts.queueDepth ?? 0,
    lastSuccessfulFrameAt: parts.lastSuccessfulFrameAt || null,
    recoveryAttempt: parts.recoveryAttempt ?? 0,
    recovery: parts.recovery || {
      attempt: parts.recoveryAttempt ?? 0,
      nextRetryAt: parts.nextRetryAt || null,
    },
    serialOwner: 'bacnetMstp.service',
    openedAt: parts.openedAt || null,
  };
}

module.exports = {
  RUNTIME_STATE,
  ALLOWED_TRANSITIONS,
  createRuntimeMachine,
  deriveRuntimeState,
  buildRuntimeSnapshot,
};
