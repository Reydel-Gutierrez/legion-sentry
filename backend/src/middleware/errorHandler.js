const { fromUnknown, AppError } = require('../errors/AppError');
const logger = require('../services/logger');

function notFoundHandler(req, res, next) {
  next(new AppError(`Route not found: ${req.method} ${req.originalUrl}`, {
    statusCode: 404,
    code: 'ROUTE_NOT_FOUND',
    requestId: req.requestId,
  }));
}

function errorHandler(err, req, res, _next) {
  const error = fromUnknown(err, req.requestId);

  const logLevel = error.statusCode >= 500 ? 'error' : 'warn';
  logger.log({
    level: logLevel,
    source: 'api',
    event: 'request_failed',
    message: error.message,
    requestId: error.requestId || req.requestId,
    code: error.code,
    statusCode: error.statusCode,
    path: req.originalUrl,
    method: req.method,
    stack: error.statusCode >= 500 ? (err.stack || error.stack) : undefined,
  });

  if (res.headersSent) {
    return;
  }

  // Preserve legacy result payloads used by point-discovery job failures.
  if (error.result && typeof error.result === 'object' && error.result.success === false) {
    return res.status(error.statusCode).json({
      ...error.result,
      error: {
        code: error.code,
        message: error.message,
        details: error.details || error.result.details || {},
        requestId: error.requestId || req.requestId,
      },
      requestId: error.requestId || req.requestId,
    });
  }

  const isProduction = process.env.NODE_ENV === 'production';
  const body = {
    success: false,
    error: {
      code: error.code,
      message: error.expose || !isProduction
        ? error.message
        : 'Internal server error',
      details: error.details || {},
      requestId: error.requestId || req.requestId,
    },
    requestId: error.requestId || req.requestId,
  };

  if (!isProduction && error.statusCode >= 500 && (err.stack || error.stack)) {
    body.error.stack = err.stack || error.stack;
  }

  res.status(error.statusCode).json(body);
}

module.exports = {
  errorHandler,
  notFoundHandler,
};
