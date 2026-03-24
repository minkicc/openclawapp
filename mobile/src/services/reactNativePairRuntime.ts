import {
  configurePairV2SignalStreamFactory,
  type PairV2SignalStreamLike,
} from '@openclaw/pair-sdk';
import ReactNativeEventSource from 'react-native-sse';
import { registerGlobals } from 'react-native-webrtc';

const CONNECTING = 0;
const OPEN = 1;
const CLOSED = 2;

class ReactNativeSignalStreamAdapter implements PairV2SignalStreamLike {
  readyState = CONNECTING;

  onopen: ((event: { type: 'open' }) => void) | null = null;

  onmessage: ((event: { type: 'message'; data: string }) => void) | null = null;

  onerror: ((event: { type: 'error'; message?: string }) => void) | null = null;

  onclose: ((event: { type: 'close' }) => void) | null = null;

  private readonly source: ReactNativeEventSource;

  constructor(url: string) {
    this.source = new ReactNativeEventSource(url, {
      pollingInterval: 5000,
    });

    this.source.addEventListener('open', () => {
      this.readyState = OPEN;
      this.onopen?.({ type: 'open' });
    });

    this.source.addEventListener('message', (event) => {
      this.onmessage?.({
        type: 'message',
        data: String(event.data || ''),
      });
    });

    this.source.addEventListener('error', (event) => {
      const sourceStatus = Number((this.source as { status?: number }).status);
      this.readyState = sourceStatus === CLOSED ? CLOSED : CONNECTING;
      this.onerror?.({
        type: 'error',
        message: 'message' in event ? String(event.message || '') : '',
      });
    });

    this.source.addEventListener('close', () => {
      this.readyState = CLOSED;
      this.onclose?.({ type: 'close' });
    });
  }

  close() {
    this.readyState = CLOSED;
    this.source.removeAllEventListeners();
    this.source.close();
    this.onclose?.({ type: 'close' });
  }
}

let configured = false;

export function configureReactNativePairRuntime() {
  if (configured) {
    return;
  }
  configured = true;

  if (typeof RTCPeerConnection !== 'function') {
    registerGlobals();
  }

  configurePairV2SignalStreamFactory((url) => new ReactNativeSignalStreamAdapter(String(url)));
}
