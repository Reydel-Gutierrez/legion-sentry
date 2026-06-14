const express = require('express');
const networkService = require('../services/network');
const logsService = require('../services/logs');

const router = express.Router();

router.get('/status', (_req, res) => {
  res.json(networkService.getNetworkStatus());
});

router.post('/settings', (req, res) => {
  const result = networkService.saveNetworkSettings(req.body);
  logsService.addLog({ level: 'info', service: 'network', message: 'Network settings updated' });
  res.json({ success: true, data: result });
});

router.post('/restart', (_req, res) => {
  const result = networkService.restartNetwork();
  logsService.addLog({ level: 'warn', service: 'network', message: 'Network restart requested' });
  res.json(result);
});

router.post('/test', (_req, res) => {
  const result = networkService.testConnectivity();
  logsService.addLog({
    level: result.success ? 'info' : 'error',
    service: 'network',
    message: `Connectivity test to ${result.target}: ${result.latencyMs}ms`,
  });
  res.json(result);
});

module.exports = router;
