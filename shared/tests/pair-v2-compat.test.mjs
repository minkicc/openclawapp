import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import net from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

import {
  announcePairV2Desktop,
  approvePairV2Binding,
  claimPairV2Session,
  computePairV2SafetyCode,
  configurePairV2SignalStreamFactory,
  configurePairV2Storage,
  createPairV2AppRegistry,
  createPairV2Session,
  getOrCreatePairV2Identity,
  listPairV2Bindings,
  loginPairV2Entity,
  openPairV2SignalStream,
  queryPairV2Presence,
  revokePairV2Binding,
  sendPairV2Signal,
} from '../../packages/pair-sdk/dist/index.js';
import {
  buildOpenClawPairChatPayload,
  createOpenClawPairChatModule,
  openClawPairChatMessageType,
  supportsOpenClawPairChat,
} from '../../packages/message-sdk/dist/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = resolve(__dirname, '../..');
const serverDir = resolve(workspaceRoot, 'server');

class InMemoryStore {
  #values = new Map();

  async getItem(key) {
    return this.#values.has(key) ? this.#values.get(key) : null;
  }

  async setItem(key, value) {
    this.#values.set(key, value);
  }

  async removeItem(key) {
    this.#values.delete(key);
  }
}

class NodeSignalStream {
  readyState = 0;

  onopen = null;

  onmessage = null;

  onerror = null;

  onclose = null;

  done = null;

  #controller = new AbortController();

  #closed = false;

  #reader = null;

  #resolveDone = () => {};

  constructor(url) {
    this.url = String(url || '');
    this.done = new Promise((resolve) => {
      this.#resolveDone = resolve;
    });
    void this.#start();
  }

  async #start() {
    try {
      const response = await fetch(this.url, {
        headers: {
          Accept: 'text/event-stream',
        },
        signal: this.#controller.signal,
      });
      if (!response.ok) {
        throw new Error(`SSE HTTP ${response.status}`);
      }
      if (!response.body) {
        throw new Error('SSE response body is empty');
      }
      if (this.#closed) {
        return;
      }
      this.readyState = 1;
      this.onopen?.({ type: 'open' });

      const reader = response.body.getReader();
      this.#reader = reader;
      const decoder = new TextDecoder();
      let buffer = '';

      while (!this.#closed) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        let boundary = buffer.indexOf('\n\n');
        while (boundary >= 0) {
          const frame = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          this.#emitFrame(frame);
          boundary = buffer.indexOf('\n\n');
        }
      }
      this.#finishClose();
    } catch (error) {
      if (this.#closed || error?.name === 'AbortError') {
        this.#finishClose();
        return;
      }
      this.readyState = 0;
      this.onerror?.({
        type: 'error',
        message: error instanceof Error ? error.message : String(error),
      });
      this.#finishClose();
    } finally {
      this.#reader = null;
    }
  }

  #emitFrame(frame) {
    const normalized = String(frame || '').replaceAll('\r\n', '\n');
    const dataLines = [];
    for (const line of normalized.split('\n')) {
      if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).trimStart());
      }
    }
    if (dataLines.length === 0) {
      return;
    }
    this.onmessage?.({
      type: 'message',
      data: dataLines.join('\n'),
    });
  }

  #finishClose() {
    if (this.readyState === 2) {
      return;
    }
    this.readyState = 2;
    this.onclose?.({ type: 'close' });
    this.#resolveDone();
  }

  close() {
    if (this.readyState === 2) {
      return this.done;
    }
    this.#closed = true;
    this.#controller.abort();
    if (this.#reader) {
      void this.#reader.cancel().catch(() => {});
    }
    this.#finishClose();
    return this.done;
  }
}

