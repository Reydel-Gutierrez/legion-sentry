const mockData = require('./mockData');

const USE_MOCK_DATA = process.env.MOCK_DATA === 'true';
const DISCOVERY_IMPLEMENTED = USE_MOCK_DATA;

let deviceCache = [];
let hasScanned = false;

function buildSummary(devices) {
  const online = devices.filter((d) => d.status === 'online').length;
  const offline = devices.filter((d) => d.status === 'offline').length;
  const warning = devices.filter((d) => d.status === 'warning').length;
  const mstpNetworks = new Set(
    devices.filter((d) => d.protocol === 'bacnet-mstp').map((d) => d.networkNumber),
  ).size;

  return {
    total: devices.length,
    online,
    offline,
    warning,
    mstpNetworks,
  };
}

function getDevices() {
  return {
    devices: deviceCache,
    summary: buildSummary(deviceCache),
    scanned: hasScanned,
    discoveryImplemented: DISCOVERY_IMPLEMENTED,
    lastRefresh: hasScanned ? new Date().toISOString() : null,
  };
}

function getDeviceById(id) {
  const device = deviceCache.find((d) => d.id === id);
  if (!device) return null;
  return { device };
}

function getDeviceHealth(id) {
  const device = deviceCache.find((d) => d.id === id);
  if (!device) return null;

  if (USE_MOCK_DATA) {
    const health = mockData.HEALTH_DATA[device.status] || mockData.HEALTH_DATA.offline;
    return {
      deviceId: id,
      status: device.status,
      online: device.status === 'online',
      responseTimeMs: health.responseTimeMs,
      communicationErrors: health.communicationErrors,
      lastSeen: device.lastSeen,
      checkedAt: new Date().toISOString(),
    };
  }

  return {
    deviceId: id,
    status: device.status,
    online: device.status === 'online',
    responseTimeMs: null,
    communicationErrors: 0,
    lastSeen: device.lastSeen,
    checkedAt: new Date().toISOString(),
  };
}

function getDeviceObjects(id) {
  const device = deviceCache.find((d) => d.id === id);
  if (!device) return null;

  const summary = USE_MOCK_DATA
    ? (mockData.OBJECT_SUMMARIES[id] || {
      ai: 0, ao: 0, av: 0, bi: 0, bo: 0, bv: 0, schedules: 0, trendLogs: 0, files: 0,
    })
    : { ai: 0, ao: 0, av: 0, bi: 0, bo: 0, bv: 0, schedules: 0, trendLogs: 0, files: 0 };

  return {
    deviceId: id,
    deviceInstance: device.deviceInstance,
    objectSummary: summary,
    totalObjects: Object.values(summary).reduce((a, b) => a + b, 0),
  };
}

function discoverDevices(protocol = 'all') {
  if (!DISCOVERY_IMPLEMENTED) {
    const error = new Error('Discovery service not implemented on this hardware yet');
    error.statusCode = 501;
    error.code = 'NOT_IMPLEMENTED';
    throw error;
  }

  const durationMs = protocol === 'bacnet-mstp' ? 6200 : 4200;
  const filtered = mockData.MOCK_DEVICES.filter((d) => {
    if (protocol === 'bacnet-ip') return d.protocol === 'bacnet-ip';
    if (protocol === 'bacnet-mstp') return d.protocol === 'bacnet-mstp';
    return true;
  });

  deviceCache = filtered.map((d) => ({
    ...d,
    lastSeen: new Date().toISOString(),
    status: d.status === 'offline' ? 'offline' : 'online',
  }));
  hasScanned = true;

  return {
    success: true,
    protocol,
    scannedAt: new Date().toISOString(),
    durationMs,
    devicesFound: deviceCache.length,
    devices: deviceCache,
  };
}

function refreshDevices() {
  if (!hasScanned && deviceCache.length === 0) {
    return {
      success: true,
      refreshedAt: new Date().toISOString(),
      devices: deviceCache,
      summary: buildSummary(deviceCache),
      scanned: false,
    };
  }

  deviceCache = deviceCache.map((d) => {
    if (d.status === 'offline') return d;
    return { ...d, lastSeen: new Date().toISOString() };
  });
  hasScanned = true;

  return {
    success: true,
    refreshedAt: new Date().toISOString(),
    devices: deviceCache,
    summary: buildSummary(deviceCache),
    scanned: true,
  };
}

function getDashboardSummary() {
  if (!hasScanned && deviceCache.length === 0) {
    return {
      scanned: false,
      bacnetDevices: null,
      onlineDevices: null,
      offlineDevices: null,
      mstpNetworks: null,
      warningDevices: null,
    };
  }

  const summary = buildSummary(deviceCache);
  return {
    scanned: true,
    bacnetDevices: summary.total,
    onlineDevices: summary.online,
    offlineDevices: summary.offline,
    mstpNetworks: summary.mstpNetworks,
    warningDevices: summary.warning,
  };
}

function isDiscoveryImplemented() {
  return DISCOVERY_IMPLEMENTED;
}

module.exports = {
  getDevices,
  getDeviceById,
  getDeviceHealth,
  getDeviceObjects,
  discoverDevices,
  refreshDevices,
  getDashboardSummary,
  isDiscoveryImplemented,
};
