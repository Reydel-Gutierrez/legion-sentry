const { test, assert, run } = require('../harness');
const { NotFoundError, ConflictError } = require('../../src/errors/AppError');

const managedDevices = require('../../src/services/devices/managedDevices');
const bacnetMstpService = require('../../src/services/bacnet/bacnetMstp.service');
const discoveredStore = require('../../src/services/devices/discoveredPointsStore');
const pointDiscovery = require('../../src/services/devices/pointDiscovery');

const deviceId = 'managed-mstp-test-mac-7';
const fakeDevice = {
  id: deviceId,
  transport: 'BACnet MS/TP',
  enabled: true,
  deviceInstance: 7,
  mstpMacAddress: 7,
  networkNumber: 2,
};

const originalGet = managedDevices.getManagedDeviceById;
const originalDiscover = bacnetMstpService.discoverPointsForDevice;
const originalBusy = bacnetMstpService.isMstpBusBusy;
const originalSave = discoveredStore.saveDiscoveryResult;
const originalGetRecord = discoveredStore.getRecordForDevice;

let savedRecord = null;

managedDevices.getManagedDeviceById = (id) => {
  if (id === deviceId) return { device: { ...fakeDevice } };
  if (id === 'managed-disabled') {
    return { device: { ...fakeDevice, id: 'managed-disabled', enabled: false } };
  }
  return null;
};

bacnetMstpService.isMstpBusBusy = () => false;
discoveredStore.saveDiscoveryResult = (managedDeviceId, points, lastDiscoveryAt) => {
  savedRecord = { managedDeviceId, points, lastDiscoveryAt };
  return savedRecord;
};
discoveredStore.getRecordForDevice = (managedDeviceId) => {
  if (savedRecord && savedRecord.managedDeviceId === managedDeviceId) return savedRecord;
  return null;
};

test('missing managed device returns 404', async () => {
  await assert.rejects(
    () => pointDiscovery.discoverPointsForDevice({ managedDeviceId: 'no-such-device' }),
    (err) => err instanceof NotFoundError && err.statusCode === 404,
  );
});

test('successful discovery returns normalized point data', async () => {
  bacnetMstpService.discoverPointsForDevice = async () => ({
    points: [{
      objectType: 0,
      objectInstance: 1,
      objectTypeLabel: 'analog-input',
      objectName: 'AI-1',
      presentValue: 21.5,
      statusFlags: '0000',
    }],
    logs: [],
  });

  const result = await pointDiscovery.discoverPointsForDevice({
    managedDeviceId: deviceId,
    requestId: 'req-ok',
  });

  assert.strictEqual(result.success, true);
  assert.strictEqual(result.discoveredCount, 1);
  assert.strictEqual(result.points[0].objectName, 'AI-1');
  assert.strictEqual(result.requestId, 'req-ok');
});

test('duplicate discovery returns 409', async () => {
  let resolveSlow;
  bacnetMstpService.discoverPointsForDevice = () => new Promise((resolve) => {
    resolveSlow = () => resolve({ points: [], logs: [] });
  });

  const first = pointDiscovery.discoverPointsForDevice({
    managedDeviceId: deviceId,
    requestId: 'req-1',
  });

  await new Promise((r) => setTimeout(r, 10));

  await assert.rejects(
    () => pointDiscovery.discoverPointsForDevice({
      managedDeviceId: deviceId,
      requestId: 'req-2',
    }),
    (err) => err instanceof ConflictError
      && err.statusCode === 409
      && err.code === 'POINT_DISCOVERY_ALREADY_RUNNING',
  );

  resolveSlow();
  await first;
});

test('failed discovery releases lock and can be retried', async () => {
  let calls = 0;
  bacnetMstpService.discoverPointsForDevice = async () => {
    calls += 1;
    if (calls === 1) {
      const err = new Error('port unavailable');
      err.code = 'SERIAL_PORT_ERROR';
      err.statusCode = 503;
      throw err;
    }
    return { points: [], logs: [] };
  };

  await assert.rejects(
    () => pointDiscovery.discoverPointsForDevice({ managedDeviceId: deviceId }),
    (err) => err.statusCode === 503,
  );

  const retry = await pointDiscovery.discoverPointsForDevice({ managedDeviceId: deviceId });
  assert.strictEqual(retry.success, true);
  assert.strictEqual(calls, 2);
});

test('disabled device is rejected with DEVICE_DISABLED', async () => {
  await assert.rejects(
    () => pointDiscovery.discoverPointsForDevice({ managedDeviceId: 'managed-disabled' }),
    (err) => err.statusCode === 400 && err.code === 'DEVICE_DISABLED',
  );
});

test('isPointDiscoveryActive is false after completion', () => {
  assert.strictEqual(pointDiscovery.isPointDiscoveryActive(deviceId), false);
});

run().finally(() => {
  managedDevices.getManagedDeviceById = originalGet;
  bacnetMstpService.discoverPointsForDevice = originalDiscover;
  bacnetMstpService.isMstpBusBusy = originalBusy;
  discoveredStore.saveDiscoveryResult = originalSave;
  discoveredStore.getRecordForDevice = originalGetRecord;
});
