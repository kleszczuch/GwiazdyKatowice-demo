import { useEffect, useRef, useState } from 'react';
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import ClubWorkspace from './ClubWorkspace';
import AccountPersonalProfile from './AccountPersonalProfile';
import ClothingSizesPanel from './ClothingSizesPanel';
import RegistrationForm from './RegistrationForm';
import OnboardingPage from './OnboardingPage';
import type { PortalAccess } from './types/personal-profile';
import { usePortalNavigation } from './lib/use-portal-navigation';
import SwordsLoader from './SwordsLoader';
import { isMinor } from './lib/warsaw-date.ts';
import './registration.css';

interface Props {
  client: SupabaseClient;
  session: Session;
  language: 'pl' | 'en';
  siteLinks?: boolean;
  onLanguageChange: (language: 'pl' | 'en') => void;
  onSignOut: () => Promise<void>;
}

const hasWorkspace = (access: PortalAccess | null) =>
  Boolean(
    access?.profile_complete &&
    (access.club_access ||
      access.pending ||
      (access.registered ?? access.registration_participant)),
  );

export default function AccountPortal({
  client,
  session,
  language,
  siteLinks = false,
  onLanguageChange,
  onSignOut,
}: Props) {
  const [access, setAccess] = useState<PortalAccess | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  // Numer żądania dostępu; odpowiedź starszego żądania jest pomijana.
  const epoch = useRef(0);
  const en = language === 'en';
  const tr = (pl: string, english: string) => (en ? english : pl);
  const reload = () => {
    setLoading(true);
    setRefresh((value) => value + 1);
  };
  useEffect(() => {
    if (typeof window === 'undefined' || loading) return;
    // Stan dostępu sprawdzamy ponownie po powrocie do karty i co 30 s, żeby
    // zatwierdzenie przez administratora było widoczne bez przeładowania.
    const refreshAccess = () => setRefresh((value) => value + 1);
    window.addEventListener('focus', refreshAccess);
    // Ukryta karta nie odpytuje serwera; powrót do niej odświeża stan (focus).
    const timer = window.setInterval(() => {
      if (typeof document === 'undefined' || !document.hidden) refreshAccess();
    }, 30000);
    return () => {
      window.removeEventListener('focus', refreshAccess);
      window.clearInterval(timer);
    };
  }, [loading]);
  useEffect(() => {
    const request = ++epoch.current;
    void (async () => {
      try {
        // Odpowiedź musi mieć oczekiwany kształt i dotyczyć zalogowanego konta;
        // inaczej traktujemy ją jak błąd odczytu.
        const { data, error } = await client.rpc('get_my_portal_access');
        if (
          error ||
          !data ||
          typeof data.club_access !== 'boolean' ||
          typeof data.profile_complete !== 'boolean' ||
          (data.profile_complete &&
            data.profile?.account_id !== session.user.id)
        )
          throw new Error('Invalid access response');
        if (request === epoch.current) {
          setAccess(data as PortalAccess);
          setMessage('');
        }
      } catch {
        if (request === epoch.current) {
          setAccess((previous) => (hasWorkspace(previous) ? previous : null));
          setMessage(
            en
              ? 'Could not load your account. Try again.'
              : 'Nie udało się wczytać konta. Spróbuj ponownie.',
          );
        }
      } finally {
        if (request === epoch.current) setLoading(false);
      }
    })();
    return () => {
      epoch.current = request + 1;
    };
  }, [client, session.user.id, refresh, en]);
  // Tryb opiekuna: osoba z profilu nie skończyła 18 lat według daty
  // w Warszawie. Konto prowadzi wtedy profil dziecka.
  const birth = access?.profile?.birth_date;
  const guardianMode = Boolean(
    access?.profile_complete && birth && isMinor(birth),
  );
  // `registered` (nowsza baza) jest prawdą także po cofnięciu dostępu, gdy
  // dane zawodnika nie są już zwracane; starsza baza ma tylko obiekt zawodnika.
  const registered = Boolean(
    access?.registered ?? access?.registration_participant,
  );
  const workspace = hasWorkspace(access);
  // Na ekranie rejestracji jedynym widokiem jest „home”; wywołanie porządkuje
  // adres, gdy zostały w nim parametry innego widoku.
  usePortalNavigation(['home'], !loading && Boolean(access) && !workspace);
  const needsCode = Boolean(
    access && !access.club_access && !access.pending && !registered,
  );
  const googleMetadata = session.user.user_metadata ?? {};
  const googleGiven = String(googleMetadata.given_name ?? '').trim();
  const googleFamily = String(googleMetadata.family_name ?? '').trim();
  const googleWords = String(
    googleMetadata.full_name ?? googleMetadata.name ?? '',
  )
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  // Podpowiedź imienia i nazwiska z konta Google: osobne pola, a gdy ich
  // brak — ostatnie słowo pełnej nazwy jako nazwisko.
  const suggestedName =
    googleGiven && googleFamily
      ? { first: googleGiven.slice(0, 60), last: googleFamily.slice(0, 60) }
      : googleWords.length >= 2
        ? {
            first: googleWords.slice(0, -1).join(' ').slice(0, 60),
            last: googleWords[googleWords.length - 1].slice(0, 60),
          }
        : null;
  const changeLanguage = (value: 'pl' | 'en') => {
    if (value === language) return;
    onLanguageChange(value);
    void Promise.resolve()
      .then(() =>
        client
          .from('account_preferences')
          .upsert(
            { account_id: session.user.id, language: value },
            { onConflict: 'account_id' },
          ),
      )
      .catch(() => {});
  };
  // key przełącza się przy aktywacji konta, więc obszar roboczy startuje od
  // zera z pełnym zakresem danych.
  if (access && workspace)
    return (
      <>
        <div hidden={Boolean(message)} inert={Boolean(message)}>
          <ClubWorkspace
            suspended={Boolean(message)}
            key={access.club_access ? 'active' : 'restricted'}
            restricted={!access.club_access}
            awaitingApproval={!access.club_access && access.pending}
            guardianMode={guardianMode}
            siteLinks={siteLinks}
            client={client}
            session={session}
            onSignOut={onSignOut}
            onProfileReviewed={reload}
            personalProfileRevision={`${access.profile?.updated_at ?? ''}:${access.profile_request?.id ?? ''}:${access.profile_request?.status ?? ''}:${JSON.stringify(access.access_scope ?? null)}`}
            personalName={[
              access.profile?.first_name?.trim(),
              access.profile?.last_name?.trim(),
            ]
              .filter(Boolean)
              .join(' ')}
            personalDetailsContent={(currentLanguage) => (
              <>
                <AccountPersonalProfile
                  key={`${session.user.id}:${access.profile?.updated_at ?? 'new'}:${access.profile_request?.id ?? 'no-request'}`}
                  client={client}
                  profile={access.profile ?? null}
                  guardianMode={guardianMode}
                  request={access.profile_request ?? null}
                  language={currentLanguage}
                  onSaved={reload}
                />
                {access.registration_participant?.clothing_sizes_requested &&
                  !access.club_access && (
                    <ClothingSizesPanel
                      client={client}
                      person={access.registration_participant}
                      language={currentLanguage}
                      onChanged={reload}
                    />
                  )}
              </>
            )}
          />
        </div>
        {message && (
          <section className="panel" aria-busy={loading}>
            <p role="alert" className="notice">
              {message}
            </p>
            <button
              type="button"
              className="button"
              onClick={reload}
              disabled={loading}
            >
              {tr('Ponów sprawdzanie', 'Check again')}
            </button>
          </section>
        )}
      </>
    );
  return (
    <OnboardingPage
      language={language}
      onLanguageChange={changeLanguage}
      siteLinks={siteLinks}
      account={{ email: session.user.email ?? null }}
      onSignOut={() => void onSignOut()}
      profileOnly={Boolean(access && !needsCode)}
    >
      {loading && !access && (
        <div className="onboarding-panel onboarding-panel--loading">
          <SwordsLoader
            language={language}
            label={tr('Wczytuję konto…', 'Loading account…')}
          />
        </div>
      )}
      {!loading && !access && (
        <div className="onboarding-panel">
          <p role="alert" className="onboarding-notice is-error">
            {message ||
              tr(
                'Nie udało się wczytać konta. Spróbuj ponownie.',
                'Could not load your account. Try again.',
              )}
          </p>
          <button
            type="button"
            className="onboarding-button onboarding-button--quiet"
            onClick={reload}
            disabled={loading}
          >
            {tr('Ponów sprawdzanie', 'Check again')}
          </button>
        </div>
      )}
      {access && (
        <RegistrationForm
          key={session.user.id}
          client={client}
          profile={access.profile ?? null}
          request={access.profile_request ?? null}
          needsCode={needsCode}
          canSelfActivate={access.can_self_activate}
          suggestedName={suggestedName}
          siteLinks={siteLinks}
          language={language}
          onChanged={reload}
        />
      )}
    </OnboardingPage>
  );
}
