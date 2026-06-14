const LOG_LEVELS = ['info', 'warn', 'error', 'debug'];
const SERVICES = ['system', 'network', 'bacnet', 'modbus', 'mqtt', 'fault'];

let logs = [
  { id: 1, timestamp: new Date(Date.now() - 3600000).toISOString(), level: 'info', service: 'system', message: 'Legion Sentry service started (simulated mode)' },
  { id: 2, timestamp: new Date(Date.now() - 3500000).toISOString(), level: 'info', service: 'network', message: 'eth0 link up — 1000 Mbps full duplex' },
  { id: 3, timestamp: new Date(Date.now() - 3400000).toISOString(), level: 'info', service: 'bacnet', message: 'BACnet/IP bound to UDP port 47808' },
  { id: 4, timestamp: new Date(Date.now() - 3300000).toISOString(), level: 'info', service: 'bacnet', message: 'BACnet MS/TP started on /dev/ttyAMA0 @ 38400 baud' },
  { id: 5, timestamp: new Date(Date.now() - 3200000).toISOString(), level: 'info', service: 'modbus', message: 'Modbus TCP listener started on port 502' },
  { id: 6, timestamp: new Date(Date.now() - 3100000).toISOString(), level: 'warn', service: 'mqtt', message: 'MQTT client disabled — broker connection skipped' },
  { id: 7, timestamp: new Date(Date.now() - 1800000).toISOString(), level: 'info', service: 'bacnet', message: 'Discovered BACnet device instance 1001 at 192.168.1.101' },
  { id: 8, timestamp: new Date(Date.now() - 900000).toISOString(), level: 'debug', service: 'modbus', message: 'Modbus RTU poll cycle completed in 42ms' },
  { id: 9, timestamp: new Date(Date.now() - 300000).toISOString(), level: 'warn', service: 'bacnet', message: 'MS/TP token timeout recovered on MAC 8' },
  { id: 10, timestamp: new Date(Date.now() - 60000).toISOString(), level: 'info', service: 'system', message: 'Health check passed — all core services running' },
];

let nextId = 11;

function addLog({ level = 'info', service = 'system', message }) {
  const entry = {
    id: nextId++,
    timestamp: new Date().toISOString(),
    level: LOG_LEVELS.includes(level) ? level : 'info',
    service: SERVICES.includes(service) ? service : 'system',
    message,
  };
  logs.unshift(entry);
  if (logs.length > 500) logs = logs.slice(0, 500);
  return entry;
}

function getLogs(filter = 'all') {
  if (filter === 'all') return logs;
  return logs.filter((log) => log.service === filter);
}

function clearLogs() {
  logs = [];
  addLog({ level: 'info', service: 'system', message: 'Log buffer cleared by operator' });
  return { success: true, count: logs.length };
}

module.exports = {
  getLogs,
  addLog,
  clearLogs,
};
