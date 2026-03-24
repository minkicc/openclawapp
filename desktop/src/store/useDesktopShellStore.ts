import { create } from 'zustand';

type PairChannelState = any;

type SummaryState = {
  provider: string;
  model: string;
  apiKey: string;
  baseUrl: string;
  command: string;
  customApiMode: string;
  customHeaders: string;
  kernelStatus: string;
  configPath: string;
  isCustomProvider: boolean;
  skillsDirs: string[];
  doctorOutput: string;
};

type ProviderGuideState = {
  description: string;
  requiredFields: string[];
  tips: string[];
  docsHref: string;
  docsText: string;
  authNoticeVisible: boolean;
  authHint: string;
  copyAuthVisible: boolean;
  apiKeyLabel: string;
  apiKeyHint: string;
  baseUrlVisible: boolean;
  baseUrlHint: string;
  cloudflareVisible: boolean;
  customApiModeVisible: boolean;
  customHeadersVisible: boolean;
  fetchModelsVisible: boolean;
  fetchModelsDisabled: boolean;
  modelHint: string;
};

type SetupFormState = {
  showAdvancedProviders: boolean;
  providerId: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  customApiMode: string;
  customHeaders: string;
  cloudflareAccountId: string;
  cloudflareGatewayId: string;
  command: string;
  skillsDirs: string[];
  setupMessage: string;
  setupMessageType: string;
};

type SetupActions = {
  removeSkillDir: (dirPath: string) => void;
  addSkillDir: () => void | Promise<void>;
  installDefaultSkills: () => void | Promise<void>;
  installKernel: () => void | Promise<void>;
  saveAndEnter: () => void | Promise<void>;
};

type MainActions = {
  openWeb: () => void | Promise<void>;
  reconfigure: () => void | Promise<void>;
  runDoctor: () => void | Promise<void>;
  updateKernel: () => void | Promise<void>;
  openFirstSkillDir: () => void | Promise<void>;
  saveSummaryCustomApiMode: (mode: string) => void | Promise<void>;
};

type PairPanelState = {
  channels: PairChannelState[];
  wsStatus: string;
  statusMessage: string;
  statusType: string;
  channelOpen: boolean;
  channelToggleDisabled: boolean;
  createChannelDisabled: boolean;
  createChannelAriaDisabled: boolean;
  chatSendDisabled: boolean;
  eventLog: string;
  qrDialogOpen: boolean;
  qrImageSrc: string;
  chatDialogOpen: boolean;
  activeChatChannelId: string;
  chatDialogTitle: string;
  chatDraft: string;
};

type PairActions = {
  renameChannel: (channelId: string, nextName: string) => void;
  showQr: (channelId: string) => void | Promise<void>;
  openChat: (channelId: string) => void;
  approveChannel: (channelId: string) => void | Promise<void>;
  deleteChannel: (channelId: string) => void | Promise<void>;
  reloadConfig: () => void | Promise<void>;
  toggleChannel: () => void | Promise<void>;
  createChannel: () => void | Promise<void>;
  closeQr: () => void;
  closeChat: () => void;
  sendChat: () => void | Promise<void>;
  setChatDraft: (draft: string) => void;
};

type DesktopShellState = {
  framework: 'react-ts';
  legacyBootstrapped: boolean;
  shellMountedAt: number | null;
  viewMode: 'setup' | 'main';
  platformBadge: string;
  kernelBadge: string;
  currentLang: 'zh-CN' | 'en-US';
  providerGuide: ProviderGuideState;
  setupForm: SetupFormState;
  setupActions: SetupActions;
  mainActions: MainActions;
  summary: SummaryState;
  pair: PairPanelState;
  pairActions: PairActions;
  markLegacyBootstrapped: () => void;
  setViewMode: (viewMode: 'setup' | 'main') => void;
  setPlatformBadge: (text: string) => void;
  setKernelBadge: (text: string) => void;
  setCurrentLang: (lang: 'zh-CN' | 'en-US') => void;
  setProviderGuide: (patch: Partial<ProviderGuideState>) => void;
  setSetupForm: (patch: Partial<SetupFormState>) => void;
  setSetupActions: (patch: Partial<SetupActions>) => void;
  setMainActions: (patch: Partial<MainActions>) => void;
  setSummary: (patch: Partial<SummaryState>) => void;
  setPairState: (patch: Partial<PairPanelState>) => void;
  setPairActions: (patch: Partial<PairActions>) => void;
};

