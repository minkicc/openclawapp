import { MESSAGE_TYPES, createEnvelope } from "@openclaw/protocol";

const qrPayloadInput = document.getElementById("qrPayloadInput") as any;
const parsePayloadBtn = document.getElementById("parsePayloadBtn") as any;
const serverBaseUrlInput = document.getElementById("serverBaseUrlInput") as any;
const serverTokenInput = document.getElementById("serverTokenInput") as any;
const userIdInput = document.getElementById("userIdInput") as any;
const sessionIdInput = document.getElementById("sessionIdInput") as any;
const pairCodeInput = document.getElementById("pairCodeInput") as any;
const deviceIdInput = document.getElementById("deviceIdInput") as any;
const claimBtn = document.getElementById("claimBtn") as any;
const wsStatus = document.getElementById("wsStatus") as any;
const wsConnectBtn = document.getElementById("wsConnectBtn") as any;
const wsDisconnectBtn = document.getElementById("wsDisconnectBtn") as any;
const taskPromptInput = document.getElementById("taskPromptInput") as any;
const sendTaskBtn = document.getElementById("sendTaskBtn") as any;
const eventLog = document.getElementById("eventLog") as any;

let mobileWs = null;

function logEvent(line) {
  const stamp = new Date().toLocaleString();
  const text = `[${stamp}] ${line}`;
  eventLog.textContent = eventLog.textContent ? `${eventLog.textContent}\n${text}` : text;
  eventLog.scrollTop = eventLog.scrollHeight;
}

function normalizeServerBaseUrl(raw) {
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

function buildHttpUrl(baseUrl, path) {
  const parsed = new URL(baseUrl);
  parsed.pathname = path;
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString();
}

function buildWsUrl(baseUrl, userId) {
  const parsed = new URL(baseUrl);
  parsed.protocol = parsed.protocol === "https:" ? "wss:" : "ws:";
  parsed.pathname = "/ws/mobile";
  parsed.search = `user_id=${encodeURIComponent(userId)}`;
  const token = String(serverTokenInput.value || "").trim();
  if (token) {
    parsed.search += `&token=${encodeURIComponent(token)}`;
  }
  parsed.hash = "";
  return parsed.toString();
}

function requireText(value, fieldLabel) {
  const text = String(value || "").trim();
  if (!text) {
    throw new Error(`${fieldLabel}不能为空`);
  }
  return text;
}

function setWsStatus(text) {
  wsStatus.textContent = `通道状态：${text}`;
}

function parseQrPayload() {
  const raw = String(qrPayloadInput.value || "").trim();
  if (!raw) {
    throw new Error("请先粘贴二维码载荷 JSON");
  }
  const payload = JSON.parse(raw);
  if (!payload || typeof payload !== "object") {
    throw new Error("二维码载荷必须是 JSON 对象");
  }
  return payload;
}

function setButtons() {
  const open = mobileWs && mobileWs.readyState === WebSocket.OPEN;
  const connecting = mobileWs && mobileWs.readyState === WebSocket.CONNECTING;
  wsConnectBtn.disabled = open || connecting;
  wsDisconnectBtn.disabled = !mobileWs || mobileWs.readyState === WebSocket.CLOSED;
  sendTaskBtn.disabled = !open;
}

async function claimPairSession() {
  let baseUrl;
  let userId;
  let sessionId;
  let pairCode;

  try {
    baseUrl = normalizeServerBaseUrl(serverBaseUrlInput.value);
    userId = requireText(userIdInput.value, "用户 ID");
    sessionId = requireText(sessionIdInput.value, "Session ID");
    pairCode = requireText(pairCodeInput.value, "Pair Code");
  } catch (error) {
    logEvent(`claim failed: ${error.message || String(error)}`);
    return;
  }

  const endpoint = buildHttpUrl(baseUrl, "/pair/claim");
  const token = String(serverTokenInput.value || "").trim();
  const headers: Record<string, string> = {
    "Content-Type": "application/json"
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  logEvent(`claim -> ${endpoint}`);
  let response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({
        session_id: sessionId,
        pair_code: pairCode,
        user_id: userId
      })
    });
  } catch (error) {
    logEvent(`claim request failed: ${error.message || String(error)}`);
    return;
  }

  let result;
  try {
    result = await response.json();
  } catch {
    result = null;
  }

  if (!response.ok || !result?.ok || !result?.data) {
    const message = result?.error || result?.message || `HTTP ${response.status}`;
    logEvent(`claim failed: ${message}`);
    return;
  }

  const data = result.data;
  deviceIdInput.value = data.device_id || deviceIdInput.value || "";
  logEvent(`claim ok: device=${data.device_id || "-"} user=${data.user_id || "-"}`);
}

