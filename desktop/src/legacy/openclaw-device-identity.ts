const DEVICE_IDENTITY_STORAGE_KEY = 'openclaw.gateway.deviceIdentity.v1';
const ED25519_ALGORITHM_NAME = 'Ed25519';
const ED25519_ALGORITHM: Algorithm = { name: ED25519_ALGORITHM_NAME };
const ED25519_SPKI_PREFIX = new Uint8Array([
  0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00,
]);
const textEncoder = new TextEncoder();

export type GatewayDeviceIdentity = {
  deviceId: string;
  publicKeyRawBase64Url: string;
  privateKeyPkcs8Base64Url: string;
};

type StoredGatewayDeviceIdentity = GatewayDeviceIdentity & {
  version: 1;
  createdAtMs: number;
};

type BuildGatewayDevicePayloadOptions = {
  nonce: string;
  clientId: string;
  clientMode: string;
  role: string;
  scopes: string[];
  token?: string | null;
  platform?: string | null;
  deviceFamily?: string | null;
};

type GatewayDeviceConnectPayload = {
  id: string;
  publicKey: string;
  signature: string;
  signedAt: number;
  nonce: string;
};

let cachedIdentity: GatewayDeviceIdentity | null = null;
let loadIdentityPromise: Promise<GatewayDeviceIdentity> | null = null;

function toBase64(byteArray: Uint8Array) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < byteArray.length; index += chunkSize) {
    binary += String.fromCharCode(...byteArray.subarray(index, index + chunkSize));
  }
  return globalThis.btoa(binary);
}

function base64UrlEncode(data: ArrayBuffer | Uint8Array) {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  return toBase64(bytes).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/g, '');
}

function base64UrlDecode(input: string) {
  const normalized = input.replaceAll('-', '+').replaceAll('_', '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const binary = globalThis.atob(padded);
  const result = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    result[index] = binary.charCodeAt(index);
  }
  return result;
}

function bytesEqual(left: Uint8Array, right: Uint8Array) {
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }
  return true;
}

function arrayBufferToHex(data: ArrayBuffer) {
  return Array.from(new Uint8Array(data))
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
}

function normalizeTrimmedMetadata(value: unknown) {
  if (typeof value !== 'string') {
    return '';
  }
  const trimmed = value.trim();
  return trimmed || '';
}

function toLowerAscii(input: string) {
  return input.replace(/[A-Z]/g, (char) => String.fromCharCode(char.charCodeAt(0) + 32));
}

function normalizeDeviceMetadataForAuth(value: unknown) {
  const trimmed = normalizeTrimmedMetadata(value);
  if (!trimmed) {
    return '';
  }
  return toLowerAscii(trimmed);
}

function buildDeviceAuthPayloadV3(params: {
  deviceId: string;
  clientId: string;
  clientMode: string;
  role: string;
  scopes: string[];
  signedAtMs: number;
  token?: string | null;
  nonce: string;
  platform?: string | null;
  deviceFamily?: string | null;
}) {
  const scopes = params.scopes.join(',');
  const token = params.token ?? '';
  const platform = normalizeDeviceMetadataForAuth(params.platform);
  const deviceFamily = normalizeDeviceMetadataForAuth(params.deviceFamily);
  return [
    'v3',
    params.deviceId,
    params.clientId,
    params.clientMode,
    params.role,
    scopes,
    String(params.signedAtMs),
    token,
    params.nonce,
    platform,
    deviceFamily,
  ].join('|');
}

function getLocalStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function readStoredIdentity() {
  const storage = getLocalStorage();
  if (!storage) {
    return null;
  }
  try {
    const raw = storage.getItem(DEVICE_IDENTITY_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<StoredGatewayDeviceIdentity> | null;
    if (
      parsed?.version !== 1 ||
      typeof parsed.deviceId !== 'string' ||
      typeof parsed.publicKeyRawBase64Url !== 'string' ||
      typeof parsed.privateKeyPkcs8Base64Url !== 'string'
    ) {
      return null;
    }
    return {
      version: 1,
      deviceId: parsed.deviceId,
      publicKeyRawBase64Url: parsed.publicKeyRawBase64Url,
      privateKeyPkcs8Base64Url: parsed.privateKeyPkcs8Base64Url,
      createdAtMs: Number(parsed.createdAtMs || Date.now()),
    } satisfies StoredGatewayDeviceIdentity;
  } catch {
    return null;
  }
}

function writeStoredIdentity(identity: StoredGatewayDeviceIdentity) {
  const storage = getLocalStorage();
  if (!storage) {
    return;
  }
  try {
    storage.setItem(DEVICE_IDENTITY_STORAGE_KEY, JSON.stringify(identity));
  } catch {}
}

async function deriveDeviceIdFromPublicKey(publicKeyRawBase64Url: string) {
  try {
    const publicKeyRaw = base64UrlDecode(publicKeyRawBase64Url);
    const digest = await globalThis.crypto.subtle.digest('SHA-256', publicKeyRaw);
    return arrayBufferToHex(digest);
  } catch {
    return null;
  }
}

function ensureSubtleCrypto() {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error('Web Crypto is unavailable for gateway device identity');
  }
  return subtle;
}

