import { invoke } from '@tauri-apps/api/tauri';
import { open as openDialog } from '@tauri-apps/api/dialog';
import { open as openPath } from '@tauri-apps/api/shell';

const setupView = document.getElementById('setupView');
const mainView = document.getElementById('mainView');
const providerInput = document.getElementById('providerInput');
const modelInput = document.getElementById('modelInput');
const apiKeyInput = document.getElementById('apiKeyInput');
const baseUrlInput = document.getElementById('baseUrlInput');
const commandInput = document.getElementById('commandInput');
const customApiModeInput = document.getElementById('customApiModeInput');
const customHeadersInput = document.getElementById('customHeadersInput');
const fetchModelsBtn = document.getElementById('fetchModelsBtn');
const skillsList = document.getElementById('skillsList');
const summarySkillsList = document.getElementById('summarySkillsList');
const setupMessage = document.getElementById('setupMessage');
const doctorOutput = document.getElementById('doctorOutput');

const platformBadge = document.getElementById('platformBadge');
const summaryModel = document.getElementById('summaryModel');
const summaryApiKey = document.getElementById('summaryApiKey');
const summaryBaseUrl = document.getElementById('summaryBaseUrl');
const summaryCommand = document.getElementById('summaryCommand');
const summaryCustomApiMode = document.getElementById('summaryCustomApiMode');
const summaryCustomHeaders = document.getElementById('summaryCustomHeaders');
const summaryKernel = document.getElementById('summaryKernel');
const summaryConfigPath = document.getElementById('summaryConfigPath');

const addSkillDirBtn = document.getElementById('addSkillDirBtn');
const installDefaultsBtn = document.getElementById('installDefaultsBtn');
const saveBtn = document.getElementById('saveBtn');
const installKernelBtn = document.getElementById('installKernelBtn');
const openWebBtn = document.getElementById('openWebBtn');
const doctorBtn = document.getElementById('doctorBtn');
const updateKernelBtn = document.getElementById('updateKernelBtn');
const openSkillDirBtn = document.getElementById('openSkillDirBtn');
const reconfigureBtn = document.getElementById('reconfigureBtn');
const langSelect = document.getElementById('langSelect');

let skillsDirs = [];
let rawConfig = null;
let kernelStatus = null;
let lastModelFetchKey = '';
let currentLang = 'zh-CN';

