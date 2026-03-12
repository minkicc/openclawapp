import { Html5Qrcode } from "html5-qrcode";

type SignalMode = "none" | "ws" | "sse";
type SessionStatus = "connecting" | "connected" | "disconnected";

type SessionMessage = {
  id: string;
  from: "mobile" | "desktop";
  text: string;
  ts: number;
};

type SessionEntry = {
  id: string;
  name: string;
  createdAt: number;
  status: SessionStatus;
  serverBaseUrl: string;
  serverToken: string;
  deviceId: string;
  pairSessionId: string;
  bindingId: string;
  messages: SessionMessage[];
};

type ClaimResponse = {
  ok: boolean;
  session: {
    pairSessionId?: string;
    pair_session_id?: string;
    deviceId?: string;
    device_id?: string;
  };
  binding: {
    bindingId?: string;
    binding_id?: string;
    deviceId?: string;
    device_id?: string;
    userId?: string;
    user_id?: string;
    mobileId?: string;
    mobile_id?: string;
  };
};

type SendSignalResponse = {
  ok: boolean;
  deliveredRealtime: boolean;
  event: {
    id: string;
    type: string;
  };
};

const homeView = document.getElementById("homeView") as HTMLDivElement;
const chatView = document.getElementById("chatView") as HTMLDivElement;
const sessionList = document.getElementById("sessionList") as HTMLDivElement;
const pairBtn = document.getElementById("pairBtn") as HTMLButtonElement;
const chatBackBtn = document.getElementById("chatBackBtn") as HTMLButtonElement;
const chatTitle = document.getElementById("chatTitle") as HTMLHeadingElement;
const chatSubtitle = document.getElementById("chatSubtitle") as HTMLParagraphElement;
const chatMessages = document.getElementById("chatMessages") as HTMLDivElement;
const chatInput = document.getElementById("chatInput") as HTMLTextAreaElement;
const chatSendBtn = document.getElementById("chatSendBtn") as HTMLButtonElement;
const toast = document.getElementById("toast") as HTMLDivElement;

const USER_ID_KEY = "openclaw.mobile.user_id";
const MOBILE_ID_KEY = "openclaw.mobile.mobile_id";
const SESSIONS_KEY = "openclaw.mobile.sessions.v2";

let sessions: SessionEntry[] = [];
let activeSessionId = "";
let scanRunning = false;
let toastTimer: number | null = null;

let signalSource: EventSource | null = null;
let signalWs: WebSocket | null = null;
let signalMode: SignalMode = "none";
let signalBaseUrl = "";
let signalMobileId = "";
let signalWsRequestSeq = 0;
const signalWsPending = new Map<
  string,
  { resolve: (value: SendSignalResponse) => void; reject: (error: Error) => void; timer: number }
>();

function showToast(message: string, type: "info" | "error" = "info") {
  const text = String(message || "").trim();
  if (!text) {
    return;
  }
  toast.textContent = text;
  toast.classList.remove("hidden", "error");
  if (type === "error") {
    toast.classList.add("error");
  }
  if (toastTimer !== null) {
    globalThis.clearTimeout(toastTimer);
  }
  toastTimer = globalThis.setTimeout(() => {
    toast.classList.add("hidden");
    toastTimer = null;
  }, 2200);
}

function escapeHtml(text: string) {
  return String(text || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function randomId(prefix: string) {
  const raw = globalThis.crypto?.randomUUID?.().replace(/-/g, "").slice(0, 12)
    || Math.random().toString(16).slice(2, 14);
  return `${prefix}_${raw}`;
}

function createLocalId(prefix: string) {
  const raw = globalThis.crypto?.randomUUID?.().replace(/-/g, "").slice(0, 10)
    || Math.random().toString(16).slice(2, 12);
  return `${prefix}_${raw}`;
}

function normalizeServerBaseUrl(raw: string) {
  const text = String(raw || "").trim();
  if (!text) {
    throw new Error("服务端地址不能为空");
  }
  const parsed = new URL(text);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("服务端地址必须是 http/https");
  }
  parsed.hash = "";
  parsed.search = "";
  parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  return parsed.toString().replace(/\/+$/, "");
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
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  if (query) {
    url.search = query.toString();
  }
  return url.toString();
}

async function requestJson<T>(
  baseUrl: string,
  path: string,
  init: RequestInit = {},
  token = ""
): Promise<T> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    ...(init.headers as Record<string, string> | undefined),
  };
  const auth = String(token || "").trim();
  if (auth) {
    headers.authorization = `Bearer ${auth}`;
  }
  const res = await fetch(buildApiUrl(baseUrl, path), {
    ...init,
    headers,
  });
  const data = await res.json().catch(() => ({} as Record<string, unknown>));
  if (!res.ok || (data as { ok?: boolean }).ok === false) {
    const message = (data as { message?: string; error?: string }).message
      || (data as { message?: string; error?: string }).error
      || `HTTP ${res.status}`;
    throw new Error(message);
  }
  return data as T;
}

