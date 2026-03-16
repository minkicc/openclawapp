// @ts-nocheck
import { syncDoctorOutputState, syncSetupFormFromElements } from './setup-form-sync';

export function createEventBinder(deps) {
  const {
    invoke,
    t,
    setSetupMessage,
    providerInput,
    providerShowAdvancedToggle,
    copyProviderAuthCmdBtn,
    apiKeyInput,
    baseUrlInput,
    commandInput,
    customApiModeInput,
    customHeadersInput,
    modelInput,
    modelDropdown,
    fetchModelsBtn,
    cloudflareAccountIdInput,
    cloudflareGatewayIdInput,
    summaryCustomApiMode,
    langSelect,
    doctorOutput,
    isPairCenterAvailable,
    isPairChannelOpen,
    isPairChannelConnecting,
    renderPairWsStatus,
    shutdownPairController,
    renderSummary,
    refreshKernelStatus,
    renderSkillsDirs,
    applyI18n,
    setCurrentLang,
    getCurrentLang,
    initProviderFilter,
    initLanguage,
    initPairCenter,
    loadState,
    addSkillDirBtn,
    addSkillDir,
    installDefaultsBtn,
    installDefaultSkills,
    saveBtn,
    saveConfigAndEnter,
    installKernelBtn,
    handleKernelInstall,
    updateKernelBtn,
    openWebBtn,
    openOpenClawWeb,
    doctorBtn,
    runDoctor,
    openSkillDirBtn,
    openFirstSkillDir,
    reconfigureBtn,
    reconfigureFromSavedConfig,
    getProviderLoginCommand,
    getActiveProviderPreset,
    setShowAdvancedProviders,
    getShowAdvancedProviders,
    isAdvancedProviderPreset,
    setActiveProviderId,
    populateProviderOptions,
    applyProviderPreset,
    setModelValue,
    renderModelSuggestions,
    resetModelFetchKey,
    isCloudflarePreset,
    defaultCustomHeadersText,
    resolveProviderBaseUrl,
    fetchModels,
    openModelDropdown,
    closeModelDropdown,
    syncCustomApiModeForCurrentModel,
    rememberCustomApiModeForCurrentModel,
    normalizeCustomApiModeByBaseUrl,
    saveSummaryCustomApiMode
  } = deps;

  function syncSetupFormState(patch = {}) {
    syncSetupFormFromElements({
      providerShowAdvancedToggle,
      providerInput,
      baseUrlInput,
      apiKeyInput,
      modelInput,
      customApiModeInput,
      customHeadersInput,
      cloudflareAccountIdInput,
      cloudflareGatewayIdInput,
      commandInput
    }, patch);
  }

  function bindSetupActionEvents() {
    openWebBtn && (openWebBtn.onclick = async () => {
      await openOpenClawWeb();
    });

    reconfigureBtn && (reconfigureBtn.onclick = async () => {
      await reconfigureFromSavedConfig();
    });

    doctorBtn && (doctorBtn.onclick = async () => {
      await runDoctor();
    });

    updateKernelBtn && (updateKernelBtn.onclick = async () => {
      await handleKernelInstall(t('btn.updateKernel'));
    });

    openSkillDirBtn && (openSkillDirBtn.onclick = async () => {
      await openFirstSkillDir();
    });
  }

  function bindProviderEvents() {
    providerShowAdvancedToggle?.addEventListener('change', () => {
      setShowAdvancedProviders(Boolean(providerShowAdvancedToggle.checked));
      localStorage.setItem('openclaw.ui.provider.showAdvanced', getShowAdvancedProviders() ? '1' : '0');
      if (!getShowAdvancedProviders() && isAdvancedProviderPreset(getActiveProviderPreset())) {
        providerInput.value = 'openai';
        setActiveProviderId('openai');
      }
      populateProviderOptions();
      applyProviderPreset(providerInput.value, { hydrate: false });
      apiKeyInput.value = '';
      setModelValue('');
      renderModelSuggestions([]);
      resetModelFetchKey();
      syncSetupFormState();
    });

    copyProviderAuthCmdBtn?.addEventListener('click', async () => {
      const command = getProviderLoginCommand(getActiveProviderPreset());
      if (!command) {
        return;
      }
      try {
        if (navigator?.clipboard?.writeText) {
          await navigator.clipboard.writeText(command);
        } else {
          throw new Error('Clipboard API unavailable');
        }
        setSetupMessage(t('msg.loginCommandCopied'), 'success');
      } catch {
        setSetupMessage(t('msg.loginCommandCopyFailed', { cmd: command }), 'error');
      }
    });

    providerInput?.addEventListener('change', async () => {
      applyProviderPreset(providerInput.value, { hydrate: false });
      const preset = getActiveProviderPreset();
      apiKeyInput.value = '';
      setModelValue('');
      if (preset.showBaseUrl && !isCloudflarePreset(preset)) {
        baseUrlInput.value = preset.baseUrlDefault || '';
      }
      if (preset.showCustomOptions) {
        customHeadersInput.value = defaultCustomHeadersText();
      }
      if (isCloudflarePreset(preset)) {
        if (cloudflareAccountIdInput) {
          cloudflareAccountIdInput.value = '';
        }
        if (cloudflareGatewayIdInput) {
          cloudflareGatewayIdInput.value = '';
        }
        resolveProviderBaseUrl(preset);
      }
      renderModelSuggestions([]);
      resetModelFetchKey();
      syncSetupFormState();
      if (preset.fetchModels && preset.runtimeProvider === 'custom' && resolveProviderBaseUrl(preset)) {
        await fetchModels({ silent: true });
      }
    });

    fetchModelsBtn?.addEventListener('click', async () => {
      await fetchModels({ force: true });
    });

    modelInput?.addEventListener('focus', () => {
      openModelDropdown();
    });

    modelInput?.addEventListener('click', () => {
      openModelDropdown();
    });

    modelInput?.addEventListener('input', () => {
      syncCustomApiModeForCurrentModel();
      syncSetupFormState();
    });

    modelInput?.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowDown') {
        openModelDropdown();
        event.preventDefault();
        return;
      }
      if (event.key === 'Escape') {
        closeModelDropdown();
      }
    });

    document.addEventListener('pointerdown', (event) => {
      const target = event.target instanceof Node ? event.target : null;
      if (!target) {
        return;
      }
      if (modelInput?.contains(target) || modelDropdown?.contains(target)) {
        return;
      }
      closeModelDropdown();
    });

    baseUrlInput?.addEventListener('blur', async () => {
      const preset = getActiveProviderPreset();
      const baseUrl = resolveProviderBaseUrl(preset);
      customApiModeInput.value = normalizeCustomApiModeByBaseUrl(baseUrl, customApiModeInput.value.trim());
      if (isCloudflarePreset(preset)) {
        resolveProviderBaseUrl(preset);
      }
      syncSetupFormState();
      await fetchModels({ silent: true, force: true });
    });

    apiKeyInput?.addEventListener('blur', async () => {
      syncSetupFormState();
      await fetchModels({ silent: true, force: true });
    });

    customApiModeInput?.addEventListener('change', async () => {
      const preset = getActiveProviderPreset();
      const baseUrl = resolveProviderBaseUrl(preset);
      customApiModeInput.value = normalizeCustomApiModeByBaseUrl(baseUrl, customApiModeInput.value.trim());
      rememberCustomApiModeForCurrentModel(preset);
      if (isCloudflarePreset(preset)) {
        resolveProviderBaseUrl(preset);
      }
      syncSetupFormState();
      await fetchModels({ silent: true, force: true });
    });

    const onCloudflareFieldChanged = async () => {
      const preset = getActiveProviderPreset();
      if (!isCloudflarePreset(preset)) {
        return;
      }
      resolveProviderBaseUrl(preset);
      syncSetupFormState();
      await fetchModels({ silent: true, force: true });
    };

    cloudflareAccountIdInput?.addEventListener('input', onCloudflareFieldChanged);
    cloudflareGatewayIdInput?.addEventListener('input', onCloudflareFieldChanged);

    customHeadersInput?.addEventListener('blur', async () => {
      syncSetupFormState();
      await fetchModels({ silent: true, force: true });
    });

    commandInput?.addEventListener('input', () => {
      syncSetupFormState();
    });

  }

  function bindPageEvents() {
    window.addEventListener('beforeunload', () => {
      shutdownPairController();
    });

    langSelect?.addEventListener('change', async () => {
      setCurrentLang(langSelect.value);
      localStorage.setItem('openclaw.ui.lang', getCurrentLang());
      applyI18n();
      if (isPairCenterAvailable()) {
        if (isPairChannelOpen()) {
          renderPairWsStatus('connected');
        } else if (isPairChannelConnecting()) {
          renderPairWsStatus('connecting');
        } else {
          renderPairWsStatus('disconnected');
        }
      }
      renderModelSuggestions([]);
      renderSkillsDirs();
      const state = await invoke('get_state');
      if (state.isConfigured && state.config) {
        const configPath = await invoke('get_config_path');
        renderSummary(state.config, configPath);
        await refreshKernelStatus();
      }
    });
  }

  function init() {
    bindSetupActionEvents();
    bindProviderEvents();
    bindPageEvents();
    initProviderFilter();
    initLanguage();
    initPairCenter();
    void loadState();
  }

  return { init };
}
