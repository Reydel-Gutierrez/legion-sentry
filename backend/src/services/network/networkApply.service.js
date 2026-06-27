const os = require('os');
const { execSync } = require('child_process');
const networkManager = require('./networkManager.service');

const ALLOWED_INTERFACES = new Set(['eth0', 'wlan0']);
const HOSTNAME_PATTERN = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

function createUnsupportedError(message) {
  const err = new Error(message);
  err.statusCode = 501;
  return err;
}

function shellQuote(value) {
  return `"${String(value).replace(/"/g, '\\"')}"`;
}

function isSudoPermissionError(err) {
  const text = `${err.stderr || ''} ${err.message || ''}`.toLowerCase();
  return text.includes('password is required')
    || text.includes('a password is required')
    || text.includes('sudo:')
    || text.includes('not allowed to execute');
}

function execSudo(command) {
  try {
    return execSync(command, { encoding: 'utf8', timeout: 30000 });
  } catch (err) {
    if (isSudoPermissionError(err)) {
      const permissionErr = new Error('Sentry does not have permission to apply network settings. Configure sudoers.');
      permissionErr.statusCode = 403;
      permissionErr.code = 'SUDO_REQUIRED';
      throw permissionErr;
    }
    throw err;
  }
}

function execSudoNmcli(args) {
  return execSudo(`sudo -n nmcli ${args}`);
}

function assertLinuxNetworkManager() {
  if (os.platform() === 'win32') {
    throw createUnsupportedError('Network configuration is only available on Linux hardware.');
  }

  const managerInfo = networkManager.getNetworkManager();
  if (!managerInfo.supported) {
    throw createUnsupportedError(
      `Network configuration requires NetworkManager (current: ${managerInfo.manager}, active: ${managerInfo.active}).`,
    );
  }

  return managerInfo;
}

function resolveConnection(interfaceName) {
  const connection = networkManager.findActiveConnectionForDevice(interfaceName);
  if (!connection) {
    const err = new Error(`No active NetworkManager connection found for ${interfaceName}.`);
    err.statusCode = 400;
    throw err;
  }
  return connection.name;
}

function isValidIpv4(value) {
  if (typeof value !== 'string') return false;
  const parts = value.trim().split('.');
  if (parts.length !== 4) return false;
  return parts.every((part) => {
    if (!/^\d{1,3}$/.test(part)) return false;
    const num = Number(part);
    return num >= 0 && num <= 255;
  });
}

function isValidContiguousSubnetMask(mask) {
  if (!isValidIpv4(mask)) return false;
  const octets = mask.trim().split('.').map(Number);
  // Build the 32-bit unsigned value of the mask.
  const value = ((octets[0] << 24) | (octets[1] << 16) | (octets[2] << 8) | octets[3]) >>> 0;
  if (value === 0) return false; // /0 is not a usable host mask here
  if (value === 0xffffffff) return true; // /32
  // A contiguous mask is a run of 1s followed by a run of 0s.
  // Inverting it + 1 must be a power of two.
  const inverted = (~value) >>> 0;
  return (inverted & (inverted + 1)) === 0;
}

function subnetMaskToCidr(mask) {
  if (!isValidContiguousSubnetMask(mask)) return null;
  const octets = mask.trim().split('.').map(Number);
  const value = ((octets[0] << 24) | (octets[1] << 16) | (octets[2] << 8) | octets[3]) >>> 0;
  let cidr = 0;
  let v = value;
  while (v & 0x80000000) {
    cidr += 1;
    v = (v << 1) >>> 0;
  }
  return cidr;
}

function validateStaticPayload(payload) {
  const { ipAddress, cidr, subnetMask, gateway, dns } = payload;

  if (!isValidIpv4(ipAddress)) {
    const err = new Error('A valid IPv4 address is required for static configuration.');
    err.statusCode = 400;
    throw err;
  }

  // Accept either an explicit subnet mask or a numeric CIDR.
  let cidrNum = null;
  if (subnetMask !== undefined && subnetMask !== null && String(subnetMask).trim() !== '') {
    cidrNum = subnetMaskToCidr(String(subnetMask).trim());
    if (cidrNum === null) {
      const err = new Error('Subnet mask must be a valid contiguous IPv4 mask (e.g. 255.255.255.0).');
      err.statusCode = 400;
      throw err;
    }
  } else {
    cidrNum = Number(cidr);
  }

  if (!Number.isInteger(cidrNum) || cidrNum < 1 || cidrNum > 32) {
    const err = new Error('A valid subnet mask or CIDR (1–32) is required for static configuration.');
    err.statusCode = 400;
    throw err;
  }

  // Gateway is optional. Validate only when provided.
  const gatewayValue = gateway === undefined || gateway === null ? '' : String(gateway).trim();
  if (gatewayValue && !isValidIpv4(gatewayValue)) {
    const err = new Error(`Invalid gateway address: ${gatewayValue}`);
    err.statusCode = 400;
    throw err;
  }

  // DNS is optional. Validate each entry only when provided.
  const dnsList = Array.isArray(dns)
    ? dns.map((d) => String(d).trim()).filter(Boolean)
    : [];
  for (const server of dnsList) {
    if (!isValidIpv4(server)) {
      const err = new Error(`Invalid DNS server: ${server}`);
      err.statusCode = 400;
      throw err;
    }
  }

  return {
    ipAddress: String(ipAddress).trim(),
    cidr: cidrNum,
    gateway: gatewayValue,
    dns: dnsList,
  };
}

