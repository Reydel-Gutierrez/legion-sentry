/**
 * Simple appliance file retention helpers (logs, backups, migration dirs).
 */
const fs = require('fs');
const path = require('path');

const DEFAULT_LOG_MAX_BYTES = Number(process.env.LEGION_SENTRY_LOG_MAX_BYTES) || 2 * 1024 * 1024;
const DEFAULT_LOG_RETENTION = Number(process.env.LEGION_SENTRY_LOG_RETENTION) || 5;
const DEFAULT_BACKUP_RETENTION = Number(process.env.LEGION_SENTRY_BACKUP_RETENTION) || 5;
const DEFAULT_MIGRATION_BACKUP_RETENTION = Number(process.env.LEGION_SENTRY_MIGRATION_BACKUP_RETENTION) || 3;

function rotateLogFile(filePath, {
  maxBytes = DEFAULT_LOG_MAX_BYTES,
  retention = DEFAULT_LOG_RETENTION,
} = {}) {
  if (!fs.existsSync(filePath)) return { rotated: false };

  let size = 0;
  try {
    size = fs.statSync(filePath).size;
  } catch {
    return { rotated: false };
  }

  if (size < maxBytes) return { rotated: false, size };

  const dir = path.dirname(filePath);
  const base = path.basename(filePath);

  for (let i = retention - 1; i >= 1; i -= 1) {
    const src = path.join(dir, `${base}.${i}`);
    const dest = path.join(dir, `${base}.${i + 1}`);
    if (fs.existsSync(src)) {
      try {
        if (i + 1 > retention) fs.unlinkSync(src);
        else fs.renameSync(src, dest);
      } catch {
        // best-effort
      }
    }
  }

  const first = path.join(dir, `${base}.1`);
  try {
    fs.renameSync(filePath, first);
    fs.writeFileSync(filePath, '', 'utf8');
  } catch {
    return { rotated: false, size, error: 'rename_failed' };
  }

  // Drop overflow
  const overflow = path.join(dir, `${base}.${retention + 1}`);
  if (fs.existsSync(overflow)) {
    try { fs.unlinkSync(overflow); } catch { /* ignore */ }
  }

  return { rotated: true, previousSize: size };
}

/**
 * Prune dated backup directories under dataDir/backups matching a prefix.
 */
function pruneBackupDirectories(backupsDir, {
  retention = DEFAULT_MIGRATION_BACKUP_RETENTION,
  prefix = 'pre-migration-',
} = {}) {
  if (!fs.existsSync(backupsDir)) return { removed: 0 };

  let entries = [];
  try {
    entries = fs.readdirSync(backupsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && d.name.startsWith(prefix))
      .map((d) => {
        const full = path.join(backupsDir, d.name);
        let mtime = 0;
        try { mtime = fs.statSync(full).mtimeMs; } catch { /* ignore */ }
        return { name: d.name, full, mtime };
      })
      .sort((a, b) => b.mtime - a.mtime);
  } catch {
    return { removed: 0 };
  }

  let removed = 0;
  for (const entry of entries.slice(retention)) {
    try {
      fs.rmSync(entry.full, { recursive: true, force: true });
      removed += 1;
    } catch {
      // best-effort
    }
  }
  return { removed, kept: Math.min(entries.length, retention) };
}

/**
 * Remove sibling .bak files older than retention count / age.
 * Default: keep only the current .bak next to each data file (atomicWrite already
 * overwrites a single .bak). This prunes stray dated backups if present.
 */
function pruneSiblingBakFiles(dataDir, { retention = DEFAULT_BACKUP_RETENTION } = {}) {
  if (!fs.existsSync(dataDir)) return { removed: 0 };

  let removed = 0;
  try {
    const bakFiles = fs.readdirSync(dataDir)
      .filter((name) => name.endsWith('.bak') || /\.bak\.\d+$/.test(name))
      .map((name) => {
        const full = path.join(dataDir, name);
        let mtime = 0;
        try { mtime = fs.statSync(full).mtimeMs; } catch { /* ignore */ }
        return { name, full, mtime };
      })
      .sort((a, b) => b.mtime - a.mtime);

    // Group by base stem (foo.json.bak, foo.json.bak.1 → foo.json)
    const groups = new Map();
    for (const file of bakFiles) {
      const stem = file.name.replace(/\.bak(\.\d+)?$/, '');
      if (!groups.has(stem)) groups.set(stem, []);
      groups.get(stem).push(file);
    }

    for (const files of groups.values()) {
      for (const file of files.slice(retention)) {
        try {
          fs.unlinkSync(file.full);
          removed += 1;
        } catch {
          // ignore
        }
      }
    }
  } catch {
    return { removed: 0 };
  }

  return { removed };
}

module.exports = {
  DEFAULT_LOG_MAX_BYTES,
  DEFAULT_LOG_RETENTION,
  DEFAULT_BACKUP_RETENTION,
  DEFAULT_MIGRATION_BACKUP_RETENTION,
  rotateLogFile,
  pruneBackupDirectories,
  pruneSiblingBakFiles,
};
