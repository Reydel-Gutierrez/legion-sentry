const API_BASE = '/api';

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    ...options,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || `Request failed: ${response.status}`);
  }

  return response.json();
}

export const api = {
  getSystemStatus: () => request('/system/status'),
  getSystemInfo: () => request('/system/info'),
  getNetworkStatus: () => request('/network/status'),
  saveNetworkSettings: (data) => request('/network/settings', { method: 'POST', body: JSON.stringify(data) }),
  restartNetwork: () => request('/network/restart', { method: 'POST' }),
  testConnectivity: () => request('/network/test', { method: 'POST' }),
  getBacnetStatus: () => request('/bacnet/status'),
  saveBacnetSettings: (data) => request('/bacnet/settings', { method: 'POST', body: JSON.stringify(data) }),
  discoverBacnet: () => request('/bacnet/discover', { method: 'POST' }),
  getModbusStatus: () => request('/modbus/status'),
  saveModbusSettings: (data) => request('/modbus/settings', { method: 'POST', body: JSON.stringify(data) }),
  testModbusRead: () => request('/modbus/test-read', { method: 'POST' }),
  getMqttStatus: () => request('/mqtt/status'),
  saveMqttSettings: (data) => request('/mqtt/settings', { method: 'POST', body: JSON.stringify(data) }),
  testMqtt: () => request('/mqtt/test', { method: 'POST' }),
  publishMqttTest: () => request('/mqtt/publish-test', { method: 'POST' }),
  getDiagnostics: () => request('/diagnostics/summary'),
  runPing: (target) => request('/diagnostics/ping', { method: 'POST', body: JSON.stringify({ target }) }),
  getLogs: (filter = 'all') => request(`/logs?filter=${filter}`),
  clearLogs: () => request('/logs/clear', { method: 'POST' }),
};
