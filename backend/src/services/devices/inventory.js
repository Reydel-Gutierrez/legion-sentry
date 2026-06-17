const fs = require('fs');
const path = require('path');

const INVENTORY_PATH = path.join(__dirname, '../../data/devices.json');

function ensureInventoryFile() {
  const dir = path.dirname(INVENTORY_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  if (!fs.existsSync(INVENTORY_PATH)) {
    fs.writeFileSync(INVENTORY_PATH, '[]', 'utf8');
  }
}

function loadInventory() {
  ensureInventoryFile();
  try {
    const raw = fs.readFileSync(INVENTORY_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveInventory(devices) {
  ensureInventoryFile();
  fs.writeFileSync(INVENTORY_PATH, `${JSON.stringify(devices, null, 2)}\n`, 'utf8');
}

function generateDeviceId(protocol, deviceInstance, address) {
  const safeAddress = String(address).replace(/[^a-zA-Z0-9]/g, '-');
  return `${protocol}-${deviceInstance}-${safeAddress}`;
}

module.exports = {
  INVENTORY_PATH,
  loadInventory,
  saveInventory,
  generateDeviceId,
};
