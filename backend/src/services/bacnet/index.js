const fs = require('fs');
const path = require('path');
const { loadSettings, updateSection } = require('../../lib/settingsStore');
const { DEVICE_STATES } = require('../../lib/deviceStates');
const serialService = require('../interfaces/serial.service');

const BACNET_PATH = path.join(__dirname, '../../data/bacnet.json');

function ensureBacnetFile() {
  const dir = path.dirname(BACNET_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  if (!fs.existsSync(BACNET_PATH)) {
    const settings = loadSettings().bacnet || {};
    const initial = {
      mstp: settings.mstp || {
        enabled: true,
        serialPort: '/dev/serial0',
        macAddress: 5,
        baudRate: 38400,
        maxMaster: 127,
        maxInfoFrames: 1,
        networkNumber: 2,
      },
      updatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(BACNET_PATH, `${JSON.stringify(initial, null, 2)}\n`, 'utf8');
  }
}

function loadBacnetConfig() {
  ensureBacnetFile();
  const raw = fs.readFileSync(BACNET_PATH, 'utf8');
  return JSON.parse(raw);
}

function saveMstpSettings(mstpPatch) {
  ensureBacnetFile();
  const current = loadBacnetConfig();
  current.mstp = { ...current.mstp, ...mstpPatch };
  current.updatedAt = new Date().toISOString();
  fs.writeFileSync(BACNET_PATH, `${JSON.stringify(current, null, 2)}\n`, 'utf8');
  return current;
}

function getBacnetStatus() {
  const settings = loadSettings().bacnet;
  const mstpConfig = loadBacnetConfig().mstp;
  const serialDetail = serialService.getSerialDetail();
  const recommendedPort = serialDetail.ports.find((p) => p.recommendedForRs485 && p.exists);
  const lastSerialCheck = serialService.getLastOpenCheck();
  const monitor = serialService.getMonitorStatus();

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
      ...mstpConfig,
      status: settings.mstp?.enabled ? DEVICE_STATES.READY : DEVICE_STATES.DISABLED,
      label: settings.mstp?.enabled ? 'Ready' : 'Disabled',
      busState: lastSerialCheck?.success ? 'ready' : 'not_checked',
      tokenHolder: null,
      serialPortStatus: lastSerialCheck?.success ? 'open_ok' : (lastSerialCheck ? 'fault' : 'not_checked'),
      monitorStatus: monitor.running ? 'running' : 'stopped',
      monitor,
      lastSerialCheck,
      recommendedSerialPort: recommendedPort?.path || '/dev/serial0',
      discoveryImplemented: false,
      discoveryNote: 'BACnet MS/TP discovery is not implemented yet. Use RS485 Diagnostics to validate serial traffic first.',
    },
    routing: {
      ...(settings.routing || {
        ipNetwork: 1,
        mstpNetwork: 2,
        routeEnabled: false,
      }),
      status: DEVICE_STATES.NOT_CONFIGURED,
      label: 'Not implemented in DEV-1',
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
  if (payload.mstp) {
    saveMstpSettings(payload.mstp);
  }
  return getBacnetStatus();
}

module.exports = {
  BACNET_PATH,
  getBacnetStatus,
  saveBacnetSettings,
  loadBacnetConfig,
  saveMstpSettings,
};
