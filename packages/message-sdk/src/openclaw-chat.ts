import type { PairV2EntityType, PairV2PeerAppMessage, PairV2PeerCapabilities, PairV2AppModule } from '@openclaw/pair-sdk';

export const openClawPairChatMessageType = 'app.openclaw.chat.message';
export const openClawPairChatAckType = 'app.openclaw.chat.ack';
export const openClawPairChatSyncRequestType = 'app.openclaw.chat.sync-request';
export const openClawPairChatSyncStateType = 'app.openclaw.chat.sync-state';
export const openClawPairChatPingType = 'app.openclaw.chat.ping';
export const openClawPairChatPongType = 'app.openclaw.chat.pong';
export const openClawPairChatFeature = 'chat';

export type OpenClawPairChatEvent = {
  id: string;
  after: string[];
  text: string;
  ts: number;
  from: PairV2EntityType;
  origin: 'host' | 'mobile';
  originSeq: number;
};

export type OpenClawPairChatSyncRequest = {
  messageIds: string[];
  ts: number;
  from: PairV2EntityType;
};

export type OpenClawPairChatAck = {
  messageIds: string[];
  ts: number;
  from: PairV2EntityType;
};

export type OpenClawPairChatSyncState = {
  hostSeq: number;
  mobileSeq: number;
  leafIds: string[];
  ts: number;
  from: PairV2EntityType;
};

export type OpenClawPairChatPing = {
  id: string;
  sentAt: number;
  ts: number;
  from: PairV2EntityType;
};

export type OpenClawPairChatPong = {
  id: string;
  sentAt: number;
  respondedAt: number;
  ts: number;
  from: PairV2EntityType;
};

export type OpenClawPairChatMessageLike = {
  id: string;
  after?: string[];
  ts?: number;
  origin?: 'host' | 'mobile' | string;
  originSeq?: number;
};

export function supportsOpenClawPairChat(
  capabilities: Pick<PairV2PeerCapabilities, 'supportedMessages'> | null | undefined
) {
  const supportedMessages = Array.isArray(capabilities?.supportedMessages)
    ? capabilities.supportedMessages.map((value) => String(value || '').trim()).filter(Boolean)
    : [];
  if (supportedMessages.length === 0) {
    return true;
  }
  return supportedMessages.includes(openClawPairChatMessageType);
}

export function createOpenClawPairChatMessageId(ts = Date.now()) {
  return `chat_${Math.max(0, Math.trunc(ts))}_${Math.random().toString(16).slice(2, 10)}`;
}

function createOpenClawPairChatProbeId(ts = Date.now()) {
  return `chatping_${Math.max(0, Math.trunc(ts))}_${Math.random().toString(16).slice(2, 10)}`;
}

export function normalizeOpenClawPairChatAfterIds(values: unknown) {
  const source = Array.isArray(values) ? values : [];
  return Array.from(new Set(source.map((value) => String(value || '').trim()).filter(Boolean)));
}

function compareMessageOrder(
  left: Pick<OpenClawPairChatMessageLike, 'id' | 'ts'>,
  right: Pick<OpenClawPairChatMessageLike, 'id' | 'ts'>
) {
  const leftTs = Number(left.ts || 0);
  const rightTs = Number(right.ts || 0);
  if (leftTs !== rightTs) {
    return leftTs - rightTs;
  }
  return String(left.id || '').localeCompare(String(right.id || ''));
}

