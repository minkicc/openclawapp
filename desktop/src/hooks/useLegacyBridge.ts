import { useLayoutEffect } from 'react';
import { bootstrapLegacyApp } from '../legacy-app';
import { useDesktopShellStore } from '../store/useDesktopShellStore';

export function useLegacyBridge() {
  const markLegacyBootstrapped = useDesktopShellStore((state) => state.markLegacyBootstrapped);

  useLayoutEffect(() => {
    bootstrapLegacyApp();
    markLegacyBootstrapped();
  }, [markLegacyBootstrapped]);
}
