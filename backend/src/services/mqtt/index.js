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
  const settings = loadSettings().mqtt;
  return {
    success: settings.enabled,
    broker: `${settings.brokerUrl}:${settings.port}`,
    tls: settings.tlsEnabled,
    latencyMs: settings.enabled ? 56 : null,
    message: settings.enabled
      ? 'MQTT broker connection test succeeded (simulated).'
      : 'MQTT client is disabled. Enable it before testing.',
  };
}

function publishTestMessage() {
  const settings = loadSettings().mqtt;
  const topic = settings.topics.telemetry;
  return {
    success: settings.enabled,
    topic,
    payload: { temperature: 22.4, status: 'ok', ts: new Date().toISOString() },
    message: settings.enabled
      ? `Test message published to ${topic} (simulated).`
      : 'MQTT client is disabled.',
  };
}

module.exports = {
  getMqttStatus,
  saveMqttSettings,
  testConnection,
  publishTestMessage,
};
