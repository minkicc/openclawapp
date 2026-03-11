const qrPayloadInput = document.getElementById("qrPayloadInput") as HTMLTextAreaElement;
const parsePayloadBtn = document.getElementById("parsePayloadBtn") as HTMLButtonElement;
const serverBaseUrlInput = document.getElementById("serverBaseUrlInput") as HTMLInputElement;
const serverTokenInput = document.getElementById("serverTokenInput") as HTMLInputElement;
const userIdInput = document.getElementById("userIdInput") as HTMLInputElement;
const mobileIdInput = document.getElementById("mobileIdInput") as HTMLInputElement;
const pairTokenInput = document.getElementById("pairTokenInput") as HTMLInputElement;
const pairCodeInput = document.getElementById("pairCodeInput") as HTMLInputElement;
const deviceIdInput = document.getElementById("deviceIdInput") as HTMLInputElement;

const claimByTokenBtn = document.getElementById("claimByTokenBtn") as HTMLButtonElement;
const claimByCodeBtn = document.getElementById("claimByCodeBtn") as HTMLButtonElement;

const signalStatus = document.getElementById("signalStatus") as HTMLParagraphElement;
const signalConnectBtn = document.getElementById("signalConnectBtn") as HTMLButtonElement;
const signalDisconnectBtn = document.getElementById("signalDisconnectBtn") as HTMLButtonElement;

const taskPromptInput = document.getElementById("taskPromptInput") as HTMLTextAreaElement;
const sendTaskBtn = document.getElementById("sendTaskBtn") as HTMLButtonElement;
const eventLog = document.getElementById("eventLog") as HTMLPreElement;

let signalSource: EventSource | null = null;

function logEvent(line: string) {
  const stamp = new Date().toLocaleString();
  const text = `[${stamp}] ${line}`;
  eventLog.textContent = eventLog.textContent ? `${eventLog.textContent}\n${text}` : text;
  eventLog.scrollTop = eventLog.scrollHeight;
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

function requireText(value: string, fieldLabel: string) {
  const text = String(value || "").trim();
  if (!text) {
    throw new Error(`${fieldLabel}不能为空`);
  }
  return text;
}

function setSignalStatus(text: string) {
  signalStatus.textContent = `信令状态：${text}`;
}

function setButtons() {
  const connected = signalSource?.readyState === EventSource.OPEN;
  const connecting = signalSource?.readyState === EventSource.CONNECTING;

  signalConnectBtn.disabled = Boolean(connected || connecting);
  signalDisconnectBtn.disabled = !signalSource;
  sendTaskBtn.disabled = false;

  claimByTokenBtn.disabled = false;
  claimByCodeBtn.disabled = false;
}

function buildApiUrl(baseUrl: string, path: string, query?: URLSearchParams) {
  const url = new URL(path, `${baseUrl}/`);
  if (query) {
    url.search = query.toString();
  }
  return url.toString();
}

async function requestJson<T>(
  baseUrl: string,
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    ...(init.headers as Record<string, string> | undefined),
  };

  const token = String(serverTokenInput.value || "").trim();
  if (token) {
    headers.authorization = `Bearer ${token}`;
  }

  const res = await fetch(buildApiUrl(baseUrl, path), {
    ...init,
    headers,
  });

  const data = await res.json().catch(() => ({} as Record<string, unknown>));
  if (!res.ok || (data as { ok?: boolean }).ok === false) {
    const message =
      (data as { message?: string; error?: string }).message ||
      (data as { message?: string; error?: string }).error ||
      `HTTP ${res.status}`;
    throw new Error(message);
  }

  return data as T;
}

function parsePayload() {
  const raw = String(qrPayloadInput.value || "").trim();
  if (!raw) {
    throw new Error("请先粘贴载荷 JSON");
  }

  const payload = JSON.parse(raw) as Record<string, unknown>;
  if (!payload || typeof payload !== "object") {
    throw new Error("载荷必须是 JSON 对象");
  }

  const baseUrl =
    typeof payload.baseUrl === "string"
      ? payload.baseUrl
      : typeof payload.base_url === "string"
        ? payload.base_url
        : "";

  const pairToken =
    typeof payload.pairToken === "string"
      ? payload.pairToken
      : typeof payload.pair_token === "string"
        ? payload.pair_token
        : "";

  const pairCode =
    typeof payload.pairCode === "string"
      ? payload.pairCode
      : typeof payload.pair_code === "string"
        ? payload.pair_code
        : "";

  const deviceId =
    typeof payload.deviceId === "string"
      ? payload.deviceId
      : typeof payload.device_id === "string"
        ? payload.device_id
        : "";

  if (baseUrl) {
    serverBaseUrlInput.value = baseUrl.trim();
  }
  if (pairToken) {
    pairTokenInput.value = pairToken.trim();
  }
  if (pairCode) {
    pairCodeInput.value = pairCode.trim();
  }
  if (deviceId) {
    deviceIdInput.value = deviceId.trim();
  }

  logEvent("payload parsed");
}

type ClaimResponse = {
  ok: boolean;
  session: {
    pairSessionId: string;
    deviceId: string;
    pairCode: string;
    pairToken: string;
    status: string;
  };
  binding: {
    bindingId: string;
    userId: string;
    deviceId: string;
    mobileId: string;
    status: string;
  };
};

