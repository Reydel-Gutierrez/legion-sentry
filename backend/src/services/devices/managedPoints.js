const managedDevices = require('./managedDevices');
const pointsStore = require('./managedPointsStore');
const bacnetMstpService = require('../bacnet/bacnetMstp.service');
const { sanitizeText } = require('../bacnet/bacnetApduCodec');

function useMockData() {
  return process.env.MOCK_DATA === 'true';
}
const MSTP_TRANSPORT = 'BACnet MS/TP';

function pointKey(managedDeviceId, objectType, objectInstance) {
  return `${managedDeviceId}:${objectType}:${objectInstance}`;
}

function normalizePointForApi(point) {
  return {
    ...point,
    objectName: sanitizeText(point.objectName),
    description: sanitizeText(point.description),
    status: formatStatusFlags(point.statusFlags),
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
      lastReadAt: discovered.lastReadAt || now,
    };
    byKey.set(key, next);
  }

  const mergedForDevice = Array.from(byKey.values());
  const otherDevicePoints = allPoints.filter((point) => point.managedDeviceId !== managedDeviceId);
  pointsStore.savePoints([...otherDevicePoints, ...mergedForDevice]);

  return mergedForDevice.map(normalizePointForApi);
}

function buildMockPoints(managedDeviceId) {
  const now = new Date().toISOString();
  return [
    {
      objectType: 0,
      objectTypeLabel: 'analog-input',
      objectInstance: 1,
      objectName: 'Space Temp',
      description: 'Zone temperature',
      presentValue: 72.4,
      units: 64,
      reliability: 0,
      statusFlags: '0000',
      outOfService: false,
      discoveredAt: now,
      lastReadAt: now,
    },
    {
      objectType: 3,
      objectTypeLabel: 'binary-input',
      objectInstance: 1,
      objectName: 'Occupancy',
      description: 'Occupancy input',
      presentValue: 1,
      units: null,
      reliability: 0,
      statusFlags: '0000',
      outOfService: false,
      discoveredAt: now,
      lastReadAt: now,
    },
  ].map((point) => ({
    ...point,
    id: pointsStore.generatePointId(managedDeviceId, point.objectType, point.objectInstance),
    managedDeviceId,
  }));
}

async function discoverPointsForManagedDevice(managedDeviceId) {
  const device = validateManagedDeviceForPointDiscovery(getManagedDeviceRecord(managedDeviceId));

  if (useMockData()) {
    const points = mergeDiscoveredPoints(managedDeviceId, buildMockPoints(managedDeviceId));
    return {
      success: true,
      managedDeviceId,
      deviceInstance: device.deviceInstance,
      mstpMacAddress: device.mstpMacAddress,
      pointsFound: points.length,
      points,
      failures: [],
      durationMs: 120,
      message: `Mock point discovery found ${points.length} point(s).`,
    };
  }

  try {
    const discovery = await bacnetMstpService.discoverPointsForDevice({
      managedDevice: device,
    });

    const points = mergeDiscoveredPoints(managedDeviceId, discovery.points || []);

    return {
      ...discovery,
      points,
      pointsFound: points.length,
    };
  } catch (err) {
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

module.exports = {
  listPointsByManagedDeviceId,
  discoverPointsForManagedDevice,
  clearPointsForManagedDevice,
  normalizePointForApi,
};
