export const CRDT_WIRE_TYPES = {
  CONVERSATION_OP: "app.openclaw.conv.op",
  SYNC_STATE: "sys.crdt.sync-state",
  SYNC_REQUEST: "sys.crdt.sync-request",
  SYNC_BATCH: "sys.crdt.sync-batch",
  PING: "sys.crdt.ping",
  PONG: "sys.crdt.pong"
} as const;

export type CrdtWireType = (typeof CRDT_WIRE_TYPES)[keyof typeof CRDT_WIRE_TYPES];

export const CRDT_OP_KINDS = {
  CONVERSATION_CREATE: "conversation.create",
  MEMBER_ADD: "member.add",
  MEMBER_REMOVE: "member.remove",
  DEVICE_TRUST_ADD: "device.trust.add",
  DEVICE_TRUST_REMOVE: "device.trust.remove",
  CHANNEL_REVOKE: "channel.revoke",
  MESSAGE_CREATE: "message.create",
  MESSAGE_EDIT: "message.edit",
  MESSAGE_DELETE: "message.delete",
  REACTION_ADD: "reaction.add",
  REACTION_REMOVE: "reaction.remove",
  READ_CURSOR: "read.cursor"
} as const;

export type CrdtOpKind = (typeof CRDT_OP_KINDS)[keyof typeof CRDT_OP_KINDS];

export type CrdtAuthorEntityType = "desktop" | "mobile" | "service";
export type CrdtVersionVector = Record<string, number>;

export interface ConversationCreatePayload {
  title?: string;
  mode?: "direct" | "group";
}

export interface MemberAddPayload {
  memberId: string;
  role?: string;
  displayName?: string;
}

export interface MemberRemovePayload {
  memberId: string;
  reason?: string;
}

export interface DeviceTrustAddPayload {
  memberId?: string;
  deviceId: string;
  entityType: CrdtAuthorEntityType | string;
  publicKey: string;
  displayName?: string;
}

export interface DeviceTrustRemovePayload {
  deviceId: string;
  reason?: string;
}

export interface ChannelRevokePayload {
  targetDeviceId?: string;
  targetMemberId?: string;
  reason?: string;
}

export interface MessageCreatePayload {
  messageId: string;
  body: {
    text?: string;
    parts?: Array<Record<string, unknown>>;
  };
  clientNonce?: string;
}

export interface MessageEditPayload {
  messageId: string;
  body: {
    text?: string;
    parts?: Array<Record<string, unknown>>;
  };
}

export interface MessageDeletePayload {
  messageId: string;
  reason?: string;
}

export interface ReactionAddPayload {
  messageId: string;
  reaction: string;
}

export interface ReactionRemovePayload {
  messageId: string;
  reaction: string;
}

export interface ReadCursorPayload {
  messageId?: string;
  opId?: string;
  readAt?: number;
}

export interface CrdtPayloadByKind {
  "conversation.create": ConversationCreatePayload;
  "member.add": MemberAddPayload;
  "member.remove": MemberRemovePayload;
  "device.trust.add": DeviceTrustAddPayload;
  "device.trust.remove": DeviceTrustRemovePayload;
  "channel.revoke": ChannelRevokePayload;
  "message.create": MessageCreatePayload;
  "message.edit": MessageEditPayload;
  "message.delete": MessageDeletePayload;
  "reaction.add": ReactionAddPayload;
  "reaction.remove": ReactionRemovePayload;
  "read.cursor": ReadCursorPayload;
}

export type CrdtOpPayload<TKind extends CrdtOpKind = CrdtOpKind> = CrdtPayloadByKind[TKind];

export interface CrdtOpEnvelope<TKind extends CrdtOpKind = CrdtOpKind> {
  opId: string;
  conversationId: string;
  authorDeviceId: string;
  authorEntityType: CrdtAuthorEntityType | string;
  authorSeq: number;
  hlc: string;
  parents: string[];
  kind: TKind;
  payload: CrdtOpPayload<TKind>;
  signedAt: number;
  signature: string;
}

