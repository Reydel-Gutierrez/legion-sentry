# Legion Sentry G1

**Product:** Legion Sentry G1  
**Product Code:** LCG1DEV10026  
**Type:** BAS Router / BACnet Gateway / Field Diagnostics Appliance

Legion Sentry is a dedicated router/gateway appliance UI for the Legion Sentry DEV-1 (Raspberry Pi 4) development hardware. This is not the main Legion operator platform — it is a focused field technician admin interface.

## Data

- **Development:** JSON config under `backend/src/data/` (gitignored mutable files)
- **Production:** `/var/lib/legion-sentry` via `LEGION_SENTRY_DATA_DIR` — see [docs/DATA_MIGRATION.md](docs/DATA_MIGRATION.md)

## Quick Start (Development)

```bash
# Install all dependencies
npm install
npm install --prefix backend
npm install --prefix frontend

# Run backend + frontend together
npm run dev
```

- **UI:** http://localhost:5173
- **API:** http://localhost:3001/api

## Tests and lint

```bash
npm test              # backend + frontend
npm run test:backend
npm run test:frontend
npm run lint
```

Tests mock BACnet/serial hardware and run on a development PC (Node ≥ 16).

## Runtime architecture

See **[docs/RUNTIME_ARCHITECTURE.md](docs/RUNTIME_ARCHITECTURE.md)** and **[docs/PHASE_2_RUNTIME.md](docs/PHASE_2_RUNTIME.md)** for:

- Service ownership and BACnet/IP vs MS/TP boundaries
- Persistent MS/TP runtime state machine and generation
- Single MS/TP serial ownership (`bacnetMstp.service`)
- Operation queue priorities (discovery / point discovery / heartbeat / polling)
- Point quality, device health, recovery, and graceful shutdown

### Phase 2 limitations

- Not a BACnet/IP ↔ MS/TP router (Phase 3)
- Writes (`write_property`) disabled by default (`WRITE_NOT_IMPLEMENTED`)
- SubscribeCOV not safely supported on the current MS/TP path
- Directed MS/TP Who-Is (unicast) is not fully supported without full token participation modes
- Diagnostics serial monitor and BACnet MS/TP remain mutually exclusive on the same port
- Hardware acceptance tests A–H must be run on Raspberry Pi + RS-485 (see `docs/HARDWARE_ACCEPTANCE_PHASE_2.md`)

### MS/TP serial ownership

Only `backend/src/services/bacnet/bacnetMstp.service.js` opens the BACnet RS-485 `SerialPort`. Express routes submit work through that runtime (or the diagnostics `serial.service` monitor, which must not run at the same time).

### Reproducing point discovery

1. Open **Managed Devices**
2. Select an enabled MS/TP managed device → points modal
3. Click **Discover** / **Scan Again**
4. Confirm points appear or a structured BACnet/serial error is shown (never `managedPoints.runPointDiscovery is not a function`)

## Deployment to Raspberry Pi

Preferred production mechanism is **systemd**, not `npm run dev`.

1. Install / update the unit from the repository template:

```bash
sudo cp deploy/legion-sentry.service /etc/systemd/system/legion-sentry.service
# Edit WorkingDirectory / User to match the Pi install
sudo mkdir -p /var/lib/legion-sentry
sudo chown -R legion:legion /var/lib/legion-sentry
sudo systemctl daemon-reload
sudo systemctl enable --now legion-sentry
```

2. Migrate existing JSON data out of the Git tree (first time only):

```bash
export LEGION_SENTRY_DATA_DIR=/var/lib/legion-sentry
npm run migrate:data -- --dry-run
npm run migrate:data
sudo systemctl restart legion-sentry
```

3. After code updates:

```bash
cd /opt/legion-sentry   # your clone path
git pull
npm install
npm install --prefix backend
npm install --prefix frontend
npm run build --prefix frontend   # if serving a built UI separately
sudo systemctl restart legion-sentry
```

Service status:

```bash
sudo systemctl status legion-sentry
journalctl -u legion-sentry -f
```

### Development on the Pi (optional)

```bash
npm run dev
```

Frontend: `http://<pi-ip>:5173` · API: `http://<pi-ip>:3001`

| Service | Default port | URL |
|---------|--------------|-----|
| Frontend (Vite, dev) | 5173 | `http://<pi-ip>:5173` |
| Backend API | 3001 | `http://<pi-ip>:3001` |

**Notes:**
- Default RS485 port on Pi: `/dev/serial0`
- Serial console must be disabled for RS485 HAT use
- Production data: `/var/lib/legion-sentry` (see [docs/DATA_MIGRATION.md](docs/DATA_MIGRATION.md))
- Runtime docs: [docs/PHASE_2_RUNTIME.md](docs/PHASE_2_RUNTIME.md)
- On first boot, default login is created automatically (see Authentication)

## Authentication

Local appliance login only — not cloud user management.

| Field | Default (first boot) |
|-------|----------------------|
| Username | `Legion` |
| Password | `Welcome21Legion!` |

