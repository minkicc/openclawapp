import {
  analyzeOpenClawPairChatGraph,
  collectOpenClawPairChatLeafIds,
  normalizeOpenClawPairChatAfterIds,
} from '@openclaw/message-sdk';
import type { ChatMessage } from '../types/session';

function normalizeMessageTs(message: ChatMessage) {
  return Number(message?.ts || 0);
}

function normalizeOrigin(message: ChatMessage) {
  return message.origin === 'mobile' ? 'mobile' : 'host';
}

function normalizeOriginSeq(message: ChatMessage) {
  return Math.max(0, Math.trunc(Number(message?.originSeq || 0)));
}

function compareFallbackOrder(left: ChatMessage, right: ChatMessage) {
  const leftTs = normalizeMessageTs(left);
  const rightTs = normalizeMessageTs(right);
  if (leftTs !== rightTs) {
    return leftTs - rightTs;
  }
  return String(left.id || '').localeCompare(String(right.id || ''));
}

export function normalizeChatMessage(message: ChatMessage): ChatMessage {
  const kind = message.kind === 'system' ? 'system' : 'chat';
  return {
    ...message,
    id: String(message.id || '').trim(),
    text: String(message.text || ''),
    createdAt: String(message.createdAt || ''),
    ts: normalizeMessageTs(message),
    kind,
    origin: kind === 'system' ? undefined : normalizeOrigin(message),
    originSeq: kind === 'system' ? undefined : normalizeOriginSeq(message),
    after: kind === 'chat' ? normalizeOpenClawPairChatAfterIds(message.after) : [],
    missingAfter: kind === 'chat' ? normalizeOpenClawPairChatAfterIds(message.missingAfter) : [],
  };
}

function extractChatMessages(messages: ChatMessage[]) {
  return messages
    .map(normalizeChatMessage)
    .filter((message) => message.kind !== 'system' && message.id);
}

export function collectSessionLeafIds(messages: ChatMessage[]) {
  return collectOpenClawPairChatLeafIds(
    extractChatMessages(messages).map((message) => ({
      id: message.id,
      after: message.after || [],
      ts: message.ts,
    }))
  );
}

export function describeSessionChatState(messages: ChatMessage[]) {
  const chatMessages = extractChatMessages(messages);
  const byOrigin = new Map<'host' | 'mobile', Set<number>>([
    ['host', new Set<number>()],
    ['mobile', new Set<number>()],
  ]);
  for (const message of chatMessages) {
    const origin = normalizeOrigin(message);
    const originSeq = normalizeOriginSeq(message);
    if (originSeq > 0) {
      byOrigin.get(origin)?.add(originSeq);
    }
  }

  const contiguousSeq = (origin: 'host' | 'mobile') => {
    const values = Array.from(byOrigin.get(origin) || []).sort((left, right) => left - right);
    let expected = 1;
    for (const value of values) {
      if (value !== expected) {
        break;
      }
      expected += 1;
    }
    return expected - 1;
  };

  return {
    hostSeq: contiguousSeq('host'),
    mobileSeq: contiguousSeq('mobile'),
    leafIds: collectOpenClawPairChatLeafIds(
      chatMessages.map((message) => ({
        id: message.id,
        after: message.after || [],
        ts: message.ts,
      }))
    ),
  };
}

export function reconcileSessionMessages(messages: ChatMessage[]) {
  const systemMessages = new Map<string, ChatMessage>();
  const chatMessages = new Map<string, ChatMessage>();

  for (const rawMessage of Array.isArray(messages) ? messages : []) {
    const message = normalizeChatMessage(rawMessage);
    if (!message.id) {
      continue;
    }
    if (message.kind === 'system') {
      systemMessages.set(message.id, message);
      continue;
    }
    chatMessages.set(message.id, message);
  }

  const analysis = analyzeOpenClawPairChatGraph(
    Array.from(chatMessages.values()).map((message) => ({
      id: message.id,
      after: message.after || [],
      ts: message.ts,
    }))
  );

  const missingIdsSet = new Set(analysis.missingIds);
  const orderedChatMessages = analysis.ordered.map((messageLike) => {
    const message = chatMessages.get(messageLike.id)!;
    return {
      ...message,
      after: normalizeOpenClawPairChatAfterIds(message.after),
      missingAfter: normalizeOpenClawPairChatAfterIds(message.after).filter((id) => missingIdsSet.has(id)),
    };
  });

  const graphOrder = new Map(orderedChatMessages.map((message, index) => [message.id, index]));
  const ordered = [...Array.from(systemMessages.values()), ...orderedChatMessages].sort((left, right) => {
    const leftIndex = graphOrder.get(left.id);
    const rightIndex = graphOrder.get(right.id);
    if (leftIndex != null && rightIndex != null) {
      return leftIndex - rightIndex;
    }
    return compareFallbackOrder(left, right);
  });

  return {
    messages: ordered,
    leafIds: analysis.leafIds,
    missingMessageIds: analysis.missingIds,
  };
}

export function upsertSessionMessage(
  currentMessages: ChatMessage[],
  nextMessage: ChatMessage
) {
  const incoming = normalizeChatMessage(nextMessage);
  const previous = reconcileSessionMessages(currentMessages);
  const previousMissing = new Set(previous.missingMessageIds);
  const nextMessages = currentMessages.filter((message) => String(message?.id || '').trim() !== incoming.id);
  nextMessages.push(incoming);
  const reconciled = reconcileSessionMessages(nextMessages);
  return {
    ...reconciled,
    inserted: !currentMessages.some((message) => String(message?.id || '').trim() === incoming.id),
    newlyMissingMessageIds: reconciled.missingMessageIds.filter((id) => !previousMissing.has(id)),
  };
}