function openStreamCollector(baseUrl, token, clientType, clientId) {
  const stream = openPairV2SignalStream(baseUrl, token, clientType, clientId);
  const events = [];
  const errors = [];
  let isOpen = false;

  let resolveOpened = () => {};
  let rejectOpened = () => {};
  const opened = new Promise((resolve, reject) => {
    resolveOpened = resolve;
    rejectOpened = reject;
  });

  stream.onopen = () => {
    isOpen = true;
    resolveOpened();
  };

  stream.onmessage = (event) => {
    try {
      const parsed = JSON.parse(String(event.data || ''));
      events.push(parsed);
    } catch (error) {
      errors.push(`invalid-json:${error instanceof Error ? error.message : String(error)}`);
    }
  };

  stream.onerror = (event) => {
    const message = String(event?.message || 'stream error');
    errors.push(message);
    if (!isOpen) {
      rejectOpened(new Error(message));
    }
  };

  stream.onclose = () => {
    if (!isOpen) {
      rejectOpened(new Error(`stream closed before open: ${clientType}:${clientId}`));
    }
  };

  return {
    events,
    errors,
    opened,
    async close() {
      await stream.close();
    },
    async waitForType(type, predicate = () => true, timeoutMs = 5000) {
      const startedAt = Date.now();
      while (Date.now() - startedAt < timeoutMs) {
        const matched = events.find(
          (event) => String(event?.type || '').trim() === type && predicate(event)
        );
        if (matched) {
          return matched;
        }
        if (errors.length > 0) {
          throw new Error(`${clientType}:${clientId} stream error: ${errors.join('; ')}`);
        }
        await delay(25);
      }
      throw new Error(
        `Timed out waiting for ${type} on ${clientType}:${clientId}; seen=${events
          .map((event) => String(event?.type || '').trim())
          .filter(Boolean)
          .join(',')}`
      );
    },
  };
}

async function allocatePort() {
  return await new Promise((resolvePort, rejectPort) => {
    const server = net.createServer();
    server.once('error', rejectPort);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        rejectPort(new Error('failed to allocate tcp port'));
        server.close();
        return;
      }
      const { port } = address;
      server.close((error) => {
        if (error) {
          rejectPort(error);
          return;
        }
        resolvePort(port);
      });
    });
  });
}

