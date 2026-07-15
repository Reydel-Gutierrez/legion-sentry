const jobsStore = require('./executionJobsStore');
const pointDiscovery = require('../devices/pointDiscovery');
const managedDevices = require('../devices/managedDevices');
const bacnetMstpService = require('../bacnet/bacnetMstp.service');
const mstpBusCoordinator = require('./mstpBusCoordinator');
const { BACNET_PROPERTIES } = require('../bacnet/bacnetApduCodec');

const JOB_TYPES = Object.freeze({
  READ_PROPERTY: 'read_property',
  DISCOVER_POINTS: 'discover_points',
  WRITE_PROPERTY: 'write_property',
});

const JOB_STATUS = Object.freeze({
  QUEUED: 'queued',
  WAITING_TOKEN: 'waiting_token',
  EXECUTING: 'executing',
  RETRYING: 'retrying',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
});

const TERMINAL_STATUSES = new Set([
  JOB_STATUS.COMPLETED,
  JOB_STATUS.FAILED,
  JOB_STATUS.CANCELLED,
]);

const SOURCE_PRIORITY = {
  ui: 60,
  'legion-server': 55,
  'point-discovery': 70,
  'device-health': 45,
  polling: 10,
};

const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_TIMEOUT_MS = 120000;
const DEFAULT_POINT_TIMEOUT_MS = DEFAULT_TIMEOUT_MS;
const WORKER_INTERVAL_MS = 100;
const JOB_WAIT_POLL_MS = 250;
const MAX_JOBS_RETAINED = 500;
const MAX_POLLING_JOBS_RETAINED = 100;
const JOB_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const POLLING_JOB_MAX_AGE_MS = 60 * 60 * 1000;
const FAILED_JOB_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
const QUEUE_WARN_THRESHOLD = 50;
const GLOBAL_QUEUE_LIMIT = 50;
const ACTIVE_JOB_WAIT_MS = 30000;
const MAX_FAILED_JOBS_RETAINED = 50;
const MAX_COMPLETED_JOBS_RETAINED = 100;
const POLLING_JOB_MAX_QUEUE_AGE_MS = 60 * 1000;

let activeJobId = null;
let workerTimer = null;
let workerRunning = false;
let executionPaused = false;
const cancelFlags = new Map();
const queueStats = {
  dropped: 0,
  coalesced: 0,
  failed: 0,
  expiredDiscarded: 0,
};

function lazyPointPollingEngine() {
  // eslint-disable-next-line global-require
  return require('./pointPollingEngine');
}

function lazyDeviceHealthPoller() {
  // eslint-disable-next-line global-require
  return require('./deviceHealthPoller');
}

function lazyPointCache() {
  // eslint-disable-next-line global-require
  return require('./pointCache');
}

function isActiveStatus(status) {
  return [JOB_STATUS.WAITING_TOKEN, JOB_STATUS.EXECUTING, JOB_STATUS.RETRYING].includes(status);
}

function trimJobs(jobs) {
  const now = Date.now();
  const active = jobs.filter((job) => !isTerminalStatus(job.status) || job.id === activeJobId);

  const terminal = jobs.filter((job) => isTerminalStatus(job.status) && job.id !== activeJobId);
  const recentTerminal = terminal.filter((job) => {
    const stamp = job.completedAt || job.cancelledAt || job.createdAt;
    if (!stamp) return true;
    const age = now - new Date(stamp).getTime();
    if (job.source === 'polling') return age < POLLING_JOB_MAX_AGE_MS;
    if (job.status === JOB_STATUS.FAILED) return age < FAILED_JOB_MAX_AGE_MS;
    return age < JOB_MAX_AGE_MS;
  });

  let combined = [...active, ...recentTerminal];
  combined.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const pollingTerminal = combined.filter((job) => job.source === 'polling' && isTerminalStatus(job.status));
  const failedTerminal = combined.filter((job) => job.status === JOB_STATUS.FAILED);
  const completedTerminal = combined.filter((job) => job.status === JOB_STATUS.COMPLETED && job.source !== 'polling');
  const other = combined.filter((job) => {
    if (!isTerminalStatus(job.status)) return true;
    if (job.source === 'polling' && isTerminalStatus(job.status)) return false;
    if (job.status === JOB_STATUS.FAILED) return false;
    if (job.status === JOB_STATUS.COMPLETED && job.source !== 'polling') return false;
    return true;
  });

  const keptPolling = pollingTerminal.slice(0, MAX_POLLING_JOBS_RETAINED);
  const keptFailed = failedTerminal.slice(0, MAX_FAILED_JOBS_RETAINED);
  const keptCompleted = completedTerminal.slice(0, MAX_COMPLETED_JOBS_RETAINED);

  combined = [...other, ...keptPolling, ...keptFailed, ...keptCompleted];
  combined.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  if (combined.length > MAX_JOBS_RETAINED) {
    const keepIds = new Set(combined.slice(0, MAX_JOBS_RETAINED).map((job) => job.id));
    combined = combined.filter((job) => keepIds.has(job.id) || !isTerminalStatus(job.status));
  }

  return combined;
}

