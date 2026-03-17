// @ts-nocheck
import { invoke as defaultInvoke } from '@tauri-apps/api/tauri';
import QRCode from 'qrcode';
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
  let pairWsRequestSeq = 0;
  let pairChannelOpen = false;
  let pairConfiguredServerUrl = '';
  let pairConfiguredDeviceId = '';
  const pairWsPendingRequests = new Map();
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
    const payloadBaseUrl = String(payload.base_url || payload.baseUrl || '').trim();
    const resolvedBaseUrl = await resolvePairQrBaseUrl({
      configuredBaseUrl,
      payloadBaseUrl
    });

    if (!resolvedBaseUrl) {
      return payload;
    }

    payload.base_url = resolvedBaseUrl;
    payload.baseUrl = resolvedBaseUrl;
    if (payloadBaseUrl && normalizePairBaseUrl(payloadBaseUrl) !== resolvedBaseUrl) {
      appendPairEvent(`qr base_url rewritten: ${payloadBaseUrl} -> ${resolvedBaseUrl}`);
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
    return '';
  }

  function buildPairHttpUrl(baseUrl, path) {
    const parsed = new URL(baseUrl);
    parsed.pathname = path;
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString();
  }

  function buildPairStreamUrl(baseUrl, deviceId) {
    const parsed = new URL(baseUrl);
    parsed.pathname = '/v1/signal/stream';
    parsed.search = `clientType=desktop&clientId=${encodeURIComponent(deviceId)}`;
    const token = getPairServerToken();
    if (token) {
      parsed.search += `&token=${encodeURIComponent(token)}`;
    }
    parsed.hash = '';
    return parsed.toString();
  }

  function buildPairWsUrl(baseUrl, deviceId) {
    const parsed = new URL(baseUrl);
    parsed.protocol = parsed.protocol === 'https:' ? 'wss:' : 'ws:';
    parsed.pathname = '/v1/signal/ws';
    parsed.search = `clientType=desktop&clientId=${encodeURIComponent(deviceId)}`;
    const token = getPairServerToken();
    if (token) {
      parsed.search += `&token=${encodeURIComponent(token)}`;
    }
    parsed.hash = '';
    return parsed.toString();
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
      !hasDraft;
  }

  function resetPairReconnectTimer() {
    if (pairReconnectTimer) {
      clearTimeout(pairReconnectTimer);
      pairReconnectTimer = null;
    }
  }

  function clearPairWsPendingRequests(reason = 'ws closed') {
    for (const [, pending] of pairWsPendingRequests) {
      if (pending.timer) {
        clearTimeout(pending.timer);
      }
      pending.reject(new Error(reason));
    }
    pairWsPendingRequests.clear();
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
    clearPairWsPendingRequests('ws channel closed');
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

  async function revokePairBinding(bindingId) {
    const id = String(bindingId || '').trim();
    if (!id) {
      return;
    }
    const baseUrl = getPairServerBaseUrl();
    const endpoint = buildPairHttpUrl(baseUrl, '/v1/pair/revoke');
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ bindingId: id })
    });
    let result = null;
    try {
      result = await response.json();
    } catch {
      result = null;
    }
    if (!response.ok || !result?.ok) {
      const message = result?.message || result?.error || `HTTP ${response.status}`;
      throw new Error(String(message));
    }
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
      const userId = String(payload?.userId || payload?.user_id || '').trim();
      const sessionId = String(payload?.pairSessionId || payload?.pair_session_id || '').trim();
      const bindingId = String(payload?.bindingId || payload?.binding_id || '').trim();
      const channelBySession =
        (sessionId && (findPairChannelById(sessionId) || findPairChannelById(`ch_${sessionId}`))) || null;
      const channelByMobile = (mobileId && findPairChannelByMobileId(mobileId)) || null;

      if (channelBySession && channelByMobile && channelBySession.channelId !== channelByMobile.channelId) {
        if (bindingId) {
          try {
            await revokePairBinding(bindingId);
          } catch (error) {
            appendPairEvent(t('msg.pairRevokeFailed', { message: error?.message || String(error) }));
          }
        }
        removePairChannelLocal(channelBySession.channelId);
        closeDialogSafe(pairQrDialog);
        renderPairChannelCards();
        updatePairButtons();
        setPairMessage(t('msg.pairAlreadyPaired', { mobileId: mobileId || '-' }), 'error');
        appendPairEvent(
          `duplicate claim blocked: session=${sessionId || '-'} mobile=${mobileId || '-'} kept=${channelByMobile.channelId}`
        );
        return;
      }

      let channel = channelBySession || channelByMobile || findFirstPendingChannel() || null;
      if (!channel) {
        channel = upsertPairChannel({
          channelId: sessionId || (mobileId ? `ch_${mobileId}` : `ch_${Date.now()}`),
          sessionId,
          mobileId,
          userId,
          bindingId,
          status: 'active',
          createdAt: Date.now()
        });
      }
      if (channel) {
        channel.status = 'active';
        if (mobileId) {
          channel.mobileId = mobileId;
        }
        if (userId) {
          channel.userId = userId;
        }
        if (bindingId) {
          channel.bindingId = bindingId;
        }
        renderPairChannelCards();
        updatePairButtons();
      }
      closeDialogSafe(pairQrDialog);
      setPairMessage(t('msg.pairClaimed'), 'success');
      appendPairEvent(`channel claimed: session=${sessionId || '-'} mobile=${mobileId || '-'} user=${userId || '-'}`);
      return;
    }

    if (fromType === 'mobile') {
      const channel = ensureChannelForMobile(fromId || payload?.mobileId || payload?.mobile_id || '');
      if (channel) {
        channel.status = pairChannelOpen ? 'active' : 'offline';
        if (eventType === 'chat.message') {
          const text = String(payload?.text || payload?.message || '').trim();
          appendPairChannelMessage(channel.channelId, {
            from: 'mobile',
            text: text || JSON.stringify(payload),
            ts: Number(envelope?.ts || Date.now())
          });
          appendPairEvent(`chat from ${channel.mobileId || channel.channelId}: ${text || '[payload]'}`);
          renderPairChannelCards();
          return;
        }
      }
    }

    if (fromType === 'desktop' && eventType === 'agent.reply') {
      const mobileId = String(payload?.mobileId || payload?.mobile_id || '').trim();
      const channel = ensureChannelForMobile(mobileId);
      if (channel) {
        channel.status = pairChannelOpen ? 'active' : 'offline';
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

  function sendPairSignalViaWs({ toType, toId, type, payload = {} }) {
    if (pairChannelMode !== 'ws' || !pairWs || pairWs.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('ws channel is not open'));
    }

    pairWsRequestSeq += 1;
    const requestId = `wsreq_${Date.now()}_${pairWsRequestSeq}`;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pairWsPendingRequests.delete(requestId);
        reject(new Error(`send ${type} timeout`));
      }, 6000);

      pairWsPendingRequests.set(requestId, { resolve, reject, timer });
      try {
        pairWs.send(
          JSON.stringify({
            action: 'signal.send',
            requestId,
            data: {
              toType,
              toId,
              type,
              payload
            }
          })
        );
      } catch (error) {
        clearTimeout(timer);
        pairWsPendingRequests.delete(requestId);
        reject(error);
      }
    });
  }

  async function sendPairSignal({ toType, toId, type, payload = {} }) {
    if (!pairChannelOpen) {
      throw new Error('channel is closed');
    }
    if (isPairChannelOpen() && pairChannelMode === 'ws') {
      return sendPairSignalViaWs({ toType, toId, type, payload });
    }

    const baseUrl = getPairServerBaseUrl();
    const fromId = getPairDeviceId();
    const endpoint = buildPairHttpUrl(baseUrl, '/v1/signal/send');
    const serverToken = getPairServerToken();
    const headers = {
      'Content-Type': 'application/json'
    };
    if (serverToken) {
      headers.Authorization = `Bearer ${serverToken}`;
    }

    let response;
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          fromType: 'desktop',
          fromId,
          toType,
          toId,
          type,
          payload
        })
      });
    } catch (error) {
      throw new Error(`send ${type} network failed: ${error?.message || String(error)}`);
    }

    let result;
    try {
      result = await response.json();
    } catch {
      result = null;
    }

    if (!response.ok || !result?.ok) {
      const message = result?.message || result?.error || `HTTP ${response.status}`;
      throw new Error(`send ${type} failed: ${message}`);
    }

    return result;
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

    try {
      const response = await sendPairSignal({
        toType: 'mobile',
        toId: channel.mobileId,
        type: 'chat.message',
        payload: {
          text,
          sentAt: Date.now(),
          from: 'desktop'
        }
      });
      const delivered = response?.deliveredRealtime === true ? 'realtime' : 'queued';
      appendPairChannelMessage(channel.channelId, { from: 'desktop', text, ts: Date.now() });
      appendPairEvent(`chat.message sent -> mobile=${channel.mobileId} (${delivered})`);
      setPairMessage(t('msg.pairChatSent'), 'success');
      pairChatDraftInput.value = '';
      useDesktopShellStore.getState().setPairState({
        chatDraft: ''
      });
      updatePairButtons();
      renderPairChatMessages();
    } catch (error) {
      setPairMessage(`发送 chat.message 失败：${error?.message || String(error)}`, 'error');
      appendPairEvent(`chat.message failed: ${error?.message || String(error)}`);
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
    try {
      baseUrl = getPairServerBaseUrl();
      deviceId = getPairDeviceId();
    } catch (error) {
      setPairMessage(error.message || String(error), 'error');
      renderPairWsStatus('disconnected');
      updatePairButtons();
      return;
    }

    pairDesiredConnected = true;
    cleanupPairWebSocket();
    renderPairWsStatus('connecting');
    setPairMessage(t('msg.pairConnecting'));
    appendPairEvent(`connecting ws -> ${buildPairWsUrl(baseUrl, deviceId)}`);
    updatePairButtons();

    const wsUrl = buildPairWsUrl(baseUrl, deviceId);
    const ws = new WebSocket(wsUrl);
    let fallbackTimer = null;
    let settled = false;

    pairWs = ws;
    pairChannelMode = 'ws';

    const fallbackToSse = () => {
      if (settled) {
        return;
      }
      settled = true;
      if (fallbackTimer) {
        clearTimeout(fallbackTimer);
        fallbackTimer = null;
      }
      try {
        ws.close();
      } catch {
        // ignore
      }

      appendPairEvent('ws unavailable, fallback to sse');
      const streamUrl = buildPairStreamUrl(baseUrl, deviceId);
      appendPairEvent(`connecting signal stream -> ${streamUrl}`);
      const stream = new EventSource(streamUrl);
      pairWs = stream;
      pairChannelMode = 'sse';
      renderPairWsStatus('connecting');
      stream.onopen = () => {
        pairReconnectAttempts = 0;
        renderPairWsStatus('connected');
        setPairMessage(t('msg.pairConnected'), 'success');
        appendPairEvent('signal stream connected');
        updateAllChannelsStatus('active');
        renderPairChannelCards();
        updatePairButtons();
      };
      stream.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          void bindPairEnvelope(payload);
        } catch {
          appendPairEvent(`signal stream raw: ${event.data}`);
        }
      };
      stream.onerror = () => {
        renderPairWsStatus('disconnected');
        setPairMessage(t('msg.pairDisconnected'), 'error');
        updateAllChannelsStatus('offline');
        renderPairChannelCards();
        updatePairButtons();
        if (pairDesiredConnected) {
          appendPairEvent('signal stream reconnecting...');
          schedulePairReconnect();
        }
      };
    };

    fallbackTimer = setTimeout(fallbackToSse, 2500);

    ws.addEventListener('open', () => {
      if (settled) {
        return;
      }
      settled = true;
      if (fallbackTimer) {
        clearTimeout(fallbackTimer);
        fallbackTimer = null;
      }
      pairReconnectAttempts = 0;
      renderPairWsStatus('connected');
      setPairMessage(t('msg.pairConnected'), 'success');
      appendPairEvent('ws connected');
      updateAllChannelsStatus('active');
      renderPairChannelCards();
      updatePairButtons();
    });

    ws.addEventListener('message', (event) => {
      try {
        const message = JSON.parse(event.data);
        if (message?.action === 'signal.send.ack') {
          const requestId = String(message?.requestId || '').trim();
          const pending = requestId ? pairWsPendingRequests.get(requestId) : null;
          if (pending) {
            clearTimeout(pending.timer);
            pairWsPendingRequests.delete(requestId);
            if (message?.ok === false) {
              pending.reject(new Error(message?.error || 'signal send rejected'));
            } else {
              pending.resolve(message?.data || {});
            }
          }
          return;
        }
        void bindPairEnvelope(message);
      } catch {
        appendPairEvent(`ws raw: ${event.data}`);
      }
    });

    ws.addEventListener('close', () => {
      if (!settled) {
        fallbackToSse();
        return;
      }
      renderPairWsStatus('disconnected');
      clearPairWsPendingRequests('ws closed');
      updateAllChannelsStatus('offline');
      renderPairChannelCards();
      updatePairButtons();
      if (pairDesiredConnected) {
        appendPairEvent('ws closed unexpectedly');
        schedulePairReconnect();
      }
    });

    ws.addEventListener('error', () => {
      if (!settled) {
        fallbackToSse();
      }
    });
  }

  function updateAllChannelsStatus(status) {
    pairChannels.forEach((channel) => {
      if (channel && channel.status !== 'pending') {
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
    cleanupPairWebSocket();
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
    let deviceId;
    try {
      baseUrl = getPairServerBaseUrl();
      deviceId = getPairDeviceId();
    } catch (error) {
      setPairMessage(error.message || String(error), 'error');
      return;
    }

    syncPairStorage();
    if (!isPairChannelOpen()) {
      await connectPairChannel();
    }

    const endpoint = buildPairHttpUrl(baseUrl, '/pair/create');
    const serverToken = getPairServerToken();
    const headers = {
      'Content-Type': 'application/json'
    };
    if (serverToken) {
      headers.Authorization = `Bearer ${serverToken}`;
    }
    setPairMessage(t('msg.pairCreateRunning'));
    appendPairEvent(`create pair session -> ${endpoint}`);
    clearPairQrPreview();

    let response;
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          device_id: deviceId,
          device_name: pairDeviceName()
        })
      });
    } catch (error) {
      setPairMessage(t('msg.pairCreateFailed', { message: error.message || String(error) }), 'error');
      return;
    }

    let result;
    try {
      result = await response.json();
    } catch {
      result = null;
    }

    if (!response.ok || !result?.ok || !result?.data) {
      const message = result?.error || result?.message || `HTTP ${response.status}`;
      setPairMessage(t('msg.pairCreateFailed', { message }), 'error');
      appendPairEvent(`create failed: ${message}`);
      return;
    }

    const data = result.data;
    const qrPayload = await sanitizePairQrPayload(data.qr_payload || {}, baseUrl);
    const createdChannel = upsertPairChannel({
      channelId: String(data.session_id || `ch_${Date.now()}`),
      sessionId: String(data.session_id || ''),
      status: 'pending',
      mobileId: '',
      userId: '',
      createdAt: Date.now(),
      qrPayload,
      messages: []
    });
    renderPairChannelCards();
    setPairMessage(t('msg.pairCreated'), 'success');
    appendPairEvent(`session ${data.session_id || '-'} created`);
    await openPairQrDialogForChannel(createdChannel);
    updatePairButtons();
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
