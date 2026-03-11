const DEFAULT_BASE_URL = "http://127.0.0.1:8787";

function trimSlash(value) {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

async function parseJsonResponse(res) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) {
    const message = data.message || `Request failed: ${res.status}`;
    const error = new Error(message);
    error.status = res.status;
    error.code = data.code || "HTTP_ERROR";
    throw error;
  }
  return data;
}

export function createDesktopPairingApi(options = {}) {
  const baseUrl = trimSlash(options.baseUrl || DEFAULT_BASE_URL);

  async function request(path, init = {}) {
    const headers = {
      "content-type": "application/json",
      ...(init.headers || {}),
    };
    const res = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers,
    });
    return parseJsonResponse(res);
  }

  return {
    baseUrl,

    async registerDevice(payload) {
      return request("/v1/devices/register", {
        method: "POST",
        body: JSON.stringify(payload),
      });
    },

    async createPairSession(payload) {
      return request("/v1/pair/sessions", {
        method: "POST",
        body: JSON.stringify(payload),
      });
    },

    async sendSignal(payload) {
      return request("/v1/signal/send", {
        method: "POST",
        body: JSON.stringify(payload),
      });
    },

    async pullSignalInbox(clientType, clientId, limit = 100) {
      const params = new URLSearchParams({
        clientType,
        clientId,
        limit: String(limit),
      });
      return request(`/v1/signal/inbox?${params.toString()}`, {
        method: "GET",
      });
    },

    async openSignalStream(clientType, clientId, onEvent, onError) {
      const params = new URLSearchParams({
        clientType,
        clientId,
      });
      const streamUrl = `${baseUrl}/v1/signal/stream?${params.toString()}`;
      const source = new EventSource(streamUrl);
      source.onmessage = (event) => {
        if (!onEvent) return;
        try {
          onEvent(JSON.parse(event.data));
        } catch {
          // ignore malformed payload
        }
      };
      source.onerror = (error) => {
        if (onError) {
          onError(error);
        }
      };
      return () => source.close();
    },
  };
}
