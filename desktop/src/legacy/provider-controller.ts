// @ts-nocheck
import { invoke as defaultInvoke } from '@tauri-apps/api/tauri';
import { I18N } from './i18n-catalog';
import { useDesktopShellStore } from '../store/useDesktopShellStore';
import { syncDoctorOutputState, syncSetupFormFromElements } from './setup-form-sync';
import {
  DEFAULT_CUSTOM_HEADERS,
  DOC_PROVIDER_OVERVIEW,
  PROVIDER_PRESETS,
  buildCloudflareBaseUrl,
  getProviderLoginCommand as getProviderLoginCommandPreset,
  getProviderPreset as getProviderPresetById,
  isAdvancedProviderPreset as isAdvancedProviderPresetValue,
  isCloudflarePreset,
  isManagedAuthPreset as isManagedAuthPresetValue,
  normalizeCustomApiModeByBaseUrl,
  normalizeUrl as normalizeProviderUrl,
  parseCloudflareBaseUrl
} from './provider-presets';

export function createProviderController(deps) {
  const {
    providerInput,
    providerDescription,
    providerRequiredList,
    providerTips,
    providerDocsLink,
    providerShowAdvancedToggle,
    providerAuthNotice,
    providerAuthHint,
    copyProviderAuthCmdBtn,
    apiKeyField,
    baseUrlField,
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
    updatePairButtons,
    setSetupMessage,
    invoke = defaultInvoke
  } = deps;

  const CUSTOM_API_MODE_STORAGE_KEY = 'openclaw.ui.customApiModeByModel';
  let rawConfig = null;
  let currentLang = 'zh-CN';
  let lastModelFetchKey = '';
  let activeProviderId = 'openai';
  let showAdvancedProviders = false;
  let cachedModelOptions = [];
  let isModelDropdownOpen = false;
  let modelDropdownQuery = '';

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
  cloudflareGatewayIdInput
}, patch);
}

function syncCloudflareBaseUrlFromInputs() {
const preset = getActiveProviderPreset();
if (!isCloudflarePreset(preset)) {
  return baseUrlInput.value.trim();
}

const accountId = String(cloudflareAccountIdInput?.value || '').trim();
const gatewayId = String(cloudflareGatewayIdInput?.value || '').trim();
const mode = normalizeCustomApiModeByBaseUrl(
  baseUrlInput.value.trim(),
  customApiModeInput.value.trim()
);
const baseUrl = buildCloudflareBaseUrl(accountId, gatewayId, mode);
baseUrlInput.value = baseUrl;
syncSetupFormState();
return baseUrl;
}

function hydrateCloudflareInputsFromBaseUrl(baseUrl) {
const parsed = parseCloudflareBaseUrl(baseUrl);
if (cloudflareAccountIdInput) {
  cloudflareAccountIdInput.value = parsed?.accountId || '';
}
if (cloudflareGatewayIdInput) {
  cloudflareGatewayIdInput.value = parsed?.gatewayId || '';
}
syncSetupFormState();
}

function resolveProviderBaseUrl(preset) {
if (isCloudflarePreset(preset)) {
  return syncCloudflareBaseUrlFromInputs();
}
return baseUrlInput.value.trim();
}

function t(key, params = {}) {
const dict = I18N[currentLang] || I18N['zh-CN'];
const fallback = I18N['zh-CN'][key] || key;
const template = dict[key] || fallback;
return template.replace(/\{(\w+)\}/g, (_, name) => String(params[name] ?? ''));
}

function applyI18n() {
useDesktopShellStore.getState().setCurrentLang(currentLang === 'en-US' ? 'en-US' : 'zh-CN');
document.documentElement.lang = currentLang === 'en-US' ? 'en' : 'zh-CN';
document.body.dataset.lang = currentLang;
langSelect.value = currentLang;

document.querySelectorAll('[data-i18n]').forEach((el) => {
  const key = el.getAttribute('data-i18n');
  if (key) {
    el.textContent = t(key);
  }
});

document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
  const key = el.getAttribute('data-i18n-placeholder');
  if (key) {
    el.setAttribute('placeholder', t(key));
  }
});

