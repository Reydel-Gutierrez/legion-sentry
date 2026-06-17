const LOG_LEVELS = ['info', 'warn', 'error', 'debug'];
const SERVICES = ['system', 'network', 'bacnet', 'modbus', 'mqtt', 'fault'];

let logs = [];
let nextId = 1;

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
  addLog({ level: 'info', service: 'system', message: 'Log buffer cleared' });
  return { success: true, count: logs.length };
}

function seedStartupLog() {
  addLog({
    level: 'info',
    service: 'system',
    message: 'Legion Sentry API server started',
  });
}

module.exports = {
  getLogs,
  addLog,
  clearLogs,
  seedStartupLog,
};
