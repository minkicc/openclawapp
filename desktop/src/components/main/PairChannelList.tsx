import { useEffect, useMemo, useState } from 'react';
import { I18N } from '../../legacy/i18n-catalog';
import { useDesktopShellStore } from '../../store/useDesktopShellStore';

function t(currentLang: 'zh-CN' | 'en-US', key: string, params: Record<string, unknown> = {}) {
  const dict = I18N[currentLang] || I18N['zh-CN'];
  const fallback = I18N['zh-CN'][key] || key;
  const template = dict[key] || fallback;
  return template.replace(/\{(\w+)\}/g, (_, name) => String(params[name] ?? ''));
}

function pairNameSuffix(seed: unknown) {
  const normalized = String(seed || '')
    .trim()
    .replace(/_/g, '')
    .replace(/[^a-zA-Z0-9]/g, '');
  if (normalized) {
    return normalized.slice(-6);
  }
  return Date.now().toString().slice(-6);
}

function defaultPairChannelName(seed: unknown) {
  return `连接-${pairNameSuffix(seed)}`;
}

function resolvePairChannelNameSeed(channel: any) {
  return channel?.sessionId || channel?.mobileId || channel?.channelId;
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
        const fallbackName = defaultPairChannelName(resolvePairChannelNameSeed(channel));
        next[channel.channelId] = current[channel.channelId] ?? (String(channel?.name || '').trim() || fallbackName);
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
        const fallbackName = defaultPairChannelName(resolvePairChannelNameSeed(channel));
        const name = drafts[channel.channelId] ?? (String(channel?.name || '').trim() || fallbackName);
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

            <div className="actions channel-card-actions">
              <button className="btn-secondary" type="button" onClick={() => actions.showQr(channel.channelId)}>
                {t(currentLang, 'pair.card.openQr')}
              </button>
              <button className="btn-primary" type="button" onClick={() => actions.openChat(channel.channelId)}>
                {t(currentLang, 'pair.card.openChat')}
              </button>
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