if (isPairCenterAvailable()) {
  renderPairChannelCards();
  updatePairButtons();
}
if (providerInput) {
  const selected = providerInput.value || activeProviderId || 'openai';
  populateProviderOptions();
  applyProviderPreset(selected, { hydrate: true });
}
}

function initLanguage() {
const saved = localStorage.getItem('openclaw.ui.lang');
if (saved && I18N[saved]) {
  currentLang = saved;
} else {
  currentLang = navigator.language?.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en-US';
}
applyI18n();
}

function textByLang(value) {
if (typeof value === 'string') {
  return value;
}
if (!value || typeof value !== 'object') {
  return '';
}
if (currentLang === 'en-US') {
  return value.en || value.zh || '';
}
return value.zh || value.en || '';
}

function normalizeUrl(value) {
return normalizeProviderUrl(value);
}

function defaultCustomHeadersText() {
return JSON.stringify(DEFAULT_CUSTOM_HEADERS, null, 2);
}

function applyDefaultCustomHeadersIfNeeded(preset = getActiveProviderPreset()) {
if (!preset?.showCustomOptions) {
  customHeadersInput.value = '';
  syncSetupFormState();
  return;
}
if (!String(customHeadersInput?.value || '').trim()) {
  customHeadersInput.value = defaultCustomHeadersText();
}
syncSetupFormState();
}

function getProviderPreset(id) {
return getProviderPresetById(id);
}

function getActiveProviderPreset() {
return getProviderPreset(activeProviderId || providerInput.value);
}

function isManagedAuthPreset(preset) {
return isManagedAuthPresetValue(preset);
}

function isAdvancedProviderPreset(preset) {
return isAdvancedProviderPresetValue(preset);
}

function getProviderLoginCommand(preset) {
return getProviderLoginCommandPreset(preset);
}

function initProviderFilter() {
showAdvancedProviders = localStorage.getItem('openclaw.ui.provider.showAdvanced') === '1';
if (providerShowAdvancedToggle) {
  providerShowAdvancedToggle.checked = showAdvancedProviders;
}
syncSetupFormState();
}

function resolveFallbackApiKeyForPreset(preset) {
if (!rawConfig) {
  return '';
}
const configPresetId = detectProviderPresetId(rawConfig || {});
if (configPresetId !== preset.id) {
  return '';
}
return String(rawConfig?.apiKey || '').trim();
}

function customApiModeMemoryKey(preset, model) {
const presetId = String(preset?.id || '').trim();
const modelId = String(model || '').trim().toLowerCase();
if (!presetId || !modelId) {
  return '';
}
return `${presetId}::${modelId}`;
}

function readCustomApiModeMemory() {
try {
  const raw = localStorage.getItem(CUSTOM_API_MODE_STORAGE_KEY);
  if (!raw) {
    return {};
  }
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {};
  }
  return parsed;
} catch {
  return {};
}
}

function writeCustomApiModeMemory(memory) {
localStorage.setItem(CUSTOM_API_MODE_STORAGE_KEY, JSON.stringify(memory || {}));
}

function getRememberedCustomApiModeForCurrentModel(preset = getActiveProviderPreset()) {
if (!preset?.showCustomOptions) {
  return '';
}
const key = customApiModeMemoryKey(preset, modelInput?.value || '');
if (!key) {
  return '';
}
const memory = readCustomApiModeMemory();
return normalizeCustomApiModeByBaseUrl('', memory[key] || '');
}

function rememberCustomApiModeForCurrentModel(preset = getActiveProviderPreset()) {
if (!preset?.showCustomOptions) {
  return;
}
const key = customApiModeMemoryKey(preset, modelInput?.value || '');
if (!key) {
  return;
}
const mode = normalizeCustomApiModeByBaseUrl('', customApiModeInput?.value || '');
const memory = readCustomApiModeMemory();
if (mode) {
  memory[key] = mode;
} else {
  delete memory[key];
}
writeCustomApiModeMemory(memory);
}

