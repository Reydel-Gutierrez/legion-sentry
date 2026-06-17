const fs = require('fs');
const os = require('os');
const { execSync } = require('child_process');
const { DEVICE } = require('../config');

function formatUptime(seconds) {
  const totalSeconds = Math.floor(seconds);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;
  const parts = [];
  if (days) parts.push(`${days}d`);
  parts.push(`${hours}h`);
  parts.push(`${minutes}m`);
  parts.push(`${secs}s`);
  return parts.join(' ');
}

function readFileIfExists(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8').trim();
  } catch {
    return null;
  }
}

function detectHardwareProfile() {
  const piModel = readFileIfExists('/proc/device-tree/model');
  if (piModel) return piModel.replace(/\0/g, '');

  const platform = os.platform();
  const arch = os.arch();
  if (platform === 'linux') return `Linux ${arch}`;
  if (platform === 'win32') return `Windows ${arch}`;
  if (platform === 'darwin') return `macOS ${arch}`;
  return `${platform} ${arch}`;
}

function isRealHardware() {
  const platform = os.platform();
  if (platform === 'linux') {
    const piModel = readFileIfExists('/proc/device-tree/model');
    if (piModel && piModel.toLowerCase().includes('raspberry pi')) return true;
    return fs.existsSync('/proc/cpuinfo');
  }
  return false;
}

function getRuntimeMode() {
  if (process.env.MOCK_DATA === 'true') return 'DEVELOPMENT';
  return isRealHardware() ? 'REAL HARDWARE' : 'DEVELOPMENT';
}

function getIpAddresses() {
  const interfaces = os.networkInterfaces();
  const addresses = [];

  for (const [name, addrs] of Object.entries(interfaces)) {
    if (!addrs) continue;
    for (const addr of addrs) {
      if (addr.internal) continue;
      addresses.push({
        interface: name,
        address: addr.address,
        family: addr.family,
        mac: addr.mac !== '00:00:00:00:00:00' ? addr.mac : undefined,
      });
    }
  }

  return addresses;
}

function getPrimaryIpv4() {
  const eth0 = os.networkInterfaces().eth0;
  if (eth0) {
    const ipv4 = eth0.find((a) => a.family === 'IPv4' && !a.internal);
    if (ipv4) return ipv4.address;
  }

  const addresses = getIpAddresses();
  const first = addresses.find((a) => a.family === 'IPv4');
  return first?.address || null;
}

function getMemoryMetrics() {
  const total = os.totalmem();
  const free = os.freemem();
  const used = total - free;
  const totalMb = Math.round(total / 1024 / 1024);
  const freeMb = Math.round(free / 1024 / 1024);
  const usedMb = Math.round(used / 1024 / 1024);
  const usagePercent = total > 0 ? Math.round((used / total) * 1000) / 10 : 0;

  return { totalMb, usedMb, freeMb, usagePercent };
}

function getCpuLoadMetrics() {
  const cores = os.cpus().length;
  const [load1, load5, load15] = os.loadavg();
  const percent = cores > 0 ? Math.min(100, Math.round((load1 / cores) * 1000) / 10) : 0;

  return {
    percent,
    loadAvg1m: Math.round(load1 * 100) / 100,
    loadAvg5m: Math.round(load5 * 100) / 100,
    loadAvg15m: Math.round(load15 * 100) / 100,
    cores,
  };
}

function getDiskMetricsFromDf() {
  try {
    const output = execSync('df -B1 /', { encoding: 'utf8', timeout: 3000 });
    const line = output.trim().split('\n')[1];
    if (!line) return null;
    const parts = line.split(/\s+/);
    const total = Number(parts[1]);
    const used = Number(parts[2]);
    const free = Number(parts[3]);
    if (!total) return null;
    const totalGb = Math.round((total / 1024 / 1024 / 1024) * 10) / 10;
    const usedGb = Math.round((used / 1024 / 1024 / 1024) * 10) / 10;
    const freeGb = Math.round((free / 1024 / 1024 / 1024) * 10) / 10;
    const usagePercent = Math.round((used / total) * 1000) / 10;
    return { totalGb, usedGb, freeGb, usagePercent };
  } catch {
    return null;
  }
}

