const managed = require('./managed');
const inventory = require('./inventory');

const MSTP_TRANSPORT = 'BACnet MS/TP';
const MSTP_RECENT_WINDOW_MS = 2 * 60 * 1000;

let latestMstpDiscoverySessionId = null;

function setLatestMstpDiscoverySessionId(sessionId) {
  latestMstpDiscoverySessionId = sessionId;
}

function isMstpTransport(transport) {
  return transport === MSTP_TRANSPORT || transport === 'mstp';
}

function managedDeviceKey(device) {
  const mac = device.mstpMacAddress ?? device.macAddress;
  const transport = device.transport === 'mstp' ? MSTP_TRANSPORT : device.transport;
  return `${transport}:${mac}:${device.deviceInstance}`;
}

function computeMstpStatus(device) {
  const lastSeenAt = device.lastSeenAt || null;
  const seenInLatestScan = Boolean(latestMstpDiscoverySessionId)
    && device.discoverySessionId != null
    && device.discoverySessionId === latestMstpDiscoverySessionId;

  if (seenInLatestScan) {
    return { mstpStatus: 'seen_latest_scan', seenInLatestScan: true, status: 'seen_latest_scan' };
  }
  if (!lastSeenAt) {
    return { mstpStatus: 'never_confirmed', seenInLatestScan: false, status: 'never_confirmed' };
  }
  const age = Date.now() - new Date(lastSeenAt).getTime();
  if (Number.isFinite(age) && age <= MSTP_RECENT_WINDOW_MS) {
    return { mstpStatus: 'recently_seen', seenInLatestScan: false, status: 'recently_seen' };
  }
  return { mstpStatus: 'stale', seenInLatestScan: false, status: 'stale' };
}

function normalizeManagedDeviceForApi(device) {
  const { mstpStatus, seenInLatestScan, status } = computeMstpStatus(device);
  const pointSummary = lazyPointSummary(device.id);
  return {
    ...device,
    vendor: device.vendor ?? device.vendorName ?? null,
    model: device.model ?? device.modelName ?? null,
    mstpStatus,
    status,
    seenInLatestScan,
    latestDiscoverySessionId: latestMstpDiscoverySessionId,
    lastDiscoverySessionId: device.discoverySessionId ?? null,
    missedScans: device.missedScans ?? 0,
    deviceQuality: device.deviceQuality ?? 'unknown',
    lastHeartbeatAt: device.lastHeartbeatAt ?? null,
    heartbeatFailureCount: device.heartbeatFailureCount ?? 0,
    lastHeartbeatError: device.lastHeartbeatError ?? null,
    ...pointSummary,
  };
}

function lazyPointSummary(managedDeviceId) {
  try {
    // eslint-disable-next-line global-require
    const pointCache = require('../execution/pointCache');
    return pointCache.summarizeDevicePoints(managedDeviceId);
  } catch {
    return {
      managedPointCount: 0,
      onlinePoints: 0,
      stalePoints: 0,
      offlinePoints: 0,
    };
  }
}

function qualityFromHeartbeatFailures(count) {
  if (count >= 3) return 'offline';
  if (count === 2) return 'stale';
  if (count === 1) return 'degraded';
  return 'online';
}

function recordHeartbeatResult(managedDeviceId, { success, error }) {
  const managedList = managed.loadManaged();
  const index = managedList.findIndex((d) => d.id === managedDeviceId);
  if (index < 0) return null;

  const current = managedList[index];
  const now = new Date().toISOString();
  let heartbeatFailureCount = current.heartbeatFailureCount ?? 0;

  if (success) {
    heartbeatFailureCount = 0;
  } else {
    heartbeatFailureCount += 1;
  }

  const next = {
    ...current,
    lastHeartbeatAt: now,
    heartbeatFailureCount,
    deviceQuality: qualityFromHeartbeatFailures(heartbeatFailureCount),
    lastHeartbeatError: success ? null : (error || 'Heartbeat failed'),
  };

  managedList[index] = next;
  managed.saveManaged(managedList);

  return {
    success: true,
    device: normalizeManagedDeviceForApi(next),
  };
}

function buildManagedRecord(source) {
  const now = new Date().toISOString();
  const mstpMacAddress = source.mstpMacAddress ?? source.macAddress;
  const transport = isMstpTransport(source.transport) ? MSTP_TRANSPORT : source.transport;
  const deviceInstance = source.deviceInstance;

  if (deviceInstance == null || mstpMacAddress == null || !transport) {
    const error = new Error('deviceInstance, mstpMacAddress, and transport are required');
    error.statusCode = 400;
    throw error;
  }

  if (!isMstpTransport(transport)) {
    const error = new Error('Only BACnet MS/TP devices can be managed');
    error.statusCode = 400;
    throw error;
  }

  return {
    id: managed.generateManagedId(deviceInstance, mstpMacAddress),
    deviceInstance,
    mstpMacAddress,
    configuredNetworkNumber: source.configuredNetworkNumber ?? source.networkNumber ?? null,
    transport: MSTP_TRANSPORT,
    objectName: source.objectName ?? null,
    vendor: source.vendor ?? source.vendorName ?? null,
    model: source.model ?? source.modelName ?? null,
    firstSeenAt: source.firstSeenAt ?? now,
    lastSeenAt: source.lastSeenAt ?? source.lastSeen ?? now,
    managedAt: now,
    enabled: source.enabled !== false,
    discoverySessionId: source.discoverySessionId ?? null,
    missedScans: source.missedScans ?? 0,
    sourceDeviceId: source.id ?? source.sourceDeviceId ?? null,
  };
}

