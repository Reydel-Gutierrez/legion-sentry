const { ValidationError } = require('../errors/AppError');

function requireObject(body, requestId) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ValidationError('Request body must be a JSON object', undefined, requestId);
  }
  return body;
}

function asInteger(value, field, {
  min = Number.MIN_SAFE_INTEGER,
  max = Number.MAX_SAFE_INTEGER,
  required = false,
  requestId,
} = {}) {
  if (value == null || value === '') {
    if (required) {
      throw new ValidationError(`${field} is required`, { field }, requestId);
    }
    return undefined;
  }
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(num) || num < min || num > max) {
    throw new ValidationError(
      `${field} must be an integer between ${min} and ${max}`,
      { field, value },
      requestId,
    );
  }
  return num;
}

function asBoolean(value, field, { required = false, requestId } = {}) {
  if (value == null) {
    if (required) {
      throw new ValidationError(`${field} is required`, { field }, requestId);
    }
    return undefined;
  }
  if (typeof value === 'boolean') return value;
  if (value === 'true' || value === 1 || value === '1') return true;
  if (value === 'false' || value === 0 || value === '0') return false;
  throw new ValidationError(`${field} must be a boolean`, { field, value }, requestId);
}

function asString(value, field, {
  required = false,
  minLength = 0,
  maxLength = 512,
  pattern,
  requestId,
} = {}) {
  if (value == null || value === '') {
    if (required) {
      throw new ValidationError(`${field} is required`, { field }, requestId);
    }
    return undefined;
  }
  if (typeof value !== 'string') {
    throw new ValidationError(`${field} must be a string`, { field, value }, requestId);
  }
  const trimmed = value.trim();
  if (trimmed.length < minLength || trimmed.length > maxLength) {
    throw new ValidationError(
      `${field} length must be between ${minLength} and ${maxLength}`,
      { field },
      requestId,
    );
  }
  if (pattern && !pattern.test(trimmed)) {
    throw new ValidationError(`${field} has an invalid format`, { field, value: trimmed }, requestId);
  }
  return trimmed;
}

function asId(value, field = 'id', requestId) {
  const id = asString(value, field, {
    required: true,
    minLength: 1,
    maxLength: 128,
    requestId,
  });
  if (!/^[A-Za-z0-9._:-]+$/.test(id)) {
    throw new ValidationError(`${field} has an invalid format`, { field, value: id }, requestId);
  }
  return id;
}

function asBaudRate(value, requestId) {
  const baud = asInteger(value, 'baudRate', {
    min: 1200,
    max: 115200,
    required: false,
    requestId,
  });
  if (baud == null) return undefined;
  const allowed = [1200, 2400, 4800, 9600, 19200, 38400, 57600, 76800, 115200];
  if (!allowed.includes(baud)) {
    throw new ValidationError(
      `baudRate must be one of: ${allowed.join(', ')}`,
      { field: 'baudRate', value: baud },
      requestId,
    );
  }
  return baud;
}

function asSerialPortPath(value, requestId) {
  return asString(value, 'port', {
    required: false,
    minLength: 1,
    maxLength: 256,
    pattern: /^(\/dev\/[\w./-]+|[A-Za-z]:\\.*|COM\d+)$/i,
    requestId,
  });
}

function asMstpMac(value, field = 'mstpMacAddress', { required = false, requestId } = {}) {
  return asInteger(value, field, { min: 0, max: 127, required, requestId });
}

function asNetworkNumber(value, { required = false, requestId } = {}) {
  return asInteger(value, 'networkNumber', { min: 0, max: 65535, required, requestId });
}

function asDeviceInstance(value, { required = false, requestId } = {}) {
  return asInteger(value, 'deviceInstance', { min: 0, max: 4194303, required, requestId });
}

function asTimeoutMs(value, field = 'timeoutMs', {
  min = 100,
  max = 300000,
  required = false,
  requestId,
} = {}) {
  return asInteger(value, field, { min, max, required, requestId });
}

function asPollIntervalMs(value, requestId) {
  return asInteger(value, 'pollIntervalMs', {
    min: 500,
    max: 3600000,
    required: false,
    requestId,
  });
}

function validateDiscoverPointsBody(body, requestId) {
  const obj = body == null ? {} : requireObject(body, requestId);
  return {
    async: asBoolean(obj.async, 'async', { requestId }) === true,
    forceRefresh: asBoolean(obj.forceRefresh, 'forceRefresh', { requestId }) === true,
  };
}

function omitUndefined(obj) {
  const next = {};
  for (const [key, value] of Object.entries(obj || {})) {
    if (value !== undefined) next[key] = value;
  }
  return next;
}

