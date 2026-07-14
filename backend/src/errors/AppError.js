class AppError extends Error {
  constructor(message, {
    statusCode = 500,
    code = 'INTERNAL_ERROR',
    details = undefined,
    requestId = undefined,
    expose = true,
  } = {}) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.requestId = requestId;
    this.expose = expose;
    this.isOperational = true;
  }

  toJSON() {
    return {
      code: this.code,
      message: this.message,
      details: this.details || {},
      requestId: this.requestId,
    };
  }
}

class ValidationError extends AppError {
  constructor(message, details, requestId) {
    super(message, {
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      details,
      requestId,
    });
    this.name = 'ValidationError';
  }
}

class NotFoundError extends AppError {
  constructor(message = 'Resource not found', details, requestId) {
    super(message, {
      statusCode: 404,
      code: 'NOT_FOUND',
      details,
      requestId,
    });
    this.name = 'NotFoundError';
  }
}

class ConflictError extends AppError {
  constructor(message, code = 'CONFLICT', details, requestId) {
    super(message, {
      statusCode: 409,
      code,
      details,
      requestId,
    });
    this.name = 'ConflictError';
  }
}

class RuntimeUnavailableError extends AppError {
  constructor(message = 'BACnet MS/TP runtime is unavailable', details, requestId) {
    super(message, {
      statusCode: 503,
      code: 'RUNTIME_UNAVAILABLE',
      details,
      requestId,
    });
    this.name = 'RuntimeUnavailableError';
  }
}

class SerialPortError extends AppError {
  constructor(message, details, requestId) {
    super(message, {
      statusCode: 503,
      code: 'SERIAL_PORT_ERROR',
      details,
      requestId,
    });
    this.name = 'SerialPortError';
  }
}

class BacnetTimeoutError extends AppError {
  constructor(message = 'BACnet request timed out', details, requestId) {
    super(message, {
      statusCode: 504,
      code: 'BACNET_TIMEOUT',
      details,
      requestId,
    });
    this.name = 'BacnetTimeoutError';
  }
}

class DiscoveryError extends AppError {
  constructor(message, {
    code = 'DISCOVERY_FAILED',
    statusCode = 502,
    details,
    requestId,
    result,
  } = {}) {
    super(message, {
      statusCode,
      code,
      details,
      requestId,
    });
    this.name = 'DiscoveryError';
    this.result = result;
  }
}

function fromUnknown(err, requestId) {
  if (err instanceof AppError) {
    if (requestId && !err.requestId) err.requestId = requestId;
    return err;
  }

  const statusCode = err.statusCode || err.status || 500;
  const code = err.code || (statusCode >= 500 ? 'INTERNAL_ERROR' : 'REQUEST_FAILED');
  const wrapped = new AppError(err.message || 'Internal server error', {
    statusCode,
    code,
    details: err.details,
    requestId,
    expose: statusCode < 500,
  });
  if (err.result) wrapped.result = err.result;
  if (err.job) wrapped.job = err.job;
  wrapped.cause = err;
  return wrapped;
}

module.exports = {
  AppError,
  ValidationError,
  NotFoundError,
  ConflictError,
  RuntimeUnavailableError,
  SerialPortError,
  BacnetTimeoutError,
  DiscoveryError,
  fromUnknown,
};
