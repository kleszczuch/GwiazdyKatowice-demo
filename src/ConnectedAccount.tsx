import { useEffect, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import {
  forgetPkceVerifier,
  restorePkceVerifier,
  supabase,
} from './lib/supabase';
import {
  authRedirectTo,
  isEmailLinkError,
  readAuthCallbackError,
  unusedAuthCodePath,
} from './lib/auth-callback';
import { isTauriApp, tauriApi } from './lib/tauri';
import AccountPortal from './AccountPortal';
import {
  rememberPortalRoute,
  takeRememberedPortalRoute,
  writePortalRoute,
} from './lib/portal-navigation';
import SwordsLoader from './SwordsLoader';
import OnboardingPage, { GoogleMark } from './OnboardingPage';
import EmailSignIn from './EmailSignIn';
import { turnstileSiteKey } from './lib/turnstile';

// W aplikacji natywnej adres logowania otwiera się w zewnętrznej
// przeglądarce, więc dopuszczamy wyłącznie endpoint autoryzacji Supabase.
const isExpectedAuthUrl = (rawUrl: string) => {
  try {
    const url = new URL(rawUrl);
    return (
      url.protocol === 'https:' &&
      url.hostname.endsWith('.supabase.co') &&
      url.pathname === '/auth/v1/authorize'
    );
  } catch {
    return false;
  }
};

// Deep link powrotu z logowania: gwiazdykatowice://auth/callback.
const readAuthCallback = (rawUrl: string) => {
  try {
    const url = new URL(rawUrl);
    if (
      url.protocol !== 'gwiazdykatowice:' ||
      url.hostname !== 'auth' ||
      url.pathname !== '/callback'
    )
      return null;
    return url;
  } catch {
    return null;
  }
};

// Komunikaty są ustawiane po polsku w wielu miejscach, a język może się
// zmienić po ich ustawieniu, dlatego tłumaczenie odbywa się przy wyświetlaniu.
const englishMessages: Record<string, string> = {
  'Logowanie przez Google nie powiodło się. Spróbuj ponownie lub skontaktuj się z klubem.':
    'Google sign-in failed. Try again or contact the club.',
  'Link z e-maila wygasł albo został już użyty. Wyślij nową wiadomość i otwórz najnowszy link.':
    'The email link has expired or was already used. Send a new message and open the newest link.',
  'Nie udało się dokończyć logowania. Rozpocznij je ponownie i dokończ w tej samej przeglądarce, w której zaczynasz.':
    'Could not finish signing in. Start again and finish in the same browser you start in.',
  'Nie udało się dokończyć logowania. Spróbuj ponownie.':
    'Could not finish signing in. Try again.',
  'Nie udało się sprawdzić dostępu. Spróbuj ponownie.':
    'Could not verify access. Try again.',
  'Nie udało się przygotować mobilnego logowania.':
    'Could not prepare mobile sign-in.',
  'Nie udało się zalogować przez Google. Spróbuj ponownie lub skontaktuj się z klubem.':
    'Could not sign in with Google. Try again or contact the club.',
  'Nie udało się rozpocząć logowania przez Google. Spróbuj ponownie.':
    'Could not start Google sign-in. Try again.',
  'Nie udało się połączyć z klubem. Spróbuj ponownie.':
    'Could not connect to the club. Try again.',
  'Wylogowanie nie powiodło się. Spróbuj ponownie.':
    'Sign-out failed. Try again.',
  'Nie udało się wylogować. Sprawdź połączenie i spróbuj ponownie.':
    'Could not sign out. Check the connection and try again.',
  'Wniosek wysłany. Administrator musi zatwierdzić dostęp dla tego konta. Po zatwierdzeniu wybierz „Ponów sprawdzanie”.':
    'Request sent. An administrator must approve this account. After approval, select “Check again”.',
  'Zbyt wiele prób. Poczekaj przed ponownym wpisaniem kodu.':
    'Too many attempts. Wait before entering the code again.',
  'Kod jest nieprawidłowy lub wygasł. Sprawdź go i spróbuj ponownie.':
    'The code is invalid or has expired. Check it and try again.',
};

export default function ConnectedAccount() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  // Błąd powrotu z logowania jest odczytywany raz, przy starcie; adres jest od
  // razu czyszczony, żeby odświeżenie strony nie pokazało błędu ponownie.
  const [message, setMessage] = useState(() => {
    const location = new URL(window.location.href);
    const callback = readAuthCallbackError(location);
    if (callback.hasError)
      window.history.replaceState(
        window.history.state,
        '',
        callback.cleanedPath,
      );
    if (!callback.hasError) return '';
    return isEmailLinkError(location)
      ? 'Link z e-maila wygasł albo został już użyty. Wyślij nową wiadomość i otwórz najnowszy link.'
      : 'Logowanie przez Google nie powiodło się. Spróbuj ponownie lub skontaktuj się z klubem.';
  });
  const [busy, setBusy] = useState(false);
  // Ten sam deep link może przyjść dwa razy (zdarzenie i getCurrent); kod PKCE
  // jest jednorazowy, więc każdy wymieniamy tylko raz.
  const handledCodes = useRef(new Set<string>());
  const [language, setLanguage] = useState<'pl' | 'en'>(() =>
    typeof navigator !== 'undefined' && navigator.language.startsWith('en')
      ? 'en'
      : 'pl',
  );
  const en = language === 'en';
  const tr = (pl: string, english: string) => (en ? english : pl);
  const accountId = session?.user.id;
  const shownMessage = en ? (englishMessages[message] ?? message) : message;

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  useEffect(() => {
    if (!supabase) return;
    const client = supabase;
    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((event, next) => {
      // Po zalogowaniu wracamy do widoku zapamiętanego przed przekierowaniem,
      // chyba że adres już wskazuje konkretny widok.
      if (next && window.location?.href && window.history) {
        const remembered = takeRememberedPortalRoute();
        if (
          remembered &&
          !new URL(window.location.href).searchParams.has('view')
        )
          writePortalRoute(remembered, 'replace');
      }
      setSession(next);
      if (event !== 'INITIAL_SESSION') setMessage('');
      else if (!isTauriApp() && window.location?.href && window.history) {
        // Przy starcie w adresie został ?code=, którego biblioteka nie wymieniła
        // na sesję (np. logowanie dokończone w innej przeglądarce).
        const cleanedPath = unusedAuthCodePath(new URL(window.location.href));
        if (cleanedPath !== null) {
          window.history.replaceState(window.history.state, '', cleanedPath);
          if (!next)
            setMessage((current) =>
              current
                ? current
                : 'Nie udało się dokończyć logowania. Rozpocznij je ponownie i dokończ w tej samej przeglądarce, w której zaczynasz.',
            );
        }
      }
      setLoading(false);
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!supabase || !accountId || !session) return;
    // Profil konta tworzymy przy pierwszym logowaniu; ignoreDuplicates sprawia,
    // że istniejąca nazwa nie jest nadpisywana danymi z Google.
    void supabase
      .from('account_profiles')
      .upsert(
        {
          account_id: accountId,
          display_name: String(
            session.user.user_metadata.full_name ??
              session.user.user_metadata.name ??
              session.user.email ??
              'Konto klubowe',
          ),
        },
        { onConflict: 'account_id', ignoreDuplicates: true },
      )
      .then(
        () => {},
        () => {},
      );
  }, [accountId, session]);

  useEffect(() => {
    if (!supabase || !accountId) return;
    let active = true;
    void supabase
      .from('account_preferences')
      .select('language')
      .eq('account_id', accountId)
      .maybeSingle()
      .then(
        ({ data }) => {
          if (active && (data?.language === 'en' || data?.language === 'pl'))
            setLanguage(data.language);
        },
        () => {},
      );
    return () => {
      active = false;
    };
  }, [accountId]);

  useEffect(() => {
    if (!supabase || !isTauriApp()) return;
    const client = supabase;
    let disposed = false;
    let unlisten: (() => void) | undefined;

    const handleUrls = async (urls: string[]) => {
      for (const rawUrl of urls) {
        const callback = readAuthCallback(rawUrl);
        if (!callback || disposed) continue;
        const callbackError =
          callback.searchParams.get('error_description') ??
          callback.searchParams.get('error');
        if (callbackError) {
          setMessage(
            callback.searchParams.get('error_code') === 'otp_expired'
              ? 'Link z e-maila wygasł albo został już użyty. Wyślij nową wiadomość i otwórz najnowszy link.'
              : 'Logowanie przez Google nie powiodło się. Spróbuj ponownie lub skontaktuj się z klubem.',
          );
          setLoading(false);
          continue;
        }
        const code = callback.searchParams.get('code');
        if (!code || handledCodes.current.has(code)) continue;
        handledCodes.current.add(code);
        setBusy(true);
        try {
          const { error } = await client.auth.exchangeCodeForSession(code);
          if (disposed) return;
          if (error) {
            restorePkceVerifier();
            handledCodes.current.delete(code);
            setMessage('Nie udało się dokończyć logowania. Spróbuj ponownie.');
          } else {
            forgetPkceVerifier();
            setMessage('');
          }
        } catch {
          restorePkceVerifier();
          if (disposed) return;
          handledCodes.current.delete(code);
          setMessage('Nie udało się dokończyć logowania. Spróbuj ponownie.');
        } finally {
          if (!disposed) {
            setLoading(false);
            setBusy(false);
          }
        }
      }
    };

    void (async () => {
      try {
        const api = tauriApi();
        unlisten = await api.deepLink.onOpenUrl((urls) => {
          void handleUrls(urls);
        });
        const currentUrls = await api.deepLink.getCurrent();
        if (currentUrls?.length) await handleUrls(currentUrls);
        else if (!disposed) setLoading(false);
      } catch {
        if (!disposed) {
          setMessage('Nie udało się przygotować mobilnego logowania.');
          setLoading(false);
        }
      }
    })();

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  const login = async () => {
    if (!supabase || busy) return;
    setBusy(true);
    try {
      const nativeApp = isTauriApp();
      // Zapamiętujemy widok, bo logowanie przeładuje stronę.
      rememberPortalRoute();
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: authRedirectTo(window.location, nativeApp),
          queryParams: { prompt: 'select_account' },
          skipBrowserRedirect: nativeApp,
        },
      });
      if (error) {
        setMessage(
          'Nie udało się zalogować przez Google. Spróbuj ponownie lub skontaktuj się z klubem.',
        );
      } else if (nativeApp && data.url) {
        if (!isExpectedAuthUrl(data.url))
          throw new Error('Unexpected Supabase authorization URL.');
        await tauriApi().opener.openUrl(data.url);
      } else if (nativeApp) {
        setMessage(
          'Nie udało się rozpocząć logowania przez Google. Spróbuj ponownie.',
        );
      }
    } catch {
      setMessage('Nie udało się połączyć z klubem. Spróbuj ponownie.');
    } finally {
      setBusy(false);
    }
  };

  const signOut = async () => {
    if (!supabase || busy) return;
    setBusy(true);
    try {
      const { error } = await supabase.auth.signOut();
      if (error) setMessage('Wylogowanie nie powiodło się. Spróbuj ponownie.');
    } catch {
      setMessage(
        'Nie udało się wylogować. Sprawdź połączenie i spróbuj ponownie.',
      );
    } finally {
      setBusy(false);
    }
  };
  if (loading && supabase && !session)
    return (
      <div className="onboarding onboarding--loading">
        <SwordsLoader
          language={language}
          size="large"
          label={tr('Wczytuję konto…', 'Loading account…')}
        />
      </div>
    );
  if (session && supabase)
    return (
      <>
        <AccountPortal
          key={session.user.id}
          client={supabase}
          session={session}
          language={language}
          siteLinks={false}
          onLanguageChange={setLanguage}
          onSignOut={signOut}
        />
        {message && (
          <p role="alert" className="notice floating-message">
            {shownMessage}
          </p>
        )}
      </>
    );

  const unavailable = !supabase;
  return (
    <OnboardingPage
      language={language}
      onLanguageChange={setLanguage}
      siteLinks={false}
      account={null}
    >
      <button
        type="button"
        className="onboarding-button onboarding-button--primary onboarding-button--demo"
        onClick={() => void login()}
        disabled={loading || busy}
      >
        {tr('Otwórz demo', 'Open demo')}
      </button>
      <p className="onboarding-divider" aria-hidden="true">
        <span>
          {tr('albo zobacz ekran logowania', 'or try the sign-in screen')}
        </span>
      </p>
      {unavailable && (
        <p className="onboarding-notice" role="status">
          {tr(
            'Logowanie zostanie udostępnione po uruchomieniu kont klubowych.',
            'Sign-in will be available when club accounts are enabled.',
          )}
        </p>
      )}
      {message && (
        <p role="alert" className="onboarding-notice is-error">
          {shownMessage}
        </p>
      )}
      <button
        type="button"
        className="onboarding-button onboarding-button--google"
        onClick={() => void login()}
        disabled={unavailable || loading || busy}
      >
        {busy ? (
          <SwordsLoader
            size="small"
            announce={false}
            label={tr('Przekierowuję…', 'Redirecting…')}
          />
        ) : (
          <>
            <GoogleMark />
            {tr('Zaloguj przez Google', 'Sign in with Google')}
          </>
        )}
      </button>
      <p className="onboarding-divider" aria-hidden="true">
        <span>{tr('albo', 'or')}</span>
      </p>
      <EmailSignIn
        client={supabase}
        language={language}
        disabled={unavailable || loading || busy}
        redirectTo={authRedirectTo(window.location, isTauriApp())}
        captchaSiteKey={turnstileSiteKey || undefined}
      />
    </OnboardingPage>
  );
}
