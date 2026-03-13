// @ts-nocheck
import { invoke } from '@tauri-apps/api/tauri';
import { open as openDialog } from '@tauri-apps/api/dialog';
import { open as openPath } from '@tauri-apps/api/shell';
import QRCode from 'qrcode';

const setupView = document.getElementById('setupView') as any;
const mainView = document.getElementById('mainView') as any;
const providerInput = document.getElementById('providerInput') as any;
const providerDescription = document.getElementById('providerDescription') as any;
const providerRequiredList = document.getElementById('providerRequiredList') as any;
const providerTips = document.getElementById('providerTips') as any;
const providerDocsLink = document.getElementById('providerDocsLink') as any;
const providerShowAdvancedToggle = document.getElementById('providerShowAdvancedToggle') as any;
const providerAuthNotice = document.getElementById('providerAuthNotice') as any;
const providerAuthHint = document.getElementById('providerAuthHint') as any;
const copyProviderAuthCmdBtn = document.getElementById('copyProviderAuthCmdBtn') as any;
const baseUrlField = document.getElementById('baseUrlField') as any;
const apiKeyField = document.getElementById('apiKeyField') as any;
const customApiModeField = document.getElementById('customApiModeField') as any;
const customHeadersField = document.getElementById('customHeadersField') as any;
const modelInput = document.getElementById('modelInput') as any;
const modelSuggestions = document.getElementById('modelSuggestions') as any;
const modelDropdown = document.getElementById('modelDropdown') as any;
const apiKeyInput = document.getElementById('apiKeyInput') as any;
const baseUrlInput = document.getElementById('baseUrlInput') as any;
const cloudflareFields = document.getElementById('cloudflareFields') as any;
const cloudflareAccountIdInput = document.getElementById('cloudflareAccountIdInput') as any;
const cloudflareGatewayIdInput = document.getElementById('cloudflareGatewayIdInput') as any;
const baseUrlHint = document.getElementById('baseUrlHint') as any;
const apiKeyLabel = document.getElementById('apiKeyLabel') as any;
const apiKeyHint = document.getElementById('apiKeyHint') as any;
const modelHint = document.getElementById('modelHint') as any;
const commandInput = document.getElementById('commandInput') as any;
const customApiModeInput = document.getElementById('customApiModeInput') as any;
const customHeadersInput = document.getElementById('customHeadersInput') as any;
const fetchModelsBtn = document.getElementById('fetchModelsBtn') as any;
const skillsList = document.getElementById('skillsList') as any;
const summarySkillsList = document.getElementById('summarySkillsList') as any;
const setupMessage = document.getElementById('setupMessage') as any;
const doctorOutput = document.getElementById('doctorOutput') as any;

const platformBadge = document.getElementById('platformBadge') as any;
const summaryProvider = document.getElementById('summaryProvider') as any;
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
const kernelVersionMetaSetup = document.getElementById('kernelVersionMetaSetup') as any;
const kernelVersionMetaMain = document.getElementById('kernelVersionMetaMain') as any;
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
const pairQrCountdown = document.getElementById('pairQrCountdown') as any;
const pairEventLog = document.getElementById('pairEventLog') as any;

let skillsDirs = [];
let rawConfig = null;
let kernelStatus = null;
let kernelVersionMeta = null;
let kernelVersionMetaCheckedAt = 0;
let lastModelFetchKey = '';
let currentLang = 'zh-CN';
const KERNEL_VERSION_META_TTL_MS = 5 * 60 * 1000;
const DEFAULT_CUSTOM_API_MODE = 'openai-responses';
const CUSTOM_API_MODE_STORAGE_KEY = 'openclaw.ui.customApiModeByModel';
const PAIR_DEVICE_TOKEN_STORAGE_KEY = 'openclaw.ui.pair.deviceTokens.v1';
const PAIR_SESSION_TTL_SECONDS = 60;
const PAIR_QR_REFRESH_RETRY_MS = 5000;
const SUPPORTED_CUSTOM_API_MODES = new Set([
  'openai-responses',
  'openai-completions',
  'anthropic-messages'
]);
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
let pairQrRefreshTimer = null;
let pairQrCountdownTimer = null;
let pairQrActiveChannelId = '';
let pairQrExpiresAtMs = 0;
let pairQrRefreshInFlight = false;
let activeChatChannelId = '';
const pairChannels = [];
const pairWsPendingRequests = new Map();

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1']);

let activeProviderId = 'openai';
let showAdvancedProviders = false;
let cachedModelOptions = [];
let isModelDropdownOpen = false;
let modelDropdownQuery = '';
const CLOUDFLARE_PRESET_ID = 'cloudflare-ai-gateway';

const DOC_PROVIDER_OVERVIEW = 'https://docs.openclaw.ai/concepts/model-providers';
const DEFAULT_CUSTOM_HEADERS = Object.freeze({
  'Accept': 'application/json',
  'User-Agent': 'OpenClaw Desktop'
});

const builtinProvider = (id, label, keyLabel, modelHint, docs = DOC_PROVIDER_OVERVIEW) => ({
  id,
  authKind: 'api-key',
  category: { zh: '官方内建（API Key）', en: 'Built-in (API Key)' },
  label,
  runtimeProvider: id,
  keyRequired: true,
  keyLabel,
  keyPlaceholder: '',
  showBaseUrl: false,
  baseUrlRequired: false,
  baseUrlDefault: '',
  baseUrlHint: {
    zh: '使用官方默认地址，无需填写 Base URL。',
    en: 'Uses official endpoint by default. Base URL is not required.'
  },
  showCustomOptions: false,
  customApiMode: DEFAULT_CUSTOM_API_MODE,
  fetchModels: false,
  autoApiKey: '',
  description: {
    zh: `使用 ${label} 官方 Provider，通常填写 API Key + 模型即可。`,
    en: `Use ${label} built-in provider. Usually API Key + Model is enough.`
  },
  requiredFields: [
    { zh: 'API Key', en: 'API Key' },
    { zh: '模型', en: 'Model' }
  ],
  tips: [
    { zh: '如果无法自动拉取模型，可手动填写模型名称。', en: 'If model fetching is unavailable, input model name manually.' }
  ],
  modelHint,
  docs,
  detectHosts: []
});

const gatewayProvider = (
  id,
  label,
  baseUrlDefault,
  customApiMode = 'openai-completions',
  docs = DOC_PROVIDER_OVERVIEW
) => ({
  id,
  authKind: 'api-key',
  category: { zh: '兼容网关（OpenAI / Anthropic）', en: 'Gateway Compatible (OpenAI / Anthropic)' },
  label,
  runtimeProvider: 'custom',
  keyRequired: true,
  keyLabel: { zh: `${label} API 密钥`, en: `${label} API Key` },
  keyPlaceholder: '',
  showBaseUrl: true,
  baseUrlRequired: true,
  baseUrlDefault,
  baseUrlHint: {
    zh: '请按该提供商文档填写兼容网关地址。',
    en: 'Use the gateway URL from this provider documentation.'
  },
  showCustomOptions: true,
  customApiMode,
  fetchModels: true,
  autoApiKey: '',
  description: {
    zh: `通过兼容网关方式接入 ${label}。`,
    en: `Connect ${label} through a compatible gateway endpoint.`
  },
  requiredFields: [
    { zh: '基础 URL', en: 'Base URL' },
    { zh: 'API 密钥', en: 'API Key' },
    { zh: '模型', en: 'Model' }
  ],
  tips: [
    { zh: '建议先点“拉取模型”，失败后再手动填写模型。', en: 'Try "Fetch Models" first, then fill model manually if needed.' }
  ],
  modelHint: { zh: '示例模型：参考提供商文档', en: 'Example model: follow provider docs' },
  docs,
  detectHosts: []
});

const managedAuthProvider = (id, label, modelHint, docs = DOC_PROVIDER_OVERVIEW) => ({
  id,
  authKind: 'managed-auth',
  category: { zh: '官方（OAuth/CLI 登录）', en: 'Official (OAuth/CLI Login)' },
  label,
  runtimeProvider: id,
  keyRequired: false,
  keyLabel: { zh: '托管鉴权（需先 CLI 登录）', en: 'Managed Auth (CLI login required)' },
  keyPlaceholder: '',
  showBaseUrl: false,
  baseUrlRequired: false,
  baseUrlDefault: '',
  baseUrlHint: { zh: 'Base URL 由提供商默认配置管理。', en: 'Base URL is managed by provider defaults.' },
  showCustomOptions: false,
  customApiMode: DEFAULT_CUSTOM_API_MODE,
  fetchModels: false,
  autoApiKey: 'managed-auth',
  description: {
    zh: `使用 ${label} 托管鉴权（需先 CLI 登录）。`,
    en: `Use ${label} with OpenClaw managed auth (CLI login first).`
  },
  requiredFields: [
    { zh: 'CLI 登录/鉴权', en: 'CLI Login/Auth' },
    { zh: '模型', en: 'Model' }
  ],
  tips: [
    {
      zh: `运行：openclaw models auth login --provider ${id}`,
      en: `Run: openclaw models auth login --provider ${id}`
    }
  ],
  modelHint,
  docs,
  detectHosts: []
});

const awsCredentialProvider = (id, label, modelHint, docs = DOC_PROVIDER_OVERVIEW) => ({
  id,
  authKind: 'cloud-credentials',
  category: { zh: '官方（云凭据）', en: 'Official (Cloud Credentials)' },
  label,
  runtimeProvider: id,
  keyRequired: false,
  keyLabel: { zh: 'AWS 凭据/配置文件', en: 'AWS Credentials/Profile' },
  keyPlaceholder: '',
  showBaseUrl: false,
  baseUrlRequired: false,
  baseUrlDefault: '',
  baseUrlHint: { zh: '使用 AWS Bedrock 默认端点地址。', en: 'Uses AWS Bedrock default endpoint.' },
  showCustomOptions: false,
  customApiMode: DEFAULT_CUSTOM_API_MODE,
  fetchModels: false,
  autoApiKey: 'aws-credentials',
  description: {
    zh: '通过 AWS 凭据认证（AWS_PROFILE 或访问密钥）。',
    en: 'Authenticate with AWS credentials (AWS_PROFILE or access keys).'
  },
  requiredFields: [
    { zh: 'AWS 凭据', en: 'AWS Credentials' },
    { zh: '模型', en: 'Model' }
  ],
  tips: [
    { zh: '启动前请先配置 AWS_PROFILE / AWS 访问密钥。', en: 'Configure AWS_PROFILE/AWS keys before starting.' }
  ],
  modelHint,
  docs,
  detectHosts: []
});