function ensureIdentityValues() {
  const userId = String(localStorage.getItem(USER_ID_KEY) || "").trim() || createLocalId("user");
  const mobileId = String(localStorage.getItem(MOBILE_ID_KEY) || "").trim() || createLocalId("mobile");
  localStorage.setItem(USER_ID_KEY, userId);
  localStorage.setItem(MOBILE_ID_KEY, mobileId);
  return { userId, mobileId };
}

function statusText(status: SessionStatus) {
  if (status === "connected") {
    return "已连接";
  }
  if (status === "connecting") {
    return "连接中";
  }
  return "未连接";
}

function formatTime(ts: number) {
  const value = Number(ts || 0);
  if (!Number.isFinite(value) || value <= 0) {
    return "-";
  }
  return new Date(value).toLocaleString();
}

function formatChatClock(ts: number) {
  const value = Number(ts || 0);
  if (!Number.isFinite(value) || value <= 0) {
    return "--:--";
  }
  return new Date(value).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function compactDeviceId(deviceId: string) {
  const text = String(deviceId || "").trim();
  if (text.length <= 12) {
    return text;
  }
  return `${text.slice(0, 4)}...${text.slice(-4)}`;
}

function sessionNameSuffix(seed: string) {
  const normalized = String(seed || "")
    .trim()
    .replaceAll("_", "")
    .replace(/[^a-zA-Z0-9]/g, "");
  if (normalized) {
    return normalized.slice(-6);
  }
  return Date.now().toString().slice(-6);
}

function defaultSessionName(seed: string) {
  return `连接-${sessionNameSuffix(seed)}`;
}

function saveSessions() {
  localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
}

function loadSessions() {
  const raw = String(localStorage.getItem(SESSIONS_KEY) || "").trim();
  if (!raw) {
    sessions = [];
    return;
  }
  try {
    const parsed = JSON.parse(raw) as unknown[];
    if (!Array.isArray(parsed)) {
      sessions = [];
      return;
    }
    sessions = parsed
      .map((item) => {
        const value = item as Record<string, unknown>;
        const id = String(value.id || "").trim();
        const deviceId = String(value.deviceId || "").trim();
        const serverBaseUrl = String(value.serverBaseUrl || "").trim();
        if (!id || !deviceId || !serverBaseUrl) {
          return null;
        }
        return {
          id,
          name: String(value.name || "").trim() || defaultSessionName(deviceId),
          createdAt: Number(value.createdAt || Date.now()),
          status: (String(value.status || "disconnected") as SessionStatus),
          serverBaseUrl,
          serverToken: String(value.serverToken || "").trim(),
          deviceId,
          pairSessionId: String(value.pairSessionId || "").trim(),
          bindingId: String(value.bindingId || "").trim(),
          messages: Array.isArray(value.messages)
            ? value.messages.map((msg) => {
              const m = msg as Record<string, unknown>;
              return {
                id: String(m.id || randomId("msg")),
                from: String(m.from || "desktop") === "mobile" ? "mobile" : "desktop",
                text: String(m.text || ""),
                ts: Number(m.ts || Date.now()),
              } as SessionMessage;
            })
            : [],
        } as SessionEntry;
      })
      .filter((item): item is SessionEntry => Boolean(item));
  } catch {
    sessions = [];
  }
}

function findSessionById(sessionId: string) {
  return sessions.find((item) => item.id === sessionId) || null;
}

function findSessionByDeviceId(deviceId: string) {
  const target = String(deviceId || "").trim();
  if (!target) {
    return null;
  }
  return sessions.find((item) => item.deviceId === target) || null;
}

function appendMessage(sessionId: string, message: SessionMessage) {
  const session = findSessionById(sessionId);
  if (!session) {
    return;
  }
  session.messages.push(message);
  if (session.messages.length > 300) {
    session.messages.splice(0, session.messages.length - 300);
  }
  saveSessions();
  if (activeSessionId === sessionId) {
    renderChatView();
  }
}

function setSessionStatus(status: SessionStatus, baseUrl = "") {
  sessions.forEach((session) => {
    if (!baseUrl || session.serverBaseUrl === baseUrl) {
      session.status = status;
    }
  });
  saveSessions();
  renderSessionList();
  renderChatView();
}

function renderSessionList() {
  if (sessions.length === 0) {
    sessionList.innerHTML = `<p class="empty">暂无会话，点击右上角“配对”创建连接。</p>`;
    return;
  }

  const html = sessions
    .slice()
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((session) => {
      const avatar = escapeHtml((session.name || "会话").slice(0, 1) || "会");
      const created = escapeHtml(formatTime(session.createdAt));
      const status = escapeHtml(statusText(session.status));
      const device = escapeHtml(compactDeviceId(session.deviceId));
      return `
      <article class="session-row" data-session-id="${escapeHtml(session.id)}">
        <div class="session-avatar">${avatar}</div>
        <div class="session-main">
          <div class="session-line session-line-top">
            <button class="session-name-btn" data-action="rename" data-session-id="${escapeHtml(session.id)}">${escapeHtml(session.name)}</button>
            <span class="session-created">${created}</span>
          </div>
          <div class="session-line session-line-bottom">
            <span class="session-status ${escapeHtml(session.status)}">${status}</span>
            <span class="session-device">${device}</span>
          </div>
        </div>
        <div class="session-actions">
          <button class="enter-btn" data-action="enter" data-session-id="${escapeHtml(session.id)}">进入</button>
          <button class="delete-btn" data-action="delete" data-session-id="${escapeHtml(session.id)}">删除</button>
        </div>
      </article>
    `;
    })
    .join("");
  sessionList.innerHTML = html;

  sessionList.querySelectorAll("button[data-action='rename']").forEach((node) => {
    node.addEventListener("click", () => {
      const button = node as HTMLButtonElement;
      const sessionId = String(button.dataset.sessionId || "").trim();
      const session = findSessionById(sessionId);
      if (!session) {
        return;
      }
      const nextName = String(globalThis.prompt("修改连接名称", session.name) || "").trim();
      session.name = nextName || defaultSessionName(session.deviceId);
      saveSessions();
      renderSessionList();
      renderChatView();
    });
  });

  sessionList.querySelectorAll("button[data-action='enter']").forEach((node) => {
    node.addEventListener("click", () => {
      const button = node as HTMLButtonElement;
      const sessionId = String(button.dataset.sessionId || "").trim();
      openSession(sessionId);
    });
  });

  sessionList.querySelectorAll("button[data-action='delete']").forEach((node) => {
    node.addEventListener("click", async () => {
      const button = node as HTMLButtonElement;
      const sessionId = String(button.dataset.sessionId || "").trim();
      await removeSession(sessionId);
    });
  });

  sessionList.querySelectorAll(".session-row").forEach((node) => {
    node.addEventListener("click", (event) => {
      const target = event.target as HTMLElement;
      if (target.closest("button")) {
        return;
      }
      const sessionId = String((node as HTMLDivElement).dataset.sessionId || "").trim();
      openSession(sessionId);
    });
  });
}

function renderChatView() {
  if (!activeSessionId) {
    return;
  }
  const session = findSessionById(activeSessionId);
  if (!session) {
    closeSessionView();
    return;
  }
  chatTitle.textContent = session.name;
  chatSubtitle.textContent = statusText(session.status);

  if (!session.messages.length) {
    chatMessages.innerHTML = `<p class="chat-empty">暂时还没有消息</p>`;
    return;
  }

  let lastDividerTs = 0;
  chatMessages.innerHTML = session.messages.map((msg) => {
    const isOutgoing = msg.from === "mobile";
    const needDivider = !lastDividerTs || Math.abs(msg.ts - lastDividerTs) >= 3 * 60 * 1000;
    if (needDivider) {
      lastDividerTs = msg.ts;
    }
    const divider = needDivider ? `<div class="time-divider">${escapeHtml(formatChatClock(msg.ts))}</div>` : "";
    return `
      ${divider}
      <article class="chat-row ${isOutgoing ? "outgoing" : "incoming"}">
        ${isOutgoing ? "" : `<div class="chat-avatar desktop">PC</div>`}
        <div class="chat-bubble">${escapeHtml(msg.text)}</div>
        ${isOutgoing ? `<div class="chat-avatar mobile">我</div>` : ""}
      </article>
    `;
  }).join("");
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function openSession(sessionId: string) {
  const session = findSessionById(sessionId);
  if (!session) {
    return;
  }
  activeSessionId = sessionId;
  homeView.classList.add("hidden");
  chatView.classList.remove("hidden");
  renderChatView();
}

function closeSessionView() {
  activeSessionId = "";
  chatInput.value = "";
  chatView.classList.add("hidden");
  homeView.classList.remove("hidden");
}

function clearSignalWsPending(reason = "ws channel closed") {
  for (const [, pending] of signalWsPending) {
    globalThis.clearTimeout(pending.timer);
    pending.reject(new Error(reason));
  }
  signalWsPending.clear();
}

function closeSignal(silent = false) {
  if (signalSource) {
    signalSource.close();
    signalSource = null;
  }
  if (signalWs) {
    signalWs.onopen = null;
    signalWs.onmessage = null;
    signalWs.onerror = null;
    signalWs.onclose = null;
    try {
      signalWs.close();
    } catch {
      // no-op
    }
    signalWs = null;
  }
  signalMode = "none";
  signalBaseUrl = "";
  signalMobileId = "";
  clearSignalWsPending("signal closed");
  setSessionStatus("disconnected");
  if (!silent) {
    showToast("通信连接已关闭");
  }
}

function isSignalOpenFor(baseUrl: string) {
  const normalized = normalizeServerBaseUrl(baseUrl);
  if (signalBaseUrl !== normalized) {
    return false;
  }
  if (signalMode === "ws" && signalWs) {
    return signalWs.readyState === WebSocket.OPEN;
  }
  if (signalMode === "sse" && signalSource) {
    return signalSource.readyState === EventSource.OPEN;
  }
  return false;
}

function isSignalConnectingFor(baseUrl: string) {
  const normalized = normalizeServerBaseUrl(baseUrl);
  if (signalBaseUrl !== normalized) {
    return false;
  }
  if (signalMode === "ws" && signalWs) {
    return signalWs.readyState === WebSocket.CONNECTING;
  }
  if (signalMode === "sse" && signalSource) {
    return signalSource.readyState === EventSource.CONNECTING;
  }
  return false;
}

function handleSignalEvent(payload: Record<string, unknown>) {
  const type = String(payload.type || "").trim();
  const from = (payload.from || {}) as Record<string, unknown>;
  const fromType = String(from.type || "").trim();
  const fromId = String(from.id || "").trim();
  const data = (payload.payload || {}) as Record<string, unknown>;

  if (type === "chat.message" && fromType === "desktop") {
    const deviceId = fromId || String(data.deviceId || data.device_id || "").trim();
    if (!deviceId) {
      return;
    }
    let session = findSessionByDeviceId(deviceId);
    if (!session) {
      session = {
        id: randomId("sess"),
        name: defaultSessionName(deviceId),
        createdAt: Date.now(),
        status: "connected",
        serverBaseUrl: signalBaseUrl,
        serverToken: "",
        deviceId,
        pairSessionId: "",
        bindingId: "",
        messages: [],
      };
      sessions.push(session);
      saveSessions();
      renderSessionList();
    }
    session.status = "connected";
    const text = String(data.text || data.message || "").trim() || JSON.stringify(data);
    appendMessage(session.id, {
      id: randomId("msg"),
      from: "desktop",
      text,
      ts: Number(payload.ts || Date.now()),
    });
    if (activeSessionId !== session.id) {
      showToast(`收到 ${session.name} 新消息`);
    }
    renderSessionList();
    return;
  }
}

function sendSignalViaWs(
  payload: {
    toType: string;
    toId: string;
    type: string;
    payload?: Record<string, unknown>;
  }
) {
  if (signalMode !== "ws" || !signalWs || signalWs.readyState !== WebSocket.OPEN) {
    return Promise.reject(new Error("ws channel is not open"));
  }

  signalWsRequestSeq += 1;
  const requestId = `wsreq_${Date.now()}_${signalWsRequestSeq}`;
  return new Promise<SendSignalResponse>((resolve, reject) => {
    const timer = globalThis.setTimeout(() => {
      signalWsPending.delete(requestId);
      reject(new Error(`send ${payload.type} timeout`));
    }, 6000);

    signalWsPending.set(requestId, { resolve, reject, timer });
    try {
      signalWs.send(
        JSON.stringify({
          action: "signal.send",
          requestId,
          data: payload,
        })
      );
    } catch (error) {
      globalThis.clearTimeout(timer);
      signalWsPending.delete(requestId);
      reject(error as Error);
    }
  });
}

async function connectSignal(baseUrl: string, mobileId: string) {
  const normalizedBaseUrl = normalizeServerBaseUrl(baseUrl);
  if (isSignalOpenFor(normalizedBaseUrl) || isSignalConnectingFor(normalizedBaseUrl)) {
    return;
  }

  closeSignal(true);
  signalBaseUrl = normalizedBaseUrl;
  signalMobileId = mobileId;
  setSessionStatus("connecting", normalizedBaseUrl);

  const params = new URLSearchParams({
    clientType: "mobile",
    clientId: mobileId,
  });

  const wsUrl = buildWsUrl(normalizedBaseUrl, "/v1/signal/ws", params);
  const ws = new WebSocket(wsUrl);
  let settled = false;

  const settle = (ok: boolean) => {
    if (settled) {
      return;
    }
    settled = true;

    if (ok) {
      signalWs = ws;
      signalMode = "ws";
      setSessionStatus("connected", normalizedBaseUrl);

      ws.onopen = () => {
        // no-op
      };
      ws.onmessage = (event) => {
        try {
          const payload = JSON.parse(String(event.data || "")) as Record<string, unknown>;
          const kind = String(payload.kind || "").trim().toLowerCase();
          if (kind === "ack" || kind === "error") {
            const requestId = String(payload.requestId || "").trim();
            const pending = requestId ? signalWsPending.get(requestId) : null;
            if (pending) {
              globalThis.clearTimeout(pending.timer);
              signalWsPending.delete(requestId);
              if (kind === "ack" && payload.ok !== false) {
                pending.resolve(payload as SendSignalResponse);
              } else {
                pending.reject(new Error(String(payload.message || payload.code || "ws request failed")));
              }
            }
            return;
          }
          if (kind === "pong") {
            return;
          }
          handleSignalEvent(payload);
        } catch {
          // ignore malformed frame
        }
      };
      ws.onerror = () => {
        // no-op
      };
      ws.onclose = () => {
        clearSignalWsPending("ws closed");
        signalWs = null;
        if (signalMode === "ws") {
          signalMode = "none";
        }
        setSessionStatus("disconnected", normalizedBaseUrl);
      };
      return;
    }

    try {
      ws.close();
    } catch {
      // no-op
    }
    const streamUrl = buildApiUrl(normalizedBaseUrl, "/v1/signal/stream", params);
    signalSource = new EventSource(streamUrl);
    signalMode = "sse";

    signalSource.onopen = () => {
      setSessionStatus("connected", normalizedBaseUrl);
    };
    signalSource.onmessage = (event) => {
      try {
        const payload = JSON.parse(String(event.data || "")) as Record<string, unknown>;
        handleSignalEvent(payload);
      } catch {
        // ignore malformed frame
      }
    };
    signalSource.onerror = () => {
      const state = signalSource?.readyState;
      if (state === EventSource.CLOSED) {
        setSessionStatus("disconnected", normalizedBaseUrl);
      } else {
        setSessionStatus("connecting", normalizedBaseUrl);
      }
    };
  };

  const timer = globalThis.setTimeout(() => {
    settle(false);
  }, 3500);
  ws.onopen = () => {
    globalThis.clearTimeout(timer);
    settle(true);
  };
  ws.onerror = () => {
    globalThis.clearTimeout(timer);
    settle(false);
  };
  ws.onclose = () => {
    globalThis.clearTimeout(timer);
    settle(false);
  };
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    globalThis.setTimeout(resolve, ms);
  });
}

