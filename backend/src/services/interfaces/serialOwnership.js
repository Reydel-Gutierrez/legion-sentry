/**
 * Backend-enforced serial-port ownership.
 * Exactly one of: none | bacnet-mstp | diagnostics
 * Survives browser refresh (process-local state).
 */

const SERIAL_OWNER = Object.freeze({
  NONE: 'none',
  BACNET_MSTP: 'bacnet-mstp',
  DIAGNOSTICS: 'diagnostics',
});

const OWNER_TIMEOUT_MS = Number(process.env.LEGION_SENTRY_SERIAL_OWNER_TIMEOUT_MS) || 30 * 60 * 1000;

const state = {
  owner: SERIAL_OWNER.NONE,
  portPath: null,
  acquiredAt: null,
  lastReason: null,
  timeoutTimer: null,
};

function getOwner() {
  return {
    owner: state.owner,
    portPath: state.portPath,
    acquiredAt: state.acquiredAt,
    lastReason: state.lastReason,
  };
}

function clearTimeoutTimer() {
  if (state.timeoutTimer) {
    clearTimeout(state.timeoutTimer);
    state.timeoutTimer = null;
  }
}

function armTimeout(onTimeout) {
  clearTimeoutTimer();
  if (!OWNER_TIMEOUT_MS || OWNER_TIMEOUT_MS <= 0) return;
  state.timeoutTimer = setTimeout(() => {
    state.timeoutTimer = null;
    const previous = state.owner;
    if (previous === SERIAL_OWNER.NONE) return;
    const portPath = state.portPath;
    state.owner = SERIAL_OWNER.NONE;
    state.portPath = null;
    state.acquiredAt = null;
    state.lastReason = 'ownership_timeout';
    if (typeof onTimeout === 'function') {
      try {
        onTimeout({ previousOwner: previous, portPath });
      } catch {
        // ignore timeout callback failures
      }
    }
  }, OWNER_TIMEOUT_MS);
  state.timeoutTimer.unref?.();
}

function createConflictError(requestedOwner, message) {
  const error = new Error(message || `Serial port is owned by ${state.owner}`);
  error.statusCode = 409;
  error.code = 'SERIAL_OWNERSHIP_CONFLICT';
  error.details = {
    owner: state.owner,
    requestedOwner,
    portPath: state.portPath,
    acquiredAt: state.acquiredAt,
  };
  return error;
}

/**
 * Acquire exclusive ownership. Same owner may re-acquire (idempotent refresh).
 */
function acquire(owner, { portPath = null, reason = null, onTimeout = null } = {}) {
  if (!Object.values(SERIAL_OWNER).includes(owner) || owner === SERIAL_OWNER.NONE) {
    const error = new Error(`Invalid serial owner: ${owner}`);
    error.statusCode = 400;
    error.code = 'INVALID_SERIAL_OWNER';
    throw error;
  }

  if (state.owner !== SERIAL_OWNER.NONE && state.owner !== owner) {
    throw createConflictError(
      owner,
      `Serial port is owned by ${state.owner} — release it before ${owner} can acquire`,
    );
  }

  state.owner = owner;
  state.portPath = portPath || state.portPath;
  state.acquiredAt = state.acquiredAt || new Date().toISOString();
  state.lastReason = reason || 'acquired';
  armTimeout(onTimeout);
  return getOwner();
}

/**
 * Release ownership. Only the current owner (or force) may release.
 */
function release(owner, { force = false, reason = null } = {}) {
  if (state.owner === SERIAL_OWNER.NONE) {
    return getOwner();
  }
  if (!force && state.owner !== owner) {
    throw createConflictError(owner, `Cannot release serial ownership held by ${state.owner}`);
  }
  clearTimeoutTimer();
  state.owner = SERIAL_OWNER.NONE;
  state.portPath = null;
  state.acquiredAt = null;
  state.lastReason = reason || 'released';
  return getOwner();
}

function assertCanAcquire(owner) {
  if (state.owner !== SERIAL_OWNER.NONE && state.owner !== owner) {
    throw createConflictError(owner);
  }
  return true;
}

function isOwnedBy(owner) {
  return state.owner === owner;
}

function isFree() {
  return state.owner === SERIAL_OWNER.NONE;
}

/** Test helper — do not use in production paths. */
function resetForTests() {
  clearTimeoutTimer();
  state.owner = SERIAL_OWNER.NONE;
  state.portPath = null;
  state.acquiredAt = null;
  state.lastReason = null;
}

module.exports = {
  SERIAL_OWNER,
  OWNER_TIMEOUT_MS,
  getOwner,
  acquire,
  release,
  assertCanAcquire,
  isOwnedBy,
  isFree,
  createConflictError,
  resetForTests,
};
