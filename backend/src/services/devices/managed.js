const fs = require('fs');
const { atomicWriteJson } = require('../../lib/atomicWrite');
const { dataFilePath, ensureDataDir } = require('../../lib/dataPaths');

function getManagedPath() {
  return dataFilePath('managedDevices.json');
}

function ensureManagedFile() {
  ensureDataDir();
  const MANAGED_PATH = getManagedPath();
  if (!fs.existsSync(MANAGED_PATH)) {
    atomicWriteJson(MANAGED_PATH, [], { backup: false });
  }
}

function loadManaged() {
  ensureManagedFile();
  try {
    const raw = fs.readFileSync(getManagedPath(), 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveManaged(devices) {
  ensureManagedFile();
  atomicWriteJson(getManagedPath(), devices, { backup: true });
}

function generateManagedId(deviceInstance, mstpMacAddress) {
  const safeMac = String(mstpMacAddress).replace(/[^a-zA-Z0-9]/g, '-');
  return `managed-mstp-${deviceInstance}-mac-${safeMac}`;
}

module.exports = {
  get MANAGED_PATH() { return getManagedPath(); },
  loadManaged,
  saveManaged,
  generateManagedId,
};
