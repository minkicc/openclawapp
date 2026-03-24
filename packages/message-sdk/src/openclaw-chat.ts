import type { PairV2EntityType, PairV2PeerAppMessage, PairV2PeerCapabilities, PairV2AppModule } from '@openclaw/pair-sdk';

export const openClawPairChatMessageType = 'app.openclaw.chat.message';
export const openClawPairChatFeature = 'chat';

export type OpenClawPairChatEvent = {
  text: string;
  ts: number;
  from: PairV2EntityType;
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

export function buildOpenClawPairChatPayload(text: string) {
  return {
    text: String(text || '')
  };
}

export function parseOpenClawPairChatMessage(message: PairV2PeerAppMessage): {
  text: string;
  ts: number;
  from: PairV2EntityType;
} | null {
  if (String(message?.type || '').trim() !== openClawPairChatMessageType) {
    return null;
  }
  const payload = message.payload && typeof message.payload === 'object'
    ? message.payload
    : {};
  return {
    text: String(payload.text || ''),
    ts: Number(message.ts || Date.now()),
    from: message.from === 'desktop' ? 'desktop' : 'mobile'
  };
}

export function createOpenClawPairChatModule<TContext>(options: {
  onChatMessage: (message: OpenClawPairChatEvent, context: TContext) => void | Promise<void>;
}): PairV2AppModule<TContext> {
  return {
    id: 'openclaw.chat',
    feature: openClawPairChatFeature,
    supportedMessages: [openClawPairChatMessageType],
    async onMessage(message, context) {
      const chat = parseOpenClawPairChatMessage(message);
      if (!chat) {
        return;
      }
      await options.onChatMessage(chat, context);
    }
  };
}
