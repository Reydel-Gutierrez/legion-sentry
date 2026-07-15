/**
 * BACnet WriteProperty foundation (disabled by default).
 * Phase 2 exposes the contract and validation only — physical writes are blocked.
 */
const fieldExecutionEngine = require('../execution/fieldExecutionEngine');

const WRITE_CAPABILITY = Object.freeze({
  enabled: false,
  defaultDisabled: true,
  reason: 'WriteProperty is disabled by default to protect field equipment',
});

function getWriteCapability(point = null) {
  const base = { ...WRITE_CAPABILITY };
  if (!point) return base;
  return {
    ...base,
    writable: Boolean(point.writable),
    commandable: Boolean(point.commandable),
    dataType: point.dataType || point.bacnetType || null,
    priorityArraySupported: Boolean(point.priorityArraySupported),
    allowedRange: point.allowedRange || null,
  };
}

function validateWriteRequest(input = {}) {
  const errors = [];
  if (input.objectType == null || !Number.isInteger(Number(input.objectType))) {
    errors.push('objectType is required');
  }
  if (input.objectInstance == null || !Number.isInteger(Number(input.objectInstance))) {
    errors.push('objectInstance is required');
  }
  if (input.propertyIdentifier == null || !Number.isInteger(Number(input.propertyIdentifier))) {
    errors.push('propertyIdentifier is required');
  }
  if (input.value === undefined) {
    errors.push('value is required');
  }
  if (input.commandable && (input.priority == null || !Number.isInteger(Number(input.priority)))) {
    errors.push('priority is required for commandable objects (1-16)');
  }
  if (input.priority != null) {
    const p = Number(input.priority);
    if (!Number.isInteger(p) || p < 1 || p > 16) {
      errors.push('priority must be an integer between 1 and 16');
    }
  }
  return errors;
}

async function writeProperty(input = {}) {
  if (!WRITE_CAPABILITY.enabled && input.force !== true) {
    const error = new Error('WriteProperty is disabled');
    error.statusCode = 501;
    error.code = 'WRITE_NOT_IMPLEMENTED';
    throw error;
  }

  const errors = validateWriteRequest(input);
  if (errors.length) {
    const error = new Error(errors.join('; '));
    error.statusCode = 400;
    error.code = 'WRITE_VALIDATION_ERROR';
    error.details = { errors };
    throw error;
  }

  // Route through the execution engine contract; current engine rejects writes.
  return fieldExecutionEngine.submitWriteProperty({
    source: input.source || 'ui',
    managedDeviceId: input.managedDeviceId,
    managedPointId: input.managedPointId,
    objectType: Number(input.objectType),
    objectInstance: Number(input.objectInstance),
    propertyIdentifier: Number(input.propertyIdentifier),
    value: input.value,
    priority: input.priority != null ? Number(input.priority) : undefined,
  });
}

module.exports = {
  WRITE_CAPABILITY,
  getWriteCapability,
  validateWriteRequest,
  writeProperty,
};
