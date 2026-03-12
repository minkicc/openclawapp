// @ts-nocheck
import { invoke } from '@tauri-apps/api/tauri';
import { open as openDialog } from '@tauri-apps/api/dialog';
import { open as openPath } from '@tauri-apps/api/shell';
import QRCode from 'qrcode';

const setupView = document.getElementById('setupView') as any;
const mainView = document.getElementById('mainView') as any;
const providerInput = document.getElementById('providerInput') as any;
const modelInput = document.getElementById('modelInput') as any;
const apiKeyInput = document.getElementById('apiKeyInput') as any;
const baseUrlInput = document.getElementById('baseUrlInput') as any;
const commandInput = document.getElementById('commandInput') as any;
const customApiModeInput = document.getElementById('customApiModeInput') as any;
const customHeadersInput = document.getElementById('customHeadersInput') as any;
const fetchModelsBtn = document.getElementById('fetchModelsBtn') as any;
const skillsList = document.getElementById('skillsList') as any;
const summarySkillsList = document.getElementById('summarySkillsList') as any;
const setupMessage = document.getElementById('setupMessage') as any;
const doctorOutput = document.getElementById('doctorOutput') as any;

const platformBadge = document.getElementById('platformBadge') as any;
const summaryModel = document.getElementById('summaryModel') as any;
const summaryApiKey = document.getElementById('summaryApiKey') as any;
const summaryBaseUrl = document.getElementById('summaryBaseUrl') as any;
const summaryCommand = document.getElementById('summaryCommand') as any;
const summaryCustomApiMode = document.getElementById('summaryCustomApiMode') as any;
const summaryCustomHeaders = document.getElementById('summaryCustomHeaders') as any;
const summaryKernel = document.getElementById('summaryKernel') as any;
const summaryConfigPath = document.getElementById('summaryConfigPath') as any;

const addSkillDirBtn = document.getElementById('addSkillDirBtn') as any;
const installDefaultsBtn = document.getElementById('installDefaultsBtn') as any;
const saveBtn = document.getElementById('saveBtn') as any;
const installKernelBtn = document.getElementById('installKernelBtn') as any;
const openWebBtn = document.getElementById('openWebBtn') as any;
const doctorBtn = document.getElementById('doctorBtn') as any;
const updateKernelBtn = document.getElementById('updateKernelBtn') as any;
const openSkillDirBtn = document.getElementById('openSkillDirBtn') as any;
const reconfigureBtn = document.getElementById('reconfigureBtn') as any;
const langSelect = document.getElementById('langSelect') as any;
const pairChannelToggleBtn = document.getElementById('pairChannelToggleBtn') as any;
const pairCreateChannelBtn = document.getElementById('pairCreateChannelBtn') as any;
const pairReloadConfigBtn = document.getElementById('pairReloadConfigBtn') as any;
const pairStatusMessage = document.getElementById('pairStatusMessage') as any;
const pairWsStatus = document.getElementById('pairWsStatus') as any;
const pairChannelCount = document.getElementById('pairChannelCount') as any;
const pairChannelList = document.getElementById('pairChannelList') as any;
const pairQrDialog = document.getElementById('pairQrDialog') as any;
const pairChatDraftInput = document.getElementById('pairChatDraftInput') as any;
const pairChatSendBtn = document.getElementById('pairChatSendBtn') as any;
const pairChatCloseBtn = document.getElementById('pairChatCloseBtn') as any;
const pairChatDialog = document.getElementById('pairChatDialog') as any;
const pairChatDialogTitle = document.getElementById('pairChatDialogTitle') as any;
const pairChatMessages = document.getElementById('pairChatMessages') as any;
const pairQrCloseBtn = document.getElementById('pairQrCloseBtn') as any;
const pairQrImage = document.getElementById('pairQrImage') as any;
const pairEventLog = document.getElementById('pairEventLog') as any;