export interface CrdtConversationSummary {
  conversationId: string;
  versionVector: CrdtVersionVector;
  frontier: string[];
}

export interface CrdtSyncState {
  conversationId: string;
  versionVector: CrdtVersionVector;
  frontier: string[];
  ts: number;
}

export interface CrdtSyncRequest {
  conversationId: string;
  wantFrom: CrdtVersionVector;
  limit?: number;
  ts: number;
}

export interface CrdtSyncBatch {
  conversationId: string;
  baseVersionVector: CrdtVersionVector;
  ops: CrdtOpEnvelope[];
  hasMore?: boolean;
  ts: number;
}

export interface CrdtPing {
  id: string;
  sentAt: number;
}

export interface CrdtPong {
  id: string;
  sentAt: number;
  respondedAt: number;
}

export interface CreateCrdtOpEnvelopeInput<TKind extends CrdtOpKind = CrdtOpKind> {
  opId?: string;
  conversationId: string;
  authorDeviceId: string;
  authorEntityType: CrdtAuthorEntityType | string;
  authorSeq: number;
  hlc?: string;
  parents?: string[];
  kind: TKind;
  payload: CrdtOpPayload<TKind>;
  signedAt?: number;
  signature: string;
}

export type ParseCrdtResult<TValue> =
  | { ok: true; value: TValue }
  | { ok: false; error: string };

export function normalizeCrdtId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizeCrdtParents(values: unknown): string[] {
  const source = Array.isArray(values) ? values : [];
  return Array.from(new Set(source.map((value) => normalizeCrdtId(value)).filter(Boolean)));
}

export function normalizeCrdtVersionVector(value: unknown): CrdtVersionVector {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const vector = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries(vector)
      .map(([authorDeviceId, seq]) => {
        const normalizedAuthorDeviceId = normalizeCrdtId(authorDeviceId);
        const normalizedSeq = Math.max(0, Math.trunc(Number(seq || 0)));
        return [normalizedAuthorDeviceId, normalizedSeq] as const;
      })
      .filter(([authorDeviceId]) => Boolean(authorDeviceId))
  );
}

export function mergeCrdtVersionVectors(
  left: CrdtVersionVector,
  right: CrdtVersionVector
): CrdtVersionVector {
  const merged: CrdtVersionVector = { ...normalizeCrdtVersionVector(left) };
  for (const [authorDeviceId, seq] of Object.entries(normalizeCrdtVersionVector(right))) {
    merged[authorDeviceId] = Math.max(merged[authorDeviceId] || 0, seq);
  }
  return merged;
}

export function diffCrdtVersionVectors(
  local: CrdtVersionVector,
  remote: CrdtVersionVector
): CrdtVersionVector {
  const normalizedLocal = normalizeCrdtVersionVector(local);
  const normalizedRemote = normalizeCrdtVersionVector(remote);
  const diff: CrdtVersionVector = {};
  for (const [authorDeviceId, remoteSeq] of Object.entries(normalizedRemote)) {
    if (remoteSeq > (normalizedLocal[authorDeviceId] || 0)) {
      diff[authorDeviceId] = remoteSeq;
    }
  }
  return diff;
}

export function buildCrdtHlc(
  authorDeviceId: string,
  authorSeq: number,
  atMs = Date.now()
): string {
  const normalizedAuthorDeviceId = normalizeCrdtId(authorDeviceId) || "unknown-device";
  const normalizedAuthorSeq = Math.max(0, Math.trunc(authorSeq));
  return `${new Date(atMs).toISOString()}#${normalizedAuthorDeviceId}#${String(
    normalizedAuthorSeq
  ).padStart(12, "0")}`;
}