export const useDesktopShellStore = create<DesktopShellState>((set) => ({
  framework: 'react-ts',
  legacyBootstrapped: false,
  shellMountedAt: null,
  viewMode: 'setup',
  platformBadge: '--',
  kernelBadge: 'OpenClaw --',
  currentLang: 'zh-CN',
  providerGuide: {
    description: '',
    requiredFields: [],
    tips: [],
    docsHref: 'https://docs.openclaw.ai/concepts/model-providers',
    docsText: '查看该提供商接入文档',
    authNoticeVisible: false,
    authHint: '',
    copyAuthVisible: false,
    apiKeyLabel: 'Model API Key',
    apiKeyHint: '',
    baseUrlVisible: true,
    baseUrlHint: '',
    cloudflareVisible: false,
    customApiModeVisible: false,
    customHeadersVisible: false,
    fetchModelsVisible: true,
    fetchModelsDisabled: false,
    modelHint: ''
  },
  setupForm: {
    showAdvancedProviders: false,
    providerId: 'openai',
    baseUrl: '',
    apiKey: '',
    model: '',
    customApiMode: '',
    customHeaders: '',
    cloudflareAccountId: '',
    cloudflareGatewayId: '',
    command: 'openclaw',
    skillsDirs: [],
    setupMessage: '',
    setupMessageType: ''
  },
  setupActions: {
    removeSkillDir: () => {},
    addSkillDir: () => {},
    installDefaultSkills: () => {},
    installKernel: () => {},
    saveAndEnter: () => {}
  },
  mainActions: {
    openWeb: () => {},
    reconfigure: () => {},
    runDoctor: () => {},
    updateKernel: () => {},
    openFirstSkillDir: () => {},
    saveSummaryCustomApiMode: () => {}
  },
  summary: {
    provider: '-',
    model: '-',
    apiKey: '********',
    baseUrl: '-',
    command: 'openclaw',
    customApiMode: '',
    customHeaders: '-',
    kernelStatus: '-',
    configPath: '-',
    isCustomProvider: false,
    skillsDirs: [],
    doctorOutput: ''
  },
  pair: {
    channels: [],
    wsStatus: '-',
    statusMessage: '',
    statusType: '',
    channelOpen: false,
    channelToggleDisabled: false,
    createChannelDisabled: false,
    createChannelAriaDisabled: true,
    chatSendDisabled: true,
    eventLog: '',
    qrDialogOpen: false,
    qrImageSrc: '',
    chatDialogOpen: false,
    activeChatChannelId: '',
    chatDialogTitle: '',
    chatDraft: ''
  },
  pairActions: {
    renameChannel: () => {},
    showQr: () => {},
    openChat: () => {},
    approveChannel: () => {},
    deleteChannel: () => {},
    reloadConfig: () => {},
    toggleChannel: () => {},
    createChannel: () => {},
    closeQr: () => {},
    closeChat: () => {},
    sendChat: () => {},
    setChatDraft: () => {}
  },
  markLegacyBootstrapped: () =>
    set((state) => ({
      legacyBootstrapped: true,
      shellMountedAt: state.shellMountedAt ?? Date.now()
    })),
  setViewMode: (viewMode) => set({ viewMode }),
  setPlatformBadge: (platformBadge) => set({ platformBadge }),
  setKernelBadge: (kernelBadge) => set({ kernelBadge }),
  setCurrentLang: (currentLang) => set({ currentLang }),
  setProviderGuide: (patch) =>
    set((state) => ({
      providerGuide: {
        ...state.providerGuide,
        ...patch
      }
    })),
  setSetupForm: (patch) =>
    set((state) => ({
      setupForm: {
        ...state.setupForm,
        ...patch
      }
    })),
  setSetupActions: (patch) =>
    set((state) => ({
      setupActions: {
        ...state.setupActions,
        ...patch
      }
    })),
  setMainActions: (patch) =>
    set((state) => ({
      mainActions: {
        ...state.mainActions,
        ...patch
      }
    })),
  setSummary: (patch) =>
    set((state) => ({
      summary: {
        ...state.summary,
        ...patch
      }
    })),
  setPairState: (patch) =>
    set((state) => ({
      pair: {
        ...state.pair,
        ...patch
      }
    })),
  setPairActions: (patch) =>
    set((state) => ({
      pairActions: {
        ...state.pairActions,
        ...patch
      }
    }))
}));
