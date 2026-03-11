import { makeId } from "../utils/id.mjs";

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

export function registerDevice(store, payload) {
  const deviceId = requireString(payload.deviceId, "deviceId");
  const platform = typeof payload.platform === "string" ? payload.platform : "unknown";
  const appVersion = typeof payload.appVersion === "string" ? payload.appVersion : "unknown";
  const capabilities = payload.capabilities && typeof payload.capabilities === "object"
    ? payload.capabilities
    : {};

  const existing = store.devices.get(deviceId);
  const base = existing || {
    deviceId,
    createdAt: now(),
    deviceToken: makeId("devtok"),
  };

  const updated = {
    ...base,
    platform,
    appVersion,
    capabilities,
    status: "online",
    lastSeenAt: now(),
    updatedAt: now(),
  };

  store.devices.set(deviceId, updated);
  return updated;
}

export function heartbeatDevice(store, payload) {
  const deviceId = requireString(payload.deviceId, "deviceId");
  const device = store.devices.get(deviceId);
  if (!device) {
    const error = new Error("device not found");
    error.code = "NOT_FOUND";
    throw error;
  }

  device.lastSeenAt = now();
  device.updatedAt = now();
  device.status = "online";
  return device;
}

export function getDeviceStatus(store, deviceId) {
  const normalized = requireString(deviceId, "deviceId");
  const device = store.devices.get(normalized);
  if (!device) {
    const error = new Error("device not found");
    error.code = "NOT_FOUND";
    throw error;
  }

  const onlineThresholdMs = 90 * 1000;
  const isOnline = now() - device.lastSeenAt <= onlineThresholdMs;

  return {
    deviceId: device.deviceId,
    platform: device.platform,
    appVersion: device.appVersion,
    status: isOnline ? "online" : "offline",
    lastSeenAt: device.lastSeenAt,
    updatedAt: device.updatedAt,
  };
}