export function createCrdtOpId(
  authorDeviceId: string,
  authorSeq: number,
  atMs = Date.now()
): string {
  const normalizedAuthorDeviceId = normalizeCrdtId(authorDeviceId) || "unknown-device";
  const normalizedAuthorSeq = Math.max(0, Math.trunc(authorSeq));
  return `op_${normalizedAuthorDeviceId}_${normalizedAuthorSeq}_${Math.max(
    0,
    Math.trunc(atMs)
  )}_${randomSuffix()}`;
}

export function createCrdtMessageId(atMs = Date.now()): string {
  return `msg_${Math.max(0, Math.trunc(atMs))}_${randomSuffix()}`;
}

export function createCrdtConversationId(atMs = Date.now()): string {
  return `conv_${Math.max(0, Math.trunc(atMs))}_${randomSuffix()}`;
}

export function createCrdtOpEnvelope<TKind extends CrdtOpKind>(
  input: CreateCrdtOpEnvelopeInput<TKind>
): CrdtOpEnvelope<TKind> {
  const conversationId = normalizeCrdtId(input.conversationId);
  const authorDeviceId = normalizeCrdtId(input.authorDeviceId);
  const authorEntityType = normalizeCrdtId(input.authorEntityType) || "desktop";
  const authorSeq = Math.max(0, Math.trunc(input.authorSeq));
  const signedAt = Math.max(0, Math.trunc(Number(input.signedAt || Date.now())));
  const opId =
    normalizeCrdtId(input.opId) || createCrdtOpId(authorDeviceId, authorSeq, signedAt);

  if (!conversationId) {
    throw new Error("conversationId is required");
  }
  if (!authorDeviceId) {
    throw new Error("authorDeviceId is required");
  }
  if (!authorSeq) {
    throw new Error("authorSeq must be greater than 0");
  }
  if (!normalizeCrdtId(input.signature)) {
    throw new Error("signature is required");
  }

  return {
    opId,
    conversationId,
    authorDeviceId,
    authorEntityType,
    authorSeq,
    hlc: normalizeCrdtId(input.hlc) || buildCrdtHlc(authorDeviceId, authorSeq, signedAt),
    parents: normalizeCrdtParents(input.parents),
    kind: input.kind,
    payload: input.payload,
    signedAt,
    signature: normalizeCrdtId(input.signature)
  };
}

export function parseCrdtOpEnvelope(raw: unknown): ParseCrdtResult<CrdtOpEnvelope> {
  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch (error) {
      return {
        ok: false,
        error: `Invalid JSON payload: ${(error as Error).message}`
      };
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, error: "CRDT op must be a JSON object" };
  }

  const candidate = value as Record<string, unknown>;
  const kind = normalizeCrdtId(candidate.kind);
  if (!Object.values(CRDT_OP_KINDS).includes(kind as CrdtOpKind)) {
    return { ok: false, error: `Unsupported CRDT op kind: ${kind || "<empty>"}` };
  }

  try {
    return {
      ok: true,
      value: createCrdtOpEnvelope({
        opId: normalizeCrdtId(candidate.opId),
        conversationId: normalizeCrdtId(candidate.conversationId),
        authorDeviceId: normalizeCrdtId(candidate.authorDeviceId),
        authorEntityType: normalizeCrdtId(candidate.authorEntityType) || "desktop",
        authorSeq: Math.max(0, Math.trunc(Number(candidate.authorSeq || 0))),
        hlc: normalizeCrdtId(candidate.hlc),
        parents: normalizeCrdtParents(candidate.parents),
        kind: kind as CrdtOpKind,
        payload:
          candidate.payload && typeof candidate.payload === "object" && !Array.isArray(candidate.payload)
            ? (candidate.payload as CrdtOpPayload)
            : ({} as CrdtOpPayload),
        signedAt: Math.max(0, Math.trunc(Number(candidate.signedAt || Date.now()))),
        signature: normalizeCrdtId(candidate.signature)
      })
    };
  } catch (error) {
    return {
      ok: false,
      error: (error as Error).message
    };
  }
}

