import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  claimPairV2Session,
  computePairV2SafetyCode,
  configurePairV2Storage,
  getOrCreatePairV2Identity,
  getPairV2ICEServers,
  listPairV2Bindings,
  loginPairV2Entity,
  normalizePairV2IceServers,
  normalizePairV2BaseUrl,
  parsePairV2QrPayload,
  queryPairV2Presence,
  type PairV2Binding,
  type PairV2ICEServer,
  type PairV2PresenceStatus
} from '@openclaw/pair-sdk';
import type { ChatMessage, ConnectionStatus, SessionItem } from '../types/session';
import { configureReactNativePairRuntime } from './reactNativePairRuntime';

const MOBILE_ID_KEY = 'openclaw.mobile.mobile-id.v2';
const SESSIONS_KEY = 'openclaw.mobile.sessions.v2';

type MobileAuthState = {
  baseUrl: string;
  mobileId: string;
  token: string;
  publicKey: string;
  privateKey: string;
  expiresAt: number;
};

const mobileAuthCache = new Map<string, MobileAuthState>();
const iceCache = new Map<string, { iceServers: RTCIceServer[]; expiresAt: number }>();

configurePairV2Storage({
  getItem(key) {
    return AsyncStorage.getItem(key);
  },
  setItem(key, value) {
    return AsyncStorage.setItem(key, value);
  },
  removeItem(key) {
    return AsyncStorage.removeItem(key);
  }
});
configureReactNativePairRuntime();

function createLocalId(prefix: string) {
  const uuid = globalThis.crypto?.randomUUID?.().replace(/-/g, '').slice(0, 10);
  const fallback = Math.random().toString(16).slice(2, 12);
  return `${prefix}_${uuid || fallback}`;
}

function randomId(prefix: string) {
  const uuid = globalThis.crypto?.randomUUID?.().replace(/-/g, '').slice(0, 12);
  const fallback = Math.random().toString(16).slice(2, 14);
  return `${prefix}_${uuid || fallback}`;
}

function sessionNameSuffix(seed: string) {
  const normalized = String(seed || '')
    .trim()
    .replaceAll('_', '')
    .replace(/[^a-zA-Z0-9]/g, '');

  if (normalized) {
    return normalized.slice(-6);
  }

  return Date.now().toString().slice(-6);
}

function defaultSessionName(seed: string) {
  return `连接-${sessionNameSuffix(seed)}`;
}

function formatCreatedAt(date = new Date()) {
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function formatMessageTime(date = new Date()) {
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function compactPeer(seed: string) {
  const value = String(seed || '').trim();
  if (!value) {
    return '待连接宿主机';
  }
  if (value.length <= 18) {
    return value;
  }
  return `${value.slice(0, 8)}...${value.slice(-6)}`;
}

function buildInfoMessage(text: string): ChatMessage {
  return {
    id: randomId('msg'),
    from: 'host',
    text,
    createdAt: formatMessageTime(),
  };
}

function mergeMessages(current: ChatMessage[], incoming: ChatMessage[]) {
  const merged = [...current];
  for (const message of incoming) {
    if (merged.some((item) => item.id === message.id)) {
      continue;
    }
    merged.push(message);
  }
  return merged.slice(-300);
}

function normalizeStatus(trustState: string, presence?: PairV2PresenceStatus | null): ConnectionStatus {
  if (trustState === 'pending') {
    return 'waiting';
  }
  if (trustState === 'active' && presence?.status === 'online') {
    return 'connected';
  }
  return 'offline';
}

function describeSession(trustState: string, safetyCode: string, presence?: PairV2PresenceStatus | null) {
  if (trustState === 'pending') {
    return safetyCode ? `请在桌面端确认安全码 ${safetyCode}` : '等待桌面端确认安全码';
  }
  if (trustState === 'revoked') {
    return '绑定已撤销';
  }
  if (presence?.status === 'online') {
    return '宿主机在线，等待接入原生 peer 通道';
  }
  return '已配对，宿主机当前离线';
}

function normalizeSession(existing: SessionItem | null, next: SessionItem): SessionItem {
  if (!existing) {
    return next;
  }
  return {
    ...existing,
    ...next,
    name:
      String(existing.name || '').trim() && String(existing.name || '').trim() !== defaultSessionName(existing.deviceId || '')
        ? existing.name
        : next.name,
    messages: mergeMessages(existing.messages || [], next.messages || []),
  };
}

async function ensureMobileId() {
  const cached = String((await AsyncStorage.getItem(MOBILE_ID_KEY)) || '').trim();
  if (cached) {
    return cached;
  }
  const next = createLocalId('mobile');
  await AsyncStorage.setItem(MOBILE_ID_KEY, next);
  return next;
}

function defaultIceServers() {
  return [
    {
      urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'],
    },
  ] satisfies PairV2ICEServer[];
}

export async function ensureMobileAuthV2(baseUrl: string, forceRefresh = false) {
  const normalizedBaseUrl = normalizePairV2BaseUrl(baseUrl);
  const mobileId = await ensureMobileId();
  const cached = mobileAuthCache.get(normalizedBaseUrl);
  if (!forceRefresh && cached && cached.expiresAt > Date.now() + 30_000) {
    return cached;
  }

  const identity = await getOrCreatePairV2Identity('mobile', mobileId);
  const { session } = await loginPairV2Entity(normalizedBaseUrl, 'mobile', mobileId);
  const nextState: MobileAuthState = {
    baseUrl: normalizedBaseUrl,
    mobileId,
    token: session.token,
    publicKey: identity.publicKey,
    privateKey: identity.privateKey,
    expiresAt: Number(session.expiresAt || 0),
  };
  mobileAuthCache.set(normalizedBaseUrl, nextState);
  return nextState;
}

export async function resolveSessionIceServersV2(baseUrl: string, token: string, forceRefresh = false) {
  const normalizedBaseUrl = normalizePairV2BaseUrl(baseUrl);
  const fallback = normalizePairV2IceServers(defaultIceServers(), defaultIceServers());
  const cached = iceCache.get(normalizedBaseUrl);
  if (!forceRefresh && cached && cached.expiresAt > Date.now() + 5_000) {
    return cached.iceServers;
  }
  if (!normalizedBaseUrl || !token) {
    return fallback;
  }
  try {
    const result = await getPairV2ICEServers(normalizedBaseUrl, token);
    const iceServers = normalizePairV2IceServers(result.iceServers, fallback);
    iceCache.set(normalizedBaseUrl, {
      iceServers,
      expiresAt: Date.now() + Math.max(60, Number(result.ttlSeconds || 0) || 600) * 1000,
    });
    return iceServers;
  } catch {
    iceCache.set(normalizedBaseUrl, {
      iceServers: fallback,
      expiresAt: Date.now() + 60_000,
    });
    return fallback;
  }
}

export async function loadStoredSessions() {
  const raw = String((await AsyncStorage.getItem(SESSIONS_KEY)) || '').trim();
  if (!raw) {
    return [] as SessionItem[];
  }
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as SessionItem[]) : [];
  } catch {
    return [];
  }
}

