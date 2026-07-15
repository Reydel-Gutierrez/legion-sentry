const fs = require('fs');
const path = require('path');
const { dataFilePath, ensureDataDir, REPO_DATA_DIR, atomicWriteJson } = require('../../lib/dataPaths');

function getInventoryPath() {
  return dataFilePath('devices.json');
}

function ensureInventoryFile() {
  ensureDataDir();
  const INVENTORY_PATH = getInventoryPath();
  if (!fs.existsSync(INVENTORY_PATH)) {
    const seed = path.join(REPO_DATA_DIR, 'devices.json');
    if (fs.existsSync(seed) && path.resolve(seed) !== path.resolve(INVENTORY_PATH)) {
      fs.copyFileSync(seed, INVENTORY_PATH);
    } else {
      atomicWriteJson(INVENTORY_PATH, [], { backup: false });
    }
  }
}

function loadInventory() {
  ensureInventoryFile();
  try {
    const raw = fs.readFileSync(getInventoryPath(), 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveInventory(devices) {
  ensureInventoryFile();
  atomicWriteJson(getInventoryPath(), devices, { backup: true });
}

function generateDeviceId(protocol, deviceInstance, address) {
  const safeAddress = String(address).replace(/[^a-zA-Z0-9]/g, '-');
  return `${protocol}-${deviceInstance}-${safeAddress}`;
}

module.exports = {
  get INVENTORY_PATH() { return getInventoryPath(); },
  loadInventory,
  saveInventory,
  generateDeviceId,
};
