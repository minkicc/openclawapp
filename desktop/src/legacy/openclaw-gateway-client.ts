import { buildGatewayDeviceConnectPayload } from './openclaw-device-identity';

type GatewayState = 'idle' | 'connecting' | 'connected';

type GatewayFrameEvent = {
  type: 'event';
  event: string;
  seq?: number;
  payload?: any;
};

type GatewayFrameResponse = {
  type: 'res';
  id: string;
  ok: boolean;
  payload?: any;
  error?: {
    code?: string;
    message?: string;
    details?: unknown;
  };
};

type PendingRequest = {
  resolve: (value: any) => void;
  reject: (reason?: unknown) => void;
};

export type OpenClawGatewayConnection = {
  wsUrl: string;
  token?: string;
};

export type OpenClawGatewayEvent = {
  event: string;
  seq?: number;
  payload?: any;
};

export type OpenClawGatewayClient = {
  isConnected: () => boolean;
  ensureConnected: () => Promise<any>;
  request: <T = any>(method: string, params?: Record<string, unknown>) => Promise<T>;
  close: (reason?: string) => void;
};

type Options = {
  resolveConnection: () => Promise<OpenClawGatewayConnection>;
  onEvent?: (event: OpenClawGatewayEvent) => void;
  onLog?: (line: string) => void;
  onStateChange?: (state: GatewayState, detail?: string) => void;
};

function createGatewayRequestId() {
  return (
    globalThis.crypto?.randomUUID?.() ||
    `ocgw_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`
  );
}

function toGatewayError(error: unknown, fallback = 'gateway request failed') {
  if (error instanceof Error && error.message.trim()) {
    return error;
  }
  return new Error(String(error || fallback));
}

