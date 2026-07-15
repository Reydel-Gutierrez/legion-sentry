/**
 * Fake BACnet MS/TP transport for unit/endurance tests.
 * Simulates bus behavior without opening a real SerialPort.
 */
class FakeMstpTransport {
  constructor(options = {}) {
    this.portPath = options.portPath || '/dev/fake-mstp';
    this.open = false;
    this.listenerCount = 0;
    this.operationsCompleted = 0;
    this.operationsFailed = 0;
    this.recoveries = 0;
    this.mode = options.mode || 'ok'; // ok | timeout | delay | disconnect | silence | corrupt | slow
    this.delayMs = options.delayMs || 0;
    this.devices = new Map(Object.entries(options.devices || {}));
    this._closedOnce = false;
    this._onClose = null;
  }

  setMode(mode, opts = {}) {
    this.mode = mode;
    if (opts.delayMs != null) this.delayMs = opts.delayMs;
  }

  setDevice(mac, present = true) {
    if (!present) this.devices.delete(String(mac));
    else this.devices.set(String(mac), { mac, online: true, ...(typeof present === 'object' ? present : {}) });
  }

  async openPort() {
    if (this.mode === 'disconnect' && !this.open) {
      const err = new Error('Serial port unavailable');
      err.code = 'SERIAL_UNAVAILABLE';
      throw err;
    }
    this.open = true;
    this.listenerCount += 1;
    return { path: this.portPath, isOpen: true };
  }

  async closePort() {
    if (!this.open) return { closed: false };
    if (this._closedOnce) {
      const err = new Error('Serial already closed');
      err.code = 'SERIAL_ALREADY_CLOSED';
      throw err;
    }
    this.open = false;
    this._closedOnce = true;
    this.listenerCount = Math.max(0, this.listenerCount - 1);
    if (typeof this._onClose === 'function') this._onClose();
    return { closed: true };
  }

  resetCloseGuard() {
    this._closedOnce = false;
  }

  async readProperty({ mac, timeoutMs = 1000 }) {
    if (!this.open) {
      const err = new Error('Port closed');
      err.code = 'PORT_CLOSED';
      this.operationsFailed += 1;
      throw err;
    }

    if (this.mode === 'disconnect') {
      this.open = false;
      const err = new Error('Serial disconnected');
      err.code = 'SERIAL_DISCONNECT';
      this.operationsFailed += 1;
      throw err;
    }

    if (this.mode === 'silence' || this.mode === 'timeout') {
      await delay(Math.min(timeoutMs, 50));
      const err = new Error('BACnet timeout');
      err.code = 'BACNET_TIMEOUT';
      this.operationsFailed += 1;
      throw err;
    }

    if (this.mode === 'corrupt') {
      this.operationsFailed += 1;
      const err = new Error('Corrupt frame');
      err.code = 'CORRUPT_FRAME';
      throw err;
    }

    const wait = this.mode === 'slow' || this.mode === 'delay' ? (this.delayMs || 100) : 0;
    if (wait) await delay(wait);

    const device = this.devices.get(String(mac));
    if (!device || device.online === false) {
      const err = new Error('Device not responding');
      err.code = 'DEVICE_OFFLINE';
      this.operationsFailed += 1;
      throw err;
    }

    this.operationsCompleted += 1;
    return {
      value: device.value ?? 72.5,
      lastReadAt: new Date().toISOString(),
    };
  }

  getMetrics() {
    return {
      open: this.open,
      listenerCount: this.listenerCount,
      operationsCompleted: this.operationsCompleted,
      operationsFailed: this.operationsFailed,
      recoveries: this.recoveries,
      mode: this.mode,
    };
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = {
  FakeMstpTransport,
};
