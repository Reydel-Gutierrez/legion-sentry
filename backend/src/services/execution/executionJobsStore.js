const fs = require('fs');
const { atomicWriteJson } = require('../../lib/atomicWrite');
const { dataFilePath, ensureDataDir } = require('../../lib/dataPaths');

function getJobsPath() {
  return dataFilePath('executionJobs.json');
}

function ensureJobsFile() {
  ensureDataDir();
  const JOBS_PATH = getJobsPath();
  if (!fs.existsSync(JOBS_PATH)) {
    atomicWriteJson(JOBS_PATH, [], { backup: false });
  }
}

function loadJobs() {
  ensureJobsFile();
  try {
    const raw = fs.readFileSync(getJobsPath(), 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveJobs(jobs) {
  ensureJobsFile();
  // High-churn job file — skip .bak on every write; primary file stays atomic.
  atomicWriteJson(getJobsPath(), jobs, { backup: false });
}

let idCounter = 0;

function generateJobId() {
  idCounter += 1;
  return `exec-${Date.now()}-${idCounter}`;
}

module.exports = {
  get JOBS_PATH() { return getJobsPath(); },
  loadJobs,
  saveJobs,
  generateJobId,
};
