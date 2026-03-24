export type PairV2KeyValueStore = {
  getItem: (key: string) => string | null | Promise<string | null>;
  setItem: (key: string, value: string) => void | Promise<void>;
  removeItem?: (key: string) => void | Promise<void>;
};

export type PairV2SignalStreamLike = {
  readonly readyState: number;
  onopen: ((event: { type: 'open' }) => void) | null;
  onmessage: ((event: { type: 'message'; data: string }) => void) | null;
  onerror: ((event: { type: 'error'; message?: string }) => void) | null;
  onclose?: ((event: { type: 'close' }) => void) | null;
  close: () => void;
};

export type PairV2SignalStreamFactory = (url: string) => PairV2SignalStreamLike;

let pairV2Storage: PairV2KeyValueStore | null = null;
let pairV2SignalStreamFactory: PairV2SignalStreamFactory | null = null;

export function configurePairV2Storage(store: PairV2KeyValueStore | null) {
  pairV2Storage = store;
}

export function getPairV2Storage() {
  return pairV2Storage;
}

export function configurePairV2SignalStreamFactory(factory: PairV2SignalStreamFactory | null) {
  pairV2SignalStreamFactory = factory;
}

export function getPairV2SignalStreamFactory() {
  return pairV2SignalStreamFactory;
}
