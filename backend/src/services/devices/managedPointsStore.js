const fs = require('fs');
const path = require('path');

const POINTS_PATH = path.join(__dirname, '../../data/managedPoints.json');

function ensurePointsFile() {
  const dir = path.dirname(POINTS_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  if (!fs.existsSync(POINTS_PATH)) {
    fs.writeFileSync(POINTS_PATH, '[]', 'utf8');
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
  fs.writeFileSync(POINTS_PATH, `${JSON.stringify(points, null, 2)}\n`, 'utf8');
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