async function ensureSignalConnected(baseUrl: string, mobileId: string, timeoutMs = 5000) {
  const normalized = normalizeServerBaseUrl(baseUrl);
  if (isSignalOpenFor(normalized)) {
    return true;
  }
  await connectSignal(normalized, mobileId);
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (isSignalOpenFor(normalized)) {
      return true;
    }
    await sleep(120);
  }
  return false;
}

async function sendSignalMessage(
  session: SessionEntry,
  body: {
    fromType: string;
    fromId: string;
    toType: string;
    toId: string;
    type: string;
    payload?: Record<string, unknown>;
  }
) {
  if (signalMode === "ws" && signalWs?.readyState === WebSocket.OPEN && signalBaseUrl === session.serverBaseUrl) {
    return sendSignalViaWs({
      toType: body.toType,
      toId: body.toId,
      type: body.type,
      payload: body.payload || {},
    });
  }
  return requestJson<SendSignalResponse>(session.serverBaseUrl, "/v1/signal/send", {
    method: "POST",
    body: JSON.stringify(body),
  }, session.serverToken);
}

async function revokeSessionBinding(session: SessionEntry) {
  if (!session.bindingId) {
    return;
  }
  await requestJson<Record<string, unknown>>(session.serverBaseUrl, "/v1/pair/revoke", {
    method: "POST",
    body: JSON.stringify({
      bindingId: session.bindingId,
    }),
  }, session.serverToken);
}

