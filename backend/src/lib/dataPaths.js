/**
 * Resolve mutable appliance data outside the Git working tree in production.
 *
 * LEGION_SENTRY_DATA_DIR overrides everything.
 * Production default: /var/lib/legion-sentry
 * Development default: backend/src/data (legacy path, gitignored for mutable files)
 */
const fs = require('fs');
const path = require('path');
const { atomicWriteFile, atomicWriteJson } = require('./atomicWrite');

const REPO_DATA_DIR = path.join(__dirname, '..', 'data');
const PRODUCTION_DATA_DIR = '/var/lib/legion-sentry';

const DATA_FILES = Object.freeze([
  'auth.json',
  'bacnet.json',
  'devices.json',
  'managedDevices.json',
  'managedPoints.json',
  'discoveredPoints.json',
  'executionJobs.json',
  'settings.json',
  'network.json',
  'logs.jsonl',
]);

function isProductionNodeEnv(nodeEnv = process.env.NODE_ENV) {
  return nodeEnv === 'production';
}

function resolveDataDir(options = {}) {
  const envDir = options.envDir ?? process.env.LEGION_SENTRY_DATA_DIR;
  if (envDir && String(envDir).trim()) {
    return path.resolve(String(envDir).trim());
  }
  if (options.forceProduction || isProductionNodeEnv(options.nodeEnv)) {
    return PRODUCTION_DATA_DIR;
  }
  return options.devDir ? path.resolve(options.devDir) : REPO_DATA_DIR;
}

function ensureDataDir(dataDir = resolveDataDir()) {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  return dataDir;
}

function dataFilePath(name, dataDir = resolveDataDir()) {
  return path.join(dataDir, name);
}

function listExistingDataFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return DATA_FILES.filter((name) => fs.existsSync(path.join(dir, name)));
}

/**
 * Migrate mutable files from sourceDir → targetDir.
 * Never silently overwrites existing target files.
 */
function migrateDataDirectory({
  sourceDir = REPO_DATA_DIR,
  targetDir = resolveDataDir({ forceProduction: true }),
  dryRun = false,
  overwrite = false,
} = {}) {
  const result = {
    dryRun: Boolean(dryRun),
    sourceDir,
    targetDir,
    copied: [],
    skipped: [],
    missing: [],
    backupDir: null,
    errors: [],
  };

  if (!fs.existsSync(sourceDir)) {
    result.errors.push(`Source data directory does not exist: ${sourceDir}`);
    return result;
  }

  if (path.resolve(sourceDir) === path.resolve(targetDir)) {
    result.errors.push('Source and target directories are the same — nothing to migrate');
    return result;
  }

  const existing = listExistingDataFiles(sourceDir);
  if (existing.length === 0) {
    result.missing.push(...DATA_FILES);
    return result;
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = path.join(targetDir, 'backups', `pre-migration-${stamp}`);
  result.backupDir = backupDir;

  if (!dryRun) {
    ensureDataDir(targetDir);
    fs.mkdirSync(backupDir, { recursive: true });
  }

  for (const name of DATA_FILES) {
    const src = path.join(sourceDir, name);
    const dest = path.join(targetDir, name);

    if (!fs.existsSync(src)) {
      result.missing.push(name);
      continue;
    }

    if (fs.existsSync(dest) && !overwrite) {
      result.skipped.push({ file: name, reason: 'target_exists' });
      continue;
    }

    if (dryRun) {
      result.copied.push({ file: name, action: 'would_copy' });
      continue;
    }

    try {
      if (fs.existsSync(dest)) {
        fs.copyFileSync(dest, path.join(backupDir, name));
      }
      fs.copyFileSync(src, dest);
      // Preserve mode best-effort
      try {
        const stat = fs.statSync(src);
        fs.chmodSync(dest, stat.mode);
      } catch {
        // ignore chmod failures
      }
      result.copied.push({ file: name, action: overwrite && fs.existsSync(dest) ? 'overwritten' : 'copied' });
    } catch (err) {
      result.errors.push(`${name}: ${err.message}`);
    }
  }

  // Copy backups folder contents if present under source
  const srcBackups = path.join(sourceDir, 'backups');
  if (fs.existsSync(srcBackups) && !dryRun) {
    const destBackups = path.join(targetDir, 'backups');
    fs.mkdirSync(destBackups, { recursive: true });
  }

  return result;
}

function writeRuntimeMarker(dataDir = resolveDataDir(), payload = {}) {
  const markerPath = path.join(dataDir, 'runtime.json');
  atomicWriteJson(markerPath, {
    dataDir,
    updatedAt: new Date().toISOString(),
    ...payload,
  });
  return markerPath;
}

module.exports = {
  REPO_DATA_DIR,
  PRODUCTION_DATA_DIR,
  DATA_FILES,
  resolveDataDir,
  ensureDataDir,
  dataFilePath,
  listExistingDataFiles,
  migrateDataDirectory,
  writeRuntimeMarker,
  atomicWriteFile,
  atomicWriteJson,
  isProductionNodeEnv,
};