function saveJobsTrimmed(jobs) {
  jobsStore.saveJobs(trimJobs(jobs));
}

function createCancellationError() {
  const error = new Error('Job cancelled');
  error.code = 'JOB_CANCELLED';
  return error;
}

function isTerminalStatus(status) {
  return TERMINAL_STATUSES.has(status);
}

function normalizePriority(source, priority) {
  if (Number.isFinite(priority)) return priority;
  return SOURCE_PRIORITY[source] ?? 20;
}

function persistJob(job) {
  const jobs = jobsStore.loadJobs();
  const index = jobs.findIndex((entry) => entry.id === job.id);
  if (index >= 0) {
    jobs[index] = job;
  } else {
    jobs.push(job);
  }
  saveJobsTrimmed(jobs);
  return job;
}

function updateJob(id, patch) {
  const jobs = jobsStore.loadJobs();
  const index = jobs.findIndex((job) => job.id === id);
  if (index < 0) return null;
  const next = { ...jobs[index], ...patch };
  jobs[index] = next;
  saveJobsTrimmed(jobs);
  return next;
}

function readJobRecord(id) {
  return jobsStore.loadJobs().find((job) => job.id === id) || null;
}

function countPollingPendingJobs() {
  return jobsStore.loadJobs().filter((job) => job.source === 'polling'
    && (job.status === JOB_STATUS.QUEUED
      || isActiveStatus(job.status))).length;
}

function countQueuedJobs() {
  return jobsStore.loadJobs().filter((job) => job.status === JOB_STATUS.QUEUED).length;
}

function isQueueFull() {
  return countQueuedJobs() >= GLOBAL_QUEUE_LIMIT;
}

function pauseForDiscovery() {
  executionPaused = true;
}

function resumeFromDiscovery() {
  executionPaused = false;
}

function isExecutionPaused() {
  return executionPaused || mstpBusCoordinator.isExecutionPaused();
}

function delay(ms) {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

async function waitForIdleOrCancel(timeoutMs = ACTIVE_JOB_WAIT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (activeJobId && Date.now() < deadline) {
    // eslint-disable-next-line no-await-in-loop
    await delay(250);
  }
  if (activeJobId) {
    cancelJob(activeJobId);
    const waitDeadline = Date.now() + 5000;
    while (activeJobId && Date.now() < waitDeadline) {
      // eslint-disable-next-line no-await-in-loop
      await delay(250);
    }
  }
}

function sortQueuedJobs(jobs) {
  return jobs
    .filter((job) => job.status === JOB_STATUS.QUEUED)
    .sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });
}

function summarizeJobs(jobs) {
  const counts = {
    queued: 0,
    active: 0,
    completed: 0,
    failed: 0,
    cancelled: 0,
  };

  for (const job of jobs) {
    if (job.status === JOB_STATUS.QUEUED) counts.queued += 1;
    else if ([JOB_STATUS.WAITING_TOKEN, JOB_STATUS.EXECUTING, JOB_STATUS.RETRYING].includes(job.status)) {
      counts.active += 1;
    } else if (job.status === JOB_STATUS.COMPLETED) counts.completed += 1;
    else if (job.status === JOB_STATUS.FAILED) counts.failed += 1;
    else if (job.status === JOB_STATUS.CANCELLED) counts.cancelled += 1;
  }

  return counts;
}

const BACKGROUND_SOURCES = new Set(['polling', 'device-health']);

function isFieldOperationJob(job) {
  if (BACKGROUND_SOURCES.has(job.source)) return false;
  if (job.type === JOB_TYPES.DISCOVER_POINTS) return true;
  if (job.type === JOB_TYPES.WRITE_PROPERTY) return true;
  if (job.type === JOB_TYPES.READ_PROPERTY && job.source === 'ui') return true;
  return false;
}

function summarizeBackgroundActivity(jobs) {
  const pollingJobs = jobs.filter((job) => job.source === 'polling');
  const healthJobs = jobs.filter((job) => job.source === 'device-health');
  const activePolling = pollingJobs.filter((job) => isActiveStatus(job.status));
  const queuedPolling = pollingJobs.filter((job) => job.status === JOB_STATUS.QUEUED);
  const activeHealth = healthJobs.filter((job) => isActiveStatus(job.status));
  const queuedHealth = healthJobs.filter((job) => job.status === JOB_STATUS.QUEUED);

  return {
    polling: {
      queued: queuedPolling.length,
      active: activePolling.length,
      activeJob: activePolling[0] ? enrichJobForApi(activePolling[0]) : null,
    },
    deviceHealth: {
      queued: queuedHealth.length,
      active: activeHealth.length,
      activeJob: activeHealth[0] ? enrichJobForApi(activeHealth[0]) : null,
    },
    totalQueued: queuedPolling.length + queuedHealth.length,
    totalActive: activePolling.length + activeHealth.length,
  };
}

