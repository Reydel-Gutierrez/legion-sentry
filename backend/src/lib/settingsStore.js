const fs = require('fs');
const path = require('path');

const SETTINGS_PATH = path.join(__dirname, '..', 'data', 'settings.json');

let cache = null;

function loadSettings() {
  if (!cache) {
    const raw = fs.readFileSync(SETTINGS_PATH, 'utf8');
    cache = JSON.parse(raw);
  }
  return cache;
}

function saveSettings(next) {
  cache = next;
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(next, null, 2));
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
