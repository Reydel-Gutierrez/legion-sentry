const MOCK_DEVICES = [
  {
    id: 'dev-1001',
    status: 'online',
    deviceInstance: 1001,
    objectName: 'AHU-1 Controller',
    vendor: 'Johnson Controls',
    model: 'FEC-1610',
    address: '192.168.1.101',
    network: 'BACnet/IP',
    networkNumber: 1,
    lastSeen: new Date(Date.now() - 12000).toISOString(),
    firmware: '3.14.2',
    protocol: 'bacnet-ip',
  },
  {
    id: 'dev-2002',
    status: 'online',
    deviceInstance: 2002,
    objectName: 'Tracer SC Gateway',
    vendor: 'Trane',
    model: 'Tracer SC',
    address: '192.168.1.102',
    network: 'BACnet/IP',
    networkNumber: 1,
    lastSeen: new Date(Date.now() - 45000).toISOString(),
    firmware: '5.2.1',
    protocol: 'bacnet-ip',
  },
  {
    id: 'dev-3003',
    status: 'warning',
    deviceInstance: 3003,
    objectName: 'i-Vu Chiller Plant',
    vendor: 'Carrier',
    model: 'i-Vu',
    address: '192.168.1.103',
    network: 'BACnet/IP',
    networkNumber: 1,
    lastSeen: new Date(Date.now() - 180000).toISOString(),
    firmware: '2.8.0',
    protocol: 'bacnet-ip',
  },
  {
    id: 'dev-4010',
    status: 'offline',
    deviceInstance: 4010,
    objectName: 'VAV-12 Controller',
    vendor: 'Distech Controls',
    model: 'EC-BOS',
    address: '192.168.1.110',
    network: 'BACnet/IP',
    networkNumber: 1,
    lastSeen: new Date(Date.now() - 3600000).toISOString(),
    firmware: '1.9.4',
    protocol: 'bacnet-ip',
  },
  {
    id: 'dev-5015',
    status: 'online',
    deviceInstance: 5015,
    objectName: 'FCU-3 MS/TP',
    vendor: 'Belimo',
    model: 'B3-6655',
    address: 'MAC 12',
    network: 'BACnet MS/TP',
    networkNumber: 2,
    lastSeen: new Date(Date.now() - 8000).toISOString(),
    firmware: '1.2.0',
    protocol: 'bacnet-mstp',
  },
  {
    id: 'dev-5020',
    status: 'online',
    deviceInstance: 5020,
    objectName: 'Boiler Controller',
    vendor: 'Contemporary Controls',
    model: 'BASRT-B',
    address: 'MAC 18',
    network: 'BACnet MS/TP',
    networkNumber: 2,
    lastSeen: new Date(Date.now() - 22000).toISOString(),
    firmware: '4.0.1',
    protocol: 'bacnet-mstp',
  },
  {
    id: 'dev-5033',
    status: 'warning',
    deviceInstance: 5033,
    objectName: 'Meter MS/TP',
    vendor: 'Loytec',
    model: 'LGATE-902',
    address: 'MAC 33',
    network: 'BACnet MS/TP',
    networkNumber: 2,
    lastSeen: new Date(Date.now() - 420000).toISOString(),
    firmware: '6.1.3',
    protocol: 'bacnet-mstp',
  },
];

const OBJECT_SUMMARIES = {
  'dev-1001': { ai: 24, ao: 8, av: 42, bi: 36, bo: 12, bv: 18, schedules: 4, trendLogs: 6, files: 2 },
  'dev-2002': { ai: 64, ao: 16, av: 128, bi: 96, bo: 32, bv: 48, schedules: 12, trendLogs: 24, files: 8 },
  'dev-3003': { ai: 18, ao: 6, av: 30, bi: 22, bo: 8, bv: 14, schedules: 2, trendLogs: 4, files: 1 },
  'dev-4010': { ai: 12, ao: 4, av: 20, bi: 16, bo: 6, bv: 10, schedules: 1, trendLogs: 2, files: 0 },
  'dev-5015': { ai: 8, ao: 2, av: 14, bi: 10, bo: 4, bv: 6, schedules: 1, trendLogs: 1, files: 0 },
  'dev-5020': { ai: 16, ao: 4, av: 28, bi: 20, bo: 6, bv: 8, schedules: 2, trendLogs: 3, files: 1 },
  'dev-5033': { ai: 6, ao: 2, av: 10, bi: 8, bo: 2, bv: 4, schedules: 0, trendLogs: 1, files: 0 },
};

const HEALTH_DATA = {
  online: { responseTimeMs: 18, communicationErrors: 0 },
  warning: { responseTimeMs: 142, communicationErrors: 3 },
  offline: { responseTimeMs: null, communicationErrors: 12 },
};

let deviceCache = [...MOCK_DEVICES];

function getDevices() {
  return {
    devices: deviceCache,
    summary: buildSummary(deviceCache),
    lastRefresh: new Date().toISOString(),
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

  const health = HEALTH_DATA[device.status] || HEALTH_DATA.offline;
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

function getDeviceObjects(id) {
  const device = deviceCache.find((d) => d.id === id);
  if (!device) return null;

  const summary = OBJECT_SUMMARIES[id] || {
    ai: 0, ao: 0, av: 0, bi: 0, bo: 0, bv: 0, schedules: 0, trendLogs: 0, files: 0,
  };

  return {
    deviceId: id,
    deviceInstance: device.deviceInstance,
    objectSummary: summary,
    totalObjects: Object.values(summary).reduce((a, b) => a + b, 0),
  };
}

function discoverDevices(protocol = 'all') {
  const durationMs = protocol === 'bacnet-mstp' ? 6200 : 4200;
  const filtered = MOCK_DEVICES.filter((d) => {
    if (protocol === 'bacnet-ip') return d.protocol === 'bacnet-ip';
    if (protocol === 'bacnet-mstp') return d.protocol === 'bacnet-mstp';
    return true;
  });

  deviceCache = filtered.map((d) => ({
    ...d,
    lastSeen: new Date().toISOString(),
    status: d.status === 'offline' ? 'offline' : 'online',
  }));

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
  deviceCache = deviceCache.map((d) => {
    if (d.status === 'offline') return d;
    return {
      ...d,
      lastSeen: new Date().toISOString(),
      status: d.status === 'warning' && Math.random() > 0.7 ? 'online' : d.status,
    };
  });

  return {
    success: true,
    refreshedAt: new Date().toISOString(),
    devices: deviceCache,
    summary: buildSummary(deviceCache),
  };
}

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

function getDashboardSummary() {
  const summary = buildSummary(deviceCache);
  return {
    bacnetDevices: summary.total,
    onlineDevices: summary.online,
    offlineDevices: summary.offline,
    mstpNetworks: summary.mstpNetworks,
    warningDevices: summary.warning,
  };
}

module.exports = {
  getDevices,
  getDeviceById,
  getDeviceHealth,
  getDeviceObjects,
  discoverDevices,
  refreshDevices,
  getDashboardSummary,
  MOCK_DEVICES,
};