export function createCrdtConversationSummary(input: {
  conversationId: string;
  versionVector?: CrdtVersionVector;
  frontier?: string[];
}): CrdtConversationSummary {
  const conversationId = normalizeCrdtId(input.conversationId);
  if (!conversationId) {
    throw new Error("conversationId is required");
  }
  return {
    conversationId,
    versionVector: normalizeCrdtVersionVector(input.versionVector),
    frontier: normalizeCrdtParents(input.frontier)
  };
}

export function createCrdtSyncState(input: {
  conversationId: string;
  versionVector?: CrdtVersionVector;
  frontier?: string[];
  ts?: number;
}): CrdtSyncState {
  const conversationId = normalizeCrdtId(input.conversationId);
  if (!conversationId) {
    throw new Error("conversationId is required");
  }
  return {
    conversationId,
    versionVector: normalizeCrdtVersionVector(input.versionVector),
    frontier: normalizeCrdtParents(input.frontier),
    ts: Math.max(0, Math.trunc(Number(input.ts || Date.now())))
  };
}

export function createCrdtSyncRequest(input: {
  conversationId: string;
  wantFrom?: CrdtVersionVector;
  limit?: number;
  ts?: number;
}): CrdtSyncRequest {
  const conversationId = normalizeCrdtId(input.conversationId);
  if (!conversationId) {
    throw new Error("conversationId is required");
  }
  return {
    conversationId,
    wantFrom: normalizeCrdtVersionVector(input.wantFrom),
    limit: input.limit == null ? undefined : Math.max(1, Math.trunc(Number(input.limit))),
    ts: Math.max(0, Math.trunc(Number(input.ts || Date.now())))
  };
}

export function createCrdtSyncBatch(input: {
  conversationId: string;
  baseVersionVector?: CrdtVersionVector;
  ops?: CrdtOpEnvelope[];
  hasMore?: boolean;
  ts?: number;
}): CrdtSyncBatch {
  const conversationId = normalizeCrdtId(input.conversationId);
  if (!conversationId) {
    throw new Error("conversationId is required");
  }
  return {
    conversationId,
    baseVersionVector: normalizeCrdtVersionVector(input.baseVersionVector),
    ops: Array.isArray(input.ops) ? input.ops : [],
    hasMore: input.hasMore === true,
    ts: Math.max(0, Math.trunc(Number(input.ts || Date.now())))
  };
}

export function createCrdtPing(input: { id?: string; sentAt?: number } = {}): CrdtPing {
  const sentAt = Math.max(0, Math.trunc(Number(input.sentAt || Date.now())));
  return {
    id: normalizeCrdtId(input.id) || `ping_${sentAt}_${randomSuffix()}`,
    sentAt
  };
}

export function createCrdtPong(input: {
  id: string;
  sentAt: number;
  respondedAt?: number;
}): CrdtPong {
  const id = normalizeCrdtId(input.id);
  if (!id) {
    throw new Error("id is required");
  }
  return {
    id,
    sentAt: Math.max(0, Math.trunc(Number(input.sentAt || 0))),
    respondedAt: Math.max(0, Math.trunc(Number(input.respondedAt || Date.now())))
  };
}

export function parseCrdtSyncState(raw: unknown): ParseCrdtResult<CrdtSyncState> {
  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch (error) {
      return {
        ok: false,
        error: `Invalid JSON payload: ${(error as Error).message}`
      };
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, error: "CRDT sync state must be a JSON object" };
  }

  const candidate = value as Record<string, unknown>;
  try {
    return {
      ok: true,
      value: createCrdtSyncState({
        conversationId: normalizeCrdtId(candidate.conversationId),
        versionVector: normalizeCrdtVersionVector(candidate.versionVector),
        frontier: normalizeCrdtParents(candidate.frontier),
        ts: Math.max(0, Math.trunc(Number(candidate.ts || Date.now())))
      })
    };
  } catch (error) {
    return {
      ok: false,
      error: (error as Error).message
    };
  }
}