function findDuplicate(managedList, record) {
  const key = managedDeviceKey(record);
  return managedList.find((d) => managedDeviceKey(d) === key) || null;
}

function getManagedDevices() {
  const devices = managed.loadManaged().map(normalizeManagedDeviceForApi);
  return {
    devices,
    total: devices.length,
    enabled: devices.filter((d) => d.enabled).length,
    latestDiscoverySessionId: latestMstpDiscoverySessionId,
  };
}

function getManagedDeviceById(id) {
  const device = managed.loadManaged().find((d) => d.id === id);
  if (!device) return null;
  return { device: normalizeManagedDeviceForApi(device) };
}

function addManagedDevice(input) {
  let source = input;

  if (input.discoveredDeviceId || input.sourceDeviceId) {
    const lookupId = input.discoveredDeviceId || input.sourceDeviceId;
    const discovered = inventory.loadInventory().find((d) => d.id === lookupId);
    if (!discovered) {
      const error = new Error('Discovered device not found in inventory');
      error.statusCode = 404;
      throw error;
    }
    if (!isMstpTransport(discovered.transport)) {
      const error = new Error('Only BACnet MS/TP devices can be managed');
      error.statusCode = 400;
      throw error;
    }
    source = { ...discovered, sourceDeviceId: discovered.id };
  }

  const record = buildManagedRecord(source);
  const managedList = managed.loadManaged();
  const duplicate = findDuplicate(managedList, record);

  if (duplicate) {
    const error = new Error('Device is already managed');
    error.statusCode = 409;
    error.code = 'ALREADY_MANAGED';
    error.existingId = duplicate.id;
    throw error;
  }

  managedList.push(record);
  managed.saveManaged(managedList);

  return {
    success: true,
    device: normalizeManagedDeviceForApi(record),
  };
}

function updateManagedDevice(id, patch) {
  const managedList = managed.loadManaged();
  const index = managedList.findIndex((d) => d.id === id);
  if (index === -1) return null;

  const current = managedList[index];
  const next = { ...current };

  if (patch.enabled !== undefined) {
    next.enabled = Boolean(patch.enabled);
  }
  if (patch.objectName !== undefined) {
    next.objectName = patch.objectName;
  }

  managedList[index] = next;
  managed.saveManaged(managedList);

  return {
    success: true,
    device: normalizeManagedDeviceForApi(next),
  };
}

function unmanageDevice(id) {
  const managedList = managed.loadManaged();
  const index = managedList.findIndex((d) => d.id === id);
  if (index === -1) return null;

  const [removed] = managedList.splice(index, 1);
  managed.saveManaged(managedList);

  return {
    success: true,
    removed: normalizeManagedDeviceForApi(removed),
  };
}

function syncManagedDevicesFromInventory(inventoryDevices) {
  const managedList = managed.loadManaged();
  if (managedList.length === 0) return;

  const inventoryByKey = new Map(
    inventoryDevices
      .filter((d) => isMstpTransport(d.transport))
      .map((d) => [managedDeviceKey(d), d]),
  );

  let changed = false;

  const updated = managedList.map((managedDevice) => {
    const inv = inventoryByKey.get(managedDeviceKey(managedDevice));
    if (!inv) {
      const missedScans = (managedDevice.missedScans || 0) + 1;
      changed = true;
      return { ...managedDevice, missedScans };
    }

    changed = true;
    return {
      ...managedDevice,
      objectName: inv.objectName || managedDevice.objectName,
      vendor: inv.vendorName || inv.vendor || managedDevice.vendor,
      model: inv.modelName || inv.model || managedDevice.model,
      configuredNetworkNumber: inv.configuredNetworkNumber ?? inv.networkNumber ?? managedDevice.configuredNetworkNumber,
      firstSeenAt: managedDevice.firstSeenAt || inv.firstSeenAt,
      lastSeenAt: inv.lastSeenAt || inv.lastSeen || managedDevice.lastSeenAt,
      discoverySessionId: inv.discoverySessionId ?? managedDevice.discoverySessionId,
      missedScans: 0,
    };
  });

  if (changed) {
    managed.saveManaged(updated);
  }
}

function isDeviceManaged(deviceInstance, mstpMacAddress, transport = MSTP_TRANSPORT) {
  const key = managedDeviceKey({ deviceInstance, mstpMacAddress, transport });
  return managed.loadManaged().some((d) => managedDeviceKey(d) === key);
}

module.exports = {
  MSTP_TRANSPORT,
  setLatestMstpDiscoverySessionId,
  getManagedDevices,
  getManagedDeviceById,
  addManagedDevice,
  updateManagedDevice,
  unmanageDevice,
  syncManagedDevicesFromInventory,
  isDeviceManaged,
  managedDeviceKey,
  normalizeManagedDeviceForApi,
  recordHeartbeatResult,
};