function syncCustomApiModeForCurrentModel({ clearIfMissing = true } = {}) {
const preset = getActiveProviderPreset();
if (!preset.showCustomOptions) {
  customApiModeInput.value = '';
  syncSetupFormState();
  return '';
}
const remembered = getRememberedCustomApiModeForCurrentModel(preset);
if (remembered) {
  customApiModeInput.value = remembered;
  syncSetupFormState();
  return remembered;
}
const current = normalizeCustomApiModeByBaseUrl('', customApiModeInput.value);
if (current && !clearIfMissing) {
  customApiModeInput.value = current;
  syncSetupFormState();
  return current;
}
customApiModeInput.value = '';
syncSetupFormState();
return '';
}

function renderChips(container, items, subtle = false) {
container.innerHTML = '';
const list = Array.isArray(items) ? items : [];
for (const item of list) {
  const chip = document.createElement('span');
  chip.className = subtle ? 'chip subtle' : 'chip';
  chip.textContent = textByLang(item);
  container.appendChild(chip);
}
}

function populateProviderOptions() {
const selected = providerInput.value || activeProviderId || 'openai';
const selectedPreset = getProviderPreset(selected);
if (isAdvancedProviderPreset(selectedPreset) && !showAdvancedProviders) {
  showAdvancedProviders = true;
  localStorage.setItem('openclaw.ui.provider.showAdvanced', '1');
  if (providerShowAdvancedToggle) {
    providerShowAdvancedToggle.checked = true;
  }
}

const grouped = new Map();
const visiblePresetIds = new Set();

for (const preset of PROVIDER_PRESETS) {
  if (!showAdvancedProviders && isAdvancedProviderPreset(preset)) {
    continue;
  }
  const groupName = textByLang(preset.category);
  if (!grouped.has(groupName)) {
    grouped.set(groupName, []);
  }
  grouped.get(groupName).push(preset);
  visiblePresetIds.add(preset.id);
}

providerInput.innerHTML = '';
for (const [groupName, presets] of grouped.entries()) {
  const group = document.createElement('optgroup');
  group.label = groupName;
  for (const preset of presets) {
    const option = document.createElement('option');
    option.value = preset.id;
    option.textContent = textByLang(preset.label);
    group.appendChild(option);
  }
  providerInput.appendChild(group);
}

const defaultVisible = PROVIDER_PRESETS.find((preset) => visiblePresetIds.has(preset.id))?.id || 'openai';
providerInput.value = visiblePresetIds.has(selected) ? selected : defaultVisible;
activeProviderId = providerInput.value;
syncSetupFormState();
}

function detectProviderPresetId(config) {
const provider = String(config?.provider || '').trim().toLowerCase();
const baseUrl = normalizeUrl(config?.baseUrl || '');

if (!provider) {
  return 'openai';
}

if (provider && provider !== 'custom' && PROVIDER_PRESETS.some((preset) => preset.id === provider)) {
  return provider;
}
if (provider !== 'custom') {
  return 'custom';
}

for (const preset of PROVIDER_PRESETS) {
  if (preset.runtimeProvider !== 'custom' || preset.id === 'custom') {
    continue;
  }
  const expected = normalizeUrl(preset.baseUrlDefault || '');
  if (expected && baseUrl === expected) {
    return preset.id;
  }
  for (const host of preset.detectHosts || []) {
    if (baseUrl.includes(host.toLowerCase())) {
      return preset.id;
    }
  }
}

return 'custom';
}

