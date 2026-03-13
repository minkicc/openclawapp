import WebSocket from "ws";
import type { ChannelPlugin, OpenClawConfig } from "openclaw/plugin-sdk/core";
import { getOpenClawMobileRuntime } from "./runtime.js";

const CHANNEL_ID = "openclaw-mobile";
const DEFAULT_ACCOUNT_ID = "default";
const DEFAULT_REQUEST_TIMEOUT_MS = 8_000;
const DEFAULT_RECONNECT_MIN_MS = 1_000;
const DEFAULT_RECONNECT_MAX_MS = 15_000;
const MAX_SEEN_EVENT_IDS = 2_000;

type JsonObject = Record<string, unknown>;

type SignalParty = {
  type?: string;
  id?: string;
};

type SignalEvent = {
  id?: string;
  type?: string;
  ts?: number;
  kind?: string;
  from?: SignalParty;
  to?: SignalParty;
  payload?: JsonObject;
};

type ResolvedOpenClawMobileAccount = {
  accountId: string;
  enabled: boolean;
  configured: boolean;
  serverBaseUrl: string;
  desktopDeviceId: string;
  requestTimeoutMs: number;
  reconnectMinMs: number;
  reconnectMaxMs: number;
};

const waitUntilAbort = (signal?: AbortSignal, onAbort?: () => void): Promise<void> =>
  new Promise((resolve) => {
    const done = () => {
      onAbort?.();
      resolve();
    };
    if (!signal) {
      return;
    }
    if (signal.aborted) {
      done();
      return;
    }
    signal.addEventListener("abort", done, { once: true });
  });

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeBaseUrl(raw: unknown): string {
  const text = asString(raw);
  if (!text) {
    return "";
  }
  return text.replace(/\/+$/, "");
}

function asPositiveInt(raw: unknown, fallback: number): number {
  const num = Number(raw);
  if (!Number.isFinite(num) || num <= 0) {
    return fallback;
  }
  return Math.floor(num);
}

function getChannelSection(cfg: OpenClawConfig): Record<string, unknown> {
  if (!isRecord(cfg)) {
    return {};
  }
  const channels = isRecord((cfg as any).channels) ? ((cfg as any).channels as Record<string, unknown>) : {};
  const section = channels[CHANNEL_ID];
  return isRecord(section) ? section : {};
}

function getAccountSection(
  channelSection: Record<string, unknown>,
  accountId: string,
): Record<string, unknown> {
  const accounts = isRecord(channelSection.accounts)
    ? (channelSection.accounts as Record<string, unknown>)
    : {};
  const fromAccount = accounts[accountId];
  if (isRecord(fromAccount)) {
    return fromAccount;
  }
  const fromDefault = accounts[DEFAULT_ACCOUNT_ID];
  if (isRecord(fromDefault)) {
    return fromDefault;
  }
  return {};
}

function mergeConfig(
  channelSection: Record<string, unknown>,
  accountSection: Record<string, unknown>,
): Record<string, unknown> {
  return { ...channelSection, ...accountSection };
}

function resolveAccount(cfg: OpenClawConfig, accountId?: string | null): ResolvedOpenClawMobileAccount {
  const resolvedAccountId = asString(accountId) || DEFAULT_ACCOUNT_ID;
  const channelSection = getChannelSection(cfg);
  const accountSection = getAccountSection(channelSection, resolvedAccountId);
  const merged = mergeConfig(channelSection, accountSection);
  const serverBaseUrl = normalizeBaseUrl(
    merged.serverBaseUrl ?? merged.baseUrl ?? merged.channelServerBaseUrl,
  );
  const desktopDeviceId = asString(
    merged.desktopDeviceId ?? merged.deviceId ?? merged.channelDeviceId,
  );
  const requestTimeoutMs = asPositiveInt(
    merged.requestTimeoutMs,
    DEFAULT_REQUEST_TIMEOUT_MS,
  );
  const reconnectMinMs = asPositiveInt(
    merged.reconnectMinMs,
    DEFAULT_RECONNECT_MIN_MS,
  );
  const reconnectMaxMs = Math.max(
    reconnectMinMs,
    asPositiveInt(merged.reconnectMaxMs, DEFAULT_RECONNECT_MAX_MS),
  );
  const enabledRaw = merged.enabled;
  const enabled = typeof enabledRaw === "boolean" ? enabledRaw : true;

  return {
    accountId: resolvedAccountId,
    enabled,
    configured: Boolean(serverBaseUrl && desktopDeviceId),
    serverBaseUrl,
    desktopDeviceId,
    requestTimeoutMs,
    reconnectMinMs,
    reconnectMaxMs,
  };
}

