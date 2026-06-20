const os = require('os');
const { execSync } = require('child_process');
const hardwareMetrics = require('../../lib/hardwareMetrics');

function isServiceActive(serviceName) {
  if (os.platform() === 'win32') return false;
  try {
    const result = execSync(`systemctl is-active ${serviceName}`, {
      encoding: 'utf8',
      timeout: 5000,
    }).trim();
    return result === 'active';
  } catch {
    return false;
  }
}

function parseNmcliLine(line) {
  const parts = [];
  let current = '';
  for (let i = 0; i < line.length; i += 1) {
    if (line[i] === '\\' && line[i + 1] === ':') {
      current += ':';
      i += 1;
    } else if (line[i] === ':') {
      parts.push(current);
      current = '';
    } else {
      current += line[i];
    }
  }
  parts.push(current);
  return parts;
}

function parseNmcliConnections(output) {
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [name, device, type] = parseNmcliLine(line);
      return {
        name: name || '',
        device: device || '',
        type: type || '',
        active: true,
      };
    })
    .filter((entry) => entry.name);
}

function getNmcliActiveConnections() {
  try {
    const output = execSync('nmcli -t -f NAME,DEVICE,TYPE con show --active', {
      encoding: 'utf8',
      timeout: 10000,
    });
    return parseNmcliConnections(output);
  } catch {
    return [];
  }
}

function getNetworkManager() {
  const runtimeMode = hardwareMetrics.getRuntimeMode();

  if (os.platform() === 'win32') {
    return {
      runtimeMode,
      manager: 'unsupported',
      active: false,
      supported: false,
      connections: [],
    };
  }

  const nmActive = isServiceActive('NetworkManager');
  const networkdActive = isServiceActive('systemd-networkd');
  const dhcpcdActive = isServiceActive('dhcpcd');

  let manager = 'unsupported';
  if (nmActive) manager = 'NetworkManager';
  else if (networkdActive) manager = 'systemd-networkd';
  else if (dhcpcdActive) manager = 'dhcpcd';

  const connections = nmActive ? getNmcliActiveConnections() : [];

  return {
    runtimeMode,
    manager,
    active: nmActive || networkdActive || dhcpcdActive,
    supported: nmActive,
    connections,
  };
}

function findActiveConnectionForDevice(deviceName) {
  const { connections, supported } = getNetworkManager();
  if (!supported) return null;
  return connections.find((entry) => entry.device === deviceName) || null;
}

module.exports = {
  getNetworkManager,
  findActiveConnectionForDevice,
  parseNmcliLine,
  parseNmcliConnections,
};
