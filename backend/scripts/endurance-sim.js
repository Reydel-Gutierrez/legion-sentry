#!/usr/bin/env node
/**
 * Simulated endurance harness for Phase 2 supervisory runtime.
 * Does not touch real hardware. Invoke via: npm run test:endurance:sim
 */
const { FakeMstpTransport } = require('../src/services/bacnet/fakeMstpTransport');
const { createRuntimeMachine, RUNTIME_STATE } = require('../src/services/bacnet/mstpRuntimeState');
const { applyHealthResult } = require('../src/services/execution/deviceHealth');
const { derivePointQuality } = require('../src/services/execution/pointQuality');

const DURATION_MS = Number(process.env.ENDURANCE_MS) || 5000;
const POLL_EVERY_MS = 50;

async function main() {
  const transport = new FakeMstpTransport({
    devices: {
      8: { mac: 8, value: 70 },
      12: { mac: 12, value: 55 },
    },
  });
  const machine = createRuntimeMachine();
  const metrics = {
    polls: 0,
    failures: 0,
    recoveries: 0,
    duplicateTimerDetections: 0,
    maxQueueDepth: 0,
    queueDepth: 0,
  };

  let device = { deviceQuality: 'unknown', consecutiveSuccesses: 0, consecutiveFailures: 0 };
  let point = {
    presentValue: null,
    lastSuccessfulReadAt: null,
    staleAfterMs: 2000,
    failureCount: 0,
  };

  machine.transitionTo(RUNTIME_STATE.STARTING, 'endurance');
  machine.bumpGeneration('endurance');
  await transport.openPort();
  machine.transitionTo(RUNTIME_STATE.ACTIVE, 'endurance');

  const started = Date.now();
  let tickActive = false;

  const timer = setInterval(async () => {
    if (tickActive) {
      metrics.duplicateTimerDetections += 1;
      return;
    }
    tickActive = true;
    metrics.queueDepth += 1;
    metrics.maxQueueDepth = Math.max(metrics.maxQueueDepth, metrics.queueDepth);
    try {
      // Inject occasional serial failure
      if (metrics.polls > 0 && metrics.polls % 40 === 0) {
        transport.setMode('disconnect');
        machine.transitionTo(RUNTIME_STATE.DEGRADED, 'sim_disconnect');
        machine.transitionTo(RUNTIME_STATE.RECOVERING, 'sim_recover');
        transport.resetCloseGuard();
        await transport.closePort().catch(() => {});
        transport.setMode('ok');
        await transport.openPort();
        machine.transitionTo(RUNTIME_STATE.ACTIVE, 'sim_recovered');
        machine.bumpGeneration('sim_recovered');
        metrics.recoveries += 1;
      } else if (metrics.polls % 25 === 0) {
        transport.setDevice(12, false);
      } else if (metrics.polls % 30 === 0) {
        transport.setDevice(12, true);
      }

      try {
        const read = await transport.readProperty({ mac: 8 });
        point.presentValue = read.value;
        point.lastSuccessfulReadAt = read.lastReadAt;
        point.failureCount = 0;
        device = applyHealthResult(device, { success: true, responseTimeMs: 12 });
        metrics.polls += 1;
      } catch {
        point.failureCount += 1;
        device = applyHealthResult(device, { success: false, error: 'sim fail' });
        metrics.failures += 1;
      }

      derivePointQuality(point, device.deviceQuality);
    } finally {
      metrics.queueDepth = Math.max(0, metrics.queueDepth - 1);
      tickActive = false;
    }

    if (Date.now() - started >= DURATION_MS) {
      clearInterval(timer);
      const mem = process.memoryUsage();
      console.log(JSON.stringify({
        ok: true,
        durationMs: Date.now() - started,
        metrics: {
          ...metrics,
          ...transport.getMetrics(),
          deviceQuality: device.deviceQuality,
          memoryRss: mem.rss,
          runtimeGeneration: machine.getRuntimeGeneration(),
        },
      }, null, 2));
      process.exit(metrics.duplicateTimerDetections > 0 ? 1 : 0);
    }
  }, POLL_EVERY_MS);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
