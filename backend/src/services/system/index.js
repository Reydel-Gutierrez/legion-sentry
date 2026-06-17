const { DEVICE } = require('../../config');
const hardwareMetrics = require('../../lib/hardwareMetrics');
const { loadSettings } = require('../../lib/settingsStore');
const { DEVICE_STATES } = require('../../lib/deviceStates');
const deviceService = require('../devices');
const serialService = require('../interfaces/serial.service');
const logsService = require('../logs');

function mapServiceState(enabled, configured) {
  if (!enabled) return { status: DEVICE_STATES.DISABLED, label: 'Disabled' };
  if (!configured) return { status: DEVICE_STATES.NOT_CONFIGURED, label: 'Not configured' };
  return { status: DEVICE_STATES.READY, label: 'Ready' };
}

function getServiceStatuses() {
  const settings = loadSettings();
  const bacnet = settings.bacnet || {};
  const modbus = settings.modbus || {};
  const mqtt = settings.mqtt || {};

  const bacnetIp = mapServiceState(bacnet.ip?.enabled, true);
  const bacnetMstp = mapServiceState(bacnet.mstp?.enabled, bacnet.mstp?.serialPort);
  const modbusTcp = mapServiceState(modbus.tcp?.enabled, true);
  const modbusRtu = mapServiceState(modbus.rtu?.enabled, modbus.rtu?.serialPort);
  const mqttState = mqtt.enabled
    ? { status: DEVICE_STATES.READY, label: 'Ready' }
    : { status: DEVICE_STATES.DISABLED, label: 'Disabled' };

  return {
    bacnetIp: { name: 'BACnet/IP', ...bacnetIp, port: bacnet.ip?.udpPort || null },
    bacnetMstp: { name: 'BACnet MS/TP', ...bacnetMstp, port: bacnet.mstp?.serialPort || null },
    modbusTcp: { name: 'Modbus TCP', ...modbusTcp, port: modbus.tcp?.port || null },
    modbusRtu: { name: 'Modbus RTU', ...modbusRtu, port: modbus.rtu?.serialPort || null },
    mqtt: { name: 'MQTT', ...mqttState, port: mqtt.port || null },
    routing: {
      name: 'BACnet Routing',
      status: DEVICE_STATES.NOT_CONFIGURED,
      label: 'Not implemented',
      port: null,
    },
  };
}

function getSerialStatus() {
  const detail = serialService.getSerialDetail();
  const recommended = detail.ports.find((p) => p.recommendedForRs485 && p.exists)
    || detail.ports.find((p) => p.exists);
  const lastCheck = serialService.getLastOpenCheck();

  return {
    recommendedPort: recommended?.path || null,
    portOpen: lastCheck?.success === true,
    lastCheck,
    ports: detail.ports,
  };
}

function getNetworkStatusSummary() {
  const interfaces = hardwareMetrics.getNetworkInterfaces();
  const wlan = interfaces.find((i) => i.name === 'wlan0');
  const eth = interfaces.find((i) => i.name === 'eth0');

  return {
    eth0: eth,
    wlan0: wlan,
    primaryIp: hardwareMetrics.getPrimaryIpv4(),
  };
}

function getSystemStatus() {
  const hardware = hardwareMetrics.getHardwareStatus();
  const network = getNetworkStatusSummary();
  const eth0 = network.eth0;
  const wlan0 = network.wlan0;
  const eth0Ipv4 = eth0?.addresses?.find((a) => a.family === 'IPv4');
  const wlan0Ipv4 = wlan0?.addresses?.find((a) => a.family === 'IPv4');
  const primaryIp = eth0Ipv4?.address || wlan0Ipv4?.address || network.primaryIp;

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
      wlan0: {
        name: 'wlan0',
        status: wlan0?.status || 'not_present',
        ip: wlan0Ipv4?.address || null,
        operstate: wlan0?.operstate || null,
      },
    },
    serial: getSerialStatus(),
    network: network,
    services: getServiceStatuses(),
    devices: deviceService.getDashboardSummary(),
    recentEvents: logsService.getLogs('all').slice(0, 6),
    discoveryImplemented: deviceService.isDiscoveryImplemented('bacnet-ip'),
    topBar: {
      productName: DEVICE.product,
      productCode: DEVICE.productCode,
      hostname: hardware.hostname,
      ip: primaryIp || '—',
      uptime: hardware.uptime.formatted,
      runtimeMode: hardware.runtimeMode,
      liveDataNote: hardware.runtimeMode === 'REAL HARDWARE'
        ? 'Live data from this Sentry device'
        : null,
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
    serial: getSerialStatus(),
  };
}

module.exports = {
  getSystemStatus,
  getHealth,
  getSystemInfo,
  formatUptime: hardwareMetrics.formatUptime,
};
