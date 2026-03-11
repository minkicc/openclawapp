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

export function serializeStoreSnapshot(store) {
  return {
    version: 1,
    savedAt: Date.now(),
    devices: Array.from(store.devices.entries()),
    pairSessions: Array.from(store.pairSessions.entries()),
    pairTokenIndex: Array.from(store.pairTokenIndex.entries()),
    pairCodeIndex: Array.from(store.pairCodeIndex.entries()),
    bindings: Array.from(store.bindings.entries()),
    signalQueues: Array.from(store.signalQueues.entries()),
  };
}

function restoreMap(target, entries) {
  target.clear();
  if (!Array.isArray(entries)) return;
  for (const pair of entries) {
    if (!Array.isArray(pair) || pair.length !== 2) continue;
    target.set(pair[0], pair[1]);
  }
}

export function hydrateStoreFromSnapshot(store, snapshot) {
  if (!snapshot || typeof snapshot !== "object") {
    return;
  }

  restoreMap(store.devices, snapshot.devices);
  restoreMap(store.pairSessions, snapshot.pairSessions);
  restoreMap(store.pairTokenIndex, snapshot.pairTokenIndex);
  restoreMap(store.pairCodeIndex, snapshot.pairCodeIndex);
  restoreMap(store.bindings, snapshot.bindings);
  restoreMap(store.signalQueues, snapshot.signalQueues);
  store.signalStreams.clear();
}

export const store = createMemoryStore();
