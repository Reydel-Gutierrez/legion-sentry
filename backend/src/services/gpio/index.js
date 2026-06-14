const modbusService = require('../modbus');

function getGpioDiagnostics() {
  return {
    powerLed: { name: 'Power LED', state: 'on', color: 'green' },
    ethernetLed: { name: 'Ethernet LED', state: 'blink', color: 'green' },
    bacnetLed: { name: 'BACnet LED', state: 'on', color: 'green' },
    interfaceLed: { name: 'Interface LED', state: 'off', color: 'yellow' },
    faultLed: { name: 'Fault LED', state: 'off', color: 'red' },
    resetButton: { name: 'Reset Button', state: 'released' },
    serviceButton: { name: 'Service Button', state: 'released' },
  };
}

function getDiagnosticsSummary() {
  const modbus = modbusService.getModbusStatus();

  return {
    network: {
      ping: { target: '8.8.8.8', success: true, latencyMs: 14 },
      dns: { host: 'google.com', success: true, resolvedIp: '142.250.80.46' },
      gateway: { target: '192.168.1.1', success: true, latencyMs: 2 },
    },
    bacnet: {
      ipRxPackets: 12847,
      ipTxPackets: 9234,
      mstpRxPackets: 5645,
      mstpTxPackets: 4810,
      timeouts: 7,
      retries: 14,
      crcErrors: 2,
      lastError: 'NPDU timeout on MS/TP token poll (recovered)',
    },
    modbus: {
      rtuStatus: modbus.rtu.status,
      tcpStatus: modbus.tcp.status,
      lastResponseTimeMs: modbus.rtu.lastResponseMs,
      errorCount: 1,
    },
    gpio: getGpioDiagnostics(),
  };
}

function runPing(target = '8.8.8.8') {
  return {
    success: true,
    target,
    packetsSent: 4,
    packetsReceived: 4,
    packetLoss: 0,
    minMs: 12,
    avgMs: 15,
    maxMs: 19,
    timestamp: new Date().toISOString(),
  };
}

module.exports = {
  getDiagnosticsSummary,
  getGpioDiagnostics,
  runPing,
};
