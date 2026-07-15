const managedDevices = require('./managedDevices');
const discoveredStore = require('./discoveredPointsStore');
const pointsStore = require('./managedPointsStore');
const {
  pointKey,
  formatStatusFlags,
  parsePointKeyInput,
  sanitizePointTextFields,
} = require('./pointHelpers');
const pointCache = require('../execution/pointCache');
const { createPollDefaults, isValidPollGroup, getPollIntervalMs } = require('../execution/pollConfig');
const { BACNET_PROPERTIES } = require('../bacnet/bacnetApduCodec');
const pointDiscovery = require('./pointDiscovery');

function getManagedPointKeys(managedDeviceId) {
  return new Set(
    pointsStore.loadPoints()
      .filter((point) => point.managedDeviceId === managedDeviceId)
      .map((point) => pointKey(managedDeviceId, point.objectType, point.objectInstance)),
  );
}

function normalizePointForApi(point) {
  const device = managedDevices.getManagedDeviceById(point.managedDeviceId)?.device;
  const enriched = pointCache.enrichPointForApi(point, device?.deviceQuality);
  return {
    ...sanitizePointTextFields(enriched),
    status: formatStatusFlags(point.statusFlags),
    pollIntervalMs: getPollIntervalMs(point.pollGroup, point.pollIntervalMs),
  };
}

function getManagedDeviceRecord(managedDeviceId) {
  const result = managedDevices.getManagedDeviceById(managedDeviceId);
  return result?.device || null;
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

function findDiscoveredPoint(managedDeviceId, objectType, objectInstance) {
  const record = discoveredStore.getRecordForDevice(managedDeviceId);
  return (record?.points || []).find(
    (point) => point.objectType === objectType && point.objectInstance === objectInstance,
  ) || null;
}

function createManagedPointFromDiscovered(managedDeviceId, discovered, now) {
  const id = pointsStore.generatePointId(managedDeviceId, discovered.objectType, discovered.objectInstance);
  const pollDefaults = createPollDefaults(discovered.objectType);
  const cacheFields = pointCache.createCacheFields({
    ...pollDefaults,
    presentValue: discovered.presentValue,
    lastReadAt: discovered.lastReadAt || now,
    lastSuccessfulReadAt: discovered.lastReadAt || null,
  });

  return {
    id,
    managedDeviceId,
    objectType: discovered.objectType,
    objectTypeLabel: discovered.objectTypeLabel,
    objectInstance: discovered.objectInstance,
    objectName: discovered.objectName ?? null,
    description: discovered.description ?? null,
    presentValue: discovered.presentValue ?? null,
    units: discovered.units ?? null,
    reliability: discovered.reliability ?? null,
    statusFlags: discovered.statusFlags ?? null,
    outOfService: discovered.outOfService ?? null,
    discoveredAt: discovered.discoveredAt || now,
    managedAt: now,
    lastReadAt: discovered.lastReadAt || now,
    ...cacheFields,
  };
}

function managePoints(managedDeviceId, pointKeysInput = []) {
  const device = getManagedDeviceRecord(managedDeviceId);
  if (!device) {
    const error = new Error('Managed device not found');
    error.statusCode = 404;
    throw error;
  }

  const keys = Array.isArray(pointKeysInput) ? pointKeysInput : [];
  if (keys.length === 0) {
    const error = new Error('pointKeys array is required');
    error.statusCode = 400;
    throw error;
  }

  const now = new Date().toISOString();
  const allPoints = pointsStore.loadPoints();
  const existingKeys = getManagedPointKeys(managedDeviceId);
  const added = [];
  const skipped = [];

  for (const rawKey of keys) {
    const parsed = parsePointKeyInput(managedDeviceId, rawKey);
    if (!parsed) {
      skipped.push({ pointKey: rawKey, reason: 'invalid_key' });
      continue;
    }

    const key = pointKey(managedDeviceId, parsed.objectType, parsed.objectInstance);
    if (existingKeys.has(key)) {
      skipped.push({ pointKey: key, reason: 'already_managed' });
      continue;
    }

    const discovered = findDiscoveredPoint(managedDeviceId, parsed.objectType, parsed.objectInstance);
    if (!discovered) {
      skipped.push({ pointKey: key, reason: 'not_discovered' });
      continue;
    }

    const nextPoint = createManagedPointFromDiscovered(managedDeviceId, discovered, now);
    allPoints.push(nextPoint);
    existingKeys.add(key);
    added.push(normalizePointForApi(nextPoint));
  }

  if (added.length > 0) {
    pointsStore.savePoints(allPoints);
  }

  return {
    success: true,
    managedDeviceId,
    added,
    addedCount: added.length,
    skipped,
    skippedCount: skipped.length,
    points: listPointsByManagedDeviceId(managedDeviceId).points,
  };
}

function unmanagePoint(managedDeviceId, pointId) {
  const device = getManagedDeviceRecord(managedDeviceId);
  if (!device) return null;

  const allPoints = pointsStore.loadPoints();
  const index = allPoints.findIndex(
    (point) => point.id === pointId && point.managedDeviceId === managedDeviceId,
  );
  if (index < 0) return null;

  const [removed] = allPoints.splice(index, 1);
  pointsStore.savePoints(allPoints);

  return {
    success: true,
    managedDeviceId,
    removed: normalizePointForApi(removed),
    points: listPointsByManagedDeviceId(managedDeviceId).points,
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
    points: [],
  };
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
  // Lazy require breaks circular dependency with fieldExecutionEngine.
  // eslint-disable-next-line global-require
  const fieldExecutionEngine = require('../execution/fieldExecutionEngine');

  const device = pointDiscovery.validateManagedDeviceForPointDiscovery(getManagedDeviceRecord(managedDeviceId));
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
  pointKey,
  getManagedPointKeys,
  formatStatusFlags,
  listPointsByManagedDeviceId,
  managePoints,
  unmanagePoint,
  clearPointsForManagedDevice,
  normalizePointForApi,
  updatePointPollingConfig,
  refreshPoint,
};
