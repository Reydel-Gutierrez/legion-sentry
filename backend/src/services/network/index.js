const os = require('os');
const { execSync } = require('child_process');
const hardwareMetrics = require('../../lib/hardwareMetrics');
const networkManager = require('./networkManager.service');

function getInterfaceMac(name) {
  const addrs = os.networkInterfaces()[name];
  if (!addrs) return null;
  const entry = addrs.find((a) => a.mac && a.mac !== '00:00:00:00:00:00');
  return entry?.mac || null;
}

function getLiveInterfaces() {
  const names = ['eth0', 'wlan0', 'lo'];
  const managerInfo = networkManager.getNetworkManager();

  return names.map((name) => {
    const status = hardwareMetrics.getNetworkInterfaces().find((i) => i.name === name)
      || { name, status: 'not_present', operstate: null, addresses: [] };
    const ipv4 = status.addresses?.find((a) => a.family === 'IPv4');
    const connection = managerInfo.connections.find((c) => c.device === name);

    return {
      name,
      status: status.status,
      operstate: status.operstate,
      ipv4: ipv4?.address || null,
      mac: getInterfaceMac(name),
      addresses: status.addresses || [],
      connection: connection?.name || null,
      connectionType: connection?.type || null,
    };
  });
}

function getNetworkStatus() {
  const live = getLiveInterfaces();
  const managerInfo = networkManager.getNetworkManager();
  const primaryIp = hardwareMetrics.getPrimaryIpv4();
  const eth0 = live.find((i) => i.name === 'eth0');
  const wlan0 = live.find((i) => i.name === 'wlan0');

  return {
    live: {
      interfaces: live,
      hostname: os.hostname(),
      primaryIp,
    },
    manager: {
      name: managerInfo.manager,
      active: managerInfo.active,
      supported: managerInfo.supported,
      runtimeMode: managerInfo.runtimeMode,
    },
    runtimeMode: managerInfo.runtimeMode,
    hostname: os.hostname(),
    currentIp: primaryIp,
    eth0,
    wlan0,
  };
}

function getDefaultGateway() {
  if (os.platform() !== 'linux') return null;
  try {
    const output = execSync('ip route show default', { encoding: 'utf8', timeout: 5000 });
    const match = output.match(/default via (\S+)/);
    return match?.[1] || null;
  } catch {
    return null;
  }
}

function runPing(target, count = 3) {
  const platform = os.platform();
  const cmd = platform === 'win32'
    ? `ping -n ${count} ${target}`
    : `ping -c ${count} -W 2 ${target}`;

  try {
    const output = execSync(cmd, { encoding: 'utf8', timeout: 15000 });
    const avgMatch = output.match(/Average\s*=\s*(\d+)ms/i)
      || output.match(/min\/avg\/max[^=]*=\s*[\d.]+\/([\d.]+)/);
    const lossMatch = output.match(/(\d+)%\s*(loss|packet loss)/i);
    return {
      success: true,
      target,
      latencyMs: avgMatch ? Math.round(Number(avgMatch[1])) : null,
      packetLoss: lossMatch ? Number(lossMatch[1]) : 0,
      output: output.split('\n').slice(-4).join('\n').trim(),
    };
  } catch (err) {
    return {
      success: false,
      target,
      error: err.message,
      packetLoss: 100,
    };
  }
}

function testConnectivity() {
  return runPing('8.8.8.8');
}

function testGatewayPing() {
  const gateway = getDefaultGateway();
  if (!gateway) {
    return {
      success: false,
      target: null,
      error: 'No default gateway found on this system',
    };
  }
  return runPing(gateway);
}

function testDns() {
  const platform = os.platform();

  if (platform === 'linux') {
    try {
      const output = execSync('getent hosts google.com', {
        encoding: 'utf8',
        timeout: 5000,
      });
      return {
        success: true,
        dns: 'system',
        resolved: output.trim().split('\n')[0] || 'google.com',
      };
    } catch {
      return runPing('8.8.8.8');
    }
  }

  return runPing('8.8.8.8');
}

module.exports = {
  getNetworkStatus,
  getLiveInterfaces,
  getNetworkManager: networkManager.getNetworkManager,
  testConnectivity,
  testGatewayPing,
  testDns,
};
