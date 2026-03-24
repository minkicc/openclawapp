import type { PairV2PeerAppMessage, PairV2PeerCapabilities } from './peer.js';

export type PairV2AppModule<TContext> = {
  id: string;
  feature?: string;
  supportedMessages: string[];
  onMessage: (message: PairV2PeerAppMessage, context: TContext) => void | Promise<void>;
};

function uniqueTrimmedStrings(values: unknown[]) {
  return Array.from(new Set(values.map((value) => String(value || '').trim()).filter(Boolean)));
}

export function createPairV2AppRegistry<TContext>(modules: PairV2AppModule<TContext>[]) {
  const activeModules = Array.isArray(modules) ? modules.filter(Boolean) : [];
  const supportedMessages = uniqueTrimmedStrings(
    activeModules.flatMap((module) => Array.isArray(module.supportedMessages) ? module.supportedMessages : [])
  );
  const features = uniqueTrimmedStrings(
    activeModules.map((module) => module.feature)
  );

  return {
    buildCapabilities(base: Partial<PairV2PeerCapabilities> = {}): PairV2PeerCapabilities {
      const baseMessages = Array.isArray(base.supportedMessages) ? base.supportedMessages : [];
      const baseFeatures = Array.isArray(base.features) ? base.features : [];
      return {
        protocolVersion: String(base.protocolVersion || 'openclaw-pair-v2').trim() || 'openclaw-pair-v2',
        supportedMessages: uniqueTrimmedStrings([...baseMessages, ...supportedMessages]),
        features: uniqueTrimmedStrings([...baseFeatures, ...features]),
        appId: String(base.appId || '').trim() || undefined,
        appVersion: String(base.appVersion || '').trim() || undefined
      };
    },
    supports(type: string) {
      const normalized = String(type || '').trim();
      return normalized ? supportedMessages.includes(normalized) : false;
    },
    async dispatch(message: PairV2PeerAppMessage, context: TContext) {
      let handled = false;
      for (const module of activeModules) {
        const messageTypes = Array.isArray(module.supportedMessages) ? module.supportedMessages : [];
        if (!messageTypes.includes(message.type)) {
          continue;
        }
        await module.onMessage(message, context);
        handled = true;
      }
      return handled;
    }
  };
}
