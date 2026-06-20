const fs = require('fs');
const path = require('path');

const LOGS_PATH = path.join(__dirname, '../../data/logs.jsonl');
const LOG_LEVELS = ['info', 'warn', 'error', 'debug'];
const SERVICES = ['system', 'network', 'bacnet', 'modbus', 'mqtt', 'fault', 'interfaces', 'auth'];

let logs = [];
let nextId = 1;
let loaded = false;

function ensureLogsFile() {
  const dir = path.dirname(LOGS_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  if (!fs.existsSync(LOGS_PATH)) {
    fs.writeFileSync(LOGS_PATH, '', 'utf8');
  }
}

function loadLogsFromDisk() {
  if (loaded) return;
  loaded = true;
  ensureLogsFile();

  try {
    const raw = fs.readFileSync(LOGS_PATH, 'utf8');
    const lines = raw.split('\n').filter(Boolean);
    logs = lines.map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    }).filter(Boolean);

    const maxId = logs.reduce((max, entry) => Math.max(max, entry.id || 0), 0);
    nextId = maxId + 1;
    logs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  } catch {
    logs = [];
  }
}

function appendLogToDisk(entry) {
  ensureLogsFile();
  fs.appendFileSync(LOGS_PATH, `${JSON.stringify(entry)}\n`, 'utf8');
}

function addLog({ level = 'info', service = 'system', message }) {
  loadLogsFromDisk();

  const entry = {
    id: nextId++,
    timestamp: new Date().toISOString(),
    level: LOG_LEVELS.includes(level) ? level : 'info',
    service: SERVICES.includes(service) ? service : 'system',
    message,
  };

  logs.unshift(entry);
  if (logs.length > 500) logs = logs.slice(0, 500);
  appendLogToDisk(entry);
  return entry;
}

function getLogs(filter = 'all') {
  loadLogsFromDisk();
  if (filter === 'all') return logs;
  return logs.filter((log) => log.service === filter);
}

function clearLogs() {
  ensureLogsFile();
  fs.writeFileSync(LOGS_PATH, '', 'utf8');
  logs = [];
  nextId = 1;
  addLog({ level: 'info', service: 'system', message: 'Log buffer cleared' });
  return { success: true, count: 0 };
}

function seedStartupLog() {
  loadLogsFromDisk();
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
  LOGS_PATH,
};
