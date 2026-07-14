const { test, assert, run } = require('../harness');
const { errorHandler } = require('../../src/middleware/errorHandler');
const { RuntimeUnavailableError, ValidationError, NotFoundError } = require('../../src/errors/AppError');
const devicesRouterPath = require.resolve('../../src/routes/devices');

test('devices route module loads and mounts discover-points handler', () => {
  // Ensure require succeeds with the rewritten contract
  delete require.cache[devicesRouterPath];
  const router = require('../../src/routes/devices');
  assert.ok(router);
  assert.strictEqual(typeof router, 'function');
});

test('pointDiscovery is the canonical service used by field execution', () => {
  const fieldExecutionEngine = require('../../src/services/execution/fieldExecutionEngine');
  const pointDiscovery = require('../../src/services/devices/pointDiscovery');
  assert.strictEqual(typeof fieldExecutionEngine.discoverPointsForManagedDevice, 'function');
  assert.strictEqual(typeof pointDiscovery.discoverPointsForDevice, 'function');
  // Explicit: managedPoints must NOT export runPointDiscovery (circular-dep footgun)
  const managedPoints = require('../../src/services/devices/managedPoints');
  assert.strictEqual(typeof managedPoints.runPointDiscovery, 'undefined');
});

function invokeError(err) {
  let statusCode = null;
  let payload = null;
  const res = {
    headersSent: false,
    status(code) { statusCode = code; return this; },
    json(body) { payload = body; return this; },
  };
  errorHandler(err, { requestId: 'rid', originalUrl: '/api/test', method: 'POST' }, res, () => {});
  return { statusCode, payload };
}

test('runtime unavailable returns structured 503', () => {
  const { statusCode, payload } = invokeError(
    new RuntimeUnavailableError('runtime down', { port: '/dev/serial0' }, 'rid'),
  );
  assert.strictEqual(statusCode, 503);
  assert.strictEqual(payload.error.code, 'RUNTIME_UNAVAILABLE');
  assert.strictEqual(payload.success, false);
});

test('validation error returns 400', () => {
  const { statusCode, payload } = invokeError(new ValidationError('bad id', { field: 'id' }, 'rid'));
  assert.strictEqual(statusCode, 400);
  assert.strictEqual(payload.error.code, 'VALIDATION_ERROR');
});

test('not found returns 404', () => {
  const { statusCode, payload } = invokeError(new NotFoundError('Managed device not found'));
  assert.strictEqual(statusCode, 404);
  assert.strictEqual(payload.error.code, 'NOT_FOUND');
});

run();
