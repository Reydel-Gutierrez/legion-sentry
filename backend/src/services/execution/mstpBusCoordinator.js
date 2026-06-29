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

function lazyPointPollingEngine() {
  // eslint-disable-next-line global-require
  return require('./pointPollingEngine');
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
  if (discoveryActive) return 'Paused — discovery running';
  if (executionPaused && pauseReason) return `Paused — ${pauseReason}`;
  return null;
}

async function prepareForDiscovery() {
  discoveryActive = true;
  executionPaused = true;
  pauseReason = 'discovery running';
  busState = BUS_STATE.PAUSED;

  lazyPointPollingEngine().pauseForDiscovery();
  lazyFieldExecutionEngine().pauseForDiscovery();

  log('info', 'Polling paused because discovery started');
  log('info', 'Execution paused because discovery is active');

  await lazyFieldExecutionEngine().waitForIdleOrCancel(30000);
}

function resumeAfterDiscovery() {
  discoveryActive = false;
  executionPaused = false;
  pauseReason = null;

  if (busOwner === BUS_OWNER.DISCOVERY) {
    busOwner = null;
  }
  busState = BUS_STATE.IDLE;

  lazyPointPollingEngine().resumeFromDiscovery();
  lazyFieldExecutionEngine().resumeFromDiscovery();

  log('info', 'Discovery completed; execution resumed');
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
