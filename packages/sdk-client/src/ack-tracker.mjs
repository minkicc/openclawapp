export class AckTracker {
  constructor(timeoutMs = 15000) {
    this.timeoutMs = timeoutMs;
    this.pending = new Map();
  }

  waitAck(messageId) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(messageId);
        reject(new Error(`ACK timeout for message ${messageId}`));
      }, this.timeoutMs);

      this.pending.set(messageId, {
        resolve,
        reject,
        timer,
      });
    });
  }

  ack(messageId, payload = null) {
    const item = this.pending.get(messageId);
    if (!item) {
      return false;
    }

    clearTimeout(item.timer);
    this.pending.delete(messageId);
    item.resolve(payload);
    return true;
  }

  clearAll(reason = "ACK tracker cleared") {
    for (const [messageId, item] of this.pending.entries()) {
      clearTimeout(item.timer);
      item.reject(new Error(`${reason}: ${messageId}`));
      this.pending.delete(messageId);
    }
  }
}
