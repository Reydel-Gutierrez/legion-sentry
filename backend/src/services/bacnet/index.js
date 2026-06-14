const { loadSettings, updateSection } = require('../../lib/settingsStore');

const MOCK_DEVICES = [
  {
    deviceInstance: 1001,
    vendor: 'Johnson Controls',
    model: 'FEC-1610',
    address: '192.168.1.101',
    networkNumber: 1,
    lastSeen: new Date().toISOString(),
  },
  {
    deviceInstance: 2002,
    vendor: 'Trane',
    model: 'Tracer SC',
    address: '192.168.1.102',
    networkNumber: 1,
    lastSeen: new Date().toISOString(),
  },
  {
    deviceInstance: 3003,
    vendor: 'Carrier',
    model: 'i-Vu',
    address: '192.168.1.103',
    networkNumber: 1,
    lastSeen: new Date().toISOString(),
  },
];

function getBacnetStatus() {
  const settings = loadSettings().bacnet;
  return {
    ip: {
      ...settings.ip,
      status: settings.ip.enabled ? 'running' : 'stopped',
      boundPort: settings.ip.udpPort,
      deviceCount: 3,
    },
    mstp: {
      ...settings.mstp,
      status: settings.mstp.enabled ? 'running' : 'stopped',
      busState: 'online',
      tokenHolder: settings.mstp.macAddress,
    },
    discoveredDevices: MOCK_DEVICES,
  };
}

function saveBacnetSettings(payload) {
  const current = loadSettings().bacnet;
  const next = {
    ip: { ...current.ip, ...payload.ip },
    mstp: { ...current.mstp, ...payload.mstp },
  };
  updateSection('bacnet', next);
  return getBacnetStatus();
}

function discoverDevices() {
  return {
    success: true,
    scannedAt: new Date().toISOString(),
    durationMs: 4200,
    devices: MOCK_DEVICES,
  };
}

module.exports = {
  getBacnetStatus,
  saveBacnetSettings,
  discoverDevices,
  MOCK_DEVICES,
};