function summarizeFieldOperations(jobs) {
  const fieldJobs = jobs.filter(isFieldOperationJob);
  const counts = summarizeJobs(fieldJobs);
  const oneHourAgo = Date.now() - 60 * 60 * 1000;
  const recent = fieldJobs
    .filter((job) => {
      if (!isTerminalStatus(job.status)) return true;
      if (job.status === JOB_STATUS.FAILED) return true;
      if (job.status === JOB_STATUS.COMPLETED) {
        const stamp = job.completedAt || job.createdAt;
        return stamp && new Date(stamp).getTime() >= oneHourAgo;
      }
      return false;
    })
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 50)
    .map(enrichJobForApi);

  return { counts, recent };
}

function enrichJobForApi(job) {
  const device = job.managedDeviceId
    ? managedDevices.getManagedDeviceById(job.managedDeviceId)?.device
    : null;
  return {
    ...job,
    deviceLabel: device
      ? `MAC ${device.mstpMacAddress} (${device.deviceInstance})`
      : null,
  };
}

function shouldCancelJob(id) {
  return Boolean(cancelFlags.get(id));
}

function getCurrentRuntimeGeneration() {
  try {
    return bacnetMstpService.getRuntimeGeneration?.() ?? 0;
  } catch {
    return 0;
  }
}

function isStaleGeneration(job) {
  if (job.runtimeGeneration == null) return false;
  return job.runtimeGeneration !== getCurrentRuntimeGeneration();
}

function discardStaleJobResult(job, outcome) {
  console.warn(
    `[field-execution] Discarding stale ${outcome} for job ${job.id} `
    + `(job gen=${job.runtimeGeneration}, runtime gen=${getCurrentRuntimeGeneration()})`,
  );
}

function findCoalescableJob({ type, source, managedPointId, managedDeviceId }) {
  const jobs = jobsStore.loadJobs();
  return jobs.find((job) => {
    if (job.status !== JOB_STATUS.QUEUED) return false;
    if (job.type !== type || job.source !== source) return false;
    if (managedPointId && job.managedPointId === managedPointId) return true;
    if (!managedPointId && managedDeviceId && job.managedDeviceId === managedDeviceId
      && source === 'device-health') {
      return true;
    }
    return false;
  }) || null;
}

function createJob(payload = {}) {
  const {
    type,
    source = 'ui',
    priority,
    managedDeviceId = null,
    managedPointId = null,
    request = {},
    maxRetries = DEFAULT_MAX_RETRIES,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = payload;

  if (!type || !Object.values(JOB_TYPES).includes(type)) {
    const error = new Error(`Invalid job type: ${type}`);
    error.statusCode = 400;
    throw error;
  }

  if (type === JOB_TYPES.WRITE_PROPERTY) {
    const error = new Error('WriteProperty is not implemented');
    error.statusCode = 501;
    error.code = 'WRITE_NOT_IMPLEMENTED';
    throw error;
  }

  if (BACKGROUND_SOURCES.has(source) && isExecutionPaused()) {
    queueStats.dropped += 1;
    const error = new Error('Background job deferred — MS/TP bus paused for discovery');
    error.statusCode = 409;
    error.code = 'BUS_PAUSED_DISCOVERY';
    throw error;
  }

  // Do not accept background work while runtime is stopped/faulted/recovering
  try {
    const runtime = bacnetMstpService.getRuntimeSnapshot?.();
    const state = runtime?.state;
    if (BACKGROUND_SOURCES.has(source) && state && !['active', 'busy', 'listening', 'joining', 'degraded'].includes(state)) {
      queueStats.dropped += 1;
      const error = new Error(`Background job deferred — runtime state is ${state}`);
      error.statusCode = 409;
      error.code = 'RUNTIME_NOT_READY';
      throw error;
    }
  } catch (err) {
    if (err.code === 'RUNTIME_NOT_READY') throw err;
  }

  // Coalesce duplicate background reads / health checks
  if (BACKGROUND_SOURCES.has(source)) {
    const existing = findCoalescableJob({ type, source, managedPointId, managedDeviceId });
    if (existing) {
      queueStats.coalesced += 1;
      return enrichJobForApi(existing);
    }
  }

  if (BACKGROUND_SOURCES.has(source) && isQueueFull()) {
    queueStats.dropped += 1;
    const error = new Error('Execution queue is full — background job dropped');
    error.statusCode = 429;
    error.code = 'QUEUE_FULL';
    throw error;
  }

  if (!BACKGROUND_SOURCES.has(source) && countQueuedJobs() >= GLOBAL_QUEUE_LIMIT * 2) {
    queueStats.dropped += 1;
    const error = new Error('Execution queue is full');
    error.statusCode = 429;
    error.code = 'QUEUE_FULL';
    throw error;
  }

  const now = new Date().toISOString();
  const job = {
    id: jobsStore.generateJobId(),
    type,
    source,
    status: JOB_STATUS.QUEUED,
    priority: normalizePriority(source, priority),
    progress: 0,
    progressMessage: 'Queued',
    managedDeviceId,
    managedPointId,
    request,
    result: null,
    error: null,
    attempts: 0,
    maxRetries,
    timeoutMs,
    runtimeGeneration: getCurrentRuntimeGeneration(),
    createdAt: now,
    startedAt: null,
    completedAt: null,
    cancelledAt: null,
  };

  persistJob(job);
  scheduleWorker();
  return enrichJobForApi(job);
}

function getQueueSummary() {
  const jobs = jobsStore.loadJobs();
  const queued = jobs.filter((job) => job.status === JOB_STATUS.QUEUED);
  const byType = {};
  for (const job of queued) {
    const key = `${job.source}:${job.type}`;
    byType[key] = (byType[key] || 0) + 1;
  }
  const oldest = queued
    .slice()
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())[0] || null;
  const oldestAgeMs = oldest ? Math.max(0, Date.now() - new Date(oldest.createdAt).getTime()) : 0;
  const activeJob = activeJobId ? getJobById(activeJobId) : null;

  return {
    activeOperation: activeJob
      ? {
        id: activeJob.id,
        type: activeJob.type,
        source: activeJob.source,
        managedDeviceId: activeJob.managedDeviceId,
        managedPointId: activeJob.managedPointId,
        status: activeJob.status,
      }
      : null,
    queueDepth: queued.length,
    oldestJobAgeMs: oldestAgeMs,
    oldestJobId: oldest?.id || null,
    jobsByType: byType,
    droppedJobs: queueStats.dropped,
    coalescedJobs: queueStats.coalesced,
    failedJobs: queueStats.failed,
    expiredDiscarded: queueStats.expiredDiscarded,
    globalLimit: GLOBAL_QUEUE_LIMIT,
  };
}

