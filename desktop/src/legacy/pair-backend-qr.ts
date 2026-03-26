// @ts-nocheck

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1']);

export function normalizePairBaseUrl(raw) {
  const text = String(raw || '').trim();
  if (!text) {
    return '';
  }
  const withProtocol = text.includes('://') ? text : `http://${text}`;
  try {
    const parsed = new URL(withProtocol);
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
    return isLoopbackPairHost(new URL(normalized).hostname);
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
  return parts.every((part) => /^\d+$/.test(part) && Number(part) >= 0 && Number(part) <= 255);
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

export function createPairBackendQrHelpers({ invoke }) {
  let pairLanIpv4Promise = null;

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
    const payloadBaseUrl = String(
      payload.serverBaseUrl || payload.server_base_url || payload.baseUrl || payload.base_url || ''
    ).trim();
    const resolvedBaseUrl = await resolvePairQrBaseUrl({
      configuredBaseUrl,
      payloadBaseUrl
    });

    if (!resolvedBaseUrl) {
      return payload;
    }

    payload.serverBaseUrl = resolvedBaseUrl;
    payload.server_base_url = resolvedBaseUrl;
    payload.baseUrl = resolvedBaseUrl;
    payload.base_url = resolvedBaseUrl;
    return payload;
  }

  return {
    sanitizePairQrPayload
  };
}
