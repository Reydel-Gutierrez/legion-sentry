const { test, assert, run } = require('../harness');
const { AppError, ValidationError, NotFoundError, ConflictError } = require('../../src/errors/AppError');
const { errorHandler } = require('../../src/middleware/errorHandler');
const { asId, validateDiscoverPointsBody, asBaudRate } = require('../../src/middleware/validate');
const { deriveRuntimeState, RUNTIME_STATE } = require('../../src/services/bacnet/mstpRuntimeState');
const pointDiscovery = require('../../src/services/devices/pointDiscovery');

test('pointDiscovery exports canonical discoverPointsForDevice', () => {
  assert.strictEqual(typeof pointDiscovery.discoverPointsForDevice, 'function');
  assert.strictEqual(typeof pointDiscovery.runPointDiscovery, 'function');
});

test('runPointDiscovery is an alias of discoverPointsForDevice contract', () => {
  assert.notStrictEqual(pointDiscovery.runPointDiscovery, undefined);
  assert.strictEqual(pointDiscovery.runPointDiscovery.length, 1);
});

test('invalid managed device id fails validation', () => {
  assert.throws(() => asId('bad id!', 'id'), (err) => err instanceof ValidationError);
});

test('valid managed device id passes validation', () => {
  assert.strictEqual(asId('managed-mstp-2000004-mac-4', 'id'), 'managed-mstp-2000004-mac-4');
});

test('discover-points body validates async flag', () => {
  const body = validateDiscoverPointsBody({ async: true });
  assert.strictEqual(body.async, true);
});

test('invalid baud rate is rejected', () => {
  assert.throws(() => asBaudRate(1234), (err) => err instanceof ValidationError);
});

test('runtime state prefers busy over active when exclusive work is running', () => {
  assert.strictEqual(
    deriveRuntimeState({ open: true, pointDiscoveryInProgress: true }),
    RUNTIME_STATE.BUSY,
  );
});

test('runtime state is stopped when serial is closed', () => {
  assert.strictEqual(deriveRuntimeState({ open: false }), RUNTIME_STATE.STOPPED);
});

test('central error middleware returns documented shape', () => {
  const err = new ConflictError(
    'Point discovery is already running for this device.',
    'POINT_DISCOVERY_ALREADY_RUNNING',
    { managedDeviceId: 'dev-1' },
    'req-1',
  );

  let statusCode = null;
  let payload = null;
  const res = {
    headersSent: false,
    status(code) {
      statusCode = code;
      return this;
    },
    json(body) {
      payload = body;
      return this;
    },
  };

  errorHandler(err, { requestId: 'req-1', originalUrl: '/api/x', method: 'POST' }, res, () => {});

  assert.strictEqual(statusCode, 409);
  assert.strictEqual(payload.success, false);
  assert.strictEqual(payload.error.code, 'POINT_DISCOVERY_ALREADY_RUNNING');
  assert.strictEqual(payload.error.requestId, 'req-1');
  assert.ok(payload.error.message);
});

test('AppError subclasses set expected status codes', () => {
  assert.strictEqual(new ValidationError('bad').statusCode, 400);
  assert.strictEqual(new NotFoundError('missing').statusCode, 404);
  assert.strictEqual(new AppError('x', { statusCode: 503, code: 'RUNTIME_UNAVAILABLE' }).statusCode, 503);
});

run();
