const express = require('express');
const interfacesService = require('../services/interfaces');
const serialService = require('../services/interfaces/serial.service');
const logsService = require('../services/logs');

const router = express.Router();

router.get('/serial', (_req, res) => {
  res.json(interfacesService.getSerialInterfaces());
});

router.get('/serial/detail', (_req, res) => {
  res.json(serialService.getSerialDetail());
});

router.post('/serial/configure', (req, res, next) => {
  try {
    const result = serialService.configureSerial(req.body || {});
    logsService.addLog({
      level: 'info',
      service: 'interfaces',
      message: `Serial port configured — ${result.port.path} at ${result.port.currentBaudRate} baud`,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/serial/open-check', async (req, res, next) => {
  try {
    const result = await serialService.openSerialCheck(req.body || {});
    logsService.addLog({
      level: result.success ? 'info' : 'error',
      service: 'interfaces',
      message: result.success
        ? `Serial open-check succeeded — ${result.path} (${result.responseTimeMs}ms)`
        : `Serial open-check failed — ${result.path}: ${result.error}`,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.get('/network', (_req, res) => {
  res.json(interfacesService.getNetworkInterfaces());
});

module.exports = router;