const I18N = {
  'zh-CN': {
    'topbar.subtitle': '首次启动配置向导',
    'setup.title': '配置 OpenClaw（核心项）',
    'setup.hint': '已统一使用 Custom Provider，请填写 Base URL、Model API Key、Model。',
    'field.baseUrl': 'Base URL',
    'field.apiKey': 'Model API Key',
    'field.model': 'Model',
    'field.apiKeyShort': 'API Key',
    'field.command': 'OpenClaw 命令（覆盖默认内置内核）',
    'field.customApiMode': 'Custom API 模式（仅 Custom）',
    'field.customHeaders': 'Custom Headers JSON（仅 Custom，可选）',
    'field.commandShort': 'OpenClaw 命令',
    'field.customApiModeShort': 'Custom API 模式',
    'field.customHeadersShort': 'Custom Headers',
    'field.kernelStatus': '内核状态',
    'field.configPath': '配置文件',
    'ph.baseUrl': '例如 https://api.openai.com/v1',
    'ph.required': '必须填写',
    'ph.customHeaders': '例如 {"User-Agent":"Mozilla/5.0 ...","Accept":"application/json"}',
    'model.placeholder.fetch': '请选择模型（先点击“拉取模型”）',
    'model.placeholder.select': '请选择模型',
    'model.currentValue': '{value}（当前值）',
    'btn.fetchModels': '拉取模型',
    'btn.addDir': '添加目录',
    'btn.installDefaultSkills': '导入内置 Skills',
    'btn.installKernel': '安装/更新 OpenClaw 内核',
    'btn.start': '开始使用',
    'btn.reconfigure': '重新配置',
    'btn.checkCommand': '检查 OpenClaw 命令',
    'btn.updateKernel': '更新内核（npm）',
    'btn.openFirstSkillDir': '打开首个 Skills 目录',
    'advanced.title': '高级选项（可选）',
    'advanced.infoTitle': '高级信息（可选）',
    'advanced.expand': '展开',
    'main.readyTitle': 'OpenClaw 已就绪',
    'main.readyHint': '核心信息已配置完成，直接点击“开始使用”即可。',
    'skills.title.optional': 'Skills 目录（可选）',
    'skills.title': 'Skills 目录',
    'skills.noneConfigured': '未配置 skills 目录',
    'skills.noneOptional': '未配置（可选）',
    'skills.remove': '移除',
    'dialog.selectSkillsDir': '选择 skills 目录',
    'dialog.selectDefaultSkillsTarget': '选择导入默认 skills 的目标目录',
    'msg.onlyCustomFetch': '当前仅支持 Custom Provider 拉取模型。',
    'msg.needBaseUrl': '请先填写 Base URL。',
    'msg.fetchingModels': '正在拉取模型列表...',
    'msg.fetchModelsFailed': '拉取模型失败。',
    'msg.modelsFetched': '已拉取 {count} 个模型。',
    'msg.importingSkills': '正在导入内置 skills...',
    'msg.importFailed': '导入失败。',
    'msg.importedSkills': '已导入内置 skills 到: {path}',
    'msg.modelRequired': 'Model 不能为空。',
    'msg.baseUrlRequiredForCustom': 'Provider 为 custom 时，Base URL 不能为空。',
    'msg.headersMustObject': 'Custom Headers 必须是 JSON 对象。',
    'msg.headerValueMustString': 'Header {key} 的值必须是字符串。',
    'msg.headersJsonInvalid': 'Custom Headers JSON 格式错误：{detail}',
    'msg.savingConfig': '正在保存配置...',
    'msg.saveFailed': '保存失败。',
    'msg.saveSuccess': '配置保存成功。',
    'msg.autoInstallingKernel': '正在自动安装 OpenClaw 内核（npm i openclaw）...',
    'msg.autoKernelFailed': '配置已保存，但内核自动安装失败：{message}（可稍后手动点击“安装/更新 OpenClaw 内核”）',
    'msg.configAndKernelReady': '配置与内核均已就绪，正在进入应用...',
    'msg.enteringApp': '配置保存成功，正在进入应用...',
    'msg.runningAction': '正在{label}（npm i openclaw）...',
    'msg.actionFailed': '{label}失败：{message}',
    'msg.enterWebFailed': '进入 OpenClaw Web 失败。',
    'msg.invalidDashboardUrl': '进入 OpenClaw Web 失败：返回的地址无效。',
    'msg.noDashboardUrl': '未返回可用 URL',
    'msg.enteringWeb': '正在进入 OpenClaw Web...',
    'msg.openclawWeb': 'OpenClaw Web: {url}',
    'msg.updatingKernel': '正在更新 OpenClaw 内核（npm i openclaw）...',
    'msg.gettingDashboard': '正在获取 OpenClaw Web 地址...',
    'msg.checkingCommand': '正在检查 openclaw 命令...',
    'msg.noSkillDirToOpen': '没有可打开的 skills 目录。',
    'kernel.unknown': '未知',
    'kernel.bundled': '已内置 ({version})',
    'kernel.installed': '已安装 ({version})',
    'kernel.available': '可用 ({version})',
    'kernel.notInstalledNoNpm': '未安装（未检测到 npm，且未发现内置内核）',
    'kernel.notInstalled': '未安装'
  },
  'en-US': {
    'topbar.subtitle': 'First Launch Setup Wizard',
    'setup.title': 'Configure OpenClaw (Core)',
    'setup.hint': 'Custom Provider is now the default. Fill Base URL, Model API Key, and Model.',
    'field.baseUrl': 'Base URL',
    'field.apiKey': 'Model API Key',
    'field.model': 'Model',
    'field.apiKeyShort': 'API Key',
    'field.command': 'OpenClaw Command (override bundled kernel)',
    'field.customApiMode': 'Custom API Mode (Custom only)',
    'field.customHeaders': 'Custom Headers JSON (Custom only, optional)',
    'field.commandShort': 'OpenClaw Command',
    'field.customApiModeShort': 'Custom API Mode',
    'field.customHeadersShort': 'Custom Headers',
    'field.kernelStatus': 'Kernel Status',
    'field.configPath': 'Config File',
    'ph.baseUrl': 'e.g. https://api.openai.com/v1',
    'ph.required': 'Required',
    'ph.customHeaders': 'e.g. {"User-Agent":"Mozilla/5.0 ...","Accept":"application/json"}',
    'model.placeholder.fetch': 'Select a model (click "Fetch Models" first)',
    'model.placeholder.select': 'Select a model',
    'model.currentValue': '{value} (current)',
    'btn.fetchModels': 'Fetch Models',
    'btn.addDir': 'Add Directory',
    'btn.installDefaultSkills': 'Import Built-in Skills',
    'btn.installKernel': 'Install/Update OpenClaw Kernel',
    'btn.start': 'Start',
    'btn.reconfigure': 'Reconfigure',
    'btn.checkCommand': 'Check OpenClaw Command',
    'btn.updateKernel': 'Update Kernel (npm)',
    'btn.openFirstSkillDir': 'Open First Skills Directory',
    'advanced.title': 'Advanced (Optional)',
    'advanced.infoTitle': 'Advanced Info (Optional)',
    'advanced.expand': 'Expand',
    'main.readyTitle': 'OpenClaw Is Ready',
    'main.readyHint': 'Core settings are complete. Click "Start" to continue.',
    'skills.title.optional': 'Skills Directory (Optional)',
    'skills.title': 'Skills Directory',
    'skills.noneConfigured': 'No skills directory configured',
    'skills.noneOptional': 'Not configured (optional)',
    'skills.remove': 'Remove',
    'dialog.selectSkillsDir': 'Select skills directory',
    'dialog.selectDefaultSkillsTarget': 'Select target directory for built-in skills',
    'msg.onlyCustomFetch': 'Fetching models currently supports Custom provider only.',
    'msg.needBaseUrl': 'Please fill Base URL first.',
    'msg.fetchingModels': 'Fetching model list...',
    'msg.fetchModelsFailed': 'Failed to fetch models.',
    'msg.modelsFetched': 'Fetched {count} models.',
    'msg.importingSkills': 'Importing built-in skills...',
    'msg.importFailed': 'Import failed.',
    'msg.importedSkills': 'Built-in skills imported to: {path}',
    'msg.modelRequired': 'Model is required.',
    'msg.baseUrlRequiredForCustom': 'Base URL is required when provider is custom.',
    'msg.headersMustObject': 'Custom Headers must be a JSON object.',
    'msg.headerValueMustString': 'Header {key} value must be a string.',
    'msg.headersJsonInvalid': 'Custom Headers JSON error: {detail}',
    'msg.savingConfig': 'Saving configuration...',
    'msg.saveFailed': 'Save failed.',
    'msg.saveSuccess': 'Configuration saved.',
    'msg.autoInstallingKernel': 'Auto-installing OpenClaw kernel (npm i openclaw)...',
    'msg.autoKernelFailed': 'Config saved, but kernel auto-install failed: {message} (you can click "Install/Update OpenClaw Kernel" later)',
    'msg.configAndKernelReady': 'Config and kernel are ready. Entering app...',
    'msg.enteringApp': 'Configuration saved. Entering app...',
    'msg.runningAction': 'Running {label} (npm i openclaw)...',
    'msg.actionFailed': '{label} failed: {message}',
    'msg.enterWebFailed': 'Failed to open OpenClaw Web.',
    'msg.invalidDashboardUrl': 'Failed to open OpenClaw Web: invalid URL returned.',
    'msg.noDashboardUrl': 'No valid URL returned',
    'msg.enteringWeb': 'Opening OpenClaw Web...',
    'msg.openclawWeb': 'OpenClaw Web: {url}',
    'msg.updatingKernel': 'Updating OpenClaw kernel (npm i openclaw)...',
    'msg.gettingDashboard': 'Getting OpenClaw Web URL...',
    'msg.checkingCommand': 'Checking openclaw command...',
    'msg.noSkillDirToOpen': 'No skills directory available to open.',
    'kernel.unknown': 'Unknown',
    'kernel.bundled': 'Bundled ({version})',
    'kernel.installed': 'Installed ({version})',
    'kernel.available': 'Available ({version})',
    'kernel.notInstalledNoNpm': 'Not installed (npm not found and no bundled kernel detected)',
    'kernel.notInstalled': 'Not installed'
  }
};

