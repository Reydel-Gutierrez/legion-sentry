const managedDevices = require('./managedDevices');
const pointsStore = require('./managedPointsStore');
const bacnetMstpService = require('../bacnet/bacnetMstp.service');
const fieldExecutionEngine = require('../execution/fieldExecutionEngine');
const pointCache = require('../execution/pointCache');
const { createPollDefaults, isValidPollGroup, getPollIntervalMs } = require('../execution/pollConfig');
const { sanitizeText, BACNET_PROPERTIES } = require('../bacnet/bacnetApduCodec');

const MSTP_TRANSPORT = 'BACnet MS/TP';

function pointKey(managedDeviceId, objectType, objectInstance) {
  return `${managedDeviceId}:${objectType}:${objectInstance}`;
}

function normalizePointForApi(point) {
  const device = managedDevices.getManagedDeviceById(point.managedDeviceId)?.device;
  const quality = pointCache.derivePointQuality(point, device?.deviceQuality);
  return {
    ...point,
    objectName: sanitizeText(point.objectName),
    description: sanitizeText(point.description),
    status: formatStatusFlags(point.statusFlags),
    quality,
    pollIntervalMs: getPollIntervalMs(point.pollGroup, point.pollIntervalMs),
  };
}

function formatStatusFlags(statusFlags) {
  if (statusFlags == null || statusFlags === '') return '—';
  if (typeof statusFlags === 'string' && /^[01]+$/.test(statusFlags)) {
    const labels = ['in-alarm', 'fault', 'overridden', 'out-of-service'];
    const active = [];
    for (let i = 0; i < Math.min(statusFlags.length, labels.length); i += 1) {
      if (statusFlags[i] === '1') active.push(labels[i]);
    }
    return active.length ? active.join(', ') : 'ok';
  }
  return String(statusFlags);
}

function getManagedDeviceRecord(managedDeviceId) {
  const result = managedDevices.getManagedDeviceById(managedDeviceId);
  return result?.device || null;
}

function validateManagedDeviceForPointDiscovery(device) {
  if (!device) {
    const error = new Error('Managed device not found');
    error.statusCode = 404;
    throw error;
  }
  if (device.transport !== MSTP_TRANSPORT && device.transport !== 'mstp') {
    const error = new Error('Point discovery is only supported for BACnet MS/TP managed devices');
    error.statusCode = 400;
    throw error;
  }
  if (!device.enabled) {
    const error = new Error('Managed device is disabled — enable it before discovering points');
    error.statusCode = 400;
    error.code = 'DEVICE_DISABLED';
    throw error;
  }
  return device;
}

function listPointsByManagedDeviceId(managedDeviceId) {
  const points = pointsStore.loadPoints()
    .filter((point) => point.managedDeviceId === managedDeviceId)
    .map(normalizePointForApi)
    .sort((a, b) => {
      if (a.objectType !== b.objectType) return a.objectType - b.objectType;
      return a.objectInstance - b.objectInstance;
    });

  return {
    managedDeviceId,
    points,
    total: points.length,
  };
}

function clearPointsForManagedDevice(managedDeviceId) {
  const device = getManagedDeviceRecord(managedDeviceId);
  if (!device) return null;

  const allPoints = pointsStore.loadPoints();
  const remaining = allPoints.filter((point) => point.managedDeviceId !== managedDeviceId);
  const removedCount = allPoints.length - remaining.length;
  pointsStore.savePoints(remaining);

  return {
    success: true,
    managedDeviceId,
    removedCount,
  };
}

function mergeDiscoveredPoints(managedDeviceId, discoveredPoints) {
  const now = new Date().toISOString();
  const allPoints = pointsStore.loadPoints();
  const byKey = new Map(
    allPoints
      .filter((point) => point.managedDeviceId === managedDeviceId)
      .map((point) => [pointKey(managedDeviceId, point.objectType, point.objectInstance), point]),
  );

  for (const discovered of discoveredPoints) {
    const key = pointKey(managedDeviceId, discovered.objectType, discovered.objectInstance);
    const prev = byKey.get(key);
    const id = pointsStore.generatePointId(managedDeviceId, discovered.objectType, discovered.objectInstance);
    const pollDefaults = prev
      ? {}
      : createPollDefaults(discovered.objectType);
    const cacheFields = prev
      ? {
        pollGroup: prev.pollGroup,
        pollingEnabled: prev.pollingEnabled,
        pollIntervalMs: prev.pollIntervalMs,
        staleAfterMs: prev.staleAfterMs,
        nextPollAt: prev.nextPollAt,
        quality: prev.quality,
        failureCount: prev.failureCount,
        lastError: prev.lastError,
        previousValue: prev.previousValue,
        lastSuccessfulReadAt: prev.lastSuccessfulReadAt,
        lastPollAt: prev.lastPollAt,
        valueChangedAt: prev.valueChangedAt,
      }
      : pointCache.createCacheFields({
        ...pollDefaults,
        presentValue: discovered.presentValue,
        lastReadAt: discovered.lastReadAt || now,
        lastSuccessfulReadAt: discovered.lastReadAt || now,
      });

    const next = {
      id,
      managedDeviceId,
      objectType: discovered.objectType,
      objectTypeLabel: discovered.objectTypeLabel,
      objectInstance: discovered.objectInstance,
      objectName: discovered.objectName ?? prev?.objectName ?? null,
      description: discovered.description ?? prev?.description ?? null,
      presentValue: discovered.presentValue ?? prev?.presentValue ?? null,
      units: discovered.units ?? prev?.units ?? null,
      reliability: discovered.reliability ?? prev?.reliability ?? null,
      statusFlags: discovered.statusFlags ?? prev?.statusFlags ?? null,
      outOfService: discovered.outOfService ?? prev?.outOfService ?? null,
      discoveredAt: prev?.discoveredAt || discovered.discoveredAt || now,
      lastReadAt: discovered.lastReadAt || prev?.lastReadAt || now,
      ...cacheFields,
    };
    byKey.set(key, next);
  }

  const mergedForDevice = Array.from(byKey.values());
  const otherDevicePoints = allPoints.filter((point) => point.managedDeviceId !== managedDeviceId);
  pointsStore.savePoints([...otherDevicePoints, ...mergedForDevice]);

  return mergedForDevice.map(normalizePointForApi);
}

