const hardwareMetrics = require('../../lib/hardwareMetrics');

function getSerialInterfaces() {
  return {
    ports: hardwareMetrics.getSerialPorts(),
    scannedAt: new Date().toISOString(),
  };
}

function getNetworkInterfaces() {
  return {
    interfaces: hardwareMetrics.getNetworkInterfaces(),
    scannedAt: new Date().toISOString(),
  };
}

module.exports = {
  getSerialInterfaces,
  getNetworkInterfaces,
};
