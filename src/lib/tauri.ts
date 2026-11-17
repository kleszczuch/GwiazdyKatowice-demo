type TauriUnlisten = () => void;

type TauriApi = {
  opener: {
    openUrl: (url: string) => Promise<void>;
  };
  deepLink: {
    getCurrent: () => Promise<string[] | null>;
    onOpenUrl: (handler: (urls: string[]) => void) => Promise<TauriUnlisten>;
  };
};

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
    __TAURI__?: TauriApi;
  }
}

export const isTauriApp = () =>
  typeof window !== 'undefined' &&
  Boolean(window.__TAURI_INTERNALS__ && window.__TAURI__);

export const tauriApi = () => {
  if (!isTauriApp() || !window.__TAURI__)
    throw new Error('Tauri mobile APIs are unavailable.');
  return window.__TAURI__;
};
