const express = require('express');
const deviceService = require('../services/devices');
const managedDevices = require('../services/devices/managedDevices');
const managedPoints = require('../services/devices/managedPoints');
const pointDiscovery = require('../services/devices/pointDiscovery');
const fieldExecutionEngine = require('../services/execution/fieldExecutionEngine');
const logger = require('../services/logger');
const { NotFoundError } = require('../errors/AppError');
const {
  asId,
  validateDiscoverPointsBody,
  validateManagedDevicePatch,
  validateManagePointsBody,
  validatePointPollPatch,
} = require('../middleware/validate');

const router = express.Router();

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

router.get('/', (_req, res) => {
  res.json(deviceService.getDevices());
});

router.get('/managed', (_req, res) => {
  res.json(managedDevices.getManagedDevices());
});

router.post('/managed', asyncHandler(async (req, res) => {
  const result = managedDevices.addManagedDevice(req.body || {});
  logger.info({
    source: 'managed-device-service',
    event: 'managed_device_added',
    message: `MS/TP device added to managed list — MAC ${result.device.mstpMacAddress}, instance ${result.device.deviceInstance}`,
    requestId: req.requestId,
    managedDeviceId: result.device.id,
    mstpMac: result.device.mstpMacAddress,
    deviceInstance: result.device.deviceInstance,
  });
  res.status(201).json(result);
}));

router.patch('/managed/:id', asyncHandler(async (req, res) => {
  const id = asId(req.params.id, 'id', req.requestId);
  const patch = validateManagedDevicePatch(req.body || {}, req.requestId);
  const result = managedDevices.updateManagedDevice(id, patch);
  if (!result) throw new NotFoundError('Managed device not found', { managedDeviceId: id }, req.requestId);

  const action = patch.enabled === false ? 'disabled' : patch.enabled === true ? 'enabled' : 'updated';
  logger.info({
    source: 'managed-device-service',
    event: 'managed_device_updated',
    message: `Managed MS/TP device ${action} — MAC ${result.device.mstpMacAddress}, instance ${result.device.deviceInstance}`,
    requestId: req.requestId,
    managedDeviceId: id,
  });
  res.json(result);
}));

router.delete('/managed/:id', asyncHandler(async (req, res) => {
  const id = asId(req.params.id, 'id', req.requestId);
  const result = managedDevices.unmanageDevice(id);
  if (!result) throw new NotFoundError('Managed device not found', { managedDeviceId: id }, req.requestId);
  logger.info({
    source: 'managed-device-service',
    event: 'managed_device_removed',
    message: `MS/TP device removed from managed list — MAC ${result.removed.mstpMacAddress}, instance ${result.removed.deviceInstance}`,
    requestId: req.requestId,
    managedDeviceId: id,
  });
  res.json(result);
}));

router.get('/managed/:id', asyncHandler(async (req, res) => {
  const id = asId(req.params.id, 'id', req.requestId);
  const device = managedDevices.getManagedDeviceById(id);
  if (!device) throw new NotFoundError('Managed device not found', { managedDeviceId: id }, req.requestId);
  res.json(device);
}));

router.get('/managed/:id/points', asyncHandler(async (req, res) => {
  const id = asId(req.params.id, 'id', req.requestId);
  const device = managedDevices.getManagedDeviceById(id);
  if (!device) throw new NotFoundError('Managed device not found', { managedDeviceId: id }, req.requestId);
  res.json(managedPoints.listPointsByManagedDeviceId(id));
}));

router.get('/managed/:id/discovered-points', asyncHandler(async (req, res) => {
  const id = asId(req.params.id, 'id', req.requestId);
  const device = managedDevices.getManagedDeviceById(id);
  if (!device) throw new NotFoundError('Managed device not found', { managedDeviceId: id }, req.requestId);
  res.json(pointDiscovery.listDiscoveredPoints(id));
}));

router.post('/managed/:id/discover-points', asyncHandler(async (req, res) => {
  const id = asId(req.params.id, 'id', req.requestId);
  const body = validateDiscoverPointsBody(req.body, req.requestId);
  const result = await fieldExecutionEngine.discoverPointsForManagedDevice(id, {
    source: 'ui',
    async: body.async,
    requestId: req.requestId,
  });

  if (body.async) {
    logger.info({
      source: 'managed-point-service',
      event: 'point_discovery_queued',
      message: `Point discovery job queued for managed device ${id}`,
      requestId: req.requestId,
      managedDeviceId: id,
      operationId: result.jobId,
    });
    return res.json({
      success: true,
      data: result,
      requestId: req.requestId,
      ...result,
    });
  }

  logger.info({
    source: 'managed-point-service',
    event: 'point_discovery_http_completed',
    message: `Point discovery completed for managed device ${id} — ${result.pointsFound} point(s)`,
    requestId: req.requestId,
    managedDeviceId: id,
    discoveredCount: result.pointsFound,
  });
  res.json({
    success: true,
    data: result,
    requestId: req.requestId,
    ...result,
  });
}));

