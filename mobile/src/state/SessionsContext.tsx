import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState, type AppStateStatus } from 'react-native';
import {
  createPairV2AppRegistry,
  openPairV2SignalStream,
  PairV2PeerChannel,
  sendPairV2Signal,
  type PairV2PeerAppMessage,
  type PairV2PeerCapabilities,
  type PairV2SignalEvent,
  type PairV2SignalStreamLike,
} from '@openclaw/pair-sdk';
import {
  buildOpenClawPairChannelRevokePayload,
  buildOpenClawPairChatAckPayload,
  buildOpenClawPairChatPingPayload,
  buildOpenClawPairChatPongPayload,
  buildOpenClawPairChatSyncRequestPayload,
  buildOpenClawPairChatSyncStatePayload,
  buildOpenClawPairChatPayload,
  createOpenClawPairChatMessageId,
  createOpenClawPairChatModule,
  openClawPairChannelRevokeType,
  openClawPairChatAckType,
  openClawPairChatMessageType,
  openClawPairChatPingType,
  openClawPairChatPongType,
  openClawPairChatSyncRequestType,
  openClawPairChatSyncStateType,
  parseOpenClawPairChannelRevoke,
  parseOpenClawPairChatAck,
  parseOpenClawPairChatPing,
  parseOpenClawPairChatPong,
  parseOpenClawPairChatSyncState,
  parseOpenClawPairChatSyncRequest,
  supportsOpenClawPairChat,
} from '@openclaw/message-sdk';
import type { ChatMessage, SessionItem } from '../types/session';
import {
  collectSessionLeafIds,
  describeSessionChatState,
  reconcileSessionMessages,
  upsertSessionMessage,
} from '../utils/chatGraph';
import {
  ensureMobileAuthV2,
  heartbeatMobilePresenceV2,
  loadStoredSessions,
  pairByScanV2,
  refreshSessionsV2,
  resolveSessionIceServersV2,
  saveStoredSessions,
} from '../services/pairingV2';

type CreateSessionResult = {
  session: SessionItem;
  created: boolean;
};

type SessionsContextValue = {
  sessions: SessionItem[];
  getSessionById: (sessionId: string) => SessionItem | null;
  removeSession: (sessionId: string) => void;
  pairByScan: (raw: string) => Promise<CreateSessionResult>;
  sendMessage: (
    sessionId: string,
    text: string,
    options?: {
      messageId?: string;
      ts?: number;
    }
  ) => Promise<{ messageId: string; ts: number }>;
  retryMessage: (sessionId: string, messageId: string) => Promise<void>;
  refreshSessions: () => Promise<void>;
};

type SignalStreamEntry = {
  stream: PairV2SignalStreamLike;
  token: string;
};

const DEBUG_AUTO_MESSAGE_KEY = 'openclaw.mobile.debug.auto-message';
const MAX_SESSION_MESSAGES = 1000;
const PRESENCE_HEARTBEAT_INTERVAL_MS = 60_000;
const MESSAGE_SYNC_INTERVAL_MS = 60_000;
const MESSAGE_SYNC_RESUME_THROTTLE_MS = 10_000;
const LINK_PING_INTERVAL_MS = 60_000;
const LINK_PING_TIMEOUT_MS = 10_000;

const SessionsContext = createContext<SessionsContextValue | null>(null);

function randomId(prefix: string) {
  const uuid = globalThis.crypto?.randomUUID?.().replace(/-/g, '').slice(0, 12);
  const fallback = Math.random().toString(16).slice(2, 14);
  return `${prefix}_${uuid || fallback}`;
}