async function removeSession(sessionId: string) {
  const session = findSessionById(sessionId);
  if (!session) {
    return;
  }
  if (!globalThis.confirm(`确认删除会话“${session.name}”吗？`)) {
    return;
  }
  try {
    await revokeSessionBinding(session);
  } catch (error) {
    showToast(`解绑失败：${(error as Error).message}`, "error");
  }

  sessions = sessions.filter((item) => item.id !== sessionId);
  saveSessions();
  if (activeSessionId === sessionId) {
    closeSessionView();
  }
  renderSessionList();
  if (!sessions.length) {
    closeSignal(true);
  }
  showToast("会话已删除");
}

function parsePairPayload(payload: Record<string, unknown>) {
  const baseUrl = String(payload.baseUrl || payload.base_url || "").trim();
  const pairToken = String(payload.pairToken || payload.pair_token || "").trim();
  const pairCode = String(payload.pairCode || payload.pair_code || "").trim();
  const sessionId = String(payload.sessionId || payload.session_id || "").trim();
  const deviceId = String(payload.deviceId || payload.device_id || "").trim();
  const serverToken = String(payload.token || payload.serverToken || payload.server_token || "").trim();
  return { baseUrl, pairToken, pairCode, sessionId, deviceId, serverToken };
}

async function claimByToken(
  baseUrl: string,
  pairToken: string,
  userId: string,
  mobileId: string,
  serverToken = ""
) {
  const result = await requestJson<ClaimResponse>(baseUrl, "/v1/pair/claim", {
    method: "POST",
    body: JSON.stringify({ pairToken, userId, mobileId }),
  }, serverToken);
  const sessionId = String(result.session?.pairSessionId || result.session?.pair_session_id || "").trim();
  const deviceId = String(result.binding?.deviceId || result.binding?.device_id || result.session?.deviceId || result.session?.device_id || "").trim();
  const bindingId = String(result.binding?.bindingId || result.binding?.binding_id || "").trim();
  return { sessionId, deviceId, bindingId };
}

