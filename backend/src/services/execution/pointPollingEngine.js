const fieldExecutionEngine = require('./fieldExecutionEngine');
const managedDevices = require('../devices/managedDevices');
const pointsStore = require('../devices/managedPointsStore');
const { BACNET_PROPERTIES } = require('../bacnet/bacnetApduCodec');

const DEFAULT_POLL_INTERVAL_MS = 5000;

let pollTimer = null;
let running = false;

function getPollIntervalMs() {
  return DEFAULT_POLL_INTERVAL_MS;
}

function getPollablePoints() {
  const managed = managedDevices.getManagedDevices();
  const enabledDeviceIds = new Set(
    (managed.devices || [])
      .filter((device) => device.enabled)
      .map((device) => device.id),
  );

  return pointsStore.loadPoints().filter((point) => enabledDeviceIds.has(point.managedDeviceId));
}

function tick() {
  if (!running) return;

  const points = getPollablePoints();
  for (const point of points) {
    if (fieldExecutionEngine.hasPendingJobForPoint(point.id)) continue;

    fieldExecutionEngine.submitReadProperty({
      source: 'polling',
      managedDeviceId: point.managedDeviceId,
      managedPointId: point.id,
      objectType: point.objectType,
      objectInstance: point.objectInstance,
      propertyIdentifier: BACNET_PROPERTIES.presentValue,
      maxRetries: 1,
      timeoutMs: 30000,
    });
  }
}

function start() {
  if (pollTimer) return;
  running = true;
  pollTimer = setInterval(() => {
    tick();
  }, getPollIntervalMs());
  tick();
}

function stop() {
  running = false;
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

function getStatus() {
  return {
    running,
    pollIntervalMs: getPollIntervalMs(),
    pollablePoints: getPollablePoints().length,
  };
}

module.exports = {
  start,
  stop,
  getStatus,
  tick,
};
