const inventory = require('./inventory');
const managedDevices = require('./managedDevices');
const bacnetIpService = require('../bacnet/bacnetIp.service');
const { DEVICE_HEALTH } = require('../../lib/deviceStates');

const BACNET_IP_DISCOVERY_IMPLEMENTED = true;
const BACNET_MSTP_DISCOVERY_IMPLEMENTED = true;

let hasScanned = false;
let lastRefresh = null;

// Tracks the discoverySessionId of the most recent MS/TP scan so the UI can
// show a "seen in latest scan" badge. This is a transient marker only — it does
// not affect persisted inventory and is reset by Clear Latest Scan.
let latestMstpDiscoverySessionId = null;

// Window within which an MS/TP device that responded in a previous scan is still
// considered "recently seen / probably online". Beyond this it is "stale".
const MSTP_RECENT_WINDOW_MS = 2 * 60 * 1000;

function isMstpTransport(device) {
  return device.transport === 'BACnet MS/TP' || device.transport === 'mstp';
}

// Conservatively derive an MS/TP device's confirmation status. A persisted
// inventory device is NEVER assumed online just because it exists — it must
// have answered the latest scan or been seen within the recent window.
function computeMstpStatus(device) {
  const lastSeenAt = device.lastSeenAt || device.lastSeen || null;
  const seenInLatestScan = Boolean(latestMstpDiscoverySessionId)
    && device.discoverySessionId != null
    && device.discoverySessionId === latestMstpDiscoverySessionId;

  if (seenInLatestScan) {
    return { mstpStatus: 'seen_latest_scan', seenInLatestScan: true };
  }
  if (!lastSeenAt) {
    return { mstpStatus: 'never_confirmed', seenInLatestScan: false };
  }
  const age = Date.now() - new Date(lastSeenAt).getTime();
  if (Number.isFinite(age) && age <= MSTP_RECENT_WINDOW_MS) {
    return { mstpStatus: 'recently_seen', seenInLatestScan: false };
  }
  return { mstpStatus: 'stale', seenInLatestScan: false };
}

function loadDevices() {
  return inventory.loadInventory();
}

function persistDevices(devices) {
  inventory.saveInventory(devices);
}

function buildSummary(devices) {
  const online = devices.filter((d) => d.status === DEVICE_HEALTH.ONLINE).length;
  const offline = devices.filter((d) => d.status === DEVICE_HEALTH.OFFLINE).length;
  const fault = devices.filter((d) => d.status === 'fault').length;
  const mstpNetworks = new Set(
    devices.filter((d) => (
      d.transport === 'mstp'
      || d.transport === 'BACnet MS/TP'
    ) && d.networkNumber != null).map((d) => d.networkNumber),
  ).size;

  return {
    total: devices.length,
    online,
    offline,
    fault,
    mstpNetworks,
  };
}

function normalizeDeviceForApi(device) {
  const mstp = isMstpTransport(device);
  const base = {
    ...device,
    vendor: device.vendorName || device.vendor,
    model: device.modelName || device.model,
    network: device.transport === 'BACnet/IP'
      ? 'BACnet/IP'
      : (mstp ? 'BACnet MS/TP' : (device.transport || '—')),
    configuredNetworkNumber: device.configuredNetworkNumber
      ?? (mstp ? device.networkNumber : undefined),
    lastSeen: device.lastSeenAt || device.lastSeen,
    firmware: device.firmwareRevision || device.firmware || null,
  };

  if (mstp) {
    const { mstpStatus, seenInLatestScan } = computeMstpStatus(device);
    base.mstpStatus = mstpStatus;
    base.seenInLatestScan = seenInLatestScan;
    base.missedScans = device.missedScans ?? 0;
    base.sightings = device.sightings ?? null;
    base.firstSeenAt = device.firstSeenAt ?? null;
    base.lastSeenAt = device.lastSeenAt ?? device.lastSeen ?? null;
    base.lastDiscoverySessionId = device.discoverySessionId ?? null;
    base.latestDiscoverySessionId = latestMstpDiscoverySessionId;
  }

  return base;
}

function getDevices() {
  const devices = loadDevices().map(normalizeDeviceForApi);
  return {
    devices,
    summary: buildSummary(devices),
    scanned: hasScanned || devices.length > 0,
    discoveryImplemented: {
      bacnetIp: BACNET_IP_DISCOVERY_IMPLEMENTED,
      bacnetMstp: BACNET_MSTP_DISCOVERY_IMPLEMENTED,
    },
    latestDiscoverySessionId: latestMstpDiscoverySessionId,
    lastRefresh,
  };
}

