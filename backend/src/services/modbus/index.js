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
  const error = new Error('Modbus read not implemented in DEV-1');
  error.statusCode = 501;
  error.code = 'NOT_IMPLEMENTED';
  throw error;
}

function scanDevices() {
  return {
    success: true,
    message: 'Modbus scan is not implemented.',
    devices: [],
  };
}

module.exports = {
  getModbusStatus,
  saveModbusSettings,
  testReadRegister,
  scanDevices,
};