async function claimByCode(
  baseUrl: string,
  pairCode: string,
  userId: string,
  mobileId: string,
  pairSessionId = "",
  serverToken = ""
) {
  try {
    const result = await requestJson<ClaimResponse>(baseUrl, "/v1/pair/claim-by-code", {
      method: "POST",
      body: JSON.stringify({ pairCode, userId, mobileId }),
    }, serverToken);
    const sessionId = String(result.session?.pairSessionId || result.session?.pair_session_id || "").trim();
    const deviceId = String(result.binding?.deviceId || result.binding?.device_id || result.session?.deviceId || result.session?.device_id || "").trim();
    const bindingId = String(result.binding?.bindingId || result.binding?.binding_id || "").trim();
    return { sessionId, deviceId, bindingId };
  } catch (error) {
    const message = (error as Error)?.message || String(error);
    if (!/route not found/i.test(message)) {
      throw error;
    }
    if (!pairSessionId) {
      throw new Error("缺少 session_id，无法兼容旧版 claim");
    }
    const legacy = await requestJson<Record<string, unknown>>(baseUrl, "/pair/claim", {
      method: "POST",
      body: JSON.stringify({
        session_id: pairSessionId,
        pair_code: pairCode,
        user_id: userId,
      }),
    }, serverToken);
    const data = (legacy.data || {}) as Record<string, unknown>;
    return {
      sessionId: String(data.session_id || pairSessionId).trim(),
      deviceId: String(data.device_id || data.deviceId || "").trim(),
      bindingId: "",
    };
  }
}