export function parseCrdtSyncRequest(raw: unknown): ParseCrdtResult<CrdtSyncRequest> {
  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch (error) {
      return {
        ok: false,
        error: `Invalid JSON payload: ${(error as Error).message}`
      };
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, error: "CRDT sync request must be a JSON object" };
  }

  const candidate = value as Record<string, unknown>;
  try {
    return {
      ok: true,
      value: createCrdtSyncRequest({
        conversationId: normalizeCrdtId(candidate.conversationId),
        wantFrom: normalizeCrdtVersionVector(candidate.wantFrom),
        limit: candidate.limit == null ? undefined : Math.max(1, Math.trunc(Number(candidate.limit))),
        ts: Math.max(0, Math.trunc(Number(candidate.ts || Date.now())))
      })
    };
  } catch (error) {
    return {
      ok: false,
      error: (error as Error).message
    };
  }
}

export function parseCrdtSyncBatch(raw: unknown): ParseCrdtResult<CrdtSyncBatch> {
  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch (error) {
      return {
        ok: false,
        error: `Invalid JSON payload: ${(error as Error).message}`
      };
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, error: "CRDT sync batch must be a JSON object" };
  }

  const candidate = value as Record<string, unknown>;
  const rawOps = Array.isArray(candidate.ops) ? candidate.ops : [];
  const ops: CrdtOpEnvelope[] = [];
  for (const rawOp of rawOps) {
    const parsed = parseCrdtOpEnvelope(rawOp);
    if (parsed.ok === false) {
      return {
        ok: false,
        error: `Invalid CRDT op in sync batch: ${parsed.error}`
      };
    }
    ops.push(parsed.value);
  }

  try {
    return {
      ok: true,
      value: createCrdtSyncBatch({
        conversationId: normalizeCrdtId(candidate.conversationId),
        baseVersionVector: normalizeCrdtVersionVector(candidate.baseVersionVector),
        ops,
        hasMore: candidate.hasMore === true,
        ts: Math.max(0, Math.trunc(Number(candidate.ts || Date.now())))
      })
    };
  } catch (error) {
    return {
      ok: false,
      error: (error as Error).message
    };
  }
}

export function parseCrdtPing(raw: unknown): ParseCrdtResult<CrdtPing> {
  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch (error) {
      return {
        ok: false,
        error: `Invalid JSON payload: ${(error as Error).message}`
      };
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, error: "CRDT ping must be a JSON object" };
  }

  const candidate = value as Record<string, unknown>;
  return {
    ok: true,
    value: createCrdtPing({
      id: normalizeCrdtId(candidate.id),
      sentAt: Math.max(0, Math.trunc(Number(candidate.sentAt || Date.now())))
    })
  };
}

export function parseCrdtPong(raw: unknown): ParseCrdtResult<CrdtPong> {
  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch (error) {
      return {
        ok: false,
        error: `Invalid JSON payload: ${(error as Error).message}`
      };
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, error: "CRDT pong must be a JSON object" };
  }

  const candidate = value as Record<string, unknown>;
  try {
    return {
      ok: true,
      value: createCrdtPong({
        id: normalizeCrdtId(candidate.id),
        sentAt: Math.max(0, Math.trunc(Number(candidate.sentAt || 0))),
        respondedAt: Math.max(0, Math.trunc(Number(candidate.respondedAt || Date.now())))
      })
    };
  } catch (error) {
    return {
      ok: false,
      error: (error as Error).message
    };
  }
}

function randomSuffix(): string {
  const cryptoObj = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (cryptoObj && typeof cryptoObj.randomUUID === "function") {
    return cryptoObj.randomUUID().replace(/-/g, "");
  }
  return Math.random().toString(16).slice(2, 14);
}
