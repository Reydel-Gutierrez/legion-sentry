const { loadSettings, updateSection } = require('../../lib/settingsStore');
const { DEVICE } = require('../../config');

function getMqttStatus() {
  const settings = loadSettings().mqtt;
  return {
    ...settings,
    status: 'disabled',
    label: 'Disabled',
    clientId: `legion-sentry-${DEVICE.deviceId}`,
    lastConnected: null,
    messagesPublished: 0,
    messagesReceived: 0,
  };
}

function saveMqttSettings(payload) {
  const current = loadSettings().mqtt;
  const next = {
    ...current,
    ...payload,
    topics: { ...current.topics, ...payload.topics },
  };
  updateSection('mqtt', next);
  return getMqttStatus();
}

function testConnection() {
  const error = new Error('MQTT broker test not implemented in DEV-1');
  error.statusCode = 501;
  error.code = 'NOT_IMPLEMENTED';
  throw error;
}

function publishTestMessage() {
  const error = new Error('MQTT publish not implemented in DEV-1');
  error.statusCode = 501;
  error.code = 'NOT_IMPLEMENTED';
  throw error;
}

module.exports = {
  getMqttStatus,
  saveMqttSettings,
  testConnection,
  publishTestMessage,
};
