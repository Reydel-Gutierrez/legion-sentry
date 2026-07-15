#!/usr/bin/env node
/**
 * Migrate mutable appliance data from the repo data dir to LEGION_SENTRY_DATA_DIR
 * (production default: /var/lib/legion-sentry).
 *
 * Usage:
 *   node backend/scripts/migrate-data.js [--dry-run] [--overwrite]
 *   npm run migrate:data
 *   npm run migrate:data -- --dry-run
 */
const path = require('path');
const {
  REPO_DATA_DIR,
  resolveDataDir,
  migrateDataDirectory,
} = require('../src/lib/dataPaths');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run') || args.includes('-n');
const overwrite = args.includes('--overwrite');

const sourceDir = process.env.LEGION_SENTRY_MIGRATE_FROM
  ? path.resolve(process.env.LEGION_SENTRY_MIGRATE_FROM)
  : REPO_DATA_DIR;
const targetDir = resolveDataDir({
  forceProduction: process.env.LEGION_SENTRY_DATA_DIR
    ? false
    : process.env.NODE_ENV === 'production',
});

const result = migrateDataDirectory({
  sourceDir,
  targetDir,
  dryRun,
  overwrite,
});

console.log(JSON.stringify(result, null, 2));

if (result.errors.length) {
  process.exitCode = 1;
}
