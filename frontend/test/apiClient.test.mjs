import assert from 'assert';
import {
  extractErrorMessage,
  getDiscoverJobFromResponse,
  shouldSuppressDiscoverClick,
} from '../src/api/parseApiError.js';

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    return true;
  } catch (err) {
    console.log(`  ✗ ${name}`);
    console.log(`    ${err.stack || err.message}`);
    return false;
  }
}

let passed = 0;
let failed = 0;

function run(name, fn) {
  if (test(name, fn)) passed += 1;
  else failed += 1;
}

run('parses structured API error message', () => {
  const message = extractErrorMessage({
    success: false,
    error: {
      code: 'POINT_DISCOVERY_ALREADY_RUNNING',
      message: 'Point discovery is already running for this device.',
    },
  }, 409);
  assert.strictEqual(message, 'Point discovery is already running for this device.');
});

run('falls back to legacy string error', () => {
  assert.strictEqual(extractErrorMessage({ error: 'legacy' }, 500), 'legacy');
});

run('discover job is read from nested data envelope', () => {
  const job = getDiscoverJobFromResponse({ success: true, data: { job: { id: 'job-1' } } });
  assert.strictEqual(job.id, 'job-1');
});

run('rapid click is suppressed while loading', () => {
  assert.strictEqual(shouldSuppressDiscoverClick({ loading: true }), true);
  assert.strictEqual(shouldSuppressDiscoverClick({ loading: false }), false);
});

run('discoverManagedDevicePoints path contract', () => {
  const id = 'managed-mstp-1-mac-4';
  const expected = `/devices/managed/${id}/discover-points`;
  assert.strictEqual(expected, '/devices/managed/managed-mstp-1-mac-4/discover-points');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
