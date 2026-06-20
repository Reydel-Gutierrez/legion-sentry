const { PORT } = require('./config');
const app = require('./app');
const logsService = require('./services/logs');

const authService = require('./services/auth');

app.listen(PORT, () => {
  authService.loadAuthConfig();
  logsService.seedStartupLog();
  console.log(`Legion Sentry API listening on http://localhost:${PORT}`);
  console.log('  Dashboard data: GET /api/system/status');
  console.log('  Health:         GET /api/system/health');
});
