import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  createPairV2AppRegistry,
  openPairV2SignalStream,
  PairV2PeerChannel,
  revokePairV2Binding,
  sendPairV2Signal,
  type PairV2PeerAppMessage,
  type PairV2PeerCapabilities,
  type PairV2SignalEvent,
  type PairV2SignalStreamLike,
} from '@openclaw/pair-sdk';
import {
  buildOpenClawPairChatPayload,
  createOpenClawPairChatModule,
  openClawPairChatMessageType,
  supportsOpenClawPairChat,
} from '@openclaw/message-sdk';
import type { ChatMessage, SessionItem } from '../types/session';
import {
  ensureMobileAuthV2,
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
  sendMessage: (sessionId: string, text: string) => Promise<void>;
  refreshSessions: () => Promise<void>;
};

type SignalStreamEntry = {
  stream: PairV2SignalStreamLike;
  token: string;
};

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

export function SessionsProvider({ children }: { children: ReactNode }) {
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const sessionsRef = useRef<SessionItem[]>([]);
  const loadedRef = useRef(false);
  const signalStreamsRef = useRef(new Map<string, SignalStreamEntry>());
  const signalConnectingRef = useRef(new Map<string, Promise<boolean>>());
  const peersRef = useRef(new Map<string, PairV2PeerChannel>());
  const refreshTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

  function appendMessageLocal(
    sessionId: string,
    message: { from: ChatMessage['from']; text: string; createdAt?: string }
  ) {
    const text = String(message.text || '').trim();
    if (!text) {
      return;
    }

    updateSessions((current) =>
      current.map((item) => {
        if (item.id !== sessionId) {
          return item;
        }
        const nextMessage: ChatMessage = {
          id: randomId('msg'),
          from: message.from,
          text,
          createdAt: message.createdAt || formatMessageTime(),
        };
        return {
          ...item,
          preview: text,
          isReplying: false,
          messages: [...(item.messages || []), nextMessage].slice(-300),
        };
      })
    );
  }

  function updatePeerState(bindingId: string, state: string, detail = '') {
    patchSessionByBindingId(bindingId, {
      peerState: state,
      peerDetail: detail,
      transportReady: state === 'connected',
      preview:
        state === 'connected'
          ? 'P2P 通道已建立，可以开始聊天。'
          : isPeerNegotiating(state)
            ? '正在建立 P2P 通道...'
            : undefined,
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
        closePeer(bindingId, 'session removed');
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
          appendMessageLocal(current.id, {
            from: 'host',
            text: chat.text,
            createdAt: formatMessageTime(new Date(chat.ts)),
          });
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
        appId: 'openclaw',
        appVersion: 'mobile',
      }),
      onSignal: async (type, payload) => {
        await sendPeerSignal(session.serverBaseUrl, trustedPeerId, type, payload);
      },
      onStateChange: (state, detail) => {
        updatePeerState(key, state, detail || '');
      },
      onCapabilities: (capabilities) => {
        patchSessionByBindingId(key, {
          peerCapabilities: capabilities,
        });
      },
      onAppMessage: async (message: PairV2PeerAppMessage) => {
        await appRegistry.dispatch(message, undefined);
      },
    });

    peersRef.current.set(key, peer);
    updatePeerState(key, session.peerState || 'idle', session.peerDetail || '');
    return peer;
  }

  async function ensureSessionPeerConnected(session: SessionItem, timeoutMs = 8000) {
    const latest = getSessionByIdSnapshot(session.id) || session;
    if (latest.trustState !== 'active' || latest.status !== 'connected') {
      return false;
    }

    const peer = await ensureSessionPeer(latest);
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
    return peer.isReady();
  }

  async function connectReadyPeers(targetBaseUrl = '') {
    const candidates = sessionsRef.current.filter((session) => {
      if (targetBaseUrl && session.serverBaseUrl !== targetBaseUrl) {
        return false;
      }
      return session.trustState === 'active' && session.status === 'connected';
    });

    for (const session of candidates) {
      try {
        await ensureSessionPeerConnected(session, 3000);
      } catch {
        // ignore per-session peer connection failures
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
            preview: '桌面端已批准配对，正在建立 P2P 通道...',
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

    if (type === 'webrtc.offer' || type === 'webrtc.answer' || type === 'webrtc.ice') {
      const bindingId = String(payload.bindingId || payload.binding_id || '').trim();
      const deviceId = String(payload.deviceId || payload.device_id || fromId || '').trim();
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
        .catch(() => {
          // ignore peer signal errors here
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
        void refreshSessions();
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
    const refreshed = await refreshSessionsV2(sessionsRef.current);
    commitSessions(refreshed);
    await reconcileRealtime(refreshed);
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
      commitSessions(refreshed);
      await reconcileRealtime(refreshed);
    }

    void bootstrap();

    return () => {
      cancelled = true;
      if (refreshTimerRef.current) {
        clearInterval(refreshTimerRef.current);
        refreshTimerRef.current = null;
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
    if (!loadedRef.current) {
      return;
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

    void reconcileRealtime(sessions);
  }, [sessions]);

  function getSessionById(sessionId: string) {
    return sessions.find((item) => item.id === sessionId) || null;
  }

  function removeSession(sessionId: string) {
    const session = getSessionByIdSnapshot(sessionId);
    if (session?.bindingId) {
      closePeer(session.bindingId, 'session removed');
      void ensureMobileAuthV2(session.serverBaseUrl)
        .then((auth) => revokePairV2Binding(session.serverBaseUrl, auth.token, session.bindingId))
        .catch(() => {
          // ignore revoke failures during local removal
        });
    }
    updateSessions((current) => current.filter((item) => item.id !== sessionId));
  }

  async function pairByScan(raw: string) {
    const result = await pairByScanV2(raw, sessionsRef.current);
    commitSessions(result.sessions);
    await reconcileRealtime(result.sessions);
    return {
      session: result.session,
      created: result.created,
    };
  }

  async function sendMessage(sessionId: string, text: string) {
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
    if (!supportsOpenClawPairChat(session.peerCapabilities as Pick<PairV2PeerCapabilities, 'supportedMessages'> | undefined)) {
      throw new Error('当前桌面端未声明聊天能力');
    }

    const connected = await ensureSignalConnected(session.serverBaseUrl);
    if (!connected) {
      throw new Error('信令连接未建立');
    }

    const peerReady = await ensureSessionPeerConnected(session);
    if (!peerReady) {
      throw new Error('P2P 通道尚未建立');
    }

    const peer = await ensureSessionPeer(session);
    await peer.sendAppMessage(openClawPairChatMessageType, buildOpenClawPairChatPayload(normalizedText));
    appendMessageLocal(session.id, {
      from: 'self',
      text: normalizedText,
    });
  }

  const value = useMemo<SessionsContextValue>(
    () => ({
      sessions,
      getSessionById,
      removeSession,
      pairByScan,
      sendMessage,
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
