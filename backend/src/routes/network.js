const express = require('express');
const networkService = require('../services/network');
const logsService = require('../services/logs');

const router = express.Router();

router.get('/status', (_req, res) => {
  res.json(networkService.getNetworkStatus());
});

router.get('/interfaces', (_req, res) => {
  res.json({
    interfaces: networkService.getLiveInterfaces(),
    scannedAt: new Date().toISOString(),
  });
});

router.post('/settings', (req, res) => {
  const result = networkService.saveNetworkSettings(req.body);
  logsService.addLog({ level: 'info', service: 'network', message: 'Network settings saved' });
  res.json({ success: true, data: result });
});

router.post('/apply', (_req, res) => {
  const result = networkService.applyNetworkSettings();
  logsService.addLog({ level: 'warn', service: 'network', message: 'Network apply requested — staged as pending (OS apply not automated)' });
  res.json(result);
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
    message: `Connectivity test to ${result.target}: ${result.success ? `${result.latencyMs}ms` : 'failed'}`,
  });
  res.json(result);
});

router.post('/test-gateway', (_req, res) => {
  const result = networkService.testGatewayPing();
  logsService.addLog({
    level: result.success ? 'info' : 'error',
    service: 'network',
    message: result.success
      ? `Gateway ping OK — ${result.target} @ ${result.latencyMs}ms`
      : `Gateway ping failed — ${result.error || result.target}`,
  });
  res.json(result);
});

router.post('/test-dns', (_req, res) => {
  const result = networkService.testDns();
  logsService.addLog({
    level: result.success ? 'info' : 'error',
    service: 'network',
    message: result.success ? `DNS test OK — ${result.dns || result.target}` : 'DNS test failed',
  });
  res.json(result);
});

module.exports = router;
