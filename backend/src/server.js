const { PORT } = require('./config');
const app = require('./app');

app.listen(PORT, () => {
  console.log(`Legion Sentry API listening on http://localhost:${PORT}`);
  console.log('  Dashboard data: GET /api/system/status');
  console.log('  Health:         GET /api/system/health');
});
