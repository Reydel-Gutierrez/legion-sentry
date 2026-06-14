const express = require('express');
const gpioService = require('../services/gpio');
const logsService = require('../services/logs');

const router = express.Router();

router.get('/summary', (_req, res) => {
  res.json(gpioService.getDiagnosticsSummary());
});

router.get('/gpio', (_req, res) => {
  res.json(gpioService.getGpioDiagnostics());
});

router.post('/ping', (req, res) => {
  const target = req.body?.target || '8.8.8.8';
  const result = gpioService.runPing(target);
  logsService.addLog({
    level: 'info',
    service: 'network',
    message: `Ping ${target}: avg ${result.avgMs}ms`,
  });
  res.json(result);
});

module.exports = router;