function getDeviceById(id) {
  const device = loadDevices().find((d) => d.id === id);
  if (!device) return null;
  return { device: normalizeDeviceForApi(device) };
}

function getDeviceHealth(id) {
  const device = loadDevices().find((d) => d.id === id);
  if (!device) return null;

  if (isMstpTransport(device)) {
    // MS/TP devices are never assumed online from inventory alone. Online is
    // only true when the device was confirmed in the latest scan or recently.
    const { mstpStatus, seenInLatestScan } = computeMstpStatus(device);
    const online = mstpStatus === 'seen_latest_scan' || mstpStatus === 'recently_seen';
    return {
      deviceId: id,
      status: online ? DEVICE_HEALTH.ONLINE : 'unknown',
      mstpStatus,
      seenInLatestScan,
      online,
      missedScans: device.missedScans ?? 0,
      responseTimeMs: device.lastResponseMs ?? null,
      communicationErrors: 0,
      lastSeen: device.lastSeenAt || device.lastSeen,
      checkedAt: new Date().toISOString(),
    };
  }

  return {
    deviceId: id,
    status: device.status,
    online: device.status === DEVICE_HEALTH.ONLINE,
    responseTimeMs: device.lastResponseMs ?? null,
    communicationErrors: device.status === DEVICE_HEALTH.OFFLINE ? 1 : 0,
    lastSeen: device.lastSeenAt || device.lastSeen,
    checkedAt: new Date().toISOString(),
  };
}

function getDeviceObjects(id) {
  const device = loadDevices().find((d) => d.id === id);
  if (!device) return null;

  const summary = {
    ai: 0, ao: 0, av: 0, bi: 0, bo: 0, bv: 0, schedules: 0, trendLogs: 0, files: 0,
  };

  return {
    deviceId: id,
    deviceInstance: device.deviceInstance,
    objectSummary: summary,
    totalObjects: device.objectListCount ?? Object.values(summary).reduce((a, b) => a + b, 0),
  };
}

function mapDiscoveredToInventory(discovered, source = 'bacnet-ip-discovery') {
  const now = new Date().toISOString();
  return {
    id: inventory.generateDeviceId('bacnet-ip', discovered.deviceInstance, discovered.address),
    protocol: 'BACnet',
    transport: 'BACnet/IP',
    deviceInstance: discovered.deviceInstance,
    objectName: discovered.objectName || null,
    vendorName: discovered.vendorName || null,
    modelName: discovered.modelName || null,
    address: discovered.address,
    networkNumber: discovered.networkNumber ?? 1,
    macAddress: null,
    status: discovered.status || DEVICE_HEALTH.ONLINE,
    lastSeenAt: now,
    lastResponseMs: discovered.lastResponseMs ?? null,
    source,
    vendorId: discovered.vendorId ?? null,
    maxApdu: discovered.maxApdu ?? null,
    segmentation: discovered.segmentation ?? null,
  };
}

function mapMstpDiscoveredToInventory(discovered, source = 'bacnet-mstp-discovery') {
  const now = new Date().toISOString();
  const mstpMacAddress = discovered.mstpMacAddress ?? discovered.macAddress ?? null;
  // networkNumber for a local MS/TP device is the configured local network
  // number, never a value inferred from the BACnet payload.
  const configuredNetworkNumber = discovered.configuredNetworkNumber ?? discovered.networkNumber ?? null;
  return {
    id: inventory.generateDeviceId('bacnet-mstp', discovered.deviceInstance, `mac-${mstpMacAddress}`),
    protocol: 'BACnet',
    transport: 'BACnet MS/TP',
    deviceInstance: discovered.deviceInstance,
    objectName: discovered.objectName || null,
    vendorName: discovered.vendorName || null,
    modelName: discovered.modelName || null,
    address: null,
    networkNumber: configuredNetworkNumber,
    configuredNetworkNumber,
    sourceNetworkRaw: discovered.sourceNetworkRaw ?? null,
    mstpMacAddress,
    macAddress: mstpMacAddress,
    status: discovered.status || DEVICE_HEALTH.ONLINE,
    firstSeenAt: discovered.firstSeenAt ?? now,
    lastSeenAt: now,
    lastResponseMs: discovered.lastResponseMs ?? null,
    discoverySessionId: discovered.discoverySessionId ?? null,
    sightings: discovered.sightings ?? 1,
    source,
    vendorId: discovered.vendorId ?? null,
    maxApdu: discovered.maxApdu ?? null,
    segmentation: discovered.segmentation ?? null,
  };
}

function deviceMergeKey(device) {
  if (device.transport === 'BACnet MS/TP' || device.transport === 'mstp') {
    const mac = device.mstpMacAddress ?? device.macAddress;
    return `mstp:${mac}:${device.deviceInstance}`;
  }
  return `${device.address}:${device.deviceInstance}`;
}

