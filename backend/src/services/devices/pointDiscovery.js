const crypto = require('crypto');
const managedDevices = require('./managedDevices');
const discoveredStore = require('./discoveredPointsStore');
const pointsStore = require('./managedPointsStore');
const bacnetMstpService = require('../bacnet/bacnetMstp.service');
const { pointKey, formatStatusFlags, sanitizePointTextFields } = require('./pointHelpers');
const {
  AppError,
  NotFoundError,
  ValidationError,
  ConflictError,
  DiscoveryError,
  RuntimeUnavailableError,
  SerialPortError,
} = require('../../errors/AppError');
const logger = require('../logger');

const MSTP_TRANSPORT = 'BACnet MS/TP';

/** In-process lock: one point-discovery operation per managed device. */
const activeByDevice = new Map();

function getManagedDeviceRecord(managedDeviceId) {
  const result = managedDevices.getManagedDeviceById(managedDeviceId);
  return result?.device || null;
}

function validateManagedDeviceForPointDiscovery(device) {
  if (!device) {
    throw new NotFoundError('Managed device not found');
  }
  if (device.transport !== MSTP_TRANSPORT && device.transport !== 'mstp') {
    throw new ValidationError(
      'Point discovery is only supported for BACnet MS/TP managed devices',
      { transport: device.transport },
    );
  }
  if (!device.enabled) {
    throw new AppError('Managed device is disabled — enable it before discovering points', {
      statusCode: 400,
      code: 'DEVICE_DISABLED',
      details: { managedDeviceId: device.id },
    });
  }
  return device;
}

function normalizeDiscoveredPoint(point) {
  return {
    ...sanitizePointTextFields(point),
    status: formatStatusFlags(point.statusFlags),
  };
}

function getManagedPointKeys(managedDeviceId) {
  return new Set(
    pointsStore.loadPoints()
      .filter((point) => point.managedDeviceId === managedDeviceId)
      .map((point) => pointKey(managedDeviceId, point.objectType, point.objectInstance)),
  );
}

function listDiscoveredPoints(managedDeviceId) {
  const record = discoveredStore.getRecordForDevice(managedDeviceId);
  const managedKeys = getManagedPointKeys(managedDeviceId);
  const points = (record?.points || [])
    .map(normalizeDiscoveredPoint)
    .map((point) => ({
      ...point,
      pointKey: pointKey(managedDeviceId, point.objectType, point.objectInstance),
      alreadyManaged: managedKeys.has(
        pointKey(managedDeviceId, point.objectType, point.objectInstance),
      ),
    }))
    .sort((a, b) => {
      if (a.objectType !== b.objectType) return a.objectType - b.objectType;
      return a.objectInstance - b.objectInstance;
    });

  return {
    managedDeviceId,
    lastDiscoveryAt: record?.lastDiscoveryAt ?? null,
    points,
    total: points.length,
  };
}

function isPointDiscoveryActive(managedDeviceId) {
  if (managedDeviceId) return activeByDevice.has(managedDeviceId);
  return activeByDevice.size > 0;
}

function releaseDeviceLock(managedDeviceId, operationId) {
  const current = activeByDevice.get(managedDeviceId);
  if (current && current.operationId === operationId) {
    activeByDevice.delete(managedDeviceId);
  }
}

function mapTransportError(err, device, requestId) {
  const message = err.message || 'Point discovery failed';
  const details = {
    deviceInstance: device.deviceInstance,
    networkNumber: device.networkNumber,
    mstpMac: device.mstpMacAddress,
  };

  if (err.code === 'POINT_DISCOVERY_IN_PROGRESS' || err.code === 'DISCOVERY_IN_PROGRESS') {
    return new ConflictError(message, 'POINT_DISCOVERY_ALREADY_RUNNING', details, requestId);
  }
  if (err.code === 'SERIAL_MONITOR_RUNNING' || /port already open|cannot open|ENOENT|EACCES/i.test(message)) {
    return new SerialPortError(message, details, requestId);
  }
  if (err.code === 'RUNTIME_UNAVAILABLE' || /runtime.*(unavailable|stopped|faulted)/i.test(message)) {
    return new RuntimeUnavailableError(message, details, requestId);
  }
  if (err.code === 'JOB_CANCELLED') {
    return err;
  }

  return new DiscoveryError(message, {
    code: err.code || 'POINT_DISCOVERY_FAILED',
    statusCode: err.statusCode || 502,
    details,
    requestId,
    result: err.result,
  });
}

/**
 * Canonical managed-point discovery entry point.
 * Prefer this name for new callers; `runPointDiscovery` is retained as an alias.
 */
