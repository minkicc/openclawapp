export function normalizeOpenClawSessionKey(value: unknown) {
  return String(value || '').trim().toLowerCase();
}

export function buildOpenClawMobileSessionKey(mobileId: unknown) {
  const normalizedMobileId = String(mobileId || '').trim().toLowerCase();
  if (!normalizedMobileId) {
    return '';
  }
  return `agent:main:openclaw-mobile:direct:${normalizedMobileId}`;
}

export function extractOpenClawMessageText(message: unknown) {
  if (!message || typeof message !== 'object') {
    return '';
  }

  const candidate = message as Record<string, unknown>;
  if (typeof candidate.text === 'string') {
    return candidate.text.trim();
  }

  if (typeof candidate.content === 'string') {
    return candidate.content.trim();
  }

  if (Array.isArray(candidate.content)) {
    return candidate.content
      .map((item) => {
        if (!item || typeof item !== 'object') {
          return '';
        }
        const part = item as Record<string, unknown>;
        if (part.type === 'text' && typeof part.text === 'string') {
          return part.text;
        }
        return '';
      })
      .filter(Boolean)
      .join('\n')
      .trim();
  }

  return '';
}

export function resolveOpenClawGatewayConnection(rawUrl: string) {
  const normalized = String(rawUrl || '').trim();
  if (!normalized) {
    throw new Error('dashboard url is empty');
  }
  const parsed = new URL(normalized);
  const hashParams = new URLSearchParams(parsed.hash.startsWith('#') ? parsed.hash.slice(1) : parsed.hash);
  const searchParams = new URLSearchParams(parsed.search);
  const token = String(hashParams.get('token') || searchParams.get('token') || '').trim();
  parsed.hash = '';
  parsed.search = '';
  parsed.protocol = parsed.protocol === 'https:' ? 'wss:' : 'ws:';
  return {
    wsUrl: parsed.toString(),
    token,
  };
}

export function isMacDesktopShell() {
  return /mac/i.test(String(globalThis.navigator?.platform || ''));
}

export function buildOpenClawDashboardUrl(rawUrl: string) {
  const normalized = String(rawUrl || '').trim();
  if (!normalized) {
    throw new Error('dashboard url is empty');
  }
  return new URL(normalized).toString();
}

export function buildOpenClawSessionUrl(rawUrl: string, sessionKey: string) {
  const normalizedSessionKey = String(sessionKey || '').trim();
  if (!normalizedSessionKey) {
    throw new Error('session key is empty');
  }
  const url = new URL(buildOpenClawDashboardUrl(rawUrl));
  url.hash = '';
  url.pathname = '/chat';
  url.search = '';
  url.searchParams.set('session', normalizedSessionKey);
  return url.toString();
}

export function navigateCurrentWindowToOpenClaw(rawUrl: string) {
  const target = buildOpenClawDashboardUrl(rawUrl);
  window.location.assign(target);
}

export function navigateCurrentWindowToOpenClawSession(rawUrl: string, sessionKey: string) {
  const target = buildOpenClawSessionUrl(rawUrl, sessionKey);
  window.location.assign(target);
}
