import { notImplemented, json } from "./handlers/not-implemented.mjs";

function notFound(res) {
  json(res, 404, {
    ok: false,
    code: "NOT_FOUND",
    message: "Route not found",
  });
}

export function routeRequest(req, res) {
  const url = new URL(req.url, "http://localhost");
  const method = req.method ?? "GET";

  if (method === "GET" && url.pathname === "/healthz") {
    json(res, 200, {
      ok: true,
      service: "openclaw-server",
      now: Date.now(),
    });
    return;
  }

  if (method === "POST" && url.pathname === "/v1/devices/register") {
    notImplemented(res, "registerDevice");
    return;
  }

  if (method === "POST" && url.pathname === "/v1/devices/heartbeat") {
    notImplemented(res, "heartbeatDevice");
    return;
  }

  const deviceStatusMatch = url.pathname.match(/^\/v1\/devices\/([^/]+)\/status$/);
  if (method === "GET" && deviceStatusMatch) {
    notImplemented(res, "getDeviceStatus");
    return;
  }

  if (method === "POST" && url.pathname === "/v1/pair/sessions") {
    notImplemented(res, "createPairSession");
    return;
  }

  if (method === "POST" && url.pathname === "/v1/pair/claim") {
    notImplemented(res, "claimPair");
    return;
  }

  if (method === "POST" && url.pathname === "/v1/pair/claim-by-code") {
    notImplemented(res, "claimPairByCode");
    return;
  }

  if (method === "POST" && url.pathname === "/v1/pair/revoke") {
    notImplemented(res, "revokePair");
    return;
  }

  if (method === "GET" && url.pathname === "/v1/pair/bindings") {
    notImplemented(res, "listBindings");
    return;
  }

  notFound(res);
}