async function scanQrByCamera() {
  const overlay = document.createElement("div");
  overlay.style.position = "fixed";
  overlay.style.inset = "0";
  overlay.style.background = "rgba(0, 0, 0, 0.72)";
  overlay.style.zIndex = "9999";
  overlay.style.display = "flex";
  overlay.style.flexDirection = "column";
  overlay.style.alignItems = "center";
  overlay.style.justifyContent = "center";
  overlay.style.padding = "16px";

  const panel = document.createElement("div");
  panel.style.width = "min(92vw, 420px)";
  panel.style.background = "#0f172a";
  panel.style.border = "1px solid #304560";
  panel.style.borderRadius = "12px";
  panel.style.padding = "12px";
  panel.style.display = "grid";
  panel.style.gap = "10px";

  const title = document.createElement("div");
  title.textContent = "请将二维码放入取景框";
  title.style.color = "#e7eefb";
  title.style.fontWeight = "700";

  const readerId = `openclaw-qr-reader-${Date.now()}`;
  const reader = document.createElement("div");
  reader.id = readerId;
  reader.style.borderRadius = "8px";
  reader.style.overflow = "hidden";
  reader.style.background = "#000";

  const actions = document.createElement("div");
  actions.style.display = "flex";
  actions.style.justifyContent = "flex-end";

  const cancelBtn = document.createElement("button");
  cancelBtn.textContent = "取消扫码";
  cancelBtn.style.border = "1px solid #8ea6c1";
  cancelBtn.style.background = "#1f2f45";
  cancelBtn.style.color = "#e7eefb";
  cancelBtn.style.borderRadius = "8px";
  cancelBtn.style.padding = "8px 12px";
  cancelBtn.style.fontWeight = "700";
  cancelBtn.style.cursor = "pointer";

  actions.appendChild(cancelBtn);
  panel.appendChild(title);
  panel.appendChild(reader);
  panel.appendChild(actions);
  overlay.appendChild(panel);
  document.body.appendChild(overlay);

  const scanner = new Html5Qrcode(readerId);
  let finished = false;

  const cleanup = async () => {
    if (finished) {
      return;
    }
    finished = true;
    try {
      await scanner.stop();
    } catch {
      // no-op
    }
    try {
      await scanner.clear();
    } catch {
      // no-op
    }
    overlay.remove();
  };

  return await new Promise<string>(async (resolve, reject) => {
    cancelBtn.addEventListener("click", async () => {
      await cleanup();
      reject(new Error("scan canceled"));
    });

    try {
      await scanner.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 260, height: 260 } },
        async (decodedText) => {
          const text = String(decodedText || "").trim();
          if (!text) {
            return;
          }
          await cleanup();
          resolve(text);
        },
        () => {
          // ignore per-frame decode errors
        }
      );
    } catch (error) {
      await cleanup();
      reject(error as Error);
    }
  });
}

