const { loadSettings, updateSection } = require('../../lib/settingsStore');
const { DEVICE } = require('../../config');

function getNetworkStatus() {
  const settings = loadSettings();
  const { ethernet, wifi, hostname } = settings.network;

  return {
    ethernet: {
      ...ethernet,
      status: 'up',
      mac: 'DC:A6:32:12:34:56',
      linkSpeed: '1000 Mbps',
      rxBytes: 18420391,
      txBytes: 9201844,
    },
    wifi: {
      ...wifi,
      status: wifi.enabled ? 'up' : 'down',
    },
    hostname,
    localUrl: `http://${hostname}.local`,
    currentIp: ethernet.dhcpEnabled ? '192.168.1.50' : ethernet.staticIp,
  };
}

function saveNetworkSettings(payload) {
  const current = loadSettings().network;
  const next = {
    ethernet: { ...current.ethernet, ...payload.ethernet },
    wifi: { ...current.wifi, ...payload.wifi },
    hostname: payload.hostname ?? current.hostname,
  };
  updateSection('network', next);
  return getNetworkStatus();
}

function restartNetwork() {
  return {
    success: true,
    message: 'Network restart simulated. Interfaces will reconnect shortly.',
    timestamp: new Date().toISOString(),
  };
}

function testConnectivity() {
  return {
    success: true,
    target: '8.8.8.8',
    latencyMs: 14,
    packetLoss: 0,
    dnsResolved: true,
    gatewayReachable: true,
    mode: DEVICE.mode,
  };
}

module.exports = {
  getNetworkStatus,
  saveNetworkSettings,
  restartNetwork,
  testConnectivity,
};
