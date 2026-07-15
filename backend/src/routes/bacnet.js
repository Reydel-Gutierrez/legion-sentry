const express = require('express');
const bacnetService = require('../services/bacnet');
const bacnetIpService = require('../services/bacnet/bacnetIp.service');
const bacnetMstpService = require('../services/bacnet/bacnetMstp.service');
const deviceService = require('../services/devices');
const mstpBusCoordinator = require('../services/execution/mstpBusCoordinator');
const logger = require('../services/logger');
const {
  validateBacnetIpDiscoverBody,
  validateMstpDiscoverBody,
} = require('../middleware/validate');

const router = express.Router();

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

router.get('/status', (_req, res) => {
  res.json(bacnetService.getBacnetStatus());
});

router.post('/settings', (req, res) => {
  const result = bacnetService.saveBacnetSettings(req.body);
  logger.info({
    source: 'bacnet',
    event: 'settings_updated',
    message: 'BACnet settings updated',
    requestId: req.requestId,
  });
  res.json({ success: true, data: result });
});

router.post('/ip/discover', asyncHandler(async (req, res) => {
  const { timeoutMs } = validateBacnetIpDiscoverBody(req.body, req.requestId);

  logger.info({
    source: 'bacnet',
    event: 'bacnet_ip_discovery_started',
    message: `BACnet/IP discovery started (timeout ${timeoutMs}ms)`,
    requestId: req.requestId,
  });

  const discovery = await bacnetIpService.discoverDevices(timeoutMs);
  const result = await deviceService.ingestBacnetIpDiscovery(discovery);

  logger.info({
    source: 'bacnet',
    event: 'bacnet_ip_discovery_completed',
    message: `BACnet/IP discovery complete — ${discovery.devices.length} devices found in ${discovery.durationMs}ms`,
    requestId: req.requestId,
    durationMs: discovery.durationMs,
  });

  res.json({
    ...discovery,
    inventory: result,
    requestId: req.requestId,
  });
}));

router.post('/ip/read-device', asyncHandler(async (req, res) => {
  const { address, deviceInstance } = req.body || {};
  if (!address || deviceInstance == null) {
    const error = new Error('address and deviceInstance are required');
    error.statusCode = 400;
    error.code = 'VALIDATION_ERROR';
    throw error;
  }

  const details = await bacnetIpService.readDeviceDetails({ address, deviceInstance });
  res.json(details);
}));

router.get('/mstp/status', (_req, res) => {
  res.json(bacnetMstpService.getStatus());
});

router.get('/mstp/runtime', (_req, res) => {
  res.json({
    success: true,
    data: bacnetMstpService.getRuntimeSnapshot(),
    requestId: _req.requestId,
  });
});

router.post('/mstp/runtime/start', asyncHandler(async (req, res) => {
  const result = await bacnetMstpService.startRuntime(req.body || {});
  logger.info({
    source: 'mstp-runtime',
    event: 'runtime_start',
    message: 'BACnet MS/TP runtime started',
    requestId: req.requestId,
  });
  res.json({ success: true, data: result.data, requestId: req.requestId });
}));

router.post('/mstp/runtime/stop', asyncHandler(async (req, res) => {
  const result = await bacnetMstpService.stopRuntime('api_stop');
  logger.info({
    source: 'mstp-runtime',
    event: 'runtime_stop',
    message: 'BACnet MS/TP runtime stopped',
    requestId: req.requestId,
  });
  res.json({ success: true, data: result.data, requestId: req.requestId });
}));

router.post('/mstp/runtime/restart', asyncHandler(async (req, res) => {
  const result = await bacnetMstpService.restartRuntime('api_restart', req.body || {});
  logger.info({
    source: 'mstp-runtime',
    event: 'runtime_restart',
    message: 'BACnet MS/TP runtime restarted',
    requestId: req.requestId,
  });
  res.json({ success: true, data: result.data, requestId: req.requestId });
}));

router.post('/mstp/runtime/retry', asyncHandler(async (req, res) => {
  const result = await bacnetMstpService.recoverRuntime('manual_retry');
  logger.info({
    source: 'mstp-runtime',
    event: 'runtime_retry',
    message: 'BACnet MS/TP runtime recovery requested',
    requestId: req.requestId,
  });
  res.json({ success: true, data: result.data, requestId: req.requestId });
}));

