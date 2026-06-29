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
    const err = new Error(error.error || error.message || `Request failed: ${response.status}`);
    err.code = error.code;
    err.status = response.status;
    err.body = error;
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
  getNetworkManager: () => request('/network/manager'),
  getNetworkInterfaces: () => request('/interfaces/network'),
  applyNetworkSettings: (data) => request('/network/apply', { method: 'POST', body: JSON.stringify(data) }),
  restoreDhcp: (iface) => request('/network/restore-dhcp', { method: 'POST', body: JSON.stringify({ interface: iface }) }),
  setHostname: (hostname) => request('/network/hostname', { method: 'POST', body: JSON.stringify({ hostname }) }),
  rebootDevice: () => request('/network/reboot', { method: 'POST' }),
  testConnectivity: () => request('/network/test', { method: 'POST' }),
  testGatewayPing: () => request('/network/test-gateway', { method: 'POST' }),
  testDns: () => request('/network/test-dns', { method: 'POST' }),
  getDevices: () => request('/devices'),
  getManagedDevices: () => request('/devices/managed'),
  addManagedDevice: (data) => request('/devices/managed', { method: 'POST', body: JSON.stringify(data) }),
  updateManagedDevice: (id, data) => request(`/devices/managed/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  unmanageDevice: (id) => request(`/devices/managed/${id}`, { method: 'DELETE' }),
  getManagedDevicePoints: (id) => request(`/devices/managed/${id}/points`),
  discoverManagedDevicePoints: (id, body) => request(`/devices/managed/${id}/discover-points`, {
    method: 'POST',
    body: JSON.stringify(body || {}),
  }),
  clearManagedDevicePoints: (id) => request(`/devices/managed/${id}/points`, { method: 'DELETE' }),
  updateManagedPoint: (deviceId, pointId, data) => request(`/devices/managed/${deviceId}/points/${pointId}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  }),
  refreshManagedPoint: (deviceId, pointId, body) => request(`/devices/managed/${deviceId}/points/${pointId}/refresh`, {
    method: 'POST',
    body: JSON.stringify(body || {}),
  }),
  getExecutionStatus: () => request('/execution/status'),
  getExecutionJobs: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return request(`/execution/jobs${query ? `?${query}` : ''}`);
  },
  getExecutionJob: (id) => request(`/execution/jobs/${id}`),
  createExecutionJob: (payload) => request('/execution/jobs', { method: 'POST', body: JSON.stringify(payload) }),
  cancelExecutionJob: (id) => request(`/execution/jobs/${id}/cancel`, { method: 'POST' }),
  clearCompletedExecutionJobs: () => request('/execution/jobs/clear-completed', { method: 'POST' }),
  clearFailedExecutionJobs: () => request('/execution/jobs/clear-failed', { method: 'POST' }),
  cancelQueuedExecutionJobs: () => request('/execution/jobs/cancel-queued', { method: 'POST' }),
  cancelQueuedPollingJobs: () => request('/execution/jobs/cancel-queued-polling', { method: 'POST' }),
  pausePolling: () => request('/execution/polling/pause', { method: 'POST' }),
  resumePolling: () => request('/execution/polling/resume', { method: 'POST' }),
  getDevice: (id) => request(`/devices/${id}`),
  getDeviceHealth: (id) => request(`/devices/${id}/health`),
  getDeviceObjects: (id) => request(`/devices/${id}/objects`),
  deleteDevice: (id) => request(`/devices/${id}`, { method: 'DELETE' }),
  clearDevices: () => request('/devices/clear', { method: 'POST' }),
  discoverBacnetIp: (timeoutMs = 5000) => request('/bacnet/ip/discover', {
    method: 'POST',
    body: JSON.stringify({ timeoutMs }),
  }),
  getBacnetMstpStatus: () => request('/bacnet/mstp/status'),
  openBacnetMstp: (data) => request('/bacnet/mstp/open', { method: 'POST', body: JSON.stringify(data || {}) }),
  closeBacnetMstp: () => request('/bacnet/mstp/close', { method: 'POST' }),
  discoverBacnetMstp: (data) => request('/bacnet/mstp/discover', { method: 'POST', body: JSON.stringify(data || {}) }),
  getBacnetMstpLogs: () => request('/bacnet/mstp/logs'),
  clearBacnetMstpLogs: () => request('/bacnet/mstp/clear-logs', { method: 'POST' }),
  getBacnetMstpFrames: () => request('/bacnet/mstp/frames'),
  clearBacnetMstpSession: () => request('/bacnet/mstp/clear-session', { method: 'POST' }),
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
