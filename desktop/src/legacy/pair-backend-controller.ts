// @ts-nocheck
import { invoke as defaultInvoke } from '@tauri-apps/api/tauri';
import { listen } from '@tauri-apps/api/event';
import QRCode from 'qrcode';
import { useDesktopShellStore } from '../store/useDesktopShellStore';
import { createPairBackendQrHelpers, normalizePairBaseUrl } from './pair-backend-qr';
import { channelSupportsOpenClawChat, normalizeBackendChannel } from './pair-backend-model';

const PAIR_EVENT_NAME = 'pair-backend://state';

export function createPairBackendController(deps) {
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
    upsertPairChannel,
    renderPairChannelCards,
    closeDialogSafe,
    openDialogSafe,
    renderPairChatMessages,
    removePairChannelLocal,
    invoke = defaultInvoke
  } = deps;

  let rawConfig = null;
  let pairConfiguredServerUrl = '';
  let pairConfiguredDeviceId = '';
  let pairChannelOpen = false;
  let pairConnectionState = 'disconnected';
  let pairConfigSaving = false;
  let unsubscribeSignal = null;
  let initialized = false;
  const { sanitizePairQrPayload } = createPairBackendQrHelpers({ invoke });

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

  function syncPairConfigDraftState({ preserveDraft = false } = {}) {
    const currentPairState = useDesktopShellStore.getState().pair;
    useDesktopShellStore.getState().setPairState({
      configuredServerUrl: pairConfiguredServerUrl,
      configuredDeviceId: pairConfiguredDeviceId,
      draftServerUrl: preserveDraft ? currentPairState.draftServerUrl : pairConfiguredServerUrl,
      draftDeviceId: preserveDraft ? currentPairState.draftDeviceId : pairConfiguredDeviceId
    });
  }

  function setPairMessage(message, type = '') {
    const nextMessage = String(message || '');
    const nextType = String(type || '');
    useDesktopShellStore.getState().setPairState({
      statusMessage: nextMessage,
      statusType: nextType
    });
    if (!pairStatusMessage) {
      return;
    }
    pairStatusMessage.textContent = nextMessage;
    pairStatusMessage.className = `message ${nextType}`.trim();
  }

  function appendPairEvent(line) {
    const now = new Date();
    const stamp = `${now.toLocaleDateString()} ${now.toLocaleTimeString()}`;
    const next = `[${stamp}] [ui] ${String(line || '').trim()}`;
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
    if (pairWsStatus) {
      pairWsStatus.textContent = nextText;
    }
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
      clearPairQrPreview();
      setPairMessage(`二维码渲染失败：${error?.message || String(error)}`, 'error');
    }
  }

  async function openPairQrDialogForChannel(channel) {
    if (!channel) {
      setPairMessage(t('msg.pairCreateFailed', { message: 'channel not found' }), 'error');
      return;
    }
    const payload = await sanitizePairQrPayload(channel.qrPayload, pairConfiguredServerUrl);
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

  function applyBackendSnapshot(snapshot, { preserveDraft = true } = {}) {
    const next = snapshot && typeof snapshot === 'object' ? snapshot : {};
    pairConfiguredServerUrl = normalizePairBaseUrl(next.configuredServerUrl || '');
    pairConfiguredDeviceId = String(next.configuredDeviceId || '').trim();
    pairChannelOpen = Boolean(next.channelOpen && hasPairConfig());
    pairConnectionState = String(next.connectionState || 'disconnected');

    syncPairConfigDraftState({ preserveDraft });
    renderPairWsStatus(pairConnectionState);
    setPairMessage(
      next.statusMessage || (hasPairConfig() ? '' : t('msg.pairMissingConfig')),
      next.statusType || ''
    );

    const nextLog = String(next.eventLog || '').trim();
    useDesktopShellStore.getState().setPairState({
      eventLog: nextLog
    });
    if (pairEventLog) {
      pairEventLog.textContent = nextLog;
      pairEventLog.scrollTop = pairEventLog.scrollHeight;
    }

    const nextChannels = Array.isArray(next.channels) ? next.channels : [];
    const seen = new Set();
    for (const rawChannel of nextChannels) {
      const normalized = normalizeBackendChannel(rawChannel);
      if (!normalized.channelId) {
        continue;
      }
      seen.add(normalized.channelId);
      upsertPairChannel(normalized);
    }

    const staleChannelIds = pairChannels
      .filter((channel) => !seen.has(String(channel?.channelId || '').trim()))
      .map((channel) => String(channel?.channelId || '').trim())
      .filter(Boolean);
    for (const channelId of staleChannelIds) {
      removePairChannelLocal(channelId);
    }

    const activeChannel = findPairChannelById(getActiveChatChannelId());
    if (!activeChannel && getActiveChatChannelId()) {
      setActiveChatChannelId('');
      useDesktopShellStore.getState().setPairState({
        activeChatChannelId: '',
        chatDialogOpen: false,
        chatDialogTitle: '',
        chatDraft: ''
      });
      closeDialogSafe(pairChatDialog);
    }

    renderPairChannelCards();
    renderPairChatMessages();
    updatePairButtons();
  }

  function isPairChannelOpen() {
    return pairChannelOpen && pairConnectionState === 'connected';
  }

  function isPairChannelConnecting() {
    return pairConnectionState === 'connecting' || pairConnectionState === 'reconnecting';
  }

  function updatePairButtons() {
    const activeChatChannel = findPairChannelById(getActiveChatChannelId());
    const storeDraft = useDesktopShellStore.getState().pair.chatDraft;
    const hasDraft = String(storeDraft || pairChatDraftInput?.value || '').trim().length > 0;
    const toggleDisabled = pairConfigSaving || (!hasPairConfig() && !pairChannelOpen);
    const createUnavailable = !hasPairConfig() || !pairChannelOpen || isPairChannelConnecting();

    useDesktopShellStore.getState().setPairState({
      channelOpen: pairChannelOpen,
      channelToggleDisabled: toggleDisabled,
      createChannelDisabled: createUnavailable || pairConfigSaving,
      createChannelAriaDisabled: createUnavailable,
      chatSendDisabled:
        !hasPairConfig() ||
        !pairChannelOpen ||
        pairConnectionState !== 'connected' ||
        !activeChatChannel ||
        activeChatChannel.peerState !== 'connected' ||
        !channelSupportsOpenClawChat(activeChatChannel) ||
        !hasDraft
    });

    if (pairChannelToggleBtn) {
      pairChannelToggleBtn.classList.add('pair-toggle');
      pairChannelToggleBtn.classList.toggle('is-on', pairChannelOpen);
      pairChannelToggleBtn.classList.toggle('is-off', !pairChannelOpen);
      pairChannelToggleBtn.setAttribute('aria-pressed', pairChannelOpen ? 'true' : 'false');
      pairChannelToggleBtn.textContent = pairChannelOpen ? t('pair.toggle.on') : t('pair.toggle.off');
      pairChannelToggleBtn.disabled = toggleDisabled;
    }

    if (pairCreateChannelBtn) {
      pairCreateChannelBtn.disabled = createUnavailable || pairConfigSaving;
      pairCreateChannelBtn.setAttribute('aria-disabled', createUnavailable ? 'true' : 'false');
    }

    if (pairReloadConfigBtn) {
      pairReloadConfigBtn.disabled = pairConfigSaving;
    }

    if (pairChatSendBtn) {
      pairChatSendBtn.disabled = useDesktopShellStore.getState().pair.chatSendDisabled;
    }
  }

  async function loadBackendState({ preserveDraft = true } = {}) {
    const snapshot = await invoke('pair_backend_get_state');
    applyBackendSnapshot(snapshot, { preserveDraft });
    return snapshot;
  }

  async function connectPairChannel() {
    if (!hasPairConfig()) {
      setPairMessage(t('msg.pairMissingConfig'), 'error');
      updatePairButtons();
      return false;
    }
    const snapshot = await invoke('pair_backend_toggle_channel', { open: true });
    applyBackendSnapshot(snapshot, { preserveDraft: true });
    return true;
  }

  async function disconnectPairChannel() {
    const snapshot = await invoke('pair_backend_toggle_channel', { open: false });
    applyBackendSnapshot(snapshot, { preserveDraft: true });
    return true;
  }

  async function createPairSession() {
    if (!hasPairConfig()) {
      setPairMessage(t('msg.pairMissingConfig'), 'error');
      return false;
    }
    if (!pairChannelOpen) {
      setPairMessage(t('msg.pairChannelClosedForCreate'), 'error');
      return false;
    }
    const snapshot = await invoke('pair_backend_create_channel');
    applyBackendSnapshot(snapshot, { preserveDraft: true });
    setPairMessage(t('msg.pairCreated'), 'success');
    return true;
  }

  async function approvePairChannel(channelId) {
    const snapshot = await invoke('pair_backend_approve_channel', { channelId });
    applyBackendSnapshot(snapshot, { preserveDraft: true });
    setPairMessage(t('msg.pairApproved'), 'success');
  }

  async function removePairChannel(channelId) {
    const normalizedId = String(channelId || '').trim();
    if (!normalizedId) {
      return false;
    }
    const snapshot = await invoke('pair_backend_delete_channel', { channelId: normalizedId });
    applyBackendSnapshot(snapshot, { preserveDraft: true });
    setPairMessage(t('msg.pairDeleted'), 'success');
    return true;
  }

  async function sendPairChatMessage() {
    const channelId = String(getActiveChatChannelId() || '').trim();
    const draft = String(useDesktopShellStore.getState().pair.chatDraft || pairChatDraftInput?.value || '').trim();
    if (!channelId) {
      setPairMessage(t('msg.pairNeedMobileId'), 'error');
      return false;
    }
    if (!draft) {
      setPairMessage(t('msg.pairNeedChatMessage'), 'error');
      return false;
    }
    const snapshot = await invoke('pair_backend_send_chat', {
      channelId,
      text: draft
    });
    useDesktopShellStore.getState().setPairState({
      chatDraft: ''
    });
    if (pairChatDraftInput) {
      pairChatDraftInput.value = '';
    }
    applyBackendSnapshot(snapshot, { preserveDraft: true });
    setPairMessage(t('msg.pairChatSent'), 'success');
    updatePairButtons();
    return true;
  }

  function applyPairConfigFromRawConfig() {
    pairConfiguredServerUrl = normalizePairBaseUrl(
      rawConfig?.channelServerBaseUrl || rawConfig?.pairServerBaseUrl || rawConfig?.pairServerUrl || ''
    );
    pairConfiguredDeviceId = String(rawConfig?.channelDeviceId || rawConfig?.pairDeviceId || '').trim();
    syncPairConfigDraftState();
    updatePairButtons();
  }

  async function savePairConfig() {
    const pairState = useDesktopShellStore.getState().pair;
    const nextBaseUrl = normalizePairBaseUrl(pairState.draftServerUrl || '');
    const nextDeviceId = String(pairState.draftDeviceId || '').trim();

    if (!nextBaseUrl) {
      setPairMessage(t('msg.pairNeedServerUrl'), 'error');
      return false;
    }

    pairConfigSaving = true;
    useDesktopShellStore.getState().setPairState({
      configSaving: true,
      draftServerUrl: nextBaseUrl
    });
    updatePairButtons();

    try {
      const latest = rawConfig || (await invoke('read_raw_config'));
      if (!latest) {
        setPairMessage(t('msg.saveFailed'), 'error');
        return false;
      }

      const payload = {
        provider: latest.provider || 'openai',
        model: latest.model || '',
        baseUrl: latest.baseUrl || '',
        apiKey: latest.apiKey || '',
        customApiMode: latest.customApiMode || '',
        customHeadersJson: latest.customHeaders ? JSON.stringify(latest.customHeaders) : '',
        openclawCommand: latest.openclawCommand || 'openclaw',
        skillsDirs: latest.skillsDirs || [],
        channelServerBaseUrl: nextBaseUrl,
        channelDeviceId: nextDeviceId
      };

      const result = await invoke('save_config', { payload });
      if (!result?.ok) {
        setPairMessage(result?.message || t('msg.saveFailed'), 'error');
        return false;
      }

      rawConfig = (await invoke('read_raw_config')) || latest;
      applyPairConfigFromRawConfig();
      const snapshot = await invoke('pair_backend_reload_config');
      applyBackendSnapshot(snapshot, { preserveDraft: false });
      setPairMessage(t('msg.pairConfigSaved'), 'success');
      return true;
    } catch (error) {
      setPairMessage(error?.message || String(error), 'error');
      return false;
    } finally {
      pairConfigSaving = false;
      useDesktopShellStore.getState().setPairState({
        configSaving: false
      });
      updatePairButtons();
    }
  }

  async function refreshPairChannelConfig() {
    try {
      rawConfig = (await invoke('read_raw_config')) || rawConfig;
      applyPairConfigFromRawConfig();
      const snapshot = await invoke('pair_backend_reload_config');
      applyBackendSnapshot(snapshot, { preserveDraft: false });
      setPairMessage(t('msg.pairConfigReloaded'), 'success');
    } catch (error) {
      setPairMessage(`刷新配置失败：${error?.message || String(error)}`, 'error');
    }
  }

  async function initSignalSubscription() {
    if (unsubscribeSignal) {
      return;
    }
    unsubscribeSignal = await listen(PAIR_EVENT_NAME, (event) => {
      applyBackendSnapshot(event?.payload, { preserveDraft: true });
    });
  }

  function initPairCenter() {
    if (!isPairCenterAvailable() || initialized) {
      return;
    }
    initialized = true;
    applyPairConfigFromRawConfig();
    renderPairWsStatus('disconnected');
    updatePairButtons();
    if (!hasPairConfig()) {
      setPairMessage(t('msg.pairMissingConfig'));
    }

    void initSignalSubscription();
    void loadBackendState({ preserveDraft: true });

    if (pairChatDraftInput) {
      pairChatDraftInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
          event.preventDefault();
          void sendPairChatMessage();
        }
      });
    }
  }

  function shutdown() {
    if (unsubscribeSignal) {
      const unlisten = unsubscribeSignal;
      unsubscribeSignal = null;
      void Promise.resolve(unlisten()).catch(() => {});
    }
  }

  useDesktopShellStore.getState().setPairActions({
    setConfigServerUrl: (value) => {
      useDesktopShellStore.getState().setPairState({
        draftServerUrl: String(value || '')
      });
    },
    setConfigDeviceId: (value) => {
      useDesktopShellStore.getState().setPairState({
        draftDeviceId: String(value || '')
      });
    },
    saveConfig: () => savePairConfig(),
    reloadConfig: () => refreshPairChannelConfig(),
    toggleChannel: async () => {
      if (pairChannelOpen) {
        await disconnectPairChannel();
        return;
      }
      await connectPairChannel();
    },
    createChannel: async () => {
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
      setActiveChatChannelId('');
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
    resetPairReconnectTimer: () => {},
    cleanupPairWebSocket: () => {},
    updatePairButtons,
    connectPairChannel,
    disconnectPairChannel,
    preparePairHandoff: async () => false,
    createPairSession,
    openPairChannelSession: () => {},
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
