const DEVICE_OBJECT_TYPE = 8;

// Max APDU length accepted encoding (low nibble of the second APDU byte).
// MS/TP frames carry up to 480 APDU bytes, so we advertise 480 (code 3) and
// no segmentation. This keeps device responses inside a single MS/TP frame.
const MAX_APDU_480 = 0x03;

const BACNET_PROPERTIES = {
  objectList: 76,
  objectName: 77,
  description: 28,
  presentValue: 85,
  units: 117,
  statusFlags: 111,
  reliability: 103,
  outOfService: 81,
  systemStatus: 112,
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

const CONFIRMED_SERVICE = {
  readProperty: 0x0c,
  readPropertyMultiple: 0x0e,
};

const PDU_TYPE = {
  CONFIRMED_REQUEST: 0x00,
  COMPLEX_ACK: 0x30,
  ERROR: 0x50,
  REJECT: 0x60,
  ABORT: 0x70,
};

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
  36: 'access-zone',
  39: 'bitstring-value',
  40: 'characterstring-value',
  45: 'integer-value',
  46: 'large-analog-value',
  48: 'positive-integer-value',
  50: 'time-value',
  56: 'network-port',
};

function objectTypeLabel(objectType) {
  return OBJECT_TYPE_NAMES[objectType] || `type-${objectType}`;
}

function encodeUnsignedBytes(value) {
  if (value <= 0) return [0];
  const bytes = [];
  let v = value;
  while (v > 0) {
    bytes.unshift(v & 0xff);
    v = Math.floor(v / 256);
  }
  return bytes;
}

// Context-tagged unsigned (tag class = context, value encoded big-endian).
function encodeContextUnsigned(tagNumber, value) {
  const bytes = encodeUnsignedBytes(value);
  const header = ((tagNumber & 0x0f) << 4) | 0x08 | (bytes.length & 0x07);
  return Buffer.from([header, ...bytes]);
}

