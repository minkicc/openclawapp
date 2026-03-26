// @ts-nocheck

const OPENCLAW_CHAT_MESSAGE_TYPE = 'app.openclaw.chat.message';

export function channelSupportsOpenClawChat(channel) {
  const messages = Array.isArray(channel?.peerCapabilities?.supportedMessages)
    ? channel.peerCapabilities.supportedMessages
    : [];
  return messages.length === 0 || messages.includes(OPENCLAW_CHAT_MESSAGE_TYPE);
}

export function normalizeBackendChannel(channel) {
  return {
    ...channel,
    channelId: String(channel?.channelId || channel?.sessionId || channel?.bindingId || '').trim(),
    sessionId: String(channel?.sessionId || channel?.channelId || '').trim(),
    mobileId: String(channel?.mobileId || '').trim(),
    bindingId: String(channel?.bindingId || '').trim(),
    status: String(channel?.status || 'offline'),
    trustState: String(channel?.trustState || 'pending'),
    peerState: String(channel?.peerState || 'idle'),
    peerDetail: String(channel?.peerDetail || ''),
    createdAt: Number(channel?.createdAt || Date.now()),
    approvedAt: channel?.approvedAt ?? null,
    safetyCode: String(channel?.safetyCode || ''),
    qrPayload: channel?.qrPayload || null,
    peerCapabilities: channel?.peerCapabilities || null,
    messages: Array.isArray(channel?.messages)
      ? channel.messages.map((message) => ({
          id: String(message?.id || ''),
          from:
            message?.from === 'desktop' || message?.from === 'agent'
              ? message.from
              : 'mobile',
          text: String(message?.text || ''),
          ts: Number(message?.ts || Date.now())
        }))
      : []
  };
}
