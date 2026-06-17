const express = require('express');
const bacnetService = require('../services/bacnet');
const bacnetIpService = require('../services/bacnet/bacnetIp.service');
const deviceService = require('../services/devices');
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

router.post('/ip/discover', async (req, res, next) => {
  const timeoutMs = Number(req.body?.timeoutMs) || 5000;

  logsService.addLog({
    level: 'info',
    service: 'bacnet',
    message: `BACnet/IP discovery started (timeout ${timeoutMs}ms)`,
  });

  try {
    const discovery = await bacnetIpService.discoverDevices(timeoutMs);
    const result = await deviceService.ingestBacnetIpDiscovery(discovery);

    logsService.addLog({
      level: 'info',
      service: 'bacnet',
      message: `BACnet/IP discovery complete — ${discovery.devices.length} devices found in ${discovery.durationMs}ms`,
    });

    res.json({
      ...discovery,
      inventory: result,
    });
  } catch (err) {
    logsService.addLog({
      level: 'error',
      service: 'bacnet',
      message: `BACnet/IP discovery failed — ${err.message}`,
    });
    next(err);
  }
});

router.post('/ip/read-device', async (req, res, next) => {
  const { address, deviceInstance } = req.body || {};
  if (!address || deviceInstance == null) {
    return res.status(400).json({ error: 'address and deviceInstance are required' });
  }

  try {
    const details = await bacnetIpService.readDeviceDetails({ address, deviceInstance });
    res.json(details);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