const PROVIDER_PRESETS = [
  // Official built-in providers (API key + model)
  builtinProvider(
    'openai',
    'OpenAI',
    { zh: 'OpenAI API Key', en: 'OpenAI API Key' },
    { zh: '示例：gpt-5.4 / gpt-5.4-pro', en: 'Example: gpt-5.4 / gpt-5.4-pro' },
    'https://docs.openclaw.ai/providers/openai'
  ),
  builtinProvider(
    'anthropic',
    'Anthropic',
    { zh: 'Anthropic API Key', en: 'Anthropic API Key' },
    { zh: '示例：claude-opus-4-6', en: 'Example: claude-opus-4-6' },
    'https://docs.openclaw.ai/providers/anthropic'
  ),
  builtinProvider(
    'google',
    'Google Gemini',
    { zh: 'Gemini API Key', en: 'Gemini API Key' },
    { zh: '示例：gemini-3.1-pro-preview', en: 'Example: gemini-3.1-pro-preview' },
    'https://docs.openclaw.ai/concepts/model-providers'
  ),
  builtinProvider(
    'zai',
    'Z.AI (GLM)',
    { zh: 'Z.AI API Key', en: 'Z.AI API Key' },
    { zh: '示例：glm-5', en: 'Example: glm-5' },
    'https://docs.openclaw.ai/providers/zai'
  ),
  builtinProvider(
    'openrouter',
    'OpenRouter',
    { zh: 'OpenRouter API Key', en: 'OpenRouter API Key' },
    { zh: '示例：anthropic/claude-sonnet-4-5', en: 'Example: anthropic/claude-sonnet-4-5' },
    'https://docs.openclaw.ai/providers/openrouter'
  ),
  builtinProvider(
    'xai',
    'xAI (Grok)',
    { zh: 'xAI API Key', en: 'xAI API Key' },
    { zh: '示例：grok-4', en: 'Example: grok-4' },
    'https://docs.openclaw.ai/concepts/model-providers'
  ),
  builtinProvider(
    'mistral',
    'Mistral',
    { zh: 'Mistral API Key', en: 'Mistral API Key' },
    { zh: '示例：mistral-large-latest', en: 'Example: mistral-large-latest' },
    'https://docs.openclaw.ai/providers/mistral'
  ),
  builtinProvider(
    'groq',
    'Groq',
    { zh: 'Groq API Key', en: 'Groq API Key' },
    { zh: '示例：llama-3.3-70b-versatile', en: 'Example: llama-3.3-70b-versatile' },
    'https://docs.openclaw.ai/concepts/model-providers'
  ),
  builtinProvider(
    'cerebras',
    'Cerebras',
    { zh: 'Cerebras API Key', en: 'Cerebras API Key' },
    { zh: '示例：zai-glm-4.7', en: 'Example: zai-glm-4.7' },
    'https://docs.openclaw.ai/concepts/model-providers'
  ),
  builtinProvider(
    'huggingface',
    'Hugging Face',
    { zh: 'HF Token', en: 'HF Token' },
    { zh: '示例：deepseek-ai/DeepSeek-R1', en: 'Example: deepseek-ai/DeepSeek-R1' },
    'https://docs.openclaw.ai/providers/huggingface'
  ),
  builtinProvider(
    'github-copilot',
    'GitHub Copilot',
    { zh: 'GitHub Token', en: 'GitHub Token' },
    { zh: '示例：gpt-4.1', en: 'Example: gpt-4.1' },
    'https://docs.openclaw.ai/concepts/model-providers'
  ),
  builtinProvider(
    'vercel-ai-gateway',
    'Vercel AI Gateway',
    { zh: 'AI_GATEWAY_API_KEY', en: 'AI_GATEWAY_API_KEY' },
    { zh: '示例：anthropic/claude-opus-4.6', en: 'Example: anthropic/claude-opus-4.6' },
    'https://docs.openclaw.ai/providers/vercel-ai-gateway'
  ),
  builtinProvider(
    'kilocode',
    'Kilo Gateway',
    { zh: 'KILOCODE_API_KEY', en: 'KILOCODE_API_KEY' },
    { zh: '示例：anthropic/claude-opus-4.6', en: 'Example: anthropic/claude-opus-4.6' },
    'https://docs.openclaw.ai/providers/kilocode'
  ),
  managedAuthProvider(
    'openai-codex',
    'OpenAI Codex',
    { zh: '示例：gpt-5.4', en: 'Example: gpt-5.4' },
    'https://docs.openclaw.ai/concepts/model-providers'
  ),
  managedAuthProvider(
    'qwen-portal',
    'Qwen (OAuth)',
    { zh: '示例：coder-model', en: 'Example: coder-model' },
    'https://docs.openclaw.ai/providers/qwen'
  ),
  managedAuthProvider(
    'opencode',
    'OpenCode Zen',
    { zh: '示例：claude-opus-4-6', en: 'Example: claude-opus-4-6' },
    'https://docs.openclaw.ai/providers/opencode'
  ),
  managedAuthProvider(
    'opencode-go',
    'OpenCode Go',
    { zh: '示例：kimi-k2.5', en: 'Example: kimi-k2.5' },
    'https://docs.openclaw.ai/providers/opencode-go'
  ),
  managedAuthProvider(
    'minimax-portal',
    'MiniMax (OAuth)',
    { zh: '示例：MiniMax-M2.5', en: 'Example: MiniMax-M2.5' },
    'https://docs.openclaw.ai/providers/minimax'
  ),
  awsCredentialProvider(
    'amazon-bedrock',
    'Amazon Bedrock',
    { zh: '示例：claude-opus-4-6', en: 'Example: claude-opus-4-6' },
    'https://docs.openclaw.ai/providers/bedrock'
  ),

  // Official providers configured through compatible gateway endpoints
  {
    ...gatewayProvider(
      'moonshot',
      'Moonshot / Kimi',
      'https://api.moonshot.ai/v1',
      'openai-completions',
      'https://docs.openclaw.ai/providers/moonshot'
    ),
    detectHosts: ['moonshot.ai', 'moonshot.cn'],
    baseUrlHint: {
      zh: '中国大陆可使用 https://api.moonshot.cn/v1。',
      en: 'You may use https://api.moonshot.cn/v1 in Mainland China'
    },
    modelHint: { zh: '示例：kimi-k2.5', en: 'Example: kimi-k2.5' }
  },
  {
    ...gatewayProvider(
      'kimi-coding',
      'Kimi Coding',
      'https://api.kimi.com/coding/',
      'anthropic-messages',
      'https://docs.openclaw.ai/providers/moonshot'
    ),
    detectHosts: ['kimi.com'],
    modelHint: { zh: '示例：k2p5', en: 'Example: k2p5' }
  },
  {
    ...gatewayProvider(
      'together',
      'Together AI',
      'https://api.together.xyz/v1',
      'openai-completions',
      'https://docs.openclaw.ai/providers/together'
    ),
    detectHosts: ['together.xyz']
  },
  {
    ...gatewayProvider(
      'nvidia',
      'NVIDIA NIM',
      'https://integrate.api.nvidia.com/v1',
      'openai-completions',
      'https://docs.openclaw.ai/providers/nvidia'
    ),
    detectHosts: ['nvidia.com']
  },
  {
    ...gatewayProvider(
      'qianfan',
      'Baidu Qianfan',
      'https://qianfan.baidubce.com/v2',
      'openai-completions',
      'https://docs.openclaw.ai/providers/qianfan'
    ),
    detectHosts: ['qianfan', 'baidu'],
    modelHint: { zh: '示例：deepseek-v3.2', en: 'Example: deepseek-v3.2' }
  },
  {
    ...gatewayProvider(
      'modelstudio',
      'Alibaba Model Studio',
      'https://coding-intl.dashscope.aliyuncs.com/v1',
      'openai-completions',
      'https://docs.openclaw.ai/concepts/model-providers'
    ),
    detectHosts: ['dashscope.aliyuncs.com'],
    modelHint: { zh: '示例：qwen3.5-plus', en: 'Example: qwen3.5-plus' },
    tips: [
      { zh: '中国内地端点请使用 https://coding.dashscope.aliyuncs.com/v1', en: 'For China endpoint use https://coding.dashscope.aliyuncs.com/v1' }
    ]
  },
  {
    ...gatewayProvider(
      'minimax',
      'MiniMax (Anthropic API)',
      'https://api.minimax.io/anthropic',
      'anthropic-messages',
      'https://docs.openclaw.ai/providers/minimax'
    ),
    detectHosts: ['minimax.io', 'minimaxi.com'],
    modelHint: { zh: '示例：MiniMax-M2.5', en: 'Example: MiniMax-M2.5' }
  },
  {
    ...gatewayProvider(
      'xiaomi',
      'Xiaomi',
      'https://api.xiaomimimo.com/anthropic',
      'anthropic-messages',
      'https://docs.openclaw.ai/providers/xiaomi'
    ),
    detectHosts: ['xiaomimimo.com'],
    modelHint: { zh: '示例：mimo-v2-flash', en: 'Example: mimo-v2-flash' }
  },
  {
    ...gatewayProvider(
      'synthetic',
      'Synthetic',
      'https://api.synthetic.new/anthropic',
      'anthropic-messages',
      'https://docs.openclaw.ai/providers/synthetic'
    ),
    detectHosts: ['synthetic.new'],
    modelHint: { zh: '示例：hf:MiniMaxAI/MiniMax-M2.5', en: 'Example: hf:MiniMaxAI/MiniMax-M2.5' }
  },
  {
    ...gatewayProvider(
      'venice',
      'Venice AI',
      'https://api.venice.ai/api/v1',
      'openai-completions',
      'https://docs.openclaw.ai/providers/venice'
    ),
    detectHosts: ['venice.ai'],
    modelHint: { zh: '示例：kimi-k2-5', en: 'Example: kimi-k2-5' }
  },
  {
    ...gatewayProvider(
      'volcengine',
      'Volcengine (Doubao)',
      'https://ark.cn-beijing.volces.com/api/v3',
      'openai-completions',
      'https://docs.openclaw.ai/concepts/model-providers'
    ),
    detectHosts: ['volces.com'],
    modelHint: { zh: '示例：doubao-seed-1-8-251228', en: 'Example: doubao-seed-1-8-251228' }
  },
  {
    ...gatewayProvider(
      'byteplus',
      'BytePlus ARK',
      'https://ark.byteintlapi.com/api/v3',
      'openai-completions',
      'https://docs.openclaw.ai/concepts/model-providers'
    ),
    detectHosts: ['byteintlapi.com'],
    modelHint: { zh: '示例：seed-1-8-251228', en: 'Example: seed-1-8-251228' }
  },
  {
    ...gatewayProvider(
      'cloudflare-ai-gateway',
      'Cloudflare AI Gateway',
      '',
      'anthropic-messages',
      'https://docs.openclaw.ai/providers/cloudflare-ai-gateway'
    ),
    detectHosts: ['gateway.ai.cloudflare.com', 'cloudflare.com'],
    requiredFields: [
      { zh: 'Base URL（包含 account_id + gateway_id）', en: 'Base URL (contains account_id + gateway_id)' },
      { zh: 'API Key', en: 'API Key' },
      { zh: '模型', en: 'Model' }
    ],
    baseUrlHint: {
      zh: '示例：https://gateway.ai.cloudflare.com/v1/<account_id>/<gateway_id>/openai',
      en: 'Example: https://gateway.ai.cloudflare.com/v1/<account_id>/<gateway_id>/openai'
    }
  },

  // Local deployment providers
  {
    ...gatewayProvider(
      'ollama',
      'Ollama (Local)',
      'http://127.0.0.1:11434/v1',
      'openai-completions',
      'https://docs.openclaw.ai/providers/ollama'
    ),
    category: { zh: '本地部署（非云 API）', en: 'Local Deployment (No Cloud API)' },
    keyRequired: false,
    autoApiKey: 'local-ollama',
    keyLabel: { zh: 'API Key（本地可选）', en: 'API Key (optional for local)' },
    requiredFields: [{ zh: 'Base URL', en: 'Base URL' }, { zh: '模型', en: 'Model' }],
    detectHosts: ['127.0.0.1:11434', 'localhost:11434'],
    tips: [
      { zh: '会自动填充本地占位 Key。', en: 'A local placeholder key will be auto-filled.' }
    ]
  },
  {
    ...gatewayProvider(
      'vllm',
      'vLLM (Local/Self-hosted)',
      'http://127.0.0.1:8000/v1',
      'openai-completions',
      'https://docs.openclaw.ai/providers/vllm'
    ),
    category: { zh: '本地部署（非云 API）', en: 'Local Deployment (No Cloud API)' },
    keyRequired: false,
    autoApiKey: 'local-vllm',
    keyLabel: { zh: 'API Key（通常可选）', en: 'API Key (usually optional)' },
    requiredFields: [{ zh: 'Base URL', en: 'Base URL' }, { zh: '模型', en: 'Model' }],
    detectHosts: ['127.0.0.1:8000', 'localhost:8000'],
    tips: [
      { zh: '关闭鉴权时 API Key 可留空。', en: 'API Key can be empty when auth is disabled.' }
    ]
  },
  {
    ...gatewayProvider(
      'litellm',
      'LiteLLM Gateway',
      'http://127.0.0.1:4000/v1',
      'openai-completions',
      'https://docs.openclaw.ai/providers/litellm'
    ),
    category: { zh: '本地部署（非云 API）', en: 'Local Deployment (No Cloud API)' },
    keyRequired: false,
    autoApiKey: 'local-litellm',
    keyLabel: { zh: '网关 Key（可选）', en: 'Gateway Key (optional)' },
    requiredFields: [{ zh: 'Base URL', en: 'Base URL' }, { zh: '模型', en: 'Model' }],
    detectHosts: ['127.0.0.1:4000', 'localhost:4000', 'litellm']
  },

  // Generic fallback
  {
    ...gatewayProvider(
      'custom',
      'Custom (Manual)',
      '',
      DEFAULT_CUSTOM_API_MODE,
      'https://docs.openclaw.ai/concepts/model-providers'
    ),
    category: { zh: '自定义', en: 'Custom' },
    keyLabel: { zh: 'API Key', en: 'API Key' },
    modelHint: { zh: '示例：your-model-id', en: 'Example: your-model-id' },
    description: {
      zh: '适用于任意 OpenAI / Anthropic 兼容网关。',
      en: 'Use for any OpenAI / Anthropic compatible gateway.'
    }
  }
];