async function pairByQr() {
  if (scanRunning) {
    return;
  }
  scanRunning = true;
  pairBtn.disabled = true;
  try {
    const raw = await scanQrByCamera();
    const payload = JSON.parse(raw) as Record<string, unknown>;
    const parsed = parsePairPayload(payload);

    if (!parsed.baseUrl) {
      throw new Error("二维码缺少服务端地址");
    }
    if (!parsed.pairToken && !parsed.pairCode) {
      throw new Error("二维码缺少认领凭证");
    }

    const baseUrl = normalizeServerBaseUrl(parsed.baseUrl);
    const { userId, mobileId } = ensureIdentityValues();
    let claimed: { sessionId: string; deviceId: string; bindingId: string };
    if (parsed.pairToken) {
      claimed = await claimByToken(baseUrl, parsed.pairToken, userId, mobileId, parsed.serverToken);
    } else {
      claimed = await claimByCode(
        baseUrl,
        parsed.pairCode,
        userId,
        mobileId,
        parsed.sessionId,
        parsed.serverToken
      );
    }

    const deviceId = String(claimed.deviceId || parsed.deviceId || "").trim();
    if (!deviceId) {
      throw new Error("认领成功但未返回目标设备 ID");
    }

    let session = findSessionByDeviceId(deviceId);
    if (!session) {
      session = {
        id: randomId("sess"),
        name: defaultSessionName(deviceId),
        createdAt: Date.now(),
        status: "connecting",
        serverBaseUrl: baseUrl,
        serverToken: parsed.serverToken,
        deviceId,
        pairSessionId: claimed.sessionId || parsed.sessionId,
        bindingId: claimed.bindingId,
        messages: [],
      };
      sessions.push(session);
    } else {
      session.serverBaseUrl = baseUrl;
      session.serverToken = parsed.serverToken;
      session.pairSessionId = claimed.sessionId || parsed.sessionId || session.pairSessionId;
      session.bindingId = claimed.bindingId || session.bindingId;
      session.status = "connecting";
    }

    saveSessions();
    renderSessionList();
    const connected = await ensureSignalConnected(baseUrl, mobileId);
    session.status = connected ? "connected" : "disconnected";
    saveSessions();
    renderSessionList();
    showToast("配对成功");
  } catch (error) {
    showToast((error as Error).message || "配对失败", "error");
  } finally {
    scanRunning = false;
    pairBtn.disabled = false;
  }
}

