const express = require('express');
const deviceService = require('../services/devices');
const logsService = require('../services/logs');

const router = express.Router();

router.get('/', (_req, res) => {
  res.json(deviceService.getDevices());
});

router.post('/discover', (req, res) => {
  const protocol = req.body?.protocol || 'all';
  const result = deviceService.discoverDevices(protocol);
  const label = protocol === 'bacnet-ip' ? 'BACnet/IP' : protocol === 'bacnet-mstp' ? 'BACnet MS/TP' : 'BACnet';
  logsService.addLog({
    level: 'info',
    service: 'bacnet',
    message: `${label} discovery completed — ${result.devicesFound} devices found`,
  });
  res.json(result);
});

router.post('/refresh', (_req, res) => {
  const result = deviceService.refreshDevices();
  logsService.addLog({
    level: 'info',
    service: 'bacnet',
    message: `Device list refreshed — ${result.devices.length} devices`,
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