async function discoverPointsForDevice({
  managedDeviceId,
  forceRefresh = false,
  requestId,
  onProgress,
  shouldCancel,
} = {}) {
  if (!managedDeviceId || typeof managedDeviceId !== 'string') {
    throw new ValidationError('managedDeviceId is required', { field: 'managedDeviceId' }, requestId);
  }

  const device = validateManagedDeviceForPointDiscovery(getManagedDeviceRecord(managedDeviceId));
  const operationId = crypto.randomBytes(6).toString('hex');
  const startedAt = Date.now();

  if (activeByDevice.has(managedDeviceId)) {
    throw new ConflictError(
      'Point discovery is already running for this device.',
      'POINT_DISCOVERY_ALREADY_RUNNING',
      { managedDeviceId },
      requestId,
    );
  }

  if (bacnetMstpService.isMstpBusBusy && bacnetMstpService.isMstpBusBusy()) {
    throw new ConflictError(
      'MS/TP bus is busy with another exclusive operation.',
      'MSTP_BUS_BUSY',
      { managedDeviceId },
      requestId,
    );
  }

  activeByDevice.set(managedDeviceId, { operationId, startedAt, requestId });

  const report = (progress, message) => {
    if (typeof onProgress === 'function') onProgress(progress, message);
  };
  const cancelled = () => {
    if (typeof shouldCancel === 'function' && shouldCancel()) {
      const error = new Error('Job cancelled');
      error.code = 'JOB_CANCELLED';
      throw error;
    }
  };

  logger.info({
    source: 'managed-point-service',
    event: 'point_discovery_started',
    message: 'Point discovery started.',
    requestId,
    operationId,
    managedDeviceId,
    deviceInstance: device.deviceInstance,
    networkNumber: device.networkNumber,
    mstpMac: device.mstpMacAddress,
    forceRefresh,
  });

  try {
    cancelled();
    report(0, 'Queued');
    report(10, 'Reading objectList');

    const discovery = await bacnetMstpService.discoverPointsForDevice({
      managedDevice: device,
      onProgress: report,
      shouldCancel,
    });

    const now = new Date().toISOString();
    const discoveredPoints = (discovery.points || []).map((point) => ({
      ...point,
      discoveredAt: point.discoveredAt || now,
      lastReadAt: point.lastReadAt || now,
    }));

    discoveredStore.saveDiscoveryResult(managedDeviceId, discoveredPoints, now);
    const listed = listDiscoveredPoints(managedDeviceId);
    const durationMs = Date.now() - startedAt;

    report(100, 'Discovery complete');

    const response = {
      success: true,
      managedDeviceId,
      deviceInstance: device.deviceInstance,
      discoveredCount: listed.total,
      createdCount: listed.total,
      updatedCount: 0,
      pointsFound: listed.total,
      lastDiscoveryAt: now,
      points: listed.points,
      message: listed.total === 0
        ? 'No BACnet objects were discovered on this device.'
        : `Discovered ${listed.total} point(s).`,
      requestId,
      operationId,
      durationMs,
      logs: discovery.logs,
    };

    logger.info({
      source: 'managed-point-service',
      event: 'point_discovery_completed',
      message: response.message,
      requestId,
      operationId,
      managedDeviceId,
      deviceInstance: device.deviceInstance,
      networkNumber: device.networkNumber,
      mstpMac: device.mstpMacAddress,
      durationMs,
      discoveredCount: listed.total,
    });

    return response;
  } catch (err) {
    if (err.code === 'JOB_CANCELLED') {
      logger.warn({
        source: 'managed-point-service',
        event: 'point_discovery_cancelled',
        message: 'Point discovery cancelled.',
        requestId,
        operationId,
        managedDeviceId,
        durationMs: Date.now() - startedAt,
      });
      throw err;
    }

    const mapped = mapTransportError(err, device, requestId);
    if (err.result) {
      mapped.result = {
        success: false,
        ...err.result,
        points: listDiscoveredPoints(managedDeviceId).points,
      };
    }

    logger.error({
      source: 'managed-point-service',
      event: 'point_discovery_failed',
      message: mapped.message,
      requestId,
      operationId,
      managedDeviceId,
      deviceInstance: device.deviceInstance,
      networkNumber: device.networkNumber,
      mstpMac: device.mstpMacAddress,
      durationMs: Date.now() - startedAt,
      code: mapped.code,
    });

    throw mapped;
  } finally {
    releaseDeviceLock(managedDeviceId, operationId);
  }
}

/** @deprecated Prefer discoverPointsForDevice — kept for execution-engine callers. */
async function runPointDiscovery(managedDeviceId, hooks = {}) {
  return discoverPointsForDevice({
    managedDeviceId,
    onProgress: hooks.onProgress,
    shouldCancel: hooks.shouldCancel,
    requestId: hooks.requestId,
    forceRefresh: hooks.forceRefresh === true,
  });
}

function clearDiscoveredPoints(managedDeviceId) {
  const device = getManagedDeviceRecord(managedDeviceId);
  if (!device) return null;
  const result = discoveredStore.clearForDevice(managedDeviceId);
  return {
    success: true,
    managedDeviceId,
    cleared: result.removed > 0,
  };
}

module.exports = {
  discoverPointsForDevice,
  runPointDiscovery,
  listDiscoveredPoints,
  clearDiscoveredPoints,
  validateManagedDeviceForPointDiscovery,
  getManagedDeviceRecord,
  isPointDiscoveryActive,
};