router.delete('/managed/:id/discovered-points', asyncHandler(async (req, res) => {
  const id = asId(req.params.id, 'id', req.requestId);
  const result = pointDiscovery.clearDiscoveredPoints(id);
  if (!result) throw new NotFoundError('Managed device not found', { managedDeviceId: id }, req.requestId);
  logger.info({
    source: 'managed-point-service',
    event: 'discovered_points_cleared',
    message: `Cleared discovered points for managed device ${id}`,
    requestId: req.requestId,
    managedDeviceId: id,
  });
  res.json(result);
}));

router.post('/managed/:id/points/manage', asyncHandler(async (req, res) => {
  const id = asId(req.params.id, 'id', req.requestId);
  const { pointKeys } = validateManagePointsBody(req.body, req.requestId);
  const result = managedPoints.managePoints(id, pointKeys);
  logger.info({
    source: 'managed-point-service',
    event: 'points_managed',
    message: `Added ${result.addedCount} managed point(s) for device ${id}`,
    requestId: req.requestId,
    managedDeviceId: id,
  });
  res.status(result.addedCount > 0 ? 201 : 200).json(result);
}));

router.delete('/managed/:id/points/:pointId', asyncHandler(async (req, res) => {
  const id = asId(req.params.id, 'id', req.requestId);
  const pointId = asId(req.params.pointId, 'pointId', req.requestId);
  const result = managedPoints.unmanagePoint(id, pointId);
  if (!result) throw new NotFoundError('Managed point not found', { managedDeviceId: id, pointId }, req.requestId);
  logger.info({
    source: 'managed-point-service',
    event: 'point_unmanaged',
    message: `Unmanaged point ${pointId} on device ${id}`,
    requestId: req.requestId,
    managedDeviceId: id,
  });
  res.json(result);
}));

router.delete('/managed/:id/points', asyncHandler(async (req, res) => {
  const id = asId(req.params.id, 'id', req.requestId);
  const result = managedPoints.clearPointsForManagedDevice(id);
  if (!result) throw new NotFoundError('Managed device not found', { managedDeviceId: id }, req.requestId);
  logger.info({
    source: 'managed-point-service',
    event: 'points_cleared',
    message: `Unmanaged ${result.removedCount} point(s) for managed device ${id}`,
    requestId: req.requestId,
    managedDeviceId: id,
  });
  res.json(result);
}));

router.patch('/managed/:deviceId/points/:pointId', asyncHandler(async (req, res) => {
  const deviceId = asId(req.params.deviceId, 'deviceId', req.requestId);
  const pointId = asId(req.params.pointId, 'pointId', req.requestId);
  const patch = validatePointPollPatch(req.body || {}, req.requestId);
  const result = managedPoints.updatePointPollingConfig(deviceId, pointId, patch);
  if (!result) {
    throw new NotFoundError('Managed point not found', { managedDeviceId: deviceId, pointId }, req.requestId);
  }
  res.json({ success: true, point: result, requestId: req.requestId });
}));

router.post('/managed/:deviceId/points/:pointId/refresh', asyncHandler(async (req, res) => {
  const deviceId = asId(req.params.deviceId, 'deviceId', req.requestId);
  const pointId = asId(req.params.pointId, 'pointId', req.requestId);
  const runAsync = req.body?.async === true;
  const result = await managedPoints.refreshPoint(deviceId, pointId, { async: runAsync });
  res.json(result);
}));

router.post('/clear', (_req, res) => {
  const result = deviceService.clearInventory();
  logger.info({
    source: 'bacnet',
    event: 'inventory_cleared',
    message: 'Device inventory cleared',
    requestId: _req.requestId,
  });
  res.json(result);
});

router.post('/refresh', asyncHandler(async (req, res) => {
  const result = await deviceService.refreshDevices();
  logger.info({
    source: 'bacnet',
    event: 'inventory_refreshed',
    message: `Device inventory refreshed — ${result.devices.length} devices checked, ${result.summary?.online ?? 0} online`,
    requestId: req.requestId,
  });
  res.json(result);
}));

router.post('/discover', (req, res, next) => {
  try {
    const protocol = req.body?.protocol || 'all';
    const result = deviceService.discoverDevices(protocol);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', asyncHandler(async (req, res) => {
  const id = asId(req.params.id, 'id', req.requestId);
  const result = deviceService.deleteDevice(id);
  if (!result) throw new NotFoundError('Device not found', { deviceId: id }, req.requestId);
  logger.info({
    source: 'bacnet',
    event: 'device_removed',
    message: `Device removed from inventory — instance ${result.removed.deviceInstance}`,
    requestId: req.requestId,
  });
  res.json(result);
}));

router.get('/:id/health', asyncHandler(async (req, res) => {
  const id = asId(req.params.id, 'id', req.requestId);
  const health = deviceService.getDeviceHealth(id);
  if (!health) throw new NotFoundError('Device not found', { deviceId: id }, req.requestId);
  res.json(health);
}));

router.get('/:id/objects', asyncHandler(async (req, res) => {
  const id = asId(req.params.id, 'id', req.requestId);
  const objects = deviceService.getDeviceObjects(id);
  if (!objects) throw new NotFoundError('Device not found', { deviceId: id }, req.requestId);
  res.json(objects);
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const id = asId(req.params.id, 'id', req.requestId);
  const device = deviceService.getDeviceById(id);
  if (!device) throw new NotFoundError('Device not found', { deviceId: id }, req.requestId);
  res.json(device);
}));

module.exports = router;
