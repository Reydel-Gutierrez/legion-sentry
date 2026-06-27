/**
 * BACnet MS/TP master token engine — milestone 1.
 *
 * Participates on the token ring without sole-master token generation:
 * - Responds to Poll For Master addressed to this station
 * - Accepts tokens addressed to this station
 * - Sends queued Who-Is only while holding the token
 * - Passes the token to the next master
 */

const MSTP_FRAME_TYPE = {
  TOKEN: 0x00,
  POLL_FOR_MASTER: 0x01,
  REPLY_TO_POLL_FOR_MASTER: 0x02,
};

const MSTP_STATE = {
  INITIALIZE: 'initialize',
  IDLE: 'idle',
  USE_TOKEN: 'use-token',
  PASS_TOKEN: 'pass-token',
  DUPLICATE_TOKEN: 'duplicate-token',
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

class MstpTokenEngine {
  /**
   * @param {object} options
   * @param {number} options.macAddress - This_Station (0-127)
   * @param {number} options.maxMaster - Max_Master
   * @param {number} options.maxInfoFrames - Max_Info_Frames
   * @param {number} options.baudRate
   * @param {(frameType:number, dest:number, src:number, data?:Buffer) => Buffer} options.buildFrame
   * @param {(level:string, message:string, extra?:object) => void} [options.onLog]
   * @param {(from:string, to:string, extra?:object) => void} [options.onStateChange]
   */
  constructor(options) {
    this.macAddress = options.macAddress;
    this.maxMaster = options.maxMaster;
    this.maxInfoFrames = Math.max(1, options.maxInfoFrames || 1);
    this.baudRate = options.baudRate || 38400;
    this.buildFrame = options.buildFrame;
    this.onLog = options.onLog || (() => {});
    this.onStateChange = options.onStateChange || (() => {});

    this.tSlot = tSlotMsForBaud(this.baudRate);
    this.tUsage = 35 * this.tSlot;
    this.tTurnaround = turnaroundMsForBaud(this.baudRate);

    this.state = MSTP_STATE.INITIALIZE;
    this.nextStation = incrementMasterMac(this.macAddress, this.maxMaster);
    this.pollStation = this.nextStation;
    this.frameCount = 0;
    this.tokenCount = 0;
    this.holdingToken = false;
    this.seenRingActivity = false;
    this.tokenReceivedAt = null;
    this.lastSilenceAt = 0;
    this.lastStateChangeAt = Date.now();

    this.whoIsQueue = [];
    this.pendingPassToken = false;

    this.stats = {
      tokensReceived: 0,
      tokensPassed: 0,
      pollForMasterReceived: 0,
      pollForMasterReplied: 0,
      whoIsSentWhileHoldingToken: 0,
      duplicateTokens: 0,
      ringTokensObserved: 0,
    };

    this._transition(MSTP_STATE.IDLE, 'engine started — listening on token ring');
  }

  getSnapshot() {
    return {
      state: this.state,
      holdingToken: this.holdingToken,
      macAddress: this.macAddress,
      nextStation: this.nextStation,
      pollStation: this.pollStation,
      seenRingActivity: this.seenRingActivity,
      whoIsQueued: this.whoIsQueue.length,
      stats: { ...this.stats },
      timings: {
        tSlotMs: this.tSlot,
        tUsageMs: this.tUsage,
        turnaroundMs: this.tTurnaround,
      },
    };
  }

  queueWhoIsFrame(mstpFrame) {
    if (!mstpFrame || !mstpFrame.length) return;
    this.whoIsQueue.push(Buffer.from(mstpFrame));
    this.onLog('debug', `Who-Is queued for token-gated send (${this.whoIsQueue.length} in queue)`);
  }

  /**
   * Process a parsed MS/TP frame from the bus.
   * @param {object} frame
   * @returns {Buffer|null} Reply To Poll For Master frame when addressed to this station.
   */
  handleReceivedFrame(frame) {
    if (!frame?.headerCrcValid) return null;

    this.lastSilenceAt = Date.now();

    if (frame.frameType === MSTP_FRAME_TYPE.TOKEN && frame.dataLength === 0) {
      this.seenRingActivity = true;
      this.stats.ringTokensObserved += 1;

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
      this.seenRingActivity = true;
      if (frame.destination === this.macAddress) {
        return this._onPollForMaster(frame);
      }
      return null;
    }

    if (frame.frameType === MSTP_FRAME_TYPE.REPLY_TO_POLL_FOR_MASTER && frame.dataLength === 0) {
      this.seenRingActivity = true;
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
    if (!this._turnaroundElapsed(nowMs)) {
      return null;
    }

    if (this.pendingPassToken) {
      this.pendingPassToken = false;
      return this._emitPassToken();
    }

    if (this.state === MSTP_STATE.USE_TOKEN && this.holdingToken) {
      if (nowMs - this.tokenReceivedAt >= this.tUsage) {
        this.onLog('info', `Tusage (${this.tUsage.toFixed(1)}ms) elapsed — passing token`);
        return this._emitPassToken();
      }

      if (this.frameCount < this.maxInfoFrames && this.whoIsQueue.length > 0) {
        const whoIsFrame = this.whoIsQueue.shift();
        this.frameCount += 1;
        this.stats.whoIsSentWhileHoldingToken += 1;
        this.onLog('info', `Who-Is sent while holding token (frame ${this.frameCount}/${this.maxInfoFrames})`, {
          macAddress: this.macAddress,
          frameBytes: whoIsFrame.length,
        });
        if (this.frameCount >= this.maxInfoFrames || this.whoIsQueue.length === 0) {
          this.pendingPassToken = true;
        }
        return whoIsFrame;
      }

      if (this.whoIsQueue.length === 0) {
        this.onLog('debug', 'Token held with empty Who-Is queue — passing token');
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

  _turnaroundElapsed(nowMs) {
    return nowMs >= this.lastSilenceAt + this.tTurnaround;
  }

  _onTokenForUs(frame) {
    this.stats.tokensReceived += 1;
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
    this._transition(MSTP_STATE.USE_TOKEN, 'token accepted — may send queued Who-Is');
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
    if (this.state === MSTP_STATE.PASS_TOKEN) {
      return null;
    }

    const dest = this.nextStation;
    const tokenFrame = this.buildFrame(
      MSTP_FRAME_TYPE.TOKEN,
      dest,
      this.macAddress,
    );

    this.tokenCount += 1;
    this.stats.tokensPassed += 1;
    this.nextStation = incrementMasterMac(this.nextStation, this.maxMaster);
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
  tSlotMsForBaud,
  turnaroundMsForBaud,
};