function getDiskMetrics() {
  if (typeof fs.statfsSync === 'function') {
    try {
      const stat = fs.statfsSync('/');
      const blockSize = stat.bsize;
      const total = stat.blocks * blockSize;
      const free = stat.bfree * blockSize;
      const used = total - free;
      const totalGb = Math.round((total / 1024 / 1024 / 1024) * 10) / 10;
      const usedGb = Math.round((used / 1024 / 1024 / 1024) * 10) / 10;
      const freeGb = Math.round((free / 1024 / 1024 / 1024) * 10) / 10;
      const usagePercent = total > 0 ? Math.round((used / total) * 1000) / 10 : 0;
      return { totalGb, usedGb, freeGb, usagePercent };
    } catch {
      // fall through to df on Linux
    }
  }

  if (os.platform() === 'linux') {
    return getDiskMetricsFromDf();
  }

  return null;
}

function getTemperature() {
  const thermalPaths = [
    '/sys/class/thermal/thermal_zone0/temp',
    '/sys/devices/virtual/thermal/thermal_zone0/temp',
  ];

  for (const thermalPath of thermalPaths) {
    const raw = readFileIfExists(thermalPath);
    if (raw && /^\d+$/.test(raw)) {
      return Math.round(parseInt(raw, 10) / 10) / 10;
    }
  }

  return null;
}

function getInterfaceStatus(name) {
  const addrs = os.networkInterfaces()[name];
  if (!addrs) {
    return { name, status: 'not_present', addresses: [] };
  }

  const addresses = addrs
    .filter((a) => !a.internal)
    .map((a) => ({ address: a.address, family: a.family, mac: a.mac }));

  const operstate = readFileIfExists(`/sys/class/net/${name}/operstate`);
  const status = operstate === 'up' || addresses.length > 0 ? 'up' : operstate || 'down';

  return { name, status, operstate, addresses };
}

function getHardwareStatus() {
  const uptimeSeconds = os.uptime();
  const memory = getMemoryMetrics();
  const cpuLoad = getCpuLoadMetrics();
  const disk = getDiskMetrics();
  const temperature = getTemperature();
  const hardwareProfile = detectHardwareProfile();

  return {
    hostname: os.hostname(),
    platform: `${os.type()} ${os.release()}`,
    arch: os.arch(),
    uptime: {
      seconds: Math.floor(uptimeSeconds),
      formatted: formatUptime(uptimeSeconds),
    },
    ipAddresses: getIpAddresses(),
    memory,
    cpuLoad,
    disk,
    temperature,
    nodeVersion: process.version,
    appVersion: DEVICE.firmwareVersion,
    hardwareProfile,
    runtimeMode: getRuntimeMode(),
  };
}

function pathExists(devicePath) {
  try {
    fs.accessSync(devicePath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function getSerialPorts() {
  const candidates = ['/dev/ttyAMA0', '/dev/serial0', '/dev/ttyS0', '/dev/ttyUSB0'];
  return candidates
    .filter(pathExists)
    .map((port) => ({ path: port, present: true }));
}

function getNetworkInterfaces() {
  const names = ['eth0', 'wlan0', 'lo'];
  return names.map((name) => getInterfaceStatus(name));
}

module.exports = {
  formatUptime,
  detectHardwareProfile,
  isRealHardware,
  getRuntimeMode,
  getHardwareStatus,
  getPrimaryIpv4,
  getSerialPorts,
  getNetworkInterfaces,
  getMemoryMetrics,
  getCpuLoadMetrics,
  getDiskMetrics,
  getTemperature,
};