function applyProviderPreset(presetId, { hydrate = false } = {}) {
const preset = getProviderPreset(presetId);
if (isAdvancedProviderPreset(preset) && !showAdvancedProviders) {
  showAdvancedProviders = true;
  localStorage.setItem('openclaw.ui.provider.showAdvanced', '1');
  if (providerShowAdvancedToggle) {
    providerShowAdvancedToggle.checked = true;
  }
  populateProviderOptions();
}
activeProviderId = preset.id;
providerInput.value = preset.id;

const loginCommand = getProviderLoginCommand(preset);
const apiKeyLabelText = textByLang(preset.keyLabel) || t('field.apiKey');
const apiKeyHintText = isManagedAuthPreset(preset)
  ? t('provider.loginRequiredShort')
  : preset.keyRequired
    ? (currentLang === 'en-US' ? 'Required for this provider.' : '当前提供商要求填写 API Key。')
    : (currentLang === 'en-US' ? 'Optional for this provider.' : '当前提供商可选填写 API Key。');
const cloudflareMode = isCloudflarePreset(preset);
const baseUrlVisible = Boolean(preset.showBaseUrl);
const baseUrlHintText = preset.showBaseUrl
  ? (
      cloudflareMode
        ? (currentLang === 'en-US'
            ? 'Base URL is generated automatically from Account ID + Gateway ID.'
            : '将根据 Account ID + Gateway ID 自动生成 Base URL。')
        : textByLang(preset.baseUrlHint)
    )
  : '';
const modelHintText = textByLang(preset.modelHint) || (currentLang === 'en-US' ? 'Model ID' : '模型 ID');

useDesktopShellStore.getState().setProviderGuide({
  description: textByLang(preset.description),
  requiredFields: Array.isArray(preset.requiredFields) ? preset.requiredFields.map((item) => textByLang(item)).filter(Boolean) : [],
  tips: Array.isArray(preset.tips) ? preset.tips.map((item) => textByLang(item)).filter(Boolean) : [],
  docsHref: preset.docs || DOC_PROVIDER_OVERVIEW,
  docsText: currentLang === 'en-US' ? 'Open provider integration docs' : '查看该提供商接入文档',
  authNoticeVisible: Boolean(loginCommand),
  authHint: loginCommand ? t('provider.loginRequiredHint', { cmd: loginCommand }) : '',
  copyAuthVisible: Boolean(loginCommand),
  apiKeyLabel: apiKeyLabelText,
  apiKeyHint: apiKeyHintText,
  baseUrlVisible,
  baseUrlHint: baseUrlHintText,
  cloudflareVisible: cloudflareMode,
  customApiModeVisible: Boolean(preset.showCustomOptions),
  customHeadersVisible: Boolean(preset.showCustomOptions),
  fetchModelsVisible: Boolean(preset.fetchModels),
  fetchModelsDisabled: !preset.fetchModels,
  modelHint: modelHintText
});

apiKeyLabel.textContent = apiKeyLabelText;
if (isManagedAuthPreset(preset)) {
  apiKeyHint.textContent = apiKeyHintText;
} else {
  apiKeyHint.textContent = apiKeyHintText;
}
apiKeyInput.placeholder = preset.keyRequired
  ? (currentLang === 'en-US' ? 'Required' : '必填')
  : (currentLang === 'en-US' ? 'Optional' : '可选');

if (cloudflareFields) {
  cloudflareFields.style.display = cloudflareMode ? '' : 'none';
}
baseUrlField.style.display = preset.showBaseUrl ? '' : 'none';
if (preset.showBaseUrl) {
  baseUrlHint.textContent = baseUrlHintText;
  baseUrlInput.placeholder = preset.baseUrlDefault || 'e.g. https://api.openai.com/v1';
  if (!hydrate) {
    const current = baseUrlInput.value.trim();
    if (!current || current === normalizeUrl(rawConfig?.baseUrl || '')) {
      baseUrlInput.value = preset.baseUrlDefault || '';
    }
  }
  baseUrlInput.readOnly = cloudflareMode;
  if (cloudflareMode) {
    if (hydrate && baseUrlInput.value.trim()) {
      hydrateCloudflareInputsFromBaseUrl(baseUrlInput.value.trim());
    }
    syncCloudflareBaseUrlFromInputs();
  }
} else {
  baseUrlInput.value = '';
  baseUrlHint.textContent = '';
  baseUrlInput.readOnly = false;
  if (cloudflareAccountIdInput) {
    cloudflareAccountIdInput.value = '';
  }
  if (cloudflareGatewayIdInput) {
    cloudflareGatewayIdInput.value = '';
  }
}

customApiModeField.style.display = preset.showCustomOptions ? '' : 'none';
customHeadersField.style.display = preset.showCustomOptions ? '' : 'none';
fetchModelsBtn.style.display = preset.fetchModels ? '' : 'none';
fetchModelsBtn.disabled = !preset.fetchModels;

if (preset.showCustomOptions) {
  const normalized = normalizeCustomApiModeByBaseUrl(
    baseUrlInput.value.trim(),
    customApiModeInput.value.trim()
  );
  customApiModeInput.value = normalized;
  applyDefaultCustomHeadersIfNeeded(preset);
  if (!hydrate || !normalized) {
    syncCustomApiModeForCurrentModel();
  }
  if (cloudflareMode) {
    syncCloudflareBaseUrlFromInputs();
  }
} else {
  customApiModeInput.value = '';
  customHeadersInput.value = '';
}

if (!hydrate) {
  if (!preset.keyRequired && preset.autoApiKey && !apiKeyInput.value.trim()) {
    apiKeyInput.value = '';
  }
  renderModelSuggestions([]);
  lastModelFetchKey = '';
}
modelInput.placeholder = textByLang(preset.modelHint) || (currentLang === 'en-US' ? 'Model ID' : '模型 ID');
modelHint.textContent = modelHintText;
syncSetupFormState();
}


