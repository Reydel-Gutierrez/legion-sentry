# Legion Sentry G1

**Product:** Legion Sentry G1  
**Product Code:** LCG1DEV10026  
**Type:** BAS Router / BACnet Gateway / Field Diagnostics Appliance

Legion Sentry is a dedicated router/gateway appliance UI for the Legion Sentry DEV-1 (Raspberry Pi 4) development hardware. This is not the main Legion operator platform — it is a focused field technician admin interface.

## Stack

- **Frontend:** React, React Router, React Bootstrap, SCSS (Vite)
- **Backend:** Node.js, Express
- **Data:** JSON config files on the appliance (`backend/src/data/`)

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

## Deployment to Raspberry Pi

After pulling updates on the Pi:

```bash
git pull
npm install
npm install --prefix backend
npm install --prefix frontend
npm run dev
```

| Service | Default port | URL |
|---------|--------------|-----|
| Frontend (Vite) | 5173 | `http://<pi-ip>:5173` |
| Backend API | 3001 | `http://<pi-ip>:3001` |

**Notes:**
- Default RS485 port on Pi: `/dev/serial0`
- Serial console must be disabled for RS485 HAT use
- Set `MOCK_DATA=true` only for simulated development on non-Pi hosts
- On first boot, default login is created automatically (see Authentication)

## Authentication

Local appliance login only — not cloud user management.

| Field | Default (first boot) |
|-------|----------------------|
| Username | `Legion` |
| Password | `Welcome21Legion!` |

Credentials are stored hashed in `backend/src/data/auth.json`. Change the default password under **System → Change Password** before field deployment.

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
| `/network` | Live interfaces + staged network configuration |
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
| GET | `/api/network/status` | Live + saved network config |
| POST | `/api/network/settings` | Save desired network config |
| POST | `/api/network/apply` | Stage apply (OS apply not automated) |
| POST | `/api/network/test-gateway` | Ping saved gateway |
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
| `backend/src/data/network.json` | Staged network configuration |
| `backend/src/data/bacnet.json` | BACnet MS/TP settings |
| `backend/src/data/devices.json` | Discovered device inventory |
| `backend/src/data/logs.jsonl` | Persistent event logs |
| `backend/src/data/settings.json` | Protocol settings (BACnet IP, Modbus, MQTT) |

## Hardware Target (DEV-1)

- Raspberry Pi 4 Model B
- Raspberry Pi OS Lite 64-bit
- Ethernet ETH0, WiFi wlan0
- RS485 HAT on `/dev/serial0`
- GPIO LEDs/buttons (not configured in DEV-1)

## Development Mode

On Windows or without Pi hardware, runtime reports **DEVELOPMENT**. Serial monitor and some network operations return unsupported safely. Set `MOCK_DATA=true` to enable mock device data for UI testing only.