function t(key, params = {}) {
  const dict = I18N[currentLang] || I18N['zh-CN'];
  const fallback = I18N['zh-CN'][key] || key;
  const template = dict[key] || fallback;
  return template.replace(/\{(\w+)\}/g, (_, name) => String(params[name] ?? ''));
}

function applyI18n() {
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

function setSetupMessage(message, type = '') {
  setupMessage.textContent = message || '';
  setupMessage.className = `message ${type}`.trim();
}

function dedupeSkillsDirs(items) {
  const uniq = new Set();
  for (const item of items) {
    if (typeof item === 'string' && item.trim()) {
      uniq.add(item.trim());
    }
  }
  return Array.from(uniq);
}

function setModelValue(value) {
  const model = String(value || '').trim();
  if (!model) {
    modelInput.value = '';
    return;
  }

  let option = Array.from(modelInput.options).find((item) => item.value === model);
  if (!option) {
    option = document.createElement('option');
    option.value = model;
    option.textContent = t('model.currentValue', { value: model });
    modelInput.appendChild(option);
  }
  modelInput.value = model;
}

function renderModelSuggestions(models = []) {
  const current = modelInput.value.trim();
  modelInput.innerHTML = '';

  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = models.length > 0 ? t('model.placeholder.select') : t('model.placeholder.fetch');
  modelInput.appendChild(placeholder);

  const seen = new Set();
  for (const modelIdRaw of models) {
    const modelId = String(modelIdRaw || '').trim();
    if (!modelId || seen.has(modelId)) {
      continue;
    }
    seen.add(modelId);

    const option = document.createElement('option');
    option.value = modelId;
    option.textContent = modelId;
    modelInput.appendChild(option);
  }

  if (current && seen.has(current)) {
    modelInput.value = current;
    return;
  }

  if (current && !seen.has(current)) {
    const option = document.createElement('option');
    option.value = current;
    option.textContent = t('model.currentValue', { value: current });
    modelInput.appendChild(option);
    modelInput.value = current;
    return;
  }

  modelInput.value = '';
}

function currentFetchKey() {
  const provider = providerInput.value.trim();
  const baseUrl = baseUrlInput.value.trim();
  const apiKey = (apiKeyInput.value.trim() || rawConfig?.apiKey || '').trim();
  const customApiMode = customApiModeInput.value.trim();
  const customHeadersJson = customHeadersInput.value.trim();
  return [provider, baseUrl, apiKey, customApiMode, customHeadersJson].join('||');
}

async function fetchModels({ silent = false, force = false } = {}) {
  const provider = providerInput.value.trim();
  const baseUrl = baseUrlInput.value.trim();
  const apiKey = (apiKeyInput.value.trim() || rawConfig?.apiKey || '').trim();
  const customApiMode = customApiModeInput.value.trim() || 'openai-completions';
  const customHeadersJson = customHeadersInput.value.trim();

  if (provider !== 'custom') {
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
      doctorOutput.textContent = String(error || t('kernel.unknown'));
    }
    return false;
  }
  if (!result.ok) {
    if (!silent) {
      setSetupMessage(result.message || t('msg.fetchModelsFailed'), 'error');
      doctorOutput.textContent = `${result.message}\n\n${result.detail || ''}`.trim();
    }
    return false;
  }

  const models = result.models || [];
  renderModelSuggestions(models);
  lastModelFetchKey = key;

  if (!modelInput.value.trim() && models.length > 0) {
    modelInput.value = models[0];
  }

  if (!silent) {
    setSetupMessage(result.message || t('msg.modelsFetched', { count: models.length }), 'success');
  }

  return true;
}

