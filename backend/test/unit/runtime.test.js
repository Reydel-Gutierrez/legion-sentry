const { test, assert, run } = require('../harness');
const mstpBusCoordinator = require('../../src/services/execution/mstpBusCoordinator');
const { deriveRuntimeState, RUNTIME_STATE, buildRuntimeSnapshot } = require('../../src/services/bacnet/mstpRuntimeState');

test('bus acquire/release exclusive owners do not overlap', () => {
  mstpBusCoordinator.releaseBus(mstpBusCoordinator.BUS_OWNER.EXECUTION);
  mstpBusCoordinator.releaseBus(mstpBusCoordinator.BUS_OWNER.POINT_DISCOVERY);
  mstpBusCoordinator.releaseBus(mstpBusCoordinator.BUS_OWNER.DISCOVERY);

  mstpBusCoordinator.acquireBus(mstpBusCoordinator.BUS_OWNER.POINT_DISCOVERY);
  assert.throws(
    () => mstpBusCoordinator.acquireBus(mstpBusCoordinator.BUS_OWNER.EXECUTION),
    (err) => err.code === 'BUS_BUSY',
  );
  mstpBusCoordinator.releaseBus(mstpBusCoordinator.BUS_OWNER.POINT_DISCOVERY);
  mstpBusCoordinator.acquireBus(mstpBusCoordinator.BUS_OWNER.EXECUTION);
  mstpBusCoordinator.releaseBus(mstpBusCoordinator.BUS_OWNER.EXECUTION);
});

test('runtime snapshot reports serial owner', () => {
  const snap = buildRuntimeSnapshot({
    open: true,
    port: '/dev/serial0',
    pointDiscoveryInProgress: true,
  });
  assert.strictEqual(snap.state, RUNTIME_STATE.BUSY);
  assert.strictEqual(snap.serialOwner, 'none');
  const owned = buildRuntimeSnapshot({
    open: true,
    port: '/dev/serial0',
    serialOwner: 'bacnet-mstp',
  });
  assert.strictEqual(owned.serialOwner, 'bacnet-mstp');
  assert.strictEqual(snap.activeOperation, 'point_discovery');
});

test('faulted when closed with lastError', () => {
  assert.strictEqual(
    deriveRuntimeState({ open: false, lastError: 'boom' }),
    RUNTIME_STATE.FAULTED,
  );
});

run();
