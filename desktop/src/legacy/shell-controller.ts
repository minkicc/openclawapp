// @ts-nocheck
import { invoke as defaultInvoke } from '@tauri-apps/api/tauri';
import { getProviderPreset, normalizeCustomApiModeByBaseUrl } from './provider-presets';
import { useDesktopShellStore } from '../store/useDesktopShellStore';

export function createShellController(deps) {
  const {
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
    getSkillsDirs,
    invoke = defaultInvoke
  } = deps;

  let kernelStatus = null;

  function renderSkillsDirs() {
    const skillsDirs = getSkillsDirs();
    useDesktopShellStore.getState().setSetupForm({
      skillsDirs: Array.isArray(skillsDirs) ? skillsDirs.slice() : []
    });
  }

  function renderSummary(config, configPath) {
    const presetId = detectProviderPresetId(config);
    const preset = getProviderPreset(presetId);
    const providerText = textByLang(preset.label) || config.provider || '-';
    const modelText = config.model || '-';
    const apiKeyText = config.apiKeyMasked || '********';
    const baseUrlText = config.baseUrl || '-';
    const commandText = config.openclawCommand || 'openclaw';
    const summaryMode = normalizeCustomApiModeByBaseUrl(config.baseUrl || '', config.customApiMode || '');
    const isCustomProvider = String(config.provider || '').trim().toLowerCase() === 'custom';
    const headers = config.customHeaders || {};
    const headersText = Object.keys(headers).length ? JSON.stringify(headers) : '-';
    const dirs = config.skillsDirs || [];

    useDesktopShellStore.getState().setSummary({
      provider: providerText,
      model: modelText,
      apiKey: apiKeyText,
      baseUrl: baseUrlText,
      command: commandText,
      customApiMode: summaryMode || '',
      customHeaders: headersText,
      configPath: configPath || '-',
      isCustomProvider,
      skillsDirs: Array.isArray(dirs) ? dirs : []
    });
  }

  function formatKernelStatus(status) {
    if (!status) {
      return t('kernel.unknown');
    }
    const latestVersion = String(status.latestVersion || '').trim();
    if (status.installed) {
      const version = status.version || 'unknown';
      const source = (status.source || '').trim();
      if (source === 'bundled-kernel' || source === 'bundled-bin') {
        if (status.updateAvailable && latestVersion) {
          return t('kernel.bundledUpdate', { version, latestVersion });
        }
        return t('kernel.bundled', { version });
      }
      if (source === 'managed-kernel') {
        if (status.updateAvailable && latestVersion) {
          return t('kernel.installedUpdate', { version, latestVersion });
        }
        return t('kernel.installed', { version });
      }
      return t('kernel.available', { version });
    }
    if (!status.npmAvailable) {
      return t('kernel.notInstalledNoNpm');
    }
    return t('kernel.notInstalled');
  }

  function renderKernelVersionBadge(status) {
    const activeVersion = String(status?.version || '').trim();
    const bundledVersion = String(status?.bundledVersion || '').trim();
    const version = activeVersion || bundledVersion;
    const badgeVersion = version.replace(/^OpenClaw\s+/i, '').trim();
    const text = version ? t('kernel.badge', { version: badgeVersion || version }) : t('kernel.badgeUnknown');
    useDesktopShellStore.getState().setKernelBadge(text);
    if (kernelVersionBadge) {
      kernelVersionBadge.textContent = text;
    }
  }

  async function refreshKernelStatus() {
    try {
      kernelStatus = await invoke('get_kernel_status');
      const text = formatKernelStatus(kernelStatus);
      useDesktopShellStore.getState().setSummary({
        kernelStatus: text
      });
      renderKernelVersionBadge(kernelStatus);
    } catch {
      kernelStatus = null;
      const text = t('kernel.unknown');
      useDesktopShellStore.getState().setSummary({
        kernelStatus: text
      });
      renderKernelVersionBadge(null);
    }
  }

  function showSetup() {
    useDesktopShellStore.getState().setViewMode('setup');
    mainView?.classList.add('hidden');
    setupView?.classList.remove('hidden');
  }

  function showMain() {
    useDesktopShellStore.getState().setViewMode('main');
    setupView?.classList.add('hidden');
    mainView?.classList.remove('hidden');
  }

  function refreshCustomInputs() {
    applyProviderPreset(providerInput.value || getActiveProviderId() || 'openai', { hydrate: true });
  }

  return {
    renderSkillsDirs,
    renderSummary,
    formatKernelStatus,
    renderKernelVersionBadge,
    refreshKernelStatus,
    showSetup,
    showMain,
    refreshCustomInputs,
    getKernelStatus: () => kernelStatus,
    setKernelStatus: (value) => {
      kernelStatus = value;
    }
  };
}
