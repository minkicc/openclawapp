import { useDesktopShellStore } from '../store/useDesktopShellStore';

type SetupFormElements = {
  providerShowAdvancedToggle?: HTMLInputElement | null;
  providerInput?: HTMLSelectElement | null;
  baseUrlInput?: HTMLInputElement | null;
  apiKeyInput?: HTMLInputElement | null;
  modelInput?: HTMLInputElement | null;
  customApiModeInput?: HTMLSelectElement | null;
  customHeadersInput?: HTMLTextAreaElement | null;
  cloudflareAccountIdInput?: HTMLInputElement | null;
  cloudflareGatewayIdInput?: HTMLInputElement | null;
  commandInput?: HTMLInputElement | null;
};

export function syncSetupFormFromElements(
  elements: SetupFormElements,
  patch: Record<string, unknown> = {}
) {
  const currentSkillsDirs = useDesktopShellStore.getState().setupForm.skillsDirs;
  useDesktopShellStore.getState().setSetupForm({
    showAdvancedProviders: Boolean(elements.providerShowAdvancedToggle?.checked),
    providerId: String(elements.providerInput?.value || 'openai'),
    baseUrl: String(elements.baseUrlInput?.value || ''),
    apiKey: String(elements.apiKeyInput?.value || ''),
    model: String(elements.modelInput?.value || ''),
    customApiMode: String(elements.customApiModeInput?.value || ''),
    customHeaders: String(elements.customHeadersInput?.value || ''),
    cloudflareAccountId: String(elements.cloudflareAccountIdInput?.value || ''),
    cloudflareGatewayId: String(elements.cloudflareGatewayIdInput?.value || ''),
    command: String(elements.commandInput?.value || 'openclaw'),
    skillsDirs: Array.isArray(currentSkillsDirs) ? currentSkillsDirs : [],
    ...patch
  });
}

export function syncSetupMessageState(message: string, type = '') {
  useDesktopShellStore.getState().setSetupForm({
    setupMessage: String(message || ''),
    setupMessageType: String(type || '')
  });
}

export function syncDoctorOutputState(message: string) {
  useDesktopShellStore.getState().setSummary({
    doctorOutput: String(message || '')
  });
}