function mergeDiscoveredDevices(discoveredList, mapper = mapDiscoveredToInventory) {
  const existing = loadDevices();
  const byKey = new Map(existing.map((d) => [deviceMergeKey(d), d]));

  for (const discovered of discoveredList) {
    const mapped = mapper(discovered);
    const key = deviceMergeKey(mapped);
    const prev = byKey.get(key);
    byKey.set(key, prev ? {
      ...prev,
      ...mapped,
      id: prev.id,
      objectName: mapped.objectName || prev.objectName,
      vendorName: mapped.vendorName || prev.vendorName,
      modelName: mapped.modelName || prev.modelName,
      // Preserve the original first-seen timestamp across rescans.
      firstSeenAt: prev.firstSeenAt || mapped.firstSeenAt,
      lastSeenAt: mapped.lastSeenAt,
      sightings: (prev.sightings || 0) + (mapped.sightings || 1),
      discoverySessionId: mapped.discoverySessionId || prev.discoverySessionId,
      status: DEVICE_HEALTH.ONLINE,
    } : mapped);
  }

  const merged = Array.from(byKey.values());
  persistDevices(merged);
  hasScanned = true;
  return merged;
}

function discoverDevices(protocol = 'all') {
  if (protocol === 'bacnet-mstp') {
    const error = new Error('Use POST /api/bacnet/mstp/discover for BACnet MS/TP discovery');
    error.statusCode = 400;
    error.code = 'USE_BACNET_MSTP_ENDPOINT';
    throw error;
  }

  if (protocol === 'bacnet-ip' || protocol === 'all') {
    const error = new Error('Use POST /api/bacnet/ip/discover for BACnet/IP discovery');
    error.statusCode = 400;
    error.code = 'USE_BACNET_IP_ENDPOINT';
    throw error;
  }

  const error = new Error('Discovery protocol not supported');
  error.statusCode = 400;
  throw error;
}

async function ingestBacnetIpDiscovery(result) {
  const merged = mergeDiscoveredDevices(result.devices, mapDiscoveredToInventory);
  return {
    success: true,
    protocol: 'bacnet-ip',
    scannedAt: result.discoveredAt,
    durationMs: result.durationMs,
    devicesFound: merged.length,
    devices: merged.map(normalizeDeviceForApi),
  };
}

async function ingestBacnetMstpDiscovery(result) {
  const sessionId = result.discoverySessionId || null;
  const discoveredList = result.devices || [];

  const existing = loadDevices();
  const byKey = new Map(existing.map((d) => [deviceMergeKey(d), d]));
  const discoveredKeys = new Set();
  const seenDevices = [];

  // Devices that answered this scan: refresh timestamps, reset missedScans.
  for (const discovered of discoveredList) {
    const mapped = mapMstpDiscoveredToInventory({ ...discovered, discoverySessionId: sessionId });
    const key = deviceMergeKey(mapped);
    discoveredKeys.add(key);
    const prev = byKey.get(key);
    const next = prev ? {
      ...prev,
      ...mapped,
      id: prev.id,
      objectName: mapped.objectName || prev.objectName,
      vendorName: mapped.vendorName || prev.vendorName,
      modelName: mapped.modelName || prev.modelName,
      firstSeenAt: prev.firstSeenAt || mapped.firstSeenAt,
      lastSeenAt: mapped.lastSeenAt,
      sightings: (prev.sightings || 0) + 1,
      missedScans: 0,
      discoverySessionId: sessionId,
      status: DEVICE_HEALTH.ONLINE,
    } : {
      ...mapped,
      missedScans: 0,
      sightings: mapped.sightings || 1,
    };
    byKey.set(key, next);
    seenDevices.push(next);
  }

  // Previously known MS/TP devices NOT seen this scan: increment missedScans.
  // Inventory is preserved and the device is never auto-deleted or marked
  // online — its lastSeenAt / discoverySessionId are intentionally untouched.
  const missedDevices = [];
  for (const [key, device] of byKey.entries()) {
    if (discoveredKeys.has(key)) continue;
    if (!isMstpTransport(device)) continue;

    const previousDiscoverySessionId = device.discoverySessionId || null;
    const missedScans = (device.missedScans || 0) + 1;
    const updated = { ...device, missedScans };
    byKey.set(key, updated);

    missedDevices.push({
      mstpMacAddress: updated.mstpMacAddress ?? updated.macAddress ?? null,
      deviceInstance: updated.deviceInstance,
      lastSeenAt: updated.lastSeenAt || updated.lastSeen || null,
      missedScans,
      previousDiscoverySessionId,
    });
  }

  const merged = Array.from(byKey.values());
  persistDevices(merged);
  hasScanned = true;
  latestMstpDiscoverySessionId = sessionId;
  managedDevices.setLatestMstpDiscoverySessionId(sessionId);
  managedDevices.syncManagedDevicesFromInventory(merged);

  const mstpInventory = merged.filter(isMstpTransport);

  return {
    success: true,
    protocol: 'bacnet-mstp',
    scannedAt: result.discoveredAt,
    durationMs: result.durationMs,
    discoverySessionId: sessionId,
    latestDiscoverySessionId: latestMstpDiscoverySessionId,
    devicesFound: discoveredList.length,
    seenDevices: seenDevices.map(normalizeDeviceForApi),
    missedDevices,
    inventoryTotals: {
      mstp: mstpInventory.length,
      total: merged.length,
    },
    devices: mstpInventory.map(normalizeDeviceForApi),
  };
}

