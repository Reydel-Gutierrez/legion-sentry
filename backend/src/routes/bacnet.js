const express = require('express');
const bacnetService = require('../services/bacnet');
const logsService = require('../services/logs');

const router = express.Router();

router.get('/status', (_req, res) => {
  res.json(bacnetService.getBacnetStatus());
});

router.post('/settings', (req, res) => {
  const result = bacnetService.saveBacnetSettings(req.body);
  logsService.addLog({ level: 'info', service: 'bacnet', message: 'BACnet settings updated' });
  res.json({ success: true, data: result });
});

router.post('/discover', (_req, res) => {
  const result = bacnetService.discoverDevices();
  logsService.addLog({
    level: 'info',
    service: 'bacnet',
    message: `BACnet discovery completed — ${result.devices.length} devices found`,
  });
  res.json(result);
});

module.exports = router;
