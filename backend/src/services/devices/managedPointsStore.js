const fs = require('fs');
const path = require('path');
const { atomicWriteJson } = require('../../lib/atomicWrite');

const POINTS_PATH = path.join(__dirname, '../../data/managedPoints.json');

function ensurePointsFile() {
  const dir = path.dirname(POINTS_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  if (!fs.existsSync(POINTS_PATH)) {
    atomicWriteJson(POINTS_PATH, [], { backup: false });
  }
}

function loadPoints() {
  ensurePointsFile();
  try {
    const raw = fs.readFileSync(POINTS_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function savePoints(points) {
  ensurePointsFile();
  atomicWriteJson(POINTS_PATH, points, { backup: true });
}

function generatePointId(managedDeviceId, objectType, objectInstance) {
  return `${managedDeviceId}-${objectType}-${objectInstance}`;
}

module.exports = {
  POINTS_PATH,
  loadPoints,
  savePoints,
  generatePointId,
};
