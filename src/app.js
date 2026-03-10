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
const modelSuggestions = document.getElementById('modelSuggestions');
const skillsList = document.getElementById('skillsList');
const summarySkillsList = document.getElementById('summarySkillsList');
const setupMessage = document.getElementById('setupMessage');
const doctorOutput = document.getElementById('doctorOutput');

const platformBadge = document.getElementById('platformBadge');
const summaryProvider = document.getElementById('summaryProvider');
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

let skillsDirs = [];
let rawConfig = null;
let kernelStatus = null;
let lastModelFetchKey = '';

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

function renderModelSuggestions(models = []) {
  modelSuggestions.innerHTML = '';
  for (const modelId of models) {
    const option = document.createElement('option');
    option.value = modelId;
    modelSuggestions.appendChild(option);
  }
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
      setSetupMessage('当前仅支持 Custom Provider 拉取模型。', 'error');
    }
    return false;
  }

  if (!baseUrl) {
    if (!silent) {
      setSetupMessage('请先填写 Base URL。', 'error');
    }
    return false;
  }

  const key = currentFetchKey();
  if (!force && key === lastModelFetchKey) {
    return true;
  }

  if (!silent) {
    setSetupMessage('正在拉取模型列表...');
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
      setSetupMessage('拉取模型失败。', 'error');
      doctorOutput.textContent = String(error || '未知错误');
    }
    return false;
  }
  if (!result.ok) {
    if (!silent) {
      setSetupMessage(result.message || '拉取模型失败。', 'error');
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
    setSetupMessage(result.message || `已拉取 ${models.length} 个模型。`, 'success');
  }

  return true;
}

function renderSkillsDirs() {
  skillsList.innerHTML = '';

  if (skillsDirs.length === 0) {
    const li = document.createElement('li');
    li.innerHTML = '<span>未配置 skills 目录</span>';
    skillsList.appendChild(li);
    return;
  }

  skillsDirs.forEach((dirPath, index) => {
    const li = document.createElement('li');
    const pathLabel = document.createElement('span');
    pathLabel.textContent = dirPath;

    const removeButton = document.createElement('button');
    removeButton.className = 'remove-btn';
    removeButton.textContent = '移除';
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
  summaryProvider.textContent = config.provider || '-';
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
    span.textContent = '未配置（可选）';
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
    return '未知';
  }
  if (status.installed) {
    const version = status.version || 'unknown';
    const source = (status.source || '').trim();
    if (source === 'bundled-kernel' || source === 'bundled-bin') {
      return `已内置 (${version})`;
    }
    if (source === 'managed-kernel') {
      return `已安装 (${version})`;
    }
    return `可用 (${version})`;
  }
  if (!status.npmAvailable) {
    return '未安装（未检测到 npm，且未发现内置内核）';
  }
  return '未安装';
}

async function refreshKernelStatus() {
  try {
    kernelStatus = await invoke('get_kernel_status');
    summaryKernel.textContent = formatKernelStatus(kernelStatus);
  } catch {
    kernelStatus = null;
    summaryKernel.textContent = '未知';
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
  providerInput.value = rawConfig?.provider || 'openai';
  modelInput.value = rawConfig?.model || '';
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
    title: '选择 skills 目录'
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
      title: '选择导入默认 skills 的目标目录'
    });
    if (!selected || Array.isArray(selected)) {
      return;
    }
    targetDir = selected;
    skillsDirs = dedupeSkillsDirs([...skillsDirs, targetDir]);
    renderSkillsDirs();
  }

  setSetupMessage('正在导入内置 skills...');
  const result = await invoke('install_default_skills', { targetDir });
  if (!result.ok) {
    setSetupMessage(result.message || '导入失败。', 'error');
    return;
  }

  setSetupMessage(`已导入内置 skills 到: ${result.copiedTo}`, 'success');
});

