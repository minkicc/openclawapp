import { MESSAGE_TYPES, type MessageType } from "./events.js";

const VALID_MESSAGE_TYPES = new Set<MessageType>(Object.values(MESSAGE_TYPES));

export interface Envelope {
  message_id: string;
  type: MessageType;
  payload: Record<string, unknown>;
  session_id: string | null;
  task_id: string | null;
  device_id: string | null;
  user_id: string | null;
  target_device_id: string | null;
  target_user_id: string | null;
  timestamp: string;
}

interface CreateEnvelopeInput {
  messageId?: string;
  type: Envelope["type"];
  payload?: Record<string, unknown>;
  sessionId?: string | null;
  taskId?: string | null;
  deviceId?: string | null;
  userId?: string | null;
  targetDeviceId?: string | null;
  targetUserId?: string | null;
  timestamp?: string | null;
}

type ParseResult =
  | { ok: true; value: Envelope }
  | { ok: false; error: string };

export function createEnvelope({
  messageId,
  type,
  payload,
  sessionId = null,
  taskId = null,
  deviceId = null,
  userId = null,
  targetDeviceId = null,
  targetUserId = null,
  timestamp = null
}: CreateEnvelopeInput): Envelope {
  if (!VALID_MESSAGE_TYPES.has(type as MessageType)) {
    throw new Error(`Unsupported message type: ${type}`);
  }

  const nowIso = new Date().toISOString();
  return {
    message_id: messageId || generateMessageId(),
    type,
    payload: payload ?? {},
    session_id: sessionId,
    task_id: taskId,
    device_id: deviceId,
    user_id: userId,
    target_device_id: targetDeviceId,
    target_user_id: targetUserId,
    timestamp: timestamp || nowIso
  };
}

export function parseEnvelope(raw: unknown): ParseResult {
  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch (error) {
      const parseError = error as Error;
      return {
        ok: false,
        error: `Invalid JSON payload: ${parseError.message}`
      };
    }
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      ok: false,
      error: "Envelope must be a JSON object"
    };
  }

  const candidate = value as Record<string, unknown>;
  const type = typeof candidate.type === "string" ? candidate.type.trim() : "";
  if (!type) {
    return {
      ok: false,
      error: "Envelope `type` is required"
    };
  }

  if (!VALID_MESSAGE_TYPES.has(type as MessageType)) {
    return {
      ok: false,
      error: `Unsupported envelope type: ${type}`
    };
  }

  const messageId =
    typeof candidate.message_id === "string" && candidate.message_id.trim()
      ? candidate.message_id.trim()
      : generateMessageId();

  return {
    ok: true,
    value: {
      message_id: messageId,
      type: type as MessageType,
      payload:
        candidate.payload && typeof candidate.payload === "object" && !Array.isArray(candidate.payload)
          ? (candidate.payload as Record<string, unknown>)
          : {},
      session_id: asOptionalString(candidate.session_id),
      task_id: asOptionalString(candidate.task_id),
      device_id: asOptionalString(candidate.device_id),
      user_id: asOptionalString(candidate.user_id),
      target_device_id: asOptionalString(candidate.target_device_id),
      target_user_id: asOptionalString(candidate.target_user_id),
      timestamp: asOptionalString(candidate.timestamp) || new Date().toISOString()
    }
  };
}

function generateMessageId(): string {
  const cryptoObj = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (cryptoObj && typeof cryptoObj.randomUUID === "function") {
    return cryptoObj.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function asOptionalString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}
