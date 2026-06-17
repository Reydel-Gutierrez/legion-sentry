const { loadSettings, updateSection } = require('../../lib/settingsStore');
const { DEVICE_STATES } = require('../../lib/deviceStates');
const serialService = require('../interfaces/serial.service');

function getBacnetStatus() {
  const settings = loadSettings().bacnet;
  const serialDetail = serialService.getSerialDetail();
  const recommendedPort = serialDetail.ports.find((p) => p.recommendedForRs485 && p.exists);
  const lastSerialCheck = serialService.getLastOpenCheck();

  return {
    ip: {
      ...settings.ip,
      status: settings.ip?.enabled ? DEVICE_STATES.READY : DEVICE_STATES.DISABLED,
      label: settings.ip?.enabled ? 'Ready' : 'Disabled',
      boundPort: settings.ip?.enabled ? settings.ip.udpPort : null,
      discoveryImplemented: true,
    },
    mstp: {
      ...settings.mstp,
      status: settings.mstp?.enabled ? DEVICE_STATES.READY : DEVICE_STATES.DISABLED,
      label: settings.mstp?.enabled ? 'Ready' : 'Disabled',
      busState: lastSerialCheck?.success ? 'ready' : 'not_checked',
      tokenHolder: null,
      serialPortStatus: lastSerialCheck?.success ? 'open_ok' : (lastSerialCheck ? 'fault' : 'not_checked'),
      lastSerialCheck,
      recommendedSerialPort: recommendedPort?.path || '/dev/serial0',
      discoveryImplemented: false,
    },
    routing: {
      ...(settings.routing || {
        ipNetwork: 1,
        mstpNetwork: 2,
        routeEnabled: false,
      }),
      status: DEVICE_STATES.NOT_CONFIGURED,
      label: 'Routing not implemented in DEV-1 software yet',
      implemented: false,
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
