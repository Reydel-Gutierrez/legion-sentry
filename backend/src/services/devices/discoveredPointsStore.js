const fs = require('fs');
const path = require('path');
const { atomicWriteJson } = require('../../lib/atomicWrite');

const DISCOVERED_PATH = path.join(__dirname, '../../data/discoveredPoints.json');

function ensureFile() {
  const dir = path.dirname(DISCOVERED_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  if (!fs.existsSync(DISCOVERED_PATH)) {
    atomicWriteJson(DISCOVERED_PATH, [], { backup: false });
  }
}

function loadRecords() {
  ensureFile();
  try {
    const raw = fs.readFileSync(DISCOVERED_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveRecords(records) {
  ensureFile();
  atomicWriteJson(DISCOVERED_PATH, records, { backup: true });
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
  DISCOVERED_PATH,
  loadRecords,
  saveRecords,
  getRecordForDevice,
  saveDiscoveryResult,
  clearForDevice,
  countForDevice,
};