const providerPresetMap = new Map(PROVIDER_PRESETS.map((preset) => [preset.id, preset]));

const EN_I18N = {
  'topbar.subtitle': 'First Launch Setup Wizard',
  'setup.title': 'Configure OpenClaw (Core)',
  'setup.hint': 'Choose a model provider first, then fill URL, API key, API mode, and model.',
  'field.provider': 'Model Provider',
  'provider.showAdvanced': 'Show advanced providers (OAuth/Cloud credentials)',
  'provider.loginRequiredHint': 'This provider requires login first: {cmd}',
  'provider.loginRequiredShort': 'Please complete provider login before starting.',
  'field.baseUrl': 'Base URL',
  'field.apiKey': 'Model API Key',
  'field.model': 'Model',
  'field.apiKeyShort': 'API Key',
  'field.command': 'OpenClaw Command (override bundled kernel)',
  'field.customApiMode': 'API Mode',
  'field.customHeaders': 'Custom Headers JSON (Custom only, optional)',
  'field.commandShort': 'OpenClaw Command',
  'field.customApiModeShort': 'API Mode',
  'customApiMode.placeholder': 'Select API mode',
  'field.customHeadersShort': 'Custom Headers',
  'field.kernelStatus': 'Kernel Status',
  'field.configPath': 'Config File',
  'field.cloudflareAccountId': 'Cloudflare Account ID',
  'field.cloudflareGatewayId': 'Cloudflare Gateway ID',
  'ph.baseUrl': 'e.g. https://api.openai.com/v1',
  'ph.required': 'Required',
  'ph.customHeaders': 'e.g. {"User-Agent":"Mozilla/5.0 ...","Accept":"application/json"}',
  'ph.cloudflareAccountId': 'Cloudflare Account ID',
  'ph.cloudflareGatewayId': 'Cloudflare Gateway ID',
  'model.placeholder.fetch': 'Select a model (click "Fetch Models" first)',
  'model.placeholder.select': 'Select a model',
  'model.currentValue': '{value} (current)',
  'model.dropdown.empty': 'No matching models',
  'btn.fetchModels': 'Fetch Models',
  'btn.addDir': 'Add Directory',
  'btn.installDefaultSkills': 'Import Built-in Skills',
  'btn.installKernel': 'Install/Update OpenClaw Kernel',
  'btn.start': 'Start',
  'btn.reconfigure': 'Reconfigure',
  'btn.checkCommand': 'Check OpenClaw Command',
  'btn.updateKernel': 'Update Kernel (npm)',
  'btn.openFirstSkillDir': 'Open First Skills Directory',
  'btn.copyLoginCommand': 'Start Login',
  'btn.pairConnect': 'Connect Channel',
  'btn.pairDisconnect': 'Disconnect Channel',
  'btn.pairCreate': 'Create Pair Session',
  'btn.pairReloadConfig': 'Reload Config',
  'btn.pairChannelOpen': 'Open Channel',
  'btn.pairCreateChannel': 'New Channel',
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
  'msg.onlyCustomFetch': 'Auto model fetching is unavailable for this provider.',
  'msg.needBaseUrl': 'Please fill Base URL first.',
  'msg.fetchingModels': 'Fetching model list...',
  'msg.fetchModelsFailed': 'Failed to fetch models.',
  'msg.modelsFetched': 'Fetched {count} models.',
  'msg.importingSkills': 'Importing built-in skills...',
  'msg.importFailed': 'Import failed.',
  'msg.importedSkills': 'Built-in skills imported to: {path}',
  'msg.modelRequired': 'Model is required.',
  'msg.customApiModeRequired': 'Please select API mode first.',
  'msg.cloudflareAccountIdRequired': 'Cloudflare Account ID is required.',
  'msg.cloudflareGatewayIdRequired': 'Cloudflare Gateway ID is required.',
  'msg.baseUrlRequiredForCustom': 'Base URL is required when provider is custom.',
  'msg.baseUrlRequiredForProvider': 'Base URL is required for selected provider.',
  'msg.apiKeyRequiredForProvider': 'API Key is required for selected provider.',
  'msg.headersMustObject': 'Custom Headers must be a JSON object.',
  'msg.headerValueMustString': 'Header {key} value must be a string.',
  'msg.headersJsonInvalid': 'Custom Headers JSON error: {detail}',
  'msg.authChecking': 'Checking provider login status...',
  'msg.authNotReady': 'This provider is not logged in yet. Please complete login first.',
  'msg.authLaunching': 'Opening provider login in a new terminal...',
  'msg.authLaunchStarted': 'Login terminal opened. Complete login there, then return to continue.',
  'msg.authLaunchFailed': 'Failed to open login terminal.',
  'msg.loginCommandCopied': 'Login command copied. Run it in terminal.',
  'msg.loginCommandCopyFailed': 'Copy failed. Run manually: {cmd}',
  'msg.savingConfig': 'Saving configuration...',
  'msg.saveFailed': 'Save failed.',
  'msg.saveSuccess': 'Configuration saved.',
  'msg.autoInstallingKernel': 'Auto-installing OpenClaw kernel (npm i openclaw)...',
  'msg.autoKernelFailed': 'Config saved, but kernel auto-install failed: {message}',
  'msg.configAndKernelReady': 'Config and kernel are ready. Entering app...',
  'msg.enteringApp': 'Configuration saved. Entering app...',
  'msg.runningAction': 'Running {label} (npm i openclaw)...',
  'msg.actionCompleted': '{label} completed.',
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
  'pair.title': 'Communication',
  'pair.hint': 'Open the channel on this host, then let mobile scan the QR code to create long-lived communication cards.',
  'pair.serverUrl': 'Server Base URL',
  'pair.serverToken': 'Server Token (Optional)',
  'pair.deviceId': 'Device ID',
  'pair.wsStatus': 'Channel Status',
  'pair.channelCount': 'Channel Count',
  'pair.sessionId': 'Session ID',
  'pair.code': 'Pair Code',
  'pair.expiresAt': 'Expires At',
  'pair.claimedUser': 'Bound User',
  'pair.qrDialogTitle': 'Channel QR Code',
  'pair.qrCountdown': 'QR auto refresh in {seconds}s',
  'pair.qrRefreshing': 'Refreshing QR code...',
  'pair.chatDialogTitle': 'Channel Chat',
  'pair.chatDraft': 'Message',
  'pair.chatDraftPlaceholder': 'Type message, Ctrl/Cmd + Enter to send',
  'pair.toggle.on': 'Channel Open (click to close)',
  'pair.toggle.off': 'Channel Closed (click to open)',
  'pair.empty': 'No channels yet. Click "New Channel" to create one.',
  'pair.card.name': 'Channel Name',
  'pair.card.id': 'Channel ID',
  'pair.card.mobile': 'Mobile Device',
  'pair.card.createdAt': 'Created At',
  'pair.card.status': 'Connection',
  'pair.card.statusPending': 'Pending',
  'pair.card.statusActive': 'Connected',
  'pair.card.statusOffline': 'Offline',
  'pair.card.openQr': 'QR Code',
  'pair.card.openChat': 'Open Chat',
  'pair.card.delete': 'Delete',
  'pair.chatPlaceholder': 'No messages yet',
  'pair.qrPayload': 'QR Payload (JSON)',
  'pair.logPrefix': 'Pair Log',
  'pair.status.disconnected': 'Disconnected',
  'pair.status.connecting': 'Connecting',
  'pair.status.connected': 'Connected',
  'pair.status.reconnecting': 'Reconnecting',
  'msg.pairNeedServerUrl': 'Please fill the server URL first.',
  'msg.pairNeedDeviceId': 'Please fill the device ID first.',
  'msg.pairInvalidServerUrl': 'Invalid server URL: {url}',
  'msg.pairConnecting': 'Connecting pair channel...',
  'msg.pairConnected': 'Pair channel connected.',
  'msg.pairDisconnected': 'Pair channel disconnected.',
  'msg.pairReconnect': 'Channel dropped. Reconnecting in {seconds}s (attempt {attempt}).',
  'msg.pairCreateRunning': 'Creating pair session...',
  'msg.pairCreateFailed': 'Failed to create pair session: {message}',
  'msg.pairCreated': 'Pair session created. Waiting for mobile claim.',
  'msg.pairAuthEnsuring': 'Verifying desktop authentication...',
  'msg.pairAuthFailed': 'Desktop authentication failed: {message}',
  'msg.pairQrAutoRefreshFailed': 'QR auto refresh failed: {message}',
  'msg.pairClaimed': 'Pair completed: bound user {userId}.',
  'msg.pairMissingConfig': 'Pairing config is missing. Please set channelServerBaseUrl and channelDeviceId first.',
  'msg.pairConfigReloaded': 'Pairing config reloaded.',
  'msg.pairAlreadyPaired': 'This mobile device ({mobileId}) is already paired.',
  'msg.pairNeedMobileId': 'Current channel is not bound to a mobile device yet.',
  'msg.pairNeedChatMessage': 'Please enter a message first.',
  'msg.pairChatSent': 'Message sent.',
  'msg.pairDeleteConfirm': 'Delete channel {id}?',
  'msg.pairDeleted': 'Channel deleted.',
  'msg.pairRevokeFailed': 'Failed to revoke binding on server: {message}',
  'msg.pairChannelClosedForCreate': 'Channel is currently closed. Please open it first.',
  'kernel.unknown': 'Unknown',
  'kernel.bundled': 'Bundled ({version})',
  'kernel.installed': 'Installed ({version})',
  'kernel.available': 'Available ({version})',
  'kernel.notInstalledNoNpm': 'Not installed (npm not found and no bundled kernel detected)',
  'kernel.notInstalled': 'Not installed',
  'kernel.version.loading': 'Current: checking... | Latest: checking...',
  'kernel.version.meta': 'Current: {current} | Latest: {latest}',
  'kernel.version.metaUnknownLatest': 'Current: {current} | Latest: unavailable',
  'kernel.version.failed': 'Current: {current} | Latest: check failed'
};

