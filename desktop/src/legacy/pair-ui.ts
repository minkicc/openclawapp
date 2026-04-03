import { formatPairV2ConnectionName, isGeneratedPairV2ConnectionName } from '@openclaw/pair-sdk';
import { useDesktopShellStore } from '../store/useDesktopShellStore';

type PairChannel = any;
type PairMessage = any;

type PairUiDeps = {
  t: (key: string, params?: Record<string, unknown>) => string;
  pairChannels: PairChannel[];
  pairChannelList: HTMLElement | null;
  pairChannelCount: HTMLElement | null;
  pairChatMessages: HTMLElement | null;
  pairChatDialogTitle: HTMLElement | null;
  pairChatDraftInput: HTMLTextAreaElement | null;
  pairChatDialog: HTMLDialogElement | HTMLElement | null;
  getActiveChatChannelId: () => string;
  setActiveChatChannelId: (channelId: string) => void;
  updatePairButtons: () => void;
  onShowQr: (channelId: string) => Promise<void> | void;
  onDeleteChannel: (channelId: string) => Promise<void> | void;
};

export function createPairUiController(deps: PairUiDeps) {
  const {
    t,
    pairChannels,
    pairChannelList,
    pairChannelCount,
    pairChatMessages,
    pairChatDialogTitle,
    pairChatDraftInput,
    pairChatDialog,
    getActiveChatChannelId,
    setActiveChatChannelId,
    updatePairButtons,
    onShowQr,
    onDeleteChannel
  } = deps;

  function formatPairTs(ts: unknown) {
    const n = Number(ts || 0);
    if (Number.isFinite(n) && n > 0) {
      return new Date(n).toLocaleString();
    }
    return new Date().toLocaleString();
  }

  function escapePairHtml(value: unknown) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function resolvePairChannelNameSeed(channel: PairChannel) {
    return channel?.bindingId || channel?.sessionId || channel?.mobileId || channel?.channelId;
  }

  function resolvePairChannelMobileName(channel: PairChannel) {
    return String(channel?.mobileName || '').trim();
  }

  function defaultPairChannelName(channel: PairChannel) {
    return formatPairV2ConnectionName(resolvePairChannelNameSeed(channel), resolvePairChannelMobileName(channel));
  }

  function resolvePairChannelGeneratedCandidates(channel: PairChannel) {
    const mobileName = resolvePairChannelMobileName(channel);
    return [
      { seed: resolvePairChannelNameSeed(channel), mobileName },
      { seed: channel?.bindingId, mobileName },
      { seed: channel?.sessionId, mobileName },
      { seed: channel?.mobileId, mobileName },
      { seed: channel?.channelId, mobileName },
    ].filter((item) => String(item.seed || '').trim());
  }

  function normalizePairChannelName(channel: PairChannel) {
    const currentName = String(channel?.name || '').trim();
    const generatedName = defaultPairChannelName(channel);
    if (!currentName) {
      return generatedName;
    }
    if (isGeneratedPairV2ConnectionName(currentName, resolvePairChannelGeneratedCandidates(channel))) {
      return generatedName;
    }
    return currentName;
  }

  function findPairChannelById(channelId: unknown) {
    return pairChannels.find((item) => item.channelId === channelId) || null;
  }

  function findPairChannelByMobileId(mobileId: unknown) {
    const target = String(mobileId || '').trim();
    if (!target) {
      return null;
    }
    return pairChannels.find((item) => String(item.mobileId || '').trim() === target) || null;
  }

  function upsertPairChannel(channel: PairChannel) {
    const channelId = String(channel?.channelId || '').trim();
    if (!channelId) {
      return null;
    }
    const existing = findPairChannelById(channelId);
    if (existing) {
      Object.assign(existing, channel);
      existing.name = normalizePairChannelName(existing);
      if (!Array.isArray(existing.messages)) {
        existing.messages = [];
      }
      return existing;
    }
    const next = {
      channelId,
      sessionId: String(channel?.sessionId || channelId),
      name: '',
      mobileId: String(channel?.mobileId || '').trim(),
      userId: String(channel?.userId || '').trim(),
      bindingId: String(channel?.bindingId || '').trim(),
      status: String(channel?.status || 'pending'),
      createdAt: Number(channel?.createdAt || Date.now()),
      qrPayload: channel?.qrPayload || null,
      messages: Array.isArray(channel?.messages) ? channel.messages : []
    };
    next.name = normalizePairChannelName({
      ...next,
      name: String(channel?.name || '').trim()
    });
    pairChannels.push(next);
    return next;
  }

  function channelStatusLabel(status: unknown) {
    if (status === 'active') {
      return t('pair.card.statusActive');
    }
    if (status === 'offline') {
      return t('pair.card.statusOffline');
    }
    return t('pair.card.statusPending');
  }

  function syncPairStore() {
    useDesktopShellStore.getState().setPairState({
      channels: pairChannels.map((channel) => ({
        ...channel,
        messages: Array.isArray(channel?.messages) ? [...channel.messages] : []
      }))
    });
  }

  function closeDialogSafe(dialogEl: any) {
    if (!dialogEl) {
      return;
    }
    try {
      dialogEl.close();
    } catch {
      dialogEl.removeAttribute('open');
    }
  }

  function openDialogSafe(dialogEl: any) {
    if (!dialogEl) {
      return;
    }
    try {
      dialogEl.showModal();
    } catch {
      dialogEl.setAttribute('open', 'open');
    }
  }

  function renderPairChatMessages() {
    syncPairStore();
  }

  function openPairChatDialog(channelId: string) {
    const channel = findPairChannelById(channelId);
    if (!channel) {
      return;
    }
    setActiveChatChannelId(channel.channelId);
    const title = normalizePairChannelName(channel);
    useDesktopShellStore.getState().setPairState({
      activeChatChannelId: channel.channelId,
      chatDialogTitle: `${t('pair.chatDialogTitle')} · ${title}`,
      chatDraft: '',
      chatDialogOpen: true
    });
    if (pairChatDialogTitle) {
      pairChatDialogTitle.textContent = `${t('pair.chatDialogTitle')} · ${title}`;
    }
    if (pairChatDraftInput) {
      pairChatDraftInput.value = '';
    }
    renderPairChatMessages();
    openDialogSafe(pairChatDialog);
    updatePairButtons();
  }

  function renderPairChannelCards() {
    if (pairChannelCount) {
      pairChannelCount.textContent = String(pairChannels.length);
    }
    syncPairStore();
  }

  function renamePairChannel(channelId: string, nextName: string) {
    const channel = findPairChannelById(channelId);
    if (!channel) {
      return;
    }
    channel.name = String(nextName || '').trim() || normalizePairChannelName(channel);
    renderPairChannelCards();
    if (getActiveChatChannelId() === channel.channelId && pairChatDialogTitle) {
      pairChatDialogTitle.textContent = `${t('pair.chatDialogTitle')} · ${channel.name}`;
    }
    if (getActiveChatChannelId() === channel.channelId) {
      useDesktopShellStore.getState().setPairState({
        chatDialogTitle: `${t('pair.chatDialogTitle')} · ${channel.name}`
      });
    }
  }

  function removePairChannelLocal(channelId: string) {
    const normalizedId = String(channelId || '').trim();
    if (!normalizedId) {
      return null;
    }
    const index = pairChannels.findIndex((item) => item.channelId === normalizedId);
    if (index < 0) {
      return null;
    }
    const [removed] = pairChannels.splice(index, 1);
    if (getActiveChatChannelId() === normalizedId) {
      setActiveChatChannelId('');
      useDesktopShellStore.getState().setPairState({
        activeChatChannelId: '',
        chatDialogOpen: false,
        chatDialogTitle: '',
        chatDraft: ''
      });
      closeDialogSafe(pairChatDialog);
    }
    syncPairStore();
    return removed || null;
  }

  function appendPairChannelMessage(channelId: string, message: PairMessage) {
    const channel = findPairChannelById(channelId);
    if (!channel) {
      return;
    }
    if (!Array.isArray(channel.messages)) {
      channel.messages = [];
    }
    channel.messages.push({
      id: `msg_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
      from: message.from === 'desktop' ? 'desktop' : message.from === 'agent' ? 'agent' : 'mobile',
      text: String(message.text || ''),
      ts: Number(message.ts || Date.now())
    });
    if (getActiveChatChannelId() === channelId) {
      renderPairChatMessages();
    }
    syncPairStore();
  }

  useDesktopShellStore.getState().setPairActions({
    renameChannel: (channelId: string, nextName: string) => renamePairChannel(channelId, nextName),
    showQr: (channelId: string) => onShowQr(channelId),
    openChat: (channelId: string) => openPairChatDialog(channelId),
    deleteChannel: (channelId: string) => onDeleteChannel(channelId)
  });
  syncPairStore();

  return {
    formatPairTs,
    defaultPairChannelName,
    findPairChannelById,
    findPairChannelByMobileId,
    upsertPairChannel,
    channelStatusLabel,
    renderPairChannelCards,
    renamePairChannel,
    closeDialogSafe,
    openDialogSafe,
    renderPairChatMessages,
    openPairChatDialog,
    removePairChannelLocal,
    appendPairChannelMessage
  };
}
