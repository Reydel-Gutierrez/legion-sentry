const { loadSettings, updateSection } = require('../../lib/settingsStore');

function getBacnetStatus() {
  const settings = loadSettings().bacnet;
  return {
    ip: {
      ...settings.ip,
      status: settings.ip.enabled ? 'running' : 'stopped',
      boundPort: settings.ip.udpPort,
    },
    mstp: {
      ...settings.mstp,
      status: settings.mstp.enabled ? 'running' : 'stopped',
      busState: 'online',
      tokenHolder: settings.mstp.macAddress,
    },
    routing: settings.routing || {
      ipNetwork: 1,
      mstpNetwork: 2,
      routeEnabled: true,
    },
  };
}

function saveBacnetSettings(payload) {
  const current = loadSettings().bacnet;
  const next = {
    ip: { ...current.ip, ...payload.ip },
    mstp: { ...current.mstp, ...payload.mstp },
    routing: { ...(current.routing || {}), ...(payload.routing || {}) },
  };
  updateSection('bacnet', next);
  return getBacnetStatus();
}

module.exports = {
  getBacnetStatus,
  saveBacnetSettings,
};
