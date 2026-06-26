const express = require('express');
const bacnetService = require('../services/bacnet');
const bacnetIpService = require('../services/bacnet/bacnetIp.service');
const bacnetMstpService = require('../services/bacnet/bacnetMstp.service');
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

router.get('/mstp/status', (_req, res) => {
  res.json(bacnetMstpService.getStatus());
});

router.post('/mstp/open', async (req, res, next) => {
  try {
    const result = await bacnetMstpService.openInterface(req.body || {});
    logsService.addLog({
      level: 'info',
      service: 'bacnet',
      message: `BACnet MS/TP interface opened on ${result.status.port}`,
    });
    res.json(result);
  } catch (err) {
    logsService.addLog({
      level: 'error',
      service: 'bacnet',
      message: `BACnet MS/TP open failed — ${err.message}`,
    });
    next(err);
  }
});

router.post('/mstp/close', async (req, res, next) => {
  try {
    const result = await bacnetMstpService.closeInterface();
    logsService.addLog({
      level: 'info',
      service: 'bacnet',
      message: result.message,
    });
    res.json(result);
  } catch (err) {
    logsService.addLog({
      level: 'error',
      service: 'bacnet',
      message: `BACnet MS/TP close failed — ${err.message}`,
    });
    next(err);
  }
});

router.post('/mstp/discover', async (req, res, next) => {
  const timeoutMs = Number(req.body?.timeoutMs) || 8000;

  logsService.addLog({
    level: 'info',
    service: 'bacnet',
    message: `BACnet MS/TP discovery started (timeout ${timeoutMs}ms)`,
  });

  try {
    const discovery = await bacnetMstpService.discover(req.body || {});
    let inventory = null;

    if (discovery.devices?.length > 0) {
      inventory = await deviceService.ingestBacnetMstpDiscovery(discovery);
    }

    logsService.addLog({
      level: 'info',
      service: 'bacnet',
      message: discovery.devices?.length > 0
        ? `BACnet MS/TP discovery complete — ${discovery.devices.length} device(s) in ${discovery.durationMs}ms`
        : `BACnet MS/TP discovery finished — ${discovery.message || 'no devices found'}`,
    });

    res.json({
      ...discovery,
      inventory,
    });
  } catch (err) {
    logsService.addLog({
      level: 'error',
      service: 'bacnet',
      message: `BACnet MS/TP discovery failed — ${err.message}`,
    });
    next(err);
  }
});

router.get('/mstp/logs', (_req, res) => {
  res.json(bacnetMstpService.getLogs());
});

router.post('/mstp/clear-logs', (_req, res) => {
  res.json(bacnetMstpService.clearLogs());
});

router.get('/mstp/frames', (_req, res) => {
  res.json(bacnetMstpService.getFrames());
});

router.post('/mstp/clear-session', (_req, res) => {
  // Clears the latest discovery session results (temporary buffer + frame
  // diagnostics) and removes the "seen in latest scan" marker. Persistent
  // device inventory is intentionally left untouched.
  const session = bacnetMstpService.clearSession();
  const inventory = deviceService.clearLatestScanSession();
  logsService.addLog({
    level: 'info',
    service: 'bacnet',
    message: 'BACnet MS/TP latest scan session cleared (inventory preserved)',
  });
  res.json({ success: true, session, inventory });
});

module.exports = router;
