import { signPairV2Text, verifyPairV2Text, type PairV2EntityType } from './web.js';

export type PairV2PeerState =
  | 'idle'
  | 'connecting'
  | 'channel-open'
  | 'verifying'
  | 'connected'
  | 'disconnected'
  | 'failed';

type PairV2PeerSignalType = 'webrtc.offer' | 'webrtc.answer' | 'webrtc.ice';

const pairV2PeerHelloType = 'sys.auth.hello';
const pairV2PeerCapabilitiesType = 'sys.capabilities';

export type PairV2PeerCapabilities = {
  protocolVersion: string;
  supportedMessages: string[];
  features?: string[];
  appId?: string;
  appVersion?: string;
};

type PairV2PeerSignalPayload = {
  bindingId: string;
  description?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit | null;
};

type PairV2PeerHelloEnvelope = {
  type: typeof pairV2PeerHelloType;
  bindingId: string;
  entityType: PairV2EntityType;
  entityId: string;
  publicKey: string;
  nonce: string;
  signature: string;
};

type PairV2PeerCapabilitiesEnvelope = {
  type: typeof pairV2PeerCapabilitiesType;
  protocolVersion: string;
  supportedMessages: string[];
  features?: string[];
  appId?: string;
  appVersion?: string;
};

type PairV2PeerAppEnvelope = {
  type: string;
  payload?: Record<string, unknown>;
  ts?: number;
  from?: PairV2EntityType;
};

type PairV2PeerEnvelope =
  | PairV2PeerHelloEnvelope
  | PairV2PeerCapabilitiesEnvelope
  | PairV2PeerAppEnvelope;

export type PairV2PeerAppMessage = {
  type: string;
  payload: Record<string, unknown>;
  ts: number;
  from: PairV2EntityType;
};

export type PairV2PeerOptions = {
  role: PairV2EntityType;
  selfId: string;
  selfPublicKey: string;
  selfPrivateKey: string;
  trustedPeerId: string;
  trustedPeerPublicKey: string;
  bindingId: string;
  iceServers?: RTCIceServer[];
  capabilities?: Partial<PairV2PeerCapabilities>;
  onSignal: (type: PairV2PeerSignalType, payload: PairV2PeerSignalPayload) => Promise<void> | void;
  onStateChange?: (state: PairV2PeerState, detail?: string) => void;
  onCapabilities?: (capabilities: PairV2PeerCapabilities) => void;
  onAppMessage?: (message: PairV2PeerAppMessage) => Promise<void> | void;
  onLog?: (line: string) => void;
};

