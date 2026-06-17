/** Canonical device lifecycle states for Legion Sentry DEV-1 */
const DEVICE_STATES = {
  NOT_CONFIGURED: 'not_configured',
  READY: 'ready',
  RUNNING: 'running',
  FAULT: 'fault',
  DISABLED: 'disabled',
};

/** Online/offline health for discovered BACnet devices */
const DEVICE_HEALTH = {
  ONLINE: 'online',
  OFFLINE: 'offline',
};

const ALL_DEVICE_STATES = Object.values(DEVICE_STATES);

function isValidDeviceState(state) {
  return ALL_DEVICE_STATES.includes(state);
}

module.exports = {
  DEVICE_STATES,
  DEVICE_HEALTH,
  ALL_DEVICE_STATES,
  isValidDeviceState,
};
