import type { PairV2EntityType, PairV2PeerAppMessage } from '@openclaw/pair-sdk';

export const openClawPairChannelRevokeType = 'app.openclaw.channel.revoke';

export type OpenClawPairChannelRevoke = {
  channelId: string;
  bindingId: string;
  sessionId: string;
  revokedBy: PairV2EntityType;
  revokedAt: number;
};

export function buildOpenClawPairChannelRevokePayload(options: {
  channelId?: string;
  bindingId?: string;
  sessionId?: string;
  revokedBy?: PairV2EntityType;
  revokedAt?: number;
}) {
  return {
    channelId: String(options.channelId || '').trim(),
    bindingId: String(options.bindingId || '').trim(),
    sessionId: String(options.sessionId || '').trim(),
    revokedBy: options.revokedBy === 'desktop' ? 'desktop' : 'mobile',
    revokedAt: Math.max(0, Math.trunc(Number(options.revokedAt || Date.now()))),
  };
}

export function parseOpenClawPairChannelRevoke(
  message: PairV2PeerAppMessage
): OpenClawPairChannelRevoke | null {
  if (String(message?.type || '').trim() !== openClawPairChannelRevokeType) {
    return null;
  }
  const payload =
    message.payload && typeof message.payload === 'object' ? message.payload : {};
  return {
    channelId: String(payload.channelId || '').trim(),
    bindingId: String(payload.bindingId || '').trim(),
    sessionId: String(payload.sessionId || '').trim(),
    revokedBy: message.from === 'desktop' ? 'desktop' : 'mobile',
    revokedAt: Math.max(0, Math.trunc(Number(payload.revokedAt || message.ts || Date.now()))),
  };
}
