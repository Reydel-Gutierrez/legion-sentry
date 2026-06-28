/**
 * BACnet MS/TP master token engine.
 *
 * Participates on the token ring and can safely start token circulation on an
 * idle trunk after a configurable pre-listen window:
 * - Pre-listens for existing ring activity before transmitting
 * - Joins an active ring when token/PFM/data frames are observed
 * - Enters sole-master startup when the bus stays quiet
 * - Responds to Poll For Master addressed to this station
 * - Accepts tokens, sends queued BACnet frames only while holding token
 * - Passes the token to the next master
 */

const MSTP_FRAME_TYPE = {
  TOKEN: 0x00,
  POLL_FOR_MASTER: 0x01,
  REPLY_TO_POLL_FOR_MASTER: 0x02,
  BACNET_DATA_EXPECTING_REPLY: 0x05,
  BACNET_DATA_NOT_EXPECTING_REPLY: 0x06,
};

const MSTP_STATE = {
  INITIALIZE: 'initialize',
  IDLE: 'idle',
  USE_TOKEN: 'use-token',
  PASS_TOKEN: 'pass-token',
  DUPLICATE_TOKEN: 'duplicate-token',
};

const STARTUP_MODE = {
  PRE_LISTEN: 'pre-listen',
  JOIN_RING: 'join-ring',
  SOLE_MASTER_STARTUP: 'sole-master-startup',
};

function tSlotMsForBaud(baudRate) {
  if (baudRate <= 9600) return 10;
  if (baudRate <= 19200) return 5;
  if (baudRate <= 38400) return 2.5;
  if (baudRate <= 76800) return 1.25;
  return 0.833;
}

function turnaroundMsForBaud(baudRate) {
  // 40 bit-times silence after end-of-frame before transmitting.
  return Math.ceil((40 * 1000) / baudRate);
}

function incrementMasterMac(mac, maxMaster) {
  const next = mac + 1;
  if (next > maxMaster) return 0;
  return next;
}

function isValidMstpActivityFrame(frame) {
  if (!frame?.headerCrcValid) return false;

  if (
    frame.frameType === MSTP_FRAME_TYPE.TOKEN
    || frame.frameType === MSTP_FRAME_TYPE.POLL_FOR_MASTER
    || frame.frameType === MSTP_FRAME_TYPE.REPLY_TO_POLL_FOR_MASTER
  ) {
    return frame.dataLength === 0;
  }

  if (
    frame.frameType === MSTP_FRAME_TYPE.BACNET_DATA_EXPECTING_REPLY
    || frame.frameType === MSTP_FRAME_TYPE.BACNET_DATA_NOT_EXPECTING_REPLY
  ) {
    return frame.dataLength > 0 && frame.dataCrcValid !== false;
  }

  return false;
}

class MstpTokenEngine {
  /**
   * @param {object} options
   * @param {number} options.macAddress - This_Station (0-127)
   * @param {number} options.maxMaster - Max_Master
   * @param {number} options.maxInfoFrames - Max_Info_Frames
   * @param {number} options.baudRate
   * @param {number} [options.preListenMs=1000] - Quiet-bus listen window before sole-master startup
   * @param {(frameType:number, dest:number, src:number, data?:Buffer) => Buffer} options.buildFrame
   * @param {(level:string, message:string, extra?:object) => void} [options.onLog]
   * @param {(from:string, to:string, extra?:object) => void} [options.onStateChange]
   */
  constructor(options) {
    this.macAddress = options.macAddress;
    this.maxMaster = options.maxMaster;
    this.maxInfoFrames = Math.max(1, options.maxInfoFrames || 1);
    this.baudRate = options.baudRate || 38400;
    this.preListenMs = Math.max(0, options.preListenMs ?? 1000);
    this.buildFrame = options.buildFrame;
    this.onLog = options.onLog || (() => {});
    this.onStateChange = options.onStateChange || (() => {});

    this.tSlot = tSlotMsForBaud(this.baudRate);
    this.tUsage = 35 * this.tSlot;
    this.tTurnaround = turnaroundMsForBaud(this.baudRate);
    this.tPoll = 50 * this.tSlot;

    this.state = MSTP_STATE.INITIALIZE;
    this.startupMode = STARTUP_MODE.PRE_LISTEN;
    this.busActivityDetected = false;
    this.soleMasterStartupActive = false;
    this.lastPollForMasterMac = null;
    this.tokenRingEstablished = false;
    this.preListenStartedAt = Date.now();

    this.nextStation = incrementMasterMac(this.macAddress, this.maxMaster);
    this.pollStation = this.nextStation;
    this.frameCount = 0;
    this.tokenCount = 0;
    this.holdingToken = false;
    this.seenRingActivity = false;
    this.tokenReceivedAt = null;
    this.lastSilenceAt = 0;
    this.lastStateChangeAt = Date.now();

    this.bacnetFrameQueue = [];
    this.pendingPassToken = false;
    this.pendingPollForMaster = false;
    this.waitingForPfmReply = false;
    this.pfmSentAt = null;
    this.pfmReplyFromMac = null;

    // When we transmit a reply-expected BACnet frame (e.g. a confirmed
    // ReadProperty), MS/TP requires us to keep the token and wait for the peer
    // to reply before passing it on. Treply is bounded (255 ms by spec).
    this.awaitingReplyUntil = null;
    this.replyTimeoutMs = options.replyTimeoutMs || 255;

    this.stats = {
      tokensReceived: 0,
      tokensPassed: 0,
      pollForMasterReceived: 0,
      pollForMasterReplied: 0,
      pollForMasterSent: 0,
      whoIsSentWhileHoldingToken: 0,
      duplicateTokens: 0,
      ringTokensObserved: 0,
    };

    this._transition(MSTP_STATE.IDLE, 'engine started — pre-listening for MS/TP activity');
  }

