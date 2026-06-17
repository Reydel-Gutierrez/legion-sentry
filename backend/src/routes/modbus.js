const express = require('express');
const modbusService = require('../services/modbus');
const logsService = require('../services/logs');

const router = express.Router();

router.get('/status', (_req, res) => {
  res.json(modbusService.getModbusStatus());
});

router.post('/settings', (req, res) => {
  const result = modbusService.saveModbusSettings(req.body);
  logsService.addLog({ level: 'info', service: 'modbus', message: 'Modbus settings updated' });
  res.json({ success: true, data: result });
});

router.post('/test-read', (_req, res, next) => {
  try {
    const result = modbusService.testReadRegister();
    logsService.addLog({
      level: 'info',
      service: 'modbus',
      message: `Modbus test read register ${result.register} = ${result.value}`,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/scan', (_req, res) => {
  const result = modbusService.scanDevices();
  res.json(result);
});

module.exports = router;
