import {
  DESKTOP_PAIRING_STATES,
  DesktopPairingStateMachine,
} from "./state-machine.js";
import { createDesktopPairingApi } from "./api-client.js";

export class DesktopPairingController {
  constructor({ apiBaseUrl, deviceId, appVersion }) {
    this.deviceId = deviceId;
    this.appVersion = appVersion;
    this.api = createDesktopPairingApi({ baseUrl: apiBaseUrl });
    this.machine = new DesktopPairingStateMachine();
    this.stopStream = null;
  }

  get state() {
    return this.machine.state;
  }

  async boot() {
    const result = await this.api.registerDevice({
      deviceId: this.deviceId,
      platform: "desktop",
      appVersion: this.appVersion || "0.0.0",
    });
    this.machine.dispatch("REGISTERED", { device: result.device });
    return result.device;
  }

  async startPairing(ttlSeconds = 180) {
    this.machine.dispatch("CREATE_PAIR_SESSION");
    const result = await this.api.createPairSession({
      deviceId: this.deviceId,
      ttlSeconds,
    });
    this.machine.dispatch("PAIR_SESSION_CREATED", { session: result.session });
    this.machine.dispatch("WAIT_FOR_CLAIM");
    return result.session;
  }

  async subscribeSignals(onEvent, onError) {
    if (this.stopStream) {
      this.stopStream();
    }

    this.stopStream = await this.api.openSignalStream(
      "desktop",
      this.deviceId,
      (event) => {
        if (event.type === "pair.claimed") {
          this.machine.dispatch("CLAIMED", { event });
        }
        if (onEvent) {
          onEvent(event, this.machine.state);
        }
      },
      onError
    );

    return this.stopStream;
  }

  async connectP2PFailedFallback() {
    if (this.machine.state !== DESKTOP_PAIRING_STATES.PAIRED) {
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
