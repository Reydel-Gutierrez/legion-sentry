# Hardware Acceptance — Phase 2

Validate on a Raspberry Pi with real MS/TP controllers. Do **not** treat simulated endurance as a substitute for Tests A–H.

## Preconditions

- Phase 1 discovery and managed point discovery already verified
- `legion-sentry` systemd unit installed from `deploy/legion-sentry.service`
- Data migrated to `/var/lib/legion-sentry`
- Only one process owns `/dev/serial0` for BACnet

## Test A — Persistent runtime

1. `sudo systemctl start legion-sentry`
2. Confirm MS/TP runtime starts once (`GET /api/bacnet/mstp/runtime` → `active`)
3. Confirm a single BACnet serial owner
4. Leave active 30 minutes
5. Confirm no duplicate listeners / runtimes

## Test B — Managed polling

1. Add a small set of managed points
2. Enable polling (non-manual groups)
3. Confirm values update at configured intervals
4. Confirm unmanaged discovered points are **not** continuously polled
5. Confirm quality + timestamps update

## Test C — Discovery coordination

1. Allow polling to run
2. Start point discovery
3. Confirm polling yields
4. Confirm discovery completes
5. Confirm polling resumes without a queue storm

## Test D — Device failure

1. Disconnect one controller
2. Confirm online → degraded → offline (not offline after one miss)
3. Confirm other devices continue
4. Reconnect
5. Confirm automatic return to online

## Test E — Serial failure

1. Disconnect / disable RS-485
2. Confirm recovering + backoff
3. Restore RS-485
4. Confirm automatic recovery without reboot or deleting JSON

## Test F — Service restart

1. Run polling
2. `sudo systemctl restart legion-sentry`
3. Confirm clean stop (no stuck `deactivating`)
4. Confirm runtime starts once
5. Confirm managed devices/points preserved
6. Confirm polling resumes once

## Test G — Repeated restart

1. Restart five times
2. Confirm no “port already open”
3. Confirm no duplicate listeners or poll jobs

## Test H — 24-hour stability

1. ≥2 real MS/TP devices
2. Poll a representative point set
3. Record memory, CPU, queue depth, errors, recoveries
4. Confirm no manual cleanup required

## Pass criteria

Phase 2 hardware acceptance passes when A–G succeed and H completes without manual restart or cleanup.