export function analyzeOpenClawPairChatGraph<T extends OpenClawPairChatMessageLike>(messages: T[]) {
  const byId = new Map<string, T>();
  for (const message of Array.isArray(messages) ? messages : []) {
    const id = String(message?.id || '').trim();
    if (!id) {
      continue;
    }
    byId.set(id, {
      ...message,
      id,
      after: normalizeOpenClawPairChatAfterIds(message.after),
      ts: Number(message.ts || 0),
    });
  }

  const knownIds = new Set(byId.keys());
  const childrenById = new Map<string, Set<string>>();
  const inDegree = new Map<string, number>();
  const missingIds = new Set<string>();

  for (const [id, message] of byId.entries()) {
    const knownParents = normalizeOpenClawPairChatAfterIds(message.after).filter((parentId) => {
      if (!knownIds.has(parentId)) {
        missingIds.add(parentId);
        return false;
      }
      return true;
    });
    inDegree.set(id, knownParents.length);
    for (const parentId of knownParents) {
      const next = childrenById.get(parentId) || new Set<string>();
      next.add(id);
      childrenById.set(parentId, next);
    }
  }

  const ready = Array.from(byId.values())
    .filter((message) => (inDegree.get(message.id) || 0) === 0)
    .sort(compareMessageOrder);
  const ordered: T[] = [];

  while (ready.length > 0) {
    const current = ready.shift()!;
    ordered.push(current);
    const children = Array.from(childrenById.get(current.id) || []);
      for (const childId of children) {
      const nextDegree = Math.max(0, (inDegree.get(childId) || 0) - 1);
      inDegree.set(childId, nextDegree);
      if (nextDegree === 0) {
        const child = byId.get(childId);
        if (child) {
          ready.push(child);
        }
      }
    }
    ready.sort(compareMessageOrder);
  }

  const seenIds = new Set(ordered.map((message) => message.id));
  const remaining = Array.from(byId.values())
    .filter((message) => !seenIds.has(message.id))
    .sort(compareMessageOrder);
  if (remaining.length > 0) {
    ordered.push(...remaining);
  }

  const referencedKnownIds = new Set<string>();
  for (const message of byId.values()) {
    for (const parentId of normalizeOpenClawPairChatAfterIds(message.after)) {
      if (knownIds.has(parentId)) {
        referencedKnownIds.add(parentId);
      }
    }
  }

  const leafIds = ordered
    .map((message) => message.id)
    .filter((id) => !referencedKnownIds.has(id));

  return {
    ordered,
    leafIds,
    missingIds: Array.from(missingIds).sort(),
  };
}

export function collectOpenClawPairChatLeafIds<T extends OpenClawPairChatMessageLike>(messages: T[]) {
  return analyzeOpenClawPairChatGraph(messages).leafIds;
}

export function buildOpenClawPairChatPayload(
  text: string,
  options: {
    id?: string;
    after?: string[];
    origin?: 'host' | 'mobile';
    originSeq?: number;
  } = {}
) {
  return {
    id: String(options.id || '').trim() || createOpenClawPairChatMessageId(),
    after: normalizeOpenClawPairChatAfterIds(options.after),
    text: String(text || ''),
    origin: options.origin === 'mobile' ? 'mobile' : 'host',
    originSeq: Math.max(0, Math.trunc(Number(options.originSeq || 0))),
  };
}

export function parseOpenClawPairChatMessage(message: PairV2PeerAppMessage): OpenClawPairChatEvent | null {
  if (String(message?.type || '').trim() !== openClawPairChatMessageType) {
    return null;
  }
  const payload = message.payload && typeof message.payload === 'object'
    ? message.payload
    : {};
  return {
    id: String(payload.id || '').trim() || createOpenClawPairChatMessageId(Number(message.ts || Date.now())),
    after: normalizeOpenClawPairChatAfterIds(payload.after),
    text: String(payload.text || ''),
    ts: Number(message.ts || Date.now()),
    from: message.from === 'desktop' ? 'desktop' : 'mobile',
    origin: payload.origin === 'mobile' ? 'mobile' : payload.origin === 'host' ? 'host' : message.from === 'desktop' ? 'host' : 'mobile',
    originSeq: Math.max(0, Math.trunc(Number(payload.originSeq || 0))),
  };
}

export function buildOpenClawPairChatSyncRequestPayload(messageIds: string[]) {
  return {
    messageIds: normalizeOpenClawPairChatAfterIds(messageIds),
  };
}

export function buildOpenClawPairChatAckPayload(messageIds: string[]) {
  return {
    messageIds: normalizeOpenClawPairChatAfterIds(messageIds),
  };
}

export function buildOpenClawPairChatSyncStatePayload(options: {
  hostSeq?: number;
  mobileSeq?: number;
  leafIds?: string[];
}) {
  return {
    hostSeq: Math.max(0, Math.trunc(Number(options.hostSeq || 0))),
    mobileSeq: Math.max(0, Math.trunc(Number(options.mobileSeq || 0))),
    leafIds: normalizeOpenClawPairChatAfterIds(options.leafIds),
  };
}

export function buildOpenClawPairChatPingPayload(options: {
  id?: string;
  sentAt?: number;
} = {}) {
  const sentAt = Math.max(0, Math.trunc(Number(options.sentAt || Date.now())));
  return {
    id: String(options.id || '').trim() || createOpenClawPairChatProbeId(sentAt),
    sentAt,
  };
}

