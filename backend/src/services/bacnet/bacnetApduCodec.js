const DEVICE_OBJECT_TYPE = 8;

const BACNET_PROPERTIES = {
  objectList: 76,
  objectName: 77,
  description: 28,
  presentValue: 85,
  units: 117,
  statusFlags: 111,
  reliability: 103,
  outOfService: 81,
};

const POINT_DISCOVERY_PROPERTIES = [
  BACNET_PROPERTIES.objectName,
  BACNET_PROPERTIES.description,
  BACNET_PROPERTIES.presentValue,
  BACNET_PROPERTIES.units,
  BACNET_PROPERTIES.statusFlags,
  BACNET_PROPERTIES.reliability,
  BACNET_PROPERTIES.outOfService,
];

const OBJECT_TYPE_NAMES = {
  0: 'analog-input',
  1: 'analog-output',
  2: 'analog-value',
  3: 'binary-input',
  4: 'binary-output',
  5: 'binary-value',
  6: 'calendar',
  7: 'command',
  8: 'device',
  9: 'event-enrollment',
  10: 'file',
  11: 'group',
  12: 'loop',
  13: 'multi-state-input',
  14: 'multi-state-output',
  15: 'notification-class',
  16: 'program',
  17: 'schedule',
  18: 'averaging',
  19: 'multi-state-value',
  20: 'trend-log',
  21: 'life-safety-point',
  22: 'life-safety-zone',
  23: 'accumulator',
  24: 'pulse-converter',
  25: 'event-log',
  26: 'global-group',
  27: 'trend-log-multiple',
  28: 'load-control',
  29: 'structured-view',
  30: 'access-door',
  31: 'timer',
  32: 'access-credential',
  33: 'access-point',
  34: 'access-rights',
  35: 'access-user',
  36: 'access-zone',
  37: 'credential-data-input',
  38: 'network-security',
  39: 'bitstring-value',
  40: 'characterstring-value',
  41: 'date-pattern-value',
  42: 'date-value',
  43: 'datetime-pattern-value',
  44: 'datetime-value',
  45: 'integer-value',
  46: 'large-analog-value',
  47: 'octetstring-value',
  48: 'positive-integer-value',
  49: 'time-pattern-value',
  50: 'time-value',
  51: 'notification-forwarder',
  52: 'alert-enrollment',
  53: 'channel',
  54: 'lighting-output',
  55: 'binary-lighting-output',
  56: 'network-port',
};

function objectTypeLabel(objectType) {
  return OBJECT_TYPE_NAMES[objectType] || `type-${objectType}`;
}

function encodeObjectIdentifier(objectType, instance) {
  const id = ((objectType & 0x3ff) << 22) | (instance & 0x3fffff);
  return Buffer.from([
    0xc4,
    (id >> 24) & 0xff,
    (id >> 16) & 0xff,
    (id >> 8) & 0xff,
    id & 0xff,
  ]);
}

function parseObjectIdentifier(data, offset) {
  const encoded = (data[offset] * 0x1000000)
    + (data[offset + 1] * 0x10000)
    + (data[offset + 2] * 0x100)
    + data[offset + 3];
  return {
    objectType: Math.floor(encoded / 0x400000),
    instance: encoded % 0x400000,
  };
}

function encodeReadProperty(invokeId, objectType, instance, propertyId) {
  const objectIdBytes = encodeObjectIdentifier(objectType, instance);
  return Buffer.concat([
    Buffer.from([0x00, invokeId & 0xff, 0x0c]),
    Buffer.from([0x0c]),
    objectIdBytes,
    Buffer.from([0x19, 0x91, propertyId & 0xff]),
  ]);
}

function encodeReadPropertyMultiple(invokeId, objectType, instance, propertyIds) {
  const objectIdBytes = encodeObjectIdentifier(objectType, instance);
  const propParts = [];
  for (const propertyId of propertyIds) {
    propParts.push(Buffer.from([0x0e, 0x09, 0x91, propertyId & 0xff, 0x0f]));
  }
  return Buffer.concat([
    Buffer.from([0x00, invokeId & 0xff, 0x0e]),
    Buffer.from([0x0e, 0x0e, 0x0c]),
    objectIdBytes,
    Buffer.from([0x1e]),
    ...propParts,
    Buffer.from([0x1f, 0x0f, 0x0f]),
  ]);
}

function buildConfirmedNpdu() {
  return Buffer.from([0x01, 0x04]);
}

function readTag(data, offset) {
  if (offset >= data.length) return null;
  const tagByte = data[offset];
  const isContext = (tagByte & 0x08) !== 0;
  const tagNumber = (tagByte >> 4) & 0x07;
  let length = tagByte & 0x07;
  let headerLen = 1;
  let opening = false;
  let closing = false;

  if (length === 5) {
    length = data[offset + 1];
    headerLen = 2;
  } else if (isContext && length === 6) {
    opening = true;
    length = 0;
  } else if (isContext && length === 7) {
    closing = true;
    length = 0;
  }

  return {
    isContext,
    tagNumber,
    length,
    headerLen,
    opening,
    closing,
    valueOffset: offset + headerLen,
    nextOffset: offset + headerLen + length,
  };
}

