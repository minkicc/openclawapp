// @ts-nocheck
import { invoke } from '@tauri-apps/api/tauri';
import { open as openDialog } from '@tauri-apps/api/dialog';
import { open as openPath } from '@tauri-apps/api/shell';
import {
  getProviderLoginCommand,
  isAdvancedProviderPreset,
  isCloudflarePreset,
  isManagedAuthPreset,
  normalizeCustomApiModeByBaseUrl
} from './legacy/provider-presets';
import { createPairUiController } from './legacy/pair-ui';
import { createProviderController } from './legacy/provider-controller';
import { createPairController } from './legacy/pair-controller';
import { createShellController } from './legacy/shell-controller';
import { createSetupController } from './legacy/setup-controller';
import { collectLegacyDomRefs } from './legacy/dom-refs';
import { createEventBinder } from './legacy/event-binder';
import { registerMainStoreActions, registerSetupStoreActions } from './legacy/register-store-actions';
import { useDesktopShellStore } from './store/useDesktopShellStore';

let __openclawLegacyBootstrapped = false;

export function bootstrapLegacyApp() {
  if (__openclawLegacyBootstrapped) {
    return;
  }
  __openclawLegacyBootstrapped = true;
  const {
    setupView,
    mainView,
    providerInput,
    providerDescription,
    providerRequiredList,
    providerTips,
    providerDocsLink,
    providerShowAdvancedToggle,
    providerAuthNotice,
    providerAuthHint,
    copyProviderAuthCmdBtn,
    baseUrlField,
    apiKeyField,
    customApiModeField,
    customHeadersField,
    modelInput,
    modelSuggestions,
    modelDropdown,
    apiKeyInput,
    baseUrlInput,
    cloudflareFields,
    cloudflareAccountIdInput,
    cloudflareGatewayIdInput,
    baseUrlHint,
    apiKeyLabel,
    apiKeyHint,
    modelHint,
    commandInput,
    customApiModeInput,
    customHeadersInput,
    fetchModelsBtn,
    skillsList,
    summarySkillsList,
    setupMessage,
    doctorOutput,
    platformBadge,
    kernelVersionBadge,
    summaryProvider,
    summaryModel,
    summaryApiKey,
    summaryBaseUrl,
    summaryCommand,
    summaryCustomApiMode,
    summaryCustomHeaders,
    summaryKernel,
    summaryConfigPath,
    addSkillDirBtn,
    installDefaultsBtn,
    saveBtn,
    installKernelBtn,
    openWebBtn,
    doctorBtn,
    updateKernelBtn,
    openSkillDirBtn,
    reconfigureBtn,
    langSelect,
    pairChannelToggleBtn,
    pairCreateChannelBtn,
    pairReloadConfigBtn,
    pairStatusMessage,
    pairWsStatus,
    pairChannelCount,
    pairChannelList,
    pairQrDialog,
    pairChatDraftInput,
    pairChatSendBtn,
    pairChatCloseBtn,
    pairChatDialog,
    pairChatDialogTitle,
    pairChatMessages,
    pairQrCloseBtn,
    pairQrImage,
    pairEventLog
  } = collectLegacyDomRefs();
  
  let skillsDirs = [];
  let rawConfig = null;
  let activeChatChannelId = '';
  const pairChannels = [];
  const isPairCenterAvailable = () => Boolean(pairChannelToggleBtn && pairCreateChannelBtn && pairChannelList);
  const pairRuntime = {
    isPairCenterAvailable,
    updatePairButtons: () => {},
    openPairQrDialog: async () => {},
    removePairChannel: async () => {},
    sendPairChatMessage: async () => {},
    renderPairWsStatus: () => {},
    resetPairReconnectTimer: () => {},
    cleanupPairWebSocket: () => {},
    connectPairChannel: async () => {},
    disconnectPairChannel: () => {},
    createPairSession: async () => {},
    applyPairConfigFromRawConfig: () => {},
    refreshPairChannelConfig: async () => {},
    initPairCenter: () => {},
    setPairMessage: () => {},
    appendPairEvent: () => {},
    openPairQrDialogForChannel: async () => {},
    clearPairQrPreview: () => {},
    renderPairQrPreview: async () => {},
    shutdown: () => {},
    setRawConfig: () => {},
    hasPairConfig: () => false,
    isPairChannelOpen: () => false,
    isPairChannelConnecting: () => false
  };

  function setSetupMessage(message, type = '') {
    if (!setupMessage) {
      return;
    }
    setupMessage.textContent = message || '';
    setupMessage.className = `message ${type}`.trim();
  }

  function syncSetupSkillsDirs(nextSkillsDirs) {
    const normalized = Array.isArray(nextSkillsDirs)
      ? nextSkillsDirs
          .map((item) => String(item || '').trim())
          .filter(Boolean)
      : [];
    skillsDirs = normalized;
    useDesktopShellStore.getState().setSetupForm({
      skillsDirs: normalized.slice()
    });
  }

  const {
    formatPairTs,
    defaultPairChannelName,
    findPairChannelById,
    findPairChannelByMobileId,
    upsertPairChannel,
    renderPairChannelCards,
    closeDialogSafe,
    openDialogSafe,
    renderPairChatMessages,
    openPairChatDialog,
    removePairChannelLocal,
    appendPairChannelMessage
  } = createPairUiController({
    t: (key, params = {}) => t(key, params),
    pairChannels,
    pairChannelList,
    pairChannelCount,
    pairChatMessages,
    pairChatDialogTitle,
    pairChatDraftInput,
    pairChatDialog,
    getActiveChatChannelId: () => activeChatChannelId,
    setActiveChatChannelId: (channelId) => {
      activeChatChannelId = String(channelId || '');
    },
    updatePairButtons: () => pairRuntime.updatePairButtons(),
    onShowQr: (channelId) => pairRuntime.openPairQrDialog(channelId),
    onDeleteChannel: (channelId) => pairRuntime.removePairChannel(channelId)
  });
  

  const {
    t,
    applyI18n,
    initLanguage,
    textByLang,
    syncCloudflareBaseUrlFromInputs,
    hydrateCloudflareInputsFromBaseUrl,
    resolveProviderBaseUrl,
    defaultCustomHeadersText,
    applyDefaultCustomHeadersIfNeeded,
    getActiveProviderPreset,
    initProviderFilter,
    resolveFallbackApiKeyForPreset,
    rememberCustomApiModeForCurrentModel,
    syncCustomApiModeForCurrentModel,
    populateProviderOptions,
    detectProviderPresetId,
    applyProviderPreset,
    setModelValue,
    closeModelDropdown,
    openModelDropdown,
    renderModelSuggestions,
    fetchModels,
    setRawConfig: setProviderRawConfig,
    setCurrentLang,
    getCurrentLang,
    resetModelFetchKey,
    getActiveProviderId,
    setActiveProviderId,
    getShowAdvancedProviders,
    setShowAdvancedProviders
  } = createProviderController({
    providerInput,
    providerDescription,
    providerRequiredList,
    providerTips,
    providerDocsLink,
    providerShowAdvancedToggle,
    providerAuthNotice,
    providerAuthHint,
    copyProviderAuthCmdBtn,
    baseUrlField,
    apiKeyField,
    customApiModeField,
    customHeadersField,
    modelInput,
    modelSuggestions,
    modelDropdown,
    apiKeyInput,
    baseUrlInput,
    cloudflareFields,
    cloudflareAccountIdInput,
    cloudflareGatewayIdInput,
    baseUrlHint,
    apiKeyLabel,
    apiKeyHint,
    modelHint,
    customApiModeInput,
    customHeadersInput,
    fetchModelsBtn,
    langSelect,
    doctorOutput,
    isPairCenterAvailable,
    renderPairChannelCards,
    updatePairButtons: () => pairRuntime.updatePairButtons(),
    setSetupMessage,
    invoke
  });
  const {
    renderSkillsDirs,
    renderSummary,
    refreshKernelStatus,
    showSetup,
    showMain,
    refreshCustomInputs,
    getKernelStatus
  } = createShellController({
    skillsList,
    summarySkillsList,
    summaryProvider,
    summaryModel,
    summaryApiKey,
    summaryBaseUrl,
    summaryCommand,
    summaryCustomApiMode,
    summaryCustomHeaders,
    summaryKernel,
    summaryConfigPath,
    kernelVersionBadge,
    setupView,
    mainView,
    providerInput,
    getActiveProviderId,
    applyProviderPreset,
    detectProviderPresetId,
    textByLang,
    t,
    getSkillsDirs: () => skillsDirs,
    invoke
  });

  const {
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
  } = createSetupController({
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
    invoke,
    openDialog,
    openPath,
    getRawConfig: () => rawConfig,
    setRawConfig: (value) => {
      rawConfig = value;
    },
    getSkillsDirs: () => skillsDirs,
    setSkillsDirs: (value) => {
      syncSetupSkillsDirs(value);
      renderSkillsDirs();
    },
    setProviderRawConfig,
    setPairRawConfig: (value) => pairRuntime.setRawConfig(value),
    applyPairConfigFromRawConfig: () => pairRuntime.applyPairConfigFromRawConfig(),
    hasPairConfig: () => pairRuntime.hasPairConfig(),
    isPairCenterAvailable,
    setPairMessage: (...args) => pairRuntime.setPairMessage(...args),
    updatePairButtons: () => pairRuntime.updatePairButtons(),
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
  });

  registerSetupStoreActions({
    t,
    getSkillsDirs: () => skillsDirs,
    setSkillsDirs: (value) => {
      syncSetupSkillsDirs(value);
      renderSkillsDirs();
    },
    addSkillDir,
    installDefaultSkills,
    handleKernelInstall,
    saveConfigAndEnter
  });

  registerMainStoreActions({
    t,
    openOpenClawWeb,
    reconfigureFromSavedConfig,
    runDoctor,
    handleKernelInstall,
    openFirstSkillDir,
    saveSummaryCustomApiMode
  });

  const pairController = createPairController({
    pairChannelToggleBtn,
    pairCreateChannelBtn,
    pairReloadConfigBtn,
    pairStatusMessage,
    pairWsStatus,
    pairChannelCount,
    pairChannelList,
    pairQrDialog,
    pairChatDraftInput,
    pairChatSendBtn,
    pairChatCloseBtn,
    pairChatDialog,
    pairChatDialogTitle,
    pairChatMessages,
    pairQrCloseBtn,
    pairQrImage,
    pairEventLog,
    t,
    pairChannels,
    getActiveChatChannelId: () => activeChatChannelId,
    setActiveChatChannelId: (channelId) => {
      activeChatChannelId = String(channelId || '');
    },
    defaultPairChannelName,
    findPairChannelById,
    findPairChannelByMobileId,
    upsertPairChannel,
    renderPairChannelCards,
    closeDialogSafe,
    openDialogSafe,
    renderPairChatMessages,
    openPairChatDialog,
    removePairChannelLocal,
    appendPairChannelMessage,
    invoke
  });

  Object.assign(pairRuntime, pairController);
  const { init: initEventBinder } = createEventBinder({
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
    isPairChannelOpen: () => pairRuntime.isPairChannelOpen(),
    isPairChannelConnecting: () => pairRuntime.isPairChannelConnecting(),
    renderPairWsStatus: (...args) => pairRuntime.renderPairWsStatus(...args),
    shutdownPairController: () => pairRuntime.shutdown(),
    renderSummary,
    refreshKernelStatus,
    renderSkillsDirs,
    applyI18n,
    setCurrentLang,
    getCurrentLang,
    initProviderFilter,
    initLanguage,
    initPairCenter: () => pairRuntime.initPairCenter(),
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
  });

  initEventBinder();

}