function renderSkillsDirs() {
  skillsList.innerHTML = '';

  if (skillsDirs.length === 0) {
    const li = document.createElement('li');
    li.innerHTML = `<span>${t('skills.noneConfigured')}</span>`;
    skillsList.appendChild(li);
    return;
  }

  skillsDirs.forEach((dirPath, index) => {
    const li = document.createElement('li');
    const pathLabel = document.createElement('span');
    pathLabel.textContent = dirPath;

    const removeButton = document.createElement('button');
    removeButton.className = 'remove-btn';
    removeButton.textContent = t('skills.remove');
    removeButton.addEventListener('click', () => {
      skillsDirs.splice(index, 1);
      renderSkillsDirs();
    });

    li.appendChild(pathLabel);
    li.appendChild(removeButton);
    skillsList.appendChild(li);
  });
}

function renderSummary(config, configPath) {
  summaryModel.textContent = config.model || '-';
  summaryApiKey.textContent = config.apiKeyMasked || '********';
  summaryBaseUrl.textContent = config.baseUrl || '-';
  summaryCommand.textContent = config.openclawCommand || 'openclaw';
  summaryCustomApiMode.textContent = config.customApiMode || 'openai-completions';
  const headers = config.customHeaders || {};
  summaryCustomHeaders.textContent = Object.keys(headers).length
    ? JSON.stringify(headers)
    : '-';
  summaryConfigPath.textContent = configPath;

  summarySkillsList.innerHTML = '';
  const dirs = config.skillsDirs || [];
  if (dirs.length === 0) {
    const li = document.createElement('li');
    const span = document.createElement('span');
    span.textContent = t('skills.noneOptional');
    li.appendChild(span);
    summarySkillsList.appendChild(li);
    return;
  }

  dirs.forEach((dirPath) => {
    const li = document.createElement('li');
    const span = document.createElement('span');
    span.textContent = dirPath;
    li.appendChild(span);
    summarySkillsList.appendChild(li);
  });
}

