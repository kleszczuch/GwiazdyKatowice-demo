export interface TurnstileApi {
  render: (
    container: HTMLElement,
    options: {
      sitekey: string;
      language?: string;
      theme?: 'auto' | 'light' | 'dark';
      callback: (token: string) => void;
      'expired-callback'?: () => void;
      'error-callback'?: () => void;
    },
  ) => string;
  reset: (widgetId: string) => void;
  remove: (widgetId: string) => void;
}

const SCRIPT_URL =
  'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

export const turnstileSiteKey: string = String(
  import.meta.env.VITE_TURNSTILE_SITE_KEY ?? '',
).trim();

// Skrypt Turnstile ładujemy raz na stronę; po nieudanej próbie `pending`
// jest zerowane, żeby kolejne wywołanie mogło spróbować ponownie.
let pending: Promise<TurnstileApi> | null = null;

export function loadTurnstile(): Promise<TurnstileApi> {
  const current = (window as { turnstile?: TurnstileApi }).turnstile;
  if (current) return Promise.resolve(current);
  if (pending) return pending;
  pending = new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SCRIPT_URL;
    script.async = true;
    script.defer = true;
    script.onload = () => {
      const api = (window as { turnstile?: TurnstileApi }).turnstile;
      if (api) resolve(api);
      else reject(new Error('Turnstile unavailable'));
    };
    script.onerror = () => {
      script.remove();
      reject(new Error('Turnstile unavailable'));
    };
    document.head.appendChild(script);
  }).catch((error: unknown) => {
    pending = null;
    throw error;
  });
  return pending;
}
