const os = require('os');
const { DEVICE } = require('../../config');
const deviceService = require('../devices');
const logsService = require('../logs');

const bootTime = Date.now();

function randomInRange(min, max) {
  return Math.round((min + Math.random() * (max - min)) * 10) / 10;
}

function formatUptime(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts = [];
  if (days) parts.push(`${days}d`);
  parts.push(`${hours}h`);
  parts.push(`${minutes}m`);
  parts.push(`${seconds}s`);
  return parts.join(' ');
}

function getSystemStatus() {
  const uptimeMs = Date.now() - bootTime + 3 * 24 * 60 * 60 * 1000;
  const interfaces = os.networkInterfaces();
  const eth0 = Object.values(interfaces)
    .flat()
    .find((iface) => iface && !iface.internal && iface.family === 'IPv4');

  return {
    identity: {
      product: DEVICE.product,
      hardwareProfile: DEVICE.hardwareProfile,
      hostname: DEVICE.hostname,
      firmwareVersion: DEVICE.firmwareVersion,
      productCode: DEVICE.productCode,
      deviceId: DEVICE.deviceId,
    },
    system: {
      cpuUsage: randomInRange(8, 28),
      memoryUsage: randomInRange(34, 52),
      storageUsage: randomInRange(18, 36),
      temperature: randomInRange(41, 49),
      uptime: formatUptime(uptimeMs),
      uptimeMs,
    },
    interfaces: {
      eth0: {
        name: 'ETH0',
        status: 'up',
        ip: eth0?.address || '192.168.1.50',
        speed: '1000 Mbps',
        link: 'connected',
      },
      wifi: {
        name: 'WiFi',
        status: 'down',
        ip: null,
        signal: null,
      },
      rs485: {
        name: 'RS485-1',
        status: 'up',
        port: '/dev/ttyAMA0',
      },
      gpio: {
        name: 'GPIO',
        status: 'up',
        leds: 5,
        buttons: 2,
      },
    },
    services: {
      bacnetIp: { name: 'BACnet/IP', status: 'running', port: 47808 },
      bacnetMstp: { name: 'BACnet MS/TP', status: 'running', port: '/dev/ttyAMA0' },
      modbusTcp: { name: 'Modbus TCP', status: 'running', port: 502 },
      modbusRtu: { name: 'Modbus RTU', status: 'running', port: '/dev/ttyAMA0' },
      mqtt: { name: 'MQTT', status: 'stopped', port: 1883 },
    },
    devices: deviceService.getDashboardSummary(),
    recentEvents: logsService.getLogs('all').slice(0, 6),
    topBar: {
      productName: 'Sentry G1',
      productCode: DEVICE.productCode,
      ip: eth0?.address || '192.168.1.50',
      uptime: formatUptime(uptimeMs),
    },
  };
}

function getHealth() {
  return {
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: DEVICE.firmwareVersion,
  };
}

function getSystemInfo() {
  const interfaces = os.networkInterfaces();
  const eth0 = Object.values(interfaces)
    .flat()
    .find((iface) => iface && !iface.internal && iface.family === 'IPv4');

  return {
    os: `${os.type()} ${os.release()}`,
    nodeVersion: process.version,
    firmwareVersion: DEVICE.firmwareVersion,
    appVersion: DEVICE.firmwareVersion,
    hardwareProfile: DEVICE.hardwareProfile,
    architecture: os.arch(),
    hostname: DEVICE.hostname,
    ip: eth0?.address || '192.168.1.50',
    productCode: DEVICE.productCode,
    diskUsage: randomInRange(18, 36),
    memoryTotalMb: Math.round(os.totalmem() / 1024 / 1024),
    memoryFreeMb: Math.round(os.freemem() / 1024 / 1024),
    cpuCount: os.cpus().length,
  };
}

module.exports = {
  getSystemStatus,
  getHealth,
  getSystemInfo,
  formatUptime,
};
