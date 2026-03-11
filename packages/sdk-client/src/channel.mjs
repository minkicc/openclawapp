export class MessageChannelClient {
  constructor(name) {
    this.name = name;
    this.onMessage = null;
    this.onClose = null;
  }

  // To be implemented by real transports (WebRTC DataChannel / WSS relay)
  async send(_envelope) {
    throw new Error(`${this.name} send() not implemented`);
  }

  async close() {
    if (typeof this.onClose === "function") {
      this.onClose();
    }
  }
}

export class RelayChannelClient extends MessageChannelClient {
  constructor(wsLike) {
    super("relay");
    this.wsLike = wsLike;
  }

  async send(envelope) {
    this.wsLike.send(JSON.stringify(envelope));
  }
}

export class P2PChannelClient extends MessageChannelClient {
  constructor(dataChannelLike) {
    super("p2p");
    this.dataChannelLike = dataChannelLike;
  }

  async send(envelope) {
    this.dataChannelLike.send(JSON.stringify(envelope));
  }
}
