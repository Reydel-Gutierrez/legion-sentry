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

function validateStaticPayload(payload) {
  const { ipAddress, cidr, gateway, dns } = payload;
  if (!ipAddress || !/^\d{1,3}(\.\d{1,3}){3}$/.test(ipAddress)) {
    const err = new Error('A valid IPv4 address is required for static configuration.');
    err.statusCode = 400;
    throw err;
  }
  const cidrNum = Number(cidr);
  if (!Number.isInteger(cidrNum) || cidrNum < 1 || cidrNum > 32) {
    const err = new Error('CIDR must be an integer between 1 and 32.');
    err.statusCode = 400;
    throw err;
  }
  if (!gateway || !/^\d{1,3}(\.\d{1,3}){3}$/.test(gateway)) {
    const err = new Error('A valid gateway is required for static configuration.');
    err.statusCode = 400;
    throw err;
  }
  const dnsList = Array.isArray(dns) ? dns.filter(Boolean) : [];
  if (dnsList.length === 0) {
    const err = new Error('At least one DNS server is required for static configuration.');
    err.statusCode = 400;
    throw err;
  }
  for (const server of dnsList) {
    if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(server)) {
      const err = new Error(`Invalid DNS server: ${server}`);
      err.statusCode = 400;
      throw err;
    }
  }
  return { ipAddress, cidr: cidrNum, gateway, dns: dnsList };
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
  const dnsValue = staticConfig.dns.join(' ');
  execSudoNmcli(`con mod ${quoted} ipv4.method manual`);
  execSudoNmcli(`con mod ${quoted} ipv4.addresses "${staticConfig.ipAddress}/${staticConfig.cidr}"`);
  execSudoNmcli(`con mod ${quoted} ipv4.gateway ${shellQuote(staticConfig.gateway)}`);
  execSudoNmcli(`con mod ${quoted} ipv4.dns ${shellQuote(dnsValue)}`);
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
};
