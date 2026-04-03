const maxBodyBytes = 1024 * 1024;
const textEncoder = new TextEncoder();

export const V2_CHALLENGE_TTL_MS = 5 * 60 * 1000;
export const V2_AUTH_SESSION_TTL_MS = 24 * 60 * 60 * 1000;
export const V2_PRESENCE_ONLINE_WINDOW_MS = 90 * 1000;
export const V2_PAIR_SESSION_MIN_TTL = 60;
export const V2_PAIR_SESSION_MAX_TTL = 600;
export const V2_PAIR_SESSION_DEFAULT_TTL = 180;
export const MAX_SIGNAL_QUEUE_PULL = 500;

export function nowMillis() {
  return Date.now();
}

export function clientKey(clientType, clientId) {
  return `${String(clientType || '').trim()}:${String(clientId || '').trim()}`;
}

export function jsonResponse(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'authorization, content-type',
      'access-control-allow-methods': 'GET, POST, OPTIONS',
      ...headers,
    },
  });
}

export function htmlResponse(html, status = 200) {
  return new Response(html, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'public, max-age=300',
    },
  });
}

export function cssResponse(css, status = 200) {
  return new Response(css, {
    status,
    headers: {
      'content-type': 'text/css; charset=utf-8',
      'cache-control': 'public, max-age=300',
    },
  });
}

export function corsPreflightResponse() {
  return new Response(null, {
    status: 204,
    headers: {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'authorization, content-type',
      'access-control-allow-methods': 'GET, POST, OPTIONS',
      'access-control-max-age': '86400',
    },
  });
}

export function errorStatus(code) {
  switch (String(code || '')) {
    case 'INVALID_JSON':
    case 'VALIDATION_ERROR':
      return 400;
    case 'BODY_TOO_LARGE':
      return 413;
    case 'UNAUTHORIZED':
      return 401;
    case 'FORBIDDEN':
      return 403;
    case 'NOT_FOUND':
      return 404;
    case 'EXPIRED':
      return 410;
    case 'INVALID_STATE':
    case 'ALREADY_CLAIMED':
      return 409;
    default:
      return 500;
  }
}

export function errorResponse(code, message, status = errorStatus(code)) {
  return jsonResponse(
    {
      ok: false,
      code,
      message,
    },
    status
  );
}

export class ApiError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

export function newError(code, message) {
  return new ApiError(code, message);
}

export function trimRequired(value, field) {
  const trimmed = String(value || '').trim();
  if (!trimmed) {
    throw newError('VALIDATION_ERROR', `${field} is required`);
  }
  return trimmed;
}

export function normalizeDisplayName(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ');
}

export async function readJsonBody(request) {
  const text = await request.text();
  if (text.length > maxBodyBytes) {
    throw newError('BODY_TOO_LARGE', 'Request body too large');
  }
  if (!text.trim()) {
    return {};
  }
  try {
    return JSON.parse(text);
  } catch {
    throw newError('INVALID_JSON', 'Invalid JSON body');
  }
}

export function copyPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return {};
  }
  return { ...payload };
}

export function requestBaseUrl(request) {
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}`;
}

function randomBytes(size) {
  const bytes = new Uint8Array(size);
  crypto.getRandomValues(bytes);
  return bytes;
}

export function bytesToHex(bytes) {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
}

export function makeId(prefix) {
  return `${prefix}_${bytesToHex(randomBytes(16))}`;
}

export function makeOpaqueToken(prefix, size = 24) {
  return `${prefix}_${bytesToBase64Url(randomBytes(size))}`;
}

export function clampInt(value, min, max) {
  const normalized = Number(value || 0);
  if (!Number.isFinite(normalized)) {
    return min;
  }
  if (normalized < min) {
    return min;
  }
  if (normalized > max) {
    return max;
  }
  return Math.floor(normalized);
}

export function bytesToBase64Url(bytes) {
  const base64 = btoa(String.fromCharCode(...bytes));
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function base64UrlToBytes(value) {
  const normalized = String(value || '').trim();
  if (!normalized) {
    return new Uint8Array();
  }
  const base64 = normalized.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4 || 4)) % 4);
  const decoded = atob(padded);
  return Uint8Array.from(decoded, (char) => char.charCodeAt(0));
}

export async function verifyEd25519Signature(publicKey, text, signature) {
  const publicKeyBytes = base64UrlToBytes(publicKey);
  const signatureBytes = base64UrlToBytes(signature);
  if (!publicKeyBytes.length || !signatureBytes.length) {
    return false;
  }
  const cryptoKey = await crypto.subtle.importKey('raw', publicKeyBytes, 'Ed25519', false, ['verify']);
  return await crypto.subtle.verify('Ed25519', cryptoKey, signatureBytes, textEncoder.encode(String(text || '')));
}

export function buildLoginMessage(challenge) {
  return `openclaw-v2-auth-login\n${challenge.challengeId}\n${challenge.nonce}\n${challenge.entityType}\n${challenge.entityId}\n${challenge.publicKey}`;
}

export function buildPresenceStatus(desktop, now = nowMillis()) {
  const lastSeenAt = Number(desktop?.lastSeenAt || 0);
  const online = lastSeenAt > 0 && now-lastSeenAt <= V2_PRESENCE_ONLINE_WINDOW_MS;
  return {
    deviceId: desktop.deviceId,
    platform: desktop.platform || '',
    appVersion: desktop.appVersion || '',
    status: online ? 'online' : 'offline',
    lastSeenAt,
    updatedAt: Number(desktop?.updatedAt || 0),
  };
}

export function parseIceServers(raw) {
  let parsed = raw;
  if (typeof parsed === 'string' && parsed.trim()) {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      parsed = [];
    }
  }
  if (!Array.isArray(parsed)) {
    return [];
  }
  return parsed
    .map((item) => {
      if (!item || typeof item !== 'object') {
        return null;
      }
      const urlValues = Array.isArray(item.urls)
        ? item.urls
        : String(item.urls || '').trim()
          ? [item.urls]
          : [];
      const urls = Array.from(new Set(urlValues.map((value) => String(value || '').trim()).filter(Boolean)));
      if (!urls.length) {
        return null;
      }
      const next = { urls };
      if (String(item.username || '').trim()) {
        next.username = String(item.username).trim();
      }
      if (String(item.credential || '').trim()) {
        next.credential = String(item.credential).trim();
      }
      if (String(item.credentialType || '').trim()) {
        next.credentialType = String(item.credentialType).trim();
      }
      return next;
    })
    .filter(Boolean);
}

export function createEmptyV2Snapshot() {
  return {
    version: 1,
    desktops: {},
    mobiles: {},
    challenges: {},
    authSessions: {},
    pairSessions: {},
    pairClaimTokenIndex: {},
    bindings: {},
    signalQueues: {},
  };
}

export function serializeSignalEvent(event) {
  return `data: ${JSON.stringify(event)}\n\n`;
}

export function serializeSsePing(ts = nowMillis()) {
  return `event: ping\ndata: ${JSON.stringify({ ts })}\n\n`;
}

export function sseHeaders() {
  return {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'authorization, content-type',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
  };
}

export function encodeText(value) {
  return textEncoder.encode(value);
}
