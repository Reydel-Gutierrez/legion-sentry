const fs = require('fs');
const path = require('path');

const MANAGED_PATH = path.join(__dirname, '../../data/managedDevices.json');

function ensureManagedFile() {
  const dir = path.dirname(MANAGED_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  if (!fs.existsSync(MANAGED_PATH)) {
    fs.writeFileSync(MANAGED_PATH, '[]', 'utf8');
  }
}

function loadManaged() {
  ensureManagedFile();
  try {
    const raw = fs.readFileSync(MANAGED_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveManaged(devices) {
  ensureManagedFile();
  fs.writeFileSync(MANAGED_PATH, `${JSON.stringify(devices, null, 2)}\n`, 'utf8');
}

function generateManagedId(deviceInstance, mstpMacAddress) {
  const safeMac = String(mstpMacAddress).replace(/[^a-zA-Z0-9]/g, '-');
  return `managed-mstp-${deviceInstance}-mac-${safeMac}`;
}

module.exports = {
  MANAGED_PATH,
  loadManaged,
  saveManaged,
  generateManagedId,
};
