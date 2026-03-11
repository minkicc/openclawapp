// @ts-nocheck
import { randomBytes, randomUUID } from "node:crypto";
import { DEFAULT_PAIR_TTL_SECONDS, PAIR_STATUS } from "@openclaw/protocol";

function nowIso() {
  return new Date().toISOString();
}

function toEpochMillis(iso) {
  return new Date(iso).getTime();
}

function randomToken(size = 16) {
  return randomBytes(size).toString("hex");
}

export class MemoryStore {
  constructor({ pairTtlSeconds = DEFAULT_PAIR_TTL_SECONDS } = {}) {
    this.pairTtlSeconds = pairTtlSeconds;
    this.pairSessions = new Map();
    this.bindingsByDevice = new Map();
    this.devicesByUser = new Map();
    this.pcSocketsByDevice = new Map();
    this.mobileSocketsByUser = new Map();
  }

  hydrate(snapshot = {}) {
    this.pairSessions.clear();
    this.bindingsByDevice.clear();
    this.devicesByUser.clear();

    const pairSessions = Array.isArray(snapshot.pair_sessions) ? snapshot.pair_sessions : [];
    for (const item of pairSessions) {
      if (!item || typeof item !== "object") {
        continue;
      }
      const sessionId = asNonEmptyString(item.session_id);
      if (!sessionId) {
        continue;
      }
      const session = {
        session_id: sessionId,
        pair_code: asNonEmptyString(item.pair_code) || randomToken(6),
        device_id: asNonEmptyString(item.device_id) || `pc_${randomToken(4)}`,
        device_name: asNonEmptyString(item.device_name) || "OpenClaw PC",
        created_at: asNonEmptyString(item.created_at) || nowIso(),
        expires_at: asNonEmptyString(item.expires_at) || nowIso(),
        status: asNonEmptyString(item.status) || PAIR_STATUS.PENDING,
        claimed_by_user_id: asOptionalString(item.claimed_by_user_id),
        claimed_at: asOptionalString(item.claimed_at),
        revoked_at: asOptionalString(item.revoked_at)
      };
      this.pairSessions.set(sessionId, session);
    }

    const bindings = Array.isArray(snapshot.bindings) ? snapshot.bindings : [];
    for (const item of bindings) {
      if (!item || typeof item !== "object") {
        continue;
      }
      const deviceId = asNonEmptyString(item.device_id);
      const userId = asNonEmptyString(item.user_id);
      if (!deviceId || !userId) {
        continue;
      }
      const binding = {
        device_id: deviceId,
        user_id: userId,
        bound_at: asNonEmptyString(item.bound_at) || nowIso(),
        revoked_at: asOptionalString(item.revoked_at)
      };
      this.bindingsByDevice.set(deviceId, binding);
      const userSet = this.devicesByUser.get(userId) || new Set();
      userSet.add(deviceId);
      this.devicesByUser.set(userId, userSet);
    }
  }

  exportSnapshot() {
    return {
      pair_sessions: [...this.pairSessions.values()],
      bindings: [...this.bindingsByDevice.values()]
    };
  }

  createPairSession({ deviceId, deviceName = "OpenClaw PC", ttlSeconds } = {}) {
    const sessionId = randomUUID();
    const pairCode = randomToken(6);
    const now = Date.now();
    const ttl = Math.max(30, Number(ttlSeconds) || this.pairTtlSeconds);
    const expiresAt = new Date(now + ttl * 1000).toISOString();

    const record = {
      session_id: sessionId,
      pair_code: pairCode,
      device_id: deviceId || `pc_${randomToken(4)}`,
      device_name: deviceName,
      created_at: new Date(now).toISOString(),
      expires_at: expiresAt,
      status: PAIR_STATUS.PENDING,
      claimed_by_user_id: null,
      claimed_at: null,
      revoked_at: null
    };

    this.pairSessions.set(sessionId, record);
    return record;
  }

  getPairSession(sessionId) {
    const session = this.pairSessions.get(sessionId) || null;
    if (!session) {
      return null;
    }

    if (session.status === PAIR_STATUS.PENDING && Date.now() > toEpochMillis(session.expires_at)) {
      session.status = PAIR_STATUS.EXPIRED;
    }

    return session;
  }

  claimPairSession({ sessionId, pairCode, userId }) {
    const session = this.getPairSession(sessionId);
    if (!session) {
      return { ok: false, reason: "not_found", message: "Pair session not found" };
    }

    if (session.status === PAIR_STATUS.EXPIRED) {
      return { ok: false, reason: "expired", message: "Pair session has expired" };
    }

    if (session.status === PAIR_STATUS.REVOKED) {
      return { ok: false, reason: "revoked", message: "Pair session has been revoked" };
    }

    if (session.status === PAIR_STATUS.CLAIMED) {
      return { ok: false, reason: "claimed", message: "Pair session already claimed" };
    }

    if (session.pair_code !== pairCode) {
      return { ok: false, reason: "invalid_code", message: "Invalid pair code" };
    }

    session.status = PAIR_STATUS.CLAIMED;
    session.claimed_by_user_id = userId;
    session.claimed_at = nowIso();

    this.bindDeviceToUser({ deviceId: session.device_id, userId });
    return { ok: true, session };
  }

