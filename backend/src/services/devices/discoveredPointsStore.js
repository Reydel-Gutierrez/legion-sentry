const fs = require('fs');
const { atomicWriteJson } = require('../../lib/atomicWrite');
const { dataFilePath, ensureDataDir } = require('../../lib/dataPaths');

function getDiscoveredPath() {
  return dataFilePath('discoveredPoints.json');
}

function ensureFile() {
  ensureDataDir();
  const DISCOVERED_PATH = getDiscoveredPath();
  if (!fs.existsSync(DISCOVERED_PATH)) {
    atomicWriteJson(DISCOVERED_PATH, [], { backup: false });
  }
}

function loadRecords() {
  ensureFile();
  try {
    const raw = fs.readFileSync(getDiscoveredPath(), 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveRecords(records) {
  ensureFile();
  atomicWriteJson(getDiscoveredPath(), records, { backup: true });
}

function getRecordForDevice(managedDeviceId) {
  return loadRecords().find((r) => r.managedDeviceId === managedDeviceId) || null;
}

function saveDiscoveryResult(managedDeviceId, points, lastDiscoveryAt) {
  const records = loadRecords().filter((r) => r.managedDeviceId !== managedDeviceId);
  records.push({
    managedDeviceId,
    lastDiscoveryAt: lastDiscoveryAt || new Date().toISOString(),
    points: Array.isArray(points) ? points : [],
  });
  saveRecords(records);
  return records.find((r) => r.managedDeviceId === managedDeviceId);
}

function clearForDevice(managedDeviceId) {
  const records = loadRecords().filter((r) => r.managedDeviceId !== managedDeviceId);
  const removed = loadRecords().length - records.length;
  saveRecords(records);
  return { removed, managedDeviceId };
}

function countForDevice(managedDeviceId) {
  const record = getRecordForDevice(managedDeviceId);
  return record?.points?.length ?? 0;
}

module.exports = {
  get DISCOVERED_PATH() { return getDiscoveredPath(); },
  loadRecords,
  saveRecords,
  getRecordForDevice,
  saveDiscoveryResult,
  clearForDevice,
  countForDevice,
};
