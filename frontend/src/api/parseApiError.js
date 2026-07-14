export function extractErrorMessage(payload, status) {
  if (!payload || typeof payload !== 'object') {
    return `Request failed: ${status}`;
  }
  if (typeof payload.error === 'string') return payload.error;
  if (payload.error && typeof payload.error === 'object' && payload.error.message) {
    return payload.error.message;
  }
  if (payload.message) return payload.message;
  return `Request failed: ${status}`;
}

export function getDiscoverJobFromResponse(result) {
  return result?.job || result?.data?.job || null;
}

export function shouldSuppressDiscoverClick({ loading }) {
  return Boolean(loading);
}