const ZH_I18N = {
  "topbar.subtitle": "首次启动配置向导",
  "setup.title": "配置 OpenClaw（核心项）",
  "setup.hint": "请选择模型提供商，并填写基础 URL、模型 API 密钥、API 模式与模型。",
  "field.provider": "模型提供商",
  "provider.showAdvanced": "显示高级提供商（OAuth/云凭据）",
  "provider.loginRequiredHint": "当前提供商需要先登录：{cmd}",
  "provider.loginRequiredShort": "开始前请先完成该提供商登录。",
  "field.baseUrl": "基础 URL",
  "field.apiKey": "模型 API 密钥",
  "field.model": "模型",
  "field.apiKeyShort": "API Key",
  "field.command": "OpenClaw 命令（覆盖默认内置内核）",
  "field.customApiMode": "API 模式",
  "field.customHeaders": "Custom Headers JSON（仅 Custom，可选）",
  "field.commandShort": "OpenClaw 命令",
  "field.customApiModeShort": "API 模式",
  "customApiMode.placeholder": "请选择 API 模式",
  "field.customHeadersShort": "Custom Headers",
  "field.kernelStatus": "内核状态",
  "field.configPath": "配置文件",
  "field.cloudflareAccountId": "Cloudflare 账户 ID",
  "field.cloudflareGatewayId": "Cloudflare 网关 ID",
  "ph.baseUrl": "例如 https://api.openai.com/v1",
  "ph.required": "必须填写",
  "ph.customHeaders": "例如 {\"User-Agent\":\"Mozilla/5.0 ...\",\"Accept\":\"application/json\"}",
  "ph.cloudflareAccountId": "Cloudflare 账户 ID",
  "ph.cloudflareGatewayId": "Cloudflare 网关 ID",
  "model.placeholder.fetch": "请选择模型（先点击“拉取模型”）",
  "model.placeholder.select": "请选择模型",
  "model.currentValue": "{value}（当前值）",
  "model.dropdown.empty": "无匹配模型",
  "btn.fetchModels": "拉取模型",
  "btn.addDir": "添加目录",
  "btn.installDefaultSkills": "导入内置 Skills",
  "btn.installKernel": "安装/更新 OpenClaw 内核",
  "btn.start": "开始使用",
  "btn.reconfigure": "重新配置",
  "btn.checkCommand": "检查 OpenClaw 命令",
  "btn.updateKernel": "更新内核（npm）",
  "btn.openFirstSkillDir": "打开首个 Skills 目录",
  "btn.copyLoginCommand": "开始登录",
  "btn.pairConnect": "连接通道",
  "btn.pairDisconnect": "断开通道",
  "btn.pairCreate": "创建配对会话",
  "btn.pairReloadConfig": "刷新配置",
  "btn.pairChannelOpen": "开放通道",
  "btn.pairCreateChannel": "新建渠道",
  "btn.pairChatSend": "发送",
  "btn.close": "关闭",
  "advanced.title": "高级选项（可选）",
  "advanced.infoTitle": "高级信息（可选）",
  "advanced.expand": "展开",
  "main.readyTitle": "OpenClaw 已就绪",
  "main.readyHint": "核心信息已配置完成，直接点击“开始使用”即可。",
  "skills.title.optional": "Skills 目录（可选）",
  "skills.title": "Skills 目录",
  "skills.noneConfigured": "未配置 skills 目录",
  "skills.noneOptional": "未配置（可选）",
  "skills.remove": "移除",
  "dialog.selectSkillsDir": "选择 skills 目录",
  "dialog.selectDefaultSkillsTarget": "选择导入默认 skills 的目标目录",
  "msg.onlyCustomFetch": "当前仅支持 Custom Provider 拉取模型。",
  "msg.needBaseUrl": "请先填写 Base URL。",
  "msg.fetchingModels": "正在拉取模型列表...",
  "msg.fetchModelsFailed": "拉取模型失败。",
  "msg.modelsFetched": "已拉取 {count} 个模型。",
  "msg.importingSkills": "正在导入内置 skills...",
  "msg.importFailed": "导入失败。",
  "msg.importedSkills": "已导入内置 skills 到: {path}",
  "msg.modelRequired": "Model 不能为空。",
  "msg.customApiModeRequired": "请先选择 API 模式。",
  "msg.cloudflareAccountIdRequired": "Cloudflare 账户 ID 不能为空。",
  "msg.cloudflareGatewayIdRequired": "Cloudflare 网关 ID 不能为空。",
  "msg.baseUrlRequiredForCustom": "Provider 为 custom 时，Base URL 不能为空。",
  "msg.baseUrlRequiredForProvider": "所选提供商必须填写 Base URL。",
  "msg.apiKeyRequiredForProvider": "所选提供商必须填写 API Key。",
  "msg.headersMustObject": "Custom Headers 必须是 JSON 对象。",
  "msg.headerValueMustString": "Header {key} 的值必须是字符串。",
  "msg.headersJsonInvalid": "Custom Headers JSON 格式错误：{detail}",
  "msg.authChecking": "正在检查提供商登录状态...",
  "msg.authNotReady": "该提供商尚未登录，请先完成登录。",
  "msg.authLaunching": "正在打开登录终端...",
  "msg.authLaunchStarted": "已打开登录终端，请在终端完成登录后返回继续。",
  "msg.authLaunchFailed": "打开登录终端失败。",
  "msg.loginCommandCopied": "登录命令已复制，请到终端执行。",
  "msg.loginCommandCopyFailed": "复制失败，请手动执行：{cmd}",
  "msg.savingConfig": "正在保存配置...",
  "msg.saveFailed": "保存失败。",
  "msg.saveSuccess": "配置保存成功。",
  "msg.autoInstallingKernel": "正在自动安装 OpenClaw 内核（npm i openclaw）...",
  "msg.autoKernelFailed": "配置已保存，但内核自动安装失败：{message}（可稍后手动点击“安装/更新 OpenClaw 内核”）",
  "msg.configAndKernelReady": "配置与内核均已就绪，正在进入应用...",
  "msg.enteringApp": "配置保存成功，正在进入应用...",
  "msg.runningAction": "正在{label}（npm i openclaw）...",
  "msg.actionCompleted": "{label} 已完成。",
  "msg.actionFailed": "{label}失败：{message}",
  "msg.enterWebFailed": "进入 OpenClaw Web 失败。",
  "msg.invalidDashboardUrl": "进入 OpenClaw Web 失败：返回的地址无效。",
  "msg.noDashboardUrl": "未返回可用 URL",
  "msg.enteringWeb": "正在进入 OpenClaw Web...",
  "msg.openclawWeb": "OpenClaw Web: {url}",
  "msg.updatingKernel": "正在更新 OpenClaw 内核（npm i openclaw）...",
  "msg.gettingDashboard": "正在获取 OpenClaw Web 地址...",
  "msg.checkingCommand": "正在检查 openclaw 命令...",
  "msg.noSkillDirToOpen": "没有可打开的 skills 目录。",
  "pair.title": "通信",
  "pair.hint": "将当前 PC 作为 Agent 宿主机开放通道，移动端扫码后即可建立长期通信渠道。",
  "pair.serverUrl": "服务端地址",
  "pair.serverToken": "服务端 Token（可选）",
  "pair.deviceId": "设备 ID",
  "pair.wsStatus": "通道状态",
  "pair.channelCount": "渠道数量",
  "pair.sessionId": "会话 ID",
  "pair.code": "配对码",
  "pair.expiresAt": "过期时间",
  "pair.claimedUser": "已绑定用户",
  "pair.qrDialogTitle": "渠道二维码",
  "pair.qrCountdown": "二维码将在 {seconds}s 后自动刷新",
  "pair.qrRefreshing": "正在刷新二维码...",
  "pair.chatDialogTitle": "渠道会话",
  "pair.chatDraft": "发送消息",
  "pair.chatDraftPlaceholder": "输入消息，Ctrl/Cmd + Enter 发送",
  "pair.toggle.on": "通道已开放（点击关闭）",
  "pair.toggle.off": "通道已关闭（点击开放）",
  "pair.empty": "暂无渠道，点击“新建渠道”创建。",
  "pair.card.name": "渠道名称",
  "pair.card.id": "渠道 ID",
  "pair.card.mobile": "移动端设备",
  "pair.card.createdAt": "创建时间",
  "pair.card.status": "连接状态",
  "pair.card.statusPending": "待认领",
  "pair.card.statusActive": "已连接",
  "pair.card.statusOffline": "离线",
  "pair.card.openQr": "二维码",
  "pair.card.openChat": "查看会话",
  "pair.card.delete": "删除渠道",
  "pair.chatPlaceholder": "暂无消息",
  "pair.qrPayload": "二维码载荷（JSON）",
  "pair.logPrefix": "配对日志",
  "pair.status.disconnected": "未连接",
  "pair.status.connecting": "连接中",
  "pair.status.connected": "已连接",
  "pair.status.reconnecting": "重连中",
  "msg.pairNeedServerUrl": "请先填写服务端地址。",
  "msg.pairNeedDeviceId": "请先填写设备 ID。",
  "msg.pairInvalidServerUrl": "服务端地址格式无效：{url}",
  "msg.pairConnecting": "正在连接配对通道...",
  "msg.pairConnected": "配对通道已连接。",
  "msg.pairDisconnected": "配对通道已断开。",
  "msg.pairReconnect": "通道中断，{seconds}s 后自动重连（第 {attempt} 次）。",
  "msg.pairCreateRunning": "正在创建配对会话...",
  "msg.pairCreateFailed": "创建配对会话失败：{message}",
  "msg.pairCreated": "配对会话已创建，等待移动端扫码认领。",
  "msg.pairAuthEnsuring": "正在校验桌面端鉴权...",
  "msg.pairAuthFailed": "桌面端鉴权失败：{message}",
  "msg.pairQrAutoRefreshFailed": "二维码自动刷新失败：{message}",
  "msg.pairClaimed": "配对成功：已绑定用户 {userId}。",
  "msg.pairMissingConfig": "通信渠道配置缺失，请先填写 channelServerBaseUrl 和 channelDeviceId。",
  "msg.pairConfigReloaded": "已刷新通信渠道配置。",
  "msg.pairAlreadyPaired": "该移动端（{mobileId}）已配对过。",
  "msg.pairNeedMobileId": "当前渠道还没有绑定移动端设备。",
  "msg.pairNeedChatMessage": "请先输入消息。",
  "msg.pairChatSent": "消息已发送。",
  "msg.pairDeleteConfirm": "确认删除渠道 {id} 吗？",
  "msg.pairDeleted": "渠道已删除。",
  "msg.pairRevokeFailed": "服务端解绑失败：{message}",
  "msg.pairChannelClosedForCreate": "通道当前未开放，请先点击开放",
  "kernel.unknown": "未知",
  "kernel.bundled": "已内置 ({version})",
  "kernel.installed": "已安装 ({version})",
  "kernel.available": "可用 ({version})",
  "kernel.notInstalledNoNpm": "未安装（未检测到 npm，且未发现内置内核）",
  "kernel.notInstalled": "未安装",
  "kernel.version.loading": "当前：检查中... | 最新：检查中...",
  "kernel.version.meta": "当前：{current} | 最新：{latest}",
  "kernel.version.metaUnknownLatest": "当前：{current} | 最新：不可用",
  "kernel.version.failed": "当前：{current} | 最新：检查失败",
};
const I18N = {
  'zh-CN': ZH_I18N,
  'en-US': EN_I18N
};
function normalizeCustomApiModeByBaseUrl(baseUrl, customApiMode) {
  const normalized = String(customApiMode || '').trim();
  if (!normalized) {
    return '';
  }
  return SUPPORTED_CUSTOM_API_MODES.has(normalized) ? normalized : '';
}