async function connectMobileWs() {
  let baseUrl;
  let userId;
  try {
    baseUrl = normalizeServerBaseUrl(serverBaseUrlInput.value);
    userId = requireText(userIdInput.value, "用户 ID");
  } catch (error) {
    logEvent(`ws connect failed: ${error.message || String(error)}`);
    return;
  }

  if (mobileWs) {
    try {
      mobileWs.close();
    } catch {
      // no-op
    }
    mobileWs = null;
  }

  const url = buildWsUrl(baseUrl, userId);
  logEvent(`ws connect -> ${url}`);
  setWsStatus("连接中");
  const ws = new WebSocket(url);
  mobileWs = ws;
  setButtons();

  ws.onopen = () => {
    setWsStatus("已连接");
    logEvent("ws connected");
    setButtons();
  };

  ws.onmessage = (event) => {
    const raw = String(event.data || "");
    try {
      const payload = JSON.parse(raw);
      if (payload.type === MESSAGE_TYPES.PAIR_CLAIMED) {
        const uid = payload?.payload?.user_id || payload?.user_id || "-";
        const did = payload?.payload?.device_id || payload?.device_id || "-";
        deviceIdInput.value = did;
        logEvent(`event pair.claimed user=${uid} device=${did}`);
        return;
      }
      logEvent(`event ${payload.type || "unknown"} ${raw.slice(0, 260)}`);
    } catch {
      logEvent(`event(raw) ${raw.slice(0, 260)}`);
    }
  };

  ws.onerror = () => {
    setWsStatus("异常");
    logEvent("ws error");
    setButtons();
  };

  ws.onclose = () => {
    setWsStatus("已断开");
    logEvent("ws closed");
    setButtons();
  };
}

function disconnectMobileWs() {
  if (!mobileWs) {
    setWsStatus("未连接");
    setButtons();
    return;
  }
  try {
    mobileWs.close();
  } catch {
    // no-op
  }
  mobileWs = null;
  setWsStatus("已断开");
  setButtons();
}

function sendTaskCreate() {
  if (!mobileWs || mobileWs.readyState !== WebSocket.OPEN) {
    logEvent("send task failed: websocket not connected");
    return;
  }

  let targetDeviceId;
  let userId;
  try {
    targetDeviceId = requireText(deviceIdInput.value, "目标设备 ID");
    userId = requireText(userIdInput.value, "用户 ID");
  } catch (error) {
    logEvent(`send task failed: ${error.message || String(error)}`);
    return;
  }

  const prompt = String(taskPromptInput.value || "").trim();
  if (!prompt) {
    logEvent("send task failed: 任务内容不能为空");
    return;
  }

  const envelope = createEnvelope({
    type: MESSAGE_TYPES.TASK_CREATE,
    userId,
    targetDeviceId,
    payload: {
      prompt
    }
  });

  mobileWs.send(JSON.stringify(envelope));
  logEvent(`send task.create -> ${targetDeviceId}`);
}

parsePayloadBtn.addEventListener("click", () => {
  try {
    const payload = parseQrPayload();
    if (payload.base_url) {
      serverBaseUrlInput.value = String(payload.base_url).trim();
    }
    if (payload.session_id) {
      sessionIdInput.value = String(payload.session_id).trim();
    }
    if (payload.pair_code) {
      pairCodeInput.value = String(payload.pair_code).trim();
    }
    logEvent("qr payload parsed");
  } catch (error) {
    logEvent(`parse payload failed: ${error.message || String(error)}`);
  }
});

claimBtn.addEventListener("click", async () => {
  await claimPairSession();
});

wsConnectBtn.addEventListener("click", async () => {
  await connectMobileWs();
});

wsDisconnectBtn.addEventListener("click", () => {
  disconnectMobileWs();
});

sendTaskBtn.addEventListener("click", () => {
  sendTaskCreate();
});

window.addEventListener("beforeunload", () => {
  disconnectMobileWs();
});

setButtons();
logEvent("mobile mvp ready");
