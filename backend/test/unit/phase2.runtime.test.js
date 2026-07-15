const { test, assert, run } = require('../harness');
const {
  RUNTIME_STATE,
  createRuntimeMachine,
  deriveRuntimeState,
  buildRuntimeSnapshot,
} = require('../../src/services/bacnet/mstpRuntimeState');
const { applyHealthResult, DEVICE_HEALTH, nextHealthState } = require('../../src/services/execution/deviceHealth');
const { derivePointQuality, POINT_QUALITY } = require('../../src/services/execution/pointQuality');
const {
  resolveDataDir,
  migrateDataDirectory,
  PRODUCTION_DATA_DIR,
  REPO_DATA_DIR,
} = require('../../src/lib/dataPaths');
const { FakeMstpTransport } = require('../../src/services/bacnet/fakeMstpTransport');
const { getCovCapability } = require('../../src/services/bacnet/covSubscriptions');
const { validateWriteRequest, WRITE_CAPABILITY } = require('../../src/services/bacnet/writeProperty');
const fieldExecutionEngine = require('../../src/services/execution/fieldExecutionEngine');
const fs = require('fs');
const path = require('path');
const os = require('os');

test('runtime machine allows valid transitions and rejects invalid', () => {
  const machine = createRuntimeMachine();
  assert.strictEqual(machine.getState(), RUNTIME_STATE.STOPPED);

  const ok = machine.transitionTo(RUNTIME_STATE.STARTING, 'test_start');
  assert.strictEqual(ok.ok, true);
  assert.strictEqual(machine.getState(), RUNTIME_STATE.STARTING);

  machine.transitionTo(RUNTIME_STATE.LISTENING, 'listen');
  machine.transitionTo(RUNTIME_STATE.JOINING, 'join');
  machine.transitionTo(RUNTIME_STATE.ACTIVE, 'active');
  machine.transitionTo(RUNTIME_STATE.BUSY, 'busy');
  machine.transitionTo(RUNTIME_STATE.ACTIVE, 'done');

  const bad = machine.transitionTo(RUNTIME_STATE.STOPPED, 'illegal');
  assert.strictEqual(bad.ok, false);
  assert.strictEqual(machine.getState(), RUNTIME_STATE.ACTIVE);
});

test('runtime generation increments on bump', () => {
  const machine = createRuntimeMachine();
  assert.strictEqual(machine.getRuntimeGeneration(), 0);
  machine.bumpGeneration('start');
  assert.strictEqual(machine.getRuntimeGeneration(), 1);
  machine.bumpGeneration('restart');
  assert.strictEqual(machine.getRuntimeGeneration(), 2);
});

test('legacy deriveRuntimeState still works', () => {
  assert.strictEqual(deriveRuntimeState({ open: false }), RUNTIME_STATE.STOPPED);
  assert.strictEqual(
    deriveRuntimeState({ open: true, pointDiscoveryInProgress: true }),
    RUNTIME_STATE.BUSY,
  );
});

test('runtime snapshot includes generation and recovery', () => {
  const machine = createRuntimeMachine();
  machine.bumpGeneration('unit');
  machine.transitionTo(RUNTIME_STATE.STARTING, 't');
  machine.transitionTo(RUNTIME_STATE.ACTIVE, 't');
  const snap = buildRuntimeSnapshot({
    machine,
    open: true,
    port: '/dev/serial0',
    recoveryAttempt: 2,
    nextRetryAt: null,
  });
  assert.strictEqual(snap.state, RUNTIME_STATE.ACTIVE);
  assert.strictEqual(snap.runtimeGeneration, 1);
  assert.strictEqual(snap.serialOwner, 'bacnetMstp.service');
  assert.strictEqual(snap.recovery.attempt, 2);
});

test('device health does not go offline after one failure', () => {
  let device = {
    deviceQuality: DEVICE_HEALTH.ONLINE,
    consecutiveSuccesses: 3,
    consecutiveFailures: 0,
  };
  device = applyHealthResult(device, { success: false, error: 'timeout' });
  assert.strictEqual(device.deviceQuality, DEVICE_HEALTH.ONLINE);
  assert.strictEqual(device.consecutiveFailures, 1);

  device = applyHealthResult(device, { success: false, error: 'timeout' });
  assert.strictEqual(device.deviceQuality, DEVICE_HEALTH.DEGRADED);

  device = applyHealthResult(device, { success: false, error: 'timeout' });
  assert.strictEqual(device.deviceQuality, DEVICE_HEALTH.DEGRADED);

  device = applyHealthResult(device, { success: false, error: 'timeout' });
  assert.strictEqual(device.deviceQuality, DEVICE_HEALTH.OFFLINE);
});

test('device health recovers from offline after successes', () => {
  let device = {
    deviceQuality: DEVICE_HEALTH.OFFLINE,
    consecutiveSuccesses: 0,
    consecutiveFailures: 5,
  };
  device = applyHealthResult(device, { success: true, responseTimeMs: 40 });
  assert.strictEqual(device.deviceQuality, DEVICE_HEALTH.DEGRADED);
  device = applyHealthResult(device, { success: true, responseTimeMs: 35 });
  assert.strictEqual(device.deviceQuality, DEVICE_HEALTH.ONLINE);
});

