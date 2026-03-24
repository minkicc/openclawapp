// @ts-nocheck
import { invoke as defaultInvoke } from '@tauri-apps/api/tauri';
import QRCode from 'qrcode';
import {
  announcePairV2Desktop,
  approvePairV2Binding,
  computePairV2SafetyCode,
  createPairV2AppRegistry,
  createPairV2Session,
  getPairV2ICEServers,
  getOrCreatePairV2Identity,
  heartbeatPairV2Desktop,
  listPairV2Bindings,
  loginPairV2Entity,
  normalizePairV2IceServers,
  openPairV2SignalStream,
  PairV2PeerChannel,
  revokePairV2Binding,
  sendPairV2Signal
} from '@openclaw/pair-sdk';
import {
  buildOpenClawPairChatPayload,
  createOpenClawPairChatModule,
  openClawPairChatMessageType,
  supportsOpenClawPairChat
} from '@openclaw/message-sdk';
import { useDesktopShellStore } from '../store/useDesktopShellStore';

export function createPairController(deps) {
  const {
    pairChannelToggleBtn,
    pairCreateChannelBtn,
    pairReloadConfigBtn,
    pairStatusMessage,
    pairWsStatus,
    pairQrDialog,
    pairChatDraftInput,
    pairChatSendBtn,
    pairChatCloseBtn,
    pairChatDialog,
    pairQrCloseBtn,
    pairQrImage,
    pairEventLog,
    t,
    pairChannels,
    getActiveChatChannelId,
    setActiveChatChannelId,
    findPairChannelById,
    findPairChannelByMobileId,
    upsertPairChannel,
    renderPairChannelCards,
    closeDialogSafe,
    openDialogSafe,
    renderPairChatMessages,
    removePairChannelLocal,
    appendPairChannelMessage,
    invoke = defaultInvoke
  } = deps;

  let rawConfig = null;
  let pairWs = null;
  let pairChannelMode = 'none';
  let pairDesiredConnected = false;
  let pairReconnectTimer = null;
  let pairReconnectAttempts = 0;
  let pairLanIpv4Promise = null;
  let pairPresenceTimer = null;
  let pairIdentity = null;
  let pairAuthSession = null;
  let pairAuthBaseUrl = '';
  let pairChannelOpen = false;
  let pairConfiguredServerUrl = '';
  let pairConfiguredDeviceId = '';
  const pairPeers = new Map();
  const pairIceCache = new Map();
  const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1']);

  function isPairCenterAvailable() {
    return Boolean(
      pairChannelToggleBtn &&
      pairCreateChannelBtn &&
      pairReloadConfigBtn &&
      pairStatusMessage &&
      pairWsStatus &&
      pairQrDialog &&
      pairChatDraftInput &&
      pairChatSendBtn &&
      pairChatCloseBtn &&
      pairChatDialog &&
      pairQrCloseBtn &&
      pairEventLog
    );
  }

  function hasPairConfig() {
    return Boolean(pairConfiguredServerUrl && pairConfiguredDeviceId);
  }

  function setPairMessage(message, type = '') {
    useDesktopShellStore.getState().setPairState({
      statusMessage: message || '',
      statusType: type || ''
    });
    if (!pairStatusMessage) {
      return;
    }
    pairStatusMessage.textContent = message || '';
    pairStatusMessage.className = `message ${type}`.trim();
  }

  function appendPairEvent(line) {
    const now = new Date();
    const stamp = `${now.toLocaleDateString()} ${now.toLocaleTimeString()}`;
    const next = `[${stamp}] ${line}`;
    const currentLog = useDesktopShellStore.getState().pair.eventLog || '';
    const mergedLog = currentLog ? `${currentLog}\n${next}` : next;
    useDesktopShellStore.getState().setPairState({
      eventLog: mergedLog
    });
    if (!pairEventLog) {
      return;
    }
    pairEventLog.textContent = mergedLog;
    pairEventLog.scrollTop = pairEventLog.scrollHeight;
  }

  function renderPairWsStatus(status) {
    if (!pairWsStatus) {
      let key = 'pair.status.disconnected';
      if (status === 'connecting') {
        key = 'pair.status.connecting';
      } else if (status === 'connected') {
        key = 'pair.status.connected';
      } else if (status === 'reconnecting') {
        key = 'pair.status.reconnecting';
      }
      useDesktopShellStore.getState().setPairState({
        wsStatus: t(key)
      });
      return;
    }

    let key = 'pair.status.disconnected';
    if (status === 'connecting') {
      key = 'pair.status.connecting';
    } else if (status === 'connected') {
      key = 'pair.status.connected';
    } else if (status === 'reconnecting') {
      key = 'pair.status.reconnecting';
    }
    const nextText = t(key);
    useDesktopShellStore.getState().setPairState({
      wsStatus: nextText
    });
    pairWsStatus.textContent = nextText;
  }

  function clearPairQrPreview() {
    useDesktopShellStore.getState().setPairState({
      qrImageSrc: '',
      qrDialogOpen: false
    });
    if (!pairQrImage) {
      return;
    }
    pairQrImage.removeAttribute('src');
    pairQrImage.classList.add('hidden');
  }

  async function renderPairQrPreview(payload) {
    if (!pairQrImage) {
      return;
    }
    if (!payload || typeof payload !== 'object') {
      clearPairQrPreview();
      return;
    }

    try {
      const content = JSON.stringify(payload);
      const svg = await QRCode.toString(content, {
        type: 'svg',
        width: 220,
        margin: 1
      });
      const dataUrl = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
      useDesktopShellStore.getState().setPairState({
        qrImageSrc: dataUrl
      });
      pairQrImage.src = dataUrl;
      pairQrImage.classList.remove('hidden');
    } catch (error) {
      try {
        const content = JSON.stringify(payload);
        const fallback = await QRCode.toDataURL(content, {
          width: 220,
          margin: 1
        });
        useDesktopShellStore.getState().setPairState({
          qrImageSrc: fallback
        });
        pairQrImage.src = fallback;
        pairQrImage.classList.remove('hidden');
      } catch (fallbackError) {
        clearPairQrPreview();
        appendPairEvent(`render qr failed: ${fallbackError?.message || String(fallbackError)}`);
        setPairMessage(`二维码渲染失败：${fallbackError?.message || String(fallbackError)}`, 'error');
      }
    }
  }

  async function openPairQrDialogForChannel(channel) {
    if (!channel) {
      setPairMessage(t('msg.pairCreateFailed', { message: 'channel not found' }), 'error');
      return;
    }
    const payload = channel.qrPayload && typeof channel.qrPayload === 'object' ? channel.qrPayload : {};
    await renderPairQrPreview(payload);
    useDesktopShellStore.getState().setPairState({
      qrDialogOpen: true
    });
    openDialogSafe(pairQrDialog);
  }

  async function openPairQrDialog(channelId) {
    const channel = findPairChannelById(channelId);
    await openPairQrDialogForChannel(channel);
  }

  function normalizePairBaseUrl(raw) {
    const text = String(raw || '').trim();
    if (!text) {
      return '';
    }
    const withProtocol = text.includes('://') ? text : `http://${text}`;
    try {
      const parsed = new URL(withProtocol);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return '';
      }
      parsed.hash = '';
      parsed.search = '';
      parsed.pathname = parsed.pathname.replace(/\/+$/, '');
      return parsed.toString().replace(/\/+$/, '');
    } catch {
      return '';
    }
  }

  function isLoopbackPairHost(hostname) {
    const host = String(hostname || '').trim().toLowerCase();
    if (!host) {
      return true;
    }
    return LOOPBACK_HOSTS.has(host);
  }

  function isLoopbackPairBaseUrl(raw) {
    const normalized = normalizePairBaseUrl(raw);
    if (!normalized) {
      return false;
    }
    try {
      const parsed = new URL(normalized);
      return isLoopbackPairHost(parsed.hostname);
    } catch {
      return false;
    }
  }

  function isIpv4Address(raw) {
    const text = String(raw || '').trim();
    if (!text) {
      return false;
    }
    const parts = text.split('.');
    if (parts.length !== 4) {
      return false;
    }
    return parts.every((part) => {
      if (!/^\d+$/.test(part)) {
        return false;
      }
      const value = Number(part);
      return Number.isInteger(value) && value >= 0 && value <= 255;
    });
  }

  function withHost(baseUrl, hostname) {
    const normalized = normalizePairBaseUrl(baseUrl);
    if (!normalized) {
      return '';
    }
    try {
      const parsed = new URL(normalized);
      parsed.hostname = hostname;
      return parsed.toString().replace(/\/+$/, '');
    } catch {
      return '';
    }
  }

  async function detectPrimaryLanIpv4() {
    if (!pairLanIpv4Promise) {
      pairLanIpv4Promise = invoke('get_primary_lan_ipv4')
        .then((value) => {
          const ip = String(value || '').trim();
          return isIpv4Address(ip) ? ip : '';
        })
        .catch(() => '');
    }
    return pairLanIpv4Promise;
  }

  async function resolvePairQrBaseUrl({ configuredBaseUrl, payloadBaseUrl }) {
    const normalizedConfigured = normalizePairBaseUrl(configuredBaseUrl);
    if (normalizedConfigured && !isLoopbackPairBaseUrl(normalizedConfigured)) {
      return normalizedConfigured;
    }

    const normalizedPayload = normalizePairBaseUrl(payloadBaseUrl);
    if (normalizedPayload && !isLoopbackPairBaseUrl(normalizedPayload)) {
      return normalizedPayload;
    }

    const lanIpv4 = await detectPrimaryLanIpv4();
    if (lanIpv4) {
      const template = normalizedConfigured || normalizedPayload || 'http://127.0.0.1:38089';
      const resolved = withHost(template, lanIpv4);
      if (resolved) {
        return resolved;
      }
    }

    return normalizedPayload || normalizedConfigured || '';
  }

  async function sanitizePairQrPayload(rawPayload, configuredBaseUrl) {
    const payload = rawPayload && typeof rawPayload === 'object' ? { ...rawPayload } : {};
    const payloadBaseUrl = String(payload.serverBaseUrl || payload.server_base_url || payload.baseUrl || payload.base_url || '').trim();
    const resolvedBaseUrl = await resolvePairQrBaseUrl({
      configuredBaseUrl,
      payloadBaseUrl
    });

    if (!resolvedBaseUrl) {
      return payload;
    }

    payload.serverBaseUrl = resolvedBaseUrl;
    payload.server_base_url = resolvedBaseUrl;
    payload.baseUrl = resolvedBaseUrl;
    payload.base_url = resolvedBaseUrl;
    if (payloadBaseUrl && normalizePairBaseUrl(payloadBaseUrl) !== resolvedBaseUrl) {
      appendPairEvent(`qr serverBaseUrl rewritten: ${payloadBaseUrl} -> ${resolvedBaseUrl}`);
    }

    return payload;
  }

  function getPairServerBaseUrl() {
    const raw = String(pairConfiguredServerUrl || '').trim();
    if (!raw || !normalizePairBaseUrl(raw)) {
      throw new Error(t('msg.pairMissingConfig'));
    }
    return normalizePairBaseUrl(raw);
  }

  function getPairDeviceId() {
    const raw = String(pairConfiguredDeviceId || '').trim();
    if (!raw) {
      throw new Error(t('msg.pairMissingConfig'));
    }
    return raw;
  }

  function getPairServerToken() {
    return String(pairAuthSession?.token || '').trim();
  }

  function buildPairStreamUrl(baseUrl, deviceId, token = '') {
    const parsed = new URL(baseUrl);
    parsed.pathname = '/v2/signal/stream';
    parsed.search = `clientType=desktop&clientId=${encodeURIComponent(deviceId)}`;
    const authToken = String(token || getPairServerToken()).trim();
    if (authToken) {
      parsed.search += `&token=${encodeURIComponent(authToken)}`;
    }
    parsed.hash = '';
    return parsed.toString();
  }

  function buildPairCapabilities() {
    return {
      signaling: ['sse'],
      pairing: ['qr', 'safety-code'],
      chat: true
    };
  }

  function createPairAppRegistry(channel, trustedPeerId) {
    return createPairV2AppRegistry([
      createOpenClawPairChatModule({
        onChatMessage: (chat) => {
          appendPairChannelMessage(channel.channelId, {
            from: 'mobile',
            text: chat.text,
            ts: chat.ts
          });
          appendPairEvent(`peer chat from ${trustedPeerId}: ${chat.text}`);
          renderPairChannelCards();
        }
      })
    ]);
  }

  function pairPlatformName() {
    return (
      navigator.userAgentData?.platform ||
      navigator.platform ||
      rawConfig?.platform ||
      rawConfig?.platformName ||
      'desktop'
    );
  }

  function pairAppVersion() {
    return String(rawConfig?.appVersion || rawConfig?.version || 'desktop-shell').trim() || 'desktop-shell';
  }

  function buildPairPresencePayload() {
    return {
      platform: pairPlatformName(),
      appVersion: pairAppVersion(),
      capabilities: buildPairCapabilities()
    };
  }

  function defaultPairIceServers() {
    return [
      {
        urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302']
      }
    ];
  }

  function channelSupportsOpenClawChat(channel) {
    return supportsOpenClawPairChat(channel?.peerCapabilities);
  }

  function configuredPairIceServers() {
    const raw =
      rawConfig?.channelIceServers ??
      rawConfig?.pairIceServers ??
      rawConfig?.webrtcIceServers ??
      defaultPairIceServers();
    return normalizePairV2IceServers(raw, defaultPairIceServers());
  }

  async function resolvePairIceServers(baseUrl, token, forceRefresh = false) {
    const normalizedBaseUrl = normalizePairBaseUrl(baseUrl);
    const fallback = configuredPairIceServers();
    if (!normalizedBaseUrl || !token) {
      return fallback;
    }

    const cached = pairIceCache.get(normalizedBaseUrl);
    if (!forceRefresh && cached && Number(cached.expiresAt || 0) > Date.now() + 5000) {
      return cached.iceServers;
    }

    try {
      const result = await getPairV2ICEServers(normalizedBaseUrl, token);
      const iceServers = normalizePairV2IceServers(result?.iceServers, fallback);
      pairIceCache.set(normalizedBaseUrl, {
        iceServers,
        expiresAt: Date.now() + Math.max(60, Number(result?.ttlSeconds || 0) || 600) * 1000
      });
      return iceServers;
    } catch (error) {
      appendPairEvent(`resolve ice servers failed, fallback to local config: ${error?.message || String(error)}`);
      pairIceCache.set(normalizedBaseUrl, {
        iceServers: fallback,
        expiresAt: Date.now() + 60_000
      });
      return fallback;
    }
  }

  function getPairPeerKey(channel) {
    return String(channel?.bindingId || '').trim();
  }

  function updateChannelPeerState(channel, state, detail = '') {
    if (!channel) {
      return;
    }
    channel.peerState = state;
    channel.peerDetail = detail;
    renderPairChannelCards();
    updatePairButtons();
  }

  function closePairPeerByKey(peerKey, detail = 'peer closed') {
    const key = String(peerKey || '').trim();
    if (!key) {
      return;
    }
    const peer = pairPeers.get(key);
    if (!peer) {
      return;
    }
    pairPeers.delete(key);
    try {
      peer.close();
    } catch {
      // ignore
    }
    const channel = findPairChannelByBindingId(key);
    if (channel) {
      updateChannelPeerState(channel, 'disconnected', detail);
    }
  }

  function closeAllPairPeers(detail = 'all peers closed') {
    for (const key of [...pairPeers.keys()]) {
      closePairPeerByKey(key, detail);
    }
  }

  function clearPairAuthState() {
    pairAuthSession = null;
    pairAuthBaseUrl = '';
    pairIceCache.clear();
  }

  function stopPairPresenceLoop() {
    if (pairPresenceTimer) {
      clearInterval(pairPresenceTimer);
      pairPresenceTimer = null;
    }
  }

  async function ensurePairAuthSession(forceRefresh = false) {
    const baseUrl = getPairServerBaseUrl();
    const deviceId = getPairDeviceId();
    if (!forceRefresh && pairAuthSession?.token && pairAuthBaseUrl === baseUrl) {
      return {
        baseUrl,
        deviceId,
        identity: pairIdentity,
        session: pairAuthSession
      };
    }
    pairIdentity = await getOrCreatePairV2Identity('desktop', deviceId);
    const { identity, session } = await loginPairV2Entity(baseUrl, 'desktop', deviceId);
    pairIdentity = identity;
    pairAuthSession = session;
    pairAuthBaseUrl = baseUrl;
    appendPairEvent(`v2 auth ready: device=${deviceId}`);
    return {
      baseUrl,
      deviceId,
      identity,
      session
    };
  }

  async function announcePairPresence(forceRefresh = false) {
    const { baseUrl, deviceId, session, identity } = await ensurePairAuthSession(forceRefresh);
    await announcePairV2Desktop(baseUrl, session.token, buildPairPresencePayload());
    return {
      baseUrl,
      deviceId,
      identity,
      session
    };
  }

  function startPairPresenceLoop() {
    stopPairPresenceLoop();
    pairPresenceTimer = setInterval(async () => {
      if (!pairDesiredConnected || !pairChannelOpen) {
        return;
      }
      try {
        const { baseUrl, session } = await ensurePairAuthSession();
        await heartbeatPairV2Desktop(baseUrl, session.token, buildPairPresencePayload());
      } catch (error) {
        stopPairPresenceLoop();
        clearPairAuthState();
        appendPairEvent(`presence heartbeat failed: ${error?.message || String(error)}`);
        renderPairWsStatus('disconnected');
        updateAllChannelsStatus('offline');
        renderPairChannelCards();
        updatePairButtons();
        cleanupPairWebSocket();
        if (pairDesiredConnected) {
          schedulePairReconnect();
        }
      }
    }, 30_000);
  }

  function isPairChannelOpen() {
    if (!pairWs) {
      return false;
    }
    if (pairChannelMode === 'ws') {
      return pairWs.readyState === WebSocket.OPEN;
    }
    if (pairChannelMode === 'sse') {
      return pairWs.readyState === EventSource.OPEN;
    }
    return false;
  }

  function isPairChannelConnecting() {
    if (!pairWs) {
      return false;
    }
    if (pairChannelMode === 'ws') {
      return pairWs.readyState === WebSocket.CONNECTING;
    }
    if (pairChannelMode === 'sse') {
      return pairWs.readyState === EventSource.CONNECTING;
    }
    return false;
  }

  function updatePairButtons() {
    if (!isPairCenterAvailable()) {
      return;
    }
    const connected = isPairChannelOpen();
    const connecting = isPairChannelConnecting();
    const activeChatChannel = findPairChannelById(getActiveChatChannelId());
    const storeDraft = useDesktopShellStore.getState().pair.chatDraft;
    const hasDraft = String(storeDraft || pairChatDraftInput?.value || '').trim().length > 0;
    const createUnavailable = !hasPairConfig() || !pairChannelOpen || connecting;
    useDesktopShellStore.getState().setPairState({
      channelOpen: pairChannelOpen,
      channelToggleDisabled: connecting,
      createChannelDisabled: connecting,
      createChannelAriaDisabled: createUnavailable,
      chatSendDisabled:
        !hasPairConfig() ||
        !pairChannelOpen ||
        !connected ||
        !activeChatChannel ||
        !activeChatChannel.mobileId ||
        activeChatChannel.peerState !== 'connected' ||
        !channelSupportsOpenClawChat(activeChatChannel) ||
        !hasDraft
    });

    pairChannelToggleBtn.classList.add('pair-toggle');
    pairChannelToggleBtn.classList.toggle('is-on', pairChannelOpen);
    pairChannelToggleBtn.classList.toggle('is-off', !pairChannelOpen);
    pairChannelToggleBtn.setAttribute('aria-pressed', pairChannelOpen ? 'true' : 'false');
    pairChannelToggleBtn.textContent = pairChannelOpen ? t('pair.toggle.on') : t('pair.toggle.off');
    pairChannelToggleBtn.disabled = connecting;

    pairCreateChannelBtn.disabled = connecting;
    pairCreateChannelBtn.classList.toggle('is-disabled', createUnavailable);
    pairCreateChannelBtn.setAttribute('aria-disabled', createUnavailable ? 'true' : 'false');

    pairChatSendBtn.disabled =
      !hasPairConfig() ||
      !pairChannelOpen ||
      !connected ||
      !activeChatChannel ||
      !activeChatChannel.mobileId ||
      activeChatChannel.peerState !== 'connected' ||
      !channelSupportsOpenClawChat(activeChatChannel) ||
      !hasDraft;
  }

  function resetPairReconnectTimer() {
    if (pairReconnectTimer) {
      clearTimeout(pairReconnectTimer);
      pairReconnectTimer = null;
    }
  }

  function cleanupPairWebSocket() {
    if (!pairWs) {
      pairChannelMode = 'none';
      return;
    }
    pairWs.onopen = null;
    pairWs.onmessage = null;
    pairWs.onerror = null;
    pairWs.onclose = null;
    try {
      pairWs.close();
    } catch {
      // no-op
    }
    pairWs = null;
    pairChannelMode = 'none';
  }

  function schedulePairReconnect() {
    if (!pairDesiredConnected) {
      return;
    }
    resetPairReconnectTimer();
    pairReconnectAttempts += 1;
    const waitMs = Math.min(15_000, 1000 * Math.pow(2, Math.min(pairReconnectAttempts, 4)));
    const waitSec = Math.ceil(waitMs / 1000);
    setPairMessage(t('msg.pairReconnect', { seconds: waitSec, attempt: pairReconnectAttempts }), 'error');
    renderPairWsStatus('reconnecting');
    appendPairEvent(`ws reconnect scheduled in ${waitSec}s (attempt ${pairReconnectAttempts})`);

    pairReconnectTimer = setTimeout(() => {
      connectPairChannel({ fromReconnect: true }).catch(() => {
        // handled inside connectPairChannel
      });
    }, waitMs);
  }

  function ensureChannelForMobile(mobileId) {
    const normalizedMobileId = String(mobileId || '').trim();
    if (!normalizedMobileId) {
      return null;
    }
    const existing = findPairChannelByMobileId(normalizedMobileId);
    if (existing) {
      return existing;
    }
    const pending = findFirstPendingChannel();
    if (pending) {
      pending.mobileId = normalizedMobileId;
      pending.status = 'active';
      return pending;
    }
    return upsertPairChannel({
      channelId: `ch_${normalizedMobileId}`,
      sessionId: '',
      mobileId: normalizedMobileId,
      status: 'active',
      createdAt: Date.now(),
      qrPayload: null
    });
  }

  function findFirstPendingChannel() {
    return pairChannels.find((item) => item?.status === 'pending') || null;
  }

  function findPairChannelByBindingId(bindingId) {
    const target = String(bindingId || '').trim();
    if (!target) {
      return null;
    }
    return pairChannels.find((item) => String(item?.bindingId || '').trim() === target) || null;
  }

  async function syncBindingsFromServer() {
    const { baseUrl, session } = await ensurePairAuthSession();
    const result = await listPairV2Bindings(baseUrl, session.token, false);
    const activeBindings = Array.isArray(result?.bindings)
      ? result.bindings.filter((item) => String(item?.trustState || '').trim() === 'active')
      : [];

    for (const binding of activeBindings) {
      const existing =
        findPairChannelByBindingId(binding.bindingId) ||
        findPairChannelByMobileId(binding.mobileId) ||
        findPairChannelById(binding.pairSessionId) ||
        null;
      const channel = existing || upsertPairChannel({
        channelId: binding.bindingId || binding.pairSessionId || `ch_${binding.mobileId}`,
        createdAt: Number(binding.createdAt || Date.now()),
        messages: []
      });
      if (!channel) {
        continue;
      }
      channel.sessionId = String(binding.pairSessionId || channel.sessionId || channel.channelId);
      channel.bindingId = String(binding.bindingId || channel.bindingId || '');
      channel.mobileId = String(binding.mobileId || channel.mobileId || '');
      channel.status = pairChannelOpen ? 'active' : 'offline';
      channel.devicePublicKey = String(binding.devicePublicKey || channel.devicePublicKey || '');
      channel.mobilePublicKey = String(binding.mobilePublicKey || channel.mobilePublicKey || '');
      channel.trustState = String(binding.trustState || channel.trustState || 'active');
      channel.approvedAt = Number(binding.approvedAt || channel.approvedAt || 0);
      channel.peerState = channel.peerState || 'idle';
      channel.qrPayload = channel.qrPayload || null;
    }

    renderPairChannelCards();
  }

  async function ensurePairPeer(channel) {
    const peerKey = getPairPeerKey(channel);
    if (!peerKey) {
      throw new Error('bindingId missing for peer channel');
    }
    const existing = pairPeers.get(peerKey);
    if (existing) {
      return existing;
    }
    const ready = await ensurePairAuthSession();
    const trustedPeerId = String(channel?.mobileId || '').trim();
    const trustedPeerPublicKey = String(channel?.mobilePublicKey || '').trim();
    if (!trustedPeerId || !trustedPeerPublicKey) {
      throw new Error('mobile trust metadata is missing');
    }
    const appRegistry = createPairAppRegistry(channel, trustedPeerId);
    const peer = new PairV2PeerChannel({
      role: 'desktop',
      selfId: ready.deviceId,
      selfPublicKey: ready.identity?.publicKey || '',
      selfPrivateKey: ready.identity?.privateKey || '',
      trustedPeerId,
      trustedPeerPublicKey,
      bindingId: peerKey,
      iceServers: await resolvePairIceServers(ready.baseUrl, ready.session.token),
      capabilities: appRegistry.buildCapabilities({
        protocolVersion: 'openclaw-pair-v2',
        appId: 'openclaw',
        appVersion: pairAppVersion()
      }),
      onSignal: async (type, payload) => {
        await sendPairSignal({
          toType: 'mobile',
          toId: trustedPeerId,
          type,
          payload
        });
      },
      onStateChange: (state, detail) => {
        updateChannelPeerState(channel, state, detail || '');
        appendPairEvent(`peer ${state}: binding=${peerKey} mobile=${trustedPeerId}${detail ? ` (${detail})` : ''}`);
      },
      onCapabilities: (capabilities) => {
        channel.peerCapabilities = capabilities;
        renderPairChannelCards();
        updatePairButtons();
        appendPairEvent(
          `peer capabilities: mobile=${trustedPeerId} app=${capabilities.appId || '-'} version=${capabilities.appVersion || '-'} messages=${(capabilities.supportedMessages || []).join(',') || '-'}`
        );
      },
      onAppMessage: async (message) => {
        const handled = await appRegistry.dispatch(message, undefined);
        if (!handled) {
          appendPairEvent(`peer app message from ${trustedPeerId}: ${message.type}`);
        }
      },
      onLog: (line) => {
        appendPairEvent(`peer ${trustedPeerId}: ${line}`);
      }
    });
    pairPeers.set(peerKey, peer);
    updateChannelPeerState(channel, channel.peerState || 'idle', channel.peerDetail || '');
    return peer;
  }

  async function revokePairBinding(bindingId) {
    const id = String(bindingId || '').trim();
    if (!id) {
      return;
    }
    const { baseUrl, session } = await ensurePairAuthSession();
    await revokePairV2Binding(baseUrl, session.token, id);
  }

  async function removePairChannel(channelId) {
    const normalizedId = String(channelId || '').trim();
    if (!normalizedId) {
      return;
    }
    const channel = findPairChannelById(normalizedId);
    if (!channel) {
      return;
    }
    const confirmed = globalThis.confirm(t('msg.pairDeleteConfirm', { id: normalizedId }));
    if (!confirmed) {
      return;
    }

    if (channel.bindingId) {
      closePairPeerByKey(channel.bindingId, 'binding removed');
      try {
        await revokePairBinding(channel.bindingId);
      } catch (error) {
        appendPairEvent(t('msg.pairRevokeFailed', { message: error?.message || String(error) }));
      }
    }

    removePairChannelLocal(normalizedId);
    renderPairChannelCards();
    updatePairButtons();
    setPairMessage(t('msg.pairDeleted'), 'success');
    appendPairEvent(`channel deleted: ${normalizedId}`);
  }

  async function bindPairEnvelope(envelope) {
    if (!pairChannelOpen) {
      return;
    }
    if (!envelope || typeof envelope !== 'object') {
      return;
    }

    const eventType = String(envelope?.type || '').trim();
    const fromType = String(envelope?.from?.type || '').trim();
    const fromId = String(envelope?.from?.id || '').trim();
    const payload = envelope?.payload && typeof envelope.payload === 'object' ? envelope.payload : {};

    if (eventType === 'pair.claimed') {
      const mobileId = String(payload?.mobileId || payload?.mobile_id || '').trim();
      const sessionId = String(payload?.pairSessionId || payload?.pair_session_id || '').trim();
      const bindingId = String(payload?.bindingId || payload?.binding_id || '').trim();
      const devicePublicKey = String(payload?.devicePublicKey || payload?.device_public_key || '').trim();
      const mobilePublicKey = String(payload?.mobilePublicKey || payload?.mobile_public_key || '').trim();
      const sessionNonce = String(payload?.sessionNonce || payload?.session_nonce || '').trim();
      let channel =
        findPairChannelByBindingId(bindingId) ||
        (sessionId && (findPairChannelById(sessionId) || findPairChannelById(`ch_${sessionId}`))) ||
        (mobileId && findPairChannelByMobileId(mobileId)) ||
        findFirstPendingChannel() ||
        null;
      if (!channel) {
        channel = upsertPairChannel({
          channelId: sessionId || (mobileId ? `ch_${mobileId}` : `ch_${Date.now()}`),
          sessionId,
          mobileId,
          bindingId,
          status: 'pending',
          createdAt: Date.now()
        });
      }
      if (channel) {
        channel.status = 'pending';
        if (mobileId) {
          channel.mobileId = mobileId;
        }
        if (bindingId) {
          channel.bindingId = bindingId;
        }
        if (devicePublicKey) {
          channel.devicePublicKey = devicePublicKey;
        }
        if (mobilePublicKey) {
          channel.mobilePublicKey = mobilePublicKey;
        }
        if (sessionNonce) {
          channel.sessionNonce = sessionNonce;
        }
        channel.trustState = String(payload?.trustState || payload?.trust_state || 'pending');
        channel.peerState = 'idle';
        try {
          if (devicePublicKey && mobilePublicKey && sessionId && sessionNonce) {
            channel.safetyCode = await computePairV2SafetyCode({
              devicePublicKey,
              mobilePublicKey,
              pairSessionId: sessionId,
              sessionNonce
            });
          }
        } catch (error) {
          appendPairEvent(`compute safety code failed: ${error?.message || String(error)}`);
        }
        renderPairChannelCards();
        updatePairButtons();
      }
      closeDialogSafe(pairQrDialog);
      setPairMessage(t('msg.pairClaimed'), 'success');
      appendPairEvent(
        `pair claimed: session=${sessionId || '-'} mobile=${mobileId || '-'} safety=${channel?.safetyCode || '-'}`
      );
      return;
    }

    if (eventType === 'pair.revoked') {
      const bindingId = String(payload?.bindingId || payload?.binding_id || '').trim();
      const mobileId = String(payload?.mobileId || payload?.mobile_id || fromId || '').trim();
      const channel = findPairChannelByBindingId(bindingId) || findPairChannelByMobileId(mobileId) || null;
      if (channel) {
        closePairPeerByKey(bindingId, 'binding revoked');
        channel.status = 'offline';
        channel.trustState = 'revoked';
        renderPairChannelCards();
        updatePairButtons();
      }
      appendPairEvent(`pair revoked: binding=${bindingId || '-'} mobile=${mobileId || '-'}`);
      return;
    }

    if (eventType === 'webrtc.offer' || eventType === 'webrtc.answer' || eventType === 'webrtc.ice') {
      const bindingId = String(payload?.bindingId || payload?.binding_id || '').trim();
      const mobileId = String(payload?.mobileId || payload?.mobile_id || fromId || '').trim();
      const channel = findPairChannelByBindingId(bindingId) || findPairChannelByMobileId(mobileId) || null;
      if (!channel) {
        appendPairEvent(`peer signal ignored without channel: type=${eventType} binding=${bindingId || '-'}`);
        return;
      }
      try {
        const peer = await ensurePairPeer(channel);
        await peer.handleSignal(eventType, payload);
      } catch (error) {
        appendPairEvent(`peer signal failed: type=${eventType} binding=${bindingId || '-'} ${error?.message || String(error)}`);
      }
      return;
    }

    if (fromType === 'desktop' && eventType === 'agent.reply') {
      const mobileId = String(payload?.mobileId || payload?.mobile_id || '').trim();
      const channel = ensureChannelForMobile(mobileId);
      if (channel) {
        channel.status = channel.trustState === 'pending' ? 'pending' : pairChannelOpen ? 'active' : 'offline';
        const text = String(payload?.text || payload?.message || '').trim();
        appendPairChannelMessage(channel.channelId, {
          from: 'agent',
          text: text || JSON.stringify(payload),
          ts: Number(payload?.sentAt || payload?.sent_at || envelope?.ts || Date.now())
        });
        appendPairEvent(`agent reply -> ${channel.mobileId || channel.channelId}: ${text || '[payload]'}`);
        renderPairChannelCards();
        return;
      }
    }

    if (eventType === 'channel.status') {
      const mobileId = String(payload?.mobileId || payload?.mobile_id || fromId || '').trim();
      const channel = ensureChannelForMobile(mobileId);
      if (channel) {
        channel.status = pairChannelOpen ? 'active' : 'offline';
        renderPairChannelCards();
      }
      appendPairEvent(`status from ${mobileId || '-'}: ${JSON.stringify(payload)}`);
      return;
    }

    appendPairEvent(`signal ${eventType || 'unknown'} <- ${fromType || '-'}:${fromId || '-'} ${JSON.stringify(payload)}`);
  }

  function pairDeviceName() {
    const platform = navigator.platform || 'Desktop';
    return `OpenClaw Desktop (${platform})`;
  }

  function syncPairStorage() {
    // no-op: channel connection params are now sourced from config file
  }

  async function sendPairSignal({ toType, toId, type, payload = {} }) {
    if (!pairChannelOpen) {
      throw new Error('channel is closed');
    }
    const { baseUrl, deviceId, session } = await ensurePairAuthSession();
    try {
      return await sendPairV2Signal(baseUrl, session.token, {
        fromType: 'desktop',
        fromId: deviceId,
        toType,
        toId,
        type,
        payload
      });
    } catch (error) {
      clearPairAuthState();
      throw new Error(`send ${type} failed: ${error?.message || String(error)}`);
    }
  }

  async function sendPairChatMessage() {
    const channel = findPairChannelById(getActiveChatChannelId());
    if (!channel || !channel.mobileId) {
      setPairMessage(t('msg.pairNeedMobileId'), 'error');
      return;
    }
    const storeDraft = useDesktopShellStore.getState().pair.chatDraft;
    const text = String(storeDraft || pairChatDraftInput?.value || '').trim();
    if (!text) {
      setPairMessage(t('msg.pairNeedChatMessage'), 'error');
      return;
    }
    if (channel.peerState !== 'connected') {
      setPairMessage(t('msg.pairPeerNotReady'), 'error');
      return;
    }
    if (!channelSupportsOpenClawChat(channel)) {
      setPairMessage(t('msg.pairPeerChatUnsupported'), 'error');
      return;
    }

    try {
      const peer = await ensurePairPeer(channel);
      await peer.sendAppMessage(openClawPairChatMessageType, buildOpenClawPairChatPayload(text));
      appendPairChannelMessage(channel.channelId, { from: 'desktop', text, ts: Date.now() });
      appendPairEvent(`peer chat sent -> mobile=${channel.mobileId}`);
      setPairMessage(t('msg.pairChatSent'), 'success');
      pairChatDraftInput.value = '';
      useDesktopShellStore.getState().setPairState({
        chatDraft: ''
      });
      updatePairButtons();
      renderPairChatMessages();
    } catch (error) {
      setPairMessage(`发送 ${openClawPairChatMessageType} 失败：${error?.message || String(error)}`, 'error');
      appendPairEvent(`${openClawPairChatMessageType} failed: ${error?.message || String(error)}`);
    }
  }

  async function connectPairChannel({ fromReconnect = false } = {}) {
    if (!isPairCenterAvailable()) {
      return;
    }
    if (!pairChannelOpen && !fromReconnect) {
      updatePairButtons();
      return;
    }
    if (!fromReconnect) {
      resetPairReconnectTimer();
    }

    let baseUrl;
    let deviceId;
    let session;
    try {
      const ready = await announcePairPresence(fromReconnect);
      baseUrl = ready.baseUrl;
      deviceId = ready.deviceId;
      session = ready.session;
    } catch (error) {
      const message = String(error?.message || error || '');
      setPairMessage(message.includes('Ed25519') || message.includes('Web Crypto') ? t('msg.pairCryptoUnsupported') : message, 'error');
      renderPairWsStatus('disconnected');
      updatePairButtons();
      return;
    }

    pairDesiredConnected = true;
    stopPairPresenceLoop();
    cleanupPairWebSocket();
    renderPairWsStatus('connecting');
    setPairMessage(t('msg.pairConnecting'));
    appendPairEvent(`connecting v2 stream -> ${buildPairStreamUrl(baseUrl, deviceId, session?.token || '')}`);
    updatePairButtons();

    const stream = openPairV2SignalStream(baseUrl, session.token, 'desktop', deviceId);
    pairWs = stream;
    pairChannelMode = 'sse';

    stream.onopen = async () => {
      pairReconnectAttempts = 0;
      renderPairWsStatus('connected');
      setPairMessage(t('msg.pairConnected'), 'success');
      appendPairEvent('v2 signal stream connected');
      try {
        await syncBindingsFromServer();
      } catch (error) {
        appendPairEvent(`sync bindings failed: ${error?.message || String(error)}`);
      }
      updateAllChannelsStatus('active');
      renderPairChannelCards();
      updatePairButtons();
      startPairPresenceLoop();
    };

    stream.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        if (String(message?.type || '').trim() === 'stream.opened') {
          return;
        }
        void bindPairEnvelope(message);
      } catch {
        appendPairEvent(`signal raw: ${event.data}`);
      }
    };

    stream.onerror = () => {
      if (pairWs !== stream) {
        return;
      }
      stopPairPresenceLoop();
      cleanupPairWebSocket();
      clearPairAuthState();
      renderPairWsStatus('disconnected');
      setPairMessage(t('msg.pairDisconnected'), 'error');
      updateAllChannelsStatus('offline');
      renderPairChannelCards();
      updatePairButtons();
      appendPairEvent('v2 signal stream disconnected');
      if (pairDesiredConnected) {
        schedulePairReconnect();
      }
    };
  }

  function updateAllChannelsStatus(status) {
    pairChannels.forEach((channel) => {
      if (channel && channel.status !== 'pending' && channel.trustState !== 'revoked') {
        channel.status = status;
      }
    });
  }

  function disconnectPairChannel() {
    if (!isPairCenterAvailable()) {
      return;
    }
    pairChannelOpen = false;
    pairDesiredConnected = false;
    pairReconnectAttempts = 0;
    resetPairReconnectTimer();
    stopPairPresenceLoop();
    closeAllPairPeers('desktop channel closed');
    cleanupPairWebSocket();
    clearPairAuthState();
    renderPairWsStatus('disconnected');
    setPairMessage(t('msg.pairDisconnected'));
    appendPairEvent('ws disconnected by user');
    updateAllChannelsStatus('offline');
    renderPairChannelCards();
    updatePairButtons();
  }

  async function createPairSession() {
    if (!isPairCenterAvailable()) {
      return;
    }

    let baseUrl;
    try {
      baseUrl = getPairServerBaseUrl();
    } catch (error) {
      setPairMessage(error.message || String(error), 'error');
      return;
    }

    syncPairStorage();
    if (!isPairChannelOpen()) {
      await connectPairChannel();
    }

    setPairMessage(t('msg.pairCreateRunning'));
    appendPairEvent('create v2 pair session');
    clearPairQrPreview();

    try {
      const { session } = await ensurePairAuthSession();
      const result = await createPairV2Session(baseUrl, session.token, 180);
      const qrPayload = await sanitizePairQrPayload(result?.qrPayload || {}, baseUrl);
      const createdChannel = upsertPairChannel({
        channelId: String(result?.session?.pairSessionId || `ch_${Date.now()}`),
        sessionId: String(result?.session?.pairSessionId || ''),
        status: 'pending',
        mobileId: '',
        bindingId: '',
        trustState: 'pending',
        createdAt: Number(result?.session?.createdAt || Date.now()),
        qrPayload,
        messages: []
      });
      renderPairChannelCards();
      setPairMessage(t('msg.pairCreated'), 'success');
      appendPairEvent(`pair session created: ${result?.session?.pairSessionId || '-'}`);
      await openPairQrDialogForChannel(createdChannel);
      updatePairButtons();
    } catch (error) {
      setPairMessage(t('msg.pairCreateFailed', { message: error.message || String(error) }), 'error');
      appendPairEvent(`create pair failed: ${error?.message || String(error)}`);
    }
  }

  async function approvePairChannel(channelId) {
    const channel = findPairChannelById(channelId);
    if (!channel || !channel.bindingId) {
      setPairMessage(t('msg.pairCreateFailed', { message: 'bindingId missing' }), 'error');
      return;
    }

    try {
      const { baseUrl, session } = await ensurePairAuthSession();
      const result = await approvePairV2Binding(baseUrl, session.token, channel.bindingId);
      channel.status = pairChannelOpen ? 'active' : 'offline';
      channel.trustState = String(result?.binding?.trustState || 'active');
      channel.approvedAt = Number(result?.binding?.approvedAt || Date.now());
      channel.peerState = channel.peerState || 'idle';
      renderPairChannelCards();
      updatePairButtons();
      setPairMessage(t('msg.pairApproved'), 'success');
      appendPairEvent(`pair approved: binding=${channel.bindingId} mobile=${channel.mobileId || '-'}`);
    } catch (error) {
      setPairMessage(t('msg.pairCreateFailed', { message: error?.message || String(error) }), 'error');
      appendPairEvent(`approve failed: ${error?.message || String(error)}`);
    }
  }

  function applyPairConfigFromRawConfig() {
    const baseUrl = normalizePairBaseUrl(
      rawConfig?.channelServerBaseUrl || rawConfig?.pairServerBaseUrl || rawConfig?.pairServerUrl || ''
    );
    const deviceId = String(rawConfig?.channelDeviceId || rawConfig?.pairDeviceId || '').trim();
    pairConfiguredServerUrl = baseUrl;
    pairConfiguredDeviceId = deviceId;
  }

  async function refreshPairChannelConfig({ reconnectIfOpen = true } = {}) {
    try {
      const latest = await invoke('read_raw_config');
      if (latest) {
        rawConfig = latest;
      }
      applyPairConfigFromRawConfig();

      if (!hasPairConfig()) {
        if (pairChannelOpen) {
          disconnectPairChannel();
        }
        setPairMessage(t('msg.pairMissingConfig'), 'error');
        updatePairButtons();
        return;
      }

      appendPairEvent(`channel config reloaded: server=${pairConfiguredServerUrl} device=${pairConfiguredDeviceId}`);
      setPairMessage(t('msg.pairConfigReloaded'), 'success');
      if (pairChannelOpen && reconnectIfOpen) {
        await connectPairChannel();
      } else {
        updatePairButtons();
      }
    } catch (error) {
      setPairMessage(`刷新配置失败：${error?.message || String(error)}`, 'error');
    }
  }

  function initPairCenter() {
    if (!isPairCenterAvailable()) {
      return;
    }

    applyPairConfigFromRawConfig();
    pairChatDraftInput.value = '';
    clearPairQrPreview();
    useDesktopShellStore.getState().setPairState({
      eventLog: `${t('pair.logPrefix')}: ready`,
      chatDraft: '',
      chatDialogOpen: false,
      activeChatChannelId: '',
      chatDialogTitle: '',
      qrDialogOpen: false
    });
    pairEventLog.textContent = `${t('pair.logPrefix')}: ready`;
    pairChannelOpen = false;
    renderPairWsStatus('disconnected');
    renderPairChannelCards();
    updatePairButtons();
    if (!hasPairConfig()) {
      setPairMessage(t('msg.pairMissingConfig'), 'error');
    } else {
      setPairMessage('');
    }

    if (pairReloadConfigBtn) {
      pairReloadConfigBtn.onclick = () => {
        void refreshPairChannelConfig();
      };
    }

    if (pairChannelToggleBtn) {
      pairChannelToggleBtn.onclick = () => {
        if (pairChannelOpen) {
          disconnectPairChannel();
          return;
        }
        if (!hasPairConfig()) {
          setPairMessage(t('msg.pairMissingConfig'), 'error');
          return;
        }
        pairChannelOpen = true;
        void connectPairChannel();
      };
    }

    if (pairCreateChannelBtn) {
      pairCreateChannelBtn.onclick = () => {
        if (!hasPairConfig()) {
          setPairMessage(t('msg.pairMissingConfig'), 'error');
          return;
        }
        if (!pairChannelOpen) {
          setPairMessage(t('msg.pairChannelClosedForCreate'), 'error');
          return;
        }
        void createPairSession();
      };
    }

    pairChatDraftInput.addEventListener('input', () => {
      useDesktopShellStore.getState().setPairState({
        chatDraft: String(pairChatDraftInput?.value || '')
      });
      updatePairButtons();
    });
    pairChatSendBtn.addEventListener('click', async () => {
      await sendPairChatMessage();
    });
    pairChatCloseBtn.addEventListener('click', () => {
      useDesktopShellStore.getState().setPairState({
        activeChatChannelId: '',
        chatDialogOpen: false,
        chatDialogTitle: '',
        chatDraft: ''
      });
      closeDialogSafe(pairChatDialog);
      if (typeof setActiveChatChannelId === 'function') {
        setActiveChatChannelId('');
      }
      updatePairButtons();
    });
    pairQrCloseBtn.addEventListener('click', () => {
      useDesktopShellStore.getState().setPairState({
        qrDialogOpen: false
      });
      closeDialogSafe(pairQrDialog);
    });
    pairChatDraftInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        void sendPairChatMessage();
      }
    });
  }

  function shutdown() {
    pairDesiredConnected = false;
    stopPairPresenceLoop();
    closeAllPairPeers('desktop shutdown');
    clearPairAuthState();
    resetPairReconnectTimer();
    cleanupPairWebSocket();
  }

  useDesktopShellStore.getState().setPairActions({
    reloadConfig: () => refreshPairChannelConfig(),
    toggleChannel: async () => {
      if (pairChannelOpen) {
        disconnectPairChannel();
        return;
      }
      if (!hasPairConfig()) {
        setPairMessage(t('msg.pairMissingConfig'), 'error');
        return;
      }
      pairChannelOpen = true;
      await connectPairChannel();
    },
    createChannel: async () => {
      if (!hasPairConfig()) {
        setPairMessage(t('msg.pairMissingConfig'), 'error');
        return;
      }
      if (!pairChannelOpen) {
        setPairMessage(t('msg.pairChannelClosedForCreate'), 'error');
        return;
      }
      await createPairSession();
    },
    closeQr: () => {
      useDesktopShellStore.getState().setPairState({
        qrDialogOpen: false
      });
      closeDialogSafe(pairQrDialog);
    },
    approveChannel: async (channelId) => {
      await approvePairChannel(channelId);
    },
    closeChat: () => {
      useDesktopShellStore.getState().setPairState({
        activeChatChannelId: '',
        chatDialogOpen: false,
        chatDialogTitle: '',
        chatDraft: ''
      });
      if (typeof setActiveChatChannelId === 'function') {
        setActiveChatChannelId('');
      }
      closeDialogSafe(pairChatDialog);
      updatePairButtons();
    },
    sendChat: () => sendPairChatMessage(),
    setChatDraft: (draft) => {
      const nextDraft = String(draft || '');
      useDesktopShellStore.getState().setPairState({
        chatDraft: nextDraft
      });
      if (pairChatDraftInput) {
        pairChatDraftInput.value = nextDraft;
      }
      updatePairButtons();
    }
  });

  return {
    isPairCenterAvailable,
    hasPairConfig,
    setPairMessage,
    appendPairEvent,
    openPairQrDialogForChannel,
    openPairQrDialog,
    removePairChannel,
    clearPairQrPreview,
    renderPairQrPreview,
    sendPairChatMessage,
    renderPairWsStatus,
    resetPairReconnectTimer,
    cleanupPairWebSocket,
    updatePairButtons,
    connectPairChannel,
    disconnectPairChannel,
    createPairSession,
    applyPairConfigFromRawConfig,
    refreshPairChannelConfig,
    initPairCenter,
    shutdown,
    setRawConfig: (value) => {
      rawConfig = value;
    },
    getRawConfig: () => rawConfig,
    isPairChannelOpen,
    isPairChannelConnecting
  };
}
