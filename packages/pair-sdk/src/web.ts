import { sha256 } from '@noble/hashes/sha256';
import { base64urlnopad } from '@scure/base';
import nacl from 'tweetnacl';
import {
  getPairV2SignalStreamFactory,
  getPairV2Storage,
  type PairV2SignalStreamLike
} from './runtime.js';

export type PairV2EntityType = 'desktop' | 'mobile';

export type PairV2Challenge = {
  challengeId: string;
  entityType: PairV2EntityType;
  entityId: string;
  publicKey: string;
  nonce: string;
  createdAt: number;
  expiresAt: number;
};

export type PairV2AuthSession = {
  sessionId: string;
  token: string;
  entityType: PairV2EntityType;
  entityId: string;
  publicKey: string;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
};

export type PairV2Binding = {
  bindingId: string;
  pairSessionId: string;
  deviceId: string;
  devicePublicKey: string;
  mobileId: string;
  mobilePublicKey: string;
  trustState: 'pending' | 'active' | 'revoked' | string;
  createdAt: number;
  updatedAt: number;
  approvedAt?: number | null;
  revokedAt?: number | null;
};

export type PairV2PresenceStatus = {
  deviceId: string;
  platform: string;
  appVersion: string;
  status: 'online' | 'offline' | string;
  lastSeenAt: number;
  updatedAt: number;
};

export type PairV2ICEServer = {
  urls: string[];
  username?: string;
  credential?: string;
  credentialType?: string;
};

export type PairV2PairSession = {
  pairSessionId: string;
  deviceId: string;
  devicePublicKey: string;
  claimToken: string;
  sessionNonce: string;
  status: string;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
  claimedMobileId?: string | null;
  bindingId?: string | null;
};

export type PairV2QrPayload = {
  version: string;
  serverBaseUrl: string;
  pairSessionId: string;
  claimToken: string;
  deviceId: string;
  devicePubkey: string;
  sessionNonce: string;
  expiresAt: number;
};

export type PairV2SignalEvent = {
  id: string;
  type: string;
  ts: number;
  from?: {
    type: string;
    id: string;
  };
  to?: {
    type: string;
    id: string;
  };
  payload?: Record<string, unknown>;
};

type PairV2Identity = {
  entityId: string;
  publicKey: string;
  privateKey: string;
};

const textEncoder = new TextEncoder();

function ensureSubtle() {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error('当前环境不支持 Web Crypto');
  }
  return subtle;
}

function joinBytes(parts: Uint8Array[]) {
  const totalLength = parts.reduce((sum, part) => sum + part.length, 0);
  const merged = new Uint8Array(totalLength);
  let offset = 0;
  for (const part of parts) {
    merged.set(part, offset);
    offset += part.length;
  }
  return merged;
}

function bytesToBase64Url(bytes: Uint8Array) {
  return base64urlnopad.encode(bytes);
}

function base64UrlToBytes(value: string) {
  const normalized = String(value || '').trim();
  if (!normalized) {
    throw new Error('base64 内容不能为空');
  }
  return new Uint8Array(base64urlnopad.decode(normalized));
}

function identityStorageKey(entityType: PairV2EntityType, entityId: string) {
  return `openclaw.pair.v2.identity.${entityType}.${entityId}`;
}

async function readIdentityCache(storageKey: string) {
  const customStore = getPairV2Storage();
  if (customStore) {
    return String((await customStore.getItem(storageKey)) || '').trim();
  }
  return String(globalThis.localStorage?.getItem(storageKey) || '').trim();
}

async function writeIdentityCache(storageKey: string, value: string) {
  const customStore = getPairV2Storage();
  if (customStore) {
    await customStore.setItem(storageKey, value);
    return;
  }
  globalThis.localStorage?.setItem(storageKey, value);
}

function decodeSecretKey(privateKey: string) {
  try {
    const bytes = base64UrlToBytes(privateKey);
    if (bytes.length === nacl.sign.secretKeyLength) {
      return bytes;
    }
    if (bytes.length === nacl.sign.seedLength) {
      return nacl.sign.keyPair.fromSeed(bytes).secretKey;
    }
  } catch {
    // fallback to subtle import below
  }
  return null;
}

function buildHeaders(token = '', initHeaders?: HeadersInit) {
  const headers = new Headers(initHeaders || {});
  if (!headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }
  const normalized = String(token || '').trim();
  if (normalized) {
    headers.set('authorization', `Bearer ${normalized}`);
  }
  return headers;
}