async function sendChatMessage() {
  const session = findSessionById(activeSessionId);
  if (!session) {
    return;
  }
  const text = String(chatInput.value || "").trim();
  if (!text) {
    showToast("请输入消息", "error");
    return;
  }
  const { mobileId } = ensureIdentityValues();
  const connected = await ensureSignalConnected(session.serverBaseUrl, mobileId);
  if (!connected) {
    session.status = "disconnected";
    saveSessions();
    renderSessionList();
    renderChatView();
    showToast("通信连接未建立", "error");
    return;
  }

  try {
    await sendSignalMessage(session, {
      fromType: "mobile",
      fromId: mobileId,
      toType: "desktop",
      toId: session.deviceId,
      type: "chat.message",
      payload: {
        text,
        sentAt: Date.now(),
      },
    });
    appendMessage(session.id, {
      id: randomId("msg"),
      from: "mobile",
      text,
      ts: Date.now(),
    });
    chatInput.value = "";
  } catch (error) {
    showToast(`发送失败：${(error as Error).message}`, "error");
  }
}

pairBtn.addEventListener("click", async () => {
  await pairByQr();
});

chatBackBtn.addEventListener("click", () => {
  closeSessionView();
});

chatSendBtn.addEventListener("click", async () => {
  await sendChatMessage();
});

chatInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
    event.preventDefault();
    void sendChatMessage();
  }
});

window.addEventListener("beforeunload", () => {
  closeSignal(true);
});

function bootstrap() {
  ensureIdentityValues();
  loadSessions();
  renderSessionList();
  if (sessions.length > 0) {
    const first = sessions[0];
    const { mobileId } = ensureIdentityValues();
    void ensureSignalConnected(first.serverBaseUrl, mobileId);
  }
}

bootstrap();