test('point quality becomes stale after threshold and preserves value semantics', () => {
  const past = new Date(Date.now() - 120000).toISOString();
  const quality = derivePointQuality({
    presentValue: 72.5,
    lastSuccessfulReadAt: past,
    staleAfterMs: 60000,
    failureCount: 0,
  }, 'online');
  assert.strictEqual(quality, POINT_QUALITY.STALE);

  const good = derivePointQuality({
    presentValue: 72.5,
    lastSuccessfulReadAt: new Date().toISOString(),
    staleAfterMs: 60000,
  }, 'online');
  assert.strictEqual(good, POINT_QUALITY.GOOD);

  const offline = derivePointQuality({
    presentValue: 72.5,
    lastSuccessfulReadAt: new Date().toISOString(),
  }, 'offline');
  assert.strictEqual(offline, POINT_QUALITY.OFFLINE);
});

test('data path resolves production vs development', () => {
  const prod = resolveDataDir({ forceProduction: true });
  assert.strictEqual(prod, PRODUCTION_DATA_DIR);
  const dev = resolveDataDir({ nodeEnv: 'development', envDir: '' });
  assert.ok(dev.includes('data'));
  const custom = resolveDataDir({ envDir: 'C:\\tmp\\legion-data' });
  assert.ok(custom.toLowerCase().includes('legion-data'));
});

test('migration copies files and never overwrites without flag', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'legion-migrate-'));
  const source = path.join(tmp, 'src');
  const target = path.join(tmp, 'dst');
  fs.mkdirSync(source);
  fs.writeFileSync(path.join(source, 'managedDevices.json'), '[{"id":1}]');
  fs.writeFileSync(path.join(source, 'settings.json'), '{"bacnet":{}}');

  const first = migrateDataDirectory({ sourceDir: source, targetDir: target, dryRun: false });
  assert.ok(first.copied.length >= 2);
  assert.ok(fs.existsSync(path.join(target, 'managedDevices.json')));

  fs.writeFileSync(path.join(source, 'managedDevices.json'), '[{"id":2}]');
  const second = migrateDataDirectory({ sourceDir: source, targetDir: target, dryRun: false });
  assert.ok(second.skipped.some((s) => s.file === 'managedDevices.json'));
  const retained = JSON.parse(fs.readFileSync(path.join(target, 'managedDevices.json'), 'utf8'));
  assert.strictEqual(retained[0].id, 1);
});

test('fake transport simulates disconnect and recovery modes', async () => {
  const transport = new FakeMstpTransport({
    devices: { 10: { mac: 10, value: 21 } },
  });
  await transport.openPort();
  const ok = await transport.readProperty({ mac: 10 });
  assert.strictEqual(ok.value, 21);
  transport.setMode('timeout');
  await assert.rejects(() => transport.readProperty({ mac: 10, timeoutMs: 20 }));
  transport.setMode('ok');
  transport.setDevice(10, false);
  await assert.rejects(() => transport.readProperty({ mac: 10 }));
});

test('COV capability reports unsupported', () => {
  const cap = getCovCapability();
  assert.strictEqual(cap.supported, false);
});

test('write property foundation is disabled by default', () => {
  assert.strictEqual(WRITE_CAPABILITY.enabled, false);
  const errors = validateWriteRequest({ objectType: 1, objectInstance: 1, propertyIdentifier: 85 });
  assert.ok(errors.includes('value is required'));
});

test('job retention trim keeps active jobs', () => {
  const now = Date.now();
  const jobs = [
    { id: 'a', status: 'queued', source: 'ui', createdAt: new Date(now).toISOString() },
    {
      id: 'old',
      status: 'completed',
      source: 'polling',
      createdAt: new Date(now - 8 * 24 * 60 * 60 * 1000).toISOString(),
      completedAt: new Date(now - 8 * 24 * 60 * 60 * 1000).toISOString(),
    },
  ];
  const trimmed = fieldExecutionEngine.trimJobs(jobs);
  assert.ok(trimmed.some((j) => j.id === 'a'));
  assert.ok(!trimmed.some((j) => j.id === 'old'));
});

test('stale generation helper detects mismatch', () => {
  const current = fieldExecutionEngine.getCurrentRuntimeGeneration();
  assert.strictEqual(
    fieldExecutionEngine.isStaleGeneration({ runtimeGeneration: current + 99 }),
    true,
  );
  assert.strictEqual(
    fieldExecutionEngine.isStaleGeneration({ runtimeGeneration: current }),
    false,
  );
});

test('nextHealthState degraded thresholds', () => {
  const online = nextHealthState(
    { deviceQuality: 'online', consecutiveSuccesses: 0, consecutiveFailures: 0 },
    { success: false },
  );
  assert.strictEqual(online.deviceQuality, 'online');
  const degraded = nextHealthState(
    { deviceQuality: 'online', consecutiveSuccesses: 0, consecutiveFailures: 1 },
    { success: false },
  );
  assert.strictEqual(degraded.deviceQuality, 'degraded');
});

run();
