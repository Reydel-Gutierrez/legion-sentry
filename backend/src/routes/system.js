const express = require('express');
const systemService = require('../services/system');

const router = express.Router();

router.get('/status', (_req, res) => {
  res.json(systemService.getSystemStatus());
});

router.get('/health', (_req, res) => {
  res.json(systemService.getHealth());
});

router.get('/info', (_req, res) => {
  res.json(systemService.getSystemInfo());
});

module.exports = router;