let skillsDirs = [];
let rawConfig = null;
let kernelStatus = null;
let lastModelFetchKey = '';
let currentLang = 'zh-CN';
const DEFAULT_CUSTOM_API_MODE = 'openai-responses';
let pairWs = null;
let pairChannelMode = 'none';
let pairDesiredConnected = false;
let pairReconnectTimer = null;
let pairReconnectAttempts = 0;
let pairLanIpv4Promise = null;
let pairWsRequestSeq = 0;
let pairChannelOpen = false;
let pairConfiguredServerUrl = '';
let pairConfiguredDeviceId = '';
let activeChatChannelId = '';
const pairChannels = [];
const pairWsPendingRequests = new Map();

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1']);

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
    'btn.pairChannelOpen': '开放通道',
    'btn.pairChannelClose': '关闭通道',
    'btn.pairCreateChannel': '新建渠道',
    'btn.pairReloadConfig': '刷新配置',
    'btn.pairChatSend': '发送',
    'btn.close': '关闭',
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
    'pair.title': '通信渠道',
    'pair.hint': '作为 Agent 宿主机，你可以开放通信通道并新建渠道。移动端扫码后会形成独立会话卡片。',
    'pair.wsStatus': '通道状态',
    'pair.channelCount': '渠道数量',
    'pair.chatDraft': '发送消息',
    'pair.chatDraftPlaceholder': '输入消息，Ctrl/Cmd + Enter 发送',
    'pair.card.statusPending': '待认领',
    'pair.card.statusActive': '已连接',
    'pair.card.statusOffline': '离线',
    'pair.card.name': '渠道名称',
    'pair.card.id': '渠道 ID',
    'pair.card.mobile': '移动端设备',
    'pair.card.createdAt': '创建时间',
    'pair.card.status': '连接状态',
    'pair.card.openQr': '二维码',
    'pair.card.openChat': '查看会话',
    'pair.card.delete': '删除渠道',
    'pair.toggle.on': '通道已开放（点击关闭）',
    'pair.toggle.off': '通道已关闭（点击开放）',
    'pair.empty': '暂无渠道，点击“新建渠道”创建。',
    'pair.qrDialogTitle': '渠道二维码',
    'pair.chatDialogTitle': '渠道会话',
    'pair.chatPlaceholder': '暂无消息',
    'pair.qrPayload': '二维码载荷（JSON）',
    'pair.logPrefix': '配对日志',
    'pair.status.disconnected': '未连接',
    'pair.status.connecting': '连接中',
    'pair.status.connected': '已连接',
    'pair.status.reconnecting': '重连中',
    'msg.pairMissingConfig': '通信渠道配置缺失，请在配置文件中补充 channelServerBaseUrl 与 channelDeviceId。',
    'msg.pairConnecting': '正在连接配对通道...',
    'msg.pairConnected': '配对通道已连接。',
    'msg.pairDisconnected': '配对通道已断开。',
    'msg.pairReconnect': '通道中断，{seconds}s 后自动重连（第 {attempt} 次）。',
    'msg.pairCreateRunning': '正在创建配对会话...',
    'msg.pairCreateFailed': '创建配对会话失败：{message}',
    'msg.pairCreated': '配对会话已创建，等待移动端扫码认领。',
    'msg.pairClaimed': '配对成功。',
    'msg.pairAlreadyPaired': '该移动端（{mobileId}）已配对过，不能重复新建渠道。',
    'msg.pairNeedMobileId': '当前渠道未绑定移动端，无法发送消息。',
    'msg.pairNeedChatMessage': '请输入消息内容。',
    'msg.pairChatSent': '消息已发送。',
    'msg.pairConfigReloaded': '已刷新通信渠道配置。',
    'msg.pairDeleteConfirm': '确认删除渠道 {id} 吗？',
    'msg.pairDeleted': '渠道已删除。',
    'msg.pairRevokeFailed': '服务端解绑失败：{message}',
    'pair.check.idle': '未验证',
    'pair.check.pending': '检查中',
    'pair.check.ok': '可用',
    'pair.check.error': '失败',
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
    'btn.pairChannelOpen': 'Open Channel',
    'btn.pairChannelClose': 'Close Channel',
    'btn.pairCreateChannel': 'New Channel',
    'btn.pairReloadConfig': 'Reload Config',
    'btn.pairChatSend': 'Send',
    'btn.close': 'Close',
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
    'pair.title': 'Communication Channels',
    'pair.hint': 'As the Agent host, open the channel and create channel cards. Mobile scans QR to attach.',
    'pair.wsStatus': 'Channel Status',
    'pair.channelCount': 'Channel Count',
    'pair.chatDraft': 'Message',
    'pair.chatDraftPlaceholder': 'Type message, Ctrl/Cmd + Enter to send',
    'pair.card.statusPending': 'Pending',
    'pair.card.statusActive': 'Connected',
    'pair.card.statusOffline': 'Offline',
    'pair.card.name': 'Channel Name',
    'pair.card.id': 'Channel ID',
    'pair.card.mobile': 'Mobile Device',
    'pair.card.createdAt': 'Created At',
    'pair.card.status': 'Connection',
    'pair.card.openQr': 'QR Code',
    'pair.card.openChat': 'Open Chat',
    'pair.card.delete': 'Delete',
    'pair.toggle.on': 'Channel Open (Click To Close)',
    'pair.toggle.off': 'Channel Closed (Click To Open)',
    'pair.empty': 'No channel yet. Click "New Channel".',
    'pair.qrDialogTitle': 'Channel QR',
    'pair.chatDialogTitle': 'Channel Chat',
    'pair.chatPlaceholder': 'No messages',
    'pair.qrPayload': 'QR Payload (JSON)',
    'pair.logPrefix': 'Pair Log',
    'pair.status.disconnected': 'Disconnected',
    'pair.status.connecting': 'Connecting',
    'pair.status.connected': 'Connected',
    'pair.status.reconnecting': 'Reconnecting',
    'msg.pairMissingConfig': 'Missing channel config. Please set channelServerBaseUrl and channelDeviceId in config file.',
    'msg.pairConnecting': 'Connecting pair channel...',
    'msg.pairConnected': 'Pair channel connected.',
    'msg.pairDisconnected': 'Pair channel disconnected.',
    'msg.pairReconnect': 'Channel dropped. Reconnecting in {seconds}s (attempt {attempt}).',
    'msg.pairCreateRunning': 'Creating pair session...',
    'msg.pairCreateFailed': 'Failed to create pair session: {message}',
    'msg.pairCreated': 'Pair session created. Waiting for mobile claim.',
    'msg.pairClaimed': 'Pair successful.',
    'msg.pairAlreadyPaired': 'This mobile ({mobileId}) is already paired. Duplicate channel creation is blocked.',
    'msg.pairNeedMobileId': 'This channel is not bound to a mobile yet.',
    'msg.pairNeedChatMessage': 'Please enter a message first.',
    'msg.pairChatSent': 'Message sent.',
    'msg.pairConfigReloaded': 'Communication channel config reloaded.',
    'msg.pairDeleteConfirm': 'Delete channel {id}?',
    'msg.pairDeleted': 'Channel deleted.',
    'msg.pairRevokeFailed': 'Server revoke failed: {message}',
    'pair.check.idle': 'Not Verified',
    'pair.check.pending': 'Checking',
    'pair.check.ok': 'Available',
    'pair.check.error': 'Failed',
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

  if (isPairCenterAvailable()) {
    renderPairChannelCards();
    updatePairButtons();
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

function setSetupMessage(message, type = '') {
  setupMessage.textContent = message || '';
  setupMessage.className = `message ${type}`.trim();
}

function isPairCenterAvailable() {
  return Boolean(
      pairChannelToggleBtn &&
      pairCreateChannelBtn &&
      pairReloadConfigBtn &&
      pairStatusMessage &&
      pairWsStatus &&
      pairChannelCount &&
      pairChannelList &&
      pairQrDialog &&
      pairChatDraftInput &&
      pairChatSendBtn &&
      pairChatCloseBtn &&
      pairChatDialog &&
      pairChatDialogTitle &&
      pairChatMessages &&
      pairQrCloseBtn &&
      pairQrImage &&
      pairEventLog
  );
}

function setPairMessage(message, type = '') {
  if (!pairStatusMessage) {
    return;
  }
  pairStatusMessage.textContent = message || '';
  pairStatusMessage.className = `message ${type}`.trim();
}

function appendPairEvent(line) {
  if (!pairEventLog) {
    return;
  }
  const now = new Date();
  const stamp = `${now.toLocaleDateString()} ${now.toLocaleTimeString()}`;
  const next = `[${stamp}] ${line}`;
  pairEventLog.textContent = pairEventLog.textContent
    ? `${pairEventLog.textContent}\n${next}`
    : next;
  pairEventLog.scrollTop = pairEventLog.scrollHeight;
}

function formatPairTs(ts) {
  const n = Number(ts || 0);
  if (Number.isFinite(n) && n > 0) {
    return new Date(n).toLocaleString();
  }
  return new Date().toLocaleString();
}

function escapePairHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function pairNameSuffix(seed) {
  const normalized = String(seed || '')
    .trim()
    .replace(/_/g, '')
    .replace(/[^a-zA-Z0-9]/g, '');
  if (normalized) {
    return normalized.slice(-6);
  }
  return Date.now().toString().slice(-6);
}

function defaultPairChannelName(seed) {
  return `连接-${pairNameSuffix(seed)}`;
}

function findPairChannelById(channelId) {
  return pairChannels.find((item) => item.channelId === channelId) || null;
}

function findPairChannelByMobileId(mobileId) {
  const target = String(mobileId || '').trim();
  if (!target) {
    return null;
  }
  return pairChannels.find((item) => String(item.mobileId || '').trim() === target) || null;
}

function upsertPairChannel(channel) {
  const channelId = String(channel?.channelId || '').trim();
  if (!channelId) {
    return null;
  }
  const existing = findPairChannelById(channelId);
  if (existing) {
    Object.assign(existing, channel);
    existing.name = String(existing.name || '').trim() || defaultPairChannelName(existing.mobileId || existing.sessionId || existing.channelId);
    if (!Array.isArray(existing.messages)) {
      existing.messages = [];
    }
    return existing;
  }
  const next = {
    channelId,
    sessionId: String(channel?.sessionId || channelId),
    name: String(channel?.name || '').trim() || defaultPairChannelName(channel?.mobileId || channel?.sessionId || channelId),
    mobileId: String(channel?.mobileId || '').trim(),
    userId: String(channel?.userId || '').trim(),
    bindingId: String(channel?.bindingId || '').trim(),
    status: String(channel?.status || 'pending'),
    createdAt: Number(channel?.createdAt || Date.now()),
    qrPayload: channel?.qrPayload || null,
    messages: Array.isArray(channel?.messages) ? channel.messages : []
  };
  pairChannels.push(next);
  return next;
}

function channelStatusLabel(status) {
  if (status === 'active') {
    return t('pair.card.statusActive');
  }
  if (status === 'offline') {
    return t('pair.card.statusOffline');
  }
  return t('pair.card.statusPending');
}

function renderPairChannelCards() {
  if (!pairChannelList) {
    return;
  }
  pairChannelCount.textContent = String(pairChannels.length);
  if (pairChannels.length === 0) {
    pairChannelList.innerHTML = `<p class="pair-empty">${t('pair.empty')}</p>`;
    return;
  }

  const html = pairChannels
    .slice()
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    .map((channel) => {
      const mobileId = String(channel.mobileId || '').trim() || '-';
      const name = String(channel.name || '').trim() || defaultPairChannelName(channel.mobileId || channel.sessionId || channel.channelId);
      return `
        <article class="channel-card" data-channel-id="${escapePairHtml(channel.channelId)}">
          <div class="channel-card-grid">
            <div>
              <span>${t('pair.card.name')}</span>
              <input
                class="channel-name-input"
                type="text"
                data-action="rename-channel"
                data-channel-id="${escapePairHtml(channel.channelId)}"
                value="${escapePairHtml(name)}"
              />
            </div>
            <div><span>${t('pair.card.id')}</span><strong>${escapePairHtml(channel.channelId)}</strong></div>
            <div><span>${t('pair.card.mobile')}</span><strong>${escapePairHtml(mobileId)}</strong></div>
            <div><span>${t('pair.card.createdAt')}</span><strong>${formatPairTs(channel.createdAt)}</strong></div>
            <div><span>${t('pair.card.status')}</span><strong>${channelStatusLabel(channel.status)}</strong></div>
          </div>
          <div class="actions">
            <button class="btn-secondary" type="button" data-action="show-qr" data-channel-id="${escapePairHtml(channel.channelId)}">${t('pair.card.openQr')}</button>
            <button class="btn-primary" type="button" data-action="show-chat" data-channel-id="${escapePairHtml(channel.channelId)}">${t('pair.card.openChat')}</button>
            <button class="btn-secondary btn-danger-ghost" type="button" data-action="delete-channel" data-channel-id="${escapePairHtml(channel.channelId)}">${t('pair.card.delete')}</button>
          </div>
        </article>
      `;
    })
    .join('');
  pairChannelList.innerHTML = html;

  pairChannelList.querySelectorAll('input[data-action="rename-channel"]').forEach((inputEl) => {
    const commitRename = () => {
      const input = inputEl;
      const channelId = String(input.getAttribute('data-channel-id') || '').trim();
      const channel = findPairChannelById(channelId);
      if (!channel) {
        return;
      }
      const next = String(input.value || '').trim();
      channel.name = next || defaultPairChannelName(channel.mobileId || channel.sessionId || channel.channelId);
      renderPairChannelCards();
      if (activeChatChannelId === channel.channelId) {
        pairChatDialogTitle.textContent = `${t('pair.chatDialogTitle')} · ${channel.name}`;
      }
    };

    inputEl.addEventListener('change', commitRename);
    inputEl.addEventListener('blur', commitRename);
    inputEl.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        inputEl.blur();
      }
    });
  });

  pairChannelList.querySelectorAll('button[data-action="show-qr"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const channelId = String(btn.getAttribute('data-channel-id') || '').trim();
      await openPairQrDialog(channelId);
    });
  });
  pairChannelList.querySelectorAll('button[data-action="show-chat"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const channelId = String(btn.getAttribute('data-channel-id') || '').trim();
      openPairChatDialog(channelId);
    });
  });
  pairChannelList.querySelectorAll('button[data-action="delete-channel"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const channelId = String(btn.getAttribute('data-channel-id') || '').trim();
      await removePairChannel(channelId);
    });
  });
}

