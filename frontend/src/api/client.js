const API_BASE = '/api';

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    ...options,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    const err = new Error(error.error || `Request failed: ${response.status}`);
    err.code = error.code;
    err.status = response.status;
    throw err;
  }

  return response.json();
}

export const api = {
  login: (username, password) => request('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  }),
  logout: () => request('/auth/logout', { method: 'POST' }),
  getSession: () => request('/auth/session'),
  changePassword: (currentPassword, newPassword) => request('/auth/change-password', {
    method: 'POST',
    body: JSON.stringify({ currentPassword, newPassword }),
  }),
  getSystemStatus: () => request('/system/status'),
  getSystemInfo: () => request('/system/info'),
  getNetworkStatus: () => request('/network/status'),
  getNetworkInterfaces: () => request('/interfaces/network'),
  saveNetworkSettings: (data) => request('/network/settings', { method: 'POST', body: JSON.stringify(data) }),
  applyNetworkSettings: () => request('/network/apply', { method: 'POST' }),
  restartNetwork: () => request('/network/restart', { method: 'POST' }),
  testConnectivity: () => request('/network/test', { method: 'POST' }),
  testGatewayPing: () => request('/network/test-gateway', { method: 'POST' }),
  testDns: () => request('/network/test-dns', { method: 'POST' }),
  getDevices: () => request('/devices'),
  getDevice: (id) => request(`/devices/${id}`),
  getDeviceHealth: (id) => request(`/devices/${id}/health`),
  getDeviceObjects: (id) => request(`/devices/${id}/objects`),
  deleteDevice: (id) => request(`/devices/${id}`, { method: 'DELETE' }),
  clearDevices: () => request('/devices/clear', { method: 'POST' }),
  discoverBacnetIp: (timeoutMs = 5000) => request('/bacnet/ip/discover', {
    method: 'POST',
    body: JSON.stringify({ timeoutMs }),
  }),
  readBacnetDevice: (address, deviceInstance) => request('/bacnet/ip/read-device', {
    method: 'POST',
    body: JSON.stringify({ address, deviceInstance }),
  }),
  discoverDevices: (protocol = 'all') => request('/devices/discover', { method: 'POST', body: JSON.stringify({ protocol }) }),
  refreshDevices: () => request('/devices/refresh', { method: 'POST' }),
  getBacnetStatus: () => request('/bacnet/status'),
  saveBacnetSettings: (data) => request('/bacnet/settings', { method: 'POST', body: JSON.stringify(data) }),
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
  getSerialInterfaces: () => request('/interfaces/serial'),
  getSerialDetail: () => request('/interfaces/serial/detail'),
  configureSerial: (data) => request('/interfaces/serial/configure', { method: 'POST', body: JSON.stringify(data) }),
  openSerialCheck: (data) => request('/interfaces/serial/open-check', { method: 'POST', body: JSON.stringify(data) }),
  startSerialMonitor: (data) => request('/interfaces/serial/monitor/start', { method: 'POST', body: JSON.stringify(data) }),
  getSerialMonitorStatus: () => request('/interfaces/serial/monitor/status'),
  stopSerialMonitor: () => request('/interfaces/serial/monitor/stop', { method: 'POST' }),
};
