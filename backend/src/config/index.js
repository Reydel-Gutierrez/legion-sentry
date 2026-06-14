require('dotenv').config();

const PORT = Number(process.env.PORT) || 3001;
const NODE_ENV = process.env.NODE_ENV || 'development';

const DEVICE = {
  product: 'Legion Sentry G1',
  productCode: 'LCG1DEV10026',
  hardwareProfile: 'Sentry DEV-1',
  hostname: 'sentry-dev-1',
  firmwareVersion: '0.1.0-dev',
  deviceId: 'sentry-dev-1',
};

module.exports = {
  PORT,
  NODE_ENV,
  DEVICE,
};