function isCloudflarePresetId(presetId) {
  return String(presetId || '').trim() === CLOUDFLARE_PRESET_ID;
}

function isCloudflarePreset(preset) {
  return isCloudflarePresetId(preset?.id);
}

function cloudflareRouteByApiMode(customApiMode) {
  return String(customApiMode || '').trim() === 'anthropic-messages' ? 'anthropic' : 'openai';
}

function buildCloudflareBaseUrl(accountId, gatewayId, customApiMode) {
  const account = String(accountId || '').trim();
  const gateway = String(gatewayId || '').trim();
  if (!account || !gateway) {
    return '';
  }
  const route = cloudflareRouteByApiMode(customApiMode || DEFAULT_CUSTOM_API_MODE);
  return `https://gateway.ai.cloudflare.com/v1/${account}/${gateway}/${route}`;
}

function parseCloudflareBaseUrl(baseUrl) {
  try {
    const parsed = new URL(String(baseUrl || '').trim());
    if (!parsed.hostname.toLowerCase().includes('cloudflare.com')) {
      return null;
    }

    const parts = parsed.pathname
      .split('/')
      .map((part) => part.trim())
      .filter(Boolean);
    if (parts.length < 3 || parts[0].toLowerCase() !== 'v1') {
      return null;
    }

    return {
      accountId: parts[1],
      gatewayId: parts[2],
      route: parts[3] || ''
    };
  } catch {
    return null;
  }
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

  if (kernelVersionMeta) {
    renderKernelVersionMeta(kernelVersionMeta);
  } else {
    setKernelVersionMetaText(t('kernel.version.loading'));
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
  return String(value || '').trim().replace(/\/+$/, '').toLowerCase();
}

function defaultCustomHeadersText() {
  return JSON.stringify(DEFAULT_CUSTOM_HEADERS, null, 2);
}

function applyDefaultCustomHeadersIfNeeded(preset = getActiveProviderPreset()) {
  if (!preset?.showCustomOptions) {
    customHeadersInput.value = '';
    return;
  }
  if (!String(customHeadersInput?.value || '').trim()) {
    customHeadersInput.value = defaultCustomHeadersText();
  }
}

function getProviderPreset(id) {
  return providerPresetMap.get(String(id || '').trim()) || providerPresetMap.get('custom');
}

function getActiveProviderPreset() {
  return getProviderPreset(activeProviderId || providerInput.value);
}

function isManagedAuthPreset(preset) {
  return String(preset?.authKind || '').trim() === 'managed-auth';
}

function isAdvancedProviderPreset(preset) {
  const kind = String(preset?.authKind || '').trim();
  return kind === 'managed-auth' || kind === 'cloud-credentials';
}

function getProviderLoginCommand(preset) {
  if (!isManagedAuthPreset(preset)) {
    return '';
  }
  const providerId = String(preset?.runtimeProvider || preset?.id || '').trim();
  if (!providerId) {
    return '';
  }
  return `openclaw models auth login --provider ${providerId}`;
}

function initProviderFilter() {
  showAdvancedProviders = localStorage.getItem('openclaw.ui.provider.showAdvanced') === '1';
  if (providerShowAdvancedToggle) {
    providerShowAdvancedToggle.checked = showAdvancedProviders;
  }
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
    return '';
  }
  const remembered = getRememberedCustomApiModeForCurrentModel(preset);
  if (remembered) {
    customApiModeInput.value = remembered;
    return remembered;
  }
  const current = normalizeCustomApiModeByBaseUrl('', customApiModeInput.value);
  if (current && !clearIfMissing) {
    customApiModeInput.value = current;
    return current;
  }
  customApiModeInput.value = '';
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
}