  getParticipationStatus() {
    if (this.startupMode === STARTUP_MODE.PRE_LISTEN) return 'listening-only';
    if (this.startupMode === STARTUP_MODE.SOLE_MASTER_STARTUP) return 'starting-idle-ring';
    if (this.state === MSTP_STATE.PASS_TOKEN) return 'passing-token';
    if (this.holdingToken && this.state === MSTP_STATE.USE_TOKEN) return 'holding-token';
    if (this.startupMode === STARTUP_MODE.JOIN_RING && !this.holdingToken) return 'joining-active-ring';
    return 'listening-only';
  }

  getSnapshot() {
    return {
      state: this.state,
      holdingToken: this.holdingToken,
      macAddress: this.macAddress,
      nextStation: this.nextStation,
      pollStation: this.pollStation,
      seenRingActivity: this.seenRingActivity,
      startupMode: this.startupMode,
      busActivityDetected: this.busActivityDetected,
      soleMasterStartupActive: this.soleMasterStartupActive,
      lastPollForMasterMac: this.lastPollForMasterMac,
      tokenRingEstablished: this.tokenRingEstablished,
      participationStatus: this.getParticipationStatus(),
      bacnetFramesQueued: this.bacnetFrameQueue.length,
      stats: { ...this.stats },
      timings: {
        tSlotMs: this.tSlot,
        tUsageMs: this.tUsage,
        tTurnaroundMs: this.tTurnaround,
        tPollMs: this.tPoll,
        preListenMs: this.preListenMs,
      },
    };
  }

  queueWhoIsFrame(mstpFrame) {
    this.queueBacnetFrame(mstpFrame, 'Who-Is', { expectsReply: false });
  }

  queueBacnetFrame(mstpFrame, label = 'BACnet', { expectsReply = false } = {}) {
    if (!mstpFrame || !mstpFrame.length) return;
    this.bacnetFrameQueue.push({ buffer: Buffer.from(mstpFrame), expectsReply, label });
    this.onLog('debug', `${label} frame queued for token-gated send (${this.bacnetFrameQueue.length} in queue)`);
  }

  _markBusActivity(frame) {
    // An expected Reply To Poll For Master during our own sole-master poll is not
    // evidence of a foreign active ring — do not abort startup for it.
    if (
      this.soleMasterStartupActive
      && this.waitingForPfmReply
      && frame?.frameType === MSTP_FRAME_TYPE.REPLY_TO_POLL_FOR_MASTER
      && frame.destination === this.macAddress
    ) {
      this.seenRingActivity = true;
      return;
    }

    if (!this.busActivityDetected) {
      this.busActivityDetected = true;
      if (this.startupMode === STARTUP_MODE.PRE_LISTEN) {
        this._enterJoinRing('bus activity detected during pre-listen — joining existing ring');
      } else if (this.startupMode === STARTUP_MODE.SOLE_MASTER_STARTUP) {
        this._abortSoleMasterStartup('bus activity detected during sole-master startup — joining existing ring');
      }
    }

    if (
      frame?.frameType === MSTP_FRAME_TYPE.TOKEN
      || frame?.frameType === MSTP_FRAME_TYPE.POLL_FOR_MASTER
      || frame?.frameType === MSTP_FRAME_TYPE.REPLY_TO_POLL_FOR_MASTER
    ) {
      this.seenRingActivity = true;
    }
  }