function getJobs(filters = {}) {
  let jobs = jobsStore.loadJobs();
  if (filters.status) {
    jobs = jobs.filter((job) => job.status === filters.status);
  }
  if (filters.type) {
    jobs = jobs.filter((job) => job.type === filters.type);
  }
  if (filters.managedDeviceId) {
    jobs = jobs.filter((job) => job.managedDeviceId === filters.managedDeviceId);
  }
  jobs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return jobs.map(enrichJobForApi);
}

function getJobById(id) {
  const job = readJobRecord(id);
  return job ? enrichJobForApi(job) : null;
}

function cancelJob(id) {
  const job = readJobRecord(id);
  if (!job) return null;

  if (isTerminalStatus(job.status)) {
    return enrichJobForApi(job);
  }

  cancelFlags.set(id, true);

  if (job.status === JOB_STATUS.QUEUED) {
    const now = new Date().toISOString();
    const cancelled = updateJob(id, {
      status: JOB_STATUS.CANCELLED,
      progressMessage: 'Cancelled',
      cancelledAt: now,
      completedAt: now,
    });
    cancelFlags.delete(id);
    return enrichJobForApi(cancelled);
  }

  updateJob(id, { progressMessage: 'Cancellation requested' });
  return enrichJobForApi(readJobRecord(id));
}

function clearCompletedJobs() {
  const jobs = jobsStore.loadJobs();
  const remaining = jobs.filter((job) => job.status !== JOB_STATUS.COMPLETED);
  const removed = jobs.length - remaining.length;
  saveJobsTrimmed(remaining);
  return { removed, remaining: remaining.length };
}

function clearFailedJobs() {
  const jobs = jobsStore.loadJobs();
  const remaining = jobs.filter((job) => job.status !== JOB_STATUS.FAILED);
  const removed = jobs.length - remaining.length;
  saveJobsTrimmed(remaining);
  return { removed, remaining: remaining.length };
}

function cancelQueuedJobs() {
  const jobs = jobsStore.loadJobs();
  let cancelled = 0;
  for (const job of jobs) {
    if (job.status === JOB_STATUS.QUEUED) {
      cancelJob(job.id);
      cancelled += 1;
    }
  }
  return { cancelled };
}

function cancelQueuedPollingJobs() {
  const jobs = jobsStore.loadJobs();
  let cancelled = 0;
  for (const job of jobs) {
    if (job.source === 'polling' && job.status === JOB_STATUS.QUEUED) {
      cancelJob(job.id);
      cancelled += 1;
    }
  }
  return { cancelled };
}