function formatMessageTime(date = new Date()) {
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function uniqueBaseUrls(sessions: SessionItem[]) {
  return Array.from(new Set(sessions.map((session) => String(session.serverBaseUrl || '').trim()).filter(Boolean)));
}

function isPeerNegotiating(state: string) {
  return state === 'connecting' || state === 'channel-open' || state === 'verifying';
}

function nextOriginSeq(messages: ChatMessage[], origin: 'host' | 'mobile') {
  return (
    messages
      .filter((message) => message.kind !== 'system' && (message.origin === origin || (!message.origin && (origin === 'mobile' ? message.from === 'self' : message.from === 'host'))))
      .reduce((maxSeq, message) => Math.max(maxSeq, Math.trunc(Number(message.originSeq || 0))), 0) + 1
  );
}

function sessionsMatch(left: SessionItem, right: SessionItem) {
  if (left.id && right.id && left.id === right.id) {
    return true;
  }
  if (left.bindingId && right.bindingId && left.bindingId === right.bindingId) {
    return true;
  }
  if (left.deviceId && right.deviceId && left.deviceId === right.deviceId) {
    return true;
  }
  return false;
}

function mergeRefreshedSessions(latestSessions: SessionItem[], refreshedSessions: SessionItem[]) {
  const merged = refreshedSessions.map((refreshed) => {
    const latest = latestSessions.find((item) => sessionsMatch(item, refreshed));
    if (!latest) {
      return refreshed;
    }
    const reconciledMessages = reconcileSessionMessages([
      ...(latest.messages || []),
      ...(refreshed.messages || []),
    ]);
    return {
      ...latest,
      ...refreshed,
      messages: reconciledMessages.messages,
      missingMessageIds: reconciledMessages.missingMessageIds,
      linkTransport:
        refreshed.status === 'offline'
          ? ''
          : refreshed.linkTransport === 'p2p' || refreshed.linkTransport === 'relay'
            ? refreshed.linkTransport
            : latest.linkTransport || '',
      linkRttMs:
        refreshed.status === 'offline'
          ? 0
          : Math.max(
              0,
              Math.trunc(Number(refreshed.linkRttMs || latest.linkRttMs || 0))
            ),
      linkRttAt:
        refreshed.status === 'offline'
          ? 0
          : Math.max(
              0,
              Math.trunc(Number(refreshed.linkRttAt || latest.linkRttAt || 0))
            ),
      linkProbePending:
        refreshed.status === 'offline'
          ? false
          : Boolean(refreshed.linkProbePending ?? latest.linkProbePending),
    } satisfies SessionItem;
  });

  for (const latest of latestSessions) {
    if (!merged.some((item) => sessionsMatch(item, latest))) {
      merged.push(latest);
    }
  }

  return merged;
}

export function SessionsProvider({ children }: { children: ReactNode }) {
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const sessionsRef = useRef<SessionItem[]>([]);
  const loadedRef = useRef(false);
  const signalStreamsRef = useRef(new Map<string, SignalStreamEntry>());
  const signalConnectingRef = useRef(new Map<string, Promise<boolean>>());
  const peersRef = useRef(new Map<string, PairV2PeerChannel>());
  const peerConnectingRef = useRef(new Map<string, Promise<boolean>>());
  const debugAutoMessageTriggeredRef = useRef(new Set<string>());
  const refreshTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const messageSyncTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastPresenceHeartbeatAtRef = useRef(new Map<string, number>());
  const lastMessageSyncAtRef = useRef(new Map<string, number>());
  const lastLinkPingAtRef = useRef(new Map<string, number>());
  const pendingLinkPingsRef = useRef(
    new Map<string, { id: string; sentAt: number; transport: 'p2p' | 'relay'; sessionId: string }>()
  );
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);

  function commitSessions(nextSessions: SessionItem[]) {
    sessionsRef.current = nextSessions;
    setSessions(nextSessions);
  }

  function updateSessions(updater: (current: SessionItem[]) => SessionItem[]) {
    const nextSessions = updater(sessionsRef.current);
    commitSessions(nextSessions);
    return nextSessions;
  }

  function getSessionByIdSnapshot(sessionId: string) {
    return sessionsRef.current.find((item) => item.id === sessionId) || null;
  }

  function getSessionByBindingIdSnapshot(bindingId: string) {
    const target = String(bindingId || '').trim();
    if (!target) {
      return null;
    }
    return sessionsRef.current.find((item) => item.bindingId === target) || null;
  }

  function getSessionByDeviceIdSnapshot(deviceId: string) {
    const target = String(deviceId || '').trim();
    if (!target) {
      return null;
    }
    return sessionsRef.current.find((item) => item.deviceId === target) || null;
  }

  function canUseRelayTransport(session: SessionItem | null | undefined) {
    if (!session) {
      return false;
    }
    return (
      String(session.trustState || '').trim() === 'active' &&
      String(session.status || '').trim() !== 'offline' &&
      Boolean(String(session.bindingId || '').trim()) &&
      Boolean(String(session.deviceId || '').trim())
    );
  }

  function clearPendingLinkPing(session: SessionItem | null | undefined) {
    const bindingId = String(session?.bindingId || '').trim();
    if (!bindingId) {
      return;
    }
    pendingLinkPingsRef.current.delete(bindingId);
    lastLinkPingAtRef.current.delete(bindingId);
  }

  function markSessionTransport(sessionId: string, transport: 'p2p' | 'relay') {
    patchSessionById(sessionId, {
      linkTransport: transport,
    });
  }

  function applyLinkPong(
    session: SessionItem,
    pong: {
      id: string;
      sentAt: number;
    },
    transport: 'p2p' | 'relay'
  ) {
    const bindingId = String(session.bindingId || '').trim();
    const sessionId = String(session.id || '').trim();
    const now = Date.now();
    const pending = bindingId ? pendingLinkPingsRef.current.get(bindingId) : undefined;
    if (pending && pending.id === String(pong.id || '').trim()) {
      pendingLinkPingsRef.current.delete(bindingId);
    }
    const sentAt = Math.max(0, Math.trunc(Number(pong.sentAt || pending?.sentAt || 0)));
    const rttMs = sentAt > 0 ? Math.max(0, now - sentAt) : 0;
    patchSessionById(sessionId, {
      linkTransport: transport,
      linkRttMs: rttMs,
      linkRttAt: now,
      linkProbePending: false,
    });
  }

  function patchSessionById(sessionId: string, patch: Partial<SessionItem>) {
    updateSessions((current) =>
      current.map((item) =>
        item.id === sessionId
          ? {
              ...item,
              ...patch,
            }
          : item
      )
    );
  }

  function patchSessionByBindingId(bindingId: string, patch: Partial<SessionItem>) {
    const target = String(bindingId || '').trim();
    if (!target) {
      return;
    }
    updateSessions((current) =>
      current.map((item) =>
        item.bindingId === target
          ? {
              ...item,
              ...patch,
            }
          : item
      )
    );
  }

  function removeSessionLocal(match: {
    id?: string;
    bindingId?: string;
    deviceId?: string;
  }) {
    const targetId = String(match.id || '').trim();
    const targetBindingId = String(match.bindingId || '').trim();
    const targetDeviceId = String(match.deviceId || '').trim();
    updateSessions((current) =>
      current.filter((item) => {
        if (targetId && item.id === targetId) {
          return false;
        }
        if (targetBindingId && item.bindingId === targetBindingId) {
          return false;
        }
        if (targetDeviceId && item.deviceId === targetDeviceId) {
          return false;
        }
        return true;
      })
    );
  }

  function appendMessageLocal(
    sessionId: string,
    message: {
      id?: string;
      from: ChatMessage['from'];
      text: string;
      createdAt?: string;
      ts?: number;
      kind?: ChatMessage['kind'];
      origin?: ChatMessage['origin'];
      originSeq?: ChatMessage['originSeq'];
      after?: string[];
      deliveryStatus?: ChatMessage['deliveryStatus'];
      deliveryError?: string;
    }
  ) {
    const text = String(message.text || '').trim();
    if (!text) {
      return;
    }

    const ts = Number(message.ts || Date.now());
    const nextMessage: ChatMessage = {
      id: String(message.id || '').trim() || randomId('msg'),
      from: message.from,
      text,
      createdAt: message.createdAt || formatMessageTime(new Date(ts)),
      ts,
      kind: message.kind === 'system' ? 'system' : 'chat',
      origin:
        message.kind === 'system'
          ? undefined
          : message.from === 'self'
            ? 'mobile'
            : 'host',
      originSeq:
        message.kind === 'system'
          ? undefined
          : Math.max(0, Math.trunc(Number(message.originSeq || 0))),
      after: Array.isArray(message.after) ? [...message.after] : [],
      missingAfter: [],
      deliveryStatus:
        message.kind === 'system'
          ? undefined
          : message.from === 'self'
            ? message.deliveryStatus || 'sent'
            : undefined,
      deliveryError:
        message.kind === 'system' || message.from !== 'self'
          ? ''
          : String(message.deliveryError || '').trim(),
    };

    updateSessions((current) =>
      current.map((item) => {
        if (item.id !== sessionId) {
          return item;
        }
        const reconciled = upsertSessionMessage(item.messages || [], nextMessage);
        return {
          ...item,
          preview: text,
          isReplying: false,
          messages: reconciled.messages.slice(-MAX_SESSION_MESSAGES),
          missingMessageIds: reconciled.missingMessageIds,
        };
      })
    );
  }

  function updateMessageDeliveryState(
    sessionId: string,
    messageId: string,
    deliveryStatus: NonNullable<ChatMessage['deliveryStatus']>,
    deliveryError = ''
  ) {
    const targetSessionId = String(sessionId || '').trim();
    const targetMessageId = String(messageId || '').trim();
    if (!targetSessionId || !targetMessageId) {
      return;
    }

    updateSessions((current) =>
      current.map((item) => {
        if (item.id !== targetSessionId) {
          return item;
        }

        let updated = false;
        const messages = (item.messages || []).map((message) => {
          if (String(message.id || '').trim() !== targetMessageId) {
            return message;
          }
          updated = true;
          return {
            ...message,
            deliveryStatus,
            deliveryError: deliveryStatus === 'failed' ? String(deliveryError || '').trim() : '',
          };
        });

        if (!updated) {
          return item;
        }

        return {
          ...item,
          messages,
        };
      })
    );
  }

  async function deliverLocalChatMessage(
    session: SessionItem,
    message: {
      id: string;
      text: string;
      ts: number;
      after: string[];
      originSeq: number;
    }
  ) {
    const latestSession = getSessionByIdSnapshot(session.id) || session;
    if (
      !supportsOpenClawPairChat(
        latestSession.peerCapabilities as Pick<PairV2PeerCapabilities, 'supportedMessages'> | undefined
      )
    ) {
      throw new Error('当前桌面端未声明聊天能力');
    }

    const connected = await ensureSignalConnected(latestSession.serverBaseUrl);
    if (!connected) {
      throw new Error('信令连接未建立');
    }

    const payloadMessage: PairV2PeerAppMessage = {
      type: openClawPairChatMessageType,
      ts: message.ts,
      from: 'mobile',
      payload: buildOpenClawPairChatPayload(message.text, {
        id: message.id,
        after: message.after,
        origin: 'mobile',
        originSeq: message.originSeq,
      }),
    };

    const deliveredVia = await deliverAppMessage(latestSession, payloadMessage, {
      preferRelay: false,
      peerTimeoutMs: 3500,
      peerRetries: 0,
    });
    console.log(
      `[pair-mobile] send chat binding=${latestSession.bindingId} text=${message.text} via=${deliveredVia} id=${message.id}`
    );
    patchSessionById(latestSession.id, {
      linkTransport: deliveredVia,
    });
    updateMessageDeliveryState(latestSession.id, message.id, 'sent');
  }

  function upsertRemoteChatMessage(
    sessionId: string,
    message: {
      id: string;
      from: ChatMessage['from'];
      text: string;
      ts: number;
      origin?: 'host' | 'mobile';
      originSeq?: number;
      after?: string[];
    }
  ) {
    const normalizedId = String(message.id || '').trim();
    if (!normalizedId) {
      return {
        inserted: false,
        missingMessageIds: [] as string[],
        newlyMissingMessageIds: [] as string[],
      };
    }

    let result = {
      inserted: false,
      missingMessageIds: [] as string[],
      newlyMissingMessageIds: [] as string[],
    };

    updateSessions((current) =>
      current.map((item) => {
        if (item.id !== sessionId) {
          return item;
        }
        const reconciled = upsertSessionMessage(item.messages || [], {
          id: normalizedId,
          from: message.from,
          text: String(message.text || ''),
          createdAt: formatMessageTime(new Date(Number(message.ts || Date.now()))),
          ts: Number(message.ts || Date.now()),
          kind: 'chat',
          origin: message.origin === 'mobile' ? 'mobile' : 'host',
          originSeq: Math.max(0, Math.trunc(Number(message.originSeq || 0))),
          after: Array.isArray(message.after) ? [...message.after] : [],
          missingAfter: [],
        });
        result = {
          inserted: reconciled.inserted,
          missingMessageIds: reconciled.missingMessageIds,
          newlyMissingMessageIds: reconciled.newlyMissingMessageIds,
        };
        return {
          ...item,
          preview: String(message.text || '').trim() || item.preview,
          isReplying: false,
          messages: reconciled.messages.slice(-MAX_SESSION_MESSAGES),
          missingMessageIds: reconciled.missingMessageIds,
        };
      })
    );

    return result;
  }

  function updatePeerState(bindingId: string, state: string, detail = '') {
    const target = String(bindingId || '').trim();
    if (!target) {
      return;
    }
    updateSessions((current) =>
      current.map((item) => {
        if (item.bindingId !== target) {
          return item;
        }
        const relayReady = canUseRelayTransport(item);
        return {
          ...item,
          peerState: state,
          peerDetail: detail,
          transportReady: state === 'connected' || relayReady,
          preview:
            state === 'connected'
              ? 'P2P 通道已建立，可以开始聊天。'
              : isPeerNegotiating(state)
                ? '正在建立直连通道，失败会自动切换服务端转发...'
                : state === 'failed'
                  ? detail
                    ? relayReady
                      ? `P2P 通道建立失败，已切换服务端转发：${detail}`
                      : `P2P 通道建立失败：${detail}`
                    : relayReady
                      ? 'P2P 通道建立失败，已切换服务端转发。'
                      : 'P2P 通道建立失败'
                  : state === 'disconnected'
                    ? detail
                      ? relayReady
                        ? `P2P 通道已断开，已切换服务端转发：${detail}`
                        : `P2P 通道已断开：${detail}`
                      : relayReady
                        ? 'P2P 通道已断开，已切换服务端转发。'
                        : 'P2P 通道已断开，等待重连'
                    : relayReady
                      ? '桌面端在线，可通过服务端转发聊天。'
                      : item.preview,
        };
      })
    );
  }

  function markPeerFailure(session: SessionItem, error: unknown, fallback = 'P2P 通道建立失败') {
    const detail =
      error instanceof Error
        ? error.message
        : String(error || '').trim() || fallback;
    const bindingId = String(session.bindingId || '').trim();
    if (bindingId) {
      updatePeerState(bindingId, 'failed', detail);
      return;
    }
    patchSessionById(session.id, {
      peerState: 'failed',
      peerDetail: detail,
      transportReady: canUseRelayTransport(session),
      preview: canUseRelayTransport(session)
        ? `P2P 通道建立失败，已切换服务端转发：${detail}`
        : `P2P 通道建立失败：${detail}`,
    });
  }

  function closeSignal(baseUrl: string) {
    const normalizedBaseUrl = String(baseUrl || '').trim();
    const existing = signalStreamsRef.current.get(normalizedBaseUrl);
    if (!existing) {
      return;
    }
    signalStreamsRef.current.delete(normalizedBaseUrl);
    signalConnectingRef.current.delete(normalizedBaseUrl);
    try {
      existing.stream.onopen = null;
      existing.stream.onmessage = null;
      existing.stream.onerror = null;
      if ('onclose' in existing.stream) {
        existing.stream.onclose = null;
      }
      existing.stream.close();
    } catch {
      // ignore close errors
    }
  }

  function closePeer(bindingId: string, detail = 'peer closed') {
    const key = String(bindingId || '').trim();
    if (!key) {
      return;
    }
    console.log(`[pair-mobile] closePeer binding=${key} detail=${detail}`);
    peerConnectingRef.current.delete(key);
    pendingLinkPingsRef.current.delete(key);
    lastLinkPingAtRef.current.delete(key);
    const peer = peersRef.current.get(key);
    if (!peer) {
      return;
    }
    peersRef.current.delete(key);
    try {
      peer.close();
    } catch {
      // ignore peer close errors
    }
    updatePeerState(key, 'disconnected', detail);
  }

  function closeStalePeers(nextSessions: SessionItem[]) {
    const activeBindings = new Set(
      nextSessions
        .filter((session) => String(session.bindingId || '').trim())
        .map((session) => String(session.bindingId || '').trim())
    );
    for (const bindingId of [...peersRef.current.keys()]) {
      const session = nextSessions.find((item) => item.bindingId === bindingId) || null;
      if (!activeBindings.has(bindingId) || !session || session.trustState !== 'active') {
        console.log(
          `[pair-mobile] close stale peer binding=${bindingId} hasSession=${Boolean(session)} trustState=${
            session?.trustState || '-'
          }`
        );
        closePeer(bindingId, 'session removed');
      }
    }
  }

  function pruneMessageSyncTimestamps(nextSessions: SessionItem[]) {
    const activeBindings = new Set(
      nextSessions
        .map((session) => String(session.bindingId || '').trim())
        .filter(Boolean)
    );
    for (const bindingId of [...lastMessageSyncAtRef.current.keys()]) {
      if (!activeBindings.has(bindingId)) {
        lastMessageSyncAtRef.current.delete(bindingId);
      }
    }
  }

  function prunePresenceHeartbeatTimestamps(nextSessions: SessionItem[]) {
    const activeBaseUrls = new Set(
      nextSessions
        .map((session) => String(session.serverBaseUrl || '').trim())
        .filter(Boolean)
    );
    for (const baseUrl of [...lastPresenceHeartbeatAtRef.current.keys()]) {
      if (!activeBaseUrls.has(baseUrl)) {
        lastPresenceHeartbeatAtRef.current.delete(baseUrl);
      }
    }
  }

  function pruneLinkProbeState(nextSessions: SessionItem[]) {
    const activeBindings = new Set(
      nextSessions
        .map((session) => String(session.bindingId || '').trim())
        .filter(Boolean)
    );
    for (const bindingId of [...lastLinkPingAtRef.current.keys()]) {
      if (!activeBindings.has(bindingId)) {
        lastLinkPingAtRef.current.delete(bindingId);
      }
    }
    for (const bindingId of [...pendingLinkPingsRef.current.keys()]) {
      if (!activeBindings.has(bindingId)) {
        pendingLinkPingsRef.current.delete(bindingId);
      }
    }
  }

  async function sendPeerSignal(
    baseUrl: string,
    toId: string,
    type: string,
    payload: Record<string, unknown>
  ) {
    let auth = await ensureMobileAuthV2(baseUrl);
    try {
      await sendPairV2Signal(baseUrl, auth.token, {
        fromType: 'mobile',
        fromId: auth.mobileId,
        toType: 'desktop',
        toId,
        type,
        payload,
      });
    } catch {
      auth = await ensureMobileAuthV2(baseUrl, true);
      await sendPairV2Signal(baseUrl, auth.token, {
        fromType: 'mobile',
        fromId: auth.mobileId,
        toType: 'desktop',
        toId,
        type,
        payload,
      });
    }
  }

  async function sendRelayAppMessage(
    session: SessionItem,
    message: PairV2PeerAppMessage
  ) {
    let auth = await ensureMobileAuthV2(session.serverBaseUrl);
    const bindingId = String(session.bindingId || '').trim();
    const deviceId = String(session.deviceId || '').trim();
    if (!bindingId || !deviceId) {
      throw new Error('绑定信息不完整，无法使用服务端转发');
    }
    const payload = {
      bindingId,
      deviceId,
      message,
    };
    try {
      await sendPairV2Signal(session.serverBaseUrl, auth.token, {
        fromType: 'mobile',
        fromId: auth.mobileId,
        toType: 'desktop',
        toId: deviceId,
        type: 'relay.app',
        payload,
      });
    } catch {
      auth = await ensureMobileAuthV2(session.serverBaseUrl, true);
      await sendPairV2Signal(session.serverBaseUrl, auth.token, {
        fromType: 'mobile',
        fromId: auth.mobileId,
        toType: 'desktop',
        toId: deviceId,
        type: 'relay.app',
        payload,
      });
    }
  }

  async function deliverAppMessage(
    session: SessionItem,
    message: PairV2PeerAppMessage,
    options: {
      preferRelay?: boolean;
      peerTimeoutMs?: number;
      peerRetries?: number;
    } = {}
  ) {
    const latestSession = getSessionByIdSnapshot(session.id) || session;
    const preferRelay = Boolean(options.preferRelay);
    const currentPeerState = String(latestSession.peerState || '').trim();
    const shouldAttemptPeer =
      !preferRelay && currentPeerState !== 'failed' && currentPeerState !== 'disconnected';

    if (shouldAttemptPeer) {
      try {
        const peerReady = await ensureSessionPeerConnected(
          latestSession,
          options.peerTimeoutMs ?? 3500,
          options.peerRetries ?? 0
        );
        if (peerReady) {
          const peer = await ensureSessionPeer(latestSession);
          await peer.sendAppMessage(message.type, message.payload || {});
          return 'p2p' as const;
        }
      } catch (error) {
        markPeerFailure(latestSession, error);
      }
    }

    if (!canUseRelayTransport(latestSession)) {
      throw new Error('桌面端当前离线，无法使用服务端转发');
    }

    await sendRelayAppMessage(latestSession, message);
    patchSessionById(latestSession.id, {
      transportReady: true,
      linkTransport: 'relay',
      preview: '已切换到服务端转发，可继续聊天。',
    });
    return 'relay' as const;
  }

  async function respondToLinkPing(
    session: SessionItem,
    ping: {
      id: string;
      sentAt: number;
    },
    preferRelay = false
  ) {
    if (!String(ping.id || '').trim()) {
      return;
    }
    await deliverAppMessage(
      session,
      {
        type: openClawPairChatPongType,
        payload: buildOpenClawPairChatPongPayload({
          id: ping.id,
          sentAt: ping.sentAt,
          respondedAt: Date.now(),
        }),
        ts: Date.now(),
        from: 'mobile',
      },
      {
        preferRelay,
        peerTimeoutMs: 1200,
        peerRetries: 0,
      }
    );
  }

  async function probeSessionLink(
    session: SessionItem,
    reason: string,
    options: {
      minIntervalMs?: number;
      preferRelay?: boolean;
    } = {}
  ) {
    const latestSession = getSessionByIdSnapshot(session.id) || session;
    if (String(latestSession.trustState || '').trim() !== 'active') {
      return false;
    }
    const bindingId = String(latestSession.bindingId || '').trim();
    if (!bindingId) {
      return false;
    }

    const now = Date.now();
    const minIntervalMs = Math.max(0, Math.trunc(Number(options.minIntervalMs || 0)));
    const lastPingAt = lastLinkPingAtRef.current.get(bindingId) || 0;
    if (minIntervalMs > 0 && now - lastPingAt < minIntervalMs) {
      return false;
    }

    const pingId = randomId('chatping');
    patchSessionById(latestSession.id, {
      linkProbePending: true,
    });

    try {
      const transport = await deliverAppMessage(
        latestSession,
        {
          type: openClawPairChatPingType,
          payload: buildOpenClawPairChatPingPayload({
            id: pingId,
            sentAt: now,
          }),
          ts: now,
          from: 'mobile',
        },
        {
          preferRelay: options.preferRelay ?? false,
          peerTimeoutMs: 1200,
          peerRetries: 0,
        }
      );
      pendingLinkPingsRef.current.set(bindingId, {
        id: pingId,
        sentAt: now,
        transport,
        sessionId: latestSession.id,
      });
      lastLinkPingAtRef.current.set(bindingId, now);
      patchSessionById(latestSession.id, {
        linkTransport: transport,
        linkProbePending: true,
      });
      globalThis.setTimeout(() => {
        const pending = pendingLinkPingsRef.current.get(bindingId);
        if (!pending || pending.id !== pingId) {
          return;
        }
        pendingLinkPingsRef.current.delete(bindingId);
        patchSessionById(pending.sessionId, {
          linkProbePending: false,
          linkRttMs: 0,
          linkRttAt: 0,
        });
      }, LINK_PING_TIMEOUT_MS);
      console.log(
        `[pair-mobile] link ping binding=${bindingId} reason=${reason} via=${transport} id=${pingId}`
      );
      return true;
    } catch (error) {
      pendingLinkPingsRef.current.delete(bindingId);
      patchSessionById(latestSession.id, {
        linkProbePending: false,
        linkRttMs: 0,
        linkRttAt: 0,
      });
      console.log(
        `[pair-mobile] link ping failed binding=${bindingId} reason=${reason} error=${
          error instanceof Error ? error.message : String(error || '')
        }`
      );
      return false;
    }
  }

  async function sendChannelRevoke(session: SessionItem) {
    const latestSession = getSessionByIdSnapshot(session.id) || session;
    if (!String(latestSession.deviceId || '').trim()) {
      return;
    }
    await deliverAppMessage(
      latestSession,
      {
        type: openClawPairChannelRevokeType,
        payload: buildOpenClawPairChannelRevokePayload({
          channelId: latestSession.id,
          bindingId: latestSession.bindingId,
          sessionId: latestSession.pairSessionId,
          revokedBy: 'mobile',
          revokedAt: Date.now(),
        }),
        ts: Date.now(),
        from: 'mobile',
      },
      {
        preferRelay: true,
        peerTimeoutMs: 1200,
        peerRetries: 0,
      }
    );
  }

  async function requestMessageStateSync(
    session: SessionItem,
    reason: string,
    options: {
      minIntervalMs?: number;
      preferRelay?: boolean;
    } = {}
  ) {
    const latestSession = getSessionByIdSnapshot(session.id) || session;
    if (!canUseRelayTransport(latestSession)) {
      return false;
    }

    const bindingId = String(latestSession.bindingId || '').trim();
    if (!bindingId) {
      return false;
    }

    const now = Date.now();
    const minIntervalMs = Math.max(0, Math.trunc(Number(options.minIntervalMs || 0)));
    const lastSyncedAt = lastMessageSyncAtRef.current.get(bindingId) || 0;
    if (minIntervalMs > 0 && now - lastSyncedAt < minIntervalMs) {
      return false;
    }

    const stateSummary = describeSessionChatState(latestSession.messages || []);
    try {
      await deliverAppMessage(
        latestSession,
        {
          type: openClawPairChatSyncStateType,
          payload: buildOpenClawPairChatSyncStatePayload({
            hostSeq: stateSummary.hostSeq,
            mobileSeq: stateSummary.mobileSeq,
            leafIds: stateSummary.leafIds,
          }),
          ts: now,
          from: 'mobile',
        },
        {
          preferRelay: options.preferRelay ?? true,
          peerTimeoutMs: 1200,
          peerRetries: 0,
        }
      );
      lastMessageSyncAtRef.current.set(bindingId, now);
      console.log(
        `[pair-mobile] sync state binding=${bindingId} reason=${reason} hostSeq=${stateSummary.hostSeq} mobileSeq=${stateSummary.mobileSeq} leaves=${stateSummary.leafIds.length}`
      );
      return true;
    } catch (error) {
      console.log(
        `[pair-mobile] sync state failed binding=${bindingId} reason=${reason} error=${
          error instanceof Error ? error.message : String(error || '')
        }`
      );
      return false;
    }
  }

  async function syncSessionsWithDesktopState(
    targetSessions: SessionItem[],
    reason: string,
    minIntervalMs = 0
  ) {
    for (const session of targetSessions) {
      const latestSession = getSessionByIdSnapshot(session.id) || session;
      await requestMessageStateSync(latestSession, reason, {
        minIntervalMs,
        preferRelay: true,
      });
    }
  }

  async function heartbeatSessionsPresence(
    targetSessions: SessionItem[],
    reason: string,
    minIntervalMs = 0
  ) {
    const baseUrls = uniqueBaseUrls(targetSessions);
    const now = Date.now();
    for (const baseUrl of baseUrls) {
      const normalizedBaseUrl = String(baseUrl || '').trim();
      if (!normalizedBaseUrl) {
        continue;
      }
      const lastHeartbeatAt = lastPresenceHeartbeatAtRef.current.get(normalizedBaseUrl) || 0;
      if (minIntervalMs > 0 && now - lastHeartbeatAt < minIntervalMs) {
        continue;
      }
      try {
        await heartbeatMobilePresenceV2(normalizedBaseUrl);
        lastPresenceHeartbeatAtRef.current.set(normalizedBaseUrl, now);
        console.log(`[pair-mobile] presence heartbeat base=${normalizedBaseUrl} reason=${reason}`);
      } catch (error) {
        console.log(
          `[pair-mobile] presence heartbeat failed base=${normalizedBaseUrl} reason=${reason} error=${
            error instanceof Error ? error.message : String(error || '')
          }`
        );
      }
    }
  }

  async function requestMissingMessages(
    session: SessionItem,
    messageIds: string[],
    preferRelay = false
  ) {
    const normalizedIds = Array.from(
      new Set((Array.isArray(messageIds) ? messageIds : []).map((value) => String(value || '').trim()).filter(Boolean))
    );
    if (normalizedIds.length === 0) {
      return;
    }
    try {
      await deliverAppMessage(
        session,
        {
          type: openClawPairChatSyncRequestType,
          payload: buildOpenClawPairChatSyncRequestPayload(normalizedIds),
          ts: Date.now(),
          from: 'mobile',
        },
        {
          preferRelay,
          peerTimeoutMs: 1200,
          peerRetries: 0,
        }
      );
      console.log(`[pair-mobile] requested missing chat ids binding=${session.bindingId} ids=${normalizedIds.join(',')}`);
    } catch (error) {
      console.log(
        `[pair-mobile] request missing chat ids failed binding=${session.bindingId} error=${
          error instanceof Error ? error.message : String(error || '')
        }`
      );
    }
  }

  async function acknowledgeMessages(
    session: SessionItem,
    messageIds: string[],
    preferRelay = false
  ) {
    const normalizedIds = Array.from(
      new Set((Array.isArray(messageIds) ? messageIds : []).map((value) => String(value || '').trim()).filter(Boolean))
    );
    if (normalizedIds.length === 0) {
      return;
    }
    try {
      await deliverAppMessage(
        session,
        {
          type: openClawPairChatAckType,
          payload: buildOpenClawPairChatAckPayload(normalizedIds),
          ts: Date.now(),
          from: 'mobile',
        },
        {
          preferRelay,
          peerTimeoutMs: 1200,
          peerRetries: 0,
        }
      );
    } catch (error) {
      console.log(
        `[pair-mobile] ack chat failed binding=${session.bindingId} ids=${normalizedIds.join(',')} error=${
          error instanceof Error ? error.message : String(error || '')
        }`
      );
    }
  }

  async function resendKnownMessages(
    session: SessionItem,
    messageIds: string[],
    preferRelay = false
  ) {
    const knownMessages = (session.messages || [])
      .filter((message) => message.kind !== 'system' && message.from === 'self')
      .filter((message) => messageIds.includes(message.id));

    for (const message of knownMessages) {
      try {
        await deliverAppMessage(
          session,
          {
            type: openClawPairChatMessageType,
            payload: buildOpenClawPairChatPayload(message.text, {
              id: message.id,
              after: message.after || [],
              origin: message.origin === 'mobile' ? 'mobile' : 'host',
              originSeq: Math.max(0, Math.trunc(Number(message.originSeq || 0))),
            }),
            ts: Number(message.ts || Date.now()),
            from: 'mobile',
          },
          {
            preferRelay,
            peerTimeoutMs: 1200,
            peerRetries: 0,
          }
        );
      } catch (error) {
        console.log(
          `[pair-mobile] resend chat failed binding=${session.bindingId} message=${message.id} error=${
            error instanceof Error ? error.message : String(error || '')
          }`
        );
      }
    }
  }

  async function handleDesktopSyncState(
    session: SessionItem,
    syncState: {
      hostSeq: number;
      mobileSeq: number;
      leafIds: string[];
    },
    preferRelay = false
  ) {
    const current = getSessionByIdSnapshot(session.id) || session;
    const localState = describeSessionChatState(current.messages || []);

    const missingMobileMessages = (current.messages || [])
      .filter((message) => message.kind !== 'system' && message.from === 'self')
      .filter((message) => Math.trunc(Number(message.originSeq || 0)) > Math.max(0, Math.trunc(Number(syncState.mobileSeq || 0))))
      .sort((left, right) => Number(left.originSeq || 0) - Number(right.originSeq || 0));

    for (const message of missingMobileMessages) {
      try {
        await deliverAppMessage(
          current,
          {
            type: openClawPairChatMessageType,
            payload: buildOpenClawPairChatPayload(message.text, {
              id: message.id,
              after: message.after || [],
              origin: 'mobile',
              originSeq: Math.max(0, Math.trunc(Number(message.originSeq || 0))),
            }),
            ts: Number(message.ts || Date.now()),
            from: 'mobile',
          },
          {
            preferRelay,
            peerTimeoutMs: 1200,
            peerRetries: 0,
          }
        );
      } catch (error) {
        console.log(
          `[pair-mobile] sync resend failed binding=${current.bindingId} id=${message.id} error=${
            error instanceof Error ? error.message : String(error || '')
          }`
        );
      }
    }

    if (Math.max(0, Math.trunc(Number(syncState.hostSeq || 0))) > localState.hostSeq) {
      void requestMessageStateSync(current, 'desktop-sync-gap', {
        minIntervalMs: MESSAGE_SYNC_RESUME_THROTTLE_MS,
        preferRelay,
      });
    }
  }

  async function ensureSessionPeer(session: SessionItem) {
    const key = String(session.bindingId || '').trim();
    if (!key) {
      throw new Error('bindingId missing');
    }
    const existing = peersRef.current.get(key);
    if (existing) {
      return existing;
    }

    const auth = await ensureMobileAuthV2(session.serverBaseUrl);
    const trustedPeerId = String(session.deviceId || '').trim();
    const trustedPeerPublicKey = String(session.devicePublicKey || '').trim();
    if (!trustedPeerId || !trustedPeerPublicKey) {
      throw new Error('desktop trust metadata is missing');
    }

    const appRegistry = createPairV2AppRegistry([
      createOpenClawPairChatModule({
        onChatMessage: (chat) => {
          const current = getSessionByBindingIdSnapshot(key);
          if (!current) {
            return;
          }
          patchSessionById(current.id, {
            linkTransport: 'p2p',
          });
          const result = upsertRemoteChatMessage(current.id, {
            id: chat.id,
            from: 'host',
            text: chat.text,
            ts: chat.ts,
            origin: chat.origin,
            originSeq: chat.originSeq,
            after: chat.after,
          });
          if (result.newlyMissingMessageIds.length > 0) {
            void requestMissingMessages(current, result.newlyMissingMessageIds, false);
          }
          void acknowledgeMessages(current, [chat.id], false);
        },
      }),
    ]);

    const peer = new PairV2PeerChannel({
      role: 'mobile',
      selfId: auth.mobileId,
      selfPublicKey: auth.publicKey,
      selfPrivateKey: auth.privateKey,
      trustedPeerId,
      trustedPeerPublicKey,
      bindingId: key,
      iceServers: await resolveSessionIceServersV2(session.serverBaseUrl, auth.token),
      capabilities: appRegistry.buildCapabilities({
        protocolVersion: 'openclaw-pair-v2',
        supportedMessages: [openClawPairChannelRevokeType],
        appId: 'openclaw',
        appVersion: 'mobile',
      }),
      onSignal: async (type, payload) => {
        await sendPeerSignal(session.serverBaseUrl, trustedPeerId, type, payload);
      },
      onStateChange: (state, detail) => {
        console.log(`[pair-mobile] state binding=${key} state=${state} detail=${detail || ''}`);
        updatePeerState(key, state, detail || '');
        if (state === 'connected') {
          const current = getSessionByBindingIdSnapshot(key);
          if (current) {
            void probeSessionLink(current, 'peer-connected', {
              minIntervalMs: 0,
            });
          }
        }
      },
      onLog: (line) => {
        console.log(`[pair-mobile] binding=${key} ${line}`);
      },
      onCapabilities: (capabilities) => {
        console.log(
          `[pair-mobile] capabilities binding=${key} messages=${(capabilities.supportedMessages || []).join(',')}`
        );
        patchSessionByBindingId(key, {
          peerCapabilities: capabilities,
        });
      },
      onAppMessage: async (message: PairV2PeerAppMessage) => {
        const revoke = parseOpenClawPairChannelRevoke(message);
        if (revoke) {
          closePeer(key, 'channel revoked by desktop');
          removeSessionLocal({
            id: revoke.channelId,
            bindingId: revoke.bindingId || key,
            deviceId: trustedPeerId,
          });
          return;
        }
        const ack = parseOpenClawPairChatAck(message);
        if (ack) {
          return;
        }
        const pong = parseOpenClawPairChatPong(message);
        if (pong) {
          const current = getSessionByBindingIdSnapshot(key);
          if (!current) {
            return;
          }
          applyLinkPong(current, pong, 'p2p');
          return;
        }
        const ping = parseOpenClawPairChatPing(message);
        if (ping) {
          const current = getSessionByBindingIdSnapshot(key);
          if (!current) {
            return;
          }
          await respondToLinkPing(current, ping, false);
          return;
        }
        const syncState = parseOpenClawPairChatSyncState(message);
        if (syncState) {
          const current = getSessionByBindingIdSnapshot(key);
          if (!current) {
            return;
          }
          await handleDesktopSyncState(current, syncState, false);
          return;
        }
        const syncRequest = parseOpenClawPairChatSyncRequest(message);
        if (syncRequest) {
          const current = getSessionByBindingIdSnapshot(key);
          if (!current) {
            return;
          }
          await resendKnownMessages(current, syncRequest.messageIds, false);
          return;
        }
        await appRegistry.dispatch(message, undefined);
      },
    });

    peersRef.current.set(key, peer);
    updatePeerState(key, session.peerState || 'idle', session.peerDetail || '');
    return peer;
  }

  async function ensureSessionPeerConnected(session: SessionItem, timeoutMs = 8000, retries = 1) {
    const latest = getSessionByIdSnapshot(session.id) || session;
    if (latest.trustState !== 'active') {
      return false;
    }
    const bindingId = String(latest.bindingId || '').trim();
    if (!bindingId) {
      return false;
    }

    const pending = peerConnectingRef.current.get(bindingId);
    if (pending) {
      return pending;
    }

    const task = (async () => {
      let currentTarget = latest;
      let attemptsLeft = retries;

      loop: while (true) {
        const peer = await ensureSessionPeer(currentTarget);
        if (!peer.isReady() && !isPeerNegotiating(peer.getState())) {
          await peer.connect();
        }

        const startedAt = Date.now();
        while (Date.now() - startedAt < timeoutMs) {
          if (peer.isReady()) {
            return true;
          }
          await new Promise<void>((resolve) => {
            globalThis.setTimeout(resolve, 120);
          });
        }

        if (peer.isReady()) {
          return true;
        }

        if (attemptsLeft <= 0) {
          console.log(`[pair-mobile] connect timeout binding=${bindingId} state=${peer.getState()}`);
          break loop;
        }

        attemptsLeft -= 1;
        await new Promise<void>((resolve) => {
          globalThis.setTimeout(resolve, 240);
        });
        currentTarget = getSessionByIdSnapshot(session.id) || currentTarget;
      }

      return false;
    })().finally(() => {
      const current = peerConnectingRef.current.get(bindingId);
      if (current === task) {
        peerConnectingRef.current.delete(bindingId);
      }
    });

    peerConnectingRef.current.set(bindingId, task);
    return task;
  }

  async function connectReadyPeers(targetBaseUrl = '') {
    const candidates = sessionsRef.current.filter((session) => {
      if (targetBaseUrl && session.serverBaseUrl !== targetBaseUrl) {
        return false;
      }
      return session.trustState === 'active';
    });

    for (const session of candidates) {
      try {
        await ensureSessionPeerConnected(session, 10000, 0);
      } catch (error) {
        markPeerFailure(session, error);
      }
    }
  }

  function handleSignalEvent(baseUrl: string, envelope: PairV2SignalEvent) {
    const type = String(envelope.type || '').trim();
    const fromId = String(envelope.from?.id || '').trim();
    const payload = (envelope.payload || {}) as Record<string, unknown>;

    if (type === 'stream.opened') {
      return;
    }

    if (type === 'pair.approved') {
      const bindingId = String(payload.bindingId || payload.binding_id || '').trim();
      const deviceId = String(payload.deviceId || payload.device_id || fromId || '').trim();
      updateSessions((current) =>
        current.map((item) => {
          if (item.bindingId !== bindingId && item.deviceId !== deviceId) {
            return item;
          }
          return {
            ...item,
            trustState: String(payload.trustState || payload.trust_state || 'active'),
            approvedAt: Number(payload.approvedAt || payload.approved_at || Date.now()),
            status: 'connected',
            transportReady: true,
            preview: '桌面端已批准配对，正在尝试直连；失败会自动切换服务端转发。',
          };
        })
      );
      void refreshSessions();
      const target = getSessionByBindingIdSnapshot(bindingId) || getSessionByDeviceIdSnapshot(deviceId);
      if (target) {
        void ensureSessionPeerConnected(target);
      }
      return;
    }

    if (type === 'pair.revoked') {
      const bindingId = String(payload.bindingId || payload.binding_id || '').trim();
      const deviceId = String(payload.deviceId || payload.device_id || fromId || '').trim();
      if (bindingId) {
        closePeer(bindingId, 'binding revoked');
      }
      updateSessions((current) =>
        current.map((item) => {
          if (item.bindingId !== bindingId && item.deviceId !== deviceId) {
            return item;
          }
          return {
            ...item,
            trustState: 'revoked',
            status: 'offline',
            transportReady: false,
            preview: '绑定已撤销',
          };
        })
      );
      return;
    }

    if (type === 'relay.app') {
      const bindingId = String(payload.bindingId || payload.binding_id || '').trim();
      const deviceId = String(payload.deviceId || payload.device_id || fromId || '').trim();
      const session = getSessionByBindingIdSnapshot(bindingId) || getSessionByDeviceIdSnapshot(deviceId);
      if (!session) {
        void refreshSessions();
        return;
      }
      const message =
        payload.message && typeof payload.message === 'object'
          ? (payload.message as PairV2PeerAppMessage)
          : null;
      if (!message) {
        return;
      }
      const revoke = parseOpenClawPairChannelRevoke(message);
      if (revoke) {
        if (bindingId) {
          closePeer(bindingId, 'channel revoked by desktop');
        }
        removeSessionLocal({
          id: revoke.channelId,
          bindingId: revoke.bindingId || bindingId,
          deviceId,
        });
        return;
      }
      patchSessionById(session.id, {
        transportReady: true,
        linkTransport: 'relay',
        preview:
          session.peerState === 'connected'
            ? session.preview
            : '已切换到服务端转发，可继续聊天。',
      });
      const syncRequest = parseOpenClawPairChatSyncRequest(message);
      if (syncRequest) {
        void resendKnownMessages(session, syncRequest.messageIds, true);
        return;
      }
      const ack = parseOpenClawPairChatAck(message);
      if (ack) {
        return;
      }
      const pong = parseOpenClawPairChatPong(message);
      if (pong) {
        applyLinkPong(session, pong, 'relay');
        return;
      }
      const ping = parseOpenClawPairChatPing(message);
      if (ping) {
        void respondToLinkPing(session, ping, true);
        return;
      }
      const syncState = parseOpenClawPairChatSyncState(message);
      if (syncState) {
        void handleDesktopSyncState(session, syncState, true);
        return;
      }
      if (String(message.type || '').trim() === openClawPairChatMessageType) {
        const payload =
          message.payload && typeof message.payload === 'object'
            ? message.payload
            : {};
        const text = String(payload.text || '').trim();
        if (!text) {
          return;
        }
        const result = upsertRemoteChatMessage(session.id, {
          id: String(payload.id || '').trim(),
          from: 'host',
          text,
          ts: Number(message.ts || Date.now()),
          origin: payload.origin === 'mobile' ? 'mobile' : 'host',
          originSeq: Math.max(0, Math.trunc(Number(payload.originSeq || 0))),
          after: Array.isArray(payload.after) ? payload.after.map((value) => String(value || '')) : [],
        });
        void acknowledgeMessages(session, [String(payload.id || '').trim()], true);
        if (result.newlyMissingMessageIds.length > 0) {
          void requestMissingMessages(session, result.newlyMissingMessageIds, true);
        }
      }
      return;
    }

    if (type === 'webrtc.offer' || type === 'webrtc.answer' || type === 'webrtc.ice') {
      const bindingId = String(payload.bindingId || payload.binding_id || '').trim();
      const deviceId = String(payload.deviceId || payload.device_id || fromId || '').trim();
      console.log(`[pair-mobile] signal type=${type} binding=${bindingId || '-'} device=${deviceId || '-'}`);
      const session = getSessionByBindingIdSnapshot(bindingId) || getSessionByDeviceIdSnapshot(deviceId);
      if (!session) {
        void refreshSessions();
        return;
      }
      void ensureSessionPeer(session)
        .then((peer) =>
          peer.handleSignal(type, {
            bindingId,
            description: (payload.description as RTCSessionDescriptionInit | undefined) || undefined,
            candidate: (payload.candidate as RTCIceCandidateInit | null | undefined) || undefined,
          })
        )
        .catch((error) => {
          markPeerFailure(session, error, `处理 ${type} 失败`);
        });
    }
  }

  async function ensureSignalConnected(baseUrl: string) {
    const auth = await ensureMobileAuthV2(baseUrl);
    const normalizedBaseUrl = String(auth.baseUrl || '').trim();
    const existing = signalStreamsRef.current.get(normalizedBaseUrl);
    if (existing && existing.token === auth.token && existing.stream.readyState !== 2) {
      return existing.stream.readyState === 1 || existing.stream.readyState === 0;
    }

    const pending = signalConnectingRef.current.get(normalizedBaseUrl);
    if (pending) {
      return pending;
    }

    closeSignal(normalizedBaseUrl);

    const promise = new Promise<boolean>((resolve) => {
      const stream = openPairV2SignalStream(normalizedBaseUrl, auth.token, 'mobile', auth.mobileId);
      signalStreamsRef.current.set(normalizedBaseUrl, {
        stream,
        token: auth.token,
      });

      let settled = false;
      const finish = (ok: boolean) => {
        if (settled) {
          return;
        }
        settled = true;
        signalConnectingRef.current.delete(normalizedBaseUrl);
        resolve(ok);
      };

      const timer = globalThis.setTimeout(() => {
        finish(stream.readyState === 1);
      }, 6000);

      stream.onopen = () => {
        globalThis.clearTimeout(timer);
        finish(true);
        void refreshSessions().then(() => {
          const scopedSessions = sessionsRef.current.filter(
            (session) => String(session.serverBaseUrl || '').trim() === normalizedBaseUrl
          );
          void heartbeatSessionsPresence(scopedSessions, 'signal-open', MESSAGE_SYNC_RESUME_THROTTLE_MS);
          void syncSessionsWithDesktopState(scopedSessions, 'signal-open');
          for (const session of scopedSessions) {
            void probeSessionLink(session, 'signal-open', {
              minIntervalMs: MESSAGE_SYNC_RESUME_THROTTLE_MS,
            });
          }
        });
        void connectReadyPeers(normalizedBaseUrl);
      };

      stream.onmessage = (event) => {
        try {
          const payload = JSON.parse(String(event.data || '')) as PairV2SignalEvent;
          handleSignalEvent(normalizedBaseUrl, payload);
        } catch {
          // ignore malformed events
        }
      };

      stream.onerror = () => {
        if (stream.readyState === 2) {
          globalThis.clearTimeout(timer);
          finish(false);
        }
      };

      if ('onclose' in stream) {
        stream.onclose = () => {
          if (signalStreamsRef.current.get(normalizedBaseUrl)?.stream === stream) {
            signalStreamsRef.current.delete(normalizedBaseUrl);
          }
        };
      }
    });

    signalConnectingRef.current.set(normalizedBaseUrl, promise);
    return promise;
  }

  async function reconcileRealtime(nextSessions: SessionItem[]) {
    closeStalePeers(nextSessions);
    pruneMessageSyncTimestamps(nextSessions);
    prunePresenceHeartbeatTimestamps(nextSessions);
    pruneLinkProbeState(nextSessions);

    const nextBaseUrls = new Set(uniqueBaseUrls(nextSessions));
    for (const baseUrl of [...signalStreamsRef.current.keys()]) {
      if (!nextBaseUrls.has(baseUrl)) {
        closeSignal(baseUrl);
      }
    }

    for (const baseUrl of nextBaseUrls) {
      void ensureSignalConnected(baseUrl);
    }
    void connectReadyPeers();
  }

  async function refreshSessions() {
    const requestBase = sessionsRef.current;
    console.log(
      `[pair-mobile] refreshSessions start count=${requestBase.length} bindings=${requestBase
        .map((item) => `${item.bindingId || '-'}:${item.trustState || '-'}`)
        .join(',')}`
    );
    const refreshed = await refreshSessionsV2(requestBase);
    const merged = mergeRefreshedSessions(sessionsRef.current, refreshed);
    console.log(
      `[pair-mobile] refreshSessions done count=${merged.length} bindings=${merged
        .map((item) => `${item.bindingId || '-'}:${item.trustState || '-'}`)
        .join(',')}`
    );
    commitSessions(merged);
    await reconcileRealtime(merged);
  }

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      const stored = await loadStoredSessions();
      if (cancelled) {
        return;
      }
      commitSessions(stored);
      loadedRef.current = true;

      if (stored.length === 0) {
        return;
      }

      const refreshed = await refreshSessionsV2(stored);
      if (cancelled) {
        return;
      }
      const merged = mergeRefreshedSessions(sessionsRef.current, refreshed);
      commitSessions(merged);
      await reconcileRealtime(merged);
      await heartbeatSessionsPresence(merged, 'bootstrap');
      await syncSessionsWithDesktopState(merged, 'bootstrap');
      for (const session of merged) {
        await probeSessionLink(session, 'bootstrap');
      }
    }

    void bootstrap();

    return () => {
      cancelled = true;
      console.log('[pair-mobile] SessionsProvider cleanup');
      if (refreshTimerRef.current) {
        clearInterval(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
      if (messageSyncTimerRef.current) {
        clearInterval(messageSyncTimerRef.current);
        messageSyncTimerRef.current = null;
      }
      for (const bindingId of [...peersRef.current.keys()]) {
        closePeer(bindingId, 'app closed');
      }
      for (const baseUrl of [...signalStreamsRef.current.keys()]) {
        closeSignal(baseUrl);
      }
    };
  }, []);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      const previousState = appStateRef.current;
      appStateRef.current = nextState;
      const becameActive =
        (previousState === 'inactive' || previousState === 'background') &&
        nextState === 'active';
      if (!becameActive) {
        return;
      }
      void refreshSessions().then(() => {
        void heartbeatSessionsPresence(
          sessionsRef.current,
          'app-active',
          MESSAGE_SYNC_RESUME_THROTTLE_MS
        );
        void syncSessionsWithDesktopState(
          sessionsRef.current,
          'app-active',
          MESSAGE_SYNC_RESUME_THROTTLE_MS
        );
        for (const session of sessionsRef.current) {
          void probeSessionLink(session, 'app-active', {
            minIntervalMs: MESSAGE_SYNC_RESUME_THROTTLE_MS,
          });
        }
      });
    });
    return () => {
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    if (!loadedRef.current) {
      return;
    }

    if (__DEV__) {
      const target = sessions.find((session) => session.peerState === 'connected' && session.transportReady);
      if (target && !debugAutoMessageTriggeredRef.current.has(target.id)) {
        void AsyncStorage.getItem(DEBUG_AUTO_MESSAGE_KEY).then(async (value) => {
          const raw = String(value || '').trim();
          if (!raw) {
            return;
          }
          debugAutoMessageTriggeredRef.current.add(target.id);
          console.log(`[pair-mobile] debug auto message -> binding=${target.bindingId} text=${raw}`);
          try {
            await sendMessage(target.id, raw);
            await AsyncStorage.removeItem(DEBUG_AUTO_MESSAGE_KEY);
          } catch (error) {
            debugAutoMessageTriggeredRef.current.delete(target.id);
            console.log(
              `[pair-mobile] debug auto message failed binding=${target.bindingId} error=${
                error instanceof Error ? error.message : String(error || '')
              }`
            );
          }
        });
      }
    }

    void saveStoredSessions(sessions);

    if (sessions.length > 0 && !refreshTimerRef.current) {
      refreshTimerRef.current = setInterval(() => {
        void refreshSessions();
      }, 30_000);
    }
    if (sessions.length === 0 && refreshTimerRef.current) {
      clearInterval(refreshTimerRef.current);
      refreshTimerRef.current = null;
    }

    if (sessions.length > 0 && !messageSyncTimerRef.current) {
      messageSyncTimerRef.current = setInterval(() => {
        void heartbeatSessionsPresence(sessionsRef.current, 'interval', PRESENCE_HEARTBEAT_INTERVAL_MS);
        void syncSessionsWithDesktopState(sessionsRef.current, 'interval', MESSAGE_SYNC_INTERVAL_MS);
        for (const session of sessionsRef.current) {
          void probeSessionLink(session, 'interval', {
            minIntervalMs: LINK_PING_INTERVAL_MS,
          });
        }
      }, MESSAGE_SYNC_INTERVAL_MS);
    }
    if (sessions.length === 0 && messageSyncTimerRef.current) {
      clearInterval(messageSyncTimerRef.current);
      messageSyncTimerRef.current = null;
    }

    void reconcileRealtime(sessions);
  }, [sessions]);

  function getSessionById(sessionId: string) {
    return sessions.find((item) => item.id === sessionId) || null;
  }

  function removeSession(sessionId: string) {
    const session = getSessionByIdSnapshot(sessionId);
    if (session?.bindingId) {
      closePeer(session.bindingId, 'session removed');
      if (String(session.trustState || '').trim() === 'active') {
        void sendChannelRevoke(session).catch(() => {
          // ignore delivery failures during local removal
        });
      }
    }
    removeSessionLocal({ id: sessionId });
  }

  async function pairByScan(raw: string) {
    const result = await pairByScanV2(raw, sessionsRef.current);
    commitSessions(result.sessions);
    await reconcileRealtime(result.sessions);
    await heartbeatSessionsPresence(result.sessions, 'pair-scan');
    for (const session of result.sessions) {
      await probeSessionLink(session, 'pair-scan');
    }
    return {
      session: result.session,
      created: result.created,
    };
  }

  async function sendMessage(
    sessionId: string,
    text: string,
    options: {
      messageId?: string;
      ts?: number;
    } = {}
  ) {
    const session = getSessionByIdSnapshot(sessionId);
    if (!session) {
      throw new Error('会话不存在');
    }

    const normalizedText = String(text || '').trim();
    if (!normalizedText) {
      throw new Error('请输入消息内容');
    }

    if (String(session.trustState || '').trim() === 'pending') {
      throw new Error(`请先在桌面端确认安全码${session.safetyCode ? ` ${session.safetyCode}` : ''}`);
    }
    if (String(session.trustState || '').trim() === 'revoked') {
      throw new Error('该绑定已被撤销，无法发送消息');
    }
    const draftSession = getSessionByIdSnapshot(session.id) || session;
    const messageTs = Math.max(0, Math.trunc(Number(options.ts || Date.now())));
    const messageId =
      String(options.messageId || '').trim() ||
      createOpenClawPairChatMessageId(messageTs);
    const after = collectSessionLeafIds(draftSession.messages || []);
    const originSeq = nextOriginSeq(draftSession.messages || [], 'mobile');

    appendMessageLocal(draftSession.id, {
      id: messageId,
      from: 'self',
      text: normalizedText,
      ts: messageTs,
      kind: 'chat',
      origin: 'mobile',
      originSeq,
      after,
      deliveryStatus: 'sending',
    });

    try {
      await deliverLocalChatMessage(draftSession, {
        id: messageId,
        text: normalizedText,
        ts: messageTs,
        after,
        originSeq,
      });
    } catch (error) {
      updateMessageDeliveryState(
        session.id,
        messageId,
        'failed',
        error instanceof Error ? error.message : '消息发送失败'
      );
      throw error;
    }
    return {
      messageId,
      ts: messageTs,
    };
  }

  async function retryMessage(sessionId: string, messageId: string) {
    const session = getSessionByIdSnapshot(sessionId);
    if (!session) {
      throw new Error('会话不存在');
    }
    const target = (session.messages || []).find((message) => String(message.id || '').trim() === String(messageId || '').trim());
    if (!target || target.from !== 'self' || target.kind === 'system') {
      throw new Error('该消息无法重发');
    }
    if (target.deliveryStatus !== 'failed') {
      return;
    }

    updateMessageDeliveryState(session.id, target.id, 'sending');
    try {
      await deliverLocalChatMessage(session, {
        id: target.id,
        text: String(target.text || ''),
        ts: Number(target.ts || Date.now()),
        after: Array.isArray(target.after) ? [...target.after] : [],
        originSeq: Math.max(0, Math.trunc(Number(target.originSeq || 0))),
      });
    } catch (error) {
      updateMessageDeliveryState(
        session.id,
        target.id,
        'failed',
        error instanceof Error ? error.message : '消息发送失败'
      );
      throw error;
    }
  }

  const value = useMemo<SessionsContextValue>(
    () => ({
      sessions,
      getSessionById,
      removeSession,
      pairByScan,
      sendMessage,
      retryMessage,
      refreshSessions,
    }),
    [sessions]
  );

  return <SessionsContext.Provider value={value}>{children}</SessionsContext.Provider>;
}

export function useSessions() {
  const context = useContext(SessionsContext);
  if (!context) {
    throw new Error('useSessions must be used within SessionsProvider');
  }
  return context;
}