function closeDialogSafe(dialogEl) {
  if (!dialogEl) {
    return;
  }
  try {
    dialogEl.close();
  } catch {
    dialogEl.removeAttribute('open');
  }
}

function openDialogSafe(dialogEl) {
  if (!dialogEl) {
    return;
  }
  try {
    dialogEl.showModal();
  } catch {
    dialogEl.setAttribute('open', 'open');
  }
}

function renderPairChatMessages() {
  const channel = findPairChannelById(activeChatChannelId);
  if (!pairChatMessages || !channel) {
    return;
  }
  const messages = Array.isArray(channel.messages) ? channel.messages : [];
  if (messages.length === 0) {
    pairChatMessages.innerHTML = `<p class="pair-empty">${t('pair.chatPlaceholder')}</p>`;
    return;
  }
  pairChatMessages.innerHTML = messages
    .map((item) => {
      const who = item.from === 'desktop' ? 'PC' : 'Mobile';
      const cls = item.from === 'desktop' ? 'from-desktop' : 'from-mobile';
      return `
        <div class="pair-chat-item ${cls}">
          <div class="pair-chat-meta">${who} · ${formatPairTs(item.ts)}</div>
          <div class="pair-chat-text">${String(item.text || '').replace(/</g, '&lt;')}</div>
        </div>
      `;
    })
    .join('');
  pairChatMessages.scrollTop = pairChatMessages.scrollHeight;
}

function openPairChatDialog(channelId) {
  const channel = findPairChannelById(channelId);
  if (!channel) {
    return;
  }
  activeChatChannelId = channel.channelId;
  const title = String(channel.name || '').trim() || defaultPairChannelName(channel.mobileId || channel.sessionId || channel.channelId);
  pairChatDialogTitle.textContent = `${t('pair.chatDialogTitle')} · ${title}`;
  pairChatDraftInput.value = '';
  renderPairChatMessages();
  openDialogSafe(pairChatDialog);
  updatePairButtons();
}

async function openPairQrDialog(channelId) {
  const channel = findPairChannelById(channelId);
  if (!channel) {
    return;
  }
  const payload = channel.qrPayload && typeof channel.qrPayload === 'object' ? channel.qrPayload : {};
  await renderPairQrPreview(payload);
  openDialogSafe(pairQrDialog);
}

async function revokePairBinding(bindingId) {
  const id = String(bindingId || '').trim();
  if (!id) {
    return;
  }
  const baseUrl = getPairServerBaseUrl();
  const endpoint = buildPairHttpUrl(baseUrl, '/v1/pair/revoke');
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      bindingId: id
    })
  });
  let result = null;
  try {
    result = await response.json();
  } catch {
    result = null;
  }
  if (!response.ok || !result?.ok) {
    const message = result?.message || result?.error || `HTTP ${response.status}`;
    throw new Error(String(message));
  }
}

function removePairChannelLocal(channelId) {
  const normalizedId = String(channelId || '').trim();
  if (!normalizedId) {
    return null;
  }
  const index = pairChannels.findIndex((item) => item.channelId === normalizedId);
  if (index < 0) {
    return null;
  }
  const [removed] = pairChannels.splice(index, 1);
  if (activeChatChannelId === normalizedId) {
    activeChatChannelId = '';
    closeDialogSafe(pairChatDialog);
  }
  return removed || null;
}