export async function saveStoredSessions(sessions: SessionItem[]) {
  await AsyncStorage.setItem(SESSIONS_KEY, JSON.stringify(Array.isArray(sessions) ? sessions : []));
}

function upsertSessions(current: SessionItem[], nextSession: SessionItem) {
  const index = current.findIndex(
    (item) =>
      item.id === nextSession.id ||
      (item.bindingId && item.bindingId === nextSession.bindingId) ||
      (item.deviceId && item.deviceId === nextSession.deviceId)
  );
  if (index < 0) {
    return [nextSession, ...current];
  }
  const cloned = current.slice();
  cloned[index] = normalizeSession(cloned[index], nextSession);
  return cloned;
}

function buildSessionFromBinding(options: {
  existing: SessionItem | null;
  baseUrl: string;
  serverToken: string;
  binding: PairV2Binding;
  safetyCode?: string;
  mobilePublicKey?: string;
  presence?: PairV2PresenceStatus | null;
}) {
  const { existing, baseUrl, serverToken, binding, safetyCode = '', mobilePublicKey = '', presence } = options;
  const trustState = String(binding.trustState || '').trim() || 'pending';
  const preview = describeSession(trustState, safetyCode || String(existing?.safetyCode || ''), presence);
  return normalizeSession(existing, {
    id: existing?.id || randomId('sess'),
    name:
      existing && String(existing.name || '').trim() && String(existing.name || '').trim() !== defaultSessionName(existing.deviceId || '')
        ? existing.name
        : defaultSessionName(binding.pairSessionId || binding.deviceId),
    status: normalizeStatus(trustState, presence),
    isReplying: false,
    createdAt: existing?.createdAt || formatCreatedAt(),
    peerLabel: `Agent Host / ${compactPeer(binding.deviceId)}`,
    preview,
    messages:
      existing?.messages?.length
        ? existing.messages
        : [buildInfoMessage(preview)],
    serverBaseUrl: baseUrl,
    serverToken,
    deviceId: binding.deviceId,
    pairSessionId: binding.pairSessionId,
    bindingId: binding.bindingId,
    trustState,
    safetyCode: safetyCode || existing?.safetyCode || '',
    mobilePublicKey: mobilePublicKey || existing?.mobilePublicKey || '',
    devicePublicKey: binding.devicePublicKey || existing?.devicePublicKey || '',
    transportReady: false,
    lastSeenAt: Number(presence?.lastSeenAt || existing?.lastSeenAt || 0),
  });
}