// Raw 4-byte BACnetObjectIdentifier (no tag).
function objectIdBytes(objectType, instance) {
  const id = (objectType * 0x400000) + (instance & 0x3fffff);
  return [
    Math.floor(id / 0x1000000) & 0xff,
    Math.floor(id / 0x10000) & 0xff,
    Math.floor(id / 0x100) & 0xff,
    id & 0xff,
  ];
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

function confirmedRequestHeader(invokeId, serviceChoice) {
  // [PDU type | flags], [max segments | max APDU], [invoke id], [service choice]
  return [PDU_TYPE.CONFIRMED_REQUEST, MAX_APDU_480, invokeId & 0xff, serviceChoice & 0xff];
}

function encodeReadProperty(invokeId, objectType, instance, propertyId, arrayIndex) {
  const parts = [
    ...confirmedRequestHeader(invokeId, CONFIRMED_SERVICE.readProperty),
    // objectIdentifier [0] (context tag 0, length 4)
    0x0c,
    ...objectIdBytes(objectType, instance),
  ];
  // propertyIdentifier [1]
  parts.push(...encodeContextUnsigned(1, propertyId));
  // propertyArrayIndex [2] (optional)
  if (arrayIndex != null) {
    parts.push(...encodeContextUnsigned(2, arrayIndex));
  }
  return Buffer.from(parts);
}

function encodeReadPropertyMultiple(invokeId, objectType, instance, propertyIds) {
  const parts = [
    ...confirmedRequestHeader(invokeId, CONFIRMED_SERVICE.readPropertyMultiple),
    // objectIdentifier [0]
    0x0c,
    ...objectIdBytes(objectType, instance),
    // listOfPropertyReferences [1] opening tag
    0x1e,
  ];
  for (const propertyId of propertyIds) {
    // propertyIdentifier [0] of BACnetPropertyReference
    parts.push(...encodeContextUnsigned(0, propertyId));
  }
  // closing tag [1]
  parts.push(0x1f);
  return Buffer.from(parts);
}

function buildConfirmedNpdu() {
  // NPDU version 1, control 0x04 (expecting reply, no addressing for local MS/TP).
  return Buffer.from([0x01, 0x04]);
}

function readTag(data, offset) {
  if (offset >= data.length) return null;
  const tagByte = data[offset];
  const isContext = (tagByte & 0x08) !== 0;
  const tagNumber = (tagByte >> 4) & 0x0f;
  const lvt = tagByte & 0x07;
  let length = lvt;
  let headerLen = 1;
  let opening = false;
  let closing = false;

  if (isContext && lvt === 6) {
    opening = true;
    length = 0;
  } else if (isContext && lvt === 7) {
    closing = true;
    length = 0;
  } else if (lvt === 5) {
    length = data[offset + 1];
    headerLen = 2;
  }

  return {
    tagByte,
    isContext,
    tagNumber,
    lvt,
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

function readSigned(data, offset, length) {
  if (length === 0) return 0;
  let value = (data[offset] & 0x80) ? -1 : 0;
  for (let i = 0; i < length; i += 1) {
    value = (value * 256) + data[offset + i];
  }
  // Correct for the sign-extension seed above.
  if (data[offset] & 0x80) {
    value += 256 ** length;
    value -= 256 ** length;
  }
  return value;
}

// BACnet character set codes (ASHRAE 135, BACnetCharacterString):
//   0 = ANSI X3.4 / UTF-8
//   1 = IBM/Microsoft DBCS
//   2 = JIS X 0208
//   3 = UCS-4   (UTF-32, big-endian)
//   4 = UCS-2   (UTF-16, big-endian)
//   5 = ISO 8859-1 (Latin-1)
const BACNET_CHARSET = {
  UTF8: 0,
  DBCS: 1,
  JIS: 2,
  UCS4: 3,
  UCS2: 4,
  ISO8859_1: 5,
};

function decodeUcs2BigEndian(buf) {
  let out = '';
  for (let i = 0; i + 1 < buf.length; i += 2) {
    out += String.fromCharCode((buf[i] << 8) | buf[i + 1]);
  }
  return out;
}

function decodeUcs4BigEndian(buf) {
  let out = '';
  for (let i = 0; i + 3 < buf.length; i += 4) {
    const codePoint = (buf[i] * 0x1000000)
      + (buf[i + 1] * 0x10000)
      + (buf[i + 2] * 0x100)
      + buf[i + 3];
    try {
      out += String.fromCodePoint(codePoint);
    } catch {
      // skip invalid code points
    }
  }
  return out;
}

// Remove NUL and C0/C1 control characters that some devices leave in (or that
// arise from wide-character encodings). Printable text — including spaces and
// extended Latin — is preserved. This keeps stored/displayed names clean while
// the wire bytes are decoded faithfully first.
function sanitizeText(value) {
  if (value == null) return value;
  // eslint-disable-next-line no-control-regex
  return String(value).replace(/[\u0000-\u001f\u007f-\u009f]/g, '').trim();
}

function decodeCharacterString(slice) {
  if (!slice.length) return '';
  const charset = slice[0];
  const body = slice.slice(1);

  let decoded;
  switch (charset) {
    case BACNET_CHARSET.UTF8:
      decoded = body.toString('utf8');
      break;
    case BACNET_CHARSET.UCS2:
      decoded = decodeUcs2BigEndian(body);
      break;
    case BACNET_CHARSET.UCS4:
      decoded = decodeUcs4BigEndian(body);
      break;
    case BACNET_CHARSET.ISO8859_1:
      decoded = body.toString('latin1');
      break;
    default:
      // DBCS/JIS and anything unexpected: best-effort UTF-8, then sanitize.
      decoded = body.toString('utf8');
      break;
  }

  return sanitizeText(decoded);
}

function formatBitString(slice) {
  if (!slice.length) return '';
  const unusedBits = slice[0];
  const bits = [];
  for (let i = 1; i < slice.length; i += 1) {
    for (let bit = 7; bit >= 0; bit -= 1) {
      bits.push((slice[i] >> bit) & 1);
    }
  }
  const usable = Math.max(0, bits.length - unusedBits);
  return bits.slice(0, usable).join('');
}

// Decode a single application-tagged value at `offset`. Returns null for a
// context tag (caller is responsible for structure).
function decodeApplicationValue(data, offset) {
  if (offset >= data.length) return null;
  const tagByte = data[offset];
  if ((tagByte & 0x08) !== 0) return null;

  const tagNumber = (tagByte >> 4) & 0x0f;
  const lvt = tagByte & 0x07;

  // Boolean: the value lives in the LVT field; there are no content octets.
  if (tagNumber === 1) {
    return { type: 'boolean', value: lvt === 1, nextOffset: offset + 1 };
  }

  let length = lvt;
  let headerLen = 1;
  if (lvt === 5) {
    length = data[offset + 1];
    headerLen = 2;
  }
  const valueOffset = offset + headerLen;
  const slice = data.slice(valueOffset, valueOffset + length);
  const nextOffset = valueOffset + length;

  switch (tagNumber) {
    case 0:
      return { type: 'null', value: null, nextOffset };
    case 2:
      return { type: 'unsigned', value: readUnsigned(data, valueOffset, length), nextOffset };
    case 3:
      return { type: 'signed', value: readSigned(data, valueOffset, length), nextOffset };
    case 4:
      return { type: 'real', value: length >= 4 ? slice.readFloatBE(0) : null, nextOffset };
    case 5:
      return { type: 'double', value: length >= 8 ? slice.readDoubleBE(0) : null, nextOffset };
    case 6:
      return { type: 'octetString', value: slice.toString('hex'), nextOffset };
    case 7:
      return {
        type: 'characterString',
        value: decodeCharacterString(slice),
        charset: slice.length ? slice[0] : null,
        rawHex: slice.toString('hex'),
        nextOffset,
      };
    case 8:
      return { type: 'bitString', value: formatBitString(slice), nextOffset };
    case 9:
      return { type: 'enumerated', value: readUnsigned(data, valueOffset, length), nextOffset };
    case 10:
      return { type: 'date', value: slice.toString('hex'), nextOffset };
    case 11:
      return { type: 'time', value: slice.toString('hex'), nextOffset };
    case 12:
      return { type: 'objectIdentifier', value: parseObjectIdentifier(data, valueOffset), nextOffset };
    default:
      return { type: 'raw', value: slice.toString('hex'), nextOffset };
  }
}

function formatPresentValue(decoded) {
  if (decoded == null) return null;
  if (typeof decoded !== 'object') return decoded;
  if (decoded.type === 'objectIdentifier' && decoded.value) {
    return `${objectTypeLabel(decoded.value.objectType)}:${decoded.value.instance}`;
  }
  return decoded.value;
}

// Parse a ReadProperty-ACK, returning the list of decoded application values
// contained in the property-value [3] field.
function parseReadPropertyAck(data, apduOffset) {
  const result = {
    type: 'readProperty',
    invokeId: data[apduOffset + 1],
    propertyId: null,
    values: [],
  };

  let cursor = apduOffset + 3;
  while (cursor < data.length) {
    const tag = readTag(data, cursor);
    if (!tag) break;

    if (tag.isContext && tag.tagNumber === 1 && !tag.opening && !tag.closing) {
      result.propertyId = readUnsigned(data, tag.valueOffset, tag.length);
      cursor = tag.nextOffset;
      continue;
    }

    if (tag.isContext && tag.tagNumber === 3 && tag.opening) {
      let inner = tag.valueOffset;
      while (inner < data.length) {
        const innerTag = readTag(data, inner);
        if (!innerTag) break;
        if (innerTag.isContext && innerTag.tagNumber === 3 && innerTag.closing) {
          inner = innerTag.valueOffset;
          break;
        }
        const value = decodeApplicationValue(data, inner);
        if (!value) {
          inner = innerTag.nextOffset;
          continue;
        }
        result.values.push(value);
        inner = value.nextOffset;
      }
      cursor = inner;
      continue;
    }

    if (tag.opening || tag.closing) {
      cursor = tag.valueOffset;
      continue;
    }
    cursor = tag.nextOffset;
  }

  return result;
}

// Parse a ReadPropertyMultiple-ACK into a map keyed by property identifier.
function parseReadPropertyMultipleAck(data, apduOffset) {
  const result = {
    type: 'readPropertyMultiple',
    invokeId: data[apduOffset + 1],
    properties: {},
  };

  let cursor = apduOffset + 3;
  let currentPropertyId = null;

  while (cursor < data.length) {
    const tag = readTag(data, cursor);
    if (!tag) break;

    // propertyIdentifier [2]
    if (tag.isContext && tag.tagNumber === 2 && !tag.opening && !tag.closing) {
      currentPropertyId = readUnsigned(data, tag.valueOffset, tag.length);
      cursor = tag.nextOffset;
      continue;
    }

    // propertyValue [4] opening tag
    if (tag.isContext && tag.tagNumber === 4 && tag.opening) {
      const value = decodeApplicationValue(data, tag.valueOffset);
      if (currentPropertyId != null && value) {
        result.properties[currentPropertyId] = {
          propertyId: currentPropertyId,
          value: formatPresentValue(value),
          raw: value,
        };
      }
      // Advance past the value and its closing [4] tag.
      let inner = value ? value.nextOffset : tag.valueOffset;
      const closeTag = readTag(data, inner);
      if (closeTag && closeTag.closing) inner = closeTag.valueOffset;
      cursor = inner;
      currentPropertyId = null;
      continue;
    }

    // propertyAccessError [5] opening tag — skip to its closing tag.
    if (tag.isContext && tag.tagNumber === 5 && tag.opening) {
      let inner = tag.valueOffset;
      while (inner < data.length) {
        const innerTag = readTag(data, inner);
        if (!innerTag) break;
        if (innerTag.isContext && innerTag.tagNumber === 5 && innerTag.closing) {
          inner = innerTag.valueOffset;
          break;
        }
        inner = innerTag.nextOffset;
      }
      cursor = inner;
      currentPropertyId = null;
      continue;
    }

    if (tag.opening || tag.closing) {
      cursor = tag.valueOffset;
      continue;
    }
    cursor = tag.nextOffset;
  }

  return result;
}

function parseConfirmedResponse(data, apduOffset) {
  if (apduOffset == null || data.length < apduOffset + 2) {
    return { type: 'unknown', invokeId: null };
  }

  const pduType = data[apduOffset] & 0xf0;
  const invokeId = data[apduOffset + 1];

  if (pduType === PDU_TYPE.COMPLEX_ACK) {
    const serviceAck = data[apduOffset + 2];
    if (serviceAck === CONFIRMED_SERVICE.readProperty) {
      return parseReadPropertyAck(data, apduOffset);
    }
    if (serviceAck === CONFIRMED_SERVICE.readPropertyMultiple) {
      return parseReadPropertyMultipleAck(data, apduOffset);
    }
    return { type: 'complexAck', invokeId, serviceAck };
  }

  if (pduType === PDU_TYPE.ERROR) {
    return {
      type: 'error',
      invokeId,
      errorClass: data[apduOffset + 3],
      errorCode: data[apduOffset + 4],
    };
  }
  if (pduType === PDU_TYPE.REJECT) {
    return { type: 'reject', invokeId, rejectReason: data[apduOffset + 2] };
  }
  if (pduType === PDU_TYPE.ABORT) {
    return { type: 'abort', invokeId, abortReason: data[apduOffset + 2] };
  }

  return { type: 'unknown', invokeId, pduType };
}

// Extract object identifiers from decoded ReadProperty values.
function valuesToObjectList(values = []) {
  return values
    .filter((v) => v && v.type === 'objectIdentifier' && v.value)
    .map((v) => v.value);
}

function firstUnsigned(values = []) {
  const found = values.find((v) => v && (v.type === 'unsigned' || v.type === 'enumerated'));
  return found ? found.value : null;
}

function firstObjectId(values = []) {
  const list = valuesToObjectList(values);
  return list.length ? list[0] : null;
}

module.exports = {
  DEVICE_OBJECT_TYPE,
  BACNET_PROPERTIES,
  POINT_DISCOVERY_PROPERTIES,
  OBJECT_TYPE_NAMES,
  objectTypeLabel,
  encodeReadProperty,
  encodeReadPropertyMultiple,
  buildConfirmedNpdu,
  parseConfirmedResponse,
  valuesToObjectList,
  firstUnsigned,
  firstObjectId,
  formatPresentValue,
  sanitizeText,
};