async function waitForHealthy(baseUrl, child) {
  const startedAt = Date.now();
  let lastError = 'server not ready';
  while (Date.now() - startedAt < 15_000) {
    if (child.exitCode !== null) {
      throw new Error(`server exited before ready: ${child.exitCode}`);
    }
    try {
      const response = await fetch(`${baseUrl}/healthz`);
      if (response.ok) {
        return;
      }
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await delay(100);
  }
  throw new Error(`server failed health check: ${lastError}`);
}

async function startServerProcess() {
  const port = await allocatePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn('go', ['run', '.'], {
    cwd: serverDir,
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: String(port),
      STORE_BACKEND: 'memory',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let logs = '';
  child.stdout.on('data', (chunk) => {
    logs += String(chunk);
  });
  child.stderr.on('data', (chunk) => {
    logs += String(chunk);
  });

  await waitForHealthy(baseUrl, child);

  return {
    baseUrl,
    child,
    readLogs() {
      return logs;
    },
  };
}

async function stopServerProcess(server) {
  if (!server?.child || server.child.exitCode !== null) {
    return;
  }
  server.child.kill('SIGTERM');
  const exitTimer = delay(5_000).then(() => 'timeout');
  const exitResult = await Promise.race([
    once(server.child, 'exit').then(() => 'exit'),
    exitTimer,
  ]);
  if (exitResult === 'timeout' && server.child.exitCode === null) {
    server.child.kill('SIGKILL');
    await once(server.child, 'exit');
  }
}

test('pair v2 protocol compatibility covers server, control-plane sdk, signal stream, and message sdk', async (t) => {
  const store = new InMemoryStore();
  configurePairV2Storage(store);
  configurePairV2SignalStreamFactory((url) => new NodeSignalStream(url));

  let server = null;
  let desktopSignals = null;
  let mobileSignals = null;

  try {
    server = await startServerProcess();

    const seed = `${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
    const desktopId = `desktop_${seed}`;
    const mobileId = `mobile_${seed}`;

    const desktopIdentity = await getOrCreatePairV2Identity('desktop', desktopId);
    const mobileIdentity = await getOrCreatePairV2Identity('mobile', mobileId);

    assert.ok(desktopIdentity.publicKey);
    assert.ok(mobileIdentity.publicKey);

    const { session: desktopSession } = await loginPairV2Entity(server.baseUrl, 'desktop', desktopId);
    const { session: mobileSession } = await loginPairV2Entity(server.baseUrl, 'mobile', mobileId);

    assert.equal(desktopSession.entityId, desktopId);
    assert.equal(mobileSession.entityId, mobileId);

    desktopSignals = openStreamCollector(server.baseUrl, desktopSession.token, 'desktop', desktopId);
    mobileSignals = openStreamCollector(server.baseUrl, mobileSession.token, 'mobile', mobileId);

    await Promise.all([desktopSignals.opened, mobileSignals.opened]);

    await announcePairV2Desktop(server.baseUrl, desktopSession.token, {
      platform: 'compat-test',
      appVersion: '1.0.0',
      capabilities: {
        webrtc: true,
        sdk: 'pair-sdk',
      },
    });

    const pairSessionResult = await createPairV2Session(server.baseUrl, desktopSession.token, 180);
    assert.equal(pairSessionResult.qrPayload.deviceId, desktopId);
    assert.equal(pairSessionResult.qrPayload.devicePubkey, desktopIdentity.publicKey);
    assert.equal(pairSessionResult.qrPayload.claimToken, pairSessionResult.session.claimToken);

    const safetyCode = await computePairV2SafetyCode({
      devicePublicKey: pairSessionResult.qrPayload.devicePubkey,
      mobilePublicKey: mobileIdentity.publicKey,
      pairSessionId: pairSessionResult.qrPayload.pairSessionId,
      sessionNonce: pairSessionResult.qrPayload.sessionNonce,
    });
    assert.match(safetyCode, /^\d{6}$/);

    const claimResult = await claimPairV2Session(
      server.baseUrl,
      mobileSession.token,
      pairSessionResult.qrPayload.claimToken
    );

    assert.equal(claimResult.binding.deviceId, desktopId);
    assert.equal(claimResult.binding.mobileId, mobileId);
    assert.equal(claimResult.binding.trustState, 'pending');

    const pairClaimedEvent = await desktopSignals.waitForType(
      'pair.claimed',
      (event) => event?.payload?.bindingId === claimResult.binding.bindingId
    );
    assert.equal(pairClaimedEvent.payload.deviceId, desktopId);
    assert.equal(pairClaimedEvent.payload.mobileId, mobileId);
    assert.equal(pairClaimedEvent.payload.mobilePublicKey, mobileIdentity.publicKey);

    const pendingBindings = await listPairV2Bindings(server.baseUrl, mobileSession.token, true);
    assert.equal(pendingBindings.bindings.length, 1);
    assert.equal(pendingBindings.bindings[0].trustState, 'pending');

    const approvalResult = await approvePairV2Binding(
      server.baseUrl,
      desktopSession.token,
      claimResult.binding.bindingId
    );
    assert.equal(approvalResult.binding.trustState, 'active');

    const pairApprovedEvent = await mobileSignals.waitForType(
      'pair.approved',
      (event) => event?.payload?.bindingId === claimResult.binding.bindingId
    );
    assert.equal(pairApprovedEvent.payload.deviceId, desktopId);
    assert.equal(pairApprovedEvent.payload.mobileId, mobileId);
    assert.equal(pairApprovedEvent.payload.trustState, 'active');

    const activeBindings = await listPairV2Bindings(server.baseUrl, mobileSession.token, false);
    assert.equal(activeBindings.bindings.length, 1);
    assert.equal(activeBindings.bindings[0].bindingId, claimResult.binding.bindingId);
    assert.equal(activeBindings.bindings[0].trustState, 'active');

    const presenceResult = await queryPairV2Presence(server.baseUrl, mobileSession.token, [desktopId]);
    assert.equal(presenceResult.statuses.length, 1);
    assert.equal(presenceResult.statuses[0].deviceId, desktopId);
    assert.equal(presenceResult.statuses[0].status, 'online');

    const signalToDesktop = await sendPairV2Signal(server.baseUrl, mobileSession.token, {
      fromType: 'mobile',
      fromId: mobileId,
      toType: 'desktop',
      toId: desktopId,
      type: 'app.compat.mobile',
      payload: {
        text: 'hello from mobile',
      },
    });
    assert.equal(signalToDesktop.event.type, 'app.compat.mobile');

    const desktopRelayEvent = await desktopSignals.waitForType(
      'app.compat.mobile',
      (event) => event?.payload?.text === 'hello from mobile'
    );
    assert.equal(desktopRelayEvent.from.type, 'mobile');
    assert.equal(desktopRelayEvent.from.id, mobileId);

    const signalToMobile = await sendPairV2Signal(server.baseUrl, desktopSession.token, {
      fromType: 'desktop',
      fromId: desktopId,
      toType: 'mobile',
      toId: mobileId,
      type: 'app.compat.desktop',
      payload: {
        text: 'hello from desktop',
      },
    });
    assert.equal(signalToMobile.event.type, 'app.compat.desktop');

    const mobileRelayEvent = await mobileSignals.waitForType(
      'app.compat.desktop',
      (event) => event?.payload?.text === 'hello from desktop'
    );
    assert.equal(mobileRelayEvent.from.type, 'desktop');
    assert.equal(mobileRelayEvent.from.id, desktopId);

    const desktopChatMessages = [];
    const mobileChatMessages = [];

    const desktopRegistry = createPairV2AppRegistry([
      createOpenClawPairChatModule({
        onChatMessage(message) {
          desktopChatMessages.push(message);
        },
      }),
    ]);
    const mobileRegistry = createPairV2AppRegistry([
      createOpenClawPairChatModule({
        onChatMessage(message) {
          mobileChatMessages.push(message);
        },
      }),
    ]);

    const desktopCapabilities = desktopRegistry.buildCapabilities({
      protocolVersion: 'openclaw-pair-v2',
      appId: 'openclaw',
      appVersion: 'desktop-compat',
    });
    const mobileCapabilities = mobileRegistry.buildCapabilities({
      protocolVersion: 'openclaw-pair-v2',
      appId: 'openclaw',
      appVersion: 'mobile-compat',
    });

    assert.equal(supportsOpenClawPairChat(desktopCapabilities), true);
    assert.equal(supportsOpenClawPairChat(mobileCapabilities), true);
    assert.ok(desktopCapabilities.supportedMessages.includes(openClawPairChatMessageType));
    assert.ok(mobileCapabilities.supportedMessages.includes(openClawPairChatMessageType));

    const firstChatHandled = await desktopRegistry.dispatch(
      {
        type: openClawPairChatMessageType,
        payload: buildOpenClawPairChatPayload('compat message from mobile'),
        ts: Date.now(),
        from: 'mobile',
      },
      { client: 'desktop' }
    );
    assert.equal(firstChatHandled, true);
    assert.equal(desktopChatMessages.length, 1);
    assert.equal(desktopChatMessages[0].text, 'compat message from mobile');
    assert.equal(desktopChatMessages[0].from, 'mobile');

    const secondChatHandled = await mobileRegistry.dispatch(
      {
        type: openClawPairChatMessageType,
        payload: buildOpenClawPairChatPayload('compat message from desktop'),
        ts: Date.now(),
        from: 'desktop',
      },
      { client: 'mobile' }
    );
    assert.equal(secondChatHandled, true);
    assert.equal(mobileChatMessages.length, 1);
    assert.equal(mobileChatMessages[0].text, 'compat message from desktop');
    assert.equal(mobileChatMessages[0].from, 'desktop');

    const revokeResult = await revokePairV2Binding(
      server.baseUrl,
      desktopSession.token,
      claimResult.binding.bindingId
    );
    assert.equal(revokeResult.binding.trustState, 'revoked');

    const desktopRevokedEvent = await desktopSignals.waitForType(
      'pair.revoked',
      (event) => event?.payload?.bindingId === claimResult.binding.bindingId
    );
    const mobileRevokedEvent = await mobileSignals.waitForType(
      'pair.revoked',
      (event) => event?.payload?.bindingId === claimResult.binding.bindingId
    );
    assert.equal(desktopRevokedEvent.payload.trustState, 'revoked');
    assert.equal(mobileRevokedEvent.payload.trustState, 'revoked');

    const visibleAfterRevoke = await listPairV2Bindings(server.baseUrl, mobileSession.token, false);
    const allAfterRevoke = await listPairV2Bindings(server.baseUrl, mobileSession.token, true);

    assert.equal(visibleAfterRevoke.bindings.length, 0);
    assert.equal(allAfterRevoke.bindings.length, 1);
    assert.equal(allAfterRevoke.bindings[0].trustState, 'revoked');
    assert.equal(desktopSignals.errors.length, 0, server.readLogs());
    assert.equal(mobileSignals.errors.length, 0, server.readLogs());
  } finally {
    await desktopSignals?.close();
    await mobileSignals?.close();
    configurePairV2SignalStreamFactory(null);
    configurePairV2Storage(null);
    await stopServerProcess(server);
  }
});
