const fs = require('fs');
const path = require('path');
const { loadSettings, updateSection } = require('../../lib/settingsStore');
const { DEVICE_STATES } = require('../../lib/deviceStates');
const serialService = require('../interfaces/serial.service');
const bacnetMstpService = require('./bacnetMstp.service');

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
        macAddress: 3,
        baudRate: 38400,
        maxMaster: 127,
        maxInfoFrames: 1,
        networkNumber: 2,
        timeoutMs: 20000,
        whoIsRetries: 5,
        retryIntervalMs: 3000,
        tokenMode: false,
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

function sanitizeMstpConfig(mstp = {}) {
  const extraDiscoveryRetriesEnabled = mstp.extraDiscoveryRetriesEnabled != null
    ? Boolean(mstp.extraDiscoveryRetriesEnabled)
    : Boolean(mstp.extraFecRetryEnabled);
  const { extraFecRetryEnabled, ...rest } = mstp;
  return {
    ...rest,
    extraDiscoveryRetriesEnabled,
  };
}

function saveMstpSettings(mstpPatch) {
  ensureBacnetFile();
  const current = loadBacnetConfig();
  const patch = { ...mstpPatch };
  if (patch.extraFecRetryEnabled != null && patch.extraDiscoveryRetriesEnabled == null) {
    patch.extraDiscoveryRetriesEnabled = Boolean(patch.extraFecRetryEnabled);
  }
  delete patch.extraFecRetryEnabled;
  current.mstp = sanitizeMstpConfig({ ...current.mstp, ...patch });
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
  const mstpInterface = bacnetMstpService.getStatus().status;

  return {
    ip: {
      ...settings.ip,
      status: settings.ip?.enabled ? DEVICE_STATES.READY : DEVICE_STATES.DISABLED,
      label: settings.ip?.enabled ? 'Ready' : 'Disabled',
      boundPort: settings.ip?.enabled ? settings.ip.udpPort : null,
      discoveryImplemented: true,
    },
    mstp: sanitizeMstpConfig({
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
      discoveryImplemented: true,
      interface: mstpInterface,
      discoveryNote: 'BACnet MS/TP discovery uses token-gated Who-Is when Token Mode is enabled. Routing between BACnet/IP and MS/TP is not implemented in DEV-1.',
    }),
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
  const mstpPatch = payload.mstp ? { ...payload.mstp } : null;
  if (mstpPatch?.extraFecRetryEnabled != null && mstpPatch.extraDiscoveryRetriesEnabled == null) {
    mstpPatch.extraDiscoveryRetriesEnabled = Boolean(mstpPatch.extraFecRetryEnabled);
  }
  if (mstpPatch) {
    delete mstpPatch.extraFecRetryEnabled;
  }
  const next = {
    ip: { ...current.ip, ...payload.ip },
    mstp: sanitizeMstpConfig({ ...current.mstp, ...(mstpPatch || {}) }),
    routing: { ...(current.routing || {}), ...(payload.routing || {}) },
  };
  updateSection('bacnet', next);
  if (mstpPatch) {
    saveMstpSettings(mstpPatch);
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