  _enterJoinRing(reason) {
    this.startupMode = STARTUP_MODE.JOIN_RING;
    this.soleMasterStartupActive = false;
    this.pendingPollForMaster = false;
    this.waitingForPfmReply = false;
    this.pfmSentAt = null;
    this.pfmReplyFromMac = null;
    this.onLog('info', reason);
  }

  _abortSoleMasterStartup(reason) {
    this.soleMasterStartupActive = false;
    this.pendingPollForMaster = false;
    this.waitingForPfmReply = false;
    this.pfmSentAt = null;
    this.pfmReplyFromMac = null;
    this._enterJoinRing(reason);
  }

  _beginSoleMasterStartup(nowMs) {
    this.startupMode = STARTUP_MODE.SOLE_MASTER_STARTUP;
    this.soleMasterStartupActive = true;
    this.pollStation = incrementMasterMac(this.macAddress, this.maxMaster);
    this.pendingPollForMaster = true;
    this.waitingForPfmReply = false;
    this.pfmSentAt = null;
    this.pfmReplyFromMac = null;
    this.lastSilenceAt = nowMs;
    this.onLog('info', 'No MS/TP activity detected during pre-listen');
    this.onLog('info', 'Starting sole-master token generation');
  }

  _establishTokenRing(reason) {
    if (!this.tokenRingEstablished) {
      this.tokenRingEstablished = true;
      this.onLog('info', 'Token ring established', { reason });
    }
  }

  /**
   * Process a parsed MS/TP frame from the bus.
   * @param {object} frame
   * @returns {Buffer|null} Reply To Poll For Master frame when addressed to this station.
   */
  handleReceivedFrame(frame) {
    if (!frame?.headerCrcValid) return null;

    this.lastSilenceAt = Date.now();

    if (isValidMstpActivityFrame(frame)) {
      this._markBusActivity(frame);
    }

    if (frame.frameType === MSTP_FRAME_TYPE.TOKEN && frame.dataLength === 0) {
      this.stats.ringTokensObserved += 1;

      if (this.soleMasterStartupActive) {
        this._abortSoleMasterStartup('token observed during sole-master startup — joining existing ring');
      }

      if (frame.destination === this.macAddress) {
        this._onTokenForUs(frame);
      } else {
        this.onLog('debug', `Token observed for MAC ${frame.destination} (local MAC ${this.macAddress})`, {
          destinationMac: frame.destination,
          sourceMac: frame.source,
        });
      }
      return null;
    }

    if (frame.frameType === MSTP_FRAME_TYPE.POLL_FOR_MASTER && frame.dataLength === 0) {
      if (this.soleMasterStartupActive) {
        this._abortSoleMasterStartup('Poll For Master observed during sole-master startup — joining existing ring');
      }

      if (frame.destination === this.macAddress) {
        return this._onPollForMaster(frame);
      }
      return null;
    }

    if (frame.frameType === MSTP_FRAME_TYPE.REPLY_TO_POLL_FOR_MASTER && frame.dataLength === 0) {
      if (
        this.soleMasterStartupActive
        && this.waitingForPfmReply
        && frame.destination === this.macAddress
      ) {
        this.pfmReplyFromMac = frame.source;
        this.onLog('info', `Master MAC ${frame.source} replied`, {
          masterMac: frame.source,
          polledMac: this.lastPollForMasterMac,
        });
      }
      return null;
    }

    // A data-bearing frame received while we are holding the token waiting for
    // a reply means the peer has answered — we may now pass the token.
    if (this.awaitingReplyUntil != null && frame.dataLength > 0) {
      this.awaitingReplyUntil = null;
      this.pendingPassToken = true;
      this.onLog('debug', 'Reply received from peer — token will be passed');
    }

    return null;
  }

  notifyTransmitted() {
    this.lastSilenceAt = Date.now();
  }

