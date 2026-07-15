/**
 * Persistent MS/TP runtime lifecycle helpers.
 * Used exclusively by bacnetMstp.service (sole serial owner).
 */
const { createRuntimeMachine, RUNTIME_STATE, buildRuntimeSnapshot } = require('./mstpRuntimeState');

const RECOVERY_BACKOFF_MS = Object.freeze([1000, 2000, 5000, 10000, 30000, 60000]);

function createLifecycleController({ log } = {}) {
  const machine = createRuntimeMachine();
  const recovery = {
    attempt: 0,
    nextRetryAt: null,
    timer: null,
    inProgress: false,
    lastReason: null,
  };

  let persistent = false;
  let shuttingDown = false;
  let autoStartEnabled = true;

  machine.onTransition((event) => {
    if (typeof log === 'function') {
      if (event.type === 'rejected') {
        log('warn', `Runtime transition rejected: ${event.previousState} → ${event.nextState} (${event.reason})`, event);
      } else {
        log('info', `Runtime state: ${event.previousState} → ${event.nextState} (${event.reason})`, event);
      }
    }
  });

  function getMachine() {
    return machine;
  }

  function isPersistent() {
    return persistent;
  }

  function setPersistent(value) {
    persistent = Boolean(value);
  }

  function isShuttingDown() {
    return shuttingDown;
  }

  function setShuttingDown(value) {
    shuttingDown = Boolean(value);
  }

  function isAutoStartEnabled() {
    return autoStartEnabled;
  }

  function setAutoStartEnabled(value) {
    autoStartEnabled = Boolean(value);
  }

  function clearRecoveryTimer() {
    if (recovery.timer) {
      clearTimeout(recovery.timer);
      recovery.timer = null;
    }
  }

  function resetRecovery() {
    clearRecoveryTimer();
    recovery.attempt = 0;
    recovery.nextRetryAt = null;
    recovery.inProgress = false;
    recovery.lastReason = null;
  }

  function nextBackoffMs() {
    const idx = Math.min(recovery.attempt, RECOVERY_BACKOFF_MS.length - 1);
    const base = RECOVERY_BACKOFF_MS[idx];
    const jitter = Math.floor(Math.random() * Math.min(base * 0.2, 1000));
    return base + jitter;
  }

  function beginRecovery(reason) {
    if (recovery.inProgress || shuttingDown) {
      return { started: false, reason: recovery.inProgress ? 'already_recovering' : 'shutting_down' };
    }
    recovery.inProgress = true;
    recovery.lastReason = reason || 'unspecified';
    recovery.attempt += 1;
    const waitMs = nextBackoffMs();
    recovery.nextRetryAt = new Date(Date.now() + waitMs).toISOString();
    machine.transitionTo(RUNTIME_STATE.RECOVERING, reason || 'recovery_started', {
      attempt: recovery.attempt,
      nextRetryAt: recovery.nextRetryAt,
    });
    return { started: true, waitMs, attempt: recovery.attempt, nextRetryAt: recovery.nextRetryAt };
  }

  function scheduleRecovery(fn) {
    clearRecoveryTimer();
    const waitMs = recovery.nextRetryAt
      ? Math.max(0, new Date(recovery.nextRetryAt).getTime() - Date.now())
      : nextBackoffMs();
    recovery.timer = setTimeout(() => {
      recovery.timer = null;
      Promise.resolve()
        .then(() => fn())
        .catch(() => {})
        .finally(() => {
          recovery.inProgress = false;
        });
    }, waitMs);
    return waitMs;
  }

  function markRecoverySuccess() {
    resetRecovery();
  }

  function bumpGeneration(reason) {
    return machine.bumpGeneration(reason);
  }

  function buildSnapshot(parts = {}) {
    return buildRuntimeSnapshot({
      ...parts,
      machine,
      recoveryAttempt: recovery.attempt,
      nextRetryAt: recovery.nextRetryAt,
      recovery: {
        attempt: recovery.attempt,
        nextRetryAt: recovery.nextRetryAt,
        inProgress: recovery.inProgress,
        lastReason: recovery.lastReason,
      },
    });
  }

  function shouldKeepPortOpenAfterOperation() {
    // Phase 2: never tear down the bus after discovery/read when lifecycle owns it.
    return persistent || machine.isOperational() || machine.getState() === RUNTIME_STATE.BUSY;
  }

  return {
    machine,
    recovery,
    RECOVERY_BACKOFF_MS,
    getMachine,
    isPersistent,
    setPersistent,
    isShuttingDown,
    setShuttingDown,
    isAutoStartEnabled,
    setAutoStartEnabled,
    clearRecoveryTimer,
    resetRecovery,
    beginRecovery,
    scheduleRecovery,
    markRecoverySuccess,
    bumpGeneration,
    buildSnapshot,
    shouldKeepPortOpenAfterOperation,
    RUNTIME_STATE,
  };
}

module.exports = {
  createLifecycleController,
  RECOVERY_BACKOFF_MS,
};