function setModelValue(value, { syncApiMode = true } = {}) {
const model = String(value || '').trim();
modelInput.value = model;
if (syncApiMode) {
  syncCustomApiModeForCurrentModel();
} else {
  syncSetupFormState();
}
}

function closeModelDropdown() {
if (!modelDropdown) {
  return;
}
modelDropdownQuery = '';
isModelDropdownOpen = false;
modelDropdown.classList.add('hidden');
}

function getFilteredModelOptions() {
const keyword = String(modelDropdownQuery || '').trim().toLowerCase();
if (!keyword) {
  return cachedModelOptions.slice(0, 200);
}
return cachedModelOptions
  .filter((modelId) => modelId.toLowerCase().includes(keyword))
  .slice(0, 200);
}

function renderModelDropdown() {
if (!modelDropdown) {
  return;
}
modelDropdown.innerHTML = '';

const options = getFilteredModelOptions();
if (options.length === 0) {
  const empty = document.createElement('div');
  empty.className = 'model-dropdown-empty';
  empty.textContent = t('model.dropdown.empty');
  modelDropdown.appendChild(empty);
  return;
}

for (const modelId of options) {
  const item = document.createElement('button');
  item.type = 'button';
  item.className = 'model-dropdown-item';
  item.textContent = modelId;
  item.addEventListener('mousedown', (event) => {
    event.preventDefault();
  });
  item.addEventListener('click', () => {
    setModelValue(modelId);
    closeModelDropdown();
    modelInput.focus();
  });
  modelDropdown.appendChild(item);
}
}

function openModelDropdown() {
if (!modelDropdown || cachedModelOptions.length === 0) {
  closeModelDropdown();
  return;
}
modelDropdownQuery = '';
isModelDropdownOpen = true;
modelDropdown.classList.remove('hidden');
renderModelDropdown();
}

function renderModelSuggestions(models = []) {
const current = modelInput.value.trim();
modelSuggestions.innerHTML = '';

const nextOptions = [];
const seen = new Set();
for (const modelIdRaw of models) {
  const modelId = String(modelIdRaw || '').trim();
  if (!modelId || seen.has(modelId.toLowerCase())) {
    continue;
  }
  seen.add(modelId.toLowerCase());
  nextOptions.push(modelId);

  const option = document.createElement('option');
  option.value = modelId;
  modelSuggestions.appendChild(option);
}
cachedModelOptions = nextOptions;

if (current) {
  modelInput.value = current;
} else {
  modelInput.value = '';
}

if (cachedModelOptions.length === 0) {
  closeModelDropdown();
} else if (isModelDropdownOpen) {
  renderModelDropdown();
}
syncCustomApiModeForCurrentModel({ clearIfMissing: false });
}