  bindDeviceToUser({ deviceId, userId }) {
    const binding = {
      device_id: deviceId,
      user_id: userId,
      bound_at: nowIso(),
      revoked_at: null
    };
    this.bindingsByDevice.set(deviceId, binding);

    const userSet = this.devicesByUser.get(userId) || new Set();
    userSet.add(deviceId);
    this.devicesByUser.set(userId, userSet);
    return binding;
  }

  revokeDevice({ deviceId, requestedByUserId = null }) {
    const binding = this.bindingsByDevice.get(deviceId);
    if (!binding) {
      return { ok: false, reason: "not_found", message: "Device binding not found" };
    }

    if (requestedByUserId && binding.user_id !== requestedByUserId) {
      return { ok: false, reason: "forbidden", message: "Device does not belong to this user" };
    }

    binding.revoked_at = nowIso();
    this.bindingsByDevice.delete(deviceId);

    const userSet = this.devicesByUser.get(binding.user_id);
    if (userSet) {
      userSet.delete(deviceId);
      if (userSet.size === 0) {
        this.devicesByUser.delete(binding.user_id);
      }
    }

    for (const session of this.pairSessions.values()) {
      if (session.device_id === deviceId && session.status !== PAIR_STATUS.EXPIRED) {
        session.status = PAIR_STATUS.REVOKED;
        session.revoked_at = nowIso();
      }
    }

    return { ok: true, binding };
  }

  getBindingByDevice(deviceId) {
    return this.bindingsByDevice.get(deviceId) || null;
  }

  isDeviceBoundToUser({ deviceId, userId }) {
    const binding = this.bindingsByDevice.get(deviceId);
    return Boolean(binding && binding.user_id === userId);
  }

  listDevicesByUser(userId) {
    const set = this.devicesByUser.get(userId);
    if (!set) {
      return [];
    }
    return [...set];
  }

  cleanupExpiredPairSessions() {
    const now = Date.now();
    let changed = false;
    for (const session of this.pairSessions.values()) {
      if (session.status === PAIR_STATUS.PENDING && now > toEpochMillis(session.expires_at)) {
        session.status = PAIR_STATUS.EXPIRED;
        changed = true;
      }
    }
    return changed;
  }

  registerPcSocket(deviceId, ws) {
    const set = this.pcSocketsByDevice.get(deviceId) || new Set();
    set.add(ws);
    this.pcSocketsByDevice.set(deviceId, set);
  }

  registerMobileSocket(userId, ws) {
    const set = this.mobileSocketsByUser.get(userId) || new Set();
    set.add(ws);
    this.mobileSocketsByUser.set(userId, set);
  }

  unregisterPcSocket(deviceId, ws) {
    const set = this.pcSocketsByDevice.get(deviceId);
    if (!set) {
      return;
    }
    set.delete(ws);
    if (set.size === 0) {
      this.pcSocketsByDevice.delete(deviceId);
    }
  }

  unregisterMobileSocket(userId, ws) {
    const set = this.mobileSocketsByUser.get(userId);
    if (!set) {
      return;
    }
    set.delete(ws);
    if (set.size === 0) {
      this.mobileSocketsByUser.delete(userId);
    }
  }

  sendToPc(deviceId, message) {
    const set = this.pcSocketsByDevice.get(deviceId);
    if (!set || set.size === 0) {
      return 0;
    }
    return sendToSocketSet(set, message);
  }

  sendToMobile(userId, message) {
    const set = this.mobileSocketsByUser.get(userId);
    if (!set || set.size === 0) {
      return 0;
    }
    return sendToSocketSet(set, message);
  }

  getStats() {
    return {
      pair_sessions_total: this.pairSessions.size,
      pair_sessions_pending: countByStatus(this.pairSessions, PAIR_STATUS.PENDING),
      pair_sessions_claimed: countByStatus(this.pairSessions, PAIR_STATUS.CLAIMED),
      pair_sessions_expired: countByStatus(this.pairSessions, PAIR_STATUS.EXPIRED),
      pair_sessions_revoked: countByStatus(this.pairSessions, PAIR_STATUS.REVOKED),
      bound_devices_total: this.bindingsByDevice.size,
      users_with_devices: this.devicesByUser.size,
      pc_socket_groups: this.pcSocketsByDevice.size,
      mobile_socket_groups: this.mobileSocketsByUser.size
    };
  }
}

function countByStatus(pairSessions, status) {
  let count = 0;
  for (const session of pairSessions.values()) {
    if (session.status === status) {
      count += 1;
    }
  }
  return count;
}

function sendToSocketSet(set, message) {
  const payload = JSON.stringify(message);
  let delivered = 0;

  for (const ws of set) {
    if (ws.readyState !== ws.OPEN) {
      continue;
    }
    ws.send(payload);
    delivered += 1;
  }
  return delivered;
}

function asNonEmptyString(value) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed || null;
}

function asOptionalString(value) {
  return asNonEmptyString(value);
}
