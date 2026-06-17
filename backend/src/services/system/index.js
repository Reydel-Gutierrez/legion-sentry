const { DEVICE } = require('../../config');
const hardwareMetrics = require('../../lib/hardwareMetrics');
const deviceService = require('../devices');
const logsService = require('../logs');

const DISCOVERY_IMPLEMENTED = process.env.MOCK_DATA === 'true';

function getServiceStatuses() {
  return {
    bacnetIp: { name: 'BACnet/IP', status: 'not_configured', label: 'Not configured', port: null },
    bacnetMstp: { name: 'BACnet MS/TP', status: 'not_configured', label: 'Not configured', port: null },
    modbusTcp: { name: 'Modbus TCP', status: 'not_configured', label: 'Not configured', port: null },
    modbusRtu: { name: 'Modbus RTU', status: 'not_configured', label: 'Not configured', port: null },
    mqtt: { name: 'MQTT', status: 'disabled', label: 'Disabled', port: null },
  };
}

function getSystemStatus() {
  const hardware = hardwareMetrics.getHardwareStatus();
  const eth0 = hardwareMetrics.getNetworkInterfaces().find((iface) => iface.name === 'eth0');
  const eth0Ipv4 = eth0?.addresses?.find((a) => a.family === 'IPv4');
  const primaryIp = eth0Ipv4?.address || hardwareMetrics.getPrimaryIpv4();

  return {
    ...hardware,
    identity: {
      product: DEVICE.product,
      hardwareProfile: hardware.hardwareProfile,
      hostname: hardware.hostname,
      firmwareVersion: DEVICE.firmwareVersion,
      productCode: DEVICE.productCode,
      deviceId: DEVICE.deviceId,
    },
    system: {
      cpuUsage: hardware.cpuLoad.percent,
      memoryUsage: hardware.memory.usagePercent,
      storageUsage: hardware.disk?.usagePercent ?? null,
      temperature: hardware.temperature,
      uptime: hardware.uptime.formatted,
      uptimeMs: hardware.uptime.seconds * 1000,
      os: hardware.platform,
    },
    interfaces: {
      eth0: {
        name: 'eth0',
        status: eth0?.status || 'not_present',
        ip: eth0Ipv4?.address || null,
        operstate: eth0?.operstate || null,
      },
    },
    services: getServiceStatuses(),
    devices: deviceService.getDashboardSummary(),
    recentEvents: logsService.getLogs('all').slice(0, 6),
    discoveryImplemented: DISCOVERY_IMPLEMENTED,
    topBar: {
      productName: DEVICE.product,
      productCode: DEVICE.productCode,
      hostname: hardware.hostname,
      ip: primaryIp || '—',
      uptime: hardware.uptime.formatted,
      runtimeMode: hardware.runtimeMode,
    },
  };
}

function getHealth() {
  return {
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: DEVICE.firmwareVersion,
    runtimeMode: hardwareMetrics.getRuntimeMode(),
  };
}

function getSystemInfo() {
  const hardware = hardwareMetrics.getHardwareStatus();
  const primaryIp = hardwareMetrics.getPrimaryIpv4();

  return {
    os: hardware.platform,
    nodeVersion: hardware.nodeVersion,
    firmwareVersion: DEVICE.firmwareVersion,
    appVersion: hardware.appVersion,
    hardwareProfile: hardware.hardwareProfile,
    architecture: hardware.arch,
    hostname: hardware.hostname,
    ip: primaryIp || '—',
    productCode: DEVICE.productCode,
    diskUsage: hardware.disk?.usagePercent ?? null,
    memoryTotalMb: hardware.memory.totalMb,
    memoryFreeMb: hardware.memory.freeMb,
    memoryUsedMb: hardware.memory.usedMb,
    cpuCount: hardware.cpuLoad.cores,
    cpuLoadPercent: hardware.cpuLoad.percent,
    temperature: hardware.temperature,
    uptime: hardware.uptime.formatted,
    runtimeMode: hardware.runtimeMode,
  };
}

module.exports = {
  getSystemStatus,
  getHealth,
  getSystemInfo,
  formatUptime: hardwareMetrics.formatUptime,
};
