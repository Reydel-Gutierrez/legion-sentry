const fs = require('fs');
const path = require('path');
const { dataFilePath, ensureDataDir, REPO_DATA_DIR, atomicWriteJson } = require('./dataPaths');

function getSettingsPath() {
  return dataFilePath('settings.json');
}

let cache = null;

function ensureSettingsFile() {
  ensureDataDir();
  const SETTINGS_PATH = getSettingsPath();
  if (!fs.existsSync(SETTINGS_PATH)) {
    const seed = path.join(REPO_DATA_DIR, 'settings.json');
    if (fs.existsSync(seed) && path.resolve(seed) !== path.resolve(SETTINGS_PATH)) {
      fs.copyFileSync(seed, SETTINGS_PATH);
    } else {
      atomicWriteJson(SETTINGS_PATH, {
        bacnet: { mstp: { enabled: true, serialPort: '/dev/serial0', baudRate: 38400, macAddress: 3, networkNumber: 2 } },
      }, { backup: false });
    }
  }
}

function loadSettings() {
  if (!cache) {
    ensureSettingsFile();
    const raw = fs.readFileSync(getSettingsPath(), 'utf8');
    cache = JSON.parse(raw);
  }
  return cache;
}

function saveSettings(next) {
  cache = next;
  ensureSettingsFile();
  atomicWriteJson(getSettingsPath(), next, { backup: true });
  return cache;
}

function updateSection(section, patch) {
  const current = loadSettings();
  current[section] = { ...current[section], ...patch };
  return saveSettings(current);
}

module.exports = {
  loadSettings,
  saveSettings,
  updateSection,
};
