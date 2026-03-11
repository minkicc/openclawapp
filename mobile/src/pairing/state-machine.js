export const MOBILE_PAIRING_STATES = {
  SIGNED_OUT: "signed_out",
  READY: "ready",
  SCANNING_QR: "scanning_qr",
  ENTERING_CODE: "entering_code",
  CLAIMING: "claiming",
  BOUND: "bound",
  CONNECTING_P2P: "connecting_p2p",
  CONNECTED_P2P: "connected_p2p",
  CONNECTED_RELAY: "connected_relay",
  ERROR: "error",
};

const transitions = {
  [MOBILE_PAIRING_STATES.SIGNED_OUT]: ["LOGIN"],
  [MOBILE_PAIRING_STATES.READY]: ["SCAN_QR", "ENTER_CODE"],
  [MOBILE_PAIRING_STATES.SCANNING_QR]: ["QR_PARSED", "CANCEL"],
  [MOBILE_PAIRING_STATES.ENTERING_CODE]: ["CODE_SUBMIT", "CANCEL"],
  [MOBILE_PAIRING_STATES.CLAIMING]: ["CLAIM_SUCCESS", "CLAIM_FAILED"],
  [MOBILE_PAIRING_STATES.BOUND]: ["CONNECT_P2P", "CONNECT_RELAY", "UNPAIR"],
  [MOBILE_PAIRING_STATES.CONNECTING_P2P]: ["P2P_CONNECTED", "P2P_FAILED"],
  [MOBILE_PAIRING_STATES.CONNECTED_P2P]: ["P2P_DISCONNECTED", "UNPAIR"],
  [MOBILE_PAIRING_STATES.CONNECTED_RELAY]: ["RELAY_DISCONNECTED", "UNPAIR"],
  [MOBILE_PAIRING_STATES.ERROR]: ["RESET"],
};

const nextStateMap = {
  LOGIN: MOBILE_PAIRING_STATES.READY,
  SCAN_QR: MOBILE_PAIRING_STATES.SCANNING_QR,
  ENTER_CODE: MOBILE_PAIRING_STATES.ENTERING_CODE,
  QR_PARSED: MOBILE_PAIRING_STATES.CLAIMING,
  CODE_SUBMIT: MOBILE_PAIRING_STATES.CLAIMING,
  CANCEL: MOBILE_PAIRING_STATES.READY,
  CLAIM_SUCCESS: MOBILE_PAIRING_STATES.BOUND,
  CLAIM_FAILED: MOBILE_PAIRING_STATES.ERROR,
  CONNECT_P2P: MOBILE_PAIRING_STATES.CONNECTING_P2P,
  P2P_CONNECTED: MOBILE_PAIRING_STATES.CONNECTED_P2P,
  P2P_FAILED: MOBILE_PAIRING_STATES.CONNECTED_RELAY,
  CONNECT_RELAY: MOBILE_PAIRING_STATES.CONNECTED_RELAY,
  P2P_DISCONNECTED: MOBILE_PAIRING_STATES.CONNECTED_RELAY,
  RELAY_DISCONNECTED: MOBILE_PAIRING_STATES.ERROR,
  UNPAIR: MOBILE_PAIRING_STATES.READY,
  RESET: MOBILE_PAIRING_STATES.READY,
};

export class MobilePairingStateMachine {
  constructor(initialState = MOBILE_PAIRING_STATES.SIGNED_OUT) {
    this.state = initialState;
    this.history = [];
  }

  can(event) {
    const allowed = transitions[this.state] || [];
    return allowed.includes(event);
  }

  dispatch(event, context = {}) {
    if (!this.can(event)) {
      return {
        ok: false,
        state: this.state,
        reason: `Invalid event ${event} for state ${this.state}`,
      };
    }

    const nextState = nextStateMap[event];
    this.history.push({
      from: this.state,
      event,
      to: nextState,
      context,
      at: Date.now(),
    });
    this.state = nextState;

    return {
      ok: true,
      state: this.state,
    };
  }
}
