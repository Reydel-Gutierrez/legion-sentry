const assert = require('assert');
const path = require('path');
const fs = require('fs');

const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

async function run() {
  let passed = 0;
  let failed = 0;
  const failures = [];

  for (const entry of tests) {
    try {
      await entry.fn();
      passed += 1;
      console.log(`  ✓ ${entry.name}`);
    } catch (err) {
      failed += 1;
      failures.push({ name: entry.name, err });
      console.log(`  ✗ ${entry.name}`);
      console.log(`    ${err.stack || err.message}`);
    }
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exitCode = 1;
  }
}

module.exports = {
  test,
  assert,
  run,
  path,
  fs,
};
