const bacnet = require('node-bacnet');
const { loadSettings } = require('../../lib/settingsStore');

const DEVICE_OBJECT_TYPE = 8;
const BACNET_PROPERTIES = {
  objectName: 77,
  description: 28,
  vendorName: 121,
  modelName: 70,
  firmwareRevision: 44,
  applicationSoftwareVersion: 12,
  protocolVersion: 98,
  protocolRevision: 99,
  objectList: 76,
};

function createClient() {
  const settings = loadSettings().bacnet?.ip || {};
  return new bacnet({
    port: settings.udpPort || 47808,
    apduTimeout: 6000,
  });
}

function parseIAmMessage(msg) {
  if (msg?.header && msg?.payload) {
    return {
      address: msg.header.address || msg.header.sender?.address,
      deviceInstance: msg.payload.deviceId,
      vendorId: msg.payload.vendorId,
      maxApdu: msg.payload.maxApdu,
      segmentation: msg.payload.segmentation,
    };
  }

  return {
    address: msg.address,
    deviceInstance: msg.deviceId,
    vendorId: msg.vendorId,
    maxApdu: msg.maxApdu,
    segmentation: msg.segmentation,
  };
}

function discoverDevices(timeoutMs = 5000) {
  const startedAt = Date.now();
  const client = createClient();
  const seen = new Map();

  return new Promise((resolve, reject) => {
    const finish = () => {
      try { client.close(); } catch { /* ignore */ }
      const devices = Array.from(seen.values());
      resolve({
        discoveredAt: new Date().toISOString(),
        durationMs: Date.now() - startedAt,
        devices,
      });
    };

    const timer = setTimeout(finish, timeoutMs);

    client.on('iAm', (msg) => {
      const parsed = parseIAmMessage(msg);
      if (!parsed.deviceInstance || !parsed.address) return;
      const key = `${parsed.address}:${parsed.deviceInstance}`;
      if (seen.has(key)) return;
      seen.set(key, {
        deviceInstance: parsed.deviceInstance,
        address: parsed.address,
        vendorId: parsed.vendorId ?? null,
        maxApdu: parsed.maxApdu ?? null,
        segmentation: parsed.segmentation ?? null,
        protocol: 'BACnet/IP',
        status: 'online',
      });
    });

    client.on('error', (err) => {
      clearTimeout(timer);
      try { client.close(); } catch { /* ignore */ }
      reject(err);
    });

    try {
      client.whoIs();
    } catch (err) {
      clearTimeout(timer);
      try { client.close(); } catch { /* ignore */ }
      reject(err);
    }
  });
}

function readPropertyPromise(client, address, objectId, propertyId) {
  return new Promise((resolve) => {
    client.readProperty(address, objectId, propertyId, (err, value) => {
      if (err) {
        resolve(null);
        return;
      }
      resolve(extractPropertyValue(value));
    });
  });
}

function extractPropertyValue(value) {
  if (value == null) return null;
  if (typeof value === 'string' || typeof value === 'number') return value;
  if (value.values && Array.isArray(value.values)) {
    return value.values.map((v) => v.value ?? v).join(', ');
  }
  if (value.value != null) return value.value;
  if (Array.isArray(value)) return value.length;
  return String(value);
}

async function readDeviceDetails({ address, deviceInstance }) {
  const client = createClient();
  const objectId = { type: DEVICE_OBJECT_TYPE, instance: Number(deviceInstance) };
  const startedAt = Date.now();

  try {
    const [
      objectName,
      description,
      vendorName,
      modelName,
      firmwareRevision,
      applicationSoftwareVersion,
      protocolVersion,
      protocolRevision,
      objectList,
    ] = await Promise.all([
      readPropertyPromise(client, address, objectId, BACNET_PROPERTIES.objectName),
      readPropertyPromise(client, address, objectId, BACNET_PROPERTIES.description),
      readPropertyPromise(client, address, objectId, BACNET_PROPERTIES.vendorName),
      readPropertyPromise(client, address, objectId, BACNET_PROPERTIES.modelName),
      readPropertyPromise(client, address, objectId, BACNET_PROPERTIES.firmwareRevision),
      readPropertyPromise(client, address, objectId, BACNET_PROPERTIES.applicationSoftwareVersion),
      readPropertyPromise(client, address, objectId, BACNET_PROPERTIES.protocolVersion),
      readPropertyPromise(client, address, objectId, BACNET_PROPERTIES.protocolRevision),
      readPropertyPromise(client, address, objectId, BACNET_PROPERTIES.objectList),
    ]);

    const objectListCount = Array.isArray(objectList) ? objectList.length : (typeof objectList === 'number' ? objectList : null);

    return {
      address,
      deviceInstance: Number(deviceInstance),
      readAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
      objectName: objectName || null,
      description: description || null,
      vendorName: vendorName || null,
      modelName: modelName || null,
      firmwareRevision: firmwareRevision || null,
      applicationSoftwareVersion: applicationSoftwareVersion || null,
      protocolVersion: protocolVersion != null ? String(protocolVersion) : null,
      protocolRevision: protocolRevision != null ? String(protocolRevision) : null,
      objectListCount,
    };
  } finally {
    try { client.close(); } catch { /* ignore */ }
  }
}

async function readObjectName({ address, deviceInstance }) {
  const client = createClient();
  const objectId = { type: DEVICE_OBJECT_TYPE, instance: Number(deviceInstance) };
  const startedAt = Date.now();

  try {
    const objectName = await readPropertyPromise(client, address, objectId, BACNET_PROPERTIES.objectName);
    return {
      objectName: objectName || null,
      responseTimeMs: Date.now() - startedAt,
      online: objectName != null,
    };
  } catch {
    return {
      objectName: null,
      responseTimeMs: Date.now() - startedAt,
      online: false,
    };
  } finally {
    try { client.close(); } catch { /* ignore */ }
  }
}

module.exports = {
  discoverDevices,
  readDeviceDetails,
  readObjectName,
};
