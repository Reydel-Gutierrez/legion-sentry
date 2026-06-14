const express = require('express');
const logsService = require('../services/logs');

const router = express.Router();

router.get('/', (req, res) => {
  const filter = req.query.filter || 'all';
  res.json({ logs: logsService.getLogs(filter) });
});

router.post('/clear', (_req, res) => {
  const result = logsService.clearLogs();
  res.json(result);
});

module.exports = router;