saveBtn.addEventListener('click', async () => {
  const apiKey = apiKeyInput.value.trim() || rawConfig?.apiKey || '';
  const model = modelInput.value.trim();
  const baseUrl = baseUrlInput.value.trim();
  const provider = providerInput.value.trim();
  const customApiMode = customApiModeInput.value.trim() || 'openai-completions';
  const customHeadersJson = customHeadersInput.value.trim();

  if (!model) {
    setSetupMessage('Model 不能为空。', 'error');
    return;
  }

  if (provider === 'custom' && !baseUrl) {
    setSetupMessage('Provider 为 custom 时，Base URL 不能为空。', 'error');
    return;
  }

  if (provider === 'custom' && customHeadersJson) {
    try {
      const parsed = JSON.parse(customHeadersJson);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Custom Headers 必须是 JSON 对象。');
      }
      for (const [key, value] of Object.entries(parsed)) {
        if (typeof value !== 'string') {
          throw new Error(`Header ${key} 的值必须是字符串。`);
        }
      }
    } catch (error) {
      setSetupMessage(`Custom Headers JSON 格式错误：${error.message}`, 'error');
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

  setSetupMessage('正在保存配置...');
  const result = await invoke('save_config', { payload });

  if (!result.ok) {
    setSetupMessage(result.message || '保存失败。', 'error');
    return;
  }

  setSetupMessage('配置保存成功。');
  await refreshKernelStatus();
  const cmd = (commandInput.value || '').trim().toLowerCase();
  const shouldAutoInstallKernel = !kernelStatus?.installed && (!cmd || cmd === 'openclaw');
  if (shouldAutoInstallKernel) {
    setSetupMessage('正在自动安装 OpenClaw 内核（npm i openclaw）...');
    const kernelResult = await invoke('install_or_update_kernel');
    if (!kernelResult.ok) {
      setSetupMessage(
        `配置已保存，但内核自动安装失败：${kernelResult.message}（可稍后手动点击“安装/更新 OpenClaw 内核”）`,
        'error'
      );
    } else {
      setSetupMessage('配置与内核均已就绪，正在进入应用...', 'success');
    }
  } else {
    setSetupMessage('配置保存成功，正在进入应用...', 'success');
  }
  const opened = await openOpenClawWeb();
  if (!opened) {
    await loadState();
  }
});

async function handleKernelInstall(buttonLabel) {
  setSetupMessage(`正在${buttonLabel}（npm i openclaw）...`);
  const result = await invoke('install_or_update_kernel');
  if (!result.ok) {
    setSetupMessage(`${buttonLabel}失败：${result.message}`, 'error');
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
    setSetupMessage(result.message || '进入 OpenClaw Web 失败。', 'error');
    doctorOutput.textContent = message;
    return false;
  }

  const url = (result.detail || '').trim();
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    setSetupMessage('进入 OpenClaw Web 失败：返回的地址无效。', 'error');
    doctorOutput.textContent = url || '未返回可用 URL';
    return false;
  }

  setSetupMessage('正在进入 OpenClaw Web...', 'success');
  doctorOutput.textContent = `OpenClaw Web: ${url}`;
  window.location.assign(url);
  return true;
}

installKernelBtn.addEventListener('click', async () => {
  await handleKernelInstall('安装/更新内核');
});

updateKernelBtn.addEventListener('click', async () => {
  doctorOutput.textContent = '正在更新 OpenClaw 内核（npm i openclaw）...';
  await handleKernelInstall('更新内核');
});

openWebBtn.addEventListener('click', async () => {
  doctorOutput.textContent = '正在获取 OpenClaw Web 地址...';
  await openOpenClawWeb();
});

doctorBtn.addEventListener('click', async () => {
  doctorOutput.textContent = '正在检查 openclaw 命令...';
  const result = await invoke('run_doctor');
  doctorOutput.textContent = `${result.message}\n\n${result.detail || ''}`.trim();
});

openSkillDirBtn.addEventListener('click', async () => {
  const state = await invoke('get_state');
  const firstSkillDir = state?.config?.skillsDirs?.[0];
  if (!firstSkillDir) {
    doctorOutput.textContent = '没有可打开的 skills 目录。';
    return;
  }

  await openPath(firstSkillDir);
});

reconfigureBtn.addEventListener('click', async () => {
  rawConfig = await invoke('read_raw_config');
  providerInput.value = rawConfig?.provider || 'openai';
  modelInput.value = rawConfig?.model || '';
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

loadState();
