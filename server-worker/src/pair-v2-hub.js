import {
  MAX_SIGNAL_QUEUE_PULL,
  V2_AUTH_SESSION_TTL_MS,
  V2_CHALLENGE_TTL_MS,
  V2_PAIR_SESSION_DEFAULT_TTL,
  V2_PAIR_SESSION_MAX_TTL,
  V2_PAIR_SESSION_MIN_TTL,
  buildLoginMessage,
  buildPresenceStatus,
  clampInt,
  clientKey,
  copyPayload,
  createEmptyV2Snapshot,
  encodeText,
  jsonResponse,
  makeId,
  makeOpaqueToken,
  newError,
  normalizeDisplayName,
  nowMillis,
  parseIceServers,
  readJsonBody,
  requestBaseUrl,
  serializeSignalEvent,
  serializeSsePing,
  sseHeaders,
  trimRequired,
  verifyEd25519Signature,
  errorResponse,
} from './shared.js';

function sortByCreatedDesc(items) {
  return items.sort((left, right) => Number(right?.createdAt || 0) - Number(left?.createdAt || 0));
}

export class PairV2Hub {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.snapshot = null;
    this.loadPromise = null;
    this.subscribers = new Map();
  }

  async fetch(request) {
    try {
      return await this.handleRequest(request);
    } catch (error) {
      if (error?.code) {
        return errorResponse(error.code, error.message);
      }
      return errorResponse('INTERNAL_ERROR', error instanceof Error ? error.message : 'internal error', 500);
    }
  }

  async handleRequest(request) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method.toUpperCase();
    await this.loadSnapshot();

    if (method === 'GET' && path === '/internal/healthz') {
      const snapshot = await this.loadSnapshot();
      return jsonResponse({
        ok: true,
        provider: 'cloudflare-worker',
        runtime: 'durable-object',
        version: snapshot.version,
        stats: {
          desktops: Object.keys(snapshot.desktops).length,
          mobiles: Object.keys(snapshot.mobiles).length,
          challenges: Object.keys(snapshot.challenges).length,
          sessions: Object.keys(snapshot.authSessions).length,
          pairSessions: Object.keys(snapshot.pairSessions).length,
          bindings: Object.keys(snapshot.bindings).length,
        },
      });
    }

    if (!path.startsWith('/v2/')) {
      return errorResponse('NOT_FOUND', 'Route not found', 404);
    }

    if (method === 'POST' && path === '/v2/auth/challenge') {
      const req = await readJsonBody(request);
      const challenge = await this.createChallenge(req);
      return jsonResponse({ ok: true, challenge });
    }

    if (method === 'POST' && path === '/v2/auth/login') {
      const req = await readJsonBody(request);
      const session = await this.login(req);
      return jsonResponse({ ok: true, session });
    }

    if (method === 'GET' && path === '/v2/ice-servers') {
      this.authenticate(request);
      return jsonResponse({
        ok: true,
        iceServers: parseIceServers(this.env.V2_ICE_SERVERS_JSON),
        ttlSeconds: Math.max(60, Number(this.env.V2_ICE_TTL_SECONDS || 600) || 600),
      });
    }

    if (method === 'POST' && path === '/v2/presence/announce') {
      const principal = this.authenticate(request);
      const req = await readJsonBody(request);
      const desktop = await this.announceDesktop(principal, req);
      return jsonResponse({ ok: true, desktop });
    }

    if (method === 'POST' && path === '/v2/presence/heartbeat') {
      const principal = this.authenticate(request);
      const req = await readJsonBody(request);
      const desktop = await this.heartbeatDesktop(principal, req);
      return jsonResponse({ ok: true, desktop });
    }

    if (method === 'POST' && path === '/v2/presence/query') {
      const principal = this.authenticate(request);
      const req = await readJsonBody(request);
      const statuses = await this.queryPresence(principal, req);
      return jsonResponse({ ok: true, statuses });
    }

    if (method === 'POST' && path === '/v2/pair/sessions') {
      const principal = this.authenticate(request);
      const req = await readJsonBody(request);
      const session = await this.createPairSession(principal, req);
      return jsonResponse({
        ok: true,
        session,
        qrPayload: {
          version: 'openclaw-pair-v2',
          serverBaseUrl: requestBaseUrl(request),
          pairSessionId: session.pairSessionId,
          claimToken: session.claimToken,
          deviceId: session.deviceId,
          devicePubkey: session.devicePublicKey,
          sessionNonce: session.sessionNonce,
          expiresAt: session.expiresAt,
        },
      });
    }

    if (method === 'POST' && path === '/v2/pair/claims') {
      const principal = this.authenticate(request);
      const req = await readJsonBody(request);
      const { pairSession, binding } = await this.claimPair(principal, req);
      this.emitSignal('desktop', binding.deviceId, {
        id: makeId('v2_pair_claim'),
        type: 'pair.claimed',
        ts: nowMillis(),
        payload: {
          pairSessionId: pairSession.pairSessionId,
          bindingId: binding.bindingId,
          deviceId: binding.deviceId,
          devicePublicKey: binding.devicePublicKey,
          mobileId: binding.mobileId,
          mobileName: binding.mobileName,
          mobilePublicKey: binding.mobilePublicKey,
          trustState: binding.trustState,
          sessionNonce: pairSession.sessionNonce,
        },
      });
      return jsonResponse({ ok: true, pairSession, binding });
    }

    if (method === 'POST' && path === '/v2/pair/approvals') {
      const principal = this.authenticate(request);
      const req = await readJsonBody(request);
      const binding = await this.approveBinding(principal, req);
      this.emitSignal('mobile', binding.mobileId, {
        id: makeId('v2_pair_approved'),
        type: 'pair.approved',
        ts: nowMillis(),
        payload: {
          bindingId: binding.bindingId,
          deviceId: binding.deviceId,
          mobileId: binding.mobileId,
          mobileName: binding.mobileName,
          trustState: binding.trustState,
          approvedAt: binding.approvedAt,
        },
      });
      return jsonResponse({ ok: true, binding });
    }

    if (method === 'POST' && path === '/v2/pair/revoke') {
      const principal = this.authenticate(request);
      const req = await readJsonBody(request);
      const binding = await this.revokeBinding(principal, req);
      const event = {
        id: makeId('v2_pair_revoked'),
        type: 'pair.revoked',
        ts: nowMillis(),
        payload: {
          bindingId: binding.bindingId,
          deviceId: binding.deviceId,
          mobileId: binding.mobileId,
          mobileName: binding.mobileName,
          trustState: binding.trustState,
          revokedAt: binding.revokedAt,
        },
      };
      this.emitSignal('desktop', binding.deviceId, event);
      this.emitSignal('mobile', binding.mobileId, event);
      return jsonResponse({ ok: true, binding });
    }

    if (method === 'GET' && path === '/v2/bindings') {
      const principal = this.authenticate(request);
      const includeRevoked = url.searchParams.get('includeRevoked') === 'true';
      const bindings = await this.listBindings(principal, includeRevoked);
      return jsonResponse({ ok: true, bindings: sortByCreatedDesc(bindings) });
    }

    if (method === 'POST' && path === '/v2/signal/send') {
      const principal = this.authenticate(request);
      const req = await readJsonBody(request);
      await this.authorizeSignalSend(principal, req);
      const event = this.buildSignalEvent(req);
      const deliveredRealtime = this.emitSignal(event.to.type, event.to.id, event);
      return jsonResponse({ ok: true, deliveredRealtime, event });
    }

    if (method === 'GET' && path === '/v2/signal/stream') {
      const principal = this.authenticate(request);
      const clientType = trimRequired(url.searchParams.get('clientType'), 'clientType');
      const clientId = trimRequired(url.searchParams.get('clientId'), 'clientId');
      this.authorizeSignalClient(principal, clientType, clientId);
      return this.createSignalStream(clientType, clientId);
    }

    if (method === 'GET' && path === '/v2/signal/ws') {
      return errorResponse(
        'WS_NOT_ENABLED',
        'WebSocket endpoint is not enabled yet. Use /v2/signal/stream and /v2/signal/send during the first v2 stage.',
        501
      );
    }

    return errorResponse('NOT_FOUND', 'Route not found', 404);
  }

  async loadSnapshot() {
    if (this.snapshot) {
      this.pruneExpired(this.snapshot, nowMillis());
      return this.snapshot;
    }
    if (!this.loadPromise) {
      this.loadPromise = (async () => {
        const stored = await this.state.storage.get('v2-snapshot');
        this.snapshot = stored && typeof stored === 'object' ? stored : createEmptyV2Snapshot();
        this.pruneExpired(this.snapshot, nowMillis());
        return this.snapshot;
      })();
    }
    return await this.loadPromise;
  }

  async saveSnapshot() {
    if (!this.snapshot) {
      return;
    }
    await this.state.storage.put('v2-snapshot', this.snapshot);
  }

  pruneExpired(snapshot, now) {
    for (const [challengeId, challenge] of Object.entries(snapshot.challenges)) {
      if (Number(challenge.expiresAt || 0) <= now) {
        delete snapshot.challenges[challengeId];
      }
    }
    for (const [token, session] of Object.entries(snapshot.authSessions)) {
      if (Number(session.expiresAt || 0) <= now) {
        delete snapshot.authSessions[token];
      }
    }
    for (const [pairSessionId, session] of Object.entries(snapshot.pairSessions)) {
      if (Number(session.expiresAt || 0) <= now) {
        session.status = 'expired';
        session.updatedAt = now;
        delete snapshot.pairClaimTokenIndex[session.claimToken];
      }
      snapshot.pairSessions[pairSessionId] = session;
    }
  }

  authenticate(request) {
    const header = String(request.headers.get('authorization') || '').trim();
    const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : '';
    if (!token) {
      throw newError('UNAUTHORIZED', 'bearer token is required');
    }
    if (!this.snapshot) {
      throw newError('INTERNAL_ERROR', 'snapshot unavailable');
    }
    const session = this.snapshot.authSessions[token];
    if (!session) {
      throw newError('UNAUTHORIZED', 'invalid bearer token');
    }
    if (Number(session.expiresAt || 0) <= nowMillis()) {
      delete this.snapshot.authSessions[token];
      throw newError('UNAUTHORIZED', 'session expired');
    }
    return { session };
  }

  async createChallenge(req) {
    const snapshot = await this.loadSnapshot();
    const entityType = trimRequired(req.entityType, 'entityType');
    if (entityType !== 'desktop' && entityType !== 'mobile') {
      throw newError('VALIDATION_ERROR', 'entityType must be desktop or mobile');
    }
    const entityId = trimRequired(req.entityId, 'entityId');
    const publicKey = trimRequired(req.publicKey, 'publicKey');
    const now = nowMillis();
    const challenge = {
      challengeId: makeId('v2chal'),
      entityType,
      entityId,
      publicKey,
      nonce: makeOpaqueToken('nonce', 18),
      createdAt: now,
      expiresAt: now + V2_CHALLENGE_TTL_MS,
    };
    snapshot.challenges[challenge.challengeId] = challenge;
    await this.saveSnapshot();
    return challenge;
  }

  async login(req) {
    const snapshot = await this.loadSnapshot();
    const entityType = trimRequired(req.entityType, 'entityType');
    const entityId = trimRequired(req.entityId, 'entityId');
    const publicKey = trimRequired(req.publicKey, 'publicKey');
    const challengeId = trimRequired(req.challengeId, 'challengeId');
    const signature = trimRequired(req.signature, 'signature');
    const challenge = snapshot.challenges[challengeId];
    if (!challenge) {
      throw newError('NOT_FOUND', 'challenge not found');
    }
    if (challenge.entityType !== entityType || challenge.entityId !== entityId || challenge.publicKey !== publicKey) {
      throw newError('FORBIDDEN', 'challenge does not match login request');
    }
    if (Number(challenge.expiresAt || 0) <= nowMillis()) {
      delete snapshot.challenges[challengeId];
      throw newError('EXPIRED', 'challenge expired');
    }
    const verified = await verifyEd25519Signature(publicKey, buildLoginMessage(challenge), signature);
    if (!verified) {
      throw newError('FORBIDDEN', 'invalid signature');
    }

    const now = nowMillis();
    if (entityType === 'desktop') {
      const existing = snapshot.desktops[entityId];
      if (existing && existing.publicKey !== publicKey) {
        throw newError('FORBIDDEN', 'desktop id already exists with another public key');
      }
      snapshot.desktops[entityId] = existing
        ? { ...existing, updatedAt: now }
        : {
            deviceId: entityId,
            publicKey,
            platform: '',
            appVersion: '',
            capabilities: {},
            createdAt: now,
            updatedAt: now,
            lastSeenAt: 0,
            presenceState: 'offline',
          };
    } else {
      const existing = snapshot.mobiles[entityId];
      if (existing && existing.publicKey !== publicKey) {
        throw newError('FORBIDDEN', 'mobile id already exists with another public key');
      }
      snapshot.mobiles[entityId] = existing
        ? { ...existing, updatedAt: now }
        : {
            mobileId: entityId,
            mobileName: existing?.mobileName || '',
            publicKey,
            createdAt: now,
            updatedAt: now,
          };
    }

    delete snapshot.challenges[challengeId];
    const session = {
      sessionId: makeId('v2sess'),
      token: makeOpaqueToken('v2tok', 24),
      entityType,
      entityId,
      publicKey,
      createdAt: now,
      updatedAt: now,
      expiresAt: now + V2_AUTH_SESSION_TTL_MS,
    };
    snapshot.authSessions[session.token] = session;
    await this.saveSnapshot();
    return session;
  }

  async announceDesktop(principal, req) {
    if (principal.session.entityType !== 'desktop') {
      throw newError('FORBIDDEN', 'only desktop can announce presence');
    }
    const snapshot = await this.loadSnapshot();
    const desktop = snapshot.desktops[principal.session.entityId];
    if (!desktop) {
      throw newError('NOT_FOUND', 'desktop not found');
    }
    const now = nowMillis();
    const next = {
      ...desktop,
      platform: String(req.platform || '').trim(),
      appVersion: String(req.appVersion || '').trim(),
      capabilities: req.capabilities && typeof req.capabilities === 'object' && !Array.isArray(req.capabilities) ? { ...req.capabilities } : {},
      updatedAt: now,
      lastSeenAt: now,
      presenceState: 'online',
    };
    snapshot.desktops[desktop.deviceId] = next;
    await this.saveSnapshot();
    return next;
  }

  async heartbeatDesktop(principal, req) {
    if (principal.session.entityType !== 'desktop') {
      throw newError('FORBIDDEN', 'only desktop can heartbeat presence');
    }
    const snapshot = await this.loadSnapshot();
    const desktop = snapshot.desktops[principal.session.entityId];
    if (!desktop) {
      throw newError('NOT_FOUND', 'desktop not found');
    }
    const now = nowMillis();
    const next = {
      ...desktop,
      platform: String(req.platform || desktop.platform || '').trim(),
      appVersion: String(req.appVersion || desktop.appVersion || '').trim(),
      capabilities: req.capabilities && typeof req.capabilities === 'object' && !Array.isArray(req.capabilities) ? { ...req.capabilities } : desktop.capabilities || {},
      updatedAt: now,
      lastSeenAt: now,
      presenceState: 'online',
    };
    snapshot.desktops[desktop.deviceId] = next;
    await this.saveSnapshot();
    return next;
  }

  async queryPresence(principal, req) {
    const snapshot = await this.loadSnapshot();
    const deviceIds = Array.isArray(req.deviceIds) ? req.deviceIds.map((value) => String(value || '').trim()).filter(Boolean) : [];
    if (principal.session.entityType === 'desktop') {
      const desktop = snapshot.desktops[principal.session.entityId];
      if (!desktop) {
        throw newError('NOT_FOUND', 'desktop not found');
      }
      if (deviceIds.length > 0 && (deviceIds.length !== 1 || deviceIds[0] !== desktop.deviceId)) {
        throw newError('FORBIDDEN', 'desktop can only query itself');
      }
      return [buildPresenceStatus(desktop)];
    }
    if (principal.session.entityType !== 'mobile') {
      throw newError('UNAUTHORIZED', 'unauthorized principal');
    }
    const allowed = new Set();
    for (const binding of Object.values(snapshot.bindings)) {
      if (binding.mobileId === principal.session.entityId && binding.trustState === 'active') {
        allowed.add(binding.deviceId);
      }
    }
    const targets = deviceIds.length ? deviceIds : Array.from(allowed);
    for (const deviceId of targets) {
      if (!allowed.has(deviceId)) {
        throw newError('FORBIDDEN', 'mobile can only query bound desktops');
      }
    }
    return targets
      .map((deviceId) => snapshot.desktops[deviceId])
      .filter(Boolean)
      .map((desktop) => buildPresenceStatus(desktop));
  }

  async createPairSession(principal, req) {
    if (principal.session.entityType !== 'desktop') {
      throw newError('FORBIDDEN', 'only desktop can create pair sessions');
    }
    const snapshot = await this.loadSnapshot();
    const desktop = snapshot.desktops[principal.session.entityId];
    if (!desktop) {
      throw newError('NOT_FOUND', 'desktop not found');
    }
    const ttlSeconds = clampInt(req.ttlSeconds || V2_PAIR_SESSION_DEFAULT_TTL, V2_PAIR_SESSION_MIN_TTL, V2_PAIR_SESSION_MAX_TTL);
    const now = nowMillis();
    const pairSession = {
      pairSessionId: makeId('v2pair'),
      deviceId: desktop.deviceId,
      devicePublicKey: desktop.publicKey,
      claimToken: makeOpaqueToken('v2claim', 24),
      sessionNonce: makeOpaqueToken('v2nonce', 18),
      status: 'pending',
      createdAt: now,
      updatedAt: now,
      expiresAt: now + ttlSeconds * 1000,
      claimedMobileId: null,
      bindingId: null,
    };
    snapshot.pairSessions[pairSession.pairSessionId] = pairSession;
    snapshot.pairClaimTokenIndex[pairSession.claimToken] = pairSession.pairSessionId;
    await this.saveSnapshot();
    return pairSession;
  }

  findBinding(snapshot, deviceId, mobileId) {
    for (const binding of Object.values(snapshot.bindings)) {
      if (binding.deviceId === deviceId && binding.mobileId === mobileId && binding.trustState !== 'revoked') {
        return binding;
      }
    }
    return null;
  }

  async claimPair(principal, req) {
    if (principal.session.entityType !== 'mobile') {
      throw newError('FORBIDDEN', 'only mobile can claim pair sessions');
    }
    const snapshot = await this.loadSnapshot();
    const claimToken = trimRequired(req.claimToken, 'claimToken');
    const pairSessionId = snapshot.pairClaimTokenIndex[claimToken];
    if (!pairSessionId) {
      throw newError('NOT_FOUND', 'pair session not found');
    }
    const pairSession = snapshot.pairSessions[pairSessionId];
    if (!pairSession) {
      throw newError('NOT_FOUND', 'pair session not found');
    }
    const now = nowMillis();
    if (pairSession.expiresAt <= now) {
      pairSession.status = 'expired';
      pairSession.updatedAt = now;
      delete snapshot.pairClaimTokenIndex[claimToken];
      throw newError('EXPIRED', 'pair session expired');
    }
    if (!['pending', 'claimed'].includes(pairSession.status)) {
      throw newError('INVALID_STATE', 'pair session is not claimable');
    }
    if (pairSession.status === 'claimed' && pairSession.claimedMobileId && pairSession.claimedMobileId !== principal.session.entityId) {
      throw newError('ALREADY_CLAIMED', 'pair session already claimed by another mobile');
    }
    const mobile = snapshot.mobiles[principal.session.entityId];
    if (!mobile) {
      throw newError('NOT_FOUND', 'mobile not found');
    }
    const mobileName = normalizeDisplayName(req.mobileName);
    if (mobileName) {
      mobile.mobileName = mobileName;
      mobile.updatedAt = now;
    }
    const existingBinding = this.findBinding(snapshot, pairSession.deviceId, mobile.mobileId);
    if (existingBinding && existingBinding.trustState === 'active') {
      throw newError('INVALID_STATE', 'binding already active');
    }

    const binding = existingBinding && existingBinding.trustState === 'pending'
      ? {
          ...existingBinding,
          pairSessionId: pairSession.pairSessionId,
          devicePublicKey: pairSession.devicePublicKey,
          mobilePublicKey: mobile.publicKey,
          mobileName: mobile.mobileName || '',
          updatedAt: now,
        }
      : {
          bindingId: makeId('v2bind'),
          pairSessionId: pairSession.pairSessionId,
          deviceId: pairSession.deviceId,
          devicePublicKey: pairSession.devicePublicKey,
          mobileId: mobile.mobileId,
          mobileName: mobile.mobileName || '',
          mobilePublicKey: mobile.publicKey,
          trustState: 'pending',
          createdAt: now,
          updatedAt: now,
          approvedAt: null,
          revokedAt: null,
        };

    pairSession.status = 'claimed';
    pairSession.updatedAt = now;
    pairSession.claimedMobileId = mobile.mobileId;
    pairSession.bindingId = binding.bindingId;

    snapshot.mobiles[mobile.mobileId] = mobile;
    snapshot.bindings[binding.bindingId] = binding;
    snapshot.pairSessions[pairSession.pairSessionId] = pairSession;
    await this.saveSnapshot();
    return { pairSession, binding };
  }

  async approveBinding(principal, req) {
    if (principal.session.entityType !== 'desktop') {
      throw newError('FORBIDDEN', 'only desktop can approve bindings');
    }
    const snapshot = await this.loadSnapshot();
    const bindingId = trimRequired(req.bindingId, 'bindingId');
    const binding = snapshot.bindings[bindingId];
    if (!binding) {
      throw newError('NOT_FOUND', 'binding not found');
    }
    if (binding.deviceId !== principal.session.entityId) {
      throw newError('FORBIDDEN', 'desktop cannot approve another device binding');
    }
    if (binding.trustState !== 'pending') {
      throw newError('INVALID_STATE', 'binding is not pending');
    }
    const approvedAt = nowMillis();
    binding.trustState = 'active';
    binding.approvedAt = approvedAt;
    binding.updatedAt = approvedAt;
    snapshot.bindings[bindingId] = binding;
    const pairSession = snapshot.pairSessions[binding.pairSessionId];
    if (pairSession) {
      pairSession.status = 'approved';
      pairSession.updatedAt = approvedAt;
      snapshot.pairSessions[pairSession.pairSessionId] = pairSession;
      delete snapshot.pairClaimTokenIndex[pairSession.claimToken];
    }
    await this.saveSnapshot();
    return binding;
  }

  async revokeBinding(principal, req) {
    const snapshot = await this.loadSnapshot();
    const bindingId = trimRequired(req.bindingId, 'bindingId');
    const binding = snapshot.bindings[bindingId];
    if (!binding) {
      throw newError('NOT_FOUND', 'binding not found');
    }
    if (principal.session.entityType === 'desktop') {
      if (binding.deviceId !== principal.session.entityId) {
        throw newError('FORBIDDEN', 'desktop cannot revoke another device binding');
      }
    } else if (principal.session.entityType === 'mobile') {
      if (binding.mobileId !== principal.session.entityId) {
        throw newError('FORBIDDEN', 'mobile cannot revoke another mobile binding');
      }
    } else {
      throw newError('UNAUTHORIZED', 'unauthorized principal');
    }
    const revokedAt = nowMillis();
    binding.trustState = 'revoked';
    binding.revokedAt = revokedAt;
    binding.updatedAt = revokedAt;
    snapshot.bindings[bindingId] = binding;
    await this.saveSnapshot();
    return binding;
  }

  async listBindings(principal, includeRevoked) {
    const snapshot = await this.loadSnapshot();
    const result = [];
    for (const binding of Object.values(snapshot.bindings)) {
      if (!includeRevoked && binding.trustState === 'revoked') {
        continue;
      }
      if (principal.session.entityType === 'desktop' && binding.deviceId === principal.session.entityId) {
        result.push(binding);
      }
      if (principal.session.entityType === 'mobile' && binding.mobileId === principal.session.entityId) {
        result.push(binding);
      }
    }
    return result;
  }

  authorizeSignalClient(principal, clientType, clientId) {
    const normalizedType = trimRequired(clientType, 'clientType');
    const normalizedId = trimRequired(clientId, 'clientId');
    if (principal.session.entityType === 'desktop') {
      if (normalizedType !== 'desktop' || normalizedId !== principal.session.entityId) {
        throw newError('FORBIDDEN', 'desktop can only subscribe as itself');
      }
      return;
    }
    if (principal.session.entityType === 'mobile') {
      if (normalizedType !== 'mobile' || normalizedId !== principal.session.entityId) {
        throw newError('FORBIDDEN', 'mobile can only subscribe as itself');
      }
      return;
    }
    throw newError('UNAUTHORIZED', 'unauthorized client');
  }

  hasActiveBinding(snapshot, deviceId, mobileId) {
    return Object.values(snapshot.bindings).some(
      (binding) => binding.deviceId === deviceId && binding.mobileId === mobileId && binding.trustState === 'active'
    );
  }

  async authorizeSignalSend(principal, req) {
    const snapshot = await this.loadSnapshot();
    const fromType = trimRequired(req.fromType, 'fromType');
    const fromId = trimRequired(req.fromId, 'fromId');
    const toType = trimRequired(req.toType, 'toType');
    const toId = trimRequired(req.toId, 'toId');
    if (principal.session.entityType === 'desktop') {
      if (fromType !== 'desktop' || fromId !== principal.session.entityId) {
        throw newError('FORBIDDEN', 'desktop can only send as itself');
      }
      if (toType !== 'mobile') {
        throw newError('FORBIDDEN', 'desktop can only send to mobile');
      }
      if (!this.hasActiveBinding(snapshot, principal.session.entityId, toId)) {
        throw newError('FORBIDDEN', 'target mobile is not actively bound to this desktop');
      }
      return;
    }
    if (principal.session.entityType === 'mobile') {
      if (fromType !== 'mobile' || fromId !== principal.session.entityId) {
        throw newError('FORBIDDEN', 'mobile can only send as itself');
      }
      if (toType !== 'desktop') {
        throw newError('FORBIDDEN', 'mobile can only send to desktop');
      }
      if (!this.hasActiveBinding(snapshot, toId, principal.session.entityId)) {
        throw newError('FORBIDDEN', 'target desktop is not actively bound to this mobile');
      }
      return;
    }
    throw newError('UNAUTHORIZED', 'unauthorized sender');
  }

  buildSignalEvent(req) {
    return {
      id: makeId('v2evt'),
      type: trimRequired(req.type, 'type'),
      ts: nowMillis(),
      from: {
        type: trimRequired(req.fromType, 'fromType'),
        id: trimRequired(req.fromId, 'fromId'),
      },
      to: {
        type: trimRequired(req.toType, 'toType'),
        id: trimRequired(req.toId, 'toId'),
      },
      payload: copyPayload(req.payload),
    };
  }

  pullSignalInbox(snapshot, clientType, clientId, limit = MAX_SIGNAL_QUEUE_PULL) {
    const key = clientKey(clientType, clientId);
    const queue = Array.isArray(snapshot.signalQueues[key]) ? snapshot.signalQueues[key] : [];
    if (!queue.length) {
      return [];
    }
    const safeLimit = Math.max(1, Math.min(MAX_SIGNAL_QUEUE_PULL, Number(limit || MAX_SIGNAL_QUEUE_PULL)));
    const items = queue.slice(0, safeLimit);
    const rest = queue.slice(safeLimit);
    if (rest.length) {
      snapshot.signalQueues[key] = rest;
    } else {
      delete snapshot.signalQueues[key];
    }
    return items;
  }

  emitSignal(targetType, targetId, event) {
    if (!this.snapshot) {
      return false;
    }
    const key = clientKey(targetType, targetId);
    const subs = this.subscribers.get(key);
    let delivered = false;
    if (subs && subs.size > 0) {
      for (const sub of [...subs]) {
        try {
          sub.controller.enqueue(encodeText(serializeSignalEvent(event)));
          delivered = true;
        } catch {
          this.disposeSubscriber(key, sub);
        }
      }
    }
    const queue = Array.isArray(this.snapshot.signalQueues[key]) ? this.snapshot.signalQueues[key] : [];
    queue.push({ ...event, payload: copyPayload(event.payload) });
    this.snapshot.signalQueues[key] = queue;
    void this.saveSnapshot();
    return delivered;
  }

  disposeSubscriber(key, sub) {
    if (sub.timer) {
      clearInterval(sub.timer);
    }
    const set = this.subscribers.get(key);
    if (!set) {
      return;
    }
    set.delete(sub);
    if (!set.size) {
      this.subscribers.delete(key);
    }
    try {
      sub.controller.close();
    } catch {
      // no-op
    }
  }

  createSignalStream(clientType, clientId) {
    const key = clientKey(clientType, clientId);
    const snapshot = this.snapshot;
    const queued = this.pullSignalInbox(snapshot, clientType, clientId, MAX_SIGNAL_QUEUE_PULL);
    void this.saveSnapshot();
    let currentSub = null;

    const stream = new ReadableStream({
      start: (controller) => {
        const sub = {
          controller,
          timer: null,
        };
        currentSub = sub;
        const set = this.subscribers.get(key) || new Set();
        set.add(sub);
        this.subscribers.set(key, set);

        controller.enqueue(
          encodeText(
            serializeSignalEvent({
              id: makeId('v2stream'),
              type: 'stream.opened',
              ts: nowMillis(),
              payload: {
                clientType,
                clientId,
              },
            })
          )
        );

        for (const event of queued) {
          controller.enqueue(encodeText(serializeSignalEvent(event)));
        }

        sub.timer = setInterval(() => {
          try {
            controller.enqueue(encodeText(serializeSsePing(nowMillis())));
          } catch {
            this.disposeSubscriber(key, sub);
          }
        }, 20_000);
      },
      cancel: () => {
        if (currentSub) {
          this.disposeSubscriber(key, currentSub);
        }
      },
    });

    return new Response(stream, {
      status: 200,
      headers: sseHeaders(),
    });
  }
}
