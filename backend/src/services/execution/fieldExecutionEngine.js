const jobsStore = require('./executionJobsStore');
const managedPoints = require('../devices/managedPoints');
const managedDevices = require('../devices/managedDevices');
const pointsStore = require('../devices/managedPointsStore');
const bacnetMstpService = require('../bacnet/bacnetMstp.service');
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
  ui: 50,
  'legion-server': 40,
  polling: 10,
};

const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_TIMEOUT_MS = 120000;
const DEFAULT_POINT_TIMEOUT_MS = DEFAULT_TIMEOUT_MS;
const WORKER_INTERVAL_MS = 100;
const JOB_WAIT_POLL_MS = 250;

let activeJobId = null;
let workerTimer = null;
let workerRunning = false;
const cancelFlags = new Map();

function useMockData() {
  return process.env.MOCK_DATA === 'true';
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
  jobsStore.saveJobs(jobs);
  return job;
}

function readJobRecord(id) {
  return jobsStore.loadJobs().find((job) => job.id === id) || null;
}

function updateJob(id, patch) {
  const jobs = jobsStore.loadJobs();
  const index = jobs.findIndex((job) => job.id === id);
  if (index < 0) return null;
  const next = { ...jobs[index], ...patch };
  jobs[index] = next;
  jobsStore.saveJobs(jobs);
  return next;
}

function shouldCancelJob(id) {
  return Boolean(cancelFlags.get(id));
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
    const error = new Error('write_property jobs are not implemented yet');
    error.statusCode = 501;
    error.code = 'NOT_IMPLEMENTED';
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
    createdAt: now,
    startedAt: null,
    completedAt: null,
    cancelledAt: null,
  };

  persistJob(job);
  scheduleWorker();
  return enrichJobForApi(job);
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
  const remaining = jobs.filter((job) => !isTerminalStatus(job.status));
  const removed = jobs.length - remaining.length;
  jobsStore.saveJobs(remaining);
  return { removed, remaining: remaining.length };
}

function getExecutionStatus() {
  const jobs = jobsStore.loadJobs();
  const counts = summarizeJobs(jobs);
  const activeJob = activeJobId ? getJobById(activeJobId) : null;
  const queuedNext = sortQueuedJobs(jobs)[0] || null;

  return {
    running: Boolean(activeJobId),
    activeJobId,
    activeJob,
    queuedJobs: counts.queued,
    activeJobs: counts.active,
    completedJobs: counts.completed,
    failedJobs: counts.failed,
    cancelledJobs: counts.cancelled,
    nextQueuedJobId: queuedNext?.id || null,
    workerIntervalMs: WORKER_INTERVAL_MS,
  };
}

function hasPendingJobForPoint(managedPointId) {
  return jobsStore.loadJobs().some((job) => job.managedPointId === managedPointId
    && !isTerminalStatus(job.status));
}

function applyPollingReadResult(job, result) {
  if (job.source !== 'polling' || !job.managedPointId) return;
  const points = pointsStore.loadPoints();
  const index = points.findIndex((point) => point.id === job.managedPointId);
  if (index < 0) return;
  points[index] = {
    ...points[index],
    presentValue: result.value ?? points[index].presentValue,
    lastReadAt: result.lastReadAt || new Date().toISOString(),
  };
  pointsStore.savePoints(points);
}

async function executeReadProperty(job) {
  const {
    managedDeviceId,
    objectType,
    objectInstance,
    propertyIdentifier,
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

  if (useMockData()) {
    const now = new Date().toISOString();
    return {
      value: propertyIdentifier === BACNET_PROPERTIES.presentValue ? 72.4 : 'mock',
      raw: null,
      lastReadAt: now,
    };
  }

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

  const result = await bacnetMstpService.readPropertyForDevice({
    managedDevice: device,
    objectType,
    objectInstance,
    propertyIdentifier,
    shouldCancel: () => shouldCancelJob(job.id),
    onTokenWait,
    onExecuting,
  });

  updateJob(job.id, { progress: 100, progressMessage: 'Read complete' });
  return result;
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

  const result = await managedPoints.runPointDiscovery(managedDeviceId, {
    onProgress,
    shouldCancel: () => shouldCancelJob(job.id),
  });

  updateJob(job.id, { progress: 100, progressMessage: 'Discovery complete' });
  return result;
}

async function runJobAttempt(job) {
  if (job.type === JOB_TYPES.READ_PROPERTY) {
    const result = await executeReadProperty(job);
    applyPollingReadResult(job, result);
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
  const startedAt = new Date().toISOString();
  updateJob(job.id, {
    status: JOB_STATUS.EXECUTING,
    startedAt: job.startedAt || startedAt,
    attempts: (job.attempts || 0) + 1,
    error: null,
  });

  let lastError = null;
  const maxAttempts = Math.max(1, (job.maxRetries ?? DEFAULT_MAX_RETRIES) + 1);

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
}

async function workerTick() {
  if (workerRunning || activeJobId) return;

  const next = sortQueuedJobs(jobsStore.loadJobs())[0];
  if (!next) return;

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
  const { source = 'ui', async: runAsync = false, priority } = options;
  const job = createJob({
    type: JOB_TYPES.DISCOVER_POINTS,
    source,
    priority,
    managedDeviceId,
    request: { managedDeviceId },
    timeoutMs: DEFAULT_TIMEOUT_MS,
  });

  if (runAsync) {
    return { success: true, jobId: job.id, job };
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
    },
    maxRetries: payload.maxRetries,
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
  clearCompletedJobs,
  getExecutionStatus,
  startWorker,
  stopWorker,
  waitForJob,
  discoverPointsForManagedDevice,
  submitReadProperty,
  hasPendingJobForPoint,
};