async function claimByToken() {
  try {
    const baseUrl = normalizeServerBaseUrl(serverBaseUrlInput.value);
    const pairToken = requireText(pairTokenInput.value, "Pair Token");
    const userId = requireText(userIdInput.value, "用户 ID");
    const mobileId = requireText(mobileIdInput.value, "移动端 ID");

    const result = await requestJson<ClaimResponse>(baseUrl, "/v1/pair/claim", {
      method: "POST",
      body: JSON.stringify({ pairToken, userId, mobileId }),
    });

    deviceIdInput.value = result.binding.deviceId || result.session.deviceId || "";
    logEvent(
      `claim by token ok: device=${result.binding.deviceId} user=${result.binding.userId} mobile=${result.binding.mobileId}`
    );
  } catch (error) {
    logEvent(`claim by token failed: ${(error as Error).message}`);
  }
}

async function claimByCode() {
  try {
    const baseUrl = normalizeServerBaseUrl(serverBaseUrlInput.value);
    const pairCode = requireText(pairCodeInput.value, "Pair Code");
    const userId = requireText(userIdInput.value, "用户 ID");
    const mobileId = requireText(mobileIdInput.value, "移动端 ID");

    const result = await requestJson<ClaimResponse>(baseUrl, "/v1/pair/claim-by-code", {
      method: "POST",
      body: JSON.stringify({ pairCode, userId, mobileId }),
    });

    deviceIdInput.value = result.binding.deviceId || result.session.deviceId || "";
    logEvent(
      `claim by code ok: device=${result.binding.deviceId} user=${result.binding.userId} mobile=${result.binding.mobileId}`
    );
  } catch (error) {
    logEvent(`claim by code failed: ${(error as Error).message}`);
  }
}

function closeSignal() {
  if (signalSource) {
    signalSource.close();
    signalSource = null;
  }
  setSignalStatus("已断开");
  setButtons();
}

function handleSignalEvent(payload: Record<string, unknown>) {
  const type = String(payload.type || "unknown");

  if (type === "pair.claimed") {
    const data = (payload.payload || {}) as Record<string, unknown>;
    const did = String(data.deviceId || data.device_id || "").trim();
    if (did) {
      deviceIdInput.value = did;
    }
  }

  logEvent(`signal ${type}: ${JSON.stringify(payload).slice(0, 320)}`);
}

function connectSignal() {
  try {
    const baseUrl = normalizeServerBaseUrl(serverBaseUrlInput.value);
    const mobileId = requireText(mobileIdInput.value, "移动端 ID");

    closeSignal();

    const params = new URLSearchParams({
      clientType: "mobile",
      clientId: mobileId,
    });
    const streamUrl = buildApiUrl(baseUrl, "/v1/signal/stream", params);

    setSignalStatus("连接中");
    signalSource = new EventSource(streamUrl);
    setButtons();

    signalSource.onopen = () => {
      setSignalStatus("已连接（SSE）");
      logEvent(`signal connected -> ${streamUrl}`);
      setButtons();
    };

    signalSource.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data) as Record<string, unknown>;
        handleSignalEvent(payload);
      } catch {
        logEvent(`signal raw: ${String(event.data).slice(0, 320)}`);
      }
    };

    signalSource.onerror = () => {
      const state = signalSource?.readyState;
      if (state === EventSource.CLOSED) {
        setSignalStatus("已关闭");
      } else {
        setSignalStatus("重连中");
      }
      setButtons();
    };
  } catch (error) {
    logEvent(`connect signal failed: ${(error as Error).message}`);
    setSignalStatus("连接失败");
    setButtons();
  }
}

type SendSignalResponse = {
  ok: boolean;
  deliveredRealtime: boolean;
  event: {
    id: string;
    type: string;
  };
};

async function sendTaskCreate() {
  try {
    const baseUrl = normalizeServerBaseUrl(serverBaseUrlInput.value);
    const mobileId = requireText(mobileIdInput.value, "移动端 ID");
    const deviceId = requireText(deviceIdInput.value, "目标设备 ID");
    const prompt = requireText(taskPromptInput.value, "任务内容");

    const result = await requestJson<SendSignalResponse>(baseUrl, "/v1/signal/send", {
      method: "POST",
      body: JSON.stringify({
        fromType: "mobile",
        fromId: mobileId,
        toType: "desktop",
        toId: deviceId,
        type: "task.create",
        payload: { prompt },
      }),
    });

    logEvent(
      `task.create sent -> device=${deviceId} deliveredRealtime=${String(result.deliveredRealtime)}`
    );
  } catch (error) {
    logEvent(`send task.create failed: ${(error as Error).message}`);
  }
}

parsePayloadBtn.addEventListener("click", () => {
  try {
    parsePayload();
  } catch (error) {
    logEvent(`parse payload failed: ${(error as Error).message}`);
  }
});

claimByTokenBtn.addEventListener("click", async () => {
  await claimByToken();
});

claimByCodeBtn.addEventListener("click", async () => {
  await claimByCode();
});

signalConnectBtn.addEventListener("click", () => {
  connectSignal();
});

signalDisconnectBtn.addEventListener("click", () => {
  closeSignal();
});

sendTaskBtn.addEventListener("click", async () => {
  await sendTaskCreate();
});

window.addEventListener("beforeunload", () => {
  closeSignal();
});

setButtons();
setSignalStatus("未连接");
logEvent("mobile pairing mvp ready");
