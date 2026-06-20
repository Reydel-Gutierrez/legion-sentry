const express = require('express');
const networkService = require('../services/network');
const networkApply = require('../services/network/networkApply.service');
const logsService = require('../services/logs');

const router = express.Router();

function handleServiceError(res, err, failureLog) {
  if (failureLog) {
    logsService.addLog({ level: 'error', service: 'network', message: failureLog });
  }

  const status = err.statusCode || 500;
  return res.status(status).json({
    success: false,
    error: err.message,
    code: err.code || undefined,
  });
}

router.get('/status', (_req, res) => {
  res.json(networkService.getNetworkStatus());
});

router.get('/manager', (_req, res) => {
  res.json(networkService.getNetworkManager());
});

router.get('/interfaces', (_req, res) => {
  res.json({
    interfaces: networkService.getLiveInterfaces(),
    scannedAt: new Date().toISOString(),
  });
});

router.post('/apply', (req, res) => {
  logsService.addLog({
    level: 'warn',
    service: 'network',
    message: `Network apply requested — ${req.body?.interface || 'unknown'} ${req.body?.mode || ''}`.trim(),
  });

  try {
    const result = networkApply.applyNetworkSettings(req.body);
    logsService.addLog({
      level: 'info',
      service: 'network',
      message: `Network apply success — ${result.interface} (${result.mode}) via ${result.connection}`,
    });
    res.json(result);
  } catch (err) {
    handleServiceError(res, err, `Network apply failure — ${err.message}`);
  }
});

router.post('/restore-dhcp', (req, res) => {
  logsService.addLog({
    level: 'info',
    service: 'network',
    message: `DHCP restore requested — ${req.body?.interface || 'unknown'}`,
  });

  try {
    const result = networkApply.restoreDhcp(req.body);
    logsService.addLog({
      level: 'info',
      service: 'network',
      message: `DHCP restore success — ${result.interface} via ${result.connection}`,
    });
    res.json(result);
  } catch (err) {
    handleServiceError(res, err, `DHCP restore failure — ${err.message}`);
  }
});

router.post('/hostname', (req, res) => {
  logsService.addLog({
    level: 'info',
    service: 'network',
    message: `Hostname change requested — ${req.body?.hostname || 'unknown'}`,
  });

  try {
    const result = networkApply.setHostname(req.body);
    logsService.addLog({
      level: 'info',
      service: 'network',
      message: `Hostname change success — ${result.hostname}`,
    });
    res.json(result);
  } catch (err) {
    handleServiceError(res, err, `Hostname change failure — ${err.message}`);
  }
});

router.post('/reboot', (_req, res) => {
  logsService.addLog({ level: 'warn', service: 'network', message: 'Reboot requested' });

  try {
    const result = networkApply.rebootDevice();
    res.json(result);
  } catch (err) {
    handleServiceError(res, err, `Reboot failure — ${err.message}`);
  }
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
