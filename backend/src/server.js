const { PORT } = require('./config');
const app = require('./app');
const logsService = require('./services/logs');
const networkService = require('./services/network');

const authService = require('./services/auth');

app.listen(PORT, () => {
  authService.loadAuthConfig();
  logsService.seedStartupLog();
  const manager = networkService.getNetworkManager();
  logsService.addLog({
    level: 'info',
    service: 'network',
    message: `Network manager detected: ${manager.manager} (active: ${manager.active})`,
  });
  console.log(`Legion Sentry API listening on http://localhost:${PORT}`);
  console.log('  Dashboard data: GET /api/system/status');
  console.log('  Health:         GET /api/system/health');
});