function readUnsigned(data, offset, length) {
  let value = 0;
  for (let i = 0; i < length; i += 1) {
    value = (value * 256) + data[offset + i];
  }
  return value;
}

function decodeApplicationValue(data, offset) {
  const tag = readTag(data, offset);
  if (!tag || tag.isContext) return null;

  const { tagNumber, length, valueOffset } = tag;
  const slice = data.slice(valueOffset, valueOffset + length);

  if (tagNumber === 12 && length === 4) {
    return { type: 'objectIdentifier', value: parseObjectIdentifier(data, valueOffset), nextOffset: tag.nextOffset };
  }
  if (tagNumber === 2) {
    return { type: 'unsigned', value: readUnsigned(data, valueOffset, length), nextOffset: tag.nextOffset };
  }
  if (tagNumber === 4) {
    return { type: 'real', value: slice.readFloatBE(0), nextOffset: tag.nextOffset };
  }
  if (tagNumber === 9) {
    return { type: 'enumerated', value: readUnsigned(data, valueOffset, length), nextOffset: tag.nextOffset };
  }
  if (tagNumber === 1) {
    return { type: 'boolean', value: slice[0] !== 0, nextOffset: tag.nextOffset };
  }
  if (tagNumber === 7) {
    return { type: 'characterString', value: slice.length > 0 ? slice.slice(1).toString('utf8') : '', nextOffset: tag.nextOffset };
  }
  if (tagNumber === 3) {
    return { type: 'bitString', value: formatBitString(slice), nextOffset: tag.nextOffset };
  }

  return { type: 'raw', value: slice.toString('hex'), nextOffset: tag.nextOffset };
}

function formatBitString(slice) {
  if (!slice.length) return '';
  const unused = slice[0];
  const bits = [];
  for (let i = 1; i < slice.length; i += 1) {
    for (let bit = 7; bit >= 0; bit -= 1) {
      bits.push((slice[i] >> bit) & 1);
    }
  }
  return bits.slice(0, Math.max(0, bits.length - unused)).join('');
}

function formatPresentValue(decoded) {
  if (decoded == null) return null;
  if (typeof decoded === 'string' || typeof decoded === 'number' || typeof decoded === 'boolean') {
    return decoded;
  }
  if (decoded.type === 'real') return decoded.value;
  if (decoded.type === 'enumerated' || decoded.type === 'unsigned') return decoded.value;
  if (decoded.type === 'boolean') return decoded.value;
  if (decoded.type === 'characterString') return decoded.value;
  if (decoded.type === 'bitString') return decoded.value;
  if (decoded.type === 'objectIdentifier') {
    return `${objectTypeLabel(decoded.value.objectType)}:${decoded.value.instance}`;
  }
  return decoded.value != null ? String(decoded.value) : null;
}

function parseObjectListFromValue(data, offset, length) {
  const end = offset + length;
  const objects = [];
  let cursor = offset;

  while (cursor < end) {
    const tag = readTag(data, cursor);
    if (!tag) break;
    if (!tag.isContext && tag.tagNumber === 12 && tag.length === 4) {
      objects.push(parseObjectIdentifier(data, tag.valueOffset));
      cursor = tag.nextOffset;
      continue;
    }
    if (tag.opening) {
      cursor = tag.valueOffset;
      continue;
    }
    if (tag.closing) {
      cursor = tag.valueOffset;
      continue;
    }
    cursor = tag.nextOffset;
  }

  return objects;
}

function parseReadPropertyComplexAck(data, apduOffset) {
  if (data.length < apduOffset + 3) return { error: 'apdu-too-short' };
  const pduType = data[apduOffset];
  if ((pduType & 0xf0) !== 0x30) {
    return { error: 'not-complex-ack', pduType };
  }
  const invokeId = data[apduOffset + 1];
  const serviceAck = data[apduOffset + 2];
  if (serviceAck !== 0x0c) {
    return { error: 'unexpected-service-ack', serviceAck, invokeId };
  }

  let cursor = apduOffset + 3;
  while (cursor < data.length) {
    const tag = readTag(data, cursor);
    if (!tag) break;
    if (tag.isContext && tag.tagNumber === 3 && !tag.opening && !tag.closing) {
      const decoded = decodeApplicationValue(data, tag.valueOffset);
      return {
        invokeId,
        propertyValue: decoded,
        presentValue: formatPresentValue(decoded),
        rawProperty: decoded,
      };
    }
    if (tag.isContext && tag.tagNumber === 3 && tag.opening) {
      cursor = tag.valueOffset;
      continue;
    }
    cursor = tag.nextOffset;
  }

  return { invokeId, error: 'property-value-not-found' };
}

