const { sanitizeText } = require('../bacnet/bacnetApduCodec');

function pointKey(managedDeviceId, objectType, objectInstance) {
  return `${managedDeviceId}:${objectType}:${objectInstance}`;
}

function formatStatusFlags(statusFlags) {
  if (statusFlags == null || statusFlags === '') return '—';
  if (typeof statusFlags === 'string' && /^[01]+$/.test(statusFlags)) {
    const labels = ['in-alarm', 'fault', 'overridden', 'out-of-service'];
    const active = [];
    for (let i = 0; i < Math.min(statusFlags.length, labels.length); i += 1) {
      if (statusFlags[i] === '1') active.push(labels[i]);
    }
    return active.length ? active.join(', ') : 'ok';
  }
  return String(statusFlags);
}

function parsePointKeyInput(managedDeviceId, rawKey) {
  const text = String(rawKey || '').trim();
  if (!text) return null;

  const fullPrefix = `${managedDeviceId}:`;
  const keyBody = text.startsWith(fullPrefix) ? text.slice(fullPrefix.length) : text;
  const parts = keyBody.split(':');
  if (parts.length < 2) return null;

  const objectType = Number(parts[0]);
  const objectInstance = Number(parts[1]);
  if (!Number.isInteger(objectType) || !Number.isInteger(objectInstance)) return null;

  return { objectType, objectInstance };
}

function sanitizePointTextFields(point) {
  return {
    ...point,
    objectName: sanitizeText(point.objectName),
    description: sanitizeText(point.description),
  };
}

module.exports = {
  pointKey,
  formatStatusFlags,
  parsePointKeyInput,
  sanitizePointTextFields,
};
