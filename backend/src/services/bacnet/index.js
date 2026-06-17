const { loadSettings, updateSection } = require('../../lib/settingsStore');

function getBacnetStatus() {
  const settings = loadSettings().bacnet;
  return {
    ip: {
      ...settings.ip,
      status: 'not_configured',
      label: 'Not configured',
      boundPort: null,
    },
    mstp: {
      ...settings.mstp,
      status: 'not_configured',
      label: 'Not configured',
      busState: null,
      tokenHolder: null,
    },
    routing: settings.routing || {
      ipNetwork: 1,
      mstpNetwork: 2,
      routeEnabled: false,
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
