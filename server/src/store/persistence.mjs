import { createClient } from "redis";
import { hydrateStoreFromSnapshot, serializeStoreSnapshot } from "./memory-store.mjs";

const SNAPSHOT_DEBOUNCE_MS = 200;

const state = {
  backend: "memory",
  redisKey: "",
  client: null,
  store: null,
  saveTimer: null,
  saveInFlight: null,
};

function clearSaveTimer() {
  if (state.saveTimer) {
    clearTimeout(state.saveTimer);
    state.saveTimer = null;
  }
}

async function persistNow() {
  if (state.backend !== "redis" || !state.client || !state.store) {
    return;
  }

  const snapshot = serializeStoreSnapshot(state.store);
  const payload = JSON.stringify(snapshot);
  await state.client.set(state.redisKey, payload);
}

async function persistAndForget() {
  if (state.saveInFlight) {
    return state.saveInFlight;
  }
  state.saveInFlight = persistNow()
    .catch((error) => {
      console.error("[openclaw-server] failed to persist store snapshot:", error);
    })
    .finally(() => {
      state.saveInFlight = null;
    });
  return state.saveInFlight;
}

export async function initPersistence(store) {
  state.store = store;

  const backend = String(process.env.STORE_BACKEND || "memory").trim().toLowerCase();
  if (backend !== "redis") {
    state.backend = "memory";
    console.log("[openclaw-server] persistence backend: memory");
    return { backend: state.backend };
  }

  const redisUrl = String(process.env.REDIS_URL || "redis://127.0.0.1:6379").trim();
  const redisKey = String(
    process.env.REDIS_SNAPSHOT_KEY || "openclaw:server:store-snapshot:v1"
  ).trim();

  const client = createClient({
    url: redisUrl,
    socket: {
      connectTimeout: 1000,
      reconnectStrategy: () => false,
    },
  });

  client.on("error", (error) => {
    console.error("[openclaw-server] redis client error:", error.message);
  });

  try {
    await client.connect();
    state.backend = "redis";
    state.redisKey = redisKey;
    state.client = client;

    const raw = await client.get(redisKey);
    if (raw) {
      const snapshot = JSON.parse(raw);
      hydrateStoreFromSnapshot(store, snapshot);
      console.log("[openclaw-server] restored store snapshot from redis");
    } else {
      console.log("[openclaw-server] no snapshot found in redis; starting fresh");
    }

    console.log(`[openclaw-server] persistence backend: redis (${redisUrl})`);
    return { backend: state.backend, redisUrl, redisKey };
  } catch (error) {
    console.error(
      "[openclaw-server] redis initialization failed; fallback to memory backend:",
      error.message
    );
    try {
      await client.quit();
    } catch {
      // no-op
    }
    state.backend = "memory";
    state.redisKey = "";
    state.client = null;
    return { backend: state.backend };
  }
}

export function schedulePersist() {
  if (state.backend !== "redis") {
    return;
  }

  clearSaveTimer();
  state.saveTimer = setTimeout(() => {
    state.saveTimer = null;
    void persistAndForget();
  }, SNAPSHOT_DEBOUNCE_MS);
}

export async function flushPersist() {
  clearSaveTimer();
  await persistAndForget();
}

export async function closePersistence() {
  await flushPersist();
  if (state.client) {
    try {
      await state.client.quit();
    } catch {
      // no-op
    }
    state.client = null;
  }
}

export function getPersistenceStatus() {
  return {
    backend: state.backend,
    redisKey: state.redisKey || null,
    connected: Boolean(state.client),
  };
}
