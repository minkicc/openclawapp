import { clientKey } from "../store/memory-store.mjs";
import { makeId } from "../utils/id.mjs";

function now() {
  return Date.now();
}

function ensureQueue(store, key) {
  let queue = store.signalQueues.get(key);
  if (!queue) {
    queue = [];
    store.signalQueues.set(key, queue);
  }
  return queue;
}

function ensureStreams(store, key) {
  let set = store.signalStreams.get(key);
  if (!set) {
    set = new Set();
    store.signalStreams.set(key, set);
  }
  return set;
}

function writeSse(res, event) {
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

export function openSignalStream(store, clientType, clientId, res) {
  const key = clientKey(clientType, clientId);
  const streams = ensureStreams(store, key);
  streams.add(res);

  writeSse(res, {
    id: makeId("evt"),
    type: "stream.opened",
    ts: now(),
    payload: { clientType, clientId },
  });

  const queue = ensureQueue(store, key);
  while (queue.length > 0) {
    const event = queue.shift();
    writeSse(res, event);
  }

  return () => {
    const streamSet = store.signalStreams.get(key);
    if (!streamSet) return;
    streamSet.delete(res);
    if (streamSet.size === 0) {
      store.signalStreams.delete(key);
    }
  };
}

export function enqueueSignalEvent(store, targetType, targetId, event) {
  const key = clientKey(targetType, targetId);
  const streams = store.signalStreams.get(key);

  let deliveredRealtime = false;
  if (streams && streams.size > 0) {
    for (const res of [...streams]) {
      try {
        writeSse(res, event);
        deliveredRealtime = true;
      } catch {
        streams.delete(res);
      }
    }
  }

  if (!deliveredRealtime) {
    const queue = ensureQueue(store, key);
    queue.push(event);
  }

  return deliveredRealtime;
}

export function sendSignal(store, payload) {
  const fromType = String(payload.fromType || "").trim();
  const fromId = String(payload.fromId || "").trim();
  const toType = String(payload.toType || "").trim();
  const toId = String(payload.toId || "").trim();
  const type = String(payload.type || "signal.message").trim();

  if (!fromType || !fromId || !toType || !toId) {
    const error = new Error("fromType/fromId/toType/toId are required");
    error.code = "VALIDATION_ERROR";
    throw error;
  }

  const event = {
    id: makeId("evt"),
    type,
    ts: now(),
    from: {
      type: fromType,
      id: fromId,
    },
    to: {
      type: toType,
      id: toId,
    },
    payload: payload.payload && typeof payload.payload === "object" ? payload.payload : {},
  };

  const deliveredRealtime = enqueueSignalEvent(store, toType, toId, event);
  return {
    deliveredRealtime,
    event,
  };
}

export function pullSignalInbox(store, clientType, clientId, limit = 100) {
  const key = clientKey(clientType, clientId);
  const queue = ensureQueue(store, key);

  const safeLimit = Math.max(1, Math.min(Number(limit) || 100, 500));
  const events = queue.splice(0, safeLimit);
  return events;
}
