const logsService = require('../logs');

const BUS_STATE = Object.freeze({
  IDLE: 'idle',
  DISCOVERY: 'discovery',
  EXECUTION: 'execution',
  PAUSED: 'paused',
});

const BUS_OWNER = Object.freeze({
  DISCOVERY: 'discovery',
  POINT_DISCOVERY: 'point_discovery',
  EXECUTION: 'execution',
});

let busState = BUS_STATE.IDLE;
let busOwner = null;
let discoveryActive = false;
let executionPaused = false;
let pauseReason = null;

function log(level, message) {
  logsService.addLog({ level, service: 'bacnet', message });
}

function lazyFieldExecutionEngine() {
  // eslint-disable-next-line global-require
  return require('./fieldExecutionEngine');
}

function lazyDeviceHealthPoller() {
  // eslint-disable-next-line global-require
  return require('./deviceHealthPoller');
}

function lazyPointPollingEngine() {
  // eslint-disable-next-line global-require
  return require('./pointPollingEngine');
}

function lazyBacnetMstpService() {
  // eslint-disable-next-line global-require
  return require('../bacnet/bacnetMstp.service');
}

function getBusState() {
  if (discoveryActive && !busOwner) return BUS_STATE.PAUSED;
  if (discoveryActive && busOwner === BUS_OWNER.DISCOVERY) return BUS_STATE.DISCOVERY;
  if (busOwner === BUS_OWNER.EXECUTION || busOwner === BUS_OWNER.POINT_DISCOVERY) {
    return BUS_STATE.EXECUTION;
  }
  if (executionPaused) return BUS_STATE.PAUSED;
  return busState;
}

function getPauseMessage() {
  if (discoveryActive) return 'Background polling and device health paused for discovery';
  if (executionPaused && pauseReason) return `Paused — ${pauseReason}`;
  return null;
}

async function prepareForDiscovery() {
  discoveryActive = true;
  executionPaused = true;
  pauseReason = 'discovery running';
  busState = BUS_STATE.PAUSED;

  const polling = lazyPointPollingEngine();
  const execution = lazyFieldExecutionEngine();
  const health = lazyDeviceHealthPoller();

  polling.pauseForDiscovery();
  health.pauseForDiscovery();
  execution.pauseForDiscovery();

  log('info', 'Background services paused for MS/TP discovery');

  const pollingCancelled = execution.cancelQueuedPollingJobs();
  const healthCancelled = execution.cancelQueuedDeviceHealthJobs();
  if (pollingCancelled.cancelled > 0 || healthCancelled.cancelled > 0) {
    log('info', `Queued polling/health jobs cancelled before discovery (${pollingCancelled.cancelled} polling, ${healthCancelled.cancelled} health)`);
  }

  lazyBacnetMstpService().prepareDiscoverySession();

  await execution.waitForIdleOrCancel(30000);

  log('info', 'Discovery bus lock acquired');
}

function resumeAfterDiscovery() {
  log('info', 'Discovery bus lock released');

  discoveryActive = false;
  executionPaused = false;
  pauseReason = null;

  if (busOwner === BUS_OWNER.DISCOVERY) {
    busOwner = null;
  }
  busState = BUS_STATE.IDLE;

  lazyPointPollingEngine().resumeFromDiscovery();
  lazyFieldExecutionEngine().resumeFromDiscovery();
  lazyDeviceHealthPoller().resumeFromDiscovery();

  log('info', 'Background services resumed after discovery');
}

function pauseBackgroundServices() {
  lazyPointPollingEngine().pause();
  lazyDeviceHealthPoller().pause();
  log('info', 'Background services paused by operator');
  return getBackgroundStatus();
}

function resumeBackgroundServices() {
  if (discoveryActive) {
    return {
      success: false,
      message: 'Cannot resume background services while discovery is active',
      ...getBackgroundStatus(),
    };
  }

  lazyPointPollingEngine().resume();
  lazyDeviceHealthPoller().resume();
  log('info', 'Background services resumed by operator');
  return { success: true, ...getBackgroundStatus() };
}

function getBackgroundStatus() {
  const polling = lazyPointPollingEngine().getStatus();
  const deviceHealth = lazyDeviceHealthPoller().getStatus();
  const paused = polling.paused || deviceHealth.paused;
  let pauseReasonLabel = null;
  if (discoveryActive || polling.pauseReason === 'discovery' || deviceHealth.pauseReason === 'discovery') {
    pauseReasonLabel = 'discovery';
  } else if (polling.pauseReason === 'user' || deviceHealth.pauseReason === 'user') {
    pauseReasonLabel = 'user';
  }

  return {
    paused,
    pauseReason: pauseReasonLabel,
    discoveryActive,
    polling,
    deviceHealth,
  };
}

function isDiscoveryActive() {
  return discoveryActive;
}

function isExecutionPaused() {
  return executionPaused || discoveryActive;
}

function canStartExecutionJob() {
  return !isExecutionPaused() && !busOwner;
}

function canCreatePollingJobs() {
  return !isExecutionPaused() && !busOwner;
}

function acquireBus(owner) {
  if (discoveryActive && owner !== BUS_OWNER.DISCOVERY) {
    const error = new Error('MS/TP bus is owned by discovery');
    error.code = 'BUS_BUSY_DISCOVERY';
    throw error;
  }
  if (busOwner && busOwner !== owner) {
    const error = new Error(`MS/TP bus is busy (${busOwner})`);
    error.code = 'BUS_BUSY';
    throw error;
  }
  busOwner = owner;
  if (owner === BUS_OWNER.DISCOVERY) {
    busState = BUS_STATE.DISCOVERY;
    if (!discoveryActive) {
      log('info', 'Discovery bus lock acquired');
    }
  } else {
    busState = BUS_STATE.EXECUTION;
  }
}

function releaseBus(owner) {
  if (busOwner !== owner) return;
  busOwner = null;
  busState = discoveryActive ? BUS_STATE.PAUSED : BUS_STATE.IDLE;
}

function ownerForJobType(jobType) {
  if (jobType === 'discover_points') return BUS_OWNER.POINT_DISCOVERY;
  return BUS_OWNER.EXECUTION;
}

function getCoordinatorStatus() {
  return {
    busState: getBusState(),
    busOwner,
    discoveryActive,
    executionPaused,
    pauseReason,
    pauseMessage: getPauseMessage(),
    canStartExecutionJob: canStartExecutionJob(),
    canCreatePollingJobs: canCreatePollingJobs(),
  };
}

module.exports = {
  BUS_STATE,
  BUS_OWNER,
  prepareForDiscovery,
  resumeAfterDiscovery,
  pauseBackgroundServices,
  resumeBackgroundServices,
  getBackgroundStatus,
  isDiscoveryActive,
  isExecutionPaused,
  canStartExecutionJob,
  canCreatePollingJobs,
  acquireBus,
  releaseBus,
  ownerForJobType,
  getCoordinatorStatus,
  getBusState,
  getPauseMessage,
};
