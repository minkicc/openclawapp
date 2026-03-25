import { WebviewWindow } from '@tauri-apps/api/window';

const PAIR_BACKGROUND_WINDOW_LABEL = 'pair-background';

function buildBackgroundWindowUrl() {
  const current = new URL(window.location.href);
  current.searchParams.set('backgroundPair', '1');
  return current.toString();
}

export async function ensurePairBackgroundWindow() {
  const existing = WebviewWindow.getByLabel(PAIR_BACKGROUND_WINDOW_LABEL);
  if (existing) {
    try {
      await existing.hide();
    } catch {
      // ignore hide errors
    }
    return existing;
  }

  const created = new WebviewWindow(PAIR_BACKGROUND_WINDOW_LABEL, {
    url: buildBackgroundWindowUrl(),
    visible: false,
    focus: false,
    skipTaskbar: true,
    decorations: false,
    transparent: true,
    resizable: false,
    width: 320,
    height: 240,
    title: 'OpenClaw Pair Background',
  });

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (error?: unknown) => {
      if (settled) {
        return;
      }
      settled = true;
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    };

    const timer = window.setTimeout(() => {
      finish();
    }, 1200);

    created.once('tauri://created', () => {
      window.clearTimeout(timer);
      finish();
    });

    created.once('tauri://error', (event) => {
      window.clearTimeout(timer);
      finish(new Error(String(event)));
    });
  });

  try {
    await created.hide();
  } catch {
    // ignore hide errors
  }

  return created;
}
