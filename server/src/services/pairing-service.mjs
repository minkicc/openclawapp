import { makeId, makePairCode, makePairToken } from "../utils/id.mjs";

function now() {
  return Date.now();
}

function requireString(value, name) {
  if (typeof value !== "string" || value.trim() === "") {
    const error = new Error(`${name} is required`);
    error.code = "VALIDATION_ERROR";
    throw error;
  }
  return value.trim();
}

function getActiveBinding(store, userId, deviceId) {
  for (const binding of store.bindings.values()) {
    if (binding.status === "active" && binding.userId === userId && binding.deviceId === deviceId) {
      return binding;
    }
  }
  return null;
}

function serializePairSession(session) {
  return {
    pairSessionId: session.pairSessionId,
    deviceId: session.deviceId,
    pairCode: session.pairCode,
    pairToken: session.pairToken,
    status: session.status,
    createdAt: session.createdAt,
    expiresAt: session.expiresAt,
    claimedAt: session.claimedAt,
    claimedByUserId: session.claimedByUserId,
    claimedByMobileId: session.claimedByMobileId,
  };
}

function serializeBinding(binding) {
  return {
    bindingId: binding.bindingId,
    userId: binding.userId,
    deviceId: binding.deviceId,
    mobileId: binding.mobileId,
    status: binding.status,
    createdAt: binding.createdAt,
    updatedAt: binding.updatedAt,
  };
}

function getSessionByToken(store, pairToken) {
  const sessionId = store.pairTokenIndex.get(pairToken);
  return sessionId ? store.pairSessions.get(sessionId) : null;
}

function getSessionByCode(store, pairCode) {
  const sessionId = store.pairCodeIndex.get(pairCode);
  return sessionId ? store.pairSessions.get(sessionId) : null;
}

function assertSessionClaimable(session) {
  if (!session) {
    const error = new Error("pair session not found");
    error.code = "NOT_FOUND";
    throw error;
  }
  if (session.status !== "pending") {
    const error = new Error("pair session is not claimable");
    error.code = "INVALID_STATE";
    throw error;
  }
  if (session.expiresAt < now()) {
    session.status = "expired";
    const error = new Error("pair session expired");
    error.code = "EXPIRED";
    throw error;
  }
}

function finalizeClaim(store, session, payload) {
  const userId = requireString(payload.userId, "userId");
  const mobileId = typeof payload.mobileId === "string" && payload.mobileId.trim() !== ""
    ? payload.mobileId.trim()
    : "mobile_unknown";

  let binding = getActiveBinding(store, userId, session.deviceId);
  if (!binding) {
    binding = {
      bindingId: makeId("bind"),
      userId,
      deviceId: session.deviceId,
      mobileId,
      status: "active",
      createdAt: now(),
      updatedAt: now(),
    };
    store.bindings.set(binding.bindingId, binding);
  } else {
    binding.mobileId = mobileId;
    binding.updatedAt = now();
  }

  session.status = "claimed";
  session.claimedAt = now();
  session.claimedByUserId = userId;
  session.claimedByMobileId = mobileId;

  return {
    session: serializePairSession(session),
    binding: serializeBinding(binding),
  };
}

export function createPairSession(store, payload) {
  const deviceId = requireString(payload.deviceId, "deviceId");
  const device = store.devices.get(deviceId);
  if (!device) {
    const error = new Error("device not registered");
    error.code = "NOT_FOUND";
    throw error;
  }

  const requestedTtl = Number(payload.ttlSeconds || 180);
  const ttlSeconds = Number.isFinite(requestedTtl)
    ? Math.max(60, Math.min(600, Math.floor(requestedTtl)))
    : 180;

  const pairSessionId = makeId("ps");
  const pairToken = makePairToken();
  let pairCode = makePairCode();
  while (store.pairCodeIndex.has(pairCode)) {
    pairCode = makePairCode();
  }

  const session = {
    pairSessionId,
    deviceId,
    pairToken,
    pairCode,
    status: "pending",
    createdAt: now(),
    expiresAt: now() + ttlSeconds * 1000,
    claimedAt: null,
    claimedByUserId: null,
    claimedByMobileId: null,
  };

  store.pairSessions.set(pairSessionId, session);
  store.pairTokenIndex.set(pairToken, pairSessionId);
  store.pairCodeIndex.set(pairCode, pairSessionId);

  return serializePairSession(session);
}

export function claimPairByToken(store, payload) {
  const pairToken = requireString(payload.pairToken, "pairToken");
  const session = getSessionByToken(store, pairToken);
  assertSessionClaimable(session);
  return finalizeClaim(store, session, payload);
}

export function claimPairByCode(store, payload) {
  const pairCode = requireString(payload.pairCode, "pairCode");
  const session = getSessionByCode(store, pairCode);
  assertSessionClaimable(session);
  return finalizeClaim(store, session, payload);
}

export function revokePair(store, payload) {
  const bindingId = typeof payload.bindingId === "string" ? payload.bindingId.trim() : "";
  const userId = typeof payload.userId === "string" ? payload.userId.trim() : "";
  const deviceId = typeof payload.deviceId === "string" ? payload.deviceId.trim() : "";

  let binding = null;
  if (bindingId) {
    binding = store.bindings.get(bindingId) || null;
  } else if (userId && deviceId) {
    binding = getActiveBinding(store, userId, deviceId);
  }

  if (!binding) {
    const error = new Error("binding not found");
    error.code = "NOT_FOUND";
    throw error;
  }

  binding.status = "revoked";
  binding.updatedAt = now();
  return serializeBinding(binding);
}

export function listBindings(store, query = {}) {
  const userId = typeof query.userId === "string" ? query.userId.trim() : "";
  const deviceId = typeof query.deviceId === "string" ? query.deviceId.trim() : "";
  const includeRevoked = query.includeRevoked === "true";

  const result = [];
  for (const binding of store.bindings.values()) {
    if (!includeRevoked && binding.status !== "active") {
      continue;
    }
    if (userId && binding.userId !== userId) {
      continue;
    }
    if (deviceId && binding.deviceId !== deviceId) {
      continue;
    }
    result.push(serializeBinding(binding));
  }

  return result;
}
