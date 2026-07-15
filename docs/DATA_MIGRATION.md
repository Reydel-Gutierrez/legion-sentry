# Data Migration — Outside the Git Working Tree

Mutable appliance data must not live inside a `git pull` conflict path on the Raspberry Pi.

## Paths

| Environment | Directory |
|-------------|-----------|
| Override | `$LEGION_SENTRY_DATA_DIR` |
| Production default | `/var/lib/legion-sentry` |
| Development default | `backend/src/data` |

Files:

- `auth.json`, `bacnet.json`, `devices.json`, `managedDevices.json`, `managedPoints.json`
- `discoveredPoints.json`, `executionJobs.json`, `settings.json`, `network.json`
- `logs.jsonl`, `backups/`, `runtime.json`

## Raspberry Pi migration

Discover the service user from the unit file (template uses `legion`):

```bash
# Prepare production data directory
sudo mkdir -p /var/lib/legion-sentry
sudo chown -R legion:legion /var/lib/legion-sentry

# From the repo checkout
cd /opt/legion-sentry   # or your clone path
export LEGION_SENTRY_DATA_DIR=/var/lib/legion-sentry

# Dry-run first
npm run migrate:data -- --dry-run

# Copy without overwriting existing production files
npm run migrate:data
```

The migrator:

- Creates a timestamped backup under `backups/pre-migration-*`
- Never silently overwrites existing target files (use `--overwrite` only when intentional)
- Is idempotent for already-migrated files (they are skipped)

## systemd environment

`deploy/legion-sentry.service` sets:

```
Environment=LEGION_SENTRY_DATA_DIR=/var/lib/legion-sentry
```

After changing the environment:

```bash
sudo systemctl daemon-reload
sudo systemctl restart legion-sentry
```

## Development

Unset `LEGION_SENTRY_DATA_DIR` and run with `NODE_ENV` not equal to `production`. Data resolves to `backend/src/data`. Mutable `*.json` / `*.jsonl` under that folder are gitignored.
