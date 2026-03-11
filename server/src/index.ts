// @ts-nocheck
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { URL } from "node:url";
import {
  DEFAULT_PAIR_TTL_SECONDS,
  MESSAGE_TYPES,
  createEnvelope,
  parseEnvelope
} from "@openclaw/protocol";
import { MemoryStore } from "./store.js";
import { acceptWebSocket, rejectUpgrade } from "./ws.js";

const PORT = Number(process.env.PORT || 38089);
const HOST = process.env.HOST || "0.0.0.0";
const PAIR_TTL_SECONDS = Number(process.env.PAIR_TTL_SECONDS || DEFAULT_PAIR_TTL_SECONDS);
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || `http://127.0.0.1:${PORT}`;
const SERVER_TOKEN = (process.env.OPENCLAW_SERVER_TOKEN || "").trim();
const STORE_PATH = (process.env.STORE_PATH || "").trim();

const store = new MemoryStore({
  pairTtlSeconds: PAIR_TTL_SECONDS
});
loadStoreFromDisk();

const wsClients = new Set();

const server = http.createServer(async (req, res) => {
  try {
    withCors(res);
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url || "/", PUBLIC_BASE_URL);
    if (req.method === "GET" && url.pathname === "/health") {
      sendJson(res, 200, {
        ok: true,
        service: "openclaw-server-mvp",
        time: new Date().toISOString(),
        stats: store.getStats(),
        auth_required: Boolean(SERVER_TOKEN),
        persistence_path: STORE_PATH || null
      });
      return;
    }

    if (!ensureHttpAuthorized(req, res)) {
      return;
    }

    if (req.method === "POST" && url.pathname === "/pair/create") {
      const body = await readJsonBody(req);
      const deviceId = asOptionalString(body.device_id);
      const deviceName = asOptionalString(body.device_name) || "OpenClaw PC";
      const ttlSeconds = Number(body.ttl_seconds);

      const session = store.createPairSession({
        deviceId,
        deviceName,
        ttlSeconds
      });

      const qrPayload = {
        kind: "openclaw.pair",
        version: "v1",
        base_url: PUBLIC_BASE_URL,
        session_id: session.session_id,
        pair_code: session.pair_code,
        expires_at: session.expires_at
      };

      const delivered = store.sendToPc(
        session.device_id,
        createEnvelope({
          type: MESSAGE_TYPES.PAIR_READY,
          sessionId: session.session_id,
          deviceId: session.device_id,
          payload: {
            session_id: session.session_id,
            expires_at: session.expires_at
          }
        })
      );
      persistStoreToDisk();

      sendJson(res, 201, {
        ok: true,
        data: {
          session_id: session.session_id,
          pair_code: session.pair_code,
          device_id: session.device_id,
          device_name: session.device_name,
          status: session.status,
          created_at: session.created_at,
          expires_at: session.expires_at,
          qr_payload: qrPayload,
          ws_delivered: delivered
        }
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/pair/claim") {
      const body = await readJsonBody(req);
      const sessionId = asOptionalString(body.session_id);
      const pairCode = asOptionalString(body.pair_code);
      const userId = asOptionalString(body.user_id);

      if (!sessionId || !pairCode || !userId) {
        sendJson(res, 400, {
          ok: false,
          error: "Missing required fields: session_id, pair_code, user_id"
        });
        return;
      }

      const result = store.claimPairSession({
        sessionId,
        pairCode,
        userId
      });

      if (!result.ok) {
        sendJson(res, claimFailureStatusCode(result.reason), {
          ok: false,
          error: result.message,
          reason: result.reason
        });
        return;
      }

      const { session } = result;
      const binding = store.getBindingByDevice(session.device_id);
      const event = createEnvelope({
        type: MESSAGE_TYPES.PAIR_CLAIMED,
        sessionId: session.session_id,
        deviceId: session.device_id,
        userId: userId,
        targetDeviceId: session.device_id,
        payload: {
          session_id: session.session_id,
          device_id: session.device_id,
          user_id: userId,
          claimed_at: session.claimed_at
        }
      });

      const deliveredToPc = store.sendToPc(session.device_id, event);
      const deliveredToMobile = store.sendToMobile(userId, event);
      persistStoreToDisk();

      sendJson(res, 200, {
        ok: true,
        data: {
          session_id: session.session_id,
          status: session.status,
          device_id: session.device_id,
          user_id: userId,
          claimed_at: session.claimed_at,
          binding,
          ws_delivered_to_pc: deliveredToPc,
          ws_delivered_to_mobile: deliveredToMobile
        }
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/pair/status") {
      const sessionId = asOptionalString(url.searchParams.get("session_id"));
      if (!sessionId) {
        sendJson(res, 400, {
          ok: false,
          error: "Missing query field: session_id"
        });
        return;
      }

      const session = store.getPairSession(sessionId);
      if (!session) {
        sendJson(res, 404, {
          ok: false,
          error: "Pair session not found"
        });
        return;
      }

      const expiresAtMs = Date.parse(session.expires_at);
      const ttlRemainingSec = Math.max(0, Math.floor((expiresAtMs - Date.now()) / 1000));
      sendJson(res, 200, {
        ok: true,
        data: {
          session_id: session.session_id,
          status: session.status,
          device_id: session.device_id,
          user_id: session.claimed_by_user_id,
          created_at: session.created_at,
          expires_at: session.expires_at,
          ttl_remaining_seconds: ttlRemainingSec
        }
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/pair/revoke") {
      const body = await readJsonBody(req);
      const deviceId = asOptionalString(body.device_id);
      const userId = asOptionalString(body.user_id);

      if (!deviceId) {
        sendJson(res, 400, {
          ok: false,
          error: "Missing required field: device_id"
        });
        return;
      }

      const result = store.revokeDevice({
        deviceId,
        requestedByUserId: userId
      });

      if (!result.ok) {
        const statusCode = result.reason === "forbidden" ? 403 : 404;
        sendJson(res, statusCode, {
          ok: false,
          error: result.message,
          reason: result.reason
        });
        return;
      }

      const event = createEnvelope({
        type: MESSAGE_TYPES.PAIR_REVOKED,
        deviceId,
        userId: result.binding.user_id,
        targetDeviceId: deviceId,
        targetUserId: result.binding.user_id,
        payload: {
          device_id: deviceId,
          revoked_at: result.binding.revoked_at
        }
      });

      const toPc = store.sendToPc(deviceId, event);
      const toMobile = store.sendToMobile(result.binding.user_id, event);
      persistStoreToDisk();

      sendJson(res, 200, {
        ok: true,
        data: {
          device_id: deviceId,
          revoked_at: result.binding.revoked_at,
          ws_delivered_to_pc: toPc,
          ws_delivered_to_mobile: toMobile
        }
      });
      return;
    }

    sendJson(res, 404, {
      ok: false,
      error: "Route not found"
    });
  } catch (error) {
    const statusCode =
      Number.isInteger(error?.statusCode) && error.statusCode >= 400 && error.statusCode <= 599
        ? error.statusCode
        : 500;
    sendJson(res, statusCode, {
      ok: false,
      error: error?.message || "Internal server error"
    });
  }
});

server.on("upgrade", (request, socket, head) => {
  const parsed = new URL(request.url || "/", PUBLIC_BASE_URL);
  const pathname = parsed.pathname;
  let context = null;

  if (!ensureUpgradeAuthorized(request, parsed, socket)) {
    return;
  }

  if (pathname === "/ws/pc") {
    const deviceId = asOptionalString(parsed.searchParams.get("device_id"));
    if (!deviceId) {
      rejectUpgrade(socket, "Missing `device_id` query");
      return;
    }
    context = {
      channel: "pc",
      device_id: deviceId
    };
  } else if (pathname === "/ws/mobile") {
    const userId = asOptionalString(parsed.searchParams.get("user_id"));
    if (!userId) {
      rejectUpgrade(socket, "Missing `user_id` query");
      return;
    }
    context = {
      channel: "mobile",
      user_id: userId
    };
  } else {
    rejectUpgrade(socket, "Unknown websocket path");
    return;
  }

  const ws = acceptWebSocket({
    request,
    socket,
    head,
    context,
    onMessage: (client, raw) => onWebSocketMessage(client, raw),
    onClose: (client) => onWebSocketClose(client),
    onPong: (client) => {
      client.isAlive = true;
    }
  });

  if (!ws) {
    return;
  }

  wsClients.add(ws);
  if (context.channel === "pc") {
    store.registerPcSocket(context.device_id, ws);
  } else {
    store.registerMobileSocket(context.user_id, ws);
  }

  ws.send(
    JSON.stringify(
      createEnvelope({
        type: MESSAGE_TYPES.HEARTBEAT,
        deviceId: context.device_id || null,
        userId: context.user_id || null,
        payload: {
          connected: true,
          channel: context.channel
        }
      })
    )
  );
});

function onWebSocketMessage(ws, raw) {
  const parsed = parseEnvelope(raw);
  if (!parsed.ok) {
    ws.send(
      JSON.stringify({
        ok: false,
        error: parsed.error
      })
    );
    return;
  }

  const envelope = parsed.value;
  if (ws.context.channel === "mobile") {
    handleMobileMessage({
      ws,
      userId: ws.context.user_id,
      envelope
    });
    return;
  }

  handlePcMessage({
    ws,
    deviceId: ws.context.device_id,
    envelope
  });
}

function onWebSocketClose(ws) {
  wsClients.delete(ws);
  const context = ws.context || {};
  if (context.channel === "pc" && context.device_id) {
    store.unregisterPcSocket(context.device_id, ws);
  } else if (context.channel === "mobile" && context.user_id) {
    store.unregisterMobileSocket(context.user_id, ws);
  }
}

function handleMobileMessage({ ws, userId, envelope }) {
  const { type } = envelope;

  if (type === MESSAGE_TYPES.HEARTBEAT) {
    ws.send(
      JSON.stringify(
        createEnvelope({
          type: MESSAGE_TYPES.HEARTBEAT,
          userId,
          payload: { ok: true }
        })
      )
    );
    return;
  }

  const targetDeviceId =
    asOptionalString(envelope.target_device_id) || asOptionalString(envelope.device_id);

  if (!targetDeviceId) {
    sendNack({
      ws,
      envelope,
      reason: "missing_target_device",
      error: "target_device_id is required for mobile messages"
    });
    return;
  }

  if (!store.isDeviceBoundToUser({ deviceId: targetDeviceId, userId })) {
    sendNack({
      ws,
      envelope,
      reason: "forbidden",
      error: `device ${targetDeviceId} is not bound to user ${userId}`
    });
    return;
  }

  const forwarded = {
    ...envelope,
    user_id: userId,
    target_device_id: targetDeviceId
  };

  const delivered = store.sendToPc(targetDeviceId, forwarded);
  if (type !== MESSAGE_TYPES.ACK) {
    sendAck({
      ws,
      envelope,
      delivered,
      targetDeviceId
    });
  }
}

function handlePcMessage({ ws, deviceId, envelope }) {
  const { type } = envelope;

  if (type === MESSAGE_TYPES.HEARTBEAT) {
    ws.send(
      JSON.stringify(
        createEnvelope({
          type: MESSAGE_TYPES.HEARTBEAT,
          deviceId,
          payload: { ok: true }
        })
      )
    );
    return;
  }

  const binding = store.getBindingByDevice(deviceId);
  if (!binding) {
    sendNack({
      ws,
      envelope,
      reason: "unbound_device",
      error: `device ${deviceId} is not bound to any user`
    });
    return;
  }

  const targetUserId =
    asOptionalString(envelope.target_user_id) || asOptionalString(envelope.user_id) || binding.user_id;

  const forwarded = {
    ...envelope,
    device_id: deviceId,
    target_user_id: targetUserId,
    user_id: binding.user_id
  };

  const delivered = store.sendToMobile(targetUserId, forwarded);
  if (type !== MESSAGE_TYPES.ACK) {
    sendAck({
      ws,
      envelope,
      delivered,
      targetUserId
    });
  }
}

function sendAck({ ws, envelope, delivered, targetDeviceId = null, targetUserId = null }) {
  ws.send(
    JSON.stringify(
      createEnvelope({
        type: MESSAGE_TYPES.ACK,
        payload: {
          ok: true,
          received_message_id: envelope.message_id,
          delivered_count: delivered
        },
        targetDeviceId,
        targetUserId
      })
    )
  );
}

function sendNack({ ws, envelope, reason, error }) {
  ws.send(
    JSON.stringify(
      createEnvelope({
        type: MESSAGE_TYPES.ACK,
        payload: {
          ok: false,
          reason,
          error,
          received_message_id: envelope.message_id || null
        }
      })
    )
  );
}

const wsHeartbeatTimer = setInterval(() => {
  for (const ws of wsClients) {
    if (ws.isAlive === false) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
}, 25_000);

const pairCleanupTimer = setInterval(() => {
  const changed = store.cleanupExpiredPairSessions();
  if (changed) {
    persistStoreToDisk();
  }
}, 10_000);

server.listen(PORT, HOST, () => {
  // eslint-disable-next-line no-console
  console.log(
    `[openclaw-server] listening on ${HOST}:${PORT} (${PUBLIC_BASE_URL}) auth=${SERVER_TOKEN ? "on" : "off"} store=${STORE_PATH || "memory"}`
  );
});

function stopTimersAndExit(signal) {
  clearInterval(wsHeartbeatTimer);
  clearInterval(pairCleanupTimer);
  persistStoreToDisk();
  server.close(() => {
    // eslint-disable-next-line no-console
    console.log(`[openclaw-server] stopped by ${signal}`);
    process.exit(0);
  });
}

process.on("SIGINT", () => stopTimersAndExit("SIGINT"));
process.on("SIGTERM", () => stopTimersAndExit("SIGTERM"));

function ensureHttpAuthorized(req, res) {
  if (!SERVER_TOKEN) {
    return true;
  }
  const provided = readBearerToken(req.headers.authorization);
  if (provided === SERVER_TOKEN) {
    return true;
  }
  sendJson(res, 401, {
    ok: false,
    error: "Unauthorized"
  });
  return false;
}

function ensureUpgradeAuthorized(request, parsedUrl, socket) {
  if (!SERVER_TOKEN) {
    return true;
  }
  const queryToken = asOptionalString(parsedUrl.searchParams.get("token"));
  const headerToken = readBearerToken(request.headers.authorization);
  if (queryToken === SERVER_TOKEN || headerToken === SERVER_TOKEN) {
    return true;
  }
  rejectUpgrade(socket, "Unauthorized");
  return false;
}

function readBearerToken(headerValue) {
  if (typeof headerValue !== "string") {
    return null;
  }
  const text = headerValue.trim();
  if (!text.toLowerCase().startsWith("bearer ")) {
    return null;
  }
  return text.slice(7).trim() || null;
}

function loadStoreFromDisk() {
  if (!STORE_PATH) {
    return;
  }
  try {
    if (!fs.existsSync(STORE_PATH)) {
      return;
    }
    const raw = fs.readFileSync(STORE_PATH, "utf8");
    if (!raw.trim()) {
      return;
    }
    const snapshot = JSON.parse(raw);
    store.hydrate(snapshot);
    // eslint-disable-next-line no-console
    console.log(`[openclaw-server] store loaded from ${STORE_PATH}`);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(`[openclaw-server] failed to load store: ${error.message}`);
  }
}

function persistStoreToDisk() {
  if (!STORE_PATH) {
    return;
  }
  try {
    const directory = path.dirname(STORE_PATH);
    if (directory) {
      fs.mkdirSync(directory, { recursive: true });
    }
    const snapshot = store.exportSnapshot();
    fs.writeFileSync(STORE_PATH, JSON.stringify(snapshot, null, 2), "utf8");
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(`[openclaw-server] failed to persist store: ${error.message}`);
  }
}

function withCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
}

function sendJson(res, statusCode, body) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8"
  });
  res.end(JSON.stringify(body));
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;

    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > 262_144) {
        reject(withStatus(new Error("Body too large"), 413));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => {
      if (chunks.length === 0) {
        resolve({});
        return;
      }

      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        const value = JSON.parse(raw);
        if (!value || typeof value !== "object" || Array.isArray(value)) {
          reject(withStatus(new Error("Request body must be a JSON object"), 400));
          return;
        }
        resolve(value);
      } catch (error) {
        reject(withStatus(new Error(`Invalid JSON body: ${error.message}`), 400));
      }
    });

    req.on("error", (error) => reject(error));
  });
}

function withStatus(error, statusCode) {
  error.statusCode = statusCode;
  return error;
}

function asOptionalString(value) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed || null;
}

function claimFailureStatusCode(reason) {
  switch (reason) {
    case "not_found":
      return 404;
    case "expired":
      return 410;
    case "revoked":
      return 410;
    case "claimed":
      return 409;
    case "invalid_code":
      return 401;
    default:
      return 400;
  }
}
