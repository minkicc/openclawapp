import {
  MOBILE_PAIRING_STATES,
  MobilePairingStateMachine,
} from "./state-machine.js";
import { createMobilePairingApi } from "./api-client.js";

export class MobilePairingController {
  constructor({ apiBaseUrl, userId, mobileId }) {
    this.userId = userId;
    this.mobileId = mobileId;
    this.api = createMobilePairingApi({ baseUrl: apiBaseUrl });
    this.machine = new MobilePairingStateMachine(MOBILE_PAIRING_STATES.READY);
    this.stopStream = null;
  }

  get state() {
    return this.machine.state;
  }

  async claimByQrToken(pairToken) {
    this.machine.dispatch("SCAN_QR");
    this.machine.dispatch("QR_PARSED");
    const result = await this.api.claimByToken({
      pairToken,
      userId: this.userId,
      mobileId: this.mobileId,
    });
    this.machine.dispatch("CLAIM_SUCCESS", { result });
    return result;
  }

  async claimByPairCode(pairCode) {
    this.machine.dispatch("ENTER_CODE");
    this.machine.dispatch("CODE_SUBMIT");
    const result = await this.api.claimByCode({
      pairCode,
      userId: this.userId,
      mobileId: this.mobileId,
    });
    this.machine.dispatch("CLAIM_SUCCESS", { result });
    return result;
  }

  async subscribeSignals(onEvent, onError) {
    if (this.stopStream) {
      this.stopStream();
    }

    this.stopStream = await this.api.openSignalStream(
      "mobile",
      this.mobileId,
      (event) => {
        if (onEvent) {
          onEvent(event, this.machine.state);
        }
      },
      onError
    );

    return this.stopStream;
  }

  async connectP2PFailedFallback() {
    if (this.machine.state !== MOBILE_PAIRING_STATES.BOUND) {
      return null;
    }
    this.machine.dispatch("CONNECT_P2P");
    this.machine.dispatch("P2P_FAILED");
    return this.machine.state;
  }

  dispose() {
    if (this.stopStream) {
      this.stopStream();
      this.stopStream = null;
    }
  }
}
