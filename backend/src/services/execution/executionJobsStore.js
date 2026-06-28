const fs = require('fs');
const path = require('path');

const JOBS_PATH = path.join(__dirname, '../../data/executionJobs.json');

function ensureJobsFile() {
  const dir = path.dirname(JOBS_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  if (!fs.existsSync(JOBS_PATH)) {
    fs.writeFileSync(JOBS_PATH, '[]', 'utf8');
  }
}

function loadJobs() {
  ensureJobsFile();
  try {
    const raw = fs.readFileSync(JOBS_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveJobs(jobs) {
  ensureJobsFile();
  fs.writeFileSync(JOBS_PATH, `${JSON.stringify(jobs, null, 2)}\n`, 'utf8');
}

let idCounter = 0;

function generateJobId() {
  idCounter += 1;
  return `exec-${Date.now()}-${idCounter}`;
}

module.exports = {
  JOBS_PATH,
  loadJobs,
  saveJobs,
  generateJobId,
};