async function removePairChannel(channelId) {
  const normalizedId = String(channelId || '').trim();
  if (!normalizedId) {
    return;
  }
  const channel = findPairChannelById(normalizedId);
  if (!channel) {
    return;
  }
  const confirmed = globalThis.confirm(t('msg.pairDeleteConfirm', { id: normalizedId }));
  if (!confirmed) {
    return;
  }

  if (channel.bindingId) {
    try {
      await revokePairBinding(channel.bindingId);
    } catch (error) {
      appendPairEvent(t('msg.pairRevokeFailed', { message: error?.message || String(error) }));
    }
  }

  removePairChannelLocal(normalizedId);
  renderPairChannelCards();
  updatePairButtons();
  setPairMessage(t('msg.pairDeleted'), 'success');
  appendPairEvent(`channel deleted: ${normalizedId}`);
}

function appendPairChannelMessage(channelId, message) {
  const channel = findPairChannelById(channelId);
  if (!channel) {
    return;
  }
  if (!Array.isArray(channel.messages)) {
    channel.messages = [];
  }
  channel.messages.push({
    id: `msg_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
    from: message.from === 'desktop' ? 'desktop' : 'mobile',
    text: String(message.text || ''),
    ts: Number(message.ts || Date.now())
  });
  if (activeChatChannelId === channelId) {
    renderPairChatMessages();
  }
}

function ensureChannelForMobile(mobileId) {
  const normalizedMobileId = String(mobileId || '').trim();
  if (!normalizedMobileId) {
    return null;
  }
  const existing = findPairChannelByMobileId(normalizedMobileId);
  if (existing) {
    return existing;
  }
  const pending = pairChannels.find((item) => item.status === 'pending');
  if (pending) {
    pending.mobileId = normalizedMobileId;
    pending.status = 'active';
    return pending;
  }
  return upsertPairChannel({
    channelId: `ch_${normalizedMobileId}`,
    sessionId: '',
    mobileId: normalizedMobileId,
    status: 'active',
    createdAt: Date.now(),
    qrPayload: null
  });
}

function clearPairQrPreview() {
  if (!pairQrImage) {
    return;
  }
  pairQrImage.removeAttribute('src');
  pairQrImage.classList.add('hidden');
}

async function renderPairQrPreview(payload) {
  if (!pairQrImage) {
    return;
  }
  if (!payload || typeof payload !== 'object') {
    clearPairQrPreview();
    return;
  }

  try {
    const content = JSON.stringify(payload);
    // Prefer SVG to avoid canvas/data URL issues on some embedded WebViews.
    const svg = await QRCode.toString(content, {
      type: 'svg',
      width: 220,
      margin: 1
    });
    const dataUrl = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
    pairQrImage.src = dataUrl;
    pairQrImage.classList.remove('hidden');
  } catch (error) {
    try {
      const content = JSON.stringify(payload);
      const fallback = await QRCode.toDataURL(content, {
        width: 220,
        margin: 1
      });
      pairQrImage.src = fallback;
      pairQrImage.classList.remove('hidden');
    } catch (fallbackError) {
      clearPairQrPreview();
      appendPairEvent(`render qr failed: ${fallbackError?.message || String(fallbackError)}`);
      setPairMessage(`二维码渲染失败：${fallbackError?.message || String(fallbackError)}`, 'error');
    }
  }
}

function createDefaultPairDeviceId() {
  const raw = globalThis.crypto?.randomUUID?.().replace(/-/g, '').slice(0, 12) || Math.random().toString(16).slice(2, 14);
  return `pc_${raw}`;
}

function normalizePairBaseUrl(raw) {
  const text = String(raw || '').trim();
  if (!text) {
    return '';
  }
  try {
    const parsed = new URL(text);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return '';
    }
    parsed.hash = '';
    parsed.search = '';
    parsed.pathname = parsed.pathname.replace(/\/+$/, '');
    return parsed.toString().replace(/\/+$/, '');
  } catch {
    return '';
  }
}

function isLoopbackPairHost(hostname) {
  const host = String(hostname || '').trim().toLowerCase();
  if (!host) {
    return true;
  }
  return LOOPBACK_HOSTS.has(host);
}

function isLoopbackPairBaseUrl(raw) {
  const normalized = normalizePairBaseUrl(raw);
  if (!normalized) {
    return false;
  }
  try {
    const parsed = new URL(normalized);
    return isLoopbackPairHost(parsed.hostname);
  } catch {
    return false;
  }
}

function isIpv4Address(raw) {
  const text = String(raw || '').trim();
  if (!text) {
    return false;
  }
  const parts = text.split('.');
  if (parts.length !== 4) {
    return false;
  }
  return parts.every((part) => {
    if (!/^\d+$/.test(part)) {
      return false;
    }
    const value = Number(part);
    return Number.isInteger(value) && value >= 0 && value <= 255;
  });
}

function withHost(baseUrl, hostname) {
  const normalized = normalizePairBaseUrl(baseUrl);
  if (!normalized) {
    return '';
  }
  try {
    const parsed = new URL(normalized);
    parsed.hostname = hostname;
    return parsed.toString().replace(/\/+$/, '');
  } catch {
    return '';
  }
}

async function detectPrimaryLanIpv4() {
  if (!pairLanIpv4Promise) {
    pairLanIpv4Promise = invoke('get_primary_lan_ipv4')
      .then((value) => {
        const ip = String(value || '').trim();
        return isIpv4Address(ip) ? ip : '';
      })
      .catch(() => '');
  }
  return pairLanIpv4Promise;
}

async function resolvePairQrBaseUrl({ configuredBaseUrl, payloadBaseUrl }) {
  const normalizedConfigured = normalizePairBaseUrl(configuredBaseUrl);
  if (normalizedConfigured && !isLoopbackPairBaseUrl(normalizedConfigured)) {
    return normalizedConfigured;
  }

  const normalizedPayload = normalizePairBaseUrl(payloadBaseUrl);
  if (normalizedPayload && !isLoopbackPairBaseUrl(normalizedPayload)) {
    return normalizedPayload;
  }

  const lanIpv4 = await detectPrimaryLanIpv4();
  if (lanIpv4) {
    const template = normalizedConfigured || normalizedPayload || 'http://127.0.0.1:38089';
    const resolved = withHost(template, lanIpv4);
    if (resolved) {
      return resolved;
    }
  }

  return normalizedPayload || normalizedConfigured || '';
}

async function sanitizePairQrPayload(rawPayload, configuredBaseUrl) {
  const payload = rawPayload && typeof rawPayload === 'object' ? { ...rawPayload } : {};
  const payloadBaseUrl = String(payload.base_url || payload.baseUrl || '').trim();
  const resolvedBaseUrl = await resolvePairQrBaseUrl({
    configuredBaseUrl,
    payloadBaseUrl
  });

  if (!resolvedBaseUrl) {
    return payload;
  }

  payload.base_url = resolvedBaseUrl;
  payload.baseUrl = resolvedBaseUrl;
  if (payloadBaseUrl && normalizePairBaseUrl(payloadBaseUrl) !== resolvedBaseUrl) {
    appendPairEvent(`qr base_url rewritten: ${payloadBaseUrl} -> ${resolvedBaseUrl}`);
  }

  return payload;
}

function getPairServerBaseUrl() {
  const raw = String(pairConfiguredServerUrl || '').trim();
  if (!raw || !normalizePairBaseUrl(raw)) {
    throw new Error(t('msg.pairMissingConfig'));
  }
  return normalizePairBaseUrl(raw);
}

function getPairDeviceId() {
  const raw = String(pairConfiguredDeviceId || '').trim();
  if (!raw) {
    throw new Error(t('msg.pairMissingConfig'));
  }
  return raw;
}

function getPairServerToken() {
  return '';
}

function buildPairHttpUrl(baseUrl, path) {
  const parsed = new URL(baseUrl);
  parsed.pathname = path;
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString();
}

function buildPairStreamUrl(baseUrl, deviceId) {
  const parsed = new URL(baseUrl);
  parsed.pathname = '/v1/signal/stream';
  parsed.search = `clientType=desktop&clientId=${encodeURIComponent(deviceId)}`;
  const token = getPairServerToken();
  if (token) {
    parsed.search += `&token=${encodeURIComponent(token)}`;
  }
  parsed.hash = '';
  return parsed.toString();
}

function buildPairWsUrl(baseUrl, deviceId) {
  const parsed = new URL(baseUrl);
  parsed.protocol = parsed.protocol === 'https:' ? 'wss:' : 'ws:';
  parsed.pathname = '/v1/signal/ws';
  parsed.search = `clientType=desktop&clientId=${encodeURIComponent(deviceId)}`;
  const token = getPairServerToken();
  if (token) {
    parsed.search += `&token=${encodeURIComponent(token)}`;
  }
  parsed.hash = '';
  return parsed.toString();
}

function isPairChannelOpen() {
  if (!pairWs) {
    return false;
  }
  if (pairChannelMode === 'ws') {
    return pairWs.readyState === WebSocket.OPEN;
  }
  if (pairChannelMode === 'sse') {
    return pairWs.readyState === EventSource.OPEN;
  }
  return false;
}

function isPairChannelConnecting() {
  if (!pairWs) {
    return false;
  }
  if (pairChannelMode === 'ws') {
    return pairWs.readyState === WebSocket.CONNECTING;
  }
  if (pairChannelMode === 'sse') {
    return pairWs.readyState === EventSource.CONNECTING;
  }
  return false;
}

function clearPairWsPendingRequests(reason = 'ws closed') {
  for (const [, pending] of pairWsPendingRequests) {
    if (pending.timer) {
      clearTimeout(pending.timer);
    }
    pending.reject(new Error(reason));
  }
  pairWsPendingRequests.clear();
}

function sendPairSignalViaWs({ toType, toId, type, payload = {} }) {
  if (pairChannelMode !== 'ws' || !pairWs || pairWs.readyState !== WebSocket.OPEN) {
    return Promise.reject(new Error('ws channel is not open'));
  }

  pairWsRequestSeq += 1;
  const requestId = `wsreq_${Date.now()}_${pairWsRequestSeq}`;

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pairWsPendingRequests.delete(requestId);
      reject(new Error(`send ${type} timeout`));
    }, 6000);

    pairWsPendingRequests.set(requestId, { resolve, reject, timer });
    try {
      pairWs.send(
        JSON.stringify({
          action: 'signal.send',
          requestId,
          data: {
            toType,
            toId,
            type,
            payload
          }
        })
      );
    } catch (error) {
      clearTimeout(timer);
      pairWsPendingRequests.delete(requestId);
      reject(error);
    }
  });
}

async function sendPairSignal({ toType, toId, type, payload = {} }) {
  if (!pairChannelOpen) {
    throw new Error('channel is closed');
  }
  if (isPairChannelOpen() && pairChannelMode === 'ws') {
    return sendPairSignalViaWs({ toType, toId, type, payload });
  }

  const baseUrl = getPairServerBaseUrl();
  const fromId = getPairDeviceId();
  const endpoint = buildPairHttpUrl(baseUrl, '/v1/signal/send');
  const serverToken = getPairServerToken();
  const headers = {
    'Content-Type': 'application/json'
  };
  if (serverToken) {
    headers.Authorization = `Bearer ${serverToken}`;
  }

  let response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        fromType: 'desktop',
        fromId,
        toType,
        toId,
        type,
        payload
      })
    });
  } catch (error) {
    throw new Error(`send ${type} network failed: ${error?.message || String(error)}`);
  }

  let result;
  try {
    result = await response.json();
  } catch {
    result = null;
  }

  if (!response.ok || !result?.ok) {
    const message = result?.message || result?.error || `HTTP ${response.status}`;
    throw new Error(`send ${type} failed: ${message}`);
  }

  return result;
}

async function sendPairChatMessage() {
  const channel = findPairChannelById(activeChatChannelId);
  if (!channel || !channel.mobileId) {
    setPairMessage(t('msg.pairNeedMobileId'), 'error');
    return;
  }
  const text = String(pairChatDraftInput?.value || '').trim();
  if (!text) {
    setPairMessage(t('msg.pairNeedChatMessage'), 'error');
    return;
  }

  try {
    const response = await sendPairSignal({
      toType: 'mobile',
      toId: channel.mobileId,
      type: 'chat.message',
      payload: {
        text,
        sentAt: Date.now(),
        from: 'desktop'
      }
    });
    const delivered = response?.deliveredRealtime === true ? 'realtime' : 'queued';
    appendPairChannelMessage(channel.channelId, { from: 'desktop', text, ts: Date.now() });
    appendPairEvent(`chat.message sent -> mobile=${channel.mobileId} (${delivered})`);
    setPairMessage(t('msg.pairChatSent'), 'success');
    pairChatDraftInput.value = '';
    updatePairButtons();
  } catch (error) {
    setPairMessage(`发送 chat.message 失败：${error?.message || String(error)}`, 'error');
    appendPairEvent(`chat.message failed: ${error?.message || String(error)}`);
  }
}

function renderPairWsStatus(status) {
  if (!pairWsStatus) {
    return;
  }

  let key = 'pair.status.disconnected';
  if (status === 'connecting') {
    key = 'pair.status.connecting';
  } else if (status === 'connected') {
    key = 'pair.status.connected';
  } else if (status === 'reconnecting') {
    key = 'pair.status.reconnecting';
  }
  pairWsStatus.textContent = t(key);
}

function resetPairReconnectTimer() {
  if (pairReconnectTimer) {
    clearTimeout(pairReconnectTimer);
    pairReconnectTimer = null;
  }
}

function cleanupPairWebSocket() {
  if (!pairWs) {
    pairChannelMode = 'none';
    return;
  }
  pairWs.onopen = null;
  pairWs.onmessage = null;
  pairWs.onerror = null;
  pairWs.onclose = null;
  try {
    pairWs.close();
  } catch {
    // no-op
  }
  pairWs = null;
  pairChannelMode = 'none';
  clearPairWsPendingRequests('ws channel closed');
}

function pairDeviceName() {
  const platform = navigator.platform || 'Desktop';
  return `OpenClaw Desktop (${platform})`;
}

function syncPairStorage() {
  // no-op: channel connection params are now sourced from config file
}

function updatePairButtons() {
  if (!isPairCenterAvailable()) {
    return;
  }
  const connected = isPairChannelOpen();
  const connecting = isPairChannelConnecting();
  const hasConfig = Boolean(pairConfiguredServerUrl && pairConfiguredDeviceId);
  const activeChatChannel = findPairChannelById(activeChatChannelId);
  const hasDraft = String(pairChatDraftInput?.value || '').trim().length > 0;
  pairChannelToggleBtn.classList.add('pair-toggle');
  pairChannelToggleBtn.classList.toggle('is-on', pairChannelOpen);
  pairChannelToggleBtn.classList.toggle('is-off', !pairChannelOpen);
  pairChannelToggleBtn.setAttribute('aria-pressed', pairChannelOpen ? 'true' : 'false');
  pairChannelToggleBtn.textContent = pairChannelOpen ? t('pair.toggle.on') : t('pair.toggle.off');
  pairChannelToggleBtn.disabled = connecting || !hasConfig;
  pairCreateChannelBtn.disabled = !hasConfig || !pairChannelOpen || connecting;
  pairChatSendBtn.disabled = !hasConfig || !pairChannelOpen || !connected || !activeChatChannel || !activeChatChannel.mobileId || !hasDraft;
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
  const customApiMode = customApiModeInput.value.trim() || DEFAULT_CUSTOM_API_MODE;
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
  const summaryMode = config.customApiMode || DEFAULT_CUSTOM_API_MODE;
  if (summaryCustomApiMode instanceof HTMLSelectElement) {
    summaryCustomApiMode.value = summaryMode;
  } else {
    summaryCustomApiMode.textContent = summaryMode;
  }
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

function schedulePairReconnect() {
  if (!pairDesiredConnected) {
    return;
  }
  resetPairReconnectTimer();
  pairReconnectAttempts += 1;
  const waitMs = Math.min(15_000, 1000 * Math.pow(2, Math.min(pairReconnectAttempts, 4)));
  const waitSec = Math.ceil(waitMs / 1000);
  setPairMessage(
    t('msg.pairReconnect', { seconds: waitSec, attempt: pairReconnectAttempts }),
    'error'
  );
  renderPairWsStatus('reconnecting');
  appendPairEvent(`ws reconnect scheduled in ${waitSec}s (attempt ${pairReconnectAttempts})`);

  pairReconnectTimer = setTimeout(() => {
    connectPairChannel({ fromReconnect: true }).catch(() => {
      // handled inside connectPairChannel
    });
  }, waitMs);
}

async function bindPairEnvelope(envelope) {
  if (!pairChannelOpen) {
    return;
  }
  if (!envelope || typeof envelope !== 'object') {
    return;
  }
  const eventType = String(envelope?.type || '').trim();
  const fromType = String(envelope?.from?.type || '').trim();
  const fromId = String(envelope?.from?.id || '').trim();
  const payload = envelope?.payload && typeof envelope.payload === 'object' ? envelope.payload : {};

  if (eventType === 'pair.claimed') {
    const mobileId = String(payload?.mobileId || payload?.mobile_id || '').trim();
    const userId = String(payload?.userId || payload?.user_id || '').trim();
    const sessionId = String(payload?.pairSessionId || payload?.pair_session_id || '').trim();
    const bindingId = String(payload?.bindingId || payload?.binding_id || '').trim();
    const channelBySession =
      (sessionId && pairChannels.find((item) => item.sessionId === sessionId || item.channelId === sessionId)) ||
      null;
    const channelByMobile = (mobileId && findPairChannelByMobileId(mobileId)) || null;

    // Keep only one channel per mobile device id.
    if (channelBySession && channelByMobile && channelBySession.channelId !== channelByMobile.channelId) {
      if (bindingId) {
        try {
          await revokePairBinding(bindingId);
        } catch (error) {
          appendPairEvent(t('msg.pairRevokeFailed', { message: error?.message || String(error) }));
        }
      }
      removePairChannelLocal(channelBySession.channelId);
      closeDialogSafe(pairQrDialog);
      renderPairChannelCards();
      updatePairButtons();
      setPairMessage(t('msg.pairAlreadyPaired', { mobileId: mobileId || '-' }), 'error');
      appendPairEvent(
        `duplicate claim blocked: session=${sessionId || '-'} mobile=${mobileId || '-'} kept=${channelByMobile.channelId}`
      );
      return;
    }

    let channel =
      channelBySession ||
      channelByMobile ||
      pairChannels.find((item) => item.status === 'pending') ||
      null;
    if (!channel) {
      channel = upsertPairChannel({
        channelId: sessionId || (mobileId ? `ch_${mobileId}` : `ch_${Date.now()}`),
        sessionId,
        mobileId,
        userId,
        bindingId,
        status: 'active',
        createdAt: Date.now()
      });
    }
    if (channel) {
      channel.status = 'active';
      if (mobileId) {
        channel.mobileId = mobileId;
      }
      if (userId) {
        channel.userId = userId;
      }
      if (bindingId) {
        channel.bindingId = bindingId;
      }
      renderPairChannelCards();
      updatePairButtons();
    }
    closeDialogSafe(pairQrDialog);
    setPairMessage(t('msg.pairClaimed'), 'success');
    appendPairEvent(`channel claimed: session=${sessionId || '-'} mobile=${mobileId || '-'} user=${userId || '-'}`);
    return;
  }

  if (fromType === 'mobile') {
    const channel = ensureChannelForMobile(fromId || payload?.mobileId || payload?.mobile_id || '');
    if (channel) {
      channel.status = pairChannelOpen ? 'active' : 'offline';
      if (eventType === 'chat.message') {
        const text = String(payload?.text || payload?.message || '').trim();
        appendPairChannelMessage(channel.channelId, {
          from: 'mobile',
          text: text || JSON.stringify(payload),
          ts: Number(envelope?.ts || Date.now())
        });
        setPairMessage(text ? `收到移动端消息：${text}` : '收到移动端消息', 'success');
      } else if (eventType === 'task.create') {
        const prompt = String(payload?.prompt || '').trim();
        appendPairChannelMessage(channel.channelId, {
          from: 'mobile',
          text: prompt ? `[task.create] ${prompt}` : '[task.create]',
          ts: Number(envelope?.ts || Date.now())
        });
      }
      renderPairChannelCards();
    }
  }

  if (eventType === 'channel.ping') {
    const checkId = String(payload?.checkId || payload?.check_id || '').trim();
    const mobileId = String(fromId || payload?.mobileId || payload?.mobile_id || '').trim();
    if (!checkId || !mobileId) {
      appendPairEvent('channel.ping ignored: missing checkId or mobileId');
      return;
    }
    try {
      const ackTs = Date.now();
      const response = await sendPairSignal({
        toType: 'mobile',
        toId: mobileId,
        type: 'channel.pong',
        payload: {
          checkId,
          pingTs: Number(payload?.sentAt || payload?.pingTs || 0) || 0,
          ackTs,
          deviceId: getPairDeviceId()
        }
      });
      const delivered = response?.deliveredRealtime === true ? 'realtime' : 'queued';
      appendPairEvent(`channel.pong sent -> mobile=${mobileId} checkId=${checkId} (${delivered})`);
    } catch (error) {
      appendPairEvent(`channel.pong failed: ${error?.message || String(error)}`);
    }
  }
}

async function connectPairChannel({ fromReconnect = false } = {}) {
  if (!isPairCenterAvailable()) {
    return;
  }
  if (!pairChannelOpen && !fromReconnect) {
    return;
  }

  let baseUrl;
  let deviceId;
  try {
    baseUrl = getPairServerBaseUrl();
    deviceId = getPairDeviceId();
  } catch (error) {
    setPairMessage(error.message || String(error), 'error');
    return;
  }

  syncPairStorage();
  pairDesiredConnected = true;
  resetPairReconnectTimer();
  cleanupPairWebSocket();

  renderPairWsStatus(fromReconnect ? 'reconnecting' : 'connecting');
  setPairMessage(t('msg.pairConnecting'));
  updatePairButtons();

  const wsUrl = buildPairWsUrl(baseUrl, deviceId);
  appendPairEvent(`connecting ws -> ${wsUrl}`);
  const ws = new WebSocket(wsUrl);
  pairWs = ws;
  pairChannelMode = 'ws';

  const opened = await new Promise((resolve) => {
    let settled = false;
    const settle = (ok) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(ok);
    };
    const timer = setTimeout(() => {
      settle(false);
    }, 3500);

    ws.onopen = () => {
      clearTimeout(timer);
      settle(true);
    };
    ws.onerror = () => {
      clearTimeout(timer);
      settle(false);
    };
    ws.onclose = () => {
      clearTimeout(timer);
      settle(false);
    };
  });

  if (!opened) {
    appendPairEvent('ws unavailable, fallback to sse');
    cleanupPairWebSocket();

    const streamUrl = buildPairStreamUrl(baseUrl, deviceId);
    appendPairEvent(`connecting signal stream -> ${streamUrl}`);
    const stream = new EventSource(streamUrl);
    pairWs = stream;
    pairChannelMode = 'sse';

    stream.onopen = () => {
      pairReconnectAttempts = 0;
      renderPairWsStatus('connected');
      setPairMessage(`${t('msg.pairConnected')} (SSE fallback)`, 'success');
      appendPairEvent('signal stream connected (sse)');
      pairChannels.forEach((channel) => {
        if (channel.status === 'offline' && channel.mobileId) {
          channel.status = 'active';
        }
      });
      renderPairChannelCards();
      updatePairButtons();
    };

    stream.onmessage = (event) => {
      const raw = String(event.data || '');
      try {
        const payload = JSON.parse(raw);
        const type = payload?.type || 'unknown';
        appendPairEvent(`recv ${type}: ${raw.slice(0, 300)}`);
        void bindPairEnvelope(payload);
      } catch {
        appendPairEvent(`recv(raw): ${raw.slice(0, 300)}`);
      }
    };

    stream.onerror = () => {
      appendPairEvent('signal stream reconnecting...');
      renderPairWsStatus('reconnecting');
      setPairMessage(t('pair.status.reconnecting'));
      pairChannels.forEach((channel) => {
        if (channel.status === 'active') {
          channel.status = 'offline';
        }
      });
      renderPairChannelCards();
      updatePairButtons();
    };
    return;
  }

  pairReconnectAttempts = 0;
  renderPairWsStatus('connected');
  setPairMessage(`${t('msg.pairConnected')} (WS)`, 'success');
  appendPairEvent('signal channel connected (ws)');
  pairChannels.forEach((channel) => {
    if (channel.status === 'offline' && channel.mobileId) {
      channel.status = 'active';
    }
  });
  renderPairChannelCards();
  updatePairButtons();

  ws.onopen = () => {
    // no-op; connection has already been established
  };

  ws.onmessage = (event) => {
    const raw = String(event.data || '');
    try {
      const payload = JSON.parse(raw);
      const kind = String(payload?.kind || '').trim().toLowerCase();
      if (kind === 'ack' || kind === 'error') {
        const requestId = String(payload?.requestId || '').trim();
        const pending = requestId ? pairWsPendingRequests.get(requestId) : null;
        if (pending) {
          clearTimeout(pending.timer);
          pairWsPendingRequests.delete(requestId);
          if (kind === 'ack' && payload?.ok !== false) {
            pending.resolve(payload);
          } else {
            pending.reject(new Error(String(payload?.message || payload?.code || 'ws request failed')));
          }
        }
        return;
      }
      if (kind === 'pong') {
        return;
      }

      const type = payload?.type || 'unknown';
      appendPairEvent(`recv ${type}: ${raw.slice(0, 300)}`);
      void bindPairEnvelope(payload);
    } catch {
      appendPairEvent(`recv(raw): ${raw.slice(0, 300)}`);
    }
  };

  ws.onerror = () => {
    appendPairEvent('ws channel error');
    renderPairWsStatus('reconnecting');
    updatePairButtons();
  };

  ws.onclose = () => {
    appendPairEvent('ws channel closed');
    clearPairWsPendingRequests('ws channel closed');
    pairChannels.forEach((channel) => {
      if (channel.status === 'active') {
        channel.status = 'offline';
      }
    });
    renderPairChannelCards();
    if (pairDesiredConnected) {
      schedulePairReconnect();
    } else {
      renderPairWsStatus('disconnected');
      updatePairButtons();
    }
  };
}

function disconnectPairChannel() {
  if (!isPairCenterAvailable()) {
    return;
  }
  pairChannelOpen = false;
  pairDesiredConnected = false;
  pairReconnectAttempts = 0;
  resetPairReconnectTimer();
  cleanupPairWebSocket();
  renderPairWsStatus('disconnected');
  setPairMessage(t('msg.pairDisconnected'));
  appendPairEvent('ws disconnected by user');
  pairChannels.forEach((channel) => {
    if (channel.status === 'active') {
      channel.status = 'offline';
    }
  });
  renderPairChannelCards();
  updatePairButtons();
}

async function createPairSession() {
  if (!isPairCenterAvailable()) {
    return;
  }

  let baseUrl;
  let deviceId;
  try {
    baseUrl = getPairServerBaseUrl();
    deviceId = getPairDeviceId();
  } catch (error) {
    setPairMessage(error.message || String(error), 'error');
    return;
  }

  syncPairStorage();
  if (!isPairChannelOpen()) {
    await connectPairChannel();
  }

  const endpoint = buildPairHttpUrl(baseUrl, '/pair/create');
  const serverToken = getPairServerToken();
  const headers = {
    'Content-Type': 'application/json'
  };
  if (serverToken) {
    headers.Authorization = `Bearer ${serverToken}`;
  }
  setPairMessage(t('msg.pairCreateRunning'));
  appendPairEvent(`create pair session -> ${endpoint}`);
  clearPairQrPreview();

  let response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        device_id: deviceId,
        device_name: pairDeviceName()
      })
    });
  } catch (error) {
    setPairMessage(t('msg.pairCreateFailed', { message: error.message || String(error) }), 'error');
    return;
  }

  let result;
  try {
    result = await response.json();
  } catch {
    result = null;
  }

  if (!response.ok || !result?.ok || !result?.data) {
    const message = result?.error || result?.message || `HTTP ${response.status}`;
    setPairMessage(t('msg.pairCreateFailed', { message }), 'error');
    appendPairEvent(`create failed: ${message}`);
    return;
  }

  const data = result.data;
  const qrPayload = await sanitizePairQrPayload(data.qr_payload || {}, baseUrl);
  upsertPairChannel({
    channelId: String(data.session_id || `ch_${Date.now()}`),
    sessionId: String(data.session_id || ''),
    status: 'pending',
    mobileId: '',
    userId: '',
    createdAt: Date.now(),
    qrPayload,
    messages: []
  });
  renderPairChannelCards();
  setPairMessage(t('msg.pairCreated'), 'success');
  appendPairEvent(`session ${data.session_id || '-'} created`);
  await openPairQrDialog(String(data.session_id || ''));
  updatePairButtons();
}

function applyPairConfigFromRawConfig() {
  const baseUrl = normalizePairBaseUrl(
    rawConfig?.channelServerBaseUrl || rawConfig?.pairServerBaseUrl || rawConfig?.pairServerUrl || ''
  );
  const deviceId = String(
    rawConfig?.channelDeviceId || rawConfig?.pairDeviceId || ''
  ).trim();
  pairConfiguredServerUrl = baseUrl;
  pairConfiguredDeviceId = deviceId;
}

async function refreshPairChannelConfig({ reconnectIfOpen = true } = {}) {
  try {
    const latest = await invoke('read_raw_config');
    if (latest) {
      rawConfig = latest;
    }
    applyPairConfigFromRawConfig();

    if (!pairConfiguredServerUrl || !pairConfiguredDeviceId) {
      if (pairChannelOpen) {
        disconnectPairChannel();
      }
      setPairMessage(t('msg.pairMissingConfig'), 'error');
      updatePairButtons();
      return;
    }

    appendPairEvent(`channel config reloaded: server=${pairConfiguredServerUrl} device=${pairConfiguredDeviceId}`);
    setPairMessage(t('msg.pairConfigReloaded'), 'success');
    if (pairChannelOpen && reconnectIfOpen) {
      await connectPairChannel();
    } else {
      updatePairButtons();
    }
  } catch (error) {
    setPairMessage(`刷新配置失败：${error?.message || String(error)}`, 'error');
  }
}

function initPairCenter() {
  if (!isPairCenterAvailable()) {
    return;
  }

  applyPairConfigFromRawConfig();
  pairChannels.splice(0, pairChannels.length);
  activeChatChannelId = '';
  pairChatDraftInput.value = '';
  clearPairQrPreview();
  pairEventLog.textContent = `${t('pair.logPrefix')}: ready`;
  pairChannelOpen = false;
  renderPairWsStatus('disconnected');
  renderPairChannelCards();
  updatePairButtons();
  if (!pairConfiguredServerUrl || !pairConfiguredDeviceId) {
    setPairMessage(t('msg.pairMissingConfig'), 'error');
  } else {
    setPairMessage('');
  }

  pairChatDraftInput.addEventListener('input', () => {
    updatePairButtons();
  });
  pairReloadConfigBtn.addEventListener('click', async (event) => {
    event.preventDefault();
    event.stopPropagation();
    await refreshPairChannelConfig();
  });
  pairChannelToggleBtn.addEventListener('click', async () => {
    if (pairChannelOpen) {
      disconnectPairChannel();
      return;
    }
    if (!pairConfiguredServerUrl || !pairConfiguredDeviceId) {
      setPairMessage(t('msg.pairMissingConfig'), 'error');
      return;
    }
    pairChannelOpen = true;
    await connectPairChannel();
  });
  pairCreateChannelBtn.addEventListener('click', async () => {
    if (!pairChannelOpen) {
      setPairMessage(t('pair.status.disconnected'), 'error');
      return;
    }
    await createPairSession();
  });
  pairChatSendBtn.addEventListener('click', async () => {
    await sendPairChatMessage();
  });
  pairChatCloseBtn.addEventListener('click', () => {
    closeDialogSafe(pairChatDialog);
    activeChatChannelId = '';
    updatePairButtons();
  });
  pairQrCloseBtn.addEventListener('click', () => {
    closeDialogSafe(pairQrDialog);
  });
  pairChatDraftInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void sendPairChatMessage();
    }
  });
}

async function loadState() {
  const state = await invoke('get_state');
  platformBadge.textContent = `${state.platform} · v${state.version}`;

  if (state.isConfigured && state.config) {
    rawConfig = await invoke('read_raw_config');
    applyPairConfigFromRawConfig();
    if (isPairCenterAvailable()) {
      if (!pairConfiguredServerUrl || !pairConfiguredDeviceId) {
        setPairMessage(t('msg.pairMissingConfig'), 'error');
      } else if (!pairChannelOpen) {
        setPairMessage('');
      }
      updatePairButtons();
    }
    const configPath = await invoke('get_config_path');
    renderSummary(state.config, configPath);
    await refreshKernelStatus();
    showMain();
    return;
  }

  rawConfig = state.config;
  applyPairConfigFromRawConfig();
  providerInput.value = 'custom';
  setModelValue(rawConfig?.model || '');
  baseUrlInput.value = rawConfig?.baseUrl || '';
  commandInput.value = rawConfig?.openclawCommand || 'openclaw';
  customApiModeInput.value = rawConfig?.customApiMode || DEFAULT_CUSTOM_API_MODE;
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
  const customApiMode = customApiModeInput.value.trim() || DEFAULT_CUSTOM_API_MODE;
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
  applyPairConfigFromRawConfig();
  updatePairButtons();
  providerInput.value = 'custom';
  setModelValue(rawConfig?.model || '');
  baseUrlInput.value = rawConfig?.baseUrl || '';
  commandInput.value = rawConfig?.openclawCommand || 'openclaw';
  customApiModeInput.value = rawConfig?.customApiMode || DEFAULT_CUSTOM_API_MODE;
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

summaryCustomApiMode.addEventListener('change', async () => {
  if (!(summaryCustomApiMode instanceof HTMLSelectElement)) {
    return;
  }

  const current = await invoke('read_raw_config');
  if (!current) {
    return;
  }

  const payload = {
    provider: current.provider || 'custom',
    model: current.model || '',
    baseUrl: current.baseUrl || '',
    apiKey: current.apiKey || '',
    customApiMode: summaryCustomApiMode.value || DEFAULT_CUSTOM_API_MODE,
    customHeadersJson: current.customHeaders ? JSON.stringify(current.customHeaders) : '',
    openclawCommand: current.openclawCommand || 'openclaw',
    skillsDirs: current.skillsDirs || []
  };

  const result = await invoke('save_config', { payload });
  if (!result.ok) {
    doctorOutput.textContent = result.message || t('msg.saveFailed');
    return;
  }

  const state = await invoke('get_state');
  if (state.isConfigured && state.config) {
    const configPath = await invoke('get_config_path');
    renderSummary(state.config, configPath);
  }
  doctorOutput.textContent = t('msg.saveSuccess');
});

window.addEventListener('beforeunload', () => {
  pairDesiredConnected = false;
  resetPairReconnectTimer();
  cleanupPairWebSocket();
});

langSelect.addEventListener('change', async () => {
  currentLang = langSelect.value;
  localStorage.setItem('openclaw.ui.lang', currentLang);
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

initLanguage();
initPairCenter();
loadState();
