import { useEffect, useRef } from 'react';
import { loadTurnstile } from './lib/turnstile';
import type { TurnstileApi } from './lib/turnstile';

interface Props {
  siteKey: string;
  language: 'pl' | 'en';
  round: number;
  onToken: (token: string) => void;
  onUnavailable: () => void;
}

export default function TurnstileWidget({
  siteKey,
  language,
  round,
  onToken,
  onUnavailable,
}: Props) {
  const container = useRef<HTMLDivElement | null>(null);
  const api = useRef<TurnstileApi | null>(null);
  const widget = useRef<string | null>(null);
  // Callbacki trzymamy w refie, żeby zmiana ich tożsamości przy renderze
  // rodzica nie tworzyła widgetu od nowa.
  const handlers = useRef({ onToken, onUnavailable });
  const rendered = useRef(round);

  useEffect(() => {
    handlers.current = { onToken, onUnavailable };
  }, [onToken, onUnavailable]);

  useEffect(() => {
    let active = true;
    void loadTurnstile().then(
      (turnstile) => {
        if (!active || !container.current) return;
        api.current = turnstile;
        widget.current = turnstile.render(container.current, {
          sitekey: siteKey,
          language,
          theme: 'auto',
          callback: (token) => handlers.current.onToken(token),
          'expired-callback': () => handlers.current.onToken(''),
          'error-callback': () => handlers.current.onUnavailable(),
        });
      },
      () => {
        if (active) handlers.current.onUnavailable();
      },
    );
    return () => {
      active = false;
      if (api.current && widget.current) api.current.remove(widget.current);
      api.current = null;
      widget.current = null;
    };
  }, [siteKey, language]);

  useEffect(() => {
    // Zmiana `round` resetuje widget i wymusza wydanie nowego tokenu.
    if (rendered.current === round) return;
    rendered.current = round;
    if (api.current && widget.current) api.current.reset(widget.current);
  }, [round]);

  return <div ref={container} className="onboarding-captcha" />;
}
