import { useDesktopShellStore } from '../../store/useDesktopShellStore';

function SetupAdvancedBlock() {
  const guide = useDesktopShellStore((state) => state.providerGuide);
  const form = useDesktopShellStore((state) => state.setupForm);
  const setSetupForm = useDesktopShellStore((state) => state.setSetupForm);
  const setupActions = useDesktopShellStore((state) => state.setupActions);

  return (
    <details className="advanced-block full-row">
      <summary data-i18n="advanced.title">高级选项（可选）</summary>
      <div className="advanced-content">
        <div className="form-grid">
          <label>
            <span data-i18n="field.command">OpenClaw Command</span>
            <input
              id="commandInput"
              type="text"
              value={form.command}
              onChange={(event) => {
                setSetupForm({ command: event.currentTarget.value });
              }}
              placeholder="openclaw"
            />
          </label>
          <label className="full-row" id="customHeadersField" style={{ display: guide.customHeadersVisible ? '' : 'none' }}>
            <span data-i18n="field.customHeaders">Custom Headers（JSON，仅 Custom）</span>
            <textarea
              id="customHeadersInput"
              value={form.customHeaders}
              onChange={(event) => {
                setSetupForm({ customHeaders: event.currentTarget.value });
              }}
              placeholder='{"x-api-key":"..."}'
            />
          </label>
        </div>

        <div className="skills-block">
          <div className="skills-header">
            <h3 data-i18n="skills.title">Skills Directory</h3>
            <div className="actions">
              <button
                id="addSkillDirBtn"
                className="btn-secondary"
                type="button"
                data-i18n="btn.addSkillDir"
                onClick={() => {
                  void setupActions.addSkillDir();
                }}
              >
                Add Skills Directory
              </button>
              <button
                id="installDefaultsBtn"
                className="btn-secondary"
                type="button"
                data-i18n="btn.importDefaultSkills"
                onClick={() => {
                  void setupActions.installDefaultSkills();
                }}
              >
                Import Default Skills
              </button>
            </div>
          </div>
          <ul id="skillsList">
            {form.skillsDirs.length === 0 ? (
              <li>
                <span data-i18n="skills.noneConfigured">未配置技能目录</span>
              </li>
            ) : (
              form.skillsDirs.map((dirPath) => (
                <li key={dirPath}>
                  <span>{dirPath}</span>
                  <button
                    className="remove-btn"
                    type="button"
                    onClick={() => {
                      setupActions.removeSkillDir(dirPath);
                    }}
                    data-i18n="skills.remove"
                  >
                    删除
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>

        <div className="actions bottom">
          <button
            id="installKernelBtn"
            className="btn-secondary"
            type="button"
            data-i18n="btn.installKernel"
            onClick={() => {
              void setupActions.installKernel();
            }}
          >
            安装/更新 OpenClaw 内核
          </button>
        </div>
      </div>
    </details>
  );
}

export function SetupView() {
  const viewMode = useDesktopShellStore((state) => state.viewMode);
  const guide = useDesktopShellStore((state) => state.providerGuide);
  const form = useDesktopShellStore((state) => state.setupForm);
  const setSetupForm = useDesktopShellStore((state) => state.setSetupForm);
  const setupActions = useDesktopShellStore((state) => state.setupActions);

  return (
    <section className={`card setup-card ${viewMode === 'setup' ? '' : 'hidden'}`.trim()} id="setupView">
      <h2 data-i18n="setup.title">配置 OpenClaw（核心项）</h2>
      <p className="hint" data-i18n="setup.hint">
        先选择模型提供商，再按提示填写必填项即可。
      </p>

      <div className="form-grid">
        <label className="full-row provider-advanced-toggle">
          <input
            id="providerShowAdvancedToggle"
            type="checkbox"
            checked={form.showAdvancedProviders}
            onChange={(event) => {
              setSetupForm({ showAdvancedProviders: event.currentTarget.checked });
            }}
          />
          <span data-i18n="provider.showAdvanced">显示高级提供商（OAuth/云凭据）</span>
        </label>
        <label className="full-row" id="providerField">
          <span data-i18n="field.provider">模型提供商</span>
          <select
            id="providerInput"
            value={form.providerId}
            onChange={(event) => {
              setSetupForm({ providerId: event.currentTarget.value });
            }}
          />
        </label>

        <article className="provider-guide full-row" id="providerGuide">
          <p id="providerDescription">{guide.description}</p>
          <div className="chips" id="providerRequiredList">
            {guide.requiredFields.map((item) => (
              <span className="chip" key={item}>
                {item}
              </span>
            ))}
          </div>
          <div className="chips subtle" id="providerTips">
            {guide.tips.map((item) => (
              <span className="chip subtle" key={item}>
                {item}
              </span>
            ))}
          </div>
          <div className="provider-auth-notice" id="providerAuthNotice" style={{ display: guide.authNoticeVisible ? '' : 'none' }}>
            <p id="providerAuthHint">{guide.authHint}</p>
            <button
              id="copyProviderAuthCmdBtn"
              className="btn-secondary"
              type="button"
              data-i18n="btn.copyLoginCommand"
              style={{ display: guide.copyAuthVisible ? '' : 'none' }}
            >
              复制登录命令
            </button>
          </div>
          <a
            id="providerDocsLink"
            target="_blank"
            rel="noreferrer noopener"
            href={guide.docsHref}
          >
            {guide.docsText}
          </a>
        </article>

        <label id="baseUrlField" style={{ display: guide.baseUrlVisible ? '' : 'none' }}>
          <span id="baseUrlLabel" data-i18n="field.baseUrl">
            Base URL
          </span>
          <input
            id="baseUrlInput"
            type="text"
            value={form.baseUrl}
            onChange={(event) => {
              setSetupForm({ baseUrl: event.currentTarget.value });
            }}
            placeholder="例如 https://api.openai.com/v1"
            data-i18n-placeholder="ph.baseUrl"
          />
          <p className="field-hint" id="baseUrlHint">
            {guide.baseUrlHint}
          </p>
        </label>

        <div className="full-row cloudflare-fields" id="cloudflareFields" style={{ display: guide.cloudflareVisible ? '' : 'none' }}>
          <label>
            <span data-i18n="field.cloudflareAccountId">Cloudflare Account ID</span>
            <input
              id="cloudflareAccountIdInput"
              type="text"
              value={form.cloudflareAccountId}
              onChange={(event) => {
                setSetupForm({ cloudflareAccountId: event.currentTarget.value });
              }}
              placeholder="Cloudflare Account ID"
              data-i18n-placeholder="ph.cloudflareAccountId"
            />
          </label>
          <label>
            <span data-i18n="field.cloudflareGatewayId">Cloudflare Gateway ID</span>
            <input
              id="cloudflareGatewayIdInput"
              type="text"
              value={form.cloudflareGatewayId}
              onChange={(event) => {
                setSetupForm({ cloudflareGatewayId: event.currentTarget.value });
              }}
              placeholder="Cloudflare Gateway ID"
              data-i18n-placeholder="ph.cloudflareGatewayId"
            />
          </label>
        </div>

        <label id="apiKeyField">
          <span id="apiKeyLabel">{guide.apiKeyLabel}</span>
          <input
            id="apiKeyInput"
            type="password"
            value={form.apiKey}
            onChange={(event) => {
              setSetupForm({ apiKey: event.currentTarget.value });
            }}
            placeholder="必填"
            data-i18n-placeholder="ph.required"
          />
          <p className="field-hint" id="apiKeyHint">
            {guide.apiKeyHint}
          </p>
        </label>

        <label id="customApiModeField" style={{ display: guide.customApiModeVisible ? '' : 'none' }}>
          <span data-i18n="field.customApiMode">Custom API 模式（仅 Custom）</span>
          <select
            id="customApiModeInput"
            value={form.customApiMode}
            onChange={(event) => {
              setSetupForm({ customApiMode: event.currentTarget.value });
            }}
          >
            <option value="" data-i18n="customApiMode.placeholder">
              请选择 API 模式
            </option>
            <option value="openai-responses">openai-responses</option>
            <option value="openai-completions">openai-completions</option>
            <option value="anthropic-messages">anthropic-messages</option>
          </select>
        </label>

        <label className="full-row" id="modelField">
          <span id="modelLabel" data-i18n="field.model">
            Model
          </span>
          <div className="inline-row">
            <div className="model-input-wrap">
              <input
                id="modelInput"
                type="text"
                list="modelSuggestions"
                value={form.model}
                onChange={(event) => {
                  setSetupForm({ model: event.currentTarget.value });
                }}
              />
              <datalist id="modelSuggestions" />
              <div id="modelDropdown" className="model-dropdown hidden" />
            </div>
            <button
              id="fetchModelsBtn"
              className="btn-secondary"
              type="button"
              data-i18n="btn.fetchModels"
              style={{ display: guide.fetchModelsVisible ? '' : 'none' }}
              disabled={guide.fetchModelsDisabled}
            >
              拉取模型
            </button>
          </div>
          <p className="field-hint" id="modelHint">
            {guide.modelHint}
          </p>
        </label>

        <SetupAdvancedBlock />
      </div>

      <div className="actions bottom">
        <button
          id="saveBtn"
          className="btn-primary"
          data-i18n="btn.start"
          onClick={() => {
            void setupActions.saveAndEnter();
          }}
        >
          开始使用
        </button>
      </div>

      <p id="setupMessage" className={`message ${form.setupMessageType || ''}`.trim()}>
        {form.setupMessage}
      </p>
    </section>
  );
}