async function exportPublicKeyRaw(publicKey: CryptoKey) {
  const subtle = ensureSubtleCrypto();
  try {
    return new Uint8Array(await subtle.exportKey('raw', publicKey));
  } catch {
    const spki = new Uint8Array(await subtle.exportKey('spki', publicKey));
    if (
      spki.length === ED25519_SPKI_PREFIX.length + 32 &&
      bytesEqual(spki.subarray(0, ED25519_SPKI_PREFIX.length), ED25519_SPKI_PREFIX)
    ) {
      return spki.subarray(ED25519_SPKI_PREFIX.length);
    }
    return spki;
  }
}

async function generateIdentity(): Promise<StoredGatewayDeviceIdentity> {
  const subtle = ensureSubtleCrypto();
  const keyPair = (await subtle.generateKey(ED25519_ALGORITHM as any, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
  const publicKeyRaw = await exportPublicKeyRaw(keyPair.publicKey);
  const privateKeyPkcs8 = await subtle.exportKey('pkcs8', keyPair.privateKey);
  const publicKeyRawBase64Url = base64UrlEncode(publicKeyRaw);
  const privateKeyPkcs8Base64Url = base64UrlEncode(privateKeyPkcs8);
  const deviceId = await deriveDeviceIdFromPublicKey(publicKeyRawBase64Url);
  if (!deviceId) {
    throw new Error('Failed to derive gateway device identity');
  }
  return {
    version: 1,
    deviceId,
    publicKeyRawBase64Url,
    privateKeyPkcs8Base64Url,
    createdAtMs: Date.now(),
  };
}

async function validateStoredIdentity(identity: StoredGatewayDeviceIdentity | null) {
  if (!identity) {
    return null;
  }
  const derivedId = await deriveDeviceIdFromPublicKey(identity.publicKeyRawBase64Url);
  if (!derivedId) {
    return null;
  }
  if (derivedId === identity.deviceId) {
    return identity;
  }
  return {
    ...identity,
    deviceId: derivedId,
  };
}

async function signDevicePayload(privateKeyPkcs8Base64Url: string, payload: string) {
  const subtle = ensureSubtleCrypto();
  const privateKey = await subtle.importKey(
    'pkcs8',
    base64UrlDecode(privateKeyPkcs8Base64Url),
    ED25519_ALGORITHM as any,
    false,
    ['sign']
  );
  const signature = await subtle.sign(
    ED25519_ALGORITHM as any,
    privateKey,
    textEncoder.encode(payload)
  );
  return base64UrlEncode(signature);
}

export async function loadOrCreateGatewayDeviceIdentity(): Promise<GatewayDeviceIdentity> {
  if (cachedIdentity) {
    return cachedIdentity;
  }
  if (loadIdentityPromise) {
    return await loadIdentityPromise;
  }

  loadIdentityPromise = (async () => {
    const stored = await validateStoredIdentity(readStoredIdentity());
    if (stored) {
      writeStoredIdentity(stored);
      cachedIdentity = {
        deviceId: stored.deviceId,
        publicKeyRawBase64Url: stored.publicKeyRawBase64Url,
        privateKeyPkcs8Base64Url: stored.privateKeyPkcs8Base64Url,
      };
      return cachedIdentity;
    }

    const generated = await generateIdentity();
    writeStoredIdentity(generated);
    cachedIdentity = {
      deviceId: generated.deviceId,
      publicKeyRawBase64Url: generated.publicKeyRawBase64Url,
      privateKeyPkcs8Base64Url: generated.privateKeyPkcs8Base64Url,
    };
    return cachedIdentity;
  })();

  try {
    return await loadIdentityPromise;
  } finally {
    loadIdentityPromise = null;
  }
}

export async function buildGatewayDeviceConnectPayload(
  options: BuildGatewayDevicePayloadOptions
): Promise<GatewayDeviceConnectPayload> {
  const nonce = String(options.nonce || '').trim();
  if (!nonce) {
    throw new Error('Gateway connect challenge missing device nonce');
  }

  const identity = await loadOrCreateGatewayDeviceIdentity();
  const signedAtMs = Date.now();
  const payload = buildDeviceAuthPayloadV3({
    deviceId: identity.deviceId,
    clientId: options.clientId,
    clientMode: options.clientMode,
    role: options.role,
    scopes: options.scopes,
    signedAtMs,
    token: options.token ?? null,
    nonce,
    platform: options.platform,
    deviceFamily: options.deviceFamily,
  });
  const signature = await signDevicePayload(identity.privateKeyPkcs8Base64Url, payload);

  return {
    id: identity.deviceId,
    publicKey: identity.publicKeyRawBase64Url,
    signature,
    signedAt: signedAtMs,
    nonce,
  };
}
