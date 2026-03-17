import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { ChatMessage, ConnectionStatus, SessionItem } from '../types/session';

type CreateSessionResult = {
  session: SessionItem;
  created: boolean;
};

type PairPayload = {
  baseUrl: string;
  pairToken: string;
  pairCode: string;
  sessionId: string;
  deviceId: string;
  serverToken: string;
};

type ClaimResult = {
  sessionId: string;
  deviceId: string;
  bindingId: string;
  authToken: string;
};

type SignalEnvelope = {
  type?: string;
  ts?: number;
  from?: {
    type?: string;
    id?: string;
  };
  payload?: Record<string, unknown>;
};

type SendSignalAck = {
  ok: boolean;
  deliveredRealtime?: boolean;
  event?: {
    id: string;
    type: string;
  };
};

type PendingWsRequest = {
  resolve: (value: SendSignalAck) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

type SessionsContextValue = {
  sessions: SessionItem[];
  getSessionById: (sessionId: string) => SessionItem | null;
  removeSession: (sessionId: string) => void;
  pairByScan: (raw: string) => Promise<CreateSessionResult>;
  sendMessage: (sessionId: string, text: string) => Promise<void>;
};

const SessionsContext = createContext<SessionsContextValue | null>(null);

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

function normalizeServerBaseUrl(raw: string) {
  const text = String(raw || '').trim();
  if (!text) {
    throw new Error('服务端地址不能为空');
  }

  const parsed = new URL(text);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('服务端地址必须是 http/https');
  }

  parsed.hash = '';
  parsed.search = '';
  parsed.pathname = parsed.pathname.replace(/\/+$/, '');
  return parsed.toString().replace(/\/+$/, '');
}

function buildApiUrl(baseUrl: string, path: string, query?: URLSearchParams) {
  const url = new URL(path, `${baseUrl}/`);
  if (query) {
    url.search = query.toString();
  }
  return url.toString();
}

function buildWsUrl(baseUrl: string, path: string, query?: URLSearchParams) {
  const url = new URL(path, `${baseUrl}/`);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  if (query) {
    url.search = query.toString();
  }
  return url.toString();
}

function parsePairPayload(raw: string): PairPayload {
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  return {
    baseUrl: String(parsed.baseUrl || parsed.base_url || '').trim(),
    pairToken: String(parsed.pairToken || parsed.pair_token || '').trim(),
    pairCode: String(parsed.pairCode || parsed.pair_code || '').trim(),
    sessionId: String(parsed.sessionId || parsed.session_id || '').trim(),
    deviceId: String(parsed.deviceId || parsed.device_id || '').trim(),
    serverToken: String(parsed.token || parsed.serverToken || parsed.server_token || '').trim(),
  };
}

