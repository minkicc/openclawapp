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

function normalizeDescription(value: RTCSessionDescriptionInit | undefined, fallbackType: 'offer' | 'answer') {
  const type = String(value?.type || fallbackType).trim() as 'offer' | 'answer';
  const sdp = String(value?.sdp || '').trim();
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
    const peer = this.ensurePeer('initiator');
    if (!this.dataChannel) {
      this.attachDataChannel(peer.createDataChannel('openclaw-v2'));
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
    if (String(payload?.bindingId || '').trim() !== this.options.bindingId) {
      return;
    }

    if (type === 'webrtc.offer') {
      this.closedByUser = false;
      const peer = this.ensurePeer('answerer', true);
      this.setState('connecting', 'received offer');
      await peer.setRemoteDescription(normalizeDescription(payload.description, 'offer'));
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

  close() {
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

  private async emitSignal(type: PairV2PeerSignalType, payload: PairV2PeerSignalPayload) {
    await this.options.onSignal(type, payload);
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
      this.attachDataChannel(event.channel);
    };
    peer.onconnectionstatechange = () => {
      const current = String(peer.connectionState || '').trim();
      if (current === 'failed') {
        this.disposePeer('peer connection failed', 'failed');
        return;
      }
      if (current === 'disconnected' || current === 'closed') {
        this.disposePeer(`peer connection ${current}`, 'disconnected');
      }
    };
    peer.oniceconnectionstatechange = () => {
      const current = String(peer.iceConnectionState || '').trim();
      if (current === 'failed') {
        this.disposePeer('ice failed', 'failed');
      }
    };
    this.peer = peer;
    this.setState('connecting', `${role} peer ready`);
    return peer;
  }

  private attachDataChannel(channel: RTCDataChannel) {
    if (this.dataChannel && this.dataChannel !== channel) {
      try {
        this.dataChannel.close();
      } catch {
        // ignore
      }
    }
    this.dataChannel = channel;
    channel.onopen = () => {
      this.setState('channel-open', 'data channel open');
      void this.sendHello().catch((error) => {
        this.log(`send hello failed: ${error?.message || String(error)}`);
        this.setState('failed', 'auth hello failed');
      });
    };
    channel.onclose = () => {
      if (!this.closedByUser) {
        this.setState('disconnected', 'data channel closed');
      }
    };
    channel.onerror = () => {
      this.setState('failed', 'data channel error');
    };
    channel.onmessage = (event) => {
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
