const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');
const hardwareMetrics = require('../../lib/hardwareMetrics');
const { loadSettings } = require('../../lib/settingsStore');

const NETWORK_CONFIG_PATH = path.join(__dirname, '../../data/network.json');

function ensureNetworkConfigFile() {
  const dir = path.dirname(NETWORK_CONFIG_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  if (!fs.existsSync(NETWORK_CONFIG_PATH)) {
    const settings = loadSettings();
    const hostname = settings.network?.hostname || os.hostname();
    const defaultConfig = {
      hostname,
      interfaces: {
        eth0: {
          mode: settings.network?.ethernet?.dhcpEnabled !== false ? 'dhcp' : 'static',
          ipAddress: settings.network?.ethernet?.staticIp || '',
          cidr: settings.network?.ethernet?.subnetMask || '255.255.255.0',
          gateway: settings.network?.ethernet?.gateway || '',
          dns1: settings.network?.ethernet?.dns?.[0] || '',
          dns2: settings.network?.ethernet?.dns?.[1] || '',
        },
        wlan0: {
          mode: 'dhcp',
          ipAddress: settings.network?.wifi?.ipAddress || '',
          cidr: '255.255.255.0',
          gateway: '',
          dns1: '',
          dns2: '',
          enabled: settings.network?.wifi?.enabled || false,
          ssid: settings.network?.wifi?.ssid || '',
        },
      },
      applyStatus: 'none',
      savedAt: null,
      appliedAt: null,
    };
    fs.writeFileSync(NETWORK_CONFIG_PATH, `${JSON.stringify(defaultConfig, null, 2)}\n`, 'utf8');
  }
}

function loadNetworkConfig() {
  ensureNetworkConfigFile();
  const raw = fs.readFileSync(NETWORK_CONFIG_PATH, 'utf8');
  return JSON.parse(raw);
}

function saveNetworkConfig(config) {
  ensureNetworkConfigFile();
  config.savedAt = new Date().toISOString();
  fs.writeFileSync(NETWORK_CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  return config;
}

function getInterfaceMac(name) {
  const addrs = os.networkInterfaces()[name];
  if (!addrs) return null;
  const entry = addrs.find((a) => a.mac && a.mac !== '00:00:00:00:00:00');
  return entry?.mac || null;
}

function getLiveInterfaces() {
  const names = ['eth0', 'wlan0', 'lo'];
  return names.map((name) => {
    const status = hardwareMetrics.getNetworkInterfaces().find((i) => i.name === name)
      || { name, status: 'not_present', operstate: null, addresses: [] };
    const ipv4 = status.addresses?.find((a) => a.family === 'IPv4');
    return {
      name,
      status: status.status,
      operstate: status.operstate,
      ipv4: ipv4?.address || null,
      mac: getInterfaceMac(name),
      addresses: status.addresses || [],
    };
  });
}

function getNetworkStatus() {
  const live = getLiveInterfaces();
  const saved = loadNetworkConfig();
  const primaryIp = hardwareMetrics.getPrimaryIpv4();
  const eth0 = live.find((i) => i.name === 'eth0');
  const wlan0 = live.find((i) => i.name === 'wlan0');

  return {
    live: {
      interfaces: live,
      hostname: os.hostname(),
      primaryIp,
    },
    saved,
    applyStatus: saved.applyStatus || 'none',
    hostname: saved.hostname || os.hostname(),
    currentIp: primaryIp,
    eth0,
    wlan0,
  };
}

function saveNetworkSettings(payload) {
  const current = loadNetworkConfig();
  const next = {
    ...current,
    hostname: payload.hostname ?? current.hostname,
    interfaces: {
      eth0: { ...current.interfaces.eth0, ...(payload.eth0 || payload.ethernet || {}) },
      wlan0: { ...current.interfaces.wlan0, ...(payload.wlan0 || payload.wifi || {}) },
    },
    applyStatus: 'pending',
  };
  saveNetworkConfig(next);
  return getNetworkStatus();
}

function applyNetworkSettings() {
  const config = loadNetworkConfig();
  config.applyStatus = 'pending';
  config.applyNote = 'Apply to OS network stack is not automated in DEV-1. Saved configuration is staged for manual or future apply.';
  saveNetworkConfig(config);

  return {
    success: true,
    applyStatus: 'pending',
    message: 'Network configuration saved and marked pending. OS-level apply is not automated in DEV-1 to avoid disconnecting active sessions.',
    warning: 'Changing IP settings may disconnect this session when applied to the OS.',
    saved: config,
  };
}

function restartNetwork() {
  if (os.platform() === 'linux') {
    try {
      execSync('sudo systemctl restart networking 2>/dev/null || sudo systemctl restart NetworkManager 2>/dev/null || true', {
        encoding: 'utf8',
        timeout: 10000,
      });
      return {
        success: true,
        message: 'Network restart requested. Interfaces may reconnect shortly.',
        timestamp: new Date().toISOString(),
        mode: 'linux',
      };
    } catch (err) {
      return {
        success: false,
        message: `Network restart not available: ${err.message}`,
        timestamp: new Date().toISOString(),
        mode: 'linux',
      };
    }
  }

  return {
    success: false,
    message: 'Network restart is only available on Linux/Raspberry Pi.',
    timestamp: new Date().toISOString(),
    mode: 'development',
  };
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
  const config = loadNetworkConfig();
  const gateway = config.interfaces?.eth0?.gateway || config.interfaces?.wlan0?.gateway;
  if (!gateway) {
    return {
      success: false,
      target: null,
      error: 'No gateway configured in saved network settings',
    };
  }
  return runPing(gateway);
}

function testDns() {
  const config = loadNetworkConfig();
  const dns = config.interfaces?.eth0?.dns1 || config.interfaces?.wlan0?.dns1 || '8.8.8.8';
  const platform = os.platform();

  if (platform === 'linux') {
    try {
      const output = execSync(`getent hosts google.com ${dns ? '' : ''}`.trim(), {
        encoding: 'utf8',
        timeout: 5000,
      });
      return {
        success: true,
        dns,
        resolved: output.trim().split('\n')[0] || 'google.com',
      };
    } catch {
      return runPing(dns);
    }
  }

  return runPing(dns);
}

module.exports = {
  NETWORK_CONFIG_PATH,
  getNetworkStatus,
  getLiveInterfaces,
  loadNetworkConfig,
  saveNetworkSettings,
  applyNetworkSettings,
  restartNetwork,
  testConnectivity,
  testGatewayPing,
  testDns,
};