function validateMstpDiscoverBody(body, requestId) {
  const obj = body == null ? {} : requireObject(body, requestId);
  return omitUndefined({
    port: asSerialPortPath(obj.port, requestId),
    baudRate: asBaudRate(obj.baudRate, requestId),
    macAddress: asMstpMac(obj.macAddress, 'macAddress', { requestId }),
    maxMaster: asInteger(obj.maxMaster, 'maxMaster', { min: 1, max: 127, requestId }),
    maxInfoFrames: asInteger(obj.maxInfoFrames, 'maxInfoFrames', { min: 1, max: 100, requestId }),
    networkNumber: asNetworkNumber(obj.networkNumber, { requestId }),
    timeoutMs: asTimeoutMs(obj.timeoutMs, 'timeoutMs', { requestId }),
    whoIsRetries: asInteger(obj.whoIsRetries, 'whoIsRetries', { min: 1, max: 20, requestId }),
    retryIntervalMs: asTimeoutMs(obj.retryIntervalMs, 'retryIntervalMs', {
      min: 100,
      max: 60000,
      requestId,
    }),
    tokenMode: asBoolean(obj.tokenMode, 'tokenMode', { requestId }),
  });
}

function validateBacnetIpDiscoverBody(body, requestId) {
  const obj = body == null ? {} : requireObject(body, requestId);
  return {
    timeoutMs: asTimeoutMs(obj.timeoutMs, 'timeoutMs', {
      min: 500,
      max: 60000,
      requestId,
    }) || 5000,
  };
}

function validateManagedDevicePatch(body, requestId) {
  const obj = requireObject(body, requestId);
  const patch = {};
  if (Object.prototype.hasOwnProperty.call(obj, 'enabled')) {
    patch.enabled = asBoolean(obj.enabled, 'enabled', { required: true, requestId });
  }
  if (Object.prototype.hasOwnProperty.call(obj, 'objectName')) {
    patch.objectName = asString(obj.objectName, 'objectName', { maxLength: 128, requestId });
  }
  if (Object.prototype.hasOwnProperty.call(obj, 'label')) {
    patch.objectName = asString(obj.label, 'label', { maxLength: 128, requestId });
  }
  return patch;
}

function validateManagePointsBody(body, requestId) {
  const obj = requireObject(body, requestId);
  if (!Array.isArray(obj.pointKeys)) {
    throw new ValidationError('pointKeys must be an array', { field: 'pointKeys' }, requestId);
  }
  return {
    pointKeys: obj.pointKeys.map((key, index) => {
      if (typeof key !== 'string' || !key.trim()) {
        throw new ValidationError(`pointKeys[${index}] must be a non-empty string`, {
          field: `pointKeys[${index}]`,
        }, requestId);
      }
      return key.trim();
    }),
  };
}

function validatePointPollPatch(body, requestId) {
  const obj = requireObject(body, requestId);
  const patch = {};
  if (Object.prototype.hasOwnProperty.call(obj, 'pollGroup')) {
    const group = asString(obj.pollGroup, 'pollGroup', { required: true, requestId });
    const allowed = ['fast', 'normal', 'slow', 'manual'];
    if (!allowed.includes(group)) {
      throw new ValidationError(
        `pollGroup must be one of: ${allowed.join(', ')}`,
        { field: 'pollGroup', value: group },
        requestId,
      );
    }
    patch.pollGroup = group;
  }
  if (Object.prototype.hasOwnProperty.call(obj, 'pollIntervalMs')) {
    patch.pollIntervalMs = asPollIntervalMs(obj.pollIntervalMs, requestId);
  }
  if (Object.prototype.hasOwnProperty.call(obj, 'pollingEnabled')) {
    patch.pollingEnabled = asBoolean(obj.pollingEnabled, 'pollingEnabled', {
      required: true,
      requestId,
    });
  }
  return patch;
}

function validateSerialConfigBody(body, requestId) {
  const obj = body == null ? {} : requireObject(body, requestId);
  return omitUndefined({
    port: asSerialPortPath(obj.port, requestId),
    baudRate: asBaudRate(obj.baudRate, requestId),
  });
}

module.exports = {
  requireObject,
  asInteger,
  asBoolean,
  asString,
  asId,
  asBaudRate,
  asSerialPortPath,
  asMstpMac,
  asNetworkNumber,
  asDeviceInstance,
  asTimeoutMs,
  asPollIntervalMs,
  validateDiscoverPointsBody,
  validateMstpDiscoverBody,
  validateBacnetIpDiscoverBody,
  validateManagedDevicePatch,
  validateManagePointsBody,
  validatePointPollPatch,
  validateSerialConfigBody,
};