async function runPointDiscovery(managedDeviceId, hooks = {}) {
  const { onProgress, shouldCancel } = hooks;
  const report = (progress, message) => {
    if (typeof onProgress === 'function') onProgress(progress, message);
  };
  const cancelled = () => {
    if (typeof shouldCancel === 'function' && shouldCancel()) {
      const error = new Error('Job cancelled');
      error.code = 'JOB_CANCELLED';
      throw error;
    }
  };

  const device = validateManagedDeviceForPointDiscovery(getManagedDeviceRecord(managedDeviceId));
  report(0, 'Queued');

  try {
    cancelled();
    report(10, 'Reading objectList');
    const discovery = await bacnetMstpService.discoverPointsForDevice({
      managedDevice: device,
      onProgress: report,
      shouldCancel,
    });

    const points = mergeDiscoveredPoints(managedDeviceId, discovery.points || []);
    report(100, 'Discovery complete');

    return {
      ...discovery,
      points,
      pointsFound: points.length,
    };
  } catch (err) {
    if (err.code === 'JOB_CANCELLED') {
      throw err;
    }
    if (err.result) {
      const error = new Error(err.message || 'Point discovery failed');
      error.statusCode = err.statusCode || 502;
      error.code = err.code || 'POINT_DISCOVERY_FAILED';
      error.result = {
        ...err.result,
        points: listPointsByManagedDeviceId(managedDeviceId).points,
      };
      throw error;
    }
    throw err;
  }
}

async function discoverPointsForManagedDevice(managedDeviceId) {
  return runPointDiscovery(managedDeviceId);
}

function updatePointPollingConfig(managedDeviceId, pointId, patch) {
  const device = getManagedDeviceRecord(managedDeviceId);
  if (!device) return null;

  const point = pointsStore.loadPoints().find((p) => p.id === pointId && p.managedDeviceId === managedDeviceId);
  if (!point) return null;

  if (patch.pollGroup != null && !isValidPollGroup(patch.pollGroup)) {
    const error = new Error(`Invalid poll group: ${patch.pollGroup}`);
    error.statusCode = 400;
    throw error;
  }

  const updated = pointCache.updatePollConfig(pointId, patch);
  return normalizePointForApi(updated);
}

async function refreshPoint(managedDeviceId, pointId, options = {}) {
  const device = validateManagedDeviceForPointDiscovery(getManagedDeviceRecord(managedDeviceId));
  const point = pointsStore.loadPoints().find((p) => p.id === pointId && p.managedDeviceId === managedDeviceId);
  if (!point) {
    const error = new Error('Managed point not found');
    error.statusCode = 404;
    throw error;
  }

  const runAsync = options.async === true;
  const job = fieldExecutionEngine.submitReadProperty({
    source: 'ui',
    managedDeviceId: device.id,
    managedPointId: point.id,
    objectType: point.objectType,
    objectInstance: point.objectInstance,
    propertyIdentifier: BACNET_PROPERTIES.presentValue,
    maxRetries: 2,
    timeoutMs: 30000,
  });

  if (runAsync) {
    return { success: true, jobId: job.id, job };
  }

  const completed = await fieldExecutionEngine.waitForJob(job.id, 30000);
  return {
    success: true,
    point: normalizePointForApi(
      pointsStore.loadPoints().find((p) => p.id === pointId) || point,
    ),
    job: completed,
  };
}

module.exports = {
  listPointsByManagedDeviceId,
  discoverPointsForManagedDevice,
  runPointDiscovery,
  clearPointsForManagedDevice,
  normalizePointForApi,
  updatePointPollingConfig,
  refreshPoint,
};
