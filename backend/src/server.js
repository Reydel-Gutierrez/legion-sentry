const { PORT, NODE_ENV } = require('./config');
const app = require('./app');
const logsService = require('./services/logs');
const networkService = require('./services/network');
const authService = require('./services/auth');
const fieldExecutionEngine = require('./services/execution/fieldExecutionEngine');
const pointPollingEngine = require('./services/execution/pointPollingEngine');
const deviceHealthPoller = require('./services/execution/deviceHealthPoller');
const bacnetMstpService = require('./services/bacnet/bacnetMstp.service');
const bacnetService = require('./services/bacnet');
const { ensureDataDir, resolveDataDir, writeRuntimeMarker } = require('./lib/dataPaths');
const logger = require('./services/logger');

const SHUTDOWN_TIMEOUT_MS = Number(process.env.LEGION_SENTRY_SHUTDOWN_TIMEOUT_MS) || 20000;

let httpServer = null;
let shuttingDown = false;

async function startApplication() {
  ensureDataDir();
  writeRuntimeMarker(resolveDataDir(), { phase: 2, nodeEnv: NODE_ENV });

  authService.loadAuthConfig();
  logsService.seedStartupLog();

  httpServer = app.listen(PORT, async () => {
    console.log(`Legion Sentry API listening on http://localhost:${PORT}`);
    console.log(`  Data dir:       ${resolveDataDir()}`);
    console.log('  Dashboard data: GET /api/system/status');
    console.log('  Health:         GET /api/system/health');

    fieldExecutionEngine.startWorker();

    // Start MS/TP runtime before background schedulers when enabled.
    // Auto-start on appliance (production) or when explicitly requested.
    let runtimeReady = false;
    try {
      const mstp = bacnetService.loadBacnetConfig()?.mstp || {};
      const enabled = mstp.enabled !== false;
      const autoStart = process.env.LEGION_SENTRY_AUTO_START_MSTP === '1'
        || (process.env.LEGION_SENTRY_AUTO_START_MSTP !== '0' && NODE_ENV === 'production');
      if (enabled && autoStart) {
        await bacnetMstpService.startRuntime();
        runtimeReady = true;
        logger.info({
          source: 'mstp-runtime',
          event: 'runtime_auto_started',
          message: 'BACnet MS/TP runtime started at application boot',
        });
      }
    } catch (err) {
      logger.warn({
        source: 'mstp-runtime',
        event: 'runtime_auto_start_failed',
        message: `MS/TP runtime auto-start failed: ${err.message}`,
      });
      try {
        await bacnetMstpService.recoverRuntime('boot_start_failed');
      } catch {
        // ignore
      }
    }

    // Pollers start after boot; they skip work while runtime is not ready.
    void runtimeReady;
    pointPollingEngine.start();
    deviceHealthPoller.start();

    const manager = networkService.getNetworkManager();
    logsService.addLog({
      level: 'info',
      service: 'network',
      message: `Network manager detected: ${manager.manager} (active: ${manager.active})`,
    });
    logsService.addLog({
      level: 'info',
      service: 'system',
      message: 'Legion Sentry ready',
    });
  });

  return httpServer;
}

async function gracefulShutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[system] ${signal} received — graceful shutdown`);

  const forceTimer = setTimeout(() => {
    console.error('[system] Shutdown timeout exceeded — forcing exit');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  forceTimer.unref?.();

  try {
    pointPollingEngine.stop();
    deviceHealthPoller.stop();
    fieldExecutionEngine.cancelQueuedBackgroundJobs('shutdown');
    await fieldExecutionEngine.waitForIdleOrCancel(5000);
    fieldExecutionEngine.stopWorker();
    await bacnetMstpService.stopRuntime('process_shutdown');
  } catch (err) {
    console.error('[system] Shutdown runtime cleanup error:', err.message);
  }

  await new Promise((resolve) => {
    if (!httpServer) {
      resolve();
      return;
    }
    httpServer.close(() => resolve());
    // Stop accepting ASAP
    try {
      httpServer.closeIdleConnections?.();
    } catch {
      // ignore
    }
  });

  clearTimeout(forceTimer);
  console.log('[system] Shutdown complete');
  process.exit(0);
}

process.once('SIGTERM', () => {
  gracefulShutdown('SIGTERM').catch(() => process.exit(1));
});
process.once('SIGINT', () => {
  gracefulShutdown('SIGINT').catch(() => process.exit(1));
});

if (require.main === module) {
  startApplication().catch((err) => {
    console.error('[system] Failed to start:', err);
    process.exit(1);
  });
}

module.exports = {
  startApplication,
  gracefulShutdown,
  SHUTDOWN_TIMEOUT_MS,
};