function cancelQueuedDeviceHealthJobs() {
  const jobs = jobsStore.loadJobs();
  let cancelled = 0;
  for (const job of jobs) {
    if (job.source === 'device-health' && job.status === JOB_STATUS.QUEUED) {
      cancelJob(job.id);
      cancelled += 1;
    }
  }
  return { cancelled };
}

function getExecutionStatus() {
  const jobs = jobsStore.loadJobs();
  const counts = summarizeJobs(jobs);
  const fieldOps = summarizeFieldOperations(jobs);
  const background = summarizeBackgroundActivity(jobs);
  const activeJob = activeJobId ? getJobById(activeJobId) : null;
  const queuedNext = sortQueuedJobs(jobs)[0] || null;
  const pollingQueued = countPollingPendingJobs();
  const coordinator = mstpBusCoordinator.getCoordinatorStatus();
  const polling = lazyPointPollingEngine().getStatus();
  const deviceHealth = lazyDeviceHealthPoller().getStatus();
  const backgroundServices = mstpBusCoordinator.getBackgroundStatus();
  const paused = isExecutionPaused();
  const queueOverLimit = counts.queued >= QUEUE_WARN_THRESHOLD
    || pollingQueued >= QUEUE_WARN_THRESHOLD;

  return {
    running: Boolean(activeJobId),
    activeJobId,
    activeJob,
    queuedJobs: counts.queued,
    activeJobs: counts.active,
    completedJobs: counts.completed,
    failedJobs: counts.failed,
    cancelledJobs: counts.cancelled,
    fieldOperations: fieldOps.counts,
    fieldOperationJobs: fieldOps.recent,
    backgroundActivity: background,
    pollingQueuedJobs: pollingQueued,
    nextQueuedJobId: queuedNext?.id || null,
    workerIntervalMs: WORKER_INTERVAL_MS,
    executionPaused: paused,
    pauseMessage: paused
      ? (coordinator.pauseMessage || 'Background polling and device health paused for discovery')
      : null,
    bus: coordinator,
    polling,
    deviceHealth,
    backgroundServices,
    pointQualityCounts: polling.pointQualityCounts || {},
    queueHealth: {
      queued: counts.queued,
      pollingQueued,
      failed: counts.failed,
      warnThreshold: QUEUE_WARN_THRESHOLD,
      globalLimit: GLOBAL_QUEUE_LIMIT,
      overLimit: queueOverLimit,
      warning: queueOverLimit
        ? `Queue has ${counts.queued} queued job(s); polling may be throttled`
        : null,
    },
  };
}

function hasPendingJobForPoint(managedPointId) {
  return jobsStore.loadJobs().some((job) => job.managedPointId === managedPointId
    && !isTerminalStatus(job.status));
}

function hasPendingJobForDevice(managedDeviceId, source) {
  return jobsStore.loadJobs().some((job) => job.managedDeviceId === managedDeviceId
    && job.source === source
    && !isTerminalStatus(job.status));
}

function hasPendingPointDiscovery(managedDeviceId) {
  return jobsStore.loadJobs().some((job) => job.type === JOB_TYPES.DISCOVER_POINTS
    && job.managedDeviceId === managedDeviceId
    && !isTerminalStatus(job.status));
}

function getDeviceQuality(managedDeviceId) {
  const device = managedDevices.getManagedDeviceById(managedDeviceId)?.device;
  return device?.deviceQuality || 'unknown';
}

function cancelQueuedBackgroundJobs(reason = 'background_cancel') {
  const polling = cancelQueuedPollingJobs();
  const health = cancelQueuedDeviceHealthJobs();
  return {
    cancelled: polling.cancelled + health.cancelled,
    polling: polling.cancelled,
    health: health.cancelled,
    reason,
  };
}

function applyReadResult(job, result) {
  if (isStaleGeneration(job)) {
    discardStaleJobResult(job, 'success');
    return;
  }

  if (job.source === 'device-health' && job.managedDeviceId) {
    lazyDeviceHealthPoller().recordHeartbeatSuccess(job.managedDeviceId, {
      responseTimeMs: result?.durationMs,
    });
    return;
  }

  if (!job.managedPointId) return;

  const deviceQuality = getDeviceQuality(job.managedDeviceId);
  if (job.source === 'polling' || job.source === 'ui' || job.source === 'legion-server') {
    lazyPointCache().applyReadSuccess(job.managedPointId, result.value, {
      deviceQuality,
      scheduleNext: job.source === 'polling',
      rawValue: result.raw,
    });
  }
}

function applyReadFailure(job, errorMessage) {
  if (isStaleGeneration(job)) {
    discardStaleJobResult(job, 'failure');
    return;
  }

  if (mstpBusCoordinator.isDiscoveryActive()) {
    return;
  }

  if (job.source === 'device-health' && job.managedDeviceId) {
    lazyDeviceHealthPoller().recordHeartbeatFailure(job.managedDeviceId, errorMessage);
    return;
  }

  if (!job.managedPointId) return;

  const deviceQuality = getDeviceQuality(job.managedDeviceId);
  if (job.source === 'polling' || job.source === 'ui') {
    lazyPointCache().applyReadFailure(job.managedPointId, errorMessage, { deviceQuality });
  }
}

