const fs = require('fs');
const { atomicWriteJson } = require('../../lib/atomicWrite');
const { dataFilePath, ensureDataDir } = require('../../lib/dataPaths');

function getPointsPath() {
  return dataFilePath('managedPoints.json');
}

function ensurePointsFile() {
  ensureDataDir();
  const POINTS_PATH = getPointsPath();
  if (!fs.existsSync(POINTS_PATH)) {
    atomicWriteJson(POINTS_PATH, [], { backup: false });
  }
}

function loadPoints() {
  ensurePointsFile();
  try {
    const raw = fs.readFileSync(getPointsPath(), 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function savePoints(points) {
  ensurePointsFile();
  atomicWriteJson(getPointsPath(), points, { backup: true });
}

function generatePointId(managedDeviceId, objectType, objectInstance) {
  return `${managedDeviceId}-${objectType}-${objectInstance}`;
}

module.exports = {
  get POINTS_PATH() { return getPointsPath(); },
  loadPoints,
  savePoints,
  generatePointId,
};
