export const DEFAULT_CUSTOM_API_MODE = 'openai-responses';
const SUPPORTED_CUSTOM_API_MODES = new Set([
  'openai-responses',
  'openai-completions',
  'anthropic-messages'
]);

export const CLOUDFLARE_PRESET_ID = 'cloudflare-ai-gateway';

export const DOC_PROVIDER_OVERVIEW = 'https://docs.openclaw.ai/concepts/model-providers';
export const DEFAULT_CUSTOM_HEADERS = Object.freeze({
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

export const PROVIDER_PRESETS = [
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

export const providerPresetMap = new Map(PROVIDER_PRESETS.map((preset) => [preset.id, preset]));

export function normalizeCustomApiModeByBaseUrl(baseUrl, customApiMode) {
  const normalized = String(customApiMode || '').trim();
  if (!normalized) {
    return '';
  }
  return SUPPORTED_CUSTOM_API_MODES.has(normalized) ? normalized : '';
}

export function isCloudflarePresetId(presetId) {
  return String(presetId || '').trim() === CLOUDFLARE_PRESET_ID;
}

export function isCloudflarePreset(preset) {
  return isCloudflarePresetId(preset?.id);
}

export function cloudflareRouteByApiMode(customApiMode) {
  return String(customApiMode || '').trim() === 'anthropic-messages' ? 'anthropic' : 'openai';
}

export function buildCloudflareBaseUrl(accountId, gatewayId, customApiMode) {
  const account = String(accountId || '').trim();
  const gateway = String(gatewayId || '').trim();
  if (!account || !gateway) {
    return '';
  }
  const route = cloudflareRouteByApiMode(customApiMode || DEFAULT_CUSTOM_API_MODE);
  return `https://gateway.ai.cloudflare.com/v1/${account}/${gateway}/${route}`;
}

export function parseCloudflareBaseUrl(baseUrl) {
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

export function normalizeUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '').toLowerCase();
}

export function getProviderPreset(id) {
  return providerPresetMap.get(String(id || '').trim()) || providerPresetMap.get('custom');
}

export function isManagedAuthPreset(preset) {
  return String(preset?.authKind || '').trim() === 'managed-auth';
}

export function isAdvancedProviderPreset(preset) {
  const kind = String(preset?.authKind || '').trim();
  return kind === 'managed-auth' || kind === 'cloud-credentials';
}

export function getProviderLoginCommand(preset) {
  if (!isManagedAuthPreset(preset)) {
    return '';
  }
  const providerId = String(preset?.runtimeProvider || preset?.id || '').trim();
  if (!providerId) {
    return '';
  }
  return `openclaw models auth login --provider ${providerId}`;
}
