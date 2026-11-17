import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { Mail } from './placeholderIcons';
import TurnstileWidget from './TurnstileWidget';

export const EMAIL_CODE_LENGTH = 6;
export const RESEND_SECONDS = 60;

export const validEmail = (value: string) =>
  value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value);

export const normalizeEmailCode = (value: string) =>
  value.replace(/\D/g, '').slice(0, EMAIL_CODE_LENGTH);

type Stage = 'address' | 'code';
type Failure =
  | 'address'
  | 'limit'
  | 'blocked'
  | 'send'
  | 'code-short'
  | 'code'
  | 'network'
  | 'captcha'
  | 'captcha-unavailable'
  | '';

interface Props {
  client: Pick<SupabaseClient, 'auth'> | null;
  language: 'pl' | 'en';
  disabled?: boolean;
  redirectTo?: string;
  captchaSiteKey?: string;
}

export default function EmailSignIn({
  client,
  language,
  disabled = false,
  redirectTo,
  captchaSiteKey,
}: Props) {
  const en = language === 'en';
  const tr = (pl: string, english: string) => (en ? english : pl);
  const [stage, setStage] = useState<Stage>('address');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [failure, setFailure] = useState<Failure>('');
  const [busy, setBusy] = useState(false);
  const [wait, setWait] = useState(0);
  const [captchaToken, setCaptchaToken] = useState('');
  const [captchaRound, setCaptchaRound] = useState(0);
  // working blokuje równoległe wysyłki synchronicznie; mounted pozwala
  // pominąć zmianę stanu po udanym logowaniu, które odmontowuje formularz.
  const working = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (wait <= 0 || typeof window === 'undefined') return;
    const timer = window.setTimeout(
      () => setWait((value) => Math.max(0, value - 1)),
      1000,
    );
    return () => window.clearTimeout(timer);
  }, [wait]);

  const messages: Record<Exclude<Failure, ''>, string> = {
    address: tr(
      'Wpisz prawidłowy adres e-mail, np. jan@example.com.',
      'Enter a valid email address, for example jan@example.com.',
    ),
    limit: tr(
      'Wysłaliśmy już zbyt wiele kodów. Spróbuj za kilka minut albo zaloguj się przez Google.',
      'Too many codes have been sent. Try again in a few minutes or sign in with Google.',
    ),
    blocked: tr(
      'Na ten adres nie możemy teraz wysłać wiadomości. Zaloguj się przez Google albo napisz do klubu.',
      'We cannot send a message to this address right now. Sign in with Google or contact the club.',
    ),
    send: tr(
      'Nie udało się wysłać kodu. Spróbuj ponownie albo zaloguj się przez Google.',
      'Could not send the code. Try again or sign in with Google.',
    ),
    'code-short': tr(
      `Kod z e-maila ma ${EMAIL_CODE_LENGTH} cyfr.`,
      `The email code has ${EMAIL_CODE_LENGTH} digits.`,
    ),
    code: tr(
      'Ten kod jest nieprawidłowy albo wygasł. Sprawdź go lub wyślij nowy.',
      'This code is incorrect or has expired. Check it or send a new one.',
    ),
    network: tr(
      'Nie udało się połączyć z klubem. Sprawdź połączenie i spróbuj ponownie.',
      'Could not connect to the club. Check your connection and try again.',
    ),
    captcha: tr(
      'Trwa sprawdzanie, czy nie jesteś robotem. Poczekaj chwilę i spróbuj ponownie.',
      'We are still checking that you are not a robot. Wait a moment and try again.',
    ),
    'captcha-unavailable': tr(
      'Nie udało się wczytać zabezpieczenia przed robotami. Odśwież stronę albo zaloguj się przez Google.',
      'Could not load the robot check. Refresh the page or sign in with Google.',
    ),
  };

  const send = async () => {
    if (!client || working.current || disabled) return;
    const address = email.trim().toLowerCase();
    if (!validEmail(address)) {
      setFailure('address');
      return;
    }
    if (captchaSiteKey && !captchaToken) {
      setFailure((current) =>
        current === 'captcha-unavailable' ? current : 'captcha',
      );
      return;
    }
    working.current = true;
    setBusy(true);
    setFailure('');
    try {
      const { error } = await client.auth.signInWithOtp({
        email: address,
        options: {
          shouldCreateUser: true,
          ...(redirectTo ? { emailRedirectTo: redirectTo } : {}),
          ...(captchaSiteKey ? { captchaToken } : {}),
        },
      });
      if (!mounted.current) return;
      // Token Turnstile jest jednorazowy: po każdej próbie wysyłki prosimy
      // widget o nowy (captchaRound).
      if (captchaSiteKey) {
        setCaptchaToken('');
        setCaptchaRound((value) => value + 1);
      }
      if (error) {
        const limited =
          // Supabase zgłasza limit wysyłek statusem 429 albo samym komunikatem.
          error.status === 429 || /rate|security purposes/i.test(error.message);
        if (limited && stage === 'code') setWait(RESEND_SECONDS);
        setFailure(
          limited
            ? 'limit'
            : error.code === 'email_address_not_authorized'
              ? 'blocked'
              : error.code === 'captcha_failed'
                ? 'captcha'
                : 'send',
        );
        return;
      }
      setEmail(address);
      setCode('');
      setStage('code');
      setWait(RESEND_SECONDS);
    } catch {
      if (mounted.current) {
        setFailure('network');
        if (captchaSiteKey) {
          setCaptchaToken('');
          setCaptchaRound((value) => value + 1);
        }
      }
    } finally {
      working.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  const verify = async (value = code) => {
    if (!client || working.current || disabled) return;
    if (value.length < EMAIL_CODE_LENGTH) {
      setFailure('code-short');
      return;
    }
    working.current = true;
    setBusy(true);
    setFailure('');
    try {
      const { error } = await client.auth.verifyOtp({
        email,
        token: value,
        type: 'email',
      });
      if (!mounted.current) return;
      if (error) setFailure('code');
    } catch {
      if (mounted.current) setFailure('network');
    } finally {
      working.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  const off = disabled || busy || !client;

  if (stage === 'address')
    return (
      <form
        className="onboarding-email"
        noValidate
        onSubmit={(event: FormEvent<HTMLFormElement>) => {
          event.preventDefault();
          void send();
        }}
      >
        <label className="onboarding-field__label" htmlFor="onboarding-email">
          {tr('Adres e-mail', 'Email address')}
        </label>
        <div className="onboarding-email__row">
          <input
            id="onboarding-email"
            name="email"
            type="email"
            className="onboarding-input"
            value={email}
            onChange={(event) => {
              setEmail(event.currentTarget.value);
              if (failure) setFailure('');
            }}
            autoComplete="email"
            inputMode="email"
            autoCapitalize="none"
            spellCheck={false}
            maxLength={254}
            placeholder={tr('jan@example.com', 'jan@example.com')}
            disabled={off}
            aria-invalid={failure === 'address' ? true : undefined}
            aria-describedby={
              failure
                ? 'onboarding-email-hint onboarding-email-error'
                : 'onboarding-email-hint'
            }
          />
          <button
            type="submit"
            className="onboarding-button onboarding-button--quiet"
            disabled={off}
          >
            <Mail size={18} aria-hidden="true" />
            {busy ? tr('Wysyłam…', 'Sending…') : tr('Wyślij kod', 'Send code')}
          </button>
        </div>
        {captchaSiteKey && (
          <TurnstileWidget
            siteKey={captchaSiteKey}
            language={language}
            round={captchaRound}
            onToken={(token: string) => {
              setCaptchaToken(token);
              if (token)
                setFailure((current) => (current === 'captcha' ? '' : current));
            }}
            onUnavailable={() => {
              setCaptchaToken('');
              setFailure('captcha-unavailable');
            }}
          />
        )}
        <p id="onboarding-email-hint" className="onboarding-field__hint">
          {tr(
            'Wyślemy jednorazowy kod logowania. Bez hasła.',
            'We will send a one-time sign-in code. No password.',
          )}
        </p>
        {failure && (
          <p
            id="onboarding-email-error"
            className="onboarding-field__error"
            role="alert"
          >
            {messages[failure]}
          </p>
        )}
      </form>
    );

  return (
    <form
      className="onboarding-email"
      noValidate
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        void verify();
      }}
    >
      <p className="onboarding-email__sent" role="status">
        <Mail size={18} aria-hidden="true" />
        <span>
          {tr(
            'Jeśli adres jest poprawny, kod jest już w drodze na',
            'If the address is correct, a code is on its way to',
          )}{' '}
          <strong>{email}</strong>
        </span>
      </p>
      <label
        className="onboarding-field__label"
        htmlFor="onboarding-email-code"
      >
        {tr('Kod z e-maila', 'Email code')}
      </label>
      <div className="onboarding-email__row">
        <input
          id="onboarding-email-code"
          name="email_code"
          className="onboarding-input onboarding-input--digits"
          value={code}
          onChange={(event) => {
            const next = normalizeEmailCode(event.currentTarget.value);
            setCode(next);
            if (failure) setFailure('');
            if (next.length === EMAIL_CODE_LENGTH && next !== code)
              void verify(next);
          }}
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]*"
          maxLength={EMAIL_CODE_LENGTH}
          placeholder="••••••"
          disabled={off}
          aria-invalid={
            failure === 'code' || failure === 'code-short' ? true : undefined
          }
          aria-describedby={
            failure
              ? 'onboarding-email-code-hint onboarding-email-error'
              : 'onboarding-email-code-hint'
          }
        />
        <button type="submit" className="onboarding-button" disabled={off}>
          {busy ? tr('Sprawdzam…', 'Checking…') : tr('Zaloguj', 'Sign in')}
        </button>
      </div>
      <p id="onboarding-email-code-hint" className="onboarding-field__hint">
        {tr(
          `${EMAIL_CODE_LENGTH} cyfr z wiadomości. To nie jest kod klubowy.`,
          `${EMAIL_CODE_LENGTH} digits from the message. This is not the club code.`,
        )}
      </p>
      <p className="onboarding-field__hint">
        {tr(
          'W wiadomości jest link zamiast kodu? Otwórz go na tym urządzeniu, w tej samej przeglądarce — zaloguje bez kodu.',
          'The message has a link instead of a code? Open it on this device, in the same browser — it signs you in without a code.',
        )}
      </p>
      {failure && (
        <p
          id="onboarding-email-error"
          className="onboarding-field__error"
          role="alert"
        >
          {messages[failure]}
        </p>
      )}
      {captchaSiteKey && (
        <TurnstileWidget
          siteKey={captchaSiteKey}
          language={language}
          round={captchaRound}
          onToken={(token: string) => {
            setCaptchaToken(token);
            if (token)
              setFailure((current) => (current === 'captcha' ? '' : current));
          }}
          onUnavailable={() => {
            setCaptchaToken('');
            setFailure('captcha-unavailable');
          }}
        />
      )}
      <div className="onboarding-email__actions">
        <button
          type="button"
          className="onboarding-link"
          disabled={off || wait > 0}
          onClick={() => void send()}
        >
          {wait > 0
            ? tr(`Wyślij ponownie za ${wait} s`, `Send again in ${wait} s`)
            : tr('Wyślij ponownie', 'Send again')}
        </button>
        <button
          type="button"
          className="onboarding-link"
          disabled={busy}
          onClick={() => {
            setStage('address');
            setCode('');
            setFailure('');
            setWait(0);
          }}
        >
          {tr('Zmień adres', 'Change address')}
        </button>
      </div>
    </form>
  );
}
