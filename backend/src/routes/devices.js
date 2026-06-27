const express = require('express');
const deviceService = require('../services/devices');
const managedDevices = require('../services/devices/managedDevices');
const logsService = require('../services/logs');

const router = express.Router();

router.get('/', (_req, res) => {
  res.json(deviceService.getDevices());
});

router.get('/managed', (_req, res) => {
  res.json(managedDevices.getManagedDevices());
});

router.post('/managed', (req, res, next) => {
  try {
    const result = managedDevices.addManagedDevice(req.body || {});
    logsService.addLog({
      level: 'info',
      service: 'bacnet',
      message: `MS/TP device added to managed list — MAC ${result.device.mstpMacAddress}, instance ${result.device.deviceInstance}`,
    });
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

router.patch('/managed/:id', (req, res) => {
  const result = managedDevices.updateManagedDevice(req.params.id, req.body || {});
  if (!result) return res.status(404).json({ error: 'Managed device not found' });

  const action = req.body?.enabled === false ? 'disabled' : req.body?.enabled === true ? 'enabled' : 'updated';
  logsService.addLog({
    level: 'info',
    service: 'bacnet',
    message: `Managed MS/TP device ${action} — MAC ${result.device.mstpMacAddress}, instance ${result.device.deviceInstance}`,
  });
  res.json(result);
});

router.delete('/managed/:id', (req, res) => {
  const result = managedDevices.unmanageDevice(req.params.id);
  if (!result) return res.status(404).json({ error: 'Managed device not found' });
  logsService.addLog({
    level: 'info',
    service: 'bacnet',
    message: `MS/TP device removed from managed list — MAC ${result.removed.mstpMacAddress}, instance ${result.removed.deviceInstance}`,
  });
  res.json(result);
});

router.get('/managed/:id', (req, res) => {
  const device = managedDevices.getManagedDeviceById(req.params.id);
  if (!device) return res.status(404).json({ error: 'Managed device not found' });
  res.json(device);
});

router.post('/clear', (_req, res) => {
  const result = deviceService.clearInventory();
  logsService.addLog({ level: 'info', service: 'bacnet', message: 'Device inventory cleared' });
  res.json(result);
});

router.post('/refresh', async (_req, res, next) => {
  try {
    const result = await deviceService.refreshDevices();
    logsService.addLog({
      level: 'info',
      service: 'bacnet',
      message: `Device inventory refreshed — ${result.devices.length} devices checked, ${result.summary?.online ?? 0} online`,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/discover', (req, res, next) => {
  try {
    const protocol = req.body?.protocol || 'all';
    const result = deviceService.discoverDevices(protocol);
    const label = protocol === 'bacnet-ip' ? 'BACnet/IP' : protocol === 'bacnet-mstp' ? 'BACnet MS/TP' : 'BACnet';
    logsService.addLog({
      level: 'info',
      service: 'bacnet',
      message: `${label} discovery completed — ${result.devicesFound} devices found`,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', (req, res) => {
  const result = deviceService.deleteDevice(req.params.id);
  if (!result) return res.status(404).json({ error: 'Device not found' });
  logsService.addLog({
    level: 'info',
    service: 'bacnet',
    message: `Device removed from inventory — instance ${result.removed.deviceInstance}`,
  });
  res.json(result);
});

router.get('/:id/health', (req, res) => {
  const health = deviceService.getDeviceHealth(req.params.id);
  if (!health) return res.status(404).json({ error: 'Device not found' });
  res.json(health);
});

router.get('/:id/objects', (req, res) => {
  const objects = deviceService.getDeviceObjects(req.params.id);
  if (!objects) return res.status(404).json({ error: 'Device not found' });
  res.json(objects);
});

router.get('/:id', (req, res) => {
  const device = deviceService.getDeviceById(req.params.id);
  if (!device) return res.status(404).json({ error: 'Device not found' });
  res.json(device);
});

module.exports = router;