function clearLatestScanSession() {
  // Forget which devices were seen in the latest scan without removing any
  // persistent inventory.
  latestMstpDiscoverySessionId = null;
  managedDevices.setLatestMstpDiscoverySessionId(null);
  return { success: true, latestDiscoverySessionId: null };
}

async function refreshDevices() {
  const devices = loadDevices();

  if (devices.length === 0) {
    return {
      success: true,
      refreshedAt: new Date().toISOString(),
      devices: [],
      summary: buildSummary([]),
      scanned: hasScanned,
    };
  }

  const refreshed = [];

  for (const device of devices) {
    if ((device.protocol === 'bacnet-ip' || device.protocol === 'BACnet') && device.address) {
      try {
        const health = await bacnetIpService.readObjectName({
          address: device.address,
          deviceInstance: device.deviceInstance,
        });
        refreshed.push({
          ...device,
          status: health.online ? DEVICE_HEALTH.ONLINE : DEVICE_HEALTH.OFFLINE,
          objectName: health.objectName || device.objectName,
          lastSeenAt: health.online ? new Date().toISOString() : device.lastSeenAt,
          lastResponseMs: health.responseTimeMs,
        });
      } catch {
        refreshed.push({
          ...device,
          status: DEVICE_HEALTH.OFFLINE,
        });
      }
    } else if (device.transport === 'BACnet MS/TP' || device.transport === 'mstp') {
      refreshed.push({ ...device });
    } else {
      refreshed.push({
        ...device,
        status: DEVICE_HEALTH.OFFLINE,
      });
    }
  }

  persistDevices(refreshed);
  hasScanned = true;
  lastRefresh = new Date().toISOString();

  return {
    success: true,
    refreshedAt: lastRefresh,
    devices: refreshed.map(normalizeDeviceForApi),
    summary: buildSummary(refreshed),
    scanned: true,
  };
}

function deleteDevice(id) {
  const devices = loadDevices();
  const index = devices.findIndex((d) => d.id === id);
  if (index === -1) return null;

  const [removed] = devices.splice(index, 1);
  persistDevices(devices);

  if (devices.length === 0) {
    hasScanned = false;
  }

  return { success: true, removed: normalizeDeviceForApi(removed) };
}

function clearInventory() {
  persistDevices([]);
  hasScanned = false;
  lastRefresh = null;
  return { success: true, count: 0 };
}

function getDashboardSummary() {
  const devices = loadDevices();
  if (!hasScanned && devices.length === 0) {
    return {
      scanned: false,
      bacnetDevices: null,
      onlineDevices: null,
      offlineDevices: null,
      mstpNetworks: null,
      faultDevices: null,
    };
  }

  const summary = buildSummary(devices.map(normalizeDeviceForApi));
  return {
    scanned: true,
    bacnetDevices: summary.total,
    onlineDevices: summary.online,
    offlineDevices: summary.offline,
    mstpNetworks: summary.mstpNetworks,
    faultDevices: summary.fault,
  };
}

function isDiscoveryImplemented(protocol = 'bacnet-ip') {
  if (protocol === 'bacnet-mstp') return BACNET_MSTP_DISCOVERY_IMPLEMENTED;
  return BACNET_IP_DISCOVERY_IMPLEMENTED;
}

module.exports = {
  getDevices,
  getDeviceById,
  getDeviceHealth,
  getDeviceObjects,
  discoverDevices,
  ingestBacnetIpDiscovery,
  ingestBacnetMstpDiscovery,
  refreshDevices,
  deleteDevice,
  clearInventory,
  clearLatestScanSession,
  getDashboardSummary,
  isDiscoveryImplemented,
  mergeDiscoveredDevices,
};