function currentFetchKey() {
const preset = getActiveProviderPreset();
const baseUrl = resolveProviderBaseUrl(preset);
const fallbackApiKey = resolveFallbackApiKeyForPreset(preset);
const apiKey = (
  apiKeyInput.value.trim() ||
  fallbackApiKey ||
  (!preset.keyRequired ? preset.autoApiKey || '' : '')
).trim();
const customApiMode = normalizeCustomApiModeByBaseUrl(baseUrl, customApiModeInput.value.trim());
const customHeadersJson = preset.showCustomOptions ? customHeadersInput.value.trim() : '';
return [preset.id, baseUrl, apiKey, customApiMode, customHeadersJson].join('||');
}

async function fetchModels({ silent = false, force = false } = {}) {
const preset = getActiveProviderPreset();
const provider = preset.runtimeProvider;
const baseUrl = resolveProviderBaseUrl(preset);
const fallbackApiKey = resolveFallbackApiKeyForPreset(preset);
const apiKey = (
  apiKeyInput.value.trim() ||
  fallbackApiKey ||
  (!preset.keyRequired ? preset.autoApiKey || '' : '')
).trim();
const customApiMode = normalizeCustomApiModeByBaseUrl(
  baseUrl,
  customApiModeInput.value.trim()
);
const customHeadersJson = preset.showCustomOptions ? customHeadersInput.value.trim() : '';

if (preset.showCustomOptions && !customApiMode) {
  if (!silent) {
    setSetupMessage(t('msg.customApiModeRequired'), 'error');
  }
  return false;
}

if (provider !== 'custom' || !preset.fetchModels) {
  if (!silent) {
    setSetupMessage(t('msg.onlyCustomFetch'), 'error');
  }
  return false;
}

if (!baseUrl) {
  if (!silent) {
    setSetupMessage(t('msg.needBaseUrl'), 'error');
  }
  return false;
}

const key = currentFetchKey();
if (!force && key === lastModelFetchKey) {
  return true;
}

if (!silent) {
  setSetupMessage(t('msg.fetchingModels'));
}

const payload = {
  provider,
  baseUrl,
  apiKey,
  customApiMode,
  customHeadersJson
};

let result;
try {
  result = await invoke('fetch_models', { payload });
  } catch (error) {
    if (!silent) {
      setSetupMessage(t('msg.fetchModelsFailed'), 'error');
      syncDoctorOutputState(String(error || t('kernel.unknown')));
    }
    return false;
  }
  if (!result.ok) {
    if (!silent) {
      setSetupMessage(result.message || t('msg.fetchModelsFailed'), 'error');
      syncDoctorOutputState(`${result.message}\n\n${result.detail || ''}`.trim());
    }
    return false;
  }

const models = result.models || [];
renderModelSuggestions(models);
lastModelFetchKey = key;

if (!modelInput.value.trim() && models.length > 0) {
  modelInput.value = models[0];
  syncSetupFormState();
}

if (!silent) {
  setSetupMessage(result.message || t('msg.modelsFetched', { count: models.length }), 'success');
}

return true;
}

  return {
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
    getFilteredModelOptions,
    renderModelDropdown,
    openModelDropdown,
    renderModelSuggestions,
    currentFetchKey,
    fetchModels,
    setRawConfig: (value) => { rawConfig = value; },
    getRawConfig: () => rawConfig,
    setCurrentLang: (value) => {
      currentLang = value;
      useDesktopShellStore.getState().setCurrentLang(currentLang === 'en-US' ? 'en-US' : 'zh-CN');
      syncSetupFormState();
    },
    getCurrentLang: () => currentLang,
    resetModelFetchKey: () => { lastModelFetchKey = ''; },
    getActiveProviderId: () => activeProviderId,
    setActiveProviderId: (value) => {
      activeProviderId = String(value || 'openai');
      syncSetupFormState({ providerId: activeProviderId });
    },
    getShowAdvancedProviders: () => showAdvancedProviders,
    setShowAdvancedProviders: (value) => {
      showAdvancedProviders = Boolean(value);
      syncSetupFormState({ showAdvancedProviders });
    }
  };
}
