import type { ReactNode } from 'react';
import OnboardingStep from './OnboardingStep';
import { LogOut } from './placeholderIcons';
import { assetUrl } from './lib/asset-url';
import './onboarding.css';

export function GoogleMark({ size = 20 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      aria-hidden="true"
      focusable="false"
    >
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}

interface Props {
  language: 'pl' | 'en';
  onLanguageChange: (language: 'pl' | 'en') => void;
  siteLinks?: boolean;
  account: { email: string | null } | null;
  onSignOut?: () => void;
  profileOnly?: boolean;
  children?: ReactNode;
}

export default function OnboardingPage({
  language,
  onLanguageChange,
  siteLinks = false,
  account,
  onSignOut,
  profileOnly = false,
  children,
}: Props) {
  const en = language === 'en';
  const tr = (pl: string, english: string) => (en ? english : pl);
  return (
    <div className="onboarding">
      {siteLinks && (
        <a
          className="website-return website-return--onboarding"
          href={`/${language}`}
        >
          <span className="website-return__icon" aria-hidden="true">
            ←
          </span>
          <span>
            {tr('Powrót do strony internetowej', 'Back to the website')}
          </span>
        </a>
      )}
      <header className="onboarding__bar">
        <div className="onboarding__brand">
          <img
            className="onboarding__logo"
            src={assetUrl('logo.webp')}
            alt=""
            width={40}
            height={40}
          />
          <span className="onboarding__brand-text">
            <strong>Gwiazdy Katowice</strong>
            <small>{tr('Portal klubowy', 'Club portal')}</small>
          </span>
        </div>
        <div
          className="onboarding__language"
          role="group"
          aria-label={tr('Język', 'Language')}
        >
          {(
            [
              ['pl', 'Polski'],
              ['en', 'English'],
            ] as const
          ).map(([code, name]) => (
            <button
              key={code}
              type="button"
              lang={code}
              className={`onboarding__language-option${language === code ? ' is-active' : ''}`}
              aria-pressed={language === code}
              aria-label={name}
              onClick={() => {
                if (code !== language) onLanguageChange(code);
              }}
            >
              {code.toUpperCase()}
            </button>
          ))}
        </div>
      </header>
      <main className="onboarding__main">
        <div className="onboarding__intro">
          <h1 className="onboarding__title">
            {profileOnly
              ? tr('Uzupełnij dane osobowe', 'Complete your personal details')
              : account
                ? tr(
                    'Podaj dane osobowe w celu dokończenia rejestracji',
                    'Enter your personal details to complete registration',
                  )
                : tr(
                    'Portal klubu Gwiazdy Katowice',
                    'Gwiazdy Katowice club portal',
                  )}
          </h1>
          <p className="onboarding__lead">
            {profileOnly
              ? tr(
                  'W Twoim profilu brakuje danych. Uzupełnij je, aby wrócić do portalu.',
                  'Your profile is missing details. Fill them in to return to the portal.',
                )
              : account
                ? tr(
                    'Jeszcze dwa kroki: dane osobowe i kod klubowy. Potem administrator klubu zatwierdzi dostęp.',
                    'Two more steps: personal details and the club code. Then a club administrator approves access.',
                  )
                : tr(
                    'Masz już dostęp? Wystarczy krok 1. Jesteś tu pierwszy raz? Trzy kroki zajmą około minuty.',
                    'Already have access? Step 1 is enough. First time here? Three steps take about a minute.',
                  )}
          </p>
        </div>
        <div className="onboarding-steps">
          <OnboardingStep
            id="onboarding-account"
            number={1}
            title={tr('Konto', 'Account')}
            state={account ? 'done' : 'current'}
            language={language}
          >
            {account ? (
              <div className="onboarding-account">
                <span className="onboarding-account__email">
                  {account.email ?? tr('Zalogowano', 'Signed in')}
                </span>
                {onSignOut && (
                  <button
                    type="button"
                    className="onboarding-link"
                    onClick={onSignOut}
                  >
                    <LogOut size={15} aria-hidden="true" />
                    {tr('Wyloguj', 'Sign out')}
                  </button>
                )}
              </div>
            ) : (
              children
            )}
          </OnboardingStep>
          {account ? (
            children
          ) : (
            <>
              <OnboardingStep
                id="onboarding-details"
                number={2}
                title={tr('Dane osobowe', 'Personal details')}
                state="locked"
                language={language}
                note={tr(
                  'Imię, nazwisko i data urodzenia — Twoje albo dziecka. Odblokuje się po zalogowaniu.',
                  'First name, last name and date of birth — yours or your child’s. Unlocks after you sign in.',
                )}
              />
              <OnboardingStep
                id="onboarding-code"
                number={3}
                title={tr('Kod klubowy', 'Club code')}
                state="locked"
                language={language}
                note={tr(
                  '6 znaków od trenera lub administratora. Odblokuje się po podaniu danych.',
                  '6 characters from a coach or an administrator. Unlocks once the details are in.',
                )}
              />
            </>
          )}
        </div>
      </main>
      {siteLinks && (
        <footer className="onboarding__footer">
          {!account && (
            <a href={`/${language}/membership`}>
              {tr('Jak dołączyć do klubu', 'How to join the club')}
            </a>
          )}
          <a href={en ? '/en/privacy-policy' : '/pl/polityka-prywatnosci'}>
            {tr('Polityka prywatności', 'Privacy policy')}
          </a>
        </footer>
      )}
    </div>
  );
}
