# Phase 2 — Persistent BACnet MS/TP Supervisory Runtime

Phase 2 turns Legion Sentry into a long-running MS/TP supervisor. Phase 1 ownership rules are preserved: `bacnetMstp.service` owns the serial port and token engine; `fieldExecutionEngine` owns the operation queue; pollers never open serial ports.

## Runtime state machine

Authoritative states (`mstpRuntimeState.js`):

`stopped → starting → listening → joining → active ⇄ busy → degraded → recovering → faulted → stopping → stopped`

Every transition is logged with reason, previous state, next state, and timestamp. Invalid transitions are rejected.

Snapshot fields: `state`, `stateSince`, `runtimeGeneration`, `serialPort`, `baudRate`, `localMac`, `networkNumber`, `tokenStatus`, `activeOperation`, `queueDepth`, `lastSuccessfulFrameAt`, `lastError`, `recovery`.

## Runtime generation

`runtimeGeneration` increments on start-from-stopped, restart, and reconstruct-after-failure. Every execution job captures the generation at queue time. Completions from older generations are discarded so stale async work cannot mutate the new runtime, persist point values, or mark devices online.

## Persistent bus lifecycle

1. Load validated MS/TP config
2. Open serial once (`startRuntime` / `openInterface`)
3. Transition listening → joining → active
4. Remain open while discovering / reading / polling
5. Recover on serial faults with bounded backoff
6. Stop only on explicit stop, config takeover, diagnostics conflict, shutdown, or unrecoverable fault

Normal heartbeats, point polls, point discovery, and managed reads **do not** re-close `/dev/serial0`.

## Poll scheduler

`pointPollingEngine` uses one 1s tick scheduler (not per-point timers). Only managed, polling-enabled points are due. Jitter and queue backpressure prevent storms after discovery pauses.

Defaults: fast 5s, normal 15s, slow 60s, manual disabled.

## Point quality

`good | stale | uncertain | offline | fault | disabled | unknown`

Failed reads retain last-known values. Stale retained values must not be presented as fresh healthy data.

## Device health

`online | degraded | offline | unknown | disabled`

One failure never marks offline. Typical path: online → degraded (2 failures) → offline (4 failures). Recovery: offline → degraded → online after consecutive successes.

## Recovery

Serial faults enter `recovering` with backoff `1s, 2s, 5s, 10s, 30s, 60s` (+ jitter). Parallel recovery loops are prevented. API: start / stop / restart / retry.

## COV and writes

- SubscribeCOV: **not supported** yet (`covSubscriptions.js` capability flag).
- WriteProperty: foundation only; returns `WRITE_NOT_IMPLEMENTED` / disabled by default.

## Startup / shutdown

`server.js` starts HTTP → (optional auto) MS/TP runtime → pollers. On SIGTERM/SIGINT: stop pollers, cancel background jobs, bounded wait, close serial, close HTTP. Compatible with `systemctl restart legion-sentry` (`TimeoutStopSec=25`).

## Data directory

See [DATA_MIGRATION.md](./DATA_MIGRATION.md). Production uses `/var/lib/legion-sentry`.

## API

- `GET /api/bacnet/mstp/runtime`
- `POST /api/bacnet/mstp/runtime/start|stop|restart|retry`
- `GET /api/devices/managed/:id/health`
- `POST /api/devices/managed/:id/read-all-managed`

## Phase 2 limitations

- Not a BACnet/IP ↔ MS/TP router (Phase 3)
- No BBMD / Foreign Device / router advertisements
- COV unsupported on current MS/TP path
- Physical WriteProperty blocked by default
- Token engine is still operation-scoped (port stays open)

## Hardware acceptance

See [HARDWARE_ACCEPTANCE_PHASE_2.md](./HARDWARE_ACCEPTANCE_PHASE_2.md).