function formatKernelStatus(status) {
  if (!status) {
    return t('kernel.unknown');
  }
  if (status.installed) {
    const version = status.version || 'unknown';
    const source = (status.source || '').trim();
    if (source === 'bundled-kernel' || source === 'bundled-bin') {
      return t('kernel.bundled', { version });
    }
    if (source === 'managed-kernel') {
      return t('kernel.installed', { version });
    }
    return t('kernel.available', { version });
  }
  if (!status.npmAvailable) {
    return t('kernel.notInstalledNoNpm');
  }
  return t('kernel.notInstalled');
}

async function refreshKernelStatus() {
  try {
    kernelStatus = await invoke('get_kernel_status');
    summaryKernel.textContent = formatKernelStatus(kernelStatus);
  } catch {
    kernelStatus = null;
    summaryKernel.textContent = t('kernel.unknown');
  }
}

function showSetup() {
  mainView.classList.add('hidden');
  setupView.classList.remove('hidden');
}

function showMain() {
  setupView.classList.add('hidden');
  mainView.classList.remove('hidden');
}

function refreshCustomInputs() {
  const isCustom = providerInput.value.trim() === 'custom';
  customApiModeInput.disabled = !isCustom;
  customHeadersInput.disabled = !isCustom;
  fetchModelsBtn.disabled = !isCustom;
}