async function requestJson<T>(
  baseUrl: string,
  path: string,
  init: RequestInit = {},
  token = '',
): Promise<T> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    ...(init.headers as Record<string, string> | undefined),
  };
  const auth = String(token || '').trim();
  if (auth) {
    headers.authorization = `Bearer ${auth}`;
  }

  const response = await fetch(buildApiUrl(baseUrl, path), {
    ...init,
    headers,
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

async function claimByToken(
  baseUrl: string,
  pairToken: string,
  userId: string,
  mobileId: string,
  serverToken = '',
): Promise<ClaimResult> {
  const result = await requestJson<{
    authToken?: string;
    auth_token?: string;
    session?: {
      pairSessionId?: string;
      pair_session_id?: string;
      deviceId?: string;
      device_id?: string;
    };
    binding?: {
      bindingId?: string;
      binding_id?: string;
      deviceId?: string;
      device_id?: string;
    };
  }>(
    baseUrl,
    '/v1/pair/claim',
    {
      method: 'POST',
      body: JSON.stringify({ pairToken, userId, mobileId }),
    },
    serverToken,
  );

  return {
    sessionId: String(result.session?.pairSessionId || result.session?.pair_session_id || '').trim(),
    deviceId: String(result.binding?.deviceId || result.binding?.device_id || result.session?.deviceId || result.session?.device_id || '').trim(),
    bindingId: String(result.binding?.bindingId || result.binding?.binding_id || '').trim(),
    authToken: String(result.authToken || result.auth_token || '').trim(),
  };
}

async function claimByCode(
  baseUrl: string,
  pairCode: string,
  userId: string,
  mobileId: string,
  serverToken = '',
): Promise<ClaimResult> {
  const result = await requestJson<{
    authToken?: string;
    auth_token?: string;
    session?: {
      pairSessionId?: string;
      pair_session_id?: string;
      deviceId?: string;
      device_id?: string;
    };
    binding?: {
      bindingId?: string;
      binding_id?: string;
      deviceId?: string;
      device_id?: string;
    };
  }>(
    baseUrl,
    '/v1/pair/claim-by-code',
    {
      method: 'POST',
      body: JSON.stringify({ pairCode, userId, mobileId }),
    },
    serverToken,
  );

  return {
    sessionId: String(result.session?.pairSessionId || result.session?.pair_session_id || '').trim(),
    deviceId: String(result.binding?.deviceId || result.binding?.device_id || result.session?.deviceId || result.session?.device_id || '').trim(),
    bindingId: String(result.binding?.bindingId || result.binding?.binding_id || '').trim(),
    authToken: String(result.authToken || result.auth_token || '').trim(),
  };
}

export function SessionsProvider({ children }: { children: ReactNode }) {
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const sessionsRef = useRef<SessionItem[]>([]);
  const identityRef = useRef<{ userId: string; mobileId: string } | null>(null);
  const signalWsRef = useRef<WebSocket | null>(null);
  const signalConnectingRef = useRef<Promise<boolean> | null>(null);
  const signalBaseUrlRef = useRef('');
  const signalMobileIdRef = useRef('');
  const signalTokenRef = useRef('');
  const signalWsRequestSeqRef = useRef(0);
  const signalWsPendingRef = useRef<Map<string, PendingWsRequest>>(new Map());

  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  useEffect(() => {
    return () => {
      const currentWs = signalWsRef.current;
      signalWsRef.current = null;
      if (currentWs) {
        try {
          currentWs.close();
        } catch {
          // ignore close errors
        }
      }
      for (const [, pending] of signalWsPendingRef.current) {
        clearTimeout(pending.timer);
        pending.reject(new Error('signal closed'));
      }
      signalWsPendingRef.current.clear();
    };
  }, []);

  function ensureIdentityValues() {
    if (!identityRef.current) {
      identityRef.current = {
        userId: createLocalId('user'),
        mobileId: createLocalId('mobile'),
      };
    }
    return identityRef.current;
  }

  function getSessionByIdSnapshot(sessionId: string) {
    return sessionsRef.current.find((item) => item.id === sessionId) || null;
  }

  function getSessionByDeviceIdSnapshot(deviceId: string) {
    return sessionsRef.current.find((item) => item.deviceId === deviceId) || null;
  }

  function getSessionById(sessionId: string) {
    return sessions.find((item) => item.id === sessionId) || null;
  }

  function upsertSession(next: SessionItem) {
    setSessions((current) => {
      const index = current.findIndex((item) => item.deviceId === next.deviceId || item.id === next.id);
      if (index < 0) {
        return [next, ...current];
      }
      const currentMessages = Array.isArray(current[index].messages) ? current[index].messages : [];
      const nextMessages = Array.isArray(next.messages) ? next.messages : [];
      const merged = {
        ...current[index],
        ...next,
        messages: nextMessages.length >= currentMessages.length ? nextMessages : currentMessages,
      };
      const cloned = current.slice();
      cloned[index] = merged;
      return cloned;
    });
  }

  function patchSessionById(sessionId: string, patch: Partial<SessionItem>) {
    setSessions((current) =>
      current.map((item) =>
        item.id === sessionId
          ? {
              ...item,
              ...patch,
            }
          : item,
      ),
    );
  }

  function patchSessionByDeviceId(deviceId: string, patch: Partial<SessionItem>) {
    setSessions((current) =>
      current.map((item) =>
        item.deviceId === deviceId
          ? {
              ...item,
              ...patch,
            }
          : item,
      ),
    );
  }

  function setStatusForBaseUrl(baseUrl: string, status: ConnectionStatus) {
    const normalized = normalizeServerBaseUrl(baseUrl);
    setSessions((current) =>
      current.map((item) =>
        normalizeServerBaseUrl(item.serverBaseUrl) === normalized
          ? {
              ...item,
              status,
            }
          : item,
      ),
    );
  }

  function appendMessageLocal(sessionId: string, message: Omit<ChatMessage, 'id' | 'createdAt'>) {
    const text = String(message.text || '').trim();
    if (!text) {
      return;
    }

    setSessions((current) =>
      current.map((item) => {
        if (item.id !== sessionId) {
          return item;
        }

        const nextMessage: ChatMessage = {
          id: randomId('msg'),
          from: message.from,
          text,
          createdAt: formatMessageTime(),
        };
        const nextMessages = [...item.messages, nextMessage].slice(-300);

        return {
          ...item,
          preview: text,
          messages: nextMessages,
        };
      }),
    );
  }

  function handleSignalEvent(envelope: SignalEnvelope) {
    const type = String(envelope.type || '').trim();
    const fromType = String(envelope.from?.type || '').trim();
    const fromId = String(envelope.from?.id || '').trim();
    const payload = envelope.payload || {};

    if (fromType !== 'desktop') {
      return;
    }

    const deviceId = fromId || String(payload.deviceId || payload.device_id || '').trim();
    if (!deviceId) {
      return;
    }

    if (type === 'agent.reply.started') {
      const existing = getSessionByDeviceIdSnapshot(deviceId);
      if (!existing) {
        return;
      }
      patchSessionByDeviceId(deviceId, {
        status: 'connected',
        isReplying: true,
        preview: 'Agent 正在回复...',
      });
      return;
    }

    if (type !== 'chat.message') {
      return;
    }

    const text = String(payload.text || payload.message || '').trim() || JSON.stringify(payload);
    const existing = getSessionByDeviceIdSnapshot(deviceId);
    const nextSession: SessionItem = existing
      ? {
          ...existing,
          status: 'connected',
          isReplying: false,
        }
      : {
          id: randomId('sess'),
          name: defaultSessionName(deviceId),
          status: 'connected',
          isReplying: false,
          createdAt: formatCreatedAt(),
          peerLabel: `Agent Host / ${compactPeer(deviceId)}`,
          preview: '',
          messages: [],
          serverBaseUrl: signalBaseUrlRef.current,
          serverToken: signalTokenRef.current,
          deviceId,
          pairSessionId: '',
          bindingId: '',
        };

    upsertSession(nextSession);
    const target = getSessionByDeviceIdSnapshot(deviceId) || nextSession;
    appendMessageLocal(target.id, {
      from: 'host',
      text,
    });
  }

  function clearSignalWsPending(reason = 'ws channel closed') {
    for (const [, pending] of signalWsPendingRef.current) {
      clearTimeout(pending.timer);
      pending.reject(new Error(reason));
    }
    signalWsPendingRef.current.clear();
  }

  function closeSignalFor(baseUrl = '') {
    const currentWs = signalWsRef.current;
    signalWsRef.current = null;
    signalConnectingRef.current = null;
    if (currentWs) {
      currentWs.onopen = null;
      currentWs.onmessage = null;
      currentWs.onerror = null;
      currentWs.onclose = null;
      try {
        currentWs.close();
      } catch {
        // ignore close errors
      }
    }
    clearSignalWsPending('signal closed');
    if (baseUrl) {
      setStatusForBaseUrl(baseUrl, 'offline');
    }
    signalBaseUrlRef.current = '';
    signalMobileIdRef.current = '';
    signalTokenRef.current = '';
  }

  function isSignalOpenFor(baseUrl: string, token = '') {
    const currentWs = signalWsRef.current;
    return (
      Boolean(currentWs) &&
      currentWs?.readyState === WebSocket.OPEN &&
      signalBaseUrlRef.current === normalizeServerBaseUrl(baseUrl) &&
      signalTokenRef.current === String(token || '').trim()
    );
  }

  function sendSignalViaWs(payload: {
    toType: string;
    toId: string;
    type: string;
    payload?: Record<string, unknown>;
  }) {
    const currentWs = signalWsRef.current;
    if (!currentWs || currentWs.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('ws channel is not open'));
    }

    signalWsRequestSeqRef.current += 1;
    const requestId = `wsreq_${Date.now()}_${signalWsRequestSeqRef.current}`;

    return new Promise<SendSignalAck>((resolve, reject) => {
      const timer = setTimeout(() => {
        signalWsPendingRef.current.delete(requestId);
        reject(new Error(`send ${payload.type} timeout`));
      }, 10000);

      signalWsPendingRef.current.set(requestId, { resolve, reject, timer });
      try {
        currentWs.send(
          JSON.stringify({
            action: 'signal.send',
            requestId,
            data: payload,
          }),
        );
      } catch (error) {
        clearTimeout(timer);
        signalWsPendingRef.current.delete(requestId);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  async function connectSignal(baseUrl: string, mobileId: string, token = '') {
    const normalizedBaseUrl = normalizeServerBaseUrl(baseUrl);
    const normalizedToken = String(token || '').trim();

    if (isSignalOpenFor(normalizedBaseUrl, normalizedToken)) {
      return true;
    }

    if (signalConnectingRef.current && signalBaseUrlRef.current === normalizedBaseUrl && signalTokenRef.current === normalizedToken) {
      return signalConnectingRef.current;
    }

    closeSignalFor(normalizedBaseUrl);
    signalBaseUrlRef.current = normalizedBaseUrl;
    signalMobileIdRef.current = mobileId;
    signalTokenRef.current = normalizedToken;
    setStatusForBaseUrl(normalizedBaseUrl, 'waiting');

    const params = new URLSearchParams({
      clientType: 'mobile',
      clientId: mobileId,
    });
    if (normalizedToken) {
      params.set('token', normalizedToken);
    }

    const promise = new Promise<boolean>((resolve) => {
      const wsUrl = buildWsUrl(normalizedBaseUrl, '/v1/signal/ws', params);
      const ws = new WebSocket(wsUrl);
      let settled = false;

      const settle = (ok: boolean) => {
        if (settled) {
          return;
        }
        settled = true;
        signalConnectingRef.current = null;

        if (!ok) {
          try {
            ws.close();
          } catch {
            // ignore close errors
          }
          setStatusForBaseUrl(normalizedBaseUrl, 'offline');
          resolve(false);
          return;
        }

        signalWsRef.current = ws;
        setStatusForBaseUrl(normalizedBaseUrl, 'connected');

        ws.onmessage = (event) => {
          try {
            const payload = JSON.parse(String(event.data || '')) as Record<string, unknown>;
            const kind = String(payload.kind || '').trim().toLowerCase();
            if (kind === 'ack' || kind === 'error') {
              const requestId = String(payload.requestId || '').trim();
              const pending = requestId ? signalWsPendingRef.current.get(requestId) : null;
              if (pending) {
                clearTimeout(pending.timer);
                signalWsPendingRef.current.delete(requestId);
                if (kind === 'ack' && payload.ok !== false) {
                  pending.resolve(payload as SendSignalAck);
                } else {
                  pending.reject(new Error(String(payload.message || payload.code || 'ws request failed')));
                }
              }
              return;
            }
            if (kind === 'pong') {
              return;
            }
            handleSignalEvent(payload as SignalEnvelope);
          } catch {
            // ignore malformed frame
          }
        };

        ws.onerror = () => {
          // no-op
        };

        ws.onclose = () => {
          clearSignalWsPending('ws closed');
          signalWsRef.current = null;
          if (signalBaseUrlRef.current === normalizedBaseUrl) {
            setStatusForBaseUrl(normalizedBaseUrl, 'offline');
          }
        };

        resolve(true);
      };

      const timer = setTimeout(() => {
        settle(false);
      }, 6000);

      ws.onopen = () => {
        clearTimeout(timer);
        settle(true);
      };

      ws.onerror = () => {
        clearTimeout(timer);
        settle(false);
      };

      ws.onclose = () => {
        clearTimeout(timer);
        settle(false);
      };
    });

    signalConnectingRef.current = promise;
    return promise;
  }

  async function ensureSignalConnected(baseUrl: string, mobileId: string, token = '') {
    if (isSignalOpenFor(baseUrl, token)) {
      return true;
    }
    return connectSignal(baseUrl, mobileId, token);
  }

  async function sendSignalMessage(
    session: SessionItem,
    body: {
      fromType: string;
      fromId: string;
      toType: string;
      toId: string;
      type: string;
      payload?: Record<string, unknown>;
    },
  ) {
    if (isSignalOpenFor(session.serverBaseUrl, session.serverToken)) {
      return sendSignalViaWs({
        toType: body.toType,
        toId: body.toId,
        type: body.type,
        payload: body.payload || {},
      });
    }

    return requestJson<SendSignalAck>(
      session.serverBaseUrl,
      '/v1/signal/send',
      {
        method: 'POST',
        body: JSON.stringify(body),
      },
      session.serverToken,
    );
  }

  async function pairByScan(raw: string): Promise<CreateSessionResult> {
    const parsed = parsePairPayload(raw);
    if (!parsed.baseUrl) {
      throw new Error('二维码缺少服务端地址');
    }
    if (!parsed.pairToken && !parsed.pairCode) {
      throw new Error('二维码缺少认领凭证');
    }

    const baseUrl = normalizeServerBaseUrl(parsed.baseUrl);
    const { userId, mobileId } = ensureIdentityValues();
    const claimed = parsed.pairToken
      ? await claimByToken(baseUrl, parsed.pairToken, userId, mobileId, parsed.serverToken)
      : await claimByCode(baseUrl, parsed.pairCode, userId, mobileId, parsed.serverToken);

    const deviceId = String(claimed.deviceId || parsed.deviceId || '').trim();
    if (!deviceId) {
      throw new Error('认领成功但未返回目标设备 ID');
    }

    const pairSessionId = String(claimed.sessionId || parsed.sessionId || '').trim();
    const existing = getSessionByDeviceIdSnapshot(deviceId);
    const created = !existing;
    const namingSeed = pairSessionId || deviceId;
    const existingUsesLegacyDefaultName =
      Boolean(existing) &&
      String(existing?.name || '').trim() === defaultSessionName(existing?.deviceId || '');
    const resolvedName =
      existing && !existingUsesLegacyDefaultName
        ? existing.name
        : defaultSessionName(namingSeed);

    const nextSession: SessionItem = {
      id: existing?.id || randomId('sess'),
      name: resolvedName,
      status: 'waiting',
      isReplying: false,
      createdAt: existing?.createdAt || formatCreatedAt(),
      peerLabel: `Agent Host / ${compactPeer(deviceId)}`,
      preview: existing?.preview || '配对成功，正在建立通信连接。',
      messages: existing?.messages || [],
      serverBaseUrl: baseUrl,
      serverToken: claimed.authToken || parsed.serverToken,
      deviceId,
      pairSessionId,
      bindingId: claimed.bindingId,
    };

    upsertSession(nextSession);
    const connected = await ensureSignalConnected(baseUrl, mobileId, nextSession.serverToken);
    const finalSession: SessionItem = {
      ...nextSession,
      status: connected ? 'connected' : 'offline',
      isReplying: false,
      preview: connected ? '通信链路已建立，可以开始收发消息。' : '已认领，但通信链路尚未建立。',
      messages:
        nextSession.messages.length > 0
          ? nextSession.messages
          : [
              {
                id: randomId('msg'),
                from: 'host',
                text: connected ? '配对成功，通信链路已建立。' : '配对成功，但当前未连上宿主机通道。',
                createdAt: formatMessageTime(),
              },
            ],
    };
    upsertSession(finalSession);

    return {
      session: finalSession,
      created,
    };
  }

  async function sendMessage(sessionId: string, text: string) {
    const session = getSessionByIdSnapshot(sessionId);
    if (!session) {
      throw new Error('会话不存在');
    }
    const message = String(text || '').trim();
    if (!message) {
      throw new Error('请输入消息内容');
    }
    if (!session.serverBaseUrl || !session.deviceId) {
      throw new Error('当前会话尚未完成真实配对');
    }

    // Optimistic echo: show the outgoing message immediately instead of
    // waiting for the transport connection and server ack.
    upsertSession({
      ...session,
      status: session.status === 'offline' ? 'waiting' : session.status,
      isReplying: false,
      preview: message,
    });
    appendMessageLocal(session.id, {
      from: 'self',
      text: message,
    });

    const { mobileId } = ensureIdentityValues();
    const connected = await ensureSignalConnected(session.serverBaseUrl, mobileId, session.serverToken);
    if (!connected) {
      patchSessionById(session.id, {
        status: 'offline',
        isReplying: false,
        preview: '通信连接未建立。',
      });
      throw new Error('通信连接未建立');
    }

    await sendSignalMessage(session, {
      fromType: 'mobile',
      fromId: mobileId,
      toType: 'desktop',
      toId: session.deviceId,
      type: 'chat.message',
      payload: {
        text: message,
        sentAt: Date.now(),
      },
    });

    patchSessionById(session.id, {
      status: 'connected',
      isReplying: false,
      preview: message,
    });
  }

  function removeSession(sessionId: string) {
    setSessions((current) => current.filter((item) => item.id !== sessionId));
  }

  const value = useMemo<SessionsContextValue>(
    () => ({
      sessions,
      getSessionById,
      removeSession,
      pairByScan,
      sendMessage,
    }),
    [sessions],
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