  /**
   * Advance timers and return at most one frame ready to transmit (turnaround-safe).
   * @param {number} [nowMs]
   * @returns {Buffer|null}
   */
  poll(nowMs = Date.now()) {
    if (this.startupMode === STARTUP_MODE.PRE_LISTEN) {
      if (nowMs >= this.preListenStartedAt + this.preListenMs) {
        if (!this.busActivityDetected) {
          this._beginSoleMasterStartup(nowMs);
        } else {
          this._enterJoinRing('pre-listen complete — joining active ring');
        }
      } else {
        return null;
      }
    }

    if (!this._turnaroundElapsed(nowMs)) {
      return null;
    }

    if (this.startupMode === STARTUP_MODE.SOLE_MASTER_STARTUP) {
      const soleMasterFrame = this._pollSoleMasterStartup(nowMs);
      if (soleMasterFrame) {
        return soleMasterFrame;
      }
    }

    if (this.pendingPassToken) {
      this.pendingPassToken = false;
      this.awaitingReplyUntil = null;
      return this._emitPassToken();
    }

    // Hold the token while waiting for a reply-expected response.
    if (this.awaitingReplyUntil != null) {
      if (nowMs < this.awaitingReplyUntil) {
        return null;
      }
      this.awaitingReplyUntil = null;
      this.onLog('debug', 'Reply window elapsed without response — passing token');
      return this._emitPassToken();
    }

    if (this.state === MSTP_STATE.USE_TOKEN && this.holdingToken) {
      if (nowMs - this.tokenReceivedAt >= this.tUsage && this.bacnetFrameQueue.length === 0) {
        this.onLog('info', `Tusage (${this.tUsage.toFixed(1)}ms) elapsed — passing token`);
        return this._emitPassToken();
      }

      if (this.frameCount < this.maxInfoFrames && this.bacnetFrameQueue.length > 0) {
        const item = this.bacnetFrameQueue.shift();
        this.frameCount += 1;
        this.stats.whoIsSentWhileHoldingToken += 1;
        this.onLog('info', `BACnet frame sent while holding token (frame ${this.frameCount}/${this.maxInfoFrames})`, {
          macAddress: this.macAddress,
          frameBytes: item.buffer.length,
          expectsReply: item.expectsReply,
        });
        if (item.expectsReply) {
          // Keep the token and wait for the peer's reply (Treply bound).
          this.awaitingReplyUntil = nowMs + this.replyTimeoutMs;
        } else if (this.frameCount >= this.maxInfoFrames || this.bacnetFrameQueue.length === 0) {
          this.pendingPassToken = true;
        }
        return item.buffer;
      }

      if (this.bacnetFrameQueue.length === 0) {
        this.onLog('debug', 'Token held with empty BACnet queue — passing token');
        return this._emitPassToken();
      }
    }

    if (this.state === MSTP_STATE.PASS_TOKEN) {
      this._transition(MSTP_STATE.IDLE, 'token passed — returning to idle');
      this.holdingToken = false;
      this.tokenReceivedAt = null;
      this.frameCount = 0;
    }

    return null;
  }

  _pollSoleMasterStartup(nowMs) {
    if (this.pfmReplyFromMac != null) {
      const replyingMac = this.pfmReplyFromMac;
      this.pfmReplyFromMac = null;
      this.soleMasterStartupActive = false;
      this.waitingForPfmReply = false;
      this.pendingPollForMaster = false;
      this.startupMode = STARTUP_MODE.JOIN_RING;
      this.nextStation = replyingMac;
      this._establishTokenRing('another master replied during sole-master poll');
      this.onLog('info', `Passing token to discovered master MAC ${replyingMac}`, {
        destinationMac: replyingMac,
      });
      return this._emitPassTokenTo(replyingMac);
    }

    if (this.waitingForPfmReply) {
      if (nowMs < this.pfmSentAt + this.tPoll) {
        return null;
      }

      this.waitingForPfmReply = false;
      this.onLog('debug', `No reply from master MAC ${this.lastPollForMasterMac} within Tpoll`, {
        polledMac: this.lastPollForMasterMac,
      });

      this.pollStation = incrementMasterMac(this.pollStation, this.maxMaster);
      if (this.pollStation === this.macAddress) {
        return this._claimTokenAsSoleMaster(nowMs);
      }

      this.pendingPollForMaster = true;
    }

    if (this.pendingPollForMaster) {
      return this._emitPollForMaster(nowMs);
    }

    return null;
  }

