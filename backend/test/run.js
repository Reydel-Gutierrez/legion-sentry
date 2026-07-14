#!/usr/bin/env node
const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const unitDir = path.join(__dirname, 'unit');
const files = fs.readdirSync(unitDir)
  .filter((name) => name.endsWith('.test.js'))
  .sort();

let failed = 0;
for (const file of files) {
  const full = path.join(unitDir, file);
  console.log(`\n› ${file}`);
  const result = spawnSync(process.execPath, [full], {
    stdio: 'inherit',
    env: { ...process.env, NODE_ENV: 'test', SENTRY_SILENCE_LOG_PERSIST: '1' },
  });
  if (result.status !== 0) failed += 1;
}

if (failed > 0) {
  console.error(`\nBackend tests failed (${failed} file(s)).`);
  process.exit(1);
}

console.log('\nAll backend test files passed.');