function makeNonce() {
  return globalThis.crypto?.randomUUID?.() || `nonce_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
}

function ensureWebRtcSupport() {
  if (typeof RTCPeerConnection !== 'function') {
    throw new Error('当前环境不支持 WebRTC');
  }
}

function buildHelloMessageText(payload: {
  bindingId: string;
  entityType: PairV2EntityType;
  entityId: string;
  publicKey: string;
  nonce: string;
}) {
  return `openclaw-v2-peer-hello\n${payload.bindingId}\n${payload.entityType}\n${payload.entityId}\n${payload.publicKey}\n${payload.nonce}`;
}

function trustedRemoteRole(role: PairV2EntityType): PairV2EntityType {
  return role === 'desktop' ? 'mobile' : 'desktop';
}

function isAppMessageType(value: string) {
  return String(value || '').trim().startsWith('app.');
}

function isHelloEnvelope(value: PairV2PeerEnvelope): value is PairV2PeerHelloEnvelope {
  return value.type === pairV2PeerHelloType;
}

function isCapabilitiesEnvelope(value: PairV2PeerEnvelope): value is PairV2PeerCapabilitiesEnvelope {
  return value.type === pairV2PeerCapabilitiesType;
}

function isAppEnvelope(value: PairV2PeerEnvelope): value is PairV2PeerAppEnvelope {
  return isAppMessageType(value.type);
}

function normalizeSdpText(raw: unknown) {
  let text = String(raw ?? '');
  if (!text.trim()) {
    return '';
  }

  if (!/[\r\n]/.test(text) && /\\r\\n|\\n|\\r/.test(text)) {
    text = text
      .replaceAll('\\r\\n', '\r\n')
      .replaceAll('\\n', '\n')
      .replaceAll('\\r', '\r');
  }

  const trimmed = text.trim();
  if (!trimmed) {
    return '';
  }

  const normalized = trimmed.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n/g, '\r\n');
  return normalized.endsWith('\r\n') ? normalized : `${normalized}\r\n`;
}

function normalizeDescription(value: RTCSessionDescriptionInit | string | undefined, fallbackType: 'offer' | 'answer') {
  let candidate = value;
  if (typeof candidate === 'string') {
    const trimmed = candidate.trim();
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      try {
        candidate = JSON.parse(trimmed) as RTCSessionDescriptionInit;
      } catch {
        candidate = {
          type: fallbackType,
          sdp: trimmed,
        } satisfies RTCSessionDescriptionInit;
      }
    } else {
      candidate = {
        type: fallbackType,
        sdp: trimmed,
      } satisfies RTCSessionDescriptionInit;
    }
  }

  const type = String(candidate?.type || fallbackType).trim() as 'offer' | 'answer';
  const sdp = normalizeSdpText(candidate?.sdp);
  if (!sdp) {
    throw new Error(`missing ${fallbackType} sdp`);
  }
  return { type, sdp } as RTCSessionDescriptionInit;
}

function normalizeCandidate(value: RTCIceCandidateInit | null | undefined) {
  if (!value) {
    return null;
  }
  const candidate = String(value.candidate || '').trim();
  if (!candidate) {
    return null;
  }
  return {
    candidate,
    sdpMid: value.sdpMid ?? null,
    sdpMLineIndex: value.sdpMLineIndex ?? null,
    usernameFragment: value.usernameFragment ?? null
  } as RTCIceCandidateInit;
}

function uniqueTrimmedStrings(values: unknown[]) {
  return Array.from(new Set(values.map((value) => String(value || '').trim()).filter(Boolean)));
}

function normalizeCapabilities(value: Partial<PairV2PeerCapabilities> | null | undefined): PairV2PeerCapabilities {
  const supportedMessages = uniqueTrimmedStrings([
    pairV2PeerHelloType,
    pairV2PeerCapabilitiesType,
    ...(Array.isArray(value?.supportedMessages) ? value?.supportedMessages : [])
  ]);
  const features = uniqueTrimmedStrings(Array.isArray(value?.features) ? value?.features : []);
  const normalized: PairV2PeerCapabilities = {
    protocolVersion: String(value?.protocolVersion || 'openclaw-pair-v2').trim() || 'openclaw-pair-v2',
    supportedMessages
  };
  if (features.length > 0) {
    normalized.features = features;
  }
  if (String(value?.appId || '').trim()) {
    normalized.appId = String(value?.appId || '').trim();
  }
  if (String(value?.appVersion || '').trim()) {
    normalized.appVersion = String(value?.appVersion || '').trim();
  }
  return normalized;
}

export class PairV2PeerChannel {
  private readonly options: PairV2PeerOptions;

  private peer: RTCPeerConnection | null = null;

  private dataChannel: RTCDataChannel | null = null;

  private state: PairV2PeerState = 'idle';

  private signalChain: Promise<void> = Promise.resolve();

  private pendingRemoteCandidates: RTCIceCandidateInit[] = [];

  private helloSent = false;

  private capabilitiesSent = false;

  private remoteVerified = false;

  private remoteCapabilities: PairV2PeerCapabilities | null = null;

  private closedByUser = false;

  constructor(options: PairV2PeerOptions) {
    this.options = options;
  }

  getState() {
    return this.state;
  }

  isReady() {
    return this.state === 'connected' && this.dataChannel?.readyState === 'open' && this.remoteVerified;
  }

  getRemoteCapabilities() {
    return this.remoteCapabilities ? { ...this.remoteCapabilities } : null;
  }

  supportsRemoteMessage(type: string) {
    const normalizedType = String(type || '').trim();
    if (!normalizedType) {
      return false;
    }
    if (!this.remoteCapabilities) {
      return true;
    }
    return this.remoteCapabilities.supportedMessages.includes(normalizedType);
  }

  async sendAppMessage(type: string, payload: Record<string, unknown> = {}) {
    if (!this.isReady() || !this.dataChannel) {
      throw new Error('peer channel is not ready');
    }
    const normalizedType = String(type || '').trim();
    if (!isAppMessageType(normalizedType)) {
      throw new Error('app message type must start with app.');
    }
    if (!this.supportsRemoteMessage(normalizedType)) {
      throw new Error(`peer does not advertise support for ${normalizedType}`);
    }
    const envelope: PairV2PeerEnvelope = {
      type: normalizedType,
      payload: payload && typeof payload === 'object' ? payload : {},
      ts: Date.now(),
      from: this.options.role
    };
    this.dataChannel.send(JSON.stringify(envelope));
  }

  async connect() {
    ensureWebRtcSupport();
    this.closedByUser = false;
    if (this.isReady()) {
      return;
    }
    const peer = this.ensurePeer('initiator', this.shouldRecreateForConnect());
    if (!this.dataChannel || this.isDataChannelClosed(this.dataChannel)) {
      this.attachDataChannel(peer.createDataChannel('openclaw-v2'), peer);
    }
    this.setState('connecting', 'creating offer');
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    await this.emitSignal('webrtc.offer', {
      bindingId: this.options.bindingId,
      description: peer.localDescription ? { type: peer.localDescription.type, sdp: peer.localDescription.sdp } : offer
    });
  }

  async handleSignal(type: PairV2PeerSignalType, payload: PairV2PeerSignalPayload) {
    return this.enqueueSignal(async () => {
      if (String(payload?.bindingId || '').trim() !== this.options.bindingId) {
        return;
      }
      await this.handleSignalInternal(type, payload);
    });
  }

  close() {
    this.log(`close() called state=${this.state}`);
    this.closedByUser = true;
    this.disposePeer('closed by user', 'disconnected');
  }

  private setState(state: PairV2PeerState, detail = '') {
    this.state = state;
    this.options.onStateChange?.(state, detail);
  }

  private log(line: string) {
    this.options.onLog?.(line);
  }

  private summarizeIceCandidate(candidate: Record<string, unknown> | null | undefined) {
    if (!candidate) {
      return '-';
    }
    const candidateType = String(
      candidate.candidateType || candidate.type || candidate.networkType || ''
    ).trim();
    const ip = String(
      candidate.ip || candidate.address || candidate.ipAddress || candidate.relatedAddress || ''
    ).trim();
    const port = Number(candidate.port || candidate.relatedPort || 0);
    const protocol = String(candidate.protocol || '').trim().toLowerCase();
    const networkType = String(candidate.networkType || '').trim().toLowerCase();
    const parts = [
      candidateType || 'candidate',
      ip ? `${ip}${port > 0 ? `:${port}` : ''}` : '',
      protocol || '',
      networkType || '',
    ].filter(Boolean);
    return parts.join(' ');
  }

  private async logSelectedCandidatePair(
    peer: RTCPeerConnection,
    reason: string
  ) {
    if (!peer || typeof peer.getStats !== 'function') {
      return;
    }

    try {
      const report = await peer.getStats();
      const entries = new Map<string, Record<string, unknown>>();

      const addEntry = (value: unknown) => {
        if (!value || typeof value !== 'object') {
          return;
        }
        const record = value as Record<string, unknown>;
        const id = String(record.id || '').trim();
        if (!id) {
          return;
        }
        entries.set(id, record);
      };

      if (typeof (report as { forEach?: unknown }).forEach === 'function') {
        (report as { forEach: (callback: (value: unknown) => void) => void }).forEach((value) => {
          addEntry(value);
        });
      } else if (Symbol.iterator in Object(report)) {
        for (const entry of report as Iterable<unknown>) {
          if (Array.isArray(entry) && entry.length >= 2) {
            addEntry(entry[1]);
          } else {
            addEntry(entry);
          }
        }
      }

      let pair: Record<string, unknown> | null = null;

      for (const stat of entries.values()) {
        if (String(stat.type || '').trim() !== 'transport') {
          continue;
        }
        const candidatePairId = String(stat.selectedCandidatePairId || '').trim();
        if (candidatePairId && entries.has(candidatePairId)) {
          pair = entries.get(candidatePairId) || null;
          break;
        }
      }

      if (!pair) {
        for (const stat of entries.values()) {
          if (String(stat.type || '').trim() !== 'candidate-pair') {
            continue;
          }
          const selected = Boolean(stat.selected);
          const nominated = Boolean(stat.nominated);
          const state = String(stat.state || '').trim().toLowerCase();
          if (selected || (nominated && state === 'succeeded')) {
            pair = stat;
            break;
          }
        }
      }

      if (!pair) {
        this.log(`candidate pair (${reason}): unavailable`);
        return;
      }

      const localCandidateId = String(pair.localCandidateId || '').trim();
      const remoteCandidateId = String(pair.remoteCandidateId || '').trim();
      const localCandidate = localCandidateId ? entries.get(localCandidateId) || null : null;
      const remoteCandidate = remoteCandidateId ? entries.get(remoteCandidateId) || null : null;
      const pairState = String(pair.state || '').trim() || '-';
      const currentRoundTripTime = Number(pair.currentRoundTripTime || 0);
      const rttMs =
        currentRoundTripTime > 0 ? Math.max(0, Math.round(currentRoundTripTime * 1000)) : 0;
      this.log(
        `candidate pair (${reason}): local=${this.summarizeIceCandidate(localCandidate)} remote=${this.summarizeIceCandidate(remoteCandidate)} state=${pairState}${rttMs > 0 ? ` rtt=${rttMs}ms` : ''}`
      );
    } catch (error) {
      this.log(`candidate pair stats failed (${reason}): ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async emitSignal(type: PairV2PeerSignalType, payload: PairV2PeerSignalPayload) {
    await this.options.onSignal(type, payload);
  }

  private enqueueSignal(task: () => Promise<void>) {
    const next = this.signalChain.catch(() => undefined).then(task);
    this.signalChain = next.catch(() => undefined);
    return next;
  }

  private async handleSignalInternal(type: PairV2PeerSignalType, payload: PairV2PeerSignalPayload) {
    if (type === 'webrtc.offer') {
      this.closedByUser = false;
      const description = normalizeDescription(payload.description, 'offer');
      const peer = this.ensurePeer('answerer', this.shouldRecreateForOffer(description));
      this.setState('connecting', 'received offer');

      if (this.hasSameDescription(peer.remoteDescription, description)) {
        if (peer.localDescription?.type === 'answer' && peer.localDescription.sdp) {
          await this.emitSignal('webrtc.answer', {
            bindingId: this.options.bindingId,
            description: {
              type: peer.localDescription.type,
              sdp: peer.localDescription.sdp
            }
          });
          return;
        }
      } else {
        await peer.setRemoteDescription(description);
      }

      await this.flushRemoteCandidates();
      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);
      await this.emitSignal('webrtc.answer', {
        bindingId: this.options.bindingId,
        description: peer.localDescription ? { type: peer.localDescription.type, sdp: peer.localDescription.sdp } : answer
      });
      return;
    }

    if (type === 'webrtc.answer') {
      const peer = this.ensurePeer('initiator');
      await peer.setRemoteDescription(normalizeDescription(payload.description, 'answer'));
      await this.flushRemoteCandidates();
      return;
    }

    if (type === 'webrtc.ice') {
      const candidate = normalizeCandidate(payload.candidate);
      if (!candidate) {
        return;
      }
      const peer = this.ensurePeer('answerer');
      if (peer.remoteDescription) {
        await peer.addIceCandidate(candidate);
      } else {
        this.pendingRemoteCandidates.push(candidate);
      }
    }
  }

  private ensurePeer(role: 'initiator' | 'answerer', forceRecreate = false) {
    ensureWebRtcSupport();
    if (forceRecreate) {
      this.disposePeer(`recreate as ${role}`, 'connecting');
    }
    if (this.peer) {
      return this.peer;
    }
    this.remoteVerified = false;
    this.helloSent = false;
    this.capabilitiesSent = false;
    this.remoteCapabilities = null;
    const peer = new RTCPeerConnection({
      iceServers: Array.isArray(this.options.iceServers) ? this.options.iceServers : []
    });
    peer.onicecandidate = (event) => {
      const candidate = normalizeCandidate(event.candidate?.toJSON?.() || event.candidate || null);
      if (!candidate) {
        return;
      }
      void this.emitSignal('webrtc.ice', {
        bindingId: this.options.bindingId,
        candidate
      }).catch((error) => {
        this.log(`send ice failed: ${error?.message || String(error)}`);
      });
    };
    peer.ondatachannel = (event) => {
      this.attachDataChannel(event.channel, peer);
    };
    peer.onconnectionstatechange = () => {
      if (!this.isCurrentPeer(peer)) {
        this.log(`ignored stale peer state: ${String(peer.connectionState || '').trim() || '-'}`);
        return;
      }
      const current = String(peer.connectionState || '').trim();
      const iceState = String(peer.iceConnectionState || '').trim();
      this.log(`peer connection state=${current || '-'} ice=${iceState || '-'}`);
      if (current === 'connected') {
        void this.logSelectedCandidatePair(peer, 'connectionstatechange');
      }
      if (current === 'failed') {
        this.disposePeer('peer connection failed', 'failed');
        return;
      }
      if (current === 'closed') {
        this.disposePeer(`peer connection ${current}`, 'disconnected');
        return;
      }
      if (current === 'disconnected') {
        this.setState('disconnected', 'peer connection disconnected');
      }
    };
    peer.oniceconnectionstatechange = () => {
      if (!this.isCurrentPeer(peer)) {
        return;
      }
      const current = String(peer.iceConnectionState || '').trim();
      this.log(`ice connection state=${current || '-'}`);
      if (current === 'connected' || current === 'completed') {
        void this.logSelectedCandidatePair(peer, `ice-${current.toLowerCase()}`);
      }
      if (current === 'failed') {
        this.disposePeer('ice failed', 'failed');
      }
    };
    this.peer = peer;
    this.setState('connecting', `${role} peer ready`);
    return peer;
  }

  private shouldRecreateForOffer(description: RTCSessionDescriptionInit) {
    if (!this.peer) {
      return false;
    }
    if (this.hasSameDescription(this.peer.remoteDescription, description)) {
      return false;
    }
    return Boolean(this.peer.remoteDescription || this.peer.localDescription || this.dataChannel);
  }

  private shouldRecreateForConnect() {
    if (!this.peer) {
      return false;
    }
    if (this.isPeerTerminal(this.peer)) {
      return true;
    }
    if (this.dataChannel && this.isDataChannelClosed(this.dataChannel)) {
      return true;
    }
    return false;
  }

  private hasSameDescription(
    current: RTCSessionDescription | RTCSessionDescriptionInit | null | undefined,
    next: RTCSessionDescriptionInit | null | undefined
  ) {
    if (!current || !next) {
      return false;
    }
    return String(current.type || '').trim() === String(next.type || '').trim() && String(current.sdp || '') === String(next.sdp || '');
  }

  private isPeerTerminal(peer: RTCPeerConnection) {
    const state = String(peer.connectionState || '').trim();
    return state === 'failed' || state === 'closed' || state === 'disconnected';
  }

  private isCurrentPeer(peer: RTCPeerConnection | null | undefined) {
    return Boolean(peer) && this.peer === peer;
  }

  private isCurrentDataChannel(channel: RTCDataChannel | null | undefined, ownerPeer?: RTCPeerConnection | null) {
    if (!channel || this.dataChannel !== channel) {
      return false;
    }
    if (ownerPeer && this.peer !== ownerPeer) {
      return false;
    }
    return true;
  }

  private isDataChannelClosed(channel: RTCDataChannel) {
    const state = String(channel?.readyState || '').trim();
    return state === 'closing' || state === 'closed';
  }

  private attachDataChannel(channel: RTCDataChannel, ownerPeer: RTCPeerConnection | null = this.peer) {
    if (this.dataChannel && this.dataChannel !== channel) {
      try {
        this.dataChannel.close();
      } catch {
        // ignore
      }
    }
    this.dataChannel = channel;
    channel.onopen = () => {
      if (!this.isCurrentDataChannel(channel, ownerPeer)) {
        this.log('ignored stale data channel open');
        return;
      }
      this.setState('channel-open', 'data channel open');
      if (ownerPeer) {
        void this.logSelectedCandidatePair(ownerPeer, 'data-channel-open');
      }
      void this.sendHello().catch((error) => {
        this.log(`send hello failed: ${error?.message || String(error)}`);
        this.setState('failed', 'auth hello failed');
      });
    };
    channel.onclose = () => {
      if (!this.isCurrentDataChannel(channel, ownerPeer)) {
        this.log('ignored stale data channel close');
        return;
      }
      this.dataChannel = null;
      if (!this.closedByUser && this.peer === ownerPeer) {
        this.disposePeer('data channel closed', 'disconnected');
      }
    };
    channel.onerror = () => {
      if (!this.isCurrentDataChannel(channel, ownerPeer)) {
        this.log('ignored stale data channel error');
        return;
      }
      this.dataChannel = null;
      if (this.peer === ownerPeer) {
        this.disposePeer('data channel error', 'failed');
      }
    };
    channel.onmessage = (event) => {
      if (!this.isCurrentDataChannel(channel, ownerPeer)) {
        this.log('ignored stale data channel message');
        return;
      }
      void this.handleDataMessage(event.data).catch((error) => {
        this.log(`handle data message failed: ${error?.message || String(error)}`);
      });
    };
  }

  private async sendHello() {
    if (!this.dataChannel || this.dataChannel.readyState !== 'open' || this.helloSent) {
      return;
    }
    const nonce = makeNonce();
    const signature = await signPairV2Text(
      this.options.selfPrivateKey,
      buildHelloMessageText({
        bindingId: this.options.bindingId,
        entityType: this.options.role,
        entityId: this.options.selfId,
        publicKey: this.options.selfPublicKey,
        nonce
      })
    );
    const hello: PairV2PeerEnvelope = {
      type: pairV2PeerHelloType,
      bindingId: this.options.bindingId,
      entityType: this.options.role,
      entityId: this.options.selfId,
      publicKey: this.options.selfPublicKey,
      nonce,
      signature
    };
    this.helloSent = true;
    this.dataChannel.send(JSON.stringify(hello));
    if (this.remoteVerified) {
      this.setState('connected', 'peer verified');
      await this.sendCapabilitiesIfReady();
    } else {
      this.setState('verifying', 'hello sent');
    }
  }

  private async sendCapabilitiesIfReady() {
    if (!this.dataChannel || this.dataChannel.readyState !== 'open' || !this.helloSent || !this.remoteVerified || this.capabilitiesSent) {
      return;
    }
    const capabilities = normalizeCapabilities(this.options.capabilities);
    const envelope: PairV2PeerEnvelope = {
      type: pairV2PeerCapabilitiesType,
      protocolVersion: capabilities.protocolVersion,
      supportedMessages: capabilities.supportedMessages,
      features: capabilities.features,
      appId: capabilities.appId,
      appVersion: capabilities.appVersion
    };
    this.capabilitiesSent = true;
    this.dataChannel.send(JSON.stringify(envelope));
  }

  private async handleDataMessage(raw: string) {
    let payload: PairV2PeerEnvelope | null = null;
    try {
      payload = JSON.parse(String(raw || '')) as PairV2PeerEnvelope;
    } catch {
      this.log(`ignored non-json peer payload: ${String(raw || '').slice(0, 64)}`);
      return;
    }
    if (!payload || typeof payload !== 'object') {
      return;
    }
    const rawType = String(payload.type || '');

    if (isHelloEnvelope(payload)) {
      const trustedRole = trustedRemoteRole(this.options.role);
      if (
        payload.bindingId !== this.options.bindingId ||
        payload.entityType !== trustedRole ||
        payload.entityId !== this.options.trustedPeerId ||
        payload.publicKey !== this.options.trustedPeerPublicKey
      ) {
        throw new Error('peer hello does not match trusted binding');
      }
      const verified = await verifyPairV2Text(
        this.options.trustedPeerPublicKey,
        buildHelloMessageText({
          bindingId: payload.bindingId,
          entityType: payload.entityType,
          entityId: payload.entityId,
          publicKey: payload.publicKey,
          nonce: payload.nonce
        }),
        payload.signature
      );
      if (!verified) {
        throw new Error('peer hello signature verification failed');
      }
      this.remoteVerified = true;
      if (!this.helloSent) {
        await this.sendHello();
      }
      this.setState('connected', 'peer verified');
      await this.sendCapabilitiesIfReady();
      return;
    }

    if (!this.remoteVerified) {
      this.log('ignored peer payload before auth verification');
      return;
    }

    if (isCapabilitiesEnvelope(payload)) {
      this.remoteCapabilities = normalizeCapabilities(payload);
      this.options.onCapabilities?.(this.getRemoteCapabilities() as PairV2PeerCapabilities);
      return;
    }

    if (isAppEnvelope(payload)) {
      const message: PairV2PeerAppMessage = {
        type: String(payload.type || '').trim(),
        payload: payload.payload && typeof payload.payload === 'object' ? payload.payload : {},
        ts: Number(payload.ts || Date.now()),
        from: payload.from === 'desktop' ? 'desktop' : payload.from === 'mobile' ? 'mobile' : trustedRemoteRole(this.options.role)
      };
      await this.options.onAppMessage?.(message);
      return;
    }

    this.log(`ignored unsupported peer payload type: ${rawType}`);
  }

  private async flushRemoteCandidates() {
    if (!this.peer || !this.peer.remoteDescription || this.pendingRemoteCandidates.length === 0) {
      return;
    }
    const queued = [...this.pendingRemoteCandidates];
    this.pendingRemoteCandidates = [];
    for (const candidate of queued) {
      await this.peer.addIceCandidate(candidate);
    }
  }

  private disposePeer(detail: string, state: PairV2PeerState) {
    this.pendingRemoteCandidates = [];
    this.remoteVerified = false;
    this.helloSent = false;
    this.capabilitiesSent = false;
    this.remoteCapabilities = null;
    if (this.dataChannel) {
      this.dataChannel.onopen = null;
      this.dataChannel.onclose = null;
      this.dataChannel.onerror = null;
      this.dataChannel.onmessage = null;
      try {
        this.dataChannel.close();
      } catch {
        // ignore
      }
      this.dataChannel = null;
    }
    if (this.peer) {
      this.peer.onicecandidate = null;
      this.peer.ondatachannel = null;
      this.peer.onconnectionstatechange = null;
      this.peer.oniceconnectionstatechange = null;
      try {
        this.peer.close();
      } catch {
        // ignore
      }
      this.peer = null;
    }
    this.setState(state, detail);
  }
}
