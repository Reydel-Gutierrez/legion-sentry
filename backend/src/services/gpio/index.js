const { execSync } = require('child_process');
const os = require('os');
const hardwareMetrics = require('../../lib/hardwareMetrics');
const serialService = require('../interfaces/serial.service');
const logsService = require('../logs');
const { DEVICE_STATES } = require('../../lib/deviceStates');

function getGpioDiagnostics() {
  return {
    powerLed: { name: 'Power LED', state: 'not_implemented', color: 'green' },
    ethernetLed: { name: 'Ethernet LED', state: 'not_implemented', color: 'green' },
    bacnetLed: { name: 'BACnet LED', state: 'not_implemented', color: 'green' },
    interfaceLed: { name: 'Interface LED', state: 'not_implemented', color: 'yellow' },
    faultLed: { name: 'Fault LED', state: 'not_implemented', color: 'red' },
    resetButton: { name: 'Reset Button', state: 'not_implemented' },
    serviceButton: { name: 'Service Button', state: 'not_implemented' },
  };
}

function runRealPing(target) {
  const isWindows = os.platform() === 'win32';
  const flag = isWindows ? '-n' : '-c';
  const timeoutFlag = isWindows ? '-w' : '-W';
  const timeoutVal = isWindows ? '3000' : '3';

  try {
    const output = execSync(`ping ${flag} 4 ${timeoutFlag} ${timeoutVal} ${target}`, {
      encoding: 'utf8',
      timeout: 15000,
    });

    const avgMatch = output.match(/Average\s*=\s*(\d+)ms/i)
      || output.match(/avg\/[^=]*=\s*[\d.]+\/([\d.]+)/i)
      || output.match(/min\/avg\/max[^=]*=\s*[\d.]+\/([\d.]+)/i);
    const lossMatch = output.match(/(\d+)%\s*(loss|packet loss)/i);

    return {
      success: true,
      target,
      packetsSent: 4,
      packetsReceived: lossMatch ? 4 - Math.round((Number(lossMatch[1]) / 100) * 4) : 4,
      packetLoss: lossMatch ? Number(lossMatch[1]) : 0,
      minMs: null,
      avgMs: avgMatch ? Math.round(Number(avgMatch[1])) : null,
      maxMs: null,
      timestamp: new Date().toISOString(),
    };
  } catch (err) {
    return {
      success: false,
      target,
      packetsSent: 4,
      packetsReceived: 0,
      packetLoss: 100,
      minMs: null,
      avgMs: null,
      maxMs: null,
      error: err.message,
      timestamp: new Date().toISOString(),
    };
  }
}

function getDiagnosticsSummary() {
  const serialDetail = serialService.getSerialDetail();
  const networkInterfaces = hardwareMetrics.getNetworkInterfaces();
  const bacnetLogs = logsService.getLogs('bacnet').slice(0, 10);
  const serialLogs = logsService.getLogs('interfaces').slice(0, 10);

  return {
    hardware: hardwareMetrics.getHardwareStatus(),
    network: {
      interfaces: networkInterfaces,
      primaryIp: hardwareMetrics.getPrimaryIpv4(),
      ping: { implemented: true, note: 'Use Run Ping Test for live check' },
    },
    serial: {
      ports: serialDetail.ports,
      lastOpenCheck: serialService.getLastOpenCheck(),
      lastConfigure: serialService.getLastConfigure(),
    },
    bacnet: {
      ipDiscoveryImplemented: true,
      mstpDiscoveryImplemented: false,
      routingImplemented: false,
      routingStatus: 'Routing not implemented in DEV-1 software yet',
      recentLogs: bacnetLogs,
    },
    modbus: {
      tcpStatus: DEVICE_STATES.NOT_CONFIGURED,
      rtuStatus: DEVICE_STATES.NOT_CONFIGURED,
      note: 'Modbus protocol stack not implemented in DEV-1',
    },
    gpio: getGpioDiagnostics(),
    recentSerialLogs: serialLogs,
  };
}

function runPing(target = '8.8.8.8') {
  return runRealPing(target);
}

module.exports = {
  getDiagnosticsSummary,
  getGpioDiagnostics,
  runPing,
};
