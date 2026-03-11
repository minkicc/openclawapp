import { noContent, json, readJsonBody, sseHeaders } from "./http.mjs";
import { store } from "./store/memory-store.mjs";
import { getPersistenceStatus, schedulePersist } from "./store/persistence.mjs";
import {
  getDeviceStatus,
  heartbeatDevice,
  registerDevice,
} from "./services/device-service.mjs";
import {
  claimPairByCode,
  claimPairByToken,
  createPairSession,
  listBindings,
  revokePair,
} from "./services/pairing-service.mjs";
import {
  enqueueSignalEvent,
  openSignalStream,
  pullSignalInbox,
  sendSignal,
} from "./services/signaling-service.mjs";

function routeError(res, error) {
  if (error.code === "INVALID_JSON") {
    json(res, 400, { ok: false, code: error.code, message: error.message });
    return;
  }
  if (error.code === "BODY_TOO_LARGE") {
    json(res, 413, { ok: false, code: error.code, message: error.message });
    return;
  }
  if (error.code === "VALIDATION_ERROR") {
    json(res, 400, { ok: false, code: error.code, message: error.message });
    return;
  }
  if (error.code === "NOT_FOUND") {
    json(res, 404, { ok: false, code: error.code, message: error.message });
    return;
  }
  if (error.code === "EXPIRED") {
    json(res, 410, { ok: false, code: error.code, message: error.message });
    return;
  }
  if (error.code === "INVALID_STATE") {
    json(res, 409, { ok: false, code: error.code, message: error.message });
    return;
  }
  console.error(error);
  json(res, 500, { ok: false, code: "INTERNAL_ERROR", message: "internal error" });
}

function notFound(res) {
  json(res, 404, {
    ok: false,
    code: "NOT_FOUND",
    message: "Route not found",
  });
}

function parseClientType(value) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    const error = new Error("clientType is required");
    error.code = "VALIDATION_ERROR";
    throw error;
  }
  return normalized;
}

function parseClientId(value) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    const error = new Error("clientId is required");
    error.code = "VALIDATION_ERROR";
    throw error;
  }
  return normalized;
}

async function handleRoute(req, res) {
  const url = new URL(req.url, "http://localhost");
  const method = req.method ?? "GET";

  if (method === "OPTIONS") {
    noContent(res, 204);
    return;
  }

  if (method === "GET" && url.pathname === "/healthz") {
    json(res, 200, {
      ok: true,
      service: "openclaw-server",
      now: Date.now(),
      stats: {
        devices: store.devices.size,
        pairSessions: store.pairSessions.size,
        bindings: store.bindings.size,
      },
      persistence: getPersistenceStatus(),
    });
    return;
  }

  if (method === "POST" && url.pathname === "/v1/devices/register") {
    const payload = await readJsonBody(req);
    const device = registerDevice(store, payload);
    schedulePersist();
    json(res, 200, { ok: true, device });
    return;
  }

  if (method === "POST" && url.pathname === "/v1/devices/heartbeat") {
    const payload = await readJsonBody(req);
    const device = heartbeatDevice(store, payload);
    schedulePersist();
    json(res, 200, { ok: true, device });
    return;
  }

  const deviceStatusMatch = url.pathname.match(/^\/v1\/devices\/([^/]+)\/status$/);
  if (method === "GET" && deviceStatusMatch) {
    const status = getDeviceStatus(store, decodeURIComponent(deviceStatusMatch[1]));
    json(res, 200, { ok: true, status });
    return;
  }

  if (method === "POST" && url.pathname === "/v1/pair/sessions") {
    const payload = await readJsonBody(req);
    const session = createPairSession(store, payload);
    schedulePersist();
    json(res, 200, { ok: true, session });
    return;
  }

  if (method === "POST" && url.pathname === "/v1/pair/claim") {
    const payload = await readJsonBody(req);
    const result = claimPairByToken(store, payload);
    enqueueSignalEvent(store, "desktop", result.binding.deviceId, {
      id: `evt_pair_claim_${Date.now()}`,
      type: "pair.claimed",
      ts: Date.now(),
      payload: {
        bindingId: result.binding.bindingId,
        userId: result.binding.userId,
        mobileId: result.binding.mobileId,
      },
    });
    schedulePersist();
    json(res, 200, { ok: true, ...result });
    return;
  }

  if (method === "POST" && url.pathname === "/v1/pair/claim-by-code") {
    const payload = await readJsonBody(req);
    const result = claimPairByCode(store, payload);
    enqueueSignalEvent(store, "desktop", result.binding.deviceId, {
      id: `evt_pair_claim_${Date.now()}`,
      type: "pair.claimed",
      ts: Date.now(),
      payload: {
        bindingId: result.binding.bindingId,
        userId: result.binding.userId,
        mobileId: result.binding.mobileId,
      },
    });
    schedulePersist();
    json(res, 200, { ok: true, ...result });
    return;
  }

  if (method === "POST" && url.pathname === "/v1/pair/revoke") {
    const payload = await readJsonBody(req);
    const binding = revokePair(store, payload);
    schedulePersist();
    json(res, 200, { ok: true, binding });
    return;
  }

  if (method === "GET" && url.pathname === "/v1/pair/bindings") {
    const bindings = listBindings(store, {
      userId: url.searchParams.get("userId") || "",
      deviceId: url.searchParams.get("deviceId") || "",
      includeRevoked: url.searchParams.get("includeRevoked") || "",
    });
    json(res, 200, { ok: true, bindings });
    return;
  }

  if (method === "POST" && url.pathname === "/v1/signal/send") {
    const payload = await readJsonBody(req);
    const result = sendSignal(store, payload);
    schedulePersist();
    json(res, 200, { ok: true, ...result });
    return;
  }

  if (method === "GET" && url.pathname === "/v1/signal/inbox") {
    const clientType = parseClientType(url.searchParams.get("clientType"));
    const clientId = parseClientId(url.searchParams.get("clientId"));
    const limit = Number(url.searchParams.get("limit") || "100");
    const events = pullSignalInbox(store, clientType, clientId, limit);
    schedulePersist();
    json(res, 200, { ok: true, events });
    return;
  }

  if (method === "GET" && url.pathname === "/v1/signal/stream") {
    const clientType = parseClientType(url.searchParams.get("clientType"));
    const clientId = parseClientId(url.searchParams.get("clientId"));

    res.writeHead(200, sseHeaders());
    const cleanup = openSignalStream(store, clientType, clientId, res);
    schedulePersist();

    const heartbeat = setInterval(() => {
      try {
        res.write(`event: ping\ndata: {"ts":${Date.now()}}\n\n`);
      } catch {
        clearInterval(heartbeat);
        cleanup();
      }
    }, 20000);

    req.on("close", () => {
      clearInterval(heartbeat);
      cleanup();
    });

    return;
  }

  if (method === "GET" && (url.pathname === "/ws/desktop" || url.pathname === "/ws/mobile")) {
    json(res, 501, {
      ok: false,
      code: "WS_NOT_ENABLED",
      message: "WebSocket endpoint is reserved. Use /v1/signal/stream and /v1/signal/send during scaffold stage.",
    });
    return;
  }

  notFound(res);
}

export async function routeRequest(req, res) {
  try {
    await handleRoute(req, res);
  } catch (error) {
    routeError(res, error);
  }
}
