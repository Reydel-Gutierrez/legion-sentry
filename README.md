# Legion Sentry G1

**Product:** Legion Sentry G1  
**Product Code:** LCG1DEV10026  
**Type:** BAS Router / BACnet Gateway / Field Diagnostics Appliance

Legion Sentry is a dedicated router/gateway appliance UI for the Legion Sentry DEV-1 (Raspberry Pi 4) development hardware. This is not the main Legion operator platform — it is a focused field technician admin interface.

## Stack

- **Frontend:** React, React Router, React Bootstrap, SCSS (Vite)
- **Backend:** Node.js, Express
- **Data:** JSON config files (Prisma/PostgreSQL deferred until needed)

## Quick Start

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

## Pages

| Route | Description |
|-------|-------------|
| `/` | Dashboard — device identity, system metrics, interfaces, services |
| `/network` | Ethernet, WiFi, hostname configuration |
| `/bacnet` | BACnet/IP and MS/TP settings, device discovery |
| `/modbus` | Modbus TCP and RTU settings |
| `/mqtt` | MQTT broker and topic configuration |
| `/diagnostics` | Network, protocol, and GPIO diagnostics |
| `/logs` | Filterable service log viewer |
| `/system` | System info and maintenance placeholders |

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/system/status` | Dashboard data |
| GET | `/api/system/health` | Health check |
| GET | `/api/system/info` | System information |
| GET | `/api/network/status` | Network status |
| POST | `/api/network/settings` | Save network settings |
| POST | `/api/network/restart` | Restart network (simulated) |
| POST | `/api/network/test` | Test connectivity |
| GET | `/api/bacnet/status` | BACnet status |
| POST | `/api/bacnet/settings` | Save BACnet settings |
| POST | `/api/bacnet/discover` | Discover BACnet devices |
| GET | `/api/modbus/status` | Modbus status |
| POST | `/api/modbus/settings` | Save Modbus settings |
| POST | `/api/modbus/test-read` | Test register read |
| GET | `/api/mqtt/status` | MQTT status |
| POST | `/api/mqtt/settings` | Save MQTT settings |
| POST | `/api/mqtt/test` | Test MQTT connection |
| POST | `/api/mqtt/publish-test` | Publish test message |
| GET | `/api/diagnostics/summary` | Diagnostics summary |
| POST | `/api/diagnostics/ping` | Run ping test |
| GET | `/api/logs` | Get logs (`?filter=bacnet`) |
| POST | `/api/logs/clear` | Clear logs |

## Backend Service Structure

```
backend/src/services/
  system/     # CPU, memory, uptime (mock → Pi integration)
  network/    # eth0, WiFi, hostname
  bacnet/     # BACnet/IP + MS/TP
  modbus/     # Modbus TCP + RTU
  mqtt/       # MQTT client
  gpio/       # LED/button diagnostics
  logs/       # In-memory log buffer
```

Settings persist to `backend/src/data/settings.json`. Replace mock services with real Raspberry Pi integrations as hardware services are developed.

## Hardware Target (DEV-1)

- Raspberry Pi 4
- Ethernet ETH0
- RS485 HAT
- GPIO LEDs/buttons
- Linux

## Development Mode

All runtime data is **simulated**. The top bar shows `DEV-1 / Simulated`. BACnet discovery returns mock devices. Destructive maintenance actions are disabled.
