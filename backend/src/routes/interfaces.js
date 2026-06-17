const express = require('express');
const interfacesService = require('../services/interfaces');

const router = express.Router();

router.get('/serial', (_req, res) => {
  res.json(interfacesService.getSerialInterfaces());
});

router.get('/network', (_req, res) => {
  res.json(interfacesService.getNetworkInterfaces());
});

module.exports = router;
