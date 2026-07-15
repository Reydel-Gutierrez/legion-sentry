/**
 * COV subscription capability surface for Phase 2.
 *
 * The current MS/TP token + confirmed-request path does not safely support
 * SubscribeCOV / COV notifications yet (no confirmed notification delivery
 * pipeline, no subscription table wired into the persistent runtime).
 *
 * Do not fake COV. Polling remains the Phase 2 value path.
 */
const COV_CAPABILITY = Object.freeze({
  supported: false,
  reason: 'SubscribeCOV is not safely supported on the Phase 2 MS/TP stack',
  confirmedCovSupported: false,
  unconfirmedCovSupported: false,
  renewSupported: false,
});

function getCovCapability() {
  return { ...COV_CAPABILITY };
}

function isCovEligible() {
  return false;
}

async function subscribeCov() {
  const error = new Error('SubscribeCOV is not supported on this MS/TP runtime');
  error.statusCode = 501;
  error.code = 'COV_NOT_SUPPORTED';
  throw error;
}

async function unsubscribeCov() {
  const error = new Error('SubscribeCOV is not supported on this MS/TP runtime');
  error.statusCode = 501;
  error.code = 'COV_NOT_SUPPORTED';
  throw error;
}

function getSubscriptions() {
  return [];
}

module.exports = {
  COV_CAPABILITY,
  getCovCapability,
  isCovEligible,
  subscribeCov,
  unsubscribeCov,
  getSubscriptions,
};
