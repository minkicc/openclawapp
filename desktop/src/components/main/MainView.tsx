import { useDesktopShellStore } from '../../store/useDesktopShellStore';
import { PairChannelList } from './PairChannelList';
import { I18N } from '../../legacy/i18n-catalog';

function translate(currentLang: 'zh-CN' | 'en-US', key: string, params: Record<string, unknown> = {}) {
  const dict = I18N[currentLang] || I18N['zh-CN'];
  const fallback = I18N['zh-CN'][key] || key;
  const template = dict[key] || fallback;
  return template.replace(/\{(\w+)\}/g, (_, name) => String(params[name] ?? ''));
}

function formatPairTs(ts: unknown) {
  const n = Number(ts || 0);
  if (Number.isFinite(n) && n > 0) {
    return new Date(n).toLocaleString();
  }
  return new Date().toLocaleString();
}

function PairConfigPanel() {
  const currentLang = useDesktopShellStore((state) => state.currentLang);
  const pair = useDesktopShellStore((state) => state.pair);
  const actions = useDesktopShellStore((state) => state.pairActions);
  const configured = Boolean(pair.configuredServerUrl && pair.configuredDeviceId);

  return (
    <section className={`pair-config-card ${configured ? 'is-ready' : ''}`.trim()}>
      <div className="pair-config-copy">
        <h3>{translate(currentLang, 'pair.settingsTitle')}</h3>
        <p className="hint pair-config-hint">{translate(currentLang, 'pair.settingsHint')}</p>
      </div>

      <div className="form-grid pair-config-grid">
        <label className="full-row">
          <span>{translate(currentLang, 'pair.serverUrl')}</span>
          <input
            id="pairConfigServerUrlInput"
            type="text"
            value={pair.draftServerUrl}
            placeholder={translate(currentLang, 'ph.pairServerUrl')}
            onChange={(event) => {
              actions.setConfigServerUrl(event.currentTarget.value);
            }}
          />
        </label>

        <label>
          <span>{translate(currentLang, 'pair.deviceId')}</span>
          <input
            id="pairConfigDeviceIdInput"
            type="text"
            value={pair.draftDeviceId}
            placeholder={translate(currentLang, 'ph.pairDeviceIdAuto')}
            onChange={(event) => {
              actions.setConfigDeviceId(event.currentTarget.value);
            }}
          />
          <p className="field-hint">{translate(currentLang, 'pair.deviceIdHint')}</p>
        </label>

        <div className="pair-config-meta">
          <span>{translate(currentLang, 'pair.currentConfig')}</span>
          <strong>
            {configured
              ? translate(currentLang, 'pair.currentConfigValue', {
                  url: pair.configuredServerUrl,
                  deviceId: pair.configuredDeviceId
                })
              : translate(currentLang, 'pair.currentConfigEmpty')}
          </strong>
        </div>
      </div>

      <div className="actions pair-config-actions">
        <button
          id="pairSaveConfigBtn"
          className="btn-primary"
          type="button"
          disabled={pair.configSaving}
          onClick={() => {
            void actions.saveConfig();
          }}
        >
          {pair.configSaving ? translate(currentLang, 'btn.saving') : translate(currentLang, 'btn.pairSaveConfig')}
        </button>
      </div>
    </section>
  );
}

function SummaryGrid() {
  const summary = useDesktopShellStore((state) => state.summary);

  return (
    <div className="kv summary-kv">
      <div>
        <span data-i18n="field.provider">模型提供商</span>
        <strong id="summaryProvider">{summary.provider}</strong>
      </div>
      <div>
        <span data-i18n="field.model">Model</span>
        <strong id="summaryModel">{summary.model}</strong>
      </div>
      <div>
        <span data-i18n="field.apiKeyShort">API Key</span>
        <strong id="summaryApiKey">{summary.apiKey}</strong>
      </div>
      <div>
        <span data-i18n="field.baseUrl">Base URL</span>
        <strong id="summaryBaseUrl">{summary.baseUrl}</strong>
      </div>
    </div>
  );
}

function MainHero() {
  const actions = useDesktopShellStore((state) => state.mainActions);

  return (
    <div className="main-hero">
      <div className="main-hero-copy">
        <span className="eyebrow">Communication Console</span>
        <h2 data-i18n="main.readyTitle">OpenClaw 已就绪</h2>
        <p className="hint main-hero-hint" data-i18n="main.readyHint">
          核心设置已完成，点击“开始使用”继续。
        </p>
      </div>

      <div className="actions main-hero-actions">
        <button
          id="openWebBtn"
          className="btn-primary"
          data-i18n="btn.start"
          onClick={() => {
            void actions.openWeb();
          }}
        >
          开始使用
        </button>
      </div>
    </div>
  );
}

