/**
 * Stands in for `virtual:pwa-register/react` in the desktop build: the app's files come from
 * inside the installer, so there's no service worker, and updates come from the app's updater.
 */
const noop = () => undefined;

export function useRegisterSW() {
  return {
    needRefresh: [false, noop] as [boolean, (v: boolean) => void],
    offlineReady: [false, noop] as [boolean, (v: boolean) => void],
    updateServiceWorker: async (_reload?: boolean) => undefined,
  };
}