export async function pairByScanV2(raw: string, currentSessions: SessionItem[]) {
  let parsedRaw: Record<string, unknown>;
  try {
    parsedRaw = JSON.parse(String(raw || '').trim());
  } catch {
    throw new Error('二维码内容不是有效的 JSON');
  }

  const qrPayload = parsePairV2QrPayload(parsedRaw);
  if (!qrPayload.serverBaseUrl) {
    throw new Error('二维码缺少服务端地址');
  }
  if (!qrPayload.claimToken) {
    throw new Error('二维码缺少认领凭证');
  }
  if (!qrPayload.pairSessionId || !qrPayload.sessionNonce) {
    throw new Error('二维码缺少配对会话信息');
  }
  if (!qrPayload.devicePubkey) {
    throw new Error('二维码缺少桌面端公钥');
  }

  const baseUrl = normalizePairV2BaseUrl(qrPayload.serverBaseUrl);
  const auth = await ensureMobileAuthV2(baseUrl, true);
  const claimResult = await claimPairV2Session(baseUrl, auth.token, qrPayload.claimToken);
  const safetyCode = await computePairV2SafetyCode({
    devicePublicKey: qrPayload.devicePubkey,
    mobilePublicKey: auth.publicKey,
    pairSessionId: qrPayload.pairSessionId,
    sessionNonce: qrPayload.sessionNonce,
  });

  const existing =
    currentSessions.find((item) => item.bindingId === claimResult.binding.bindingId) ||
    currentSessions.find((item) => item.deviceId === claimResult.binding.deviceId) ||
    null;
  const created = !existing;
  const draftSession = buildSessionFromBinding({
    existing,
    baseUrl,
    serverToken: auth.token,
    binding: claimResult.binding,
    safetyCode,
    mobilePublicKey: auth.publicKey,
  });

  const merged = upsertSessions(currentSessions, draftSession);
  const refreshed = await refreshSessionsV2(merged);
  const finalSession =
    refreshed.find((item) => item.bindingId === draftSession.bindingId) ||
    refreshed.find((item) => item.id === draftSession.id) ||
    draftSession;

  await saveStoredSessions(refreshed);
  return {
    sessions: refreshed,
    session: finalSession,
    created,
  };
}

export async function refreshSessionsV2(currentSessions: SessionItem[]) {
  if (!Array.isArray(currentSessions) || currentSessions.length === 0) {
    return [] as SessionItem[];
  }

  const grouped = new Map<string, SessionItem[]>();
  for (const session of currentSessions) {
    const baseUrl = normalizePairV2BaseUrl(session.serverBaseUrl);
    const list = grouped.get(baseUrl) || [];
    list.push(session);
    grouped.set(baseUrl, list);
  }

  let nextSessions = [...currentSessions];

  for (const [baseUrl, scopedSessions] of grouped) {
    try {
      const auth = await ensureMobileAuthV2(baseUrl);
      const bindingsResult = await listPairV2Bindings(baseUrl, auth.token, true);
      const bindingMap = new Map(
        (Array.isArray(bindingsResult.bindings) ? bindingsResult.bindings : []).map((binding) => [binding.bindingId, binding])
      );
      const activeDeviceIds = Array.from(
        new Set(
          (Array.isArray(bindingsResult.bindings) ? bindingsResult.bindings : [])
            .filter((binding) => String(binding.trustState || '').trim() === 'active')
            .map((binding) => String(binding.deviceId || '').trim())
            .filter(Boolean)
        )
      );
      const presenceResult =
        activeDeviceIds.length > 0
          ? await queryPairV2Presence(baseUrl, auth.token, activeDeviceIds)
          : { statuses: [] as PairV2PresenceStatus[] };
      const presenceMap = new Map(
        (Array.isArray(presenceResult.statuses) ? presenceResult.statuses : []).map((status) => [status.deviceId, status])
      );

      for (const scopedSession of scopedSessions) {
        const binding =
          bindingMap.get(scopedSession.bindingId) ||
          (Array.isArray(bindingsResult.bindings)
            ? bindingsResult.bindings.find((item) => item.deviceId === scopedSession.deviceId)
            : null);
        if (!binding) {
          nextSessions = nextSessions.map((item) =>
            item.id === scopedSession.id
              ? {
                  ...item,
                  status: 'offline',
                  preview: '未在服务端找到对应绑定',
                  serverToken: auth.token,
                }
              : item
          );
          continue;
        }

        const updated = buildSessionFromBinding({
          existing: scopedSession,
          baseUrl,
          serverToken: auth.token,
          binding,
          safetyCode: scopedSession.safetyCode,
          mobilePublicKey: auth.publicKey,
          presence: presenceMap.get(binding.deviceId) || null,
        });
        nextSessions = upsertSessions(nextSessions, updated);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '同步失败';
      nextSessions = nextSessions.map((item) =>
        normalizePairV2BaseUrl(item.serverBaseUrl) === baseUrl
          ? {
              ...item,
              status: 'offline',
              preview: `同步失败：${message}`,
            }
          : item
      );
    }
  }

  await saveStoredSessions(nextSessions);
  return nextSessions;
}