export function normalizePairV2BaseUrl(raw: string) {
  const text = String(raw || '').trim();
  if (!text) {
    throw new Error('服务端地址不能为空');
  }
  const withProtocol = text.includes('://') ? text : `http://${text}`;
  const parsed = new URL(withProtocol);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('服务端地址必须是 http/https');
  }
  parsed.hash = '';
  parsed.search = '';
  parsed.pathname = parsed.pathname.replace(/\/+$/, '');
  return parsed.toString().replace(/\/+$/, '');
}

export function normalizePairV2IceServers(raw: unknown, fallback: PairV2ICEServer[] = []) {
  let parsed = raw;
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      parsed = fallback;
    }
  }
  if (!Array.isArray(parsed)) {
    parsed = fallback;
  }
  const normalized = (parsed as Array<Record<string, unknown>>)
    .map((item) => {
      if (!item || typeof item !== 'object') {
        return null;
      }
      const urlValues = Array.isArray(item.urls)
        ? item.urls
        : String(item.urls || '').trim()
          ? [item.urls]
          : [];
      const urls = Array.from(
        new Set(urlValues.map((value) => String(value || '').trim()).filter(Boolean))
      );
      if (urls.length === 0) {
        return null;
      }
      const next: PairV2ICEServer = { urls };
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
    .filter((item): item is PairV2ICEServer => Boolean(item));
  return normalized.length > 0 ? normalized : fallback;
}

export function buildPairV2ApiUrl(baseUrl: string, path: string, query?: URLSearchParams) {
  const url = new URL(path, `${normalizePairV2BaseUrl(baseUrl)}/`);
  if (query) {
    url.search = query.toString();
  }
  return url.toString();
}

export async function pairV2RequestJson<T>(
  baseUrl: string,
  path: string,
  init: RequestInit = {},
  token = ''
): Promise<T> {
  const response = await fetch(buildPairV2ApiUrl(baseUrl, path), {
    ...init,
    headers: buildHeaders(token, init.headers)
  });
  const data = await response.json().catch(() => ({} as Record<string, unknown>));
  if (!response.ok || (data as { ok?: boolean }).ok === false) {
    const message =
      (data as { message?: string; error?: string }).message ||
      (data as { message?: string; error?: string }).error ||
      `HTTP ${response.status}`;
    throw new Error(message);
  }
  return data as T;
}

async function exportEd25519Identity(keyPair: CryptoKeyPair): Promise<PairV2Identity> {
  const subtle = ensureSubtle();
  const publicKey = new Uint8Array(await subtle.exportKey('raw', keyPair.publicKey));
  const privateKey = new Uint8Array(await subtle.exportKey('pkcs8', keyPair.privateKey));
  return {
    entityId: '',
    publicKey: bytesToBase64Url(publicKey),
    privateKey: bytesToBase64Url(privateKey)
  };
}

async function importEd25519PrivateKey(serializedPrivateKey: string) {
  const subtle = ensureSubtle();
  return await subtle.importKey('pkcs8', base64UrlToBytes(serializedPrivateKey), 'Ed25519', false, ['sign']);
}

async function importEd25519PublicKey(serializedPublicKey: string) {
  const subtle = ensureSubtle();
  return await subtle.importKey('raw', base64UrlToBytes(serializedPublicKey), 'Ed25519', false, ['verify']);
}

export async function getOrCreatePairV2Identity(entityType: PairV2EntityType, entityId: string) {
  const normalizedId = String(entityId || '').trim();
  if (!normalizedId) {
    throw new Error('entityId 不能为空');
  }
  const storageKey = identityStorageKey(entityType, normalizedId);
  const cached = await readIdentityCache(storageKey);
  if (cached) {
    try {
      const parsed = JSON.parse(cached) as PairV2Identity;
      if (parsed?.publicKey && parsed?.privateKey) {
        return {
          entityId: normalizedId,
          publicKey: String(parsed.publicKey),
          privateKey: String(parsed.privateKey)
        };
      }
    } catch {
      // ignore malformed cache
    }
  }

  const keyPair = nacl.sign.keyPair();
  const identity = {
    entityId: normalizedId,
    publicKey: bytesToBase64Url(keyPair.publicKey),
    privateKey: bytesToBase64Url(keyPair.secretKey)
  };
  await writeIdentityCache(storageKey, JSON.stringify(identity));
  return identity;
}

function buildLoginMessage(challenge: PairV2Challenge) {
  return textEncoder.encode(
    `openclaw-v2-auth-login\n${challenge.challengeId}\n${challenge.nonce}\n${challenge.entityType}\n${challenge.entityId}\n${challenge.publicKey}`
  );
}

export async function loginPairV2Entity(baseUrl: string, entityType: PairV2EntityType, entityId: string) {
  const identity = await getOrCreatePairV2Identity(entityType, entityId);
  const challengeRes = await pairV2RequestJson<{ ok: boolean; challenge: PairV2Challenge }>(
    baseUrl,
    '/v2/auth/challenge',
    {
      method: 'POST',
      body: JSON.stringify({
        entityType,
        entityId: identity.entityId,
        publicKey: identity.publicKey
      })
    }
  );
  const signature = await signPairV2Text(
    identity.privateKey,
    new TextDecoder().decode(buildLoginMessage(challengeRes.challenge))
  );
  const loginRes = await pairV2RequestJson<{ ok: boolean; session: PairV2AuthSession }>(
    baseUrl,
    '/v2/auth/login',
    {
      method: 'POST',
      body: JSON.stringify({
        entityType,
        entityId: identity.entityId,
        publicKey: identity.publicKey,
        challengeId: challengeRes.challenge.challengeId,
        signature
      })
    }
  );

  return {
    identity,
    session: loginRes.session
  };
}

export async function signPairV2Text(privateKey: string, text: string) {
  const naclSecretKey = decodeSecretKey(privateKey);
  if (naclSecretKey) {
    const signature = nacl.sign.detached(textEncoder.encode(String(text || '')), naclSecretKey);
    return bytesToBase64Url(signature);
  }

  const subtle = ensureSubtle();
  const cryptoKey = await importEd25519PrivateKey(privateKey);
  const signature = await subtle.sign('Ed25519', cryptoKey, textEncoder.encode(String(text || '')));
  return bytesToBase64Url(new Uint8Array(signature));
}

export async function verifyPairV2Text(publicKey: string, text: string, signature: string) {
  const publicKeyBytes = base64UrlToBytes(publicKey);
  const signatureBytes = base64UrlToBytes(signature);
  if (publicKeyBytes.length !== nacl.sign.publicKeyLength || signatureBytes.length !== nacl.sign.signatureLength) {
    return false;
  }
  return nacl.sign.detached.verify(
    textEncoder.encode(String(text || '')),
    signatureBytes,
    publicKeyBytes
  );
}

export async function announcePairV2Desktop(
  baseUrl: string,
  token: string,
  payload: {
    platform: string;
    appVersion: string;
    capabilities?: Record<string, unknown>;
  }
) {
  return await pairV2RequestJson<{ ok: boolean; desktop: Record<string, unknown> }>(
    baseUrl,
    '/v2/presence/announce',
    {
      method: 'POST',
      body: JSON.stringify(payload)
    },
    token
  );
}

export async function heartbeatPairV2Desktop(
  baseUrl: string,
  token: string,
  payload: {
    platform?: string;
    appVersion?: string;
    capabilities?: Record<string, unknown>;
  }
) {
  return await pairV2RequestJson<{ ok: boolean; desktop: Record<string, unknown> }>(
    baseUrl,
    '/v2/presence/heartbeat',
    {
      method: 'POST',
      body: JSON.stringify(payload)
    },
    token
  );
}

export async function createPairV2Session(baseUrl: string, token: string, ttlSeconds = 180) {
  return await pairV2RequestJson<{ ok: boolean; session: PairV2PairSession; qrPayload: PairV2QrPayload }>(
    baseUrl,
    '/v2/pair/sessions',
    {
      method: 'POST',
      body: JSON.stringify({ ttlSeconds })
    },
    token
  );
}

export async function claimPairV2Session(baseUrl: string, token: string, claimToken: string) {
  return await pairV2RequestJson<{ ok: boolean; pairSession: PairV2PairSession; binding: PairV2Binding }>(
    baseUrl,
    '/v2/pair/claims',
    {
      method: 'POST',
      body: JSON.stringify({ claimToken })
    },
    token
  );
}

export async function approvePairV2Binding(baseUrl: string, token: string, bindingId: string) {
  return await pairV2RequestJson<{ ok: boolean; binding: PairV2Binding }>(
    baseUrl,
    '/v2/pair/approvals',
    {
      method: 'POST',
      body: JSON.stringify({ bindingId })
    },
    token
  );
}

export async function revokePairV2Binding(baseUrl: string, token: string, bindingId: string) {
  return await pairV2RequestJson<{ ok: boolean; binding: PairV2Binding }>(
    baseUrl,
    '/v2/pair/revoke',
    {
      method: 'POST',
      body: JSON.stringify({ bindingId })
    },
    token
  );
}

export async function listPairV2Bindings(baseUrl: string, token: string, includeRevoked = false) {
  const query = new URLSearchParams();
  if (includeRevoked) {
    query.set('includeRevoked', 'true');
  }
  return await pairV2RequestJson<{ ok: boolean; bindings: PairV2Binding[] }>(
    baseUrl,
    `/v2/bindings${query.size ? `?${query.toString()}` : ''}`,
    {
      method: 'GET'
    },
    token
  );
}

export async function queryPairV2Presence(baseUrl: string, token: string, deviceIds: string[]) {
  return await pairV2RequestJson<{ ok: boolean; statuses: PairV2PresenceStatus[] }>(
    baseUrl,
    '/v2/presence/query',
    {
      method: 'POST',
      body: JSON.stringify({ deviceIds })
    },
    token
  );
}

export async function getPairV2ICEServers(baseUrl: string, token: string) {
  const result = await pairV2RequestJson<{ ok: boolean; iceServers: PairV2ICEServer[]; ttlSeconds?: number }>(
    baseUrl,
    '/v2/ice-servers',
    {
      method: 'GET'
    },
    token
  );
  return {
    iceServers: normalizePairV2IceServers(result.iceServers, []),
    ttlSeconds: Math.max(60, Number(result.ttlSeconds || 0) || 600)
  };
}

export async function sendPairV2Signal(
  baseUrl: string,
  token: string,
  body: {
    fromType: PairV2EntityType;
    fromId: string;
    toType: PairV2EntityType;
    toId: string;
    type: string;
    payload?: Record<string, unknown>;
  }
) {
  return await pairV2RequestJson<{ ok: boolean; deliveredRealtime: boolean; event: PairV2SignalEvent }>(
    baseUrl,
    '/v2/signal/send',
    {
      method: 'POST',
      body: JSON.stringify(body)
    },
    token
  );
}

export function openPairV2SignalStream(
  baseUrl: string,
  token: string,
  clientType: PairV2EntityType,
  clientId: string
): PairV2SignalStreamLike {
  const params = new URLSearchParams({
    clientType,
    clientId
  });
  if (token) {
    params.set('token', token);
  }
  const streamUrl = buildPairV2ApiUrl(baseUrl, '/v2/signal/stream', params);
  const customFactory = getPairV2SignalStreamFactory();
  if (customFactory) {
    return customFactory(streamUrl);
  }
  if (typeof EventSource !== 'function') {
    throw new Error('当前环境不支持 EventSource，请注入 signal stream factory');
  }
  return new EventSource(streamUrl) as unknown as PairV2SignalStreamLike;
}

export async function computePairV2SafetyCode(parts: {
  devicePublicKey: string;
  mobilePublicKey: string;
  pairSessionId: string;
  sessionNonce: string;
}) {
  const bytes = sha256(
    joinBytes([
      textEncoder.encode(String(parts.devicePublicKey || '')),
      textEncoder.encode(String(parts.mobilePublicKey || '')),
      textEncoder.encode(String(parts.pairSessionId || '')),
      textEncoder.encode(String(parts.sessionNonce || ''))
    ])
  );
  const value = ((bytes[0] << 16) | (bytes[1] << 8) | bytes[2]) >>> 4;
  return String(value % 1_000_000).padStart(6, '0');
}

export function parsePairV2QrPayload(payload: Record<string, unknown>) {
  return {
    version: String(payload.version || '').trim(),
    serverBaseUrl: String(payload.serverBaseUrl || payload.server_base_url || '').trim(),
    pairSessionId: String(payload.pairSessionId || payload.pair_session_id || '').trim(),
    claimToken: String(payload.claimToken || payload.claim_token || '').trim(),
    deviceId: String(payload.deviceId || payload.device_id || '').trim(),
    devicePubkey: String(payload.devicePubkey || payload.device_pubkey || '').trim(),
    sessionNonce: String(payload.sessionNonce || payload.session_nonce || '').trim(),
    expiresAt: Number(payload.expiresAt || payload.expires_at || 0)
  } as PairV2QrPayload;
}