function CommunicationPanel() {
  const currentLang = useDesktopShellStore((state) => state.currentLang);
  const pair = useDesktopShellStore((state) => state.pair);
  const actions = useDesktopShellStore((state) => state.pairActions);
  const activeChannel = pair.channels.find((channel) => channel?.channelId === pair.activeChatChannelId) || null;
  const activeMessages = Array.isArray(activeChannel?.messages) ? activeChannel.messages : [];

  return (
    <details className="advanced-block" id="pairCenterView">
      <summary data-i18n="pair.title">通信</summary>
      <div className="advanced-content pair-panel">
        <div className="pair-head">
          <p className="hint pair-hint" data-i18n="pair.hint">
            作为 Agent 宿主机，你可以开放通信通道并新建渠道。移动端扫码后会形成独立会话卡片。
          </p>
          <button
            id="pairReloadConfigBtn"
            className="btn-secondary btn-refresh"
            type="button"
            data-i18n="btn.pairReloadConfig"
            onClick={() => {
              void actions.reloadConfig();
            }}
          >
            刷新配置
          </button>
        </div>

        <PairConfigPanel />

        <div className="pair-control-grid">
          <div className="actions pair-actions">
            <button
              id="pairChannelToggleBtn"
              className={`btn-secondary pair-toggle ${pair.channelOpen ? 'is-on' : 'is-off'}`.trim()}
              type="button"
              aria-pressed={pair.channelOpen ? 'true' : 'false'}
              disabled={pair.channelToggleDisabled}
              onClick={() => {
                void actions.toggleChannel();
              }}
            >
              {pair.channelOpen ? translate(currentLang, 'pair.toggle.on') : translate(currentLang, 'pair.toggle.off')}
            </button>
            <button
              id="pairCreateChannelBtn"
              className={`btn-primary ${pair.createChannelAriaDisabled ? 'is-disabled' : ''}`.trim()}
              type="button"
              disabled={pair.createChannelDisabled}
              aria-disabled={pair.createChannelAriaDisabled ? 'true' : 'false'}
              data-i18n="btn.pairCreateChannel"
              onClick={() => {
                void actions.createChannel();
              }}
            >
              新建渠道
            </button>
          </div>

          <div className="kv pair-kv">
            <div>
              <span data-i18n="pair.wsStatus">通道状态</span>
              <strong id="pairWsStatus">{pair.wsStatus || '-'}</strong>
            </div>
            <div>
              <span data-i18n="pair.channelCount">渠道数量</span>
              <strong id="pairChannelCount">{pair.channels.length}</strong>
            </div>
          </div>
        </div>

        <p id="pairStatusMessage" className={`message ${pair.statusType || ''}`.trim()}>
          {pair.statusMessage}
        </p>

        <div className="channel-list-wrap">
          <div id="pairChannelList" className="channel-list">
            <PairChannelList />
          </div>
        </div>

        <div className="pair-log-shell">
          <pre id="pairEventLog">{pair.eventLog}</pre>
        </div>

        <dialog id="pairQrDialog" className="pair-dialog" open={pair.qrDialogOpen}>
          <div className="pair-dialog-head">
            <h3 data-i18n="pair.qrDialogTitle">渠道二维码</h3>
          </div>
          <div className="pair-qr-preview">
            <img
              id="pairQrImage"
              alt="OpenClaw Pair QR"
              src={pair.qrImageSrc || ''}
              className={pair.qrImageSrc ? '' : 'hidden'}
            />
            {!pair.qrImageSrc ? <p className="pair-empty">{translate(currentLang, 'pair.empty')}</p> : null}
          </div>
          <div className="actions bottom pair-dialog-actions">
            <button
              id="pairQrCloseBtn"
              className="btn-secondary"
              type="button"
              data-i18n="btn.close"
              onClick={() => {
                actions.closeQr();
              }}
            >
              关闭
            </button>
          </div>
        </dialog>

        <dialog id="pairChatDialog" className="pair-dialog" open={pair.chatDialogOpen}>
          <div className="pair-dialog-head">
            <h3 id="pairChatDialogTitle">{pair.chatDialogTitle || translate(currentLang, 'pair.chatDialogTitle')}</h3>
          </div>
          <div id="pairChatMessages" className="pair-chat-messages">
            {activeMessages.length === 0 ? (
              <p className="pair-empty">{translate(currentLang, 'pair.chatPlaceholder')}</p>
            ) : (
              activeMessages.map((item: any) => {
                const who =
                  item.from === 'desktop'
                    ? translate(currentLang, 'pair.chatRoleDesktop')
                    : item.from === 'agent'
                      ? translate(currentLang, 'pair.chatRoleAgent')
                      : translate(currentLang, 'pair.chatRoleMobile');
                const cls =
                  item.from === 'desktop'
                    ? 'from-desktop'
                    : item.from === 'agent'
                      ? 'from-agent'
                      : 'from-mobile';
                return (
                  <div className={`pair-chat-item ${cls}`.trim()} key={item.id || `${item.ts}-${item.text}`}>
                    <div className="pair-chat-meta">
                      {who} · {formatPairTs(item.ts)}
                    </div>
                    <div className="pair-chat-bubble">
                      <div className="pair-chat-text">{String(item.text || '')}</div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
          <label className="pair-payload">
            <span data-i18n="pair.chatDraft">发送消息</span>
            <textarea
              id="pairChatDraftInput"
              rows={3}
              data-i18n-placeholder="pair.chatDraftPlaceholder"
              value={pair.chatDraft}
              onChange={(event) => actions.setChatDraft(event.target.value)}
            />
          </label>
          <div className="actions bottom pair-dialog-actions">
            <button
              id="pairChatSendBtn"
              className="btn-primary"
              type="button"
              data-i18n="btn.pairChatSend"
              disabled={pair.chatSendDisabled}
              onClick={() => {
                void actions.sendChat();
              }}
            >
              发送
            </button>
            <button
              id="pairChatCloseBtn"
              className="btn-secondary"
              type="button"
              data-i18n="btn.close"
              onClick={() => {
                actions.closeChat();
              }}
            >
              关闭
            </button>
          </div>
        </dialog>
      </div>
    </details>
  );
}

function AdvancedInfoPanel() {
  const summary = useDesktopShellStore((state) => state.summary);
  const setSummary = useDesktopShellStore((state) => state.setSummary);
  const actions = useDesktopShellStore((state) => state.mainActions);

  return (
    <details className="advanced-block">
      <summary data-i18n="advanced.infoTitle">高级信息（可选）</summary>
      <div className="advanced-content">
        <div className="kv">
          <div>
            <span data-i18n="field.commandShort">OpenClaw Command</span>
            <strong id="summaryCommand">{summary.command}</strong>
          </div>
          <div>
            <span data-i18n="field.customApiModeShort">Custom API Mode</span>
            <select
              id="summaryCustomApiMode"
              value={summary.customApiMode}
              disabled={!summary.isCustomProvider}
              onChange={(event) => {
                const nextMode = event.currentTarget.value;
                setSummary({ customApiMode: nextMode });
                void actions.saveSummaryCustomApiMode(nextMode);
              }}
            >
              <option value="" data-i18n="customApiMode.placeholder">
                请选择 API 模式
              </option>
              <option value="openai-responses">openai-responses</option>
              <option value="openai-completions">openai-completions</option>
              <option value="anthropic-messages">anthropic-messages</option>
            </select>
          </div>
          <div>
            <span data-i18n="field.customHeadersShort">Custom Headers</span>
            <strong id="summaryCustomHeaders">{summary.customHeaders}</strong>
          </div>
          <div>
            <span data-i18n="field.kernelStatus">Kernel Status</span>
            <strong id="summaryKernel">{summary.kernelStatus}</strong>
          </div>
          <div>
            <span data-i18n="field.configPath">Config File</span>
            <strong id="summaryConfigPath">{summary.configPath}</strong>
          </div>
        </div>

        <div className="skills-block compact">
          <h3 data-i18n="skills.title">Skills Directory</h3>
          <ul id="summarySkillsList">
            {summary.skillsDirs.length === 0 ? (
              <li>
                <span data-i18n="skills.noneOptional">未配置额外技能目录</span>
              </li>
            ) : (
              summary.skillsDirs.map((dirPath) => (
                <li key={dirPath}>
                  <span>{dirPath}</span>
                </li>
              ))
            )}
          </ul>
        </div>

        <div className="actions bottom">
          <button
            id="reconfigureBtn"
            className="btn-secondary"
            data-i18n="btn.reconfigure"
            onClick={() => {
              void actions.reconfigure();
            }}
          >
            Reconfigure
          </button>
          <button
            id="doctorBtn"
            className="btn-secondary"
            data-i18n="btn.checkCommand"
            onClick={() => {
              void actions.runDoctor();
            }}
          >
            Check OpenClaw Command
          </button>
          <button
            id="updateKernelBtn"
            className="btn-secondary"
            data-i18n="btn.updateKernel"
            onClick={() => {
              void actions.updateKernel();
            }}
          >
            Update Kernel (npm)
          </button>
          <button
            id="openSkillDirBtn"
            className="btn-secondary"
            data-i18n="btn.openFirstSkillDir"
            onClick={() => {
              void actions.openFirstSkillDir();
            }}
          >
            Open First Skills Directory
          </button>
        </div>

        <pre id="doctorOutput">{summary.doctorOutput}</pre>
      </div>
    </details>
  );
}

export function MainView() {
  const viewMode = useDesktopShellStore((state) => state.viewMode);

  return (
    <section className={`card main-card ${viewMode === 'main' ? '' : 'hidden'}`.trim()} id="mainView">
      <MainHero />
      <SummaryGrid />
      <CommunicationPanel />
      <AdvancedInfoPanel />
    </section>
  );
}