function listAccountIds(cfg: OpenClawConfig): string[] {
  const channelSection = getChannelSection(cfg);
  const accounts = isRecord(channelSection.accounts)
    ? (channelSection.accounts as Record<string, unknown>)
    : {};
  const ids = Object.keys(accounts).map((value) => value.trim()).filter(Boolean);
  if (ids.length > 0) {
    return ids;
  }
  return [DEFAULT_ACCOUNT_ID];
}

function setAccountEnabled({
  cfg,
  accountId,
  enabled,
}: {
  cfg: OpenClawConfig;
  accountId: string;
  enabled: boolean;
}): OpenClawConfig {
  const nextCfg = isRecord(cfg) ? { ...(cfg as Record<string, unknown>) } : {};
  const channels = isRecord(nextCfg.channels) ? { ...(nextCfg.channels as Record<string, unknown>) } : {};
  const channelSection = isRecord(channels[CHANNEL_ID])
    ? { ...(channels[CHANNEL_ID] as Record<string, unknown>) }
    : {};
  const resolvedAccountId = asString(accountId) || DEFAULT_ACCOUNT_ID;

  if (resolvedAccountId === DEFAULT_ACCOUNT_ID) {
    channelSection.enabled = enabled;
  } else {
    const accounts = isRecord(channelSection.accounts)
      ? { ...(channelSection.accounts as Record<string, unknown>) }
      : {};
    const accountSection = isRecord(accounts[resolvedAccountId])
      ? { ...(accounts[resolvedAccountId] as Record<string, unknown>) }
      : {};
    accountSection.enabled = enabled;
    accounts[resolvedAccountId] = accountSection;
    channelSection.accounts = accounts;
  }

  channels[CHANNEL_ID] = channelSection;
  nextCfg.channels = channels;
  return nextCfg as OpenClawConfig;
}

function buildHttpUrl(baseUrl: string, path: string): URL {
  const url = new URL(baseUrl);
  url.pathname = path;
  url.search = "";
  url.hash = "";
  return url;
}

function buildWsUrl(baseUrl: string, clientType: string, clientId: string): string {
  const url = buildHttpUrl(baseUrl, "/v1/signal/ws");
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("clientType", clientType);
  url.searchParams.set("clientId", clientId);
  return url.toString();
}

async function postSignal(
  account: ResolvedOpenClawMobileAccount,
  payload: {
    fromType: string;
    fromId: string;
    toType: string;
    toId: string;
    type: string;
    payload?: JsonObject;
  },
): Promise<void> {
  const endpoint = buildHttpUrl(account.serverBaseUrl, "/v1/signal/send");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), account.requestTimeoutMs);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    let json: any = null;
    try {
      json = await response.json();
    } catch {
      json = null;
    }
    if (!response.ok || !json?.ok) {
      const message = json?.message || json?.error || `HTTP ${response.status}`;
      throw new Error(`signal send failed: ${message}`);
    }
  } finally {
    clearTimeout(timer);
  }
}

function resolveInboundText(eventType: string, payload: JsonObject): string {
  if (eventType === "chat.message") {
    return asString(payload.text ?? payload.message);
  }
  if (eventType === "task.create") {
    return asString(payload.prompt ?? payload.text ?? payload.message);
  }
  return asString(payload.text ?? payload.message ?? payload.prompt);
}

function rememberEventId(cache: Map<string, number>, eventId: string): boolean {
  if (!eventId) {
    return false;
  }
  if (cache.has(eventId)) {
    return true;
  }
  cache.set(eventId, Date.now());
  if (cache.size <= MAX_SEEN_EVENT_IDS) {
    return false;
  }
  const oldest = cache.keys().next().value;
  if (oldest) {
    cache.delete(oldest);
  }
  return false;
}