async function executeReadProperty(job) {
  const {
    managedDeviceId,
    objectType,
    objectInstance,
    propertyIdentifier,
    fallbackPropertyIdentifier,
  } = job.request;

  if (!managedDeviceId || objectType == null || objectInstance == null || propertyIdentifier == null) {
    const error = new Error('read_property request requires managedDeviceId, objectType, objectInstance, and propertyIdentifier');
    error.statusCode = 400;
    throw error;
  }

  const device = managedDevices.getManagedDeviceById(managedDeviceId)?.device;
  if (!device) {
    const error = new Error('Managed device not found');
    error.statusCode = 404;
    throw error;
  }

  updateJob(job.id, {
    status: JOB_STATUS.EXECUTING,
    progress: 10,
    progressMessage: 'Preparing BACnet read',
  });

  if (shouldCancelJob(job.id)) throw createCancellationError();

  updateJob(job.id, {
    status: JOB_STATUS.WAITING_TOKEN,
    progress: 25,
    progressMessage: 'Waiting for MS/TP token',
  });

  const onTokenWait = () => {
    updateJob(job.id, {
      status: JOB_STATUS.WAITING_TOKEN,
      progressMessage: 'Waiting for MS/TP token',
    });
  };

  const onExecuting = (message) => {
    updateJob(job.id, {
      status: JOB_STATUS.EXECUTING,
      progress: 60,
      progressMessage: message || 'Reading property',
    });
  };

  const readOnce = async (propId) => bacnetMstpService.readPropertyForDevice({
    managedDevice: device,
    objectType,
    objectInstance,
    propertyIdentifier: propId,
    shouldCancel: () => shouldCancelJob(job.id),
    onTokenWait,
    onExecuting,
  });

  try {
    const result = await readOnce(propertyIdentifier);
    updateJob(job.id, { progress: 100, progressMessage: 'Read complete' });
    return result;
  } catch (primaryErr) {
    if (!fallbackPropertyIdentifier || fallbackPropertyIdentifier === propertyIdentifier) {
      throw primaryErr;
    }
    updateJob(job.id, {
      progress: 50,
      progressMessage: 'Retrying with fallback property',
    });
    const result = await readOnce(fallbackPropertyIdentifier);
    updateJob(job.id, { progress: 100, progressMessage: 'Read complete (fallback)' });
    return result;
  }
}

async function executeDiscoverPoints(job) {
  const managedDeviceId = job.managedDeviceId || job.request?.managedDeviceId;
  if (!managedDeviceId) {
    const error = new Error('discover_points job requires managedDeviceId');
    error.statusCode = 400;
    throw error;
  }

  updateJob(job.id, {
    status: JOB_STATUS.EXECUTING,
    progress: 0,
    progressMessage: 'Starting point discovery',
  });

  const onProgress = (progress, progressMessage) => {
    const status = progressMessage?.toLowerCase().includes('token')
      ? JOB_STATUS.WAITING_TOKEN
      : JOB_STATUS.EXECUTING;
    updateJob(job.id, { progress, progressMessage, status });
  };

  const result = await pointDiscovery.discoverPointsForDevice({
    managedDeviceId,
    requestId: job.request?.requestId,
    onProgress,
    shouldCancel: () => shouldCancelJob(job.id),
  });

  updateJob(job.id, { progress: 100, progressMessage: 'Discovery complete' });
  return result;
}

async function runJobAttempt(job) {
  if (job.type === JOB_TYPES.READ_PROPERTY) {
    const result = await executeReadProperty(job);
    applyReadResult(job, result);
    return result;
  }
  if (job.type === JOB_TYPES.DISCOVER_POINTS) {
    return executeDiscoverPoints(job);
  }
  const error = new Error(`Unsupported job type: ${job.type}`);
  error.statusCode = 400;
  throw error;
}

