const { loadSettings, updateSection } = require('../../lib/settingsStore');

function getModbusStatus() {
  const settings = loadSettings().modbus;
  return {
    tcp: {
      ...settings.tcp,
      status: 'not_configured',
      label: 'Not configured',
      connections: 0,
      lastPollMs: null,
    },
    rtu: {
      ...settings.rtu,
      status: 'not_configured',
      label: 'Not configured',
      busState: null,
      lastResponseMs: null,
    },
  };
}

function saveModbusSettings(payload) {
  const current = loadSettings().modbus;
  const next = {
    tcp: { ...current.tcp, ...payload.tcp },
    rtu: { ...current.rtu, ...payload.rtu },
  };
  updateSection('modbus', next);
  return getModbusStatus();
}

function testReadRegister() {
  return {
    success: true,
    unitId: 1,
    register: 40001,
    value: 72,
    responseTimeMs: 38,
    timestamp: new Date().toISOString(),
  };
}

function scanDevices() {
  return {
    success: true,
    message: 'Modbus scan placeholder — no devices discovered in simulated mode.',
    devices: [],
  };
}

module.exports = {
  getModbusStatus,
  saveModbusSettings,
  testReadRegister,
  scanDevices,
};
