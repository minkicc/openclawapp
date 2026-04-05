import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import {
  claimPairV2Session,
  computePairV2SafetyCode,
  configurePairV2Storage,
  formatPairV2ConnectionName,
  getOrCreatePairV2Identity,
  getPairV2ICEServers,
  isGeneratedPairV2ConnectionName,
  listPairV2Bindings,
  loginPairV2Entity,
  normalizePairV2MobileName,
  normalizePairV2IceServers,
  normalizePairV2BaseUrl,
  parsePairV2QrPayload,
  queryPairV2Presence,
  type PairV2Binding,
  type PairV2ICEServer,
  type PairV2PresenceStatus
} from '@openclaw/pair-sdk';
import type { ChatMessage, ConnectionStatus, SessionItem } from '../types/session';
import { reconcileSessionMessages } from '../utils/chatGraph';
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

function resolveLocalMobileName() {
  return (
    normalizePairV2MobileName(Constants.deviceName) ||
    normalizePairV2MobileName(Constants.expoConfig?.name) ||
    '手机'
  );
}

function resolveSessionNameSeed(value: {
  bindingId?: unknown;
  pairSessionId?: unknown;
  deviceId?: unknown;
  mobileId?: unknown;
  id?: unknown;
}) {
  return value.bindingId || value.pairSessionId || value.deviceId || value.mobileId || value.id;
}

function resolveGeneratedSessionName(options: {
  bindingId?: unknown;
  pairSessionId?: unknown;
  deviceId?: unknown;
  mobileId?: unknown;
  id?: unknown;
  mobileName?: unknown;
}) {
  return formatPairV2ConnectionName(resolveSessionNameSeed(options), options.mobileName);
}

function resolveGeneratedSessionNameCandidates(
  existing: SessionItem | null,
  binding: PairV2Binding,
  mobileName: string
) {
  return [
    {
      seed: resolveSessionNameSeed(binding),
      mobileName,
    },
    {
      seed: binding.bindingId,
      mobileName,
    },
    {
      seed: binding.pairSessionId,
      mobileName,
    },
    {
      seed: binding.deviceId,
      mobileName,
    },
    {
      seed: binding.mobileId,
      mobileName,
    },
    {
      seed: resolveSessionNameSeed({
        bindingId: existing?.bindingId,
        pairSessionId: existing?.pairSessionId,
        deviceId: existing?.deviceId,
        id: existing?.id,
      }),
      mobileName: existing?.mobileName || mobileName,
    },
    {
      seed: existing?.bindingId,
      mobileName: existing?.mobileName || mobileName,
    },
    {
      seed: existing?.pairSessionId,
      mobileName: existing?.mobileName || mobileName,
    },
    {
      seed: existing?.deviceId,
      mobileName: existing?.mobileName || mobileName,
    },
  ].filter((item) => String(item.seed || '').trim());
}

function resolveSessionName(existing: SessionItem | null, binding: PairV2Binding, mobileName: string) {
  const currentName = String(existing?.name || '').trim();
  const generatedName = resolveGeneratedSessionName({
    bindingId: binding.bindingId,
    pairSessionId: binding.pairSessionId,
    deviceId: binding.deviceId,
    mobileId: binding.mobileId,
    id: existing?.id,
    mobileName,
  });
  if (!currentName) {
    return generatedName;
  }
  if (isGeneratedPairV2ConnectionName(currentName, resolveGeneratedSessionNameCandidates(existing, binding, mobileName))) {
    return generatedName;
  }
  return currentName;
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
  const ts = Date.now();
  return {
    id: randomId('msg'),
    from: 'host',
    text,
    createdAt: formatMessageTime(new Date(ts)),
    ts,
    kind: 'system',
    after: [],
    missingAfter: [],
  };
}

function mergeMessages(current: ChatMessage[], incoming: ChatMessage[]) {
  return reconcileSessionMessages([...(current || []), ...(incoming || [])]).messages.slice(-300);
}

function normalizePendingMessages(existing: SessionItem | null, preview: string) {
  const nextInfo = [buildInfoMessage(preview)];
  if (!existing) {
    return nextInfo;
  }
  const current = Array.isArray(existing.messages) ? existing.messages : [];
  const hasUserConversation = current.some((item) => item.from === 'self');
  if (hasUserConversation) {
    return current;
  }
  return nextInfo;
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
    return '宿主机在线，正在准备 P2P 通道';
  }
  return '已配对，宿主机当前离线';
}

function isPeerNegotiating(state: string) {
  return state === 'connecting' || state === 'channel-open' || state === 'verifying';
}

function normalizeSession(existing: SessionItem | null, next: SessionItem): SessionItem {
  if (!existing) {
    const reconciled = reconcileSessionMessages(next.messages || []);
    return {
      ...next,
      messages: reconciled.messages,
      missingMessageIds: reconciled.missingMessageIds,
    };
  }
  const reconciled = reconcileSessionMessages([...(existing.messages || []), ...(next.messages || [])]);
  return {
    ...existing,
    ...next,
    messages: reconciled.messages,
    missingMessageIds: reconciled.missingMessageIds,
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
    return Array.isArray(parsed)
      ? (parsed as SessionItem[]).map((item) => {
          const reconciledMessages = reconcileSessionMessages(
            Array.isArray(item?.messages) ? item.messages : []
          );
          return {
            ...item,
            transportReady: false,
            peerState: '',
            peerDetail: '',
            peerCapabilities: undefined,
            messages: reconciledMessages.messages,
            missingMessageIds: reconciledMessages.missingMessageIds,
          };
        })
      : [];
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
  const peerState = String(existing?.peerState || '').trim();
  const relayReady = trustState === 'active' && presence?.status === 'online';
  const transportReady = peerState === 'connected' || relayReady;
  const mobileName = normalizePairV2MobileName(binding.mobileName) || existing?.mobileName || resolveLocalMobileName();
  const preview = transportReady
    ? peerState === 'connected'
      ? 'P2P 通道已建立，可以开始聊天。'
      : '桌面端在线，可通过服务端转发聊天。'
    : isPeerNegotiating(peerState)
      ? '正在建立直连通道，失败会自动切换服务端转发...'
      : describeSession(trustState, safetyCode || String(existing?.safetyCode || ''), presence);
  const messages =
    trustState === 'pending'
      ? normalizePendingMessages(existing, preview)
      : existing?.messages?.length
        ? existing.messages
        : [buildInfoMessage(preview)];
  return normalizeSession(existing, {
    id: existing?.id || randomId('sess'),
    name: resolveSessionName(existing, binding, mobileName),
    status: normalizeStatus(trustState, presence),
    isReplying: false,
    createdAt: existing?.createdAt || formatCreatedAt(),
    peerLabel: `Agent Host / ${compactPeer(binding.deviceId)}`,
    preview,
    messages,
    serverBaseUrl: baseUrl,
    serverToken,
    deviceId: binding.deviceId,
    pairSessionId: binding.pairSessionId,
    bindingId: binding.bindingId,
    mobileName,
    trustState,
    safetyCode: safetyCode || existing?.safetyCode || '',
    mobilePublicKey: mobilePublicKey || existing?.mobilePublicKey || '',
    devicePublicKey: binding.devicePublicKey || existing?.devicePublicKey || '',
    transportReady,
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
  const mobileName = resolveLocalMobileName();
  const claimResult = await claimPairV2Session(baseUrl, auth.token, qrPayload.claimToken, {
    mobileName,
  });
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