export function buildOpenClawPairChatPongPayload(options: {
  id: string;
  sentAt: number;
  respondedAt?: number;
}) {
  return {
    id: String(options.id || '').trim(),
    sentAt: Math.max(0, Math.trunc(Number(options.sentAt || 0))),
    respondedAt: Math.max(0, Math.trunc(Number(options.respondedAt || Date.now()))),
  };
}

export function parseOpenClawPairChatAck(message: PairV2PeerAppMessage): OpenClawPairChatAck | null {
  if (String(message?.type || '').trim() !== openClawPairChatAckType) {
    return null;
  }
  const payload = message.payload && typeof message.payload === 'object'
    ? message.payload
    : {};
  return {
    messageIds: normalizeOpenClawPairChatAfterIds(payload.messageIds),
    ts: Number(message.ts || Date.now()),
    from: message.from === 'desktop' ? 'desktop' : 'mobile',
  };
}

export function parseOpenClawPairChatSyncRequest(message: PairV2PeerAppMessage): OpenClawPairChatSyncRequest | null {
  if (String(message?.type || '').trim() !== openClawPairChatSyncRequestType) {
    return null;
  }
  const payload = message.payload && typeof message.payload === 'object'
    ? message.payload
    : {};
  return {
    messageIds: normalizeOpenClawPairChatAfterIds(payload.messageIds),
    ts: Number(message.ts || Date.now()),
    from: message.from === 'desktop' ? 'desktop' : 'mobile',
  };
}

export function parseOpenClawPairChatSyncState(message: PairV2PeerAppMessage): OpenClawPairChatSyncState | null {
  if (String(message?.type || '').trim() !== openClawPairChatSyncStateType) {
    return null;
  }
  const payload = message.payload && typeof message.payload === 'object'
    ? message.payload
    : {};
  return {
    hostSeq: Math.max(0, Math.trunc(Number(payload.hostSeq || 0))),
    mobileSeq: Math.max(0, Math.trunc(Number(payload.mobileSeq || 0))),
    leafIds: normalizeOpenClawPairChatAfterIds(payload.leafIds),
    ts: Number(message.ts || Date.now()),
    from: message.from === 'desktop' ? 'desktop' : 'mobile',
  };
}

export function parseOpenClawPairChatPing(message: PairV2PeerAppMessage): OpenClawPairChatPing | null {
  if (String(message?.type || '').trim() !== openClawPairChatPingType) {
    return null;
  }
  const payload = message.payload && typeof message.payload === 'object'
    ? message.payload
    : {};
  const id = String(payload.id || '').trim();
  if (!id) {
    return null;
  }
  return {
    id,
    sentAt: Math.max(0, Math.trunc(Number(payload.sentAt || 0))),
    ts: Number(message.ts || Date.now()),
    from: message.from === 'desktop' ? 'desktop' : 'mobile',
  };
}

export function parseOpenClawPairChatPong(message: PairV2PeerAppMessage): OpenClawPairChatPong | null {
  if (String(message?.type || '').trim() !== openClawPairChatPongType) {
    return null;
  }
  const payload = message.payload && typeof message.payload === 'object'
    ? message.payload
    : {};
  const id = String(payload.id || '').trim();
  if (!id) {
    return null;
  }
  return {
    id,
    sentAt: Math.max(0, Math.trunc(Number(payload.sentAt || 0))),
    respondedAt: Math.max(0, Math.trunc(Number(payload.respondedAt || 0))),
    ts: Number(message.ts || Date.now()),
    from: message.from === 'desktop' ? 'desktop' : 'mobile',
  };
}

export function createOpenClawPairChatModule<TContext>(options: {
  onChatMessage: (message: OpenClawPairChatEvent, context: TContext) => void | Promise<void>;
}): PairV2AppModule<TContext> {
  return {
    id: 'openclaw.chat',
    feature: openClawPairChatFeature,
    supportedMessages: [
      openClawPairChatMessageType,
      openClawPairChatAckType,
      openClawPairChatSyncRequestType,
      openClawPairChatSyncStateType,
      openClawPairChatPingType,
      openClawPairChatPongType,
    ],
    async onMessage(message, context) {
      const chat = parseOpenClawPairChatMessage(message);
      if (!chat) {
        return;
      }
      await options.onChatMessage(chat, context);
    }
  };
}