function detectProviderPresetId(config) {
  const provider = String(config?.provider || '').trim().toLowerCase();
  const baseUrl = normalizeUrl(config?.baseUrl || '');

  if (!provider) {
    return 'openai';
  }

  if (provider && provider !== 'custom' && providerPresetMap.has(provider)) {
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

  providerDescription.textContent = textByLang(preset.description);
  renderChips(providerRequiredList, preset.requiredFields || []);
  renderChips(providerTips, preset.tips || [], true);
  providerDocsLink.href = preset.docs || DOC_PROVIDER_OVERVIEW;
  providerDocsLink.textContent = currentLang === 'en-US' ? 'Open provider integration docs' : '查看该提供商接入文档';

  const loginCommand = getProviderLoginCommand(preset);
  if (providerAuthNotice) {
    providerAuthNotice.style.display = loginCommand ? '' : 'none';
  }
  if (providerAuthHint) {
    providerAuthHint.textContent = loginCommand
      ? t('provider.loginRequiredHint', { cmd: loginCommand })
      : '';
  }
  if (copyProviderAuthCmdBtn) {
    copyProviderAuthCmdBtn.style.display = loginCommand ? '' : 'none';
  }

  apiKeyLabel.textContent = textByLang(preset.keyLabel) || t('field.apiKey');
  if (isManagedAuthPreset(preset)) {
    apiKeyHint.textContent = t('provider.loginRequiredShort');
  } else {
    apiKeyHint.textContent = preset.keyRequired
      ? (currentLang === 'en-US' ? 'Required for this provider.' : '当前提供商要求填写 API Key。')
      : (currentLang === 'en-US' ? 'Optional for this provider.' : '当前提供商可选填写 API Key。');
  }
  apiKeyInput.placeholder = preset.keyRequired
    ? (currentLang === 'en-US' ? 'Required' : '必填')
    : (currentLang === 'en-US' ? 'Optional' : '可选');

  const cloudflareMode = isCloudflarePreset(preset);
  if (cloudflareFields) {
    cloudflareFields.style.display = cloudflareMode ? '' : 'none';
  }
  baseUrlField.style.display = preset.showBaseUrl ? '' : 'none';
  if (preset.showBaseUrl) {
    baseUrlHint.textContent = cloudflareMode
      ? (currentLang === 'en-US'
          ? 'Base URL is generated automatically from Account ID + Gateway ID.'
          : '将根据 Account ID + Gateway ID 自动生成 Base URL。')
      : textByLang(preset.baseUrlHint);
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
  modelHint.textContent = textByLang(preset.modelHint);
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

function setPairQrCountdownText(text) {
  if (!pairQrCountdown) {
    return;
  }
  pairQrCountdown.textContent = String(text || '');
}

function stopPairQrAutoRefresh() {
  if (pairQrRefreshTimer) {
    clearTimeout(pairQrRefreshTimer);
    pairQrRefreshTimer = null;
  }
  if (pairQrCountdownTimer) {
    clearInterval(pairQrCountdownTimer);
    pairQrCountdownTimer = null;
  }
  pairQrActiveChannelId = '';
  pairQrExpiresAtMs = 0;
  pairQrRefreshInFlight = false;
  setPairQrCountdownText('');
}

function parsePairQrExpiresAtMs(channel) {
  if (!channel || typeof channel !== 'object') {
    return 0;
  }
  if (Number.isFinite(channel.expiresAt) && Number(channel.expiresAt) > 0) {
    return Number(channel.expiresAt);
  }
  const payload = channel.qrPayload && typeof channel.qrPayload === 'object' ? channel.qrPayload : {};
  const raw = String(payload.expires_at || payload.expiresAt || '').trim();
  if (!raw) {
    return 0;
  }
  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 0;
  }
  return parsed;
}

function updatePairQrCountdown() {
  if (!pairQrActiveChannelId || !pairQrExpiresAtMs) {
    setPairQrCountdownText('');
    return;
  }
  const channel = findPairChannelById(pairQrActiveChannelId);
  if (!channel || channel.status !== 'pending') {
    setPairQrCountdownText('');
    return;
  }
  const seconds = Math.max(0, Math.ceil((pairQrExpiresAtMs - Date.now()) / 1000));
  if (seconds > 0) {
    setPairQrCountdownText(t('pair.qrCountdown', { seconds }));
    return;
  }
  setPairQrCountdownText(t('pair.qrRefreshing'));
}

async function triggerPairQrAutoRefresh(channelId) {
  if (pairQrRefreshInFlight) {
    return;
  }
  const normalizedChannelId = String(channelId || '').trim();
  if (!normalizedChannelId) {
    return;
  }
  if (!pairQrDialog?.open || pairQrActiveChannelId !== normalizedChannelId) {
    return;
  }
  const channel = findPairChannelById(normalizedChannelId);
  if (!channel || channel.status !== 'pending') {
    stopPairQrAutoRefresh();
    return;
  }

  pairQrRefreshInFlight = true;
  try {
    await refreshPairSessionForChannel(channel, { autoRefresh: true });
  } catch (error) {
    setPairMessage(t('msg.pairQrAutoRefreshFailed', { message: error?.message || String(error) }), 'error');
    pairQrRefreshTimer = setTimeout(() => {
      triggerPairQrAutoRefresh(normalizedChannelId).catch(() => {
        // no-op
      });
    }, PAIR_QR_REFRESH_RETRY_MS);
  } finally {
    pairQrRefreshInFlight = false;
  }
}

function schedulePairQrAutoRefresh(channel) {
  if (!pairQrDialog?.open) {
    stopPairQrAutoRefresh();
    return;
  }
  if (!channel || channel.status !== 'pending') {
    stopPairQrAutoRefresh();
    return;
  }
  const expiresAtMs = parsePairQrExpiresAtMs(channel);
  if (!expiresAtMs) {
    stopPairQrAutoRefresh();
    return;
  }

  if (pairQrRefreshTimer) {
    clearTimeout(pairQrRefreshTimer);
    pairQrRefreshTimer = null;
  }
  if (pairQrCountdownTimer) {
    clearInterval(pairQrCountdownTimer);
    pairQrCountdownTimer = null;
  }

  pairQrActiveChannelId = channel.channelId;
  pairQrExpiresAtMs = expiresAtMs;
  updatePairQrCountdown();
  pairQrCountdownTimer = setInterval(updatePairQrCountdown, 1000);

  const delay = Math.max(500, expiresAtMs - Date.now());
  pairQrRefreshTimer = setTimeout(() => {
    triggerPairQrAutoRefresh(channel.channelId).catch(() => {
      // no-op
    });
  }, delay);
}

async function openPairQrDialogForChannel(channel) {
  if (!channel) {
    setPairMessage(t('msg.pairCreateFailed', { message: 'channel not found' }), 'error');
    return;
  }
  const payload = channel.qrPayload && typeof channel.qrPayload === 'object' ? channel.qrPayload : {};
  await renderPairQrPreview(payload);
  openDialogSafe(pairQrDialog);
  if (channel.status === 'pending') {
    schedulePairQrAutoRefresh(channel);
  } else {
    stopPairQrAutoRefresh();
  }
}

async function openPairQrDialog(channelId) {
  const channel = findPairChannelById(channelId);
  await openPairQrDialogForChannel(channel);
}

async function revokePairBinding(bindingId) {
  const id = String(bindingId || '').trim();
  if (!id) {
    return;
  }
  const baseUrl = getPairServerBaseUrl();
  const serverToken = await ensurePairServerToken();
  const endpoint = buildPairHttpUrl(baseUrl, '/v1/pair/revoke');
  const headers = {
    'Content-Type': 'application/json'
  };
  if (serverToken) {
    headers.Authorization = `Bearer ${serverToken}`;
  }
  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
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
  if (removed && removed.channelId === pairQrActiveChannelId) {
    stopPairQrAutoRefresh();
  }
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
  setPairQrCountdownText('');
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

function pairDeviceTokenKey(baseUrl, deviceId) {
  const normalizedBaseUrl = normalizePairBaseUrl(baseUrl);
  const normalizedDeviceId = String(deviceId || '').trim();
  return `${normalizedBaseUrl}::${normalizedDeviceId}`;
}

function readPairDeviceTokenStore() {
  const raw = localStorage.getItem(PAIR_DEVICE_TOKEN_STORAGE_KEY);
  if (!raw) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }
    return parsed;
  } catch {
    return {};
  }
}

function writePairDeviceTokenStore(store) {
  localStorage.setItem(PAIR_DEVICE_TOKEN_STORAGE_KEY, JSON.stringify(store || {}));
}

function getStoredPairDeviceToken(baseUrl, deviceId) {
  const key = pairDeviceTokenKey(baseUrl, deviceId);
  if (!key || key === '::') {
    return '';
  }
  const store = readPairDeviceTokenStore();
  return String(store[key] || '').trim();
}

function setStoredPairDeviceToken(baseUrl, deviceId, token) {
  const key = pairDeviceTokenKey(baseUrl, deviceId);
  const normalizedToken = String(token || '').trim();
  if (!key || key === '::' || !normalizedToken) {
    return;
  }
  const store = readPairDeviceTokenStore();
  store[key] = normalizedToken;
  writePairDeviceTokenStore(store);
}

function clearStoredPairDeviceToken(baseUrl, deviceId) {
  const key = pairDeviceTokenKey(baseUrl, deviceId);
  if (!key || key === '::') {
    return;
  }
  const store = readPairDeviceTokenStore();
  if (!(key in store)) {
    return;
  }
  delete store[key];
  writePairDeviceTokenStore(store);
}

async function requestPairDeviceRegister(baseUrl, deviceId, token) {
  const endpoint = buildPairHttpUrl(baseUrl, '/v1/devices/register');
  const headers = {
    'Content-Type': 'application/json'
  };
  const authToken = String(token || '').trim();
  if (authToken) {
    headers.Authorization = `Bearer ${authToken}`;
  }

  let response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        deviceId,
        platform: 'desktop',
        appVersion: 'openclaw-desktop'
      })
    });
  } catch (error) {
    throw new Error(`register device network failed: ${error?.message || String(error)}`);
  }

  let result = null;
  try {
    result = await response.json();
  } catch {
    result = null;
  }

  if (!response.ok || !result?.ok || !result?.device) {
    const message = result?.message || result?.error || `HTTP ${response.status}`;
    throw new Error(String(message));
  }

  const nextToken = String(result.device.deviceToken || result.device.device_token || '').trim();
  if (!nextToken) {
    throw new Error('device token missing in register response');
  }
  setStoredPairDeviceToken(baseUrl, deviceId, nextToken);
  return nextToken;
}

async function ensurePairServerToken({ forceRegister = false } = {}) {
  const baseUrl = getPairServerBaseUrl();
  const deviceId = getPairDeviceId();

  if (!forceRegister) {
    const existing = getStoredPairDeviceToken(baseUrl, deviceId);
    if (existing) {
      return existing;
    }
  }

  const cached = getStoredPairDeviceToken(baseUrl, deviceId);
  if (cached) {
    try {
      return await requestPairDeviceRegister(baseUrl, deviceId, cached);
    } catch (error) {
      const message = String(error?.message || error || '').toLowerCase();
      if (!message.includes('unauthorized') && !message.includes('forbidden') && !message.includes('token')) {
        throw error;
      }
      clearStoredPairDeviceToken(baseUrl, deviceId);
    }
  }

  return requestPairDeviceRegister(baseUrl, deviceId, '');
}