router.post('/mstp/open', asyncHandler(async (req, res) => {
  const normalized = validateMstpDiscoverBody(req.body, req.requestId);
  const result = await bacnetMstpService.openInterface({ ...req.body, ...normalized });
  logger.info({
    source: 'mstp-runtime',
    event: 'serial_open',
    message: `BACnet MS/TP interface opened on ${result.status.port}`,
    requestId: req.requestId,
  });
  res.json(result);
}));

router.post('/mstp/close', asyncHandler(async (req, res) => {
  const result = await bacnetMstpService.closeInterface();
  logger.info({
    source: 'mstp-runtime',
    event: 'serial_close',
    message: result.message,
    requestId: req.requestId,
  });
  res.json(result);
}));

router.post('/mstp/discover', asyncHandler(async (req, res) => {
  const normalized = validateMstpDiscoverBody(req.body, req.requestId);
  const timeoutMs = Number(normalized.timeoutMs) || 20000;

  logger.info({
    source: 'mstp-runtime',
    event: 'device_discovery_started',
    message: `BACnet MS/TP discovery started (timeout ${timeoutMs}ms)`,
    requestId: req.requestId,
  });

  try {
    await mstpBusCoordinator.prepareForDiscovery();
    mstpBusCoordinator.acquireBus(mstpBusCoordinator.BUS_OWNER.DISCOVERY);

    const discovery = await bacnetMstpService.discover({ ...req.body, ...normalized });
    const inventory = await deviceService.ingestBacnetMstpDiscovery(discovery);

    const seenCount = discovery.devices?.length || 0;
    const mstpTotal = inventory?.inventoryTotals?.mstp ?? 0;
    const missedDevices = inventory?.missedDevices || [];

    logger.info({
      source: 'mstp-runtime',
      event: 'device_discovery_completed',
      message: `BACnet MS/TP discovery complete — ${seenCount} device(s) seen in this scan, ${mstpTotal} MS/TP inventory total, ${missedDevices.length} not rediscovered.`,
      requestId: req.requestId,
      durationMs: discovery.durationMs,
    });

    for (const missed of missedDevices) {
      logger.warn({
        source: 'mstp-runtime',
        event: 'device_missed_scan',
        message: `Device MAC ${missed.mstpMacAddress} / instance ${missed.deviceInstance} was not rediscovered in this scan; marking stale/missedScans=${missed.missedScans}.`,
        requestId: req.requestId,
        mstpMac: missed.mstpMacAddress,
        deviceInstance: missed.deviceInstance,
      });
    }

    res.json({
      ...discovery,
      inventory,
      seenDevices: inventory?.seenDevices || [],
      missedDevices,
      inventoryTotals: inventory?.inventoryTotals || null,
      latestDiscoverySessionId: inventory?.latestDiscoverySessionId
        || discovery.discoverySessionId
        || null,
      coordination: {
        executionPaused: true,
        pollingPaused: true,
        deviceHealthPaused: true,
        message: 'Background polling and device health paused for discovery',
      },
      requestId: req.requestId,
    });
  } finally {
    mstpBusCoordinator.releaseBus(mstpBusCoordinator.BUS_OWNER.DISCOVERY);
    mstpBusCoordinator.resumeAfterDiscovery();
  }
}));

router.get('/mstp/logs', (_req, res) => {
  res.json(bacnetMstpService.getLogs());
});

router.post('/mstp/clear-logs', (_req, res) => {
  res.json(bacnetMstpService.clearLogs());
});

router.get('/mstp/frames', (_req, res) => {
  res.json(bacnetMstpService.getFrames());
});

router.post('/mstp/clear-session', (req, res) => {
  const session = bacnetMstpService.clearSession();
  const inventory = deviceService.clearLatestScanSession();
  logger.info({
    source: 'mstp-runtime',
    event: 'session_cleared',
    message: 'BACnet MS/TP latest scan session cleared (inventory preserved)',
    requestId: req.requestId,
  });
  res.json({ success: true, session, inventory });
});

module.exports = router;