async function loadState() {
  const state = await invoke('get_state');
  platformBadge.textContent = `${state.platform} · v${state.version}`;

  if (state.isConfigured && state.config) {
    rawConfig = await invoke('read_raw_config');
    const configPath = await invoke('get_config_path');
    renderSummary(state.config, configPath);
    await refreshKernelStatus();
    showMain();
    return;
  }

  rawConfig = state.config;
  providerInput.value = 'custom';
  setModelValue(rawConfig?.model || '');
  baseUrlInput.value = rawConfig?.baseUrl || '';
  commandInput.value = rawConfig?.openclawCommand || 'openclaw';
  customApiModeInput.value = rawConfig?.customApiMode || 'openai-completions';
  customHeadersInput.value = rawConfig?.customHeaders
    ? JSON.stringify(rawConfig.customHeaders, null, 2)
    : '';
  apiKeyInput.value = '';
  skillsDirs = dedupeSkillsDirs(rawConfig?.skillsDirs || []);
  renderSkillsDirs();
  refreshCustomInputs();
  if (providerInput.value === 'custom' && baseUrlInput.value.trim()) {
    await fetchModels({ silent: true });
  }
  await refreshKernelStatus();
  showSetup();
}

addSkillDirBtn.addEventListener('click', async () => {
  const selected = await openDialog({
    directory: true,
    multiple: false,
    title: t('dialog.selectSkillsDir')
  });

  if (!selected || Array.isArray(selected)) {
    return;
  }

  skillsDirs = dedupeSkillsDirs([...skillsDirs, selected]);
  renderSkillsDirs();
});

installDefaultsBtn.addEventListener('click', async () => {
  let targetDir = skillsDirs[0];
  if (!targetDir) {
    const selected = await openDialog({
      directory: true,
      multiple: false,
      title: t('dialog.selectDefaultSkillsTarget')
    });
    if (!selected || Array.isArray(selected)) {
      return;
    }
    targetDir = selected;
    skillsDirs = dedupeSkillsDirs([...skillsDirs, targetDir]);
    renderSkillsDirs();
  }

  setSetupMessage(t('msg.importingSkills'));
  const result = await invoke('install_default_skills', { targetDir });
  if (!result.ok) {
    setSetupMessage(result.message || t('msg.importFailed'), 'error');
    return;
  }

  setSetupMessage(t('msg.importedSkills', { path: result.copiedTo }), 'success');
});

saveBtn.addEventListener('click', async () => {
  const apiKey = apiKeyInput.value.trim() || rawConfig?.apiKey || '';
  const model = modelInput.value.trim();
  const baseUrl = baseUrlInput.value.trim();
  const provider = providerInput.value.trim();
  const customApiMode = customApiModeInput.value.trim() || 'openai-completions';
  const customHeadersJson = customHeadersInput.value.trim();

  if (!model) {
    setSetupMessage(t('msg.modelRequired'), 'error');
    return;
  }

  if (provider === 'custom' && !baseUrl) {
    setSetupMessage(t('msg.baseUrlRequiredForCustom'), 'error');
    return;
  }

  if (provider === 'custom' && customHeadersJson) {
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
      return;
    }
  }

  const payload = {
    provider,
    model,
    baseUrl,
    apiKey,
    customApiMode,
    customHeadersJson,
    openclawCommand: commandInput.value,
    skillsDirs
  };

  setSetupMessage(t('msg.savingConfig'));
  const result = await invoke('save_config', { payload });

  if (!result.ok) {
    setSetupMessage(result.message || t('msg.saveFailed'), 'error');
    return;
  }

  setSetupMessage(t('msg.saveSuccess'));
  await refreshKernelStatus();
  const cmd = (commandInput.value || '').trim().toLowerCase();
  const shouldAutoInstallKernel = !kernelStatus?.installed && (!cmd || cmd === 'openclaw');
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
});

async function handleKernelInstall(buttonLabel) {
  setSetupMessage(t('msg.runningAction', { label: buttonLabel }));
  const result = await invoke('install_or_update_kernel');
  if (!result.ok) {
    setSetupMessage(t('msg.actionFailed', { label: buttonLabel, message: result.message }), 'error');
    doctorOutput.textContent = `${result.message}\n\n${result.detail || ''}`.trim();
    await refreshKernelStatus();
    return;
  }

  setSetupMessage(result.message || `${buttonLabel}成功。`, 'success');
  doctorOutput.textContent = `${result.message}\n\n${result.detail || ''}`.trim();
  await refreshKernelStatus();
}