export function createOpenClawGatewayClient(options: Options): OpenClawGatewayClient {
  let socket: WebSocket | null = null;
  let state: GatewayState = 'idle';
  let helloPayload: any = null;
  let pendingRequests = new Map<string, PendingRequest>();
  let connectPromise: Promise<any> | null = null;
  let connectNonce = '';
  let connectSent = false;
  let connectTimer: number | null = null;
  let closedByUser = false;

  function log(line: string) {
    options.onLog?.(line);
  }

  function setState(next: GatewayState, detail = '') {
    state = next;
    options.onStateChange?.(next, detail);
  }

  function clearConnectTimer() {
    if (connectTimer != null) {
      window.clearTimeout(connectTimer);
      connectTimer = null;
    }
  }

  function flushPendingRequests(error: Error) {
    for (const pending of pendingRequests.values()) {
      pending.reject(error);
    }
    pendingRequests.clear();
  }

  function close(reason = 'closed') {
    closedByUser = true;
    clearConnectTimer();
    connectSent = false;
    connectNonce = '';
    helloPayload = null;
    setState('idle', reason);
    const current = socket;
    socket = null;
    if (current && current.readyState === WebSocket.OPEN) {
      current.close(1000, reason);
    } else if (current && current.readyState === WebSocket.CONNECTING) {
      current.close();
    }
    flushPendingRequests(new Error(`gateway closed: ${reason}`));
  }

  function requestInternal<T = any>(method: string, params: Record<string, unknown> = {}) {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('gateway not connected'));
    }
    const id = createGatewayRequestId();
    const frame = {
      type: 'req',
      id,
      method,
      params,
    };
    return new Promise<T>((resolve, reject) => {
      pendingRequests.set(id, { resolve, reject });
      socket?.send(JSON.stringify(frame));
    });
  }

  async function sendConnect(
    connection: OpenClawGatewayConnection,
    resolve: (value: any) => void,
    reject: (reason?: unknown) => void
  ) {
    if (connectSent) {
      return;
    }
    connectSent = true;
    clearConnectTimer();

    try {
      const clientId = 'gateway-client';
      const clientMode = 'backend';
      const role = 'operator';
      const scopes = ['operator.admin', 'operator.approvals', 'operator.pairing'];
      const platform = navigator.platform || 'web';
      const device = await buildGatewayDeviceConnectPayload({
        nonce: connectNonce,
        clientId,
        clientMode,
        role,
        scopes,
        token: connection.token || null,
        platform,
      });

      const payload = {
        minProtocol: 3,
        maxProtocol: 3,
        client: {
          id: clientId,
          version: 'desktop-shell',
          platform,
          mode: clientMode,
          instanceId: createGatewayRequestId(),
        },
        role,
        scopes,
        caps: ['tool-events'],
        auth: connection.token ? { token: connection.token } : undefined,
        device,
        userAgent: navigator.userAgent,
        locale: navigator.language,
      };

      const hello = await requestInternal('connect', payload);
      helloPayload = hello;
      setState('connected');
      resolve(hello);
    } catch (error) {
      const normalized = toGatewayError(error, 'gateway connect failed');
      log(`gateway connect failed: ${normalized.message}`);
      reject(normalized);
      if (socket && socket.readyState <= WebSocket.OPEN) {
        socket.close(4008, 'connect failed');
      }
    }
  }

  function handleMessage(
    raw: string,
    connection: OpenClawGatewayConnection,
    resolve: (value: any) => void,
    reject: (reason?: unknown) => void
  ) {
    let frame: GatewayFrameEvent | GatewayFrameResponse | null = null;
    try {
      frame = JSON.parse(raw);
    } catch {
      return;
    }

    if (!frame || typeof frame !== 'object') {
      return;
    }

    if (frame.type === 'event') {
      if (frame.event === 'connect.challenge') {
        connectNonce = typeof frame.payload?.nonce === 'string' ? frame.payload.nonce : '';
        void sendConnect(connection, resolve, reject);
        return;
      }
      options.onEvent?.({
        event: frame.event,
        seq: frame.seq,
        payload: frame.payload,
      });
      return;
    }

    if (frame.type === 'res') {
      const pending = pendingRequests.get(frame.id);
      if (!pending) {
        return;
      }
      pendingRequests.delete(frame.id);
      if (frame.ok) {
        pending.resolve(frame.payload);
      } else {
        pending.reject(
          new Error(String(frame.error?.message || frame.error?.code || 'gateway request failed'))
        );
      }
    }
  }

  async function ensureConnected() {
    if (socket?.readyState === WebSocket.OPEN && state === 'connected' && helloPayload) {
      return helloPayload;
    }
    if (connectPromise) {
      return connectPromise;
    }

    connectPromise = (async () => {
      const connection = await options.resolveConnection();
      return await new Promise<any>((resolve, reject) => {
        closedByUser = false;
        helloPayload = null;
        connectNonce = '';
        connectSent = false;
        clearConnectTimer();
        setState('connecting');

        const ws = new WebSocket(connection.wsUrl);
        socket = ws;
        let settled = false;

        const fail = (error: unknown) => {
          const normalized = toGatewayError(error, 'gateway connection failed');
          if (!settled) {
            settled = true;
            reject(normalized);
          }
          if (socket === ws) {
            socket = null;
          }
          helloPayload = null;
          connectSent = false;
          connectNonce = '';
          setState('idle', normalized.message);
          flushPendingRequests(normalized);
        };

        ws.addEventListener('open', () => {
          clearConnectTimer();
          connectTimer = window.setTimeout(() => {
            void sendConnect(
              connection,
              (hello) => {
                if (!settled) {
                  settled = true;
                  resolve(hello);
                }
              },
              fail
            );
          }, 750);
        });

        ws.addEventListener('message', (event) => {
          handleMessage(
            String(event.data ?? ''),
            connection,
            (hello) => {
              if (!settled) {
                settled = true;
                resolve(hello);
              }
            },
            fail
          );
        });

        ws.addEventListener('close', (event) => {
          clearConnectTimer();
          connectSent = false;
          connectNonce = '';
          if (socket === ws) {
            socket = null;
          }
          const reason = String(event.reason || '').trim() || `code=${event.code}`;
          const error = new Error(`gateway closed (${event.code}): ${reason}`);
          helloPayload = null;
          flushPendingRequests(error);
          if (!closedByUser && !settled) {
            settled = true;
            reject(error);
          }
          setState('idle', error.message);
        });

        ws.addEventListener('error', () => {
          log('gateway websocket error');
        });
      });
    })().finally(() => {
      connectPromise = null;
    });

    return connectPromise;
  }

  return {
    isConnected() {
      return Boolean(socket && socket.readyState === WebSocket.OPEN && state === 'connected');
    },
    async ensureConnected() {
      return await ensureConnected();
    },
    async request<T = any>(method: string, params: Record<string, unknown> = {}) {
      await ensureConnected();
      return await requestInternal<T>(method, params);
    },
    close,
  };
}
