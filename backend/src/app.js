const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

const requireAuth = require('./middleware/requireAuth');
const authRoutes = require('./routes/auth');
const systemRoutes = require('./routes/system');
const networkRoutes = require('./routes/network');
const bacnetRoutes = require('./routes/bacnet');
const modbusRoutes = require('./routes/modbus');
const mqttRoutes = require('./routes/mqtt');
const diagnosticsRoutes = require('./routes/diagnostics');
const logsRoutes = require('./routes/logs');
const devicesRoutes = require('./routes/devices');
const interfacesRoutes = require('./routes/interfaces');
const executionRoutes = require('./routes/execution');

const app = express();

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(morgan('dev'));

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', service: 'legion-sentry-api' });
});

app.use('/api/auth', authRoutes);

app.use(requireAuth);

app.use('/api/system', systemRoutes);
app.use('/api/network', networkRoutes);
app.use('/api/bacnet', bacnetRoutes);
app.use('/api/modbus', modbusRoutes);
app.use('/api/mqtt', mqttRoutes);
app.use('/api/diagnostics', diagnosticsRoutes);
app.use('/api/logs', logsRoutes);
app.use('/api/devices', devicesRoutes);
app.use('/api/execution', executionRoutes);
app.use('/api/interfaces', interfacesRoutes);

app.use((err, _req, res, _next) => {
  console.error(err);
  const status = err.statusCode || 500;
  res.status(status).json({
    error: err.message || 'Internal server error',
    code: err.code,
  });
});

module.exports = app;