async function openOpenClawWeb() {
  const result = await invoke('get_dashboard_url');
  if (!result.ok) {
    const detail = (result.detail || '').trim();
    const message = `${result.message}${detail ? `\n\n${detail}` : ''}`.trim();
    setSetupMessage(result.message || t('msg.enterWebFailed'), 'error');
    doctorOutput.textContent = message;
    return false;
  }

  const url = (result.detail || '').trim();
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    setSetupMessage(t('msg.invalidDashboardUrl'), 'error');
    doctorOutput.textContent = url || t('msg.noDashboardUrl');
    return false;
  }

  setSetupMessage(t('msg.enteringWeb'), 'success');
  doctorOutput.textContent = t('msg.openclawWeb', { url });
  window.location.assign(url);
  return true;
}

installKernelBtn.addEventListener('click', async () => {
  await handleKernelInstall(t('btn.installKernel'));
});

updateKernelBtn.addEventListener('click', async () => {
  doctorOutput.textContent = t('msg.updatingKernel');
  await handleKernelInstall(t('btn.updateKernel'));
});

openWebBtn.addEventListener('click', async () => {
  doctorOutput.textContent = t('msg.gettingDashboard');
  await openOpenClawWeb();
});

doctorBtn.addEventListener('click', async () => {
  doctorOutput.textContent = t('msg.checkingCommand');
  const result = await invoke('run_doctor');
  doctorOutput.textContent = `${result.message}\n\n${result.detail || ''}`.trim();
});

openSkillDirBtn.addEventListener('click', async () => {
  const state = await invoke('get_state');
  const firstSkillDir = state?.config?.skillsDirs?.[0];
  if (!firstSkillDir) {
    doctorOutput.textContent = t('msg.noSkillDirToOpen');
    return;
  }

  await openPath(firstSkillDir);
});

reconfigureBtn.addEventListener('click', async () => {
  rawConfig = await invoke('read_raw_config');
  providerInput.value = 'custom';
  setModelValue(rawConfig?.model || '');
  baseUrlInput.value = rawConfig?.baseUrl || '';
  commandInput.value = rawConfig?.openclawCommand || 'openclaw';
  customApiModeInput.value = rawConfig?.customApiMode || 'openai-completions';
  customHeadersInput.value = rawConfig?.customHeaders
    ? JSON.stringify(rawConfig.customHeaders, null, 2)
    : '';
  apiKeyInput.value = rawConfig?.apiKey || '';
  skillsDirs = dedupeSkillsDirs(rawConfig?.skillsDirs || []);
  renderSkillsDirs();
  refreshCustomInputs();
  renderModelSuggestions([]);
  lastModelFetchKey = '';
  if (providerInput.value === 'custom' && baseUrlInput.value.trim()) {
    await fetchModels({ silent: true });
  }
  setSetupMessage('');
  showSetup();
});

providerInput.addEventListener('change', async () => {
  refreshCustomInputs();
  renderModelSuggestions([]);
  lastModelFetchKey = '';
  if (providerInput.value.trim() === 'custom' && baseUrlInput.value.trim()) {
    await fetchModels({ silent: true });
  }
});

fetchModelsBtn.addEventListener('click', async () => {
  await fetchModels({ force: true });
});

baseUrlInput.addEventListener('blur', async () => {
  await fetchModels({ silent: true, force: true });
});

apiKeyInput.addEventListener('blur', async () => {
  await fetchModels({ silent: true, force: true });
});

customApiModeInput.addEventListener('change', async () => {
  await fetchModels({ silent: true, force: true });
});

customHeadersInput.addEventListener('blur', async () => {
  await fetchModels({ silent: true, force: true });
});

langSelect.addEventListener('change', async () => {
  currentLang = langSelect.value;
  localStorage.setItem('openclaw.ui.lang', currentLang);
  applyI18n();
  renderModelSuggestions([]);
  renderSkillsDirs();
  const state = await invoke('get_state');
  if (state.isConfigured && state.config) {
    const configPath = await invoke('get_config_path');
    renderSummary(state.config, configPath);
    await refreshKernelStatus();
  }
});

initLanguage();
loadState();
