import { useEffect, useMemo, useState } from 'react';
import { formatPairV2ConnectionName, isGeneratedPairV2ConnectionName } from '@openclaw/pair-sdk';
import { I18N } from '../../legacy/i18n-catalog';
import { useDesktopShellStore } from '../../store/useDesktopShellStore';

function t(currentLang: 'zh-CN' | 'en-US', key: string, params: Record<string, unknown> = {}) {
  const dict = I18N[currentLang] || I18N['zh-CN'];
  const fallback = I18N['zh-CN'][key] || key;
  const template = dict[key] || fallback;
  return template.replace(/\{(\w+)\}/g, (_, name) => String(params[name] ?? ''));
}

function resolvePairChannelNameSeed(channel: any) {
  return channel?.bindingId || channel?.sessionId || channel?.mobileId || channel?.channelId;
}

function resolvePairChannelMobileName(channel: any) {
  return String(channel?.mobileName || '').trim();
}

function resolvePairChannelGeneratedCandidates(channel: any) {
  const mobileName = resolvePairChannelMobileName(channel);
  return [
    { seed: resolvePairChannelNameSeed(channel), mobileName },
    { seed: channel?.bindingId, mobileName },
    { seed: channel?.sessionId, mobileName },
    { seed: channel?.mobileId, mobileName },
    { seed: channel?.channelId, mobileName },
  ].filter((item) => String(item.seed || '').trim());
}

function defaultPairChannelName(channel: any) {
  return formatPairV2ConnectionName(resolvePairChannelNameSeed(channel), resolvePairChannelMobileName(channel));
}

function normalizePairChannelName(channel: any, currentName?: string) {
  const generatedName = defaultPairChannelName(channel);
  const normalizedCurrent = String(currentName ?? channel?.name ?? '').trim();
  if (!normalizedCurrent) {
    return generatedName;
  }
  if (isGeneratedPairV2ConnectionName(normalizedCurrent, resolvePairChannelGeneratedCandidates(channel))) {
    return generatedName;
  }
  return normalizedCurrent;
}

function formatPairTs(ts: unknown) {
  const n = Number(ts || 0);
  if (Number.isFinite(n) && n > 0) {
    return new Date(n).toLocaleString();
  }
  return new Date().toLocaleString();
}

function statusLabel(currentLang: 'zh-CN' | 'en-US', status: string) {
  if (status === 'active') {
    return t(currentLang, 'pair.card.statusActive');
  }
  if (status === 'offline') {
    return t(currentLang, 'pair.card.statusOffline');
  }
  return t(currentLang, 'pair.card.statusPending');
}

function peerStateLabel(currentLang: 'zh-CN' | 'en-US', state: string) {
  if (state === 'connected') {
    return t(currentLang, 'pair.card.peerConnected');
  }
  if (state === 'connecting' || state === 'channel-open' || state === 'verifying') {
    return t(currentLang, 'pair.card.peerConnecting');
  }
  return t(currentLang, 'pair.card.peerDisconnected');
}

export function PairChannelList() {
  const currentLang = useDesktopShellStore((state) => state.currentLang);
  const channels = useDesktopShellStore((state) => state.pair.channels);
  const actions = useDesktopShellStore((state) => state.pairActions);
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const sortedChannels = useMemo(
    () => [...channels].sort((a, b) => Number(b?.createdAt || 0) - Number(a?.createdAt || 0)),
    [channels]
  );

  useEffect(() => {
    setDrafts((current) => {
      const next: Record<string, string> = {};
      for (const channel of sortedChannels) {
        next[channel.channelId] = normalizePairChannelName(channel, current[channel.channelId]);
      }
      return next;
    });
  }, [sortedChannels]);

  const commitRename = (channelId: string) => {
    const nextName = String(drafts[channelId] || '').trim();
    actions.renameChannel(channelId, nextName);
  };

  if (sortedChannels.length === 0) {
    return <p className="pair-empty">{t(currentLang, 'pair.empty')}</p>;
  }

  return (
    <>
      {sortedChannels.map((channel) => {
        const mobileId = String(channel?.mobileId || '').trim() || '-';
        const name = drafts[channel.channelId] ?? normalizePairChannelName(channel);
        const channelStatus = String(channel?.status || 'pending');
        const statusClass =
          channelStatus === 'active' ? 'is-active' : channelStatus === 'offline' ? 'is-offline' : 'is-pending';

        return (
          <article className="channel-card" data-channel-id={channel.channelId} data-channel-status={channelStatus} key={channel.channelId}>
            <div className="channel-card-head">
              <div className="channel-card-title">
                <span className="channel-card-label">{t(currentLang, 'pair.card.name')}</span>
                <input
                  className="channel-name-input"
                  type="text"
                  value={name}
                  onChange={(event) => {
                    const nextValue = event.target.value;
                    setDrafts((current) => ({
                      ...current,
                      [channel.channelId]: nextValue
                    }));
                  }}
                  onBlur={() => {
                    commitRename(channel.channelId);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      commitRename(channel.channelId);
                      (event.target as HTMLInputElement).blur();
                    }
                  }}
                />
              </div>
              <span className={`channel-status-pill ${statusClass}`.trim()}>{statusLabel(currentLang, channelStatus)}</span>
            </div>

            <div className="channel-card-grid">
              <div>
                <span>{t(currentLang, 'pair.card.id')}</span>
                <strong className="channel-mono">{channel.channelId}</strong>
              </div>
              <div>
                <span>{t(currentLang, 'pair.card.mobile')}</span>
                <strong className="channel-mono">{mobileId}</strong>
              </div>
              <div>
                <span>{t(currentLang, 'pair.card.createdAt')}</span>
                <strong>{formatPairTs(channel?.createdAt)}</strong>
              </div>
              <div>
                <span>{t(currentLang, 'pair.card.status')}</span>
                <strong>{statusLabel(currentLang, channelStatus)}</strong>
              </div>
            </div>

            {String(channel?.safetyCode || '').trim() ? (
              <div className="channel-card-note">
                <span>{t(currentLang, 'pair.card.safetyCode')}</span>
                <strong className="channel-mono">{String(channel.safetyCode)}</strong>
                {channelStatus === 'pending' ? (
                  <p>{t(currentLang, 'pair.card.pendingHint')}</p>
                ) : (
                  <p>{peerStateLabel(currentLang, String(channel?.peerState || 'idle'))}</p>
                )}
              </div>
            ) : null}

            <div className="actions channel-card-actions">
              <button className="btn-secondary" type="button" onClick={() => actions.showQr(channel.channelId)}>
                {t(currentLang, 'pair.card.openQr')}
              </button>
              <button className="btn-primary" type="button" onClick={() => actions.openChat(channel.channelId)}>
                {t(currentLang, 'pair.card.openChat')}
              </button>
              {channelStatus === 'pending' && String(channel?.bindingId || '').trim() ? (
                <button className="btn-primary" type="button" onClick={() => actions.approveChannel(channel.channelId)}>
                  {t(currentLang, 'pair.card.approve')}
                </button>
              ) : null}
              <button className="btn-secondary btn-danger-ghost" type="button" onClick={() => actions.deleteChannel(channel.channelId)}>
                {t(currentLang, 'pair.card.delete')}
              </button>
            </div>
          </article>
        );
      })}
    </>
  );
}
