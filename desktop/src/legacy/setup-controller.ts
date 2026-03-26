// @ts-nocheck
import { invoke as defaultInvoke } from '@tauri-apps/api/tauri';
import { useDesktopShellStore } from '../store/useDesktopShellStore';
import { isMacDesktopShell, navigateCurrentWindowToOpenClaw } from './openclaw-session';
import { syncDoctorOutputState, syncSetupFormFromElements, syncSetupMessageState } from './setup-form-sync';

export function createSetupController(deps) {
  const {
    setupMessage,
    doctorOutput,
    platformBadge,
    providerInput,
    modelInput,
    apiKeyInput,
    baseUrlInput,
    commandInput,
    customApiModeInput,
    customHeadersInput,
    cloudflareAccountIdInput,
    cloudflareGatewayIdInput,
    summaryCustomApiMode,
    t,
    invoke = defaultInvoke,
    openDialog,
    openPath,
    getRawConfig,
    setRawConfig,
    getSkillsDirs,
    setSkillsDirs,
    setProviderRawConfig,
    setPairRawConfig,
    applyPairConfigFromRawConfig,
    hasPairConfig,
    isPairCenterAvailable,
    setPairMessage,
    preparePairHandoff = async () => false,
    updatePairButtons,
    detectProviderPresetId,
    applyProviderPreset,
    getActiveProviderPreset,
    setModelValue,
    resolveProviderBaseUrl,
    defaultCustomHeadersText,
    rememberCustomApiModeForCurrentModel,
    syncCustomApiModeForCurrentModel,
    resolveFallbackApiKeyForPreset,
    fetchModels,
    resetModelFetchKey,
    renderModelSuggestions,
    hydrateCloudflareInputsFromBaseUrl,
    refreshCustomInputs,
    refreshKernelStatus,
    getKernelStatus,
    renderSummary,
    showMain,
    showSetup,
    isCloudflarePreset,
    isManagedAuthPreset,
    normalizeCustomApiModeByBaseUrl
  } = deps;

  function setSetupMessage(message, type = '') {
    if (!setupMessage) {
      return;
    }
    setupMessage.textContent = message || '';
    setupMessage.className = `message ${type}`.trim();
    syncSetupMessageState(message || '', type);
  }

  function setDoctorOutput(message = '') {
    const text = String(message || '');
    if (doctorOutput) {
      doctorOutput.textContent = text;
    }
    syncDoctorOutputState(text);
  }

  function syncSetupFormState(patch = {}) {
    syncSetupFormFromElements({
      providerInput,
      apiKeyInput,
      baseUrlInput,
      modelInput,
      customApiModeInput,
      customHeadersInput,
      cloudflareAccountIdInput,
      cloudflareGatewayIdInput,
      commandInput
    }, patch);
  }

  function dedupeSkillsDirs(paths) {
    const seen = new Set();
    const next = [];
    for (const item of Array.isArray(paths) ? paths : []) {
      const normalized = String(item || '').trim();
      if (!normalized || seen.has(normalized)) {
        continue;
      }
      seen.add(normalized);
      next.push(normalized);
    }
    return next;
  }

  async function syncPairConfigState(rawConfig) {
    setPairRawConfig(rawConfig || null);
    applyPairConfigFromRawConfig();
    if (!isPairCenterAvailable()) {
      return;
    }
    setPairMessage(hasPairConfig() ? '' : t('msg.pairMissingConfig'), '');
    updatePairButtons();
  }

  async function hydrateSetupForm(nextRawConfig, { hydrateApiKey = false } = {}) {
    setRawConfig(nextRawConfig || null);
    setProviderRawConfig(nextRawConfig || null);
    await syncPairConfigState(nextRawConfig || null);

    const presetId = detectProviderPresetId(nextRawConfig || {});
    providerInput.value = presetId;
    applyProviderPreset(presetId, { hydrate: true });
    const preset = getActiveProviderPreset();

    setModelValue(nextRawConfig?.model || '');
    baseUrlInput.value = preset.showBaseUrl
      ? nextRawConfig?.baseUrl || preset.baseUrlDefault || ''
      : '';
    commandInput.value = nextRawConfig?.openclawCommand || 'openclaw';

    const nextCustomApiMode = preset.showCustomOptions
      ? normalizeCustomApiModeByBaseUrl(
          baseUrlInput.value,
          nextRawConfig?.customApiMode || ''
        )
      : '';
    customApiModeInput.value = nextCustomApiMode;
    if (preset.showCustomOptions && nextCustomApiMode) {
      rememberCustomApiModeForCurrentModel(preset);
    } else if (preset.showCustomOptions) {
      syncCustomApiModeForCurrentModel();
    }

    if (preset.showCustomOptions && nextRawConfig?.customHeaders && Object.keys(nextRawConfig.customHeaders).length > 0) {
      customHeadersInput.value = JSON.stringify(nextRawConfig.customHeaders, null, 2);
    } else if (preset.showCustomOptions) {
      customHeadersInput.value = defaultCustomHeadersText();
    } else {
      customHeadersInput.value = '';
    }

    if (isCloudflarePreset(preset)) {
      hydrateCloudflareInputsFromBaseUrl(baseUrlInput.value.trim());
      baseUrlInput.value = resolveProviderBaseUrl(preset);
    }

    apiKeyInput.value = hydrateApiKey ? nextRawConfig?.apiKey || '' : '';
    setSkillsDirs(dedupeSkillsDirs(nextRawConfig?.skillsDirs || []));
    refreshCustomInputs();
    renderModelSuggestions([]);
    resetModelFetchKey();
    syncSetupFormState();

    if (preset.fetchModels && preset.runtimeProvider === 'custom' && resolveProviderBaseUrl(preset)) {
      await fetchModels({ silent: true });
    }
  }

  async function loadState() {
    const state = await invoke('get_state');
    const platformText = `${state.platform} | v${state.version}`;
    useDesktopShellStore.getState().setPlatformBadge(platformText);
    if (platformBadge) {
      platformBadge.textContent = platformText;
    }

    if (state.isConfigured && state.config) {
      const latestRawConfig = await invoke('read_raw_config');
      setRawConfig(latestRawConfig || null);
      setProviderRawConfig(latestRawConfig || null);
      await syncPairConfigState(latestRawConfig || null);
      const configPath = await invoke('get_config_path');
      renderSummary(state.config, configPath);
      await refreshKernelStatus();
      showMain();
      syncSetupFormState();
      return;
    }

    await hydrateSetupForm(state.config || null, { hydrateApiKey: false });
    await refreshKernelStatus();
    showSetup();
  }

  async function addSkillDir() {
    const selected = await openDialog({
      directory: true,
      multiple: false,
      title: t('dialog.selectSkillsDir')
    });

    if (!selected || Array.isArray(selected)) {
      return false;
    }

    setSkillsDirs(dedupeSkillsDirs([...getSkillsDirs(), selected]));
    return true;
  }

  async function installDefaultSkills() {
    let targetDir = getSkillsDirs()[0];
    if (!targetDir) {
      const selected = await openDialog({
        directory: true,
        multiple: false,
        title: t('dialog.selectDefaultSkillsTarget')
      });
      if (!selected || Array.isArray(selected)) {
        return false;
      }
      targetDir = selected;
      setSkillsDirs(dedupeSkillsDirs([...getSkillsDirs(), targetDir]));
    }

    setSetupMessage(t('msg.importingSkills'));
    const result = await invoke('install_default_skills', { targetDir });
    if (!result.ok) {
      setSetupMessage(result.message || t('msg.importFailed'), 'error');
      return false;
    }

    setSetupMessage(t('msg.importedSkills', { path: result.copiedTo }), 'success');
    return true;
  }

  async function openOpenClawWeb() {
    const result = await invoke(isMacDesktopShell() ? 'get_dashboard_url' : 'open_dashboard_window');
    if (!result.ok) {
      const detail = (result.detail || '').trim();
      const message = `${result.message}${detail ? `\n\n${detail}` : ''}`.trim();
      setSetupMessage(result.message || t('msg.enterWebFailed'), 'error');
      setDoctorOutput(message);
      return false;
    }

    const url = (result.detail || '').trim();
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      setSetupMessage(t('msg.invalidDashboardUrl'), 'error');
      setDoctorOutput(url || t('msg.noDashboardUrl'));
      return false;
    }

    if (isMacDesktopShell()) {
      navigateCurrentWindowToOpenClaw(url);
      return true;
    }

    setSetupMessage(t('msg.enteringWeb'), 'success');
    setDoctorOutput(t('msg.openclawWeb', { url }));
    return true;
  }

  async function saveConfigAndEnter() {
    const preset = getActiveProviderPreset();
    const fallbackApiKey = resolveFallbackApiKeyForPreset(preset);
    let apiKey = apiKeyInput.value.trim() || fallbackApiKey || '';
    const model = modelInput.value.trim();
    let baseUrl = resolveProviderBaseUrl(preset);
    const provider = preset.runtimeProvider;

    if (isCloudflarePreset(preset)) {
      const accountId = String(cloudflareAccountIdInput?.value || '').trim();
      const gatewayId = String(cloudflareGatewayIdInput?.value || '').trim();
      if (!accountId) {
        setSetupMessage(t('msg.cloudflareAccountIdRequired'), 'error');
        return false;
      }
      if (!gatewayId) {
        setSetupMessage(t('msg.cloudflareGatewayIdRequired'), 'error');
        return false;
      }
      baseUrl = resolveProviderBaseUrl(preset);
    }

    const customApiMode = normalizeCustomApiModeByBaseUrl(baseUrl, customApiModeInput.value.trim());
    const customHeadersJson = preset.showCustomOptions ? customHeadersInput.value.trim() : '';

    if (!model) {
      setSetupMessage(t('msg.modelRequired'), 'error');
      return false;
    }

    if (preset.showCustomOptions && !customApiMode) {
      setSetupMessage(t('msg.customApiModeRequired'), 'error');
      return false;
    }

    if (isManagedAuthPreset(preset)) {
      setSetupMessage(t('msg.authChecking'));
      const authResult = await invoke('check_provider_auth', {
        provider: preset.runtimeProvider || preset.id
      });
      if (!authResult?.ok) {
        setSetupMessage(authResult?.message || t('msg.authNotReady'), 'error');
        setDoctorOutput(authResult?.detail || '');
        return false;
      }
    }

    if (preset.showBaseUrl && preset.baseUrlRequired && !baseUrl) {
      setSetupMessage(t('msg.baseUrlRequiredForProvider'), 'error');
      return false;
    }

    if (!apiKey && !preset.keyRequired) {
      apiKey = preset.autoApiKey || 'local';
    }
    if (!apiKey && preset.keyRequired) {
      setSetupMessage(t('msg.apiKeyRequiredForProvider'), 'error');
      return false;
    }

    if (provider === 'custom' && preset.showCustomOptions && customHeadersJson) {
      try {
        const parsed = JSON.parse(customHeadersJson);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          throw new Error(t('msg.headersMustObject'));
        }
        for (const [key, value] of Object.entries(parsed)) {
          if (typeof value !== 'string') {
            throw new Error(t('msg.headerValueMustString', { key }));
          }
        }
      } catch (error) {
        setSetupMessage(t('msg.headersJsonInvalid', { detail: error.message }), 'error');
        return false;
      }
    }

    const payload = {
      provider,
      model,
      baseUrl: preset.showBaseUrl ? baseUrl : '',
      apiKey,
      customApiMode: preset.showCustomOptions ? customApiMode : '',
      customHeadersJson: preset.showCustomOptions ? customHeadersJson : '',
      openclawCommand: commandInput.value,
      skillsDirs: getSkillsDirs()
    };

    setSetupMessage(t('msg.savingConfig'));
    const result = await invoke('save_config', { payload });

    if (!result.ok) {
      setSetupMessage(result.message || t('msg.saveFailed'), 'error');
      return false;
    }

    rememberCustomApiModeForCurrentModel(preset);

    setSetupMessage(t('msg.saveSuccess'));
    await refreshKernelStatus();
    const cmd = (commandInput.value || '').trim().toLowerCase();
    const shouldAutoInstallKernel = !getKernelStatus()?.installed && (!cmd || cmd === 'openclaw');
    if (shouldAutoInstallKernel) {
      setSetupMessage(t('msg.autoInstallingKernel'));
      const kernelResult = await invoke('install_or_update_kernel');
      if (!kernelResult.ok) {
        setSetupMessage(t('msg.autoKernelFailed', { message: kernelResult.message }), 'error');
      } else {
        setSetupMessage(t('msg.configAndKernelReady'), 'success');
      }
    } else {
      setSetupMessage(t('msg.enteringApp'), 'success');
    }

    const opened = await openOpenClawWeb();
    if (!opened) {
      await loadState();
    }
    return true;
  }

  async function handleKernelInstall(buttonLabel) {
    setSetupMessage(t('msg.runningAction', { label: buttonLabel }));
    const result = await invoke('install_or_update_kernel');
    if (!result.ok) {
      setSetupMessage(t('msg.actionFailed', { label: buttonLabel, message: result.message }), 'error');
      setDoctorOutput(`${result.message}\n\n${result.detail || ''}`.trim());
      await refreshKernelStatus();
      return false;
    }

    setSetupMessage(result.message || t('msg.actionCompleted', { label: buttonLabel }), 'success');
    setDoctorOutput(`${result.message}\n\n${result.detail || ''}`.trim());
    await refreshKernelStatus();
    return true;
  }

  async function runDoctor() {
    setDoctorOutput(t('msg.checkingCommand'));
    const result = await invoke('run_doctor');
    setDoctorOutput(`${result.message}\n\n${result.detail || ''}`.trim());
  }

  async function openFirstSkillDir() {
    const state = await invoke('get_state');
    const firstSkillDir = state?.config?.skillsDirs?.[0];
    if (!firstSkillDir) {
      setDoctorOutput(t('msg.noSkillDirToOpen'));
      return false;
    }

    await openPath(firstSkillDir);
    return true;
  }

  async function reconfigureFromSavedConfig() {
    const nextRawConfig = await invoke('read_raw_config');
    await hydrateSetupForm(nextRawConfig || null, { hydrateApiKey: true });
    setSetupMessage('');
    showSetup();
    return true;
  }

  async function saveSummaryCustomApiMode(nextMode) {
    const modeValue = typeof nextMode === 'string'
      ? nextMode
      : (summaryCustomApiMode instanceof HTMLSelectElement ? summaryCustomApiMode.value || '' : '');

    if (!modeValue && !(summaryCustomApiMode instanceof HTMLSelectElement)) {
      return false;
    }

    const current = await invoke('read_raw_config');
    if (!current) {
      return false;
    }
    if (String(current.provider || '').trim().toLowerCase() !== 'custom') {
      return false;
    }

    const summaryMode = normalizeCustomApiModeByBaseUrl(
      current.baseUrl || '',
      modeValue
    );
    if (!summaryMode) {
      setDoctorOutput(t('msg.customApiModeRequired'));
      return false;
    }

    const payload = {
      provider: current.provider || 'custom',
      model: current.model || '',
      baseUrl: current.baseUrl || '',
      apiKey: current.apiKey || '',
      customApiMode: summaryMode,
      customHeadersJson: current.customHeaders ? JSON.stringify(current.customHeaders) : '',
      openclawCommand: current.openclawCommand || 'openclaw',
      skillsDirs: current.skillsDirs || []
    };

    const result = await invoke('save_config', { payload });
    if (!result.ok) {
      setDoctorOutput(result.message || t('msg.saveFailed'));
      return false;
    }

    const state = await invoke('get_state');
    if (state.isConfigured && state.config) {
      const configPath = await invoke('get_config_path');
      renderSummary(state.config, configPath);
    }
    setDoctorOutput(t('msg.saveSuccess'));
    return true;
  }

  return {
    setSetupMessage,
    dedupeSkillsDirs,
    hydrateSetupForm,
    loadState,
    addSkillDir,
    installDefaultSkills,
    saveConfigAndEnter,
    handleKernelInstall,
    openOpenClawWeb,
    runDoctor,
    openFirstSkillDir,
    reconfigureFromSavedConfig,
    saveSummaryCustomApiMode
  };
}