async function sleepWithAbort(ms: number, signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) {
    return false;
  }
  return await new Promise((resolve) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve(true);
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve(false);
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function parseWsJson(raw: WebSocket.RawData): unknown {
  try {
    if (typeof raw === "string") {
      return JSON.parse(raw);
    }
    if (raw instanceof Buffer) {
      return JSON.parse(raw.toString("utf8"));
    }
    if (raw instanceof ArrayBuffer) {
      return JSON.parse(Buffer.from(raw).toString("utf8"));
    }
    if (Array.isArray(raw)) {
      return JSON.parse(Buffer.concat(raw.map((part) => Buffer.from(part))).toString("utf8"));
    }
  } catch {
    return null;
  }
  return null;
}

async function dispatchInboundToAgent(params: {
  accountId: string;
  mobileId: string;
  senderName: string;
  text: string;
  eventTs: number;
  sendReply: (mobileId: string, text: string) => Promise<void>;
  log?: {
    info?: (message: string) => void;
    warn?: (message: string) => void;
  };
}) {
  const rt = getOpenClawMobileRuntime();
  const cfg = await rt.config.loadConfig();
  const sessionKey = `${CHANNEL_ID}:${params.accountId}:${params.mobileId}`;
  const sender = params.senderName || params.mobileId;
  const msgCtx = rt.channel.reply.finalizeInboundContext({
    Body: params.text,
    RawBody: params.text,
    CommandBody: params.text,
    BodyForAgent: params.text,
    From: `${CHANNEL_ID}:${params.mobileId}`,
    To: `${CHANNEL_ID}:${params.mobileId}`,
    SessionKey: sessionKey,
    AccountId: params.accountId,
    OriginatingChannel: CHANNEL_ID,
    OriginatingTo: `${CHANNEL_ID}:${params.mobileId}`,
    ChatType: "direct",
    SenderName: sender,
    SenderId: params.mobileId,
    Provider: CHANNEL_ID,
    Surface: CHANNEL_ID,
    ConversationLabel: sender,
    Timestamp: params.eventTs,
  });

  await rt.channel.reply.dispatchReplyWithBufferedBlockDispatcher({
    ctx: msgCtx,
    cfg,
    dispatcherOptions: {
      onReplyStart: () => {
        params.log?.info?.(`openclaw-mobile: agent reply started for ${params.mobileId}`);
      },
      deliver: async (payload: { text?: string; body?: string }) => {
        const text = asString(payload?.text ?? payload?.body);
        if (!text) {
          return;
        }
        await params.sendReply(params.mobileId, text);
      },
    },
  });
}

export const openclawMobilePlugin: ChannelPlugin<ResolvedOpenClawMobileAccount> = {
  id: CHANNEL_ID,
  meta: {
    id: CHANNEL_ID,
    label: "OpenClaw Mobile",
    selectionLabel: "OpenClaw Mobile (Signal Relay)",
    detailLabel: "OpenClaw Mobile (Signal Relay)",
    docsPath: "/channels/openclaw-mobile",
    blurb: "Bridge custom mobile signaling traffic into OpenClaw agent channels.",
    order: 95,
  },
  capabilities: {
    chatTypes: ["direct"],
    media: false,
    threads: false,
    reactions: false,
    edit: false,
    unsend: false,
    reply: false,
    effects: false,
    blockStreaming: false,
  },
  reload: { configPrefixes: [`channels.${CHANNEL_ID}`] },
  config: {
    listAccountIds: (cfg) => listAccountIds(cfg),
    resolveAccount: (cfg, accountId) => resolveAccount(cfg, accountId),
    defaultAccountId: () => DEFAULT_ACCOUNT_ID,
    setAccountEnabled,
    isEnabled: (account) => account.enabled,
    isConfigured: (account) => account.configured,
    describeAccount: (account) => ({
      accountId: account.accountId,
      enabled: account.enabled,
      configured: account.configured,
      baseUrl: account.serverBaseUrl || undefined,
      connected: false,
    }),
  },
  pairing: {
    idLabel: "mobileDeviceId",
    normalizeAllowEntry: (entry: string) => entry.trim(),
  },
  messaging: {
    normalizeTarget: (target: string) => {
      const trimmed = target.trim();
      if (!trimmed) {
        return undefined;
      }
      return trimmed.replace(/^openclaw-mobile:/i, "").trim();
    },
    targetResolver: {
      looksLikeId: (id: string) => {
        const trimmed = id.trim();
        return Boolean(trimmed) && (trimmed.startsWith("mobile_") || /^openclaw-mobile:/i.test(trimmed));
      },
      hint: "<mobileId>",
    },
  },
  directory: {
    self: async () => null,
    listPeers: async () => [],
    listGroups: async () => [],
  },
  outbound: {
    deliveryMode: "gateway",
    textChunkLimit: 2000,
    sendText: async ({ to, text, accountId, cfg }: any) => {
      const account = resolveAccount(cfg ?? {}, accountId);
      if (!account.configured) {
        throw new Error("openclaw-mobile channel is not configured");
      }
      await postSignal(account, {
        fromType: "desktop",
        fromId: account.desktopDeviceId,
        toType: "mobile",
        toId: to,
        type: "chat.message",
        payload: {
          text,
          from: "agent",
          sentAt: Date.now(),
          via: CHANNEL_ID,
        },
      });
      return {
        channel: CHANNEL_ID,
        messageId: `ocm-${Date.now()}`,
        chatId: to,
      };
    },
  },
  gateway: {
    startAccount: async (ctx: any) => {
      const { cfg, accountId, abortSignal, log } = ctx;
      let account = resolveAccount(cfg ?? {}, accountId);

      if (!account.enabled) {
        log?.info?.(`openclaw-mobile account ${account.accountId} is disabled`);
        return waitUntilAbort(abortSignal);
      }
      if (!account.configured) {
        log?.warn?.(
          `openclaw-mobile account ${account.accountId} missing config: serverBaseUrl/desktopDeviceId`,
        );
        return waitUntilAbort(abortSignal);
      }

      const seenEventIds = new Map<string, number>();
      const mobileNames = new Map<string, string>();
      let reconnectAttempt = 0;
      let lastDisconnectMessage = "";

      const setStatus = (patch: Record<string, unknown>) => {
        const prev = typeof ctx.getStatus === "function" ? ctx.getStatus() || {} : {};
        ctx.setStatus?.({
          ...prev,
          accountId: account.accountId,
          enabled: account.enabled,
          configured: account.configured,
          running: true,
          baseUrl: account.serverBaseUrl,
          ...patch,
        });
      };

      const sendToMobile = async (mobileId: string, text: string) => {
        const latestCfg = await getOpenClawMobileRuntime().config.loadConfig();
        account = resolveAccount(latestCfg ?? {}, account.accountId);
        if (!account.configured || !account.enabled) {
          throw new Error("openclaw-mobile channel is disabled or unconfigured");
        }
        await postSignal(account, {
          fromType: "desktop",
          fromId: account.desktopDeviceId,
          toType: "mobile",
          toId: mobileId,
          type: "chat.message",
          payload: {
            text,
            from: "agent",
            sentAt: Date.now(),
            via: CHANNEL_ID,
          },
        });
        setStatus({ lastOutboundAt: Date.now() });
      };

      setStatus({
        connected: false,
        reconnectAttempts: reconnectAttempt,
        lastError: null,
      });

      while (!abortSignal?.aborted) {
        const wsUrl = buildWsUrl(account.serverBaseUrl, "desktop", account.desktopDeviceId);
        setStatus({
          connected: false,
          reconnectAttempts: reconnectAttempt,
          busy: reconnectAttempt > 0,
        });
        log?.info?.(
          `openclaw-mobile connecting ws (${account.accountId}) attempt=${reconnectAttempt + 1}`,
        );

        await new Promise<void>((resolve) => {
          const ws = new WebSocket(wsUrl);
          let settled = false;
          let opened = false;

          const settle = () => {
            if (settled) {
              return;
            }
            settled = true;
            resolve();
          };

          const handleAbort = () => {
            try {
              ws.close(1000, "abort");
            } catch {
              // no-op
            }
            settle();
          };

          abortSignal?.addEventListener("abort", handleAbort, { once: true });

          ws.on("open", () => {
            opened = true;
            reconnectAttempt = 0;
            setStatus({
              connected: true,
              busy: false,
              reconnectAttempts: reconnectAttempt,
              lastConnectedAt: Date.now(),
              lastError: null,
            });
            log?.info?.(`openclaw-mobile ws connected (${account.accountId})`);
          });

          ws.on("message", (raw) => {
            const parsed = parseWsJson(raw);
            if (!isRecord(parsed)) {
              return;
            }
            const event = parsed as SignalEvent;
            const eventId = asString(event.id);
            if (rememberEventId(seenEventIds, eventId)) {
              return;
            }

            if (asString(event.kind)) {
              return;
            }

            const eventType = asString(event.type);
            const payload = isRecord(event.payload) ? (event.payload as JsonObject) : {};
            const fromType = asString(event.from?.type);
            const fromId = asString(event.from?.id);
            const eventTs = Number(event.ts) || Date.now();
            setStatus({ lastInboundAt: Date.now() });

            if (eventType === "pair.claimed") {
              const mobileId = asString(payload.mobileId ?? payload.mobile_id);
              const userId = asString(payload.userId ?? payload.user_id);
              if (mobileId) {
                mobileNames.set(mobileId, userId || mobileId);
              }
              return;
            }

            if (eventType === "channel.ping" && fromType === "mobile" && fromId) {
              const checkId = asString(payload.checkId ?? payload.check_id);
              if (!checkId) {
                return;
              }
              void (async () => {
                try {
                  await postSignal(account, {
                    fromType: "desktop",
                    fromId: account.desktopDeviceId,
                    toType: "mobile",
                    toId: fromId,
                    type: "channel.pong",
                    payload: {
                      checkId,
                      ackTs: Date.now(),
                      deviceId: account.desktopDeviceId,
                    },
                  });
                } catch (error) {
                  log?.warn?.(`openclaw-mobile channel.pong failed: ${String(error)}`);
                }
              })();
              return;
            }

            if (fromType !== "mobile" || !fromId) {
              return;
            }

            const inboundText = resolveInboundText(eventType, payload);
            if (!inboundText) {
              return;
            }
            if (!mobileNames.has(fromId)) {
              mobileNames.set(fromId, fromId);
            }

            void dispatchInboundToAgent({
              accountId: account.accountId,
              mobileId: fromId,
              senderName: mobileNames.get(fromId) || fromId,
              text: inboundText,
              eventTs,
              sendReply: sendToMobile,
              log,
            }).catch((error) => {
              log?.warn?.(`openclaw-mobile dispatch failed: ${String(error)}`);
            });
          });

          ws.on("error", (error) => {
            const message = typeof error === "object" && error ? String((error as Error).message || error) : String(error);
            lastDisconnectMessage = message;
            if (!opened) {
              log?.warn?.(`openclaw-mobile ws connect error: ${message}`);
            } else {
              log?.warn?.(`openclaw-mobile ws runtime error: ${message}`);
            }
          });

          ws.on("close", (code, reason) => {
            abortSignal?.removeEventListener("abort", handleAbort);
            if (!opened) {
              lastDisconnectMessage = lastDisconnectMessage || `connect failed (close ${code})`;
            }
            const reasonText =
              (typeof reason === "string" ? reason : Buffer.from(reason || []).toString("utf8")).trim() ||
              lastDisconnectMessage ||
              "closed";
            setStatus({
              connected: false,
              busy: false,
              lastDisconnect: {
                at: Date.now(),
                status: Number(code) || undefined,
                error: reasonText,
              },
            });
            settle();
          });
        });

        if (abortSignal?.aborted) {
          break;
        }
        reconnectAttempt += 1;
        const delay = Math.min(
          account.reconnectMaxMs,
          account.reconnectMinMs * Math.pow(2, Math.min(reconnectAttempt, 6)),
        );
        setStatus({
          connected: false,
          reconnectAttempts: reconnectAttempt,
          lastError: lastDisconnectMessage || "channel disconnected",
          busy: true,
        });
        const shouldContinue = await sleepWithAbort(delay, abortSignal);
        if (!shouldContinue) {
          break;
        }
      }

      setStatus({
        connected: false,
        busy: false,
      });
      return waitUntilAbort(abortSignal);
    },
    stopAccount: async (ctx: any) => {
      ctx.log?.info?.(`openclaw-mobile account ${ctx.accountId} stopped`);
    },
  },
  agentPrompt: {
    messageToolHints: () => [
      "",
      "### OpenClaw Mobile Channel",
      "Replies here are delivered to the paired mobile device over the custom signal server.",
      "Keep replies concise for mobile chat readability.",
    ],
  },
};