function parseReadPropertyMultipleComplexAck(data, apduOffset) {
  if (data.length < apduOffset + 3) return { error: 'apdu-too-short' };
  const pduType = data[apduOffset];
  if ((pduType & 0xf0) !== 0x30) {
    return { error: 'not-complex-ack', pduType };
  }
  const invokeId = data[apduOffset + 1];
  const serviceAck = data[apduOffset + 2];
  if (serviceAck !== 0x0e) {
    return { error: 'unexpected-service-ack', serviceAck, invokeId };
  }

  const properties = {};
  let cursor = apduOffset + 3;
  let currentPropertyId = null;

  while (cursor < data.length) {
    const tag = readTag(data, cursor);
    if (!tag) break;

    if (tag.isContext && tag.tagNumber === 2 && !tag.opening && tag.length === 1) {
      const propTag = readTag(data, tag.valueOffset);
      if (propTag && !propTag.isContext && propTag.tagNumber === 9) {
        currentPropertyId = readUnsigned(data, propTag.valueOffset, propTag.length);
      }
      cursor = tag.nextOffset;
      continue;
    }

    if (tag.isContext && tag.tagNumber === 5 && !tag.opening && !tag.closing) {
      const decoded = decodeApplicationValue(data, tag.valueOffset);
      if (currentPropertyId != null) {
        properties[currentPropertyId] = {
          propertyId: currentPropertyId,
          value: formatPresentValue(decoded),
          raw: decoded,
        };
      }
      cursor = tag.nextOffset;
      continue;
    }

    if (tag.opening || tag.closing) {
      cursor = tag.valueOffset;
      continue;
    }

    cursor = tag.nextOffset;
  }

  return { invokeId, properties };
}

function parseErrorOrAbort(data, apduOffset) {
  if (data.length < apduOffset + 2) return null;
  const pduType = data[apduOffset];
  const invokeId = data[apduOffset + 1];
  const high = pduType & 0xf0;
  if (high === 0x50 && data.length >= apduOffset + 4) {
    return { kind: 'error', invokeId, errorClass: data[apduOffset + 2], errorCode: data[apduOffset + 3] };
  }
  if (high === 0x70 && data.length >= apduOffset + 3) {
    return { kind: 'abort', invokeId, abortReason: data[apduOffset + 2] };
  }
  if (high === 0x60 && data.length >= apduOffset + 3) {
    return { kind: 'reject', invokeId, rejectReason: data[apduOffset + 2] };
  }
  return null;
}

function parseConfirmedResponse(data, apduOffset) {
  if (apduOffset == null || data.length < apduOffset + 2) return { error: 'no-apdu' };
  const pduType = data[apduOffset];
  const high = pduType & 0xf0;
  if (high === 0x30) {
    const serviceAck = data[apduOffset + 2];
    if (serviceAck === 0x0c) {
      return { type: 'readProperty', ...parseReadPropertyComplexAck(data, apduOffset) };
    }
    if (serviceAck === 0x0e) {
      return { type: 'readPropertyMultiple', ...parseReadPropertyMultipleComplexAck(data, apduOffset) };
    }
    return { type: 'complexAck', invokeId: data[apduOffset + 1], serviceAck };
  }
  const err = parseErrorOrAbort(data, apduOffset);
  if (err) return { type: err.kind, ...err };
  return { type: 'unknown', pduType, invokeId: data[apduOffset + 1] };
}

function parseObjectListResponse(parsed) {
  if (!parsed || parsed.error) return [];
  const value = parsed.propertyValue || parsed.rawProperty;
  if (!value) return [];

  if (value.type === 'objectIdentifier') {
    return [value.value];
  }

  if (value.type === 'raw' && value.value) {
    return [];
  }

  return [];
}

function extractObjectListFromAck(parsed, data, apduOffset) {
  if (!parsed || parsed.error) return [];

  let cursor = apduOffset + 3;
  while (cursor < data.length) {
    const tag = readTag(data, cursor);
    if (!tag) break;
    if (tag.isContext && tag.tagNumber === 3) {
      if (tag.opening) {
        const objects = [];
        let inner = tag.valueOffset;
        while (inner < data.length) {
          const innerTag = readTag(data, inner);
          if (!innerTag) break;
          if (innerTag.closing) break;
          if (!innerTag.isContext && innerTag.tagNumber === 12 && innerTag.length === 4) {
            objects.push(parseObjectIdentifier(data, innerTag.valueOffset));
          }
          inner = innerTag.nextOffset;
        }
        return objects;
      }
      const decoded = decodeApplicationValue(data, tag.valueOffset);
      if (decoded?.type === 'objectIdentifier') {
        return [decoded.value];
      }
    }
    cursor = tag.nextOffset;
  }

  return parseObjectListResponse(parsed);
}

module.exports = {
  DEVICE_OBJECT_TYPE,
  BACNET_PROPERTIES,
  POINT_DISCOVERY_PROPERTIES,
  OBJECT_TYPE_NAMES,
  objectTypeLabel,
  encodeObjectIdentifier,
  parseObjectIdentifier,
  encodeReadProperty,
  encodeReadPropertyMultiple,
  buildConfirmedNpdu,
  parseConfirmedResponse,
  extractObjectListFromAck,
  formatPresentValue,
};