  _emitPollForMaster(nowMs) {
    const dest = this.pollStation;
    this.pendingPollForMaster = false;
    this.waitingForPfmReply = true;
    this.pfmSentAt = nowMs;
    this.lastPollForMasterMac = dest;
    this.stats.pollForMasterSent += 1;

    this.onLog('info', `Polling for master MAC ${dest}`, {
      destinationMac: dest,
      sourceMac: this.macAddress,
    });

    return this.buildFrame(
      MSTP_FRAME_TYPE.POLL_FOR_MASTER,
      dest,
      this.macAddress,
    );
  }

  _claimTokenAsSoleMaster(nowMs) {
    this.soleMasterStartupActive = false;
    this.waitingForPfmReply = false;
    this.pendingPollForMaster = false;
    this.startupMode = STARTUP_MODE.JOIN_RING;
    this.nextStation = incrementMasterMac(this.macAddress, this.maxMaster);
    this._establishTokenRing('no other masters replied — holding token locally');

    this.holdingToken = true;
    this.tokenReceivedAt = nowMs;
    this.frameCount = 0;
    this.stats.tokensReceived += 1;
    this._transition(MSTP_STATE.USE_TOKEN, 'created token locally as sole master');

    this.onLog('info', `Token claimed locally for MAC ${this.macAddress}`, {
      macAddress: this.macAddress,
    });

    return null;
  }

  _turnaroundElapsed(nowMs) {
    return nowMs >= this.lastSilenceAt + this.tTurnaround;
  }

  _onTokenForUs(frame) {
    this.stats.tokensReceived += 1;
    this._establishTokenRing('token received from active ring');
    this.onLog('info', `Token received for local MAC ${this.macAddress}`, {
      sourceMac: frame.source,
      destinationMac: frame.destination,
      tokenCount: this.stats.tokensReceived,
    });

    if (this.state === MSTP_STATE.USE_TOKEN && this.holdingToken) {
      this.stats.duplicateTokens += 1;
      this.onLog('warn', 'Duplicate token received while already holding token');
      this._transition(MSTP_STATE.DUPLICATE_TOKEN, 'duplicate token');
      this.pendingPassToken = true;
      return;
    }

    this.holdingToken = true;
    this.tokenReceivedAt = Date.now();
    this.frameCount = 0;
    this._transition(MSTP_STATE.USE_TOKEN, 'token accepted — may send queued BACnet frames');
  }

  _onPollForMaster(frame) {
    this.stats.pollForMasterReceived += 1;
    this.onLog('info', `Poll For Master received for local MAC ${this.macAddress}`, {
      sourceMac: frame.source,
      destinationMac: frame.destination,
    });

    this.stats.pollForMasterReplied += 1;
    this.onLog('info', `Reply To Poll For Master queued for MAC ${frame.source}`, {
      destinationMac: frame.source,
      sourceMac: this.macAddress,
    });
    return this.buildFrame(
      MSTP_FRAME_TYPE.REPLY_TO_POLL_FOR_MASTER,
      frame.source,
      this.macAddress,
    );
  }

  _emitPassToken() {
    return this._emitPassTokenTo(this.nextStation);
  }

  _emitPassTokenTo(dest) {
    if (this.state === MSTP_STATE.PASS_TOKEN) {
      return null;
    }

    const tokenFrame = this.buildFrame(
      MSTP_FRAME_TYPE.TOKEN,
      dest,
      this.macAddress,
    );

    this.tokenCount += 1;
    this.stats.tokensPassed += 1;
    this.nextStation = incrementMasterMac(dest, this.maxMaster);
    this.pollStation = incrementMasterMac(this.pollStation, this.maxMaster);

    this.onLog('info', `Token passed to MAC ${dest}`, {
      destinationMac: dest,
      sourceMac: this.macAddress,
    });
    this._transition(MSTP_STATE.PASS_TOKEN, `passing token to MAC ${dest}`);
    this.holdingToken = false;
    return tokenFrame;
  }

  _transition(nextState, reason) {
    const prev = this.state;
    if (prev === nextState) return;
    this.state = nextState;
    this.lastStateChangeAt = Date.now();
    this.onStateChange(prev, nextState, { reason });
    this.onLog('info', `MS/TP state ${prev} → ${nextState}: ${reason}`, {
      previousState: prev,
      nextState,
      reason,
    });
  }
}

module.exports = {
  MstpTokenEngine,
  MSTP_STATE,
  MSTP_FRAME_TYPE,
  STARTUP_MODE,
  tSlotMsForBaud,
  turnaroundMsForBaud,
  incrementMasterMac,
  isValidMstpActivityFrame,
};