function getPairServerToken() {
  try {
    const baseUrl = getPairServerBaseUrl();
    const deviceId = getPairDeviceId();
    return getStoredPairDeviceToken(baseUrl, deviceId);
  } catch {
    return '';
  }
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

  const sendViaHttp = async (serverToken) => {
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
  };

  let token = getPairServerToken();
  if (!token) {
    token = await ensurePairServerToken({ forceRegister: true });
  }

  try {
    return await sendViaHttp(token);
  } catch (error) {
    if (!isPairAuthFailure(error)) {
      throw error;
    }
    token = await ensurePairServerToken({ forceRegister: true });
    return sendViaHttp(token);
  }
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
  const createUnavailable = !hasConfig || !pairChannelOpen || connecting;
  pairChannelToggleBtn.classList.add('pair-toggle');
  pairChannelToggleBtn.classList.toggle('is-on', pairChannelOpen);
  pairChannelToggleBtn.classList.toggle('is-off', !pairChannelOpen);
  pairChannelToggleBtn.setAttribute('aria-pressed', pairChannelOpen ? 'true' : 'false');
  pairChannelToggleBtn.textContent = pairChannelOpen ? t('pair.toggle.on') : t('pair.toggle.off');
  pairChannelToggleBtn.disabled = connecting || !hasConfig;
  pairCreateChannelBtn.disabled = connecting;
  pairCreateChannelBtn.classList.toggle('is-disabled', createUnavailable);
  pairCreateChannelBtn.setAttribute('aria-disabled', createUnavailable ? 'true' : 'false');
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

function setModelValue(value, { syncApiMode = true } = {}) {
  const model = String(value || '').trim();
  modelInput.value = model;
  if (syncApiMode) {
    syncCustomApiModeForCurrentModel();
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
  const presetId = detectProviderPresetId(config);
  const preset = getProviderPreset(presetId);
  summaryProvider.textContent = textByLang(preset.label) || config.provider || '-';
  summaryModel.textContent = config.model || '-';
  summaryApiKey.textContent = config.apiKeyMasked || '********';
  summaryBaseUrl.textContent = config.baseUrl || '-';
  summaryCommand.textContent = config.openclawCommand || 'openclaw';
  const summaryMode = normalizeCustomApiModeByBaseUrl(config.baseUrl || '', config.customApiMode || '');
  const isCustomProvider = String(config.provider || '').trim().toLowerCase() === 'custom';
  if (summaryCustomApiMode instanceof HTMLSelectElement) {
    summaryCustomApiMode.value = summaryMode || '';
    summaryCustomApiMode.disabled = !isCustomProvider;
  } else {
    summaryCustomApiMode.textContent = summaryMode || '-';
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

function setKernelVersionMetaText(text) {
  if (kernelVersionMetaSetup) {
    kernelVersionMetaSetup.textContent = text;
  }
  if (kernelVersionMetaMain) {
    kernelVersionMetaMain.textContent = text;
  }
}

function normalizeKernelVersionLabel(rawVersion) {
  const version = String(rawVersion || '').trim();
  if (!version) {
    return t('kernel.unknown');
  }

  // Keep only semantic-like version for display, hide commit hash/build suffix.
  const match = version.match(/v?\d+\.\d+\.\d+/);
  if (match?.[0]) {
    return match[0].replace(/^v/i, '');
  }
  return version;
}

function renderKernelVersionMeta(meta) {
  const currentVersion = normalizeKernelVersionLabel(meta?.currentVersion || kernelStatus?.version);
  const latestVersion = normalizeKernelVersionLabel(meta?.latestVersion);
  if (latestVersion) {
    setKernelVersionMetaText(
      t('kernel.version.meta', {
        current: currentVersion,
        latest: latestVersion
      })
    );
    return;
  }

  if (meta?.latestError) {
    setKernelVersionMetaText(
      t('kernel.version.failed', {
        current: currentVersion
      })
    );
    return;
  }

  setKernelVersionMetaText(
    t('kernel.version.metaUnknownLatest', {
      current: currentVersion
    })
  );
}

async function refreshKernelVersionMeta(force = false) {
  if (!kernelVersionMetaSetup && !kernelVersionMetaMain) {
    return;
  }

  const cacheFresh =
    kernelVersionMeta &&
    Date.now() - kernelVersionMetaCheckedAt < KERNEL_VERSION_META_TTL_MS;
  if (!force && cacheFresh) {
    renderKernelVersionMeta(kernelVersionMeta);
    return;
  }

  setKernelVersionMetaText(t('kernel.version.loading'));
  try {
    kernelVersionMeta = await invoke('get_kernel_version_meta');
    kernelVersionMetaCheckedAt = Date.now();
    renderKernelVersionMeta(kernelVersionMeta);
  } catch {
    kernelVersionMeta = null;
    kernelVersionMetaCheckedAt = 0;
    setKernelVersionMetaText(
      t('kernel.version.failed', {
        current: normalizeKernelVersionLabel(kernelStatus?.version)
      })
    );
  }
}

async function refreshKernelStatus(forceVersionCheck = false) {
  try {
    kernelStatus = await invoke('get_kernel_status');
    summaryKernel.textContent = formatKernelStatus(kernelStatus);
  } catch {
    kernelStatus = null;
    summaryKernel.textContent = t('kernel.unknown');
  }
  await refreshKernelVersionMeta(forceVersionCheck);
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
  applyProviderPreset(providerInput.value || activeProviderId || 'openai', { hydrate: true });
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
      stopPairQrAutoRefresh();
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
    stopPairQrAutoRefresh();
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
  try {
    setPairMessage(t('msg.pairAuthEnsuring'));
    await ensurePairServerToken({ forceRegister: true });
  } catch (error) {
    pairDesiredConnected = false;
    renderPairWsStatus('disconnected');
    setPairMessage(t('msg.pairAuthFailed', { message: error?.message || String(error) }), 'error');
    updatePairButtons();
    return;
  }

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
  stopPairQrAutoRefresh();
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
  clearPairQrPreview();
  setPairMessage(t('msg.pairCreateRunning'));

  let serverToken = '';
  try {
    setPairMessage(t('msg.pairAuthEnsuring'));
    serverToken = await ensurePairServerToken({ forceRegister: true });
  } catch (error) {
    setPairMessage(t('msg.pairAuthFailed', { message: error?.message || String(error) }), 'error');
    return;
  }

  let session;
  try {
    session = await requestPairSession({ baseUrl, deviceId, serverToken });
  } catch (error) {
    setPairMessage(t('msg.pairCreateFailed', { message: error?.message || String(error) }), 'error');
    appendPairEvent(`create failed: ${error?.message || String(error)}`);
    return;
  }

  const qrPayload = await sanitizePairQrPayload(buildPairQrPayload(session, baseUrl), baseUrl);
  const createdChannel = upsertPairChannel({
    channelId: String(session.sessionId || `ch_${Date.now()}`),
    sessionId: String(session.sessionId || ''),
    status: 'pending',
    mobileId: '',
    userId: '',
    bindingId: '',
    createdAt: Date.now(),
    expiresAt: session.expiresAt,
    qrPayload,
    messages: []
  });
  renderPairChannelCards();
  setPairMessage(t('msg.pairCreated'), 'success');
  appendPairEvent(`session ${session.sessionId || '-'} created`);
  await openPairQrDialogForChannel(createdChannel);
  updatePairButtons();
}

function toMillis(rawValue) {
  if (rawValue === null || rawValue === undefined || rawValue === '') {
    return 0;
  }
  if (typeof rawValue === 'number' && Number.isFinite(rawValue) && rawValue > 0) {
    return rawValue;
  }
  if (typeof rawValue === 'string') {
    const numeric = Number(rawValue);
    if (Number.isFinite(numeric) && numeric > 0) {
      return numeric;
    }
    const parsed = Date.parse(rawValue);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return 0;
}

function normalizePairSession(rawSession) {
  const source = rawSession && typeof rawSession === 'object' ? rawSession : {};
  const sessionId = String(
    source.pairSessionId || source.pair_session_id || source.sessionId || source.session_id || ''
  ).trim();
  const pairCode = String(source.pairCode || source.pair_code || '').trim();
  const pairToken = String(source.pairToken || source.pair_token || '').trim();
  const deviceId = String(source.deviceId || source.device_id || '').trim();
  const expiresAt = toMillis(source.expiresAt || source.expires_at);
  return {
    sessionId,
    pairCode,
    pairToken,
    deviceId,
    expiresAt: expiresAt || Date.now() + PAIR_SESSION_TTL_SECONDS * 1000
  };
}

function buildPairQrPayload(session, baseUrl) {
  const expiresAtIso = new Date(session.expiresAt).toISOString();
  return {
    kind: 'openclaw.pair',
    version: 'v1',
    base_url: baseUrl,
    session_id: session.sessionId,
    pair_code: session.pairCode,
    pair_token: session.pairToken,
    expires_at: expiresAtIso
  };
}

function isPairAuthFailure(error) {
  const message = String(error?.message || error || '').toLowerCase();
  if (!message) {
    return false;
  }
  return message.includes('unauthorized') || message.includes('forbidden') || message.includes('token');
}

async function requestPairSession({ baseUrl, deviceId, serverToken }) {
  const endpoint = buildPairHttpUrl(baseUrl, '/v1/pair/sessions');
  appendPairEvent(`create pair session -> ${endpoint}`);

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
        deviceId,
        ttlSeconds: PAIR_SESSION_TTL_SECONDS
      })
    });
  } catch (error) {
    throw new Error(`network failed: ${error?.message || String(error)}`);
  }

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

  const session = normalizePairSession(result.session || result.data || {});
  if (!session.sessionId || !session.pairToken || !session.pairCode) {
    throw new Error('invalid pair session payload');
  }
  return session;
}

