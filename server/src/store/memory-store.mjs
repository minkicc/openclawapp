export function clientKey(clientType, clientId) {
  return `${clientType}:${clientId}`;
}

export function createMemoryStore() {
  return {
    devices: new Map(),
    pairSessions: new Map(),
    pairTokenIndex: new Map(),
    pairCodeIndex: new Map(),
    bindings: new Map(),
    signalQueues: new Map(),
    signalStreams: new Map(),
  };
}

export const store = createMemoryStore();