async function processActiveJob(job) {
  const busOwner = mstpBusCoordinator.ownerForJobType(job.type);
  mstpBusCoordinator.acquireBus(busOwner);

  const startedAt = new Date().toISOString();
  updateJob(job.id, {
    status: JOB_STATUS.EXECUTING,
    startedAt: job.startedAt || startedAt,
    attempts: (job.attempts || 0) + 1,
    error: null,
  });

  let lastError = null;
  const maxAttempts = Math.max(1, (job.maxRetries ?? DEFAULT_MAX_RETRIES) + 1);

  try {
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const current = readJobRecord(job.id);
      if (!current || shouldCancelJob(job.id)) {
        throw createCancellationError();
      }

      if (attempt > 1) {
        updateJob(job.id, {
          status: JOB_STATUS.RETRYING,
          progressMessage: `Retrying (${attempt - 1}/${job.maxRetries})`,
          attempts: attempt,
        });
      }

      try {
        const result = await runJobAttempt(readJobRecord(job.id));
        const completedAt = new Date().toISOString();
        cancelFlags.delete(job.id);
        return updateJob(job.id, {
          status: JOB_STATUS.COMPLETED,
          result,
          error: null,
          progress: 100,
          progressMessage: 'Completed',
          completedAt,
        });
      } catch (err) {
        lastError = err;
        if (err.code === 'JOB_CANCELLED' || shouldCancelJob(job.id)) {
          throw createCancellationError();
        }
        if (attempt < maxAttempts) {
          updateJob(job.id, {
            error: err.message,
            progressMessage: `Attempt ${attempt} failed: ${err.message}`,
          });
        } else if (err.result) {
          lastError.result = err.result;
        }
      }
    }

    throw lastError || new Error('Job failed');
  } finally {
    mstpBusCoordinator.releaseBus(busOwner);
  }
}

function discardExpiredPollingJobs() {
  const now = Date.now();
  const jobs = jobsStore.loadJobs();
  let discarded = 0;
  for (const job of jobs) {
    if (job.status !== JOB_STATUS.QUEUED) continue;
    if (job.source !== 'polling') continue;
    const age = now - new Date(job.createdAt).getTime();
    if (age <= POLLING_JOB_MAX_QUEUE_AGE_MS) continue;
    if (isStaleGeneration(job)) {
      // also discard stale-generation queued polling
    }
    updateJob(job.id, {
      status: JOB_STATUS.CANCELLED,
      progressMessage: 'Expired polling interval discarded',
      cancelledAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    });
    discarded += 1;
  }
  if (discarded > 0) {
    queueStats.expiredDiscarded += discarded;
  }
  return discarded;
}

async function workerTick() {
  if (workerRunning || activeJobId) return;
  if (!mstpBusCoordinator.canStartExecutionJob()) return;

  discardExpiredPollingJobs();

  const next = sortQueuedJobs(jobsStore.loadJobs()).find((job) => {
    if (isStaleGeneration(job) && BACKGROUND_SOURCES.has(job.source)) {
      updateJob(job.id, {
        status: JOB_STATUS.CANCELLED,
        progressMessage: 'Cancelled — stale runtime generation',
        cancelledAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      });
      queueStats.expiredDiscarded += 1;
      return false;
    }
    return true;
  });
  if (!next) return;

  if (mstpBusCoordinator.isDiscoveryActive() && BACKGROUND_SOURCES.has(next.source)) {
    return;
  }

  workerRunning = true;
  activeJobId = next.id;

  try {
    await processActiveJob(next);
  } catch (err) {
    const now = new Date().toISOString();
    if (err.code === 'JOB_CANCELLED' || shouldCancelJob(next.id)) {
      updateJob(next.id, {
        status: JOB_STATUS.CANCELLED,
        progressMessage: 'Cancelled',
        cancelledAt: now,
        completedAt: now,
        error: null,
      });
    } else {
      const current = readJobRecord(next.id);
      applyReadFailure(next, err.message || 'Job failed');
      queueStats.failed += 1;
      updateJob(next.id, {
        status: JOB_STATUS.FAILED,
        error: err.message || 'Job failed',
        progressMessage: err.message || 'Job failed',
        completedAt: now,
        result: err.result || current?.result || null,
      });
    }
    cancelFlags.delete(next.id);
  } finally {
    activeJobId = null;
    workerRunning = false;
  }
}

function scheduleWorker() {
  if (workerTimer) return;
  workerTimer = setInterval(() => {
    workerTick().catch((err) => {
      console.error('[field-execution] worker error:', err);
    });
  }, WORKER_INTERVAL_MS);
}

function startWorker() {
  const jobs = jobsStore.loadJobs();
  saveJobsTrimmed(jobs);
  scheduleWorker();
}

function stopWorker() {
  if (workerTimer) {
    clearInterval(workerTimer);
    workerTimer = null;
  }
}

function waitForJob(id, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const poll = () => {
      const job = readJobRecord(id);
      if (!job) {
        reject(new Error('Job not found'));
        return;
      }
      if (job.status === JOB_STATUS.COMPLETED) {
        resolve(enrichJobForApi(job));
        return;
      }
      if (job.status === JOB_STATUS.FAILED) {
        const error = new Error(job.error || 'Job failed');
        error.statusCode = 502;
        error.code = 'JOB_FAILED';
        error.job = enrichJobForApi(job);
        if (job.result) error.result = job.result;
        reject(error);
        return;
      }
      if (job.status === JOB_STATUS.CANCELLED) {
        const error = new Error('Job cancelled');
        error.statusCode = 409;
        error.code = 'JOB_CANCELLED';
        error.job = enrichJobForApi(job);
        reject(error);
        return;
      }
      if (Date.now() > deadline) {
        const error = new Error(`Job timed out after ${timeoutMs}ms`);
        error.statusCode = 504;
        error.code = 'JOB_TIMEOUT';
        error.job = enrichJobForApi(job);
        reject(error);
        return;
      }
      setTimeout(poll, JOB_WAIT_POLL_MS);
    };
    poll();
  });
}

