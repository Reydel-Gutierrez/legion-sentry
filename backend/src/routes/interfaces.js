const express = require('express');
const interfacesService = require('../services/interfaces');
const serialService = require('../services/interfaces/serial.service');
const logger = require('../services/logger');
const { validateSerialConfigBody } = require('../middleware/validate');

const router = express.Router();

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

router.get('/serial', (_req, res) => {
  res.json(interfacesService.getSerialInterfaces());
});

router.get('/serial/detail', (_req, res) => {
  res.json(serialService.getSerialDetail());
});

router.post('/serial/configure', asyncHandler(async (req, res) => {
  const normalized = validateSerialConfigBody(req.body, req.requestId);
  const result = serialService.configureSerial({ ...req.body, ...normalized });
  logger.info({
    source: 'interfaces',
    event: 'serial_configured',
    message: `Serial configured — ${result.port.path} at ${result.port.currentBaudRate} baud`,
    requestId: req.requestId,
  });
  res.json(result);
}));

router.post('/serial/open-check', asyncHandler(async (req, res) => {
  const normalized = validateSerialConfigBody(req.body, req.requestId);
  const result = await serialService.openSerialCheck({ ...req.body, ...normalized });
  logger.log({
    level: result.success ? 'info' : 'error',
    source: 'interfaces',
    event: 'serial_open_check',
    message: result.success
      ? `Serial open-check succeeded — ${result.path} (${result.responseTimeMs}ms)`
      : `Serial open-check failed — ${result.path}: ${result.error}`,
    requestId: req.requestId,
  });
  res.json(result);
}));

router.post('/serial/monitor/start', asyncHandler(async (req, res) => {
  const normalized = validateSerialConfigBody(req.body, req.requestId);
  const result = await serialService.startSerialMonitor({ ...req.body, ...normalized });
  logger.info({
    source: 'interfaces',
    event: 'serial_monitor_started',
    message: `Serial monitor started — ${result.path} at ${result.baudRate} baud`,
    requestId: req.requestId,
  });
  res.json(result);
}));

router.get('/serial/monitor/status', (_req, res) => {
  res.json(serialService.getMonitorStatus());
});

router.post('/serial/monitor/stop', asyncHandler(async (req, res) => {
  const result = await serialService.stopSerialMonitor();
  logger.info({
    source: 'interfaces',
    event: 'serial_monitor_stopped',
    message: `Serial monitor stopped — RX ${result.rxBytes} bytes, TX ${result.txBytes} bytes`,
    requestId: req.requestId,
  });
  res.json(result);
}));

router.get('/network', (_req, res) => {
  res.json(interfacesService.getNetworkInterfaces());
});

module.exports = router;