async function refreshPairSessionForChannel(channel, { autoRefresh = false } = {}) {
  if (!channel) {
    throw new Error('channel not found');
  }
  let baseUrl;
  let deviceId;
  try {
    baseUrl = getPairServerBaseUrl();
    deviceId = getPairDeviceId();
  } catch (error) {
    throw new Error(error?.message || String(error));
  }

  let serverToken = getPairServerToken();
  if (!serverToken) {
    serverToken = await ensurePairServerToken({ forceRegister: true });
  }

  let session;
  try {
    session = await requestPairSession({ baseUrl, deviceId, serverToken });
  } catch (error) {
    if (!isPairAuthFailure(error)) {
      throw error;
    }
    const refreshedToken = await ensurePairServerToken({ forceRegister: true });
    session = await requestPairSession({ baseUrl, deviceId, serverToken: refreshedToken });
  }

  channel.sessionId = session.sessionId;
  channel.status = 'pending';
  channel.mobileId = '';
  channel.userId = '';
  channel.bindingId = '';
  channel.expiresAt = session.expiresAt;
  channel.qrPayload = await sanitizePairQrPayload(buildPairQrPayload(session, baseUrl), baseUrl);
  renderPairChannelCards();

  if (!autoRefresh) {
    setPairMessage(t('msg.pairCreated'), 'success');
    appendPairEvent(`session ${session.sessionId || '-'} refreshed`);
  } else {
    appendPairEvent(`session ${session.sessionId || '-'} auto-refreshed`);
  }

  if (pairQrDialog?.open && pairQrActiveChannelId === channel.channelId) {
    await renderPairQrPreview(channel.qrPayload);
    schedulePairQrAutoRefresh(channel);
  }

  updatePairButtons();
  return channel;
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
  stopPairQrAutoRefresh();
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
    if (!pairConfiguredServerUrl || !pairConfiguredDeviceId) {
      setPairMessage(t('msg.pairMissingConfig'), 'error');
      return;
    }
    if (!pairChannelOpen) {
      setPairMessage(t('msg.pairChannelClosedForCreate'), 'error');
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
    stopPairQrAutoRefresh();
  });
  pairQrDialog?.addEventListener?.('close', () => {
    stopPairQrAutoRefresh();
  });
  pairQrDialog?.addEventListener?.('cancel', () => {
    stopPairQrAutoRefresh();
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
  platformBadge.textContent = `${state.platform} | v${state.version}`;

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

  rawConfig = state.config || null;
  applyPairConfigFromRawConfig();
  const presetId = detectProviderPresetId(rawConfig || {});
  providerInput.value = presetId;
  applyProviderPreset(presetId, { hydrate: true });
  const preset = getActiveProviderPreset();

  setModelValue(rawConfig?.model || '');
  baseUrlInput.value = preset.showBaseUrl
    ? rawConfig?.baseUrl || preset.baseUrlDefault || ''
    : '';
  commandInput.value = rawConfig?.openclawCommand || 'openclaw';
  const hydratedCustomApiMode = preset.showCustomOptions
    ? normalizeCustomApiModeByBaseUrl(
        baseUrlInput.value,
        rawConfig?.customApiMode || ''
      )
    : '';
  customApiModeInput.value = hydratedCustomApiMode;
  if (preset.showCustomOptions && hydratedCustomApiMode) {
    rememberCustomApiModeForCurrentModel(preset);
  } else if (preset.showCustomOptions) {
    syncCustomApiModeForCurrentModel();
  }
  if (preset.showCustomOptions && rawConfig?.customHeaders && Object.keys(rawConfig.customHeaders).length > 0) {
    customHeadersInput.value = JSON.stringify(rawConfig.customHeaders, null, 2);
  } else if (preset.showCustomOptions) {
    customHeadersInput.value = defaultCustomHeadersText();
  } else {
    customHeadersInput.value = '';
  }
  if (isCloudflarePreset(preset)) {
    hydrateCloudflareInputsFromBaseUrl(baseUrlInput.value.trim());
    baseUrlInput.value = resolveProviderBaseUrl(preset);
  }
  apiKeyInput.value = '';
  skillsDirs = dedupeSkillsDirs(rawConfig?.skillsDirs || []);
  renderSkillsDirs();
  refreshCustomInputs();
  if (preset.fetchModels && preset.runtimeProvider === 'custom' && resolveProviderBaseUrl(preset)) {
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
      return;
    }
    if (!gatewayId) {
      setSetupMessage(t('msg.cloudflareGatewayIdRequired'), 'error');
      return;
    }
    baseUrl = resolveProviderBaseUrl(preset);
  }
  const customApiMode = normalizeCustomApiModeByBaseUrl(
    baseUrl,
    customApiModeInput.value.trim()
  );
  const customHeadersJson = preset.showCustomOptions ? customHeadersInput.value.trim() : '';

  if (!model) {
    setSetupMessage(t('msg.modelRequired'), 'error');
    return;
  }

  if (preset.showCustomOptions && !customApiMode) {
    setSetupMessage(t('msg.customApiModeRequired'), 'error');
    return;
  }

  if (isManagedAuthPreset(preset)) {
    setSetupMessage(t('msg.authChecking'));
    const authResult = await invoke('check_provider_auth', {
      provider: preset.runtimeProvider || preset.id
    });
    if (!authResult?.ok) {
      setSetupMessage(authResult?.message || t('msg.authNotReady'), 'error');
      doctorOutput.textContent = authResult?.detail || '';
      return;
    }
  }

  if (preset.showBaseUrl && preset.baseUrlRequired && !baseUrl) {
    setSetupMessage(t('msg.baseUrlRequiredForProvider'), 'error');
    return;
  }

  if (!apiKey && !preset.keyRequired) {
    apiKey = preset.autoApiKey || 'local';
  }
  if (!apiKey && preset.keyRequired) {
    setSetupMessage(t('msg.apiKeyRequiredForProvider'), 'error');
    return;
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
      return;
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
    skillsDirs
  };

  setSetupMessage(t('msg.savingConfig'));
  const result = await invoke('save_config', { payload });

  if (!result.ok) {
    setSetupMessage(result.message || t('msg.saveFailed'), 'error');
    return;
  }

  rememberCustomApiModeForCurrentModel(preset);

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
    await refreshKernelStatus(true);
    return;
  }

  setSetupMessage(result.message || t('msg.actionCompleted', { label: buttonLabel }), 'success');
  doctorOutput.textContent = `${result.message}\n\n${result.detail || ''}`.trim();
  await refreshKernelStatus(true);
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
  const presetId = detectProviderPresetId(rawConfig || {});
  providerInput.value = presetId;
  applyProviderPreset(presetId, { hydrate: true });
  const preset = getActiveProviderPreset();
  setModelValue(rawConfig?.model || '');
  baseUrlInput.value = preset.showBaseUrl
    ? rawConfig?.baseUrl || preset.baseUrlDefault || ''
    : '';
  commandInput.value = rawConfig?.openclawCommand || 'openclaw';
  const reconfiguredCustomApiMode = preset.showCustomOptions
    ? normalizeCustomApiModeByBaseUrl(
        baseUrlInput.value,
        rawConfig?.customApiMode || ''
      )
    : '';
  customApiModeInput.value = reconfiguredCustomApiMode;
  if (preset.showCustomOptions && reconfiguredCustomApiMode) {
    rememberCustomApiModeForCurrentModel(preset);
  } else if (preset.showCustomOptions) {
    syncCustomApiModeForCurrentModel();
  }
  if (preset.showCustomOptions && rawConfig?.customHeaders && Object.keys(rawConfig.customHeaders).length > 0) {
    customHeadersInput.value = JSON.stringify(rawConfig.customHeaders, null, 2);
  } else if (preset.showCustomOptions) {
    customHeadersInput.value = defaultCustomHeadersText();
  } else {
    customHeadersInput.value = '';
  }
  if (isCloudflarePreset(preset)) {
    hydrateCloudflareInputsFromBaseUrl(baseUrlInput.value.trim());
    baseUrlInput.value = resolveProviderBaseUrl(preset);
  }
  apiKeyInput.value = rawConfig?.apiKey || '';
  skillsDirs = dedupeSkillsDirs(rawConfig?.skillsDirs || []);
  renderSkillsDirs();
  refreshCustomInputs();
  renderModelSuggestions([]);
  lastModelFetchKey = '';
  if (preset.fetchModels && preset.runtimeProvider === 'custom' && resolveProviderBaseUrl(preset)) {
    await fetchModels({ silent: true });
  }
  setSetupMessage('');
  showSetup();
});

providerShowAdvancedToggle?.addEventListener('change', () => {
  showAdvancedProviders = Boolean(providerShowAdvancedToggle.checked);
  localStorage.setItem('openclaw.ui.provider.showAdvanced', showAdvancedProviders ? '1' : '0');
  if (!showAdvancedProviders && isAdvancedProviderPreset(getActiveProviderPreset())) {
    providerInput.value = 'openai';
    activeProviderId = 'openai';
  }
  populateProviderOptions();
  applyProviderPreset(providerInput.value, { hydrate: false });
  apiKeyInput.value = '';
  setModelValue('');
  renderModelSuggestions([]);
  lastModelFetchKey = '';
});

copyProviderAuthCmdBtn?.addEventListener('click', async () => {
  const preset = getActiveProviderPreset();
  const command = getProviderLoginCommand(preset);
  if (!command) {
    return;
  }

  const provider = String(preset?.runtimeProvider || preset?.id || '').trim();
  if (!provider) {
    return;
  }

  setSetupMessage(t('msg.authLaunching'));

  try {
    const result = await invoke('start_provider_auth_login', { provider });
    if (!result?.ok) {
      setSetupMessage(result?.message || t('msg.authLaunchFailed'), 'error');
      doctorOutput.textContent = `${result?.message || t('msg.authLaunchFailed')}\n\n${result?.detail || ''}`.trim();
      return;
    }

    setSetupMessage(result.message || t('msg.authLaunchStarted'), 'success');
    doctorOutput.textContent = `${result.message || t('msg.authLaunchStarted')}\n\n${result.detail || ''}`.trim();
  } catch (error) {
    const detail = String(error || '');
    setSetupMessage(t('msg.authLaunchFailed'), 'error');
    doctorOutput.textContent = `${t('msg.authLaunchFailed')}\n\n${detail}\n${t('msg.loginCommandCopyFailed', { cmd: command })}`.trim();
  }
});

providerInput.addEventListener('change', async () => {
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
  lastModelFetchKey = '';
  if (preset.fetchModels && preset.runtimeProvider === 'custom' && resolveProviderBaseUrl(preset)) {
    await fetchModels({ silent: true });
  }
});

fetchModelsBtn.addEventListener('click', async () => {
  await fetchModels({ force: true });
});

modelInput.addEventListener('focus', () => {
  openModelDropdown();
});

modelInput.addEventListener('click', () => {
  openModelDropdown();
});

modelInput.addEventListener('input', () => {
  modelDropdownQuery = modelInput.value || '';
  syncCustomApiModeForCurrentModel();
  if (isModelDropdownOpen) {
    renderModelDropdown();
  }
});

modelInput.addEventListener('keydown', (event) => {
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

baseUrlInput.addEventListener('blur', async () => {
  const preset = getActiveProviderPreset();
  const baseUrl = resolveProviderBaseUrl(preset);
  customApiModeInput.value = normalizeCustomApiModeByBaseUrl(
    baseUrl,
    customApiModeInput.value.trim()
  );
  if (isCloudflarePreset(preset)) {
    resolveProviderBaseUrl(preset);
  }
  await fetchModels({ silent: true, force: true });
});

apiKeyInput.addEventListener('blur', async () => {
  await fetchModels({ silent: true, force: true });
});

customApiModeInput.addEventListener('change', async () => {
  const preset = getActiveProviderPreset();
  const baseUrl = resolveProviderBaseUrl(preset);
  customApiModeInput.value = normalizeCustomApiModeByBaseUrl(
    baseUrl,
    customApiModeInput.value.trim()
  );
  rememberCustomApiModeForCurrentModel(preset);
  if (isCloudflarePreset(preset)) {
    resolveProviderBaseUrl(preset);
  }
  await fetchModels({ silent: true, force: true });
});

const onCloudflareFieldChanged = async () => {
  const preset = getActiveProviderPreset();
  if (!isCloudflarePreset(preset)) {
    return;
  }
  resolveProviderBaseUrl(preset);
  await fetchModels({ silent: true, force: true });
};

cloudflareAccountIdInput?.addEventListener('input', onCloudflareFieldChanged);
cloudflareGatewayIdInput?.addEventListener('input', onCloudflareFieldChanged);

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
  if (String(current.provider || '').trim().toLowerCase() !== 'custom') {
    return;
  }

  const summaryMode = normalizeCustomApiModeByBaseUrl(
    current.baseUrl || '',
    summaryCustomApiMode.value || ''
  );
  if (!summaryMode) {
    doctorOutput.textContent = t('msg.customApiModeRequired');
    return;
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
  stopPairQrAutoRefresh();
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

initProviderFilter();
initLanguage();
initPairCenter();
loadState();