Credentials are stored hashed under the data directory (`auth.json`). Change the default password under **System → Change Password** before field deployment.

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/auth/login` | Sign in (sets session cookie) |
| POST | `/api/auth/logout` | Sign out |
| GET | `/api/auth/session` | Check current session |
| POST | `/api/auth/change-password` | Change password (authenticated) |

All other API routes require authentication except `/api/health` and `/api/system/health`.

## Pages

| Route | Description |
|-------|-------------|
| `/login` | Appliance login |
| `/` | Dashboard — real Pi metrics, services, serial summary |
| `/devices` | BACnet device inventory (empty until discovery) |
| `/network` | Live interfaces, NetworkManager configuration, hostname, tools |
| `/bacnet` | BACnet/IP discovery, MS/TP serial settings |
| `/modbus` | Modbus TCP and RTU settings |
| `/mqtt` | MQTT broker configuration |
| `/diagnostics` | Hardware, network, RS485 serial diagnostics |
| `/logs` | Persistent local event logs |
| `/system` | System info, change password, maintenance |

## API Endpoints (selected)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/system/status` | Dashboard data |
| GET | `/api/system/health` | Health check (public) |
| GET | `/api/network/status` | Live network status (interfaces, manager, hostname) |
| GET | `/api/network/manager` | Detected network manager and active connections |
| POST | `/api/network/apply` | Apply DHCP or static IP via NetworkManager (`nmcli`); local-only static supported |
| POST | `/api/network/restore-dhcp` | Restore DHCP on `eth0` or `wlan0` |
| POST | `/api/network/hostname` | Set system hostname (`hostnamectl`) |
| POST | `/api/network/reboot` | Reboot the appliance |
| POST | `/api/network/test-gateway` | Ping default gateway |
| POST | `/api/network/test-dns` | DNS resolution test |
| GET | `/api/interfaces/serial/detail` | RS485 port details |
| POST | `/api/interfaces/serial/open-check` | Test serial port open |
| POST | `/api/interfaces/serial/monitor/start` | Start RX byte monitor |
| POST | `/api/bacnet/ip/discover` | BACnet/IP Who-Is discovery |
| GET | `/api/devices` | Device inventory |
| POST | `/api/devices/refresh` | Refresh device online status |
| POST | `/api/devices/clear` | Clear inventory |
| GET | `/api/logs` | Persistent logs (`?filter=bacnet`) |

## Data Files

| File | Purpose |
|------|---------|
| `backend/src/data/auth.json` | Hashed credentials (created on first boot) |
| `backend/src/data/bacnet.json` | BACnet MS/TP settings |
| `backend/src/data/devices.json` | Discovered device inventory |
| `backend/src/data/logs.jsonl` | Persistent event logs |
| `backend/src/data/settings.json` | Protocol settings (BACnet IP, Modbus, MQTT) |

## Network Configuration (Raspberry Pi)

On the Pi, Sentry applies network settings through **NetworkManager** (`nmcli`). The backend runs as user `legion` and requires passwordless `sudo` for network commands.

### Static IP (local-only friendly)

The Network page supports configuring Sentry as a **local-only appliance** on a LAN or
direct connection — no internet-style settings are required. For static mode:

- **IP Address** — required
- **Subnet Mask** — required (e.g. `255.255.255.0`; converted to CIDR automatically)
- **Gateway** — optional (leave blank for local-only / no upstream router)
- **DNS 1 / DNS 2** — optional

A valid local-only static configuration is, for example:

```
IP Address:   192.168.1.197
Subnet Mask:  255.255.255.0
Gateway:      (blank)
DNS 1:        (blank)
DNS 2:        (blank)
```

The apply endpoint accepts either payload shape for compatibility:

```jsonc
{ "interface": "eth0", "mode": "static", "ipAddress": "192.168.1.197", "subnetMask": "255.255.255.0" }
{ "interface": "eth0", "mode": "static", "ipAddress": "192.168.1.197", "cidr": 24 }
```

Static settings are applied atomically (address + `ipv4.method manual` + gateway + DNS in a
single `nmcli con mod`) so NetworkManager never sees `manual` without an address. Blank
gateway/DNS are explicitly cleared. If `wlan0` is not present, the WiFi controls are hidden
with **"No wireless interface detected."**

### Sudoers setup

```bash
sudo visudo -f /etc/sudoers.d/legion-sentry
```

Add (verify paths with `which nmcli`, `which hostnamectl`, `which reboot`):

```
legion ALL=(root) NOPASSWD: /usr/bin/nmcli, /usr/bin/hostnamectl, /usr/sbin/reboot
```

If command paths differ on your image, adjust accordingly. Without this, apply/hostname/reboot return:

> Sentry does not have permission to apply network settings. Configure sudoers.

On Windows or other dev hosts, network apply endpoints return **501 Unsupported** — the UI remains view-only for live status.

## Hardware Target (DEV-1)

- Raspberry Pi 4 Model B
- Raspberry Pi OS Lite 64-bit
- Ethernet ETH0, WiFi wlan0
- RS485 HAT on `/dev/serial0`
- GPIO LEDs/buttons (not configured in DEV-1)

## Development Mode

On Windows or without Pi hardware, runtime reports **DEVELOPMENT**. Serial monitor and some network operations return unsupported safely. BACnet MS/TP operations require a live RS485 bus and connected controllers.
