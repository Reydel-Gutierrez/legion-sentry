const logsService = require('../logs');

/**
 * Structured logger that remains compatible with the existing Logs page
 * (message + service + level persisted to logs.jsonl) while also emitting
 * richer JSON lines to stdout for appliance diagnostics.
 */
function buildEntry({
  level = 'info',
  source = 'system',
  event = undefined,
  message,
  requestId = undefined,
  operationId = undefined,
  ...fields
} = {}) {
  const safeFields = { ...fields };
  delete safeFields.password;
  delete safeFields.token;
  delete safeFields.cookie;
  delete safeFields.authorization;
  delete safeFields.stack;

  return {
    timestamp: new Date().toISOString(),
    level,
    source,
    event,
    message: message || event || 'log',
    requestId,
    operationId,
    ...safeFields,
  };
}

function persistCompatible(entry) {
  if (process.env.NODE_ENV === 'test' || process.env.SENTRY_SILENCE_LOG_PERSIST === '1') {
    return;
  }
  const serviceMap = {
    'managed-point-service': 'bacnet',
    'managed-device-service': 'bacnet',
    'mstp-runtime': 'bacnet',
    'point-discovery': 'bacnet',
    'field-execution': 'bacnet',
    polling: 'bacnet',
    heartbeat: 'bacnet',
    api: 'system',
    validation: 'system',
  };
  const service = serviceMap[entry.source] || (
    ['system', 'network', 'bacnet', 'modbus', 'mqtt', 'fault', 'interfaces', 'auth'].includes(entry.source)
      ? entry.source
      : 'system'
  );

  const parts = [];
  if (entry.event) parts.push(`[${entry.event}]`);
  parts.push(entry.message);
  if (entry.requestId) parts.push(`requestId=${entry.requestId}`);
  if (entry.operationId) parts.push(`operationId=${entry.operationId}`);
  if (entry.managedDeviceId) parts.push(`device=${entry.managedDeviceId}`);
  if (entry.durationMs != null) parts.push(`durationMs=${entry.durationMs}`);

  logsService.addLog({
    level: entry.level,
    service,
    message: parts.join(' '),
  });
}

function log(payload) {
  const entry = buildEntry(payload);
  const line = JSON.stringify(entry);
  if (entry.level === 'error') {
    console.error(line);
  } else if (entry.level === 'warn') {
    console.warn(line);
  } else if (entry.level === 'debug') {
    if (process.env.LOG_LEVEL === 'debug') console.log(line);
  } else {
    console.log(line);
  }

  // Avoid flooding persistent logs during tight polling loops
  if (entry.event && /poll_tick|heartbeat_tick|worker_tick/.test(entry.event)) {
    return entry;
  }

  try {
    persistCompatible(entry);
  } catch {
    // Persistence must never break control plane paths
  }
  return entry;
}

module.exports = {
  log,
  info: (payload) => log({ ...payload, level: 'info' }),
  warn: (payload) => log({ ...payload, level: 'warn' }),
  error: (payload) => log({ ...payload, level: 'error' }),
  debug: (payload) => log({ ...payload, level: 'debug' }),
  buildEntry,
};
