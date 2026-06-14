const express = require('express');
const mqttService = require('../services/mqtt');
const logsService = require('../services/logs');

const router = express.Router();

router.get('/status', (_req, res) => {
  res.json(mqttService.getMqttStatus());
});

router.post('/settings', (req, res) => {
  const result = mqttService.saveMqttSettings(req.body);
  logsService.addLog({ level: 'info', service: 'mqtt', message: 'MQTT settings updated' });
  res.json({ success: true, data: result });
});

router.post('/test', (_req, res) => {
  const result = mqttService.testConnection();
  logsService.addLog({
    level: result.success ? 'info' : 'warn',
    service: 'mqtt',
    message: result.message,
  });
  res.json(result);
});

router.post('/publish-test', (_req, res) => {
  const result = mqttService.publishTestMessage();
  logsService.addLog({
    level: result.success ? 'info' : 'warn',
    service: 'mqtt',
    message: result.message,
  });
  res.json(result);
});

module.exports = router;