async function discoverPointsForManagedDevice(managedDeviceId, options = {}) {
  const { source = 'ui', async: runAsync = false, priority, requestId } = options;

  if (!managedDeviceId || typeof managedDeviceId !== 'string') {
    const error = new Error('managedDeviceId is required');
    error.statusCode = 400;
    error.code = 'VALIDATION_ERROR';
    throw error;
  }

  if (hasPendingPointDiscovery(managedDeviceId) || pointDiscovery.isPointDiscoveryActive(managedDeviceId)) {
    const error = new Error('Point discovery is already running for this device.');
    error.statusCode = 409;
    error.code = 'POINT_DISCOVERY_ALREADY_RUNNING';
    error.details = { managedDeviceId };
    throw error;
  }

  if (mstpBusCoordinator.isDiscoveryActive()) {
    const error = new Error('MS/TP device discovery is active — point discovery cannot start yet.');
    error.statusCode = 409;
    error.code = 'MSTP_BUS_BUSY';
    error.details = { managedDeviceId, busyWith: 'device_discovery' };
    throw error;
  }

  // Validate early so async jobs fail fast with a clear API error.
  pointDiscovery.validateManagedDeviceForPointDiscovery(
    pointDiscovery.getManagedDeviceRecord(managedDeviceId),
  );

  const job = createJob({
    type: JOB_TYPES.DISCOVER_POINTS,
    source: source === 'ui' ? 'point-discovery' : source,
    priority: priority ?? SOURCE_PRIORITY['point-discovery'],
    managedDeviceId,
    request: { managedDeviceId, requestId },
    timeoutMs: DEFAULT_TIMEOUT_MS,
  });

  if (runAsync) {
    return { success: true, jobId: job.id, job, requestId };
  }

  const completed = await waitForJob(job.id, DEFAULT_TIMEOUT_MS);
  if (completed.result) {
    return completed.result;
  }
  return completed;
}

function submitReadProperty(payload = {}) {
  return createJob({
    type: JOB_TYPES.READ_PROPERTY,
    source: payload.source || 'ui',
    priority: payload.priority,
    managedDeviceId: payload.managedDeviceId,
    managedPointId: payload.managedPointId || null,
    request: {
      managedDeviceId: payload.managedDeviceId,
      objectType: payload.objectType,
      objectInstance: payload.objectInstance,
      propertyIdentifier: payload.propertyIdentifier,
      fallbackPropertyIdentifier: payload.fallbackPropertyIdentifier,
    },
    maxRetries: payload.maxRetries,
    timeoutMs: payload.timeoutMs || DEFAULT_POINT_TIMEOUT_MS,
  });
}

function submitWriteProperty(payload = {}) {
  return createJob({
    type: JOB_TYPES.WRITE_PROPERTY,
    source: payload.source || 'ui',
    priority: payload.priority,
    managedDeviceId: payload.managedDeviceId,
    managedPointId: payload.managedPointId || null,
    request: {
      managedDeviceId: payload.managedDeviceId,
      objectType: payload.objectType,
      objectInstance: payload.objectInstance,
      propertyIdentifier: payload.propertyIdentifier,
      value: payload.value,
      priority: payload.priority,
    },
    maxRetries: payload.maxRetries ?? 0,
    timeoutMs: payload.timeoutMs || DEFAULT_POINT_TIMEOUT_MS,
  });
}

module.exports = {
  JOB_TYPES,
  JOB_STATUS,
  createJob,
  getJobs,
  getJobById,
  cancelJob,
  cancelQueuedJobs,
  cancelQueuedPollingJobs,
  cancelQueuedDeviceHealthJobs,
  cancelQueuedBackgroundJobs,
  clearCompletedJobs,
  clearFailedJobs,
  getExecutionStatus,
  startWorker,
  stopWorker,
  waitForJob,
  waitForIdleOrCancel,
  pauseForDiscovery,
  resumeFromDiscovery,
  discoverPointsForManagedDevice,
  submitReadProperty,
  submitWriteProperty,
  hasPendingJobForPoint,
  hasPendingJobForDevice,
  hasPendingPointDiscovery,
  countPollingPendingJobs,
  countQueuedJobs,
  isQueueFull,
  isStaleGeneration,
  getCurrentRuntimeGeneration,
  getQueueSummary,
  trimJobs,
  MAX_JOBS_RETAINED,
  JOB_MAX_AGE_MS,
  GLOBAL_QUEUE_LIMIT,
};