function applyDhcpToConnection(connectionName) {
  const quoted = shellQuote(connectionName);
  execSudoNmcli(`con mod ${quoted} ipv4.method auto`);
  execSudoNmcli(`con mod ${quoted} ipv4.addresses ""`);
  execSudoNmcli(`con mod ${quoted} ipv4.gateway ""`);
  execSudoNmcli(`con mod ${quoted} ipv4.dns ""`);
  execSudoNmcli(`con up ${quoted}`);
}

function applyStaticToConnection(connectionName, staticConfig) {
  const quoted = shellQuote(connectionName);
  const address = `${staticConfig.ipAddress}/${staticConfig.cidr}`;
  const gatewayValue = staticConfig.gateway || '';
  const dnsValue = (staticConfig.dns || []).join(' ');

  // Apply everything in a single `con mod` so the address exists before
  // (and in the same transaction as) `ipv4.method manual`. NetworkManager
  // rejects `manual` when no address/route is set, so ordering matters.
  // Blank gateway/DNS are explicitly cleared with "".
  const args = [
    `con mod ${quoted}`,
    `ipv4.addresses ${shellQuote(address)}`,
    'ipv4.method manual',
    `ipv4.gateway ${shellQuote(gatewayValue)}`,
    `ipv4.dns ${shellQuote(dnsValue)}`,
  ].join(' ');

  execSudoNmcli(args);
  execSudoNmcli(`con up ${quoted}`);
}

function applyNetworkSettings(payload = {}) {
  assertLinuxNetworkManager();

  const interfaceName = payload.interface;
  if (!ALLOWED_INTERFACES.has(interfaceName)) {
    const err = new Error('Interface must be eth0 or wlan0.');
    err.statusCode = 400;
    throw err;
  }

  const mode = payload.mode;
  if (mode !== 'dhcp' && mode !== 'static') {
    const err = new Error('Mode must be dhcp or static.');
    err.statusCode = 400;
    throw err;
  }

  const connectionName = resolveConnection(interfaceName);
  const appliedAt = new Date().toISOString();

  if (mode === 'dhcp') {
    applyDhcpToConnection(connectionName);
    return {
      success: true,
      interface: interfaceName,
      connection: connectionName,
      mode: 'dhcp',
      appliedAt,
      message: 'Network settings applied. DHCP is now active on this interface.',
      reconnectHint: null,
    };
  }

  const staticConfig = validateStaticPayload(payload);
  applyStaticToConnection(connectionName, staticConfig);

  return {
    success: true,
    interface: interfaceName,
    connection: connectionName,
    mode: 'static',
    appliedAt,
    message: 'Network settings applied. If this session disconnects, reconnect using the new IP address.',
    reconnectHint: 'If this session disconnects, reconnect using the new IP address.',
  };
}

function restoreDhcp(payload = {}) {
  assertLinuxNetworkManager();

  const interfaceName = payload.interface;
  if (!ALLOWED_INTERFACES.has(interfaceName)) {
    const err = new Error('Interface must be eth0 or wlan0.');
    err.statusCode = 400;
    throw err;
  }

  const connectionName = resolveConnection(interfaceName);
  applyDhcpToConnection(connectionName);

  return {
    success: true,
    interface: interfaceName,
    connection: connectionName,
    mode: 'dhcp',
    appliedAt: new Date().toISOString(),
    message: 'DHCP restored on this interface.',
  };
}

function setHostname(payload = {}) {
  if (os.platform() === 'win32') {
    throw createUnsupportedError('Hostname configuration is only available on Linux hardware.');
  }

  const hostname = String(payload.hostname || '').trim().toLowerCase();
  if (!hostname || hostname.length > 63 || !HOSTNAME_PATTERN.test(hostname)) {
    const err = new Error('Hostname must be 1–63 characters: lowercase letters, numbers, and hyphens only.');
    err.statusCode = 400;
    throw err;
  }

  execSudo(`sudo -n hostnamectl set-hostname ${shellQuote(hostname)}`);

  return {
    success: true,
    hostname,
    message: 'Hostname updated. A reconnect or reboot may be required for all services to reflect the change.',
  };
}

function rebootDevice() {
  if (os.platform() === 'win32') {
    throw createUnsupportedError('Reboot is only available on Linux hardware.');
  }

  execSudo('sudo -n reboot');

  return {
    success: true,
    message: 'Reboot initiated.',
    timestamp: new Date().toISOString(),
  };
}

module.exports = {
  applyNetworkSettings,
  restoreDhcp,
  setHostname,
  rebootDevice,
  validateStaticPayload,
  isValidIpv4,
  subnetMaskToCidr,
  isValidContiguousSubnetMask,
};
